//! The transport layer of the production serve path (`rh_server::serve`): every accepted socket has TCP_NODELAY, plain
//! and TLS alike, and a client still completes Hello/Welcome/snapshots over both. The tests start the server through the
//! same function main.rs runs, with an accept hook on the real acceptor that reads the socket option back.
// `Persistence` has one variant without the `postgres` feature.
#![allow(irrefutable_let_patterns)]

use axum_server::tls_rustls::RustlsConfig;
use axum_server::Handle;
use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_server::NoDelay;
use rh_sim::SimConfig;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

const TEST_TICK: Duration = Duration::from_millis(3);

// The buffer limits must leave room for the largest server frame on top of what tungstenite buffers before a write.
const _: () = assert!(
    rh_server::WS_MAX_WRITE_BUFFER >= rh_server::WS_WRITE_BUFFER + rh_protocol::MAX_SERVER_FRAME
);
// And the read buffer must hold a whole client frame.
const _: () = assert!(rh_server::WS_READ_BUFFER > rh_protocol::MAX_CLIENT_FRAME + 14);

struct Started {
    addr: SocketAddr,
    /// `TcpStream::nodelay()` of every accepted socket, read by the real acceptor after it set the option.
    nodelay: Arc<Mutex<Vec<bool>>>,
    handle: Handle,
    /// DER of the self-signed certificate when serving TLS.
    cert: Option<Vec<u8>>,
}

async fn start(tls: bool) -> Started {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let sim = SimConfig {
        regen: false,
        quests: false,
        abilities: rh_sim::abilities::Mode::Off,
        wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
        lifecycle: rh_sim::ArenaMode::Off,
        hazards: rh_sim::terrain::Mode::Off,
        mob_mode: rh_sim::mob_runtime::MobMode::Off,
        initial_loot: false,
        min_players: 2,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let cfg = DirectorConfig {
        tick: TEST_TICK,
        ..DirectorConfig::new(sim, rh_sim::arenas::practice_arena())
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let (tls_cfg, cert) = if tls {
        let c = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
            .expect("self-signed cert");
        let cfg = RustlsConfig::from_pem(
            c.cert.pem().into_bytes(),
            c.key_pair.serialize_pem().into_bytes(),
        )
        .await
        .expect("tls config");
        (Some(cfg), Some(c.cert.der().to_vec()))
    } else {
        (None, None)
    };
    let nodelay = Arc::new(Mutex::new(Vec::new()));
    let seen = nodelay.clone();
    let acceptor = NoDelay::with_hook(Arc::new(move |s| {
        seen.lock()
            .unwrap()
            .push(s.nodelay().expect("read TCP_NODELAY"));
    }));
    let handle = Handle::new();
    let (h, app) = (handle.clone(), rh_server::public_router(director.clone()));
    tokio::spawn(async move {
        rh_server::serve_with("127.0.0.1:0".parse().unwrap(), tls_cfg, app, h, acceptor)
            .await
            .unwrap()
    });
    let addr = handle.listening().await.expect("listening");
    lifecycle.ready();
    Started {
        addr,
        nodelay,
        handle,
        cert,
    }
}

fn hello() -> ClientMsg {
    ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: "test".into(),
        profile: "tester".into(),
        ticket: b"t".to_vec(),
        faction: None,
        resume: None,
    }
}

/// Hello, then Welcome, then at least `snapshots` snapshots.
async fn complete<S>(ws: &mut tokio_tungstenite::WebSocketStream<S>, snapshots: u32)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    ws.send(Message::Binary(hello().encode().into()))
        .await
        .unwrap();
    let (mut welcomed, mut snaps) = (false, 0);
    let mut track = rh_protocol::SnapshotTracker::new();
    while snaps < snapshots {
        let next = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .expect("a frame within 3 s")
            .expect("socket open")
            .expect("frame");
        let Message::Binary(b) = next else { continue };
        match track.decode(&b).expect("server frames decode and apply") {
            ServerMsg::Welcome { tick_rate, .. } => {
                assert_eq!(tick_rate, 20);
                welcomed = true;
            }
            ServerMsg::Snapshot { .. } => {
                assert!(welcomed, "Welcome precedes the first snapshot");
                snaps += 1;
            }
            ServerMsg::Reject { code, reason } => panic!("rejected: {code:?} {reason}"),
            _ => {}
        }
    }
}

fn all_nodelay(s: &Started) -> (usize, usize) {
    let v = s.nodelay.lock().unwrap();
    (v.len(), v.iter().filter(|b| **b).count())
}

#[tokio::test]
async fn plain_sockets_have_nodelay_and_a_client_completes() {
    let s = start(false).await;
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", s.addr))
        .await
        .expect("connect");
    complete(&mut ws, 5).await;
    let (accepted, with_nodelay) = all_nodelay(&s);
    assert!(accepted >= 1, "the acceptor ran for the connection");
    assert_eq!(
        accepted, with_nodelay,
        "TCP_NODELAY on every accepted socket"
    );
    s.handle.shutdown();
}

#[tokio::test]
async fn tls_sockets_have_nodelay_and_a_client_completes() {
    let s = start(true).await;
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(rustls::pki_types::CertificateDer::from(
            s.cert.clone().expect("cert"),
        ))
        .expect("trust the self-signed cert");
    let client = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let (mut ws, _) = tokio_tungstenite::connect_async_tls_with_config(
        format!("wss://localhost:{}/ws", s.addr.port()),
        None,
        false,
        Some(Connector::Rustls(Arc::new(client))),
    )
    .await
    .expect("wss connect");
    complete(&mut ws, 5).await;
    let (accepted, with_nodelay) = all_nodelay(&s);
    assert!(accepted >= 1, "the acceptor ran for the TLS connection");
    assert_eq!(
        accepted, with_nodelay,
        "TCP_NODELAY set on the TcpStream before the TLS handshake wrapped it"
    );
    s.handle.shutdown();
}

