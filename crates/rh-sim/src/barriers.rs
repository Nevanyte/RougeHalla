//! Deployed barriers (P-FROST-WALL-1; unreleased legacy 78dd8bd4 `packages/shared/src/barriers.ts`): a barrier is a set
//! of map tiles that, while it stands, is LOW ground (`TILE_LOW`: it stops bodies and melee swings, not sight or shots).
//! The tiles are decided once, when the cast lands, and kept beside the wall's field (`AbilityRuntime::barriers`,
//! serialized and hashed); the collision map the body, swing and path queries read is the arena's with those tiles LOW
//! ([`Overlay`], derived, rebuilt by [`sync`] whenever a wall rises or falls and after a restore).
//!
//! Pure geometry first ([`wall_segment_for`], [`wall_cells`]), then the runtime rows and the overlay. Only a world whose
//! `SimConfig::frost_wish` is `Wall` ever holds a barrier (`check`).
use crate::{
    constants::TILE,
    map::{TileMap, TILE_FLOOR},
    state::World,
    statics::MatchStatic,
    Vec2,
};
use std::sync::Arc;

/// The wall's tile reach and end slack (legacy `WALL_CELL_REACH`, `WALL_END_SLACK`) are content registry rows
/// (`constants.rs`, P-FROST-WALL-2a), re-exported here.
pub use crate::constants::{WALL_CELL_REACH, WALL_END_SLACK};

/// A wall's line (legacy `WallSegment`): its centre (the clamped aim point) and its two ends, square to the line from
/// the caster.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WallSegment {
    pub cx: f64,
    pub cy: f64,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

/// Where a wall aimed from `from` at `cursor` stands (legacy `wallSegmentFor`): centred on the cursor clamped to
/// `range` (no closer than `min_range`), across the line from the caster, `length` long. A cursor on the caster aims
/// along `facing`.
pub fn wall_segment_for(
    from: Vec2,
    cursor: Vec2,
    range: f64,
    min_range: f64,
    length: f64,
    facing: f64,
) -> WallSegment {
    let mut dx = cursor.x - from.x;
    let mut dy = cursor.y - from.y;
    let mut d = crate::math::sqrt(dx * dx + dy * dy);
    // Legacy `!(d >= 1)`: a NaN distance aims along the facing too.
    if d.is_nan() || d < 1. {
        dx = crate::math::cos(facing);
        dy = crate::math::sin(facing);
        d = 1.;
    }
    let ux = dx / d;
    let uy = dy / d;
    let at = d.max(min_range).min(range);
    let cx = from.x + ux * at;
    let cy = from.y + uy * at;
    let half = length / 2.;
    // Square to the aim: (-uy, ux).
    WallSegment {
        cx,
        cy,
        x1: cx - uy * half,
        y1: cy + ux * half,
        x2: cx + uy * half,
        y2: cy - ux * half,
    }
}

/// Legacy `distPointToSegment` (shared/geometry.ts), in its operation order.
fn dist_point_to_segment(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let abx = bx - ax;
    let aby = by - ay;
    let len2 = abx * abx + aby * aby;
    let t = if len2 > 0. {
        ((px - ax) * abx + (py - ay) * aby) / len2
    } else {
        0.
    };
    // Legacy clamps with two ifs; `clamp` gives the same result, NaN included.
    let t = t.clamp(0., 1.);
    let ex = px - (ax + abx * t);
    let ey = py - (ay + aby * t);
    crate::math::sqrt(ex * ex + ey * ey)
}

