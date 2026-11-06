//! The PostgreSQL ledger (feature `postgres`).
//!
//! Compatibility: this store owns the tables `rh_placement_epoch`, `rh_placement_requests` and the version table
//! `rh_placement_schema`. It does not use sqlx's migrator, so it never reads or writes `_sqlx_migrations`
//! (rh-persist's) and can share a database with it. A database whose `rh_placement_schema.version` is newer than
//! [`SCHEMA_VERSION`] is refused (a newer binary migrated it). Migrations are additive and run in one transaction
//! under an advisory lock, so two starting services cannot interleave.
//!
//! Every statement is parameterized, uses the server's `clock_timestamp()` for claims, and runs under a client-side
//! timeout plus server-side `statement_timeout`/`lock_timeout`. The pool is bounded with an acquire timeout. Errors are
//! reduced to a category and SQLSTATE: they never include the connection URL.

use super::*;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow};
use sqlx::Row as _;
use std::future::Future;
use std::str::FromStr;

const MIGRATION_1: &str = include_str!("../../migrations/0001_placement_ledger.sql");
const MIGRATION_2: &str = include_str!("../../migrations/0002_placement_ledger_version.sql");
const MIGRATION_3: &str = include_str!("../../migrations/0003_dns_send_obligations.sql");
const MIGRATION_LOCK: i64 = 0x7268_706c_6163_6531; // "rhplace1"

#[derive(Clone, Debug)]
pub struct PgLedgerConfig {
    pub max_connections: u32,
    pub acquire_timeout: Duration,
    /// Client-side budget per call. The server's `statement_timeout`/`lock_timeout` are set to four fifths of it, so the
    /// database cancels a statement before the client gives up on it (a statement the client abandoned while it was still
    /// queued server-side could otherwise land late; the row's version check makes that harmless, this makes it rare).
    pub op_timeout: Duration,
}

impl Default for PgLedgerConfig {
    fn default() -> Self {
        Self {
            max_connections: 8,
            acquire_timeout: Duration::from_secs(5),
            op_timeout: Duration::from_secs(10),
        }
    }
}

pub struct PgLedger {
    pool: PgPool,
    op_timeout: Duration,
}

fn map_err(e: sqlx::Error) -> LedgerError {
    match e {
        sqlx::Error::PoolTimedOut => LedgerError::Unavailable("database pool timed out".into()),
        sqlx::Error::PoolClosed => LedgerError::Unavailable("database pool closed".into()),
        sqlx::Error::Io(_) | sqlx::Error::Tls(_) => {
            LedgerError::Unavailable("database connection failed".into())
        }
        sqlx::Error::Database(d) => LedgerError::Unavailable(format!(
            "database error (SQLSTATE {})",
            d.code().as_deref().unwrap_or("unknown")
        )),
        sqlx::Error::ColumnDecode { .. } | sqlx::Error::Decode(_) => {
            LedgerError::Corrupt("undecodable ledger row".into())
        }
        _ => LedgerError::Unavailable("database error".into()),
    }
}

fn ms(d: Duration) -> i64 {
    i64::try_from(d.as_millis()).unwrap_or(i64::MAX)
}

/// Columns of a full record. `$`-free: no parameters inside.
const COLS: &str = "request_id, scope, fingerprint, request_json::text AS request_json, config_json::text AS config_json, \
    zone, phase, final_phase, final_placement_id, fence, version, claim_kind, claim_holder, \
    (claim_until IS NOT NULL AND claim_until > clock_timestamp()) AS claim_live, state::text AS state, \
    (extract(epoch from created_at) * 1000)::bigint AS created_ms, \
    (extract(epoch from updated_at) * 1000)::bigint AS updated_ms, \
    (extract(epoch from finished_at) * 1000)::bigint AS finished_ms";

