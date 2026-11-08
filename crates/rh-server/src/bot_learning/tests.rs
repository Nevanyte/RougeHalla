//! P-BOTS-5: the store's write discipline, eviction and read path against an in-memory backend. The durable SQL boundary
//! (batch/upsert/delete/atomicity and the schema guards) is pinned against the throwaway PostgreSQL cluster in
//! `crates/rh-persist/tests/bot_stats_db.rs`; the reference numbers here are the legacy `BotStatsStore.ts` formulas.
use std::sync::{Arc, Mutex};

use super::*;
use rh_policy::bots::learning::{
    Cell, LearnedBias, RunOutcome, RunSummary, Tier, LEARN_MAX_ENTRIES, LEARN_WRITE_EVERY_MS,
};

#[derive(Clone, Default)]
struct Inner {
    loaded: Loaded,
    fail: bool,
    saves: usize,
    last_batch: Batch,
}

#[derive(Clone, Default)]
struct Fake {
    inner: Arc<Mutex<Inner>>,
}

impl Fake {
    fn with(loaded: Loaded) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                loaded,
                ..Inner::default()
            })),
        }
    }
    fn fail(&self, fail: bool) {
        self.inner.lock().unwrap().fail = fail;
    }
    fn saves(&self) -> usize {
        self.inner.lock().unwrap().saves
    }
    fn loaded(&self) -> Loaded {
        self.inner.lock().unwrap().loaded.clone()
    }
    fn last_batch(&self) -> Batch {
        self.inner.lock().unwrap().last_batch.clone()
    }
}

impl Backend for Fake {
    async fn load(&self) -> Result<Loaded, String> {
        Ok(self.inner.lock().unwrap().loaded.clone())
    }
    async fn save(&self, batch: &Batch) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.fail {
            return Err("the peer is down".into());
        }
        inner.saves += 1;
        inner.last_batch = batch.clone();
        let mut loaded = inner.loaded.clone();
        for (tier, n, s) in &batch.baseline {
            match loaded.baseline.iter_mut().find(|(t, _, _)| t == tier) {
                Some(row) => {
                    row.1 = *n;
                    row.2 = *s;
                }
                None => loaded.baseline.push((tier.clone(), *n, *s)),
            }
        }
        for key in &batch.deletes {
            loaded.entries.retain(|(k, _, _)| k != key);
        }
        for (key, n, s) in &batch.upserts {
            match loaded.entries.iter_mut().find(|(k, _, _)| k == key) {
                Some(row) => {
                    row.1 = *n;
                    row.2 = *s;
                }
                None => loaded.entries.push((key.clone(), *n, *s)),
            }
        }
        inner.loaded = loaded;
        Ok(())
    }
}

fn choices(keys: &[&str]) -> Vec<String> {
    keys.iter().map(|k| (*k).to_string()).collect()
}

fn summary<'a>(
    tier: Tier,
    outcome: RunOutcome,
    place: f64,
    players: f64,
    choices: &'a [String],
) -> RunSummary<'a> {
    RunSummary {
        tier,
        outcome,
        place,
        players,
        choices,
    }
}

#[tokio::test]
async fn an_empty_store_is_learning_on_with_no_bias() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let snapshot = store.snapshot();
    assert!(snapshot.enabled());
    assert!(snapshot.is_empty());
    assert_eq!(snapshot.bias("faction|farmer|fire"), 0.);
    assert_eq!(backend.saves(), 0, "opening writes nothing");
}

#[tokio::test]
async fn the_write_window_holds_writes_but_flush_does_not() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let keys = choices(&["opener|north|flank", "camp|fire|elite"]);
    assert!(
        store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 4., &keys), 1_000)
            .await
    );
    assert_eq!(backend.saves(), 1, "the first record writes");
    let first = backend.loaded();
    assert_eq!(first.baseline.len(), 1);
    assert_eq!(first.entries.len(), 2);
    assert_eq!(first.baseline[0], ("easy".to_string(), 1., 1.));
    assert_eq!(backend.last_batch().deletes, Vec::<String>::new());
    // Within the window nothing is written (source: at most one write per LEARN.writeEveryMs).
    assert!(
        store
            .record(
                &summary(Tier::Easy, RunOutcome::Died, 4., 4., &keys),
                1_000 + LEARN_WRITE_EVERY_MS - 1
            )
            .await
    );
    assert_eq!(backend.saves(), 1);
    assert_eq!(backend.loaded(), first);
    // A flush is never subject to the window.
    store.flush(1_000 + LEARN_WRITE_EVERY_MS - 1).await;
    assert_eq!(backend.saves(), 2);
    let after = backend.loaded();
    assert!((after.baseline[0].1 - 1.99).abs() < 1e-12);
    assert_eq!(store.last_write_error(), None);
}

