//! The supported interactive subset; source eligibility remains interactive + unique.
mod rules;
use crate::stat_fold::{EffectKind, EffectRow, EffectStat, MultKey};
pub use rules::{visit_content, Definition, DEFINITION};
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardId {
    SlowBurn,
    PocketSand,
    Siphon,
}
impl CardId {
    pub const ALL: [Self; 3] = [Self::SlowBurn, Self::PocketSand, Self::Siphon];
    pub const fn index(self) -> usize {
        match self {
            Self::SlowBurn => 0,
            Self::PocketSand => 1,
            Self::Siphon => 2,
        }
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SlowBurn => "slowBurn",
            Self::PocketSand => "pocketSand",
            Self::Siphon => "siphon",
        }
    }
    pub const fn tier(self) -> u8 {
        DEFINITION.tiers[self.index()]
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Build {
    /// Source insertion order, with a closed three-card supported domain.
    pub(crate) cards: [Option<CardId>; 3],
    pub(crate) boosts: [u8; 8],
}
impl Build {
    pub fn owns(&self, id: CardId) -> bool {
        self.cards.contains(&Some(id))
    }
    pub fn power(&self) -> f64 {
        self.cards
            .iter()
            .flatten()
            .map(|id| f64::from(id.tier()))
            .sum()
    }
    pub fn cards(&self) -> impl Iterator<Item = CardId> + '_ {
        self.cards.iter().flatten().copied()
    }
    pub fn boosts(&self) -> [u8; 8] {
        self.boosts
    }
    pub(crate) fn add(&mut self, id: CardId) -> bool {
        if self.owns(id) {
            return false;
        }
        let Some(slot) = self.cards.iter_mut().find(|v| v.is_none()) else {
            return false;
        };
        *slot = Some(id);
        true
    }
    pub(crate) fn valid(&self) -> bool {
        let n = self.cards.iter().flatten().count();
        self.cards[..n].iter().all(Option::is_some)
            && self.cards[n..].iter().all(Option::is_none)
            && CardId::ALL
                .into_iter()
                .all(|id| self.cards.iter().filter(|v| **v == Some(id)).count() <= 1)
            && self.boosts.iter().all(|n| {
                u32::from(*n) <= crate::stat_fold::default_definition().chest_boost_max_picks
            })
    }
    pub(crate) fn rows(&self) -> ([EffectRow<'static>; 3], usize) {
        let empty = EffectRow {
            kind: EffectKind::Trigger,
            requires: &[],
            needs_status: false,
        };
        let mut rows = [empty; 3];
        let mut n = 0;
        for id in self.cards() {
            match id {
                CardId::SlowBurn => {
                    for (key, v) in [
                        (MultKey::Linger, DEFINITION.slow_burn_linger),
                        (MultKey::Dot, DEFINITION.slow_burn_dot),
                    ] {
                        rows[n] = EffectRow {
                            kind: EffectKind::Mult { key, v },
                            requires: &[],
                            needs_status: false,
                        };
                        n += 1;
                    }
                }
                CardId::Siphon => {
                    rows[n] = EffectRow {
                        kind: EffectKind::Stat {
                            stat: EffectStat::LifestealDot,
                            v: DEFINITION.siphon,
                        },
                        requires: &[],
                        needs_status: false,
                    };
                    n += 1;
                }
                CardId::PocketSand => {}
            }
        }
        (rows, n)
    }
}
pub(crate) fn grant(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    id: crate::PlayerId,
    card: CardId,
) -> bool {
    let Some(i) = w.idx(id) else { return false };
    if !w.players[i].build.add(card) {
        return false;
    }
    crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
    crate::modifiers::sync_max_hp(&mut w.players[i]);
    true
}

/// Actual cardHooks.onBlocked subset. Quiet status application is immediate outside the ledger.
pub(crate) fn on_blocked(hx: &mut crate::hooks::Hx, args: &crate::hooks::HookArgs) {
    let crate::hooks::HookArgs::Blocked {
        holder, attacker, ..
    } = *args
    else {
        return;
    };
    let Some(p) = hx.w.player(holder) else { return };
    if !p.build.owns(CardId::PocketSand) {
        return;
    }
    let Some(name) = hx.w.roster.label(holder).cloned() else {
        return;
    };
    crate::systems::status::operations::apply_with(
        hx.k,
        hx.w,
        hx.ev,
        attacker,
        crate::status_runtime::StatusApply {
            kind: crate::status_runtime::StatusKind::SlowMove,
            source: crate::status_runtime::StatusSource {
                id: Some(holder),
                name,
                owner_id: None,
            },
            ms: DEFINITION.pocket_sand_ms,
            ability: None,
            tag: Some(crate::status_runtime::StatusTag::Block),
            value: Some(DEFINITION.pocket_sand_slow),
            add: None,
            data: None,
        },
        true,
        hx.stats,
    );
}

pub mod runtime;
