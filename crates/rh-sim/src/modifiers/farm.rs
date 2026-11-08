//! Exact source normal-mob reward facts. The real credited-kill producer calls grant_mob_stat.
use crate::mob_catalog::MobTypeId as M;
use crate::stat_fold::{EffectKind, EffectRow, EffectStat as S, FlatStat as F};
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RewardStat {
    Stat(S),
    Flat(F),
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reward {
    pub mob: M,
    pub stat: RewardStat,
    pub value: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub kill_stacks: u64,
    pub max_count: u64,
    pub rows: [Reward; 20],
}
const fn stat(mob: M, stat: S, value: f64) -> Reward {
    Reward {
        mob,
        stat: RewardStat::Stat(stat),
        value,
    }
}
const fn flat(mob: M, stat: F, value: f64) -> Reward {
    Reward {
        mob,
        stat: RewardStat::Flat(stat),
        value,
    }
}
/// Source MOB_TYPES order, after excluding elites, as used by MOB_STAT_REWARDS/mobStatRows.
pub const DEFINITION: Definition = Definition {
    kill_stacks: 3,
    max_count: 9_007_199_254_740_991,
    rows: [
        stat(M::EmberImp, S::Damage, 0.01),
        stat(M::CinderHound, S::MoveSpeed, 0.005),
        stat(M::MagmaBrute, S::MaxHp, 0.01),
        flat(M::FlameCaller, F::Ap, 1.),
        flat(M::Bailiff, F::Armor, 1.25),
        flat(M::ChainWarden, F::Shield, 1.5),
        stat(M::Inquisitor, S::Damage, 0.01),
        flat(M::Pardoner, F::Ad, 1.),
        stat(M::PlagueRat, S::AttackSpeed, 0.01),
        stat(M::Bloatfly, S::MoveSpeed, 0.005),
        stat(M::RotMonk, S::Lifesteal, 0.0025),
        flat(M::MiasmaWitch, F::Ap, 1.),
        flat(M::FrostWisp, F::Shield, 1.5),
        stat(M::IceGolem, S::MaxHp, 0.01),
        flat(M::RimeStalker, F::Armor, 1.25),
        stat(M::FrostbowSentry, S::AttackSpeed, 0.01),
        stat(M::Acolyte, S::Lifesteal, 0.0025),
        flat(M::SeraphShard, F::Shield, 1.5),
        stat(M::Penitent, S::MaxHp, 0.01),
        flat(M::Zealot, F::Armor, 1.25),
    ],
};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Farm {
    counts: [u64; 20],
}
impl Farm {
    pub fn count(&self, id: M) -> u64 {
        DEFINITION
            .rows
            .iter()
            .position(|r| r.mob == id)
            .map_or(0, |i| self.counts[i])
    }
    /// Sets one type's stacks (the practice console's setMobStat; production grants go through grant_mob_stat).
    pub(crate) fn set(&mut self, id: M, count: u64) {
        if let Some(i) = DEFINITION.rows.iter().position(|r| r.mob == id) {
            self.counts[i] = count.min(DEFINITION.max_count);
        }
    }

    pub(crate) fn clear(&mut self) {
        self.counts = [0; 20];
    }

    /// The reward fact for one type; None for an unknown or elite type (source mobStatReward).
    pub(crate) fn reward_of(id: M) -> Option<&'static Reward> {
        DEFINITION.rows.iter().find(|r| r.mob == id)
    }

    pub(crate) fn valid(&self) -> bool {
        self.counts.iter().all(|n| *n <= DEFINITION.max_count)
    }
    pub(crate) fn maximum() -> Self {
        Self {
            counts: [DEFINITION.max_count; 20],
        }
    }
    pub(crate) fn rows(&self) -> ([EffectRow<'static>; 20], usize) {
        let empty = EffectRow {
            kind: EffectKind::Trigger,
            requires: &[],
            needs_status: false,
        };
        let mut out = [empty; 20];
        let mut kinds = [None; 20];
        let mut n = 0;
        for (r, count) in DEFINITION.rows.into_iter().zip(self.counts) {
            if count == 0 {
                continue;
            }
            let value = r.value * count as f64;
            let i = if let Some(i) = kinds[..n].iter().position(|k| *k == Some(r.stat)) {
                i
            } else {
                let i = n;
                kinds[i] = Some(r.stat);
                out[i].kind = match r.stat {
                    RewardStat::Stat(stat) => EffectKind::Stat { stat, v: 0. },
                    RewardStat::Flat(stat) => EffectKind::Flat { stat, v: 0. },
                };
                n += 1;
                i
            };
            match &mut out[i].kind {
                EffectKind::Stat { v, .. } | EffectKind::Flat { v, .. } => *v += value,
                _ => unreachable!(),
            }
        }
        (out, n)
    }
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.kill_stacks);
    word(d.max_count);
    word(d.rows.len() as u64);
    for r in d.rows {
        word(r.mob.as_str().len() as u64);
        for b in r.mob.as_str().bytes() {
            word(u64::from(b))
        }
        match r.stat {
            RewardStat::Stat(s) => {
                word(0);
                word(crate::stat_fold::StatKey::from(s).index() as u64)
            }
            RewardStat::Flat(s) => {
                word(1);
                word(crate::stat_fold::StatKey::from(s).index() as u64)
            }
        }
        word(r.value.to_bits());
    }
}
/// Source counts are safe integers. A normal credited kill supplies DEFINITION.kill_stacks.
pub(crate) fn grant_mob_stat(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    mob: M,
    amount: u64,
) -> u64 {
    let Some(i) = w.idx(id).filter(|i| w.players[*i].standing()) else {
        return 0;
    };
    let Some(row) = DEFINITION.rows.iter().position(|r| r.mob == mob) else {
        return 0;
    };
    let old = w.players[i].farm.counts[row];
    if amount == 0 || amount > DEFINITION.max_count.saturating_sub(old) {
        return 0;
    }
    w.players[i].farm.counts[row] = old + amount;
    super::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    super::sync_max_hp(&mut w.players[i]);
    amount
}
