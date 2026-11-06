//! The live server over real sockets (plain ws:// on loopback; TLS is exercised by the browser proof). The tick grid is
//! sped up (TEST_TICK of wall time per step) so whole matches finish in a second; simulation time still advances exactly
//! TICK_MS per step, so outcomes are those of real time (docs/CONTRACTS.md C-TICK).
// `Persistence` has one variant without the `postgres` feature, so its `let ... else` is irrefutable there.
#![allow(irrefutable_let_patterns)]

use futures_util::{SinkExt, StreamExt};
use rh_protocol::{
    ClientMsg, RejectCode, ServerMsg, SnapshotTracker, WireCommand, WireEvent, PROTOCOL_VERSION,
};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

/// A client socket and its snapshot decoder: snapshots arrive as Full frames and deltas (protocol v5), and `recv` resolves
/// both to `ServerMsg::Snapshot`, as a client does. A Welcome resets the decoder, so a resumed connection starts afresh.
struct Ws {
    sock: WebSocketStream<MaybeTlsStream<TcpStream>>,
    track: SnapshotTracker,
}

impl std::ops::Deref for Ws {
    type Target = WebSocketStream<MaybeTlsStream<TcpStream>>;
    fn deref(&self) -> &Self::Target {
        &self.sock
    }
}

impl std::ops::DerefMut for Ws {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.sock
    }
}
const TEST_TICK: Duration = Duration::from_millis(3);

/// A 12x8 room whose two spawns are 32 u apart: both fighters are in fists reach from the first tick.
fn duel_arena() -> Arena {
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
    let map = TileMap::from_rows(&rows).unwrap();
    Arena {
        map,
        spawns: vec![
            Vec2::new(tile_to_world_center(5), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(6), tile_to_world_center(4)),
        ],
    }
}

struct Server {
    url: String,
    director: Arc<Director>,
}

