//! Spawn/protection rules, consumed by runtime and the allocation-free content fold.
#[derive(Clone, Copy, Debug)]
pub struct SpawnDefinition {
    pub separation: f64,
    pub safe_separation: f64,
    pub camp_pick: i32,
    pub ring_lo: f64,
    pub ring_hi: f64,
    pub pick_target: usize,
    pub pool_min: usize,
    pub pool_zones: usize,
    pub pick_band: f64,
    pub tries: usize,
    pub walk_ratio_max: f64,
    pub hazard_walk_max: u32,
    pub quantile_first: usize,
    pub quantile_last: usize,
    pub quantile_denominator: usize,
    pub score_weight: usize,
    pub early_extra: usize,
    pub scan_margin: usize,
    pub pool_halo_margin: i32,
    pub pool5_margin: i32,
    pub corner_open: usize,
    pub landmark_road_margin: u8,
    pub landmark_lane_margin: i32,
    pub landmark_clearing_margin: i32,
    pub style_road_margin: u8,
    pub style_lane_margin: i32,
    pub landmark_box_margin: i32,
}
pub const DEFAULT_DEFINITION: SpawnDefinition = SpawnDefinition {
    separation: 5.0,
    safe_separation: 10.0,
    camp_pick: 7,
    ring_lo: 0.5,
    ring_hi: 0.95,
    pick_target: 32,
    pool_min: 24,
    pool_zones: 4,
    pick_band: 0.03,
    tries: 4,
    walk_ratio_max: 1.2,
    hazard_walk_max: 8,
    quantile_first: 2,
    quantile_last: 8,
    quantile_denominator: 10,
    score_weight: 8,
    early_extra: 2,
    scan_margin: 2,
    pool_halo_margin: 1,
    pool5_margin: 2,
    corner_open: 4,
    landmark_road_margin: 2,
    landmark_lane_margin: 1,
    landmark_clearing_margin: 3,
    style_road_margin: 1,
    style_lane_margin: 1,
    landmark_box_margin: 1,
};
pub fn default_definition() -> SpawnDefinition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &SpawnDefinition, mut word: impl FnMut(u64)) {
    word(d.separation.to_bits());
    word(d.safe_separation.to_bits());
    word(d.camp_pick as i64 as u64);
    word(d.ring_lo.to_bits());
    word(d.ring_hi.to_bits());
    word(d.pick_target as u64);
    word(d.pool_min as u64);
    word(d.pool_zones as u64);
    word(d.pick_band.to_bits());
    word(d.tries as u64);
    word(d.walk_ratio_max.to_bits());
    word(u64::from(d.hazard_walk_max));
    word(d.quantile_first as u64);
    word(d.quantile_last as u64);
    word(d.quantile_denominator as u64);
    word(d.score_weight as u64);
    word(d.early_extra as u64);
    word(d.scan_margin as u64);
    word(d.pool_halo_margin as i64 as u64);
    word(d.pool5_margin as i64 as u64);
    word(d.corner_open as u64);
    word(u64::from(d.landmark_road_margin));
    word(d.landmark_lane_margin as i64 as u64);
    word(d.landmark_clearing_margin as i64 as u64);
    word(u64::from(d.style_road_margin));
    word(d.style_lane_margin as i64 as u64);
    word(d.landmark_box_margin as i64 as u64);
}
