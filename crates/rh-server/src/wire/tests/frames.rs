//! Frame encoding guards and combat mapping: refused off-grid fx, omitted effect announcements, owner combat and privacy.

use super::*;

/// An Fx frame with a swing off the position grid is refused and reported, not clamped (release) nor a panic in the
/// room (debug); a good frame is the message's own bytes.
#[test]
fn an_fx_frame_off_the_grid_is_refused_not_clamped() {
    let swing = |x: f32| WireFx::Swing {
        by: 3,
        weapon: 1,
        x,
        y: 10.0,
        a: 0.5,
    };
    let mut refused = None;
    let good = ServerMsg::Fx {
        tick: 9,
        fx: vec![swing(100.0)],
    };
    assert_eq!(encode_or_refuse(&good, &mut refused), Some(good.encode()));
    assert!(refused.is_none());
    for x in [POS_MAX + 1.0, -1.0, f32::NAN] {
        let bad = ServerMsg::Fx {
            tick: 9,
            fx: vec![swing(100.0), swing(x)],
        };
        let mut refused = None;
        assert_eq!(encode_or_refuse(&bad, &mut refused), None, "{x}");
        assert_eq!(
            refused,
            Some(rh_protocol::EncodeError::BadValue("position"))
        );
    }
    // The first refusal of a wake is the one kept.
    let mut refused = Some(rh_protocol::EncodeError::NonFinite);
    let bad = ServerMsg::Fx {
        tick: 9,
        fx: vec![swing(-5.0)],
    };
    assert_eq!(encode_or_refuse(&bad, &mut refused), None);
    assert_eq!(refused, Some(rh_protocol::EncodeError::NonFinite));
}

#[test]
fn omitted_effect_announcements_leave_frames_and_redaction_unchanged() {
    use rh_sim::status_runtime::{AbilityId, StatusKind};
    assert_eq!(rh_protocol::PROTOCOL_VERSION, 22); // 19 -> 20: P-SYNC-ORIGIN-1; origin 20, 21 -> 22: P-SYNC-ORIGIN-2
    let env = seed1_match(1);
    let id = env.sim.players()[0].id;
    let mut publisher = Publisher::default();
    let baseline = publisher.frames(&env.sim, id, 7, &[], &mut Vec::new(), &[]);
    assert!(baseline.important.is_none() && baseline.fx.is_none());
    for by in [None, Some(id)] {
        // These are already-observed carry events, the input boundary of this wire adapter. Ability and signature
        // chunks and heals have their own fx since ADR0026 (see `indicator_fx_follow_the_observed_events`).
        let _ = AbilityId::Blaze;
        let omitted = vec![SeenEvent::StatusApplied {
            id,
            by,
            kind: StatusKind::Hidden,
            ms: 500.,
        }];
        let mut carry = omitted.clone();
        let frames = publisher.frames(&env.sim, id, 7, &[], &mut carry, &[]);
        assert!(carry.is_empty());
        assert!(frames.important.is_none() && frames.fx.is_none() && frames.refused.is_none());
        assert_eq!(frames.snapshot, baseline.snapshot);
        assert_eq!(publisher.observation().events, omitted);

        let mut carry = omitted;
        carry.push(SeenEvent::Hit {
            victim: id,
            by,
            amount: 2.,
            passive: true,
            critical: false,
        });
        let frames = publisher.frames(&env.sim, id, 7, &[], &mut carry, &[]);
        assert!(frames.important.is_none() && frames.refused.is_none());
        assert_eq!(frames.snapshot, baseline.snapshot);
        let expected = ServerMsg::Fx {
            tick: env.sim.tick(),
            fx: vec![WireFx::Hit {
                victim: id.0,
                by: by.map_or(WIRE_NO_SOURCE, |p| p.0),
                amount: 2.,
                passive: true,
                critical: false,
            }],
        }
        .try_encode()
        .unwrap();
        assert_eq!(frames.fx, Some(expected));
        let empty = publisher.frames(&env.sim, id, 7, &[], &mut Vec::new(), &[]);
        assert!(empty.fx.is_none() && empty.important.is_none());
    }
}

