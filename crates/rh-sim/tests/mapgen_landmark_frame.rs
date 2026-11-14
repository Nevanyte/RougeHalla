//! Oracle of P-MAPGEN-LANDMARK-FRAME-1 (architecture review 2026-11-13, finding 1): the Landmarks phase hands each
//! zone's styler its signature landmark as a `LandmarkFrame` (`Placed::frames`, `style_zones::Input::landmarks`,
//! `BaseContext::landmark`), instead of each styler rebuilding it from map features. No generated map changes, option
//! on or off, and no draw moves: the guards of `mapgen_signature_blueprint.rs` (pins in `tests/support/signature_pins.rs`)
//! stay green unchanged. No legacy counterpart (DEV-020). Brief: `docs/backlog/packets/P-MAPGEN-LANDMARK-FRAME-1.md`.
//!
//! Every value a frame carries is checked against what today's code derives from the map, with this file's own copy
//! of today's readers (the mouth scan of `style_rime::signature_anchor`, the three-tile door and the yard of
//! `style_gallows::lanes::frame`, the feature boxes of `style_warren::pools::tree` and `style_scorch::signature_anchor`),
//! working from the finished map, so the copies stay valid once the stylers stop scanning.
//!
//! Definitions (tile units; x to the right, y down): row-major is sorted by (y, x); grid order is the drawing's
//! row-major order (gy, then gx), the order `Blueprint::tiles_of` returns; an orientation's `turn` is
//! `blueprint::Orientation::turn`.
use rh_sim::map::{TILE_FLOOR, TILE_WALL};
use rh_sim::mapdata::{
    FeatureJob, FeatureKind, GameMapData, MapFeature, TilePt, TileRect, Zone, ZoneAnchor,
};
use rh_sim::mapgen::coliseum::{CX, CY, W};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::blueprint::{Blueprint, Cell, Landing, Orientation};
use rh_sim::mapgen::landmarks::signature::frame::{LandmarkFrame, Mark};
use rh_sim::mapgen::landmarks::signature::spec::specs;
use rh_sim::mapgen::landmarks::signature::{
    reserved_zones, Placed, SignatureContext, DEFAULT_DEFINITION,
};
use rh_sim::mapgen::landmarks::stage::LandmarkStage;
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, coliseum, pipeline, style_runtime, style_zones};
use std::collections::BTreeSet;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------------------------------

/// One accepted Landmarks phase, option on: (stage, placed); `None` when the attempt is refused before or in it.
fn landmarks_phase(seed: i64, n: u64) -> Option<(LandmarkStage, Placed)> {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let frame = attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")?;
    let mut st = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")?;
    let placed = SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")?;
    Some((st, placed))
}

/// Seeds 1-32 attempts 0-1, every accepted Landmarks phase: (seed, attempt, stage, placed), once per test binary.
fn phases() -> &'static Vec<(i64, u64, LandmarkStage, Placed)> {
    static PHASES: OnceLock<Vec<(i64, u64, LandmarkStage, Placed)>> = OnceLock::new();
    PHASES.get_or_init(|| {
        let mut out = Vec::new();
        for seed in 1..=32 {
            for n in 0..2 {
                if let Some((st, placed)) = landmarks_phase(seed, n) {
                    out.push((seed, n, st, placed));
                }
            }
        }
        assert!(
            out.len() >= 32,
            "only {} accepted Landmarks phases",
            out.len()
        );
        out
    })
}

/// Seeds 1-32, option on, `certified_styled`: (seed, finished map, the accepted attempt's Landmarks phase), once per
/// test binary.
fn on_maps() -> &'static Vec<(i64, GameMapData, LandmarkStage, Placed)> {
    static MAPS: OnceLock<Vec<(i64, GameMapData, LandmarkStage, Placed)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        let options = pipeline::Options {
            signature: true,
            ..pipeline::Options::default()
        };
        (1..=32)
            .map(|seed| {
                let m = generator
                    .certified_styled(seed, options)
                    .expect("generator error")
                    .unwrap_or_else(|| panic!("seed {seed}: no map with the option on"));
                let (st, placed) = landmarks_phase(seed, m.attempt).unwrap_or_else(|| {
                    panic!("seed {seed}: the accepted attempt's Landmarks phase")
                });
                (seed, m, st, placed)
            })
            .collect()
    })
}

