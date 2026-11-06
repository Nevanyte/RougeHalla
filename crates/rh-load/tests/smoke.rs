//! A tiny scenario against an in-process rh-server (static auth, real sockets, the production serve path): the harness joins
//! a match, plays, reconnects, churns a lobby, probes a drain, and reports. Kept short (about 10 s).

use rh_load::player::{self, Player, Role};
use rh_load::runner::{self, RunOpts};
use rh_load::scenario::Scenario;
use rh_load::server::Running;
use rh_load::server::ServerSpec;
use rh_load::sys::Creds;
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

struct InProc {
    public: SocketAddr,
    control: SocketAddr,
    director: Arc<Director>,
}

async fn start(creds: &Creds, max_rooms: usize) -> InProc {
    let sim = rh_sim::SimConfig {
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 3.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let cfg = DirectorConfig {
        max_rooms,
        ..DirectorConfig::new(sim, rh_sim::arenas::practice_arena())
    };
    let table: HashMap<String, String> = creds
        .entries
        .iter()
        .map(|(c, t)| (c.to_ascii_lowercase(), t.clone()))
        .collect();
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Static(table)),
        lifecycle.clone(),
    );
    let app = rh_server::public_router(director.clone());
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    let public = handle.listening().await.expect("listening");
    let control_router = rh_server::control_router(director.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, control_router).await.unwrap() });
    lifecycle.ready();
    InProc {
        public,
        control,
        director,
    }
}

