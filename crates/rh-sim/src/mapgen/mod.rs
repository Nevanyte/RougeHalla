//! Pure map generation, including complete plain orchestration and independent hard certification.
//! Stage-six faction callbacks and the complete styled generator remain in progress.
//! Inputs use row-major grids with exactly `w * h` cells and positive dimensions.
pub mod attempt;
pub mod bushes;
pub mod certify;
pub mod coliseum;
pub mod det_math;
pub mod grid_ops;
pub mod grid_topology;
pub mod landmarks;
pub mod map_hash;
pub mod pipeline;
pub mod records;
pub mod repair;
pub mod spawns;
pub mod spots;
pub mod style_runtime;
pub mod tail;
pub mod terrain_gate;
pub mod zones;

#[cfg(test)]
mod tests;
