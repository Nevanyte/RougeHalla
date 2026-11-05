//! The single definition read by partitioning and by the core content fold.
#[derive(Clone, Copy, Debug)]
pub struct ZoneDefinition {
    pub ring_contact_min: i32,
    pub sliver_max: i32,
    pub area_tolerance: i32,
    pub cost_base: i32,
    pub cost_amp: i32,
    pub arc_min: usize,
    pub arc_trim: usize,
    pub annulus_lo: f64,
    pub annulus_hi: f64,
    pub annulus_edge: usize,
    pub seed_candidates: usize,
    pub smooth_passes: usize,
    pub zone_tries: usize,
    pub camp_radius: f64,
    pub core_dt: i32,
    pub balance_rounds: usize,
    pub balance_tolerance: i32,
    pub arc_weight_bias: f64,
    pub smooth_majority: i32,
    pub peel_to_weight: i32,
    pub peel_bias: i32,
    pub peel_ceiling: i32,
    pub noise_coarse_scale: f64,
    pub noise_fine_scale: f64,
    pub noise_reference_width: f64,
    pub noise_coarse_weight: i32,
    pub noise_fine_weight: i32,
    pub noise_divisor: i32,
}
pub const DEFAULT_DEFINITION: ZoneDefinition = ZoneDefinition {
    ring_contact_min: 24,
    sliver_max: 100,
    area_tolerance: 8,
    cost_base: 12,
    cost_amp: 36,
    arc_min: 36,
    arc_trim: 6,
    annulus_lo: 0.55,
    annulus_hi: 0.9,
    annulus_edge: 3,
    seed_candidates: 10,
    smooth_passes: 2,
    zone_tries: 8,
    camp_radius: 2.5,
    core_dt: 15,
    balance_rounds: 40,
    balance_tolerance: 1,
    arc_weight_bias: 0.25,
    smooth_majority: 3,
    peel_to_weight: 2,
    peel_bias: 4,
    peel_ceiling: 12,
    noise_coarse_scale: 16.0,
    noise_fine_scale: 6.0,
    noise_reference_width: 64.0,
    noise_coarse_weight: 2,
    noise_fine_weight: 1,
    noise_divisor: 3,
};
pub fn default_definition() -> ZoneDefinition {
    DEFAULT_DEFINITION
}
/// Declaration order; integers are sign-extended, floats use IEEE bits. No scratch or map allocation.
pub fn visit_content(d: &ZoneDefinition, mut word: impl FnMut(u64)) {
    word(d.ring_contact_min as i64 as u64);
    word(d.sliver_max as i64 as u64);
    word(d.area_tolerance as i64 as u64);
    word(d.cost_base as i64 as u64);
    word(d.cost_amp as i64 as u64);
    word(d.arc_min as u64);
    word(d.arc_trim as u64);
    word(d.annulus_lo.to_bits());
    word(d.annulus_hi.to_bits());
    word(d.annulus_edge as u64);
    word(d.seed_candidates as u64);
    word(d.smooth_passes as u64);
    word(d.zone_tries as u64);
    word(d.camp_radius.to_bits());
    word(d.core_dt as i64 as u64);
    word(d.balance_rounds as u64);
    word(d.balance_tolerance as i64 as u64);
    word(d.arc_weight_bias.to_bits());
    word(d.smooth_majority as i64 as u64);
    word(d.peel_to_weight as i64 as u64);
    word(d.peel_bias as i64 as u64);
    word(d.peel_ceiling as i64 as u64);
    word(d.noise_coarse_scale.to_bits());
    word(d.noise_fine_scale.to_bits());
    word(d.noise_reference_width.to_bits());
    word(d.noise_coarse_weight as i64 as u64);
    word(d.noise_fine_weight as i64 as u64);
    word(d.noise_divisor as i64 as u64);
}
