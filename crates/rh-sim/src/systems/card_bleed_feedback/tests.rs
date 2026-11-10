//! Focused unit tests for the trusted Card report, the closed B3 amount domain and the exact sidecar.

use super::*;
use crate::state::PlayerId;
use crate::{validate, RawCommand, Sim};

/// The Card marker kinds and event indices recorded this tick, in order.
fn card_markers(fx: &TickFx) -> Vec<&'static str> {
    fx.ops
        .iter()
        .filter_map(|op| match op {
            Op::CardSegment(_) => Some("segment"),
            Op::CardFlush(_) => Some("flush"),
            Op::CardReset(_) => Some("reset"),
            _ => None,
        })
        .collect()
}

fn amount_of(report: &CardBleedReport) -> Vec<(u32, Option<u32>, CardBleedAmount)> {
    report
        .rows
        .iter()
        .map(|r| (r.victim.0, r.by.map(|p| p.0), r.amount))
        .collect()
}

#[test]
fn b3_serde_roundtrips_canonical_finite_bits_and_tags() {
    // Finite values keep their exact bits, including signed zero and the largest finite value.
    for bits in [
        0x0000_0000_0000_0000u64,
        0x8000_0000_0000_0000, // -0.0
        0x0000_0000_0000_0001, // minimum subnormal
        0x7fef_ffff_ffff_ffff, // maximum finite
        0x3ff0_0000_0000_0000, // 1.0
    ] {
        let value = f64::from_bits(bits);
        let amount = CardBleedAmount::Finite(value);
        let json = serde_json::to_value(amount).unwrap();
        assert_eq!(json, serde_json::json!({"Finite": value}), "{bits:#x}");
        let back: CardBleedAmount = serde_json::from_value(json).unwrap();
        assert_eq!(back, amount);
        assert_eq!(back.finite_bits(), Some(bits));
    }
    for (amount, json) in [
        (
            CardBleedAmount::PositiveInfinity,
            serde_json::json!("PositiveInfinity"),
        ),
        (CardBleedAmount::NotANumber, serde_json::json!("NotANumber")),
    ] {
        assert_eq!(serde_json::to_value(amount).unwrap(), json);
        assert_eq!(
            serde_json::from_value::<CardBleedAmount>(json).unwrap(),
            amount
        );
        assert_eq!(amount.finite_bits(), None);
    }
    assert_eq!(CardBleedAmount::Finite(1.0).tag(), 0);
    assert_eq!(CardBleedAmount::PositiveInfinity.tag(), 1);
    assert_eq!(CardBleedAmount::NotANumber.tag(), 2);
}

#[test]
fn strict_intake_rejects_malformed_ambiguous_and_nonfinite_payloads() {
    // Every rejected shape must fail, never coerce: negative Finite, nonfinite Finite (an IEEE special as a
    // payload or a null alias), unknown tags, payloads on special tags and a duplicate discriminant.
    for json in [
        serde_json::json!({"Finite": -1.0}),
        serde_json::json!({"Finite": -0.0001}),
        serde_json::json!({"Finite": null}),
        serde_json::json!({"Finite": "1"}),
        serde_json::json!({"Finite": ["1"]}),
        serde_json::json!({"Infinity": 1.0}),
        serde_json::json!({"PositiveInfinity": 0}),
        serde_json::json!({"NotANumber": false}),
        serde_json::json!({"NaN": 1.0}),
        serde_json::json!({"finite": 1.0}),
        serde_json::json!("Finite"),
        serde_json::json!("infinity"),
        serde_json::json!(1.0),
        serde_json::json!(null),
        serde_json::json!({}),
        serde_json::json!([1.0]),
    ] {
        assert!(
            serde_json::from_value::<CardBleedAmount>(json.clone()).is_err(),
            "accepted malformed B3 value {json}"
        );
    }
    // A duplicate discriminant cannot be read as the same closed value twice.
    let duplicated = r#"{"Finite":1.0,"Finite":2.0}"#;
    assert!(
        serde_json::from_str::<CardBleedAmount>(duplicated).is_err(),
        "accepted a duplicate B3 discriminant"
    );
    // A canonical finite signed zero is allowed and keeps its sign.
    let negative_zero: CardBleedAmount = serde_json::from_str(r#"{"Finite":-0.0}"#).unwrap();
    assert_eq!(negative_zero.finite_bits(), Some(0x8000_0000_0000_0000));
}

#[test]
fn source_ordered_finite_fold_preserves_rounding_and_classifies_overflow_and_nan() {
    // Ordinary finite repeats fold with the source's sequential binary64 addition, not an exact sum.
    let mut report = CardBleedReport::default();
    let victim = PlayerId(2);
    let by = Some(PlayerId(1));
    report.note(150., victim, by, 0.1);
    report.note(200., victim, by, 0.2);
    let expected = 0.1f64 + 0.2f64;
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::Finite(expected))]
    );
    // First-use clock is set once by the first eligible hit and retained by the fold.
    assert_eq!(report.since, Some(150.));
    // Distant floats whose exact sum is representable must still round exactly as the source would.
    let mut report = CardBleedReport::default();
    report.note(0., victim, None, 1.0);
    report.note(0., victim, None, 1.0 / (1u64 << 53) as f64);
    assert_eq!(
        report.rows[0].amount,
        CardBleedAmount::Finite(1.0f64 + 1.0 / (1u64 << 53) as f64)
    );
    // Finite overflow becomes the payload-free PositiveInfinity tag; NaN is absorbing; +Infinity stays.
    let mut report = CardBleedReport::default();
    report.note(0., victim, by, f64::MAX);
    report.note(0., victim, by, f64::MAX);
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::PositiveInfinity)]
    );
    report.note(0., victim, by, 1.0);
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::PositiveInfinity)]
    );
    report.note(0., victim, by, f64::NAN);
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::NotANumber)]
    );
    let mut report = CardBleedReport::default();
    report.note(0., victim, by, f64::NAN);
    report.note(0., victim, by, 3.0);
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::NotANumber)]
    );
    // A landed infinity is a valid B3 first value; the fold keeps adding finite values under it.
    let mut report = CardBleedReport::default();
    report.note(0., victim, by, f64::INFINITY);
    report.note(0., victim, by, 0.5);
    assert_eq!(
        amount_of(&report),
        vec![(2, Some(1), CardBleedAmount::PositiveInfinity)]
    );
}

#[test]
fn first_insertion_order_append_and_exact_pair_identity_are_preserved() {
    let mut report = CardBleedReport::default();
    report.note(100., PlayerId(2), Some(PlayerId(1)), 1.);
    report.note(100., PlayerId(3), None, 2.);
    report.note(100., PlayerId(2), Some(PlayerId(1)), 3.);
    report.note(100., PlayerId(2), Some(PlayerId(0)), 4.);
    report.note(100., PlayerId(2), None, 5.);
    assert_eq!(
        amount_of(&report),
        vec![
            (2, Some(1), CardBleedAmount::Finite(4.)),
            (3, None, CardBleedAmount::Finite(2.)),
            (2, Some(0), CardBleedAmount::Finite(4.)),
            (2, None, CardBleedAmount::Finite(5.)),
        ]
    );
    // The derived index agrees with every row.
    for (row, bucket) in report.rows.iter().enumerate() {
        assert_eq!(
            report.index.find(bucket.victim, bucket.by),
            Some(row as u32)
        );
    }
}

#[test]
fn flush_emits_rows_in_order_clears_rows_retains_capacity_and_restarts_clock() {
    let mut report = CardBleedReport::default();
    report.prepare(8).unwrap();
    let capacity = report.rows.capacity();
    report.note(150., PlayerId(2), Some(PlayerId(1)), 1.);
    report.note(200., PlayerId(3), None, 2.);
    let mut ev = Vec::new();
    let mut fx = TickFx::default();
    report.flush(650., &mut ev, Some(&mut fx));
    assert_eq!(
        ev,
        vec![
            Event::CardBleedHit {
                victim: PlayerId(2),
                by: Some(PlayerId(1)),
                amount: CardBleedAmount::Finite(1.)
            },
            Event::CardBleedHit {
                victim: PlayerId(3),
                by: None,
                amount: CardBleedAmount::Finite(2.)
            },
        ]
    );
    assert_eq!(card_markers(&fx), vec!["flush"]);
    assert!(report.rows.is_empty());
    assert_eq!(report.since, Some(650.));
    assert_eq!(report.rows.capacity(), capacity);
    // An existing report flushes empty (the source sets the clock even when it emits nothing).
    let mut ev = Vec::new();
    let mut fx = TickFx::default();
    report.flush(1150., &mut ev, Some(&mut fx));
    assert!(ev.is_empty());
    assert_eq!(card_markers(&fx), vec!["flush"]);
    assert_eq!(report.since, Some(1150.));
    // A reset drops the report entirely and retains capacity.
    report.reset();
    assert!(!report.exists());
    assert!(report.rows.is_empty());
    assert_eq!(report.rows.capacity(), capacity);
    let mut ev = Vec::new();
    report.flush(2000., &mut ev, None);
    assert!(ev.is_empty(), "no report means no flush");
}

#[test]
fn source_periodic_interval_is_inclusive_500_ms_and_needs_a_report() {
    // No report: even a long elapsed time creates no state and emits no marker.
    let mut ev = Vec::new();
    let mut fx = TickFx::default();
    let mut w = crate::state::World::new(&crate::Secrets::from_seed(3));
    w.server_time = 500.;
    periodic(&mut w, &mut ev, &mut fx);
    assert!(ev.is_empty() && fx.ops.is_empty());
    // At exactly the 500 ms boundary the source flushes (>=, not >).
    w.card_bleed.note(0., PlayerId(2), None, 1.);
    w.card_bleed.since = Some(0.);
    periodic(&mut w, &mut ev, &mut fx);
    assert_eq!(card_markers(&fx), vec!["flush"]);
    assert_eq!(ev.len(), 1);
    // One tick before the next boundary nothing happens.
    ev.clear();
    fx.ops.clear();
    w.server_time = 550.;
    periodic(&mut w, &mut ev, &mut fx);
    assert!(ev.is_empty() && fx.ops.is_empty());
    w.server_time = 1000.;
    periodic(&mut w, &mut ev, &mut fx);
    assert_eq!(card_markers(&fx), vec!["flush"]);
}

