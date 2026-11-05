//! Durable ids are pinned. The strings below are jsonb keys and values in stored profiles and match records
//! (`winsByFaction`, `winsByWeapon`, `outcome`, `winBonusWhy`, later cosmetics and achievements). They are APPEND ONLY:
//! a new content id adds a line here; a rename or removal fails this test, because it would silently orphan stored data
//! (a rename needs a jsonb key-rewrite migration across every profile, coordinated with deployed binaries).
//!
//! Cosmetic and achievement ids join this table in the packet that ports them (P-PERSIST-2).
//!
//! The sim-side pin below needs no database or feature, so it runs in the default `cargo test --workspace`. The tests that
//! need rh-persist (`--features postgres`) are gated individually; the persist-side spellings (the `Outcome` serde names and
//! the store's win-counter id lists) are also pinned in `crates/rh-persist/tests/ids.rs`, which runs by default too.
use rh_sim::{FactionId, WeaponId};

/// The pinned spellings, in the order the sim lists them.
const FACTIONS: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
const WEAPONS: [&str; 6] = ["sword", "bow", "wand", "shield", "axe", "fists"];

#[test]
fn faction_and_weapon_id_strings_never_change_silently() {
    let f: Vec<&str> = FactionId::ALL.iter().map(|f| f.as_str()).collect();
    assert_eq!(
        f, FACTIONS,
        "FactionId::as_str is a durable id (append only)"
    );
    let w: Vec<&str> = WeaponId::ALL.iter().map(|w| w.as_str()).collect();
    assert_eq!(w, WEAPONS, "WeaponId::as_str is a durable id (append only)");
    for id in FACTIONS {
        assert_eq!(FactionId::parse(id).map(FactionId::as_str), Some(id));
    }
}

#[cfg(feature = "postgres")]
#[test]
fn the_stores_win_counter_lists_are_subsets_of_the_sims_ids() {
    use rh_persist::{GOLD_FACTIONS, GOLD_WEAPONS};
    // `count_win` ignores an id it does not list, so a list that drifts from the sim silently stops counting.
    for id in GOLD_FACTIONS {
        assert!(FactionId::parse(id).is_some(), "{id} is not a faction");
    }
    for id in GOLD_WEAPONS {
        assert!(
            WeaponId::ALL.iter().any(|w| w.as_str() == id),
            "{id} is not a weapon"
        );
    }
    // Every faction can bank a counted win.
    for f in FactionId::ALL {
        assert!(
            GOLD_FACTIONS.contains(&f.as_str()),
            "{} is not counted",
            f.as_str()
        );
    }
}

#[cfg(feature = "postgres")]
#[test]
fn stored_result_spellings_are_pinned() {
    use rh_server::persist::pg::to_persist;
    use rh_sim::results::{GvBreakdown, WinBonusWhy};
    use rh_sim::sim::Outcome;
    use rh_sim::RunResult;
    let mut r = RunResult {
        outcome: Outcome::Won,
        profile: "p".into(),
        duration_sec: 90,
        kills: 2,
        killed_by: Some("q".into()),
        killed_by_bot: true,
        place: 1,
        players: 4,
        gv: GvBreakdown::default(),
        win_bonus_withheld: true,
        win_bonus_why: Some(WinBonusWhy::Starters),
    };
    let stored = to_persist(&r);
    assert_eq!(stored.win_bonus_why.as_deref(), Some("starters"));
    assert_eq!(stored.killed_by.as_deref(), Some("q"));
    assert_eq!(
        (stored.duration_sec, stored.place, stored.players),
        (90, 1, 4)
    );
    assert!(stored.killed_by_bot && stored.win_bonus_withheld && !stored.win_qualified);
    r.win_bonus_why = Some(WinBonusWhy::Opponents);
    assert_eq!(to_persist(&r).win_bonus_why.as_deref(), Some("opponents"));
    for (o, s) in [
        (Outcome::Won, "won"),
        (Outcome::Draw, "draw"),
        (Outcome::Died, "died"),
        (Outcome::Mia, "mia"),
    ] {
        r.outcome = o;
        let v = serde_json::to_value(to_persist(&r).outcome).unwrap();
        assert_eq!(v, s, "Outcome spelling is a durable id");
    }
}
