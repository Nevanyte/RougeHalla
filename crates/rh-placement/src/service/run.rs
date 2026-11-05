//! The placement state machine over the ledger: one claimed row, write-ahead intents, fenced writes.
//!
//! A [`Run`] holds one claim on one row. The live `place` call, the reaper and an explicit release all use it, and
//! the live call's inline cleanup runs the very routine the reaper runs ([`Run::cleanup_attempt`]).
//! Order everywhere: persist the intent, then send the effect, then persist what the receipt proved.

use super::*;
use crate::ledger::{ClaimKind, LedgerState as State};

/// How a run ended early. `Lost` means the claim is gone or the ledger cannot be trusted: no further effect, no write, and
/// above all no cleanup started because of the failure.
pub(super) enum Stop {
    Err(PlaceError),
    Lost(PlaceError),
}

impl From<PlaceError> for Stop {
    fn from(e: PlaceError) -> Self {
        Stop::Err(e)
    }
}

fn lost() -> Stop {
    Stop::Lost(ledger_unavailable())
}

enum Owner {
    Ours,
    Foreign,
    /// The adapter omitted ownership evidence.
    Unknown,
}

/// Receipts are compared with the binding STORED for the attempt, by id and exact `GameSessionData`.
fn owner(a: &AttemptRec, st: &PlacementState) -> Owner {
    if mutant(Mutant::SkipOwnershipCheck) {
        return Owner::Ours;
    }
    match st.game_session_data.as_deref() {
        None => Owner::Unknown,
        Some(d) if d == a.binding && st.placement_id == a.placement_id => Owner::Ours,
        Some(_) => Owner::Foreign,
    }
}

enum StopResult {
    Terminal(PlacementState),
    Pending,
    Unverified,
    Backend(BackendError),
}

pub(super) struct Run<'a, G: GameLiftBackend, D: DnsBackend, L: Ledger> {
    svc: &'a PlacementService<G, D, L>,
    claim: Claim,
    zone: String,
    pub(super) state: State,
    committed: State,
    phase: Phase,
    last_write: Instant,
    lease: Duration,
    armed: bool,
}

impl<G: GameLiftBackend, D: DnsBackend, L: Ledger> Drop for Run<'_, G, D, L> {
    fn drop(&mut self) {
        // A dropped future writes nothing (the ledger already holds every intent); a process-local ledger also frees the
        // claim at once, any other store frees it when the lease runs out.
        if self.armed {
            self.svc.ledger.relinquish_blocking(&self.claim);
        }
    }
}

impl<'a, G: GameLiftBackend, D: DnsBackend, L: Ledger> Run<'a, G, D, L> {
    pub(super) fn new(
        svc: &'a PlacementService<G, D, L>,
        claim: Claim,
        zone: String,
        state: State,
        phase: Phase,
        lease: Duration,
    ) -> Self {
        Self {
            svc,
            claim,
            zone,
            committed: state.clone(),
            state,
            phase,
            last_write: Instant::now(),
            lease,
            armed: true,
        }
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }

    /// Give the claim back (best effort) without finishing anything.
    pub(super) async fn give_up(&mut self) {
        let _ = self.svc.db(self.svc.ledger.relinquish(&self.claim)).await;
        self.armed = false;
    }

    pub(super) async fn now(&self) -> Result<i64, Stop> {
        self.svc
            .db(self.svc.ledger.now_ms())
            .await
            .map_err(|_| lost())
    }

