//! P-BOTS-5: the filler bots' learning stats store (`BotStatsStore`) as a durable, off-tick boundary.
//!
//! The legacy store kept a small JSON file per process (its own file, its own module, never the profile store's). This port
//! keeps the same model and write discipline (a decayed baseline/entry table, writes only from `record`/`flush`/`close` and
//! at most one per `LEARN_WRITE_EVERY_MS`, no timers, dirty state survives a failed write) but the rows live in PostgreSQL
//! off the fixed step: the server calls `record` when a run resolves (the director's room-result report), never from a tick,
//! and `rh-sim` never sees I/O.
//!
//! Two layers share the model: [`BotStatsStore`] is the plain async load/record/flush/close store (tests, tooling);
//! [`LiveLearning`] is the director-owned live store: synchronous in-memory `record` (so the next lobby's snapshot sees a
//! just-resolved run immediately, as the source manager's did), a background writer that performs the off-tick batch writes
//! and logs a failed one, a shared `LearnedBias` snapshot refreshed after every recorded run, and `flush`/`close` for
//! shutdown. [`LearningSink`] is what the director holds: the record caller (`BotManager.onResult`).
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use rh_policy::bots::learning::{
    Cell, LearnedBias, RunOutcome, RunSummary, Stats, Tier, LEARN_MAX_ENTRIES, LEARN_WRITE_EVERY_MS,
};
use rh_policy::bots::PersonaId;
use rh_sim::FactionId;

/// The rows a backend loads: every baseline and entry as stored (the store decodes and drops damaged rows).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Loaded {
    pub baseline: Vec<(String, f64, f64)>,
    pub entries: Vec<(String, f64, f64)>,
}

/// One write batch: the touched baselines, the upserted cells and the keys evicted since the last write.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Batch {
    pub baseline: Vec<(String, f64, f64)>,
    pub upserts: Vec<(String, f64, f64)>,
    pub deletes: Vec<String>,
}
impl Batch {
    pub fn is_empty(&self) -> bool {
        self.baseline.is_empty() && self.upserts.is_empty() && self.deletes.is_empty()
    }
}

/// The durable boundary the store drives. One implementation lives in this crate for PostgreSQL ([`PgBackend`]); the
/// in-memory test double in this module's tests pins the write discipline without a database.
pub trait Backend {
    fn load(&self) -> impl std::future::Future<Output = Result<Loaded, String>> + Send;
    fn save(&self, batch: &Batch) -> impl std::future::Future<Output = Result<(), String>> + Send;
}

/// One bot run as the learning store consumes it (source `RunSummary`, minus the brain's choice list, which the server
/// does not retain yet: the manager's own managed faction key is the only choice it adds).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BotRunFacts {
    pub tier: Tier,
    pub persona: PersonaId,
    pub faction: FactionId,
    pub outcome: RunOutcome,
    pub place: u32,
    pub players: u32,
}
impl BotRunFacts {
    /// The one choice the manager itself adds (source `onResult`: `faction|<persona>|<faction>`). The brain's own
    /// choices (opener/second/spawn/boon/...) need the memory layer and join here when it is ported (P-BOTS-1 remainder).
    pub fn faction_key(&self) -> String {
        format!(
            "faction|{}|{}",
            self.persona.as_str(),
            self.faction.as_str()
        )
    }
    /// Source outcome mapping: a resolved run is won/draw/died/mia; a void run never reaches the store.
    pub fn outcome(outcome: rh_sim::sim::Outcome) -> RunOutcome {
        match outcome {
            rh_sim::sim::Outcome::Won => RunOutcome::Won,
            rh_sim::sim::Outcome::Draw => RunOutcome::Draw,
            rh_sim::sim::Outcome::Died => RunOutcome::Died,
            rh_sim::sim::Outcome::Mia => RunOutcome::Mia,
        }
    }
}

/// Source `TierId` to the learning model's tier.
pub fn learning_tier(tier: rh_policy::bots::TierId) -> Tier {
    match tier {
        rh_policy::bots::TierId::Easy => Tier::Easy,
        rh_policy::bots::TierId::Normal => Tier::Normal,
        rh_policy::bots::TierId::Hard => Tier::Hard,
    }
}

/// What the director holds as the record caller: a frozen bias view for the next lobby and a non-blocking record of a
/// resolved bot run (the source manager's `deps.store.snapshot()`/`deps.store.record()`).
pub trait LearningSink: Send + Sync {
    fn snapshot(&self) -> LearnedBias;
    fn record(&self, facts: BotRunFacts);
}

