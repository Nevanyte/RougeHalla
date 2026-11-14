//! Oracle of P-MAPGEN-SIG-FIRE-2: in signature mode the Fire styler chooses each crater's size from its camp's band
//! round the volcano (owner rule G4, 2026-11-12: "distance bands from the landmark choose the obstacle family and size;
//! density and size fall with distance"), and every lava stream stays two tiles wide along its whole path, bends
//! included. No legacy counterpart (DEV-020): the owner's rules as checks on real maps, seeds 1-32, option on and off,
//! generated once per test binary; the stream width is also checked on the Landmarks phase alone over seeds 1-100.
//!
//! Definitions (tile units):
//! * Fire camp: a `map.camps` entry with zone Fire; its tile is (floor(x / 32), floor(y / 32)); it is elite when
//!   `elite_spot >= 0` (`records/mod.rs`, `CampDef`). A crater belongs to the camp whose tile is its anchor point
//!   (`ax`, `ay`); its radius is `p[1]` (quarter tiles, `style_scorch/craters.rs`, the feature's params).
//! * radius options of a camp: the list the styler builds before it draws a crater (`style_scorch/craters.rs:111-117`):
//!   R, R - 4, R - 8 (`CraterRules::radius_shrink4`), keeping those >= `radius_min4`, largest first, where R is
//!   `search_family::scorch::radius4` over the zone's camps: floor(2 * dist(nearest other Fire camp) - radius_subtract)
//!   clamped to [radius_min4, radius_max4] (radius_elite_max4 for an elite camp), recomputed here from the public
//!   definitions. On seeds 1-32 the sets are [26, 22] (non-elite) and [30, 26, 22] (elite).
//! * camp distance dc: the Chebyshev distance from the camp tile to the Fire anchor's footprint, as
//!   `signature::band` measures it.
//! * a camp's band (fixed before any pen is drawn, so it cannot depend on the size it chooses): the band of the
//!   distance the camp's largest pen nominally reaches toward the volcano, dc - ceil(R / 4), against the band table
//!   (`signature::DEFAULT_DEFINITION.bands`: core <= 2, near <= 6, mid <= 14, far beyond).
//! * the band's radius: near, the largest option; mid, the second option (the smallest when there is one only); far,
//!   the smallest. Core (the largest pen would reach the core band): any option, the largest that keeps out of it.
//!   A camp may have no crater (the route and rim checks refuse it, as legacy allows); the count floor bounds that.
//! * crater size (for the means): the crater feature's tile count (`MapFeature::tiles`).
//! * a stream's lava: the lava tiles (tile 2, terrain 1) its feature owns. A stream is two tiles wide when, over its own
//!   lava: (a) no tile is a neck: a tile whose run of stream lava along one axis is 1 while its run along the other
//!   axis is 3 or more (a one-tile line, straight or bent); and (b) every tile lies in a 2x2 window holding at least 3
//!   stream lava tiles (no diagonal single-tile chain). A straight stream two tiles across, a 45-degree staircase of
//!   pairs and its ends all pass both; a stream whose side cell is fixed while its heading crosses a diagonal does not.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::recipes::search_family::scorch;
use rh_sim::mapgen::landmarks::signature::{band, Band, SignatureContext, DEFAULT_DEFINITION};
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, coliseum, pipeline, style_scorch};
use std::collections::BTreeSet;
use std::sync::OnceLock;

const TILE: f64 = 32.0;
const T_LOW: u8 = 2;
const LAVA: u8 = 1;
const SEEDS: std::ops::RangeInclusive<i64> = 1..=32;
/// The near band's mean crater size must exceed the far band's by this factor (pooled over seeds 1-32).
const NEAR_OVER_FAR: f64 = 1.15;

type Cell = (i32, i32);

fn options(signature: bool) -> pipeline::Options {
    pipeline::Options {
        decor: false,
        signature,
        ..pipeline::Options::default()
    }
}

fn generate(signature: bool) -> Vec<(i64, Option<GameMapData>)> {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    SEEDS
        .map(|seed| {
            let map = generator
                .certified_styled(seed, options(signature))
                .expect("generator error");
            (seed, map)
        })
        .collect()
}

fn on_maps() -> &'static Vec<(i64, Option<GameMapData>)> {
    static MAPS: OnceLock<Vec<(i64, Option<GameMapData>)>> = OnceLock::new();
    MAPS.get_or_init(|| generate(true))
}

fn off_maps() -> &'static Vec<(i64, Option<GameMapData>)> {
    static MAPS: OnceLock<Vec<(i64, Option<GameMapData>)>> = OnceLock::new();
    MAPS.get_or_init(|| generate(false))
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

