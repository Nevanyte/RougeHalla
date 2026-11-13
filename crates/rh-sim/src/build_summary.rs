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
        // The public camp-clear mirror legacy's HUD reads (`PlayerState.campClears`): 0 without the Bruiser installer.
        farm_ls += f64::from(crate::systems::bruiser::camp_clears(&sim.k, p))
            * crate::constants::HOLY_CAMP_LIFESTEAL_PER_CLEAR;
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
    /// P-WIRE17-HUD-2c, Fire: the roam move-speed bonus for the code-8 charge, `speed_mult(charge) - 1` (a fraction;
    /// legacy prints it x 100 as "% move speed"). Follows the charge, not the armed flag (legacy :116).
    RoamSpeedBonus,
    /// P-WIRE17-HUD-2c, Fire: the armed burst's raw physical damage, `FIRE_ROAM_BURST_BASE + AD_SHARE x max(0, Offense)`.
    RoamBurstDamage,
    /// P-WIRE17-HUD-2c, every champion: the card fold's hit multiplier (the `h` of codes 0-2).
    HitMult,
    /// P-WIRE17-HUD-2c, every champion: the weapon scaling's physical addition per hit, before the hit multiplier.
    ScalingPhysical,
    /// P-WIRE17-HUD-2c, every champion: the weapon scaling's magic addition per hit, before the hit multiplier.
    ScalingMagic,
}

/// How many panel codes exist (`PanelCode::ALL.len()`).
pub const PANEL_CODE_COUNT: usize = 28;

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
        PanelCode::RoamSpeedBonus,
        PanelCode::RoamBurstDamage,
        PanelCode::HitMult,
        PanelCode::ScalingPhysical,
        PanelCode::ScalingMagic,
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

