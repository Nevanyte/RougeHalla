//! P-BOTS-5: the durable rows of the filler bots' learning stats (`BotStatsStore`), on PostgreSQL.
//!
//! This module is the off-tick storage boundary only: load every row, save one batch in one transaction. The learning
//! model (cells, decay, eviction, the bias view) lives with the policy in `rh_policy::bots::learning`, and the store that
//! drives these rows lives in `rh-server`; no simulation crate sees either. The schema is migration `0002_bot_stats.sql`
//! (additive: `schema_compat.min_binary` stays 1).
use sqlx::postgres::PgPool;
use sqlx::Row;

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

    /// Every baseline and entry row (the caller decodes and drops damaged rows).
    pub async fn load(&self) -> Result<Loaded, crate::Error> {
        let mut loaded = Loaded::default();
        for row in sqlx::query("SELECT tier, n, s FROM bot_learning_baseline")
            .fetch_all(&self.pool)
            .await?
        {
            loaded.baseline.push(BaselineRow {
                tier: row.try_get("tier")?,
                n: row.try_get("n")?,
                s: row.try_get("s")?,
            });
        }
        for row in sqlx::query("SELECT key, n, s FROM bot_learning_entries")
            .fetch_all(&self.pool)
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

    /// Applies one batch atomically: the touched baselines, the upserted cells and the evicted keys land together or not
    /// at all (a failed write keeps every row for the caller's next attempt).
    pub async fn save(&self, batch: &Batch) -> Result<(), crate::Error> {
        if batch.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
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
}
