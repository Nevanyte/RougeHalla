use super::super::TemplateDefinition;
use crate::map::TILE_FLOOR;
use crate::mapdata::{FeatureJob, FeatureKind};
use crate::mapgen::{
    grid_topology::{RING_DX, RING_DY, SIMPLE},
    landmarks::{
        recipe_support::RecipeInputs,
        runtime::LandmarkRuntime,
        search::LandmarkSearch,
        templates::{parse_template, ParsedTemplate, TemplateError},
    },
};
use crate::math::sqrt;
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub template: TemplateDefinition<'a>,
    pub margins: &'a [f64],
    pub forge_disc: f64,
    pub tries: i32,
    pub radius_min4: f64,
    pub radius_max4: f64,
    pub radius_elite_max4: f64,
    pub radius_subtract: f64,
    pub score_margin: f64,
    pub distance_cap: f64,
    pub depth_min: f64,
    pub depth_max: f64,
    pub depth_bonus: f64,
    pub facing_weight: f64,
    pub noise_cell: f64,
    pub noise_salt: f64,
    pub noise_weight: f64,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        template: TemplateDefinition {
            key: "forge",
            rows: &[
                "###dd####",
                "#c......#",
                "#.......#",
                "#..###..#",
                "#..###..d",
                "#c......d",
                "#########",
            ],
            jobs: &[FeatureJob::Landmark, FeatureJob::Lee],
        },
        margins: &[3.0, 2.0],
        forge_disc: 12.0,
        tries: 48,
        radius_min4: 20.0,
        radius_max4: 26.0,
        radius_elite_max4: 30.0,
        radius_subtract: 3.2,
        score_margin: 3.0,
        distance_cap: 6.0,
        depth_min: 0.3,
        depth_max: 0.7,
        depth_bonus: 2.0,
        facing_weight: 2.0,
        noise_cell: 7.0,
        noise_salt: 99.0,
        noise_weight: 2.0,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    d.template.visit_content(&mut word);
    word(d.margins.len() as u64);
    for m in d.margins {
        word(m.to_bits())
    }
    word(d.forge_disc.to_bits());
    word(d.tries as u64);
    for v in [
        d.radius_min4,
        d.radius_max4,
        d.radius_elite_max4,
        d.radius_subtract,
        d.score_margin,
        d.distance_cap,
        d.depth_min,
        d.depth_max,
        d.depth_bonus,
        d.facing_weight,
        d.noise_cell,
        d.noise_salt,
        d.noise_weight,
    ] {
        word(v.to_bits())
    }
}
pub struct Recipe<'a> {
    definition: Definition<'a>,
    template: ParsedTemplate,
}
fn simple(rt: &LandmarkRuntime<'_>, i: usize) -> bool {
    let s = rt.state();
    let tv = rt.territory().map_or(0, |t| t[i]);
    let (mut m, mut mt) = (0, 0);
    for q in 0..8 {
        let j = i as i64 + RING_DY[q] as i64 * s.w as i64 + RING_DX[q] as i64;
        if j < 0 || j >= s.tiles.len() as i64 || s.tiles[j as usize] != TILE_FLOOR {
            continue;
        }
        let j = j as usize;
        if rt.geometry().mask[j] == 0 {
            return false;
        }
        m |= 1 << q;
        if tv != 0 && rt.territory().is_some_and(|t| t[j] == tv) {
            mt |= 1 << q
        }
    }
    SIMPLE[m] == 1 && (tv == 0 || SIMPLE[mt] == 1)
}
fn disc(ext: &mut [u8], w: usize, h: usize, cx: f64, cy: f64, r: f64) {
    let reach = r.ceil() as i32;
    for dy in -reach..=reach {
        let y = cy.floor() as i32 + dy;
        if y < 0 || y >= h as i32 {
            continue;
        }
        for dx in -reach..=reach {
            let x = cx.floor() as i32 + dx;
            if x >= 0
                && x < w as i32
                && (x as f64 + 0.5 - cx) * (x as f64 + 0.5 - cx)
                    + (y as f64 + 0.5 - cy) * (y as f64 + 0.5 - cy)
                    < r * r
            {
                ext[y as usize * w + x as usize] = 1
            }
        }
    }
}
/// Shared radius estimate; callers provide admitted camp metadata in source order.
pub(crate) fn radius4(
    d: &Definition<'_>,
    index: usize,
    mine: &[crate::mapgen::landmarks::runtime::CampInfo],
) -> f64 {
    let k = &mine[index];
    let hi = if k.elite {
        d.radius_elite_max4
    } else {
        d.radius_max4
    };
    let mut near2 = -1.0;
    for (p, o) in mine.iter().enumerate() {
        if p == index {
            continue;
        }
        let dx = (k.x - o.x) as f64;
        let dy = (k.y - o.y) as f64;
        let v = dx * dx + dy * dy;
        if near2 < 0.0 || v < near2 {
            near2 = v;
        }
    }
    if near2 < 0.0 {
        hi
    } else {
        (2.0 * sqrt(near2) - d.radius_subtract)
            .floor()
            .max(d.radius_min4)
            .min(hi)
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Frame {
    pub ux: f64,
    pub uy: f64,
    pub vx: f64,
    pub vy: f64,
    pub cx: f64,
    pub cy: f64,
}
impl Frame {
    pub fn new(w: usize, h: usize, zone: &crate::mapgen::landmarks::runtime::ZoneInfo) -> Self {
        let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
        let (mut ux, mut uy) = (zone.centroid.x - cx, zone.centroid.y - cy);
        let m = sqrt(ux * ux + uy * uy);
        if m > 0.0 {
            ux /= m;
            uy /= m;
        } else {
            ux = 1.0;
            uy = 0.0;
        }
        Self {
            ux,
            uy,
            vx: -uy,
            vy: ux,
            cx,
            cy,
        }
    }
    pub fn depth(self, x: f64, y: f64) -> f64 {
        (x - self.cx) * self.ux + (y - self.cy) * self.uy
    }
    pub fn lateral(self, x: f64, y: f64) -> f64 {
        (x - self.cx) * self.vx + (y - self.cy) * self.vy
    }
}
impl<'a> Recipe<'a> {
    pub fn from_definition(d: &Definition<'a>) -> Result<Self, TemplateError> {
        Ok(Self {
            definition: *d,
            template: parse_template(d.template.build())?,
        })
    }
    pub fn apply(&self, rt: &mut LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>) {
        let d = self.definition;
        let want = inputs.rules.landmark_limit(rt.geometry().info.painted);
        if want <= 0.0 {
            return;
        }
        let mine = rt.geometry().camps.clone();
        let (w, h) = (rt.state().w, rt.state().h);
        let r_est: Vec<f64> = (0..mine.len())
            .map(|q| radius4(&d, q, &mine) / 4.0)
            .collect();
        let frame = Frame::new(w, h, &rt.geometry().info);
        let depth = |x, y| frame.depth(x, y);
        let bb = rt.geometry().info.bbox;
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for y in bb.y..bb.y + bb.h as i32 {
            for x in bb.x..bb.x + bb.w as i32 {
                if rt.geometry().mask[y as usize * w + x as usize] == 0 {
                    continue;
                }
                let v = depth(x as f64 + 0.5, y as f64 + 0.5);
                if v < lo {
                    lo = v
                }
                if v > hi {
                    hi = v
                }
            }
        }
        let span = if hi - lo > 0.0 { hi - lo } else { 1.0 };
        let noise = inputs.streams(rt.geometry().info.index).noise();
        let mut memo = vec![0u8; w * h];
        let mut centres = Vec::<(f64, f64)>::new();
        for k in 0..want as usize {
            let mut placed = false;
            for &margin in d.margins {
                let mut ext = rt.original_hard().to_vec();
                for (q, c) in mine.iter().enumerate() {
                    disc(
                        &mut ext,
                        w,
                        h,
                        c.x as f64 + 0.5,
                        c.y as f64 + 0.5,
                        r_est[q] + margin,
                    )
                }
                for &(x, y) in &centres {
                    disc(&mut ext, w, h, x, y, d.forge_disc)
                }
                #[cfg(test)]
                super::tests::planning(k, margin, &ext, &memo);
                let open = |rt: &LandmarkRuntime<'_>, i: i32| {
                    let i = i as usize;
                    if ext[i] != 0 {
                        #[cfg(test)]
                        super::tests::open(i as i32, false);
                        return false;
                    }
                    if memo[i] == 0 {
                        memo[i] = if rt.open(i as i32) && simple(rt, i) {
                            1
                        } else {
                            2
                        }
                    }
                    let ok = memo[i] == 1;
                    #[cfg(test)]
                    super::tests::open(i as i32, ok);
                    ok
                };
                let mut search = LandmarkSearch::with_planning(rt, &ext, open);
                let result = search.best(
                    &self.template,
                    |rt, s, rot, mirror| {
                        let (mx, my) = (
                            s.bbox.x as f64 + s.bbox.w as f64 / 2.0,
                            s.bbox.y as f64 + s.bbox.h as f64 / 2.0,
                        );
                        let (mut near, mut nearest) = (f64::INFINITY, None);
                        for (q, c) in mine.iter().enumerate() {
                            let dx = mx - c.x as f64 - 0.5;
                            let dy = my - c.y as f64 - 0.5;
                            let v = sqrt(dx * dx + dy * dy) - (r_est[q] + d.score_margin);
                            if v < near {
                                near = v;
                                nearest = Some(q)
                            }
                        }
                        let mut sc = if near > d.distance_cap {
                            d.distance_cap
                        } else {
                            near
                        };
                        let f = (depth(mx, my) - lo) / span;
                        if f >= d.depth_min && f <= d.depth_max {
                            sc += d.depth_bonus
                        }
                        if let Some(q) = nearest {
                            let (tx, ty) =
                                (mine[q].x as f64 + 0.5 - mx, mine[q].y as f64 + 0.5 - my);
                            let tl = sqrt(tx * tx + ty * ty);
                            let tl = if tl == 0.0 { 1.0 } else { tl };
                            let mut best = -1.0;
                            for &i in &s.doors {
                                let dx = (i as usize % w) as f64 + 0.5 - mx;
                                let dy = (i as usize / w) as f64 + 0.5 - my;
                                let dl = sqrt(dx * dx + dy * dy);
                                let dl = if dl == 0.0 { 1.0 } else { dl };
                                let cs = (dx * tx + dy * ty) / (dl * tl);
                                if cs > best {
                                    best = cs
                                }
                            }
                            sc += d.facing_weight * best
                        }
                        let result = sc
                            + (noise.noise_q(
                                s.bbox.x as f64,
                                s.bbox.y as f64,
                                d.noise_cell,
                                d.noise_salt,
                            ) / 1024.0)
                                * d.noise_weight;
                        #[cfg(test)]
                        super::tests::callback(
                            rt,
                            "score",
                            serde_json::json!(s),
                            rot,
                            mirror,
                            result,
                        );
                        let _ = (rt, rot, mirror);
                        result
                    },
                    d.tries,
                    None,
                );
                #[cfg(test)]
                super::tests::search(search.diagnostics());
                if result.is_some() {
                    placed = true;
                    break;
                }
            }
            if !placed {
                break;
            }
            let Some(b) = rt
                .zone_features()
                .filter(|f| f.kind == FeatureKind::Landmark)
                .nth(k)
                .map(|f| f.bbox)
            else {
                break;
            };
            centres.push((b.x as f64 + b.w as f64 / 2.0, b.y as f64 + b.h as f64 / 2.0));
        }
    }
}
