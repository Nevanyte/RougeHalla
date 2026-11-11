//! Public lobby activity (P-LOBBY-ACTIVITY-1). STUB: the types and seams the tests compile against; no behaviour yet.

use crate::director::{Director, LobbyView};
use axum::http::HeaderName;
use axum::Router;
use serde::Serialize;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

pub const LOBBY_SNAPSHOT_PATH: &str = "/api/lobby";
pub const LOBBY_PRESENCE_PATH: &str = "/api/lobby/presence";

#[derive(Clone, Debug)]
pub struct LobbyConfig {
    pub ttl: Duration,
    pub max_profiles: usize,
    pub max_tabs: usize,
    pub address_burst: f64,
    pub address_per_second: f64,
    pub name_burst: f64,
    pub name_per_second: f64,
    pub client_ip_header: Option<HeaderName>,
    pub trusted_proxies: Vec<IpAddr>,
    pub auth_timeout: Duration,
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
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbySnapshot {}

pub fn public_snapshot(_view: &LobbyView, _waiting: &[String], _now_ms: u64) -> LobbySnapshot {
    LobbySnapshot::default()
}

pub fn router(_director: Arc<Director>, _cfg: LobbyConfig) -> Router {
    Router::new()
}
