//! Tile-grid geometry, operation-for-operation ports of `packages/shared/src/geometry.ts` (raycast, circleClear,
//! segmentClear). Kept in the legacy evaluation order so float results match.

use crate::constants::TILE;
use crate::map::{TileMap, MASK_MOVE};
use crate::math::{ceil_i64, floor_i64, sqrt, Vec2};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    pub hit: bool,
    pub x: f64,
    pub y: f64,
    pub dist: f64,
}

/// Grid traversal from (x0, y0) to (x1, y1); `hit` when a tile in `mask` (or out of bounds) is entered, or a diagonal corner
/// squeeze between two blocked tiles is crossed. Computes the hit point; a caller that only needs the verdict uses
/// [`ray_blocked`] (same decisions, cheaper).
pub fn raycast(map: &TileMap, x0: f64, y0: f64, x1: f64, y1: f64, mask: u8) -> RayHit {
    if !(x0 + y0 + x1 + y1).is_finite() {
        return RayHit {
            hit: true,
            x: x0,
            y: y0,
            dist: 0.0,
        };
    }
    let mut tx = floor_i64(x0 / TILE);
    let mut ty = floor_i64(y0 / TILE);
    if map.blocked(tx, ty, mask) {
        return RayHit {
            hit: true,
            x: x0,
            y: y0,
            dist: 0.0,
        };
    }
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 {
        return RayHit {
            hit: false,
            x: x1,
            y: y1,
            dist: 0.0,
        };
    }
    let step_x: i64 = if dx > 0.0 {
        1
    } else if dx < 0.0 {
        -1
    } else {
        0
    };
    let step_y: i64 = if dy > 0.0 {
        1
    } else if dy < 0.0 {
        -1
    } else {
        0
    };
    let edge = |t: i64, step: i64| (t + if step > 0 { 1 } else { 0 }) as f64 * TILE;
    let mut t_max_x = if step_x == 0 {
        f64::INFINITY
    } else {
        (edge(tx, step_x) - x0) / dx
    };
    let mut t_max_y = if step_y == 0 {
        f64::INFINITY
    } else {
        (edge(ty, step_y) - y0) / dy
    };
    loop {
        let t = if t_max_x < t_max_y { t_max_x } else { t_max_y };
        if t > 1.0 {
            return RayHit {
                hit: false,
                x: x1,
                y: y1,
                dist: len,
            };
        }
        let cross_x = t_max_x <= t;
        let cross_y = t_max_y <= t;
        let ex = if cross_x {
            (if step_x > 0 { tx + 1 } else { tx }) as f64 * TILE
        } else {
            x0 + dx * t
        };
        let ey = if cross_y {
            (if step_y > 0 { ty + 1 } else { ty }) as f64 * TILE
        } else {
            y0 + dy * t
        };
        if cross_x
            && cross_y
            && (map.blocked(tx + step_x, ty, mask) || map.blocked(tx, ty + step_y, mask))
        {
            return RayHit {
                hit: true,
                x: ex,
                y: ey,
                dist: t * len,
            };
        }
        if cross_x {
            tx += step_x;
            t_max_x = (edge(tx, step_x) - x0) / dx;
        }
        if cross_y {
            ty += step_y;
            t_max_y = (edge(ty, step_y) - y0) / dy;
        }
        if map.blocked(tx, ty, mask) {
            return RayHit {
                hit: true,
                x: ex,
                y: ey,
                dist: t * len,
            };
        }
    }
}

