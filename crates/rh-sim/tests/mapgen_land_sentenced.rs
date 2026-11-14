//! Oracle of P-LAND-SENTENCED-1, revision 2, "lanes" (brief `docs/backlog/packets/P-LAND-SENTENCED-1.md`; owner
//! decision 2026-11-13, "Option 1: churchyard plus lanes"). With `pipeline::Options::signature` on, the Sentenced
//! styler's fence rows run parallel to the church's door axis, on a lattice symmetric about it, and every row is cut by
//! the same 3-wide gate every 12 tiles counted from the church door, so the gates line up into cross lanes. No legacy
//! counterpart: legacy has no church; `packages/shared/src/zoneStyle/gallows.ts` lays parallel fence rows across the
//! zone, which option off keeps byte for byte.
//!
//! Every check is a property measured from the map's Sentenced anchor over seeds 1-32 (option on, the server's options:
//! no decor). Nothing pins an option-on map, hash, attempt number or tile position: the landmark lane (the reserved
//! site, the 30-tile church, the churchyard) changes every option-on map while this packet is open.
//!
//! Definitions (tile units):
//! * door frame: `side`, the unit vector out of the church door (the dominant axis of `DIR16[anchor.front]`, as
//!   `signature/church.rs` builds the door); `along`, the signed distance from the door line (the line of the anchor's
//!   `entrance` tiles), positive out through the door; `across`, the other map coordinate.
//! * spine: the door axis, the line `across = spine` through the middle tile of the entrance. `d = across - spine`.
//! * lane line: a line `across = spine + d` with `|d| mod 8 == 4` (d = ±4, ±12, ±20 ...): rows stand only there, so the
//!   spine is an open lane 7 wide and the lattice is symmetric about it.
//! * cross-lane band: the tiles with `(along - 8).rem_euclid(12) < 3`, i.e. `along mod 12` in {8, 9, 10}: one gate every
//!   12 tiles, 3 wide, the same phase in every row (phase 8: the brief's measurement M3).
//! * yard box: the bounding box of the anchor's footprint and of every Sentenced `Graveyard` feature's bbox. Apron: the
//!   tiles at Chebyshev distance 1 or 2 from the yard box.
//! * lane fence tile: a LOW tile (2) of the Sentenced region owned by a `FenceRow` feature (the styler's fence; a future
//!   churchyard fence belongs to the church's blueprint, not to a `FenceRow`).
//! * free ground: a Sentenced tile that is floor (0) or a lane fence tile, owned by no feature other than a `FenceRow`,
//!   outside every camp halo and every spawn pad of the pool (the certifier's `protected` rule; the pad is 3x3). The
//!   lane fence share of a map is lane fence tiles / free ground tiles; both are computed live on both maps.
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::runtime::chamfer;
use rh_sim::mapgen::{certify, coliseum, map_hash, pipeline, style_gallows, style_runtime};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

fn seeds() -> std::ops::RangeInclusive<i64> {
    1..=32
}

/// The attempts `certified_styled` may use (`pipeline` rules, `certified_attempts`).
fn attempt_limit() -> u64 {
    16
}

/// Brief section 7: the worst attempt index on seeds 1-32 (option on).
/// Re-taken for P-MAPGEN-SIG-SCALE-4 (the three-stream volcano): measured 89 attempts and worst 9 over seeds 1-32;
/// the volcano oracle's bounds, headroom about 50% and three attempts: worst 12.
fn worst_attempt_allowed() -> u64 {
    12
}

/// Owner decision 2026-11-13: lane lines 8 apart.
fn lane_spacing() -> i32 {
    8
}

/// The lattice's offset from the spine (coordinator's choice, confirmed by the brief's measurement M3).
fn lane_offset() -> i32 {
    4
}

/// Owner decision: one gate every 12 tiles, 3 wide.
fn gate_period() -> i32 {
    12
}

fn gate_width() -> i32 {
    3
}

/// The gate band's phase from the entrance: the coordinator proposed 3; the brief's measurement M3 moved it to 8 (the
/// best phase on seeds 1-32 that also beats 3 on most seeds: 24 of 32).
fn gate_phase() -> i32 {
    8
}

/// No lane fence within this Chebyshev distance of the yard box.
fn apron() -> i32 {
    2
}

/// The budget (brief sections 8 and 12, M4): the median over seeds 1-32 of (option-on lane fence share) / (option-off
/// lane fence share) lies in this range. BUDGET SHORT: the owner's target is [0.8, 1.2]; the lanes ceiling measured
/// 0.81 and the ceiling after the detour rule 0.78 (median), so the lower bound is set at 0.6, leaving 0.18 for what
/// the estimate does not model (route repair, relaxation, the runtime's placement checks).
///
/// Owner decision 2026-11-13 (night; brief P-MAPGEN-SIG-SCALE-2-fix): with the 29 x 29 church the lanes alone hold
/// 0.53 of option off's share (the box and its apron take ground the lanes cannot use), and the churchyard's own fence
/// is judged with them (`combined_floor`). The lanes' own lower bound is 0.45, was 0.6.
fn budget() -> (f64, f64) {
    (0.45, 1.2)
}

