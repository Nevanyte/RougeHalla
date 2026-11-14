//! Oracle of P-LAND-PLAGUE-1 (brief `docs/backlog/packets/P-LAND-PLAGUE-1.md`): with `pipeline::Options::signature`
//! on, the Plague styler lays its bog as free pools of two to four overlapping rough-edged discs in three sizes (about
//! 5, 8 and 12 tiles across), large near the bog tree and small far, merged or at least 8 tiles apart, off spawn routes
//! and camp clearings, each leaving a two-tile ring of plain floor round it, with about today's share of the zone's
//! free ground as bog (owner direction 2026-11-12, `docs/coordination/LAND_GENERATION_REQUIREMENTS.md` section 3).
//! Barrows keep today's rules. Legacy (`packages/shared/src/zoneStyle/warren.ts`) lays a bog crescent beside each
//! barrow; option off keeps it byte for byte.
//!
//! Every check is a property measured from the map's Plague anchor over seeds 1-32 (option on, the server's options:
//! no decor). Nothing pins an option-on map, hash, attempt number or tile position: the landmark lane changes every
//! option-on map several times while this packet is open (P-MAPGEN-SIG-RESERVE-1, -SCALE-3).
//!
//! P-LAND-PLAGUE-1-fix (brief `docs/backlog/packets/P-LAND-PLAGUE-1-fix.md`): the hard guarantees (pool shape, area and
//! spacing, the ring, the apron, spawn walks, pads and halos, barrows' rock, no barrow owning bog, clean certification
//! with the tree) must also hold on a second block of seeds, 33-96, which the pools were not tuned on: the `wide_*`
//! tests. The statistical rules (budget, barrow share, size by band, all three sizes, worst attempt) stay on seeds
//! 1-32; the ignored `report_wide` prints their figures for 33-96 and 1-96.
//!
//! Definitions (tile units):
//! * bog: a floor tile (0) whose terrain is the bog code (`signature::DEFAULT_DEFINITION.bog`, 5).
//! * the tree's bog: bog owned by the `BogTree` feature. Styler bog: every other bog tile of the Plague region (today
//!   the barrows' crescents, which the `Barrow` features own).
//! * pool: a 4-connected piece of styler bog. Two pools are distinct pieces; overlapping discs merge into one pool.
//! * gap between two pools: the least Chebyshev distance between a tile of one and a tile of the other.
//! * distance from the tree: Chebyshev distance from the anchor's footprint rectangle (0 inside), as
//!   `signature::band` measures it; the core band (at most `bands[0]` = 2) is the apron. A pool's band is the band of
//!   its tile nearest the tree.
//! * full disc of squared radius r2 round a tile: every tile (dx, dy) with dx*dx + dy*dy <= r2. A disc "D across"
//!   has r2 = (D/2)^2: 5 across = 6.25 (21 tiles), 8 across = 16 (49 tiles), 12 across = 36 (113 tiles).
//! * a pool's inscribed r2: the largest r2 of a full disc lying wholly in the pool. Size class: small when at least
//!   `small_core_r2`, medium at least `medium_core_r2`, large at least `large_core_r2` (each the nominal disc less a
//!   rough rim of about one tile).
//! * camp halo: the certifier's (`certify` `protected`: the clearing grown by the halo span, round every camp).
//! * spawn pad: the 5x5 round every spawn of the pool (the certifier's `spawn_hazard` square).
//! * free ground of the zone: Plague tiles that are floor (bog included), outside the tree's footprint and apron
//!   (option off there is no tree: all Plague floor). Bog share = styler bog / free ground.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::signature::{band, Band, DEFAULT_DEFINITION};
use rh_sim::mapgen::{certify, coliseum, map_hash, pipeline};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

fn seeds() -> std::ops::RangeInclusive<i64> {
    1..=32
}

/// P-LAND-PLAGUE-1-fix: the second block of seeds, outside the 32 the pools were tuned on.
fn wide_seeds() -> std::ops::RangeInclusive<i64> {
    33..=96
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

/// Brief section 7: the worst attempt index on seeds 1-32 (option on).
fn worst_attempt_allowed() -> u64 {
    8
}

/// Owner direction: the three disc sizes, tiles across.
fn disc_across() -> [i32; 3] {
    [5, 8, 12]
}

/// The full disc a size names: squared radius (D/2)^2, in quarter tiles squared to stay in integers (D^2 / 4 * 4).
fn disc_r2x4(across: i32) -> i32 {
    across * across
}

/// Tiles of the full disc `across` wide (dx*dx + dy*dy <= (across/2)^2).
fn disc_offsets(across: i32) -> Vec<Cell> {
    let r = across / 2 + 1;
    let mut out = Vec::new();
    for dy in -r..=r {
        for dx in -r..=r {
            if 4 * (dx * dx + dy * dy) <= disc_r2x4(across) {
                out.push((dx, dy));
            }
        }
    }
    out
}

/// Size classes by the inscribed disc (squared radius, whole tiles): a 5-across disc is the r2 <= 6.25 set, i.e. the
/// r2 <= 5 set of 21 tiles (5x5 less its corners); its rough rim may not eat its core. An 8-across disc (r2 <= 16) with
/// a rough rim of about one tile still holds r2 <= 9 (7 across); a 12-across disc (r2 <= 36) still holds r2 <= 25 (11
/// across).
fn small_core_r2() -> i32 {
    5
}

fn medium_core_r2() -> i32 {
    9
}

fn large_core_r2() -> i32 {
    25
}

/// Pool area bounds: at least one full 5-across disc (two overlapping 5-discs less their rough rims; 21 tiles), at most
/// four 12-across discs side by side plus a fifth for rough rims (5 * 113 = 565).
fn pool_area_min() -> usize {
    disc_offsets(5).len()
}

fn pool_area_max() -> usize {
    5 * disc_offsets(12).len()
}

/// Owner direction: pools are merged or at least 8 tiles apart.
fn pool_gap_min() -> i32 {
    8
}

/// Owner direction (P-MAPGEN-SIG-PLAGUE-1 note 2026-11-12): two tiles of plain floor round every pool, for the water
/// and mud decoration rings `rh-mapdress` lays.
fn ring_width() -> i32 {
    2
}

/// Pools keep off spawn routes: the most a Plague spawn's shortest walk to the coliseum may grow when styler bog is
/// avoided (oracle author's allowance for the route guard's string-pulled corridor against a 4-connected walk; today
/// option on 0 on 31 seeds and 3 on seed 25, option off up to 7).
fn walk_detour_max() -> i32 {
    2
}

/// Owner direction: about today's share of the zone's free ground as bog, within about a fifth (median over seeds).
fn share_ratio_window() -> (f64, f64) {
    (0.8, 1.2)
}

/// Large near, small far: the mean pool area of the near band is at least this many times the far band's, over seeds
/// 1-32 (the nominal 12-across and 5-across discs differ by a factor of about 5).
fn near_far_area_factor() -> f64 {
    2.0
}

fn bog() -> u8 {
    DEFAULT_DEFINITION.bog
}

fn plague() -> u8 {
    Zone::Plague.code()
}

fn tile_size() -> f64 {
    32.0
}

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

/// One seed with the option on: the attempt that gave the map, the refusals before it, the map.
struct Landed {
    seed: i64,
    attempt: u64,
    refusals: Vec<String>,
    map: GameMapData,
}

fn land(generator: &pipeline::Pipeline<'_>, seed: i64) -> Landed {
    let mut refusals = Vec::new();
    for n in 0..attempt_limit() {
        let (report, _) = generator
            .styled_attempt_with_trace(seed, n, on_options())
            .expect("generator error");
        match report.map {
            Some(map) => {
                return Landed {
                    seed,
                    attempt: n,
                    refusals,
                    map,
                }
            }
            None => refusals.push(format!("{:?}", report.refusal)),
        }
    }
    panic!(
        "seed {seed}: no map in {} attempts with the option on ({refusals:?})",
        attempt_limit()
    )
}

fn land_range(range: std::ops::RangeInclusive<i64>) -> Vec<Landed> {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    range.map(|seed| land(&generator, seed)).collect()
}

fn off_range(range: std::ops::RangeInclusive<i64>) -> Vec<(i64, GameMapData)> {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    range
        .map(|seed| {
            let m = generator
                .certified_styled(seed, off_options())
                .expect("generator error")
                .unwrap_or_else(|| panic!("seed {seed}: no option-off map"));
            (seed, m)
        })
        .collect()
}

/// Seeds 1-32 with the option on, generated once per test binary.
fn maps() -> &'static Vec<Landed> {
    static MAPS: OnceLock<Vec<Landed>> = OnceLock::new();
    MAPS.get_or_init(|| land_range(seeds()))
}

