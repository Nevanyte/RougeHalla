//! P-LOBBY-ACTIVITY-1: the public lobby activity endpoint (legacy `GET /api/lobby`, `POST`/`DELETE /api/lobby/presence`:
//! packages/server/src/index.ts:408-442, guards/lobbyStatus.ts, shared/src/messages.ts:459-484), driven through the real
//! listener. Presence is untrusted input: every rejection path has a check here.

#[path = "support/http.rs"]
mod http;
#[path = "support/ws.rs"]
mod ws;

use rh_protocol::{ServerMsg, StateItem};
use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig, LobbyPlayerView, LobbyRoomView, LobbyView};
use rh_server::lobby::{public_snapshot, LobbyConfig};
use rh_server::outbox::Outbox;
use rh_server::persist::{Auth, Persistence};
use rh_server::room::{MapAssets, Room, RoomCmd, RoomConfig};
use rh_sim::{Phase, SimConfig};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

const LOBBY: &str = "/api/lobby";
const PRESENCE: &str = "/api/lobby/presence";

fn sim() -> SimConfig {
    SimConfig {
        // Three humans to start: one seated human keeps the room in its lobby for the whole test.
        min_players: 3,
        lobby_seconds: 30.0,
        fill_seconds: 0.0,
        ..SimConfig::default()
    }
}

async fn start(auth: Auth, lobby: LobbyConfig) -> SocketAddr {
    let cfg = DirectorConfig::new(sim(), rh_sim::arenas::practice_arena());
    let d = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(auth),
        Arc::new(rh_server::hosting::Lifecycle::default()),
    );
    let app =
        rh_server::public_router_with_lobby(d, AccountApi::disabled(ApiConfig::default()), lobby);
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    handle.listening().await.expect("bound")
}

fn open() -> LobbyConfig {
    LobbyConfig {
        address_burst: 1000.0,
        address_per_second: 1000.0,
        name_burst: 1000.0,
        name_per_second: 1000.0,
        ..LobbyConfig::default()
    }
}

async fn presence(
    addr: SocketAddr,
    method: &str,
    body: &str,
    extra: &[(&str, &str)],
) -> http::Resp {
    let mut h = vec![("Content-Type", "application/json")];
    h.extend_from_slice(extra);
    http::request(addr, method, PRESENCE, &h, Some(body.as_bytes())).await
}

fn body(name: &str, tab: &str) -> String {
    json!({ "name": name, "tabId": tab }).to_string()
}

fn waiting(snapshot: &Value) -> Vec<String> {
    snapshot["waiting"]
        .as_array()
        .unwrap_or_else(|| panic!("no waiting list in {snapshot}"))
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_owned())
        .collect()
}

async fn snapshot(addr: SocketAddr) -> Value {
    let r = http::get(addr, LOBBY, &[]).await;
    assert_eq!(r.status, 200, "{r:?}");
    r.json()
}

