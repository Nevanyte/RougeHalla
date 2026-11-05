//! The control API (docs/hosting/CONTROL_API.md, section 7): sessions, admits, `--require-admit` admission, leave/kick/end,
//! drain, reconnect, and the listener boundary, against a real director with the production routers and real sockets.
//! The behaviours asserted by `hosting/glbridge/conformance_test.go` (the contract, against a fake) are reproduced here against
//! the real server; the test names say which.
// `Persistence` has one variant without the `postgres` feature.
#![allow(irrefutable_let_patterns)]

#[path = "support/http.rs"]
mod http;
#[path = "support/ws.rs"]
mod ws;

use http::{get, post_json, request, Resp};
use rh_protocol::RejectCode;
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_sim::SimConfig;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use ws::{try_join, Client};

const TICK: Duration = Duration::from_millis(50);
const GRACE: Duration = Duration::from_millis(1200);

fn token_of(callsign: &str) -> String {
    format!("secret-token-for-{callsign}")
}

struct Rig {
    director: Arc<Director>,
    lifecycle: Arc<Lifecycle>,
    public: SocketAddr,
    control: SocketAddr,
}

impl Rig {
    fn ws_url(&self) -> String {
        format!("ws://{}/ws", self.public)
    }
    async fn post(&self, path: &str, body: Value) -> Resp {
        post_json(self.control, path, &[], &body.to_string()).await
    }
    async fn rooms(&self) -> Value {
        let r = get(self.control, "/control/rooms", &[]).await;
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()
    }
    async fn room(&self, gsid: &str) -> Value {
        self.rooms().await["rooms"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["gameSessionId"] == gsid)
            .cloned()
            .unwrap_or_else(|| panic!("no room {gsid}"))
    }
    async fn player(&self, gsid: &str, psid: &str) -> Value {
        self.room(gsid).await["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["playerSessionId"] == psid)
            .cloned()
            .unwrap_or_else(|| panic!("no player {psid}"))
    }
    async fn create(&self, gsid: &str, props: Value) -> Resp {
        self.post(
            "/control/session",
            json!({"v":1,"gameSessionId":gsid,"properties":props}),
        )
        .await
    }
    async fn admit(&self, gsid: &str, psid: &str, callsign: &str) -> Resp {
        self.post(
            "/control/admit",
            json!({"v":1,"gameSessionId":gsid,"playerSessionId":psid,"callsign":callsign}),
        )
        .await
    }
    async fn leave(&self, gsid: &str, psid: &str, mode: &str) -> Resp {
        self.post(
            "/control/leave",
            json!({"v":1,"gameSessionId":gsid,"playerSessionId":psid,"mode":mode}),
        )
        .await
    }
    async fn end(&self, gsid: &str, mode: &str) -> Resp {
        self.post(
            "/control/end",
            json!({"v":1,"gameSessionId":gsid,"mode":mode}),
        )
        .await
    }
    async fn wait_player(&self, gsid: &str, psid: &str, status: &str) -> Value {
        for _ in 0..200 {
            let p = self.player(gsid, psid).await;
            if p["status"] == status {
                return p;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!(
            "{psid} never became {status}: {}",
            self.player(gsid, psid).await
        );
    }
    async fn wait_phase(&self, gsid: &str, phase: &str) -> Value {
        for _ in 0..200 {
            let r = self.room(gsid).await;
            if r["phase"] == phase {
                return r;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("{gsid} never reached {phase}: {}", self.room(gsid).await);
    }
}

struct Opts {
    require_admit: bool,
    max_rooms: usize,
    /// A lobby that starts its match 0.3 s after the first player (instead of waiting 30 s for a second one).
    quick_start: bool,
    token: Option<&'static str>,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            require_admit: true,
            max_rooms: 1,
            quick_start: false,
            token: None,
        }
    }
}

async fn rig(o: Opts) -> Rig {
    let sim = SimConfig {
        min_players: if o.quick_start { 1 } else { 2 },
        lobby_seconds: if o.quick_start { 0.3 } else { 30.0 },
        fill_seconds: 0.0,
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let mut cfg = DirectorConfig {
        tick: TICK,
        linger: Duration::from_millis(150),
        reconnect_grace: GRACE,
        max_rooms: o.max_rooms,
        ..DirectorConfig::new(sim, rh_sim::arenas::practice_arena())
    };
    cfg.require_admit = o.require_admit;
    let tokens: HashMap<String, String> = [
        "alice", "bob", "carol", "dave", "erin", "frank", "gina", "heidi", "ivan",
    ]
    .iter()
    .map(|c| (c.to_string(), token_of(c)))
    .collect();
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Static(tokens)),
        lifecycle.clone(),
    );
    // The two listeners, as main.rs serves them: the public router through `serve`, the control router on its own port.
    let app = rh_server::public_router(director.clone());
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    let public = handle.listening().await.expect("listening");
    let router = rh_server::control_router_with(
        director.clone(),
        rh_server::control::ControlOptions {
            token: o.token.map(Arc::from),
        },
    );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, router).await.unwrap() });
    lifecycle.ready();
    Rig {
        director,
        lifecycle,
        public,
        control,
    }
}

async fn join(r: &Rig, callsign: &str) -> Client {
    try_join(&r.ws_url(), callsign, &token_of(callsign), None)
        .await
        .unwrap_or_else(|e| panic!("{callsign} refused: {e:?}"))
}

fn code(resp: &Resp) -> String {
    resp.json()["error"]["code"]
        .as_str()
        .unwrap_or_else(|| panic!("no error code in {}", resp.body))
        .to_string()
}

