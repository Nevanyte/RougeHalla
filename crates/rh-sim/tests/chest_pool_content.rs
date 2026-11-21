//! P-AUG-POOL-1-fix oracle: both real card tables (Legacy and Rework) are part of the rules identity as a world plays
//! them, not only through the registry values they name. Perturbing, through the seam `content_hash_of_card_tables`,
//! any of the following moves `content_hash`, with the registry left identical:
//! - a `CardNumbers` field, or two fields swapped (the set of values unchanged);
//! - a number of an override row (bumped, pointed at another registered value, or swapped with another row's), or the
//!   row removed;
//! - the chest inputs: a pool card added or removed, a faction-only pair added, the Eye for an Eye weighting flag;
//! - which rule holds which table.
//!
//! The seam over the real tables is `content_hash` itself. The digest moves with the fix; what is pinned for Legacy is
//! the fold's inputs (the legacy numbers, no override, the 14-card pool, no pair, no weighting).

use rh_sim::cards::{map_numbers, CardDef, CardId, CardKind, CardNumbers, CardRow, Tuning};
use rh_sim::constants::{self as c, ContentVal, REGISTRY};
use rh_sim::content::{
    card_table_snapshots, content_hash, content_hash_of_card_tables, CardTableSnapshot,
    STAGGER_WEAPONS,
};
use rh_sim::reward_chests::{Offer, INTERACTIVE, REWORK_POOL};
use rh_sim::{AugmentRule, FactionId, SimConfig};
use std::collections::BTreeMap;

