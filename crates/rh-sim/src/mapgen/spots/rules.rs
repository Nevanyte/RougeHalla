//! The sole live spot-placement tuning, shared by operations and content identity.
#[derive(Clone, Copy, Debug)]
pub struct Definition {
    pub camp_min: usize,
    pub camp_max: usize,
    pub camp_gap: usize,
    pub crate_min: usize,
    pub crate_max: usize,
    pub crate_gap: usize,
    pub crate_first_gap: usize,
    pub crate_pool_margin: usize,
    pub crate_camp_margin: usize,
    pub crate_spot_margin: usize,
    pub door_margin: usize,
    pub ground_open_min: usize,
    pub ground_min: usize,
    pub ground_max: usize,
    pub ground_spawn_margin: usize,
    pub ground_crate_margin: usize,
    pub ground_hazard_margin: usize,
    pub ground_gaps: [usize; 3],
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    camp_min: 3,
    camp_max: 5,
    camp_gap: 2,
    crate_min: 4,
    crate_max: 6,
    crate_gap: 2,
    crate_first_gap: 4,
    crate_pool_margin: 2,
    crate_camp_margin: 2,
    crate_spot_margin: 1,
    door_margin: 1,
    ground_open_min: 90,
    ground_min: 30,
    ground_max: 45,
    ground_spawn_margin: 2,
    ground_crate_margin: 1,
    ground_hazard_margin: 1,
    ground_gaps: [4, 2, 1],
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    for n in [
        d.camp_min,
        d.camp_max,
        d.camp_gap,
        d.crate_min,
        d.crate_max,
        d.crate_gap,
        d.crate_first_gap,
        d.crate_pool_margin,
        d.crate_camp_margin,
        d.crate_spot_margin,
        d.door_margin,
        d.ground_open_min,
        d.ground_min,
        d.ground_max,
        d.ground_spawn_margin,
        d.ground_crate_margin,
        d.ground_hazard_margin,
    ] {
        word(n as u64);
    }
    for n in d.ground_gaps {
        word(n as u64);
    }
}