/// The FLOOR tiles of `map` under the wall (legacy `wallCells`), as row-major indices in ascending order, written to
/// `out` (cleared first): a tile centre within [`WALL_CELL_REACH`] of the wall's line and no further than
/// [`WALL_END_SLACK`] past either end along it.
pub fn wall_cells(map: &TileMap, seg: &WallSegment, out: &mut Vec<u32>) {
    out.clear();
    let reach = WALL_CELL_REACH;
    let ex = seg.x2 - seg.x1;
    let ey = seg.y2 - seg.y1;
    let len = crate::math::sqrt(ex * ex + ey * ey);
    let (ux, uy) = if len > 0. {
        (ex / len, ey / len)
    } else {
        (0., 0.)
    };
    let tile_floor = |v: f64| crate::math::floor_i64(v / TILE);
    let min_x = tile_floor(seg.x1.min(seg.x2) - reach).max(0);
    let max_x = tile_floor(seg.x1.max(seg.x2) + reach).min(i64::from(map.w) - 1);
    let min_y = tile_floor(seg.y1.min(seg.y2) - reach).max(0);
    let max_y = tile_floor(seg.y1.max(seg.y2) + reach).min(i64::from(map.h) - 1);
    for ty in min_y..=max_y {
        for tx in min_x..=max_x {
            let i = ty * i64::from(map.w) + tx;
            if map.tiles[i as usize] != TILE_FLOOR {
                continue;
            }
            let px = tx as f64 * TILE + TILE / 2.;
            let py = ty as f64 * TILE + TILE / 2.;
            let along = (px - seg.x1) * ux + (py - seg.y1) * uy;
            if along < -WALL_END_SLACK || along > len + WALL_END_SLACK {
                continue;
            }
            if dist_point_to_segment(px, py, seg.x1, seg.y1, seg.x2, seg.y2) <= reach {
                out.push(i as u32);
            }
        }
    }
}

// ---- The push-out of a rising wall (P-FROST-WALL-1b; legacy 78dd8bd4 `abilities.ts:532-616` `raiseWall`) ----
//
// The search's numbers are legacy's module-local `WALL_PUSH_STEP = 4` and `WALL_PUSH_MAX = 96` (`:532-533`) and the gap's
// `PLAYER_RADIUS + 32` (`:585`, Rust `WALL_GAP_REACH`). They are content registry rows (`constants.rs`,
// P-FROST-WALL-2a) like the other wall numbers, read only under `SimConfig::frost_wish = Wall`.

/// The wall's unit normal, pointing away from the caster (legacy `raiseWall` `nx`, `ny`): from where the caster stood to
/// the wall's centre, along the caster's facing when that is shorter than 1 u (or not a number).
pub(crate) fn wall_normal(seg: &WallSegment, origin: Vec2, facing: f64) -> (f64, f64) {
    let mut nx = seg.cx - origin.x;
    let mut ny = seg.cy - origin.y;
    let nd = crate::math::sqrt(nx * nx + ny * ny);
    if nd >= 1. {
        nx /= nd;
        ny /= nd;
    } else {
        nx = crate::math::cos(facing);
        ny = crate::math::sin(facing);
    }
    (nx, ny)
}

/// Does a body at `p` touch one of `cells` (legacy `raiseWall` `overlaps`)? Any of the tiles under the box of half-side
/// `PLAYER_RADIUS + 1` round `p`, whatever the fighter's hitbox. `w` is the map's width in tiles; an index off the map's
/// row wraps as legacy's `ty * w + tx` does, and only ever names a tile `cells` holds.
pub(crate) fn overlaps(cells: &[u32], w: u32, p: Vec2) -> bool {
    let r = crate::constants::PLAYER_RADIUS + 1.;
    let x0 = crate::math::floor_i64((p.x - r) / TILE);
    let x1 = crate::math::floor_i64((p.x + r) / TILE);
    let y0 = crate::math::floor_i64((p.y - r) / TILE);
    let y1 = crate::math::floor_i64((p.y + r) / TILE);
    for ty in y0..=y1 {
        for tx in x0..=x1 {
            let i = ty * i64::from(w) + tx;
            if u32::try_from(i).is_ok_and(|i| cells.binary_search(&i).is_ok()) {
                return true;
            }
        }
    }
    false
}