/// Seeds 33-96 with the option on, generated once per test binary.
fn wide_maps() -> &'static Vec<Landed> {
    static MAPS: OnceLock<Vec<Landed>> = OnceLock::new();
    MAPS.get_or_init(|| land_range(wide_seeds()))
}

/// Seeds 1-32 with the option off (today's generator, the server's options), generated once per test binary.
fn off_maps() -> &'static Vec<(i64, GameMapData)> {
    static MAPS: OnceLock<Vec<(i64, GameMapData)>> = OnceLock::new();
    MAPS.get_or_init(|| off_range(seeds()))
}

/// Seeds 33-96 with the option off, generated once per test binary (the wide report only).
fn wide_off_maps() -> &'static Vec<(i64, GameMapData)> {
    static MAPS: OnceLock<Vec<(i64, GameMapData)>> = OnceLock::new();
    MAPS.get_or_init(|| off_range(wide_seeds()))
}

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn cell(m: &GameMapData, i: usize) -> Cell {
    ((i as i32) % m.w as i32, (i as i32) / m.w as i32)
}

fn world_cell(x: f64, y: f64) -> Cell {
    (
        (x / tile_size()).floor() as i32,
        (y / tile_size()).floor() as i32,
    )
}

fn owner_kind(m: &GameMapData, i: usize) -> Option<FeatureKind> {
    usize::from(m.feature_grid[i])
        .checked_sub(1)
        .and_then(|k| m.features.get(k))
        .map(|f| f.kind)
}

fn in_plague(m: &GameMapData, i: usize) -> bool {
    m.region_grid[i] == plague()
}

fn is_bog(m: &GameMapData, i: usize) -> bool {
    m.tiles[i] == 0 && m.terrain[i] == bog()
}

fn is_tree_bog(m: &GameMapData, i: usize) -> bool {
    is_bog(m, i) && owner_kind(m, i) == Some(FeatureKind::BogTree)
}

fn is_styler_bog(m: &GameMapData, i: usize) -> bool {
    in_plague(m, i) && is_bog(m, i) && owner_kind(m, i) != Some(FeatureKind::BogTree)
}

fn styler_bog(m: &GameMapData) -> BTreeSet<Cell> {
    (0..m.tiles.len())
        .filter(|&i| is_styler_bog(m, i))
        .map(|i| cell(m, i))
        .collect()
}

fn anchor(seed: i64, m: &GameMapData) -> &ZoneAnchor {
    let a = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Plague)
        .unwrap_or_else(|| panic!("seed {seed}: no Plague anchor"));
    assert_eq!(a.kind, FeatureKind::BogTree, "seed {seed}: Plague anchor");
    a
}

/// Free ground of the zone (file comment): Plague floor outside the tree's footprint and apron.
fn free_ground(m: &GameMapData, a: Option<&ZoneAnchor>) -> usize {
    (0..m.tiles.len())
        .filter(|&i| in_plague(m, i) && m.tiles[i] == 0)
        .filter(|&i| a.is_none_or(|a| band(a, cell(m, i).0, cell(m, i).1) != Band::Core))
        .count()
}

/// The pools of a map: 4-connected pieces of styler bog, each sorted, in order of their first tile.
fn pools(m: &GameMapData) -> Vec<Vec<Cell>> {
    pieces4(&styler_bog(m))
}

fn pieces4(cells: &BTreeSet<Cell>) -> Vec<Vec<Cell>> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for &start in cells {
        if !seen.insert(start) {
            continue;
        }
        let mut group = vec![start];
        let mut head = 0;
        while head < group.len() {
            let (x, y) = group[head];
            head += 1;
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let n = (x + dx, y + dy);
                if cells.contains(&n) && seen.insert(n) {
                    group.push(n);
                }
            }
        }
        group.sort_unstable();
        out.push(group);
    }
    out
}

/// The largest squared radius (whole tiles) of a full disc lying wholly in `pool`; 0 when not even one tile's
/// 4-neighbourhood (r2 = 1) fits.
fn inscribed_r2(pool: &[Cell]) -> i32 {
    let set: BTreeSet<Cell> = pool.iter().copied().collect();
    let mut best = 0;
    for r2 in 1..=64 {
        let r = (1..).find(|r: &i32| r * r > r2).unwrap();
        let offsets: Vec<Cell> = (-r..=r)
            .flat_map(|dy| (-r..=r).map(move |dx| (dx, dy)))
            .filter(|&(dx, dy)| dx * dx + dy * dy <= r2)
            .collect();
        if pool.iter().any(|&(x, y)| {
            offsets
                .iter()
                .all(|&(dx, dy)| set.contains(&(x + dx, y + dy)))
        }) {
            best = r2;
        } else if offsets.len() > pool.len() {
            break;
        }
    }
    best
}

