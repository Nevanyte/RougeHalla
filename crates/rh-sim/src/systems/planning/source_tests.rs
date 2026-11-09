//! Owned planning lifecycle fields against immutable actual-source ordinary-step captures.
//! Nonempty boon case is explicitly a helper and is never admitted as an ordinary restored world.
use super::*;
use crate::{Arena, FactionId, RawCommand, Secrets, Sim, SimConfig, TileMap};
use serde_json::{json, Value};
fn id(v: &Value) -> PlayerId {
    PlayerId(
        v.as_str()
            .unwrap()
            .strip_prefix('p')
            .unwrap()
            .parse::<u32>()
            .unwrap()
            + 1,
    )
}
fn label(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn same(got: Value, want: &Value, where_: &str) {
    match (&got, want) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64(), "{where_}"),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{where_}/length");
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                same(x.clone(), y, &format!("{where_}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{where_}/keys"
            );
            for (k, x) in a {
                same(x.clone(), &b[k], &format!("{where_}/{k}"));
            }
        }
        _ => assert_eq!(&got, want, "{where_}"),
    }
}
fn arena(source: &Value, input: &Value) -> Arena {
    if input["map"] == "no-pool" {
        let (w, h) = (40, 24);
        let mut tiles = vec![0; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                    tiles[(y * w + x) as usize] = crate::map::TILE_WALL;
                }
            }
        }
        return Arena {
            map: TileMap::new(w, h, tiles).unwrap(),
            spawns: vec![
                Vec2::new(112., 112.),
                Vec2::new(624., 624.),
                Vec2::new(112., 624.),
            ],
        };
    }
    let mut export = source["map"]["export"].clone();
    if let Some(indices) = input["poolIndices"].as_array() {
        let old = export["map"]["spawnPool"].clone();
        let pool: Vec<_> = indices
            .iter()
            .map(|i| old[i.as_u64().unwrap() as usize].clone())
            .collect();
        export["map"]["spawnPool"] = json!(pool);
        let regions = export["map"]["regions"].as_array_mut().unwrap();
        for r in regions.iter_mut() {
            r["spawns"] = json!(pool
                .iter()
                .filter(|p| p["zone"] == r["id"])
                .map(|p| json!({"x":p["x"],"y":p["y"]}))
                .collect::<Vec<_>>());
        }
        let mut spawns = vec![];
        for i in 0..regions
            .iter()
            .map(|r| r["spawns"].as_array().unwrap().len())
            .max()
            .unwrap_or(0)
        {
            for r in regions.iter() {
                if let Some(p) = r["spawns"].get(i) {
                    spawns.push(p.clone());
                }
            }
        }
        export["map"]["spawns"] = json!(spawns);
    }
    let export: crate::mapdata::MapExport = serde_json::from_value(export).unwrap();
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}
pub(super) fn make(source: &Value, input: &Value) -> Sim {
    assert!(["core", "roster"].contains(&input["profile"].as_str().unwrap()));
    let roster = input["profile"] == "roster";
    let c = &input["config"];
    let schedule = c.get("coliseumSchedule").map(|s| crate::ColiseumSchedule {
        first_seconds: num(&s["firstSeconds"]),
        second_seconds: num(&s["secondSeconds"]),
        repeat_seconds: num(&s["repeatSeconds"]),
        min_gap_seconds: num(&s["minGapSeconds"]),
    });
    let rules = crate::ArenaRules {
        plan_seconds: c["planSeconds"].as_f64().unwrap_or(0.),
        first_patience_seconds: c["firstPatienceSeconds"].as_f64(),
        coliseum_schedule: schedule,
        patience_seconds: c["patienceSeconds"].as_f64().unwrap_or(3600.),
        patience_min_seconds: c["patienceMinSeconds"].as_f64().unwrap_or(3600.),
        sudden_death_seconds: c["suddenDeathSeconds"].as_f64().unwrap_or(60.),
    };
    Sim::new(
        SimConfig {
            quests: false,
            consumables: false,
            min_players: input["players"].as_array().unwrap().len(),
            lobby_seconds: 30.,
            fill_seconds: 0.,
            hazards: crate::terrain::Mode::Off,
            lifecycle: crate::ArenaMode::Source(rules),
            initial_loot: roster,
            // The recorded arena capture profiles list no `consumables` installer: no travel cannons there.
            mob_mode: if roster {
                crate::mob_runtime::MobMode::Pve
            } else {
                crate::mob_runtime::MobMode::Off
            },
            ..Default::default()
        },
        arena(source, input),
        Secrets {
            order_salt: 0,
            spawn_seed: input["mainSeed"].as_u64().unwrap() as u32,
            reward_salt: std::array::from_fn(|i| input["rewardSalt"][i].as_u64().unwrap() as u32),
        },
    )
}
fn index(p: &Value, k: &str) -> Result<Option<u8>, ()> {
    match p.get(k) {
        None => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|v| *v <= 1)
            .map(|v| Some(v as u8))
            .ok_or(()),
    }
}
fn send(sim: &mut Sim, input: &Value) -> bool {
    let p = &input["payload"];
    let raw = match input["type"].as_str().unwrap() {
        "plan" => {
            let Ok(spawn) = index(p, "spawn") else {
                return false;
            };
            let Ok(boon) = index(p, "boon") else {
                return false;
            };
            let ready = match p.get("ready") {
                None => None,
                Some(v) => {
                    let Some(b) = v.as_bool() else {
                        return false;
                    };
                    Some(b)
                }
            };
            RawCommand::Plan { spawn, boon, ready }
        }
        "move" => RawCommand::Move {
            x: num(&p["x"]),
            y: num(&p["y"]),
            seq: None,
        },
        "attack" => RawCommand::Attack {
            a: num(&p["a"]),
            t: None,
        },
        "target" => RawCommand::Target { id: id(&p["id"]) },
        other => panic!("unconsumed planning command {other}"),
    };
    match crate::validate(raw) {
        Err(_) => false,
        Ok(cmd) => {
            let result = sim.submit(id(&input["actor"]), cmd);
            assert!(
                matches!(result, Ok(()) | Err(crate::Reject::QueueFull)),
                "source fixture unexpectedly hit native seat rate limit: {result:?}"
            );
            true
        }
    }
}
fn plans(sim: &Sim) -> Value {
    json!(sim
        .w
        .players
        .iter()
        .map(|p| json!({"id":label(p.id),"plan":plan_for(&sim.w,p.id)}))
        .collect::<Vec<_>>())
}
fn planning(sim: &Sim) -> Value {
    sim.w.planning.as_ref().map_or(Value::Null,|p|json!({"deals":p.deals.iter().map(|(id,d)|json!([label(*id),{"spawns":d.spawns,"pick":d.pick,"boons":d.boons,"boon":d.boon,"sent":d.sent}])).collect::<Vec<_>>(),"holders":p.holders.iter().map(|(i,id)|json!([i,label(*id)])).collect::<Vec<_>>(),"report":p.report,"starters":p.starters,"startedHumans":p.started_humans}))
}
fn expected_planning(v: &Value) -> Value {
    if v.is_null() {
        return Value::Null;
    }
    let mut out = v.clone();
    if let Some(deals) = out["deals"].as_array_mut() {
        for row in deals {
            let text = row[1]["sent"].as_str().unwrap();
            row[1]["sent"] = if text.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(text).unwrap()
            };
        }
    }
    out
}
fn rng(sim: &Sim, case: &Value, f: &Value, ctx: &str) {
    let mut main = crate::rng::Mulberry32::new(case["input"]["mainSeed"].as_u64().unwrap() as u32);
    let mut reward = super::tests::reward(&case["input"]);
    for (name, count) in [
        ("main", f["rng"]["main"].as_u64().unwrap()),
        ("reward", f["rng"]["reward"].as_u64().unwrap()),
    ] {
        let tape: Vec<_> = case["randomTape"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["stream"] == name)
            .collect();
        for draw in tape.iter().take(count as usize) {
            let n = if name == "main" {
                main.next_f64()
            } else {
                reward.next_f64()
            };
            assert_eq!(n, num(&draw["value"]), "{ctx}/{name} source tape");
        }
    }
    assert_eq!(sim.w.spawn_rng, main, "{ctx}/main stream");
    assert_eq!(sim.w.reward_rng, reward, "{ctx}/reward stream");
    assert_eq!(f["rng"]["quest"], 0, "{ctx}/quest unused");
}
fn snapshot(sim: &Sim, case: &Value, f: &Value, ctx: &str) {
    let w = &sim.w;
    let public = &f["public"];
    for (key, value) in [
        ("phase", json!(format!("{:?}", w.phase).to_lowercase())),
        ("tick", json!(w.tick)),
        ("serverTime", json!(w.server_time)),
        ("lobbyEndsAt", json!(w.lobby_ends_at)),
        ("planEndsAt", json!(w.plan_ends_at)),
        ("raidStartedAt", json!(w.raid_started_at)),
        (
            "patienceEndsAt",
            w.rt.patience_ends_at.map_or_else(
                || {
                    if w.phase == crate::Phase::Active && !w.rt.gates_locked {
                        json!({"$float":"Infinity"})
                    } else {
                        json!(0)
                    }
                },
                |v| json!(v),
            ),
        ),
        ("inColiseum", json!(w.rt.in_coliseum)),
        ("gatesLocked", json!(w.rt.gates_locked)),
        ("suddenDeathAt", json!(w.rt.sudden_death_at)),
        (
            "startedWith",
            json!(if w.raid_started_at > 0. {
                w.rt.started_with
            } else {
                0
            }),
        ),
        (
            "winner",
            json!(w
                .winner
                .and_then(|id| w.roster.name(id))
                .unwrap_or_default()),
        ),
    ] {
        same(value, &public[key], &format!("{ctx}/{key}"));
    }
    same(
        planning(sim),
        &expected_planning(&f["private"]["planning"]),
        &format!("{ctx}/planning"),
    );
    same(plans(sim), &f["ownerPlans"], &format!("{ctx}/owner plans"));
    same(
        json!({"startedWith":w.rt.started_with,"startedHumans":w.rt.started_humans,"downsBetweenTicks":w.rt.downs_between_ticks,"voided":w.rt.voided}),
        &json!({"startedWith":f["private"]["arena"]["startedWith"],"startedHumans":f["private"]["arena"]["startedHumans"],"downsBetweenTicks":f["private"]["arena"]["downsBetweenTicks"],"voided":f["private"]["arena"]["voided"]}),
        &format!("{ctx}/arena"),
    );
    assert_eq!(
        w.players.len(),
        public["players"].as_array().unwrap().len(),
        "{ctx}/player count"
    );
    for (p, expected) in w.players.iter().zip(public["players"].as_array().unwrap()) {
        assert_eq!(label(p.id), expected["id"].as_str().unwrap());
        let e = &expected["state"];
        for (key, value) in [
            ("x", json!(p.body.x)),
            ("y", json!(p.body.y)),
            ("facing", json!(p.body.facing)),
            ("hp", json!(p.vitals.hp)),
            ("maxHp", json!(p.vitals.max_hp)),
            ("barrier", json!(p.vitals.barrier)),
            ("status", json!(format!("{:?}", p.status).to_lowercase())),
            (
                "faction",
                json!(p
                    .vitals
                    .faction
                    .faction_id()
                    .expect("declared faction actor")
                    .as_str()),
            ),
            ("planReady", json!(p.plan_ready)),
            ("kills", json!(p.credit.kills)),
            ("bounty", json!(p.credit.bounty)),
            ("immuneUntil", json!(p.vitals.immune_until)),
        ] {
            same(value, &e[key], &format!("{ctx}/{}/{key}", label(p.id)));
        }
        let private = f["private"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|q| q["id"] == expected["id"])
            .unwrap();
        for (key, value) in [
            (
                "weapon0",
                json!(p.weapon.weapon0.map_or("", |v| v.as_str())),
            ),
            (
                "weapon1",
                json!(p.weapon.weapon1.map_or("", |v| v.as_str())),
            ),
            ("slot", json!(p.weapon.slot)),
            ("readyAt", json!(p.weapon.ready_at)),
            ("drawStartedAt", json!(p.weapon.draw_started_at)),
            ("gv", json!(p.credit.gv)),
            ("mobKills", json!(p.credit.mob_kills)),
        ] {
            same(value, &e[key], &format!("{ctx}/{key}"));
        }
        same(
            json!(p.body.history.as_slice()),
            &private["history"],
            &format!("{ctx}/history"),
        );
        weapon_state(&p.weapon, &private["weapon"], ctx);
        assert!(
            p.motion.slip.is_none(),
            "{ctx}/owned ordinary profile has no slide producer"
        );
        same(Value::Null, &private["slip"], &format!("{ctx}/slip"));
        same(
            json!(p
                .credit
                .last_hit
                .map(|(id, at)| json!({"by":label(id),"at":at}))),
            &private["lastHit"],
            &format!("{ctx}/last hit"),
        );
        same(
            json!(p
                .credit
                .damaged
                .iter()
                .map(|id| label(*id))
                .collect::<Vec<_>>()),
            &private["damaged"],
            &format!("{ctx}/damaged"),
        );
        assert!(
            p.statuses.instances.is_empty(),
            "{ctx}/owned baseline has no statuses"
        );
        assert!(
            private
                .get("statuses")
                .is_none_or(|v| v.as_array().is_some_and(|a| a.is_empty())),
            "{ctx}/unconsumed source status"
        );

        same(
            json!(p.seat.dropped_at),
            &private["droppedAt"],
            &format!("{ctx}/dropped"),
        );
        same(
            json!(p.resolved),
            &private["resolved"],
            &format!("{ctx}/resolved"),
        );
        same(
            json!(p
                .down
                .map(|v| json!({"outcome":format!("{v:?}").to_lowercase()}))),
            &private["down"],
            &format!("{ctx}/down"),
        );
        same(
            json!(p
                .fate
                .killed_by_name
                .as_deref()
                .or_else(|| p.fate.killed_by.and_then(|id| sim.w.roster.name(id)))),
            &private["killedBy"],
            &format!("{ctx}/killer"),
        );
        same(
            json!({"kills":p.credit.gv_parts.kills,"mobs":p.credit.gv_parts.mobs,"bounty":p.credit.gv_parts.bounty,"quest":p.credit.gv_parts.quest}),
            &private["gv"],
            &format!("{ctx}/gv"),
        );
        same(
            json!(p.motion.path.as_slice()),
            &private["path"],
            &format!("{ctx}/path"),
        );
        let queued: Vec<_> = p
            .inputs
            .actions
            .as_slice()
            .iter()
            .map(|a| match a {
                ActionCmd::Plan { spawn, boon, ready } => {
                    let mut v = json!({"kind":"plan"});
                    if let Some(x) = spawn {
                        v["spawn"] = json!(x);
                    }
                    if let Some(x) = boon {
                        v["boon"] = json!(x);
                    }
                    if let Some(x) = ready {
                        v["ready"] = json!(x);
                    }
                    v
                }
                other => panic!("unprojected queue {other:?}"),
            })
            .collect();
        same(
            json!({"move":p.inputs.mv,"moveBefore":p.inputs.move_before,"aim":p.inputs.aim,"aimBefore":p.inputs.aim_before,"actions":queued,"dropped":p.inputs.dropped}),
            &private["inputs"],
            &format!("{ctx}/input queue"),
        );
    }
    roster_snapshot(sim, f, ctx);
    assert!(w.reward_chests.is_empty());
    same(json!(w.entity_counter), &f["private"]["idCounter"], ctx);
    same(json!(w.item_counter), &f["private"]["uidCounter"], ctx);
    same(
        json!({"lightAcc":w.terrain.light_acc.iter().map(|(id,v)|json!([label(*id),v])).collect::<Vec<_>>(),"lightSince":w.terrain.light_since,"combatAt":w.terrain.combat_at.iter().map(|(id,v)|json!([label(*id),v])).collect::<Vec<_>>()}),
        &f["private"]["terrain"],
        &format!("{ctx}/terrain"),
    );
    let abilities = w.abilities.as_ref().map(|a| {
        assert!(a.fields.is_empty() && a.dot.is_empty());
        let mut v = json!({"fields":[],"dot":[],"dotSince":a.dot_since});
        if let Some(t) = a.teleported_at {
            v["teleportedAt"] = json!(t);
        }
        v
    });
    same(
        json!(abilities),
        &f["private"]["abilities"],
        &format!("{ctx}/ability cleanup clocks"),
    );
    assert!(sim.s.ledger.is_empty());
    same(json!([]), &f["private"]["ledger"], ctx);
    let landed=sim.s.landed.iter().map(|h|{assert!(!h.critical&&h.ability.is_none()&&!h.dot&&h.sig.is_none());json!({"victim":label(h.victim),"by":h.by.map(label),"amount":h.amount,"weapon":h.weapon.map(|w|w.as_str())})}).collect::<Vec<_>>();
    same(
        json!(landed),
        &f["private"]["landed"],
        &format!("{ctx}/landed payloads"),
    );
    projectile_state(sim, &f["private"]["projectiles"], ctx);
    rng(sim, case, f, ctx);
}
fn events(ev: &[Event]) -> Value {
    json!(ev.iter().filter(|e|!matches!(e,Event::ProjectileLaunched(_))).map(|e|match e{
    Event::PlanningStarted=>json!({"type":"planningStarted"}),Event::RaidStarted=>json!({"type":"raidStarted"}),Event::Plan{to,plan}=>json!({"type":"plan","to":label(*to),"plan":plan}),Event::RaidEnded=>json!({"type":"raidEnded"}),
    Event::Resolved{id,result,..}=>{let r=result;let mut out=json!({"outcome":format!("{:?}",r.outcome).to_lowercase(),"profile":r.profile,"durationSec":r.duration_sec,"kills":r.kills,"killedBy":r.killed_by,"place":r.place,"players":r.players,"gv":r.gv,"winBonusWithheld":r.win_bonus_withheld});if let Some(why)=r.win_bonus_why{out["winBonusWhy"]=json!(format!("{why:?}").to_lowercase());}json!({"type":"resolved","id":label(*id),"result":out})},
    Event::Victory{id,draw}=>json!({"type":"fx","fx":{"kind":"victory","id":id.map(label),"draw":draw,"name":id.map(|v|format!("name{}",v.0-1))}}),
    Event::Teleported=>json!({"type":"fx","fx":{"kind":"teleport"}}),
    Event::Death{id,x,y,by}=>json!({"type":"fx","fx":{"kind":"death","id":label(*id),"x":x,"y":y,"by":by.map(label)}}),
    Event::Windup{by,weapon,a,ms}=>json!({"type":"fx","fx":{"kind":"windup","by":label(*by),"weapon":weapon.as_str(),"a":a,"ms":ms}}),
    Event::Swing{by,weapon,x,y,a}=>json!({"type":"fx","fx":{"kind":"swing","by":label(*by),"weapon":weapon.as_str(),"x":x,"y":y,"a":a}}),
    Event::Hit{victim,by,amount,weapon,passive}=>{assert!(!passive);json!({"type":"fx","fx":{"kind":"hit","id":label(*victim),"by":by.map(label),"amount":amount,"weapon":weapon.map(|w|w.as_str())}})},
    Event::Gv{id,amount,reason}=>json!({"type":"gv","id":label(*id),"amount":amount,"reason":format!("{reason:?}").to_lowercase()}),
    Event::ProjectileEnded{launch,at,reason}=>{let mut fx=json!({"kind":"projEnd","id":format!("p{}",launch.id),"proj":format!("{:?}",launch.kind).to_lowercase(),"x0":launch.origin.x,"y0":launch.origin.y,"t0":launch.time,"x":at.x,"y":at.y,"reason":format!("{reason:?}").to_lowercase()});if !launch.reflected{fx["ownerId"]=json!(label(launch.owner));}json!({"type":"fx","fx":fx})},
    other=>panic!("unprojected planning event {other:?}")}).collect::<Vec<_>>())
}
#[test]
fn source_core_planning_lifecycle_owned_fields_twenty_cases() {
    let source = crate::collision::tests::fixture();
    let mut covered = 0;
    for case in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["name"].as_str().unwrap().starts_with("planning-"))
    {
        run_case(&source, case);
        covered += 1;
    }
    assert_eq!(covered, 20);
}
fn run_case(source: &Value, case: &Value) {
    let input = &case["input"];
    let name = case["name"].as_str().unwrap();
    let mut sim = make(source, input);
    snapshot(
        &sim,
        case,
        &case["constructed"],
        &format!("{name}/constructed"),
    );
    for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
        sim.add_player(
            &format!("name{i}"),
            Some(FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            p["bot"].as_bool().unwrap_or(false),
        )
        .unwrap();
    }
    snapshot(&sim, case, &case["joined"], &format!("{name}/joined"));
    for f in case["frames"].as_array().unwrap() {
        let a = &input["actions"][f["action"].as_u64().unwrap() as usize];
        let ctx = format!("{name}/{}", f["label"]);
        let mut ev = vec![];
        match a["kind"].as_str().unwrap() {
            "step" | "queue" => {
                if let Some(inputs) = a["inputs"].as_array() {
                    for (i, input) in inputs.iter().enumerate() {
                        assert_eq!(
                            send(&mut sim, input),
                            f["inputs"][i]["accepted"].as_bool().unwrap(),
                            "{ctx}/accepted{i}"
                        );
                    }
                }
                if a["kind"] == "step" {
                    ev = sim.step();
                } else {
                    ev = sim.take_events();
                }
            }
            "pickPool" => {
                for actor in a["actors"].as_array().unwrap() {
                    let own = sim.current_plan(id(actor)).unwrap();
                    let pick = own
                        .spawns
                        .iter()
                        .position(|p| *p == a["poolIndex"].as_i64().unwrap() as i32)
                        .unwrap();
                    assert!(send(
                        &mut sim,
                        &json!({"actor":actor,"type":"plan","payload":{"spawn":pick}})
                    ));
                }
                ev = sim.step();
            }
            "drop" => {
                sim.mark_dropped(id(&a["actor"]), true);
                ev = sim.take_events();
            }
            "reconnect" => {
                sim.mark_dropped(id(&a["actor"]), false);
                same(
                    json!({"to":a["actor"],"plan":sim.current_plan(id(&a["actor"]))}),
                    &f["reconnectPlan"],
                    &ctx,
                );
                ev = sim.take_events();
            }
            "remove" => {
                sim.remove_player(id(&a["actor"]));
                ev = sim.take_events();
            }
            "abandon" => {
                assert_eq!(
                    sim.abandon_player(id(&a["actor"])),
                    f["unbankedGv"].as_u64().unwrap() as u32
                );
                ev = sim.take_events();
            }
            "setupPlayer" => {
                setup_player(&mut sim, a);
                ev = sim.take_events();
            }
            "geometry" => {
                geometry_check(&sim, &f["geometry"], &ctx);
            }
            "vision" => {
                vision_check(&mut sim, a, &f["vision"], &ctx);
            }
            "setupBoons" => {
                let d = &mut sim
                    .w
                    .planning
                    .as_mut()
                    .unwrap()
                    .deals
                    .iter_mut()
                    .find(|(who, _)| *who == id(&a["actor"]))
                    .unwrap()
                    .1;
                d.boons = serde_json::from_value(a["boons"].clone()).unwrap();
                d.sent = None;
            }
            other => panic!("unconsumed planning action {other}"),
        }
        #[cfg(feature = "schedule-trace")]
        compare_owned_hook_order(&mut sim, case, f, &ctx);
        snapshot(&sim, case, f, &ctx);
        same(events(&ev), &f["events"], &format!("{ctx}/events"));
        if name != "planning-explicit-boon-helper" {
            let bytes = serde_json::to_vec(&sim).unwrap();
            let mut restored = Sim::restore(&mut serde_json::Deserializer::from_slice(&bytes))
                .unwrap_or_else(|e| panic!("{ctx}/restore {e}"));
            let mut continued = sim.clone();
            assert_eq!(restored.state_hash(), continued.state_hash());
            assert_eq!(
                restored.step(),
                continued.step(),
                "{ctx}/continuation events"
            );
            assert_eq!(
                restored.state_hash(),
                continued.state_hash(),
                "{ctx}/continuation hash"
            );
        }
    }
}
fn anchor(sim: &Sim, spec: &Value) -> Vec2 {
    let c = sim.k.arena.map.layers().unwrap().coliseum();
    match spec["anchor"].as_str() {
        None => Vec2::new(num(&spec["x"]), num(&spec["y"])),
        Some("centre") => Vec2::new(c.centre.x, c.centre.y),
        Some("inner") => {
            let p = c.inner_spawns[spec["index"].as_u64().unwrap_or(0) as usize];
            Vec2::new(
                p.x + spec["dx"].as_f64().unwrap_or(0.),
                p.y + spec["dy"].as_f64().unwrap_or(0.),
            )
        }
        Some(name) => {
            use crate::mapdata::GateSide;
            let gate = &c.gates[spec["index"].as_u64().unwrap_or(0) as usize];
            let t = &gate.tiles[gate.tiles.len() / 2];
            let d = match name {
                "gateTile" => 0.,
                "gateIn" => spec["distance"].as_f64().unwrap_or(64.),
                "gateOut" => -spec["distance"].as_f64().unwrap_or(64.),
                _ => panic!("unknown input anchor"),
            };
            let (dx, dy) = match gate.side {
                GateSide::North => (0., 1.),
                GateSide::East => (-1., 0.),
                GateSide::South => (0., -1.),
                GateSide::West => (1., 0.),
            };
            Vec2::new(
                crate::map::tile_to_world_center(t.x.into()) + dx * d,
                crate::map::tile_to_world_center(t.y.into()) + dy * d,
            )
        }
    }
}
fn setup_player(sim: &mut Sim, a: &Value) {
    let at = a.get("at").map(|v| anchor(sim, v));
    let path = a.get("path").map(|v| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|v| anchor(sim, v))
            .collect::<Vec<_>>()
    });
    let now = sim.w.server_time;
    let p = sim.w.players.get_mut(id(&a["actor"])).unwrap();
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
    if let Some(hp) = a["hp"].as_f64() {
        p.vitals.hp = hp;
    }
    if let Some(w) = a["weapon"].as_str() {
        p.weapon.weapon0 = crate::WeaponId::parse(w);
    }
    if let Some(points) = path {
        p.motion.path.set_from(&points);
    }
    assert!(
        a.get("status").is_none() && a.get("slide").is_none(),
        "ability/helper setup remains a separate unported case"
    );
}
fn geometry_check(sim: &Sim, e: &Value, ctx: &str) {
    let map = sim.collision_map();
    let a = anchor(sim, &json!({"anchor":"gateIn"}));
    let b = anchor(sim, &json!({"anchor":"gateOut"}));
    let g = anchor(sim, &json!({"anchor":"gateTile"}));
    let r = crate::constants::PLAYER_RADIUS;
    same(
        json!({"a":a,"b":b,"gate":g,"radius":r}),
        &e["input"],
        &format!("{ctx}/geometry input"),
    );
    same(
        json!(if sim.w.rt.gates_locked {
            "locked"
        } else {
            "open"
        }),
        &e["variant"],
        ctx,
    );
    same(
        json!(crate::geometry::circle_clear(
            map,
            g,
            r,
            crate::constants::MASK_MOVE
        )),
        &e["circle"],
        ctx,
    );
    same(
        json!(crate::geometry::segment_clear(
            map,
            a,
            b,
            r,
            crate::constants::MASK_MOVE
        )),
        &e["segment"],
        ctx,
    );
    same(
        json!(crate::geometry::has_line_of_sight(
            map,
            a,
            b,
            crate::constants::MASK_SIGHT
        )),
        &e["los"],
        ctx,
    );
    same(
        json!(
            !crate::vision::scene_line_blocked(map, a.x, a.y, b.x, b.y)
                && crate::math::hypot(a.x - b.x, a.y - b.y) <= crate::constants::VISION_RADIUS
        ),
        &e["currentVision"],
        ctx,
    );
    same(
        json!(crate::vision::VisionTrail::source_audit_fresh(
            sim.collision_view(),
            a,
            b,
            sim.w.tick
        )),
        &e["freshTrail"],
        ctx,
    );
    let path = crate::pathfind::Pathfinder::default().find_path(map, a, b, r);
    same(json!(path), &e["path"], ctx);
    let ray = crate::geometry::raycast(map, a.x, a.y, b.x, b.y, crate::constants::MASK_SIGHT);
    same(
        json!({"hit":ray.hit,"x":ray.x,"y":ray.y,"dist":ray.dist}),
        &e["ray"],
        ctx,
    );
    let gates=sim.k.arena.map.layers().unwrap().coliseum().gates.iter().map(|gate|json!({"side":gate.side,"tiles":gate.tiles.iter().map(|t|{let x=i64::from(t.x);let y=i64::from(t.y);json!({"x":t.x,"y":t.y,"base":sim.k.arena.map.tile(x,y).unwrap(),"active":map.tile(x,y).unwrap(),"terrain":sim.k.arena.map.layers().unwrap().data().terrain[(y*map.w as i64+x)as usize]})}).collect::<Vec<_>>()})).collect::<Vec<_>>();
    same(json!(gates), &e["gateTiles"], ctx);
    assert!(std::ptr::eq(
        map.layers().unwrap(),
        sim.k.arena.map.layers().unwrap()
    ));
    assert_eq!(e["activeTerrainSameReference"], true);
}
fn vision_check(sim: &mut Sim, action: &Value, e: &Value, ctx: &str) {
    let actor = id(&action["actor"]);
    let tick = sim.w.tick;
    let locked = sim.w.rt.gates_locked;
    crate::vision::refresh_player(sim.w.players.get_mut(actor).unwrap(), tick, locked);
    let viewer = sim.w.player(actor).unwrap();
    same(json!(viewer.pos()), &e["origin"], ctx);
    same(
        json!(if locked { "locked" } else { "open" }),
        &e["variant"],
        ctx,
    );
    same(
        viewer
            .vision
            .source_audit_memory(sim.collision_view(), tick),
        &e["memory"],
        &format!("{ctx}/private vision memory"),
    );
    for (spec, q) in action["points"]
        .as_array()
        .unwrap()
        .iter()
        .zip(e["points"].as_array().unwrap())
    {
        let at = anchor(sim, spec.get("point").unwrap_or(spec));
        same(json!(at), &q["point"], ctx);
        let los = !crate::vision::scene_line_blocked(
            sim.collision_map(),
            viewer.body.x,
            viewer.body.y,
            at.x,
            at.y,
        );
        let in_radius = crate::math::hypot(viewer.body.x - at.x, viewer.body.y - at.y)
            <= crate::constants::VISION_RADIUS;
        same(json!(los), &q["currentLOS"], ctx);
        same(json!(los && in_radius), &q["currentIsInVision"], ctx);
        same(
            json!(viewer
                .vision
                .source_audit_remembers(sim.collision_view(), at, tick)),
            &q["trailCanSee"],
            ctx,
        );
        same(
            json!(crate::vision::point_visible(
                sim.collision_view(),
                viewer,
                at,
                tick,
                crate::vision::WardSight::none(),
            )),
            &q["sourceCanPlayerSee"],
            ctx,
        );
        if let Some(target) = spec.get("actorId") {
            let target = sim.w.player(id(target)).unwrap();
            assert_eq!(target.pos(), at, "declared source actor query point");
            same(
                json!(crate::vision::gameplay_actor_visible(
                    sim.collision_view(),
                    viewer,
                    target,
                    tick,
                    crate::vision::WardSight::none(),
                )),
                &q["sourceCanPlayerSeeActor"],
                ctx,
            );
        }
    }
}
#[test]
fn source_core_arena_lifecycle_owned_fields_thirteen_cases() {
    let source = crate::collision::tests::fixture();
    let mut covered = 0;
    for case in source["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        if name.starts_with("planning-")
            || [
                "teleport-live-windup-status-refund",
                "roster-prefix-planning-birth-and-teleport",
            ]
            .contains(&name)
        {
            continue;
        }
        run_case(&source, case);
        covered += 1;
    }
    assert_eq!(covered, 13); // Remaining genuine Wish and roster profiles are separate required gates.
}
fn weapon_state(w: &crate::state::WeaponRt, e: &Value, ctx: &str) {
    let action=w.action.map(|a|{let mut value=json!({"kind":format!("{:?}",a.kind).to_lowercase(),"weapon":a.weapon.as_str(),"startedAt":a.started_at,"landsAt":a.lands_at,"a":a.a,"packet":{"raw":a.packet.raw,"phys":a.packet.phys,"magic":a.packet.magic,"true":a.packet.true_}});if let Some(id)=a.target{value["target"]=json!(label(id));}value});
    let neg = |x: Option<f64>| x.map_or(json!({"$float":"-Infinity"}), |x| json!(x));
    same(
        json!({"action":action,"rootUntil":w.root_until,"staggerImmuneUntil":w.stagger_immune_until,"held":w.held,"pressedAt":w.pressed_at,"bufferedUntil":w.buffered_until,"aim":w.aim,"aimAt":w.aim_at,"lagMs":w.lag_ms,"lock":w.targeting.target.map(label),"lockSeen":w.targeting.seen,"lockLosLostAt":w.targeting.lost_at.unwrap_or(0.),"lockPlanAt":neg(w.targeting.plan_at),"lockGoal":w.targeting.goal,"lockSearchAt":neg(w.targeting.search_at),"attackMoveGoal":w.targeting.attack_move,"lastShotAt":neg(w.last_shot_at)}),
        e,
        &format!("{ctx}/weapon runtime"),
    );
}
fn projectile_state(sim: &Sim, expected: &Value, ctx: &str) {
    assert_eq!(
        sim.w.projectiles.len(),
        expected.as_array().unwrap().len(),
        "{ctx}/projectiles"
    );
    for (p, e) in sim.w.projectiles.iter().zip(expected.as_array().unwrap()) {
        let l = &p.launch;
        let kind = format!("{:?}", l.kind).to_lowercase();
        let id = format!("p{}", l.id);
        let launch = json!({"id":id,"kind":kind,"x":l.origin.x,"y":l.origin.y,"vx":l.velocity.x,"vy":l.velocity.y,"t":l.time,"range":l.range,"ownerId":label(l.owner)});
        let got = json!({"id":id,"launch":launch,"kind":kind,"weapon":p.weapon().as_str(),"owner":label(l.owner),"ownerName":sim.w.roster.name(l.owner).unwrap(),"x":p.pos.x,"y":p.pos.y,"vx":p.velocity.x,"vy":p.velocity.y,"simT":p.time,"traveled":p.traveled,"packet":{"raw":p.packet.raw,"phys":p.packet.phys,"magic":p.packet.magic,"true":p.packet.true_},"halved":p.halved,"ended":false,"reflections":p.reflections});
        assert_eq!(e[0], id);
        let mut wanted = e[1].clone();
        wanted.as_object_mut().unwrap().remove("tickX");
        wanted.as_object_mut().unwrap().remove("tickY");
        // tickX/tickY are source per-step swept scratch, not persisted flight fields; checked below.
        same(got, &wanted, &format!("{ctx}/flight{id}"));
        if let Some(at) = sim.s.flight.source_audit_origin(l.id, &sim.w.projectiles) {
            same(json!(at.x), &e[1]["tickX"], ctx);
            same(json!(at.y), &e[1]["tickY"], ctx);
        } else {
            panic!("missing native flight scratch");
        }
    }
}
fn radix36(mut n: u32) -> String {
    let mut out = Vec::new();
    loop {
        let d = (n % 36) as u8;
        out.push(if d < 10 { b'0' + d } else { b'a' + d - 10 });
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}
fn actor_name(sim: &Sim, id: PlayerId) -> String {
    match sim.w.actor_origin(id).unwrap() {
        crate::mob_runtime::ActorOrigin::Player { join_ordinal } => format!("p{join_ordinal}"),
        crate::mob_runtime::ActorOrigin::Mob { birth_serial, .. }
        | crate::mob_runtime::ActorOrigin::Practice { birth_serial, .. }
        | crate::mob_runtime::ActorOrigin::Dummy { birth_serial, .. }
        | crate::mob_runtime::ActorOrigin::QuestGiver { birth_serial, .. } => {
            format!("mob{}", radix36(*birth_serial))
        }
        crate::mob_runtime::ActorOrigin::Zombie { owner } => format!("zombie{}", owner.0),
    }
}
fn roster_snapshot(sim: &Sim, f: &Value, ctx: &str) {
    let w = &sim.w;
    let camps=w.mob_runtime.as_ref().map(|rt|rt.camps.iter().zip(&rt.life).map(|(c,l)|json!({"type":c.mob_type.as_str(),"reward":"","alive":c.alive,"state":c.state,"elite":c.elite.map_or("",|x|x.as_str()),"clearedAt":c.cleared_at,"respawnAt":c.respawn_at,"wardOwner":l.ward_owner.map(label).unwrap_or_default(),"wardExpiresAt":l.ward_expires_at})).collect::<Vec<_>>()).unwrap_or_default();
    same(
        json!(camps),
        &f["private"]["camps"],
        &format!("{ctx}/camps"),
    );
    let mut containers = serde_json::Map::new();
    for c in &w.containers {
        let id = format!("c{}", radix36(c.id));
        let (kind, name) = match c.kind {
            crate::ContainerKind::Chest => ("chest", "Chest".to_owned()),
            crate::ContainerKind::Ground => (
                "ground",
                format!(
                    "{:?}",
                    crate::WeaponId::parse(c.items[0].def.as_str()).unwrap()
                ),
            ),
            other => panic!("unconsumed source container {other:?}"),
        };
        containers.insert(id.clone(),json!({"id":id,"kind":kind,"x":c.at.x,"y":c.at.y,"label":name,"items":c.items.iter().map(|i|json!({"uid":format!("U{}",i.uid),"def":i.def.as_str()})).collect::<Vec<_>>(),"camp":0,"expiresAt":0,"options":[],"takenBy":[],"pickers":[],"readyAt":0,"targetX":0,"targetY":0,"opened":c.opened,"owner":""}));
    }
    same(
        json!(containers),
        &f["private"]["containers"],
        &format!("{ctx}/containers"),
    );
    assert_eq!(
        w.mobs.len(),
        f["public"]["mobs"].as_array().unwrap().len(),
        "{ctx}/mob count"
    );
    assert_eq!(w.mobs.len(), f["private"]["mobs"].as_array().unwrap().len());
    for m in &w.mobs {
        let name = actor_name(sim, m.core.id);
        let e = f["public"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == name)
            .unwrap();
        let c = &m.core;
        same(
            json!({"id":name,"state":{"x":c.body.x,"y":c.body.y,"hp":c.vitals.hp,"maxHp":c.vitals.max_hp,"status":format!("{:?}",m.status).to_lowercase(),"kind":if m.elite{"elite"}else{"mob"},"type":m.mob_type.map_or("", |t|t.as_str()),"faction":c.vitals.faction.faction_id().expect("declared faction actor").as_str(),"camp":m.camp+1}}),
            e,
            &format!("{ctx}/{name}/public"),
        );
        let e = f["private"]["mobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == name)
            .unwrap();
        let b = m.regional_brain();
        same(
            json!({"region":c.vitals.faction.faction_id().expect("declared faction actor").as_str(),"elite":m.elite,"home":m.home,"homeFacing":m.home_facing,"mode":format!("{:?}",b.mode).to_lowercase(),"target":b.target.map(|id|actor_name(sim,id)),"threat":b.threat.iter().map(|(id,v)|json!([actor_name(sim,*id),v])).collect::<Vec<_>>(),"lastCombatAt":b.last_combat_at,"lastMoveAt":b.last_move_at,"goal":b.goal,"moving":b.moving,"holding":b.holding,"phase":m.repath_phase,"diedAt":b.died_at,"lastAim":b.last_aim.map_or(json!({"$float":"NaN"}),|x|json!(x))}),
            &e["brain"],
            &format!("{ctx}/{name}/brain"),
        );
        same(json!(c.motion.path.as_slice()), &e["path"], ctx);
        same(json!(c.body.history.as_slice()), &e["history"], ctx);
        assert!(c.motion.slip.is_none());
        same(Value::Null, &e["slip"], ctx);
        weapon_state(&c.weapon, &e["weapon"], ctx);
        assert!(c.statuses.instances.is_empty());
        same(json!([]), &e["statuses"], ctx);
        assert!(
            c.inputs.mv.is_none()
                && c.inputs.aim.is_none()
                && c.inputs.actions.as_slice().is_empty()
        );
        same(
            json!({"move":null,"moveBefore":c.inputs.move_before,"aim":null,"aimBefore":c.inputs.aim_before,"actions":[],"dropped":c.inputs.dropped}),
            &e["inputs"],
            ctx,
        );
    }
}
#[test]
fn source_roster_constructor_planning_birth_and_teleport_owned_fields() {
    let source = crate::collision::tests::fixture();
    let case = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "roster-prefix-planning-birth-and-teleport")
        .unwrap();
    run_case(&source, case);
}

#[test]
fn actual_source_assignment_helper_preserves_reservation_and_order() {
    let source = crate::collision::tests::fixture();
    let cases = source["assignmentHelpers"].as_array().unwrap();
    assert_eq!(cases.len(), 1);
    for c in cases {
        let input = &c["input"];
        let mut sim = make(&source, input);
        for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
            sim.add_player(
                &format!("name{i}"),
                Some(FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
                false,
            )
            .unwrap();
        }
        sim.step();
        same(
            planning(&sim),
            &expected_planning(&c["naturalPlanning"]),
            "normal deal before declared assignment helper",
        );
        let p = sim.w.planning.as_mut().unwrap();
        for d in input["helperDeals"].as_array().unwrap() {
            let native = &mut p
                .deals
                .iter_mut()
                .find(|(who, _)| *who == id(&d["id"]))
                .unwrap()
                .1;
            native.spawns = serde_json::from_value(d["spawns"].clone()).unwrap();
            native.pick = d["pick"].as_i64().unwrap() as i8;
        }
        p.holders = input["helperHolders"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| (h[0].as_i64().unwrap() as i32, id(&h[1])))
            .collect();
        let order = input["order"]
            .as_array()
            .unwrap()
            .iter()
            .map(id)
            .collect::<Vec<_>>();
        let before = sim.state_hash();
        let actual = assign(&sim.k, &sim.w, &order);
        same(
            json!(actual
                .iter()
                .map(|(who, at)| json!([label(*who), at]))
                .collect::<Vec<_>>()),
            &c["expected"],
            "declared assignment helper",
        );
        assert_eq!(sim.state_hash(), before);
    }
}

#[test]
fn arena_capture_inventory_runs_genuine_wish_prerequisite_and_keeps_full_hooks_pending() {
    let source = crate::collision::tests::fixture();
    assert_eq!(source["cases"].as_array().unwrap().len(), 35);
    let case = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "teleport-live-windup-status-refund")
        .unwrap();
    assert!(case["input"]["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["inputs"]
            .as_array()
            .is_some_and(|inputs| inputs.iter().any(|i| i["type"] == "cast"))));
    crate::abilities::assert_genuine_arena_refund();
    let tables = crate::schedule::tables();
    for (hook, name, pending) in [
        (
            crate::schedule::Hook::Teleported,
            "cardHooks.resetFight",
            None,
        ),
        (
            crate::schedule::Hook::Teleported,
            "cardHooks.dropDeferred",
            None,
        ),
        (
            crate::schedule::Hook::RaidStarted,
            "cardHooks.resetAll",
            Some("P-CARDS-1"),
        ),
    ] {
        let link = tables
            .hooks
            .iter()
            .find(|(h, _)| *h == hook)
            .unwrap()
            .1
            .iter()
            .find(|link| link.legacy == name)
            .unwrap();
        assert_eq!(link.pending, pending, "{name} pending state changed");
    }
    if std::env::var_os("RH_ARENA_REQUIRE_FULL").is_some() {
        panic!("Full ARENA INCOMPLETE: cardHooks.resetAll; Source wire/client and durable shutdown/MIA prerequisites. Genuine Wish/refund was executed separately; full arena-owned projection is not claimed.");
    }
    eprintln!("Arena owned kernel: 33 ordinary cases +1 declared boon helper, plus genuine Wish/refund prerequisite through its dedicated consumer; full card hooks, Source transport/durability and complete case27 arena projection remain INCOMPLETE");
}

