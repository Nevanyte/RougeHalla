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
//! * [`hostname`]: the one place a placement id becomes a DNS name (a Node mirror is tested against shared vectors).
//!
//! No AWS SDK is linked and no credential is read here. The real GameLift and DNS adapters are separate programs that hold
//! the credentials (never the game process, never the bridge); this crate is the logic they call.

pub mod backend;
pub mod fake;
pub mod hostname;
pub mod model;
pub mod score;
pub mod service;

pub use model::*;
