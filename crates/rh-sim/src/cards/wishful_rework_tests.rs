//! P-AUG-TUNE-1 oracle: Wishful Thinking under `AugmentRule::Rework` (plan Appendix A: "-1.5% of full cooldown per hit
//! (<=20%/min); same for every faction"), and nothing under `Legacy`.
//!
//! Legacy rule being kept (`packages/server/src/sim/cardHooks.ts:367-388`, Rust `cards::wishful_thinking`): the window is
//! ROLLING (a trim counts while `now - at < window`, so a trim exactly one window old is gone), the budget is shared by
//! every trim in it, the floor is `cast.at + 0.5 * cast.cooldown_ms` (never below `now`), and a charged Wish's `wish_full_at`
//! shifts with the cut. "Full cooldown" is `WishSpend::cooldown_ms`: the cooldown the cast was spent with, after the
//! cooldown multipliers (Arcane Overload's included), which is what the checkpoint restore also validates.
//!
//! Loose proof, in parts: (1) the numbers are registered `REWORK_WISHFUL_*` rows the table reads; (2) the Wishful row is a
//! text-only override; (3) the cut is a share of the cast's full cooldown, budgeted per rolling window, floored as before;
//! (4) Legacy is the 1 s / 30 s rule. The restore bound is in `abilities/source_tests/wishful_rework_restore_tests.rs`.
use super::{wishful_thinking, CardId, CardNumbers, Trim, Tuning};
use crate::abilities::Stocks;
use crate::cards::runtime::WishSpend;
use crate::constants::{ContentVal, REGISTRY};
use crate::{AugmentRule, SimConfig};

const TEXT: &str =
    "Each hit you land shortens your Wish's cooldown by 1.5% of its full length (at most 20% a minute).";

fn rework() -> &'static Tuning {
    Tuning::of(&SimConfig {
        augments: AugmentRule::Rework,
        ..SimConfig::default()
    })
}

fn legacy() -> &'static Tuning {
    Tuning::of(&SimConfig::default())
}

fn registered(name: &str) -> Option<ContentVal> {
    REGISTRY.iter().find(|e| e.name == name).map(|e| e.val)
}

/// `n` Wishful hits at `now` = 10 s against a Wish cast at tick 0 with full cooldown `cd`, ready at `ready_at`; returns
/// the cut taken and the stocks.
fn hit(
    numbers: &CardNumbers,
    n: u32,
    cd: f64,
    ready_at: f64,
    trims: &mut Vec<Trim>,
) -> (f64, Stocks) {
    let mut st = Stocks {
        wish_ready_at: ready_at,
        wish_full_at: None,
        ..Default::default()
    };
    // The card row's own `ms` (1000 for the flag row) is what the caller passes; Rework ignores it.
    wishful_thinking(
        numbers,
        n,
        1000.,
        10_000.,
        &mut st,
        Some(WishSpend {
            at: 0.,
            cooldown_ms: cd,
        }),
        trims,
    );
    (ready_at - st.wish_ready_at, st)
}

/// Part 1: the named numbers are registered rows (appended after the existing REWORK rows, in this order) that the
/// Rework table reads; the window and floor stay legacy; Legacy keeps its millisecond rule.
#[test]
fn wishful_numbers_are_registered_rows_the_rework_table_reads() {
    let by = |n: &str| match registered(n) {
        Some(ContentVal::F64(x)) => x,
        other => panic!("{n}: not registered as an f64 row ({other:?})"),
    };
    assert_eq!(by("REWORK_WISHFUL_HIT_SHARE"), 0.015, "1.5% per hit");
    assert_eq!(by("REWORK_WISHFUL_BUDGET_SHARE"), 0.20, "20% a window");
    // Appended after the last existing REWORK row (`REWORK_EYE_FOR_AN_EYE_WEIGHT` on coord/int-62), adjacent, in this order.
    let names: Vec<&str> = REGISTRY.iter().map(|e| e.name).collect();
    let at = |n: &str| {
        names
            .iter()
            .position(|x| *x == n)
            .unwrap_or_else(|| panic!("{n} not registered"))
    };
    assert_eq!(
        at("REWORK_WISHFUL_BUDGET_SHARE"),
        at("REWORK_WISHFUL_HIT_SHARE") + 1,
        "adjacent, in order"
    );
    assert!(
        at("REWORK_WISHFUL_HIT_SHARE") > at("REWORK_EYE_FOR_AN_EYE_WEIGHT"),
        "appended after the rows that exist"
    );
    let n = rework().numbers();
    assert_eq!(n.wishful_hit_share, by("REWORK_WISHFUL_HIT_SHARE"));
    assert_eq!(n.wishful_budget_share, by("REWORK_WISHFUL_BUDGET_SHARE"));
    assert_eq!(n.wishful_window_ms, crate::constants::WISHFUL_WINDOW_MS);
    assert_eq!(n.wishful_floor_share, crate::constants::WISHFUL_FLOOR_SHARE);
    let l = legacy().numbers();
    assert_eq!(l.wishful_budget_ms, 30_000.);
    assert_eq!(l.wishful_window_ms, 60_000.);
    assert_eq!(l.wishful_floor_share, 0.5);
    assert_eq!(l.wishful_hit_share, 0., "Legacy has no share rule");
    assert_eq!(l.wishful_budget_share, 0., "Legacy has no share rule");
}