fn wants(resp: &Resp, status: u16, error_code: &str) {
    assert_eq!(resp.status, status, "{}", resp.body);
    assert_eq!(code(resp), error_code, "{}", resp.body);
    assert_eq!(resp.json()["v"], 1);
}

// --- contract: sessions (conformance_test.go TestContractSessionIdempotencyAndConflicts) ------------------------------------

#[tokio::test]
async fn session_create_is_idempotent_and_every_conflict_is_a_409() {
    let r = rig(Opts::default()).await;
    let a = r.create("gs-1", json!({"maxPlayers": 8})).await;
    assert_eq!(a.status, 200, "{}", a.body);
    let a = a.json();
    assert_eq!(a["v"], 1);
    assert_eq!(a["created"], true);
    assert_eq!(a["phase"], "lobby");
    assert_eq!(a["maxPlayers"], 8);
    assert_eq!(a["roomId"].as_str().unwrap().len(), 32);
    // A retry: the same room, created:false, and no second room.
    let b = r.create("gs-1", json!({"maxPlayers": 8})).await.json();
    assert_eq!(
        (b["created"].clone(), &b["roomId"]),
        (json!(false), &a["roomId"])
    );
    assert_eq!(r.director.room_count(), 1);
    // The default maxPlayers is 8: the same request without the property is the same session.
    assert_eq!(r.create("gs-1", json!({})).await.json()["created"], false);
    wants(
        &r.create("gs-1", json!({"maxPlayers": 6})).await,
        409,
        "session_conflict",
    );
    wants(&r.create("gs-2", json!({})).await, 409, "at_capacity");
    // An aborted room stays a tombstone: its id is never reusable.
    assert_eq!(r.end("gs-1", "abort").await.status, 200);
    r.wait_phase("gs-1", "closed").await;
    wants(
        &r.create("gs-1", json!({"maxPlayers": 8})).await,
        409,
        "session_ended",
    );
    // Draining refuses a new session (and takes precedence over the room cap).
    assert_eq!(r.post("/control/drain", json!({"v":1})).await.status, 200);
    wants(&r.create("gs-3", json!({})).await, 409, "draining");
}

#[tokio::test]
async fn session_properties_are_validated_and_a_starting_server_is_503() {
    let r = rig(Opts {
        max_rooms: 4,
        ..Opts::default()
    })
    .await;
    for props in [
        json!({"maxPlayers": 0}),
        json!({"maxPlayers": 9}),
        json!({"maxPlayers": 4, "fillBotsTo": 5}),
        json!({"nope": 1}),
        json!({"maxPlayers": "8"}),
    ] {
        assert_eq!(r.create("g", props.clone()).await.status, 400, "{props}");
    }
    let m = r.create("g", json!({"mapSeed": 7})).await;
    wants(&m, 400, "unsupported_property");
    // The state gate: a server that is not Ready yet refuses with 503 not_ready.
    let starting = {
        let d = Director::new(
            DirectorConfig::new(
                SimConfig {
                    min_players: 2,
                    lobby_seconds: 30.0,
                    fill_seconds: 0.0,
                    pvp_rules: true,
                    weapon_specials: true,
                    faction_mode: rh_sim::FactionMode::Off,
                },
                rh_sim::arenas::practice_arena(),
            ),
            Arc::new(Persistence::memory()),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        );
        d.control_create("g", None, None)
    };
    let e = starting.unwrap_err();
    assert_eq!((e.status, e.code), (503, "not_ready"));
}

// --- contract: admit (TestContractAdmitIdempotencyReplayAndExpiry) --------------------------------------------------------

#[tokio::test]
async fn admit_is_idempotent_never_extends_never_rearms_and_expires_for_good() {
    let r = rig(Opts::default()).await;
    r.create("gs-1", json!({})).await;
    let a = r.admit("gs-1", "psess-1", "alice").await;
    assert_eq!(a.status, 200, "{}", a.body);
    let a = a.json();
    assert_eq!(a["state"], "admitted");
    assert_eq!(a["callsign"], "alice");
    tokio::time::sleep(Duration::from_millis(60)).await;
    let a2 = r.admit("gs-1", "psess-1", "alice").await.json();
    assert_eq!(a2["state"], "admitted");
    assert!(
        a2["expiresInMs"].as_u64().unwrap() < a["expiresInMs"].as_u64().unwrap(),
        "a retry must not extend the expiry: {a2} vs {a}"
    );
    // Another callsign on the same reservation, and a second reservation for the same callsign, are conflicts.
    wants(
        &r.admit("gs-1", "psess-1", "bob").await,
        409,
        "admit_conflict",
    );
    wants(
        &r.admit("gs-1", "psess-2", "alice").await,
        409,
        "admit_conflict",
    );
    // A reservation belongs to one room.
    // (max_rooms is 1: the other room is covered in the multi-room test.)
    // Replay after the player seated never re-arms.
    let alice = join(&r, "alice").await;
    r.wait_player("gs-1", "psess-1", "seated").await;
    assert_eq!(
        r.admit("gs-1", "psess-1", "alice").await.json()["state"],
        "consumed"
    );
    // The admit was consumed once: a second connection for the callsign is not a second seat.
    let again = try_join(&r.ws_url(), "alice", &token_of("alice"), None).await;
    assert!(again.is_err(), "a seated profile cannot be admitted twice");
    // Leave, acknowledge, replay: still never re-armed. (dave keeps the room open: a room whose last human leaves closes.)
    r.admit("gs-1", "psess-d", "dave").await;
    let _dave = join(&r, "dave").await;
    let mut alice = alice;
    alice.leave().await;
    let p = r.wait_player("gs-1", "psess-1", "left").await;
    assert_eq!(p["reason"], "left");
    let ack = r.leave("gs-1", "psess-1", "ack").await;
    assert_eq!(
        (ack.status, ack.json()["state"].clone()),
        (200, json!("dropped"))
    );
    assert_eq!(
        r.admit("gs-1", "psess-1", "alice").await.json()["state"],
        "left"
    );
    // Expiry: ttlMs is bounded below at 1000 and a pending admit expires on the server's own clock, for good.
    let bad = r
        .post(
            "/control/admit",
            json!({"v":1,"gameSessionId":"gs-1","playerSessionId":"x","callsign":"bob","ttlMs":10}),
        )
        .await;
    wants(&bad, 400, "bad_request");
    let short = r
        .post("/control/admit", json!({"v":1,"gameSessionId":"gs-1","playerSessionId":"psess-9","callsign":"bob","ttlMs":1000}))
        .await;
    assert_eq!(short.status, 200, "{}", short.body);
    tokio::time::sleep(Duration::from_millis(1150)).await;
    assert_eq!(r.player("gs-1", "psess-9").await["status"], "expired");
    assert_eq!(
        r.admit("gs-1", "psess-9", "bob").await.json()["state"],
        "expired"
    );
    // An expired admit admits nobody (the Hello is refused with the admit reason).
    let late = try_join(&r.ws_url(), "bob", &token_of("bob"), None).await;
    assert_eq!(
        late.err().unwrap(),
        (RejectCode::BadCredentials, "not admitted".to_string())
    );
    // The callsign is free again: a new reservation is accepted and seats.
    assert_eq!(
        r.admit("gs-1", "psess-10", "bob").await.json()["state"],
        "admitted"
    );
    let _bob = join(&r, "bob").await;
    r.wait_player("gs-1", "psess-10", "seated").await;
}

