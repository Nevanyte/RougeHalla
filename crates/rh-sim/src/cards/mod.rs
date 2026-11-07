//! The supported interactive subset; source eligibility remains interactive + unique.
mod rules;
use crate::stat_fold::{EffectKind, EffectRow};
pub use rules::{visit_content, Definition, DEFINITION};

/// The three cards the current native build/chest path supports (the catalog is all 80).
pub const SUPPORTED: [CardId; 3] = [CardId::SlowBurn, CardId::PocketSand, CardId::Siphon];
mod catalog;
mod catalog_data;
pub use catalog::*;

/// The source build's card count map (one byte per card in wire order). A newtype so the 80-byte array has Default and a
/// strict 80-element serde form (serde arrays stop at 32).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Counts(pub [u8; 80]);

impl Default for Counts {
    fn default() -> Self {
        Self([0; 80])
    }
}

impl serde::Serialize for Counts {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.as_slice().serialize(s)
    }
}

impl<'de> serde::Deserialize<'de> for Counts {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = <Vec<u8>>::deserialize(d)?;
        let arr: [u8; 80] = v
            .try_into()
            .map_err(|_| serde::de::Error::custom("card counts must have 80 entries"))?;
        Ok(Self(arr))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Build {
    /// Source count map in wire order: base cards stack; unique cards have one.
    pub(crate) counts: Counts,
    pub(crate) boosts: [u8; 8],
}
/// The generated catalog's total fold rows: a fixed scratch bound, not a game rule.
pub(crate) const MAX_FOLD_ROWS: usize = 79;
impl Build {
    pub fn owns(&self, id: CardId) -> bool {
        self.counts.0[id.index()] > 0
    }
    pub fn count(&self, id: CardId) -> u8 {
        self.counts.0[id.index()]
    }
    pub fn power(&self) -> f64 {
        self.cards()
            .map(|id| f64::from(id.tier()) * f64::from(self.count(id)))
            .sum()
    }
    pub fn cards(&self) -> impl Iterator<Item = CardId> + '_ {
        CardId::ALL
            .into_iter()
            .filter(move |id| self.counts.0[id.index()] > 0)
    }
    pub fn boosts(&self) -> [u8; 8] {
        self.boosts
    }
    pub(crate) fn add(&mut self, id: CardId) -> bool {
        if id.definition().unique && self.owns(id) {
            return false;
        }
        let c = &mut self.counts.0[id.index()];
        if *c == u8::MAX {
            return false;
        }
        *c += 1;
        true
    }
    pub(crate) fn valid(&self) -> bool {
        CardId::ALL
            .into_iter()
            .all(|id| !(id.definition().unique && self.counts.0[id.index()] > 1))
            && self.boosts.iter().all(|n| {
                u32::from(*n) <= crate::stat_fold::default_definition().chest_boost_max_picks
            })
    }
    pub(crate) fn rows(&self) -> ([EffectRow<'static>; MAX_FOLD_ROWS], usize) {
        let empty = EffectRow {
            kind: EffectKind::Trigger,
            requires: &[],
            needs_status: false,
        };
        let mut rows = [empty; MAX_FOLD_ROWS];
        let mut n = 0;
        for id in self.cards() {
            for row in id.definition().rows {
                if let CardRow::Fold(kind) = row {
                    if n == rows.len() {
                        return (rows, n);
                    }
                    rows[n] = EffectRow::new(*kind);
                    n += 1;
                }
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
