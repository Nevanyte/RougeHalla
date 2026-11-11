//! P-LOBBY-ACTIVITY-1 review fixes: the lobby built the way the server binary builds it (`LobbyConfig::from_api`), its CORS
//! policy, and bot seats in the listing.

#[path = "support/http.rs"]
mod http;
#[path = "support/ws.rs"]
mod ws;

use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::lobby::LobbyConfig;
use rh_server::persist::{Auth, Persistence};
use std::net::SocketAddr;
use std::sync::Arc;

const LOBBY: &str = "/api/lobby";

/// The server binary's construction: one `ApiConfig`, the lobby's settings derived from it, `public_router_with_lobby`.
async fn start(
    cfg: DirectorConfig,
    api: ApiConfig,
    tune: impl FnOnce(LobbyConfig) -> LobbyConfig,
) -> SocketAddr {
    let d = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        Arc::new(rh_server::hosting::Lifecycle::default()),
    );
    let lobby = tune(LobbyConfig::from_api(&api));
    let app = rh_server::public_router_with_lobby(d, AccountApi::disabled(api), lobby);
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    handle.listening().await.expect("bound")
}

fn director_cfg() -> DirectorConfig {
    DirectorConfig::new(
        rh_sim::SimConfig {
            min_players: 3,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            ..rh_sim::SimConfig::default()
        },
        rh_sim::arenas::practice_arena(),
    )
}

/// Behind the hosted loopback proxy (`--client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1`), each forwarded
/// client address has its own bucket: one client's 429 does not lock the others out.
#[tokio::test]
async fn the_binarys_proxy_settings_reach_the_lobby() {
    let api = ApiConfig {
        client_ip_header: Some("x-forwarded-for".parse().unwrap()),
        trusted_proxies: vec!["127.0.0.1".parse().unwrap()],
        ..ApiConfig::default()
    };
    let addr = start(director_cfg(), api, |l| LobbyConfig {
        address_burst: 1.0,
        address_per_second: 0.001,
        ..l
    })
    .await;
    let from = |ip: &'static str| [("x-forwarded-for", ip)];
    assert_eq!(http::get(addr, LOBBY, &from("1.1.1.1")).await.status, 200);
    assert_eq!(http::get(addr, LOBBY, &from("1.1.1.1")).await.status, 429);
    assert_eq!(
        http::get(addr, LOBBY, &from("2.2.2.2")).await.status,
        200,
        "another client is not locked out"
    );
}

/// The lobby answers CORS like the rest of `/api` (`--api-cors-origins`): only an allowlisted origin is echoed.
#[tokio::test]
async fn the_lobby_follows_the_api_cors_allowlist() {
    let api = ApiConfig {
        cors: rh_server::api::CorsPolicy::Origins(vec!["https://play.example".into()]),
        ..ApiConfig::default()
    };
    let addr = start(director_cfg(), api, |l| l).await;
    let r = http::get(addr, LOBBY, &[("Origin", "https://play.example")]).await;
    assert_eq!(r.status, 200);
    assert_eq!(
        r.header("access-control-allow-origin"),
        Some("https://play.example")
    );
    let r = http::get(addr, LOBBY, &[("Origin", "https://evil.example")]).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.header("access-control-allow-origin"), None);
    let pre = http::request(
        addr,
        "OPTIONS",
        "/api/lobby/presence",
        &[("Origin", "https://play.example")],
        None,
    )
    .await;
    assert_eq!(pre.status, 204);
    assert_eq!(
        pre.header("access-control-allow-origin"),
        Some("https://play.example")
    );
    let allowed = pre
        .header("access-control-allow-headers")
        .unwrap_or_default();
    assert!(allowed.contains("x-playtest-passcode"), "{allowed}");
}
