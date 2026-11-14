//! Oracle of P-MAPGEN-SIG-SCALE-4: in signature mode the Fire volcano IS the owner-approved blueprint
//! (`docs/landmarks/blueprints/volcano.txt`, owner decision 2026-11-13; requirements L1 and L4; ADR 0028 rule G9): one
//! size (30 x 30), one layout, filling the Fire zone's reserved site's inner rect in one of eight orientations, its
//! front toward the coliseum; and exactly three lava streams leave it, one from each outlet run, in a fan toward the
//! coliseum: the middle one straight ahead, 14-18 path tiles and the longest, the side ones 45 degrees off it, 10-14;
//! each two tiles wide, without a ford, ending in its own pool. Guarantees are hard (no tolerance); the lava window and
//! the attempt bounds are provisional targets the implementer measures for the owner (the brief, "Numbers for the
//! owner"). No legacy counterpart (DEV-020). Seeds 1-32, option on (no decor), `certified_styled`, generated once per
//! test binary. Brief: `docs/backlog/packets/P-MAPGEN-SIG-SCALE-4.md`.
//!
//! Definitions (tile units; x to the right, y down, the map's tile index `y * w + x`):
//! * the drawing: the lines of `volcano.txt` that do not start with `;` and are not empty; grid tile (gx, gy) is
//!   character gx of line gy. `#`, `X`, `H` are walls (terrain 0); `~` and `O` lava (LOW, terrain lava); `.` plain floor.
//!   Its front is the bottom, +gy. The outlet runs: the `O` tiles of the front row (gy = 29), in grid order left
//!   (gx 7-8), middle (14-15), right (21-22).
//! * the site: the Fire `ReservedSite` of the accepted attempt's prefix; its inner rect: the site shrunk by the core band
//!   (`DEFAULT_DEFINITION.bands[0]`) on every side (30 x 30); its centre tile: (rect.x + rect.w / 2, rect.y + rect.h / 2).
//! * an orientation: a front direction u (one of (1, 0), (-1, 0), (0, 1), (0, -1)) and a mirror flag; r = (u.1, -u.0)
//!   unmirrored, -r mirrored. The drawing turned is g -> gx * r + gy * u; its box, translated so that its corner nearest
//!   the map origin is the inner rect's, is the inner rect (30 in 30, no spare tile). `grid_of` is the inverse (r and u
//!   are orthonormal), defined for every map tile, so a stream outside the box has grid coordinates too.
//! * the volcano: the one `Volcano` feature (index k); it equals the drawing under an orientation when every grid tile's
//!   map tile is: for a wall glyph a wall owned by the volcano with terrain 0; for `~` and `O` LOW with the lava terrain
//!   owned by the volcano; for `.` floor not owned by the volcano; and the volcano owns no other tile.
//! * a stream, a pool: a `LavaStream`, a `LavaPool` feature; its lava: the LOW lava tiles it owns. "Touches": Chebyshev
//!   distance at most 1. A stream's run: the outlet run its lava touches; its pool: the pool whose lava its lava touches.
//! * two tiles wide (as `mapgen_signature_fire_bands.rs`): over the stream's lava, no tile is a neck (its run along one
//!   axis is 1 while along the other it is 3 or more) and every tile lies in a 2x2 window holding at least 3 of them.
//! * no ford: the stream's lava is one 4-connected piece (a 4-connected band blocks 4- and 8-connected walkers alike).
//! * a stream's length (path tiles): 1 + the fewest 8-connected steps through its own lava from a tile touching its run
//!   to a tile touching its pool's lava. A straight stream n tiles long, two wide, measures n.
//! * the fan: in grid coordinates (`grid_of`), the displacement from the run's centre (gx 7.5, 14.5 or 21.5; gy 29) to
//!   the centroid of the stream's pool lava.
//! * front toward the coliseum: f = the DIR16 index of the largest dot product with (CX - t.x, CY - t.y), first on a tie;
//!   u is the dominant axis of `DIR16[f]` (x on a tie).
use rh_sim::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use rh_sim::mapdata::{FeatureJob, FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::coliseum::{CX, CY};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::blueprint::{
    dir16, EntranceRule, Glyph, Legality, Placement, Write,
};
use rh_sim::mapgen::landmarks::signature::spec::{specs, FeatureAnchor, FeatureSpec};
use rh_sim::mapgen::landmarks::signature::{Placed, SignatureContext, DEFAULT_DEFINITION};
use rh_sim::mapgen::landmarks::stage::LandmarkStage;
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, certify, coliseum, pipeline};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

// ---------------------------------------------------------------------------------------------------------------------
// The numbers (functions, not consts: `tests/content.rs` reads consts as unregistered tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// The approved drawing, read from the docs (the owner's copy; the generator carries a byte-equal copy in the crate).
fn approved() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/volcano.txt")
}

fn side() -> i32 {
    30
}

/// The outlet runs, grid order: left, middle, right (header definition).
fn runs() -> [[Cell; 2]; 3] {
    [
        [(7, 29), (8, 29)],
        [(14, 29), (15, 29)],
        [(21, 29), (22, 29)],
    ]
}

/// The owner's stream lengths (requirement L4), per run in grid order: hard ranges, inclusive.
fn owner_len() -> [(i32, i32); 3] {
    [(10, 14), (14, 18), (10, 14)]
}

