//! A* over floor tiles plus string pulling, an exact port of `packages/shared/src/pathfind.ts` `findPath`: same heap
//! tie-breaking, same snapping, same clamp, same pull window, so the waypoints match the legacy ones (parity fixture
//! `pathfinding_seed1.json`: 300 queries on a generated 160x160 map). The scratch buffers are owned by a [`Pathfinder`] and
//! reused across searches (no allocation per search beyond the output).

use crate::constants::{PLAYER_RADIUS, TILE};
use crate::geometry::{circle_clear, segment_clear};
use crate::map::{tile_to_world_center, world_to_tile, TileMap, MASK_MOVE, TILE_FLOOR};
use crate::math::Vec2;

pub const SNAP_RADIUS: i64 = 4;
/// Candidates past the anchor that string pulling considers (legacy PULL_WINDOW).
pub const PULL_WINDOW: usize = 96;
const SQRT2: f64 = core::f64::consts::SQRT_2;
const DX: [i64; 8] = [1, -1, 0, 0, 1, 1, -1, -1];
const DY: [i64; 8] = [0, 0, 1, -1, 1, -1, 1, -1];

#[derive(Default, Clone, Debug)]
pub struct Pathfinder {
    n: usize,
    g: Vec<f64>,
    parent: Vec<i32>,
    closed: Vec<u8>,
    heap: Vec<(i32, f64, f64)>,
    /// Searches run (for the step benchmarks and the path budget).
    pub searches: u64,
}

#[inline]
fn before(f1: f64, g1: f64, n1: i32, f2: f64, g2: f64, n2: i32) -> bool {
    if (f1 - f2).abs() > 1e-9 {
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
    fn reset(&mut self, n: usize) {
        if self.n != n {
            self.n = n;
            self.g = vec![f64::INFINITY; n];
            self.parent = vec![0; n];
            self.closed = vec![0; n];
            self.heap = Vec::with_capacity(1024);
        } else {
            self.g.fill(f64::INFINITY);
            self.closed.fill(0);
        }
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

    fn astar(&mut self, map: &TileMap, start: usize, goal: usize) -> Option<Vec<usize>> {
        let w = map.w as usize;
        let h = map.h as usize;
        self.reset(w * h);
        self.searches += 1;
        let gx = (goal % w) as i64;
        let gy = (goal / w) as i64;
        self.g[start] = 0.0;
        self.parent[start] = -1;
        self.push(
            start as i32,
            octile((start % w) as i64, (start / w) as i64, gx, gy),
            0.0,
        );
        while !self.heap.is_empty() {
            let node = self.pop() as usize;
            if self.closed[node] != 0 {
                continue;
            }
            self.closed[node] = 1;
            if node == goal {
                let mut path = Vec::new();
                let mut n = node as i32;
                while n != -1 {
                    path.push(n as usize);
                    n = self.parent[n as usize];
                }
                path.reverse();
                return Some(path);
            }
            let x = (node % w) as i64;
            let y = (node / w) as i64;
            let g = self.g[node];
            for d in 0..8 {
                let nx = x + DX[d];
                let ny = y + DY[d];
                if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                    continue;
                }
                let ni = (ny as usize) * w + nx as usize;
                if map.tiles[ni] != TILE_FLOOR || self.closed[ni] != 0 {
                    continue;
                }
                let diagonal = d >= 4;
                if diagonal
                    && (map.tiles[(y as usize) * w + nx as usize] != TILE_FLOOR
                        || map.tiles[(ny as usize) * w + x as usize] != TILE_FLOOR)
                {
                    continue;
                }
                let ng = g + if diagonal { SQRT2 } else { 1.0 };
                if ng < self.g[ni] {
                    self.g[ni] = ng;
                    self.parent[ni] = node as i32;
                    self.push(ni as i32, ng + octile(nx, ny, gx, gy), ng);
                }
            }
        }
        None
    }

    /// Waypoints (excluding `from`) that walk a disc of `radius` from `from` to `to`; empty when unreachable. A goal inside a
    /// wall snaps to the nearest floor tile within [`SNAP_RADIUS`] rings; the last waypoint is `to` itself when the disc fits
    /// there, else the nearest in-tile point where it does.
    pub fn find_path(&mut self, map: &TileMap, from: Vec2, to: Vec2, radius: f64) -> Vec<Vec2> {
        if !(from.x + from.y + to.x + to.y).is_finite() {
            return Vec::new();
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
                None => return Vec::new(),
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
                None => return Vec::new(),
            }
        }
        if !goal_in_wall {
            target = clamp_clear(map, to, gx, gy, radius);
        }
        if !start_in_wall && segment_clear(map, from, target, radius, MASK_MOVE) {
            return vec![target];
        }
        let si = (sy as usize) * w + sx as usize;
        let gi = (gy as usize) * w + gx as usize;
        if map.comp(si) != map.comp(gi) {
            return Vec::new();
        }
        let Some(tile_path) = self.astar(map, si, gi) else {
            return Vec::new();
        };
        let center = |i: usize| {
            Vec2::new(
                tile_to_world_center((i % w) as i64),
                tile_to_world_center((i / w) as i64),
            )
        };
        let mut cand: Vec<Vec2> = Vec::with_capacity(tile_path.len() + 1);
        if tile_path.len() > 1
            && (start_in_wall
                || (from.x - tile_to_world_center(sx)).abs() > 0.5
                || (from.y - tile_to_world_center(sy)).abs() > 0.5)
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
        let mut out = Vec::new();
        let mut anchor = from;
        let mut i = 0;
        while i < cand.len() {
            let mut j = (cand.len() - 1).min(i + PULL_WINDOW);
            while j > i && !segment_clear(map, anchor, cand[j], radius, MASK_MOVE) {
                j -= 1;
            }
            out.push(cand[j]);
            anchor = cand[j];
            i = j + 1;
        }
        out
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
                let tx = cx + dx;
                let ty = cy + dy;
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

fn clamp_clear(map: &TileMap, p: Vec2, gx: i64, gy: i64, radius: f64) -> Vec2 {
    if circle_clear(map, p, radius, MASK_MOVE) {
        return p;
    }
    let x0 = gx as f64 * TILE;
    let y0 = gy as f64 * TILE;
    let mut x = p.x;
    let mut y = p.y;
    if map.is_solid(gx - 1, gy) {
        x = x.max(x0 + radius);
    }
    if map.is_solid(gx + 1, gy) {
        x = x.min(x0 + TILE - radius);
    }
    if map.is_solid(gx, gy - 1) {
        y = y.max(y0 + radius);
    }
    if map.is_solid(gx, gy + 1) {
        y = y.min(y0 + TILE - radius);
    }
    let clamped = Vec2::new(x, y);
    if circle_clear(map, clamped, radius, MASK_MOVE) {
        clamped
    } else {
        Vec2::new(tile_to_world_center(gx), tile_to_world_center(gy))
    }
}

/// `find_path` with the player radius (legacy `planPath`).
pub fn plan_path(pf: &mut Pathfinder, map: &TileMap, from: Vec2, to: Vec2) -> Vec<Vec2> {
    pf.find_path(map, from, to, PLAYER_RADIUS)
}
