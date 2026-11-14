//! Oracle of P-MAPGEN-SIG-SCALE-2: in signature mode the Sentenced church, its graveyard and its churchyard ARE the
//! owner-approved blueprint (`docs/landmarks/blueprints/church.txt`, owner decision 2026-11-13; requirements L1 and L2;
//! ADR 0028 rule G9): one size (29 x 29), one layout, placed in one of eight orientations round the camp of the
//! Sentenced zone's reserved site (P-MAPGEN-SIG-RESERVE-1), its front toward the coliseum, exactly as the Frost cave
//! (P-MAPGEN-SIG-SCALE-1, `mapgen_signature_scale.rs`, whose shape this file copies). No legacy counterpart (DEV-020).
//! Seeds 1-32, option on, each seed's first accepted attempt, generated once per test binary. Numbers: the brief
//! (`docs/backlog/packets/P-MAPGEN-SIG-SCALE-2.md`, "Measurements").
//!
//! Definitions (tile units; x to the right, y down, as the map's tile index `y * w + x`):
//! * the drawing: the lines of `church.txt` that do not start with `;` and are not empty; grid tile (gx, gy) is character
//!   gx of line gy. `#` church wall, `P` pillar, `G` headstone (all walls), `+` fence (a LOW tile), `.` plain floor, `D`
//!   the church door (floor), `E` the elite camp's tile (plain floor), `*` a lantern post mark (plain floor to the
//!   generator). Its front is the bottom, +gy.
//! * the building: the grid tiles of `#` and `P` (their box: columns 3-25, rows 3-16); the churchyard: `G` and `+`.
//! * the main gate: the open tiles of the drawing's bottom row between columns 12 and 16 (five tiles).
//! * an orientation: a front direction u (one of (1, 0), (-1, 0), (0, 1), (0, -1)) and a mirror flag. Unmirrored, the
//!   drawing's +gx maps to r = (u.1, -u.0); mirrored, to -r. Placed at camp tile t, grid tile (gx, gy) lands on
//!   t + (gy - ey) * u + (gx - ex) * (+-r), where (ex, ey) is the drawing's `E`. (The cave's oracle's definition.)
//! * the site and its camp: the Sentenced `ReservedSite` of the accepted attempt's prefix
//!   (`attempt::begin_attempt_signature(.., true)`); its inner rect: the site shrunk by the core band
//!   (`DEFAULT_DEFINITION.bands[0]`) on every side.
//! * the church: the one feature of kind `Church` (index c); the churchyard: the one feature of kind `Graveyard` (index
//!   g), both Sentenced. "Owned by" a feature k: `feature_grid == k + 1`.
//! * the landmark equals the drawing under an orientation when every grid tile's map tile is: for `#` and `P` a wall
//!   owned by the church with terrain 0; for `G` a wall owned by the churchyard with terrain 0; for `+` a LOW tile owned
//!   by the churchyard with the fence terrain (`R.fence_kind`, the styler's fence kind); for `.`, `D`, `E` and `*` floor
//!   with terrain 0 owned by neither; and the church and the churchyard own no other tile.
//! * the front toward the coliseum: u is the dominant axis (x on a tie) of `DIR16[f]`, f the DIR16 index of the largest
//!   dot product with (CX - t.x, CY - t.y) (first on a tie), and the Sentenced anchor's `front` is f.
//! * the lanes' reading (`style_gallows/lanes.rs` `frame`): the church's box edge on the door side; its "open" tiles are
//!   floor owned by no feature.
use rh_sim::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::coliseum::{CX, CY};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::{
    relabel_sites, relabelled_zones, ReservedSite, SignatureContext, DEFAULT_DEFINITION,
};
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::zones::camps::CampSite;
use rh_sim::mapgen::{attempt, certify, coliseum, map_hash, pipeline, style_gallows};
use rh_sim::rng::Mulberry32;
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[path = "support/signature_pins.rs"]
mod pins;

type Cell = (i32, i32);

// ---------------------------------------------------------------------------------------------------------------------
// The numbers (functions, not consts: `tests/content.rs` reads consts as unregistered tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// The approved drawing, read from the docs (the owner's copy; the generator carries a byte-equal copy in the crate).
fn approved() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/church.txt")
}

