//! Test-only child service process for the crash/restart harness (`tests/crash_restart.rs`). Built only with the `postgres`
//! and `fault-injection` features. It opens the REAL service constructor over a real PostgreSQL ledger and the parent-hosted
//! remote fake, runs ONE command and prints one JSON line.
//!
//!   placement-crash-child place   <request_id> [scope]            (an identical retry is the same command)
//!   placement-crash-child reap
//!   placement-crash-child release <scope> <request_id> <placement_id>
//!
//! Environment: `DATABASE_URL` (base server) + `RH_CHILD_DB` (database name), `RF_ADDR` (the remote fake),
//! `RH_CHILD_ZONE`, `RH_CHILD_CALLSIGN`, `RH_CHILD_LEASE_MS` (worker and reaper lease), `RH_CHILD_ATTEMPT_MS`,
//! `RH_CHILD_BACKEND_MS`, `RH_CRASH_AT` (a fault point name, see `ledger::faults`; the process aborts there, with no
//! destructor and no flush), `RH_CRASH_SKIP` (matches to let through first), and `RH_PLACEMENT_MUTANT` (read by the library).
//! The database URL is never printed.

#[path = "../../tests/support/remote_fake/mod.rs"]
#[allow(unused_imports)]
mod remote_fake;

use remote_fake::{RemoteDns, RemoteGameLift};
use rh_placement::ledger::faults::{set_hook, Action, Hook};
use rh_placement::ledger::postgres::PgLedger;
use rh_placement::ledger::Scope;
use rh_placement::service::{DurabilityConfig, PlacementService, ServiceConfig};
use rh_placement::{MemberReport, PlacementPolicy, PlacementRequest, RegionConfig};
use serde_json::json;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

struct CrashAt {
    name: String,
    skip: usize,
    seen: AtomicUsize,
}

impl Hook for CrashAt {
    fn point<'a>(&'a self, name: &'a str) -> Pin<Box<dyn Future<Output = Action> + Send + 'a>> {
        if name == self.name && self.seen.fetch_add(1, Ordering::SeqCst) >= self.skip {
            eprintln!("child: crashing at {name}");
            // The strongest in-process kill: no destructors, no flush, no unwinding.
            std::process::abort();
        }
        Box::pin(async { Action::Continue })
    }
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn env_ms(key: &str, default: u64) -> Duration {
    Duration::from_millis(env(key).map_or(default, |v| v.parse().expect("numeric env")))
}

/// The ONE service configuration of the harness; `tests/support` copies of it must stay equal (identity fingerprint).
fn service_config(zone: &str, attempt_ms: u64) -> ServiceConfig {
    ServiceConfig {
        regions: vec![RegionConfig {
            id: "us-west-2".into(),
            label: "west".into(),
            probe_url: String::new(),
        }],
        policy: PlacementPolicy {
            poll_interval_ms: 5,
            attempt_timeout_ms: attempt_ms,
            dns_verify_timeout_ms: 2_000,
            ..PlacementPolicy::default()
        },
        queue_name: "rh-q".into(),
        zone: zone.into(),
        max_players: 8,
    }
}

fn request(id: &str, callsign: &str) -> PlacementRequest {
    PlacementRequest {
        request_id: id.into(),
        party: vec![MemberReport {
            callsign: callsign.into(),
            age_s: 0,
            rtt_ms: BTreeMap::from([("us-west-2".into(), Some(30))]),
        }],
        region_override: None,
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = run(&args).await;
    println!("{out}");
}

async fn run(args: &[String]) -> serde_json::Value {
    if let Some(name) = env("RH_CRASH_AT") {
        set_hook(Some(Arc::new(CrashAt {
            name,
            skip: env("RH_CRASH_SKIP").map_or(0, |v| v.parse().expect("numeric RH_CRASH_SKIP")),
            seen: AtomicUsize::new(0),
        })));
    }
    let base = env("DATABASE_URL").expect("DATABASE_URL");
    let db = env("RH_CHILD_DB").expect("RH_CHILD_DB");
    let opts = PgConnectOptions::from_str(&base)
        .expect("DATABASE_URL parses")
        .database(&db);
    let op_ms = 10_000;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(10))
        .after_connect(move |conn, _| {
            Box::pin(async move {
                sqlx::query(&format!("SET statement_timeout = {op_ms}"))
                    .execute(&mut *conn)
                    .await?;
                Ok(())
            })
        })
        .connect_with(opts)
        .await
        .expect("connect to the ledger database");
    let ledger = PgLedger::from_pool(pool, Duration::from_millis(op_ms));
    ledger.migrate().await.expect("migrate");

    let addr = env("RF_ADDR")
        .expect("RF_ADDR")
        .parse()
        .expect("RF_ADDR parses");
    let lease = env_ms("RH_CHILD_LEASE_MS", 1500);
    let backend = env_ms("RH_CHILD_BACKEND_MS", 20_000);
    let durability = DurabilityConfig {
        worker_lease: lease,
        reaper_lease: lease,
        backend_op_timeout: backend,
        ..DurabilityConfig::default()
    };
    let zone = env("RH_CHILD_ZONE").unwrap_or_else(|| "g.rougehalla.com".into());
    let attempt_ms = env("RH_CHILD_ATTEMPT_MS").map_or(20_000, |v| v.parse().expect("numeric"));
    let svc = PlacementService::with_ledger(
        [7; 32],
        service_config(&zone, attempt_ms),
        RemoteGameLift::new(addr, backend),
        RemoteDns::new(addr, backend),
        ledger,
        durability,
    )
    .await
    .expect("open the ledger epoch");

    let callsign = env("RH_CHILD_CALLSIGN").unwrap_or_else(|| "alice".into());
    match args.first().map(String::as_str) {
        Some("place") => {
            let id = args.get(1).expect("request id");
            let scope = Scope::new(args.get(2).map_or("default", String::as_str)).expect("scope");
            match svc.place_scoped(&scope, &request(id, &callsign)).await {
                Ok(o) => json!({"ok": true, "offer": {
                    "region": o.region, "hostname": o.hostname, "port": o.port, "url": o.url,
                    "placement_id": o.placement_id, "game_session_arn": o.game_session_arn,
                    "attempts_used": o.attempts_used,
                }}),
                Err(e) => json!({"ok": false, "code": e.code(), "error": format!("{e:?}")}),
            }
        }
        Some("reap") => {
            let resolved = svc.reap_abandoned().await;
            let unresolved = svc.unresolved_count().await.ok();
            json!({"ok": true, "resolved": resolved, "unresolved": unresolved})
        }
        Some("release") => {
            let scope = Scope::new(args.get(1).expect("scope")).expect("scope");
            let (id, placement) = (
                args.get(2).expect("request id"),
                args.get(3).expect("placement id"),
            );
            match svc.release_session(&scope, id, placement).await {
                Ok(()) => json!({"ok": true}),
                Err(e) => json!({"ok": false, "error": format!("{e:?}")}),
            }
        }
        _ => json!({"ok": false, "error": "usage: place|reap|release"}),
    }
}
