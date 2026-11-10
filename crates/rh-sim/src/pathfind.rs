//! A* over floor tiles plus string pulling, an exact port of `packages/shared/src/pathfind.ts` `findPath`: same heap
//! tie-breaking, same snapping, same clamp, same pull window, so the waypoints match the legacy ones (parity fixture
//! `pathfinding_seed1.json`: 300 queries on a generated 160x160 map).
//!
//! What is kept exactly, because it is semantics: the binary heap with its sift order and the [`before`] comparator (its
//! 1e-9 epsilon makes it non-transitive, so the heap's shape decides near-ties: a different queue would reorder them), the
//! neighbour order `d = 0..8`, and the string pull's linear scan from the far end of the window (clearness is not
//! monotonic in `j`). What is not legacy, and changes no result:
//! * O(explored) reset. Every node carries a generation stamp; a search bumps the generation by 2 (`stamp == base`:
//!   touched this search, `g` valid; `base + 1`: closed; anything older: `g = inf`, open), so starting a search costs
//!   O(1), not a fill of `g` and `closed` over the whole map (25,600 cells on 160x160). The arrays are cleared only
//!   when the map size changes or the 32-bit generation wraps ([`Pathfinder::full_resets`] counts that).
//! * The neighbour tests read one byte per expanded node ([`TileMap::nav`]), built with the map.
//! * The string pull checks each end disc once (per anchor, and memoized per candidate) instead of twice per tested
//!   segment, then runs only the rays; all predicates are pure, so every verdict is the one `segment_clear` gives.
//! * The scratch (tile path, candidates) lives in the [`Pathfinder`]; [`Pathfinder::find_path_into`] writes into a
//!   caller's buffer, so a steady-state query allocates nothing.

use crate::constants::{
    PATH_TIE_EPS, PLAYER_RADIUS, PULL_WINDOW, SNAP_RADIUS, START_CENTER_SLACK, TILE,
};
use crate::geometry::Footprint;
use crate::map::{tile_to_world_center, world_to_tile, TileMap, MASK_MOVE, STEP_DX, STEP_DY};
use crate::math::Vec2;

const SQRT2: f64 = core::f64::consts::SQRT_2;

/// Per-cell search state. `g` and `parent` are meaningful only while `stamp` is the current generation (`base`) or the
/// closed mark (`base + 1`).
#[derive(Clone, Copy, Debug, Default)]
struct Node {
    g: f64,
    parent: i32,
    stamp: u32,
}

/// Memo of `circle_clear(cand[j])` during one string pull.
const UNKNOWN: u8 = 0;
const CLEAR: u8 = 1;
const BLOCKED: u8 = 2;

/// Reusable A* scratch. Cloning gives a fresh, empty scratch (the search counter is kept): the scratch never carries
/// information from one search to the next, so a clone (a checkpoint, a forked sim) has no reason to copy ~400 KB.
#[derive(Default, Debug)]
pub struct Pathfinder {
    n: usize,
    nodes: Vec<Node>,
    /// The current generation (even; `base + 1` marks closed nodes).
    base: u32,
    heap: Vec<(i32, f64, f64)>,
    tile_path: Vec<usize>,
    cand: Vec<Vec2>,
    cand_clear: Vec<u8>,
    full_resets: u64,
    /// Searches run (for the step benchmarks and the path budget).
    pub searches: u64,
}

impl Clone for Pathfinder {
    fn clone(&self) -> Self {
        Self {
            searches: self.searches,
            ..Self::default()
        }
    }
}

#[inline]
fn before(f1: f64, g1: f64, n1: i32, f2: f64, g2: f64, n2: i32) -> bool {
    if (f1 - f2).abs() > PATH_TIE_EPS {
        return f1 < f2;
    }
    if g1 != g2 {
        return g1 > g2;
    }
    n1 < n2
}

fn octile(x: i64, y: i64, gx: i64, gy: i64) -> f64 {
    let dx = (x - gx).abs() as f64;
    let dy = (y - gy).abs() as f64;
    dx + dy + (SQRT2 - 2.0) * dx.min(dy)
}

