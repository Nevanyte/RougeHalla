//! The process-local ledger: bounded, fail-closed, no persistence. Used by `PlacementService::new` and fast tests.
//! Time is `tokio::time`, so paused-clock tests control claim expiry.

use super::*;
use std::collections::BTreeMap;
use std::sync::Mutex;
use tokio::time::Instant;

/// At most this many request ids. A full store answers `Begin::Full` before any external call and never evicts.
pub const MEMORY_CAP: usize = 4096;

struct Row {
    identity: Identity,
    phase: Phase,
    final_phase: Option<Phase>,
    fence: i64,
    claim_kind: ClaimKind,
    claim_holder: Option<String>,
    claim_until: Option<Instant>,
    state: LedgerState,
    created_ms: i64,
    updated_ms: i64,
    finished_ms: Option<i64>,
}

impl Row {
    fn live(&self) -> bool {
        self.claim_until.is_some_and(|u| u > Instant::now())
    }
    fn reapable(&self) -> bool {
        matches!(self.phase, Phase::Active | Phase::Releasing) && !self.live()
    }
    fn clear_claim(&mut self) {
        self.claim_kind = ClaimKind::None;
        self.claim_holder = None;
        self.claim_until = None;
    }
    fn record(&self) -> Record {
        Record {
            identity: self.identity.clone(),
            phase: self.phase,
            final_phase: self.final_phase,
            fence: self.fence,
            claim: ClaimInfo {
                kind: self.claim_kind,
                holder: self.claim_holder.clone(),
                live: self.live(),
            },
            state: self.state.clone(),
            created_ms: self.created_ms,
            updated_ms: self.updated_ms,
            finished_ms: self.finished_ms,
        }
    }
    fn claim(&self, request_id: &str) -> Claim {
        Claim {
            request_id: request_id.to_string(),
            holder: self.claim_holder.clone().unwrap_or_default(),
            fence: self.fence,
            kind: self.claim_kind,
        }
    }
}

#[derive(Default)]
struct Inner {
    epoch: Option<[u8; 32]>,
    rows: BTreeMap<String, Row>,
}

pub struct MemoryLedger {
    inner: Mutex<Inner>,
    base: Instant,
}

impl Default for MemoryLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLedger {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            base: Instant::now(),
        }
    }

    fn now(&self) -> i64 {
        self.base.elapsed().as_millis() as i64
    }

    /// Synchronous `open_epoch` (the constructor of a service with a fresh memory ledger uses it).
    pub fn open_epoch_now(&self, candidate: [u8; 32]) -> Result<[u8; 32], LedgerError> {
        let mut g = self.inner.lock().unwrap();
        if let Some(e) = g.epoch {
            return Ok(e);
        }
        if !g.rows.is_empty() {
            return Err(LedgerError::Corrupt("records exist without an epoch".into()));
        }
        g.epoch = Some(candidate);
        Ok(candidate)
    }

    pub fn counts_now(&self) -> Counts {
        let g = self.inner.lock().unwrap();
        let mut c = Counts {
            total: g.rows.len(),
            ..Counts::default()
        };
        for r in g.rows.values() {
            match r.phase {
                Phase::Active | Phase::Releasing => {
                    if r.live() && r.claim_kind == ClaimKind::Worker {
                        c.active_live += 1;
                    } else {
                        c.unresolved += 1;
                    }
                    if r.phase == Phase::Releasing {
                        c.releasing += 1;
                    }
                }
                Phase::Offered => c.offered += 1,
                Phase::Released => c.released += 1,
                Phase::Finished => c.finished += 1,
                Phase::Tombstone => c.tombstones += 1,
            }
        }
        c
    }

    fn relinquish_now(&self, claim: &Claim) {
        let mut g = self.inner.lock().unwrap();
        if let Some(r) = g.rows.get_mut(&claim.request_id) {
            if r.fence == claim.fence && r.claim_holder.as_deref() == Some(&claim.holder) {
                r.clear_claim();
            }
        }
    }
}

impl Ledger for MemoryLedger {
    async fn open_epoch(&self, candidate: [u8; 32]) -> Result<[u8; 32], LedgerError> {
        self.open_epoch_now(candidate)
    }

    async fn now_ms(&self) -> Result<i64, LedgerError> {
        Ok(self.now())
    }

    async fn begin(
        &self,
        identity: &Identity,
        holder: &str,
        lease: Duration,
    ) -> Result<Begin, LedgerError> {
        let now = self.now();
        let mut g = self.inner.lock().unwrap();
        if let Some(r) = g.rows.get(&identity.request_id) {
            if r.identity.scope != identity.scope || r.identity.fingerprint != identity.fingerprint
            {
                return Ok(Begin::Conflict);
            }
            return Ok(match r.phase {
                Phase::Offered if !r.live() => match &r.state.offer {
                    Some(o) => Begin::Offered(Box::new(o.clone())),
                    None => return Err(LedgerError::Corrupt("offered without offer".into())),
                },
                Phase::Active if r.live() && r.claim_kind == ClaimKind::Worker => Begin::InProgress,
                p => Begin::Reused(p),
            });
        }
        if g.rows.len() >= MEMORY_CAP {
            return Ok(Begin::Full);
        }
        g.rows.insert(
            identity.request_id.clone(),
            Row {
                identity: identity.clone(),
                phase: Phase::Active,
                final_phase: None,
                fence: 1,
                claim_kind: ClaimKind::Worker,
                claim_holder: Some(holder.to_string()),
                claim_until: Some(Instant::now() + lease),
                state: LedgerState::default(),
                created_ms: now,
                updated_ms: now,
                finished_ms: None,
            },
        );
        Ok(Begin::Started(Claim {
            request_id: identity.request_id.clone(),
            holder: holder.to_string(),
            fence: 1,
            kind: ClaimKind::Worker,
        }))
    }

