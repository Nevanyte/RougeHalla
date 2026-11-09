//! Native projection controls, not an actual RaidRoom/source-capture witness.
use super::*;
use crate::results::GvReason;
fn projected(events: &[Event], owner: Option<PlayerId>) -> Vec<SeenEvent> {
    let mut out = Vec::new();
    filter_events(events, owner, |_| true, |_| [true; 2], &mut out);
    out
}
#[test]
fn quest_gv_preserves_integer_text_owner_class_and_event_position() {
    for (amount, expected) in [
        (0, "+0 GV (quest)"),
        (10, "+10 GV (quest)"),
        (u32::MAX, "+4294967295 GV (quest)"),
    ] {
        let gv = Event::Gv {
            id: PlayerId(1),
            amount,
            reason: GvReason::Quest,
        };
        assert_eq!(gv.visibility(), Visibility::Owner(PlayerId(1)));
        assert_eq!(gv.class(), Class::Important);
        let events = [
            Event::Toast {
                to: Some(PlayerId(1)),
                text: "before".into(),
            },
            gv,
            Event::Toast {
                to: None,
                text: "after".into(),
            },
        ];
        assert_eq!(
            projected(&events, Some(PlayerId(1))),
            vec![
                SeenEvent::Toast {
                    text: "before".into()
                },
                SeenEvent::Toast {
                    text: expected.into()
                },
                SeenEvent::Toast {
                    text: "after".into()
                }
            ]
        );
        for owner in [Some(PlayerId(2)), None] {
            assert_eq!(
                projected(&events, owner),
                vec![SeenEvent::Toast {
                    text: "after".into()
                }]
            );
        }
        let seen = to_seen(&events[1], &|_| true, [true; 2]).unwrap();
        assert_eq!(seen.class(), events[1].class());
    }
}
#[test]
fn every_other_gv_reason_remains_server_only_for_every_observer() {
    let events = [
        GvReason::Kill,
        GvReason::Mob,
        GvReason::Elite,
        GvReason::Bounty,
        GvReason::Skip,
        GvReason::Win,
    ]
    .map(|reason| Event::Gv {
        id: PlayerId(1),
        amount: 10,
        reason,
    });
    for event in &events {
        assert_eq!(event.visibility(), Visibility::ServerOnly);
        assert_eq!(event.class(), Class::ServerOnly);
        assert_eq!(to_seen(event, &|_| true, [true; 2]), None);
    }
    for owner in [Some(PlayerId(1)), Some(PlayerId(2)), None] {
        assert!(projected(&events, owner).is_empty());
    }
}
#[test]
fn identical_player_labels_never_grant_the_foreign_quest_payment_notice() {
    let placements = [100., 140.].map(|x| crate::Placement {
        profile: "same label".into(),
        faction: crate::FactionId::Holy,
        bot: false,
        at: crate::Vec2::new(x, 100.),
        hp: None,
        weapon0: None,
        weapon1: None,
    });
    let sim = Sim::reset_active(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(7),
        &placements,
    );
    assert_eq!(sim.players()[0].seat.name, sim.players()[1].seat.name);
    let before = sim.state_hash();
    let events = [Event::Gv {
        id: PlayerId(1),
        amount: 10,
        reason: GvReason::Quest,
    }];
    let own = crate::observe(&sim, PlayerId(1), &events);
    assert_eq!(
        own.events,
        vec![SeenEvent::Toast {
            text: "+10 GV (quest)".into()
        }]
    );
    assert!(crate::observe(&sim, PlayerId(2), &events).events.is_empty());
    assert!(crate::observe(&sim, PlayerId(99), &events)
        .events
        .is_empty());
    assert_eq!(sim.state_hash(), before);
    assert!(matches!(
        events,
        [Event::Gv {
            amount: 10,
            reason: GvReason::Quest,
            ..
        }]
    ));
}

#[path = "quest_gv_tests/source_room.rs"]
mod source_room;
