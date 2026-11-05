//! Collapsed burrows on the actual Gabriel roads, in source preference order.
use super::super::TemplateDefinition;
use crate::mapdata::FeatureJob;
use crate::mapgen::landmarks::{
    recipe_support::{gabriel_edges, js_round, Node, RecipeInputs},
    runtime::LandmarkRuntime,
    templates::{parse_template, ParsedTemplate, TemplateError},
};
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub template: TemplateDefinition<'a>,
    pub road_min2: f64,
    pub roads_tried: usize,
    pub t_permille: &'a [f64],
    pub across: &'a [f64],
    pub mirror_cell: f64,
    pub mirror_salt: f64,
    pub mirror_threshold: f64,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        template: TemplateDefinition {
            key: "burrow",
            rows: &[
                "__#####__",
                "_##...##_",
                "##c....##",
                "#.......#",
                "d.......d",
                "d.......d",
                "##....c##",
                "_##...##_",
                "__#####__",
            ],
            jobs: &[FeatureJob::Landmark, FeatureJob::Fork],
        },
        road_min2: 324.0,
        roads_tried: 6,
        t_permille: &[500.0, 450.0, 550.0, 400.0, 600.0],
        across: &[0.0, 1.0, -1.0, 2.0, -2.0],
        mirror_cell: 1.0,
        mirror_salt: 401.0,
        mirror_threshold: 512.0,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    d.template.visit_content(&mut word);
    word(d.road_min2.to_bits());
    word(d.roads_tried as u64);
    for a in [d.t_permille, d.across] {
        word(a.len() as u64);
        for v in a {
            word(v.to_bits());
        }
    }
    for v in [d.mirror_cell, d.mirror_salt, d.mirror_threshold] {
        word(v.to_bits());
    }
}
pub struct Recipe<'a> {
    definition: Definition<'a>,
    template: ParsedTemplate,
}
#[derive(Clone, Debug)]
struct Road {
    a: usize,
    b: usize,
    dx: f64,
    dy: f64,
    d2: f64,
    len: f64,
}
fn roads(nodes: &[Node], min2: f64) -> Vec<Road> {
    let mut out = Vec::new();
    for [a, b] in gabriel_edges(nodes) {
        let dx = nodes[b].x - nodes[a].x;
        let dy = nodes[b].y - nodes[a].y;
        let d2 = dx * dx + dy * dy;
        if d2 >= min2 {
            out.push(Road {
                a,
                b,
                dx,
                dy,
                d2,
                len: crate::math::sqrt(d2),
            });
        }
    }
    let key = |i: usize| nodes[i].y * 100000.0 + nodes[i].x;
    out.sort_by(|p, q| {
        q.d2.total_cmp(&p.d2)
            .then_with(|| key(p.a).total_cmp(&key(q.a)))
            .then_with(|| key(p.b).total_cmp(&key(q.b)))
    });
    out
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
        let want = (inputs.rules.landmarks_per_zone as f64)
            .min(js_round(inputs.rules.area_scale(rt.geometry().info.painted)).max(1.0));
        let nodes = inputs.camp_nodes(rt);
        #[cfg(test)]
        super::plan(rt, serde_json::json!({"type":"warrenNodes","nodes":nodes}));
        if nodes.len() < 2 {
            return;
        }
        let roads = roads(&nodes, d.road_min2);
        #[cfg(test)]
        super::plan(
            rt,
            serde_json::json!({"type":"warrenRoads","nodes":nodes,"roads":roads.iter().map(|r|serde_json::json!({"a":nodes[r.a],"b":nodes[r.b],"dx":r.dx,"dy":r.dy,"d2":r.d2,"len":r.len})).collect::<Vec<_>>(),"lengthBits":roads.iter().map(|r|format!("{:016x}",r.len.to_bits())).collect::<Vec<_>>()}),
        );
        let noise = inputs.streams(rt.geometry().info.index).noise();
        let mut placed = 0;
        for road in roads.into_iter().take(d.roads_tried) {
            if placed as f64 >= want {
                break;
            }
            let a = &nodes[road.a];
            let rot = if road.dx.abs() >= road.dy.abs() { 0 } else { 1 };
            let noise_value = noise.noise_q(a.x, a.y, d.mirror_cell, d.mirror_salt);
            let mirror = noise_value < d.mirror_threshold;
            #[cfg(test)]
            super::plan(
                rt,
                serde_json::json!({"type":"warrenMirror","road":{"a":nodes[road.a],"b":nodes[road.b],"dx":road.dx,"dy":road.dy,"d2":road.d2,"len":road.len},"rot":rot,"mirror":mirror,"noiseValue":noise_value}),
            );
            'centre: for &tp in d.t_permille {
                for &off in d.across {
                    let cx = js_round(a.x + (road.dx * tp) / 1000.0 - (road.dy * off) / road.len);
                    let cy = js_round(a.y + (road.dy * tp) / 1000.0 + (road.dx * off) / road.len);
                    #[cfg(test)]
                    super::plan(
                        rt,
                        serde_json::json!({"type":"warrenCentre","tp":tp,"off":off,"cx":cx,"cy":cy}),
                    );
                    let Some(s) = super::stamp(
                        &self.template,
                        cx as i32 - 4,
                        cy as i32 - 4,
                        rot,
                        mirror,
                        rt.state().w,
                        rt.state().h,
                    ) else {
                        continue;
                    };
                    if !super::fits(rt, &s) {
                        continue;
                    }
                    if super::place(rt, &self.template, &s, rot, mirror).is_some() {
                        placed += 1;
                        break 'centre;
                    }
                }
            }
        }
    }
}
