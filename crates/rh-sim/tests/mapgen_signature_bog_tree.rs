//! Oracle of P-MAPGEN-SIG-SCALE-3: in signature mode the Plague bog tree IS the owner-approved blueprint
//! (`docs/landmarks/blueprints/bog.txt`, owner decision 2026-11-13; requirements L1 and L3; ADR 0028 rule G9): one size
//! (29 x 29), one layout, centred on the Plague zone's reserved site (P-MAPGEN-SIG-RESERVE-1) in one of eight
//! orientations, its front toward the coliseum. Between maps only the site, the rotation (the front's dominant axis) and
//! the mirror (one draw of the Plague signature stream) vary. No legacy counterpart (DEV-020). Seeds 1-32, option on,
//! each seed's first accepted attempt, generated once per test binary. Numbers: the brief
//! (`docs/backlog/packets/P-MAPGEN-SIG-SCALE-3.md`, "Measurements").
//!
//! Definitions (tile units; x to the right, y down, as the map's tile index `y * w + x`):
//! * the drawing: the lines of `bog.txt` that do not start with `;` and are not empty; grid tile (gx, gy) is character
//!   gx of line gy. `T` trunk and `r` root are walls, `%` the marsh (floor with the bog terrain), `:` a dry causeway and
//!   `.` dry floor (plain floor). Its front is the bottom, +gy. Its centre is grid tile (side / 2, side / 2) = (14, 14),
//!   the trunk's centre.
//! * the site: the Plague `ReservedSite` of the accepted attempt's prefix (`attempt::begin_attempt_signature(.., true)`);
//!   its centre tile: (rect.x + rect.w / 2, rect.y + rect.h / 2) (offset (17, 17) at side 34, the tile
//!   `inside_camp` measures the front from); its inner rect: the site shrunk by the core band
//!   (`DEFAULT_DEFINITION.bands[0]`) on every side.
//! * an orientation: a front direction u (one of (1, 0), (-1, 0), (0, 1), (0, -1)) and a mirror flag. Unmirrored, the
//!   drawing's +gx maps to r = (u.1, -u.0) (u = (0, 1) is the drawing as drawn); mirrored, to -r. Placed at centre
//!   tile t, grid tile (gx, gy) lands on t + (gy - cy) * u + (gx - cx) * (+-r), (cx, cy) the drawing's centre. The box is
//!   then t +- 14 both ways in every orientation.
//! * the tree: the one feature of kind `BogTree` (index k); "owned by the tree": `feature_grid == k + 1`.
//! * the tree equals the drawing under an orientation when every grid tile's map tile is: for `T` and `r` a wall
//!   (`TILE_WALL`) owned by the tree with terrain 0; for `%` floor owned by the tree with terrain bog
//!   (`DEFAULT_DEFINITION.bog`); for `.` and `:` floor not owned by the tree and without the bog terrain; and the tree
//!   owns no other tile.
//! * the causeway openings: the `:` tiles on the drawing's outer rows and columns (six: two per causeway); the Plague
//!   anchor's `entrance` (the brief's definition, proposed by this oracle).
//! * the front toward the coliseum: u is the dominant axis (x on a tie) of `DIR16[f]`, f the DIR16 index of the largest
//!   dot product with (CX - t.x, CY - t.y) (first on a tie), and the Plague anchor's `front` is f.
use rh_sim::map::{TILE_FLOOR, TILE_WALL};
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::coliseum::{CX, CY};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::DEFAULT_DEFINITION;
use rh_sim::mapgen::{attempt, certify, coliseum, map_hash, pipeline};
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
    include_str!("../../../docs/landmarks/blueprints/bog.txt")
}

/// The drawing's side (tiles), both ways.
fn side() -> i32 {
    29
}

/// The attempts `styled_attempt` is tried for per seed.
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index allowed over seeds 1-32: today's (the rule-drawn tree with the blueprint cave), so the fixed
/// tree costs no more than the tree it replaces (the brief, "Measurements": measured 2 with the fixed tree under either
/// mapping of the mirror draw; the cave's bound is 7).
fn worst_attempt_allowed() -> u64 {
    4
}