#[test]
fn exact_sidecar_classifications_and_exact_merge_have_no_intermediate_rounding() {
    // Distinct raw pairs keep first-occurrence rows; finite repeats merge exactly.
    let mut segment = CardSegment::default();
    segment.prepare(8).unwrap();
    segment.note(PlayerId(2), Some(PlayerId(1)), 0.1);
    segment.note(PlayerId(2), Some(PlayerId(1)), 0.2);
    segment.note(PlayerId(3), None, 4.);
    assert_eq!(segment.rows.len(), 2);
    let mut reference = ExactSum::default();
    reference.add(0.1).unwrap();
    reference.add(0.2).unwrap();
    assert_eq!(segment.rows[0].sum.rounded(), reference.rounded());
    // The exact rounding keeps the sum of 0.1 and 0.2 rather than their binary64 fold when different.
    assert_eq!(
        segment.rows[0].sum.rounded(),
        Ok(0.1f64 + 0.2f64) // both round to the same nearest binary64 here
    );
    // Nonfinite/negative input is a local InvalidAmount classification, exact overflow a local Overflow.
    segment.note(PlayerId(9), None, f64::NAN);
    segment.note(PlayerId(10), None, -1.0);
    segment.note(PlayerId(11), None, f64::INFINITY);
    assert!(segment.rows[2].invalid && segment.rows[3].invalid && segment.rows[4].invalid);
    segment.note(PlayerId(4), None, f64::MAX);
    segment.note(PlayerId(4), None, f64::MAX);
    let row = segment.rows.last().unwrap();
    // Two maximum finite values still fit the exact integer domain: they are an exact sum that rounds past the
    // maximum finite binary64, so the typed Overflow is raised at the public rounding step (checked exact
    // accumulation/carry failures are tested directly on the exact domain below and in `exact.rs`).
    assert!(!row.overflow && !row.invalid);
    assert_eq!(row.sum.rounded(), Err(SumError::Overflow));
    // A repeated invalid amount keeps the first local classification and never rounds.
    segment.note(PlayerId(9), None, 1.0);
    assert!(segment.rows[2].invalid);
    let mut merged = ExactSum::default();
    merged.add(1.0).unwrap();
    let mut other = ExactSum::default();
    other.add(1.0 / (1u64 << 53) as f64).unwrap();
    other.add(1.0 / (1u64 << 53) as f64).unwrap();
    merged.merge(&other).unwrap();
    assert_eq!(merged.rounded(), Ok(1.0 + 2.0 / (1u64 << 53) as f64));
    // Exact finite sums that round past the maximum finite binary64 are a typed Overflow, not a clamp.
    let mut max = ExactSum::default();
    max.add(f64::MAX).unwrap();
    let mut huge = ExactSum::default();
    for _ in 0..5 {
        huge.add(f64::MAX).unwrap();
    }
    max.merge(&huge).unwrap();
    assert_eq!(max.rounded(), Err(SumError::Overflow));
}

#[test]
fn card_bleed_hit_is_server_only_and_never_projected_by_to_seen() {
    let event = Event::CardBleedHit {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        amount: CardBleedAmount::Finite(1.5),
    };
    assert_eq!(event.visibility(), crate::Visibility::ServerOnly);
    assert_eq!(event.class(), crate::Class::ServerOnly);
    let mut out = Vec::new();
    crate::observe::filter_events(
        std::slice::from_ref(&event),
        Some(PlayerId(1)),
        |_| true,
        |_| [true, true],
        &mut out,
    );
    assert!(out.is_empty(), "a raw Card row reached an observation path");
    // The typed event serializes canonically and reads back strictly, including in a pending-event list.
    let json = serde_json::to_value(&event).unwrap();
    assert_eq!(
        json["CardBleedHit"]["amount"],
        serde_json::json!({"Finite": 1.5})
    );
    let back: Event = serde_json::from_value(json).unwrap();
    assert_eq!(back, event);
    let json = serde_json::to_string(&event).unwrap();
    assert!(
        !json.contains("null"),
        "no special float may serialize as null"
    );
    assert!(!json.contains("Infinity") || json.contains("PositiveInfinity"));
}

#[test]
fn report_validation_rejects_incoherent_clock_rows_provenance_and_duplicates() {
    let known = |id: PlayerId| id.0 <= 4;
    let mut report = CardBleedReport::default();
    // Rows without a report clock.
    report.note(0., PlayerId(2), None, 1.);
    report.since = None;
    assert!(report.validate(100., &known).is_err());
    // A future clock is refused. A fractional accepted clock (a lifecycle-off baseline epoch) is a real producer
    // clock: the report clock records `world.server_time`, so no fix-grid equality may be invented here.
    let mut report = CardBleedReport::default();
    report.note(150., PlayerId(2), None, 1.);
    assert!(report.validate(100., &known).is_err());
    let mut report = CardBleedReport::default();
    report.note(175.5, PlayerId(2), None, 1.);
    assert!(report.validate(200., &known).is_ok());
    report.note(200.25, PlayerId(3), None, 2.);
    assert!(report.validate(200.25, &known).is_ok());
    // Provenance of the victim and the optional source.
    let mut report = CardBleedReport::default();
    report.note(100., PlayerId(9), None, 1.);
    assert!(report.validate(100., &known).is_err());
    let mut report = CardBleedReport::default();
    report.note(100., PlayerId(2), Some(PlayerId(9)), 1.);
    assert!(report.validate(100., &known).is_err());
    // Unique complete raw pairs even if the derived index were bypassed.
    let mut report = CardBleedReport::default();
    report.note(100., PlayerId(2), Some(PlayerId(1)), 1.);
    report.rows.push(report.rows[0]);
    assert!(report.validate(100., &known).is_err());
    // A well-formed report validates and can rebuild its index.
    let mut report = CardBleedReport::default();
    report.note(150., PlayerId(2), Some(PlayerId(1)), 1.);
    report.note(150., PlayerId(3), None, 2.);
    report.index.reset();
    assert!(report.validate(200., &known).is_ok());
    assert!(report.rebuild_index().is_ok());
    assert_eq!(report.index.find(PlayerId(3), None), Some(1));
}

// ---------------------------------------------------------------------------------------------------------------
// Strict canonical intake through both stored paths: the trusted World report and serialized pending raw rows.
// ---------------------------------------------------------------------------------------------------------------

/// JSON navigation that accepts a numeric array index as a path segment.
fn navigate<'a>(slot: &'a mut serde_json::Value, key: &str) -> &'a mut serde_json::Value {
    if slot.is_array() {
        &mut slot[key.parse::<usize>().unwrap()]
    } else {
        &mut slot[key]
    }
}

