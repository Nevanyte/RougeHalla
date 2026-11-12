//! Frost: the cave (P-MAPGEN-SIG-FROST-1; no legacy counterpart, DEV-020). A rectangular wall chamber on the Frost zone's
//! back edge round the zone's far elite camp (the elite camp farthest from the map centre), its interior holding the
//! camp's whole halo. As the church: each wall line stands `cave_side` tiles from the camp tile, or the side leans on the
//! map border, so the chamber may be off-centre. It is closed except for one mouth (`2 * mouth + 1` floor tiles) in the
//! front wall (the dominant axis of DIR16 toward the coliseum), its axis up to `door_shift` tiles off the camp's, with
//! `doorway` tiles of free Frost floor beyond it. The cave owns its walls and its ice: every interior tile with interior
//! floor on all eight sides (so never against a wall or the mouth row) outside every camp halo; at least `cave_ice_min`.
//!
//! Choice: the mouth axis nearest the camp that admits any chamber; among those chambers one uniform draw (redrawn while
//! a choice would split the zone's floor or leave a wall piece under `piece_min`).
use super::church::smallest_piece;
use super::{at, front, pick, Built, Piece, Site};
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, Zone, ZoneAnchor};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{CX, CY, H, W};
use crate::mapgen::spawns;
use crate::mapgen::zones::camps::CampSite;
use crate::rng::Mulberry32;

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

/// The cave round the Frost zone's far elite camp, or `None` when the zone has no legal site (the attempt is refused,
/// G5). The mouth's side: the dominant axis of the front, then the other axis toward the coliseum; first with a
/// forecourt (the `2 * forecourt + 1` square of Frost just beyond the mouth, room for the styler's lake), then without.
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