/// The most attempts seeds 1-32 may use in all: today's (measured 46 with the fixed tree under either mapping of the
/// mirror draw; the cave's bound is 70).
fn attempts_allowed() -> u64 {
    59
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

/// The drawing's tiles whose character is in `cs`, in grid (row-major) order.
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

fn centre_tile() -> Cell {
    (side() / 2, side() / 2)
}

/// The causeway openings (header definition).
fn openings() -> Vec<Cell> {
    tiles_of(b":")
        .into_iter()
        .filter(|&(x, y)| x == 0 || y == 0 || x == side() - 1 || y == side() - 1)
        .collect()
}

/// 8-connected pieces of `cells`, as sizes, smallest first.
fn piece_sizes(cells: &[Cell]) -> Vec<usize> {
    let set: BTreeSet<Cell> = cells.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for &s in cells {
        if !seen.insert(s) {
            continue;
        }
        let mut n = 0;
        let mut stack = vec![s];
        while let Some((x, y)) = stack.pop() {
            n += 1;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let c = (x + dx, y + dy);
                    if set.contains(&c) && seen.insert(c) {
                        stack.push(c);
                    }
                }
            }
        }
        out.push(n);
    }
    out.sort_unstable();
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

/// Where grid tile g lands with the drawing's centre placed at tile t under orientation o.
fn place(t: Cell, o: Orientation, g: Cell) -> Cell {
    let (u, mirrored) = o;
    let s = if mirrored { -1 } else { 1 };
    let r = (u.1 * s, -u.0 * s);
    let c = centre_tile();
    let (a, b) = (g.1 - c.1, g.0 - c.0);
    (t.0 + a * u.0 + b * r.0, t.1 + a * u.1 + b * r.1)
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

/// The Plague site of the accepted attempt's prefix: (rect, centre tile).
fn plague_site(l: &Landed) -> (TileRect, Cell) {
    let r = l
        .prefix
        .reserved
        .iter()
        .find(|r| r.zone == Zone::Plague)
        .unwrap_or_else(|| panic!("seed {}: no Plague site in the prefix", l.seed));
    (
        r.rect,
        (
            r.rect.x + r.rect.w as i32 / 2,
            r.rect.y + r.rect.h as i32 / 2,
        ),
    )
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

/// How many grid tiles differ from the drawing under orientation `o` centred on the site, and the first one (grid
/// tile, map tile, what was found), plus the count of tiles the tree owns outside the drawing's walls and marsh.
fn mismatches(l: &Landed, o: Orientation) -> (usize, Option<String>, usize) {
    let m = &l.map;
    let k = single(l.seed, m, FeatureKind::BogTree, Zone::Plague);
    let (_, t) = plague_site(l);
    let bog = DEFAULT_DEFINITION.bog;
    let mut bad = 0;
    let mut first = None;
    let mut drawn = BTreeSet::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, &ch) in row.iter().enumerate() {
            let g = (gx as i32, gy as i32);
            let p = place(t, o, g);
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
                b'T' | b'r' => tile == TILE_WALL && own && terrain == 0,
                b'%' => tile == TILE_FLOOR && own && terrain == bog,
                _ => tile == TILE_FLOOR && !own && terrain != bog,
            };
            if matches!(ch, b'T' | b'r' | b'%') {
                drawn.insert(i);
            }
            if !ok {
                bad += 1;
                first.get_or_insert_with(|| {
                    format!(
                        "grid {g:?} '{}' at {p:?}: tile {tile}, terrain {terrain}, owned by the tree {own}",
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

/// The one orientation under which the tree equals the drawing, or a panic naming the closest.
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
        "seed {} (attempt {}): the bog tree equals the drawing under {} orientations; closest {o:?}: {bad} of {} tiles \
         differ (first: {first:?}), {extra} tree tiles outside the drawing",
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
// The blueprint (red today: the tree is a 13-tile trunk ringed by two bog bands drawn by rule, and the generator holds
// no drawing).
// ---------------------------------------------------------------------------------------------------------------------

/// The generator's copy of the drawing (`signature::DEFAULT_DEFINITION.bog_grid`, read from
/// `crates/rh-sim/src/mapgen/landmarks/signature/bog.txt`) is byte-equal to the approved drawing in the docs. The
/// drawing as this oracle reads it: 29 x 29 of `T r % : .`; the trunk 11 x 11 round the centre (14, 14); the walls one
/// piece of 137 (trunk and three roots) and three free stumps of 6, none under `R.piece_min`; six causeway openings,
/// two on each of the back row, the left column and the front row; and no symmetry of the square maps it onto itself,
/// so the eight orientations are eight different layouts. Red today: the field is empty.
#[test]
fn the_generators_bog_blueprint_is_the_approved_drawing() {
    let g = grid();
    assert_eq!(g.len() as i32, side(), "the drawing's rows");
    assert!(
        g.iter().all(|r| r.len() as i32 == side()),
        "the drawing's columns"
    );
    assert_eq!(
        tiles_of(b"Tr%:.").len() as i32,
        side() * side(),
        "characters outside T r % : ."
    );
    let trunk = tiles_of(b"T");
    let bx = trunk
        .iter()
        .fold((i32::MAX, i32::MAX, i32::MIN, i32::MIN), |b, &(x, y)| {
            (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y))
        });
    assert_eq!(bx, (9, 9, 19, 19), "the trunk's box");
    assert_eq!(ch(centre_tile()), b'T', "the drawing's centre is trunk");
    let walls = tiles_of(b"Tr");
    let pieces = piece_sizes(&walls);
    assert_eq!(pieces, vec![6, 6, 6, 137], "the wall pieces");
    assert!(
        pieces[0] >= R.piece_min,
        "a root stump under piece_min ({})",
        R.piece_min
    );
    assert_eq!(
        openings(),
        vec![(12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28)],
        "the causeway openings"
    );
    let n = side() - 1;
    let symmetries: [fn(Cell, i32) -> Cell; 7] = [
        |(x, y), n| (n - x, y),
        |(x, y), n| (x, n - y),
        |(x, y), n| (n - x, n - y),
        |(x, y), _| (y, x),
        |(x, y), n| (n - y, n - x),
        |(x, y), n| (n - y, x),
        |(x, y), n| (y, n - x),
    ];
    for (k, f) in symmetries.iter().enumerate() {
        let same = (0..=n).all(|y| (0..=n).all(|x| ch((x, y)) == ch(f((x, y), n))));
        assert!(!same, "symmetry {k} maps the drawing onto itself");
    }
    assert!(
        DEFAULT_DEFINITION.bog_grid == approved(),
        "signature::DEFAULT_DEFINITION.bog_grid ({} bytes) is not byte-equal to docs/landmarks/blueprints/bog.txt ({} \
         bytes)",
        DEFAULT_DEFINITION.bog_grid.len(),
        approved().len()
    );
}

/// On every seed the tree's tiles equal the drawing, tile for tile (trunk and roots, marsh, dry floor, causeways), under
/// exactly one of the eight orientations, centred on the Plague site's centre tile; the tree owns nothing else. Red
/// today: no orientation matches.
#[test]
fn the_bog_tree_is_the_blueprint_under_one_of_eight_orientations() {
    for l in maps() {
        orientation(l);
    }
}

/// The Plague anchor is the blueprint's: its centre the site's centre tile (the trunk's centre, the feature's anchor
/// point, strictly inside the footprint), its footprint the 29 x 29 box the drawing lands on, inside the site's inner
/// rect; its entrance the six causeway openings (on the map, on the footprint's edge, floor on the finished map); the
/// front faces the coliseum (the orientation's front direction is the dominant axis of the anchor's DIR16 `front`, the
/// generator's rule from the centre). Red today: footprints of about 15 tiles a side, no entrance.
#[test]
fn the_plague_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let a = m
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Plague)
            .unwrap_or_else(|| panic!("seed {seed}: no Plague anchor"));
        assert_eq!(a.kind, FeatureKind::BogTree, "seed {seed}: anchor kind");
        assert_eq!(
            (a.footprint.w as i32, a.footprint.h as i32),
            (side(), side()),
            "seed {seed}: the Plague anchor's footprint {:?}",
            a.footprint
        );
        let (site, t) = plague_site(l);
        assert_eq!(
            (a.centre.x, a.centre.y),
            t,
            "seed {seed}: the Plague anchor's centre is not the site's centre tile"
        );
        let k = single(seed, m, FeatureKind::BogTree, Zone::Plague);
        assert_eq!(
            (m.features[k].ax, m.features[k].ay),
            t,
            "seed {seed}: the tree feature's anchor point"
        );
        let o = orientation(l);
        let corners = [(0, 0), (side() - 1, side() - 1)].map(|g| place(t, o, g));
        let bx = (
            corners[0].0.min(corners[1].0),
            corners[0].1.min(corners[1].1),
            corners[0].0.max(corners[1].0),
            corners[0].1.max(corners[1].1),
        );
        assert_eq!(
            grow(a.footprint, 0),
            bx,
            "seed {seed}: the footprint is not the drawing's box"
        );
        assert!(
            inside(grow(a.footprint, -1), t),
            "seed {seed}: the centre {t:?} is not strictly inside the footprint {:?}",
            a.footprint
        );
        let inner = grow(site, -b);
        assert!(
            inside(inner, (bx.0, bx.1)) && inside(inner, (bx.2, bx.3)),
            "seed {seed}: the box {bx:?} leaves the site's inner rect {inner:?}"
        );
        let mut want: Vec<Cell> = openings().into_iter().map(|g| place(t, o, g)).collect();
        let mut entrance: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
        want.sort();
        entrance.sort();
        assert_eq!(entrance, want, "seed {seed}: the anchor's entrance");
        for &p in &entrance {
            let on_edge = p.0 == bx.0 || p.0 == bx.2 || p.1 == bx.1 || p.1 == bx.3;
            assert!(
                at(m, p).is_some_and(|i| m.tiles[i] == TILE_FLOOR) && on_edge,
                "seed {seed}: entrance tile {p:?} is not floor on the footprint's edge"
            );
        }
        assert_eq!(a.front, front(t), "seed {seed}: the anchor's front");
        assert_eq!(
            o.0,
            axis(a.front),
            "seed {seed}: the front row does not face the coliseum (front {})",
            a.front
        );
    }
}

/// Over seeds 1-32 the mirror is used (both mirrored and unmirrored trees occur: the drawing is not mirror-symmetric,
/// so the two are different layouts) and every front direction the sites produce occurs (the set of the orientations'
/// directions is the set of the site centres' front axes). Red today: no orientation matches.
#[test]
fn the_mirror_and_every_front_direction_occur() {
    let mut mirrors = BTreeSet::new();
    let mut dirs = BTreeSet::new();
    let mut fronts = BTreeSet::new();
    for l in maps() {
        let o = orientation(l);
        mirrors.insert(o.1);
        dirs.insert(o.0);
        fronts.insert(axis(front(plague_site(l).1)));
    }
    assert_eq!(
        mirrors.len(),
        2,
        "only mirrored = {mirrors:?} over seeds 1-32"
    );
    assert_eq!(dirs, fronts, "front directions used vs the sites' fronts");
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: pass today, must keep passing.
// ---------------------------------------------------------------------------------------------------------------------

/// Guard. Every seed keeps all four signature landmarks and the Holy anchor and certifies with zero failures under the
/// strictest settings (every zone strict: feature tiles, hazards owned, wall pieces, routes included).
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
fn the_apron_rule_holds() {
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
        assert!(
            m.anchors.is_empty(),
            "seed {seed}: anchors with the option off"
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

/// The report (not a gate check; run with `--ignored --nocapture` and `time` the run): seeds 1-64, the attempt each
/// lands on, every refusal by reason, the tree's orientation and its box's offset from the site's corner; then the
/// totals (brief, "Measurements").
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
        let (site, _) = plague_site(&l);
        let a = l
            .map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Plague)
            .unwrap();
        let o = orientation(&l);
        eprintln!(
            "seed {seed}: attempt {n}, front {:?} mirrored {}, box offset ({}, {})",
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
