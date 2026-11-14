//! Complete private source strategy and hunting state (P-BOT-STRATEGY-1). Private seam only: no public Brain/tactics,
//! live adapters or World reads. Source-derived from packages/server/src/bots/brain/{strategy,huntAdapter,buildRoute}.ts,
//! ../../mobHunt.ts, types/random/knowledge/services and their unchanged imports.

mod build_route;
mod engine;
mod hunt_adapter;
mod mob_hunt;
// The private Brain composer (P-BOT-BRAIN-NATIVE-1 final interface lease): the engine itself and its options stay
// inside the temporal-percept subsystem; no public Strategy/Brain surface is added.
pub(super) use engine::{Strategy, StrategyOptions};
// Root-granted bridge (2026-11-10, review SHA256 3f2cc11b...): the Brain path adapter needs to name the already
// `pub(crate)` hunt mob record to emit the exact source `paths.walk` callback argument. Parent-visible only; the child
// module stays private and no engine/algorithm behavior changes.
pub(super) use mob_hunt::HuntMobLike;
// P-BOT-BRAIN-THEMED-1 oracle bridge: the Brain's composed-percept test (`brain/themed_camp_tests.rs`) values the route's
// camps exactly as the planner does. Test-only.
#[cfg(test)]
pub(super) use build_route::{route_camp_value, BuildRoute, RouteInput};
#[cfg(test)]
pub(super) use engine::route_camps;
#[cfg(test)]
mod private_strategy_tests;
#[cfg(test)]
mod source_reader;
#[cfg(test)]
mod source_strict;
#[cfg(test)]
mod source_tests;
#[cfg(test)]
mod source_trace;
pub(super) mod types;