/// The feature kinds a zone's signature landmark writes (the anchor's kind first).
fn member_kinds(z: Zone) -> &'static [FeatureKind] {
    match z {
        Zone::Fire => &[
            FeatureKind::Volcano,
            FeatureKind::LavaStream,
            FeatureKind::LavaPool,
        ],
        Zone::Sentenced => &[FeatureKind::Church, FeatureKind::Graveyard],
        Zone::Plague => &[FeatureKind::BogTree],
        Zone::Frost => &[FeatureKind::Cave],
        Zone::Holy => &[],
    }
}

/// The indices (into `features`) of zone `z`'s signature features, in write order.
fn members(features: &[MapFeature], z: Zone) -> Vec<usize> {
    (0..features.len())
        .filter(|&k| features[k].zone == z && member_kinds(z).contains(&features[k].kind))
        .collect()
}

/// The first feature of kind `k` in zone `z`.
fn feature(features: &[MapFeature], k: FeatureKind, z: Zone) -> &MapFeature {
    let f = features.iter().find(|f| f.kind == k && f.zone == z);
    assert!(f.is_some(), "no {k:?} feature in {z:?}");
    f.unwrap()
}

fn row_major(mut v: Vec<TilePt>) -> Vec<TilePt> {
    v.sort_by_key(|p| (p.y, p.x));
    v
}

fn union(a: TileRect, b: TileRect) -> TileRect {
    let (x0, y0) = (a.x.min(b.x), a.y.min(b.y));
    let x1 = (a.x + a.w as i32).max(b.x + b.w as i32);
    let y1 = (a.y + a.h as i32).max(b.y + b.h as i32);
    TileRect {
        x: x0,
        y: y0,
        w: (x1 - x0) as u32,
        h: (y1 - y0) as u32,
    }
}

/// The generator's front rule: the DIR16 index toward the coliseum centre tile from (x, y), first on a tie.
fn front(x: i32, y: i32) -> u8 {
    let (dx, dy) = (i64::from(CX - x), i64::from(CY - y));
    let mut best = (0usize, i64::MIN);
    for (k, v) in DIR16.iter().enumerate() {
        let dot = dx * i64::from(v[0]) + dy * i64::from(v[1]);
        if dot > best.1 {
            best = (k, dot);
        }
    }
    best.0 as u8
}

/// The dominant axis of DIR16 `f` (x on a tie).
fn axis(f: u8) -> Cell {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

fn floor_at(tiles: &[u8], x: i32, y: i32) -> bool {
    x >= 0
        && y >= 0
        && (x as usize) < W
        && (y as usize) < W
        && tiles[y as usize * W + x as usize] == TILE_FLOOR
}

/// Today's mouth (`style_rime::signature_anchor`): the floor tiles on the edge of box `r` with floor just outside it,
/// row-major.
fn mouth_scan(tiles: &[u8], r: TileRect) -> Vec<TilePt> {
    let (x0, y0, x1, y1) = (r.x, r.y, r.x + r.w as i32 - 1, r.y + r.h as i32 - 1);
    let mut out = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            let out_dirs = [
                (x == x0, -1, 0),
                (x == x1, 1, 0),
                (y == y0, 0, -1),
                (y == y1, 0, 1),
            ];
            if floor_at(tiles, x, y)
                && out_dirs
                    .iter()
                    .any(|&(e, dx, dy)| e && floor_at(tiles, x + dx, y + dy))
            {
                out.push(TilePt { x, y });
            }
        }
    }
    out
}

/// Today's church door (`style_gallows::lanes::frame`): on the wall line of the `Church` feature's box on the side its
/// front faces, the tiles owned by no feature and floor, row-major. The lanes accept exactly three in one run.
fn door_scan(m: &GameMapData, church: &MapFeature) -> Vec<TilePt> {
    let r = church.bbox;
    let (x0, y0, x1, y1) = (r.x, r.y, r.x + r.w as i32 - 1, r.y + r.h as i32 - 1);
    let v = DIR16[usize::from(front(church.ax, church.ay))];
    let horizontal = v[0].abs() >= v[1].abs();
    let sign = if horizontal {
        v[0].signum()
    } else {
        v[1].signum()
    };
    let (line, lo, hi) = match (horizontal, sign > 0) {
        (true, true) => (x1, y0, y1),
        (true, false) => (x0, y0, y1),
        (false, true) => (y1, x0, x1),
        (false, false) => (y0, x0, x1),
    };
    (lo..=hi)
        .map(|t| {
            if horizontal {
                TilePt { x: line, y: t }
            } else {
                TilePt { x: t, y: line }
            }
        })
        .filter(|p| {
            let i = p.y as usize * W + p.x as usize;
            m.feature_grid[i] == 0 && m.tiles[i] == TILE_FLOOR
        })
        .collect()
}

