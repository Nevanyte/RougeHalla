#![cfg(test)]
//! Immutable70433 helper consumption. These are declared noncanonical method contexts,
//! not earned World/checkpoint histories. Recipes come from the pinned helper-scenario,
//! never from the observed hint bytes. Only the separate source14/lifecycle tests claim
//! genuine constructor/step/restore coverage.
use super::*;
use crate::{Arena, FactionId, FactionMode, PlayerId, Secrets, Sim, SimConfig, TileMap, WeaponId};
use serde_json::{json, Value};

fn corpus() -> Value {
    let bytes = include_bytes!("../../../../../parity/walk-hint/helpers/source.json");
    let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(
        hash, 0x27859386c7c0dcda,
        "immutable actual source helper corpus"
    );
    let source: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(source["format"], "rh-walk-hint-helpers/1");
    assert_eq!(source["cases"].as_array().unwrap().len(), 69);
    source
}
fn point(v: &Value) -> Vec2 {
    Vec2::new(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap())
}
fn tile(x: usize, y: usize) -> Vec2 {
    Vec2::new(x as f64 * 32. + 16., y as f64 * 32. + 16.)
}
fn declared_time(v: &Value, now: f64) -> f64 {
    if let Some(n) = v.as_f64() {
        return n;
    }
    let suffix = v.as_str().unwrap().strip_prefix("now").unwrap();
    now + if suffix.is_empty() {
        0.
    } else {
        suffix.parse::<f64>().unwrap()
    }
}
fn put(sim: &mut Sim, i: usize, at: Vec2) {
    let now = sim.server_time();
    let p = &mut sim.w.players[i];
    p.body.x = at.x;
    p.body.y = at.y;
    p.status = crate::Status::Alive;
    p.motion.path.clear();
    p.motion.slip = None;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
    p.walk_ticks = 0;
    p.walk_dir = 0;
}
fn add_status(sim: &mut Sim, i: usize, kind: StatusKind, ms: f64) {
    let now = sim.server_time();
    status::apply(
        &mut sim.w.players[i].statuses,
        now,
        status::StatusApply {
            kind,
            ms,
            source: status::StatusSource {
                id: Some(PlayerId(9000)),
                name: "helper".into(),
                owner_id: None,
            },
            ability: None,
            tag: None,
            value: None,
            add: None,
            data: None,
        },
    );
}
fn method_world(c: &Value) -> Sim {
    let id = c["id"].as_str().unwrap();
    let family = c["family"].as_str().unwrap();
    let input = &c["input"];
    let second = family == "lock" || matches!(id, "amove-acquire" | "amove-current-hidden");
    let (width, height) = (64, 40);
    let mut tiles = vec![0; width * height];
    let mut terrain = vec![0; width * height];
    for y in 0..height {
        for x in 0..width {
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                tiles[y * width + x] = 1;
            }
        }
    }
    if matches!(
        id,
        "gate-slip-center" | "ice-center" | "ice-home-frost" | "ice-all-hazards"
    ) {
        terrain[6 * width + 8] = 6;
    }
    if id == "ice-thin-strip" {
        terrain[6 * width + 7] = 6;
    }
    // Existing cfg(test) terrain fixture: real surface queries on declared tiles, no canonical map admission.
    let map = TileMap::new(width as u32, height as u32, tiles)
        .unwrap()
        .source_terrain_fixture(terrain);
    let mut sim = Sim::try_new(
        SimConfig {
            min_players: if second { 2 } else { 1 },
            lobby_seconds: 15.,
            fill_seconds: 0.,
            pvp_rules: false,
            wish_lock_ms: 0.,
            walk_hints: Some(true),
            hazards: if input["hazards"] == "all" {
                Mode::All
            } else {
                Mode::Map
            },
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: Some(0.),
                coliseum_schedule: None,
                patience_seconds: 86_400.,
                patience_min_seconds: 86_400.,
                sudden_death_seconds: 86_400.,
            }),
            ..Default::default()
        },
        Arena {
            map,
            spawns: vec![tile(5, 5), tile(10, 5)],
        },
        Secrets {
            spawn_seed: 7,
            order_salt: 0,
            reward_salt: [1, 2, 3, 4],
        },
    )
    .unwrap();
    let faction = if matches!(id, "ice-home-frost" | "ice-all-hazards") {
        FactionId::Frost
    } else {
        FactionId::Holy
    };
    assert_eq!(
        sim.add_player("helper-p0", Some(faction), false),
        Some(PlayerId(1))
    );
    if second {
        assert_eq!(
            sim.add_player("helper-p1", Some(FactionId::Frost), false),
            Some(PlayerId(2))
        );
    }
    assert_eq!(sim.step(), vec![crate::Event::RaidStarted]);
    put(&mut sim, 0, Vec2::new(200., 200.));
    let mut path = vec![Vec2::new(300., 200.)];
    if let Some(points) = input["path"].as_array() {
        path = points.iter().map(point).collect();
    }
    if id == "gate-path-empty" {
        path.clear();
    }
    if family == "lock" || matches!(id, "amove-acquire" | "amove-current-hidden") {
        path = vec![Vec2::new(250., 200.)];
    }
    if family == "waypoint" {
        path = vec![Vec2::new(200. + input["segment"].as_f64().unwrap(), 200.)];
    }
    if family == "direction" {
        let a = input["angle"].as_f64().unwrap();
        path = vec![Vec2::new(
            200. + crate::math::cos(a) * 100.,
            200. + crate::math::sin(a) * 100.,
        )];
    }
    if matches!(
        id,
        "gate-slip-center" | "ice-center" | "ice-home-frost" | "ice-all-hazards"
    ) {
        put(&mut sim, 0, tile(8, 6));
        path = vec![tile(12, 6)];
    }
    if id == "ice-thin-strip" {
        put(&mut sim, 0, Vec2::new(220., 208.));
        path = vec![tile(12, 6)];
    }
    if id == "ice-clear" {
        put(&mut sim, 0, tile(7, 6));
        path = vec![tile(12, 6)];
    }
    sim.w.players[0].motion.path.set_from(&path);
    if let Some(phase) = input["phase"].as_str() {
        sim.w.phase = match phase {
            "lobby" => Phase::Lobby,
            "ended" => Phase::Ended,
            _ => panic!("unrecorded phase"),
        };
    }
    match input["status"].as_str() {
        Some("dead") => sim.w.players[0].status = crate::Status::Dead,
        Some("hidden") => add_status(&mut sim, 0, StatusKind::Hidden, 5000.),
        Some("stun") => add_status(&mut sim, 0, StatusKind::Stun, 500.),
        Some("root") => add_status(&mut sim, 0, StatusKind::Root, 500.),
        None => (),
        Some(other) => panic!("{other}"),
    }
    if id == "speed-mirror-boost" {
        let mut rt = serde_json::to_value(&sim.w.players[0].modifiers).unwrap();
        rt["wire"][2] = input["speedMult"].clone();
        sim.w.players[0].modifiers = serde_json::from_value(rt).unwrap();
    }
    if id == "sentenced-hunt" {
        sim.w.players[0].vitals.faction = FactionId::Sentenced.into();
        sim.w.players[0].set_hunt_target(Some(PlayerId(9001)));
    }
    if input["weapon"] == "wand" {
        let p = &mut sim.w.players[0];
        p.weapon.weapon0 = Some(WeaponId::Wand);
        p.weapon.weapon1 = None;
        p.weapon.slot = 0;
        p.weapon.action = None;
        p.weapon.root_until = 0.;
        p.weapon.held = false;
        p.weapon.buffered_until = 0.;
        p.weapon.targeting = Default::default();
        p.weapon.last_shot_at = None;
    }
    let now = sim.server_time();
    if !input["rootUntil"].is_null() {
        sim.w.players[0].weapon.root_until = declared_time(&input["rootUntil"], now);
    }
    if let Some(a) = input["action"].as_object() {
        let kind = match a["kind"].as_str().unwrap() {
            "swing" => crate::state::ActionKind::Swing,
            "draw" => crate::state::ActionKind::Draw,
            _ => panic!("action"),
        };
        let weapon = if kind == crate::state::ActionKind::Draw {
            WeaponId::Bow
        } else if family == "weaponHoldsAt" {
            WeaponId::Sword
        } else {
            WeaponId::Wand
        };
        let packet = crate::modifiers::packet(&sim.w.players[0].core, weapon);
        sim.w.players[0].weapon.action = Some(crate::state::PendingAction {
            kind,
            weapon,
            target: None,
            started_at: now,
            lands_at: declared_time(&a["landsAt"], now),
            a: 0.,
            packet,
            roam_armed: false,
        });
    }
    if let Some(held) = input["held"].as_bool() {
        sim.w.players[0].weapon.held = held;
    }
    if !input["ready"].is_null() {
        sim.w.players[0].weapon.ready_at = declared_time(&input["ready"], now);
    }
    if !input["bufferedUntil"].is_null() {
        sim.w.players[0].weapon.buffered_until = declared_time(&input["bufferedUntil"], now);
    }
    if second {
        let x = input["targetX"].as_f64().unwrap_or(820.);
        put(&mut sim, 1, Vec2::new(x, 200.));
        if input["targetStatus"] == "hidden" {
            add_status(&mut sim, 1, StatusKind::Hidden, 5000.);
        }
    }
    if family == "lock" {
        let p = &mut sim.w.players[0];
        p.weapon.targeting.target = Some(if input["lock"] == "missing" {
            PlayerId(9002)
        } else {
            PlayerId(2)
        });
        p.weapon.targeting.seen = input["lockSeen"].as_bool().unwrap();
        p.weapon.targeting.plan_at = Some(declared_time(&input["planAt"], now));
        p.weapon.targeting.goal = if input["lockGoal"].is_null() {
            None
        } else {
            Some(point(&input["lockGoal"]))
        };
    }
    if family == "amove" {
        sim.w.players[0].weapon.targeting.attack_move = Some(point(&input["attackMoveGoal"]));
    }
    if family == "hysteresis" {
        let p = &mut sim.w.players[0];
        p.walk_ticks = input["oldTicks"].as_u64().unwrap() as u8;
        p.walk_dir = input["oldDir"].as_u64().unwrap() as u8;
    }
    sim
}
fn full_method_gates(sim: &mut Sim) {
    // Root-approved declared readonly installer context. Source empty-camp createGameWorld
    // installs all7 move modifiers. This static context is NEVER stepped/restored.
    sim.k.config.mob_mode = crate::mob_runtime::MobMode::Pve;
    sim.k.config.initial_loot = true;
    sim.k.config.quests = true;
    assert_eq!(Plan::of(&sim.k).move_modifiers.live().len(), 7);
}
fn json_hint(h: WalkHint) -> Value {
    json!({"dir":h.dir,"ticks":h.ticks})
}