/// The pure in-memory state of the store (source `entries`/`baseline`/`dirty`/`lastWriteAt`): synchronous, so the live
/// sink's `record` can update the snapshot without doing I/O.
struct StatsCore {
    stats: Stats,
    pending_baseline: BTreeSet<Tier>,
    pending_entries: BTreeSet<String>,
    pending_deletes: BTreeSet<String>,
    /// The source's `lastWriteAt`, set when a write is ATTEMPTED, even if it then fails.
    last_write_ms: Option<i64>,
    cached: Option<LearnedBias>,
    closed: bool,
}
impl StatsCore {
    fn new(stats: Stats, trimmed: Vec<String>) -> Self {
        Self {
            stats,
            pending_baseline: BTreeSet::new(),
            pending_entries: BTreeSet::new(),
            pending_deletes: trimmed.into_iter().collect(),
            last_write_ms: None,
            cached: None,
            closed: false,
        }
    }

    fn snapshot(&mut self) -> LearnedBias {
        if self.cached.is_none() {
            self.cached = Some(self.stats.snapshot());
        }
        self.cached.clone().expect("just cached")
    }

    /// Folds one run in (source `record`'s in-memory half): returns whether it applied.
    fn record(&mut self, summary: &RunSummary<'_>) -> bool {
        let Some(applied) = self.stats.apply_logged(summary) else {
            return false;
        };
        self.pending_baseline.insert(applied.tier);
        for key in applied.touched {
            self.pending_deletes.remove(&key);
            self.pending_entries.insert(key);
        }
        for key in applied.evicted {
            self.pending_entries.remove(&key);
            self.pending_deletes.insert(key);
        }
        self.cached = None;
        true
    }

    /// The source's due rule (`lastWriteAt` unset, a backwards clock, or the window elapsed).
    fn due(&self, now_ms: i64) -> bool {
        match self.last_write_ms {
            None => true,
            Some(last) => now_ms < last || now_ms - last >= LEARN_WRITE_EVERY_MS,
        }
    }

    fn pending(&self) -> bool {
        !self.pending_baseline.is_empty()
            || !self.pending_entries.is_empty()
            || !self.pending_deletes.is_empty()
    }

    /// The current pending rows as one batch (the caller decides whether to write it).
    fn batch(&self) -> Batch {
        let baseline = self
            .pending_baseline
            .iter()
            .map(|tier| {
                let cell = self.stats.baseline(*tier);
                (tier.as_str().to_string(), cell.n(), cell.s())
            })
            .collect();
        let upserts = self
            .pending_entries
            .iter()
            .filter_map(|key| {
                self.stats
                    .entries()
                    .get(key)
                    .map(|cell| (key.clone(), cell.n(), cell.s()))
            })
            .collect();
        let deletes = self.pending_deletes.iter().cloned().collect();
        Batch {
            baseline,
            upserts,
            deletes,
        }
    }

    fn mark_write(&mut self, now_ms: i64) {
        self.last_write_ms = Some(now_ms);
    }

    /// Clears exactly the rows a successful batch wrote: a row that a later run changed again while the write was in
    /// flight stays dirty for the next batch.
    fn commit(&mut self, batch: &Batch) {
        for (tier, n, s) in &batch.baseline {
            let Some(tier) = Tier::parse(tier) else {
                continue;
            };
            let cell = self.stats.baseline(tier);
            if cell.n() == *n && cell.s() == *s {
                self.pending_baseline.remove(&tier);
            }
        }
        for (key, n, s) in &batch.upserts {
            if self.pending_deletes.contains(key) {
                continue;
            }
            let current = self.stats.entries().get(key).copied();
            if current.is_some_and(|cell| cell.n() == *n && cell.s() == *s) {
                self.pending_entries.remove(key);
            }
        }
        for key in &batch.deletes {
            if !self.pending_entries.contains(key) {
                self.pending_deletes.remove(key);
            }
        }
    }
}

fn decode(loaded: Loaded) -> Stats {
    let mut stats = Stats::default();
    for (tier, n, s) in &loaded.baseline {
        let Some(tier) = Tier::parse(tier) else {
            continue;
        };
        if let Some(cell) = Cell::try_new(*n, *s) {
            stats.set_baseline(tier, cell);
        }
        // A damaged baseline row is unreachable under the table CHECKs; if one exists, the tier starts fresh (the
        // source set the whole file aside and started empty, which is the same outcome here for that tier).
    }
    for (key, n, s) in &loaded.entries {
        // A damaged entry is dropped on its own: one bad row is not worth the other rows (source load).
        if let Some(cell) = Cell::try_new(*n, *s) {
            stats.insert_entry(key.clone(), cell);
        }
    }
    stats
}

