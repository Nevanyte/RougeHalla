//! Orchestration-only source limits. All gameplay geometry remains owned by established leaves.
#[derive(Clone, Copy, Debug)]
pub struct Definition {
    pub certified_attempts: u64,
    pub generate_attempts: u64,
    pub features_max: usize,
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    certified_attempts: 16,
    generate_attempts: 64,
    features_max: 250,
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.certified_attempts);
    word(d.generate_attempts);
    word(d.features_max as u64);
}
