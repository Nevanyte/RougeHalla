//! Complete private source strategy and hunting state (P-BOT-STRATEGY-1). Private seam only: no public Brain/tactics,
//! live adapters or World reads. Source-derived from packages/server/src/bots/brain/{strategy,huntAdapter,buildRoute}.ts,
//! ../../mobHunt.ts, types/random/knowledge/services and their unchanged imports.

mod build_route;
mod engine;
mod hunt_adapter;
mod mob_hunt;
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
mod types;
