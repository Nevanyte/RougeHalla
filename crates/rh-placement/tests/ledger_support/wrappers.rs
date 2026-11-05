//! Delegating wrappers for the service-level tests: shared ownership of backends and ledgers across "restarts", ledger
//! faults (outage, commit-then-error), tampered receipts, and deterministic barriers.
use rh_placement::backend::{
    BackendError, DnsBackend, GameLiftBackend, PlacementState, StartPlacement,
};
use rh_placement::ledger::{
    Begin, Claim, Counts, DnsStep, Identity, Ledger, LedgerError, LedgerState, Phase, Record,
    ReleaseClaim, StopStep, TermStep, WriteOutcome,
};
use rh_placement::RegionCapacity;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

pub struct Shared<T>(pub Arc<T>);
impl<T> Shared<T> {
    pub fn new(t: T) -> Self {
        Shared(Arc::new(t))
    }
}
impl<T> Clone for Shared<T> {
    fn clone(&self) -> Self {
        Shared(self.0.clone())
    }
}
impl<T> std::ops::Deref for Shared<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: GameLiftBackend> GameLiftBackend for Shared<T> {
    async fn start_placement(&self, r: &StartPlacement) -> Result<PlacementState, BackendError> {
        self.0.start_placement(r).await
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.0.describe_placement(id).await
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.0.stop_placement(id).await
    }
    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        self.0.terminate_game_session(arn).await
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        self.0.capacity().await
    }
}

impl<T: DnsBackend> DnsBackend for Shared<T> {
    async fn upsert(&self, name: &str, ip: &str, ttl_s: u32) -> Result<(), BackendError> {
        self.0.upsert(name, ip, ttl_s).await
    }
    async fn delete(&self, name: &str) -> Result<(), BackendError> {
        self.0.delete(name).await
    }
    async fn resolve_authoritative(&self, name: &str) -> Result<Vec<String>, BackendError> {
        self.0.resolve_authoritative(name).await
    }
}

impl<T: Ledger> Ledger for Shared<T> {
    async fn open_epoch(&self, c: [u8; 32]) -> Result<[u8; 32], LedgerError> {
        self.0.open_epoch(c).await
    }
    async fn now_ms(&self) -> Result<i64, LedgerError> {
        self.0.now_ms().await
    }
    async fn begin(&self, i: &Identity, h: &str, l: Duration) -> Result<Begin, LedgerError> {
        self.0.begin(i, h, l).await
    }
    async fn write(
        &self,
        c: &Claim,
        s: &LedgerState,
        p: Phase,
        l: Duration,
    ) -> Result<WriteOutcome, LedgerError> {
        self.0.write(c, s, p, l).await
    }
    async fn relinquish(&self, c: &Claim) -> Result<(), LedgerError> {
        self.0.relinquish(c).await
    }
    fn relinquish_blocking(&self, c: &Claim) {
        self.0.relinquish_blocking(c)
    }
    async fn claim_reapable(
        &self,
        h: &str,
        l: Duration,
        n: usize,
    ) -> Result<Vec<(Claim, Record)>, LedgerError> {
        self.0.claim_reapable(h, l, n).await
    }
    async fn claim_for_release(
        &self,
        id: &str,
        h: &str,
        l: Duration,
    ) -> Result<ReleaseClaim, LedgerError> {
        self.0.claim_for_release(id, h, l).await
    }
    async fn get(&self, id: &str) -> Result<Option<Record>, LedgerError> {
        self.0.get(id).await
    }
    async fn counts(&self) -> Result<Counts, LedgerError> {
        self.0.counts().await
    }
    async fn purge(&self, n: usize, o: Duration) -> Result<usize, LedgerError> {
        self.0.purge(n, o).await
    }
}

// ---- ledger faults ----

