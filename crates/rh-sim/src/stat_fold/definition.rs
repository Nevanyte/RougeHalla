use crate::stat_fold::ChestBoostStat;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChestBoostDefinition {
    pub floor: f64,
    pub ceiling: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatFoldDefinition {
    pub as_mult_cap: f64,
    pub as_post_max: f64,
    pub as_post_min: f64,
    pub bonus_defense_cap: f64,
    pub convert_ad_ap_cap: f64,
    pub hp_race_cap: f64,
    pub lifesteal_cap: f64,
    pub max_hp_floor_share: f64,
    pub move_bonus_cap: f64,
    pub mod_mult_min: f64,
    pub outgoing_row_cap: f64,
    pub wish_cooldown_mult_min: f64,
    pub mult_wire_per_unit: f64,
    pub flat_wire_per_point: f64,
    pub chest_boost_step: f64,
    pub chest_boost_decay: f64,
    pub chest_boost_max_picks: u32,
    pub chest_boosts: [ChestBoostDefinition; 8],
}

impl StatFoldDefinition {
    pub fn chest_boost(&self, stat: ChestBoostStat) -> ChestBoostDefinition {
        self.chest_boosts[stat.index()]
    }
}

impl Default for StatFoldDefinition {
    fn default() -> Self {
        Self {
            as_mult_cap: 1.5,
            as_post_max: 2.0,
            as_post_min: 0.5,
            bonus_defense_cap: 200.0,
            convert_ad_ap_cap: 60.0,
            hp_race_cap: 2.5,
            lifesteal_cap: 0.25,
            max_hp_floor_share: 0.5,
            move_bonus_cap: 0.3,
            mod_mult_min: 0.05,
            outgoing_row_cap: 2.5,
            wish_cooldown_mult_min: 0.5,
            mult_wire_per_unit: 1000.0,
            flat_wire_per_point: 10.0,
            chest_boost_step: 0.2,
            chest_boost_decay: 0.8,
            chest_boost_max_picks: 3,
            chest_boosts: [
                ChestBoostDefinition {
                    floor: 25.0,
                    ceiling: 9.0,
                },
                ChestBoostDefinition {
                    floor: 25.0,
                    ceiling: 9.0,
                },
                ChestBoostDefinition {
                    floor: 40.0,
                    ceiling: 11.0,
                },
                ChestBoostDefinition {
                    floor: 40.0,
                    ceiling: 11.0,
                },
                ChestBoostDefinition {
                    floor: 0.15,
                    ceiling: 0.065,
                },
                ChestBoostDefinition {
                    floor: 0.15,
                    ceiling: 0.065,
                },
                ChestBoostDefinition {
                    floor: 0.06,
                    ceiling: 0.04,
                },
                ChestBoostDefinition {
                    floor: 0.05,
                    ceiling: 0.035,
                },
            ],
        }
    }
}

pub fn default_definition() -> StatFoldDefinition {
    StatFoldDefinition::default()
}

pub fn visit_content(definition: &StatFoldDefinition, mut word: impl FnMut(u64)) {
    for value in [
        definition.as_mult_cap,
        definition.as_post_max,
        definition.as_post_min,
        definition.bonus_defense_cap,
        definition.convert_ad_ap_cap,
        definition.hp_race_cap,
        definition.lifesteal_cap,
        definition.max_hp_floor_share,
        definition.move_bonus_cap,
        definition.mod_mult_min,
        definition.outgoing_row_cap,
        definition.wish_cooldown_mult_min,
        definition.mult_wire_per_unit,
        definition.flat_wire_per_point,
        definition.chest_boost_step,
        definition.chest_boost_decay,
    ] {
        word(value.to_bits());
    }
    word(u64::from(definition.chest_boost_max_picks));
    for stat in ChestBoostStat::source_order() {
        let boost = definition.chest_boost(stat);
        word(boost.floor.to_bits());
        word(boost.ceiling.to_bits());
    }
}
