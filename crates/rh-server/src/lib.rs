//! Roguehalla live server: the thin adapter between sockets/wall clock/hosting and the deterministic core (rh-sim).
//! See docs/CONTRACTS.md (C-NET, C-TICK) and docs/adr/0002-transport-and-protocol.md, 0004-hosting.md.

pub mod conn;
pub mod director;
pub mod hosting;
pub mod metrics;
pub mod outbox;
pub mod pacer;
pub mod persist;
pub mod room;
pub mod wire;

use axum::extract::{State, WebSocketUpgrade};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_server::accept::Accept;
use axum_server::tls_rustls::{RustlsAcceptor, RustlsConfig};
use axum_server::Handle;
use director::Director;
use std::future::Ready;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpStream;

pub const PROBE_PAGE: &str = include_str!("../web/probe.html");

/// The public listener: the WebSocket endpoint, health, info, the latency probe and the browser proof page.
pub fn public_router(director: Arc<Director>) -> Router {
    Router::new()
        .route("/ws", get(ws))
        .route("/healthz", get(healthz))
        .route("/info", get(info))
        .route("/ping", get(ping))
        .route("/probe", get(|| async { Html(PROBE_PAGE) }))
        .with_state(director)
}

/// The local control listener for the hosting bridge (bind it to 127.0.0.1 only).
pub fn control_router(director: Arc<Director>) -> Router {
    Router::new()
        .route("/control/health", get(control_health))
        .route("/control/drain", post(control_drain))
        .with_state(director)
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

async fn ws(upgrade: WebSocketUpgrade, State(d): State<Arc<Director>>) -> Response {
    upgrade
        .read_buffer_size(WS_READ_BUFFER)
        .write_buffer_size(WS_WRITE_BUFFER)
        .max_write_buffer_size(WS_MAX_WRITE_BUFFER)
        .max_message_size(rh_protocol::MAX_CLIENT_FRAME)
        .max_frame_size(rh_protocol::MAX_CLIENT_FRAME)
        .on_upgrade(move |sock| conn::serve(sock, d))
}

async fn healthz(State(d): State<Arc<Director>>) -> impl IntoResponse {
    if d.lifecycle.healthy() || d.lifecycle.state_name() == "draining" {
        (StatusCode::OK, "ok")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready")
    }
}

async fn info(State(d): State<Arc<Director>>) -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Json(d.info()))
}

/// The regional latency probe a browser times (docs/hosting/LATENCY_PROBES.md): tiny, uncached, served by the game
/// process itself so it measures the same path as the game's WebSocket.
async fn ping() -> impl IntoResponse {
    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
        ],
        "pong",
    )
}

async fn control_health(State(d): State<Arc<Director>>) -> impl IntoResponse {
    let code = if d.lifecycle.healthy() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        code,
        Json(serde_json::json!({
            "state": d.lifecycle.state_name(),
            "rooms": d.room_count(),
            "metrics": metrics::process().json(),
        })),
    )
}

async fn control_drain(State(d): State<Arc<Director>>) -> impl IntoResponse {
    d.drain().await;
    Json(serde_json::json!({ "state": d.lifecycle.state_name() }))
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
    let svc = router.into_make_service();
    match tls {
        Some(cfg) => {
            axum_server::bind(bind)
                .acceptor(RustlsAcceptor::new(cfg).acceptor(acceptor))
                .handle(handle)
                .serve(svc)
                .await
        }
        None => {
            axum_server::bind(bind)
                .acceptor(acceptor)
                .handle(handle)
                .serve(svc)
                .await
        }
    }
}
