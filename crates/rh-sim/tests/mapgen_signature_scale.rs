//! Oracle of P-MAPGEN-SIG-SCALE-1: in signature mode the Frost cave IS the owner-approved blueprint
//! (`docs/landmarks/blueprints/cave.txt`, owner decision 2026-11-13; requirements L1 and L5; ADR 0028 rule G9): one size
//! (29 x 29), one layout, placed in one of eight orientations round the camp of the Frost zone's reserved site
//! (P-MAPGEN-SIG-RESERVE-1), its front toward the coliseum. Between maps only the site, the rotation (the front's
//! dominant axis) and the mirror (one draw of the Frost signature stream) vary. No legacy counterpart (DEV-020).
//! Seeds 1-32, option on, each seed's first accepted attempt, generated once per test binary. Numbers: the brief
//! (`docs/backlog/packets/P-MAPGEN-SIG-SCALE-1.md`, "Measurements").
//!
//! Definitions (tile units; x to the right, y down, as the map's tile index `y * w + x`):
//! * the drawing: the lines of `cave.txt` that do not start with `;` and are not empty; grid tile (gx, gy) is character
//!   gx of line gy. `#` wall, `R` rock (a wall), `.` plain floor, `=` ice floor, `D` the mouth (floor), `E` the elite
//!   camp's tile (plain floor). Its front (the mouth's side) is the bottom, +gy.
//! * an orientation: a front direction u (one of (1, 0), (-1, 0), (0, 1), (0, -1)) and a mirror flag. Unmirrored, the
//!   drawing's +gx maps to r = (u.1, -u.0) (a rotation of the drawing as drawn: u = (0, 1) is the drawing itself);
//!   mirrored, to -r. Placed at camp tile t, grid tile (gx, gy) lands on t + (gy - ey) * u + (gx - ex) * (+-r), where
//!   (ex, ey) is the drawing's `E`.
//! * the site and its camp: the Frost `ReservedSite` of the accepted attempt's prefix
//!   (`attempt::begin_attempt_signature(.., true)`); its inner rect: the site shrunk by the core band
//!   (`DEFAULT_DEFINITION.bands[0]`) on every side.
//! * the cave: the one feature of kind `Cave` (index k); "owned by the cave": `feature_grid == k + 1`.
//! * the cave equals the drawing under an orientation when every grid tile's map tile is: for `#` and `R` a wall
//!   (`TILE_WALL`) owned by the cave with terrain 0; for `=` floor owned by the cave with terrain ice
//!   (`DEFAULT_DEFINITION.ice`); for `.`, `E` and `D` floor not owned by the cave and not ice; and the cave owns no other
//!   tile.
//! * the front toward the coliseum: u is the dominant axis (x on a tie) of `DIR16[f]`, f the DIR16 index of the largest
//!   dot product with (CX - t.x, CY - t.y) (first on a tie), and the Frost anchor's `front` is f.
//! * a camp's halo: the certifier's (`certify` "protected"): tiles t + (dx, dy), |dx|, |dy| <= `R.protection_span`,
//!   for which some |ox|, |oy| <= `R.halo` has (dx + ox)^2 + (dy + oy)^2 <= `R.clearing`^2.
use rh_sim::map::{TILE_FLOOR, TILE_WALL};
use rh_sim::mapdata::{FeatureKind, GameMapData, TileRect, Zone};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::coliseum::{CX, CY};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::{SignatureContext, DEFAULT_DEFINITION};
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, certify, coliseum, map_hash, pipeline};
use std::collections::{BTreeSet, VecDeque};
use std::sync::OnceLock;

type Cell = (i32, i32);

// ---------------------------------------------------------------------------------------------------------------------
// The numbers (functions, not consts: `tests/content.rs` reads consts as unregistered tunables).
// ---------------------------------------------------------------------------------------------------------------------

/// The approved drawing, read from the docs (the owner's copy; the generator carries a byte-equal copy in the crate).
fn approved() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/cave.txt")
}

/// The drawing's side (tiles), both ways.
fn side() -> i32 {
    29
}

/// The attempts `certified_styled` may use.
fn attempt_limit() -> u64 {
    16
}

