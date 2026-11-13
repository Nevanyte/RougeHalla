//! Oracle of P-MAPGEN-SIG-FROST-1: the Frost cave in the generator's Landmarks phase, round the zone's far elite camp,
//! closed except for one mouth that opens onto the zone's largest frozen lake, and the Frost styler's spires and
//! headlands kept out of the cave's core band (owner rules G1-G8, 2026-11-12; owner decision 4, 2026-11-10: "Frost get a
//! frozen lake with an frozen cave in back", "Enterable, elite camp inside"). No legacy counterpart (DEV-020): the
//! owner's rules as measurable checks on real maps, seeds 1-16 option on, generated once per test binary.
//!
//! Definitions (all tile units; a tile's point is its centre, x + 0.5; "floor" is tile value 0, walkable 4-connected):
//! * map centre (w/2, h/2); coliseum tile: the tile of `map.coliseum.centre`; front: DIR16 toward the coliseum tile
//!   (largest dot product, first on a tie), as in `mapgen_signature_core.rs`.
//! * cave: the one feature of kind `Cave` (zone Frost). Its footprint: the feature's bbox, which is the Frost anchor's
//!   `footprint`. Its mouth: the Frost anchor's `entrance` tiles.
//! * far elite camp: the Frost camp with `elite_spot >= 0` at the Frost anchor's centre (amended by
//!   P-MAPGEN-SIG-RESERVE-1; was: farthest from the map centre, first on a tie). Its tile:
//!   the camp point's tile; its clearing: every tile whose point is within `r` of the camp point.
//! * interior: the floor tiles reached by a 4-connected flood over floor from the far elite camp's tile, with the mouth
//!   tiles treated as blocked.
//! * closed except for one mouth: the mouth is one 4-connected straight run of 2-5 floor tiles on the footprint's edge
//!   (its first or last row or column); the interior lies wholly inside the footprint (no floor path leaves the cave
//!   except through the mouth); every mouth tile touches (4-neighbour) the interior; some mouth tile touches a floor tile
//!   outside the footprint (the mouth opens out).
//! * contains the clearing: every clearing tile is in the interior.
//! * ice inside: interior tiles with terrain ice (6) owned by the cave; at least `ICE_INSIDE`.
//! * back edge: the anchor's centre is farther from the map centre than the centroid of the Frost region's cells, or the
//!   footprint leans on the border (a footprint tile in the map's outermost two rows or columns: the border wall and the
//!   tile inside it).
//! * the largest ice body: the largest 4-connected set of floor tiles with terrain ice in the Frost region that the cave
//!   does not own (first in row order on a tie of size).
//! * mouth-to-lake path: the fewest 4-connected floor steps from any mouth tile to any tile of the largest ice body
//!   (a mouth tile is step 0); at most `MOUTH_TO_LAKE`.
//! * the body's nearest cell to the mouth: its tile with the smallest squared distance to any mouth tile (first in row
//!   order on a tie); its band (`signature::band` against the Frost anchor) is at most `Near`.
//! * spire and headland tiles: the tiles the feature grid gives to Frost `Spire` and `Headland` features.
//! * styler feature: any feature that is not `Landmark`, a signature kind, `Infill` or `Bush`.
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::{band, Band, DEFAULT_DEFINITION};
use rh_sim::mapgen::{certify, coliseum, map_hash, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

const TILE: f64 = 32.0;
const T_FLOOR: u8 = 0;
const T_WALL: u8 = 1;
const ICE: u8 = 6;
/// The fewest ice tiles inside the cave. Measured room (brief): every seed 1-32 admits a chamber round the camp with 32
/// or more ice-legal interior tiles (outside every camp halo, eight floor neighbours).
const ICE_INSIDE: usize = 8;
/// The longest floor path (steps) from the mouth to the largest ice body: the near band (6) plus a short way round.
const MOUTH_TO_LAKE: usize = 10;
/// The mouth's width in tiles (inclusive): one way in, not a missing wall.
const MOUTH_WIDTH: (usize, usize) = (2, 5);
const SIGNATURE: [FeatureKind; 7] = [
    FeatureKind::BogTree,
    FeatureKind::Church,
    FeatureKind::Graveyard,
    FeatureKind::Volcano,
    FeatureKind::LavaStream,
    FeatureKind::LavaPool,
    FeatureKind::Cave,
];
/// Today's option-off generator (`Options::default()`, `certified_styled`), seeds 1-8: (seed, `map_hash`, FNV-1a 64 of
/// the map's JSON). The values pinned by `mapgen_signature_fire.rs` (2026-11-12); G8 says they never move.
const PINNED_OFF: [(i64, &str, u64); 8] = [
    (1, "d09b4fd9", 0xf638_ce4a_8563_d41d),
    (2, "190cd50f", 0xf13c_e037_fbd7_f651),
    (3, "b82117b8", 0xeb4f_0525_0310_7414),
    (4, "bec16d65", 0x785a_11c3_0a31_46b7),
    (5, "25032ba7", 0x0f6e_a513_6ba7_ca0d),
    (6, "2d58fdf5", 0x600e_c62d_a4c6_d207),
    (7, "6255dbbe", 0x7188_b411_554a_ddb7),
    (8, "dbb3602f", 0xd855_dc2a_be46_a4eb),
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

/// Every seed must give a map with the option on: the cave is never a reason to discard a seed (G2, G5).
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

fn point(c: Cell) -> (f64, f64) {
    (f64::from(c.0) + 0.5, f64::from(c.1) + 0.5)
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1)).sqrt()
}

