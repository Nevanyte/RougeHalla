//! The sole runtime modifier owner. Facts (cards/boosts) are separate from source-timed cached results.
pub mod farm;
mod rules;
pub use farm::Farm;
/// Serial integration seam used by the actual normal-kill producer.
#[allow(dead_code)]
pub(crate) fn grant_mob_stat(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    mob: crate::mob_catalog::MobTypeId,
    amount: u64,
) -> u64 {
    farm::grant_mob_stat(k, w, id, mob, amount)
}
pub(crate) mod hit_window;
use crate::stat_fold::{
    self as fold, EffectKind, FoldContext, MultSums, RowLocation, StatSums, WhileRow, WireMirrors,
};
pub use hit_window::HitWindow;
pub use rules::{visit_content, Definition, DEFINITION};
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Runtime {
    sums: [f64; 20],
    farm: [f64; 20],
    mults: [f64; 8],
    wire: [f64; 7],
    max_hp_mult: f64,
    /// Plague's dot-crit conversion (its DoT crit chance paid as steady DoT damage; 1 for everyone else).
    plague_dot: f64,
    /// Which of the build's `while` rows held at the last fold (source `Build.holds`), bit i for the i-th `while` row in
    /// build row order. The cached fold is only meaningful with them, so a restored runtime re-folds with exactly this.
    holds: u64,
    /// The folded source speed multiplier (legacy modSources' `speedMult`, e.g. Fire roam): the speed mirror is the
    /// build/farm fold times this, so the trusted-state check must know the exact contribution it validated against.
    source_speed: f64,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            sums: fold::zero_sums().source_values(),
            farm: fold::zero_sums().source_values(),
            mults: fold::identity_mults().source_values(),
            wire: fold::wire_identity_mirrors().source_values(),
            max_hp_mult: 1.,
            plague_dot: 1.,
            holds: 0,
            source_speed: 1.,
        }
    }
}
impl Runtime {
    #[cfg(test)]
    pub(crate) fn test_set_attack_wire(&mut self, value: f64) {
        self.wire[0] = value;
    }
    pub fn mirrors(&self) -> fold::StatMirrors {
        fold::decode_mirrors(&WireMirrors::from_source_values(self.wire))
    }
    pub fn attack_rate_wire(&self) -> f64 {
        self.wire[0]
    }
    pub fn wish_cooldown_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::WishCooldown)
    }
    /// The attacker's folded damage multiplier (legacy `hitMultOf`), used to normalize a recorded hit before a bleed.
    pub fn hit_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Hit)
    }

    /// The folded returned-damage multiplier (source `returnedMultOf`): a returned hit's share is scaled by it.
    pub fn returned_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Returned)
    }

    /// The folded critical-strike chance sum (source `sums.critChance`), before the noCrit flag and the cap.
    pub fn crit_chance(&self) -> f64 {
        StatSums::from_source_values(self.sums).crit_chance
    }

    pub fn dot_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Dot) * self.plague_dot
    }
    pub fn linger_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Linger)
    }
    pub(crate) fn valid(
        &self,
        build: &crate::cards::Build,
        farm: &Farm,
        base_hp: f64,
        faction: crate::FactionId,
    ) -> bool {
        if !build.valid()
            || !farm.valid()
            || !self
                .sums
                .iter()
                .chain(&self.farm)
                .chain(&self.mults)
                .chain(&self.wire)
                .chain([&self.max_hp_mult, &self.source_speed])
                .all(|x| x.is_finite())
        {
            return false;
        }
        // The fold depends on which `while` rows held (source Build.holds): the stored bits are the cache's input, so
        // re-fold with exactly them and demand the exact answer. Bits past the build's while rows are inert (the fold
        // never asks about those rows), which is harmless: they cannot buy any stat.
        let (rows, n) = build.rows(faction);
        let (bit_of, _) = while_bit_of(&rows[..n]);
        let holds = |loc: RowLocation, _: &WhileRow| {
            bit_of
                .get(loc.index)
                .is_some_and(|bit| *bit != NO_BIT && (self.holds >> *bit) & 1 == 1)
        };
        let (farm_rows, farm_len) = farm.rows();
        let boosts = fold::BoostCounts::from_source_values(build.boosts().map(f64::from));
        let folded = fold::fold_rows(
            &rows[..n],
            &FoldContext {
                base_max_hp: base_hp,
                farm_rows: &farm_rows[..farm_len],
                boosts: Some(&boosts),
                holds: Some(&holds),
                ..Default::default()
            },
        );
        if self.sums != folded.sums.source_values()
            || self.farm != folded.farm_sums.source_values()
            || self.mults != folded.mults.source_values()
            || self.max_hp_mult
                != fold::default_definition()
                    .max_hp_floor_share
                    .max(1. + folded.sums.max_hp + folded.farm_sums.max_hp)
        {
            return false;
        }
        // Quiet status updates deliberately leave the cached source mirrors stale until refold.
        // Validate the supported range, not equality with today's status table. The speed mirror also carries the folded
        // source speed (the source applies it before the wire encoding), so reproduce that exact product here.
        // `mirrors_from_fold` already adds the farm move speed; only the folded source product is still missing.
        let mut mirrors = fold::mirrors_from_fold(&folded);
        mirrors.speed_mult *= self.source_speed;
        let base = fold::encode_mirrors(&mirrors).source_values();
        self.wire.iter().all(|v| v.fract() == 0.)
            && self.wire[0] >= fold::encode_mult(0.)
            && self.wire[0] <= base[0]
            && self.wire[1] == base[1]
            && self.wire[2] == base[2]
            && self.wire[3] >= fold::encode_flat(-crate::constants::AXE_SHRED_CAP)
            && self.wire[3] <= base[3]
            && self.wire[4..] == base[4..]
    }
}
pub(crate) fn view(p: &crate::fighter::FighterCore) -> crate::status_runtime::StatView {
    let sums = StatSums::from_source_values(p.modifiers.sums);
    let farm = StatSums::from_source_values(p.modifiers.farm);
    crate::status_runtime::StatView {
        slow_resist: sums.get(fold::StatKey::SlowResist).clamp(0., 1.),
        buff_move: p.modifiers.mirrors().speed_mult,
        dot_mult: p.modifiers.dot_mult(),
        lifesteal_rows: sums.get(fold::StatKey::Lifesteal),
        lifesteal_mult: sums.get(fold::StatKey::LifestealMult),
        lifesteal_dot: sums.get(fold::StatKey::LifestealDot).max(0.),
        farm_lifesteal_rows: farm.get(fold::StatKey::Lifesteal).max(0.),
        heal_taken_mult: (1. + sums.get(fold::StatKey::HealTaken)).max(0.),
        ..Default::default()
    }
}
pub(crate) fn recompute(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    ix: crate::fighter::FighterIx,
) {
    recompute_with(k, w, ix, Default::default());
}
pub(crate) fn recompute_with(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    ix: crate::fighter::FighterIx,
    inputs: crate::status_runtime::stats::Inputs,
) {
    recompute_core(k, w, ix, inputs, &[]);
}

