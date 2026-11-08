//! P-BOTS-5: the durable rows against the pinned throwaway PostgreSQL cluster: the schema guards, one atomic batch per
//! write (baseline upsert, cell upsert, evicted delete), and the load path.
mod common;

use rh_persist::bot_stats_db::{BaselineRow, Batch, BotStatsDb, EntryRow};

async fn entry_count(pool: &sqlx::PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM bot_learning_entries")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn an_empty_database_loads_nothing_and_an_empty_batch_is_free() {
    let Some(db) = common::setup().await else {
        return;
    };
    let store = BotStatsDb::new(db.store.pool().clone());
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded, rh_persist::bot_stats_db::Loaded::default());
    store.save(&Batch::default()).await.unwrap();
    db.teardown().await;
}

#[tokio::test]
async fn one_batch_upserts_the_baseline_and_cells_and_deletes_evicted_keys() {
    let Some(db) = common::setup().await else {
        return;
    };
    let store = BotStatsDb::new(db.store.pool().clone());
    // A pre-existing evicted key the batch deletes.
    sqlx::query("INSERT INTO bot_learning_entries (key, n, s) VALUES ('opener|1|flank', 1, 0.5)")
        .execute(db.store.pool())
        .await
        .unwrap();
    let batch = Batch {
        baseline: vec![
            BaselineRow {
                tier: "normal".into(),
                n: 1.,
                s: 1.,
            },
            BaselineRow {
                tier: "hard".into(),
                n: 2.5,
                s: 1.25,
            },
        ],
        upserts: vec![
            EntryRow {
                key: "faction|farmer|fire".into(),
                n: 1.,
                s: 0.5,
            },
            EntryRow {
                key: "opener|2|flank".into(),
                n: 3.,
                s: 1.5,
            },
        ],
        deletes: vec!["opener|1|flank".into()],
    };
    store.save(&batch).await.unwrap();
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded.baseline.len(), 2);
    assert_eq!(loaded.entries.len(), 2);
    assert!(!loaded.entries.iter().any(|e| e.key == "opener|1|flank"));
    // A second batch updates the same rows in place.
    store
        .save(&Batch {
            baseline: vec![BaselineRow {
                tier: "normal".into(),
                n: 1.99,
                s: 0.99,
            }],
            upserts: vec![EntryRow {
                key: "faction|farmer|fire".into(),
                n: 1.99,
                s: 0.4,
            }],
            deletes: Vec::new(),
        })
        .await
        .unwrap();
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded.baseline.len(), 2);
    let normal = loaded.baseline.iter().find(|b| b.tier == "normal").unwrap();
    assert!((normal.n - 1.99).abs() < 1e-12);
    assert_eq!(entry_count(db.store.pool()).await, 2);
    db.teardown().await;
}

#[tokio::test]
async fn a_failed_batch_rolls_back_every_row() {
    let Some(db) = common::setup().await else {
        return;
    };
    let store = BotStatsDb::new(db.store.pool().clone());
    sqlx::query(
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('faction|hunter|frost', 1, 0.5)",
    )
    .execute(db.store.pool())
    .await
    .unwrap();
    // Break the table under the batch: the whole transaction fails and nothing it touched changes.
    sqlx::query("ALTER TABLE bot_learning_entries RENAME TO bot_learning_entries_held")
        .execute(db.store.pool())
        .await
        .unwrap();
    let err = store
        .save(&Batch {
            baseline: vec![BaselineRow {
                tier: "easy".into(),
                n: 1.,
                s: 1.,
            }],
            upserts: vec![EntryRow {
                key: "faction|farmer|fire".into(),
                n: 1.,
                s: 0.5,
            }],
            deletes: vec!["faction|hunter|frost".into()],
        })
        .await;
    assert!(err.is_err(), "the missing table fails the batch");
    sqlx::query("ALTER TABLE bot_learning_entries_held RENAME TO bot_learning_entries")
        .execute(db.store.pool())
        .await
        .unwrap();
    let loaded = store.load().await.unwrap();
    assert_eq!(loaded.baseline.len(), 0, "the baseline insert rolled back");
    assert_eq!(loaded.entries.len(), 1, "the delete rolled back");
    assert_eq!(loaded.entries[0].key, "faction|hunter|frost");
    db.teardown().await;
}

