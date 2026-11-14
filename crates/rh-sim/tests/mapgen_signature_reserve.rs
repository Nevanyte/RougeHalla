//! Oracle of P-MAPGEN-SIG-RESERVE-1: with the signature option on, the Prefix reserves one site per styled zone before
//! the camps are placed (owner rule G1, 2026-11-12: zones, then each zone's landmark place, then everything arranged
//! round it; owner direction 2026-11-12 late: the landmarks "a lot larger, a little smaller than the temple"). Camps
//! keep out of every site except the church's and the cave's elite camp, drawn inside its site at the far end; each
//! landmark stands inside its site. With the option off nothing moves. No legacy counterpart (DEV-020). Seeds 1-32,
//! option on, each seed's first accepted attempt, generated once per test binary. Numbers: the brief
//! (`docs/backlog/packets/P-MAPGEN-SIG-RESERVE-1.md`, "Measurements").
//!
//! Definitions (tile units; a tile's point is its centre, x + 0.5):
//! * the prefix of an accepted attempt: `attempt::begin_attempt_signature(context, seed, attempt, true)`; its
//!   `state.reserved` are the sites, its `state.partition.zone` the zones (slot = the zone's position in
//!   `state.order` + 1). The finished map must be built on that prefix (its camps are the prefix's camps).
//! * a site: `ReservedSite::rect`; its centre point (x + w / 2, y + h / 2); its inner rect: the rect shrunk by the core
//!   band (`signature::DEFAULT_DEFINITION.bands[0]`, the apron) on every side.
//! * a camp's halo: the certifier's (`certify` "protected"): tiles (camp tile + (dx, dy)), |dx|, |dy| <=
//!   `R.protection_span`, for which some |ox|, |oy| <= `R.halo` has (dx + ox)^2 + (dy + oy)^2 <= `R.clearing`^2.
//! * a zone's centroid distance: the distance from the map centre (w / 2, h / 2) of the mean point of the zone's prefix
//!   tiles.
//! * the site's far half: the points p of the site with (p - centre) . (coliseum point - centre) < 0.
//! * a camp's nearest-neighbour distance: the distance to the nearest other camp of its zone (camp points, tiles); a
//!   zone's spread: the root mean square distance of its camps from their mean point.
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::landmarks::signature::{ReservedSite, DEFAULT_DEFINITION};
use rh_sim::mapgen::zones::camps;
use rh_sim::mapgen::{attempt, certify, coliseum, map_hash, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

#[path = "support/signature_pins.rs"]
mod pins;

type Cell = (i32, i32);

// ---------------------------------------------------------------------------------------------------------------------
// The numbers (functions, not consts: `tests/content.rs` reads consts as unregistered tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// The least side of a reserved site: the SCALE packets' landmark target (30) plus the apron (2) on each side.
fn site_side() -> u32 {
    34
}

/// The zones that reserve a site, in the order of `AttemptState::reserved` (Holy keeps its hall rule until
/// P-MAPGEN-SIG-HOLY-1).
fn styled() -> [Zone; 4] {
    [Zone::Fire, Zone::Sentenced, Zone::Plague, Zone::Frost]
}

/// How far beyond the zone's centroid distance the Fire, Sentenced and Frost sites' centres stand (the brief's rule is
/// 2 tiles on the generator's own integer geometry; 1 here).
fn back_edge_slack() -> f64 {
    1.0
}

/// The least pooled mean nearest-neighbour distance of a zone's camps over seeds 1-32 (today 20.3-20.5; the brief's
/// prototype 18.6-20.4; with the legacy elite rule kept, Sentenced 16.9-17.5).
fn nearest_mean_min() -> f64 {
    17.0
}

/// The least pooled mean spread of a zone's camps over seeds 1-32 (today 30.4-32.8; prototype 30.4-34.5; with the
/// legacy elite rule kept, Sentenced and Frost 27.0-27.4: camps crowded toward the centre).
fn spread_mean_min() -> f64 {
    29.0
}

/// The attempts `certified_styled` may use.
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index allowed over seeds 1-32 (prototype 4, today 3; plus 3).
fn worst_attempt_allowed() -> u64 {
    7
}

/// The most attempts seeds 1-32 may use in all (prototype 54, today 43).
fn attempts_allowed() -> u64 {
    70
}

/// The longest floor path from the cave's mouth to the zone's largest unowned ice body (`mapgen_signature_frost_lake.rs`).
fn mouth_to_lake() -> usize {
    DEFAULT_DEFINITION.lake_reach + 2
}

// ---------------------------------------------------------------------------------------------------------------------
// Maps.
// ---------------------------------------------------------------------------------------------------------------------

fn on_options() -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature: true,
        ..pipeline::Options::default()
    }
}

