//! Per-tick working sets: written before they are read within one step, so they are never part of a checkpoint or the
//! state hash. A restored [`crate::Sim`] starts with an empty [`TickScratch`] and behaves identically.
//!
//! When each field is (re)written, and why a stale value is never read:
//! * `bounty_at_tick_start`, `rank`: rewritten at the start of every active tick (markTickStart, the action order) and
//!   read only later in that same tick (the kill bounty, kill-credit ranks, the inputs in that order);
//! * `standing`, `mults`: written by `movement:multipliers`, read by `movement:walk` and `movement:recordHistory`, which
//!   empties them (the fighters standing when the multipliers were read, and each one's move speed this tick);
//! * `melee`, `ledger`, `downed_this_tick`: filled and drained within one active tick, empty at the end of every step (asserted in debug builds);
//! * `bodies`, `victims`, `ledger_mults`, `idxs`, `amounts`, `order`, `hits`, `alive`, `path`: the working lists of one
//!   system call, cleared by the system before it fills them and never read by another.
//!
//! Every buffer is cleared, never taken, so its capacity survives across ticks: after the first few ticks a step allocates
//! nothing (`tests/no_alloc.rs` counts it). A new system that needs a list adds a field here.

use crate::math::Vec2;
use crate::state::PlayerId;
use crate::systems::ledger::Entry;
use crate::systems::melee::MeleeReq;

#[derive(Clone, Debug, Default)]
pub(crate) struct TickScratch {
    /// Every player's bounty at the start of the tick (legacy `bountyAtTickStart`): a kill pays what the victim was worth
    /// before the tick's own kills raised it.
    pub(crate) bounty_at_tick_start: Vec<(PlayerId, u32)>,
    /// The tick's secret action order as (id, rank): the order the inputs apply in, and the rank of kill credit among a
    /// victim's hits.
    pub(crate) rank: Vec<(PlayerId, usize)>,
    /// Indices of the players standing when this tick's move multipliers were read (legacy `standingCombatants`).
    pub(crate) standing: Vec<usize>,
    /// Their move multipliers, aligned with `standing`: every one is read before anyone moves.
    pub(crate) mults: Vec<f64>,
    /// Melee swings that landed this tick, resolved after movement (rewound).
    pub(crate) melee: Vec<MeleeReq>,
    /// The damage ledger: every hit of the tick, applied at once.
    pub(crate) ledger: Vec<Entry>,
    /// Players downed during this step, settled at its end.
    pub(crate) downed_this_tick: Vec<PlayerId>,
    /// The fighters standing when the melee queue is resolved.
    pub(crate) bodies: Vec<usize>,
    /// The ledger pass: victims in order of first appearance, and each entry's outgoing multiplier.
    pub(crate) victims: Vec<PlayerId>,
    pub(crate) ledger_mults: Vec<f64>,
    /// One victim's pass: its entries' indices, mitigated amounts, the (rank, entry) order they land in and the hits.
    pub(crate) idxs: Vec<usize>,
    pub(crate) amounts: Vec<f64>,
    pub(crate) order: Vec<(usize, usize)>,
    pub(crate) hits: Vec<(f64, PlayerId)>,
    /// Who still stands, collected only when the settle needs the ids (the end of a run).
    pub(crate) alive: Vec<PlayerId>,
    /// A path search's output, copied into the fighter's path when the order replaces it.
    pub(crate) path: Vec<Vec2>,
}

impl TickScratch {
    /// True when nothing tick-local survives the step (asserted at the end of every step in debug builds).
    pub(crate) fn is_settled(&self) -> bool {
        self.melee.is_empty()
            && self.ledger.is_empty()
            && self.downed_this_tick.is_empty()
            && self.standing.is_empty()
            && self.mults.is_empty()
    }
}