fn d2(a: Cell, b: Cell) -> i64 {
    let (dx, dy) = (i64::from(a.0 - b.0), i64::from(a.1 - b.1));
    dx * dx + dy * dy
}

fn map_centre(m: &GameMapData) -> (f64, f64) {
    (f64::from(m.w) / 2., f64::from(m.h) / 2.)
}

fn coliseum_tile(m: &GameMapData) -> Cell {
    world_cell(m.coliseum.centre.x, m.coliseum.centre.y)
}

fn expected_front(m: &GameMapData, c: Cell) -> u8 {
    let col = coliseum_tile(m);
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

/// (x0, y0, x1, y1) of `r` grown by `by`.
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

/// The far elite camp's tile and its clearing (camp point and radius, tiles). Amended by P-MAPGEN-SIG-RESERVE-1: the
/// cave's camp is the Frost elite camp at the Frost anchor's centre (drawn inside the cave's reserved site, it need not
/// be the elite farthest from the map centre); a map without a Frost anchor falls back to the farthest elite.
fn far_elite(seed: i64, m: &GameMapData) -> (Cell, (f64, f64, f64)) {
    let centre = map_centre(m);
    let anchored = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Frost)
        .map(|a| (a.centre.x, a.centre.y));
    let c = m
        .camps
        .iter()
        .filter(|c| c.zone == Zone::Frost && c.elite_spot >= 0)
        .filter(|c| anchored.is_none_or(|t| world_cell(c.x, c.y) == t))
        .max_by(|a, b| {
            let da = dist(point(world_cell(a.x, a.y)), centre);
            let db = dist(point(world_cell(b.x, b.y)), centre);
            da.total_cmp(&db)
        })
        .unwrap_or_else(|| panic!("seed {seed}: no Frost elite camp at the cave's centre"));
    (world_cell(c.x, c.y), (c.x / TILE, c.y / TILE, c.r / TILE))
}

fn clearing(m: &GameMapData, (cx, cy, r): (f64, f64, f64)) -> Vec<Cell> {
    let t = world_cell(cx * TILE, cy * TILE);
    let ri = r.ceil() as i32 + 1;
    let mut out = Vec::new();
    for y in t.1 - ri..=t.1 + ri {
        for x in t.0 - ri..=t.0 + ri {
            if at(m, (x, y)).is_some() && dist(point((x, y)), (cx, cy)) <= r {
                out.push((x, y));
            }
        }
    }
    out
}

/// 4-connected flood over floor from `starts`, never entering `blocked`.
fn flood(m: &GameMapData, starts: &[Cell], blocked: &BTreeSet<Cell>) -> Vec<bool> {
    let mut seen = vec![false; m.tiles.len()];
    let mut stack = Vec::new();
    for &s in starts {
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == T_FLOOR && !blocked.contains(&s)) {
            seen[i] = true;
            stack.push(s);
        }
    }
    while let Some((x, y)) = stack.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (x + dx, y + dy);
            if let Some(i) = at(m, n) {
                if !seen[i] && m.tiles[i] == T_FLOOR && !blocked.contains(&n) {
                    seen[i] = true;
                    stack.push(n);
                }
            }
        }
    }
    seen
}