/// Re-folds one fighter's stats from its rows, the diagnostic overlay and every registered source, and stores the mirrors.
/// [`recompute_with`] is this with no overlay: production never carries rows outside a build.
fn recompute_core<'a>(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    ix: crate::fighter::FighterIx,
    inputs: crate::status_runtime::stats::Inputs,
    extra_rows: &[fold::EffectRow<'a>],
) {
    let build = if w.is_player(ix) {
        w.players[ix.slot()].build
    } else {
        Default::default()
    };
    let farm = if w.is_player(ix) {
        w.players[ix.slot()].farm
    } else {
        Farm::default()
    };
    let faction = w.core(ix).vitals.faction;
    let base_hp = crate::content::faction(faction).hp;
    let boosts = fold::BoostCounts::from_source_values(build.boosts().map(f64::from));
    let (rows, n) = build.rows(faction);
    let combined: Vec<fold::EffectRow<'_>>;
    let fold_rows: &[fold::EffectRow<'_>] = if extra_rows.is_empty() {
        &rows[..n]
    } else {
        combined = {
            let mut all: Vec<fold::EffectRow<'_>> = Vec::with_capacity(n + extra_rows.len());
            all.extend_from_slice(&rows[..n]);
            all.extend_from_slice(extra_rows);
            all
        };
        &combined
    };
    // Source Build.holds: ask each `while` row's condition once, from the fighter as it stands now (the source does the
    // same on every refold and again in its per-tick updateMods pass, which refolds only on a flip).
    let now = w.server_time;
    let is_player = w.is_player(ix);
    let (bit_of, _) = while_bit_of(fold_rows);
    let mut holds = 0u64;
    {
        let core = w.core(ix);
        for (i, row) in fold_rows.iter().enumerate() {
            let EffectKind::While(while_row) = row.kind else {
                continue;
            };
            let bit = bit_of.get(i).copied().unwrap_or(NO_BIT);
            if bit != NO_BIT && holds_now(now, core, is_player, &while_row) {
                holds |= 1u64 << bit;
            }
        }
    }
    let answers = |loc: RowLocation, _: &WhileRow| {
        bit_of
            .get(loc.index)
            .is_some_and(|bit| *bit != NO_BIT && (holds >> *bit) & 1 == 1)
    };
    let (farm_rows, farm_len) = farm.rows();
    let folded = fold::fold_rows(
        fold_rows,
        &FoldContext {
            base_max_hp: base_hp,
            farm_rows: &farm_rows[..farm_len],
            boosts: Some(&boosts),
            holds: Some(&answers),
            ..Default::default()
        },
    );
    let mut src = fold::SourceMods::default();
    for (_, source) in crate::schedule::Plan::of(k).mod_sources.live() {
        if let Some(m) = source(w, w.core(ix), inputs.view(w.core(ix))) {
            src.armor += m.armor.unwrap_or(0.);
            src.as_mult *= m.as_mult.unwrap_or(1.);
            src.speed_mult *= m.speed_mult.unwrap_or(1.);
            src.windup_mult *= m.windup_mult.unwrap_or(1.);
            src.shield += m.shield.unwrap_or(0.);
        }
    }
    // A running card boost (Adrenaline) multiplies the final mirrors; lapsed boosts contribute nothing.
    if w.is_player(ix) {
        let boost = w.players[ix.slot()].card_boost;
        if w.server_time < boost.until {
            src.as_mult *= boost.as_mult;
            src.speed_mult *= boost.move_mult;
        }
    }
    let efficiency = if w.is_player(ix) && w.core(ix).vitals.faction == crate::FactionId::Sentenced
    {
        DEFINITION.mark_as_efficiency
    } else {
        1.
    };
    let wire = fold::encode_mirrors(&fold::mirrors_from_fold_with_sources(
        &folded, &src, efficiency,
    ));
    // Plague turns its DoT crit chance into steady DoT damage.
    let plague_dot = if w.is_player(ix)
        && w.core(ix).vitals.faction == crate::FactionId::Plague
        && folded
            .flags
            .contains(crate::stat_fold::EffectFlag::PlagueDotCritConversion)
    {
        let chance = crate::status_runtime::stats::crit_chance(
            folded.sums.crit_chance,
            folded.flags.contains(crate::stat_fold::EffectFlag::NoCrit),
        );
        1. + chance * (crate::status_runtime::stats::CRIT_MULT - 1.)
    } else {
        1.
    };
    w.core_mut(ix).modifiers = Runtime {
        sums: folded.sums.source_values(),
        farm: folded.farm_sums.source_values(),
        mults: folded.mults.source_values(),
        wire: wire.source_values(),
        max_hp_mult: fold::default_definition()
            .max_hp_floor_share
            .max(1. + folded.sums.max_hp + folded.farm_sums.max_hp),
        plague_dot,
        source_speed: src.speed_mult,
        holds,
    };
}

