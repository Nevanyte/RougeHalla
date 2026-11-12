//! Roguehalla live server: the thin adapter between sockets/wall clock/hosting and the deterministic core (rh-sim).
//! See docs/CONTRACTS.md (C-NET, C-TICK) and docs/adr/0002-transport-and-protocol.md, 0004-hosting.md.

pub mod api;
pub mod bot_fill;
pub mod bot_learning;
pub mod conn;
pub mod control;
pub mod director;
pub mod edge;
pub mod hosting;
pub mod lobby;
pub mod map_pool;
pub mod metrics;
pub mod outbox;
pub mod pacer;
pub mod persist;
pub mod public_ground;
pub mod room;
pub mod runtime;
pub mod signature;
#[cfg(feature = "postgres")]
pub mod spool;
pub mod wire;
pub mod wire_state;

use axum::extract::{ConnectInfo, State, WebSocketUpgrade};
use axum::http::{header, Extensions, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use axum_server::accept::Accept;
use axum_server::tls_rustls::{RustlsAcceptor, RustlsConfig};
use axum_server::Handle;
use director::Director;
use edge::{EdgeConfig, EdgeGuard, FirstRequestAcceptor, HttpLimits};
use std::future::Ready;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpStream;

pub const PROBE_PAGE: &str = include_str!("../web/probe.html");

/// The public listener: the WebSocket endpoint, health, info, the latency probe and the browser proof page, guarded by an
/// [`EdgeGuard`] with [`EdgeConfig::default`] (production limits, any origin). main.rs uses [`public_router_guarded`].
pub fn public_router(director: Arc<Director>) -> Router {
    public_router_guarded(director, EdgeGuard::new(EdgeConfig::default()))
}

/// [`public_router`] with a caller-configured edge guard (`/ws` limits and origins, `/ping` CORS).
pub fn public_router_guarded(director: Arc<Director>, guard: Arc<EdgeGuard>) -> Router {
    let guarded = Router::new()
        .route("/ws", get(ws))
        .route("/ping", get(ping))
        .with_state(WsState {
            director: director.clone(),
            guard,
        });
    Router::new()
        .route("/healthz", get(healthz))
        .route("/info", get(info))
        .route("/probe", get(|| async { Html(PROBE_PAGE) }))
        .with_state(director)
        .merge(guarded)
}

/// [`public_router`] plus the account service (`/api/*`, `/readyz`): profile claim/open, shop, leaderboard, health. Serve it
/// with [`serve`], which provides the peer address the per-address caps are keyed by.
/// It also serves the public lobby activity endpoint (`/api/lobby`, `/api/lobby/presence`) with its default settings.
pub fn public_router_with_api(director: Arc<Director>, api: api::AccountApi) -> Router {
    public_router_with_lobby(director, api, lobby::LobbyConfig::default())
}

/// [`public_router_with_api`] with the lobby activity endpoint's settings (limits, forwarded-address header).
pub fn public_router_with_lobby(
    director: Arc<Director>,
    api: api::AccountApi,
    lobby: lobby::LobbyConfig,
) -> Router {
    public_router(director.clone())
        .merge(lobby::router(director.clone(), lobby))
        .merge(api::router(director, api))
}

/// [`public_router_with_api`] with a caller-configured edge guard (main.rs).
pub fn public_router_with_api_guarded(
    director: Arc<Director>,
    api: api::AccountApi,
    guard: Arc<EdgeGuard>,
) -> Router {
    public_router_guarded(director.clone(), guard).merge(api::router(director, api))
}

/// The server binary's public listener: [`public_router_with_api_guarded`] plus the lobby activity endpoint with its
/// settings (`/api/lobby`, `/api/lobby/presence`), as [`public_router_with_lobby`] serves it.
pub fn public_router_with_lobby_guarded(
    director: Arc<Director>,
    api: api::AccountApi,
    lobby: lobby::LobbyConfig,
    guard: Arc<EdgeGuard>,
) -> Router {
    public_router_guarded(director.clone(), guard)
        .merge(lobby::router(director.clone(), lobby))
        .merge(api::router(director, api))
}

/// The local control listener for the hosting bridge (bind it to 127.0.0.1 only; main.rs asserts it). Control routes live
/// only here, never in [`public_router`].
pub fn control_router(director: Arc<Director>) -> Router {
    control::router(director, control::ControlOptions::default())
}

/// [`control_router`] with options (the optional bearer token).
pub fn control_router_with(director: Arc<Director>, opts: control::ControlOptions) -> Router {
    control::router(director, opts)
}

/// Per-connection WebSocket read buffer. Client frames are at most `MAX_CLIENT_FRAME` (1 KiB) plus a 14-byte header, so
/// 4 KiB holds several; tungstenite's default of 128 KiB was 92% of the heap peak with 64 idle connections.
pub const WS_READ_BUFFER: usize = 4 * 1024;
/// Target size at which tungstenite writes its out-buffer to the socket (every send is flushed anyway; this only bounds
/// what a burst of queued frames collects before the first socket write). Default is 128 KiB.
pub const WS_WRITE_BUFFER: usize = 16 * 1024;
/// Hard cap on the out-buffer: it can only grow past `WS_WRITE_BUFFER` while socket writes are stalling, and it must hold
/// the buffered bytes plus the largest server frame (`MAX_SERVER_FRAME`) the writer may still feed. Past it the send
/// fails and the connection ends, the same end a stalled client reaches through `SEND_TIMEOUT`.
pub const WS_MAX_WRITE_BUFFER: usize = WS_WRITE_BUFFER + 2 * rh_protocol::MAX_SERVER_FRAME;

#[derive(Clone)]
struct WsState {
    director: Arc<Director>,
    guard: Arc<EdgeGuard>,
}

/// The edge checks run before the upgrade (a refused socket gets a plain 403/429/503 and is never upgraded); the ticket then
/// lives as long as the connection.
async fn ws(
    upgrade: WebSocketUpgrade,
    State(s): State<WsState>,
    headers: HeaderMap,
    ext: Extensions,
) -> Response {
    let peer = ext.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
    let ticket = match s.guard.admit_ws(peer, &headers) {
        Ok(t) => t,
        Err(refused) => return refused.into_response(),
    };
    let d = s.director;
    upgrade
        .read_buffer_size(WS_READ_BUFFER)
        .write_buffer_size(WS_WRITE_BUFFER)
        .max_write_buffer_size(WS_MAX_WRITE_BUFFER)
        .max_message_size(rh_protocol::MAX_CLIENT_FRAME)
        .max_frame_size(rh_protocol::MAX_CLIENT_FRAME)
        .on_upgrade(move |sock| conn::serve_guarded(sock, d, Some(ticket)))
}

async fn healthz(State(d): State<Arc<Director>>) -> impl IntoResponse {
    if d.lifecycle.healthy() || d.lifecycle.state_name() == "draining" {
        (StatusCode::OK, "ok")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready")
    }
}

/// The public identity a client or probe needs: protocol, content hash and the coarse lifecycle state. Room, player and
/// result counters are on the loopback control listener (`GET /control/info`).
async fn info(State(d): State<Arc<Director>>) -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Json(d.public_info()))
}