#[tokio::test]
async fn a_failed_batch_keeps_every_dirty_row_for_the_next_write() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let keys = choices(&["second|bow|kite"]);
    assert!(
        store
            .record(&summary(Tier::Hard, RunOutcome::Won, 1., 3., &keys), 1_000)
            .await
    );
    assert_eq!(backend.saves(), 1);
    backend.fail(true);
    let more = choices(&["second|wand|burst", "relic|ember|tempo"]);
    assert!(
        store
            .record(
                &summary(Tier::Hard, RunOutcome::Died, 3., 3., &more),
                30_000
            )
            .await
    );
    assert_eq!(store.last_write_error(), Some("the peer is down"));
    assert_eq!(
        backend.loaded().entries.len(),
        1,
        "a failed write persists nothing"
    );
    backend.fail(false);
    store.flush(31_000).await;
    assert_eq!(store.last_write_error(), None);
    let loaded = backend.loaded();
    assert_eq!(loaded.entries.len(), 3);
    let row = loaded
        .entries
        .iter()
        .find(|(k, _, _)| k == "relic|ember|tempo")
        .unwrap();
    // A new key starts at n=1 and the run's residual: 0.5 + 0 - 0.99/1.99 after the baseline's two runs.
    let r = 0.5 - 0.99 / 1.99;
    assert_eq!(row.1, 1.);
    assert!((row.2 - r).abs() < 1e-12, "{}", row.2);
}

#[tokio::test]
async fn a_full_table_keeps_the_smallest_n_and_deletes_the_victims() {
    let mut loaded = Loaded::default();
    for i in 1..=LEARN_MAX_ENTRIES + 1 {
        loaded
            .entries
            .push((format!("opener|{i}|flank"), i as f64, i as f64 / 2.));
    }
    let backend = Fake::with(loaded);
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    assert_eq!(store.snapshot().len(), LEARN_MAX_ENTRIES);
    store.flush(0).await;
    let trimmed = backend.loaded();
    assert_eq!(trimmed.entries.len(), LEARN_MAX_ENTRIES);
    assert!(!trimmed
        .entries
        .iter()
        .any(|(k, _, _)| k == "opener|1|flank"));
    let fresh = choices(&["opener|new|flank"]);
    assert!(
        store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 2., &fresh), 1_000)
            .await
    );
    store.flush(1_000).await;
    let after = backend.loaded();
    assert_eq!(after.entries.len(), LEARN_MAX_ENTRIES);
    assert!(!after.entries.iter().any(|(k, _, _)| k == "opener|2|flank"));
    assert!(after
        .entries
        .iter()
        .any(|(k, _, _)| k == "opener|new|flank"));
}

#[tokio::test]
async fn void_and_too_small_runs_never_touch_the_backend() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let keys = choices(&["spawn|north|close"]);
    assert!(
        !store
            .record(&summary(Tier::Easy, RunOutcome::Void, 1., 3., &keys), 1_000)
            .await
    );
    assert!(
        !store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 1.5, &keys), 1_000)
            .await
    );
    assert_eq!(backend.saves(), 0);
}

#[tokio::test]
async fn a_read_path_builds_the_bias_view_from_the_rows() {
    // The source's smoothed mean: (s + 0.5*8)/(n + 8) - 0.5.
    let mut loaded = Loaded::default();
    loaded
        .entries
        .push(("faction|hunter|frost".into(), 10., 7.));
    loaded
        .entries
        .push(("faction|farmer|fire".into(), 100., 0.));
    loaded.baseline.push(("normal".into(), 10., 7.));
    let backend = Fake::with(loaded);
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let snapshot = store.snapshot();
    assert!(snapshot.enabled());
    let want = 11. / 18. - 0.5;
    assert!((snapshot.bias("faction|hunter|frost") - want).abs() < 1e-12);
    assert_eq!(
        snapshot.bias("faction|farmer|fire"),
        -0.25,
        "the cap clamps a hopeless cell"
    );
    assert_eq!(
        snapshot.bias("faction|farmer|holy"),
        0.,
        "unknown keys read 0"
    );
    assert_eq!(LearnedBias::NO_BIAS.bias("faction|hunter|frost"), 0.);
    // The snapshot is cached until the next record.
    assert_eq!(store.snapshot(), snapshot);
}

