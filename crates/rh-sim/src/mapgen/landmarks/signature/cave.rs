//! Frost: the cave (P-MAPGEN-SIG-FROST-1; no legacy counterpart, DEV-020).
//!
//! The cave IS the owner-approved blueprint (P-MAPGEN-SIG-SCALE-1; ADR 0028 G9, decision 11): `Definition::cave_grid`, a
//! 29 x 29 drawing placed in the zone's reserved site (P-MAPGEN-SIG-RESERVE-1), its `E` on the site's camp tile, its
//! mouth toward the coliseum (the dominant axis of DIR16 from the camp tile toward it), mirrored or not by one draw of
//! the Frost stream. `#` and `R` are the cave's walls, `=` its ice; `.`, `E` and the mouth `D` stay unwritten floor. A
//! site that cannot hold the drawing refuses the attempt; the drawing is never served smaller. The generic stamp
//! (`super::stamp`) draws it from its table entry (`super::spec`); the older rule-drawn chamber is gone
//! (P-MAPGEN-SIG-BLUEPRINT-2). This file keeps the end-of-attempt lake rule (`lake_at_mouth`).
use super::{at, catalog_codes, Definition};
use crate::map::TILE_FLOOR;
use crate::mapdata::{FeatureKind, GameMapData, Zone};
use crate::mapgen::coliseum::W;
use std::collections::VecDeque;
// The unit tests below build their maps from these (`use super::*`).
#[cfg(test)]
use crate::{
    map::TILE_WALL,
    mapdata::{FeatureJob, TilePt, ZoneAnchor},
    mapgen::coliseum::H,
};

