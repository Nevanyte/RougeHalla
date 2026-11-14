//! Signature mode (P-LAND-PLAGUE-1-fix-2): the end-of-attempt check of the Plague styler's bog pools on the finished
//! map. The styler keeps each Plague spawn's walk when it lays its pools (`style_warren/walk.rs`), but zones styled
//! after Plague, the safety nets and the post repair change tiles afterwards: a wall laid later can block the dry way
//! round a pool, and a wall opened later can make a shortcut through one. This check measures the same walk on the
//! finished map; the pipeline discards a signature attempt that fails it (`Refusal::SignaturePools`, ADR 0028 G1, G5).
//!
//! A walk is counted in 4-connected steps over floor (tile 0), from a spawn to the coliseum: the centre tile and every
//! gate tile of `m.coliseum` that is floor. Styler bog is a floor tile with terrain bog
//! (`signature::DEFAULT_DEFINITION.bog`) owned by a `BogPool` feature. Pure: no draw, no hashing, nothing written.
use crate::mapdata::GameMapData;

/// Per Plague spawn of `m.spawn_pool`, in pool order, whose walk reaches the coliseum with every floor tile allowed:
/// the steps of its walk with styler bog forbidden, less the steps with it allowed; `i32::MAX` when styler bog cuts the
/// spawn off. A spawn whose walk does not reach the coliseum at all is left out. Reads only `w`, `h`, `tiles`,
/// `terrain`, `feature_grid`, `features`, `spawn_pool` and `coliseum` (centre and gate tiles), so a hand-built map of
/// any size works.
pub fn walk_growth(m: &GameMapData) -> Vec<i32> {
    // Stub (P-LAND-PLAGUE-1-fix-2): measures nothing yet.
    let _ = m;
    Vec::new()
}

/// Indices into `m.features`, ascending, of every `BogPool` feature that owns no floor tile with terrain bog (a pool
/// whose bog was given back by `walk::give_way`, or cleared later, still owning its plain floor).
pub fn dry_pools(m: &GameMapData) -> Vec<usize> {
    // Stub (P-LAND-PLAGUE-1-fix-2): finds nothing yet.
    let _ = m;
    Vec::new()
}

/// The end-of-attempt verdict: no Plague spawn's walk grows by more than `detour` steps when styler bog is avoided, and
/// no `BogPool` is dry.
pub fn keeps(m: &GameMapData, detour: i32) -> bool {
    walk_growth(m).iter().all(|&g| g <= detour) && dry_pools(m).is_empty()
}
