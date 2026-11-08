//! Per-tick working sets: written before they are read within one step, so they are never part of a checkpoint or the
//! state hash. A restored [`crate::Sim`] starts with an empty [`TickScratch`] and behaves identically.
//!
//! When each field is (re)written, and why a stale value is never read:
//! * `bounty_at_tick_start`, `action_order`, `rank` (all by slot): rewritten at the start of every active tick (markTickStart, the action order) and
//!   read only later in that same tick (the kill bounty, kill-credit ranks, the inputs in that order);
//! * `blocks`, `landed`: cleared at ledger open, filled only by physical producers/the ledger, then read by signatures.
//!   `landed` also supports a trusted last-pass diagnostic; neither is serialized or hashed.
//! * `contacts`, `dealt`: rewritten by their signature pass before use.
//! * `standing`, `mults`: written by `movement:multipliers`, read by `movement:walk` and `movement:recordHistory`, which
//!   empties them (the fighters standing when the multipliers were read, and each one's move speed this tick);
//! * `melee`, `ledger`, `downed_this_tick`: filled and drained within one active tick, empty at the end of every step (asserted in debug builds, with `slot_head`/`slot_tail`: all `NONE` between ledger passes);
//! * `bodies`, `victims`, `ledger_mults`, `entry_next`, `entry_rank`, `idxs`, `amounts`, `order`, `hits`, `alive`, `path`: the working lists of one
//!   system call, cleared by the system before it fills them and never read by another.
//!
//! Every buffer is cleared, never taken, so its capacity survives across ticks: after the first few ticks a step allocates
//! nothing (`tests/no_alloc.rs` counts it). A new system that needs a list adds a field here.

use crate::constants::MAX_PLAYERS;
use crate::fighter::FighterIx;
use crate::input::Drained;
use crate::math::Vec2;
use crate::state::PlayerId;
use crate::systems::ledger::Entry;
use crate::systems::melee::MeleeReq;

/// "No entry / no slot" in the dense per-slot lists.
pub(crate) const NONE: u32 = u32::MAX;

#[derive(Debug)]
pub(crate) struct TickScratch {
    pub(crate) cast_landings: Vec<crate::systems::abilities::Landing>,
    pub(crate) status_active: Vec<PlayerId>,
    pub(crate) status_removed: Vec<crate::status_runtime::StatusInstance>,
    /// Rewritten before weapons; only the actual start site marks an action new.
    pub(crate) attack_started: Vec<bool>,
    pub(crate) performed: Vec<crate::factions::PerformedAttack>,
    pub(crate) performed_bounded: bool,
    pub(crate) mark_denials: Vec<(PlayerId, PlayerId)>,
    pub(crate) ledger_diagnostics: Vec<crate::factions::DamageView>,
    pub(crate) dot_sums: Vec<(PlayerId, f64)>,
    pub(crate) fx: crate::fx_report::TickFx,
    /// Every player's bounty at the start of the tick (legacy `bountyAtTickStart`), by slot: a kill pays what the victim
    /// was worth before the tick's own kills raised it.
    pub(crate) bounty_at_tick_start: Vec<u32>,
    /// The tick's secret action order as slots: the order the inputs apply in.
    pub(crate) action_order: Vec<u32>,
    /// Each slot's place in `action_order` (the rank of kill credit among a victim's hits), by slot.
    pub(crate) rank: Vec<u32>,
    /// Indices of the players standing when this tick's move multipliers were read (legacy `standingCombatants`).
    pub(crate) standing: Vec<FighterIx>,
    /// Their move multipliers, aligned with `standing`: every one is read before anyone moves.
    pub(crate) mults: Vec<f64>,
    /// Melee swings that landed this tick, resolved after movement (rewound).
    pub(crate) melee: Vec<MeleeReq>,
    pub(crate) flight: crate::systems::projectiles::FlightScratch,
    /// The damage ledger: every hit of the tick, applied at once.
    pub(crate) ledger: Vec<Entry>,
    /// Physical blocks recorded by producers, never recovered from caller-owned output.
    pub(crate) blocks: Vec<crate::systems::signatures::BlockContact>,
    /// Positive post-barrier damage in victim/entry order. Cleared when opening the next ledger.
    pub(crate) landed: Vec<crate::systems::signatures::LandedHit>,
    pub(crate) contacts: Vec<crate::systems::signatures::Contact>,
    pub(crate) dealt: Vec<(PlayerId, f64, f64)>,
    /// Players downed during this step, settled at its end.
    pub(crate) downed_this_tick: Vec<PlayerId>,
    /// The fighters standing when the melee queue is resolved.
    pub(crate) bodies: Vec<FighterIx>,
    /// The standing bodies' positions at one rewind time, aligned with `bodies` (the melee pass fills it once per distinct
    /// rewind time instead of once per swing).
    pub(crate) rewound: Vec<Vec2>,
    /// The ledger pass: the victims' slots in order of first appearance, each entry's outgoing multiplier, and the entries
    /// chained per victim slot (`slot_head`/`slot_tail` by slot, `entry_next` by entry: all `NONE` between passes).
    pub(crate) victims: Vec<u32>,
    pub(crate) ledger_mults: Vec<f64>,
    pub(crate) ledger_races: Vec<f64>,
    pub(crate) deny_parts: Vec<f64>,
    pub(crate) slot_head: Vec<u32>,
    pub(crate) slot_tail: Vec<u32>,
    pub(crate) entry_next: Vec<u32>,
    /// Each entry's attacker's action-order rank (`u32::MAX` when it is not in the order), by entry.
    pub(crate) entry_rank: Vec<u32>,
    /// One victim's pass: its entries' indices, mitigated amounts, the (rank, entry) order they land in and the hits.
    pub(crate) idxs: Vec<usize>,
    pub(crate) amounts: Vec<f64>,
    pub(crate) order: Vec<(usize, usize)>,
    pub(crate) hits: Vec<crate::systems::ledger::Hit>,
    /// Who still stands, collected only when the settle needs the ids (the end of a run).
    pub(crate) alive: Vec<PlayerId>,
    /// A path search's output, copied into the fighter's path when the order replaces it.
    pub(crate) path: Vec<Vec2>,
    /// The fighter whose inputs are being applied: its queue, drained here so the handlers can borrow the world.
    pub(crate) drained: Drained,
}

