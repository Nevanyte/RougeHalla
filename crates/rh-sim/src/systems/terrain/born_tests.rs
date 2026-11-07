#![cfg(test)]
//! Real source constructor births, followed only by the explicitly declared existing-actor setup.
use super::{
    source_tests::{close, compare, n, point, points, with_cx},
    *,
};
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, TileMap, Vec2};
use serde_json::{json, Value};
fn label(id: PlayerId) -> String {
    if id.0 <= 2 {
        format!("p{}", id.0 - 1)
    } else {
        format!("mob{}", id.0 - 2)
    }
}
fn rows(v: &[(PlayerId, f64)]) -> Value {
    json!(v.iter().map(|(id, v)| (label(*id), *v)).collect::<Vec<_>>())
}
fn arena(mut map: Value, input: &Value) -> Arena {
    let zone = input["zone"].as_str().unwrap();
    if zone != "fire" {
        let other = map["regions"]
            .as_array()
            .unwrap()
            .iter()
            .position(|r| r["id"] == zone)
            .unwrap();
        map["regions"][0]["id"] = zone.into();
        map["regions"][other]["id"] = "fire".into();
        for c in map["regions"][0]["mobCamps"].as_array_mut().unwrap() {
            c["id"] = format!("{zone}-1").into();
            c["region"] = zone.into();
            c["weapon"] = match zone {
                "holy" => "wand",
                "plague" => "bow",
                "frost" => "shield",
                _ => "sword",
            }
            .into();
        }
        for p in map["spawnPool"].as_array_mut().unwrap() {
            if p["zone"] == "fire" {
                p["zone"] = zone.into()
            } else if p["zone"] == zone {
                p["zone"] = "fire".into()
            }
        }
        map["camps"][0]["zone"] = zone.into();
        map["camps"][0]["id"] = format!("{zone}-1").into();
        for v in map["regionGrid"].as_array_mut().unwrap() {
            let x = v.as_u64().unwrap();
            if x == 1 {
                *v = (other + 1).into()
            } else if x == other as u64 + 1 {
                *v = 1.into()
            }
        }
        map["regions"].as_array_mut().unwrap().swap(0, other);
        map["spawns"] = json!(map["regions"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|r| r["spawns"].as_array().unwrap().iter().cloned())
            .collect::<Vec<_>>());
    }
    let w = map["w"].as_u64().unwrap();
    for e in input["overlay"].as_array().unwrap() {
        let i = (e["ty"].as_u64().unwrap() * w + e["tx"].as_u64().unwrap()) as usize;
        assert_eq!(map["tiles"][i], 0);
        map["terrain"][i] = e["kind"].clone();
    }
    let data = serde_json::from_value(map).unwrap();
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_parts();
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
fn snapshot(sim: &Sim, f: &Value, context: &str) -> bool {
    let mut known_reward_gap = false;
    assert_eq!(
        format!("{:?}", sim.w.phase).to_lowercase(),
        f["phase"].as_str().unwrap(),
        "{context}/phase"
    );
    let camps=sim.w.mob_runtime.as_ref().map(|rt|rt.camps.iter().zip(&rt.life).map(|(c,l)|json!({"type":c.mob_type.as_str(),"reward":"","alive":c.alive,"state":c.state,"elite":c.elite.map_or("",|x|x.as_str()),"clearedAt":c.cleared_at,"respawnAt":c.respawn_at,"wardOwner":l.ward_owner.map(label).unwrap_or_default(),"wardExpiresAt":l.ward_expires_at})).collect::<Vec<_>>()).unwrap_or_default();
    compare(&json!(camps), &f["camps"], &format!("{context}/camps"));
    assert!(
        sim.w.containers.is_empty(),
        "{context}/nonreward containers"
    );
    let mut containers = serde_json::Map::new();
    for c in &sim.w.reward_chests {
        let id = format!("c{}", c.id);
        containers.insert(id.clone(),json!({"id":id,"kind":"reward","x":c.at.x,"y":c.at.y,"label":"Augment Chest","items":[],"camp":c.camp.map_or(0,|x|u32::from(x)+1),"expiresAt":c.expires_at,"options":c.options.iter().map(|x|match x{Some(crate::reward_chests::OptionId::Card(id))=>id.as_str(),None=>"",_=>panic!("source corpus has no boost chest")}).collect::<Vec<_>>(),"takenBy":c.taken.map(|id|id.map(label).unwrap_or_default()),"pickers":c.pickers.iter().copied().map(label).collect::<Vec<_>>(),"readyAt":0,"targetX":0,"targetY":0,"opened":false,"owner":c.owner.map(label).unwrap_or_default()}));
    }
    let mut expected_containers = f["containers"].clone();
    // Exactly one known staged-card boundary. The strict full-world gate below is unchanged;
    // the bounded kernel gate compares all other container bytes and pins both observed choices.
    if context.starts_with("born-plague-ember-real-attack-credit/")
        && containers.contains_key("c4")
        && containers["c4"]["options"] != expected_containers["c4"]["options"]
        && std::env::var_os("RH_TERRAIN_REQUIRE_FULL").is_none()
    {
        assert_eq!(
            containers["c4"]["options"],
            json!(["siphon", "slowBurn", "pocketSand"]),
            "new native reward divergence: {context}"
        );
        assert_eq!(
            expected_containers["c4"]["options"],
            json!(["siphon", "tankEngine", "thirdTimesTheCharm"]),
            "new source reward boundary: {context}"
        );
        eprintln!(
            "FULL-WORLD INCOMPLETE {context}/containers/c4/options: native={} source={}",
            containers["c4"]["options"], expected_containers["c4"]["options"]
        );
        containers
            .get_mut("c4")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("options");
        expected_containers["c4"]
            .as_object_mut()
            .unwrap()
            .remove("options");
        known_reward_gap = true;
    }
    compare(
        &Value::Object(containers),
        &expected_containers,
        &format!("{context}/containers"),
    );
    close(sim.w.server_time, n(f, "time"), context);
    assert_eq!(sim.w.tick as u64, f["tick"].as_u64().unwrap(), "{context}");
    assert_eq!(
        sim.w.entity_counter as u64,
        f["counter"].as_u64().unwrap(),
        "{context}"
    );
    assert_eq!(
        sim.w.fighter_count(),
        f["fighters"].as_array().unwrap().len(),
        "{context}"
    );
    for (i, want) in f["fighters"].as_array().unwrap().iter().enumerate() {
        let c = sim.w.core(FighterIx::of_slot(i));
        let st = &want["state"];
        let rt = &want["private"];
        let ctx = format!("{context}/{}", want["id"]);
        assert_eq!(label(c.id), want["id"].as_str().unwrap(), "{ctx}");
        for (k, v) in [
            ("x", c.body.x),
            ("y", c.body.y),
            ("facing", c.body.facing),
            ("hp", c.vitals.hp),
            ("maxHp", c.vitals.max_hp),
            ("barrier", c.vitals.barrier),
            ("readyAt", c.weapon.ready_at),
            ("drawStartedAt", c.weapon.draw_started_at),
        ] {
            close(
                v,
                if k == "barrier" {
                    st[k].as_f64().unwrap_or(0.)
                } else {
                    n(st, k)
                },
                &format!("{ctx}/{k}"),
            );
        }
        assert_eq!(
            c.weapon.weapon0.map_or("", |w| w.as_str()),
            st["weapon0"].as_str().unwrap()
        );
        assert_eq!(
            c.weapon.weapon1.map_or("", |w| w.as_str()),
            st["weapon1"].as_str().unwrap()
        );
        assert_eq!(c.weapon.slot as u64, st["slot"].as_u64().unwrap());
        assert_eq!(c.vitals.faction.as_str(), st["faction"].as_str().unwrap());
        compare(
            &json!(c.motion.path.as_slice()),
            &rt["path"],
            &format!("{ctx}/path"),
        );
        compare(
            &json!(c.body.history.as_slice()),
            &rt["history"],
            &format!("{ctx}/history"),
        );
        assert_eq!(c.motion.slip.is_some(), !rt["slip"].is_null(), "{ctx}/slip");
        if let Some(s) = &c.motion.slip {
            for (k, v) in [("vx", s.vx), ("vy", s.vy), ("ax", s.ax), ("ay", s.ay)] {
                close(v, n(&rt["slip"], k), &format!("{ctx}/slip/{k}"));
            }
            assert_eq!(
                s.path == Some(c.motion.path.generation),
                rt["slipPathIdentity"] == true,
                "{ctx}"
            );
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
                        &rt["slip"][k],
                        &ctx,
                    );
                } else {
                    compare(&json!(v), &rt["slip"][k], &ctx);
                }
            }
        }
        let w = &c.weapon;
        let action=w.action.map(|a|{let mut value=json!({"kind":format!("{:?}",a.kind).to_lowercase(),"weapon":a.weapon.as_str(),"startedAt":a.started_at,"landsAt":a.lands_at,"a":a.a,"packet":{"raw":a.packet.raw,"phys":a.packet.phys,"magic":a.packet.magic,"true":a.packet.true_}});if let Some(id)=a.target{value["target"]=json!(label(id));}value});
        let mut weapon = json!({"action":action,"rootUntil":w.root_until,"staggerImmuneUntil":w.stagger_immune_until,"held":w.held,"pressedAt":w.pressed_at,"bufferedUntil":w.buffered_until,"aim":w.aim,"aimAt":w.aim_at,"lagMs":w.lag_ms,"lock":w.targeting.target.map(label),"lockSeen":w.targeting.seen,"lockLosLostAt":w.targeting.lost_at.unwrap_or(0.),"lockPlanAt":w.targeting.plan_at.map_or(json!("-Infinity"),|x|json!(x)),"lockGoal":w.targeting.goal,"lockSearchAt":w.targeting.search_at.map_or(json!("-Infinity"),|x|json!(x)),"attackMoveGoal":w.targeting.attack_move});
        // lastShotAt has no producer in these traces; the native bow-release stage does not retain that source-only cache.
        assert_eq!(rt["weapon"]["lastShotAt"], "-Infinity", "{ctx}");
        weapon["lastShotAt"] = json!("-Infinity");
        compare(&weapon, &rt["weapon"], &format!("{ctx}/weapon"));
        assert!(c.statuses.instances.is_empty(), "{ctx}");
        assert_eq!(rt["statuses"], json!([]), "{ctx}");
        if i < 2 {
            let p = &sim.w.players[i];
            close(p.vitals.immune_until, n(st, "immuneUntil"), &ctx);
            assert_eq!(p.credit.kills as u64, st["kills"].as_u64().unwrap());
            assert_eq!(p.credit.bounty as u64, st["bounty"].as_u64().unwrap());
            assert_eq!(p.credit.gv as u64, st["gv"].as_u64().unwrap());
            assert_eq!(
                format!("{:?}", p.status).to_lowercase(),
                st["status"].as_str().unwrap()
            );
            assert_eq!(p.credit.mob_kills as u64, rt["mobKills"].as_u64().unwrap());
            compare(
                &json!({"kills":p.credit.gv_parts.kills,"mobs":p.credit.gv_parts.mobs,"bounty":p.credit.gv_parts.bounty,"quest":p.credit.gv_parts.quest}),
                &rt["gv"],
                &ctx,
            );
            compare(
                &json!(p
                    .credit
                    .last_hit
                    .map(|(id, at)| json!({"by":label(id),"at":at}))),
                &rt["lastHit"],
                &ctx,
            );
            compare(
                &json!(p
                    .down
                    .map(|d| json!({"outcome":format!("{d:?}").to_lowercase()}))),
                &rt["down"],
                &ctx,
            );
            assert_eq!(p.resolved, rt["resolved"] == true);
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
            compare(&json!(killer), &rt["killedBy"], &ctx);
        } else {
            let m = &sim.w.mobs[i - 2];
            assert_eq!(m.mob_type.as_str(), st["type"].as_str().unwrap());
            assert_eq!(m.camp as u64 + 1, st["camp"].as_u64().unwrap());
            assert_eq!(
                format!("{:?}", m.status).to_lowercase(),
                st["status"].as_str().unwrap()
            );
            let b = &m.brain;
            let brain = json!({"region":c.vitals.faction.as_str(),"elite":m.elite,"home":m.home,"homeFacing":m.home_facing,"mode":format!("{:?}",b.mode).to_lowercase(),"target":b.target.map(label),"threat":rows(&b.threat),"lastCombatAt":b.last_combat_at,"lastMoveAt":b.last_move_at,"goal":b.goal,"moving":b.moving,"holding":b.holding,"phase":m.repath_phase,"diedAt":b.died_at,"lastAim":b.last_aim.map_or(json!("NaN"),|x|json!(x))});
            compare(&brain, &rt["brain"], &format!("{ctx}/brain"));
            close(m.last_hit_at, n(rt, "lastHitAt"), &ctx);
        }
    }
    compare(
        &json!({"lightAcc":rows(&sim.w.terrain.light_acc),"lightSince":sim.w.terrain.light_since,"combatAt":rows(&sim.w.terrain.combat_at)}),
        &f["terrain"],
        &format!("{context}/terrain"),
    );
    compare(
        &json!({"damage":sim.w.terrain.damage.iter().map(|(id,x)|json!([label(*id),{"ember":x}])).collect::<Vec<_>>(),"seconds":{"ember":sim.w.terrain.seconds[0],"bog":sim.w.terrain.seconds[1],"ice":sim.w.terrain.seconds[2],"light":sim.w.terrain.seconds[3]},"heal":rows(&sim.w.terrain.heal)}),
        &f["stats"],
        &format!("{context}/stats"),
    );
    known_reward_gap
}
fn rng(sim: &Sim, f: &Value, ctx: &str) {
    let mut main = crate::rng::Mulberry32::new(12);
    let mut reward = crate::private_rng::Sfc32::from_words([1, 2, 3, 4]);
    for d in f["randomDraws"].as_array().unwrap() {
        let v = match d["stream"].as_str().unwrap() {
            "main" => main.next_f64(),
            "reward" => reward.next_f64(),
            x => panic!("unconsumed stream {x}"),
        };
        close(v, n(d, "value"), ctx);
    }
    assert_eq!(
        serde_json::to_value(&main).unwrap(),
        serde_json::to_value(&sim.w.spawn_rng).unwrap(),
        "{ctx}/main RNG"
    );
    assert_eq!(reward.words(), sim.w.reward_rng.words(), "{ctx}/reward RNG");
    assert_eq!(
        sim.w.item_counter,
        f["uidCounter"].as_u64().unwrap(),
        "{ctx}/UID counter"
    );
}
fn events(ev: &[Event]) -> Value {
    let projected=ev.iter().map(|e| {
match e {
Event::RaidStarted=>json!({"type":"raidStarted"}),
Event::Heal{id,amount}=>json!({"type":"fx","fx":{"kind":"heal","id":label(*id),"amount":amount}}),
Event::Hit{victim,by,amount,weapon,..}=>json!({"type":"fx","fx":{"kind":"hit","id":label(*victim),"by":by.map(label),"amount":amount,"weapon":weapon.map(|w|w.as_str())}}),
Event::Death{id,x,y,by}=>json!({"type":"fx","fx":{"kind":"death","id":label(*id),"x":x,"y":y,"by":by.map(label)}}),
Event::Gv{id,amount,reason}=>json!({"type":"gv","id":label(*id),"amount":amount,"reason":format!("{reason:?}").to_lowercase()}),
Event::Windup{by,weapon,a,ms}=>json!({"type":"fx","fx":{"kind":"windup","by":label(*by),"weapon":weapon.as_str(),"a":a,"ms":ms}}),
Event::Swing{by,weapon,x,y,a}=>json!({"type":"fx","fx":{"kind":"swing","by":label(*by),"weapon":weapon.as_str(),"x":x,"y":y,"a":a}}),
e=>panic!("unconsumed born event {e:?}")
}
}).collect::<Vec<_>>();
    json!(projected)
}
#[test]
fn terrain_born_kernel_twenty_complete_one_reward_gap() {
    let (mut full_cases, mut partial_cases) = (0, 0);
    let bytes = include_bytes!("../../../../../parity/terrain/born-source.json");
    assert_eq!(
        bytes
            .iter()
            .fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(*b))
                .wrapping_mul(0x100000001b3)),
        11153133524613565879
    );
    let corpus: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(corpus["format"], "rh-terrain-born-source/1");
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 21);
    for case in corpus["cases"].as_array().unwrap() {
        let mut case_gap = false;
        let input = &case["input"];
        let name = input["name"].as_str().unwrap();
        let placements = input["players"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, p)| Placement {
                profile: format!("name{i}"),
                faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
                bot: false,
                at: point(p),
                hp: p["hp"].as_f64(),
                weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
                weapon1: None,
            })
            .collect::<Vec<_>>();
        let mut secrets = Secrets::from_seed(1);
        secrets.spawn_seed = 12;
        secrets.reward_salt = [1, 2, 3, 4];
        let mut sim = Sim::new(
            SimConfig {
                min_players: 2,
                fill_seconds: 0.,
                mob_mode: crate::mob_runtime::MobMode::Pve,
                hazards: if input["hazards"] == "all" {
                    Mode::All
                } else {
                    Mode::Map
                },
                ..Default::default()
            },
            arena(corpus["constructorInputMap"].clone(), input),
            secrets,
        );
        snapshot(&sim, &case["constructed"], &format!("{name}/constructed"));
        rng(&sim, &case["constructed"], name);
        assert_eq!(
            sim.k.secrets.order_salt as u64,
            case["constructed"]["orderSalt"].as_u64().unwrap()
        );
        for p in &placements {
            sim.add_player(&p.profile, Some(p.faction), p.bot).unwrap();
        }
        let birth_events = sim.step();
        compare(
            &events(&birth_events),
            &case["born"]["events"],
            &format!("{name}/birth-events"),
        );
        snapshot(&sim, &case["born"], &format!("{name}/born"));
        rng(&sim, &case["born"], name);
        let now = sim.w.server_time;
        for (p, spec) in sim.w.players.iter_mut().zip(&placements) {
            p.body.x = spec.at.x;
            p.body.y = spec.at.y;
            p.body.facing = 0.;
            p.weapon.weapon0 = spec.weapon0;
            p.weapon.weapon1 = None;
            if let Some(hp) = spec.hp {
                p.vitals.hp = hp;
            }
            p.body.history.reset(crate::state::Sample {
                t: now,
                x: spec.at.x,
                y: spec.at.y,
            });
        }
        snapshot(&sim, &case["initial"], &format!("{name}/initial"));
        sim.w.trace.1.enabled = true;
        for (i, a) in input["actions"].as_array().unwrap().iter().enumerate() {
            let f = &case["frames"][i];
            let ctx = format!("{name}/{i}");
            let mut ev = vec![];
            sim.w.trace.1.records.clear();
            let ix = FighterIx::of_slot(2 + a["index"].as_u64().unwrap_or(0) as usize);
            let dt = a["dtMs"].as_f64().unwrap_or(TICK_MS);
            match a["kind"].as_str().unwrap() {
                "setupBorn" => {
                    let now = sim.w.server_time;
                    let c = sim.w.core_mut(ix);
                    if a["at"].is_object() {
                        let at = point(&a["at"]);
                        c.body.x = at.x;
                        c.body.y = at.y;
                        c.body.history.reset(crate::state::Sample {
                            t: now,
                            x: at.x,
                            y: at.y,
                        });
                        c.motion.slip = None;
                    }
                    if let Some(h) = a["hp"].as_f64() {
                        c.vitals.hp = h;
                    }
                    if a["path"].is_array() {
                        c.motion.path.set_from(&points(&a["path"]));
                    }
                    if a["history"].is_array() {
                        c.body.history = serde_json::from_value(a["history"].clone()).unwrap();
                    }
                    if a["mode"] == "return" {
                        sim.w.mobs[ix.slot() - 2].brain.mode =
                            crate::mob_runtime::BrainMode::Return;
                    }
                }
                "burn" => {
                    sim.s.ledger.clear();
                    sim.s.landed.clear();
                    with_cx(&mut sim, &mut ev, &[], |cx| {
                        super::super::settle::mark_tick_start(cx);
                        burn_dt(cx, dt);
                        super::super::ledger::apply(cx);
                    });
                }
                "light" => {
                    sim.s.landed.clear();
                    with_cx(&mut sim, &mut ev, &[], |cx| light_dt(cx, dt));
                }
                "walk" => {
                    super::super::movement::walk_one(
                        &sim.k,
                        &mut sim.w,
                        ix,
                        &mut sim.pf,
                        dt,
                        Some(false),
                        a["speedMult"].as_f64().unwrap_or(1.),
                    );
                    if a["recordHistory"] == true {
                        let t = sim.w.server_time;
                        let c = sim.w.core_mut(ix);
                        c.body.history.record(t, c.body.x, c.body.y);
                    }
                }
                "bog" => {
                    let v = bog(&sim.k, &mut sim.w, ix, dt, Default::default());
                    let e = effect(&sim.k, &sim.w, ix);
                    compare(
                        &json!({"bog":v,"traction":e.accel,"surface":{"kind":sim.k.arena.map.layers().unwrap().data().terrain[(sim.w.core(ix).body.y/32.).floor()as usize*sim.k.arena.map.w as usize+(sim.w.core(ix).body.x/32.).floor()as usize],"burnShare":e.burn,"speedMult":e.speed,"accel":e.accel,"healShare":e.heal}}),
                        &f["events"][0]["probe"],
                        &ctx,
                    );
                }
                "step" => {
                    if let Some(inputs) = a["inputs"].as_array() {
                        for input in inputs {
                            assert_eq!(input["type"], "attack");
                            let id = PlayerId(
                                input["actor"].as_str().unwrap()[1..]
                                    .parse::<u32>()
                                    .unwrap()
                                    + 1,
                            );
                            sim.submit(
                                id,
                                crate::validate(crate::RawCommand::Attack {
                                    a: n(&input["payload"], "a"),
                                    t: None,
                                })
                                .unwrap(),
                            )
                            .unwrap();
                        }
                    }
                    ev = sim.step();
                }
                "terrainHook" | "teleported" => {
                    let kind = a["kind"].as_str().unwrap();
                    if kind == "terrainHook" {
                        for j in 0..sim.w.fighter_count() {
                            sim.w.core_mut(FighterIx::of_slot(j)).motion.slip =
                                Some(walk::new_slip(Vec2::new(10., 20.), Vec2::new(30., 40.)));
                        }
                        terrain::stamp(&mut sim.w.terrain.light_acc, PlayerId(1), 2.);
                        terrain::stamp(&mut sim.w.terrain.combat_at, PlayerId(1), 123.);
                    }
                    let mut hx = crate::hooks::Hx {
                        k: &sim.k,
                        w: &mut sim.w,
                        stats: Default::default(),
                        fx: None,
                        ev: &mut ev,
                    };
                    if kind == "teleported" {
                        crate::hooks::fire(&mut hx, HookArgs::Teleported);
                    } else if a["hook"] == "raidStarted" {
                        raid_started(&mut hx, &HookArgs::RaidStarted);
                    } else {
                        clear_slips(&mut hx, &HookArgs::Teleported);
                    }
                }
                other => panic!("unconsumed born action {other}"),
            }
            case_gap |= snapshot(&sim, f, &ctx);
            rng(&sim, f, &ctx);
            let expected = f["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| !e["probe"].is_object())
                .cloned()
                .collect::<Vec<_>>();
            compare(&events(&ev), &json!(expected), &format!("{ctx}/events"));
            let hurt=sim.w.trace.1.records.iter().filter_map(|h|if let crate::status_runtime::probe::HookRecord::ArenaHurt{victim,by,amount,source}=h{Some(json!({"victim":label(*victim),"by":source.as_ref().map(|s|json!({"id":s.id.map(label).unwrap_or_else(||"terrain:ember".into()),"name":s.name})).unwrap_or_else(||json!(by.map(label))),"hp":amount}))}else{None}).collect::<Vec<_>>();
            compare(&json!(hurt), &f["arenaHurt"], &format!("{ctx}/arenaHurt"));
            assert!(sim.s.ledger.is_empty(), "{ctx}/ledger");
            assert_eq!(f["ledger"], json!([]), "{ctx}/source ledger");
            let landed = sim
                .s
                .landed
                .iter()
                .map(|h| {
                    let mut v =
                        json!({"victim":label(h.victim),"by":h.by.map(label),"amount":h.amount});
                    if let Some(w) = h.weapon {
                        v["weapon"] = json!(w.as_str());
                    }
                    v
                })
                .collect::<Vec<_>>();
            compare(&json!(landed), &f["landed"], &format!("{ctx}/landed"));
            // A terrain-only teleport intentionally leaves the harness's future combat stamp; it is not a legal checkpoint.
            if !(a["kind"] == "terrainHook" && a["hook"] == "teleported") {
                let restored = Sim::restore(serde_json::to_value(&sim).unwrap())
                    .unwrap_or_else(|e| panic!("{ctx}/restore: {e:?}"));
                assert_eq!(sim.state_hash(), restored.state_hash(), "{ctx}");
                let mut continued = sim.clone();
                let mut resumed = restored;
                assert_eq!(
                    continued.step(),
                    resumed.step(),
                    "{ctx}/continuation events"
                );
                assert_eq!(
                    continued.state_hash(),
                    resumed.state_hash(),
                    "{ctx}/continuation hash"
                );
            }
        }
        if case_gap {
            partial_cases += 1
        } else {
            full_cases += 1
        }
    }
    // The last partial case was the reward gap: the full interactive pool drop now matches the source exactly, so every
    // born-kernel case is fully compared (P-CARDS-1).
    assert_eq!((full_cases, partial_cases), (21, 0));
    eprintln!("TERRAIN KERNEL: 21 cases; 21 fully compared; FULL TERRAIN COMPLETE");
}
