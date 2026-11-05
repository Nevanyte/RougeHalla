//! Shared harness of the process-level tests: a throwaway PostgreSQL database, the parent-hosted remote fake (which survives
//! every child), child service processes (`placement-crash-child`) and read-only inspection of both. Nothing here reads the
//! ledger's private state: rows are read through `Ledger::get`, the service's own accessor.
#![allow(dead_code)]

#[path = "remote_fake/mod.rs"]
pub mod remote_fake;

use crate::ledger_support::pg::TestDb;
use remote_fake::{Mutation, Op, RemoteDns, RemoteFake, RemoteGameLift};
use rh_placement::backend::{DnsBackend, Fallback, GameLiftBackend, StartPlacement};
use rh_placement::fake::RegionBehaviour;
use rh_placement::hostname::game_hostname;
use rh_placement::ledger::postgres::PgLedger;
use rh_placement::ledger::{Ledger, Phase, Record};
use rh_placement::service::{DurabilityConfig, PlacementService, ServiceConfig};
use rh_placement::{MemberReport, PlacementPolicy, PlacementRequest, RegionConfig};
use serde_json::Value;
use std::collections::BTreeMap;
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::Duration;

pub const ZONE: &str = "g.rougehalla.com";
pub const FOREIGN_HOST: &str = "foreign-host.g.rougehalla.com";
pub const FOREIGN_ID: &str = "rh-foreign-1";

pub fn fulfil() -> RegionBehaviour {
    RegionBehaviour::Fulfil {
        after_polls: 1,
        ip: "203.0.113.7".into(),
        port: 35010,
    }
}