/// The plain async store: open (load), record (memory + a write when due), flush, close. The source's whole contract with
/// no live task; the tests and any offline tool use it, and [`LiveLearning`] is the server's version.
pub struct BotStatsStore<B: Backend> {
    backend: B,
    core: StatsCore,
    last_error: Option<String>,
}

impl<B: Backend> BotStatsStore<B> {
    /// Opens the store on a migrated database: missing tiers start at the source's fresh cell, and a full table keeps its
    /// smallest-n rows (the deletions are flushed with the next write, as the source persisted its trimmed table).
    pub async fn open(backend: B) -> Result<Self, String> {
        let mut stats = decode(backend.load().await?);
        let trimmed = stats.trim();
        Ok(Self {
            backend,
            core: StatsCore::new(stats, trimmed),
            last_error: None,
        })
    }

    /// The frozen bias view (source `snapshot`, cached until the next `record`).
    pub fn snapshot(&mut self) -> LearnedBias {
        self.core.snapshot()
    }

    /// Folds one resolved run in (source `record`); a void/too-small/unreadable summary changes nothing and returns false.
    pub async fn record(&mut self, summary: &RunSummary<'_>, now_ms: i64) -> bool {
        if !self.core.record(summary) {
            return false;
        }
        if !self.core.closed && self.core.due(now_ms) && self.core.pending() {
            self.write(now_ms).await;
        }
        true
    }

    /// Flushes the dirty rows now (source `flush`): unlike a `record`, never subject to the write window.
    pub async fn flush(&mut self, now_ms: i64) {
        if self.core.closed || !self.core.pending() {
            return;
        }
        self.write(now_ms).await;
    }

    /// The room is closing (source `close`): flush and refuse further writes.
    pub async fn close(&mut self, now_ms: i64) {
        if self.core.closed {
            return;
        }
        self.flush(now_ms).await;
        self.core.closed = true;
    }

    pub fn is_closed(&self) -> bool {
        self.core.closed
    }

    /// The last write failure, kept for the caller (the source logged it and stayed dirty; bots are never worth stopping
    /// the server for).
    pub fn last_write_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    pub fn max_entries() -> usize {
        LEARN_MAX_ENTRIES
    }

    async fn write(&mut self, now_ms: i64) {
        self.core.mark_write(now_ms);
        let batch = self.core.batch();
        match self.backend.save(&batch).await {
            Ok(()) => {
                self.core.commit(&batch);
                self.last_error = None;
            }
            Err(err) => self.last_error = Some(err),
        }
    }
}

/// The PostgreSQL boundary: rows loaded/saved by `rh_persist::bot_stats_db` in one transaction per batch.
#[cfg(feature = "postgres")]
#[derive(Clone)]
pub struct PgBackend {
    db: rh_persist::bot_stats_db::BotStatsDb,
}
#[cfg(feature = "postgres")]
impl PgBackend {
    pub fn new(pool: rh_persist::bot_stats_db::Pool) -> Self {
        Self {
            db: rh_persist::bot_stats_db::BotStatsDb::new(pool),
        }
    }
}
#[cfg(feature = "postgres")]
impl Backend for PgBackend {
    async fn load(&self) -> Result<Loaded, String> {
        let loaded = self.db.load().await.map_err(|e| e.to_string())?;
        Ok(Loaded {
            baseline: loaded
                .baseline
                .into_iter()
                .map(|r| (r.tier, r.n, r.s))
                .collect(),
            entries: loaded
                .entries
                .into_iter()
                .map(|r| (r.key, r.n, r.s))
                .collect(),
        })
    }
    async fn save(&self, batch: &Batch) -> Result<(), String> {
        let rows = rh_persist::bot_stats_db::Batch {
            baseline: batch
                .baseline
                .iter()
                .map(|(tier, n, s)| rh_persist::bot_stats_db::BaselineRow {
                    tier: tier.clone(),
                    n: *n,
                    s: *s,
                })
                .collect(),
            upserts: batch
                .upserts
                .iter()
                .map(|(key, n, s)| rh_persist::bot_stats_db::EntryRow {
                    key: key.clone(),
                    n: *n,
                    s: *s,
                })
                .collect(),
            deletes: batch.deletes.clone(),
        };
        self.db.save(&rows).await.map_err(|e| e.to_string())
    }
}

enum Cmd {
    /// Write the pending rows when due (a `record` asked for it).
    Write,
    /// Write the pending rows unconditionally and acknowledge (flush/close).
    Flush(tokio::sync::oneshot::Sender<()>),
}