impl Pathfinder {
    /// How many times the node arrays were cleared over their whole length: once per map size, plus once per 2^31
    /// searches (generation wrap). A steady stream of searches on one map leaves it at 1.
    pub fn full_resets(&self) -> u64 {
        self.full_resets
    }

    /// Starts a search over `n` cells: O(1) except on a size change or a generation wrap.
    fn reset(&mut self, n: usize) {
        if self.n != n || self.base >= u32::MAX - 2 {
            self.n = n;
            self.nodes.clear();
            self.nodes.resize(n, Node::default());
            self.base = 0;
            self.full_resets += 1;
            if self.heap.capacity() == 0 {
                self.heap.reserve(1024);
            }
        }
        // Every stamp in `nodes` is now below `base`: g = inf, open.
        self.base += 2;
        self.heap.clear();
    }

    fn push(&mut self, node: i32, f: f64, g: f64) {
        let h = &mut self.heap;
        h.push((node, f, g));
        let mut i = h.len() - 1;
        while i > 0 {
            let p = (i - 1) >> 1;
            if !before(f, g, node, h[p].1, h[p].2, h[p].0) {
                break;
            }
            h[i] = h[p];
            i = p;
        }
        h[i] = (node, f, g);
    }

    fn pop(&mut self) -> i32 {
        let h = &mut self.heap;
        let top = h[0].0;
        let last_item = h.pop().expect("pop on empty heap");
        let last = h.len();
        if last > 0 {
            let (node, f, g) = last_item;
            let mut i = 0;
            loop {
                let mut c = 2 * i + 1;
                if c >= last {
                    break;
                }
                if c + 1 < last
                    && before(h[c + 1].1, h[c + 1].2, h[c + 1].0, h[c].1, h[c].2, h[c].0)
                {
                    c += 1;
                }
                if !before(h[c].1, h[c].2, h[c].0, f, g, node) {
                    break;
                }
                h[i] = h[c];
                i = c;
            }
            h[i] = (node, f, g);
        }
        top
    }

    /// A* from tile `start` to tile `goal`; on success the tile path (start first) is in `self.tile_path`.
    fn astar(&mut self, map: &TileMap, start: usize, goal: usize) -> bool {
        let w = map.w as usize;
        self.reset(w * map.h as usize);
        self.searches += 1;
        let base = self.base;
        let closed = base + 1;
        let gx = (goal % w) as i64;
        let gy = (goal / w) as i64;
        self.nodes[start] = Node {
            g: 0.0,
            parent: -1,
            stamp: base,
        };
        self.push(
            start as i32,
            octile((start % w) as i64, (start / w) as i64, gx, gy),
            0.0,
        );
        while !self.heap.is_empty() {
            let node = self.pop() as usize;
            if self.nodes[node].stamp == closed {
                continue;
            }
            self.nodes[node].stamp = closed;
            if node == goal {
                self.tile_path.clear();
                let mut n = node as i32;
                while n != -1 {
                    self.tile_path.push(n as usize);
                    n = self.nodes[n as usize].parent;
                }
                self.tile_path.reverse();
                return true;
            }
            let x = (node % w) as i64;
            let y = (node / w) as i64;
            let g = self.nodes[node].g;
            // Bounds, floor and the diagonal corner rule of all eight steps, precomputed with the map.
            let steps = map.nav(node);
            for d in 0..8 {
                if steps & (1 << d) == 0 {
                    continue;
                }
                let nx = x + STEP_DX[d];
                let ny = y + STEP_DY[d];
                let ni = (ny as usize) * w + nx as usize;
                let nn = self.nodes[ni];
                if nn.stamp == closed {
                    continue;
                }
                let ng = g + if d >= 4 { SQRT2 } else { 1.0 };
                let old_g = if nn.stamp == base {
                    nn.g
                } else {
                    f64::INFINITY
                };
                if ng < old_g {
                    self.nodes[ni] = Node {
                        g: ng,
                        parent: node as i32,
                        stamp: base,
                    };
                    self.push(ni as i32, ng + octile(nx, ny, gx, gy), ng);
                }
            }
        }
        false
    }