/// The share (percent) of a pool's tiles that lie in some 3x3 block wholly of the pool.
fn share_in_3x3(pool: &[Cell]) -> usize {
    let set: BTreeSet<Cell> = pool.iter().copied().collect();
    let full = |(x, y): Cell| (-1..=1).all(|dy| (-1..=1).all(|dx| set.contains(&(x + dx, y + dy))));
    let covered = pool
        .iter()
        .filter(|&&(x, y)| (-1..=1).any(|dy| (-1..=1).any(|dx| full((x + dx, y + dy)))))
        .count();
    100 * covered / pool.len().max(1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Size {
    Thin,
    Small,
    Medium,
    Large,
}

fn size_class(pool: &[Cell]) -> Size {
    let r2 = inscribed_r2(pool);
    if r2 >= large_core_r2() {
        Size::Large
    } else if r2 >= medium_core_r2() {
        Size::Medium
    } else if r2 >= small_core_r2() {
        Size::Small
    } else {
        Size::Thin
    }
}

/// A pool's band: the band of its tile nearest the tree.
fn pool_band(a: &ZoneAnchor, pool: &[Cell]) -> Band {
    pool.iter()
        .map(|&(x, y)| band(a, x, y))
        .min()
        .expect("a pool has tiles")
}

fn gap(p: &[Cell], q: &[Cell]) -> i32 {
    let mut best = i32::MAX;
    for &(x, y) in p {
        for &(u, v) in q {
            best = best.min((x - u).abs().max((y - v).abs()));
        }
    }
    best
}

fn bbox(pool: &[Cell]) -> (i32, i32) {
    let (x0, x1) = (
        pool.iter().map(|c| c.0).min().unwrap(),
        pool.iter().map(|c| c.0).max().unwrap(),
    );
    let (y0, y1) = (
        pool.iter().map(|c| c.1).min().unwrap(),
        pool.iter().map(|c| c.1).max().unwrap(),
    );
    (x1 - x0 + 1, y1 - y0 + 1)
}

/// The certifier's camp halo (`certify` `protected`): the clearing grown by the halo span, round every camp.
fn halo(m: &GameMapData) -> Vec<bool> {
    let r = certify::rules::R;
    let mut out = vec![false; m.tiles.len()];
    for c in &m.camps {
        let (cx, cy) = world_cell(c.x, c.y);
        for dy in -r.protection_span..=r.protection_span {
            for dx in -r.protection_span..=r.protection_span {
                let near = (-r.halo..=r.halo).any(|oy| {
                    (-r.halo..=r.halo).any(|ox| {
                        f64::from((dx + ox).pow(2) + (dy + oy).pow(2)) <= r.clearing * r.clearing
                    })
                });
                if let Some(i) = at(m, (cx + dx, cy + dy)).filter(|_| near) {
                    out[i] = true;
                }
            }
        }
    }
    out
}

/// The 5x5 round every spawn of the pool (the certifier's `spawn_hazard` square: no hazard floor there).
fn spawn_pads(m: &GameMapData) -> Vec<bool> {
    let s = certify::rules::R.spawn_hazard;
    let mut out = vec![false; m.tiles.len()];
    for p in &m.spawn_pool {
        let (sx, sy) = world_cell(p.x, p.y);
        for dy in -s..=s {
            for dx in -s..=s {
                if let Some(i) = at(m, (sx + dx, sy + dy)) {
                    out[i] = true;
                }
            }
        }
    }
    out
}

/// Walk distances (4-connected steps) to the coliseum's centre and gates over tiles `ground` admits.
fn walk_field(m: &GameMapData, ground: impl Fn(usize) -> bool) -> Vec<i32> {
    let n = m.tiles.len();
    let mut dist = vec![i32::MAX; n];
    let mut queue = VecDeque::new();
    let mut starts = vec![world_cell(m.coliseum.centre.x, m.coliseum.centre.y)];
    for g in &m.coliseum.gates {
        starts.extend(g.tiles.iter().map(|t| (t.x, t.y)));
    }
    for s in starts {
        if let Some(i) = at(m, s).filter(|&i| ground(i)) {
            if dist[i] == i32::MAX {
                dist[i] = 0;
                queue.push_back(i);
            }
        }
    }
    while let Some(i) = queue.pop_front() {
        let (x, y) = cell(m, i);
        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
            if let Some(j) = at(m, (x + dx, y + dy)) {
                if ground(j) && dist[j] == i32::MAX {
                    dist[j] = dist[i] + 1;
                    queue.push_back(j);
                }
            }
        }
    }
    dist
}

/// An approximation of the route guard's corridors (`style_runtime/route.rs`): from every Plague spawn of the pool,
/// the steepest descent of the walk distance to the coliseum (bog counted as ground), while in the zone, grown by one
/// tile all round. Used by the report and the sheet only.
fn route_band(m: &GameMapData) -> Vec<bool> {
    let dist = walk_field(m, |i| m.tiles[i] == 0);
    let mut out = vec![false; m.tiles.len()];
    for s in m.spawn_pool.iter().filter(|s| s.zone == Zone::Plague) {
        let Some(mut i) = at(m, world_cell(s.x, s.y)) else {
            continue;
        };
        while in_plague(m, i) && dist[i] != i32::MAX {
            let (x, y) = cell(m, i);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if let Some(j) = at(m, (x + dx, y + dy)) {
                        out[j] = true;
                    }
                }
            }
            let next = [(0, -1), (1, 0), (0, 1), (-1, 0)]
                .iter()
                .filter_map(|&(dx, dy)| at(m, (x + dx, y + dy)))
                .find(|&j| dist[j] == dist[i] - 1);
            match next {
                Some(j) => i = j,
                None => break,
            }
        }
    }
    out
}

/// Per Plague spawn of the pool: the walk to the coliseum with styler bog forbidden, less the walk with it allowed
/// (`i32::MAX` when the bog cuts the spawn off).
fn bog_detours(m: &GameMapData) -> Vec<i32> {
    let open = walk_field(m, |i| m.tiles[i] == 0);
    let dry = walk_field(m, |i| m.tiles[i] == 0 && !is_styler_bog(m, i));
    m.spawn_pool
        .iter()
        .filter(|s| s.zone == Zone::Plague)
        .filter_map(|s| at(m, world_cell(s.x, s.y)))
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

/// Plague `Barrow` features: (feature index, wall tiles it owns, bog tiles it owns).
fn barrows(m: &GameMapData) -> Vec<(usize, usize, usize)> {
    let mut walls = vec![0usize; m.features.len()];
    let mut wet = vec![0usize; m.features.len()];
    for i in 0..m.tiles.len() {
        let Some(k) = usize::from(m.feature_grid[i]).checked_sub(1) else {
            continue;
        };
        if k >= m.features.len() {
            continue;
        }
        if m.tiles[i] == 1 {
            walls[k] += 1;
        }
        if is_bog(m, i) {
            wet[k] += 1;
        }
    }
    m.features
        .iter()
        .enumerate()
        .filter(|(_, f)| f.kind == FeatureKind::Barrow && f.zone == Zone::Plague)
        .map(|(k, _)| (k, walls[k], wet[k]))
        .collect()
}

/// Fails with every finding when there is one (one line per finding, the first 40).
fn verdict(what: &str, findings: &[String]) {
    let shown: Vec<&String> = findings.iter().take(40).collect();
    assert!(
        findings.is_empty(),
        "{what}: {} findings\n{}",
        findings.len(),
        shown
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

// --------------------------------------------------------------------------------------------------------------------
// The pools' shape (owner: two to four overlapping rough-edged discs in three sizes).
// --------------------------------------------------------------------------------------------------------------------

/// 1. Pools are bodies, not crescents: every pool holds a full 5-across disc (inscribed r2 at least `small_core_r2`).
#[test]
fn every_styler_pool_holds_a_full_five_across_disc() {
    verdict("thin pools", &thin_pools(maps()));
}

fn thin_pools(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        for p in pools(&l.map) {
            let r2 = inscribed_r2(&p);
            if r2 < small_core_r2() {
                findings.push(format!(
                    "seed {}: pool at {:?} of {} tiles ({}x{} box, {}% in a 3x3 block) holds no full 5-across disc (inscribed r2 {r2})",
                    l.seed,
                    p[0],
                    p.len(),
                    bbox(&p).0,
                    bbox(&p).1,
                    share_in_3x3(&p)
                ));
            }
        }
    }
    findings
}

/// 2. Pool area lies between one full 5-across disc (two overlapping small discs less their rough rims) and five
///    12-across discs (four large discs plus their rough rims).
#[test]
fn pool_area_lies_between_two_small_discs_and_four_large_discs() {
    verdict("pool areas", &pool_areas(maps()));
}

fn pool_areas(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        for p in pools(&l.map) {
            if p.len() < pool_area_min() || p.len() > pool_area_max() {
                findings.push(format!(
                    "seed {}: pool at {:?} has {} tiles, outside [{}, {}]",
                    l.seed,
                    p[0],
                    p.len(),
                    pool_area_min(),
                    pool_area_max()
                ));
            }
        }
    }
    findings
}

/// 3. Pools are merged or at least 8 tiles apart.
#[test]
fn distinct_pools_are_at_least_eight_tiles_apart() {
    verdict("pools too close", &pools_too_close(maps()));
}

fn pools_too_close(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        let ps = pools(&l.map);
        for i in 0..ps.len() {
            for j in i + 1..ps.len() {
                let g = gap(&ps[i], &ps[j]);
                if g < pool_gap_min() {
                    findings.push(format!(
                        "seed {}: pools at {:?} ({} tiles) and {:?} ({} tiles) are {g} apart",
                        l.seed,
                        ps[i][0],
                        ps[i].len(),
                        ps[j][0],
                        ps[j].len()
                    ));
                }
            }
        }
    }
    findings
}