async fn start(arena: Arena, tweak: impl FnOnce(&mut DirectorConfig)) -> Server {
    let sim = SimConfig {
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
    let mut cfg = DirectorConfig {
        tick: TEST_TICK,
        linger: Duration::from_millis(150),
        reconnect_grace: Duration::from_millis(600),
        ..DirectorConfig::new(sim, arena)
    };
    tweak(&mut cfg);
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    // The production serve path (TCP_NODELAY acceptor, WebSocket buffer sizes), not a test-only listener.
    let app = rh_server::public_router(director.clone());
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    let addr = handle.listening().await.expect("listening");
    lifecycle.ready();
    Server {
        url: format!("ws://{addr}/ws"),
        director,
    }
}

async fn connect(url: &str) -> Ws {
    Ws {
        sock: tokio_tungstenite::connect_async(url)
            .await
            .expect("connect")
            .0,
        track: SnapshotTracker::new(),
    }
}

async fn send(ws: &mut Ws, m: ClientMsg) {
    ws.send(Message::Binary(m.encode().into())).await.unwrap();
}

/// The next server message, or None if the socket closed or nothing came within 3 s.
async fn recv(ws: &mut Ws) -> Option<ServerMsg> {
    loop {
        match tokio::time::timeout(Duration::from_secs(3), ws.sock.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => {
                return Some(ws.track.decode(&b).expect("server frames decode and apply"))
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => return None,
            Ok(Some(Ok(_))) => continue,
        }
    }
}

fn hello(profile: &str) -> ClientMsg {
    ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: "test".into(),
        profile: profile.into(),
        ticket: b"t".to_vec(),
        faction: None,
        resume: None,
    }
}

/// Connects and returns (socket, player id, session token).
async fn join(url: &str, profile: &str, faction: Option<u8>) -> (Ws, u32, [u8; 16]) {
    let mut ws = connect(url).await;
    let mut h = hello(profile);
    if let ClientMsg::Hello { faction: f, .. } = &mut h {
        *f = faction;
    }
    send(&mut ws, h).await;
    match recv(&mut ws).await {
        Some(ServerMsg::Welcome {
            player_id,
            session,
            map,
            tick_rate,
            ..
        }) => {
            assert_eq!(tick_rate, 20);
            assert_eq!(
                map.layer_hash,
                rh_protocol::map::layer_hash(map.w as u32, map.h as u32, &map.tiles)
            );
            (ws, player_id, session)
        }
        other => panic!("expected Welcome, got {other:?}"),
    }
}

/// Reads until a Result event for this connection arrives; returns it and the number of snapshots seen.
async fn until_result(ws: &mut Ws) -> (Option<rh_protocol::WireResult>, u32) {
    let mut snaps = 0;
    while let Some(m) = recv(ws).await {
        match m {
            ServerMsg::Snapshot { .. } => snaps += 1,
            ServerMsg::Events { events, .. } => {
                for e in events {
                    if let WireEvent::Result(r) = e {
                        return (Some(r), snaps);
                    }
                }
            }
            _ => {}
        }
    }
    (None, snaps)
}

/// The duel spawns are shuffled onto adjacent tiles. Wait for the raid to learn the actual spawn
/// and to avoid sending an attack the lobby will discard.
async fn duel_spawn_x(ws: &mut Ws, player: u32) -> f32 {
    loop {
        if let ServerMsg::Snapshot {
            me: Some(me),
            phase: 1,
            ..
        } = recv(ws).await.expect("active duel snapshot")
        {
            assert_eq!(me.id, player);
            return me.x;
        }
    }
}

fn attack(seq: u32, a: f32) -> ClientMsg {
    ClientMsg::Input {
        seq,
        commands: vec![WireCommand::Attack { a, t: None }],
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_full_match_over_websockets_ends_in_authoritative_results_and_durable_writes() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut a, ida, _) = join(&s.url, "alpha", Some(0)).await; // Fire
    let (mut b, idb, _) = join(&s.url, "bravo", Some(4)).await; // Holy
    assert_ne!(ida, idb);
    // Hold the trigger toward each other: whichever spawn each got, aim along x toward the other's side.
    let (xa, xb) = tokio::join!(duel_spawn_x(&mut a, ida), duel_spawn_x(&mut b, idb));
    send(
        &mut a,
        attack(1, if xb > xa { 0.0 } else { std::f32::consts::PI }),
    )
    .await;
    send(
        &mut b,
        attack(1, if xa > xb { 0.0 } else { std::f32::consts::PI }),
    )
    .await;
    let (ra, sa) = until_result(&mut a).await;
    let (rb, _) = until_result(&mut b).await;
    let (ra, rb) = (ra.expect("alpha's result"), rb.expect("bravo's result"));
    assert!(sa > 50, "snapshots streamed during the fight ({sa})");
    // Holy out-trades Fire on fists (the parity fixture fists_duel): Fire dies.
    assert_eq!((ra.outcome, ra.place), (2, 2), "alpha (Fire) died: {ra:?}");
    assert_eq!((rb.outcome, rb.place), (0, 1), "bravo (Holy) won: {rb:?}");
    assert_eq!(
        rb.gv_total, 10,
        "one kill; the win bonus is withheld below 3 human starters"
    );
    assert!(rb.win_bonus_withheld);
    // The durable sink received both results once, off the tick.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let Persistence::Memory(m) = &*s.director.persistence else {
        unreachable!()
    };
    let results = m.results.lock().unwrap();
    assert_eq!(results.len(), 2, "{results:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refusals_happen_before_a_seat_is_taken() {
    let s = start(duel_arena(), |_| {}).await;
    // Wrong protocol version.
    let mut ws = connect(&s.url).await;
    send(
        &mut ws,
        ClientMsg::Hello {
            protocol: 99,
            content_hash: 0,
            build: String::new(),
            profile: "x1".into(),
            ticket: Vec::new(),
            faction: None,
            resume: None,
        },
    )
    .await;
    assert!(matches!(
        recv(&mut ws).await,
        Some(ServerMsg::Reject {
            code: RejectCode::ProtocolMismatch,
            ..
        })
    ));
    // A protocol-1 client (the previous wire) is refused with the same reject: the server speaks only its current version.
    let mut ws = connect(&s.url).await;
    send(
        &mut ws,
        ClientMsg::Hello {
            protocol: 1,
            content_hash: rh_sim::content::content_hash(),
            build: String::new(),
            profile: "x1v1".into(),
            ticket: Vec::new(),
            faction: None,
            resume: None,
        },
    )
    .await;
    match recv(&mut ws).await {
        Some(ServerMsg::Reject {
            code: RejectCode::ProtocolMismatch,
            reason,
        }) => assert!(
            reason.contains(&format!("protocol {PROTOCOL_VERSION}")),
            "{reason}"
        ),
        other => panic!("{other:?}"),
    }
    // Wrong content hash: the reason names the server's.
    let mut ws = connect(&s.url).await;
    send(
        &mut ws,
        ClientMsg::Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: 1,
            build: String::new(),
            profile: "x2".into(),
            ticket: Vec::new(),
            faction: None,
            resume: None,
        },
    )
    .await;
    match recv(&mut ws).await {
        Some(ServerMsg::Reject {
            code: RejectCode::ContentMismatch,
            reason,
        }) => assert!(reason.contains(&format!("{:016x}", rh_sim::content::content_hash()))),
        other => panic!("{other:?}"),
    }
    // The envelope: a Hello of another version whose layout this build cannot parse (junk after the prefix, or nothing but
    // the prefix) still gets ProtocolMismatch, not Malformed. Same protocol with junk stays Malformed.
    for frame in [
        vec![0x01, 3, 0, 0xde, 0xad, 0xbe, 0xef, 1, 2, 3],
        vec![0x01, 3, 0],
        vec![0x01, 0xff, 0xff, 7],
    ] {
        let mut ws = connect(&s.url).await;
        ws.send(Message::Binary(frame.into())).await.unwrap();
        match recv(&mut ws).await {
            Some(ServerMsg::Reject {
                code: RejectCode::ProtocolMismatch,
                reason,
            }) => assert!(
                reason.contains(&format!("protocol {PROTOCOL_VERSION}")),
                "{reason}"
            ),
            other => panic!("{other:?}"),
        }
    }
    let mut ws = connect(&s.url).await;
    ws.send(Message::Binary(
        vec![
            0x01,
            PROTOCOL_VERSION as u8,
            (PROTOCOL_VERSION >> 8) as u8,
            9,
            9,
        ]
        .into(),
    ))
    .await
    .unwrap();
    assert!(matches!(
        recv(&mut ws).await,
        Some(ServerMsg::Reject {
            code: RejectCode::Malformed,
            ..
        })
    ));
    // Malformed first frame, and a text frame.
    let mut ws = connect(&s.url).await;
    ws.send(Message::Binary(vec![0x7f].into())).await.unwrap();
    assert!(matches!(
        recv(&mut ws).await,
        Some(ServerMsg::Reject {
            code: RejectCode::Malformed,
            ..
        })
    ));
    let mut ws = connect(&s.url).await;
    ws.send(Message::Text("hello".into())).await.unwrap();
    assert!(matches!(
        recv(&mut ws).await,
        Some(ServerMsg::Reject {
            code: RejectCode::Malformed,
            ..
        })
    ));
    // A bad callsign.
    let mut ws = connect(&s.url).await;
    send(&mut ws, hello("no spaces allowed")).await;
    assert!(matches!(
        recv(&mut ws).await,
        Some(ServerMsg::Reject {
            code: RejectCode::BadCredentials,
            ..
        })
    ));
    // A profile already seated.
    let (_keep, _, _) = join(&s.url, "charlie", None).await;
    let mut dup = connect(&s.url).await;
    send(&mut dup, hello("CHARLIE")).await;
    assert!(matches!(
        recv(&mut dup).await,
        Some(ServerMsg::Reject {
            code: RejectCode::ProfileInUse,
            ..
        })
    ));
    // An oversize frame (beyond MAX_CLIENT_FRAME) is cut by the WebSocket layer before decoding.
    let (mut big, _, _) = join(&s.url, "delta", None).await;
    let _ = big
        .send(Message::Binary(
            vec![2u8; rh_protocol::MAX_CLIENT_FRAME * 4].into(),
        ))
        .await;
    let mut closed = false;
    for _ in 0..200 {
        match tokio::time::timeout(Duration::from_secs(3), big.next()).await {
            Ok(Some(Ok(Message::Binary(_)))) => continue,
            _ => {
                closed = true;
                break;
            }
        }
    }
    assert!(closed, "an oversize frame closes the connection");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_dropped_client_resumes_its_seat_and_a_lapsed_one_is_mia() {
    let s = start(duel_arena(), |_| {}).await;
    let (a, ida, session) = join(&s.url, "echo", Some(3)).await;
    let (mut b, _, _) = join(&s.url, "foxtrot", Some(3)).await;
    // Wait for the run, then drop alpha's socket.
    while let Some(m) = recv(&mut b).await {
        if matches!(m, ServerMsg::Snapshot { phase: 1, .. }) {
            break;
        }
    }
    drop(a);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut a2 = connect(&s.url).await;
    send(
        &mut a2,
        ClientMsg::Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            build: String::new(),
            profile: "echo".into(),
            ticket: b"t".to_vec(),
            faction: None,
            resume: Some(session),
        },
    )
    .await;
    match recv(&mut a2).await {
        Some(ServerMsg::Welcome { player_id, .. }) => assert_eq!(player_id, ida, "the same seat"),
        other => panic!("expected a resumed Welcome, got {other:?}"),
    }
    let mut live = false;
    while let Some(m) = recv(&mut a2).await {
        if let ServerMsg::Snapshot {
            me: Some(me),
            phase: 1,
            ..
        } = m
        {
            assert_eq!(me.status, 1, "still alive after the reconnect");
            live = true;
            break;
        }
    }
    assert!(live);
    // Now drop for good: after the grace the seat is a leave (MIA) and foxtrot wins the walkover.
    drop(a2);
    let (rb, _) = until_result(&mut b).await;
    let rb = rb.expect("foxtrot's result");
    assert_eq!(rb.outcome, 0, "the remaining fighter wins: {rb:?}");
    // A stale session token is refused.
    let mut a3 = connect(&s.url).await;
    send(
        &mut a3,
        ClientMsg::Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            build: String::new(),
            profile: "echo".into(),
            ticket: b"t".to_vec(),
            faction: None,
            resume: Some(session),
        },
    )
    .await;
    assert!(matches!(
        recv(&mut a3).await,
        Some(ServerMsg::Reject {
            code: RejectCode::NoSuchSession,
            ..
        })
    ));
}