/// Where a fighter at `p` that the wall's `cells` land on is set down (legacy `raiseWall` `:574-582`): from its spot
/// projected onto the wall's line, outward along the normal `n` in steps of 4 up to 96, first on its own side (the
/// caster's side for the caster, the far side for one exactly on the line), then on the other; the first spot whose body
/// touches no wall tile and whose disc is clear on `before` (the map without this wall). `None`: no room on either side.
pub(crate) fn set_down(
    before: &TileMap,
    cells: &[u32],
    w: u32,
    seg: &WallSegment,
    (nx, ny): (f64, f64),
    p: Vec2,
    caster: bool,
) -> Option<Vec2> {
    let (step, max) = (
        crate::constants::WALL_PUSH_STEP,
        crate::constants::WALL_PUSH_MAX,
    );
    let along = (p.x - seg.cx) * nx + (p.y - seg.cy) * ny;
    let first: f64 = if caster {
        -1.
    } else if along >= 0. {
        1.
    } else {
        -1.
    };
    for side in [first, -first] {
        let bx = p.x - along * nx;
        let by = p.y - along * ny;
        let mut d = step;
        while d <= max {
            let q = Vec2::new(bx + nx * side * d, by + ny * side * d);
            if !overlaps(cells, w, q)
                && crate::geometry::circle_clear(
                    before,
                    q,
                    crate::constants::PLAYER_RADIUS,
                    crate::map::MASK_MOVE,
                )
            {
                return Some(q);
            }
            d += step;
        }
    }
    None
}

/// The gap a fighter at `p` with no room on either side keeps (legacy `raiseWall` `:585-590`): every cell whose tile
/// centre is within `PLAYER_RADIUS + 32` of `p` on both axes (a square) leaves the wall. The rest stay ascending.
pub(crate) fn keep_gap(cells: &mut Vec<u32>, w: u32, p: Vec2) {
    let r = crate::constants::WALL_GAP_REACH;
    cells.retain(|&i| {
        let px = f64::from(i % w) * TILE + TILE / 2.;
        let py = f64::from(i / w) * TILE + TILE / 2.;
        !((px - p.x).abs() <= r && (py - p.y).abs() <= r)
    });
}

/// Does the walk from `from` along `path` run into anything on `map` (legacy `raiseWall` `:605-610`: each leg tested with
/// `segmentClear(after, from, p, PLAYER_RADIUS)`)?
pub(crate) fn walk_blocked(map: &TileMap, from: Vec2, path: &[Vec2]) -> bool {
    let mut from = from;
    for &p in path {
        if !crate::geometry::segment_clear(
            map,
            from,
            p,
            crate::constants::PLAYER_RADIUS,
            crate::map::MASK_MOVE,
        ) {
            return true;
        }
        from = p;
    }
    false
}

/// One standing barrier: the wall field it belongs to and its tiles (ascending row-major indices, FLOOR on the open map).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Barrier {
    pub(crate) field: u32,
    pub(crate) cells: Vec<u32>,
}

/// The standing barriers, in field order. An empty row (every `FrostWish::Freeze` world, and a `Wall` world with no wall
/// up) serializes as a unit: JSON `null`, and no word for the state hasher, so every world without a wall hashes and
/// checkpoints as it did before the field existed. It is safe for the reason `MobRuntime::buffs` is (`hash.rs`): the
/// row is non-empty exactly when the field list written before it holds a `Wall` field (`check`), so the untagged empty
/// form cannot be confused with a written one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Barriers(pub(crate) Vec<Barrier>);

impl serde::Serialize for Barriers {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.0.is_empty() {
            s.serialize_unit()
        } else {
            self.0.serialize(s)
        }
    }
}

impl<'de> serde::Deserialize<'de> for Barriers {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Option::<Vec<Barrier>>::deserialize(d)? {
            None => Ok(Self::default()),
            // The one written form of an empty row is the unit: refuse a second spelling of the same state.
            Some(v) if v.is_empty() => Err(serde::de::Error::custom(
                "an empty barrier row is written as null",
            )),
            Some(v) => Ok(Self(v)),
        }
    }
}

/// The collision maps with the standing barriers' tiles LOW (legacy `collisionMap`'s `withBarriers` overlay), keyed by
/// the wall fields they were built from. Derived: never serialized, rebuilt by [`sync`]; equality ignores it (it is a
/// function of serialized state and the statics).
///
/// It holds the walls over both gate states, as the statics hold the open and the closed-gate map, and [`body_map`]
/// picks one by the gate state at the query. So the overlay depends on the barrier rows alone: a site that opens or
/// closes the gates needs no sync (legacy re-keys its map on a gate change, `world.ts:1079-1091`), and none can forget.
#[derive(Clone, Debug, Default)]
pub struct Overlay(pub(crate) Option<Arc<OverlayMap>>);

