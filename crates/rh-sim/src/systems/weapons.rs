//! The weapon state machine: aim, press/release, windup, landing, stagger (legacy weapons.ts).
//!
//! Touches one fighter at a time and the clock; an attack start emits its windup, a landed swing joins the tick's melee
//! queue.

use crate::constants::*;
use crate::content::{
    attack_interval, damage_per_hit, damage_shares, paced, player_timings, weapon, DamageShares,
    Shape, Timings, WeaponId,
};
use crate::events::Event;
use crate::fighter::{FighterCore, FighterIx};
use crate::input::ActionCmd;
use crate::state::{ActionKind, Packet, PendingAction};
use crate::systems::melee::MeleeReq;
use crate::systems::Cx;

pub(crate) fn set_aim(p: &mut FighterCore, now: f64, a: f64) {
    p.weapon.aim = a;
    p.weapon.aim_at = now;
    p.body.facing = a;
}

fn note_lag(p: &mut FighterCore, now: f64, t: Option<f64>) {
    let lag = match t {
        None => TICK_MS,
        Some(t) => now - t,
    };
    p.weapon.lag_ms = MAX_REWIND_MS.min(TICK_MS.max(lag));
}

pub(crate) fn handle_press(p: &mut FighterCore, now: f64, a: f64, t: Option<f64>) {
    set_aim(p, now, a);
    note_lag(p, now, t);
    let w = &mut p.weapon;
    if !w.held {
        w.pressed_at = now;
    }
    w.held = true;
    w.buffered_until = now + ATTACK_BUFFER_MS;
}

pub(crate) fn handle_release(p: &mut FighterCore, now: f64, a: f64, t: Option<f64>) {
    set_aim(p, now, a);
    if t.is_some() {
        note_lag(p, now, t);
    }
    p.weapon.held = false;
}

/// Action handler `attack` (legacy weapons.ts, `world.actions.attack`): press the trigger toward the command's angle.
pub(crate) fn on_attack(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    if let ActionCmd::Attack { a, t } = *cmd {
        let now = cx.w.server_time;
        handle_press(cx.w.core_mut(ix), now, a, t);
    }
}

/// Action handler `release` (legacy weapons.ts, `world.actions.release`).
pub(crate) fn on_release(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    if let ActionCmd::Release { a, t } = *cmd {
        let now = cx.w.server_time;
        handle_release(cx.w.core_mut(ix), now, a, t);
    }
}

/// System (legacy weapons.updateWeapons): every standing fighter's weapon state machine, in join order.
pub(crate) fn update(cx: &mut Cx) {
    let Cx { w, s, ev, .. } = cx;
    let now = w.server_time;
    for p in &mut w.players {
        if p.standing() {
            step_weapon(&mut p.core, now, ev, &mut s.melee);
        }
    }
}

fn step_weapon(p: &mut FighterCore, now: f64, ev: &mut Vec<Event>, melee: &mut Vec<MeleeReq>) {
    let weapon = p.active_weapon();
    if let Some(act) = p.weapon.action {
        if now + TIE_EPS_MS >= act.lands_at {
            land(p, now, melee, act);
        }
    }
    let wants = p.weapon.held || now <= p.weapon.buffered_until;
    if p.weapon.action.is_none() && wants && now + TIE_EPS_MS >= p.weapon.ready_at {
        // The timings are pure content formulas of the faction and the weapon: read only when an attack starts.
        let f = paced(p.vitals.faction);
        let tm = player_timings(weapon, attack_interval(&f, weapon, 1.0));
        start_attack(p, now, ev, weapon, tm);
        if tm.windup == 0.0 {
            if let Some(act) = p.weapon.action {
                land(p, now, melee, act);
            }
        }
    }
}

fn start_attack(p: &mut FighterCore, now: f64, ev: &mut Vec<Event>, weapon: WeaponId, tm: Timings) {
    let f = paced(p.vitals.faction);
    let base = damage_per_hit(&f, weapon, 1.0);
    let shares: DamageShares = damage_shares(&f);
    let packet = Packet {
        raw: base,
        phys: shares.phys,
        magic: shares.magic,
        true_: shares.true_,
    };
    let start = if p.weapon.pressed_at <= p.weapon.ready_at {
        p.weapon.ready_at.max(now - TICK_MS)
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
    p.weapon.ready_at = start + tm.interval * 1000.0;
    if tm.root > 0.0 {
        p.weapon.root_until = start + tm.root * 1000.0;
    }
    let id = p.id;
    if weapon == WeaponId::Bow {
        p.weapon.draw_started_at = start;
    } else {
        ev.push(Event::Windup {
            by: id,
            weapon,
            a: aim,
            ms: (lands_at - now).max(0.0),
        });
    }
}

fn land(p: &mut FighterCore, now: f64, melee: &mut Vec<MeleeReq>, act: PendingAction) {
    p.weapon.action = None;
    match act.kind {
        ActionKind::Swing => {
            let rewind_t = now - MAX_REWIND_MS.min(TICK_MS.max(p.weapon.lag_ms));
            let attacker = p.id;
            melee.push(MeleeReq {
                attacker,
                weapon: act.weapon,
                a: act.a,
                rewind_t,
                packet: act.packet,
            });
        }
        ActionKind::Cast | ActionKind::Draw => {
            // The release ends its movement pause. Projectile creation belongs to P-COMBAT-2.
            p.weapon.draw_started_at = 0.0;
        }
    }
}

/// The weapon's own movement multiplier (legacy `moveMultiplierOf`): 0 while a swing winds up, a shot is released or
/// a root holds, else 1.
pub(crate) fn move_multiplier(p: &FighterCore, now: f64) -> f64 {
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

/// Legacy `stagger`: cancels a pending swing or cast (not a draw), once per immunity window.
pub(crate) fn stagger(p: &mut FighterCore, now: f64, ev: &mut Vec<Event>) {
    if now < p.weapon.stagger_immune_until {
        return;
    }
    p.weapon.stagger_immune_until = now + STAGGER_IMMUNITY_SECONDS * 1000.0;
    if let Some(a) = p.weapon.action {
        if a.kind != ActionKind::Draw {
            cancel_action(p, now);
            let id = p.id;
            ev.push(Event::Stagger { id });
        }
    }
}

pub(crate) fn weapon_shape(w: WeaponId) -> Shape {
    weapon(w).shape
}

/// Legacy `releaseTrigger` for the slice (no lock, no attack-move): let go of the trigger and cancel what was in progress
/// (no landing; a pending swing or cast takes its root with it).
pub(crate) fn release_trigger(p: &mut FighterCore, now: f64) {
    p.weapon.held = false;
    p.weapon.buffered_until = 0.0;
    cancel_action(p, now);
}

pub(crate) fn cancel_action(p: &mut FighterCore, now: f64) {
    if p.weapon.action.is_some_and(|a| a.kind != ActionKind::Draw) {
        p.weapon.root_until = p.weapon.root_until.min(now);
    }
    p.weapon.action = None;
    p.weapon.draw_started_at = 0.0;
}
