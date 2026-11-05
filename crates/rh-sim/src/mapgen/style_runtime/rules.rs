//! Runtime policy. Shared terrain/prop identities are borrowed, never copied into a second catalog.
use super::Error;
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    pub join_checks: u32,
    pub footprint_percent: f64,
    pub rim_tiles: f64,
    pub fence_detour: u16,
    pub wall_cost: u32,
    pub low_cost: u32,
    pub prop_percent: u8,
    pub min_piece: u32,
    pub min_share_permille: u32,
    pub min_groups: u32,
    pub shape_stream: u32,
    pub decor_stream: u32,
    pub surface_stream: u32,
    pub noise_stream_offset: u32,
    pub route_cut_off: i32,
    pub route_stretch_max: u32,
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    join_checks: 512,
    footprint_percent: 13.0,
    rim_tiles: 3.0,
    fence_detour: 10,
    wall_cost: 100,
    low_cost: 100,
    prop_percent: 8,
    min_piece: 6,
    min_share_permille: 600,
    min_groups: 1,
    shape_stream: 0,
    decor_stream: 1,
    surface_stream: 2,
    noise_stream_offset: 100,
    route_cut_off: 1_000_000,
    route_stretch_max: 1030,
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
impl Definition {
    pub(crate) fn validate(&self) -> Result<(), Error> {
        if !self.footprint_percent.is_finite()
            || !(0.0..=100.0).contains(&self.footprint_percent)
            || !self.rim_tiles.is_finite()
            || !(0.0..=1_048_576.0).contains(&self.rim_tiles)
            || self.fence_detour > 32761
            || self.join_checks > 1_000_000
            || self.wall_cost == 0
            || self.wall_cost > 1_000_000
            || self.low_cost == 0
            || self.low_cost > 1_000_000
            || self.min_piece == 0
            || self.min_piece > 2_097_152
            || self.min_share_permille > 1_000_000
            || self.min_groups > 2_097_152
            || self.prop_percent > 100
            || self.route_cut_off < 1000
            || !(1000..=1_000_000).contains(&self.route_stretch_max)
            || [self.shape_stream, self.decor_stream, self.surface_stream]
                .iter()
                .any(|s| s.checked_add(self.noise_stream_offset).is_none())
        {
            return Err(Error::Definition);
        }
        Ok(())
    }
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.join_checks.into());
    word(d.footprint_percent.to_bits());
    word(d.rim_tiles.to_bits());
    for v in [
        u32::from(d.fence_detour),
        d.wall_cost,
        d.low_cost,
        u32::from(d.prop_percent),
        d.min_piece,
        d.min_share_permille,
        d.min_groups,
        d.shape_stream,
        d.decor_stream,
        d.surface_stream,
        d.noise_stream_offset,
        d.route_cut_off as u32,
        d.route_stretch_max,
    ] {
        word(v.into());
    }
}