/// The drawing's side (tiles), both ways.
fn side() -> i32 {
    29
}

/// The building's box in the drawing: (gx0, gy0, gx1, gy1), inclusive.
fn building() -> (i32, i32, i32, i32) {
    (3, 3, 25, 16)
}

/// The main gate's columns on the drawing's bottom row (inclusive).
fn main_gate_columns() -> (i32, i32) {
    (12, 16)
}

/// The attempts `certified_styled` may use.
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index allowed over seeds 1-32. Rebased onto the bog tree (P-MAPGEN-SIG-SCALE-3): the stub measures
/// 2, the prototype 3; the bound is the stub's figure plus the same headroom the earlier bound had over its stub (7
/// over 4: +3). Brief, "Measurements".
fn worst_attempt_allowed() -> u64 {
    5
}

/// The most attempts seeds 1-32 may use in all. Rebased onto the bog tree: the stub measures 46, the prototype 50; the
/// bound is the stub's figure plus the earlier headroom (70 over 59: +11). Brief, "Measurements".
fn attempts_allowed() -> u64 {
    57
}

// ---------------------------------------------------------------------------------------------------------------------
// The drawing.
// ---------------------------------------------------------------------------------------------------------------------

/// The drawing's rows (header definition).
fn grid() -> Vec<&'static [u8]> {
    approved()
        .lines()
        .filter(|l| !l.starts_with(';') && !l.is_empty())
        .map(str::as_bytes)
        .collect()
}

fn ch(g: Cell) -> u8 {
    grid()[g.1 as usize][g.0 as usize]
}

/// The drawing's tiles whose character is in `cs`, row by row.
fn tiles_of(cs: &[u8]) -> Vec<Cell> {
    let mut out = Vec::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, &c) in row.iter().enumerate() {
            if cs.contains(&c) {
                out.push((gx as i32, gy as i32));
            }
        }
    }
    out
}

fn e_tile() -> Cell {
    tiles_of(b"E")[0]
}

fn main_gate() -> Vec<Cell> {
    let (a, b) = main_gate_columns();
    (a..=b).map(|gx| (gx, side() - 1)).collect()
}

/// Runs of consecutive values.
fn runs(v: &[i32]) -> Vec<(i32, i32)> {
    let mut out: Vec<(i32, i32)> = Vec::new();
    for &x in v {
        match out.last_mut() {
            Some(r) if r.1 + 1 == x => r.1 = x,
            _ => out.push((x, x)),
        }
    }
    out
}

/// One orientation: front direction and mirror flag.
type Orientation = (Cell, bool);

fn orientations() -> [Orientation; 8] {
    let mut out = [((0, 0), false); 8];
    for (k, u) in [(1, 0), (-1, 0), (0, 1), (0, -1)].into_iter().enumerate() {
        out[2 * k] = (u, false);
        out[2 * k + 1] = (u, true);
    }
    out
}

/// Where grid tile g lands with the drawing placed at camp tile t under orientation o.
fn place(t: Cell, o: Orientation, g: Cell) -> Cell {
    let (u, mirrored) = o;
    let s = if mirrored { -1 } else { 1 };
    let r = (u.1 * s, -u.0 * s);
    let e = e_tile();
    let (a, c) = (g.1 - e.1, g.0 - e.0);
    (t.0 + a * u.0 + c * r.0, t.1 + a * u.1 + c * r.1)
}

