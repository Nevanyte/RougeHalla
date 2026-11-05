//! The orchestration: plan, place, wait, widen, publish a hostname, verify it, hand the client a URL.
//!
//! All waiting uses `tokio::time`, so the tests run on a paused clock. Nothing here blocks a game tick: this code runs in the
//! placement service, a different process from every game server.

use crate::backend::*;
use crate::hostname::game_hostname;
use crate::ledger::memory::MemoryLedger;
use crate::ledger::{
    fp, mutant, AttemptRec, Begin, Claim, DnsStep, Fulfilled, Identity, Ledger, LedgerError,
    LedgerState, Mutant, OfferRecord, Phase, ReleaseClaim, ReleaseRec, Resolution, Scope,
    StartStep, StopStep, TermStep,
};
use crate::model::*;
use crate::score::{self, Attempt, AttemptKind, Plan, PlanError};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::{sleep, Instant};

mod run;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServiceConfig {
    pub regions: Vec<RegionConfig>,
    pub policy: PlacementPolicy,
    /// GameLift queue name (in the queue's home Region).
    pub queue_name: String,
    /// The game DNS zone, e.g. `g.rougehalla.com` (the wildcard certificate covers `*.` of it).
    pub zone: String,
    /// `MaximumPlayerSessionCount`.
    pub max_players: u32,
}

/// What the client is given.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinOffer {
    pub region: String,
    pub hostname: String,
    pub port: u16,
    /// `wss://<hostname>:<port>/ws`
    pub url: String,
    pub placement_id: String,
    pub game_session_arn: String,
    /// `(callsign, GameLift player session id)`. The id never goes to the browser's Hello (CONTROL_API.md section 4).
    pub player_sessions: Vec<(String, String)>,
    pub warnings: Vec<Warning>,
    pub attempts_used: usize,
}

/// Progress the UI can narrate while the request is open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Progress {
    Searching {
        attempt: usize,
        of: usize,
        kind: AttemptKind,
        regions: Vec<String>,
    },
    /// The previous attempt placed nothing within its timeout; the next one asks for more regions.
    Widening {
        after: AttemptKind,
    },
    PreparingHost {
        region: String,
    },
    Ready {
        region: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlaceError {
    Invalid(String),
    UnknownRegion(String),
    Refused(Refusal),
    /// Every attempt in the ladder ended without a host.
    NoCapacity {
        attempts: usize,
    },
    /// A manual region produced no host within the budget. Nothing else was tried (strict override).
    OverrideUnavailable {
        region: String,
    },
    /// GameLift or the capacity metrics were not usable (throttling, outage). Retryable.
    ServiceUnavailable(String),
    /// A host was placed but its hostname could not be published or verified; the host was released.
    DnsUnavailable,
    /// This `request_id` already produced a finished, non-fulfilled placement. Mint a new one.
    RequestIdReused,
}

impl PlaceError {
    pub fn code(&self) -> &'static str {
        match self {
            PlaceError::Invalid(_) => "invalid_request",
            PlaceError::UnknownRegion(_) => "unknown_region",
            PlaceError::Refused(r) => r.code(),
            PlaceError::NoCapacity { .. } => "no_capacity",
            PlaceError::OverrideUnavailable { .. } => "region_unavailable",
            PlaceError::ServiceUnavailable(_) => "service_unavailable",
            PlaceError::DnsUnavailable => "host_not_ready",
            PlaceError::RequestIdReused => "request_id_reused",
        }
    }
    /// What the player reads. Never includes AWS error text or ids.
    pub fn user_message(&self) -> String {
        match self {
            PlaceError::Invalid(_) => {
                "Something went wrong preparing the match. Please try again.".into()
            }
            PlaceError::UnknownRegion(_) => "That region is not available.".into(),
            PlaceError::Refused(r) => r.text(),
            PlaceError::NoCapacity { .. } => {
                "All servers are busy right now. Please try again in a minute.".into()
            }
            PlaceError::OverrideUnavailable { region } => format!(
                "{region} has no free server right now. Choose automatic, or try again shortly."
            ),
            PlaceError::ServiceUnavailable(_) => {
                "Matchmaking is temporarily unavailable. Please try again.".into()
            }
            PlaceError::DnsUnavailable => {
                "The server was found but is not reachable yet. Please try again.".into()
            }
            PlaceError::RequestIdReused => {
                "That request already finished. Please start the match again.".into()
            }
        }
    }
    /// Whether retrying with a *new* request id is reasonable without the player changing anything.
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            PlaceError::NoCapacity { .. }
                | PlaceError::ServiceUnavailable(_)
                | PlaceError::DnsUnavailable
                | PlaceError::RequestIdReused
                | PlaceError::OverrideUnavailable { .. }
        )
    }
}

