use super::*;

pub(super) fn run_case(c: &V) -> Sim {
    let input = &c["input"];
    let name = c["name"].as_str().unwrap();
    let mut s = construct(input);
    compare(&s, &c["initial"], name, input);
    checkpoint(&mut s, name);
    #[cfg(feature = "trusted-status-probes")]
    {
        s.w.trace.1.enabled = true;
    }
    for (a, timeline) in input["actions"]
        .as_array()
        .unwrap()
        .iter()
        .zip(c["timeline"].as_array().unwrap())
    {
        match a["kind"].as_str().unwrap() {
            "step" | "queue" => {
                for i in a["inputs"].as_array().into_iter().flatten() {
                    enqueue(&mut s, i);
                }
                if a["kind"] == "step" {
                    source_step(&mut s, c);
                }
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "span" | "untilOwnMark" => {
                let mut stopped = false;
                for step in 1..=a["count"]
                    .as_u64()
                    .or_else(|| a["maxSteps"].as_u64())
                    .unwrap()
                {
                    source_step(&mut s, c);
                    if let Some(frame) = timeline["frames"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|f| f["relativeStep"] == step)
                    {
                        compare(&s, frame, name, input);
                        checkpoint(&mut s, name);
                    }
                    if a["kind"] == "untilOwnMark" {
                        let p = s.w.player(id(&a["owner"]).unwrap()).unwrap();
                        if p.signature.target == id(&a["target"])
                            && u64::from(p.signature.mark.tier) >= a["tier"].as_u64().unwrap()
                        {
                            assert_eq!(
                                step,
                                timeline["executed"].as_u64().unwrap(),
                                "actual own-Mark stopping step"
                            );
                            stopped = true;
                            break;
                        }
                    }
                }
                assert!(
                    a["kind"] != "untilOwnMark" || stopped,
                    "own Mark was never earned"
                );
            }
            "place" => {
                let now = s.w.server_time;
                let actor = id(&a["actor"]).unwrap();
                let ix = s.w.fighter_idx(actor).unwrap();
                let p = s.w.core_mut(ix);
                if let Some(at) = a.get("at") {
                    let at = point(&s.k.arena.map, at);
                    p.body.x = at.x;
                    p.body.y = at.y;
                    p.body.history.reset(crate::state::Sample {
                        t: now,
                        x: at.x,
                        y: at.y,
                    });
                    p.motion.slip = None;
                }
                if let Some(v) = a.get("slide") {
                    p.motion.slip = Some(crate::systems::terrain::walk::new_slip(
                        p.pos(),
                        Vec2::new(num(&v["vx"]), num(&v["vy"])),
                    ));
                }
                if let Some(hp) = a["hp"].as_f64() {
                    p.vitals.hp = hp;
                }
                if let Some(mode) = a["mode"].as_str() {
                    s.w.mobs.get_mut(actor).unwrap().brain.mode = match mode {
                        "return" => crate::mob_runtime::BrainMode::Return,
                        "idle" => crate::mob_runtime::BrainMode::Idle,
                        "fight" => crate::mob_runtime::BrainMode::Fight,
                        _ => panic!("unknown declared brain mode"),
                    };
                }
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "drop" => {
                s.mark_dropped(id(&a["actor"]).unwrap(), true);
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "reconnect" => {
                s.mark_dropped(id(&a["actor"]).unwrap(), false);
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "abandon" => {
                let gv = s.abandon_player(id(&a["actor"]).unwrap());
                assert_eq!(u64::from(gv), timeline["unbankedGv"].as_u64().unwrap());
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "remove" => {
                s.remove_player(id(&a["actor"]).unwrap());
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "observe" => {
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            "status" => {
                let target = id(&a["actor"]).unwrap();
                let src = a.get("source").unwrap_or(&a["actor"]);
                let source = crate::status_runtime::StatusSource {
                    id: id(src),
                    name: src.as_str().unwrap().into(),
                    owner_id: None,
                };
                let st = &a["status"];
                crate::systems::status::operations::apply(
                    &s.k,
                    &mut s.w,
                    &mut vec![],
                    target,
                    crate::status_runtime::StatusApply {
                        kind: serde_json::from_value(st["kind"].clone()).unwrap(),
                        source,
                        ms: num(&st["ms"]),
                        ability: st
                            .get("ability")
                            .map(|v| serde_json::from_value(v.clone()).unwrap()),
                        tag: None,
                        value: st["value"].as_f64(),
                        add: None,
                        data: None,
                    },
                    false,
                );
                compare(&s, timeline, name, input);
                checkpoint(&mut s, name);
            }
            other => panic!("unsupported setup {other}"),
        }
    }
    compare(&s, &c["final"], name, input);
    s
}

pub(super) fn checkpoint(sim: &mut Sim, name: &str) {
    // Declared Off-terrain slip setup is a trusted helper precondition, never an ordinary checkpoint.
    if sim.w.players.iter().any(|p| p.motion.slip.is_some())
        && sim.k.config.hazards == crate::terrain::Mode::Off
    {
        return;
    }
    let hash = sim.state_hash();
    let json = serde_json::to_value(&*sim).unwrap();
    let restored = Sim::restore(json)
        .unwrap_or_else(|e| panic!("{name}/tick{}/ordinary restore: {e}", sim.tick()));
    assert_eq!(hash, restored.state_hash(), "source snapshot round trip");
    *sim = restored;
    #[cfg(feature = "trusted-status-probes")]
    {
        sim.w.trace.1.enabled = true;
    }
}
