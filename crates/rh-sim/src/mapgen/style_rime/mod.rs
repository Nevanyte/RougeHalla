//! Frost stage-six callbacks. All writes use the guarded phase-specific runtime.
mod lakes;
mod routes;
mod rules;
mod shape;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature};
use crate::mapgen::{
    coliseum::{FixedDefinition, FixedLayout, GateSide},
    landmarks::recipes::direct_family::rime,
    style_runtime::{
        noise_hash, BaseContext, BlockKind, Error, FeatureSpec, Mode, PropContext, ShapeContext,
        SurfaceContext, SurfaceKind,
    },
    terrain_gate::{PropKind, TerrainKind},
};
pub use rules::{default_definition, visit_content, Definition};
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LakePlan {
    pub index: usize,
    pub seed: i32,
    pub clr: i32,
    pub tiles: Vec<i32>,
    pub grown: usize,
    pub ice: usize,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShelfPlan {
    pub lake: usize,
    pub centre: i32,
    pub dir: u8,
    pub spire: bool,
    pub walls: Vec<i32>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub lakes: Vec<LakePlan>,
    pub shelves: Vec<ShelfPlan>,
    pub causeway: Vec<i32>,
    pub routed: usize,
}
pub struct Callbacks<'a> {
    definition: Definition,
    shared: rime::Definition<'a>,
    fixed: &'a FixedLayout,
    ring_clear: i32,
    props: [i32; 6],
    ice: u8,
}
impl<'a> Callbacks<'a> {
    pub fn new(
        d: &Definition,
        shared: &rime::Definition<'a>,
        fixed: &'a FixedLayout,
        fixed_rules: &FixedDefinition<'_>,
        props: &[PropKind<'_>],
        terrain: &[TerrainKind],
    ) -> Result<Self, Error> {
        if !d.validate()
            || fixed.dist_fp.is_empty()
            || fixed.dist_fp.len() > 2_097_152
            || fixed.gates.len() != 4
            || fixed
                .gates
                .iter()
                .zip([
                    GateSide::North,
                    GateSide::East,
                    GateSide::South,
                    GateSide::West,
                ])
                .any(|(g, side)| {
                    g.side != side
                        || !g.x.is_finite()
                        || !g.y.is_finite()
                        || !(0.0..2048.0 * crate::constants::TILE).contains(&g.x)
                        || !(0.0..2048.0 * crate::constants::TILE).contains(&g.y)
                })
            || fixed.painted_mask.len() != fixed.dist_fp.len()
            || fixed.ring.len() != fixed.dist_fp.len()
            || shared.margin_camp < 0
            || shared.margin_edge < 0
            || shared.margin_ring < 0
            || shared.margin_landmark < 0
            || shared.margin_camp > 100000
            || shared.margin_edge > 100000
            || shared.margin_ring > 100000
            || shared.margin_landmark > 100000
            || shared.second_sep2 < 0
            || shared.second_sep2 > 1000000
        {
            return Err(Error::Definition);
        }
        let mut ids = [0; 6];
        for (j, key) in [
            "ice_spire",
            "icicle",
            "snow_drift",
            "frost_sparkle",
            "ice_crack",
            "tower_frost",
        ]
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
        let matches: Vec<_> = terrain
            .iter()
            .enumerate()
            .filter(|(_, t)| t.key == "ice")
            .collect();
        if matches.len() != 1 {
            return Err(Error::Metadata);
        }
        let ice = u8::try_from(matches[0].0).map_err(|_| Error::Metadata)?;
        Ok(Self {
            definition: *d,
            shared: *shared,
            fixed,
            ring_clear: i32::from(fixed_rules.ring_road) + d.ring_extra,
            props: ids,
            ice,
        })
    }
    pub(crate) fn admit_dimensions(&self, w: usize, h: usize) -> Result<(), Error> {
        if w > 2048 || h > 2048 {
            return Err(Error::Dimensions);
        }
        if self.fixed.dist_fp.len() == w * h {
            for g in &self.fixed.gates {
                let (ox, oy) = match g.side {
                    GateSide::North => (0.0, -self.definition.gate_mouth_offset),
                    GateSide::East => (self.definition.gate_mouth_offset, 0.0),
                    GateSide::South => (0.0, self.definition.gate_mouth_offset),
                    GateSide::West => (-self.definition.gate_mouth_offset, 0.0),
                };
                let (x, y) = (g.x / crate::constants::TILE, g.y / crate::constants::TILE);
                if !(0.0..w as f64).contains(&x)
                    || !(0.0..h as f64).contains(&y)
                    || !(0.0..w as f64).contains(&(x + ox))
                    || !(0.0..h as f64).contains(&(y + oy))
                {
                    return Err(Error::Definition);
                }
            }
        }
        Ok(())
    }
    fn admit_geometry(&self, b: &BaseContext<'_>) -> Result<(), Error> {
        self.admit_dimensions(b.w, b.h)
    }
    pub(crate) fn admit_inputs<'input>(
        &self,
        w: usize,
        h: usize,
        features: impl Iterator<Item = &'input MapFeature>,
    ) -> Result<(), Error> {
        self.admit_dimensions(w, h)?;
        for f in features
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.shared.template.key)
        {
            if f.bbox.x < 0
                || f.bbox.y < 0
                || f.bbox.w == 0
                || f.bbox.h == 0
                || i64::from(f.bbox.x) + i64::from(f.bbox.w) > w as i64
                || i64::from(f.bbox.y) + i64::from(f.bbox.h) > h as i64
            {
                return Err(Error::Feature);
            }
        }
        Ok(())
    }
    fn admit(&self, b: &BaseContext<'_>, p: &Plan) -> Result<(), Error> {
        self.admit_inputs(b.w, b.h, b.zone_features())?;
        let n = b.w * b.h;
        let index = |i: i32| i >= 0 && (i as usize) < n;
        if p.lakes.len() > 2
            || p.shelves.len() > 2 * (self.definition.headlands + 1)
            || p.routed > b.spawns.len()
            || p.causeway.len() > n
            || p.causeway.iter().any(|&i| !index(i))
        {
            return Err(Error::Feature);
        }
        for (k, l) in p.lakes.iter().enumerate() {
            if l.index != k
                || !index(l.seed)
                || l.grown > n
                || l.grown < self.definition.lake_min
                || l.tiles.len() > n
                || l.ice > l.tiles.len()
                || l.tiles.iter().any(|&i| !index(i))
                || l.tiles.windows(2).any(|p| p[0] >= p[1])
            {
                return Err(Error::Feature);
            }
        }
        for s in &p.shelves {
            if s.lake >= p.lakes.len()
                || !index(s.centre)
                || s.dir > 15
                || (s.spire && s.dir != 0)
                || s.walls.len() > n
                || s.walls.iter().any(|&i| !index(i))
            {
                return Err(Error::Feature);
            }
        }
        Ok(())
    }
    pub fn shape(&self, c: &mut ShapeContext<'_, '_>) -> Result<Plan, Error> {
        shape::run(self, c)
    }
    pub fn surface(&self, c: &mut SurfaceContext<'_, '_>, p: &mut Plan) -> Result<(), Error> {
        self.admit(&c.base(), p)?;
        let ring =
            (self.fixed.dist_fp.len() == c.base().w * c.base().h).then_some(&self.fixed.dist_fp);
        for lake in &mut p.lakes {
            let mut ice = 0;
            for &i in &lake.tiles {
                if ring.is_some_and(|r| i32::from(r[i as usize]) <= self.ring_clear) {
                    continue;
                }
                if c.surface(i, SurfaceKind::Ice) {
                    ice += 1;
                }
            }
            lake.ice = ice;
        }
        Ok(())
    }
    pub fn props(&self, c: &mut PropContext<'_, '_>, p: &Plan) -> Result<(), Error> {
        self.admit(&c.base(), p)?;
        let w = c.base().w as i32;
        let noise = c.streams.noise;
        let d = &self.definition;
        let variant = |x: i32, y: i32| {
            (noise_hash(noise, x as f64, y as f64, d.variant_salt) * f64::from(d.variant_count))
                .floor() as u8
        };
        for sh in &p.shelves {
            for &i in &sh.walls {
                let (x, y) = (i % w, i / w);
                let u = noise_hash(noise, x as f64, y as f64, d.shelf_prop_salt);
                if sh.spire {
                    if i == sh.centre || u < d.spire_prop_chance {
                        c.prop(self.props[0], x, y, variant(x, y));
                    }
                } else if u < d.icicle_chance {
                    c.prop(self.props[1], x, y, variant(x, y));
                }
            }
            if !sh.spire {
                let (cx, cy) = (sh.centre % w, sh.centre / w);
                for dy in -d.drift_radius..=d.drift_radius {
                    for dx in -d.drift_radius..=d.drift_radius {
                        let (x, y) = (cx + dx, cy + dy);
                        if noise_hash(noise, x as f64, y as f64, d.drift_salt) < d.drift_chance {
                            c.prop(self.props[2], x, y, variant(x, y));
                        }
                    }
                }
            }
        }
        for lake in &p.lakes {
            for &i in &lake.tiles {
                if c.base().terrain[i as usize] != self.ice {
                    continue;
                }
                let (x, y) = (i % w, i / w);
                let u = noise_hash(noise, x as f64, y as f64, d.ice_prop_salt) * d.ice_prop_scale;
                if u < d.sparkle_bound {
                    c.prop(self.props[3], x, y, variant(x, y));
                } else if u < d.crack_bound {
                    c.prop(self.props[4], x, y, variant(x, y));
                }
            }
        }
        let boxes: Vec<_> = c
            .base()
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.shared.template.key)
            .map(|f| f.bbox)
            .collect();
        for bb in boxes {
            for y in bb.y..bb.y + bb.h as i32 {
                for x in bb.x..bb.x + bb.w as i32 {
                    let i = y as usize * c.base().w + x as usize;
                    if c.base().tiles[i] == TILE_WALL
                        && noise_hash(noise, x as f64, y as f64, d.tower_prop_salt) < d.tower_chance
                    {
                        c.prop(self.props[5], x, y, variant(x, y));
                    }
                }
            }
        }
        Ok(())
    }
}
fn field_input<'a>(b: &'a BaseContext<'_>, fixed: &'a FixedLayout) -> rime::FieldInput<'a> {
    rime::FieldInput {
        w: b.w,
        h: b.h,
        zone: b.zone,
        mask: b.mask,
        tiles: b.tiles,
        hard: b.hard,
        camps: b.camps,
        ring: &fixed.ring,
    }
}
#[cfg(test)]
mod tests;