    /// Waypoints (excluding `from`) that walk the footprint `foot` from `from` to `to`; empty when unreachable. A bare `f64`
    /// is the legacy disc of that radius ([`Footprint::Disc`], the very same evaluation); a [`Footprint::Box`] is an
    /// archetype's foot box (ADR0024). A goal inside a wall snaps to the nearest floor tile within [`SNAP_RADIUS`] rings; the
    /// last waypoint is `to` itself when the footprint fits there, else the nearest in-tile point where it does.
    pub fn find_path(
        &mut self,
        map: &TileMap,
        from: Vec2,
        to: Vec2,
        foot: impl Into<Footprint>,
    ) -> Vec<Vec2> {
        let mut out = Vec::new();
        self.find_path_into(map, from, to, foot, &mut out);
        out
    }

    /// [`find_path`](Self::find_path) into `out` (cleared first), with every intermediate buffer kept in the pathfinder:
    /// no allocation once the buffers have grown. The waypoints are bit-identical to `find_path`'s.
    pub fn find_path_into(
        &mut self,
        map: &TileMap,
        from: Vec2,
        to: Vec2,
        foot: impl Into<Footprint>,
        out: &mut Vec<Vec2>,
    ) {
        let foot = foot.into();
        out.clear();
        // Each coordinate on its own: opposite extremes cancel in a sum.
        if !(from.x.is_finite() && from.y.is_finite() && to.x.is_finite() && to.y.is_finite()) {
            return;
        }
        let w = map.w as usize;
        let mut sx = world_to_tile(from.x);
        let mut sy = world_to_tile(from.y);
        let start_in_wall = !map.is_floor(sx, sy);
        if start_in_wall {
            match snap_to_floor(map, from.x, from.y) {
                Some((tx, ty)) => {
                    sx = tx;
                    sy = ty;
                }
                None => return,
            }
        }
        let mut gx = world_to_tile(to.x);
        let mut gy = world_to_tile(to.y);
        let mut target = to;
        let goal_in_wall = !map.is_floor(gx, gy);
        if goal_in_wall {
            match snap_to_floor(map, to.x, to.y) {
                Some((tx, ty)) => {
                    gx = tx;
                    gy = ty;
                    target = Vec2::new(tile_to_world_center(gx), tile_to_world_center(gy));
                }
                None => return,
            }
        }
        if !goal_in_wall {
            target = clamp_clear(map, to, gx, gy, foot);
        }
        // The end discs of `from` and `target` are pure functions of the map: each is evaluated at most once per query.
        let mut from_clear: Option<bool> = None;
        let mut target_clear: Option<bool> = None;
        if !start_in_wall {
            // segment_clear(from, target): the disc at from, the disc at target, then the rays (its short-circuit order).
            let a = foot.clear(map, from, MASK_MOVE);
            from_clear = Some(a);
            if a {
                let b = foot.clear(map, target, MASK_MOVE);
                target_clear = Some(b);
                if b && foot.segment_rays_clear(map, from, target, MASK_MOVE) {
                    out.push(target);
                    return;
                }
            }
        }
        let si = (sy as usize) * w + sx as usize;
        let gi = (gy as usize) * w + gx as usize;
        if map.comp(si) != map.comp(gi) {
            return;
        }
        if !self.astar(map, si, gi) {
            return;
        }
        let center = |i: usize| {
            Vec2::new(
                tile_to_world_center((i % w) as i64),
                tile_to_world_center((i / w) as i64),
            )
        };
        let tile_path = &self.tile_path;
        let cand = &mut self.cand;
        cand.clear();
        if tile_path.len() > 1
            && (start_in_wall
                || (from.x - tile_to_world_center(sx)).abs() > START_CENTER_SLACK
                || (from.y - tile_to_world_center(sy)).abs() > START_CENTER_SLACK)
        {
            cand.push(center(tile_path[0]));
        }
        // The interior tiles: indices 1 ..= len - 2 (none for a path of one or two tiles).
        if tile_path.len() > 2 {
            for &t in &tile_path[1..tile_path.len() - 1] {
                cand.push(center(t));
            }
        }
        let goal_center = center(*tile_path.last().expect("non-empty path"));
        cand.push(goal_center);
        if target.x != goal_center.x || target.y != goal_center.y {
            cand.push(target);
        }
        // The last candidate equals `target` (it is `target`, or a tile centre numerically equal to it; centres are
        // positive, so there is no signed-zero case): its disc verdict is known if the direct test evaluated it.
        let cand: &[Vec2] = cand;
        let cc = &mut self.cand_clear;
        cc.clear();
        cc.resize(cand.len(), UNKNOWN);
        if let Some(b) = target_clear {
            cc[cand.len() - 1] = if b { CLEAR } else { BLOCKED };
        }
        let mut disc = |j: usize| -> bool {
            if cc[j] == UNKNOWN {
                cc[j] = if foot.clear(map, cand[j], MASK_MOVE) {
                    CLEAR
                } else {
                    BLOCKED
                };
            }
            cc[j] == CLEAR
        };
        // String pulling: from each anchor, the farthest j in the window whose segment is clear, scanning down from the
        // far end exactly as legacy `segmentClear(anchor, cand[j])` does, with the end discs read from the memo.
        let mut anchor = from;
        // None: the anchor is `from`; Some(a): it is cand[a]. Its disc is evaluated only when a segment is tested.
        let mut anchor_j: Option<usize> = None;
        let mut i = 0;
        while i < cand.len() {
            let mut j = (cand.len() - 1).min(i + PULL_WINDOW);
            while j > i {
                let anchor_clear = match anchor_j {
                    Some(a) => disc(a),
                    None => *from_clear
                        .get_or_insert_with(|| foot.clear(map, from, MASK_MOVE)),
                };
                if anchor_clear
                    && disc(j)
                    && foot.segment_rays_clear(map, anchor, cand[j], MASK_MOVE)
                {
                    break;
                }
                j -= 1;
            }
            out.push(cand[j]);
            anchor = cand[j];
            anchor_j = Some(j);
            i = j + 1;
        }
    }
}

