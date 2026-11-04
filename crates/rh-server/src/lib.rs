//! Roguehalla live server: the thin adapter between sockets/wall clock/hosting and the deterministic core (rh-sim).
//! See docs/CONTRACTS.md (C-NET, C-TICK) and docs/adr/0002-transport-and-protocol.md, 0004-hosting.md.

pub mod conn;
pub mod director;
pub mod hosting;
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
use director::Director;
use std::sync::Arc;

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

async fn ws(upgrade: WebSocketUpgrade, State(d): State<Arc<Director>>) -> Response {
    upgrade
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
        Json(serde_json::json!({ "state": d.lifecycle.state_name(), "rooms": d.room_count() })),
    )
}

async fn control_drain(State(d): State<Arc<Director>>) -> impl IntoResponse {
    d.drain().await;
    Json(serde_json::json!({ "state": d.lifecycle.state_name() }))
}
