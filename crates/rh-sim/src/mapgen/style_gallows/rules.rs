//! Rows-only dials; the guard-house template, shared route limit and prop identities are borrowed.
use crate::mapgen::style_runtime::Error;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Open,
    Repair,
    None,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dials {
    pub gap_min: i32,
    pub gap_max: i32,
    pub gap_target: i32,
    pub gap_penalty: f64,
    pub period: i32,
    pub width: i32,
    pub phases: Vec<i32>,
    pub min_run: i32,
    pub squares: u8,
    pub route: Route,
}
pub fn default_dials() -> Dials {
    Dials {
        gap_min: 7,
        gap_max: 9,
        gap_target: 8,
        gap_penalty: 2.0,
        period: 12,
        width: 3,
        phases: vec![2, 8],
        min_run: 10,
        squares: 1,
        route: Route::Repair,
    }
}
fn present<'de, D: serde::Deserializer<'de>, T: serde::Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartialDials {
    #[serde(default, deserialize_with = "present")]
    pub gap_min: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub gap_max: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub gap_target: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub gap_penalty: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    pub period: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub width: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub phases: Option<Vec<i32>>,
    #[serde(default, deserialize_with = "present")]
    pub min_run: Option<i32>,
    #[serde(default, deserialize_with = "present")]
    pub squares: Option<u8>,
    #[serde(default, deserialize_with = "present")]
    pub route: Option<Route>,
}
pub fn resolve_dials(p: &PartialDials) -> Result<Dials, Error> {
    let base = default_dials();
    let phases = p.phases.clone().unwrap_or_else(|| {
        if let Some(period) = p.period {
            vec![base.phases[0], base.phases[0] + period.div_euclid(2)]
        } else {
            base.phases
        }
    });
    let d = Dials {
        gap_min: p.gap_min.unwrap_or(base.gap_min),
        gap_max: p.gap_max.unwrap_or(base.gap_max),
        gap_target: p.gap_target.unwrap_or(base.gap_target),
        gap_penalty: p.gap_penalty.unwrap_or(base.gap_penalty),
        period: p.period.unwrap_or(base.period),
        width: p.width.unwrap_or(base.width),
        phases,
        min_run: p.min_run.unwrap_or(base.min_run),
        squares: p.squares.unwrap_or(base.squares),
        route: p.route.unwrap_or(base.route),
    };
    d.validate()?;
    Ok(d)
}
impl Dials {
    pub(super) fn validate(&self) -> Result<(), Error> {
        if !(1..=64).contains(&self.gap_min)
            || !(self.gap_min..=64).contains(&self.gap_max)
            || !(0..=64).contains(&self.gap_target)
            || !(0.0..=1000.0).contains(&self.gap_penalty)
            || !(1..=64).contains(&self.period)
            || !(0..=self.period).contains(&self.width)
            || self.phases.is_empty()
            || self.phases.len() > 64
            || self.phases.iter().any(|v| !(-1024..=1024).contains(v))
            || !(1..=2048).contains(&self.min_run)
            || self.squares > 1
        {
            return Err(Error::Definition);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub open_run_min: i32,
    pub value_bias: i32,
    pub wiggle: i8,
    pub blocked_cost: i32,
    pub deviation_cost: i32,
    pub jog_cost: f64,
    pub square_window: i32,
    pub offsets_s: &'a [i32],
    pub offsets_t: &'a [i32],
    pub square_tries: usize,
    pub min_piece: usize,
    pub square_blocked_cost: f64,
    pub route_checks: usize,
    pub relax_rounds: usize,
    pub plan_rounds: usize,
    pub detour_reach: i32,
    pub detour_pair_reach: usize,
    pub repair_radius_max: i32,
    pub variant_salt: f64,
    pub variants: u8,
    pub lantern_salt: f64,
    pub lantern_chance: f64,
    pub side_salt: f64,
    pub side_threshold: f64,
    pub chain_salt: f64,
    pub chain_chance: f64,
    pub banner_salt: f64,
    pub banner_chance: f64,
    pub banner_limit: usize,
}
pub fn default_definition() -> Definition<'static> {
    Definition {
        open_run_min: 8,
        value_bias: 12,
        wiggle: 3,
        blocked_cost: 60,
        deviation_cost: 6,
        jog_cost: 12.0,
        square_window: 9,
        offsets_s: &[3, 2, 4, 1, 5],
        offsets_t: &[0, -1, 1, -2, 2],
        square_tries: 6,
        min_piece: 6,
        square_blocked_cost: 6.0,
        route_checks: 6,
        relax_rounds: 3,
        plan_rounds: 4,
        detour_reach: 14,
        detour_pair_reach: 3,
        repair_radius_max: 2,
        variant_salt: 90.0,
        variants: 3,
        lantern_salt: 5.0,
        lantern_chance: 1.0 / 3.0,
        side_salt: 6.0,
        side_threshold: 0.5,
        chain_salt: 3.0,
        chain_chance: 0.2,
        banner_salt: 2.0,
        banner_chance: 0.3,
        banner_limit: 4,
    }
}
/// Stable declaration order: resolved factory values are folded once, never shadowed by defaults.
pub fn visit_content(d: &Definition<'_>, a: &Dials, mut word: impl FnMut(u64)) {
    for v in [a.gap_min, a.gap_max, a.gap_target] {
        word(v as u64)
    }
    word(a.gap_penalty.to_bits());
    word(a.period as u64);
    word(a.width as u64);
    word(a.phases.len() as u64);
    for &v in &a.phases {
        word(v as u64)
    }
    word(a.min_run as u64);
    word(a.squares.into());
    word(match a.route {
        Route::Open => 0,
        Route::Repair => 1,
        Route::None => 2,
    });
    for v in [
        d.open_run_min,
        d.value_bias,
        i32::from(d.wiggle),
        d.blocked_cost,
        d.deviation_cost,
    ] {
        word(v as u64)
    }
    word(d.jog_cost.to_bits());
    word(d.square_window as u64);
    for v in [d.offsets_s, d.offsets_t] {
        word(v.len() as u64);
        for &x in v {
            word(x as u64)
        }
    }
    word(d.square_tries as u64);
    word(d.min_piece as u64);
    word(d.square_blocked_cost.to_bits());
    for v in [d.route_checks, d.relax_rounds, d.plan_rounds] {
        word(v as u64)
    }
    word(d.detour_reach as u64);
    word(d.detour_pair_reach as u64);
    word(d.repair_radius_max as u64);
    word(d.variant_salt.to_bits());
    word(d.variants.into());
    for v in [
        d.lantern_salt,
        d.lantern_chance,
        d.side_salt,
        d.side_threshold,
        d.chain_salt,
        d.chain_chance,
        d.banner_salt,
        d.banner_chance,
    ] {
        word(v.to_bits())
    }
    word(d.banner_limit as u64)
}
pub fn gate_open(s: i32, phase: i32, period: i32, width: i32) -> bool {
    assert!(period > 0);
    (i64::from(s) - i64::from(phase)).rem_euclid(i64::from(period)) < i64::from(width)
}
pub fn row_phase(index: i32, phases: &[i32]) -> Option<i32> {
    if phases.is_empty() {
        None
    } else {
        Some(phases[(i64::from(index)).rem_euclid(phases.len() as i64) as usize])
    }
}
pub fn max_gate_distance(period: i32, width: i32) -> f64 {
    ((f64::from(period) - f64::from(width) + 1.0) / 2.0).ceil()
}
