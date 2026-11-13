//! P-WIRE17-MAP-2: the sim's territory leash as a public predicate, and the camp patience plane derived from it.
//!
//! Legacy: `packages/shared/src/mobs.ts:243-262` (`territoryLeash`, `leashOk`) and
//! `packages/client/src/render/CampPatience.ts:18-33` (`campPatienceOutline`: a tile of camp `i`'s territory whose
//! centre is inside the leash of at least one of the camp's rest spots; a camp without territory or spots has none).
//!
//! STUB (to be replaced by the implementer): `leash_ok` must become the one leash rule, with
//! `systems::mob_ai::leash` delegating to it (call it, do not copy it), and `patience_plane` must be computed from it.

use super::LayerData;
use crate::Vec2;

/// Is `p` inside the leash of a mob of camp `camp` (0-based index into `data.camps`; the territory grid holds
/// `camp + 1`) resting at `home`? Legacy `leashOk(map, camp + 1, home, p, margin)`.
pub fn leash_ok(data: &LayerData, camp: u32, home: Vec2, p: Vec2, margin: f64) -> bool {
    let _ = (data, camp, home, p, margin);
    false
}

/// The row-major patience plane of `data` (`data.w * data.h` cells): 0, or `i + 1` where tile `(tx, ty)` is a cell of
/// camp `i`'s territory and its centre `((tx + 0.5) * TILE, (ty + 0.5) * TILE)` is inside [`leash_ok`] (margin 0) for at
/// least one of camp `i`'s `spots`. A camp with `area == 0` or no spots covers nothing.
pub fn patience_plane(data: &LayerData) -> Vec<u8> {
    vec![0; data.w as usize * data.h as usize]
}
