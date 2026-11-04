//! The geometry/pathfinding kernel against reference formulations (docs/CONTRACTS.md C-NUM, C-PARITY): every fast path in
//! pathfind.rs, geometry.rs, map.rs and math.rs must give the result of the plain legacy formulation, bit for bit.
//!
//! * `ray_blocked` == `raycast(..).hit` over 10^6 random segments on each of two maps, and `segment_clear` equal to the
//!   legacy formulation (both end discs, then `raycast` rays);
//! * `floor_i64` / `ceil_i64` == `f64::floor/ceil as i64` on the edge set and 10^6 samples;
//! * `find_path` / `find_path_into` == a verbatim copy of the pre-kernel pathfinder (full reset per search, `segment_clear`
//!   string pull) on thousands of random queries, compared with `to_bits`; no full-array reset in steady state;
//! * `js_round` == JavaScript `Math.round` on edge vectors and 10^5 random values;
//! * a malformed `TileMap` is a decode error; a decoded map is complete and equal to the original.

use rh_sim::arenas::{practice_arena, MapFile};
use rh_sim::constants::{PLAYER_RADIUS, TILE};
use rh_sim::geometry::{circle_clear, has_line_of_sight, ray_blocked, raycast, segment_clear};
use rh_sim::map::{
    tile_to_world_center, world_to_tile, MASK_MELEE, MASK_MOVE, MASK_SIGHT, TILE_FLOOR,
};
use rh_sim::math::{ceil_i64, floor_i64, js_round, Vec2};
use rh_sim::pathfind::{plan_path, plan_path_into, Pathfinder};
use rh_sim::TileMap;

/// splitmix64: a fixed, dependency-free sample stream.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn seed1_map() -> TileMap {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let text = std::fs::read_to_string(path).expect("parity/maps/seed1.map.json");
    let file: MapFile = serde_json::from_str(&text).expect("map json");
    file.into_arena().expect("seed1 arena").map
}

fn maps() -> Vec<(&'static str, TileMap)> {
    vec![("seed1", seed1_map()), ("practice", practice_arena().map)]
}

/// A world coordinate drawn from a mix that hits the traversal's special cases: anywhere (including outside the map),
/// exactly on a tile edge, a tile centre, or within a few ulps of an edge.
fn coord(r: &mut Rng, extent: f64) -> f64 {
    match r.below(6) {
        0 | 1 => r.range(-2.0 * TILE, extent + 2.0 * TILE),
        2 => (r.below((extent / TILE) as u64 + 1)) as f64 * TILE,
        3 => tile_to_world_center(r.below((extent / TILE) as u64) as i64),
        4 => {
            let e = (r.below((extent / TILE) as u64 + 1)) as f64 * TILE;
            let ulps = r.below(9) as i64 - 4;
            f64::from_bits((e.max(f64::MIN_POSITIVE).to_bits() as i64 + ulps) as u64)
        }
        _ => r.range(0.0, extent),
    }
}

fn segment(r: &mut Rng, map: &TileMap) -> (f64, f64, f64, f64) {
    let (ww, wh) = map.world_size();
    let x0 = coord(r, ww);
    let y0 = coord(r, wh);
    match r.below(8) {
        // Short segments (most melee and string-pull rays).
        0..=2 => {
            let reach = [4.0, 40.0, 200.0][r.below(3) as usize];
            (
                x0,
                y0,
                x0 + r.range(-reach, reach),
                y0 + r.range(-reach, reach),
            )
        }
        // Axis-aligned and exactly diagonal (the step_x/step_y == 0 and corner-squeeze cases).
        3 => (x0, y0, x0, coord(r, wh)),
        4 => (x0, y0, coord(r, ww), y0),
        5 => {
            let d = r.range(-300.0, 300.0);
            let e = if r.below(2) == 0 { d } else { -d };
            (x0, y0, x0 + d, y0 + e)
        }
        // Zero length.
        6 => (x0, y0, x0, y0),
        _ => (x0, y0, coord(r, ww), coord(r, wh)),
    }
}

