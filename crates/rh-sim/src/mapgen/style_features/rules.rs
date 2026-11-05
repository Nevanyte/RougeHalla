/// Numeric feature policies, in stable declaration order. Fixed geometry encodings are not policies.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Definition {
    pub chamfer_far: i32,
    pub chamfer_orthogonal: i32,
    pub chamfer_diagonal: i32,
    pub majority_threshold: i32,
    pub path_far: i32,
    pub hard_radius: i32,
    pub noise_cell: f64,
    pub noise_scale: f64,
    pub path_orthogonal: i32,
    pub path_diagonal: i32,
    pub hard_penalty: i32,
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    chamfer_far: 1 << 20,
    chamfer_orthogonal: 3,
    chamfer_diagonal: 4,
    majority_threshold: 5,
    path_far: 1 << 30,
    hard_radius: 3,
    noise_cell: 7.0,
    noise_scale: 30.0,
    path_orthogonal: 10,
    path_diagonal: 14,
    hard_penalty: 150,
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    for v in [
        d.chamfer_far,
        d.chamfer_orthogonal,
        d.chamfer_diagonal,
        d.majority_threshold,
        d.path_far,
        d.hard_radius,
    ] {
        word(v as u64)
    }
    word(d.noise_cell.to_bits());
    word(d.noise_scale.to_bits());
    for v in [d.path_orthogonal, d.path_diagonal, d.hard_penalty] {
        word(v as u64)
    }
}