/// Budgets and retention of the durable machinery. NOT part of [`ServiceConfig`]: the ownership binding and request
/// identity do not depend on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DurabilityConfig {
    /// A `place` call renews its claim at least every third of this; a dead worker is reapable after it.
    pub worker_lease: Duration,
    pub reaper_lease: Duration,
    /// Every ledger call runs under this budget; elapsed means the outcome of a write is unknown.
    pub db_op_timeout: Duration,
    /// Every backend (GameLift/DNS) call runs under this budget; elapsed is treated as `Unavailable` (ambiguous).
    pub backend_op_timeout: Duration,
    /// A start that never produced a receipt is `Settled` only after two NotFound answers AND this long after its intent.
    /// Boundary: a provider start delayed beyond it is untracked (the game host's unclaimed-session timeout bounds its cost).
    pub start_settle_after: Duration,
    /// Rows one `reap_abandoned` pass claims.
    pub reap_batch: usize,
    /// `finished`/`released` rows older than this become tombstones (`purge_retained`).
    pub retention: Duration,
}

impl Default for DurabilityConfig {
    fn default() -> Self {
        Self {
            worker_lease: Duration::from_secs(90),
            reaper_lease: Duration::from_secs(120),
            db_op_timeout: Duration::from_secs(5),
            backend_op_timeout: Duration::from_secs(20),
            start_settle_after: Duration::from_secs(3600),
            reap_batch: 16,
            retention: Duration::from_secs(30 * 24 * 3600),
        }
    }
}

/// Why `release_session` did nothing. No DNS call is made for any variant but `Unavailable`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReleaseError {
    /// No such request id in this scope (a foreign scope is indistinguishable from absence).
    Unknown,
    /// The request exists but `placement_id` is not its offer's.
    WrongPlacement,
    /// The request has no offer to release (still active, finished without a host).
    NotOffered,
    /// Another release or reaper holds the claim; retry.
    Busy,
    /// The ledger or DNS failed; durable release intent is kept and a retry (or the reaper) resumes it.
    Unavailable(String),
}

impl std::fmt::Display for ReleaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReleaseError::Unknown => write!(f, "unknown request"),
            ReleaseError::WrongPlacement => write!(f, "placement does not match the offer"),
            ReleaseError::NotOffered => write!(f, "request has no offer to release"),
            ReleaseError::Busy => write!(f, "release already in progress"),
            ReleaseError::Unavailable(m) => write!(f, "release unavailable: {m}"),
        }
    }
}
impl std::error::Error for ReleaseError {}

impl From<OfferRecord> for JoinOffer {
    fn from(o: OfferRecord) -> Self {
        JoinOffer {
            region: o.region,
            hostname: o.hostname,
            port: o.port,
            url: o.url,
            placement_id: o.placement_id,
            game_session_arn: o.game_session_arn,
            player_sessions: o.player_sessions,
            warnings: o.warnings,
            attempts_used: o.attempts_used,
        }
    }
}

impl From<&JoinOffer> for OfferRecord {
    fn from(o: &JoinOffer) -> Self {
        OfferRecord {
            region: o.region.clone(),
            hostname: o.hostname.clone(),
            port: o.port,
            url: o.url.clone(),
            placement_id: o.placement_id.clone(),
            game_session_arn: o.game_session_arn.clone(),
            player_sessions: o.player_sessions.clone(),
            warnings: o.warnings.clone(),
            attempts_used: o.attempts_used,
        }
    }
}

enum Outcome {
    Fulfilled(PlacementState),
    /// Cancelled, failed, timed out: no host from this attempt.
    NoHost,
}

/// `L` defaults to the process-local [`MemoryLedger`]; use [`PlacementService::with_ledger`] for a durable one.
pub struct PlacementService<G, D, L = MemoryLedger> {
    ownership_nonce: [u8; 32],
    pub cfg: ServiceConfig,
    pub gamelift: G,
    pub dns: D,
    pub durability: DurabilityConfig,
    ledger: Arc<L>,
}

fn holder_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed))
}

fn ledger_unavailable() -> PlaceError {
    PlaceError::ServiceUnavailable("placement ledger unavailable".into())
}

impl<G, D> PlacementService<G, D, MemoryLedger> {
    /// A service with a fresh process-local ledger (bounded, not durable). `ownership_nonce` must be globally unique to this
    /// ownership epoch, generated with a cryptographic RNG. Fixed arrays are test values only.
    pub fn new(ownership_nonce: [u8; 32], cfg: ServiceConfig, gamelift: G, dns: D) -> Self {
        let ledger = MemoryLedger::new();
        let nonce = ledger
            .open_epoch_now(ownership_nonce)
            .expect("a fresh memory ledger has no records");
        Self {
            ownership_nonce: nonce,
            cfg,
            gamelift,
            dns,
            durability: DurabilityConfig::default(),
            ledger: Arc::new(ledger),
        }
    }

    /// Unresolved requests: `active`/`releasing` rows not held by a live worker (cleanup pending or in flight).
    pub fn abandoned_count(&self) -> usize {
        self.ledger.counts_now().unresolved
    }
}