const MASKS: [u8; 3] = [MASK_SIGHT, MASK_MOVE, MASK_MELEE];

#[test]
fn ray_blocked_equals_raycast_hit_on_a_million_segments_per_map() {
    for (name, map) in maps() {
        let mut r = Rng(0x5eed_0001 ^ map.layer_hash() as u64);
        let (mut mismatches, mut hits) = (0u32, 0u32);
        const N: u32 = 1_000_000;
        for k in 0..N {
            let (x0, y0, x1, y1) = segment(&mut r, &map);
            let mask = MASKS[(k % 3) as usize];
            let want = raycast(&map, x0, y0, x1, y1, mask).hit;
            let got = ray_blocked(&map, x0, y0, x1, y1, mask);
            hits += want as u32;
            if got != want {
                mismatches += 1;
                if mismatches <= 5 {
                    eprintln!("{name}: ({x0:?},{y0:?})->({x1:?},{y1:?}) mask {mask}: raycast {want}, ray_blocked {got}");
                }
            }
            assert_eq!(
                has_line_of_sight(&map, Vec2::new(x0, y0), Vec2::new(x1, y1), mask),
                !want
            );
        }
        assert_eq!(mismatches, 0, "{name}: ray_blocked disagrees with raycast");
        // Both verdicts are well represented (the sample is not trivially all-hit or all-clear).
        assert!(hits > N / 10 && hits < N - N / 10, "{name}: {hits} hits");
        // Non-finite input: blocked, like raycast.
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(ray_blocked(&map, bad, 100.0, 200.0, 200.0, MASK_MOVE));
            assert!(raycast(&map, bad, 100.0, 200.0, 200.0, MASK_MOVE).hit);
        }
    }
}

