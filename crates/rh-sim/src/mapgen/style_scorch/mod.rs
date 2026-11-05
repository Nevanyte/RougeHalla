//! Fire stage-six callbacks. Real guarded runtime operations; shared Forge and feature-kit definitions.
mod craters;
mod raster;
mod river;
mod rules;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature};
use crate::mapgen::{
    coliseum::{FixedDefinition, FixedLayout},
    landmarks::{
        recipe_support::{self, js_round, CampNodeInputs, RecipeSupportDefinition},
        recipes::search_family::scorch as forge,
        runtime::CampInfo,
        templates::{parse_template, stamp_template, ParsedTemplate},
    },
    style_features as kit,
    style_runtime::{
        noise_hash, BaseContext, BlockKind, Error, FeatureSpec, Mode, PropContext, ShapeContext,
        SurfaceContext, SurfaceKind,
    },
    terrain_gate::TerrainGateDefinition,
};
pub use rules::{
    default_definition, visit_content, CraterRules, DecorRules, Definition, RiverRules,
};
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crater {
    pub camp: usize,
    pub x: i32,
    pub y: i32,
    pub r4: i32,
    pub dirs: Vec<usize>,
    pub rim: Vec<i32>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub river_path: Vec<i32>,
    pub fords: Vec<i32>,
    pub lava: Vec<i32>,
    pub no_ember: Vec<i32>,
    pub craters: Vec<Crater>,
    pub edges: usize,
    pub loops: usize,
}
pub struct Callbacks<'a> {
    definition: Definition,
    forge: forge::Definition<'a>,
    scale: RecipeSupportDefinition,
    kit: kit::Definition,
    fixed: &'a FixedLayout,
    fixed_rules: &'a FixedDefinition<'a>,
    template: ParsedTemplate,
    props: [i32; 6],
    none: u8,
    ember: u8,
}
impl<'a> Callbacks<'a> {
    pub fn new(
        d: &Definition,
        forge: &forge::Definition<'a>,
        scale: &RecipeSupportDefinition,
        kit: &kit::Definition,
        fixed: &'a FixedLayout,
        fixed_rules: &'a FixedDefinition<'a>,
        catalog: &TerrainGateDefinition<'_>,
    ) -> Result<Self, Error> {
        d.validate()?;
        if !scale.ref_zone_tiles.is_finite()
            || scale.ref_zone_tiles < 1.0
            || [
                forge.radius_min4,
                forge.radius_max4,
                forge.radius_elite_max4,
                forge.radius_subtract,
            ]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0 || *v > 64.0)
            || forge.radius_min4 < 3.0
            || forge.radius_min4 > forge.radius_max4
            || forge.radius_max4 > forge.radius_elite_max4
            || forge.radius_min4.fract() != 0.0
            || forge.radius_max4.fract() != 0.0
            || forge.radius_elite_max4.fract() != 0.0
        {
            return Err(Error::Definition);
        }
        if kit.path_far <= 0
            || kit.hard_radius < 0
            || kit.hard_radius > 64
            || kit.path_orthogonal < 0
            || kit.path_diagonal < 0
            || kit.hard_penalty < 0
            || !kit.noise_cell.is_finite()
            || kit.noise_cell <= 0.0
            || !kit.noise_scale.is_finite()
            || !(0.0..=1_000_000.0).contains(&kit.noise_scale)
        {
            return Err(Error::Definition);
        }
        let mut ids = [0; 6];
        for (j, key) in [
            "crater_lip",
            "glow_crack",
            "anvil",
            "slag_heap",
            "ember_vent",
            "ash_drift",
        ]
        .iter()
        .enumerate()
        {
            let found: Vec<_> = catalog
                .props
                .iter()
                .enumerate()
                .filter(|(_, p)| p.key == *key)
                .collect();
            if found.len() != 1 {
                return Err(Error::Metadata);
            }
            ids[j] = i32::try_from(found[0].0).map_err(|_| Error::Metadata)?;
        }
        let terrain = |key| {
            let found: Vec<_> = catalog
                .kinds
                .iter()
                .enumerate()
                .filter(|(_, t)| t.key == key)
                .collect();
            if found.len() != 1 {
                return Err(Error::Metadata);
            }
            u8::try_from(found[0].0).map_err(|_| Error::Metadata)
        };
        let none = terrain("none")?;
        let ember = terrain("ember")?;
        Ok(Self {
            definition: *d,
            forge: *forge,
            scale: *scale,
            kit: *kit,
            fixed,
            fixed_rules,
            template: parse_template(forge.template.build()).map_err(|_| Error::Definition)?,
            props: ids,
            none,
            ember,
        })
    }
    pub fn shape(&self, c: &mut ShapeContext<'_, '_>) -> Result<Plan, Error> {
        let mut plan = Plan::default();
        let mine = c.base().camps.to_vec();
        c.route_guard();
        let b = c.base();
        let nodes = recipe_support::camp_nodes_from(
            CampNodeInputs {
                w: b.w,
                h: b.h,
                mask: b.mask,
                tiles: b.tiles,
                info: b.zone,
                camps: &mine,
            },
            Some(&self.fixed.dist_fp),
            self.fixed_rules.ring_road,
            &self.scale,
        );
        let root = if nodes.len() > mine.len() {
            nodes.len() - 1
        } else {
            0
        };
        let mut edges = kit::prim_mst(&nodes, root as isize);
        kit::add_shortcuts(
            &nodes,
            &mut edges,
            js_round(self.scale.area_scale(b.zone.painted)) as usize,
            self.definition.crater.loop_ratio,
            self.definition.crater.loop_max_len,
        );
        plan.edges = edges.len();
        plan.loops = (edges.len() as isize - (nodes.len() as isize - 1)).max(0) as usize;
        let mut r4s: Vec<_> = (0..mine.len())
            .map(|q| forge::radius4(&self.forge, q, &mine) as i32)
            .collect();
        self.place_craters(c, &mine, &mut r4s, &nodes, &edges, &mut plan)?;
        self.place_river(c, &mine, &r4s, &nodes, &edges, &mut plan)?;
        Ok(plan)
    }
    pub(crate) fn admit_inputs<'input>(
        &self,
        w: usize,
        h: usize,
        features: impl Iterator<Item = &'input MapFeature>,
    ) -> Result<(), Error> {
        for f in features
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.template.template.key)
        {
            if f.bbox.x < 0
                || f.bbox.y < 0
                || i64::from(f.bbox.x) + i64::from(f.bbox.w) > w as i64
                || i64::from(f.bbox.y) + i64::from(f.bbox.h) > h as i64
            {
                return Err(Error::Feature);
            }
        }
        Ok(())
    }
    fn admit(&self, b: BaseContext<'_>, p: &Plan) -> Result<(), Error> {
        self.admit_inputs(b.w, b.h, b.zone_features())?;
        let n = (b.w * b.h) as i32;
        let valid = |i: &i32| *i >= 0 && *i < n;
        if p.river_path
            .iter()
            .chain(&p.fords)
            .chain(&p.lava)
            .chain(&p.no_ember)
            .any(|i| !valid(i))
            || p.fords.iter().any(|i| !p.river_path.contains(i))
            || p.loops > p.edges.saturating_add(1)
            || p.craters.len() > b.camps.len()
        {
            return Err(Error::Feature);
        }
        for cr in &p.craters {
            if cr.rim.iter().any(|i| !valid(i))
                || cr.dirs.iter().any(|&d| d >= 16)
                || cr.r4 < (self.forge.radius_min4 as i32)
                || cr.r4 > (self.forge.radius_elite_max4 as i32)
                || !b
                    .camps
                    .iter()
                    .any(|c| c.index == cr.camp && c.x == cr.x && c.y == cr.y)
            {
                return Err(Error::Feature);
            }
        }
        Ok(())
    }
    pub fn surface(&self, c: &mut SurfaceContext<'_, '_>, p: &Plan) -> Result<(), Error> {
        self.admit(c.base(), p)?;
        let w = c.base().w as i32;
        let mut skip = vec![false; c.base().w * c.base().h];
        for &i in &p.no_ember {
            skip[i as usize] = true;
        }
        for &t in &p.lava {
            let (x, y) = (t % w, t / w);
            for [dx, dy] in kit::DIR8 {
                let j = c.base().at(x + dx, y + dy);
                if j >= 0 && !skip[j as usize] {
                    c.surface(j, SurfaceKind::Ember);
                }
            }
        }
        Ok(())
    }
    pub fn props(&self, c: &mut PropContext<'_, '_>, p: &Plan) -> Result<(), Error> {
        self.admit(c.base(), p)?;
        let w = c.base().w as i32;
        let bb = c.base().zone.bbox;
        let noise = c.streams.noise;
        let d = &self.definition.decor;
        let hash = |x: i32, y: i32, s| noise_hash(noise, x as f64, y as f64, s);
        let variant = |x, y| (hash(x, y, d.variant_salt) * d.variant_count as f64).floor() as u8;
        for cr in &p.craters {
            for &t in &cr.rim {
                let (x, y) = (t % w, t / w);
                let u = hash(x, y, d.choose_salt);
                let v = variant(x, y);
                if u < d.crater_lip_chance {
                    c.prop(self.props[0], x, y, v);
                } else if u < d.crater_glow_chance {
                    c.prop(self.props[1], x, y, v);
                }
            }
        }
        let features: Vec<_> = c
            .base()
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.template.template.key)
            .cloned()
            .collect();
        for f in features {
            for y in f.bbox.y..f.bbox.y + f.bbox.h as i32 {
                for x in f.bbox.x..f.bbox.x + f.bbox.w as i32 {
                    let i = y * w + x;
                    if c.base().tiles[i as usize] != TILE_WALL || !c.base().is_owned(i) {
                        continue;
                    }
                    if hash(x, y, d.choose_salt) < d.forge_glow_chance {
                        c.prop(self.props[1], x, y, variant(x, y));
                    }
                }
            }
            let Some(s) = stamp_template(
                &self.template,
                f.ax,
                f.ay,
                (f.p.first().copied().unwrap_or(0) & 3) as u8,
                f.p.get(1) == Some(&1),
                c.base().w,
                c.base().h,
            ) else {
                continue;
            };
            let floor: Vec<_> = s
                .floor
                .iter()
                .copied()
                .filter(|&i| {
                    let (x, y) = (i % w, i / w);
                    !(-d.door_clear_radius..=d.door_clear_radius).any(|dy| {
                        (-d.door_clear_radius..=d.door_clear_radius)
                            .any(|dx| s.doors.contains(&((y + dy) * w + x + dx)))
                    })
                })
                .collect();
            if floor.len() < 2 {
                continue;
            }
            let a = floor[(hash(f.ax, f.ay, d.anvil_salt) * floor.len() as f64).floor() as usize];
            let mut b =
                floor[(hash(f.ay, f.ax, d.slag_salt) * floor.len() as f64).floor() as usize];
            if b == a {
                b = floor[(floor.iter().position(|&i| i == a).expect("selected floor") + 1)
                    % floor.len()];
            }
            c.prop(self.props[2], a % w, a / w, 0);
            c.prop(self.props[3], b % w, b / w, 0);
        }
        for y in bb.y..bb.y + bb.h as i32 {
            for x in bb.x..bb.x + bb.w as i32 {
                let i = (y * w + x) as usize;
                if c.base().mask[i] == 0 || c.base().tiles[i] != TILE_FLOOR {
                    continue;
                }
                let v = variant(x, y);
                if c.base().terrain[i] == self.ember {
                    if hash(x, y, d.ember_salt) < d.ember_chance {
                        c.prop(self.props[4], x, y, v);
                    }
                } else if c.base().terrain[i] == self.none && hash(x, y, d.ash_salt) < d.ash_chance
                {
                    c.prop(self.props[5], x, y, v);
                }
            }
        }
        Ok(())
    }
}
fn feature(
    kind: FeatureKind,
    job: FeatureJob,
    anchor: [i32; 2],
    params: Vec<i32>,
    blocks: Vec<(i32, BlockKind)>,
    floor: Vec<i32>,
) -> FeatureSpec {
    FeatureSpec {
        kind,
        variant: None,
        jobs: vec![job],
        anchor,
        params: Some(params),
        blocks,
        groups: None,
        floor: Some(floor),
        mode: Mode::Trim,
        min_piece: None,
        min_share_permille: None,
        min_groups: None,
    }
}
#[cfg(test)]
mod tests;
