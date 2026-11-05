//! Read paths of the profile/account HTTP service (leaderboard rows, own rank, months, readiness probe).
//! Ordering is `gv DESC, callsign` by byte order (`COLLATE "C"`), the legacy `byGvThenName` comparison, and the listing
//! and the rank use the same ordering so a row's position and its rank agree.

use crate::cosmetics::equipped_title;
use crate::{valid_month, Cosmetics, Result, Store};
use sqlx::types::Json;
use sqlx::Row;
use std::sync::atomic::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeaderRow {
    pub name: String,
    pub gv: i64,
    /// Id of the equipped title cosmetic when the profile owns it.
    pub title: Option<String>,
}

impl Store {
    /// Generation counter of GV credits made through this store (and its clones). Read it BEFORE a query and store it
    /// with the result: a cache entry is current only while the counter still equals the stored value.
    pub fn gv_epoch(&self) -> u64 {
        self.gv_epoch.load(Ordering::SeqCst)
    }

    /// Top `limit` (1..=1000) profiles by GV banked in `month`, with equipped titles. Empty for a malformed month.
    pub async fn leaderboard_rows(&self, month: &str, limit: i64) -> Result<Vec<LeaderRow>> {
        if !valid_month(month) {
            return Ok(vec![]);
        }
        let rows = sqlx::query(
            "SELECT p.callsign, m.gv, p.cosmetics FROM gv_by_month m JOIN profiles p USING (profile_id)
             WHERE m.month = $1 AND m.gv > 0
             ORDER BY m.gv DESC, p.callsign COLLATE \"C\" LIMIT $2",
        )
        .bind(month)
        .bind(limit.clamp(1, 1000))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let cosmetics: Json<Cosmetics> = r.get(2);
                LeaderRow {
                    name: r.get(0),
                    gv: r.get(1),
                    title: equipped_title(&cosmetics).map(str::to_owned),
                }
            })
            .collect())
    }

    /// 1-based place and GV of `profile_id` in `month`; `None` when it banked nothing that month.
    pub async fn leaderboard_rank(
        &self,
        month: &str,
        profile_id: i64,
    ) -> Result<Option<(i64, i64)>> {
        if !valid_month(month) {
            return Ok(None);
        }
        Ok(sqlx::query_as(
            "SELECT rn, gv FROM (
               SELECT m.profile_id, m.gv,
                      row_number() OVER (ORDER BY m.gv DESC, p.callsign COLLATE \"C\") AS rn
               FROM gv_by_month m JOIN profiles p USING (profile_id)
               WHERE m.month = $1 AND m.gv > 0) ranked
             WHERE profile_id = $2",
        )
        .bind(month)
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Months in which anyone banked GV, newest first.
    pub async fn leaderboard_months(&self, limit: i64) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT month FROM gv_by_month WHERE gv > 0 GROUP BY month ORDER BY month DESC LIMIT $1",
        )
        .bind(limit.clamp(0, 1000))
        .fetch_all(&self.pool)
        .await?)
    }

    /// A trivial round trip, for readiness. The caller bounds it with a timeout.
    pub async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }
}

impl crate::Error {
    /// True when the failure is the database being unreachable or shutting down (pool timeout/closed, I/O, connection
    /// class 08 or admin shutdown 57P0x): a client may retry. Anything else is a bug or a rejected input.
    pub fn is_unavailable(&self) -> bool {
        use sqlx::Error as E;
        match self {
            crate::Error::Db(
                E::PoolTimedOut | E::PoolClosed | E::Io(_) | E::Tls(_) | E::WorkerCrashed,
            ) => true,
            crate::Error::Db(E::Database(d)) => d
                .code()
                .is_some_and(|c| c.starts_with("08") || c.starts_with("57P0")),
            _ => false,
        }
    }
}