/// The flattened rows one fold can read (`cards::MAX_FOLD_ROWS`) plus the small diagnostic overlay of the test-only
/// `setExtraRows` seam. A row past this bound (impossible for a real build) participates with its while answer off.
const MAX_FOLD_INPUT: usize = crate::cards::MAX_FOLD_ROWS + 4;
/// No `while` bit: an ordinary row, or a while row past the 64 the cached fold remembers.
const NO_BIT: u8 = u8::MAX;

/// For each flattened row, the bit of the build's `while` rows that names it (`NO_BIT` otherwise), in row order: bit i is
/// the i-th `while` row of the fold input (source `Build.whiles`). A real build's catalog rows are far below 64 while rows.
fn while_bit_of(rows: &[fold::EffectRow<'_>]) -> ([u8; MAX_FOLD_INPUT], u8) {
    let mut bit_of = [NO_BIT; MAX_FOLD_INPUT];
    let mut while_rows = 0u8;
    for (i, row) in rows.iter().enumerate() {
        if matches!(row.kind, EffectKind::While(_)) {
            if while_rows < 64 {
                if let Some(bit) = bit_of.get_mut(i) {
                    *bit = while_rows;
                }
            }
            while_rows = while_rows.saturating_add(1);
        }
    }
    (bit_of, while_rows)
}

/// Source `holdsNow`: does a `while` row's condition hold for this fighter now? `unarmed` needs a seated player's hands;
/// `afterCast` waits for the cast runtime (the shipped rows are status-gated away; source R6); `fightTime` waits for the
/// source fight clock (`mods.noteFights`), which no Rust state owns yet, so no such row holds.
fn holds_now(
    now: f64,
    core: &crate::fighter::FighterCore,
    is_player: bool,
    row: &WhileRow,
) -> bool {
    use crate::stat_fold::WhileCond;
    match row.cond {
        WhileCond::ChasingLock => core.weapon.targeting.target.is_some(),
        WhileCond::HpBelow => {
            core.vitals.max_hp > 0. && core.vitals.hp / core.vitals.max_hp < row.arg
        }
        WhileCond::AfterCast => false,
        WhileCond::NotShooting => {
            if core
                .weapon
                .action
                .is_some_and(|action| action.kind != crate::state::ActionKind::Swing)
            {
                return false;
            }
            core.weapon
                .last_shot_at
                .is_none_or(|shot| now - shot >= row.ms.unwrap_or(0.))
        }
        WhileCond::Unarmed => is_player && core.active_weapon() == crate::WeaponId::Fists,
        WhileCond::FightTime => false,
    }
}

/// Test-only projection of the source `setExtraRows` diagnostic seam: re-folds the fighter with `extra` rows on top of its
/// build (the G8 capture's out-of-build `maxHp` row). Production has no such rows; the caller syncs max hp itself, as the
/// source's seam does (`sim/buffs.ts syncMaxHp`).
#[cfg(test)]
pub(crate) fn refold_with_extra_rows(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    ix: crate::fighter::FighterIx,
    extra: &[fold::EffectRow<'_>],
) {
    recompute_core(k, w, ix, Default::default(), extra);
}
pub(crate) fn sync_max_hp(p: &mut crate::state::Player) {
    let max =
        crate::content::faction(p.vitals.faction).hp * p.modifiers.max_hp_mult + p.card_tank_hp;
    let delta = max - p.vitals.max_hp;
    if delta.abs() < 1e-9 {
        return;
    }
    p.vitals.max_hp = max;
    if p.vitals.hp > 0. {
        p.vitals.hp = max.min(p.vitals.hp + delta.max(0.));
    }
}

pub(crate) fn movement(
    w: &crate::state::World,
    p: &crate::fighter::FighterCore,
    _dt: f64,
    _stats: crate::status_runtime::StatView,
) -> f64 {
    if w.fighter_idx(p.id).is_some_and(|i| w.is_player(i)) {
        p.modifiers.mirrors().speed_mult
    } else {
        1.
    }
}
pub(crate) fn bonus_defense(p: &crate::fighter::FighterCore) -> f64 {
    let m = p.modifiers.mirrors();
    m.armor_bonus.max(0.) + m.shield_bonus
}
pub(crate) fn packet(
    p: &crate::fighter::FighterCore,
    weapon: crate::WeaponId,
) -> crate::state::Packet {
    packet_with_sheet(
        p,
        weapon,
        &crate::content::paced(p.vitals.faction),
        crate::content::faction(p.vitals.faction).hp,
    )
}
pub(crate) fn packet_with_sheet(
    p: &crate::fighter::FighterCore,
    weapon: crate::WeaponId,
    f: &crate::content::FactionSpec,
    base_max_hp: f64,
) -> crate::state::Packet {
    let m = p.modifiers.mirrors();
    let base = crate::content::damage_per_hit(f, weapon, m.as_mult);
    let shares = crate::content::damage_shares(f);
    let sc = DEFINITION.weapon_scaling[weapon.code() as usize];
    let per = m.as_mult * crate::content::attack_interval(f, weapon, m.as_mult);
    let hp = (p.vitals.max_hp - base_max_hp).max(0.);
    let ap_side = sc[4] != 0. && m.ap_bonus * sc[1] > m.ad_bonus * sc[0];
    let phys =
        ((if ap_side { 0. } else { sc[0] * m.ad_bonus }) + sc[2] * hp + sc[3] * bonus_defense(p))
            * per;
    let magic = if sc[4] == 0. || ap_side {
        sc[1] * m.ap_bonus * per
    } else {
        0.
    };
    if phys == 0. && magic == 0. {
        return crate::state::Packet {
            raw: base,
            phys: shares.phys,
            magic: shares.magic,
            true_: shares.true_,
        };
    }
    let total = base + phys + magic;
    if !(total > 0.) {
        return crate::state::Packet {
            raw: 0.,
            phys: shares.phys,
            magic: shares.magic,
            true_: shares.true_,
        };
    }
    crate::state::Packet {
        raw: total,
        phys: (base * shares.phys + phys) / total,
        magic: (base * shares.magic + magic) / total,
        true_: base * shares.true_ / total,
    }
}
pub(crate) fn frost_chill(p: &crate::fighter::FighterCore) -> f64 {
    let m = p.modifiers.mirrors();
    1. - crate::constants::FROST_SLOW
        - DEFINITION.frost_cap.min(
            DEFINITION.frost_sd * m.shield_bonus.max(0.)
                + DEFINITION.frost_as * (m.as_mult - 1.).max(0.),
        )
}
/// Source `hpRaceCapOf`: the folded `hpRace` mult (the Race to 0 ceiling; 0 for none).
pub(crate) fn hp_race_cap(core: &crate::fighter::FighterCore) -> f64 {
    MultSums::from_source_values(core.modifiers.mults).get(fold::MultKey::HpRace)
}

/// Source `hpRaceMult`: the hp-fraction multiplier of a Race to 0, capped.
pub(crate) fn hp_race_mult(hp_frac: f64, cap: f64) -> f64 {
    let ceiling = cap.clamp(1., crate::constants::HP_RACE_CAP);
    if !(hp_frac > 0.) {
        return ceiling;
    }
    (1. / hp_frac).max(1.).min(ceiling)
}

/// Source `outgoingExecuteShare`: the share of an entry's outgoing multiplier that the attacker's `vs hpBelow` rows
/// contribute (0 without them, never above 1) — what a tier-4 mark denies (R7).
pub(crate) fn execute_share(
    core: &crate::fighter::FighterCore,
    build: &crate::cards::Build,
    victim_frac: f64,
    kind: OutgoingKind,
    baked: f64,
) -> f64 {
    let has = build.cards().any(|id| {
        id.definition()
            .rows
            .iter()
            .any(|r| matches!(r, crate::cards::CardRow::Vs(v) if matches!(v.test, crate::cards::VsTest::HpBelow)))
    });
    if !has {
        return 0.;
    }
    let full = outgoing_damage(
        core,
        build,
        victim_frac,
        kind,
        baked,
        0,
        VsProbe::default(),
        false,
    );
    if !(full > 0.) {
        return 0.;
    }
    let without = outgoing_damage(
        core,
        build,
        victim_frac,
        kind,
        baked,
        0,
        VsProbe::default(),
        true,
    );
    (1. - without / full).clamp(0., 1.)
}

pub(crate) fn mark_pulse(
    p: &crate::state::Player,
    w: crate::WeaponId,
    target_hp: f64,
    near: bool,
) -> f64 {
    let m = p.modifiers.mirrors();
    let f = crate::content::paced(crate::FactionId::Sentenced);
    let weight = f.rate
        * crate::content::weapon(w).dps_mult
        * m.as_mult
        * crate::content::attack_interval(&f, w, m.as_mult);
    let sum = [
        m.ad_bonus,
        DEFINITION.mark_ap_weight * m.ap_bonus,
        m.armor_bonus,
        m.shield_bonus,
    ]
    .into_iter()
    .map(|v| v.max(0.))
    .fold(0., |a, b| a + b);
    // Heavier Sentence: the mark share grows with the owner's bonus max hp relative to its base.
    let heavier = if p
        .build
        .has_flag(crate::stat_fold::EffectFlag::HeavierSentence)
    {
        let base = crate::content::faction(p.vitals.faction).hp;
        if base > 0. {
            1. + crate::constants::HEAVIER_SENTENCE_PER_BONUS
                * ((p.vitals.max_hp - base).max(0.) / base)
        } else {
            1.
        }
    } else {
        1.
    };
    let pct = (crate::constants::MARK_BASE_PCT * crate::constants::DUEL_PACE
        + crate::constants::MARK_KILL_PCT
            * crate::constants::DUEL_PACE
            * f64::from(p.credit.sentence))
        * (1. + DEFINITION.mark_bonus * sum)
        * heavier;
    pct * target_hp
        * weight
        * if near {
            1.
        } else {
            crate::constants::MARK_FAR_SHARE
        }
}

fn fold_build(
    build: &crate::cards::Build,
    farm: &Farm,
    base: f64,
    faction: crate::FactionId,
    holds: Option<&fold::WhileAnswer<'_>>,
) -> fold::Folded {
    let (rows, n) = build.rows(faction);
    let boosts = fold::BoostCounts::from_source_values(build.boosts().map(f64::from));
    {
        let (farm_rows, len) = farm.rows();
        fold::fold_rows(
            &rows[..n],
            &FoldContext {
                base_max_hp: base,
                farm_rows: &farm_rows[..len],
                boosts: Some(&boosts),
                holds,
                ..Default::default()
            },
        )
    }
}
/// Conservative supported-source envelope for snapshots fired before the present build/refold. It folds the all-cards build
/// under both while assignments and keeps the largest packet: whichever way a build's conditional rows land, a real packet
/// is at most this (the rows only add attack speed and damage when they hold).
pub(crate) fn maximum_packet(weapon: crate::WeaponId) -> f64 {
    let build = crate::cards::Build {
        counts: {
            let mut counts = crate::cards::Counts::default();
            for id in crate::cards::SUPPORTED {
                counts.0[id.index()] = 1;
            }
            counts
        },
        boosts: [crate::stat_fold::default_definition().chest_boost_max_picks as u8; 8],
    };
    let farm = Farm::maximum();
    let mut out = 0f64;
    for all_while in [false, true] {
        let holds = |_: RowLocation, _: &WhileRow| all_while;
        for id in crate::FactionId::ALL {
            let f = crate::content::paced(id);
            let base_hp = crate::content::faction(id).hp;
            let folded = fold_build(&build, &farm, base_hp, id, Some(&holds));
            let m = fold::decode_mirrors(&fold::encode_mirrors(&fold::mirrors_from_fold(&folded)));
            let rate = m.as_mult.max(fold::cap_as_mult(f64::MAX));
            let interval = crate::content::attack_interval(&f, weapon, rate);
            let sc = DEFINITION.weapon_scaling[weapon.code() as usize];
            // Summing both dominant sides is conservative; every real snapshot is <= this envelope.
            let packet = crate::content::damage_per_hit(&f, weapon, rate)
                + (sc[0] * m.ad_bonus
                    + sc[1] * m.ap_bonus
                    + sc[2] * (folded.max_hp - base_hp).max(0.)
                    + sc[3] * (m.armor_bonus.max(0.) + m.shield_bonus))
                    * rate
                    * interval;
            out = out.max(packet);
        }
    }
    out
}

/// The damage kind of an entry (source `OutgoingKind`), for the outgoing row cap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OutgoingKind {
    Hit,
    Dot,
    Returned,
    Other,
}

/// The probe answers a `vs` row needs beyond the victim's hp fraction (source `VsProbe`).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct VsProbe {
    pub slowed: bool,
    pub elite: bool,
    pub higher_power: bool,
    pub player: bool,
    pub third_party: bool,
}

