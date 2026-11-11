//! The legacy top-left GAINED strip values for one player, assembled from the sim's own folds (read-only, pure).
//!
//! Legacy source of truth: `packages/client/src/ui/buildModel.ts` `buildGains` (+ `cardLifesteal`), the mob rows
//! from `packages/shared/src/mobStats.ts` `mobStatRows`/`mobStatText`. Not part of the tick: it runs outside the
//! schedule, adds no state, RNG draw, observation or wire field.
//!
//! Units: fractions, not percent (0.19 = +19%); Offense/SO/Defense/Soul Defense/health in points. Values are unrounded
//! (display rounding is the client's); the hp-dependent life steal is the raw value for the current hp.
use crate::mob_catalog::MobTypeId;
use crate::modifiers::farm::RewardStat;
use crate::{PlayerId, Sim};

/// One owned normal-mob type in the "Mob bonuses" list: its stacks and the cumulative reward they earned.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MobBonusRow {
    pub mob: MobTypeId,
    pub stacks: u64,
    pub stat: RewardStat,
    /// `reward.value * stacks`: a fraction for a percent stat, points for a flat one.
    pub total: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BuildSummary {
    /// +Offense (mirror `ad_bonus`).
    pub offense: f64,
    /// +SO (mirror `ap_bonus`).
    pub soul_offense: f64,
    /// Unconditional generic damage, a fraction (may be negative).
    pub damage: f64,
    /// Attack-speed change, `as_mult - 1`.
    pub attack_speed: f64,
    /// Life steal from cards, farmed mobs and Holy's camp term; faction base leech excluded.
    pub life_steal: f64,
    /// Max hp above the faction baseline, never negative.
    pub health: f64,
    /// +/-Defense (mirror `armor_bonus`).
    pub defense: f64,
    /// +/-Soul Defense (mirror `shield_bonus`).
    pub soul_defense: f64,
    /// Move-speed change, `speed_mult - 1`.
    pub move_speed: f64,
    /// Owned mob types in catalog order; unowned slots are `None`.
    pub mob_rows: [Option<MobBonusRow>; 20],
}

impl BuildSummary {
    pub fn mob_row_count(&self) -> usize {
        self.mob_rows.iter().filter(|r| r.is_some()).count()
    }
}

/// The summary for one player; `None` when `id` is not seated. Read-only; allocation-free (stack arrays only).
pub fn build_summary(sim: &Sim, id: PlayerId) -> Option<BuildSummary> {
    use crate::cards::CardId;
    use crate::modifiers::farm::DEFINITION;
    use crate::stat_fold::{EffectKind, EffectStat};

    let p = sim.player(id)?;
    let m = p.core.modifiers.mirrors();
    let faction = p.core.vitals.faction.faction_id();
    let mut s = BuildSummary {
        offense: m.ad_bonus,
        soul_offense: m.ap_bonus,
        attack_speed: m.as_mult - 1.,
        defense: m.armor_bonus,
        soul_defense: m.shield_bonus,
        move_speed: m.speed_mult - 1.,
        ..Default::default()
    };
    if let Some(f) = faction {
        s.health = (p.core.vitals.max_hp - crate::content::faction(f).hp).max(0.);
    }

    // Mob bonuses and the farm's damage / lifesteal rows (legacy mobStatRows), catalog order.
    let mut damage = 0.;
    let mut farm_ls = 0.;
    for (slot, r) in DEFINITION.rows.iter().enumerate() {
        let stacks = p.farm.count(r.mob);
        if stacks == 0 {
            continue;
        }
        let total = r.value * stacks as f64;
        s.mob_rows[slot] = Some(MobBonusRow {
            mob: r.mob,
            stacks,
            stat: r.stat,
            total,
        });
        match r.stat {
            RewardStat::Stat(EffectStat::Damage) => damage += total,
            RewardStat::Stat(EffectStat::Lifesteal) => farm_ls += total,
            _ => {}
        }
    }

    // Card rows (already repeated once per copy). Damage counts unconditional rows only; lifesteal counts them all.
    let mut ls_rows = 0.;
    if let Some(f) = faction {
        let (rows, n) = p.build.rows(f);
        for row in &rows[..n] {
            if let EffectKind::Stat { stat, v } = row.kind {
                match stat {
                    EffectStat::Damage if row.requires.is_empty() && !row.needs_status => {
                        damage += v
                    }
                    EffectStat::Lifesteal => ls_rows += v,
                    _ => {}
                }
            }
        }
    }
    s.damage = damage;

    let holy = faction == Some(crate::FactionId::Holy);
    if holy {
        farm_ls += f64::from(p.camps_cleared) * crate::constants::HOLY_CAMP_LIFESTEAL_PER_CLEAR;
    }
    let max_hp = p.core.vitals.max_hp;
    let hp_frac = if max_hp > 0. {
        p.core.vitals.hp / max_hp
    } else {
        1.
    };
    let mult = if p.build.count(CardId::Bloodthirst) > 0 && hp_frac < 0.5 {
        2.
    } else {
        1.
    };
    let rows = if holy {
        ls_rows * crate::status_runtime::stats::HOLY_LEECH_ROW_MULT
    } else {
        ls_rows
    };
    s.life_steal = crate::status_runtime::stats::lifesteal_total(0., rows, mult, 0., farm_ls);
    Some(s)
}