/// Control for the assertions above: a socket accepted by a plain listener does not have the option, so the hook reading
/// `true` is evidence the production acceptor set it.
#[tokio::test]
async fn a_bare_accepted_socket_has_no_nodelay() {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    let client = tokio::net::TcpStream::connect(addr);
    let (accepted, _) = tokio::join!(l.accept(), client);
    let (stream, _) = accepted.unwrap();
    assert!(!stream.nodelay().unwrap());
}

/// Connects, says Hello as `name` and reads to the Welcome.
async fn welcomed(
    s: &Started,
    name: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", s.addr))
        .await
        .expect("connect");
    let h = ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: "test".into(),
        profile: name.into(),
        ticket: b"t".to_vec(),
        faction: None,
        resume: None,
    };
    ws.send(Message::Binary(h.encode().into())).await.unwrap();
    loop {
        let m = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .expect("Welcome in time")
            .expect("open")
            .expect("frame");
        if let Message::Binary(b) = m {
            if matches!(ServerMsg::decode(&b), Ok(ServerMsg::Welcome { .. })) {
                return ws;
            }
        }
    }
}

/// The reason the server ends the connection with: the code of the next `Reject` frame.
async fn reject_code<S>(ws: &mut tokio_tungstenite::WebSocketStream<S>) -> rh_protocol::RejectCode
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let m = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .expect("a Reject in time")
            .expect("open")
            .expect("frame");
        if let Message::Binary(b) = m {
            if let Ok(ServerMsg::Reject { code, .. }) = ServerMsg::decode(&b) {
                return code;
            }
        }
    }
}

/// ws()'s `max_frame_size`/`max_message_size`: a client frame of exactly MAX_CLIENT_FRAME reaches the decoder (which
/// refuses the junk as Malformed); one byte more is cut by the WebSocket layer first, so the connection just ends (Kicked).
#[tokio::test]
async fn the_websocket_layer_cuts_client_frames_exactly_past_the_limit() {
    let s = start(false).await;
    let mut ws = welcomed(&s, "limit_ok").await;
    ws.send(Message::Binary(
        vec![0xff; rh_protocol::MAX_CLIENT_FRAME].into(),
    ))
    .await
    .unwrap();
    assert_eq!(
        reject_code(&mut ws).await,
        rh_protocol::RejectCode::Malformed,
        "a frame at the limit is decoded (and refused as junk)"
    );
    let mut ws = welcomed(&s, "limit_over").await;
    let _ = ws
        .send(Message::Binary(
            vec![0xff; rh_protocol::MAX_CLIENT_FRAME + 1].into(),
        ))
        .await;
    assert_eq!(
        reject_code(&mut ws).await,
        rh_protocol::RejectCode::Kicked,
        "a frame past the limit never reaches the decoder"
    );
    s.handle.shutdown();
}

/// ws()'s 4 KiB read buffer: a burst far larger than the buffer (50 inputs and 50 pings, written without waiting) is read
/// whole and in order: the 50 pongs come back with nonces 0..50.
#[tokio::test]
async fn a_burst_larger_than_the_read_buffer_is_read_whole_and_in_order() {
    let s = start(false).await;
    let mut ws = welcomed(&s, "burster").await;
    let moves = vec![
        rh_protocol::WireCommand::Move {
            x: 100.0,
            y: 100.0,
            seq: Some(1),
        };
        rh_protocol::MAX_COMMANDS_PER_INPUT
    ];
    let input = ClientMsg::Input {
        seq: 1,
        commands: moves,
    }
    .encode();
    assert!(
        input.len() * 50 > 2 * rh_server::WS_READ_BUFFER,
        "the burst must dwarf the read buffer ({} B per input)",
        input.len()
    );
    for nonce in 0..50u32 {
        ws.feed(Message::Binary(input.clone().into()))
            .await
            .unwrap();
        let ping = ClientMsg::Ping {
            nonce,
            client_ms: 0.0,
        };
        ws.feed(Message::Binary(ping.encode().into()))
            .await
            .unwrap();
    }
    ws.flush().await.unwrap();
    let mut next = 0u32;
    while next < 50 {
        let m = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("pongs in time")
            .expect("open")
            .expect("frame");
        let Message::Binary(b) = m else { continue };
        match ServerMsg::decode(&b).expect("decodes") {
            ServerMsg::Pong { nonce, .. } => {
                assert_eq!(nonce, next, "pongs arrive in ping order");
                next += 1;
            }
            ServerMsg::Reject { code, reason } => panic!("rejected: {code:?} {reason}"),
            _ => {}
        }
    }
    s.handle.shutdown();
}

/// WebSocket control frames are charged to the frame bucket: a client that floods Pings (which used to skip the bucket
/// and, with the biased reader, could keep a dead writer hidden for as long as it kept sending) is closed `RateLimited`,
/// like a data flood.
#[tokio::test]
async fn a_websocket_ping_flood_is_rate_limited() {
    let s = start(false).await;
    let mut ws = welcomed(&s, "pinger").await;
    for _ in 0..(rh_server::conn::FRAME_BURST as usize * 2) {
        ws.feed(Message::Ping(vec![0u8; 4].into())).await.unwrap();
    }
    ws.flush().await.unwrap();
    assert_eq!(
        reject_code(&mut ws).await,
        rh_protocol::RejectCode::RateLimited
    );
    s.handle.shutdown();
}
