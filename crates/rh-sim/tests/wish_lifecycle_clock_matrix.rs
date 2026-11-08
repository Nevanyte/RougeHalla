//! P-WISH-LIFECYCLE-CLOCK-MATRIX: real all-five Wish clock/lifecycle distinctions.
//!
//! This target fills the cross-ability gap left by tests/wish_event_time.rs (Freeze-only start/landing and Freeze
//! between-step cancellation). Every case drives an admitted public cast through the real ability runtime: no raw event
//! insertion, expected-outcome installation, hidden mutable state, invented source clock or bypassed target gates. The
//! only test setup beyond declared placements is the diagnostic zero opening-lock / off-lifecycle profile (no lobby or
//! sudden-death clock can interleave in the bounded cases) and an open declared map.
use rh_sim::abilities::{ability_in_slot, Mode, Slot};
use rh_sim::status_runtime::{AbilityId, CastEndReason};
use rh_sim::{
    validate, Arena, CheckpointError, Command, Event, FactionId, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, TileMap, Vec2,
};

const TICK_MS: f64 = rh_sim::constants::TICK_MS;

fn scene(caster: FactionId) -> Sim {
    let mut tiles = vec![0; 40 * 24];
    for y in 0..24 {
        for x in 0..40 {
            if x == 0 || y == 0 || x == 39 || y == 23 {
                tiles[y * 40 + x] = 1;
            }
        }
    }
    let map = TileMap::new(40, 24, tiles).unwrap();
    let placements = [
        Placement {
            profile: "caster".into(),
            faction: caster,
            bot: false,
            at: Vec2::new(300., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "target".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(440., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "observer".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(440., 420.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    Sim::reset_active(
        SimConfig {
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            lifecycle: rh_sim::ArenaMode::Off,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        Arena {
            map,
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(77),
        &placements,
    )
}

fn ability_for(faction: FactionId) -> AbilityId {
    ability_in_slot(Slot::Wish, faction).expect("every admitted faction has its Wish")
}

fn wish_cast(caster: FactionId) -> Command {
    let (x, y, id) = match ability_for(caster) {
        AbilityId::Freeze | AbilityId::Trial => (440., 320., Some(PlayerId(2))),
        AbilityId::Blaze => (440., 320., None),
        AbilityId::Swarm | AbilityId::LastStand => (300., 320., None),
    };
    validate(RawCommand::Cast {
        slot: Slot::Wish,
        x,
        y,
        id,
        t: None,
        seq: None,
    })
    .unwrap()
}

fn cast_times(events: &[Event], id: PlayerId, ability: AbilityId, landed: bool) -> Vec<f64> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::CastStarted {
                event_time,
                id: event_id,
                ability: event_ability,
                ..
            } if !landed && *event_id == id && *event_ability == ability => Some(*event_time),
            Event::CastLanded {
                event_time,
                id: event_id,
                ability: event_ability,
                ..
            } if landed && *event_id == id && *event_ability == ability => Some(*event_time),
            _ => None,
        })
        .collect()
}

fn end_reasons(events: &[Event], id: PlayerId, ability: AbilityId) -> Vec<CastEndReason> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::CastEnded {
                id: event_id,
                ability: event_ability,
                reason,
                ..
            } if *event_id == id && *event_ability == ability => Some(*reason),
            _ => None,
        })
        .collect()
}

fn pending(faction: FactionId) -> bool {
    rh_sim::abilities::definition(ability_for(faction)).cast_ms > 0.
}

#[test]
fn all_five_wishes_emit_real_start_landing_and_instant_distinctions() {
    let matrix = [
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Sentenced,
        FactionId::Fire,
        FactionId::Holy,
    ];
    let mut observed = Vec::new();
    for faction in matrix {
        let ability = ability_for(faction);
        let caster = PlayerId(1);
        let mut sim = scene(faction);
        sim.submit(caster, wish_cast(faction)).unwrap();
        let first = sim.step();
        let started = cast_times(&first, caster, ability, false);
        let first_landed = cast_times(&first, caster, ability, true);
        let mut all = first.clone();
        let mut landed = first_landed.clone();
        let mut started_count = started.len();
        let mut formed = started_count;
        if pending(faction) {
            assert_eq!(
                started_count, 1,
                "{ability:?}: one CastStarted in its start tick"
            );
            assert_eq!(
                started[0],
                sim.server_time(),
                "{ability:?}: real start producer time"
            );
            let start_time = started[0];
            assert!(
                first_landed.is_empty(),
                "{ability:?}: no landing in the start tick"
            );
            for _ in 0..20 {
                let events = sim.step();
                let this_landed = cast_times(&events, caster, ability, true);
                started_count += cast_times(&events, caster, ability, false).len();
                landed.extend(this_landed.iter().copied());
                all.extend(events);
                if !this_landed.is_empty() {
                    assert_eq!(this_landed.len(), 1, "{ability:?}: one landing");
                    assert_eq!(
                        this_landed[0],
                        sim.server_time(),
                        "{ability:?}: landing producer time"
                    );
                    assert_eq!(
                        this_landed[0] - start_time,
                        rh_sim::abilities::definition(ability).cast_ms,
                        "{ability:?}: landing preserves the producer cast_ms interval"
                    );
                    formed += 1;
                    break;
                }
            }
            assert_eq!(formed, 2, "{ability:?}: real start + landing observed");
        } else {
            assert!(
                started.is_empty(),
                "{ability:?}: instant Wish has no pending CastStarted"
            );
            assert_eq!(
                first_landed.len(),
                1,
                "{ability:?}: instant lands in its first tick"
            );
            assert_eq!(
                first_landed[0],
                sim.server_time(),
                "{ability:?}: instant landing producer time"
            );
            formed = 1;
            landed = first_landed;
            // The public event stream has no CastStarted and no fabricated CastEnded for an instant landing.
            for _ in 0..5 {
                let events = sim.step();
                all.extend(events);
            }
        }
        assert_eq!(
            started_count,
            if pending(faction) { 1 } else { 0 },
            "{ability:?}: started count"
        );
        assert_eq!(landed.len(), 1, "{ability:?}: exactly one own landing");
        assert!(
            end_reasons(&all, caster, ability).is_empty(),
            "{ability:?}: successful cast has no CastEnded"
        );
        observed.push((faction, ability, formed, landed[0]));
    }
    assert_eq!(observed.len(), 5);
}

#[test]
fn restored_offset_clock_preserves_all_five_producer_times() {
    let matrix = [
        FactionId::Frost,
        FactionId::Plague,
        FactionId::Sentenced,
        FactionId::Fire,
        FactionId::Holy,
    ];
    for faction in matrix {
        let ability = ability_for(faction);
        let caster = PlayerId(1);
        let sim = scene(faction);
        let tick = sim.tick();
        let canonical_time = f64::from(tick) * TICK_MS;
        let restored_time = sim.server_time() + 123.25;
        let mut checkpoint = serde_json::to_value(&sim).unwrap();
        checkpoint["world"]["server_time"] = serde_json::json!(restored_time);
        let mut sim = Sim::restore(checkpoint)
            .unwrap_or_else(|err| panic!("{ability:?}: restored offset clock: {err}"));
        assert_eq!(
            sim.server_time(),
            restored_time,
            "{ability:?}: offset clock restores"
        );
        assert_eq!(sim.tick(), tick);
        assert_ne!(
            sim.server_time(),
            canonical_time,
            "{ability:?}: not tick-derived"
        );
        sim.submit(caster, wish_cast(faction)).unwrap();
        let first = sim.step();
        let started = cast_times(&first, caster, ability, false);
        let first_landed = cast_times(&first, caster, ability, true);
        if pending(faction) {
            assert_eq!(started.len(), 1, "{ability:?}: restored start");
            assert_eq!(
                started[0],
                sim.server_time(),
                "{ability:?}: restored start producer time"
            );
            assert_ne!(
                started[0],
                f64::from(sim.tick()) * TICK_MS,
                "{ability:?}: start time is not tick-derived"
            );
            assert!(
                first_landed.is_empty(),
                "{ability:?}: no landing before cast_ms"
            );
            let start_time = started[0];
            let mut landed = Vec::new();
            for _ in 0..20 {
                let events = sim.step();
                let this_landed = cast_times(&events, caster, ability, true);
                if !this_landed.is_empty() {
                    assert_eq!(this_landed.len(), 1, "{ability:?}: restored landing count");
                    assert_eq!(
                        this_landed[0],
                        sim.server_time(),
                        "{ability:?}: restored landing producer time"
                    );
                    assert_ne!(
                        this_landed[0],
                        f64::from(sim.tick()) * TICK_MS,
                        "{ability:?}: landing time is not tick-derived"
                    );
                    assert_eq!(
                        this_landed[0] - start_time,
                        rh_sim::abilities::definition(ability).cast_ms,
                        "{ability:?}: restored landing preserves the producer cast_ms interval"
                    );
                    landed = this_landed;
                    break;
                }
            }
            assert_eq!(landed.len(), 1, "{ability:?}: restored landing observed");
        } else {
            assert!(
                started.is_empty(),
                "{ability:?}: restored instant has no CastStarted"
            );
            assert_eq!(
                first_landed.len(),
                1,
                "{ability:?}: restored instant landing"
            );
            assert_eq!(
                first_landed[0],
                sim.server_time(),
                "{ability:?}: restored instant landing producer time"
            );
            assert_ne!(
                first_landed[0],
                f64::from(sim.tick()) * TICK_MS,
                "{ability:?}: instant landing is not tick-derived"
            );
        }
    }
}

#[test]
fn pending_wishes_cancel_between_steps_with_retained_clock_and_controls() {
    for faction in [FactionId::Frost, FactionId::Plague, FactionId::Sentenced] {
        assert!(pending(faction), "{faction:?}: a pending Wish");
        let ability = ability_for(faction);
        let caster = PlayerId(1);
        let mut original = scene(faction);
        original.submit(caster, wish_cast(faction)).unwrap();
        let started = original.step();
        assert_eq!(
            cast_times(&started, caster, ability, false).len(),
            1,
            "{ability:?}: one start before the between-step removal"
        );
        let started_at = cast_times(&started, caster, ability, false)[0];
        let cancelled_at = original.server_time();
        assert_eq!(
            started_at, cancelled_at,
            "{ability:?}: the between-step removal follows the producer start without a clock advance"
        );
        original.remove_player(caster);
        assert_eq!(
            original.server_time(),
            cancelled_at,
            "{ability:?}: removal does not advance time"
        );
        let checkpoint = serde_json::to_value(&original).unwrap();
        let pending_events = checkpoint["world"]["pending_events"].as_array().unwrap();
        let index = pending_events
            .iter()
            .position(|event| {
                event["CastEnded"]["id"] == serde_json::json!(caster.0)
                    && event["CastEnded"]["ability"] == serde_json::json!(ability.as_str())
            })
            .unwrap_or_else(|| panic!("{ability:?}: removal leaves its own cancellation queued"));
        assert_eq!(
            checkpoint["world"]["pending_events"][index]["CastEnded"]["event_time"],
            serde_json::json!(cancelled_at),
            "{ability:?}: retained cancellation uses producer server_time"
        );
        assert_eq!(
            checkpoint["world"]["pending_events"][index]["CastEnded"]["reason"],
            serde_json::json!("cancelled"),
            "{ability:?}: real removal reason"
        );
        let mut restored = Sim::restore(&checkpoint).unwrap();
        assert_eq!(
            original.state_hash(),
            restored.state_hash(),
            "{ability:?}: removal hash"
        );
        for round in 0..12 {
            let expected = original.step();
            let actual = restored.step();
            assert_eq!(
                expected, actual,
                "{ability:?}: restored continuation step {round}"
            );
            assert_eq!(
                original.state_hash(),
                restored.state_hash(),
                "{ability:?}: step {round} hash"
            );
            if round == 0 {
                let ended = end_reasons(&actual, caster, ability);
                assert_eq!(
                    ended,
                    vec![CastEndReason::Cancelled],
                    "{ability:?}: one cancellation"
                );
                let ended_time = actual
                    .iter()
                    .find_map(|event| match event {
                        Event::CastEnded {
                            event_time,
                            id,
                            ability: event_ability,
                            reason: CastEndReason::Cancelled,
                        } if *id == caster && *event_ability == ability => Some(*event_time),
                        _ => None,
                    })
                    .expect("the delivered cancellation");
                assert_eq!(
                    ended_time, cancelled_at,
                    "{ability:?}: cancellation producer time"
                );
                assert!(
                    cast_times(&actual, caster, ability, true).is_empty(),
                    "{ability:?}: no landing after cancel"
                );
                assert_eq!(restored.server_time(), cancelled_at + TICK_MS);
            }
        }
        // A finite past mutation is admitted and is a real hashed clock leaf; negative/future/missing clocks are refused.
        let mut changed = checkpoint.clone();
        changed["world"]["pending_events"][index]["CastEnded"]["event_time"] =
            serde_json::json!(cancelled_at - 1.);
        let changed = Sim::restore(&changed)
            .unwrap_or_else(|err| panic!("{ability:?}: past mutation: {err}"));
        assert_ne!(
            changed.state_hash(),
            original.state_hash(),
            "{ability:?}: past clock hashes"
        );
        for bad in [serde_json::json!(-1.), serde_json::json!(cancelled_at + 1.)] {
            let mut invalid = checkpoint.clone();
            invalid["world"]["pending_events"][index]["CastEnded"]["event_time"] = bad;
            assert!(
                matches!(Sim::restore(&invalid), Err(CheckpointError::Malformed(reason)) if reason.contains("event_time")),
                "{ability:?}: invalid retained clock is refused"
            );
        }
        let mut missing = checkpoint;
        missing["world"]["pending_events"][index]["CastEnded"]
            .as_object_mut()
            .unwrap()
            .remove("event_time");
        assert!(
            matches!(Sim::restore(&missing), Err(CheckpointError::Malformed(reason)) if reason.contains("event_time")),
            "{ability:?}: missing retained event_time is refused"
        );
    }
}

#[test]
fn instant_wishes_land_without_pending_cancellation_and_record_the_narrower_domain() {
    for faction in [FactionId::Fire, FactionId::Holy] {
        assert!(!pending(faction), "{faction:?}: an instant Wish");
        let ability = ability_for(faction);
        let caster = PlayerId(1);
        let mut original = scene(faction);
        original.submit(caster, wish_cast(faction)).unwrap();
        let first = original.step();
        assert!(
            cast_times(&first, caster, ability, false).is_empty(),
            "{ability:?}: instant Wish has no pending CastStarted"
        );
        assert_eq!(
            cast_times(&first, caster, ability, true).len(),
            1,
            "{ability:?}: instant Wish lands in its producer tick"
        );
        let landed_time = cast_times(&first, caster, ability, true)[0];
        assert_eq!(
            landed_time,
            original.server_time(),
            "{ability:?}: instant producer time"
        );
        assert!(
            end_reasons(&first, caster, ability).is_empty(),
            "{ability:?}: no terminal on instant landing"
        );
        let checkpoint = serde_json::to_value(&original).unwrap();
        let pending_events = checkpoint["world"]["pending_events"].as_array().unwrap();
        assert!(
            pending_events.iter().all(|event| {
                event["CastEnded"]["ability"] != serde_json::json!(ability.as_str())
                    && event["CastStarted"]["ability"] != serde_json::json!(ability.as_str())
            }),
            "{ability:?}: an instant Wish leaves no pending cast event"
        );
        let mut restored = Sim::restore(&checkpoint).unwrap();
        assert_eq!(
            original.state_hash(),
            restored.state_hash(),
            "{ability:?}: post-landing hash"
        );
        original.remove_player(caster);
        restored.remove_player(caster);
        let mut landed_total = 1;
        for round in 0..8 {
            let expected = original.step();
            let actual = restored.step();
            assert_eq!(
                expected, actual,
                "{ability:?}: instant continuation step {round}"
            );
            assert_eq!(
                original.state_hash(),
                restored.state_hash(),
                "{ability:?}: instant step {round} hash"
            );
            landed_total += cast_times(&actual, caster, ability, true).len();
            assert!(
                end_reasons(&actual, caster, ability).is_empty(),
                "{ability:?}: no fabricated pending cancellation after an instant landing"
            );
            assert!(
                cast_times(&actual, caster, ability, false).is_empty(),
                "{ability:?}: no fabricated CastStarted"
            );
        }
        assert_eq!(landed_total, 1, "{ability:?}: exactly one instant landing");
    }
}