impl<G: GameLiftBackend, D: DnsBackend, L: Ledger> PlacementService<G, D, L> {
    /// A service over any ledger. The ownership nonce is the ledger's (`open_epoch`): `candidate_nonce` is used only when the
    /// ledger has no epoch and no records, so a restart keeps the old epoch and never mints one over old records.
    /// Generate `candidate_nonce` with a cryptographic RNG; this crate generates no randomness.
    pub async fn with_ledger(
        candidate_nonce: [u8; 32],
        cfg: ServiceConfig,
        gamelift: G,
        dns: D,
        ledger: L,
        durability: DurabilityConfig,
    ) -> Result<Self, LedgerError> {
        let nonce = tokio::time::timeout(
            durability.db_op_timeout,
            ledger.open_epoch(candidate_nonce),
        )
        .await
        .map_err(|_| LedgerError::Timeout)??;
        Ok(Self {
            ownership_nonce: nonce,
            cfg,
            gamelift,
            dns,
            durability,
            ledger: Arc::new(ledger),
        })
    }

    pub fn ledger(&self) -> &L {
        &self.ledger
    }

    /// `active`/`releasing` rows not held by a live worker.
    pub async fn unresolved_count(&self) -> Result<usize, LedgerError> {
        Ok(self.db(self.ledger.counts()).await?.unresolved)
    }

    /// Retention: tombstone up to `reap_batch` finished/released rows older than `durability.retention`.
    /// A tombstone keeps id, scope and fingerprint, so a purged id can never replay or restart.
    pub async fn purge_retained(&self) -> Result<usize, LedgerError> {
        self.db(
            self.ledger
                .purge(self.durability.reap_batch, self.durability.retention),
        )
        .await
    }

    async fn db<T>(
        &self,
        f: impl std::future::Future<Output = Result<T, LedgerError>>,
    ) -> Result<T, LedgerError> {
        match tokio::time::timeout(self.durability.db_op_timeout, f).await {
            Ok(r) => r,
            Err(_) => Err(LedgerError::Timeout),
        }
    }

    /// One backend call under `backend_op_timeout`; elapsed is `Unavailable`.
    async fn be<T>(
        &self,
        label: &str,
        f: impl std::future::Future<Output = Result<T, BackendError>>,
    ) -> Result<T, BackendError> {
        if let Err(m) = fp("before", "backend", label).await {
            return Err(BackendError::Unavailable(m));
        }
        let r = match tokio::time::timeout(self.durability.backend_op_timeout, f).await {
            Ok(r) => r,
            Err(_) => Err(BackendError::Unavailable("backend call timed out".into())),
        };
        if let Err(m) = fp("after", "backend", label).await {
            return Err(BackendError::Unavailable(m));
        }
        r
    }
    async fn bk_start(&self, sp: &StartPlacement) -> Result<PlacementState, BackendError> {
        self.be("start_placement", self.gamelift.start_placement(sp))
            .await
    }
    async fn bk_describe(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.be("describe_placement", self.gamelift.describe_placement(id))
            .await
    }
    async fn bk_stop(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.be("stop_placement", self.gamelift.stop_placement(id))
            .await
    }
    async fn bk_terminate(&self, arn: &str) -> Result<(), BackendError> {
        self.be(
            "terminate_game_session",
            self.gamelift.terminate_game_session(arn),
        )
        .await
    }
    async fn bk_upsert(&self, name: &str, ip: &str, ttl: u32) -> Result<(), BackendError> {
        self.be("dns_upsert", self.dns.upsert(name, ip, ttl)).await
    }
    async fn bk_delete(&self, name: &str) -> Result<(), BackendError> {
        self.be("dns_delete", self.dns.delete(name)).await
    }
    async fn bk_resolve(&self, name: &str) -> Result<Vec<String>, BackendError> {
        self.be("dns_resolve", self.dns.resolve_authoritative(name))
            .await
    }

    /// Plan only (no GameLift write): what `place` would ask for. Capacity read failures are ignored (unknown capacity).
    pub async fn plan(&self, req: &PlacementRequest) -> Result<Plan, PlaceError> {
        let capacity = self
            .be("capacity", self.gamelift.capacity())
            .await
            .unwrap_or_default();
        score::plan(&self.cfg.regions, &self.cfg.policy, &capacity, req).map_err(plan_error)
    }

    /// `place_scoped` in the default scope.
    pub async fn place(&self, req: &PlacementRequest) -> Result<JoinOffer, PlaceError> {
        self.place_with_scoped(&Scope::default(), req, &mut |_| {})
            .await
    }

    pub async fn place_with(
        &self,
        req: &PlacementRequest,
        observe: &mut (dyn FnMut(Progress) + Send),
    ) -> Result<JoinOffer, PlaceError> {
        self.place_with_scoped(&Scope::default(), req, observe)
            .await
    }

    pub async fn place_scoped(
        &self,
        scope: &Scope,
        req: &PlacementRequest,
    ) -> Result<JoinOffer, PlaceError> {
        self.place_with_scoped(scope, req, &mut |_| {}).await
    }