pub const PASS: u8 = 0;
/// The write is not sent: the call fails before commit.
pub const FAIL_BEFORE: u8 = 1;
/// The write commits and the answer is an error: an uncertain commit.
pub const COMMIT_THEN_FAIL: u8 = 2;

/// Faults aimed at the `offered` write (the commit point of an offer), plus whole-ledger and read outages.
pub struct FaultLedger<L> {
    pub inner: L,
    pub offer_write: AtomicU8,
    /// After a `COMMIT_THEN_FAIL` write, reads fail too (the database is gone).
    pub get_down_after_commit: AtomicBool,
    pub get_down: AtomicBool,
    pub all_down: AtomicBool,
    pub offer_writes: AtomicU32,
}

impl<L> FaultLedger<L> {
    pub fn new(inner: L) -> Self {
        Self {
            inner,
            offer_write: AtomicU8::new(PASS),
            get_down_after_commit: AtomicBool::new(false),
            get_down: AtomicBool::new(false),
            all_down: AtomicBool::new(false),
            offer_writes: AtomicU32::new(0),
        }
    }
}

fn down() -> LedgerError {
    LedgerError::Unavailable("injected outage".into())
}

impl<L: Ledger> Ledger for FaultLedger<L> {
    async fn open_epoch(&self, c: [u8; 32]) -> Result<[u8; 32], LedgerError> {
        self.inner.open_epoch(c).await
    }
    async fn now_ms(&self) -> Result<i64, LedgerError> {
        if self.all_down.load(Ordering::SeqCst) {
            return Err(down());
        }
        self.inner.now_ms().await
    }
    async fn begin(&self, i: &Identity, h: &str, l: Duration) -> Result<Begin, LedgerError> {
        if self.all_down.load(Ordering::SeqCst) {
            return Err(down());
        }
        self.inner.begin(i, h, l).await
    }
    async fn write(
        &self,
        c: &Claim,
        s: &LedgerState,
        p: Phase,
        l: Duration,
    ) -> Result<WriteOutcome, LedgerError> {
        if self.all_down.load(Ordering::SeqCst) {
            return Err(down());
        }
        if p == Phase::Offered {
            self.offer_writes.fetch_add(1, Ordering::SeqCst);
            match self.offer_write.load(Ordering::SeqCst) {
                FAIL_BEFORE => return Err(down()),
                COMMIT_THEN_FAIL => {
                    let r = self.inner.write(c, s, p, l).await;
                    if self.get_down_after_commit.load(Ordering::SeqCst) {
                        self.get_down.store(true, Ordering::SeqCst);
                    }
                    return match r {
                        Ok(_) => Err(down()),
                        e => e,
                    };
                }
                _ => {}
            }
        }
        self.inner.write(c, s, p, l).await
    }
    async fn relinquish(&self, c: &Claim) -> Result<(), LedgerError> {
        self.inner.relinquish(c).await
    }
    fn relinquish_blocking(&self, c: &Claim) {
        self.inner.relinquish_blocking(c)
    }
    async fn claim_reapable(
        &self,
        h: &str,
        l: Duration,
        n: usize,
    ) -> Result<Vec<(Claim, Record)>, LedgerError> {
        if self.all_down.load(Ordering::SeqCst) {
            return Err(down());
        }
        self.inner.claim_reapable(h, l, n).await
    }
    async fn claim_for_release(
        &self,
        id: &str,
        h: &str,
        l: Duration,
    ) -> Result<ReleaseClaim, LedgerError> {
        self.inner.claim_for_release(id, h, l).await
    }
    async fn get(&self, id: &str) -> Result<Option<Record>, LedgerError> {
        if self.get_down.load(Ordering::SeqCst) || self.all_down.load(Ordering::SeqCst) {
            return Err(down());
        }
        self.inner.get(id).await
    }
    async fn counts(&self) -> Result<Counts, LedgerError> {
        self.inner.counts().await
    }
    async fn purge(&self, n: usize, o: Duration) -> Result<usize, LedgerError> {
        self.inner.purge(n, o).await
    }
}

