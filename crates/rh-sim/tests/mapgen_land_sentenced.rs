//! Oracle of P-LAND-SENTENCED-1 (brief `docs/backlog/packets/P-LAND-SENTENCED-1.md`): with
//! `pipeline::Options::signature` on, every fence of the Sentenced zone belongs to one of two rectangular enclosures
//! round the church and its graveyard, gated on one rhythm so the gates of both enclosures line up (owner direction
//! 2026-11-12). No legacy counterpart: legacy has no church; `packages/shared/src/zoneStyle/gallows.ts` lays parallel
//! fence rows, which option off keeps byte for byte.
//!
//! Every check is a property measured from the map's Sentenced anchor over seeds 1-32 (option on, the server's options:
//! no decor). Nothing pins an option-on map, hash, attempt number or tile position: the landmark lane changes every
//! option-on map several times while this packet is open.
//!
//! Definitions (tile units):
//! * door frame: `side`, the unit vector out of the church door (the dominant axis of `DIR16[anchor.front]`, as
//!   `signature/church.rs` builds the door); `along`, the signed distance from the door line (the line of the anchor's
//!   `entrance`) out through the door; `across`, the other coordinate (absolute).
//! * spine: the line `across = spine`, the middle tile of the entrance.
//! * yard box: the bounding box of the anchor's footprint and of every Sentenced `Graveyard` feature's bbox; in the door
//!   frame `[a0, a1]` along by `[c0, c1]` across.
//! * enclosure at distance d: the ring of tiles at Chebyshev distance exactly d from the yard box; inner d = 5, outer
//!   d = 12. Sides: front (along = a1 + d), back (along = a0 - d), left (across = c0 - d), right (across = c1 + d). The
//!   four corners belong to two sides.
//! * gates: on the front and back sides centred at across = spine + 12k; on the left and right sides centred at
//!   along = mid + 12k, mid = (a0 + a1).div_euclid(2) (the middle of the box, toward the church when its length along
//!   is even). Every gate is 3 tiles wide except the front side's gate on the spine (k = 0), which is 5. A gate with a
//!   tile on a corner or next to one is not cut and is not checked. A gate's flanks are the two line tiles just beyond
//!   its ends.
//! * fence tile: a LOW tile (2) that has the fence terrain (`certify::rules::R.fence_kind`) or is owned by a `FenceRow`
//!   feature, in the Sentenced region.
//! * walkable: tile value 0 (floor).
use rh_sim::mapdata::{FeatureKind, GameMapData, Zone, ZoneAnchor};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::{certify, coliseum, map_hash, pipeline, style_gallows};
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
fn worst_attempt_allowed() -> u64 {
    8
}

/// Owner direction 2026-11-12: the inner and outer enclosures stand 5 and 12 tiles (Chebyshev) out from the yard box.
fn inner_distance() -> i32 {
    5
}

fn outer_distance() -> i32 {
    12
}

/// Owner direction: one gate every 12 tiles, 3 wide; the front side's gate on the spine 5 wide.
fn gate_period() -> i32 {
    12
}

fn gate_half_width() -> i32 {
    1
}

