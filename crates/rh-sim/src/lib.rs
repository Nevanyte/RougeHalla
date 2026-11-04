//! Roguehalla simulation core (Stage 1 slice). See docs/CONTRACTS.md for the invariants this crate guarantees and
//! docs/backlog/README.md for the mechanics that are not ported yet.
//!
//! Boundaries: no sockets, files, threads, wall clock or entropy. The live server (`rh-server`) and the headless runner
//! (`rh-headless`) drive the same [`Sim`] through [`Sim::submit`] and [`Sim::step`].

pub mod constants;
pub mod content;
pub mod geometry;
pub mod input;
pub mod map;
pub mod math;
pub mod observe;
pub mod pathfind;
pub mod replay;
pub mod rng;
pub mod sim;

pub use content::{FactionId, WeaponId};
pub use input::{validate, Command, RawCommand, Reject};
pub use map::TileMap;
pub use math::Vec2;
pub use observe::{observe, public_snapshot, Observation, OBSERVATION_VERSION};
pub use sim::{Arena, Event, Outcome, Phase, Placement, PlayerId, RunResult, Secrets, Sim, SimConfig, Status};
