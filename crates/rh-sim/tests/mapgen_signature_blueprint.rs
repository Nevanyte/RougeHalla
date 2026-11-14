//! Oracle of P-MAPGEN-SIG-BLUEPRINT-1 (architecture review 2026-11-13, finding 2): one blueprint type
//! (`signature::blueprint`), one per-landmark table (`signature::spec`), and the Frost cave, the Sentenced church and the
//! Plague bog tree placed through one generic stamp, with no generated map changed. No legacy counterpart (DEV-020).
//! Brief: `docs/backlog/packets/P-MAPGEN-SIG-BLUEPRINT-1.md`.
//!
//! Definitions (tile units; x to the right, y down):
//! * a drawing: the lines of a `docs/landmarks/blueprints/*.txt` file that neither start with `;` nor are empty; grid
//!   tile (gx, gy) is character gx of line gy; the front (toward the coliseum) is +gy.
//! * an orientation: a front direction u (a unit axis vector) and a mirror flag. Its `turn` sends grid direction (0, 1)
//!   to u and (1, 0) to r = (u.1, -u.0) unmirrored, -r mirrored (the cave's `land` before this packet). A landing sends
//!   grid tile g to `origin + turn(g)`.
//! * row-major: sorted by (y, x).
//!
//! The digest-neutrality guards and their pins live in `tests/support/signature_pins.rs` (one place to re-pin).
use rh_sim::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use rh_sim::mapdata::{FeatureJob, FeatureKind, GameMapData, TilePt, TileRect, Zone};
use rh_sim::mapgen::certify::rules::R;
use rh_sim::mapgen::coliseum::{CX, CY, W};
use rh_sim::mapgen::landmarks::recipe_support::DIR16;
use rh_sim::mapgen::landmarks::signature::blueprint::{
    Blueprint, Cell, EntranceRule, Glyph, Landing, Legality, Legend, Orientation, ParseError,
    Placement, Target, Write,
};
use rh_sim::mapgen::landmarks::signature::spec::{specs, FeatureAnchor, FeatureSpec, Spec};
use rh_sim::mapgen::landmarks::signature::{
    reserved_zones, Placed, SignatureContext, DEFAULT_DEFINITION,
};
use rh_sim::mapgen::landmarks::stage::LandmarkStage;
use rh_sim::mapgen::landmarks::{recipes, stage};
use rh_sim::mapgen::{attempt, coliseum, map_hash, pipeline};
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[path = "support/signature_pins.rs"]
mod pins;

// ---------------------------------------------------------------------------------------------------------------------
// The drawings and their legends (functions, not consts: `tests/content.rs` reads consts as tunables).
// ---------------------------------------------------------------------------------------------------------------------

fn cave_text() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/cave.txt")
}
fn church_text() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/church.txt")
}
fn bog_text() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/bog.txt")
}
fn volcano_text() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/volcano.txt")
}
fn hall_text() -> &'static str {
    include_str!("../../../docs/landmarks/blueprints/hall.txt")
}

fn glyph(
    ch: u8,
    write: Write,
    feature: Option<FeatureKind>,
    legality: Legality,
    mark: bool,
) -> Glyph {
    Glyph {
        ch,
        write,
        feature,
        legality,
        mark,
    }
}

/// Plain floor or a decoration mark the generator does not name: writes nothing, must be `Site::floor`.
fn plain(ch: u8) -> Glyph {
    glyph(ch, Write::Nothing, None, Legality::Floor, false)
}

/// A named mark on plain floor.
fn mark(ch: u8) -> Glyph {
    glyph(ch, Write::Nothing, None, Legality::Floor, true)
}

/// The Frost cave's legend as `cave::blueprint` reads `cave.txt` today: `#` and `R` the cave's walls (`Site::wall`),
/// `=` its ice floor; `.` plain; `E` (the camp) and `D` (the mouth) named marks.
fn cave_legend() -> Legend {
    let d = DEFAULT_DEFINITION;
    let wall = |ch| {
        glyph(
            ch,
            Write::Wall,
            Some(FeatureKind::Cave),
            Legality::Wall,
            false,
        )
    };
    Legend(vec![
        wall(b'#'),
        wall(b'R'),
        glyph(
            b'=',
            Write::Floor(d.ice),
            Some(FeatureKind::Cave),
            Legality::Floor,
            false,
        ),
        plain(b'.'),
        mark(b'E'),
        mark(b'D'),
    ])
}

/// The Sentenced church's legend as `church::blueprint` reads `church.txt` today: `#` and `P` the `Church` feature's
/// walls; `G` (wall) and `+` (LOW, the fence terrain) the `Graveyard`; all four `Site::wall`; `.` and `*` plain; `E` and
/// `D` (the church door) named marks.
fn church_legend() -> Legend {
    let church = |ch| {
        glyph(
            ch,
            Write::Wall,
            Some(FeatureKind::Church),
            Legality::Wall,
            false,
        )
    };
    Legend(vec![
        church(b'#'),
        church(b'P'),
        glyph(
            b'G',
            Write::Wall,
            Some(FeatureKind::Graveyard),
            Legality::Wall,
            false,
        ),
        glyph(
            b'+',
            Write::Low(R.fence_kind),
            Some(FeatureKind::Graveyard),
            Legality::Wall,
            false,
        ),
        plain(b'.'),
        plain(b'*'),
        mark(b'E'),
        mark(b'D'),
    ])
}

