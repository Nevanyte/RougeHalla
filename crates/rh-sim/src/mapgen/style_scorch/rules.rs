//! Callback policy only. Forge template/radius, generic path/graph geometry and runtime caps are shared.
trait Words: Copy {
    fn visit(self, word: &mut impl FnMut(u64));
    fn bounded(self) -> bool;
}
impl Words for f64 {
    fn visit(self, w: &mut impl FnMut(u64)) {
        w(self.to_bits());
    }
    fn bounded(self) -> bool {
        self.is_finite() && self.abs() <= 1_000_000.0
    }
}
impl Words for i32 {
    fn visit(self, w: &mut impl FnMut(u64)) {
        w(self as u64);
    }
    fn bounded(self) -> bool {
        i64::from(self).abs() <= 10_000
    }
}
impl Words for usize {
    fn visit(self, w: &mut impl FnMut(u64)) {
        w(self as u64);
    }
    fn bounded(self) -> bool {
        self <= 10_000
    }
}
impl<T: Words, const N: usize> Words for [T; N] {
    fn visit(self, w: &mut impl FnMut(u64)) {
        for x in self {
            x.visit(w)
        }
    }
    fn bounded(self) -> bool {
        self.into_iter().all(Words::bounded)
    }
}
macro_rules! rules {
 ($name:ident {$($field:ident:$ty:ty=$value:expr),* $(,)?})=>{
  #[derive(Clone,Copy,Debug,PartialEq,serde::Serialize,serde::Deserialize)]
  #[serde(rename_all="camelCase",deny_unknown_fields)]
  pub struct $name {$(pub $field:$ty),*}
  impl Default for $name {fn default()->Self{Self{$($field:$value),*}}}
  impl $name {pub(super) fn visit(&self,w:&mut impl FnMut(u64)){$(self.$field.visit(w);)*}pub(super) fn bounded(&self)->bool{true$(&&self.$field.bounded())*}}
 };
}
rules!(CraterRules {
    stretch_max: i32 = 1050,
    breach_half4: f64 = 9.0,
    breaches_min: usize = 2,
    breaches_max: usize = 3,
    breach_separation: i32 = 3,
    radius_shrink4: [i32; 2] = [4, 8],
    frontier_breaches: usize = 1,
    freer_permille: i32 = 30,
    rim_keep_permille: i32 = 600,
    rim_min: usize = 8,
    frontier_edge: i32 = 9,
    frontier_min: usize = 8,
    second_tile_q: f64 = 716.0,
    loop_ratio: f64 = 1.8,
    loop_max_len: f64 = 30.0,
    raster_padding: f64 = 2.4,
    jitter_cell: f64 = 3.0,
    jitter_salt: f64 = 41.0,
    jitter_strength: f64 = 1.1,
    second_cell: f64 = 5.0,
    second_salt: f64 = 77.0,
    band_min: usize = 12,
    band_end_samples: usize = 9,
    guard_iterations: usize = 4,
    breach_near: i32 = 3,
    rim_floor_min: usize = 10,
    stretch_breach_tries: usize = 2
});
rules!(RiverRules {
    ford_steps: usize = 4,
    ford_spacing: usize = 9,
    ford_merge: usize = 4,
    ford_max_len: usize = 12,
    ford_per_steps: f64 = 16.0,
    min_steps: usize = 12,
    steps_per_len: f64 = 54.0,
    reach: f64 = 1.8,
    lava_want_lo: usize = 85,
    lava_want_hi: usize = 140,
    depths: [f64; 4] = [0.45, 0.55, 0.65, 0.75],
    slack: f64 = 7.0,
    usable_min: usize = 60,
    target_extra: usize = 8,
    depth_jitter: f64 = 0.04,
    bin_width: f64 = 2.0,
    bridge_bins: usize = 3,
    run_route_weight: f64 = 8.0,
    run_target_multiple: f64 = 2.0,
    member_depth_offset: f64 = 1.0,
    crossed_penalty: f64 = 7.0,
    route_bonus: f64 = 3.0,
    route_bonus_cap: usize = 3,
    endpoint_jitter: f64 = 12.0,
    crater_margin: f64 = 2.5,
    crater_cost: i32 = 400,
    depth_cost: f64 = 8.0,
    closed_cost: i32 = 1000,
    corridor_cost: i32 = 6,
    path_salt: f64 = 11.0,
    width_period: f64 = 5.0,
    width_y: f64 = 3.3,
    width_cell: f64 = 1.0,
    width_salt: f64 = 13.0,
    width_threshold: f64 = 716.0,
    width_narrow: i32 = 2,
    width_wide: i32 = 3,
    route_start: f64 = 0.15,
    route_end: f64 = 0.85,
    route_distance2: f64 = 9.0,
    corridor_run_gap: usize = 2,
    edge_min: usize = 2,
    edge_start_margin: usize = 3,
    edge_end_margin: usize = 4,
    edge_ford_margin: usize = 1,
    fallback_shares: [f64; 3] = [0.3, 0.7, 0.5],
    fallback_gap: usize = 6,
    ford_min: usize = 2,
    length_offsets: [i32; 3] = [-14, 0, 14],
    length_min: usize = 24,
    window_step: usize = 3,
    corridor_caps: [i32; 3] = [-1, 3, 2],
    lava_low_penalty: f64 = 2.0,
    lava_high_penalty: f64 = 1.0,
    covered_penalty: f64 = 2.0,
    uncovered_penalty: f64 = 9.0,
    ford_count_free: usize = 4,
    ford_count_penalty: f64 = 2.0,
    placement_tries: usize = 3,
    window_distinct: usize = 12,
    fallback_cap: usize = 2,
    blocks_min: usize = 12,
    default_width2: i32 = 4
});
rules!(DecorRules {
    choose_salt: f64 = 3.0,
    variant_salt: f64 = 90.0,
    variant_count: usize = 4,
    crater_lip_chance: f64 = 1.0 / 6.0,
    crater_glow_chance: f64 = 0.3,
    forge_glow_chance: f64 = 0.2,
    door_clear_radius: i32 = 1,
    anvil_salt: f64 = 5.0,
    slag_salt: f64 = 6.0,
    ember_salt: f64 = 1.0,
    ember_chance: f64 = 0.12,
    ash_salt: f64 = 2.0,
    ash_chance: f64 = 0.02
});
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub crater: CraterRules,
    pub river: RiverRules,
    pub decor: DecorRules,
}
pub fn default_definition() -> Definition {
    Definition::default()
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    d.crater.visit(&mut word);
    d.river.visit(&mut word);
    d.decor.visit(&mut word);
}
impl Definition {
    pub(super) fn validate(&self) -> Result<(), super::Error> {
        let c = &self.crater;
        let r = &self.river;
        let p = &self.decor;
        // With the admitted shared quarter-radius <= 64 and jitter <= 16, primary
        // raster endpoints are at most 32 cells from a camp. Thus |delta| and
        // interpolation steps are <= 64, and 2*delta*step+n fits in i32 (<= 8256).
        // This also bounds gap-filling work. Nonempty river windows require an anchor.
        if !c.bounded()
            || !r.bounded()
            || !p.bounded()
            || c.stretch_max < 1000
            || c.breaches_min == 0
            || c.breaches_max < c.breaches_min
            || c.breaches_max > 16
            || !(0..=8).contains(&c.breach_separation)
            || c.breach_half4 < 0.0
            || !(0..=1000).contains(&c.rim_keep_permille)
            || c.raster_padding < 0.0
            || c.raster_padding > 16.0
            || !(0.0..=16.0).contains(&c.jitter_strength)
            || c.jitter_cell <= 0.0
            || c.second_cell <= 0.0
            || c.band_min < c.band_end_samples
            || c.band_end_samples == 0
            || c.breach_near < 0
            || c.radius_shrink4.iter().any(|&v| v < 0)
            || c.frontier_breaches == 0
            || c.frontier_breaches > c.breaches_max
            || r.ford_per_steps <= 0.0
            || r.bin_width < 1.0
            || r.bridge_bins == 0
            || r.window_step == 0
            || r.width_period <= 0.0
            || r.width_cell <= 0.0
            || r.length_min == 0
            || r.min_steps < 2
            || r.ford_steps == 0
            || r.width_narrow < 1
            || r.width_wide < r.width_narrow
            || r.width_wide > 16
            || r.crater_cost < 0
            || r.depth_cost < 0.0
            || r.depth_cost > 512.0
            || r.closed_cost < 0
            || r.corridor_cost < 0
            || r.corridor_caps.iter().any(|&v| v < -1)
            || r.depths
                .iter()
                .chain(&r.fallback_shares)
                .any(|v| !(0.0..=1.0).contains(v))
            || r.route_start < 0.0
            || r.route_end > 1.0
            || r.route_start > r.route_end
            || r.slack < 0.0
            || r.reach < 0.0
            || r.steps_per_len < 0.0
            || r.steps_per_len > 1000.0
            || r.crater_margin < 0.0
            || r.crater_margin > 64.0
            || r.lava_want_lo > r.lava_want_hi
            || p.variant_count == 0
            || p.variant_count > 255
            || p.door_clear_radius < 0
            || p.door_clear_radius > 16
            || [
                p.crater_lip_chance,
                p.crater_glow_chance,
                p.forge_glow_chance,
                p.ember_chance,
                p.ash_chance,
            ]
            .iter()
            .any(|v| !(0.0..=1.0).contains(v))
        {
            return Err(super::Error::Definition);
        }
        Ok(())
    }
}
