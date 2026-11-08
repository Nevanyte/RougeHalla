//! `rh-persist`: the profile store for many independent writers, on PostgreSQL.
//!
//! It replaces the legacy single-file `ProfileStore`. Invariants (proven by `tests/`, see the README):
//! * one live match per profile, across hosts, by a lease with a monotonic fence;
//! * a match result is applied at most once per (match, profile), and a stale writer changes nothing;
//! * `profiles.gv` only moves together with an append-only `gv_ledger` row;
//! * a profile is its surrogate `profile_id`; the callsign is a unique, renamable display attribute that callers pass at the
//!   API edge and that is resolved to the id once per call;
//! * a purchase is idempotent by id and cannot overdraw.
//!
//! Achievement rules read durable counters and grant ids/cosmetics inside the result transaction.

pub mod account;
pub mod achievements;
pub mod admin;
pub mod bot_stats_db;
pub mod cosmetics;
pub mod legacy;
pub mod model;

use std::collections::BTreeMap;
use std::time::Duration;

use sha2::{Digest, Sha256};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::types::Json;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

pub use model::*;

/// `ignore_missing`: a database migrated by a NEWER binary (additive migrations, expand/contract) has applied versions this
/// binary does not embed; whether it may still run is decided by `schema_compat.min_binary`, not by the version list.
static MIGRATOR: sqlx::migrate::Migrator = {
    let mut m = sqlx::migrate!("./migrations");
    m.ignore_missing = true;
    m
};

/// The newest schema version this binary knows (its "binary version" for the `schema_compat` gate).
pub fn known_schema_version() -> i64 {
    MIGRATOR.iter().map(|m| m.version).max().unwrap_or(0)
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error(
        "the database requires a binary of schema version {required} or newer (schema_compat.min_binary); this binary is v{binary}; refusing to run"
    )]
    SchemaTooNew { required: i64, binary: i64 },
    #[error("unknown profile {0:?}")]
    UnknownProfile(String),
    #[error("profile {callsign:?} is already in a live match ({match_id}, owner {owner})")]
    LeaseHeld {
        callsign: String,
        match_id: Uuid,
        owner: String,
    },
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("conflict: {0}")]
    Conflict(String),
}

/// Postgres SQLSTATE codes whose errors repeat identically on retry: class 22 (data exception), class 23 (integrity
/// constraint violation) except `23505` (unique violation: a retry of an idempotent write resolves it into "already
/// applied" when a concurrent writer won), and class 42 (syntax error or undefined object). Everything else (08
/// connection, 40 rollback or deadlock, 53 resources, 57 shutdown, 58 I/O) is transient.
pub fn permanent_sqlstate(code: &str) -> bool {
    (code.starts_with("22") || code.starts_with("23") || code.starts_with("42")) && code != "23505"
}

