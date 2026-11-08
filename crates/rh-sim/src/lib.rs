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
pub mod factions;
pub mod fighter;
pub mod fx_projector;
pub mod fx_report;
pub mod geometry;
mod hash;
mod hooks;
pub mod input;
pub mod item_view;
pub mod map;
pub mod mapdata;
pub mod mapgen;
pub mod math;
pub mod mob_catalog;
pub mod observe;
pub mod pathfind;
pub mod replay;
pub mod results;
pub mod rng;
pub mod schedule;
mod scratch;
pub mod sight;
pub mod sim;
pub mod stat_fold;
pub mod state;
pub mod statics;
pub mod store;
mod systems;
mod vision;

pub use checkpoint::{CheckpointError, CHECKPOINT_FORMAT};
pub use content::{FactionId, WeaponId};
pub use events::PickupRefusal;
pub use events::{Class, Visibility};
pub use fx_projector::{FeedStatus, FxError, FxProjector};
pub use input::{validate, Command, PublicCommand, RawCommand, Reject};
pub use item_view::{
    Inventory, ItemObserver, OfferError, PickupHandle, PropCue, PropKind, VisibleProp,
    MAX_VISIBLE_PROPS,
};
pub use map::TileMap;
pub use math::Vec2;
pub use observe::{
    observe, observe_events_into, observe_events_into_cached, observe_into, observe_into_cached,
    public_snapshot, Observation, SeenEvent, OBSERVATION_VERSION,
};
pub use sight::{SightCache, SightStats};
pub use sim::{
    Arena, Event, Outcome, Phase, Placement, PlayerId, RunResult, Secrets, Sim, SimConfig, Status,
};
pub use state::{
    Container, ContainerKind, ProjectileEnd, ProjectileKind, ProjectileLaunch, WeaponItem,
};
pub use statics::FactionMode;
pub use store::{EntityId, Store};

pub use systems::signatures::LandedHit;
