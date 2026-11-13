//! P-WIRE17-MAP-2: the sim's territory leash as a public predicate, and the camp patience plane derived from it.
//!
//! Legacy: `packages/shared/src/mobs.ts:230-262` (`territoryAt`, `territoryLeash`, `leashOk`) and
//! `packages/client/src/render/CampPatience.ts:18-33` (`campPatienceOutline`: a tile of camp `i`'s territory whose
//! centre is inside the leash of at least one of the camp's rest spots; a camp without territory or spots has none).
//!
//! [`leash_ok`] is the one leash rule: `systems::mob_ai::leash` calls it inside the tick (map with layers), so its float
//! operations and their order are behaviour (parity and the state hash depend on them). [`patience_plane`] is computed
//! once per map, off the tick, by the server's map-blob path.

use super::LayerData;
use crate::constants::{MOB_LEASH_CAP, MOB_LEASH_RADIUS, TILE};
use crate::math::hypot;
use crate::Vec2;

fn distance(a: Vec2, b: Vec2) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}

/// Legacy `territoryAt`: the territory grid value (`camp + 1`, or 0) under world point `p`; 0 off the map.
fn territory(data: &LayerData, p: Vec2) -> u32 {
    let x = (p.x / TILE).floor() as i64;
    let y = (p.y / TILE).floor() as i64;
    if x < 0 || y < 0 || x >= i64::from(data.w) || y >= i64::from(data.h) {
        return 0;
    }
    data.territory_grid
        .get((y * i64::from(data.w) + x) as usize)
        .map_or(0, |v| u32::from(*v))
}

/// Is `p` inside the leash of a mob of camp `camp` (0-based index into `data.camps`; the territory grid holds
/// `camp + 1`) resting at `home`? Legacy `leashOk(map, camp + 1, home, p, margin)`: `territoryLeash` is
/// `min(radius, MOB_LEASH_CAP)` when the camp exists, has territory and holds `home`, else 0 (the `MOB_LEASH_RADIUS`
/// circle); otherwise `p` must be within `reach - margin` of `home`, on the camp's territory, and (margin > 0) so must
/// the four points `margin` away along the axes.
pub fn leash_ok(data: &LayerData, camp: u32, home: Vec2, p: Vec2, margin: f64) -> bool {
    let def = data.camps.get(camp as usize);
    let reach = def
        .filter(|d| d.area > 0 && territory(data, home) == camp + 1)
        .map_or(0., |d| d.radius.min(MOB_LEASH_CAP));
    if reach == 0. {
        return distance(p, home) <= MOB_LEASH_RADIUS - margin;
    }
    if distance(p, home) > reach - margin || territory(data, p) != camp + 1 {
        return false;
    }
    margin <= 0.
        || [
            Vec2::new(p.x + margin, p.y),
            Vec2::new(p.x - margin, p.y),
            Vec2::new(p.x, p.y + margin),
            Vec2::new(p.x, p.y - margin),
        ]
        .into_iter()
        .all(|p| territory(data, p) == camp + 1)
}

/// The row-major patience plane of `data` (`data.w * data.h` cells): 0, or `i + 1` where tile `(tx, ty)` is a cell of
/// camp `i`'s territory and its centre `((tx + 0.5) * TILE, (ty + 0.5) * TILE)` is inside [`leash_ok`] (margin 0) for at
/// least one of camp `i`'s `spots`. A camp with `area == 0` or no spots covers nothing. Camps never share a territory
/// cell, so one byte per tile is exact (validated layers keep every grid value `<= camps.len()`).
pub fn patience_plane(data: &LayerData) -> Vec<u8> {
    let w = data.w as usize;
    let total = w * data.h as usize;
    let mut out = vec![0u8; total];
    if w == 0 {
        return out;
    }
    for (i, cell) in out.iter_mut().enumerate() {
        let Some(&r) = data.territory_grid.get(i) else {
            break;
        };
        if r == 0 {
            continue;
        }
        let camp = u32::from(r) - 1;
        let Some(def) = data.camps.get(camp as usize) else {
            continue;
        };
        if def.area == 0 || def.spots.is_empty() {
            continue;
        }
        let at = Vec2::new(((i % w) as f64 + 0.5) * TILE, ((i / w) as f64 + 0.5) * TILE);
        if def
            .spots
            .iter()
            .any(|s| leash_ok(data, camp, Vec2::new(s.x, s.y), at, 0.))
        {
            *cell = r;
        }
    }
    out
}
