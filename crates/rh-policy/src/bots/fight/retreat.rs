//! Stateful source kite.ts createRetreat, narrowed to fight's one visible player threat.
//! Candidate geometry is the existing source-proved mob_hunt::retreat_point helper.
use crate::bots::{mob_hunt::retreat_point, paths::RoomPathService};
use rh_sim::{math, Vec2};

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Retreat {
    dest: Option<Vec2>,
    at: f64,
}
impl Retreat {
    pub(super) fn point(
        &mut self,
        now: f64,
        own: Vec2,
        threat: Vec2,
        paths: &RoomPathService,
    ) -> Option<Vec2> {
        if let Some(dest) = self.dest {
            if now - self.at < 1200.
                && distance(own, dest) > 48.
                && distance(threat, dest) >= distance(threat, own)
            {
                return Some(dest);
            }
        }
        self.dest = retreat_point(own, &[threat], |a, b| paths.clear(a, b));
        self.at = now;
        self.dest
    }
}
fn distance(a: Vec2, b: Vec2) -> f64 {
    math::hypot(a.x - b.x, a.y - b.y)
}
