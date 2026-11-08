//! Hook dispatch: the legacy `world.hooks` chains as data plus one typed entry point.
//!
//! In legacy a hook is a property of the world that every interested module chains onto while it installs (`chainHook`,
//! a hand-written wrapper, or a plain assignment that drops the chain). Which links run, and in which order, is
//! emergent from module install order. Here the chain of every hook is a table (`schedule::HOOKS`, one [`Link`] per
//! legacy link, in install order, with its mode, config gate and [`Run`]) and a call site fires it through [`fire`]:
//!
//! * the arguments are typed ([`HookArgs`]), one variant per hook that has a call site; a packet that fires another hook
//!   adds its variant here and the call site at its legacy position;
//! * a link is `Run::Ported(fn(&mut Hx, &HookArgs))` or `Run::Pending(packet id)`; a pending link does nothing, as the
//!   mechanic it belongs to does not exist yet;
//! * the effective chain follows the record's modes: links run in install order, and a live `replace` link drops every
//!   link before it (`schedule::chain_from`, the one function dispatch and the conformance test both use);
//! * a link gets a [`Hx`], not the whole tick: the statics, the world and the event log, plus an optional write-only derived FX marker sink.
//!   It cannot read gameplay tick scratch or the path search, so a reaction decides from its arguments and the world and defers what it pays, never mid-pass
//!   (legacy: "decide from the arguments and pay with payLater");
//! * there are two deferrals, and a link picks the one its legacy code calls. `payLater` (same tick, after the ledger pass,
//!   or at once outside it) is [`Hx::pay_later`] with a typed [`PayLater`](crate::systems::ledger::PayLater) variant; a
//!   packet whose link calls `payLater` adds the variant and its arm. `deferHit` (the NEXT tick's ledger) is
//!   `World::deferred`. Never put a `payLater` effect in `World::deferred`: it would land a tick late and break parity.

use crate::events::Event;
use crate::schedule::{self, Gates, Hook, Run};
use crate::state::{PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::ledger::{self, PayLater};
use crate::Vec2;

/// What a hook link may touch (see the module docs).
pub(crate) struct Hx<'a> {
    pub(crate) stats: crate::status_runtime::stats::Inputs<'a>,
    /// Write-only derived presentation markers; never gameplay input.
    pub(crate) fx: Option<&'a mut crate::fx_report::TickFx>,
    pub(crate) k: &'a MatchStatic,
    pub(crate) w: &'a mut World,
    pub(crate) ev: &'a mut Vec<Event>,
}

impl Hx<'_> {
    /// Legacy `payLater`: pays after every victim of the ledger pass took their damage (same tick), or at once when the
    /// hook fires outside the pass.
    #[cfg_attr(not(test), allow(dead_code))] // the first link that pays later is P-ABIL-1 / P-STATUS-1; tests use it now
    pub(crate) fn pay_later(&mut self, p: PayLater) {
        ledger::pay_later_with(self.k, self.w, self.ev, p, self.stats);
    }
}

/// Why a fighter left the fight (legacy `fighterOut`'s `cause`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OutCause {
    /// Went down in the run (died or MIA).
    Down,
    /// Left the match for good (`removePlayer`).
    Removed,
}

/// The typed arguments of a fired hook.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum HookArgs {
    Blocked {
        holder: PlayerId,
        attacker: PlayerId,
        prevented: crate::state::Packet,
        melee: bool,
    },
    ArenaHurt {
        terrain: bool,
        victim: PlayerId,
        by: Option<PlayerId>,
        source: Option<crate::status_runtime::StatusSource>,
        amount: f64,
    },
    Hurt {
        id: PlayerId,
        amount: f64,
        before: f64,
    },
    Teleported,
    StatusApplied {
        id: PlayerId,
        kind: crate::status_runtime::StatusKind,
        fresh: bool,
        index: usize,
    },
    /// An unblocked sword hit reached the fighter: its windup or cast is about to be interrupted (legacy
    /// weapons.stagger fires this before it cancels; the abilities chain interrupts only casts that list stagger).
    Staggered {
        id: PlayerId,
    },
    /// The lobby just turned into an active raid: players are placed (legacy `raidStarted(world)`).
    RaidStarted,
    PlanningStarted,
    /// A player went down with their run gear still on them (legacy `dropBody(world, p)`).
    DropBody {
        victim: PlayerId,
        between_ticks: bool,
    },
    /// A fighter left the fight for good (legacy `fighterOut(world, id, cause)`).
    FighterOut {
        id: PlayerId,
        cause: OutCause,
    },
    WeaponSwapped(PlayerId),
    PlayerKilled {
        by: PlayerId,
        victim: PlayerId,
        outcome: crate::results::Outcome,
    },
    ExecuteDenied {
        owner: PlayerId,
        denied: crate::systems::sentenced::Denied,
    },
    AttackStarted(PlayerId),
    HitLanded {
        entry: crate::systems::ledger::Entry,
        amount: f64,
    },
    /// The pass killed a victim with damage to spare (legacy `overkilled`): Overkill's splash input.
    Overkilled {
        victim: PlayerId,
        hits: Vec<crate::systems::ledger::OverkillHit>,
        overkill: f64,
        total: f64,
    },
    /// The run just ended: results are out and the phase is ended (legacy `runEnded(world)`).
    RunEnded,
    /// A regional mob died and its spoils were paid (legacy `mobKilled(world, killerRt, mob)`): the killer's runtime
    /// and the dead mob's identity/location. The source chests and quests links stay Pending (P-CARDS-2/P-QUEST-1);
    /// this packet owns only the producer call site at the source position.
    MobKilled {
        killer: PlayerId,
        mob_type: crate::mob_catalog::MobTypeId,
        zone: crate::FactionId,
        /// The camp's 0-based index in `map.camps` (source `MobState.camp - 1`).
        camp: i32,
        elite: bool,
        at: Vec2,
    },
    /// The last member of a regional camp died (legacy `campCleared(world, camp)`, the camp's 0-based index): the
    /// clear was paid after the ledger pass. The source chest/heal/quest links stay Pending (P-CARDS-2, P-MOBS-2,
    /// P-QUEST-1); P-FACTION-5 ports the Frost guard refresh here (its camp-clear mirror still needs the P-MOBS-2
    /// producer).
    CampCleared {
        camp: u32,
    },
}