/// `raycast(..).hit` without the hit point: the same traversal (the same `t_max` divisions, the same comparisons, the same
/// corner-squeeze test, returning at the same decision points), minus the length `sqrt` and the per-crossing edge point
/// that only [`RayHit`] needs. The zero-length test `dx * dx + dy * dy == 0.0` is `sqrt(..) == 0.0` exactly (the square
/// root of a non-negative number is zero only at zero, including underflow). Line of sight, melee reach and the side rays
/// of [`segment_clear`] all only read the verdict. Asserted equal to `raycast(..).hit` over 10^6 random segments on two
/// maps (tests/kernel.rs).
pub fn ray_blocked(map: &TileMap, x0: f64, y0: f64, x1: f64, y1: f64, mask: u8) -> bool {
    if !(x0 + y0 + x1 + y1).is_finite() {
        return true;
    }
    if mask == 0 {
        // The padded ring is blocked only for a nonzero mask; a zero mask (no caller passes one) keeps the bounds-checked walk.
        return ray_blocked_checked(map, x0, y0, x1, y1, mask);
    }
    let tx = floor_i64(x0 / TILE);
    let ty = floor_i64(y0 / TILE);
    // The start tile may lie anywhere (up to the coordinate margin outside the map), so it takes the bounds-checked test.
    if map.blocked(tx, ty, mask) {
        return true;
    }
    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy == 0.0 {
        return false;
    }
    let step_x: i64 = if dx > 0.0 {
        1
    } else if dx < 0.0 {
        -1
    } else {
        0
    };
    let step_y: i64 = if dy > 0.0 {
        1
    } else if dy < 0.0 {
        -1
    } else {
        0
    };
    // From here the walk is inside the map: it returns the moment it enters a blocked tile, and the ring around the map is
    // blocked, so every tile it reads (the next tile, and the two corner-squeeze neighbours, each one step from the current
    // in-bounds tile) is within the padded grid. The padded index moves by one per crossing; the tile edge moves by one
    // TILE per crossing, which is exactly `(t + (step > 0)) as f64 * TILE` for the new `t` (an integer times a power of two,
    // exact in f64), so the `t_max` divisions see the very same operands as before.
    let ix = step_x as isize;
    let iy = step_y as isize * map.padded_stride();
    let mut idx = map.padded_index(tx, ty);
    let mut edge_x = (tx + if step_x > 0 { 1 } else { 0 }) as f64 * TILE;
    let mut edge_y = (ty + if step_y > 0 { 1 } else { 0 }) as f64 * TILE;
    let tile_x = step_x as f64 * TILE;
    let tile_y = step_y as f64 * TILE;
    let mut t_max_x = if step_x == 0 {
        f64::INFINITY
    } else {
        (edge_x - x0) / dx
    };
    let mut t_max_y = if step_y == 0 {
        f64::INFINITY
    } else {
        (edge_y - y0) / dy
    };
    loop {
        let t = if t_max_x < t_max_y { t_max_x } else { t_max_y };
        if t > 1.0 {
            return false;
        }
        let cross_x = t_max_x <= t;
        let cross_y = t_max_y <= t;
        if cross_x
            && cross_y
            && (map.padded_blocked(idx + ix, mask) || map.padded_blocked(idx + iy, mask))
        {
            return true;
        }
        if cross_x {
            idx += ix;
            edge_x += tile_x;
            t_max_x = (edge_x - x0) / dx;
        }
        if cross_y {
            idx += iy;
            edge_y += tile_y;
            t_max_y = (edge_y - y0) / dy;
        }
        if map.padded_blocked(idx, mask) {
            return true;
        }
    }
}

/// The bounds-checked walk [`ray_blocked`] was before the padded grid: kept for the zero mask.
fn ray_blocked_checked(map: &TileMap, x0: f64, y0: f64, x1: f64, y1: f64, mask: u8) -> bool {
    if !(x0 + y0 + x1 + y1).is_finite() {
        return true;
    }
    let mut tx = floor_i64(x0 / TILE);
    let mut ty = floor_i64(y0 / TILE);
    if map.blocked(tx, ty, mask) {
        return true;
    }
    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy == 0.0 {
        return false;
    }
    let step_x: i64 = if dx > 0.0 {
        1
    } else if dx < 0.0 {
        -1
    } else {
        0
    };
    let step_y: i64 = if dy > 0.0 {
        1
    } else if dy < 0.0 {
        -1
    } else {
        0
    };
    let edge = |t: i64, step: i64| (t + if step > 0 { 1 } else { 0 }) as f64 * TILE;
    let mut t_max_x = if step_x == 0 {
        f64::INFINITY
    } else {
        (edge(tx, step_x) - x0) / dx
    };
    let mut t_max_y = if step_y == 0 {
        f64::INFINITY
    } else {
        (edge(ty, step_y) - y0) / dy
    };
    loop {
        let t = if t_max_x < t_max_y { t_max_x } else { t_max_y };
        if t > 1.0 {
            return false;
        }
        let cross_x = t_max_x <= t;
        let cross_y = t_max_y <= t;
        if cross_x
            && cross_y
            && (map.blocked(tx + step_x, ty, mask) || map.blocked(tx, ty + step_y, mask))
        {
            return true;
        }
        if cross_x {
            tx += step_x;
            t_max_x = (edge(tx, step_x) - x0) / dx;
        }
        if cross_y {
            ty += step_y;
            t_max_y = (edge(ty, step_y) - y0) / dy;
        }
        if map.blocked(tx, ty, mask) {
            return true;
        }
    }
}

pub fn has_line_of_sight(map: &TileMap, a: Vec2, b: Vec2, mask: u8) -> bool {
    !ray_blocked(map, a.x, a.y, b.x, b.y, mask)
}

