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

use crate::constants::*;
use crate::rng::action_order;
use crate::sim::{PlayerId, Sim};
use movement::{advance_along_path, record_history};

impl Sim {
    pub(crate) fn update_active(&mut self) {
        let now = self.server_time;
        // markTickStart
        self.rt.bounty_at_tick_start.clear();
        for p in &mut self.players {
            p.hp_frac_at_tick_start = if p.max_hp > 0.0 {
                (p.hp + p.barrier) / p.max_hp
            } else {
                0.0
            };
            self.rt.bounty_at_tick_start.push((p.id, p.bounty));
        }
        self.ledger.clear();
        self.melee.clear();
        let join: Vec<PlayerId> = self.players.iter().map(|p| p.id).collect();
        let order = action_order(self.secrets.order_salt, self.tick, &join);
        self.rank = order.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        for id in &order {
            if let Some(i) = self.idx(*id) {
                self.apply_inputs(i);
            }
        }
        // [abilities] [target locks]  -- not in the slice (docs/backlog)
        self.update_weapons();
        // [afterWeapons]
        let standing: Vec<usize> = (0..self.players.len())
            .filter(|&i| self.players[i].standing())
            .collect();
        let mults: Vec<f64> = standing
            .iter()
            .map(|&i| {
                let m = self.move_multiplier(i);
                if m > 0.0 && m < MOVE_MULT_FLOOR {
                    MOVE_MULT_FLOOR
                } else {
                    m
                }
            })
            .collect();
        let dt = TICK_MS / 1000.0;
        for (k, &i) in standing.iter().enumerate() {
            let p = &mut self.players[i];
            let aiming = p.weapon.aim_at > 0.0 && now - p.weapon.aim_at < AIM_STALE_MS;
            advance_along_path(p, dt, aiming, mults[k]);
        }
        for &i in &standing {
            record_history(&mut self.players[i], now);
        }
        // [projectile sweep, spawns] -- not in the slice
        self.resolve_melee();
        // [beforeDamage: signatures, terrain, statuses] [sudden death] -- not in the slice
        self.apply_ledger();
        // systems
        self.flush_bounty_announcements();
        self.settle();
    }
}
