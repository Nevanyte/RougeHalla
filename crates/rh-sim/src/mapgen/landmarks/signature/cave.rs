//! Frost: the cave (P-MAPGEN-SIG-FROST-1; no legacy counterpart, DEV-020).
//!
//! With a reserved site (P-MAPGEN-SIG-RESERVE-1, every option-on attempt) the cave IS the owner-approved blueprint
//! (P-MAPGEN-SIG-SCALE-1; ADR 0028 G9, decision 11): `Definition::cave_grid`, a 29 x 29 drawing, its `E` on the site's
//! camp tile, its mouth toward the coliseum (the dominant axis of DIR16 from the camp tile toward it), mirrored or not
//! by one draw of the Frost stream. `#` and `R` are the cave's walls, `=` its ice; `.`, `E` and the mouth `D` stay
//! unwritten floor. A site that cannot hold the drawing refuses the attempt; the drawing is never served smaller. Since
//! P-MAPGEN-SIG-BLUEPRINT-1 the generic stamp (`super::stamp`) draws it from its table entry (`super::spec`); this file
//! keeps the rule-drawn chamber and the end-of-attempt lake rule.
//!
//! Without a reserved site (a `begin_attempt` prefix, which only tests feed the step: the option-on Prefix always
//! reserves) the older rule-drawn chamber stands: a rectangular wall chamber on the Frost zone's back edge round the
//! zone's far elite camp (the elite camp farthest from the map centre), its interior holding the camp's whole halo. As
//! the church: each wall line stands `cave_side` tiles from the camp tile, or the side leans on the map border, so the
//! chamber may be off-centre. It is closed except for one mouth (`2 * mouth + 1` floor tiles) in the wall toward the
//! coliseum (the dominant axis of DIR16 toward it, else the other axis), nearer the coliseum than the camp, its axis up
//! to `door_shift` tiles off the camp's, with `doorway` tiles of free Frost floor beyond it. The cave owns its walls and
//! its ice: every interior tile with interior floor on all eight sides (so never against a wall or the mouth row)
//! outside every camp halo and the open map corners; at least `cave_ice_min`. Choice: the mouth axis nearest the camp
//! that admits any chamber; among those chambers one uniform draw (redrawn while a choice would split the zone's floor
//! or leave a wall piece under `piece_min`).
use super::church::smallest_piece;
use super::{at, front, pick, Built, Definition, Piece, Site};
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, GameMapData, TilePt, Zone, ZoneAnchor};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{CX, CY, H, W};
use crate::mapgen::spawns;
use crate::mapgen::zones::camps::CampSite;
use crate::rng::Mulberry32;
use std::collections::VecDeque;

use super::super::recipe_support::DIR16;

/// One chamber in the mouth frame: front (mouth line), back, left, right distances from the camp, and whether the back,
/// left and right lines are the map border.
#[derive(Clone, Copy)]
struct Rect {
    df: i32,
    back: (i32, bool),
    left: (i32, bool),
    right: (i32, bool),
}

/// The rule-drawn cave (a zone without a reserved site), or `None` when the zone cannot hold it (the attempt is
/// refused, G5): the chamber round the far elite camp, its mouth's side the dominant axis of the front, then the other
/// axis toward the coliseum; first with a forecourt (the `2 * forecourt + 1` square of Frost just beyond the mouth,
/// room for the styler's lake), then without.
pub(super) fn place(s: &Site<'_>, camps: &[CampSite], rng: &mut Mulberry32) -> Option<Built> {
    let mut far = None;
    let mut best = -1i64;
    for c in camps.iter().filter(|c| c.zone == s.slot && c.elite) {
        let (x, y) = ((c.site % W) as i64, (c.site / W) as i64);
        let r = (2 * x + 1 - W as i64).pow(2) + (2 * y + 1 - H as i64).pow(2);
        if r >= best {
            best = r;
            far = Some(((x as i32), (y as i32)));
        }
    }
    let camp = far?;
    let f = front(camp.0, camp.1);
    let v = DIR16[usize::from(f)];
    let (major, minor) = ((v[0].signum(), 0), (0, v[1].signum()));
    let mut axes = if v[0].abs() >= v[1].abs() {
        vec![major, minor]
    } else {
        vec![minor, major]
    };
    axes.retain(|u| *u != (0, 0));
    let before = s.floor_pieces(&[]);
    for forecourt in [true, false] {
        for &u in &axes {
            if let Some(built) = side(s, camps, rng, camp, f, u, forecourt, before) {
                return Some(built);
            }
        }
    }
    None
}

