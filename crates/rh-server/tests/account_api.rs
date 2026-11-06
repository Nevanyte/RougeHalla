//! The profile/account HTTP service against a real PostgreSQL (DATABASE_URL), through the real Axum router on a real socket:
//! claim/open tokens, guards, shop idempotency and double-spend races, equip validation, private leaderboard fields.
//!   eval "$(tools/pgtest/start.sh)"; cargo test -p rh-server --features postgres --test account_api
#![cfg(feature = "postgres")]

#[path = "support/http.rs"]
mod http;

use http::{get, post_json, request, request_raw, Resp};
use rh_persist::cosmetics::{self, Cosmetic};
use rh_persist::{GvBreakdown, MatchMeta, MatchResult, Outcome, RecordOutcome, Store};
use rh_server::api::{AccountApi, ApiConfig, CorsPolicy};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use sqlx::postgres::PgConnectOptions;
use sqlx::{ConnectOptions, Connection, PgConnection};
use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

struct Rig {
    addr: SocketAddr,
    store: Arc<Store>,
    handle: axum_server::Handle,
    lifecycle: Arc<Lifecycle>,
    admin: PgConnectOptions,
    db: String,
}

/// A config with the guards that would interfere with a test switched off (each test turns on what it examines).
fn open_cfg() -> ApiConfig {
    ApiConfig {
        new_profiles_per_hour: 0,
        new_profiles_per_ip_per_hour: 0,
        shop_burst: 0.0,
        shop_per_second: 0.0,
        // The per-address lookup bucket and the database-slot bound are examined by their own tests below.
        lookup_burst: 0.0,
        lookup_per_second: 0.0,
        db_concurrency: 0,
        ..ApiConfig::default()
    }
}

async fn rig(cfg: ApiConfig) -> Rig {
    rig_with_pause(cfg, None).await
}

/// Deterministically pause one pool checkout between authentication, mutation and response reading.
struct AcquirePause {
    calls: std::sync::atomic::AtomicUsize,
    pause_at: usize,
    entered: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}

async fn rig_with_pause(cfg: ApiConfig, pause: Option<Arc<AcquirePause>>) -> Rig {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")"));
    let admin = PgConnectOptions::from_str(&url).expect("DATABASE_URL parses");
    let db = format!("rh_api_{}", Uuid::new_v4().simple());
    let mut conn = PgConnection::connect_with(&admin).await.unwrap();
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(&mut conn)
        .await
        .unwrap();
    let db_url = admin.clone().database(&db).to_url_lossy().to_string();
    let store = Arc::new(if let Some(pause) = pause {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .before_acquire(move |_, _| {
                let pause = pause.clone();
                Box::pin(async move {
                    if pause
                        .calls
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                        == pause.pause_at
                    {
                        pause.entered.notify_one();
                        pause.resume.notified().await;
                    }
                    Ok(true)
                })
            })
            .connect(&db_url)
            .await
            .unwrap();
        Store::from_pool(pool)
    } else {
        Store::connect_with(&db_url, 24).await.unwrap()
    });
    store.migrate().await.unwrap();
    let dcfg = DirectorConfig::new(
        rh_sim::SimConfig {
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
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
    lifecycle.ready();
    let d = Director::new(
        dcfg,
        Arc::new(Persistence::postgres(store.clone(), "api-test".into())),
        Arc::new(Auth::Postgres(store.clone())),
        lifecycle.clone(),
    );
    let app = rh_server::public_router_with_api(d, AccountApi::postgres(store.clone(), cfg));
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap()
    });
    let addr = handle.listening().await.expect("bound");
    Rig {
        addr,
        store,
        handle,
        lifecycle,
        admin,
        db,
    }
}

impl Rig {
    async fn done(self) {
        self.handle.shutdown();
        self.store.pool().close().await;
        if let Ok(mut c) = PgConnection::connect_with(&self.admin).await {
            let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", self.db))
                .execute(&mut c)
                .await;
        }
    }

    /// Claims `name` through the API; returns its token.
    async fn claim(&self, name: &str) -> String {
        let r = get(self.addr, &format!("/api/profile/{name}"), &[]).await;
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()["token"].as_str().unwrap().to_owned()
    }

    /// Banks `gv` GV for `name` through a real fenced result (the same write path a match uses).
    async fn bank(&self, name: &str, gv: i64) {
        let m = Uuid::new_v4();
        let lease = self
            .store
            .acquire_lease(name, m, "api-test", Duration::from_secs(60))
            .await
            .unwrap();
        let result = MatchResult {
            outcome: Some(Outcome::Died),
            gv: GvBreakdown {
                total: gv,
                ..Default::default()
            },
            ..Default::default()
        };
        let out = self
            .store
            .record_result(m, name, lease.fence, &result, &MatchMeta::unknown())
            .await
            .unwrap();
        assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
    }

    async fn profile(&self, name: &str, token: &str) -> serde_json::Value {
        let r = get(
            self.addr,
            &format!("/api/profile/{name}"),
            &[("x-profile-token", token)],
        )
        .await;
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()["profile"].clone()
    }

    async fn buy(&self, name: &str, token: &str, id: &str) -> Resp {
        post_json(
            self.addr,
            &format!("/api/profile/{name}/purchase"),
            &[("x-profile-token", token)],
            &format!(r#"{{"id":"{id}"}}"#),
        )
        .await
    }

    async fn equip(&self, name: &str, token: &str, body: &str) -> Resp {
        post_json(
            self.addr,
            &format!("/api/profile/{name}/equip"),
            &[("x-profile-token", token)],
            body,
        )
        .await
    }

    async fn reconcile_clean(&self) {
        let r = rh_persist::admin::reconcile(&self.store).await.unwrap();
        assert!(r.ok(), "{r:?}");
    }
}

/// Items for sale, cheapest first, that the profile does not own.
fn buyable(owned: &serde_json::Value) -> Vec<&'static Cosmetic> {
    let owned: Vec<&str> = owned
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let mut v: Vec<_> = cosmetics::catalog()
        .iter()
        .filter(|c| c.for_sale() && !owned.contains(&c.id.as_str()))
        .collect();
    v.sort_by_key(|c| c.price);
    v
}