#[tokio::test]
async fn admit_refusals_unknown_room_room_full_draining_and_ended() {
    let r = rig(Opts {
        max_rooms: 2,
        ..Opts::default()
    })
    .await;
    let u = r.admit("nope", "psess-1", "alice").await;
    wants(&u, 404, "no_such_session");
    r.create("gs-1", json!({"maxPlayers": 1})).await;
    r.create("gs-2", json!({})).await;
    assert_eq!(r.admit("gs-1", "psess-1", "alice").await.status, 200);
    wants(&r.admit("gs-1", "psess-2", "bob").await, 409, "room_full");
    // A reservation belongs to one room.
    wants(
        &r.admit("gs-2", "psess-1", "alice").await,
        409,
        "admit_conflict",
    );
    // A callsign holds one admit in any room.
    wants(
        &r.admit("gs-2", "psess-3", "alice").await,
        409,
        "admit_conflict",
    );
    // Validation.
    for body in [
        json!({"v":1,"gameSessionId":"gs-2","playerSessionId":"p","callsign":"a"}),
        json!({"v":1,"gameSessionId":"gs-2","playerSessionId":"p","callsign":"has space"}),
        json!({"v":1,"gameSessionId":"gs-2","playerSessionId":"","callsign":"carol"}),
        json!({"v":1,"gameSessionId":"","playerSessionId":"p","callsign":"carol"}),
        json!({"v":1,"gameSessionId":"gs-2","playerSessionId":"p".repeat(129),"callsign":"carol"}),
    ] {
        wants(&r.post("/control/admit", body).await, 400, "bad_request");
    }
    // A gracefully ending room takes no more admits.
    assert_eq!(r.end("gs-2", "graceful").await.status, 200);
    wants(&r.admit("gs-2", "psess-4", "carol").await, 409, "draining");
    r.wait_phase("gs-2", "closed").await;
    wants(
        &r.admit("gs-2", "psess-4", "carol").await,
        409,
        "session_ended",
    );
    // Server drain.
    assert_eq!(r.post("/control/drain", json!({"v":1})).await.status, 200);
    wants(&r.admit("gs-1", "psess-5", "dave").await, 409, "draining");
}

// --- contract: leave, kick, ack, end (TestContractLeaveKickAckAndEndAbort) ------------------------------------------------

