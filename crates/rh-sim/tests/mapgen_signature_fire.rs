//! Oracle of P-MAPGEN-SIG-FIRE-1: the Fire volcano in the generator's Landmarks phase, its lava streams ending in pools,
//! the Fire styler without its lava river and with its craters arranged by band round the volcano (owner rules G1-G8,
//! 2026-11-12; owner decision 4, 2026-11-10: "Streams end in lava pools"). No legacy counterpart (DEV-020): the
//! owner's rules as measurable checks on real maps, seeds 1-16, generated once per test binary (option on and off).
//!
//! Definitions (all tile units; a tile's point is its centre, x + 0.5):
//! * map centre (w/2, h/2); coliseum tile: the tile of `map.coliseum.centre`.
//! * lava tile: tile value 2 (LOW) with terrain 1 (lava). Walkable: tile value 0, 4-connected.
//! * volcano, stream, pool: the features of kind `Volcano`, `LavaStream`, `LavaPool`; a feature's tiles are the tiles
//!   the feature grid gives it; a stream's or pool's lava is its lava tiles.
//! * volcano centre: the volcano feature's anchor point (ax, ay), which is also the Fire anchor's centre.
//! * back edge: the volcano centre is farther from the map centre than the centroid of the Fire region's cells.
//! * a stream's start and end: its lava tile nearest to and farthest from the volcano centre (squared distance, first
//!   in row order on a tie). "Touches": Chebyshev distance at most 1.
//! * front: as in `mapgen_signature_core.rs` (DIR16 toward the coliseum tile, largest dot product, first on a tie).
//! * styler feature: any feature that is not `Landmark`, a signature kind, `Infill` or `Bush`.
//! * crater size: the crater feature's tile count (`MapFeature::tiles`, rim walls and bowl floor). A crater's band: the
//!   nearest band (`signature::band` against the Fire anchor) of any of its tiles.
//! * legacy river budget: the option-off maps of seeds 1-16 hold 107-158 lava tiles, all in their one `LavaRiver`
//!   (measured 2026-11-12, packet brief); the streams and pools together stay within 70-160.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::{band, Band, SignatureContext, DEFAULT_DEFINITION};
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, certify, coliseum, map_hash, pipeline, spawns};
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[path = "support/signature_pins.rs"]
mod pins;

const TILE: f64 = 32.0;
const T_FLOOR: u8 = 0;
const T_WALL: u8 = 1;
const T_LOW: u8 = 2;
const LAVA: u8 = 1;
const FIRE_KINDS: [FeatureKind; 3] = [
    FeatureKind::Volcano,
    FeatureKind::LavaStream,
    FeatureKind::LavaPool,
];
const SIGNATURE: [FeatureKind; 7] = [
    FeatureKind::BogTree,
    FeatureKind::Church,
    FeatureKind::Graveyard,
    FeatureKind::Volcano,
    FeatureKind::LavaStream,
    FeatureKind::LavaPool,
    FeatureKind::Cave,
];
/// The legacy river's lava, with the option off, seeds 1-16: 107-158 tiles (packet brief). The band the streams and
/// pools keep to.
const LAVA_BUDGET: (usize, usize) = (70, 160);
type Cell = (i32, i32);

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

fn off_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        ..pipeline::Options::default()
    }
}

fn generate(options: pipeline::Options) -> Vec<(i64, Option<GameMapData>)> {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    (1..=16)
        .map(|seed| {
            let map = generator
                .certified_styled(seed, options)
                .expect("generator error");
            (seed, map)
        })
        .collect()
}

/// Seeds 1-16 with the option on (the server's options: no decor), generated once per test binary.
fn on_maps() -> &'static Vec<(i64, Option<GameMapData>)> {
    static MAPS: OnceLock<Vec<(i64, Option<GameMapData>)>> = OnceLock::new();
    MAPS.get_or_init(|| generate(on_options()))
}

/// Seeds 1-16 with the option off, generated once per test binary.
fn off_maps() -> &'static Vec<(i64, Option<GameMapData>)> {
    static MAPS: OnceLock<Vec<(i64, Option<GameMapData>)>> = OnceLock::new();
    MAPS.get_or_init(|| generate(off_options()))
}

