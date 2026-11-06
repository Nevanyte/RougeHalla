//! Source-exact Blaze ray search, including the coliseum's closed-vertex rule.
use crate::constants::{PLAYER_RADIUS, TILE};
use crate::map::{world_to_tile, TILE_WALL};
use crate::{TileMap, Vec2};
pub const MIN_DIST: f64 = 64.;
pub const MAX_DIST: f64 = 300.;
pub const STEP: f64 = 4.;
#[derive(Clone, Debug)]
pub struct Ring {
    mask: Vec<bool>,
    x0: i64,
    y0: i64,
    x1: i64,
    y1: i64,
}
impl Ring {
    pub fn new(map: &TileMap) -> Self {
        let inside = |x: i64, y: i64| {
            map.layers().is_some_and(|l| {
                l.is_coliseum_at_world(x as f64 * TILE + TILE / 2., y as f64 * TILE + TILE / 2.)
            })
        };
        Self::from_region(map, inside)
    }
    fn from_region(map: &TileMap, inside: impl Fn(i64, i64) -> bool) -> Self {
        let mut ring = Self {
            mask: vec![false; (map.w * map.h) as usize],
            x0: i64::from(map.w),
            y0: i64::from(map.h),
            x1: -1,
            y1: -1,
        };
        for y in 0..i64::from(map.h) {
            for x in 0..i64::from(map.w) {
                if !inside(x, y) {
                    continue;
                }
                let edge = (-1..=1)
                    .any(|dy| (-1..=1).any(|dx| (dx != 0 || dy != 0) && !inside(x + dx, y + dy)));
                if edge {
                    ring.mask[(y * i64::from(map.w) + x) as usize] = true;
                    ring.x0 = ring.x0.min(x);
                    ring.x1 = ring.x1.max(x);
                    ring.y0 = ring.y0.min(y);
                    ring.y1 = ring.y1.max(y);
                }
            }
        }
        ring
    }
    pub fn crosses(&self, map: &TileMap, a: Vec2, b: Vec2) -> bool {
        if self.x1 < self.x0 {
            return false;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if !(a.x + a.y + dx + dy).is_finite() {
            return true;
        }
        let mut tx = world_to_tile(a.x);
        let mut ty = world_to_tile(a.y);
        let bx = world_to_tile(b.x);
        let by = world_to_tile(b.y);
        if tx.max(bx) < self.x0
            || tx.min(bx) > self.x1
            || ty.max(by) < self.y0
            || ty.min(by) > self.y1
        {
            return false;
        }
        let blocks = |x: i64, y: i64| {
            x >= 0
                && y >= 0
                && x < i64::from(map.w)
                && y < i64::from(map.h)
                && self.mask[(y * i64::from(map.w) + x) as usize]
                && map.tile(x, y) == Some(TILE_WALL)
        };
        if blocks(tx, ty) {
            return true;
        }
        let sx = if dx > 0. {
            1
        } else if dx < 0. {
            -1
        } else {
            0
        };
        let sy = if dy > 0. {
            1
        } else if dy < 0. {
            -1
        } else {
            0
        };
        let next_x = |x: i64| {
            if sx == 0 {
                f64::INFINITY
            } else {
                ((x + i64::from(sx > 0)) as f64 * TILE - a.x) / dx
            }
        };
        let next_y = |y: i64| {
            if sy == 0 {
                f64::INFINITY
            } else {
                ((y + i64::from(sy > 0)) as f64 * TILE - a.y) / dy
            }
        };
        let mut mx = next_x(tx);
        let mut my = next_y(ty);
        loop {
            let t = mx.min(my);
            if t > 1. {
                return false;
            }
            let cx = mx <= t;
            let cy = my <= t;
            if cx && cy && (blocks(tx + sx, ty) || blocks(tx, ty + sy)) {
                return true;
            }
            if cx {
                tx += sx;
                mx = next_x(tx);
            }
            if cy {
                ty += sy;
                my = next_y(ty);
            }
            if blocks(tx, ty) {
                return true;
            }
        }
    }
}
pub fn landing(
    map: &TileMap,
    cmap: &TileMap,
    ring: &Ring,
    locked: bool,
    from: Vec2,
    toward: Vec2,
) -> Option<Vec2> {
    let inside = |p: Vec2| {
        map.layers()
            .is_some_and(|l| l.is_coliseum_at_world(p.x, p.y))
    };
    landing_in(cmap, ring, locked, from, toward, inside)
}
fn landing_in(
    cmap: &TileMap,
    ring: &Ring,
    locked: bool,
    from: Vec2,
    toward: Vec2,
    inside: impl Fn(Vec2) -> bool,
) -> Option<Vec2> {
    let dx = toward.x - from.x;
    let dy = toward.y - from.y;
    let len = crate::math::sqrt(dx * dx + dy * dy);
    if !len.is_finite() || len < 1. {
        return None;
    }
    let want = MAX_DIST.min(len.max(MIN_DIST));
    let tx = world_to_tile(from.x);
    let ty = world_to_tile(from.y);
    if cmap.is_solid(tx, ty) {
        return None;
    }
    let home = cmap.comp((ty * i64::from(cmap.w) + tx) as usize);
    let home_inside = locked && inside(from);
    let ux = dx / len;
    let uy = dy / len;
    let mut k = 0;
    loop {
        let d = want - f64::from(k) * STEP;
        if d < MIN_DIST {
            return None;
        }
        let p = Vec2::new(from.x + ux * d, from.y + uy * d);
        k += 1;
        if !crate::geometry::circle_clear(cmap, p, PLAYER_RADIUS, crate::map::MASK_MOVE) {
            continue;
        }
        if cmap.comp((world_to_tile(p.y) * i64::from(cmap.w) + world_to_tile(p.x)) as usize) != home
        {
            continue;
        }
        if locked && inside(p) != home_inside {
            continue;
        }
        if ring.crosses(cmap, from, p) {
            continue;
        }
        return Some(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_source_ring_vertices_gates_and_reverse_segments() {
        let corpus: serde_json::Value =
            serde_json::from_str(include_str!("../../../../parity/abilities/source.json")).unwrap();
        for row in corpus["helpers"]["ring"].as_array().unwrap() {
            let input = &row["input"];
            let raw = &input["map"];
            let w = raw["w"].as_u64().unwrap() as u32;
            let h = raw["h"].as_u64().unwrap() as u32;
            let map =
                TileMap::new(w, h, serde_json::from_value(raw["tiles"].clone()).unwrap()).unwrap();
            let locked = input["locked"].as_bool().unwrap();
            let mut tiles = map.tiles.clone();
            if locked {
                for gate in raw["coliseum"]["gates"].as_array().unwrap() {
                    for tile in gate["tiles"].as_array().unwrap() {
                        tiles[(tile["y"].as_u64().unwrap() * u64::from(w)
                            + tile["x"].as_u64().unwrap())
                            as usize] = TILE_WALL;
                    }
                }
            }
            let cmap = TileMap::new(w, h, tiles).unwrap();
            let grid: Vec<u8> = serde_json::from_value(raw["regionGrid"].clone()).unwrap();
            let region = |x: i64, y: i64| {
                x >= 0
                    && y >= 0
                    && x < i64::from(w)
                    && y < i64::from(h)
                    && grid[(y * i64::from(w) + x) as usize] == 6
            };
            let ring = Ring::from_region(&map, region);
            let a: Vec2 = serde_json::from_value(input["a"].clone()).unwrap();
            let b: Vec2 = serde_json::from_value(input["b"].clone()).unwrap();
            assert_eq!(
                ring.crosses(&cmap, a, b),
                row["crosses"].as_bool().unwrap(),
                "source forward ring {input}"
            );
            assert_eq!(
                ring.crosses(&cmap, b, a),
                row["crosses"].as_bool().unwrap(),
                "source reverse ring {input}"
            );
            let got = landing_in(&cmap, &ring, locked, a, b, |p| {
                region(world_to_tile(p.x), world_to_tile(p.y))
            });
            let expected: Option<Vec2> = serde_json::from_value(row["blink"].clone()).unwrap();
            match (got, expected) {
                (None, None) => {}
                (Some(a), Some(b)) => {
                    assert!((a.x - b.x).abs() < 2e-6 && (a.y - b.y).abs() < 2e-6)
                }
                _ => panic!("source blink mismatch {input}: {got:?} != {expected:?}"),
            }
        }
    }
}
