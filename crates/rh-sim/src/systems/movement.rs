//! Walking along a path and the rewind history (legacy step.ts `walkFighter` phase, movement.ts).
//!
//! Touches the standing fighters' positions, facing, paths and history; reads the clock.

use crate::constants::*;
use crate::fighter::{FighterCore, FighterIx};
use crate::math::{atan2, hypot};
use crate::schedule;
use crate::systems::{weapons, Cx};

/// System (legacy step.ts, `movement:multipliers(moveModifiers)`): the standing fighters and every one's move speed, read
/// before anyone moves so none depends on who moved first. The speed is the weapon's own multiplier folded with the
/// live move modifiers in table order (`schedule::MOVE_MODIFIERS`, `acc * modifier(c)` left to right, so the order is
/// part of the result); the product never drops below MOVE_MULT_FLOOR while it is above 0 (a root's 0 stays 0).
pub(crate) fn multipliers(cx: &mut Cx) {
    let Cx { k, w, s, stats, .. } = cx;
    let now = w.server_time;
    s.standing.clear();
    s.mults.clear();
    for i in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(i);
        if w.standing(ix) {
            s.standing.push(ix);
            let core = w.core(ix);
            s.mults.push(weapons::move_multiplier(core, now));
        }
    }
    // Fighter-major, as legacy: each fighter's whole chain runs (in table order) before the next fighter's. None is
    // ported in the slice.
    let modifiers = schedule::Plan::of(k).move_modifiers.live();
    if !modifiers.is_empty() {
        for (m, &i) in s.mults.iter_mut().zip(&s.standing) {
            for &(_, modifier) in modifiers {
                *m *= modifier(w, w.core(i), TICK_MS, stats.view(w.core(i)));
            }
        }
    }
    for m in s.mults.iter_mut() {
        if *m > 0.0 && *m < MOVE_MULT_FLOOR {
            *m = MOVE_MULT_FLOOR;
        }
    }
}

/// System (legacy step.walkFighter): every standing fighter walks its path at its tick speed, in join order.
pub(crate) fn walk(cx: &mut Cx) {
    let Cx { w, s, .. } = cx;
    let now = w.server_time;
    let dt = TICK_MS / 1000.0;
    for (&ix, &mult) in s.standing.iter().zip(&s.mults) {
        let p = w.core_mut(ix);
        let aiming = p.weapon.aim_at > 0.0 && now - p.weapon.aim_at < AIM_STALE_MS;
        advance_along_path(p, dt, aiming, mult);
    }
}

/// System (legacy movement.recordHistory): recorded after everyone moved, so hit tests see one consistent tick. Ends
/// the tick's movement: the standing list and the multipliers are spent.
pub(crate) fn record_history(cx: &mut Cx) {
    let Cx { w, s, .. } = cx;
    let now = w.server_time;
    for &ix in &s.standing {
        record_sample(w.core_mut(ix), now);
    }
    s.standing.clear();
    s.mults.clear();
}

/// Walks along the path at PLAYER_SPEED x `speed_mult` for `dt` seconds (legacy `advanceAlongPath`).
fn advance_along_path(p: &mut FighterCore, dt: f64, keep_facing: bool, speed_mult: f64) {
    let mut budget = PLAYER_SPEED * speed_mult * dt;
    while budget > 0.0 && !p.motion.path.is_empty() {
        let Some(target) = p.motion.path.first() else {
            break;
        };
        let dx = target.x - p.body.x;
        let dy = target.y - p.body.y;
        let dist = hypot(dx, dy);
        if dist <= budget {
            p.body.x = target.x;
            p.body.y = target.y;
            budget -= dist;
            p.motion.path.advance();
        } else {
            p.body.x += (dx / dist) * budget;
            p.body.y += (dy / dist) * budget;
            budget = 0.0;
        }
        if dist > FACING_EPS && !keep_facing {
            p.body.facing = atan2(dy, dx);
        }
    }
}

fn record_sample(p: &mut FighterCore, now: f64) {
    let (x, y) = (p.body.x, p.body.y);
    p.body.history.record(now, x, y);
}