/// The Plague bog tree's legend as `bog_tree::blueprint` reads `bog.txt` today: `T` and `r` walls, `%` the marsh
/// (floor, bog terrain), all three `Site::wall` and `Site::ground`; `.` and `:` (the causeways) plain.
fn bog_legend() -> Legend {
    let d = DEFAULT_DEFINITION;
    let tree = |ch, write| {
        glyph(
            ch,
            write,
            Some(FeatureKind::BogTree),
            Legality::WallGround,
            false,
        )
    };
    Legend(vec![
        tree(b'T', Write::Wall),
        tree(b'r', Write::Wall),
        tree(b'%', Write::Floor(d.bog)),
        plain(b'.'),
        plain(b':'),
    ])
}

/// A legend that reads `volcano.txt` (this oracle's, to prove the reader and the landing on the drawing; the volcano's
/// real legend is P-MAPGEN-SIG-SCALE-4's): `#`, `X`, `H` walls, `~` lava (LOW), `O` the outlets (lava, a named mark).
fn volcano_legend() -> Legend {
    let d = DEFAULT_DEFINITION;
    let cone = |ch, write, mark| glyph(ch, write, Some(FeatureKind::Volcano), Legality::Wall, mark);
    Legend(vec![
        cone(b'#', Write::Wall, false),
        cone(b'X', Write::Wall, false),
        cone(b'H', Write::Wall, false),
        cone(b'~', Write::Low(d.lava), false),
        cone(b'O', Write::Low(d.lava), true),
        plain(b'.'),
    ])
}

/// A legend that reads `hall.txt` (this oracle's; the hall's real legend is P-MAPGEN-SIG-HOLY-1's): `#` walls, `.`,
/// `L` and `*` plain, `E` (the two camps) and `D` (the shrine door) named marks.
fn hall_legend() -> Legend {
    Legend(vec![
        glyph(
            b'#',
            Write::Wall,
            Some(FeatureKind::Hall),
            Legality::Wall,
            false,
        ),
        plain(b'.'),
        plain(b'L'),
        plain(b'*'),
        mark(b'E'),
        mark(b'D'),
    ])
}

/// The grid lines of `text` (header definition), independent of the reader under test.
fn rows(text: &str) -> Vec<&[u8]> {
    text.lines()
        .filter(|l| !l.starts_with(';') && !l.is_empty())
        .map(str::as_bytes)
        .collect()
}

/// The five drawings: (name, text, legend, size).
fn drawings() -> Vec<(&'static str, &'static str, Legend, Cell)> {
    vec![
        ("cave", cave_text(), cave_legend(), (29, 29)),
        ("church", church_text(), church_legend(), (29, 29)),
        ("bog tree", bog_text(), bog_legend(), (29, 29)),
        ("volcano", volcano_text(), volcano_legend(), (30, 30)),
        ("hall", hall_text(), hall_legend(), (37, 37)),
    ]
}

fn parsed(name: &str, text: &str, legend: &Legend) -> Blueprint {
    let bp = Blueprint::parse(text, legend);
    assert!(
        bp.is_ok(),
        "the {name} drawing does not parse with its legend: {bp:?}"
    );
    bp.unwrap()
}

fn run(x0: i32, x1: i32, y: i32) -> Vec<Cell> {
    (x0..=x1).map(|x| (x, y)).collect()
}

fn row_major(mut v: Vec<Cell>) -> Vec<Cell> {
    v.sort_by_key(|&(x, y)| (y, x));
    v
}

fn rect(x: i32, y: i32, w: i32, h: i32) -> TileRect {
    TileRect {
        x,
        y,
        w: w as u32,
        h: h as u32,
    }
}

/// `r` shrunk by `by` tiles on every side.
fn shrink(r: TileRect, by: i32) -> TileRect {
    rect(r.x + by, r.y + by, r.w as i32 - 2 * by, r.h as i32 - 2 * by)
}

fn tiles_of_rect(r: TileRect) -> BTreeSet<Cell> {
    let mut out = BTreeSet::new();
    for y in r.y..r.y + r.h as i32 {
        for x in r.x..r.x + r.w as i32 {
            out.insert((x, y));
        }
    }
    out
}

/// The rule and target each drawing is landed with in the geometry tests: the cave and the church pinned on `E` at a
/// camp tile; the tree, the volcano and the hall centred in an inner rect of a site whose side is the drawing's + 4 + 1
/// for the tree (a 34 site, inner 30) and + 4 for the volcano and the hall (inner 30 and 37).
fn geometry_target(name: &str) -> (Placement, Target) {
    let b = DEFAULT_DEFINITION.bands[0];
    match name {
        "cave" | "church" => (
            Placement::Pin(b'E'),
            Target {
                inner: shrink(rect(63, 23, 34, 34), b),
                camp: Some((80, 40)),
            },
        ),
        "bog tree" => (
            Placement::Centre,
            Target {
                inner: shrink(rect(40, 50, 34, 34), b),
                camp: None,
            },
        ),
        "volcano" => (
            Placement::Centre,
            Target {
                inner: shrink(rect(100, 20, 34, 34), b),
                camp: None,
            },
        ),
        _ => (
            Placement::Centre,
            Target {
                inner: shrink(rect(30, 90, 41, 41), b),
                camp: None,
            },
        ),
    }
}

