//! Pure generator stages/foundations (P-MAP-1 through M3b). Full generation and certification remain open.
//! Inputs use row-major grids with exactly `w * h` cells and positive dimensions.
pub mod attempt;
pub mod bushes;
pub mod coliseum;
pub mod det_math;
pub mod grid_ops;
pub mod grid_topology;
pub mod spawns;
pub mod zones;

#[cfg(test)]
mod tests;