/// The champion panel for one player; `None` when `id` is not seated. Read-only, allocation-free (stack array).
///
/// Legacy: `packages/client/src/ui/championCombatModel.ts:91-216` (auto row and passive row, value and scaling lines,
/// the auto tooltip's three per-hit components, the Fire roam charge). Codes 0-3 and 25-27 (P-WIRE17-HUD-2c) for every
/// champion, then exactly the owner's faction codes (Fire adds 23-24); units per code in the P-WIRE17-HUD-2 and -2c
/// briefs. Only the owner's own `Player` (and its own zombie) is read (C-OBS).
pub fn champion_panel(sim: &Sim, id: PlayerId) -> Option<ChampionPanel> {
    use crate::constants::{
        CHILL_MOVE_MULT, DUEL_PACE, FIRE_BURN_DPS, FROST_ELITE_GUARD_BONUS,
        HOLY_CAMP_LIFESTEAL_PER_CLEAR, MARK_KILL_PCT, PLAGUE_DPS,
    };
    use crate::modifiers::DEFINITION;
    use crate::stat_fold::MultKey;
    use crate::FactionId;
    use PanelCode as C;

    let p = sim.player(id)?;
    let mut panel = ChampionPanel::default();
    let Some(faction) = p.core.vitals.faction.faction_id() else {
        return Some(panel);
    };
    let m = p.core.modifiers.mirrors();
    let w = p.core.active_weapon();
    let f = crate::content::paced(faction);
    let bm = crate::content::weapon(w).dps_mult;
    // The card/farm fold's DoT mult only (legacy `folded.mults.dot`), not `Runtime::dot_mult()` (Plague crit fold).
    let dot = p.core.modifiers.mult_of(MultKey::Dot);
    let h = p.core.modifiers.hit_mult();
    let aps = 1. / crate::content::attack_interval(&f, w, m.as_mult);

    // Auto row (:96-113): raw per-hit components after the hit multiplier.
    let pk = crate::modifiers::packet(&p.core, w);
    panel.set(C::HitPhysical, pk.raw * pk.phys * h);
    panel.set(C::HitMagic, pk.raw * pk.magic * h);
    panel.set(C::HitTrue, pk.raw * pk.true_ * h);
    panel.set(C::AttacksPerSecond, aps);
    // Auto tooltip (:100-108, :128): the hit multiplier and the weapon scaling's additions before it, from the same
    // split the hit packet uses (paced sheet, unpaced base hp).
    let (scaling_phys, scaling_magic) =
        crate::modifiers::weapon_scaling(&p.core, w, &f, crate::content::faction(faction).hp);
    panel.set(C::HitMult, h);
    panel.set(C::ScalingPhysical, scaling_phys);
    panel.set(C::ScalingMagic, scaling_magic);

    let flag = |b: bool| if b { 1. } else { 0. };
    match faction {
        FactionId::Fire => {
            // Dragonslayer (:144-155) and Fire Roam (:114-116).
            let burn = (FIRE_BURN_DPS * DUEL_PACE * bm
                + DEFINITION.ap_dot_ratio * m.ap_bonus
                + DEFINITION.fire_ad_ratio * m.ad_bonus)
                * dot;
            panel.set(C::BurnDps, burn);
            panel.set(C::BurnSoRatio, DEFINITION.ap_dot_ratio);
            panel.set(C::BurnOffenseRatio, DEFINITION.fire_ad_ratio);
            panel.set(C::DotMult, dot);
            let charge = p.roam.last_combat_at.map_or(0., |last| {
                crate::systems::fire_roam::charge(sim.server_time() - last)
            });
            panel.set(C::RoamCharge, charge);
            panel.set(C::RoamArmed, flag(p.roam.ready));
            // :116 reads the charge, not the armed flag: armed after a reset shows 0 % (legacy pinned).
            panel.set(
                C::RoamSpeedBonus,
                crate::systems::fire_roam::speed_mult(charge) - 1.,
            );
            panel.set(
                C::RoamBurstDamage,
                crate::systems::fire_roam::burst_damage(m.ad_bonus),
            );
        }
        FactionId::Sentenced => {
            // Sentence (:157-175): a tier-1 near pulse as a fraction of target max hp.
            panel.set(C::MarkPulse, crate::modifiers::mark_pulse(p, w, 1., true));
            panel.set(C::MarkKillStack, MARK_KILL_PCT * DUEL_PACE);
        }
        FactionId::Plague => {
            // Rat King (:177-194).
            let disease = (PLAGUE_DPS * DUEL_PACE * bm
                + DEFINITION.plague_ap_per_hit * m.ap_bonus * aps)
                * dot;
            panel.set(C::DiseaseDps, disease);
            let stacks = p.farm.corpse_stacks();
            panel.set(C::CorpseStacks, f64::from(stacks));
            if stacks > 0 {
                let zombie = crate::systems::plague_zombies::zombie_of(&sim.w, id)
                    .and_then(|z| sim.w.mobs.get(z))
                    .filter(|z| z.status == crate::Status::Alive);
                if let Some(z) = zombie {
                    panel.set(C::ZombieHp, z.core.vitals.hp);
                    panel.set(C::ZombieMaxHp, z.core.vitals.max_hp);
                }
            }
        }
        FactionId::Frost => {
            // Ice wall (:196-203).
            panel.set(C::ChillSlow, 1. - crate::modifiers::frost_chill(&p.core));
            panel.set(C::ChillMoveSlow, 1. - CHILL_MOVE_MULT);
            panel.set(C::EliteGuardBonus, FROST_ELITE_GUARD_BONUS);
            panel.set(C::EliteGuardActive, flag(p.frost_guard.active));
        }
        FactionId::Holy => {
            // Radiant (:205-214), before card and mob leech.
            let max_hp = p.core.vitals.max_hp;
            let hp_frac = if max_hp > 0. {
                (p.core.vitals.hp / max_hp).clamp(0., 1.)
            } else {
                1.
            };
            let bloodthirst = p.build.count(crate::cards::CardId::Bloodthirst) > 0 && hp_frac < 0.5;
            // The public camp-clear mirror (`PlayerState.campClears`): 0 without the Bruiser installer.
            let clears = crate::systems::bruiser::camp_clears(&sim.k, p);
            let camp_leech = f64::from(clears)
                * HOLY_CAMP_LIFESTEAL_PER_CLEAR
                * if bloodthirst { 2. } else { 1. };
            panel.set(
                C::HolyLifeSteal,
                crate::content::holy_lifesteal_fraction(hp_frac) + camp_leech,
            );
            panel.set(C::HolyCampClears, f64::from(clears));
            panel.set(C::HolyCampLeech, camp_leech);
        }
    }
    Some(panel)
}