/// Today's yard (`style_gallows::lanes::frame`): the `Church` box grown to every `Graveyard` box of the zone.
fn yard_today(m: &GameMapData) -> TileRect {
    let church = feature(&m.features, FeatureKind::Church, Zone::Sentenced).bbox;
    m.features
        .iter()
        .filter(|g| g.zone == Zone::Sentenced && g.kind == FeatureKind::Graveyard)
        .fold(church, |u, g| union(u, g.bbox))
}

fn frame_of(placed: &Placed, z: Zone) -> &LandmarkFrame {
    let f = placed.frames.iter().find(|f| f.anchor.zone == z);
    assert!(
        f.is_some(),
        "no {z:?} frame among {} frames",
        placed.frames.len()
    );
    f.unwrap()
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. One frame per reserved zone.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32 attempts 0-1, every accepted Landmarks phase: one frame per reserved zone, in `reserved_zones` order (the
/// placement order); every landmark carries its landing, whose box is the anchor's footprint (amended by
/// P-MAPGEN-SIG-SCALE-4: the volcano is drawn too; was "the drawn landmarks (Sentenced, Plague, Frost) ..., and the
/// volcano none"); each frame's features are the zone's signature features as written in this phase
/// (kind and box, write order); and `Placed::anchors()` reads the frames' anchors, in order.
#[test]
fn one_frame_per_reserved_zone_in_placement_order() {
    for (seed, n, st, placed) in phases() {
        let zones: Vec<Zone> = placed.frames.iter().map(|f| f.anchor.zone).collect();
        assert_eq!(
            zones,
            reserved_zones().to_vec(),
            "seed {seed} attempt {n}: the frames' zones"
        );
        let anchors: Vec<&ZoneAnchor> = placed.anchors().collect();
        let framed: Vec<&ZoneAnchor> = placed.frames.iter().map(|f| &f.anchor).collect();
        assert_eq!(
            anchors, framed,
            "seed {seed} attempt {n}: Placed::anchors()"
        );
        for f in &placed.frames {
            let z = f.anchor.zone;
            assert_eq!(f.zone(), z, "seed {seed} attempt {n}: LandmarkFrame::zone");
            match f.landing {
                None => panic!("seed {seed} attempt {n}: {z:?} has no landing"),
                Some(l) => assert_eq!(
                    l.footprint, f.anchor.footprint,
                    "seed {seed} attempt {n} {z:?}: the anchor's footprint is the landing's box"
                ),
            }
            let written: Vec<(FeatureKind, TileRect)> = members(&st.state.features, z)
                .into_iter()
                .map(|k| (st.state.features[k].kind, st.state.features[k].bbox))
                .collect();
            assert!(
                !written.is_empty(),
                "seed {seed} attempt {n}: {z:?} wrote no feature"
            );
            assert_eq!(
                f.features, written,
                "seed {seed} attempt {n} {z:?}: the frame's features"
            );
            assert_eq!(
                f.features[0].0, f.anchor.kind,
                "seed {seed} attempt {n} {z:?}: the anchor's feature is not written first"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The frame's anchor is the exported anchor.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, option on: each frame's anchor equals, field for field, the finished map's anchor for its zone (what
/// `finish` exports; measured equal on seeds 1-96 before this packet, so `finish` may copy it).
#[test]
fn each_frames_anchor_is_the_finished_maps_anchor() {
    for (seed, m, _, placed) in on_maps() {
        assert_eq!(
            placed.frames.len(),
            reserved_zones().len(),
            "seed {seed}: the frames"
        );
        for f in &placed.frames {
            let z = f.anchor.zone;
            let exported = m.anchors.iter().find(|a| a.zone == z);
            assert_eq!(
                exported,
                Some(&f.anchor),
                "seed {seed} {z:?}: the frame's anchor is not the exported anchor"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. The frame carries what today's readers find.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, option on, on the finished map: the cave's mark `D`, row-major, is the mouth today's scan finds on the
/// `Cave` box; the church's mark `D`, row-major, is the three door tiles today's lanes read on the `Church` box, and the
/// union of the church frame's feature boxes is today's yard; the bog tree's and the volcano's footprints are their
/// feature boxes. `LandmarkFrame::mark` returns the mark's tiles in the frame's (grid) order.
#[test]
fn the_frames_marks_and_boxes_are_what_todays_readers_find() {
    for (seed, m, _, placed) in on_maps() {
        for f in &placed.frames {
            let z = f.anchor.zone;
            for ch in *b"DE" {
                let want: Vec<TilePt> = f
                    .marks
                    .iter()
                    .filter(|k| k.ch == ch)
                    .map(|k| k.tile)
                    .collect();
                assert_eq!(
                    f.mark(ch).collect::<Vec<_>>(),
                    want,
                    "seed {seed} {z:?}: LandmarkFrame::mark('{}')",
                    ch as char
                );
            }
        }
        let cave = frame_of(placed, Zone::Frost);
        let mouth = mouth_scan(
            &m.tiles,
            feature(&m.features, FeatureKind::Cave, Zone::Frost).bbox,
        );
        assert_eq!(mouth.len(), 3, "seed {seed}: today's mouth scan");
        assert_eq!(
            row_major(cave.mark(b'D').collect()),
            mouth,
            "seed {seed}: the cave's D is not today's mouth"
        );
        let church = frame_of(placed, Zone::Sentenced);
        let door = door_scan(
            m,
            feature(&m.features, FeatureKind::Church, Zone::Sentenced),
        );
        assert_eq!(door.len(), 3, "seed {seed}: today's door scan");
        assert_eq!(
            row_major(church.mark(b'D').collect()),
            door,
            "seed {seed}: the church's D is not today's door"
        );
        let yard = church.features.iter().map(|&(_, r)| r).reduce(union);
        assert_eq!(
            yard,
            Some(yard_today(m)),
            "seed {seed}: the church frame's yard"
        );
        assert_eq!(
            Some(church.anchor.footprint),
            yard,
            "seed {seed}: the church's yard is its footprint"
        );
        for (z, k) in [
            (Zone::Plague, FeatureKind::BogTree),
            (Zone::Fire, FeatureKind::Volcano),
            (Zone::Frost, FeatureKind::Cave),
        ] {
            assert_eq!(
                frame_of(placed, z).anchor.footprint,
                feature(&m.features, k, z).bbox,
                "seed {seed} {z:?}: the footprint is not the {k:?} feature's box"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. The frame's cells are the landmark's tiles.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32, option on: each frame's cells, strictly ascending, are exactly the tiles the zone's signature features
/// own after the Landmarks phase, with that phase's tile and terrain; on the finished map every one still has its tile
/// and terrain and is owned by a feature of the zone of one of the frame's kinds (the general `intact`, as a test).
#[test]
fn the_frames_cells_are_the_landmarks_tiles_on_the_finished_map() {
    for (seed, m, st, placed) in on_maps() {
        assert!(!placed.frames.is_empty(), "seed {seed}: no frames");
        for f in &placed.frames {
            let z = f.anchor.zone;
            assert!(
                f.cells.windows(2).all(|w| w[0].0 < w[1].0),
                "seed {seed} {z:?}: the cells are not strictly ascending"
            );
            let ids: BTreeSet<usize> = members(&st.state.features, z)
                .into_iter()
                .map(|k| k + 1)
                .collect();
            let owned: Vec<u32> = (0..st.state.feature_owner.len())
                .filter(|&i| ids.contains(&usize::from(st.state.feature_owner[i])))
                .map(|i| i as u32)
                .collect();
            let cells: Vec<u32> = f.cells.iter().map(|c| c.0).collect();
            assert_eq!(
                cells, owned,
                "seed {seed} {z:?}: the cells are not the landmark's tiles"
            );
            let kinds: Vec<FeatureKind> = f.features.iter().map(|&(k, _)| k).collect();
            for &(i, tile, terrain) in &f.cells {
                let i = i as usize;
                assert_eq!(
                    (st.state.tiles[i], placed.terrain[i]),
                    (tile, terrain),
                    "seed {seed} {z:?}: cell {i} as the Landmarks phase wrote it"
                );
                assert_eq!(
                    (m.tiles[i], m.terrain[i]),
                    (tile, terrain),
                    "seed {seed} {z:?}: cell {i} on the finished map"
                );
                let owner = usize::from(m.feature_grid[i])
                    .checked_sub(1)
                    .and_then(|k| m.features.get(k));
                assert!(
                    owner.is_some_and(|g| g.zone == z && kinds.contains(&g.kind)),
                    "seed {seed} {z:?}: cell {i} is owned by {:?} on the finished map",
                    owner.map(|g| (g.kind, g.zone))
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Marks keep grid order; headings turn with the drawing.
// ---------------------------------------------------------------------------------------------------------------------

/// Seeds 1-32 attempts 0-1, every accepted Landmarks phase, each frame with a landing: its marks are every tile of
/// every mark of its drawing's legend, by character then grid order, each on the tile its landing sends it to; the
/// cave's `D` tiles come in ascending drawing column under every orientation; `heading((0, 1))` is the axis of the
/// anchor's front and `heading(d)` is the landing's turn of `d` (the volcano's six `O` outlets of the 22 x 22 drawing
/// included: amended by P-MAPGEN-SIG-SCALE-4, was "the volcano (no landing) has no marks and no heading"; a frame with
/// no landing has none).
/// At least three orientations of the cave are seen.
#[test]
fn marks_keep_grid_order_and_headings_turn_with_the_drawing() {
    let table = specs(&DEFAULT_DEFINITION);
    let mut cave_orientations = BTreeSet::new();
    for (seed, n, _, placed) in phases() {
        assert_eq!(
            placed.frames.len(),
            reserved_zones().len(),
            "seed {seed} attempt {n}: the frames"
        );
        for f in &placed.frames {
            let z = f.anchor.zone;
            let Some(l) = f.landing else {
                assert!(
                    f.marks.is_empty(),
                    "seed {seed} {z:?}: marks without a landing"
                );
                assert_eq!(
                    f.heading((0, 1)),
                    None,
                    "seed {seed} {z:?}: heading without a landing"
                );
                continue;
            };
            let s = table.iter().find(|s| s.zone == z).expect("table entry");
            let bp = Blueprint::parse(s.drawing.expect("a drawing"), &s.legend).expect("parses");
            let want: Vec<Mark> = bp
                .marks()
                .into_iter()
                .flat_map(|(ch, gs)| {
                    gs.into_iter().map(move |g| {
                        let (x, y) = l.tile(g);
                        Mark {
                            ch,
                            grid: g,
                            tile: TilePt { x, y },
                        }
                    })
                })
                .collect();
            assert_eq!(f.marks, want, "seed {seed} attempt {n} {z:?}: the marks");
            assert_eq!(
                f.heading((0, 1)),
                Some(axis(f.anchor.front)),
                "seed {seed} attempt {n} {z:?}: the drawing's front"
            );
            assert_eq!(
                f.anchor.front,
                front(f.anchor.centre.x, f.anchor.centre.y),
                "seed {seed} attempt {n} {z:?}: the anchor's front"
            );
            for d in [(1, 0), (-1, 0), (0, -1), (2, 3)] {
                assert_eq!(
                    f.heading(d),
                    Some(l.orientation.turn(d)),
                    "seed {seed} attempt {n} {z:?}: heading {d:?}"
                );
            }
            if z == Zone::Frost {
                cave_orientations.insert(l.orientation);
                let cols: Vec<i32> = f
                    .marks
                    .iter()
                    .filter(|k| k.ch == b'D')
                    .map(|k| k.grid.0)
                    .collect();
                assert!(
                    cols.len() == 3 && cols.windows(2).all(|w| w[0] < w[1]),
                    "seed {seed} attempt {n}: the mouth's drawing columns {cols:?}"
                );
            }
        }
    }
    assert!(
        cave_orientations.len() >= 3,
        "only {} cave orientations seen: {cave_orientations:?}",
        cave_orientations.len()
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. A styler reads its frame, not features.
// ---------------------------------------------------------------------------------------------------------------------

/// A made-up 160 x 160 Sentenced zone (floor inside a one-tile wall border) with a church: a 13 x 13 wall ring, x 34..=46,
/// y 74..=86, round the camp tile (40, 80), the coliseum due east (front +x), the door y 79..=81 on the wall line x = 46
/// (as `mapgen_style_refusal.rs`'s). The ring is owned by one feature of kind `owner`: `Church`, or `Landmark` (a kind no
/// signature reader looks for; its empty variant is no legacy template's) for "no feature of the landmark's kind", so
/// that both states own the same tiles and differ only in the kind.
const SIDE: usize = coliseum::W;
const BOX: (i32, i32, i32, i32) = (34, 74, 46, 86);
const CAMP: (i32, i32) = (40, 80);
const DOOR: [i32; 3] = [79, 80, 81];

fn ring() -> Vec<usize> {
    let (x0, y0, x1, y1) = BOX;
    let mut out = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            let edge = x == x0 || x == x1 || y == y0 || y == y1;
            if edge && !(x == x1 && DOOR.contains(&y)) {
                out.push(y as usize * SIDE + x as usize);
            }
        }
    }
    out
}

fn box_rect() -> TileRect {
    let (x0, y0, x1, y1) = BOX;
    TileRect {
        x: x0,
        y: y0,
        w: (x1 - x0 + 1) as u32,
        h: (y1 - y0 + 1) as u32,
    }
}

fn made_up_state(owner_kind: FeatureKind) -> style_runtime::State {
    let n = SIDE * SIDE;
    let mut tiles = vec![TILE_FLOOR; n];
    let last = SIDE as i32 - 1;
    for i in 0..SIDE as i32 {
        for (x, y) in [(i, 0), (i, last), (0, i), (last, i)] {
            tiles[y as usize * SIDE + x as usize] = TILE_WALL;
        }
    }
    let mut owner = vec![0_u16; n];
    for i in ring() {
        tiles[i] = TILE_WALL;
        owner[i] = 1;
    }
    let features = vec![MapFeature {
        kind: owner_kind,
        variant: String::new(),
        zone: Zone::Sentenced,
        jobs: vec![FeatureJob::Landmark],
        ax: CAMP.0,
        ay: CAMP.1,
        p: vec![],
        bbox: box_rect(),
        tiles: ring().len() as u32,
    }];
    style_runtime::State::new(SIDE, SIDE, tiles, vec![0; n], vec![], features, owner)
        .expect("the made-up church is a valid styler state")
}

/// The made-up church's frame: the box landed with its front row facing +x, unmirrored (grid (gx, gy) on
/// (34 + gy, 86 - gx)); `D` on the door (grid row 12), `E` on the camp (grid (6, 6)).
fn made_up_frame() -> LandmarkFrame {
    let (x0, _, x1, y1) = BOX;
    let mut marks: Vec<Mark> = DOOR
        .iter()
        .map(|&y| Mark {
            ch: b'D',
            grid: (y1 - y, 12),
            tile: TilePt { x: x1, y },
        })
        .collect();
    marks.sort_by_key(|k| (k.grid.1, k.grid.0));
    marks.push(Mark {
        ch: b'E',
        grid: (6, 6),
        tile: TilePt {
            x: CAMP.0,
            y: CAMP.1,
        },
    });
    LandmarkFrame {
        anchor: ZoneAnchor {
            zone: Zone::Sentenced,
            kind: FeatureKind::Church,
            centre: TilePt {
                x: CAMP.0,
                y: CAMP.1,
            },
            footprint: box_rect(),
            front: front(CAMP.0, CAMP.1),
            entrance: marks
                .iter()
                .filter(|k| k.ch == b'D')
                .map(|k| k.tile)
                .collect(),
        },
        landing: Some(Landing {
            orientation: Orientation {
                front: (1, 0),
                mirrored: false,
            },
            origin: (x0, y1),
            footprint: box_rect(),
        }),
        marks,
        features: vec![(FeatureKind::Church, box_rect())],
        cells: ring()
            .into_iter()
            .map(|i| (i as u32, TILE_WALL, 0))
            .collect(),
    }
}

/// What the Sentenced styler built on the made-up zone: the result, the tile layer and the fence rows it laid (legacy
/// rows and lanes are both `FenceRow`s with job `Lane`; they differ in where they run).
type Built = (Result<(), style_runtime::Error>, Vec<u8>, Vec<MapFeature>);

/// Runs the five-styler registry (only the Sentenced zone is painted) on the made-up zone whose ring is owned by a
/// feature of kind `owner_kind`, handed the church's frame when `frame`.
fn style_made_up(owner_kind: FeatureKind, frame: bool, decor: bool) -> Built {
    let fixed = coliseum::fixed_layout();
    let registry = style_zones::Registry::new(&fixed).expect("registry");
    let n = SIDE * SIDE;
    let zone = vec![1_u8; n];
    let protect = vec![0_u8; n];
    let mut state = made_up_state(owner_kind);
    let frames = [made_up_frame()];
    let result = registry
        .apply(
            &style_zones::Input {
                w: SIDE,
                h: SIDE,
                seed: 1,
                attempt: 0,
                order: &[Zone::Sentenced],
                zone: &zone,
                territory: None,
                camps: &[],
                protect: &protect,
                spawns: &[],
                centre_walk: None,
                decor,
                no_block: None,
                no_prop: None,
                caps: None,
                landmarks: frame.then_some(&frames[..]),
            },
            &mut state,
        )
        .map(|_| ());
    let rows: Vec<MapFeature> = state
        .features()
        .iter()
        .filter(|f| f.kind == FeatureKind::FenceRow)
        .cloned()
        .collect();
    (result, state.tiles().to_vec(), rows)
}

/// Signature mode: the church's frame with the `Church` feature (today's signature input; the frame is what the styler
/// reads after this packet, the feature what it reads before).
fn signature_built(decor: bool) -> Built {
    style_made_up(FeatureKind::Church, true, decor)
}

/// Legacy mode: no frame and no feature of the church's kind.
fn legacy_built(decor: bool) -> Built {
    style_made_up(FeatureKind::Landmark, false, decor)
}

/// Control (green on the stub, must stay green): the made-up zone tells the two modes apart. With the church's frame
/// and its feature the styler builds lanes; with neither it builds today's legacy rows; both succeed and lay rows, in
/// different places.
#[test]
fn the_made_up_church_tells_lanes_from_legacy_rows() {
    for decor in [false, true] {
        let (sig, legacy) = (signature_built(decor), legacy_built(decor));
        assert_eq!(sig.0, Ok(()), "decor {decor}: signature mode's answer");
        assert_eq!(legacy.0, Ok(()), "decor {decor}: legacy mode's answer");
        assert!(
            !sig.2.is_empty() && !legacy.2.is_empty(),
            "decor {decor}: fence rows laid: signature {}, legacy {}",
            sig.2.len(),
            legacy.2.len()
        );
        assert_ne!(
            (&sig.1, &sig.2),
            (&legacy.1, &legacy.2),
            "decor {decor}: lanes and legacy rows are the same here: the made-up zone proves nothing"
        );
    }
}

/// The styler's signature mode comes from its frame: given the church's frame and NO `Church` feature (the ring owned
/// by a `Landmark` feature instead), the Sentenced styler builds exactly the lanes it builds with the feature.
#[test]
fn a_frame_without_a_church_feature_is_built_round_in_signature_mode() {
    for decor in [false, true] {
        let got = style_made_up(FeatureKind::Landmark, true, decor);
        let want = signature_built(decor);
        assert_eq!(got.0, want.0, "decor {decor}: the styler's answer");
        assert!(
            got.1 == want.1 && got.2 == want.2,
            "decor {decor}: not the lanes ({} rows, {} wanted): the styler did not read its frame (signature mode \
             still comes from a feature)",
            got.2.len(),
            want.2.len()
        );
    }
}

/// The option-off leak the review named: given a `Church` feature but NO frame (the option off), the Sentenced styler
/// builds exactly today's legacy rows, not lanes.
#[test]
fn a_church_feature_without_a_frame_is_built_as_legacy() {
    for decor in [false, true] {
        let got = style_made_up(FeatureKind::Church, false, decor);
        let want = legacy_built(decor);
        assert_eq!(got.0, want.0, "decor {decor}: the styler's answer");
        assert!(
            got.1 == want.1 && got.2 == want.2,
            "decor {decor}: not the legacy rows ({} rows, {} wanted): a Church feature without a frame still \
             switches the styler to signature mode",
            got.2.len(),
            want.2.len()
        );
    }
}
