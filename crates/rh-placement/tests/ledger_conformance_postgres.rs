//! The SAME conformance suite against PostgreSQL (two independent pools per test, a throwaway database each), plus
//! PostgreSQL-specific checks. Every test panics when `DATABASE_URL` is missing.
#![cfg(feature = "postgres")]
mod ledger_support;

use ledger_support::pg::{setup, teardown};

mod postgres {
    use super::{setup, teardown};
    crate::conformance_cases!(tokio::test(flavor = "multi_thread", worker_threads = 4), setup, teardown);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn postgres_schema_version_is_recorded_and_a_newer_database_is_refused() {
    let f = setup().await;
    let v: i64 = sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
        .fetch_one(f.fx.a.pool())
        .await
        .unwrap();
    assert_eq!(v, rh_placement::ledger::SCHEMA_VERSION);
    // Migrating again is a no-op; a version this binary does not know is refused, not downgraded.
    f.fx.a.migrate().await.unwrap();
    sqlx::query("INSERT INTO rh_placement_schema (version) VALUES (99)")
        .execute(f.fx.a.pool())
        .await
        .unwrap();
    let e = f.fx.b.migrate().await.unwrap_err();
    assert!(e.to_string().contains("newer"), "{e}");
    // It does not touch sqlx's own migration table (rh-persist's): that table was never created here.
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = '_sqlx_migrations'",
    )
    .fetch_one(f.fx.a.pool())
    .await
    .unwrap();
    assert_eq!(n, 0);
    teardown(f).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn postgres_errors_never_carry_the_database_url() {
    use rh_placement::ledger::postgres::{PgLedger, PgLedgerConfig};
    let url = "postgres://secretuser:secretpass@127.0.0.1:1/secretdb";
    let e = PgLedger::connect(
        url,
        PgLedgerConfig {
            acquire_timeout: std::time::Duration::from_millis(500),
            ..PgLedgerConfig::default()
        },
    )
    .await
    .err()
    .expect("nothing listens there");
    let text = format!("{e} {e:?}");
    for secret in ["secretuser", "secretpass", "secretdb", "127.0.0.1"] {
        assert!(!text.contains(secret), "{text}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn postgres_rejects_a_malformed_row_instead_of_guessing() {
    use rh_placement::ledger::Ledger;
    let f = setup().await;
    // The table's own constraints refuse an offer-less tombstone or a bad phase: the store cannot be walked into them.
    let r = sqlx::query(
        "INSERT INTO rh_placement_requests (request_id, scope, fingerprint, phase, fence) VALUES ('bad00001','s',repeat('0',64),'nonsense',1)",
    )
    .execute(f.fx.a.pool())
    .await;
    assert!(r.is_err());
    assert_eq!(f.fx.a.counts().await.unwrap().total, 0);
    teardown(f).await;
}