#[test]
fn immutable_source_eighteen_npc_mirror_timings_match_exact_bits() {
    let doc = corpus();
    let rows: Vec<_> = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] == "mirrorTimings")
        .collect();
    assert_eq!(rows.len(), 18);
    for c in rows {
        let i = &c["input"];
        let weapon = WeaponId::parse(i["weapon"].as_str().unwrap()).unwrap();
        let f = crate::content::faction(FactionId::parse(i["faction"].as_str().unwrap()).unwrap());
        let t = crate::content::mirror_timings(
            &f,
            weapon,
            i["asMult"].as_f64().unwrap(),
            i["windupMult"].as_f64().unwrap(),
            true,
        );
        for (name, actual) in [
            ("interval", t.interval),
            ("windup", t.windup),
            ("root", t.root),
            ("intervalMs", t.interval * 1000.),
            ("windupMs", t.windup * 1000.),
        ] {
            assert_eq!(
                actual.to_bits(),
                c["observed"][name].as_f64().unwrap().to_bits(),
                "{} {name}",
                c["id"]
            );
        }
        assert_eq!(t.ranged, c["observed"]["ranged"].as_bool().unwrap());
    }
}

// JSON integer/f64 storage is not an ECMAScript Number distinction. Keep the actual
// binary64 values exact; no tolerance, rounding or expected-value substitution.
fn numeric_values_equal(actual: &Value, want: &Value, label: &str) {
    match (actual, want) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(
            a.as_f64().unwrap().to_bits(),
            b.as_f64().unwrap().to_bits(),
            "{label}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label}");
            for (a, b) in a.iter().zip(b) {
                numeric_values_equal(a, b, label);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label}");
            for (k, b) in b {
                numeric_values_equal(&a[k], b, label);
            }
        }
        _ => assert_eq!(actual, want, "{label}"),
    }
}
fn consume_helper(c: &Value) {
    let id = c["id"].as_str().unwrap();
    let family = c["family"].as_str().unwrap();
    let mut sim = method_world(c);
    let mut events = vec![];
    if family == "hook" {
        // Ordinary accepted Move after declared helper put; before selecting the
        // source's noncanonical readonly installer context.
        sim.w.players[0].motion.path.clear();
        sim.submit(
            PlayerId(1),
            crate::validate(crate::RawCommand::Move {
                x: 300.,
                y: 260.,
                seq: Some(1),
            })
            .unwrap(),
        )
        .unwrap();
        sim.step();
        let p = &sim.w.players[0];
        assert_eq!(
            json_hint(WalkHint {
                dir: p.walk_dir,
                ticks: p.walk_ticks
            }),
            json!({"dir":c["input"]["before"]["dir"],"ticks":c["input"]["before"]["ticks"]})
        );
        numeric_values_equal(
            &serde_json::to_value(p.motion.path.as_slice()).unwrap(),
            &c["input"]["before"]["path"],
            id,
        );
        full_method_gates(&mut sim);
        let args = if c["input"]["hook"] == "teleported" {
            HookArgs::Teleported
        } else {
            HookArgs::RunEnded
        };
        let hook_key = args.hook().key();
        let random_before = (
            sim.w.spawn_rng.clone(),
            sim.w.reward_rng.words(),
            sim.w.wind_rng.clone(),
        );
        crate::hooks::fire(
            &mut Hx {
                k: &sim.k,
                w: &mut sim.w,
                ev: &mut events,
                fx: None,
                stats: Default::default(),
            },
            args,
        );
        assert_eq!(hook_key, c["observed"]["hook"].as_str().unwrap());
        assert_eq!(
            (
                sim.w.spawn_rng.clone(),
                sim.w.reward_rng.words(),
                sim.w.wind_rng.clone()
            ),
            random_before
        );
        let players: Vec<_> = sim
            .w
            .players
            .iter()
            .map(|p| json!({"dir":p.walk_dir,"ticks":p.walk_ticks}))
            .collect();
        assert_eq!(json!(players), c["observed"]["players"], "{id}");
        assert!(events.is_empty());
        assert_eq!(c["observed"]["events"], json!([]));
    } else {
        full_method_gates(&mut sim);
        let before = serde_json::to_value(&sim.w).unwrap();
        let rng = sim.w.spawn_rng.clone();
        let mut seen = vec![];
        match c["observed"]["kind"].as_str().unwrap() {
            "walkHintOf" => {
                let factor = c["input"]["moveModifier"]
                    .as_str()
                    .map(|s| s.strip_prefix("returns").unwrap().parse::<f64>().unwrap());
                let mut callback = |dt| {
                    seen.push(dt);
                    factor.expect("declared callback factor")
                };
                let h = compute(&sim.k, &sim.w, FighterIx::of_slot(0), |dt| {
                    let base =
                        move_factor(&sim.k, &sim.w, FighterIx::of_slot(0), Default::default());
                    if factor.is_some() {
                        base * callback(dt)
                    } else {
                        base
                    }
                });
                assert_eq!(json_hint(h), c["observed"]["hint"], "{id}");
                if id == "factor-dt0" {
                    let mut factors: Vec<_> = Plan::of(&sim.k)
                        .move_modifiers
                        .live()
                        .iter()
                        .map(|(name, _)| {
                            move_value(
                                name,
                                &sim.k,
                                &sim.w,
                                FighterIx::of_slot(0),
                                Default::default(),
                            )
                        })
                        .collect();
                    factors.push(callback(0.));
                    numeric_values_equal(&json!(factors), &c["observed"]["dtSeen"], id);
                    numeric_values_equal(&json!(seen), &c["input"]["seen"], id);
                }
                if id == "factor-hazard-noninterference" {
                    assert!(sim.w.terrain.damage.is_empty() && sim.w.terrain.heal.is_empty());
                    let seconds = sim.w.terrain.seconds;
                    numeric_values_equal(
                        &json!({"damage":{},"seconds":{"ember":seconds[0],"bog":seconds[1],"ice":seconds[2],"light":seconds[3]},"heal":{}}),
                        &c["observed"]["afterHazards"],
                        id,
                    );
                    assert_eq!(
                        serde_json::to_value(&sim.w.players[0].motion.slip).unwrap(),
                        c["observed"]["afterSlip"]
                    );
                }
                if id == "ice-thin-strip" {
                    for probe in c["input"]["probes"].as_array().unwrap() {
                        let got = traction_at(
                            &sim.k,
                            &sim.w.players[0].core,
                            Vec2::new(probe["x"].as_f64().unwrap(), 208.),
                        );
                        assert_eq!(
                            got,
                            probe["accel"].as_f64().unwrap(),
                            "{id} actual surface probe"
                        );
                    }
                }
            }
            "weaponHoldsAt" => assert_eq!(
                queries::weapon_holds_at(&sim.w.players[0].core, sim.server_time() + 50.),
                c["observed"]["observed"].as_bool().unwrap(),
                "{id}"
            ),
            "updateWalkHints" => {
                assert_eq!(
                    walk_hint_of(&sim.k, &sim.w, Default::default(), FighterIx::of_slot(0)).dir,
                    c["input"]["newDirObservedBefore"].as_u64().unwrap() as u8
                );
                let mut cx = crate::systems::Cx {
                    #[cfg(feature = "trusted-status-probes")]
                    probe: None,
                    k: &sim.k,
                    w: &mut sim.w,
                    s: &mut sim.s,
                    pf: &mut sim.pf,
                    ev: &mut events,
                    stats: Default::default(),
                };
                update(&mut cx);
                let p = &sim.w.players[0];
                assert_eq!(
                    json_hint(WalkHint {
                        dir: p.walk_dir,
                        ticks: p.walk_ticks
                    }),
                    c["observed"]["observed"],
                    "{id}"
                );
            }
            other => panic!("unhandled actual helper output {other:?}"),
        }
        let mut after = serde_json::to_value(&sim.w).unwrap();
        let mut before = before;
        if family == "hysteresis" {
            for value in [&mut before, &mut after] {
                for p in value["players"].as_array_mut().unwrap() {
                    p.as_object_mut().unwrap().remove("walk_dir");
                    p.as_object_mut().unwrap().remove("walk_ticks");
                }
            }
        }
        assert_eq!(
            after, before,
            "{id}: preview cannot mutate gameplay/vision/hazards"
        );
        assert_eq!(sim.w.spawn_rng, rng);
    }
    assert!(
        events.is_empty(),
        "{id}: actual native producer emits no events"
    );
    assert_eq!(c["events"], json!([]), "{id}");
    assert_eq!(c["draws"], json!(0), "{id}");
}
#[test]
fn immutable_source_fifty_one_declared_helper_contexts() {
    let doc = corpus();
    let mut failed = vec![];
    let mut count = 0;
    for c in doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] != "mirrorTimings")
    {
        if std::panic::catch_unwind(|| consume_helper(c)).is_err() {
            failed.push(c["id"].as_str().unwrap());
        }
        count += 1;
    }
    assert_eq!(count, 51);
    assert!(failed.is_empty(), "actual helper mismatches: {failed:?}");
}

