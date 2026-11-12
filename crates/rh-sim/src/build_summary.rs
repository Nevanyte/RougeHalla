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

/// P-WIRE17-HUD-2: one number the legacy bottom-left champion panel prints
/// (`packages/client/src/ui/championCombatModel.ts:91-216`). The wire code is the variant index (append only; the
/// Wish row and other content numbers are appended by a later packet). Units per code: see the packet brief.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum PanelCode {
    /// Auto row: raw physical damage of one held-weapon hit (points).
    HitPhysical,
    /// Auto row: raw magic damage of one hit (points).
    HitMagic,
    /// Auto row: raw true damage of one hit (points).
    HitTrue,
    /// Auto row: attacks per second.
    AttacksPerSecond,
    /// Fire passive: burn magic damage per second.
    BurnDps,
    /// Fire passive: burn DPS per point of Soul Offense (content constant).
    BurnSoRatio,
    /// Fire passive: burn DPS per point of Offense (content constant).
    BurnOffenseRatio,
    /// Fire passive: the folded damage-over-time multiplier.
    DotMult,
    /// Fire: roam charge, 0..=1000.
    RoamCharge,
    /// Fire: the charged burst is armed (1) or not (0).
    RoamArmed,
    /// Sentenced passive: a tier-1 mark pulse as a fraction of the target's max hp per hit.
    MarkPulse,
    /// Sentenced passive: the mark share each kill stack adds (fraction of target max hp; content constant).
    MarkKillStack,
    /// Plague passive: disease magic damage per second.
    DiseaseDps,
    /// Plague: bodies eaten (corpse stacks).
    CorpseStacks,
    /// Plague: the living zombie's hp (present only while it lives and stacks > 0).
    ZombieHp,
    /// Plague: the living zombie's max hp (present with `ZombieHp`).
    ZombieMaxHp,
    /// Frost passive: the attack-speed slow, a fraction.
    ChillSlow,
    /// Frost passive: the move-speed slow, a fraction (content constant).
    ChillMoveSlow,
    /// Frost: Frozen Justice's Defense/Soul Defense bonus (content constant).
    EliteGuardBonus,
    /// Frost: Frozen Justice is active (1) or not (0).
    EliteGuardActive,
    /// Holy passive: faction share plus earned camp leech, a fraction.
    HolyLifeSteal,
    /// Holy: eligible camp clears.
    HolyCampClears,
    /// Holy: earned camp leech, a fraction (Bloodthirst doubles it below half health).
    HolyCampLeech,
}

/// How many panel codes exist (`PanelCode::ALL.len()`).
pub const PANEL_CODE_COUNT: usize = 23;

impl PanelCode {
    pub const ALL: [PanelCode; PANEL_CODE_COUNT] = [
        PanelCode::HitPhysical,
        PanelCode::HitMagic,
        PanelCode::HitTrue,
        PanelCode::AttacksPerSecond,
        PanelCode::BurnDps,
        PanelCode::BurnSoRatio,
        PanelCode::BurnOffenseRatio,
        PanelCode::DotMult,
        PanelCode::RoamCharge,
        PanelCode::RoamArmed,
        PanelCode::MarkPulse,
        PanelCode::MarkKillStack,
        PanelCode::DiseaseDps,
        PanelCode::CorpseStacks,
        PanelCode::ZombieHp,
        PanelCode::ZombieMaxHp,
        PanelCode::ChillSlow,
        PanelCode::ChillMoveSlow,
        PanelCode::EliteGuardBonus,
        PanelCode::EliteGuardActive,
        PanelCode::HolyLifeSteal,
        PanelCode::HolyCampClears,
        PanelCode::HolyCampLeech,
    ];
    /// Wire code (the variant index).
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn from_code(code: u8) -> Option<Self> {
        Self::ALL.get(usize::from(code)).copied()
    }
}

/// P-WIRE17-HUD-2: the owner's champion panel numbers, unrounded; a code is present only when the owner's faction
/// panel prints it. Stack array: building one never allocates.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChampionPanel {
    values: [Option<f64>; PANEL_CODE_COUNT],
}

impl ChampionPanel {
    pub fn get(&self, code: PanelCode) -> Option<f64> {
        self.values[code as usize]
    }
    pub fn set(&mut self, code: PanelCode, value: f64) {
        self.values[code as usize] = Some(value);
    }
    pub fn clear(&mut self, code: PanelCode) {
        self.values[code as usize] = None;
    }
    /// The present values in ascending code order.
    pub fn iter(&self) -> impl Iterator<Item = (PanelCode, f64)> + '_ {
        PanelCode::ALL
            .iter()
            .filter_map(|c| self.get(*c).map(|v| (*c, v)))
    }
    /// The present codes in ascending order.
    pub fn codes(&self) -> impl Iterator<Item = PanelCode> + '_ {
        self.iter().map(|(c, _)| c)
    }
}

/// The champion panel for one player; `None` when `id` is not seated. Read-only, allocation-free.
///
/// STUB (P-WIRE17-HUD-2): returns an empty panel for a seated player. The implementer fills every code the
/// player's faction panel prints (packet brief, "Field list").
pub fn champion_panel(sim: &Sim, id: PlayerId) -> Option<ChampionPanel> {
    sim.player(id)?;
    Some(ChampionPanel::default())
}
