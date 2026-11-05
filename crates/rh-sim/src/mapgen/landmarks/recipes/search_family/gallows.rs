use super::super::TemplateDefinition;
use crate::mapdata::{FeatureJob, FeatureKind, TileRect};
use crate::mapgen::landmarks::{
    recipe_support::{js_round, NodeKind, RecipeInputs},
    runtime::LandmarkRuntime,
    search::LandmarkSearch,
    templates::{parse_template, ParsedTemplate, Stamp, TemplateError},
};
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub template: TemplateDefinition<'a>,
    pub far: f64,
    pub min_separation: f64,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        template: TemplateDefinition {
            key: "guardHouse",
            rows: &[
                "###dd###", "#c....c#", "#......#", "#......#", "#......d", "#c.....d", "########",
            ],
            jobs: &[FeatureJob::Landmark, FeatureJob::Lee],
        },
        far: 1e12,
        min_separation: 14.0,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    d.template.visit_content(&mut word);
    word(d.far.to_bits());
    word(d.min_separation.to_bits());
}
pub struct Recipe<'a> {
    definition: Definition<'a>,
    template: ParsedTemplate,
}
fn box_dist2(b: &TileRect, x: f64, y: f64) -> f64 {
    let dx = 2.0 * b.x as f64 + b.w as f64 - x;
    let dy = 2.0 * b.y as f64 + b.h as f64 - y;
    dx * dx + dy * dy
}
fn one_territory(rt: &LandmarkRuntime<'_>, s: &Stamp) -> bool {
    let Some(t) = rt.territory() else { return true };
    let mut id = None;
    for list in [&s.walls, &s.floor, &s.doors, &s.nooks, &s.lights] {
        for &i in list {
            let v = t[i as usize];
            if id.is_some_and(|old| old != v) {
                return false;
            }
            id = Some(v);
        }
    }
    true
}
impl<'a> Recipe<'a> {
    pub fn from_definition(d: &Definition<'a>) -> Result<Self, TemplateError> {
        Ok(Self {
            definition: *d,
            template: parse_template(d.template.build())?,
        })
    }
    pub fn apply(&self, rt: &mut LandmarkRuntime<'_>, inputs: &RecipeInputs<'_>) {
        let want = inputs.rules.landmark_limit(rt.geometry().info.painted);
        if want < 1.0 {
            return;
        }
        let pole = rt.geometry().info.pole;
        let (px, py) = (2.0 * pole.x as f64 + 1.0, 2.0 * pole.y as f64 + 1.0);
        let before = rt.zone_features().count();
        let d = self.definition;
        let mut search = LandmarkSearch::new(rt);
        let mut bound = |rt: &LandmarkRuntime<'_>, b: &TileRect, r: u8, m: bool| {
            let v = -box_dist2(b, px, py);
            #[cfg(test)]
            super::tests::callback(rt, "bound", serde_json::json!(b), r, m, v);
            let _ = (rt, r, m);
            v
        };
        search.best_default(
            &self.template,
            |rt, s, r, m| {
                let v =
                    -box_dist2(&s.bbox, px, py) - if one_territory(rt, s) { 0.0 } else { d.far };
                #[cfg(test)]
                super::tests::callback(rt, "score", serde_json::json!(s), r, m, v);
                let _ = (r, m);
                v
            },
            Some(&mut bound),
        );
        #[cfg(test)]
        super::tests::search(search.diagnostics());
        if want < 2.0 {
            return;
        }
        let first = search
            .runtime()
            .zone_features()
            .skip(before)
            .find(|f| f.kind == FeatureKind::Landmark)
            .map(|f| f.bbox);
        let nodes = inputs.camp_nodes(search.runtime());
        let door = nodes.last().filter(|n| n.kind == NodeKind::Door);
        let c = search.runtime().geometry().info.centroid;
        let (tx, ty) = door.map_or((js_round(2.0 * c.x), js_round(2.0 * c.y)), |n| {
            (2.0 * n.x + 1.0, 2.0 * n.y + 1.0)
        });
        #[cfg(test)]
        let diagnostic_start = search.diagnostics().len();
        let sep2 = 4.0 * d.min_separation * d.min_separation;
        let mut bound = |rt: &LandmarkRuntime<'_>, b: &TileRect, r: u8, m: bool| {
            let v = -box_dist2(b, tx, ty);
            #[cfg(test)]
            super::tests::callback(rt, "bound", serde_json::json!(b), r, m, v);
            let _ = (rt, r, m);
            v
        };
        search.best_default(
            &self.template,
            |rt, s, r, m| {
                let mut sc = -box_dist2(&s.bbox, tx, ty);
                if !one_territory(rt, s) {
                    sc -= d.far
                }
                if first.is_some_and(|b| {
                    box_dist2(
                        &s.bbox,
                        2.0 * b.x as f64 + b.w as f64,
                        2.0 * b.y as f64 + b.h as f64,
                    ) < sep2
                }) {
                    sc -= d.far
                }
                #[cfg(test)]
                super::tests::callback(rt, "score", serde_json::json!(s), r, m, sc);
                let _ = (r, m);
                sc
            },
            Some(&mut bound),
        );
        #[cfg(test)]
        super::tests::search(&search.diagnostics()[diagnostic_start..]);
    }
}
