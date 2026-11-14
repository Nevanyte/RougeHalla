//! P-MAPGEN-GUARANTEES-1: the Plague styler's end-of-attempt guarantees (`style_zones::guarantees(Zone::Plague)`).
//!
//! STUB: the list is empty, and `is_styler_bog` and `dry_pools` delegate to `pipeline/plague_pools.rs`. The implementer
//! moves the pool check here as two guarantees, `"pool-walks"` (no Plague spawn's walk grows by more than
//! `POOLS.walk_detour` steps with styler bog avoided: `style_zones::walk_growth(m, Zone::Plague, is_styler_bog)`) then
//! `"pool-wet"` (no `BogPool` is dry: `dry_pools` is empty), and deletes `plague_pools.rs`.
use crate::mapdata::GameMapData;
use crate::mapgen::style_zones::Guarantee;

/// The Plague styler's guarantees, in the order they run.
pub fn guarantees() -> &'static [Guarantee] {
    &[]
}

/// Styler bog: a floor tile with terrain bog owned by a `BogPool` feature (the tree's bog and unowned bog are not).
pub fn is_styler_bog(m: &GameMapData, i: usize) -> bool {
    crate::mapgen::pipeline::plague_pools::is_styler_bog(m, i)
}

/// Indices into `m.features`, ascending, of every `BogPool` feature that owns no floor tile with terrain bog.
pub fn dry_pools(m: &GameMapData) -> Vec<usize> {
    crate::mapgen::pipeline::plague_pools::dry_pools(m)
}
