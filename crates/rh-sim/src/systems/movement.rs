//! Walking along a path and the rewind history (legacy movement.ts).

use crate::constants::*;
use crate::math::{atan2, hypot};
use crate::sim::{Player, Sample};

/// Walks along the path at PLAYER_SPEED x `speed_mult` for `dt` seconds (legacy `advanceAlongPath`).
pub(crate) fn advance_along_path(p: &mut Player, dt: f64, keep_facing: bool, speed_mult: f64) {
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

pub(crate) fn record_history(p: &mut Player, now: f64) {
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
