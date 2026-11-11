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

/// The summary for one player; `None` when `id` is not seated.
pub fn build_summary(sim: &Sim, id: PlayerId) -> Option<BuildSummary> {
    sim.player(id)?;
    Some(BuildSummary::default())
}
