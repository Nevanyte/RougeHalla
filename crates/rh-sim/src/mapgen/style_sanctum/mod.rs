//! Holy stage-six callbacks: deterministic Hypostyle planning, lighting, and decorative props.
//! Landmark geometry and balance are borrowed from the accepted stage-four Sanctum definition.
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind};
use crate::mapgen::landmarks::{
    recipe_support::RecipeSupportDefinition,
    recipes::direct_family::sanctum::{self, ScanInput, ScanOptions},
    templates::{parse_template, stamp_template, ParsedTemplate, Stamp},
};
use crate::mapgen::style_runtime::{
    noise_hash, BaseContext, BlockKind, Error, FeatureSpec, Mode, PropContext, ShapeContext,
    SurfaceContext, SurfaceKind,
};
use crate::mapgen::terrain_gate::PropKind;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub line_bonus: f64,
    pub line_width_squared: f64,
    pub outer_bay_radius_min: i32,
    pub stretch_tries: u32,
    pub stretch_budget: u32,
    pub variant_salt: f64,
    pub variant_count: u8,
    pub glass_salt: f64,
    pub glass_chance: f64,
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    line_bonus: 4.0,
    line_width_squared: 16.0,
    outer_bay_radius_min: 16,
    stretch_tries: 4,
    stretch_budget: 6,
    variant_salt: 90.0,
    variant_count: 3,
    glass_salt: 5.0,
    glass_chance: 0.05,
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.line_bonus.to_bits());
    word(d.line_width_squared.to_bits());
    word(d.outer_bay_radius_min as u64);
    word(d.stretch_tries.into());
    word(d.stretch_budget.into());
    word(d.variant_salt.to_bits());
    word(d.variant_count.into());
    word(d.glass_salt.to_bits());
    word(d.glass_chance.to_bits());
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub hall: bool,
    pub cx: i32,
    pub cy: i32,
    pub axis: u8,
    pub radius: i32,
    pub piers: Vec<i32>,
    pub planned: usize,
    pub bays: Vec<i32>,
    pub lit: Vec<i32>,
    pub floor: Vec<i32>,
    pub feature: i32,
    pub stretch: i64,
    pub measures: u32,
    pub shrine_lit: u32,
}
impl Default for Plan {
    fn default() -> Self {
        Self {
            hall: false,
            cx: -1,
            cy: -1,
            axis: 0,
            radius: 0,
            piers: vec![],
            planned: 0,
            bays: vec![],
            lit: vec![],
            floor: vec![],
            feature: -1,
            stretch: 0,
            measures: 0,
            shrine_lit: 0,
        }
    }
}
/// Built once per style registry. Prop IDs are resolved from the sole shared catalog.
pub struct Callbacks<'a> {
    definition: Definition,
    hall: sanctum::Definition<'a>,
    scale: RecipeSupportDefinition,
    shrine: ParsedTemplate,
    props: [i32; 6],
}
impl<'a> Callbacks<'a> {
    pub fn new(
        d: &Definition,
        hall: &sanctum::Definition<'a>,
        scale: &RecipeSupportDefinition,
        props: &[PropKind<'_>],
    ) -> Result<Self, Error> {
        if !d.line_bonus.is_finite()
            || d.line_bonus.abs() > 1e6
            || !(0..=24).contains(&d.outer_bay_radius_min)
            || !d.line_width_squared.is_finite()
            || !(0.0..=1e6).contains(&d.line_width_squared)
            || d.stretch_tries > 62
            || d.stretch_budget < d.stretch_tries + 2
            || d.stretch_budget > 64
            || !d.variant_salt.is_finite()
            || !d.glass_salt.is_finite()
            || d.variant_count == 0
            || !(0.0..=1.0).contains(&d.glass_chance)
            || hall.hall_pitch != 6
            || hall.radius_min < 0
            || hall.radius_max > 24
            || hall.radius_min > hall.radius_max
            || !hall.radius_ref.is_finite()
            || hall.radius_ref < 0.0
            || hall.min_piers == 0
            || hall.min_piers > 64
            || !hall.pier_score.is_finite()
            || !scale.ref_zone_tiles.is_finite()
            || scale.ref_zone_tiles <= 0.0
        {
            return Err(Error::Definition);
        }
        let mut ids = [0; 6];
        for (j, key) in [
            "column_cap",
            "candelabra",
            "stained_glass",
            "altar",
            "brazier",
            "banner_red",
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
        Ok(Self {
            definition: *d,
            hall: *hall,
            scale: *scale,
            shrine: parse_template(hall.template.build()).map_err(|_| Error::Definition)?,
            props: ids,
        })
    }
    pub fn shape(&self, c: &mut ShapeContext<'_, '_>) -> Result<Plan, Error> {
        let b = c.base();
        let (w, h) = (b.w as i32, b.h as i32);
        let axis = sanctum::hall_axis(b.zone);
        let r = sanctum::hall_radius(&self.hall, &self.scale, b.zone.painted);
        let shrines: Vec<_> = b
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.shrine.template.key)
            .collect();
        let line = if shrines.len() == 2 {
            let a = shrines[0].bbox;
            let z = shrines[1].bbox;
            Some([
                2.0 * a.x as f64 + a.w as f64,
                2.0 * a.y as f64 + a.h as f64,
                2.0 * z.x as f64 + z.w as f64,
                2.0 * z.y as f64 + z.h as f64,
            ])
        } else {
            None
        };
        let best = sanctum::scan_centre(
            ScanInput {
                w: b.w,
                h: b.h,
                zone: b.zone,
                mask: b.mask,
                tiles: b.tiles,
                hard: b.hard,
            },
            &self.hall,
            ScanOptions {
                axis,
                radius: r,
                line,
                line_bonus: self.definition.line_bonus,
                line_width_squared: self.definition.line_width_squared,
            },
            |i| c.open(i),
            |_, _, _, _| {},
        );
        if best.k == 0 {
            return Ok(Plan::default());
        }
        let (cx, cy) = (best.x, best.y);
        let layout = layout(&self.hall, r, self.definition.outer_bay_radius_min);
        let mut kept: Vec<_> = layout
            .piers
            .iter()
            .filter_map(|&[u, v]| {
                let (x, y) = offset(cx, cy, axis, u, v);
                (x >= 0 && y >= 0 && x < w && y < h && best.win[(y * w + x) as usize] != 0)
                    .then_some(y * w + x)
            })
            .collect();
        let has_members = !c.route_guard().members().is_empty();
        let (mut stretch, mut measures) = (0, 0);
        if has_members {
            while measures < self.definition.stretch_tries {
                stretch = c.worst_stretch(&pier_tiles(&kept, w));
                measures += 1;
                if stretch <= i64::from(c.caps().route_stretch_max) {
                    break;
                }
                let g = c.route_guard();
                let mut touch = vec![false; (w * h) as usize];
                for &i in g.corridor_of(g.worst_member()) {
                    touch[i as usize] = true;
                }
                let next: Vec<_> = kept
                    .iter()
                    .copied()
                    .filter(|&k| {
                        !(0..3).any(|dy| (0..3).any(|dx| touch[(k + dy * w + dx) as usize]))
                    })
                    .collect();
                if next.len() == kept.len() || next.len() < self.hall.min_piers {
                    break;
                }
                kept = next;
            }
            if stretch > i64::from(c.caps().route_stretch_max) {
                let corridor = c.route_guard().corridor();
                let next: Vec<_> = kept
                    .iter()
                    .copied()
                    .filter(|&k| {
                        !(0..3).any(|dy| (0..3).any(|dx| corridor[(k + dy * w + dx) as usize] == 1))
                    })
                    .collect();
                if next.len() >= self.hall.min_piers {
                    kept = next;
                    stretch = c.worst_stretch(&pier_tiles(&kept, w));
                    measures += 1;
                }
            }
        }
        if kept.len() < self.hall.min_piers {
            return Ok(Plan::default());
        }
        let b = c.base();
        let tile = |[u, v]: [i32; 2]| {
            let (x, y) = offset(cx, cy, axis, u, v);
            b.at(x, y)
        };
        let floor: Vec<_> = layout
            .floor
            .iter()
            .copied()
            .map(tile)
            .filter(|&i| {
                i >= 0 && b.mask[i as usize] == 1 && b.hard[i as usize] == 0 && !b.is_owned(i)
            })
            .collect();
        let bays: Vec<_> = layout
            .bays
            .iter()
            .copied()
            .map(tile)
            .filter(|&i| {
                i >= 0
                    && b.mask[i as usize] == 1
                    && b.hard[i as usize] == 0
                    && !b.is_owned(i)
                    && b.tiles[i as usize] == TILE_FLOOR
                    && b.terrain[i as usize] == 0
            })
            .collect();
        let blocks = pier_tiles(&kept, w)
            .into_iter()
            .map(|i| (i, BlockKind::Wall))
            .collect();
        let groups = (0..kept.len())
            .flat_map(|g| std::iter::repeat_n(g as i32, 9))
            .collect();
        let placed = c.place_feature(&FeatureSpec {
            kind: FeatureKind::Hall,
            variant: None,
            jobs: vec![FeatureJob::Cover, FeatureJob::Rest],
            anchor: [cx, cy],
            params: Some(vec![
                i32::from(axis),
                self.hall.hall_pitch,
                r,
                kept.len() as i32,
                bays.len() as i32,
            ]),
            blocks,
            groups: Some(groups),
            floor: Some(floor.clone()),
            mode: Mode::Groups,
            min_piece: None,
            min_share_permille: None,
            min_groups: Some(self.hall.min_piers as u32),
        })?;
        let Some(placed) = placed else {
            return Ok(Plan::default());
        };
        let piers: Vec<_> = kept
            .iter()
            .filter(|&&i| c.base().tiles[i as usize] == TILE_WALL)
            .map(|i| i + w + 1)
            .collect();
        if piers.len() != kept.len() {
            c.set_hall_pier_count(placed.id, piers.len() as u32)?;
            if has_members && measures < self.definition.stretch_budget {
                stretch = c.worst_stretch(&[]);
                measures += 1;
            }
        }
        Ok(Plan {
            hall: true,
            cx,
            cy,
            axis: u8::from(axis),
            radius: r,
            piers,
            planned: kept.len(),
            bays,
            lit: vec![],
            floor,
            feature: placed.id as i32,
            stretch,
            measures,
            shrine_lit: 0,
        })
    }
    fn stamps(&self, b: BaseContext<'_>) -> Vec<Stamp> {
        b.zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.shrine.template.key)
            .filter_map(|f| {
                stamp_template(
                    &self.shrine,
                    f.ax,
                    f.ay,
                    (f.p.first().copied().unwrap_or(0) & 3) as u8,
                    f.p.get(1) == Some(&1),
                    b.w,
                    b.h,
                )
            })
            .collect()
    }
    fn admit(&self, b: BaseContext<'_>, p: &Plan) -> Result<(), Error> {
        let n = (b.w * b.h) as i32;
        if p.stretch < 0
            || p.axis > 1
            || p.measures > self.definition.stretch_budget
            || p.shrine_lit > n as u32
            || p.piers
                .iter()
                .chain(&p.bays)
                .chain(&p.lit)
                .chain(&p.floor)
                .any(|&i| i < 0 || i >= n)
            || p.lit.iter().any(|i| !p.bays.contains(i))
        {
            return Err(Error::Feature);
        }
        if p.hall {
            if p.feature < 0
                || p.feature > u16::MAX as i32
                || p.planned > 64
                || p.piers.len() < self.hall.min_piers
                || p.cx < 0
                || p.cy < 0
                || p.cx >= b.w as i32
                || p.cy >= b.h as i32
                || p.radius < self.hall.radius_min
                || p.radius > self.hall.radius_max
                || p.planned < self.hall.min_piers
                || p.piers.len() > p.planned
                || !b
                    .zone_features()
                    .any(|f| f.kind == FeatureKind::Hall && f.ax == p.cx && f.ay == p.cy)
            {
                return Err(Error::Feature);
            }
        } else if p.cx != -1
            || p.cy != -1
            || p.axis != 0
            || p.radius != 0
            || !p.piers.is_empty()
            || p.planned != 0
            || !p.bays.is_empty()
            || !p.lit.is_empty()
            || !p.floor.is_empty()
            || p.feature != -1
            || p.stretch != 0
            || p.measures != 0
        {
            return Err(Error::Feature);
        }
        Ok(())
    }
    pub fn surface(&self, c: &mut SurfaceContext<'_, '_>, p: &mut Plan) -> Result<(), Error> {
        self.admit(c.base(), p)?;
        let w = c.base().w as i32;
        let shrines = self.stamps(c.base());
        let mut theirs = vec![false; c.base().w * c.base().h];
        for s in &shrines {
            for &i in s
                .walls
                .iter()
                .chain(&s.floor)
                .chain(&s.doors)
                .chain(&s.nooks)
                .chain(&s.lights)
            {
                theirs[i as usize] = true;
            }
        }
        for &centre in &p.bays {
            let (x, y) = (centre % w, centre / w);
            let mut n = 0;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let i = c.base().at(x + dx, y + dy);
                    if (i < 0 || !theirs[i as usize]) && c.surface(i, SurfaceKind::Light) {
                        n += 1;
                    }
                }
            }
            if n > 0 {
                p.lit.push(centre);
            }
        }
        for s in &shrines {
            for &i in &s.lights {
                if c.surface(i, SurfaceKind::Light) {
                    p.shrine_lit += 1;
                }
            }
        }
        Ok(())
    }
    pub fn props(&self, c: &mut PropContext<'_, '_>, p: &Plan) -> Result<(), Error> {
        self.admit(c.base(), p)?;
        let w = c.base().w as i32;
        let noise = c.streams.noise;
        let d = &self.definition;
        let put = |c: &mut PropContext<'_, '_>, kind, i: i32| {
            let (x, y) = (i % w, i / w);
            let v = (noise_hash(noise, x as f64, y as f64, d.variant_salt)
                * f64::from(d.variant_count))
            .floor() as u8;
            c.prop(kind, x, y, v);
        };
        if p.hall {
            for &i in &p.piers {
                put(c, self.props[0], i);
            }
            for &i in &p.lit {
                put(c, self.props[1], i);
            }
            for &i in &p.floor {
                if noise_hash(noise, (i % w) as f64, (i / w) as f64, d.glass_salt) < d.glass_chance
                {
                    put(c, self.props[2], i);
                }
            }
        }
        for s in self.stamps(c.base()) {
            for (kind, i) in [
                (self.props[3], s.lights.get(4)),
                (self.props[4], s.floor.get(1)),
                (self.props[4], s.floor.get(3)),
                (self.props[5], s.walls.get(3)),
                (self.props[5], s.walls.get(4)),
                (self.props[5], s.walls.get(5)),
            ] {
                if let Some(&i) = i {
                    put(c, kind, i);
                }
            }
        }
        Ok(())
    }
}
fn offset(cx: i32, cy: i32, axis: bool, u: i32, v: i32) -> (i32, i32) {
    if axis {
        (cx + v, cy + u)
    } else {
        (cx + u, cy + v)
    }
}
fn pier_tiles(corners: &[i32], w: i32) -> Vec<i32> {
    corners
        .iter()
        .flat_map(|&k| (0..3).flat_map(move |dy| (0..3).map(move |dx| k + dy * w + dx)))
        .collect()
}
struct Layout {
    piers: Vec<[i32; 2]>,
    floor: Vec<[i32; 2]>,
    bays: Vec<[i32; 2]>,
}
fn layout(d: &sanctum::Definition<'_>, r: i32, outer_bay_radius_min: i32) -> Layout {
    let piers = sanctum::piers(d, r);
    let mut mark = vec![false; 49 * 49];
    for v in -24..=24 {
        for u in -24..=24 {
            if u * u + v * v <= r * r {
                mark[((v + 24) * 49 + u + 24) as usize] = true;
            }
        }
    }
    for &[u, v] in &piers {
        for dy in 0..3 {
            for dx in 0..3 {
                mark[((v + dy + 24) * 49 + u + dx + 24) as usize] = true;
            }
        }
    }
    let floor = (-24..=24)
        .flat_map(|v| (-24..=24).map(move |u| [u, v]))
        .filter(|&[u, v]| mark[((v + 24) * 49 + u + 24) as usize])
        .collect();
    let pitch = d.hall_pitch;
    let mut bays = vec![[0, 0], [pitch, 0], [-pitch, 0], [0, pitch], [0, -pitch]];
    if r >= outer_bay_radius_min {
        bays.extend([
            [2 * pitch, 0],
            [-2 * pitch, 0],
            [0, 2 * pitch],
            [0, -2 * pitch],
        ]);
    }
    Layout { piers, floor, bays }
}
#[cfg(test)]
mod tests;
