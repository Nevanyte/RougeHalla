//! The actual prefix's two new content values; geometry/camp rules remain shared.
#[derive(Clone, Copy, Debug)]
pub struct AttemptDefinition {
    pub layout_tries: usize,
    pub retry_seed_stride: f64,
}
pub const DEFAULT_DEFINITION: AttemptDefinition = AttemptDefinition {
    layout_tries: 4,
    retry_seed_stride: 2654435761.0,
};
pub fn default_definition() -> AttemptDefinition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &AttemptDefinition, mut word: impl FnMut(u64)) {
    word(d.layout_tries as u64);
    word(d.retry_seed_stride.to_bits());
}
