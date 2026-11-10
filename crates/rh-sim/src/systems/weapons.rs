//! The weapon state machine: aim, press/release, windup, landing, stagger (legacy weapons.ts).
//!
//! Touches one fighter at a time and the clock; an attack start emits its windup, a landed swing joins the tick's melee
//! queue.

use crate::constants::*;
use crate::content::{mirror_timings, weapon, Shape, Timings, WeaponId};
use crate::events::Event;
use crate::fighter::{FighterCore, FighterIx};
use crate::input::ActionCmd;
use crate::state::{ActionKind, PendingAction};
use crate::systems::melee::MeleeReq;
use crate::systems::projectiles::Spawn;
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
    super::targeting::drop_lock(p);
    p.weapon.targeting.attack_move = None;
    if !crate::status_runtime::has(
        &p.statuses.instances,
        crate::status_runtime::StatusKind::Stun,
        now,
    ) {
        set_aim(p, now, a);
    }
    note_lag(p, now, t);
    let w = &mut p.weapon;
    if !w.held {
        w.pressed_at = now;
    }
    w.held = true;
    w.buffered_until = now + ATTACK_BUFFER_MS;
}

pub(crate) fn handle_release(p: &mut FighterCore, now: f64, a: f64, t: Option<f64>) {
    if p.weapon.targeting.target.is_none()
        && !crate::status_runtime::has(
            &p.statuses.instances,
            crate::status_runtime::StatusKind::Stun,
            now,
        )
    {
        set_aim(p, now, a);
    }
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
    cx.s.attack_started.fill(false);
    for i in 0..cx.w.fighter_count() {
        if cx.w.standing(FighterIx::of_slot(i)) {
            step_weapon(cx, FighterIx::of_slot(i));
        }
    }
}

fn step_weapon(cx: &mut Cx, ix: FighterIx) {
    let now = cx.w.server_time;
    let weapon = cx.w.core(ix).active_weapon();
    if let Some(act) = cx.w.core(ix).weapon.action {
        if now + TIE_EPS_MS >= act.lands_at {
            land(cx, ix, act);
        }
    }
    let npc = !cx.w.is_player(ix);
    let zombie_profile = super::plague_zombies::attack_profile(cx.k, cx.w, cx.w.core(ix).id);
    let sheet = cx.w.paced_faction_spec(ix);
    let base_hp = cx.w.faction_spec(ix).map(|f| f.hp);
    let p = cx.w.core_mut(ix);
    let wants = p.weapon.held || now <= p.weapon.buffered_until;
    if p.weapon.action.is_none()
        && wants
        && now + TIE_EPS_MS >= p.weapon.ready_at
        && !crate::status_runtime::action_blocked(&p.statuses, now)
    {
        let (tm, packet) = if let Some((tm, packet)) = zombie_profile {
            (tm, packet)
        } else {
            let Some(sheet) = sheet else {
                return;
            };
            let base_hp = base_hp.expect("faction sheet has base HP");
            let f = sheet;
            let tm = mirror_timings(
                &f,
                weapon,
                crate::stat_fold::decode_mult(p.modifiers.attack_rate_wire()),
                p.modifiers.mirrors().windup_mult,
                npc,
            );
            let packet = if npc {
                crate::modifiers::packet_with_sheet(p, weapon, &sheet, base_hp)
            } else {
                crate::modifiers::packet(p, weapon)
            };
            (tm, packet)
        };
        start_attack(p, now, cx.ev, weapon, tm, packet);
        let id = p.id;
        if cx.k.config.faction_mode.frost() {
            // Cover a fighter raised mid-tick after the last reserve point (see frost::after_weapons).
            cx.s.reserve_actors(cx.w.fighter_count());
            cx.s.attack_started[ix.slot()] = true;
        }
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: cx.stats,
                fx: None,
                k: cx.k,
                w: cx.w,
                ev: cx.ev,
            },
            crate::hooks::HookArgs::AttackStarted(id),
        );
        let p = cx.w.core_mut(ix);
        if tm.windup == 0.0 {
            if let Some(act) = p.weapon.action {
                land(cx, ix, act);
            }
        }
    }
}