fn each(
    v: &'static [(i64, Option<GameMapData>)],
) -> impl Iterator<Item = (i64, &'static GameMapData)> {
    v.iter().map(|(seed, m)| {
        (
            *seed,
            m.as_ref()
                .unwrap_or_else(|| panic!("seed {seed}: no certified map")),
        )
    })
}

/// Every seed must give a map with the option on: the volcano is never a reason to discard a seed (G2, G5).
fn maps() -> impl Iterator<Item = (i64, &'static GameMapData)> {
    each(on_maps())
}

fn off(seed: i64) -> &'static GameMapData {
    each(off_maps())
        .find(|(s, _)| *s == seed)
        .map(|(_, m)| m)
        .expect("option-off map")
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

fn is_lava(m: &GameMapData, i: usize) -> bool {
    m.tiles[i] == T_LOW && m.terrain[i] == LAVA
}

/// Tiles owned by feature index `k` (feature grid id k + 1).
fn owned(m: &GameMapData, k: usize) -> Vec<Cell> {
    (0..m.feature_grid.len())
        .filter(|&i| usize::from(m.feature_grid[i]) == k + 1)
        .map(|i| cell(m, i))
        .collect()
}

fn lava_of(m: &GameMapData, k: usize) -> Vec<Cell> {
    owned(m, k)
        .into_iter()
        .filter(|&c| is_lava(m, at(m, c).unwrap()))
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

fn grow(r: rh_sim::mapdata::TileRect, by: i32) -> (i32, i32, i32, i32) {
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

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1)).sqrt()
}

fn point(c: Cell) -> (f64, f64) {
    (f64::from(c.0) + 0.5, f64::from(c.1) + 0.5)
}

fn map_centre(m: &GameMapData) -> (f64, f64) {
    (f64::from(m.w) / 2., f64::from(m.h) / 2.)
}

fn coliseum_tile(m: &GameMapData) -> Cell {
    world_cell(m.coliseum.centre.x, m.coliseum.centre.y)
}

fn chebyshev(a: Cell, b: Cell) -> i32 {
    (a.0 - b.0).abs().max((a.1 - b.1).abs())
}

fn d2(a: Cell, b: Cell) -> i64 {
    let (dx, dy) = (i64::from(a.0 - b.0), i64::from(a.1 - b.1));
    dx * dx + dy * dy
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

fn flood(m: &GameMapData, starts: &[Cell]) -> Vec<bool> {
    let mut seen = vec![false; m.tiles.len()];
    let mut stack = Vec::new();
    for &s in starts {
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == T_FLOOR) {
            seen[i] = true;
            stack.push(s);
        }
    }
    while let Some((x, y)) = stack.pop() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            if let Some(i) = at(m, (x + dx, y + dy)) {
                if !seen[i] && m.tiles[i] == T_FLOOR {
                    seen[i] = true;
                    stack.push((x + dx, y + dy));
                }
            }
        }
    }
    seen
}

/// Connected groups of `cells`, 8-neighbour.
fn components8(cells: &[Cell]) -> usize {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut groups = 0;
    for &start in &set {
        if !seen.insert(start) {
            continue;
        }
        groups += 1;
        let mut stack = vec![start];
        while let Some((x, y)) = stack.pop() {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let n = (x + dx, y + dy);
                    if set.contains(&n) && seen.insert(n) {
                        stack.push(n);
                    }
                }
            }
        }
    }
    groups
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

