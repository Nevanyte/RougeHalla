//! Static hall estimate and ordered shrine slots; lights remain owned floor.
use super::super::TemplateDefinition;
use crate::map::TILE_FLOOR;
use crate::mapdata::FeatureJob;
use crate::mapgen::landmarks::{
    recipe_support::{dir_sep16, dist2, isqrt, js_round, RecipeInputs, DIR16},
    runtime::LandmarkRuntime,
    templates::{parse_template, ParsedTemplate, TemplateError},
};
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub template: TemplateDefinition<'a>,
    pub hall_pitch: i32,
    pub radius_ref: f64,
    pub radius_min: i32,
    pub radius_max: i32,
    pub min_piers: usize,
    pub pier_score: f64,
    pub shrine_gap: i32,
    pub extras: &'a [i32],
    pub turn_cost: i32,
    pub inward_cost: i32,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        template: TemplateDefinition {
            key: "shrine",
            rows: &[
                "#########",
                "#c.....c#",
                "#..lll..#",
                "#..lll..#",
                "#..lll..#",
                "##.....##",
                "###ddd###",
            ],
            jobs: &[FeatureJob::Landmark, FeatureJob::Rest],
        },
        hall_pitch: 6,
        radius_ref: 13.0,
        radius_min: 11,
        radius_max: 19,
        min_piers: 4,
        pier_score: 8.0,
        shrine_gap: 4,
        extras: &[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, -2, -4, -6, -8, -10, -12],
        turn_cost: 3,
        inward_cost: 3,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    d.template.visit_content(&mut word);
    word(d.hall_pitch as u64);
    word(d.radius_ref.to_bits());
    word(d.radius_min as u64);
    word(d.radius_max as u64);
    word(d.min_piers as u64);
    word(d.pier_score.to_bits());
    word(d.shrine_gap as u64);
    word(d.extras.len() as u64);
    for &v in d.extras {
        word(v as u64);
    }
    word(d.turn_cost as u64);
    word(d.inward_cost as u64);
}
pub struct Recipe<'a> {
    definition: Definition<'a>,
    template: ParsedTemplate,
}
#[derive(Debug)]
struct Scan {
    x: i32,
    y: i32,
    k: usize,
    score: f64,
    bad: Vec<i32>,
    #[cfg(test)]
    win: Vec<u8>,
}
fn piers(d: &Definition<'_>, r: i32) -> Vec<[i32; 2]> {
    let mut out = Vec::new();
    for i in -4..=3 {
        for j in -4..=3 {
            let u = d.hall_pitch * i + 2;
            let v = d.hall_pitch * j + 2;
            if (u + 1) * (u + 1) + (v + 1) * (v + 1) <= r * r {
                out.push([u, v]);
            }
        }
    }
    out.sort_by_key(|&[u, v]| ((u + 1) * (u + 1) + (v + 1) * (v + 1), u, v));
    out
}
fn slots(d: &Definition<'_>, want: i32, both: bool) -> Vec<[i32; 2]> {
    let mut out = Vec::new();
    for k in 0..16 {
        let sep = if both {
            dir_sep16(k, want).min(dir_sep16(k, (want + 8) & 15))
        } else {
            dir_sep16(k, want)
        };
        for &extra in d.extras {
            out.push((
                d.turn_cost * sep
                    + if extra >= 0 {
                        extra
                    } else {
                        -d.inward_cost * extra
                    },
                k,
                extra,
            ));
        }
    }
    out.sort_unstable();
    out.into_iter().map(|(_, k, e)| [k, e]).collect()
}
fn spot(cx: i32, cy: i32, k: i32, d: i32) -> (i32, i32, u8) {
    let sx = cx + ((DIR16[k as usize][0] as f64 * d as f64 + 512.0) / 1024.0).floor() as i32;
    let sy = cy + ((DIR16[k as usize][1] as f64 * d as f64 + 512.0) / 1024.0).floor() as i32;
    let vx = cx - sx;
    let vy = cy - sy;
    if vx.abs() >= vy.abs() {
        (sx - 3, sy - 4, if vx < 0 { 1 } else { 3 })
    } else {
        (sx - 4, sy - 3, if vy < 0 { 2 } else { 0 })
    }
}
fn scan(rt: &LandmarkRuntime<'_>, d: &Definition<'_>, axis: bool, r: i32) -> Scan {
    let s = rt.state();
    let g = rt.geometry();
    let bb = g.info.bbox;
    let w = s.w;
    let h = s.h;
    let n = w * h;
    let (x0, y0, x1, y1) = (bb.x, bb.y, bb.x + bb.w as i32, bb.y + bb.h as i32);
    let mut ok = vec![0u8; n];
    let mut floor = vec![0u8; n];
    let bw = bb.w as usize + 1;
    let mut bad = vec![0; (bb.w as usize + 1) * (bb.h as usize + 1)];
    for y in y0..y1 {
        for x in x0..x1 {
            let i = y as usize * w + x as usize;
            let mut nf = 1;
            if g.mask[i] == 1 {
                if s.tiles[i] == TILE_FLOOR && rt.original_hard()[i] == 0 {
                    floor[i] = 1;
                    nf = 0;
                }
                if nf == 0 && rt.open(i as i32) {
                    ok[i] = 1;
                }
            }
            let q = (y - y0 + 1) as usize * bw + (x - x0 + 1) as usize;
            bad[q] = bad[q - 1] + bad[q - bw] - bad[q - bw - 1] + nf;
        }
    }
    let mut win = vec![0u8; n];
    let mut cwin = vec![0u8; n];
    for y in y0..y1 - 2 {
        for x in x0..x1 - 2 {
            let i = y as usize * w + x as usize;
            let all = |a: &[u8]| (0..3).all(|dy| (0..3).all(|dx| a[i + dy * w + dx] != 0));
            if all(&ok) {
                win[i] = 1;
            }
            if all(&floor) {
                cwin[i] = 1;
            }
        }
    }
    let piers = piers(d, r);
    let px = g.info.pole.x;
    let py = g.info.pole.y;
    let mut best = Scan {
        x: px,
        y: py,
        k: 0,
        score: 0.0,
        bad,
        #[cfg(test)]
        win: win.clone(),
    };
    for y in (y0 + 2..y1 - 2).step_by(2) {
        for x in (x0 + 2..x1 - 2).step_by(2) {
            if cwin[(y - 1) as usize * w + (x - 1) as usize] == 0 {
                continue;
            }
            let mut k = 0;
            for &[u, v] in &piers {
                let tx = x + if axis { v } else { u };
                let ty = y + if axis { u } else { v };
                if tx >= 0 && ty >= 0 && tx < w as i32 && ty < h as i32 {
                    k += win[ty as usize * w + tx as usize] as usize;
                }
            }
            let score =
                d.pier_score * k as f64 - isqrt(dist2(x as f64, y as f64, px as f64, py as f64));
            #[cfg(test)]
            super::plan(
                rt,
                serde_json::json!({"type":"sanctumCandidate","x":x,"y":y,"k":k,"score":score,"scoreBits":format!("{:016x}",score.to_bits())}),
            );
            if k >= d.min_piers && (best.k == 0 || score > best.score) {
                best.x = x;
                best.y = y;
                best.k = k;
                best.score = score;
            }
        }
    }
    best
}
impl<'a> Recipe<'a> {
    pub fn from_definition(d: &Definition<'a>) -> Result<Self, TemplateError> {
        Ok(Self {
            definition: *d,
            template: parse_template(d.template.build())?,
        })
    }
    pub fn apply(&self, rt: &mut LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>) {
        let d = &self.definition;
        let g = rt.geometry();
        let axis = g.info.axis.x.abs() < g.info.axis.y.abs();
        let r = (js_round(d.radius_ref * inputs.rules.len_scale(g.info.painted)) as i32)
            .clamp(d.radius_min, d.radius_max);
        let est = scan(rt, d, axis, r);
        #[cfg(test)]
        super::plan(
            rt,
            serde_json::json!({"type":"sanctumScan","axis":u8::from(axis),"r":r,"est":{"x":est.x,"y":est.y,"k":est.k,"score":est.score,"win":est.win,"bad":est.bad},"piers":piers(d,r)}),
        );
        let bb = rt.geometry().info.bbox;
        let bw = bb.w as usize + 1;
        let want = inputs
            .rules
            .landmark_limit(rt.geometry().info.painted)
            .max(1.0) as usize;
        let mut first = -1;
        for n in 0..want {
            let slots = slots(
                d,
                if n == 0 {
                    if axis {
                        4
                    } else {
                        0
                    }
                } else {
                    (first + 8) & 15
                },
                n == 0,
            );
            #[cfg(test)]
            super::plan(
                rt,
                serde_json::json!({"type":"sanctumSlots","n":n,"first":first,"slots":slots}),
            );
            for [k, extra] in slots {
                let (x, y, rot) = spot(est.x, est.y, k, r + d.shrine_gap + extra);
                #[cfg(test)]
                super::plan(
                    rt,
                    serde_json::json!({"type":"sanctumSpot","n":n,"k":k,"extra":extra,"spot":{"x0":x,"y0":y,"rot":rot}}),
                );
                let (sw, sh) = if rot & 1 != 0 { (7, 9) } else { (9, 7) };
                let rx = x - bb.x;
                let ry = y - bb.y;
                if rx < 0 || ry < 0 || rx + sw > bb.w as i32 || ry + sh > bb.h as i32 {
                    continue;
                }
                let (rx, ry, sw, sh) = (rx as usize, ry as usize, sw as usize, sh as usize);
                if est.bad[(ry + sh) * bw + rx + sw]
                    - est.bad[ry * bw + rx + sw]
                    - est.bad[(ry + sh) * bw + rx]
                    + est.bad[ry * bw + rx]
                    != 0
                {
                    continue;
                }
                let Some(s) =
                    super::stamp(&self.template, x, y, rot, false, rt.state().w, rt.state().h)
                else {
                    continue;
                };
                if !super::fits(rt, &s)
                    || super::place(rt, &self.template, &s, rot, false).is_none()
                {
                    continue;
                }
                if n == 0 {
                    first = k;
                }
                break;
            }
        }
    }
}
