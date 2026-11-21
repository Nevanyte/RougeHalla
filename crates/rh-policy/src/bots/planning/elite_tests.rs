//! P-AUG-BOTS-1 oracle: the planning maths reads the world's elite rule (a Rework elite's estimated hp and damage match
//! the sim's `EliteTuning`), and a regional mob and the Legacy rule are unchanged.
use super::*;
use rh_sim::mob_runtime::EliteTuning;
use rh_sim::EliteRule::{Legacy, Rework};

const FACTIONS: [FactionId; 3] = [FactionId::Fire, FactionId::Frost, FactionId::Plague];

fn near(x: f64, y: f64, what: &str) {
    assert!((x - y).abs() < 1e-9 * y.abs().max(1.), "{what}: {x} vs {y}");
}

#[test]
fn an_elite_is_scaled_by_the_rules_hp_and_damage() {
    let (l, r) = (EliteTuning::of(Legacy), EliteTuning::of(Rework));
    for f in FACTIONS {
        let (a, b) = (mob_faction(f, true, Legacy), mob_faction(f, true, Rework));
        near(b.hp / a.hp, r.hp_mult / l.hp_mult, "hp ratio");
        near(b.hit / a.hit, r.dmg_mult / l.dmg_mult, "damage ratio");
        // Absolute: the elite's hp is the faction hp x k x MOB_HP_MULT x the rule's hp multiplier (shared/mobs.ts).
        near(
            b.hp,
            rh_sim::content::faction(f).hp * r.k * MOB_HP_MULT * r.hp_mult,
            "rework hp",
        );
    }
}

#[test]
fn a_regional_mob_ignores_the_rule() {
    for f in FACTIONS {
        let (a, b) = (mob_faction(f, false, Legacy), mob_faction(f, false, Rework));
        assert_eq!((a.hp, a.hit), (b.hp, b.hit));
    }
}