#[tokio::test]
async fn damaged_rows_are_dropped_on_their_own() {
    let mut loaded = Loaded::default();
    loaded.baseline.push(("normal".into(), 1., 1.));
    loaded.baseline.push(("impossible".into(), 1., 1.));
    loaded.baseline.push(("hard".into(), 1., 2.));
    loaded.entries.push(("faction|farmer|fire".into(), 1., 0.5));
    loaded.entries.push(("faction|hunter|frost".into(), 1., 2.));
    loaded.entries.push(("bad".into(), 1., 0.5));
    let backend = Fake::with(loaded);
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    assert_eq!(store.snapshot().len(), 1);
    assert_eq!(store.snapshot().bias("faction|farmer|fire"), 0.);
    // The damaged hard baseline started fresh; the unknown tier was ignored.
    assert_eq!(store.core.stats.baseline(Tier::Hard), Cell::ZERO);
    assert_eq!(store.core.stats.baseline(Tier::Normal).n(), 1.);
}

#[tokio::test]
async fn a_closed_store_writes_nothing_more() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let keys = choices(&["opener|north|flank"]);
    assert!(
        store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 4., &keys), 1_000)
            .await
    );
    store.close(1_000).await;
    assert!(store.is_closed());
    assert_eq!(backend.saves(), 1, "close flushed nothing new");
    assert!(
        store
            .record(
                &summary(Tier::Easy, RunOutcome::Died, 4., 4., &keys),
                30_000
            )
            .await
    );
    store.flush(30_000).await;
    assert_eq!(backend.saves(), 1, "a closed store refuses further writes");
}

#[tokio::test]
async fn a_clock_that_went_backwards_does_not_hold_the_next_write_off() {
    let backend = Fake::default();
    let mut store = BotStatsStore::open(backend.clone()).await.unwrap();
    let keys = choices(&["opener|north|flank"]);
    assert!(
        store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 4., &keys), 5_000)
            .await
    );
    assert_eq!(backend.saves(), 1);
    assert!(
        store
            .record(&summary(Tier::Easy, RunOutcome::Won, 1., 4., &keys), 4_000)
            .await
    );
    assert_eq!(backend.saves(), 2, "a backwards clock is due, not blocked");
}

#[tokio::test]
async fn a_store_snapshot_is_the_fill_policy_read_path() {
    // The store's frozen snapshot is exactly what BotFillConfig reads for the faction softmax (P-BOTS-5 read path).
    let mut loaded = Loaded::default();
    loaded.entries.push(("faction|farmer|fire".into(), 10., 7.));
    let backend = Fake::with(loaded);
    let mut store = BotStatsStore::open(backend).await.unwrap();
    let cfg = crate::bot_fill::BotFillConfig::with_fill_to(4).with_learned(store.snapshot());
    assert!(cfg.learned.enabled());
    let want = 11. / 18. - 0.5;
    assert!((cfg.learned.bias("faction|farmer|fire") - want).abs() < 1e-12);
    assert_eq!(cfg.learned.bias("faction|hunter|fire"), 0.);
}

// ================================================================================================= live store (P-BOTS-5 remainder)

fn facts(outcome: RunOutcome, place: u32) -> BotRunFacts {
    BotRunFacts {
        tier: Tier::Normal,
        persona: rh_policy::bots::PersonaId::Farmer,
        faction: FactionId::Fire,
        outcome,
        place,
        players: 4,
    }
}

fn clock(ms: u64) -> (Arc<dyn Fn() -> i64 + Send + Sync>, Arc<Mutex<i64>>) {
    let cell = Arc::new(Mutex::new(ms as i64));
    let handle = cell.clone();
    (Arc::new(move || *handle.lock().unwrap()), cell)
}

