//! Real-PG read-contract fixtures. Declared results/corruption are fixtures, not a new match-producer proof.
mod common;
use common::{run, setup, TestDb};
use rh_persist::{CommittedSettlement, MatchMeta, MatchResult, Outcome, RecordOutcome, MAX_SAFE};
use sqlx::types::Json;
use std::time::Duration;
use uuid::Uuid;

async fn bank(db: &TestDb, name: &str, result: &MatchResult) -> (i64, Uuid, i64) {
    let id = db.store.profile_id(name).await.unwrap().unwrap();
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease(name, m, "settlement-fixture", Duration::from_secs(60))
        .await
        .unwrap();
    assert!(matches!(
        db.store
            .record_result_by_id(m, id, lease.fence, result, &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::Applied { .. }
    ));
    (id, m, lease.fence)
}

#[tokio::test]
async fn committed_owner_scope_zero_void_clamp_and_duplicate_are_stable() {
    let Some(db) = setup().await else { return };
    db.profile("alice").await;
    db.profile("bob").await;
    let aid = db.store.profile_id("alice").await.unwrap().unwrap();
    assert_eq!(
        db.store
            .settlement_by_id(aid, Uuid::new_v4())
            .await
            .unwrap(),
        None
    );
    let (_, foreign, _) = bank(&db, "bob", &run(17)).await;
    assert_eq!(db.store.settlement_by_id(aid, foreign).await.unwrap(), None);
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("alice", m, "fixture", Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(
        db.store.settlement_by_id(aid, m).await.unwrap(),
        None,
        "a live lease is not a commit"
    );
    let r = run(100);
    db.store
        .record_result_by_id(m, aid, lease.fence, &r, &MatchMeta::unknown())
        .await
        .unwrap();
    let receipt = Some(CommittedSettlement {
        outcome: r.outcome,
        gv_credited: 100,
    });
    assert_eq!(db.store.settlement_by_id(aid, m).await.unwrap(), receipt);
    assert_eq!(
        db.store
            .record_result_by_id(m, aid, lease.fence, &r, &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    );
    assert_eq!(db.store.settlement_by_id(aid, m).await.unwrap(), receipt);
    for (raw, outcome, credited) in [
        (0, Some(Outcome::Died), 0),
        (-5, Some(Outcome::Won), 0),
        (7, None, 7),
        (MAX_SAFE + 10, None, MAX_SAFE),
    ] {
        let mut r = run(raw);
        r.outcome = outcome;
        let (pid, m, _) = bank(&db, "alice", &r).await;
        assert_eq!(
            db.store.settlement_by_id(pid, m).await.unwrap(),
            Some(CommittedSettlement {
                outcome,
                gv_credited: credited
            })
        );
    }
    db.teardown().await;
}

#[tokio::test]
async fn uncommitted_row_and_rollback_are_unknown_on_another_connection() {
    let Some(db) = setup().await else { return };
    db.profile("alice").await;
    db.profile("bob").await;
    let aid = db.store.profile_id("alice").await.unwrap().unwrap();
    let (_, m, _) = bank(&db, "bob", &run(0)).await;
    let reader = db.other_server().await;
    let mut tx = db.store.pool().begin().await.unwrap();
    // Deliberately uncommitted visibility fixture; it is rolled back, never used as an earned result.
    sqlx::query("INSERT INTO match_results(match_id,profile_id,result,fence) VALUES($1,$2,$3,1)")
        .bind(m)
        .bind(aid)
        .bind(Json(
            serde_json::json!({"v":1,"outcome":null,"gv":{"total":0}}),
        ))
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(reader.settlement_by_id(aid, m).await.unwrap(), None);
    tx.rollback().await.unwrap();
    assert_eq!(reader.settlement_by_id(aid, m).await.unwrap(), None);
    reader.pool().close().await;
    db.teardown().await;
}

#[tokio::test]
async fn result_and_ledger_corruption_fails_closed_without_zero_or_summing() {
    let Some(db) = setup().await else { return };
    db.profile("alice").await;
    for bad in [
        serde_json::json!({"v":2,"outcome":"won","gv":{"total":10}}),
        serde_json::json!({"v":1,"gv":{"total":10}}),
        serde_json::json!({"v":1,"outcome":"won"}),
        serde_json::json!({"v":1,"outcome":"private-corrupt-value","gv":{"total":10}}),
        serde_json::json!({"v":1,"outcome":"won","gv":{"total":"bad"}}),
        serde_json::json!({"v":1,"outcome":"won","gv":{"total":11}}),
        serde_json::json!({"v":1,"outcome":null,"gv":{"total":10}}),
    ] {
        let (pid, m, _) = bank(&db, "alice", &run(10)).await;
        sqlx::query("UPDATE match_results SET result=$1 WHERE profile_id=$2 AND match_id=$3")
            .bind(Json(bad))
            .bind(pid)
            .bind(m)
            .execute(db.store.pool())
            .await
            .unwrap();
        let error = db.store.settlement_by_id(pid, m).await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "invalid input: invalid committed settlement record"
        );
    }
    // A zero-result fixture altered to positive has no ledger: it cannot become a made-up zero receipt.
    let (pid, m, _) = bank(&db, "alice", &run(0)).await;
    sqlx::query("UPDATE match_results SET result=jsonb_set(result,'{gv,total}','10') WHERE profile_id=$1 AND match_id=$2")
        .bind(pid).bind(m).execute(db.store.pool()).await.unwrap();
    assert!(db.store.settlement_by_id(pid, m).await.is_err());
    for (delta, initial) in [(-1, 0), (10, 10)] {
        let (pid, m, _) = bank(&db, "alice", &run(initial)).await;
        if initial == 0 {
            sqlx::query("UPDATE match_results SET result=jsonb_set(result,'{gv,total}','10') WHERE profile_id=$1 AND match_id=$2").bind(pid).bind(m).execute(db.store.pool()).await.unwrap();
        }
        // Insert-only corruption fixture; the append-only ledger trigger is preserved.
        sqlx::query("INSERT INTO gv_ledger(profile_id,delta,reason,ref) VALUES($1,$2,'run',$3)")
            .bind(pid)
            .bind(delta)
            .bind(m.to_string())
            .execute(db.store.pool())
            .await
            .unwrap();
        assert!(
            db.store.settlement_by_id(pid, m).await.is_err(),
            "duplicate qualifying rows never sum or pick one"
        );
    }
    db.teardown().await;
}
