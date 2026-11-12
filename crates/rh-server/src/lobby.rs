//! Public lobby activity (P-LOBBY-ACTIVITY-1): who is in a game and who is waiting in the hub. The legacy endpoint
//! (`packages/server/src/index.ts:408-442`, `guards/lobbyStatus.ts`, shape in `packages/shared/src/messages.ts:459-484`):
//!
//! * `GET    /api/lobby`           the snapshot ([`LobbySnapshot`])
//! * `POST   /api/lobby/presence`  `{"name","tabId"}` with `x-profile-token`: this tab is in the hub (expires after `ttl`)
//! * `DELETE /api/lobby/presence`  the same body: this tab left the hub
//!
//! Both presence calls answer the snapshot. Served on the public listener beside `/ws`; nothing here is on `/control/*`.
//!
//! The response is built field by field from [`LobbyView`] (the director's plain copy) into the structs below: display
//! names, the bot flag, room phase, start time and counts. Never an account id, token, tab id, address or position.
//!
//! Presence is untrusted input. In order: a per-address token bucket (spent before anything is parsed), an
//! `application/json` content type, a 512-byte body (legacy `parseLobbyBody`) read under a timeout, a strict body (exactly
//! `name` and `tabId`, legacy `PROFILE_RE` and tab-id patterns), the profile token (the same check admission makes,
//! `Auth::verify`, bounded in concurrency and time), a per-name bucket (legacy `lobbyBuckets`), then the bounded store
//! (`max_profiles` names, `max_tabs` tabs each, legacy 512 / 8) with lazy expiry. The snapshot spends the same
//! per-address bucket. Names are user data on every consumer: they are JSON-escaped here and must be rendered as text.

use crate::api::limits::{limit_key, KeyedBuckets};
use crate::api::{
    err, json, method_not_allowed, with_retry_after, CorsPolicy, PROFILE_TOKEN_HEADER,
};
use crate::director::{Director, LobbyView};
use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const LOBBY_SNAPSHOT_PATH: &str = "/api/lobby";
pub const LOBBY_PRESENCE_PATH: &str = "/api/lobby/presence";
/// Legacy `express.json({ limit: "512b" })`.
pub const MAX_PRESENCE_BODY: usize = 512;
/// A whole presence body must arrive within this.
const BODY_TIMEOUT: Duration = Duration::from_secs(10);
/// A token longer than this is refused without a lookup (profile tokens are far shorter).
const MAX_TOKEN: usize = 256;
/// Token checks that may run at once (each may be a database query).
const AUTH_SLOTS: usize = 4;

#[derive(Clone, Debug)]
pub struct LobbyConfig {
    /// How long a heartbeat keeps a tab in the hub (legacy `LOBBY_PRESENCE_TTL_MS`, 45 s; the client beats every 15 s).
    pub ttl: Duration,
    /// Distinct names in the hub, and tabs per name (legacy 512 / 8). Past either, a new entry is refused 429.
    pub max_profiles: usize,
    pub max_tabs: usize,
    /// Per client address (IPv6: per /64), over the snapshot and both presence calls (either 0 = no limit).
    pub address_burst: f64,
    pub address_per_second: f64,
    /// Per verified name, over presence calls (legacy `KeyedTokenBuckets(10, 1)`).
    pub name_burst: f64,
    pub name_per_second: f64,
    /// The forwarded-address header and the proxies trusted to set it, with the account API's rule: the header is read
    /// only when named here AND the peer is loopback or listed; a repeated header counts as absent; a list uses its last
    /// entry.
    pub client_ip_header: Option<HeaderName>,
    pub trusted_proxies: Vec<IpAddr>,
    /// Bound on waiting for, and running, one token check.
    pub auth_timeout: Duration,
    /// Which origins may read the responses (the account API's `--api-cors-origins`; standalone default `*`).
    pub cors: CorsPolicy,
}

impl LobbyConfig {
    /// The defaults with the account API's forwarded-address settings (`--client-ip-header`, `--trusted-proxies`). The
    /// server binary builds the lobby this way, so behind its proxy each client keeps its own bucket.
    pub fn from_api(api: &crate::api::ApiConfig) -> Self {
        Self {
            client_ip_header: api.client_ip_header.clone(),
            trusted_proxies: api.trusted_proxies.clone(),
            cors: api.cors.clone(),
            ..Self::default()
        }
    }
}

