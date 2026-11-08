//! P-BOTS-5: the durable rows of the filler bots' learning stats (`BotStatsStore`), on PostgreSQL.
//!
//! This module is the off-tick storage boundary only: load every row, save one batch in one transaction. The learning
//! model (cells, decay, eviction, the bias view) lives with the policy in `rh_policy::bots::learning`, and the store that
//! drives these rows lives in `rh-server`; no simulation crate sees either. The schema is migration `0002_bot_stats.sql`
//! (additive: `schema_compat.min_binary` stays 1).
use sqlx::postgres::PgPool;
use sqlx::{Connection, PgConnection, Row};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

/// The pool handle type, so a caller without a direct `sqlx` dependency (the server's `postgres` feature) can name it.
pub type Pool = PgPool;

/// One baseline cell (a tier's decayed placement mean).
#[derive(Clone, Debug, PartialEq)]
pub struct BaselineRow {
    pub tier: String,
    pub n: f64,
    pub s: f64,
}

/// One choice cell (a key's decayed residual mean).
#[derive(Clone, Debug, PartialEq)]
pub struct EntryRow {
    pub key: String,
    pub n: f64,
    pub s: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Loaded {
    pub baseline: Vec<BaselineRow>,
    pub entries: Vec<EntryRow>,
}

/// One write: the touched baselines, the upserted cells and the keys evicted since the last write, all in one transaction.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Batch {
    pub baseline: Vec<BaselineRow>,
    pub upserts: Vec<EntryRow>,
    pub deletes: Vec<String>,
}
impl Batch {
    pub fn is_empty(&self) -> bool {
        self.baseline.is_empty() && self.upserts.is_empty() && self.deletes.is_empty()
    }
}

/// The row store, cheap to clone (one pool handle).
#[derive(Clone)]
pub struct BotStatsDb {
    pool: PgPool,
}

impl BotStatsDb {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Offline/tooling row access. Live servers must use [`LeasedBotStatsDb`].
    pub async fn load(&self) -> Result<Loaded, crate::Error> {
        load_on(&mut *self.pool.acquire().await?).await
    }
    pub async fn save(&self, batch: &Batch) -> Result<(), crate::Error> {
        save_on(&mut *self.pool.acquire().await?, batch).await
    }
}

async fn load_on(connection: &mut PgConnection) -> Result<Loaded, crate::Error> {
    let mut loaded = Loaded::default();
    for row in sqlx::query("SELECT tier, n, s FROM bot_learning_baseline")
        .fetch_all(&mut *connection)
        .await?
    {
        loaded.baseline.push(BaselineRow {
            tier: row.try_get("tier")?,
            n: row.try_get("n")?,
            s: row.try_get("s")?,
        });
    }
    for row in sqlx::query("SELECT key, n, s FROM bot_learning_entries ORDER BY key")
        .fetch_all(&mut *connection)
        .await?
    {
        loaded.entries.push(EntryRow {
            key: row.try_get("key")?,
            n: row.try_get("n")?,
            s: row.try_get("s")?,
        });
    }
    Ok(loaded)
}

