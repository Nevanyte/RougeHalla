//! Phases run ONLY by tools/backup-restore-proof/proof.py, in separate OS processes.
//! HTTP credentials and ordinary hosted combat produce all progression and pending spool records.
#![cfg(feature = "postgres")]

#[path = "support/http.rs"]
mod http;

use futures_util::{SinkExt, StreamExt};
use rh_persist::{RecordOutcome, Store, StoredResult};
use rh_protocol::{ClientMsg, ServerMsg, SnapshotTracker, WireCommand, WireEvent};
use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_server::spool::{ResultSpool, SpoolConfig};
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use serde_json::{json, Value};
use sqlx::{Connection, PgConnection};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
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
            Arc::new(Persistence::postgres(
                store.clone(),
                "cold-restore-source".into(),
            )),
            Arc::new(Auth::Postgres(store.clone())),
            lifecycle.clone(),
            spool.clone(),
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
            build: "cold-restore-source".into(),
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

// Private receipts never enter Git or stdout. A phase exits before another process starts the recovered service.
fn root() -> PathBuf {
    std::env::var_os("RH_BACKUP_STATE")
        .expect("proof orchestrator required")
        .into()
}
fn read(name: &str) -> Value {
    serde_json::from_slice(&std::fs::read(root().join(name)).unwrap()).unwrap()
}
fn save(name: &str, value: &Value) {
    std::fs::write(root().join(name), serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

async fn guard() {
    let url = std::env::var("DATABASE_URL").expect("task-owned database required");
    let mut conn = PgConnection::connect(&url)
        .await
        .expect("connect task database");
    let identity: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('system_identifier',system_identifier::text,
         'data_directory',current_setting('data_directory'),'port',inet_server_port(),
         'address',host(inet_server_addr()),'database',current_database(),
         'fsync',current_setting('fsync'),'synchronous_commit',current_setting('synchronous_commit'),
         'full_page_writes',current_setting('full_page_writes')) FROM pg_control_system()",
    ).fetch_one(&mut conn).await.unwrap();
    let expected = read(&std::env::var("RH_EXPECTED_IDENTITY").unwrap());
    assert!(
        identity == expected,
        "CLUSTER_IDENTITY_MISMATCH: refusing application construction"
    );
    for setting in ["fsync", "synchronous_commit", "full_page_writes"] {
        assert_eq!(identity[setting], "on", "durable setting {setting}");
    }
    assert_eq!(identity["address"], "127.0.0.1");
    assert_eq!(identity["database"], "rh_backup");
}

async fn snapshot(store: &Store) -> Value {
    // Complete rows, including credential hashes, timestamps, result envelopes, monthly totals and leases.
    // Stable row ordering avoids depending on a restored heap's physical layout.
    let mut out = serde_json::Map::new();
    for table in [
        "profiles",
        "session_leases",
        "matches",
        "match_results",
        "gv_ledger",
        "gv_by_month",
        "purchases",
        "schema_compat",
        "bot_learning_baseline",
        "bot_learning_entries",
        "_sqlx_migrations",
    ] {
        let value: Value = sqlx::query_scalar(&format!(
            "SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) FROM (SELECT to_jsonb(t) AS row FROM {table} t) q"
        )).fetch_one(store.pool()).await.unwrap();
        out.insert(table.into(), value);
    }
    let seq: Value = sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY sequencename) FROM (SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public') s")
        .fetch_one(store.pool()).await.unwrap();
    out.insert("sequences".into(), seq);
    Value::Object(out)
}

async fn wait_for(what: &str, mut ready: impl AsyncFnMut() -> bool) {
    let end = tokio::time::Instant::now() + Duration::from_secs(15);
    while !ready().await {
        assert!(tokio::time::Instant::now() < end, "timed out: {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn count(store: &Store, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
        .fetch_one(store.pool())
        .await
        .unwrap()
}

async fn play(svc: &Service, names: [&str; 2], tokens: [&str; 2], pending: bool) -> Value {
    let room = names[0];
    svc.control("/control/session", json!({"v":1,"gameSessionId":room}))
        .await;
    for name in names {
        svc.reserve(room, name, name).await;
    }
    let (mut a, w) = svc.connect(names[0], tokens[0], None).await;
    assert!(
        matches!(w, ServerMsg::Welcome { .. }),
        "HTTP owner admitted"
    );
    let (mut b, w) = svc.connect(names[1], tokens[1], None).await;
    assert!(
        matches!(w, ServerMsg::Welcome { .. }),
        "HTTP owner admitted"
    );
    let (ax, bx) = tokio::join!(active_x(&mut a), active_x(&mut b));
    if pending {
        std::fs::write(root().join("ready-to-lock"), b"ready").unwrap();
        wait_for("external lease locks", async || {
            root().join("locked").exists()
        })
        .await;
    }
    for (peer, angle) in [
        (&mut a, if bx > ax { 0.0 } else { std::f32::consts::PI }),
        (&mut b, if ax > bx { 0.0 } else { std::f32::consts::PI }),
    ] {
        peer.socket
            .send(Message::Binary(
                ClientMsg::Input {
                    seq: 1,
                    commands: vec![WireCommand::Attack { a: angle, t: None }],
                }
                .encode()
                .into(),
            ))
            .await
            .unwrap();
    }
    let result = async |peer: &mut Peer| loop {
        if let ServerMsg::Events { events, .. } = next(peer).await {
            if let Some(WireEvent::Result(r)) = events
                .into_iter()
                .find(|e| matches!(e, WireEvent::Result(_)))
            {
                return r;
            }
        }
    };
    let (ra, rb) = tokio::join!(result(&mut a), result(&mut b));
    assert_eq!(
        ra.gv_total + rb.gv_total,
        10,
        "ordinary combat produces exactly one kill reward"
    );
    assert_eq!(ra.kills + rb.kills, 1);
    let mut out = serde_json::Map::new();
    for (name, r) in [(names[0], ra), (names[1], rb)] {
        out.insert(
            name.into(),
            json!({"gv":r.gv_total,"kills":r.kills,"outcome":r.outcome}),
        );
    }
    Value::Object(out)
}

fn pending_records(dir: &Path) -> Vec<rh_server::spool::SpoolRecord> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|s| s == "rec") {
            let name = path.file_name().unwrap().to_str().unwrap();
            out.push(rh_server::spool::decode(&std::fs::read(&path).unwrap(), Some(name)).unwrap());
        }
    }
    out.sort_by_key(|r| r.profile_id);
    out
}