/// The legacy `segmentClear`: both end discs, the centre `raycast`, then the side rays, all through `raycast(..).hit`.
fn legacy_segment_clear(map: &TileMap, a: Vec2, b: Vec2, radius: f64, mask: u8) -> bool {
    if !legacy_circle_clear(map, a, radius, mask) || !legacy_circle_clear(map, b, radius, mask) {
        return false;
    }
    if raycast(map, a.x, a.y, b.x, b.y, mask).hit {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = (dx * dx + dy * dy).sqrt();
    if len == 0.0 || radius <= 0.0 {
        return true;
    }
    let nx = -dy / len;
    let ny = dx / len;
    let rays = (radius / TILE).ceil() as i64;
    for k in 1..=rays {
        let off = (radius * k as f64) / rays as f64;
        let ox = nx * off;
        let oy = ny * off;
        if raycast(map, a.x + ox, a.y + oy, b.x + ox, b.y + oy, mask).hit {
            return false;
        }
        if raycast(map, a.x - ox, a.y - oy, b.x - ox, b.y - oy, mask).hit {
            return false;
        }
    }
    true
}

/// The legacy `circleClear` with `f64::floor` / `f64::ceil`.
fn legacy_circle_clear(map: &TileMap, p: Vec2, radius: f64, mask: u8) -> bool {
    let (cx, cy) = (p.x, p.y);
    if !(cx + cy + radius).is_finite() {
        return false;
    }
    let tx = (cx / TILE).floor() as i64;
    let ty = (cy / TILE).floor() as i64;
    if radius <= 0.0 {
        return !map.blocked(tx, ty, mask);
    }
    let reach = 1i64.max((radius / TILE).ceil() as i64);
    let r2 = radius * radius;
    for j in (ty - reach)..=(ty + reach) {
        for i in (tx - reach)..=(tx + reach) {
            if !map.blocked(i, j, mask) {
                continue;
            }
            let nx = cx.max(i as f64 * TILE).min((i + 1) as f64 * TILE);
            let ny = cy.max(j as f64 * TILE).min((j + 1) as f64 * TILE);
            let ddx = cx - nx;
            let ddy = cy - ny;
            if ddx * ddx + ddy * ddy < r2 {
                return false;
            }
        }
    }
    true
}

#[test]
fn segment_and_circle_clear_equal_the_legacy_formulation() {
    for (name, map) in maps() {
        let mut r = Rng(0x5eed_0002 ^ map.layer_hash() as u64);
        let mut clear = 0u32;
        const N: u32 = 200_000;
        for k in 0..N {
            let (x0, y0, x1, y1) = segment(&mut r, &map);
            let (a, b) = (Vec2::new(x0, y0), Vec2::new(x1, y1));
            let radius = [0.0, 6.0, PLAYER_RADIUS, 31.9, 32.0, 48.0][(k % 6) as usize];
            let mask = MASKS[(k / 6 % 3) as usize];
            let want = legacy_segment_clear(&map, a, b, radius, mask);
            assert_eq!(
                segment_clear(&map, a, b, radius, mask),
                want,
                "{name}: segment {a:?}->{b:?} r {radius} mask {mask}"
            );
            assert_eq!(
                circle_clear(&map, a, radius, mask),
                legacy_circle_clear(&map, a, radius, mask),
                "{name}: disc {a:?} r {radius} mask {mask}"
            );
            clear += want as u32;
        }
        assert!(
            clear > N / 20 && clear < N - N / 20,
            "{name}: {clear} clear"
        );
    }
}

fn floor_edges() -> Vec<f64> {
    let mut v = vec![
        0.0,
        -0.0,
        f64::MIN_POSITIVE,
        -f64::MIN_POSITIVE,
        f64::from_bits(1),
        -f64::from_bits(1),
        0.5,
        -0.5,
        1.0,
        -1.0,
        0.49999999999999994,
        -0.49999999999999994,
        1.0 - f64::EPSILON / 2.0,
        -(1.0 - f64::EPSILON / 2.0),
        f64::MAX,
        f64::MIN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
        -f64::NAN,
        9.3e18,
        -9.3e18,
        1e300,
        -1e300,
    ];
    for p in [52, 53, 62, 63, 64] {
        let b = 2f64.powi(p);
        for x in [b - 1.0, b - 0.5, b, b + 0.5, b + 1.0, b + 2.0] {
            v.push(x);
            v.push(-x);
            // The neighbours in the bit pattern.
            v.push(f64::from_bits(x.to_bits() + 1));
            v.push(f64::from_bits(x.to_bits() - 1));
            v.push(-f64::from_bits(x.to_bits() + 1));
            v.push(-f64::from_bits(x.to_bits() - 1));
        }
    }
    for k in -70i64..=70 {
        let t = k as f64;
        for x in [t, t + 0.5, t - 0.5] {
            v.push(x);
            v.push(f64::from_bits(x.to_bits().wrapping_add(1)));
            v.push(f64::from_bits(x.to_bits().wrapping_sub(1)));
        }
        // Tile edges in world units, as world_to_tile sees them.
        v.push(t * TILE);
        v.push(f64::from_bits((t * TILE).to_bits().wrapping_sub(1)));
    }
    v
}

#[test]
fn floor_and_ceil_helpers_equal_std_on_edges_and_a_million_samples() {
    let check = |x: f64| {
        assert_eq!(
            floor_i64(x),
            x.floor() as i64,
            "floor {x:?} ({:#x})",
            x.to_bits()
        );
        assert_eq!(
            ceil_i64(x),
            x.ceil() as i64,
            "ceil {x:?} ({:#x})",
            x.to_bits()
        );
        assert_eq!(
            world_to_tile(x),
            (x / TILE).floor() as i64,
            "world_to_tile {x:?}"
        );
    };
    let edges = floor_edges();
    for &x in &edges {
        check(x);
    }
    let mut r = Rng(0x5eed_0003);
    for k in 0..1_000_000u32 {
        let x = match k % 4 {
            0 => f64::from_bits(r.next()), // every exponent, NaNs included
            1 => r.range(-6000.0, 6000.0), // world coordinates
            2 => r.range(-1e19, 1e19),     // around the i64 saturation bounds
            _ => {
                let n = (r.next() as i64 >> r.below(64)) as f64; // near-integers of every size
                f64::from_bits(n.to_bits().wrapping_add(r.below(5)).wrapping_sub(2))
            }
        };
        check(x);
    }
}

/// JavaScript `Math.round` as the spec states it, built from `f64::round` (half away from zero, exact): the same except a
/// negative exact half goes up, and a zero result takes the sign of the input.
fn reference_math_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let mut r = x.round();
    if x < 0.0 && x - x.trunc() == -0.5 {
        r += 1.0;
    }
    if r == 0.0 {
        0.0f64.copysign(x)
    } else {
        r
    }
}

