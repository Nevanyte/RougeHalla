//! The supported interactive subset; source eligibility remains interactive + unique.
mod rules;
use crate::stat_fold::{EffectKind, EffectRow};
pub use rules::{visit_content, Definition, DEFINITION};

/// The three cards the current native build/chest path supports (the catalog is all 80).
pub const SUPPORTED: [CardId; 3] = [CardId::SlowBurn, CardId::PocketSand, CardId::Siphon];
mod after_damage;
mod catalog;
mod catalog_data;
pub(crate) use after_damage::after_damage;
pub(crate) mod on_hit;
pub(crate) mod on_hurt;
pub use catalog::*;

/// The source build's card count map (one byte per card in wire order). A newtype so the 80-byte array has Default and a
/// strict 80-element serde form (serde arrays stop at 32).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counts(pub [u8; 80]);

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

/// Source card-state streak memory: consecutive weapon hits on one target, read at the pass start and written after it.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Streak {
    pub target: crate::PlayerId,
    pub count: u16,
    pub last: f64,
}

/// One pending heal-over-time step run (source `PlayerRuntime.hots`).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hot {
    pub next: f64,
    pub left: u32,
    pub amount: f64,
    pub ignore_lockout: bool,
}

/// Source `healOverTimeSteps`: at least one round step per HEAL_OVER_TIME_STEP_MS.
pub fn heal_over_time_steps(ms: f64) -> u32 {
    ((ms / crate::constants::HEAL_OVER_TIME_STEP_MS).round() as u32).max(1)
}

/// One Wishful Thinking trim inside the source window (source `cards.trims`).
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trim {
    pub at: f64,
    pub ms: f64,
}

/// Source `wishfulThinking`: `n` hits shorten a cast Wish's cooldown by the owned hit-trigger's `ms` each, capped by the
/// window budget and never below the cast-cooldown floor. Mutates the stock clocks and records the trim.
pub fn wishful_thinking(
    n: u32,
    ms: f64,
    now: f64,
    stocks: &mut crate::abilities::Stocks,
    cast: Option<crate::cards::runtime::WishSpend>,
    trims: &mut Vec<Trim>,
) {
    if n == 0 || !(ms > 0.) {
        return;
    }
    let Some(cast) = cast else { return };
    let on_cooldown = stocks.wish_ready_at > now;
    let clock_end = if on_cooldown {
        stocks.wish_ready_at
    } else {
        stocks.wish_full_at.unwrap_or(0.)
    };
    if !(clock_end > now) {
        return;
    }
    trims.retain(|t| now - t.at < crate::constants::WISHFUL_WINDOW_MS);
    let used: f64 = trims.iter().map(|t| t.ms).sum();
    let floor_at = (cast.at + crate::constants::WISHFUL_FLOOR_SHARE * cast.cooldown_ms).max(now);
    let cut = (f64::from(n) * ms)
        .min(crate::constants::WISHFUL_BUDGET_MS - used)
        .min(clock_end - floor_at);
    if !(cut > 0.) {
        return;
    }
    if on_cooldown {
        stocks.wish_ready_at -= cut;
    }
    stocks.wish_full_at = stocks.wish_full_at.map(|v| (v - cut).max(0.));
    trims.push(Trim { at: now, ms: cut });
}

/// Source `streakBefore`: hits landed in a row on `victim` before this tick's pass (0 without a live same-target streak).
pub fn streak_before(
    streak: Option<&Streak>,
    now: f64,
    victim: crate::PlayerId,
    gap_ms: f64,
) -> u16 {
    match streak {
        Some(s) if s.target == victim && now - s.last < gap_ms => s.count,
        _ => 0,
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
    /// Any owned card's fold row carries this flag (source `hasFlag`).
    pub fn has_flag(&self, flag: crate::stat_fold::EffectFlag) -> bool {
        self.cards().any(|id| {
            id.definition().rows.iter().any(|row| {
                matches!(
                    row,
                    CardRow::Fold(EffectKind::Flag { flag: f }) if *f == flag
                )
            })
        })
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
    /// Build a count map from (card, count) pairs (tests and trusted producers).
    pub fn from_counts(pairs: impl IntoIterator<Item = (CardId, u8)>) -> Self {
        let mut build = Self::default();
        for (id, count) in pairs {
            build.counts.0[id.index()] = count;
        }
        build
    }
    pub fn counts(&self) -> [u8; 80] {
        self.counts.0
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

#[cfg(test)]
mod wishful_tests {
    use super::{wishful_thinking, Trim};
    use crate::abilities::Stocks;
    use crate::cards::runtime::WishSpend;

    fn stocks(now: f64) -> Stocks {
        Stocks {
            wish_ready_at: now + 3000.,
            wish_full_at: None,
            ..Default::default()
        }
    }

    #[test]
    fn wishful_thinking_trims_with_the_source_caps() {
        let cast = Some(WishSpend {
            at: 0.,
            cooldown_ms: 10_000.,
        });
        let now = 5000.;
        let mut st = stocks(now);
        let mut trims = Vec::new();
        wishful_thinking(1, 1000., now, &mut st, cast, &mut trims);
        // floorAt = max(now, cast.at + 0.5 * cooldown) = 5000, clockEnd 8000: cut 1000.
        assert_eq!(st.wish_ready_at, now + 2000.);
        assert_eq!(trims.len(), 1);
        // Budget: 30 s already used in the window leaves nothing.
        let mut st2 = stocks(now);
        let mut trims2 = vec![Trim {
            at: now,
            ms: crate::constants::WISHFUL_BUDGET_MS,
        }];
        wishful_thinking(1, 1000., now, &mut st2, cast, &mut trims2);
        assert_eq!(st2.wish_ready_at, now + 3000.);
        // Floor: only 200 ms above the floor can be cut.
        let cast_late = Some(WishSpend {
            at: 0.,
            cooldown_ms: 10_000.,
        });
        let mut st3 = Stocks {
            wish_ready_at: now + 200.,
            wish_full_at: None,
            ..Default::default()
        };
        let mut trims3 = Vec::new();
        wishful_thinking(5, 1000., now, &mut st3, cast_late, &mut trims3);
        assert_eq!(st3.wish_ready_at, now);
        // An expired trim leaves the window.
        let mut st4 = stocks(now);
        let mut trims4 = vec![Trim {
            at: now - crate::constants::WISHFUL_WINDOW_MS,
            ms: crate::constants::WISHFUL_BUDGET_MS,
        }];
        wishful_thinking(1, 1000., now, &mut st4, cast, &mut trims4);
        assert_eq!(st4.wish_ready_at, now + 2000.);
        assert_eq!(trims4.len(), 1);
    }
}
