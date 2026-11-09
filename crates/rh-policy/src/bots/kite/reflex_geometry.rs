//! Native port of the source bot's pure reflex geometry (packages/server/src/bots/brain/tactics/kite.ts):
//! angleGap and the private projectile course. Fixed-fact component only; no perception/frame/public fact access,
//! no hidden projectile publication, no bot activation.
use rh_sim::constants::{PLAYER_RADIUS, RANGED_SLACK};
use rh_sim::{math, Vec2};

/// A projectile fact declared by the method caller (a pure probe, never a World/ordinary-physics history).
/// from_self is the actual source equality predicate (pr.from === self.id), not a raw actor identifier.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CourseFacts {
    pub from_self: bool,
    pub origin: Vec2,
    pub at: Vec2,
    pub velocity: Vec2,
    pub range: f64,
}

/// The source course result: milliseconds to impact, signed lateral offset and the unit normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Course {
    pub tti_ms: f64,
    pub offset: f64,
    pub nx: f64,
    pub ny: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeometryError {
    InvalidFacts,
}

// Source constants: OWN_ORIGIN is the private kde.ts literal; RANGED_HIT_REACH is the shared
// PLAYER_RADIUS + RANGED_SLACK and SIDESTEP_U adds another PLAYER_RADIUS.
const OWN_ORIGIN: f64 = 20.0;
const RANGED_HIT_REACH: f64 = PLAYER_RADIUS + RANGED_SLACK;
const SIDESTEP_U: f64 = RANGED_HIT_REACH + PLAYER_RADIUS;

fn finite_vec(v: Vec2) -> bool {
    v.x.is_finite() && v.y.is_finite()
}

/// Source angleGap(a, b): smallest absolute angle difference, refusing nonfinite inputs distinctly before the math.
pub fn angle_gap(a: f64, b: f64) -> Result<f64, GeometryError> {
    if !a.is_finite() || !b.is_finite() {
        return Err(GeometryError::InvalidFacts);
    }
    let d = (a - b).abs() % (2.0 * math::PI);
    Ok(if d > math::PI { 2.0 * math::PI - d } else { d })
}

/// Source course(pr, self, lagMs) with the exact strict/equal branch predicates and binary64 operation order.
/// Refuses nonfinite facts/self/lag before any computation; a null source result maps to Ok(None).
pub fn projectile_course(
    facts: CourseFacts,
    self_at: Vec2,
    lag_ms: f64,
) -> Result<Option<Course>, GeometryError> {
    if !finite_vec(facts.origin)
        || !finite_vec(facts.at)
        || !finite_vec(facts.velocity)
        || !finite_vec(self_at)
        || !facts.range.is_finite()
        || !lag_ms.is_finite()
    {
        return Err(GeometryError::InvalidFacts);
    }
    if facts.from_self {
        return Ok(None);
    }
    let dx = facts.origin.x - self_at.x;
    let dy = facts.origin.y - self_at.y;
    if math::hypot(dx, dy) < OWN_ORIGIN {
        return Ok(None);
    }
    let speed = math::hypot(facts.velocity.x, facts.velocity.y);
    if speed < 1.0 {
        return Ok(None);
    }
    let ux = facts.velocity.x / speed;
    let uy = facts.velocity.y / speed;
    let rx = self_at.x - facts.at.x;
    let ry = self_at.y - facts.at.y;
    let along = rx * ux + ry * uy;
    let offset = -rx * uy + ry * ux;
    let travelled = math::hypot(facts.at.x - facts.origin.x, facts.at.y - facts.origin.y);
    let left = facts.range - travelled;
    if offset.abs() > SIDESTEP_U || along < 0.0 || along > left + RANGED_HIT_REACH {
        return Ok(None);
    }
    let tti_ms = (along / speed) * 1000.0 - lag_ms;
    if tti_ms > 0.0 {
        Ok(Some(Course {
            tti_ms,
            offset,
            nx: -uy,
            ny: ux,
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
#[path = "reflex_geometry/tests.rs"]
mod tests;
