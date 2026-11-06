#![cfg(test)]
use super::*;
use crate::{pathfind::Pathfinder, state::Path, TileMap, Vec2};
use serde_json::{json, Value};
const FIXTURE_FNV: u64 = 0x1bdc136e62e37eb2;
fn corpus() -> Value {
    let bytes = include_bytes!("../../../../../parity/terrain/source.json");
    let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(
        hash, FIXTURE_FNV,
        "source witness must be explicitly recaptured"
    );
    let v: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(v["format"], "rh-terrain-source/1");
    v
}
pub(super) fn n(v: &Value, key: &str) -> f64 {
    v[key].as_f64().unwrap()
}
pub(super) fn point(v: &Value) -> Vec2 {
    Vec2::new(n(v, "x"), n(v, "y"))
}
pub(super) fn points(v: &Value) -> Vec<Vec2> {
    v.as_array().unwrap().iter().map(point).collect()
}
pub(super) fn faction(v: &Value) -> Option<crate::FactionId> {
    match v.as_str().unwrap() {
        "fire" => Some(crate::FactionId::Fire),
        "plague" => Some(crate::FactionId::Plague),
        "frost" => Some(crate::FactionId::Frost),
        "holy" => Some(crate::FactionId::Holy),
        "sentenced" => Some(crate::FactionId::Sentenced),
        "" => None,
        s => panic!("{s}"),
    }
}
fn fixture_map(d: &Value) -> TileMap {
    let w = d["w"].as_u64().unwrap() as u32;
    let h = d["h"].as_u64().unwrap() as u32;
    let layout = d["layout"].as_str().unwrap();
    let mut tiles = vec![u8::from(layout == "junction"); (w * h) as usize];
    let mut terrain = vec![0; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                tiles[i] = 1;
                continue;
            }
            if layout == "junction" && (y == 5 || x == 10 && (5..=12).contains(&y)) {
                tiles[i] = 0;
            }
            if layout == "wall" && x == 30 && y >= 3 {
                tiles[i] = 1;
            }
            if tiles[i] == 0 {
                terrain[i] = if layout == "stripe" {
                    if x < 12 {
                        6
                    } else if x < 20 {
                        5
                    } else if x < 28 {
                        4
                    } else {
                        7
                    }
                } else {
                    d["kind"].as_u64().unwrap() as u8
                };
            }
        }
    }
    TileMap::new(w, h, tiles)
        .unwrap()
        .source_terrain_fixture(terrain)
}
pub(super) fn close(got: f64, want: f64, label: &str) {
    assert!(
        (got - want).abs() <= 1e-9_f64.max(want.abs() * 1e-12),
        "{label}: {got} != {want}"
    );
}
pub(super) fn compare(got: &Value, want: &Value, label: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            close(a.as_f64().unwrap(), b.as_f64().unwrap(), label)
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label} {got} {want}");
            for (k, v) in b {
                compare(&a[k], v, &format!("{label}/{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{label}/{i}"));
            }
        }
        _ => assert_eq!(got, want, "{label}"),
    }
}
pub(super) fn slip_json(s: &crate::fighter::SlipState, path: &Path) -> Value {
    let mut v = json!({"vx":s.vx,"vy":s.vy,"ax":s.ax,"ay":s.ay,"path":s.path.map(|g|if g==path.generation{"current"}else{"other"}),"replanAt":s.replan_at.map_or(json!("-Infinity"),|x|json!(x))});
    for (k, x) in [
        ("stuckX", s.stuck_x),
        ("stuckY", s.stuck_y),
        ("stuckN", s.stuck_n),
        ("stuckBest", s.stuck_best),
        ("stuckAt", s.stuck_at),
        ("gripUntil", s.grip_until),
    ] {
        if let Some(x) = x {
            v[k] = json!(x);
        }
    }
    v
}
#[test]
fn terrain_shared_walk_matches_all_actual_source_frames() {
    let c = corpus();
    for case in c["walkCases"].as_array().unwrap() {
        let input = &case["input"];
        let map = fixture_map(&input["map"]);
        let mut pf = Pathfinder::default();
        let mut p = point(&input["body"]);
        let mut path = Path::default();
        if input["plan"] == true {
            path.set_from(&pf.find_path(&map, p, point(&input["goal"]), n(input, "radius")));
        } else {
            path.set_from(&points(&input["path"]));
        }
        let mut s = walk::new_slip(p, point(&input["velocity"]));
        s.replan_at = input["slip"]["replanAt"].as_f64();
        s.grip_until = input["slip"]["gripUntil"].as_f64();
        for (i, a) in input["actions"].as_array().unwrap().iter().enumerate() {
            if a["pathReplacement"].is_array() {
                path.set_from(&points(&a["pathReplacement"]));
            }
            let result = walk::walk(
                &map,
                &mut p,
                &mut s,
                &mut path,
                n(a, "dtMs"),
                n(a, "cap"),
                |x, y| terrain::at(&map, x, y, Some(crate::FactionId::Fire)).accel,
                n(a, "now"),
                n(input, "radius"),
                &mut pf,
            );
            let frame = &case["frames"][i + 1];
            let label = format!("{} {i}", case["name"]);
            compare(&json!(p), &frame["body"], &label);
            compare(&json!(path.as_slice()), &frame["path"], &label);
            compare(&slip_json(&s, &path), &frame["slip"], &label);
            compare(&json!(result), &frame["result"], &label);
        }
    }
}
#[test]
fn terrain_surface_and_sweep_match_actual_source() {
    let c = corpus();
    for case in c["surfaceCases"].as_array().unwrap() {
        let i = &case["input"];
        let e = if i["map"].is_object() {
            let map = fixture_map(&i["map"]);
            let h = terrain::Hazards::of(&map, Mode::Map);
            compare(
                &json!({"burn":h.burn,"slow":h.slow,"slip":h.slip,"heal":h.heal}),
                &case["expected"]["hazards"],
                case["name"].as_str().unwrap(),
            );
            terrain::at(
                &fixture_map(&i["map"]),
                n(i, "x"),
                n(i, "y"),
                faction(&i["faction"]),
            )
        } else {
            terrain::surface(i["kind"].as_u64().unwrap() as u8, faction(&i["faction"]))
        };
        let want = if case["expected"]["effect"].is_object() {
            &case["expected"]["effect"]
        } else {
            &case["expected"]
        };
        for (k, got) in [
            ("speedMult", e.speed),
            ("accel", e.accel),
            ("burnShare", e.burn),
            ("healShare", e.heal),
        ] {
            close(got, n(want, k), case["name"].as_str().unwrap());
        }
    }
    for case in c["sweepCases"].as_array().unwrap() {
        let i = &case["input"];
        let map = fixture_map(&i["map"]);
        let swap = i["axis"] == "y";
        let (x, y) = if swap {
            (n(i, "y"), n(i, "x"))
        } else {
            (n(i, "x"), n(i, "y"))
        };
        close(
            walk::sweep(&map, x, y, n(i, "delta"), n(i, "radius"), swap),
            case["expected"].as_f64().unwrap(),
            "sweep",
        );
    }
    for case in c["regripCases"].as_array().unwrap() {
        let i = &case["input"];
        let mut path = Path::default();
        path.set_from(&points(&i["path"]));
        let generation = path.generation;
        walk::regrip(
            &fixture_map(&i["map"]),
            point(&i["body"]),
            &mut path,
            &mut Pathfinder::default(),
        );
        compare(
            &json!({"path":path.as_slice(),"sameArray":generation==path.generation}),
            &case["expected"],
            "regrip",
        );
    }
}
#[cfg(feature = "trusted-status-probes")]
fn id(v: &Value) -> crate::PlayerId {
    crate::PlayerId(
        v.as_str()
            .unwrap()
            .strip_prefix('p')
            .unwrap()
            .parse::<u32>()
            .unwrap()
            + 1,
    )
}
#[cfg(feature = "trusted-status-probes")]
fn label(id: crate::PlayerId) -> String {
    format!("p{}", id.0 - 1)
}
#[cfg(feature = "trusted-status-probes")]
fn rows(v: &[(crate::PlayerId, f64)]) -> Value {
    json!(v.iter().map(|(id, x)| (label(*id), *x)).collect::<Vec<_>>())
}
#[cfg(feature = "trusted-status-probes")]
pub(super) fn with_cx(
    sim: &mut crate::Sim,
    ev: &mut Vec<Event>,
    stats: &[(crate::PlayerId, crate::status_runtime::StatView)],
    f: impl FnOnce(&mut Cx),
) {
    f(&mut Cx {
        stats: crate::status_runtime::stats::Inputs::supplied(stats),
        probe: None,
        k: &sim.k,
        w: &mut sim.w,
        s: &mut sim.s,
        ev,
        pf: &mut sim.pf,
    });
}
#[cfg(feature = "trusted-status-probes")]
#[test]
fn terrain_player_passes_match_actual_source() {
    let c = corpus();
    let mut covered = 0;
    let mut helper_only = Vec::new();
    for case in c["runtimeCases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut player_case = case.clone();
        if case["input"]["mobs"].is_array() {
            terrain_unadmitted_actor_helpers(case);
            helper_only.push(name);
            if name != "light-players-only-landed-stamps" {
                continue;
            }
            // In addition to NPC-only helper assertions, execute this case's complete
            // player light pass, landed stamps, clocks, stats and events through Sim.
            player_case["input"].as_object_mut().unwrap().remove("mobs");
            for frame in player_case["frames"].as_array_mut().unwrap() {
                frame["fighters"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|f| f["kind"] == "player");
            }
        }
        let case = &player_case;
        let input = &case["input"];
        covered += 1;
        let default_players = json!([{"faction":"frost","at":{"x":144,"y":272}},{"faction":"fire","at":{"x":528,"y":272}},{"faction":"holy","at":{"x":912,"y":272}}]);
        let specs = input["players"]
            .as_array()
            .unwrap_or(default_players.as_array().unwrap());
        let placements: Vec<_> = specs
            .iter()
            .enumerate()
            .map(|(i, p)| crate::Placement {
                profile: format!("player{i}"),
                faction: faction(&p["faction"]).unwrap(),
                bot: false,
                at: point(&p["at"]),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let map = fixture_map(&input["map"]);
        let arena = crate::Arena {
            spawns: (0..8)
                .map(|i| Vec2::new((2 + i) as f64 * 32. + 16., 80.))
                .collect(),
            map,
        };
        let mode = if input["hazards"] == false {
            Mode::Off
        } else if input["hazards"] == "all" {
            Mode::All
        } else {
            Mode::Map
        };
        let mut sim = crate::Sim::reset_active(
            crate::SimConfig {
                hazards: mode,
                pvp_rules: false,
                ..Default::default()
            },
            arena,
            crate::Secrets::from_seed(3),
            &placements,
        );
        sim.w.server_time = input["setup"]["now"].as_f64().unwrap_or(0.);
        sim.w.tick = 0;
        sim.w.raid_started_at = 0.;
        sim.w.terrain = Default::default();
        sim.w.rt.gates_locked = input["setup"]["gatesLocked"] == true;
        let mut stats = Vec::new();
        for (i, p) in specs.iter().enumerate() {
            let core = &mut sim.w.players[i];
            let st = &p["state"];
            core.vitals.immune_until = st["immuneUntil"].as_f64().unwrap_or(0.);
            if let Some(h) = st["maxHp"].as_f64() {
                core.vitals.max_hp = h;
            }
            if let Some(h) = st["hp"].as_f64() {
                core.vitals.hp = h;
            }
            core.vitals.barrier = st["barrier"].as_f64().unwrap_or(0.);
            if st["status"] == "dead" {
                core.status = crate::Status::Dead;
            }
            let at = core.pos();
            core.body.history.reset(crate::state::Sample {
                t: 0.,
                x: at.x,
                y: at.y,
            });
            if let Some(h) = p["history"].as_array() {
                core.body.history = serde_json::from_value(json!(h)).unwrap();
            }
            if p["path"].is_array() {
                core.motion.path.set_from(&points(&p["path"]));
            }
            let mut view = crate::status_runtime::StatView::default();
            if let Some(rs) = p["rows"].as_array() {
                for r in rs {
                    match r["stat"].as_str().unwrap() {
                        "slowResist" => view.slow_resist = n(r, "v"),
                        "healTaken" => view.heal_taken_mult = (1. + n(r, "v")).max(0.),
                        x => panic!("{x}"),
                    }
                }
            }
            stats.push((core.id, view));
            if let Some(sts) = p["statuses"].as_array() {
                for st in sts {
                    assert_eq!(st["kind"], "deathFloor");
                    let core_id = core.id;
                    core.statuses
                        .instances
                        .push(crate::status_runtime::StatusInstance {
                            kind: crate::status_runtime::StatusKind::DeathFloor,
                            source: crate::status_runtime::StatusSource {
                                id: Some(core_id),
                                owner_id: None,
                                name: "p0".into(),
                            },
                            ability: None,
                            tag: None,
                            started_at: n(st, "startedAt"),
                            until: n(st, "until"),
                            value: n(st, "value"),
                            reveal_from: None,
                            taken: st["taken"].as_f64(),
                            data: crate::status_runtime::Payload {
                                floor_hp: st["floorHp"].as_f64(),
                                ..Default::default()
                            },
                        });
                }
            }
        }
        if let Some(age) = input["setup"]["recentRival"]["age"].as_f64() {
            sim.w.players[0].credit.last_hit = Some((crate::PlayerId(2), sim.w.server_time - age));
        }
        let mut ev = Vec::new();
        let mut extra_base = 1.;
        for (ai, a) in input["actions"].as_array().unwrap().iter().enumerate() {
            let dt = a["dtMs"].as_f64().unwrap_or(TICK_MS);
            if let Some(now) = a["now"].as_f64() {
                sim.w.server_time = now;
            }
            for (key, faction_clock) in [("terrainClock", false), ("factionClock", true)] {
                if let Some(rs) = a[key].as_array() {
                    for r in rs {
                        let actor = id(&r[0]);
                        let at = r[1].as_f64().unwrap();
                        if faction_clock {
                            sim.w.players.get_mut(actor).unwrap().signature.combat_at = Some(at);
                        } else {
                            terrain::stamp(&mut sim.w.terrain.combat_at, actor, at);
                        }
                    }
                }
            }
            if let Some(rs) = a["lightAcc"].as_array() {
                for r in rs {
                    terrain::stamp(
                        &mut sim.w.terrain.light_acc,
                        id(&r[0]),
                        r[1].as_f64().unwrap(),
                    );
                }
            }
            if let Some(t) = a["lightSince"].as_f64() {
                sim.w.terrain.light_since = t;
            }
            let kind = a["kind"].as_str().unwrap(); // Source harness reinserts each step drain into world.events; step frames accumulate it.
            if kind != "step" {
                ev.clear();
                sim.s.ledger.clear();
                sim.s.landed.clear();
            }
            match kind {
                "burn" => {
                    with_cx(&mut sim, &mut ev, &stats, |cx| {
                        super::super::settle::mark_tick_start(cx);
                        if let Some(hits) = a["hits"].as_array() {
                            for h in hits {
                                ledger::record_hit(
                                    cx.w,
                                    &mut cx.s.ledger,
                                    ledger::Entry {
                                        terrain: false,
                                        dot: false,
                                        ability: None,
                                        arena: false,
                                        source: None,
                                        critical: false,
                                        critical_mult: None,
                                        sig: None,
                                        execute: false,
                                        victim: h
                                            .get("victim")
                                            .map(id)
                                            .unwrap_or(crate::PlayerId(1)),
                                        by: Some(h.get("by").map(id).unwrap_or(crate::PlayerId(2))),
                                        packet: Packet {
                                            raw: n(h, "raw"),
                                            phys: 0.,
                                            magic: 0.,
                                            true_: 1.,
                                        },
                                        weapon: Some(WeaponId::Sword),
                                        stagger: false,
                                        projectile: None,
                                        scale: 1.,
                                        derived: false,
                                        passive: false,
                                    },
                                );
                            }
                        }
                        burn_dt(cx, dt);
                        super::super::ledger::apply_probed(
                            cx,
                            &mut crate::status_runtime::probe::HurtRecipe {
                                victim: None,
                                operations: vec![],
                            },
                        );
                    });
                }
                "light" => {
                    if let Some(landed) = a["landed"].as_array() {
                        for h in landed {
                            sim.s.landed.push(super::super::signatures::LandedHit {
                                critical: false,
                                cut: 1.,
                                ability: None,
                                dot: false,
                                sig: None,
                                weapon: None,
                                victim: id(&h["victim"]),
                                by: Some(id(&h["by"])),
                                amount: n(h, "amount"),
                            });
                        }
                    }
                    with_cx(&mut sim, &mut ev, &stats, |cx| light_dt(cx, dt));
                }
                "bog" => {
                    let actor = a.get("id").map(id).unwrap_or(crate::PlayerId(1));
                    let ix = sim.w.fighter_idx(actor).unwrap();
                    let value = bog(&sim.k, &mut sim.w, ix, dt, stats[ix.slot()].1);
                    let mods = &case["frames"][ai + 1]["events"][0]["probe"]["modifiers"];
                    close(
                        value,
                        mods.as_array().unwrap().last().unwrap().as_f64().unwrap(),
                        name,
                    );
                    extra_base = a["base"].as_f64().unwrap_or(1.);
                }
                "walk" => {
                    let actor = a.get("id").map(id).unwrap_or(crate::PlayerId(1));
                    let ix = sim.w.fighter_idx(actor).unwrap();
                    super::super::movement::walk_one(
                        &sim.k,
                        &mut sim.w,
                        ix,
                        &mut sim.pf,
                        dt,
                        Some(a["keepFacing"].as_bool().unwrap_or(false)),
                        a["speedMult"].as_f64().unwrap_or(1.),
                    );
                }
                "step" if dt == TICK_MS => {
                    if let Some(inputs) = a["inputs"].as_array() {
                        for command in inputs {
                            assert_eq!(command["type"], "move");
                            let p = point(&command["payload"]);
                            let cmd = crate::validate(crate::RawCommand::Move {
                                x: p.x,
                                y: p.y,
                                seq: Some(0),
                            })
                            .unwrap();
                            sim.submit(id(&command["id"]), cmd).unwrap();
                        }
                    }
                    ev.extend(sim.step());
                }
                "step" => {
                    assert!(name.starts_with("bog-resist"));
                    sim.w.server_time += dt;
                    sim.w.tick += 1;
                    let ix = FighterIx::of_slot(0);
                    let m = bog(&sim.k, &mut sim.w, ix, dt, stats[0].1) * extra_base;
                    let m = super::super::movement::floor_multiplier(m);
                    super::super::movement::walk_one(
                        &sim.k,
                        &mut sim.w,
                        ix,
                        &mut sim.pf,
                        dt,
                        None,
                        m,
                    );
                    let p = &mut sim.w.players[0];
                    let at = p.pos();
                    p.body.history.record(sim.w.server_time, at.x, at.y);
                }
                x => panic!("unconsumed runtime action {x}"),
            }
            let frame = &case["frames"][ai + 1];
            let context = format!("{name}/{ai}");
            for (i, want) in frame["fighters"].as_array().unwrap().iter().enumerate() {
                let p = &sim.w.players[i];
                let st = &want["state"];
                for (k, got) in [
                    ("x", p.body.x),
                    ("y", p.body.y),
                    ("facing", p.body.facing),
                    ("hp", p.vitals.hp),
                    ("maxHp", p.vitals.max_hp),
                    ("barrier", p.vitals.barrier),
                    ("kills", p.credit.kills as f64),
                    ("bounty", p.credit.bounty as f64),
                    ("immuneUntil", p.vitals.immune_until),
                ] {
                    close(got, n(st, k), &format!("{context}/{i}/{k}"));
                }
                assert_eq!(
                    p.status == crate::Status::Alive,
                    st["status"] == "alive",
                    "{context}"
                );
                assert_eq!(
                    p.vitals.faction.as_str(),
                    st["faction"].as_str().unwrap(),
                    "{context}"
                );
                let statuses = p.statuses.instances.iter().map(|s| {
                    assert_eq!(s.kind,crate::status_runtime::StatusKind::DeathFloor);
                    let mut v=json!({"kind":"deathFloor","source":{"id":s.source.id.map(label),"name":s.source.name},"startedAt":s.started_at,"until":s.until,"value":s.value});
                    if let Some(x)=s.data.floor_hp {v["floorHp"]=json!(x);}
                    if let Some(x)=s.taken {v["taken"]=json!(x);}
                    assert!(s.ability.is_none() && s.tag.is_none() && s.reveal_from.is_none());
                    v
                }).collect::<Vec<_>>();
                compare(
                    &json!(statuses),
                    &want["private"]["statuses"],
                    &format!("{context}/statuses"),
                );
                compare(
                    &json!({"kills":p.credit.gv_parts.kills,"mobs":p.credit.gv_parts.mobs,"bounty":p.credit.gv_parts.bounty,"quest":p.credit.gv_parts.quest}),
                    &want["private"]["gv"],
                    &context,
                );
                compare(
                    &json!(p
                        .down
                        .map(|d| json!({"outcome":format!("{d:?}").to_lowercase()}))),
                    &want["private"]["down"],
                    &context,
                );
                assert_eq!(p.resolved, want["private"]["resolved"] == true, "{context}");
                compare(
                    &json!(p.motion.path.as_slice()),
                    &want["private"]["path"],
                    &context,
                );
                compare(
                    &json!(p.body.history.as_slice()),
                    &want["private"]["history"],
                    &context,
                );
                compare(
                    &json!(p
                        .credit
                        .last_hit
                        .map(|(by, at)| json!({"by":label(by),"at":at}))),
                    &want["private"]["lastHit"],
                    &context,
                );
                let expected_slip = &want["private"]["slip"];
                assert_eq!(
                    p.motion.slip.is_some(),
                    !expected_slip.is_null(),
                    "{context}"
                );
                if let Some(s) = &p.motion.slip {
                    for (k, v) in [("vx", s.vx), ("vy", s.vy), ("ax", s.ax), ("ay", s.ay)] {
                        close(v, n(expected_slip, k), &context);
                    }
                    for (k, v) in [
                        ("replanAt", s.replan_at),
                        ("stuckX", s.stuck_x),
                        ("stuckY", s.stuck_y),
                        ("stuckN", s.stuck_n),
                        ("stuckBest", s.stuck_best),
                        ("stuckAt", s.stuck_at),
                        ("gripUntil", s.grip_until),
                    ] {
                        if k == "replanAt" {
                            compare(
                                &v.map_or(json!("-Infinity"), |x| json!(x)),
                                &expected_slip[k],
                                &context,
                            );
                        } else {
                            compare(&json!(v), &expected_slip[k], &context);
                        }
                    }
                    assert_eq!(
                        s.path == Some(p.motion.path.generation),
                        want["private"]["slipPathIdentity"] == true,
                        "{context}"
                    );
                }
                let killer = p
                    .fate
                    .killed_by_name
                    .as_deref()
                    .map(str::to_owned)
                    .or_else(|| {
                        p.fate
                            .killed_by
                            .and_then(|id| sim.player_name(id).map(str::to_owned))
                    });
                compare(&json!(killer), &want["private"]["killedBy"], &context);
                close(
                    p.credit.gv_parts.kills as f64,
                    n(&want["private"]["gv"], "kills"),
                    &context,
                );
            }
            compare(
                &json!({"lightAcc":rows(&sim.w.terrain.light_acc),"lightSince":sim.w.terrain.light_since,"combatAt":rows(&sim.w.terrain.combat_at)}),
                &frame["terrain"],
                &context,
            );
            compare(
                &json!({"damage":sim.w.terrain.damage.iter().map(|(id,x)|json!([label(*id),{"ember":x}])).collect::<Vec<_>>(),"seconds":{"ember":sim.w.terrain.seconds[0],"bog":sim.w.terrain.seconds[1],"ice":sim.w.terrain.seconds[2],"light":sim.w.terrain.seconds[3]},"heal":rows(&sim.w.terrain.heal)}),
                &frame["stats"],
                &context,
            );
            let got: Vec<_> = ev
                .iter()
                .filter_map(|e| {
                    if let Event::Heal { id, amount } = e {
                        Some(json!({"id":label(*id),"amount":amount}))
                    } else {
                        None
                    }
                })
                .collect();
            let want: Vec<_> = frame["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["fx"]["kind"] == "heal")
                .map(|e| json!({"id":e["fx"]["id"],"amount":e["fx"]["amount"]}))
                .collect();
            compare(&json!(got), &json!(want), &context);
            assert!(sim.s.ledger.is_empty(), "{context}");
            let landed: Vec<_> = sim
                .s
                .landed
                .iter()
                .map(|h| {
                    let mut v =
                        json!({"victim":label(h.victim),"by":h.by.map(label),"amount":h.amount});
                    if let Some(weapon) = h.weapon {
                        v["weapon"] = json!(weapon.as_str());
                    }
                    v
                })
                .collect();
            compare(&json!(landed), &frame["landed"], &context);
            let expected_events: Vec<_> = frame["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| !e["probe"].is_object())
                .cloned()
                .collect();
            compare(
                &json!(ev.iter().map(source_event).collect::<Vec<_>>()),
                &json!(expected_events),
                &context,
            );
        }
    }
    assert_eq!(covered, 62);
    assert_eq!(
        helper_only,
        vec![
            "ember-mob-filters-locked-false",
            "ember-mob-filters-locked-true",
            "light-players-only-landed-stamps",
            "reset-teleported",
            "reset-raidStarted"
        ],
        "all five unadmitted actor cases require explicit helper assertions; full ordinary training/arena producer coverage remains pending"
    );
}

#[cfg(feature = "trusted-status-probes")]
fn source_event(e: &Event) -> Value {
    match e {
        Event::Heal { id, amount } => {
            json!({"type":"fx","fx":{"kind":"heal","id":label(*id),"amount":amount}})
        }
        Event::Death { id, x, y, by } => {
            json!({"type":"fx","fx":{"kind":"death","id":label(*id),"x":x,"y":y,"by":by.map(label)}})
        }
        Event::Hit {
            victim,
            by,
            amount,
            weapon,
            passive,
        } => {
            assert!(!passive);
            json!({"type":"fx","fx":{"kind":"hit","id":label(*victim),"by":by.map(label),"amount":amount,"weapon":weapon.map(|w|w.as_str())}})
        }
        Event::Gv { id, amount, reason } => {
            json!({"type":"gv","id":label(*id),"amount":amount,"reason":match reason{crate::results::GvReason::Kill=>"kill",crate::results::GvReason::Bounty=>"bounty",r=>panic!("unconsumed GV {r:?}")}})
        }
        Event::Resolved { id, result, .. } => {
            let mut r = json!({"outcome":match result.outcome{crate::results::Outcome::Died=>"died",crate::results::Outcome::Won=>"won",o=>panic!("unconsumed outcome {o:?}")},"profile":result.profile,"durationSec":result.duration_sec,"kills":result.kills,"killedBy":result.killed_by,"place":result.place,"players":result.players,"gv":result.gv,"winBonusWithheld":result.win_bonus_withheld});
            if let Some(why) = result.win_bonus_why {
                r["winBonusWhy"] = json!(match why {
                    crate::results::WinBonusWhy::Starters => "starters",
                    crate::results::WinBonusWhy::Opponents => "opponents",
                });
            }
            json!({"type":"resolved","id":label(*id),"result":r})
        }
        Event::Victory { id, draw } => {
            json!({"type":"fx","fx":{"kind":"victory","id":id.map(label),"draw":draw,"name":id.map(|v|format!("player{}",v.0-1))}})
        }
        Event::RaidEnded => json!({"type":"raidEnded"}),
        other => panic!("unconsumed native event {other:?}"),
    }
}
#[test]
fn terrain_velocity_and_slow_math_match_actual_source() {
    let c = corpus();
    for case in c["velocityCases"].as_array().unwrap() {
        let history: Vec<crate::state::Sample> =
            serde_json::from_value(case["input"]["history"].clone()).unwrap();
        compare(
            &json!(super::super::movement::tick_velocity(&history)),
            &case["expected"],
            "history velocity",
        );
    }
    for case in c["mathCases"].as_array().unwrap() {
        let i = &case["input"];
        let actual = match case["function"].as_str().unwrap() {
            "slipAccel" => terrain::slip_accel(n(i, "ms")),
            "resistSlow" => crate::status_runtime::resist_slow(n(i, "speedMult"), n(i, "resist")),
            other => panic!("unconsumed math case {other}"),
        };
        close(actual, case["expected"].as_f64().unwrap(), "source math");
    }
}

/// These five original cases contain hand-placed/unadmitted actors (including dummies).
/// Compare their owned production leaves, never forge native NPC birth provenance.
/// Actual whole-world regional coverage is the separate 21-case born-source consumer.
#[cfg(feature = "trusted-status-probes")]
fn terrain_unadmitted_actor_helpers(case: &Value) {
    let input = &case["input"];
    let name = case["name"].as_str().unwrap();
    let map = fixture_map(&input["map"]);
    if name.starts_with("ember-mob-filters") {
        let dt = n(&input["actions"][0], "dtMs") / 1000.;
        let locked = input["setup"]["gatesLocked"] == true;
        let last = &case["frames"][1];
        let damage = last["stats"]["damage"].as_array().unwrap();
        let players = case["frames"][0]["fighters"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["kind"] == "player")
            .count();
        for (i, m) in input["mobs"].as_array().unwrap().iter().enumerate() {
            let dummy = m["kind"] == "dummy";
            let at = point(&m["at"]);
            let f = if dummy { None } else { faction(&m["faction"]) };
            let e = terrain::at(&map, at.x, at.y, f);
            let actual = terrain::burn_share(e, true, dummy, m["mode"] == "return", locked) * dt;
            let expected = &last["fighters"][players + i];
            let id = &expected["id"];
            let hp = damage
                .iter()
                .find(|r| r[0] == *id)
                .map_or(0., |r| n(&r[1], "ember"));
            close(actual, hp / n(&expected["state"], "maxHp"), name);
        }
    } else if name == "light-players-only-landed-stamps" {
        for m in input["mobs"].as_array().unwrap() {
            let at = point(&m["at"]);
            let f = if m["kind"] == "dummy" {
                None
            } else {
                faction(&m["faction"])
            };
            let share = terrain::light_share(terrain::at(&map, at.x, at.y, f), false);
            for frame in case["frames"].as_array().unwrap().iter().skip(1) {
                let actual_heal = frame["stats"]["heal"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|r| r[0].as_str().unwrap().starts_with("mob"))
                    .map(|r| r[1].as_f64().unwrap())
                    .sum::<f64>();
                close(share, actual_heal, name);
            }
        }
    } else {
        assert!(name == "reset-teleported" || name == "reset-raidStarted");
        let mut rt = terrain::Runtime::default();
        rt.light_acc.push((crate::PlayerId(1), 2.));
        rt.combat_at.push((crate::PlayerId(1), 123.));
        let last = &case["frames"][1];
        for f in last["fighters"].as_array().unwrap() {
            let mut slip = Some(walk::new_slip(Vec2::new(10., 20.), Vec2::new(30., 40.)));
            terrain::clear_slip(&mut slip);
            assert_eq!(slip.is_none(), f["private"]["slip"].is_null(), "{name}");
        }
        if name == "reset-raidStarted" {
            terrain::reset_light(&mut rt, 0.);
        }
        compare(
            &json!({"lightAcc":rows(&rt.light_acc),"lightSince":rt.light_since,"combatAt":rows(&rt.combat_at)}),
            &last["terrain"],
            name,
        );
    }
}