/// PROVISIONAL (a number for the owner, not a final figure): the Fire zone's lava per map, inclusive. Worked from the
/// drawing and the stream rules, not measured: the cone holds 160 lava tiles (154 `~`: the crater lake 96 in rows
/// 10-19, the three channels 58; and the 6 `O`); the streams 2 x (10..14 + 14..18 + 10..14) = 68-92; three pools of
/// 9-13 tiles (today's squared radii 4 and 2) = 27-39; widening fills at bends a few more: about 255-295. The window
/// round it: 240-310. Today's `lava_budget` (80, 150) cannot hold the cone's own 160. The implementer measures seeds
/// 1-64, the coordinator takes the range to the owner, and this window is amended afterwards.
fn provisional_lava_window() -> (usize, usize) {
    (240, 310)
}

/// The attempts `certified_styled` tries per seed.
fn attempt_limit() -> u64 {
    16
}

/// PROVISIONAL (a number for the owner): the worst attempt index over seeds 1-32, today's strictest bound on the same
/// maps (`mapgen_signature_bog_tree.rs`, 4). If the 30-tile cone with three streams cannot keep it, the measurement goes
/// to the owner; the bound is not raised quietly.
fn worst_attempt_allowed() -> u64 {
    4
}

/// PROVISIONAL (a number for the owner): the attempts seeds 1-32 use in all, today's strictest bound on the same maps
/// (`mapgen_signature_church.rs`, 57).
fn attempts_allowed() -> u64 {
    57
}

// ---------------------------------------------------------------------------------------------------------------------
// The drawing and the orientations.
// ---------------------------------------------------------------------------------------------------------------------

fn grid() -> Vec<&'static [u8]> {
    approved()
        .lines()
        .filter(|l| !l.starts_with(';') && !l.is_empty())
        .map(str::as_bytes)
        .collect()
}

fn tiles_of(cs: &[u8]) -> Vec<Cell> {
    let mut out = Vec::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, ch) in row.iter().enumerate() {
            if cs.contains(ch) {
                out.push((gx as i32, gy as i32));
            }
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

/// The drawing's turn of grid direction or tile `g` (header definition), about grid (0, 0).
fn turn(o: Orientation, g: Cell) -> Cell {
    let (u, mirrored) = o;
    let s = if mirrored { -1 } else { 1 };
    let r = (s * u.1, -s * u.0);
    (g.0 * r.0 + g.1 * u.0, g.0 * r.1 + g.1 * u.1)
}

/// The map tile grid (0, 0) lands on when the turned box's corner nearest the map origin is `corner`.
fn origin(o: Orientation, corner: Cell) -> Cell {
    let far = side() - 1;
    let ts = [(0, 0), (far, 0), (0, far), (far, far)].map(|g| turn(o, g));
    let lo = ts.iter().fold(ts[0], |m, c| (m.0.min(c.0), m.1.min(c.1)));
    (corner.0 - lo.0, corner.1 - lo.1)
}

/// Where grid tile `g` lands (header definition).
fn place(o: Orientation, corner: Cell, g: Cell) -> Cell {
    let (a, d) = (origin(o, corner), turn(o, g));
    (a.0 + d.0, a.1 + d.1)
}

/// The grid coordinates of map point `p` (real, so a tile's centre is `x + 0.5` on the map and `gx + 0.5` in the grid).
fn grid_of(o: Orientation, corner: Cell, p: (f64, f64)) -> (f64, f64) {
    let (u, mirrored) = o;
    let s = if mirrored { -1 } else { 1 };
    let r = (s * u.1, -s * u.0);
    let a = origin(o, corner);
    // Tile (x, y) is the grid tile g with g's centre at the map tile's centre: compare centres.
    let (px, py) = (p.0 - f64::from(a.0) - 0.5, p.1 - f64::from(a.1) - 0.5);
    (
        px * f64::from(r.0) + py * f64::from(r.1) + 0.5,
        px * f64::from(u.0) + py * f64::from(u.1) + 0.5,
    )
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

/// One seed: the finished map, the accepted attempt's prefix, and its Landmarks phase (stage and `Placed`).
struct Landed {
    seed: i64,
    map: GameMapData,
    prefix: attempt::AttemptState,
    stage: LandmarkStage,
    placed: Placed,
}

fn landmarks_phase(seed: i64, n: u64) -> Option<(attempt::AttemptState, LandmarkStage, Placed)> {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let frame = attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")?;
    let mut st = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")?;
    let placed = SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")?;
    Some((frame.state, st, placed))
}

fn on_maps() -> &'static Vec<(i64, Option<Landed>)> {
    static MAPS: OnceLock<Vec<(i64, Option<Landed>)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=32)
            .map(|seed| {
                let landed = generator
                    .certified_styled(seed, on_options())
                    .expect("generator error")
                    .map(|map| {
                        let (prefix, stage, placed) = landmarks_phase(seed, map.attempt)
                            .unwrap_or_else(|| {
                                panic!("seed {seed}: the accepted attempt's Landmarks phase")
                            });
                        Landed {
                            seed,
                            map,
                            prefix,
                            stage,
                            placed,
                        }
                    });
                (seed, landed)
            })
            .collect()
    })
}