/// The bog tree's placement before this packet (`bog_tree::Drawing::land`): the drawing's centre (14, 14) on site
/// centre tile t.
fn tree_today(t: Cell, o: Orientation, g: Cell) -> Cell {
    let s = if o.mirrored { -1 } else { 1 };
    let u = o.front;
    let r = (u.1 * s, -u.0 * s);
    let (a, b) = (g.1 - 14, g.0 - 14);
    (t.0 + a * u.0 + b * r.0, t.1 + a * u.1 + b * r.1)
}

// ---------------------------------------------------------------------------------------------------------------------
// The reader.
// ---------------------------------------------------------------------------------------------------------------------

/// All five approved drawings parse with their legends, at their sizes, character for character; a text without a grid
/// line, a ragged grid and a character outside the legend do not parse, each with its reason. Red on the stub: nothing
/// parses.
#[test]
fn every_drawing_parses_and_malformed_grids_do_not() {
    for (name, text, legend, size) in drawings() {
        let bp = parsed(name, text, &legend);
        assert_eq!(bp.size(), size, "the {name} drawing's size");
        let raw = rows(text);
        for (gy, row) in raw.iter().enumerate() {
            for (gx, &ch) in row.iter().enumerate() {
                assert_eq!(
                    bp.char_at((gx as i32, gy as i32)),
                    Some(ch),
                    "the {name} drawing at {:?}",
                    (gx, gy)
                );
            }
        }
        assert_eq!(bp.char_at((size.0, 0)), None, "{name}: off the grid");
        assert_eq!(bp.char_at((0, -1)), None, "{name}: off the grid");
    }
    let small = Legend(vec![plain(b'.'), mark(b'E'), plain(b'#')]);
    let ok = Blueprint::parse(";a legend line\n\n#.#\n.E.\n", &small);
    assert!(ok.is_ok(), "a 3 x 2 grid with a legend line: {ok:?}");
    assert_eq!(ok.unwrap().size(), (3, 2), "a 3 x 2 grid");
    assert_eq!(Blueprint::parse("", &small), Err(ParseError::Empty));
    assert_eq!(
        Blueprint::parse(";only a legend\n", &small),
        Err(ParseError::Empty)
    );
    assert_eq!(
        Blueprint::parse("#.#\n.E\n", &small),
        Err(ParseError::Ragged {
            row: 1,
            len: 2,
            expected: 3
        })
    );
    assert_eq!(
        Blueprint::parse("#.#\n.x.\n", &small),
        Err(ParseError::Unknown {
            ch: b'x',
            at: (1, 1)
        })
    );
}

