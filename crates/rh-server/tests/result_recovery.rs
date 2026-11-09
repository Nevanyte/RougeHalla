//! Durable result handoff and recovery (feature `postgres`, real PostgreSQL from DATABASE_URL).
//!   eval "$(tools/pgtest/start.sh)"; cargo test -p rh-server --features postgres --test result_recovery
//!
//! What these tests stand for (see ADR 0006, "Addendum: durable result handoff"):
//! * a result is SPOOLED (fsynced locally) before the first database attempt and COMMITTED only by the PostgreSQL
//!   transaction; the spool record is removed only after the commit;
//! * a startup recovery pass replays records through the same fenced path with the ORIGINAL fence, identity and metadata,
//!   takes no lease, and dead-letters what the store refuses;
//! * the `process_kill_*` test kills a real `rh-server` process (SIGKILL) with a result spooled and uncommitted, then
//!   starts a second process on the same spool: a true process death, not a simulated one. Tests that stop and restart
//!   PostgreSQL use their own throwaway cluster, never the shared one.
//!
//! They prove same-host process-restart recovery only. None of this is evidence for host replacement or managed failover.
#![cfg(feature = "postgres")]

use futures_util::{SinkExt, StreamExt};
use rh_protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use rh_server::spool::{ResultSpool, SpoolConfig, SpoolMeta, SpoolRecord};
use rh_sim::map::tile_to_world_center;
use rh_sim::{Arena, SimConfig, TileMap, Vec2};
use sqlx::Connection;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Db {
    store: Arc<rh_persist::Store>,
    url: String,
    name: String,
    admin: rh_persist::Store,
}

async fn fresh_db(tag: &str) -> Db {
    let url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL (eval \"$(tools/pgtest/start.sh)\")");
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let name = format!("rh_rec_{tag}_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = format!("{}/{name}", &url[..url.rfind('/').unwrap()]);
    let store = Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    Db {
        store,
        url: db_url,
        name,
        admin,
    }
}

impl Db {
    async fn drop_db(self) {
        drop(self.store);
        let _ = sqlx::query(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            self.name
        ))
        .execute(self.admin.pool())
        .await;
    }
    async fn count(&self, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(self.store.pool())
            .await
            .unwrap()
    }
    async fn reconcile_clean(&self) {
        let r = rh_persist::admin::reconcile(&self.store).await.unwrap();
        assert!(r.ok(), "reconcile found mismatches: {:?}", r.mismatches);
        assert_eq!(r.total_gv, r.total_ledger);
    }
}