async fn save_on(connection: &mut PgConnection, batch: &Batch) -> Result<(), crate::Error> {
    if batch.is_empty() {
        return Ok(());
    }
    let mut tx = connection.begin().await?;
    if !batch.baseline.is_empty() {
        let tiers: Vec<&str> = batch.baseline.iter().map(|b| b.tier.as_str()).collect();
        let ns: Vec<f64> = batch.baseline.iter().map(|b| b.n).collect();
        let ss: Vec<f64> = batch.baseline.iter().map(|b| b.s).collect();
        sqlx::query(
                "INSERT INTO bot_learning_baseline (tier, n, s) \
                 SELECT tier, n, s FROM UNNEST($1::text[], $2::float8[], $3::float8[]) AS u(tier, n, s) \
                 ON CONFLICT (tier) DO UPDATE SET n = EXCLUDED.n, s = EXCLUDED.s",
            )
            .bind(&tiers)
            .bind(&ns)
            .bind(&ss)
            .execute(&mut *tx)
            .await?;
    }
    if !batch.deletes.is_empty() {
        let keys: Vec<&str> = batch.deletes.iter().map(String::as_str).collect();
        sqlx::query("DELETE FROM bot_learning_entries WHERE key = ANY($1)")
            .bind(&keys)
            .execute(&mut *tx)
            .await?;
    }
    if !batch.upserts.is_empty() {
        let keys: Vec<&str> = batch.upserts.iter().map(|e| e.key.as_str()).collect();
        let ns: Vec<f64> = batch.upserts.iter().map(|e| e.n).collect();
        let ss: Vec<f64> = batch.upserts.iter().map(|e| e.s).collect();
        sqlx::query(
                "INSERT INTO bot_learning_entries (key, n, s) \
                 SELECT key, n, s FROM UNNEST($1::text[], $2::float8[], $3::float8[]) AS u(key, n, s) \
                 ON CONFLICT (key) DO UPDATE SET n = EXCLUDED.n, s = EXCLUDED.s, updated_at = now()",
            )
            .bind(&keys)
            .bind(&ns)
            .bind(&ss)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Database-scoped, fixed namespace: every live learning writer must contend for the same lock.
const LEARNING_LOCK: i64 = 0x0052_4842_4f54_5335;

/// One dedicated session owns the lock AND performs every read/write. No pool save or reconnection is possible.
pub struct LeasedBotStatsDb {
    connection: Mutex<Option<PgConnection>>,
    disabled: AtomicBool,
}
impl LeasedBotStatsDb {
    /// Busy returns None without loading any learning rows. The caller controls its startup deadline.
    pub async fn acquire(pool: &PgPool) -> Result<Option<Self>, crate::Error> {
        let mut connection = PgConnection::connect_with(
            &pool
                .connect_options()
                .as_ref()
                .clone()
                .application_name("rh-bot-learning"),
        )
        .await?;
        let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
            .bind(LEARNING_LOCK)
            .fetch_one(&mut connection)
            .await?;
        if !acquired {
            return Ok(None);
        }
        Ok(Some(Self {
            connection: Mutex::new(Some(connection)),
            disabled: AtomicBool::new(false),
        }))
    }
    pub fn is_disabled(&self) -> bool {
        self.disabled.load(Ordering::SeqCst)
    }
    /// Called after cancellation/termination: poison first, then drop the idle owned connection. Never reconnect.
    pub fn disable(&self) {
        self.disabled.store(true, Ordering::SeqCst);
        if let Ok(mut connection) = self.connection.try_lock() {
            connection.take();
        }
    }
    pub async fn load(&self) -> Result<Loaded, crate::Error> {
        let mut guard = self.connection.lock().await;
        let result = if self.is_disabled() {
            Err(crate::Error::Invalid("learning lease disabled".into()))
        } else if let Some(connection) = guard.as_mut() {
            load_on(connection).await
        } else {
            Err(crate::Error::Invalid("learning lease absent".into()))
        };
        if result.as_ref().err().is_some_and(connection_lost) {
            self.disabled.store(true, Ordering::SeqCst);
            guard.take();
        }
        result
    }
    pub async fn save(&self, batch: &Batch) -> Result<(), crate::Error> {
        let mut guard = self.connection.lock().await;
        let result = if self.is_disabled() {
            Err(crate::Error::Invalid("learning lease disabled".into()))
        } else if let Some(connection) = guard.as_mut() {
            save_on(connection, batch).await
        } else {
            Err(crate::Error::Invalid("learning lease absent".into()))
        };
        if result.as_ref().err().is_some_and(connection_lost) {
            self.disabled.store(true, Ordering::SeqCst);
            guard.take();
        }
        result
    }
}
fn connection_lost(error: &crate::Error) -> bool {
    match error {
        crate::Error::Db(sqlx::Error::Database(error)) => error.code().is_some_and(|code| {
            code.starts_with("08") || matches!(code.as_ref(), "57P01" | "57P02" | "57P03")
        }),
        crate::Error::Db(
            sqlx::Error::Io(_)
            | sqlx::Error::Tls(_)
            | sqlx::Error::Protocol(_)
            | sqlx::Error::WorkerCrashed
            | sqlx::Error::PoolClosed
            | sqlx::Error::BeginFailed,
        ) => true,
        _ => false,
    }
}