/// Does a disc of `radius` at `p` overlap no tile in `mask`?
pub fn circle_clear(map: &TileMap, p: Vec2, radius: f64, mask: u8) -> bool {
    let (cx, cy) = (p.x, p.y);
    if !(cx + cy + radius).is_finite() {
        return false;
    }
    let tx = floor_i64(cx / TILE);
    let ty = floor_i64(cy / TILE);
    if radius <= 0.0 {
        return !map.blocked(tx, ty, mask);
    }
    let reach = 1i64.max(ceil_i64(radius / TILE));
    // A 3x3 block of floor tiles (nav byte 0xFF: this tile is floor, so in bounds, and all eight neighbours are in bounds
    // and floor) has no tile blocked for any mask (floor is class 0), so the loop below would `continue` on all nine of
    // them and return true without a distance test.
    if reach == 1
        && map.is_floor(tx, ty)
        && map.nav(ty as usize * map.w as usize + tx as usize) == 0xFF
    {
        return true;
    }
    let r2 = radius * radius;
    for j in ty.saturating_sub(reach)..=ty.saturating_add(reach) {
        for i in tx.saturating_sub(reach)..=tx.saturating_add(reach) {
            if !map.blocked(i, j, mask) {
                continue;
            }
            let nx = cx
                .max(i as f64 * TILE)
                .min(i.saturating_add(1) as f64 * TILE);
            let ny = cy
                .max(j as f64 * TILE)
                .min(j.saturating_add(1) as f64 * TILE);
            let ddx = cx - nx;
            let ddy = cy - ny;
            if ddx * ddx + ddy * ddy < r2 {
                return false;
            }
        }
    }
    true
}

/// Can a disc of `radius` slide straight from `a` to `b`? Both ends clear, the centre ray clear, and side rays at the
/// radius (legacy `segmentClear`).
pub fn segment_clear(map: &TileMap, a: Vec2, b: Vec2, radius: f64, mask: u8) -> bool {
    if !circle_clear(map, a, radius, mask) || !circle_clear(map, b, radius, mask) {
        return false;
    }
    segment_rays_clear(map, a, b, radius, mask)
}

/// The ray part of [`segment_clear`]: the centre ray and the side rays, with both end discs already known clear. The
/// string pull (pathfind.rs) tests many segments from one anchor to a window of candidates, so it evaluates each end disc
/// once and memoizes it instead of once per segment; the predicates are pure, so the verdicts are the same.
pub(crate) fn segment_rays_clear(map: &TileMap, a: Vec2, b: Vec2, radius: f64, mask: u8) -> bool {
    if ray_blocked(map, a.x, a.y, b.x, b.y, mask) {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 || radius <= 0.0 {
        return true;
    }
    let nx = -dy / len;
    let ny = dx / len;
    let rays = ceil_i64(radius / TILE);
    for k in 1..=rays {
        let off = (radius * k as f64) / rays as f64;
        let ox = nx * off;
        let oy = ny * off;
        if ray_blocked(map, a.x + ox, a.y + oy, b.x + ox, b.y + oy, mask) {
            return false;
        }
        if ray_blocked(map, a.x - ox, a.y - oy, b.x - ox, b.y - oy, mask) {
            return false;
        }
    }
    true
}

/// `segment_clear` with the movement mask (bodies).
pub fn walkable_segment(map: &TileMap, a: Vec2, b: Vec2, radius: f64) -> bool {
    segment_clear(map, a, b, radius, MASK_MOVE)
}

// ---- ADR0024: hitbox archetypes (foot box for walls, body box for hits) ----

/// What a mover occupies on the ground for walls and paths (ADR0024 Decision 3). `Disc(r)` is the legacy circle and runs
/// exactly today's functions ([`circle_clear`], [`segment_rays_clear`]); `Box` is an axis-aligned foot box centred on the
/// feet with half-extents `hx` (east-west) and `hy` (north-south).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Footprint {
    Disc(f64),
    Box { hx: f64, hy: f64 },
}

impl From<f64> for Footprint {
    /// A bare radius is the legacy disc, so every existing `radius` argument keeps its meaning.
    fn from(r: f64) -> Self {
        Footprint::Disc(r)
    }
}

impl Footprint {
    /// Does the footprint at `p` overlap no tile in `mask`? Touching a tile is clear (the disc's `< r^2`, the box's open
    /// interval).
    #[inline]
    pub fn clear(self, map: &TileMap, p: Vec2, mask: u8) -> bool {
        match self {
            Footprint::Disc(r) => circle_clear(map, p, r, mask),
            Footprint::Box { hx, hy } => box_clear(map, p, hx, hy, mask),
        }
    }

