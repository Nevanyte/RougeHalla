//! The Unity account GET's header contract against the actual unchanged account CORS middleware on a real listener.
//! This is a server preflight response check, not browser Fetch/WebGL execution or a durable profile claim.
#[path = "support/http.rs"]
mod http;

use rh_server::api::{AccountApi, ApiConfig, CorsPolicy};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::sync::Arc;

#[tokio::test]
async fn account_get_preflight_allows_owner_and_passcode_but_does_not_require_cache_control() {
    let lifecycle = Arc::new(Lifecycle::default());
    let director = Director::new(
        DirectorConfig::new(
            rh_sim::SimConfig::default(),
            rh_sim::arenas::practice_arena(),
        ),
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let app = rh_server::public_router_with_api(
        director,
        AccountApi::disabled(ApiConfig {
            cors: CorsPolicy::Origins(vec!["https://client.example".into()]),
            ..ApiConfig::default()
        }),
    );
    let handle = axum_server::Handle::new();
    let serving = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, serving)
            .await
            .unwrap();
    });
    let address = handle.listening().await.unwrap();
    lifecycle.ready();
    let preflight = http::request(
        address,
        "OPTIONS",
        "/api/profile/Alice",
        &[
            ("Origin", "https://client.example"),
            ("Access-Control-Request-Method", "GET"),
            (
                "Access-Control-Request-Headers",
                "x-profile-token,x-playtest-passcode",
            ),
        ],
        None,
    )
    .await;
    assert_eq!(preflight.status, 204);
    assert_eq!(
        preflight.header("access-control-allow-origin"),
        Some("https://client.example")
    );
    assert!(preflight
        .header("access-control-allow-methods")
        .unwrap()
        .split(',')
        .any(|method| method.trim() == "GET"));
    let allowed: Vec<_> = preflight
        .header("access-control-allow-headers")
        .unwrap()
        .split(',')
        .map(str::trim)
        .collect();
    for requested in ["x-profile-token", "x-playtest-passcode"] {
        assert!(allowed.contains(&requested));
    }
    assert!(
        !allowed.contains(&"cache-control"),
        "the old extra request header fails a browser's allow-header check; do not broaden server CORS"
    );
    let response = http::get(
        address,
        "/api/profile/Alice",
        &[("Origin", "https://client.example")],
    )
    .await;
    assert_eq!(
        response.status, 503,
        "this rig deliberately has no account DB"
    );
    assert_eq!(response.header("cache-control"), Some("no-store"));
    assert_eq!(
        response.header("access-control-allow-origin"),
        Some("https://client.example")
    );
    handle.shutdown();
}
