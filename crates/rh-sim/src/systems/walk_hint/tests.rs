use super::*;
use crate::{validate, Arena, FactionId, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap};
use serde_json::{json, Value};

fn corpus() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/walk-hint/repair/source.json"
    )))
    .unwrap()
}

/// Released source14 constructor map/seed/ordinary join. Its three 1e6-second deadlines
/// exceed the admitted native 86400-second bound, so this fixture uses that bound. Both
/// are beyond the unchanged 700ms slice; this is not whole-configuration/World equality.
pub(super) fn construct(hints: Option<bool>) -> Sim {
    construct_with(hints, Some(0.), false)
}

fn construct_with(hints: Option<bool>, first_patience: Option<f64>, second: bool) -> Sim {
    construct_profile(hints, first_patience, second, crate::FactionMode::Off)
}

fn construct_profile(
    hints: Option<bool>,
    first_patience: Option<f64>,
    second: bool,
    faction_mode: crate::FactionMode,
) -> Sim {
    let (width, height) = (64, 40);
    let mut tiles = vec![0; width * height];
    for y in 0..height {
        for x in 0..width {
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                tiles[y * width + x] = 1;
            }
        }
    }
    let arena = Arena {
        map: TileMap::new(width as u32, height as u32, tiles).unwrap(),
        spawns: vec![Vec2::new(176., 176.), Vec2::new(176., 208.)],
    };
    let mut sim = Sim::try_new(
        SimConfig {
            min_players: 1,
            lobby_seconds: 15.,
            fill_seconds: 0.,
            pvp_rules: false,
            wish_lock_ms: 0.,
            walk_hints: hints,
            faction_mode,
            lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: first_patience,
                coliseum_schedule: None,
                patience_seconds: 86_400.,
                patience_min_seconds: 86_400.,
                sudden_death_seconds: 86_400.,
            }),
            ..Default::default()
        },
        arena,
        Secrets {
            spawn_seed: 7,
            order_salt: 0,
            reward_salt: [1, 2, 3, 4],
        },
    )
    .unwrap();
    assert_eq!(
        sim.add_player("walk-hint-probe", Some(FactionId::Holy), false),
        Some(PlayerId(1))
    );
    if second {
        assert_eq!(
            sim.add_player("second", Some(FactionId::Fire), false),
            Some(PlayerId(2))
        );
    }
    sim
}

fn submit_frame(sim: &mut Sim, frame: &Value) {
    let order = &frame["order"];
    if order.is_null() {
        return;
    }
    assert_eq!(order["accepted"], true);
    let p = &order["msg"];
    let raw = match order["type"].as_str().unwrap() {
        "move" => RawCommand::Move {
            x: p["x"].as_f64().unwrap(),
            y: p["y"].as_f64().unwrap(),
            seq: Some(p["seq"].as_u64().unwrap() as u8),
        },
        "stop" => RawCommand::Stop {
            seq: Some(p["seq"].as_u64().unwrap() as u8),
        },
        other => panic!("unexpected released source order {other}"),
    };
    sim.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
}

fn near(actual: f64, want: &Value, label: &str) {
    let want = want.as_f64().unwrap();
    assert!(
        (actual - want).abs() <= 1e-6,
        "{label}: actual={actual} source={want}"
    );
}