/// The director-owned live store: the in-memory half is synchronous (record + snapshot, like the source manager), the
/// writes run on one background task off the tick, and every recorded run refreshes the shared snapshot the next lobby
/// reads. A failed write is logged with the rows kept dirty and retried by the next due record/flush.
pub struct LiveLearning<B: Backend + Send + Sync + 'static> {
    core: Arc<Mutex<StatsCore>>,
    bias: Arc<RwLock<LearnedBias>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    tx: tokio::sync::mpsc::UnboundedSender<Cmd>,
    closed: AtomicBool,
    _backend: std::marker::PhantomData<B>,
}

impl<B: Backend + Send + Sync + 'static> LiveLearning<B> {
    /// Loads the rows and starts the writer task (call from an async context; one live store per process/database).
    pub async fn start(
        backend: B,
        clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        let mut stats = decode(backend.load().await?);
        let trimmed = stats.trim();
        let mut core = StatsCore::new(stats, trimmed);
        let initial = core.snapshot();
        let core = Arc::new(Mutex::new(core));
        let bias = Arc::new(RwLock::new(initial));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let writer_core = core.clone();
        let writer_clock = clock.clone();
        let backend = Arc::new(backend);
        tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    Cmd::Write => {
                        let now = writer_clock();
                        let batch = {
                            let mut core = writer_core.lock().expect("bot learning core");
                            if core.closed || !core.pending() || !core.due(now) {
                                None
                            } else {
                                core.mark_write(now);
                                Some(core.batch())
                            }
                        };
                        if let Some(batch) = batch {
                            match backend.save(&batch).await {
                                Ok(()) => {
                                    writer_core
                                        .lock()
                                        .expect("bot learning core")
                                        .commit(&batch);
                                }
                                Err(err) => {
                                    eprintln!("[bot-stats] learning write failed ({err}); keeping the rows dirty for the next write");
                                }
                            }
                        }
                    }
                    Cmd::Flush(ack) => {
                        let now = writer_clock();
                        let batch = {
                            let mut core = writer_core.lock().expect("bot learning core");
                            if !core.pending() {
                                None
                            } else {
                                core.mark_write(now);
                                Some(core.batch())
                            }
                        };
                        if let Some(batch) = batch {
                            match backend.save(&batch).await {
                                Ok(()) => {
                                    writer_core
                                        .lock()
                                        .expect("bot learning core")
                                        .commit(&batch);
                                }
                                Err(err) => {
                                    eprintln!("[bot-stats] learning flush failed ({err}); keeping the rows dirty");
                                }
                            }
                        }
                        let _ = ack.send(());
                    }
                }
            }
        });
        Ok(Arc::new(Self {
            core,
            bias,
            clock,
            tx,
            closed: AtomicBool::new(false),
            _backend: std::marker::PhantomData,
        }))
    }

    /// The frozen bias view the next lobby's fill policy reads.
    pub fn snapshot(&self) -> LearnedBias {
        self.bias.read().expect("bot learning bias").clone()
    }

    /// Records one resolved bot run: the in-memory model and the shared snapshot update now; a due write is queued.
    pub fn record(&self, facts: BotRunFacts) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let now = (self.clock)();
        let choices = [facts.faction_key()];
        let summary = RunSummary {
            tier: facts.tier,
            outcome: facts.outcome,
            place: f64::from(facts.place),
            players: f64::from(facts.players),
            choices: &choices,
        };
        let (applied, due) = {
            let mut core = self.core.lock().expect("bot learning core");
            let applied = core.record(&summary);
            let due = applied && core.due(now) && core.pending();
            if applied {
                let snapshot = core.snapshot();
                *self.bias.write().expect("bot learning bias") = snapshot;
            }
            (applied, due)
        };
        if applied && due {
            let _ = self.tx.send(Cmd::Write);
        }
    }

    /// Best-effort flush for shutdown: writes the pending rows and waits for the writer.
    pub async fn flush(&self) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if self.tx.send(Cmd::Flush(tx)).is_ok() {
            let _ = rx.await;
        }
    }

    /// Flushes and refuses further records (the process is exiting).
    pub async fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.flush().await;
    }
}

impl<B: Backend + Send + Sync + 'static> LearningSink for LiveLearning<B> {
    fn snapshot(&self) -> LearnedBias {
        self.snapshot()
    }
    fn record(&self, facts: BotRunFacts) {
        self.record(facts)
    }
}

#[cfg(test)]
mod tests;
