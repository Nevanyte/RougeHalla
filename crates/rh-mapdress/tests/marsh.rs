//! P-DRESS-MARSH-1: Plague's marsh rings. Round every bog tile of the Plague zone the ground reads as "water" (Chebyshev
//! distance 1 to a bog tile) and then "mud" (distance 2 and 3), laid on the zone's plain floor only. Looks only: no
//! terrain code, no prop moves, except that a TALL prop never stands on water. Where a marsh ring and a landmark band
//! (or a fallback ring) both claim a tile, the marsh ring wins; outside the marsh reach the band's variant shows.
//!
//! Measure: Chebyshev distance in tiles, straight (walls do not block it), from the nearest bog tile OF THE SAME ZONE.
//! A diagonal corner tile of a bog tile is at distance 1, so a lone bog tile is ringed by a 3x3 square of water and a
//! 7x7 square of mud and water; the corners are filled.
//!
//! Ground ids: 7 water, 8 mud (Plague's other variants are 0-6; ids belong to the art packets per zone).
//! Tests marked GUARD pass on the stub (they pin what must not change); the rest fail on assertions until the rings
//! are laid. The per-zone golden values are this packet's own (measured on the tree before the change), not legacy.
mod common;
use common::*;
use rh_mapdress::rules::TileClass;
use rh_mapdress::{dress, Dressing, Rules, FLAG_LEGACY, FLAG_TALL};
use rh_sim::mapdata::{GameMapData, Zone};
use rh_sim::mapgen::{coliseum, map_hash, pipeline};
use serde_json::{json, Value};
use std::sync::OnceLock;

const WATER: u8 = 7;
const MUD: u8 = 8;
const WATER_REACH: u32 = 1;
const MUD_REACH: u32 = 3;

const STARTER: &str = include_str!("../rules/zones.json");

/// Seeds 1..=8 with `signature` on (the bog tree's landmark bands are in force).
fn sig_cases() -> &'static Vec<Case> {
    static CASES: OnceLock<Vec<Case>> = OnceLock::new();
    CASES.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let options = pipeline::Options {
            signature: true,
            ..pipeline::Options::default()
        };
        (1..=8i64)
            .map(|seed| {
                let map = generator
                    .certified_styled(seed, options)
                    .expect("generator runs")
                    .unwrap_or_else(|| panic!("signature seed {seed} certifies"));
                let hash = u64::from_str_radix(&map_hash::map_hash(&map), 16).expect("hex hash");
                Case { seed, map, hash }
            })
            .collect()
    })
}

/// The shipped file with every `terrainRings` list removed: today's dressing (the rule file before this packet).
fn no_marsh_rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| {
        let mut v: Value = serde_json::from_str(STARTER).unwrap();
        for z in v["zones"].as_object_mut().unwrap().values_mut() {
            z.as_object_mut().unwrap().remove("terrainRings");
        }
        Rules::from_json(&v.to_string()).expect("the shipped file minus terrainRings parses")
    })
}

fn is_bog(map: &GameMapData, i: usize, zone: Zone) -> bool {
    zone_at(map, i) == Some(zone) && class_of(map, i) == TileClass::Bog
}

/// Chebyshev distance to the nearest same-zone tile of class `around`, searched out to `limit` tiles.
fn near(
    map: &GameMapData,
    zone: Zone,
    around: TileClass,
    tx: usize,
    ty: usize,
    limit: i64,
) -> Option<i64> {
    let (mw, mh) = (map.w as i64, map.h as i64);
    let mut best: Option<i64> = None;
    for dy in -limit..=limit {
        for dx in -limit..=limit {
            let (x, y) = (tx as i64 + dx, ty as i64 + dy);
            if x < 0 || y < 0 || x >= mw || y >= mh {
                continue;
            }
            let j = (y * mw + x) as usize;
            if zone_at(map, j) == Some(zone) && class_of(map, j) == around {
                let d = dx.abs().max(dy.abs());
                best = Some(best.map_or(d, |b| b.min(d)));
            }
        }
    }
    best
}

/// The marsh variant the rule demands for tile `i`, or `None` when the tile is not in a ring.
fn marsh_expect(map: &GameMapData, tx: usize, ty: usize) -> Option<u8> {
    let i = idx(map, tx, ty);
    if zone_at(map, i) != Some(Zone::Plague) || class_of(map, i) != TileClass::Floor {
        return None;
    }
    match near(map, Zone::Plague, TileClass::Bog, tx, ty, MUD_REACH as i64) {
        Some(d) if d <= WATER_REACH as i64 => Some(WATER),
        Some(_) => Some(MUD),
        None => None,
    }
}

