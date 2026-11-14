//! Signature mode (P-LAND-PLAGUE-1-fix-2): the end-of-attempt check of the Plague styler's bog pools on the finished
//! map. The styler keeps each Plague spawn's walk when it lays its pools (`style_warren/walk.rs`), but zones styled
//! after Plague, the safety nets and the post repair change tiles afterwards: a wall laid later can block the dry way
//! round a pool, and a wall opened later can make a shortcut through one. This check measures the same walk on the
//! finished map; the pipeline discards a signature attempt that fails it (`Refusal::SignaturePools`, ADR 0028 G1, G5).
//!
//! A walk is counted in 4-connected steps over floor (tile 0), from a spawn to the coliseum: the centre tile and every
//! gate tile of `m.coliseum` that is floor. Styler bog is a floor tile with terrain bog
//! (`signature::DEFAULT_DEFINITION.bog`) owned by a `BogPool` feature. Pure: no draw, no hashing, nothing written.
use crate::constants::TILE;
use crate::mapdata::{FeatureKind, GameMapData, Zone};
use crate::mapgen::landmarks::signature::DEFAULT_DEFINITION;

/// Per Plague spawn of `m.spawn_pool`, in pool order, whose walk reaches the coliseum with every floor tile allowed:
/// the steps of its walk with styler bog forbidden, less the steps with it allowed; `i32::MAX` when styler bog cuts the
/// spawn off. A spawn whose walk does not reach the coliseum at all is left out. Reads only `w`, `h`, `tiles`,
/// `terrain`, `feature_grid`, `features`, `spawn_pool` and `coliseum` (centre and gate tiles), so a hand-built map of
/// any size works.
pub fn walk_growth(m: &GameMapData) -> Vec<i32> {
    // One field from the coliseum with styler bog allowed and one without serve every spawn.
    let open = walk_field(m, |i| m.tiles[i] == 0);
    let dry = walk_field(m, |i| m.tiles[i] == 0 && !is_styler_bog(m, i));
    m.spawn_pool
        .iter()
        .filter(|s| s.zone == Zone::Plague)
        .filter_map(|s| at(m, world_tile(s.x), world_tile(s.y)))
        .filter(|&i| open[i] != i32::MAX)
        .map(|i| {
            if dry[i] == i32::MAX {
                i32::MAX
            } else {
                dry[i] - open[i]
            }
        })
        .collect()
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

/// The end-of-attempt verdict: no Plague spawn's walk grows by more than `detour` steps when styler bog is avoided, and
/// no `BogPool` is dry.
pub fn keeps(m: &GameMapData, detour: i32) -> bool {
    walk_growth(m).iter().all(|&g| g <= detour) && dry_pools(m).is_empty()
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

/// Bog a `BogPool` owns: the Plague styler's pools (the tree's bog and unowned bog are not).
fn is_styler_bog(m: &GameMapData, i: usize) -> bool {
    is_bog(m, i) && owner(m, i).is_some_and(|k| m.features[k].kind == FeatureKind::BogPool)
}

/// The tile column or row of a world coordinate.
fn world_tile(v: f64) -> i32 {
    (v / TILE).floor() as i32
}

/// The index of tile `(x, y)`, if it lies on the map.
fn at(m: &GameMapData, x: i32, y: i32) -> Option<usize> {
    let (w, h) = (m.w as i32, m.h as i32);
    (x >= 0 && y >= 0 && x < w && y < h).then(|| (y * w + x) as usize)
}

/// Breadth-first steps from the coliseum (its centre tile and every gate tile, each only if `ground`) over `ground`
/// tiles, 4-connected, on the whole map; `i32::MAX` where no walk reaches.
fn walk_field(m: &GameMapData, ground: impl Fn(usize) -> bool) -> Vec<i32> {
    let mut dist = vec![i32::MAX; m.tiles.len()];
    let mut queue = Vec::new();
    let centre = (
        world_tile(m.coliseum.centre.x),
        world_tile(m.coliseum.centre.y),
    );
    let gates = m
        .coliseum
        .gates
        .iter()
        .flat_map(|g| g.tiles.iter().map(|t| (t.x, t.y)));
    for (x, y) in std::iter::once(centre).chain(gates) {
        if let Some(i) = at(m, x, y).filter(|&i| ground(i) && dist[i] == i32::MAX) {
            dist[i] = 0;
            queue.push(i);
        }
    }
    let w = m.w as usize;
    let mut head = 0;
    while let Some(&i) = queue.get(head) {
        head += 1;
        let (x, y) = ((i % w) as i32, (i / w) as i32);
        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
            if let Some(j) = at(m, x + dx, y + dy).filter(|&j| ground(j) && dist[j] == i32::MAX) {
                dist[j] = dist[i] + 1;
                queue.push(j);
            }
        }
    }
    dist
}
