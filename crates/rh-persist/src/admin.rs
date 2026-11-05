//! Operator tooling behind `rh-persist-admin`: legacy import, reconciliation, export. Everything takes a `Store`
//! so tests run it against throwaway databases.

use std::collections::HashMap;

use sqlx::types::Json;

use crate::legacy::{export_value, parse_file};
use crate::{load_profile, Profile, Result, Store};

#[derive(Debug, Default)]
pub struct ImportReport {
    pub file_version: i64,
    pub parsed: usize,
    /// (name, reason) of legacy entries the legacy store would also have dropped.
    pub dropped: Vec<(String, String)>,
    pub inserted: usize,
    pub identical: usize,
    /// (name, reason): a different profile already holds the name (any case), or the file repeats a name in another case.
    pub conflicts: Vec<(String, String)>,
    pub inserted_gv: i64,
    pub dry_run: bool,
}

/// Imports a legacy profiles file in ONE transaction. Re-running it skips identical profiles and reports different
/// ones as conflicts (it never overwrites). `dry_run` does everything and rolls back.
pub async fn import_legacy(store: &Store, text: &str, dry_run: bool) -> Result<ImportReport> {
    let parsed = parse_file(text)?;
    let mut report = ImportReport {
        file_version: parsed.version,
        parsed: parsed.profiles.len(),
        dropped: parsed.dropped,
        dry_run,
        ..Default::default()
    };
    let mut tx = store.pool().begin().await?;
    let mut seen: HashMap<String, String> = HashMap::new();
    for lp in &parsed.profiles {
        let p = &lp.profile;
        if let Some(first) = seen.insert(p.callsign.to_lowercase(), p.callsign.clone()) {
            report.conflicts.push((
                p.callsign.clone(),
                format!("same name as {first:?} in another case"),
            ));
            continue;
        }
        if let Some(existing) = load_profile(&mut tx, &p.callsign, false).await? {
            if existing == *p {
                report.identical += 1;
            } else {
                report.conflicts.push((
                    p.callsign.clone(),
                    format!(
                        "already in the database as {:?} with different content",
                        existing.callsign
                    ),
                ));
            }
            continue;
        }
        insert_profile(&mut tx, p).await?;
        report.inserted += 1;
        report.inserted_gv += p.gv;
    }
    if dry_run {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(report)
}

async fn insert_profile(conn: &mut sqlx::PgConnection, p: &Profile) -> Result<()> {
    let profile_id: i64 = sqlx::query_scalar(
        "INSERT INTO profiles (callsign, token_sha256, gv, gv_lifetime, stats, cosmetics, achievements, progress)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING profile_id",
    )
    .bind(&p.callsign)
    .bind(&p.token_sha256[..])
    .bind(p.gv)
    .bind(p.gv_lifetime)
    .bind(Json(&p.stats))
    .bind(Json(&p.cosmetics))
    .bind(Json(&p.achievements))
    .bind(Json(&p.progress))
    .fetch_one(&mut *conn)
    .await?;
    for (month, gv) in &p.gv_by_month {
        sqlx::query("INSERT INTO gv_by_month (profile_id, month, gv) VALUES ($1, $2, $3)")
            .bind(profile_id)
            .bind(month)
            .bind(gv)
            .execute(&mut *conn)
            .await?;
    }
    // The opening balance: from here on sum(ledger) == gv for the profile.
    sqlx::query("INSERT INTO gv_ledger (profile_id, delta, reason, ref) VALUES ($1, $2, 'legacy_import', 'opening')")
        .bind(profile_id)
        .bind(p.gv)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct ReconcileReport {
    pub profiles: i64,
    pub total_gv: i64,
    pub total_ledger: i64,
    pub ledger_rows: i64,
    pub match_results: i64,
    pub live_leases: i64,
    /// (callsign, gv, sum of ledger deltas)
    pub mismatches: Vec<(String, i64, i64)>,
    /// Informational: profiles whose monthly totals do not add up to their lifetime GV (old files can).
    pub month_lifetime_gaps: i64,
}

impl ReconcileReport {
    pub fn ok(&self) -> bool {
        self.mismatches.is_empty()
    }
}

pub async fn reconcile(store: &Store) -> Result<ReconcileReport> {
    let pool = store.pool();
    let mut r = ReconcileReport::default();
    let (profiles, total_gv): (i64, i64) =
        sqlx::query_as("SELECT count(*), coalesce(sum(gv), 0)::bigint FROM profiles")
            .fetch_one(pool)
            .await?;
    let (ledger_rows, total_ledger): (i64, i64) =
        sqlx::query_as("SELECT count(*), coalesce(sum(delta), 0)::bigint FROM gv_ledger")
            .fetch_one(pool)
            .await?;
    r.profiles = profiles;
    r.total_gv = total_gv;
    r.ledger_rows = ledger_rows;
    r.total_ledger = total_ledger;
    r.match_results = sqlx::query_scalar("SELECT count(*) FROM match_results")
        .fetch_one(pool)
        .await?;
    r.live_leases = sqlx::query_scalar(
        "SELECT count(*) FROM session_leases WHERE released_at IS NULL AND expires_at > now()",
    )
    .fetch_one(pool)
    .await?;
    r.mismatches = sqlx::query_as(
        "SELECT p.callsign, p.gv, coalesce(l.s, 0)::bigint FROM profiles p
         LEFT JOIN (SELECT profile_id, sum(delta) AS s FROM gv_ledger GROUP BY profile_id) l USING (profile_id)
         WHERE p.gv <> coalesce(l.s, 0) ORDER BY p.callsign",
    )
    .fetch_all(pool)
    .await?;
    r.month_lifetime_gaps = sqlx::query_scalar(
        "SELECT count(*) FROM profiles p WHERE p.gv_lifetime <> coalesce((SELECT sum(gv) FROM gv_by_month m WHERE m.profile_id = p.profile_id), 0)",
    )
    .fetch_one(pool)
    .await?;
    Ok(r)
}

/// The legacy v2 JSON of every profile (see `legacy::export_value` for the token caveat).
pub async fn export_legacy(store: &Store) -> Result<serde_json::Value> {
    let mut tx = store.pool().begin().await?;
    // One snapshot for the whole export.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let names: Vec<String> = sqlx::query_scalar("SELECT callsign FROM profiles ORDER BY callsign")
        .fetch_all(&mut *tx)
        .await?;
    let mut out = Vec::with_capacity(names.len());
    for n in &names {
        if let Some(p) = load_profile(&mut tx, n, false).await? {
            out.push(p);
        }
    }
    tx.commit().await?;
    Ok(export_value(&out))
}