#[test]
fn combat_mapping_preserves_privacy_passive_and_channels() {
    use rh_sim::{PickupRefusal, PlayerId};
    let id = PlayerId(2);
    assert!(matches!(
        to_wire(&SeenEvent::Death { id, by: None }),
        Wire::Event(WireEvent::Death { id: 2, by: None })
    ));
    for passive in [false, true] {
        let e = SeenEvent::Hit {
            victim: id,
            by: None,
            amount: 3.0,
            passive,
            critical: false,
        };
        assert_eq!(e.class(), Class::Fx);
        assert!(
            matches!(to_wire(&e), Wire::Fx(WireFx::Hit { by: WIRE_NO_SOURCE, passive: p, .. }) if p == passive)
        );
    }
    for by in [None, Some(PlayerId(1))] {
        let e = SeenEvent::Block {
            id,
            by,
            weapon: rh_sim::content::WeaponId::ALL[1],
        };
        assert_eq!(e.class(), Class::Fx);
        assert!(
            matches!(to_wire(&e), Wire::Fx(WireFx::Block { by: b, .. }) if b == by.map_or(WIRE_NO_SOURCE, |p| p.0))
        );
    }
    assert!(matches!(
        to_wire(&SeenEvent::Stagger { id }),
        Wire::Fx(WireFx::Stagger { id: 2 })
    ));
    assert!(matches!(
        to_wire(&SeenEvent::AttackCancelled { id }),
        Wire::Fx(WireFx::Cancel { id: 2 })
    ));
    assert!(matches!(
        to_wire(&SeenEvent::Heal { id, amount: 1.0 }),
        Wire::Fx(WireFx::Heal { id: 2, amount }) if amount == 1.0
    ));
    for by in [None, Some(PlayerId(1))] {
        for kind in rh_sim::status_runtime::STATUS_KINDS {
            assert!(matches!(
                to_wire(&SeenEvent::StatusApplied {
                    id,
                    by,
                    kind,
                    ms: 500.
                }),
                Wire::Omitted
            ));
        }
        for (code, ability) in rh_sim::status_runtime::AbilityId::ALL
            .into_iter()
            .enumerate()
        {
            assert!(matches!(
                to_wire(&SeenEvent::AbilityHit {
                    victim: id,
                    by,
                    ability,
                    amount: 10.
                }),
                Wire::Fx(WireFx::SigHit { victim: 2, by: b, kind, .. })
                    if kind == rh_protocol::HIT_KIND_ABILITY + code as u8
                        && b == by.map_or(WIRE_NO_SOURCE, |p| p.0)
            ));
        }
    }
    for ability in rh_sim::status_runtime::AbilityId::ALL {
        for reason in [
            rh_sim::status_runtime::CastEndReason::Fizzle,
            rh_sim::status_runtime::CastEndReason::Interrupted,
            rh_sim::status_runtime::CastEndReason::Cancelled,
        ] {
            assert!(matches!(
                to_wire(&SeenEvent::CastEnded {
                    event_time: 100.,
                    id,
                    ability,
                    reason
                }),
                Wire::Fx(WireFx::WishEnded {
                    event_time: 100.,
                    ..
                })
            ));
        }
    }
    for (by, sig) in [None, Some(id)]
        .into_iter()
        .flat_map(|by| rh_sim::factions::SignatureKind::ALL.map(|sig| (by, sig)))
    {
        let want = match sig {
            rh_sim::factions::SignatureKind::Burn => rh_protocol::HIT_KIND_BURN,
            rh_sim::factions::SignatureKind::Disease => rh_protocol::HIT_KIND_DISEASE,
            rh_sim::factions::SignatureKind::Backlash => rh_protocol::HIT_KIND_BACKLASH,
            rh_sim::factions::SignatureKind::Mark => rh_protocol::HIT_KIND_MARK,
        };
        assert!(matches!(
            to_wire(&SeenEvent::SignatureHit {
                victim: id,
                by,
                sig,
                weapon: Some(rh_sim::WeaponId::Axe),
                amount: 10.
            }),
            Wire::Fx(WireFx::SigHit { kind, amount, .. }) if kind == want && amount == 10.0
        ));
    }
    // ADR0026: the windup telegraph keeps its attacker, weapon and angle; its wait is whole milliseconds, saturated.
    for (ms, want) in [(350.4, 350), (-5.0, 0), (f64::NAN, 0), (1e9, u16::MAX)] {
        assert!(matches!(
            to_wire(&SeenEvent::Windup {
                by: id,
                weapon: rh_sim::WeaponId::Axe,
                a: 0.5,
                ms
            }),
            Wire::Fx(WireFx::Windup { by: 2, weapon, a, ms: got })
                if weapon == rh_sim::WeaponId::Axe.code() && a == 0.5 && got == want
        ));
    }
    assert!(matches!(
        to_wire(&SeenEvent::CampCleared { camp: 7 }),
        Wire::Event(WireEvent::CampCleared { camp: 7 })
    ));
    assert!(matches!(
        to_wire(&SeenEvent::CampCleared { camp: 70_000 }),
        Wire::Refused("camp")
    ));
    for critical in [false, true] {
        assert!(matches!(
            to_wire(&SeenEvent::Hit {
                victim: id,
                by: None,
                amount: 3.0,
                passive: false,
                critical,
            }),
            Wire::Fx(WireFx::Hit { critical: c, .. }) if c == critical
        ));
    }
    for (reason, code) in [
        (PickupRefusal::Blocked, 1),
        (PickupRefusal::NothingThere, 2),
        (PickupRefusal::TooFar, 3),
        (PickupRefusal::Unreachable, 4),
        (PickupRefusal::NothingToTake, 5),
    ] {
        let e = SeenEvent::PickupRefused { reason };
        assert_eq!(e.class(), Class::Important);
        assert!(
            matches!(to_wire(&e), Wire::Event(WireEvent::PickupRefused { reason: r }) if r == code)
        );
    }
    assert!(matches!(
        command(WireCommand::Swap { slot: None }),
        rh_sim::PublicCommand::Swap { slot: None }
    ));
    assert!(matches!(
        command(WireCommand::Pickup {
            handle: rh_protocol::PickupHandle::new(42).unwrap()
        }),
        rh_sim::PublicCommand::Pickup { handle } if handle.get()==42
    ));
}
