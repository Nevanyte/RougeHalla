//! The profile/account HTTP service: the legacy `/api/*` contracts of `packages/server/src/index.ts` on the Rust server.
//!
//! * `GET  /api/profile/:name`          claim a free name (fresh token returned once) or open it (token header, else 403)
//! * `POST /api/profile/:name/purchase` buy a cosmetic (token; idempotent; race-safe)
//! * `POST /api/profile/:name/equip`    equip/unequip an owned cosmetic (token)
//! * `GET  /api/leaderboard`            monthly GV ranking (`you` only for the profile's own token)
//! * `GET  /api/health`, `GET /readyz`  liveness and readiness
//!
//! Placement (ADR 0006 addendum): served on the PUBLIC listener beside `/ws`, never on the control listener. The
//! profile token travels in the `x-profile-token` header (never a cookie, never a URL), so CORS carries no credentials.
//!
//! Layers, outermost first (`edge`): client address resolution, CORS (preflight answered here), a whole-request timeout,
//! `Cache-Control: no-store`. Rate limits and the passcode gate live in [`limits`] and are called by the handlers; each can
//! be set to 0 to hand that job to an edge limiter. Request bodies are capped at 1 KiB and parsed as strict JSON.
//!
//! Peer address and proxies: the key of every per-address cap is the TCP peer. A forwarded-address header is read ONLY
//! when `ApiConfig::client_ip_header` names one AND the peer is loopback or listed in `trusted_proxies`; a repeated header
//! counts as absent and a comma list uses its LAST entry (the one the trusted proxy appended). `X-Forwarded-For` is never
//! read unless it is the configured header.
//!
//! Without a database (`--database-url` absent, or a build without the `postgres` feature) the profile, shop and leaderboard
//! routes answer 503 `storage_unavailable`; `/api/health` and `/readyz` still work. No route here logs or returns a secret.

pub mod limits;
#[cfg(feature = "postgres")]
mod profile;

use crate::director::Director;
use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use limits::{AddressWindowLimiter, KeyedBuckets, PasscodeGate};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Legacy header names (`packages/shared/src/messages.ts`).
pub const PROFILE_TOKEN_HEADER: &str = "x-profile-token";
pub const PASSCODE_HEADER: &str = "x-playtest-passcode";
pub const IDEMPOTENCY_HEADER: &str = "idempotency-key";
/// Shop bodies are a few dozen bytes (legacy `SHOP_BODY_LIMIT`).
pub const MAX_BODY_BYTES: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CorsPolicy {
    /// `Access-Control-Allow-Origin: *` (legacy development mode; the API is credential-free).
    Any,
    /// Only these origins (lower case, no trailing slash) get an allow header (legacy hosting mode). Empty: none.
    Origins(Vec<String>),
}

#[derive(Clone)]
pub struct ApiConfig {
    /// The playtest passcode, required to claim a new name. Never printed (see the `Debug` impl).
    pub passcode: Option<String>,
    /// New profiles in a trailing hour over the whole process / per client address (legacy 30 / 10; 0 = no limit).
    pub new_profiles_per_hour: u32,
    pub new_profiles_per_ip_per_hour: u32,
    /// Wrong passcodes a minute per address / over the process (legacy 6 / 40; 0 = no limit).
    pub passcode_fails_per_minute: u32,
    pub passcode_fails_per_minute_all: u32,
    /// One profile's shop/equip bucket (legacy burst 6, 3 a second; 0 = no limit).
    pub shop_burst: f64,
    pub shop_per_second: f64,
    /// Per client address (IPv6: per /64), over every `/api/profile*` and `/api/leaderboard` request, checked BEFORE any
    /// database query: a burst, then a steady rate a second (either 0 = no limit, for an edge limiter to own).
    pub lookup_burst: f64,
    pub lookup_per_second: f64,
    /// How many account-API requests may use the database at once (0 = unbounded). The account API shares the pool with
    /// lease and result writes; this keeps a flood of anonymous lookups from taking every connection.
    pub db_concurrency: usize,
    /// How long a request waits for one of those slots before it is answered 503.
    pub db_queue_wait: Duration,
    pub cors: CorsPolicy,
    pub client_ip_header: Option<HeaderName>,
    pub trusted_proxies: Vec<IpAddr>,
    /// Bound on a whole request, body read included.
    pub request_timeout: Duration,
    /// Longest a leaderboard page may be served from cache (it is also dropped when this process credits GV).
    pub leaderboard_ttl: Duration,
    pub storage_probe_timeout: Duration,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            passcode: None,
            new_profiles_per_hour: 30,
            new_profiles_per_ip_per_hour: 10,
            passcode_fails_per_minute: 6,
            passcode_fails_per_minute_all: 40,
            shop_burst: 6.0,
            shop_per_second: 3.0,
            lookup_burst: 40.0,
            lookup_per_second: 20.0,
            db_concurrency: 6,
            db_queue_wait: Duration::from_secs(2),
            cors: CorsPolicy::Origins(vec![]),
            client_ip_header: None,
            trusted_proxies: vec![],
            request_timeout: Duration::from_secs(10),
            leaderboard_ttl: Duration::from_secs(5),
            storage_probe_timeout: Duration::from_secs(2),
        }
    }
}