#[tokio::test]
async fn kick_and_ack_are_idempotent_and_a_kick_frees_the_seat_through_the_leave_path() {
    let r = rig(Opts::default()).await;
    r.create("gs-1", json!({})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    r.admit("gs-1", "psess-2", "bob").await;
    let _alice = join(&r, "alice").await;
    let _bob = join(&r, "bob").await;
    r.wait_player("gs-1", "psess-1", "seated").await;
    // Kick an admitted-but-unseated entry: it turns `expired`. (carol was never seated.)
    r.admit("gs-1", "psess-3", "carol").await;
    let k = r.leave("gs-1", "psess-3", "kick").await;
    assert_eq!(
        (k.status, k.json()["state"].clone()),
        (200, json!("expired"))
    );
    assert_eq!(
        try_join(&r.ws_url(), "carol", &token_of("carol"), None)
            .await
            .err()
            .unwrap()
            .1,
        "not admitted"
    );
    // Kick a seated player: left/kicked at once, and the room's seat is removed through the leave path.
    let k = r.leave("gs-1", "psess-1", "kick").await;
    assert_eq!((k.status, k.json()["state"].clone()), (200, json!("left")));
    let p = r.player("gs-1", "psess-1").await;
    assert_eq!(
        (p["status"].clone(), p["reason"].clone()),
        (json!("left"), json!("kicked"))
    );
    for _ in 0..100 {
        if r.director.info()["players"] == 1 {
            break; // alice's profile entry is gone: only bob holds one
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert_eq!(
        r.director.info()["players"],
        1,
        "the kicked seat and its profile were freed"
    );
    // Idempotent: kick again, ack twice, ack of an unknown player; unknown room is 404.
    for mode in ["kick", "ack", "ack"] {
        assert_eq!(r.leave("gs-1", "psess-1", mode).await.status, 200, "{mode}");
    }
    let unknown = r.leave("gs-1", "psess-404", "ack").await;
    assert_eq!(
        (unknown.status, unknown.json()["state"].clone()),
        (200, json!("unknown"))
    );
    wants(
        &r.leave("nope", "psess-1", "ack").await,
        404,
        "no_such_session",
    );
    // Ack of a player still seated is refused, not silently dropped.
    wants(&r.leave("gs-1", "psess-2", "ack").await, 409, "not_final");
    // The kicked callsign can be admitted again (a new reservation) and rejoin.
    assert_eq!(
        r.admit("gs-1", "psess-7", "alice").await.json()["state"],
        "admitted"
    );
    let _again = join(&r, "alice").await;
    r.wait_player("gs-1", "psess-7", "seated").await;
}

#[tokio::test]
async fn abort_closes_a_running_match_at_once_and_invents_no_result() {
    let r = rig(Opts {
        quick_start: true,
        ..Opts::default()
    })
    .await;
    r.create("gs-1", json!({})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    r.admit("gs-1", "psess-2", "bob").await;
    let _alice = join(&r, "alice").await;
    r.wait_phase("gs-1", "active").await;
    r.wait_player("gs-1", "psess-1", "seated").await;
    let e = r.end("gs-1", "abort").await;
    assert_eq!(e.status, 200, "{}", e.body);
    assert_eq!(
        e.json()["phase"],
        "closed",
        "abort answers once the room is closed"
    );
    assert_eq!(
        r.end("gs-1", "abort").await.json()["phase"],
        "closed",
        "idempotent; a tombstone answers 200"
    );
    let room = r.room("gs-1").await;
    assert_eq!(
        (room["phase"].clone(), room["endReason"].clone()),
        (json!("closed"), json!("ended_by_bridge"))
    );
    let alice = r.player("gs-1", "psess-1").await;
    assert_eq!(
        (alice["status"].clone(), alice["reason"].clone()),
        (json!("left"), json!("aborted"))
    );
    // The admit nobody used is expired, not pending in a dead room.
    assert_eq!(r.player("gs-1", "psess-2").await["status"], "expired");
    tokio::time::sleep(Duration::from_millis(400)).await;
    let info = r.director.info();
    for k in ["resultsOk", "resultsFailed", "resultsRefused"] {
        assert_eq!(info[k], 0, "{k}: an aborted match writes no result");
    }
    assert_eq!(r.director.room_count(), 0, "the room is freed");
    assert_eq!(info["players"], 0, "the seat and its profile are freed");
}

#[tokio::test]
async fn leaving_a_running_match_is_the_normal_mia_path_and_does_write_a_result() {
    // The control of the abort test above: the same fixture, but a clean leave mid-match writes its MIA result, so the
    // "no result" assertion there is meaningful.
    let r = rig(Opts {
        quick_start: true,
        ..Opts::default()
    })
    .await;
    r.create("gs-1", json!({})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    let mut alice = join(&r, "alice").await;
    r.wait_phase("gs-1", "active").await;
    alice.leave().await;
    r.wait_player("gs-1", "psess-1", "left").await;
    for _ in 0..100 {
        if r.director.info()["resultsOk"] == 1 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    panic!("the MIA result was never written: {}", r.director.info());
}

// --- request hygiene -----------------------------------------------------------------------------------------------------

#[tokio::test]
async fn unknown_fields_versions_malformed_and_oversized_bodies_are_refused() {
    let r = rig(Opts::default()).await;
    let post = |path: &'static str, body: &str| {
        let body = body.to_string();
        let addr = r.control;
        async move { post_json(addr, path, &[], &body).await }
    };
    wants(
        &post("/control/session", r#"{"v":2,"gameSessionId":"g"}"#).await,
        400,
        "unsupported_version",
    );
    wants(
        &post("/control/session", r#"{"gameSessionId":"g"}"#).await,
        400,
        "bad_request",
    );
    wants(
        &post(
            "/control/admit",
            r#"{"v":1,"gameSessionId":"g","playerSessionId":"p","callsign":"ab","extra":1}"#,
        )
        .await,
        400,
        "bad_request",
    );
    wants(
        &post("/control/session", r#"not json"#).await,
        400,
        "bad_request",
    );
    wants(
        &post("/control/session", r#"[1]"#).await,
        400,
        "bad_request",
    );
    wants(&post("/control/session", "").await, 400, "bad_request");
    wants(
        &post(
            "/control/leave",
            r#"{"v":1,"gameSessionId":"g","playerSessionId":"p","mode":"nuke"}"#,
        )
        .await,
        400,
        "bad_request",
    );
    wants(
        &post(
            "/control/end",
            r#"{"v":1,"gameSessionId":"g","mode":"now"}"#,
        )
        .await,
        400,
        "bad_request",
    );
    wants(
        &post("/control/drain", r#"{"v":3}"#).await,
        400,
        "unsupported_version",
    );
    wants(
        &post("/control/drain", r#"{"v":1,"x":1}"#).await,
        400,
        "bad_request",
    );
    // Bodies above 16 KiB are 413, however the bytes are shaped.
    let big = format!(
        r#"{{"v":1,"gameSessionId":"{}"}}"#,
        "g".repeat(rh_server::control::MAX_BODY + 1)
    );
    wants(
        &post("/control/session", &big).await,
        413,
        "payload_too_large",
    );
    // Error bodies carry v and a code, nothing else of the request.
    let e = post(
        "/control/session",
        r#"{"v":1,"gameSessionId":"g","properties":{"maxPlayers":99}}"#,
    )
    .await;
    assert_eq!(e.json()["v"], 1);
    // An empty drain body predates the envelope and stays accepted.
    assert_eq!(
        request(r.control, "POST", "/control/drain", &[], None)
            .await
            .status,
        200
    );
}

#[tokio::test]
async fn the_bearer_token_guards_every_control_route_when_configured() {
    let r = rig(Opts {
        token: Some("s3cret-control-token"),
        ..Opts::default()
    })
    .await;
    for (m, p) in [
        ("GET", "/control/health"),
        ("GET", "/control/rooms"),
        ("POST", "/control/drain"),
    ] {
        let denied = request(r.control, m, p, &[], Some(b"{\"v\":1}")).await;
        wants(&denied, 401, "unauthorized");
        let wrong = request(
            r.control,
            m,
            p,
            &[("Authorization", "Bearer nope")],
            Some(b"{\"v\":1}"),
        )
        .await;
        assert_eq!(wrong.status, 401);
        assert!(!wrong.body.contains("s3cret"), "{}", wrong.body);
    }
    let ok = get(
        r.control,
        "/control/health",
        &[("Authorization", "Bearer s3cret-control-token")],
    )
    .await;
    assert_eq!(ok.status, 200, "{}", ok.body);
}

// --- --require-admit -----------------------------------------------------------------------------------------------------

#[tokio::test]
async fn health_reports_the_capability_the_bridge_checks_and_no_secret() {
    let on = rig(Opts::default()).await;
    let h = get(on.control, "/control/health", &[]).await;
    assert_eq!(h.status, 200);
    let h = h.json();
    assert_eq!(h["v"], 1);
    assert_eq!(h["state"], "ready");
    assert_eq!(
        h["control"],
        json!({"v":1,"requireAdmit":true,"maxRooms":1,"admitTtlMs":60000})
    );
    let off = rig(Opts {
        require_admit: false,
        ..Opts::default()
    })
    .await;
    assert_eq!(
        get(off.control, "/control/health", &[]).await.json()["control"]["requireAdmit"],
        false
    );
}

#[tokio::test]
async fn require_admit_needs_both_the_profile_credential_and_an_admit_and_keeps_the_earlier_refusals_first(
) {
    let r = rig(Opts::default()).await;
    r.create("gs-1", json!({})).await;
    // A valid profile token without an admit: refused.
    let e = try_join(&r.ws_url(), "alice", &token_of("alice"), None).await;
    assert_eq!(
        e.err().unwrap(),
        (RejectCode::BadCredentials, "not admitted".to_string())
    );
    // An admit with the wrong profile token: refused by the unchanged credential check (the admit stays unconsumed).
    r.admit("gs-1", "psess-1", "alice").await;
    let e = try_join(&r.ws_url(), "alice", "wrong-token", None).await;
    assert_eq!(
        e.err().unwrap(),
        (RejectCode::BadCredentials, "bad credentials".to_string())
    );
    assert_eq!(r.player("gs-1", "psess-1").await["status"], "admitted");
    // Earlier refusals keep their place: a malformed callsign, a protocol mismatch, a content mismatch.
    let e = try_join(&r.ws_url(), "x", &token_of("alice"), None).await;
    assert!(
        matches!(e.err().unwrap(), (RejectCode::BadCredentials, m) if m.starts_with("callsign must"))
    );
    // Both: seated, and the player is reported.
    let _alice = join(&r, "alice").await;
    let p = r.wait_player("gs-1", "psess-1", "seated").await;
    assert_eq!(p["callsign"], "alice");
    // The admit grants nothing beyond the seat: a different profile with a valid token but no admit is still refused.
    let e = try_join(&r.ws_url(), "bob", &token_of("bob"), None).await;
    assert_eq!(e.err().unwrap().1, "not admitted");
}

#[tokio::test]
async fn require_admit_routes_by_the_admit_and_never_opens_a_room_itself() {
    let r = rig(Opts {
        max_rooms: 3,
        ..Opts::default()
    })
    .await;
    // No room exists and nobody is admitted: the Hello is refused, and no lobby is opened for it.
    let e = try_join(&r.ws_url(), "alice", &token_of("alice"), None).await;
    assert_eq!(e.err().unwrap().1, "not admitted");
    assert_eq!(r.director.room_count(), 0);
    r.create("gs-a", json!({})).await;
    r.create("gs-b", json!({})).await;
    r.admit("gs-b", "psess-1", "alice").await;
    r.admit("gs-a", "psess-2", "bob").await;
    let _alice = join(&r, "alice").await;
    let _bob = join(&r, "bob").await;
    // Each landed in the room its admit names, not in the fullest open lobby.
    r.wait_player("gs-b", "psess-1", "seated").await;
    r.wait_player("gs-a", "psess-2", "seated").await;
    assert_eq!(r.room("gs-a").await["players"].as_array().unwrap().len(), 1);
    assert_eq!(r.room("gs-b").await["players"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_refused_admission_restores_the_admit_instead_of_burning_it() {
    let r = rig(Opts {
        quick_start: true,
        ..Opts::default()
    })
    .await;
    r.create("gs-1", json!({"maxPlayers": 2})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    r.admit("gs-1", "psess-2", "bob").await;
    let _alice = join(&r, "alice").await;
    // The lobby starts its match; bob's admit is still pending in a room that no longer takes joins.
    r.wait_phase("gs-1", "active").await;
    for _ in 0..3 {
        let e = try_join(&r.ws_url(), "bob", &token_of("bob"), None).await;
        // Refused for the room, every time: had the first attempt burned the admit, the next would say "not admitted".
        assert_eq!(
            e.err().unwrap(),
            (RejectCode::MatchFull, "match in progress".to_string())
        );
    }
    let p = r.player("gs-1", "psess-2").await;
    assert_eq!(p["status"], "admitted");
    assert!(p["expiresInMs"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn a_resume_inside_the_grace_keeps_the_seat_consumes_no_admit_and_left_comes_only_after_the_grace(
) {
    let r = rig(Opts::default()).await;
    r.create("gs-1", json!({})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    r.admit("gs-1", "psess-2", "bob").await;
    let alice = join(&r, "alice").await;
    let _bob = join(&r, "bob").await;
    r.wait_player("gs-1", "psess-1", "seated").await;
    let session = alice.session;
    // Connection drops: away, with the grace counting down. Not `left`.
    alice.drop_socket();
    let away = r.wait_player("gs-1", "psess-1", "away").await;
    let remaining = away["graceRemainingMs"].as_u64().unwrap();
    assert!(
        remaining > 0 && remaining <= GRACE.as_millis() as u64,
        "{away}"
    );
    // Resume with the 16-byte token inside the grace: seated again, no admit needed, none consumed, never `left`.
    let _alice = try_join(&r.ws_url(), "alice", "ignored-by-resume", Some(session))
        .await
        .expect("a resume inside the grace");
    let back = r.wait_player("gs-1", "psess-1", "seated").await;
    assert_eq!(back["reason"], Value::Null);
    assert_eq!(
        r.admit("gs-1", "psess-1", "alice").await.json()["state"],
        "consumed"
    );
    tokio::time::sleep(GRACE + Duration::from_millis(300)).await;
    assert_eq!(
        r.player("gs-1", "psess-1").await["status"],
        "seated",
        "the resumed seat stays"
    );

    // Bob drops and never returns: `away` for the whole grace, `left` only after it.
    // (He is the second client of the room: dropping him is the other half of the rule.)
    let bob = _bob;
    bob.drop_socket();
    r.wait_player("gs-1", "psess-2", "away").await;
    tokio::time::sleep(GRACE / 2).await;
    assert_eq!(
        r.player("gs-1", "psess-2").await["status"],
        "away",
        "not left before the grace ends"
    );
    let gone = r.wait_player("gs-1", "psess-2", "left").await;
    assert_eq!(gone["reason"], "grace_expired");
    // After the grace the resume token is dead.
    let late = try_join(&r.ws_url(), "bob", &token_of("bob"), Some([9; 16])).await;
    assert_eq!(late.err().unwrap().0, RejectCode::NoSuchSession);
}

// --- drain ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn drain_refuses_new_work_lets_the_match_run_and_terminates_when_the_last_room_closes() {
    let r = rig(Opts {
        quick_start: true,
        max_rooms: 2,
        ..Opts::default()
    })
    .await;
    r.create("gs-1", json!({})).await;
    r.admit("gs-1", "psess-1", "alice").await;
    r.admit("gs-1", "psess-9", "bob").await;
    let mut alice = join(&r, "alice").await;
    r.wait_phase("gs-1", "active").await;
    let d = r.post("/control/drain", json!({"v":1})).await;
    assert_eq!(
        (d.status, d.json()["state"].clone()),
        (200, json!("draining"))
    );
    assert_eq!(
        r.post("/control/drain", json!({"v":1})).await.json()["state"],
        "draining",
        "idempotent"
    );
    wants(&r.create("gs-2", json!({})).await, 409, "draining");
    wants(&r.admit("gs-1", "psess-2", "carol").await, 409, "draining");
    let e = try_join(&r.ws_url(), "bob", &token_of("bob"), None).await;
    assert_eq!(e.err().unwrap().0, RejectCode::ServerDraining);
    let h = get(r.control, "/control/health", &[]).await;
    assert_eq!(
        (h.status, h.json()["state"].clone()),
        (503, json!("draining"))
    );
    // The running match is not ended by the drain.
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(r.room("gs-1").await["phase"], "active");
    assert!(!r.lifecycle.is_terminated());
    // The last human leaves: the room closes, the server is Terminated, and the room is reported drained.
    alice.leave().await;
    for _ in 0..100 {
        if r.lifecycle.is_terminated() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(
        r.lifecycle.is_terminated(),
        "rooms_empty: Draining -> Terminated"
    );
    let room = r.room("gs-1").await;
    assert_eq!(
        (room["phase"].clone(), room["endReason"].clone()),
        (json!("closed"), json!("drained"))
    );
    assert_eq!(
        r.post("/control/drain", json!({"v":1})).await.json()["state"],
        "terminated"
    );
}

#[tokio::test]
async fn drain_closes_a_room_nobody_joined_at_once_instead_of_waiting_for_the_unclaimed_timeout() {
    let r = rig(Opts::default()).await;
    r.create("gs-1", json!({})).await;
    r.post("/control/drain", json!({"v":1})).await;
    for _ in 0..100 {
        if r.lifecycle.is_terminated() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(r.lifecycle.is_terminated());
    assert_eq!(r.room("gs-1").await["endReason"], "drained");
}

#[tokio::test]
async fn a_graceful_end_closes_the_one_room_and_keeps_the_server_ready() {
    let r = rig(Opts {
        max_rooms: 2,
        ..Opts::default()
    })
    .await;
    r.create("gs-1", json!({})).await;
    r.create("gs-2", json!({})).await;
    let e = r.end("gs-1", "graceful").await;
    assert_eq!(e.status, 200, "{}", e.body);
    r.wait_phase("gs-1", "closed").await;
    assert_eq!(r.room("gs-2").await["phase"], "lobby");
    assert!(r.lifecycle.healthy());
    wants(&r.end("nope", "graceful").await, 404, "no_such_session");
}

// --- listener boundary and secrets ---------------------------------------------------------------------------------------

#[tokio::test]
async fn the_public_listener_404s_every_control_path_and_the_control_listener_serves_no_public_route(
) {
    let r = rig(Opts::default()).await;
    for path in [
        "/control",
        "/control/",
        "/control/health",
        "/control/drain",
        "/control/session",
        "/control/admit",
        "/control/leave",
        "/control/end",
        "/control/rooms",
        "/control/unknown",
    ] {
        for method in ["GET", "POST"] {
            let resp = request(
                r.public,
                method,
                path,
                &[("Content-Type", "application/json")],
                Some(b"{\"v\":1}"),
            )
            .await;
            assert_eq!(
                resp.status, 404,
                "{method} {path} on the public listener: {}",
                resp.body
            );
        }
    }
    // Nothing was created or drained by those probes.
    assert_eq!(r.director.room_count(), 0);
    assert!(r.lifecycle.healthy());
    // And the control listener does not serve the public surface (/ws, /info, /probe).
    for path in ["/ws", "/info", "/probe", "/ping", "/healthz"] {
        assert_eq!(get(r.control, path, &[]).await.status, 404, "{path}");
    }
}

#[tokio::test]
async fn no_token_or_secret_appears_in_any_control_response() {
    let r = rig(Opts {
        token: Some("tok-control-xyz"),
        ..Opts::default()
    })
    .await;
    let auth = [("Authorization", "Bearer tok-control-xyz")];
    let call = |m: &'static str, p: &'static str, b: Option<String>| {
        let addr = r.control;
        async move {
            let mut h = vec![("Content-Type", "application/json")];
            h.extend_from_slice(&auth);
            request(addr, m, p, &h, b.as_deref().map(str::as_bytes)).await
        }
    };
    let mut bodies = Vec::new();
    bodies.push(
        call(
            "POST",
            "/control/session",
            Some(json!({"v":1,"gameSessionId":"g"}).to_string()),
        )
        .await
        .body,
    );
    bodies.push(
        call(
            "POST",
            "/control/admit",
            Some(
                json!({"v":1,"gameSessionId":"g","playerSessionId":"p1","callsign":"alice"})
                    .to_string(),
            ),
        )
        .await
        .body,
    );
    let _alice = join(&r, "alice").await;
    r.director.control_rooms(); // settle
    tokio::time::sleep(Duration::from_millis(100)).await;
    bodies.push(call("GET", "/control/rooms", None).await.body);
    bodies.push(call("GET", "/control/health", None).await.body);
    bodies.push(
        call(
            "POST",
            "/control/admit",
            Some(
                json!({"v":1,"gameSessionId":"zzz","playerSessionId":"p1","callsign":"alice"})
                    .to_string(),
            ),
        )
        .await
        .body,
    );
    bodies.push(
        call("POST", "/control/session", Some("garbage".into()))
            .await
            .body,
    );
    for b in bodies {
        for secret in [
            token_of("alice"),
            "tok-control-xyz".to_string(),
            "secret-token".to_string(),
        ] {
            assert!(!b.contains(&secret), "{secret} leaked in {b}");
        }
    }
}

// --- the real binary -----------------------------------------------------------------------------------------------------

mod binary {
    use super::*;
    use std::process::{Command, Stdio};

    fn bin() -> Command {
        Command::new(env!("CARGO_BIN_EXE_rh-server"))
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn fails(args: &[&str]) -> (Option<i32>, String) {
        let out = bin()
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .expect("spawn rh-server");
        (
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        )
    }

    #[test]
    fn a_non_loopback_control_address_is_refused() {
        let (code, err) = fails(&["--bind", "127.0.0.1:0", "--control", "0.0.0.0:0"]);
        assert_ne!(code, Some(0), "{err}");
        assert!(err.contains("loopback"), "{err}");
        let (code, err) = fails(&[
            "--bind",
            "127.0.0.1:0",
            "--control",
            "192.0.2.1:7778",
            "--require-admit",
        ]);
        assert_ne!(code, Some(0), "{err}");
        assert!(err.contains("loopback"), "{err}");
    }

    #[test]
    fn require_admit_is_really_parsed_a_typo_or_a_missing_control_listener_is_an_error() {
        let c = format!("127.0.0.1:{}", free_port());
        for args in [
            vec!["--bind", "127.0.0.1:0", "--control", &c, "--require-admt"],
            vec![
                "--bind",
                "127.0.0.1:0",
                "--control",
                &c,
                "--require-admit=true",
            ],
            vec!["--bind", "127.0.0.1:0", "--require-admit"],
        ] {
            let (code, err) = fails(&args);
            assert_eq!(code, Some(2), "{args:?}: {err}");
            assert!(err.contains("invalid hosting settings"), "{args:?}: {err}");
        }
    }

    struct Child(std::process::Child);
    impl Drop for Child {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[tokio::test]
    async fn the_real_binary_reports_require_admit_and_gates_a_hello_on_an_admit() {
        let (game, ctl) = (free_port(), free_port());
        let _dir = std::env::temp_dir();
        let token_file = std::env::temp_dir().join(format!("rh-ctl-token-{}", std::process::id()));
        std::fs::write(&token_file, "bin-control-token\n").unwrap();
        let mut cmd = bin();
        cmd.args([
            "--bind",
            &format!("127.0.0.1:{game}"),
            "--control",
            &format!("127.0.0.1:{ctl}"),
            "--control-token-file",
            token_file.to_str().unwrap(),
            "--max-rooms",
            "1",
            "--require-admit",
            "--min-players",
            "1",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        let _child = Child(cmd.spawn().expect("spawn"));
        let control: SocketAddr = format!("127.0.0.1:{ctl}").parse().unwrap();
        let auth = [("Authorization", "Bearer bin-control-token")];
        let mut health = None;
        for _ in 0..100 {
            if let Ok(s) = tokio::net::TcpStream::connect(control).await {
                drop(s);
                // During startup under load a connection can be accepted and closed with no reply; the helper panics on
                // that, so probe in a task and treat a panic as "not ready yet" (the assertions below are unchanged).
                let probe = tokio::spawn(async move {
                    get(
                        control,
                        "/control/health",
                        &[("Authorization", "Bearer bin-control-token")],
                    )
                    .await
                });
                let Ok(h) = probe.await else {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                };
                if h.status == 200 {
                    health = Some(h.json());
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let health = health.expect("the binary became ready");
        assert_eq!(health["control"]["requireAdmit"], true);
        assert_eq!(health["control"]["maxRooms"], 1);
        assert_eq!(get(control, "/control/health", &[]).await.status, 401);
        // Auth::Dev accepts any ticket, so without an admit the Hello is refused by the admit check alone.
        let url = format!("ws://127.0.0.1:{game}/ws");
        let e = try_join(&url, "alice", "t", None).await;
        assert_eq!(
            e.err().unwrap(),
            (RejectCode::BadCredentials, "not admitted".to_string())
        );
        let mut h = vec![("Content-Type", "application/json")];
        h.extend_from_slice(&auth);
        let s = request(
            control,
            "POST",
            "/control/session",
            &h,
            Some(br#"{"v":1,"gameSessionId":"g"}"#),
        )
        .await;
        assert_eq!(s.status, 200, "{}", s.body);
        let a = request(
            control,
            "POST",
            "/control/admit",
            &h,
            Some(br#"{"v":1,"gameSessionId":"g","playerSessionId":"p","callsign":"alice"}"#),
        )
        .await;
        assert_eq!(a.status, 200, "{}", a.body);
        let _alice = try_join(&url, "alice", "t", None).await.expect("admitted");
        let _ = std::fs::remove_file(&token_file);
    }
}

/// A `POST /control/session` racing `drain` must either be refused (409 draining) or leave a room that drain then closes:
/// drain must never reach Terminated while a session created during the drain stays alive and unannounced.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_created_while_draining_is_refused_or_drained_never_left_live_after_terminated() {
    let mut refused = 0;
    let mut created = 0;
    for i in 0..150 {
        let cfg = DirectorConfig {
            tick: TICK,
            linger: Duration::from_millis(50),
            max_rooms: 1,
            require_admit: true,
            ..DirectorConfig::new(
                SimConfig {
                    min_players: 2,
                    lobby_seconds: 30.0,
                    fill_seconds: 0.0,
                    pvp_rules: true,
                    weapon_specials: true,
                    faction_mode: rh_sim::FactionMode::Off,
                },
                rh_sim::arenas::practice_arena(),
            )
        };
        let lifecycle = Arc::new(Lifecycle::default());
        let d = Director::new(
            cfg,
            Arc::new(Persistence::memory()),
            Arc::new(Auth::Static(HashMap::new())),
            lifecycle.clone(),
        );
        lifecycle.ready();
        let (d1, d2) = (d.clone(), d.clone());
        let create = tokio::spawn(async move { d1.control_create("gs-race", None, None) });
        let drain = tokio::spawn(async move { d2.drain().await });
        let res = create.await.unwrap();
        drain.await.unwrap();
        match res {
            Ok(_) => {
                created += 1;
                // The room exists, so drain must have told it (or will, having seen it): it closes and only then terminates.
                let mut closed = false;
                for _ in 0..100 {
                    if d.info()["rooms"] == 0 {
                        closed = true;
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                assert!(
                    closed,
                    "iteration {i}: a session created during the drain stayed live (terminated: {})",
                    lifecycle.is_terminated()
                );
                assert!(
                    lifecycle.is_terminated(),
                    "iteration {i}: drained but never terminated"
                );
            }
            Err(e) => {
                refused += 1;
                assert_eq!((e.status, e.code), (409, "draining"), "iteration {i}");
                assert!(lifecycle.is_terminated());
            }
        }
    }
    eprintln!("drain race: {created} created then drained, {refused} refused");
}

#[tokio::test]
async fn health_reports_the_build_id_and_the_new_tick_and_admit_metrics_and_info_is_unchanged() {
    let r = rig(Opts::default()).await;
    let h = get(r.control, "/control/health", &[]).await.json();
    assert_eq!(h["build"], rh_sim::replay::BUILD_ID);
    assert!(h["metrics"]["lateSteps"].is_u64(), "{h}");
    for k in ["count", "p50", "p99", "max"] {
        assert!(h["metrics"]["admitToSeatMs"][k].is_u64(), "{k}: {h}");
    }
    // /info (public, pinned key set) does not grow a build key.
    assert!(r.director.info().get("build").is_none());
    // Seating one admitted player records one admit-to-seat observation.
    let before = h["metrics"]["admitToSeatMs"]["count"].as_u64().unwrap();
    r.create("gs-m", json!({})).await;
    r.admit("gs-m", "psess-m", "alice").await;
    let _alice = join(&r, "alice").await;
    r.wait_player("gs-m", "psess-m", "seated").await;
    let after = get(r.control, "/control/health", &[]).await.json()["metrics"]["admitToSeatMs"]
        ["count"]
        .as_u64()
        .unwrap();
    assert!(after > before, "{before} -> {after}");
}