impl PartialEq for Overlay {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

#[derive(Debug)]
pub struct OverlayMap {
    pub(crate) fields: Vec<u32>,
    /// The open map with the walls.
    pub(crate) open: TileMap,
    /// The closed-gate map with the walls; `None` when the arena has no gates (the statics' `locked_map` is `None`).
    pub(crate) locked: Option<TileMap>,
}

/// Rebuilds the overlay when the standing walls changed since it was built; drops it when no wall stands.
/// Allocation-free when nothing changed. The gate state is not an input (see [`Overlay`]).
pub(crate) fn sync(k: &MatchStatic, w: &mut World) {
    let Some(a) = w.abilities.as_mut() else {
        return;
    };
    if a.barriers.0.is_empty() {
        a.overlay.0 = None;
        return;
    }
    let current = a.overlay.0.as_ref().is_some_and(|o| {
        o.fields.len() == a.barriers.0.len()
            && o.fields
                .iter()
                .zip(&a.barriers.0)
                .all(|(f, b)| *f == b.field)
    });
    if current {
        return;
    }
    let cells = || a.barriers.0.iter().flat_map(|b| b.cells.iter().copied());
    a.overlay.0 = Some(Arc::new(OverlayMap {
        fields: a.barriers.0.iter().map(|b| b.field).collect(),
        open: k.arena.map.with_low(cells()),
        locked: k.locked_map.as_ref().map(|m| m.with_low(cells())),
    }));
}

/// The overlay to read this step, held by an `Arc` clone so the caller may mutate the world while it reads the map.
pub(crate) fn held(w: &World) -> Option<Arc<OverlayMap>> {
    w.abilities.as_ref().and_then(|a| a.overlay.0.clone())
}

/// The map bodies, swings and paths read, gates as they are now: the overlay while a wall stands, else the arena's.
/// Picks the gate state the way `MatchStatic::collision_view` does.
pub(crate) fn body_map<'a>(
    k: &'a MatchStatic,
    held: &'a Option<Arc<OverlayMap>>,
    locked: bool,
) -> &'a TileMap {
    match held {
        Some(o) if locked => o.locked.as_ref().unwrap_or(&o.open),
        Some(o) => &o.open,
        None => k.collision_map(locked),
    }
}

/// `check_world`'s barrier rules.
pub(crate) fn check(k: &MatchStatic, w: &World) -> Result<(), String> {
    let Some(a) = &w.abilities else {
        return Ok(());
    };
    let mut walls = a
        .fields
        .iter()
        .filter(|f| f.kind == crate::status_runtime::FieldKind::Wall);
    if k.config.frost_wish != crate::FrostWish::Wall
        && (walls.clone().next().is_some() || !a.barriers.0.is_empty())
    {
        return Err("a barrier stands only under frost_wish = Wall".into());
    }
    let map = &k.arena.map;
    let tiles = u64::from(map.w) * u64::from(map.h);
    for b in &a.barriers.0 {
        // One row per wall field, in field order.
        if walls.next().map(|f| f.id) != Some(b.field) {
            return Err("a barrier row does not match the wall fields".into());
        }
        if b.cells.is_empty()
            || !b.cells.windows(2).all(|p| p[0] < p[1])
            || b.cells
                .iter()
                .any(|&i| u64::from(i) >= tiles || map.tiles[i as usize] != TILE_FLOOR)
        {
            return Err("a barrier's tiles are not ascending floor tiles".into());
        }
    }
    if walls.next().is_some() {
        return Err("a wall field has no barrier row".into());
    }
    Ok(())
}

/// Removes a fallen wall's barrier row.
pub(crate) fn forget(a: &mut crate::status_runtime::AbilityRuntime, field: u32) {
    a.barriers.0.retain(|b| b.field != field);
}

#[cfg(test)]
#[path = "barriers_gate_tests.rs"]
mod gate_tests;
#[cfg(test)]
#[path = "barriers_push_tests.rs"]
mod push_tests;
#[cfg(test)]
#[path = "barriers_readers_tests.rs"]
mod readers_tests;
#[cfg(test)]
#[path = "barriers_tests.rs"]
mod tests;
