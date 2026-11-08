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