/// One seed's outcome: the attempt that gave the map, the map, and that attempt's prefix.
struct Landed {
    seed: i64,
    attempt: u64,
    map: GameMapData,
    prefix: attempt::AttemptState,
}

fn on_maps() -> &'static Vec<(i64, Option<Landed>)> {
    static MAPS: OnceLock<Vec<(i64, Option<Landed>)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let context = attempt::AttemptContext::new(&fixed);
        (1..=32)
            .map(|seed| {
                let landed = (0..attempt_limit()).find_map(|n| {
                    let map = generator
                        .styled_attempt(seed, n, on_options())
                        .expect("generator error")?;
                    let prefix = attempt::begin_attempt_signature(&context, seed, n, true)
                        .expect("prefix input")
                        .expect("an accepted attempt has a prefix")
                        .state;
                    Some(Landed {
                        seed,
                        attempt: n,
                        map,
                        prefix,
                    })
                });
                (seed, landed)
            })
            .collect()
    })
}

fn maps() -> impl Iterator<Item = &'static Landed> {
    on_maps().iter().map(|(seed, l)| {
        l.as_ref().unwrap_or_else(|| {
            panic!(
                "seed {seed}: no map in {} attempts with the option on",
                attempt_limit()
            )
        })
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------------

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn world_cell(x: f64, y: f64) -> Cell {
    ((x / R.tile).floor() as i32, (y / R.tile).floor() as i32)
}

fn tile_cell(i: usize) -> Cell {
    ((i % coliseum::W) as i32, (i / coliseum::W) as i32)
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1)).sqrt()
}

fn of_kind(m: &GameMapData, kind: FeatureKind) -> Vec<usize> {
    (0..m.features.len())
        .filter(|&k| m.features[k].kind == kind)
        .collect()
}

fn single(seed: i64, m: &GameMapData, kind: FeatureKind, zone: Zone) -> usize {
    let ks = of_kind(m, kind);
    assert_eq!(ks.len(), 1, "seed {seed}: {} {kind:?} features", ks.len());
    assert_eq!(m.features[ks[0]].zone, zone, "seed {seed}: {kind:?} zone");
    ks[0]
}

/// (x0, y0, x1, y1) of `r` grown by `by` (negative shrinks).
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

fn halo_of(t: Cell) -> Vec<Cell> {
    let s = R.protection_span;
    let mut out = Vec::new();
    for dy in -s..=s {
        for dx in -s..=s {
            let near = (-R.halo..=R.halo).any(|oy| {
                (-R.halo..=R.halo).any(|ox| {
                    f64::from((dx + ox).pow(2) + (dy + oy).pow(2)) <= R.clearing * R.clearing
                })
            });
            if near {
                out.push((t.0 + dx, t.1 + dy));
            }
        }
    }
    out
}

/// The zone's prefix slot (1-based position in the faction order).
fn slot(l: &Landed, zone: Zone) -> u8 {
    l.prefix
        .order
        .iter()
        .position(|f| f.as_str() == zone.as_str())
        .map(|s| (s + 1) as u8)
        .unwrap_or_else(|| panic!("seed {}: {zone:?} not in the faction order", l.seed))
}

/// The four reserved sites in `styled()` order; panics (the red of this oracle today) when they are not there.
fn sites(l: &Landed) -> &[ReservedSite] {
    let zones: Vec<Zone> = l.prefix.reserved.iter().map(|r| r.zone).collect();
    assert_eq!(
        zones,
        styled(),
        "seed {} (attempt {}): reserved sites",
        l.seed,
        l.attempt
    );
    &l.prefix.reserved
}

fn site_centre(r: TileRect) -> (f64, f64) {
    (
        f64::from(r.x) + f64::from(r.w) / 2.0,
        f64::from(r.y) + f64::from(r.h) / 2.0,
    )
}

fn map_centre(m: &GameMapData) -> (f64, f64) {
    (f64::from(m.w) / 2.0, f64::from(m.h) / 2.0)
}

