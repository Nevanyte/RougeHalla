//! The same public receipt path must fail as unavailable without PostgreSQL, never as unknown/committed.
#[path = "support/http.rs"]
mod http;
use rh_server::{
    api::{AccountApi, ApiConfig},
    director::{Director, DirectorConfig},
    hosting::Lifecycle,
    persist::{Auth, Persistence},
};
use std::sync::Arc;

#[tokio::test]
async fn disabled_storage_receipt_is_503_and_not_a_commit_state() {
    let lifecycle = Arc::new(Lifecycle::default());
    lifecycle.ready();
    let director = Director::new(
        DirectorConfig::new(Default::default(), rh_sim::arenas::practice_arena()),
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle,
    );
    let app =
        rh_server::public_router_with_api(director, AccountApi::disabled(ApiConfig::default()));
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap();
    });
    let addr = handle.listening().await.unwrap();
    let response = http::get(
        addr,
        "/api/profile/Alice/matches/00112233-4455-6677-8899-aabbccddeeff/settlement",
        &[("x-profile-token", "synthetic-irrelevant-token")],
    )
    .await;
    assert_eq!(response.status, 503);
    assert_eq!(response.json()["code"], "storage_unavailable");
    assert!(response.json().get("status").is_none());
    assert_eq!(response.header("cache-control"), Some("no-store"));
    handle.shutdown();
}