fn decode(row: &PgRow) -> Result<Record, LedgerError> {
    let phase: String = row.try_get("phase").map_err(map_err)?;
    let final_phase: Option<String> = row.try_get("final_phase").map_err(map_err)?;
    let kind: String = row.try_get("claim_kind").map_err(map_err)?;
    let state: Option<String> = row.try_get("state").map_err(map_err)?;
    let corrupt = |m: &str| LedgerError::Corrupt(m.into());
    let state = match state {
        Some(s) => serde_json::from_str(&s).map_err(|_| corrupt("undecodable state"))?,
        None => LedgerState::default(),
    };
    Ok(Record {
        identity: Identity {
            request_id: row.try_get("request_id").map_err(map_err)?,
            scope: row.try_get("scope").map_err(map_err)?,
            fingerprint: row.try_get("fingerprint").map_err(map_err)?,
            request_json: row
                .try_get::<Option<String>, _>("request_json")
                .map_err(map_err)?
                .unwrap_or_default(),
            config_json: row
                .try_get::<Option<String>, _>("config_json")
                .map_err(map_err)?
                .unwrap_or_default(),
            zone: row
                .try_get::<Option<String>, _>("zone")
                .map_err(map_err)?
                .unwrap_or_default(),
        },
        phase: Phase::parse(&phase).ok_or_else(|| corrupt("unknown phase"))?,
        final_phase: final_phase
            .map(|p| Phase::parse(&p).ok_or_else(|| corrupt("unknown phase")))
            .transpose()?,
        final_placement_id: row.try_get("final_placement_id").map_err(map_err)?,
        fence: row.try_get("fence").map_err(map_err)?,
        version: row.try_get("version").map_err(map_err)?,
        claim: ClaimInfo {
            kind: ClaimKind::parse(&kind).ok_or_else(|| corrupt("unknown claim kind"))?,
            holder: row.try_get("claim_holder").map_err(map_err)?,
            live: row.try_get("claim_live").map_err(map_err)?,
        },
        state,
        created_ms: row.try_get("created_ms").map_err(map_err)?,
        updated_ms: row.try_get("updated_ms").map_err(map_err)?,
        finished_ms: row.try_get("finished_ms").map_err(map_err)?,
    })
}

fn claim_of(rec: &Record) -> Claim {
    Claim {
        request_id: rec.identity.request_id.clone(),
        holder: rec.claim.holder.clone().unwrap_or_default(),
        fence: rec.fence,
        kind: rec.claim.kind,
        version: rec.version,
    }
}

impl PgLedger {
    /// Connect with a bounded pool and make sure the schema is at [`SCHEMA_VERSION`].
    pub async fn connect(url: &str, cfg: PgLedgerConfig) -> Result<Self, LedgerError> {
        // A parse error is reduced like every other: it must never echo the URL.
        let opts = PgConnectOptions::from_str(url).map_err(map_err)?;
        Self::connect_with(opts, cfg).await
    }

