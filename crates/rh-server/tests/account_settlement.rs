//! Real HTTP/PostgreSQL receipt contract fixtures. Results are declared Store fixtures, not a new native-match proof.
#![cfg(feature = "postgres")]
#[path = "support/http.rs"]
mod http;
use http::{get, post_json, request, Resp};
use rh_persist::{GvBreakdown, MatchMeta, MatchResult, Outcome, RecordOutcome, Store};
use rh_server::{
    api::{AccountApi, ApiConfig, CorsPolicy},
    director::{Director, DirectorConfig},
    hosting::Lifecycle,
    persist::{Auth, Persistence},
};
use serde_json::{json, Value};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    ConnectOptions, Connection, PgConnection,
};
use std::{
    net::SocketAddr,
    str::FromStr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use uuid::Uuid;

struct Pause {
    calls: AtomicUsize,
    entered: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}
struct Rig {
    addr: SocketAddr,
    store: Arc<Store>,
    handle: axum_server::Handle,
    admin: PgConnectOptions,
    db: String,
}
fn config() -> ApiConfig {
    ApiConfig {
        new_profiles_per_hour: 0,
        new_profiles_per_ip_per_hour: 0,
        lookup_burst: 0.,
        lookup_per_second: 0.,
        shop_burst: 0.,
        shop_per_second: 0.,
        db_concurrency: 0,
        ..ApiConfig::default()
    }
}
async fn rig(cfg: ApiConfig, pause: Option<Arc<Pause>>) -> Rig {
    let admin = PgConnectOptions::from_str(
        &std::env::var("DATABASE_URL").expect("owned PostgreSQL required"),
    )
    .unwrap();
    let db = format!("rh_receipt_{}", Uuid::new_v4().simple());
    let mut connection = PgConnection::connect_with(&admin).await.unwrap();
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(&mut connection)
        .await
        .unwrap();
    let url = admin.clone().database(&db).to_url_lossy().to_string();
    let options = PgPoolOptions::new()
        .max_connections(if pause.is_some() { 1 } else { 12 })
        .before_acquire(move |_, _| {
            let pause = pause.clone();
            Box::pin(async move {
                if let Some(p) = pause {
                    if p.calls.fetch_add(1, Ordering::SeqCst) == 1 {
                        p.entered.notify_one();
                        p.resume.notified().await;
                    }
                }
                Ok(true)
            })
        });
    let store = Arc::new(Store::from_pool(options.connect(&url).await.unwrap()));
    store.migrate().await.unwrap();
    let lifecycle = Arc::new(Lifecycle::default());
    lifecycle.ready();
    let director = Director::new(
        DirectorConfig::new(Default::default(), rh_sim::arenas::practice_arena()),
        Arc::new(Persistence::postgres(
            store.clone(),
            "receipt-fixture".into(),
        )),
        Arc::new(Auth::Postgres(store.clone())),
        lifecycle,
    );
    let app = rh_server::public_router_with_api(director, AccountApi::postgres(store.clone(), cfg));
    let handle = axum_server::Handle::new();
    let h = handle.clone();
    tokio::spawn(async move {
        rh_server::serve("127.0.0.1:0".parse().unwrap(), None, app, h)
            .await
            .unwrap();
    });
    let addr = handle.listening().await.unwrap();
    Rig {
        addr,
        store,
        handle,
        admin,
        db,
    }
}
fn path(name: &str, m: Uuid) -> String {
    format!("/api/profile/{name}/matches/{m}/settlement")
}
fn unknown(m: Uuid) -> Value {
    json!({"v":1,"matchId":m.to_string(),"status":"unknown"})
}
impl Rig {
    async fn claim(&self, name: &str) -> String {
        let r = get(self.addr, &format!("/api/profile/{name}"), &[]).await;
        assert_eq!(r.status, 200, "claim response withheld");
        r.json()["token"].as_str().unwrap().into()
    }
    async fn bank(
        &self,
        name: &str,
        outcome: Option<Outcome>,
        amount: i64,
    ) -> (Uuid, i64, i64, MatchResult) {
        let pid = self.store.profile_id(name).await.unwrap().unwrap();
        let m = Uuid::new_v4();
        let lease = self
            .store
            .acquire_lease(name, m, "receipt-fixture", Duration::from_secs(60))
            .await
            .unwrap();
        let result = MatchResult {
            outcome,
            gv: GvBreakdown {
                total: amount,
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(matches!(
            self.store
                .record_result_by_id(m, pid, lease.fence, &result, &MatchMeta::unknown())
                .await
                .unwrap(),
            RecordOutcome::Applied { .. }
        ));
        (m, pid, lease.fence, result)
    }
    async fn read(&self, name: &str, token: &str, m: Uuid) -> Resp {
        get(self.addr, &path(name, m), &[("x-profile-token", token)]).await
    }
    async fn done(self) {
        self.handle.shutdown();
        self.store.pool().close().await;
        let mut admin = PgConnection::connect_with(&self.admin).await.unwrap();
        sqlx::query(&format!("DROP DATABASE {} WITH (FORCE)", self.db))
            .execute(&mut admin)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn authorization_uniform_unknown_and_uncommitted_visibility_never_claim_names() {
    let r = rig(config(), None).await;
    let a = r.claim("Alice").await;
    let b = r.claim("Bob").await;
    let (m, _, _, _) = r.bank("Bob", Some(Outcome::Won), 17).await;
    for name in ["Alice", "Unclaimed"] {
        for token in [None, Some(""), Some(b.as_str()), Some("é"), Some("wrong")] {
            let headers = token
                .map(|t| vec![("x-profile-token", t)])
                .unwrap_or_default();
            let response = get(r.addr, &path(name, m), &headers).await;
            assert_eq!(response.status, 403);
            assert_eq!(
                response.json(),
                json!({"error":"profile belongs to someone else"})
            );
        }
        assert_eq!(r.read(name, &"x".repeat(513), m).await.status, 403);
    }
    assert!(r.store.profile_id("Unclaimed").await.unwrap().is_none());
    let bytes = std::array::from_fn(|i| i as u8);
    let network = Uuid::from_bytes(bytes);
    assert_eq!(network.to_string(), rh_server::room::match_id_string(bytes));
    assert_eq!(network.to_string(), "00010203-0405-0607-0809-0a0b0c0d0e0f");
    assert_eq!(r.read("Alice", &a, network).await.json(), unknown(network));
    let before = r.read("Alice", &a, m).await;
    assert_eq!(before.status, 200);
    assert_eq!(before.json(), unknown(m));
    assert_eq!(before.header("cache-control"), Some("no-store"));
    assert_eq!(
        r.read("Alice", &a, Uuid::new_v4()).await.json()["status"],
        "unknown"
    );
    let aid = r.store.profile_id("Alice").await.unwrap().unwrap();
    let mut tx = r.store.pool().begin().await.unwrap();
    sqlx::query("INSERT INTO match_results(match_id,profile_id,result,fence) VALUES($1,$2,$3,1)")
        .bind(m)
        .bind(aid)
        .bind(sqlx::types::Json(
            json!({"v":1,"outcome":null,"gv":{"total":0}}),
        ))
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        r.read("Alice", &a, m).await.json(),
        before.json(),
        "an uncommitted own row is indistinguishable"
    );
    tx.rollback().await.unwrap();
    assert_eq!(r.read("Alice", &a, m).await.json(), before.json());
    assert_eq!(r.read("Bob", &b, m).await.json()["status"], "committed");
    r.done().await;
}

#[tokio::test]
async fn typed_zero_void_repeat_spending_and_corrupt_document_controls() {
    let r = rig(config(), None).await;
    let token = r.claim("Alice").await;
    for (outcome, amount) in [(Some(Outcome::Died), 0), (None, 7)] {
        let (m, _, _, _) = r.bank("Alice", outcome, amount).await;
        let response = r.read("Alice", &token, m).await;
        assert_eq!(response.status, 200);
        assert_eq!(
            response.json(),
            json!({"v":1,"matchId":m.to_string(),"status":"committed","settlement":{"outcome":outcome,"gvCredited":amount}})
        );
    }
    let (m, pid, fence, result) = r.bank("Alice", Some(Outcome::Won), 100_000).await;
    let receipt = r.read("Alice", &token, m).await.json();
    sqlx::query("UPDATE match_results SET result=result || $1 WHERE profile_id=$2 AND match_id=$3")
        .bind(sqlx::types::Json(
            json!({"seed":"private-marker","fence":123,"profileId":999}),
        ))
        .bind(pid)
        .bind(m)
        .execute(r.store.pool())
        .await
        .unwrap();
    assert_eq!(
        r.read("Alice", &token, m).await.json(),
        receipt,
        "unknown audit fields never ride along in the public DTO"
    );

    let profile = get(r.addr, "/api/profile/Alice", &[("x-profile-token", &token)])
        .await
        .json();
    let owned = profile["profile"]["cosmetics"]["owned"].as_array().unwrap();
    let item = rh_persist::cosmetics::catalog()
        .iter()
        .filter(|i| i.for_sale() && !owned.contains(&json!(i.id)) && i.price.unwrap() <= 100_000)
        .min_by_key(|i| i.price)
        .unwrap();
    // Deliberately use the public match UUID as purchase id too: purchase debits are not qualifying match credit.
    let purchased = post_json(
        r.addr,
        "/api/profile/Alice/purchase",
        &[
            ("x-profile-token", &token),
            ("idempotency-key", &m.to_string()),
        ],
        &json!({"id":item.id}).to_string(),
    )
    .await;
    assert_eq!(purchased.status, 200);
    assert_eq!(r.read("Alice", &token, m).await.json(), receipt);
    assert_eq!(
        r.store
            .record_result_by_id(m, pid, fence, &result, &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    );
    assert_eq!(r.read("Alice", &token, m).await.json(), receipt);
    assert_eq!(r.read("ALICE", &token, m).await.json(), receipt);
    let uppercase = get(
        r.addr,
        &path("Alice", m).replace(&m.to_string(), &m.to_string().to_uppercase()),
        &[("x-profile-token", &token)],
    )
    .await;
    assert_eq!(uppercase.json(), receipt);
    // Unsupported/corrupt fixtures fail as errors, never become unknown or expose raw audit fields.
    for bad in [
        json!({"v":2,"outcome":"won","gv":{"total":100_000},"seed":"private-marker"}),
        json!({"v":1,"gv":{"total":100_000}}),
    ] {
        sqlx::query("UPDATE match_results SET result=$1 WHERE profile_id=$2 AND match_id=$3")
            .bind(sqlx::types::Json(bad))
            .bind(pid)
            .bind(m)
            .execute(r.store.pool())
            .await
            .unwrap();
        let response = r.read("Alice", &token, m).await;
        assert_eq!(response.status, 500);
        assert_eq!(response.json(), json!({"error":"internal error"}));
        assert!(!response.body.contains("private-marker"));
    }
    r.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn verified_principal_survives_name_reassignment_between_auth_and_receipt_read() {
    for own in [true, false] {
        let pause = Arc::new(Pause {
            calls: AtomicUsize::new(100),
            entered: Default::default(),
            resume: Default::default(),
        });
        let r = rig(config(), Some(pause.clone())).await;
        let token = r.claim("Alice").await;
        r.claim("Victim").await;
        let (a, _, _, _) = r.bank("Alice", Some(Outcome::Won), 42).await;
        let (v, _, _, _) = r.bank("Victim", Some(Outcome::Won), 987).await;
        let wanted = if own { a } else { v };
        let addr = r.addr;
        let options = r.admin.clone().database(&r.db);
        let mut c = PgConnection::connect_with(&options).await.unwrap();
        pause.calls.store(0, Ordering::SeqCst);
        let pending = tokio::spawn(async move {
            get(addr, &path("Alice", wanted), &[("x-profile-token", &token)]).await
        });
        tokio::time::timeout(Duration::from_secs(3), pause.entered.notified())
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET callsign='FormerAlice' WHERE callsign='Alice'")
            .execute(&mut c)
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET callsign='Alice' WHERE callsign='Victim'")
            .execute(&mut c)
            .await
            .unwrap();
        pause.resume.notify_one();
        let response = pending.await.unwrap();
        assert_eq!(response.status, 200);
        if own {
            assert_eq!(response.json()["settlement"]["gvCredited"], 42);
        } else {
            assert_eq!(response.json(), unknown(wanted));
        }
        r.done().await;
    }
}

#[tokio::test]
async fn method_uuid_cors_and_lookup_limit_controls_stay_at_the_edge() {
    let mut cfg = config();
    cfg.cors = CorsPolicy::Origins(vec!["https://game.example".into()]);
    let r = rig(cfg, None).await;
    let token = r.claim("Alice").await;
    let m = Uuid::new_v4();
    for method in ["POST", "HEAD", "PUT"] {
        let response = request(r.addr, method, &path("Alice", m), &[], None).await;
        assert_eq!(response.status, 405);
        assert_eq!(response.header("allow"), Some("GET, OPTIONS"));
    }
    for id in [
        "invalid".into(),
        m.simple().to_string(),
        format!("urn:uuid:{m}"),
    ] {
        assert_eq!(
            get(
                r.addr,
                &format!("/api/profile/Alice/matches/{id}/settlement"),
                &[]
            )
            .await
            .status,
            400
        );
    }
    let preflight = request(
        r.addr,
        "OPTIONS",
        &path("Alice", m),
        &[("origin", "https://game.example")],
        None,
    )
    .await;
    assert_eq!(preflight.status, 204);
    assert_eq!(
        preflight.header("access-control-allow-origin"),
        Some("https://game.example")
    );
    let response = get(
        r.addr,
        &path("Alice", m),
        &[
            ("x-profile-token", &token),
            ("origin", "https://game.example"),
        ],
    )
    .await;
    assert_eq!(response.header("cache-control"), Some("no-store"));
    assert_eq!(
        response.header("access-control-allow-origin"),
        Some("https://game.example")
    );
    r.done().await;
    let mut cfg = config();
    cfg.lookup_burst = 1.;
    cfg.lookup_per_second = 0.000001;
    let r = rig(cfg, None).await;
    let token = r.claim("Alice").await;
    r.store.pool().close().await;
    assert_eq!(
        r.read("Alice", &token, m).await.status,
        429,
        "lookup guard wins before any database read"
    );
    r.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn database_slot_timeout_and_storage_failure_never_become_unknown() {
    let pause = Arc::new(Pause {
        calls: AtomicUsize::new(100),
        entered: Default::default(),
        resume: Default::default(),
    });
    let mut cfg = config();
    cfg.db_concurrency = 1;
    cfg.db_queue_wait = Duration::from_millis(30);
    let r = rig(cfg, Some(pause.clone())).await;
    let token = r.claim("Alice").await;
    let m = Uuid::new_v4();
    pause.calls.store(0, Ordering::SeqCst);
    let (addr, t) = (r.addr, token.clone());
    let pending =
        tokio::spawn(async move { get(addr, &path("Alice", m), &[("x-profile-token", &t)]).await });
    tokio::time::timeout(Duration::from_secs(3), pause.entered.notified())
        .await
        .unwrap();
    let busy = r.read("Alice", &token, m).await;
    assert_eq!(busy.status, 503);
    assert_eq!(busy.json()["code"], "busy");
    pause.resume.notify_one();
    assert_eq!(pending.await.unwrap().json(), unknown(m));
    r.store.pool().close().await;
    let unavailable = r.read("Alice", &token, m).await;
    assert_eq!(unavailable.status, 503);
    assert_eq!(unavailable.json()["code"], "storage_unavailable");
    r.done().await;
    let pause = Arc::new(Pause {
        calls: AtomicUsize::new(100),
        entered: Default::default(),
        resume: Default::default(),
    });
    let mut cfg = config();
    cfg.request_timeout = Duration::from_millis(80);
    let r = rig(cfg, Some(pause.clone())).await;
    let token = r.claim("Alice").await;
    pause.calls.store(0, Ordering::SeqCst);
    let addr = r.addr;
    let pending =
        tokio::spawn(
            async move { get(addr, &path("Alice", m), &[("x-profile-token", &token)]).await },
        );
    tokio::time::timeout(Duration::from_secs(3), pause.entered.notified())
        .await
        .unwrap();
    assert_eq!(pending.await.unwrap().status, 408);
    pause.resume.notify_one();
    r.done().await;
}
