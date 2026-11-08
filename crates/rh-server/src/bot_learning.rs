//! P-BOTS-5: the filler bots' learning stats store (`BotStatsStore`) as a durable, off-tick boundary.
//!
//! The legacy store kept a small JSON file per process (its own file, its own module, never the profile store's). This port
//! keeps the same model and write discipline (a decayed baseline/entry table, writes only from `record`/`flush`/`close` and
//! at most one per `LEARN_WRITE_EVERY_MS`, no timers, dirty state survives a failed write) but the rows live in PostgreSQL
//! off the fixed step: a room/server calls `record` after a run resolves, never from the tick, and `rh-sim` never sees I/O.
//!
//! The pure decoding/recording/snapshot model is [`rh_policy::bots::learning`]; [`Backend`] is the durable boundary (the
//! PostgreSQL implementation is `rh_persist::bot_stats_db`, wrapped by [`PgBackend`] behind the `postgres` feature). The
//! read path is [`BotStatsStore::snapshot`]: the frozen [`LearnedBias`] the fill policy reads (rh-server `bot_fill`).
use std::collections::BTreeSet;

use rh_policy::bots::learning::{
    Cell, LearnedBias, RunSummary, Stats, Tier, LEARN_MAX_ENTRIES, LEARN_WRITE_EVERY_MS,
};

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
    fn load(&self) -> impl std::future::Future<Output = Result<Loaded, String>>;
    fn save(&self, batch: &Batch) -> impl std::future::Future<Output = Result<(), String>>;
}

/// The off-tick store. Open one per process (the source had one store per file): two writers on the same database would
/// replace each other's whole rows, exactly as two processes sharing one file did.
pub struct BotStatsStore<B: Backend> {
    backend: B,
    stats: Stats,
    cached: Option<LearnedBias>,
    pending_baseline: BTreeSet<Tier>,
    pending_entries: BTreeSet<String>,
    pending_deletes: BTreeSet<String>,
    /// The source's `lastWriteAt` (server ms), set when a write is ATTEMPTED, even if it then fails.
    last_write_ms: Option<i64>,
    closed: bool,
    last_error: Option<String>,
}

impl<B: Backend> BotStatsStore<B> {
    /// Opens the store on a migrated database: missing tiers start at the source's fresh cell, and a full table keeps its
    /// smallest-n rows (the deletions are flushed with the next write, as the source persisted its trimmed table).
    pub async fn open(backend: B) -> Result<Self, String> {
        let loaded = backend.load().await?;
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
        let trimmed = stats.trim();
        Ok(Self {
            backend,
            stats,
            cached: None,
            pending_baseline: BTreeSet::new(),
            pending_entries: BTreeSet::new(),
            pending_deletes: trimmed.into_iter().collect(),
            last_write_ms: None,
            closed: false,
            last_error: None,
        })
    }

    /// The frozen bias view a bot or the fill policy reads (source `snapshot`, cached until the next `record`).
    pub fn snapshot(&mut self) -> LearnedBias {
        if self.cached.is_none() {
            self.cached = Some(self.stats.snapshot());
        }
        self.cached.clone().expect("just cached")
    }

    /// Folds one resolved run in (source `record`): a void/too-small/unreadable summary changes nothing and returns false.
    /// The write follows the source's discipline: at most one per `LEARN_WRITE_EVERY_MS`, only from this call, and a failed
    /// write keeps the dirty rows for the next attempt.
    pub async fn record(&mut self, summary: &RunSummary<'_>, now_ms: i64) -> bool {
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
        self.write_if_due(now_ms).await;
        true
    }

    /// Flushes the dirty rows now (source `flush`): unlike a `record`, never subject to the write window.
    pub async fn flush(&mut self, now_ms: i64) {
        self.write(now_ms).await;
    }

    /// The room is closing (source `close`): flush and refuse further writes.
    pub async fn close(&mut self, now_ms: i64) {
        if self.closed {
            return;
        }
        self.write(now_ms).await;
        self.closed = true;
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// The last write failure, kept for the caller (the source logged it and stayed dirty; bots are never worth stopping
    /// the server for).
    pub fn last_write_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }

    /// The table bound (source `LEARN.maxEntries`), for callers that report or page the store.
    pub fn max_entries() -> usize {
        LEARN_MAX_ENTRIES
    }

    fn has_pending(&self) -> bool {
        !self.pending_baseline.is_empty()
            || !self.pending_entries.is_empty()
            || !self.pending_deletes.is_empty()
    }

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

    async fn write_if_due(&mut self, now_ms: i64) {
        if self.closed {
            return;
        }
        let due = match self.last_write_ms {
            None => true,
            // A clock that went backwards must not hold the next write off for as long as it went back.
            Some(last) => now_ms < last || now_ms - last >= LEARN_WRITE_EVERY_MS,
        };
        if due {
            self.write(now_ms).await;
        }
    }

    /// One batch, one transaction (the backend's contract): a failed write keeps every row pending and records the error
    /// (source: never throws, tries again next time).
    async fn write(&mut self, now_ms: i64) {
        if self.closed || !self.has_pending() {
            return;
        }
        self.last_write_ms = Some(now_ms);
        let batch = self.batch();
        match self.backend.save(&batch).await {
            Ok(()) => {
                self.pending_baseline.clear();
                self.pending_entries.clear();
                self.pending_deletes.clear();
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

#[cfg(test)]
mod tests;