impl Default for LobbyConfig {
    fn default() -> Self {
        Self {
            ttl: Duration::from_secs(45),
            max_profiles: 512,
            max_tabs: 8,
            address_burst: 40.0,
            address_per_second: 10.0,
            name_burst: 10.0,
            name_per_second: 1.0,
            client_ip_header: None,
            trusted_proxies: vec![],
            auth_timeout: Duration::from_secs(2),
            cors: CorsPolicy::Any,
        }
    }
}

// ---- the public shape ------------------------------------------------------------------------------------------

/// `GET /api/lobby`. Every field is listed here; nothing is serialized from internal state.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbySnapshot {
    /// Unix epoch milliseconds when this snapshot was made.
    server_now: u64,
    rooms: Vec<LobbyGame>,
    /// Names in the hub that are not seated in a room, sorted.
    waiting: Vec<LobbyPerson>,
    /// Distinct humans: waiting plus seated in a listed room.
    online_count: usize,
    arena_limit: usize,
    arena_room_count: usize,
    arena_available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LobbyGame {
    /// `lobby`, `planning`, `active` or `finished`.
    phase: &'static str,
    /// Unix epoch milliseconds; null until the raid starts.
    started_at: Option<u64>,
    /// The room's human minimum and the count bots top it up to (0: no fill): the "n/m" of a lobby line.
    human_min: usize,
    fill_target: usize,
    humans: usize,
    players: Vec<LobbyGamePlayer>,
}

#[derive(Clone, Debug, Serialize)]
struct LobbyGamePlayer {
    name: String,
    /// `human` or `bot`.
    kind: &'static str,
}

#[derive(Clone, Debug, Serialize)]
struct LobbyPerson {
    name: String,
}

fn phase_name(p: rh_sim::Phase) -> &'static str {
    match p {
        rh_sim::Phase::Lobby => "lobby",
        rh_sim::Phase::Planning => "planning",
        rh_sim::Phase::Active => "active",
        rh_sim::Phase::Ended => "finished",
    }
}

/// The snapshot from the director's view and the hub's names (`waiting` may hold seated names and duplicates; both are
/// dropped here, case-insensitively).
pub fn public_snapshot(view: &LobbyView, waiting: &[String], now_ms: u64) -> LobbySnapshot {
    let occupied: BTreeSet<String> = view
        .occupied
        .iter()
        .map(|n| n.to_ascii_lowercase())
        .collect();
    let mut hub: BTreeMap<String, &str> = BTreeMap::new();
    for name in waiting {
        let key = name.to_ascii_lowercase();
        if !occupied.contains(&key) {
            hub.entry(key).or_insert(name);
        }
    }
    let mut online: BTreeSet<String> = hub.keys().cloned().collect();
    let rooms = view
        .rooms
        .iter()
        .map(|r| {
            let players: Vec<LobbyGamePlayer> = r
                .players
                .iter()
                .map(|p| LobbyGamePlayer {
                    name: p.name.clone(),
                    kind: if p.bot { "bot" } else { "human" },
                })
                .collect();
            online.extend(
                r.players
                    .iter()
                    .filter(|p| !p.bot)
                    .map(|p| p.name.to_ascii_lowercase()),
            );
            LobbyGame {
                phase: phase_name(r.phase),
                started_at: r.started_at_ms,
                human_min: r.human_min,
                fill_target: r.fill_target,
                humans: r.players.iter().filter(|p| !p.bot).count(),
                players,
            }
        })
        .collect();
    LobbySnapshot {
        server_now: now_ms,
        rooms,
        waiting: hub
            .into_values()
            .map(|n| LobbyPerson { name: n.to_owned() })
            .collect(),
        online_count: online.len(),
        arena_limit: view.room_limit,
        arena_room_count: view.room_count,
        arena_available: view.joinable,
    }
}

// ---- hub presence ----------------------------------------------------------------------------------------------

struct Entry {
    /// The display name as last posted (the key is its lower case).
    name: String,
    tabs: BTreeMap<String, Instant>,
}

/// In-memory hub presence, bounded and lazily expired (legacy `LobbyStatus`): no timer runs while the hub is idle.
struct Presence {
    ttl: Duration,
    max_profiles: usize,
    max_tabs: usize,
    map: Mutex<BTreeMap<String, Entry>>,
}