impl HookArgs {
    pub(crate) const fn hook(&self) -> Hook {
        match self {
            HookArgs::Blocked { .. } => Hook::Blocked,
            HookArgs::ArenaHurt { .. } => Hook::ArenaHurt,
            HookArgs::Hurt { .. } => Hook::Hurt,
            HookArgs::Teleported => Hook::Teleported,
            HookArgs::StatusApplied { .. } => Hook::StatusApplied,
            HookArgs::Staggered { .. } => Hook::Staggered,
            HookArgs::RaidStarted => Hook::RaidStarted,
            HookArgs::PlanningStarted => Hook::PlanningStarted,
            HookArgs::DropBody { .. } => Hook::DropBody,
            HookArgs::FighterOut { .. } => Hook::FighterOut,
            HookArgs::HitLanded { .. } => Hook::HitLanded,
            HookArgs::Overkilled { .. } => Hook::Overkilled,
            HookArgs::AttackStarted(_) => Hook::AttackStarted,
            HookArgs::WeaponSwapped(_) => Hook::WeaponSwapped,
            HookArgs::PlayerKilled { .. } => Hook::PlayerKilled,
            HookArgs::ExecuteDenied { .. } => Hook::ExecuteDenied,
            HookArgs::RunEnded => Hook::RunEnded,
            HookArgs::MobKilled { .. } => Hook::MobKilled,
            HookArgs::CampCleared { .. } => Hook::CampCleared,
        }
    }
}

/// A hook link's code: runs when its hook fires and its gate is on.
pub(crate) type LinkFn = fn(&mut Hx, &HookArgs);

/// Fires a hook: every live link of its effective chain that is ported, in install order.
pub(crate) fn fire(hx: &mut Hx, args: HookArgs) {
    let g = Gates::of(hx.k);
    let hook = args.hook();
    let links = &schedule::hook_row(hook).links;
    for link in &links[schedule::chain_from(links.len(), |i| (links[i].gate, links[i].mode), &g)..]
    {
        if !link.gate.on(&g) {
            continue;
        }
        if let Run::Ported(f) | Run::Partial { callback: f, .. } = link.run {
            #[cfg(feature = "schedule-trace")]
            hx.w.trace
                .push(schedule::TraceEntry::Hook(hook.key(), link.legacy));
            f(hx, &args);
        }
    }
    #[cfg(feature = "trusted-status-probes")]
    crate::status_runtime::probe::record_hook(hx.w, &args);
}

/// These source optional hooks have no installed gameplay listeners in the captured world.
/// Keeping typed call sites preserves their ordering without inventing a hook-chain row.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum CastOutcome {
    Landed,
    Cancelled(crate::status_runtime::CastEndReason),
}
pub(crate) fn cast_accepted(
    _k: &MatchStatic,
    _w: &mut World,
    _ev: &mut Vec<Event>,
    _id: PlayerId,
    _ability: crate::status_runtime::AbilityId,
) {
    #[cfg(feature = "trusted-status-probes")]
    crate::status_runtime::probe::record_cast_accepted(_w, _id, _ability);
}
pub(crate) fn cast_ended(
    _k: &MatchStatic,
    _w: &mut World,
    _ev: &mut Vec<Event>,
    _id: PlayerId,
    _ability: crate::status_runtime::AbilityId,
    _outcome: CastOutcome,
) {
    #[cfg(feature = "trusted-status-probes")]
    if _outcome == CastOutcome::Landed {
        crate::status_runtime::probe::record_cast_landed(_w, _id, _ability);
    }
}
