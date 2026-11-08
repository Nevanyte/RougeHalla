//! Wish spatial-cue privacy across immediate observation, sealed Fx reports, and actor-reference projection.
use rh_sim::{
    abilities::{Mode, Slot},
    observe, validate, Arena, Event, FactionId, FxProjector, ItemObserver, Observation, Placement,
    PlayerId, RawCommand, Secrets, SeenEvent, Sim, SimConfig, TileMap, Vec2,
};

fn place(faction: FactionId, x: f64, y: f64) -> Placement {
    Placement {
        profile: format!("p{}-{x}-{y}", faction as u8),
        faction,
        bot: false,
        at: Vec2::new(x, y),
        hp: None,
        weapon0: None,
        weapon1: None,
    }
}

fn scene(placements: &[Placement], pillars: &[(u32, u32)]) -> Sim {
    let width = 50usize;
    let height = 40usize;
    let mut tiles = vec![0; width * height];
    for &(x, y) in pillars {
        tiles[y as usize * width + x as usize] = 1;
    }
    let map = TileMap::new(width as u32, height as u32, tiles).unwrap();
    Sim::reset_active(
        SimConfig {
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        Arena {
            map,
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(91),
        placements,
    )
}

fn cast(slot: Slot, x: f64, y: f64, target: Option<PlayerId>) -> rh_sim::Command {
    validate(RawCommand::Cast {
        slot,
        x,
        y,
        id: target,
        t: None,
        seq: None,
    })
    .unwrap()
}

fn direct_landed(
    id: PlayerId,
    ability: rh_sim::status_runtime::AbilityId,
    target: Option<PlayerId>,
    at: Vec2,
    to: Option<Vec2>,
    time: f64,
) -> Event {
    Event::CastLanded {
        event_time: time,
        id,
        ability,
        target,
        x: at.x,
        y: at.y,
        to,
    }
}

fn landed(events: &[SeenEvent]) -> Vec<&SeenEvent> {
    events
        .iter()
        .filter(|e| matches!(e, SeenEvent::CastLanded { .. }))
        .collect()
}

fn step_to_landed(
    sim: &mut Sim,
    projector: &mut FxProjector,
    caster: PlayerId,
    command: rh_sim::Command,
) -> (Vec<Event>, Vec<SeenEvent>) {
    sim.submit(caster, command).unwrap();
    for _ in 0..12 {
        let events = sim.step();
        projector.feed(sim.fx_report()).unwrap();
        if events.iter().any(|e| matches!(e, Event::CastLanded { .. })) {
            return (events, projector.events().to_vec());
        }
    }
    panic!("the cast should land during the bounded wait");
}

#[test]
fn hidden_caster_does_not_suppress_visible_freeze_or_trial_target_impact() {
    let viewer = PlayerId(1);
    let target = PlayerId(2);
    let caster = PlayerId(3);

    for (ability, faction) in [
        (rh_sim::status_runtime::AbilityId::Freeze, FactionId::Frost),
        (
            rh_sim::status_runtime::AbilityId::Trial,
            FactionId::Sentenced,
        ),
    ] {
        let placements = [
            place(FactionId::Holy, 200., 200.),
            place(FactionId::Holy, 300., 200.),
            place(faction, 250., 200.),
        ];
        let mut sim = scene(&placements, &[]);
        let mut projector = FxProjector::attach(&sim, viewer);
        let (raw, projected) = step_to_landed(
            &mut sim,
            &mut projector,
            caster,
            cast(Slot::Wish, 300., 200., Some(target)),
        );
        let raw_landed = raw
            .iter()
            .find_map(|e| match e {
                Event::CastLanded {
                    event_time,
                    id,
                    ability: a,
                    target: t,
                    ..
                } if *id == caster && *a == ability && *t == Some(target) => Some(*event_time),
                _ => None,
            })
            .expect("real public Cast produces its target landing");
        let cues = landed(&projected);
        assert_eq!(cues.len(), 1, "one completed cast cue");
        match cues[0] {
            SeenEvent::CastLanded {
                event_time,
                id,
                ability: a,
                target: t,
                at,
                to,
            } => {
                assert_eq!(*event_time, raw_landed, "producer time survives projection");
                assert_eq!(*a, ability);
                assert_eq!(
                    *id,
                    Some(caster),
                    "the real producer is visible in this control"
                );
                assert_eq!(*t, Some(target), "visible target reference survives");
                assert_eq!(
                    *at,
                    Some(placements[1].at),
                    "visible target impact survives"
                );
                assert_eq!(*to, None);
            }
            _ => unreachable!(),
        }
        let observed = observe(&sim, viewer, &raw);
        assert!(observed.visible.iter().any(|a| a.id == caster));
        assert!(observed.visible.iter().any(|a| a.id == target));
    }

    // These diagnostic landed payloads exercise the optional-caster policy. The actual hidden caster below is made by
    // a real Swarm Cast; the injected Freeze/Trial landings are controls, not claimed source producer output.
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Plague, 250., 200.),
        place(FactionId::Holy, 300., 200.),
    ];
    let mut sim = scene(&placements, &[]);
    sim.submit(PlayerId(2), cast(Slot::Wish, 0., 0., None))
        .unwrap();
    for _ in 0..12 {
        let events = sim.step();
        if events.iter().any(|e| {
            matches!(
                e,
                Event::CastLanded {
                    ability: rh_sim::status_runtime::AbilityId::Swarm,
                    ..
                }
            )
        }) {
            break;
        }
    }
    let observer = observe(&sim, viewer, &[]);
    assert!(!observer.visible.iter().any(|a| a.id == PlayerId(2)));
    assert!(observer.visible.iter().any(|a| a.id == PlayerId(3)));
    for ability in [
        rh_sim::status_runtime::AbilityId::Freeze,
        rh_sim::status_runtime::AbilityId::Trial,
    ] {
        let diagnostic = direct_landed(
            PlayerId(2),
            ability,
            Some(PlayerId(3)),
            placements[2].at,
            None,
            sim.server_time(),
        );
        let projected = observe(&sim, viewer, &[diagnostic]);
        assert!(
            matches!(
                projected.events.as_slice(),
                [SeenEvent::CastLanded { id: None, ability: a, target: Some(PlayerId(3)), at: Some(p), to: None, .. }]
                    if *a == ability && *p == placements[2].at
            ),
            "visible {ability:?} impact survives its hidden caster"
        );
    }
}

