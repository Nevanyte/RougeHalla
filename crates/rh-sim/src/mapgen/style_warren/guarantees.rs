//! P-MAPGEN-GUARANTEES-1: the Plague styler's end-of-attempt guarantees (`style_zones::guarantees(Zone::Plague)`), run
//! by the pipeline on the finished map of a signature attempt with the Plague frame (`pipeline::Refusal::Guarantee`).
//! Moved here from the pipeline's own pool check (P-LAND-PLAGUE-1-fix-2), numbers unchanged.
//!
//! The styler keeps each Plague spawn's walk when it lays its pools (`walk.rs`), but zones styled after Plague, the
//! safety nets and the post repair change tiles afterwards: a wall laid later can block the dry way round a pool, and a
//! wall opened later can make a shortcut through one. So the finished map is judged again (ADR 0028 G1, G5: a map that
//! breaks a rule is discarded, never repaired), as two rules in this order:
//! - `"pool-walks"`: no Plague spawn's walk to the coliseum grows by more than `POOLS.walk_detour` steps with styler bog
//!   avoided (`style_zones::walk_growth(m, Zone::Plague, styler bog)`);
//! - `"pool-wet"`: no `BogPool` is dry (`dry_pools` is empty).
//!
//! Styler bog is a floor tile with terrain bog (`signature::DEFAULT_DEFINITION.bog`) owned by a `BogPool` feature. Both
//! rules read the map only (the frame is not needed). Pure: no draw, no hashing, nothing written.
use super::POOLS;
use crate::mapdata::{FeatureKind, GameMapData, Zone};
use crate::mapgen::landmarks::signature::frame::LandmarkFrame;
use crate::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use crate::mapgen::style_zones::{walk_growth, Guarantee};

/// The Plague styler's guarantees, in the order they run.
pub fn guarantees() -> &'static [Guarantee] {
    const LIST: &[Guarantee] = &[
        Guarantee {
            rule: "pool-walks",
            check: pool_walks,
        },
        Guarantee {
            rule: "pool-wet",
            check: pool_wet,
        },
    ];
    LIST
}

/// `"pool-walks"`: every Plague spawn's walk with styler bog avoided is at most `POOLS.walk_detour` steps longer.
fn pool_walks(m: &GameMapData, _: &LandmarkFrame) -> bool {
    walks_within(m, POOLS.walk_detour)
}

/// `"pool-wet"`: every `BogPool` owns some bog.
fn pool_wet(m: &GameMapData, _: &LandmarkFrame) -> bool {
    dry_pools(m).is_empty()
}

/// No Plague spawn's walk grows by more than `detour` steps when styler bog is avoided.
pub(super) fn walks_within(m: &GameMapData, detour: i32) -> bool {
    walk_growth(m, Zone::Plague, |i| is_styler_bog(m, i))
        .iter()
        .all(|&g| g <= detour)
}

/// Styler bog: a floor tile with terrain bog owned by a `BogPool` feature (the tree's bog and unowned bog are not).
pub fn is_styler_bog(m: &GameMapData, i: usize) -> bool {
    is_bog(m, i) && owner(m, i).is_some_and(|k| m.features[k].kind == FeatureKind::BogPool)
}

/// Indices into `m.features`, ascending, of every `BogPool` feature that owns no floor tile with terrain bog (a pool
/// whose bog was given back by `walk::give_way`, or cleared later, still owning its plain floor).
pub fn dry_pools(m: &GameMapData) -> Vec<usize> {
    let mut wet = vec![false; m.features.len()];
    for i in 0..m.tiles.len() {
        if let Some(k) = owner(m, i) {
            wet[k] |= is_bog(m, i);
        }
    }
    m.features
        .iter()
        .enumerate()
        .filter(|&(k, f)| f.kind == FeatureKind::BogPool && !wet[k])
        .map(|(k, _)| k)
        .collect()
}

/// Floor with terrain bog.
fn is_bog(m: &GameMapData, i: usize) -> bool {
    m.tiles[i] == 0 && m.terrain[i] == DEFAULT_DEFINITION.bog
}

/// The index into `m.features` of the feature owning tile `i` (`feature_grid` holds index + 1; 0 is none).
fn owner(m: &GameMapData, i: usize) -> Option<usize> {
    usize::from(m.feature_grid[i])
        .checked_sub(1)
        .filter(|&k| k < m.features.len())
}