    /// `scope` is a trusted namespace (for example the authenticated account): it is part of request identity, not
    /// authentication. The request id is the ledger key; the same id with another scope, request or config is `Invalid`
    /// and fails before any external call.
    pub async fn place_with_scoped(
        &self,
        scope: &Scope,
        req: &PlacementRequest,
        observe: &mut (dyn FnMut(Progress) + Send),
    ) -> Result<JoinOffer, PlaceError> {
        score::plan(&self.cfg.regions, &self.cfg.policy, &BTreeMap::new(), req)
            .map_err(plan_error)?;
        let identity = self.identity(scope, req);
        // Claim before any external call, including the capacity lookup.
        let lease = self.durability.worker_lease;
        let began = self
            .db(self.ledger.begin(&identity, &holder_id(), lease))
            .await
            .map_err(|_| ledger_unavailable())?;
        let claim = match began {
            Begin::Started(c) => c,
            Begin::Conflict => {
                return Err(PlaceError::Invalid(
                    "request id belongs to different input".into(),
                ))
            }
            Begin::Offered(o) => return Ok((*o).into()),
            Begin::InProgress => {
                return Err(PlaceError::ServiceUnavailable(
                    "request already in progress".into(),
                ))
            }
            Begin::Reused(_) => return Err(PlaceError::RequestIdReused),
            Begin::Full => {
                return Err(PlaceError::ServiceUnavailable("request ledger full".into()))
            }
        };
        let mut run = run::Run::new(
            self,
            claim,
            identity.zone,
            LedgerState::default(),
            Phase::Active,
            lease,
        );
        let res = run.place(req, observe).await;
        run.finish_place(res).await
    }

    fn identity(&self, scope: &Scope, req: &PlacementRequest) -> Identity {
        let payload = serde_json::to_vec(&(
            "rh-placement-identity-v1",
            scope.as_str(),
            req,
            &self.cfg,
        ))
        .expect("serializable placement identity");
        Identity {
            request_id: req.request_id.clone(),
            scope: scope.as_str().to_string(),
            fingerprint: format!("{:x}", Sha256::digest(payload)),
            request_json: serde_json::to_string(req).expect("serializable request"),
            config_json: serde_json::to_string(&self.cfg).expect("serializable config"),
            zone: self.cfg.zone.clone(),
        }
    }

    fn start_request(&self, req: &PlacementRequest, n: usize, attempt: &Attempt) -> StartPlacement {
        let payload = serde_json::to_vec(&(
            "rh-placement-ownership-v1",
            self.ownership_nonce,
            req,
            &self.cfg,
            n,
            &attempt.locations,
        ))
        .expect("serializable placement identity");
        let binding = format!("{:x}", Sha256::digest(payload));
        StartPlacement {
            // 3 + <=32 + 1 + <=2 characters: inside GameLift's 48.
            placement_id: format!("rh-{}-{n}", req.request_id),
            queue_name: self.cfg.queue_name.clone(),
            max_player_sessions: self.cfg.max_players,
            players: req.party.iter().map(|m| m.callsign.clone()).collect(),
            game_session_data:
                serde_json::json!({"requestId": req.request_id, "ownership": binding}).to_string(),
            location_order: attempt.locations.clone(),
            fallback: Fallback::None,
        }
    }

    /// Explicit session end, called by a trusted session-end hook (not an HTTP authorization). The ledger validates that
    /// `scope`/`request_id` own an offer whose placement is `placement_id`, records the release intent durably, deletes the
    /// offer's hostname (in the zone stored with the request) and records completion. A duplicate is `Ok` with no DNS call;
    /// a retry of a half-done release resumes it. Nothing else deletes an offer's DNS: no automatic path infers session end.
    pub async fn release_session(
        &self,
        scope: &Scope,
        request_id: &str,
        placement_id: &str,
    ) -> Result<(), ReleaseError> {
        let down = |_: LedgerError| ReleaseError::Unavailable("placement ledger unavailable".into());
        let rec = self
            .db(self.ledger.get(request_id))
            .await
            .map_err(down)?
            .ok_or(ReleaseError::Unknown)?;
        if check_release(&rec, scope, placement_id)? {
            return Ok(());
        }
        let lease = self.durability.reaper_lease;
        let (claim, rec) = match self
            .db(self.ledger.claim_for_release(request_id, &holder_id(), lease))
            .await
            .map_err(down)?
        {
            ReleaseClaim::Claimed(c, r) => (c, *r),
            ReleaseClaim::Missing => return Err(ReleaseError::Unknown),
            ReleaseClaim::Busy => return Err(ReleaseError::Busy),
            ReleaseClaim::AlreadyReleased => return Ok(()),
            ReleaseClaim::NotReleasable(_) => return Err(ReleaseError::NotOffered),
        };
        let mut run = run::Run::new(
            self,
            claim,
            rec.identity.zone.clone(),
            rec.state.clone(),
            rec.phase,
            lease,
        );
        // Re-validate against the claimed row: the first check raced other callers.
        if let Err(e) = check_release(&rec, scope, placement_id) {
            run.give_up().await;
            return Err(e);
        }
        let done = async {
            if rec.phase == Phase::Offered {
                let at = run.now().await?;
                run.state.release = Some(ReleaseRec {
                    intent_at_ms: at,
                    done_at_ms: None,
                });
                run.commit("release_intent", Phase::Releasing).await?;
            }
            run.finish_release().await
        }
        .await;
        match done {
            Ok(true) => {
                run.disarm();
                Ok(())
            }
            _ => {
                run.give_up().await;
                Err(ReleaseError::Unavailable("release pending".into()))
            }
        }
    }
}

