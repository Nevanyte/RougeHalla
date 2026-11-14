//! Plague: the giant bog tree (no legacy counterpart, DEV-020).
//!
//! With a reserved site (P-MAPGEN-SIG-RESERVE-1, every option-on attempt) the tree IS the owner-approved blueprint
//! (P-MAPGEN-SIG-SCALE-3; ADR 0028 G9, decision 4): `Definition::bog_grid`, a 29 x 29 drawing centred in the site (its
//! centre tile, the trunk's centre, on the site's centre tile), its front row toward the coliseum (the dominant axis of
//! DIR16 from the centre tile toward it), mirrored or not by one draw of the Plague stream. `T` (trunk) and `r` (roots)
//! are the tree's walls, `%` its marsh (floor, terrain bog), all off every apron marked before; `.` and the causeways
//! `:` stay unwritten floor. A site that cannot hold the drawing refuses the attempt; the drawing is never served
//! smaller. Since P-MAPGEN-SIG-BLUEPRINT-1 the generic stamp (`super::stamp`) draws it from its table entry
//! (`super::spec`); this file keeps the rule-drawn tree.
//!
//! Without a reserved site (a `begin_attempt` prefix, which only tests feed the step: the option-on Prefix always
//! reserves) the older rule-drawn tree stands: a solid trunk (wall) on dry ground in the outer third of the zone's
//! radial extent from the map centre, ringed by two bands of bog (floor, terrain bog), one feature; the site is a
//! uniform draw over every legal centre tile.
use super::{at, front, pick, Built, Piece, Site};
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, Zone, ZoneAnchor};
use crate::mapgen::coliseum::{H, W};
use crate::rng::Mulberry32;

/// The rule-drawn tree (a zone without a reserved site), or `None` when the zone cannot hold it (the attempt is
/// refused, G5).
pub(super) fn place(s: &Site<'_>, rng: &mut Mulberry32) -> Option<Built> {
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