impl Default for TickScratch {
    /// Every list starts at the size one tick of a full lobby can need (`MAX_PLAYERS` fighters, each landing at most one
    /// swing on every other), so a normal match never grows a buffer: not even on its first crowded tick. Later packets
    /// that add actors (mobs) grow them once, to their high-water mark.
    fn default() -> Self {
        let (p, hits) = (MAX_PLAYERS, 2 * MAX_PLAYERS * MAX_PLAYERS);
        Self {
            cast_landings: Vec::with_capacity(p),
            status_active: Vec::with_capacity(p),
            status_removed: Vec::with_capacity(p),
            attack_started: vec![false; MAX_PLAYERS],
            performed: Vec::with_capacity(crate::fx_report::FX_INSTANT_BUCKETS_MAX),
            performed_bounded: true,
            mark_denials: Vec::with_capacity(MAX_PLAYERS),
            ledger_diagnostics: Vec::with_capacity(hits),
            dot_sums: Vec::with_capacity(p),
            fx: crate::fx_report::TickFx {
                ops: Vec::with_capacity(crate::fx_report::FX_REPORT_OPS_MAX),
            },
            bounty_at_tick_start: Vec::with_capacity(p),
            action_order: Vec::with_capacity(p),
            rank: Vec::with_capacity(p),
            standing: Vec::with_capacity(p),
            mults: Vec::with_capacity(p),
            melee: Vec::with_capacity(p),
            flight: Default::default(),
            ledger: Vec::with_capacity(hits),
            blocks: Vec::with_capacity(hits),
            landed: Vec::with_capacity(hits),
            contacts: Vec::with_capacity(hits),
            dealt: Vec::with_capacity(p),
            downed_this_tick: Vec::with_capacity(p),
            bodies: Vec::with_capacity(p),
            rewound: Vec::with_capacity(p),
            victims: Vec::with_capacity(p),
            ledger_mults: Vec::with_capacity(hits),
            ledger_races: Vec::with_capacity(hits),
            deny_parts: Vec::with_capacity(hits),
            slot_head: vec![NONE; p],
            slot_tail: vec![NONE; p],
            entry_next: Vec::with_capacity(hits),
            entry_rank: Vec::with_capacity(hits),
            idxs: Vec::with_capacity(p),
            amounts: Vec::with_capacity(p),
            order: Vec::with_capacity(p),
            hits: Vec::with_capacity(p),
            alive: Vec::with_capacity(p),
            path: Vec::with_capacity(64),
            drained: Drained::default(),
        }
    }
}

/// The working lists hold nothing between steps (asserted in debug builds), so a clone is a fresh scratch: it is sized
/// like a new one and copies no dead data.
impl Clone for TickScratch {
    fn clone(&self) -> Self {
        debug_assert!(self.is_settled(), "a sim is cloned between steps");
        let mut scratch = Self::default();
        scratch.reserve_actors(self.attack_started.len());
        scratch
    }
}

impl TickScratch {
    pub(crate) fn reserve_actors(&mut self, count: usize) {
        if self.attack_started.len() < count {
            self.attack_started.resize(count, false);
        }
        macro_rules! reserve { ($($field:ident),*) => { $(if self.$field.capacity() < count {self.$field.reserve(count.saturating_sub(self.$field.len()));})* }; }
        reserve!(
            standing,
            mults,
            bodies,
            rewound,
            victims,
            status_active,
            dot_sums,
            alive
        );
    }

    /// True when nothing tick-local survives the step (asserted at the end of every step in debug builds). Checked: the
    /// queues a tick fills and drains (`melee`, `ledger`, `downed_this_tick`), the lists the movement systems hand from
    /// one system to the next (`standing`, `mults`), and the ledger's per-slot chains, which must be all `NONE` between
    /// passes (a stale link would corrupt the next pass). Not checked, because each is cleared by its own system before
    /// it is filled and never read by another, so what it holds after a step is dead: `action_order`, `rank` and
    /// `bounty_at_tick_start` (rewritten at the start of every active tick), `bodies`, `victims`, `ledger_mults`,
    /// `entry_next`, `entry_rank`, `idxs`, `amounts`, `order`, `hits`, `alive`, `path` and `drained`.
    pub(crate) fn is_settled(&self) -> bool {
        self.cast_landings.is_empty()
            && self.melee.is_empty()
            && self.ledger.is_empty()
            && self.downed_this_tick.is_empty()
            && self.standing.is_empty()
            && self.mults.is_empty()
            && self.slot_head.iter().all(|&n| n == NONE)
            && self.slot_tail.iter().all(|&n| n == NONE)
    }
}