fn hash(tables: &[CardTableSnapshot<'_>]) -> u64 {
    content_hash_of_card_tables(REGISTRY, STAGGER_WEAPONS, tables)
}

fn config(augments: AugmentRule) -> SimConfig {
    SimConfig {
        augments,
        ..SimConfig::default()
    }
}

/// A live augment: what `Tuning::augment_pool` admits from a pool (`kind == Augment && ready`).
fn live_augment(id: CardId) -> bool {
    let d = id.definition();
    d.kind == CardKind::Augment && d.ready
}

fn bump(x: f64) -> f64 {
    f64::from_bits(x.to_bits() ^ 1)
}

/// Records one perturbation: it must move the hash off `base` and differ from every earlier perturbation.
fn record(seen: &mut BTreeMap<u64, String>, base: u64, h: u64, what: String) {
    assert_ne!(
        h, base,
        "{what} does not move content_hash (the card table is outside the rules identity)"
    );
    if let Some(earlier) = seen.insert(h, what.clone()) {
        panic!("{what} collides with {earlier}");
    }
}

/// The `CardNumbers` fields as named setters. The destructuring has no `..`: a new field does not compile here until
/// it is listed (and so perturbed).
type Field = (&'static str, fn(&mut CardNumbers));
fn number_fields(n: &CardNumbers) -> Vec<Field> {
    let CardNumbers {
        plant_feet_bonus: _,
        gambler_up_chance: _,
        gambler_down_chance: _,
        gambler_up: _,
        gambler_down: _,
        wishful_budget_ms: _,
        wishful_window_ms: _,
        wishful_floor_share: _,
        wishful_hit_share: _,
        wishful_budget_share: _,
        outgoing_row_cap: _,
        hp_race_cap: _,
        third_time_every: _,
        third_time_extra: _,
    } = n;
    vec![
        ("plant_feet_bonus", |n| {
            n.plant_feet_bonus = bump(n.plant_feet_bonus)
        }),
        ("gambler_up_chance", |n| {
            n.gambler_up_chance = bump(n.gambler_up_chance)
        }),
        ("gambler_down_chance", |n| {
            n.gambler_down_chance = bump(n.gambler_down_chance)
        }),
        ("gambler_up", |n| n.gambler_up = bump(n.gambler_up)),
        ("gambler_down", |n| n.gambler_down = bump(n.gambler_down)),
        ("wishful_budget_ms", |n| {
            n.wishful_budget_ms = bump(n.wishful_budget_ms)
        }),
        ("wishful_window_ms", |n| {
            n.wishful_window_ms = bump(n.wishful_window_ms)
        }),
        ("wishful_floor_share", |n| {
            n.wishful_floor_share = bump(n.wishful_floor_share)
        }),
        ("wishful_hit_share", |n| {
            n.wishful_hit_share = bump(n.wishful_hit_share)
        }),
        ("wishful_budget_share", |n| {
            n.wishful_budget_share = bump(n.wishful_budget_share)
        }),
        ("outgoing_row_cap", |n| {
            n.outgoing_row_cap = bump(n.outgoing_row_cap)
        }),
        ("hp_race_cap", |n| n.hp_race_cap = bump(n.hp_race_cap)),
        ("third_time_every", |n| n.third_time_every ^= 1),
        ("third_time_extra", |n| {
            n.third_time_extra = bump(n.third_time_extra)
        }),
    ]
}

/// How many numbers `map_numbers` walks in a row.
fn count_numbers(row: &CardRow) -> usize {
    let mut n = 0;
    map_numbers(row, &mut |x| {
        n += 1;
        x
    });
    n
}

/// The row with its `k`-th number (in `map_numbers` order) replaced by `f(number)`.
fn with_number(row: &CardRow, k: usize, f: impl Fn(f64) -> f64) -> CardRow {
    let mut i = 0;
    map_numbers(row, &mut |x| {
        let y = if i == k { f(x) } else { x };
        i += 1;
        y
    })
}

/// The override row `def` with its `k`-th number (rows, then each selection's rows) replaced by `f(number)`.
fn def_with_number(def: &CardDef, k: usize, f: impl Fn(f64) -> f64) -> Option<CardDef> {
    let mut at = k;
    for (r, row) in def.rows.iter().enumerate() {
        let n = count_numbers(row);
        if at < n {
            let mut rows = def.rows.to_vec();
            rows[r] = with_number(row, at, f);
            return Some(CardDef {
                rows: Box::leak(rows.into_boxed_slice()),
                ..*def
            });
        }
        at -= n;
    }
    for (s, sel) in def.selections.iter().enumerate() {
        for (r, row) in sel.rows.iter().enumerate() {
            let n = count_numbers(row);
            if at < n {
                let mut rows = sel.rows.to_vec();
                rows[r] = with_number(row, at, f);
                let mut selections = def.selections.to_vec();
                selections[s].rows = Box::leak(rows.into_boxed_slice());
                return Some(CardDef {
                    selections: Box::leak(selections.into_boxed_slice()),
                    ..*def
                });
            }
            at -= n;
        }
    }
    None
}

fn first_number(def: &CardDef) -> f64 {
    let mut first = None;
    for row in def.rows {
        map_numbers(row, &mut |x| {
            first.get_or_insert(x);
            x
        });
    }
    first.expect("an override row with a number")
}

#[test]
fn the_folded_card_tables_are_the_real_tables_and_legacy_is_todays() {
    let [legacy, rework] = card_table_snapshots();

    // The fold reads each rule's own table, the one a world with that rule plays.
    let legacy_world = Tuning::of(&SimConfig::default());
    assert_eq!(legacy_world.rule(), AugmentRule::Legacy);
    assert_eq!(legacy, CardTableSnapshot::of(legacy_world));
    let live = Tuning::of(&SimConfig::live_content());
    assert_eq!(live.rule(), AugmentRule::Rework);
    assert_eq!(rework, CardTableSnapshot::of(live));
    assert_eq!(
        rework,
        CardTableSnapshot::of(Tuning::of(&config(AugmentRule::Rework)))
    );

    // Legacy: today's inputs exactly. The legacy constants (Third Time's `3` and `1.` written inline as in legacy
    // `onHit.ts:39`; no Wishful share rule), no override row, the source INTERACTIVE_AUGMENT_IDS in source order, no
    // faction pair, no weighting ...
    assert_eq!(legacy.rule, AugmentRule::Legacy);
    assert_eq!(
        legacy.numbers,
        CardNumbers {
            plant_feet_bonus: c::PLANT_FEET_BONUS,
            gambler_up_chance: c::GAMBLER_CHANCE,
            gambler_down_chance: c::GAMBLER_CHANCE,
            gambler_up: c::GAMBLER_UP,
            gambler_down: c::GAMBLER_DOWN,
            wishful_budget_ms: c::WISHFUL_BUDGET_MS,
            wishful_window_ms: c::WISHFUL_WINDOW_MS,
            wishful_floor_share: c::WISHFUL_FLOOR_SHARE,
            wishful_hit_share: 0.,
            wishful_budget_share: 0.,
            outgoing_row_cap: c::OUTGOING_ROW_CAP,
            hp_race_cap: c::HP_RACE_CAP,
            third_time_every: 3,
            third_time_extra: 1.,
        }
    );
    assert!(legacy.overrides.is_empty());
    assert_eq!(legacy.pool, &INTERACTIVE[..]);
    assert!(legacy.faction_only.is_empty());
    assert!(!legacy.weight_eye_for_an_eye);
    // ... and they are what a Legacy world reads: every card's catalog row, the 14 offered to anyone, nothing else.
    for id in CardId::ALL {
        assert!(
            std::ptr::eq(legacy_world.def(id), id.definition()),
            "{id:?}"
        );
        let expected = INTERACTIVE.contains(&id).then_some(Offer::Any);
        assert_eq!(legacy_world.offer(id), expected, "Legacy offer of {id:?}");
    }

    // Rework: its own numbers, its override rows, its pool, its pairs (none until P-AUG-NATIVE-4), the weighting on.
    assert_eq!(rework.rule, AugmentRule::Rework);
    assert_eq!(rework.numbers, *live.numbers());
    assert_eq!(rework.overrides, live.overrides());
    assert!(
        rework.overrides.len() >= 10,
        "the Rework table has {} override rows",
        rework.overrides.len()
    );
    assert_eq!(rework.pool, REWORK_POOL);
    assert_eq!(rework.faction_only, live.faction_only());
    assert!(rework.weight_eye_for_an_eye);
}

#[test]
fn the_seam_with_the_real_tables_is_the_content_hash() {
    assert_eq!(hash(&card_table_snapshots()), content_hash());
}

#[test]
fn every_card_number_field_of_either_table_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    for t in 0..real.len() {
        for (name, perturb) in number_fields(&real[t].numbers) {
            let mut tables = real;
            perturb(&mut tables[t].numbers);
            assert_ne!(tables[t].numbers, real[t].numbers, "{name}");
            record(
                &mut seen,
                base,
                hash(&tables),
                format!("changing the {:?} table's {name}", real[t].rule),
            );
        }
    }
    assert_eq!(seen.len(), 2 * 14);
}

#[test]
fn swapping_two_card_number_fields_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    for t in 0..real.len() {
        let n = real[t].numbers;
        // Same set of values, different fields: the registry cannot see this.
        let swaps: [(&str, CardNumbers); 2] = [
            (
                "gambler_up <-> gambler_down",
                CardNumbers {
                    gambler_up: n.gambler_down,
                    gambler_down: n.gambler_up,
                    ..n
                },
            ),
            (
                "plant_feet_bonus <-> outgoing_row_cap",
                CardNumbers {
                    plant_feet_bonus: n.outgoing_row_cap,
                    outgoing_row_cap: n.plant_feet_bonus,
                    ..n
                },
            ),
        ];
        for (what, swapped) in swaps {
            assert_ne!(swapped, n, "{what}: the two values are equal");
            let mut tables = real;
            tables[t].numbers = swapped;
            record(
                &mut seen,
                base,
                hash(&tables),
                format!("swapping the {:?} table's {what}", real[t].rule),
            );
        }
    }
}