/// The marks and the entrances the drawings hold (verified on the drawings by this oracle): the cave's `E` (14, 7) and
/// mouth `D` (13-15, 28); the church's `E` (14, 7), door `D` (13-15, 16) and main gate, the open run of the front row
/// through `E`'s column (12-16, 28); the tree's six causeway tiles on the box edge; the volcano's six outlet tiles on
/// row 29 (columns 7, 8, 14, 15, 21, 22); the hall's two `E` on column 18 (rows 15 and 27), its shrine door `D`
/// (17-19, 7) and its nave on the front row (15-21, 36). The front run counts only open tiles (a glyph writing nothing
/// or floor): a wall beside the run on the front row is not gate (review note on `church::Blueprint::parse`, which
/// counted every non-`+` tile). Red on the stub: nothing parses.
#[test]
fn the_marks_and_the_entrances_are_found() {
    let cave = parsed("cave", cave_text(), &cave_legend());
    assert_eq!(
        cave.marks(),
        vec![(b'D', run(13, 15, 28)), (b'E', vec![(14, 7)])],
        "the cave's marks"
    );
    assert_eq!(
        cave.entrance(EntranceRule::Mark(b'D')),
        run(13, 15, 28),
        "the cave's mouth"
    );
    let church = parsed("church", church_text(), &church_legend());
    assert_eq!(
        church.marks(),
        vec![(b'D', run(13, 15, 16)), (b'E', vec![(14, 7)])],
        "the church's marks"
    );
    assert_eq!(
        church.entrance(EntranceRule::FrontRun(b'E')),
        run(12, 16, 28),
        "the church's main gate"
    );
    let tree = parsed("bog tree", bog_text(), &bog_legend());
    assert_eq!(tree.marks(), vec![], "the tree has no named mark");
    assert_eq!(
        tree.entrance(EntranceRule::Edge(b':')),
        vec![(12, 0), (13, 0), (0, 11), (0, 12), (13, 28), (14, 28)],
        "the tree's causeway openings"
    );
    assert_eq!(tree.tiles_of(b':').len(), 62, "the tree's causeway tiles");
    let volcano = parsed("volcano", volcano_text(), &volcano_legend());
    let outlets: Vec<Cell> = [7, 8, 14, 15, 21, 22].iter().map(|&x| (x, 29)).collect();
    assert_eq!(
        volcano.marks(),
        vec![(b'O', outlets.clone())],
        "the volcano's outlets"
    );
    assert_eq!(
        volcano.entrance(EntranceRule::Mark(b'O')),
        outlets,
        "the volcano's entrance by mark"
    );
    let hall = parsed("hall", hall_text(), &hall_legend());
    assert_eq!(
        hall.marks(),
        vec![(b'D', run(17, 19, 7)), (b'E', vec![(18, 15), (18, 27)])],
        "the hall's marks"
    );
    assert_eq!(
        hall.entrance(EntranceRule::FrontRun(b'E')),
        run(15, 21, 36),
        "the hall's nave on the front row"
    );
    assert_eq!(hall.entrance(EntranceRule::None), vec![], "no entrance");
    // The front run stops at walls as at fences.
    let small = Legend(vec![
        plain(b'.'),
        mark(b'E'),
        glyph(
            b'+',
            Write::Low(R.fence_kind),
            Some(FeatureKind::Graveyard),
            Legality::Wall,
            false,
        ),
        glyph(
            b'#',
            Write::Wall,
            Some(FeatureKind::Church),
            Legality::Wall,
            false,
        ),
    ]);
    let gate = parsed("small", "+++++\n+.E.+\n+...+\n+#.#+\n", &small);
    assert_eq!(
        gate.entrance(EntranceRule::FrontRun(b'E')),
        vec![(2, 3)],
        "a wall beside the gate is not gate"
    );
    let fenced = parsed("small", "+++++\n+.E.+\n+...+\n+.+.+\n", &small);
    assert_eq!(
        fenced.entrance(EntranceRule::FrontRun(b'E')),
        vec![],
        "E's column fenced on the front row"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// The landing.
// ---------------------------------------------------------------------------------------------------------------------

/// Every orientation lands each of the five drawings one to one onto its box (the footprint, the drawing's size), the
/// orientation is the one asked for, `turn` is the cave's convention (front (0, 1) to u, side (1, 0) to r, negated
/// when mirrored), and one grid step in each of the four directions moves the landed tile by the turned step. The pin
/// rule lands `E` on the camp tile. Red on the stub: nothing parses.
#[test]
fn every_orientation_lands_each_drawing_one_to_one_onto_its_box() {
    for (name, text, legend, size) in drawings() {
        let bp = parsed(name, text, &legend);
        let (rule, target) = geometry_target(name);
        for o in Orientation::all() {
            let u = o.front;
            let s = if o.mirrored { -1 } else { 1 };
            assert_eq!(o.turn((0, 1)), u, "{o:?}: the front");
            assert_eq!(o.turn((1, 0)), (u.1 * s, -u.0 * s), "{o:?}: the side");
            let l = bp.land(rule, o, &target);
            assert!(l.is_some(), "{name} {o:?}: no landing in {target:?}");
            let l: Landing = l.unwrap();
            assert_eq!(l.orientation, o, "{name}: the landing's orientation");
            assert_eq!(
                (l.footprint.w as i32, l.footprint.h as i32),
                size,
                "{name} {o:?}: the box's size"
            );
            let mut landed = BTreeSet::new();
            for gy in 0..size.1 {
                for gx in 0..size.0 {
                    let p = l.tile((gx, gy));
                    landed.insert(p);
                    for d in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                        let q = l.tile((gx + d.0, gy + d.1));
                        let t = o.turn(d);
                        assert_eq!(
                            (q.0 - p.0, q.1 - p.1),
                            t,
                            "{name} {o:?}: a step {d:?} from {:?}",
                            (gx, gy)
                        );
                    }
                }
            }
            assert_eq!(
                landed,
                tiles_of_rect(l.footprint),
                "{name} {o:?}: the landed tiles are not the box one to one"
            );
            if let Placement::Pin(m) = rule {
                let e = bp.tiles_of(m);
                assert_eq!(e.len(), 1, "{name}: the pinned mark");
                assert_eq!(
                    Some(l.tile(e[0])),
                    target.camp,
                    "{name} {o:?}: E on the camp tile"
                );
            }
        }
    }
}

/// The volcano's outlets turn with the drawing: for each front, the left outlet (7-8, 29) mirrored lands where the
/// right one (21-22, 29) lands unmirrored and the other way round, the middle one (14-15, 29) on itself, and the left
/// heading (45 degrees left of the front: grid (-1, 1)) mirrored turns to where the right heading (grid (1, 1)) turns
/// unmirrored. Red on the stub: nothing parses.
#[test]
fn the_volcanos_outlets_and_headings_mirror_onto_each_other() {
    let bp = parsed("volcano", volcano_text(), &volcano_legend());
    let (rule, target) = geometry_target("volcano");
    let set =
        |l: &Landing, gs: &[Cell]| -> BTreeSet<Cell> { gs.iter().map(|&g| l.tile(g)).collect() };
    let (left, middle, right) = (run(7, 8, 29), run(14, 15, 29), run(21, 22, 29));
    for u in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
        let plain_o = Orientation {
            front: u,
            mirrored: false,
        };
        let mirror_o = Orientation {
            front: u,
            mirrored: true,
        };
        let lu = bp.land(rule, plain_o, &target);
        let lm = bp.land(rule, mirror_o, &target);
        assert!(lu.is_some() && lm.is_some(), "front {u:?}: no landing");
        let (lu, lm) = (lu.unwrap(), lm.unwrap());
        assert_eq!(lu.footprint, lm.footprint, "front {u:?}: the box moved");
        assert_eq!(set(&lm, &left), set(&lu, &right), "front {u:?}: left");
        assert_eq!(set(&lm, &right), set(&lu, &left), "front {u:?}: right");
        assert_eq!(set(&lm, &middle), set(&lu, &middle), "front {u:?}: middle");
        assert_eq!(
            mirror_o.turn((-1, 1)),
            plain_o.turn((1, 1)),
            "front {u:?}: the headings"
        );
        assert_eq!(plain_o.turn((0, 1)), u, "front {u:?}: straight ahead");
    }
}