fn spine_gate_half_width() -> i32 {
    2
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

fn is_fence(m: &GameMapData, i: usize) -> bool {
    m.region_grid[i] == sentenced()
        && m.tiles[i] == 2
        && (m.terrain[i] == certify::rules::R.fence_kind
            || owner_kind(m, i) == Some(FeatureKind::FenceRow))
}

/// Every fence tile of the Sentenced zone.
fn fence(m: &GameMapData) -> BTreeSet<Cell> {
    (0..m.tiles.len())
        .filter(|&i| is_fence(m, i))
        .map(|i| cell(m, i))
        .collect()
}

fn fence_at(m: &GameMapData, c: Cell) -> bool {
    at(m, c).is_some_and(|i| is_fence(m, i))
}

fn walkable(m: &GameMapData, c: Cell) -> bool {
    at(m, c).is_some_and(|i| m.tiles[i] == 0)
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

/// The door frame and the yard box in it (file comment).
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

    fn frame(&self, c: Cell) -> (i32, i32) {
        Self::of(c, self.side, self.line)
    }

    fn cell(&self, along: i32, across: i32) -> Cell {
        if self.side.0 != 0 {
            (self.line + along * self.side.0, across)
        } else {
            (across, self.line + along * self.side.1)
        }
    }

    /// Chebyshev distance of a tile from the yard box (0 inside).
    fn distance(&self, c: Cell) -> i32 {
        let (a, x) = self.frame(c);
        (self.a0 - a)
            .max(a - self.a1)
            .max(0)
            .max((self.c0 - x).max(x - self.c1).max(0))
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Side {
    Front,
    Back,
    Left,
    Right,
}

/// One gate position: its side, its centre's offset from its origin (the spine, or the middle of the box), whether it
/// is the front side's spine gate, its tiles and its two flanks.
#[derive(Clone, Debug)]
struct Gate {
    side: Side,
    offset: i32,
    spine: bool,
    tiles: Vec<Cell>,
    flanks: [Cell; 2],
}

struct Enclosure {
    d: i32,
    tiles: BTreeSet<Cell>,
    gates: Vec<Gate>,
}

impl Enclosure {
    fn name(&self) -> &'static str {
        if self.d == inner_distance() {
            "inner"
        } else {
            "outer"
        }
    }

    fn spine_gate(&self) -> Option<&Gate> {
        self.gates.iter().find(|g| g.spine)
    }
}

fn enclosure(f: &Frame, d: i32) -> Enclosure {
    let (lo_a, hi_a, lo_c, hi_c) = (f.a0 - d, f.a1 + d, f.c0 - d, f.c1 + d);
    let mut tiles = BTreeSet::new();
    for al in lo_a..=hi_a {
        for ac in lo_c..=hi_c {
            if al == lo_a || al == hi_a || ac == lo_c || ac == hi_c {
                tiles.insert(f.cell(al, ac));
            }
        }
    }
    let p = gate_period();
    let mut gates = Vec::new();
    // Front and back: along fixed, gates at across = spine + 12k, kept off the corners.
    for (side, al) in [(Side::Front, hi_a), (Side::Back, lo_a)] {
        let first = (lo_c - f.spine).div_euclid(p) - 1;
        let last = (hi_c - f.spine).div_euclid(p) + 1;
        for k in first..=last {
            let centre = f.spine + p * k;
            let spine = side == Side::Front && k == 0;
            let half = if spine {
                spine_gate_half_width()
            } else {
                gate_half_width()
            };
            let (t0, t1) = (centre - half, centre + half);
            if t0 < lo_c + 2 || t1 > hi_c - 2 {
                continue;
            }
            gates.push(Gate {
                side,
                offset: p * k,
                spine,
                tiles: (t0..=t1).map(|t| f.cell(al, t)).collect(),
                flanks: [f.cell(al, t0 - 1), f.cell(al, t1 + 1)],
            });
        }
    }
    // Left and right: across fixed, gates at along = mid + 12k, kept off the corners.
    let mid = (f.a0 + f.a1).div_euclid(2);
    for (side, ac) in [(Side::Left, lo_c), (Side::Right, hi_c)] {
        let first = (lo_a - mid).div_euclid(p) - 1;
        let last = (hi_a - mid).div_euclid(p) + 1;
        for k in first..=last {
            let centre = mid + p * k;
            let (t0, t1) = (centre - gate_half_width(), centre + gate_half_width());
            if t0 < lo_a + 2 || t1 > hi_a - 2 {
                continue;
            }
            gates.push(Gate {
                side,
                offset: p * k,
                spine: false,
                tiles: (t0..=t1).map(|t| f.cell(t, ac)).collect(),
                flanks: [f.cell(t0 - 1, ac), f.cell(t1 + 1, ac)],
            });
        }
    }
    Enclosure { d, tiles, gates }
}

fn enclosures(f: &Frame) -> [Enclosure; 2] {
    [
        enclosure(f, inner_distance()),
        enclosure(f, outer_distance()),
    ]
}

/// An opening: a gate whose tiles are all walkable, with fence on at least one flank.
fn is_opening(m: &GameMapData, g: &Gate) -> bool {
    g.tiles.iter().all(|&c| walkable(m, c)) && g.flanks.iter().any(|&c| fence_at(m, c))
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

// --------------------------------------------------------------------------------------------------------------------
// Items 1-2: all fence is on the two enclosures.
// --------------------------------------------------------------------------------------------------------------------

/// Every fence tile of the Sentenced zone lies on the inner or the outer enclosure of its map's yard box.
#[test]
fn every_sentenced_fence_tile_lies_on_the_inner_or_the_outer_enclosure() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        let [inner, outer] = enclosures(&f);
        let all = fence(&l.map);
        let off: Vec<Cell> = all
            .iter()
            .copied()
            .filter(|c| !inner.tiles.contains(c) && !outer.tiles.contains(c))
            .collect();
        if !off.is_empty() {
            let mut by_distance: BTreeMap<i32, usize> = BTreeMap::new();
            for &c in &off {
                *by_distance.entry(f.distance(c)).or_default() += 1;
            }
            findings.push(format!(
                "seed {}: {} of {} fence tiles are off both enclosures (distance from the yard box: tiles {:?}); first {:?}",
                l.seed,
                off.len(),
                all.len(),
                by_distance,
                &off[..off.len().min(4)]
            ));
        }
    }
    verdict("fence off the enclosures", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Items 4, 7: gates; the enclosure exists.
// --------------------------------------------------------------------------------------------------------------------

/// No gate tile (item 4, gates off the corners) is fence: a gate is cut on both enclosures wherever it falls.
#[test]
fn no_gate_tile_is_fence() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        for e in enclosures(&f) {
            for g in &e.gates {
                let shut: Vec<Cell> = g
                    .tiles
                    .iter()
                    .copied()
                    .filter(|&c| fence_at(&l.map, c))
                    .collect();
                if !shut.is_empty() {
                    findings.push(format!(
                        "seed {}: {} enclosure, {:?} gate at offset {}{}: fence on {:?}",
                        l.seed,
                        e.name(),
                        g.side,
                        g.offset,
                        if g.spine { " (spine)" } else { "" },
                        shut
                    ));
                }
            }
        }
    }
    verdict("fence across a gate", &findings);
}

/// Item 7: on every accepted map the front side of each enclosure has its spine gate, 5 walkable tiles, with a fence
/// tile on both flanks.
#[test]
fn the_front_spine_gate_of_each_enclosure_is_five_wide_and_flanked_by_fence() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        for e in enclosures(&f) {
            let Some(g) = e.spine_gate() else {
                findings.push(format!(
                    "seed {}: {} enclosure has no front spine gate (yard box {:?})",
                    l.seed,
                    e.name(),
                    f
                ));
                continue;
            };
            assert_eq!(
                g.tiles.len() as i32,
                2 * spine_gate_half_width() + 1,
                "spine gate width"
            );
            let blocked: Vec<Cell> = g
                .tiles
                .iter()
                .copied()
                .filter(|&c| !walkable(&l.map, c))
                .collect();
            let bare: Vec<Cell> = g
                .flanks
                .iter()
                .copied()
                .filter(|&c| !fence_at(&l.map, c))
                .collect();
            if !blocked.is_empty() || !bare.is_empty() {
                findings.push(format!(
                    "seed {}: {} enclosure's front spine gate {:?}: not walkable {:?}, flanks without fence {:?}",
                    l.seed,
                    e.name(),
                    g.tiles,
                    blocked,
                    bare
                ));
            }
        }
    }
    verdict("front spine gate", &findings);
}

