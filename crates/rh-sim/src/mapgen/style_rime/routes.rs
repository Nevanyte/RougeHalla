use super::*;
use crate::mapgen::coliseum::GateSide;
use crate::{
    constants::{PLAYER_RADIUS, TILE},
    map::{tile_to_world_center, TileMap},
    math::Vec2,
    pathfind::Pathfinder,
};
use lakes::Lake;
pub(super) struct RouteBook {
    pub band: Vec<u8>,
    pub routed: usize,
    mouths: Option<Vec<[f64; 2]>>,
    done: Vec<i32>,
    view: Option<TileMap>,
    finder: Pathfinder,
}
impl RouteBook {
    pub fn new(b: &BaseContext<'_>, corridor: &[u8], fixed: &FixedLayout, d: &Definition) -> Self {
        let mouths = (fixed.dist_fp.len() == b.w * b.h).then(|| {
            fixed
                .gates
                .iter()
                .map(|g| {
                    let (ox, oy) = match g.side {
                        GateSide::East => (d.gate_mouth_offset, 0.0),
                        GateSide::West => (-d.gate_mouth_offset, 0.0),
                        GateSide::South => (0.0, d.gate_mouth_offset),
                        GateSide::North => (0.0, -d.gate_mouth_offset),
                    };
                    [g.x / TILE + ox, g.y / TILE + oy]
                })
                .collect()
        });
        let mut band = vec![0; b.w * b.h];
        let bb = b.zone.bbox;
        for y in bb.y..bb.y + bb.h as i32 {
            for x in bb.x..bb.x + bb.w as i32 {
                let i = y as usize * b.w + x as usize;
                if corridor[i] == 1 {
                    band[i] = 1;
                }
            }
        }
        Self {
            band,
            routed: 0,
            mouths,
            done: vec![],
            view: None,
            finder: Pathfinder::default(),
        }
    }
    pub fn ensure(
        &mut self,
        b: &BaseContext<'_>,
        lakes: &[Lake],
        d: &Definition,
        fixed: &FixedLayout,
    ) {
        let Some(mouths) = &self.mouths else {
            return;
        };
        let (w, h) = (b.w, b.h);
        let around: Vec<_> = lakes
            .iter()
            .map(|l| near_lake(w, h, l, d.route_near))
            .collect();
        for &m in b.spawns {
            if self.done.contains(&m) {
                continue;
            }
            let (mx, my) = (m as usize % w, m as usize / w);
            let near = member_ways(mouths, mx, my, d.route_second)
                .iter()
                .any(|&[tx, ty]| {
                    around.iter().any(|near| {
                        way_touches(w, h, mx as f64 + 0.5, my as f64 + 0.5, tx, ty, near)
                    })
                });
            if !near {
                continue;
            }
            self.done.push(m);
            if self.view.is_none() {
                let mut tiles = b.tiles.to_vec();
                for (i, t) in tiles.iter_mut().enumerate() {
                    if b.mask[i] == 0 && fixed.painted_mask[i] == 1 {
                        *t = TILE_FLOOR;
                    }
                }
                self.view =
                    Some(TileMap::new(w as u32, h as u32, tiles).expect("admitted path grid"));
            }
            let path = self.finder.find_path(
                self.view.as_ref().unwrap(),
                Vec2 {
                    x: tile_to_world_center(mx as i64),
                    y: tile_to_world_center(my as i64),
                },
                Vec2 {
                    x: tile_to_world_center((w >> 1) as i64),
                    y: tile_to_world_center((h >> 1) as i64),
                },
                PLAYER_RADIUS,
            );
            if path.is_empty() {
                continue;
            }
            self.routed += 1;
            let (mut ax, mut ay) = (mx as f64 + 0.5, my as f64 + 0.5);
            mark(&mut self.band, w, h, mx as i32, my as i32, d.route_band);
            for q in path {
                let (bx, by) = (q.x / TILE, q.y / TILE);
                let len = (bx - ax).abs().max((by - ay).abs());
                let steps = if len < 0.25 {
                    1
                } else {
                    (len * 2.0).ceil() as usize
                };
                for s in 0..=steps {
                    let x = (ax + ((bx - ax) * s as f64) / steps as f64).floor() as i32;
                    let y = (ay + ((by - ay) * s as f64) / steps as f64).floor() as i32;
                    if x < 0
                        || y < 0
                        || x >= w as i32
                        || y >= h as i32
                        || b.mask[y as usize * w + x as usize] == 0
                    {
                        continue;
                    }
                    mark(&mut self.band, w, h, x, y, d.route_band);
                }
                ax = bx;
                ay = by;
            }
        }
    }
    pub fn iceable(&self, lake: &Lake) -> usize {
        lake.set
            .iter()
            .zip(&self.band)
            .filter(|(v, b)| **v == 1 && **b == 0)
            .count()
    }
}
fn member_ways(mouths: &[[f64; 2]], mx: usize, my: usize, second: f64) -> Vec<[f64; 2]> {
    let (px, py) = (mx as f64 + 0.5, my as f64 + 0.5);
    let (cx, cy) = (
        (mouths[0][0] + mouths[2][0]) / 2.0,
        (mouths[1][1] + mouths[3][1]) / 2.0,
    );
    let mut ways: Vec<_> = mouths
        .iter()
        .map(|&m| {
            let a = crate::math::sqrt((px - m[0]) * (px - m[0]) + (py - m[1]) * (py - m[1]));
            let z = crate::math::sqrt((m[0] - cx) * (m[0] - cx) + (m[1] - cy) * (m[1] - cy));
            (a + z, m)
        })
        .collect();
    ways.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out = vec![ways[0].1];
    if ways[1].0 * 1000.0 <= ways[0].0 * second {
        out.push(ways[1].1);
    }
    out
}
fn near_lake(w: usize, h: usize, lake: &Lake, r: i32) -> Vec<u8> {
    let mut out = vec![0; w * h];
    for y in lake.y0..=lake.y1 {
        for x in lake.x0..=lake.x1 {
            if lake.set[y * w + x] == 1 {
                mark(&mut out, w, h, x as i32, y as i32, r);
            }
        }
    }
    out
}
fn way_touches(w: usize, h: usize, ax: f64, ay: f64, bx: f64, by: f64, near: &[u8]) -> bool {
    let len = (bx - ax).abs().max((by - ay).abs());
    let steps = if len < 1.0 { 1 } else { len.ceil() as usize };
    (0..=steps).any(|s| {
        let x = (ax + ((bx - ax) * s as f64) / steps as f64).floor() as i32;
        let y = (ay + ((by - ay) * s as f64) / steps as f64).floor() as i32;
        x >= 0 && y >= 0 && x < w as i32 && y < h as i32 && near[y as usize * w + x as usize] == 1
    })
}
fn mark(out: &mut [u8], w: usize, h: usize, x: i32, y: i32, r: i32) {
    for ny in (y - r).max(0)..=(y + r).min(h as i32 - 1) {
        for nx in (x - r).max(0)..=(x + r).min(w as i32 - 1) {
            out[ny as usize * w + nx as usize] = 1;
        }
    }
}