/// The map box (x0, y0, x1, y1) the grid box (gx0, gy0, gx1, gy1) lands on.
fn placed_box(t: Cell, o: Orientation, b: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    let p = place(t, o, (b.0, b.1));
    let q = place(t, o, (b.2, b.3));
    (p.0.min(q.0), p.1.min(q.1), p.0.max(q.0), p.1.max(q.1))
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

/// Every seed must give a map within the attempt limit (G2, G5: a landmark is never a reason to lose a seed).
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

fn tile_cell(i: usize) -> Cell {
    ((i % coliseum::W) as i32, (i / coliseum::W) as i32)
}

fn world_cell(x: f64, y: f64) -> Cell {
    ((x / R.tile).floor() as i32, (y / R.tile).floor() as i32)
}

fn single(seed: i64, m: &GameMapData, kind: FeatureKind, zone: Zone) -> usize {
    let ks: Vec<usize> = (0..m.features.len())
        .filter(|&k| m.features[k].kind == kind)
        .collect();
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

/// The Sentenced site of the accepted attempt's prefix: (rect, camp tile).
fn sentenced_site(l: &Landed) -> (TileRect, Cell) {
    let r = l
        .prefix
        .reserved
        .iter()
        .find(|r| r.zone == Zone::Sentenced)
        .unwrap_or_else(|| panic!("seed {}: no Sentenced site in the prefix", l.seed));
    let camp = r
        .camp
        .unwrap_or_else(|| panic!("seed {}: the Sentenced site has no camp", l.seed));
    (r.rect, tile_cell(camp))
}

/// The generator's front rule (header definition): the DIR16 index toward the coliseum centre tile from t.
fn front(t: Cell) -> u8 {
    let (dx, dy) = (i64::from(CX - t.0), i64::from(CY - t.1));
    let mut best = (0usize, i64::MIN);
    for (k, v) in DIR16.iter().enumerate() {
        let dot = dx * i64::from(v[0]) + dy * i64::from(v[1]);
        if dot > best.1 {
            best = (k, dot);
        }
    }
    best.0 as u8
}

/// The dominant axis of DIR16 `f` (x on a tie), as a unit vector.
fn axis(f: u8) -> Cell {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

/// How many grid tiles differ from the drawing under orientation `o` placed at the site's camp, and the first one,
/// plus the count of tiles the church or the churchyard owns outside the drawing's solid tiles.
fn mismatches(l: &Landed, o: Orientation) -> (usize, Option<String>, usize) {
    let m = &l.map;
    let c = single(l.seed, m, FeatureKind::Church, Zone::Sentenced);
    let g = single(l.seed, m, FeatureKind::Graveyard, Zone::Sentenced);
    let (_, t) = sentenced_site(l);
    let mut bad = 0;
    let mut first = None;
    let mut drawn = BTreeSet::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, &k) in row.iter().enumerate() {
            let gt = (gx as i32, gy as i32);
            let p = place(t, o, gt);
            let Some(i) = at(m, p) else {
                bad += 1;
                first.get_or_insert_with(|| format!("grid {gt:?} lands off the map at {p:?}"));
                continue;
            };
            let (tile, terrain, owner) = (
                m.tiles[i],
                m.terrain[i],
                usize::from(m.feature_grid[i]).checked_sub(1),
            );
            let ok = match k {
                b'#' | b'P' => tile == TILE_WALL && owner == Some(c) && terrain == 0,
                b'G' => tile == TILE_WALL && owner == Some(g) && terrain == 0,
                b'+' => tile == TILE_LOW && owner == Some(g) && terrain == R.fence_kind,
                _ => tile == TILE_FLOOR && owner != Some(c) && owner != Some(g) && terrain == 0,
            };
            if matches!(k, b'#' | b'P' | b'G' | b'+') {
                drawn.insert(i);
            }
            if !ok {
                bad += 1;
                first.get_or_insert_with(|| {
                    format!(
                        "grid {gt:?} '{}' at {p:?}: tile {tile}, terrain {terrain}, owner {owner:?} (church {c}, \
                         churchyard {g})",
                        k as char
                    )
                });
            }
        }
    }
    let extra = (0..m.feature_grid.len())
        .filter(|&i| {
            let owner = usize::from(m.feature_grid[i]).checked_sub(1);
            (owner == Some(c) || owner == Some(g)) && !drawn.contains(&i)
        })
        .count();
    (bad, first, extra)
}

/// Whether the drawing is its own mirror image (the approved church is: both mirror states then land the same tiles).
fn symmetric() -> bool {
    grid().iter().all(|r| r.iter().eq(r.iter().rev()))
}

/// The orientation under which the church and churchyard equal the drawing, or a panic naming the closest. Exactly
/// one front direction matches; under it one mirror state when the drawing is not symmetric, both when it is (the
/// unmirrored one is returned).
fn orientation(l: &Landed) -> Orientation {
    let mut exact = Vec::new();
    let mut closest: Option<(usize, Orientation, Option<String>, usize)> = None;
    for o in orientations() {
        let (bad, first, extra) = mismatches(l, o);
        if bad == 0 && extra == 0 {
            exact.push(o);
        }
        if closest.as_ref().is_none_or(|c| bad + extra < c.0 + c.3) {
            closest = Some((bad, o, first, extra));
        }
    }
    let (bad, o, first, extra) = closest.unwrap();
    let want = if symmetric() { 2 } else { 1 };
    assert!(
        exact.len() == want && exact.iter().all(|e| e.0 == exact[0].0),
        "seed {} (attempt {}): the church equals the drawing under {} orientations {exact:?} (want {want} with one \
         front direction); closest {o:?}: {bad} of {} tiles differ (first: {first:?}), {extra} church or churchyard \
         tiles outside the drawing",
        l.seed,
        l.attempt,
        exact.len(),
        side() * side()
    );
    exact[0]
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

// ---------------------------------------------------------------------------------------------------------------------
// The blueprint (red today: the church is a 9-15 tile ring drawn by rule with four headstones, and the generator holds
// no drawing).
// ---------------------------------------------------------------------------------------------------------------------

/// The approved drawing is what the brief and the lanes rely on: 29 x 29, mirror-symmetric about column 14; `E` at
/// (14, 7); the building (`#`, `P`) is the box of columns 3-25, rows 3-16, and its front wall line (row 16) is open only at
/// the three `D` tiles (columns 13-15); headstones and plot fences lie in the graveyard rows 17-27; the churchyard
/// fence holds rows 0 and 28 and columns 0 and 28, with the five-wide main gate at columns 12-16 of row 28 and eleven
/// 3-wide gates, every fence run at most 5; the door line to the main gate line is 12 rows, one lane gate period
/// (`style_gallows::LANES.period`). The generator's copy (`signature::DEFAULT_DEFINITION.church_grid`, read from
/// `crates/rh-sim/src/mapgen/landmarks/signature/church.txt`) is byte-equal to it. Red today: the field is empty.
#[test]
fn the_generators_church_blueprint_is_the_approved_drawing() {
    let g = grid();
    let n = side();
    assert_eq!(g.len() as i32, n, "the drawing's rows");
    assert!(
        g.iter().all(|r| r.len() as i32 == n),
        "the drawing's columns"
    );
    assert!(
        g.iter().all(|r| r.iter().eq(r.iter().rev())),
        "the drawing is not mirror-symmetric about its centre column"
    );
    assert!(
        g.iter()
            .flat_map(|r| r.iter())
            .all(|c| b"#PG+.DE*".contains(c)),
        "the drawing holds a character outside the legend"
    );
    assert_eq!(tiles_of(b"E"), vec![(14, 7)], "the drawing's camp tile");
    assert_eq!(
        tiles_of(b"D"),
        vec![(13, 16), (14, 16), (15, 16)],
        "the drawing's church door"
    );
    let b = tiles_of(b"#P");
    let bx = (
        b.iter().map(|c| c.0).min().unwrap(),
        b.iter().map(|c| c.1).min().unwrap(),
        b.iter().map(|c| c.0).max().unwrap(),
        b.iter().map(|c| c.1).max().unwrap(),
    );
    assert_eq!(bx, building(), "the building's box");
    let door_line: Vec<i32> = (bx.0..=bx.2)
        .filter(|&gx| !matches!(ch((gx, bx.3)), b'#' | b'P'))
        .collect();
    assert_eq!(
        door_line,
        vec![13, 14, 15],
        "the building's front wall line"
    );
    assert!(
        tiles_of(b"G")
            .into_iter()
            .chain(
                tiles_of(b"+")
                    .into_iter()
                    .filter(|c| { c.0 > 0 && c.0 < n - 1 && c.1 > 0 && c.1 < n - 1 })
            )
            .all(|c| (17..=27).contains(&c.1)),
        "a headstone or plot fence outside the graveyard rows 17-27"
    );
    // The churchyard fence: the box's outer ring is fence and gates only; the fence stands nowhere else but the plots.
    let ring: Vec<(Vec<Cell>, &str)> = vec![
        ((0..n).map(|x| (x, 0)).collect(), "row 0"),
        ((0..n).map(|x| (x, n - 1)).collect(), "row 28"),
        ((0..n).map(|y| (0, y)).collect(), "column 0"),
        ((0..n).map(|y| (n - 1, y)).collect(), "column 28"),
    ];
    let mut gates = Vec::new();
    for (line, name) in &ring {
        let open: Vec<i32> = line
            .iter()
            .enumerate()
            .filter(|(_, &c)| ch(c) != b'+')
            .map(|(k, _)| k as i32)
            .collect();
        assert!(
            line.iter().all(|&c| matches!(ch(c), b'+' | b'.')),
            "{name}: the churchyard ring holds something other than fence and gate floor"
        );
        for r in runs(&open) {
            gates.push((name.to_string(), r));
        }
    }
    let main: Vec<&(String, (i32, i32))> =
        gates.iter().filter(|g| g.1 .1 - g.1 .0 + 1 == 5).collect();
    assert_eq!(
        main.iter().map(|g| (g.0.as_str(), g.1)).collect::<Vec<_>>(),
        vec![("row 28", main_gate_columns())],
        "the five-wide main gate"
    );
    assert_eq!(
        gates.iter().filter(|g| g.1 .1 - g.1 .0 + 1 == 3).count(),
        11,
        "3-wide gates: {gates:?}"
    );
    assert_eq!(gates.len(), 12, "every gate is 3 or 5 wide: {gates:?}");
    let fence: BTreeSet<Cell> = tiles_of(b"+").into_iter().collect();
    for &(x, y) in &fence {
        for (dx, dy) in [(1, 0), (0, 1)] {
            if fence.contains(&(x - dx, y - dy)) {
                continue;
            }
            let mut len = 0;
            while fence.contains(&(x + dx * len, y + dy * len)) {
                len += 1;
            }
            assert!(len <= 5, "a fence run of {len} from ({x}, {y})");
        }
    }
    assert_eq!(
        (n - 1) - bx.3,
        style_gallows::LANES.period,
        "door line to main gate line against the lanes' gate period"
    );
    assert!(
        DEFAULT_DEFINITION.church_grid == approved(),
        "signature::DEFAULT_DEFINITION.church_grid ({} bytes) is not byte-equal to docs/landmarks/blueprints/church.txt \
         ({} bytes)",
        DEFAULT_DEFINITION.church_grid.len(),
        approved().len()
    );
}

/// On every seed the church and its churchyard equal the drawing, tile for tile (walls, pillars, headstones, LOW fence
/// with the fence terrain, plain floor, the door, the gates), under the orientations of exactly one front direction
/// (both mirror states, the drawing being symmetric), placed at the Sentenced site's camp tile; the church and the
/// churchyard own nothing else. Red today: no orientation matches.
#[test]
fn the_church_is_the_blueprint_under_one_of_eight_orientations() {
    for l in maps() {
        orientation(l);
    }
}

/// The two features as the lanes read them (agreed with the land-generation session): (i) the `Church` feature's box is
/// the building only and its anchor point is the site's camp tile (the lanes take the front from it); (ii) on the
/// church box's door-side edge exactly three tiles are open (floor owned by no feature), in one run: the drawing's door;
/// (iii) the union of the `Church` box and every Sentenced `Graveyard` box is the anchor's footprint. Red today: the
/// church is a rule-drawn ring and the graveyard four headstones beyond its door.
#[test]
fn the_church_box_is_the_building_and_the_boxes_fill_the_footprint() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let (_, t) = sentenced_site(l);
        let o = orientation(l);
        let c = single(seed, m, FeatureKind::Church, Zone::Sentenced);
        let f = &m.features[c];
        assert_eq!(
            grow(f.bbox, 0),
            placed_box(t, o, building()),
            "seed {seed}: the church's box is not the building"
        );
        assert_eq!((f.ax, f.ay), t, "seed {seed}: the church's anchor point");
        let (x0, y0, x1, y1) = grow(f.bbox, 0);
        let u = o.0;
        let edge: Vec<Cell> = match u {
            (1, 0) => (y0..=y1).map(|y| (x1, y)).collect(),
            (-1, 0) => (y0..=y1).map(|y| (x0, y)).collect(),
            (0, 1) => (x0..=x1).map(|x| (x, y1)).collect(),
            _ => (x0..=x1).map(|x| (x, y0)).collect(),
        };
        let open: Vec<Cell> = edge
            .into_iter()
            .filter(|&p| {
                let i = at(m, p).unwrap();
                m.tiles[i] == TILE_FLOOR && m.feature_grid[i] == 0
            })
            .collect();
        let mut door: Vec<Cell> = tiles_of(b"D").into_iter().map(|g| place(t, o, g)).collect();
        door.sort();
        assert_eq!(
            open, door,
            "seed {seed}: the open tiles of the church's door-side edge"
        );
        let a = m
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Sentenced)
            .unwrap_or_else(|| panic!("seed {seed}: no Sentenced anchor"));
        let mut union = grow(f.bbox, 0);
        for g in m
            .features
            .iter()
            .filter(|g| g.kind == FeatureKind::Graveyard && g.zone == Zone::Sentenced)
        {
            let r = grow(g.bbox, 0);
            union = (
                union.0.min(r.0),
                union.1.min(r.1),
                union.2.max(r.2),
                union.3.max(r.3),
            );
        }
        assert_eq!(
            union,
            grow(a.footprint, 0),
            "seed {seed}: the church and graveyard boxes against the anchor's footprint"
        );
    }
}