    /// [`PgLedger::connect`] with parsed options.
    pub async fn connect_with(
        opts: PgConnectOptions,
        cfg: PgLedgerConfig,
    ) -> Result<Self, LedgerError> {
        let op_ms = ms(cfg.op_timeout) / 5 * 4;
        let op_ms = op_ms.max(1);
        let pool = PgPoolOptions::new()
            .max_connections(cfg.max_connections.max(1))
            .acquire_timeout(cfg.acquire_timeout)
            .after_connect(move |conn, _| {
                Box::pin(async move {
                    sqlx::query(&format!("SET statement_timeout = {op_ms}"))
                        .execute(&mut *conn)
                        .await?;
                    sqlx::query(&format!("SET lock_timeout = {op_ms}"))
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            })
            .connect_with(opts)
            .await
            .map_err(map_err)?;
        let l = Self {
            pool,
            op_timeout: cfg.op_timeout,
        };
        l.migrate().await?;
        Ok(l)
    }

    /// Use an existing pool. The caller owns its timeouts and MUST set the connections' `statement_timeout` below
    /// `op_timeout` (as [`PgLedger::connect`] does). Call [`PgLedger::migrate`] before use.
    pub fn from_pool(pool: PgPool, op_timeout: Duration) -> Self {
        Self { pool, op_timeout }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Idempotent; refuses a database migrated by a newer binary.
    pub async fn migrate(&self) -> Result<(), LedgerError> {
        self.run(async {
            let mut tx = self.pool.begin().await?;
            sqlx::query("SELECT pg_advisory_xact_lock($1)")
                .bind(MIGRATION_LOCK)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS rh_placement_schema (version bigint PRIMARY KEY, \
                 applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
            )
            .execute(&mut *tx)
            .await?;
            let current: Option<i64> =
                sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
                    .fetch_one(&mut *tx)
                    .await?;
            let current = current.unwrap_or(0);
            if current > SCHEMA_VERSION {
                return Ok(Err(LedgerError::Corrupt(
                    "database schema is newer than this binary".into(),
                )));
            }
            if current > 0 && current < 3 {
                // Old writers do not take the migration advisory lock. Serialize their
                // inserts/writes with the emptiness check and v3 constraint installation.
                sqlx::query("LOCK TABLE rh_placement_requests IN ACCESS EXCLUSIVE MODE")
                    .execute(&mut *tx)
                    .await?;
                let nonempty: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM rh_placement_requests)",
                )
                .fetch_one(&mut *tx)
                .await?;
                if nonempty {
                    return Ok(Err(LedgerError::Incompatible(
                        "nonempty pre-v3 placement ledger requires quiesced operator reconciliation before upgrade".into(),
                    )));
                }
            }
            for (version, script) in [(1_i64, MIGRATION_1), (2_i64, MIGRATION_2), (3_i64, MIGRATION_3)] {
                if current < version {
                    sqlx::raw_sql(script).execute(&mut *tx).await?;
                    sqlx::query("INSERT INTO rh_placement_schema (version) VALUES ($1)")
                        .bind(version)
                        .execute(&mut *tx)
                        .await?;
                }
            }
            tx.commit().await?;
            Ok(Ok(()))
        })
        .await?
    }

    /// One call under the client-side budget. The inner `Result` carries a store-level verdict.
    async fn run<T>(
        &self,
        f: impl Future<Output = Result<T, sqlx::Error>>,
    ) -> Result<T, LedgerError> {
        match tokio::time::timeout(self.op_timeout, f).await {
            Ok(r) => r.map_err(map_err),
            Err(_) => Err(LedgerError::Timeout),
        }
    }

    async fn classify_missed_write(&self, claim: &Claim) -> Result<WriteOutcome, LedgerError> {
        // The CAS matched no row: either the claim is gone (Fenced) or the phase move was illegal (Refused).
        let row = self.get(&claim.request_id).await?;
        match row {
            Some(r)
                if r.fence == claim.fence
                    && r.version == claim.version
                    && r.claim.holder.as_deref() == Some(&claim.holder)
                    && r.claim.kind == claim.kind
                    && r.claim.live =>
            {
                Err(LedgerError::Refused("illegal phase transition".into()))
            }
            _ => Ok(WriteOutcome::Fenced),
        }
    }
}

impl Ledger for PgLedger {
    fn op_budget(&self) -> Option<Duration> {
        Some(self.op_timeout)
    }

