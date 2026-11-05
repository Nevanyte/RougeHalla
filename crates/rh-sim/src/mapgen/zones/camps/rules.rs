//! Camp-only rules; clearing radius is owned by the parent ZoneDefinition.
#[derive(Clone, Copy, Debug)]
pub struct CampDefinition {
    pub camps_per_zone: usize,
    pub elites_per_zone: usize,
    pub elite_min_sep: f64,
    pub camp_gap: f64,
    pub territory_radius_max: f64,
    pub candidates: usize,
    pub lloyd_steps: usize,
    pub tries: usize,
    pub edge_clear: usize,
    pub halo_window: i32,
    pub halo_ring_margin: u8,
    pub halo_dt: i32,
    pub final_from_step: usize,
}
pub const DEFAULT_DEFINITION: CampDefinition = CampDefinition {
    camps_per_zone: 10,
    elites_per_zone: 2,
    elite_min_sep: 16.0,
    camp_gap: 9.0,
    territory_radius_max: 30.0,
    candidates: 12,
    lloyd_steps: 4,
    tries: 2,
    edge_clear: 3,
    halo_window: 4,
    halo_ring_margin: 1,
    halo_dt: 20,
    final_from_step: 1,
};
pub fn default_definition() -> CampDefinition {
    DEFAULT_DEFINITION
}
/// Declaration order; integer words and binary64 bits, with no map/scratch allocation.
pub fn visit_content(d: &CampDefinition, mut word: impl FnMut(u64)) {
    word(d.camps_per_zone as u64);
    word(d.elites_per_zone as u64);
    word(d.elite_min_sep.to_bits());
    word(d.camp_gap.to_bits());
    word(d.territory_radius_max.to_bits());
    word(d.candidates as u64);
    word(d.lloyd_steps as u64);
    word(d.tries as u64);
    word(d.edge_clear as u64);
    word(d.halo_window as i64 as u64);
    word(u64::from(d.halo_ring_margin));
    word(d.halo_dt as i64 as u64);
    word(d.final_from_step as u64);
}