impl Presence {
    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, Entry>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn expire(map: &mut BTreeMap<String, Entry>, now: Instant) {
        map.retain(|_, e| {
            e.tabs.retain(|_, until| *until > now);
            !e.tabs.is_empty()
        });
    }

    /// False when the hub or this name's tabs are full (nothing recorded).
    fn touch(&self, name: &str, tab: &str, now: Instant) -> bool {
        let mut map = self.lock();
        Self::expire(&mut map, now);
        let key = name.to_ascii_lowercase();
        if !map.contains_key(&key) && map.len() >= self.max_profiles {
            return false;
        }
        let e = map.entry(key).or_insert_with(|| Entry {
            name: name.to_owned(),
            tabs: BTreeMap::new(),
        });
        if !e.tabs.contains_key(tab) && e.tabs.len() >= self.max_tabs {
            return false;
        }
        name.clone_into(&mut e.name);
        e.tabs.insert(tab.to_owned(), now + self.ttl);
        true
    }

    fn leave(&self, name: &str, tab: &str) {
        let mut map = self.lock();
        let key = name.to_ascii_lowercase();
        if let Some(e) = map.get_mut(&key) {
            e.tabs.remove(tab);
            if e.tabs.is_empty() {
                map.remove(&key);
            }
        }
    }

    fn names(&self, now: Instant) -> Vec<String> {
        let mut map = self.lock();
        Self::expire(&mut map, now);
        map.values().map(|e| e.name.clone()).collect()
    }
}

// ---- HTTP ------------------------------------------------------------------------------------------------------

struct Lobby {
    d: Arc<Director>,
    cfg: LobbyConfig,
    presence: Presence,
    addresses: KeyedBuckets<IpAddr>,
    names: KeyedBuckets<String>,
    auth_slots: tokio::sync::Semaphore,
}

type St = Arc<Lobby>;

/// The lobby routes, to merge into the public router.
pub fn router(director: Arc<Director>, cfg: LobbyConfig) -> Router {
    let st: St = Arc::new(Lobby {
        d: director,
        presence: Presence {
            ttl: cfg.ttl,
            max_profiles: cfg.max_profiles,
            max_tabs: cfg.max_tabs,
            map: Mutex::default(),
        },
        addresses: KeyedBuckets::new(cfg.address_burst, cfg.address_per_second),
        names: KeyedBuckets::new(cfg.name_burst, cfg.name_per_second),
        auth_slots: tokio::sync::Semaphore::new(AUTH_SLOTS),
        cfg,
    });
    Router::new()
        .route(LOBBY_SNAPSHOT_PATH, get(snapshot).options(preflight))
        .route(
            LOBBY_PRESENCE_PATH,
            post(|s: State<St>, r: Request| presence(s, r, false))
                .delete(|s: State<St>, r: Request| presence(s, r, true))
                .options(preflight)
                .fallback(|| async { method_not_allowed("POST, DELETE, OPTIONS") }),
        )
        .layer(from_fn_with_state(st.clone(), public_headers))
        .with_state(st)
}