    /// Can the footprint slide straight from `a` to `b`? Both ends clear, then the rays.
    pub fn segment_clear(self, map: &TileMap, a: Vec2, b: Vec2, mask: u8) -> bool {
        match self {
            Footprint::Disc(r) => segment_clear(map, a, b, r, mask),
            Footprint::Box { hx, hy } => segment_box_clear(map, a, b, hx, hy, mask),
        }
    }

    /// The ray part of [`Footprint::segment_clear`], with both end footprints already known clear.
    #[inline]
    pub fn segment_rays_clear(self, map: &TileMap, a: Vec2, b: Vec2, mask: u8) -> bool {
        match self {
            Footprint::Disc(r) => segment_rays_clear(map, a, b, r, mask),
            Footprint::Box { hx, hy } => segment_box_rays_clear(map, a, b, hx, hy, mask),
        }
    }

    /// The half-extent along x (a disc's radius).
    #[inline]
    pub fn half_x(self) -> f64 {
        match self {
            Footprint::Disc(r) => r,
            Footprint::Box { hx, .. } => hx,
        }
    }

    /// The half-extent along y (a disc's radius).
    #[inline]
    pub fn half_y(self) -> f64 {
        match self {
            Footprint::Disc(r) => r,
            Footprint::Box { hy, .. } => hy,
        }
    }
}

/// Does the axis-aligned box `[x-hx, x+hx] x [y-hy, y+hy]` overlap no tile in `mask`? A tile counts only when it overlaps
/// the box's open interior, so a box touching a wall face is clear (as the disc's strict `< r^2`). Out of bounds is blocked.
pub fn box_clear(map: &TileMap, p: Vec2, hx: f64, hy: f64, mask: u8) -> bool {
    if !(p.x + p.y + hx + hy).is_finite() {
        return false;
    }
    if hx <= 0.0 || hy <= 0.0 {
        return !map.blocked(floor_i64(p.x / TILE), floor_i64(p.y / TILE), mask);
    }
    // Tile i overlaps the open interval (x - hx, x + hx) when i*T < x + hx and (i + 1)*T > x - hx.
    let i0 = floor_i64((p.x - hx) / TILE);
    let i1 = ceil_i64((p.x + hx) / TILE) - 1;
    let j0 = floor_i64((p.y - hy) / TILE);
    let j1 = ceil_i64((p.y + hy) / TILE) - 1;
    for j in j0..=j1 {
        for i in i0..=i1 {
            if map.blocked(i, j, mask) {
                return false;
            }
        }
    }
    true
}

/// Can the box of half-extents (`hx`, `hy`) slide straight from `a` to `b`? Both end boxes clear, the centre ray clear
/// and the two silhouette-corner rays clear. The swept box is a hexagon whose sides are the two end boxes' outer edges
/// and the two segments traced by the silhouette corners; because the box diagonal is shorter than a tile, a blocked tile
/// that meets the hexagon must meet an end box or a silhouette segment.
pub fn segment_box_clear(map: &TileMap, a: Vec2, b: Vec2, hx: f64, hy: f64, mask: u8) -> bool {
    if !box_clear(map, a, hx, hy, mask) || !box_clear(map, b, hx, hy, mask) {
        return false;
    }
    segment_box_rays_clear(map, a, b, hx, hy, mask)
}

/// The ray part of [`segment_box_clear`].
pub(crate) fn segment_box_rays_clear(
    map: &TileMap,
    a: Vec2,
    b: Vec2,
    hx: f64,
    hy: f64,
    mask: u8,
) -> bool {
    if ray_blocked(map, a.x, a.y, b.x, b.y, mask) {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx == 0.0 && dy == 0.0) || hx <= 0.0 || hy <= 0.0 {
        return true;
    }
    // The silhouette corners are the two corners farthest from the line of motion, one on each side: for motion with
    // dx*dy >= 0 (south-east or north-west, and the axis directions) they are (+hx, -hy) and (-hx, +hy), otherwise
    // (+hx, +hy) and (-hx, -hy). For an axis-aligned motion either pair covers the two side edges together with the end
    // boxes.
    let (ox, oy) = if dx * dy >= 0.0 { (hx, -hy) } else { (hx, hy) };
    !ray_blocked(map, a.x + ox, a.y + oy, b.x + ox, b.y + oy, mask)
        && !ray_blocked(map, a.x - ox, a.y - oy, b.x - ox, b.y - oy, mask)
}

