//! Shifted lake clearance and the source's packed local tower scan. No lake is grown.
use super::super::TemplateDefinition;
use crate::map::TILE_FLOOR;
use crate::mapdata::FeatureJob;
use crate::mapgen::landmarks::{
    recipe_support::{argmax_in, js_round, RecipeInputs},
    runtime::LandmarkRuntime,
    search::LandmarkSearch,
    templates::{parse_template, ParsedTemplate, TemplateError},
};
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub template: TemplateDefinition<'a>,
    pub margin_camp: i32,
    pub margin_edge: i32,
    pub margin_ring: i32,
    pub margin_landmark: i32,
    pub clearance_slack: i32,
    pub lake_min_clearance: i32,
    pub second_clearance: i32,
    pub second_sep2: i32,
    pub two_lakes_painted: usize,
    pub tower_beyond: f64,
    pub tower_span: i32,
    pub axis_penalty: f64,
    pub local_bad_max: i32,
    pub local_failures: usize,
    pub fallback_tries: i32,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        template: TemplateDefinition {
            key: "watchtower",
            rows: &[
                "_##dd##_", "##....##", "#c.....#", "#......#", "#.....c#", "##....##", "_##dd##_",
            ],
            jobs: &[FeatureJob::Landmark, FeatureJob::Lee],
        },
        margin_camp: 17,
        margin_edge: 12,
        margin_ring: 17,
        margin_landmark: 9,
        clearance_slack: -1,
        lake_min_clearance: 6,
        second_clearance: 9,
        second_sep2: 324,
        two_lakes_painted: 2600,
        tower_beyond: 3.0,
        tower_span: 7,
        axis_penalty: 100.0,
        local_bad_max: 4,
        local_failures: 6,
        fallback_tries: 6,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    d.template.visit_content(&mut word);
    for v in [
        d.margin_camp,
        d.margin_edge,
        d.margin_ring,
        d.margin_landmark,
        d.clearance_slack,
        d.lake_min_clearance,
        d.second_clearance,
        d.second_sep2,
    ] {
        word(v as u64);
    }
    word(d.two_lakes_painted as u64);
    word(d.tower_beyond.to_bits());
    word(d.tower_span as u64);
    word(d.axis_penalty.to_bits());
    word(d.local_bad_max as u64);
    word(d.local_failures as u64);
    word(d.fallback_tries as u64);
}
pub struct Recipe<'a> {
    definition: Definition<'a>,
    template: ParsedTemplate,
}
fn clearance(rt: &LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>, d: &Definition<'_>) -> Vec<i32> {
    let s = rt.state();
    let g = rt.geometry();
    let (w, h) = (s.w, s.h);
    let bb = g.info.bbox;
    let (x0, y0, x1, y1) = (
        (bb.x - 3).max(0) as usize,
        (bb.y - 3).max(0) as usize,
        (bb.x + bb.w as i32 + 2).min(w as i32 - 1) as usize,
        (bb.y + bb.h as i32 + 2).min(h as i32 - 1) as usize,
    );
    let mut out = vec![0; w * h];
    let ring = inputs.fixed.ring.len() == w * h;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * w + x;
            let mut v = if g.mask[i] == 1 {
                1 << 20
            } else {
                -d.margin_edge
            };
            if ring && inputs.fixed.ring[i] == 1 && v > -d.margin_ring {
                v = -d.margin_ring;
            }
            if g.mask[i] == 1 && v > -d.margin_landmark && rt.is_owned(i as i32) {
                v = -d.margin_landmark;
            }
            out[i] = v;
        }
    }
    for c in &g.camps {
        if c.x >= 0 && c.y >= 0 && c.x < w as i32 && c.y < h as i32 {
            let i = c.y as usize * w + c.x as usize;
            if g.mask[i] == 1 && out[i] > -d.margin_camp {
                out[i] = -d.margin_camp;
            }
        }
    }
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * w + x;
            let mut v = out[i];
            if x > x0 {
                v = v.min(out[i - 1] + 3);
            }
            if y > y0 {
                v = v.min(out[i - w] + 3);
                if x > x0 {
                    v = v.min(out[i - w - 1] + 4);
                }
                if x < x1 {
                    v = v.min(out[i - w + 1] + 4);
                }
            }
            out[i] = v;
        }
    }
    for y in (y0..=y1).rev() {
        for x in (x0..=x1).rev() {
            let i = y * w + x;
            let mut v = out[i];
            if x < x1 {
                v = v.min(out[i + 1] + 3);
            }
            if y < y1 {
                v = v.min(out[i + w] + 3);
                if x < x1 {
                    v = v.min(out[i + w + 1] + 4);
                }
                if x > x0 {
                    v = v.min(out[i + w - 1] + 4);
                }
            }
            out[i] = v;
        }
    }
    out
}
fn seeds(rt: &LandmarkRuntime<'_>, clr: &[i32], d: &Definition<'_>) -> Vec<usize> {
    let s = rt.state();
    let g = rt.geometry();
    let mut allow = vec![0u8; s.w * s.h];
    let bb = g.info.bbox;
    for y in bb.y..bb.y + bb.h as i32 {
        for x in bb.x..bb.x + bb.w as i32 {
            let i = y as usize * s.w + x as usize;
            if g.mask[i] == 1
                && s.tiles[i] == TILE_FLOOR
                && rt.original_hard()[i] == 0
                && clr[i] >= d.clearance_slack
                && !rt.is_owned(i as i32)
            {
                allow[i] = 1;
            }
        }
    }
    let first = argmax_in(clr, &allow, 0, clr.len() as isize);
    #[cfg(test)]
    super::plan(
        rt,
        serde_json::json!({"type":"rimeFields","clr":clr,"allow":allow,"first":first.map_or(-1,|i|i as i64)}),
    );
    let Some(first) = first else { return vec![] };
    if clr[first] < d.lake_min_clearance {
        return vec![];
    }
    let mut out = vec![first];
    if g.info.painted >= d.two_lakes_painted {
        if let Some(second) = second_seed(s.w, clr, &allow, first, d) {
            out.push(second);
        }
    }
    out
}
pub(super) fn second_seed(
    w: usize,
    clr: &[i32],
    allow: &[u8],
    first: usize,
    d: &Definition<'_>,
) -> Option<usize> {
    let mut cand = allow.to_vec();
    let (fx, fy) = ((first % w) as i32, (first / w) as i32);
    for i in 0..cand.len() {
        let dx = (i % w) as i32 - fx;
        let dy = (i / w) as i32 - fy;
        if clr[i] < d.second_clearance || dx * dx + dy * dy < d.second_sep2 {
            cand[i] = 0;
        }
    }
    argmax_in(clr, &cand, 0, clr.len() as isize)
}
impl<'a> Recipe<'a> {
    pub fn from_definition(d: &Definition<'a>) -> Result<Self, TemplateError> {
        Ok(Self {
            definition: *d,
            template: parse_template(d.template.build())?,
        })
    }
    pub fn apply(&self, rt: &mut LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>) {
        let clr = clearance(rt, inputs, &self.definition);
        let seeds = seeds(rt, &clr, &self.definition);
        if seeds.is_empty() {
            return;
        }
        #[cfg(test)]
        super::plan(rt, serde_json::json!({"type":"rimeSeeds","seeds":seeds}));
        let w = rt.state().w;
        let h = rt.state().h;
        for s in seeds
            .into_iter()
            .take(inputs.rules.landmarks_per_zone as usize)
        {
            let sx = (s % w) as i32;
            let sy = (s / w) as i32;
            let vx = (w >> 1) as i32 - sx;
            let vy = (h >> 1) as i32 - sy;
            let len = crate::math::sqrt((vx * vx + vy * vy) as f64);
            let dist = clr[s] as f64 / 3.0 + self.definition.tower_beyond;
            let tx = if len > 0.0 {
                sx + js_round((vx as f64 / len) * dist) as i32
            } else {
                sx
            };
            let ty = if len > 0.0 {
                sy + js_round((vy as f64 / len) * dist) as i32
            } else {
                sy
            };
            #[cfg(test)]
            super::plan(
                rt,
                serde_json::json!({"type":"rimeTarget","s":s,"sx":sx,"sy":sy,"vx":vx,"vy":vy,"len":len,"dist":dist,"tx":tx,"ty":ty,"numericBits":{"len":format!("{:016x}",len.to_bits()),"dist":format!("{:016x}",dist.to_bits())}}),
            );
            self.place_tower(rt, tx, ty, (sy - ty).abs() >= (sx - tx).abs());
        }
    }
    pub(super) fn place_tower(
        &self,
        rt: &mut LandmarkRuntime<'_>,
        tx: i32,
        ty: i32,
        vertical: bool,
    ) {
        let d = &self.definition;
        let s = rt.state();
        let g = rt.geometry();
        let (w, h) = (s.w, s.h);
        let r = d.tower_span + 6;
        let (wx0, wy0, wx1, wy1) = (
            (tx - r).max(0),
            (ty - r).max(0),
            (tx + r).min(w as i32 - 1),
            (ty + r).min(h as i32 - 1),
        );
        let (ww, wh) = (wx1 - wx0 + 1, wy1 - wy0 + 1);
        // Actual generator targets overlap the grid; an entirely off-grid helper has no local keys.
        let mut keys = Vec::<f64>::new();
        #[cfg(test)]
        let mut capture_sat = Vec::new();
        if ww > 0 && wh > 0 {
            let stride = ww as usize + 1;
            let mut sat = vec![0i32; stride * (wh as usize + 1)];
            for y in 0..wh {
                for x in 0..ww {
                    let i = (wy0 + y) as usize * w + (wx0 + x) as usize;
                    let free = g.mask[i] == 1
                        && s.tiles[i] == TILE_FLOOR
                        && rt.original_hard()[i] == 0
                        && !rt.is_owned(i as i32);
                    let q = (y as usize + 1) * stride + x as usize + 1;
                    sat[q] = sat[q - stride] + sat[q - 1] - sat[q - stride - 1] + i32::from(!free);
                }
            }
            #[cfg(test)]
            {
                capture_sat = sat.clone();
            }
            for o in 0..8 {
                let rot = o & 3;
                let (bw, bh) = if rot & 1 == 0 { (8, 7) } else { (7, 8) };
                let (ox, oy) = (tx - (bw >> 1), ty - (bh >> 1));
                let penalty = if (rot & 1 == 0) == vertical {
                    0.0
                } else {
                    d.axis_penalty
                };
                for y in oy - d.tower_span..=oy + d.tower_span {
                    for x in ox - d.tower_span..=ox + d.tower_span {
                        let rx = x - wx0;
                        let ry = y - wy0;
                        if rx < 0 || ry < 0 || rx + bw > ww || ry + bh > wh {
                            continue;
                        }
                        let (rx, ry, bw, bh) = (rx as usize, ry as usize, bw as usize, bh as usize);
                        let bad = sat[(ry + bh) * stride + rx + bw]
                            - sat[ry * stride + rx + bw]
                            - sat[(ry + bh) * stride + rx]
                            + sat[ry * stride + rx];
                        if bad > d.local_bad_max {
                            continue;
                        }
                        let dx2 = 2 * x + bw as i32 - (2 * tx + 1);
                        let dy2 = 2 * y + bh as i32 - (2 * ty + 1);
                        keys.push(
                            ((dx2 * dx2 + dy2 * dy2) as f64 + penalty) * 524288.0
                                + ((y * 256 + x) * 8 + o) as f64,
                        );
                    }
                }
            }
        }
        #[cfg(test)]
        let original_keys = keys.clone();
        keys.sort_by(f64::total_cmp);
        #[cfg(test)]
        super::plan(
            rt,
            serde_json::json!({"type":"rimeKeys","tx":tx,"ty":ty,"vertical":vertical,"wx0":wx0,"wy0":wy0,"ww":ww,"wh":wh,"sat":capture_sat,"keys":original_keys,"order":keys}),
        );
        let mut tried = 0;
        // This intentionally decodes the source's fixed 256-column numeric packing, even on wider grids.
        for key in keys {
            let low = key % 524288.0;
            let o = low % 8.0;
            let xy = (low - o) / 8.0;
            let x = xy % 256.0;
            let y = (xy - x) / 256.0;
            let rot = (o as u8) & 3;
            let mirror = o >= 4.0;
            let Some(st) = super::stamp(&self.template, x as i32, y as i32, rot, mirror, w, h)
            else {
                continue;
            };
            if !super::fits(rt, &st) {
                continue;
            }
            if super::place(rt, &self.template, &st, rot, mirror).is_some() {
                return;
            }
            tried += 1;
            if tried >= d.local_failures {
                #[cfg(test)]
                super::plan(
                    rt,
                    serde_json::json!({"type":"rimeSixFailures","tried":tried}),
                );
                return;
            }
        }
        #[cfg(test)]
        super::plan(rt, serde_json::json!({"type":"rimeFallback","tried":tried}));
        let mut search = LandmarkSearch::new(rt);
        search.best(&self.template,|_rt,st,rot,_mirror|{let dx2=2.0*st.bbox.x as f64+st.bbox.w as f64-(2*tx+1) as f64;let dy2=2.0*st.bbox.y as f64+st.bbox.h as f64-(2*ty+1) as f64;let value=-(dx2*dx2+dy2*dy2)-if (rot&1==0)==vertical{0.0}else{d.axis_penalty};
            #[cfg(test)] super::plan(_rt,serde_json::json!({"type":"searchScore","stamp":st,"o":rot+if _mirror{4}else{0},"value":value,"valueBits":format!("{:016x}",value.to_bits())}));
            value
        },d.fallback_tries,None);
        #[cfg(test)]
        super::tests::observe_search(search.runtime(), search.diagnostics());
    }
}
