//! The missing cross-path contract: HTTP-issued credentials, hosted admission, a real match and spool, then HTTP-owned
//! progression after reconstructing the service. No credentials/results are seeded and no simulation outcomes injected.
#![cfg(feature = "postgres")]

#[path = "support/http.rs"]
mod http;

use futures_util::{SinkExt, StreamExt};
use rh_persist::{RecordOutcome, Store, StoredResult};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, SnapshotTracker, WireCommand, WireEvent};
use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_server::spool::{ResultSpool, SpoolConfig};
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use serde_json::{json, Value};
use sqlx::postgres::PgConnectOptions;
use sqlx::{ConnectOptions, Connection, PgConnection};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Peer {
    socket: Socket,
    tracker: SnapshotTracker,
}

struct Service {
    public: SocketAddr,
    control: SocketAddr,
    bearer: String,
    handle: axum_server::Handle,
    control_task: tokio::task::JoinHandle<()>,
    director: Arc<Director>,
    spool: Arc<ResultSpool>,
}

impl Service {
    async fn start(store: Arc<Store>, spool_dir: &std::path::Path) -> Self {
        let map = TileMap::from_rows(&[
            "############",
            "#..........#",
            "#..........#",
            "#..........#",
            "#..........#",
            "#..........#",
            "#..........#",
            "############",
        ])
        .unwrap();
        let cfg = DirectorConfig {
            require_admit: true,
            tick: Duration::from_millis(3),
            reconnect_grace: Duration::from_secs(3),
            linger: Duration::from_millis(100),
            ..DirectorConfig::new(
                SimConfig {
                    regen: false,
                    quests: false,
                    consumables: false,
                    min_players: 2,
                    lobby_seconds: 30.0,
                    fill_seconds: 0.0,
                    ..SimConfig::default()
                },
                Arena {
                    map,
                    spawns: vec![Vec2::new(176.0, 144.0), Vec2::new(208.0, 144.0)],
                },
            )
        };
        let spool = ResultSpool::open(spool_dir, SpoolConfig::default()).unwrap();
        let lifecycle = Arc::new(Lifecycle::default());
        let director = Director::new_with_spool(
            cfg,
            Arc::new(Persistence::postgres(store.clone(), "account-flow".into())),
            Arc::new(Auth::Postgres(store.clone())),
            lifecycle.clone(),
            spool.clone(),
        );
        assert_eq!(
            director.recover_spooled(),
            0,
            "this restart has no pending records"
        );
        let app = rh_server::public_router_with_api(
            director.clone(),
            AccountApi::postgres(store, ApiConfig::default()),
        );
        let handle = axum_server::Handle::new();
        let serving = handle.clone();
        tokio::spawn(async move {
            rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, serving)
                .await
                .unwrap();
        });
        let public = handle.listening().await.unwrap();
        // Disposable operator secret is confined to the test; it is never included in evidence or assertion messages.
        let bearer = format!("Bearer {}", Uuid::new_v4());
        let router = rh_server::control_router_with(
            director.clone(),
            rh_server::control::ControlOptions {
                token: Some(Arc::from(bearer.strip_prefix("Bearer ").unwrap())),
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let control = listener.local_addr().unwrap();
        let control_task =
            tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        lifecycle.ready();
        Self {
            public,
            control,
            bearer,
            handle,
            control_task,
            director,
            spool,
        }
    }

    async fn claim(&self, name: &str) -> String {
        let r = http::get(self.public, &format!("/api/profile/{name}"), &[]).await;
        assert_eq!(
            r.status, 200,
            "claim status (response deliberately withheld)"
        );
        let v = r.json();
        assert_eq!(v["profile"]["stats"]["runs"], 0);
        let token = v["token"].as_str().unwrap().to_owned();
        assert!(token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()));
        token
    }

    async fn profile(&self, name: &str, token: &str) -> Value {
        let r = http::get(
            self.public,
            &format!("/api/profile/{name}"),
            &[("x-profile-token", token)],
        )
        .await;
        assert_eq!(
            r.status, 200,
            "owned profile status (response deliberately withheld)"
        );
        let v = r.json();
        assert!(v["token"].as_str() == Some(token));
        v["profile"].clone()
    }

