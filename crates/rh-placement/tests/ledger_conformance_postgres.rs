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
async fn nonempty_old_ledgers_refuse_upgrade_without_changing_any_data() {
    use rh_placement::ledger::postgres::PgLedger;
    use rh_placement::ledger::LedgerError;
    use sqlx::postgres::PgPoolOptions;
    for version in [1_i64, 2] {
        let db = ledger_support::pg::TestDb::create().await;
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(db.options())
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE rh_placement_schema (version bigint PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0001_placement_ledger.sql"))
            .execute(&pool)
            .await
            .unwrap();
        if version == 2 {
            sqlx::raw_sql(include_str!(
                "../migrations/0002_placement_ledger_version.sql"
            ))
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("INSERT INTO rh_placement_schema (version) VALUES ($1)")
            .bind(version)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO rh_placement_epoch (nonce) VALUES ($1)")
            .bind(vec![7u8; 32])
            .execute(&pool)
            .await
            .unwrap();
        for phase in ["active", "offered", "released", "finished", "tombstone"] {
            sqlx::query("INSERT INTO rh_placement_requests (request_id, scope, fingerprint, request_json, config_json, zone, phase, final_phase, fence, claim_kind, state) VALUES ($1, 's', repeat('a',64), '{}', '{}', 'g.example.com', $1, CASE WHEN $1 = 'tombstone' THEN 'finished' END, 4, 'none', '{}')")
                .bind(phase).execute(&pool).await.unwrap();
        }
        let snapshot = || {
            sqlx::query_scalar::<_, String>("SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id)::text FROM rh_placement_requests r").fetch_one(&pool)
        };
        let before = snapshot().await.unwrap();
        let l = PgLedger::from_pool(pool.clone(), std::time::Duration::from_secs(20));
        assert!(matches!(
            l.migrate().await,
            Err(LedgerError::Incompatible(_))
        ));
        assert_eq!(snapshot().await.unwrap(), before);
        let v: i64 = sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(v, version);
        let nonce: Vec<u8> = sqlx::query_scalar("SELECT nonce FROM rh_placement_epoch")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(nonce, vec![7u8; 32]);
        let cols: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.columns WHERE table_name = 'rh_placement_requests' AND column_name = 'version'").fetch_one(&pool).await.unwrap();
        assert_eq!(cols, i64::from(version == 2));
        pool.close().await;
        db.drop_db().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_empty_old_upgrades_preserve_the_epoch() {
    use rh_placement::ledger::postgres::PgLedger;
    use rh_placement::ledger::Ledger;
    use sqlx::postgres::PgPoolOptions;
    for version in [1_i64, 2] {
        let db = ledger_support::pg::TestDb::create().await;
        let pool = PgPoolOptions::new()
            .connect_with(db.options())
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE rh_placement_schema (version bigint PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0001_placement_ledger.sql"))
            .execute(&pool)
            .await
            .unwrap();
        if version == 2 {
            sqlx::raw_sql(include_str!(
                "../migrations/0002_placement_ledger_version.sql"
            ))
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("INSERT INTO rh_placement_schema (version) VALUES ($1)")
            .bind(version)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO rh_placement_epoch (nonce) VALUES ($1)")
            .bind(vec![7u8; 32])
            .execute(&pool)
            .await
            .unwrap();
        let other = PgPoolOptions::new()
            .connect_with(db.options())
            .await
            .unwrap();
        let a = PgLedger::from_pool(pool.clone(), std::time::Duration::from_secs(20));
        let b = PgLedger::from_pool(other.clone(), std::time::Duration::from_secs(20));
        let (one, two) = tokio::join!(a.migrate(), b.migrate());
        one.unwrap();
        two.unwrap();
        assert_eq!(a.open_epoch([8; 32]).await.unwrap(), [7; 32]);
        assert_eq!(b.open_epoch([9; 32]).await.unwrap(), [7; 32]);
        let v: i64 = sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(v, rh_placement::ledger::SCHEMA_VERSION);
        pool.close().await;
        other.close().await;
        db.drop_db().await;
    }
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

/// Execute the v2 writer SQL, copied verbatim (including its fence/version guard) from
/// producer 4843cd51551f71e43228a75dd3c83effe0228bb3 src/ledger/postgres.rs.
/// Unlike a current-code validation test, this bypasses every v3 Rust check.
async fn legacy_v2_write(
    pool: &sqlx::PgPool,
    claim: &rh_placement::ledger::Claim,
    state: &rh_placement::ledger::LedgerState,
    phase: rh_placement::ledger::Phase,
) -> Result<sqlx::postgres::PgQueryResult, sqlx::Error> {
    use rh_placement::ledger::Phase;
    let mut state = serde_json::to_value(state).unwrap();
    // v2 AttemptRec ignored the new field when reading and omitted it when serializing.
    for attempt in state["attempts"].as_array_mut().unwrap() {
        attempt.as_object_mut().unwrap().remove("dns_upsert");
    }
    let from: Vec<String> = vec!["active".into()];
    let clears = matches!(phase, Phase::Offered | Phase::Finished | Phase::Released);
    let finishes = matches!(phase, Phase::Finished | Phase::Released);
    sqlx::query(
        "UPDATE rh_placement_requests SET state = $1::text::jsonb, phase = $2, version = version + 1, \
             claim_kind = CASE WHEN $3 THEN 'none' ELSE claim_kind END, \
             claim_holder = CASE WHEN $3 THEN NULL ELSE claim_holder END, \
             claim_until = CASE WHEN $3 THEN NULL ELSE clock_timestamp() + ($8::bigint * interval '1 millisecond') END, \
             updated_at = clock_timestamp(), \
             finished_at = CASE WHEN $9 THEN clock_timestamp() ELSE finished_at END \
             WHERE request_id = $10 AND fence = $5 AND version = $11 AND claim_holder = $6 AND claim_kind = $7 \
             AND claim_until > clock_timestamp() AND phase = ANY($4)",
    )
    .bind(state.to_string()).bind(phase.as_str()).bind(clears).bind(from)
    .bind(claim.fence).bind(&claim.holder).bind(claim.kind.as_str()).bind(60_000_i64)
    .bind(finishes).bind(&claim.request_id).bind(claim.version)
    .execute(pool).await
}

#[tokio::test]
async fn an_already_open_v2_writer_is_rejected_by_the_database_after_upgrade() {
    use ledger_support::conformance::{attempt, ident, LONG};
    use rh_placement::ledger::postgres::PgLedger;
    use rh_placement::ledger::{Begin, DnsStep, DnsUpsert, Ledger, LedgerState, Phase, Resolution};
    use sqlx::postgres::PgPoolOptions;
    let db = ledger_support::pg::TestDb::create().await;
    let old_pool = PgPoolOptions::new()
        .connect_with(db.options())
        .await
        .unwrap();
    sqlx::raw_sql("CREATE TABLE rh_placement_schema (version bigint PRIMARY KEY)")
        .execute(&old_pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_placement_ledger.sql"))
        .execute(&old_pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../migrations/0002_placement_ledger_version.sql"
    ))
    .execute(&old_pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO rh_placement_schema (version) VALUES (2)")
        .execute(&old_pool)
        .await
        .unwrap();
    // Keep this connection pool alive throughout the upgrade; it never reruns startup version checks.
    let old = PgLedger::from_pool(old_pool.clone(), std::time::Duration::from_secs(20));
    let current = db.ledger().await;
    current.open_epoch([7; 32]).await.unwrap();
    let Begin::Started(claim) = old
        .begin(&ident("legacyv2", "s", "f"), "old", LONG)
        .await
        .unwrap()
    else {
        panic!("begin")
    };
    let mut state = LedgerState {
        attempts: vec![attempt("legacyv2")],
        ..LedgerState::default()
    };
    let legacy = legacy_v2_write(&old_pool, &claim, &state, Phase::Active).await;
    assert!(
        legacy.is_err(),
        "an already-open legacy writer committed a start intent without the DNS obligation field"
    );
    assert_eq!(
        legacy
            .unwrap_err()
            .as_database_error()
            .unwrap()
            .code()
            .as_deref(),
        Some("23514")
    );
    assert!(current
        .get("legacyv2")
        .await
        .unwrap()
        .unwrap()
        .state
        .attempts
        .is_empty());
    // Simulate a legacy reaper taking valid v3 work, deserializing it with v2 and dropping dns_upsert.
    state.attempts[0].dns_upsert = DnsUpsert::InFlight;
    current
        .write(&claim, &state, Phase::Active, LONG)
        .await
        .unwrap();
    current.relinquish(&claim.next()).await.unwrap();
    let (old_claim, before) = old
        .claim_reapable("old-reaper", LONG, 1)
        .await
        .unwrap()
        .pop()
        .unwrap();
    for phase in [Phase::Active, Phase::Finished] {
        let mut erased = before.state.clone();
        erased.attempts[0].dns = DnsStep::DeleteIntent {
            host: "host.g.example.com".into(),
        };
        erased.attempts[0].resolution = Resolution::CleanedUp;
        let result = legacy_v2_write(&old_pool, &old_claim, &erased, phase).await;
        assert_eq!(
            result
                .unwrap_err()
                .as_database_error()
                .unwrap()
                .code()
                .as_deref(),
            Some("23514")
        );
        let after = current.get("legacyv2").await.unwrap().unwrap();
        assert_eq!(
            (after.state, after.phase, after.version),
            (before.state.clone(), before.phase, before.version)
        );
    }
    old_pool.close().await;
    current.pool().close().await;
    db.drop_db().await;
}

#[tokio::test]
async fn upgrade_serializes_with_a_legacy_insert_before_deciding_the_ledger_is_empty() {
    use rh_placement::ledger::postgres::PgLedger;
    use rh_placement::ledger::LedgerError;
    use sqlx::postgres::PgPoolOptions;
    let db = ledger_support::pg::TestDb::create().await;
    let pool = PgPoolOptions::new()
        .connect_with(db.options())
        .await
        .unwrap();
    sqlx::raw_sql("CREATE TABLE rh_placement_schema (version bigint PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_placement_ledger.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../migrations/0002_placement_ledger_version.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO rh_placement_schema (version) VALUES (2)")
        .execute(&pool)
        .await
        .unwrap();
    let mut old_tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO rh_placement_requests (request_id, scope, fingerprint, request_json, config_json, zone, phase, fence, claim_kind, state) VALUES ('racingold', 's', repeat('a',64), '{}', '{}', 'g.example.com', 'active', 1, 'none', '{}')")
        .execute(&mut *old_tx).await.unwrap();
    let new_pool = PgPoolOptions::new()
        .connect_with(db.options())
        .await
        .unwrap();
    let migrator = PgLedger::from_pool(new_pool.clone(), std::time::Duration::from_secs(20));
    // Synchronize on PostgreSQL's actual lock wait, not a guessed sleep duration.
    let (migration, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::join!(migrator.migrate(), async {
            loop {
                let waiting: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'rh_placement_requests'::regclass AND mode = 'AccessExclusiveLock' AND NOT granted)")
                    .fetch_one(&pool).await.unwrap();
                if waiting { break; }
                tokio::task::yield_now().await;
            }
            old_tx.commit().await.unwrap();
        })
    }).await.unwrap();
    assert!(matches!(migration, Err(LedgerError::Incompatible(_))));
    let version: i64 = sqlx::query_scalar("SELECT max(version) FROM rh_placement_schema")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, 2);
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM rh_placement_requests WHERE request_id = 'racingold'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1);
    new_pool.close().await;
    pool.close().await;
    db.drop_db().await;
}
