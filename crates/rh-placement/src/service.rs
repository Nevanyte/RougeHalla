//! The orchestration: plan, place, wait, widen, publish a hostname, verify it, hand the client a URL.
//!
//! All waiting uses `tokio::time`, so the tests run on a paused clock. Nothing here blocks a game tick: this code runs in the
//! placement service, a different process from every game server.

use crate::backend::*;
use crate::hostname::game_hostname;
use crate::model::*;
use crate::score::{self, Attempt, AttemptKind, Plan, PlanError};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::{sleep, Instant};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
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

enum Outcome {
    Fulfilled(PlacementState),
    /// Cancelled, failed, timed out: no host from this attempt.
    NoHost,
}

pub struct PlacementService<G, D> {
    ownership_nonce: [u8; 32],
    pub cfg: ServiceConfig,
    pub gamelift: G,
    pub dns: D,
    requests: Arc<Mutex<BTreeMap<String, RequestRecord>>>,
}
// This library has no durable request store. Bound its process-local idempotency ledger;
// once full, fail closed before any external call. A production wrapper needs durable retention.
const MAX_REQUESTS: usize = 4096;
struct RequestRecord {
    request: PlacementRequest,
    config: ServiceConfig,
    phase: RequestPhase,
    placement_id: Option<String>,
    binding: Option<String>,
}
enum RequestPhase {
    Active,
    Abandoned,
    Reaping,
    Offered(JoinOffer),
    Finished,
}
struct RequestGuard {
    requests: Arc<Mutex<BTreeMap<String, RequestRecord>>>,
    request_id: String,
    reaper: bool,
}
impl RequestGuard {
    fn arm(&mut self, request: &StartPlacement) {
        let mut records = self.requests.lock().unwrap();
        let record = records.get_mut(&self.request_id).unwrap();
        record.placement_id = Some(request.placement_id.clone());
        record.binding = Some(request.game_session_data.clone());
    }
    fn disarm(&mut self) {
        self.requests
            .lock()
            .unwrap()
            .get_mut(&self.request_id)
            .unwrap()
            .placement_id = None;
    }
    fn offered(&mut self, offer: JoinOffer) {
        let mut requests = self.requests.lock().unwrap();
        let entry = requests.get_mut(&self.request_id).unwrap();
        entry.placement_id = None;
        entry.phase = RequestPhase::Offered(offer);
    }
    fn finished(&mut self) {
        let mut requests = self.requests.lock().unwrap();
        let entry = requests.get_mut(&self.request_id).unwrap();
        entry.placement_id = None;
        entry.phase = RequestPhase::Finished;
    }
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        let mut requests = self.requests.lock().unwrap();
        let entry = requests.get_mut(&self.request_id).unwrap();
        if matches!(entry.phase, RequestPhase::Active) && !self.reaper
            || matches!(entry.phase, RequestPhase::Reaping) && self.reaper
        {
            entry.phase = if entry.placement_id.is_some() {
                RequestPhase::Abandoned
            } else {
                RequestPhase::Finished
            };
        }
    }
}

impl<G: GameLiftBackend, D: DnsBackend> PlacementService<G, D> {
    /// `ownership_nonce` must be globally unique to this service ownership epoch, generated
    /// by the wrapper using a cryptographic RNG and persisted with its durable request ledger.
    /// Never reuse it for a fresh/empty ledger. This library does not generate or persist it.
    pub fn new(ownership_nonce: [u8; 32], cfg: ServiceConfig, gamelift: G, dns: D) -> Self {
        Self {
            ownership_nonce,
            cfg,
            gamelift,
            dns,
            requests: Arc::default(),
        }
    }

    /// Unresolved requests, including cleanup currently in flight.
    pub fn abandoned_count(&self) -> usize {
        self.requests
            .lock()
            .unwrap()
            .values()
            .filter(|r| matches!(r.phase, RequestPhase::Abandoned | RequestPhase::Reaping))
            .count()
    }

