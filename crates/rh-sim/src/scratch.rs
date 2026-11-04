//! Per-tick working sets: written before they are read within one step, so they are never part of a checkpoint or the
//! state hash. A restored [`crate::Sim`] starts with an empty [`TickScratch`] and behaves identically.
//!
//! When each field is (re)written, and why a stale value is never read:
//! * `bounty_at_tick_start`, `rank`: rewritten at the start of every active tick (markTickStart, the action order) and
//!   read only later in that same tick (the kill bounty, kill-credit ranks);
//! * `melee`, `ledger`, `downed_this_tick`: filled and drained within one active tick, empty at the end of every step;
//! * `stepping`: true only inside [`crate::Sim::step`].

use crate::state::PlayerId;
use crate::systems::ledger::Entry;
use crate::systems::melee::MeleeReq;

#[derive(Clone, Debug, Default)]
pub(crate) struct TickScratch {
    /// Every player's bounty at the start of the tick (legacy `bountyAtTickStart`): a kill pays what the victim was worth
    /// before the tick's own kills raised it.
    pub(crate) bounty_at_tick_start: Vec<(PlayerId, u32)>,
    /// The tick's secret action order as (id, rank): ranks kill credit among a victim's hits.
    pub(crate) rank: Vec<(PlayerId, usize)>,
    /// Melee swings that landed this tick, resolved after movement (rewound).
    pub(crate) melee: Vec<MeleeReq>,
    /// The damage ledger: every hit of the tick, applied at once.
    pub(crate) ledger: Vec<Entry>,
    /// Players downed during this step, settled at its end.
    pub(crate) downed_this_tick: Vec<PlayerId>,
    pub(crate) stepping: bool,
}

impl TickScratch {
    /// True when nothing tick-local survives the step (asserted at the end of every step in debug builds).
    pub(crate) fn is_settled(&self) -> bool {
        self.melee.is_empty()
            && self.ledger.is_empty()
            && self.downed_this_tick.is_empty()
            && !self.stepping
    }
}
