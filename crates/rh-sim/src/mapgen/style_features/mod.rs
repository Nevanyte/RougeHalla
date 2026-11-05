//! Pure, borrowed feature kit. Grid inputs have positive dimensions and exactly w*h cells.
//! Geometry uses ECMAScript binary64 operation order. No random stream is consumed.
pub use super::landmarks::recipe_support::{
    argmax_in, camp_nodes, dir_sep16, dist2, gabriel_edges, isqrt, Node, Noise, DIR16,
};
mod fields;
mod geometry;
mod graphs;
mod rules;
mod search;
pub use fields::*;
pub use geometry::*;
pub use graphs::*;
pub use rules::*;
pub use search::*;
#[cfg(test)]
mod tests;
pub fn noise_q(noise: &Noise, x: f64, y: f64, cell: f64, salt: f64) -> f64 {
    noise.noise_q(x, y, cell, salt)
}
pub fn fbm_q(noise: &Noise, x: f64, y: f64, cell: f64, octaves: u32, salt: f64) -> f64 {
    let v = (super::style_runtime::noise_fbm(*noise, x, y, cell, octaves, salt) * 1024.0).floor();
    if v.is_nan() {
        v
    } else {
        v.min(1023.0)
    }
}

/// Same clockwise bearings as kit.DIR8, derived from the accepted topology ring.
pub const DIR8: [[i32; 2]; 8] = {
    let mut out = [[0; 2]; 8];
    let mut q = 0;
    while q < 8 {
        let r = (q + 2) % 8;
        out[q] = [
            super::grid_topology::RING_DX[r],
            super::grid_topology::RING_DY[r],
        ];
        q += 1;
    }
    out
};
pub const CHAMFER_FAR: i32 = DEFAULT_DEFINITION.chamfer_far;