impl std::fmt::Debug for ApiConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApiConfig")
            .field("passcode", &self.passcode.as_ref().map(|_| "<set>"))
            .field("new_profiles_per_hour", &self.new_profiles_per_hour)
            .field("cors", &self.cors)
            .field("client_ip_header", &self.client_ip_header)
            .finish_non_exhaustive()
    }
}

/// The account service's dependencies: its config and (with the `postgres` feature and a database) the store.
pub struct AccountApi {
    cfg: ApiConfig,
    #[cfg(feature = "postgres")]
    store: Option<Arc<rh_persist::Store>>,
}

impl AccountApi {
    /// No database: profile routes answer 503.
    pub fn disabled(cfg: ApiConfig) -> Self {
        Self {
            cfg,
            #[cfg(feature = "postgres")]
            store: None,
        }
    }

    #[cfg(feature = "postgres")]
    pub fn postgres(store: Arc<rh_persist::Store>, cfg: ApiConfig) -> Self {
        Self {
            cfg,
            store: Some(store),
        }
    }
}

#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) struct Shared {
    pub cfg: ApiConfig,
    pub new_profiles: AddressWindowLimiter,
    pub passcode: PasscodeGate,
    pub shop: KeyedBuckets<i64>,
    /// Per-address (/64) bucket for every profile and leaderboard request, spent before any database query.
    pub lookups: KeyedBuckets<IpAddr>,
    /// The account API's own bound on concurrent database users (`None` = unbounded).
    pub db_slots: Option<Arc<tokio::sync::Semaphore>>,
    #[cfg(feature = "postgres")]
    pub store: Option<Arc<rh_persist::Store>>,
    #[cfg(feature = "postgres")]
    pub board: Mutex<profile::Board>,
    probe: Mutex<Option<(Instant, bool)>>,
}

#[derive(Clone)]
pub(crate) struct St {
    pub d: Arc<Director>,
    pub a: Arc<Shared>,
}

/// The client address a request counts under (set by `edge`).
#[derive(Clone, Copy)]
#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) struct ClientAddr(pub IpAddr);

/// The account/health routes, to merge into the public router.
pub fn router(director: Arc<Director>, api: AccountApi) -> Router {
    let cfg = api.cfg;
    let hour = Duration::from_secs(3600);
    let shared = Arc::new(Shared {
        new_profiles: AddressWindowLimiter::new(
            cfg.new_profiles_per_hour,
            cfg.new_profiles_per_ip_per_hour,
            hour,
        ),
        passcode: PasscodeGate::new(
            cfg.passcode.as_deref(),
            cfg.passcode_fails_per_minute,
            cfg.passcode_fails_per_minute_all,
        ),
        shop: KeyedBuckets::new(cfg.shop_burst, cfg.shop_per_second),
        lookups: KeyedBuckets::new(cfg.lookup_burst, cfg.lookup_per_second),
        db_slots: (cfg.db_concurrency > 0)
            .then(|| Arc::new(tokio::sync::Semaphore::new(cfg.db_concurrency))),
        #[cfg(feature = "postgres")]
        store: api.store,
        #[cfg(feature = "postgres")]
        board: Mutex::default(),
        probe: Mutex::new(None),
        cfg,
    });
    let st = St {
        d: director,
        a: shared,
    };
    let router = Router::new()
        .route("/readyz", get(readyz))
        .route("/api/health", get(health));
    #[cfg(feature = "postgres")]
    let router = if st.a.store.is_some() {
        router.merge(profile::routes().route_layer(from_fn_with_state(st.clone(), profile::guard)))
    } else {
        router.merge(unavailable_routes())
    };
    #[cfg(not(feature = "postgres"))]
    let router = router.merge(unavailable_routes());
    router
        .route("/api/{*rest}", any(not_found))
        .layer(from_fn_with_state(st.clone(), edge))
        .with_state(st)
}

