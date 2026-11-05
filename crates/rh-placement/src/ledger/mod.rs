//! The durable placement ledger: one fenced record per request id, claimed by at most one worker at a time.
//!
//! The placement state machine lives in `service`; a [`Ledger`] is only a compare-and-swap record store with claims.
//! [`memory::MemoryLedger`] (default, bounded) and `postgres::PgLedger` (feature `postgres`) implement the same trait and
//! pass the same conformance suite (`tests/ledger_conformance_*.rs`).
//!
//! Rules every store enforces:
//! * `begin` inserts a new `active` row claimed by the caller (fence 1) or reports what exists. The request id is the key;
//!   a different scope/request/config under an existing id is `Conflict`.
//! * `write` is a compare-and-swap on the claim's fence (and holder, kind and liveness). Fences only grow, on every claim.
//! * No transaction or row lock is held across an external await: each call is one short statement or transaction.
//! * `offered`, `released`, `finished` and `tombstone` rows are never handed to the reaper.
//! * A `tombstone` keeps id, scope, fingerprint and final phase forever, so a purged id can never replay or restart.
//! * Errors carry no database URL, binding or nonce.

pub mod memory;
#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(feature = "fault-injection")]
pub mod faults;

use crate::backend::PlacementStatus;
use crate::model::Warning;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::time::Duration;

/// Version of the PostgreSQL schema this crate writes (`rh_placement_schema.version`).
pub const SCHEMA_VERSION: i64 = 1;

/// A trusted, caller-supplied namespace (for example the authenticated account or party id). It is part of request identity
/// equality. It is NOT authentication: the HTTP boundary must authenticate and pass the right scope.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Scope(String);

impl Scope {
    /// 1..=128 printable ASCII characters (no spaces).
    pub fn new(s: impl Into<String>) -> Result<Self, String> {
        let s = s.into();
        if s.is_empty() || s.len() > 128 || !s.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
            return Err("scope must be 1..=128 printable ASCII characters".into());
        }
        Ok(Self(s))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for Scope {
    fn default() -> Self {
        Self("default".into())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// A `place` call owns it, or crashed.
    Active,
    Offered,
    Releasing,
    Released,
    /// No host; every attempt resolved.
    Finished,
    /// Retention purge kept only id, scope, fingerprint and final phase.
    Tombstone,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Active => "active",
            Phase::Offered => "offered",
            Phase::Releasing => "releasing",
            Phase::Released => "released",
            Phase::Finished => "finished",
            Phase::Tombstone => "tombstone",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "active" => Phase::Active,
            "offered" => Phase::Offered,
            "releasing" => Phase::Releasing,
            "released" => Phase::Released,
            "finished" => Phase::Finished,
            "tombstone" => Phase::Tombstone,
            _ => return None,
        })
    }
    /// Phases a `write` may move from `self` to `to` (a claim is held for every one of them).
    pub fn may_become(self, to: Phase) -> bool {
        use Phase::*;
        matches!(
            (self, to),
            (Active, Active | Offered | Finished)
                | (Offered, Releasing)
                | (Releasing, Releasing | Released)
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimKind {
    None,
    Worker,
    Reaper,
    Release,
}

impl ClaimKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ClaimKind::None => "none",
            ClaimKind::Worker => "worker",
            ClaimKind::Reaper => "reaper",
            ClaimKind::Release => "release",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "none" => ClaimKind::None,
            "worker" => ClaimKind::Worker,
            "reaper" => ClaimKind::Reaper,
            "release" => ClaimKind::Release,
            _ => return None,
        })
    }
}

/// Proof of a claim. The fence is what makes a write valid; the holder is diagnostic and checked as well.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Claim {
    pub request_id: String,
    pub holder: String,
    pub fence: i64,
    pub kind: ClaimKind,
}

/// What identifies a request. `fingerprint` is SHA-256 over canonical JSON of `(scope, request, config)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub request_id: String,
    pub scope: String,
    pub fingerprint: String,
    pub request_json: String,
    pub config_json: String,
    /// The DNS zone in force at `begin`; recovery and release use it even if the configuration later changes.
    pub zone: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimInfo {
    pub kind: ClaimKind,
    pub holder: Option<String>,
    /// The claim has not expired on the store's clock.
    pub live: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub identity: Identity,
    pub phase: Phase,
    /// Set on a tombstone: the phase it was purged from.
    pub final_phase: Option<Phase>,
    pub fence: i64,
    pub claim: ClaimInfo,
    pub state: LedgerState,
    pub created_ms: i64,
    pub updated_ms: i64,
    pub finished_ms: Option<i64>,
}