fn fire_centroid_distance(m: &GameMapData) -> f64 {
    let cells: Vec<Cell> = (0..m.region_grid.len())
        .filter(|&i| m.region_grid[i] == Zone::Fire.code())
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

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

// --------------------------------------------------------------------------------------------------------------------
// G8: with the option off the generator, the Fire styler included, is today's.
// --------------------------------------------------------------------------------------------------------------------

/// Option off, seeds 1-8: the map hash and the whole map's JSON are the pinned values of today's generator; option off,
/// seeds 1-16: no volcano, stream or pool, one lava river in Fire, no anchors.
#[test]
fn g8_option_off_maps_are_todays() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash, json) in pins::pinned_off() {
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
    }
    for (seed, m) in each(off_maps()) {
        for kind in FIRE_KINDS {
            assert!(
                of_kind(m, kind).is_empty(),
                "seed {seed}: option off has a {kind:?}"
            );
        }
        let rivers = of_kind(m, FeatureKind::LavaRiver);
        assert_eq!(rivers.len(), 1, "seed {seed}: option-off lava rivers");
        assert_eq!(m.features[rivers[0]].zone, Zone::Fire, "seed {seed}");
        assert!(m.anchors.is_empty(), "seed {seed}: option-off anchors");
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G2: the volcano, its streams and pools.
// --------------------------------------------------------------------------------------------------------------------

/// Every option-on map has one volcano in Fire (wall in its own zone) with 2 or 3 streams and as many pools; each
/// stream is one 8-connected run of lava that starts touching the volcano and ends touching a pool; every pool is
/// reached by a stream's end and holds at least 4 lava tiles with a 2x2 block of lava (a pool, not a channel).
#[test]
fn volcano_has_two_or_three_streams_each_ending_in_a_pool() {
    for (seed, m) in maps() {
        let v = single(seed, m, FeatureKind::Volcano, Zone::Fire);
        let cone = owned(m, v);
        assert!(
            cone.iter().any(|&c| m.tiles[at(m, c).unwrap()] == T_WALL),
            "seed {seed}: the volcano has no wall"
        );
        for &c in &cone {
            assert_eq!(
                m.region_grid[at(m, c).unwrap()],
                Zone::Fire.code(),
                "seed {seed}: volcano tile {c:?} outside Fire"
            );
        }
        let centre = (m.features[v].ax, m.features[v].ay);
        let streams = of_kind(m, FeatureKind::LavaStream);
        let pools = of_kind(m, FeatureKind::LavaPool);
        assert!(
            (2..=3).contains(&streams.len()),
            "seed {seed}: {} streams",
            streams.len()
        );
        assert_eq!(pools.len(), streams.len(), "seed {seed}: pools per stream");
        for &k in streams.iter().chain(&pools) {
            assert_eq!(
                m.features[k].zone,
                Zone::Fire,
                "seed {seed}: feature {k} zone"
            );
            for c in owned(m, k) {
                let i = at(m, c).unwrap();
                assert!(
                    m.tiles[i] != T_WALL && (m.tiles[i] != T_LOW || is_lava(m, i)),
                    "seed {seed}: {:?} tile {c:?} is neither lava nor floor",
                    m.features[k].kind
                );
            }
        }
        let pool_lava: Vec<Vec<Cell>> = pools.iter().map(|&k| lava_of(m, k)).collect();
        let mut reached = BTreeSet::new();
        for (s, &k) in streams.iter().enumerate() {
            let lava = lava_of(m, k);
            assert!(!lava.is_empty(), "seed {seed}: stream {s} holds no lava");
            assert_eq!(
                components8(&lava),
                1,
                "seed {seed}: stream {s} is not one run of lava"
            );
            let start = *lava.iter().min_by_key(|&&c| d2(c, centre)).unwrap();
            let end = *lava.iter().max_by_key(|&&c| d2(c, centre)).unwrap();
            assert!(
                cone.iter().any(|&c| chebyshev(c, start) <= 1),
                "seed {seed}: stream {s} starts at {start:?}, away from the volcano"
            );
            let touched: Vec<usize> = (0..pools.len())
                .filter(|&p| pool_lava[p].iter().any(|&c| chebyshev(c, end) <= 1))
                .collect();
            assert!(
                !touched.is_empty(),
                "seed {seed}: stream {s} ends at {end:?}, away from every pool"
            );
            reached.extend(touched);
        }
        assert_eq!(
            reached.len(),
            pools.len(),
            "seed {seed}: a pool no stream ends in"
        );
        for (p, lava) in pool_lava.iter().enumerate() {
            let set: BTreeSet<Cell> = lava.iter().copied().collect();
            let block = lava.iter().any(|&(x, y)| {
                [(1, 0), (0, 1), (1, 1)]
                    .iter()
                    .all(|&(dx, dy)| set.contains(&(x + dx, y + dy)))
            });
            assert!(
                lava.len() >= 4 && block,
                "seed {seed}: pool {p} of {} lava tiles is not a pool",
                lava.len()
            );
        }
    }
}

/// The volcano stands on the zone's back edge (its centre farther from the map centre than the Fire centroid) and
/// every stream runs toward the front: its end is nearer the coliseum tile than the volcano centre is.
#[test]
fn volcano_on_the_back_edge_with_streams_toward_the_front() {
    for (seed, m) in maps() {
        let v = single(seed, m, FeatureKind::Volcano, Zone::Fire);
        let centre = (m.features[v].ax, m.features[v].ay);
        let d = dist(point(centre), map_centre(m));
        let centroid = fire_centroid_distance(m);
        assert!(
            d > centroid,
            "seed {seed}: volcano at {centre:?} is {d:.1} from the centre, the Fire centroid {centroid:.1}"
        );
        let col = point(coliseum_tile(m));
        let from = dist(point(centre), col);
        for (s, k) in of_kind(m, FeatureKind::LavaStream).into_iter().enumerate() {
            let lava = lava_of(m, k);
            let Some(&end) = lava.iter().max_by_key(|&&c| d2(c, centre)) else {
                panic!("seed {seed}: stream {s} holds no lava");
            };
            let to = dist(point(end), col);
            assert!(
                to < from,
                "seed {seed}: stream {s} ends at {end:?}, {to:.1} from the coliseum; the volcano is {from:.1}"
            );
        }
    }
}

// --------------------------------------------------------------------------------------------------------------------
// G3, G4: the Fire styler in signature mode: no river, lava within the river's budget, camps reachable.
// --------------------------------------------------------------------------------------------------------------------

/// No lava river with the option on; every lava tile belongs to the volcano, a stream or a pool; the Fire zone's lava
/// stays within the legacy river's budget.
#[test]
fn no_lava_river_and_lava_within_the_rivers_budget() {
    for (seed, m) in maps() {
        assert!(
            of_kind(m, FeatureKind::LavaRiver).is_empty(),
            "seed {seed}: a lava river with the option on"
        );
        let mut fire = 0;
        for i in 0..m.tiles.len() {
            if !is_lava(m, i) {
                continue;
            }
            let id = usize::from(m.feature_grid[i]);
            let kind = id.checked_sub(1).map(|k| m.features[k].kind);
            assert!(
                kind.is_some_and(|k| FIRE_KINDS.contains(&k)),
                "seed {seed}: lava at {:?} owned by {kind:?}",
                cell(m, i)
            );
            if m.region_grid[i] == Zone::Fire.code() {
                fire += 1;
            }
        }
        assert!(
            (LAVA_BUDGET.0..=LAVA_BUDGET.1).contains(&fire),
            "seed {seed}: {fire} lava tiles in Fire, budget {LAVA_BUDGET:?}"
        );
    }
}

/// Every Fire camp's tile is walkable from a spawn (lava is not walkable), and no lava lies in a Fire camp's clearing.
#[test]
fn every_fire_camp_is_reachable_from_a_spawn_without_crossing_lava() {
    for (seed, m) in maps() {
        let starts: Vec<Cell> = m.spawns.iter().map(|s| world_cell(s.x, s.y)).collect();
        let reach = flood(m, &starts);
        for c in m.camps.iter().filter(|c| c.zone == Zone::Fire) {
            let t = world_cell(c.x, c.y);
            assert!(
                reach[at(m, t).unwrap()],
                "seed {seed}: Fire camp {} at {t:?} is cut off from the spawns",
                c.id
            );
            let (cx, cy, r) = (c.x / TILE, c.y / TILE, c.r / TILE);
            let ri = r.ceil() as i32 + 1;
            for y in t.1 - ri..=t.1 + ri {
                for x in t.0 - ri..=t.0 + ri {
                    let Some(i) = at(m, (x, y)) else { continue };
                    if dist(point((x, y)), (cx, cy)) <= r {
                        assert!(
                            !is_lava(m, i),
                            "seed {seed}: lava at ({x},{y}) in camp {}'s clearing",
                            c.id
                        );
                    }
                }
            }
        }
    }
}

/// G4 for the craters: none touches the core band of the Fire anchor; craters touching the near band are on average at
/// least as large as those whose nearest tile is in mid or far (pooled over seeds 1-16, and at least one near-band
/// crater exists); each map keeps at least its option-off crater count minus two.
#[test]
fn craters_are_arranged_by_band_round_the_volcano() {
    let mut near = Vec::new();
    let mut beyond = Vec::new();
    for (seed, m) in maps() {
        let a = anchor(seed, m, Zone::Fire);
        let craters: Vec<usize> = of_kind(m, FeatureKind::Crater)
            .into_iter()
            .filter(|&k| m.features[k].zone == Zone::Fire)
            .collect();
        let before = of_kind(off(seed), FeatureKind::Crater).len();
        assert!(
            craters.len() + 2 >= before,
            "seed {seed}: {} craters, {before} with the option off",
            craters.len()
        );
        for k in craters {
            let nearest = owned(m, k)
                .into_iter()
                .map(|c| band(a, c.0, c.1))
                .min()
                .unwrap_or(Band::Far);
            assert_ne!(
                nearest,
                Band::Core,
                "seed {seed}: crater {k} at ({}, {}) reaches the volcano's core band",
                m.features[k].ax,
                m.features[k].ay
            );
            let size = f64::from(m.features[k].tiles);
            if nearest == Band::Near {
                near.push(size);
            } else {
                beyond.push(size);
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    eprintln!(
        "craters: near {} (mean {:.1}), mid/far {} (mean {:.1})",
        near.len(),
        mean(&near),
        beyond.len(),
        mean(&beyond)
    );
    assert!(!near.is_empty(), "no crater in the near band on any seed");
    assert!(
        !beyond.is_empty(),
        "no crater in the mid or far band on any seed"
    );
    assert!(
        mean(&near) >= mean(&beyond),
        "near-band craters average {:.1} tiles, mid/far {:.1}",
        mean(&near),
        mean(&beyond)
    );
}

// --------------------------------------------------------------------------------------------------------------------
// G3, G5: the anchor and the certifier.
// --------------------------------------------------------------------------------------------------------------------

/// Every option-on map certifies with zero failures (every zone strict); the anchors other than Frost's are Fire,
/// Sentenced, Plague and Holy in zone-code order; Fire's is the volcano (its box, its anchor point, the front toward the coliseum, no
/// entrance); no styler feature owns a tile of the volcano's apron.
#[test]
fn fire_maps_certify_clean_and_carry_the_volcano_anchor() {
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
        // Frost's anchor (the cave) is P-MAPGEN-SIG-FROST-1's, checked by `mapgen_signature_frost.rs`.
        let zones: Vec<Zone> = m
            .anchors
            .iter()
            .map(|a| a.zone)
            .filter(|&z| z != Zone::Frost)
            .collect();
        assert_eq!(
            zones,
            [Zone::Fire, Zone::Sentenced, Zone::Plague, Zone::Holy],
            "seed {seed}: anchored zones"
        );
        let v = single(seed, m, FeatureKind::Volcano, Zone::Fire);
        let f = &m.features[v];
        let a = anchor(seed, m, Zone::Fire);
        assert_eq!(
            a.kind,
            FeatureKind::Volcano,
            "seed {seed}: Fire anchor kind"
        );
        assert_eq!(a.footprint, f.bbox, "seed {seed}: Fire footprint");
        let centre = (a.centre.x, a.centre.y);
        assert_eq!(centre, (f.ax, f.ay), "seed {seed}: Fire centre");
        assert!(
            inside(grow(f.bbox, 0), centre),
            "seed {seed}: Fire centre {centre:?} outside its footprint"
        );
        assert_eq!(
            a.front,
            expected_front(m, centre),
            "seed {seed}: Fire front"
        );
        assert!(a.entrance.is_empty(), "seed {seed}: a volcano has no door");
        let apron = grow(f.bbox, core);
        for y in apron.1..=apron.3 {
            for x in apron.0..=apron.2 {
                let Some(i) = at(m, (x, y)) else { continue };
                let id = usize::from(m.feature_grid[i]);
                if let Some(g) = id.checked_sub(1).map(|k| &m.features[k]) {
                    assert!(
                        !is_styler(g.kind),
                        "seed {seed}: the {:?} feature {} owns ({x},{y}) in the volcano's apron",
                        g.kind,
                        id - 1
                    );
                }
            }
        }
    }
}

/// The core packet's landmarks are untouched: one bog tree (Plague), one church and one graveyard (Sentenced) on every
/// option-on map. Passes on the stub; must keep passing.
#[test]
fn the_bog_tree_and_the_church_still_place_on_every_seed() {
    for (seed, m) in maps() {
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Carried reviewer notes on P-MAPGEN-SIGNATURE-CORE-1.
// --------------------------------------------------------------------------------------------------------------------

/// Note 1 (finished maps): no bog-tree tile lies in another landmark's apron: a legacy building grown by the spawn
/// rules' `landmark_box_margin` (the stage's `near1`), or another signature feature's box grown by the core band.
#[test]
fn note1_bog_tree_tiles_stay_out_of_other_landmarks_aprons() {
    let core = DEFAULT_DEFINITION.bands[0];
    let margin = spawns::DEFAULT_DEFINITION.landmark_box_margin;
    for (seed, m) in maps() {
        let tree = single(seed, m, FeatureKind::BogTree, Zone::Plague);
        let aprons: Vec<(String, (i32, i32, i32, i32))> = m
            .buildings
            .iter()
            .map(|b| ("building".to_string(), grow(*b, margin)))
            .chain(
                m.features
                    .iter()
                    .enumerate()
                    .filter(|&(k, f)| k != tree && SIGNATURE.contains(&f.kind))
                    .map(|(_, f)| (format!("{:?}", f.kind), grow(f.bbox, core))),
            )
            .collect();
        for c in owned(m, tree) {
            for (name, apron) in &aprons {
                assert!(
                    !inside(*apron, c),
                    "seed {seed}: bog-tree tile {c:?} in the {name}'s apron {apron:?}"
                );
            }
        }
    }
}

/// Note 1 (the site rule): the step reads the stage's `near1`. Each seed's attempt-0 tree is placed once as is; then,
/// on a fresh stage of the same attempt, its box grown by the core band is marked in `near1` (another landmark's apron
/// there) and the step runs again: the tree it places, if any, has no tile in the marked aprons. Amended by
/// P-MAPGEN-SIG-BLUEPRINT-2 (the rule-drawn tree is gone): on the reserving prefix the tree is centred in its site and
/// cannot move, so with its own box's apron marked the step refuses the attempt every time.
#[test]
fn note1_the_bog_tree_site_keeps_out_of_marked_aprons() {
    let fixed = coliseum::fixed_layout();
    let prefix = attempt::AttemptContext::new(&fixed);
    let landmarks = stage::StageContext::new(&fixed);
    let recipes = recipes::Recipes::default();
    let step = SignatureContext::new(&fixed);
    let core = DEFAULT_DEFINITION.bands[0];
    let w = coliseum::W as i32;
    let tree_tiles = |st: &stage::LandmarkStage| -> Vec<usize> {
        let Some(k) = st
            .state
            .features
            .iter()
            .position(|f| f.kind == FeatureKind::BogTree)
        else {
            return Vec::new();
        };
        (0..st.state.feature_owner.len())
            .filter(|&i| usize::from(st.state.feature_owner[i]) == k + 1)
            .collect()
    };
    let (mut checked, mut refused) = (0, 0);
    for seed in 1..=6 {
        let Some(frame) = attempt::begin_attempt_signature(&prefix, seed, 0, true).unwrap() else {
            continue;
        };
        let mut first = landmarks.apply(&frame, &recipes).unwrap().expect("stage");
        if step.apply(&frame, &mut first).unwrap().is_none() {
            continue;
        }
        let tiles = tree_tiles(&first);
        assert!(!tiles.is_empty(), "seed {seed}: placed without a bog tree");
        let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for &i in &tiles {
            let (x, y) = (i as i32 % w, i as i32 / w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        let mut again = landmarks.apply(&frame, &recipes).unwrap().expect("stage");
        for y in y0 - core..=y1 + core {
            for x in x0 - core..=x1 + core {
                if x >= 0 && y >= 0 && x < w && y < coliseum::H as i32 {
                    again.masks.near1[(y * w + x) as usize] = 1;
                }
            }
        }
        let marked = again.masks.near1.clone();
        checked += 1;
        if step.apply(&frame, &mut again).unwrap().is_none() {
            refused += 1;
            continue;
        }
        let inside_apron: Vec<usize> = tree_tiles(&again)
            .into_iter()
            .filter(|&i| marked[i] != 0)
            .collect();
        assert!(
            inside_apron.is_empty(),
            "seed {seed}: {} bog-tree tiles in an apron marked before the step (first at {:?})",
            inside_apron.len(),
            inside_apron.first().map(|&i| (i as i32 % w, i as i32 / w))
        );
    }
    assert!(
        checked >= 3,
        "only {checked} seeds placed a tree at attempt 0"
    );
    assert_eq!(
        refused, checked,
        "a tree pinned to its site placed despite its own apron marked"
    );
}

/// Note 2: the attempt report tells a zone with no legal landmark site (`Refusal::Signature`, refused in the Landmarks
/// phase: the trace stops at `Prefix`) from a finished map discarded by the end-of-attempt check
/// (`Refusal::SignatureDiscarded`, refused after `Records`). Seeds 6-10, attempts 0-3, option on; discards occur
/// (amended by P-MAPGEN-SIG-RESERVE-1: site refusals need not). Amended by P-MAPGEN-GUARANTEES-1: a map discarded by a
/// zone's end-of-attempt guarantee (`Refusal::Guarantee`, also after `Records`) is a discard too; the three discards
/// here (seeds 7, 8, 9, attempt 0) fail only the Frost lake rule, so they are `Guarantee { Frost, "lake-at-mouth" }`
/// once that rule is a guarantee.
#[test]
fn note2_refusals_tell_no_site_from_a_discarded_map() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let (mut no_site, mut discarded) = (0, 0);
    for seed in 6..=10 {
        for n in 0..4 {
            let (report, trace) = generator
                .styled_attempt_with_trace(seed, n, on_options())
                .unwrap();
            let Some(refusal) = report.refusal else {
                continue;
            };
            let last = trace.last().map(|t| t.phase);
            match last {
                Some(pipeline::Phase::Prefix) if refusal != pipeline::Refusal::Landmarks => {
                    assert_eq!(
                        refusal,
                        pipeline::Refusal::Signature,
                        "seed {seed} attempt {n}: refused in the Landmarks phase"
                    );
                    no_site += 1;
                }
                Some(pipeline::Phase::Records) => {
                    if matches!(
                        refusal,
                        pipeline::Refusal::Signature
                            | pipeline::Refusal::SignatureDiscarded
                            | pipeline::Refusal::Guarantee { .. }
                    ) {
                        assert!(
                            matches!(
                                refusal,
                                pipeline::Refusal::SignatureDiscarded
                                    | pipeline::Refusal::Guarantee { .. }
                            ),
                            "seed {seed} attempt {n}: discarded after records, not {refusal:?}"
                        );
                        discarded += 1;
                    }
                }
                _ => assert!(
                    !matches!(
                        refusal,
                        pipeline::Refusal::Signature
                            | pipeline::Refusal::SignatureDiscarded
                            | pipeline::Refusal::Guarantee { .. }
                    ),
                    "seed {seed} attempt {n}: {refusal:?} after {last:?}"
                ),
            }
        }
    }
    // Amended by P-MAPGEN-SIG-RESERVE-1: with each landmark's site reserved before the camps, a zone with no legal
    // landmark site is rare (1 refusal over seeds 1-64 in the brief's prototype, none in seeds 6-10, attempts 0-3), so
    // only the discards must occur here; every site refusal that does occur is still checked above to stop at
    // `Prefix`. (Was: both kinds occur.)
    eprintln!("no site {no_site}, discarded {discarded}");
    assert!(
        discarded >= 1,
        "seeds 6-10, attempts 0-3: {no_site} site refusals, {discarded} discards"
    );
}