/// The distance from the map centre of the mean point of the zone's prefix tiles.
fn centroid_distance(l: &Landed, zone: Zone) -> f64 {
    let s = slot(l, zone);
    let (mut sx, mut sy, mut n) = (0.0, 0.0, 0.0);
    for (i, &z) in l.prefix.partition.zone.iter().enumerate() {
        if z == s {
            let c = tile_cell(i);
            sx += f64::from(c.0) + 0.5;
            sy += f64::from(c.1) + 0.5;
            n += 1.0;
        }
    }
    dist((sx / n, sy / n), map_centre(&l.map))
}

// ---------------------------------------------------------------------------------------------------------------------
// The reservation (red today: no site is reserved).
// ---------------------------------------------------------------------------------------------------------------------

/// Every styled zone has a site of at least `site_side()` a side, wholly in its zone; Fire, Sentenced and Frost on the
/// back edge (centre at least `back_edge_slack()` beyond the zone's centroid distance), Plague at least at its
/// centroid distance (its outer third where a site fits there: the brief); a camp tile for the church and the cave
/// only.
#[test]
fn every_styled_zone_reserves_a_site_on_its_rule() {
    for l in maps() {
        for r in sites(l) {
            let seed = l.seed;
            assert!(
                r.rect.w >= site_side() && r.rect.h >= site_side(),
                "seed {seed}: {:?} site {:?} under {} a side",
                r.zone,
                r.rect,
                site_side()
            );
            let s = slot(l, r.zone);
            let (x0, y0, x1, y1) = grow(r.rect, 0);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let i = at(&l.map, (x, y)).unwrap_or_else(|| {
                        panic!("seed {seed}: {:?} site {:?} leaves the map", r.zone, r.rect)
                    });
                    assert_eq!(
                        l.prefix.partition.zone[i], s,
                        "seed {seed}: {:?} site tile ({x}, {y}) outside its zone",
                        r.zone
                    );
                }
            }
            let d = dist(site_centre(r.rect), map_centre(&l.map));
            let c = centroid_distance(l, r.zone);
            let need = if r.zone == Zone::Plague {
                c
            } else {
                c + back_edge_slack()
            };
            assert!(
                d >= need,
                "seed {seed}: {:?} site centre {d:.1} from the map centre, the zone's centroid {c:.1}",
                r.zone
            );
            assert_eq!(
                r.camp.is_some(),
                matches!(r.zone, Zone::Sentenced | Zone::Frost),
                "seed {seed}: {:?} site camp {:?}",
                r.zone,
                r.camp
            );
        }
    }
}

/// No camp's halo meets any reserved site, except the camp drawn inside the church's or the cave's site, whose whole
/// halo lies in its own site.
#[test]
fn no_camp_halo_touches_a_site_but_its_own_camp() {
    for l in maps() {
        let ss = sites(l);
        for c in &l.map.camps {
            let t = world_cell(c.x, c.y);
            let own = ss
                .iter()
                .find(|r| r.camp.map(tile_cell) == Some(t) && r.zone == c.zone);
            for h in halo_of(t) {
                for r in ss {
                    let in_site = inside(grow(r.rect, 0), h);
                    match own {
                        Some(o) if std::ptr::eq(o, r) => {}
                        _ => assert!(
                            !in_site,
                            "seed {}: halo tile {h:?} of the {:?} camp at {t:?} in the {:?} site {:?}",
                            l.seed, c.zone, r.zone, r.rect
                        ),
                    }
                }
                if let Some(o) = own {
                    assert!(
                        inside(grow(o.rect, 0), h),
                        "seed {}: halo tile {h:?} of the {:?} site's camp leaves its site",
                        l.seed,
                        o.zone
                    );
                }
            }
        }
    }
}

