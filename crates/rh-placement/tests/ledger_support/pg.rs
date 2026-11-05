//! A throwaway database per test on the server named by `DATABASE_URL`. The suite FAILS when it is unset: a silent pass would
//! hide that PostgreSQL was never exercised. Two independent pools model two service instances.
use super::conformance::Fx;
use rh_placement::ledger::postgres::PgLedger;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Connection, PgConnection};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub struct TestDb {
    name: String,
    admin: PgConnectOptions,
    opts: PgConnectOptions,
}

static N: AtomicU32 = AtomicU32::new(0);

fn database_url() -> String {
    std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        panic!(
            "DATABASE_URL is not set. These tests need a real PostgreSQL: run `eval \"$(tools/pgtest/start.sh)\"`. \
             They are never skipped."
        )
    })
}

impl TestDb {
    pub async fn create() -> TestDb {
        let admin = PgConnectOptions::from_str(&database_url()).expect("DATABASE_URL parses");
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let name = format!(
            "rh_pl_{}_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst),
            nanos % 1_000_000_000
        );
        let mut c = PgConnection::connect_with(&admin).await.expect("connect to DATABASE_URL");
        sqlx::query(&format!("CREATE DATABASE {name}"))
            .execute(&mut c)
            .await
            .expect("create database");
        let opts = admin.clone().database(&name);
        TestDb { name, admin, opts }
    }

    /// A new independent pool (a "different server") on the same database. The first one migrates.
    pub async fn ledger(&self) -> PgLedger {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(self.opts.clone())
            .await
            .expect("connect to test db");
        let l = PgLedger::from_pool(pool, Duration::from_secs(20));
        l.migrate().await.expect("migrate");
        l
    }

    pub async fn drop_db(self) {
        if let Ok(mut c) = PgConnection::connect_with(&self.admin).await {
            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", self.name))
                .execute(&mut c)
                .await;
        }
    }
}

pub struct PgFx {
    pub fx: Fx<PgLedger>,
    pub db: TestDb,
}

impl std::ops::Deref for PgFx {
    type Target = Fx<PgLedger>;
    fn deref(&self) -> &Fx<PgLedger> {
        &self.fx
    }
}

pub async fn setup() -> PgFx {
    let db = TestDb::create().await;
    let a = Arc::new(db.ledger().await);
    let b = Arc::new(db.ledger().await);
    PgFx {
        fx: Fx { a, b },
        db,
    }
}

pub async fn teardown(f: PgFx) {
    f.fx.a.pool().close().await;
    f.fx.b.pool().close().await;
    f.db.drop_db().await;
}
