//! Plague: the giant bog tree (no legacy counterpart, DEV-020).
//!
//! With a reserved site (P-MAPGEN-SIG-RESERVE-1, every option-on attempt) the tree IS the owner-approved blueprint
//! (P-MAPGEN-SIG-SCALE-3; ADR 0028 G9, decision 4): `Definition::bog_grid`, a 29 x 29 drawing parsed once per context
//! (`Drawing`), its centre tile (the trunk's centre) on the site's centre tile, its front row toward the coliseum (the
//! dominant axis of DIR16 from the centre tile toward it), mirrored or not by one draw of the Plague stream. `T` (trunk)
//! and `r` (roots) are the tree's walls, `%` its marsh (floor, terrain bog); `.` and the causeways `:` stay unwritten
//! floor. A site that cannot hold the drawing refuses the attempt; the drawing is never served smaller.
//!
//! Without a reserved site (a `begin_attempt` prefix, which only tests feed the step: the option-on Prefix always
//! reserves) the older rule-drawn tree stands: a solid trunk (wall) on dry ground in the outer third of the zone's
//! radial extent from the map centre, ringed by two bands of bog (floor, terrain bog), one feature; the site is a
//! uniform draw over every legal centre tile.
use super::church::smallest_piece;
use super::{at, axis, front, pick, Built, Piece, Site};
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, TileRect, Zone, ZoneAnchor};
use crate::mapgen::certify::rules::R;
use crate::mapgen::coliseum::{H, W};
use crate::rng::Mulberry32;

/// The tree's approved drawing (`Definition::bog_grid`), parsed once per context (`SignatureContext::from_definition`).
/// Grid tile (gx, gy) is character gx of the gy-th line that neither starts with `;` nor is empty; the front (toward
/// the coliseum) is +gy. `T` trunk and `r` root (walls), `%` marsh (bog floor), `:` causeway and `.` dry floor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Drawing {
    /// Side (tiles) of the square grid, odd: the centre tile is (side / 2, side / 2).
    side: i32,
    /// Row-major characters, `side * side`.
    cells: Vec<u8>,
}

impl Drawing {
    /// The drawing in `text`, or `None` unless it is a square grid of odd side of the five characters with a trunk
    /// tile at its centre.
    pub(super) fn parse(text: &str) -> Option<Self> {
        let rows: Vec<&[u8]> = text
            .lines()
            .filter(|l| !l.starts_with(';') && !l.is_empty())
            .map(str::as_bytes)
            .collect();
        let side = i32::try_from(rows.len()).ok().filter(|&n| n % 2 == 1)?;
        if rows.iter().any(|r| r.len() != rows.len()) {
            return None;
        }
        let cells: Vec<u8> = rows.concat();
        let c = side / 2;
        (cells.iter().all(|ch| b"Tr%:.".contains(ch)) && cells[(c * side + c) as usize] == b'T')
            .then_some(Self { side, cells })
    }

    /// Where grid tile (gx, gy) lands with the centre on tile `t`, the front toward unit axis `u`, mirrored or not:
    /// unmirrored the drawing's +gx goes to r = (u.1, -u.0), mirrored to -r (the cave's rule).
    fn land(&self, t: (i32, i32), u: (i32, i32), mirrored: bool, g: (i32, i32)) -> (i32, i32) {
        let s = if mirrored { -1 } else { 1 };
        let r = (u.1 * s, -u.0 * s);
        let c = self.side / 2;
        let (a, b) = (g.1 - c, g.0 - c);
        (t.0 + a * u.0 + b * r.0, t.1 + a * u.1 + b * r.1)
    }
}