#[test]
fn actual_source_fourteen_world_frames() {
    let source = corpus();
    let frames = source["frames"].as_array().unwrap();
    assert_eq!(frames.len(), 14);
    for field in [
        "patienceSeconds",
        "patienceMinSeconds",
        "suddenDeathSeconds",
    ] {
        assert_eq!(
            source["profile"]["constructor"]["config"][field].as_f64(),
            Some(1e6)
        );
    }
    let end_ms = frames.last().unwrap()["snapshot"]["serverTime"]
        .as_f64()
        .unwrap();
    assert_eq!(end_ms, 700.);
    for deadline_seconds in [
        86_400.,
        source["profile"]["constructor"]["config"]["patienceSeconds"]
            .as_f64()
            .unwrap(),
    ] {
        assert!(end_ms < deadline_seconds * 1000.);
    }
    let mut sim = construct(Some(true));
    let mut main = crate::rng::Mulberry32::new(7);
    let draws = source["setup"]["draws"].as_array().unwrap();
    assert_eq!(draws.len(), 2);
    for draw in draws {
        assert_eq!(main.next_f64(), draw.as_f64().unwrap());
    }
    for (i, frame) in frames.iter().enumerate() {
        submit_frame(&mut sim, frame);
        let events = sim.step();
        let source_events: Vec<_> = events
            .iter()
            .map(|e| match e {
                crate::Event::RaidStarted => json!({"type":"raidStarted"}),
                other => panic!("unexpected native event in released movement slice: {other:?}"),
            })
            .collect();
        assert_eq!(
            json!(source_events),
            frame["events"],
            "{} event order",
            frame["label"]
        );
        assert!(frame["draws"].as_array().unwrap().is_empty());
        assert_eq!(
            sim.w.spawn_rng, main,
            "frame{i}: actual main stream has only setup's two draws"
        );
        let expected = &frame["snapshot"];
        let p = &sim.w.players[0];
        let want = &expected["players"][0];
        assert_eq!(
            sim.tick(),
            expected["tick"].as_u64().unwrap() as u32,
            "{}",
            frame["label"]
        );
        near(sim.server_time(), &expected["serverTime"], "clock");
        assert_eq!(sim.phase(), Phase::Active);
        near(p.body.x, &want["x"], "x");
        near(p.body.y, &want["y"], "y");
        near(p.body.facing, &want["facing"], "facing");
        near(p.vitals.hp, &want["hp"], "hp");
        near(p.vitals.max_hp, &want["maxHp"], "maxHp");
        assert_eq!(p.weapon.weapon0, None);
        assert_eq!(p.weapon.weapon1, None);
        assert!(p.weapon.action.is_none());
        assert!(p.weapon.targeting.target.is_none());
        assert_eq!(
            p.modifiers.mirrors().speed_mult,
            want["speedMult"].as_f64().unwrap() / 1000.
        );
        assert_eq!(
            p.modifiers.mirrors().as_mult,
            want["asMult"].as_f64().unwrap() / 1000.
        );
        assert_eq!(
            p.modifiers.mirrors().windup_mult,
            want["windupMult"].as_f64().unwrap() / 1000.
        );
        let history = want["history"].as_array().unwrap();
        assert_eq!(p.body.history.len(), history.len());
        for (sample, expected) in p.body.history.iter().zip(history) {
            near(sample.t, &expected["t"], "history t");
            near(sample.x, &expected["x"], "history x");
            near(sample.y, &expected["y"], "history y");
        }
        assert_eq!(
            p.walk_dir,
            want["extra"]["walkDir"].as_u64().unwrap() as u8,
            "{} dir",
            frame["label"]
        );
        assert_eq!(
            p.walk_ticks,
            want["extra"]["walkTicks"].as_u64().unwrap() as u8,
            "{} ticks",
            frame["label"]
        );
        let path = want["path"].as_array().unwrap();
        assert_eq!(p.motion.path.len(), path.len());
        for (at, want) in p.motion.path.as_slice().iter().zip(path) {
            near(at.x, &want["x"], "path x");
            near(at.y, &want["y"], "path y");
        }
    }
}

fn gameplay_world(sim: &Sim) -> Value {
    let mut world = serde_json::to_value(&sim.w).unwrap();
    for p in world["players"].as_array_mut().unwrap() {
        p.as_object_mut().unwrap().remove("walk_dir");
        p.as_object_mut().unwrap().remove("walk_ticks");
    }
    world
}

#[test]
fn installed_hint_switch_is_gameplay_rng_event_and_vision_readonly() {
    let source = corpus();
    let mut with = construct(Some(true));
    let mut without = construct(Some(false));
    for frame in source["frames"].as_array().unwrap() {
        submit_frame(&mut with, frame);
        submit_frame(&mut without, frame);
        assert_eq!(with.step(), without.step());
        assert_eq!(gameplay_world(&with), gameplay_world(&without));
    }
    // The only excluded state is the presentation pair, not vision/path/status/RNG/hazard bookkeeping.
    assert_ne!(with.w.players[0].walk_dir, without.w.players[0].walk_dir);
    assert_eq!(without.w.players[0].walk_ticks, 0);
}