/// Every seed gives a map (G2, G5: a landmark is never a reason to lose a seed).
fn maps() -> impl Iterator<Item = &'static Landed> {
    on_maps().iter().map(|(seed, l)| {
        l.as_ref()
            .unwrap_or_else(|| panic!("seed {seed}: no map with the option on"))
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------------

fn at(m: &GameMapData, c: Cell) -> Option<usize> {
    (c.0 >= 0 && c.1 >= 0 && c.0 < m.w as i32 && c.1 < m.h as i32)
        .then(|| (c.1 * m.w as i32 + c.0) as usize)
}

fn cell(m: &GameMapData, i: usize) -> Cell {
    ((i as i32) % m.w as i32, (i as i32) / m.w as i32)
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

fn is_lava(m: &GameMapData, i: usize) -> bool {
    m.tiles[i] == TILE_LOW && m.terrain[i] == DEFAULT_DEFINITION.lava
}

/// The lava tiles feature `k` owns.
fn lava_of(m: &GameMapData, k: usize) -> Vec<Cell> {
    (0..m.feature_grid.len())
        .filter(|&i| usize::from(m.feature_grid[i]) == k + 1 && is_lava(m, i))
        .map(|i| cell(m, i))
        .collect()
}

fn chebyshev(a: Cell, b: Cell) -> i32 {
    (a.0 - b.0).abs().max((a.1 - b.1).abs())
}

fn touches(a: &[Cell], b: &[Cell]) -> bool {
    a.iter().any(|&p| b.iter().any(|&q| chebyshev(p, q) <= 1))
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

/// The Fire site of the accepted attempt's prefix: (inner rect's corner, centre tile).
fn fire_site(l: &Landed) -> (Cell, Cell) {
    let r = l
        .prefix
        .reserved
        .iter()
        .find(|r| r.zone == Zone::Fire)
        .unwrap_or_else(|| panic!("seed {}: no Fire site in the prefix", l.seed));
    let b = DEFAULT_DEFINITION.bands[0];
    (
        (r.rect.x + b, r.rect.y + b),
        (
            r.rect.x + r.rect.w as i32 / 2,
            r.rect.y + r.rect.h as i32 / 2,
        ),
    )
}

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

fn axis(f: u8) -> Cell {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

/// Grid tiles that differ from the drawing under `o` (first one described), and the volcano's tiles off its drawn ones.
fn mismatches(l: &Landed, o: Orientation) -> (usize, Option<String>, usize) {
    let m = &l.map;
    let k = single(l.seed, m, FeatureKind::Volcano, Zone::Fire);
    let (corner, _) = fire_site(l);
    let mut bad = 0;
    let mut first = None;
    let mut drawn = BTreeSet::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, &ch) in row.iter().enumerate() {
            let g = (gx as i32, gy as i32);
            let p = place(o, corner, g);
            let Some(i) = at(m, p) else {
                bad += 1;
                first.get_or_insert_with(|| format!("grid {g:?} lands off the map at {p:?}"));
                continue;
            };
            let (tile, terrain, own) = (
                m.tiles[i],
                m.terrain[i],
                usize::from(m.feature_grid[i]) == k + 1,
            );
            let ok = match ch {
                b'#' | b'X' | b'H' => tile == TILE_WALL && own && terrain == 0,
                b'~' | b'O' => own && is_lava(m, i),
                _ => tile == TILE_FLOOR && !own,
            };
            if ch != b'.' {
                drawn.insert(i);
            }
            if !ok {
                bad += 1;
                first.get_or_insert_with(|| {
                    format!(
                        "grid {g:?} '{}' at {p:?}: tile {tile}, terrain {terrain}, owned by the volcano {own}",
                        ch as char
                    )
                });
            }
        }
    }
    let extra = (0..m.feature_grid.len())
        .filter(|&i| usize::from(m.feature_grid[i]) == k + 1 && !drawn.contains(&i))
        .count();
    (bad, first, extra)
}

/// The one orientation under which the volcano equals the drawing, or a failed assertion naming the closest.
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
    assert!(
        exact.len() == 1,
        "seed {} (attempt {}): the volcano equals the drawing under {} orientations; closest {o:?}: {bad} of {} tiles \
         differ (first: {first:?}), {extra} volcano tiles outside the drawing",
        l.seed,
        l.map.attempt,
        exact.len(),
        side() * side()
    );
    exact[0]
}

/// The tiles of `cells` that break the two-wide rule (header definition).
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

/// 4-connected pieces of `cells`.
fn pieces4(cells: &[Cell]) -> usize {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut n = 0;
    for &s in &set {
        if !seen.insert(s) {
            continue;
        }
        n += 1;
        let mut stack = vec![s];
        while let Some((x, y)) = stack.pop() {
            for d in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let c = (x + d.0, y + d.1);
                if set.contains(&c) && seen.insert(c) {
                    stack.push(c);
                }
            }
        }
    }
    n
}

/// The stream's length (header definition), `None` when no tile touches the start or the end, or they are not joined.
fn length(lava: &[Cell], start: &[Cell], end: &[Cell]) -> Option<i32> {
    let set: BTreeSet<Cell> = lava.iter().copied().collect();
    let mut dist: BTreeMap<Cell, i32> = BTreeMap::new();
    let mut queue = VecDeque::new();
    for &c in lava
        .iter()
        .filter(|c| start.iter().any(|&s| chebyshev(**c, s) <= 1))
    {
        dist.insert(c, 1);
        queue.push_back(c);
    }
    while let Some(c) = queue.pop_front() {
        let d = dist[&c];
        if end.iter().any(|&e| chebyshev(c, e) <= 1) {
            return Some(d);
        }
        for dy in -1..=1 {
            for dx in -1..=1 {
                let n = (c.0 + dx, c.1 + dy);
                if set.contains(&n) && !dist.contains_key(&n) {
                    dist.insert(n, d + 1);
                    queue.push_back(n);
                }
            }
        }
    }
    None
}

/// One stream as found on the finished map: its run (index into `runs()`), its pool (feature index), its lava, its
/// pool's lava, and its length.
struct Stream {
    run: usize,
    lava: Vec<Cell>,
    pool: Vec<Cell>,
    len: Option<i32>,
}

/// The finished map's streams, each matched to its run and its pool, in run order; every matching rule asserted.
fn streams(l: &Landed, o: Orientation) -> Vec<Stream> {
    let (seed, m) = (l.seed, &l.map);
    let (corner, _) = fire_site(l);
    let ss = of_kind(m, FeatureKind::LavaStream);
    let ps = of_kind(m, FeatureKind::LavaPool);
    assert_eq!(
        (ss.len(), ps.len()),
        (3, 3),
        "seed {seed}: (streams, pools); exactly three of each on every map"
    );
    let landed: Vec<Vec<Cell>> = runs()
        .iter()
        .map(|r| r.iter().map(|&g| place(o, corner, g)).collect())
        .collect();
    let pool_lava: Vec<Vec<Cell>> = ps.iter().map(|&k| lava_of(m, k)).collect();
    let mut out: Vec<Stream> = Vec::new();
    for (s, &k) in ss.iter().enumerate() {
        assert_eq!(
            m.features[k].zone,
            Zone::Fire,
            "seed {seed}: stream {s} zone"
        );
        let lava = lava_of(m, k);
        let run: Vec<usize> = (0..3).filter(|&r| touches(&lava, &landed[r])).collect();
        assert_eq!(
            run.len(),
            1,
            "seed {seed}: stream {s} touches outlet runs {run:?} (exactly one)"
        );
        let pool: Vec<usize> = (0..3).filter(|&p| touches(&lava, &pool_lava[p])).collect();
        assert_eq!(
            pool.len(),
            1,
            "seed {seed}: stream {s} touches pools {pool:?} (exactly one: its own)"
        );
        let len = length(&lava, &landed[run[0]], &pool_lava[pool[0]]);
        out.push(Stream {
            run: run[0],
            lava,
            pool: pool_lava[pool[0]].clone(),
            len,
        });
    }
    let used: BTreeSet<usize> = out.iter().map(|s| s.run).collect();
    assert_eq!(
        used.len(),
        3,
        "seed {seed}: two streams leave one outlet run"
    );
    out.sort_by_key(|s| s.run);
    let pools: BTreeSet<Vec<Cell>> = out.iter().map(|s| s.pool.clone()).collect();
    assert_eq!(pools.len(), 3, "seed {seed}: two streams end in one pool");
    out
}

// ---------------------------------------------------------------------------------------------------------------------
// The table entry and the heading helper.
// ---------------------------------------------------------------------------------------------------------------------

/// The Fire entry of `specs` is the volcano drawing: its drawing the `Definition`'s `volcano_grid` (byte-equal to the
/// approved file); its legend: `#`, `X`, `H` walls and `~` lava (LOW, the catalog's lava code) owned by the volcano,
/// `O` lava owned by the volcano and a named mark, all four `Legality::WallGround` (the rule today's cone keeps:
/// `Site::wall` and `Site::ground`, so it stays off the legacy landmark protection and the legacy buildings' aprons, as
/// the bog tree, the other centred landmark, does), `.` plain floor (`Legality::Floor`, writes nothing, no feature); one
/// feature, the volcano (job `Landmark`, anchor point the anchor's centre); placed by `Placement::Centre`; entrance the
/// `O` tiles (`EntranceRule::Mark(b'O')`, the six outlets); no doorway check; members volcano, streams and pools, the
/// streams and pools by tile, no any-terrain kind. Red on the stub: the entry has no drawing.
#[test]
fn the_fire_entry_is_the_volcano_drawing_with_its_legend() {
    let d = DEFAULT_DEFINITION;
    let table = specs(&d);
    let fire = table.iter().find(|s| s.zone == Zone::Fire);
    assert!(fire.is_some(), "no Fire entry");
    let s = fire.unwrap();
    assert_eq!(s.kind, FeatureKind::Volcano, "the anchor kind");
    assert!(
        s.drawing == Some(d.volcano_grid) && d.volcano_grid == approved(),
        "the Fire entry's drawing is {:?} bytes, want the approved volcano.txt ({} bytes)",
        s.drawing.map(str::len),
        approved().len()
    );
    let glyph = |ch, write, feature, legality, mark| Glyph {
        ch,
        write,
        feature,
        legality,
        mark,
    };
    let v = Some(FeatureKind::Volcano);
    let lava = Write::Low(d.lava);
    let mut want = vec![
        glyph(b'#', Write::Wall, v, Legality::WallGround, false),
        glyph(b'.', Write::Nothing, None, Legality::Floor, false),
        glyph(b'H', Write::Wall, v, Legality::WallGround, false),
        glyph(b'O', lava, v, Legality::WallGround, true),
        glyph(b'X', Write::Wall, v, Legality::WallGround, false),
        glyph(b'~', lava, v, Legality::WallGround, false),
    ];
    want.sort_by_key(|g| g.ch);
    let mut got = s.legend.0.clone();
    got.sort_by_key(|g| g.ch);
    assert_eq!(got, want, "the Fire legend");
    assert_eq!(
        s.features,
        vec![FeatureSpec {
            kind: FeatureKind::Volcano,
            job: FeatureJob::Landmark,
            anchor: FeatureAnchor::Centre,
        }],
        "the Fire entry's features"
    );
    assert_eq!(s.placement, Placement::Centre, "the Fire placement");
    assert_eq!(s.entrance, EntranceRule::Mark(b'O'), "the Fire entrance");
    assert!(!s.doorway, "the volcano has no doorway check");
    let names =
        |v: &[FeatureKind]| -> BTreeSet<String> { v.iter().map(|k| format!("{k:?}")).collect() };
    assert_eq!(
        names(&s.members),
        names(&[
            FeatureKind::Volcano,
            FeatureKind::LavaStream,
            FeatureKind::LavaPool
        ]),
        "the Fire members"
    );
    assert_eq!(
        names(&s.by_tile),
        names(&[FeatureKind::LavaStream, FeatureKind::LavaPool]),
        "the Fire by-tile kinds"
    );
    assert!(s.any_terrain.is_empty(), "no any-terrain kind on Fire");
}

/// `blueprint::dir16` names the DIR16 index of a map direction (largest dot product, first on a tie): the eight unit and
/// diagonal directions are indices 0, 2, ..., 14; and under every orientation the outlet headings of `Definition`
/// (`outlet_heading`, grid directions) turn to the front's index for the middle run and to the front's index +-2 (45
/// degrees) for the side runs, the left run on the side the drawing's left turns to. Red on the stub: `dir16` is 0.
#[test]
fn the_heading_helper_turns_the_outlet_headings_into_dir16() {
    let eight = [
        ((1, 0), 0),
        ((1, 1), 2),
        ((0, 1), 4),
        ((-1, 1), 6),
        ((-1, 0), 8),
        ((-1, -1), 10),
        ((0, -1), 12),
        ((1, -1), 14),
    ];
    for (d, k) in eight {
        assert_eq!(dir16(d), k, "dir16({d:?})");
    }
    assert_eq!(dir16((2, 1)), 1, "dir16((2, 1))");
    let h = DEFAULT_DEFINITION.outlet_heading;
    for o in orientations() {
        let f = i32::from(dir16(o.0));
        let idx = |g: Cell| i32::from(dir16(turn(o, g)));
        assert_eq!(idx(h[1]), f, "{o:?}: the middle heading");
        // The drawing's left (-gx) is -r: unmirrored, turning from the front toward -r is +2 in DIR16 (y down).
        let left: i32 = if o.1 { -2 } else { 2 };
        assert_eq!(
            (idx(h[0]) - f).rem_euclid(16),
            left.rem_euclid(16),
            "{o:?}: the left heading"
        );
        assert_eq!(
            (idx(h[2]) - f).rem_euclid(16),
            (-left).rem_euclid(16),
            "{o:?}: the right heading"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The cone is the drawing.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32: the volcano equals the drawing under exactly one of the eight orientations, its box the Fire site's inner
/// rect; it owns nothing else. Red on the stub: the cone is a disc of about 5 tiles.
#[test]
fn the_volcano_is_the_blueprint_under_one_of_eight_orientations() {
    for l in maps() {
        orientation(l);
    }
}

/// The Fire anchor is the blueprint's: footprint the 30 x 30 inner rect of the site (the drawing's box); centre the
/// site's centre tile, which is a crater-lake tile (one of the four middle grid tiles (14|15, 14|15), all `~`, LOW lava
/// owned by the volcano) under every orientation, and the volcano feature's anchor point; front the generator's rule
/// from the centre, its axis the orientation's front; entrance the six outlet tiles, row-major. Red on the stub.
#[test]
fn the_fire_anchor_is_the_box_the_crater_centre_and_the_six_outlets() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let a = m.anchors.iter().find(|a| a.zone == Zone::Fire);
        assert!(a.is_some(), "seed {seed}: no Fire anchor");
        let a = a.unwrap();
        assert_eq!(a.kind, FeatureKind::Volcano, "seed {seed}: anchor kind");
        let (corner, t) = fire_site(l);
        assert_eq!(
            grow(a.footprint, 0),
            (
                corner.0,
                corner.1,
                corner.0 + side() - 1,
                corner.1 + side() - 1
            ),
            "seed {seed}: the Fire footprint is not the site's 30 x 30 inner rect"
        );
        assert_eq!((a.centre.x, a.centre.y), t, "seed {seed}: the Fire centre");
        let o = orientation(l);
        let g = grid_of(o, corner, (f64::from(t.0) + 0.5, f64::from(t.1) + 0.5));
        let g = (g.0.floor() as i32, g.1.floor() as i32);
        assert!(
            [14, 15].contains(&g.0) && [14, 15].contains(&g.1),
            "seed {seed}: the centre is grid tile {g:?}, not one of the middle four"
        );
        let k = single(seed, m, FeatureKind::Volcano, Zone::Fire);
        let i = at(m, t).unwrap();
        assert!(
            is_lava(m, i) && usize::from(m.feature_grid[i]) == k + 1,
            "seed {seed}: the centre {t:?} is not the volcano's crater lava"
        );
        assert_eq!(
            (m.features[k].ax, m.features[k].ay),
            t,
            "seed {seed}: the volcano feature's anchor point"
        );
        assert_eq!(a.front, front(t), "seed {seed}: the Fire front");
        assert_eq!(
            o.0,
            axis(a.front),
            "seed {seed}: the front row does not face the coliseum"
        );
        let mut want: Vec<Cell> = tiles_of(b"O")
            .into_iter()
            .map(|g| place(o, corner, g))
            .collect();
        want.sort_by_key(|c| (c.1, c.0));
        let got: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
        assert_eq!(
            got, want,
            "seed {seed}: the Fire entrance (six outlets, row-major)"
        );
    }
}

/// Over seeds 1-32 both mirror states occur, and every front direction the Fire sites produce occurs. Red on the stub.
#[test]
fn the_mirror_and_every_front_direction_occur() {
    let (mut mirrors, mut dirs, mut fronts) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    for l in maps() {
        let o = orientation(l);
        mirrors.insert(o.1);
        dirs.insert(o.0);
        fronts.insert(axis(front(fire_site(l).1)));
    }
    assert_eq!(
        mirrors.len(),
        2,
        "only mirrored = {mirrors:?} over seeds 1-32"
    );
    assert_eq!(dirs, fronts, "front directions used vs the sites' fronts");
}

// ---------------------------------------------------------------------------------------------------------------------
// Exactly three streams.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, every map: exactly three streams and three pools, all in Fire; each stream leaves exactly one outlet run
/// (one stream per run) and ends in exactly one pool (one pool per stream); it is two tiles wide and has no ford; each
/// pool holds at least 4 lava tiles with a 2x2 block; no stream or pool touches another stream's or pool's lava. Red on
/// the stub: two or three streams from a small cone with no outlets.
#[test]
fn exactly_three_streams_one_per_outlet_each_ending_in_its_pool() {
    let mut counts = Vec::new();
    for l in maps() {
        let m = &l.map;
        counts.push((
            l.seed,
            of_kind(m, FeatureKind::LavaStream).len(),
            of_kind(m, FeatureKind::LavaPool).len(),
        ));
    }
    let wrong: Vec<_> = counts.iter().filter(|c| (c.1, c.2) != (3, 3)).collect();
    assert!(
        wrong.is_empty(),
        "(seed, streams, pools) not three and three: {wrong:?}"
    );
    for l in maps() {
        let seed = l.seed;
        let o = orientation(l);
        let ss = streams(l, o);
        for s in &ss {
            let thin = thin_tiles(&s.lava);
            assert!(
                thin.is_empty(),
                "seed {seed}: run {} stream thin at {thin:?}",
                s.run
            );
            assert_eq!(
                pieces4(&s.lava),
                1,
                "seed {seed}: run {} stream is not one 4-connected band (a ford)",
                s.run
            );
            let set: BTreeSet<Cell> = s.pool.iter().copied().collect();
            let block = s.pool.iter().any(|&(x, y)| {
                [(1, 0), (0, 1), (1, 1)]
                    .iter()
                    .all(|&(dx, dy)| set.contains(&(x + dx, y + dy)))
            });
            assert!(
                s.pool.len() >= 4 && block,
                "seed {seed}: run {} pool of {} lava tiles is not a pool",
                s.run,
                s.pool.len()
            );
        }
        let bodies: Vec<Vec<Cell>> = ss
            .iter()
            .map(|s| [s.lava.clone(), s.pool.clone()].concat())
            .collect();
        for (a, x) in bodies.iter().enumerate() {
            for (b, y) in bodies.iter().enumerate().skip(a + 1) {
                assert!(
                    !touches(x, y),
                    "seed {seed}: the streams of runs {a} and {b} touch"
                );
            }
        }
    }
}

/// Seeds 1-32: each stream's length is in the owner's range for its run (left and right 10-14, middle 14-18), and the
/// middle stream is strictly the longest. Red on the stub.
#[test]
fn the_middle_stream_is_14_to_18_and_the_longest_the_sides_10_to_14() {
    let mut bad = Vec::new();
    for l in maps() {
        let o = orientation(l);
        let ss = streams(l, o);
        let lens: Vec<Option<i32>> = ss.iter().map(|s| s.len).collect();
        for (s, &(lo, hi)) in ss.iter().zip(&owner_len()) {
            if !s.len.is_some_and(|n| (lo..=hi).contains(&n)) {
                bad.push(format!(
                    "seed {}: run {} length {:?} not in {lo}-{hi}",
                    l.seed, s.run, s.len
                ));
            }
        }
        if !(lens[1] > lens[0] && lens[1] > lens[2]) {
            bad.push(format!(
                "seed {}: the middle stream is not the longest: {lens:?}",
                l.seed
            ));
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

/// Seeds 1-32: the streams fan out toward the coliseum: in grid coordinates every pool lies beyond the front row
/// (displacement dy > 0); the left run's pool lies left of its run (dx < 0), the right run's right (dx > 0), the middle
/// one within 45 degrees of straight ahead (|dx| <= dy); and the pools' columns ascend left, middle, right (the side
/// streams on their own side of the middle one). Red on the stub.
#[test]
fn the_streams_fan_toward_the_coliseum_each_on_its_own_side() {
    for l in maps() {
        let seed = l.seed;
        let o = orientation(l);
        let (corner, _) = fire_site(l);
        let ss = streams(l, o);
        let mut cols = Vec::new();
        for s in &ss {
            let n = s.pool.len() as f64;
            let (sx, sy) = s.pool.iter().fold((0.0, 0.0), |acc, &c| {
                let g = grid_of(o, corner, (f64::from(c.0) + 0.5, f64::from(c.1) + 0.5));
                (acc.0 + g.0, acc.1 + g.1)
            });
            let run_centre = (f64::from(runs()[s.run][0].0) + 1.0, 29.5);
            let (dx, dy) = (sx / n - run_centre.0, sy / n - run_centre.1);
            let ok = dy > 0.0
                && match s.run {
                    0 => dx < 0.0,
                    1 => dx.abs() <= dy,
                    _ => dx > 0.0,
                };
            assert!(
                ok,
                "seed {seed}: run {} pool displaced ({dx:.1}, {dy:.1}) in grid tiles from its run",
                s.run
            );
            cols.push(sx / n);
        }
        assert!(
            cols[0] < cols[1] && cols[1] < cols[2],
            "seed {seed}: the pools' grid columns {cols:?} do not ascend left, middle, right"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The frame.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, the accepted attempt's Landmarks phase: the Fire frame has a landing whose box is the anchor's footprint
/// and whose orientation is the one the finished map shows; its marks are exactly the six `O` tiles in grid order,
/// each with its grid tile; `heading((0, 1))` is the front axis and `heading` turns the side headings; its features are
/// the volcano, then stream and pool for the left, the middle and the right run in that order (the draw and write order
/// follows the drawing, not the map), the i-th stream's lava touching the i-th run. Red on the stub: no landing.
#[test]
fn the_fire_frame_lands_the_drawing_and_writes_the_streams_in_outlet_order() {
    use FeatureKind::{LavaPool, LavaStream, Volcano};
    for l in maps() {
        let seed = l.seed;
        let f = l.placed.frames.iter().find(|f| f.anchor.zone == Zone::Fire);
        assert!(f.is_some(), "seed {seed}: no Fire frame");
        let f = f.unwrap();
        assert!(
            f.landing.is_some(),
            "seed {seed}: the volcano's frame has no landing"
        );
        let landing = f.landing.unwrap();
        let o = orientation(l);
        let (corner, _) = fire_site(l);
        assert_eq!(
            (landing.orientation.front, landing.orientation.mirrored),
            o,
            "seed {seed}: the landing's orientation"
        );
        assert_eq!(
            landing.footprint, f.anchor.footprint,
            "seed {seed}: the landing's box"
        );
        let want: Vec<(u8, Cell, Cell)> = tiles_of(b"O")
            .into_iter()
            .map(|g| (b'O', g, place(o, corner, g)))
            .collect();
        let got: Vec<(u8, Cell, Cell)> = f
            .marks
            .iter()
            .map(|k| (k.ch, k.grid, (k.tile.x, k.tile.y)))
            .collect();
        assert_eq!(got, want, "seed {seed}: the frame's marks");
        assert_eq!(f.heading((0, 1)), Some(o.0), "seed {seed}: heading((0, 1))");
        for h in DEFAULT_DEFINITION.outlet_heading {
            assert_eq!(
                f.heading(h),
                Some(turn(o, h)),
                "seed {seed}: heading({h:?})"
            );
        }
        let kinds: Vec<FeatureKind> = f.features.iter().map(|&(k, _)| k).collect();
        assert_eq!(
            kinds,
            vec![Volcano, LavaStream, LavaPool, LavaStream, LavaPool, LavaStream, LavaPool],
            "seed {seed}: the frame's features"
        );
        let st = &l.stage;
        let w = st.state.w as i32;
        let stage_streams: Vec<usize> = (0..st.state.features.len())
            .filter(|&k| {
                st.state.features[k].zone == Zone::Fire && st.state.features[k].kind == LavaStream
            })
            .collect();
        for (i, &k) in stage_streams.iter().enumerate() {
            let lava: Vec<Cell> = (0..st.state.feature_owner.len())
                .filter(|&j| {
                    usize::from(st.state.feature_owner[j]) == k + 1
                        && st.state.tiles[j] == TILE_LOW
                        && l.placed.terrain[j] == DEFAULT_DEFINITION.lava
                })
                .map(|j| (j as i32 % w, j as i32 / w))
                .collect();
            let run: Vec<Cell> = runs()[i.min(2)]
                .iter()
                .map(|&g| place(o, corner, g))
                .collect();
            assert!(
                touches(&lava, &run),
                "seed {seed}: the stream written {i}th does not leave run {i} (grid order)"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lava.
// ---------------------------------------------------------------------------------------------------------------------

/// The generator's lava budget is the provisional window, and every map's Fire lava (the cone's crater lake, channels
/// and outlets, the streams and the pools) lies inside it. Red on the stub: today's budget (80, 150) and maps of about
/// 100 lava tiles.
#[test]
fn the_fire_lava_lies_in_the_provisional_window() {
    let w = provisional_lava_window();
    assert_eq!(
        DEFAULT_DEFINITION.lava_budget, w,
        "Definition::lava_budget is not the provisional window"
    );
    let mut bad = Vec::new();
    for l in maps() {
        let m = &l.map;
        let mut parts: BTreeMap<String, usize> = BTreeMap::new();
        for i in
            (0..m.tiles.len()).filter(|&i| is_lava(m, i) && m.region_grid[i] == Zone::Fire.code())
        {
            let kind = usize::from(m.feature_grid[i])
                .checked_sub(1)
                .map(|k| format!("{:?}", m.features[k].kind))
                .unwrap_or_else(|| "unowned".into());
            *parts.entry(kind).or_default() += 1;
        }
        let total: usize = parts.values().sum();
        if !(w.0..=w.1).contains(&total) {
            bad.push(format!("seed {}: {total} lava tiles {parts:?}", l.seed));
        }
    }
    assert!(bad.is_empty(), "outside {w:?}: {bad:#?}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: green on the stub, must keep passing.
// ---------------------------------------------------------------------------------------------------------------------

/// Guard. The generator's copy of the drawing is byte-equal to the approved file, and the drawing is what this oracle
/// reads: 30 x 30; 656 wall tiles (362 `#`, 214 `X`, 80 `H`), 154 `~`, 6 `O`, 84 `.`; the `O` tiles exactly the three
/// runs of the front row; the outlet table of `Definition` is the owner's (headings 45 degrees left, straight, 45
/// degrees right; lengths 10-14, 14-18, 10-14).
#[test]
fn guard_the_drawing_and_the_outlet_table_are_the_owners() {
    let d = DEFAULT_DEFINITION;
    assert!(
        d.volcano_grid == approved(),
        "volcano_grid is not the approved file"
    );
    let g = grid();
    assert_eq!(g.len() as i32, side(), "rows");
    assert!(g.iter().all(|r| r.len() as i32 == side()), "columns");
    let count = |ch: u8| tiles_of(&[ch]).len();
    assert_eq!(
        b"#XH~O.".map(count),
        [362, 214, 80, 154, 6, 84],
        "glyph counts"
    );
    assert_eq!(tiles_of(b"O"), runs().concat(), "the outlet runs");
    assert_eq!(
        d.outlet_heading,
        [(-1, 1), (0, 1), (1, 1)],
        "outlet headings"
    );
    assert_eq!(d.outlet_len, owner_len(), "outlet lengths");
}

/// Guard. Every seed keeps all four signature landmarks and the Holy anchor and certifies with zero failures (every
/// zone strict).
#[test]
fn guard_every_zone_keeps_its_landmark_and_every_map_certifies_clean() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        single(seed, m, FeatureKind::Volcano, Zone::Fire);
        single(seed, m, FeatureKind::Church, Zone::Sentenced);
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

/// Guard (PROVISIONAL bound, a number for the owner). The worst attempt index over seeds 1-32.
#[test]
fn guard_the_worst_attempt_stays_within_the_provisional_bound() {
    let worst = maps()
        .map(|l| (l.map.attempt, l.seed))
        .max()
        .expect("seeds generated");
    assert!(
        worst.0 <= worst_attempt_allowed(),
        "seed {}: attempt {} (provisional bound {})",
        worst.1,
        worst.0,
        worst_attempt_allowed()
    );
}

/// Guard (PROVISIONAL bound, a number for the owner). The attempts seeds 1-32 use in all.
#[test]
fn guard_the_attempts_used_stay_within_the_provisional_bound() {
    let used: u64 = maps().map(|l| l.map.attempt + 1).sum();
    assert!(
        used <= attempts_allowed(),
        "{used} attempts over seeds 1-32 (provisional bound {})",
        attempts_allowed()
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// The measurement for the owner.
// ---------------------------------------------------------------------------------------------------------------------

/// The report (not a gate check; run with `--ignored --nocapture`, on the stub for "before" and on the implementation
/// for "after"): seeds 1-64, option on: the attempt each lands on and every refusal by reason; the Fire lava by owner
/// kind; the three stream lengths in run order (when the volcano is the drawing); the Fire crater count, option on and
/// option off; then the totals (the brief, "Numbers for the owner").
#[test]
#[ignore]
fn report_seeds_1_to_64() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let mut refusals = BTreeMap::<String, usize>::new();
    let (mut used, mut worst, mut lost) = ((0u64, 0u64), ((0u64, 0i64), (0u64, 0i64)), Vec::new());
    let mut lava_range = (usize::MAX, 0usize);
    for seed in 1..=64i64 {
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
        let mut parts: BTreeMap<String, usize> = BTreeMap::new();
        for i in (0..map.tiles.len())
            .filter(|&i| is_lava(&map, i) && map.region_grid[i] == Zone::Fire.code())
        {
            let kind = usize::from(map.feature_grid[i])
                .checked_sub(1)
                .map(|k| format!("{:?}", map.features[k].kind))
                .unwrap_or_else(|| "unowned".into());
            *parts.entry(kind).or_default() += 1;
        }
        let total: usize = parts.values().sum();
        lava_range = (lava_range.0.min(total), lava_range.1.max(total));
        let craters = |m: &GameMapData| {
            m.features
                .iter()
                .filter(|f| f.kind == FeatureKind::Crater && f.zone == Zone::Fire)
                .count()
        };
        let off = generator
            .certified_styled(
                seed,
                pipeline::Options {
                    decor: false,
                    ..pipeline::Options::default()
                },
            )
            .expect("generator error")
            .map(|m| craters(&m));
        let (prefix, stage, placed) =
            landmarks_phase(seed, n).expect("the accepted attempt's Landmarks phase");
        let l = Landed {
            seed,
            map,
            prefix,
            stage,
            placed,
        };
        let drawn = orientations()
            .into_iter()
            .filter(|&o| {
                let (bad, _, extra) = mismatches(&l, o);
                bad == 0 && extra == 0
            })
            .collect::<Vec<_>>();
        let lens = match drawn[..] {
            [o] if of_kind(&l.map, FeatureKind::LavaStream).len() == 3 => {
                format!(
                    "{:?}",
                    streams(&l, o).iter().map(|s| s.len).collect::<Vec<_>>()
                )
            }
            _ => "not the drawing".into(),
        };
        eprintln!(
            "seed {seed}: attempt {n}; lava {total} {parts:?}; stream lengths {lens}; Fire craters on {} off {off:?}",
            craters(&l.map)
        );
    }
    eprintln!(
        "attempts {} / {} (seeds 1-32 / 1-64); worst {:?} / {:?} (attempt, seed); no map {lost:?}",
        used.0, used.1, worst.0, worst.1
    );
    eprintln!("refusals {refusals:?}");
    eprintln!("Fire lava over seeds 1-64: {lava_range:?}");
}
