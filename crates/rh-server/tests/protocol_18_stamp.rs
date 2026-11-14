//! P-PROTOCOL-18-STAMP-1 oracle (server): a server of this build speaks protocol 18 over a real socket. A protocol-17
//! client (every client built before the stamp, including those before the Frost Wall batch that kept 17) is refused
//! with ProtocolMismatch before admission, and a protocol-18 client is welcomed with a protocol-18 Welcome.
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, SnapshotTracker};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn arena() -> Arena {
    let rows: Vec<String> = (0..8)
        .map(|y| {
            (0..12)
                .map(|x| {
                    if x == 0 || y == 0 || x == 11 || y == 7 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(5), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(6), tile_to_world_center(4)),
        ],
    }
}

/// The production serve path on loopback; returns the ws:// URL.
async fn start() -> String {
    let sim = SimConfig {
        min_players: 2,
        lobby_seconds: 30.0,
        ..Default::default()
    };
    let cfg = DirectorConfig {
        tick: Duration::from_millis(3),
        linger: Duration::from_millis(150),
        reconnect_grace: Duration::from_millis(600),
        ..DirectorConfig::new(sim, arena())
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let app = rh_server::public_router(director);
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    let addr = handle.listening().await.expect("listening");
    lifecycle.ready();
    format!("ws://{addr}/ws")
}

/// Sends a Hello of `protocol` (current content hash) and returns the first server message.
async fn answer_to_hello(url: &str, protocol: u16, profile: &str) -> Option<ServerMsg> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("connect");
    let hello = ClientMsg::Hello {
        protocol,
        content_hash: rh_sim::content::content_hash(),
        build: "test".into(),
        profile: profile.into(),
        ticket: b"t".to_vec(),
        faction: None,
        resume: None,
    };
    ws.send(Message::Binary(hello.encode().into()))
        .await
        .unwrap();
    let mut track = SnapshotTracker::new();
    loop {
        match tokio::time::timeout(Duration::from_secs(3), ws.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => return track.decode(&b).ok(),
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => return None,
            Ok(Some(Ok(_))) => continue,
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_protocol_17_hello_is_refused_with_protocol_mismatch() {
    let url = start().await;
    let got = answer_to_hello(&url, 17, "old17").await;
    let refused = matches!(
        &got,
        Some(ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason })
            if reason.contains("server speaks protocol 18, client 17")
    );
    assert!(
        refused,
        "a protocol-17 Hello gets ProtocolMismatch naming 18 and 17, got {}",
        summary(&got)
    );
}

fn summary(m: &Option<ServerMsg>) -> String {
    match m {
        Some(ServerMsg::Reject { code, reason }) => format!("Reject {code:?} {reason}"),
        Some(ServerMsg::Welcome { protocol, .. }) => format!("Welcome protocol {protocol}"),
        Some(_) => "another message".to_owned(),
        None => "nothing".to_owned(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_protocol_18_hello_is_welcomed_with_protocol_18() {
    let url = start().await;
    let got = answer_to_hello(&url, 18, "new18").await;
    let protocol = match &got {
        Some(ServerMsg::Welcome { protocol, .. }) => Some(*protocol),
        _ => None,
    };
    assert_eq!(
        protocol,
        Some(18),
        "a protocol-18 Hello is welcomed with a protocol-18 Welcome, got {}",
        summary(&got)
    );
}