fn snap_to_floor(map: &TileMap, x: f64, y: f64) -> Option<(i64, i64)> {
    let cx = world_to_tile(x);
    let cy = world_to_tile(y);
    for ring in 1..=SNAP_RADIUS {
        let mut best: Option<(i64, i64)> = None;
        let mut best_d = f64::INFINITY;
        for dy in -ring..=ring {
            let rest = ring - dy.abs();
            let dxs: &[i64] = if rest == 0 { &[0] } else { &[-rest, rest] };
            for &dx in dxs {
                let tx = cx.saturating_add(dx);
                let ty = cy.saturating_add(dy);
                if !map.is_floor(tx, ty) {
                    continue;
                }
                let ex = tile_to_world_center(tx) - x;
                let ey = tile_to_world_center(ty) - y;
                let d = ex * ex + ey * ey;
                if d < best_d {
                    best_d = d;
                    best = Some((tx, ty));
                }
            }
        }
        if best.is_some() {
            return best;
        }
    }
    None
}

/// Clamps a goal off the walls of its tile: x by the footprint's east-west half-extent, y by its north-south one (both the
/// radius for a disc).
fn clamp_clear(map: &TileMap, p: Vec2, gx: i64, gy: i64, foot: Footprint) -> Vec2 {
    if foot.clear(map, p, MASK_MOVE) {
        return p;
    }
    let (rx, ry) = (foot.half_x(), foot.half_y());
    let x0 = gx as f64 * TILE;
    let y0 = gy as f64 * TILE;
    let mut x = p.x;
    let mut y = p.y;
    if map.is_solid(gx - 1, gy) {
        x = x.max(x0 + rx);
    }
    if map.is_solid(gx + 1, gy) {
        x = x.min(x0 + TILE - rx);
    }
    if map.is_solid(gx, gy - 1) {
        y = y.max(y0 + ry);
    }
    if map.is_solid(gx, gy + 1) {
        y = y.min(y0 + TILE - ry);
    }
    let clamped = Vec2::new(x, y);
    if foot.clear(map, clamped, MASK_MOVE) {
        clamped
    } else {
        Vec2::new(tile_to_world_center(gx), tile_to_world_center(gy))
    }
}