fn vs_holds(v: &crate::cards::VsRow, frac: f64, streak: u16, probe: VsProbe) -> bool {
    use crate::cards::VsTest;
    match v.test {
        VsTest::Elite => probe.elite,
        VsTest::HigherPower => probe.higher_power,
        VsTest::Slowed => probe.slowed,
        VsTest::Streak => f64::from(streak) <= v.arg,
        VsTest::ThirdParty => probe.third_party,
        VsTest::HpBelow => frac < v.arg,
        VsTest::PlayerAbove => probe.player && frac > v.arg,
    }
}

/// Source `outgoingMult`: what a hit deals before armor and shield, as (1 + the damage sums + holding vs rows + the
/// stepped scale rows), G1-capped so the row multiplier times the entry's own kind mult never passes OUTGOING_ROW_CAP; farm
/// damage is added outside the cap. Camps-cleared scales need the unported camp counter and contribute nothing yet.
#[allow(clippy::too_many_arguments)]
pub(crate) fn outgoing_damage(
    p: &crate::fighter::FighterCore,
    build: &crate::cards::Build,
    victim_frac: f64,
    kind: OutgoingKind,
    baked: f64,
    streak: u16,
    probe: VsProbe,
    skip_execute: bool,
) -> f64 {
    let sums = StatSums::from_source_values(p.modifiers.sums);
    let mults = MultSums::from_source_values(p.modifiers.mults);
    let own = match kind {
        OutgoingKind::Hit => mults.get(fold::MultKey::Hit),
        OutgoingKind::Dot => mults.get(fold::MultKey::Dot),
        OutgoingKind::Returned => mults.get(fold::MultKey::Returned),
        OutgoingKind::Other => 1.,
    } * (if baked > 0. { baked } else { 1. });
    let ceiling = if own > 1. {
        crate::constants::OUTGOING_ROW_CAP / own
    } else {
        crate::constants::OUTGOING_ROW_CAP
    };
    let farm = StatSums::from_source_values(p.modifiers.farm).damage;
    let mut sum = sums.damage;
    let mut any_rows = sums.damage != 0.;
    for id in build.cards() {
        for row in id.definition().rows {
            match row {
                crate::cards::CardRow::Vs(v) => {
                    any_rows = true;
                    if !(skip_execute && matches!(v.test, crate::cards::VsTest::HpBelow))
                        && vs_holds(v, victim_frac, streak, probe)
                    {
                        sum += v.v;
                    }
                }
                crate::cards::CardRow::Scale(s) => {
                    any_rows = true;
                    let bonus = match s.src {
                        crate::cards::ScaleSrc::Streak => {
                            s.per * (f64::from(streak) / s.step + 1e-9).floor()
                        }
                        crate::cards::ScaleSrc::CampsCleared => 0.,
                    };
                    sum += if bonus > s.cap { s.cap } else { bonus };
                }
                _ => {}
            }
        }
    }
    if !any_rows {
        return 1f64.min(ceiling).max(0.) + farm;
    }
    (1. + sum).min(ceiling).max(0.) + farm
}

