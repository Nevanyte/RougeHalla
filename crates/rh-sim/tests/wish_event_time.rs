use rh_sim::{
    abilities::{Mode, Slot},
    validate, Arena, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig,
    TileMap, Vec2,
};

fn active_sim() -> Sim {
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
        (FactionId::Frost, Vec2::new(300., 320.)),
        (FactionId::Holy, Vec2::new(440., 320.)),
    ];
    Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            abilities: Mode::Full,
            lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: 3600.,
                patience_min_seconds: 3600.,
                sudden_death_seconds: 60.,
            }),
            wish_lock_ms: 0.,
            ..Default::default()
        },
        Arena {
            map,
            spawns: placements.iter().map(|p| p.1).collect(),
        },
        Secrets::from_seed(31),
        &placements
            .iter()
            .enumerate()
            .map(|(i, (faction, at))| Placement {
                profile: format!("p{i}"),
                faction: *faction,
                bot: false,
                at: *at,
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}

fn frost_cast() -> rh_sim::Command {
    validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: 440.,
        y: 320.,
        id: Some(PlayerId(2)),
        t: None,
        seq: None,
    })
    .unwrap()
}

#[test]
fn real_cast_start_and_landing_use_their_producer_step_time() {
    let mut sim = active_sim();
    sim.submit(PlayerId(1), frost_cast()).unwrap();

    let started_events = sim.step();
    let started = started_events
        .iter()
        .find_map(|event| match event {
            Event::CastStarted { event_time, .. } => Some(*event_time),
            _ => None,
        })
        .expect("real Frost cast starts");
    assert_eq!(started, sim.server_time());

    for _ in 0..40 {
        let events = sim.step();
        if let Some(landed) = events.iter().find_map(|event| match event {
            Event::CastLanded { event_time, .. } => Some(*event_time),
            _ => None,
        }) {
            assert_eq!(landed, sim.server_time());
            return;
        }
    }
    panic!("real Frost cast lands within the bounded wait");
}

#[test]
fn between_step_removal_stamps_cancel_before_the_next_clock_advance() {
    let mut sim = active_sim();
    sim.submit(PlayerId(1), frost_cast()).unwrap();
    let started = sim.step();
    assert!(started
        .iter()
        .any(|event| matches!(event, Event::CastStarted { .. })));

    let cancelled_at = sim.server_time();
    sim.remove_player(PlayerId(1));
    assert_eq!(sim.server_time(), cancelled_at);

    let delivered = sim.step();
    let event_time = delivered
        .iter()
        .find_map(|event| match event {
            Event::CastEnded {
                event_time,
                reason: rh_sim::status_runtime::CastEndReason::Cancelled,
                ..
            } => Some(*event_time),
            _ => None,
        })
        .expect("remove_player cancels the pending cast");
    assert_eq!(event_time, cancelled_at);
    assert_eq!(sim.server_time(), cancelled_at + rh_sim::constants::TICK_MS);
}

#[test]
fn event_time_is_required_in_serialized_raw_cast_events() {
    let events = [
        Event::CastStarted {
            event_time: 1.,
            id: PlayerId(1),
            ability: rh_sim::status_runtime::AbilityId::Freeze,
            ms: 200.,
            target: None,
            x: 1.,
            y: 2.,
        },
        Event::CastLanded {
            event_time: 2.,
            id: PlayerId(1),
            ability: rh_sim::status_runtime::AbilityId::Freeze,
            target: None,
            x: 1.,
            y: 2.,
            to: None,
        },
        Event::CastEnded {
            event_time: 3.,
            id: PlayerId(1),
            ability: rh_sim::status_runtime::AbilityId::Freeze,
            reason: rh_sim::status_runtime::CastEndReason::Cancelled,
        },
    ];

    for event in events {
        let mut encoded = serde_json::to_value(event).unwrap();
        let payload = encoded
            .as_object_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap()
            .as_object_mut()
            .unwrap();
        payload.remove("event_time");
        assert!(serde_json::from_value::<Event>(encoded).is_err());
    }
}