/// Polls the snapshot until `ready` holds (a seat reaches the director through the room's report channel).
async fn snapshot_when(addr: SocketAddr, ready: impl Fn(&Value) -> bool) -> Value {
    let until = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let s = snapshot(addr).await;
        if ready(&s) || tokio::time::Instant::now() > until {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn the_snapshot_lists_rooms_with_phase_and_players_and_the_hub() {
    let addr = start(Auth::Dev, open()).await;
    let _alpha = ws::try_join(&format!("ws://{addr}/ws"), "Alpha", "", None)
        .await
        .expect("seated");
    let r = presence(addr, "POST", &body("bravo", "tab-bravo-0001"), &[]).await;
    assert_eq!(r.status, 200, "{r:?}");
    assert_eq!(
        waiting(&r.json()),
        ["bravo"],
        "a heartbeat answers the snapshot"
    );
    // A seated player's own heartbeat does not list them as waiting (legacy `occupied`).
    let r = presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[]).await;
    assert_eq!(r.status, 200, "{r:?}");

    let s = snapshot_when(addr, |s| {
        s["rooms"][0]["players"]
            .as_array()
            .is_some_and(|p| !p.is_empty())
    })
    .await;
    let r = http::get(addr, LOBBY, &[]).await;
    assert_eq!(r.header("cache-control"), Some("no-store"));
    assert!(
        s["serverNow"]
            .as_u64()
            .is_some_and(|t| t > 1_600_000_000_000),
        "{s}"
    );
    assert_eq!(
        s["rooms"],
        json!([{
            "phase": "lobby",
            "startedAt": null,
            "humanMin": 3,
            "fillTarget": 0,
            "humans": 1,
            "players": [{ "name": "Alpha", "kind": "human" }],
        }]),
        "{s}"
    );
    assert_eq!(waiting(&s), ["bravo"]);
    assert_eq!(s["onlineCount"], 2);
    assert_eq!(s["arenaRoomCount"], 1);
    assert_eq!(s["arenaLimit"], 16);
    assert_eq!(s["arenaAvailable"], true);

    // Browsers on another origin may read it and send presence (no credentials are involved).
    let pre = http::request(
        addr,
        "OPTIONS",
        PRESENCE,
        &[("Origin", "https://play.example")],
        None,
    )
    .await;
    assert_eq!(pre.status, 204, "{pre:?}");
    assert_eq!(pre.header("access-control-allow-origin"), Some("*"));
    let allowed = pre
        .header("access-control-allow-headers")
        .unwrap_or_default()
        .to_ascii_lowercase();
    assert!(
        allowed.contains("x-profile-token") && allowed.contains("content-type"),
        "{allowed}"
    );
}

/// Bot seats carry `kind: "bot"`, and the whole shape is exactly the public one (pure builder, no server).
#[test]
fn the_public_snapshot_tags_bots_and_has_exactly_the_public_shape() {
    let view = LobbyView {
        rooms: vec![LobbyRoomView {
            phase: Phase::Active,
            started_at_ms: Some(1_700_000_000_000),
            human_min: 2,
            fill_target: 4,
            players: vec![
                LobbyPlayerView {
                    name: "Alpha".into(),
                    bot: false,
                },
                LobbyPlayerView {
                    name: "Ragnar".into(),
                    bot: true,
                },
            ],
        }],
        occupied: vec!["alpha".into()],
        room_count: 1,
        room_limit: 4,
        joinable: false,
    };
    let s = serde_json::to_value(public_snapshot(
        &view,
        &["charlie".into(), "Alpha".into(), "bravo".into()],
        123,
    ))
    .unwrap();
    assert_eq!(
        s,
        json!({
            "serverNow": 123,
            "rooms": [{
                "phase": "active",
                "startedAt": 1_700_000_000_000u64,
                "humanMin": 2,
                "fillTarget": 4,
                "humans": 1,
                "players": [
                    { "name": "Alpha", "kind": "human" },
                    { "name": "Ragnar", "kind": "bot" },
                ],
            }],
            "waiting": [{ "name": "bravo" }, { "name": "charlie" }],
            "onlineCount": 3,
            "arenaLimit": 4,
            "arenaRoomCount": 1,
            "arenaAvailable": false,
        })
    );
}

fn keys(v: &Value, out: &mut BTreeSet<String>) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                out.insert(k.clone());
                keys(v, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

/// C-OBS: no account id, token, tab id, address, position or match id reaches the response.
#[tokio::test]
async fn the_response_carries_only_public_fields() {
    let addr = start(
        Auth::Static(
            [
                ("alpha".into(), "secret-alpha".into()),
                ("bravo".into(), "secret-bravo".into()),
            ]
            .into(),
        ),
        open(),
    )
    .await;
    let _alpha = ws::try_join(&format!("ws://{addr}/ws"), "alpha", "secret-alpha", None)
        .await
        .expect("seated");
    let hb = presence(
        addr,
        "POST",
        &body("bravo", "tab-bravo-secret-0001"),
        &[("x-profile-token", "secret-bravo")],
    )
    .await;
    assert_eq!(hb.status, 200, "{hb:?}");
    let s = snapshot_when(addr, |s| {
        s["rooms"][0]["players"]
            .as_array()
            .is_some_and(|p| !p.is_empty())
    })
    .await;
    let allowed: BTreeSet<String> = [
        "serverNow",
        "rooms",
        "waiting",
        "onlineCount",
        "arenaLimit",
        "arenaRoomCount",
        "arenaAvailable",
        "phase",
        "startedAt",
        "humanMin",
        "fillTarget",
        "humans",
        "players",
        "name",
        "kind",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    for doc in [&s, &hb.json()] {
        let mut seen = BTreeSet::new();
        keys(doc, &mut seen);
        assert!(
            seen.contains("players") && seen.contains("waiting"),
            "{doc}"
        );
        let extra: Vec<_> = seen.difference(&allowed).collect();
        assert!(extra.is_empty(), "private fields {extra:?} in {doc}");
        let text = doc.to_string();
        for secret in [
            "secret-alpha",
            "secret-bravo",
            "tab-bravo-secret",
            "127.0.0.1",
        ] {
            assert!(!text.contains(secret), "{secret:?} leaked in {text}");
        }
    }
}

#[tokio::test]
async fn malformed_oversized_or_forged_presence_is_refused() {
    let addr = start(
        Auth::Static([("alpha".into(), "tok-alpha".into())].into()),
        open(),
    )
    .await;
    let token = [("x-profile-token", "tok-alpha")];
    let ok = body("alpha", "tab-alpha-0001");

    for method in ["GET", "PUT", "PATCH"] {
        let r = http::request(addr, method, PRESENCE, &[], None).await;
        assert_eq!(r.status, 405, "{method}: {r:?}");
        assert_eq!(r.header("allow"), Some("POST, DELETE, OPTIONS"), "{method}");
    }
    let r = http::request(
        addr,
        "POST",
        PRESENCE,
        &[("Content-Type", "text/plain"), token[0]],
        Some(ok.as_bytes()),
    )
    .await;
    assert_eq!(r.status, 415, "{r:?}");

    let long_tab = "t".repeat(129);
    let malformed = [
        "".to_string(),
        "{\"name\":".into(),
        "[]".into(),
        "\"alpha\"".into(),
        "null".into(),
        "{}".into(),
        json!({ "name": "alpha" }).to_string(),
        json!({ "tabId": "tab-alpha-0001" }).to_string(),
        json!({ "name": 5, "tabId": "tab-alpha-0001" }).to_string(),
        json!({ "name": "alpha", "tabId": "tab-alpha-0001", "admin": true }).to_string(),
        body("a", "tab-alpha-0001"),
        body("abcdefghijklmnopq", "tab-alpha-0001"),
        body("<script>", "tab-alpha-0001"),
        body("álpha", "tab-alpha-0001"),
        body("al pha", "tab-alpha-0001"),
        body("alpha", "short"),
        body("alpha", &long_tab),
        body("alpha", "tab/../0001"),
    ];
    for b in &malformed {
        let r = presence(addr, "POST", b, &token).await;
        assert_eq!(r.status, 400, "{b:?}: {r:?}");
    }
    let huge =
        json!({ "name": "alpha", "tabId": "tab-alpha-0001", "pad": "x".repeat(4096) }).to_string();
    let r = presence(addr, "POST", &huge, &token).await;
    assert_eq!(r.status, 413, "{r:?}");

    // A forged name: no token, or another profile's token.
    let r = presence(addr, "POST", &ok, &[]).await;
    assert_eq!(r.status, 403, "{r:?}");
    let r = presence(addr, "POST", &ok, &[("x-profile-token", "tok-bravo")]).await;
    assert_eq!(r.status, 403, "{r:?}");
    let r = presence(addr, "DELETE", &ok, &[("x-profile-token", "nope")]).await;
    assert_eq!(r.status, 403, "{r:?}");

    assert!(
        waiting(&snapshot(addr).await).is_empty(),
        "nothing refused was recorded"
    );
    let r = presence(addr, "POST", &ok, &token).await;
    assert_eq!(r.status, 200, "{r:?}");
    assert_eq!(waiting(&r.json()), ["alpha"]);
}

#[tokio::test]
async fn presence_is_bounded_in_profiles_and_tabs() {
    let addr = start(
        Auth::Dev,
        LobbyConfig {
            max_profiles: 2,
            max_tabs: 2,
            ..open()
        },
    )
    .await;
    for (name, tab) in [("alpha", "tab-alpha-0001"), ("bravo", "tab-bravo-0001")] {
        assert_eq!(
            presence(addr, "POST", &body(name, tab), &[]).await.status,
            200
        );
    }
    let r = presence(addr, "POST", &body("charlie", "tab-charlie-001"), &[]).await;
    assert_eq!(r.status, 429, "the hub is full: {r:?}");
    assert_eq!(
        presence(addr, "POST", &body("alpha", "tab-alpha-0002"), &[])
            .await
            .status,
        200
    );
    let r = presence(addr, "POST", &body("alpha", "tab-alpha-0003"), &[]).await;
    assert_eq!(r.status, 429, "one profile's tabs are bounded: {r:?}");
    assert_eq!(
        presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[])
            .await
            .status,
        200,
        "a known tab still refreshes"
    );
    assert_eq!(waiting(&snapshot(addr).await), ["alpha", "bravo"]);
}

#[tokio::test]
async fn presence_expires_and_can_be_withdrawn() {
    let addr = start(
        Auth::Dev,
        LobbyConfig {
            ttl: Duration::from_millis(300),
            ..open()
        },
    )
    .await;
    assert_eq!(
        presence(addr, "POST", &body("bravo", "tab-bravo-0001"), &[])
            .await
            .status,
        200
    );
    assert_eq!(waiting(&snapshot(addr).await), ["bravo"]);
    tokio::time::sleep(Duration::from_millis(450)).await;
    assert!(
        waiting(&snapshot(addr).await).is_empty(),
        "an unrefreshed entry expires"
    );

    assert_eq!(
        presence(addr, "POST", &body("charlie", "tab-charlie-001"), &[])
            .await
            .status,
        200
    );
    let r = presence(addr, "DELETE", &body("charlie", "tab-charlie-001"), &[]).await;
    assert_eq!(r.status, 200, "{r:?}");
    assert!(waiting(&r.json()).is_empty(), "withdrawn at once");
}

#[tokio::test]
async fn the_rate_limit_holds_per_address_and_per_name() {
    // Per address: garbage spends tokens too, and the snapshot shares the bucket.
    let addr = start(
        Auth::Dev,
        LobbyConfig {
            address_burst: 3.0,
            address_per_second: 0.001,
            ..open()
        },
    )
    .await;
    for _ in 0..2 {
        assert_eq!(presence(addr, "POST", "not json", &[]).await.status, 400);
    }
    assert_eq!(
        presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[])
            .await
            .status,
        200
    );
    let r = presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[]).await;
    assert_eq!(r.status, 429, "{r:?}");
    assert!(r.header("retry-after").is_some(), "{r:?}");
    assert_eq!(http::get(addr, LOBBY, &[]).await.status, 429);

    // Per name (legacy lobbyBuckets): one profile cannot heartbeat faster, another still can.
    let addr = start(
        Auth::Dev,
        LobbyConfig {
            name_burst: 2.0,
            name_per_second: 0.001,
            ..open()
        },
    )
    .await;
    for _ in 0..2 {
        assert_eq!(
            presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[])
                .await
                .status,
            200
        );
    }
    assert_eq!(
        presence(addr, "POST", &body("alpha", "tab-alpha-0001"), &[])
            .await
            .status,
        429
    );
    assert_eq!(
        presence(addr, "POST", &body("bravo", "tab-bravo-0001"), &[])
            .await
            .status,
        200
    );
}