async fn source(store: Arc<Store>) {
    store.migrate().await.unwrap();
    let svc = Service::start(store.clone(), &root().join("source-spool")).await;
    let mut accounts = serde_json::Map::new();
    for name in ["alice", "bob", "carol", "dave"] {
        accounts.insert(name.into(), json!({"token":svc.claim(name).await}));
    }
    let mut wire = play(
        &svc,
        ["alice", "bob"],
        [
            accounts["alice"]["token"].as_str().unwrap(),
            accounts["bob"]["token"].as_str().unwrap(),
        ],
        false,
    )
    .await;
    wait_for("committed first match", async || {
        count(&store, "match_results").await == 2
            && svc.spool.stats().pending == 0
            && svc.director.result_metrics()["committed"] == 2
    })
    .await;
    let other = play(
        &svc,
        ["carol", "dave"],
        [
            accounts["carol"]["token"].as_str().unwrap(),
            accounts["dave"]["token"].as_str().unwrap(),
        ],
        true,
    )
    .await;
    wire.as_object_mut()
        .unwrap()
        .extend(other.as_object().unwrap().clone());
    wait_for("real pending spool", async || {
        svc.spool.stats().pending == 2 && svc.spool.stats().spooled_total == 4
    })
    .await;
    assert_eq!(count(&store, "match_results").await, 2);
    let records = pending_records(&root().join("source-spool"));
    assert_eq!(records.len(), 2);
    for rec in &records {
        assert!(rec.profile == "carol" || rec.profile == "dave");
        assert_eq!(rec.result.gv.total, wire[&rec.profile]["gv"]);
        assert_eq!(rec.result.kills, wire[&rec.profile]["kills"]);
    }
    for (name, account) in accounts.iter_mut() {
        account["profile"] = svc.profile(name, account["token"].as_str().unwrap()).await;
        assert_eq!(
            account["profile"]["stats"]["runs"],
            if name == "alice" || name == "bob" {
                1
            } else {
                0
            }
        );
    }
    assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());
    save(
        "private-state.json",
        &json!({"accounts":accounts,"wire":wire}),
    );
    save("boundary.json", &snapshot(&store).await);
    let stats = svc.spool.stats();
    assert_eq!(stats.full_total, 0);
    assert_eq!(stats.io_errors_total, 0);
    assert_eq!(stats.dead, 0);
    save(
        "producer.json",
        &json!({"spooled":stats.spooled_total,"committed":svc.director.result_metrics()["committed"],
        "pending":stats.pending,"spool_errors":stats.io_errors_total,"spool_full":stats.full_total,"dead":stats.dead}),
    );
    println!("SOURCE_BOUNDARY spooled=4 committed=2 pending=2 spool_errors=0 spool_full=0 dead=0");
    std::fs::write(
        root().join("source-ready"),
        b"two committed; two genuinely spooled; kill while locks held",
    )
    .unwrap();
    // The orchestrator SIGKILLs this application process while a separate psql process still owns the row locks.
    // No lock-drop/result-COMMIT race is permitted at this boundary.
    std::future::pending::<()>().await;
}

