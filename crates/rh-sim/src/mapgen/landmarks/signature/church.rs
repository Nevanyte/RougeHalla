//! Sentenced: the church and its graveyard (no legacy counterpart, DEV-020).
//!
//! With a reserved site (P-MAPGEN-SIG-RESERVE-1, every option-on attempt) the church, its graveyard and its churchyard
//! ARE the owner-approved blueprint (P-MAPGEN-SIG-SCALE-2; ADR 0028 G9, decision 5): `Definition::church_grid`, a
//! 29 x 29 drawing parsed once per context (`Blueprint`), placed as the cave's (`cave::land`): its `E` on the site's
//! camp tile, its front (the door and the main gate) toward the coliseum, mirrored or not by one draw of the Sentenced
//! stream. `#` and `P` are the `Church` feature's walls (the building only); `G` (headstone walls) and `+` (LOW fence,
//! the styler's fence terrain) are one `Graveyard` feature; `.`, `D`, `E` and `*` stay unwritten floor. A site that
//! cannot hold the drawing refuses the attempt; the drawing is never served smaller.
//!
//! Without a reserved site (a `begin_attempt` prefix, which only tests feed the step) the older rule-drawn church stands
//! round the zone's far elite camp, with its graveyard. The church is a rectangular wall ring whose interior holds the
//! camp's whole halo; each wall line stands 4-7 tiles from the camp tile, or the side leans on the map border (a camp near the edge or a corner), so the rectangle may be off-centre. Its
//! 3-tile door is on the side facing the coliseum (the dominant axis of the front), and beyond the door the graveyard's
//! headstones (2x3 walls) stand in rows mirrored about the door axis, every row starting the same gap past the door
//! line.
//!
//! Choice: the first graveyard layout, then the door axis nearest the camp, that admits any rectangle; among those
//! rectangles one uniform draw (redrawn while a choice would split the zone's floor).
use super::cave::{grid, land};
use super::{at, axis, front, pick, Built, Piece, Site};
use crate::map::{TILE_LOW, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, TileRect, Zone, ZoneAnchor};
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

/// The church, or `None` when the zone cannot hold it (the attempt is refused, G5). `camp`: the camp tile of the zone's
/// reserved site (P-MAPGEN-SIG-RESERVE-1): the blueprint stands round it (`blueprint`). `None` without a reservation:
/// the rule-drawn church round the far elite camp.
pub(super) fn place(
    s: &Site<'_>,
    camps: &[CampSite],
    rng: &mut Mulberry32,
    camp: Option<usize>,
) -> Option<Built> {
    if let Some(t) = camp {
        return blueprint(s, rng, ((t % W) as i32, (t / W) as i32));
    }
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

/// The church's approved drawing (`Definition::church_grid`), parsed once per context
/// (`SignatureContext::from_definition`). Grid tile (gx, gy) is character gx of row gy (`cave::grid`); the front (the
/// door and the main gate, toward the coliseum) is +gy. `#` church wall and `P` pillar (the building), `G` headstone, `+` fence, `.` plain floor, `D` the
/// church door, `E` the elite camp's tile, `*` a lantern post mark (plain floor to the generator).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Blueprint {
    /// Side (tiles) of the square grid.
    side: i32,
    /// Row-major characters, `side * side`.
    cells: Vec<u8>,
    /// The `E` tile.
    camp: (i32, i32),
    /// The main gate: the run of open (not `+`) tiles of the front row through `E`'s column, in grid order.
    gate: Vec<(i32, i32)>,
}

impl Blueprint {
    /// The drawing in `text`, or `None` unless it is a square grid of the eight characters with one `E` whose column is
    /// open on the front row.
    pub(super) fn parse(text: &str) -> Option<Self> {
        let (side, cells) = grid(text)?;
        if !cells.iter().all(|c| b"#PG+.DE*".contains(c)) {
            return None;
        }
        let mut camps = (0..cells.len()).filter(|&k| cells[k] == b'E');
        let k = camps.next()?;
        if camps.next().is_some() {
            return None;
        }
        let camp = (k as i32 % side, k as i32 / side);
        let open =
            |gx: i32| (0..side).contains(&gx) && cells[((side - 1) * side + gx) as usize] != b'+';
        if !open(camp.0) {
            return None;
        }
        let (mut lo, mut hi) = (camp.0, camp.0);
        while open(lo - 1) {
            lo -= 1;
        }
        while open(hi + 1) {
            hi += 1;
        }
        Some(Self {
            side,
            gate: (lo..=hi).map(|gx| (gx, side - 1)).collect(),
            cells,
            camp,
        })
    }
}