#[tokio::test]
async fn a_forwarded_address_counts_only_when_configured() {
    let tight = LobbyConfig {
        address_burst: 1.0,
        address_per_second: 0.001,
        ..open()
    };
    // Not configured: the header is ignored, every request is the loopback peer's.
    let addr = start(Auth::Dev, tight.clone()).await;
    assert_eq!(
        http::get(addr, LOBBY, &[("x-forwarded-for", "1.1.1.1")])
            .await
            .status,
        200
    );
    assert_eq!(
        http::get(addr, LOBBY, &[("x-forwarded-for", "2.2.2.2")])
            .await
            .status,
        429
    );
    // Configured, behind a trusted (loopback) proxy: each client address has its own bucket.
    let addr = start(
        Auth::Dev,
        LobbyConfig {
            client_ip_header: Some("x-forwarded-for".parse().unwrap()),
            ..tight
        },
    )
    .await;
    assert_eq!(
        http::get(addr, LOBBY, &[("x-forwarded-for", "1.1.1.1")])
            .await
            .status,
        200
    );
    assert_eq!(
        http::get(addr, LOBBY, &[("x-forwarded-for", "2.2.2.2")])
            .await
            .status,
        200
    );
    assert_eq!(
        http::get(addr, LOBBY, &[("x-forwarded-for", "1.1.1.1")])
            .await
            .status,
        429
    );
}