fn opts(dir: &std::path::Path, label: &str) -> RunOpts {
    RunOpts {
        label: label.into(),
        out_dir: dir.to_path_buf(),
        hardware_label: Some("test".into()),
        emulated: false,
        keep_creds: false,
        command: "test".into(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_tiny_scenario_plays_reconnects_churns_and_reports() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let sc = Scenario {
        matches: 1,
        players_per_match: 4,
        ramp_per_sec: 10.0,
        duration_secs: 6.0,
        think_ms: 100,
        aggression: 0.3,
        reconnect_fraction: 1.0,
        reconnect_every_secs: 2.0,
        reconnect_delay_ms: (50, 200),
        churn_clients: 1,
        churn_dwell_secs: (0.3, 0.6),
        sample_secs: 0.5,
        max_rooms: 8,
        ..Scenario::default()
    };
    let creds = Creds::generate(sc.total_players() + sc.churn_clients + 1);
    let srv = start(&creds, 8).await;
    let mut running = Running {
        public: srv.public,
        control: Some(srv.control),
        pid: None,
        child: None,
        cold_control_ms: None,
        cold_public_ms: Some(1.0),
        log_path: None,
        argv: vec![],
        auth_file: None,
    };
    let dir = std::env::temp_dir().join(format!("rh-load-smoke-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let spec = ServerSpec {
        attach_public: Some(srv.public),
        ..Default::default()
    };
    let r = runner::run_against(&sc, &spec, &opts(&dir, "smoke"), &creds, &mut running)
        .await
        .expect("run");

    assert_eq!(
        r["capacity"]["playersAdmittedAtLeastOnce"], 4,
        "{}",
        r["capacity"]
    );
    assert!(
        r["admission"]["helloToWelcomeMs"]["count"]
            .as_u64()
            .unwrap()
            >= 4
    );
    assert!(
        r["admission"]["welcomeToFirstSnapshotMs"]["count"]
            .as_u64()
            .unwrap()
            >= 4
    );
    assert!(
        r["clientTick"]["snapshotIntervalMs"]["count"]
            .as_u64()
            .unwrap()
            > 100,
        "snapshots measured in the steady window"
    );
    assert_eq!(r["play"]["decodeErrors"], 0);
    let rc = &r["reconnect"];
    assert!(
        rc["attempts"].as_u64().unwrap() >= 2,
        "reconnect scheduled: {rc}"
    );
    assert_eq!(rc["failed"], 0, "resume within grace succeeds: {rc}");
    assert_eq!(rc["ok"], rc["attempts"]);
    assert!(
        r["churn"]["joins"].as_u64().unwrap() >= 1 && r["churn"]["leaves"].as_u64().unwrap() >= 1,
        "{}",
        r["churn"]
    );
    assert!(
        r["server"]["metricsFinal"]["steps"].as_u64().unwrap() > 50,
        "server metrics read from /control/health"
    );
    assert!(r["capacity"]["roomsPeak"].as_f64().unwrap() >= 1.0);
    assert_eq!(r["meta"]["host"]["emulated"], false);
    assert!(r["meta"]["gitRevision"].as_str().unwrap().len() >= 7);
    assert!(r["meta"]["rawOutput"]
        .as_str()
        .unwrap()
        .ends_with("smoke.json"));
    assert!(!r["series"].as_array().unwrap().is_empty());
    assert!(dir.join("smoke.json").exists() && dir.join("smoke.summary.txt").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bad_credentials_and_overload_are_counted_as_refusals_and_a_drain_refuses_new_admissions() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    // Capacity for two rooms, three full matches wanted: the third match's eight players are refused MatchFull (and keep retrying).
    let sc = Scenario {
        matches: 3,
        players_per_match: 8,
        ramp_per_sec: 20.0,
        duration_secs: 3.0,
        think_ms: 100,
        sample_secs: 0.5,
        max_rooms: 2,
        ..Scenario::default()
    };
    let creds = Creds::generate(sc.total_players() + 1);
    let srv = start(&creds, 2).await;
    let mut running = Running {
        public: srv.public,
        control: Some(srv.control),
        pid: None,
        child: None,
        cold_control_ms: None,
        cold_public_ms: None,
        log_path: None,
        argv: vec![],
        auth_file: None,
    };
    let dir = std::env::temp_dir().join(format!("rh-load-smoke2-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let spec = ServerSpec {
        attach_public: Some(srv.public),
        ..Default::default()
    };
    let r = runner::run_against(&sc, &spec, &opts(&dir, "overload"), &creds, &mut running)
        .await
        .expect("run");
    assert_eq!(
        r["capacity"]["playersAdmittedAtLeastOnce"], 16,
        "{}",
        r["capacity"]
    );
    assert_eq!(r["capacity"]["playersNeverAdmitted"], 8);
    assert_eq!(r["capacity"]["roomsPeak"], 2.0);
    let full = r["admission"]["refusalsByReason"]["MatchFull"]
        .as_u64()
        .unwrap_or(0);
    assert!(
        full >= 8,
        "every refused player was counted by reason: {}",
        r["admission"]["refusalsByReason"]
    );
    let _ = std::fs::remove_dir_all(&dir);

    // A wrong ticket is refused BadCredentials; after a drain a fresh admission is refused ServerDraining.
    let creds2 = Creds::generate(3);
    let srv2 = start(&creds2, 4).await;
    let sh = rh_load::shared::Shared::new(
        Scenario::default(),
        rh_load::shared::Target {
            ws_url: format!("ws://{}/ws", srv2.public),
            host_port: srv2.public.to_string(),
            connector: Some(tokio_tungstenite::Connector::Plain),
        },
        rh_sim::content::content_hash(),
    );
    let good = Player {
        idx: 0,
        name: creds2.entries[0].0.clone(),
        ticket: creds2.entries[0].1.clone().into_bytes(),
        role: Role::Probe,
        seed: 1,
    };
    let bad = Player {
        ticket: b"wrong".to_vec(),
        idx: 1,
        ..good.clone()
    };
    assert_eq!(player::probe(&sh, &bad).await, "BadCredentials");
    assert_eq!(player::probe(&sh, &good).await, "welcome");
    srv2.director.drain().await;
    let (code, _) = rh_load::sys::http(
        srv2.control,
        "GET",
        "/control/health",
        std::time::Duration::from_secs(2),
    )
    .await
    .unwrap();
    assert_eq!(code, 503, "draining is not ready");
    // The earlier probe left its room open for the linger; the profile is released shortly. A drained server refuses regardless.
    assert_eq!(player::probe(&sh, &good).await, "ServerDraining");
    let refusals = sh.lists.lock().unwrap().refusals.clone();
    assert_eq!(refusals.get("BadCredentials"), Some(&1));
    assert_eq!(refusals.get("ServerDraining"), Some(&1));
}