#[test]
fn hidden_unit_target_suppresses_identity_and_anchor_even_on_a_visible_tile() {
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Plague, 250., 200.),
        place(FactionId::Plague, 300., 200.),
    ];
    let mut sim = scene(&placements, &[]);
    for id in [PlayerId(2), PlayerId(3)] {
        sim.submit(id, cast(Slot::Wish, 0., 0., None)).unwrap();
    }
    let mut swarms = Vec::new();
    for _ in 0..12 {
        swarms = sim.step();
        if swarms
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    Event::CastLanded {
                        ability: rh_sim::status_runtime::AbilityId::Swarm,
                        ..
                    }
                )
            })
            .count()
            == 2
        {
            break;
        }
    }
    let projection = observe(&sim, PlayerId(1), &swarms);
    let hidden: Vec<_> = projection.visible.iter().map(|a| a.id).collect();
    assert!(!hidden.contains(&PlayerId(2)) && !hidden.contains(&PlayerId(3)));

    // Declared diagnostic Event injection control: the real self Swarm casts above establish hidden actors on visible
    // ground; these events isolate the producer-impossible landed payload combinations without claiming source output.
    let visible_point = direct_landed(
        PlayerId(2),
        rh_sim::status_runtime::AbilityId::Swarm,
        None,
        placements[1].at,
        None,
        sim.server_time(),
    );
    let point_control = observe(&sim, PlayerId(1), &[visible_point]);
    assert!(
        matches!(
            point_control.events.as_slice(),
            [SeenEvent::CastLanded { id: None, at: Some(p), to: None, .. }] if *p == placements[1].at
        ),
        "the hidden actor's ground tile is independently visible"
    );

    let hidden_target = direct_landed(
        PlayerId(2),
        rh_sim::status_runtime::AbilityId::Freeze,
        Some(PlayerId(3)),
        placements[2].at,
        None,
        sim.server_time(),
    );
    let no_identity_or_anchor = observe(&sim, PlayerId(1), &[hidden_target]);
    assert!(no_identity_or_anchor.events.is_empty());
}