impl Error {
    /// True when retrying the identical operation can never succeed because the data itself is rejected (invalid input,
    /// constraint or data-exception violation, decode failure). False for connection, I/O, pool, timeout, deadlock and
    /// similar trouble, which a retry may cure however long it takes.
    pub fn is_permanent(&self) -> bool {
        match self {
            Error::Invalid(_) | Error::Json(_) | Error::UnknownProfile(_) | Error::Conflict(_) => {
                true
            }
            Error::Db(sqlx::Error::Database(d)) => d.code().is_some_and(|c| permanent_sqlstate(&c)),
            Error::Db(
                sqlx::Error::ColumnDecode { .. }
                | sqlx::Error::Decode(_)
                | sqlx::Error::ColumnNotFound(_)
                | sqlx::Error::ColumnIndexOutOfBounds { .. }
                | sqlx::Error::TypeNotFound { .. },
            ) => true,
            _ => false,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Constant-time equality for secrets (token hashes): the time does not depend on where the first difference is.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

pub fn hash_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Proof of ownership of a profile's live-match slot. A writer presents `fence` with its result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    pub profile_id: i64,
    /// The profile's callsign when the lease was taken (display only: the lease is keyed by `profile_id`).
    pub callsign: String,
    pub match_id: Uuid,
    pub owner: String,
    pub fence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    Created,
    Existing,
    Forbidden,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordOutcome {
    /// `gv_credited` is what was added to the balance; `unlocked` follows the legacy achievement catalog order.
    Applied {
        gv_credited: i64,
        unlocked: Vec<String>,
    },
    AlreadyApplied,
    StaleFence,
    NoLease,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PurchaseOutcome {
    Ok { gv_left: i64 },
    Insufficient { need: i64, have: i64 },
    AlreadyApplied,
    AlreadyOwned,
    BadToken,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EquipOutcome {
    Ok,
    NotOwned,
    BadToken,
}

#[derive(Clone)]
pub struct Store {
    pool: PgPool,
    /// Bumped (after COMMIT) whenever a result transaction credits GV or an equip changes a title; clones of the store share it. Leaderboard caches
    /// compare it to know when to drop (see `account.rs`). Other hosts' credits are not seen here: caches also expire.
    gv_epoch: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

type ProfileRow = (
    i64,
    String,
    Vec<u8>,
    i64,
    i64,
    Json<Stats>,
    Json<Cosmetics>,
    Json<BTreeMap<String, i64>>,
    Json<Progress>,
);

type ResultProfileRow = (
    i64,
    Json<Stats>,
    Json<Progress>,
    Json<Cosmetics>,
    Json<BTreeMap<String, i64>>,
);

impl Store {
    /// Connects and refuses a database whose `schema_compat.min_binary` is above this binary (it does not migrate).
    pub async fn connect(url: &str) -> Result<Store> {
        Self::connect_with(url, 16).await
    }

    pub async fn connect_with(url: &str, max_connections: u32) -> Result<Store> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(30))
            .connect(url)
            .await?;
        let store = Store::from_pool(pool);
        store.check_schema().await?;
        Ok(store)
    }

    pub fn from_pool(pool: PgPool) -> Store {
        Store {
            pool,
            gv_epoch: Default::default(),
        }
    }

    /// Every profile callsign (read-only): the bot fill's isNameTaken seam never creates or changes a profile.
    pub async fn profile_callsigns(&self) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar("SELECT callsign FROM profiles")
            .fetch_all(&self.pool)
            .await?)
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Applies the embedded migrations (after the compatibility check).
    pub async fn migrate(&self) -> Result<()> {
        self.check_schema().await?;
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    /// The newest applied migration, or `None` for a database that was never migrated.
    pub async fn schema_version(&self) -> Result<Option<i64>> {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
            .fetch_one(&self.pool)
            .await?;
        if !exists {
            return Ok(None);
        }
        let v: Option<i64> =
            sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success")
                .fetch_one(&self.pool)
                .await?;
        Ok(v)
    }

    /// The compatibility floor: refuses when the database says this binary is too old to run against it. A newer
    /// migration alone does not refuse (an additive one keeps `min_binary` where it was); a database with no
    /// `schema_compat` table is not migrated yet and passes.
    async fn check_schema(&self) -> Result<()> {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass('schema_compat') IS NOT NULL")
            .fetch_one(&self.pool)
            .await?;
        if !exists {
            return Ok(());
        }
        let required: Option<i32> = sqlx::query_scalar("SELECT min_binary FROM schema_compat")
            .fetch_optional(&self.pool)
            .await?;
        let binary = known_schema_version();
        match required {
            Some(r) if i64::from(r) > binary => Err(Error::SchemaTooNew {
                required: i64::from(r),
                binary,
            }),
            _ => Ok(()),
        }
    }

    // ---- profiles -------------------------------------------------------------------------------------------

    /// Legacy `claim`: creates the profile when the name is unknown (any case); otherwise the token must match.
    pub async fn create_profile(&self, callsign: &str, token: &str) -> Result<Claim> {
        if !valid_callsign(callsign) {
            return Err(Error::Invalid(format!("callsign {callsign:?}")));
        }
        if token.is_empty() {
            return Err(Error::Invalid("empty token".into()));
        }
        let hash = hash_token(token);
        // The unique index on lower(callsign) decides a race: the loser inserts nothing and falls through to a compare.
        let inserted = sqlx::query(
            "INSERT INTO profiles (callsign, token_sha256) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(callsign)
        .bind(&hash[..])
        .execute(&self.pool)
        .await?
        .rows_affected();
        if inserted == 1 {
            return Ok(Claim::Created);
        }
        Ok(if self.verify_token(callsign, token).await? {
            Claim::Existing
        } else {
            Claim::Forbidden
        })
    }

    /// Undoes a claim whose token could never be delivered (the request was cancelled after the insert committed):
    /// deletes the profile only when `token` is its own AND nothing references it yet (a fresh, never-used row). Returns
    /// whether a row was removed. A row with any history is never touched (the foreign keys refuse it).
    pub async fn discard_unclaimed_profile(&self, callsign: &str, token: &str) -> Result<bool> {
        let hash = hash_token(token);
        let res = sqlx::query(
            "DELETE FROM profiles p WHERE lower(p.callsign) = lower($1) AND p.token_sha256 = $2
               AND p.gv = 0 AND p.gv_lifetime = 0
               AND NOT EXISTS (SELECT 1 FROM session_leases WHERE profile_id = p.profile_id)
               AND NOT EXISTS (SELECT 1 FROM match_results WHERE profile_id = p.profile_id)
               AND NOT EXISTS (SELECT 1 FROM purchases WHERE profile_id = p.profile_id)
               AND NOT EXISTS (SELECT 1 FROM gv_ledger WHERE profile_id = p.profile_id)
               AND NOT EXISTS (SELECT 1 FROM gv_by_month WHERE profile_id = p.profile_id)",
        )
        .bind(callsign)
        .bind(&hash[..])
        .execute(&self.pool)
        .await;
        match res {
            Ok(r) => Ok(r.rows_affected() == 1),
            // A concurrent reference (FK violation) means it is in use after all: leave it.
            Err(sqlx::Error::Database(d)) if d.code().as_deref() == Some("23503") => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn verify_token(&self, callsign: &str, token: &str) -> Result<bool> {
        Ok(self.verify_token_id(callsign, token).await?.is_some())
    }

    /// The identity and credential are read from the same row. A later rename can
    /// change the display name but never the principal this token authenticated.
    pub async fn verify_token_id(&self, callsign: &str, token: &str) -> Result<Option<i64>> {
        let row: Option<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT profile_id, token_sha256 FROM profiles WHERE lower(callsign) = lower($1)",
        )
        .bind(callsign)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.and_then(|(id, stored)| ct_eq(&stored, &hash_token(token)).then_some(id)))
    }

    pub async fn get_profile(&self, callsign: &str) -> Result<Option<Profile>> {
        let mut c = self.pool.acquire().await?;
        load_profile(&mut c, callsign, false).await
    }

    /// Loads the durable principal authenticated by `verify_token_id`, even if its callsign was renamed or reassigned.
    pub async fn get_profile_by_id(&self, profile_id: i64) -> Result<Option<Profile>> {
        let mut c = self.pool.acquire().await?;
        load_profile_lookup(&mut c, ProfileLookup::Id(profile_id), false).await
    }

    /// Profiles by GV banked in `month`, highest first, ties by name (legacy `leaderboard`).
    pub async fn leaderboard(&self, month: &str, limit: i64) -> Result<Vec<(String, i64)>> {
        if !valid_month(month) {
            return Ok(vec![]);
        }
        let rows = sqlx::query(
            "SELECT p.callsign, m.gv FROM gv_by_month m JOIN profiles p USING (profile_id)
             WHERE m.month = $1 AND m.gv > 0 ORDER BY m.gv DESC, p.callsign LIMIT $2",
        )
        .bind(month)
        .bind(limit.clamp(1, 1000))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|r| (r.get(0), r.get(1))).collect())
    }

    // ---- leases ---------------------------------------------------------------------------------------------

    /// Takes the profile's live-match slot. Succeeds when there is no lease, the old one expired or was released
    /// (the fence is incremented), or it is the same (match, owner) still live (the fence is kept: idempotent).
    pub async fn acquire_lease(
        &self,
        callsign: &str,
        match_id: Uuid,
        owner: &str,
        ttl: Duration,
    ) -> Result<Lease> {
        let (profile_id, canon) = self.resolve(callsign).await?;
        let fence: Option<i64> = sqlx::query_scalar(
            "INSERT INTO session_leases (profile_id, match_id, owner, fence, expires_at)
             VALUES ($1, $2, $3, 1, now() + make_interval(secs => $4))
             ON CONFLICT (profile_id) DO UPDATE SET
               fence = CASE WHEN session_leases.released_at IS NULL
                              AND session_leases.match_id = EXCLUDED.match_id
                              AND session_leases.owner = EXCLUDED.owner
                            THEN session_leases.fence ELSE session_leases.fence + 1 END,
               match_id = EXCLUDED.match_id, owner = EXCLUDED.owner,
               expires_at = EXCLUDED.expires_at, released_at = NULL
             WHERE session_leases.released_at IS NOT NULL
                OR session_leases.expires_at < now()
                OR (session_leases.match_id = EXCLUDED.match_id AND session_leases.owner = EXCLUDED.owner)
             RETURNING fence",
        )
        .bind(profile_id)
        .bind(match_id)
        .bind(owner)
        .bind(ttl.as_secs_f64())
        .fetch_optional(&self.pool)
        .await?;
        match fence {
            Some(fence) => Ok(Lease {
                profile_id,
                callsign: canon,
                match_id,
                owner: owner.to_owned(),
                fence,
            }),
            None => {
                let (m, o): (Uuid, String) = sqlx::query_as(
                    "SELECT match_id, owner FROM session_leases WHERE profile_id = $1",
                )
                .bind(profile_id)
                .fetch_one(&self.pool)
                .await?;
                Err(Error::LeaseHeld {
                    callsign: canon,
                    match_id: m,
                    owner: o,
                })
            }
        }
    }

    /// Prepare a fresh (never idempotently shared) live admission in a rollback-on-drop
    /// transaction. Caller only commits after all locking/SQL has succeeded. NOWAIT handles
    /// existing rows, lock_timeout also bounds inserts/FK and conflicting first admissions.
    pub async fn prepare_live_lease(
        &self,
        profile_id: i64,
        match_id: Uuid,
        owner: &str,
        ttl: Duration,
        db_timeout: Duration,
    ) -> Result<(sqlx::Transaction<'static, sqlx::Postgres>, i64, String)> {
        let mut tx = self.pool.begin().await?;
        let ms = db_timeout.as_millis().clamp(1, i32::MAX as u128);
        sqlx::query(
            "SELECT set_config('lock_timeout',$1,true), set_config('statement_timeout',$1,true)",
        )
        .bind(format!("{ms}ms"))
        .execute(&mut *tx)
        .await?;
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT profile_id FROM profiles WHERE profile_id=$1 FOR UPDATE NOWAIT",
        )
        .bind(profile_id)
        .fetch_optional(&mut *tx)
        .await?;
        if exists.is_none() {
            return Err(Error::UnknownProfile(profile_id.to_string()));
        }
        sqlx::query("SELECT profile_id FROM session_leases WHERE profile_id=$1 FOR UPDATE NOWAIT")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        let (fence,writing_xid)=sqlx::query_as("INSERT INTO session_leases(profile_id,match_id,owner,fence,expires_at)
            VALUES($1,$2,$3,1,clock_timestamp()+make_interval(secs=>$4))
            ON CONFLICT(profile_id) DO UPDATE SET fence=session_leases.fence+1, match_id=EXCLUDED.match_id,
            owner=EXCLUDED.owner, expires_at=EXCLUDED.expires_at,released_at=NULL
            WHERE session_leases.released_at IS NOT NULL OR session_leases.expires_at < clock_timestamp()
            RETURNING fence,xmin::text").bind(profile_id).bind(match_id).bind(owner).bind(ttl.as_secs_f64())
            .fetch_optional(&mut *tx).await?.ok_or_else(||Error::Conflict("profile already leased".into()))?;
        Ok((tx, fence, writing_xid))
    }

    /// An unclaimed commit acknowledgement may follow a disconnect. Only the very row
    /// version written by this transaction can be reclaimed: an aborted insert may
    /// otherwise have the same not-yet-published fence as somebody else's next insert.
    pub async fn release_unclaimed_acquire(
        &self,
        id: i64,
        m: Uuid,
        fence: i64,
        writing_xid: &str,
    ) -> Result<bool> {
        let result=sqlx::query("UPDATE session_leases SET released_at=now(), expires_at=now()
            WHERE profile_id=$1 AND match_id=$2 AND fence=$3 AND xmin::text=$4 AND released_at IS NULL")
            .bind(id).bind(m).bind(fence).bind(writing_xid).execute(&self.pool).await?;
        Ok(result.rows_affected() == 1)
    }

    /// Read-only diagnostics for a caller with an identifiable profile but without
    /// proof that it was admitted under the supplied fence.
    pub async fn result_fence_status(&self, id: i64, m: Uuid, fence: i64) -> Result<(bool, bool)> {
        Ok(sqlx::query_as(
            "SELECT EXISTS(SELECT FROM match_results WHERE match_id=$1 AND profile_id=$2),
            EXISTS(SELECT FROM session_leases WHERE profile_id=$2 AND fence<>$3)",
        )
        .bind(m)
        .bind(id)
        .bind(fence)
        .fetch_one(&self.pool)
        .await?)
    }

    /// Extends a lease the caller still holds (fence matches and it was not released). An expired lease nobody took
    /// over can be renewed: the fence, not the clock, is what protects. By callsign: for edge and admin callers; a
    /// live match renews by the id its admission got ([`Store::renew_lease_by_id`]), which a rename cannot move.
    pub async fn renew_lease(&self, callsign: &str, fence: i64, ttl: Duration) -> Result<bool> {
        match self.profile_id(callsign).await? {
            Some(pid) => self.renew_lease_by_id(pid, fence, ttl).await,
            None => Ok(false),
        }
    }

    /// [`Store::renew_lease`] by `profile_id` (the id [`Lease::profile_id`] carried out of admission).
    pub async fn renew_lease_by_id(
        &self,
        profile_id: i64,
        fence: i64,
        ttl: Duration,
    ) -> Result<bool> {
        let n = sqlx::query(
            "UPDATE session_leases SET expires_at = now() + make_interval(secs => $3)
             WHERE profile_id = $1 AND fence = $2 AND released_at IS NULL",
        )
        .bind(profile_id)
        .bind(fence)
        .bind(ttl.as_secs_f64())
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(n == 1)
    }

    /// Live director heartbeat. Unlike administrative renewal, an expired row cannot be
    /// revived. A busy row is a transient database error, never an UPDATE left waiting
    /// behind another transaction after the caller's local timeout. Lock the row before
    /// judging its expiry; a completed result/takeover instead yields no matching row.
    pub async fn try_renew_live_lease(
        &self,
        profile_id: i64,
        match_id: Uuid,
        fence: i64,
        ttl: Duration,
    ) -> Result<bool> {
        let changed = sqlx::query(
            "WITH owned AS MATERIALIZED (
                 SELECT profile_id, expires_at FROM session_leases
                 WHERE profile_id = $1 AND match_id = $2 AND fence = $3 AND released_at IS NULL
                 FOR UPDATE NOWAIT
             )
             UPDATE session_leases AS l
             SET expires_at = statement_timestamp() + make_interval(secs => $4)
             FROM owned WHERE l.profile_id = owned.profile_id AND owned.expires_at > clock_timestamp()",
        )
        .bind(profile_id).bind(match_id).bind(fence).bind(ttl.as_secs_f64())
        .execute(&self.pool).await?.rows_affected();
        Ok(changed == 1)
    }

    /// Gives the slot back. The row stays (marked released) so the fence is never reused. False when the fence is
    /// stale or the lease was already released. By callsign, for edge and admin callers.
    pub async fn release_lease(&self, callsign: &str, fence: i64) -> Result<bool> {
        match self.profile_id(callsign).await? {
            Some(pid) => self.release_lease_by_id(pid, fence).await,
            None => Ok(false),
        }
    }

    /// [`Store::release_lease`] by `profile_id`.
    pub async fn release_lease_by_id(&self, profile_id: i64, fence: i64) -> Result<bool> {
        self.release_owned_lease(profile_id, fence, None).await
    }

    /// A room's deferred give-back names its match as well as its fence. If a callsign
    /// has been reassigned, the new profile can legitimately have the same numeric fence.
    pub async fn release_match_lease_by_id(
        &self,
        profile_id: i64,
        match_id: Uuid,
        fence: i64,
    ) -> Result<bool> {
        self.release_owned_lease(profile_id, fence, Some(match_id))
            .await
    }

    async fn release_owned_lease(
        &self,
        profile_id: i64,
        fence: i64,
        match_id: Option<Uuid>,
    ) -> Result<bool> {
        let n = sqlx::query(
            "UPDATE session_leases SET released_at = now(), expires_at = now()
             WHERE profile_id = $1 AND fence = $2 AND released_at IS NULL AND ($3::uuid IS NULL OR match_id = $3)",
        )
        .bind(profile_id)
        .bind(fence)
        .bind(match_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(n == 1)
    }

    /// The `(profile_id, callsign)` a name (any case) belongs to: the one lookup at the API edge, after which everything
    /// runs on the id.
    async fn resolve(&self, callsign: &str) -> Result<(i64, String)> {
        sqlx::query_as::<_, (i64, String)>(
            "SELECT profile_id, callsign FROM profiles WHERE lower(callsign) = lower($1)",
        )
        .bind(callsign)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::UnknownProfile(callsign.to_owned()))
    }

    /// The surrogate id of a profile by callsign (any case); `None` when unknown.
    pub async fn profile_id(&self, callsign: &str) -> Result<Option<i64>> {
        Ok(
            sqlx::query_scalar("SELECT profile_id FROM profiles WHERE lower(callsign) = lower($1)")
                .bind(callsign)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    // ---- results --------------------------------------------------------------------------------------------

    /// Banks one match for one player in ONE transaction. See the module docs for the order of the checks. `meta`
    /// describes the match; its `matches` row is inserted by the first result of the match and found by the others.
    /// By callsign (resolved here): for edge and admin callers; a live match banks by the id its admission got
    /// ([`Store::record_result_by_id`]), so a rename between admission and result cannot lose or misdirect it.
    pub async fn record_result(
        &self,
        match_id: Uuid,
        callsign: &str,
        fence: i64,
        result: &MatchResult,
        meta: &MatchMeta,
    ) -> Result<RecordOutcome> {
        let Some(pid) = self.profile_id(callsign).await? else {
            return Ok(RecordOutcome::NoLease);
        };
        self.record_inner(match_id, pid, fence, result, meta, false, None)
            .await
    }

    /// [`Store::record_result`] by `profile_id`.
    pub async fn record_result_by_id(
        &self,
        match_id: Uuid,
        profile_id: i64,
        fence: i64,
        result: &MatchResult,
        meta: &MatchMeta,
    ) -> Result<RecordOutcome> {
        self.record_inner(match_id, profile_id, fence, result, meta, false, None)
            .await
    }

    /// [`Store::record_result_by_id`] for a result replayed from a durable spool record (rh-server's crash recovery):
    /// `ended_at_ms` (Unix milliseconds) is the time the match's result was originally produced, and becomes the `matches`
    /// row's `ended_at` (advanced with `greatest`, as for any later result) instead of the commit time. Every
    /// other check, the fence included, is identical: a replay never bypasses a newer owner. `applied_at`, the GV month
    /// and achievement timestamps stay the commit time (they record when the credit landed).
    pub async fn record_result_by_id_at(
        &self,
        match_id: Uuid,
        profile_id: i64,
        fence: i64,
        result: &MatchResult,
        meta: &MatchMeta,
        ended_at_ms: Option<i64>,
    ) -> Result<RecordOutcome> {
        self.record_inner(
            match_id,
            profile_id,
            fence,
            result,
            meta,
            false,
            ended_at_ms,
        )
        .await
    }

    /// Test seam: does every write of `record_result`, then kills its own backend before COMMIT (as a crashed host
    /// or a dropped connection would) and returns the commit error. Nothing must be applied.
    #[doc(hidden)]
    pub async fn record_result_crash_before_commit(
        &self,
        match_id: Uuid,
        callsign: &str,
        fence: i64,
        result: &MatchResult,
        meta: &MatchMeta,
    ) -> Result<RecordOutcome> {
        let Some(pid) = self.profile_id(callsign).await? else {
            return Ok(RecordOutcome::NoLease);
        };
        self.record_inner(match_id, pid, fence, result, meta, true, None)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn record_inner(
        &self,
        match_id: Uuid,
        pid: i64,
        fence: i64,
        r: &MatchResult,
        meta: &MatchMeta,
        crash: bool,
        ended_at_ms: Option<i64>,
    ) -> Result<RecordOutcome> {
        let out = self
            .record_inner_tx(match_id, pid, fence, r, meta, crash, ended_at_ms)
            .await;
        if let Ok(RecordOutcome::Applied { gv_credited, .. }) = &out {
            if *gv_credited > 0 {
                self.gv_epoch
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        }
        out
    }

    #[allow(clippy::too_many_arguments)]
    async fn record_inner_tx(
        &self,
        match_id: Uuid,
        pid: i64,
        fence: i64,
        r: &MatchResult,
        meta: &MatchMeta,
        crash: bool,
        ended_at_ms: Option<i64>,
    ) -> Result<RecordOutcome> {
        let mut tx = self.pool.begin().await?;
        // The lease row is the per-profile mutex: everything below runs serialized per callsign.
        let lease: Option<(Uuid, i64, bool)> = sqlx::query_as(
            "SELECT match_id, fence, released_at IS NOT NULL FROM session_leases WHERE profile_id = $1 FOR UPDATE",
        )
        .bind(pid)
        .fetch_optional(&mut *tx)
        .await?;
        let applied: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM match_results WHERE match_id = $1 AND profile_id = $2)",
        )
        .bind(match_id)
        .bind(pid)
        .fetch_one(&mut *tx)
        .await?;
        if applied {
            return Ok(RecordOutcome::AlreadyApplied);
        }
        let Some((lease_match, lease_fence, released)) = lease else {
            return Ok(RecordOutcome::NoLease);
        };
        if lease_fence != fence {
            return Ok(RecordOutcome::StaleFence);
        }
        if released || lease_match != match_id {
            return Ok(RecordOutcome::NoLease);
        }

        let (lifetime_gv, stats, progress, cosmetics, achievements): ResultProfileRow =
            sqlx::query_as(
                "SELECT gv_lifetime, stats, progress, cosmetics, achievements
             FROM profiles WHERE profile_id = $1 FOR UPDATE",
            )
            .bind(pid)
            .fetch_one(&mut *tx)
            .await?;
        let (mut stats, mut progress, mut cosmetics, mut achievements) =
            (stats.0, progress.0, cosmetics.0, achievements.0);
        let gv = whole(r.gv.total);
        if let Some(outcome) = r.outcome {
            apply_run(&mut stats, &mut progress, outcome, r);
        }
        // A completed run evaluates even with zero GV. A voided run mirrors bankGv:
        // only a positive payout can unlock a lifetime achievement.
        let earned = if r.outcome.is_some() || gv > 0 {
            achievements::evaluate(
                &stats,
                &progress,
                lifetime_gv.saturating_add(gv),
                &achievements,
            )
        } else {
            Vec::new()
        };
        let unlocked: Vec<String> = earned.iter().map(|a| a.id.to_owned()).collect();
        if !earned.is_empty() {
            let at: i64 = sqlx::query_scalar(
                "SELECT greatest(0, floor(extract(epoch FROM transaction_timestamp()) * 1000))::bigint",
            )
            .fetch_one(&mut *tx)
            .await?;
            for a in earned {
                achievements.insert(a.id.to_owned(), at);
                for id in a.reward {
                    if !cosmetics.owned.iter().any(|owned| owned == id) {
                        cosmetics.owned.push((*id).to_owned());
                    }
                }
            }
        }
        let month: String =
            sqlx::query_scalar("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')")
                .fetch_one(&mut *tx)
                .await?;
        sqlx::query(
            "UPDATE profiles SET gv = gv + $2, gv_lifetime = gv_lifetime + $2, stats = $3, progress = $4,
                    cosmetics = $5, achievements = $6, updated_at = now() WHERE profile_id = $1",
        )
        .bind(pid)
        .bind(gv)
        .bind(Json(&stats))
        .bind(Json(&progress))
        .bind(Json(&cosmetics))
        .bind(Json(&achievements))
        .execute(&mut *tx)
        .await?;
        if gv > 0 {
            sqlx::query(
                "INSERT INTO gv_by_month (profile_id, month, gv) VALUES ($1, $2, $3)
                 ON CONFLICT (profile_id, month) DO UPDATE SET gv = gv_by_month.gv + EXCLUDED.gv",
            )
            .bind(pid)
            .bind(&month)
            .bind(gv)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO gv_ledger (profile_id, delta, reason, ref) VALUES ($1, $2, $3, $4)",
            )
            .bind(pid)
            .bind(gv)
            .bind(if r.outcome.is_some() {
                "run"
            } else {
                "void_run"
            })
            .bind(match_id.to_string())
            .execute(&mut *tx)
            .await?;
        }
        // The match row is shared by every player's result of the match: the first transaction inserts it, the others
        // find it (a concurrent one waits for that commit; nothing here waits on another player's row, so no cycle).
        sqlx::query(
            "INSERT INTO matches (match_id, owner, region, placement_id, build, content_hash, humans, bots, ended_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce(to_timestamp($9::bigint::float8 / 1000.0), now()))
             ON CONFLICT (match_id) DO UPDATE
             SET ended_at = greatest(matches.ended_at, coalesce(to_timestamp($9::bigint::float8 / 1000.0), now()))",
        )
        .bind(match_id)
        .bind(&meta.owner)
        .bind(&meta.region)
        .bind(&meta.placement_id)
        .bind(&meta.build)
        .bind(meta.content_hash as i64)
        .bind(i32::try_from(meta.humans).unwrap_or(i32::MAX))
        .bind(i32::try_from(meta.bots).unwrap_or(i32::MAX))
        .bind(ended_at_ms)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO match_results (match_id, profile_id, result, fence) VALUES ($1, $2, $3, $4)",
        )
        .bind(match_id)
        .bind(pid)
        .bind(Json(StoredResult {
            v: RESULT_VERSION,
            result: r.clone(),
        }))
        .bind(fence)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE session_leases SET released_at = now(), expires_at = now() WHERE profile_id = $1",
        )
        .bind(pid)
        .execute(&mut *tx)
        .await?;
        if crash {
            let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("SELECT pg_terminate_backend($1)")
                .bind(pid)
                .execute(&self.pool)
                .await?;
            // Give the postmaster a moment to kill the backend; the commit then fails on a dead connection.
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        tx.commit().await?;
        Ok(RecordOutcome::Applied {
            gv_credited: gv,
            unlocked,
        })
    }

    // ---- shop -----------------------------------------------------------------------------------------------

    /// Buys `item_id` at `price` (the catalog lives in the caller). Idempotent by `purchase_id`; the debit, the
    /// grant and the ledger row are one transaction under the profile's row lock, and the balance can't go below 0.
    /// Spending lowers `gv` only, never `gv_lifetime` or `gv_by_month` (legacy rule).
    pub async fn purchase(
        &self,
        callsign: &str,
        token: &str,
        purchase_id: Uuid,
        item_id: &str,
        price: i64,
    ) -> Result<PurchaseOutcome> {
        self.purchase_lookup(
            ProfileLookup::Name(callsign),
            token,
            purchase_id,
            item_id,
            price,
        )
        .await
    }

    /// Buys for the already authenticated durable principal. The transaction rechecks its token under the same row lock.
    pub async fn purchase_by_id(
        &self,
        profile_id: i64,
        token: &str,
        purchase_id: Uuid,
        item_id: &str,
        price: i64,
    ) -> Result<PurchaseOutcome> {
        self.purchase_lookup(
            ProfileLookup::Id(profile_id),
            token,
            purchase_id,
            item_id,
            price,
        )
        .await
    }

    async fn purchase_lookup(
        &self,
        profile: ProfileLookup<'_>,
        token: &str,
        purchase_id: Uuid,
        item_id: &str,
        price: i64,
    ) -> Result<PurchaseOutcome> {
        if price < 0 {
            return Err(Error::Invalid("negative price".into()));
        }
        let mut tx = self.pool.begin().await?;
        let Some(pid) = locked_authorized(&mut tx, profile, token).await? else {
            return Ok(PurchaseOutcome::BadToken);
        };
        let prior: Option<(i64, String)> =
            sqlx::query_as("SELECT profile_id, item_id FROM purchases WHERE purchase_id = $1")
                .bind(purchase_id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((c, item)) = prior {
            if c == pid && item == item_id {
                return Ok(PurchaseOutcome::AlreadyApplied);
            }
            return Err(Error::Conflict(format!(
                "purchase id {purchase_id} was used for something else"
            )));
        }
        let (gv, mut cosmetics): (i64, Json<Cosmetics>) =
            sqlx::query_as("SELECT gv, cosmetics FROM profiles WHERE profile_id = $1")
                .bind(pid)
                .fetch_one(&mut *tx)
                .await?;
        if cosmetics.owned.iter().any(|o| o == item_id) {
            return Ok(PurchaseOutcome::AlreadyOwned);
        }
        if gv < price {
            return Ok(PurchaseOutcome::Insufficient {
                need: price,
                have: gv,
            });
        }
        cosmetics.owned.push(item_id.to_owned());
        let left: Option<i64> = sqlx::query_scalar(
            "UPDATE profiles SET gv = gv - $2, cosmetics = $3, updated_at = now()
             WHERE profile_id = $1 AND gv >= $2 RETURNING gv",
        )
        .bind(pid)
        .bind(price)
        .bind(&cosmetics)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(left) = left else {
            return Ok(PurchaseOutcome::Insufficient {
                need: price,
                have: gv,
            });
        };
        // The key is global. Two different profiles presenting the same key at once both pass the check above (each
        // holds only its own row lock); the second insert must be a clean conflict, not a primary-key error (a 500).
        // The transaction is dropped without commit, so this profile's debit and grant roll back.
        let inserted = sqlx::query(
            "INSERT INTO purchases (purchase_id, profile_id, item_id, price) VALUES ($1, $2, $3, $4)
             ON CONFLICT (purchase_id) DO NOTHING",
        )
        .bind(purchase_id)
        .bind(pid)
        .bind(item_id)
        .bind(price)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if inserted == 0 {
            return Err(Error::Conflict(format!(
                "purchase id {purchase_id} was used for something else"
            )));
        }
        sqlx::query(
            "INSERT INTO gv_ledger (profile_id, delta, reason, ref) VALUES ($1, $2, 'purchase', $3)",
        )
        .bind(pid)
        .bind(-price)
        .bind(purchase_id.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(PurchaseOutcome::Ok { gv_left: left })
    }

    /// Equips owned `item_id` in `slot`, or empties the slot when `item_id` is `None`. The caller validates that the
    /// slot and the item belong together (the cosmetic catalog is not in this crate).
    pub async fn equip(
        &self,
        callsign: &str,
        token: &str,
        slot: &str,
        item_id: Option<&str>,
    ) -> Result<EquipOutcome> {
        self.equip_lookup(ProfileLookup::Name(callsign), token, slot, item_id)
            .await
    }

    /// Equips for the already authenticated durable principal, rechecking its token under that profile's row lock.
    pub async fn equip_by_id(
        &self,
        profile_id: i64,
        token: &str,
        slot: &str,
        item_id: Option<&str>,
    ) -> Result<EquipOutcome> {
        self.equip_lookup(ProfileLookup::Id(profile_id), token, slot, item_id)
            .await
    }

    async fn equip_lookup(
        &self,
        profile: ProfileLookup<'_>,
        token: &str,
        slot: &str,
        item_id: Option<&str>,
    ) -> Result<EquipOutcome> {
        let mut tx = self.pool.begin().await?;
        let Some(pid) = locked_authorized(&mut tx, profile, token).await? else {
            return Ok(EquipOutcome::BadToken);
        };
        let mut cosmetics: Json<Cosmetics> =
            sqlx::query_scalar("SELECT cosmetics FROM profiles WHERE profile_id = $1")
                .bind(pid)
                .fetch_one(&mut *tx)
                .await?;
        match item_id {
            None => {
                cosmetics.equipped.remove(slot);
            }
            Some(id) => {
                if !cosmetics.owned.iter().any(|o| o == id) {
                    return Ok(EquipOutcome::NotOwned);
                }
                cosmetics.equipped.insert(slot.to_owned(), id.to_owned());
            }
        }
        sqlx::query("UPDATE profiles SET cosmetics = $2, updated_at = now() WHERE profile_id = $1")
            .bind(pid)
            .bind(&cosmetics)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        // Leaderboard rows show equipped titles: a cached page is stale now (same signal as a GV credit).
        self.gv_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(EquipOutcome::Ok)
    }
}

/// Names remain available to legacy/admin callers; authenticated HTTP requests keep the durable identity.
enum ProfileLookup<'a> {
    Name(&'a str),
    Id(i64),
}

impl ProfileLookup<'_> {
    fn predicate(&self) -> &'static str {
        match self {
            Self::Name(_) => "lower(callsign) = lower($1)",
            Self::Id(_) => "profile_id = $1",
        }
    }
}

/// Locks the selected profile row and checks its token; a rename never changes an ID-based principal.
async fn locked_authorized(
    conn: &mut PgConnection,
    profile: ProfileLookup<'_>,
    token: &str,
) -> Result<Option<i64>> {
    let sql = format!(
        "SELECT profile_id, token_sha256 FROM profiles WHERE {} FOR UPDATE",
        profile.predicate()
    );
    let query = sqlx::query_as::<_, (i64, Vec<u8>)>(&sql);
    let row = match profile {
        ProfileLookup::Name(name) => query.bind(name).fetch_optional(conn).await?,
        ProfileLookup::Id(id) => query.bind(id).fetch_optional(conn).await?,
    };
    Ok(row
        .filter(|(_, h)| ct_eq(h, &hash_token(token)))
        .map(|(c, _)| c))
}

/// Counts and GV from the sim are whole and non-negative; anything else counts as 0 (legacy `wholeAmount`).
fn whole(n: i64) -> i64 {
    n.clamp(0, MAX_SAFE)
}

/// The legacy `recordRun` counters, line for line.
fn apply_run(stats: &mut Stats, progress: &mut Progress, outcome: Outcome, r: &MatchResult) {
    let kills = whole(r.kills);
    let bounty = whole(r.gv.bounty);
    stats.runs = add_count(stats.runs, 1);
    let slot = match outcome {
        Outcome::Won => &mut stats.wins,
        Outcome::Draw => &mut stats.draws,
        Outcome::Died | Outcome::Mia => &mut stats.deaths,
    };
    *slot = add_count(*slot, 1);
    stats.kills = add_count(stats.kills, kills);
    progress.best_run_kills = progress.best_run_kills.max(kills);
    if bounty > 0 {
        progress.bounty_runs = add_count(progress.bounty_runs, 1);
    }
    if outcome == Outcome::Won && r.win_qualified {
        progress.qualified_wins = add_count(progress.qualified_wins, 1);
        count_win(
            &mut progress.wins_by_faction,
            &GOLD_FACTIONS,
            r.faction.as_deref(),
        );
        count_win(
            &mut progress.wins_by_weapon,
            &GOLD_WEAPONS,
            r.weapon.as_deref(),
        );
    }
}

fn count_win(wins: &mut BTreeMap<String, i64>, known: &[&str], id: Option<&str>) {
    if let Some(id) = id.filter(|id| known.contains(id)) {
        let e = wins.entry(id.to_owned()).or_insert(0);
        *e = add_count(*e, 1);
    }
}

/// Loads a profile (and its monthly totals). `lock` takes the row lock.
pub(crate) async fn load_profile(
    conn: &mut PgConnection,
    callsign: &str,
    lock: bool,
) -> Result<Option<Profile>> {
    load_profile_lookup(conn, ProfileLookup::Name(callsign), lock).await
}

async fn load_profile_lookup(
    conn: &mut PgConnection,
    profile: ProfileLookup<'_>,
    lock: bool,
) -> Result<Option<Profile>> {
    let sql = format!(
        "SELECT profile_id, callsign, token_sha256, gv, gv_lifetime, stats, cosmetics, achievements, progress
         FROM profiles WHERE {}{}",
        profile.predicate(),
        if lock { " FOR UPDATE" } else { "" }
    );
    let query = sqlx::query_as::<_, ProfileRow>(&sql);
    let row = match profile {
        ProfileLookup::Name(name) => query.bind(name).fetch_optional(&mut *conn).await?,
        ProfileLookup::Id(id) => query.bind(id).fetch_optional(&mut *conn).await?,
    };
    let Some(row) = row else {
        return Ok(None);
    };
    let months: Vec<(String, i64)> =
        sqlx::query_as("SELECT month, gv FROM gv_by_month WHERE profile_id = $1")
            .bind(row.0)
            .fetch_all(&mut *conn)
            .await?;
    let token_sha256: [u8; 32] = row
        .2
        .as_slice()
        .try_into()
        .map_err(|_| Error::Invalid("token hash is not 32 bytes".into()))?;
    Ok(Some(Profile {
        callsign: row.1,
        token_sha256,
        gv: row.3,
        gv_lifetime: row.4,
        gv_by_month: months.into_iter().collect(),
        stats: row.5 .0,
        cosmetics: row.6 .0,
        achievements: row.7 .0,
        progress: row.8 .0,
    }))
}

#[cfg(test)]
mod classify_tests {
    use super::*;

    #[test]
    fn permanent_errors_are_split_from_transient_ones() {
        for code in ["22021", "22P05", "23502", "23503", "23514", "42703"] {
            assert!(permanent_sqlstate(code), "{code}");
        }
        // Retry cures these: unique-violation races resolve to AlreadyApplied, the rest are connection/server trouble.
        for code in [
            "23505", "40001", "40P01", "08006", "53300", "57P01", "58030", "XX000",
        ] {
            assert!(!permanent_sqlstate(code), "{code}");
        }
        assert!(Error::Invalid("x".into()).is_permanent());
        assert!(Error::Conflict("x".into()).is_permanent());
        assert!(Error::UnknownProfile("x".into()).is_permanent());
        assert!(!Error::Db(sqlx::Error::PoolTimedOut).is_permanent());
        assert!(!Error::Db(sqlx::Error::PoolClosed).is_permanent());
        assert!(!Error::Db(sqlx::Error::Io(std::io::Error::other("reset"))).is_permanent());
        assert!(Error::Db(sqlx::Error::ColumnNotFound("c".into())).is_permanent());
    }
}