/// Owner decision 2026-11-13 (night): lane fence and the churchyard's own fence together (the LOW tiles the
/// `Graveyard` feature owns: the churchyard fence and the plot fences of the church's drawing) hold at least this much
/// of option off's lane fence, in tiles, on the median map of seeds 1-32.
fn combined_floor() -> f64 {
    0.75
}

/// Every seed keeps at least this ratio (same measure as `budget`): the smallest ceiling after detours measured 0.53.
fn seed_floor() -> f64 {
    0.3
}

/// Owner direction: no straight run of fence longer than 9 (the certifier's `fence_run`).
fn run_max() -> usize {
    9
}

/// The styler's existing smallest fence piece (`style_gallows::Definition::min_piece`).
fn min_piece() -> usize {
    style_gallows::default_definition().min_piece
}

fn tile_size() -> f64 {
    32.0
}

fn sentenced() -> u8 {
    Zone::Sentenced.code()
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

/// Seeds 1-32 with the option on, generated once per test binary.
fn maps() -> &'static Vec<Landed> {
    static MAPS: OnceLock<Vec<Landed>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        seeds().map(|seed| land(&generator, seed)).collect()
    })
}

/// Seeds 1-32 with the option off (no decor), in seed order, generated once per test binary.
fn off_maps() -> &'static Vec<GameMapData> {
    static MAPS: OnceLock<Vec<GameMapData>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        seeds()
            .map(|seed| {
                generator
                    .certified_styled(seed, off_options())
                    .expect("generator error")
                    .unwrap_or_else(|| panic!("seed {seed}: no option-off map"))
            })
            .collect()
    })
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

/// A lane fence tile (file comment).
fn is_lane_fence(m: &GameMapData, i: usize) -> bool {
    m.region_grid[i] == sentenced()
        && m.tiles[i] == 2
        && owner_kind(m, i) == Some(FeatureKind::FenceRow)
}

/// Every lane fence tile of the Sentenced zone.
fn lane_fence(m: &GameMapData) -> BTreeSet<Cell> {
    (0..m.tiles.len())
        .filter(|&i| is_lane_fence(m, i))
        .map(|i| cell(m, i))
        .collect()
}

fn anchor(seed: i64, m: &GameMapData) -> &ZoneAnchor {
    let a = m
        .anchors
        .iter()
        .find(|a| a.zone == Zone::Sentenced)
        .unwrap_or_else(|| panic!("seed {seed}: no Sentenced anchor"));
    assert_eq!(a.kind, FeatureKind::Church, "seed {seed}: Sentenced anchor");
    assert!(!a.entrance.is_empty(), "seed {seed}: church without a door");
    a
}

fn door_side(front: u8) -> Cell {
    let v = DIR16[usize::from(front)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

/// The door frame and the yard box in it (file comment): `[a0, a1]` along by `[c0, c1]` across.
#[derive(Clone, Copy, Debug)]
struct Frame {
    side: Cell,
    line: i32,
    spine: i32,
    a0: i32,
    a1: i32,
    c0: i32,
    c1: i32,
}

impl Frame {
    fn of(c: Cell, side: Cell, line: i32) -> (i32, i32) {
        if side.0 != 0 {
            ((c.0 - line) * side.0, c.1)
        } else {
            ((c.1 - line) * side.1, c.0)
        }
    }

    /// `(along, across)` of a tile.
    fn frame(&self, c: Cell) -> (i32, i32) {
        Self::of(c, self.side, self.line)
    }

    /// The signed offset of a tile from the spine.
    fn d(&self, c: Cell) -> i32 {
        self.frame(c).1 - self.spine
    }

    /// Chebyshev distance of a tile from the yard box (0 inside).
    fn distance(&self, c: Cell) -> i32 {
        let (a, x) = self.frame(c);
        (self.a0 - a)
            .max(a - self.a1)
            .max(0)
            .max((self.c0 - x).max(x - self.c1).max(0))
    }

    /// The tile at the middle of the entrance.
    fn entrance(&self) -> Cell {
        if self.side.0 != 0 {
            (self.line, self.spine)
        } else {
            (self.spine, self.line)
        }
    }

    /// `FenceRow` axis code of a row parallel to the spine (0: rows along x, as `style_gallows::Plan::axis`).
    fn axis(&self) -> i32 {
        i32::from(self.side.0 == 0)
    }

    fn facing(&self) -> char {
        match self.side {
            (1, 0) => 'E',
            (-1, 0) => 'W',
            (0, 1) => 'S',
            _ => 'N',
        }
    }
}

fn yard(seed: i64, m: &GameMapData) -> Frame {
    let a = anchor(seed, m);
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
    let (lo, hi) = (*across.iter().min().unwrap(), *across.iter().max().unwrap());
    let mut rects = vec![a.footprint];
    rects.extend(
        m.features
            .iter()
            .filter(|f| f.kind == FeatureKind::Graveyard && f.zone == Zone::Sentenced)
            .map(|f| f.bbox),
    );
    let (mut a0, mut a1, mut c0, mut c1) = (i32::MAX, i32::MIN, i32::MAX, i32::MIN);
    for r in rects {
        for c in [(r.x, r.y), (r.x + r.w as i32 - 1, r.y + r.h as i32 - 1)] {
            let (al, ac) = Frame::of(c, side, line);
            a0 = a0.min(al);
            a1 = a1.max(al);
            c0 = c0.min(ac);
            c1 = c1.max(ac);
        }
    }
    Frame {
        side,
        line,
        spine: (lo + hi).div_euclid(2),
        a0,
        a1,
        c0,
        c1,
    }
}

/// A lattice: lane lines at `|d| mod 8 == offset mod 8`, gate bands at `(along - phase) mod 12 < 3`.
#[derive(Clone, Copy, Debug)]
struct Lattice {
    offset: i32,
    phase: i32,
}

impl Lattice {
    fn owners() -> Self {
        Self {
            offset: lane_offset(),
            phase: gate_phase(),
        }
    }

    fn on_line(&self, d: i32) -> bool {
        d.abs() % lane_spacing() == self.offset.rem_euclid(lane_spacing())
    }

    fn in_band(&self, along: i32) -> bool {
        (along - self.phase).rem_euclid(gate_period()) < gate_width()
    }
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

/// Pieces of `cells` (8-connected, as `style_gallows/detours.rs` and the certifier's `feature-size` count them).
fn pieces(cells: &BTreeSet<Cell>) -> Vec<Vec<Cell>> {
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
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let n = (x + dx, y + dy);
                    if cells.contains(&n) && seen.insert(n) {
                        group.push(n);
                    }
                }
            }
        }
        out.push(group);
    }
    out
}