/// Protocol v4: a player's own Result is kept on its seat. A client that was away (inside the reconnect grace) when its run
/// resolved receives the Result after the resumed Welcome, instead of never.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_player_who_reconnects_after_the_match_resolved_still_receives_their_result() {
    let s = start(duel_arena(), |c| {
        c.reconnect_grace = Duration::from_secs(20);
        c.linger = Duration::from_secs(20);
    })
    .await;
    // Fire (alpha) will not fight; Holy (bravo) does and wins.
    let (mut a, ida, session) = join(&s.url, "alpha", Some(0)).await;
    let (mut b, idb, _) = join(&s.url, "bravo", Some(4)).await;
    let (xa, xb) = tokio::join!(duel_spawn_x(&mut a, ida), duel_spawn_x(&mut b, idb));
    drop(a);
    send(
        &mut b,
        attack(1, if xa > xb { 0.0 } else { std::f32::consts::PI }),
    )
    .await;
    let (rb, _) = until_result(&mut b).await;
    assert_eq!(rb.expect("bravo's result").outcome, 0, "bravo won");
    // Alpha comes back inside the grace: its run resolved while it was away.
    let mut a2 = connect(&s.url).await;
    send(
        &mut a2,
        ClientMsg::Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            build: String::new(),
            profile: "alpha".into(),
            ticket: b"t".to_vec(),
            faction: None,
            resume: Some(session),
        },
    )
    .await;
    match recv(&mut a2).await {
        Some(ServerMsg::Welcome { player_id, .. }) => assert_eq!(player_id, ida),
        other => panic!("expected a resumed Welcome, got {other:?}"),
    }
    let (ra, snaps) = until_result(&mut a2).await;
    let ra = ra.expect("alpha's own result, re-sent after the resume");
    assert_eq!((ra.outcome, ra.place), (2, 2), "alpha died: {ra:?}");
    assert!(
        snaps <= 2,
        "the Result follows the Welcome at once ({snaps})"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn leaving_mid_run_is_mia_with_a_result() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut a, _, _) = join(&s.url, "golf", None).await;
    let (mut b, _, _) = join(&s.url, "hotel", None).await;
    while let Some(m) = recv(&mut a).await {
        if matches!(m, ServerMsg::Snapshot { phase: 1, .. }) {
            break;
        }
    }
    send(&mut a, ClientMsg::Leave).await;
    let (rb, _) = until_result(&mut b).await;
    assert_eq!(rb.expect("hotel's result").outcome, 0);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let Persistence::Memory(m) = &*s.director.persistence else {
        unreachable!()
    };
    let results = m.results.lock().unwrap();
    let golf = results
        .iter()
        .find(|(_, p, _)| p == "golf")
        .expect("the leaver's result is banked");
    assert_eq!(golf.2.outcome, rh_sim::Outcome::Mia);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn draining_refuses_new_players_and_lets_the_match_finish() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut a, ida, _) = join(&s.url, "india", Some(0)).await;
    let (mut b, idb, _) = join(&s.url, "juliet", Some(4)).await;
    let (xa, xb) = tokio::join!(duel_spawn_x(&mut a, ida), duel_spawn_x(&mut b, idb));
    s.director.drain().await;
    let mut late = connect(&s.url).await;
    send(&mut late, hello("kilo")).await;
    assert!(matches!(
        recv(&mut late).await,
        Some(ServerMsg::Reject {
            code: RejectCode::ServerDraining,
            ..
        })
    ));
    assert_eq!(s.director.lifecycle.state_name(), "draining");
    // Both fighters can still play and receive their own combat results while draining.
    send(
        &mut a,
        attack(1, if xb > xa { 0.0 } else { std::f32::consts::PI }),
    )
    .await;
    send(
        &mut b,
        attack(1, if xa > xb { 0.0 } else { std::f32::consts::PI }),
    )
    .await;
    let ((ra, _), (rb, _)) = tokio::join!(until_result(&mut a), until_result(&mut b));
    let (ra, rb) = (ra.expect("india's result"), rb.expect("juliet's result"));
    assert!(
        matches!(
            ((ra.outcome, ra.place), (rb.outcome, rb.place)),
            ((0, 1), (2, 2)) | ((2, 2), (0, 1))
        ),
        "expected a winner and a defeated opponent, got {ra:?} and {rb:?}"
    );
    for _ in 0..50 {
        if s.director.lifecycle.is_terminated() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        s.director.lifecycle.is_terminated(),
        "the last room closed: terminated"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_flooding_client_is_rate_limited() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut a, _, _) = join(&s.url, "lima", None).await;
    for i in 0..400 {
        if a.send(Message::Binary(
            ClientMsg::Ping {
                nonce: i,
                client_ms: 0.0,
            }
            .encode()
            .into(),
        ))
        .await
        .is_err()
        {
            break;
        }
    }
    let mut limited = false;
    while let Some(m) = recv(&mut a).await {
        if let ServerMsg::Reject {
            code: RejectCode::RateLimited,
            ..
        } = m
        {
            limited = true;
            break;
        }
    }
    assert!(limited);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stalled_client_does_not_stall_the_match() {
    let s = start(duel_arena(), |c| c.tick = Duration::from_millis(5)).await;
    let (_stalled, _, _) = join(&s.url, "mike", None).await; // never read again
    let (mut b, _, _) = join(&s.url, "november", None).await;
    let mut ticks = Vec::new();
    let t0 = std::time::Instant::now();
    while t0.elapsed() < Duration::from_millis(800) {
        if let Some(ServerMsg::Snapshot { tick, .. }) = recv(&mut b).await {
            ticks.push(tick);
        }
    }
    let span = ticks.last().unwrap() - ticks.first().unwrap();
    assert!(
        span > 80,
        "the room kept stepping for the reading client ({span} ticks in 0.8 s at 5 ms a tick)"
    );
}

