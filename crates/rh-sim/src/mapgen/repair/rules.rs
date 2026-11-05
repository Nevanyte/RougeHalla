//! Rules owned by the post-style repair. Shared geometry stays in its original definitions.
#[derive(Clone, Copy, Debug)]
pub struct Definition<'a> {
    pub floor_share_max: f64,
    pub stray_max: usize,
    pub wall_up_max: usize,
    pub territory_rounds: usize,
    pub zone_rounds: usize,
    pub wall_sweeps: usize,
    /// Terrain byte -> required tile class; borrowed from the terrain definition.
    pub terrain_on: &'a [u8],
}
pub fn default_definition(terrain_on: &[u8]) -> Definition<'_> {
    Definition {
        floor_share_max: 1.15,
        stray_max: 40,
        wall_up_max: 120,
        territory_rounds: 8,
        zone_rounds: 4,
        wall_sweeps: 60,
        terrain_on,
    }
}
pub fn visit_content(d: &Definition<'_>, mut word: impl FnMut(u64)) {
    word(d.floor_share_max.to_bits());
    for v in [
        d.stray_max,
        d.wall_up_max,
        d.territory_rounds,
        d.zone_rounds,
        d.wall_sweeps,
    ] {
        word(v as u64);
    }
    word(d.terrain_on.len() as u64);
    for &v in d.terrain_on {
        word(u64::from(v));
    }
}