#[test]
fn anonymous_visible_points_and_required_started_ended_caster_rules() {
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Plague, 250., 200.),
    ];
    let mut sim = scene(&placements, &[]);
    let mut projector = FxProjector::attach(&sim, PlayerId(1));
    sim.submit(PlayerId(2), cast(Slot::Wish, 0., 0., None))
        .unwrap();
    let mut actual_swarm = Vec::new();
    for _ in 0..12 {
        actual_swarm = sim.step();
        projector.feed(sim.fx_report()).unwrap();
        if actual_swarm.iter().any(|e| {
            matches!(
                e,
                Event::CastLanded {
                    ability: rh_sim::status_runtime::AbilityId::Swarm,
                    ..
                }
            )
        }) {
            break;
        }
    }
    let actual = observe(&sim, PlayerId(1), &actual_swarm);
    assert!(matches!(
        landed(projector.events()).as_slice(),
        [SeenEvent::CastLanded {
            id: None,
            ability: rh_sim::status_runtime::AbilityId::Swarm,
            at: Some(_),
            ..
        }]
    ));
    assert!(matches!(
        actual.events.as_slice(),
        [SeenEvent::CastLanded {
            id: None,
            ability: rh_sim::status_runtime::AbilityId::Swarm,
            at: Some(_),
            ..
        }]
    ));

    let time = sim.server_time();
    let hidden_lstand = direct_landed(
        PlayerId(2),
        rh_sim::status_runtime::AbilityId::LastStand,
        None,
        placements[1].at,
        None,
        time,
    );
    let anonymous = observe(&sim, PlayerId(1), &[hidden_lstand]);
    assert!(matches!(
        anonymous.events.as_slice(),
        [SeenEvent::CastLanded { id: None, ability: rh_sim::status_runtime::AbilityId::LastStand, at: Some(p), to: None, .. }]
            if *p == placements[1].at
    ));

    let started = Event::CastStarted {
        event_time: time,
        id: PlayerId(2),
        ability: rh_sim::status_runtime::AbilityId::Swarm,
        ms: 250.,
        target: None,
        x: placements[1].at.x,
        y: placements[1].at.y,
    };
    let ended = Event::CastEnded {
        event_time: time,
        id: PlayerId(2),
        ability: rh_sim::status_runtime::AbilityId::Swarm,
        reason: rh_sim::status_runtime::CastEndReason::Cancelled,
    };
    assert!(
        observe(&sim, PlayerId(1), &[started.clone(), ended.clone()])
            .events
            .is_empty()
    );
    let owner = observe(&sim, PlayerId(2), &[started, ended]);
    assert_eq!(owner.events.len(), 2);
    assert!(matches!(owner.events[0], SeenEvent::CastStarted { id, .. } if id == PlayerId(2)));
    assert!(matches!(owner.events[1], SeenEvent::CastEnded { id, .. } if id == PlayerId(2)));
}