/// The first byte (0x83 Full, 0x87 delta) of every snapshot frame that arrives within `ms`.
async fn snapshot_kinds_for(ws: &mut Ws, ms: u64) -> Vec<u8> {
    let mut kinds = Vec::new();
    let end = tokio::time::Instant::now() + Duration::from_millis(ms);
    while let Ok(Some(Ok(m))) = tokio::time::timeout_at(end, ws.sock.next()).await {
        if let Message::Binary(b) = m {
            if b[0] == 0x83 || b[0] == 0x87 {
                kinds.push(b[0]);
            }
        }
    }
    kinds
}

/// Protocol v3 over a real socket: the first snapshot is Full and deltas follow; a Resync is answered by exactly one Full
/// snapshot; Resyncs that follow within the interval between forced Full frames (20 ticks) are not lost: each burst of them ends
/// with one more Full snapshot and deltas resume (a client that asks once per burst of refusals can never freeze).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_resync_is_answered_with_a_full_snapshot_and_never_dropped() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut ws, _, _) = join(&s.url, "tango2", None).await;
    let full = |k: &[u8]| k.iter().filter(|b| **b == 0x83).count();
    let first = snapshot_kinds_for(&mut ws, 300).await;
    assert!(first.len() > 20, "{}", first.len());
    assert_eq!(first[0], 0x83, "the first snapshot after a Welcome is Full");
    assert!(first[1..].iter().all(|k| *k == 0x87), "then deltas");

    send(&mut ws, ClientMsg::Resync).await;
    let answered = snapshot_kinds_for(&mut ws, 300).await;
    assert_eq!(full(&answered), 1, "one Full per Resync");
    assert!(
        answered.len() > 20 && answered.last() == Some(&0x87),
        "deltas resume"
    );

    // Two refusals back to back (the second inside the 20-tick interval between forced Full frames): the first is answered at
    // once, the second is not dropped but answered when the interval ends. Two Full frames, then deltas.
    send(&mut ws, ClientMsg::Resync).await;
    tokio::time::sleep(Duration::from_millis(15)).await; // a few ticks: the two requests are not one
    send(&mut ws, ClientMsg::Resync).await;
    let deferred = snapshot_kinds_for(&mut ws, 300).await;
    assert_eq!(
        full(&deferred),
        2,
        "the early Resync is answered, not dropped"
    );
    assert!(deferred.len() > 20 && deferred.last() == Some(&0x87));
    // A burst is answered by a bounded number of Full frames (one per interval at most), and the last one always is.
    for _ in 0..4 {
        send(&mut ws, ClientMsg::Resync).await;
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    let burst = snapshot_kinds_for(&mut ws, 300).await;
    assert!(
        (2..=4).contains(&full(&burst)),
        "{} Full frames",
        full(&burst)
    );
    assert!(burst.len() > 20 && burst.last() == Some(&0x87));

    // The connection is fine and quiet again.
    let quiet = snapshot_kinds_for(&mut ws, 300).await;
    assert_eq!(full(&quiet), 0);
    assert!(quiet.len() > 20);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_replaced_connection_can_neither_steer_nor_detach_the_resumed_seat() {
    let s = start(duel_arena(), |c| c.reconnect_grace = Duration::from_secs(5)).await;
    let (mut old, _, session) = join(&s.url, "romeo", None).await;
    let (mut b, _, _) = join(&s.url, "sierra", None).await;
    while let Some(m) = recv(&mut b).await {
        if matches!(m, ServerMsg::Snapshot { phase: 1, .. }) {
            break;
        }
    }
    // Resume on a second connection while the first is still open (a half-open socket after a network change).
    let mut new = connect(&s.url).await;
    send(
        &mut new,
        ClientMsg::Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            build: String::new(),
            profile: "romeo".into(),
            ticket: b"t".to_vec(),
            faction: None,
            resume: Some(session),
        },
    )
    .await;
    assert!(matches!(
        recv(&mut new).await,
        Some(ServerMsg::Welcome { .. })
    ));
    // The old connection tries to steer the seat, then dies late.
    let _ = old
        .send(Message::Binary(
            ClientMsg::Input {
                seq: 9,
                commands: vec![WireCommand::Move {
                    x: 40.0,
                    y: 40.0,
                    seq: Some(99),
                }],
            }
            .encode()
            .into(),
        ))
        .await;
    drop(old);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let mut snaps = 0;
    while let Some(m) = recv(&mut new).await {
        if let ServerMsg::Snapshot { me: Some(me), .. } = m {
            assert_ne!(
                me.move_seq, 99,
                "the replaced connection's order was ignored"
            );
            snaps += 1;
            if snaps >= 20 {
                break;
            }
        }
    }
    assert_eq!(
        snaps, 20,
        "the resumed seat keeps receiving snapshots after the old socket closed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_new_player_gets_a_new_lobby_while_a_run_is_in_progress() {
    let s = start(duel_arena(), |_| {}).await;
    let (mut a, _, _) = join(&s.url, "victor", None).await;
    let (_b, _, _) = join(&s.url, "whiskey", None).await;
    while let Some(m) = recv(&mut a).await {
        if matches!(m, ServerMsg::Snapshot { phase: 1, .. }) {
            break;
        }
    }
    // The first room is running: a third player must be seated in a fresh lobby, not refused.
    let (mut c, _, _) = join(&s.url, "xray", None).await;
    let mut lobby = false;
    while let Some(m) = recv(&mut c).await {
        if let ServerMsg::Snapshot { phase, .. } = m {
            lobby = phase == 0;
            break;
        }
    }
    assert!(lobby, "the new player waits in a new lobby");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_silent_connection_is_dropped_and_its_seat_lapses() {
    let s = start(duel_arena(), |c| {
        c.idle_timeout = Duration::from_millis(400);
        c.reconnect_grace = Duration::from_millis(300);
    })
    .await;
    let (_silent, _, _) = join(&s.url, "yankee", None).await; // never sends a frame again (a half-open socket)
    let (mut b, _, _) = join(&s.url, "zulu", None).await;
    // zulu keeps itself alive with pings; nobody attacks. The silent seat is dropped, then lapses (MIA): zulu wins.
    let mut nonce = 0;
    let mut result = None;
    let mut seen: Vec<String> = Vec::new();
    let t0 = std::time::Instant::now();
    let mut next_ping = std::time::Instant::now();
    while result.is_none() && t0.elapsed() < Duration::from_secs(10) {
        // A client's keep-alive cadence (10 a second), well under the frame-rate limit.
        if std::time::Instant::now() >= next_ping {
            next_ping += Duration::from_millis(100);
            nonce += 1;
            if let Err(e) = b
                .send(Message::Binary(
                    ClientMsg::Ping {
                        nonce,
                        client_ms: 0.0,
                    }
                    .encode()
                    .into(),
                ))
                .await
            {
                seen.push(format!("send failed: {e}"));
                break;
            }
        }
        if let Ok(Some(m)) = tokio::time::timeout(Duration::from_millis(100), recv(&mut b)).await {
            match m {
                ServerMsg::Events { events, .. } => {
                    seen.push(format!("{events:?}"));
                    result = events.into_iter().find_map(|e| {
                        if let WireEvent::Result(r) = e {
                            Some(r)
                        } else {
                            None
                        }
                    });
                }
                ServerMsg::Reject { code, .. } => seen.push(format!("reject {code:?}")),
                ServerMsg::Snapshot { phase, .. } => {
                    let tag = format!("snapshot phase {phase}");
                    if seen.last() != Some(&tag) {
                        seen.push(tag);
                    }
                }
                _ => {}
            }
        }
    }
    let r = result.unwrap_or_else(|| panic!("no result; zulu saw {seen:?}"));
    assert_eq!(r.outcome, 0, "zulu won the walkover: {r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_last_humans_mia_result_is_banked_although_the_room_closes() {
    let s = start(duel_arena(), |c| {
        c.sim.min_players = 1;
        c.fill_bots_to = 2;
    })
    .await;
    let (mut a, _, _) = join(&s.url, "alfa", None).await;
    while let Some(m) = recv(&mut a).await {
        if matches!(m, ServerMsg::Snapshot { phase: 1, .. }) {
            break;
        }
    }
    send(&mut a, ClientMsg::Leave).await; // the only human leaves a running match: the room closes right after
    let Persistence::Memory(m) = &*s.director.persistence else {
        unreachable!()
    };
    for _ in 0..50 {
        if m.results
            .lock()
            .unwrap()
            .iter()
            .any(|(_, p, r)| p == "alfa" && r.outcome == rh_sim::Outcome::Mia)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the leaver's MIA result was never reported");
}

/// A server never hosts a map whose world exceeds the wire's position range (the encoder would refuse every snapshot).
#[tokio::test]
#[should_panic(expected = "refusing to host this arena")]
async fn a_server_refuses_to_host_an_arena_beyond_the_position_range() {
    let map = TileMap::new(256, 4, vec![0; 256 * 4]).unwrap();
    let spawns = vec![Vec2::new(48.0, 48.0)];
    start(Arena { map, spawns }, |_| {}).await;
}
