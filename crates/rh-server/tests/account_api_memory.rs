//! The account API on a server with no database: profile, shop and leaderboard routes answer 503 `storage_unavailable`,
//! health and readiness still work. Runs without the `postgres` feature.

#[path = "support/http.rs"]
mod http;

use rh_server::api::{AccountApi, ApiConfig};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::sync::Arc;

async fn start() -> (std::net::SocketAddr, Arc<Lifecycle>) {
    let cfg = DirectorConfig::new(
        rh_sim::SimConfig {
            regen: false,
            quests: false,
            training: false,
            dummies: false,
            abilities: rh_sim::abilities::Mode::Off,
            wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
            lifecycle: rh_sim::ArenaMode::Off,
            hazards: rh_sim::terrain::Mode::Off,
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
            consumables: true,
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: rh_sim::FactionMode::Off,
        },
        rh_sim::arenas::practice_arena(),
    );
    let lifecycle = Arc::new(Lifecycle::default());
    let d = Director::new(
        cfg,
        Arc::new(Persistence::memory()),
        Arc::new(Auth::Dev),
        lifecycle.clone(),
    );
    let app = rh_server::public_router_with_api(d, AccountApi::disabled(ApiConfig::default()));
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    (handle.listening().await.expect("bound"), lifecycle)
}

#[tokio::test]
async fn without_a_database_profile_routes_answer_503_and_health_works() {
    let (addr, lifecycle) = start().await;
    let r = http::get(addr, "/readyz", &[]).await;
    assert_eq!(r.status, 503, "not ready before the lifecycle says so");
    lifecycle.ready();
    let r = http::get(addr, "/readyz", &[]).await;
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["storage"], "memory");
    assert_eq!(http::get(addr, "/api/health", &[]).await.json()["ok"], true);
    for (m, p) in [
        ("GET", "/api/profile/alpha"),
        ("POST", "/api/profile/alpha/purchase"),
        ("POST", "/api/profile/alpha/equip"),
        ("GET", "/api/leaderboard"),
    ] {
        let r = http::request(addr, m, p, &[], None).await;
        assert_eq!(r.status, 503, "{m} {p}");
        assert_eq!(r.json()["code"], "storage_unavailable");
        assert!(r.json()["error"]
            .as_str()
            .unwrap()
            .contains("without a database"));
    }
    lifecycle.start_draining();
    assert_eq!(
        http::get(addr, "/readyz", &[]).await.status,
        503,
        "draining"
    );
    let nf = http::get(addr, "/api/nope", &[]).await;
    assert_eq!(nf.status, 404);
    assert_eq!(nf.header("cache-control"), Some("no-store"));
}
