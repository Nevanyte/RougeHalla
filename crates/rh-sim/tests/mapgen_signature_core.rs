//! Oracle of P-MAPGEN-SIGNATURE-CORE-1: the generator places each zone's signature landmark right after the zones and
//! builds everything later around it (owner rules G1-G8, 2026-11-12). No legacy counterpart (DEV-020): these are the
//! owner's rules as measurable checks on real maps, seeds 1-16, generated once per test binary.
//!
//! Definitions (all tile units; a tile's point is its centre, x + 0.5):
//! * map centre (w/2, h/2); coliseum centre: the tile of `map.coliseum.centre`.
//! * front of a tile: the DIR16 index (`landmarks::recipe_support::DIR16`, 0 = +x, 4 = +y) whose vector has the largest
//!   dot product (first on a tie) with (coliseum centre tile - tile).
//! * door side of a front: the dominant axis of DIR16[front] (x when |vx| >= |vy|), signed as the vector.
//! * outer third (Plague): lo, hi the smallest and largest distance of a Plague region cell from the map centre; the
//!   tree's centre is at least lo + (hi - lo) * 2/3 out.
//! * far elite camp (Sentenced): the Sentenced camp with `elite_spot >= 0` farthest from the map centre; its clearing is
//!   every tile within `r` of the camp point.
//! * apron: a signature feature's bbox grown by the core band width (`signature::DEFAULT_DEFINITION.bands[0]`).
//! * styler feature: any feature that is not `Landmark` (legacy landmark stage), a signature kind, `Infill` (repair) or
//!   `Bush` (elite bushes).
//! * walkable: tile value 0 (floor), 4-connected.
use rh_sim::mapdata::{
    FeatureKind, GameMapData, MapExport, MapFeature, TilePt, TileRect, Zone, ZoneAnchor,
};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::{band, Band, DEFAULT_DEFINITION};
use rh_sim::mapgen::{certify, coliseum, map_hash, pipeline};
use std::collections::BTreeSet;
use std::sync::OnceLock;

const TILE: f64 = 32.0;
const T_FLOOR: u8 = 0;
const T_WALL: u8 = 1;
const BOG: u8 = 5;
const SIGNATURE: [FeatureKind; 3] = [
    FeatureKind::BogTree,
    FeatureKind::Church,
    FeatureKind::Graveyard,
];

type Cell = (i32, i32);

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

/// Seeds 1-16 with the option on (the server's options: no decor), generated once per test binary.
fn on_maps() -> &'static Vec<(i64, Option<GameMapData>)> {
    static MAPS: OnceLock<Vec<(i64, Option<GameMapData>)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=16)
            .map(|seed| {
                let map = generator
                    .certified_styled(seed, on_options())
                    .expect("generator error");
                (seed, map)
            })
            .collect()
    })
}

/// Every seed must give a map: a zone's landmark is never a reason to discard a seed (G2, G5).
fn maps() -> impl Iterator<Item = (i64, &'static GameMapData)> {
    on_maps().iter().map(|(seed, m)| {
        (
            *seed,
            m.as_ref()
                .unwrap_or_else(|| panic!("seed {seed}: no certified map with the option on")),
        )
    })
}

fn cell(m: &GameMapData, i: usize) -> Cell {
    ((i as i32) % m.w as i32, (i as i32) / m.w as i32)
}

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn world_cell(x: f64, y: f64) -> Cell {
    ((x / TILE).floor() as i32, (y / TILE).floor() as i32)
}

/// Tiles owned by feature index `k` (feature grid id k + 1).
fn owned(m: &GameMapData, k: usize) -> Vec<Cell> {
    (0..m.feature_grid.len())
        .filter(|&i| usize::from(m.feature_grid[i]) == k + 1)
        .map(|i| cell(m, i))
        .collect()
}

fn of_kind(m: &GameMapData, kind: FeatureKind) -> Vec<usize> {
    (0..m.features.len())
        .filter(|&k| m.features[k].kind == kind)
        .collect()
}

/// The single feature of `kind`, which must stand in `zone`.
fn single(seed: i64, m: &GameMapData, kind: FeatureKind, zone: Zone) -> usize {
    let ks = of_kind(m, kind);
    assert_eq!(ks.len(), 1, "seed {seed}: {} {kind:?} features", ks.len());
    assert_eq!(m.features[ks[0]].zone, zone, "seed {seed}: {kind:?} zone");
    ks[0]
}