/// Both enclosures stand on every seed, each with at least two openings (a gate of walkable tiles with fence on at
/// least one flank).
#[test]
fn each_enclosure_has_at_least_two_openings() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        for e in enclosures(&f) {
            let open: Vec<(Side, i32)> = e
                .gates
                .iter()
                .filter(|g| is_opening(&l.map, g))
                .map(|g| (g.side, g.offset))
                .collect();
            let standing = e.tiles.iter().filter(|&&c| fence_at(&l.map, c)).count();
            if open.len() < 2 {
                findings.push(format!(
                    "seed {}: {} enclosure has {} openings {:?} ({} fence tiles on it)",
                    l.seed,
                    e.name(),
                    open.len(),
                    open,
                    standing
                ));
            }
        }
    }
    verdict("enclosure openings", &findings);
}

/// Gates line up: wherever an inner gate is open and its lane runs straight out to the outer enclosure over walkable
/// tiles, the outer enclosure is open at the same offset (no fence on the lane's end).
#[test]
fn gates_line_up_from_the_inner_to_the_outer_enclosure() {
    let mut findings = Vec::new();
    for l in maps() {
        let f = yard(l.seed, &l.map);
        let [inner, _] = enclosures(&f);
        let gap = outer_distance() - inner_distance();
        for g in inner.gates.iter().filter(|g| is_opening(&l.map, g)) {
            let step = |c: Cell, k: i32| -> Cell {
                let (al, ac) = f.frame(c);
                match g.side {
                    Side::Front => f.cell(al + k, ac),
                    Side::Back => f.cell(al - k, ac),
                    Side::Left => f.cell(al, ac - k),
                    Side::Right => f.cell(al, ac + k),
                }
            };
            let lane_free = g
                .tiles
                .iter()
                .all(|&c| (1..gap).all(|k| walkable(&l.map, step(c, k))));
            if !lane_free {
                continue;
            }
            let shut: Vec<Cell> = g
                .tiles
                .iter()
                .map(|&c| step(c, gap))
                .filter(|&c| fence_at(&l.map, c))
                .collect();
            if !shut.is_empty() {
                findings.push(format!(
                    "seed {}: inner {:?} gate at offset {} is open with a free lane, the outer line is fenced at {:?}",
                    l.seed, g.side, g.offset, shut
                ));
            }
        }
    }
    verdict("gates out of line", &findings);
}

