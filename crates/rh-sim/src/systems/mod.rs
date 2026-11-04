//! The tick's systems, one module per legacy module (weapons.ts, melee.ts, arena.ts, feed.ts, movement.ts, step.ts).
//! `update_active` is the legacy `updateActive` order (C-TICK): never reorder it.

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
use crate::rng::action_order;
use crate::scratch::TickScratch;
use crate::sim::{PlayerId, Sim};
use crate::state::World;
use crate::statics::MatchStatic;

/// What a system runs over: the match statics (read only), the world, the tick scratch, the step's event log and the
/// path search scratch, as disjoint borrows. A system destructures what it touches.
#[allow(dead_code)] // transitional: every field is read once every system runs over a Cx
pub(crate) struct Cx<'a> {
    pub(crate) k: &'a MatchStatic,
    pub(crate) w: &'a mut World,
    pub(crate) s: &'a mut TickScratch,
    pub(crate) ev: &'a mut Vec<Event>,
    pub(crate) pf: &'a mut Pathfinder,
}

impl Sim {
    /// Runs `f` over a [`Cx`] borrowed from this sim; its events join the ones waiting in the world, in order.
    pub(crate) fn with_cx<R>(&mut self, f: impl FnOnce(&mut Cx<'_>) -> R) -> R {
        let mut ev = std::mem::take(&mut self.w.pending_events);
        let r = f(&mut Cx {
            k: &self.k,
            w: &mut self.w,
            s: &mut self.s,
            ev: &mut ev,
            pf: &mut self.pf,
        });
        debug_assert!(self.w.pending_events.is_empty());
        self.w.pending_events = ev;
        r
    }
}

impl Sim {
    pub(crate) fn update_active(&mut self) {
        // markTickStart
        self.s.bounty_at_tick_start.clear();
        for p in &mut self.w.players {
            p.hp_frac_at_tick_start = if p.max_hp > 0.0 {
                (p.hp + p.barrier) / p.max_hp
            } else {
                0.0
            };
            self.s.bounty_at_tick_start.push((p.id, p.bounty));
        }
        self.s.ledger.clear();
        self.s.melee.clear();
        let join: Vec<PlayerId> = self.w.players.iter().map(|p| p.id).collect();
        let order = action_order(self.k.secrets.order_salt, self.w.tick, &join);
        self.s.rank = order.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        for id in &order {
            if let Some(i) = self.idx(*id) {
                self.apply_inputs(i);
            }
        }
        // [abilities] [target locks]  -- not in the slice (docs/backlog)
        self.with_cx(weapons::update);
        // [afterWeapons]
        self.with_cx(movement::walk);
        // [projectile sweep, spawns] -- not in the slice
        self.with_cx(melee::resolve);
        // [beforeDamage: signatures, terrain, statuses] [sudden death] -- not in the slice
        self.with_cx(ledger::apply);
        // systems
        self.with_cx(credit::flush_announcements);
        self.with_cx(settle::settle);
    }
}