    /// Cleanup has exclusive ownership of each request. Cancellation of this future restores
    /// the current item to Abandoned; items not yet visited remain in the ledger.
    pub async fn reap_abandoned(&self) -> usize {
        let ids: Vec<_> = self
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, r)| matches!(r.phase, RequestPhase::Abandoned))
            .map(|(id, _)| id.clone())
            .collect();
        let mut resolved = 0;
        for request_id in ids {
            let (placement_id, zone, binding) = {
                let mut requests = self.requests.lock().unwrap();
                let r = requests.get_mut(&request_id).unwrap();
                if !matches!(r.phase, RequestPhase::Abandoned) {
                    continue;
                }
                r.phase = RequestPhase::Reaping;
                (
                    r.placement_id.clone().unwrap(),
                    r.config.zone.clone(),
                    r.binding.clone().unwrap(),
                )
            };
            let mut guard = RequestGuard {
                requests: self.requests.clone(),
                request_id,
                reaper: true,
            };
            if self.reap_one(&placement_id, &zone, &binding).await {
                guard.finished();
                resolved += 1;
            }
        }
        resolved
    }

    /// `true` when the placement needs no further attention.
    async fn reap_one(&self, id: &str, zone: &str, binding: &str) -> bool {
        let mut st = match self.gamelift.describe_placement(id).await {
            Ok(st) => st,
            Err(BackendError::NotFound) => return true,
            Err(_) => return false,
        };
        // The start response may have been lost or cancelled before AlreadyExists was seen.
        // A matching id alone never authorizes cleanup of another service's accepted offer.
        match st.game_session_data.as_deref() {
            Some(data) if data == binding && st.placement_id == id => {}
            Some(_) => return true, // foreign placement: no owned work, never mutate it
            None => return false,   // adapter omitted ownership evidence: retain for reconciliation
        }
        if st.status == PlacementStatus::Pending {
            match self.gamelift.stop_placement(id).await {
                Ok(s2) => st = s2,
                // Refused: a session was created in the meantime; look again.
                Err(BackendError::Invalid(_)) => match self.gamelift.describe_placement(id).await {
                    Ok(s2) => st = s2,
                    Err(_) => return false,
                },
                Err(_) => return false,
            }
        }
        if st.placement_id != id || st.game_session_data.as_deref() != Some(binding) {
            return false;
        }
        if st.status == PlacementStatus::Fulfilled {
            let Some(arn) = &st.game_session_arn else {
                return false;
            };
            let dns_ok = if let Some(region) = &st.region {
                match game_hostname(region, id, zone) {
                    Ok(host) => self.dns.delete(&host).await.is_ok(),
                    Err(_) => true, // publish could never have created this malformed name
                }
            } else {
                true
            };
            // The adapter must make this operation idempotent (already gone is success).
            let terminated = self.gamelift.terminate_game_session(arn).await.is_ok();
            return dns_ok && terminated;
        }
        st.status.is_terminal()
    }

    /// Plan only (no GameLift write): what `place` would ask for. Capacity read failures are ignored (unknown capacity).
    pub async fn plan(&self, req: &PlacementRequest) -> Result<Plan, PlaceError> {
        let capacity = self.gamelift.capacity().await.unwrap_or_default();
        score::plan(&self.cfg.regions, &self.cfg.policy, &capacity, req).map_err(|e| match e {
            PlanError::Invalid(m) => PlaceError::Invalid(m),
            PlanError::UnknownRegion(r) => PlaceError::UnknownRegion(r),
            PlanError::Refused(r) => PlaceError::Refused(r),
        })
    }

    pub async fn place(&self, req: &PlacementRequest) -> Result<JoinOffer, PlaceError> {
        self.place_with(req, &mut |_| {}).await
    }

    pub async fn place_with(
        &self,
        req: &PlacementRequest,
        observe: &mut (dyn FnMut(Progress) + Send),
    ) -> Result<JoinOffer, PlaceError> {
        score::plan(&self.cfg.regions, &self.cfg.policy, &BTreeMap::new(), req).map_err(
            |e| match e {
                PlanError::Invalid(m) => PlaceError::Invalid(m),
                PlanError::UnknownRegion(r) => PlaceError::UnknownRegion(r),
                PlanError::Refused(r) => PlaceError::Refused(r),
            },
        )?;
        // Claim before any await, including capacity lookup. A retry cannot race cleanup or
        // overwrite another caller's ownership. Authenticated callers must preserve request identity.
        {
            let mut requests = self.requests.lock().unwrap();
            if let Some(r) = requests.get(&req.request_id) {
                if r.request != *req || r.config != self.cfg {
                    return Err(PlaceError::Invalid(
                        "request id belongs to different input".into(),
                    ));
                }
                return match &r.phase {
                    RequestPhase::Offered(offer) => Ok(offer.clone()),
                    RequestPhase::Active => Err(PlaceError::ServiceUnavailable(
                        "request already in progress".into(),
                    )),
                    _ => Err(PlaceError::RequestIdReused),
                };
            }
            if requests.len() >= MAX_REQUESTS {
                return Err(PlaceError::ServiceUnavailable("request ledger full".into()));
            }
            requests.insert(
                req.request_id.clone(),
                RequestRecord {
                    request: req.clone(),
                    config: self.cfg.clone(),
                    phase: RequestPhase::Active,
                    placement_id: None,
                    binding: None,
                },
            );
        }
        let mut guard = RequestGuard {
            requests: self.requests.clone(),
            request_id: req.request_id.clone(),
            reaper: false,
        };
        let plan = self.plan(req).await?;
        let policy = &self.cfg.policy;
        let deadline = Instant::now() + policy.total_budget();
        let mut dns_failed = false;
        let total = plan.attempts.len();
        for (i, attempt) in plan.attempts.iter().enumerate() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            if i > 0 {
                observe(Progress::Widening {
                    after: plan.attempts[i - 1].kind,
                });
            }
            observe(Progress::Searching {
                attempt: i + 1,
                of: total,
                kind: attempt.kind,
                regions: attempt.locations.clone(),
            });
            let sp = self.start_request(req, i + 1, attempt);
            sp.validate().map_err(PlaceError::Invalid)?;
            let timeout = attempt.timeout.min(deadline - now);
            guard.arm(&sp);
            let outcome = self.run_attempt(&sp, timeout).await;
            if matches!(
                outcome,
                Ok(Outcome::NoHost) | Err(PlaceError::RequestIdReused)
            ) {
                guard.disarm();
            }
            match outcome? {
                Outcome::NoHost => continue,
                Outcome::Fulfilled(state) => {
                    observe(Progress::PreparingHost {
                        region: state.region.clone().unwrap_or_default(),
                    });
                    let published = self.publish(&plan, state, i + 1).await;
                    if !matches!(published, Ok(Ok(_))) {
                        if self
                            .reap_one(&sp.placement_id, &self.cfg.zone, &sp.game_session_data)
                            .await
                        {
                            guard.disarm();
                        } else {
                            return Err(PlaceError::ServiceUnavailable(
                                "placement cleanup pending".into(),
                            ));
                        }
                    }
                    match published? {
                        Ok(offer) => {
                            guard.offered(offer.clone());
                            observe(Progress::Ready {
                                region: offer.region.clone(),
                            });
                            return Ok(offer);
                        }
                        Err(()) => dns_failed = true,
                    }
                }
            }
        }
        if dns_failed {
            return Err(PlaceError::DnsUnavailable);
        }
        match (plan.manual, plan.attempts.first()) {
            (true, Some(a)) => Err(PlaceError::OverrideUnavailable {
                region: a.locations[0].clone(),
            }),
            _ => Err(PlaceError::NoCapacity {
                attempts: plan.attempts.len(),
            }),
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

    /// Start one placement and wait for it, up to `timeout`. On timeout the placement is cancelled; if the cancel races a
    /// fulfilment, the fulfilled placement is used rather than orphaning a host.
    async fn run_attempt(
        &self,
        sp: &StartPlacement,
        timeout: Duration,
    ) -> Result<Outcome, PlaceError> {
        let policy = &self.cfg.policy;
        let started = Instant::now();
        let mut tries = 0;
        let first = loop {
            match self.gamelift.start_placement(sp).await {
                Ok(s) => break s,
                Err(BackendError::AlreadyExists) => {
                    let existing = self
                        .gamelift
                        .describe_placement(&sp.placement_id)
                        .await
                        .map_err(unavailable)?;
                    if existing.game_session_data.is_none() {
                        return Err(PlaceError::ServiceUnavailable(
                            "missing placement ownership metadata".into(),
                        ));
                    }
                    if existing.placement_id != sp.placement_id
                        || existing.game_session_data.as_deref() != Some(&sp.game_session_data)
                    {
                        return Err(PlaceError::RequestIdReused);
                    }
                    if existing.status.is_terminal()
                        && existing.status != PlacementStatus::Fulfilled
                    {
                        return Err(PlaceError::RequestIdReused);
                    }
                    break existing;
                }
                Err(BackendError::Invalid(m)) => return Err(PlaceError::Invalid(m)),
                Err(BackendError::NotFound) => {
                    return Err(PlaceError::Invalid("placement not found".into()))
                }
                Err(BackendError::Unavailable(m)) => {
                    tries += 1;
                    if tries >= 3 || started.elapsed() >= timeout {
                        return Err(PlaceError::ServiceUnavailable(m));
                    }
                    sleep(policy.poll_interval()).await;
                }
            }
        };
        let mut state = first;
        let mut consecutive_errors = 0;
        loop {
            if state.game_session_data.is_none() {
                return Err(PlaceError::ServiceUnavailable(
                    "missing placement ownership metadata".into(),
                ));
            }
            if state.placement_id != sp.placement_id
                || state.game_session_data.as_deref() != Some(&sp.game_session_data)
            {
                return Err(PlaceError::RequestIdReused);
            }
            match state.status {
                PlacementStatus::Fulfilled => return Ok(Outcome::Fulfilled(state)),
                PlacementStatus::Cancelled
                | PlacementStatus::TimedOut
                | PlacementStatus::Failed => return Ok(Outcome::NoHost),
                PlacementStatus::Pending => {}
            }
            if started.elapsed() >= timeout {
                return self.cancel(sp).await;
            }
            sleep(policy.poll_interval()).await;
            match self.gamelift.describe_placement(&sp.placement_id).await {
                Ok(s) => {
                    consecutive_errors = 0;
                    state = s;
                }
                Err(BackendError::Unavailable(m)) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= 5 {
                        let _ = self.gamelift.stop_placement(&sp.placement_id).await;
                        return Err(PlaceError::ServiceUnavailable(m));
                    }
                }
                Err(BackendError::Invalid(m)) => return Err(PlaceError::Invalid(m)),
                Err(BackendError::AlreadyExists) => {
                    return Err(PlaceError::Invalid("unexpected AlreadyExists".into()))
                }
                Err(BackendError::NotFound) => {
                    return Err(PlaceError::Invalid("placement not found".into()))
                }
            }
        }
    }

    async fn cancel(&self, expected: &StartPlacement) -> Result<Outcome, PlaceError> {
        let state = match self.gamelift.stop_placement(&expected.placement_id).await {
            Ok(state) => state,
            // Refused because a session may have been created in the meantime.
            Err(BackendError::Invalid(_)) => self
                .gamelift
                .describe_placement(&expected.placement_id)
                .await
                .map_err(unavailable)?,
            Err(e) => return Err(unavailable(e)),
        };
        // Neither a stop receipt nor the follow-up describe is ownership evidence by id alone.
        // Keep cleanup armed when the receipt cannot prove the fate of our exact attempt.
        if state.placement_id != expected.placement_id
            || state.game_session_data.as_deref() != Some(expected.game_session_data.as_str())
        {
            return Err(PlaceError::ServiceUnavailable(
                "cancellation response has unverified ownership".into(),
            ));
        }
        match state.status {
            PlacementStatus::Fulfilled => Ok(Outcome::Fulfilled(state)),
            PlacementStatus::Cancelled | PlacementStatus::TimedOut | PlacementStatus::Failed => {
                Ok(Outcome::NoHost)
            }
            PlacementStatus::Pending => Err(PlaceError::ServiceUnavailable(
                "cancellation remains pending".into(),
            )),
        }
    }

    /// Fulfilled placement -> verified hostname -> offer. `Ok(Err(()))` means DNS failed.
    /// The caller must confirm cleanup before continuing with another attempt.
    async fn publish(
        &self,
        plan: &Plan,
        st: PlacementState,
        attempts_used: usize,
    ) -> Result<Result<JoinOffer, ()>, PlaceError> {
        let region = st
            .region
            .clone()
            .filter(|r| self.cfg.regions.iter().any(|c| &c.id == r));
        let (Some(region), Some(ip), Some(port), Some(arn)) = (
            region,
            st.ip_address.clone(),
            st.port.filter(|p| *p > 0),
            st.game_session_arn.clone(),
        ) else {
            return Err(PlaceError::Invalid(
                "fulfilled placement is missing region, address, port or session".into(),
            ));
        };
        let host = match game_hostname(&region, &st.placement_id, &self.cfg.zone) {
            Ok(h) => h,
            Err(e) => {
                return Err(PlaceError::Invalid(e));
            }
        };
        let ttl = self.cfg.policy.dns_ttl_s;
        let mut ok = false;
        for i in 0..3 {
            match self.dns.upsert(&host, &ip, ttl).await {
                Ok(()) => {
                    ok = true;
                    break;
                }
                Err(BackendError::Invalid(_)) => break,
                Err(_) if i < 2 => sleep(Duration::from_millis(500)).await,
                Err(_) => {}
            }
        }
        // The name must be visible at the authoritative servers before the client resolves it: a recursive resolver caches a
        // miss (NXDOMAIN) for the zone's negative TTL, which would stall the join for minutes.
        if ok {
            ok = false;
            let until = Instant::now() + self.cfg.policy.dns_verify_timeout();
            loop {
                if self
                    .dns
                    .resolve_authoritative(&host)
                    .await
                    .is_ok_and(|v| v.iter().any(|a| a == &ip))
                {
                    ok = true;
                    break;
                }
                if Instant::now() >= until {
                    break;
                }
                sleep(Duration::from_millis(250)).await;
            }
        }
        if !ok {
            return Ok(Err(()));
        }
        let mut warnings = plan.warnings.clone();
        if let (Some(s), false) = (
            plan.score_of(&region),
            warnings.iter().any(|w| {
                matches!(
                    w,
                    Warning::HighPing { .. } | Warning::AllRegionsOverLimit { .. }
                )
            }),
        ) {
            if s.tier == Tier::OverLimit {
                warnings.push(Warning::HighPing {
                    region: region.clone(),
                    worst_ms: s.max_ms.unwrap_or(0),
                });
            }
        }
        Ok(Ok(JoinOffer {
            url: format!("wss://{host}:{port}/ws"),
            hostname: host,
            region,
            port,
            placement_id: st.placement_id,
            game_session_arn: arn,
            player_sessions: st.placed_player_sessions,
            warnings,
            attempts_used,
        }))
    }

    /// Remove a finished session's DNS record (the session-end hook and the janitor both call this; deleting a missing record is fine).
    pub async fn release_host(&self, region: &str, placement_id: &str) -> Result<(), BackendError> {
        let host =
            game_hostname(region, placement_id, &self.cfg.zone).map_err(BackendError::Invalid)?;
        self.dns.delete(&host).await
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
    async fn release_host_deletes_the_record() {
        let gl = FakeGameLift::new(&[("us-west-2", fulfil("203.0.113.10"))]);
        let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
        let offer = svc.place(&req("req00019", vec![alice()])).await.unwrap();
        svc.release_host(&offer.region, &offer.placement_id)
            .await
            .unwrap();
        assert!(svc.dns.records().is_empty());
        svc.release_host(&offer.region, &offer.placement_id)
            .await
            .unwrap();
    }
}