/// The box rule: the bog tree (29) centred in a 34 site's inner rect (30) lands every tile where today's centre pin
/// puts it (the drawing's centre on the site's centre tile, the odd spare tile before the box) in all eight
/// orientations, at two sites; the volcano's box is its 30 inner rect and the hall's its 37 inner rect exactly. Red on
/// the stub: nothing parses.
#[test]
fn the_box_rule_matches_todays_tree_and_fills_the_volcano_and_hall_rects() {
    let b = DEFAULT_DEFINITION.bands[0];
    let tree = parsed("bog tree", bog_text(), &bog_legend());
    for site in [rect(40, 50, 34, 34), rect(117, 3, 34, 34)] {
        let target = Target {
            inner: shrink(site, b),
            camp: None,
        };
        let t = (site.x + 17, site.y + 17);
        for o in Orientation::all() {
            let l = tree.land(Placement::Centre, o, &target);
            assert!(l.is_some(), "tree {o:?}: no landing in {site:?}");
            let l = l.unwrap();
            assert_eq!(
                l.footprint,
                rect(t.0 - 14, t.1 - 14, 29, 29),
                "tree {o:?}: the box"
            );
            for gy in 0..29 {
                for gx in 0..29 {
                    assert_eq!(
                        l.tile((gx, gy)),
                        tree_today(t, o, (gx, gy)),
                        "tree {o:?} in {site:?}: grid {:?}",
                        (gx, gy)
                    );
                }
            }
        }
    }
    for name in ["volcano", "hall"] {
        let (text, legend) = if name == "volcano" {
            (volcano_text(), volcano_legend())
        } else {
            (hall_text(), hall_legend())
        };
        let bp = parsed(name, text, &legend);
        let (rule, target) = geometry_target(name);
        for o in Orientation::all() {
            let l = bp.land(rule, o, &target);
            assert!(l.is_some(), "{name} {o:?}: no landing");
            assert_eq!(
                l.unwrap().footprint,
                target.inner,
                "{name} {o:?}: the box is not the inner rect"
            );
        }
    }
}

