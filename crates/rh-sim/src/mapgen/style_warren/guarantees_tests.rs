//! The Plague guarantees (`guarantees.rs`: `"pool-walks"`, `"pool-wet"`) on hand-built maps (oracle of
//! P-LAND-PLAGUE-1-fix-2, review notes 2 and 3; moved from the pipeline's pool check by P-MAPGEN-GUARANTEES-1, assertions
//! unchanged: the old verdict `keeps(m, detour())` is `holds(m)`, both registered guarantees passing). Their place in the
//! pipeline is tested in `pipeline/mod.rs` (`guarantee_tests`).
//!
//! Hand-built maps are drawn row by row. Legend: `#` wall, `.` floor, `C` the coliseum centre (floor), `K` the coliseum
//! centre on a wall, `G` a gate tile (floor), `S` a Plague spawn, `F` a Fire spawn, `p` bog owned by `BogPool` feature
//! 0, `e` plain floor owned by feature 0, `t` bog owned by the `BogTree` (feature 1), `q` bog owned by `BogPool` feature
//! 2, `d` plain floor owned by feature 2, `b` bog owned by no feature, `f` floor in the Fire region, `x` wall in the
//! Fire region. Every other tile is in the Plague region. Feature 0 or 2 is a `BogPool` only if the drawing uses its
//! marks (else a `Barrow` owning nothing).
use super::guarantees::walks_within;
use super::{dry_pools, guarantees, is_styler_bog, POOLS};
use crate::constants::TILE;
use crate::mapdata::{
    ColiseumDef, FeatureJob, FeatureKind, GameMapData, GateDef, GateSide, MapFeature, TilePt,
    TileRect, WorldPt, Zone, ZoneAnchor, ZoneSpawn,
};
use crate::mapgen::landmarks::signature::frame::LandmarkFrame;
use crate::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use crate::mapgen::style_zones::walk_growth;

/// The pools' detour (`POOLS.walk_detour`).
fn detour() -> i32 {
    2
}

/// Both Plague guarantees pass on `m` (the end-of-attempt verdict with `POOLS.walk_detour`). The rules read the map
/// only; the frame is a bare Plague one.
fn holds(m: &GameMapData) -> bool {
    assert_eq!(POOLS.walk_detour, detour(), "the registered detour");
    let rect = TileRect {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
    };
    let frame = LandmarkFrame {
        anchor: ZoneAnchor {
            zone: Zone::Plague,
            kind: FeatureKind::BogTree,
            centre: TilePt { x: 0, y: 0 },
            footprint: rect,
            front: 0,
            entrance: Vec::new(),
        },
        landing: None,
        marks: Vec::new(),
        features: Vec::new(),
        cells: Vec::new(),
    };
    let rules: Vec<&str> = guarantees().iter().map(|g| g.rule).collect();
    assert_eq!(rules, ["pool-walks", "pool-wet"]);
    guarantees().iter().all(|g| (g.check)(m, &frame))
}

fn bog() -> u8 {
    DEFAULT_DEFINITION.bog
}

fn centre_of(x: usize, y: usize) -> WorldPt {
    WorldPt {
        x: x as f64 * TILE + TILE / 2.0,
        y: y as f64 * TILE + TILE / 2.0,
    }
}

fn feature(kind: FeatureKind) -> MapFeature {
    MapFeature {
        kind,
        variant: String::new(),
        zone: Zone::Plague,
        jobs: vec![FeatureJob::Crossing],
        ax: 0,
        ay: 0,
        p: Vec::new(),
        bbox: TileRect {
            x: 0,
            y: 0,
            w: 1,
            h: 1,
        },
        tiles: 0,
    }
}

/// A pool slot the drawing does not use is a `Barrow` owning nothing, so that no map holds a dry pool by accident.
fn pool_if(rows: &[&str], marks: &[char]) -> FeatureKind {
    if rows.iter().any(|r| r.chars().any(|c| marks.contains(&c))) {
        FeatureKind::BogPool
    } else {
        FeatureKind::Barrow
    }
}