/// The regional latency probe a browser times (docs/hosting/LATENCY_PROBES.md): tiny, uncached, served by the game
/// process itself so it measures the same path as the game's WebSocket. Readable cross-origin by the `/ws` origin policy
/// (`*` only when that policy is "any origin").
async fn ping(State(s): State<WsState>, headers: HeaderMap) -> Response {
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let mut r = ([(header::CACHE_CONTROL, "no-store")], "pong").into_response();
    let policy = &s.guard.config().origins;
    if let Some(v) = policy.cors_allow(origin) {
        r.headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    if !matches!(policy, edge::OriginPolicy::Any) {
        r.headers_mut()
            .append(header::VARY, HeaderValue::from_static("Origin"));
    }
    r
}

/// Callback run on every accepted TCP stream after `TCP_NODELAY` was applied (tests read the socket option back here).
pub type AcceptHook = Arc<dyn Fn(&TcpStream) + Send + Sync>;

/// The production acceptor: sets `TCP_NODELAY` on every accepted socket, before any TLS handshake wraps it. Up to three
/// small frames per client per tick would otherwise wait on Nagle and the peer's delayed ACK.
///
/// Why this type and not `axum_server::accept::NoDelayAcceptor`: that one does exactly the same `set_nodelay(true)` and
/// nothing else. This one adds the accept hook, which runs on the accepted `TcpStream` right after the option is set. Once
/// `RustlsAcceptor` wraps the stream the socket is out of reach, so the hook is the only place the transport tests can
/// read `TCP_NODELAY` back from the real production acceptor (plain and TLS alike). With no hook (production) the two
/// behave identically; swap to the stock acceptor only if those tests find another way to observe the socket.
#[derive(Clone, Default)]
pub struct NoDelay {
    hook: Option<AcceptHook>,
}

impl NoDelay {
    pub fn new() -> Self {
        Self::default()
    }

    /// The same acceptor, additionally calling `hook` with each accepted stream once nodelay is set.
    pub fn with_hook(hook: AcceptHook) -> Self {
        Self { hook: Some(hook) }
    }
}

impl<S> Accept<TcpStream, S> for NoDelay {
    type Stream = TcpStream;
    type Service = S;
    type Future = Ready<io::Result<(TcpStream, S)>>;

    fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
        let done = stream.set_nodelay(true).map(|()| {
            if let Some(hook) = &self.hook {
                hook(&stream);
            }
            (stream, service)
        });
        std::future::ready(done)
    }
}