fn maps() -> impl Iterator<Item = (i64, &'static GameMapData)> {
    each(on_maps())
}

fn off(seed: i64) -> &'static GameMapData {
    each(off_maps())
        .find(|(s, _)| *s == seed)
        .map(|(_, m)| m)
        .expect("option-off map")
}

fn cell(w: u32, i: usize) -> Cell {
    ((i as i32) % w as i32, (i as i32) / w as i32)
}

fn anchor(seed: i64, m: &GameMapData) -> &ZoneAnchor {
    m.anchors
        .iter()
        .find(|a| a.zone == Zone::Fire)
        .unwrap_or_else(|| panic!("seed {seed}: no Fire anchor"))
}

/// Chebyshev distance from a tile to the anchor's footprint (0 inside), as `signature::band` measures it.
fn footprint_distance(a: &ZoneAnchor, c: Cell) -> i32 {
    let f = a.footprint;
    let (x1, y1) = (f.x + f.w as i32 - 1, f.y + f.h as i32 - 1);
    (f.x - c.0)
        .max(c.0 - x1)
        .max(0)
        .max((f.y - c.1).max(c.1 - y1).max(0))
}

fn band_of_distance(d: i32) -> Band {
    let b = DEFAULT_DEFINITION.bands;
    if d <= b[0] {
        Band::Core
    } else if d <= b[1] {
        Band::Near
    } else if d <= b[2] {
        Band::Mid
    } else {
        Band::Far
    }
}

/// One Fire camp as the band rule sees it.
#[derive(Debug)]
struct Camp {
    tile: Cell,
    dc: i32,
    options: Vec<i32>,
    band: Band,
    /// The crater feature on this camp, if any.
    crater: Option<usize>,
}

impl Camp {
    /// The band's radius (quarter tiles); `None` for the core band (any option).
    fn target(&self) -> Option<i32> {
        let o = &self.options;
        match self.band {
            Band::Core => None,
            Band::Near => Some(o[0]),
            Band::Mid => Some(o[1.min(o.len() - 1)]),
            Band::Far => Some(o[o.len() - 1]),
        }
    }
}

/// The Fire camps of an option-on map with their options, distance, band and crater.
fn fire_camps(seed: i64, m: &GameMapData) -> Vec<Camp> {
    let forge = scorch::default_definition();
    let shrink = style_scorch::default_definition().crater.radius_shrink4;
    let a = anchor(seed, m);
    let tiles: Vec<(Cell, bool)> = m
        .camps
        .iter()
        .filter(|c| c.zone == Zone::Fire)
        .map(|c| {
            (
                ((c.x / TILE).floor() as i32, (c.y / TILE).floor() as i32),
                c.elite_spot >= 0,
            )
        })
        .collect();
    tiles
        .iter()
        .enumerate()
        .map(|(q, &(t, elite))| {
            let hi = if elite {
                forge.radius_elite_max4
            } else {
                forge.radius_max4
            };
            let near2 = tiles
                .iter()
                .enumerate()
                .filter(|&(p, _)| p != q)
                .map(|(_, &(o, _))| f64::from((t.0 - o.0).pow(2) + (t.1 - o.1).pow(2)))
                .reduce(f64::min);
            let r = match near2 {
                None => hi,
                Some(v) => (2.0 * rh_sim::math::sqrt(v) - forge.radius_subtract)
                    .floor()
                    .max(forge.radius_min4)
                    .min(hi),
            } as i32;
            let mut options = vec![r];
            for s in shrink {
                if f64::from(r - s) >= forge.radius_min4 {
                    options.push(r - s);
                }
            }
            let dc = footprint_distance(a, t);
            let crater = (0..m.features.len()).find(|&k| {
                let f = &m.features[k];
                f.kind == FeatureKind::Crater && f.zone == Zone::Fire && (f.ax, f.ay) == t
            });
            Camp {
                tile: t,
                dc,
                band: band_of_distance(dc - (r + 3) / 4),
                options,
                crater,
            }
        })
        .collect()
}

fn fire_craters(m: &GameMapData) -> Vec<usize> {
    (0..m.features.len())
        .filter(|&k| m.features[k].kind == FeatureKind::Crater && m.features[k].zone == Zone::Fire)
        .collect()
}

fn radius(m: &GameMapData, k: usize) -> i32 {
    m.features[k].p[1]
}

// --------------------------------------------------------------------------------------------------------------------
// G4 by construction: each crater's size is its camp's band's radius option.
// --------------------------------------------------------------------------------------------------------------------