#[cfg(test)]
mod race_tests {
    use super::hp_race_mult;

    #[test]
    fn the_race_multiplier_is_the_inverse_hp_fraction_capped() {
        assert!((hp_race_mult(1.0, 2.5) - 1.0).abs() < 1e-12);
        assert!((hp_race_mult(0.5, 2.5) - 2.0).abs() < 1e-12);
        assert!((hp_race_mult(0.2, 2.5) - 2.5).abs() < 1e-12, "capped");
        assert!((hp_race_mult(0.8, 1.2) - 1.2).abs() < 1e-12);
    }
}

#[cfg(test)]
mod plague_tests {
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    #[test]
    fn plague_turns_dot_crit_chance_into_steady_dot_damage() {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Plague,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::CruelWounds
        ));
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let p = &sim.w.players[i];
        assert!(
            (p.modifiers.crit_chance() - 0.2).abs() < 1e-9,
            "the plague column keeps the crit chance"
        );
        assert!(
            (p.modifiers.dot_mult() - 1.1).abs() < 1e-9,
            "conversion: 1 + 0.2 x 0.5, dot {}",
            p.modifiers.dot_mult()
        );
    }

    #[test]
    fn a_non_plague_keeps_its_dot_crit() {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        let mut sim = Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        );
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::CruelWounds
        ));
        let i = sim.w.idx(PlayerId(1)).unwrap();
        assert!((sim.w.players[i].modifiers.dot_mult() - 1.0).abs() < 1e-9);
    }
}