/// The worst attempt index allowed over seeds 1-32: P-MAPGEN-SIG-RESERVE-1's bound (coordinator decision 2026-11-13;
/// measured with the fixed cave and the site's territory relabel: 4; today 1).
fn worst_attempt_allowed() -> u64 {
    7
}

/// The most attempts seeds 1-32 may use in all: P-MAPGEN-SIG-RESERVE-1's bound (measured 59; today 41).
fn attempts_allowed() -> u64 {
    70
}

/// The longest floor path from the cave's mouth to the zone's largest unowned ice body (the end-of-attempt lake rule,
/// `lake_reach + lake_slack`).
fn mouth_to_lake() -> usize {
    DEFAULT_DEFINITION.lake_reach + DEFAULT_DEFINITION.lake_slack
}

/// Today's option-off generator, seeds 1-8: (seed, `map_hash`, FNV-1a 64 of the map's JSON); the values pinned by
/// `mapgen_signature_fire.rs`, `mapgen_signature_frost.rs`, `mapgen_signature_frost_lake.rs` and
/// `mapgen_signature_reserve.rs` (G8).
fn pinned_off() -> [(i64, &'static str, u64); 8] {
    [
        (1, "d09b4fd9", 0xf638_ce4a_8563_d41d),
        (2, "190cd50f", 0xf13c_e037_fbd7_f651),
        (3, "b82117b8", 0xeb4f_0525_0310_7414),
        (4, "bec16d65", 0x785a_11c3_0a31_46b7),
        (5, "25032ba7", 0x0f6e_a513_6ba7_ca0d),
        (6, "2d58fdf5", 0x600e_c62d_a4c6_d207),
        (7, "6255dbbe", 0x7188_b411_554a_ddb7),
        (8, "dbb3602f", 0xd855_dc2a_be46_a4eb),
    ]
}

/// The volcano the Landmarks phase places on seeds 1-8, attempts 0 and 1 (option on), before this packet: (seed,
/// attempt, `others_digest`). The cave is placed last on its own stream, so it never moves (seed 2 attempt 1 fails its
/// prefix: 0). Amended by P-MAPGEN-SIG-SCALE-3: the bog tree is the blueprint now and is left out; amended by
/// P-MAPGEN-SIG-SCALE-2: the church and its graveyard too (re-measured on that packet's stub rebased onto the tree; its
/// oracle pins the church). STUB-REMEASURE: the values below are the tree's and are re-pinned in the rebase fix-up.
fn pinned_others() -> [(i64, u64, u64); 16] {
    [
        (1, 0, 0x8c46_fd6c_2a91_e159),
        (1, 1, 0xd65b_7b72_989c_547d),
        (2, 0, 0xd9de_f016_c1d3_97ec),
        (2, 1, 0),
        (3, 0, 0xc3fb_6a95_77e8_3c68),
        (3, 1, 0xfbda_c5dd_f01d_bf8b),
        (4, 0, 0xbcd6_c7f8_c4c5_fef6),
        (4, 1, 0xe011_7dec_285d_eadf),
        (5, 0, 0xdc51_3636_ef93_1a07),
        (5, 1, 0xd3d9_c4b7_9052_c500),
        (6, 0, 0xba9f_f7b0_ccc0_13e3),
        (6, 1, 0x6c22_5bef_0da5_c4b0),
        (7, 0, 0x9c08_27c4_14f6_2dc1),
        (7, 1, 0xf45d_e6e2_0805_ee45),
        (8, 0, 0x142b_c64a_6d01_3a5a),
        (8, 1, 0x668e_daaf_2fcd_cc1b),
    ]
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

/// The drawing's tiles of character `c`.
fn tiles_of(c: u8) -> Vec<Cell> {
    let mut out = Vec::new();
    for (gy, row) in grid().iter().enumerate() {
        for (gx, &ch) in row.iter().enumerate() {
            if ch == c {
                out.push((gx as i32, gy as i32));
            }
        }
    }
    out
}

fn e_tile() -> Cell {
    tiles_of(b'E')[0]
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

/// The Frost site of the accepted attempt's prefix: (rect, camp tile).
fn frost_site(l: &Landed) -> (TileRect, Cell) {
    let r = l
        .prefix
        .reserved
        .iter()
        .find(|r| r.zone == Zone::Frost)
        .unwrap_or_else(|| panic!("seed {}: no Frost site in the prefix", l.seed));
    let camp = r
        .camp
        .unwrap_or_else(|| panic!("seed {}: the Frost site has no camp", l.seed));
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

/// How many grid tiles differ from the drawing under orientation `o` placed at the site's camp, and the first one
/// (grid tile, map tile, what was found), plus the count of tiles the cave owns outside the drawing's wall and ice.
fn mismatches(l: &Landed, o: Orientation) -> (usize, Option<String>, usize) {
    let m = &l.map;
    let k = single(l.seed, m, FeatureKind::Cave, Zone::Frost);
    let (_, t) = frost_site(l);
    let ice = DEFAULT_DEFINITION.ice;
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
                b'#' | b'R' => tile == TILE_WALL && own && terrain == 0,
                b'=' => tile == TILE_FLOOR && own && terrain == ice,
                _ => tile == TILE_FLOOR && !own && terrain != ice,
            };
            if matches!(ch, b'#' | b'R' | b'=') {
                drawn.insert(i);
            }
            if !ok {
                bad += 1;
                first.get_or_insert_with(|| {
                    format!(
                        "grid {g:?} '{}' at {p:?}: tile {tile}, terrain {terrain}, owned by the cave {own}",
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

/// The one orientation under which the cave equals the drawing, or a panic naming the closest.
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
        "seed {} (attempt {}): the cave equals the drawing under {} orientations; closest {o:?}: {bad} of {} tiles differ \
         (first: {first:?}), {extra} cave tiles outside the drawing",
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

/// FNV-1a 64 of what the Landmarks phase places for the volcano on (seed, attempt), option on: its anchor (JSON) and,
/// for every feature the phase leaves except the cave, the bog tree, the church and its graveyard, the feature (JSON)
/// and each tile it owns (index, tile, terrain). 0 when the phase refuses the attempt or the prefix fails.
fn others_digest(seed: i64, n: u64) -> u64 {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let Some(frame) =
        attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")
    else {
        return 0;
    };
    let Some(mut st) = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")
    else {
        return 0;
    };
    let Some(placed) = SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")
    else {
        return 0;
    };
    let mut bytes = Vec::new();
    for a in placed
        .anchors
        .iter()
        .filter(|a| a.zone != Zone::Frost && a.zone != Zone::Plague && a.zone != Zone::Sentenced)
    {
        bytes.extend(serde_json::to_vec(a).unwrap());
    }
    // P-MAPGEN-SIG-SCALE-2: the church and its graveyard are left out too (the blueprint now; the volcano, the tree and
    // the cave are pinned against that packet by `mapgen_signature_church.rs`).
    for (k, f) in st.state.features.iter().enumerate() {
        if matches!(
            f.kind,
            FeatureKind::Cave | FeatureKind::BogTree | FeatureKind::Church | FeatureKind::Graveyard
        ) {
            continue;
        }
        bytes.extend(serde_json::to_vec(f).unwrap());
        for (i, &owner) in st.state.feature_owner.iter().enumerate() {
            if usize::from(owner) == k + 1 {
                bytes.extend((i as u32).to_le_bytes());
                bytes.push(st.state.tiles[i]);
                bytes.push(placed.terrain[i]);
            }
        }
    }
    fnv(&bytes)
}

// ---------------------------------------------------------------------------------------------------------------------
// The blueprint (red today: the cave is a 9-15 tile chamber drawn by rule, and the generator holds no drawing).
// ---------------------------------------------------------------------------------------------------------------------

/// The generator's copy of the drawing (`signature::DEFAULT_DEFINITION.cave_grid`, read from
/// `crates/rh-sim/src/mapgen/landmarks/signature/cave.txt`) is byte-equal to the approved drawing in the docs, which is
/// 29 x 29 with one `E` and a 3-tile `D` mouth in the middle of the bottom row. Red today: the field is empty.
#[test]
fn the_generators_blueprint_is_the_approved_drawing() {
    let g = grid();
    assert_eq!(g.len() as i32, side(), "the drawing's rows");
    assert!(
        g.iter().all(|r| r.len() as i32 == side()),
        "the drawing's columns"
    );
    assert_eq!(tiles_of(b'E'), vec![(14, 7)], "the drawing's camp tile");
    assert_eq!(
        tiles_of(b'D'),
        vec![(13, 28), (14, 28), (15, 28)],
        "the drawing's mouth"
    );
    assert!(
        DEFAULT_DEFINITION.cave_grid == approved(),
        "signature::DEFAULT_DEFINITION.cave_grid ({} bytes) is not byte-equal to docs/landmarks/blueprints/cave.txt ({} \
         bytes)",
        DEFAULT_DEFINITION.cave_grid.len(),
        approved().len()
    );
}

/// On every seed the cave's tiles equal the drawing, tile for tile (wall, rock, ice, plain floor, the mouth), under
/// exactly one of the eight orientations, placed at the Frost site's camp tile; the cave owns nothing else. Red today:
/// no orientation matches (caves of 9-15 tiles a side).
#[test]
fn the_cave_is_the_blueprint_under_one_of_eight_orientations() {
    for l in maps() {
        orientation(l);
    }
}

/// The Frost anchor is the blueprint's: its centre the site's camp tile, its footprint the 29 x 29 box the drawing
/// lands on, its entrance the drawing's three mouth tiles; the box lies inside the site's inner rect; the front faces
/// the coliseum (the orientation's front direction is the dominant axis of the anchor's DIR16 `front`, which is the
/// generator's rule toward the coliseum from the camp). Red today: footprints of 9-15 tiles a side.
#[test]
fn the_frost_anchor_is_the_blueprint_box_facing_the_coliseum_inside_the_site() {
    let b = DEFAULT_DEFINITION.bands[0];
    for l in maps() {
        let seed = l.seed;
        let a = l
            .map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Frost)
            .unwrap_or_else(|| panic!("seed {seed}: no Frost anchor"));
        assert_eq!(
            (a.footprint.w as i32, a.footprint.h as i32),
            (side(), side()),
            "seed {seed}: the Frost anchor's footprint {:?}",
            a.footprint
        );
        let (site, t) = frost_site(l);
        assert_eq!(
            (a.centre.x, a.centre.y),
            t,
            "seed {seed}: the Frost anchor's centre is not the site's camp"
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
        let inner = grow(site, -b);
        assert!(
            inside(inner, (bx.0, bx.1)) && inside(inner, (bx.2, bx.3)),
            "seed {seed}: the box {bx:?} leaves the site's inner rect {inner:?}"
        );
        let mut mouth: Vec<Cell> = tiles_of(b'D').into_iter().map(|g| place(t, o, g)).collect();
        let mut entrance: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
        mouth.sort();
        entrance.sort();
        assert_eq!(entrance, mouth, "seed {seed}: the anchor's entrance");
        assert_eq!(a.front, front(t), "seed {seed}: the anchor's front");
        assert_eq!(
            o.0,
            axis(a.front),
            "seed {seed}: the mouth does not face the coliseum (front {})",
            a.front
        );
    }
}

/// Over seeds 1-32 the mirror is used (both mirrored and unmirrored caves occur) and every front direction the sites
/// produce occurs (the set of the orientations' directions is the set of the camps' front axes). Red today: no
/// orientation matches.
#[test]
fn the_mirror_and_every_front_direction_occur() {
    let mut mirrors = BTreeSet::new();
    let mut dirs = BTreeSet::new();
    let mut fronts = BTreeSet::new();
    for l in maps() {
        let o = orientation(l);
        mirrors.insert(o.1);
        dirs.insert(o.0);
        fronts.insert(axis(front(frost_site(l).1)));
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

/// Guard. The map camp on the site's camp tile is a Frost elite camp at the Frost anchor's centre, and its whole halo
/// is floor that no feature owns, without terrain (the drawing keeps it plain).
#[test]
fn the_elite_camp_stands_at_the_anchor_and_its_halo_is_free() {
    for l in maps() {
        let (seed, m) = (l.seed, &l.map);
        let (_, t) = frost_site(l);
        let camp = m
            .camps
            .iter()
            .find(|c| c.zone == Zone::Frost && world_cell(c.x, c.y) == t)
            .unwrap_or_else(|| panic!("seed {seed}: no Frost camp on the site's camp tile {t:?}"));
        assert!(
            camp.elite_spot >= 0,
            "seed {seed}: the cave's camp is not elite"
        );
        let a = m.anchors.iter().find(|a| a.zone == Zone::Frost).unwrap();
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

/// Guard. Every seed keeps all four signature landmarks and the Holy anchor and certifies with zero failures under the
/// strictest settings (every zone strict: elite selection, spawn-walk ratio, routes, feature tiles included).
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

/// Guard. The lake rule (P-MAPGEN-SIG-FROST-2): the Frost zone's largest unowned ice body is at most `mouth_to_lake()`
/// walked floor steps from the cave's mouth. The apron rule: no tile of one landmark lies in another's box grown by the
/// core band (the volcano's streams and pools count as its tiles but have no box apron; the Holy hall is the Holy
/// anchor's `Hall`).
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
                    && m.tiles[i] == TILE_FLOOR
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
        if let Some(i) = at(m, s).filter(|&i| m.tiles[i] == TILE_FLOOR) {
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
            if let Some(i) = at(m, n).filter(|&i| !seen[i] && m.tiles[i] == TILE_FLOOR) {
                seen[i] = true;
                queue.push_back((n, d + 1));
            }
        }
    }
    None
}

/// Guard. Option off: seeds 1-8 give today's maps byte for byte (G8); the option-off prefix reserves no site.
#[test]
fn option_off_is_todays_generator() {
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    for (seed, hash, json) in pinned_off() {
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

/// Guard. The volcano the Landmarks phase places is today's (`pinned_others`): the cave is placed last and draws only
/// from the Frost stream (the bog tree left out by P-MAPGEN-SIG-SCALE-3, the church and its graveyard by
/// P-MAPGEN-SIG-SCALE-2).
#[test]
fn the_other_three_landmarks_are_unchanged() {
    for (seed, n, digest) in pinned_others() {
        assert_eq!(
            others_digest(seed, n),
            digest,
            "seed {seed} attempt {n}: the volcano moved"
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
/// lands on, every refusal by reason, the cave's orientation, its box's offset from the site's corner, the floor tiles
/// between the mouth and the site's edge, and the walked floor steps from the mouth to the largest unowned Frost ice
/// body; then the totals (brief, "Measurements").
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
        let (site, _) = frost_site(&l);
        let a = l
            .map
            .anchors
            .iter()
            .find(|a| a.zone == Zone::Frost)
            .unwrap();
        let o = orientation(&l);
        let mut mouth: Vec<Cell> = a.entrance.iter().map(|p| (p.x, p.y)).collect();
        mouth.sort();
        let mid = mouth[1];
        let s = grow(site, 0);
        let mut apron = 0;
        let mut p = (mid.0 + o.0 .0, mid.1 + o.0 .1);
        while inside(s, p) {
            apron += usize::from(l.map.tiles[at(&l.map, p).unwrap()] == TILE_FLOOR);
            p = (p.0 + o.0 .0, p.1 + o.0 .1);
        }
        let cave = single(seed, &l.map, FeatureKind::Cave, Zone::Frost);
        let ice: BTreeSet<Cell> = (0..l.map.tiles.len())
            .filter(|&i| {
                l.map.region_grid[i] == Zone::Frost.code()
                    && l.map.tiles[i] == TILE_FLOOR
                    && l.map.terrain[i] == DEFAULT_DEFINITION.ice
                    && usize::from(l.map.feature_grid[i]) != cave + 1
            })
            .map(tile_cell)
            .collect();
        let lake = largest_body(&ice).and_then(|b| floor_steps(&l.map, &mouth, &b));
        eprintln!(
            "seed {seed}: attempt {n}, front {:?} mirrored {}, box offset ({}, {}), mouth-to-site-edge floor {apron}, \
             mouth-to-lake steps {lake:?}",
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