fn grow(r: TileRect, by: i32) -> (i32, i32, i32, i32) {
    (
        r.x - by,
        r.y - by,
        r.x + r.w as i32 - 1 + by,
        r.y + r.h as i32 - 1 + by,
    )
}

fn inside(r: (i32, i32, i32, i32), c: Cell) -> bool {
    c.0 >= r.0 && c.0 <= r.2 && c.1 >= r.1 && c.1 <= r.3
}

fn from_centre(m: &GameMapData, c: Cell) -> f64 {
    let (mx, my) = (f64::from(m.w) / 2., f64::from(m.h) / 2.);
    let (dx, dy) = (f64::from(c.0) + 0.5 - mx, f64::from(c.1) + 0.5 - my);
    (dx * dx + dy * dy).sqrt()
}

fn expected_front(m: &GameMapData, c: Cell) -> u8 {
    let col = world_cell(m.coliseum.centre.x, m.coliseum.centre.y);
    let (dx, dy) = (i64::from(col.0 - c.0), i64::from(col.1 - c.1));
    let mut best = 0;
    let mut best_dot = i64::MIN;
    for (k, v) in DIR16.iter().enumerate() {
        let dot = dx * i64::from(v[0]) + dy * i64::from(v[1]);
        if dot > best_dot {
            best_dot = dot;
            best = k;
        }
    }
    best as u8
}

fn door_side(front: u8) -> Cell {
    let v = DIR16[usize::from(front)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

fn flood(m: &GameMapData, tiles: &[u8], starts: &[Cell]) -> Vec<bool> {
    let mut seen = vec![false; tiles.len()];
    let mut stack = Vec::new();
    for &s in starts {
        if let Some(i) = at(m, s).filter(|&i| tiles[i] == T_FLOOR) {
            seen[i] = true;
            stack.push(s);
        }
    }
    while let Some((x, y)) = stack.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            if let Some(i) = at(m, (x + dx, y + dy)) {
                if !seen[i] && tiles[i] == T_FLOOR {
                    seen[i] = true;
                    stack.push((x + dx, y + dy));
                }
            }
        }
    }
    seen
}

fn first_spawn(m: &GameMapData) -> Cell {
    world_cell(m.spawns[0].x, m.spawns[0].y)
}

/// Connected groups of `cells` (8-neighbour when `eight`, else 4-neighbour).
fn components(cells: &[Cell], eight: bool) -> Vec<Vec<Cell>> {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for &start in &set {
        if !seen.insert(start) {
            continue;
        }
        let mut group = vec![start];
        let mut stack = vec![start];
        while let Some((x, y)) = stack.pop() {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if (dx, dy) == (0, 0) || (!eight && dx != 0 && dy != 0) {
                        continue;
                    }
                    let n = (x + dx, y + dy);
                    if set.contains(&n) && seen.insert(n) {
                        group.push(n);
                        stack.push(n);
                    }
                }
            }
        }
        out.push(group);
    }
    out
}

fn anchor(seed: i64, m: &GameMapData, zone: Zone) -> &ZoneAnchor {
    m.anchors
        .iter()
        .find(|a| a.zone == zone)
        .unwrap_or_else(|| {
            panic!(
                "seed {seed}: no {zone:?} anchor (anchors {:?})",
                m.anchors.iter().map(|a| a.zone).collect::<Vec<_>>()
            )
        })
}

fn far_elite(seed: i64, m: &GameMapData) -> (Cell, (f64, f64, f64)) {
    let c = m
        .camps
        .iter()
        .filter(|c| c.zone == Zone::Sentenced && c.elite_spot >= 0)
        .max_by(|a, b| {
            let da = from_centre(m, world_cell(a.x, a.y));
            let db = from_centre(m, world_cell(b.x, b.y));
            da.total_cmp(&db)
        })
        .unwrap_or_else(|| panic!("seed {seed}: no Sentenced elite camp"));
    (world_cell(c.x, c.y), (c.x / TILE, c.y / TILE, c.r / TILE))
}

