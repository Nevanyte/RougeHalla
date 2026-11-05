//! Pure map generation: shared plain/styled orchestration, five faction callbacks and independent hard certification.
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
pub mod style_features;
pub mod style_gallows;
pub mod style_rime;
pub mod style_runtime;
pub mod style_sanctum;
pub mod style_scorch;
pub mod style_warren;
pub mod style_zones;
pub mod tail;
pub mod terrain_gate;
pub mod zones;

#[cfg(test)]
mod tests;
