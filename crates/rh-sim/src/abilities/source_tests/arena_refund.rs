//! The immutable arena witness now uses genuine Wish producers and the reviewed lifecycle.
use super::*;
#[test]
pub(super) fn arena_genuine_freeze_laststand_and_teleport_refund() {
    let source: V =
        serde_json::from_str(include_str!("../../../../../parity/arena/source.json")).unwrap();
    let case = &source["cases"][27];
    assert_eq!(case["name"], "teleport-live-windup-status-refund");
    let input = &case["input"];
    let export: crate::mapdata::MapExport =
        serde_json::from_value(source["map"]["export"].clone()).unwrap();
    let mut sim = Sim::new(
        SimConfig {
            consumables: true,
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            min_players: 3,
            fill_seconds: 0.,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: input["config"]["firstPatienceSeconds"].as_f64(),
                coliseum_schedule: None,
                patience_seconds: 3600.,
                patience_min_seconds: 3600.,
                sudden_death_seconds: 60.,
            }),
            ..Default::default()
        },
        export.validate().unwrap().into_arena().unwrap(),
        Secrets {
            order_salt: 0,
            spawn_seed: input["mainSeed"].as_u64().unwrap() as u32,
            reward_salt: serde_json::from_value(input["rewardSalt"].clone()).unwrap(),
        },
    );
    setup::set_player_count(3);
    for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
        sim.add_player(
            &format!("name{i}"),
            Some(crate::FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            false,
        )
        .unwrap();
    }
    let tape:Vec<_>=case["frames"].as_array().unwrap().iter().map(|f|json!({"tick":f["public"]["tick"],"events":f["events"],"betweenSteps":input["actions"][f["action"].as_u64().unwrap() as usize]["kind"]!="step"})).collect();
    let event_case = json!({"name":case["name"],"completeNonemptyEventTape":tape});
    #[cfg(feature = "trusted-status-probes")]
    {
        sim.w.trace.1.enabled = true;
    }
    let mut refunds = 0;
    for f in case["frames"].as_array().unwrap() {
        let a = &input["actions"][f["action"].as_u64().unwrap() as usize];
        #[cfg(feature = "trusted-status-probes")]
        {
            sim.w.trace.1.records.clear();
        }
        match a["kind"].as_str().unwrap() {
            "setupPlayer" => {
                let at = a.get("at").map(|v| point(&sim.k.arena.map, v));
                let path = a.get("path").map(|v| {
                    v.as_array()
                        .unwrap()
                        .iter()
                        .map(|v| point(&sim.k.arena.map, v))
                        .collect::<Vec<_>>()
                });
                let now = sim.server_time();
                let p = sim.w.players.get_mut(id(&a["actor"]).unwrap()).unwrap();
                if let Some(at) = at {
                    p.body.x = at.x;
                    p.body.y = at.y;
                    p.body.history.reset(crate::state::Sample {
                        t: now,
                        x: at.x,
                        y: at.y,
                    });
                    p.motion.slip = None;
                }
                if let Some(w) = a["weapon"].as_str() {
                    p.weapon.weapon0 = crate::WeaponId::parse(w);
                }
                if let Some(path) = path {
                    p.motion.path.set_from(&path);
                }
                if let Some(slide) = a.get("slide") {
                    p.motion.slip = Some(crate::systems::terrain::walk::new_slip(
                        p.pos(),
                        Vec2::new(num(&slide["vx"]), num(&slide["vy"])),
                    ));
                }
            }
            "step" | "queue" => {
                for proposal in a["inputs"].as_array().into_iter().flatten() {
                    let mut proposal = proposal.clone();
                    if let Some(anchor) = proposal["payload"].get("pointAnchor").cloned() {
                        proposal["payload"]
                            .as_object_mut()
                            .unwrap()
                            .remove("pointAnchor");
                        proposal["payload"]["point"] = json!(point(&sim.k.arena.map, &anchor));
                    }
                    enqueue(&mut sim, &proposal);
                }
                if a["kind"] == "step" {
                    let events = sim.step();
                    compare_events(&sim, &events, &event_case);
                }
            }
            other => panic!("unconsumed genuine arena action {other}"),
        }
        #[cfg(feature = "trusted-status-probes")]
        for h in &sim.w.trace.1.records {
            if let crate::status_runtime::probe::HookRecord::CastEnded {
                actor,
                ability: AbilityId::Freeze,
                reason: crate::status_runtime::CastEndReason::Cancelled,
            } = h
            {
                let cast = actor
                    .statuses
                    .cast
                    .expect("cancel hook observes canonical pending cast");
                let d = cast.producer.unwrap();
                assert_eq!(
                    (actor.stocks.wish_ready_at, actor.stocks.wish_full_at),
                    (45100., Some(45100.))
                );
                assert_eq!((d.previous_ready_at, d.previous_full_at), (50., Some(50.)));
                refunds += 1;
            }
        }
        let mut expected = f.clone();
        expected["tick"] = f["public"]["tick"].clone();
        expected["time"] = f["public"]["serverTime"].clone();
        expected["phase"] = f["public"]["phase"].clone();
        compare(&sim, &expected, "arena-genuine-refund", input);
        for (p, want) in sim
            .w
            .players
            .iter()
            .zip(f["private"]["players"].as_array().unwrap())
        {
            compare_value(
                &json!(p.motion.path.as_slice()),
                &want["path"],
                "arena source path",
            );
            compare_value(
                &json!(p.body.history.as_slice()),
                &want["history"],
                "arena source rewind",
            );
        }
        if sim.w.players.iter().any(|p| p.motion.slip.is_some()) {
            assert!(
                Sim::restore(serde_json::to_value(&sim).unwrap()).is_err(),
                "declared Off-slip helper is not an ordinary checkpoint"
            );
        } else {
            checkpoint(&mut sim, "arena genuine refund");
        }
    }
    #[cfg(feature = "trusted-status-probes")]
    assert_eq!(refunds, 1);
    #[cfg(not(feature = "trusted-status-probes"))]
    {
        let _ = &mut refunds;
    }
    assert_eq!(sim.w.players[1].stocks.wish_ready_at, 50.);
    assert_eq!(sim.w.players[1].stocks.wish_full_at, Some(50.));
    assert_eq!(sim.w.players[0].stocks.wish_ready_at, 150100.);
    assert!(sim
        .w
        .players
        .iter()
        .all(|p| p.statuses.cast.is_none() && p.statuses.instances.is_empty()));
}