/// (iv) The Sentenced anchor is the blueprint's: a `Church` anchor whose centre is the site's camp tile, strictly inside
/// its footprint; the footprint the 29 x 29 box the drawing lands on, inside the site's inner rect; the entrance the
/// main gate's five tiles; the front the generator's DIR16 rule from the camp, and the orientation's front direction
/// that front's dominant axis (the door and the main gate face the coliseum). Red today: footprints of 9-15 tiles.
#[test]
fn the_sentenced_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        let seed = l.seed;
        let a = l
            .map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Sentenced)
            .unwrap_or_else(|| panic!("seed {seed}: no Sentenced anchor"));
        assert_eq!(a.kind, FeatureKind::Church, "seed {seed}: anchor kind");
        assert_eq!(
            (a.footprint.w as i32, a.footprint.h as i32),
            (side(), side()),
            "seed {seed}: the Sentenced anchor's footprint {:?}",
            a.footprint
        );
        let (site, t) = sentenced_site(l);
        assert_eq!(
            (a.centre.x, a.centre.y),
            t,
            "seed {seed}: the Sentenced anchor's centre is not the site's camp"
        );
        assert!(
            inside(grow(a.footprint, -1), t),
            "seed {seed}: the centre {t:?} is not strictly inside the footprint {:?}",
            a.footprint
        );
        let o = orientation(l);
        let bx = placed_box(t, o, (0, 0, side() - 1, side() - 1));
        assert_eq!(
            grow(a.footprint, 0),
            bx,
            "seed {seed}: the footprint is not the drawing's box"
        );
        let inner = grow(site, -b);
        assert!(
            inside(inner, (bx.0, bx.1)) && inside(inner, (bx.2, bx.3)),
            "seed {seed}: the box {bx:?} leaves the site's inner rect {inner:?}"
        );
        let mut gate: Vec<Cell> = main_gate().into_iter().map(|g| place(t, o, g)).collect();
        let mut entrance: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
        gate.sort();
        entrance.sort();
        assert_eq!(entrance, gate, "seed {seed}: the anchor's entrance");
        assert_eq!(a.front, front(t), "seed {seed}: the anchor's front");
        assert_eq!(
            o.0,
            axis(a.front),
            "seed {seed}: the door does not face the coliseum (front {})",
            a.front
        );
    }
}