/// The end-of-attempt lake rule on a finished map (P-MAPGEN-SIG-FROST-2; owner decision 4: the mouth faces the lake).
/// Unowned Frost ice is floor of the Frost region carrying the cave's ice terrain that the cave does not own (the
/// styler's meres and anything else); its largest 4-connected body (first in row order on a size tie) must lie within
/// `lake_reach + lake_slack` steps over floor (any zone, owned or not) of the cave's mouth (the Frost anchor's
/// `entrance`, step 0). A map without unowned Frost ice, or without a cave or Frost anchor, passes (the styler may place
/// no lake; the cave's own presence is the Landmarks phase's rule). A pure read: no draw.
pub(super) fn lake_at_mouth(map: &GameMapData, d: &Definition) -> bool {
    let Some(cave) = map
        .features
        .iter()
        .position(|f| f.kind == FeatureKind::Cave)
    else {
        return true;
    };
    let Some(anchor) = map.anchors.iter().find(|a| a.zone == Zone::Frost) else {
        return true;
    };
    let n = map.tiles.len();
    let frost = Zone::Frost.code();
    let ice = |i: usize| {
        map.region_grid[i] == frost
            && map.tiles[i] == TILE_FLOOR
            && map.terrain[i] == d.ice
            && usize::from(map.feature_grid[i]) != cave + 1
    };
    let step = |i: usize| {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .filter_map(move |(dx, dy)| at(x + dx, y + dy))
    };
    // Bodies labelled in row order of their first tile; the largest wins, the first on a tie.
    let mut body = vec![0u32; n];
    let (mut largest, mut size, mut label) = (0u32, 0usize, 0u32);
    let mut stack = Vec::new();
    for s in 0..n {
        if body[s] != 0 || !ice(s) {
            continue;
        }
        label += 1;
        body[s] = label;
        stack.push(s);
        let mut count = 0;
        while let Some(i) = stack.pop() {
            count += 1;
            for j in step(i) {
                if body[j] == 0 && ice(j) {
                    body[j] = label;
                    stack.push(j);
                }
            }
        }
        if count > size {
            (largest, size) = (label, count);
        }
    }
    if size == 0 {
        return true;
    }
    let reach = d.lake_reach + d.lake_slack;
    let mut dist = vec![usize::MAX; n];
    let mut queue = VecDeque::new();
    for p in &anchor.entrance {
        if let Some(i) = at(p.x, p.y).filter(|&i| map.tiles[i] == TILE_FLOOR && dist[i] != 0) {
            dist[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        if body[i] == largest {
            return true;
        }
        if dist[i] >= reach {
            continue;
        }
        for j in step(i) {
            if dist[j] == usize::MAX && map.tiles[j] == TILE_FLOOR {
                dist[j] = dist[i] + 1;
                queue.push_back(j);
            }
        }
    }
    false
}

/// The cave with its mouth on side `u` (a unit axis vector) of the camp tile, or `None`.
#[allow(clippy::too_many_arguments)]
fn side(
    s: &Site<'_>,
    camps: &[CampSite],
    rng: &mut Mulberry32,
    (tx, ty): (i32, i32),
    f: u8,
    u: (i32, i32),
    forecourt: bool,
    before: usize,
) -> Option<Built> {
    let d = &s.ctx.rules;
    let p = (u.1.abs(), u.0.abs());
    let tile = |a: i32, c: i32| (tx + a * u.0 + c * p.0, ty + a * u.1 + c * p.1);
    let to_border = |e: (i32, i32)| match e {
        (1, 0) => W as i32 - 1 - tx,
        (-1, 0) => tx,
        (0, 1) => H as i32 - 1 - ty,
        _ => ty,
    };
    let options = |border: i32| {
        let (lo, hi) = d.cave_side;
        let mut out: Vec<(i32, bool)> = (lo..=hi)
            .filter(|&k| border >= k + d.border_gap)
            .map(|k| (k, false))
            .collect();
        if (lo..=d.border_max).contains(&border) {
            out.push((border, true));
        }
        out
    };
    let backs = options(to_border((-u.0, -u.1)));
    let lefts = options(to_border((-p.0, -p.1)));
    let rights = options(to_border(p));
    let others: Vec<(i32, i32)> = camps
        .iter()
        .filter(|c| (c.site % W, c.site / W) != (tx as usize, ty as usize))
        .map(|c| ((c.site % W) as i32, (c.site / W) as i32))
        .collect();
    let m = d.mouth;
    let is_border = |r: &Rect, a: i32, c: i32| {
        (a == -r.back.0 && r.back.1)
            || (c == -r.left.0 && r.left.1)
            || (c == r.right.0 && r.right.1)
    };
    let is_edge =
        |r: &Rect, a: i32, c: i32| a == -r.back.0 || a == r.df || c == -r.left.0 || c == r.right.0;
    let ring_ok = |r: &Rect, ax: i32| -> bool {
        for a in -r.back.0..=r.df {
            for c in -r.left.0..=r.right.0 {
                let (x, y) = tile(a, c);
                if !is_edge(r, a, c) {
                    if !s.floor(x, y) || others.contains(&(x, y)) {
                        return false;
                    }
                    continue;
                }
                let mouth = a == r.df && (c - ax).abs() <= m;
                if is_border(r, a, c) || (mouth && s.floor(x, y)) {
                    continue;
                }
                if mouth || !s.wall(x, y) {
                    return false;
                }
            }
        }
        true
    };
    // The cave's ice: interior tiles whose eight neighbours are interior floor, off every camp halo and off the map
    // corners the spawn rules keep open (the styler contract keeps both free of terrain).
    let co = spawns::DEFAULT_DEFINITION.corner_open as i32;
    let corner = |x: i32, y: i32| x.min(W as i32 - 1 - x) <= co && y.min(H as i32 - 1 - y) <= co;
    let ice = |r: &Rect| -> Vec<usize> {
        let mut out = Vec::new();
        for a in -r.back.0 + 2..=r.df - 2 {
            for c in -r.left.0 + 2..=r.right.0 - 2 {
                let (x, y) = tile(a, c);
                let i = at(x, y).unwrap();
                if s.halo[i] == 0 && !corner(x, y) {
                    out.push(i);
                }
            }
        }
        out.sort_unstable();
        out
    };
    let col = (2 * CX + 1, 2 * CY + 1);
    let d2 = |x2: i32, y2: i32| i64::from(x2 - col.0).pow(2) + i64::from(y2 - col.1).pow(2);
    for k in 0..=2 * d.door_shift {
        let ax = if k % 2 == 0 { k / 2 } else { -(k + 1) / 2 };
        let mut legal = Vec::new();
        for df in d.cave_side.0..=d.cave_side.1 {
            // The mouth (doubled tile points) is nearer the coliseum than the camp, and free Frost floor lies beyond it.
            let (mx, my) = tile(df, ax);
            if d2(2 * mx + 1, 2 * my + 1) >= d2(2 * tx + 1, 2 * ty + 1) {
                continue;
            }
            let doorway = (1..=d.doorway).all(|a| {
                (-m..=m).all(|c| {
                    let (x, y) = tile(df + a, ax + c);
                    s.floor(x, y)
                })
            });
            let fc = d.forecourt;
            let room = !forecourt
                || (df + 1..=df + 1 + 2 * fc).all(|a| {
                    (ax - fc..=ax + fc).all(|c| {
                        let (x, y) = tile(a, c);
                        at(x, y).is_some_and(|i| s.zone[i] == s.slot)
                    })
                });
            if !doorway || !room {
                continue;
            }
            for &back in &backs {
                for &left in &lefts {
                    for &right in &rights {
                        let r = Rect {
                            df,
                            back,
                            left,
                            right,
                        };
                        if ax - m > -left.0
                            && ax + m < right.0
                            && ring_ok(&r, ax)
                            && ice(&r).len() >= d.cave_ice_min
                        {
                            legal.push(r);
                        }
                    }
                }
            }
        }
        while !legal.is_empty() {
            let r = legal.remove(pick(rng, legal.len()));
            let mut ring = Vec::new();
            for a in -r.back.0..=r.df {
                for c in -r.left.0..=r.right.0 {
                    let mouth = a == r.df && (c - ax).abs() <= m;
                    if is_edge(&r, a, c) && !is_border(&r, a, c) && !mouth {
                        let (x, y) = tile(a, c);
                        ring.push(at(x, y).unwrap());
                    }
                }
            }
            if smallest_piece(&ring) < R.piece_min || s.floor_pieces(&ring) > before {
                continue;
            }
            let floor = ice(&r);
            let mouth: Vec<TilePt> = (-m..=m)
                .map(|c| {
                    let (x, y) = tile(r.df, ax + c);
                    TilePt { x, y }
                })
                .collect();
            let mut cells: Vec<(usize, u8, u8)> = ring.iter().map(|&i| (i, TILE_WALL, 0)).collect();
            cells.extend(floor.iter().map(|&i| (i, TILE_FLOOR, d.ice)));
            return Some(Built {
                anchor: ZoneAnchor {
                    zone: Zone::Frost,
                    kind: FeatureKind::Cave,
                    centre: TilePt { x: tx, y: ty },
                    footprint: super::bounds(ring.iter().copied()),
                    front: f,
                    entrance: mouth,
                },
                pieces: vec![Piece {
                    kind: FeatureKind::Cave,
                    job: FeatureJob::Landmark,
                    anchor: (tx, ty),
                    cells,
                }],
            });
        }
    }
    None
}

/// `lake_at_mouth` on small synthetic maps: the branches no generated seed reaches (P-MAPGEN-SIG-FROST-2 review).
/// Every map is the full grid, all Frost wall but for the floor each test opens; feature 1 is the cave, the Frost
/// anchor's mouth is one tile.
#[cfg(test)]
mod tests {
    use super::super::DEFAULT_DEFINITION;
    use super::*;
    use crate::mapdata::{ColiseumDef, MapFeature, TileRect, WorldPt};

    fn reach() -> i32 {
        (DEFAULT_DEFINITION.lake_reach + DEFAULT_DEFINITION.lake_slack) as i32
    }

    fn map(mouth: (i32, i32)) -> GameMapData {
        let n = W * H;
        let rect = TileRect {
            x: 0,
            y: 0,
            w: 1,
            h: 1,
        };
        let pt = TilePt {
            x: mouth.0,
            y: mouth.1,
        };
        GameMapData {
            tiles: vec![TILE_WALL; n],
            seed: 0,
            w: W as u32,
            h: H as u32,
            terrain: vec![0; n],
            props: Vec::new(),
            region_grid: vec![Zone::Frost.code(); n],
            attempt: 0,
            territory_grid: vec![0; n],
            coliseum: ColiseumDef {
                rect,
                centre: WorldPt { x: 0.0, y: 0.0 },
                gates: Vec::new(),
                inner_spawns: Vec::new(),
            },
            regions: Vec::new(),
            camps: Vec::new(),
            spawn_pool: Vec::new(),
            buildings: Vec::new(),
            spawns: Vec::new(),
            crate_spots: Vec::new(),
            ground_spots: Vec::new(),
            features: vec![MapFeature {
                kind: FeatureKind::Cave,
                variant: String::new(),
                zone: Zone::Frost,
                jobs: vec![FeatureJob::Landmark],
                ax: mouth.0,
                ay: mouth.1,
                p: Vec::new(),
                bbox: rect,
                tiles: 0,
            }],
            feature_grid: vec![0; n],
            anchors: vec![ZoneAnchor {
                zone: Zone::Frost,
                kind: FeatureKind::Cave,
                centre: pt,
                footprint: rect,
                front: 0,
                entrance: vec![pt],
            }],
        }
    }

    /// Floor along row `y` from `x0` to `x1` inclusive.
    fn corridor(m: &mut GameMapData, y: i32, x0: i32, x1: i32) {
        for x in x0..=x1 {
            m.tiles[at(x, y).unwrap()] = TILE_FLOOR;
        }
    }

    /// Ice floor at (x, y), owned by the cave (feature 1) when `cave`.
    fn ice(m: &mut GameMapData, x: i32, y: i32, cave: bool) {
        let i = at(x, y).unwrap();
        m.tiles[i] = TILE_FLOOR;
        m.terrain[i] = DEFAULT_DEFINITION.ice;
        m.feature_grid[i] = u8::from(cave);
    }

    fn ok(m: &GameMapData) -> bool {
        lake_at_mouth(m, &DEFAULT_DEFINITION)
    }

    #[test]
    fn no_unowned_ice_passes_and_the_caves_own_ice_is_never_the_lake() {
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        assert!(ok(&m), "no ice at all");
        for x in 11..=16 {
            ice(&mut m, x, 20, true);
        }
        assert!(ok(&m), "only the cave's own ice, beside the mouth");
        // A lone unowned tile with no floor path is now the lake, however large the cave's ice.
        ice(&mut m, 100, 100, false);
        assert!(!ok(&m), "the cave's ice stood in for a far lake");
    }

    #[test]
    fn on_equal_sizes_the_first_body_in_row_order_is_the_lake() {
        // Near body on the mouth's row, an unreachable body of the same size on a later row: the near one is first.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        ice(&mut m, 12, 20, false);
        ice(&mut m, 13, 20, false);
        ice(&mut m, 50, 30, false);
        ice(&mut m, 51, 30, false);
        assert!(ok(&m), "the near body comes first in row order");
        // The same, with the unreachable body on an earlier row: it is the lake, and the map fails.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 20);
        ice(&mut m, 12, 20, false);
        ice(&mut m, 13, 20, false);
        ice(&mut m, 50, 10, false);
        ice(&mut m, 51, 10, false);
        assert!(!ok(&m), "the far body comes first in row order");
    }

    #[test]
    fn the_lake_passes_at_exactly_the_reach_and_fails_one_step_beyond() {
        let r = reach();
        assert_eq!(r, 10, "lake_reach + lake_slack");
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 10 + r + 5);
        ice(&mut m, 10 + r, 20, false);
        assert!(ok(&m), "{r} floor steps");
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 10 + r + 5);
        ice(&mut m, 10 + r + 1, 20, false);
        assert!(!ok(&m), "{} floor steps", r + 1);
        // Walked steps, not straight-line distance: two rows below the mouth across a wall, 3 + 2 + 3 = 8 steps round.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 13);
        corridor(&mut m, 21, 13, 13);
        corridor(&mut m, 22, 10, 13);
        ice(&mut m, 10, 22, false);
        assert!(ok(&m), "8 walked steps round the wall");
        // The same detour stretched past the reach (5 + 2 + 5 = 12 steps) fails though the lake is 2 tiles away.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 15);
        corridor(&mut m, 21, 15, 15);
        corridor(&mut m, 22, 10, 15);
        ice(&mut m, 10, 22, false);
        assert!(!ok(&m), "12 walked steps round the wall");
    }

    #[test]
    fn a_mouth_with_no_floor_path_to_the_lake_fails() {
        let mut m = map((10, 20));
        corridor(&mut m, 20, 10, 14);
        ice(&mut m, 16, 20, false);
        assert!(!ok(&m), "a wall between the mouth and the lake");
        // A mouth that is not floor starts no walk.
        let mut m = map((10, 20));
        corridor(&mut m, 20, 11, 14);
        ice(&mut m, 12, 20, false);
        assert!(!ok(&m), "the mouth tile is wall");
    }
}
