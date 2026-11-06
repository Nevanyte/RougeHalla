use super::boost::boost_base;
use crate::stat_fold::{
    chest_boost_gain_with_definition, default_definition, js, requirements_met, BoostCounts,
    ChestBoostStat, ConvertFrom, EffectKind, EffectRow, FlagSet, MultKey, MultSums, RowList,
    RowLocation, StatFoldDefinition, StatKey, StatSums, WhileRow,
};

pub type WhileAnswer<'a> = dyn Fn(RowLocation, &WhileRow) -> bool + 'a;

pub struct FoldContext<'a> {
    pub owns: Option<&'a dyn Fn(&str) -> bool>,
    pub holds: Option<&'a WhileAnswer<'a>>,
    pub base_max_hp: f64,
    pub farm_rows: &'a [EffectRow<'a>],
    pub boosts: Option<&'a BoostCounts>,
}

impl Default for FoldContext<'_> {
    fn default() -> Self {
        Self {
            owns: None,
            holds: None,
            base_max_hp: 0.0,
            farm_rows: &[],
            boosts: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Folded {
    pub plain: StatSums,
    pub sums: StatSums,
    pub farm_sums: StatSums,
    pub mults: MultSums,
    pub flags: FlagSet,
    pub max_hp: f64,
}

pub fn zero_sums() -> StatSums {
    StatSums::default()
}

pub fn identity_mults() -> MultSums {
    MultSums::default()
}

pub fn add_to_sums(sums: &mut StatSums, stat: StatKey, v: f64) {
    if stat.is_product() {
        sums.set(stat, sums.get(stat) * (1.0 + v));
    } else {
        sums.set(stat, sums.get(stat) + v);
    }
}

pub fn fold_stat_rows(effects: &[EffectRow<'_>], ctx: &FoldContext<'_>) -> StatSums {
    fold_stat_rows_at(effects, ctx, RowList::Effects)
}

fn fold_stat_rows_at(effects: &[EffectRow<'_>], ctx: &FoldContext<'_>, list: RowList) -> StatSums {
    let mut sums = zero_sums();
    for (index, row) in effects.iter().enumerate() {
        let (stat, v) = match row.kind {
            EffectKind::Stat { stat, v } => (StatKey::from(stat), v),
            EffectKind::Flat { stat, v } => (StatKey::from(stat), v),
            EffectKind::While(while_row) => (while_row.stat, while_row.v),
            _ => continue,
        };
        if !requirements_met(row, ctx.owns) {
            continue;
        }
        if let EffectKind::While(while_row) = row.kind {
            let holds = ctx
                .holds
                .is_some_and(|holds| holds(RowLocation::new(list, index), &while_row));
            if !holds {
                continue;
            }
        }
        add_to_sums(&mut sums, stat, v);
    }
    sums
}

pub fn folded_max_hp(base_max_hp: f64, max_hp_sum: f64) -> f64 {
    folded_max_hp_with_definition(base_max_hp, max_hp_sum, &default_definition())
}

pub fn folded_max_hp_with_definition(
    base_max_hp: f64,
    max_hp_sum: f64,
    definition: &StatFoldDefinition,
) -> f64 {
    if base_max_hp > 0.0 {
        base_max_hp * js::max(definition.max_hp_floor_share, 1.0 + max_hp_sum)
    } else {
        0.0
    }
}

fn convert_input(
    from: ConvertFrom,
    plain: &StatSums,
    farm: &StatSums,
    max_hp: f64,
    definition: &StatFoldDefinition,
) -> f64 {
    match from {
        ConvertFrom::Ad => plain.ad + farm.ad,
        ConvertFrom::MaxHp => max_hp,
        ConvertFrom::BonusAttackSpeed => js::max(
            0.0,
            js::min(
                plain.attack_speed + farm.attack_speed,
                definition.as_mult_cap - 1.0,
            ),
        ),
        ConvertFrom::BonusMoveSpeed => js::max(
            0.0,
            js::min(
                plain.move_speed + farm.move_speed,
                definition.move_bonus_cap,
            ),
        ),
    }
}

pub fn fold_rows(effects: &[EffectRow<'_>], ctx: &FoldContext<'_>) -> Folded {
    fold_rows_with_definition(effects, ctx, &default_definition())
}

pub fn fold_rows_with_definition(
    effects: &[EffectRow<'_>],
    ctx: &FoldContext<'_>,
    definition: &StatFoldDefinition,
) -> Folded {
    let plain = fold_stat_rows_at(effects, ctx, RowList::Effects);
    let mut farm_sums = fold_stat_rows_at(ctx.farm_rows, ctx, RowList::Farm);
    let mut max_hp =
        folded_max_hp_with_definition(ctx.base_max_hp, plain.max_hp + farm_sums.max_hp, definition);
    let mut mults = identity_mults();
    let mut flags = FlagSet::default();
    let mut conv = zero_sums();

    for row in effects {
        if !matches!(
            row.kind,
            EffectKind::Convert { .. } | EffectKind::Mult { .. } | EffectKind::Flag { .. }
        ) {
            continue;
        }
        if !requirements_met(row, ctx.owns) {
            continue;
        }
        match row.kind {
            EffectKind::Mult { key, v } => mults.set(key, mults.get(key) * v),
            EffectKind::Flag { flag } => flags.insert(flag),
            EffectKind::Convert { from, to, per, cap } => {
                let target = to.stat_key();
                if target.is_product() {
                    continue;
                }
                let mut out = per * convert_input(from, &plain, &farm_sums, max_hp, definition);
                if let Some(cap) = cap {
                    if out > cap {
                        out = cap;
                    }
                }
                conv.set(target, conv.get(target) + out);
            }
            _ => unreachable!(),
        }
    }

    if conv.ad > definition.convert_ad_ap_cap {
        conv.ad = definition.convert_ad_ap_cap;
    }
    if conv.ap > definition.convert_ad_ap_cap {
        conv.ap = definition.convert_ad_ap_cap;
    }

    let mut sums = zero_sums();
    for key in StatKey::source_order() {
        sums.set(
            key,
            if key.is_product() {
                plain.get(key)
            } else {
                plain.get(key) + conv.get(key)
            },
        );
    }
    if sums.armor > definition.bonus_defense_cap {
        sums.armor = definition.bonus_defense_cap;
    }
    if sums.shield > definition.bonus_defense_cap {
        sums.shield = definition.bonus_defense_cap;
    }
    if sums.move_speed > definition.move_bonus_cap {
        sums.move_speed = definition.move_bonus_cap;
    }

    if mults.hit > definition.outgoing_row_cap {
        mults.hit = definition.outgoing_row_cap;
    }
    if mults.as_post < definition.as_post_min {
        mults.as_post = definition.as_post_min;
    } else if mults.as_post > definition.as_post_max {
        mults.as_post = definition.as_post_max;
    }
    if mults.wish_cooldown < definition.wish_cooldown_mult_min {
        mults.wish_cooldown = definition.wish_cooldown_mult_min;
    }
    if mults.hp_race > definition.hp_race_cap {
        mults.hp_race = definition.hp_race_cap;
    }
    for key in MultKey::source_order() {
        if !(mults.get(key) >= 0.0) {
            mults.set(key, 0.0);
        }
    }
    sums.ap *= mults.ap;
    farm_sums.ap *= mults.ap;

    if let Some(boosts) = ctx.boosts {
        let mut gains = [None; 8];
        for stat in ChestBoostStat::source_order() {
            let picks = boosts.get(stat);
            if picks > 0.0 {
                gains[stat.index()] = Some(chest_boost_gain_with_definition(
                    stat,
                    picks,
                    boost_base(stat, &sums, &farm_sums, definition),
                    definition,
                ));
            }
        }
        for stat in ChestBoostStat::source_order() {
            let key = StatKey::from(stat);
            farm_sums.set(key, farm_sums.get(key) + gains[stat.index()].unwrap_or(0.0));
        }
        if gains[ChestBoostStat::MaxHp.index()].is_some_and(|gain| gain != 0.0 && !gain.is_nan()) {
            max_hp = folded_max_hp_with_definition(
                ctx.base_max_hp,
                plain.max_hp + farm_sums.max_hp,
                definition,
            );
        }
    }

    Folded {
        plain,
        sums,
        farm_sums,
        mults,
        flags,
        max_hp,
    }
}