/// Over seeds 1-32 every front direction the sites produce occurs (the set of the orientations' directions is the set
/// of the camps' front axes, at least two of them). The approved drawing is mirror-symmetric, so the mirror cannot be
/// seen in the tiles and is not checked (brief, "Corrections"). Red today: no orientation matches.
#[test]
fn every_front_direction_occurs() {
    let mut dirs = BTreeSet::new();
    let mut fronts = BTreeSet::new();
    for l in maps() {
        let o = orientation(l);
        dirs.insert(o.0);
        fronts.insert(axis(front(sentenced_site(l).1)));
    }
    assert_eq!(dirs, fronts, "front directions used vs the sites' fronts");
    assert!(
        dirs.len() >= 2,
        "only front directions {dirs:?} over seeds 1-32"
    );
}

/// The territory relabel (`signature::relabel_sites`, P-MAPGEN-SIG-SCALE-1) covers the Sentenced site as it covers the
/// Frost site: before repair every tile of the site carries its inside camp's territory, so the church's walls and
/// fence cut no neighbour's territory. Red today: `relabelled_zones()` is `[Frost]`.
#[test]
fn the_sentenced_site_is_relabelled_with_the_frost_site() {
    let zones = relabelled_zones();
    assert!(
        zones.contains(&Zone::Frost) && zones.contains(&Zone::Sentenced) && zones.len() == 2,
        "relabelled zones {zones:?}: want the Sentenced and the Frost sites"
    );
}