/// The end-of-attempt lake rule on a finished map (P-MAPGEN-SIG-FROST-2; owner decision 4: the mouth faces the lake).
/// Unowned Frost ice is floor of the Frost region carrying the cave's ice terrain that the cave does not own (the
/// styler's meres and anything else); its largest 4-connected body (first in row order on a size tie) must lie within
/// `lake_reach + lake_slack` steps over floor (any zone, owned or not) of the cave's mouth (the Frost anchor's
/// `entrance`, step 0). A map without unowned Frost ice, or without a cave or Frost anchor, passes (the styler may place
/// no lake; the cave's own presence is the Landmarks phase's rule). The ice is the terrain catalog's code
/// (`catalog_codes`); `d` gives the reach. A pure read: no draw.
pub(super) fn lake_at_mouth(map: &GameMapData, d: &Definition) -> bool {
    let ice_code = catalog_codes().ice;
    let Some(cave) = map
        .features
        .iter()
        .position(|f| f.kind == FeatureKind::Cave)
    else {
        return true;
    };
    let Some(anchor) = map.anchors.iter().find(|a| a.zone == Zone::Frost) else {
        return true;
    };
    let n = map.tiles.len();
    let frost = Zone::Frost.code();
    let ice = |i: usize| {
        map.region_grid[i] == frost
            && map.tiles[i] == TILE_FLOOR
            && map.terrain[i] == ice_code
            && usize::from(map.feature_grid[i]) != cave + 1
    };
    let step = |i: usize| {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .filter_map(move |(dx, dy)| at(x + dx, y + dy))
    };
    // Bodies labelled in row order of their first tile; the largest wins, the first on a tie.
    let mut body = vec![0u32; n];
    let (mut largest, mut size, mut label) = (0u32, 0usize, 0u32);
    let mut stack = Vec::new();
    for s in 0..n {
        if body[s] != 0 || !ice(s) {
            continue;
        }
        label += 1;
        body[s] = label;
        stack.push(s);
        let mut count = 0;
        while let Some(i) = stack.pop() {
            count += 1;
            for j in step(i) {
                if body[j] == 0 && ice(j) {
                    body[j] = label;
                    stack.push(j);
                }
            }
        }
        if count > size {
            (largest, size) = (label, count);
        }
    }
    if size == 0 {
        return true;
    }
    let reach = d.lake_reach + d.lake_slack;
    let mut dist = vec![usize::MAX; n];
    let mut queue = VecDeque::new();
    for p in &anchor.entrance {
        if let Some(i) = at(p.x, p.y).filter(|&i| map.tiles[i] == TILE_FLOOR && dist[i] != 0) {
            dist[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        if body[i] == largest {
            return true;
        }
        if dist[i] >= reach {
            continue;
        }
        for j in step(i) {
            if dist[j] == usize::MAX && map.tiles[j] == TILE_FLOOR {
                dist[j] = dist[i] + 1;
                queue.push_back(j);
            }
        }
    }
    false
}

/// `lake_at_mouth` on small synthetic maps: the branches no generated seed reaches (P-MAPGEN-SIG-FROST-2 review).
/// Every map is the full grid, all Frost wall but for the floor each test opens; feature 1 is the cave, the Frost
/// anchor's mouth is one tile.
#[cfg(test)]
mod tests {
    use super::super::DEFAULT_DEFINITION;
    use super::*;
    use crate::mapdata::{ColiseumDef, MapFeature, TileRect, WorldPt};

    fn reach() -> i32 {
        (DEFAULT_DEFINITION.lake_reach + DEFAULT_DEFINITION.lake_slack) as i32
    }

    fn map(mouth: (i32, i32)) -> GameMapData {
        let n = W * H;
        let rect = TileRect {
            x: 0,
            y: 0,
            w: 1,
            h: 1,
        };
        let pt = TilePt {
            x: mouth.0,
            y: mouth.1,
        };
        GameMapData {
            tiles: vec![TILE_WALL; n],
            seed: 0,
            w: W as u32,
            h: H as u32,
            terrain: vec![0; n],
            props: Vec::new(),
            region_grid: vec![Zone::Frost.code(); n],
            attempt: 0,
            territory_grid: vec![0; n],
            coliseum: ColiseumDef {
                rect,
                centre: WorldPt { x: 0.0, y: 0.0 },
                gates: Vec::new(),
                inner_spawns: Vec::new(),
            },
            regions: Vec::new(),
            camps: Vec::new(),
            spawn_pool: Vec::new(),
            buildings: Vec::new(),
            spawns: Vec::new(),
            crate_spots: Vec::new(),
            ground_spots: Vec::new(),
            features: vec![MapFeature {
                kind: FeatureKind::Cave,
                variant: String::new(),
                zone: Zone::Frost,
                jobs: vec![FeatureJob::Landmark],
                ax: mouth.0,
                ay: mouth.1,
                p: Vec::new(),
                bbox: rect,
                tiles: 0,
            }],
            feature_grid: vec![0; n],
            anchors: vec![ZoneAnchor {
                zone: Zone::Frost,
                kind: FeatureKind::Cave,
                centre: pt,
                footprint: rect,
                front: 0,
                entrance: vec![pt],
            }],
        }
    }

    /// Floor along row `y` from `x0` to `x1` inclusive.
    fn corridor(m: &mut GameMapData, y: i32, x0: i32, x1: i32) {
        for x in x0..=x1 {
            m.tiles[at(x, y).unwrap()] = TILE_FLOOR;
        }
    }

    /// Ice floor at (x, y), owned by the cave (feature 1) when `cave`.
    fn ice(m: &mut GameMapData, x: i32, y: i32, cave: bool) {
        let i = at(x, y).unwrap();
        m.tiles[i] = TILE_FLOOR;
        m.terrain[i] = DEFAULT_DEFINITION.ice;
        m.feature_grid[i] = u8::from(cave);
    }

    fn ok(m: &GameMapData) -> bool {
        lake_at_mouth(m, &DEFAULT_DEFINITION)
    }

    #[test]
    fn no_unowned_ice_passes_and_the_caves_own_ice_is_never_the_lake() {
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        assert!(ok(&m), "no ice at all");
        for x in 11..=16 {
            ice(&mut m, x, 20, true);
        }
        assert!(ok(&m), "only the cave's own ice, beside the mouth");
        // A lone unowned tile with no floor path is now the lake, however large the cave's ice.
        ice(&mut m, 100, 100, false);
        assert!(!ok(&m), "the cave's ice stood in for a far lake");
    }

    #[test]
    fn on_equal_sizes_the_first_body_in_row_order_is_the_lake() {
        // Near body on the mouth's row, an unreachable body of the same size on a later row: the near one is first.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        ice(&mut m, 12, 20, false);
        ice(&mut m, 13, 20, false);
        ice(&mut m, 50, 30, false);
        ice(&mut m, 51, 30, false);
        assert!(ok(&m), "the near body comes first in row order");
        // The same, with the unreachable body on an earlier row: it is the lake, and the map fails.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        ice(&mut m, 12, 20, false);
        ice(&mut m, 13, 20, false);
        ice(&mut m, 50, 10, false);
        ice(&mut m, 51, 10, false);
        assert!(!ok(&m), "the far body comes first in row order");
    }

    #[test]
    fn the_lake_passes_at_exactly_the_reach_and_fails_one_step_beyond() {
        let r = reach();
        assert_eq!(r, 10, "lake_reach + lake_slack");
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 10 + r + 5);
        ice(&mut m, 10 + r, 20, false);
        assert!(ok(&m), "{r} floor steps");
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 10 + r + 5);
        ice(&mut m, 10 + r + 1, 20, false);
        assert!(!ok(&m), "{} floor steps", r + 1);
        // Walked steps, not straight-line distance: two rows below the mouth across a wall, 3 + 2 + 3 = 8 steps round.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 13);
        corridor(&mut m, 21, 13, 13);
        corridor(&mut m, 22, 10, 13);
        ice(&mut m, 10, 22, false);
        assert!(ok(&m), "8 walked steps round the wall");
        // The same detour stretched past the reach (5 + 2 + 5 = 12 steps) fails though the lake is 2 tiles away.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 15);
        corridor(&mut m, 21, 15, 15);
        corridor(&mut m, 22, 10, 15);
        ice(&mut m, 10, 22, false);
        assert!(!ok(&m), "12 walked steps round the wall");
    }

    #[test]
    fn a_mouth_with_no_floor_path_to_the_lake_fails() {
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 14);
        ice(&mut m, 16, 20, false);
        assert!(!ok(&m), "a wall between the mouth and the lake");
        // A mouth that is not floor starts no walk.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 11, 14);
        ice(&mut m, 12, 20, false);
        assert!(!ok(&m), "the mouth tile is wall");
    }
}
