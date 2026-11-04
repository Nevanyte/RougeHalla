//! End to end with the durable store (feature `postgres`, a real PostgreSQL from DATABASE_URL): two profiles are claimed,
//! play a match over WebSockets, and their results are banked exactly once under their fenced session leases.
//!   eval "$(tools/pgtest/start.sh)"; cargo test -p rh-server --features postgres --test pg_e2e
#![cfg(feature = "postgres")]

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
                min_players: 2,
                lobby_seconds: 30.0,
                fill_seconds: 0.0,
                pvp_rules: true,
            },
            arena,
        )
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::Postgres {
            store: store.clone(),
            owner: "test-host".into(),
        }),
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
        token: t.into(),
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
        loop {
            let b = match tokio::time::timeout(Duration::from_secs(10), ws.next()).await {
                Ok(Some(Ok(Message::Binary(b)))) => b,
                Ok(Some(Ok(_))) => continue,
                other => panic!("no run: {other:?}"),
            };
            match ServerMsg::decode(&b).unwrap() {
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
    let fences: Vec<i64> = sqlx::query_scalar("SELECT fence FROM session_leases ORDER BY callsign")
        .fetch_all(store.pool())
        .await
        .unwrap();
    assert_eq!(fences, vec![1, 1], "each profile held one fenced lease");
    drop(store);
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}