/// 4. Large near the tree, small far: over seeds 1-32 the mean area of near-band pools is at least
///    `near_far_area_factor` times the far band's; no large pool lies in the far band and no small one in the near band.
#[test]
fn pools_are_large_near_the_tree_and_small_far() {
    let mut findings = Vec::new();
    let (mut near, mut far) = (Vec::new(), Vec::new());
    for l in maps() {
        let a = anchor(l.seed, &l.map);
        for p in pools(&l.map) {
            let (b, s) = (pool_band(a, &p), size_class(&p));
            match b {
                Band::Near => near.push(p.len()),
                Band::Far => far.push(p.len()),
                _ => {}
            }
            if (b == Band::Far && s == Size::Large) || (b == Band::Near && s <= Size::Small) {
                findings.push(format!(
                    "seed {}: a {s:?} pool of {} tiles at {:?} in the {b:?} band",
                    l.seed,
                    p.len(),
                    p[0]
                ));
            }
        }
    }
    let mean = |v: &[usize]| v.iter().sum::<usize>() as f64 / v.len().max(1) as f64;
    if near.is_empty() || far.is_empty() || mean(&near) < near_far_area_factor() * mean(&far) {
        findings.push(format!(
            "near-band pools: {} of mean area {:.1}; far-band pools: {} of mean area {:.1} (want near >= {} x far, both present)",
            near.len(),
            mean(&near),
            far.len(),
            mean(&far),
            near_far_area_factor()
        ));
    }
    verdict("pool size by band", &findings);
}

/// 5. Size variance: over seeds 1-32 all three size classes occur, and every map with at least three pools has pools
///    of at least two classes.
#[test]
fn all_three_sizes_occur_and_maps_with_three_pools_mix_sizes() {
    let mut findings = Vec::new();
    let mut seen = BTreeMap::new();
    for l in maps() {
        let classes: Vec<Size> = pools(&l.map).iter().map(|p| size_class(p)).collect();
        for &s in &classes {
            *seen.entry(s).or_insert(0) += 1;
        }
        let distinct: BTreeSet<Size> = classes.iter().copied().collect();
        if classes.len() >= 3 && distinct.len() < 2 {
            findings.push(format!(
                "seed {}: {} pools, all {:?}",
                l.seed,
                classes.len(),
                distinct
            ));
        }
    }
    for s in [Size::Small, Size::Medium, Size::Large] {
        if !seen.contains_key(&s) {
            findings.push(format!(
                "no {s:?} pool on seeds 1-32 (classes seen: {seen:?})"
            ));
        }
    }
    verdict("pool sizes", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Keep-clear: the ring, the tree, the camps, the spawns.
// --------------------------------------------------------------------------------------------------------------------

/// 6. Every pool leaves a two-tile ring of plain floor round it: each tile within Chebyshev distance 2 of a pool that is
///    not of the pool is floor without terrain, in the Plague zone, outside every camp halo, owned by no feature.
#[test]
fn every_pool_has_a_two_tile_ring_of_plain_floor_in_the_zone_off_camp_halos() {
    verdict("pool rings", &pool_rings(maps()));
}

fn pool_rings(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        let m = &l.map;
        let halo = halo(m);
        for p in pools(m) {
            let own: BTreeSet<Cell> = p.iter().copied().collect();
            let mut bad: BTreeMap<&str, (usize, Cell)> = BTreeMap::new();
            let mut ring = BTreeSet::new();
            for &(x, y) in &p {
                for dy in -ring_width()..=ring_width() {
                    for dx in -ring_width()..=ring_width() {
                        let c = (x + dx, y + dy);
                        if !own.contains(&c) {
                            ring.insert(c);
                        }
                    }
                }
            }
            for c in ring {
                let why = match at(m, c) {
                    None => Some("off the map"),
                    Some(i) if !in_plague(m, i) => Some("outside the zone"),
                    Some(i) if m.tiles[i] != 0 => Some("not floor"),
                    Some(i) if m.terrain[i] != 0 => Some("terrain"),
                    Some(i) if m.feature_grid[i] != 0 => Some("owned"),
                    Some(i) if halo[i] => Some("camp halo"),
                    Some(_) => None,
                };
                if let Some(w) = why {
                    let e = bad.entry(w).or_insert((0, c));
                    e.0 += 1;
                }
            }
            if !bad.is_empty() {
                findings.push(format!(
                    "seed {}: pool at {:?} ({} tiles): ring tiles {:?}",
                    l.seed,
                    p[0],
                    p.len(),
                    bad
                ));
            }
        }
    }
    findings
}

/// 7. No styler bog in the tree's footprint or its apron (the core band).
#[test]
fn no_styler_bog_in_the_tree_footprint_or_its_apron() {
    verdict("bog in the apron", &bog_in_the_apron(maps()));
}

fn bog_in_the_apron(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        let a = anchor(l.seed, &l.map);
        let inside: Vec<Cell> = styler_bog(&l.map)
            .into_iter()
            .filter(|&(x, y)| band(a, x, y) == Band::Core)
            .collect();
        if !inside.is_empty() {
            findings.push(format!(
                "seed {}: {} styler bog tiles in the tree's footprint or apron, first {:?}",
                l.seed,
                inside.len(),
                &inside[..inside.len().min(4)]
            ));
        }
    }
    findings
}

/// Pools keep off spawn routes and camp clearings: from every Plague spawn the walk to the coliseum (4-connected
/// steps) with styler bog forbidden is at most `walk_detour_max` steps longer than with it allowed, and no styler bog
/// lies on a spawn pad (5x5) or in a camp halo.
#[test]
fn pools_keep_off_spawn_walks_spawn_pads_and_camp_halos() {
    verdict("pools on routes or clearings", &pools_on_routes(maps()));
}

fn pools_on_routes(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        let m = &l.map;
        let (halo, pads) = (halo(m), spawn_pads(m));
        let detours = bog_detours(m);
        if detours.iter().any(|&d| d > walk_detour_max()) {
            findings.push(format!(
                "seed {}: the walks of the Plague spawns to the coliseum grow by {:?} steps when bog is avoided",
                l.seed, detours
            ));
        }
        let on_halo = styler_bog(m)
            .into_iter()
            .filter(|&c| at(m, c).is_some_and(|i| halo[i] || pads[i]))
            .count();
        if on_halo > 0 {
            findings.push(format!(
                "seed {}: {on_halo} styler bog tiles in a camp halo or on a spawn pad",
                l.seed
            ));
        }
    }
    findings
}

// --------------------------------------------------------------------------------------------------------------------
// Budget and barrows.
// --------------------------------------------------------------------------------------------------------------------

