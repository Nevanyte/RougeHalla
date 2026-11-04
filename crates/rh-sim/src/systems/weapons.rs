//! The weapon state machine: aim, press/release, windup, landing, stagger (legacy weapons.ts).

use crate::constants::*;
use crate::content::{
    attack_interval, damage_per_hit, damage_shares, paced, player_timings, weapon, DamageShares,
    Shape, WeaponId,
};
use crate::sim::{ActionKind, Event, Packet, PendingAction, Player, Sim};
use crate::systems::melee::MeleeReq;

impl Sim {
    pub(crate) fn set_aim(&mut self, i: usize, a: f64) {
        let now = self.w.server_time;
        let p = &mut self.w.players[i];
        p.weapon.aim = a;
        p.weapon.aim_at = now;
        p.facing = a;
    }

    pub(crate) fn note_lag(&mut self, i: usize, t: Option<f64>) {
        let lag = match t {
            None => TICK_MS,
            Some(t) => self.w.server_time - t,
        };
        self.w.players[i].weapon.lag_ms = MAX_REWIND_MS.min(TICK_MS.max(lag));
    }

    pub(crate) fn handle_press(&mut self, i: usize, a: f64, t: Option<f64>) {
        let now = self.w.server_time;
        self.set_aim(i, a);
        self.note_lag(i, t);
        let w = &mut self.w.players[i].weapon;
        if !w.held {
            w.pressed_at = now;
        }
        w.held = true;
        w.buffered_until = now + ATTACK_BUFFER_MS;
    }

    pub(crate) fn handle_release(&mut self, i: usize, a: f64, t: Option<f64>) {
        self.set_aim(i, a);
        if t.is_some() {
            self.note_lag(i, t);
        }
        self.w.players[i].weapon.held = false;
    }

    pub(crate) fn update_weapons(&mut self) {
        for i in 0..self.w.players.len() {
            if self.w.players[i].standing() {
                self.step_weapon(i);
            }
        }
    }

    pub(crate) fn step_weapon(&mut self, i: usize) {
        let now = self.w.server_time;
        let weapon = self.w.players[i].active_weapon();
        let f = paced(self.w.players[i].faction);
        let tm = player_timings(weapon, attack_interval(&f, weapon, 1.0));
        if let Some(act) = self.w.players[i].weapon.action {
            if now + TIE_EPS_MS >= act.lands_at {
                self.land(i, act);
            }
        }
        let p = &self.w.players[i];
        let wants = p.weapon.held || now <= p.weapon.buffered_until;
        if p.weapon.action.is_none() && wants && now + TIE_EPS_MS >= p.ready_at {
            self.start_attack(i, weapon, tm);
            if tm.windup == 0.0 {
                if let Some(act) = self.w.players[i].weapon.action {
                    self.land(i, act);
                }
            }
        }
    }

    pub(crate) fn start_attack(&mut self, i: usize, weapon: WeaponId, tm: crate::content::Timings) {
        let now = self.w.server_time;
        let f = paced(self.w.players[i].faction);
        let base = damage_per_hit(&f, weapon, 1.0);
        let shares: DamageShares = damage_shares(&f);
        let packet = Packet {
            raw: base,
            phys: shares.phys,
            magic: shares.magic,
            true_: shares.true_,
        };
        let p = &mut self.w.players[i];
        let start = if p.weapon.pressed_at <= p.ready_at {
            p.ready_at.max(now - TICK_MS)
        } else {
            now
        };
        p.weapon.buffered_until = 0.0;
        let lands_at = start + tm.windup * 1000.0;
        let kind = match (weapon, weapon_shape(weapon)) {
            (_, Shape::Arc { .. }) => ActionKind::Swing,
            (WeaponId::Bow, _) => ActionKind::Draw,
            _ => ActionKind::Cast,
        };
        let aim = p.weapon.aim;
        p.weapon.action = Some(PendingAction {
            kind,
            weapon,
            started_at: start,
            lands_at,
            a: aim,
            packet,
        });
        p.ready_at = start + tm.interval * 1000.0;
        if tm.root > 0.0 {
            p.weapon.root_until = start + tm.root * 1000.0;
        }
        let id = p.id;
        if weapon == WeaponId::Bow {
            p.draw_started_at = start;
        } else {
            self.emit(Event::Windup {
                by: id,
                weapon,
                a: aim,
                ms: (lands_at - now).max(0.0),
            });
        }
    }

    pub(crate) fn land(&mut self, i: usize, act: PendingAction) {
        let now = self.w.server_time;
        let p = &mut self.w.players[i];
        p.weapon.action = None;
        match act.kind {
            ActionKind::Swing => {
                let rewind_t = now - MAX_REWIND_MS.min(TICK_MS.max(p.weapon.lag_ms));
                let attacker = p.id;
                self.s.melee.push(MeleeReq {
                    attacker,
                    weapon: act.weapon,
                    a: act.a,
                    rewind_t,
                    packet: act.packet,
                });
            }
            ActionKind::Cast | ActionKind::Draw => {
                // Projectiles are not in the slice and no ranged weapon can be held in it (no item flow): docs/backlog P-COMBAT-2.
                debug_assert!(false, "ranged attacks are not in the slice");
                p.draw_started_at = 0.0;
            }
        }
    }

    pub(crate) fn move_multiplier(&self, i: usize) -> f64 {
        let p = &self.w.players[i];
        let now = self.w.server_time;
        let winding = match p.weapon.action {
            Some(a) => a.kind == ActionKind::Swing || now >= a.lands_at - RANGED_RELEASE_PAUSE_MS,
            None => false,
        };
        if winding || now < p.weapon.root_until {
            0.0
        } else {
            1.0
        }
    }

    pub(crate) fn stagger(&mut self, i: usize) {
        let now = self.w.server_time;
        let p = &mut self.w.players[i];
        if now < p.weapon.stagger_immune_until {
            return;
        }
        p.weapon.stagger_immune_until = now + STAGGER_IMMUNITY_SECONDS * 1000.0;
        if let Some(a) = p.weapon.action {
            if a.kind != ActionKind::Draw {
                p.weapon.root_until = p.weapon.root_until.min(now);
                p.weapon.action = None;
                p.draw_started_at = 0.0;
                let id = p.id;
                self.emit(Event::Stagger { id });
            }
        }
    }
}

pub(crate) fn weapon_shape(w: WeaponId) -> Shape {
    weapon(w).shape
}

/// Legacy `releaseTrigger` for the slice (no lock, no attack-move): let go of the trigger and cancel what was in progress
/// (no landing; a pending swing or cast takes its root with it).
pub(crate) fn release_trigger(p: &mut Player, now: f64) {
    p.weapon.held = false;
    p.weapon.buffered_until = 0.0;
    if let Some(a) = p.weapon.action {
        if a.kind != ActionKind::Draw {
            p.weapon.root_until = p.weapon.root_until.min(now);
        }
    }
    p.weapon.action = None;
    p.draw_started_at = 0.0;
}
