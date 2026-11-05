//! Actual bush rules, shared by runtime and the allocation-free content visitor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BushDefinition {
    pub stream: u32,
    pub camp_stream_stride: u32,
    pub patches_min: usize,
    pub patches_max: usize,
    pub tiles_min: usize,
    pub tiles_max: usize,
    pub near_min_d2: i64,
    pub near_max_d2: i64,
    pub centre_sep_d2: i64,
    pub scan_radius: i32,
    pub tries_per_patch: usize,
}
pub const DEFAULT_DEFINITION: BushDefinition = BushDefinition {
    stream: 4,
    camp_stream_stride: 8,
    patches_min: 2,
    patches_max: 4,
    tiles_min: 4,
    tiles_max: 10,
    near_min_d2: 16,
    near_max_d2: 100,
    centre_sep_d2: 49,
    scan_radius: 10,
    tries_per_patch: 6,
};
pub fn default_definition() -> BushDefinition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &BushDefinition, mut word: impl FnMut(u64)) {
    word(d.stream as u64);
    word(d.camp_stream_stride as u64);
    word(d.patches_min as u64);
    word(d.patches_max as u64);
    word(d.tiles_min as u64);
    word(d.tiles_max as u64);
    word(d.near_min_d2 as u64);
    word(d.near_max_d2 as u64);
    word(d.centre_sep_d2 as u64);
    word(d.scan_radius as u64);
    word(d.tries_per_patch as u64);
}
