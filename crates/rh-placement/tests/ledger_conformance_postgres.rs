//! The SAME conformance suite against PostgreSQL (two independent pools per test, a throwaway database each), plus
//! PostgreSQL-specific checks. Every test panics when `DATABASE_URL` is missing.
#![cfg(feature = "postgres")]
mod ledger_support;

use ledger_support::pg::{setup, teardown};

mod postgres {
    use super::{setup, teardown};
    crate::conformance_cases!(
        tokio::test(flavor = "multi_thread", worker_threads = 4),
        setup,
        teardown
    );
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn postgres_upgrades_a_version_1_database_in_place() {
    use rh_placement::ledger::postgres::PgLedger;
    use rh_placement::ledger::{Ledger, Phase};
    use sqlx::postgres::PgPoolOptions;
    let db = ledger_support::pg::TestDb::create().await;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(db.options())
        .await
        .unwrap();
    // Exactly what a version 1 binary left behind: the original schema, its version row and an unfinished request.
    sqlx::raw_sql("CREATE TABLE rh_placement_schema (version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_placement_ledger.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO rh_placement_schema (version) VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO rh_placement_epoch (nonce) VALUES ($1)")
        .bind(vec![7u8; 32])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO rh_placement_requests (request_id, scope, fingerprint, request_json, config_json, zone, phase, fence, \
         claim_kind, state) VALUES ('old00001', 's', repeat('a', 64), '{}', '{}', 'g.example.com', 'active', 4, 'none', '{}')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let l = PgLedger::from_pool(pool.clone(), std::time::Duration::from_secs(20));
    l.migrate().await.unwrap();
    l.migrate().await.unwrap(); // idempotent
    let v: i64 = sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(v, rh_placement::ledger::SCHEMA_VERSION);
    assert_eq!(v, 2);
    // The old row survived, with the write counter at 1, and is claimable and writable by the new binary.
    let r = l.get("old00001").await.unwrap().unwrap();
    assert_eq!((r.fence, r.version, r.phase), (4, 1, Phase::Active));
    let got = l
        .claim_reapable("reaper", std::time::Duration::from_secs(60), 4)
        .await
        .unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!((got[0].0.fence, got[0].0.version), (5, 2));
    assert_eq!(
        l.write(
            &got[0].0,
            &rh_placement::ledger::LedgerState::default(),
            Phase::Finished,
            std::time::Duration::from_secs(60)
        )
        .await
        .unwrap(),
        rh_placement::ledger::WriteOutcome::Written
    );
    pool.close().await;
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn postgres_server_gives_up_before_the_client_and_the_service_waits_for_both() {
    use rh_placement::fake::{FakeDns, FakeGameLift};
    use rh_placement::ledger::postgres::{PgLedger, PgLedgerConfig};
    use rh_placement::service::{DurabilityConfig, PlacementService};
    let db = ledger_support::pg::TestDb::create().await;
    let l = PgLedger::connect_with(
        db.options(),
        PgLedgerConfig {
            op_timeout: std::time::Duration::from_secs(10),
            ..PgLedgerConfig::default()
        },
    )
    .await
    .unwrap();
    let shown: String = sqlx::query_scalar("SHOW statement_timeout")
        .fetch_one(l.pool())
        .await
        .unwrap();
    assert_eq!(shown, "8s", "four fifths of the client budget");
    // A service timeout shorter than the store's budget is raised to it: the service never stops waiting on a statement the
    // server may still run.
    let cfg = rh_placement::service::ServiceConfig {
        regions: vec![],
        policy: rh_placement::PlacementPolicy::default(),
        queue_name: "q".into(),
        zone: "g.example.com".into(),
        max_players: 8,
    };
    let svc = PlacementService::with_ledger(
        [9; 32],
        cfg,
        FakeGameLift::new(&[]),
        FakeDns::new(),
        l,
        DurabilityConfig {
            db_op_timeout: std::time::Duration::from_secs(1),
            ..DurabilityConfig::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        svc.durability.db_op_timeout,
        std::time::Duration::from_secs(10)
    );
    svc.ledger().pool().close().await;
    db.drop_db().await;
}
