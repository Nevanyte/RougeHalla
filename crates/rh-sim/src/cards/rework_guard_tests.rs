//! P-AUG-CONTENT-1-fix guard: every number an override row changes against the legacy catalog is a `REWORK_*` registry row.
//!
//! The rule is stated in `rework_overrides.rs` and `docs/agent/AUGMENT_REWORK.md` step 4: `REWORK_OVERRIDES` is not folded
//! into the content hash (`NON_GAMEPLAY` in `tests/content.rs`), so a bare literal in an override row would change
//! gameplay without moving the hash. The hand-listed rows in `rework_content_tests.rs` cover the 18 cards of
//! P-AUG-CONTENT-1; this guard is generic over the whole table, so a later row is held to the rule without a new test.
//!
//! The walker below mirrors `tuning::map_numbers` (private there, and that file belongs to another packet); its match is
//! exhaustive, so a new row variant or field must say here whether it is a number.
use super::rework_overrides::REWORK_OVERRIDES;
use super::{
    CardDef, CardId, CardRow, OnHitRow, ScaleRow, Selection, TriggerAction, TriggerRow, VsRow,
};
use crate::constants::{ContentVal, REGISTRY};
use crate::stat_fold::{EffectKind, WhileRow};

fn map_numbers(row: &CardRow, f: &mut dyn FnMut(f64) -> f64) -> CardRow {
    fn opt(x: Option<f64>, f: &mut dyn FnMut(f64) -> f64) -> Option<f64> {
        x.map(f)
    }
    match *row {
        CardRow::Fold(kind) => CardRow::Fold(match kind {
            EffectKind::Stat { stat, v } => EffectKind::Stat { stat, v: f(v) },
            EffectKind::Flat { stat, v } => EffectKind::Flat { stat, v: f(v) },
            EffectKind::While(w) => EffectKind::While(WhileRow {
                cond: w.cond,
                arg: f(w.arg),
                stat: w.stat,
                v: f(w.v),
                ms: opt(w.ms, f),
            }),
            EffectKind::Convert { from, to, per, cap } => EffectKind::Convert {
                from,
                to,
                per: f(per),
                cap: opt(cap, f),
            },
            EffectKind::Mult { key, v } => EffectKind::Mult { key, v: f(v) },
            EffectKind::Flag { flag } => EffectKind::Flag { flag },
            EffectKind::Vs => EffectKind::Vs,
            EffectKind::Scale => EffectKind::Scale,
            EffectKind::OnHit => EffectKind::OnHit,
            EffectKind::Trigger => EffectKind::Trigger,
        }),
        CardRow::Vs(v) => CardRow::Vs(VsRow {
            test: v.test,
            arg: f(v.arg),
            v: f(v.v),
        }),
        CardRow::Scale(s) => CardRow::Scale(ScaleRow {
            src: s.src,
            per: f(s.per),
            step: f(s.step),
            cap: f(s.cap),
        }),
        CardRow::OnHit(o) => CardRow::OnHit(OnHitRow {
            status: o.status,
            per: f(o.per),
            cap: opt(o.cap, f),
            ms: f(o.ms),
        }),
        CardRow::Trigger(t) => CardRow::Trigger(TriggerRow {
            on: t.on,
            arg: f(t.arg),
            once: t.once,
            action: match t.action {
                TriggerAction::Splash { radius } => TriggerAction::Splash { radius: f(radius) },
                TriggerAction::Fortify { per, cap } => TriggerAction::Fortify {
                    per: f(per),
                    cap: f(cap),
                },
                TriggerAction::Status {
                    to,
                    status,
                    ms,
                    value,
                } => TriggerAction::Status {
                    to,
                    status,
                    ms: f(ms),
                    value: opt(value, f),
                },
                TriggerAction::Boost { as_, move_, ms } => TriggerAction::Boost {
                    as_: f(as_),
                    move_: f(move_),
                    ms: f(ms),
                },
                TriggerAction::Cooldown { ms } => TriggerAction::Cooldown { ms: f(ms) },
                TriggerAction::Return { melee, share } => TriggerAction::Return {
                    melee,
                    share: f(share),
                },
                TriggerAction::Heal {
                    share,
                    ms,
                    ignore_lockout,
                } => TriggerAction::Heal {
                    share: f(share),
                    ms: opt(ms, f),
                    ignore_lockout,
                },
            },
        }),
    }
}

fn numbers(row: &CardRow) -> Vec<f64> {
    let mut out = Vec::new();
    map_numbers(row, &mut |x| {
        out.push(x);
        x
    });
    out
}

fn shape(row: &CardRow) -> CardRow {
    map_numbers(row, &mut |_| 0.)
}

/// Is `x` (bit for bit) the value of a registry row named `REWORK_*`?
fn is_registered(x: f64) -> bool {
    REGISTRY.iter().any(|e| {
        e.name.starts_with("REWORK_")
            && matches!(e.val, ContentVal::F64(v) if v.to_bits() == x.to_bits())
    })
}