#[test]
fn actual_produced_hint_clone_restore_keeps_bytes_and_input_continuation() {
    let source = corpus();
    let mut sim = construct(Some(true));
    for frame in source["frames"].as_array().unwrap().iter().take(4) {
        submit_frame(&mut sim, frame);
        sim.step();
    }
    assert!(sim.w.players[0].walk_ticks > 0);
    let mut cloned = sim.clone();
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    assert_eq!(cloned.state_hash(), restored.state_hash());
    for frame in source["frames"].as_array().unwrap().iter().skip(4) {
        submit_frame(&mut cloned, frame);
        submit_frame(&mut restored, frame);
        assert_eq!(cloned.step(), restored.step());
        assert_eq!(cloned.state_hash(), restored.state_hash());
    }
    assert_eq!(restored.w.players[0].walk_ticks, 0);
    assert_ne!(
        restored.w.players[0].walk_dir, 0,
        "zero ticks retains a real old direction"
    );
}

#[test]
fn every_existing_gate_preset_has_exact_hint_variants() {
    use crate::{mob_runtime::MobMode, FactionMode};
    let base = construct(None);
    // Static plan/config queries only: no World is advanced with these declared installer combinations.
    for training in [false, true] {
        for mode in [
            FactionMode::Off,
            FactionMode::EngagementHoly,
            FactionMode::EngagementHolyPlagueFireFrost,
            FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        ] {
            for mobs in [MobMode::Off, MobMode::Pve] {
                if training && mobs != MobMode::Off {
                    continue;
                }
                for quests in [false, true] {
                    let mut k = base.k.clone();
                    k.config.training = training;
                    k.config.faction_mode = mode;
                    k.config.mob_mode = mobs;
                    k.config.quests = quests;
                    let mut prior = None;
                    for hints in [None, Some(false), Some(true)] {
                        k.config.walk_hints = hints;
                        let systems = Plan::of(&k).systems.live();
                        let enabled = systems
                            .iter()
                            .any(|(name, _)| *name == "walkHint.updateWalkHints");
                        assert_eq!(enabled, hints.unwrap_or(training));
                        if enabled {
                            assert_eq!(systems.last().unwrap().0, "walkHint.updateWalkHints");
                        }
                        let others: Vec<_> = systems
                            .iter()
                            .map(|(name, _)| *name)
                            .filter(|name| *name != "walkHint.updateWalkHints")
                            .collect();
                        if let Some(prior) = &prior {
                            assert_eq!(&others, prior, "hint override changes no other installer");
                        } else {
                            prior = Some(others);
                        }
                    }
                }
            }
        }
    }
    assert_eq!(SimConfig::default().walk_hints, None);
    let cp = serde_json::to_value(&base).unwrap();
    assert_eq!(cp["statics"]["config"]["walk_hints"], json!(None::<bool>));
}

/// Genuine scheduled movement, then ordinary Clone/restore. The allocation window contains
/// whole real steps while positive hints are emitted, not just the pure preview kernel.
#[test]
#[ignore = "global dhat allocator; run this exact test alone with --ignored --test-threads=1"]
fn active_hint_original_clone_restore_warm_steps_allocate_zero() {
    warm_steps_allocate_zero(true);
}

#[test]
#[ignore = "global dhat allocator; run this exact test alone with --ignored --test-threads=1"]
fn disabled_hint_original_clone_restore_identical_workload_allocates_zero() {
    warm_steps_allocate_zero(false);
}