fn spool_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("rh-rec-{tag}-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn files(dir: &Path, ext: &str) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.ends_with(ext) && !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

async fn wait_until<F, Fut>(what: &str, secs: u64, mut f: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let end = tokio::time::Instant::now() + Duration::from_secs(secs);
    loop {
        if f().await {
            return;
        }
        assert!(
            tokio::time::Instant::now() < end,
            "timed out waiting for: {what}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn quick_cfg() -> SpoolConfig {
    SpoolConfig {
        max_records: 64,
        retry_deadline: Duration::from_secs(30),
        backoff_initial: Duration::from_millis(20),
        backoff_max: Duration::from_millis(200),
        ..SpoolConfig::default()
    }
}

fn director_with(
    store: Arc<rh_persist::Store>,
    owner: &str,
    spool: Arc<ResultSpool>,
    arena: Arena,
) -> Arc<Director> {
    let cfg = DirectorConfig {
        tick: Duration::from_millis(3),
        linger: Duration::from_millis(100),
        ..DirectorConfig::new(
            SimConfig {
                walk_hints: None,
                regen: false,
                quests: false,
                training: false,
                dummies: false,
                consumables: true,
                abilities: rh_sim::abilities::Mode::Off,
                wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
                lifecycle: rh_sim::ArenaMode::Off,
                hazards: rh_sim::terrain::Mode::Off,
                mob_mode: rh_sim::mob_runtime::MobMode::Off,
                initial_loot: false,
                min_players: 2,
                lobby_seconds: 30.0,
                fill_seconds: 0.0,
                pvp_rules: true,
                weapon_specials: true,
                faction_mode: rh_sim::FactionMode::Off,
            },
            arena,
        )
    };
    Director::new_with_spool(
        cfg,
        Arc::new(Persistence::postgres(store.clone(), owner.into())),
        Arc::new(Auth::Postgres(store)),
        Arc::new(Lifecycle::default()),
        spool,
    )
}

fn arena() -> Arena {
    let rows: Vec<String> = (0..8)
        .map(|y| {
            (0..12)
                .map(|x| {
                    if x == 0 || y == 0 || x == 11 || y == 7 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![
            Vec2::new(tile_to_world_center(3), tile_to_world_center(4)),
            Vec2::new(tile_to_world_center(8), tile_to_world_center(4)),
        ],
    }
}

fn won(gv: i64) -> rh_persist::MatchResult {
    rh_persist::MatchResult {
        outcome: Some(rh_persist::Outcome::Won),
        kills: 1,
        gv: rh_persist::GvBreakdown {
            kills: gv,
            total: gv,
            ..Default::default()
        },
        win_qualified: true,
        duration_sec: 30,
        place: 1,
        players: 2,
        ..Default::default()
    }
}

fn old_meta() -> SpoolMeta {
    SpoolMeta {
        owner: "dead-host".into(),
        region: None,
        placement_id: None,
        build: "old-build-7".into(),
        content_hash: 0xDEAD_BEEF_0123_4567,
        humans: 3,
        bots: 2,
    }
}

/// A profile holding a live lease for `m`, and the spool record its result would leave behind.
async fn leased_record(
    db: &Db,
    callsign: &str,
    m: Uuid,
    gv: i64,
) -> (SpoolRecord, rh_persist::Lease) {
    db.store.create_profile(callsign, "tok").await.unwrap();
    let lease = db
        .store
        .acquire_lease(callsign, m, "dead-host", Duration::from_secs(120))
        .await
        .unwrap();
    let mut rec = SpoolRecord::new(
        m,
        lease.profile_id,
        callsign,
        lease.fence,
        old_meta(),
        won(gv),
    );
    rec.spooled_at_ms -= 86_400_000; // produced a day before this restart
    (rec, lease)
}

fn info(d: &Director, key: &str) -> i64 {
    let v = if key == "players" {
        d.info()[key].clone()
    } else {
        d.result_metrics()[key].clone()
    };
    v.as_i64().unwrap_or_else(|| panic!("metric {key}"))
}

// ---------------------------------------------------------------------------------------------------------------------
// Recovery from a spool left by an earlier process
// ---------------------------------------------------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recovery_commits_once_with_the_original_fence_and_metadata() {
    let db = fresh_db("orig").await;
    let m = Uuid::new_v4();
    let (rec, lease) = leased_record(&db, "alpha", m, 40).await;
    let dir = spool_dir("orig");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    spool.append(&rec).unwrap();
    drop(spool);

    // The "restarted" process: a different instance id; the build is whatever this binary is (not "old-build-7").
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    let d = director_with(db.store.clone(), "new-host", spool.clone(), arena());
    assert_eq!(d.recover_spooled(), 1);
    wait_until("recovered", 20, || async {
        db.count("match_results").await == 1
    })
    .await;
    wait_until("record removed", 20, || async {
        files(&dir, ".rec").is_empty()
    })
    .await;

    let (owner, build, hash, humans, bots): (String, String, i64, i32, i32) = sqlx::query_as(
        "SELECT owner, build, content_hash, humans, bots FROM matches WHERE match_id=$1",
    )
    .bind(m)
    .fetch_one(db.store.pool())
    .await
    .unwrap();
    assert_eq!(
        (owner.as_str(), build.as_str(), hash as u64, humans, bots),
        ("dead-host", "old-build-7", 0xDEAD_BEEF_0123_4567, 3, 2),
        "the original match metadata, not the restarted build's"
    );
    assert_ne!(build, rh_sim::replay::BUILD_ID);
    let ended_ms: f64 = sqlx::query_scalar(
        "SELECT extract(epoch FROM ended_at)::float8 * 1000 FROM matches WHERE match_id=$1",
    )
    .bind(m)
    .fetch_one(db.store.pool())
    .await
    .unwrap();
    assert!(
        (ended_ms - rec.spooled_at_ms as f64).abs() < 1000.0,
        "ended_at is the recorded time, not the commit time"
    );
    let fence: i64 = sqlx::query_scalar("SELECT fence FROM match_results WHERE match_id=$1")
        .bind(m)
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert_eq!(fence, lease.fence, "original fence");
    let p = db.store.get_profile("alpha").await.unwrap().unwrap();
    assert_eq!(p.gv, 40);
    // The counters are bumped just after the record is removed (commit, remove, count); wait for that, then check exactly.
    wait_until("recovery counted", 5, || async {
        info(&d, "recovered") >= 1
    })
    .await;
    assert_eq!(info(&d, "recovered"), 1);
    assert_eq!(info(&d, "committed"), 1);
    assert_eq!(info(&d, "spoolPending"), 0);
    // The gate entry is gone once the record resolved.
    wait_until("gate released", 5, || async { info(&d, "players") == 0 }).await;

    // Replaying the same record again (it was copied back, as an operator or a crash after commit could) credits nothing.
    spool.append(&rec).unwrap();
    assert_eq!(d.recover_spooled(), 1);
    wait_until("duplicate cleared", 20, || async {
        files(&dir, ".rec").is_empty()
    })
    .await;
    assert_eq!(db.store.get_profile("alpha").await.unwrap().unwrap().gv, 40);
    assert_eq!(db.count("match_results").await, 1);
    assert_eq!(db.count("gv_ledger").await, 1);
    db.reconcile_clean().await;
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_record_already_committed_before_the_crash_is_cleared_without_double_credit() {
    let db = fresh_db("dup").await;
    let m = Uuid::new_v4();
    let (rec, lease) = leased_record(&db, "bravo", m, 25).await;
    // The commit landed; the process died before it could remove the record.
    let out = db
        .store
        .record_result_by_id(
            m,
            lease.profile_id,
            lease.fence,
            &rec.result,
            &rec.meta.to_persist(),
        )
        .await
        .unwrap();
    assert!(matches!(out, rh_persist::RecordOutcome::Applied { .. }));
    let dir = spool_dir("dup");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    spool.append(&rec).unwrap();
    let d = director_with(db.store.clone(), "new-host", spool, arena());
    assert_eq!(d.recover_spooled(), 1);
    wait_until("cleared", 20, || async { files(&dir, ".rec").is_empty() }).await;
    assert!(
        files(&dir.join("dead"), ".rec").is_empty(),
        "AlreadyApplied is not a dead letter"
    );
    assert_eq!(db.store.get_profile("bravo").await.unwrap().unwrap().gv, 25);
    assert_eq!(db.count("match_results").await, 1);
    assert_eq!(db.count("gv_ledger").await, 1);
    db.reconcile_clean().await;
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_fence_is_dead_lettered_and_the_new_owners_lease_is_untouched() {
    let db = fresh_db("stale").await;
    let old_match = Uuid::new_v4();
    let (rec, lease1) = leased_record(&db, "charlie", old_match, 60).await;
    // The old host is gone; its lease expired and the player started a new match elsewhere (fence 2).
    sqlx::query(
        "UPDATE session_leases SET expires_at = now() - interval '1 minute' WHERE profile_id = $1",
    )
    .bind(lease1.profile_id)
    .execute(db.store.pool())
    .await
    .unwrap();
    let new_match = Uuid::new_v4();
    let lease2 = db
        .store
        .acquire_lease("charlie", new_match, "new-owner", Duration::from_secs(600))
        .await
        .unwrap();
    assert!(lease2.fence > lease1.fence);
    type LeaseRow = (Uuid, i64, bool, String, f64);
    let snapshot = |db: &Db| {
        let pool = db.store.pool().clone();
        async move {
            sqlx::query_as::<_, LeaseRow>(
                "SELECT match_id, fence, released_at IS NOT NULL, owner, extract(epoch FROM expires_at)::float8 FROM session_leases",
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let before = snapshot(&db).await;

    let dir = spool_dir("stale");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    spool.append(&rec).unwrap();
    let d = director_with(db.store.clone(), "recovering-host", spool, arena());
    assert_eq!(d.recover_spooled(), 1);
    wait_until("dead-lettered", 20, || async {
        files(&dir.join("dead"), ".rec").len() == 1
    })
    .await;

    assert!(files(&dir, ".rec").is_empty(), "never retried forever");
    let reason =
        std::fs::read_to_string(dir.join("dead").join(format!("{}.reason", rec.file_name())))
            .unwrap();
    assert!(reason.contains("StaleFence"), "{reason}");
    wait_until("metrics", 5, || async {
        info(&d, "deadLettered") == 1 && info(&d, "refused") == 1
    })
    .await;
    assert_eq!(info(&d, "spoolDead"), 1);
    assert_eq!(
        db.count("match_results").await,
        0,
        "the stale result is not applied"
    );
    assert_eq!(
        db.store.get_profile("charlie").await.unwrap().unwrap().gv,
        0
    );
    let after = snapshot(&db).await;
    assert_eq!(
        before, after,
        "recovery did not touch the newer owner's lease (id, fence, release, owner, expiry)"
    );
    assert_eq!(after.1, lease2.fence);
    assert!(!after.2);
    db.reconcile_clean().await;
    db.drop_db().await;
}

/// REPLACES `retry_exhaustion_dead_letters_and_an_operator_requeue_replays_it`, whose assertions encoded the defect
/// (review finding H1): it waited for a TRANSIENT outage to push the record into `dead/` with reason "retry deadline
/// exceeded", expected `failed == 1 && deadLettered == 1`, and expected the profile gate released. In production that
/// loses a result in any outage longer than the deadline: the seat is freed, the lease expires, a new owner takes the
/// profile and a later replay is StaleFence. The corrected contract: a transient error never dead-letters for time; the
/// record stays pending, retries at `backoff_max`, the gate stays held, and `retry_deadline` only raises alerts.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_long_outage_never_dead_letters_a_result_and_the_record_commits_when_the_database_returns(
) {
    let db = fresh_db("exhaust").await;
    let m = Uuid::new_v4();
    let (rec, _lease) = leased_record(&db, "delta", m, 33).await;
    let dir = spool_dir("exhaust");
    let cfg = SpoolConfig {
        retry_deadline: Duration::from_millis(300),
        ..quick_cfg()
    };
    let spool = ResultSpool::open(&dir, cfg).unwrap();
    spool.append(&rec).unwrap();
    // A store whose connections are all gone: every attempt is a transient error.
    let broken = {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect(&db.url)
            .await
            .unwrap();
        let s = Arc::new(rh_persist::Store::from_pool(pool.clone()));
        pool.close().await;
        s
    };
    let d = director_with(broken, "host", spool.clone(), arena());
    assert_eq!(d.recover_spooled(), 1);
    // Several alert intervals pass: the alert threshold is crossed repeatedly and nothing is dead-lettered.
    wait_until("repeated stuck alerts", 20, || async {
        info(&d, "stuckAlerts") >= 3
    })
    .await;
    assert!(
        files(&dir.join("dead"), ".rec").is_empty(),
        "a transient outage must never move a record to dead/"
    );
    assert_eq!(files(&dir, ".rec"), vec![rec.file_name()], "still pending");
    assert_eq!(info(&d, "deadLettered"), 0);
    assert_eq!(info(&d, "failed"), 0);
    assert_eq!(info(&d, "spoolPending"), 1);
    assert_eq!(
        info(&d, "players"),
        1,
        "the profile gate stays held while its record is unresolved"
    );
    assert_eq!(db.count("match_results").await, 0);
    drop(d);

    // The database is back (a healthy process on the same spool): the record commits with the original fence, which
    // still applies because nothing released or took the lease.
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    let d = director_with(db.store.clone(), "host", spool, arena());
    assert_eq!(d.recover_spooled(), 1);
    wait_until("replayed", 20, || async {
        db.count("match_results").await == 1
    })
    .await;
    assert_eq!(db.store.get_profile("delta").await.unwrap().unwrap().gv, 33);
    db.reconcile_clean().await;
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_permanent_store_error_is_dead_lettered_not_retried_forever() {
    let db = fresh_db("permanent").await;
    let m = Uuid::new_v4();
    // A NUL byte in the owner text: PostgreSQL rejects the data itself (SQLSTATE 22021), and it always will.
    let (mut rec, _lease) = leased_record(&db, "poison", m, 5).await;
    rec.meta.owner = "bad\0owner".into();
    let dir = spool_dir("permanent");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    spool.append(&rec).unwrap();
    let d = director_with(db.store.clone(), "host", spool, arena());
    assert_eq!(d.recover_spooled(), 1);
    wait_until("permanent error dead-lettered", 20, || async {
        files(&dir.join("dead"), ".rec").len() == 1
    })
    .await;
    let reason =
        std::fs::read_to_string(dir.join("dead").join(format!("{}.reason", rec.file_name())))
            .unwrap();
    assert!(reason.contains("permanent store error"), "{reason}");
    wait_until("metrics", 5, || async {
        info(&d, "failed") == 1 && info(&d, "deadLettered") == 1
    })
    .await;
    assert_eq!(db.count("match_results").await, 0);
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn corrupt_and_truncated_records_are_dead_lettered_and_do_not_block_valid_ones() {
    let db = fresh_db("corrupt").await;
    let m = Uuid::new_v4();
    let (rec, _) = leased_record(&db, "echo", m, 12).await;
    let dir = spool_dir("corrupt");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    spool.append(&rec).unwrap();
    let good = std::fs::read(dir.join(rec.file_name())).unwrap();
    // Truncated, bit-flipped, empty and garbage records under plausible names, and a half-written temporary.
    let other = |n: u128| format!("{}-{}.rec", Uuid::from_u128(n), 9);
    std::fs::write(dir.join(other(1)), &good[..good.len() / 2]).unwrap();
    let mut flipped = good.clone();
    let i = flipped.len() - 10;
    flipped[i] ^= 0x20;
    std::fs::write(dir.join(other(2)), &flipped).unwrap();
    std::fs::write(dir.join(other(3)), b"").unwrap();
    std::fs::write(dir.join(other(4)), b"not a record at all\n{}").unwrap();
    std::fs::write(dir.join(".half.tmp"), &good[..20]).unwrap();
    drop(spool);

    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    assert!(
        !dir.join(".half.tmp").exists(),
        "an unacknowledged temporary is removed at open"
    );
    let d = director_with(db.store.clone(), "host", spool, arena());
    assert_eq!(d.recover_spooled(), 1, "only the valid record is replayed");
    wait_until("valid record committed", 20, || async {
        db.count("match_results").await == 1
    })
    .await;
    assert_eq!(files(&dir.join("dead"), ".rec").len(), 4);
    for n in 1..=4u128 {
        let reason =
            std::fs::read_to_string(dir.join("dead").join(format!("{}.reason", other(n)))).unwrap();
        assert!(reason.starts_with("corrupt:"), "{reason}");
    }
    assert_eq!(info(&d, "deadLettered"), 4);
    assert_eq!(db.store.get_profile("echo").await.unwrap().unwrap().gv, 12);
    db.reconcile_clean().await;
    db.drop_db().await;
}

// ---------------------------------------------------------------------------------------------------------------------
// Live path: a real match over WebSockets
// ---------------------------------------------------------------------------------------------------------------------

fn hello(p: &str, t: &str) -> ClientMsg {
    ClientMsg::Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        build: String::new(),
        profile: p.into(),
        ticket: t.as_bytes().to_vec(),
        faction: None,
        resume: None,
    }
}

async fn serve(d: Arc<Director>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    d.lifecycle.ready();
    tokio::spawn(async move {
        axum::serve(listener, rh_server::public_router(d))
            .await
            .unwrap()
    });
    url
}

/// Joins both profiles and waits until each is in the running phase. Returns the sockets and their snapshot trackers.
async fn start_run(
    ws_url: &str,
    who: [(&str, &str); 2],
) -> Vec<(Ws, rh_protocol::SnapshotTracker)> {
    let mut out = Vec::new();
    for (p, t) in who {
        let (mut ws, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
        ws.send(Message::Binary(hello(p, t).encode().into()))
            .await
            .unwrap();
        out.push((ws, rh_protocol::SnapshotTracker::new()));
    }
    for (ws, track) in out.iter_mut() {
        loop {
            let b = match tokio::time::timeout(Duration::from_secs(15), ws.next()).await {
                Ok(Some(Ok(Message::Binary(b)))) => b,
                // Control frames are transport heartbeat, not state: the server pings for its RTT estimate.
                Ok(Some(Ok(_))) => continue,
                other => panic!("no run: {other:?}"),
            };
            match track.decode(&b).unwrap() {
                ServerMsg::Snapshot { phase: 1, .. } => break,
                ServerMsg::Reject { code, reason } => panic!("refused: {code:?} {reason}"),
                _ => {}
            }
        }
    }
    out
}

/// Reads for `dur` and returns the highest snapshot tick seen (None if none arrived).
async fn max_tick(
    ws: &mut Ws,
    track: &mut rh_protocol::SnapshotTracker,
    dur: Duration,
) -> Option<u32> {
    let end = tokio::time::Instant::now() + dur;
    let mut max = None;
    while let Ok(Some(Ok(m))) = tokio::time::timeout_at(end, ws.next()).await {
        if let Message::Binary(b) = m {
            if let Ok(ServerMsg::Snapshot { tick, .. }) = track.decode(&b) {
                max = Some(max.map_or(tick, |t: u32| t.max(tick)));
            }
        }
    }
    max
}

async fn leave(ws: &mut Ws) {
    ws.send(Message::Binary(ClientMsg::Leave.encode().into()))
        .await
        .unwrap();
}

/// Holds the row locks the result transaction takes first, so a result's database write blocks (spooled, uncommitted).
async fn lock_leases(db_url: &str) -> sqlx::PgConnection {
    let mut c = sqlx::PgConnection::connect(db_url).await.unwrap();
    sqlx::query("BEGIN").execute(&mut c).await.unwrap();
    sqlx::query("SELECT 1 FROM session_leases FOR UPDATE")
        .execute(&mut c)
        .await
        .unwrap();
    c
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_result_is_spooled_before_it_is_committed_and_removed_only_after() {
    let db = fresh_db("order").await;
    db.store.create_profile("tango", "t1").await.unwrap();
    db.store.create_profile("uniform", "t2").await.unwrap();
    let dir = spool_dir("order");
    let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
    let d = director_with(db.store.clone(), "host-live", spool, arena());
    let url = serve(d.clone()).await;
    let mut socks = start_run(&url, [("tango", "t1"), ("uniform", "t2")]).await;
    let mut lock = lock_leases(&db.url).await;
    leave(&mut socks[0].0).await;

    // Spooled (durable locally) while the commit is blocked: "spooled" is counted, "committed" is not.
    wait_until("both spooled", 20, || async {
        files(&dir, ".rec").len() == 2
    })
    .await;
    // The record file is renamed into place just before "spooled" is counted; wait for the count, then check exactly.
    wait_until("both spooled counted", 5, || async {
        info(&d, "spooled") >= 2
    })
    .await;
    assert_eq!(info(&d, "spooled"), 2);
    assert_eq!(info(&d, "committed"), 0);
    assert_eq!(
        db.count("match_results").await,
        0,
        "nothing is committed yet"
    );
    // The simulation keeps stepping while the store is blocked.
    let (ws1, tr1) = {
        let s = &mut socks[1];
        (&mut s.0, &mut s.1)
    };
    let t0 = max_tick(ws1, tr1, Duration::from_millis(300)).await;
    let t1 = max_tick(ws1, tr1, Duration::from_millis(700)).await;
    if let (Some(a), Some(b)) = (t0, t1) {
        assert!(
            b > a,
            "ticks advance while the database write is blocked ({a} -> {b})"
        );
    }
    sqlx::query("ROLLBACK").execute(&mut lock).await.unwrap();

    // The record disappears only after the commit: whenever the spool is empty, the rows are already there.
    wait_until("spool drained", 30, || async {
        files(&dir, ".rec").is_empty()
    })
    .await;
    assert_eq!(
        db.count("match_results").await,
        2,
        "removed after, never before, the commit"
    );
    // Counters follow the removal (commit, remove, count); wait for them, then check exactly.
    wait_until("commits counted", 5, || async {
        info(&d, "committed") >= 2
    })
    .await;
    assert_eq!(info(&d, "committed"), 2);
    assert_eq!(info(&d, "spoolPending"), 0);
    assert!(files(&dir.join("dead"), ".rec").is_empty());
    db.reconcile_clean().await;
    db.drop_db().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_full_spool_falls_back_to_memory_retry_loudly_and_loses_nothing() {
    let db = fresh_db("full").await;
    db.store.create_profile("tango", "t1").await.unwrap();
    db.store.create_profile("uniform", "t2").await.unwrap();
    let dir = spool_dir("full");
    let spool = ResultSpool::open(
        &dir,
        SpoolConfig {
            max_records: 1,
            ..quick_cfg()
        },
    )
    .unwrap();
    let d = director_with(db.store.clone(), "host-live", spool, arena());
    let url = serve(d.clone()).await;
    let mut socks = start_run(&url, [("tango", "t1"), ("uniform", "t2")]).await;
    let mut lock = lock_leases(&db.url).await;
    leave(&mut socks[0].0).await;
    wait_until("one spooled, one over the bound", 20, || async {
        info(&d, "spooled") == 1 && info(&d, "spoolFull") == 1
    })
    .await;
    assert_eq!(files(&dir, ".rec").len(), 1, "the bound holds");
    sqlx::query("ROLLBACK").execute(&mut lock).await.unwrap();
    wait_until("both committed", 30, || async {
        db.count("match_results").await == 2
    })
    .await;
    wait_until("spool drained", 10, || async {
        files(&dir, ".rec").is_empty()
    })
    .await;
    assert_eq!(info(&d, "committed"), 2);
    db.reconcile_clean().await;
    db.drop_db().await;
}

// ---------------------------------------------------------------------------------------------------------------------
// A real process death
// ---------------------------------------------------------------------------------------------------------------------

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn spawn_server(
    port: u16,
    db_url: &str,
    spool: &Path,
    instance: &str,
    log: &Path,
) -> std::process::Child {
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_rh-server"))
        .args([
            "--bind",
            &format!("127.0.0.1:{port}"),
            "--database-url",
            db_url,
            "--instance-id",
            instance,
            "--min-players",
            "2",
            "--fill-seconds",
            "0",
            "--lobby-seconds",
            "30",
            "--result-spool",
            spool.to_str().unwrap(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::fs::File::create(log).unwrap())
        .spawn()
        .expect("start rh-server");
    let t0 = std::time::Instant::now();
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(
            t0.elapsed() < Duration::from_secs(30),
            "rh-server did not start"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    child
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn process_kill_between_spool_and_commit_recovers_exactly_once() {
    let db = fresh_db("kill").await;
    db.store.create_profile("tango", "t1").await.unwrap();
    db.store.create_profile("uniform", "t2").await.unwrap();
    let dir = spool_dir("kill");
    let logs = spool_dir("kill-logs");
    let port = free_port();
    let mut first = spawn_server(port, &db.url, &dir, "host-old", &logs.join("first.log"));
    let url = format!("ws://127.0.0.1:{port}/ws");
    let mut socks = start_run(&url, [("tango", "t1"), ("uniform", "t2")]).await;
    let mut lock = lock_leases(&db.url).await;
    leave(&mut socks[0].0).await;
    wait_until("results spooled by the first process", 30, || async {
        files(&dir, ".rec").len() == 2
    })
    .await;
    // The record is written before its log line; wait for both lines so the kill cannot land between them.
    wait_until("spooled log lines", 30, || async {
        std::fs::read_to_string(logs.join("first.log"))
            .is_ok_and(|l| l.matches("spooled match=").count() == 2)
    })
    .await;
    assert_eq!(
        db.count("match_results").await,
        0,
        "blocked: spooled but not committed"
    );

    // SIGKILL: no drain, no flush, no destructors.
    first.kill().unwrap();
    first.wait().unwrap();
    sqlx::query("ROLLBACK").execute(&mut lock).await.unwrap();
    drop(socks);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        db.count("match_results").await,
        0,
        "the dead process committed nothing"
    );
    assert_eq!(
        files(&dir, ".rec").len(),
        2,
        "both records survived the kill"
    );
    let log1 = std::fs::read_to_string(logs.join("first.log")).unwrap();
    assert!(log1.contains("spooled match="), "{log1}");
    assert!(!log1.contains("committed match="), "{log1}");

    // A second process, a different instance id, the same spool.
    let mut second = spawn_server(
        free_port(),
        &db.url,
        &dir,
        "host-new",
        &logs.join("second.log"),
    );
    wait_until("recovered", 30, || async {
        db.count("match_results").await == 2
    })
    .await;
    wait_until("spool drained", 30, || async {
        files(&dir, ".rec").is_empty()
    })
    .await;
    let owners: Vec<String> = sqlx::query_scalar("SELECT DISTINCT owner FROM matches")
        .fetch_all(db.store.pool())
        .await
        .unwrap();
    assert_eq!(
        owners,
        vec!["host-old".to_string()],
        "the original match metadata, not the restarted instance's"
    );
    let fences: Vec<i64> =
        sqlx::query_scalar("SELECT fence FROM match_results ORDER BY profile_id")
            .fetch_all(db.store.pool())
            .await
            .unwrap();
    assert_eq!(fences, vec![1, 1]);
    let paid: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM match_results WHERE (result->'gv'->>'total')::bigint > 0",
    )
    .fetch_one(db.store.pool())
    .await
    .unwrap();
    assert_eq!(
        db.count("gv_ledger").await,
        paid,
        "one ledger row per paid result, none doubled"
    );
    let runs: i64 = sqlx::query_scalar(
        "SELECT coalesce(sum((stats->>'runs')::bigint),0)::bigint FROM profiles",
    )
    .fetch_one(db.store.pool())
    .await
    .unwrap();
    assert_eq!(runs, 2, "each run counted exactly once");
    // Persistence/unlink complete before the diagnostic is emitted. Keep the process alive
    // until that final completion signal rather than racing SIGKILL against its logging task.
    wait_until("recovery completion log", 30, || async {
        std::fs::read_to_string(logs.join("second.log"))
            .unwrap_or_default()
            .contains("recovered from spool")
    })
    .await;
    second.kill().unwrap();
    second.wait().unwrap();
    let log2 = std::fs::read_to_string(logs.join("second.log")).unwrap();
    assert!(log2.contains("recovered from spool"), "{log2}");
    assert!(files(&dir.join("dead"), ".rec").is_empty());
    db.reconcile_clean().await;
    db.drop_db().await;
}

// ---------------------------------------------------------------------------------------------------------------------
// PostgreSQL stopped and restarted during a match (own throwaway cluster)
// ---------------------------------------------------------------------------------------------------------------------

fn pg_bin() -> PathBuf {
    if let Ok(b) = std::env::var("PGBIN") {
        return b.into();
    }
    let mut cands: Vec<PathBuf> = std::fs::read_dir("/usr/lib/postgresql")
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path().join("bin"))
                .collect()
        })
        .unwrap_or_default();
    cands.sort();
    cands
        .pop()
        .expect("PGBIN is not set and no /usr/lib/postgresql/*/bin exists")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn database_stopped_during_a_match_ticks_continue_and_the_result_lands_after_restart() {
    let state = spool_dir("pgstate");
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/pgtest/start.sh");
    let out = std::process::Command::new("bash")
        .arg(&script)
        .env("RH_PGTEST_STATE", &state)
        .env("LC_ALL", "en_US.UTF-8")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "start.sh: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let cluster_url = std::fs::read_to_string(state.join("url"))
        .unwrap()
        .trim()
        .to_owned();
    let cluster_dir = PathBuf::from(std::fs::read_to_string(state.join("dir")).unwrap().trim());
    let port = cluster_url
        .rsplit(':')
        .next()
        .unwrap()
        .split('/')
        .next()
        .unwrap()
        .to_owned();

    let result = std::panic::AssertUnwindSafe(async {
        let admin = rh_persist::Store::connect(&cluster_url).await.unwrap();
        sqlx::query("CREATE DATABASE rh_outage")
            .execute(admin.pool())
            .await
            .unwrap();
        let db_url = format!(
            "{}/rh_outage",
            &cluster_url[..cluster_url.rfind('/').unwrap()]
        );
        let store = Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
        store.migrate().await.unwrap();
        store.create_profile("tango", "t1").await.unwrap();
        store.create_profile("uniform", "t2").await.unwrap();
        let dir = spool_dir("outage");
        let spool = ResultSpool::open(&dir, quick_cfg()).unwrap();
        let d = director_with(store.clone(), "host-live", spool, arena());
        let url = serve(d.clone()).await;
        let mut socks = start_run(&url, [("tango", "t1"), ("uniform", "t2")]).await;

        let pg_ctl = pg_bin().join("pg_ctl");
        let ctl = |args: &[&str]| {
            let st = std::process::Command::new(&pg_ctl)
                .args(args)
                .env("LC_ALL", "en_US.UTF-8")
                .output()
                .unwrap();
            assert!(
                st.status.success(),
                "pg_ctl {args:?}: {}",
                String::from_utf8_lossy(&st.stderr)
            );
        };
        let data = cluster_dir.join("data");
        ctl(&["-D", data.to_str().unwrap(), "-m", "fast", "-w", "stop"]);

        // Database down: the simulation keeps stepping.
        let (ws1, tr1) = {
            let s = &mut socks[1];
            (&mut s.0, &mut s.1)
        };
        let a = max_tick(ws1, tr1, Duration::from_millis(400))
            .await
            .expect("snapshots with the database down");
        let b = max_tick(ws1, tr1, Duration::from_millis(1200))
            .await
            .expect("snapshots with the database down");
        assert!(b >= a + 10, "ticks advance during the outage ({a} -> {b})");

        // The match ends during the outage: both results are spooled, none committed.
        leave(&mut socks[0].0).await;
        wait_until("results spooled during the outage", 20, || async {
            files(&dir, ".rec").len() == 2
        })
        .await;
        assert_eq!(info(&d, "committed"), 0);

        let opts = format!(
            "-p {port} -k {} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300",
            cluster_dir.display()
        );
        ctl(&[
            "-D",
            data.to_str().unwrap(),
            "-l",
            cluster_dir.join("postgres.log").to_str().unwrap(),
            "-w",
            "-o",
            &opts,
            "start",
        ]);

        wait_until("results committed after the restart", 60, || async {
            info(&d, "committed") == 2 && files(&dir, ".rec").is_empty()
        })
        .await;
        let fresh = rh_persist::Store::connect(&db_url).await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM match_results")
            .fetch_one(fresh.pool())
            .await
            .unwrap();
        assert_eq!(n, 2);
        let r = rh_persist::admin::reconcile(&fresh).await.unwrap();
        assert!(r.ok(), "{:?}", r.mismatches);
        assert!(files(&dir.join("dead"), ".rec").is_empty());
    });
    let outcome = futures_util::FutureExt::catch_unwind(result).await;
    let _ = std::process::Command::new("bash")
        .arg(script.with_file_name("stop.sh"))
        .env("RH_PGTEST_STATE", &state)
        .output();
    if let Err(p) = outcome {
        std::panic::resume_unwind(p);
    }
}