// --------------------------------------------------------------------------------------------------------------------
// Item 5 and the certifier: runs and pieces.
// --------------------------------------------------------------------------------------------------------------------

/// No straight run of Sentenced fence (along x or along y) is longer than 9; no fence piece (8-connected) is smaller
/// than the styler's `min_piece`. (Both hold today: the certifier's `fence-run` and `feature-size` rules.)
#[test]
fn fence_runs_stay_within_nine_and_pieces_keep_the_minimum() {
    let mut findings = Vec::new();
    for l in maps() {
        let all = fence(&l.map);
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

// --------------------------------------------------------------------------------------------------------------------
// Behaviour to preserve (brief section 7).
// --------------------------------------------------------------------------------------------------------------------

/// Every accepted map certifies with zero failures under the strict certifier and keeps its church, graveyard and
/// gallows square.
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
        for kind in [
            FeatureKind::Church,
            FeatureKind::Graveyard,
            FeatureKind::Gallows,
        ] {
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
/// `mapgen_signature_frost.rs` pin for `Options::default()`); this file's own copy of the guard, with the server's
/// options (no decor) giving the same fence as the default. The full guard is
/// `mapgen_signature_core::g8_signature_off_is_todays_generator`.
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
        let bare = generator
            .certified_styled(seed, off_options())
            .expect("generator error")
            .unwrap_or_else(|| panic!("seed {seed}: no option-off map without decor"));
        assert_eq!(
            fence(&bare),
            fence(&m),
            "seed {seed}: decor moved the fence"
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// The report (brief section 8; not a gate check).
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

/// The 5x5 round every spawn of the pool (the certifier's spawn protection).
fn spawn_pads(m: &GameMapData) -> Vec<bool> {
    let mut out = vec![false; m.tiles.len()];
    for s in &m.spawn_pool {
        let (sx, sy) = world_cell(s.x, s.y);
        for dy in -2..=2 {
            for dx in -2..=2 {
                if let Some(i) = at(m, (sx + dx, sy + dy)) {
                    out[i] = true;
                }
            }
        }
    }
    out
}

/// An approximation of the route guard's corridors (`style_runtime/route.rs`): from every Sentenced spawn of the pool,
/// the steepest descent of the walk distance to the coliseum (fence counted as ground, as before the styler), while in
/// the zone, grown by one tile all round.
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

/// One line tile's class: `o` off the zone or the map; `w` wall, non-fence LOW or another feature's tile; `h` in a
/// camp halo; `s` in a spawn's 5x5; `r` on a spawn route band; `F` free floor (or today's fence).
fn class(m: &GameMapData, c: Cell, halo: &[bool], pads: &[bool], routes: &[bool]) -> char {
    let Some(i) = at(m, c) else { return 'o' };
    if m.region_grid[i] != sentenced() {
        return 'o';
    }
    let fence = is_fence(m, i);
    let owned_other = owner_kind(m, i).is_some_and(|k| k != FeatureKind::FenceRow);
    if !(m.tiles[i] == 0 || fence) || owned_other {
        return 'w';
    }
    if halo[i] {
        return 'h';
    }
    if pads[i] {
        return 's';
    }
    if routes[i] {
        return 'r';
    }
    'F'
}

/// `100 * part / whole`, 0 for an empty whole.
fn percent(part: usize, whole: usize) -> usize {
    (100 * part).checked_div(whole).unwrap_or(0)
}

fn fence_count(m: &GameMapData) -> usize {
    fence(m).len()
}

/// Run with `--ignored --nocapture`. One row per seed (option on): attempt and refusals; the yard box (along x across);
/// for each enclosure: line tiles, line tiles in the zone, of those free (floor or fence, no other owner) and how many
/// of the free are in a camp halo / a spawn's 5x5 / on a route band, fence standing on the line, the share of the free
/// line standing, and the free clear tiles off the gates (a ceiling for fence on that line); the front spine gate as
/// `flank|5 tiles|flank` classes; fence tiles on the map, option on and off.
#[test]
#[ignore]
fn report_seeds_1_to_32() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut totals: BTreeMap<&str, Vec<i64>> = BTreeMap::new();
    let mut viable = [0usize; 3];
    let mut refused: BTreeMap<String, usize> = BTreeMap::new();
    for l in maps() {
        let m = &l.map;
        let f = yard(l.seed, m);
        let (halo, pads, routes) = (halo(m), spawn_pads(m), route_band(m));
        let off = generator
            .certified_styled(l.seed, off_options())
            .expect("generator error")
            .unwrap_or_else(|| panic!("seed {}: no option-off map", l.seed));
        assert_eq!(m.attempt, l.attempt, "seed {}: map.attempt", l.seed);
        for r in &l.refusals {
            *refused.entry(r.clone()).or_default() += 1;
        }
        let mut row = format!(
            "seed {:2}: attempt {} refusals {:?} | box {}x{} | ",
            l.seed,
            l.attempt,
            l.refusals,
            f.a1 - f.a0 + 1,
            f.c1 - f.c0 + 1
        );
        totals
            .entry("box_area")
            .or_default()
            .push(i64::from((f.a1 - f.a0 + 1) * (f.c1 - f.c0 + 1)));
        let mut ceiling = 0;
        let mut both = true;
        for (k, e) in enclosures(&f).iter().enumerate() {
            let classes: Vec<char> = e
                .tiles
                .iter()
                .map(|&c| class(m, c, &halo, &pads, &routes))
                .collect();
            let count = |ch: char| classes.iter().filter(|&&x| x == ch).count();
            let zone = classes.iter().filter(|&&x| x != 'o').count();
            let free = count('F') + count('h') + count('s') + count('r');
            let standing = e.tiles.iter().filter(|&&c| fence_at(m, c)).count();
            let gate_tiles: BTreeSet<Cell> = e
                .gates
                .iter()
                .flat_map(|g| g.tiles.iter().copied())
                .collect();
            let clear_off_gates = e
                .tiles
                .iter()
                .filter(|&&c| !gate_tiles.contains(&c) && class(m, c, &halo, &pads, &routes) == 'F')
                .count();
            ceiling += clear_off_gates;
            let spine = e.spine_gate().map_or("none".to_string(), |g| {
                let cl = |c: Cell| class(m, c, &halo, &pads, &routes);
                let mid: String = g.tiles.iter().map(|&c| cl(c)).collect();
                format!("{}|{}|{}", cl(g.flanks[0]), mid, cl(g.flanks[1]))
            });
            if e.spine_gate().is_some_and(|g| {
                g.flanks
                    .iter()
                    .all(|&c| class(m, c, &halo, &pads, &routes) == 'F')
                    && g.tiles.iter().all(|&c| walkable(m, c) || fence_at(m, c))
            }) {
                viable[k] += 1;
            } else {
                both = false;
            }
            row += &format!(
                "{} {} zone {} free {} (h {} s {} r {}) fence {} ({}%) clear-off-gates {} spine {} | ",
                e.name(),
                e.tiles.len(),
                zone,
                free,
                count('h'),
                count('s'),
                count('r'),
                standing,
                percent(standing, free),
                clear_off_gates,
                spine
            );
            let key: &'static str = if k == 0 { "inner_free" } else { "outer_free" };
            totals.entry(key).or_default().push(free as i64);
            let key: &'static str = if k == 0 {
                "inner_clear_off_gates"
            } else {
                "outer_clear_off_gates"
            };
            totals.entry(key).or_default().push(clear_off_gates as i64);
        }
        if both {
            viable[2] += 1;
        }
        let (on, offc) = (fence_count(m), fence_count(&off));
        row += &format!(
            "fence on {on} off {offc} ceiling/off {}%",
            percent(ceiling, offc)
        );
        totals.entry("fence_on").or_default().push(on as i64);
        totals.entry("fence_off").or_default().push(offc as i64);
        totals.entry("ceiling").or_default().push(ceiling as i64);
        totals
            .entry("ceiling_pct_of_off")
            .or_default()
            .push(percent(ceiling, offc) as i64);
        totals.entry("attempt").or_default().push(l.attempt as i64);
        eprintln!("{row}");
    }
    for (k, v) in &mut totals {
        v.sort_unstable();
        eprintln!(
            "{k}: min {} median {} max {}",
            v[0],
            v[v.len() / 2],
            v[v.len() - 1]
        );
    }
    eprintln!(
        "front spine gate with both flanks free and clear, gate tiles walkable: inner {} / outer {} / both {} of {} seeds",
        viable[0],
        viable[1],
        viable[2],
        maps().len()
    );
    eprintln!("refusals before the accepted attempt, by reason: {refused:?}");
}

/// The measurement behind the brief's section 12 verdict on item 7 (run with `--ignored --nocapture`): on every accepted
/// attempt of seeds 1-64 (the certifying one; on seeds 1-32 also every other accepted attempt of 0-3), is there room for
/// each enclosure's front spine gate? Strict: the gate's tiles are walkable (or today's fence) and both flanks are clear
/// zone floor (class `F`). Loose: a clear tile somewhere on the front side on each side of the gate. The flanks' classes
/// come from the Prefix and the Landmarks phase (camps, zones, spawns), which no styler can move.
#[test]
#[ignore]
fn report_spine_gate_room_on_accepted_attempts() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut samples = 0;
    let mut strict = [0; 3];
    let mut loose = [0; 3];
    let mut why: BTreeMap<String, usize> = BTreeMap::new();
    let mut certifying = 0;
    let mut cert_strict = 0;
    for seed in 1..=64i64 {
        let mut got_first = false;
        for n in 0..16u64 {
            if got_first && (seed > 32 || n >= 4) {
                break;
            }
            let Some(m) = generator
                .styled_attempt(seed, n, on_options())
                .expect("generator error")
            else {
                continue;
            };
            let first = !got_first;
            got_first = true;
            let f = yard(seed, &m);
            let (halo, pads, routes) = (halo(&m), spawn_pads(&m), route_band(&m));
            let cl = |c: Cell| class(&m, c, &halo, &pads, &routes);
            let mut s_ok = [false; 2];
            let mut l_ok = [false; 2];
            for (k, e) in enclosures(&f).iter().enumerate() {
                let g = e.spine_gate().expect("spine gate");
                let walk = g.tiles.iter().all(|&c| walkable(&m, c) || fence_at(&m, c));
                let flanks: String = g.flanks.iter().map(|&c| cl(c)).collect();
                s_ok[k] = walk && flanks == "FF";
                // Loose: a clear tile anywhere on the front side on each side of the gate.
                let (al, ac0) = f.frame(g.tiles[0]);
                let (_, ac1) = f.frame(*g.tiles.last().unwrap());
                let (lo, hi) = (ac0.min(ac1), ac0.max(ac1));
                let (c_lo, c_hi) = (f.c0 - e.d, f.c1 + e.d);
                let left = (c_lo + 1..lo).any(|t| cl(f.cell(al, t)) == 'F');
                let right = (hi + 1..c_hi).any(|t| cl(f.cell(al, t)) == 'F');
                l_ok[k] = walk && left && right;
                if !s_ok[k] {
                    let mid: String = g.tiles.iter().map(|&c| cl(c)).collect();
                    let key = format!(
                        "{} flanks {} gate {}",
                        e.name(),
                        flanks,
                        if mid.chars().all(|c| c == 'o') {
                            "off-zone"
                        } else if walk {
                            "walkable"
                        } else {
                            "blocked"
                        }
                    );
                    *why.entry(key).or_default() += 1;
                }
            }
            samples += 1;
            for k in 0..2 {
                strict[k] += usize::from(s_ok[k]);
                loose[k] += usize::from(l_ok[k]);
            }
            strict[2] += usize::from(s_ok[0] && s_ok[1]);
            loose[2] += usize::from(l_ok[0] && l_ok[1]);
            if first {
                certifying += 1;
                cert_strict += usize::from(s_ok[0] && s_ok[1]);
            }
        }
    }
    eprintln!("accepted maps sampled: {samples}");
    eprintln!(
        "strict (both flanks clear zone floor, gate walkable): inner {} outer {} both {}",
        strict[0], strict[1], strict[2]
    );
    eprintln!("loose (a clear tile somewhere on each side of the gate on the front side): inner {} outer {} both {}", loose[0], loose[1], loose[2]);
    eprintln!("certifying maps seeds 1-64: {certifying}, strict both {cert_strict}");
    for (k, v) in &why {
        eprintln!("  {k}: {v}");
    }
}
