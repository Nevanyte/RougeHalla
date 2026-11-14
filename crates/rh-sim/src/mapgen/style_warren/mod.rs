//! Plague stage-six Barrows callbacks. Landmark selection remains in the accepted stage-four recipe.
mod planning;
mod pools;
mod rules;
mod shape;
mod walk;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind};
use crate::mapgen::coliseum::{FixedDefinition, FixedLayout};
use crate::mapgen::landmarks::{
    recipe_support::{camp_nodes_from, CampNodeInputs, RecipeSupportDefinition},
    recipes::direct_family::warren,
    templates::{parse_template, stamp_template, ParsedTemplate},
};
use crate::mapgen::style_runtime::{
    noise_hash, BlockKind, Error, FeatureSpec, Mode, PropContext, ShapeContext, SurfaceContext,
    SurfaceKind,
};
use crate::mapgen::terrain_gate::PropKind;
pub use rules::{default_definition, visit_content, Definition};
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub barrows: Vec<Barrow>,
    pub tunnels: Vec<Vec<i32>>,
    pub crescent: Vec<i32>,
    pub mouths: Vec<i32>,
    pub bog: Vec<i32>,
    pub roads: usize,
    pub placed: usize,
    /// Signature mode only (P-LAND-PLAGUE-1): the free bog pools' tiles, each owned by its `BogPool` feature. Empty,
    /// and absent from the serialized plan, with the option off.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pools: Vec<i32>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Barrow {
    pub id: usize,
    pub cx: i32,
    pub cy: i32,
    pub r4: i32,
    pub tunnel: bool,
    pub dir16: usize,
    pub wet: i32,
    pub walls: Vec<i32>,
    pub slot: Vec<i32>,
    pub crescent: Vec<i32>,
}
/// Borrowed common scale/layout/recipe definitions remain their existing owners' authority.
pub struct Callbacks<'a> {
    definition: Definition<'a>,
    scale: RecipeSupportDefinition,
    fixed: &'a FixedLayout,
    fixed_rules: &'a FixedDefinition<'a>,
    burrow: ParsedTemplate,
    props: [i32; 5],
}
impl<'a> Callbacks<'a> {
    pub fn new(
        d: &Definition<'a>,
        scale: &RecipeSupportDefinition,
        fixed: &'a FixedLayout,
        fixed_rules: &'a FixedDefinition<'a>,
        burrow: &warren::Definition<'_>,
        props: &[PropKind<'_>],
    ) -> Result<Self, Error> {
        if !scale.ref_zone_tiles.is_finite()
            || scale.ref_zone_tiles <= 0.0
            || d.r4_min < 1
            || d.r4_max > 64
            || d.r4_min > d.r4_max
            || d.r4_tunnel < d.r4_min
            || d.r4_tunnel > d.r4_max
            || d.radius_shrink <= 0
            || d.route_tries > 64
            || d.clip_max > 1_000_000
            || d.bog_min_piece == 0
            || d.bog_min_piece > 2_097_152
            || d.variants == 0
            || d.camp_window < 0
            || d.camp_window > 1024
            || d.member_gap4 < 0
            || d.member_gap4 > 1024
            || !(0..=1000).contains(&d.accept_permille)
            || !(0..=1_000_000).contains(&d.score_across)
            || d.score_along_divisor <= 0
            || d.t_permille.is_empty()
            || d.t_permille.len() > 1024
            || d.across.is_empty()
            || d.across.len() > 1024
            || d.t_permille.iter().any(|v| !(0..=1000).contains(v))
            || d.across.iter().any(|v| !(-1024..=1024).contains(v))
            || [d.crescent_inner20, d.crescent_outer20, d.crescent_along4]
                .iter()
                .any(|v| !(0..=1024).contains(v))
        {
            return Err(Error::Definition);
        }
        for v in [
            d.barrows_per_ref,
            d.tunnels_per_ref,
            d.road_min2,
            d.pad_camp10,
            d.pad_door10,
            d.bog_camp_gap,
            d.burrow_road_near2,
            d.radius_length,
            d.jitter_cell,
            d.jitter_scale,
            d.jitter_divisor,
            d.wet_cell,
            d.slot_width_squared,
        ] {
            if !v.is_finite() || !(0.0..=1e6).contains(&v) {
                return Err(Error::Definition);
            }
        }
        // rockScan's reach and clipsWithin's guaranteed/possible discs require the source ±3 envelope.
        // noiseQ is 0..1023, so 512 is the largest magnitude about its fixed midpoint.
        let jitter_extent = 512.0 * d.jitter_scale / d.jitter_divisor;
        if !jitter_extent.is_finite() || jitter_extent >= 3.5 {
            return Err(Error::Definition);
        }
        if d.jitter_cell <= 0.0
            || d.wet_cell <= 0.0
            || d.jitter_divisor <= 0.0
            || d.crescent_inner20 > d.crescent_outer20
        {
            return Err(Error::Definition);
        }
        for v in [
            d.jitter_salt,
            d.wet_salt,
            d.wet_threshold,
            d.wall_variant_salt,
            d.wall_salt,
            d.reed_salt,
            d.reed_variant_salt,
            d.rubble_salt,
            d.rubble_variant_salt,
        ] {
            if !v.is_finite() || v.abs() > 9007199254740991.0 {
                return Err(Error::Definition);
            }
        }
        for v in [
            d.fungus_chance,
            d.drip_chance,
            d.reed_chance,
            d.rubble_chance,
        ] {
            if !(0.0..=1.0).contains(&v) {
                return Err(Error::Definition);
            }
        }
        let mut ids = [0; 5];
        for (j, key) in ["tunnel_beam", "fungus_cap", "drip", "reed", "burrow_rubble"]
            .iter()
            .enumerate()
        {
            let matches: Vec<_> = props
                .iter()
                .enumerate()
                .filter(|(_, p)| p.key == *key)
                .collect();
            if matches.len() != 1 {
                return Err(Error::Metadata);
            }
            ids[j] = i32::try_from(matches[0].0).map_err(|_| Error::Metadata)?;
        }
        Ok(Self {
            definition: *d,
            scale: *scale,
            fixed,
            fixed_rules,
            burrow: parse_template(burrow.template.build()).map_err(|_| Error::Definition)?,
            props: ids,
        })
    }
    fn validate_plan(
        &self,
        c: &crate::mapgen::style_runtime::BaseContext<'_>,
        p: &Plan,
    ) -> Result<(), Error> {
        let n = c.w * c.h;
        let valid = |i: &i32| *i >= 0 && (*i as usize) < n;
        if p.placed != p.barrows.len()
            || p.barrows.len() > n
            || p.roads > n
            || p.tunnels.len() > p.barrows.len()
            || [&p.crescent, &p.mouths, &p.bog, &p.pools]
                .iter()
                .any(|v| v.len() > n || v.iter().any(|i| !valid(i)))
            || p.tunnels
                .iter()
                .any(|v| v.len() > n || v.iter().any(|i| !valid(i)))
        {
            return Err(Error::Feature);
        }
        for b in &p.barrows {
            if b.id >= u16::MAX as usize
                || b.cx < 0
                || b.cy < 0
                || b.cx as usize >= c.w
                || b.cy as usize >= c.h
                || !(self.definition.r4_min..=self.definition.r4_max).contains(&b.r4)
                || b.dir16 >= 16
                || ![-1, 1].contains(&b.wet)
                || [&b.walls, &b.slot, &b.crescent]
                    .iter()
                    .any(|v| v.len() > n || v.iter().any(|i| !valid(i)))
            {
                return Err(Error::Feature);
            }
        }
        Ok(())
    }
    pub fn surface(&self, c: &mut SurfaceContext<'_, '_>, plan: &mut Plan) -> Result<(), Error> {
        self.validate_plan(&c.base(), plan)?;
        for &i in plan.crescent.iter().chain(&plan.pools) {
            if c.base().is_owned(i) && c.surface(i, SurfaceKind::Bog) {
                plan.bog.push(i)
            }
        }
        Ok(())
    }
    pub fn props(&self, c: &mut PropContext<'_, '_>, plan: &Plan) -> Result<(), Error> {
        self.validate_plan(&c.base(), plan)?;
        let d = &self.definition;
        let w = c.base().w;
        let noise = c.streams.noise;
        let variant =
            |x, y, salt| (noise_hash(noise, x, y, salt) * f64::from(d.variants)).floor() as u8;
        for bar in &plan.barrows {
            for &i in &bar.walls {
                let (x, y) = (i % w as i32, i / w as i32);
                let v = variant(x as f64, y as f64, d.wall_variant_salt);
                if plan.mouths.contains(&i) {
                    c.prop(self.props[0], x, y, v);
                    continue;
                }
                let u = noise_hash(noise, x as f64, y as f64, d.wall_salt);
                if u < d.fungus_chance {
                    c.prop(self.props[1], x, y, v);
                } else if u < d.drip_chance {
                    c.prop(self.props[2], x, y, v);
                }
            }
        }
        for &i in &plan.bog {
            let (x, y) = (i % w as i32, i / w as i32);
            if noise_hash(noise, x as f64, y as f64, d.reed_salt) >= d.reed_chance {
                continue;
            }
            let base = c.base();
            if [i - 1, i + 1, i - w as i32, i + w as i32]
                .into_iter()
                .any(|j| {
                    j >= 0
                        && (j as usize) < base.tiles.len()
                        && base.tiles[j as usize] == TILE_FLOOR
                        && base.terrain[j as usize] == 0
                })
            {
                c.prop(
                    self.props[3],
                    x,
                    y,
                    variant(x as f64, y as f64, d.reed_variant_salt),
                );
            }
        }
        let features: Vec<_> = c
            .base()
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.burrow.template.key)
            .cloned()
            .collect();
        for f in features {
            let Some(s) = stamp_template(
                &self.burrow,
                f.ax,
                f.ay,
                (f.p.first().copied().unwrap_or(0) & 3) as u8,
                f.p.get(1) == Some(&1),
                w,
                c.base().h,
            ) else {
                continue;
            };
            for i in s.floor {
                let (x, y) = (i % w as i32, i / w as i32);
                if noise_hash(noise, x as f64, y as f64, d.rubble_salt) < d.rubble_chance {
                    c.prop(
                        self.props[4],
                        x,
                        y,
                        variant(x as f64, y as f64, d.rubble_variant_salt),
                    );
                }
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests;