fn unavailable_routes() -> Router<St> {
    Router::new()
        .route("/api/profile/{name}", any(unavailable))
        .route("/api/profile/{name}/purchase", any(unavailable))
        .route("/api/profile/{name}/equip", any(unavailable))
        .route("/api/leaderboard", any(unavailable))
}

async fn unavailable() -> Response {
    json(
        StatusCode::SERVICE_UNAVAILABLE,
        serde_json::json!({
            "error": "profile service unavailable: this server runs without a database",
            "code": "storage_unavailable",
        }),
    )
}

async fn not_found() -> Response {
    err(StatusCode::NOT_FOUND, "not found")
}

async fn health() -> Response {
    json(StatusCode::OK, serde_json::json!({ "ok": true }))
}

/// Readiness: ready only while the lifecycle is `ready` (not starting, draining or terminated) and storage answers.
async fn readyz(State(st): State<St>) -> Response {
    let storage = storage_state(&st).await;
    let ok = st.d.lifecycle.healthy() && storage != "unavailable";
    json(
        if ok {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        serde_json::json!({
            "ok": ok,
            "state": st.d.lifecycle.state_name(),
            "storage": storage,
        }),
    )
}

/// `memory` (no database), `ok` or `unavailable`. The probe is bounded and its answer cached for a second so an anonymous
/// caller cannot turn `/readyz` into a database load.
async fn storage_state(_st: &St) -> &'static str {
    #[cfg(feature = "postgres")]
    if let Some(store) = &_st.a.store {
        let now = Instant::now();
        if let Some((at, ok)) = *_st.a.probe.lock().unwrap_or_else(|p| p.into_inner()) {
            if now.saturating_duration_since(at) < Duration::from_secs(1) {
                return if ok { "ok" } else { "unavailable" };
            }
        }
        let ok = matches!(
            tokio::time::timeout(_st.a.cfg.storage_probe_timeout, store.ping()).await,
            Ok(Ok(()))
        );
        *_st.a.probe.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), ok));
        return if ok { "ok" } else { "unavailable" };
    }
    let _ = &_st.a.probe;
    "memory"
}

// ---- responses ------------------------------------------------------------------------------------------------

pub(crate) fn json(status: StatusCode, body: serde_json::Value) -> Response {
    (status, Json(body)).into_response()
}

pub(crate) fn err(status: StatusCode, msg: &str) -> Response {
    json(status, serde_json::json!({ "error": msg }))
}

#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) fn with_retry_after(mut r: Response, wait: Duration) -> Response {
    let secs = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
    r.headers_mut().insert(
        header::RETRY_AFTER,
        HeaderValue::from_str(&secs.max(1).to_string()).expect("digits"),
    );
    r
}

#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) fn method_not_allowed(allow: &'static str) -> Response {
    let mut r = err(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    r.headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(allow));
    r
}

/// Failures are counted in the log without detail that could carry anything but a database message; at most one line a second.
#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) fn log_internal(route: &str, e: &dyn std::fmt::Display) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST: AtomicU64 = AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    if LAST.swap(now, Ordering::Relaxed) != now {
        eprintln!("[api] {route} failed: {e}");
    }
}

// ---- edge layer -----------------------------------------------------------------------------------------------

