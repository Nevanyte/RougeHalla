//! P-AUG-BOTS-1 oracle: a remembered elite's max-hp estimate follows the world's elite rule.
use super::*;
use rh_sim::mob_runtime::EliteTuning;
use rh_sim::EliteRule::{Legacy, Rework};

#[test]
fn a_remembered_elite_has_the_rules_hp() {
    for zone in [FactionId::Fire, FactionId::Frost, FactionId::Plague] {
        for rule in [Legacy, Rework] {
            let t = EliteTuning::of(rule);
            let want = rh_sim::content::faction(zone).hp * t.k * MOB_HP_MULT * t.hp_mult;
            let got = mob_max_hp(Some(zone), true, None, rule);
            assert!(
                (got - want).abs() < 1e-9 * want,
                "{zone:?} {rule:?}: {got} vs {want}"
            );
        }
        let regional = rh_sim::content::faction(zone).hp * MOB_K * MOB_HP_MULT;
        assert_eq!(mob_max_hp(Some(zone), false, None, Rework), regional);
    }
}
