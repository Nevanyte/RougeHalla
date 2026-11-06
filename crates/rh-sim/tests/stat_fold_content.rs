//! Aggregate identity coverage for the exact kernel definition consumed by runtime.
use rh_sim::{
    content::{content_hash, content_hash_of_stat_fold_definition, REGISTRY, STAGGER_WEAPONS},
    stat_fold::{default_definition, StatFoldDefinition},
};
#[test]
fn every_stat_fold_policy_moves_the_aggregate_identity() {
    let base = default_definition();
    let hash =
        |d: &StatFoldDefinition| content_hash_of_stat_fold_definition(REGISTRY, STAGGER_WEAPONS, d);
    let baseline = hash(&base);
    assert_eq!(baseline, content_hash());
    let StatFoldDefinition {
        as_mult_cap: _,
        as_post_max: _,
        as_post_min: _,
        bonus_defense_cap: _,
        convert_ad_ap_cap: _,
        hp_race_cap: _,
        lifesteal_cap: _,
        max_hp_floor_share: _,
        move_bonus_cap: _,
        mod_mult_min: _,
        outgoing_row_cap: _,
        wish_cooldown_mult_min: _,
        mult_wire_per_unit: _,
        flat_wire_per_point: _,
        chest_boost_step: _,
        chest_boost_decay: _,
        chest_boost_max_picks: _,
        chest_boosts: _,
    } = base;
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            as_mult_cap: base.as_mult_cap + 1.0,
            ..base
        }),
        "as_mult_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            as_post_max: base.as_post_max + 1.0,
            ..base
        }),
        "as_post_max"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            as_post_min: base.as_post_min + 1.0,
            ..base
        }),
        "as_post_min"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            bonus_defense_cap: base.bonus_defense_cap + 1.0,
            ..base
        }),
        "bonus_defense_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            convert_ad_ap_cap: base.convert_ad_ap_cap + 1.0,
            ..base
        }),
        "convert_ad_ap_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            hp_race_cap: base.hp_race_cap + 1.0,
            ..base
        }),
        "hp_race_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            lifesteal_cap: base.lifesteal_cap + 1.0,
            ..base
        }),
        "lifesteal_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            max_hp_floor_share: base.max_hp_floor_share + 1.0,
            ..base
        }),
        "max_hp_floor_share"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            move_bonus_cap: base.move_bonus_cap + 1.0,
            ..base
        }),
        "move_bonus_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            mod_mult_min: base.mod_mult_min + 1.0,
            ..base
        }),
        "mod_mult_min"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            outgoing_row_cap: base.outgoing_row_cap + 1.0,
            ..base
        }),
        "outgoing_row_cap"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            wish_cooldown_mult_min: base.wish_cooldown_mult_min + 1.0,
            ..base
        }),
        "wish_cooldown_mult_min"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            mult_wire_per_unit: base.mult_wire_per_unit + 1.0,
            ..base
        }),
        "mult_wire_per_unit"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            flat_wire_per_point: base.flat_wire_per_point + 1.0,
            ..base
        }),
        "flat_wire_per_point"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            chest_boost_step: base.chest_boost_step + 1.0,
            ..base
        }),
        "chest_boost_step"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            chest_boost_decay: base.chest_boost_decay + 1.0,
            ..base
        }),
        "chest_boost_decay"
    );
    assert_ne!(
        baseline,
        hash(&StatFoldDefinition {
            chest_boost_max_picks: base.chest_boost_max_picks + 1,
            ..base
        }),
        "chest_boost_max_picks"
    );
    for i in 0..base.chest_boosts.len() {
        let rh_sim::stat_fold::ChestBoostDefinition {
            floor: _,
            ceiling: _,
        } = base.chest_boosts[i];
        let mut changed = base;
        changed.chest_boosts[i].floor += 1.0;
        assert_ne!(baseline, hash(&changed), "boost floor {i}");
        let mut changed = base;
        changed.chest_boosts[i].ceiling += 1.0;
        assert_ne!(baseline, hash(&changed), "boost ceiling {i}");
    }
    let mut changed = base;
    changed.chest_boosts.swap(0, 2);
    assert_ne!(baseline, hash(&changed), "boost definition order");
}
