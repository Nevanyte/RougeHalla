//! Heap cost of idle-but-joined connections, for a DHAT A/B. The parent process runs the real server stack in-process
//! (`rh_server::serve`, the director and rooms) and spawns itself as the client process, so client buffers never count in
//! the server's heap. Run it under DHAT and read "At t-gmax" (the global heap peak):
//!
//!   cargo build --release -p rh-server --example connheap
//!   valgrind --tool=dhat target/release/examples/connheap --conns 64 --secs 4 [--map parity/maps/seed1.map.json]
//!
//! Every client joins (Hello, Welcome), then idles: it reads and discards what the server sends and pings once a second.
//! The parent prints `connheap: server rooms=<n>` after the client process ends.
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let conns: usize = arg(&args, "--conns")
        .and_then(|v| v.parse().ok())
        .unwrap_or(64);
    let secs: u64 = arg(&args, "--secs")
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    if let Some(url) = arg(&args, "--client") {
        rt.block_on(clients(url, conns, secs));
        return;
    }
    rt.block_on(server(&args, conns, secs));
}

async fn server(args: &[String], conns: usize, secs: u64) {
    let arena = match arg(args, "--map") {
        Some(p) => rh_headless::load_arena(&p).unwrap_or_else(|e| panic!("{e}")),
        None => rh_sim::arenas::practice_arena(),
    };
    let sim = rh_sim::SimConfig {
        walk_hints: None,
        regen: false,
        quests: false,
        training: false,
        dummies: false,
        consumables: true,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 5.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let cfg = DirectorConfig {
        max_rooms: 64,
        ..DirectorConfig::new(sim, arena)
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let handle = axum_server::Handle::new();
    let (h, app) = (handle.clone(), rh_server::public_router(director.clone()));
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .expect("server")
    });
    let addr = handle.listening().await.expect("listening");
    lifecycle.ready();
    let me = std::env::current_exe().expect("current exe");
    let mut child = std::process::Command::new(me)
        .args([
            "--client".to_string(),
            format!("ws://{addr}/ws"),
            "--conns".to_string(),
            conns.to_string(),
            "--secs".to_string(),
            secs.to_string(),
        ])
        .spawn()
        .expect("spawn the client process");
    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .unwrap()
        .expect("client process");
    assert!(status.success(), "client process failed: {status}");
    eprintln!("connheap: server rooms={}", director.room_count());
    handle.shutdown();
}

async fn clients(url: String, conns: usize, secs: u64) {
    let mut tasks = Vec::new();
    let joined = Arc::new(tokio::sync::Barrier::new(conns + 1));
    for i in 0..conns {
        let (url, joined) = (url.clone(), joined.clone());
        tasks.push(tokio::spawn(async move {
            // Small client buffers: this process is not what is measured, only keeps its own footprint low.
            let cfg = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                .read_buffer_size(8 * 1024)
                .write_buffer_size(0);
            let (mut ws, _) = tokio_tungstenite::connect_async_with_config(url, Some(cfg), true)
                .await
                .expect("connect");
            let hello = ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: rh_sim::content::content_hash(),
                build: "connheap".into(),
                profile: format!("p{i}"),
                ticket: b"t".to_vec(),
                faction: None,
                resume: None,
            };
            ws.send(Message::Binary(hello.encode().into()))
                .await
                .unwrap();
            loop {
                let Some(Ok(Message::Binary(b))) = ws.next().await else {
                    panic!("socket closed before Welcome")
                };
                match ServerMsg::decode(&b).expect("decode") {
                    ServerMsg::Welcome { .. } => break,
                    ServerMsg::Reject { code, reason } => panic!("rejected: {code:?} {reason}"),
                    _ => {}
                }
            }
            joined.wait().await;
            let end = tokio::time::Instant::now() + Duration::from_secs(secs);
            let mut ping = tokio::time::interval(Duration::from_secs(1));
            while tokio::time::Instant::now() < end {
                tokio::select! {
                    _ = ping.tick() => {
                        let p = ClientMsg::Ping { nonce: 1, client_ms: 0.0 };
                        if ws.send(Message::Binary(p.encode().into())).await.is_err() { break; }
                    }
                    m = ws.next() => match m {
                        Some(Ok(_)) => {}
                        _ => break,
                    },
                    _ = tokio::time::sleep_until(end) => break,
                }
            }
            let _ = ws
                .send(Message::Binary(ClientMsg::Leave.encode().into()))
                .await;
        }));
    }
    joined.wait().await;
    println!("connheap: {conns} connections joined");
    for t in tasks {
        t.await.expect("client task");
    }
}
