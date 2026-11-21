//! P-PROTOCOL-18-STAMP-1 oracle (server): a server of this build speaks protocol 18 over a real socket. A protocol-17
//! client (every client built before the stamp, including those before the Frost Wall batch that kept 17) is refused
//! with ProtocolMismatch before admission, and a protocol-18 client is welcomed with a protocol-18 Welcome.
//! P-NET-DRAWAHEAD-1a moved the server to protocol 19 (the walk hint): a protocol-18 client is now the refused one and a
//! protocol-19 client is welcomed with a protocol-19 Welcome.
//! P-COLISEUM-HEALS-2 moved the server to protocol 20 (the heal prop): a protocol-19 client is now the refused one and a
//! protocol-20 client is welcomed with a protocol-20 Welcome (origin's numbering; P-TICK-3 then took 21).
//! P-SYNC-ORIGIN-2 merged both lines as protocol 22: every client of 17 to 21 is refused, and a client of this build's
//! protocol is welcomed with a Welcome of it.
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, SnapshotTracker, PROTOCOL_VERSION};
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

// P-WIRE19-A refused 17 and P-NET-DRAWAHEAD-1a refused 18 at protocol 19; P-SYNC-ORIGIN-1 (protocol 20) keeps both
// and refuses 19 as well (the two different protocol-19 wires).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_protocol_17_hello_is_refused_with_protocol_mismatch() {
    let url = start().await;
    let got = answer_to_hello(&url, 17, "old17").await;
    let want = format!("server speaks protocol {PROTOCOL_VERSION}, client 17");
    let refused = matches!(
        &got,
        Some(ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason })
            if reason.contains(&want)
    );
    assert!(
        refused,
        "a protocol-17 Hello gets ProtocolMismatch naming this build's protocol and 17, got {}",
        summary(&got)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_protocol_18_hello_is_refused_with_protocol_mismatch() {
    let url = start().await;
    let got = answer_to_hello(&url, 18, "old18").await;
    let want = format!("server speaks protocol {PROTOCOL_VERSION}, client 18");
    let refused = matches!(
        &got,
        Some(ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason })
            if reason.contains(&want)
    );
    assert!(
        refused,
        "a protocol-18 Hello gets ProtocolMismatch naming this build's protocol and 18, got {}",
        summary(&got)
    );
}

/// P-SYNC-ORIGIN-2: protocol 20 (the local P-SYNC-ORIGIN-1 wire, and origin's heal props) and 21 (origin's tick rate)
/// are both refused by a protocol-22 server.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn protocol_20_and_21_hellos_are_refused_with_protocol_mismatch() {
    let url = start().await;
    for old in [20u16, 21] {
        let got = answer_to_hello(&url, old, &format!("old{old}")).await;
        let want = format!("server speaks protocol {PROTOCOL_VERSION}, client {old}");
        let refused = matches!(
            &got,
            Some(ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason })
                if reason.contains(&want)
        );
        assert!(
            refused,
            "a protocol-{old} Hello gets ProtocolMismatch naming this build's protocol and {old}, got {}",
            summary(&got)
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_protocol_19_hello_is_refused_with_protocol_mismatch() {
    let url = start().await;
    let got = answer_to_hello(&url, 19, "old19").await;
    let want = format!("server speaks protocol {PROTOCOL_VERSION}, client 19");
    let refused = matches!(
        &got,
        Some(ServerMsg::Reject { code: RejectCode::ProtocolMismatch, reason })
            if reason.contains(&want)
    );
    assert!(
        refused,
        "a protocol-19 Hello gets ProtocolMismatch naming this build's protocol and 19, got {}",
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
async fn a_current_hello_is_welcomed_with_the_current_protocol() {
    let url = start().await;
    let got = answer_to_hello(&url, PROTOCOL_VERSION, "new18").await;
    let protocol = match &got {
        Some(ServerMsg::Welcome { protocol, .. }) => Some(*protocol),
        _ => None,
    };
    assert_eq!(
        protocol,
        Some(PROTOCOL_VERSION),
        "a Hello of this build's protocol is welcomed with a Welcome of it, got {}",
        summary(&got)
    );
}