/// Every lobby response is uncached and carries the CORS answer of the rest of `/api` (`--api-cors-origins`): `*`, or the
/// request's origin when it is on the allowlist (with `Vary: Origin`). No credential rides on CORS.
async fn public_headers(State(st): State<St>, req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut r = next.run(req).await;
    let h = r.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let allow = match &st.cfg.cors {
        CorsPolicy::Any => Some(HeaderValue::from_static("*")),
        CorsPolicy::Origins(list) => origin
            .filter(|o| list.iter().any(|a| a.eq_ignore_ascii_case(o)))
            .and_then(|o| HeaderValue::from_str(&o).ok()),
    };
    if let Some(v) = allow {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    if matches!(st.cfg.cors, CorsPolicy::Origins(_)) {
        h.append(header::VARY, HeaderValue::from_static("Origin"));
    }
    r
}

async fn preflight() -> Response {
    let mut r = Response::new(Body::empty());
    *r.status_mut() = StatusCode::NO_CONTENT;
    let h = r.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("x-profile-token, x-playtest-passcode, content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    r
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl Lobby {
    fn snapshot(&self, now: Instant) -> Response {
        let view = self.d.lobby_view();
        let waiting = self.presence.names(now);
        Json(public_snapshot(&view, &waiting, epoch_ms())).into_response()
    }

    /// The per-address bucket: `Some` is the 429 to answer.
    fn refuse(&self, req: &Request, now: Instant) -> Option<Response> {
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip().to_canonical());
        let ip = client_ip(&self.cfg, peer, req.headers());
        if self.addresses.take(&limit_key(ip), now) {
            return None;
        }
        let wait = Duration::from_secs_f64((1.0 / self.cfg.address_per_second).min(60.0));
        Some(with_retry_after(
            err(StatusCode::TOO_MANY_REQUESTS, "too many requests"),
            wait,
        ))
    }
}

/// The account API's rule (`api.rs` `client_ip`), for this router's own config.
fn client_ip(cfg: &LobbyConfig, peer: Option<IpAddr>, headers: &HeaderMap) -> IpAddr {
    let peer = peer.unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let Some(name) = &cfg.client_ip_header else {
        return peer;
    };
    if !(peer.is_loopback() || cfg.trusted_proxies.contains(&peer)) {
        return peer;
    }
    let mut values = headers.get_all(name).iter();
    let (Some(v), None) = (values.next(), values.next()) else {
        return peer;
    };
    v.to_str()
        .ok()
        .and_then(|s| s.rsplit(',').next())
        .and_then(|s| s.trim().parse::<IpAddr>().ok())
        .map_or(peer, |ip| ip.to_canonical())
}

async fn snapshot(State(st): State<St>, req: Request) -> Response {
    let now = Instant::now();
    if let Some(r) = st.refuse(&req, now) {
        return r;
    }
    st.snapshot(now)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PresenceBody {
    name: String,
    tab_id: String,
}

/// `[A-Za-z0-9_-]{min,max}`: legacy `PROFILE_RE` (2..16) and the tab id (8..128).
fn token_chars(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn bad_request(msg: &str) -> Response {
    json(
        StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": msg, "code": "bad_request" }),
    )
}

async fn presence(State(st): State<St>, req: Request, leave: bool) -> Response {
    let now = Instant::now();
    if let Some(r) = st.refuse(&req, now) {
        return r;
    }
    let is_json = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        return err(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "expected application/json",
        );
    }
    let mut tokens = req.headers().get_all(PROFILE_TOKEN_HEADER).iter();
    let token = match (tokens.next(), tokens.next()) {
        (Some(v), None) => v.to_str().unwrap_or("").to_owned(),
        _ => String::new(),
    };
    let body = match tokio::time::timeout(
        BODY_TIMEOUT,
        axum::body::to_bytes(req.into_body(), MAX_PRESENCE_BODY),
    )
    .await
    {
        Ok(Ok(b)) => b,
        Ok(Err(_)) => return err(StatusCode::PAYLOAD_TOO_LARGE, "request body too large"),
        Err(_) => return err(StatusCode::REQUEST_TIMEOUT, "request timed out"),
    };
    let Ok(PresenceBody { name, tab_id }) = serde_json::from_slice(&body) else {
        return bad_request("malformed request");
    };
    if !token_chars(&name, 2, 16) || !token_chars(&tab_id, 8, 128) {
        return bad_request("invalid name or tab id");
    }
    // The same credential check admission makes (`Auth::verify`): a development server (`Auth::Dev`) takes any token.
    let verified = if token.len() > MAX_TOKEN {
        Some(false)
    } else {
        let check = async {
            let _slot = st.auth_slots.acquire().await.ok()?;
            // A credential-store failure is "unavailable", never "someone else's profile" (fix/server-security).
            st.d.auth.verify(&name, token.as_bytes()).await.ok()
        };
        tokio::time::timeout(st.cfg.auth_timeout, check)
            .await
            .ok()
            .flatten()
    };
    match verified {
        Some(true) => {}
        Some(false) => return err(StatusCode::FORBIDDEN, "profile belongs to someone else"),
        None => return err(StatusCode::SERVICE_UNAVAILABLE, "profile check unavailable"),
    }
    if !st.names.take(&name.to_ascii_lowercase(), now) {
        return with_retry_after(
            err(StatusCode::TOO_MANY_REQUESTS, "presence updated too often"),
            Duration::from_secs(1),
        );
    }
    if leave {
        st.presence.leave(&name, &tab_id);
    } else if !st.presence.touch(&name, &tab_id, now) {
        return err(StatusCode::TOO_MANY_REQUESTS, "lobby presence is full");
    }
    st.snapshot(now)
}