// --------------------------------------------------------------------------------------------------------------------
// Free ground and the share (budget).
// --------------------------------------------------------------------------------------------------------------------

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

/// The pad round every spawn of the pool (the certifier's `protected` rule: the square of half-width `R.spawn_pad`,
/// 3x3 today).
fn spawn_pads(m: &GameMapData) -> Vec<bool> {
    let r = certify::rules::R.spawn_pad;
    let mut out = vec![false; m.tiles.len()];
    for s in &m.spawn_pool {
        let (sx, sy) = world_cell(s.x, s.y);
        for dy in -r..=r {
            for dx in -r..=r {
                if let Some(i) = at(m, (sx + dx, sy + dy)) {
                    out[i] = true;
                }
            }
        }
    }
    out
}

/// Free ground (file comment), one flag per tile.
fn free_ground(m: &GameMapData) -> Vec<bool> {
    let (halo, pads) = (halo(m), spawn_pads(m));
    (0..m.tiles.len())
        .map(|i| {
            let fence = is_lane_fence(m, i);
            m.region_grid[i] == sentenced()
                && (m.tiles[i] == 0 || fence)
                && (fence || m.feature_grid[i] == 0)
                && !halo[i]
                && !pads[i]
        })
        .collect()
}

/// `(lane fence tiles, free ground tiles)` of a map.
fn share_parts(m: &GameMapData) -> (usize, usize) {
    (
        lane_fence(m).len(),
        free_ground(m).iter().filter(|&&f| f).count(),
    )
}

fn share(m: &GameMapData) -> f64 {
    let (fence, free) = share_parts(m);
    fence as f64 / free.max(1) as f64
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Rules 2-4: the lattice, the cross lanes, the apron.
// --------------------------------------------------------------------------------------------------------------------

/// Rules 1-2: every lane fence tile stands on a lane line (`|d| mod 8 == 4`): rows parallel to the door axis, symmetric
/// about it, the spine open 7 wide, no jogs.
#[test]
fn every_lane_fence_tile_stands_on_a_lane_line() {
    let lat = Lattice::owners();
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        let all = lane_fence(&l.map);
        let off: Vec<Cell> = all
            .iter()
            .copied()
            .filter(|&c| !lat.on_line(f.d(c)))
            .collect();
        if !off.is_empty() {
            let mut by_d: BTreeMap<i32, usize> = BTreeMap::new();
            for &c in &off {
                *by_d.entry(f.d(c).abs() % lane_spacing()).or_default() += 1;
            }
            findings.push(format!(
                "seed {}: {} of {} lane fence tiles are off the lane lines (|d| mod 8: tiles {:?}); first {:?}",
                l.seed,
                off.len(),
                all.len(),
                by_d,
                &off[..off.len().min(4)]
            ));
        }
    }
    verdict("lane fence off the lane lines", &findings);
}

/// Rule 3: no lane fence tile stands in a cross-lane band (`along mod 12` in {8, 9, 10} from the entrance), so every
/// row has its gates on one shared grid and the bands are fence-free cross lanes.
#[test]
fn no_lane_fence_tile_stands_in_a_cross_lane_band() {
    let lat = Lattice::owners();
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        let all = lane_fence(&l.map);
        let shut: Vec<Cell> = all
            .iter()
            .copied()
            .filter(|&c| lat.in_band(f.frame(c).0))
            .collect();
        if !shut.is_empty() {
            findings.push(format!(
                "seed {}: {} of {} lane fence tiles stand in a cross-lane band; first {:?}",
                l.seed,
                shut.len(),
                all.len(),
                &shut[..shut.len().min(4)]
            ));
        }
    }
    verdict("lane fence in a cross-lane band", &findings);
}