/// Must equal `service_config(zone, 20_000)` in the child binary: the same identity fingerprint on both sides.
pub fn service_config(zone: &str, attempt_ms: u64) -> ServiceConfig {
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

pub fn request(id: &str, callsign: &str) -> PlacementRequest {
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

pub fn pid(request_id: &str) -> String {
    format!("rh-{request_id}-1")
}
pub fn host_of(request_id: &str, zone: &str) -> String {
    game_hostname("us-west-2", &pid(request_id), zone).unwrap()
}

pub struct H {
    pub fake: RemoteFake,
    pub db: Option<TestDb>,
    /// The parent's own read pool (and the second "worker" of the delayed-effect tests).
    pub ledger: PgLedger,
}

impl H {
    pub async fn new(behaviour: RegionBehaviour) -> H {
        let db = TestDb::create().await;
        let ledger = db.ledger().await;
        H {
            fake: RemoteFake::spawn(&[("us-west-2", behaviour)]).await,
            db: Some(db),
            ledger,
        }
    }

    pub async fn finish(mut self) {
        self.ledger.pool().close().await;
        if let Some(db) = self.db.take() {
            db.drop_db().await;
        }
    }

    pub fn command(&self, args: &[&str], envs: &[(&str, &str)]) -> Command {
        let mut c = Command::new(env!("CARGO_BIN_EXE_placement-crash-child"));
        c.args(args)
            .env(
                "RH_CHILD_DB",
                self.db.as_ref().expect("database").name(),
            )
            .env("RF_ADDR", self.fake.addr().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for (k, v) in envs {
            c.env(k, v);
        }
        c
    }

    pub fn spawn(&self, args: &[&str], envs: &[(&str, &str)]) -> Child {
        self.command(args, envs).spawn().expect("spawn child")
    }

    /// Run a child to completion and parse its one JSON line.
    pub async fn run(&self, args: &[&str], envs: &[(&str, &str)]) -> Value {
        let child = self.spawn(args, envs);
        let out = tokio::time::timeout(
            Duration::from_secs(90),
            tokio::task::spawn_blocking(move || child.wait_with_output()),
        )
        .await
        .expect("child finished in time")
        .unwrap()
        .expect("wait");
        assert!(out.status.success(), "child failed: {:?}", out.status);
        let text = String::from_utf8(out.stdout).unwrap();
        serde_json::from_str(text.lines().last().expect("a JSON line")).expect("JSON output")
    }

    /// Run a child that aborts itself at fault point `at` (after `skip` earlier matches); asserts it really died by signal.
    pub async fn crash(&self, args: &[&str], at: &str, envs: &[(&str, &str)]) -> ExitStatus {
        let mut all = vec![("RH_CRASH_AT", at)];
        all.extend_from_slice(envs);
        let child = self.spawn(args, &all);
        let out = tokio::time::timeout(
            Duration::from_secs(90),
            tokio::task::spawn_blocking(move || child.wait_with_output()),
        )
        .await
        .expect("child died in time")
        .unwrap()
        .expect("wait");
        assert!(
            out.status.signal().is_some() && !out.status.success(),
            "the child was expected to abort at {at}, got {:?} with stdout {:?}",
            out.status,
            String::from_utf8_lossy(&out.stdout)
        );
        out.status
    }

    /// SIGKILL a running child from the parent (it cannot run any code afterwards) and reap it.
    pub fn sigkill(mut child: Child) -> ExitStatus {
        child.kill().expect("kill");
        let st = child.wait().expect("wait");
        assert_eq!(st.signal(), Some(9), "{st:?}");
        st
    }

    pub async fn row(&self, id: &str) -> Record {
        self.ledger
            .get(id)
            .await
            .expect("read ledger")
            .unwrap_or_else(|| panic!("no ledger row for {id}"))
    }

    /// Wait (poll, bounded) until `n` rows are unresolved: `active`/`releasing` with a claim that has expired.
    pub async fn wait_unresolved(&self, n: usize) {
        let until = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            let c = self.ledger.counts().await.expect("counts");
            if c.unresolved >= n {
                return;
            }
            assert!(
                tokio::time::Instant::now() < until,
                "never reached {n} unresolved rows: {c:?}"
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    /// Wait (poll, bounded) until the row is `active`/`releasing` with no live claim: what a reaper pass would take. A crashed
    /// worker's or reaper's claim only runs out with its lease, and nothing orders that but the store's clock.
    pub async fn wait_reapable(&self, id: &str) {
        let until = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            let r = self.row(id).await;
            if matches!(r.phase, Phase::Active | Phase::Releasing) && !r.claim.live {
                return;
            }
            assert!(
                tokio::time::Instant::now() < until,
                "{id} never became reapable: {:?} live={}",
                r.phase,
                r.claim.live
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    pub async fn counts(&self) -> rh_placement::ledger::Counts {
        self.ledger.counts().await.expect("counts")
    }

    /// Seed a placement and a DNS name that belong to nobody this service knows.
    pub async fn seed_foreign(&self) {
        let gl = RemoteGameLift::with_default_timeout(self.fake.addr());
        gl.start_placement(&StartPlacement {
            placement_id: FOREIGN_ID.into(),
            queue_name: "q".into(),
            max_player_sessions: 2,
            players: vec!["mallory".into()],
            game_session_data: r#"{"requestId":"foreign","ownership":"somebody-else"}"#.into(),
            location_order: vec!["us-west-2".into()],
            fallback: Fallback::None,
        })
        .await
        .expect("seed foreign placement");
        RemoteDns::with_default_timeout(self.fake.addr())
            .upsert(FOREIGN_HOST, "198.51.100.9", 60)
            .await
            .expect("seed foreign dns");
    }

    /// Mutations that belong to one request: its placement id, its session ARN, its hostname.
    pub fn mine(&self, request_id: &str, zone: &str) -> Vec<Mutation> {
        let (p, h) = (pid(request_id), host_of(request_id, zone));
        self.fake
            .trace()
            .into_iter()
            .filter(|m| m.key == p || m.key == h || m.key.ends_with(&format!("/{p}")))
            .collect()
    }
    pub fn ops(&self, request_id: &str, zone: &str) -> Vec<Op> {
        self.mine(request_id, zone).iter().map(|m| m.op).collect()
    }

    /// The foreign placement and name were never stopped, terminated or deleted, and still stand.
    pub fn assert_foreign_untouched(&self) {
        for m in self.fake.trace() {
            if m.key.contains("foreign") && !matches!(m.op, Op::Start | Op::DnsUpsert) {
                panic!("a foreign object was mutated: {m:?}");
            }
        }
        assert!(self.fake.dns().contains_key(FOREIGN_HOST), "foreign DNS gone");
        let p = self.fake.placements();
        let f = p.get(FOREIGN_ID).expect("foreign placement kept");
        assert_eq!(f.game_session_data.as_deref(), Some(r#"{"requestId":"foreign","ownership":"somebody-else"}"#));
        assert!(
            self.fake.terminated().iter().all(|a| !a.contains("foreign")),
            "a foreign session was terminated"
        );
    }

    /// No host of this service outlives reconciliation: every session ARN the provider handed out is terminated and every
    /// hostname this service published is deleted (the foreign ones excepted).
    pub fn assert_no_orphans(&self) {
        let terminated = self.fake.terminated();
        for (id, st) in self.fake.placements() {
            if id == FOREIGN_ID {
                continue;
            }
            if let Some(arn) = st.game_session_arn {
                assert!(terminated.contains(&arn), "orphaned session {arn} for {id}");
            }
        }
        for host in self.fake.dns().keys() {
            assert_eq!(host, FOREIGN_HOST, "orphaned hostname {host}");
        }
    }

    /// A service object in THIS process over the shared database (an independent worker: own pool, own claims).
    pub async fn worker(
        &self,
        zone: &str,
        attempt_ms: u64,
        d: DurabilityConfig,
    ) -> PlacementService<RemoteGameLift, RemoteDns, PgLedger> {
        let ledger = self.db.as_ref().expect("database").ledger().await;
        PlacementService::with_ledger(
            [9; 32],
            service_config(zone, attempt_ms),
            RemoteGameLift::new(self.fake.addr(), d.backend_op_timeout),
            RemoteDns::new(self.fake.addr(), d.backend_op_timeout),
            ledger,
            d,
        )
        .await
        .expect("open the ledger epoch")
    }
}