/// Part 2: Wishful's override is text only (its row stays the catalog flag row, like Gambler, Third Time and Plant), the
/// text is the one the Unity catalog shows, it passes the shape guard, and Legacy keeps the catalog row and text.
#[test]
fn wishful_override_is_text_only_and_matches_the_unity_catalog() {
    let id = CardId::WishfulThinking;
    let def = rework().def(id);
    assert_eq!(def.text, TEXT);
    assert_eq!(
        def.rows,
        id.definition().rows,
        "numbers live in CardNumbers"
    );
    assert_ne!(def.text, id.definition().text);
    assert_eq!(super::check_override(id.definition(), def), Ok(()));
    assert_eq!(legacy().def(id), id.definition());
    assert_eq!(
        id.definition().text,
        "Each hit you land shortens your Wish's cooldown by 1 s (at most 30 s a minute)."
    );
}

/// Part 3a: a hit cuts 1.5% of the cast's full cooldown, whatever the cooldown (so Arcane Overload's longer cast cooldown
/// is cut by more), and `n` hits in a tick cut `n` times that.
#[test]
fn a_hit_cuts_one_and_a_half_percent_of_the_full_cooldown() {
    let n = rework().numbers();
    // Ready far above the floor (cast at 0, floor 0.5 * cd): nothing but the share limits the cut.
    let (cut, _) = hit(n, 1, 40_000., 45_000., &mut Vec::new());
    assert_eq!(cut, 600., "1.5% of 40 s");
    let (cut, _) = hit(n, 1, 60_000., 65_000., &mut Vec::new());
    assert_eq!(
        cut, 900.,
        "1.5% of 60 s: the multiplier's cooldown is the base"
    );
    let (cut, _) = hit(n, 3, 40_000., 45_000., &mut Vec::new());
    assert_eq!(cut, 1800., "three hits in one tick");
    // Legacy, same call: 1 s a hit whatever the cooldown.
    let l = legacy().numbers();
    assert_eq!(hit(l, 1, 40_000., 45_000., &mut Vec::new()).0, 1000.);
    assert_eq!(hit(l, 1, 60_000., 65_000., &mut Vec::new()).0, 1000.);
}

/// Part 3b: the window's cuts stop at 20% of the full cooldown (8 000 of 40 000), shared by every trim in the rolling
/// window; the last cut is only what is left.
#[test]
fn the_window_budget_is_twenty_percent_of_the_full_cooldown() {
    let n = rework().numbers();
    let mut trims = vec![Trim {
        at: 9_000.,
        ms: 7_900.,
    }];
    let (cut, _) = hit(n, 1, 40_000., 45_000., &mut trims);
    assert_eq!(cut, 100., "only the 100 ms left of the 8 000 budget");
    assert_eq!(trims.len(), 2);
    let (cut, _) = hit(n, 1, 40_000., 45_000., &mut trims);
    assert_eq!(cut, 0., "budget spent");
    assert_eq!(trims.len(), 2, "a refused cut leaves no trim");
    // Many hits in one tick are cut short by the budget too: 20 hits would be 12 000.
    let (cut, _) = hit(n, 20, 40_000., 45_000., &mut Vec::new());
    assert_eq!(cut, 8_000.);
    // Legacy's budget is the 30 000 ms constant, whatever the cooldown.
    let l = legacy().numbers();
    let mut used = vec![Trim {
        at: 9_000.,
        ms: 29_500.,
    }];
    assert_eq!(hit(l, 1, 40_000., 45_000., &mut used).0, 500.);
}

/// Part 3c: the window is rolling and exclusive, as in legacy: a trim exactly one window old has left it, one tick
/// younger still counts.
#[test]
fn the_window_is_rolling_like_legacy() {
    let n = rework().numbers();
    let mut gone = vec![Trim {
        at: 10_000. - 60_000.,
        ms: 8_000.,
    }];
    let (cut, _) = hit(n, 1, 40_000., 45_000., &mut gone);
    assert_eq!(cut, 600., "a trim 60 s old no longer counts");
    assert_eq!(gone.len(), 1, "it was dropped and the new cut recorded");
    let mut kept = vec![Trim {
        at: 10_000. - 59_950.,
        ms: 8_000.,
    }];
    let (cut, _) = hit(n, 1, 40_000., 45_000., &mut kept);
    assert_eq!(cut, 0., "a trim 59.95 s old still counts");
}

/// Part 3d: the floor keeps its legacy meaning: no cut takes the cooldown below half the cast cooldown after the cast
/// (never below now); a charged Wish's full clock shifts with the cut.
#[test]
fn the_floor_and_the_charge_clock_keep_their_legacy_meaning() {
    let n = rework().numbers();
    // Cast at 0 with 40 s: the floor is at 20 s; the clock ends at 20 300, 300 above it.
    let (cut, st) = hit(n, 1, 40_000., 20_300., &mut Vec::new());
    assert_eq!(cut, 300., "limited by the floor, not the 600 share");
    assert_eq!(st.wish_ready_at, 20_000.);
    // Not on cooldown but a charge recharging: only the full clock moves.
    let mut st = Stocks {
        wish_ready_at: 0.,
        wish_full_at: Some(45_000.),
        ..Default::default()
    };
    wishful_thinking(
        n,
        1,
        1000.,
        10_000.,
        &mut st,
        Some(WishSpend {
            at: 0.,
            cooldown_ms: 40_000.,
        }),
        &mut Vec::new(),
    );
    assert_eq!(st.wish_ready_at, 0.);
    assert_eq!(st.wish_full_at, Some(44_400.));
}
