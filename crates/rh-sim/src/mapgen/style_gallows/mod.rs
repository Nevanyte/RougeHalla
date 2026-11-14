//! Sentenced stage-six Rows. The source has no surface callback; the registry must preserve that absence.
mod detours;
mod lanes;
mod rows;
mod rules;
mod shape;
use crate::map::{TILE_FLOOR, TILE_LOW};
use crate::mapdata::{FeatureJob, FeatureKind};
use crate::mapgen::landmarks::{
    recipes::search_family::gallows,
    templates::{parse_template, stamp_template, ParsedTemplate},
};
use crate::mapgen::style_runtime::{
    noise_hash, BlockKind, Error, FeatureSpec, Mode, PropContext, ShapeContext,
};
use crate::mapgen::terrain_gate::PropKind;
pub use lanes::{Lanes, LANES};
pub use rules::{
    default_definition, default_dials, gate_open, max_gate_distance, resolve_dials, row_phase,
    visit_content, Definition, Dials, PartialDials, Route,
};
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Row {
    pub axis: u8,
    pub index: usize,
    pub phase: i32,
    pub t0: i32,
    pub tiles: Vec<i32>,
    pub posts: Vec<i32>,
    pub gates: Vec<i32>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
/// The gallows square, between base rows `k` and `k + 1`. `s` is the start of the square's window along today's rows
/// (the 3x3 itself sits at `s` plus an `offsets_s` entry). `s` counts from the `s_lo`
/// of today's grid (the centroid orientation). In signature mode `Plan::s_lo` is the lanes' grid, so when the two
/// orientations differ the plan does not carry the origin `s` counts from; `Plan::gallows` holds the tiles it wrote.
pub struct Square {
    pub k: usize,
    pub s: i32,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    /// The axis and grid origin of `rows`. Option off they are also those of `base_rows` and `square` (today's
    /// centroid orientation). In signature mode (`lanes.rs`) they are the lanes' door orientation, while `base_rows`
    /// and `square` stay in today's: a reader works each orientation out from the zone, as `validate_plan` does.
    pub axis: u8,
    pub s_lo: i32,
    pub t_lo: i32,
    pub base_rows: Vec<i32>,
    pub rows: Vec<Row>,
    pub gallows: Vec<i32>,
    pub square: Option<Square>,
    pub corridor_opened: usize,
    pub stretch: i64,
    pub repaired: usize,
    pub planned: usize,
    pub dropped: Vec<i32>,
    pub relaxed: usize,
    pub checks: usize,
    pub empty_rows: usize,
    pub houses: usize,
}
impl Default for Plan {
    fn default() -> Self {
        Self {
            axis: 0,
            s_lo: 0,
            t_lo: 0,
            base_rows: vec![],
            rows: vec![],
            gallows: vec![],
            square: None,
            corridor_opened: 0,
            stretch: 1000,
            repaired: 0,
            planned: 0,
            dropped: vec![],
            relaxed: 0,
            checks: 0,
            empty_rows: 0,
            houses: 0,
        }
    }
}
pub struct Callbacks<'a> {
    definition: Definition<'a>,
    dials: Dials,
    house: ParsedTemplate,
    props: [i32; 6],
}
impl<'a> Callbacks<'a> {
    pub fn new(
        d: &Definition<'a>,
        dials: &Dials,
        house: &gallows::Definition<'_>,
        props: &[PropKind<'_>],
    ) -> Result<Self, Error> {
        dials.validate()?;
        if !(1..=2048).contains(&d.open_run_min)
            || !(-1_000_000..=1_000_000).contains(&d.value_bias)
            || !(0..=63).contains(&d.wiggle)
            || !(0..=1_000_000).contains(&d.blocked_cost)
            || !(0..=1_000_000).contains(&d.deviation_cost)
            || !(0.0..=1_000_000.0).contains(&d.jog_cost)
            || !(3..=256).contains(&d.square_window)
            || d.offsets_s.is_empty()
            || d.offsets_s.len() > 256
            || d.offsets_t.is_empty()
            || d.offsets_t.len() > 256
            || d.offsets_s
                .iter()
                .chain(d.offsets_t)
                .any(|v| !(-1024..=1024).contains(v))
            || !(1..=64).contains(&d.square_tries)
            || !(1..=1024).contains(&d.min_piece)
            || !(0.0..=1_000_000.0).contains(&d.square_blocked_cost)
            || !(1..=6).contains(&d.route_checks)
            || d.relax_rounds > 64
            || d.plan_rounds > 64
            || !(0..=128).contains(&d.detour_reach)
            || !(1..=3).contains(&d.detour_pair_reach)
            || !(0..=64).contains(&d.repair_radius_max)
            || d.variants == 0
            || d.banner_limit > 1024
        {
            return Err(Error::Definition);
        }
        for v in [
            d.variant_salt,
            d.lantern_salt,
            d.side_salt,
            d.chain_salt,
            d.banner_salt,
        ] {
            if !v.is_finite() || v.abs() > 9007199254740991.0 {
                return Err(Error::Definition);
            }
        }
        for v in [
            d.lantern_chance,
            d.side_threshold,
            d.chain_chance,
            d.banner_chance,
        ] {
            if !(0.0..=1.0).contains(&v) {
                return Err(Error::Definition);
            }
        }
        let mut ids = [0; 6];
        for (j, key) in [
            "gate_post",
            "lantern",
            "chain",
            "gallows",
            "banner",
            "stocks",
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
            dials: dials.clone(),
            house: parse_template(house.template.build()).map_err(|_| Error::Definition)?,
            props: ids,
        })
    }
    fn validate_plan(
        &self,
        c: &crate::mapgen::style_runtime::BaseContext<'_>,
        p: &Plan,
    ) -> Result<(), Error> {
        let n = c.w * c.h;
        let good = |v: &Vec<i32>| v.len() <= n * 2 && v.iter().all(|&i| i >= 0 && (i as usize) < n);
        // Signature mode (P-LAND-SENTENCED-1): the rows are lanes in the door orientation (`plan.axis`), while the
        // base rows and the square keep today's orientation; option off both are `plan.axis`, as today.
        // The door is read again here from the zone's frame (P-MAPGEN-LANDMARK-FRAME-1), which nothing changes between
        // `shape` and `props`: it reads as it did in `shape`.
        let lanes = lanes::frame(c)?;
        let base_axis = if lanes.is_some() {
            u8::from(!shape::legacy_horizontal(c))
        } else {
            p.axis
        };
        let row_ok = |r: &Row| match &lanes {
            Some(f) => {
                r.index < n
                    && r.phase == LANES.phase
                    && f.on_line(r.t0)
                    && r.t0 >= 0
                    && (r.t0 as usize) < if p.axis == 0 { c.h } else { c.w }
            }
            None => {
                r.index < p.base_rows.len()
                    && r.t0 == p.base_rows[r.index]
                    && Some(r.phase)
                        == row_phase(
                            i32::try_from(r.index).unwrap_or(i32::MAX),
                            &self.dials.phases,
                        )
            }
        };
        if p.axis > 1
            || p.s_lo < 0
            || p.t_lo < 0
            || p.s_lo as usize >= if p.axis == 0 { c.w } else { c.h }
            || p.t_lo as usize >= if p.axis == 0 { c.h } else { c.w }
            || p.stretch < 0
            || p.checks > self.definition.route_checks
            || p.planned > 2 * n
            || p.relaxed > n
            || p.repaired > n
            || p.empty_rows > p.rows.len()
            || p.base_rows.len() > n
            || p.rows.len() > n
            || !good(&p.gallows)
            || !good(&p.dropped)
            || (!p.gallows.is_empty() && p.gallows.len() != 9)
            || lanes.is_some_and(|f| !p.rows.is_empty() && f.axis() != p.axis)
            || p.base_rows
                .iter()
                .any(|&t| t < 0 || t as usize >= if base_axis == 0 { c.h } else { c.w })
            || p.square.as_ref().is_some_and(|s| {
                s.k.checked_add(1).is_none_or(|k| k >= p.base_rows.len())
                    || s.s < 0
                    || s.s as usize >= if base_axis == 0 { c.w } else { c.h }
            })
            || p.base_rows.windows(2).any(|v| {
                let gap = i64::from(v[1]) - i64::from(v[0]);
                gap < i64::from(self.dials.gap_min) || gap > i64::from(self.dials.gap_max)
            })
            || p.rows.iter().any(|r| {
                r.axis != p.axis
                    || !row_ok(r)
                    || !good(&r.tiles)
                    || !good(&r.posts)
                    || !good(&r.gates)
            })
        {
            return Err(Error::Feature);
        }
        Ok(())
    }
    pub fn props(&self, c: &mut PropContext<'_, '_>, plan: &Plan) -> Result<(), Error> {
        self.validate_plan(&c.base(), plan)?;
        let (w, h) = (c.base().w, c.base().h);
        let noise = c.streams.noise;
        let d = &self.definition;
        let hv = |x: i32, y: i32, salt| noise_hash(noise, x as f64, y as f64, salt);
        let var3 = |x, y| (hv(x, y, d.variant_salt) * f64::from(d.variants)).floor() as u8;
        for row in &plan.rows {
            for &i in &row.tiles {
                let (x, y) = (i % w as i32, i / w as i32);
                if c.base().tiles[i as usize] != TILE_LOW {
                    continue;
                }
                if row.posts.contains(&i) {
                    c.prop(self.props[0], x, y, var3(x, y));
                    if hv(x, y, d.lantern_salt) < d.lantern_chance {
                        let (sx, sy) = if plan.axis == 0 { (0, 1) } else { (1, 0) };
                        let side = if hv(x, y, d.side_salt) < d.side_threshold {
                            -1
                        } else {
                            1
                        };
                        let (lx, ly) = (x + side * sx, y + side * sy);
                        if lx >= 0
                            && ly >= 0
                            && lx < w as i32
                            && ly < h as i32
                            && c.base().tiles[ly as usize * w + lx as usize] == TILE_FLOOR
                        {
                            c.prop(self.props[1], lx, ly, var3(lx, ly));
                        }
                    }
                } else if hv(x, y, d.chain_salt) < d.chain_chance {
                    c.prop(self.props[2], x, y, var3(x, y));
                }
            }
        }
        if !plan.gallows.is_empty() {
            let mid = plan.gallows[4];
            c.prop(
                self.props[3],
                mid % w as i32,
                mid / w as i32,
                var3(mid % w as i32, mid / w as i32),
            );
        }
        let houses: Vec<_> = c
            .base()
            .zone_features()
            .filter(|f| f.kind == FeatureKind::Landmark && f.variant == self.house.template.key)
            .cloned()
            .collect();
        for f in houses {
            let Some(s) = stamp_template(
                &self.house,
                f.ax,
                f.ay,
                (f.p.first().copied().unwrap_or(0) & 3) as u8,
                f.p.get(1) == Some(&1),
                w,
                h,
            ) else {
                continue;
            };
            let mut banners = 0;
            for i in s.walls {
                let (x, y) = (i % w as i32, i / w as i32);
                if banners < d.banner_limit
                    && (i as usize + w) < w * h
                    && c.base().tiles[i as usize + w] == TILE_FLOOR
                    && hv(x, y, d.banner_salt) < d.banner_chance
                    && c.prop(self.props[4], x, y, var3(x, y))
                {
                    banners += 1
                }
            }
            if !s.floor.is_empty() {
                let i = s.floor[s.floor.len() >> 1];
                c.prop(
                    self.props[5],
                    i % w as i32,
                    i / w as i32,
                    var3(i % w as i32, i / w as i32),
                );
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests;