/// Fewest 4-connected floor steps from any of `from` to any tile of `to`.
fn floor_steps(m: &GameMapData, from: &[Cell], to: &BTreeSet<Cell>) -> Option<usize> {
    let mut seen = vec![false; m.tiles.len()];
    let mut queue = VecDeque::new();
    for &s in from {
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == T_FLOOR) {
            seen[i] = true;
            queue.push_back((s, 0));
        }
    }
    while let Some((c, d)) = queue.pop_front() {
        if to.contains(&c) {
            return Some(d);
        }
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let n = (c.0 + dx, c.1 + dy);
            if let Some(i) = at(m, n) {
                if !seen[i] && m.tiles[i] == T_FLOOR {
                    seen[i] = true;
                    queue.push_back((n, d + 1));
                }
            }
        }
    }
    None
}

/// 4-connected groups of `cells`, in order of their first cell (row order).
fn components4(cells: &[Cell]) -> Vec<Vec<Cell>> {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut ordered: Vec<Cell> = cells.to_vec();
    ordered.sort_by_key(|c| (c.1, c.0));
    let mut out = Vec::new();
    for start in ordered {
        if !seen.insert(start) {
            continue;
        }
        let mut group = vec![start];
        let mut stack = vec![start];
        while let Some((x, y)) = stack.pop() {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let n = (x + dx, y + dy);
                if set.contains(&n) && seen.insert(n) {
                    group.push(n);
                    stack.push(n);
                }
            }
        }
        out.push(group);
    }
    out
}

fn frost_centroid_distance(m: &GameMapData) -> f64 {
    let cells: Vec<Cell> = (0..m.region_grid.len())
        .filter(|&i| m.region_grid[i] == Zone::Frost.code())
        .map(|i| cell(m, i))
        .collect();
    let n = cells.len() as f64;
    let c = (
        cells.iter().map(|c| f64::from(c.0) + 0.5).sum::<f64>() / n,
        cells.iter().map(|c| f64::from(c.1) + 0.5).sum::<f64>() / n,
    );
    dist(c, map_centre(m))
}

fn is_styler(kind: FeatureKind) -> bool {
    !SIGNATURE.contains(&kind)
        && !matches!(
            kind,
            FeatureKind::Landmark | FeatureKind::Infill | FeatureKind::Bush
        )
}

/// The cave of an option-on map: its feature index, the Frost anchor, the mouth and the interior.
struct Cave<'m> {
    k: usize,
    anchor: &'m ZoneAnchor,
    mouth: Vec<Cell>,
    interior: Vec<bool>,
}

fn cave(seed: i64, m: &GameMapData) -> Cave<'_> {
    let k = single(seed, m, FeatureKind::Cave, Zone::Frost);
    let a = anchor(seed, m, Zone::Frost);
    assert_eq!(a.kind, FeatureKind::Cave, "seed {seed}: Frost anchor kind");
    let mouth: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
    let (tile, _) = far_elite(seed, m);
    let blocked: BTreeSet<Cell> = mouth.iter().copied().collect();
    let interior = flood(m, &[tile], &blocked);
    Cave {
        k,
        anchor: a,
        mouth,
        interior,
    }
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

// --------------------------------------------------------------------------------------------------------------------
// G8: with the option off the generator, the Frost styler included, is today's.
// --------------------------------------------------------------------------------------------------------------------

