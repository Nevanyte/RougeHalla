//! The brain pathfinding behind a per-tick budget and a short cache (P-BOTS-3 port of brain/services.ts). Pure: no clock or
//! entropy; the driver calls start_tick once per room step and set_frame once per frame. The exact port of the source A* lives
//! in rh-sim pathfind (pinned by the legacy pathfinding fixture); this module owns only the service around it.
use rh_sim::geometry::{has_line_of_sight, segment_clear};
use rh_sim::map::{MASK_MOVE, MASK_SIGHT};
use rh_sim::pathfind::Pathfinder;
use rh_sim::{constants::PLAYER_RADIUS, TileMap, Vec2};

pub const PATH_CACHE_MS: f64 = 1000.;
pub const PATH_KEY_U: f64 = 8.;
pub const PATH_STALE_MS: f64 = 8000.;
const PATH_KEEP_MS: f64 = 20_000.;
const PRUNE_EVERY_MS: f64 = 4_000.;
pub const STRAIGHT_FACTOR: f64 = 1.3;
pub const BOT_PATH_BUDGET_PER_TICK: u32 = 8;

/// The room shared per-tick path-search allowance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathBudget {
    per_tick: u32,
    left: u32,
}
impl PathBudget {
    pub fn new(per_tick: u32) -> Self {
        Self {
            per_tick,
            left: per_tick,
        }
    }
    pub fn start_tick(&mut self) {
        self.left = self.per_tick;
    }
    pub fn take(&mut self) -> bool {
        if self.left == 0 {
            return false;
        }
        self.left -= 1;
        true
    }
    pub fn left(&self) -> u32 {
        self.left
    }
}
impl Default for PathBudget {
    fn default() -> Self {
        Self::new(BOT_PATH_BUDGET_PER_TICK)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PathStats {
    pub searches: u64,
    pub hits: u64,
    pub fallbacks: u64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WalkAnswer {
    pub dist: f64,
    pub exact: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Trip {
    at: f64,
    path: Option<Vec<Vec2>>,
    dist: f64,
}

/// (x, y, x, y, gated) rounded to the cache key unit.
type TripKey = (i64, i64, i64, i64, bool);

/// The room path service: the shared budget, the 1 s cache, the 8 s stale answer, the prune sweep and the sight/move queries.
pub struct RoomPathService {
    map: TileMap,
    finder: Pathfinder,
    budget: PathBudget,
    now: f64,
    gated: bool,
    pruned_at: f64,
    trips: Vec<(TripKey, Trip)>,
    stats: PathStats,
}
impl RoomPathService {
    pub fn new(map: &TileMap, budget: PathBudget) -> Self {
        Self {
            map: map.clone(),
            finder: Pathfinder::default(),
            budget,
            now: 0.,
            gated: false,
            pruned_at: 0.,
            trips: Vec::new(),
            stats: PathStats::default(),
        }
    }
    pub fn budget(&self) -> &PathBudget {
        &self.budget
    }
    pub fn budget_mut(&mut self) -> &mut PathBudget {
        &mut self.budget
    }
    /// The frame server time and gate flag. The declared corpus uses gate-less hand-built maps (the flag only separates cache
    /// keys there); closed-gate geometry belongs to the sim pathfinding fixtures and the fair static view keeps the open map.
    pub fn set_frame(&mut self, now: f64, gates_locked: bool) {
        self.now = now;
        self.gated = gates_locked;
        if now - self.pruned_at > PRUNE_EVERY_MS || now < self.pruned_at {
            self.prune();
        }
    }
    fn prune(&mut self) {
        self.pruned_at = self.now;
        let now = self.now;
        self.trips.retain(|(_, t)| now - t.at <= PATH_KEEP_MS);
    }
    fn key(&self, from: Vec2, to: Vec2) -> TripKey {
        let r = |v: f64| (v / PATH_KEY_U).round() as i64;
        (r(from.x), r(from.y), r(to.x), r(to.y), self.gated)
    }
    fn finite(a: Vec2, b: Vec2) -> bool {
        (a.x + a.y + b.x + b.y).is_finite()
    }
    /// The one trip transition shared by the owned and borrowed entries. A fresh cache hit answers before any allowance is
    /// taken; only a miss selects the supplied borrowed allowance (or the owned budget) at the existing take point.
    fn trip(&mut self, from: Vec2, to: Vec2, borrowed: Option<&mut PathBudget>) -> Option<Trip> {
        let key = self.key(from, to);
        let cached = self
            .trips
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, t)| t.clone());
        if let Some(t) = &cached {
            if self.now - t.at < PATH_CACHE_MS {
                self.stats.hits += 1;
                return Some(t.clone());
            }
        }
        let granted = match borrowed {
            Some(budget) => budget.take(),
            None => self.budget.take(),
        };
        if granted {
            self.stats.searches += 1;
            let path = self.finder.find_path(&self.map, from, to, PLAYER_RADIUS);
            let fresh = if path.is_empty() {
                Trip {
                    at: self.now,
                    path: None,
                    dist: f64::INFINITY,
                }
            } else {
                let dist = path_length(from, &path);
                Trip {
                    at: self.now,
                    path: Some(path),
                    dist,
                }
            };
            match self.trips.iter_mut().find(|(k, _)| *k == key) {
                Some(slot) => slot.1 = fresh.clone(),
                None => self.trips.push((key, fresh.clone())),
            }
            return Some(fresh);
        }
        if let Some(t) = &cached {
            if self.now - t.at < PATH_STALE_MS {
                self.stats.hits += 1;
                return Some(t.clone());
            }
        }
        self.stats.fallbacks += 1;
        None
    }
    /// The walking answer for the service's own budget.
    pub fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        self.walk_with(from, to, None)
    }
    /// Walk for a caller-owned room allowance (P-BOT-PATH-BUDGET-1): the allowance is borrowed for this call only, never
    /// copied into the service, never replenished and never swapped for the owned budget. The owned budget is untouched.
    #[cfg_attr(not(test), allow(dead_code))] // the Brain path adapter is a later packet; the shared-budget tests use it now
    pub(crate) fn walk_with_budget(
        &mut self,
        from: Vec2,
        to: Vec2,
        budget: &mut PathBudget,
    ) -> Option<WalkAnswer> {
        self.walk_with(from, to, Some(budget))
    }
    fn walk_with(
        &mut self,
        from: Vec2,
        to: Vec2,
        borrowed: Option<&mut PathBudget>,
    ) -> Option<WalkAnswer> {
        if !Self::finite(from, to) {
            return None;
        }
        match self.trip(from, to, borrowed) {
            None => Some(WalkAnswer {
                dist: rh_sim::math::hypot(to.x - from.x, to.y - from.y) * STRAIGHT_FACTOR,
                exact: false,
            }),
            Some(t) => t.path.map(|_| WalkAnswer {
                dist: t.dist,
                exact: true,
            }),
        }
    }
    /// The path for the service's own budget.
    pub fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
        self.path_with(from, to, None)
    }
    /// Path for a caller-owned room allowance (P-BOT-PATH-BUDGET-1), on the same borrowed-for-this-call terms as
    /// [`RoomPathService::walk_with_budget`].
    #[cfg_attr(not(test), allow(dead_code))] // the Brain path adapter is a later packet; the shared-budget tests use it now
    pub(crate) fn path_with_budget(
        &mut self,
        from: Vec2,
        to: Vec2,
        budget: &mut PathBudget,
    ) -> Option<Vec<Vec2>> {
        self.path_with(from, to, Some(budget))
    }
    fn path_with(
        &mut self,
        from: Vec2,
        to: Vec2,
        borrowed: Option<&mut PathBudget>,
    ) -> Option<Vec<Vec2>> {
        if !Self::finite(from, to) {
            return None;
        }
        self.trip(from, to, borrowed).and_then(|t| t.path)
    }
    pub fn los(&self, a: Vec2, b: Vec2) -> bool {
        has_line_of_sight(&self.map, a, b, MASK_SIGHT)
    }
    pub fn clear(&self, a: Vec2, b: Vec2) -> bool {
        segment_clear(&self.map, a, b, PLAYER_RADIUS, MASK_MOVE)
    }
    pub fn collision_map(&self) -> &TileMap {
        &self.map
    }
    pub fn stats(&self) -> PathStats {
        self.stats
    }
}

/// The walking length of a waypoint list from the start point (mobHunt.ts pathLength).
pub fn path_length(from: Vec2, points: &[Vec2]) -> f64 {
    let mut total = 0.;
    let mut at = from;
    for p in points {
        total += rh_sim::math::hypot(at.x - p.x, at.y - p.y);
        at = *p;
    }
    total
}

#[cfg(test)]
mod shared_budget_tests;