/// The ground plane, tile by tile: marsh tiles carry their marsh variant, every other tile carries exactly what today's
/// rules give it (band or fallback ring variant, or 0). This is the precedence rule and the "nowhere else" rule at once.
fn check_ground(c: &Case, label: &str) {
    let d = dress(&c.map, c.hash, rules());
    let base = dress(&c.map, c.hash, no_marsh_rules());
    let (mut water, mut mud) = (0, 0);
    for ty in 0..c.map.h as usize {
        for tx in 0..c.map.w as usize {
            let i = idx(&c.map, tx, ty);
            match marsh_expect(&c.map, tx, ty) {
                Some(v) => {
                    assert_eq!(
                        d.ground_variants[i], v,
                        "{label} seed {}: marsh variant of tile ({tx},{ty})",
                        c.seed
                    );
                    if v == WATER {
                        water += 1;
                    } else {
                        mud += 1;
                    }
                }
                None => assert_eq!(
                    d.ground_variants[i], base.ground_variants[i],
                    "{label} seed {}: tile ({tx},{ty}) is outside every marsh ring, so it keeps today's variant",
                    c.seed
                ),
            }
        }
    }
    assert!(
        water > 0 && mud > 0,
        "{label} seed {}: the map has bog, so it has water and mud",
        c.seed
    );
}

#[test]
fn signature_maps_lay_water_then_mud_round_bog_and_nothing_else_changes() {
    for c in sig_cases() {
        check_ground(c, "signature");
    }
}

#[test]
fn option_off_maps_lay_water_then_mud_round_bog_and_nothing_else_changes() {
    for c in &cases()[..4] {
        check_ground(c, "option off");
    }
}

/// The precedence is exercised: some tile is in a bog-tree band (its band variant is 3..=6 without marsh rings) and in
/// a marsh ring, and there the marsh variant is the one set; the next tile outside the reach still shows its band.
#[test]
fn a_marsh_ring_wins_over_a_landmark_band_and_the_band_shows_elsewhere() {
    let (mut overlap, mut band_outside) = (0, 0);
    for c in sig_cases() {
        let d = dress(&c.map, c.hash, rules());
        let base = dress(&c.map, c.hash, no_marsh_rules());
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                if zone_at(&c.map, i) != Some(Zone::Plague)
                    || class_of(&c.map, i) != TileClass::Floor
                    || !(3..=6).contains(&base.ground_variants[i])
                {
                    continue;
                }
                match marsh_expect(&c.map, tx, ty) {
                    Some(v) => {
                        assert_eq!(d.ground_variants[i], v, "seed {} ({tx},{ty})", c.seed);
                        overlap += 1;
                    }
                    None => {
                        assert_eq!(
                            d.ground_variants[i], base.ground_variants[i],
                            "seed {} ({tx},{ty})",
                            c.seed
                        );
                        band_outside += 1;
                    }
                }
            }
        }
    }
    assert!(overlap > 0, "no tile is both in a band and in a marsh ring");
    assert!(
        band_outside > 0,
        "no band tile lies outside the marsh reach"
    );
}

/// Every 4-connected bog body (a pool) is ringed: all of the plain Plague floor within one tile of it is water, and
/// within three tiles is water or mud. (The per-tile tests above imply this; here it is stated per pool.)
#[test]
fn every_bog_pool_with_free_floor_round_it_is_fully_ringed() {
    let mut pools_with_floor = 0;
    for c in sig_cases().iter().chain(&cases()[..4]) {
        let m = &c.map;
        let (mw, mh) = (m.w as usize, m.h as usize);
        let d = dress(m, c.hash, rules());
        let mut seen = vec![false; mw * mh];
        for start in 0..mw * mh {
            if seen[start] || !is_bog(m, start, Zone::Plague) {
                continue;
            }
            let mut pool = vec![start];
            seen[start] = true;
            let mut k = 0;
            while k < pool.len() {
                let (x, y) = (pool[k] % mw, pool[k] / mw);
                k += 1;
                for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    if nx < 0 || ny < 0 || nx >= mw as i64 || ny >= mh as i64 {
                        continue;
                    }
                    let j = ny as usize * mw + nx as usize;
                    if !seen[j] && is_bog(m, j, Zone::Plague) {
                        seen[j] = true;
                        pool.push(j);
                    }
                }
            }
            let mut free = 0;
            for &p in &pool {
                let (px, py) = ((p % mw) as i64, (p / mw) as i64);
                for dy in -3i64..=3 {
                    for dx in -3i64..=3 {
                        let (x, y) = (px + dx, py + dy);
                        if x < 0 || y < 0 || x >= mw as i64 || y >= mh as i64 {
                            continue;
                        }
                        let j = y as usize * mw + x as usize;
                        if zone_at(m, j) != Some(Zone::Plague) || class_of(m, j) != TileClass::Floor
                        {
                            continue;
                        }
                        let v = d.ground_variants[j];
                        if dx.abs().max(dy.abs()) <= 1 {
                            assert_eq!(v, WATER, "seed {}: floor beside a pool, tile {j}", c.seed);
                            free += 1;
                        } else {
                            assert!(
                                v == WATER || v == MUD,
                                "seed {}: floor within three tiles of a pool, tile {j}: {v}",
                                c.seed
                            );
                        }
                    }
                }
            }
            if free > 0 {
                pools_with_floor += 1;
            }
        }
    }
    assert!(pools_with_floor > 0);
}