/// Option off, seeds 1-8: the map hash and the whole map's JSON are the pinned values of today's generator; no cave and
/// no anchors. Passes on the stub; must keep passing.
#[test]
fn g8_option_off_maps_are_todays() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash, json) in PINNED_OFF {
        let m = generator
            .certified_styled(seed, pipeline::Options::default())
            .unwrap()
            .expect("certified");
        assert_eq!(map_hash::map_hash(&m), hash, "seed {seed}: map hash");
        assert_eq!(
            fnv(&serde_json::to_vec(&m).unwrap()),
            json,
            "seed {seed}: map JSON digest"
        );
        assert!(
            of_kind(&m, FeatureKind::Cave).is_empty(),
            "seed {seed}: option off has a cave"
        );
        assert!(m.anchors.is_empty(), "seed {seed}: option-off anchors");
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G2: the cave.
// --------------------------------------------------------------------------------------------------------------------

/// Every option-on map has one cave in Frost (walls of its own zone) round the far elite camp: closed except for one
/// mouth on its footprint's edge, the mouth nearer the coliseum than the camp, the camp's clearing in the interior, ice
/// floor inside.
#[test]
fn the_cave_is_closed_but_for_one_mouth_round_the_far_elite_camp() {
    for (seed, m) in maps() {
        let c = cave(seed, m);
        let f = &m.features[c.k];
        let tiles = owned(m, c.k);
        for &t in &tiles {
            assert_eq!(
                m.region_grid[at(m, t).unwrap()],
                Zone::Frost.code(),
                "seed {seed}: cave tile {t:?} outside Frost"
            );
        }
        let walls = tiles
            .iter()
            .filter(|&&t| m.tiles[at(m, t).unwrap()] == T_WALL)
            .count();
        assert!(walls >= 6, "seed {seed}: the cave has {walls} wall tiles");
        assert_eq!(c.anchor.footprint, f.bbox, "seed {seed}: Frost footprint");
        let fp = grow(f.bbox, 0);
        // One mouth: a straight 4-connected run of floor tiles on the footprint's edge.
        let n = c.mouth.len();
        assert!(
            (MOUTH_WIDTH.0..=MOUTH_WIDTH.1).contains(&n),
            "seed {seed}: a mouth of {n} tiles {:?}",
            c.mouth
        );
        let straight = c.mouth.iter().all(|t| t.0 == c.mouth[0].0)
            || c.mouth.iter().all(|t| t.1 == c.mouth[0].1);
        assert!(
            straight && components4(&c.mouth).len() == 1,
            "seed {seed}: the mouth {:?} is not one straight run",
            c.mouth
        );
        for &t in &c.mouth {
            assert_eq!(
                m.tiles[at(m, t).unwrap()],
                T_FLOOR,
                "seed {seed}: mouth tile {t:?} is not floor"
            );
            let on_edge =
                inside(fp, t) && (t.0 == fp.0 || t.0 == fp.2 || t.1 == fp.1 || t.1 == fp.3);
            assert!(
                on_edge,
                "seed {seed}: mouth tile {t:?} is not on the footprint's edge {fp:?}"
            );
        }
        // Closed: the interior never leaves the footprint.
        let (camp, clear) = far_elite(seed, m);
        let interior: Vec<Cell> = (0..m.tiles.len())
            .filter(|&i| c.interior[i])
            .map(|i| cell(m, i))
            .collect();
        assert!(
            !interior.is_empty(),
            "seed {seed}: the far elite camp's tile {camp:?} is not floor"
        );
        if let Some(out) = interior.iter().find(|&&t| !inside(fp, t)) {
            panic!(
                "seed {seed}: the cave is open: interior tile {out:?} outside the footprint {fp:?} (camp {camp:?})"
            );
        }
        let touches = |t: Cell, ok: &dyn Fn(Cell) -> bool| {
            [(1, 0), (-1, 0), (0, 1), (0, -1)]
                .iter()
                .any(|&(dx, dy)| ok((t.0 + dx, t.1 + dy)))
        };
        let in_interior = |t: Cell| at(m, t).is_some_and(|i| c.interior[i]);
        for &t in &c.mouth {
            assert!(
                touches(t, &in_interior),
                "seed {seed}: mouth tile {t:?} does not touch the interior"
            );
        }
        let outside_floor =
            |t: Cell| !inside(fp, t) && at(m, t).is_some_and(|i| m.tiles[i] == T_FLOOR);
        assert!(
            c.mouth.iter().any(|&t| touches(t, &outside_floor)),
            "seed {seed}: the mouth {:?} opens onto no floor outside the cave",
            c.mouth
        );
        // Toward the front.
        let col = point(coliseum_tile(m));
        let mx = c.mouth.iter().map(|t| f64::from(t.0) + 0.5).sum::<f64>() / n as f64;
        let my = c.mouth.iter().map(|t| f64::from(t.1) + 0.5).sum::<f64>() / n as f64;
        assert!(
            dist((mx, my), col) < dist(point(camp), col),
            "seed {seed}: the mouth {:?} faces away from the coliseum (camp {camp:?})",
            c.mouth
        );
        // The clearing inside; ice floor inside, owned by the cave.
        for t in clearing(m, clear) {
            assert!(
                in_interior(t),
                "seed {seed}: clearing tile {t:?} of the camp at {camp:?} is not inside the cave"
            );
        }
        let ice = interior
            .iter()
            .filter(|&&t| {
                let i = at(m, t).unwrap();
                m.terrain[i] == ICE && usize::from(m.feature_grid[i]) == c.k + 1
            })
            .count();
        assert!(
            ice >= ICE_INSIDE,
            "seed {seed}: {ice} ice tiles inside the cave"
        );
    }
}

/// The cave stands on the zone's back edge (its centre farther from the map centre than the Frost centroid, or its
/// footprint leaning on the border), and the far elite camp inside it is walkable from a spawn.
#[test]
fn the_cave_is_on_the_back_edge_and_its_camp_reachable() {
    for (seed, m) in maps() {
        let c = cave(seed, m);
        let centre = (c.anchor.centre.x, c.anchor.centre.y);
        let d = dist(point(centre), map_centre(m));
        let centroid = frost_centroid_distance(m);
        let fp = grow(c.anchor.footprint, 0);
        let leans = fp.0 <= 1 || fp.1 <= 1 || fp.2 >= m.w as i32 - 2 || fp.3 >= m.h as i32 - 2;
        assert!(
            d > centroid || leans,
            "seed {seed}: cave at {centre:?} is {d:.1} from the centre, the Frost centroid {centroid:.1}, footprint {fp:?}"
        );
        let starts: Vec<Cell> = m.spawns.iter().map(|s| world_cell(s.x, s.y)).collect();
        let reach = flood(m, &starts, &BTreeSet::new());
        let (camp, _) = far_elite(seed, m);
        assert!(
            reach[at(m, camp).unwrap()],
            "seed {seed}: the far elite camp at {camp:?} is cut off from the spawns"
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G3, G4: the Frost styler in signature mode: the lake at the mouth, spires and headlands by band.
// --------------------------------------------------------------------------------------------------------------------

/// The zone's largest ice body (not the cave's own ice) is reached from the mouth in at most `MOUTH_TO_LAKE` floor
/// steps, and its nearest tile to the mouth is in the cave's core or near band.
#[test]
fn the_mouth_opens_onto_the_largest_lake() {
    for (seed, m) in maps() {
        let c = cave(seed, m);
        let ice: Vec<Cell> = (0..m.tiles.len())
            .filter(|&i| {
                m.region_grid[i] == Zone::Frost.code()
                    && m.tiles[i] == T_FLOOR
                    && m.terrain[i] == ICE
                    && usize::from(m.feature_grid[i]) != c.k + 1
            })
            .map(|i| cell(m, i))
            .collect();
        let bodies = components4(&ice);
        let Some(body) = bodies
            .iter()
            .enumerate()
            .max_by_key(|(k, b)| (b.len(), std::cmp::Reverse(*k)))
            .map(|(_, b)| b)
        else {
            panic!("seed {seed}: no ice in Frost outside the cave");
        };
        let set: BTreeSet<Cell> = body.iter().copied().collect();
        let steps = floor_steps(m, &c.mouth, &set);
        assert!(
            steps.is_some_and(|s| s <= MOUTH_TO_LAKE),
            "seed {seed}: the largest ice body ({} tiles) is {steps:?} floor steps from the mouth {:?}",
            body.len(),
            c.mouth
        );
        let mut by_row = body.clone();
        by_row.sort_by_key(|t| (t.1, t.0));
        let nearest = by_row
            .iter()
            .min_by_key(|&&t| c.mouth.iter().map(|&q| d2(t, q)).min().unwrap())
            .copied()
            .unwrap();
        let b = band(c.anchor, nearest.0, nearest.1);
        assert!(
            b <= Band::Near,
            "seed {seed}: the largest ice body's nearest tile to the mouth {nearest:?} is in the {b:?} band"
        );
    }
}

/// No spire or headland tile lies in the cave's core band; every map keeps at least one spire or headland in Frost.
#[test]
fn spires_and_headlands_keep_out_of_the_core_band() {
    for (seed, m) in maps() {
        let a = anchor(seed, m, Zone::Frost);
        let mut kept = 0;
        for (k, f) in m.features.iter().enumerate() {
            if f.zone != Zone::Frost
                || !matches!(f.kind, FeatureKind::Spire | FeatureKind::Headland)
            {
                continue;
            }
            kept += 1;
            for t in owned(m, k) {
                assert_ne!(
                    band(a, t.0, t.1),
                    Band::Core,
                    "seed {seed}: {:?} {k} tile {t:?} in the cave's core band",
                    f.kind
                );
            }
        }
        assert!(kept >= 1, "seed {seed}: no spire or headland in Frost");
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G3, G5: the anchor and the certifier.
// --------------------------------------------------------------------------------------------------------------------

/// Every option-on map certifies with zero failures (every zone strict); the anchors are all five zones in zone-code
/// order; Frost's is the cave (its box, its anchor point, the front toward the coliseum, the mouth as entrance); no styler
/// feature owns a tile of the cave's apron.
#[test]
fn frost_maps_certify_clean_and_carry_all_five_anchors() {
    let core = DEFAULT_DEFINITION.bands[0];
    for (seed, m) in maps() {
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
        let zones: Vec<Zone> = m.anchors.iter().map(|a| a.zone).collect();
        assert_eq!(
            zones,
            [
                Zone::Fire,
                Zone::Sentenced,
                Zone::Plague,
                Zone::Frost,
                Zone::Holy
            ],
            "seed {seed}: anchored zones"
        );
        let k = single(seed, m, FeatureKind::Cave, Zone::Frost);
        let f = &m.features[k];
        let a = anchor(seed, m, Zone::Frost);
        assert_eq!(a.kind, FeatureKind::Cave, "seed {seed}: Frost anchor kind");
        assert_eq!(a.footprint, f.bbox, "seed {seed}: Frost footprint");
        let centre = (a.centre.x, a.centre.y);
        assert_eq!(centre, (f.ax, f.ay), "seed {seed}: Frost centre");
        assert!(
            inside(grow(f.bbox, 0), centre),
            "seed {seed}: Frost centre {centre:?} outside its footprint"
        );
        assert_eq!(
            a.front,
            expected_front(m, centre),
            "seed {seed}: Frost front"
        );
        assert!(!a.entrance.is_empty(), "seed {seed}: a cave has a mouth");
        let apron = grow(f.bbox, core);
        for y in apron.1..=apron.3 {
            for x in apron.0..=apron.2 {
                let Some(i) = at(m, (x, y)) else { continue };
                let id = usize::from(m.feature_grid[i]);
                if let Some(g) = id.checked_sub(1).map(|k| &m.features[k]) {
                    assert!(
                        !is_styler(g.kind),
                        "seed {seed}: the {:?} feature {} owns ({x},{y}) in the cave's apron",
                        g.kind,
                        id - 1
                    );
                }
            }
        }
    }
}

/// The other landmarks are untouched: one volcano (Fire), one church and one graveyard (Sentenced), one bog tree
/// (Plague) on every option-on map. Passes on the stub; must keep passing.
#[test]
fn the_volcano_church_and_bog_tree_still_place_on_every_seed() {
    for (seed, m) in maps() {
        single(seed, m, FeatureKind::Volcano, Zone::Fire);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
    }
}

/// The report the brief asks for (not a gate check; run with `--ignored --nocapture`): seeds 1-32 with the option on,
/// the attempt that certified and its refusals (time per map: `time` the run; the wall clock is not allowed in rh-sim);
/// every seed gives a map with one cave.
#[test]
#[ignore]
fn report_attempts_seeds_1_to_32() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut worst = 0;
    for seed in 1..=32 {
        let mut refusals = Vec::new();
        let mut found = None;
        for n in 0..16 {
            let (report, _) = generator
                .styled_attempt_with_trace(seed, n, on_options())
                .unwrap();
            match report.map {
                Some(m) => {
                    found = Some((n, m));
                    break;
                }
                None => refusals.push((n, report.refusal)),
            }
        }
        let (n, m) = found.unwrap_or_else(|| panic!("seed {seed}: no map in 16 attempts"));
        worst = worst.max(n);
        let caves = of_kind(&m, FeatureKind::Cave).len();
        eprintln!("seed {seed}: attempt {n}, refusals {refusals:?}, caves {caves}");
        assert_eq!(caves, 1, "seed {seed}: {caves} caves");
    }
    eprintln!("worst attempt index over seeds 1-32: {worst}");
}
