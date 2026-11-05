//! Actual landmark wall-guard rules; runtime and allocation-free content visitor share this definition.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LandmarkDefinition {
    pub join_checks: u32,
    pub footprint_percent: f64,
    pub rim_tiles: f64,
}
pub const DEFAULT_DEFINITION: LandmarkDefinition = LandmarkDefinition {
    join_checks: 128,
    footprint_percent: 4.0,
    rim_tiles: 3.0,
};
pub fn default_definition() -> LandmarkDefinition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &LandmarkDefinition, mut word: impl FnMut(u64)) {
    word(u64::from(d.join_checks));
    word(d.footprint_percent.to_bits());
    word(d.rim_tiles.to_bits());
}