/// The tree, or `None` when the zone cannot hold it (the attempt is refused, G5). `centre`: the centre tile of the
/// zone's reserved site (P-MAPGEN-SIG-RESERVE-1): the blueprint stands on it (`blueprint`). `None` without a
/// reservation: the rule-drawn tree.
pub(super) fn place(
    s: &Site<'_>,
    rng: &mut Mulberry32,
    centre: Option<(i32, i32)>,
) -> Option<Built> {
    if let Some(t) = centre {
        return blueprint(s, rng, t);
    }
    let d = &s.ctx.rules;
    let from_centre = |x: i32, y: i32| {
        let (dx, dy) = (
            f64::from(2 * x + 1 - W as i32) / 2.0,
            f64::from(2 * y + 1 - H as i32) / 2.0,
        );
        crate::math::sqrt(dx * dx + dy * dy)
    };
    let (mut lo, mut hi) = (f64::MAX, 0.0f64);
    for i in (0..W * H).filter(|&i| s.zone[i] == s.slot) {
        let r = from_centre((i % W) as i32, (i / W) as i32);
        lo = lo.min(r);
        hi = hi.max(r);
    }
    let need = lo + (hi - lo) * 2.0 / 3.0 + d.outer_slack;
    let reach = d.bog_d2[1].1;
    let span = (1..).find(|r: &i32| r * r > reach).unwrap();
    let (mut trunk, mut dry, mut bog) = (Vec::new(), Vec::new(), Vec::new());
    for dy in -span..=span {
        for dx in -span..=span {
            let d2 = dx * dx + dy * dy;
            if d2 <= d.trunk_d2 {
                trunk.push((dx, dy));
            } else if d2 <= d.dry_d2 {
                dry.push((dx, dy));
            } else if d.bog_d2.iter().any(|&(a, b)| (a..=b).contains(&d2)) {
                bog.push((dx, dy));
            }
        }
    }
    let mut sites = Vec::new();
    for i in (0..W * H).filter(|&i| s.zone[i] == s.slot) {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        // P-MAPGEN-SIG-RESERVE-1: a reserved site carries the outer-third rule (`Site::floor` confines the tree to it).
        if (s.inner.is_none() && from_centre(x, y) < need)
            || !trunk
                .iter()
                .all(|&(dx, dy)| s.wall(x + dx, y + dy) && s.ground(x + dx, y + dy))
            || !dry.iter().all(|&(dx, dy)| s.floor(x + dx, y + dy))
        {
            continue;
        }
        let wet: Vec<(i32, i32)> = bog
            .iter()
            .copied()
            .filter(|&(dx, dy)| s.ground(x + dx, y + dy))
            .collect();
        let quadrants = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
            .iter()
            .all(|&(qx, qy)| wet.iter().any(|&(dx, dy)| dx * qx > 0 && dy * qy > 0));
        if wet.len() >= d.bog_min && quadrants {
            sites.push((x, y, wet));
        }
    }
    let before = s.floor_pieces(&[]);
    while !sites.is_empty() {
        let (x, y, wet) = sites.remove(pick(rng, sites.len()));
        let walls: Vec<usize> = trunk
            .iter()
            .map(|&(dx, dy)| at(x + dx, y + dy).unwrap())
            .collect();
        if s.floor_pieces(&walls) > before {
            continue;
        }
        let cells = walls
            .iter()
            .map(|&i| (i, TILE_WALL, 0))
            .chain(
                wet.iter()
                    .map(|&(dx, dy)| (at(x + dx, y + dy).unwrap(), TILE_FLOOR, d.bog)),
            )
            .collect();
        return Some(Built {
            pieces: vec![Piece {
                kind: FeatureKind::BogTree,
                job: FeatureJob::Landmark,
                anchor: (x, y),
                cells,
            }],
            anchor: ZoneAnchor {
                zone: Zone::Plague,
                kind: FeatureKind::BogTree,
                centre: TilePt { x, y },
                footprint: super::bounds(
                    trunk
                        .iter()
                        .chain(&wet)
                        .map(|&(dx, dy)| at(x + dx, y + dy).unwrap()),
                ),
                front: front(x, y),
                entrance: Vec::new(),
            },
        });
    }
    None
}