/// (along, across) of a tile relative to the church's door line: `along` is the signed distance out of the church
/// through the door side, `across` the coordinate along the wall.
fn door_frame(a: &ZoneAnchor) -> (Cell, i32, (i32, i32)) {
    let side = door_side(a.front);
    let line = if side.0 != 0 {
        a.entrance[0].x
    } else {
        a.entrance[0].y
    };
    let across: Vec<i32> = a
        .entrance
        .iter()
        .map(|t| if side.0 != 0 { t.y } else { t.x })
        .collect();
    (
        side,
        line,
        (*across.iter().min().unwrap(), *across.iter().max().unwrap()),
    )
}

fn along_across(side: Cell, line: i32, c: Cell) -> (i32, i32) {
    if side.0 != 0 {
        ((c.0 - line) * side.0, c.1)
    } else {
        ((c.1 - line) * side.1, c.0)
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G8: with the option off the generator is today's.
// --------------------------------------------------------------------------------------------------------------------

/// Stored options without the field read as option off; option off is the option-less call, map for map and hash for
/// hash, seeds 1-8; and an option-off map has no anchors and no `anchors` key in its JSON (byte-identical export).
#[test]
fn g8_signature_off_is_todays_generator() {
    let read: pipeline::Options =
        serde_json::from_str(r#"{"decor":true,"shapeGates":true,"bushes":true}"#).unwrap();
    assert_eq!(read, pipeline::Options::default());
    assert!(!pipeline::Options::default().signature);
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for seed in 1..=8 {
        let plain = generator
            .certified_styled(seed, pipeline::Options::default())
            .unwrap()
            .expect("certified");
        let off = generator
            .certified_styled(
                seed,
                pipeline::Options {
                    signature: false,
                    ..pipeline::Options::default()
                },
            )
            .unwrap()
            .expect("certified");
        assert_eq!(
            map_hash::map_hash(&off),
            map_hash::map_hash(&plain),
            "seed {seed}"
        );
        assert_eq!(off, plain, "seed {seed}");
        assert!(off.anchors.is_empty(), "seed {seed}");
        let json = serde_json::to_value(&off).unwrap();
        assert!(json.get("anchors").is_none(), "seed {seed}: anchors key");
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G1, G2: one landmark per zone, placed before the stylers, which build around it.
// --------------------------------------------------------------------------------------------------------------------

/// Every map has exactly one bog tree (Plague), one church and one graveyard (Sentenced); within each zone the signature
/// features precede every later feature; no styler feature owns a tile of a signature feature's apron.
#[test]
fn g1_g2_one_bog_tree_and_one_church_placed_before_the_stylers() {
    let core = DEFAULT_DEFINITION.bands[0];
    for (seed, m) in maps() {
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        let later =
            |f: &MapFeature| f.kind != FeatureKind::Landmark && !SIGNATURE.contains(&f.kind);
        for (i, f) in m.features.iter().enumerate() {
            if !SIGNATURE.contains(&f.kind) {
                continue;
            }
            for (j, g) in m.features.iter().enumerate() {
                if g.zone == f.zone && later(g) {
                    assert!(
                        i < j,
                        "seed {seed}: {:?} at {i} after the {:?} at {j}",
                        f.kind,
                        g.kind
                    );
                }
            }
            let apron = grow(f.bbox, core);
            for y in apron.1..=apron.3 {
                for x in apron.0..=apron.2 {
                    let Some(t) = at(m, (x, y)) else { continue };
                    let id = usize::from(m.feature_grid[t]);
                    if id == 0 {
                        continue;
                    }
                    let g = &m.features[id - 1];
                    assert!(
                        !later(g) || matches!(g.kind, FeatureKind::Infill | FeatureKind::Bush),
                        "seed {seed}: the {:?} feature {} owns ({x},{y}) in the {:?}'s apron",
                        g.kind,
                        id - 1,
                        f.kind
                    );
                }
            }
        }
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Shapes.
// --------------------------------------------------------------------------------------------------------------------

/// Plague: the tree's centre (the feature's anchor point) is trunk, in the outer third of the zone's radial extent; the
/// trunk is one solid piece of at least 9 wall tiles with dry ground round it; the rest of the tree is bog floor (at
/// least 12 tiles) in all four quadrants round the trunk.
#[test]
fn shape_bog_tree_stands_in_the_outer_third_ringed_by_bog() {
    for (seed, m) in maps() {
        let k = single(seed, m, FeatureKind::BogTree, Zone::Plague);
        let f = &m.features[k];
        let centre = (f.ax, f.ay);
        let d: Vec<f64> = (0..m.region_grid.len())
            .filter(|&i| m.region_grid[i] == Zone::Plague.code())
            .map(|i| from_centre(m, cell(m, i)))
            .collect();
        let lo = d.iter().copied().fold(f64::MAX, f64::min);
        let hi = d.iter().copied().fold(0., f64::max);
        let need = lo + (hi - lo) * 2. / 3.;
        let dt = from_centre(m, centre);
        assert!(
            dt >= need,
            "seed {seed}: tree at {centre:?} is {dt:.1} out, the outer third starts at {need:.1} ({lo:.1}..{hi:.1})"
        );
        let tiles = owned(m, k);
        let trunk: Vec<Cell> = tiles
            .iter()
            .copied()
            .filter(|&c| m.tiles[at(m, c).unwrap()] == T_WALL)
            .collect();
        let bog: Vec<Cell> = tiles
            .iter()
            .copied()
            .filter(|&c| m.tiles[at(m, c).unwrap()] != T_WALL)
            .collect();
        assert!(
            trunk.contains(&centre),
            "seed {seed}: no trunk at {centre:?}"
        );
        assert!(
            trunk.len() >= 9,
            "seed {seed}: trunk of {} tiles",
            trunk.len()
        );
        assert_eq!(
            components(&trunk, false).len(),
            1,
            "seed {seed}: the trunk is not one piece"
        );
        for &c in &trunk {
            assert_eq!(
                m.terrain[at(m, c).unwrap()],
                0,
                "seed {seed}: trunk tile {c:?} has terrain"
            );
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let n = (c.0 + dx, c.1 + dy);
                    if trunk.contains(&n) {
                        continue;
                    }
                    let i = at(m, n).unwrap();
                    assert_ne!(
                        m.terrain[i], BOG,
                        "seed {seed}: bog at {n:?} touches the trunk"
                    );
                }
            }
        }
        assert!(bog.len() >= 12, "seed {seed}: {} bog tiles", bog.len());
        for &c in &bog {
            let i = at(m, c).unwrap();
            assert!(
                m.tiles[i] == T_FLOOR && m.terrain[i] == BOG,
                "seed {seed}: tree tile {c:?} is neither trunk nor bog floor"
            );
        }
        for (sx, sy) in [(1, 1), (-1, 1), (-1, -1), (1, -1)] {
            assert!(
                bog.iter()
                    .any(|&(x, y)| (x - centre.0) * sx > 0 && (y - centre.1) * sy > 0),
                "seed {seed}: no bog in the ({sx},{sy}) quadrant of the tree"
            );
        }
    }
}

/// Sentenced: the church is a wall ring whose footprint holds the far elite camp's whole clearing; its door (the
/// anchor's entrance, 2-3 floor tiles in a row) lies on the footprint edge facing the front and joins the walkable region
/// of the first spawn; with the door shut the camp is sealed off from that spawn.
#[test]
fn shape_church_encloses_the_far_elite_camp_with_a_door_to_the_front() {
    for (seed, m) in maps() {
        let k = single(seed, m, FeatureKind::Church, Zone::Sentenced);
        let a = anchor(seed, m, Zone::Sentenced);
        let f = &m.features[k];
        assert_eq!(a.kind, FeatureKind::Church, "seed {seed}");
        assert_eq!(
            a.footprint, f.bbox,
            "seed {seed}: footprint is not the church's box"
        );
        for c in owned(m, k) {
            assert_eq!(
                m.tiles[at(m, c).unwrap()],
                T_WALL,
                "seed {seed}: church tile {c:?} is not wall"
            );
        }
        let (camp, (cx, cy, r)) = far_elite(seed, m);
        assert_eq!(
            (a.centre.x, a.centre.y),
            camp,
            "seed {seed}: the church is not centred on the far elite camp"
        );
        let fp = grow(f.bbox, 0);
        let strict = (fp.0 + 1, fp.1 + 1, fp.2 - 1, fp.3 - 1);
        let ri = r.ceil() as i32 + 1;
        let mut clearing = Vec::new();
        for y in camp.1 - ri..=camp.1 + ri {
            for x in camp.0 - ri..=camp.0 + ri {
                let (dx, dy) = (f64::from(x) + 0.5 - cx, f64::from(y) + 0.5 - cy);
                if dx * dx + dy * dy <= r * r {
                    assert!(
                        inside(strict, (x, y)),
                        "seed {seed}: clearing tile ({x},{y}) is not inside the church {:?}",
                        f.bbox
                    );
                    clearing.push((x, y));
                }
            }
        }
        assert_eq!(a.front, expected_front(m, camp), "seed {seed}: front");
        let side = door_side(a.front);
        let door: Vec<Cell> = a.entrance.iter().map(|t| (t.x, t.y)).collect();
        assert!(
            (2..=3).contains(&door.len()),
            "seed {seed}: door of {} tiles",
            door.len()
        );
        let line_ok = |c: &Cell| match side {
            (1, 0) => c.0 == fp.2,
            (-1, 0) => c.0 == fp.0,
            (0, 1) => c.1 == fp.3,
            _ => c.1 == fp.1,
        };
        assert!(
            door.iter().all(line_ok),
            "seed {seed}: door {door:?} is not on the {side:?} edge of {:?}",
            f.bbox
        );
        let mut across: Vec<i32> = door
            .iter()
            .map(|c| if side.0 != 0 { c.1 } else { c.0 })
            .collect();
        across.sort_unstable();
        assert!(
            across.windows(2).all(|w| w[1] == w[0] + 1),
            "seed {seed}: door {door:?} is not one opening"
        );
        for &c in &door {
            assert_eq!(
                m.tiles[at(m, c).unwrap()],
                T_FLOOR,
                "seed {seed}: door tile {c:?} is not floor"
            );
        }
        let spawn = first_spawn(m);
        let reach = flood(m, &m.tiles, &[spawn]);
        assert!(
            door.iter().any(|&c| reach[at(m, c).unwrap()]),
            "seed {seed}: door {door:?} does not join the first spawn's region"
        );
        let mut shut = m.tiles.clone();
        for &c in &door {
            shut[at(m, c).unwrap()] = T_WALL;
        }
        let inside_church = flood(m, &shut, &[camp]);
        assert!(
            !inside_church[at(m, spawn).unwrap()],
            "seed {seed}: with the door shut the camp still reaches the first spawn"
        );
        for &c in &clearing {
            let i = at(m, c).unwrap();
            if m.tiles[i] == T_FLOOR {
                assert!(
                    inside_church[i],
                    "seed {seed}: clearing tile {c:?} is cut off from the camp"
                );
            }
        }
    }
}

/// Sentenced: the graveyard is at least 4 headstones beyond the door; each stone a solid block of at most 3x3 tiles, no
/// two touching (not even at a corner); the stones mirror each other about the door axis; every floor tile round them is
/// walkable from the first spawn; and the gap between the door line and the nearest stone is one value of at least 2 tiles
/// over every church of every door side.
#[test]
fn shape_graveyard_headstones_are_mirrored_about_the_door_at_one_gap() {
    let mut gaps = BTreeSet::new();
    let mut sides = BTreeSet::new();
    for (seed, m) in maps() {
        let k = single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        let a = anchor(seed, m, Zone::Sentenced);
        assert!(!a.entrance.is_empty(), "seed {seed}: church without a door");
        let tiles = owned(m, k);
        for &c in &tiles {
            assert_eq!(
                m.tiles[at(m, c).unwrap()],
                T_WALL,
                "seed {seed}: stone tile {c:?} is not wall"
            );
        }
        let stones = components(&tiles, false);
        assert!(
            stones.len() >= 4,
            "seed {seed}: {} headstones",
            stones.len()
        );
        assert_eq!(
            components(&tiles, true).len(),
            stones.len(),
            "seed {seed}: headstones touch at a corner"
        );
        for s in &stones {
            let (x0, x1) = (
                s.iter().map(|c| c.0).min().unwrap(),
                s.iter().map(|c| c.0).max().unwrap(),
            );
            let (y0, y1) = (
                s.iter().map(|c| c.1).min().unwrap(),
                s.iter().map(|c| c.1).max().unwrap(),
            );
            let (bw, bh) = (x1 - x0 + 1, y1 - y0 + 1);
            assert!(
                s.len() as i32 == bw * bh && bw <= 3 && bh <= 3,
                "seed {seed}: headstone {s:?} is not a solid block of at most 3x3"
            );
        }
        let (side, line, (lo, hi)) = door_frame(a);
        sides.insert(side);
        let frame: BTreeSet<(i32, i32)> =
            tiles.iter().map(|&c| along_across(side, line, c)).collect();
        for &(along, across) in &frame {
            assert!(
                along >= 1,
                "seed {seed}: a headstone stands inside the door line"
            );
            assert!(
                frame.contains(&(along, lo + hi - across)),
                "seed {seed}: headstone tile ({along}, {across}) has no mirror about the door axis ({lo}+{hi})/2"
            );
        }
        gaps.insert(frame.iter().map(|p| p.0).min().unwrap());
        let reach = flood(m, &m.tiles, &[first_spawn(m)]);
        let (x0, x1) = (
            tiles.iter().map(|c| c.0).min().unwrap() - 1,
            tiles.iter().map(|c| c.0).max().unwrap() + 1,
        );
        let (y0, y1) = (
            tiles.iter().map(|c| c.1).min().unwrap() - 1,
            tiles.iter().map(|c| c.1).max().unwrap() + 1,
        );
        for y in y0..=y1 {
            for x in x0..=x1 {
                if let Some(i) = at(m, (x, y)) {
                    if m.tiles[i] == T_FLOOR {
                        assert!(
                            reach[i],
                            "seed {seed}: graveyard tile ({x},{y}) is not walkable from the spawn"
                        );
                    }
                }
            }
        }
    }
    eprintln!("door sides seen: {sides:?}; gaps {gaps:?}");
    assert_eq!(
        gaps.len(),
        1,
        "headstones sit at different gaps from the door line: {gaps:?}"
    );
    assert!(
        gaps.iter().all(|&g| g >= 2),
        "headstones too near the wall: {gaps:?}"
    );
}

// --------------------------------------------------------------------------------------------------------------------
// G3, G4: the anchor on the finished map, and the bands measured from it.
// --------------------------------------------------------------------------------------------------------------------

/// The finished map carries one anchor per zone that has one (Sentenced: the church, Plague: the tree, Holy: the hall;
/// Fire and Frost none until their packets), in zone-code order, each with its feature's box as footprint, a centre
/// inside it and the front toward the coliseum; the anchors survive the map export.
#[test]
fn g3_the_finished_map_carries_the_zone_anchors() {
    for (seed, m) in maps() {
        let zones: Vec<Zone> = m.anchors.iter().map(|a| a.zone).collect();
        assert_eq!(
            zones,
            [Zone::Sentenced, Zone::Plague, Zone::Holy],
            "seed {seed}: anchored zones"
        );
        let tree = single(seed, m, FeatureKind::BogTree, Zone::Plague);
        let church = single(seed, m, FeatureKind::Church, Zone::Sentenced);
        let hall = of_kind(m, FeatureKind::Hall)
            .into_iter()
            .filter(|&k| m.features[k].zone == Zone::Holy)
            .max_by_key(|&k| (m.features[k].tiles, std::cmp::Reverse(k)))
            .unwrap_or_else(|| panic!("seed {seed}: no Holy hall"));
        for (zone, kind, k) in [
            (Zone::Sentenced, FeatureKind::Church, church),
            (Zone::Plague, FeatureKind::BogTree, tree),
            (Zone::Holy, FeatureKind::Hall, hall),
        ] {
            let a = anchor(seed, m, zone);
            let f = &m.features[k];
            assert_eq!(a.kind, kind, "seed {seed}: {zone:?} anchor kind");
            assert_eq!(a.footprint, f.bbox, "seed {seed}: {zone:?} footprint");
            let c = (a.centre.x, a.centre.y);
            assert!(
                inside(grow(f.bbox, 0), c),
                "seed {seed}: {zone:?} centre {c:?} outside its footprint"
            );
            if kind != FeatureKind::Church {
                assert_eq!(
                    c,
                    (f.ax, f.ay),
                    "seed {seed}: {zone:?} centre is not the feature's anchor point"
                );
            }
            assert_eq!(a.front, expected_front(m, c), "seed {seed}: {zone:?} front");
        }
        assert!(
            anchor(seed, m, Zone::Plague).entrance.is_empty(),
            "seed {seed}: a tree has no door"
        );
        let json = serde_json::to_string(m).unwrap();
        let back: GameMapData = serde_json::from_str(&json).unwrap();
        assert_eq!(&back, m, "seed {seed}: JSON round trip");
        let hash = u32::from_str_radix(&map_hash::map_hash(m), 16).unwrap();
        let exported = MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: hash,
            map: m.clone(),
        }
        .validate()
        .unwrap_or_else(|e| panic!("seed {seed}: {e}"))
        .into_export();
        assert_eq!(
            exported.map.anchors, m.anchors,
            "seed {seed}: anchors lost by the export"
        );
    }
}

/// G4: the band of a tile is its Chebyshev distance from the footprint (0 inside) against the one table: core up to
/// bands[0] (the apron), near up to bands[1], mid up to bands[2], far beyond.
#[test]
fn g4_band_helper_measures_from_the_footprint() {
    let b = DEFAULT_DEFINITION.bands;
    assert!(
        b[0] >= 1 && b[0] < b[1] && b[1] < b[2],
        "bands must widen outward: {b:?}"
    );
    let a = ZoneAnchor {
        zone: Zone::Plague,
        kind: FeatureKind::BogTree,
        centre: TilePt { x: 42, y: 51 },
        footprint: TileRect {
            x: 40,
            y: 50,
            w: 6,
            h: 4,
        },
        front: 0,
        entrance: Vec::new(),
    };
    let (x0, y0, x1, y1) = (40, 50, 45, 53);
    for (x, y) in [(x0, y0), (x1, y1), (42, 51), (x0, y1)] {
        assert_eq!(band(&a, x, y), Band::Core, "inside ({x},{y})");
    }
    let want = |d: i32| {
        if d <= b[0] {
            Band::Core
        } else if d <= b[1] {
            Band::Near
        } else if d <= b[2] {
            Band::Mid
        } else {
            Band::Far
        }
    };
    for d in 1..=b[2] + 3 {
        for (x, y) in [
            (x1 + d, y0 + 1),
            (x0 - d, y1),
            (x0 + 2, y0 - d),
            (x1, y1 + d),
            (x1 + d, y1 + d),
            (x0 - d, y0 - d.min(2)),
        ] {
            assert_eq!(band(&a, x, y), want(d), "({x},{y}) at distance {d}");
        }
    }
    assert_eq!(band(&a, x1 + 60, y0), Band::Far);
}

// --------------------------------------------------------------------------------------------------------------------
// G5: keep-clear outranks theme; the certifier is the judge.
// --------------------------------------------------------------------------------------------------------------------

/// Every option-on map carries both landmarks, certifies with zero failures under the strictest settings, and keeps
/// its spawn pool and spawns off every signature feature's apron.
#[test]
fn g5_signature_maps_certify_clean_and_spawns_avoid_the_landmarks() {
    let core = DEFAULT_DEFINITION.bands[0];
    for (seed, m) in maps() {
        let aprons: Vec<_> = [
            single(seed, m, FeatureKind::BogTree, Zone::Plague),
            single(seed, m, FeatureKind::Church, Zone::Sentenced),
            single(seed, m, FeatureKind::Graveyard, Zone::Sentenced),
        ]
        .iter()
        .map(|&k| (m.features[k].kind, grow(m.features[k].bbox, core)))
        .collect();
        let c = certify::certify(
            m,
            &certify::Options {
                styled: true,
                zone: true,
                strict: certify::Strict::All,
            },
        )
        .unwrap_or_else(|e| panic!("seed {seed}: certifier refused the map: {e:?}"));
        let failures: Vec<String> = c
            .failures
            .iter()
            .map(|f| format!("{}/{}", f.rule, f.subject))
            .collect();
        assert!(failures.is_empty(), "seed {seed}: {failures:?}");
        let points = m
            .spawn_pool
            .iter()
            .map(|s| (s.x, s.y))
            .chain(m.spawns.iter().map(|s| (s.x, s.y)));
        for (x, y) in points {
            let t = world_cell(x, y);
            for (kind, apron) in &aprons {
                assert!(
                    !inside(*apron, t),
                    "seed {seed}: spawn {t:?} in the {kind:?}'s apron"
                );
            }
        }
    }
}