/// `Ok(true)`: already released, nothing to do.
fn check_release(
    rec: &crate::ledger::Record,
    scope: &Scope,
    placement_id: &str,
) -> Result<bool, ReleaseError> {
    if rec.identity.scope != scope.as_str() {
        return Err(ReleaseError::Unknown);
    }
    match rec.phase {
        Phase::Tombstone => match rec.final_phase {
            Some(Phase::Released) => Ok(true),
            _ => Err(ReleaseError::NotOffered),
        },
        Phase::Offered | Phase::Releasing | Phase::Released => match &rec.state.offer {
            Some(o) if o.placement_id == placement_id => Ok(rec.phase == Phase::Released),
            _ => Err(ReleaseError::WrongPlacement),
        },
        _ => Err(ReleaseError::NotOffered),
    }
}

fn plan_error(e: PlanError) -> PlaceError {
    match e {
        PlanError::Invalid(m) => PlaceError::Invalid(m),
        PlanError::UnknownRegion(r) => PlaceError::UnknownRegion(r),
        PlanError::Refused(r) => PlaceError::Refused(r),
    }
}

fn unavailable(e: BackendError) -> PlaceError {
    match e {
        BackendError::Unavailable(m) => PlaceError::ServiceUnavailable(m),
        BackendError::Invalid(m) => PlaceError::Invalid(m),
        BackendError::AlreadyExists => PlaceError::Invalid("unexpected AlreadyExists".into()),
        BackendError::NotFound => PlaceError::Invalid("placement not found".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake::{Call, FakeDns, FakeGameLift, RegionBehaviour::*};
    use std::collections::BTreeMap;

    fn cfg() -> ServiceConfig {
        ServiceConfig {
            regions: ["us-west-2", "ca-central-1", "us-east-2"]
                .iter()
                .map(|id| RegionConfig {
                    id: id.to_string(),
                    label: id.to_string(),
                    probe_url: String::new(),
                })
                .collect(),
            policy: PlacementPolicy::default(),
            queue_name: "rh-q".into(),
            zone: "g.rougehalla.com".into(),
            max_players: 8,
        }
    }

    fn member(name: &str, rtts: &[(&str, u32)]) -> MemberReport {
        MemberReport {
            callsign: name.into(),
            age_s: 1,
            rtt_ms: rtts
                .iter()
                .map(|(r, v)| (r.to_string(), Some(*v)))
                .collect::<BTreeMap<_, _>>(),
        }
    }

    fn req(id: &str, party: Vec<MemberReport>) -> PlacementRequest {
        PlacementRequest {
            request_id: id.into(),
            party,
            region_override: None,
        }
    }

    fn fulfil(ip: &str) -> crate::fake::RegionBehaviour {
        Fulfil {
            after_polls: 1,
            ip: ip.into(),
            port: 35010,
        }
    }

    fn alice() -> MemberReport {
        member(
            "alice",
            &[("us-west-2", 30), ("ca-central-1", 70), ("us-east-2", 140)],
        )
    }

    #[tokio::test(start_paused = true)]
    async fn happy_path_publishes_a_verified_hostname_and_never_sends_latencies() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let mut seen = Vec::new();
        let offer = svc
            .place_with(
                &req(
                    "req00001",
                    vec![
                        alice(),
                        member(
                            "bobby",
                            &[("us-west-2", 40), ("ca-central-1", 60), ("us-east-2", 120)],
                        ),
                    ],
                ),
                &mut |p| seen.push(p),
            )
            .await
            .unwrap();
        assert_eq!(offer.region, "us-west-2");
        assert!(
            offer.hostname.starts_with("us-west-2-")
                && offer.hostname.ends_with(".g.rougehalla.com")
        );
        assert_eq!(offer.url, format!("wss://{}:35010/ws", offer.hostname));
        assert_eq!(offer.player_sessions.len(), 2);
        assert_eq!(
            svc.dns.records().get(&offer.hostname).unwrap(),
            "203.0.113.10"
        );
        assert!(matches!(seen.last(), Some(Progress::Ready { .. })));
        // Exactly one start, fallback NONE, locations in rank order, whole party as desired player sessions.
        let starts = svc.gamelift.starts();
        assert_eq!(starts.len(), 1);
        assert_eq!(starts[0].0, "rh-req00001-1");
        assert_eq!(starts[0].1, ["us-west-2", "ca-central-1"], "east is acceptable for bobby (140 ms), not preferred, so it waits for the second attempt");
        let sp = svc.start_request(
            &req("req00001", vec![alice()]),
            1,
            &score::Attempt {
                kind: AttemptKind::Preferred,
                locations: vec!["us-west-2".into()],
                timeout: Duration::from_secs(1),
            },
        );
        let j = sp.to_api_json();
        assert!(j.get("PlayerLatencies").is_none());
        assert_eq!(
            j["PriorityConfigurationOverride"]["PlacementFallbackStrategy"],
            "NONE"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn widens_when_the_preferred_region_has_no_host_then_uses_the_next() {
        // west never has a host; ca-central-1 does. Attempt 1 (west only) times out and is cancelled, attempt 2 lands in ca.
        let gl = FakeGameLift::new(&[
            ("us-west-2", NoHost),
            ("ca-central-1", fulfil("198.51.100.7")),
        ]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let r = req(
            "req00002",
            vec![member(
                "alice",
                &[("us-west-2", 30), ("ca-central-1", 130), ("us-east-2", 150)],
            )],
        );
        let mut seen = Vec::new();
        let offer = svc.place_with(&r, &mut |p| seen.push(p)).await.unwrap();
        assert_eq!(offer.region, "ca-central-1");
        assert_eq!(offer.attempts_used, 2);
        let calls = svc.gamelift.calls();
        assert!(
            calls.contains(&Call::Stop("rh-req00002-1".into())),
            "the first placement is cancelled before widening: {calls:?}"
        );
        assert!(seen.iter().any(|p| matches!(
            p,
            Progress::Widening {
                after: AttemptKind::Preferred
            }
        )));
        // Placement ids are distinct per attempt (GameLift never reuses an id).
        let ids: Vec<_> = svc.gamelift.starts().into_iter().map(|s| s.0).collect();
        assert_eq!(ids, ["rh-req00002-1", "rh-req00002-2"]);
    }

    #[tokio::test(start_paused = true)]
    async fn no_host_anywhere_ends_within_the_total_budget_with_no_capacity() {
        let gl = FakeGameLift::new(&[
            ("us-west-2", NoHost),
            ("ca-central-1", NoHost),
            ("us-east-2", NoHost),
        ]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let t0 = Instant::now();
        let e = svc
            .place(&req(
                "req00003",
                vec![member(
                    "alice",
                    &[("us-west-2", 30), ("ca-central-1", 100), ("us-east-2", 150)],
                )],
            ))
            .await
            .unwrap_err();
        assert!(matches!(e, PlaceError::NoCapacity { .. }), "{e:?}");
        assert!(t0.elapsed() <= cfg().policy.total_budget() + Duration::from_secs(2));
        assert_eq!(e.code(), "no_capacity");
        assert!(e.retryable());
        // Every started placement was cancelled: nothing is left to fulfil behind the player's back.
        let stops = svc
            .gamelift
            .calls()
            .iter()
            .filter(|c| matches!(c, Call::Stop(_)))
            .count();
        assert_eq!(stops, svc.gamelift.starts().len());
    }

    #[tokio::test(start_paused = true)]
    async fn manual_region_is_strict_and_reports_that_region_unavailable() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10")), ("us-east-2", NoHost)]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let mut r = req("req00004", vec![alice()]);
        r.region_override = Some("us-east-2".into());
        let e = svc.place(&r).await.unwrap_err();
        assert_eq!(
            e,
            PlaceError::OverrideUnavailable {
                region: "us-east-2".into()
            }
        );
        // It never fell back to the region that did have a host.
        assert!(svc
            .gamelift
            .starts()
            .iter()
            .all(|(_, locs)| locs == &["us-east-2".to_string()]));
        // And with a host there, it lands exactly there even though west is far better for this player.
        let gl = FakeGameLift::new(&[
            ("us-west-2", fulfil("203.0.113.10")),
            ("us-east-2", fulfil("192.0.2.44")),
        ]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc.place(&r).await.unwrap();
        assert_eq!(offer.region, "us-east-2");
    }

    #[tokio::test(start_paused = true)]
    async fn refusals_and_validation_never_touch_gamelift() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let walled = MemberReport {
            callsign: "walled".into(),
            age_s: 1,
            rtt_ms: [("us-west-2".to_string(), None)].into_iter().collect(),
        };
        assert_eq!(
            svc.place(&req("req00005", vec![walled])).await.unwrap_err(),
            PlaceError::Refused(Refusal::NoReachableRegion)
        );
        assert!(matches!(
            svc.place(&req("x", vec![alice()])).await.unwrap_err(),
            PlaceError::Invalid(_)
        ));
        assert!(svc.gamelift.starts().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn retried_request_attaches_to_the_existing_placement() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let r = req("req00006", vec![alice()]);
        let a = svc.place(&r).await.unwrap();
        let b = svc.place(&r).await.unwrap();
        assert_eq!(a.hostname, b.hostname);
        assert_eq!(a.game_session_arn, b.game_session_arn);
    }

    #[tokio::test(start_paused = true)]
    async fn a_finished_failed_request_id_is_not_reused() {
        let gl = FakeGameLift::new(&[
            ("us-west-2", Fail),
            ("ca-central-1", Fail),
            ("us-east-2", Fail),
        ]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let r = req("req00007", vec![alice()]);
        assert!(matches!(
            svc.place(&r).await.unwrap_err(),
            PlaceError::NoCapacity { .. }
        ));
        assert_eq!(
            svc.place(&r).await.unwrap_err(),
            PlaceError::RequestIdReused
        );
    }

    #[tokio::test(start_paused = true)]
    async fn queue_timeout_is_handled_like_no_host() {
        let gl = FakeGameLift::new(&[
            ("us-west-2", NoHost),
            ("ca-central-1", fulfil("198.51.100.7")),
        ])
        .with_queue_timeout_polls(3);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc
            .place(&req(
                "req00008",
                vec![member("alice", &[("us-west-2", 30), ("ca-central-1", 90)])],
            ))
            .await
            .unwrap();
        assert_eq!(offer.region, "ca-central-1");
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_that_races_a_fulfilment_uses_the_session_instead_of_orphaning_it() {
        // after_polls is larger than the polls inside the attempt window, so only the racing stop fulfils it.
        let gl = FakeGameLift::new(&[(
            "us-west-2",
            Fulfil {
                after_polls: 10_000,
                ip: "203.0.113.10".into(),
                port: 35010,
            },
        )])
        .with_fulfil_on_stop();
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc
            .place(&req(
                "req00009",
                vec![member("alice", &[("us-west-2", 30)])],
            ))
            .await
            .unwrap();
        assert_eq!(offer.region, "us-west-2");
        assert!(svc.gamelift.terminated().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn fulfilled_placement_missing_its_port_terminates_the_session() {
        // A fulfilled placement with an unusable address must not leave a running host behind (P-M4).
        let gl = FakeGameLift::new(&[(
            "us-west-2",
            Fulfil {
                after_polls: 0,
                ip: "203.0.113.10".into(),
                port: 0,
            },
        )]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let e = svc
            .place(&req(
                "req00030",
                vec![member("alice", &[("us-west-2", 30)])],
            ))
            .await
            .unwrap_err();
        assert!(matches!(e, PlaceError::Invalid(_)), "{e:?}");
        assert_eq!(
            svc.gamelift.terminated().len(),
            1,
            "the session is terminated"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn hostname_error_after_fulfilment_terminates_the_session() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let mut c = cfg();
        c.zone = ".bad-zone".into(); // game_hostname refuses it
        let svc = PlacementService::new([1; 32], c, gl, FakeDns::new());
        let e = svc
            .place(&req(
                "req00031",
                vec![member("alice", &[("us-west-2", 30)])],
            ))
            .await
            .unwrap_err();
        assert!(matches!(e, PlaceError::Invalid(_)), "{e:?}");
        assert_eq!(
            svc.gamelift.terminated().len(),
            1,
            "the session is terminated"
        );
        assert!(svc.dns.records().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn dropping_place_mid_attempt_queues_the_placement_and_the_reaper_stops_it() {
        let gl = FakeGameLift::new(&[("us-west-2", NoHost)]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let r = req("req00032", vec![member("alice", &[("us-west-2", 30)])]);
        // The caller gives up after 2 s, while the placement is still PENDING at GameLift.
        let out = tokio::time::timeout(Duration::from_secs(2), svc.place(&r)).await;
        assert!(out.is_err(), "the place future was dropped mid-attempt");
        let starts = svc.gamelift.starts();
        assert_eq!(starts.len(), 1);
        assert_eq!(
            svc.abandoned_count(),
            1,
            "the dropped placement is recorded"
        );
        assert!(
            !svc.gamelift
                .calls()
                .iter()
                .any(|c| matches!(c, Call::Stop(_))),
            "dropping cannot cancel by itself: that is the reaper's job"
        );
        assert_eq!(svc.reap_abandoned().await, 1);
        assert!(svc
            .gamelift
            .calls()
            .contains(&Call::Stop(starts[0].0.clone())));
        assert_eq!(svc.abandoned_count(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn reaper_terminates_a_placement_that_fulfilled_after_the_drop() {
        let gl = FakeGameLift::new(&[(
            "us-west-2",
            Fulfil {
                after_polls: 5,
                ip: "203.0.113.10".into(),
                port: 35010,
            },
        )]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let r = req("req00033", vec![member("alice", &[("us-west-2", 30)])]);
        let out = tokio::time::timeout(Duration::from_millis(1500), svc.place(&r)).await;
        assert!(out.is_err());
        assert_eq!(svc.abandoned_count(), 1);
        // Fulfilment arrives while nobody is waiting: reaping finds it fulfilled (or refuses the stop, then re-describes).
        for _ in 0..6 {
            let _ = svc.gamelift.describe_placement("rh-req00033-1").await;
        }
        assert_eq!(svc.reap_abandoned().await, 1);
        assert_eq!(svc.gamelift.terminated().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn completed_requests_leave_nothing_for_the_reaper() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        svc.place(&req(
            "req00034",
            vec![member("alice", &[("us-west-2", 30)])],
        ))
        .await
        .unwrap();
        assert_eq!(svc.abandoned_count(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn dns_publication_is_verified_before_the_client_gets_the_name() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new().with_resolve_delay(4));
        let offer = svc.place(&req("req00010", vec![alice()])).await.unwrap();
        // Four empty authoritative answers were waited out; the offer exists only after the fifth showed the address.
        assert!(svc.dns.records().contains_key(&offer.hostname));
    }

    #[tokio::test(start_paused = true)]
    async fn dns_failure_releases_the_host_and_reports_not_ready() {
        let gl = FakeGameLift::new(&[
            ("us-west-2", fulfil("203.0.113.10")),
            ("ca-central-1", fulfil("198.51.100.7")),
            ("us-east-2", fulfil("192.0.2.9")),
        ]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new().failing_upserts(1000));
        let e = svc
            .place(&req("req00011", vec![alice()]))
            .await
            .unwrap_err();
        assert_eq!(e, PlaceError::DnsUnavailable);
        assert!(
            !svc.gamelift.terminated().is_empty(),
            "every placed session without a name is terminated"
        );
        assert!(svc.dns.records().is_empty());
        assert!(
            !e.user_message().contains("rh-"),
            "no internal ids in user text"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn dns_that_never_propagates_is_cleaned_up_too() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new(
            [1; 32],
            cfg(),
            gl,
            FakeDns::new().with_resolve_delay(u32::MAX),
        );
        let e = svc
            .place(&req(
                "req00012",
                vec![member("alice", &[("us-west-2", 30)])],
            ))
            .await
            .unwrap_err();
        assert_eq!(e, PlaceError::DnsUnavailable);
        assert!(svc.dns.records().is_empty());
        assert!(svc.dns.log().iter().any(|l| l.starts_with("delete ")));
    }

    #[tokio::test(start_paused = true)]
    async fn capacity_outage_does_not_block_placement() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]).with_capacity_error();
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        assert!(svc.place(&req("req00013", vec![alice()])).await.is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn zero_capacity_steers_the_first_attempt_to_another_region() {
        let gl = FakeGameLift::new(&[
            ("us-west-2", fulfil("203.0.113.10")),
            ("ca-central-1", fulfil("198.51.100.7")),
        ])
        .with_capacity(&[("us-west-2", Some(0)), ("ca-central-1", Some(4))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc
            .place(&req(
                "req00014",
                vec![member("alice", &[("us-west-2", 50), ("ca-central-1", 75)])],
            ))
            .await
            .unwrap();
        assert_eq!(offer.region, "ca-central-1");
        assert_eq!(svc.gamelift.starts()[0].1, ["ca-central-1"]);
    }

    #[tokio::test(start_paused = true)]
    async fn transient_start_errors_are_retried_and_persistent_ones_surface() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))])
            .with_start_errors(vec![BackendError::Unavailable("throttled".into())]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        assert!(svc.place(&req("req00015", vec![alice()])).await.is_ok());
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))])
            .with_start_errors(vec![BackendError::Unavailable("a".into()); 5]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let e = svc
            .place(&req("req00016", vec![alice()]))
            .await
            .unwrap_err();
        assert!(matches!(e, PlaceError::ServiceUnavailable(_)));
        assert!(!e.user_message().contains("throttled"));
    }

    #[tokio::test(start_paused = true)]
    async fn persistent_describe_errors_cancel_the_placement_and_surface() {
        let gl = FakeGameLift::new(&[(
            "us-west-2",
            Fulfil {
                after_polls: 10_000,
                ip: "203.0.113.10".into(),
                port: 35010,
            },
        )])
        .with_describe_errors(100);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let e = svc
            .place(&req(
                "req00017",
                vec![member("alice", &[("us-west-2", 30)])],
            ))
            .await
            .unwrap_err();
        assert!(matches!(e, PlaceError::ServiceUnavailable(_)));
        assert!(svc
            .gamelift
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Stop(_))));
    }

    #[tokio::test(start_paused = true)]
    async fn placement_in_an_over_limit_region_carries_a_warning() {
        let gl = FakeGameLift::new(&[("us-east-2", fulfil("192.0.2.9"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc
            .place(&req(
                "req00018",
                vec![member(
                    "alice",
                    &[
                        ("us-west-2", 210),
                        ("ca-central-1", 230),
                        ("us-east-2", 190),
                    ],
                )],
            ))
            .await
            .unwrap();
        assert_eq!(offer.region, "us-east-2");
        assert!(offer
            .warnings
            .iter()
            .any(|w| w.code() == "all_regions_over_limit"));
    }

    #[tokio::test(start_paused = true)]
    async fn release_session_deletes_the_record() {
        // Was `release_host(region, placement_id)`: the ID-only deletion path is gone; the release is bound to the ledger.
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc.place(&req("req00019", vec![alice()])).await.unwrap();
        let scope = Scope::default();
        svc.release_session(&scope, "req00019", &offer.placement_id)
            .await
            .unwrap();
        assert!(svc.dns.records().is_empty());
        svc.release_session(&scope, "req00019", &offer.placement_id)
            .await
            .unwrap();
    }
}