fn no_secret(r: &Resp, tokens: &[&str]) {
    let all = format!("{:?}{}", r.headers, r.body);
    for t in tokens {
        assert!(!all.contains(t), "a token leaked into a response: {all}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn claim_open_and_token_rules() {
    let rig = rig(open_cfg()).await;
    for bad in [
        "a",
        "way-too-long-callsign-x",
        "bad%20name",
        "x%2Fy",
        "%FF%FE",
        "na.me",
    ] {
        let r = get(rig.addr, &format!("/api/profile/{bad}"), &[]).await;
        assert_eq!(r.status, 400, "{bad}: {}", r.body);
    }
    let r = get(rig.addr, "/api/profile/Alpha", &[]).await;
    assert_eq!(r.status, 200);
    let body = r.json();
    assert_eq!(body["created"], true);
    let token = body["token"].as_str().unwrap().to_owned();
    assert_eq!(token.len(), 64);
    assert_eq!(body["profile"]["name"], "Alpha");
    assert_eq!(body["profile"]["gv"], 0);
    assert_eq!(r.header("cache-control"), Some("no-store"));
    // Only the hash is stored.
    let stored: Vec<u8> = sqlx::query_scalar("SELECT token_sha256 FROM profiles")
        .fetch_one(rig.store.pool())
        .await
        .unwrap();
    assert_eq!(stored, rh_persist::hash_token(&token).to_vec());

    // The claimed name is taken for strangers; the wrong token and another profile's token are refused.
    let other = rig.claim("Bravo").await;
    assert_ne!(other, token, "tokens are random per claim");
    for hdr in [
        vec![],
        vec![("x-profile-token", "nope")],
        vec![("x-profile-token", other.as_str())],
    ] {
        let r = get(rig.addr, "/api/profile/Alpha", &hdr).await;
        assert_eq!(r.status, 403, "{hdr:?}");
        no_secret(&r, &[&token, &other]);
    }
    // Opening: the right token, in any case of the name; never someone else's token in the body.
    let r = get(
        rig.addr,
        "/api/profile/ALPHA",
        &[("x-profile-token", &token)],
    )
    .await;
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["created"], false);
    assert_eq!(r.json()["profile"]["name"], "Alpha");
    no_secret(&r, &[&other]);
    // The profile DTO carries exactly the legacy fields and no hash.
    let p = r.json()["profile"].clone();
    let mut keys: Vec<_> = p.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "achievements",
            "cosmetics",
            "gv",
            "gvByMonth",
            "gvLifetime",
            "name",
            "progress",
            "stats"
        ]
    );

    // HEAD and POST must never claim or reach the handler.
    let r = request(rig.addr, "HEAD", "/api/profile/Charlie", &[], None).await;
    assert_eq!(r.status, 405);
    let r = request(rig.addr, "POST", "/api/profile/Charlie", &[], Some(b"{}")).await;
    assert_eq!(r.status, 405);
    assert_eq!(r.header("allow"), Some("GET, OPTIONS"));
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles WHERE callsign = 'Charlie'")
        .fetch_one(rig.store.pool())
        .await
        .unwrap();
    assert_eq!(n, 0);
    // Concurrent claims of one free name: exactly one wins.
    let results =
        futures_util::future::join_all((0..12).map(|_| get(rig.addr, "/api/profile/Racer", &[])))
            .await;
    assert_eq!(results.iter().filter(|r| r.status == 200).count(), 1);
    assert!(results.iter().all(|r| r.status == 200 || r.status == 403));
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn passcode_gates_claims_only_and_throttles_wrong_guesses() {
    let rig = rig(ApiConfig {
        passcode: Some("open sesame".into()),
        passcode_fails_per_minute: 2,
        ..open_cfg()
    })
    .await;
    let r = get(rig.addr, "/api/profile/Alpha", &[]).await;
    assert_eq!(
        (r.status, r.json()["code"].clone()),
        (401, "passcode_required".into())
    );
    let r = get(
        rig.addr,
        "/api/profile/Alpha",
        &[("x-playtest-passcode", "wrong")],
    )
    .await;
    assert_eq!(r.status, 401);
    let r = get(
        rig.addr,
        "/api/profile/Alpha",
        &[("x-playtest-passcode", "open sesame")],
    )
    .await;
    assert_eq!(r.status, 200);
    let token = r.json()["token"].as_str().unwrap().to_owned();
    // Opening an existing profile needs no passcode, only the token.
    let r = get(
        rig.addr,
        "/api/profile/Alpha",
        &[("x-profile-token", &token)],
    )
    .await;
    assert_eq!(r.status, 200);
    // A second wrong guess exhausts the allowance (the first one above was 1): even the right code is refused before it is compared.
    let r = get(
        rig.addr,
        "/api/profile/Bravo",
        &[("x-playtest-passcode", "wrong2")],
    )
    .await;
    assert_eq!(r.status, 401);
    let r = get(
        rig.addr,
        "/api/profile/Bravo",
        &[("x-playtest-passcode", "open sesame")],
    )
    .await;
    assert_eq!(r.status, 429);
    assert_eq!(r.json()["code"], "passcode_throttled");
    assert!(r.header("retry-after").is_some());
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
        .fetch_one(rig.store.pool())
        .await
        .unwrap();
    assert_eq!(n, 1, "no profile was created by a refused claim");
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn new_profile_caps_total_and_per_address_count_claims_only() {
    // Forwarded addresses are honoured only from a trusted peer: here the test's loopback peer.
    let rig = rig(ApiConfig {
        new_profiles_per_hour: 3,
        new_profiles_per_ip_per_hour: 2,
        client_ip_header: Some("x-forwarded-for".parse().unwrap()),
        ..open_cfg()
    })
    .await;
    let from = |ip: &'static str| [("x-forwarded-for", ip)];
    assert_eq!(
        get(rig.addr, "/api/profile/aa", &from("203.0.113.1"))
            .await
            .status,
        200
    );
    assert_eq!(
        get(rig.addr, "/api/profile/bb", &from("203.0.113.1"))
            .await
            .status,
        200
    );
    let r = get(rig.addr, "/api/profile/cc", &from("203.0.113.1")).await;
    assert_eq!(r.status, 429, "per-address cap");
    assert!(r.header("retry-after").is_some());
    // Refused claims and 403s consumed nothing: another address can still claim, until the total (3) is reached.
    assert_eq!(
        get(rig.addr, "/api/profile/aa", &from("203.0.113.1"))
            .await
            .status,
        403
    );
    assert_eq!(
        get(rig.addr, "/api/profile/cc", &from("203.0.113.2"))
            .await
            .status,
        200
    );
    let r = get(rig.addr, "/api/profile/dd", &from("203.0.113.3")).await;
    assert_eq!(r.status, 429, "total cap");
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn forwarded_address_is_ignored_unless_configured() {
    let rig = rig(ApiConfig {
        new_profiles_per_ip_per_hour: 1,
        ..open_cfg()
    })
    .await;
    assert_eq!(
        get(
            rig.addr,
            "/api/profile/aa",
            &[("x-forwarded-for", "1.1.1.1")]
        )
        .await
        .status,
        200
    );
    let r = get(
        rig.addr,
        "/api/profile/bb",
        &[("x-forwarded-for", "2.2.2.2")],
    )
    .await;
    assert_eq!(
        r.status, 429,
        "the spoofed header must not mint a fresh address"
    );
    assert_eq!(
        get(
            rig.addr,
            "/api/profile/bb",
            &[("cf-connecting-ip", "3.3.3.3")]
        )
        .await
        .status,
        429
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn purchase_rules_idempotency_and_strict_input() {
    let rig = rig(open_cfg()).await;
    let token = rig.claim("Buyer").await;
    let owned = rig.profile("Buyer", &token).await["cosmetics"]["owned"].clone();
    let items = buyable(&owned);
    let (a, b) = (items[0], items[1]);
    let (pa, pb) = (a.price.unwrap(), b.price.unwrap());

    // Insufficient GV: nothing changes.
    let r = rig.buy("Buyer", &token, &a.id).await;
    assert_eq!(r.status, 402, "{}", r.body);
    assert_eq!(r.json()["code"], "insufficient_gv");
    assert_eq!(
        (r.json()["need"].as_i64(), r.json()["have"].as_i64()),
        (Some(pa), Some(0))
    );
    rig.bank("Buyer", pa * 2 + pb).await;
    let gv0 = rig.profile("Buyer", &token).await["gv"].as_i64().unwrap();
    assert_eq!(gv0, pa * 2 + pb);

    // Auth first: missing/wrong/another's token, unknown profile; no debit, no leak.
    let other = rig.claim("Other").await;
    for t in ["", "wrong", other.as_str()] {
        let r = rig.buy("Buyer", t, &a.id).await;
        assert_eq!(r.status, 403, "token {t:?}");
        assert_eq!(r.json()["code"], "forbidden");
        no_secret(&r, &[&token, &other]);
    }
    assert_eq!(rig.buy("Nobody", &token, &a.id).await.status, 403);

    // Catalog validation.
    assert_eq!(
        rig.buy("Buyer", &token, "no-such-item").await.json()["code"],
        "unknown_cosmetic"
    );
    let r = post_json(
        rig.addr,
        "/api/profile/Buyer/purchase",
        &[("x-profile-token", &token)],
        r#"{"id":5}"#,
    )
    .await;
    assert_eq!(
        (r.status, r.json()["code"].clone()),
        (404, "unknown_cosmetic".into())
    );
    if let Some(free) = cosmetics::catalog().iter().find(|c| !c.for_sale()) {
        let r = rig.buy("Buyer", &token, &free.id).await;
        assert_eq!(
            (r.status, r.json()["code"].clone()),
            (409, "not_for_sale".into())
        );
    }

    // A purchase debits once; the repeat is "already owned" and never debits again (idempotency by ownership).
    let r = rig.buy("Buyer", &token, &a.id).await;
    assert_eq!(r.status, 200, "{}", r.body);
    let p = r.json()["profile"].clone();
    assert_eq!(p["gv"].as_i64(), Some(gv0 - pa));
    assert!(p["cosmetics"]["owned"]
        .as_array()
        .unwrap()
        .iter()
        .any(|o| *o == a.id.as_str()));
    assert_eq!(
        p["gvLifetime"].as_i64(),
        Some(gv0),
        "spending never lowers lifetime GV"
    );
    no_secret(&r, &[&token, &other]);
    let r = rig.buy("Buyer", &token, &a.id).await;
    assert_eq!(
        (r.status, r.json()["code"].clone()),
        (409, "already_owned".into())
    );
    assert_eq!(
        rig.profile("Buyer", &token).await["gv"].as_i64(),
        Some(gv0 - pa)
    );

    // An Idempotency-Key makes a retry after a lost response succeed again with the same single debit.
    let key = Uuid::new_v4().to_string();
    let path = "/api/profile/Buyer/purchase";
    let body_b = format!(r#"{{"id":"{}"}}"#, b.id);
    let h = [
        ("x-profile-token", token.as_str()),
        ("idempotency-key", key.as_str()),
    ];
    assert_eq!(post_json(rig.addr, path, &h, &body_b).await.status, 200);
    let r = post_json(rig.addr, path, &h, &body_b).await;
    assert_eq!(r.status, 200, "replay of the same key and item: {}", r.body);
    assert_eq!(r.json()["profile"]["gv"].as_i64(), Some(gv0 - pa - pb));
    // The same key for another item is a conflict; a malformed key is a bad request. Neither debits.
    let c = items[2];
    let r = post_json(rig.addr, path, &h, &format!(r#"{{"id":"{}"}}"#, c.id)).await;
    assert_eq!(r.status, 409, "{}", r.body);
    let bad = [
        ("x-profile-token", token.as_str()),
        ("idempotency-key", "not-a-uuid"),
    ];
    assert_eq!(post_json(rig.addr, path, &bad, &body_b).await.status, 400);
    assert_eq!(
        rig.profile("Buyer", &token).await["gv"].as_i64(),
        Some(gv0 - pa - pb)
    );
    let purchases: i64 = sqlx::query_scalar("SELECT count(*) FROM purchases")
        .fetch_one(rig.store.pool())
        .await
        .unwrap();
    assert_eq!(purchases, 2);

    // Strict, bounded input.
    let th = [("x-profile-token", token.as_str())];
    for body in [
        r#"{"id":"x","extra":1}"#,
        "{}",
        "[]",
        "null",
        r#"{"id":"x"} trailing"#,
        "{not json",
        "",
    ] {
        let r = post_json(rig.addr, path, &th, body).await;
        assert_eq!(
            (r.status, r.json()["code"].clone()),
            (400, "bad_request".into()),
            "{body:?}: {}",
            r.body
        );
    }
    let r = request(
        rig.addr,
        "POST",
        path,
        &[("x-profile-token", &token), ("Content-Type", "text/plain")],
        Some(br#"{"id":"x"}"#),
    )
    .await;
    assert_eq!(r.status, 415);
    let r = request(
        rig.addr,
        "POST",
        path,
        &[("x-profile-token", &token)],
        Some(br#"{"id":"x"}"#),
    )
    .await;
    assert_eq!(r.status, 415, "no content type");
    let big = format!(r#"{{"id":"{}"}}"#, "x".repeat(4000));
    let r = post_json(rig.addr, path, &th, &big).await;
    assert_eq!(r.status, 413, "body over 1 KiB");
    assert_eq!(request(rig.addr, "GET", path, &[], None).await.status, 405);
    rig.reconcile_clean().await;
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_purchases_cannot_double_spend() {
    let rig = rig(open_cfg()).await;
    let token = rig.claim("Racer").await;
    let owned = rig.profile("Racer", &token).await["cosmetics"]["owned"].clone();
    let items = buyable(&owned);
    let (a, b) = (items[0], items[1]);
    let pa = a.price.unwrap();

    // 24 requests for one item with exactly its price: one debit.
    rig.bank("Racer", pa).await;
    let rs = futures_util::future::join_all((0..24).map(|_| rig.buy("Racer", &token, &a.id))).await;
    assert_eq!(
        rs.iter().filter(|r| r.status == 200).count(),
        1,
        "{:?}",
        rs.iter().map(|r| r.status).collect::<Vec<_>>()
    );
    assert!(rs.iter().all(|r| r.status == 200 || r.status == 409));
    let p = rig.profile("Racer", &token).await;
    assert_eq!(p["gv"], 0);
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM purchases")
        .fetch_one(rig.store.pool())
        .await
        .unwrap();
    assert_eq!(n, 1);
    rig.reconcile_clean().await;

    // Two different items racing for GV that covers only the first: exactly one wins and the balance never goes negative.
    let token2 = rig.claim("Racer2").await;
    let c = items[2];
    let owned2 = rig.profile("Racer2", &token2).await["cosmetics"]["owned"].clone();
    assert!(buyable(&owned2)
        .iter()
        .any(|x| x.id == c.id && x.id != b.id));
    rig.bank("Racer2", c.price.unwrap()).await;
    let futs = (0..20).map(|i| {
        let id = if i % 2 == 0 { &c.id } else { &b.id };
        rig.buy("Racer2", &token2, id)
    });
    let rs = futures_util::future::join_all(futs).await;
    let wins: Vec<_> = rs.iter().filter(|r| r.status == 200).collect();
    // b is cheaper than or equal to c, so b may also be affordable after nothing else: allow at most what the balance covers.
    let p2 = rig.profile("Racer2", &token2).await;
    let owned_now =
        p2["cosmetics"]["owned"].as_array().unwrap().len() - owned2.as_array().unwrap().len();
    assert_eq!(owned_now, wins.len());
    assert!(p2["gv"].as_i64().unwrap() >= 0);
    let spent: i64 = sqlx::query_scalar("SELECT coalesce(sum(price),0)::bigint FROM purchases p JOIN profiles q USING (profile_id) WHERE q.callsign='Racer2'")
        .fetch_one(rig.store.pool()).await.unwrap();
    assert_eq!(
        spent + p2["gv"].as_i64().unwrap(),
        c.price.unwrap(),
        "debits equal the drop in balance"
    );
    assert!(spent <= c.price.unwrap());
    rig.reconcile_clean().await;
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn equip_validates_slot_item_and_ownership() {
    let rig = rig(open_cfg()).await;
    let token = rig.claim("Dresser").await;
    let owned = rig.profile("Dresser", &token).await["cosmetics"]["owned"].clone();
    let items = buyable(&owned);
    let item = items[0];
    let other_slot = cosmetics::SLOTS.iter().find(|s| **s != item.slot).unwrap();
    let eq = |slot: &str, id: &str| format!(r#"{{"slot":"{slot}","id":"{id}"}}"#);

    assert_eq!(
        rig.equip("Dresser", "bad", &eq(&item.slot, &item.id))
            .await
            .status,
        403
    );
    assert_eq!(
        rig.equip("Dresser", "", &eq(&item.slot, &item.id))
            .await
            .json()["code"],
        "forbidden"
    );
    let code = |r: Resp| (r.status, r.json()["code"].as_str().unwrap().to_owned());
    assert_eq!(
        code(rig.equip("Dresser", &token, &eq("nope", &item.id)).await),
        (400, "unknown_slot".into())
    );
    assert_eq!(
        code(
            rig.equip("Dresser", &token, &eq(&item.slot, "no-such"))
                .await
        ),
        (404, "unknown_cosmetic".into())
    );
    assert_eq!(
        code(
            rig.equip("Dresser", &token, &eq(other_slot, &item.id))
                .await
        ),
        (400, "slot_mismatch".into())
    );
    assert_eq!(
        code(
            rig.equip("Dresser", &token, &eq(&item.slot, &item.id))
                .await
        ),
        (409, "not_owned".into())
    );
    for body in [
        r#"{"slot":"skin"}"#,
        r#"{"slot":"skin","id":7}"#,
        r#"{"slot":"skin","id":null,"x":1}"#,
        "[]",
    ] {
        let r = rig.equip("Dresser", &token, body).await;
        assert_eq!(
            (r.status, r.json()["code"].clone()),
            (400, "bad_request".into()),
            "{body}"
        );
    }

    rig.bank("Dresser", item.price.unwrap()).await;
    assert_eq!(rig.buy("Dresser", &token, &item.id).await.status, 200);
    let r = rig
        .equip("Dresser", &token, &eq(&item.slot, &item.id))
        .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(
        r.json()["profile"]["cosmetics"]["equipped"][&item.slot],
        item.id.as_str()
    );
    no_secret(&r, &[&token]);
    let r = rig
        .equip(
            "Dresser",
            &token,
            &format!(r#"{{"slot":"{}","id":null}}"#, item.slot),
        )
        .await;
    assert_eq!(r.status, 200);
    assert!(r.json()["profile"]["cosmetics"]["equipped"]
        .get(&item.slot)
        .is_none());
    // Clearing an empty slot is fine.
    assert_eq!(
        rig.equip(
            "Dresser",
            &token,
            &format!(r#"{{"slot":"{}","id":null}}"#, item.slot)
        )
        .await
        .status,
        200
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn shop_bucket_limits_the_owner_only() {
    let rig = rig(ApiConfig {
        shop_burst: 3.0,
        shop_per_second: 1.0,
        ..open_cfg()
    })
    .await;
    let token = rig.claim("Clicker").await;
    let body = r#"{"slot":"skin","id":null}"#;
    for _ in 0..3 {
        assert_eq!(rig.equip("Clicker", &token, body).await.status, 200);
    }
    let r = rig.equip("Clicker", &token, body).await;
    assert_eq!(r.status, 429);
    assert_eq!(r.header("retry-after"), Some("1"));
    // Strangers are never charged to (or blocked by) the owner's bucket.
    for _ in 0..8 {
        assert_eq!(rig.equip("Clicker", "wrong", body).await.status, 403);
    }
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert_eq!(rig.equip("Clicker", &token, body).await.status, 200);
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn leaderboard_validation_clamps_private_you_and_invalidation() {
    let rig = rig(ApiConfig {
        // A long TTL: a fresh board after a credit proves explicit invalidation, not expiry.
        leaderboard_ttl: Duration::from_secs(600),
        ..open_cfg()
    })
    .await;
    let mut tokens = vec![];
    for (i, n) in ["Zed", "Yan", "Xia", "Wes"].iter().enumerate() {
        tokens.push(rig.claim(n).await);
        rig.bank(n, [50, 300, 300, 0][i]).await;
    }
    let month = {
        let r = get(rig.addr, "/api/leaderboard", &[]).await;
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()["month"].as_str().unwrap().to_owned()
    };
    assert!(rh_persist::valid_month(&month));
    for bad in [
        "month=2026-13",
        "month=2026-00",
        "month=abc",
        "month=",
        "month=2026-1",
        "month=2026-01&month=2026-02",
        "month=2026-01x",
    ] {
        let r = get(rig.addr, &format!("/api/leaderboard?{bad}"), &[]).await;
        assert_eq!(r.status, 400, "{bad}");
    }
    // A valid month nobody banked in: empty, not an error.
    let r = get(rig.addr, "/api/leaderboard?month=1999-12", &[]).await;
    assert_eq!(
        (r.status, r.json()["entries"].as_array().unwrap().len()),
        (200, 0)
    );

    let q = |s: &str| format!("/api/leaderboard?{s}");
    let board = get(rig.addr, &q(&format!("month={month}")), &[])
        .await
        .json();
    let names: Vec<_> = board["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        names,
        ["Xia", "Yan", "Zed"],
        "GV descending, ties by name; zero GV excluded"
    );
    assert_eq!(board["entries"][0]["gv"], 300);
    assert_eq!(board["months"][0], month.as_str());
    // Limit clamp: 0 and negatives are 1, garbage is the default, huge is the cap.
    for (l, want) in [
        ("0", 1),
        ("-5", 1),
        ("2", 2),
        ("abc", 3),
        ("1.5", 3),
        ("100000", 3),
        ("%2B1", 1),
    ] {
        let r = get(rig.addr, &q(&format!("limit={l}")), &[]).await.json();
        assert_eq!(r["entries"].as_array().unwrap().len(), want, "limit={l}");
    }

    // `you` is private: only with the profile's own token.
    let tokens: Vec<&'static str> = tokens
        .into_iter()
        .map(|t| &*Box::leak(t.into_boxed_str()))
        .collect();
    let yan = tokens[1];
    let wes = tokens[3];
    let addr = rig.addr;
    let with = |name: &'static str, token: Option<&'static str>| async move {
        let path = format!("/api/leaderboard?name={name}");
        let h: Vec<(&str, &str)> = token.map(|t| ("x-profile-token", t)).into_iter().collect();
        get(addr, &path, &h).await
    };
    let r = with("Yan", Some(yan)).await;
    assert_eq!(r.json()["you"], serde_json::json!({"rank": 2, "gv": 300}));
    no_secret(&r, &tokens);
    for (name, token) in [
        ("Yan", None),
        ("Yan", Some("wrong")),
        ("Yan", Some(tokens[0])),
        ("Zed", Some(yan)),
        ("Nobody", Some(yan)),
    ] {
        let r = with(name, token).await;
        assert_eq!(r.status, 200);
        assert!(
            r.json().get("you").is_none(),
            "{name} {token:?} must not see `you`"
        );
    }
    let r = with("Wes", Some(wes)).await;
    assert!(r.json().get("you").is_none(), "no GV this month: no rank");
    assert_eq!(rig.profile("Wes", wes).await["gv"], 0);

    // The cache (600 s TTL) is dropped when a result credits GV through this store: the new leader shows at once.
    rig.bank("Wes", 1000).await;
    let board = get(rig.addr, &q(&format!("month={month}")), &[])
        .await
        .json();
    assert_eq!(board["entries"][0]["name"], "Wes");
    assert_eq!(
        get(rig.addr, &q("name=Wes"), &[("x-profile-token", wes)])
            .await
            .json()["you"]["rank"],
        1
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn health_readiness_cors_and_errors() {
    let rig = rig(ApiConfig {
        cors: CorsPolicy::Origins(vec!["https://play.example".into()]),
        request_timeout: Duration::from_millis(800),
        ..open_cfg()
    })
    .await;
    assert_eq!(get(rig.addr, "/api/health", &[]).await.json()["ok"], true);
    let r = get(rig.addr, "/readyz", &[]).await;
    assert_eq!((r.status, r.json()["storage"].clone()), (200, "ok".into()));
    assert!(
        !r.body.contains("postgres"),
        "no connection details in readiness"
    );
    // CORS: allowlisted origin only, never credentials; preflight answered.
    let r = get(
        rig.addr,
        "/api/health",
        &[("Origin", "https://play.example")],
    )
    .await;
    assert_eq!(
        r.header("access-control-allow-origin"),
        Some("https://play.example")
    );
    assert!(r.header("access-control-allow-credentials").is_none());
    let r = get(
        rig.addr,
        "/api/health",
        &[("Origin", "https://evil.example")],
    )
    .await;
    assert!(r.header("access-control-allow-origin").is_none());
    let r = request(
        rig.addr,
        "OPTIONS",
        "/api/profile/x",
        &[
            ("Origin", "https://play.example"),
            ("Access-Control-Request-Method", "GET"),
        ],
        None,
    )
    .await;
    assert_eq!(r.status, 204);
    assert!(r
        .header("access-control-allow-headers")
        .unwrap()
        .contains("x-profile-token"));
    // Unknown /api paths are JSON 404s.
    let r = get(rig.addr, "/api/whatever/x", &[]).await;
    assert_eq!(
        (r.status, r.json()["error"].clone()),
        (404, "not found".into())
    );
    // A stalled body is cut off by the request timeout, not held forever.
    let t0 = std::time::Instant::now();
    let r = request_raw(
        rig.addr,
        "POST",
        "/api/profile/stall/purchase",
        &[("Content-Type", "application/json")],
        Some(&[b' '; 20]),
        false,
    )
    .await;
    assert_eq!(r.status, 408, "{}", r.body);
    assert!(t0.elapsed() < Duration::from_secs(5));
    // Draining makes the server unready (but health stays up).
    rig.lifecycle.start_draining();
    assert_eq!(get(rig.addr, "/readyz", &[]).await.status, 503);
    assert_eq!(get(rig.addr, "/api/health", &[]).await.status, 200);
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn storage_outage_is_503_and_readiness_fails() {
    let rig = rig(open_cfg()).await;
    let token = rig.claim("Alive").await;
    rig.store.pool().close().await;
    let r = get(rig.addr, "/readyz", &[]).await;
    assert_eq!(
        (r.status, r.json()["storage"].clone()),
        (503, "unavailable".into())
    );
    let r = get(
        rig.addr,
        "/api/profile/Alive",
        &[("x-profile-token", &token)],
    )
    .await;
    assert_eq!(
        (r.status, r.json()["code"].clone()),
        (503, "storage_unavailable".into())
    );
    assert!(r.header("retry-after").is_some());
    no_secret(&r, &[&token]);
    let r = get(rig.addr, "/api/profile/Fresh", &[]).await;
    assert_eq!(r.status, 503);
    assert!(
        r.json().get("token").is_none(),
        "no token is issued for a claim that was not stored"
    );
    rig.done().await;
}

// ---------------------------------------------------------------------------------------------------------------------
// Review fixes: lookup bucket, database slots, cancellation-safe claim, cache, ids
// ---------------------------------------------------------------------------------------------------------------------

impl Rig {
    async fn db_conn(&self) -> PgConnection {
        PgConnection::connect_with(&self.admin.clone().database(&self.db))
            .await
            .unwrap()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn lookups_are_limited_per_address_before_any_database_query() {
    let rig = rig(ApiConfig {
        lookup_burst: 4.0,
        lookup_per_second: 0.01,
        ..open_cfg()
    })
    .await;
    // Mixed profile and leaderboard requests share one bucket; the legacy answers are untouched while it lasts.
    assert_eq!(
        get(rig.addr, "/api/profile/Nobody1", &[]).await.status,
        200,
        "free name is claimed"
    );
    assert_eq!(
        get(rig.addr, "/api/profile/Nobody1", &[]).await.status,
        403,
        "taken name stays 403"
    );
    assert_eq!(get(rig.addr, "/api/leaderboard", &[]).await.status, 200);
    assert_eq!(
        get(rig.addr, "/api/leaderboard?month=1999-12", &[])
            .await
            .status,
        200
    );
    // Storage goes away entirely: an exhausted bucket must still answer 429, proving no query was attempted first.
    rig.store.pool().close().await;
    for path in [
        "/api/profile/Nobody2",
        "/api/leaderboard?month=1998-01&name=Nobody1",
    ] {
        let r = get(rig.addr, path, &[]).await;
        assert_eq!(r.status, 429, "{path}: {}", r.body);
        assert_eq!(r.json()["code"], "rate_limited");
        assert!(r.header("retry-after").is_some());
    }
    let r = post_json(rig.addr, "/api/profile/Nobody1/equip", &[], "{}").await;
    assert_eq!(
        r.status, 429,
        "the shop routes share the per-address bucket"
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_account_api_has_its_own_bounded_database_concurrency() {
    let rig = rig(ApiConfig {
        db_concurrency: 1,
        db_queue_wait: Duration::from_millis(150),
        ..open_cfg()
    })
    .await;
    // Block reads of `profiles`: the first request takes the only slot and waits on the database.
    let mut locker = rig.db_conn().await;
    sqlx::query("BEGIN").execute(&mut locker).await.unwrap();
    sqlx::query("LOCK TABLE profiles IN ACCESS EXCLUSIVE MODE")
        .execute(&mut locker)
        .await
        .unwrap();
    let addr = rig.addr;
    let first = tokio::spawn(async move { get(addr, "/api/profile/Slotty", &[]).await });
    tokio::time::sleep(Duration::from_millis(100)).await;
    let r = get(rig.addr, "/api/leaderboard?month=1999-01", &[]).await;
    assert_eq!(r.status, 503, "{}", r.body);
    assert_eq!(r.json()["code"], "busy");
    assert!(r.header("retry-after").is_some());
    sqlx::query("COMMIT").execute(&mut locker).await.unwrap();
    assert_eq!(
        first.await.unwrap().status,
        200,
        "the waiting request completes once the database answers"
    );
    assert_eq!(
        get(rig.addr, "/api/leaderboard?month=1999-01", &[])
            .await
            .status,
        200,
        "the slot was released"
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn empty_month_leaderboards_are_cached_too() {
    let rig = rig(ApiConfig {
        leaderboard_ttl: Duration::from_secs(600),
        ..open_cfg()
    })
    .await;
    let r = get(rig.addr, "/api/leaderboard?month=1999-12", &[]).await;
    assert_eq!(
        (r.status, r.json()["entries"].as_array().unwrap().len()),
        (200, 0)
    );
    // With storage gone, only a cached answer can still be served.
    rig.store.pool().close().await;
    let r = get(rig.addr, "/api/leaderboard?month=1999-12", &[]).await;
    assert_eq!(
        r.status, 200,
        "an empty month is served from cache: {}",
        r.body
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_claim_cancelled_by_the_request_timeout_is_undone_and_its_reservation_returned() {
    let rig = rig(ApiConfig {
        request_timeout: Duration::from_millis(300),
        new_profiles_per_ip_per_hour: 1,
        ..open_cfg()
    })
    .await;
    // Inserts block (reads do not): the claim's INSERT outlives the 300 ms request timeout.
    let mut locker = rig.db_conn().await;
    sqlx::query("BEGIN").execute(&mut locker).await.unwrap();
    sqlx::query("LOCK TABLE profiles IN SHARE MODE")
        .execute(&mut locker)
        .await
        .unwrap();
    let r = get(rig.addr, "/api/profile/Strand", &[]).await;
    assert_eq!(r.status, 408, "{}", r.body);
    sqlx::query("COMMIT").execute(&mut locker).await.unwrap();
    // The insert now commits in the task the timeout cannot cancel; nobody can receive the token, so the claim is undone.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut c = rig.db_conn().await;
    for _ in 0..100 {
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
            .fetch_one(&mut c)
            .await
            .unwrap();
        if n == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(
        n, 0,
        "a claim whose token was never delivered must not strand the name"
    );
    // And the per-address new-profile reservation (1 an hour) came back: the retry claims the name.
    let r = get(rig.addr, "/api/profile/Strand", &[]).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["created"], true);
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_claim_answers_from_its_insert_with_the_same_profile_a_later_open_returns() {
    let rig = rig(open_cfg()).await;
    let r = get(rig.addr, "/api/profile/Fresh1", &[]).await;
    assert_eq!(r.status, 200);
    let j = r.json();
    let token = j["token"].as_str().unwrap();
    let opened = get(
        rig.addr,
        "/api/profile/Fresh1",
        &[("x-profile-token", token)],
    )
    .await
    .json();
    assert_eq!(
        j["profile"], opened["profile"],
        "Profile::fresh must match the column defaults"
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn equip_invalidates_the_cached_leaderboard_titles() {
    let rig = rig(ApiConfig {
        leaderboard_ttl: Duration::from_secs(600),
        ..open_cfg()
    })
    .await;
    let token = rig.claim("Titled").await;
    rig.bank("Titled", 10).await;
    let title = cosmetics::catalog()
        .iter()
        .find(|c| c.slot == "title")
        .expect("a title exists");
    sqlx::query("UPDATE profiles SET cosmetics = jsonb_set(cosmetics, '{owned}', $1::jsonb) WHERE lower(callsign)='titled'")
        .bind(serde_json::json!([title.id]))
        .execute(rig.store.pool())
        .await
        .unwrap();
    let before = get(rig.addr, "/api/leaderboard", &[]).await.json();
    assert!(before["entries"][0].get("title").is_none(), "{before}");
    let r = rig
        .equip(
            "Titled",
            &token,
            &format!(r#"{{"slot":"title","id":"{}"}}"#, title.id),
        )
        .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let after = get(rig.addr, "/api/leaderboard", &[]).await.json();
    assert_eq!(
        after["entries"][0]["title"],
        title.id.as_str(),
        "the cached page was dropped by the equip"
    );
    rig.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn one_idempotency_key_from_two_profiles_at_once_is_a_clean_409_never_a_500() {
    let rig = rig(open_cfg()).await;
    let mut who = vec![];
    for n in ["KeyA", "KeyB"] {
        let t = rig.claim(n).await;
        rig.bank(n, 100_000).await;
        who.push((n, t));
    }
    let owned = rig.profile("KeyA", &who[0].1).await["cosmetics"]["owned"].clone();
    let item = buyable(&owned)[0].id.clone();
    for round in 0..40 {
        let key = Uuid::new_v4().to_string();
        let mut hs = vec![];
        for (n, t) in &who {
            let (addr, n, t, key, item) = (
                rig.addr,
                n.to_string(),
                t.clone(),
                key.clone(),
                item.clone(),
            );
            hs.push(tokio::spawn(async move {
                // A fresh item each round per profile is not needed: the second round's AlreadyOwned is a 409 as well.
                post_json(
                    addr,
                    &format!("/api/profile/{n}/purchase"),
                    &[
                        ("x-profile-token", t.as_str()),
                        ("idempotency-key", key.as_str()),
                    ],
                    &format!(r#"{{"id":"{item}"}}"#),
                )
                .await
            }));
        }
        for h in hs {
            let r = h.await.unwrap();
            assert!(
                matches!(r.status, 200 | 409),
                "round {round}: {} {}",
                r.status,
                r.body
            );
        }
        // Give both profiles the item back so every round races on the key rather than on ownership.
        sqlx::query("UPDATE profiles SET cosmetics = jsonb_set(cosmetics, '{owned}', '[]'::jsonb)")
            .execute(rig.store.pool())
            .await
            .unwrap();
    }
    rig.done().await;
}

/// Every private read and shop mutation follows the authenticated profile ID through moderation renames/name reuse.
/// Checkout 0 authenticates; checkout 1 loads the open response or starts a shop transaction; checkout 2 reads a shop response.
#[tokio::test(flavor = "multi_thread")]
async fn authenticated_account_requests_keep_their_principal_through_name_reassignment() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    for (operation, pause_at) in [
        ("open", 1),
        ("purchase", 1),
        ("purchase", 2),
        ("equip", 1),
        ("equip", 2),
    ] {
        let pause = Arc::new(AcquirePause {
            calls: AtomicUsize::new(100),
            pause_at,
            entered: tokio::sync::Notify::new(),
            resume: tokio::sync::Notify::new(),
        });
        let rig = rig_with_pause(open_cfg(), Some(pause.clone())).await;
        let token = rig.claim("Alice").await;
        let victim_token = rig.claim("Victim").await;
        rig.bank("Alice", 100_000).await;
        rig.bank("Victim", 987_654).await;
        let before = rig.profile("Alice", &token).await;
        let item = buyable(&before["cosmetics"]["owned"])[0];
        if operation == "equip" {
            assert_eq!(rig.buy("Alice", &token, &item.id).await.status, 200);
        }
        let victim_before = rig.profile("Victim", &victim_token).await;
        let mut conn = rig.db_conn().await;
        let (addr, request_token, item_id, item_slot) =
            (rig.addr, token.clone(), item.id.clone(), item.slot.clone());
        pause.calls.store(0, Ordering::SeqCst);
        let pending = tokio::spawn(async move {
            match operation {
                "open" => {
                    get(
                        addr,
                        "/api/profile/Alice",
                        &[("x-profile-token", &request_token)],
                    )
                    .await
                }
                "purchase" => {
                    post_json(
                        addr,
                        "/api/profile/Alice/purchase",
                        &[("x-profile-token", &request_token)],
                        &serde_json::json!({"id":item_id}).to_string(),
                    )
                    .await
                }
                "equip" => {
                    post_json(
                        addr,
                        "/api/profile/Alice/equip",
                        &[("x-profile-token", &request_token)],
                        &serde_json::json!({"slot":item_slot,"id":item_id}).to_string(),
                    )
                    .await
                }
                _ => unreachable!(),
            }
        });
        tokio::time::timeout(Duration::from_secs(5), pause.entered.notified())
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET callsign='FormerAlice' WHERE callsign='Alice'")
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET callsign='Alice' WHERE callsign='Victim'")
            .execute(&mut conn)
            .await
            .unwrap();
        pause.resume.notify_one();
        let response = pending.await.unwrap();
        assert_eq!(
            response.status, 200,
            "{operation}/{pause_at}: {}",
            response.body
        );
        assert_eq!(
            response.json()["profile"]["name"],
            "FormerAlice",
            "{operation}/{pause_at}"
        );
        assert_ne!(
            response.json()["profile"]["gv"],
            victim_before["gv"],
            "{operation}/{pause_at}"
        );
        let after = rig.profile("FormerAlice", &token).await;
        assert_eq!(response.json()["profile"], after, "{operation}/{pause_at}");
        if operation == "purchase" {
            assert!(after["cosmetics"]["owned"]
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == &item.id));
        }
        if operation == "equip" {
            assert_eq!(after["cosmetics"]["equipped"][&item.slot], item.id);
        }
        let mut victim_after = rig.profile("Alice", &victim_token).await;
        victim_after["name"] = "Victim".into();
        assert_eq!(
            victim_after, victim_before,
            "replacement principal must remain unchanged"
        );
        // ID-based shop entry points retain their own token check (an ID alone conveys no authority).
        let id = rig
            .store
            .verify_token_id("FormerAlice", &token)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            rig.store
                .purchase_by_id(id, &victim_token, Uuid::new_v4(), &item.id, 0)
                .await
                .unwrap(),
            rh_persist::PurchaseOutcome::BadToken
        );
        assert_eq!(
            rig.store
                .equip_by_id(id, &victim_token, &item.slot, None)
                .await
                .unwrap(),
            rh_persist::EquipOutcome::BadToken
        );
        drop(conn);
        rig.done().await;
    }
}