/// A single bog tile in open Plague floor: water is the 8 tiles round it (corners included), mud the rest of the 7x7
/// square, nothing beyond. Pins the Chebyshev measure and what a diagonal corner looks like.
#[test]
fn a_lone_bog_tile_is_ringed_by_a_square_with_filled_corners() {
    let (mut found, mut tried) = (false, 0);
    'seeds: for c in &cases()[..4] {
        let mut map = c.map.clone();
        let (mw, mh) = (map.w as usize, map.h as usize);
        for t in map.terrain.iter_mut() {
            if *t == 5 {
                *t = 0;
            }
        }
        let open = |m: &GameMapData, x: usize, y: usize| {
            let i = idx(m, x, y);
            zone_at(m, i) == Some(Zone::Plague) && class_of(m, i) == TileClass::Floor
        };
        for cy in 4..mh - 4 {
            for cx in 4..mw - 4 {
                let square_open =
                    (cy - 4..=cy + 4).all(|y| (cx - 4..=cx + 4).all(|x| open(&map, x, y)));
                if !square_open {
                    continue;
                }
                tried += 1;
                let mut m = map.clone();
                let ci = idx(&m, cx, cy);
                m.terrain[ci] = 5;
                let d = dress(&m, c.hash, rules());
                for y in cy - 4..=cy + 4 {
                    for x in cx - 4..=cx + 4 {
                        let cheb = (x as i64 - cx as i64)
                            .abs()
                            .max((y as i64 - cy as i64).abs());
                        let v = d.ground_variants[idx(&m, x, y)];
                        match cheb {
                            0 => assert_ne!(v, WATER, "the bog tile itself is no water"),
                            1 => assert_eq!(
                                v, WATER,
                                "seed {}: ({x},{y}) next to ({cx},{cy})",
                                c.seed
                            ),
                            2 | 3 => {
                                assert_eq!(v, MUD, "seed {}: ({x},{y}) next to ({cx},{cy})", c.seed)
                            }
                            _ => assert!(
                                v != WATER && v != MUD,
                                "seed {}: ({x},{y}) is beyond the reach",
                                c.seed
                            ),
                        }
                    }
                }
                found = true;
                if tried >= 3 {
                    break 'seeds;
                }
            }
        }
    }
    assert!(
        found,
        "no 9x9 block of open Plague floor on the option-off maps"
    );
}

#[test]
fn no_tall_prop_stands_on_water_and_other_props_are_unchanged() {
    let mut removed_somewhere = false;
    for (label, set) in [
        ("signature", &sig_cases()[..]),
        ("option off", &cases()[..4]),
    ] {
        for c in set {
            let d = dress(&c.map, c.hash, rules());
            let base = dress(&c.map, c.hash, no_marsh_rules());
            let on_water = |p: &rh_mapdress::DressProp| {
                let (tx, ty) = tile_of(p.x, p.y);
                marsh_expect(&c.map, tx, ty) == Some(WATER)
            };
            for p in placed(&d) {
                assert!(
                    !(p.flags & FLAG_TALL != 0 && on_water(&p)),
                    "{label} seed {}: tall prop {p:?} on water",
                    c.seed
                );
            }
            // Legacy props (the generator's own) are carried as they are.
            let legacy_of = |x: &Dressing| -> Vec<_> {
                x.props
                    .iter()
                    .copied()
                    .filter(|p| p.flags & FLAG_LEGACY != 0)
                    .collect()
            };
            assert_eq!(legacy_of(&d), legacy_of(&base), "{label} seed {}", c.seed);
            // Every other prop of today's dressing is still there, unmoved.
            let now = placed(&d);
            for p in placed(&base) {
                if p.flags & FLAG_TALL != 0 && on_water(&p) {
                    removed_somewhere = true;
                    continue;
                }
                assert!(
                    now.contains(&p),
                    "{label} seed {}: prop {p:?} of today's dressing is gone or moved",
                    c.seed
                );
            }
            // New props are allowed: a cluster that lost a tree to the water rule keeps trying until it has its
            // members, so a bush can stand elsewhere (not pinned). Only the zone's props change: other zones are
            // pinned by `every_zone_other_than_plague_is_dressed_as_before`.
        }
    }
    assert!(
        removed_somewhere,
        "the rule is never exercised: no tall prop of today's dressing stands on water"
    );
}