/// A finished map drawn by `rows` (legend in the module doc).
fn map(rows: &[&str]) -> GameMapData {
    let (w, h) = (rows[0].len(), rows.len());
    let n = w * h;
    let mut m = GameMapData {
        tiles: vec![0; n],
        seed: 0,
        w: w as u32,
        h: h as u32,
        terrain: vec![0; n],
        props: Vec::new(),
        region_grid: vec![Zone::Plague.code(); n],
        attempt: 0,
        territory_grid: vec![0; n],
        coliseum: ColiseumDef {
            rect: TileRect {
                x: 0,
                y: 0,
                w: 1,
                h: 1,
            },
            centre: WorldPt {
                x: -100.0,
                y: -100.0,
            },
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
        features: vec![
            feature(pool_if(rows, &['p', 'e'])),
            feature(FeatureKind::BogTree),
            feature(pool_if(rows, &['q', 'd'])),
        ],
        feature_grid: vec![0; n],
        anchors: Vec::new(),
    };
    for (y, line) in rows.iter().enumerate() {
        assert_eq!(line.len(), w, "row {y} width");
        for (x, ch) in line.chars().enumerate() {
            let i = y * w + x;
            let (tile, terrain, owner) = match ch {
                '#' | 'K' | 'x' => (1, 0, 0),
                'p' => (0, bog(), 1),
                'e' => (0, 0, 1),
                't' => (0, bog(), 2),
                'q' => (0, bog(), 3),
                'd' => (0, 0, 3),
                'b' => (0, bog(), 0),
                _ => (0, 0, 0),
            };
            m.tiles[i] = tile;
            m.terrain[i] = terrain;
            m.feature_grid[i] = owner;
            if matches!(ch, 'f' | 'x') {
                m.region_grid[i] = Zone::Fire.code();
            }
            match ch {
                'C' | 'K' => m.coliseum.centre = centre_of(x, y),
                'G' => m.coliseum.gates.push(GateDef {
                    side: GateSide::North,
                    tiles: vec![TilePt {
                        x: x as i32,
                        y: y as i32,
                    }],
                    x: centre_of(x, y).x,
                    y: centre_of(x, y).y,
                }),
                'S' | 'F' => {
                    let p = centre_of(x, y);
                    m.spawn_pool.push(ZoneSpawn {
                        x: p.x,
                        y: p.y,
                        zone: if ch == 'S' { Zone::Plague } else { Zone::Fire },
                    });
                }
                _ => {}
            }
        }
    }
    m
}

#[test]
fn a_pool_across_every_short_way_grows_the_walk_past_the_detour() {
    let m = map(&[
        "#########################",
        "#.......................#",
        "#..........ppp..........#",
        "#C.........ppp.........S#",
        "#..........ppp..........#",
        "#.......................#",
        "#########################",
    ]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![4],
        "the dry way takes an edge row: 22 + 4 steps"
    );
    assert!(!holds(&m), "4 > 2: the attempt is refused");
    assert!(
        walks_within(&m, 4) && dry_pools(&m).is_empty(),
        "within a detour of 4"
    );
}

#[test]
fn a_pool_the_dry_way_passes_within_the_detour_is_kept() {
    let m = map(&[
        "#########################",
        "#.......................#",
        "#C.........ppp.........S#",
        "#.......................#",
        "#########################",
    ]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![2],
        "round the pool: 2 steps longer"
    );
    assert!(holds(&m));
}

#[test]
fn a_pool_that_cuts_a_spawn_off_grows_its_walk_without_bound() {
    let m = map(&[
        "#########################",
        "#..........ppp..........#",
        "#C.........ppp.........S#",
        "#..........ppp..........#",
        "#########################",
    ]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![i32::MAX]
    );
    assert!(!holds(&m));
}

#[test]
fn only_bog_a_bog_pool_owns_counts_and_only_plague_spawns_a_walk_reaches() {
    // The tree's bog and unowned bog lie across the only way: neither is styler bog.
    let m = map(&[
        "###################",
        "#C...ttt...bbb...S#",
        "###################",
    ]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![0],
        "tree and unowned bog do not count"
    );
    // A Fire spawn is not measured; a Plague spawn no walk reaches (bog allowed) is left out. Pool order is kept.
    let m = map(&[
        "###########",
        "#C...p...S#",
        "#.........#",
        "#F#########",
        "###########",
        "#S#########",
        "###########",
    ]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![2],
        "one entry: the reachable Plague spawn"
    );
}

#[test]
fn the_gate_tiles_start_the_walk_too() {
    // The centre tile is a wall here: the walk starts at the gate tile.
    let m = map(&["###########", "#K#G..p..S#", "###.......#", "###########"]);
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![2],
        "from the gate: 6 steps, 8 round the pool"
    );
}

#[test]
fn a_wall_in_a_neighbour_zone_counts_the_walk_is_measured_on_the_whole_map() {
    // The dry way round the pool runs through the Fire zone: within the detour.
    let open = map(&[
        "#########################",
        "#fffffffffffffffffffffff#",
        "#C.........ppp.........S#",
        "#..........ppp..........#",
        "#.......................#",
        "#########################",
    ]);
    assert_eq!(
        walk_growth(&open, Zone::Plague, |i| is_styler_bog(&open, i)),
        vec![2],
        "round the pool through Fire"
    );
    assert!(holds(&open));
    // A zone styled after Plague walls that row: the dry way now takes the far side, 4 steps longer.
    let walled = map(&[
        "#########################",
        "#xxxxxxxxxxxxxxxxxxxxxxx#",
        "#C.........ppp.........S#",
        "#..........ppp..........#",
        "#.......................#",
        "#########################",
    ]);
    assert_eq!(
        walk_growth(&walled, Zone::Plague, |i| is_styler_bog(&walled, i)),
        vec![4],
        "a wall in Fire lengthens the dry walk"
    );
    assert!(!holds(&walled));
}

#[test]
fn a_bog_pool_that_owns_no_bog_is_dry_and_refused() {
    // Feature 0 owns bog and some plain floor: wet. Feature 2 owns only plain floor: dry.
    let m = map(&["###########", "#C..ddd..S#", "#..pe.....#", "###########"]);
    assert_eq!(dry_pools(&m), vec![2], "feature 2 owns no bog");
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![0],
        "its plain floor is no detour"
    );
    assert!(!holds(&m), "a dry pool refuses the attempt");
    // One tile of bog is enough.
    let m = map(&["###########", "#C..dqd..S#", "#..pe.....#", "###########"]);
    assert_eq!(dry_pools(&m), Vec::<usize>::new());
    assert_eq!(
        walk_growth(&m, Zone::Plague, |i| is_styler_bog(&m, i)),
        vec![2]
    );
    assert!(holds(&m));
}