// ---- backends ----

/// A deterministic barrier: `wait` announces arrival and blocks until released. Permits are stored, so the order of
/// `release` and `wait` never matters.
#[derive(Default)]
pub struct Gate {
    pub arrived: Notify,
    pub release: Notify,
}
impl Gate {
    pub async fn wait(&self) {
        self.arrived.notify_one();
        self.release.notified().await;
    }
}

/// Receipt tampering for `describe_placement` / `stop_placement` results.
pub const T_NONE: u8 = 0;
pub const T_MISSING: u8 = 1;
pub const T_FOREIGN: u8 = 2;
pub const T_WRONG_ID: u8 = 3;

/// GameLift wrapper: tampered receipts, one-shot gates around the first `start_placement`, and a one-shot "never applied"
/// start (`drop_next_start`: the call hangs before the provider sees it).
pub struct Tamper<T> {
    pub inner: T,
    pub tamper: AtomicU8,
    /// The first start: apply the effect, then wait here before returning the receipt.
    pub hold_start_receipt: Mutex<Option<Arc<Gate>>>,
    /// The first start: wait here before the provider sees the request.
    pub hold_start_effect: Mutex<Option<Arc<Gate>>>,
}

impl<T> Tamper<T> {
    pub fn new(inner: T) -> Self {
        Self {
            inner,
            tamper: AtomicU8::new(T_NONE),
            hold_start_receipt: Mutex::new(None),
            hold_start_effect: Mutex::new(None),
        }
    }
    fn alter(&self, mut s: PlacementState) -> PlacementState {
        match self.tamper.load(Ordering::SeqCst) {
            T_MISSING => s.game_session_data = None,
            T_FOREIGN => s.game_session_data = Some("another-owner".into()),
            T_WRONG_ID => s.placement_id = "rh-another-id-1".into(),
            _ => {}
        }
        s
    }
}

impl<T: GameLiftBackend> GameLiftBackend for Tamper<T> {
    async fn start_placement(&self, r: &StartPlacement) -> Result<PlacementState, BackendError> {
        let before = self.hold_start_effect.lock().unwrap().take();
        if let Some(g) = before {
            g.wait().await;
        }
        let res = self.inner.start_placement(r).await;
        let after = self.hold_start_receipt.lock().unwrap().take();
        if let Some(g) = after {
            g.wait().await;
        }
        res
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.inner
            .describe_placement(id)
            .await
            .map(|s| self.alter(s))
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.inner.stop_placement(id).await.map(|s| self.alter(s))
    }
    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        self.inner.terminate_game_session(arn).await
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        self.inner.capacity().await
    }
}

/// DNS wrapper whose deletes (and optionally upserts) fail a set number of times.
pub struct FlakyDns<T> {
    pub inner: T,
    pub fail_deletes: AtomicU32,
}
impl<T> FlakyDns<T> {
    pub fn new(inner: T) -> Self {
        Self {
            inner,
            fail_deletes: AtomicU32::new(0),
        }
    }
}
impl<T: DnsBackend> DnsBackend for FlakyDns<T> {
    async fn upsert(&self, n: &str, ip: &str, t: u32) -> Result<(), BackendError> {
        self.inner.upsert(n, ip, t).await
    }
    async fn delete(&self, n: &str) -> Result<(), BackendError> {
        if self
            .fail_deletes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_sub(1))
            .is_ok()
        {
            return Err(BackendError::Unavailable("dns delete failed".into()));
        }
        self.inner.delete(n).await
    }
    async fn resolve_authoritative(&self, n: &str) -> Result<Vec<String>, BackendError> {
        self.inner.resolve_authoritative(n).await
    }
}