#[test]
fn every_number_of_every_rework_override_row_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    let overrides = real[1].overrides;
    for (i, def) in overrides.iter().enumerate() {
        let mut k = 0;
        while let Some(changed) = def_with_number(def, k, bump) {
            let mut rows = overrides.to_vec();
            rows[i] = changed;
            let mut tables = real;
            tables[1].overrides = &rows;
            record(
                &mut seen,
                base,
                hash(&tables),
                format!("number {k} of the Rework override row of {:?}", def.id),
            );
            k += 1;
        }
    }
    assert!(
        seen.len() >= overrides.len(),
        "only {} override numbers perturbed over {} rows",
        seen.len(),
        overrides.len()
    );
}

#[test]
fn retargeting_swapping_or_removing_a_rework_override_row_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    let overrides = real[1].overrides;

    // An override number pointed at another registered REWORK_* value (the registry is unchanged).
    let first = first_number(&overrides[0]);
    let other = REGISTRY
        .iter()
        .filter(|e| e.name.starts_with("REWORK_"))
        .find_map(|e| match e.val {
            ContentVal::F64(x) if x.to_bits() != first.to_bits() => Some((e.name, x)),
            _ => None,
        })
        .expect("another REWORK_* number");
    let mut rows = overrides.to_vec();
    rows[0] = def_with_number(&overrides[0], 0, |_| other.1).unwrap();
    let mut tables = real;
    tables[1].overrides = &rows;
    record(
        &mut seen,
        base,
        hash(&tables),
        format!(
            "pointing the {:?} override's first number at {}",
            overrides[0].id, other.0
        ),
    );

    // Two override rows' first numbers swapped (the same set of values).
    let (a, b) = (0..overrides.len())
        .flat_map(|a| (a + 1..overrides.len()).map(move |b| (a, b)))
        .find(|&(a, b)| {
            first_number(&overrides[a]).to_bits() != first_number(&overrides[b]).to_bits()
        })
        .expect("two override rows with different first numbers");
    let (va, vb) = (first_number(&overrides[a]), first_number(&overrides[b]));
    let mut rows = overrides.to_vec();
    rows[a] = def_with_number(&overrides[a], 0, |_| vb).unwrap();
    rows[b] = def_with_number(&overrides[b], 0, |_| va).unwrap();
    let mut tables = real;
    tables[1].overrides = &rows;
    record(
        &mut seen,
        base,
        hash(&tables),
        format!(
            "swapping the first numbers of the {:?} and {:?} overrides",
            overrides[a].id, overrides[b].id
        ),
    );

    // Each override row removed (that card plays its catalog row again).
    for i in 0..overrides.len() {
        let mut rows = overrides.to_vec();
        let gone = rows.remove(i);
        let mut tables = real;
        tables[1].overrides = &rows;
        record(
            &mut seen,
            base,
            hash(&tables),
            format!("removing the Rework override row of {:?}", gone.id),
        );
    }
}

