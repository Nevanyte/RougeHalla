//! Walking along a path and the rewind history (legacy step.ts `walkFighter` phase, movement.ts).
//!
//! Touches the standing fighters' positions, facing, paths and history; reads the clock.

use crate::constants::*;
use crate::math::{atan2, hypot};
use crate::state::{Player, Sample};
use crate::systems::{weapons, Cx};

/// System (legacy step.walkFighter + movement.recordHistory): every multiplier is read before anyone moves, so none
/// depends on who moved first; the product never drops below MOVE_MULT_FLOOR while it is above 0 (a root's 0 stays 0).
/// History is recorded after everyone moved, so hit tests see one consistent tick.
pub(crate) fn walk(cx: &mut Cx) {
    let Cx { w, .. } = cx;
    let now = w.server_time;
    let standing: Vec<usize> = (0..w.players.len())
        .filter(|&i| w.players[i].standing())
        .collect();
    let mults: Vec<f64> = standing
        .iter()
        .map(|&i| {
            let m = weapons::move_multiplier(&w.players[i], now);
            if m > 0.0 && m < MOVE_MULT_FLOOR {
                MOVE_MULT_FLOOR
            } else {
                m
            }
        })
        .collect();
    let dt = TICK_MS / 1000.0;
    for (k, &i) in standing.iter().enumerate() {
        let p = &mut w.players[i];
        let aiming = p.weapon.aim_at > 0.0 && now - p.weapon.aim_at < AIM_STALE_MS;
        advance_along_path(p, dt, aiming, mults[k]);
    }
    for &i in &standing {
        record_history(&mut w.players[i], now);
    }
}

/// Walks along the path at PLAYER_SPEED x `speed_mult` for `dt` seconds (legacy `advanceAlongPath`).
fn advance_along_path(p: &mut Player, dt: f64, keep_facing: bool, speed_mult: f64) {
    let mut budget = PLAYER_SPEED * speed_mult * dt;
    while budget > 0.0 && !p.path.is_empty() {
        let target = p.path[0];
        let dx = target.x - p.x;
        let dy = target.y - p.y;
        let dist = hypot(dx, dy);
        if dist <= budget {
            p.x = target.x;
            p.y = target.y;
            budget -= dist;
            p.path.remove(0);
        } else {
            p.x += (dx / dist) * budget;
            p.y += (dy / dist) * budget;
            budget = 0.0;
        }
        if dist > 0.001 && !keep_facing {
            p.facing = atan2(dy, dx);
        }
    }
}

fn record_history(p: &mut Player, now: f64) {
    p.history.push(Sample {
        t: now,
        x: p.x,
        y: p.y,
    });
    let cutoff = now - MAX_REWIND_MS - TICK_MS;
    while p.history.len() > 2 && p.history[0].t < cutoff {
        p.history.remove(0);
    }
}
