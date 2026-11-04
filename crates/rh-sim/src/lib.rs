//! Roguehalla simulation core (Stage 1 slice). See docs/CONTRACTS.md for the invariants this crate guarantees and
//! docs/backlog/README.md for the mechanics that are not ported yet.
//!
//! Boundaries: no sockets, files, threads, wall clock or entropy. The live server (`rh-server`) and the headless runner
//! (`rh-headless`) drive the same [`Sim`] through [`Sim::submit`] and [`Sim::step`].

// `!(x > 0.0)` is deliberate throughout: it is the legacy NaN-safe test ("not a positive number"), not `x <= 0.0`.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod arenas;
pub mod checkpoint;
pub mod constants;
pub mod content;
pub mod events;
pub mod geometry;
mod hash;
pub mod input;
pub mod map;
pub mod math;
pub mod observe;
pub mod pathfind;
pub mod replay;
pub mod results;
pub mod rng;
mod scratch;
pub mod sim;
pub mod state;
pub mod statics;
mod systems;

pub use checkpoint::{CheckpointError, CHECKPOINT_FORMAT};
pub use content::{FactionId, WeaponId};
pub use input::{validate, Command, RawCommand, Reject};
pub use map::TileMap;
pub use math::Vec2;
pub use observe::{observe, public_snapshot, Observation, OBSERVATION_VERSION};
pub use sim::{
    Arena, Event, Outcome, Phase, Placement, PlayerId, RunResult, Secrets, Sim, SimConfig, Status,
};