#[test]
fn captured_npc_timings_drive_real_ai_aim_proposals() {
    use crate::mob_runtime::{ActorOrigin, ActorProvenance, Mob, MobRuntime};
    let doc = corpus();
    let pair = "slow-as-increased-windup";
    let row = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["family"] == "mirrorTimings"
                && c["input"]["weapon"] == "wand"
                && c["input"]["pair"] == pair
        })
        .unwrap();
    // Declared NPC method inputs built through the actual typed birth/wake helpers.
    // Not a source-earned NPC fight, canonical restore, or a full AI outcome claim.
    let mut sim = super::tests::construct(Some(false));
    sim.step();
    sim.submit(
        PlayerId(1),
        crate::validate(crate::RawCommand::Move {
            x: 600.,
            y: 400.,
            seq: Some(1),
        })
        .unwrap(),
    )
    .unwrap();
    for _ in 0..3 {
        sim.step();
    }
    let now = sim.server_time();
    let target = sim.w.players[0].pos();
    let from = Vec2::new(target.x + 320., target.y - 40.);
    let ty = crate::mob_catalog::mob_type_by_id("flameCaller").unwrap();
    let provenance = ActorProvenance {
        id: PlayerId(2),
        origin: ActorOrigin::Practice {
            birth_serial: 1,
            born_tick: sim.tick(),
            camp: 101,
            mob_type: ty.id,
            elite: false,
        },
    };
    let mut mob = Mob::born(&provenance, from, 0., now);
    assert_eq!(mob.core.weapon.weapon0, Some(WeaponId::Wand));
    let mut modifier = serde_json::to_value(&mob.core.modifiers).unwrap();
    modifier["wire"][0] = json!(row["input"]["asMult"].as_f64().unwrap() * 1000.);
    modifier["wire"][1] = json!(row["input"]["windupMult"].as_f64().unwrap() * 1000.);
    mob.core.modifiers = serde_json::from_value(modifier).unwrap();
    super::super::mob_ai::wake(mob.brain.as_mut().unwrap(), PlayerId(1), now);
    sim.w.mobs.push(mob);
    sim.w.actor_history.push(provenance);
    sim.w.next_id = 3;
    sim.w.mob_runtime = Some(MobRuntime {
        combat: true,
        camps: vec![],
        life: vec![],
    });
    let vel = super::super::targeting::velocity(&sim.w.players[0].core, now);
    let decide = |windup| {
        crate::combat_policy::decide(
            crate::combat_policy::Input {
                from,
                to: target,
                vel,
                los: true,
                weapon: WeaponId::Wand,
                windup,
                lock: false,
                delay: TICK_MS / 1000.,
            },
            |_, _| true,
        )
    };
    let expected = decide(row["observed"]["windup"].as_f64().unwrap());
    assert!(matches!(
        expected.movement,
        crate::combat_policy::Move::Stop
    ));
    let sheet = sim
        .w
        .paced_faction_spec(sim.w.fighter_idx(PlayerId(2)).unwrap())
        .unwrap();
    assert_eq!(sheet.rate, crate::content::faction(FactionId::Fire).rate);
    let old = crate::content::npc_timings(
        WeaponId::Wand,
        crate::content::attack_interval(
            &sheet,
            WeaponId::Wand,
            row["input"]["asMult"].as_f64().unwrap(),
        ),
    );
    assert!(
        (expected.aim - decide(old.windup).aim).abs() > 1e-6,
        "source tuple must catch predecessor timing bypass"
    );
    let mut events = vec![];
    super::super::mob_ai::think(&mut crate::systems::Cx {
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &sim.k,
        w: &mut sim.w,
        s: &mut sim.s,
        pf: &mut sim.pf,
        ev: &mut events,
        stats: Default::default(),
    });
    let mob = sim.w.mobs.get(PlayerId(2)).unwrap();
    let aim = mob
        .brain
        .as_ref()
        .unwrap()
        .last_aim
        .expect("real AI produced Aim through Cx::propose");
    assert!(
        (aim - expected.aim).abs() <= 1e-12,
        "{pair}: actual AI caller must consume source NPC timings"
    );
    let queued = mob
        .core
        .inputs
        .aim
        .expect("actual validated ordinary Aim is queued");
    assert!((queued - expected.aim).abs() <= 1e-12);
}