#[test]
fn blaze_keeps_only_complete_visible_pairs_except_for_its_owner() {
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Plague, 250., 200.),
        place(FactionId::Fire, 300., 200.),
    ];
    let sim = scene(&placements, &[]);
    // Actual Swarm producer setup makes actor 2 hidden; its tile remains visible to player 1.
    let mut sim = sim;
    sim.submit(PlayerId(2), cast(Slot::Wish, 0., 0., None))
        .unwrap();
    for _ in 0..12 {
        let ev = sim.step();
        if ev.iter().any(|e| {
            matches!(
                e,
                Event::CastLanded {
                    ability: rh_sim::status_runtime::AbilityId::Swarm,
                    ..
                }
            )
        }) {
            break;
        }
    }
    let near = placements[1].at;
    let far = Vec2::new(1400., 1000.);
    let time = sim.server_time();

    let incomplete_hidden = direct_landed(
        PlayerId(2),
        rh_sim::status_runtime::AbilityId::Blaze,
        None,
        near,
        Some(far),
        time,
    );
    assert!(observe(&sim, PlayerId(1), &[incomplete_hidden])
        .events
        .is_empty());

    let incomplete_visible = direct_landed(
        PlayerId(3),
        rh_sim::status_runtime::AbilityId::Blaze,
        None,
        near,
        Some(far),
        time,
    );
    let visible_caster_clear = observe(&sim, PlayerId(1), &[incomplete_visible]);
    assert!(matches!(
        visible_caster_clear.events.as_slice(),
        [SeenEvent::CastLanded {
            id: Some(PlayerId(3)),
            at: None,
            to: None,
            ..
        }]
    ));

    let full_pair = direct_landed(
        PlayerId(2),
        rh_sim::status_runtime::AbilityId::Blaze,
        None,
        near,
        Some(placements[2].at),
        time,
    );
    assert!(matches!(
        observe(&sim, PlayerId(1), &[full_pair.clone()]).events.as_slice(),
        [SeenEvent::CastLanded { id: None, at: Some(a), to: Some(b), .. }]
            if *a == near && *b == placements[2].at
    ));
    assert!(
        matches!(
            observe(&sim, PlayerId(2), &[full_pair]).events.as_slice(),
            [SeenEvent::CastLanded {
                id: Some(PlayerId(2)),
                at: Some(_),
                to: Some(_),
                ..
            }]
        ),
        "the owner receives authoritative paired blink geometry"
    );
}

#[test]
fn actual_blink_pair_is_atomic_for_observer_and_owner() {
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Fire, 400., 200.),
        place(FactionId::Holy, 300., 200.),
    ];
    // This pillar crosses only the observer-to-destination ray; it leaves the caster's blink path clear.
    let mut sim = scene(&placements, &[(15, 10)]);
    let owner = PlayerId(2);
    let other = PlayerId(1);
    let mut owner_projector = FxProjector::attach(&sim, owner);
    let mut other_projector = FxProjector::attach(&sim, other);
    sim.submit(owner, cast(Slot::Wish, 1400., 1000., None))
        .unwrap();
    let mut raw = Vec::new();
    for _ in 0..3 {
        raw = sim.step();
        owner_projector.feed(sim.fx_report()).unwrap();
        other_projector.feed(sim.fx_report()).unwrap();
        if raw.iter().any(|e| {
            matches!(
                e,
                Event::CastLanded {
                    ability: rh_sim::status_runtime::AbilityId::Blaze,
                    ..
                }
            )
        }) {
            break;
        }
    }
    let owner_cue = landed(owner_projector.events());
    assert!(matches!(
        owner_cue.as_slice(),
        [SeenEvent::CastLanded {
            id: Some(PlayerId(2)),
            at: Some(_),
            to: Some(_),
            ..
        }]
    ));
    let other_cue = landed(other_projector.events());
    assert!(
        other_cue.is_empty(),
        "the blink ends outside the observer's view, and its incomplete pair is dropped"
    );
    assert!(raw.iter().any(|e| matches!(e, Event::CastLanded { .. })));
}