/// 8. Budget: the median over seeds 1-32 of (styler bog share option on) / (bog share option off) lies in
///    `share_ratio_window`.
#[test]
fn bog_share_of_free_ground_stays_within_a_fifth_of_todays() {
    let mut ratios = Vec::new();
    for (l, (seed, off)) in maps().iter().zip(off_maps()) {
        assert_eq!(l.seed, *seed);
        let a = anchor(l.seed, &l.map);
        let on_share = styler_bog(&l.map).len() as f64 / free_ground(&l.map, Some(a)) as f64;
        let off_share = styler_bog(off).len() as f64 / free_ground(off, None) as f64;
        ratios.push(on_share / off_share);
    }
    let mut sorted = ratios.clone();
    let mid = median(&mut sorted);
    let (lo, hi) = share_ratio_window();
    assert!(
        (lo..=hi).contains(&mid),
        "median on/off bog-share ratio {mid:.3} outside [{lo}, {hi}]; per seed {:?}",
        ratios.iter().map(|r| format!("{r:.2}")).collect::<Vec<_>>()
    );
}

/// 9. Barrows keep today's rules: every Plague barrow keeps its rock (at least the certifier's `piece_min` wall
///    tiles), and over seeds 1-32 the option-on maps hold at least `barrow_share_min` percent of the option-off maps'
///    barrows.
#[test]
fn barrows_keep_their_rock_and_their_number() {
    let mut findings = barrows_without_rock(maps());
    let (mut on_total, mut off_total) = (0, 0);
    for (l, (_, off)) in maps().iter().zip(off_maps()) {
        on_total += barrows(&l.map).len();
        off_total += barrows(off).len();
    }
    if 100 * on_total < barrow_share_min() * off_total {
        findings.push(format!(
            "{on_total} Plague barrows option on against {off_total} option off (want at least {}%)",
            barrow_share_min()
        ));
    }
    verdict("barrows", &findings);
}

fn barrows_without_rock(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        for (k, walls, _) in barrows(&l.map) {
            if walls < certify::rules::R.piece_min {
                findings.push(format!(
                    "seed {}: barrow feature {k} owns {walls} wall tiles",
                    l.seed
                ));
            }
        }
    }
    findings
}

/// Measured (brief section 12, on the reserved sites): option on today holds 312 of the 397 option-off barrows (79%)
/// over seeds 1-32, because the tree's reserved site moves the camps the barrows stand between. The floor leaves the
/// same room as before the reservation (85 against 94) for barrows to give way to the pools.
fn barrow_share_min() -> usize {
    70
}

/// 9b. The pools are free: no barrow owns bog (today each barrow owns its crescent; the barrow itself, its rock and
///     tunnel, is unchanged).
#[test]
fn no_barrow_owns_bog() {
    verdict("barrows owning bog", &barrows_owning_bog(maps()));
}

fn barrows_owning_bog(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        for (k, _, wet) in barrows(&l.map) {
            if wet > 0 {
                findings.push(format!(
                    "seed {}: barrow feature {k} owns {wet} bog tiles",
                    l.seed
                ));
            }
        }
    }
    findings
}

// --------------------------------------------------------------------------------------------------------------------
// Behaviour to preserve (brief section 7).
// --------------------------------------------------------------------------------------------------------------------

/// 10. Every accepted map certifies with zero failures under the strict certifier and keeps its bog tree with its own
///     bog.
#[test]
fn maps_certify_clean_and_keep_the_tree() {
    verdict("certification and the tree", &certify_and_tree(maps()));
}

fn certify_and_tree(maps: &[Landed]) -> Vec<String> {
    let mut findings = Vec::new();
    for l in maps {
        let m = &l.map;
        let c = certify::certify(
            m,
            &certify::Options {
                styled: true,
                zone: true,
                strict: certify::Strict::All,
            },
        )
        .unwrap_or_else(|e| panic!("seed {}: certifier refused the map: {e:?}", l.seed));
        for f in &c.failures {
            findings.push(format!("seed {}: {}/{}", l.seed, f.rule, f.subject));
        }
        let trees = m
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::BogTree && f.zone == Zone::Plague)
            .count();
        let tree_bog = (0..m.tiles.len()).filter(|&i| is_tree_bog(m, i)).count();
        if trees != 1 || tree_bog == 0 {
            findings.push(format!(
                "seed {}: {trees} bog trees, {tree_bog} tree bog tiles",
                l.seed
            ));
        }
        anchor(l.seed, m);
    }
    findings
}