/// Serve `router` on `bind`: wss/https when `tls` is given, plain ws/http otherwise. This is the one production serve
/// path (main.rs and the tests both run it). `handle` carries graceful shutdown and the bound address.
pub async fn serve(
    bind: SocketAddr,
    tls: Option<RustlsConfig>,
    router: Router,
    handle: Handle,
) -> io::Result<()> {
    serve_with(bind, tls, router, handle, NoDelay::new()).await
}

/// [`serve`] with a caller-supplied [`NoDelay`] (a test's accept hook).
pub async fn serve_with(
    bind: SocketAddr,
    tls: Option<RustlsConfig>,
    router: Router,
    handle: Handle,
    acceptor: NoDelay,
) -> io::Result<()> {
    serve_with_limits(bind, tls, router, handle, acceptor, HttpLimits::default()).await
}

/// [`serve_with`] with explicit HTTP limits (`--http-header-timeout-secs`). Every accepted connection must show its HTTP
/// version within the header timeout ([`FirstRequestAcceptor`], after TLS when TLS is on) and hyper bounds every HTTP/1
/// request head, idle keep-alive included, by the same timeout ([`edge::configure_http`]).
pub async fn serve_with_limits(
    bind: SocketAddr,
    tls: Option<RustlsConfig>,
    router: Router,
    handle: Handle,
    acceptor: NoDelay,
    limits: HttpLimits,
) -> io::Result<()> {
    let svc = router.into_make_service_with_connect_info::<SocketAddr>();
    let deadline = limits.header_read_timeout;
    match tls {
        Some(cfg) => {
            let mut server = axum_server::bind(bind)
                .acceptor(FirstRequestAcceptor::new(
                    RustlsAcceptor::new(cfg).acceptor(acceptor),
                    deadline,
                ))
                .handle(handle);
            edge::configure_http(server.http_builder(), limits);
            server.serve(svc).await
        }
        None => {
            let mut server = axum_server::bind(bind)
                .acceptor(FirstRequestAcceptor::new(acceptor, deadline))
                .handle(handle);
            edge::configure_http(server.http_builder(), limits);
            server.serve(svc).await
        }
    }
}