#[tokio::test]
async fn a_live_sink_updates_the_snapshot_and_persists_the_batch() {
    let backend = Fake::default();
    let (clock, cell) = clock(1_000);
    let live = LiveLearning::start(backend.clone(), clock).await.unwrap();
    let key = facts(RunOutcome::Won, 1).faction_key();
    assert_eq!(key, "faction|farmer|fire");
    assert!(live.snapshot().is_empty());
    live.record(facts(RunOutcome::Won, 1));
    // The snapshot is refreshed immediately (the source manager's snapshot reflected the in-memory model), and the first
    // run of a tier says nothing.
    assert!(live.snapshot().enabled());
    assert_eq!(live.snapshot().bias(&key), 0.);
    live.flush().await;
    let loaded = backend.loaded();
    assert_eq!(loaded.baseline, vec![("normal".to_string(), 1., 1.)]);
    assert_eq!(loaded.entries, vec![(key.clone(), 1., 0.5)]);
    // A second run within the write window is in the snapshot at once but only reaches the backend on a flush.
    *cell.lock().unwrap() = 2_000;
    live.record(facts(RunOutcome::Died, 4));
    let mut expected = Stats::default();
    let one = choices(&["faction|farmer|fire"]);
    assert!(expected.apply(&summary(Tier::Normal, RunOutcome::Won, 1., 4., &one)));
    assert!(expected.apply(&summary(Tier::Normal, RunOutcome::Died, 4., 4., &one)));
    let want = expected.snapshot().bias(&key);
    assert!((live.snapshot().bias(&key) - want).abs() < 1e-12);
    assert_eq!(
        backend.loaded().entries[0].2,
        0.5,
        "within the window nothing is written yet"
    );
    live.flush().await;
    let loaded = backend.loaded();
    assert!((loaded.baseline[0].1 - 1.99).abs() < 1e-12);
    let expected_cell = expected.entries().get(&key).copied().unwrap();
    assert!((loaded.entries[0].1 - expected_cell.n()).abs() < 1e-12);
    assert!((loaded.entries[0].2 - expected_cell.s()).abs() < 1e-12);
    live.close().await;
}

#[tokio::test]
async fn a_failed_live_write_keeps_the_rows_and_the_next_flush_writes_them() {
    let backend = Fake::default();
    let (clock, _) = clock(1_000);
    let live = LiveLearning::start(backend.clone(), clock).await.unwrap();
    backend.fail(true);
    live.record(facts(RunOutcome::Won, 1));
    live.flush().await;
    assert!(
        backend.loaded().entries.is_empty(),
        "a failed write persists nothing"
    );
    backend.fail(false);
    live.flush().await;
    assert_eq!(
        backend.loaded().entries.len(),
        1,
        "the rows stayed dirty and the next write landed"
    );
    live.close().await;
}

#[tokio::test]
async fn a_closed_live_sink_refuses_further_records() {
    let backend = Fake::default();
    let (clock, _) = clock(1_000);
    let live = LiveLearning::start(backend.clone(), clock).await.unwrap();
    live.record(facts(RunOutcome::Won, 1));
    live.close().await;
    assert_eq!(
        backend.loaded().entries.len(),
        1,
        "close flushed the pending run"
    );
    live.record(facts(RunOutcome::Died, 4));
    live.flush().await;
    assert_eq!(
        backend.loaded().entries.len(),
        1,
        "a closed sink records nothing more"
    );
}

#[test]
fn postgres_alone_never_enables_learning_and_mode_is_explicit() {
    assert_eq!(
        LearningMode::from_args(&[
            "server".into(),
            "--database-url".into(),
            "postgres://local/test".into()
        ]),
        Ok(LearningMode::Off)
    );
    assert_eq!(
        LearningMode::from_args(&["--bot-learning".into(), "single-writer".into()]),
        Ok(LearningMode::SingleWriter)
    );
    assert_eq!(
        LearningMode::from_args(&["--bot-learning".into(), "off".into()]),
        Ok(LearningMode::Off)
    );
    assert!(LearningMode::from_args(&["--bot-learning".into()]).is_err());
    assert!(LearningMode::from_args(&["--bot-learning".into(), "on".into()]).is_err());
}

#[tokio::test]
async fn failed_final_flush_is_observable_and_never_claimed_durable() {
    let backend = Fake::default();
    let (clock, _) = clock(1000);
    let live = LiveLearning::start(backend.clone(), clock).await.unwrap();
    backend.fail(true);
    live.record(facts(RunOutcome::Won, 1));
    let report = live.close().await;
    assert!(!report.flushed);
    assert_eq!(report.pending_rows, 2);
    assert_eq!(report.last_error.as_deref(), Some("the peer is down"));
    assert!(!report.timed_out);
    assert!(backend.loaded().entries.is_empty());
}