    async fn open_epoch(&self, candidate: [u8; 32]) -> Result<[u8; 32], LedgerError> {
        let nonce: Option<Vec<u8>> = self
            .run(async {
                let mut tx = self.pool.begin().await?;
                sqlx::query("SELECT pg_advisory_xact_lock($1)")
                    .bind(MIGRATION_LOCK + 1)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query(
                    "INSERT INTO rh_placement_epoch (nonce) SELECT $1 \
                     WHERE NOT EXISTS (SELECT 1 FROM rh_placement_requests) ON CONFLICT DO NOTHING",
                )
                .bind(candidate.to_vec())
                .execute(&mut *tx)
                .await?;
                let n: Option<Vec<u8>> = sqlx::query_scalar("SELECT nonce FROM rh_placement_epoch")
                    .fetch_optional(&mut *tx)
                    .await?;
                tx.commit().await?;
                Ok(n)
            })
            .await?;
        let nonce =
            nonce.ok_or_else(|| LedgerError::Corrupt("records exist without an epoch".into()))?;
        <[u8; 32]>::try_from(nonce.as_slice())
            .map_err(|_| LedgerError::Corrupt("stored epoch has the wrong length".into()))
    }

    async fn now_ms(&self) -> Result<i64, LedgerError> {
        self.run(
            sqlx::query_scalar("SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint")
                .fetch_one(&self.pool),
        )
        .await
    }

    async fn begin(
        &self,
        identity: &Identity,
        holder: &str,
        lease: Duration,
    ) -> Result<Begin, LedgerError> {
        let inserted = self
            .run(
                sqlx::query(
                    "INSERT INTO rh_placement_requests \
                     (request_id, scope, fingerprint, request_json, config_json, zone, phase, fence, claim_kind, \
                      claim_holder, claim_until, state) \
                     VALUES ($1, $2, $3, $4::text::jsonb, $5::text::jsonb, $6, 'active', 1, 'worker', $7, \
                      clock_timestamp() + ($8::bigint * interval '1 millisecond'), '{}'::jsonb) \
                     ON CONFLICT (request_id) DO NOTHING",
                )
                .bind(&identity.request_id)
                .bind(&identity.scope)
                .bind(&identity.fingerprint)
                .bind(&identity.request_json)
                .bind(&identity.config_json)
                .bind(&identity.zone)
                .bind(holder)
                .bind(ms(lease))
                .execute(&self.pool),
            )
            .await?
            .rows_affected();
        if inserted == 1 {
            return Ok(Begin::Started(Claim {
                request_id: identity.request_id.clone(),
                holder: holder.to_string(),
                fence: 1,
                kind: ClaimKind::Worker,
                version: 1,
            }));
        }
        let Some(r) = self.get(&identity.request_id).await? else {
            return Err(LedgerError::Corrupt("row vanished".into()));
        };
        if r.identity.scope != identity.scope || r.identity.fingerprint != identity.fingerprint {
            return Ok(Begin::Conflict);
        }
        Ok(match r.phase {
            Phase::Offered if !r.claim.live => match r.state.offer {
                Some(o) => Begin::Offered(Box::new(o)),
                None => return Err(LedgerError::Corrupt("offered without offer".into())),
            },
            Phase::Active if r.claim.live && r.claim.kind == ClaimKind::Worker => Begin::InProgress,
            p => Begin::Reused(p),
        })
    }

