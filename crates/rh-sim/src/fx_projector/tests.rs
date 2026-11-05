use super::*;
use crate::systems::signatures::LandedHit;
use crate::{
    arenas::practice_arena, validate, Event, FactionId, FactionMode, Placement, RawCommand,
    Secrets, SimConfig, Vec2, WeaponId,
};
fn sim() -> Sim {
    Sim::reset_active(
        SimConfig {
            faction_mode: FactionMode::EngagementHolyPlague,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(12),
        &(0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Plague
                } else {
                    FactionId::Holy
                },
                bot: false,
                at: Vec2::new(400. + 56. * f64::from(i), 320.),
                hp: Some(1000.),
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}
fn report(
    s: &Sim,
    tick: u32,
    seen: u8,
    values: &[(u32, f64, WeaponId)],
    flush: bool,
) -> FxTickReport {
    let mut r = crate::fx_report::FxTickReport::empty(s.projection.identity.clone());
    r.complete = true;
    r.tick = tick;
    r.viewers = vec![PlayerId(1), PlayerId(2), PlayerId(3)];
    r.seen = vec![seen, 7, 7];
    for &(by, amount, weapon) in values {
        r.ops.push(Op::Contribution(LandedHit {
            victim: PlayerId(2),
            by: Some(PlayerId(by)),
            amount,
            sig: Some(SignatureKind::Disease),
            weapon: Some(weapon),
        }));
    }
    if flush {
        r.ops.push(Op::Flush(0));
    }
    r
}
fn amount(p: &FxProjector) -> f64 {
    p.events()
        .iter()
        .filter_map(|e| match e {
            SeenEvent::SignatureHit { amount, .. } => Some(*amount),
            _ => None,
        })
        .sum()
}
#[test]
fn temporal_eligibility_duplicate_gap_and_rebind() {
    let s = sim();
    let t = s.tick();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    p.feed(&report(&s, t + 1, 1, &[(3, 100., WeaponId::Axe)], false))
        .unwrap();
    p.feed(&report(&s, t + 2, 3, &[(3, 2., WeaponId::Sword)], false))
        .unwrap();
    let r = report(&s, t + 3, 3, &[(3, 3., WeaponId::Wand)], true);
    p.feed(&r).unwrap();
    assert_eq!(amount(&p), 5.);
    assert!(matches!(
        p.events(),
        [SeenEvent::SignatureHit {
            by: None,
            weapon: None,
            ..
        }]
    ));
    assert_eq!(p.feed(&r), Ok(FeedStatus::Duplicate));
    assert_eq!(amount(&p), 5.);
    p.feed(&report(&s, t + 4, 3, &[(3, 9., WeaponId::Fists)], false))
        .unwrap();
    assert_eq!(
        p.feed(&report(&s, t + 6, 3, &[(3, 4., WeaponId::Fists)], true)),
        Ok(FeedStatus::Gap)
    );
    assert_eq!(amount(&p), 4.);
    assert_eq!(p.feed(&r), Err(FxError::Backwards));
    assert!(p.events().is_empty());
    p.rebind(&s, PlayerId(1));
    assert!(p.events().is_empty());
    p.feed(&report(&s, t + 1, 3, &[], true)).unwrap();
    assert!(p.events().is_empty());
}
#[test]
fn anonymous_merge_precedes_order_and_first_weapon() {
    let s = sim();
    let t = s.tick();
    let mut a = FxProjector::attach(&s, PlayerId(1));
    let mut b = FxProjector::attach(&s, PlayerId(1));
    // Viewer knows the victim only. Distinct private sources/first weapons and addition order must disappear.
    let mut r = report(
        &s,
        t + 1,
        2,
        &[
            (1, ((1u64 << 53) as f64), WeaponId::Sword),
            (3, 1., WeaponId::Axe),
            (3, 1., WeaponId::Wand),
        ],
        true,
    );
    a.feed(&r).unwrap();
    r.ops[..3].reverse();
    b.feed(&r).unwrap();
    assert_eq!(a.events(), b.events());
    assert_eq!(amount(&a), ((1u64 << 53) as f64) + 2.);
    assert_eq!(a.events().len(), 1);
}
#[test]
fn baseline_clone_restore_and_foreign_instance_fail_closed() {
    let mut s = sim();
    s.step();
    let mut fresh = FxProjector::attach(&s, PlayerId(1));
    assert_eq!(fresh.feed(s.fx_report()), Ok(FeedStatus::Duplicate));
    assert!(fresh.events().is_empty());
    let mut cloned = s.clone();
    cloned.step();
    assert_eq!(
        fresh.feed(cloned.fx_report()),
        Err(FxError::ForeignInstance)
    );
    fresh.rebind(&cloned, PlayerId(1));
    assert_eq!(fresh.feed(cloned.fx_report()), Ok(FeedStatus::Duplicate));
    let mut restored = Sim::restore(serde_json::to_value(&cloned).unwrap()).unwrap();
    restored.step();
    assert_eq!(
        fresh.feed(restored.fx_report()),
        Err(FxError::ForeignInstance)
    );
}
#[test]
fn earned_departures_and_missing_viewer() {
    let s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    p.feed(&report(
        &s,
        s.tick() + 1,
        7,
        &[(3, 5., WeaponId::Axe)],
        false,
    ))
    .unwrap();
    let mut end = report(&s, s.tick() + 2, 1, &[], true);
    end.viewers = vec![PlayerId(1)];
    end.seen = vec![1];
    p.feed(&end).unwrap();
    assert_eq!(amount(&p), 5.);
    let mut p = FxProjector::attach(&s, PlayerId(99));
    p.feed(&report(
        &s,
        s.tick() + 1,
        7,
        &[(3, 5., WeaponId::Axe)],
        true,
    ))
    .unwrap();
    assert!(p.events().is_empty());
}
#[test]
fn table_uses_actual_ids_and_frozen_visibility() {
    let s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(105));
    let mut r = report(&s, s.tick() + 1, 3, &[], true);
    r.viewers = vec![PlayerId(105), PlayerId(900)];
    r.seen = vec![3, 3];
    r.ops.insert(
        0,
        Op::Contribution(LandedHit {
            victim: PlayerId(900),
            by: Some(PlayerId(105)),
            amount: 7.,
            sig: Some(SignatureKind::Disease),
            weapon: Some(WeaponId::Fists),
        }),
    );
    p.feed(&r).unwrap();
    assert_eq!(amount(&p), 7.);
}
#[test]
fn caller_prefix_pending_leave_and_ended_steps_never_inject_or_repeat() {
    let mut a = sim();
    let mut b = a.clone();
    let mut fa = FxProjector::attach(&a, PlayerId(2));
    let mut fb = FxProjector::attach(&b, PlayerId(2));
    for s in [&mut a, &mut b] {
        s.submit(
            PlayerId(1),
            validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
    }
    let injected = vec![
        Event::SignatureHit {
            victim: PlayerId(2),
            by: PlayerId(3),
            sig: SignatureKind::Disease,
            weapon: Some(WeaponId::Axe),
            amount: 900.,
        },
        Event::Heal {
            id: PlayerId(2),
            amount: 800.,
        },
    ];
    let mut chunks = 0;
    for n in 0..25 {
        if n == 6 {
            a.remove_player(PlayerId(1));
            b.remove_player(PlayerId(1));
            a.remove_player(PlayerId(3));
            b.remove_player(PlayerId(3));
        }
        let ea = a.step();
        let mut eb = injected.clone();
        b.step_into(&mut eb);
        assert_eq!(ea, &eb[injected.len()..]);
        fa.feed(a.fx_report()).unwrap();
        fb.feed(b.fx_report()).unwrap();
        assert_eq!(fa.events(), fb.events());
        assert_eq!(a.state_hash(), b.state_hash());
        chunks += fa
            .events()
            .iter()
            .filter(|e| matches!(e, SeenEvent::SignatureHit { .. }))
            .count();
        if n > 7 {
            assert!(fa.events().is_empty());
        }
    }
    assert!(chunks > 0);
}
#[test]
fn reset_is_silent_and_bounds_explicit() {
    let s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    p.feed(&report(
        &s,
        s.tick() + 1,
        7,
        &[(3, 4., WeaponId::Axe)],
        false,
    ))
    .unwrap();
    let mut r = report(&s, s.tick() + 2, 7, &[], true);
    r.ops.insert(0, Op::Reset(0));
    p.feed(&r).unwrap();
    assert!(p.events().is_empty());
    let mut r = report(&s, s.tick() + 3, 7, &[], false);
    r.bounded = false;
    assert_eq!(p.feed(&r), Err(FxError::UnsupportedBounds));
}

#[test]
fn cached_delivery_rejects_wrong_viewer_stale_tick_and_other_instance() {
    let mut s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    let mut out = Vec::new();
    assert_eq!(
        p.append_into(&s, PlayerId(2), &mut out),
        Err(FxError::WrongViewer)
    );
    s.step();
    assert_eq!(
        p.append_into(&s, PlayerId(1), &mut out),
        Err(FxError::StaleOutput)
    );
    p.feed(s.fx_report()).unwrap();
    p.append_into(&s, PlayerId(1), &mut out).unwrap();
    assert_eq!(
        p.append_into(&s.clone(), PlayerId(1), &mut out),
        Err(FxError::ForeignInstance)
    );
}

#[test]
fn trusted_active_reset_does_not_expose_bootstrap_report() {
    let s = sim();
    assert!(!s.fx_report().complete);
    assert!(s.fx_report().events.is_empty());
    assert!(s.fx_report().ops.is_empty());
    let mut clone = s.clone();
    assert!(!clone.fx_report().complete);
    clone.step();
    assert!(clone.fx_report().complete);
}

// Pipeline-consistent helper reports isolate projection from producer rules. Raw rows remain private.
fn instant_report(
    s: &Sim,
    tick: u32,
    rows: &[(u32, f64, WeaponId)],
    reverse_hidden: bool,
) -> FxTickReport {
    let mut r = report(s, tick, 3, &[], false);
    r.viewers.push(PlayerId(4));
    r.seen.push(15);
    // Real physical FX before/after the fixed ledger boundary must keep their relative position.
    r.events.push(Event::Hit {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        amount: 4.,
        weapon: Some(WeaponId::Sword),
        passive: false,
    });
    if reverse_hidden {
        r.events.insert(
            0,
            Event::SignatureHit {
                victim: PlayerId(3),
                by: PlayerId(4),
                sig: SignatureKind::Backlash,
                weapon: Some(WeaponId::Axe),
                amount: 8.,
            },
        );
    }
    for &(by, amount, weapon) in rows {
        r.events.push(Event::SignatureHit {
            victim: PlayerId(2),
            by: PlayerId(by),
            sig: SignatureKind::Backlash,
            weapon: Some(weapon),
            amount,
        });
    }
    r.ops.push(Op::InstantFlush(r.events.len()));
    r.events.push(Event::Heal {
        id: PlayerId(2),
        amount: 2.,
    });
    r
}
#[test]
fn instant_anonymous_exact_sum_fixed_marker_and_delayed_independence() {
    let s = sim();
    let t = s.tick();
    let mut a = FxProjector::attach(&s, PlayerId(1));
    let mut b = FxProjector::attach(&s, PlayerId(1));
    let hidden = [
        (3, 1e16, WeaponId::Axe),
        (3, 1., WeaponId::Bow),
        (3, 1., WeaponId::Wand),
    ];
    let r = instant_report(&s, t + 1, &hidden, false);
    let mut other = instant_report(
        &s,
        t + 1,
        &[
            (3, 1., WeaponId::Wand),
            (3, 1., WeaponId::Bow),
            (3, 1e16, WeaponId::Sword),
        ],
        true,
    );
    a.feed(&r).unwrap();
    b.feed(&other).unwrap();
    assert_eq!(a.events(), b.events());
    assert!(
        matches!(a.events(), [SeenEvent::Hit {..},SeenEvent::SignatureHit {by:None,weapon:None,sig:SignatureKind::Backlash,amount,..},SeenEvent::Heal {..}] if *amount==10000000000000002.)
    );
    assert_eq!(a.feed(&r), Ok(FeedStatus::Duplicate));
    // Burn is retained; an instant flush neither duplicates nor clears it.
    other = instant_report(&s, t + 2, &[(3, 4., WeaponId::Bow)], false);
    other.ops.insert(
        0,
        Op::Contribution(LandedHit {
            victim: PlayerId(2),
            by: Some(PlayerId(3)),
            sig: Some(SignatureKind::Burn),
            weapon: Some(WeaponId::Axe),
            amount: 7.,
        }),
    );
    a.feed(&other).unwrap();
    assert_eq!(amount(&a), 4.);
    let flush = report(&s, t + 3, 3, &[], true);
    a.feed(&flush).unwrap();
    assert!(matches!(
        a.events(),
        [SeenEvent::SignatureHit {
            sig: SignatureKind::Burn,
            amount: 7.,
            ..
        }]
    ));
    a.feed(&report(&s, t + 4, 3, &[], true)).unwrap();
    assert!(a.events().is_empty());
}
#[test]
fn instant_count_redaction_and_explicit_bounds() {
    let s = sim();
    let t = s.tick();
    let mut a = FxProjector::attach(&s, PlayerId(1));
    let mut b = FxProjector::attach(&s, PlayerId(1));
    a.feed(&instant_report(&s, t + 1, &[(3, 8., WeaponId::Bow)], false))
        .unwrap();
    b.feed(&instant_report(
        &s,
        t + 1,
        &[(3, 4., WeaponId::Axe), (3, 4., WeaponId::Wand)],
        false,
    ))
    .unwrap();
    assert_eq!(a.events(), b.events());
    let mut invalid = instant_report(&s, t + 2, &[(3, 1., WeaponId::Bow)], false);
    invalid.ops.push(Op::InstantFlush(invalid.events.len()));
    assert_eq!(a.feed(&invalid), Err(FxError::UnsupportedBounds));
    assert!(a.events().is_empty());
    b.rebind(&s, PlayerId(1));
    let many = instant_report(&s, t + 1, &vec![(3, 1., WeaponId::Bow); 513], false);
    assert_eq!(b.feed(&many), Err(FxError::UnsupportedBounds));
}
#[test]
fn every_empty_active_ledger_has_one_fixed_marker_and_no_stale_instant_output() {
    let mut s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    for _ in 0..25 {
        s.step();
        let r = s.fx_report();
        assert_eq!(
            r.ops
                .iter()
                .filter(|op| matches!(op, Op::InstantFlush(_)))
                .count(),
            1
        );
        assert!(!r
            .events
            .iter()
            .any(|e| matches!(e, Event::SignatureHit { .. })));
        p.feed(r).unwrap();
        assert!(p.events().is_empty());
    }
}

#[test]
fn helper_mark_raw_rows_have_separate_envelope_from_public_keys() {
    let s = sim();
    let mut p = FxProjector::attach(&s, PlayerId(1));
    let rows = vec![(3, 1., WeaponId::Bow); 128];
    let mut r = instant_report(&s, s.tick() + 1, &rows, false);
    for e in &mut r.events {
        if let Event::SignatureHit { sig, .. } = e {
            *sig = SignatureKind::Mark;
        }
    }
    p.feed(&r).unwrap();
    assert!(
        matches!(p.events(),[SeenEvent::Hit {..},SeenEvent::SignatureHit {by:None,weapon:None,sig:SignatureKind::Mark,amount,..},SeenEvent::Heal {..}] if *amount==128.)
    );
    // Rows are never truncated to the public bucket capacity or performed-request count.
    let mut over = instant_report(&s, s.tick() + 2, &vec![(3, 1., WeaponId::Bow); 513], false);
    for e in &mut over.events {
        if let Event::SignatureHit { sig, .. } = e {
            *sig = SignatureKind::Mark;
        }
    }
    assert_eq!(p.feed(&over), Err(FxError::UnsupportedBounds));
}