fn warm_steps_allocate_zero(hints: bool) {
    let mut original = construct(Some(hints));
    original.step();
    original
        .submit(
            PlayerId(1),
            validate(RawCommand::Move {
                x: 1800.,
                y: 208.,
                seq: Some(1),
            })
            .unwrap(),
        )
        .unwrap();
    for _ in 0..10 {
        original.step();
    }
    assert_eq!(original.w.players[0].walk_ticks > 0, hints);
    let legacy_cold_storage = original.w.players[0].vision.test_legacy_clone_storage();
    let clone = original.clone();
    let restored = Sim::restore(serde_json::to_value(&original).unwrap()).unwrap();
    let mut worlds = [original, clone, restored];
    let cold_storage: [_; 3] =
        std::array::from_fn(|i| worlds[i].w.players[0].vision.test_storage());
    let mut events: [Vec<crate::Event>; 3] = std::array::from_fn(|_| Vec::with_capacity(128));
    // One ordinary post-Clone/restore step warms reusable scratch/output only. Retain
    // this exact original workload: do not wait out later capacity growth.
    for (sim, events) in worlds.iter_mut().zip(&mut events) {
        sim.step_into(events);
    }
    assert_eq!(worlds[0].state_hash(), worlds[1].state_hash());
    assert_eq!(worlds[0].state_hash(), worlds[2].state_hash());
    let _profiler = dhat::Profiler::builder().testing().build();
    let _ = dhat::HeapStats::get();
    let storage_before: [_; 3] =
        std::array::from_fn(|i| worlds[i].w.players[0].vision.test_storage());
    let mut trace = [[(0u32, 0u64, 0usize, 0usize); 90]; 3];
    let mut counts = [0; 3];
    for (i, (sim, events)) in worlds.iter_mut().zip(&mut events).enumerate() {
        let before = dhat::HeapStats::get().total_blocks;
        for sample in &mut trace[i] {
            events.clear();
            // The optional conformance log is test-only growing scratch, not gameplay work.
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
            let step_before = dhat::HeapStats::get().total_blocks;
            sim.step_into(events);
            let used = dhat::HeapStats::get().total_blocks - step_before;
            let (len, capacity, _) = sim.w.players[0].vision.test_storage();
            *sample = (sim.tick(), used, len, capacity);
            assert_eq!(sim.w.players[0].walk_ticks > 0, hints);
            assert!(events.is_empty());
        }
        counts[i] = dhat::HeapStats::get().total_blocks - before;
    }
    eprintln!("hints={hints}: legacy cold VecDeque clone(capacity,payloadB)={legacy_cold_storage:?}; repaired cold trail(len,capacity,payloadB)={cold_storage:?}; measured-start={storage_before:?}, allocations={counts:?}");
    for (i, steps) in trace.iter().enumerate() {
        for &(tick, blocks, len, capacity) in steps {
            if blocks != 0 {
                eprintln!(
                    "world{i} tick{tick}: blocks{blocks}, trail len{len}, capacity{capacity}"
                );
            }
        }
    }
    assert_eq!(
        counts, [0; 3],
        "90 actual whole steps per original/Clone/restore, hints={hints}"
    );
    assert_eq!(worlds[0].state_hash(), worlds[1].state_hash());
    assert_eq!(worlds[0].state_hash(), worlds[2].state_hash());
    eprintln!("hints={hints}: original/Clone/restore 90 steps each, allocations={counts:?}");
}

#[test]
fn actual_teleport_and_run_end_append_hooks_clear_positive_hints_keep_direction() {
    // Separate genuine native lifecycle control, not a captured source World outcome.
    let mut teleport = construct_with(Some(true), Some(0.15), true);
    teleport.step();
    teleport
        .submit(
            PlayerId(1),
            validate(RawCommand::Move {
                x: 1800.,
                y: 500.,
                seq: Some(1),
            })
            .unwrap(),
        )
        .unwrap();
    teleport.step();
    teleport.step();
    assert!(teleport.w.players[0].walk_ticks > 0);
    let dir = teleport.w.players[0].walk_dir;
    assert_ne!(dir, 0);
    let events = teleport.step();
    assert!(events.contains(&crate::Event::Teleported));
    assert!(teleport.w.rt.gates_locked);
    assert_eq!(teleport.w.players[0].walk_ticks, 0);
    assert_eq!(teleport.w.players[0].walk_dir, dir);
    assert!(teleport.w.players.iter().all(|p| p.walk_ticks == 0));
    let restored = Sim::restore(serde_json::to_value(&teleport).unwrap()).unwrap();
    assert_eq!(restored.state_hash(), teleport.state_hash());

    let mut ended = construct_with(Some(true), Some(0.), true);
    ended.step();
    ended
        .submit(
            PlayerId(1),
            validate(RawCommand::Move {
                x: 1800.,
                y: 500.,
                seq: Some(1),
            })
            .unwrap(),
        )
        .unwrap();
    ended.step();
    assert!(ended.w.players[0].walk_ticks > 0);
    let dir = ended.w.players[0].walk_dir;
    ended.remove_player(PlayerId(2));
    let events = ended.step();
    assert!(events.contains(&crate::Event::RaidEnded));
    assert_eq!(ended.phase(), Phase::Ended);
    assert_eq!(ended.w.players[0].walk_ticks, 0);
    assert_eq!(ended.w.players[0].walk_dir, dir);
    assert!(ended.w.players.iter().all(|p| p.walk_ticks == 0));
    assert_eq!(
        Sim::restore(serde_json::to_value(&ended).unwrap())
            .unwrap()
            .state_hash(),
        ended.state_hash()
    );
}

include!("caller_tests.rs");