/// Every Fire crater stands on a Fire camp; its radius is one of the camp's options and, outside the core band,
/// exactly the band's option: near the largest, mid the second, far the smallest.
#[test]
fn craters_take_their_bands_radius_option() {
    let mut bad = Vec::new();
    let mut per_band = [[0usize; 2]; 4];
    for (seed, m) in maps() {
        let camps = fire_camps(seed, m);
        for k in fire_craters(m) {
            assert!(
                camps.iter().any(|c| c.crater == Some(k)),
                "seed {seed}: crater {k} at ({}, {}) stands on no Fire camp",
                m.features[k].ax,
                m.features[k].ay
            );
        }
        for c in &camps {
            let b = c.band as usize;
            per_band[b][0] += 1;
            let Some(k) = c.crater else { continue };
            per_band[b][1] += 1;
            let used = radius(m, k);
            let ok = match c.target() {
                None => c.options.contains(&used),
                Some(t) => used == t,
            };
            if !ok {
                bad.push(format!(
                    "seed {seed} camp {:?} dc {} {:?} options {:?} target {:?} used {used}",
                    c.tile,
                    c.dc,
                    c.band,
                    c.options,
                    c.target()
                ));
            }
        }
    }
    eprintln!("camps / craters per band (core, near, mid, far): {per_band:?}");
    assert!(
        bad.is_empty(),
        "{} craters off their band's radius option; first {:#?}",
        bad.len(),
        &bad[..bad.len().min(12)]
    );
}