/// The church's and the cave's camp: a camp of the map, elite, in its site's far half (away from the coliseum), and
/// the camp the landmark is built round (the anchor's centre).
#[test]
fn the_church_and_cave_camp_is_an_elite_in_the_far_half_of_its_site() {
    for l in maps() {
        let m = &l.map;
        let col = (m.coliseum.centre.x / R.tile, m.coliseum.centre.y / R.tile);
        for r in sites(l).iter().filter(|r| r.camp.is_some()) {
            let t = tile_cell(r.camp.unwrap());
            let camp = m
                .camps
                .iter()
                .find(|c| c.zone == r.zone && world_cell(c.x, c.y) == t)
                .unwrap_or_else(|| {
                    panic!(
                        "seed {}: no {:?} camp at the site's camp tile {t:?}",
                        l.seed, r.zone
                    )
                });
            assert!(
                camp.elite_spot >= 0,
                "seed {}: the {:?} site's camp is not elite",
                l.seed,
                r.zone
            );
            let c = site_centre(r.rect);
            let p = (f64::from(t.0) + 0.5, f64::from(t.1) + 0.5);
            let dot = (p.0 - c.0) * (col.0 - c.0) + (p.1 - c.1) * (col.1 - c.1);
            assert!(
                dot < 0.0,
                "seed {}: the {:?} camp {t:?} is not in its site's far half (site {:?})",
                l.seed,
                r.zone,
                r.rect
            );
            let a = m
                .anchors
                .iter()
                .find(|a| a.zone == r.zone)
                .unwrap_or_else(|| panic!("seed {}: no {:?} anchor", l.seed, r.zone));
            assert_eq!(
                (a.centre.x, a.centre.y),
                t,
                "seed {}: the {:?} landmark is not built round its site's camp",
                l.seed,
                r.zone
            );
        }
    }
}

/// Each landmark's footprint (the zone anchor's) lies in its site's inner rect: the apron stays inside the site.
#[test]
fn each_landmark_footprint_lies_inside_its_site() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        for r in sites(l) {
            let a = l
                .map
                .anchors
                .iter()
                .find(|a| a.zone == r.zone)
                .unwrap_or_else(|| panic!("seed {}: no {:?} anchor", l.seed, r.zone));
            let inner = grow(r.rect, -b);
            let f = grow(a.footprint, 0);
            assert!(
                inside(inner, (f.0, f.1)) && inside(inner, (f.2, f.3)),
                "seed {}: {:?} footprint {:?} not inside its site's inner rect {inner:?}",
                l.seed,
                r.zone,
                a.footprint
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// ---------------------------------------------------------------------------------------------------------------------

/// The finished map is built on the prefix `begin_attempt_signature` gives for its attempt: the same camps.
#[test]
fn the_map_is_built_on_the_reserving_prefix() {
    for l in maps() {
        let from_map: Vec<(Zone, Cell)> = l
            .map
            .camps
            .iter()
            .map(|c| (c.zone, world_cell(c.x, c.y)))
            .collect();
        let mut from_prefix: Vec<Cell> = l
            .prefix
            .layout
            .camps
            .iter()
            .map(|c| tile_cell(c.site))
            .collect();
        let mut map_cells: Vec<Cell> = from_map.iter().map(|c| c.1).collect();
        from_prefix.sort();
        map_cells.sort();
        assert_eq!(
            map_cells, from_prefix,
            "seed {} (attempt {}): the map's camps are not the prefix's",
            l.seed, l.attempt
        );
    }
}

/// Every zone keeps today's camp count; camps are not crowded: pooled over seeds 1-32 each zone's mean
/// nearest-neighbour distance is at least `nearest_mean_min()` and its mean spread at least `spread_mean_min()`; no
/// two camps of a zone closer than the camp gap.
#[test]
fn camps_per_zone_keep_todays_count_and_spread() {
    let gap = camps::DEFAULT_DEFINITION.camp_gap;
    let zones = [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ];
    let mut nn: Vec<Vec<f64>> = vec![Vec::new(); zones.len()];
    let mut spread: Vec<Vec<f64>> = vec![Vec::new(); zones.len()];
    for l in maps() {
        for (k, z) in zones.iter().enumerate() {
            let pts: Vec<(f64, f64)> = l
                .map
                .camps
                .iter()
                .filter(|c| c.zone == *z)
                .map(|c| (c.x / R.tile, c.y / R.tile))
                .collect();
            assert_eq!(
                pts.len(),
                camps::DEFAULT_DEFINITION.camps_per_zone,
                "seed {}: {z:?} camps",
                l.seed
            );
            for (i, p) in pts.iter().enumerate() {
                let d = pts
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, q)| dist(*p, *q))
                    .fold(f64::MAX, f64::min);
                assert!(
                    d + 1e-9 >= gap,
                    "seed {}: two {z:?} camps {d:.1} apart",
                    l.seed
                );
                nn[k].push(d);
            }
            let n = pts.len() as f64;
            let mean = (
                pts.iter().map(|p| p.0).sum::<f64>() / n,
                pts.iter().map(|p| p.1).sum::<f64>() / n,
            );
            let ms = pts
                .iter()
                .map(|p| {
                    let d = dist(*p, mean);
                    d * d
                })
                .sum::<f64>()
                / n;
            spread[k].push(ms.sqrt());
        }
    }
    for (k, z) in zones.iter().enumerate() {
        let nm = nn[k].iter().sum::<f64>() / nn[k].len() as f64;
        let sm = spread[k].iter().sum::<f64>() / spread[k].len() as f64;
        assert!(
            nm >= nearest_mean_min(),
            "{z:?}: mean nearest-neighbour distance {nm:.1}"
        );
        assert!(sm >= spread_mean_min(), "{z:?}: mean spread {sm:.1}");
    }
}

