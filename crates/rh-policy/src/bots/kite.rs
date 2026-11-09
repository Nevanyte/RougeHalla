//! A step away from a threat (P-BOTS-3 port of brain/tactics/kite.ts awayPoint): headings tried when a wall is in the way, in
//! order, never more than 60 degrees off; a shortened step is tried when the full one is not clear.
use rh_sim::Vec2;

use crate::bots::paths::RoomPathService;

#[path = "kite/own_timings.rs"]
mod own_timings;
pub use own_timings::{own_timings, OwnTimings};

pub const TURNS: [f64; 5] = [0., 0.5, -0.5, 1.05, -1.05];
pub const LENGTHS: [f64; 2] = [1., 0.6];

/// A point about step_u straight away from threat (turned by jitter radians), turned or shortened until the walk to it is
/// clear. None when no heading is clear: cornered, so the caller stands and trades.
pub fn away_point(
    paths: &RoomPathService,
    self_at: Vec2,
    threat: Vec2,
    step_u: f64,
    jitter: f64,
) -> Option<Vec2> {
    let base = rh_sim::math::atan2(self_at.y - threat.y, self_at.x - threat.x) + jitter;
    for turn in TURNS {
        for share in LENGTHS {
            let a = base + turn;
            let p = Vec2::new(
                self_at.x + rh_sim::math::cos(a) * step_u * share,
                self_at.y + rh_sim::math::sin(a) * step_u * share,
            );
            if paths.clear(self_at, p) {
                return Some(p);
            }
        }
    }
    None
}
