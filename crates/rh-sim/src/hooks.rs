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
//! * a link gets a [`Hx`], not the whole tick: the statics, the world and the event log. It cannot touch the tick scratch
//!   or the path search, so a reaction decides from its arguments and the world and defers what it pays, never mid-pass
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

/// What a hook link may touch (see the module docs).
pub(crate) struct Hx<'a> {
    pub(crate) k: &'a MatchStatic,
    pub(crate) w: &'a mut World,
    pub(crate) ev: &'a mut Vec<Event>,
}

impl Hx<'_> {
    /// Legacy `payLater`: pays after every victim of the ledger pass took their damage (same tick), or at once when the
    /// hook fires outside the pass.
    #[cfg_attr(not(test), allow(dead_code))] // the first link that pays later is P-ABIL-1 / P-STATUS-1; tests use it now
    pub(crate) fn pay_later(&mut self, p: PayLater) {
        ledger::pay_later(self.w, self.ev, p);
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
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum HookArgs {
    /// The lobby just turned into an active raid: players are placed (legacy `raidStarted(world)`).
    RaidStarted,
    /// A player went down with their run gear still on them (legacy `dropBody(world, p)`).
    DropBody { victim: PlayerId },
    /// A fighter left the fight for good (legacy `fighterOut(world, id, cause)`).
    FighterOut { id: PlayerId, cause: OutCause },
    /// The run just ended: results are out and the phase is ended (legacy `runEnded(world)`).
    RunEnded,
}

impl HookArgs {
    pub(crate) const fn hook(&self) -> Hook {
        match self {
            HookArgs::RaidStarted => Hook::RaidStarted,
            HookArgs::DropBody { .. } => Hook::DropBody,
            HookArgs::FighterOut { .. } => Hook::FighterOut,
            HookArgs::RunEnded => Hook::RunEnded,
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
        if let Run::Ported(f) = link.run {
            #[cfg(feature = "schedule-trace")]
            hx.w.trace
                .push(schedule::TraceEntry::Hook(hook.key(), link.legacy));
            f(hx, &args);
        }
    }
}
