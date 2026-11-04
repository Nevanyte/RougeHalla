#![allow(dead_code)]
//! Shared test rig: every test gets its own throwaway database on the server named by DATABASE_URL.

use std::str::FromStr;
use std::time::Duration;

use rh_persist::{Claim, GvBreakdown, MatchResult, Outcome, RecordOutcome, Store};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Connection, PgConnection};
use uuid::Uuid;

pub struct TestDb {
    pub store: Store,
    pub url: String,
    name: String,
    admin: PgConnectOptions,
}

/// `None` only when RH_SKIP_PG_TESTS=1 and DATABASE_URL is unset. Without either, the test FAILS: a silent pass
/// would hide that the persistence layer was never exercised.
pub async fn setup() -> Option<TestDb> {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1 and no DATABASE_URL");
            return None;
        }
        panic!(
            "DATABASE_URL is not set. These tests need a real PostgreSQL: run `eval \"$(tools/pgtest/start.sh)\"` \
             (or set RH_SKIP_PG_TESTS=1 to skip them explicitly)."
        );
    };
    let admin = PgConnectOptions::from_str(&url).expect("DATABASE_URL parses");
    let name = format!("rh_test_{}", Uuid::new_v4().simple());
    let mut conn = PgConnection::connect_with(&admin)
        .await
        .expect("connect to DATABASE_URL");
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(&mut conn)
        .await
        .expect("create database");
    let opts = admin.clone().database(&name);
    let pool = PgPoolOptions::new()
        .max_connections(24)
        .acquire_timeout(Duration::from_secs(60))
        .connect_with(opts.clone())
        .await
        .expect("connect to test db");
    let store = Store::from_pool(pool);
    store.migrate().await.expect("migrate");
    Some(TestDb {
        store,
        url: opts.to_url_lossy().to_string(),
        name,
        admin,
    })
}

impl TestDb {
    /// A second, independent pool on the same database: a "different server".
    pub async fn other_server(&self) -> Store {
        Store::connect_with(&self.url, 8)
            .await
            .expect("second store")
    }

    pub async fn teardown(self) {
        self.store.pool().close().await;
        if let Ok(mut conn) = PgConnection::connect_with(&self.admin).await {
            let _ = sqlx::query(&format!(
                "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                self.name
            ))
            .execute(&mut conn)
            .await;
        }
    }

    pub async fn profile(&self, name: &str) -> String {
        let token = format!("tok-{}", Uuid::new_v4());
        assert_eq!(
            self.store.create_profile(name, &token).await.unwrap(),
            Claim::Created
        );
        token
    }

    /// Acquire, record, assert applied. Returns the match id.
    pub async fn bank(&self, name: &str, gv: i64) -> Uuid {
        let m = Uuid::new_v4();
        let lease = self
            .store
            .acquire_lease(name, m, "srv-a", Duration::from_secs(60))
            .await
            .unwrap();
        let out = self
            .store
            .record_result(m, name, lease.fence, &run(gv))
            .await
            .unwrap();
        assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
        m
    }

    pub async fn ledger_sum(&self, name: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT coalesce(sum(delta), 0)::bigint FROM gv_ledger WHERE callsign = $1",
        )
        .bind(name)
        .fetch_one(self.store.pool())
        .await
        .unwrap()
    }

    pub async fn count(&self, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(self.store.pool())
            .await
            .unwrap()
    }
}

/// A died run paying `gv`.
pub fn run(gv: i64) -> MatchResult {
    MatchResult {
        outcome: Some(Outcome::Died),
        kills: 1,
        gv: GvBreakdown {
            kills: gv,
            total: gv,
            ..Default::default()
        },
        faction: None,
        weapon: None,
        win_qualified: false,
    }
}
