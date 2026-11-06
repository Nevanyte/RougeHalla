//! The tick's systems, one module per legacy module: inputs (step.ts applyInputs), weapons (weapons.ts), movement
//! (step.ts walkFighter, movement.ts), melee (melee.ts), ledger (the damage ledger, arena.ts applyHits), credit (kill
//! credit and bounty, feed.ts), settle (arena.ts markTickStart, downPlayer, settle), loot (the dropBody hook link) and
//! lobby.
//!
//! Every system entry point is `fn(&mut Cx)` and destructures only what it touches; helpers below an entry point take
//! the narrowest borrows (often one fighter and the clock). Which systems run, and in which order, is the table in
//! `schedule.rs` ([`update_active`] runs `schedule::PHASES`, the legacy `updateActive` order, C-TICK): a system is never
//! called from anywhere else, and a mechanic packet adds `systems/<mechanic>.rs` plus the flip of its rows.

pub(crate) mod credit;
pub(crate) mod displace;
pub(crate) mod fields;
pub(crate) mod fire;
pub(crate) mod frost;
pub(crate) mod heal;
pub(crate) mod initial_loot;
pub(crate) mod inputs;
pub(crate) mod items;
pub(crate) mod ledger;
pub(crate) mod lobby;
pub(crate) mod loot;
pub(crate) mod melee;
pub(crate) mod mobs;
pub(crate) mod movement;
pub(crate) mod plague;
pub(crate) mod potions;
pub(crate) mod projectiles;
pub(crate) mod sentenced;
pub(crate) mod settle;
pub(crate) mod signatures;
pub(crate) mod status;
pub(crate) mod targeting;
pub(crate) mod terrain;
pub(crate) mod weapons;

use crate::events::Event;
use crate::input::{validate, Command, RawCommand, Reject};
use crate::pathfind::Pathfinder;
use crate::schedule;
use crate::scratch::TickScratch;
use crate::state::{Phase, PlayerId, World};
use crate::statics::MatchStatic;

/// What a system runs over: the match statics (read only), the world, the tick scratch, the step's event log and the
/// path search scratch, as disjoint borrows.
pub(crate) struct Cx<'a> {
    pub(crate) stats: crate::status_runtime::stats::Inputs<'a>,
    #[cfg(feature = "trusted-status-probes")]
    pub(crate) probe: Option<&'a mut crate::status_runtime::probe::HurtRecipe>,
    pub(crate) k: &'a MatchStatic,
    pub(crate) w: &'a mut World,
    pub(crate) s: &'a mut TickScratch,
    pub(crate) ev: &'a mut Vec<Event>,
    pub(crate) pf: &'a mut Pathfinder,
}

impl Cx<'_> {
    /// An actor inside the sim (a future mob brain) queues a validated command for `id`'s next tick: exactly
    /// `Sim::submit` (the seat's order budget in sim time, then the queue's arrival-order rules), the only way anything
    /// acts (C-INPUT). A command for a seat that is not present is dropped, as `Sim::submit` does.
    pub(crate) fn submit(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        inputs::submit(self.w, id, cmd)
    }

    /// Like [`Cx::submit`] for a proposal that is not validated yet: it goes through [`validate`] first.
    #[cfg_attr(not(test), allow(dead_code))] // the first in-sim actor is the mob brain (P-MOBS-1)
    pub(crate) fn propose(&mut self, id: PlayerId, raw: RawCommand) -> Result<(), Reject> {
        let cmd = validate(raw)?;
        self.submit(id, cmd)
    }
}

/// One fixed step of the phase the match is in (the clock has already advanced).
pub(crate) fn step(cx: &mut Cx) {
    cx.s.performed.clear();
    cx.s.performed_bounded = true;
    match cx.w.phase {
        Phase::Lobby => lobby::update(cx),
        Phase::Active => update_active(cx),
        Phase::Ended => inputs::drain_all(cx),
    }
}

/// Legacy `updateActive` (packages/server/src/sim/step.ts): the rows of `schedule::PHASES`, in order, that the match's
/// world has (its gates) and that are ported, resolved once at compile time (`schedule::Plan`). The phases whose
/// mechanics are not in the slice are `Pending` rows there (docs/backlog/README.md).
fn update_active(cx: &mut Cx) {
    schedule::run_steps(cx, schedule::Plan::of(cx.k).phases.live());
}

#[cfg(test)]
mod tests;

pub(crate) mod mob_ai;

pub(crate) mod mob_life;

pub(crate) mod mob_checkpoint;