    async fn write(
        &self,
        claim: &Claim,
        state: &LedgerState,
        phase: Phase,
        lease: Duration,
    ) -> Result<WriteOutcome, LedgerError> {
        validate_write(state, phase)?;
        let json = serde_json::to_string(state)
            .map_err(|_| LedgerError::Refused("unserializable state".into()))?;
        let from: &[&str] = match phase {
            Phase::Active | Phase::Offered | Phase::Finished => &["active"],
            Phase::Releasing => &["offered", "releasing"],
            Phase::Released => &["releasing"],
            Phase::Tombstone => unreachable!("validated"),
        };
        let from: Vec<String> = from.iter().map(|s| s.to_string()).collect();
        let clears = matches!(phase, Phase::Offered | Phase::Finished | Phase::Released);
        let finishes = matches!(phase, Phase::Finished | Phase::Released);
        // The unfenced variant exists only for the `skip_fencing` negative control.
        #[cfg(feature = "fault-injection")]
        let fenced = !mutant(Mutant::SkipFencing);
        #[cfg(not(feature = "fault-injection"))]
        let fenced = true;
        let guard = if fenced {
            "AND fence = $5 AND version = $11 AND claim_holder = $6 AND claim_kind = $7 \
             AND claim_until > clock_timestamp() AND phase = ANY($4)"
        } else {
            "AND $5::bigint IS NOT NULL AND $11::bigint IS NOT NULL AND $6::text IS NOT NULL AND $7::text IS NOT NULL \
             AND phase = ANY($4)"
        };
        let sql = format!(
            "UPDATE rh_placement_requests SET state = $1::text::jsonb, phase = $2, version = version + 1, \
             claim_kind = CASE WHEN $3 THEN 'none' ELSE claim_kind END, \
             claim_holder = CASE WHEN $3 THEN NULL ELSE claim_holder END, \
             claim_until = CASE WHEN $3 THEN NULL ELSE clock_timestamp() + ($8::bigint * interval '1 millisecond') END, \
             updated_at = clock_timestamp(), \
             finished_at = CASE WHEN $9 THEN clock_timestamp() ELSE finished_at END \
             WHERE request_id = $10 {guard}"
        );
        let n = self
            .run(
                sqlx::query(&sql)
                    .bind(&json)
                    .bind(phase.as_str())
                    .bind(clears)
                    .bind(&from)
                    .bind(claim.fence)
                    .bind(&claim.holder)
                    .bind(claim.kind.as_str())
                    .bind(ms(lease))
                    .bind(finishes)
                    .bind(&claim.request_id)
                    .bind(claim.version)
                    .execute(&self.pool),
            )
            .await?
            .rows_affected();
        if n == 1 {
            Ok(WriteOutcome::Written)
        } else {
            self.classify_missed_write(claim).await
        }
    }

    async fn relinquish(&self, claim: &Claim) -> Result<(), LedgerError> {
        self.run(
            sqlx::query(
                "UPDATE rh_placement_requests SET claim_kind = 'none', claim_holder = NULL, claim_until = NULL \
                 WHERE request_id = $1 AND fence = $2 AND claim_holder = $3",
            )
            .bind(&claim.request_id)
            .bind(claim.fence)
            .bind(&claim.holder)
            .execute(&self.pool),
        )
        .await
        .map(|_| ())
    }

    async fn claim_reapable(
        &self,
        holder: &str,
        lease: Duration,
        limit: usize,
    ) -> Result<Vec<(Claim, Record)>, LedgerError> {
        let sql = format!(
            "WITH picked AS MATERIALIZED (SELECT request_id AS pid FROM rh_placement_requests \
               WHERE phase IN ('active', 'releasing') \
                 AND (claim_until IS NULL OR claim_until <= clock_timestamp()) \
               ORDER BY updated_at, request_id LIMIT $1 FOR UPDATE SKIP LOCKED) \
             UPDATE rh_placement_requests t SET fence = t.fence + 1, version = t.version + 1, \
               claim_kind = CASE WHEN t.phase = 'releasing' THEN 'release' ELSE 'reaper' END, \
               claim_holder = $2, claim_until = clock_timestamp() + ($3::bigint * interval '1 millisecond'), \
               updated_at = clock_timestamp() \
             FROM picked WHERE t.request_id = picked.pid RETURNING {COLS}"
        );
        let rows = self
            .run(
                sqlx::query(&sql)
                    .bind(i64::try_from(limit).unwrap_or(i64::MAX))
                    .bind(holder)
                    .bind(ms(lease))
                    .fetch_all(&self.pool),
            )
            .await?;
        rows.iter()
            .map(|row| decode(row).map(|rec| (claim_of(&rec), rec)))
            .collect()
    }