/// Moved here from the unit test `signature::tests::only_the_frost_sites_tiles_take_its_camps_label` (amended, approved
/// by the landmark lane 2026-11-13): `relabel_sites` gives every tile of a Frost or Sentenced site with an inside camp
/// that camp's label (its index + 1), the whole rect; a Plague site, a site without a camp and no sites at all leave
/// the grid as it was. Red today: the Sentenced site is not relabelled.
#[test]
fn relabel_sites_labels_the_frost_and_the_sentenced_sites() {
    let w = coliseum::W;
    let camp = |zone: u8, x: usize, y: usize| CampSite {
        zone,
        site: y * w + x,
        elite: true,
        spots: Vec::new(),
    };
    let site = |zone: Zone, x: i32, y: i32, camp: Option<usize>| ReservedSite {
        zone,
        rect: TileRect { x, y, w: 4, h: 3 },
        camp,
        stream: Mulberry32::new(1),
    };
    let camps = vec![camp(1, 5, 5), camp(2, 30, 31), camp(3, 61, 61)];
    let before = vec![7u8; w * coliseum::H];
    let mut grid = before.clone();
    relabel_sites(&[], &camps, &mut grid);
    assert_eq!(grid, before, "no sites");
    let others = [
        site(Zone::Plague, 10, 10, None),
        site(Zone::Frost, 40, 40, None),
        site(Zone::Sentenced, 80, 80, None),
    ];
    relabel_sites(&others, &camps, &mut grid);
    assert_eq!(grid, before, "no site with a camp");
    let sites = [
        site(Zone::Sentenced, 29, 30, Some(camps[1].site)),
        site(Zone::Frost, 60, 60, Some(camps[2].site)),
    ];
    relabel_sites(&sites, &camps, &mut grid);
    for (i, &label) in grid.iter().enumerate() {
        let (x, y) = ((i % w) as i32, (i / w) as i32);
        let want = if (60..64).contains(&x) && (60..63).contains(&y) {
            3
        } else if (29..33).contains(&x) && (30..33).contains(&y) {
            2
        } else {
            7
        };
        assert_eq!(label, want, "({x}, {y})");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// ---------------------------------------------------------------------------------------------------------------------

/// Guard. The map camp on the site's camp tile is a Sentenced elite camp at the Sentenced anchor's centre, and its whole
/// halo is floor that no feature owns, without terrain (the drawing keeps it plain).
#[test]
fn the_elite_camp_stands_at_the_anchor_and_its_halo_is_free() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let (_, t) = sentenced_site(l);
        let camp = m
            .camps
            .iter()
            .find(|c| c.zone == Zone::Sentenced && world_cell(c.x, c.y) == t)
            .unwrap_or_else(|| {
                panic!("seed {seed}: no Sentenced camp on the site's camp tile {t:?}")
            });
        assert!(
            camp.elite_spot >= 0,
            "seed {seed}: the church's camp is not elite"
        );
        let a = m
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Sentenced)
            .unwrap();
        assert_eq!((a.centre.x, a.centre.y), t, "seed {seed}: anchor centre");
        for h in halo_of(t) {
            let i = at(m, h).unwrap();
            assert!(
                m.tiles[i] == TILE_FLOOR && m.feature_grid[i] == 0 && m.terrain[i] == 0,
                "seed {seed}: halo tile {h:?}: tile {}, owner {}, terrain {}",
                m.tiles[i],
                m.feature_grid[i],
                m.terrain[i]
            );
        }
    }
}

