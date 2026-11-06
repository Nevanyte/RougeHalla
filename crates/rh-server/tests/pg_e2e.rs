//! End to end with the durable store (feature `postgres`, a real PostgreSQL from DATABASE_URL): two profiles are claimed,
//! play a match over WebSockets, and their results are banked exactly once under their fenced session leases.
//!   eval "$(tools/pgtest/start.sh)"; cargo test -p rh-server --features postgres --test pg_e2e
#![cfg(feature = "postgres")]

/// The lease-rules conformance table, so the Postgres half runs in CI's existing pg_e2e step (the memory half also runs
/// as its own test target).
#[path = "lease_conformance.rs"]
mod lease_conformance;

use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, ServerMsg, WireCommand, WireEvent, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Connects and says Hello until the profile is admitted (a Welcome). A `ProfileInUse` refusal is retried (by condition,
/// bounded): it is the answer while the previous seat's Leave is still in flight. Any other refusal fails the test.
async fn join_when_free(
    ws_url: &str,
    hello: ClientMsg,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let (mut ws, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
        ws.send(Message::Binary(hello.encode().into()))
            .await
            .unwrap();
        loop {
            let Ok(Some(Ok(Message::Binary(b)))) =
                tokio::time::timeout(Duration::from_secs(10), ws.next()).await
            else {
                panic!("no answer to the Hello")
            };
            match ServerMsg::decode(&b).unwrap() {
                ServerMsg::Welcome { .. } => return ws,
                ServerMsg::Reject {
                    code: rh_protocol::RejectCode::ProfileInUse,
                    reason,
                } => {
                    assert!(
                        tokio::time::Instant::now() < deadline,
                        "still refused after 20 s: {reason}"
                    );
                    // A short backoff (the Leave is a few ms from landing), not a busy loop of connections.
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    break;
                }
                ServerMsg::Reject { code, reason } => panic!("rejoin refused: {code:?} {reason}"),
                _ => {}
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_match_over_websockets_banks_results_once_in_postgres() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    // A fresh database for this test.
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_srv_{}", std::process::id());
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db}"))
        .execute(admin.pool())
        .await;
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = match url.rfind('/') {
        Some(i) => format!("{}/{db}", &url[..i]),
        None => panic!("DATABASE_URL has no database name"),
    };
    let store = Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    store.create_profile("papa", "tok-papa").await.unwrap();
    store.create_profile("quebec", "tok-quebec").await.unwrap();

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
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(5), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(6), tile_to_world_center(4)),
        ],
    };
    let cfg = DirectorConfig {
        tick: Duration::from_millis(3),
        linger: Duration::from_millis(100),
        ..DirectorConfig::new(
            SimConfig {
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
            },
            arena,
        )
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::postgres(store.clone(), "test-host".into())),
        Arc::new(Auth::Postgres(store.clone())),
        lifecycle.clone(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, rh_server::public_router(director))
            .await
            .unwrap()
    });
    lifecycle.ready();

    let hello = |p: &str, t: &str, f: u8| ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: String::new(),
        profile: p.into(),
        ticket: t.as_bytes().to_vec(),
        faction: Some(f),
        resume: None,
    };
    // A wrong token is refused by the durable credentials.
    let (mut bad, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    bad.send(Message::Binary(hello("papa", "wrong", 0).encode().into()))
        .await
        .unwrap();
    let first = loop {
        match tokio::time::timeout(Duration::from_secs(10), bad.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => break ServerMsg::decode(&b).unwrap(),
            Ok(Some(Ok(_))) => continue,
            other => panic!("no reject: {other:?}"),
        }
    };
    assert!(matches!(
        first,
        ServerMsg::Reject {
            code: rh_protocol::RejectCode::BadCredentials,
            ..
        }
    ));

    let mut sockets = Vec::new();
    for (p, t, f) in [("papa", "tok-papa", 0u8), ("quebec", "tok-quebec", 4u8)] {
        let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
        ws.send(Message::Binary(hello(p, t, f).encode().into()))
            .await
            .unwrap();
        sockets.push(ws);
    }
    // Wait for the run (the lobby discards inputs, as in legacy), then both hold attack toward the other.
    let mut xs = Vec::new();
    for ws in sockets.iter_mut() {
        let mut track = rh_protocol::SnapshotTracker::new();
        loop {
            let b = match tokio::time::timeout(Duration::from_secs(10), ws.next()).await {
                Ok(Some(Ok(Message::Binary(b)))) => b,
                Ok(Some(Ok(_))) => continue,
                other => panic!("no run: {other:?}"),
            };
            match track.decode(&b).unwrap() {
                ServerMsg::Snapshot {
                    me: Some(me),
                    phase: 1,
                    ..
                } => {
                    xs.push(me.x);
                    break;
                }
                ServerMsg::Reject { code, reason } => {
                    panic!("admission refused: {code:?} {reason}")
                }
                _ => {}
            }
        }
    }
    for (i, ws) in sockets.iter_mut().enumerate() {
        let a = if xs[1 - i] > xs[i] {
            0.0
        } else {
            std::f32::consts::PI
        };
        ws.send(Message::Binary(
            ClientMsg::Input {
                seq: 1,
                commands: vec![WireCommand::Attack { a, t: None }],
            }
            .encode()
            .into(),
        ))
        .await
        .unwrap();
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    for ws in sockets.iter_mut() {
        let mut done = false;
        while tokio::time::Instant::now() < deadline {
            let Ok(Some(Ok(m))) = tokio::time::timeout(Duration::from_secs(10), ws.next()).await
            else {
                break;
            };
            if let Message::Binary(b) = m {
                if let ServerMsg::Events { events, .. } = ServerMsg::decode(&b).unwrap() {
                    if events.iter().any(|e| matches!(e, WireEvent::Result(_))) {
                        done = true;
                        break;
                    }
                }
            }
        }
        assert!(done, "each player received its result");
    }
    // Results are written off the tick: poll briefly.
    let mut total = 0;
    for _ in 0..50 {
        let papa = store.get_profile("papa").await.unwrap().unwrap();
        let quebec = store.get_profile("quebec").await.unwrap().unwrap();
        total = papa.gv + quebec.gv;
        if papa.stats.runs + quebec.stats.runs == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let papa = store.get_profile("papa").await.unwrap().unwrap();
    let quebec = store.get_profile("quebec").await.unwrap().unwrap();
    assert_eq!(
        papa.stats.runs + quebec.stats.runs,
        2,
        "both runs banked exactly once"
    );
    assert_eq!(
        total, 10,
        "one kill's GV (the win bonus is withheld below 3 human starters)"
    );
    let results: i64 = sqlx::query_scalar("SELECT count(*) FROM match_results")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(results, 2);
    // One match row for both results, naming the build and rules that played it and the host that owned the leases.
    let (build, hash, owner, humans): (String, i64, String, i32) =
        sqlx::query_as("SELECT build, content_hash, owner, humans FROM matches")
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(build, rh_sim::replay::BUILD_ID);
    assert_eq!(hash as u64, rh_sim::content::content_hash());
    assert_eq!((owner.as_str(), humans), ("test-host", 2));
    let doc: serde_json::Value = sqlx::query_scalar("SELECT result FROM match_results LIMIT 1")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(doc["v"], 1);
    assert!(
        doc["durationSec"].is_number() && doc["place"].is_number(),
        "{doc}"
    );
    let fences: Vec<i64> =
        sqlx::query_scalar("SELECT fence FROM session_leases ORDER BY profile_id")
            .fetch_all(store.pool())
            .await
            .unwrap();
    assert_eq!(fences, vec![1, 1], "each profile held one fenced lease");

    // The match is over, but its seats are held until the players leave (the room lingers): a profile in a live seat is
    // refused, as C-PERSIST requires. Rejoining right after the result therefore raced the room's own close (this was the
    // flake: the match's own socket still owned the profile). Each player leaves; the profile is free as soon as its lease
    // release lands, and an admission for a profile that is mid-release waits for it (director LEAVING_WAIT), so a rejoin
    // is admitted with no sleep. Only a refusal sent before the Leave was processed is retried, by condition.
    for ws in sockets.iter_mut() {
        ws.send(Message::Binary(ClientMsg::Leave.encode().into()))
            .await
            .unwrap();
    }
    let mut ws = join_when_free(&ws_url, hello("papa", "tok-papa", 0)).await;
    // A lobby leave releases the lease, so the profile can play again at once (no hour-long ProfileInUse).
    ws.send(Message::Binary(ClientMsg::Leave.encode().into()))
        .await
        .unwrap();
    let mut again = join_when_free(&ws_url, hello("papa", "tok-papa", 0)).await;
    again
        .send(Message::Binary(ClientMsg::Leave.encode().into()))
        .await
        .unwrap();
    drop(store);
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}

/// Leaving mid-run is MIA: its result is banked under the fence it was earned with, although the seat is gone by the time
/// the result is reported (the director keeps the profile reserved until the write).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_mia_leave_is_banked_under_its_fence() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_srv_mia_{}", std::process::id());
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db}"))
        .execute(admin.pool())
        .await;
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = format!("{}/{db}", &url[..url.rfind('/').unwrap()]);
    let store = Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    store.create_profile("tango", "t1").await.unwrap();
    store.create_profile("uniform", "t2").await.unwrap();
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
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(3), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(8), tile_to_world_center(4)),
        ],
    };
    let cfg = DirectorConfig {
        tick: Duration::from_millis(3),
        linger: Duration::from_millis(100),
        ..DirectorConfig::new(
            SimConfig {
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
            },
            arena,
        )
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::postgres(store.clone(), "test-host".into())),
        Arc::new(Auth::Postgres(store.clone())),
        lifecycle.clone(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, rh_server::public_router(director))
            .await
            .unwrap()
    });
    lifecycle.ready();
    let hello = |p: &str, t: &str| ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: String::new(),
        profile: p.into(),
        ticket: t.as_bytes().to_vec(),
        faction: None,
        resume: None,
    };
    let mut socks = Vec::new();
    for (p, t) in [("tango", "t1"), ("uniform", "t2")] {
        let (mut ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
        ws.send(Message::Binary(hello(p, t).encode().into()))
            .await
            .unwrap();
        socks.push(ws);
    }
    let mut track = rh_protocol::SnapshotTracker::new();
    loop {
        let Ok(Some(Ok(Message::Binary(b)))) =
            tokio::time::timeout(Duration::from_secs(10), socks[0].next()).await
        else {
            panic!("no run")
        };
        if matches!(
            track.decode(&b).unwrap(),
            ServerMsg::Snapshot { phase: 1, .. }
        ) {
            break;
        }
    }
    socks[0]
        .send(Message::Binary(ClientMsg::Leave.encode().into()))
        .await
        .unwrap();
    let mut banked = false;
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT p.callsign, r.fence FROM match_results r JOIN profiles p USING (profile_id) ORDER BY p.callsign")
                .fetch_all(store.pool())
                .await
                .unwrap();
        if rows.iter().any(|(c, _)| c == "tango") && rows.iter().any(|(c, _)| c == "uniform") {
            assert!(
                rows.iter().all(|(_, f)| *f == 1),
                "written under the fence each seat held: {rows:?}"
            );
            banked = true;
            break;
        }
    }
    assert!(
        banked,
        "both results (the leaver's MIA and the walkover win) were banked"
    );
    let tango = store.get_profile("tango").await.unwrap().unwrap();
    assert_eq!(tango.stats.runs, 1);
    drop(store);
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}