async fn credentials(svc: &Service, accounts: &Value, boundary: bool) {
    for (name, account) in accounts.as_object().unwrap() {
        for token in [
            None,
            Some("wrong-disposable-credential"),
            Some(
                accounts[if name == "alice" { "bob" } else { "alice" }]["token"]
                    .as_str()
                    .unwrap(),
            ),
        ] {
            let h: Vec<_> = token
                .map(|t| vec![("x-profile-token", t)])
                .unwrap_or_default();
            let r = http::get(svc.public, &format!("/api/profile/{name}"), &h).await;
            assert_eq!(r.status, 403, "missing/wrong owner rejected");
        }
        let profile = svc.profile(name, account["token"].as_str().unwrap()).await;
        if boundary {
            assert!(
                profile == account["profile"],
                "authenticated boundary profile preserved"
            );
        }
    }
}

async fn verify(store: Arc<Store>) {
    assert!(
        snapshot(&store).await == read("boundary.json"),
        "complete database boundary, including sequence values, survives pg_restore"
    );
    let state = read("private-state.json");
    let accounts = &state["accounts"];
    let records = pending_records(&root().join("recovered-spool"));
    assert_eq!(
        records.len(),
        2,
        "REQUIRED_PENDING_ARTIFACTS: two genuine records must exist before recovery"
    );
    let svc = Service::start(store.clone(), &root().join("recovered-spool")).await;
    credentials(&svc, accounts, true).await;
    // Probe competing acquisition only while the restored lease is unexpired. A saved bundle can be older than
    // the TTL: admission then could legitimately take over, so the recovery verifier must not create that race.
    let mut live_pending_leases_verified = 0;
    for rec in &records {
        let live: bool = sqlx::query_scalar(
            "SELECT expires_at > clock_timestamp() FROM session_leases WHERE profile_id=$1",
        )
        .bind(rec.profile_id)
        .fetch_one(store.pool())
        .await
        .unwrap();
        if live {
            assert!(matches!(
                store
                    .acquire_lease(
                        &rec.profile,
                        Uuid::new_v4(),
                        "competing-writer",
                        Duration::from_secs(60)
                    )
                    .await,
                Err(rh_persist::Error::LeaseHeld { .. })
            ));
            live_pending_leases_verified += 1;
        }
    }
    if std::env::var("RH_REQUIRE_LIVE_PENDING_LEASES").as_deref() == Ok("1") {
        assert_eq!(
            live_pending_leases_verified, 2,
            "fresh full proof must exercise both pending lease exclusions"
        );
    }
    assert_eq!(svc.director.recover_spooled(), 2);
    wait_for("pending recovery completes", async || {
        count(&store, "match_results").await == 4
            && svc.spool.stats().pending == 0
            && svc.director.result_metrics()["recovered"] == 2
    })
    .await;
    assert_eq!(svc.spool.stats().dead, 0);
    let mut original_ended_at = BTreeMap::<Uuid, i64>::new();
    for rec in &records {
        let original_match = rec.match_uuid().unwrap();
        let (match_id, profile_id, fence, callsign, doc): (Uuid, i64, i64, String, Value) =
            sqlx::query_as(
                "SELECT r.match_id,r.profile_id,r.fence,p.callsign,r.result FROM match_results r
             JOIN profiles p USING(profile_id) WHERE r.match_id=$1 AND r.profile_id=$2",
            )
            .bind(original_match)
            .bind(rec.profile_id)
            .fetch_one(store.pool())
            .await
            .unwrap();
        assert_eq!(match_id, original_match, "original result match retained");
        assert_eq!(
            profile_id, rec.profile_id,
            "original result principal retained"
        );
        assert_eq!(fence, rec.fence, "original result fence retained");
        assert_eq!(callsign, rec.profile, "original profile identity retained");
        let stored: StoredResult = serde_json::from_value(doc).unwrap();
        assert_eq!(
            stored.v,
            rh_persist::RESULT_VERSION,
            "stored result version retained"
        );
        assert!(
            stored.result == rec.result,
            "full genuine pending result preserved"
        );
        type MetadataRow = (
            Uuid,
            String,
            Option<String>,
            Option<String>,
            String,
            i64,
            i32,
            i32,
            Option<String>,
        );
        let (match_id, owner, region, placement_id, build, hash, humans, bots, replay_ref): MetadataRow = sqlx::query_as(
            "SELECT match_id,owner,region,placement_id,build,content_hash,humans,bots,replay_ref
             FROM matches WHERE match_id=$1",
        ).bind(original_match).fetch_one(store.pool()).await.unwrap();
        assert_eq!(match_id, original_match, "original metadata match retained");
        assert_eq!(
            (
                owner,
                region,
                placement_id,
                build,
                hash as u64,
                humans,
                bots
            ),
            (
                rec.meta.owner.clone(),
                rec.meta.region.clone(),
                rec.meta.placement_id.clone(),
                rec.meta.build.clone(),
                rec.meta.content_hash,
                i32::try_from(rec.meta.humans).unwrap(),
                i32::try_from(rec.meta.bots).unwrap()
            ),
            "every original spool metadata field retained"
        );
        assert!(
            replay_ref.is_none(),
            "no replay reference was produced by this workload"
        );
        original_ended_at
            .entry(original_match)
            .and_modify(|latest| *latest = (*latest).max(rec.spooled_at_ms))
            .or_insert(rec.spooled_at_ms);
    }
    let mut max_ended_at_delta_ms = 0.0_f64;
    for (match_id, original_ms) in &original_ended_at {
        let ended: f64 = sqlx::query_scalar(
            "SELECT extract(epoch FROM ended_at)::float8*1000 FROM matches WHERE match_id=$1",
        )
        .bind(match_id)
        .fetch_one(store.pool())
        .await
        .unwrap();
        let delta_ms = (ended - *original_ms as f64).abs();
        // PostgreSQL timestamps resolve microseconds (0.001ms); float8 epoch milliseconds add under one more
        // microsecond at this epoch. Ten microseconds permits representation rounding, not a substituted result time.
        assert!(
            delta_ms <= 0.01,
            "match ended_at must equal the grouped maximum original spool time within0.01ms"
        );
        max_ended_at_delta_ms = max_ended_at_delta_ms.max(delta_ms);
    }
    save(
        "pending-recovery-audit.json",
        &json!({
            "complete_result_envelopes_verified":records.len(),
            "complete_metadata_records_verified":records.len(),
            "original_time_groups_verified":original_ended_at.len(),
            "original_time_tolerance_ms":0.01,"max_original_time_error_ms":max_ended_at_delta_ms,
            "timestamp_rule":"maximum original spooled_at_ms per match; per-record times need not be identical"
        }),
    );
    for (name, account) in accounts.as_object().unwrap() {
        let profile = svc.profile(name, account["token"].as_str().unwrap()).await;
        if name == "alice" || name == "bob" {
            assert!(
                profile == account["profile"],
                "previously committed profile unchanged"
            );
        }
        let outcome = state["wire"][name]["outcome"].as_u64().unwrap();
        assert!(
            outcome <= 2,
            "ordinary combat has a completed result, never MIA/void"
        );
        assert_eq!(
            profile["stats"],
            json!({"runs":1,"wins":u8::from(outcome==0),
            "draws":u8::from(outcome==1),"deaths":u8::from(outcome==2),
            "kills":state["wire"][name]["kills"]})
        );
        assert_eq!(profile["gv"], state["wire"][name]["gv"]);
        assert_eq!(profile["gvLifetime"], state["wire"][name]["gv"]);
        assert_eq!(profile["stats"]["kills"], state["wire"][name]["kills"]);
    }
    let live: i64 =
        sqlx::query_scalar("SELECT count(*) FROM session_leases WHERE released_at IS NULL")
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(live, 0, "all genuine result commits released their leases");
    assert_eq!(
        count(&store, "gv_ledger").await,
        2,
        "exactly one paid kill per match"
    );
    let report = rh_persist::admin::reconcile(&store).await.unwrap();
    assert!(report.ok());
    assert_eq!(report.total_gv, 20);
    assert_eq!(report.total_ledger, 20);
    assert_eq!(report.month_lifetime_gaps, 0);
    assert_eq!(report.live_leases, 0);
    let recovered = snapshot(&store).await;
    save("recovered-boundary.json", &recovered);
    // Retry EVERY exact genuine result, under its original match/id/fence, after cold recovery.
    let rows: Vec<(Uuid, i64, i64, Value)> = sqlx::query_as(
        "SELECT match_id,profile_id,fence,result FROM match_results ORDER BY profile_id",
    )
    .fetch_all(store.pool())
    .await
    .unwrap();
    for (m, p, f, doc) in &rows {
        let stored: StoredResult = serde_json::from_value(doc.clone()).unwrap();
        assert!(matches!(
            store
                .record_result_by_id(
                    *m,
                    *p,
                    *f,
                    &stored.result,
                    &rh_persist::MatchMeta::unknown()
                )
                .await
                .unwrap(),
            RecordOutcome::AlreadyApplied
        ));
    }
    assert!(
        snapshot(&store).await == recovered,
        "duplicate retries change no balance, statistics, ledger, result, metadata or lease"
    );
    // Requeue the EXACT source spool bytes through the production recovery API too.
    for rec in &records {
        svc.spool.append(rec).unwrap();
        assert!(
            std::fs::read(root().join("backup/spool").join(rec.file_name())).unwrap()
                == std::fs::read(root().join("recovered-spool").join(rec.file_name())).unwrap(),
            "requeued bytes are the exact original genuine spool record"
        );
    }
    assert_eq!(svc.director.recover_spooled(), 2);
    wait_for("duplicate spool drained", async || {
        svc.spool.stats().pending == 0 && svc.director.result_metrics()["recovered"] == 4
    })
    .await;
    assert!(
        snapshot(&store).await == recovered,
        "duplicate spool replay changes no durable row"
    );
    save("duplicate-boundary.json", &snapshot(&store).await);
    // Existing lease APIs, no SQL mutations: a released fence advances; stale renew/release cannot affect successor.
    let rec = &records[0];
    let successor = store
        .acquire_lease(
            &rec.profile,
            Uuid::new_v4(),
            "recovered-writer",
            Duration::from_secs(60),
        )
        .await
        .unwrap();
    assert!(successor.fence > rec.fence);
    assert!(!store
        .renew_lease_by_id(rec.profile_id, rec.fence, Duration::from_secs(60))
        .await
        .unwrap());
    assert!(!store
        .release_lease_by_id(rec.profile_id, rec.fence)
        .await
        .unwrap());
    let before = snapshot(&store).await;
    assert!(matches!(
        store
            .record_result_by_id(
                rec.match_uuid().unwrap(),
                rec.profile_id,
                rec.fence,
                &rec.result,
                &rec.meta.to_persist()
            )
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    ));
    assert!(
        snapshot(&store).await == before,
        "old duplicate cannot release or mutate successor"
    );
    // A never-recorded key with the genuine result body and stale fence is refused before any award.
    assert!(matches!(
        store
            .record_result_by_id(
                Uuid::new_v4(),
                rec.profile_id,
                rec.fence,
                &rec.result,
                &rec.meta.to_persist()
            )
            .await
            .unwrap(),
        RecordOutcome::StaleFence
    ));
    assert!(
        snapshot(&store).await == before,
        "stale-fence refusal writes nothing"
    );
    assert!(store
        .renew_lease_by_id(
            successor.profile_id,
            successor.fence,
            Duration::from_secs(60)
        )
        .await
        .unwrap());
    assert!(store
        .release_lease_by_id(successor.profile_id, successor.fence)
        .await
        .unwrap());
    credentials(&svc, accounts, false).await;
    assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());
    save(
        "verified.json",
        &json!({"committed_results":4,"pending_recovered":2,"duplicate_store_retries":5,"duplicate_spool_replays":2,"profiles":4,"gv":20,"ledger_rows":2,"reconciliation":"ok","lease_fence":"successor protected; stale result refused","live_pending_leases_verified":live_pending_leases_verified,"pending_recovery_audit":read("pending-recovery-audit.json")}),
    );
    svc.stop();
    store.pool().close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the two durable disposable clusters and private artifacts from tools/backup-restore-proof/proof.py"]
async fn cold_backup_restore_phase() {
    guard().await;
    if std::env::var("RH_BACKUP_PHASE").unwrap() == "guard" {
        return;
    }
    let store = Arc::new(
        Store::connect(&std::env::var("DATABASE_URL").unwrap())
            .await
            .unwrap(),
    );
    match std::env::var("RH_BACKUP_PHASE").unwrap().as_str() {
        "source" => source(store).await,
        "boundary" => {
            assert!(
                snapshot(&store).await == read("boundary.json"),
                "source killed without post-boundary commit"
            );
            assert_eq!(count(&store, "match_results").await, 2);
            assert!(rh_persist::admin::reconcile(&store).await.unwrap().ok());
            save(
                "quiescent.json",
                &json!({"committed_results":2,"pending_results":2,"writers":0}),
            );
            store.pool().close().await;
        }
        "verify" => verify(store).await,
        _ => panic!("unknown proof phase"),
    }
}