// ---- the other zones are untouched ----------------------------------------------------------------------------------

/// FNV-1a 64 over the wire-shaped rows of every prop whose tile lies in `zone` (output order) and the ground bytes of
/// the tiles of `zone`.
fn zone_hash(map: &GameMapData, d: &Dressing, zone: Zone) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    let mut feed = |b: u8| h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    for p in &d.props {
        let (tx, ty) = tile_of(p.x, p.y);
        if zone_at(map, idx(map, tx, ty)) != Some(zone) {
            continue;
        }
        feed(p.kind);
        p.x.to_le_bytes().into_iter().for_each(&mut feed);
        p.y.to_le_bytes().into_iter().for_each(&mut feed);
        feed(p.variant);
        feed(p.flags);
    }
    for (i, v) in d.ground_variants.iter().enumerate() {
        if zone_at(map, i) == Some(zone) {
            feed(*v);
        }
    }
    h
}

const OTHER_ZONES: [Zone; 4] = [Zone::Fire, Zone::Sentenced, Zone::Frost, Zone::Holy];

/// Golden values: `zone_hash` of seeds 1..=4 (signature on), per zone in `OTHER_ZONES` order, measured on the tree
/// before the change with the shipped rules. Not captured from legacy.
const SIG_GOLDEN: [[u64; 4]; 4] = [
    [
        0x9403d0f50a59e935,
        0xcf3b1ec4d0a8fc1a,
        0x010a5f88859054b0,
        0xffb28d74af914229,
    ],
    [
        0x5a0360892cb452c6,
        0xb5fd8562b4c57aee,
        0x84239d900d25cd69,
        0xd60bd786a01c295e,
    ],
    [
        0x05dd6e7c048f0add,
        0x8a715c8c0a12fc20,
        0x81a3432862a21d0a,
        0x491aa785497599b2,
    ],
    [
        0xe83aec46f0b258eb,
        0xcd9d8f6bf9f9f41d,
        0xf68eed279425d0bf,
        0xd57cdab568696731,
    ],
];
/// The same for the default (option off) maps.
const OFF_GOLDEN: [[u64; 4]; 4] = [
    [
        0x00037e04213c608d,
        0x72d1a8ba1781c4b9,
        0x5a0e502d6937a757,
        0xb4773ea9a8705edb,
    ],
    [
        0xbe5124e9027d5657,
        0xf1663cbd831f0cf0,
        0x577973b18fe8584f,
        0x4a85bff46f4aee8f,
    ],
    [
        0xe7f3f8991c0fcfc7,
        0x7f91c82b5a11b806,
        0x88ac74c296837799,
        0x1a63ce0f6a355453,
    ],
    [
        0xcb3e19ae2fb72f40,
        0xaaa6db3190931165,
        0x5e4a6b710be1e5ac,
        0x76c09c51c96dc8e3,
    ],
];

/// GUARD
#[test]
fn every_zone_other_than_plague_is_dressed_as_before() {
    for (set, golden, label) in [
        (&sig_cases()[..4], &SIG_GOLDEN, "signature"),
        (&cases()[..4], &OFF_GOLDEN, "option off"),
    ] {
        for (c, g) in set.iter().zip(golden) {
            let d = dress(&c.map, c.hash, rules());
            for (zone, want) in OTHER_ZONES.iter().zip(g) {
                assert_eq!(
                    zone_hash(&c.map, &d, *zone),
                    *want,
                    "{label} seed {}: {zone:?}",
                    c.seed
                );
            }
        }
    }
}

// ---- the rule file ----------------------------------------------------------------------------------------------------

fn starter_json() -> Value {
    serde_json::from_str(STARTER).unwrap()
}

fn refused(v: &Value) -> String {
    match Rules::from_json(&v.to_string()) {
        Ok(_) => panic!("a malformed rule file was accepted"),
        Err(e) => e,
    }
}