/// Attempts stay bounded: the worst attempt index over seeds 1-32 is at most 8.
#[test]
fn the_worst_attempt_over_seeds_1_to_32_is_at_most_eight() {
    let worst = maps().iter().map(|l| (l.attempt, l.seed)).max().unwrap();
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {} lands on attempt {}, over {}",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// Option off (G8): today's generator, map hash for map hash, seeds 1-8 (the values `mapgen_signature_fire.rs` and
/// `mapgen_signature_frost.rs` pin for `Options::default()`); and the server's options (no decor) lay the same bog.
/// The full guard is `mapgen_signature_core::g8_signature_off_is_todays_generator`.
#[test]
fn option_off_maps_are_todays() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash) in [
        (1, "d09b4fd9"),
        (2, "190cd50f"),
        (3, "b82117b8"),
        (4, "bec16d65"),
        (5, "25032ba7"),
        (6, "2d58fdf5"),
        (7, "6255dbbe"),
        (8, "dbb3602f"),
    ] {
        let m = generator
            .certified_styled(seed, pipeline::Options::default())
            .expect("generator error")
            .unwrap_or_else(|| panic!("seed {seed}: no option-off map"));
        assert_eq!(map_hash::map_hash(&m), hash, "seed {seed}: map hash");
        assert!(
            m.anchors.is_empty(),
            "seed {seed}: anchors with the option off"
        );
        let bare = &off_maps()[(seed - 1) as usize].1;
        assert_eq!(
            styler_bog(bare),
            styler_bog(&m),
            "seed {seed}: decor moved the bog"
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// P-LAND-PLAGUE-1-fix: the hard guarantees on seeds 33-96 (the same checks and bounds as above, on maps the pools were
// not tuned on). Each map set is generated once per test binary; a guarantee is a property of every map, so no seed is
// named here.
// --------------------------------------------------------------------------------------------------------------------

/// Test 1 on seeds 33-96: every pool holds a full 5-across disc.
#[test]
fn wide_every_styler_pool_holds_a_full_five_across_disc() {
    verdict("thin pools, seeds 33-96", &thin_pools(wide_maps()));
}

/// Test 2 on seeds 33-96: pool area between one full 5-across disc and five 12-across discs.
#[test]
fn wide_pool_area_lies_between_two_small_discs_and_four_large_discs() {
    verdict("pool areas, seeds 33-96", &pool_areas(wide_maps()));
}

/// Test 3 on seeds 33-96: pools are merged or at least 8 tiles apart.
#[test]
fn wide_distinct_pools_are_at_least_eight_tiles_apart() {
    verdict(
        "pools too close, seeds 33-96",
        &pools_too_close(wide_maps()),
    );
}

/// Test 6 on seeds 33-96: the two-tile ring of plain floor (this also answers review note 3: no ring tile is owned).
#[test]
fn wide_every_pool_has_a_two_tile_ring_of_plain_floor_in_the_zone_off_camp_halos() {
    verdict("pool rings, seeds 33-96", &pool_rings(wide_maps()));
}

/// Test 7 on seeds 33-96: no styler bog in the tree's footprint or apron.
#[test]
fn wide_no_styler_bog_in_the_tree_footprint_or_its_apron() {
    verdict(
        "bog in the apron, seeds 33-96",
        &bog_in_the_apron(wide_maps()),
    );
}

/// The walk test on seeds 33-96: no Plague spawn's walk to the coliseum grows by more than `walk_detour_max` steps when
/// styler bog is avoided, and no styler bog on a spawn pad or in a camp halo. A hard guarantee (owner: pools keep off
/// spawn routes): a map that breaks it must never be served, on any seed.
#[test]
fn wide_pools_keep_off_spawn_walks_spawn_pads_and_camp_halos() {
    verdict(
        "pools on routes or clearings, seeds 33-96",
        &pools_on_routes(wide_maps()),
    );
}

/// Test 9's per-barrow rule on seeds 33-96: every Plague barrow keeps its rock (the share of barrows is a figure of the
/// wide report, not a check).
#[test]
fn wide_barrows_keep_their_rock() {
    verdict("barrows, seeds 33-96", &barrows_without_rock(wide_maps()));
}

/// Test 9b on seeds 33-96: no barrow owns bog.
#[test]
fn wide_no_barrow_owns_bog() {
    verdict(
        "barrows owning bog, seeds 33-96",
        &barrows_owning_bog(wide_maps()),
    );
}

/// Test 10 on seeds 33-96: every accepted map certifies clean under the strict certifier and keeps its bog tree with
/// its own bog. (`land` already fails a seed that gives no map in `attempt_limit` attempts.)
#[test]
fn wide_maps_certify_clean_and_keep_the_tree() {
    verdict(
        "certification and the tree, seeds 33-96",
        &certify_and_tree(wide_maps()),
    );
}

// --------------------------------------------------------------------------------------------------------------------
// P-LAND-PLAGUE-1-fix-2 (brief `docs/backlog/packets/P-LAND-PLAGUE-1-fix-2.md`): the pipeline's end-of-attempt pool
// check (`pipeline::plague_pools`) on today's maps, seeds 1-96 (the two cached map sets).
// --------------------------------------------------------------------------------------------------------------------

/// The pipeline's check measures this oracle's walk: on every accepted map of seeds 1-96, `plague_pools::walk_growth`
/// equals `bog_detours` (per Plague spawn of the pool that a walk reaches, in pool order), and no `BogPool` is dry.
#[test]
fn the_end_of_attempt_check_measures_this_oracles_walk_on_seeds_1_to_96() {
    let mut findings = Vec::new();
    for l in maps().iter().chain(wide_maps()) {
        let m = &l.map;
        let (check, oracle) = (pipeline::plague_pools::walk_growth(m), bog_detours(m));
        if check != oracle {
            findings.push(format!(
                "seed {}: the check measures {check:?}, the oracle {oracle:?}",
                l.seed
            ));
        }
        let dry = pipeline::plague_pools::dry_pools(m);
        if !dry.is_empty() {
            findings.push(format!("seed {}: dry BogPool features {dry:?}", l.seed));
        }
    }
    verdict("end-of-attempt pool check, seeds 1-96", &findings);
}

/// The check costs no map today: no attempt of seeds 1-96 before the accepted one was refused by it, and every
/// accepted map passes it with the pools' detour.
#[test]
fn no_attempt_of_seeds_1_to_96_is_refused_by_the_pool_check() {
    let refused = format!("{:?}", Some(pipeline::Refusal::SignaturePools));
    let mut findings = Vec::new();
    for l in maps().iter().chain(wide_maps()) {
        let n = l.refusals.iter().filter(|r| **r == refused).count();
        if n > 0 {
            findings.push(format!(
                "seed {}: {n} attempts refused by the pool check",
                l.seed
            ));
        }
        if !pipeline::plague_pools::keeps(&l.map, walk_detour_max()) {
            findings.push(format!(
                "seed {}: the accepted map fails the pool check",
                l.seed
            ));
        }
    }
    verdict("pool-check refusals, seeds 1-96", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Reports (brief section 12; not gate checks). Run with `--ignored --nocapture`.
// --------------------------------------------------------------------------------------------------------------------

fn summary(name: &str, v: &mut [f64]) {
    if v.is_empty() {
        eprintln!("{name}: none");
        return;
    }
    v.sort_by(f64::total_cmp);
    let mid = median(v);
    eprintln!(
        "{name}: n {} min {:.2} median {:.2} max {:.2} sum {:.2}",
        v.len(),
        v[0],
        mid,
        v[v.len() - 1],
        v.iter().sum::<f64>()
    );
}

/// A tile a barrow holds that M5's "barrows give way" variant counts as free ground.
fn movable(m: &GameMapData, masks: &Masks, i: usize) -> bool {
    masks.barrows_free && owner_kind(m, i) == Some(FeatureKind::Barrow)
}

/// Where a disc may lie on a finished map today (M5): Plague floor that is unowned or today's styler bog (or, in the
/// variant, a barrow's tile), outside the tree's footprint and apron, every camp halo, every spawn pad and the
/// approximate route band.
fn poolable(m: &GameMapData, a: &ZoneAnchor, masks: &Masks, i: usize) -> bool {
    let c = cell(m, i);
    in_plague(m, i)
        && (m.tiles[i] == 0 || movable(m, masks, i))
        && (m.feature_grid[i] == 0 || is_styler_bog(m, i) || movable(m, masks, i))
        && band(a, c.0, c.1) != Band::Core
        && !masks.halo[i]
        && !masks.pads[i]
        && !masks.routes[i]
}

/// Where a ring tile may lie today: Plague floor that is unowned (or today's styler bog, or in the variant a barrow's
/// tile), outside every camp halo.
fn ring_ok(m: &GameMapData, masks: &Masks, i: usize) -> bool {
    in_plague(m, i)
        && (m.tiles[i] == 0 || movable(m, masks, i))
        && (m.feature_grid[i] == 0 || is_styler_bog(m, i) || movable(m, masks, i))
        && (m.terrain[i] == 0 || is_styler_bog(m, i))
        && !masks.halo[i]
}

struct Masks {
    barrows_free: bool,
    halo: Vec<bool>,
    pads: Vec<bool>,
    routes: Vec<bool>,
}

/// The disc `across` wide centred on `c` and its ring fit today (M5).
fn disc_fits(m: &GameMapData, a: &ZoneAnchor, masks: &Masks, c: Cell, across: i32) -> bool {
    let r = across / 2 + 1 + ring_width();
    let inner = disc_r2x4(across);
    let outer = (across + 2 * ring_width()) * (across + 2 * ring_width());
    for dy in -r..=r {
        for dx in -r..=r {
            let d = 4 * (dx * dx + dy * dy);
            if d > outer {
                continue;
            }
            let Some(i) = at(m, (c.0 + dx, c.1 + dy)) else {
                return false;
            };
            let ok = if d <= inner {
                poolable(m, a, masks, i)
            } else {
                ring_ok(m, masks, i)
            };
            if !ok {
                return false;
            }
        }
    }
    true
}

/// A greedy packing (M5's capacity): for each band from near to far with the disc size the owner gives it (near 12,
/// mid 8, far 5 across), seed a pool at the first fitting centre whose disc's nearest tile is in the band, grow it by
/// up to three more fitting discs of the same size whose centres stand half a disc from a disc already in it, and keep
/// every tile of it at least `pool_gap_min` from the pools placed before. Returns (area, pools) per band.
fn greedy_capacity(
    m: &GameMapData,
    a: &ZoneAnchor,
    masks: &Masks,
    plan: &[(Band, Vec<i32>)],
) -> [(usize, usize); 3] {
    let mut blocked = vec![false; m.tiles.len()];
    let mut out = [(0, 0); 3];
    let plague_cells: Vec<Cell> = (0..m.tiles.len())
        .filter(|&i| in_plague(m, i))
        .map(|i| cell(m, i))
        .collect();
    let steps: Vec<(usize, Band, i32)> = plan
        .iter()
        .enumerate()
        .flat_map(|(k, (b, sizes))| sizes.iter().map(move |&s| (k, *b, s)))
        .collect();
    for (k, want, across) in steps {
        let offs = disc_offsets(across);
        let disc_at =
            |c: Cell| -> Vec<Cell> { offs.iter().map(|&(dx, dy)| (c.0 + dx, c.1 + dy)).collect() };
        let free = |tiles: &[Cell], blocked: &[bool]| {
            tiles.iter().all(|&t| at(m, t).is_some_and(|i| !blocked[i]))
        };
        for &c in &plague_cells {
            let first = disc_at(c);
            let nearest = first.iter().map(|&(x, y)| band(a, x, y)).min().unwrap();
            if nearest != want || !free(&first, &blocked) || !disc_fits(m, a, masks, c, across) {
                continue;
            }
            let mut centres = vec![c];
            let mut tiles: BTreeSet<Cell> = first.into_iter().collect();
            let step = (across / 2).max(2);
            'grow: while centres.len() < 4 {
                for q in 0..centres.len() {
                    for (dx, dy) in [
                        (step, 0),
                        (0, step),
                        (-step, 0),
                        (0, -step),
                        (step, step),
                        (-step, step),
                        (step, -step),
                        (-step, -step),
                    ] {
                        let n = (centres[q].0 + dx, centres[q].1 + dy);
                        if centres.contains(&n) {
                            continue;
                        }
                        let more = disc_at(n);
                        if free(&more, &blocked) && disc_fits(m, a, masks, n, across) {
                            centres.push(n);
                            tiles.extend(more);
                            continue 'grow;
                        }
                    }
                }
                break;
            }
            if centres.len() < 2 {
                continue;
            }
            out[k].0 += tiles.len();
            out[k].1 += 1;
            let g = pool_gap_min() - 1;
            for &(x, y) in &tiles {
                for dy in -g..=g {
                    for dx in -g..=g {
                        if let Some(i) = at(m, (x + dx, y + dy)) {
                            blocked[i] = true;
                        }
                    }
                }
            }
        }
    }
    out
}

/// M1-M7, one row per seed, then min / median / max. See the brief's section 12 for the columns.
#[test]
#[ignore]
fn report_seeds_1_to_32() {
    tally(maps(), off_maps()).print("seeds 1-32");
}

/// P-LAND-PLAGUE-1-fix: the same figures for the seeds the pools were not tuned on (33-96) and for all of 1-96: per
/// seed rows of 33-96, then the summary of 33-96, then the summary of 1-96. Slow (two blocks of maps and M5's greedy
/// packing per seed); a release build is advised.
#[test]
#[ignore]
fn report_wide() {
    let mut wide = tally(wide_maps(), wide_off_maps());
    wide.print("seeds 33-96");
    let mut all = Tally::quiet(maps(), off_maps());
    all.add(wide);
    all.print("seeds 1-96");
}

/// The report's accumulators over one block of seeds.
#[derive(Default)]
struct Tally {
    cols: BTreeMap<String, Vec<f64>>,
    refused: BTreeMap<String, usize>,
    by_band: BTreeMap<String, (usize, usize)>,
    close_pairs: [usize; 2],
    sizes_seen: BTreeMap<String, usize>,
}

impl Tally {
    /// The tally of a block without its per-seed rows.
    fn quiet(on: &[Landed], off: &[(i64, GameMapData)]) -> Tally {
        tally_rows(on, off, false)
    }

    fn add(&mut self, other: Tally) {
        for (k, v) in other.cols {
            self.cols.entry(k).or_default().extend(v);
        }
        for (k, n) in other.refused {
            *self.refused.entry(k).or_default() += n;
        }
        for (k, (n, a)) in other.by_band {
            let e = self.by_band.entry(k).or_default();
            e.0 += n;
            e.1 += a;
        }
        self.close_pairs[0] += other.close_pairs[0];
        self.close_pairs[1] += other.close_pairs[1];
        for (k, n) in other.sizes_seen {
            *self.sizes_seen.entry(k).or_default() += n;
        }
    }

    fn print(&mut self, label: &str) {
        eprintln!("== summary, {label} (min / median / max) ==");
        for (k, v) in &mut self.cols {
            summary(k, v);
        }
        eprintln!(
            "M3 pairs of pieces closer than {}: on {} off {}",
            pool_gap_min(),
            self.close_pairs[0],
            self.close_pairs[1]
        );
        for (b, (n, area)) in &self.by_band {
            eprintln!(
                "M4 band {b}: {n} pieces, mean area {:.1}",
                *area as f64 / *n as f64
            );
        }
        eprintln!("size classes of today's pieces: {:?}", self.sizes_seen);
        eprintln!(
            "refusals before the accepted attempt (option on): {:?}",
            self.refused
        );
    }
}

/// The tally of a block, printing one row per seed.
fn tally(on: &[Landed], off: &[(i64, GameMapData)]) -> Tally {
    tally_rows(on, off, true)
}

fn tally_rows(on: &[Landed], off_maps: &[(i64, GameMapData)], rows: bool) -> Tally {
    let mut t = Tally::default();
    let Tally {
        cols,
        refused,
        by_band,
        close_pairs,
        sizes_seen,
    } = &mut t;
    let mut push = |k: &str, v: f64| cols.entry(k.to_string()).or_default().push(v);
    for (l, (seed, off)) in on.iter().zip(off_maps) {
        assert_eq!(l.seed, *seed);
        let m = &l.map;
        let a = anchor(l.seed, m);
        for r in &l.refusals {
            *refused.entry(r.clone()).or_default() += 1;
        }
        let (bog_on, bog_off) = (styler_bog(m).len(), styler_bog(off).len());
        let (free_on, free_off) = (free_ground(m, Some(a)), free_ground(off, None));
        let tree_bog = (0..m.tiles.len()).filter(|&i| is_tree_bog(m, i)).count();
        let share_on = bog_on as f64 / free_on as f64;
        let share_off = bog_off as f64 / free_off as f64;
        push("M1 styler bog on", bog_on as f64);
        push("M1 styler bog off", bog_off as f64);
        push("M1 tree bog on", tree_bog as f64);
        push("M1 free ground on", free_on as f64);
        push("M1 free ground off", free_off as f64);
        push("M1 share on %", 100.0 * share_on);
        push("M1 share off %", 100.0 * share_off);
        push("M1 ratio on/off", share_on / share_off);
        let mut row = format!(
            "seed {:2}: att {} off-att {} | bog on {bog_on} off {bog_off} tree {tree_bog} | free on {free_on} off {free_off} | share on {:.2}% off {:.2}% ratio {:.2} | ",
            l.seed,
            l.attempt,
            off.attempt,
            100.0 * share_on,
            100.0 * share_off,
            share_on / share_off
        );
        for (k, (mm, which)) in [(m, "on"), (off, "off")].into_iter().enumerate() {
            let ps = pools(mm);
            push(&format!("M2 pieces {which}"), ps.len() as f64);
            for p in &ps {
                push(&format!("M2 piece area {which}"), p.len() as f64);
                let (w, h) = bbox(p);
                push(&format!("M2 piece box long side {which}"), w.max(h) as f64);
                push(
                    &format!("M2 piece share in 3x3 % {which}"),
                    share_in_3x3(p) as f64,
                );
                push(
                    &format!("M2 piece inscribed r2 {which}"),
                    inscribed_r2(p) as f64,
                );
                *sizes_seen
                    .entry(format!("{which} {:?}", size_class(p)))
                    .or_default() += 1;
            }
            for i in 0..ps.len() {
                let nearest = (0..ps.len())
                    .filter(|&j| j != i)
                    .map(|j| gap(&ps[i], &ps[j]))
                    .min();
                if let Some(g) = nearest {
                    push(&format!("M3 nearest gap {which}"), g as f64);
                }
                for j in i + 1..ps.len() {
                    if gap(&ps[i], &ps[j]) < pool_gap_min() {
                        close_pairs[k] += 1;
                    }
                }
            }
            row += &format!(
                "{which}: {} pieces areas {:?} r2 {:?} | ",
                ps.len(),
                ps.iter().map(|p| p.len()).collect::<Vec<_>>(),
                ps.iter().map(|p| inscribed_r2(p)).collect::<Vec<_>>()
            );
        }
        for p in pools(m) {
            let b = format!("{:?}", pool_band(a, &p));
            let e = by_band.entry(b).or_default();
            e.0 += 1;
            e.1 += p.len();
        }
        let target = share_off * free_on as f64;
        for (variant, barrows_free) in [("barrows stay", false), ("barrows give way", true)] {
            let masks = Masks {
                barrows_free,
                halo: halo(m),
                pads: spawn_pads(m),
                routes: route_band(m),
            };
            let mut room = String::new();
            for across in disc_across() {
                let mut n = [0usize; 4];
                for i in (0..m.tiles.len()).filter(|&i| in_plague(m, i)) {
                    let c = cell(m, i);
                    if !disc_fits(m, a, &masks, c, across) {
                        continue;
                    }
                    let nearest = disc_offsets(across)
                        .iter()
                        .map(|&(dx, dy)| band(a, c.0 + dx, c.1 + dy))
                        .min()
                        .unwrap();
                    n[nearest as usize] += 1;
                }
                for (b, name) in [(1, "near"), (2, "mid"), (3, "far")] {
                    push(
                        &format!("M5 {variant}: centres {across} {name}"),
                        n[b] as f64,
                    );
                    push(
                        &format!("M5 {variant}: seeds with a centre {across} {name}"),
                        f64::from(u8::from(n[b] > 0)),
                    );
                }
                room += &format!("{across}: near {} mid {} far {} ", n[1], n[2], n[3]);
            }
            for (plan_name, plan) in [
                (
                    "strict",
                    vec![
                        (Band::Near, vec![12]),
                        (Band::Mid, vec![8]),
                        (Band::Far, vec![5]),
                    ],
                ),
                (
                    "fallback",
                    vec![
                        (Band::Near, vec![12, 8]),
                        (Band::Mid, vec![12, 8, 5]),
                        (Band::Far, vec![8, 5]),
                    ],
                ),
            ] {
                let cap = greedy_capacity(m, a, &masks, &plan);
                let total: usize = cap.iter().map(|c| c.0).sum();
                let key = format!("M5 {variant}: greedy {plan_name}");
                push(&format!("{key} capacity / target"), total as f64 / target);
                push(&format!("{key} near area"), cap[0].0 as f64);
                push(&format!("{key} mid area"), cap[1].0 as f64);
                push(&format!("{key} far area"), cap[2].0 as f64);
                row += &format!(
                    "{variant} {plan_name}: near {:?} mid {:?} far {:?} = {total}/{target:.0} ({:.2}) | ",
                    cap[0],
                    cap[1],
                    cap[2],
                    total as f64 / target
                );
            }
            row += &format!("{variant} room {room}| ");
        }
        push("M6 attempt on", l.attempt as f64);
        push("M6 attempt off", off.attempt as f64);
        let det = bog_detours(m);
        let worst = det.iter().copied().max().unwrap_or(0);
        push("M7 worst bog detour on", f64::from(worst.min(999)));
        let det_off = bog_detours(off).into_iter().max().unwrap_or(0);
        push("M7 worst bog detour off", f64::from(det_off.min(999)));
        let (bon, boff) = (barrows(m), barrows(off));
        push("M8 barrows on", bon.len() as f64);
        push("M8 barrows off", boff.len() as f64);
        push(
            "M9 features on (certifier cap 250)",
            m.features.len() as f64,
        );
        push(
            "M9 Plague features on",
            m.features.iter().filter(|f| f.zone == Zone::Plague).count() as f64,
        );
        row += &format!(
            "detour {worst} | barrows on {} off {} bog-owning {}",
            bon.len(),
            boff.len(),
            bon.iter().filter(|b| b.2 > 0).count()
        );
        if rows {
            eprintln!("{row}");
        }
    }
    t
}

/// One sheet line per tile row of the Plague zone's bounding box (`SHEET` header, then `SHEET|` rows). Characters:
/// space outside the Plague zone; `T` the tree's footprint (trunk and its dry ring); `B` the tree's own bog; `b` styler
/// bog; `r` barrow rock (wall owned by a `Barrow`); `#` any other wall; `o` any LOW tile; on plain floor `p` a spawn's
/// 5x5 pad, `:` a camp halo, `.` the rest.
fn sheet(label: &str, seed: i64, m: &GameMapData) {
    let tree = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Plague)
        .map(|a| a.footprint);
    let cells: Vec<Cell> = (0..m.tiles.len())
        .filter(|&i| in_plague(m, i))
        .map(|i| cell(m, i))
        .collect();
    let x0 = cells.iter().map(|c| c.0).min().unwrap();
    let x1 = cells.iter().map(|c| c.0).max().unwrap();
    let y0 = cells.iter().map(|c| c.1).min().unwrap();
    let y1 = cells.iter().map(|c| c.1).max().unwrap();
    let (halo, pads) = (halo(m), spawn_pads(m));
    println!(
        "SHEET {label} seed={seed} attempt={} x0={x0} y0={y0} w={} h={}",
        m.attempt,
        x1 - x0 + 1,
        y1 - y0 + 1
    );
    for y in y0..=y1 {
        let mut line = String::from("SHEET|");
        for x in x0..=x1 {
            let i = at(m, (x, y)).unwrap();
            let in_tree = tree.is_some_and(|f| {
                x >= f.x && y >= f.y && x < f.x + f.w as i32 && y < f.y + f.h as i32
            });
            let ch = if !in_plague(m, i) {
                ' '
            } else if is_tree_bog(m, i) {
                'B'
            } else if is_styler_bog(m, i) {
                'b'
            } else if in_tree {
                'T'
            } else if m.tiles[i] == 1 {
                if owner_kind(m, i) == Some(FeatureKind::Barrow) {
                    'r'
                } else {
                    '#'
                }
            } else if m.tiles[i] != 0 {
                'o'
            } else if pads[i] {
                'p'
            } else if halo[i] {
                ':'
            } else {
                '.'
            };
            line.push(ch);
        }
        println!("{line}");
    }
}

/// The sheet dump for the owner: seeds 1-8, option on and option off. Run with
/// `--ignored --nocapture sheet_seeds_1_to_8` and keep the lines starting `SHEET`.
#[test]
#[ignore]
fn sheet_seeds_1_to_8() {
    for (l, (_, off)) in maps().iter().zip(off_maps()).take(8) {
        sheet("on", l.seed, &l.map);
        sheet("off", l.seed, off);
    }
}