#[test]
fn js_round_is_math_round() {
    let p52 = 2f64.powi(52);
    // (input, Math.round(input)) as V8 prints them.
    let vectors: [(f64, f64); 22] = [
        (0.49999999999999994, 0.0),
        (0.5, 1.0),
        (1.5, 2.0),
        (2.5, 3.0),
        (-2.5, -2.0),
        (-1.5, -1.0),
        (-0.5, -0.0),
        (-0.4, -0.0),
        (-0.0, -0.0),
        (0.0, 0.0),
        (0.4, 0.0),
        (-0.5000000000000001, -1.0),
        (-0.49999999999999994, -0.0),
        (p52 + 1.0, p52 + 1.0),
        (p52 + 3.0, p52 + 3.0),
        (-(p52 + 1.0), -(p52 + 1.0)),
        (p52 - 0.5, p52),
        (-(p52 - 0.5), -(p52 - 1.0)),
        (1e300, 1e300),
        (f64::INFINITY, f64::INFINITY),
        (f64::NEG_INFINITY, f64::NEG_INFINITY),
        (4503599627370495.5, 4503599627370496.0),
    ];
    for (x, want) in vectors {
        let got = js_round(x);
        assert_eq!(
            got.to_bits(),
            want.to_bits(),
            "Math.round({x:?}) = {want:?}, got {got:?}"
        );
        assert_eq!(
            reference_math_round(x).to_bits(),
            want.to_bits(),
            "reference at {x:?}"
        );
    }
    assert!(js_round(f64::NAN).is_nan());
    let mut r = Rng(0x5eed_0004);
    for k in 0..100_000u32 {
        let x = match k % 4 {
            0 => f64::from_bits(r.next()),
            1 => r.range(-1000.0, 1000.0),
            2 => (r.below(4000) as f64 - 2000.0) / 2.0, // exact halves
            _ => r.range(-1e17, 1e17),
        };
        if x.is_nan() {
            assert!(js_round(x).is_nan());
            continue;
        }
        assert_eq!(
            js_round(x).to_bits(),
            reference_math_round(x).to_bits(),
            "{x:?}"
        );
    }
}

// ----- the pre-kernel pathfinder, verbatim (full reset per search, per-neighbour tile tests, segment_clear pull) -----

mod reference {
    use super::{legacy_circle_clear, legacy_segment_clear};
    use rh_sim::constants::TILE;
    use rh_sim::map::{tile_to_world_center, TileMap, MASK_MOVE, TILE_FLOOR};
    use rh_sim::math::Vec2;

    const SQRT2: f64 = core::f64::consts::SQRT_2;
    const DX: [i64; 8] = [1, -1, 0, 0, 1, 1, -1, -1];
    const DY: [i64; 8] = [0, 0, 1, -1, 1, -1, 1, -1];

    fn wt(v: f64) -> i64 {
        (v / TILE).floor() as i64
    }

    #[derive(Default)]
    pub struct Pf {
        n: usize,
        g: Vec<f64>,
        parent: Vec<i32>,
        closed: Vec<u8>,
        heap: Vec<(i32, f64, f64)>,
    }

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

