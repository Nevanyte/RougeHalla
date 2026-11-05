mod common;

use common::setup;
use rh_persist::{known_schema_version, Error, Store};

#[tokio::test]
async fn schema_version_is_reported_and_only_the_compat_floor_refuses() {
    let Some(db) = setup().await else { return };
    assert_eq!(
        db.store.schema_version().await.unwrap(),
        Some(known_schema_version())
    );
    assert_eq!(known_schema_version(), 1);
    // Migrating again is a no-op.
    db.store.migrate().await.unwrap();

    // Another (newer) binary applied an ADDITIVE migration: it leaves `schema_compat.min_binary` alone, so this older
    // binary still connects, migrates and runs (expand/contract: old and new binaries share a database during a rollout).
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (2, 'additive, from the future', true, '\\x00', 1)",
    )
    .execute(db.store.pool())
    .await
    .unwrap();
    let s = Store::connect(&db.url)
        .await
        .expect("a newer additive migration does not block an older binary");
    s.migrate().await.unwrap();
    assert_eq!(s.schema_version().await.unwrap(), Some(2));

    // A migration old binaries cannot survive raises the floor: they refuse to start, with a clear error.
    sqlx::query("UPDATE schema_compat SET min_binary = 2")
        .execute(db.store.pool())
        .await
        .unwrap();
    match Store::connect(&db.url).await {
        Err(
            e @ Error::SchemaTooNew {
                required: 2,
                binary: 1,
            },
        ) => {
            assert!(e.to_string().contains("min_binary"), "{e}");
        }
        other => panic!("expected SchemaTooNew, got {:?}", other.map(|_| "a store")),
    }
    assert!(matches!(
        db.store.migrate().await,
        Err(Error::SchemaTooNew { .. })
    ));
    db.teardown().await;
}

#[tokio::test]
async fn schema_compat_is_exactly_one_row() {
    let Some(db) = setup().await else { return };
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM schema_compat")
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert_eq!(n, 1);
    assert!(
        sqlx::query("INSERT INTO schema_compat (min_binary) VALUES (1)")
            .execute(db.store.pool())
            .await
            .is_err()
    );
    let floor: i32 = sqlx::query_scalar("SELECT min_binary FROM schema_compat")
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert!(i64::from(floor) <= known_schema_version());
    db.teardown().await;
}

#[tokio::test]
async fn an_unmigrated_database_has_no_version() {
    let Some(db) = setup().await else { return };
    sqlx::query("DROP TABLE _sqlx_migrations")
        .execute(db.store.pool())
        .await
        .unwrap();
    assert_eq!(db.store.schema_version().await.unwrap(), None);
    db.teardown().await;
}
