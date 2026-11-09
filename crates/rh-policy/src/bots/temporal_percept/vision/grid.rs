//! Exact private port of source `shared/src/vision.ts` `VisionMemory`: a row-major tile
//! table of absolute exclusive expiries plus its own throttle/reuse bookkeeping. It is
//! written only by `update` (from an origin the caller supplies) and by the bot's own
//! reconnect restore; it never reads a World, Sim, scene or expected output.
//!
//! Source details deliberately mirrored, including their quirks:
//! - map identity (`map === lastMap`) is the [`Sight`] variant: the open map and its
//!   `withGates` copy are distinct objects even when no gate exists;
//! - the throttle ignores the origin; the reuse path refreshes only the previous scan's
//!   visible list (plus the coliseum rectangle);
//! - `clear()` resets only the expiries, `lastMap` and `lastUpdate`;
//! - the summed wall table, the fast incremental trace and the exact trace are all kept,
//!   including the fast path's flat-index reads (JS `undefined & mask` is 0 when the
//!   index leaves the array; a horizontal step past an edge reads the next row).
use rh_sim::constants::{TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS};
use rh_sim::map::MASK_SIGHT;
use rh_sim::mapdata::MapLayers;
use rh_sim::{TileMap, Vec2};

/// Source `FAST_MARGIN`.
const FAST_MARGIN: f64 = 1e-7;

/// Which immutable GameMap object a source call received: `map` or `withGates(map)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Sight {
    Open,
    Locked,
}

/// One source map object: its collision tiles plus the open map's shared metadata
/// (`withGates` copies every field except `tiles`).
#[derive(Clone, Copy)]
pub(crate) struct Geometry<'a> {
    pub(crate) id: Sight,
    pub(crate) tiles: &'a TileMap,
    pub(crate) layers: &'a MapLayers,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Grid {
    width: usize,
    height: usize,
    pub(super) expires_at: Vec<f64>,
    last_map: Option<Sight>,
    last_update: f64,
    last_radius: f64,
    last_ttl: f64,
    last_x: f64,
    last_y: f64,
    /// Only `visible[..]` of the latest full scan is ever read (source `visibleCount`).
    visible: Vec<usize>,
}

impl Grid {
    pub(crate) fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            expires_at: vec![0.; width * height],
            last_map: None,
            last_update: f64::NEG_INFINITY,
            last_radius: -1.,
            last_ttl: -1.,
            last_x: f64::NAN,
            last_y: f64::NAN,
            visible: Vec::new(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.expires_at.len()
    }

    /// Source `clear()`: lastRadius/lastTtl/lastX/lastY and the visible list survive.
    pub(crate) fn clear(&mut self) {
        self.expires_at.fill(0.);
        self.last_map = None;
        self.last_update = f64::NEG_INFINITY;
    }

    /// Source `update(map, origin, now, ttl = VISION_TRAIL_MS, radius = VISION_RADIUS)`.
    pub(crate) fn update_trail(&mut self, map: Geometry<'_>, origin: Vec2, now: f64) {
        self.update(map, origin, now, VISION_TRAIL_MS, VISION_RADIUS);
    }

