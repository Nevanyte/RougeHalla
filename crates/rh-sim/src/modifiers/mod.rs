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
use crate::stat_fold::{self as fold, FoldContext, MultSums, StatSums, WireMirrors};
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
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            sums: fold::zero_sums().source_values(),
            farm: fold::zero_sums().source_values(),
            mults: fold::identity_mults().source_values(),
            wire: fold::wire_identity_mirrors().source_values(),
            max_hp_mult: 1.,
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

    pub fn dot_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Dot)
    }
    pub fn linger_mult(&self) -> f64 {
        MultSums::from_source_values(self.mults).get(fold::MultKey::Linger)
    }
    pub(crate) fn valid(&self, build: &crate::cards::Build, farm: &Farm, base_hp: f64) -> bool {
        if !build.valid()
            || !farm.valid()
            || !self
                .sums
                .iter()
                .chain(&self.farm)
                .chain(&self.mults)
                .chain(&self.wire)
                .chain([&self.max_hp_mult])
                .all(|x| x.is_finite())
        {
            return false;
        }
        let folded = fold_build(build, farm, base_hp);
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
        // Validate the supported range, not equality with today's status table.
        let base = fold::encode_mirrors(&fold::mirrors_from_fold(&folded)).source_values();
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
    let folded = fold_build(
        &build,
        &farm,
        crate::content::faction(w.core(ix).vitals.faction).hp,
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
    let efficiency = if w.is_player(ix) && w.core(ix).vitals.faction == crate::FactionId::Sentenced
    {
        DEFINITION.mark_as_efficiency
    } else {
        1.
    };
    let wire = fold::encode_mirrors(&fold::mirrors_from_fold_with_sources(
        &folded, &src, efficiency,
    ));
    w.core_mut(ix).modifiers = Runtime {
        sums: folded.sums.source_values(),
        farm: folded.farm_sums.source_values(),
        mults: folded.mults.source_values(),
        wire: wire.source_values(),
        max_hp_mult: fold::default_definition()
            .max_hp_floor_share
            .max(1. + folded.sums.max_hp + folded.farm_sums.max_hp),
    };
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
    let pct = (crate::constants::MARK_BASE_PCT * crate::constants::DUEL_PACE
        + crate::constants::MARK_KILL_PCT
            * crate::constants::DUEL_PACE
            * f64::from(p.credit.sentence))
        * (1. + DEFINITION.mark_bonus * sum);
    pct * target_hp
        * weight
        * if near {
            1.
        } else {
            crate::constants::MARK_FAR_SHARE
        }
}

fn fold_build(build: &crate::cards::Build, farm: &Farm, base: f64) -> fold::Folded {
    let (rows, n) = build.rows();
    let boosts = fold::BoostCounts::from_source_values(build.boosts().map(f64::from));
    {
        let (farm_rows, len) = farm.rows();
        fold::fold_rows(
            &rows[..n],
            &FoldContext {
                base_max_hp: base,
                farm_rows: &farm_rows[..len],
                boosts: Some(&boosts),
                ..Default::default()
            },
        )
    }
}
/// Conservative supported-source envelope for snapshots fired before the present build/refold.
pub(crate) fn maximum_packet(weapon: crate::WeaponId) -> f64 {
    crate::FactionId::ALL
        .into_iter()
        .map(|id| {
            let f = crate::content::paced(id);
            let base_hp = crate::content::faction(id).hp;
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
            let folded = fold_build(&build, &Farm::maximum(), base_hp);
            let m = fold::decode_mirrors(&fold::encode_mirrors(&fold::mirrors_from_fold(&folded)));
            let rate = m.as_mult.max(fold::cap_as_mult(f64::MAX));
            let interval = crate::content::attack_interval(&f, weapon, rate);
            let sc = DEFINITION.weapon_scaling[weapon.code() as usize];
            // Summing both dominant sides is conservative; every real snapshot is <= this envelope.
            crate::content::damage_per_hit(&f, weapon, rate)
                + (sc[0] * m.ad_bonus
                    + sc[1] * m.ap_bonus
                    + sc[2] * (folded.max_hp - base_hp).max(0.)
                    + sc[3] * (m.armor_bonus.max(0.) + m.shield_bonus))
                    * rate
                    * interval
        })
        .fold(0., f64::max)
}

pub(crate) fn outgoing(p: &crate::fighter::FighterCore) -> f64 {
    1. + StatSums::from_source_values(p.modifiers.farm).damage
}