/// The in-room roster (State key 12) reaches every seat while the room is still in its lobby, bots tagged.
/// (Verified before this packet: already true; pinned here.)
#[test]
fn a_lobby_room_delivers_the_roster_to_every_seat() {
    let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
    let (tx, _reports) = tokio::sync::mpsc::unbounded_channel();
    let tick = Duration::from_millis(50);
    let mut now = tokio::time::Instant::now();
    let cfg = RoomConfig {
        sim: SimConfig {
            min_players: 4,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            ..SimConfig::default()
        },
        arena: assets.arena.clone(),
        welcome_map: assets.welcome_map.clone(),
        fill_bots_to: 3,
        tick,
        record: false,
        fixed_secrets: Some(rh_sim::Secrets::from_seed(7)),
        fixed_bot_seed: Some(7),
        reconnect_grace: Duration::from_secs(10),
        linger: Duration::from_secs(5),
    };
    let mut room = Room::new([5; 16], cfg, tx, now);
    let mut seats = vec![];
    for (i, name) in ["alpha", "bravo"].into_iter().enumerate() {
        let outbox = Arc::new(Outbox::default());
        let (reply, mut rx) = tokio::sync::oneshot::channel();
        room.handle(
            RoomCmd::Join {
                profile: name.into(),
                faction: None,
                outbox: outbox.clone(),
                conn: i as u64 + 1,
                fence: 1,
                reply,
            },
            now,
        );
        rx.try_recv().expect("replied").expect("seated");
        seats.push(outbox);
    }
    for _ in 0..10 {
        now += tick;
        room.wake(now);
    }
    assert_eq!(room.sim().phase(), Phase::Lobby);
    for outbox in &seats {
        let mut frames = vec![];
        outbox.drain_into(&mut frames);
        let roster = frames
            .iter()
            .filter_map(|f| match ServerMsg::decode(f) {
                Ok(ServerMsg::State { items, .. }) => Some(items),
                _ => None,
            })
            .flatten()
            .filter_map(|item| match item {
                StateItem::Roster(rows) => Some(rows),
                _ => None,
            })
            .next_back()
            .expect("a roster during the lobby");
        let rows: Vec<(String, bool)> = roster.into_iter().map(|r| (r.name, r.bot)).collect();
        let humans: Vec<&str> = rows.iter().filter(|r| !r.1).map(|r| r.0.as_str()).collect();
        assert_eq!(humans, ["alpha", "bravo"], "{rows:?}");
        // The placeholder fill topped the room up to 3 at alpha's arrival: two bots, tagged.
        let bots: Vec<&str> = rows.iter().filter(|r| r.1).map(|r| r.0.as_str()).collect();
        assert_eq!(bots, ["bot1", "bot2"], "{rows:?}");
    }
}