#[cfg(feature = "schedule-trace")]
fn compare_owned_hook_order(sim: &mut Sim, case: &Value, f: &Value, ctx: &str) {
    let keys = [
        "raidStarted",
        "teleported",
        "arenaHurt",
        "fighterOut",
        "attackStarted",
        "runEnded",
        "staggered",
    ];
    let roster = case["input"]["profile"] == "roster";
    let source = f["hookTrace"].as_array().unwrap();
    let mut pending = 0;
    let expected=source.iter().filter(|h|{
        if h["installer"]=="cardHooks" {assert!(roster&&["raidStarted","teleported"].contains(&h["hook"].as_str().unwrap()));pending+=1;false}else{if h["hook"]=="staggered" {assert_eq!(h["installer"],"abilities", "the abilities chain owns the staggered link");}true}
    }).map(|h|{let mut h=h.clone();h.as_object_mut().unwrap().remove("phase");
        if let Some(transition)=h.as_object_mut().unwrap().remove("visionTransition"){
            let mut watched=Vec::new();for a in case["input"]["actions"].as_array().unwrap().iter().take(f["action"].as_u64().unwrap()as usize){if a["kind"]=="vision"{let actor=id(&a["actor"]);if !watched.contains(&actor){watched.push(actor);}}}
            let before=watched.iter().map(|id|{let p=sim.w.player(*id).unwrap();json!({"id":label(p.id),"memory":p.vision.source_audit_before_current_reveal(sim.collision_view(),sim.w.tick)})}).collect::<Vec<_>>();
            let after=watched.iter().map(|id|{let p=sim.w.player(*id).unwrap();let mut memory=p.vision.source_audit_memory(sim.collision_view(),sim.w.tick);if memory["lastMapVariant"]=="active"{memory["lastMapVariant"]=json!("locked");}json!({"id":label(p.id),"memory":memory})}).collect::<Vec<_>>();
            same(json!({"before":before,"after":after}),&transition,&format!("{ctx}/same-tick actual hook vision history"));
        }h}).collect::<Vec<_>>();
    let native = sim
        .schedule_trace()
        .into_iter()
        .filter_map(|e| {
            let crate::schedule::TraceEntry::Hook(hook, callback) = e else {
                return None;
            };
            if !keys.contains(&hook) {
                return None;
            }
            let module = callback.split('.').next().unwrap();
            // Core source omits these installers. Native callbacks are inert with empty owned stores.
            if !roster && ["chests", "mobLife"].contains(&module) {
                return None;
            }
            // Core source profiles do not install these modules; the native callbacks are inert with the empty
            // owned stores or the config gate regen is off behind.
            if ["cardHooks", "consumables", "regen", "traders"].contains(&module) {
                return None;
            }
            Some(json!({"hook":hook,"installer":module,"time":sim.w.server_time,"tick":sim.w.tick}))
        })
        .collect::<Vec<_>>();
    same(
        json!(native),
        &json!(expected),
        &format!("{ctx}/owned hook order; pending card links {pending}"),
    );
}