/// The blueprint tree centred on tile `t` (P-MAPGEN-SIG-SCALE-3), or `None` (the attempt is refused) when the site
/// cannot hold it: a trunk, root or marsh tile not `Site::wall` and `Site::ground` (free floor of the site off every
/// camp halo and every apron marked before), a dry or causeway tile not `Site::floor`, a wall piece under
/// `R.piece_min` (8-connected: the stumps are exactly `piece_min`), or the zone's floor split. The orientation: the
/// front is `axis(front(t))`; the mirror is the tree's one draw on the Plague stream, taken first. Cells: the walls
/// (wall, terrain 0) and the marsh (floor, `bog`), owned by the tree; dry floor and causeways are not written. Anchor:
/// centre `t`, footprint the drawing's box (walls and marsh reach every edge row and column, so `finish`'s re-read of
/// the feature's `bbox` is the same box), entrance the causeway tiles on the box's edge, in grid order.
fn blueprint(s: &Site<'_>, rng: &mut Mulberry32, t: (i32, i32)) -> Option<Built> {
    let d = &s.ctx.rules;
    let mirrored = pick(rng, 2) == 1;
    let bp = s.ctx.bog.as_ref()?;
    let f = front(t.0, t.1);
    let u = axis(f);
    let n = bp.side;
    let mut walls = Vec::new();
    let mut cells = Vec::new();
    let mut entrance = Vec::new();
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for gy in 0..n {
        for gx in 0..n {
            let (x, y) = bp.land(t, u, mirrored, (gx, gy));
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            let ch = bp.cells[(gy * n + gx) as usize];
            let legal = if matches!(ch, b'.' | b':') {
                s.floor(x, y)
            } else {
                s.wall(x, y) && s.ground(x, y)
            };
            if !legal {
                return None;
            }
            let i = at(x, y)?;
            match ch {
                b'T' | b'r' => {
                    walls.push(i);
                    cells.push((i, TILE_WALL, 0));
                }
                b'%' => cells.push((i, TILE_FLOOR, d.bog)),
                b':' if gx == 0 || gy == 0 || gx == n - 1 || gy == n - 1 => {
                    entrance.push(TilePt { x, y });
                }
                _ => {}
            }
        }
    }
    if smallest_piece(&walls) < R.piece_min || s.floor_pieces(&walls) > s.floor_pieces(&[]) {
        return None;
    }
    cells.sort_unstable_by_key(|c| c.0);
    Some(Built {
        anchor: ZoneAnchor {
            zone: Zone::Plague,
            kind: FeatureKind::BogTree,
            centre: TilePt { x: t.0, y: t.1 },
            footprint: TileRect {
                x: x0,
                y: y0,
                w: (x1 - x0 + 1) as u32,
                h: (y1 - y0 + 1) as u32,
            },
            front: f,
            entrance,
        },
        pieces: vec![Piece {
            kind: FeatureKind::BogTree,
            job: FeatureJob::Landmark,
            anchor: t,
            cells,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::super::DEFAULT_DEFINITION;
    use super::*;

    #[test]
    fn the_default_drawing_parses_and_malformed_grids_do_not() {
        let bp = Drawing::parse(DEFAULT_DEFINITION.bog_grid).expect("the approved drawing parses");
        assert_eq!(bp.side, 29);
        // Unmirrored with the front +y the drawing lands as drawn; mirrored, flipped across the centre column; with
        // the front +x the front row's centre lands 14 tiles along +x.
        assert_eq!(bp.land((50, 50), (0, 1), false, (0, 0)), (36, 36));
        assert_eq!(bp.land((50, 50), (0, 1), true, (0, 0)), (64, 36));
        assert_eq!(bp.land((50, 50), (1, 0), false, (14, 28)), (64, 50));
        assert!(Drawing::parse(";legend\n%%%\n.T:\nrr.\n").is_some());
        for bad in [
            "",
            ";only a legend\n",
            "%%\n.T\n",        // even side
            "%%%\n.T:\nrr\n",  // not square
            "%%%\n.r:\nrr.\n", // no trunk at the centre
            "%%%\n.Tx\nrr.\n", // unknown character
        ] {
            assert!(Drawing::parse(bad).is_none(), "{bad:?}");
        }
    }
}