/// Rule 4: no lane fence tile within Chebyshev distance 2 of the yard box.
#[test]
fn no_lane_fence_tile_stands_within_two_of_the_yard_box() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        let near: Vec<(Cell, i32)> = lane_fence(&l.map)
            .into_iter()
            .map(|c| (c, f.distance(c)))
            .filter(|&(_, d)| d <= apron())
            .collect();
        if !near.is_empty() {
            findings.push(format!(
                "seed {}: {} lane fence tiles within {} of the yard box; first (tile, distance) {:?}",
                l.seed,
                near.len(),
                apron(),
                &near[..near.len().min(4)]
            ));
        }
    }
    verdict("lane fence in the yard box's apron", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Rule 5: the amount.
// --------------------------------------------------------------------------------------------------------------------

/// Per seed `(on/off share ratio, row text)`: option-on lane fence share of free ground over option-off's.
fn share_ratios() -> Vec<(f64, String)> {
    maps()
        .iter()
        .zip(off_maps())
        .map(|(l, off)| {
            let (on_f, on_g) = share_parts(&l.map);
            let (off_f, off_g) = share_parts(off);
            let r = share(&l.map) / share(off).max(f64::MIN_POSITIVE);
            (
                r,
                format!(
                    "seed {}: on {on_f}/{on_g} off {off_f}/{off_g} ratio {r:.2}",
                    l.seed
                ),
            )
        })
        .collect()
}

/// Rule 5 (and the non-triviality guard of rules 1-4): over seeds 1-32 the median of (option-on lane fence share of
/// free ground) / (option-off lane fence share) lies in the budget range.
#[test]
fn lane_fence_share_stays_near_option_off() {
    let (lo, hi) = budget();
    let rows = share_ratios();
    let m = median(rows.iter().map(|r| r.0).collect());
    assert!(
        (lo..=hi).contains(&m),
        "median on/off lane fence share ratio {m:.3} is outside [{lo}, {hi}]\n{}",
        rows.iter()
            .map(|r| r.1.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// Rule 5b (owner decision 2026-11-13, night): the lanes and the churchyard's own fence together. Per seed, (lane fence
/// tiles + LOW tiles owned by a Sentenced `Graveyard`, option on) / (lane fence tiles, option off); the median over seeds
/// 1-32 is at least `combined_floor`.
#[test]
fn lane_and_churchyard_fence_together_stay_near_option_off() {
    let rows: Vec<(f64, String)> = maps()
        .iter()
        .zip(off_maps())
        .map(|(l, off)| {
            let m = &l.map;
            let yard = (0..m.tiles.len())
                .filter(|&i| {
                    m.region_grid[i] == sentenced()
                        && m.tiles[i] == 2
                        && owner_kind(m, i) == Some(FeatureKind::Graveyard)
                })
                .count();
            let (on_f, _) = share_parts(m);
            let (off_f, _) = share_parts(off);
            let r = (on_f + yard) as f64 / (off_f as f64).max(1.0);
            (
                r,
                format!(
                    "seed {}: lanes {on_f} + churchyard {yard} against {off_f} off, ratio {r:.2}",
                    l.seed
                ),
            )
        })
        .collect();
    let m = median(rows.iter().map(|r| r.0).collect());
    assert!(
        m >= combined_floor(),
        "median (lane + churchyard fence) on / lane fence off, in tiles: {m:.3} under {}\n{}",
        combined_floor(),
        rows.iter()
            .map(|r| r.1.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// The per-seed guard: no seed loses its lanes (an axis or orientation the planner gets wrong shows here, not in the
/// median).
#[test]
fn every_seed_keeps_its_lanes() {
    let findings: Vec<String> = share_ratios()
        .into_iter()
        .filter(|r| r.0 < seed_floor())
        .map(|r| format!("{} (floor {})", r.1, seed_floor()))
        .collect();
    verdict("seeds with too little lane fence", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Kept: runs and pieces, certification, attempts, option off.
// --------------------------------------------------------------------------------------------------------------------

/// No straight run of lane fence (along x or along y) is longer than 9; no lane fence piece (8-connected) is smaller
/// than the styler's `min_piece`.
#[test]
fn fence_runs_stay_within_nine_and_pieces_keep_the_minimum() {
    let mut findings = Vec::new();
    for l in maps() {
        let all = lane_fence(&l.map);
        for &(x, y) in &all {
            for (dx, dy) in [(1, 0), (0, 1)] {
                if all.contains(&(x - dx, y - dy)) {
                    continue;
                }
                let mut len = 0;
                while all.contains(&(x + dx * len, y + dy * len)) {
                    len += 1;
                }
                if len as usize > run_max() {
                    findings.push(format!(
                        "seed {}: a fence run of {len} from ({x},{y}) along {}",
                        l.seed,
                        if dx == 1 { "x" } else { "y" }
                    ));
                }
            }
        }
        for p in pieces(&all) {
            if p.len() < min_piece() {
                findings.push(format!(
                    "seed {}: a fence piece of {} tiles at {:?}",
                    l.seed,
                    p.len(),
                    p[0]
                ));
            }
        }
    }
    verdict("fence runs and pieces", &findings);
}

/// Every accepted map certifies with zero failures under the strict certifier and keeps its church and its gallows
/// square.
#[test]
fn maps_certify_clean_and_keep_the_church_and_the_gallows_square() {
    let mut findings = Vec::new();
    for l in maps() {
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
        for kind in [FeatureKind::Church, FeatureKind::Gallows] {
            let n = m
                .features
                .iter()
                .filter(|f| f.kind == kind && f.zone == Zone::Sentenced)
                .count();
            if n != 1 {
                findings.push(format!("seed {}: {n} Sentenced {kind:?} features", l.seed));
            }
        }
    }
    verdict("certification and Sentenced features", &findings);
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
/// `mapgen_signature_frost.rs` pin for `Options::default()`), and the server's options (no decor) give the same fence.
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
        let bare = &off_maps()[(seed - 1) as usize];
        assert_eq!(
            lane_fence(bare),
            lane_fence(&m),
            "seed {seed}: decor moved the fence"
        );
    }
}

/// With decor on, the Sentenced props callback validates the styler's plan (`style_gallows` `validate_plan`: row gaps,
/// row phases, the square's row index); the server's options skip it. Seeds 1-8, option on with decor, at the attempt
/// the server's options land on: the map is made, and its lane fence is the same as without decor.
#[test]
fn option_on_with_decor_keeps_the_lane_fence() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let decor = pipeline::Options {
        signature: true,
        ..pipeline::Options::default()
    };
    for l in maps().iter().take(8) {
        let m = generator
            .styled_attempt(l.seed, l.attempt, decor)
            .unwrap_or_else(|e| panic!("seed {}: generator error with decor: {e:?}", l.seed))
            .unwrap_or_else(|| panic!("seed {}: attempt {} refused with decor", l.seed, l.attempt));
        assert_eq!(
            lane_fence(&m),
            lane_fence(&l.map),
            "seed {}: decor moved the lane fence",
            l.seed
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Reports (brief section 12; not gate checks). Run with `--ignored --nocapture`.
// --------------------------------------------------------------------------------------------------------------------

/// An approximation of the route guard's corridors (`style_runtime/route.rs`): from every Sentenced spawn of the pool,
/// the steepest descent of the walk distance to the coliseum (fence counted as ground), while in the zone, grown by one
/// tile all round.
fn route_band(m: &GameMapData) -> Vec<bool> {
    let n = m.tiles.len();
    let ground = |i: usize| m.tiles[i] != 1;
    let mut dist = vec![i32::MAX; n];
    let mut queue = VecDeque::new();
    let mut starts = vec![world_cell(m.coliseum.centre.x, m.coliseum.centre.y)];
    for g in &m.coliseum.gates {
        starts.extend(g.tiles.iter().map(|t| (t.x, t.y)));
    }
    for s in starts {
        if let Some(i) = at(m, s).filter(|&i| ground(i)) {
            dist[i] = 0;
            queue.push_back(i);
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
    let mut out = vec![false; n];
    for s in m.spawn_pool.iter().filter(|s| s.zone == Zone::Sentenced) {
        let Some(mut i) = at(m, world_cell(s.x, s.y)) else {
            continue;
        };
        while m.region_grid[i] == sentenced() && dist[i] != i32::MAX {
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

/// The styler's rim (`style_runtime` `open`: zone edge distance at least `rim_tiles * 3` in the 3/4 chamfer's thirds),
/// recomputed from the finished map's region grid.
fn inside_rim(m: &GameMapData) -> Vec<bool> {
    let mask: Vec<u8> = m
        .region_grid
        .iter()
        .map(|&z| u8::from(z == sentenced()))
        .collect();
    let edge = chamfer(&mask, m.w as usize, m.h as usize);
    let need = style_runtime::default_definition().rim_tiles * 3.0;
    edge.iter().map(|&e| f64::from(e) >= need).collect()
}

/// Ground a styler could fence: free ground inside the rim, and (when `routes` is given) off the route band.
fn fenceable(m: &GameMapData, routes: Option<&[bool]>) -> Vec<bool> {
    let (free, rim) = (free_ground(m), inside_rim(m));
    (0..m.tiles.len())
        .map(|i| free[i] && rim[i] && routes.is_none_or(|r| !r[i]))
        .collect()
}

/// The lanes ceiling (brief M2): fenceable tiles on a lane line, off the gate bands, more than `apron()` from the yard
/// box, in a straight run along the line of at least `min_piece`.
fn ceiling(m: &GameMapData, f: &Frame, lat: Lattice, ok: &[bool]) -> BTreeSet<Cell> {
    ceiling_with_stretch(m, f, lat, ok, 0)
}

/// Consecutive runs of sorted values.
fn runs(v: Vec<i32>) -> Vec<Vec<i32>> {
    let mut out = Vec::new();
    let mut run: Vec<i32> = Vec::new();
    for al in v {
        if run.last().is_some_and(|&p| al != p + 1) {
            out.push(std::mem::take(&mut run));
        }
        run.push(al);
    }
    if !run.is_empty() {
        out.push(run);
    }
    out
}

/// The ceiling when, as today's `rows.rs` `flush` does with `Dials::min_run`, an open stretch of a line (before the
/// gate bands cut it) shorter than `stretch` lays nothing (`stretch` 0: no such rule).
fn ceiling_with_stretch(
    m: &GameMapData,
    f: &Frame,
    lat: Lattice,
    ok: &[bool],
    stretch: usize,
) -> BTreeSet<Cell> {
    let mut lines: BTreeMap<i32, Vec<i32>> = BTreeMap::new();
    for (i, _) in ok.iter().enumerate().filter(|(_, &o)| o) {
        let c = cell(m, i);
        let (al, ac) = f.frame(c);
        if lat.on_line(ac - f.spine) && f.distance(c) > apron() {
            lines.entry(ac).or_default().push(al);
        }
    }
    let mut out = BTreeSet::new();
    let to_cell = |al: i32, ac: i32| -> Cell {
        if f.side.0 != 0 {
            (f.line + al * f.side.0, ac)
        } else {
            (ac, f.line + al * f.side.1)
        }
    };
    for (ac, mut v) in lines {
        v.sort_unstable();
        for open in runs(v).into_iter().filter(|r| r.len() >= stretch) {
            let kept: Vec<i32> = open.into_iter().filter(|&a| !lat.in_band(a)).collect();
            for run in runs(kept) {
                if run.len() >= min_piece() {
                    out.extend(run.iter().map(|&a| to_cell(a, ac)));
                }
            }
        }
    }
    out
}

/// An estimate of what a lanes planner keeps of a ceiling (brief M2, "after detours"): today's lane fence is taken off
/// the map, the ceiling is laid instead, then, as `style_gallows/detours.rs` `plan_detours` does, every tile that fails
/// the fence detour (`R.fence_reach` pairs, a walk of at most `2k + R.fence_detour` round it inside the zone) is
/// dropped, then every piece under `min_piece`, until nothing changes. Route repair and relaxation are not modelled.
fn after_detours(m: &GameMapData, ceiling: &BTreeSet<Cell>) -> BTreeSet<Cell> {
    let r = certify::rules::R;
    let (w, h) = (m.w as i32, m.h as i32);
    let zone = |c: Cell| at(m, c).is_some_and(|i| m.region_grid[i] == sentenced());
    let mut low: Vec<bool> = (0..m.tiles.len())
        .map(|i| m.tiles[i] != 0 && !is_lane_fence(m, i))
        .collect();
    for &c in ceiling {
        low[at(m, c).unwrap()] = true;
    }
    let floor = |low: &[bool], c: Cell| zone(c) && !low[at(m, c).unwrap()];
    let mut live = ceiling.clone();
    let (mut seen, mut depth) = (vec![0u32; m.tiles.len()], vec![0i32; m.tiles.len()]);
    let mut stamp = 0u32;
    for _ in 0..16 {
        let mut gone = Vec::new();
        for &c in &live {
            let mut holds = true;
            'pairs: for (sx, sy) in [(0, 1), (1, 0)] {
                for k in 1..=r.fence_reach {
                    let (a, b) = ((c.0 - k * sx, c.1 - k * sy), (c.0 + k * sx, c.1 + k * sy));
                    if !floor(&low, a) || !floor(&low, b) {
                        break;
                    }
                    let limit = 2 * k + r.fence_detour as i32;
                    stamp += 1;
                    let ia = at(m, a).unwrap();
                    seen[ia] = stamp;
                    depth[ia] = 0;
                    let mut queue = VecDeque::from([a]);
                    let mut found = false;
                    while let Some(p) = queue.pop_front() {
                        if p == b {
                            found = true;
                            break;
                        }
                        let dp = depth[at(m, p).unwrap()];
                        if dp >= limit {
                            continue;
                        }
                        for (dx, dy) in [(0, -1), (1, 0), (0, 1), (-1, 0)] {
                            let q = (p.0 + dx, p.1 + dy);
                            if q.0 < 0 || q.1 < 0 || q.0 >= w || q.1 >= h || q == c {
                                continue;
                            }
                            let iq = at(m, q).unwrap();
                            if seen[iq] != stamp && floor(&low, q) {
                                seen[iq] = stamp;
                                depth[iq] = dp + 1;
                                queue.push_back(q);
                            }
                        }
                    }
                    if !found {
                        holds = false;
                        break 'pairs;
                    }
                }
            }
            if !holds {
                gone.push(c);
            }
        }
        for c in &gone {
            low[at(m, *c).unwrap()] = false;
            live.remove(c);
        }
        let mut small = Vec::new();
        for p in pieces(&live) {
            if p.len() < min_piece() {
                small.extend(p);
            }
        }
        for c in &small {
            low[at(m, *c).unwrap()] = false;
            live.remove(c);
        }
        if gone.is_empty() && small.is_empty() {
            break;
        }
    }
    live
}

fn stats(v: &[f64]) -> String {
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    format!(
        "min {:.2} median {:.2} max {:.2}",
        s[0],
        median(s.clone()),
        s[s.len() - 1]
    )
}

/// One seed's lanes figures for one lattice: the ceiling with and without the route band, and what survives the
/// detour rule (`after_detours`) of the ceiling without the route band, each as tiles.
struct Lanes {
    strict: BTreeSet<Cell>,
    loose: BTreeSet<Cell>,
    kept: BTreeSet<Cell>,
}

fn lanes(m: &GameMapData, f: &Frame, lat: Lattice, strict: &[bool], loose: &[bool]) -> Lanes {
    let loose_ceiling = ceiling(m, f, lat, loose);
    Lanes {
        strict: ceiling(m, f, lat, strict),
        kept: after_detours(m, &loose_ceiling),
        loose: loose_ceiling,
    }
}

/// The brief's measurement M1-M5 (run with `--ignored --nocapture`): one row per seed, then min / median / max of each
/// column. Shares are of free ground (file comment); "x off" is a share divided by the option-off lane fence share of
/// the same seed. M2's strict ceiling also leaves out an approximate route band (`route_band`); the loose ceiling keeps
/// it (today's planner, `Route::Repair`, does not keep fence off the routes up front); "kept" is what of the loose
/// ceiling survives the detour rule and `min_piece`.
#[test]
#[ignore]
fn report_lanes_seeds_1_to_32() {
    let owners = Lattice::owners();
    let mut cols: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    let mut push = |k: &str, v: f64| cols.entry(k.to_string()).or_default().push(v);
    let mut same_axis = 0;
    let mut refused: BTreeMap<String, usize> = BTreeMap::new();
    let mut sweep: BTreeMap<(i32, i32), Vec<[f64; 2]>> = BTreeMap::new();
    for (l, off) in maps().iter().zip(off_maps()) {
        let m = &l.map;
        let f = yard(l.seed, m);
        for r in &l.refusals {
            *refused.entry(r.clone()).or_default() += 1;
        }
        // M1: the door axis against today's FenceRow axis (`FenceRow` params [axis, index, phase]).
        let axes: BTreeSet<i32> = m
            .features
            .iter()
            .filter(|x| x.kind == FeatureKind::FenceRow && x.zone == Zone::Sentenced)
            .filter_map(|x| x.p.first().copied())
            .collect();
        let same = axes.len() == 1 && axes.contains(&f.axis());
        same_axis += usize::from(same);
        // M4.
        let (on_f, on_g) = share_parts(m);
        let (off_f, off_g) = share_parts(off);
        let (s_on, s_off) = (share(m), share(off));
        let x_off = |n: usize| n as f64 / on_g.max(1) as f64 / s_off;
        // M2.
        let routes = route_band(m);
        let (strict, loose) = (fenceable(m, Some(&routes)), fenceable(m, None));
        let today = lane_fence(m);
        let on_band = today.iter().filter(|&&c| routes[at(m, c).unwrap()]).count();
        let unfenceable = today.iter().filter(|&&c| !loose[at(m, c).unwrap()]).count();
        let o = lanes(m, &f, owners, &strict, &loose);
        let min_run = style_gallows::default_dials().min_run as usize;
        let with_min_run = ceiling_with_stretch(m, &f, owners, &loose, min_run);
        let kept_min_run = after_detours(m, &with_min_run);
        push(
            "m2 loose ceiling with min_run x off share",
            x_off(with_min_run.len()),
        );
        push(
            "m2 kept with min_run x off share",
            x_off(kept_min_run.len()),
        );
        // M3.
        for lat in (0..12)
            .map(|p| (lane_offset(), p))
            .chain((3..=8).map(|o| (o, gate_phase())))
        {
            let lat = Lattice {
                offset: lat.0,
                phase: lat.1,
            };
            let loose_c = ceiling(m, &f, lat, &loose);
            let kept = after_detours(m, &loose_c);
            sweep
                .entry((lat.offset, lat.phase))
                .or_default()
                .push([x_off(loose_c.len()), x_off(kept.len())]);
        }
        // M5.
        let (minus, plus) = (
            o.loose.iter().filter(|&&c| f.d(c) < 0).count(),
            o.loose.iter().filter(|&&c| f.d(c) > 0).count(),
        );
        let lop = minus.min(plus) as f64 / minus.max(plus).max(1) as f64;
        eprintln!(
            "seed {:2} att {} facing {} axis door {} fence {:?} same {} | on {on_f}/{on_g} {:.4} off {off_f}/{off_g} {:.4} on/off {:.2} | ceiling strict {} ({:.2} x off) loose {} ({:.2} x off) kept {} ({:.2} x off) | today's fence on the route band {on_band}, unfenceable {unfenceable} | sides -{minus} +{plus} ({:.2})",
            l.seed,
            l.attempt,
            f.facing(),
            f.axis(),
            axes,
            same,
            s_on,
            s_off,
            s_on / s_off,
            o.strict.len(),
            x_off(o.strict.len()),
            o.loose.len(),
            x_off(o.loose.len()),
            o.kept.len(),
            x_off(o.kept.len()),
            lop
        );
        push("attempt", l.attempt as f64);
        push("m2 strict ceiling tiles", o.strict.len() as f64);
        push("m2 strict ceiling x off share", x_off(o.strict.len()));
        push(
            "m2 strict ceiling % of on fence",
            100.0 * o.strict.len() as f64 / on_f as f64,
        );
        push(
            "m2 strict ceiling % of off fence",
            100.0 * o.strict.len() as f64 / off_f as f64,
        );
        push("m2 loose ceiling tiles", o.loose.len() as f64);
        push("m2 loose ceiling x off share", x_off(o.loose.len()));
        push(
            "m2 loose ceiling % of on fence",
            100.0 * o.loose.len() as f64 / on_f as f64,
        );
        push(
            "m2 loose ceiling % of off fence",
            100.0 * o.loose.len() as f64 / off_f as f64,
        );
        push("m2 kept tiles", o.kept.len() as f64);
        push("m2 kept x off share", x_off(o.kept.len()));
        push(
            "m2 kept % of off fence",
            100.0 * o.kept.len() as f64 / off_f as f64,
        );
        push("m4 fence on", on_f as f64);
        push("m4 fence off", off_f as f64);
        push("m4 free on", on_g as f64);
        push("m4 free off", off_g as f64);
        push("m4 share on", s_on);
        push("m4 share off", s_off);
        push("m4 ratio on/off", s_on / s_off);
        push("m5 sides min/max", lop);
        push(
            "check today's fence % on the route band",
            100.0 * on_band as f64 / today.len().max(1) as f64,
        );
        push("check today's fence unfenceable", unfenceable as f64);
    }
    eprintln!("M1: door axis equals today's fence axis on {same_axis} of 32");
    for (k, v) in &cols {
        eprintln!("{k}: {}", stats(v));
    }
    let base = &sweep[&(lane_offset(), gate_phase())];
    for ((o, p), v) in &sweep {
        let better = v.iter().zip(base).filter(|(a, b)| a[1] > b[1]).count();
        let worse = v.iter().zip(base).filter(|(a, b)| a[1] < b[1]).count();
        let diff: Vec<f64> = v.iter().zip(base).map(|(a, b)| a[1] - b[1]).collect();
        eprintln!(
            "M3 offset {o} phase {p:2} against offset {} phase {}: kept better on {better} seeds, worse on {worse}; difference {}",
            lane_offset(),
            gate_phase(),
            stats(&diff)
        );
    }
    for ((o, p), v) in &sweep {
        let loose: Vec<f64> = v.iter().map(|x| x[0]).collect();
        let kept: Vec<f64> = v.iter().map(|x| x[1]).collect();
        eprintln!(
            "M3 offset {o} phase {p:2}: loose ceiling x off {} | kept x off {}",
            stats(&loose),
            stats(&kept)
        );
    }
    eprintln!("refusals before the accepted attempt: {refused:?}");
}

/// The sheet dump (run with `--ignored --nocapture`): seeds 1-8, option on and option off, the Sentenced zone's bounding
/// box as text. Header `SHEET <on|off> seed=<n> attempt=<i> x0=<x> y0=<y> w=<w> h=<h>` (and, option on,
/// `entrance=<x>,<y> facing=<N|E|S|W>`), then `h` lines `SHEET|` + one character per tile: ` ` outside the zone, `#` wall,
/// `.` floor, `:` floor in a camp halo, `p` floor on a spawn pad, `f` lane fence, `o` any other LOW tile, `C` a tile
/// owned by the church, `g` by a graveyard, `S` by the gallows square, `H` by a guard house, `+` the middle entrance
/// tile; a tile owned by another feature shows its ground (`#`, `.`, `o`).
#[test]
#[ignore]
fn sheet_dump_seeds_1_to_8() {
    for (l, off) in maps().iter().zip(off_maps()).take(8) {
        for (name, m) in [("on", &l.map), ("off", off)] {
            let (halo, pads) = (halo(m), spawn_pads(m));
            let zone: Vec<Cell> = (0..m.tiles.len())
                .filter(|&i| m.region_grid[i] == sentenced())
                .map(|i| cell(m, i))
                .collect();
            let x0 = zone.iter().map(|c| c.0).min().unwrap();
            let x1 = zone.iter().map(|c| c.0).max().unwrap();
            let y0 = zone.iter().map(|c| c.1).min().unwrap();
            let y1 = zone.iter().map(|c| c.1).max().unwrap();
            let door = (name == "on").then(|| yard(l.seed, m));
            let mut head = format!(
                "SHEET {name} seed={} attempt={} x0={x0} y0={y0} w={} h={}",
                l.seed,
                m.attempt,
                x1 - x0 + 1,
                y1 - y0 + 1
            );
            if let Some(f) = door {
                let e = f.entrance();
                head += &format!(" entrance={},{} facing={}", e.0, e.1, f.facing());
            }
            println!("{head}");
            for y in y0..=y1 {
                let mut line = String::from("SHEET|");
                for x in x0..=x1 {
                    let i = at(m, (x, y)).unwrap();
                    let owner = usize::from(m.feature_grid[i])
                        .checked_sub(1)
                        .and_then(|k| m.features.get(k));
                    let ch = if m.region_grid[i] != sentenced() {
                        ' '
                    } else if door.is_some_and(|f| f.entrance() == (x, y)) {
                        '+'
                    } else if is_lane_fence(m, i) {
                        'f'
                    } else {
                        match owner.map(|o| (o.kind, o.variant.as_str())) {
                            Some((FeatureKind::Church, _)) => 'C',
                            Some((FeatureKind::Graveyard, _)) => 'g',
                            Some((FeatureKind::Gallows, _)) => 'S',
                            Some((FeatureKind::Landmark, "guardHouse")) => 'H',
                            _ => match m.tiles[i] {
                                1 => '#',
                                2 => 'o',
                                _ if halo[i] => ':',
                                _ if pads[i] => 'p',
                                _ => '.',
                            },
                        }
                    };
                    line.push(ch);
                }
                println!("{line}");
            }
        }
    }
}