/// Guard. Every seed keeps all four signature landmarks (one `Church` and one `Graveyard`) and the Holy anchor, and
/// certifies with zero failures under the strictest settings (every zone strict: feature tiles, sizes, the fence detour
/// and run rules included). With the blueprint this needs the certifier's `Graveyard` row and
/// `SignatureContext::intact` to accept the LOW fence.
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
            .map(|f| format!("{}/{}: {}", f.rule, f.subject, f.message))
            .collect();
        assert!(failures.is_empty(), "seed {seed}: {failures:?}");
    }
}

/// Guard. The apron rule: no tile of one landmark lies in another's box grown by the core band (the volcano's streams
/// and pools count as its tiles but have no box apron; the Holy hall is the Holy anchor's `Hall`).
#[test]
fn no_landmark_stands_in_another_landmarks_apron() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
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

/// Guard. Option off: seeds 1-8 give today's maps byte for byte (G8).
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
}

/// Guard. The worst attempt index over seeds 1-32 stays within `worst_attempt_allowed()`.
#[test]
fn the_worst_attempt_stays_within_the_bound() {
    let worst = maps()
        .map(|l| (l.attempt, l.seed))
        .max()
        .expect("seeds generated");
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {}: attempt {} (allowed {})",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// Guard. The attempts seeds 1-32 use in all stay within `attempts_allowed()`.
#[test]
fn the_attempts_used_stay_within_the_bound() {
    let used: u64 = maps().map(|l| l.attempt + 1).sum();
    assert!(
        used <= attempts_allowed(),
        "{used} attempts over seeds 1-32 (allowed {})",
        attempts_allowed()
    );
}

/// The report (not a gate check; run with `--ignored --nocapture`): seeds 1-64, the attempt each lands on, every
/// refusal by reason, the church's orientation and its box's offset from the site's corner, and the Sentenced lane fence
/// (LOW tiles owned by a `FenceRow`); then the totals (brief, "Measurements").
#[test]
#[ignore]
fn report_seeds_1_to_64() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let context = attempt::AttemptContext::new(&fixed);
    let mut worst = ((0, 0), (0, 0));
    let mut used = (0, 0);
    let mut lost = Vec::new();
    let mut refusals = std::collections::BTreeMap::<String, usize>::new();
    for seed in 1..=64 {
        let mut landed = None;
        for n in 0..attempt_limit() {
            let (report, _) = generator
                .styled_attempt_with_trace(seed, n, on_options())
                .expect("generator error");
            match report.map {
                Some(map) => {
                    landed = Some((n, map));
                    break;
                }
                None => {
                    *refusals
                        .entry(format!("{:?}", report.refusal.expect("refused attempt")))
                        .or_default() += 1;
                }
            }
        }
        let Some((n, map)) = landed else {
            eprintln!("seed {seed}: no map");
            lost.push(seed);
            continue;
        };
        used.1 += n + 1;
        worst.1 = worst.1.max((n, seed));
        if seed <= 32 {
            used.0 += n + 1;
            worst.0 = worst.0.max((n, seed));
        }
        let prefix = attempt::begin_attempt_signature(&context, seed, n, true)
            .unwrap()
            .unwrap()
            .state;
        let l = Landed {
            seed,
            attempt: n,
            map,
            prefix,
        };
        let (site, _) = sentenced_site(&l);
        let a = l
            .map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Sentenced)
            .unwrap();
        let o = orientation(&l);
        let lanes = (0..l.map.tiles.len())
            .filter(|&i| {
                l.map.region_grid[i] == Zone::Sentenced.code()
                    && l.map.tiles[i] == TILE_LOW
                    && usize::from(l.map.feature_grid[i])
                        .checked_sub(1)
                        .is_some_and(|k| l.map.features[k].kind == FeatureKind::FenceRow)
            })
            .count();
        eprintln!(
            "seed {seed}: attempt {n}, front {:?} mirrored {}, box offset ({}, {}), lane fence {lanes}",
            o.0,
            o.1,
            a.footprint.x - site.x,
            a.footprint.y - site.y
        );
    }
    eprintln!(
        "attempts {} / {} (seeds 1-32 / 1-64); worst {:?} / {:?} (attempt, seed); no map {lost:?}",
        used.0, used.1, worst.0, worst.1
    );
    eprintln!("refusals {refusals:?}");
}
