//! P-AUG-BOTS-1 oracle: the chest bot scores the rework's cards. A loose proof of the shape (a native card is scored,
//! not skipped as an unknown id; a faction card is valued by its faction only; Marked Man costs something), not tick
//! or number exactness. Brief `docs/backlog/packets/P-AUG-BOTS-1.md`.
use super::*;
use crate::bots::temporal_percept::modules::types::CardCounts;
use rh_sim::cards::native::pool_members;
use rh_sim::reward_chests::Offer;
use rh_sim::FactionId;

fn me(faction: &str, weapon: WeaponId, risk: f64) -> ChestSelf {
    ChestSelf {
        faction: faction.into(),
        weapons: [Some(weapon), None],
        slot: None,
        risk: Some(risk),
        build: Some(CardCounts::default()),
    }
}

fn faction_name(f: FactionId) -> &'static str {
    match f {
        FactionId::Fire => "fire",
        FactionId::Frost => "frost",
        FactionId::Plague => "plague",
        FactionId::Sentenced => "sentenced",
        other => panic!("no faction-only card for {other:?}"),
    }
}

/// Legacy: every native id fell through `card_def` as an unknown id (score 0, "still takeable").
#[test]
fn every_native_card_is_scored_not_treated_as_unknown() {
    for card in CardId::NATIVE {
        let faction = pool_members()
            .find_map(|(c, o)| match (c == card, o) {
                (true, Offer::Faction(f)) => Some(faction_name(f)),
                _ => None,
            })
            .unwrap_or("holy");
        let score = card_score(card.as_str(), &me(faction, WeaponId::Sword, 1.0));
        if card == CardId::MarkedMan {
            assert!(score != 0., "{card:?} must not read as an unknown id");
            continue;
        }
        assert!(
            score.is_finite() && score > 1.0,
            "{card:?}: a free augment is worth taking at full risk appetite, got {score}"
        );
    }
}

/// The natives are unique: a held one is refused like any held unique card.
#[test]
fn a_held_native_card_is_refused() {
    for card in CardId::NATIVE {
        let mut s = me("holy", WeaponId::Sword, 1.0);
        let mut counts = CardCounts::default();
        counts.set(card.as_str(), 1.);
        s.build = Some(counts);
        assert_eq!(card_score(card.as_str(), &s), f64::NEG_INFINITY, "{card:?}");
    }
}

/// A faction-only card (chests of that faction only) is worth its faction's bot a take, and nobody else's.
#[test]
fn a_faction_card_is_valued_by_its_faction_only() {
    let plain = card_score("ad1", &me("fire", WeaponId::Sword, 1.0));
    let mut seen = 0;
    for (card, offer) in pool_members() {
        let Offer::Faction(f) = offer else { continue };
        seen += 1;
        let own = card_score(card.as_str(), &me(faction_name(f), WeaponId::Sword, 1.0));
        let other = ["fire", "frost", "plague", "sentenced"]
            .into_iter()
            .find(|n| *n != faction_name(f))
            .unwrap();
        let off = card_score(card.as_str(), &me(other, WeaponId::Sword, 1.0));
        assert!(
            own > plain,
            "{card:?}: own faction {own} beats a plain base {plain}"
        );
        assert!(off < own, "{card:?}: off faction {off} below own {own}");
        assert!(
            off < plain,
            "{card:?}: off faction {off} loses to a plain base {plain}"
        );
    }
    assert_eq!(seen, 4, "the four faction-only natives");
}

/// A native that suits the weapon in hand beats the same card without it (as `rule_fit` does for the catalog).
#[test]
fn weapon_cards_prefer_their_weapon() {
    for (card, weapon) in [
        (CardId::Calluses, WeaponId::Fists),
        (CardId::Bastion, WeaponId::Shield),
        (CardId::MarksmansTally, WeaponId::Bow),
    ] {
        let with = card_score(card.as_str(), &me("holy", weapon, 1.0));
        let without = card_score(card.as_str(), &me("holy", WeaponId::Wand, 1.0));
        assert!(with > without, "{card:?}: {with} vs {without}");
    }
}

/// Wish Engine is taken over a plain tier-I base; Marked Man (always shown on the minimap) is a cost: refused below the
/// trade-off risk, and under Wish Engine above it.
#[test]
fn wish_engine_is_wanted_and_marked_man_is_a_tradeoff() {
    let wish = card_score("wishEngine", &me("holy", WeaponId::Sword, 1.0));
    assert!(wish > card_score("ad1", &me("holy", WeaponId::Sword, 1.0)));
    let opts = vec!["ad1".to_string(), "wishEngine".to_string()];
    let taken = vec![String::new(), String::new()];
    assert_eq!(
        choose_option(&opts, &taken, &me("holy", WeaponId::Sword, 1.0)),
        1
    );
    assert_eq!(
        card_score(
            "markedMan",
            &me("holy", WeaponId::Sword, TRADEOFF_RISK - 0.01)
        ),
        f64::NEG_INFINITY
    );
    let marked = card_score("markedMan", &me("holy", WeaponId::Sword, 1.0));
    assert!(marked.is_finite() && marked < wish, "{marked} vs {wish}");
}

/// Green today (the five are catalog cards): the Rework pool additions keep a finite, risk-gated score.
#[test]
fn the_five_pool_additions_are_scored() {
    for (card, weapon) in [
        (CardId::Committed, WeaponId::Sword),
        (CardId::FistsOfFury, WeaponId::Fists),
        (CardId::MachineGun, WeaponId::Bow),
        (CardId::HereComesTheBoom, WeaponId::Sword),
        (CardId::RaceToZero, WeaponId::Sword),
    ] {
        let s = card_score(card.as_str(), &me("holy", weapon, 1.0));
        assert!(s.is_finite() && s > 1.0, "{card:?}: {s}");
    }
}