    pub(crate) fn update(
        &mut self,
        map: Geometry<'_>,
        origin: Vec2,
        now: f64,
        ttl: f64,
        radius: f64,
    ) {
        // The source throws a RangeError here; BotVision always builds its grids from the
        // same map, so this cannot be reached through the private component.
        debug_assert_eq!(
            (map.tiles.w as usize, map.tiles.h as usize),
            (self.width, self.height)
        );
        if !(now + ttl + radius + origin.x + origin.y).is_finite() || ttl <= 0. || radius < 0. {
            return;
        }
        if self.last_map == Some(map.id)
            && now >= self.last_update
            && now - self.last_update < VISION_UPDATE_MS
            && radius == self.last_radius
            && ttl == self.last_ttl
        {
            return;
        }
        let reuse = self.last_map == Some(map.id)
            && radius == self.last_radius
            && origin.x == self.last_x
            && origin.y == self.last_y;
        self.last_map = Some(map.id);
        self.last_update = now;
        self.last_radius = radius;
        self.last_ttl = ttl;
        self.last_x = origin.x;
        self.last_y = origin.y;
        let until = now + ttl;
        let (mw, mh) = (i64::from(map.tiles.w), i64::from(map.tiles.h));
        let arena = map
            .layers
            .is_coliseum_at_world(origin.x, origin.y)
            .then(|| map.layers.coliseum().rect);
        if let Some(rect) = arena {
            let (x, y) = (i64::from(rect.x), i64::from(rect.y));
            let (w, h) = (i64::from(rect.w), i64::from(rect.h));
            for ty in y.max(0)..mh.min(y + h) {
                for tx in x.max(0)..mw.min(x + w) {
                    let i = ty as usize * self.width + tx as usize;
                    self.expires_at[i] = js_max(self.expires_at[i], until);
                }
            }
        }
        if reuse {
            for &index in &self.visible {
                if until > self.expires_at[index] {
                    self.expires_at[index] = until;
                }
            }
            return;
        }
        self.visible.clear();
        let floor_tile = |v: f64| (v / TILE).floor() as i64;
        let min_x = 0.max(floor_tile(origin.x - radius));
        let max_x = (mw - 1).min(floor_tile(origin.x + radius));
        let min_y = 0.max(floor_tile(origin.y - radius));
        let max_y = (mh - 1).min(floor_tile(origin.y + radius));
        let r2 = radius * radius;
        let origin_tx = floor_tile(origin.x);
        let origin_ty = floor_tile(origin.y);
        let origin_can_see = origin_tx >= 0
            && origin_ty >= 0
            && origin_tx < mw
            && origin_ty < mh
            && !is_wall_tile(map.tiles, origin_tx, origin_ty);
        if !origin_can_see {
            // The source still sizes its scratch table, but never reads it without a seeing origin.
            return;
        }
        let window = Window {
            min_x,
            min_y,
            max_x,
            max_y,
            sw: max_x - min_x + 2,
        };
        let sat = window.summed_walls(map.tiles);
        let tiles = &map.tiles.tiles;
        for ty in min_y..=max_y {
            let y = (ty as f64 + 0.5) * TILE;
            let dy = y - origin.y;
            for tx in min_x..=max_x {
                if let Some(rect) = arena {
                    if tx >= i64::from(rect.x)
                        && tx < i64::from(rect.x) + i64::from(rect.w)
                        && ty >= i64::from(rect.y)
                        && ty < i64::from(rect.y) + i64::from(rect.h)
                    {
                        continue;
                    }
                }
                let x = (tx as f64 + 0.5) * TILE;
                let dx = x - origin.x;
                if dx * dx + dy * dy > r2 {
                    continue;
                }
                if !window.wall_free(&sat, origin.x, origin.y, x, y)
                    && !sight_line_to_tile(
                        tiles,
                        map.tiles.w,
                        map.tiles.h,
                        origin.x,
                        origin.y,
                        origin_tx,
                        origin_ty,
                        tx,
                        ty,
                    )
                {
                    continue;
                }
                let i = ty as usize * self.width + tx as usize;
                self.visible.push(i);
                if until > self.expires_at[i] {
                    self.expires_at[i] = until;
                }
            }
        }
        // The standing tile is always retained, including at a radius boundary.
        let i = origin_ty as usize * self.width + origin_tx as usize;
        self.visible.push(i);
        self.expires_at[i] = js_max(self.expires_at[i], until);
    }

    /// Source `canSee(point, now)`: exclusive expiry; nonfinite input is never visible.
    pub(crate) fn can_see(&self, point: Vec2, now: f64) -> bool {
        if !(point.x + point.y + now).is_finite() {
            return false;
        }
        let x = (point.x / TILE).floor();
        let y = (point.y / TILE).floor();
        x >= 0.
            && y >= 0.
            && x < self.width as f64
            && y < self.height as f64
            && self.expires_at[y as usize * self.width + x as usize] > now
    }

    /// Cells other than +0 in row-major order (a restored -0 expiry is kept), for comparison
    /// with an actual private source read only.
    #[cfg(test)]
    pub(crate) fn cells(&self) -> Vec<(usize, f64)> {
        self.expires_at
            .iter()
            .enumerate()
            .filter(|(_, e)| e.to_bits() != 0)
            .map(|(i, e)| (i, *e))
            .collect()
    }

    /// The same fields the capture reads from the actual source instance, in its order.
    #[cfg(test)]
    pub(crate) fn diagnostic(&self) -> super::super::data::MethodValue {
        use super::super::data::{num, object, MethodValue};
        let cells = self
            .cells()
            .into_iter()
            .map(|(i, e)| MethodValue::Arr(vec![num(i as f64), num(e)]))
            .collect();
        object([
            ("cells", MethodValue::Arr(cells)),
            ("lastMap", sight_name(self.last_map)),
            ("lastUpdate", num(self.last_update)),
            ("lastRadius", num(self.last_radius)),
            ("lastTtl", num(self.last_ttl)),
            ("lastX", num(self.last_x)),
            ("lastY", num(self.last_y)),
            ("visibleCount", num(self.visible.len() as f64)),
        ])
    }
}