/// Every seed keeps all four signature landmarks and the Holy anchor and certifies with zero failures under the
/// strictest settings (elite selection, spawn-walk ratio, routes and camps included).
#[test]
fn every_zone_keeps_its_landmark_and_every_map_certifies_clean() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        single(seed, m, FeatureKind::Volcano, Zone::Fire);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
        single(seed, m, FeatureKind::Graveyard, Zone::Sentenced);
        single(seed, m, FeatureKind::BogTree, Zone::Plague);
        single(seed, m, FeatureKind::Cave, Zone::Frost);
        assert!(
            m.anchors.iter().any(|a| a.zone == Zone::Holy),
            "seed {seed}: no Holy anchor"
        );
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
    }
}

/// The lake rule (P-MAPGEN-SIG-FROST-2): the Frost zone's largest unowned ice body is at most `mouth_to_lake()` floor
/// steps from the cave's mouth. The apron rule: no tile of one landmark lies in another's box grown by the core band
/// (the volcano's streams and pools count as its tiles but have no box apron; the Holy hall is the Holy anchor's
/// `Hall`).
#[test]
fn the_lake_and_apron_rules_hold() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let cave = single(seed, m, FeatureKind::Cave, Zone::Frost);
        let frost = m.anchors.iter().find(|a| a.zone == Zone::Frost).unwrap();
        let mouth: Vec<Cell> = frost.entrance.iter().map(|p| (p.x, p.y)).collect();
        let ice: BTreeSet<Cell> = (0..m.tiles.len())
            .filter(|&i| {
                m.region_grid[i] == Zone::Frost.code()
                    && m.tiles[i] == 0
                    && m.terrain[i] == DEFAULT_DEFINITION.ice
                    && usize::from(m.feature_grid[i]) != cave + 1
            })
            .map(tile_cell)
            .collect();
        if let Some(body) = largest_body(&ice) {
            let steps = floor_steps(m, &mouth, &body);
            assert!(
                steps.is_some_and(|s| s <= mouth_to_lake()),
                "seed {seed}: largest ice body ({} tiles) {steps:?} floor steps from the mouth",
                body.len()
            );
        }
        let holy = m
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Holy)
            .map(|a| a.footprint);
        let host = |k: usize| -> Option<u8> {
            let f = &m.features[k];
            match f.kind {
                FeatureKind::Volcano | FeatureKind::LavaStream | FeatureKind::LavaPool => Some(0),
                FeatureKind::Church | FeatureKind::Graveyard => Some(1),
                FeatureKind::BogTree => Some(2),
                FeatureKind::Cave => Some(3),
                FeatureKind::Hall if f.zone == Zone::Holy && Some(f.bbox) == holy => Some(4),
                _ => None,
            }
        };
        for (k, f) in m.features.iter().enumerate() {
            let Some(h) = host(k) else { continue };
            if matches!(f.kind, FeatureKind::LavaStream | FeatureKind::LavaPool) {
                continue;
            }
            let (x0, y0, x1, y1) = grow(f.bbox, b);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let Some(i) = at(m, (x, y)) else { continue };
                    let Some(g) = usize::from(m.feature_grid[i]).checked_sub(1) else {
                        continue;
                    };
                    if let Some(guest) = host(g) {
                        assert_eq!(
                            guest, h,
                            "seed {seed}: ({x}, {y}) of landmark {guest} in the apron of landmark {h}"
                        );
                    }
                }
            }
        }
    }
}