/// Records, at the moment each effect is sent, whether the ledger ALREADY showed the matching write-ahead intent.
/// Entries are `(effect, intent_was_committed)`. Wraps both traits so one probe sees GameLift and DNS.
pub struct Probe<T, L> {
    pub inner: T,
    pub ledger: Arc<L>,
    pub seen: Mutex<Vec<(String, bool)>>,
}
impl<T, L: Ledger> Probe<T, L> {
    pub fn new(inner: T, ledger: Arc<L>) -> Self {
        Self {
            inner,
            ledger,
            seen: Mutex::new(Vec::new()),
        }
    }
    pub fn effects(&self) -> Vec<(String, bool)> {
        self.seen.lock().unwrap().clone()
    }
    async fn check(
        &self,
        effect: &str,
        placement_id: Option<&str>,
        f: impl Fn(&LedgerState, &str) -> bool,
    ) {
        // placement ids are `rh-<request id>-<n>`
        let pid = placement_id.unwrap_or_default().to_string();
        let ok = match pid
            .strip_prefix("rh-")
            .and_then(|r| r.rsplit_once('-'))
            .map(|(id, _)| id.to_string())
        {
            Some(rid) => match self.ledger.get(&rid).await {
                Ok(Some(rec)) => f(&rec.state, &pid),
                _ => false,
            },
            None => false,
        };
        self.seen.lock().unwrap().push((effect.to_string(), ok));
    }
    /// DNS calls name a host, not a placement: find the attempt by its stored host (or any active row).
    async fn check_host(&self, effect: &str, host: &str, f: impl Fn(&DnsStep) -> bool) {
        // The request id is not in a hostname; a probe test has one request, `probe001`.
        let ok = match self.ledger.get("probe001").await {
            Ok(Some(rec)) => rec.state.attempts.iter().any(|a| match &a.dns {
                DnsStep::None => false,
                DnsStep::Intent { host: h }
                | DnsStep::Verified { host: h }
                | DnsStep::DeleteIntent { host: h }
                | DnsStep::Deleted { host: h } => h == host && f(&a.dns),
            }),
            _ => false,
        };
        self.seen.lock().unwrap().push((effect.to_string(), ok));
    }
}

impl<T: GameLiftBackend, L: Ledger> GameLiftBackend for Probe<T, L> {
    async fn start_placement(&self, r: &StartPlacement) -> Result<PlacementState, BackendError> {
        self.check("start", Some(&r.placement_id), |s, pid| {
            s.attempts.iter().any(|a| a.placement_id == pid)
        })
        .await;
        self.inner.start_placement(r).await
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.inner.describe_placement(id).await
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.check("stop", Some(id), |s, pid| {
            s.attempts
                .iter()
                .any(|a| a.placement_id == pid && a.stop == StopStep::Intent)
        })
        .await;
        self.inner.stop_placement(id).await
    }
    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        let ok = match self.ledger.get("probe001").await {
            Ok(Some(rec)) => rec.state.attempts.iter().any(|a| {
                a.terminate
                    == TermStep::Intent {
                        arn: arn.to_string(),
                    }
            }),
            _ => false,
        };
        self.seen.lock().unwrap().push(("terminate".into(), ok));
        self.inner.terminate_game_session(arn).await
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        self.inner.capacity().await
    }
}

impl<T: DnsBackend, L: Ledger> DnsBackend for Probe<T, L> {
    async fn upsert(&self, n: &str, ip: &str, t: u32) -> Result<(), BackendError> {
        self.check_host("upsert", n, |d| matches!(d, DnsStep::Intent { .. }))
            .await;
        self.inner.upsert(n, ip, t).await
    }
    async fn delete(&self, n: &str) -> Result<(), BackendError> {
        self.check_host("delete", n, |d| matches!(d, DnsStep::DeleteIntent { .. }))
            .await;
        self.inner.delete(n).await
    }
    async fn resolve_authoritative(&self, n: &str) -> Result<Vec<String>, BackendError> {
        self.inner.resolve_authoritative(n).await
    }
}
