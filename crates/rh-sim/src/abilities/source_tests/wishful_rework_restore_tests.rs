//! P-AUG-TUNE-1 oracle (restore half): the Wishful Thinking trim bound in `abilities/checkpoint.rs` follows the world's
//! rule. The base state is the frozen corpus case `arcane-overload-wishful-stock-trim` (Fire, Arcane Overload +
//! Wishful Thinking, the Wish cast twice), played tick by tick under Legacy and under Rework
//! (`config.augments: "rework"`, read by `setup.rs`); its trims are then rewritten in the checkpoint JSON.
//!
//! Legacy bound (today): each trim and the in-window sum at most `WISHFUL_BUDGET_MS` (30 000). Rework bound: the same
//! reading with the budget the Rework table gives, 20% of the cast's full cooldown.
use super::*;
use serde_json::json;

const CASE: &str = "arcane-overload-wishful-stock-trim";

/// The case played tick by tick (no capture comparison: the Rework numbers differ from the capture's) under `rework`,
/// as a checkpoint JSON, with the last cast's full cooldown.
fn base(rework: bool) -> (V, f64) {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == CASE)
        .unwrap();
    let mut input = case["input"].clone();
    if rework {
        input["config"] = json!({"augments": "rework"});
    }
    let mut s = construct(&input);
    for a in input["actions"].as_array().unwrap() {
        for i in a["inputs"].as_array().into_iter().flatten() {
            enqueue(&mut s, i);
        }
        for _ in 0..a["count"].as_u64().unwrap_or(1) {
            s.step();
        }
    }
    let v = serde_json::to_value(&s).unwrap();
    assert!(Sim::restore(v.clone()).is_ok(), "the played state restores");
    let cd = v
        .pointer("/world/players/0/card_runtime/wish_cast/cooldown_ms")
        .and_then(V::as_f64)
        .expect("the Wish was cast");
    (v, cd)
}

/// The checkpoint with the player's trims replaced by `(at, ms)` pairs.
fn with(mut v: V, trims: &[(f64, f64)]) -> V {
    *v.pointer_mut("/world/players/0/card_trims").unwrap() = json!(trims
        .iter()
        .map(|(at, ms)| json!({"at": at, "ms": ms}))
        .collect::<Vec<_>>());
    v
}

fn restores(v: V) -> bool {
    match Sim::restore(v) {
        Ok(_) => true,
        Err(e) => {
            println!("REFUSED: {e:?}");
            false
        }
    }
}

fn trims_of(v: &V) -> Vec<f64> {
    v.pointer("/world/players/0/card_trims")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["ms"].as_f64().unwrap())
        .collect()
}

/// Played for real under Rework: each hit's cut is 1.5% of the cast's full cooldown, and the state restores.
#[test]
fn a_played_rework_world_trims_a_share_of_the_full_cooldown_and_restores() {
    let (v, cd) = base(true);
    let trims = trims_of(&v);
    assert!(!trims.is_empty(), "the Wishful Thinking producer trimmed");
    for ms in trims {
        assert_eq!(ms, 0.015 * cd, "1.5% of {cd}");
    }
    let (lv, _) = base(false);
    let legacy = trims_of(&lv);
    assert!(!legacy.is_empty());
    for ms in legacy {
        assert_eq!(ms, 1000., "Legacy: 1 s a hit");
    }
}

/// Rework: trims at 20% of the full cooldown restore.
#[test]
fn rework_checkpoint_restores_trims_at_the_twenty_percent_cap() {
    let (v, cd) = base(true);
    let cap = 0.2 * cd;
    assert!(
        restores(with(v.clone(), &[(150., cap)])),
        "one trim at the cap"
    );
    assert!(
        restores(with(v, &[(100., cap / 2.), (150., cap / 2.)])),
        "two trims summing to the cap"
    );
}

/// Rework: one trim past 20% of the full cooldown is refused.
#[test]
fn rework_checkpoint_refuses_one_trim_past_the_cap() {
    let (v, cd) = base(true);
    assert!(!restores(with(v, &[(150., 0.2 * cd + 50.)])));
}

/// Rework: trims inside one window summing past 20% are refused.
#[test]
fn rework_checkpoint_refuses_a_window_sum_past_the_cap() {
    let (v, cd) = base(true);
    let half = 0.1 * cd + 50.;
    assert!(!restores(with(v, &[(100., half), (150., half)])));
}

/// The same numbers are inside Legacy's 30 000 ms budget: Legacy is bounded exactly as before.
#[test]
fn legacy_checkpoint_bound_is_unchanged() {
    let (v, cd) = base(false);
    let budget = crate::constants::WISHFUL_BUDGET_MS;
    assert!(restores(with(v.clone(), &[(150., 0.2 * cd + 50.)])));
    assert!(restores(with(v.clone(), &[(100., 6050.), (150., 6050.)])));
    assert!(restores(with(v.clone(), &[(150., budget)])));
    assert!(!restores(with(v.clone(), &[(150., budget + 50.)])));
    assert!(
        !restores(with(v, &[(100., 15_050.), (150., 15_000.)])),
        "a Legacy window sum past 30 000"
    );
}