#[test]
fn the_shipped_file_names_the_two_marsh_rings_for_plague_and_no_other_zone_has_any() {
    let r = rules();
    let z = r.zone(Zone::Plague).unwrap();
    let rings: Vec<_> = z
        .terrain_rings
        .iter()
        .map(|t| (t.name.as_str(), t.around, t.reach, t.ground_variant))
        .collect();
    assert_eq!(
        rings,
        vec![
            ("plague-marsh-water", TileClass::Bog, WATER_REACH, WATER),
            ("plague-marsh-mud", TileClass::Bog, MUD_REACH, MUD),
        ]
    );
    for t in &z.terrain_rings {
        let clash = z
            .rings
            .iter()
            .map(|x| x.ground_variant)
            .chain(
                z.landmark
                    .iter()
                    .flat_map(|l| l.rings.iter().map(|x| x.ground_variant)),
            )
            .any(|v| v == t.ground_variant);
        assert!(
            !clash,
            "{}: variant {} is already a ring's",
            t.name, t.ground_variant
        );
    }
    for zone in [Zone::Fire, Zone::Sentenced, Zone::Frost, Zone::Holy] {
        assert!(r.zone(zone).unwrap().terrain_rings.is_empty(), "{zone:?}");
    }
}

/// GUARD: `terrainRings` is optional (serde default); the file before this packet and the one before the landmark
/// block still parse, with no terrain ring.
#[test]
fn a_file_without_terrain_rings_still_parses() {
    for text in [
        include_str!("fixtures/zones_v1_legacy.json").to_string(),
        serde_json::to_string(&{
            let mut v = starter_json();
            for z in v["zones"].as_object_mut().unwrap().values_mut() {
                z.as_object_mut().unwrap().remove("terrainRings");
            }
            v
        })
        .unwrap(),
    ] {
        let r = Rules::from_json(&text).expect("parses");
        assert!(r.zones.iter().all(|z| z.terrain_rings.is_empty()));
    }
}

fn with_plague_rings(list: Value) -> Value {
    let mut v = starter_json();
    v["zones"]["plague"]["terrainRings"] = list;
    v
}

#[test]
fn a_malformed_terrain_ring_is_refused_naming_the_rule() {
    let ring = |name: &str, around: &str, reach: u32, var: u8| json!({ "name": name, "around": around, "reach": reach, "groundVariant": var });
    // reach 0 covers nothing.
    let e = refused(&with_plague_rings(json!([ring("bad-reach", "bog", 0, 7)])));
    assert!(e.contains("bad-reach"), "{e}");
    // Reaches must grow from the nearest ring to the farthest.
    let e = refused(&with_plague_rings(json!([
        ring("far-first", "bog", 3, 7),
        ring("near-second", "bog", 3, 8)
    ])));
    assert!(e.contains("near-second"), "{e}");
    // Only a terrain class can be ringed: not floor, low or wall.
    for around in ["floor", "low", "wall"] {
        let e = refused(&with_plague_rings(json!([ring(
            "bad-around",
            around,
            1,
            7
        )])));
        assert!(e.contains("bad-around"), "{around}: {e}");
    }
    // A name is used once across the file.
    let e = refused(&with_plague_rings(json!([ring(
        "plague-grove",
        "bog",
        1,
        7
    )])));
    assert!(e.contains("plague-grove"), "{e}");
}

// ---- any zone can use the rule -----------------------------------------------------------------------------------------

#[test]
fn a_terrain_ring_rule_works_for_any_zone_and_terrain_class() {
    let mut v = starter_json();
    v["zones"]["frost"]["terrainRings"] =
        json!([{ "name": "frost-shore", "around": "ice", "reach": 2, "groundVariant": 9 }]);
    let custom = Rules::from_json(&v.to_string()).expect("a Frost ring round ice parses");
    let mut ring_tiles = 0;
    for c in &sig_cases()[..4] {
        let d = dress(&c.map, c.hash, &custom);
        let base = dress(&c.map, c.hash, rules());
        for ty in 0..c.map.h as usize {
            for tx in 0..c.map.w as usize {
                let i = idx(&c.map, tx, ty);
                let want = zone_at(&c.map, i) == Some(Zone::Frost)
                    && class_of(&c.map, i) == TileClass::Floor
                    && near(&c.map, Zone::Frost, TileClass::Ice, tx, ty, 2).is_some();
                if want {
                    assert_eq!(d.ground_variants[i], 9, "seed {} ({tx},{ty})", c.seed);
                    ring_tiles += 1;
                } else {
                    // Plague's marsh and every other tile are as the shipped rules give them.
                    assert_eq!(
                        d.ground_variants[i], base.ground_variants[i],
                        "seed {} ({tx},{ty})",
                        c.seed
                    );
                }
            }
        }
    }
    assert!(
        ring_tiles > 0,
        "Frost has plain floor within two tiles of ice"
    );
}