struct Hanging {
    entered: Arc<tokio::sync::Notify>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    disabled: std::sync::atomic::AtomicBool,
}
struct SaveGuard(Arc<std::sync::atomic::AtomicBool>);
impl Drop for SaveGuard {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}
impl Backend for Hanging {
    async fn load(&self) -> Result<Loaded, String> {
        Ok(Loaded::default())
    }
    async fn save(&self, _: &Batch) -> Result<(), String> {
        let _guard = SaveGuard(self.cancelled.clone());
        self.entered.notify_one();
        std::future::pending().await
    }
    fn disable(&self) {
        self.disabled
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    fn is_disabled(&self) -> bool {
        self.disabled.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[tokio::test(start_paused = true)]
async fn total_close_budget_aborts_joins_and_allows_http_shutdown_to_proceed() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let entered = Arc::new(tokio::sync::Notify::new());
    let cancelled = Arc::new(AtomicBool::new(false));
    let live = LiveLearning::start_with_budget(
        Hanging {
            entered: entered.clone(),
            cancelled: cancelled.clone(),
            disabled: AtomicBool::new(false),
        },
        Arc::new(|| 1000),
        LearningBudget {
            attempt: Duration::from_secs(60),
            close: Duration::from_millis(20),
        },
    )
    .await
    .unwrap();
    live.record(facts(RunOutcome::Won, 1));
    entered.notified().await;
    let start = tokio::time::Instant::now();
    let http_shutdown = std::sync::atomic::AtomicBool::new(false);
    let (a, b) = tokio::join!(
        close_then(&live, || {
            assert!(
                cancelled.load(Ordering::SeqCst),
                "writer is cancelled before shutdown continuation"
            );
            http_shutdown.store(true, Ordering::SeqCst);
        }),
        live.close()
    );
    assert_eq!(a, b);
    assert!(a.timed_out);
    assert!(!a.flushed);
    assert!(a.disabled);
    assert_eq!(a.pending_rows, 2);
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(start.elapsed() <= Duration::from_millis(20));
    if !a.flushed {
        assert!(a.last_error.is_some());
    }
    assert!(
        http_shutdown.load(Ordering::SeqCst),
        "the caller proceeds after bounded learning close"
    );
    let before = live.snapshot();
    live.record(facts(RunOutcome::Died, 4));
    assert_eq!(before, live.snapshot());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closing_linearizes_with_a_record_delayed_before_core_lock() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let backend = Fake::default();
    let first = Arc::new(AtomicBool::new(true));
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (go_tx, go_rx) = std::sync::mpsc::channel();
    let go = Mutex::new(go_rx);
    let clock = Arc::new(move || {
        if first.swap(false, Ordering::SeqCst) {
            entered_tx.send(()).unwrap();
            go.lock().unwrap().recv().unwrap();
        }
        1000
    });
    let live = LiveLearning::start(backend.clone(), clock).await.unwrap();
    let handle = live.clone();
    let thread = std::thread::spawn(move || handle.record(facts(RunOutcome::Won, 1)));
    entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(live.close().await.flushed);
    go_tx.send(()).unwrap();
    thread.join().unwrap();
    assert!(backend.loaded().entries.is_empty());
    assert!(live.snapshot().is_empty());
}
struct Gated {
    backend: Fake,
    entered: Arc<tokio::sync::Notify>,
    go: Arc<tokio::sync::Notify>,
    first: std::sync::atomic::AtomicBool,
}
impl Backend for Gated {
    async fn load(&self) -> Result<Loaded, String> {
        self.backend.load().await
    }
    async fn save(&self, batch: &Batch) -> Result<(), String> {
        if self.first.swap(false, std::sync::atomic::Ordering::SeqCst) {
            self.entered.notify_one();
            self.go.notified().await;
        }
        self.backend.save(batch).await
    }
}
#[tokio::test]
async fn an_inflight_old_batch_cannot_clear_a_new_runs_dirty_cells() {
    let backend = Fake::default();
    let entered = Arc::new(tokio::sync::Notify::new());
    let go = Arc::new(tokio::sync::Notify::new());
    let live = LiveLearning::start(
        Gated {
            backend: backend.clone(),
            entered: entered.clone(),
            go: go.clone(),
            first: std::sync::atomic::AtomicBool::new(true),
        },
        Arc::new(|| 1000),
    )
    .await
    .unwrap();
    live.record(facts(RunOutcome::Won, 1));
    entered.notified().await;
    live.record(facts(RunOutcome::Died, 4));
    go.notify_one();
    assert!(live.flush().await.flushed);
    assert_eq!(backend.loaded().baseline[0].1, 1.99);
    live.close().await;
}
