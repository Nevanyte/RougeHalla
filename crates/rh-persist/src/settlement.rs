//! Owner-scoped, committed receipts. No live-room, spool, lease or foreign-match existence lookup.
use crate::{whole, Error, Outcome, Result, Store, StoredResult, RESULT_VERSION};
use serde_json::Value;
use sqlx::types::Json;
use uuid::Uuid;

/// Public settlement facts only. The caller must authenticate and pin the durable principal before this read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommittedSettlement {
    pub outcome: Option<Outcome>,
    pub gv_credited: i64,
}

type SettlementRow = (Json<Value>, i64, Option<i64>, Option<String>);

impl Store {
    /// `None` means no committed result was visible for this exact principal/match pair in this read's snapshot.
    /// It says nothing about pending work, other participants or whether a match exists. Both the immutable result and
    /// its qualifying ledger entry are read in ONE PostgreSQL statement/MVCC snapshot. No current balance is inferred.
    pub async fn settlement_by_id(
        &self,
        profile_id: i64,
        match_id: Uuid,
    ) -> Result<Option<CommittedSettlement>> {
        let row: Option<SettlementRow> = sqlx::query_as(
            "SELECT r.result, l.entries, l.delta, l.reason
             FROM match_results r
             CROSS JOIN LATERAL (
                 SELECT count(*)::bigint AS entries, min(delta) AS delta, min(reason) AS reason
                 FROM gv_ledger
                 WHERE profile_id=r.profile_id AND ref=r.match_id::text
                   AND reason IN ('run','void_run')
             ) l
             WHERE r.profile_id=$1 AND r.match_id=$2",
        )
        .bind(profile_id)
        .bind(match_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((Json(raw), entries, delta, reason)) = row else {
            return Ok(None);
        };
        let invalid = || Error::Invalid("invalid committed settlement record".into());
        // These are the minimum v1 receipt fields. Serde defaults for later-added audit fields remain compatible,
        // but a missing outcome or total must never silently become a zero-credit void receipt.
        if raw.get("v").and_then(Value::as_u64) != Some(u64::from(RESULT_VERSION))
            || raw.get("outcome").is_none()
            || raw
                .get("gv")
                .and_then(|v| v.get("total"))
                .and_then(Value::as_i64)
                .is_none()
        {
            return Err(invalid());
        }
        let stored: StoredResult = serde_json::from_value(raw).map_err(|_| invalid())?;
        let expected = whole(stored.result.gv.total);
        let expected_reason = if stored.result.outcome.is_some() {
            "run"
        } else {
            "void_run"
        };
        let credited = match (entries, delta, reason.as_deref()) {
            (0, None, None) if expected == 0 => 0,
            (1, Some(value), Some(why))
                if expected > 0 && value == expected && why == expected_reason =>
            {
                value
            }
            _ => return Err(invalid()),
        };
        Ok(Some(CommittedSettlement {
            outcome: stored.result.outcome,
            gv_credited: credited,
        }))
    }
}
