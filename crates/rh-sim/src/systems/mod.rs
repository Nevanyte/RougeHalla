//! The tick's systems, one module per legacy module: inputs (step.ts applyInputs), weapons (weapons.ts), movement
//! (step.ts walkFighter, movement.ts), melee (melee.ts), ledger (the damage ledger, arena.ts applyHits), credit (kill
//! credit and bounty, feed.ts), settle (arena.ts markTickStart, downPlayer, settle) and lobby.
//!
//! Every system entry point is `fn(&mut Cx)` and destructures only what it touches; helpers below an entry point take
//! the narrowest borrows (often one fighter and the clock). [`update_active`] is the legacy `updateActive` order
//! (C-TICK): never reorder it.

pub(crate) mod credit;
pub(crate) mod inputs;
pub(crate) mod ledger;
pub(crate) mod lobby;
pub(crate) mod melee;
pub(crate) mod movement;
pub(crate) mod settle;
pub(crate) mod weapons;

use crate::events::Event;
use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::state::{Phase, World};
use crate::statics::MatchStatic;

/// What a system runs over: the match statics (read only), the world, the tick scratch, the step's event log and the
/// path search scratch, as disjoint borrows.
pub(crate) struct Cx<'a> {
    pub(crate) k: &'a MatchStatic,
    pub(crate) w: &'a mut World,
    pub(crate) s: &'a mut TickScratch,
    pub(crate) ev: &'a mut Vec<Event>,
    pub(crate) pf: &'a mut Pathfinder,
}

/// One fixed step of the phase the match is in (the clock has already advanced).
pub(crate) fn step(cx: &mut Cx) {
    match cx.w.phase {
        Phase::Lobby => lobby::update(cx),
        Phase::Active => update_active(cx),
        Phase::Ended => inputs::drain_all(cx),
    }
}

/// Legacy `updateActive` (packages/server/src/sim/step.ts), in its order. The bracketed phases are not in the slice
/// (docs/backlog/README.md) and go in at their legacy position.
fn update_active(cx: &mut Cx) {
    settle::mark_tick_start(cx);
    ledger::open(cx);
    inputs::apply_all(cx);
    // [abilities] [target locks]
    weapons::update(cx);
    // [afterWeapons]
    movement::walk(cx);
    // [projectile sweep, spawns]
    melee::resolve(cx);
    // [beforeDamage: signatures, terrain, statuses] [sudden death]
    ledger::apply(cx);
    // systems: [fireRoam, factions.afterDamage, factions.healOverTime, mobs.resetDummies, buffs.expireBoosts] then
    // feed.flushAnnouncements, then the rest of the systems list
    credit::flush_announcements(cx);
    settle::settle(cx);
}
