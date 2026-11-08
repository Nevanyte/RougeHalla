//! P-BOTS-5 remainder: the live learning store against the pinned throwaway PostgreSQL cluster (feature `postgres`, a
//! real PostgreSQL from DATABASE_URL): the record caller's facts go through the in-memory snapshot at once, the writer
//! task persists one batch off-tick, a reload sees the rows, and close flushes. The director/room wiring is covered by the
//! native room tests; this pins the live store's durable half.
#![cfg(feature = "postgres")]

use rh_persist::bot_stats_db::BotStatsDb;
use rh_policy::bots::learning::{RunOutcome, Stats, Tier};
use rh_policy::bots::PersonaId;
use rh_server::bot_learning::{BotRunFacts, LiveLearning, PgBackend};
use rh_sim::FactionId;
use std::sync::Arc;

const KEY: &str = "faction|farmer|fire";

fn facts(outcome: RunOutcome, place: u32) -> BotRunFacts {
    BotRunFacts {
        tier: Tier::Normal,
        persona: PersonaId::Farmer,
        faction: FactionId::Fire,
        outcome,
        place,
        players: 4,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_live_store_records_snapshots_and_reloads_against_postgres() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    // A fresh database for this test (the pgtest cluster is shared by every suite).
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_learn_{}", std::process::id());
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = match url.rfind('/') {
        Some(i) => format!("{}/{db}", &url[..i]),
        None => panic!("DATABASE_URL has no database name"),
    };
    let store = rh_persist::Store::connect(&db_url).await.unwrap();
    store.migrate().await.unwrap();
    let pool = store.pool().clone();

    let live = LiveLearning::start(PgBackend::new(pool.clone()), Arc::new(|| 1_000))
        .await
        .unwrap();
    assert!(live.snapshot().is_empty());
    live.record(facts(RunOutcome::Won, 1));
    // The read path is immediate: the snapshot reflects the run before any write.
    assert!(live.snapshot().enabled());
    assert_eq!(live.snapshot().bias(KEY), 0.);
    live.flush().await;
    let db_rows = BotStatsDb::new(pool.clone());
    let loaded = db_rows.load().await.unwrap();
    assert_eq!(loaded.baseline.len(), 1);
    assert_eq!(loaded.baseline[0].tier, "normal");
    assert_eq!((loaded.baseline[0].n, loaded.baseline[0].s), (1., 1.));
    assert_eq!(loaded.entries.len(), 1);
    assert_eq!(loaded.entries[0].key, KEY);
    assert_eq!((loaded.entries[0].n, loaded.entries[0].s), (1., 0.5));

    // A second run (a write-window neighbour) updates the snapshot at once and persists on the next flush.
    live.record(facts(RunOutcome::Died, 4));
    let mut expected = Stats::default();
    let choices = vec![KEY.to_string()];
    let summary = |outcome: RunOutcome, place: f64| rh_policy::bots::learning::RunSummary {
        tier: Tier::Normal,
        outcome,
        place,
        players: 4.,
        choices: &choices,
    };
    assert!(expected.apply(&summary(RunOutcome::Won, 1.)));
    assert!(expected.apply(&summary(RunOutcome::Died, 4.)));
    let want = expected.snapshot().bias(KEY);
    assert!((live.snapshot().bias(KEY) - want).abs() < 1e-12);
    live.flush().await;
    let loaded = db_rows.load().await.unwrap();
    let entry = &loaded.entries[0];
    let expected_cell = expected.entries().get(KEY).copied().unwrap();
    assert!((entry.n - expected_cell.n()).abs() < 1e-12);
    assert!((entry.s - expected_cell.s()).abs() < 1e-12);
    live.close().await;

    // A second live store on the same database reloads the persisted model (one store per database at a time).
    let reloaded = LiveLearning::start(PgBackend::new(pool.clone()), Arc::new(|| 1_000))
        .await
        .unwrap();
    assert!((reloaded.snapshot().bias(KEY) - want).abs() < 1e-12);
    assert_eq!(reloaded.snapshot().bias("faction|hunter|fire"), 0.);
    reloaded.close().await;

    // One more close is a no-op (the shutdown path may run it twice).
    reloaded.close().await;
    drop(reloaded);
    store.pool().close().await;
    drop(admin);
    pool.close().await;
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}
