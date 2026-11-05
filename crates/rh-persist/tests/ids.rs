//! Durable ids stored by this crate are pinned (append only; see the README). No database needed, so this runs in the
//! default `cargo test --workspace`: a rename of a serde spelling or a drift of a win-counter list fails here.

use rh_persist::{Outcome, GOLD_FACTIONS, GOLD_WEAPONS};

#[test]
fn outcome_spellings_are_pinned() {
    for (o, s) in [
        (Outcome::Won, "won"),
        (Outcome::Draw, "draw"),
        (Outcome::Died, "died"),
        (Outcome::Mia, "mia"),
    ] {
        assert_eq!(
            serde_json::to_value(o).unwrap(),
            s,
            "Outcome spelling is a durable id"
        );
        assert_eq!(serde_json::from_value::<Outcome>(s.into()).unwrap(), o);
    }
}

#[test]
fn win_counter_id_lists_are_pinned() {
    // The ids `winsByFaction` / `winsByWeapon` are keyed by. Append only.
    assert_eq!(
        GOLD_FACTIONS,
        ["fire", "sentenced", "plague", "frost", "holy"]
    );
    assert_eq!(GOLD_WEAPONS, ["sword", "axe", "bow", "wand", "shield"]);
}
