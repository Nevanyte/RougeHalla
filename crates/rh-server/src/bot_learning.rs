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
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

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
    fn is_disabled(&self) -> bool {
        false
    }
    /// Poison/drop ownership after cancellation or close. Called only when the writer has stopped.
    fn disable(&self) {}
}

/// One bot run as the learning store consumes it (source `RunSummary` without its choice list: a Brain seat's choices
/// travel beside it through [`LearningSink::record_choices`]; the manager's faction key is always added).
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

/// What the director holds as the record caller: an immutable bias view for each managed arrival and a non-blocking record of a
/// resolved bot run (the source manager's `deps.store.snapshot()`/`deps.store.record()`).
pub trait LearningSink: Send + Sync {
    fn snapshot(&self) -> LearnedBias;
    fn record(&self, facts: BotRunFacts);
    /// [`LearningSink::record`] with the bot policy's own choice keys (source `[...summary.choices, factionKey]`). A sink
    /// that keeps no choices records the facts alone.
    fn record_choices(&self, facts: BotRunFacts, _choices: &[String]) {
        self.record(facts);
    }
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
    last_error: Option<String>,
    disabled: bool,
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
            last_error: None,
            disabled: false,
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
    let mut entries = loaded.entries;
    entries.sort_by(|a, b| a.0.cmp(&b.0)); // Source sorted serialization determines reload insertion order.
    for (key, n, s) in &entries {
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
pub struct PgBackend {
    db: rh_persist::bot_stats_db::LeasedBotStatsDb,
}
#[cfg(feature = "postgres")]
impl PgBackend {
    pub async fn acquire(pool: &rh_persist::bot_stats_db::Pool) -> Result<Option<Self>, String> {
        rh_persist::bot_stats_db::LeasedBotStatsDb::acquire(pool)
            .await
            .map(|db| db.map(|db| Self { db }))
            .map_err(|e| e.to_string())
    }
}
#[cfg(feature = "postgres")]
impl Backend for PgBackend {
    fn is_disabled(&self) -> bool {
        self.db.is_disabled()
    }
    fn disable(&self) {
        self.db.disable();
    }
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

/// Live learning is explicitly disabled unless the single-writer mode is requested.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LearningMode {
    #[default]
    Off,
    SingleWriter,
}
impl LearningMode {
    pub fn from_args(args: &[String]) -> Result<Self, &'static str> {
        let mut mode = Self::Off;
        for (i, arg) in args.iter().enumerate() {
            if arg == "--bot-learning" {
                mode = match args.get(i + 1).map(String::as_str) {
                    Some("off") => Self::Off,
                    Some("single-writer") => Self::SingleWriter,
                    _ => return Err("--bot-learning requires off or single-writer"),
                };
            }
        }
        Ok(mode)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LearningBudget {
    pub attempt: Duration,
    pub close: Duration,
}
impl Default for LearningBudget {
    fn default() -> Self {
        Self {
            attempt: Duration::from_secs(5),
            close: Duration::from_secs(6),
        }
    }
}
/// Best-effort statistics are separate from the durable human-result/spool drain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloseReport {
    pub flushed: bool,
    pub pending_rows: usize,
    pub last_error: Option<String>,
    pub timed_out: bool,
    pub disabled: bool,
}
fn report(core: &StatsCore, timed_out: bool, disabled: bool) -> CloseReport {
    let pending_rows =
        core.pending_baseline.len() + core.pending_entries.len() + core.pending_deletes.len();
    CloseReport {
        flushed: pending_rows == 0,
        pending_rows,
        last_error: core.last_error.clone(),
        timed_out,
        disabled: disabled || core.disabled,
    }
}
enum Cmd {
    Write,
    Flush(tokio::sync::oneshot::Sender<()>),
    Close(tokio::sync::oneshot::Sender<()>),
}

/// One leased backend, one serial writer, no periodic retry and no automatic reconnect.
pub struct LiveLearning<B: Backend + Send + Sync + 'static> {
    core: Arc<Mutex<StatsCore>>,
    bias: Arc<RwLock<LearnedBias>>,
    clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    tx: tokio::sync::mpsc::UnboundedSender<Cmd>,
    backend: Arc<B>,
    writer: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    closing: tokio::sync::Mutex<()>,
    closed_report: Mutex<Option<CloseReport>>,
    budget: LearningBudget,
}
async fn write_pending<B: Backend>(
    backend: &B,
    core: &Mutex<StatsCore>,
    now: i64,
    budget: Duration,
    force: bool,
) {
    let batch = {
        let mut core = core.lock().expect("bot learning core");
        if core.disabled
            || backend.is_disabled()
            || !core.pending()
            || (!force && (core.closed || !core.due(now)))
        {
            return;
        }
        core.mark_write(now);
        core.batch()
    };
    let result = tokio::time::timeout(budget, backend.save(&batch)).await;
    let result = match result {
        Ok(result) => result,
        Err(_) => {
            backend.disable();
            core.lock().expect("bot learning core").disabled = true;
            Err("learning write deadline exceeded; instance disabled".into())
        }
    };
    let mut core = core.lock().expect("bot learning core");
    match result {
        Ok(()) => {
            core.commit(&batch);
            core.last_error = None;
        }
        Err(error) => {
            core.disabled |= backend.is_disabled();
            eprintln!("[bot-stats] {error}; retaining dirty statistics");
            core.last_error = Some(error);
        }
    }
}
impl<B: Backend + Send + Sync + 'static> LiveLearning<B> {
    pub async fn start(
        backend: B,
        clock: Arc<dyn Fn() -> i64 + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        Self::start_with_budget(backend, clock, LearningBudget::default()).await
    }
    pub async fn start_with_budget(
        backend: B,
        clock: Arc<dyn Fn() -> i64 + Send + Sync>,
        budget: LearningBudget,
    ) -> Result<Arc<Self>, String> {
        let loaded = match tokio::time::timeout(budget.attempt, backend.load()).await {
            Ok(result) => result?,
            Err(_) => {
                backend.disable();
                return Err("learning load deadline exceeded".into());
            }
        };
        if backend.is_disabled() {
            return Err("learning ownership unavailable".into());
        }
        let mut stats = decode(loaded);
        let trimmed = stats.trim();
        let mut core = StatsCore::new(stats, trimmed);
        let initial = core.snapshot();
        let core = Arc::new(Mutex::new(core));
        let bias = Arc::new(RwLock::new(initial));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let writer_core = core.clone();
        let writer_clock = clock.clone();
        let backend = Arc::new(backend);
        let writer_backend = backend.clone();
        let writer = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                let force = !matches!(cmd, Cmd::Write);
                write_pending(
                    writer_backend.as_ref(),
                    &writer_core,
                    writer_clock(),
                    budget.attempt,
                    force,
                )
                .await;
                match cmd {
                    Cmd::Write => {}
                    Cmd::Flush(ack) => {
                        let _ = ack.send(());
                    }
                    Cmd::Close(ack) => {
                        let _ = ack.send(());
                        break;
                    }
                }
            }
        });
        Ok(Arc::new(Self {
            core,
            bias,
            clock,
            tx,
            backend,
            writer: tokio::sync::Mutex::new(Some(writer)),
            closing: tokio::sync::Mutex::new(()),
            closed_report: Mutex::new(None),
            budget,
        }))
    }
    pub fn snapshot(&self) -> LearnedBias {
        if self.backend.is_disabled() || self.core.lock().expect("bot learning core").disabled {
            LearnedBias::NO_BIAS
        } else {
            self.bias.read().expect("bot learning bias").clone()
        }
    }
    pub fn record(&self, facts: BotRunFacts) {
        self.record_choices(facts, &[]);
    }
    /// Source `BotManager.onResult`: the brain's choices in its order, then the manager's faction key.
    pub fn record_choices(&self, facts: BotRunFacts, brain_choices: &[String]) {
        let now = (self.clock)();
        // Stub: the brain's choices are not recorded yet.
        let _ = brain_choices;
        let choices = vec![facts.faction_key()];
        let summary = RunSummary {
            tier: facts.tier,
            outcome: facts.outcome,
            place: f64::from(facts.place),
            players: f64::from(facts.players),
            choices: &choices,
        };
        let due = {
            let mut core = self.core.lock().expect("bot learning core");
            // The same lock linearizes record with Closing, including a record delayed before this point.
            if core.closed || core.disabled || self.backend.is_disabled() {
                return;
            }
            let applied = core.record(&summary);
            if applied {
                *self.bias.write().expect("bot learning bias") = core.snapshot();
            }
            applied && core.pending() && core.due(now)
        };
        if due {
            let _ = self.tx.send(Cmd::Write);
        }
    }
    pub async fn flush(&self) -> CloseReport {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let timed_out = if self.tx.send(Cmd::Flush(tx)).is_ok() {
            tokio::time::timeout(self.budget.close, rx).await.is_err()
        } else {
            false
        };
        report(
            &self.core.lock().expect("bot learning core"),
            timed_out,
            self.backend.is_disabled(),
        )
    }
    /// The TOTAL wait for pending writes/final flush is bounded. Abort/join then releases the dedicated connection.
    pub async fn close(&self) -> CloseReport {
        let deadline = tokio::time::Instant::now() + self.budget.close;
        // Concurrent closes join the same bounded operation and receive its final report.
        // The first closer has an earlier/equal deadline and owns no unbounded storage await.
        let _closing = self.closing.lock().await;
        if let Some(report) = self
            .closed_report
            .lock()
            .expect("bot learning close")
            .clone()
        {
            return report;
        }
        self.core.lock().expect("bot learning core").closed = true;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sent = self.tx.send(Cmd::Close(tx)).is_ok();
        let (timed_out, writer_failed) = if sent {
            match tokio::time::timeout_at(deadline, rx).await {
                Err(_) => (true, false),
                Ok(Err(_)) => (false, true),
                Ok(Ok(())) => (false, false),
            }
        } else {
            (false, true)
        };
        if let Some(writer) = self.writer.lock().await.take() {
            // The actor has no blocking/synchronous I/O. Cancellation drops its pending SQL future;
            // join only waits for cancellation cleanup, never for a database response or an extra save.
            writer.abort();
            let _ = writer.await;
        }
        // No save future still borrows the connection; disable drops it without asynchronous I/O.
        self.backend.disable();
        let mut core = self.core.lock().expect("bot learning core");
        if timed_out {
            core.last_error = Some("learning close total deadline exceeded".into());
        } else if writer_failed {
            core.last_error = Some("learning writer ended before close acknowledgement".into());
        }
        let report = report(&core, timed_out, self.backend.is_disabled());
        *self.closed_report.lock().expect("bot learning close") = Some(report.clone());
        report
    }
}
/// The HTTP shutdown continuation runs after best-effort close, including storage timeout/failure.
pub async fn close_then<B: Backend + Send + Sync + 'static>(
    live: &LiveLearning<B>,
    shutdown: impl FnOnce(),
) -> CloseReport {
    let report = live.close().await;
    shutdown();
    report
}
impl<B: Backend + Send + Sync + 'static> LearningSink for LiveLearning<B> {
    fn snapshot(&self) -> LearnedBias {
        self.snapshot()
    }
    fn record(&self, facts: BotRunFacts) {
        self.record(facts)
    }
    fn record_choices(&self, facts: BotRunFacts, choices: &[String]) {
        LiveLearning::record_choices(self, facts, choices)
    }
}
#[cfg(test)]
mod tests;