    /// Compare-and-swap write of `self.state`. An ambiguous failure is reconciled by reading the row back: committed,
    /// unchanged (retry) or lost. The worker never turns an unknown outcome into cleanup.
    pub(super) async fn commit(&mut self, label: &str, phase: Phase) -> Result<(), Stop> {
        let mut tries = 0;
        loop {
            let r = match fp("before", "write", label).await {
                Err(m) => Err(LedgerError::Unavailable(m)),
                Ok(()) => {
                    let r = self
                        .svc
                        .db(self
                            .svc
                            .ledger
                            .write(&self.claim, &self.state, phase, self.lease))
                        .await;
                    match (r, fp("after", "write", label).await) {
                        (Ok(_), Err(m)) => Err(LedgerError::Unavailable(m)),
                        (r, _) => r,
                    }
                }
            };
            match r {
                Ok(crate::ledger::WriteOutcome::Written) => {
                    self.committed = self.state.clone();
                    self.phase = phase;
                    self.last_write = Instant::now();
                    return Ok(());
                }
                Ok(crate::ledger::WriteOutcome::Fenced) => return Err(lost()),
                Err(e) if !e.ambiguous() => {
                    self.state = self.committed.clone();
                    return Err(Stop::Err(PlaceError::ServiceUnavailable(
                        "placement ledger refused the update".into(),
                    )));
                }
                Err(_) => match self.reconcile(phase).await {
                    Reconciled::Committed => {
                        self.committed = self.state.clone();
                        self.phase = phase;
                        self.last_write = Instant::now();
                        return Ok(());
                    }
                    Reconciled::Retry => {
                        tries += 1;
                        if tries >= 3 {
                            return Err(lost());
                        }
                    }
                    Reconciled::Lost => return Err(lost()),
                },
            }
        }
    }

    async fn reconcile(&self, phase: Phase) -> Reconciled {
        for i in 0..3u32 {
            match self
                .svc
                .db(self.svc.ledger.get(&self.claim.request_id))
                .await
            {
                Ok(Some(rec)) => {
                    if rec.fence != self.claim.fence {
                        return Reconciled::Lost;
                    }
                    if rec.phase == phase && rec.state == self.state {
                        return Reconciled::Committed;
                    }
                    if rec.phase == self.phase && rec.state == self.committed {
                        return Reconciled::Retry;
                    }
                    return Reconciled::Lost;
                }
                Ok(None) => return Reconciled::Lost,
                Err(_) => sleep(Duration::from_millis(100 * u64::from(i + 1))).await,
            }
        }
        Reconciled::Lost
    }

    /// Write-ahead: the intent is committed before its effect is sent.
    async fn intent(&mut self, label: &str) -> Result<(), Stop> {
        if mutant(Mutant::SkipWriteAhead) {
            return Ok(());
        }
        self.commit(label, Phase::Active).await
    }

    /// Renew the lease when a third of it has passed since the last write.
    async fn touch(&mut self) -> Result<(), Stop> {
        if self.last_write.elapsed() >= self.lease / 3 {
            let p = self.phase;
            self.commit("lease", p).await?;
        }
        Ok(())
    }

    fn resolve(&mut self, idx: usize, r: Resolution) {
        self.state.attempts[idx].resolution = r;
    }

    // ---- the live path ----

    pub(super) async fn finish_place(
        mut self,
        res: Result<JoinOffer, Stop>,
    ) -> Result<JoinOffer, PlaceError> {
        match res {
            Ok(o) => {
                self.armed = false;
                Ok(o)
            }
            Err(Stop::Lost(e)) => {
                self.give_up().await;
                Err(e)
            }
            Err(Stop::Err(e)) => {
                // Every attempt resolved: nothing is left to clean, so the row is final. Otherwise keep the claim's work
                // for the reaper.
                if self.phase == Phase::Active
                    && self.state.all_resolved()
                    && self.commit("finished", Phase::Finished).await.is_ok()
                {
                    self.armed = false;
                } else {
                    self.give_up().await;
                }
                Err(e)
            }
        }
    }