/// Walk two row lists pairwise. A number that differs from the legacy row at the same place, and every number of a row
/// the legacy list lacks or whose shape differs (a number the override adds), must be registered. Each unregistered one
/// is reported as text; the count of numbers that were looked up is added to `checked`.
fn check_rows(
    what: &str,
    legacy: &[CardRow],
    rework: &[CardRow],
    checked: &mut usize,
    bad: &mut Vec<String>,
) {
    for (i, r) in rework.iter().enumerate() {
        let nums = numbers(r);
        let pairs: Vec<(Option<f64>, f64)> = match legacy.get(i) {
            Some(l) if shape(l) == shape(r) => numbers(l)
                .into_iter()
                .zip(nums)
                .map(|(a, b)| (Some(a), b))
                .collect(),
            _ => nums.into_iter().map(|b| (None, b)).collect(),
        };
        for (old, new) in pairs {
            let differs = old.is_none_or(|o| o.to_bits() != new.to_bits());
            if differs {
                *checked += 1;
                if !is_registered(new) {
                    bad.push(format!(
                        "{what} row {i}: {new:?} (catalog {old:?}) is not a REWORK_* registry value"
                    ));
                }
            }
        }
    }
}

/// Every unregistered changed or added number of one override row against its catalog row.
fn unregistered_numbers(legacy: &CardDef, rework: &CardDef, checked: &mut usize) -> Vec<String> {
    let mut bad = Vec::new();
    let id = rework.id;
    check_rows(
        &format!("{id:?}"),
        legacy.rows,
        rework.rows,
        checked,
        &mut bad,
    );
    for (j, s) in rework.selections.iter().enumerate() {
        let what = format!("{id:?} selection {j}");
        match legacy.selections.get(j) {
            Some(l) if l.faction == s.faction => {
                check_rows(&what, l.rows, s.rows, checked, &mut bad)
            }
            _ => check_rows(&what, &[], s.rows, checked, &mut bad),
        }
    }
    bad
}

/// Every row of the real table obeys the rule, and the guard is not looking at nothing.
#[test]
fn every_changed_override_number_is_a_rework_registry_row() {
    let mut checked = 0;
    let mut bad = Vec::new();
    for row in REWORK_OVERRIDES {
        bad.extend(unregistered_numbers(row.id.definition(), row, &mut checked));
    }
    assert!(
        bad.is_empty(),
        "bare literals in override rows:\n{}",
        bad.join("\n")
    );
    assert!(
        checked >= REWORK_OVERRIDES.len() / 2,
        "the guard saw only {checked} changed numbers"
    );
}

fn leak_rows(rows: Vec<CardRow>) -> &'static [CardRow] {
    Box::leak(rows.into_boxed_slice())
}

fn with_rows(base: &CardDef, rows: &'static [CardRow]) -> CardDef {
    CardDef {
        rows,
        selections: &[] as &[Selection],
        ..*base
    }
}

/// Non-vacuity: a doctored row with a bare literal is reported; a row built from a registry value passes; a number the
/// override adds (a longer row list) is held to the same rule.
#[test]
fn the_guard_reports_a_bare_literal_and_accepts_a_registry_value() {
    let bare: f64 = 0.3137;
    assert!(
        !is_registered(bare),
        "0.3137 must not be held by any REWORK_* row for this test to mean anything"
    );
    // Machine Gun: its Hit multiplier is REWORK_MACHINE_GUN_HIT in the table and differs from the catalog.
    let real = REWORK_OVERRIDES
        .iter()
        .find(|d| d.id == CardId::MachineGun)
        .expect("Machine Gun override");
    let legacy = real.id.definition();
    let mut checked = 0;
    assert!(unregistered_numbers(legacy, real, &mut checked).is_empty());
    assert!(
        checked > 0,
        "Machine Gun changes a number against the catalog"
    );

    // Replace every number that differs from the catalog by the bare literal.
    let changed: Vec<f64> = real
        .rows
        .iter()
        .zip(legacy.rows)
        .flat_map(|(r, l)| {
            numbers(r)
                .into_iter()
                .zip(numbers(l))
                .filter(|(a, b)| a.to_bits() != b.to_bits())
                .map(|(a, _)| a)
        })
        .collect();
    assert!(!changed.is_empty());
    let doctored = with_rows(
        real,
        leak_rows(
            real.rows
                .iter()
                .map(|r| map_numbers(r, &mut |x| if changed.contains(&x) { bare } else { x }))
                .collect(),
        ),
    );
    let mut checked = 0;
    let bad = unregistered_numbers(legacy, &doctored, &mut checked);
    println!("negative test, doctored row reports: {bad:#?}");
    assert!(
        !bad.is_empty(),
        "a bare 0.3137 in an override row went unreported"
    );
    assert!(bad.iter().all(|b| b.contains("0.3137")), "{bad:?}");

    // A number the override adds: one more row than the catalog has.
    let registered = REGISTRY
        .iter()
        .find_map(|e| match e.val {
            ContentVal::F64(v) if e.name.starts_with("REWORK_") => Some(v),
            _ => None,
        })
        .expect("a REWORK_* f64 row");
    let extra = |v: f64| {
        let mut rows = legacy.rows.to_vec();
        rows.push(map_numbers(&legacy.rows[0], &mut |_| v));
        with_rows(real, leak_rows(rows))
    };
    let mut checked = 0;
    assert!(
        !unregistered_numbers(legacy, &extra(bare), &mut checked).is_empty(),
        "a bare literal in an added row went unreported"
    );
    assert!(
        unregistered_numbers(legacy, &extra(registered), &mut checked).is_empty(),
        "an added row built from a registry value was refused"
    );
}