/// The Wish's full cooldown can change between casts inside the 60 s window: a card with a `WishCooldown` multiplier
/// (Arcane Overload, the only one in the catalog) taken after the first cast lengthens the next. Trims cut under the
/// short cooldown stay in the window under the long one; the checkpoint must restore, in both worlds, and the trims
/// the world could still add at the new cooldown's cap must restore too.
///
/// Evidence on the other direction (cooldown SHORTENING between casts): no lever. `WishCooldown` multipliers come only
/// from Arcane Overload (`catalog_data.rs:752`, a x2 / Rework x1.5 that only lengthens), no card is ever removed alone
/// (`Build` only grows; the training console's `clear` empties the build AND `reset_player` clears `card_trims`), and
/// a raid start clears the trims too (`cards/runtime.rs:31-52`). A restore bound is therefore safe if it reads the
/// current cast's cooldown, but it must accept the lengthening below. (Also noted, existing behaviour, not pinned:
/// right after taking the card and before the next cast, `wish_cast.cooldown_ms` no longer equals the multiplied
/// cooldown, so `validate` refuses `invalid card Wish spend`.)
#[test]
fn a_cooldown_that_lengthens_between_casts_restores_in_both_worlds() {
    for rework in [false, true] {
        let corpus = corpus();
        let case = corpus["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == CASE)
            .unwrap();
        let mut input = case["input"].clone();
        // Wishful Thinking only: the first cast has the short cooldown.
        input["players"][0]["cards"] = json!(["wishfulThinking"]);
        if rework {
            input["config"] = json!({"augments": "rework"});
        }
        let mut s = construct(&input);
        let cd_of = |s: &Sim| {
            s.w.players[0]
                .card_runtime
                .and_then(|r| r.wish_cast)
                .map(|c| c.cooldown_ms)
        };
        let actions = input["actions"].as_array().unwrap();
        let mut first_cd = None;
        for (i, a) in actions.iter().enumerate() {
            for inp in a["inputs"].as_array().into_iter().flatten() {
                enqueue(&mut s, inp);
            }
            for _ in 0..a["count"].as_u64().unwrap_or(1) {
                s.step();
            }
            if i == 1 {
                // After the first cast and the hit that trimmed it: take Arcane Overload before the second cast.
                first_cd = cd_of(&s);
                assert!(
                    !s.w.players[0].card_trims.is_empty(),
                    "rework={rework}: the first cast was trimmed"
                );
                let id = s.w.players[0].id;
                assert!(crate::cards::grant(
                    &s.k,
                    &mut s.w,
                    id,
                    crate::cards::CardId::ArcaneOverload
                ));
            }
        }
        let first_cd = first_cd.expect("a first cast");
        let last_cd = cd_of(&s).expect("a second cast");
        assert!(
            last_cd > first_cd,
            "rework={rework}: Arcane Overload lengthened the cooldown ({first_cd} to {last_cd})"
        );
        let v = serde_json::to_value(&s).unwrap();
        assert!(
            restores(v.clone()),
            "rework={rework}: trims cut under the short cooldown, cast again under the long one"
        );
        // And the long cooldown's own cap is still accepted under Rework.
        if rework {
            assert!(restores(with(v, &[(150., 0.2 * last_cd)])));
        }
    }
}

/// A checkpoint taken after a grant changed the Wish cooldown multiplier and before the next cast restores.
/// Live defect on int-62: `validate` (`abilities/checkpoint.rs:80-86`) demands the stored `wish_cast.cooldown_ms` equal
/// `cooldown(wish, training, current multiplier)`, but the stored value is what the cast was spent with; taking Arcane
/// Overload (a chest pick, ordinary play) while the Wish cools down changes the multiplier and the restore is refused
/// with `invalid card Wish spend`. The restored sim must also hash and play on equal to the original through the next
/// cast. A genuinely forged spend must still be refused (`repair_tests.rs:33` cooldown 150001 on a completed spend;
/// `cards/fight_clock_tests.rs:635` cooldown 0, `at` 99 and a nulled spend; the cap tests above).
#[test]
fn a_grant_between_a_cast_and_the_next_cast_checkpoints_and_plays_on_in_both_worlds() {
    for rework in [false, true] {
        let corpus = corpus();
        let case = corpus["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == CASE)
            .unwrap();
        let mut input = case["input"].clone();
        input["players"][0]["cards"] = json!([]);
        if rework {
            input["config"] = json!({"augments": "rework"});
        }
        let mut s = construct(&input);
        let actions = input["actions"].as_array().unwrap();
        // The first cast, then a few ticks while it cools down.
        for inp in actions[0]["inputs"].as_array().unwrap() {
            enqueue(&mut s, inp);
        }
        for _ in 0..4 {
            s.step();
        }
        let before = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
        let id = s.w.players[0].id;
        assert!(crate::cards::grant(
            &s.k,
            &mut s.w,
            id,
            crate::cards::CardId::ArcaneOverload
        ));
        let v = serde_json::to_value(&s).unwrap();
        let mut r = match Sim::restore(v) {
            Ok(r) => r,
            Err(e) => panic!("rework={rework}: the checkpoint after the grant is refused: {e:?}"),
        };
        assert_eq!(
            r.state_hash(),
            s.state_hash(),
            "rework={rework}: equal at restore"
        );
        // Play on through the next cast (the case's second cast) in both.
        for inp in actions[2]["inputs"].as_array().unwrap() {
            enqueue(&mut s, inp);
            enqueue(&mut r, inp);
        }
        for t in 0..12 {
            s.step();
            r.step();
            assert_eq!(
                s.state_hash(),
                r.state_hash(),
                "rework={rework}: tick {t} after restore"
            );
        }
        let after = s.w.players[0].card_runtime.unwrap().wish_cast.unwrap();
        assert!(
            after.cooldown_ms > before.cooldown_ms,
            "rework={rework}: the next cast is under the longer cooldown"
        );
    }
}