    async fn claim_for_release(
        &self,
        request_id: &str,
        holder: &str,
        lease: Duration,
    ) -> Result<ReleaseClaim, LedgerError> {
        let sql = format!(
            "UPDATE rh_placement_requests SET fence = fence + 1, version = version + 1, claim_kind = 'release', claim_holder = $2, \
               claim_until = clock_timestamp() + ($3::bigint * interval '1 millisecond'), updated_at = clock_timestamp() \
             WHERE request_id = $1 AND phase IN ('offered', 'releasing') \
               AND (claim_until IS NULL OR claim_until <= clock_timestamp()) RETURNING {COLS}"
        );
        let row = self
            .run(
                sqlx::query(&sql)
                    .bind(request_id)
                    .bind(holder)
                    .bind(ms(lease))
                    .fetch_optional(&self.pool),
            )
            .await?;
        if let Some(row) = row {
            let rec = decode(&row)?;
            return Ok(ReleaseClaim::Claimed(claim_of(&rec), Box::new(rec)));
        }
        Ok(match self.get(request_id).await? {
            None => ReleaseClaim::Missing,
            Some(r) => match r.phase {
                Phase::Released => ReleaseClaim::AlreadyReleased,
                Phase::Offered | Phase::Releasing => ReleaseClaim::Busy,
                p => ReleaseClaim::NotReleasable(p),
            },
        })
    }

    async fn get(&self, request_id: &str) -> Result<Option<Record>, LedgerError> {
        let sql = format!("SELECT {COLS} FROM rh_placement_requests WHERE request_id = $1");
        let row = self
            .run(
                sqlx::query(&sql)
                    .bind(request_id)
                    .fetch_optional(&self.pool),
            )
            .await?;
        row.as_ref().map(decode).transpose()
    }

    async fn counts(&self) -> Result<Counts, LedgerError> {
        let rows = self
            .run(
                sqlx::query(
                    "SELECT phase, (claim_until IS NOT NULL AND claim_until > clock_timestamp() AND claim_kind = 'worker') AS live, \
                     count(*)::bigint AS n FROM rh_placement_requests GROUP BY 1, 2",
                )
                .fetch_all(&self.pool),
            )
            .await?;
        let mut c = Counts::default();
        for r in rows {
            let phase: String = r.try_get("phase").map_err(map_err)?;
            let live: bool = r.try_get("live").map_err(map_err)?;
            let n = usize::try_from(r.try_get::<i64, _>("n").map_err(map_err)?).unwrap_or(0);
            c.total += n;
            match Phase::parse(&phase) {
                Some(Phase::Active | Phase::Releasing) => {
                    if live {
                        c.active_live += n;
                    } else {
                        c.unresolved += n;
                    }
                    if phase == "releasing" {
                        c.releasing += n;
                    }
                }
                Some(Phase::Offered) => c.offered += n,
                Some(Phase::Released) => c.released += n,
                Some(Phase::Finished) => c.finished += n,
                Some(Phase::Tombstone) => c.tombstones += n,
                None => return Err(LedgerError::Corrupt("unknown phase".into())),
            }
        }
        Ok(c)
    }

    async fn purge(&self, limit: usize, older_than: Duration) -> Result<usize, LedgerError> {
        let n = self
            .run(
                sqlx::query(
                    "UPDATE rh_placement_requests SET final_phase = phase, final_placement_id = state->'offer'->>'placement_id', phase = 'tombstone', request_json = NULL, \
                       config_json = NULL, zone = NULL, state = NULL, claim_kind = 'none', claim_holder = NULL, \
                       claim_until = NULL, updated_at = clock_timestamp(), version = version + 1 \
                     WHERE request_id IN (SELECT request_id FROM rh_placement_requests \
                       WHERE phase IN ('finished', 'released') \
                         AND finished_at < clock_timestamp() - ($2::bigint * interval '1 millisecond') \
                       ORDER BY finished_at, request_id LIMIT $1 FOR UPDATE SKIP LOCKED)",
                )
                .bind(i64::try_from(limit).unwrap_or(i64::MAX))
                .bind(ms(older_than))
                .execute(&self.pool),
            )
            .await?
            .rows_affected();
        Ok(n as usize)
    }
}
