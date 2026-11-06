//! Restored state and privacy through real Source lifecycle producers.
use super::*;
use crate::{FactionId, RawCommand, Sim};
use serde_json::{json, Value};
fn joined(case_index: usize) -> Sim {
    let source = crate::collision::tests::fixture();
    let input = &source["cases"][case_index]["input"];
    let mut sim = super::source_tests::make(&source, input);
    for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
        sim.add_player(
            &format!("name{i}"),
            Some(FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
            p["bot"].as_bool().unwrap_or(false),
        )
        .unwrap();
    }
    sim
}
fn restore(value: Value) -> Result<Sim, crate::CheckpointError> {
    let text = serde_json::to_string(&value).unwrap();
    Sim::restore(&mut serde_json::Deserializer::from_str(&text))
}
fn roundtrip(sim: &Sim) {
    let mut a = sim.clone();
    let mut b = restore(serde_json::to_value(sim).unwrap()).unwrap();
    assert_eq!(a.state_hash(), b.state_hash());
    assert_eq!(a.k.planning_walks, b.k.planning_walks);
    assert_eq!(a.k.arena_source, b.k.arena_source);
    for _ in 0..8 {
        assert_eq!(a.step(), b.step());
        assert_eq!(a.state_hash(), b.state_hash());
    }
}
fn reject(sim: &Sim, path: &str, value: Value) {
    let mut v = serde_json::to_value(sim).unwrap();
    *v.pointer_mut(path)
        .unwrap_or_else(|| panic!("missing mutation path {path}")) = value;
    assert!(restore(v).is_err(), "admitted malformed {path}");
}
#[test]
fn planning_restore_rejects_unproduced_and_incoherent_private_records() {
    let mut sim = joined(1);
    sim.step();
    assert_eq!(sim.w.phase, Phase::Planning);
    roundtrip(&sim);
    for (path, value) in [
        ("/world/plan_ends_at", json!(0)),
        ("/world/planning/starters", json!(0)),
        ("/world/planning/started_humans", json!(99)),
        ("/world/planning/deals/0/1/spawns/0", json!(999)),
        ("/world/planning/deals/0/1/pick", json!(0)),
        ("/world/planning/deals/0/1/boons", json!(["unproduced"])),
        ("/world/planning/deals/0/1/sent/taken/0", json!(true)),
        ("/world/planning/deals/0/1/sent/endsAt", json!(0)),
        ("/world/planning/holders", json!([[0, 999]])),
        ("/world/planning/report/tierPairs", json!(99)),
        ("/world/rt/started_with", json!(0)),
        ("/statics/config/lifecycle", json!("Off")),
    ] {
        reject(&sim, path, value);
    }
    sim.submit(
        PlayerId(1),
        crate::validate(RawCommand::Plan {
            spawn: Some(0),
            boon: None,
            ready: None,
        })
        .unwrap(),
    )
    .unwrap();
    sim.step();
    roundtrip(&sim);
    let holder = serde_json::to_value(sim.w.planning.as_ref().unwrap().holders[0]).unwrap();
    reject(&sim, "/world/planning/holders", json!([holder, holder]));
}
#[test]
fn locked_world_restore_requires_coherent_producer_clocks_and_continues() {
    let mut sim = joined(16);
    for _ in 0..4 {
        sim.step();
    }
    assert!(sim.w.rt.gates_locked);
    roundtrip(&sim);
    for (path, value) in [
        ("/world/rt/in_coliseum", json!(false)),
        ("/world/rt/gates_locked", json!(false)),
        ("/world/rt/sudden_death_at", json!(0)),
        ("/world/rt/patience_ends_at", json!(500)),
        ("/world/abilities/teleported_at", Value::Null),
        ("/world/abilities/teleported_at", json!(250)),
        ("/world/raid_started_at", json!(200)),
    ] {
        reject(&sim, path, value);
    }
    reject(
        &sim,
        "/world/players/0/vision/reveals/0/variant",
        json!("Locked"),
    );
    let mut unlocked = sim.clone();
    unlocked.remove_player(PlayerId(1));
    unlocked.step();
    assert!(!unlocked.w.rt.gates_locked);
    roundtrip(&unlocked);
    reject(&unlocked, "/world/abilities/teleported_at", Value::Null);
    let now = sim.w.server_time;
    reject(
        &sim,
        "/world/players/0/core/weapon/last_shot_at",
        json!(now + 1.),
    );
}
#[test]
fn retained_active_deals_and_voided_clocks_restore_without_cleaning_history() {
    let mut sim = joined(0);
    for _ in 0..5 {
        sim.step();
    }
    assert_eq!(sim.w.phase, Phase::Active);
    let before = sim.w.planning.clone();
    sim.remove_player(PlayerId(1));
    assert_eq!(sim.w.planning, before);
    roundtrip(&sim);
    let mut sim = joined(0);
    for _ in 0..5 {
        sim.step();
    }
    sim.abandon_player(PlayerId(1));
    assert!(sim.w.rt.voided);
    let time = sim.w.server_time;
    let hp = sim.w.players[0].vitals.hp;
    sim.step();
    assert_eq!(sim.w.server_time, time + 50.);
    assert_eq!(sim.w.players[0].vitals.hp, hp);
    roundtrip(&sim);
}
#[test]
fn planning_owner_facts_resolve_map_options_without_disclosing_other_deals() {
    let mut sim = joined(1);
    let ev = sim.step();
    let owner = PlayerId(1);
    let own = crate::observe(&sim, owner, &ev);
    let facts = own.plan.as_ref().unwrap();
    for (index, option) in facts.plan.spawns.iter().zip(facts.options) {
        let p = &sim.k.arena.map.layers().unwrap().data().spawn_pool[*index as usize];
        let option = option.unwrap();
        assert_eq!(option.at, Vec2::new(p.x, p.y));
        assert_eq!(option.zone, p.zone);
        assert_eq!(option.index, *index as u32);
        assert_eq!(option.walk_distance, sim.k.planning_walks[*index as usize]);
        assert_eq!(
            option.walk_seconds,
            option.walk_distance.map(view::walk_seconds)
        );
    }
    for p in &sim.w.players {
        let obs = crate::observe(&sim, p.id, &ev);
        let plans = obs
            .events
            .iter()
            .filter_map(|e| {
                if let crate::SeenEvent::Plan(plan) = e {
                    Some(plan)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        assert_eq!(plans, vec![&obs.plan.as_ref().unwrap().plan]);
    }
    assert!(crate::observe(&sim, PlayerId(999), &ev).plan.is_none());
    assert!(!crate::observe(&sim, PlayerId(999), &ev)
        .events
        .iter()
        .any(|e| matches!(e, crate::SeenEvent::Plan(_))));
    let mut changed = sim.clone();
    let plan = changed.w.planning.as_mut().unwrap();
    plan.deals[1].1.spawns.swap(0, 1);
    plan.deals[1].1.sent.as_mut().unwrap().spawns.swap(0, 1);
    assert_ne!(sim.state_hash(), changed.state_hash());
    assert_eq!(
        crate::observe(&sim, owner, &[]),
        crate::observe(&changed, owner, &[])
    );
    assert_eq!(
        crate::public_snapshot(&sim),
        crate::public_snapshot(&changed)
    );
    roundtrip(&changed);
    for _ in 0..41 {
        sim.step();
    }
    assert_eq!(sim.w.phase, Phase::Active);
    assert!(crate::observe(&sim, owner, &[]).plan.is_none());
}
#[test]
fn populated_reservations_sent_plans_and_locked_clocks_are_hashed_or_rejected() {
    fn leaves(v: &Value, path: String, out: &mut Vec<(String, Value)>) {
        match v {
            Value::Object(m) => {
                for (k, v) in m {
                    leaves(v, format!("{path}/{k}"), out)
                }
            }
            Value::Array(a) => {
                for (i, v) in a.iter().enumerate() {
                    leaves(v, format!("{path}/{i}"), out)
                }
            }
            _ => out.push((path, v.clone())),
        }
    }
    let mut planning = joined(1);
    planning.step();
    for p in [PlayerId(1), PlayerId(2)] {
        planning
            .submit(
                p,
                crate::validate(RawCommand::Plan {
                    spawn: Some(0),
                    boon: None,
                    ready: None,
                })
                .unwrap(),
            )
            .unwrap();
    }
    planning.step();
    assert_eq!(planning.w.planning.as_ref().unwrap().holders.len(), 2);
    let mut locked = joined(16);
    for _ in 0..4 {
        locked.step();
    }
    assert!(locked.w.rt.gates_locked);
    let (mut changed, mut rejected, mut visited) = (0, 0, 0);
    for sim in [&planning, &locked] {
        let cp = serde_json::to_value(sim).unwrap();
        let mut all = Vec::new();
        for root in [
            "/statics/config/lifecycle",
            "/world/planning",
            "/world/plan_ends_at",
            "/world/rt",
        ] {
            leaves(cp.pointer(root).unwrap(), root.into(), &mut all);
        }
        for (path, value) in all {
            let candidate = match value {
                Value::Bool(v) => json!(!v),
                Value::Number(v) => {
                    if let Some(n) = v.as_u64() {
                        json!(n + 1)
                    } else {
                        json!(v.as_f64().unwrap() + 1.)
                    }
                }
                Value::String(v) => json!(format!("{v}x")),
                Value::Null => continue,
                _ => unreachable!(),
            };
            visited += 1;
            let mut next = cp.clone();
            *next.pointer_mut(&path).unwrap() = candidate;
            match restore(next) {
                Ok(next) => {
                    assert_ne!(next.state_hash(), sim.state_hash(), "unhashed {path}");
                    changed += 1;
                }
                Err(_) => rejected += 1,
            }
        }
    }
    assert!(
        visited > 60 && changed > 10 && rejected > 10,
        "visited {visited}, changed {changed}, rejected {rejected}"
    );
    eprintln!("populated arena fields: {visited} scalar mutations; {changed} change hash; {rejected} rejected");
}
#[test]
fn source_refuses_unproduced_kernel_casts_and_deferred_hits_but_off_keeps_them() {
    let fact = crate::status_runtime::CastFact {
        producer: None,
        ability: crate::status_runtime::AbilityId::Freeze,
        started_at: 50.,
        lands_at: 250.,
        cancelled_by: Default::default(),
    };
    let mut source = joined(16);
    source.step();
    roundtrip(&source);
    let mut cast = source.clone();
    cast.w.players[0].statuses.cast = Some(fact);
    cast.w.players[0]
        .statuses
        .refresh_effects(cast.w.server_time);
    assert!(restore(serde_json::to_value(&cast).unwrap())
        .err()
        .unwrap()
        .to_string()
        .contains("bare CastFact"));
    let entry = crate::systems::ledger::Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: PlayerId(1),
        by: None,
        packet: crate::state::Packet {
            raw: 1.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: Some(crate::WeaponId::Sword),
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    };
    source.w.deferred.hits.push(entry.clone());
    assert!(restore(serde_json::to_value(&source).unwrap())
        .err()
        .unwrap()
        .to_string()
        .contains("deferred card producer"));
    let placements = [
        crate::Placement {
            profile: "a".into(),
            faction: FactionId::Frost,
            bot: false,
            at: Vec2::new(100., 100.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        crate::Placement {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(200., 100.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut off = Sim::reset_active(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(12),
        &placements,
    );
    off.w.players[0].statuses.cast = Some(fact);
    off.w.players[0].statuses.refresh_effects(off.w.server_time);
    off.w.deferred.hits.push(entry);
    roundtrip(&off);
}
#[test]
fn source_lobby_joins_disconnect_reconnect_and_shutdown_void_replay_exactly() {
    use crate::replay::{apply_input, run_replay, Recorder, ReplayInput, ReplayStart};
    let template = joined(0);
    let config = template.k.config.clone();
    let mut sim = Sim::new(config.clone(), template.k.arena.clone(), template.k.secrets);
    let mut recorder = Recorder::new(&sim, config, ReplayStart::Lobby);
    for name in ["a", "b", "c"] {
        let input = ReplayInput::Join {
            profile: name.into(),
            faction: Some(FactionId::Holy),
            bot: false,
            policy: None,
        };
        apply_input(&mut sim, &input);
        recorder.record(input);
    }
    sim.step();
    recorder.stepped(&sim);
    assert_eq!(sim.w.phase, Phase::Planning);
    for input in [
        ReplayInput::Dropped {
            player: PlayerId(1),
            dropped: true,
        },
        ReplayInput::Dropped {
            player: PlayerId(1),
            dropped: false,
        },
        ReplayInput::Abandon {
            player: PlayerId(2),
        },
    ] {
        apply_input(&mut sim, &input);
        recorder.record(input);
        sim.step();
        recorder.stepped(&sim);
    }
    assert!(sim.w.rt.voided);
    for _ in 0..8 {
        sim.step();
        recorder.stepped(&sim);
    }
    assert_eq!(sim.w.phase, Phase::Planning);
    roundtrip(&sim);
    let text = serde_json::to_string(&recorder.replay).unwrap();
    let replay = serde_json::from_str(&text).unwrap();
    let (result, _) = run_replay(&replay).unwrap();
    assert_eq!(result.state_hash(), sim.state_hash());
}

#[test]
fn source_absent_admin_actions_keep_removal_hooks_and_shutdown_void_semantics() {
    for steps in [0, 1, 5] {
        for previously_joined in [false, true] {
            let mut sim = joined(0);
            for _ in 0..steps {
                sim.step();
            }
            let phase = sim.phase();
            let absent = if previously_joined {
                sim.remove_player(PlayerId(1));
                sim.take_events();
                PlayerId(1)
            } else {
                PlayerId(999)
            };
            let alive = sim.w.players.len();
            #[cfg(feature = "schedule-trace")]
            sim.clear_schedule_trace();
            sim.remove_player(absent);
            assert_eq!(sim.w.players.len(), alive);
            assert!(!sim.w.rt.voided);
            #[cfg(feature = "schedule-trace")]
            assert!(sim
                .schedule_trace()
                .contains(&crate::schedule::TraceEntry::Hook(
                    "fighterOut",
                    "vision.<arrow>"
                )));
            assert_eq!(sim.abandon_player(absent), 0);
            assert_eq!(sim.w.players.len(), alive);
            assert_eq!(
                sim.w.rt.voided,
                matches!(phase, Phase::Planning | Phase::Active)
            );
            assert!(sim.take_events().is_empty());
            #[cfg(feature = "schedule-trace")]
            assert!(sim
                .schedule_trace()
                .contains(&crate::schedule::TraceEntry::Hook(
                    "fighterOut",
                    "vision.<arrow>"
                )));
            assert_eq!(sim.abandon_player(absent), 0);
            roundtrip(&sim);
            if phase != Phase::Lobby {
                for _ in 0..8 {
                    assert!(sim.step().is_empty());
                    assert_eq!(sim.phase(), phase);
                    assert!(sim.w.winner.is_none());
                }
            }
        }
    }
    // A repeated shutdown for a removed actor must freeze before a lone survivor can win.
    let mut sim = joined(0);
    for _ in 0..5 {
        sim.step();
    }
    while sim.w.players.len() > 1 {
        let id = sim.w.players[0].id;
        sim.abandon_player(id);
        assert_eq!(sim.abandon_player(id), 0);
        assert!(sim.step().is_empty());
    }
    assert_eq!(sim.phase(), Phase::Active);
    assert!(sim.w.winner.is_none());
    roundtrip(&sim);
    // Preserve the preexisting Off-profile absent-id no-op, including its hook behavior.
    let mut off = Sim::new(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(1),
    );
    let hash = off.state_hash();
    assert_eq!(off.abandon_player(PlayerId(999)), 0);
    off.remove_player(PlayerId(999));
    assert_eq!(off.state_hash(), hash);
}

fn source_rules_world(rules: crate::ArenaRules, planning: bool) -> Sim {
    let template = joined(0);
    let mut config = template.k.config.clone();
    config.lifecycle = crate::ArenaMode::Source(crate::ArenaRules {
        plan_seconds: if planning { 0.2 } else { 0. },
        ..rules
    });
    let mut sim = Sim::new(config, template.k.arena.clone(), template.k.secrets);
    for name in ["a", "b", "c", "d"] {
        sim.add_player(name, Some(FactionId::Holy), false).unwrap();
    }
    sim
}
#[test]
fn source_restore_refuses_early_lock_clocks_and_retained_history() {
    let mut sim = source_rules_world(crate::ArenaRules::default(), false);
    sim.step();
    sim.step();
    assert_eq!(sim.w.server_time, 100.);
    roundtrip(&sim);
    let mut forged = serde_json::to_value(&sim).unwrap();
    forged["world"]["rt"]["gates_locked"] = json!(true);
    forged["world"]["rt"]["in_coliseum"] = json!(true);
    forged["world"]["rt"]["patience_ends_at"] = Value::Null;
    forged["world"]["rt"]["sudden_death_at"] = json!(60100.);
    forged["world"]["abilities"]["teleported_at"] = json!(100.);
    assert!(
        restore(forged).is_err(),
        "first configured slot is600050, not100"
    );
    for planning in [false, true] {
        let mut early = source_rules_world(crate::ArenaRules::default(), planning);
        if planning {
            early.step();
        } else {
            let mut config = early.k.config.clone();
            config.min_players = 8;
            early = Sim::new(config, early.k.arena.clone(), early.k.secrets);
            early
                .add_player("lobby", Some(FactionId::Holy), false)
                .unwrap();
            early.step();
        }
        assert!(matches!(early.phase(), Phase::Lobby | Phase::Planning));
        assert_eq!(early.w.server_time, 50.);
        roundtrip(&early);
        let mut forged = serde_json::to_value(&early).unwrap();
        forged["world"]["abilities"] =
            serde_json::to_value(crate::status_runtime::AbilityRuntime::new(50.)).unwrap();
        forged["world"]["abilities"]["teleported_at"] = json!(50.);
        assert!(restore(forged)
            .err()
            .unwrap()
            .to_string()
            .contains("source teleport clock cannot precede the raid"));
    }
    // Actual later lock is valid; a forged earlier retained Locked sample is not,
    // even when the latest teleport clock and current lock are coherent.
    let mut later = source_rules_world(
        crate::ArenaRules {
            coliseum_schedule: Some(crate::ColiseumSchedule {
                first_seconds: 0.2,
                second_seconds: 0.4,
                repeat_seconds: 0.2,
                min_gap_seconds: 0.,
            }),
            ..Default::default()
        },
        false,
    );
    for _ in 0..5 {
        later.step();
    }
    assert!(later.w.rt.gates_locked);
    roundtrip(&later);
    let mut cp = serde_json::to_value(&later).unwrap();
    let reveals = cp["world"]["players"][0]["vision"]["reveals"]
        .as_array_mut()
        .unwrap();
    reveals[0]["tick"] = json!(2);
    reveals[0]["variant"] = json!("Locked");
    let history: crate::vision::VisionTrail =
        serde_json::from_value(cp["world"]["players"][0]["vision"].clone()).unwrap();
    history.check(later.tick(), true, |_, _| true).unwrap();
    assert!(
        restore(cp).is_err(),
        "retained locked reveal before first configured slot"
    );
}
#[test]
fn source_restore_allows_zero_fractional_and_death_shortened_timers() {
    for first in [0., 0.0001, 0.05, 0.050001, 0.125] {
        for scheduled in [false, true] {
            let mut sim = source_rules_world(
                crate::ArenaRules {
                    first_patience_seconds: if scheduled { None } else { Some(first) },
                    coliseum_schedule: scheduled.then_some(crate::ColiseumSchedule {
                        first_seconds: first,
                        second_seconds: 1.,
                        repeat_seconds: 1.,
                        min_gap_seconds: 0.,
                    }),
                    patience_seconds: 0.05,
                    patience_min_seconds: 0.05,
                    ..Default::default()
                },
                false,
            );
            sim.step();
            for _ in 0..6 {
                sim.step();
                roundtrip(&sim);
                if sim.w.rt.gates_locked {
                    break;
                }
            }
            assert!(sim.w.rt.gates_locked);
        }
    }
    // An unscheduled death may shorten a long first-flat timer. Even zero patience
    // returns on the death tick and only locks on the following ordinary tick.
    for (full, min) in [(0., 0.), (0.125, 0.050001), (0.02, 0.2)] {
        let mut sim = source_rules_world(
            crate::ArenaRules {
                first_patience_seconds: Some(600.),
                coliseum_schedule: None,
                patience_seconds: full,
                patience_min_seconds: min,
                ..Default::default()
            },
            false,
        );
        sim.step();
        sim.remove_player(PlayerId(1));
        sim.take_events();
        sim.step();
        assert!(!sim.w.rt.gates_locked);
        roundtrip(&sim);
        for _ in 0..10 {
            sim.step();
            roundtrip(&sim);
            if sim.w.rt.gates_locked {
                break;
            }
        }
        assert!(sim.w.rt.gates_locked);
        sim.remove_player(PlayerId(2));
        sim.take_events();
        sim.step();
        assert!(!sim.w.rt.gates_locked);
        for _ in 0..10 {
            sim.step();
            roundtrip(&sim);
            if sim.w.rt.gates_locked {
                break;
            }
        }
        assert!(sim.w.rt.gates_locked, "later real cycle remains admitted");
    }
}