    pub(super) async fn place(
        &mut self,
        req: &PlacementRequest,
        observe: &mut (dyn FnMut(Progress) + Send),
    ) -> Result<JoinOffer, Stop> {
        let svc = self.svc;
        let plan = svc.plan(req).await?;
        let policy = &svc.cfg.policy;
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
            let sp = svc.start_request(req, i + 1, attempt);
            sp.validate().map_err(PlaceError::Invalid)?;
            let timeout = attempt.timeout.min(deadline - now);
            let at_ms = self.now().await?;
            self.state.attempts.push(AttemptRec::new(
                (i + 1) as u32,
                sp.placement_id.clone(),
                sp.game_session_data.clone(),
                attempt.locations.clone(),
                at_ms,
            ));
            let idx = self.state.attempts.len() - 1;
            self.intent("start_intent").await?;
            match self.run_attempt(idx, &sp, timeout).await? {
                Outcome::NoHost => {
                    self.resolve(idx, Resolution::NoHost);
                    self.commit("attempt_resolved", Phase::Active).await?;
                }
                Outcome::Fulfilled(state) => {
                    observe(Progress::PreparingHost {
                        region: state.region.clone().unwrap_or_default(),
                    });
                    let published = self.publish(idx, &plan, state, i + 1).await;
                    match published {
                        Err(Stop::Lost(e)) => return Err(Stop::Lost(e)),
                        Ok(Ok(offer)) => {
                            self.commit_offer(idx, &offer).await?;
                            observe(Progress::Ready {
                                region: offer.region.clone(),
                            });
                            return Ok(offer);
                        }
                        other => {
                            // Publication failed: clean up THIS attempt with the reaper's routine before widening.
                            if !self.cleanup_attempt(idx).await? {
                                return Err(PlaceError::ServiceUnavailable(
                                    "placement cleanup pending".into(),
                                )
                                .into());
                            }
                            // A hard error is returned now; `Ok(Err(()))` is a DNS failure: widen.
                            let _dns_failed = other?;
                            dns_failed = true;
                        }
                    }
                }
            }
        }
        if dns_failed {
            return Err(PlaceError::DnsUnavailable.into());
        }
        Err(match (plan.manual, plan.attempts.first()) {
            (true, Some(a)) => PlaceError::OverrideUnavailable {
                region: a.locations[0].clone(),
            },
            _ => PlaceError::NoCapacity {
                attempts: plan.attempts.len(),
            },
        }
        .into())
    }

    /// The offer becomes real only when this write commits. Only then is it returned.
    async fn commit_offer(&mut self, idx: usize, offer: &JoinOffer) -> Result<(), Stop> {
        self.state.offer = Some(OfferRecord::from(offer));
        self.resolve(idx, Resolution::Offered);
        if self.phase == Phase::Offered {
            return Ok(()); // the premature_completion mutant already committed it
        }
        self.commit("offer", Phase::Offered).await
    }

    /// Start one placement and wait for it, up to `timeout`. On timeout the placement is cancelled; if the cancel races a
    /// fulfilment, the fulfilled placement is used rather than orphaning a host.
    async fn run_attempt(
        &mut self,
        idx: usize,
        sp: &StartPlacement,
        timeout: Duration,
    ) -> Result<Outcome, Stop> {
        let svc = self.svc;
        let policy = &svc.cfg.policy;
        let started = Instant::now();
        let mut tries = 0;
        let mut existing_attempt = false;
        let first = loop {
            self.touch().await?;
            match svc.bk_start(sp).await {
                Ok(s) => break s,
                Err(BackendError::AlreadyExists) => {
                    let existing = svc
                        .bk_describe(&sp.placement_id)
                        .await
                        .map_err(unavailable)?;
                    existing_attempt = true;
                    break existing;
                }
                Err(BackendError::Invalid(m)) => {
                    // The provider refused the request outright: nothing was started.
                    self.resolve(idx, Resolution::NoHost);
                    self.commit("attempt_resolved", Phase::Active).await?;
                    return Err(PlaceError::Invalid(m).into());
                }
                Err(BackendError::NotFound) => {
                    return Err(PlaceError::Invalid("placement not found".into()).into())
                }
                Err(BackendError::Unavailable(m)) => {
                    tries += 1;
                    if tries >= 3 || started.elapsed() >= timeout {
                        return Err(PlaceError::ServiceUnavailable(m).into());
                    }
                    sleep(policy.poll_interval()).await;
                }
            }
        };
        let mut state = first;
        let mut accepted = false;
        let mut consecutive_errors = 0;
        loop {
            match owner(&self.state.attempts[idx], &state) {
                Owner::Unknown => {
                    return Err(PlaceError::ServiceUnavailable(
                        "missing placement ownership metadata".into(),
                    )
                    .into())
                }
                Owner::Foreign => {
                    self.resolve(idx, Resolution::Foreign);
                    self.commit("attempt_resolved", Phase::Active).await?;
                    return Err(PlaceError::RequestIdReused.into());
                }
                Owner::Ours => {}
            }
            if existing_attempt
                && state.status.is_terminal()
                && state.status != PlacementStatus::Fulfilled
            {
                self.resolve(idx, Resolution::NoHost);
                self.commit("attempt_resolved", Phase::Active).await?;
                return Err(PlaceError::RequestIdReused.into());
            }
            if !accepted {
                accepted = true;
                let a = &mut self.state.attempts[idx];
                a.start = StartStep::Accepted {
                    at_ms: a.start_at_ms(),
                };
                a.status = Some(state.status);
                self.commit("start_accepted", Phase::Active).await?;
            }
            match state.status {
                PlacementStatus::Fulfilled => return Ok(Outcome::Fulfilled(state)),
                PlacementStatus::Cancelled
                | PlacementStatus::TimedOut
                | PlacementStatus::Failed => return Ok(Outcome::NoHost),
                PlacementStatus::Pending => {}
            }
            if started.elapsed() >= timeout {
                return self.cancel(idx).await;
            }
            self.touch().await?;
            sleep(policy.poll_interval()).await;
            match svc.bk_describe(&sp.placement_id).await {
                Ok(s) => {
                    consecutive_errors = 0;
                    state = s;
                }
                Err(BackendError::Unavailable(m)) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= 5 {
                        // Best effort: the intent is committed first, the outcome (if verified) is recorded, and the
                        // error is returned either way. An unresolved attempt is left to the reaper.
                        let _ = self.stop_verified(idx).await;
                        return Err(PlaceError::ServiceUnavailable(m).into());
                    }
                }
                Err(BackendError::Invalid(m)) => return Err(PlaceError::Invalid(m).into()),
                Err(BackendError::AlreadyExists) => {
                    return Err(PlaceError::Invalid("unexpected AlreadyExists".into()).into())
                }
                Err(BackendError::NotFound) => {
                    return Err(PlaceError::Invalid("placement not found".into()).into())
                }
            }
        }
    }

    /// Stop with a committed intent, then verify the receipt (or, when the stop is refused because a session was created,
    /// a describe) against the stored binding. Only a verified TERMINAL status resolves the stop.
    async fn stop_verified(&mut self, idx: usize) -> Result<StopResult, Stop> {
        let id = self.state.attempts[idx].placement_id.clone();
        if self.state.attempts[idx].stop != StopStep::Resolved {
            self.state.attempts[idx].stop = StopStep::Intent;
            self.intent("stop_intent").await?;
        }
        let svc = self.svc;
        let r = match svc.bk_stop(&id).await {
            Ok(s) => Ok(s),
            // Refused: a session may have been created in the meantime; look again.
            Err(BackendError::Invalid(_)) => svc.bk_describe(&id).await,
            Err(e) => Err(e),
        };
        let st = match r {
            Ok(s) => s,
            Err(e) => return Ok(StopResult::Backend(e)),
        };
        // Neither a stop receipt nor the follow-up describe is ownership evidence by id alone.
        if !matches!(owner(&self.state.attempts[idx], &st), Owner::Ours) {
            return Ok(StopResult::Unverified);
        }
        if st.status == PlacementStatus::Pending {
            return Ok(StopResult::Pending);
        }
        let a = &mut self.state.attempts[idx];
        a.stop = StopStep::Resolved;
        a.status = Some(st.status);
        self.commit("stop_resolved", Phase::Active).await?;
        Ok(StopResult::Terminal(st))
    }

    async fn cancel(&mut self, idx: usize) -> Result<Outcome, Stop> {
        match self.stop_verified(idx).await? {
            StopResult::Terminal(st) if st.status == PlacementStatus::Fulfilled => {
                Ok(Outcome::Fulfilled(st))
            }
            StopResult::Terminal(_) => Ok(Outcome::NoHost),
            StopResult::Pending => {
                Err(PlaceError::ServiceUnavailable("cancellation remains pending".into()).into())
            }
            StopResult::Unverified => Err(PlaceError::ServiceUnavailable(
                "cancellation response has unverified ownership".into(),
            )
            .into()),
            StopResult::Backend(e) => Err(unavailable(e).into()),
        }
    }

    /// Fulfilled placement -> verified hostname -> offer. `Ok(Err(()))` means DNS failed.
    /// The caller must confirm cleanup before continuing with another attempt.
    async fn publish(
        &mut self,
        idx: usize,
        plan: &Plan,
        st: PlacementState,
        attempts_used: usize,
    ) -> Result<Result<JoinOffer, ()>, Stop> {
        let svc = self.svc;
        let region = st
            .region
            .clone()
            .filter(|r| svc.cfg.regions.iter().any(|c| &c.id == r));
        let (Some(region), Some(ip), Some(port), Some(arn)) = (
            region,
            st.ip_address.clone(),
            st.port.filter(|p| *p > 0),
            st.game_session_arn.clone(),
        ) else {
            return Err(PlaceError::Invalid(
                "fulfilled placement is missing region, address, port or session".into(),
            )
            .into());
        };
        let host =
            game_hostname(&region, &st.placement_id, &svc.cfg.zone).map_err(PlaceError::Invalid)?;
        {
            let a = &mut self.state.attempts[idx];
            a.status = Some(PlacementStatus::Fulfilled);
            a.fulfilled = Some(Fulfilled {
                region: region.clone(),
                ip: ip.clone(),
                port,
                arn: arn.clone(),
                player_sessions: st.placed_player_sessions.clone(),
            });
        }
        self.commit("fulfilled", Phase::Active).await?;
        self.state.attempts[idx].dns = DnsStep::Intent { host: host.clone() };
        self.intent("dns_intent").await?;

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
        let offer = JoinOffer {
            url: format!("wss://{host}:{port}/ws"),
            hostname: host.clone(),
            region,
            port,
            placement_id: st.placement_id,
            game_session_arn: arn,
            player_sessions: st.placed_player_sessions,
            warnings,
            attempts_used,
        };
        if mutant(Mutant::PrematureCompletion) {
            // Negative control: the offer is committed before the DNS effect is confirmed.
            self.state.attempts[idx].dns = DnsStep::Verified { host: host.clone() };
            self.commit_offer(idx, &offer).await?;
        }

        let ttl = svc.cfg.policy.dns_ttl_s;
        let mut ok = false;
        for i in 0..3 {
            self.touch().await?;
            match svc.bk_upsert(&host, &ip, ttl).await {
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
            let until = Instant::now() + svc.cfg.policy.dns_verify_timeout();
            loop {
                if svc
                    .bk_resolve(&host)
                    .await
                    .is_ok_and(|v| v.iter().any(|a| a == &ip))
                {
                    ok = true;
                    break;
                }
                if Instant::now() >= until {
                    break;
                }
                self.touch().await?;
                sleep(Duration::from_millis(250)).await;
            }
        }
        if !ok {
            return Ok(Err(()));
        }
        if !matches!(self.state.attempts[idx].dns, DnsStep::Verified { .. }) {
            self.state.attempts[idx].dns = DnsStep::Verified { host };
            self.commit("dns_verified", Phase::Active).await?;
        }
        Ok(Ok(offer))
    }

    // ---- cleanup: the one routine the live path and the reaper share ----

    /// `Ok(true)` when the attempt needs no further attention (resolved). Never mutates a foreign placement; missing
    /// ownership evidence and every backend failure leave it unresolved.
    pub(super) async fn cleanup_attempt(&mut self, idx: usize) -> Result<bool, Stop> {
        let a = self.state.attempts[idx].clone();
        if !a.is_open() {
            return Ok(true);
        }
        self.touch().await?;
        let svc = self.svc;
        let mut st = match svc.bk_describe(&a.placement_id).await {
            Ok(st) => st,
            Err(BackendError::NotFound) => return self.not_found(idx).await,
            Err(_) => return Ok(false),
        };
        match owner(&a, &st) {
            Owner::Ours => {}
            // A matching id alone never authorizes cleanup of someone else's placement.
            Owner::Foreign => {
                self.resolve(idx, Resolution::Foreign);
                self.commit("attempt_resolved", Phase::Active).await?;
                return Ok(true);
            }
            Owner::Unknown => return Ok(false),
        }
        if st.status == PlacementStatus::Pending {
            match self.stop_verified(idx).await? {
                StopResult::Terminal(s2) => st = s2,
                _ => return Ok(false),
            }
        }
        if st.status == PlacementStatus::Fulfilled {
            let Some(arn) = st.game_session_arn.clone() else {
                return Ok(false);
            };
            let host = match &a.dns {
                DnsStep::Intent { host }
                | DnsStep::Verified { host }
                | DnsStep::DeleteIntent { host }
                | DnsStep::Deleted { host } => Some(host.clone()),
                DnsStep::None => st
                    .region
                    .as_deref()
                    .and_then(|r| game_hostname(r, &a.placement_id, &self.zone).ok()),
            };
            return self.cleanup_fulfilled(idx, arn, host).await;
        }
        // Terminal without a host: only a stray DNS record can remain.
        if let Some(host) = a.dns_host() {
            self.state.attempts[idx].dns = DnsStep::DeleteIntent { host: host.clone() };
            self.intent("cleanup_intent").await?;
            if svc.bk_delete(&host).await.is_err() {
                return Ok(false);
            }
            self.state.attempts[idx].dns = DnsStep::Deleted { host };
        }
        self.resolve(idx, Resolution::NoHost);
        self.commit("cleanup_done", Phase::Active).await?;
        Ok(true)
    }

    /// Delete the hostname, terminate the session; both idempotent. Intent first, completion after the effects.
    async fn cleanup_fulfilled(
        &mut self,
        idx: usize,
        arn: String,
        host: Option<String>,
    ) -> Result<bool, Stop> {
        let svc = self.svc;
        {
            let a = &mut self.state.attempts[idx];
            a.status = Some(PlacementStatus::Fulfilled);
            if let Some(h) = &host {
                a.dns = DnsStep::DeleteIntent { host: h.clone() };
            }
            a.terminate = TermStep::Intent { arn: arn.clone() };
        }
        self.intent("cleanup_intent").await?;
        if mutant(Mutant::PrematureCompletion) {
            // Negative control: completion is recorded before the effects.
            let a = &mut self.state.attempts[idx];
            if let Some(h) = &host {
                a.dns = DnsStep::Deleted { host: h.clone() };
            }
            a.terminate = TermStep::Done;
            a.resolution = Resolution::CleanedUp;
            self.commit("cleanup_done", Phase::Active).await?;
        }
        if let Some(h) = &host {
            if svc.bk_delete(h).await.is_err() {
                return Ok(false);
            }
        }
        if svc.bk_terminate(&arn).await.is_err() {
            return Ok(false);
        }
        let a = &mut self.state.attempts[idx];
        if let Some(h) = host {
            a.dns = DnsStep::Deleted { host: h };
        }
        a.terminate = TermStep::Done;
        a.resolution = Resolution::CleanedUp;
        if self.phase == Phase::Active
            && self.committed.attempts[idx].resolution == Resolution::CleanedUp
        {
            return Ok(true);
        }
        self.commit("cleanup_done", Phase::Active).await?;
        Ok(true)
    }

    /// The provider does not know the placement. Only evidence settles it: a terminal non-fulfilled status last seen after
    /// an accepted start; a stored fulfilment (cleanup from the stored arn and host); or two NotFound answers long
    /// after the start intent (a start can still be accepted late, so a single NotFound proves nothing).
    async fn not_found(&mut self, idx: usize) -> Result<bool, Stop> {
        let a = self.state.attempts[idx].clone();
        let accepted = matches!(a.start, StartStep::Accepted { .. });
        match a.status {
            Some(PlacementStatus::Fulfilled) if accepted => {
                if let Some(f) = &a.fulfilled {
                    let host = a
                        .dns_host()
                        .or_else(|| game_hostname(&f.region, &a.placement_id, &self.zone).ok());
                    return self.cleanup_fulfilled(idx, f.arn.clone(), host).await;
                }
                return Ok(false);
            }
            Some(s) if accepted && s.is_terminal() => {
                self.resolve(idx, Resolution::NoHost);
                self.commit("attempt_resolved", Phase::Active).await?;
                return Ok(true);
            }
            _ => {}
        }
        let now = self.now().await?;
        let nf = &mut self.state.attempts[idx].not_found;
        nf.first_at_ms.get_or_insert(now);
        nf.count += 1;
        let count = nf.count;
        let settle = self.svc.durability.start_settle_after.as_millis() as i64;
        let settled = count >= 2 && now - a.start_at_ms() >= settle;
        if settled {
            self.resolve(idx, Resolution::Settled);
        }
        self.commit("not_found", Phase::Active).await?;
        Ok(settled)
    }

    // ---- reaper and release ----

    async fn reap_active(&mut self) -> Result<bool, Stop> {
        for idx in 0..self.state.attempts.len() {
            if self.state.attempts[idx].is_open() {
                self.cleanup_attempt(idx).await?;
            }
        }
        if self.state.all_resolved() {
            self.commit("finished", Phase::Finished).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Finish a recorded release: delete the offer's hostname, then record completion.
    pub(super) async fn finish_release(&mut self) -> Result<bool, Stop> {
        let Some(offer) = self.state.offer.clone() else {
            return Ok(false);
        };
        self.touch().await?;
        if self.svc.bk_delete(&offer.hostname).await.is_err() {
            return Ok(false);
        }
        let at = self.now().await?;
        let rel = self.state.release.get_or_insert(ReleaseRec {
            intent_at_ms: at,
            done_at_ms: None,
        });
        rel.done_at_ms = Some(at);
        self.commit("released", Phase::Released).await?;
        Ok(true)
    }
}

enum Reconciled {
    Committed,
    Retry,
    Lost,
}

impl AttemptRec {
    fn dns_host(&self) -> Option<String> {
        match &self.dns {
            DnsStep::None => None,
            DnsStep::Intent { host }
            | DnsStep::Verified { host }
            | DnsStep::DeleteIntent { host }
            | DnsStep::Deleted { host } => Some(host.clone()),
        }
    }
}

/// Claims not yet visited by a reaper pass; dropping the pass (cancellation) frees them at once on a local ledger.
struct Pending<L: Ledger> {
    ledger: Arc<L>,
    claims: Vec<Claim>,
}

impl<L: Ledger> Drop for Pending<L> {
    fn drop(&mut self) {
        for c in &self.claims {
            self.ledger.relinquish_blocking(c);
        }
    }
}

impl<G: GameLiftBackend, D: DnsBackend, L: Ledger> PlacementService<G, D, L> {
    /// Claim up to `durability.reap_batch` abandoned rows and settle what can be settled; returns how many rows became final
    /// (`finished` or `released`). Never touches `offered`, `released`, `finished` or `tombstone` rows, and never infers
    /// session end from an offer's age or a worker's lease. A dropped (cancelled) pass leaves every claim reclaimable.
    pub async fn reap_abandoned(&self) -> usize {
        let claimed = match self
            .db(self.ledger.claim_reapable(
                &holder_id(),
                self.durability.reaper_lease,
                self.durability.reap_batch,
            ))
            .await
        {
            Ok(c) => c,
            Err(_) => return 0,
        };
        let mut pending = Pending {
            ledger: self.ledger.clone(),
            claims: claimed.iter().map(|(c, _)| c.clone()).collect(),
        };
        let mut resolved = 0;
        for (claim, record) in claimed {
            pending.claims.remove(0);
            debug_assert_ne!(claim.kind, ClaimKind::None);
            let mut run = Run::new(
                self,
                claim,
                record.identity.zone,
                record.state,
                record.phase,
                self.durability.reaper_lease,
            );
            let r = if record.phase == Phase::Releasing {
                run.finish_release().await
            } else {
                run.reap_active().await
            };
            match r {
                Ok(true) => {
                    run.disarm();
                    resolved += 1;
                }
                Ok(false) | Err(_) => run.give_up().await,
            }
        }
        resolved
    }
}