fn checkpoint_sim() -> Sim {
    let ps = [
        crate::Placement {
            profile: "a".into(),
            faction: crate::FactionId::Holy,
            bot: false,
            at: crate::Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        crate::Placement {
            profile: "b".into(),
            faction: crate::FactionId::Fire,
            bot: false,
            at: crate::Vec2::new(456., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    Sim::reset_active(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(7),
        &ps,
    )
}

fn checkpoint_json(sim: &Sim) -> serde_json::Value {
    serde_json::to_value(sim).expect("checkpoint json")
}

#[test]
fn valid_trusted_report_and_pending_raw_rows_restore_with_exact_bits_and_a_rebuilt_index() {
    let mut sim = checkpoint_sim();
    let now = sim.server_time();
    sim.w
        .card_bleed
        .note(now, PlayerId(2), Some(PlayerId(1)), 1.5);
    sim.w.card_bleed.note(
        now,
        PlayerId(1),
        None,
        f64::from_bits(0x8000_0000_0000_0000),
    );
    sim.w.card_bleed.rows[1].amount = CardBleedAmount::NotANumber;
    sim.w.card_bleed.rows[0].amount = CardBleedAmount::PositiveInfinity;
    sim.w.pending_events.push(Event::CardBleedHit {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        amount: CardBleedAmount::NotANumber,
    });
    let value = checkpoint_json(&sim);
    // Both real decode routes: the typed restore entry point and the plain Deserialize path.
    let restored = crate::Sim::restore(value.clone()).expect("valid checkpoint restores");
    assert_eq!(restored.w.card_bleed, sim.w.card_bleed);
    assert_eq!(restored.w.pending_events, sim.w.pending_events);
    assert_eq!(
        restored
            .w
            .card_bleed
            .index
            .find(PlayerId(2), Some(PlayerId(1))),
        Some(0),
        "cold preparation rebuilds the derived trusted pair index"
    );
    assert_eq!(restored.w.card_bleed.index.find(PlayerId(1), None), Some(1));
    let decoded: Sim = serde_json::from_value(value).expect("the Deserialize route also restores");
    assert_eq!(decoded.w.card_bleed, sim.w.card_bleed);
    // Finite bits, including signed zero and the maximum finite value, survive exactly.
    let mut sim = checkpoint_sim();
    let now = sim.server_time();
    sim.w.card_bleed.note(
        now,
        PlayerId(2),
        Some(PlayerId(1)),
        f64::from_bits(0x8000_0000_0000_0000),
    );
    sim.w.card_bleed.note(
        now,
        PlayerId(1),
        None,
        f64::from_bits(0x7fef_ffff_ffff_ffff),
    );
    let restored = crate::Sim::restore(checkpoint_json(&sim)).unwrap();
    assert_eq!(
        restored.w.card_bleed.rows[0].amount.finite_bits(),
        Some(0x8000_0000_0000_0000)
    );
    assert_eq!(
        restored.w.card_bleed.rows[1].amount.finite_bits(),
        Some(0x7fef_ffff_ffff_ffff)
    );
    // The new World leaf is part of the state hash.
    let mut other = restored.clone();
    other.w.card_bleed.rows[0].amount = CardBleedAmount::Finite(2.5);
    assert_ne!(restored.state_hash(), other.state_hash());
    let mut same = restored.clone();
    same.w.card_bleed.index.reset();
    assert_eq!(
        restored.state_hash(),
        same.state_hash(),
        "the derived index is excluded from the hash"
    );
}

fn refused(value: serde_json::Value) -> String {
    let err = crate::Sim::restore(value).expect_err("malformed checkpoint must refuse");
    err.to_string()
}

#[test]
fn strict_report_intake_rejects_noncanonical_amounts_and_invariant_violations() {
    let mut sim = checkpoint_sim();
    let now = sim.server_time();
    sim.w
        .card_bleed
        .note(now, PlayerId(2), Some(PlayerId(1)), 1.0);
    let good = checkpoint_json(&sim);
    // A valid control: the untouched checkpoint restores.
    crate::Sim::restore(good.clone()).expect("control restores");
    let mutate = |path: &[&str], value: serde_json::Value| {
        let mut v = good.clone();
        let mut slot = &mut v["world"]["card_bleed"];
        for key in &path[..path.len() - 1] {
            slot = navigate(slot, key);
        }
        let last = path[path.len() - 1];
        if slot.is_array() {
            slot[last.parse::<usize>().unwrap()] = value;
        } else {
            slot[last] = value;
        }
        refused(v)
    };
    for amount in [
        serde_json::json!({"Finite": -1.0}),
        serde_json::json!({"Finite": null}),
        serde_json::json!({"Finite": "1"}),
        serde_json::json!({"PositiveInfinity": 1}),
        serde_json::json!({"NotANumber": false}),
        serde_json::json!({"Unknown": 1}),
        serde_json::json!(null),
        serde_json::json!(1.5),
    ] {
        let error = mutate(&["rows", "0", "amount"], amount.clone());
        assert!(
            error.contains("malformed checkpoint"),
            "unexpected refusal for {amount}: {error}"
        );
    }
    // Duplicate complete raw pairs are refused even though the derived index would collapse them.
    let mut duplicate = good.clone();
    let row = duplicate["world"]["card_bleed"]["rows"][0].clone();
    duplicate["world"]["card_bleed"]["rows"]
        .as_array_mut()
        .unwrap()
        .push(row);
    assert!(refused(duplicate).contains("repeat the raw pair"));
    // Rows without a report clock, a future/non-grid clock and unknown provenance are refused.
    let mut rows_without_clock = good.clone();
    rows_without_clock["world"]["card_bleed"]["since"] = serde_json::Value::Null;
    let error = refused(rows_without_clock);
    assert!(error.contains("rows without a report clock"), "{error}");
    let mut future = good.clone();
    future["world"]["card_bleed"]["since"] = serde_json::json!(now + 50.);
    assert!(refused(future).contains("finite prior server time"));
    let mut unknown_victim = good.clone();
    unknown_victim["world"]["card_bleed"]["rows"][0]["victim"] = serde_json::json!(99);
    assert!(refused(unknown_victim).contains("retained actor provenance"));
    let mut unknown_source = good.clone();
    unknown_source["world"]["card_bleed"]["rows"][0]["by"] = serde_json::json!(99);
    assert!(refused(unknown_source).contains("retained actor provenance"));
    // An extra field inside a stored bucket is refused, not ignored.
    let mut extra = good.clone();
    extra["world"]["card_bleed"]["rows"][0]["payload"] = serde_json::json!(1);
    let error = refused(extra);
    assert!(error.contains("malformed checkpoint"), "{error}");
}

#[test]
fn strict_pending_event_intake_rejects_the_same_malformed_domain() {
    let mut sim = checkpoint_sim();
    sim.w.pending_events.push(Event::CardBleedHit {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        amount: CardBleedAmount::Finite(1.0),
    });
    let good = checkpoint_json(&sim);
    crate::Sim::restore(good.clone()).expect("control restores");
    let mutate = |path: &[&str], value: serde_json::Value| {
        let mut v = good.clone();
        // world.pending_events[0] is the CardBleedHit event.
        let mut slot = &mut v["world"]["pending_events"][0]["CardBleedHit"];
        for key in &path[..path.len() - 1] {
            slot = navigate(slot, key);
        }
        let last = path[path.len() - 1];
        if slot.is_array() {
            slot[last.parse::<usize>().unwrap()] = value;
        } else {
            slot[last] = value;
        }
        refused(v)
    };
    for amount in [
        serde_json::json!({"Finite": -2.0}),
        serde_json::json!({"Finite": null}),
        serde_json::json!({"PositiveInfinity": 1.0}),
        serde_json::json!("Finite"),
        serde_json::json!({"NotANumber": false}),
        serde_json::json!({"Other": 1}),
    ] {
        let error = mutate(&["amount"], amount.clone());
        assert!(
            error.contains("malformed checkpoint"),
            "pending-event amount {amount} accepted: {error}"
        );
    }
    // Provenance is validated for the serialized pending path too.
    let error = mutate(&["victim"], serde_json::json!(99));
    assert!(error.contains("retained provenance"), "{error}");
    let error = mutate(&["by"], serde_json::json!(99));
    assert!(error.contains("retained provenance"), "{error}");
    // A finite tag/payload round-trips and a payload-free tag is a valid stored value.
    let mut tagged = good.clone();
    tagged["world"]["pending_events"][0]["CardBleedHit"]["amount"] =
        serde_json::json!("PositiveInfinity");
    let restored = crate::Sim::restore(tagged).expect("payload-free tag restores");
    assert!(matches!(
        restored.w.pending_events[0],
        Event::CardBleedHit {
            amount: CardBleedAmount::PositiveInfinity,
            ..
        }
    ));
}

// ---------------------------------------------------------------------------------------------------------------
// Real scheduled producers: the GateAlways raid-start reset marker and the marker/segment envelope.
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn the_real_gate_always_raid_start_records_one_card_reset_marker() {
    let mut sim = crate::Sim::try_new(
        crate::SimConfig {
            min_players: 2,
            fill_seconds: 0.,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(9),
    )
    .expect("admitted constructor");
    for i in 0..2 {
        sim.add_player(&format!("r{i}"), Some(crate::FactionId::Holy), false)
            .expect("join");
    }
    // The projector observes the real first step: lobby -> active through the actual startRaid producer.
    let viewer = sim.players()[0].id;
    let mut projector = crate::FxProjector::attach(&sim, viewer);
    let events = sim.step();
    assert!(events.iter().any(|e| matches!(e, Event::RaidStarted)));
    let report = sim.fx_report();
    assert!(report.complete);
    let resets = report
        .ops
        .iter()
        .filter(|op| matches!(op, Op::CardReset(_)))
        .count();
    let flushes = report
        .ops
        .iter()
        .filter(|op| matches!(op, Op::CardFlush(_)))
        .count();
    let segments = report
        .ops
        .iter()
        .filter(|op| matches!(op, Op::CardSegment(_)))
        .count();
    assert_eq!((resets, flushes, segments), (1, 0, 0));
    assert!(report.bounded, "one empty CardReset marker stays bounded");
    assert!(
        !sim.w.card_bleed.exists(),
        "the real hook reset the trusted report"
    );
    assert!(sim.w.card_bleed.rows.is_empty());
    assert_eq!(
        projector.feed(report),
        Ok(crate::FeedStatus::Advanced),
        "the settled projector accepts the empty reset marker"
    );
    assert!(projector.events().is_empty());
}

#[test]
fn cold_clone_restore_and_attach_prepare_the_actual_capacity_set() {
    use crate::state::{Packet, PlayerId};
    let mut sim = crate::Sim::reset_active(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(4),
        &[
            crate::Placement {
                profile: "a".into(),
                faction: crate::FactionId::Holy,
                bot: false,
                at: crate::Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            crate::Placement {
                profile: "b".into(),
                faction: crate::FactionId::Fire,
                bot: false,
                at: crate::Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    );
    // A sparse accepted-restore inventory: distinct deferred Dot raw pairs (some anonymous) plus trusted rows.
    let now = sim.server_time();
    for n in 0..24u32 {
        sim.w.deferred.hits.push(crate::systems::ledger::Entry {
            terrain: false,
            dot: true,
            ability: None,
            arena: false,
            source: None,
            critical: false,
            critical_mult: None,
            sig: None,
            execute: false,
            victim: PlayerId(1 + n % 2),
            by: (n % 3 != 0).then_some(PlayerId(1 + (n + 1) % 2)),
            packet: Packet {
                raw: 1.,
                phys: 1.,
                magic: 0.,
                true_: 0.,
            },
            weapon: None,
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        });
    }
    for n in 0..5u32 {
        sim.w.card_bleed.note(
            now,
            PlayerId(1 + n % 2),
            Some(PlayerId(1 + (n + 1) % 2)),
            1. + f64::from(n),
        );
    }
    let capacities = capacities(&sim.k, &sim.w).expect("accepted capacity");
    assert_eq!(capacities.trusted_rows, sim.w.card_bleed.rows.len());
    assert_eq!(capacities.initial_pairs, initial_pairs(&sim.w).len());
    assert!(
        capacities.initial_pairs >= 3,
        "distinct deferred pairs were inventoried"
    );
    // Clone (cold preparation) reserves every domain without changing the state.
    let clone = sim.clone();
    assert_eq!(clone.w.card_bleed, sim.w.card_bleed);
    assert!(clone.w.card_bleed.rows.capacity() >= capacities.q);
    assert!(
        clone.w.card_bleed.index.capacity() >= capacities.q,
        "cold preparation reserves the full Q in the derived trusted index too"
    );
    assert!(clone.s.card_segment.rows.capacity() >= capacities.k);
    assert!(clone.projection.report.card_rows.capacity() >= capacities.k);
    assert_eq!(
        clone
            .w
            .card_bleed
            .index
            .find(PlayerId(1), Some(PlayerId(2))),
        Some(0),
        "clone rebuilds the derived trusted index"
    );
    // Restore prepares the same bounds and keeps the restored rows.
    let restored = crate::Sim::restore(serde_json::to_value(&sim).unwrap()).expect("restore");
    assert_eq!(restored.w.card_bleed, sim.w.card_bleed);
    assert!(restored.w.card_bleed.rows.capacity() >= capacities.q);
    assert!(
        restored.w.card_bleed.index.capacity() >= capacities.q,
        "restore preparation reserves the full Q in the derived trusted index too"
    );
    assert!(restored.s.card_segment.rows.capacity() >= capacities.k);
    assert!(restored.projection.report.card_rows.capacity() >= capacities.k);
    assert_eq!(
        restored
            .w
            .card_bleed
            .index
            .find(PlayerId(1), Some(PlayerId(2))),
        Some(0)
    );
    // A viewer session prepares the derived public bound B.
    let bound = viewer_capacity(&restored.k, &restored.w).unwrap();
    assert_eq!(bound, capacities.b);
    assert!(bound >= 2 * capacities.initial_pairs);
    // Real first/repeated steps keep the trusted hash/gameplay unaffected by projection cadence.
    let hash_before = restored.state_hash();
    let mut a = restored.clone();
    let mut b = restored.clone();
    let mut projector = crate::FxProjector::attach(&b, PlayerId(1));
    a.step();
    b.step();
    projector.feed(b.fx_report()).expect("bounded feed");
    assert_eq!(a.state_hash(), b.state_hash());
    assert_ne!(hash_before, a.state_hash(), "the clock advanced");
}

// ---------------------------------------------------------------------------------------------------------------
// Measured layout evidence (actual Rust type sizes, never the planning allowances).
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn measured_card_type_sizes_and_index_height_are_reported() {
    use std::mem::size_of;
    let sizes = [
        ("CardBleedAmount", size_of::<CardBleedAmount>()),
        ("CardBleedBucket", size_of::<CardBleedBucket>()),
        ("CardBleedReport", size_of::<CardBleedReport>()),
        ("CardExactRow", size_of::<CardExactRow>()),
        ("CardSegment", size_of::<CardSegment>()),
        ("PairIndex", size_of::<PairIndex>()),
        ("PairIndex node", index::node_size()),
        ("fx_report::Op", size_of::<crate::fx_report::Op>()),
        ("Event", size_of::<Event>()),
        ("SeenEvent", size_of::<crate::SeenEvent>()),
        ("FxTickReport", size_of::<crate::fx_report::FxTickReport>()),
        (
            "ExactSum",
            size_of::<crate::fx_projector::exact::ExactSum>(),
        ),
        ("PlayerId", size_of::<PlayerId>()),
    ];
    println!("measured Card layout (bytes):");
    for (name, size) in sizes {
        println!("  {name}: {size}");
    }
    assert!(size_of::<CardBleedAmount>() >= 16, "tag plus f64 payload");
    // Actual measured row: raw victim/source key, 272-byte exact limbs, two local classification bytes and
    // alignment. This is a measurement, not the 328-byte planning allowance.
    assert_eq!(size_of::<CardExactRow>(), 288);
    // The arena index is a compact node, not a heap node per row: measured against the 24-byte planning estimate.
    println!(
        "  PairIndex node measured {} bytes (planning estimate 24)",
        index::node_size()
    );
    assert!(index::node_size() <= 40, "measured node stays compact");
    // A populated player-only world's actual capacities and the planning formula evaluation.
    let sim = crate::Sim::reset_active(
        crate::SimConfig::default(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(2),
        &(0..8)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: crate::FactionId::Holy,
                bot: false,
                at: crate::Vec2::new(200. + 40. * f64::from(i), 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    let c = capacities(&sim.k, &sim.w).unwrap();
    println!(
        "player-only8 capacities: pristine={} V={} P={} A0={} R={} U0={} Q0={} K={} Q={} B={}",
        c.pristine_player_only,
        c.v,
        c.players,
        c.actors,
        c.camp_spots,
        c.initial_pairs,
        c.trusted_rows,
        c.k,
        c.q,
        c.b
    );
    assert_eq!((c.players, c.actors), (8, 8));
    assert_eq!((c.initial_pairs, c.trusted_rows), (0, 0));
    // The proven pristine player-only specialization matches the design's provisional table row exactly.
    assert!(c.pristine_player_only);
    assert_eq!((c.v, c.k, c.q, c.b), (8, 64, 64, 72));
    // A real general (regional PvE) constructor takes the larger safe bound; its actual numbers are reported.
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json"))
            .expect("certified seed1 map");
    let arena = import
        .validate()
        .expect("validated layers")
        .into_arena()
        .expect("arena");
    let general_sim = crate::Sim::reset_active(
        crate::SimConfig {
            abilities: crate::abilities::Mode::Full,
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            initial_loot: true,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        arena,
        crate::Secrets::from_seed(2),
        &(0..8)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: crate::FactionId::Holy,
                bot: false,
                at: crate::Vec2::new(400. + 20. * f64::from(i), 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    );
    let general = capacities(&general_sim.k, &general_sim.w).unwrap();
    println!(
        "general PvE example: pristine={} V={} P={} A0={} R={} U0={} Q0={} K={} Q={} B={}",
        general.pristine_player_only,
        general.v,
        general.players,
        general.actors,
        general.camp_spots,
        general.initial_pairs,
        general.trusted_rows,
        general.k,
        general.q,
        general.b
    );
    assert!(!general.pristine_player_only);
    let expected_v = general.actors + 14 * general.players + 2 * general.camp_spots + 150;
    assert_eq!(general.v, expected_v);
    assert_eq!(
        general.k,
        general.initial_pairs + general.players * general.v
    );
    assert_eq!(
        general.q,
        general.trusted_rows + general.initial_pairs + general.players * general.v
    );
    assert_eq!(
        general.b,
        2 * general.initial_pairs + (general.players + 1) * general.v
    );
    assert!(general.k > c.k && general.q > c.q && general.b > c.b);
    // NON-OVERLAPPING actual-capacity ledger for the generic Full8 state (V=882, K=Q=7056, B=7938, T0=0):
    // each line is one owned live container/type × its actual prepared capacity. The conservative planning
    // allowance N_new is reported separately and is NOT added to this ledger (it already prices K/Q/B containers).
    // Excluded from the ledger: unchanged legacy-fixed reservations, allocator overhead, inherited status/Arc
    // allocations and unrelated world memory; the cfg(test) transparent Card observer is labelled separately.
    let t0 = pending_card_rows(&general_sim.w);
    let history = card_history_envelope(&general_sim.w, general.q).unwrap();
    assert_eq!(history, general.q + t0);
    let report = &general_sim.projection.report;
    // Eight actual viewer sessions (the live seat bound): every ledger line below uses the container's ACTUAL
    // prepared `.capacity()`, summed over the attached sessions where the container is per viewer.
    let viewers: Vec<crate::FxProjector> = general_sim
        .players()
        .iter()
        .map(|p| crate::FxProjector::attach(&general_sim, p.id))
        .collect();
    assert_eq!(viewers.len(), 8);
    let trusted_rows_cap = general_sim.w.card_bleed.rows.capacity();
    let trusted_index_cap = general_sim.w.card_bleed.index.capacity();
    let segment_rows_cap = general_sim.s.card_segment.rows.capacity();
    let segment_index_cap = general_sim.s.card_segment.index.capacity();
    let sealed_rows_cap = report.card_rows.capacity();
    let sealed_events_cap = report.events.capacity();
    let sealed_wish_cap = report.wish_points.capacity();
    let viewer_buckets_cap: usize = viewers
        .iter()
        .map(|viewer| viewer.card_bucket_vec_capacity_for_tests())
        .sum();
    let viewer_index_cap: usize = viewers
        .iter()
        .map(|viewer| viewer.card_capacity_for_tests().1)
        .sum();
    let viewer_events_cap: usize = viewers
        .iter()
        .map(|viewer| viewer.event_capacity_for_tests())
        .sum();
    let card_bucket_size = crate::FxProjector::card_bucket_size_for_tests();
    let node = node_size();
    let ledger: [(&str, usize, usize); 10] = [
        (
            "trusted report rows: Vec<CardBleedBucket> actual capacity",
            trusted_rows_cap,
            size_of::<CardBleedBucket>(),
        ),
        (
            "trusted report derived index: arena node capacity",
            trusted_index_cap,
            node,
        ),
        (
            "producer exact segment rows: Vec<CardExactRow> actual capacity",
            segment_rows_cap,
            size_of::<CardExactRow>(),
        ),
        (
            "producer exact segment derived index: arena node capacity",
            segment_index_cap,
            node,
        ),
        (
            "sealed report Card rows: Vec<CardExactRow> actual capacity",
            sealed_rows_cap,
            size_of::<CardExactRow>(),
        ),
        (
            "sealed report events: Vec<Event> total actual capacity",
            sealed_events_cap,
            size_of::<crate::Event>(),
        ),
        (
            "sealed report wish_points: Vec actual capacity",
            sealed_wish_cap,
            2,
        ),
        (
            "8 viewer Card bucket vectors: summed actual Vec<CardBucket> capacity",
            viewer_buckets_cap,
            card_bucket_size,
        ),
        (
            "8 viewer Card derived indexes: summed arena node capacity",
            viewer_index_cap,
            node,
        ),
        (
            "8 viewer owned outputs: summed actual Vec<SeenEvent> capacity",
            viewer_events_cap,
            size_of::<crate::SeenEvent>(),
        ),
    ];
    let mut ledger_total = 0usize;
    println!(
        "generic Full8 card-owned ACTUAL prepared capacity ledger (non-overlapping; T0={t0}):"
    );
    for (what, count, bytes) in ledger {
        let total = count * bytes;
        ledger_total += total;
        println!("  {what}: capacity={count} bytes/unit={bytes} total={total}");
    }
    println!("  card-owned actual prepared capacity total: {ledger_total} B");
    // Conservative planning allowance only (reported separately, never added to the ledger): the design formula
    // with its 24-byte node / 328-byte row / 320-byte bucket / 256-byte event planning allowances.
    let plan_terms = |k: usize, q: usize, b: usize| {
        let index = |n: usize| 8 * (2 * n).next_power_of_two().max(1) + 8 * n;
        656 * k + 546 * q + 4608 * b + index(k) + index(q) + 8 * index(b)
    };
    let plan = plan_terms(general.k, general.q, general.b);
    println!("  conservative planning allowance N_new: {plan} B (separate; not added)");
    // Unchanged legacy baseline inside the enlarged buffers, separate and not counted as Card-owned.
    let legacy_baseline = crate::fx_report::FX_REPORT_EVENTS_MAX * size_of::<crate::Event>()
        + crate::fx_report::FX_REPORT_EVENTS_MAX * 2
        + viewers
            .iter()
            .map(|_| crate::fx_report::FX_OUTPUT_EVENTS_MAX * size_of::<crate::SeenEvent>())
            .sum::<usize>();
    println!(
        "  unchanged legacy baseline inside the enlarged buffers (separate): {legacy_baseline} B"
    );
    // Excluded and separately labelled: the cfg(test) transparent Card observer buffers on the 8 sessions.
    let observer: usize = viewers
        .iter()
        .map(|viewer| viewer.card_outputs_capacity_for_tests() * size_of::<crate::SeenEvent>())
        .sum();
    println!("  test-only transparent Card observer buffers (excluded from ledger): {observer} B");
    println!(
        "  actual prepared caps: report.events={} wish={} card_event_limit={} card_rows={} segment_rows={} segment_index={} trusted_rows={} trusted_index={} viewer_event_cap={} viewer_bucket_cap={} viewer_index_cap={} viewer_card_limit={}",
        report.events.capacity(),
        report.wish_points.capacity(),
        report.card_event_limit,
        report.card_rows.capacity(),
        general_sim.s.card_segment.rows.capacity(),
        general_sim.s.card_segment.index.capacity(),
        general_sim.w.card_bleed.rows.capacity(),
        general_sim.w.card_bleed.index.capacity(),
        viewer_events_cap,
        viewer_buckets_cap,
        viewer_index_cap,
        viewers[0].card_capacity_for_tests().0,
    );
    assert_eq!(report.card_event_limit, history);
    assert!(report.events.capacity() >= crate::fx_report::FX_REPORT_EVENTS_MAX + history);
    assert!(report.wish_points.capacity() >= crate::fx_report::FX_REPORT_EVENTS_MAX + history);
    assert!(general_sim.w.card_bleed.rows.capacity() >= general.q);
    assert!(general_sim.w.card_bleed.index.capacity() >= general.q);
    assert!(general_sim.s.card_segment.rows.capacity() >= general.k);
    assert!(general_sim.s.card_segment.index.capacity() >= general.k);
    for viewer in &viewers {
        assert!(
            viewer.event_capacity_for_tests() >= crate::fx_report::FX_OUTPUT_EVENTS_MAX + general.b
        );
        assert_eq!(viewer.card_capacity_for_tests().0, general.b);
        assert!(viewer.card_capacity_for_tests().1 >= general.b);
        assert!(viewer.card_bucket_vec_capacity_for_tests() >= general.b);
    }
    assert!(ledger_total > 0);
    assert!(general.b > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    // Every prepared domain retains at least its computed bound on a cold constructor.
    assert!(sim.w.card_bleed.rows.capacity() >= c.q);
    assert!(sim.s.card_segment.rows.capacity() >= c.k);
    assert!(sim.projection.report.card_rows.capacity() >= c.k);
}

// ---------------------------------------------------------------------------------------------------------------
// Accepted fractional producer clock (lifecycle-off baseline): the report clock records world.server_time, so a
// producer-earned fractional `since` must restore and continue; no tick<->clock equality is imposed or assumed.
// ---------------------------------------------------------------------------------------------------------------

#[test]
fn an_accepted_fractional_clock_records_a_real_card_report_and_restores_continuation() {
    use crate::state::Packet;
    // A real active two-player world, moved onto an accepted fractional baseline clock through its own checkpoint
    // (the generic finite/prior-clock invariant only; accepted lifecycle-off worlds may carry fractional epochs).
    let mut sim = checkpoint_sim();
    let mut value = checkpoint_json(&sim);
    value["world"]["server_time"] = serde_json::json!(1284.5);
    sim = crate::Sim::restore(value).expect("accepted fractional baseline clock restores");
    assert_eq!(sim.server_time(), 1284.5);
    // A real deferred Dot entry opens the next ledger: the actual producer records the report clock from the
    // fractional settled step time, not from an assumed tick grid.
    sim.w.deferred.hits.push(crate::systems::ledger::Entry {
        terrain: false,
        dot: true,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        packet: Packet {
            raw: 2.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: None,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: true,
        passive: false,
    });
    let mut projector = crate::FxProjector::attach(&sim, PlayerId(1));
    let _events = sim.step();
    let landed_amount = sim
        .s
        .landed
        .iter()
        .find(|hit| hit.dot && hit.ability.is_none() && hit.sig.is_none())
        .expect("the deferred Dot landed")
        .amount;
    assert_eq!(sim.server_time(), 1334.5);
    assert_eq!(
        sim.w.card_bleed.since,
        Some(1334.5),
        "the producer records the accepted fractional step clock"
    );
    assert_eq!(
        sim.w.card_bleed.rows,
        vec![CardBleedBucket {
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            amount: CardBleedAmount::from_landed(landed_amount),
        }]
    );
    projector
        .feed(sim.fx_report())
        .expect("the settled report projects");
    assert!(projector.card_outputs().is_empty());
    // The producer-earned fractional-clock state is an accepted checkpoint and continues identically.
    let restored = crate::Sim::restore(serde_json::to_value(&sim).unwrap())
        .expect("a producer-earned fractional Card report restores");
    assert_eq!(restored.w.card_bleed.since, Some(1334.5));
    assert_eq!(restored.w.card_bleed, sim.w.card_bleed);
    assert_eq!(
        restored
            .w
            .card_bleed
            .index
            .find(PlayerId(2), Some(PlayerId(1))),
        Some(0)
    );
    // Ordinary 50 ms steps reach exactly the source 500 ms boundary from the fractional clock, and the real
    // periodic link flushes the trusted row.
    let mut restored = restored;
    let mut projector = crate::FxProjector::attach(&restored, PlayerId(1));
    let mut flush_events = Vec::new();
    let mut flush_tick = 0;
    for _ in 0..10 {
        let events = restored.step();
        projector
            .feed(restored.fx_report())
            .expect("bounded periodic feed");
        if events
            .iter()
            .any(|e| matches!(e, Event::CardBleedHit { .. }))
        {
            flush_events = events;
            flush_tick = restored.tick();
        }
    }
    assert_eq!(restored.server_time(), 1834.5);
    assert_eq!(restored.w.card_bleed.since, Some(1834.5));
    assert_eq!(
        flush_tick,
        restored.tick(),
        "the flush is the 500 ms boundary"
    );
    let raw: Vec<_> = flush_events
        .iter()
        .filter_map(|e| match e {
            Event::CardBleedHit { victim, by, amount } => Some((*victim, *by, *amount)),
            _ => None,
        })
        .collect();
    assert_eq!(
        raw,
        vec![(
            PlayerId(2),
            Some(PlayerId(1)),
            CardBleedAmount::from_landed(landed_amount)
        )]
    );
    // A projector attached after the producer's window began grants no historical entitlement: the trusted row
    // and its source clock restore and flush, but this fresh session emits no public Card row for it (the
    // approved reconnect contract, not a source-parity claim).
    assert!(
        projector.card_outputs().is_empty() && projector.events().is_empty(),
        "Q0 historical pending rows confer no fresh projector entitlement"
    );
    // A viewer attached before the same fractional producer records the actual settled public row at the 500 ms
    // boundary.
    let fresh = checkpoint_sim();
    let mut value = checkpoint_json(&fresh);
    value["world"]["server_time"] = serde_json::json!(1284.5);
    let mut fresh =
        crate::Sim::restore(value).expect("accepted fractional baseline clock restores");
    fresh.w.deferred.hits.push(crate::systems::ledger::Entry {
        terrain: false,
        dot: true,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        packet: Packet {
            raw: 2.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: None,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: true,
        passive: false,
    });
    let mut live = crate::FxProjector::attach(&fresh, PlayerId(1));
    let mut landed = 0.;
    // The producer's first-use clock starts on the step after attach; the 500 ms boundary is 11 fixed steps later.
    for _ in 0..11 {
        let events = fresh.step();
        live.feed(fresh.fx_report()).expect("bounded live feed");
        if let Some(hit) = fresh
            .s
            .landed
            .iter()
            .find(|hit| hit.dot && hit.ability.is_none() && hit.sig.is_none())
        {
            landed = hit.amount;
        }
        let _ = events;
    }
    assert!(landed > 0., "the deferred Dot landed on the ordinary path");
    assert_eq!(
        live.card_outputs(),
        &[crate::SeenEvent::Hit {
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            amount: landed,
            passive: false,
        }]
    );
}

// ---------------------------------------------------------------------------------------------------------------
// First-unseen-pair and repeated-window allocation witness (run alone: the dhat profiler is process-global), plus
// growth to the full prepared bounds.
// ---------------------------------------------------------------------------------------------------------------

#[test]
#[ignore = "allocation profiler must run alone: cargo test -p rh-sim --lib card_bleed_alloc -- --ignored --test-threads=1"]
fn card_bleed_alloc() {
    let directory = std::env::var_os("RH_CARD_ALLOC_DIRECTORY")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let profiler = dhat::Profiler::builder()
        .file_name(directory.join("rh-card-bleed-alloc.json"))
        .build();
    // Real producers: three players, two Hemorrhage sword attackers and one victim; no other mechanic spawns.
    let ps = [
        (crate::FactionId::Holy, 400., true),
        (crate::FactionId::Fire, 432., false),
        (crate::FactionId::Holy, 464., true),
    ];
    let mut sim = crate::Sim::try_new(
        crate::SimConfig {
            abilities: crate::abilities::Mode::Full,
            wish_lock_ms: 0.,
            min_players: 3,
            fill_seconds: 0.,
            lobby_seconds: 30.,
            quests: false,
            consumables: false,
            walk_hints: Some(false),
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(11),
    )
    .expect("admitted constructor");
    let allocations = |before: u64| dhat::HeapStats::get().total_blocks - before;
    for (i, (faction, _, _)) in ps.iter().enumerate() {
        sim.add_player(&format!("a{i}"), Some(*faction), false)
            .unwrap();
    }
    // The normal lobby/start transition places the seats at the arena spawns; the declared rig positions then
    // override them, exactly as the captured source setup does.
    sim.step();
    let now = sim.server_time();
    for (i, (_, x, _)) in ps.iter().enumerate() {
        let Some(p) = sim.w.players.get_mut(PlayerId(i as u32 + 1)) else {
            panic!("player")
        };
        p.body.x = *x;
        p.body.y = 400.;
        p.weapon.weapon0 = Some(crate::WeaponId::Sword);
        p.body.history.reset(crate::state::Sample {
            t: now,
            x: *x,
            y: 400.,
        });
    }
    for i in [0usize, 2] {
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(i as u32 + 1),
            crate::cards::CardId::Hemorrhage
        ));
    }
    let mut projectors: Vec<_> = sim
        .players()
        .iter()
        .map(|p| crate::FxProjector::attach(&sim, p.id))
        .collect();
    // Cold construct/clone/restore/rebind allocation counts (report the actual numbers; cold preparation is once).
    let before_construct = dhat::HeapStats::get().total_blocks;
    let cold = crate::Sim::try_new(
        sim.k.config.clone(),
        crate::arenas::practice_arena(),
        crate::Secrets::from_seed(11),
    )
    .expect("cold construct");
    let construct_blocks = allocations(before_construct);
    let before_clone = dhat::HeapStats::get().total_blocks;
    let clone = sim.clone();
    let clone_blocks = allocations(before_clone);
    let before_restore = dhat::HeapStats::get().total_blocks;
    let restored = crate::Sim::restore(serde_json::to_value(&sim).unwrap()).expect("restore");
    let restore_blocks = allocations(before_restore);
    let before_rebind = dhat::HeapStats::get().total_blocks;
    projectors[0].rebind(&sim, PlayerId(1));
    let rebind_blocks = allocations(before_rebind);
    eprintln!(
        "card cold allocations (blocks): construct={construct_blocks} clone={clone_blocks} restore={restore_blocks} rebind={rebind_blocks}; cold sims constructed {} {} {}",
        cold.tick(),
        clone.tick(),
        restored.tick()
    );
    // First contribution: p0 locks p1 and swings. The status application step is an inherited producer allocation
    // (the `bleed:{tick}` Arc tag); the first eligible landed DoT step must allocate nothing for the Card domains.
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    let mut out = Vec::with_capacity(512);
    let (mut first_pair_step, mut first_pair_allocs) = (0u32, 0u64);
    let mut released = false;
    for n in 0..40 {
        if n == 3 && !released {
            // Release the held trigger: auto-attacks only refresh the inherited `bleed:{tick}` status tag (an
            // inherited Arc allocation, not a Card report allocation), and must not pollute the witness.
            sim.submit(
                PlayerId(1),
                validate(RawCommand::Release { a: 0., t: None }).unwrap(),
            )
            .unwrap();
            released = true;
        }
        out.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        for projector in &mut projectors {
            projector.feed(sim.fx_report()).expect("bounded feed");
        }
        let used = allocations(before);
        let inherited_status_apply = out.iter().any(|e| matches!(e, Event::StatusApplied { .. }));
        let grew = !sim.w.card_bleed.rows.is_empty();
        if grew && !inherited_status_apply && first_pair_step == 0 {
            first_pair_step = sim.tick();
            first_pair_allocs = used;
        }
    }
    let rows_after_first = sim.w.card_bleed.rows.len();
    assert!(
        first_pair_step > 0,
        "the first eligible Card pair was created"
    );
    assert!(
        rows_after_first >= 1,
        "the repeated pair(s) folded into trusted rows"
    );
    // A second, genuinely unseen raw pair arrives after preparation from a different real source: p2 swings at the
    // same victim. Only the inherited status-application step may allocate; the first Card step for the new pair
    // must not grow any prepared Card container.
    sim.submit(
        PlayerId(3),
        validate(RawCommand::Attack {
            a: std::f64::consts::PI,
            t: None,
        })
        .unwrap(),
    )
    .unwrap();
    // Track pair identity, not the current row count: a populated periodic flush can clear the trusted rows in
    // the very step that first records a new raw pair, so the new pair is seen from its raw event as well.
    let mut known_pairs: std::collections::BTreeSet<(PlayerId, Option<PlayerId>)> = sim
        .w
        .card_bleed
        .rows
        .iter()
        .map(|r| (r.victim, r.by))
        .collect();
    let (mut second_pair_step, mut second_pair_allocs) = (0u32, 0u64);
    let mut released_two = false;
    for n in 0..40 {
        if n == 3 && !released_two {
            sim.submit(
                PlayerId(3),
                validate(RawCommand::Release { a: 0., t: None }).unwrap(),
            )
            .unwrap();
            released_two = true;
        }
        out.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        for projector in &mut projectors {
            projector.feed(sim.fx_report()).expect("bounded feed");
        }
        let used = allocations(before);
        let inherited_status_apply = out.iter().any(|e| matches!(e, Event::StatusApplied { .. }));
        let mut new_pair = false;
        for row in &sim.w.card_bleed.rows {
            new_pair |= known_pairs.insert((row.victim, row.by));
        }
        for event in &out {
            if let Event::CardBleedHit { victim, by, .. } = event {
                new_pair |= known_pairs.insert((*victim, *by));
            }
        }
        if new_pair && !inherited_status_apply && second_pair_step == 0 {
            second_pair_step = sim.tick();
            second_pair_allocs = used;
        }
    }
    assert!(
        second_pair_step > 0,
        "the second unseen raw pair was recorded by the real producer"
    );
    assert!(
        first_pair_allocs == 0,
        "first unseen pair after preparation allocated {first_pair_allocs} blocks at tick {first_pair_step}"
    );
    assert!(
        second_pair_allocs == 0,
        "second unseen pair after preparation allocated {second_pair_allocs} blocks at tick {second_pair_step}"
    );
    // Growth to the full prepared bounds: the derived domains accept their whole prepared capacity without one
    // heap allocation, and their capacity does not move. The cold constructor prepared the pristine
    // player-only bound (P*V = 64 derived pairs per sidecar; the report's Q is Q0+U0+P*V with the cold-state
    // Q0=U0=0), so that is the exact prepared capacity to fill here.
    let report_capacity = sim.w.card_bleed.rows.capacity();
    let index_capacity = sim.w.card_bleed.index.capacity();
    let segment_capacity = sim.s.card_segment.rows.capacity();
    assert!(
        report_capacity >= 64,
        "cold-prepared Q bound {report_capacity}"
    );
    assert!(index_capacity >= report_capacity);
    assert!(
        segment_capacity >= 64,
        "cold-prepared K bound {segment_capacity}"
    );
    // Fill a prepared clone to the full bounds: no container reallocates and capacity does not move.
    let mut full = sim.clone();
    let full_capacity = full.w.card_bleed.rows.capacity();
    assert!(
        full_capacity >= report_capacity,
        "clone cold preparation keeps at least the original Q"
    );
    let full_segment_capacity = full.s.card_segment.rows.capacity();
    assert!(full_segment_capacity >= segment_capacity);
    // Growth to the bounded capacity itself is allocation-free: every new raw pair fills the cold-prepared row
    // vector and arena index without one reallocating heap block, and capacities do not move.
    let before = dhat::HeapStats::get().total_blocks;
    let mut n = 0u32;
    while full.w.card_bleed.rows.len() < full_capacity {
        full.w
            .card_bleed
            .note(full.server_time(), PlayerId(200 + n), Some(PlayerId(1)), 1.);
        n += 1;
    }
    let mut m = 0u32;
    while full.s.card_segment.rows.len() < full_segment_capacity {
        let victim = PlayerId(300 + m);
        if matches!(
            full.s.card_segment.index.insert(victim, None, m),
            Inserted::New
        ) {
            full.s.card_segment.rows.push(CardExactRow {
                victim,
                by: None,
                sum: crate::fx_projector::exact::ExactSum::default(),
                invalid: false,
                overflow: false,
            });
        }
        m += 1;
    }
    let bounded_blocks = allocations(before);
    assert_eq!(
        bounded_blocks, 0,
        "growth to the cold-prepared bounds allocated {bounded_blocks} blocks"
    );
    assert_eq!(full.w.card_bleed.rows.capacity(), full_capacity);
    assert!(full.w.card_bleed.index.capacity() >= full_capacity);
    assert_eq!(full.s.card_segment.rows.capacity(), full_segment_capacity);
    // Past the prepared bound the trusted aggregation stays lossless (it grows rather than dropping a row); this
    // is the documented safety valve, not the steady-state claim.
    let before = dhat::HeapStats::get().total_blocks;
    full.w
        .card_bleed
        .note(full.server_time(), PlayerId(500), Some(PlayerId(1)), 1.);
    let past_bound = allocations(before);
    assert_eq!(full.w.card_bleed.rows.len(), full_capacity + 1);
    eprintln!("card past-prepared-bound growth blocks: {past_bound}");
    // Repeated warm steps with live dots and periodic flush markers allocate nothing.
    let mut repeated = 0u32;
    let mut repeated_allocs = 0u64;
    for _ in 0..20 {
        out.clear();
        #[cfg(feature = "schedule-trace")]
        sim.clear_schedule_trace();
        let before = dhat::HeapStats::get().total_blocks;
        sim.step_into(&mut out);
        for projector in &mut projectors {
            projector.feed(sim.fx_report()).expect("bounded feed");
        }
        let used = allocations(before);
        if used > 0 {
            eprintln!(
                "DEBUG rep tick {} used {} out {} rows {} statuses {}",
                sim.tick(),
                used,
                out.len(),
                sim.w.card_bleed.rows.len(),
                out.iter()
                    .filter(|e| matches!(e, Event::StatusApplied { .. }))
                    .count()
            );
        }
        if !out.iter().any(|e| matches!(e, Event::StatusApplied { .. })) {
            repeated += 1;
            repeated_allocs += used;
        }
    }
    assert!(repeated > 0);
    assert_eq!(repeated_allocs, 0, "repeated Card steps allocated");
    eprintln!(
        "card allocation witness: first_pair tick {first_pair_step} allocs {first_pair_allocs}, second_pair tick {second_pair_step} allocs {second_pair_allocs}, repeated {repeated} steps allocs {repeated_allocs}, prepared Q={} index={} K={}",
        report_capacity,
        index_capacity,
        segment_capacity
    );
    drop(profiler);
}

// ---------------------------------------------------------------------------------------------------------------
// Strict canonical B3 wire aliases: the externally tagged map with a null payload for a special tag, and raw
// duplicate discriminants, must be refused through BOTH stored paths (World report and pending raw events).
// ---------------------------------------------------------------------------------------------------------------

fn restore_text(text: &str) -> Result<Sim, crate::CheckpointError> {
    Sim::restore(&mut serde_json::Deserializer::from_str(text))
}

fn report_checkpoint_text() -> String {
    let mut sim = checkpoint_sim();
    let now = sim.server_time();
    sim.w
        .card_bleed
        .note(now, PlayerId(2), Some(PlayerId(1)), 1.0);
    serde_json::to_string(&sim).unwrap()
}

fn pending_checkpoint_text() -> String {
    let mut sim = checkpoint_sim();
    sim.w.pending_events.push(Event::CardBleedHit {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        amount: CardBleedAmount::Finite(1.0),
    });
    serde_json::to_string(&sim).unwrap()
}

#[test]
fn canonical_b3_map_aliases_and_duplicate_keys_are_refused_through_both_stored_paths() {
    // Controls: canonical forms restore through the real decoder.
    restore_text(&report_checkpoint_text()).expect("canonical Finite report restores");
    restore_text(&pending_checkpoint_text()).expect("canonical Finite pending row restores");
    for (name, text) in [
        ("report", report_checkpoint_text()),
        ("pending_events", pending_checkpoint_text()),
    ] {
        let canonical = "\"amount\":{\"Finite\":1.0}";
        assert!(
            text.contains(canonical),
            "{name}: expected canonical amount once"
        );
        for (payload, label) in [
            (
                "\"amount\":{\"PositiveInfinity\":null}",
                "map-null positive infinity",
            ),
            ("\"amount\":{\"NotANumber\":null}", "map-null not-a-number"),
            (
                "\"amount\":{\"Finite\":1.0,\"Finite\":2.0}",
                "duplicate Finite",
            ),
            (
                "\"amount\":{\"PositiveInfinity\":null,\"NotANumber\":null}",
                "duplicate special tags",
            ),
        ] {
            let mutated = text.replacen(canonical, payload, 1);
            assert!(mutated != text, "{name}: mutation applied");
            assert!(
                restore_text(&mutated).is_err(),
                "{name}: accepted {label} alias {payload}"
            );
        }
        // Canonical payload-free special tags remain accepted through both paths.
        for tag in ["\"PositiveInfinity\"", "\"NotANumber\""] {
            let mutated = text.replacen(canonical, &format!("\"amount\":{tag}"), 1);
            restore_text(&mutated)
                .unwrap_or_else(|e| panic!("{name}: canonical special tag {tag} refused: {e}"));
        }
    }
}

#[test]
fn synthetic_carry_failure_state_keeps_a_later_source_invalid_classification_local() {
    // Synthetic carry-failure-state control only: the exact limb domain (34 limbs / 78 carry bits) exceeds any
    // ordinary usize-addressable per-tick finite contribution count, so an actual accumulation overflow is not a
    // reproduced reachable gameplay bug here. This pins the classifier's defensive ordering contract.
    let victim = PlayerId(2);
    let by = Some(PlayerId(1));
    // Ordering 1: checked overflow first, then a source-invalid amount for the same raw pair.
    let mut segment = CardSegment::default();
    segment.prepare(4).unwrap();
    segment.rows.push(CardExactRow {
        victim,
        by,
        sum: crate::fx_projector::exact::ExactSum::default(),
        invalid: false,
        overflow: true,
    });
    segment.index.insert(victim, by, 0);
    segment.note(victim, by, f64::NAN);
    assert!(segment.rows[0].overflow && segment.rows[0].invalid);
    segment.note(victim, by, -1.0);
    assert!(segment.rows[0].invalid);
    // A finite amount after the overflow is not classified invalid and skips arithmetic.
    let mut segment = CardSegment::default();
    segment.prepare(4).unwrap();
    segment.rows.push(CardExactRow {
        victim,
        by,
        sum: crate::fx_projector::exact::ExactSum::default(),
        invalid: false,
        overflow: true,
    });
    segment.index.insert(victim, by, 0);
    segment.note(victim, by, 1.0);
    assert!(!segment.rows[0].invalid && segment.rows[0].overflow);
    // Ordering 2: invalid first, then an overflowing finite amount: the invalid classification stays and no exact
    // arithmetic is attempted for the bad pair.
    let mut segment = CardSegment::default();
    segment.prepare(4).unwrap();
    segment.note(victim, by, f64::INFINITY);
    assert!(segment.rows[0].invalid && !segment.rows[0].overflow);
    segment.note(victim, by, f64::MAX);
    assert!(segment.rows[0].invalid);
}

#[test]
fn eligible_bucket_with_both_local_classifications_fails_with_invalid_amount() {
    let s = checkpoint_sim();
    let tick = s.tick() + 1;
    let mut projector = crate::FxProjector::attach(&s, PlayerId(1));
    let mut both = CardExactRow {
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        sum: crate::fx_projector::exact::ExactSum::default(),
        invalid: true,
        overflow: true,
    };
    both.sum.add(1.0).unwrap();
    let report = {
        let mut report = crate::fx_report::FxTickReport::empty(s.projection.identity.clone());
        report.complete = true;
        report.tick = tick;
        report.bounded = true;
        report.viewers = vec![PlayerId(1), PlayerId(2)];
        report.seen = vec![0b11, 0b11];
        report.ops = vec![
            crate::fx_report::Op::CardSegment(0),
            crate::fx_report::Op::CardFlush(0),
        ];
        report.card_rows = vec![both];
        report
    };
    assert_eq!(projector.feed(&report), Err(crate::FxError::InvalidAmount));
    assert!(projector.events().is_empty());
}

// ---------------------------------------------------------------------------------------------------------------
// Private Card history envelope: an accepted restored baseline with more than 512 retained historical rows must
// flush and serve a fresh viewer; the legacy non-Card 512 bound stays, and the internal buffers are cold-prepared.
// ---------------------------------------------------------------------------------------------------------------

/// The real regional-PvE Full8 constructor on the certified seed-1 map (204 camp spots, 204 spawned mobs).
fn regional_eight() -> Sim {
    let import: crate::mapdata::MapExport =
        serde_json::from_str(include_str!("../../mapdata/fixtures/seed1.map.json"))
            .expect("certified seed1 map");
    let arena = import
        .validate()
        .expect("validated layers")
        .into_arena()
        .expect("arena");
    crate::Sim::reset_active(
        crate::SimConfig {
            abilities: crate::abilities::Mode::Full,
            faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            initial_loot: true,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        arena,
        crate::Secrets::from_seed(2),
        &(0..8)
            .map(|i| crate::Placement {
                profile: format!("p{i}"),
                faction: crate::FactionId::Holy,
                bot: false,
                at: crate::Vec2::new(400. + 20. * f64::from(i), 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}

/// Build a real accepted restored baseline whose trusted report already contains `rows` unique historical raw
/// pairs with retained actor provenance, a due interval clock and no fresh contributions on the next step.
fn restored_historical_card_baseline(rows: usize) -> Sim {
    let mut sim = regional_eight();
    // Ordinary steps move the clock past the 500 ms interval so a prior `since` is an accepted prior time.
    for _ in 0..10 {
        sim.step();
    }
    let now = sim.server_time();
    let players: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    let mobs: Vec<PlayerId> = sim.mobs().iter().map(|m| m.core.id).collect();
    assert!(
        mobs.len() >= 204,
        "regional Full8 constructor spawned its mobs"
    );
    // `since` is set by the first note; pass the due interval start (>= 500 ms before now) and then record the
    // historical rows through the same trusted note API the producer uses. Test setup of an accepted state, not a
    // producer answer: the state is serialized and restored through the real strict checkpoint audit below.
    sim.w
        .card_bleed
        .note(now - 500., mobs[0], Some(players[0]), 1.);
    let mut made = 1usize;
    'outer: for mob in &mobs {
        for player in &players {
            if made == rows {
                break 'outer;
            }
            if *mob == mobs[0] && *player == players[0] {
                continue;
            }
            sim.w.card_bleed.note(now - 500., *mob, Some(*player), 1.);
            made += 1;
        }
    }
    assert_eq!(sim.w.card_bleed.rows.len(), rows);
    // The accepted cut: serialize and restore through the real strict decode + cold preparation.
    let restored = crate::Sim::restore(serde_json::to_value(&sim).unwrap())
        .expect("accepted >512 historical Card baseline restores");
    assert_eq!(restored.w.card_bleed.rows.len(), rows);
    assert_eq!(restored.w.card_bleed.since, Some(now - 500.));
    let c = capacities(&restored.k, &restored.w).unwrap();
    let history = card_history_envelope(&restored.w, c.q).unwrap();
    println!(
        "historical baseline: rows={rows} Q={} T0={} raw-history-envelope={history} sealed events cap={} wish cap={} projector capacity={}",
        c.q,
        pending_card_rows(&restored.w),
        restored.projection.report.events.capacity(),
        restored.projection.report.wish_points.capacity(),
        crate::FxProjector::attach(&restored, PlayerId(1)).event_capacity_for_tests(),
    );
    // The internal sealed report buffers are cold-prepared for the legacy bound plus the private Card history
    // envelope, and the projector owned output for the legacy output bound plus the viewer Card bound.
    assert!(c.q > crate::fx_report::FX_REPORT_EVENTS_MAX);
    assert!(history > crate::fx_report::FX_REPORT_EVENTS_MAX);
    assert!(
        restored.projection.report.events.capacity()
            >= crate::fx_report::FX_REPORT_EVENTS_MAX + history
    );
    assert!(
        restored.projection.report.wish_points.capacity()
            >= crate::fx_report::FX_REPORT_EVENTS_MAX + history
    );
    assert_eq!(restored.projection.report.card_event_limit, history);
    let viewer = crate::FxProjector::attach(&restored, PlayerId(1));
    assert!(
        viewer.event_capacity_for_tests() >= crate::fx_report::FX_OUTPUT_EVENTS_MAX + c.b,
        "projector owned output covers legacy + B"
    );
    restored
}

#[test]
fn a_restored_historical_card_report_over_the_legacy_event_cap_flushes_without_refusing_a_fresh_viewer(
) {
    let rows = 600;
    let mut sim = restored_historical_card_baseline(rows);
    let viewer = sim.players()[0].id;
    let mut projector = crate::FxProjector::attach(&sim, viewer);
    // One ordinary step at the due interval: the real periodic link flushes the historical rows, with no new Card
    // contribution of this tick.
    let events = sim.step();
    let raw = events
        .iter()
        .filter(|event| matches!(event, Event::CardBleedHit { .. }))
        .count();
    assert_eq!(
        raw, rows,
        "the due flush emitted every historical trusted row"
    );
    assert_eq!(sim.w.card_bleed.since, Some(sim.server_time()));
    let report = sim.fx_report();
    assert!(report.complete);
    // The freshly attached viewer has no historical entitlement: the feed succeeds with zero Card public rows.
    let fed = projector.feed(report);
    assert_eq!(
        fed,
        Ok(crate::FeedStatus::Advanced),
        "a valid >512 historical flush must not refuse a fresh viewer with UnsupportedBounds"
    );
    assert!(
        report.bounded,
        "private Card history rows are bounded by Q + T0, not the legacy non-Card 512 cap"
    );
    assert!(projector.events().is_empty());
    assert!(projector.card_outputs().is_empty());
}

#[test]
fn serialized_pending_card_history_extends_the_prepared_boundary() {
    // A valid accepted cut with serialized pending Card raw rows (T0) that exceed BOTH the legacy 512 non-Card
    // event bound and the prepared trusted pending-row bound `Q`. The pristine two-player world has `Q = 64`, so
    // 600 pending raw Card rows exercise the independent `Q + T0` envelope: clone and the real strict restore
    // prepare it, `step_into` appends the pending rows before its work, the step stays bounded, and a fresh viewer
    // (zero historical entitlement) feeds Advanced with zero Card output.
    let mut sim = checkpoint_sim();
    let t0 = 600usize;
    for n in 0..t0 {
        sim.w.pending_events.push(Event::CardBleedHit {
            victim: PlayerId(1 + (n % 2) as u32),
            by: (n % 3 != 0).then_some(PlayerId(1 + ((n + 1) % 2) as u32)),
            amount: if n == t0 - 1 {
                CardBleedAmount::NotANumber
            } else {
                CardBleedAmount::Finite(1.)
            },
        });
    }
    assert_eq!(pending_card_rows(&sim.w), t0);
    let c = capacities(&sim.k, &sim.w).unwrap();
    assert!(t0 > crate::fx_report::FX_REPORT_EVENTS_MAX);
    assert!(
        t0 > c.q,
        "pending history exceeds the prepared trusted pending-row bound"
    );
    let history = card_history_envelope(&sim.w, c.q).unwrap();
    assert_eq!(history, c.q + t0);
    // Real clone cold preparation.
    let clone = sim.clone();
    assert_eq!(clone.w.card_bleed, sim.w.card_bleed);
    let clone_c = capacities(&clone.k, &clone.w).unwrap();
    assert_eq!(clone_c.q, c.q);
    assert_eq!(pending_card_rows(&clone.w), t0);
    assert_eq!(
        clone.projection.report.card_event_limit,
        clone_c.q + t0,
        "clone prepares the Q + T0 raw-history envelope"
    );
    assert!(
        clone.projection.report.events.capacity()
            >= crate::fx_report::FX_REPORT_EVENTS_MAX + clone_c.q + t0
    );
    assert!(
        clone.projection.report.wish_points.capacity()
            >= crate::fx_report::FX_REPORT_EVENTS_MAX + clone_c.q + t0
    );
    // Real accepted restore of the same cut.
    let mut restored = crate::Sim::restore(serde_json::to_value(&clone).unwrap())
        .expect("pending Card history cut restores");
    assert_eq!(pending_card_rows(&restored.w), t0);
    assert_eq!(restored.projection.report.card_event_limit, c.q + t0);
    let viewer = restored.players()[0].id;
    let mut projector = crate::FxProjector::attach(&restored, viewer);
    // One ordinary step appends the serialized pending rows before its work; there is no trusted Card report, so
    // the private history rows are the only Card raw rows.
    let events = restored.step();
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, Event::CardBleedHit { .. }))
            .count(),
        t0,
        "the serialized pending Card rows are appended by the ordinary step"
    );
    let report = restored.fx_report();
    assert!(
        report.bounded,
        "the Q + T0 envelope bounds the pending raw history independently of the legacy 512 non-Card cap"
    );
    assert_eq!(report.card_event_limit, c.q + t0);
    assert_eq!(
        projector.feed(report),
        Ok(crate::FeedStatus::Advanced),
        "a fresh viewer feeds the >512, >Q pending-history step"
    );
    assert!(
        projector.card_outputs().is_empty() && projector.events().is_empty(),
        "serialized pending Card history rows confer no entitlement and publish nothing"
    );
}

/// Shared synthetic public-output witness: a real regional-Full8 constructor with eight attached viewer sessions
/// and a crafted sealed report of entitled anonymous Card rows above the legacy output constant. The sealed rows
/// are synthetic (not a produced gameplay/source reach); every projector and buffer is the actual prepared one.
struct SyntheticPublicOutput {
    sim: Sim,
    projector: crate::FxProjector,
    report: crate::fx_report::FxTickReport,
    rows: usize,
    output_capacity: usize,
}

fn synthetic_public_output_witness() -> SyntheticPublicOutput {
    let sim = regional_eight();
    let capacities = capacities(&sim.k, &sim.w).unwrap();
    assert_eq!(capacities.b, 7938);
    assert!(capacities.b > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    let viewer = sim.players()[0].id;
    let projector = crate::FxProjector::attach(&sim, viewer);
    let rows = crate::fx_report::FX_OUTPUT_EVENTS_MAX + 600;
    assert!(rows > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    assert!(rows <= capacities.b);
    let victims: Vec<PlayerId> = (0..rows as u32).map(|n| PlayerId(10_000 + n)).collect();
    let mut report = crate::fx_report::FxTickReport::empty(sim.projection.identity.clone());
    report.complete = true;
    report.tick = sim.tick() + 1;
    report.bounded = true;
    report.viewers = sim.players().iter().map(|p| p.id).collect();
    report.seen = vec![0xff; report.viewers.len()];
    // Every synthetic NPC victim is visible to viewer index 0 (the attached seat).
    report.mob_seen = victims.iter().map(|&id| (id, 0b1)).collect();
    report.ops = vec![
        crate::fx_report::Op::CardSegment(0),
        crate::fx_report::Op::CardFlush(0),
    ];
    report.card_rows = victims
        .iter()
        .map(|&victim| CardExactRow {
            victim,
            by: None,
            sum: {
                let mut sum = crate::fx_projector::exact::ExactSum::default();
                sum.add(1.0).unwrap();
                sum
            },
            invalid: false,
            overflow: false,
        })
        .collect();
    let output_capacity = projector.event_capacity_for_tests();
    SyntheticPublicOutput {
        sim,
        projector,
        report,
        rows,
        output_capacity,
    }
}

#[test]
fn prepared_public_output_beyond_the_legacy_output_constant_uses_the_actual_projector() {
    // SYNTHETIC COMPONENT CAPACITY WITNESS (see `synthetic_public_output_witness`): owned capacities, not heap
    // allocation counts. The paired isolated profiler test below measures the actual allocator delta of the flush.
    let mut witness = synthetic_public_output_witness();
    let rows = witness.rows;
    let output_capacity = witness.output_capacity;
    let (card_limit, card_index_capacity) = witness.projector.card_capacity_for_tests();
    let capacities = capacities(&witness.sim.k, &witness.sim.w).unwrap();
    assert_eq!(card_limit, capacities.b);
    assert!(card_index_capacity >= capacities.b);
    assert!(
        output_capacity >= crate::fx_report::FX_OUTPUT_EVENTS_MAX + capacities.b,
        "owned output is prepared for legacy + B, not only the old constant"
    );
    assert_eq!(
        witness.projector.feed(&witness.report),
        Ok(crate::FeedStatus::Advanced)
    );
    let emitted = witness.projector.card_outputs().len();
    assert_eq!(emitted, rows, "every entitled positive bucket is emitted");
    assert!(emitted > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    assert_eq!(witness.projector.events().len(), rows);
    // Prepared owned buffers did not grow during the actual projection.
    assert_eq!(
        witness.projector.event_capacity_for_tests(),
        output_capacity
    );
    let (limit_after, index_after) = witness.projector.card_capacity_for_tests();
    assert_eq!(
        (limit_after, index_after),
        (card_limit, card_index_capacity)
    );
    assert!(witness
        .projector
        .card_outputs()
        .iter()
        .all(|event| matches!(
            event,
            crate::SeenEvent::Hit {
                passive: false,
                by: None,
                ..
            }
        )));
}

#[test]
#[ignore = "allocation profiler must run alone: cargo test -p rh-sim --lib card_bleed_alloc_public_output -- --ignored --test-threads=1"]
fn card_bleed_alloc_public_output() {
    // Isolated allocator count around ONE actual >legacy-output real projector flush. All setup (constructor,
    // eight/viewer preparation, crafting the synthetic report) happens outside the measured region; the measured
    // region is exactly the actual `FxProjector::feed` of 2,104 public Card rows. This is a scoped owned-buffer
    // growth witness, not a whole-combat or whole-simulation zero-allocation claim.
    let directory = std::env::var_os("RH_CARD_ALLOC_DIRECTORY")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let _profiler = dhat::Profiler::builder()
        .testing()
        .file_name(directory.join("rh-card-bleed-public-output-alloc.json"))
        .build();
    let mut witness = synthetic_public_output_witness();
    let rows = witness.rows;
    assert!(rows > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    let output_capacity = witness.output_capacity;
    let before = dhat::HeapStats::get().total_blocks;
    let fed = witness.projector.feed(&witness.report);
    let blocks = dhat::HeapStats::get().total_blocks - before;
    assert_eq!(fed, Ok(crate::FeedStatus::Advanced));
    assert_eq!(
        blocks, 0,
        "the actual >legacy-output public Card flush allocated {blocks} blocks"
    );
    assert_eq!(witness.projector.card_outputs().len(), rows);
    assert!(witness.projector.card_outputs().len() > crate::fx_report::FX_OUTPUT_EVENTS_MAX);
    assert_eq!(
        witness.projector.event_capacity_for_tests(),
        output_capacity,
        "the prepared owned output did not grow"
    );
    eprintln!(
        "card public-output allocation witness: rows={rows} legacy_constant={} prepared_output_capacity={output_capacity} feed_alloc_blocks={blocks}",
        crate::fx_report::FX_OUTPUT_EVENTS_MAX
    );
}

#[test]
fn capacity_representation_refuses_unrepresentable_or_overflowing_bounds_without_allocating() {
    // Largest valid count vs the reserved NO_NODE sentinel: u32::MAX rows fit the ordinal domain, one more does not.
    assert!(indexed_rows_representable(u32::MAX as usize));
    assert!(indexed_rows_representable(0));
    assert!(!indexed_rows_representable(u32::MAX as usize + 1));
    assert!(!indexed_rows_representable(usize::MAX));
    // The pure accepted-factor arithmetic allocates nothing and refuses an unrepresentable indexed bound before any
    // row allocation could happen.
    assert!(capacity_from(8, 0, 0, u32::MAX as usize, 0, true).is_err());
    assert!(capacity_from(8, 0, 0, 0, u32::MAX as usize, true).is_err());
    // Checked overflow in the general V/factor arithmetic is a representation refusal, not a wrap.
    assert!(capacity_from(usize::MAX, usize::MAX, usize::MAX, 0, 0, false).is_err());
    // The proven pristine and general factor sets remain exactly representable.
    let pristine = capacity_from(8, 8, 0, 0, 0, true).unwrap();
    assert_eq!(
        (pristine.v, pristine.k, pristine.q, pristine.b),
        (8, 64, 64, 72)
    );
    let general = capacity_from(8, 212, 204, 0, 0, false).unwrap();
    assert_eq!(
        (general.v, general.k, general.q, general.b),
        (882, 7056, 7056, 7938)
    );
    // A direct row-vector preparation of an unrepresentable capacity is refused before reserve.
    let mut report = CardBleedReport::default();
    assert!(report.prepare(u32::MAX as usize + 1).is_err());
    let mut segment = CardSegment::default();
    assert!(segment.prepare(u32::MAX as usize + 1).is_err());
    let mut index = PairIndex::new();
    assert!(index.reserve(u32::MAX as usize + 1).is_err());
    assert_eq!(
        report.rows.capacity(),
        0,
        "no giant row reservation was attempted"
    );
    assert_eq!(segment.rows.capacity(), 0);
    assert_eq!(index.capacity(), 0);
}
