mod common;

use common::setup;
use rh_persist::{known_schema_version, Error, Store};

#[tokio::test]
async fn schema_version_is_reported_and_a_newer_schema_is_refused() {
    let Some(db) = setup().await else { return };
    assert_eq!(
        db.store.schema_version().await.unwrap(),
        Some(known_schema_version())
    );
    assert_eq!(known_schema_version(), 1);
    // Migrating again is a no-op.
    db.store.migrate().await.unwrap();

    // Another (newer) binary migrated this database.
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (999, 'from the future', true, '\\x00', 1)",
    )
    .execute(db.store.pool())
    .await
    .unwrap();
    match Store::connect(&db.url).await {
        Err(Error::SchemaTooNew { db: 999, binary: 1 }) => {}
        other => panic!("expected SchemaTooNew, got {:?}", other.map(|_| "a store")),
    }
    assert!(matches!(
        db.store.migrate().await,
        Err(Error::SchemaTooNew { .. })
    ));
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