/// An axis-aligned box in sim units: `[x0, x1] x [y0, y1]` (north is -y).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Aabb {
    /// The box centred at `c` with half-extents (`hx`, `hy`).
    #[inline]
    pub fn centred(c: Vec2, hx: f64, hy: f64) -> Self {
        Aabb {
            x0: c.x - hx,
            y0: c.y - hy,
            x1: c.x + hx,
            y1: c.y + hy,
        }
    }

    /// The box grown by `m` on every side.
    #[inline]
    pub fn grown(self, m: f64) -> Self {
        Aabb {
            x0: self.x0 - m,
            y0: self.y0 - m,
            x1: self.x1 + m,
            y1: self.y1 + m,
        }
    }

    #[inline]
    pub fn contains(self, p: Vec2) -> bool {
        p.x >= self.x0 && p.x <= self.x1 && p.y >= self.y0 && p.y <= self.y1
    }

    #[inline]
    pub fn centre(self) -> Vec2 {
        Vec2::new((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)
    }

    /// The point of the box closest to `p`.
    #[inline]
    pub fn closest(self, p: Vec2) -> Vec2 {
        Vec2::new(p.x.max(self.x0).min(self.x1), p.y.max(self.y0).min(self.y1))
    }
}

/// The first `u` in `[0, 1]` at which the segment `a + u (b - a)` is in the closed box (slab test, no square root), or
/// `None`. A start inside the box counts as `u = 0` only when the segment is not moving away from the box centre, which
/// mirrors the disc `contact` of the projectile sweep (a shot leaving a body it starts in does not hit it again). Any
/// non-finite input is `None`, as the disc `contact` is for NaN.
pub fn segment_box_entry(a: Vec2, b: Vec2, bx: Aabb) -> Option<f64> {
    if !(a.x + a.y + b.x + b.y + bx.x0 + bx.y0 + bx.x1 + bx.y1).is_finite() {
        return None;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if bx.contains(a) {
        let c = bx.centre();
        return ((a.x - c.x) * dx + (a.y - c.y) * dy <= 0.0).then_some(0.0);
    }
    let mut lo = 0.0f64;
    let mut hi = 1.0f64;
    for (p, d, min, max) in [(a.x, dx, bx.x0, bx.x1), (a.y, dy, bx.y0, bx.y1)] {
        if d == 0.0 {
            if p < min || p > max {
                return None;
            }
            continue;
        }
        let mut t0 = (min - p) / d;
        let mut t1 = (max - p) / d;
        if t0 > t1 {
            core::mem::swap(&mut t0, &mut t1);
        }
        if t0 > lo {
            lo = t0;
        }
        if t1 < hi {
            hi = t1;
        }
        if lo > hi {
            return None;
        }
    }
    Some(lo)
}

/// Does the melee arc (origin `o`, aim `a`, `reach`, `half_arc`) touch the box? Exact (ADR0024 Decision 5): with `p` the
/// point of the box closest to `o`, (1) `o` inside the box hits; (2) `|p - o| > reach` misses; (3) `p`'s bearing within
/// `half_arc + ARC_EPS` of `a` hits; (4) otherwise it hits only if one of the two boundary rays
/// `o + [0, reach] * dir(a +/- half_arc)` crosses the box. Proof of (4): the box intersected with the disc is convex, so a
/// part of it inside the wedge, with `p` outside the wedge, must cross the wedge boundary inside the disc. Any non-finite
/// input misses (as the legacy `in_arc` does for NaN). The melee system resolves an origin inside the box with the legacy
/// disc test instead (ADR0024 Decision 5), so step (1) is the geometric answer, not the rule a swing uses.
pub fn arc_hits_box(o: Vec2, a: f64, reach: f64, half_arc: f64, bx: Aabb) -> bool {
    use crate::constants::ARC_EPS;
    use crate::math::{angle_between, atan2, cos, sin};
    if !(o.x + o.y + a + half_arc + bx.x0 + bx.y0 + bx.x1 + bx.y1).is_finite() {
        return false;
    }
    if bx.contains(o) {
        return true;
    }
    let p = bx.closest(o);
    let dx = p.x - o.x;
    let dy = p.y - o.y;
    if !(reach >= 0.0) || dx * dx + dy * dy > reach * reach {
        return false;
    }
    if angle_between(atan2(dy, dx), a) <= half_arc + ARC_EPS {
        return true;
    }
    [a - half_arc, a + half_arc].into_iter().any(|edge| {
        let end = Vec2::new(o.x + cos(edge) * reach, o.y + sin(edge) * reach);
        segment_box_entry(o, end, bx).is_some()
    })
}
