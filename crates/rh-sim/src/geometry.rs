//! Tile-grid geometry, operation-for-operation ports of `packages/shared/src/geometry.ts` (raycast, circleClear,
//! segmentClear). Kept in the legacy evaluation order so float results match.

use crate::constants::TILE;
use crate::map::{TileMap, MASK_MOVE};
use crate::math::{sqrt, Vec2};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RayHit {
    pub hit: bool,
    pub x: f64,
    pub y: f64,
    pub dist: f64,
}

/// Grid traversal from (x0, y0) to (x1, y1); `hit` when a tile in `mask` (or out of bounds) is entered, or a diagonal corner
/// squeeze between two blocked tiles is crossed.
pub fn raycast(map: &TileMap, x0: f64, y0: f64, x1: f64, y1: f64, mask: u8) -> RayHit {
    if !(x0 + y0 + x1 + y1).is_finite() {
        return RayHit { hit: true, x: x0, y: y0, dist: 0.0 };
    }
    let mut tx = (x0 / TILE).floor() as i64;
    let mut ty = (y0 / TILE).floor() as i64;
    if map.blocked(tx, ty, mask) {
        return RayHit { hit: true, x: x0, y: y0, dist: 0.0 };
    }
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = sqrt(dx * dx + dy * dy);
    if len == 0.0 {
        return RayHit { hit: false, x: x1, y: y1, dist: 0.0 };
    }
    let step_x: i64 = if dx > 0.0 { 1 } else if dx < 0.0 { -1 } else { 0 };
    let step_y: i64 = if dy > 0.0 { 1 } else if dy < 0.0 { -1 } else { 0 };
    let edge = |t: i64, step: i64| (t + if step > 0 { 1 } else { 0 }) as f64 * TILE;
    let mut t_max_x = if step_x == 0 { f64::INFINITY } else { (edge(tx, step_x) - x0) / dx };
    let mut t_max_y = if step_y == 0 { f64::INFINITY } else { (edge(ty, step_y) - y0) / dy };
    loop {
        let t = if t_max_x < t_max_y { t_max_x } else { t_max_y };
        if t > 1.0 {
            return RayHit { hit: false, x: x1, y: y1, dist: len };
        }
        let cross_x = t_max_x <= t;
        let cross_y = t_max_y <= t;
        let ex = if cross_x { (if step_x > 0 { tx + 1 } else { tx }) as f64 * TILE } else { x0 + dx * t };
        let ey = if cross_y { (if step_y > 0 { ty + 1 } else { ty }) as f64 * TILE } else { y0 + dy * t };
        if cross_x && cross_y && (map.blocked(tx + step_x, ty, mask) || map.blocked(tx, ty + step_y, mask)) {
            return RayHit { hit: true, x: ex, y: ey, dist: t * len };
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
            return RayHit { hit: true, x: ex, y: ey, dist: t * len };
        }
    }
}

pub fn has_line_of_sight(map: &TileMap, a: Vec2, b: Vec2, mask: u8) -> bool {
    !raycast(map, a.x, a.y, b.x, b.y, mask).hit
}

/// Does a disc of `radius` at `p` overlap no tile in `mask`?
pub fn circle_clear(map: &TileMap, p: Vec2, radius: f64, mask: u8) -> bool {
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

/// Can a disc of `radius` slide straight from `a` to `b`? Both ends clear, the centre ray clear, and side rays at the
/// radius (legacy `segmentClear`).
pub fn segment_clear(map: &TileMap, a: Vec2, b: Vec2, radius: f64, mask: u8) -> bool {
    if !circle_clear(map, a, radius, mask) || !circle_clear(map, b, radius, mask) {
        return false;
    }
    if raycast(map, a.x, a.y, b.x, b.y, mask).hit {
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

/// `segment_clear` with the movement mask (bodies).
pub fn walkable_segment(map: &TileMap, a: Vec2, b: Vec2, radius: f64) -> bool {
    segment_clear(map, a, b, radius, MASK_MOVE)
}
