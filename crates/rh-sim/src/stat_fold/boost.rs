use crate::stat_fold::{
    default_definition, js, ChestBoostStat, StatFoldDefinition, StatKey, StatSums,
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BoostCounts {
    picks: [f64; 8],
}

impl BoostCounts {
    pub const fn from_source_values(picks: [f64; 8]) -> Self {
        Self { picks }
    }

    pub fn get(&self, stat: ChestBoostStat) -> f64 {
        self.picks[stat.index()]
    }

    pub fn set(&mut self, stat: ChestBoostStat, picks: f64) {
        self.picks[stat.index()] = picks;
    }

    pub fn source_values(&self) -> [f64; 8] {
        self.picks
    }
}

fn counted_picks(picks: f64, definition: &StatFoldDefinition) -> u32 {
    if !picks.is_finite() {
        return 0;
    }
    js::min(
        f64::from(definition.chest_boost_max_picks),
        js::max(0.0, picks.floor()),
    ) as u32
}

pub fn chest_boost_bonus(picks: f64) -> f64 {
    chest_boost_bonus_with_definition(picks, &default_definition())
}

pub fn chest_boost_bonus_with_definition(picks: f64, definition: &StatFoldDefinition) -> f64 {
    let n = counted_picks(picks, definition);
    let mut total = 0.0;
    let mut step = definition.chest_boost_step;
    for _ in 0..n {
        total += step;
        step *= definition.chest_boost_decay;
    }
    total
}

pub fn chest_boost_gain(stat: ChestBoostStat, picks: f64, current: f64) -> f64 {
    chest_boost_gain_with_definition(stat, picks, current, &default_definition())
}

pub fn chest_boost_gain_with_definition(
    stat: ChestBoostStat,
    picks: f64,
    current: f64,
    definition: &StatFoldDefinition,
) -> f64 {
    let boost = definition.chest_boost(stat);
    js::min(
        chest_boost_bonus_with_definition(picks, definition) * js::max(current, boost.floor),
        boost.ceiling * f64::from(counted_picks(picks, definition)),
    )
}

pub(crate) fn boost_base(
    stat: ChestBoostStat,
    sums: &StatSums,
    farm_sums: &StatSums,
    definition: &StatFoldDefinition,
) -> f64 {
    let key = StatKey::from(stat);
    let rows = match stat {
        ChestBoostStat::AttackSpeed => js::min(sums.attack_speed, definition.as_mult_cap - 1.0),
        ChestBoostStat::Lifesteal => js::min(sums.lifesteal, definition.lifesteal_cap),
        _ => sums.get(key),
    };
    rows + farm_sums.get(key)
}