#[test]
fn sealed_fx_permission_survives_catch_up_and_missing_caster_mapping() {
    let placements = [
        place(FactionId::Holy, 160., 160.),
        place(FactionId::Holy, 416., 160.),
        place(FactionId::Frost, 288., 160.),
    ];
    let mut sim = scene(&placements, &[]);
    let viewer = PlayerId(1);
    let caster = PlayerId(3);
    let target = PlayerId(2);
    let mut projector = FxProjector::attach(&sim, viewer);
    let (raw, projected) = step_to_landed(
        &mut sim,
        &mut projector,
        caster,
        cast(Slot::Wish, 416., 160., Some(target)),
    );
    let cue = landed(&projected)
        .into_iter()
        .find(|event| {
            matches!(
                event,
                SeenEvent::CastLanded {
                    id: Some(PlayerId(3)),
                    ..
                }
            )
        })
        .expect("caster is visible when the completed-step permission is sealed")
        .clone();
    let producer_time = raw
        .iter()
        .find_map(|e| match e {
            Event::CastLanded { id, event_time, .. } if *id == caster => Some(*event_time),
            _ => None,
        })
        .unwrap();

    // Catch up after the cue. Removing the caster changes the current scene/report, but cannot refilter the already
    // sealed point permission or rewrite its producer time. Human roster ids remain stable through actor projection.
    sim.remove_player(caster);
    for _ in 0..3 {
        sim.step();
        projector.feed(sim.fx_report()).unwrap();
    }
    let mut observer = ItemObserver::new(viewer);
    let mut out = Observation::default();
    observer
        .prepare_with_seen(&sim, &[], &[cue.clone()], &mut out, None)
        .unwrap()
        .commit();
    assert!(
        matches!(
            out.events.as_slice(),
            [SeenEvent::CastLanded { event_time, id: Some(PlayerId(3)), target: Some(PlayerId(2)), at: Some(_), to: None, .. }]
                if *event_time == producer_time
        ),
        "the actual cue retains its sealed point and producer time after catch-up"
    );

    // Explicit actor-reference control: mutate only the presentation caster id to an unmapped reference. This is not a
    // producer claim; the allowed point still originates in the real FxProjector report captured above.
    let mut unknown_caster = cue;
    if let SeenEvent::CastLanded { id, .. } = &mut unknown_caster {
        *id = Some(PlayerId(999));
    }
    let mut out = Observation::default();
    observer
        .prepare_with_seen(&sim, &[], &[unknown_caster], &mut out, None)
        .unwrap()
        .commit();
    assert!(
        matches!(
            out.events.as_slice(),
            [SeenEvent::CastLanded { event_time, id: None, target: Some(PlayerId(2)), at: Some(_), to: None, .. }]
                if *event_time == producer_time
        ),
        "a missing caster mapping clears identity without retracting the sealed permitted point"
    );
}

#[test]
fn simultaneous_same_tick_landings_keep_each_occurrence() {
    let placements = [
        place(FactionId::Holy, 200., 200.),
        place(FactionId::Plague, 250., 200.),
        place(FactionId::Plague, 300., 200.),
    ];
    let mut sim = scene(&placements, &[]);
    let mut projector = FxProjector::attach(&sim, PlayerId(1));
    for id in [PlayerId(2), PlayerId(3)] {
        sim.submit(id, cast(Slot::Wish, 0., 0., None)).unwrap();
    }
    for _ in 0..12 {
        sim.step();
        projector.feed(sim.fx_report()).unwrap();
        let cues = landed(projector.events());
        if cues.len() == 2 {
            assert!(cues.iter().all(|cue| matches!(
                cue,
                SeenEvent::CastLanded {
                    ability: rh_sim::status_runtime::AbilityId::Swarm,
                    ..
                }
            )));
            assert!(matches!(
                cues[0], SeenEvent::CastLanded { event_time: a, .. }
                    if matches!(cues[1], SeenEvent::CastLanded { event_time: b, .. } if a == b)
            ));
            assert_ne!(cues[0], cues[1], "two real producers remain two cues");
            return;
        }
    }
    panic!("both actual Swarm casts land within the bounded wait");
}