    async fn write(
        &self,
        claim: &Claim,
        state: &LedgerState,
        phase: Phase,
        lease: Duration,
    ) -> Result<WriteOutcome, LedgerError> {
        validate_write(state, phase)?;
        let now = self.now();
        let mut g = self.inner.lock().unwrap();
        let Some(r) = g.rows.get_mut(&claim.request_id) else {
            return Ok(WriteOutcome::Fenced);
        };
        let held = r.fence == claim.fence
            && r.claim_holder.as_deref() == Some(&claim.holder)
            && r.claim_kind == claim.kind
            && r.live();
        #[cfg(feature = "fault-injection")]
        let held = held || mutant(Mutant::SkipFencing);
        if !held {
            return Ok(WriteOutcome::Fenced);
        }
        if !r.phase.may_become(phase) {
            return Err(LedgerError::Refused("illegal phase transition".into()));
        }
        r.state = state.clone();
        r.phase = phase;
        r.updated_ms = now;
        match phase {
            Phase::Offered | Phase::Finished | Phase::Released => r.clear_claim(),
            _ => r.claim_until = Some(Instant::now() + lease),
        }
        if matches!(phase, Phase::Finished | Phase::Released) {
            r.finished_ms = Some(now);
        }
        Ok(WriteOutcome::Written)
    }

    async fn relinquish(&self, claim: &Claim) -> Result<(), LedgerError> {
        self.relinquish_now(claim);
        Ok(())
    }

    fn relinquish_blocking(&self, claim: &Claim) {
        self.relinquish_now(claim);
    }

    async fn claim_reapable(
        &self,
        holder: &str,
        lease: Duration,
        limit: usize,
    ) -> Result<Vec<(Claim, Record)>, LedgerError> {
        let now = self.now();
        let mut g = self.inner.lock().unwrap();
        let mut ids: Vec<_> = g
            .rows
            .iter()
            .filter(|(_, r)| r.reapable())
            .map(|(id, r)| (r.updated_ms, id.clone()))
            .collect();
        ids.sort();
        let mut out = Vec::new();
        for (_, id) in ids.into_iter().take(limit) {
            let r = g.rows.get_mut(&id).unwrap();
            r.fence += 1;
            r.claim_kind = if r.phase == Phase::Releasing {
                ClaimKind::Release
            } else {
                ClaimKind::Reaper
            };
            r.claim_holder = Some(holder.to_string());
            r.claim_until = Some(Instant::now() + lease);
            r.updated_ms = now;
            out.push((r.claim(&id), r.record()));
        }
        Ok(out)
    }

    async fn claim_for_release(
        &self,
        request_id: &str,
        holder: &str,
        lease: Duration,
    ) -> Result<ReleaseClaim, LedgerError> {
        let now = self.now();
        let mut g = self.inner.lock().unwrap();
        let Some(r) = g.rows.get_mut(request_id) else {
            return Ok(ReleaseClaim::Missing);
        };
        match r.phase {
            Phase::Released => return Ok(ReleaseClaim::AlreadyReleased),
            Phase::Offered | Phase::Releasing => {}
            p => return Ok(ReleaseClaim::NotReleasable(p)),
        }
        if r.live() {
            return Ok(ReleaseClaim::Busy);
        }
        r.fence += 1;
        r.claim_kind = ClaimKind::Release;
        r.claim_holder = Some(holder.to_string());
        r.claim_until = Some(Instant::now() + lease);
        r.updated_ms = now;
        Ok(ReleaseClaim::Claimed(
            r.claim(request_id),
            Box::new(r.record()),
        ))
    }

    async fn get(&self, request_id: &str) -> Result<Option<Record>, LedgerError> {
        Ok(self
            .inner
            .lock()
            .unwrap()
            .rows
            .get(request_id)
            .map(Row::record))
    }

    async fn counts(&self) -> Result<Counts, LedgerError> {
        Ok(self.counts_now())
    }

    async fn purge(&self, limit: usize, older_than: Duration) -> Result<usize, LedgerError> {
        let now = self.now();
        let cutoff = now - older_than.as_millis() as i64;
        let mut g = self.inner.lock().unwrap();
        let mut ids: Vec<_> = g
            .rows
            .iter()
            .filter(|(_, r)| {
                matches!(r.phase, Phase::Finished | Phase::Released)
                    && r.finished_ms.is_some_and(|f| f < cutoff)
            })
            .map(|(id, r)| (r.finished_ms, id.clone()))
            .collect();
        ids.sort();
        let mut n = 0;
        for (_, id) in ids.into_iter().take(limit) {
            let r = g.rows.get_mut(&id).unwrap();
            r.final_phase = Some(r.phase);
            r.phase = Phase::Tombstone;
            r.identity.request_json.clear();
            r.identity.config_json.clear();
            r.identity.zone.clear();
            r.state = LedgerState::default();
            r.clear_claim();
            r.updated_ms = now;
            n += 1;
        }
        Ok(n)
    }
}
