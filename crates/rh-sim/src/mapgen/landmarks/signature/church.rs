//! Sentenced: the church round the zone's far elite camp, and its graveyard. The church is a rectangular wall ring whose
//! interior holds the camp's whole halo; each wall line stands 4-7 tiles from the camp tile, or the side leans on the map
//! border (a camp near the edge or a corner), so the rectangle may be off-centre. Its 3-tile door is on the side facing
//! the coliseum (the dominant axis of the front), and beyond the door the graveyard's headstones (2x3 walls) stand in
//! rows mirrored about the door axis, every row starting the same gap past the door line.
//!
//! Choice: the first graveyard layout, then the door axis nearest the camp, that admits any rectangle; among those
//! rectangles one uniform draw (redrawn while a choice would split the zone's floor).
use super::{at, front, pick, Built, Piece, Site};
use crate::map::TILE_WALL;
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, Zone, ZoneAnchor};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{H, W};
use crate::mapgen::zones::camps::CampSite;
use crate::rng::Mulberry32;

use super::super::recipe_support::DIR16;

/// One church rectangle in the door frame: front (door line), back, left, right distances from the camp, and whether
/// the back, left and right lines are the map border.
#[derive(Clone, Copy)]
struct Rect {
    df: i32,
    back: (i32, bool),
    left: (i32, bool),
    right: (i32, bool),
}

pub(super) fn place(s: &Site<'_>, camps: &[CampSite], rng: &mut Mulberry32) -> Option<Built> {
    let d = &s.ctx.rules;
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
    let (tx, ty) = far?;
    let f = front(tx, ty);
    let v = DIR16[usize::from(f)];
    let u = if v[0].abs() >= v[1].abs() {
        (v[0].signum(), 0)
    } else {
        (0, v[1].signum())
    };
    let p = (u.1.abs(), u.0.abs());
    let tile = |a: i32, c: i32| (tx + a * u.0 + c * p.0, ty + a * u.1 + c * p.1);
    let to_border = |e: (i32, i32)| match e {
        (1, 0) => W as i32 - 1 - tx,
        (-1, 0) => tx,
        (0, 1) => H as i32 - 1 - ty,
        _ => ty,
    };
    let options = |border: i32| {
        let (lo, hi) = d.church_side;
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
    let ring_ok = |r: &Rect, ax: i32| -> bool {
        let (db, cl, cr) = (r.back.0, r.left.0, r.right.0);
        for a in -db..=r.df {
            for c in -cl..=cr {
                let (x, y) = tile(a, c);
                let edge = a == -db || a == r.df || c == -cl || c == cr;
                if !edge {
                    if !s.floor(x, y) || others.contains(&(x, y)) {
                        return false;
                    }
                    continue;
                }
                let border =
                    (a == -db && r.back.1) || (c == -cl && r.left.1) || (c == cr && r.right.1);
                let door = a == r.df && (c - ax).abs() <= 1;
                if border || (door && s.floor(x, y)) {
                    continue;
                }
                if door || !s.wall(x, y) {
                    return false;
                }
            }
        }
        true
    };
    let before = s.floor_pieces(&[]);
    for layout in d.graveyards {
        let stones: Vec<(i32, i32)> = layout
            .iter()
            .flat_map(|&((c0, c1), (a0, a1))| {
                (a0..=a1).flat_map(move |a| (c0..=c1).flat_map(move |c| [(a, c), (a, -c)]))
            })
            .collect();
        // Each stone stands on wall-legal ground of the zone, with open floor (any zone) all round it; the doorway
        // (two tiles out of the door) is open floor.
        let mut around: Vec<(i32, i32)> = Vec::new();
        for &(a, c) in &stones {
            for da in -1..=1 {
                for dc in -1..=1 {
                    let n = (a + da, c + dc);
                    if !stones.contains(&n) && !around.contains(&n) {
                        around.push(n);
                    }
                }
            }
        }
        around.extend((1..=2).flat_map(|a| (-1..=1).map(move |c| (a, c))));
        for k in 0..=2 * d.door_shift {
            let ax = if k % 2 == 0 { k / 2 } else { -(k + 1) / 2 };
            let mut legal = Vec::new();
            for df in d.church_side.0..=d.church_side.1 {
                let at_door = |a: i32, c: i32| tile(df + a, ax + c);
                let yard = stones.iter().all(|&(a, c)| {
                    let (x, y) = at_door(a, c);
                    s.wall(x, y)
                }) && around.iter().all(|&(a, c)| {
                    let (x, y) = at_door(a, c);
                    s.open(x, y)
                });
                if !yard {
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
                            if ax - 1 > -left.0 && ax + 1 < right.0 && ring_ok(&r, ax) {
                                legal.push(r);
                            }
                        }
                    }
                }
            }
            while !legal.is_empty() {
                let r = legal.remove(pick(rng, legal.len()));
                let (db, cl, cr) = (r.back.0, r.left.0, r.right.0);
                let mut ring = Vec::new();
                for a in -db..=r.df {
                    for c in -cl..=cr {
                        let edge = a == -db || a == r.df || c == -cl || c == cr;
                        let border = (a == -db && r.back.1)
                            || (c == -cl && r.left.1)
                            || (c == cr && r.right.1);
                        let door = a == r.df && (c - ax).abs() <= 1;
                        if edge && !border && !door {
                            let (x, y) = tile(a, c);
                            ring.push(at(x, y).unwrap());
                        }
                    }
                }
                let yard: Vec<usize> = stones
                    .iter()
                    .map(|&(a, c)| {
                        let (x, y) = tile(r.df + a, ax + c);
                        at(x, y).unwrap()
                    })
                    .collect();
                let walls: Vec<usize> = ring.iter().chain(&yard).copied().collect();
                if smallest_piece(&ring) < R.piece_min || s.floor_pieces(&walls) > before {
                    continue;
                }
                let door = (-1..=1)
                    .map(|c| {
                        let (x, y) = tile(r.df, ax + c);
                        TilePt { x, y }
                    })
                    .collect();
                return Some(Built {
                    anchor: ZoneAnchor {
                        zone: Zone::Sentenced,
                        kind: FeatureKind::Church,
                        centre: TilePt { x: tx, y: ty },
                        footprint: super::bounds(ring.iter().copied()),
                        front: f,
                        entrance: door,
                    },
                    pieces: vec![
                        Piece {
                            kind: FeatureKind::Church,
                            job: FeatureJob::Landmark,
                            anchor: (tx, ty),
                            cells: ring.iter().map(|&i| (i, TILE_WALL, 0)).collect(),
                        },
                        Piece {
                            kind: FeatureKind::Graveyard,
                            job: FeatureJob::Cover,
                            anchor: tile(r.df + d.grave_gap, ax),
                            cells: yard.iter().map(|&i| (i, TILE_WALL, 0)).collect(),
                        },
                    ],
                });
            }
        }
    }
    None
}

/// The size of the smallest 8-connected piece of `cells` (the shape gate's and the certifier's wall-piece rule).
fn smallest_piece(cells: &[usize]) -> usize {
    let mut seen = vec![false; cells.len()];
    let mut smallest = usize::MAX;
    for start in 0..cells.len() {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        let mut stack = vec![start];
        let mut n = 0;
        while let Some(k) = stack.pop() {
            n += 1;
            let (x, y) = ((cells[k] % W) as i32, (cells[k] / W) as i32);
            for (j, &c) in cells.iter().enumerate() {
                let (u, v) = ((c % W) as i32, (c / W) as i32);
                if !seen[j] && (u - x).abs() <= 1 && (v - y).abs() <= 1 {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        smallest = smallest.min(n);
    }
    smallest
}