fn client_ip(cfg: &ApiConfig, peer: Option<IpAddr>, headers: &HeaderMap) -> IpAddr {
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

fn cors_origin(cfg: &ApiConfig, origin: Option<&str>) -> Option<HeaderValue> {
    match &cfg.cors {
        CorsPolicy::Any => Some(HeaderValue::from_static("*")),
        CorsPolicy::Origins(list) => {
            let o = origin?;
            list.iter()
                .any(|a| a.eq_ignore_ascii_case(o))
                .then(|| HeaderValue::from_str(o).ok())
                .flatten()
        }
    }
}

fn apply_cors(cfg: &ApiConfig, origin: Option<&str>, headers: &mut HeaderMap) {
    if let Some(v) = cors_origin(cfg, origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    if matches!(cfg.cors, CorsPolicy::Origins(_)) {
        headers.append(header::VARY, HeaderValue::from_static("Origin"));
    }
}

async fn edge(State(st): State<St>, mut req: Request, next: Next) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip().to_canonical());
    let ip = client_ip(&st.a.cfg, peer, req.headers());
    req.extensions_mut().insert(ClientAddr(ip));
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let is_api = req.uri().path().starts_with("/api/");
    let mut resp = if is_api && req.method() == Method::OPTIONS {
        let mut r = Response::new(Body::empty());
        *r.status_mut() = StatusCode::NO_CONTENT;
        let h = r.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        h.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(
                "x-profile-token, x-playtest-passcode, content-type, idempotency-key",
            ),
        );
        h.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
        r
    } else {
        match tokio::time::timeout(st.a.cfg.request_timeout, next.run(req)).await {
            Ok(r) => r,
            Err(_) => err(StatusCode::REQUEST_TIMEOUT, "request timed out"),
        }
    };
    if is_api {
        apply_cors(&st.a.cfg, origin.as_deref(), resp.headers_mut());
    }
    resp.headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    resp
}

/// `YYYY-MM` (UTC) of a Unix time: the legacy `monthKey`.
pub fn month_key(unix_secs: i64) -> String {
    let z = unix_secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}")
}

#[cfg_attr(not(feature = "postgres"), allow(dead_code))]
pub(crate) fn current_month() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    month_key(secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_key_is_utc_calendar_month() {
        assert_eq!(month_key(0), "1970-01");
        assert_eq!(month_key(951_782_400), "2000-02"); // 2000-02-29
        assert_eq!(month_key(1_709_251_199), "2024-02"); // 2024-02-29T23:59:59Z
        assert_eq!(month_key(1_709_251_200), "2024-03");
        assert_eq!(month_key(1_798_761_599), "2026-12"); // 2026-12-31T23:59:59Z
        assert_eq!(month_key(1_798_761_600), "2027-01");
    }

    #[test]
    fn forwarded_header_is_ignored_unless_configured_and_trusted() {
        let mut h = HeaderMap::new();
        h.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.1.1.1, 2.2.2.2"),
        );
        let peer: IpAddr = "10.0.0.9".parse().unwrap();
        let lo: IpAddr = "127.0.0.1".parse().unwrap();
        let mut cfg = ApiConfig::default();
        assert_eq!(client_ip(&cfg, Some(lo), &h), lo, "not configured");
        cfg.client_ip_header = Some(HeaderName::from_static("x-forwarded-for"));
        assert_eq!(client_ip(&cfg, Some(peer), &h), peer, "untrusted peer");
        assert_eq!(
            client_ip(&cfg, Some(lo), &h),
            "2.2.2.2".parse::<IpAddr>().unwrap()
        );
        cfg.trusted_proxies.push(peer);
        assert_eq!(
            client_ip(&cfg, Some(peer), &h),
            "2.2.2.2".parse::<IpAddr>().unwrap()
        );
        h.append("x-forwarded-for", HeaderValue::from_static("3.3.3.3"));
        assert_eq!(client_ip(&cfg, Some(peer), &h), peer, "repeated header");
        let mut bad = HeaderMap::new();
        bad.insert("x-forwarded-for", HeaderValue::from_static("not-an-ip"));
        assert_eq!(client_ip(&cfg, Some(peer), &bad), peer);
    }
}
