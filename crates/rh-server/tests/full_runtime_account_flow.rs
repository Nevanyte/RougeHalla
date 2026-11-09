//! HTTP-owned credentials through full Source planning/combat/results/spool and durable owner reads.
//! Explicit durable-cluster proof; all gameplay decisions consume delivered public facts only.
#![cfg(feature = "postgres")]

#[path = "support/http.rs"]
mod http;

use futures_util::{SinkExt, StreamExt};
use rh_persist::{RecordOutcome, Store, StoredResult};
use rh_protocol::{ClientMsg, RejectCode, ServerMsg, SnapshotTracker, WireCommand, WireEvent};
use rh_protocol::{StateItem, WireResult};
use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_server::runtime::Settings;
use rh_server::spool::{ResultSpool, SpoolConfig};
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
        let args = vec![
            "--runtime".into(),
            "source-arena".into(),
            "--map".into(),
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../maps/first-playable.json"
            )
            .into(),
        ];
        let settings = Settings::from_args(&args).unwrap().unwrap();
        let sim = settings.sim();
        assert!(
            matches!(&sim.lifecycle,rh_sim::ArenaMode::Source(r) if *r==rh_sim::ArenaRules::default())
        );
        assert!(sim.quests && sim.regen && sim.initial_loot && sim.faction_mode.fire_roam());
        let cfg = DirectorConfig {
            require_admit: true,
            // Wall-clock pacing only. Each native step and all public clocks remain exactly 50 ms.
            tick: Duration::from_millis(3),
            record: true,
            ..DirectorConfig::new(sim, settings.arena().unwrap())
        };
        let spool = ResultSpool::open(spool_dir, SpoolConfig::default()).unwrap();
        let lifecycle = Arc::new(Lifecycle::default());
        let director = Director::new_with_spool(
            cfg,
            Arc::new(Persistence::postgres(
                store.clone(),
                "full-runtime-account-flow".into(),
            )),
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
            build: "full-runtime-account-flow".into(),
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

#[derive(Default)]
struct PlayAudit {
    phases: std::collections::BTreeSet<u8>,
    snapshots: u32,
    commands: u32,
    attacks: u32,
    visible_human_samples: u32,
    last_tick: u32,
    result: Option<WireResult>,
    result_tick: Option<u32>,
}

async fn play_with_map(name: &str, mut peer: Peer, map: rh_protocol::map::MapBlob) -> PlayAudit {
    let mut audit = PlayAudit::default();
    let regions = map.regions.as_ref().expect("Source public regions");
    let cells = regions
        .iter()
        .enumerate()
        .filter(|(i, r)| **r == 6 && map.tiles[*i] == 0)
        .map(|(i, _)| {
            (
                (i % usize::from(map.w)) as f32 * 32. + 16.,
                (i / usize::from(map.w)) as f32 * 32. + 16.,
            )
        })
        .collect::<Vec<_>>();
    let cx = cells.iter().map(|p| p.0).sum::<f32>() / cells.len() as f32;
    let cy = cells.iter().map(|p| p.1).sum::<f32>() / cells.len() as f32;
    let rendezvous = cells
        .into_iter()
        .min_by(|a, b| ((a.0 - cx).hypot(a.1 - cy)).total_cmp(&(b.0 - cx).hypot(b.1 - cy)));
    let mut seq = 0u32;
    let mut move_seq = 0u8;
    let mut acted_at = 0;
    let mut ready = false;
    let mut moved = false;
    let started = std::time::Instant::now();
    loop {
        let message = next(&mut peer).await;
        let mut commands = Vec::new();
        match message {
            ServerMsg::State { items, .. } => {
                for item in items {
                    if let StateItem::Plan(Some(plan)) = item {
                        if !ready {
                            let pick = (0..2).find(|i| !plan.taken[*i]).map(|i| i as u8);
                            commands.push(WireCommand::Plan {
                                spawn: pick,
                                boon: None,
                                ready: Some(true),
                            });
                            ready = true;
                        }
                    }
                }
            }
            ServerMsg::Snapshot {
                tick,
                server_time,
                phase,
                training,
                me,
                actors,
                ..
            } => {
                assert!(!training);
                assert_eq!(
                    server_time,
                    f64::from(tick) * 50.,
                    "one native 20Hz clock throughout Source lifecycle"
                );
                audit.phases.insert(phase);
                audit.snapshots += 1;
                audit.last_tick = tick;
                if audit.snapshots % 100 == 0 {
                    let trace = json!({"name":name,"tick":tick,"server_time":server_time,"phase":phase,"snapshots":audit.snapshots,"commands":audit.commands,"attack_commands":audit.attacks,"visible_human_samples":audit.visible_human_samples,"owner":me.as_ref().map(|m|json!({"x":m.x,"y":m.y,"hp":m.hp,"status":m.status})),"visible_humans":actors.iter().filter(|a|a.kind==0).map(|a|json!({"x":a.x,"y":a.y,"hp_pct":a.hp_pct,"status":a.status})).collect::<Vec<_>>()});
                    let path = PathBuf::from(std::env::var("RH_FULL_RUNTIME_STATE").unwrap())
                        .join(format!("{name}-public-progress.json"));
                    std::fs::write(path, serde_json::to_vec_pretty(&trace).unwrap()).unwrap();
                }

                if phase == 1 && tick >= acted_at + 12 {
                    acted_at = tick;
                    if let Some(me) = me {
                        if let Some(enemy) = actors.iter().find(|a| a.kind == 0 && a.status == 1) {
                            audit.visible_human_samples += 1;
                            let distance = (enemy.x - me.x).hypot(enemy.y - me.y);
                            if distance <= 48. {
                                if moved {
                                    commands.push(WireCommand::Stop {
                                        seq: Some(move_seq),
                                    });
                                    moved = false;
                                }
                            } else {
                                move_seq = move_seq.wrapping_add(1);
                                commands.push(WireCommand::Move {
                                    x: enemy.x,
                                    y: enemy.y,
                                    seq: Some(move_seq),
                                });
                                moved = true;
                            }
                            // Holding a manual attack while approaching is an ordinary public input. Do not wait for
                            // a sparse navigation sample to fall inside melee reach before pressing the trigger.
                            commands.push(WireCommand::Attack {
                                a: (enemy.y - me.y).atan2(enemy.x - me.x),
                                t: None,
                            });
                            audit.attacks += 1;
                        } else {
                            let (x, y) = rendezvous.expect("public coliseum floor");
                            move_seq = move_seq.wrapping_add(1);
                            commands.push(WireCommand::Move {
                                x,
                                y,
                                seq: Some(move_seq),
                            });
                            moved = true;
                        }
                    }
                }
            }
            ServerMsg::Events { tick, events } => {
                for event in events {
                    if let WireEvent::Result(result) = event {
                        audit.result = Some(result);
                        audit.result_tick = Some(tick);
                        return audit;
                    }
                }
            }
            ServerMsg::Reject { code, reason } => {
                panic!("ordinary public play rejected: {code:?}: {reason}")
            }
            _ => {}
        }
        if !commands.is_empty() {
            seq += 1;
            audit.commands += commands.len() as u32;
            peer.socket
                .send(Message::Binary(
                    ClientMsg::Input { seq, commands }.encode().into(),
                ))
                .await
                .unwrap();
        }
        assert!(
            started.elapsed() < Duration::from_secs(45),
            "public Source play completed with ordinary combat within bounded setup"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires disposable durable PostgreSQL; run tools/full-runtime-account-proof/proof.py"]
async fn http_owned_source_match_spool_profile_and_leaderboard_agree() {
    tokio::time::timeout(Duration::from_secs(70), account_flow())
        .await
        .expect("bounded full Source account bridge");
}

async fn account_flow() {
    let admin_options = PgConnectOptions::from_str(
        &std::env::var("DATABASE_URL").expect("private PostgreSQL required"),
    )
    .unwrap();
    let db = format!("rh_full_runtime_{}", Uuid::new_v4().simple());
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
    let state = PathBuf::from(
        std::env::var("RH_FULL_RUNTIME_STATE").expect("proof runner supplies private task state"),
    );
    let spool_dir = state.join("spool");
    let settings:(String,String,String)=sqlx::query_as("SELECT current_setting('fsync'),current_setting('synchronous_commit'),current_setting('full_page_writes')").fetch_one(store.pool()).await.unwrap();
    assert_eq!(
        settings,
        ("on".into(), "on".into(), "on".into()),
        "durable cluster required"
    );
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
    let (alice, resumed) = svc.connect("alice", &alice_token, Some(session)).await;
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
    let (bob, bob_welcome) = svc.connect("bob", &bob_token, None).await;
    assert!(matches!(bob_welcome, ServerMsg::Welcome { .. }));
    // The Welcome is an actual encoded/decoded public frame. Feed it back to each peer's driver as retained client data.
    let alice_map = match resumed {
        ServerMsg::Welcome { map, .. } => map,
        _ => unreachable!(),
    };
    let bob_map = match bob_welcome {
        ServerMsg::Welcome { map, .. } => map,
        _ => unreachable!(),
    };
    let (alice_audit, bob_audit) = tokio::join!(
        play_with_map("alice", alice, alice_map),
        play_with_map("bob", bob, bob_map)
    );
    for audit in [&alice_audit, &bob_audit] {
        assert!(
            audit.phases.contains(&3) && audit.phases.contains(&1),
            "real Planning then Active observed"
        );
        assert!(
            audit.attacks > 0 && audit.visible_human_samples > 0,
            "ordinary public combat was attempted"
        );
    }
    let alice_result = alice_audit.result.as_ref().unwrap();
    let bob_result = bob_audit.result.as_ref().unwrap();
    assert!(
        alice_result.kills + bob_result.kills > 0,
        "a genuine native combat kill required"
    );
    assert!(
        alice_result.gv_total + bob_result.gv_total > 0,
        "genuine positive native award required"
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
    let close_deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while svc.director.room_count() != 0 {
        assert!(
            tokio::time::Instant::now() < close_deadline,
            "normal Source result linger closes room"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let replays = svc.director.take_replays();
    assert_eq!(replays.len(), 1);
    let replay = &replays[0];
    assert!(
        matches!(&replay.config.lifecycle,rh_sim::ArenaMode::Source(r) if *r==rh_sim::ArenaRules::default())
    );
    let (replayed, _) = rh_sim::replay::run_replay(replay)
        .expect("entire genuine same-clock replay verifies every hash");
    assert_eq!(replayed.phase(), rh_sim::Phase::Ended);
    std::fs::write(
        state.join("private-replay.json"),
        serde_json::to_vec(replay).unwrap(),
    )
    .unwrap();
    let alice_profile = svc.profile("alice", &alice_token).await;
    let bob_profile = svc.profile("bob", &bob_token).await;
    for (profile, result) in [(&alice_profile, alice_result), (&bob_profile, bob_result)] {
        assert_eq!(profile["stats"]["runs"], 1);
        assert_eq!(profile["stats"]["kills"], result.kills);
        assert_eq!(profile["stats"]["wins"], u8::from(result.outcome == 0));
        assert_eq!(profile["stats"]["draws"], u8::from(result.outcome == 1));
        assert_eq!(profile["stats"]["deaths"], u8::from(result.outcome == 2));
        assert_eq!(profile["gv"], result.gv_total);
        assert_eq!(profile["gvLifetime"], result.gv_total);
    }
    let (earner, earner_token) = if alice_result.gv_total >= bob_result.gv_total {
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
    let earned = alice_result.gv_total.max(bob_result.gv_total);
    assert_eq!(board.json()["you"]["gv"], earned);
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
    let outsider_token = svc.claim("outsider").await;
    let outsider_before = svc.profile("outsider", &outsider_token).await;
    let outsider_id: i64 =
        sqlx::query_scalar("SELECT profile_id FROM profiles WHERE callsign='outsider'")
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert!(
        matches!(
            store
                .record_result_by_id(
                    match_id,
                    outsider_id,
                    fence,
                    &stored.result,
                    &rh_persist::MatchMeta::unknown()
                )
                .await
                .unwrap(),
            RecordOutcome::NoLease
        ),
        "genuine result cannot credit a principal that never owned a seat"
    );
    assert_eq!(
        svc.profile("outsider", &outsider_token).await,
        outsider_before
    );
    assert_eq!(svc.profile("alice", &alice_token).await, alice_profile);
    assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());

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
    let receipt = json!({"source_base":"a0c4818ce9df8ad0f4124db31e65ba1244bddc3b","build":rh_sim::replay::BUILD_ID,"protocol":rh_protocol::PROTOCOL_VERSION,"full_source_default_rules":true,"map":"unchanged maps/first-playable.json","clock":"native 50ms steps; accelerated 3ms wall-clock wake, real loopback HTTP/WebSocket and PostgreSQL","replay_steps":replay.hashes.len(),"replay_hashes":"all verified","replay_terminal_phase":"Ended","wire_results":[{"name":"alice","gv":alice_result.gv_total,"kills":alice_result.kills,"outcome":alice_result.outcome,"duration_sec":alice_result.duration_sec,"result_tick":alice_audit.result_tick},{"name":"bob","gv":bob_result.gv_total,"kills":bob_result.kills,"outcome":bob_result.outcome,"duration_sec":bob_result.duration_sec,"result_tick":bob_audit.result_tick}],"public_snapshots":[alice_audit.snapshots,bob_audit.snapshots],"public_attack_commands":[alice_audit.attacks,bob_audit.attacks],"profiles":[alice_profile,bob_profile],"spooled":2,"pending":0,"duplicate_result":"AlreadyApplied; owner unchanged","wrong_principal":"NoLease; outsider unchanged","reconciliation":"ok","reopened_owner_profiles_and_board":"equal","physical_time_or_browser_acceptance":false});
    std::fs::write(
        state.join("receipt.json"),
        serde_json::to_vec_pretty(&receipt).unwrap(),
    )
    .unwrap();
    println!("full Source account bridge PASS; redacted receipt retained by proof runner");
    svc.stop();
    reopened.pool().close().await;
    sqlx::query(&format!("DROP DATABASE {db} WITH (FORCE)"))
        .execute(&mut admin)
        .await
        .unwrap();
    // Task-owned data/replay remain private for audit; runner stops the owned cluster.
}
