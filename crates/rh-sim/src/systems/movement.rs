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
                let view = stats.view(w.core(i));
                *m *= modifier(k, w, i, TICK_MS, view);
            }
        }
    }
    for m in s.mults.iter_mut() {
        *m = floor_multiplier(*m);
    }
}

/// System (legacy step.walkFighter): every standing fighter walks its path at its tick speed, in join order.
pub(crate) fn walk(cx: &mut Cx) {
    let Cx { k, w, s, pf, .. } = cx;
    for (&ix, &mult) in s.standing.iter().zip(&s.mults) {
        walk_one(k, w, ix, pf, TICK_MS, None, mult);
    }
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn walk_one(
    k: &crate::statics::MatchStatic,
    w: &mut crate::state::World,
    ix: FighterIx,
    pf: &mut crate::pathfind::Pathfinder,
    dt_ms: f64,
    keep_facing: Option<bool>,
    mult: f64,
) {
    let now = w.server_time;
    let dt = dt_ms / 1000.;
    let core = w.core(ix);
    let faction = (k.config.hazards != crate::terrain::Mode::All)
        .then(|| core.faction_id())
        .flatten();
    let slippery = k.hazards.slip && super::terrain::slip_allowed(w, ix);
    let map = k.collision_map(w.rt.gates_locked);
    let accel = if slippery {
        crate::terrain::at(map, core.body.x, core.body.y, faction).accel
    } else {
        0.
    };
    if accel > 0. {
        w.terrain.seconds[2] += dt_ms / 1000.;
    }
    let p = w.core_mut(ix);
    let aiming =
        keep_facing.unwrap_or(p.weapon.aim_at > 0.0 && now - p.weapon.aim_at < AIM_STALE_MS);
    if accel == 0. {
        if p.motion.slip.take().is_some() {
            let foot = p.foot();
            super::terrain::walk::regrip(map, p.pos(), &mut p.motion.path, pf, foot);
        }
        advance_along_path(p, dt, aiming, mult);
    } else {
        let pos = p.pos();
        let foot = p.foot();
        let mut slip = p.motion.slip.take().unwrap_or_else(|| {
            let velocity = tick_velocity(p.body.history.as_slice());
            super::terrain::walk::new_slip(pos, velocity)
        });
        let mut pos = pos;
        super::terrain::walk::walk(
            map,
            &mut pos,
            &mut slip,
            &mut p.motion.path,
            dt_ms,
            PLAYER_SPEED * mult,
            |x, y| crate::terrain::at(map, x, y, faction).accel,
            now,
            foot,
            pf,
        );
        p.body.x = pos.x;
        p.body.y = pos.y;
        if !aiming && mult > 0. {
            if let Some(t) = p.motion.path.first() {
                let dx = t.x - pos.x;
                let dy = t.y - pos.y;
                if dx * dx + dy * dy > 1e-6 {
                    p.body.facing = atan2(dy, dx);
                }
            }
        }
        p.motion.slip = Some(slip);
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

pub(crate) fn floor_multiplier(m: f64) -> f64 {
    if m > 0. && m < MOVE_MULT_FLOOR {
        MOVE_MULT_FLOOR
    } else {
        m
    }
}

pub(crate) fn tick_velocity(h: &[crate::state::Sample]) -> crate::Vec2 {
    if h.len() < 2 {
        return crate::Vec2::new(0., 0.);
    }
    let a = h[h.len() - 2];
    let b = h[h.len() - 1];
    let dt = (b.t - a.t) / 1000.;
    if dt > 0. {
        crate::Vec2::new((b.x - a.x) / dt, (b.y - a.y) / dt)
    } else {
        crate::Vec2::new(0., 0.)
    }
}