/// `find_path` with the player radius (legacy `planPath`).
pub fn plan_path(pf: &mut Pathfinder, map: &TileMap, from: Vec2, to: Vec2) -> Vec<Vec2> {
    pf.find_path(map, from, to, PLAYER_RADIUS)
}

/// [`plan_path`] into a caller's buffer ([`Pathfinder::find_path_into`]).
pub fn plan_path_into(
    pf: &mut Pathfinder,
    map: &TileMap,
    from: Vec2,
    to: Vec2,
    out: &mut Vec<Vec2>,
) {
    pf.find_path_into(map, from, to, PLAYER_RADIUS, out)
}

/// A mover's path with its own footprint (ADR0024: the fighter's foot box, or the legacy disc under `LegacyCircle`, which
/// is [`plan_path_into`] exactly).
pub fn plan_foot_path_into(
    pf: &mut Pathfinder,
    map: &TileMap,
    from: Vec2,
    to: Vec2,
    foot: Footprint,
    out: &mut Vec<Vec2>,
) {
    pf.find_path_into(map, from, to, foot, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arenas::practice_arena;

    /// Queries on the practice arena that need A* (a pillar or the fence is in the way) and one that does not.
    fn queries() -> Vec<(Vec2, Vec2)> {
        vec![
            (Vec2::new(100.0, 176.0), Vec2::new(300.0, 176.0)),
            (Vec2::new(300.0, 176.0), Vec2::new(100.0, 170.0)),
            (Vec2::new(700.0, 500.0), Vec2::new(860.0, 480.0)),
            (Vec2::new(60.0, 60.0), Vec2::new(1400.0, 950.0)),
            (Vec2::new(500.0, 300.0), Vec2::new(520.0, 310.0)),
        ]
    }

    #[test]
    fn the_generation_wrap_clears_once_and_changes_nothing() {
        let map = practice_arena().map;
        let mut pf = Pathfinder::default();
        let want: Vec<Vec<Vec2>> = queries()
            .iter()
            .map(|&(a, b)| Pathfinder::default().find_path(&map, a, b, PLAYER_RADIUS))
            .collect();
        assert!(want.iter().filter(|p| p.len() > 1).count() >= 3, "{want:?}");
        pf.find_path(&map, queries()[0].0, queries()[0].1, PLAYER_RADIUS);
        assert_eq!(pf.full_resets(), 1);
        // Jump to just below the wrap: the next searches run at the last generations, then the arrays clear once.
        pf.base = u32::MAX - 7;
        let mut seen_top = false;
        for round in 0..4 {
            for (k, &(a, b)) in queries().iter().enumerate() {
                assert_eq!(
                    pf.find_path(&map, a, b, PLAYER_RADIUS),
                    want[k],
                    "round {round} query {k}"
                );
                seen_top |= pf.base == u32::MAX - 1;
            }
        }
        assert!(seen_top, "a search ran with closed == u32::MAX");
        assert_eq!(pf.full_resets(), 2, "one clear at the wrap");
    }

    #[test]
    fn a_search_never_fills_the_node_arrays() {
        let map = practice_arena().map;
        let mut pf = Pathfinder::default();
        let mut out = Vec::new();
        for _ in 0..50 {
            for &(a, b) in &queries() {
                pf.find_path_into(&map, a, b, PLAYER_RADIUS, &mut out);
            }
        }
        assert!(pf.searches >= 150, "{}", pf.searches);
        assert_eq!(pf.full_resets(), 1);
        assert_eq!(pf.nodes.len(), (map.w * map.h) as usize);
        // Stamps only move forward: every touched node is at most the closed mark of the last search.
        assert!(pf.nodes.iter().all(|n| n.stamp <= pf.base + 1));
    }
}
