//! Pure generator foundations (P-MAP-1 M1/M2a). Full generation, camps and certification remain open.
//! Inputs use row-major grids with exactly `w * h` cells and positive dimensions.
pub mod coliseum;
pub mod det_math;
pub mod grid_ops;
pub mod grid_topology;
pub mod zones;

#[cfg(test)]
mod tests;