#[tokio::test]
async fn the_schema_refuses_damaged_rows_and_keys() {
    let Some(db) = common::setup().await else {
        return;
    };
    for sql in [
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('faction|a|b', 1, 2)",
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('not-a-key', 1, 0.5)",
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('unknown|a|b', 1, 0.5)",
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('faction|a|b', 'NaN', 0)",
        "INSERT INTO bot_learning_entries (key, n, s) VALUES ('faction|a|b', 1, 'Infinity')",
        "INSERT INTO bot_learning_baseline (tier, n, s) VALUES ('impossible', 1, 0)",
        "INSERT INTO bot_learning_baseline (tier, n, s) VALUES ('easy', 1, 2)",
    ] {
        assert!(
            sqlx::query(sql).execute(db.store.pool()).await.is_err(),
            "{sql} must be refused"
        );
    }
    db.teardown().await;
}

#[tokio::test]
async fn a_live_learning_lease_is_database_scoped_and_released_on_drop() {
    use rh_persist::bot_stats_db::LeasedBotStatsDb;
    let Some(db) = common::setup().await else {
        return;
    };
    let other = db.other_server().await;
    let first = LeasedBotStatsDb::acquire(db.store.pool())
        .await
        .unwrap()
        .unwrap();
    assert!(LeasedBotStatsDb::acquire(other.pool())
        .await
        .unwrap()
        .is_none());
    first
        .save(&Batch {
            baseline: vec![BaselineRow {
                tier: "normal".into(),
                n: 1.,
                s: 1.,
            }],
            ..Default::default()
        })
        .await
        .unwrap();
    // A separate profile writer is still usable: learning's lease never locks profile persistence.
    db.profile("first").await;
    assert_eq!(
        other
            .create_profile("second", "second-token")
            .await
            .unwrap(),
        rh_persist::Claim::Created
    );
    first.disable();
    assert!(first.is_disabled());
    let second = LeasedBotStatsDb::acquire(other.pool())
        .await
        .unwrap()
        .expect("released lease");
    assert_eq!(second.load().await.unwrap().baseline[0].n, 1.);
    drop(second);
    other.pool().close().await;
    db.teardown().await;
}

#[tokio::test]
async fn losing_the_owning_session_poison_disables_all_subsequent_writes() {
    use rh_persist::bot_stats_db::LeasedBotStatsDb;
    let Some(db) = common::setup().await else {
        return;
    };
    let first = LeasedBotStatsDb::acquire(db.store.pool())
        .await
        .unwrap()
        .unwrap();
    assert!(first.load().await.unwrap().entries.is_empty());
    let killed:bool=sqlx::query_scalar("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='rh-bot-learning'")
        .fetch_one(db.store.pool()).await.unwrap();
    assert!(killed);
    let batch = Batch {
        baseline: vec![BaselineRow {
            tier: "normal".into(),
            n: 1.,
            s: 1.,
        }],
        ..Default::default()
    };
    assert!(first.save(&batch).await.is_err());
    assert!(first.is_disabled());
    let second = LeasedBotStatsDb::acquire(db.store.pool())
        .await
        .unwrap()
        .expect("new owner after killed session");
    second.save(&batch).await.unwrap();
    let stale = Batch {
        baseline: vec![BaselineRow {
            tier: "normal".into(),
            n: 20.,
            s: 0.,
        }],
        ..Default::default()
    };
    assert!(first.save(&stale).await.is_err());
    assert_eq!(second.load().await.unwrap().baseline[0].n, 1.);
    drop(first);
    drop(second);
    db.teardown().await;
}