/// The blueprint church round camp tile `t` (P-MAPGEN-SIG-SCALE-2), or `None` (the attempt is refused) when the site
/// cannot hold it: a `#`, `P`, `G` or `+` tile not `Site::wall`, any other tile not `Site::floor`, a tile of the
/// `doorway` beyond a main-gate tile not `Site::open` (the doorway lies in the site's apron), a wall piece under
/// `R.piece_min` (walls only: the fence is LOW), or the walls and fence split the zone's floor. The orientation as the
/// cave's: the front is `axis(front(t))`; the mirror is the church's one draw on the Sentenced stream, taken first.
/// Pieces: the `Church` (`#`, `P`: wall, terrain 0; anchor point `t`, where the lanes read the front), so its box is the
/// building and its door-side edge is open only at the `D` door; then one `Graveyard` (`G`: wall, terrain 0; `+`: LOW,
/// the fence terrain; anchor point the main gate's middle tile), whose box is the drawing's (the fence reaches every
/// edge). Anchor: centre `t`, footprint the drawing's box, entrance the main gate.
fn blueprint(s: &Site<'_>, rng: &mut Mulberry32, t: (i32, i32)) -> Option<Built> {
    let d = &s.ctx.rules;
    let mirrored = pick(rng, 2) == 1;
    let bp = s.ctx.church.as_ref()?;
    let f = front(t.0, t.1);
    let u = axis(f);
    let to = |g: (i32, i32)| land(bp.camp, t, u, mirrored, g);
    let (mut church, mut yard, mut walls, mut solid) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for gy in 0..bp.side {
        for gx in 0..bp.side {
            let (x, y) = to((gx, gy));
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            let ch = bp.cells[(gy * bp.side + gx) as usize];
            let block = matches!(ch, b'#' | b'P' | b'G' | b'+');
            if !(if block { s.wall(x, y) } else { s.floor(x, y) }) {
                return None;
            }
            let i = at(x, y)?;
            match ch {
                b'#' | b'P' => church.push((i, TILE_WALL, 0)),
                b'G' => yard.push((i, TILE_WALL, 0)),
                b'+' => yard.push((i, TILE_LOW, R.fence_kind)),
                _ => continue,
            }
            solid.push(i);
            if ch != b'+' {
                walls.push(i);
            }
        }
    }
    let gate: Vec<TilePt> = bp
        .gate
        .iter()
        .map(|&g| {
            let (x, y) = to(g);
            TilePt { x, y }
        })
        .collect();
    let doorway = gate
        .iter()
        .all(|p| (1..=d.doorway).all(|a| s.open(p.x + a * u.0, p.y + a * u.1)));
    if !doorway
        || smallest_piece(&walls) < R.piece_min
        || s.floor_pieces(&solid) > s.floor_pieces(&[])
    {
        return None;
    }
    church.sort_unstable_by_key(|c| c.0);
    yard.sort_unstable_by_key(|c| c.0);
    Some(Built {
        anchor: ZoneAnchor {
            zone: Zone::Sentenced,
            kind: FeatureKind::Church,
            centre: TilePt { x: t.0, y: t.1 },
            footprint: TileRect {
                x: x0,
                y: y0,
                w: (x1 - x0 + 1) as u32,
                h: (y1 - y0 + 1) as u32,
            },
            front: f,
            entrance: gate,
        },
        pieces: vec![
            Piece {
                kind: FeatureKind::Church,
                job: FeatureJob::Landmark,
                anchor: t,
                cells: church,
            },
            Piece {
                kind: FeatureKind::Graveyard,
                job: FeatureJob::Cover,
                anchor: to((bp.camp.0, bp.side - 1)),
                cells: yard,
            },
        ],
    })
}

/// The size of the smallest 8-connected piece of `cells` (the shape gate's and the certifier's wall-piece rule).
pub(super) fn smallest_piece(cells: &[usize]) -> usize {
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

#[cfg(test)]
mod tests {
    use super::super::DEFAULT_DEFINITION;
    use super::*;

    #[test]
    fn the_default_blueprint_parses_and_malformed_grids_do_not() {
        let bp =
            Blueprint::parse(DEFAULT_DEFINITION.church_grid).expect("the approved drawing parses");
        assert_eq!((bp.side, bp.camp), (29, (14, 7)));
        assert_eq!(bp.gate, (12..=16).map(|gx| (gx, 28)).collect::<Vec<_>>());
        let ok = ";legend\n+++++\n+.E.+\n+#D#+\n+G.G+\n++.++\n";
        assert_eq!(Blueprint::parse(ok).map(|b| b.gate), Some(vec![(2, 4)]));
        for bad in [
            "",
            "+++++\n+.E.+\n+#D#+\n++.++\n",        // not square
            "+++++\n+.E.+\n+#E#+\n+G.G+\n++.++\n", // two camps
            "+++++\n+...+\n+#D#+\n+G.G+\n++.++\n", // no camp
            "+++++\n+.E.+\n+#D#+\n+G.G+\n+.+.+\n", // the camp's column fenced on the front row
            "+++++\n+.E.+\n+#x#+\n+G.G+\n++.++\n", // unknown character
        ] {
            assert!(Blueprint::parse(bad).is_none(), "{bad:?}");
        }
    }
}