fn start_attack(
    p: &mut FighterCore,
    now: f64,
    ev: &mut Vec<Event>,
    weapon: WeaponId,
    tm: Timings,
    packet: crate::state::Packet,
) {
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
        target: p
            .weapon
            .targeting
            .target
            .filter(|_| weapon == WeaponId::Wand),
        started_at: start,
        lands_at,
        a: aim,
        packet,
        roam_armed: false,
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

fn land(cx: &mut Cx, ix: FighterIx, act: PendingAction) {
    let now = cx.w.server_time;
    let target = act
        .target
        .and_then(|id| cx.w.fighter_idx(id))
        .filter(|&other| cx.w.standing(other) && other != ix)
        .map(|other| (cx.w.core(other).id, cx.w.core(other).pos()));
    let p = cx.w.core_mut(ix);
    p.weapon.action = None;
    match act.kind {
        ActionKind::Swing => {
            let rewind_t = now - MAX_REWIND_MS.min(TICK_MS.max(p.weapon.lag_ms));
            let attacker = p.id;
            cx.s.melee.push(MeleeReq {
                attacker,
                weapon: act.weapon,
                a: act.a,
                rewind_t,
                packet: act.packet,
            });
        }
        ActionKind::Cast | ActionKind::Draw => {
            p.weapon.last_shot_at = Some(now);
            let aim = if let Some((_, at)) = target {
                crate::math::atan2(at.y - p.body.y, at.x - p.body.x)
            } else if act.kind == ActionKind::Draw {
                p.weapon.aim
            } else {
                act.a
            };
            cx.s.flight.spawns.push(Spawn {
                target: target.map(|(id, _)| id),
                owner: p.id,
                weapon: act.weapon,
                aim,
                packet: act.packet,
                roam_armed: act.roam_armed,
            });
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

/// Legacy `stagger`, part 1: the immunity gate and its clock. The `staggered` hook fires between this and the
/// cancel (the abilities chain reads the pending cast there); true means the hit staggered this fighter.
pub(crate) fn stagger_immunity(p: &mut FighterCore, now: f64) -> bool {
    if now < p.weapon.stagger_immune_until {
        return false;
    }
    p.weapon.stagger_immune_until = now + STAGGER_IMMUNITY_SECONDS * 1000.0;
    true
}

/// Legacy `stagger`, part 2: cancels a pending swing or cast (not a draw).
pub(crate) fn stagger_cancel(p: &mut FighterCore, now: f64, ev: &mut Vec<Event>) {
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

/// Legacy `releaseTrigger`: clear target orders, let go of the trigger and cancel what was in progress
/// (no landing; a pending swing or cast takes its root with it).
pub(crate) fn release_trigger(p: &mut FighterCore, now: f64) {
    super::targeting::drop_lock(p);
    p.weapon.targeting.attack_move = None;
    p.weapon.held = false;
    p.weapon.buffered_until = 0.0;
    cancel_action(p, now);
}

pub(super) fn cancel_locked(p: &mut FighterCore, now: f64, ev: &mut Vec<Event>) {
    if let Some(act) = p.weapon.action.filter(|a| a.target.is_some()) {
        p.weapon.ready_at = act.started_at;
        cancel_action(p, now);
        ev.push(Event::AttackCancelled { id: p.id });
    }
}

pub(crate) fn cancel_action(p: &mut FighterCore, now: f64) {
    if p.weapon.action.is_some_and(|a| a.kind != ActionKind::Draw) {
        p.weapon.root_until = p.weapon.root_until.min(now);
    }
    p.weapon.action = None;
    p.weapon.draw_started_at = 0.0;
}
/// Source teleported chain: every standing fighter releases and loses its old root.
pub(crate) fn teleported(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    let now = hx.w.server_time;
    for slot in 0..hx.w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        if hx.w.standing(ix) {
            let c = hx.w.core_mut(ix);
            release_trigger(c, now);
            c.weapon.root_until = 0.;
        }
    }
}
