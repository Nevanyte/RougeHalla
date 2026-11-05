use super::{PlanningPolicy, Stamp};
use crate::map::TILE_FLOOR;
use crate::mapdata::FeatureKind;
use crate::mapgen::landmarks::{runtime::LandmarkRuntime, templates::ParsedTemplate};

#[derive(Debug)]
#[cfg_attr(test, derive(serde::Serialize))]
#[cfg_attr(test, serde(rename_all = "camelCase"))]
pub(super) struct Tables {
    bw: usize,
    bh: usize,
    ok_wall: Vec<u8>,
    ok_floor: Vec<u8>,
    sat_wall: Vec<i32>,
    sat_floor: Vec<i32>,
    features: usize,
    sum: u64,
}
fn box_sum(rt: &LandmarkRuntime<'_>) -> u64 {
    let b = rt.geometry().info.bbox;
    let s = rt.state();
    let mut sum = 0;
    for y in b.y as usize..b.y as usize + b.h as usize {
        for x in b.x as usize..b.x as usize + b.w as usize {
            sum += u64::from(s.tiles[y * s.w + x]);
        }
    }
    sum
}
impl Tables {
    pub(super) fn valid(&self, rt: &LandmarkRuntime<'_>) -> bool {
        self.features == rt.zone_features().count() && self.sum == box_sum(rt)
    }
    pub(super) fn build(rt: &LandmarkRuntime<'_>, policy: &mut impl PlanningPolicy) -> Self {
        let s = rt.state();
        let g = rt.geometry();
        let b = g.info.bbox;
        let (bw, bh) = (b.w as usize, b.h as usize);
        let mut out = Self {
            bw,
            bh,
            ok_wall: vec![0; bw * bh],
            ok_floor: vec![0; bw * bh],
            sat_wall: vec![0; (bw + 1) * (bh + 1)],
            sat_floor: vec![0; (bw + 1) * (bh + 1)],
            features: rt.zone_features().count(),
            sum: box_sum(rt),
        };
        for y in 0..bh {
            for x in 0..bw {
                let i = (b.y as usize + y) * s.w + b.x as usize + x;
                if g.mask[i] == 1
                    && s.tiles[i] == TILE_FLOOR
                    && policy.hard(rt)[i] == 0
                    && !rt.is_owned(i as i32)
                {
                    out.ok_floor[y * bw + x] = 1;
                    if policy.open(rt, i as i32) {
                        out.ok_wall[y * bw + x] = 1;
                    }
                }
            }
        }
        out.sats(0);
        out
    }
    fn sats(&mut self, from: usize) {
        let w1 = self.bw + 1;
        for y in from..self.bh {
            let (mut wall, mut floor) = (0, 0);
            for x in 0..self.bw {
                wall += i32::from(self.ok_wall[y * self.bw + x]);
                floor += i32::from(self.ok_floor[y * self.bw + x]);
                self.sat_wall[(y + 1) * w1 + x + 1] = self.sat_wall[y * w1 + x + 1] + wall;
                self.sat_floor[(y + 1) * w1 + x + 1] = self.sat_floor[y * w1 + x + 1] + floor;
            }
        }
    }
    fn fits(&self, wall: bool, x: usize, y: usize, w: usize, h: usize) -> bool {
        if x + w > self.bw || y + h > self.bh {
            return false;
        }
        let sat = if wall {
            &self.sat_wall
        } else {
            &self.sat_floor
        };
        let w1 = self.bw + 1;
        sat[(y + h) * w1 + x + w] - sat[y * w1 + x + w] - sat[(y + h) * w1 + x] + sat[y * w1 + x]
            == (w * h) as i32
    }
    pub(super) fn candidates(
        &self,
        rt: &LandmarkRuntime<'_>,
        t: &ParsedTemplate,
        stride: usize,
    ) -> Vec<(i32, u8)> {
        let b = rt.geometry().info.bbox;
        let mut out = Vec::new();
        for ry in (0..self.bh).step_by(stride) {
            for rx in (0..self.bw).step_by(stride) {
                let x = b.x + rx as i32;
                let y = b.y + ry as i32;
                let mut free_box = [None; 2];
                for o in 0..8 {
                    let ori = &t.orientations[o];
                    if ori.full {
                        let fits = *free_box[o & 1].get_or_insert_with(|| {
                            let r = &t.orientations[0];
                            let (w, h) = if o & 1 == 0 {
                                (r.bw, r.bh)
                            } else {
                                (r.bh, r.bw)
                            };
                            self.fits(false, rx, ry, w, h)
                        });
                        if !fits {
                            continue;
                        }
                    }
                    if !ori.rects.chunks_exact(5).all(|r| {
                        let (Ok(qx), Ok(qy), Ok(qw), Ok(qh)) = (
                            usize::try_from(rx as i64 + i64::from(r[0])),
                            usize::try_from(ry as i64 + i64::from(r[1])),
                            usize::try_from(r[2]),
                            usize::try_from(r[3]),
                        ) else {
                            return false;
                        };
                        self.fits(r[4] == 1, qx, qy, qw, qh)
                    }) {
                        continue;
                    }
                    let gap = crate::constants::LANDMARK_GAP;
                    if rt.zone_features().any(|f| {
                        let q = f.bbox;
                        f.kind == FeatureKind::Landmark
                            && f64::from(x) - gap < f64::from(q.x) + f64::from(q.w)
                            && f64::from(x) + ori.bw as f64 + gap > f64::from(q.x)
                            && f64::from(y) - gap < f64::from(q.y) + f64::from(q.h)
                            && f64::from(y) + ori.bh as f64 + gap > f64::from(q.y)
                    }) {
                        continue;
                    }
                    out.push((y * rt.state().w as i32 + x, o as u8));
                }
            }
        }
        out
    }
    pub(super) fn patch(&mut self, rt: &LandmarkRuntime<'_>, s: &Stamp) {
        let b = rt.geometry().info.bbox;
        let w = rt.state().w as i32;
        for list in [&s.walls, &s.floor, &s.doors, &s.nooks, &s.lights] {
            for &i in list {
                let x = (i % w - b.x) as usize;
                let y = (i / w - b.y) as usize;
                self.ok_wall[y * self.bw + x] = 0;
                self.ok_floor[y * self.bw + x] = 0;
            }
        }
        self.sats((s.bbox.y - b.y) as usize);
        self.features = rt.zone_features().count();
        self.sum = box_sum(rt);
    }
}