/// The capture's map identity names: `vision.map` → "open", `vision.locked` → "locked".
#[cfg(test)]
pub(crate) fn sight_name(sight: Option<Sight>) -> super::super::data::MethodValue {
    use super::super::data::{text, MethodValue};
    match sight {
        None => MethodValue::Null,
        Some(Sight::Open) => text("open"),
        Some(Sight::Locked) => text("locked"),
    }
}

/// `Math.max` on two non-NaN binary64 values; ties keep the first (the same value).
fn js_max(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

/// Source `isWallTile`: out of bounds is wall.
fn is_wall_tile(map: &TileMap, tx: i64, ty: i64) -> bool {
    map.blocked(tx, ty, MASK_SIGHT)
}

/// A JS typed-array read: an index outside the array is `undefined`, and `undefined & mask` is 0.
fn tile_at(tiles: &[u8], index: i64) -> u8 {
    usize::try_from(index)
        .ok()
        .and_then(|i| tiles.get(i).copied())
        .unwrap_or(0)
}

struct Window {
    min_x: i64,
    min_y: i64,
    max_x: i64,
    max_y: i64,
    sw: i64,
}
impl Window {
    /// Source summed wall counts over the update's window (rebuilt each scan).
    fn summed_walls(&self, map: &TileMap) -> Vec<i32> {
        let rows = self.max_y - self.min_y + 2;
        let mut sat = vec![0i32; (self.sw * rows) as usize];
        let mw = i64::from(map.w);
        for ty in self.min_y..=self.max_y {
            let mut row = 0i32;
            let above = (ty - self.min_y) * self.sw;
            let here = above + self.sw;
            let base = ty * mw;
            for tx in self.min_x..=self.max_x {
                if map.tiles[(base + tx) as usize] & MASK_SIGHT != 0 {
                    row += 1;
                }
                let k = (tx - self.min_x + 1) as usize;
                sat[here as usize + k] = sat[above as usize + k] + row;
            }
        }
        sat
    }
    /// Source `wallFree`: no wall in the segment ends' tile box grown by one (clamped).
    fn wall_free(&self, sat: &[i32], ax: f64, ay: f64, bx: f64, by: f64) -> bool {
        let t = |v: f64| (v / TILE).floor() as i64;
        let (ta, tb, tc, td) = (t(ax), t(ay), t(bx), t(by));
        let x0 = self.min_x.max(ta.min(tc) - 1) - self.min_x;
        let x1 = self.max_x.min(ta.max(tc) + 1) - self.min_x + 1;
        let y0 = self.min_y.max(tb.min(td) - 1) - self.min_y;
        let y1 = self.max_y.min(tb.max(td) + 1) - self.min_y + 1;
        let at = |y: i64, x: i64| sat[(y * self.sw + x) as usize];
        at(y1, x1) - at(y0, x1) - at(y1, x0) + at(y0, x0) == 0
    }
}

/// Source `sightLineToTile`: the fast incremental trace, or the exact trace when it declines.
#[allow(clippy::too_many_arguments)]
fn sight_line_to_tile(
    tiles: &[u8],
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    tx: i64,
    ty: i64,
    ex: i64,
    ey: i64,
) -> bool {
    let end_x = (ex as f64 + 0.5) * TILE;
    let end_y = (ey as f64 + 0.5) * TILE;
    let fast = fast_sight_line(tiles, width, height, x, y, end_x, end_y, tx, ty, ex, ey);
    if fast >= 0 {
        fast == 1
    } else {
        trace_sight_line(tiles, width, x, y, end_x, end_y, tx, ty, ex, ey)
    }
}

#[allow(clippy::too_many_arguments)]
fn fast_sight_line(
    tiles: &[u8],
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    end_x: f64,
    end_y: f64,
    mut tx: i64,
    mut ty: i64,
    ex: i64,
    ey: i64,
) -> i8 {
    let dx = end_x - x;
    let dy = end_y - y;
    if dx == 0. || dy == 0. {
        return -1;
    }
    let width = i64::from(width);
    let sx: i64 = if dx > 0. { 1 } else { -1 };
    let sy: i64 = if dy > 0. { 1 } else { -1 };
    let step_x = TILE / dx.abs();
    let step_y = TILE / dy.abs();
    let mut cross_x = ((tx + i64::from(sx > 0)) as f64 * TILE - x) / dx;
    let mut cross_y = ((ty + i64::from(sy > 0)) as f64 * TILE - y) / dy;
    let mut index = ty * width + tx;
    let step_index_y = sy * width;
    let mut guard = width + i64::from(height);
    while guard > 0 {
        if cross_x < cross_y - FAST_MARGIN {
            tx += sx;
            index += sx;
            cross_x += step_x;
        } else if cross_y < cross_x - FAST_MARGIN {
            ty += sy;
            index += step_index_y;
            cross_y += step_y;
        } else {
            return -1;
        }
        if tx == ex && ty == ey {
            return 1;
        }
        if tile_at(tiles, index) & MASK_SIGHT != 0 {
            return 0;
        }
        guard -= 1;
    }
    -1
}

/// Source `traceSightLine` with `MASK_SIGHT`/`TILE`; corner crossings test both neighbours.
#[allow(clippy::too_many_arguments)]
fn trace_sight_line(
    tiles: &[u8],
    width: u32,
    x: f64,
    y: f64,
    end_x: f64,
    end_y: f64,
    mut tx: i64,
    mut ty: i64,
    ex: i64,
    ey: i64,
) -> bool {
    let width = i64::from(width);
    let mut index = ty * width + tx;
    let dx = end_x - x;
    let dy = end_y - y;
    let sign = |d: f64| -> i64 {
        if d > 0. {
            1
        } else if d < 0. {
            -1
        } else {
            0
        }
    };
    let (sx, sy) = (sign(dx), sign(dy));
    let cross =
        |t: i64, s: i64, start: f64, d: f64| ((t + i64::from(s > 0)) as f64 * TILE - start) / d;
    let mut cross_x = if dx == 0. {
        f64::INFINITY
    } else {
        cross(tx, sx, x, dx)
    };
    let mut cross_y = if dy == 0. {
        f64::INFINITY
    } else {
        cross(ty, sy, y, dy)
    };
    while tx != ex || ty != ey {
        if cross_x == cross_y {
            if tile_at(tiles, index + sx) & MASK_SIGHT != 0
                || tile_at(tiles, index + sy * width) & MASK_SIGHT != 0
            {
                return false;
            }
            tx += sx;
            ty += sy;
            index += sx + sy * width;
            cross_x = if dx == 0. {
                f64::INFINITY
            } else {
                cross(tx, sx, x, dx)
            };
            cross_y = if dy == 0. {
                f64::INFINITY
            } else {
                cross(ty, sy, y, dy)
            };
        } else if cross_x < cross_y {
            tx += sx;
            index += sx;
            cross_x = cross(tx, sx, x, dx);
        } else {
            ty += sy;
            index += sy * width;
            cross_y = cross(ty, sy, y, dy);
        }
        if tx == ex && ty == ey {
            return true;
        }
        if tile_at(tiles, index) & MASK_SIGHT != 0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    //! HAND-DERIVED property (not parity): the source says its fast incremental trace answers
    //! only when it takes exactly the exact trace's tiles. Both ports must then agree.
    use super::*;

    #[test]
    fn fast_trace_agrees_with_the_exact_trace_whenever_it_answers() {
        let map = super::super::adapter::seed1();
        let (w, h) = (map.w, map.h);
        let (mut answered, mut declined) = (0, 0);
        for (ox, oy) in [
            (784.1, 464.3),
            (816., 464.),
            (560., 368.),
            (2544.5, 2128.25),
            (2576., 2576.),
            (912., 1488.),
        ] {
            let (otx, oty) = ((ox / TILE).floor() as i64, (oy / TILE).floor() as i64);
            for ty in (oty - 28).max(0)..=(oty + 28).min(i64::from(h) - 1) {
                for tx in (otx - 28).max(0)..=(otx + 28).min(i64::from(w) - 1) {
                    if (tx, ty) == (otx, oty) {
                        // Source quirk kept by both ports: from its own tile the fast trace walks
                        // away and may report a wall while the exact trace returns true at once.
                        // `update` re-adds the standing tile, so expiries agree either way.
                        continue;
                    }
                    let (ex, ey) = ((tx as f64 + 0.5) * TILE, (ty as f64 + 0.5) * TILE);
                    let fast = fast_sight_line(&map.tiles, w, h, ox, oy, ex, ey, otx, oty, tx, ty);
                    if fast < 0 {
                        declined += 1;
                        continue;
                    }
                    answered += 1;
                    let exact = trace_sight_line(&map.tiles, w, ox, oy, ex, ey, otx, oty, tx, ty);
                    assert_eq!(fast == 1, exact, "origin ({ox},{oy}) tile ({tx},{ty})");
                }
            }
        }
        assert!(
            answered > 10_000 && declined > 0,
            "{answered} answered, {declined} declined"
        );
    }
}
