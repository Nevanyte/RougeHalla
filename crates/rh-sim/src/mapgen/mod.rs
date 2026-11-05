//! Pure generator foundations (P-MAP-1 M1). No generator, zones or certifier yet.
//! Inputs use row-major grids with exactly `w * h` cells and positive dimensions.
pub mod coliseum;
pub mod det_math;
pub mod grid_ops;
pub mod grid_topology;

#[cfg(test)]
mod tests;