#[cfg(test)]
mod guard_tests {
    use crate::modifiers::{outgoing_damage, OutgoingKind, VsProbe};
    use crate::{arenas, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

    fn setup() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(400., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(456., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        Sim::reset_active(
            SimConfig::default(),
            arenas::practice_arena(),
            Secrets::from_seed(7),
            &ps,
        )
    }

    #[test]
    fn the_outgoing_row_cap_holds_against_boom_and_glass_cannon() {
        let mut sim = setup();
        for card in [
            crate::cards::CardId::HereComesTheBoom,
            crate::cards::CardId::GlassCannon,
            crate::cards::CardId::FirstImpressions,
            crate::cards::CardId::TunnelVision,
        ] {
            assert!(crate::cards::grant(&sim.k, &mut sim.w, PlayerId(1), card));
        }
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let p = &sim.w.players[i];
        let row = |victim_frac: f64| {
            outgoing_damage(
                &p.core,
                &p.build,
                victim_frac,
                OutgoingKind::Hit,
                1.,
                0,
                VsProbe::default(),
                false,
            )
        };
        // Boom's own x2.5 already fills the cap, so the rows cannot add anything.
        for frac in [0.5, 0.9, 1.0] {
            assert!(
                row(frac) <= 1. + 1e-9,
                "frac {frac}: row {row}",
                row = row(frac)
            );
        }
    }

    #[test]
    fn a_cached_while_hold_is_validated_against_its_bits() {
        // Bloodthirst's while row folds only below half health. The runtime caches which rows held (source Build.holds) and
        // `valid` re-folds with exactly those bits, so a checkpoint cannot claim the doubled rows without the bit.
        let mut sim = setup();
        let i = sim.w.idx(PlayerId(1)).unwrap();
        let hp = sim.w.players[i].vitals.max_hp * 0.2;
        sim.w.players[i].vitals.hp = hp;
        assert!(crate::cards::grant(
            &sim.k,
            &mut sim.w,
            PlayerId(1),
            crate::cards::CardId::Bloodthirst
        ));
        let valid = |p: &crate::state::Player| {
            p.modifiers.valid(
                &p.build,
                &p.farm,
                crate::content::faction(p.vitals.faction).hp,
                p.vitals.faction,
            )
        };
        let p = &sim.w.players[i];
        assert_eq!(p.modifiers.holds, 1, "the row held below half health");
        assert!(valid(p), "the honest fold validates");
        let mut damaged = p.clone();
        damaged.modifiers.holds = 0;
        assert!(
            !valid(&damaged),
            "a fold without the hold bit is not a legal cache"
        );
    }

    #[test]
    fn the_pvp_hit_and_dot_caps_clamp_each_source() {
        // The caps read the victim's max hp: a player hitting a player is cut to the hit share, and one source's dots to
        // the dot budget.
        let share = crate::constants::PVP_HIT_CAP_SHARE;
        let budget = crate::constants::PVP_DOT_CAP_SHARE;
        assert!(share > 0. && share < 1.);
        assert!(budget > 0. && budget < 1.);
        let max_hp = 3000.;
        let hit_cap = share * max_hp;
        let dot_cap = budget * max_hp * 0.05;
        assert!(
            hit_cap < max_hp && dot_cap < hit_cap,
            "the dot budget is the tighter cap"
        );
    }
}