    impl Pf {
        fn reset(&mut self, n: usize) {
            if self.n != n {
                self.n = n;
                self.g = vec![f64::INFINITY; n];
                self.parent = vec![0; n];
                self.closed = vec![0; n];
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
            let last_item = h.pop().unwrap();
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

        pub fn find_path(&mut self, map: &TileMap, from: Vec2, to: Vec2, radius: f64) -> Vec<Vec2> {
            if !(from.x + from.y + to.x + to.y).is_finite() {
                return Vec::new();
            }
            let w = map.w as usize;
            let mut sx = wt(from.x);
            let mut sy = wt(from.y);
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
            let mut gx = wt(to.x);
            let mut gy = wt(to.y);
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
            if !start_in_wall && legacy_segment_clear(map, from, target, radius, MASK_MOVE) {
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
            let mut cand: Vec<Vec2> = Vec::new();
            if tile_path.len() > 1
                && (start_in_wall
                    || (from.x - tile_to_world_center(sx)).abs() > 0.5
                    || (from.y - tile_to_world_center(sy)).abs() > 0.5)
            {
                cand.push(center(tile_path[0]));
            }
            if tile_path.len() > 2 {
                for &t in &tile_path[1..tile_path.len() - 1] {
                    cand.push(center(t));
                }
            }
            let goal_center = center(*tile_path.last().unwrap());
            cand.push(goal_center);
            if target.x != goal_center.x || target.y != goal_center.y {
                cand.push(target);
            }
            let mut out = Vec::new();
            let mut anchor = from;
            let mut i = 0;
            while i < cand.len() {
                let mut j = (cand.len() - 1).min(i + 96);
                while j > i && !legacy_segment_clear(map, anchor, cand[j], radius, MASK_MOVE) {
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
        let cx = wt(x);
        let cy = wt(y);
        for ring in 1..=4i64 {
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
        if legacy_circle_clear(map, p, radius, MASK_MOVE) {
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
        if legacy_circle_clear(map, clamped, radius, MASK_MOVE) {
            clamped
        } else {
            Vec2::new(tile_to_world_center(gx), tile_to_world_center(gy))
        }
    }
}

fn bits(p: &[Vec2]) -> Vec<(u64, u64)> {
    p.iter().map(|v| (v.x.to_bits(), v.y.to_bits())).collect()
}

/// A query endpoint: mostly floor-tile points (so most queries reach A*), some anywhere (walls, outside, snapping).
fn endpoint(r: &mut Rng, map: &TileMap) -> Vec2 {
    let (ww, wh) = map.world_size();
    if r.below(5) == 0 {
        return Vec2::new(r.range(-40.0, ww + 40.0), r.range(-40.0, wh + 40.0));
    }
    loop {
        let tx = r.below(map.w as u64) as i64;
        let ty = r.below(map.h as u64) as i64;
        if map.tile(tx, ty) == Some(TILE_FLOOR) {
            let jitter = if r.below(3) == 0 { 0.0 } else { 15.9 };
            return Vec2::new(
                tile_to_world_center(tx) + r.range(-jitter, jitter),
                tile_to_world_center(ty) + r.range(-jitter, jitter),
            );
        }
    }
}

#[test]
fn find_path_and_find_path_into_equal_the_reference_pathfinder_bit_for_bit() {
    for (name, map) in maps() {
        let mut r = Rng(0x5eed_0005 ^ map.layer_hash() as u64);
        let mut reference = reference::Pf::default();
        let mut pf = Pathfinder::default();
        let mut pf_into = Pathfinder::default();
        let mut out = vec![Vec2::new(1.0, 2.0); 7]; // dirty: find_path_into must clear it
        let (mut routed, mut empty) = (0u32, 0u32);
        let n = if name == "seed1" { 1500 } else { 3000 };
        for k in 0..n {
            let from = endpoint(&mut r, &map);
            let mut to = endpoint(&mut r, &map);
            if k % 50 == 49 {
                to = Vec2::new(-1000.0, -1000.0); // no floor within the snap radius: unreachable
            }
            let radius = [PLAYER_RADIUS, PLAYER_RADIUS, 0.0, 6.0, 20.0][k % 5];
            let want = bits(&reference.find_path(&map, from, to, radius));
            assert_eq!(
                bits(&pf.find_path(&map, from, to, radius)),
                want,
                "{name} #{k}: {from:?}->{to:?} r {radius}"
            );
            pf_into.find_path_into(&map, from, to, radius, &mut out);
            assert_eq!(bits(&out), want, "{name} #{k} (into)");
            if radius == PLAYER_RADIUS {
                assert_eq!(bits(&plan_path(&mut pf, &map, from, to)), want);
                plan_path_into(&mut pf_into, &map, from, to, &mut out);
                assert_eq!(bits(&out), want);
            }
            routed += (want.len() > 1) as u32;
            empty += want.is_empty() as u32;
        }
        // The sample exercises A* routes (more than one waypoint) and unreachable goals, not only straight lines.
        assert!(routed > n as u32 / 5, "{name}: {routed} routed");
        assert!(empty > 0, "{name}: no unreachable query");
        // Thousands of searches on one map cleared the node arrays once (the first search sized them).
        assert!(
            pf.searches > n as u64 / 5,
            "{name}: {} searches",
            pf.searches
        );
        assert_eq!(pf.full_resets(), 1, "{name}: full-array resets");
        assert_eq!(pf_into.full_resets(), 1, "{name}: full-array resets (into)");
    }
}

#[test]
fn one_pathfinder_across_maps_and_clones_gives_the_same_waypoints() {
    let all = maps();
    let mut r = Rng(0x5eed_0006);
    let mut shared = Pathfinder::default();
    let mut fresh_ref: Vec<reference::Pf> = all.iter().map(|_| reference::Pf::default()).collect();
    let mut out = Vec::new();
    for k in 0..600 {
        let m = (k / 7) % all.len(); // switch maps every few queries: a size change resets the arrays
        let map = &all[m].1;
        let (from, to) = (endpoint(&mut r, map), endpoint(&mut r, map));
        let want = bits(&fresh_ref[m].find_path(map, from, to, PLAYER_RADIUS));
        shared.find_path_into(map, from, to, PLAYER_RADIUS, &mut out);
        assert_eq!(bits(&out), want, "#{k}");
        // A clone has fresh scratch and the same search count, and answers identically.
        let mut c = shared.clone();
        assert_eq!(c.searches, shared.searches);
        assert_eq!(c.full_resets(), 0);
        assert_eq!(
            bits(&c.find_path(map, from, to, PLAYER_RADIUS)),
            want,
            "#{k} (clone)"
        );
    }
    assert!(shared.full_resets() > 2, "map switches resize the arrays");
}

#[test]
fn malformed_maps_are_decode_errors_and_decoded_maps_are_complete() {
    for bad in [
        r#"{"w":2,"h":2,"tiles":[0,0,0]}"#,
        r#"{"w":2,"h":2,"tiles":[0,0,0,0,0]}"#,
        r#"{"w":0,"h":3,"tiles":[]}"#,
        r#"{"w":3,"h":0,"tiles":[]}"#,
        r#"{"w":65536,"h":65536,"tiles":[0]}"#,
        r#"{"w":2,"tiles":[0,0]}"#,
        r#"{"w":2,"h":1,"tiles":[0,256]}"#,
    ] {
        assert!(
            serde_json::from_str::<TileMap>(bad).is_err(),
            "accepted {bad}"
        );
    }
    assert!(TileMap::new(2, 2, vec![0; 3]).is_err());
    assert!(TileMap::new(u32::MAX, u32::MAX, vec![0; 4]).is_err());

    for (name, map) in maps() {
        let text = serde_json::to_string(&map).unwrap();
        // The serialized shape is unchanged: exactly w, h and tiles.
        let want = format!(
            r#"{{"w":{},"h":{},"tiles":{}}}"#,
            map.w,
            map.h,
            serde_json::to_string(&map.tiles).unwrap()
        );
        assert_eq!(text, want, "{name}");
        let back: TileMap = serde_json::from_str(&text).unwrap();
        // Equal right after decoding, with no rebuild call, and the derived tables are there and identical.
        assert_eq!(back, map, "{name}");
        for i in 0..map.tiles.len() {
            assert_eq!(back.comp(i), map.comp(i));
            assert_eq!(back.nav(i), map.nav(i));
        }
        let mut rebuilt = back.clone();
        rebuilt.rebuild();
        assert_eq!(rebuilt, back);
        let mut r = Rng(7);
        let (mut a, mut b) = (Pathfinder::default(), Pathfinder::default());
        for _ in 0..200 {
            let (from, to) = (endpoint(&mut r, &map), endpoint(&mut r, &map));
            assert_eq!(
                bits(&a.find_path(&map, from, to, PLAYER_RADIUS)),
                bits(&b.find_path(&back, from, to, PLAYER_RADIUS))
            );
        }
    }
}

#[test]
fn a_replay_is_equal_right_after_decoding() {
    use rh_sim::replay::{Recorder, ReplayStart};
    use rh_sim::{FactionId, Placement, Secrets, Sim, SimConfig};
    let placements = [
        Placement {
            profile: "a".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(150.0, 150.0),
            hp: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Fire,
            bot: true,
            at: Vec2::new(600.0, 400.0),
            hp: None,
        },
    ];
    let secrets = Secrets {
        order_salt: 3,
        spawn_seed: 4,
    };
    let sim = Sim::reset_active(SimConfig::default(), practice_arena(), secrets, &placements);
    let rec = Recorder::new(
        &sim,
        SimConfig::default(),
        ReplayStart::Active {
            placements: placements.to_vec(),
        },
    );
    let text = serde_json::to_string(&rec.replay).unwrap();
    let back: rh_sim::replay::Replay = serde_json::from_str(&text).unwrap();
    assert_eq!(back, rec.replay);
}

#[test]
fn the_nav_mask_is_the_legacy_neighbour_test() {
    // The two real maps, plus random small maps of every tile kind (thin ones too: 1xN, Nx1, 1x1).
    let mut all = maps();
    let mut r = Rng(0x5eed_0007);
    for k in 0..300u32 {
        let (w, h) = match k {
            0 => (1, 1),
            1 => (1, 9),
            2 => (9, 1),
            _ => (1 + r.below(20) as u32, 1 + r.below(20) as u32),
        };
        let tiles = (0..w * h)
            .map(|_| [0u8, 0, 0, 1, 2][r.below(5) as usize])
            .collect();
        all.push(("random", TileMap::new(w, h, tiles).unwrap()));
    }
    for (name, map) in all {
        let (w, h) = (map.w as i64, map.h as i64);
        let floor = |x: i64, y: i64| map.tile(x, y) == Some(TILE_FLOOR);
        for y in 0..h {
            for x in 0..w {
                let m = map.nav((y * w + x) as usize);
                for d in 0..8 {
                    let (nx, ny) = (x + rh_sim::map::STEP_DX[d], y + rh_sim::map::STEP_DY[d]);
                    let legal = floor(nx, ny) && (d < 4 || (floor(nx, y) && floor(x, ny)));
                    assert_eq!(m & (1 << d) != 0, legal, "{name} ({x},{y}) d {d}");
                }
            }
        }
    }
}

#[test]
fn world_to_tile_round_trips_tile_centres() {
    for t in -5i64..200 {
        assert_eq!(world_to_tile(tile_to_world_center(t)), t);
    }
}

/// The sight verdict is NOT symmetric: `ray_blocked(a, b)` and `ray_blocked(b, a)` differ on a measurable share of segments that
/// graze a tile edge or corner (the traversal starts in a's tile and rounds its crossings from a). The publish path therefore
/// judges every ordered (viewer, other) pair on its own and never reuses one verdict for both directions; this test is what
/// stops a "compute each pair once" change, until that is shown bit for bit equal.
#[test]
fn the_sight_verdict_is_not_symmetric_so_each_ordered_pair_is_judged_alone() {
    for (name, map) in maps() {
        let mut r = Rng(0x5eed_0002 ^ map.layer_hash() as u64);
        let mut asym = 0u32;
        for _ in 0..2_000_000u32 {
            let (x0, y0, x1, y1) = segment(&mut r, &map);
            if ray_blocked(&map, x0, y0, x1, y1, MASK_SIGHT)
                != ray_blocked(&map, x1, y1, x0, y0, MASK_SIGHT)
            {
                asym += 1;
            }
        }
        assert!(asym > 0, "{name}: no asymmetric pair found in 2e6 segments");
    }
}