// ---- typed recovery state (serialized as JSON) ----

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LedgerState {
    pub attempts: Vec<AttemptRec>,
    pub offer: Option<OfferRecord>,
    pub release: Option<ReleaseRec>,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttemptRec {
    pub n: u32,
    pub placement_id: String,
    /// The exact `GameSessionData` string sent (it carries the ownership binding). Recovery compares receipts to THIS.
    pub binding: String,
    pub locations: Vec<String>,
    pub start: StartStep,
    pub status: Option<PlacementStatus>,
    pub fulfilled: Option<Fulfilled>,
    pub stop: StopStep,
    pub dns: DnsStep,
    pub terminate: TermStep,
    pub not_found: NotFoundRec,
    pub resolution: Resolution,
}

impl AttemptRec {
    pub fn new(
        n: u32,
        placement_id: String,
        binding: String,
        locations: Vec<String>,
        at_ms: i64,
    ) -> Self {
        Self {
            n,
            placement_id,
            binding,
            locations,
            start: StartStep::Intent { at_ms },
            status: None,
            fulfilled: None,
            stop: StopStep::None,
            dns: DnsStep::None,
            terminate: TermStep::None,
            not_found: NotFoundRec::default(),
            resolution: Resolution::Open,
        }
    }
    pub fn start_at_ms(&self) -> i64 {
        match self.start {
            StartStep::Intent { at_ms } | StartStep::Accepted { at_ms } => at_ms,
        }
    }
    pub fn is_open(&self) -> bool {
        self.resolution == Resolution::Open
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum StartStep {
    /// Written BEFORE `start_placement` is sent.
    Intent { at_ms: i64 },
    /// A receipt with the right identity was seen.
    Accepted { at_ms: i64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopStep {
    None,
    Intent,
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum DnsStep {
    None,
    Intent { host: String },
    Verified { host: String },
    DeleteIntent { host: String },
    Deleted { host: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum TermStep {
    None,
    Intent { arn: String },
    Done,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotFoundRec {
    pub first_at_ms: Option<i64>,
    pub count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    Open,
    NoHost,
    CleanedUp,
    Foreign,
    Settled,
    Offered,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fulfilled {
    pub region: String,
    pub ip: String,
    pub port: u16,
    pub arn: String,
    pub player_sessions: Vec<(String, String)>,
}

/// The committed offer. Contains player-session ids (credentials for the match): the table is as sensitive as the offer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferRecord {
    pub region: String,
    pub hostname: String,
    pub port: u16,
    pub url: String,
    pub placement_id: String,
    pub game_session_arn: String,
    pub player_sessions: Vec<(String, String)>,
    pub warnings: Vec<Warning>,
    pub attempts_used: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseRec {
    pub intent_at_ms: i64,
    pub done_at_ms: Option<i64>,
}

impl LedgerState {
    pub fn all_resolved(&self) -> bool {
        self.attempts.iter().all(|a| !a.is_open())
    }
}

/// Defence in depth behind the service's own checks: the invariants a state must satisfy to be written in `phase`.
pub fn validate_write(state: &LedgerState, phase: Phase) -> Result<(), LedgerError> {
    let refuse = |m: &str| Err(LedgerError::Refused(m.into()));
    match phase {
        Phase::Tombstone => refuse("a tombstone is only made by purge"),
        Phase::Active => Ok(()),
        Phase::Finished => {
            if state.all_resolved() {
                Ok(())
            } else {
                refuse("finished with an unresolved attempt")
            }
        }
        Phase::Offered | Phase::Releasing | Phase::Released => {
            let Some(offer) = &state.offer else {
                return refuse("no offer recorded");
            };
            if phase == Phase::Offered {
                if let Some(a) = state
                    .attempts
                    .iter()
                    .find(|a| a.placement_id == offer.placement_id)
                {
                    if a.terminate != TermStep::None
                        || matches!(
                            a.dns,
                            DnsStep::DeleteIntent { .. } | DnsStep::Deleted { .. }
                        )
                        || a.stop == StopStep::Intent
                    {
                        return refuse("offer for a placement with cleanup or stop in flight");
                    }
                } else {
                    return refuse("offer names no recorded attempt");
                }
            }
            Ok(())
        }
    }
}

// ---- results ----

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerError {
    /// The store could not be reached or failed: the outcome of a write is UNKNOWN.
    Unavailable(String),
    /// The per-call budget elapsed: the outcome of a write is UNKNOWN.
    Timeout,
    /// The data contradicts an invariant (for example records without an epoch).
    Corrupt(String),
    /// The store refused the write; nothing changed.
    Refused(String),
}

impl LedgerError {
    /// Whether the call may or may not have taken effect.
    pub fn ambiguous(&self) -> bool {
        matches!(self, LedgerError::Unavailable(_) | LedgerError::Timeout)
    }
}

impl std::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LedgerError::Unavailable(m) => write!(f, "ledger unavailable: {m}"),
            LedgerError::Timeout => write!(f, "ledger call timed out"),
            LedgerError::Corrupt(m) => write!(f, "ledger corrupt: {m}"),
            LedgerError::Refused(m) => write!(f, "ledger refused: {m}"),
        }
    }
}
impl std::error::Error for LedgerError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Begin {
    /// A new `active` row, claimed (fence 1).
    Started(Claim),
    /// The id exists with a different scope, request or configuration.
    Conflict,
    /// Identical request, phase `offered`, no release in flight: replay this.
    Offered(Box<OfferRecord>),
    /// Identical request and a live worker claim.
    InProgress,
    /// Identical request, any other phase (abandoned, finished, releasing, released, tombstone): mint a new id.
    Reused(Phase),
    /// The bounded memory store is full (never evicts).
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Written,
    /// The claim was lost (fence moved, holder differs, or the claim expired): do nothing further.
    Fenced,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReleaseClaim {
    Claimed(Claim, Box<Record>),
    Missing,
    /// A live claim exists.
    Busy,
    AlreadyReleased,
    /// `active`, `finished` or `tombstone`: there is no offer to release.
    NotReleasable(Phase),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    /// `active`/`releasing` rows that are not held by a live worker: what the reaper would take or is taking.
    pub unresolved: usize,
    pub active_live: usize,
    pub offered: usize,
    pub releasing: usize,
    pub released: usize,
    pub finished: usize,
    pub tombstones: usize,
    pub total: usize,
}

/// A fenced compare-and-swap record store with claims. Every method is one short statement or transaction.
pub trait Ledger: Send + Sync {
    /// The ledger's single ownership nonce. Created from `candidate` only when there is no epoch AND no records; records
    /// without an epoch are `Corrupt`. The caller supplies a fresh CSPRNG candidate (this crate generates no randomness).
    fn open_epoch(
        &self,
        candidate: [u8; 32],
    ) -> impl Future<Output = Result<[u8; 32], LedgerError>> + Send;
    /// The store's clock in milliseconds (PostgreSQL: the server's; memory: tokio's, relative to the store's creation).
    fn now_ms(&self) -> impl Future<Output = Result<i64, LedgerError>> + Send;
    fn begin(
        &self,
        identity: &Identity,
        holder: &str,
        lease: Duration,
    ) -> impl Future<Output = Result<Begin, LedgerError>> + Send;
    /// Compare-and-swap: only if `claim` is the live claim of the row; also extends the lease. A move to `offered`,
    /// `finished` or `released` clears the claim. Invalid states or transitions are `Refused`.
    fn write(
        &self,
        claim: &Claim,
        state: &LedgerState,
        phase: Phase,
        lease: Duration,
    ) -> impl Future<Output = Result<WriteOutcome, LedgerError>> + Send;
    /// Expire the claim now, if it is still the row's claim. Best effort.
    fn relinquish(&self, claim: &Claim) -> impl Future<Output = Result<(), LedgerError>> + Send;
    /// Synchronous best-effort relinquish for `Drop` (only a process-local store can do it; others rely on lease expiry).
    fn relinquish_blocking(&self, _claim: &Claim) {}
    /// Claim up to `limit` `active`/`releasing` rows whose claim is expired or absent (fence + 1, kind reaper/release).
    fn claim_reapable(
        &self,
        holder: &str,
        lease: Duration,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<(Claim, Record)>, LedgerError>> + Send;
    /// Claim an `offered` or `releasing` row for an explicit release.
    fn claim_for_release(
        &self,
        request_id: &str,
        holder: &str,
        lease: Duration,
    ) -> impl Future<Output = Result<ReleaseClaim, LedgerError>> + Send;
    fn get(
        &self,
        request_id: &str,
    ) -> impl Future<Output = Result<Option<Record>, LedgerError>> + Send;
    fn counts(&self) -> impl Future<Output = Result<Counts, LedgerError>> + Send;
    /// Retention: turn up to `limit` `finished`/`released` rows older than `older_than` into tombstones.
    fn purge(
        &self,
        limit: usize,
        older_than: Duration,
    ) -> impl Future<Output = Result<usize, LedgerError>> + Send;
}

// ---- fault hook plumbing (a no-op unless the `fault-injection` feature is on) ----

/// A named point before/after a durable write or a backend call. Returns `Err` when a hook asks the point to fail.
#[cfg(feature = "fault-injection")]
pub(crate) async fn fp(stage: &str, kind: &str, label: &str) -> Result<(), String> {
    faults::point(&format!("{stage}.{kind}.{label}")).await
}
#[cfg(not(feature = "fault-injection"))]
#[inline(always)]
pub(crate) async fn fp(_stage: &str, _kind: &str, _label: &str) -> Result<(), String> {
    Ok(())
}

/// The mutants of the negative controls (`RH_PLACEMENT_MUTANT`, feature `fault-injection` only).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mutant {
    /// Effects are sent without the prior intent write.
    SkipWriteAhead,
    /// The binding comparison on describe/stop receipts is skipped.
    SkipOwnershipCheck,
    /// The store's write ignores the fence.
    SkipFencing,
    /// Cleanup or the offer is marked done before the effect is confirmed.
    PrematureCompletion,
}

#[cfg(feature = "fault-injection")]
pub(crate) fn mutant(m: Mutant) -> bool {
    faults::active_mutant() == Some(m)
}
#[cfg(not(feature = "fault-injection"))]
#[inline(always)]
pub(crate) fn mutant(_m: Mutant) -> bool {
    false
}