fn largest_body(cells: &BTreeSet<Cell>) -> Option<BTreeSet<Cell>> {
    let mut seen = BTreeSet::new();
    let mut best: Option<BTreeSet<Cell>> = None;
    let mut ordered: Vec<Cell> = cells.iter().copied().collect();
    ordered.sort_by_key(|c| (c.1, c.0));
    for s in ordered {
        if !seen.insert(s) {
            continue;
        }
        let mut body = BTreeSet::from([s]);
        let mut stack = vec![s];
        while let Some((x, y)) = stack.pop() {
            for n in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                if cells.contains(&n) && seen.insert(n) {
                    body.insert(n);
                    stack.push(n);
                }
            }
        }
        if best.as_ref().is_none_or(|b| body.len() > b.len()) {
            best = Some(body);
        }
    }
    best
}

fn floor_steps(m: &GameMapData, from: &[Cell], to: &BTreeSet<Cell>) -> Option<usize> {
    let mut seen = vec![false; m.tiles.len()];
    let mut queue = VecDeque::new();
    for &s in from {
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == 0) {
            seen[i] = true;
            queue.push_back((s, 0));
        }
    }
    while let Some((c, d)) = queue.pop_front() {
        if to.contains(&c) {
            return Some(d);
        }
        for n in [
            (c.0 + 1, c.1),
            (c.0 - 1, c.1),
            (c.0, c.1 + 1),
            (c.0, c.1 - 1),
        ] {
            if let Some(i) = at(m, n).filter(|&i| !seen[i] && m.tiles[i] == 0) {
                seen[i] = true;
                queue.push_back((n, d + 1));
            }
        }
    }
    None
}

/// Option off: seeds 1-8 give today's maps byte for byte; and the prefix with the flag off is `begin_attempt`'s, with
/// no site (seeds 1-8, attempts 0-2: not one main-stream draw added, removed or reordered).
#[test]
fn option_off_is_todays_generator() {
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
    let context = attempt::AttemptContext::new(&fixed);
    for seed in 1..=8 {
        for n in 0..3 {
            let plain = attempt::begin_attempt(&context, seed, n).unwrap();
            let off = attempt::begin_attempt_signature(&context, seed, n, false).unwrap();
            assert_eq!(
                off, plain,
                "seed {seed} attempt {n}: prefix with the flag off"
            );
            if let Some(f) = off {
                assert!(
                    f.state.reserved.is_empty(),
                    "seed {seed}: sites with the flag off"
                );
            }
        }
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

/// The worst attempt index over seeds 1-32 stays within `worst_attempt_allowed()`.
#[test]
fn the_worst_attempt_stays_within_the_bound() {
    let worst = maps().map(|l| (l.attempt, l.seed)).max().unwrap();
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {}: attempt {} (allowed {})",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// The attempts seeds 1-32 use in all stay within `attempts_allowed()`.
#[test]
fn the_attempts_used_stay_within_the_bound() {
    let used: u64 = maps().map(|l| l.attempt + 1).sum();
    assert!(
        used <= attempts_allowed(),
        "{used} attempts over seeds 1-32 (allowed {})",
        attempts_allowed()
    );
}

/// The report (run with `--ignored --nocapture`; `time` the run): seeds 1-64, the attempt each lands on and its sites.
#[test]
#[ignore]
fn report_seeds_1_to_64() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let context = attempt::AttemptContext::new(&fixed);
    let mut worst = (0, 0);
    for seed in 1..=64 {
        let n = (0..attempt_limit())
            .find(|&n| {
                generator
                    .styled_attempt(seed, n, on_options())
                    .unwrap()
                    .is_some()
            })
            .unwrap_or_else(|| panic!("seed {seed}: no map"));
        let f = attempt::begin_attempt_signature(&context, seed, n, true)
            .unwrap()
            .unwrap();
        let s: Vec<String> = f
            .state
            .reserved
            .iter()
            .map(|r| format!("{:?} {:?} camp {:?}", r.zone, r.rect, r.camp.map(tile_cell)))
            .collect();
        eprintln!("seed {seed}: attempt {n}, sites {s:?}");
        worst = worst.max((n, seed));
    }
    eprintln!("worst attempt: {} (seed {})", worst.0, worst.1);
}