/// Size falls with distance: pooled over seeds 1-32 the near band's craters (core and near camps) average at least
/// 15 percent more tiles than the far band's; and on every map no near-band crater has a smaller radius than a far-band
/// crater of the same option set.
#[test]
fn near_band_craters_are_larger_than_far_band_ones() {
    let (mut near, mut far) = (Vec::new(), Vec::new());
    let mut bad = Vec::new();
    for (seed, m) in maps() {
        let camps = fire_camps(seed, m);
        for c in &camps {
            let Some(k) = c.crater else { continue };
            let size = f64::from(m.features[k].tiles);
            match c.band {
                Band::Core | Band::Near => near.push(size),
                Band::Far => far.push(size),
                Band::Mid => {}
            }
        }
        for a in camps
            .iter()
            .filter(|c| matches!(c.band, Band::Core | Band::Near))
        {
            for b in camps.iter().filter(|c| c.band == Band::Far) {
                let (Some(ka), Some(kb)) = (a.crater, b.crater) else {
                    continue;
                };
                if a.options == b.options && radius(m, ka) < radius(m, kb) {
                    bad.push(format!(
                        "seed {seed}: near camp {:?} radius {} < far camp {:?} radius {} (options {:?})",
                        a.tile,
                        radius(m, ka),
                        b.tile,
                        radius(m, kb),
                        a.options
                    ));
                }
            }
        }
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    eprintln!(
        "crater tiles: near band {} (mean {:.1}), far band {} (mean {:.1})",
        near.len(),
        mean(&near),
        far.len(),
        mean(&far)
    );
    assert!(
        !near.is_empty() && !far.is_empty(),
        "no near or no far craters"
    );
    assert!(
        bad.is_empty(),
        "{} near/far pairs out of order; first {:#?}",
        bad.len(),
        &bad[..bad.len().min(8)]
    );
    assert!(
        mean(&near) >= NEAR_OVER_FAR * mean(&far),
        "near-band craters average {:.1} tiles, far-band {:.1}: less than {NEAR_OVER_FAR}x",
        mean(&near),
        mean(&far)
    );
}

/// No crater tile in the volcano's core band, and every map keeps at least its option-off crater count minus two
/// (the distribution of on - off is printed). A guard: it holds today and must keep holding.
#[test]
fn no_crater_in_the_core_and_the_crater_count_holds() {
    let mut deltas = Vec::new();
    for (seed, m) in maps() {
        let a = anchor(seed, m);
        let craters = fire_craters(m);
        for &k in &craters {
            for i in (0..m.feature_grid.len()).filter(|&i| usize::from(m.feature_grid[i]) == k + 1)
            {
                let c = cell(m.w, i);
                assert_ne!(
                    band(a, c.0, c.1),
                    Band::Core,
                    "seed {seed}: crater {k} at ({}, {}) has tile {c:?} in the core band",
                    m.features[k].ax,
                    m.features[k].ay
                );
            }
        }
        let before = fire_craters(off(seed)).len();
        deltas.push((seed, craters.len() as i64 - before as i64));
        assert!(
            craters.len() + 2 >= before,
            "seed {seed}: {} craters, {before} with the option off",
            craters.len()
        );
    }
    eprintln!("crater count on - off per seed: {deltas:?}");
}

// --------------------------------------------------------------------------------------------------------------------
// Streams two tiles wide.
// --------------------------------------------------------------------------------------------------------------------

/// The tiles of `cells` that break the two-wide rule (header definitions (a) and (b)).
fn thin_tiles(cells: &[Cell]) -> Vec<Cell> {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let has = |c: Cell| set.contains(&c);
    let run = |c: Cell, d: Cell| {
        let mut n = 1;
        for s in [1, -1] {
            let mut p = (c.0 + s * d.0, c.1 + s * d.1);
            while has(p) {
                n += 1;
                p = (p.0 + s * d.0, p.1 + s * d.1);
            }
        }
        n
    };
    cells
        .iter()
        .copied()
        .filter(|&c| {
            let (h, v) = (run(c, (1, 0)), run(c, (0, 1)));
            let neck = h.min(v) == 1 && h.max(v) >= 3;
            let window = [(0, 0), (-1, 0), (0, -1), (-1, -1)]
                .iter()
                .any(|&(ox, oy)| {
                    [(0, 0), (1, 0), (0, 1), (1, 1)]
                        .iter()
                        .filter(|&&(dx, dy)| has((c.0 + ox + dx, c.1 + oy + dy)))
                        .count()
                        >= 3
                });
            neck || !window
        })
        .collect()
}

/// Every stream of every option-on map, seeds 1-32, is two tiles wide along its whole path.
#[test]
fn streams_are_two_tiles_wide_on_the_maps() {
    let mut bad = Vec::new();
    for (seed, m) in maps() {
        for (s, k) in (0..m.features.len())
            .filter(|&k| m.features[k].kind == FeatureKind::LavaStream)
            .enumerate()
        {
            let lava: Vec<Cell> = (0..m.feature_grid.len())
                .filter(|&i| {
                    usize::from(m.feature_grid[i]) == k + 1
                        && m.tiles[i] == T_LOW
                        && m.terrain[i] == LAVA
                })
                .map(|i| cell(m.w, i))
                .collect();
            let thin = thin_tiles(&lava);
            if !thin.is_empty() {
                bad.push(format!("seed {seed} stream {s}: thin at {thin:?}"));
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

/// The Landmarks phase alone (prefix, legacy landmark stage, signature step), seeds 1-100, attempts 0 and 1: every
/// stream the volcano lays is two tiles wide, bends included. Cheaper than whole maps, so it sees more streams.
#[test]
fn streams_are_two_tiles_wide_at_the_landmarks_phase() {
    let fixed = coliseum::fixed_layout();
    let prefix = attempt::AttemptContext::new(&fixed);
    let landmarks = stage::StageContext::new(&fixed);
    let recipes = recipes::Recipes::default();
    let step = SignatureContext::new(&fixed);
    let w = coliseum::W as u32;
    let (mut volcanoes, mut streams) = (0, 0);
    let mut bad = Vec::new();
    for seed in 1..=100 {
        for n in 0..2 {
            // On the reserving prefix (P-MAPGEN-SIG-BLUEPRINT-2: without a reserved site the step refuses).
            let Some(frame) = attempt::begin_attempt_signature(&prefix, seed, n, true).unwrap()
            else {
                continue;
            };
            let Some(mut st) = landmarks.apply(&frame, &recipes).unwrap() else {
                continue;
            };
            let Some(placed) = step.apply(&frame, &mut st).unwrap() else {
                continue;
            };
            volcanoes += 1;
            for (k, f) in st.state.features.iter().enumerate() {
                if f.kind != FeatureKind::LavaStream {
                    continue;
                }
                streams += 1;
                let lava: Vec<Cell> = (0..st.state.feature_owner.len())
                    .filter(|&i| {
                        usize::from(st.state.feature_owner[i]) == k + 1
                            && st.state.tiles[i] == T_LOW
                            && placed.terrain[i] == LAVA
                    })
                    .map(|i| cell(w, i))
                    .collect();
                let thin = thin_tiles(&lava);
                if !thin.is_empty() {
                    bad.push(format!(
                        "seed {seed} attempt {n} stream at ({}, {}): thin at {thin:?}",
                        f.ax, f.ay
                    ));
                }
            }
        }
    }
    eprintln!("{volcanoes} volcanoes, {streams} streams");
    assert!(volcanoes >= 100, "only {volcanoes} volcanoes placed");
    assert!(bad.is_empty(), "{} thin streams: {bad:#?}", bad.len());
}
