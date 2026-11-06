//! Region placement for Roguehalla hosting (docs/hosting/PLACEMENT.md, docs/hosting/TLS_DNS.md).
//!
//! What is here, and what is deliberately not:
//!
//! * [`score`]: the pure planner. Every party member's measured RTT per region goes in; a ranked region list, an explicit
//!   attempt ladder (what to ask GameLift, in what order, with which timeout) and user-visible warnings come out. No I/O.
//! * [`backend`]: the interface to GameLift placement and to DNS ([`backend::GameLiftBackend`], [`backend::DnsBackend`]) plus the
//!   exact `StartGameSessionPlacement` request shape we send ([`backend::StartPlacement`]).
//! * [`service`]: the orchestration (plan, place, wait, widen, create the hostname, verify it) over those two interfaces.
//! * [`fake`]: scripted fakes of both, used by this crate's tests.
//! * [`ledger`]: the durable request ledger (memory store, PostgreSQL store behind feature `postgres`) the service writes its
//!   intents and outcomes to before and after every external effect, so a restart can reconcile.
//! * [`hostname`]: the one place a placement id becomes a DNS name (a Node mirror is tested against shared vectors).
//!
//! No AWS SDK is linked and no credential is read here. The real GameLift and DNS adapters are separate programs that hold
//! the credentials (never the game process, never the bridge); this crate is the logic they call.

// Fault points and mutants exist to break the service on purpose (tests and negative controls). A release build must never
// contain them, however a feature set was assembled.
#[cfg(all(feature = "fault-injection", not(debug_assertions)))]
compile_error!(
    "the `fault-injection` feature is for test builds only and cannot be enabled in a release build (debug_assertions off)"
);

pub mod backend;
pub mod fake;
pub mod hostname;
pub mod ledger;
pub mod model;
pub mod score;
pub mod service;

pub use model::*;