    async fn control(&self, path: &str, body: Value) -> Value {
        let r = http::post_json(
            self.control,
            path,
            &[("authorization", &self.bearer)],
            &body.to_string(),
        )
        .await;
        assert_eq!(r.status, 200, "operator {path}: {}", r.body);
        r.json()
    }

    async fn reserve(&self, room: &str, seat: &str, name: &str) {
        self.control(
            "/control/admit",
            json!({"v":1,"gameSessionId":room,"playerSessionId":seat,"callsign":name}),
        )
        .await;
    }

    async fn wait_status(&self, room: &str, seat: &str, status: &str) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            let r = http::get(
                self.control,
                "/control/rooms",
                &[("authorization", &self.bearer)],
            )
            .await;
            assert_eq!(r.status, 200);
            let value = r.json();
            let found = value["rooms"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["gameSessionId"] == room)
                .and_then(|r| r["players"].as_array())
                .and_then(|players| players.iter().find(|p| p["playerSessionId"] == seat));
            if found.is_some_and(|p| p["status"] == status) {
                return;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "hosted seat reaches {status} inside reconnect grace"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn connect(
        &self,
        name: &str,
        token: &str,
        resume: Option<[u8; 16]>,
    ) -> (Peer, ServerMsg) {
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", self.public))
            .await
            .unwrap();
        let hello = ClientMsg::Hello {
            protocol: rh_protocol::PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            build: "account-flow".into(),
            profile: name.into(),
            ticket: token.as_bytes().to_vec(),
            faction: None,
            resume,
        };
        ws.send(Message::Binary(hello.encode().into()))
            .await
            .unwrap();
        let mut peer = Peer {
            socket: ws,
            tracker: SnapshotTracker::new(),
        };
        loop {
            let msg = next(&mut peer).await;
            if matches!(msg, ServerMsg::Welcome { .. } | ServerMsg::Reject { .. }) {
                return (peer, msg);
            }
        }
    }

    fn stop(self) {
        self.handle.shutdown();
        self.control_task.abort();
    }
}

async fn next(peer: &mut Peer) -> ServerMsg {
    loop {
        match tokio::time::timeout(Duration::from_secs(10), peer.socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
        {
            Message::Binary(b) => return peer.tracker.decode(&b).unwrap(),
            Message::Ping(b) => peer.socket.send(Message::Pong(b)).await.unwrap(),
            _ => {}
        }
    }
}

async fn active_x(ws: &mut Peer) -> f32 {
    loop {
        if let ServerMsg::Snapshot {
            phase: 1,
            me: Some(me),
            ..
        } = next(ws).await
        {
            return me.x;
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn http_claim_hosted_resume_match_spool_and_reopened_owner_profile_agree() {
    tokio::time::timeout(Duration::from_secs(30), account_flow())
        .await
        .expect("complete local account flow within 30 seconds");
}

async fn account_flow() {
    let admin_options = PgConnectOptions::from_str(
        &std::env::var("DATABASE_URL").expect("private PostgreSQL required"),
    )
    .unwrap();
    let db = format!("rh_account_flow_{}", Uuid::new_v4().simple());
    let mut admin = PgConnection::connect_with(&admin_options).await.unwrap();
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(&mut admin)
        .await
        .unwrap();
    let url = admin_options
        .clone()
        .database(&db)
        .to_url_lossy()
        .to_string();
    let store = Arc::new(Store::connect(&url).await.unwrap());
    store.migrate().await.unwrap();
    let spool_dir: PathBuf =
        std::env::temp_dir().join(format!("rh-account-flow-{}", Uuid::new_v4()));
    let svc = Service::start(store.clone(), &spool_dir).await;

    let alice_token = svc.claim("alice").await;
    let bob_token = svc.claim("bob").await;
    // Prime the empty leaderboard cache before the room's writer credits GV through its independent store clone.
    let board_before = http::get(
        svc.public,
        "/api/leaderboard?name=alice",
        &[("x-profile-token", &alice_token)],
    )
    .await;
    assert_eq!(board_before.status, 200);
    assert_eq!(board_before.json()["entries"], json!([]));
    assert!(board_before.json().get("you").is_none());
    for presented in [None, Some(bob_token.as_str())] {
        let headers: Vec<_> = presented
            .map(|t| vec![("x-profile-token", t)])
            .unwrap_or_default();
        assert_eq!(
            http::get(svc.public, "/api/profile/alice", &headers)
                .await
                .status,
            403
        );
    }
    // Operator API is distinct from the public account listener, and a control reservation cannot bypass token auth.
    assert_eq!(
        http::get(svc.public, "/control/rooms", &[]).await.status,
        404
    );
    assert_eq!(
        http::get(svc.control, "/control/rooms", &[]).await.status,
        401
    );
    let (_, unreserved) = svc.connect("alice", &alice_token, None).await;
    assert!(matches!(
        unreserved,
        ServerMsg::Reject {
            code: RejectCode::BadCredentials,
            ..
        }
    ));
    svc.control(
        "/control/session",
        json!({"v":1,"gameSessionId":"account-match"}),
    )
    .await;
    svc.reserve("account-match", "alice-seat", "alice").await;
    svc.reserve("account-match", "bob-seat", "bob").await;
    let (_, wrong) = svc.connect("alice", &bob_token, None).await;
    assert!(matches!(
        wrong,
        ServerMsg::Reject {
            code: RejectCode::BadCredentials,
            ..
        }
    ));
    let (alice, welcome) = svc.connect("alice", &alice_token, None).await;
    let session = match welcome {
        ServerMsg::Welcome { session, .. } => session,
        _ => panic!("HTTP-issued owner credential must admit"),
    };
    // A fresh Hello cannot consume an already seated reservation or acquire a second lease.
    let (_, duplicate) = svc.connect("alice", &alice_token, None).await;
    assert!(matches!(
        duplicate,
        ServerMsg::Reject {
            code: RejectCode::BadCredentials,
            ..
        }
    ));
    let before: (i64, i64) = sqlx::query_as("SELECT profile_id,fence FROM session_leases WHERE profile_id=(SELECT profile_id FROM profiles WHERE callsign='alice')").fetch_one(store.pool()).await.unwrap();
    assert_eq!(before.1, 1);
    drop(alice); // Transport disconnect, without Leave: the original seat remains resumable inside the grace.
    svc.wait_status("account-match", "alice-seat", "away").await;
    let (mut alice, resumed) = svc.connect("alice", &alice_token, Some(session)).await;
    assert!(matches!(resumed, ServerMsg::Welcome { session: s, .. } if s == session));
    let after: (i64, i64) =
        sqlx::query_as("SELECT profile_id,fence FROM session_leases WHERE profile_id=$1")
            .bind(before.0)
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(before, after, "resume retains principal and original fence");
    svc.wait_status("account-match", "alice-seat", "seated")
        .await;
    let (mut bob, welcome) = svc.connect("bob", &bob_token, None).await;
    assert!(matches!(welcome, ServerMsg::Welcome { .. }));
    let (ax, bx) = tokio::join!(active_x(&mut alice), active_x(&mut bob));
    for (ws, a) in [
        (&mut alice, if bx > ax { 0.0 } else { std::f32::consts::PI }),
        (&mut bob, if ax > bx { 0.0 } else { std::f32::consts::PI }),
    ] {
        ws.socket
            .send(Message::Binary(
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
    let results = async |ws: &mut Peer| loop {
        if let ServerMsg::Events { events, .. } = next(ws).await {
            if let Some(WireEvent::Result(r)) = events
                .into_iter()
                .find(|e| matches!(e, WireEvent::Result(_)))
            {
                return r;
            }
        }
    };
    let (alice_result, bob_result) = tokio::join!(results(&mut alice), results(&mut bob));
    assert_eq!(
        alice_result.gv_total + bob_result.gv_total,
        10,
        "actual wire results bank one kill, below qualified-win threshold"
    );
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM match_results")
            .fetch_one(store.pool())
            .await
            .unwrap();
        if count == 2 && svc.spool.stats().pending == 0 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "both real results commit and spool drains"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(svc.spool.stats().spooled_total, 2);
    let alice_profile = svc.profile("alice", &alice_token).await;
    let bob_profile = svc.profile("bob", &bob_token).await;
    for (profile, result) in [(&alice_profile, &alice_result), (&bob_profile, &bob_result)] {
        assert_eq!(profile["stats"]["runs"], 1);
        assert_eq!(profile["gv"], result.gv_total);
        assert_eq!(profile["gvLifetime"], result.gv_total);
    }
    let (earner, earner_token) = if alice_result.gv_total > 0 {
        ("alice", &alice_token)
    } else {
        ("bob", &bob_token)
    };
    let board = http::get(
        svc.public,
        &format!("/api/leaderboard?name={earner}"),
        &[("x-profile-token", earner_token)],
    )
    .await;
    assert_eq!(board.status, 200);
    assert!(
        board.json()["you"].is_object(),
        "authenticated owner rank is published"
    );
    assert_eq!(board.json()["you"]["gv"], 10);
    assert_eq!(board.json()["entries"][0]["name"], earner);
    let private_rank = http::get(
        svc.public,
        &format!("/api/leaderboard?name={earner}"),
        &[("x-profile-token", "invalid-disposable-token")],
    )
    .await;
    assert_eq!(private_rank.status, 200);
    assert!(private_rank.json().get("you").is_none());
    assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());
    let live: i64 =
        sqlx::query_scalar("SELECT count(*) FROM session_leases WHERE expires_at>now()")
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(live, 0, "committed result transactions release both leases");

    // Retry the exact committed document after its lease was released: the same key remains AlreadyApplied.
    let (match_id, profile_id, fence, doc): (Uuid, i64, i64, Value) = sqlx::query_as(
        "SELECT match_id,profile_id,fence,result FROM match_results WHERE profile_id=$1",
    )
    .bind(before.0)
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(
        fence, before.1,
        "the original resumed seat's fence owns its durable result"
    );
    let stored: StoredResult = serde_json::from_value(doc).unwrap();
    assert_eq!(stored.v, rh_persist::RESULT_VERSION);
    assert_eq!(stored.result.gv.total, i64::from(alice_result.gv_total));
    assert_eq!(stored.result.kills, i64::from(alice_result.kills));
    assert!(matches!(
        store
            .record_result_by_id(
                match_id,
                profile_id,
                fence,
                &stored.result,
                &rh_persist::MatchMeta::unknown()
            )
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    ));
    assert_eq!(svc.profile("alice", &alice_token).await, alice_profile);
    assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());
    drop(alice);
    drop(bob);
    svc.stop();
    store.pool().close().await;
    let reopened = Arc::new(Store::connect(&url).await.unwrap());
    let svc = Service::start(reopened.clone(), &spool_dir).await;
    assert_eq!(svc.profile("alice", &alice_token).await, alice_profile);
    assert_eq!(svc.profile("bob", &bob_token).await, bob_profile);
    let reopened_board = http::get(
        svc.public,
        &format!("/api/leaderboard?name={earner}"),
        &[("x-profile-token", earner_token)],
    )
    .await;
    assert_eq!(reopened_board.status, 200);
    assert_eq!(reopened_board.json(), board.json());
    assert_eq!(svc.spool.stats().pending, 0);
    assert_eq!(svc.director.recover_spooled(), 0);
    assert!(rh_persist::admin::reconcile(&reopened).await.unwrap().ok());
    svc.stop();
    reopened.pool().close().await;
    sqlx::query(&format!("DROP DATABASE {db} WITH (FORCE)"))
        .execute(&mut admin)
        .await
        .unwrap();
    std::fs::remove_dir_all(spool_dir).unwrap();
}