/// A landing that cannot be made is `None`: a box wider or taller than the inner rect (the tree in 28 x 28 and in
/// 30 x 28, the hall in 30 x 30), a pin on a mark that is not exactly one tile (the hall's two `E`; a mark the drawing
/// lacks), a pin without a camp tile. The same pins with one `E` and a camp tile land. Red on the stub: nothing parses.
#[test]
fn a_landing_refuses_an_oversized_box_or_a_pin_that_is_not_one_tile() {
    let tree = parsed("bog tree", bog_text(), &bog_legend());
    let hall = parsed("hall", hall_text(), &hall_legend());
    let cave = parsed("cave", cave_text(), &cave_legend());
    let camp = Some((80, 40));
    for o in Orientation::all() {
        for inner in [
            rect(40, 40, 28, 28),
            rect(40, 40, 30, 28),
            rect(40, 40, 28, 30),
        ] {
            assert_eq!(
                tree.land(Placement::Centre, o, &Target { inner, camp: None }),
                None,
                "tree {o:?} in {inner:?}"
            );
        }
        let small = Target {
            inner: rect(40, 40, 30, 30),
            camp: None,
        };
        assert_eq!(hall.land(Placement::Centre, o, &small), None, "hall {o:?}");
        let pinned = Target {
            inner: rect(63, 23, 30, 30),
            camp,
        };
        assert_eq!(
            hall.land(Placement::Pin(b'E'), o, &pinned),
            None,
            "hall {o:?}: two E"
        );
        assert_eq!(
            cave.land(Placement::Pin(b'Q'), o, &pinned),
            None,
            "cave {o:?}: no such mark"
        );
        assert_eq!(
            cave.land(
                Placement::Pin(b'E'),
                o,
                &Target {
                    inner: pinned.inner,
                    camp: None
                }
            ),
            None,
            "cave {o:?}: no camp tile"
        );
        assert!(
            cave.land(Placement::Pin(b'E'), o, &pinned).is_some(),
            "cave {o:?}: one E and a camp tile"
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------------------------------------

fn sorted_glyphs(l: &Legend) -> Vec<Glyph> {
    let mut v = l.0.clone();
    v.sort_by_key(|g| g.ch);
    v
}

fn spec_of(table: &[Spec], zone: Zone) -> &Spec {
    let s = table.iter().find(|s| s.zone == zone);
    assert!(s.is_some(), "no {zone:?} entry in specs()");
    s.unwrap()
}

/// `specs(&DEFAULT_DEFINITION)` has one entry per landmark in `reserved_zones` order (Fire, Sentenced, Plague, Frost).
/// The Fire volcano has no drawing yet (P-MAPGEN-SIG-SCALE-4). The cave, the church and the tree carry their
/// `Definition` grid, a legend whose characters are exactly the drawing's and whose entries are today's reading of it
/// (`cave_legend`, `church_legend`, `bog_legend`), their features in today's write order (the church before its
/// graveyard; the graveyard's anchor point the main gate's middle tile), today's placement (the cave and the church
/// pinned on `E`, the tree centred in the inner rect) and entrance (the mouth `D`; the front run through `E`; the `:`
/// on the edge), and the doorway check where today's code makes it (the cave and the church). Red on the stub: the
/// table is empty.
#[test]
fn the_table_has_one_entry_per_landmark_and_its_legends_match_the_drawings() {
    let d = DEFAULT_DEFINITION;
    let table = specs(&d);
    assert_eq!(
        table.iter().map(|s| s.zone).collect::<Vec<_>>(),
        reserved_zones().to_vec(),
        "one entry per landmark, in reserved_zones order"
    );
    let fire = spec_of(&table, Zone::Fire);
    assert_eq!(
        (fire.kind, fire.drawing),
        (FeatureKind::Volcano, None),
        "the volcano"
    );
    let landmark = |kind| FeatureSpec {
        kind,
        job: FeatureJob::Landmark,
        anchor: FeatureAnchor::Centre,
    };
    let want = [
        (
            Zone::Frost,
            FeatureKind::Cave,
            d.cave_grid,
            cave_legend(),
            vec![landmark(FeatureKind::Cave)],
            Placement::Pin(b'E'),
            EntranceRule::Mark(b'D'),
            true,
        ),
        (
            Zone::Sentenced,
            FeatureKind::Church,
            d.church_grid,
            church_legend(),
            vec![
                landmark(FeatureKind::Church),
                FeatureSpec {
                    kind: FeatureKind::Graveyard,
                    job: FeatureJob::Cover,
                    anchor: FeatureAnchor::EntranceMiddle,
                },
            ],
            Placement::Pin(b'E'),
            EntranceRule::FrontRun(b'E'),
            true,
        ),
        (
            Zone::Plague,
            FeatureKind::BogTree,
            d.bog_grid,
            bog_legend(),
            vec![landmark(FeatureKind::BogTree)],
            Placement::Centre,
            EntranceRule::Edge(b':'),
            false,
        ),
    ];
    for (zone, kind, grid, legend, features, placement, entrance, doorway) in want {
        let s = spec_of(&table, zone);
        assert_eq!(s.kind, kind, "{zone:?}: the anchor kind");
        assert_eq!(s.drawing, Some(grid), "{zone:?}: the drawing");
        let chars: BTreeSet<u8> = rows(grid).concat().into_iter().collect();
        let keys: BTreeSet<u8> = s.legend.0.iter().map(|g| g.ch).collect();
        assert_eq!(
            keys, chars,
            "{zone:?}: the legend's characters vs the drawing's"
        );
        assert_eq!(
            s.legend.0.len(),
            keys.len(),
            "{zone:?}: a character twice in the legend"
        );
        assert_eq!(
            sorted_glyphs(&s.legend),
            sorted_glyphs(&legend),
            "{zone:?}: the legend"
        );
        assert_eq!(s.features, features, "{zone:?}: the features");
        assert_eq!(s.placement, placement, "{zone:?}: the placement");
        assert_eq!(s.entrance, entrance, "{zone:?}: the entrance");
        assert_eq!(s.doorway, doorway, "{zone:?}: the doorway check");
        let bp = Blueprint::parse(grid, &s.legend);
        assert!(bp.is_ok(), "{zone:?}: the table's drawing does not parse");
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated maps.
// ---------------------------------------------------------------------------------------------------------------------

fn on_options() -> pipeline::Options {
    pipeline::Options {
        signature: true,
        ..pipeline::Options::default()
    }
}

/// Seeds 1-32, option on, `certified_styled`: (seed, map), generated once per test binary.
fn on_maps() -> &'static Vec<(i64, GameMapData)> {
    static MAPS: OnceLock<Vec<(i64, GameMapData)>> = OnceLock::new();
    MAPS.get_or_init(|| {
        let fixed = coliseum::fixed_layout();
        let generator = pipeline::Pipeline::new(&fixed);
        (1..=32)
            .map(|seed| {
                let m = generator
                    .certified_styled(seed, on_options())
                    .expect("generator error")
                    .unwrap_or_else(|| panic!("seed {seed}: no map with the option on"));
                (seed, m)
            })
            .collect()
    })
}

/// The site a zone reserved in the prefix: (inner rect, camp tile).
fn site(frame: &attempt::AttemptFrame, zone: Zone) -> (TileRect, Option<Cell>) {
    let r = frame.state.reserved.iter().find(|r| r.zone == zone);
    assert!(r.is_some(), "no {zone:?} site");
    let r = r.unwrap();
    (
        shrink(r.rect, DEFAULT_DEFINITION.bands[0]),
        r.camp.map(|t| ((t % W) as i32, (t / W) as i32)),
    )
}

/// The generator's front rule: the DIR16 index toward the coliseum centre tile from t.
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

/// The dominant axis of DIR16 `f` (x on a tie).
fn axis(f: u8) -> Cell {
    let v = DIR16[usize::from(f)];
    if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    }
}

/// One accepted Landmarks phase, option on: (frame, stage, placed); `None` when the attempt is refused before or in it.
fn landmarks_phase(seed: i64, n: u64) -> Option<(attempt::AttemptFrame, LandmarkStage, Placed)> {
    let fixed = coliseum::fixed_layout();
    let context = attempt::AttemptContext::new(&fixed);
    let frame = attempt::begin_attempt_signature(&context, seed, n, true).expect("prefix input")?;
    let mut st = stage::StageContext::new(&fixed)
        .apply(&frame, &recipes::Recipes::default())
        .expect("stage input")?;
    let placed = SignatureContext::new(&fixed)
        .apply(&frame, &mut st)
        .expect("signature input")?;
    Some((frame, st, placed))
}

fn pt(c: Cell) -> TilePt {
    TilePt { x: c.0, y: c.1 }
}

/// `Placed.landed` re-derives the Landmarks phase's output, seeds 1-16, attempts 0-1, every accepted phase: one entry
/// per drawing landmark (Sentenced, Plague, Frost, in placement order); each landing is its table rule's landing in the
/// zone's site under its own orientation, whose front is the dominant axis of the anchor's `front` and is read at the
/// pinned camp tile (cave, church) or the site's centre tile (tree); the anchor's centre is that tile, its footprint the
/// landing's box, its entrance the table's entrance rule landed (as a set: P-MAPGEN-SIG-BLUEPRINT-2 sorts it); the landed
/// marks are the drawing's marks
/// landed, row-major, and the cave's and the church's `E` is the camp tile; the zone's features are the table's, in its
/// order, with their jobs and anchor points; and every tile a glyph writes carries the glyph's tile and terrain and is
/// owned by the glyph's feature, which owns nothing else. Red on the stub: `landed` is empty.
#[test]
fn placed_landed_rederives_every_written_cell() {
    let d = DEFAULT_DEFINITION;
    let table = specs(&d);
    let mut accepted = 0;
    for seed in 1..=16 {
        for n in 0..2 {
            let Some((frame, st, placed)) = landmarks_phase(seed, n) else {
                continue;
            };
            accepted += 1;
            let zones: Vec<Zone> = placed.landed.iter().map(|l| l.zone).collect();
            assert_eq!(
                zones,
                vec![Zone::Sentenced, Zone::Plague, Zone::Frost],
                "seed {seed} attempt {n}: the landed landmarks"
            );
            for landed in &placed.landed {
                let z = landed.zone;
                let s = spec_of(&table, z);
                let bp = parsed(&format!("{z:?}"), s.drawing.unwrap_or(""), &s.legend);
                let l = landed.landing;
                let (inner, camp) = site(&frame, z);
                let t = match s.placement {
                    Placement::Pin(_) => camp.expect("a pinned landmark's site has a camp"),
                    Placement::Centre => {
                        (inner.x + inner.w as i32 / 2, inner.y + inner.h as i32 / 2)
                    }
                };
                let a = placed.anchors.iter().find(|a| a.zone == z);
                assert!(a.is_some(), "seed {seed} attempt {n}: no {z:?} anchor");
                let a = a.unwrap();
                assert_eq!(a.front, front(t), "seed {seed} {z:?}: the anchor's front");
                assert_eq!(
                    l.orientation.front,
                    axis(a.front),
                    "seed {seed} {z:?}: the front row does not face the coliseum"
                );
                assert_eq!(
                    bp.land(s.placement, l.orientation, &Target { inner, camp }),
                    Some(l),
                    "seed {seed} {z:?}: the landing is not the table rule's"
                );
                assert_eq!(a.centre, pt(t), "seed {seed} {z:?}: the anchor's centre");
                assert_eq!(
                    a.footprint, l.footprint,
                    "seed {seed} {z:?}: the footprint is not the landing's box"
                );
                // The entrance rule's tiles, landed, as a set (amended by P-MAPGEN-SIG-BLUEPRINT-2, which sorts the
                // anchor's entrance row-major on the map; its order is pinned by `mapgen_signature_table.rs`
                // `every_anchors_entrance_is_row_major`).
                let mut entrance: Vec<TilePt> = bp
                    .entrance(s.entrance)
                    .into_iter()
                    .map(|g| pt(l.tile(g)))
                    .collect();
                entrance.sort_by_key(|p| (p.y, p.x));
                let mut got = a.entrance.clone();
                got.sort_by_key(|p| (p.y, p.x));
                assert_eq!(got, entrance, "seed {seed} {z:?}: the entrance");
                let marks: Vec<(u8, Vec<TilePt>)> = bp
                    .marks()
                    .into_iter()
                    .map(|(ch, gs)| {
                        (
                            ch,
                            row_major(gs.into_iter().map(|g| l.tile(g)).collect())
                                .into_iter()
                                .map(pt)
                                .collect(),
                        )
                    })
                    .collect();
                assert_eq!(landed.marks, marks, "seed {seed} {z:?}: the landed marks");
                if let Placement::Pin(m) = s.placement {
                    let pinned = landed.marks.iter().find(|(ch, _)| *ch == m);
                    assert_eq!(
                        pinned.map(|(_, ts)| ts.clone()),
                        Some(vec![pt(t)]),
                        "seed {seed} {z:?}: E is not on the camp tile"
                    );
                }
                // The zone's features: the table's, in its order.
                let kinds: Vec<FeatureKind> = s.features.iter().map(|f| f.kind).collect();
                let ids: Vec<usize> = (0..st.state.features.len())
                    .filter(|&k| {
                        st.state.features[k].zone == z && kinds.contains(&st.state.features[k].kind)
                    })
                    .collect();
                assert_eq!(
                    ids.iter()
                        .map(|&k| st.state.features[k].kind)
                        .collect::<Vec<_>>(),
                    kinds,
                    "seed {seed} {z:?}: the features"
                );
                for (fs, &k) in s.features.iter().zip(&ids) {
                    let f = &st.state.features[k];
                    assert_eq!(f.jobs, vec![fs.job], "seed {seed} {z:?}: {:?} job", f.kind);
                    let want = match fs.anchor {
                        FeatureAnchor::Centre => t,
                        FeatureAnchor::EntranceMiddle => {
                            let e = bp.entrance(s.entrance);
                            l.tile(e[e.len() / 2])
                        }
                    };
                    assert_eq!(
                        (f.ax, f.ay),
                        want,
                        "seed {seed} {z:?}: {:?} anchor point",
                        f.kind
                    );
                }
                let (w, h) = bp.size();
                let mut owned = vec![0u32; ids.len()];
                for gy in 0..h {
                    for gx in 0..w {
                        let ch = bp.char_at((gx, gy)).unwrap();
                        let gl = *s.legend.glyph(ch).unwrap();
                        let p = l.tile((gx, gy));
                        let i = (p.1 * st.state.w as i32 + p.0) as usize;
                        let want = match gl.write {
                            Write::Nothing => continue,
                            Write::Wall => (TILE_WALL, 0),
                            Write::Low(k) => (TILE_LOW, k),
                            Write::Floor(k) => (TILE_FLOOR, k),
                        };
                        let fk = kinds
                            .iter()
                            .position(|&k| Some(k) == gl.feature)
                            .expect("a writing glyph names a table feature");
                        owned[fk] += 1;
                        assert_eq!(
                            (st.state.tiles[i], placed.terrain[i]),
                            want,
                            "seed {seed} {z:?}: grid {:?} '{}' at {p:?}",
                            (gx, gy),
                            ch as char
                        );
                        assert_eq!(
                            usize::from(st.state.feature_owner[i]),
                            ids[fk] + 1,
                            "seed {seed} {z:?}: grid {:?} '{}' at {p:?} owner",
                            (gx, gy),
                            ch as char
                        );
                    }
                }
                for (fk, &k) in ids.iter().enumerate() {
                    let all = st
                        .state
                        .feature_owner
                        .iter()
                        .filter(|&&o| usize::from(o) == k + 1)
                        .count() as u32;
                    assert_eq!(
                        (all, st.state.features[k].tiles),
                        (owned[fk], owned[fk]),
                        "seed {seed} {z:?}: {:?} owns tiles the drawing does not write",
                        kinds[fk]
                    );
                }
            }
        }
    }
    assert!(accepted >= 16, "only {accepted} accepted Landmarks phases");
}

// ---------------------------------------------------------------------------------------------------------------------
// Guards: green on the stub, must stay green (digest neutrality). Pins: `tests/support/signature_pins.rs`.
// ---------------------------------------------------------------------------------------------------------------------

/// Guard. Seeds 1-32, option on: the same accepted attempt, the same `map_hash`, and the same map JSON once each
/// anchor's entrance is sorted row-major. Every option-on map is byte-identical but for the entrance order.
#[test]
fn option_on_maps_are_unchanged() {
    let pinned = pins::pinned_on_maps();
    for ((seed, m), (ps, attempt, hash, json)) in on_maps().iter().zip(pinned) {
        assert_eq!(*seed, ps, "pin order");
        assert_eq!(
            (m.attempt, map_hash::map_hash(m), pins::map_digest(m)),
            (attempt, hash.to_string(), json),
            "seed {seed}: (attempt, map_hash, sorted-entrance JSON digest)"
        );
    }
}

/// Guard. Seeds 1-16, attempts 0-1, option on: the Landmarks phase leaves the same result (`pins::landmarks_digest`:
/// anchors with sorted entrances, the stage's layers and masks, the step's terrain), refusals included. Same draws in
/// the same order, the same tiles, owners and features.
#[test]
fn the_landmarks_phase_is_unchanged() {
    let mut got = Vec::new();
    for seed in 1..=16 {
        for n in 0..2 {
            got.push((seed, n, pins::landmarks_digest(seed, n)));
        }
    }
    assert_eq!(got, pins::pinned_landmarks().to_vec());
}

/// The pins' values on the current tree (not a gate check; run with `--ignored --nocapture` to re-pin
/// `tests/support/signature_pins.rs`).
#[test]
#[ignore]
fn print_signature_pins() {
    println!("pinned_on_maps:");
    for (seed, m) in on_maps() {
        println!(
            "        ({seed}, {}, \"{}\", {:#018x}),",
            m.attempt,
            map_hash::map_hash(m),
            pins::map_digest(m)
        );
    }
    println!("pinned_landmarks:");
    for seed in 1..=16 {
        for n in 0..2 {
            println!(
                "        ({seed}, {n}, {:#018x}),",
                pins::landmarks_digest(seed, n)
            );
        }
    }
}