#[test]
fn adding_or_removing_one_pool_card_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    let mut added_per_table = [0usize; 2];
    for t in 0..real.len() {
        let pool = real[t].pool;
        for i in 0..pool.len() {
            let mut fewer = pool.to_vec();
            let gone = fewer.remove(i);
            let mut tables = real;
            tables[t].pool = &fewer;
            record(
                &mut seen,
                base,
                hash(&tables),
                format!("removing {gone:?} from the {:?} pool", real[t].rule),
            );
        }
        for id in CardId::ALL {
            if pool.contains(&id) || !live_augment(id) {
                continue;
            }
            let mut more = pool.to_vec();
            more.push(id);
            let mut tables = real;
            tables[t].pool = &more;
            record(
                &mut seen,
                base,
                hash(&tables),
                format!("adding {id:?} to the {:?} pool", real[t].rule),
            );
            added_per_table[t] += 1;
        }
    }
    // Non-vacuity: the five Rework additions are live augments outside the Legacy pool; Glass Cannon is outside both.
    assert!(
        added_per_table[0] >= 6,
        "only {} additions tried on the Legacy pool",
        added_per_table[0]
    );
    assert!(
        added_per_table[1] >= 1,
        "no addition tried on the Rework pool"
    );
}

#[test]
fn adding_or_changing_a_faction_pair_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    for t in 0..real.len() {
        let pool = real[t].pool;
        let (first, second) = (pool[0], pool[1]);
        for faction in FactionId::ALL {
            let mut pairs = real[t].faction_only.to_vec();
            pairs.push((first, faction));
            let mut tables = real;
            tables[t].faction_only = &pairs;
            record(
                &mut seen,
                base,
                hash(&tables),
                format!(
                    "making {first:?} {faction:?}-only in the {:?} table",
                    real[t].rule
                ),
            );
        }
        let mut pairs = real[t].faction_only.to_vec();
        pairs.push((first, FactionId::ALL[0]));
        pairs.push((second, FactionId::ALL[1]));
        let mut tables = real;
        tables[t].faction_only = &pairs;
        record(
            &mut seen,
            base,
            hash(&tables),
            format!("two faction pairs in the {:?} table", real[t].rule),
        );
    }
}

#[test]
fn flipping_the_eye_for_an_eye_weight_flag_moves_the_content_hash() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    for t in 0..real.len() {
        let mut tables = real;
        tables[t].weight_eye_for_an_eye = !tables[t].weight_eye_for_an_eye;
        record(
            &mut seen,
            base,
            hash(&tables),
            format!(
                "flipping the {:?} table's Eye for an Eye weighting to {}",
                real[t].rule, tables[t].weight_eye_for_an_eye
            ),
        );
    }
}

#[test]
fn which_rule_holds_which_table_is_folded() {
    let real = card_table_snapshots();
    let base = content_hash();
    let mut seen = BTreeMap::new();
    let swapped = [real[1], real[0]];
    record(
        &mut seen,
        base,
        hash(&swapped),
        "swapping the Legacy and Rework tables".to_string(),
    );
    let mut legacy_plays_rework_pool = real;
    legacy_plays_rework_pool[0].pool = real[1].pool;
    record(
        &mut seen,
        base,
        hash(&legacy_plays_rework_pool),
        "giving Legacy the Rework pool".to_string(),
    );
    let mut legacy_plays_rework_rows = real;
    legacy_plays_rework_rows[0].overrides = real[1].overrides;
    record(
        &mut seen,
        base,
        hash(&legacy_plays_rework_rows),
        "giving Legacy the Rework override rows".to_string(),
    );
}
