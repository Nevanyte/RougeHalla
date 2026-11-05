//! One table of lease cases, run against both stores the director can sit on: the strict in-memory store (always) and
//! rh-persist's PostgreSQL store (feature `postgres`, DATABASE_URL; `eval "$(tools/pgtest/start.sh)"`). The director's
//! lease proofs run on `MemoryStore::strict`, which re-implements rh-persist's rules, so the two must agree on every case
//! here or a test fails.
//!
//! Deliberately outside the table, because the memory store has no counterpart:
//! - expiry and renewal timing have separate live-Postgres and paused-clock tests;
//! - the lease owner: Postgres keeps the fence on a re-acquire only when match AND owner match, memory checks the match
//!   (one `Persistence` has one owner, so the director never sees a difference);
//! - an unknown profile: Postgres refuses it (`UnknownProfile`), memory has no profile table and accepts any name.

use rh_server::persist::{MemoryStore, Persistence, RecordError, Recorded};
use rh_sim::{Outcome, RunResult};

#[derive(Debug)]
enum Op {
    /// (profile as asked, match, expected fence or None for a refusal)
    Acquire(&'static str, u8, Option<i64>),
    /// (profile, fence, expected)
    Release(&'static str, i64, bool),
    /// (profile, match, fence, expected)
    Record(&'static str, u8, i64, Rec),
}

#[derive(Debug, PartialEq)]
enum Rec {
    Applied,
    AlreadyApplied,
    Refused(&'static str),
}

use Op::{Acquire, Record, Release};

/// (case name, profiles it uses as created, ops). Fences start at 1 and only ever grow per profile.
type Case = (&'static str, &'static [&'static str], Vec<Op>);

fn cases() -> Vec<Case> {
    vec![
        (
            "acquire is idempotent per match and exclusive across matches",
            &["Alpha"],
            vec![
                Acquire("Alpha", 1, Some(1)),
                Acquire("Alpha", 1, Some(1)),
                Acquire("Alpha", 2, None),
                // The profile is the same whatever its case.
                Acquire("ALPHA", 2, None),
                Acquire("alpha", 1, Some(1)),
            ],
        ),
        (
            "release is fenced, once, and the fence is never reused",
            &["Bravo"],
            vec![
                Acquire("Bravo", 1, Some(1)),
                Release("Bravo", 9, false),
                Release("bravo", 1, true),
                Release("Bravo", 1, false),
                // A released lease carries no result.
                Record("Bravo", 1, 1, Rec::Refused("NoLease")),
                // The next lease, for the same match or another, gets a new fence.
                Acquire("Bravo", 2, Some(2)),
                Acquire("Bravo", 1, None),
                Release("Bravo", 2, true),
                Acquire("Bravo", 2, Some(3)),
            ],
        ),
        (
            "a result needs the live lease of its own match, and the write releases it",
            &["Charlie"],
            vec![
                Record("Charlie", 1, 1, Rec::Refused("NoLease")),
                Acquire("Charlie", 1, Some(1)),
                Record("Charlie", 1, 7, Rec::Refused("StaleFence")),
                Record("Charlie", 2, 1, Rec::Refused("NoLease")),
                Record("Charlie", 1, 1, Rec::Applied),
                // Applied is checked before the lease: the same write again is idempotent whatever fence it carries.
                Record("Charlie", 1, 1, Rec::AlreadyApplied),
                Record("charlie", 1, 99, Rec::AlreadyApplied),
                // The write released the lease in the same step.
                Release("Charlie", 1, false),
                Acquire("Charlie", 2, Some(2)),
            ],
        ),
        (
            "a write under a superseded fence is stale, not applied",
            &["Delta"],
            vec![
                Acquire("Delta", 1, Some(1)),
                Release("Delta", 1, true),
                Acquire("Delta", 2, Some(2)),
                Record("Delta", 1, 1, Rec::Refused("StaleFence")),
                Record("Delta", 2, 2, Rec::Applied),
            ],
        ),
        (
            "a released lease checks the fence before the lease: a different fence is stale",
            &["Golf"],
            vec![
                Acquire("Golf", 1, Some(1)),
                Release("Golf", 1, true),
                Record("Golf", 1, 5, Rec::Refused("StaleFence")),
            ],
        ),
        (
            "profiles are independent, and so are their results for one match",
            &["Echo", "Foxtrot"],
            vec![
                Acquire("Echo", 1, Some(1)),
                Acquire("Foxtrot", 1, Some(1)),
                Record("Echo", 1, 1, Rec::Applied),
                Release("Foxtrot", 1, true),
                Acquire("Foxtrot", 1, Some(2)),
                Record("Foxtrot", 1, 2, Rec::Applied),
                Record("Echo", 1, 1, Rec::AlreadyApplied),
            ],
        ),
    ]
}

fn result(profile: &str) -> RunResult {
    RunResult {
        outcome: Outcome::Mia,
        profile: profile.into(),
        duration_sec: 1,
        kills: 0,
        killed_by: None,
        killed_by_bot: false,
        place: 2,
        players: 2,
        gv: Default::default(),
        win_bonus_withheld: false,
        win_bonus_why: None,
    }
}

fn mid(n: u8) -> [u8; 16] {
    [n; 16]
}

async fn run(p: &Persistence, backend: &str, name: &str, ops: &[Op]) {
    for (i, op) in ops.iter().enumerate() {
        let at = format!("{backend}: {name}: step {i} {op:?}");
        match *op {
            Acquire(profile, m, want) => {
                let got = p.acquire(profile, mid(m)).await;
                assert_eq!(got.as_ref().ok().copied(), want, "{at}: got {got:?}");
            }
            Release(profile, fence, want) => {
                assert_eq!(p.release(profile, fence).await, Ok(want), "{at}");
            }
            Record(profile, m, fence, ref want) => {
                let got = p
                    .record(mid(m), profile, fence, &result(profile), Default::default())
                    .await;
                let got = match got {
                    Ok(Recorded::Applied) => Rec::Applied,
                    Ok(Recorded::AlreadyApplied) => Rec::AlreadyApplied,
                    Err(RecordError::Refused(why)) => {
                        let why: &'static str = match why.as_str() {
                            "NoLease" => "NoLease",
                            "StaleFence" => "StaleFence",
                            other => panic!("{at}: unexpected refusal {other}"),
                        };
                        Rec::Refused(why)
                    }
                    Err(e) => panic!("{at}: {e}"),
                };
                assert_eq!(&got, want, "{at}");
            }
        }
    }
}

#[tokio::test]
async fn strict_memory_store_follows_the_lease_table() {
    for (name, _, ops) in cases() {
        let p = Persistence::Memory(Box::new(MemoryStore::strict()));
        run(&p, "memory", name, &ops).await;
    }
}

#[cfg(feature = "postgres")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rh_persist_follows_the_lease_table() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_lease_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = match url.rfind('/') {
        Some(i) => format!("{}/{db}", &url[..i]),
        None => panic!("DATABASE_URL has no database name"),
    };
    let store = std::sync::Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    for (name, profiles, ops) in cases() {
        for profile in profiles {
            store.create_profile(profile, "token").await.unwrap();
        }
        let p = Persistence::postgres(store.clone(), "conformance".into());
        run(&p, "postgres", name, &ops).await;
    }
    drop(store);
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}

/// A profile renamed after its admission still banks and releases: the admission's `profile_id` is what the live match
/// uses, not the callsign (which only the edge resolves). Another profile that takes the old name is not touched.
#[cfg(feature = "postgres")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rename_after_admission_banks_once_and_frees_the_lease() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_lease_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = match url.rfind('/') {
        Some(i) => format!("{}/{db}", &url[..i]),
        None => panic!("DATABASE_URL has no database name"),
    };
    let store = std::sync::Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    store.create_profile("Oldname", "t1").await.unwrap();
    store.create_profile("Other", "t2").await.unwrap();
    let p = Persistence::postgres(store.clone(), "rename".into());
    let m = mid(9);
    let fence = p.acquire("Oldname", m).await.unwrap();
    let other = p.acquire("Other", m).await.unwrap();
    assert_eq!((fence, other), (1, 1));
    // Moderation swaps the two names while the match is live.
    for (from, to) in [("Oldname", "tmp"), ("Other", "Oldname"), ("tmp", "Newname")] {
        sqlx::query("UPDATE profiles SET callsign = $2 WHERE lower(callsign) = lower($1)")
            .bind(from)
            .bind(to)
            .execute(store.pool())
            .await
            .unwrap();
    }
    // The room still reports under the admission name: the result lands on the profile admitted, exactly once.
    let r = p
        .record(m, "Oldname", fence, &result("Oldname"), Default::default())
        .await;
    assert_eq!(r, Ok(Recorded::Applied));
    let r = p
        .record(m, "Oldname", fence, &result("Oldname"), Default::default())
        .await;
    assert_eq!(r, Ok(Recorded::AlreadyApplied));
    let count = |name: &'static str| {
        let pool = store.pool().clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM match_results mr JOIN profiles p USING (profile_id)
                 WHERE lower(p.callsign) = $1",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(
        count("newname").await,
        1,
        "credited to the renamed profile, not the one that took its name"
    );
    assert_eq!(count("oldname").await, 0);
    // The other player's lease is released by id too, and the slot is free at once.
    assert_eq!(p.release("Other", other).await, Ok(true));
    assert_eq!(p.acquire("Newname", mid(10)).await, Ok(2));
    let replacement = p.acquire("Oldname", mid(11)).await.unwrap();
    assert!(
        p.release_for_match("Oldname", m, replacement)
            .await
            .is_err(),
        "an old name-only reporter cannot release a reassigned callsign"
    );
    let replacement_id = store.profile_id("Oldname").await.unwrap().unwrap();
    assert!(!store
        .release_match_lease_by_id(replacement_id, uuid::Uuid::from_bytes(m), replacement)
        .await
        .unwrap());
    assert!(store
        .release_match_lease_by_id(replacement_id, uuid::Uuid::from_bytes(mid(11)), replacement)
        .await
        .unwrap());
    // The full old tuple (callsign, match and numeric fence) can name two different
    // rows after a rename. Compatibility calls refuse it; an ID-bearing result remains safe.
    store.create_profile("Again", "before").await.unwrap();
    let same = mid(12);
    let prior = p.acquire("Again", same).await.unwrap();
    assert_eq!(
        p.record(same, "Again", prior, &result("Again"), Default::default())
            .await,
        Ok(Recorded::Applied)
    );
    sqlx::query("UPDATE profiles SET callsign='Earlier' WHERE callsign='Again'")
        .execute(store.pool())
        .await
        .unwrap();
    store.create_profile("Again", "after").await.unwrap();
    let replacement = p.acquire("Again", same).await.unwrap();
    assert_eq!(prior, replacement);
    assert!(
        matches!(p.record(same,"Again",prior,&result("Again"),Default::default()).await,Err(RecordError::Refused(e)) if e.contains("ambiguous"))
    );
    assert!(p.release_for_match("Again", same, prior).await.is_err());
    assert!(p.release("Again", prior).await.is_err());
    assert_eq!(count("again").await, 0);
    let id = store.profile_id("Again").await.unwrap().unwrap();
    assert_eq!(
        p.record_by_id(same, id, replacement, &result("Again"), Default::default())
            .await,
        Ok(Recorded::Applied)
    );
    assert_eq!(count("again").await, 1);
    drop(p);
    drop(store);
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}

/// A real actor stays leased across its initial TTL, including a callsign reassignment. Lock its
/// lease row through the next deadline: room ticks continue, its current connection (resumed
/// during the stall) closes, and an old host cannot bank the resulting forced MIA.
#[cfg(feature = "postgres")]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn director_renews_live_seats_by_id_and_expires_only_the_stalled_seat() {
    use rh_protocol::{RejectCode, PROTOCOL_VERSION};
    use rh_server::{
        director::{Director, DirectorConfig, Hello, LeasePolicy},
        hosting::Lifecycle,
        outbox::Outbox,
        persist::Auth,
    };
    use std::{
        sync::{atomic::Ordering, Arc},
        time::Duration,
    };
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            return;
        }
        panic!("DATABASE_URL required for lease renewal proof")
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_renew_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let dburl = format!("{}/{db}", url.rsplit_once('/').unwrap().0);
    let store = Arc::new(rh_persist::Store::connect(&dburl).await.unwrap());
    store.migrate().await.unwrap();
    for name in ["Archer", "Guard", "Scout"] {
        store.create_profile(name, "token").await.unwrap();
    }
    let mut cfg = DirectorConfig::new(
        rh_sim::SimConfig {
            min_players: 3,
            fill_seconds: 0.,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
    );
    let ttl = Duration::from_millis(1400);
    cfg.leases = LeasePolicy {
        ttl,
        renew_interval: Duration::from_millis(180),
        db_timeout: Duration::from_millis(110),
    };
    cfg.tick = Duration::from_millis(10);
    let p = Arc::new(Persistence::postgres(store.clone(), "host-a".into()));
    let director = Director::new(
        cfg,
        p.clone(),
        Arc::new(Auth::Dev),
        Arc::new(Lifecycle::default()),
    );
    let hello = |profile: &str, resume| Hello {
        protocol: PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        profile: profile.into(),
        ticket: vec![],
        faction: None,
        resume,
    };
    let (_, first) = director
        .admit(hello("Archer", None), Arc::new(Outbox::default()), 1)
        .await
        .unwrap();
    let mut remaining = Vec::new();
    for (name, conn) in [("Guard", 2), ("Scout", 3)] {
        let (tx, join) = director
            .admit(hello(name, None), Arc::new(Outbox::default()), conn)
            .await
            .unwrap();
        remaining.push((tx, join.player, conn));
    }
    let (pid,mid,initial):(i64,uuid::Uuid,f64)=sqlx::query_as(
        "SELECT profile_id,match_id,EXTRACT(EPOCH FROM expires_at)::float8 FROM session_leases JOIN profiles USING(profile_id) WHERE callsign='Archer'")
        .fetch_one(store.pool()).await.unwrap();
    sqlx::query("UPDATE profiles SET callsign='Renamed' WHERE profile_id=$1")
        .bind(pid)
        .execute(store.pool())
        .await
        .unwrap();
    store.create_profile("Archer", "replacement").await.unwrap();
    let separate = store
        .acquire_lease("Archer", uuid::Uuid::new_v4(), "different", ttl)
        .await
        .unwrap();
    tokio::time::sleep(ttl + Duration::from_millis(250)).await;
    let (renewed,live):(f64,bool)=sqlx::query_as("SELECT EXTRACT(EPOCH FROM expires_at)::float8,expires_at>clock_timestamp() FROM session_leases WHERE profile_id=$1").bind(pid).fetch_one(store.pool()).await.unwrap();
    assert!(live && renewed > initial + 1.0);
    assert!(store
        .acquire_lease("Renamed", uuid::Uuid::new_v4(), "host-b", ttl)
        .await
        .is_err());
    let replacement_live: bool =
        sqlx::query_scalar("SELECT expires_at>now() FROM session_leases WHERE profile_id=$1")
            .bind(separate.profile_id)
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert!(
        !replacement_live,
        "renew must never follow the reused callsign"
    );

    let mut lock = store.pool().begin().await.unwrap();
    sqlx::query("SELECT profile_id FROM session_leases WHERE profile_id=$1 FOR UPDATE")
        .bind(pid)
        .execute(&mut *lock)
        .await
        .unwrap();
    // The first heartbeat has already encountered the lock. Busy is transient; the prior
    // confirmed deadline remains valid and the seat may still resume.
    tokio::time::sleep(Duration::from_millis(350)).await;
    let resumed = Arc::new(Outbox::default());
    director
        .admit(hello("Archer", Some(first.session)), resumed.clone(), 4)
        .await
        .unwrap();
    let before = f64::from_bits(first.clock.load(Ordering::Relaxed));
    tokio::time::sleep(ttl + Duration::from_millis(300)).await;
    assert!(
        f64::from_bits(first.clock.load(Ordering::Relaxed)) > before + 500.,
        "stalled store must not block room ticks"
    );
    assert_eq!(
        resumed.drain_into(&mut vec![]).close,
        Some(RejectCode::Kicked)
    );
    assert!(matches!(
        director
            .admit(
                hello("Archer", Some(first.session)),
                Arc::new(Outbox::default()),
                5
            )
            .await,
        Err((RejectCode::NoSuchSession, _))
    ));
    let expired: bool = sqlx::query_scalar(
        "SELECT expires_at<clock_timestamp() FROM session_leases WHERE profile_id=$1",
    )
    .bind(pid)
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    assert!(expired);
    let guard_live:bool = sqlx::query_scalar(
        "SELECT expires_at > clock_timestamp() FROM session_leases JOIN profiles USING(profile_id) WHERE callsign='Guard'")
        .fetch_one(store.pool()).await.unwrap();
    assert!(
        guard_live,
        "a busy row must not stop other seats from renewing"
    );
    lock.commit().await.unwrap();
    assert!(
        !store.try_renew_live_lease(pid, mid, 1, ttl).await.unwrap(),
        "an expired live lease cannot be revived"
    );
    let newer = store
        .acquire_lease("Renamed", uuid::Uuid::new_v4(), "host-b", ttl)
        .await
        .unwrap();
    assert!(newer.fence > 1);
    let late = p
        .record_by_id(
            *mid.as_bytes(),
            pid,
            1,
            &result("Archer"),
            Default::default(),
        )
        .await;
    assert_eq!(late, Err(RecordError::Refused("StaleFence".into())));
    for (tx, player, conn) in remaining {
        tx.send(rh_server::room::RoomCmd::Leave { player, conn })
            .await
            .unwrap();
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while director.room_count() != 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(director.wait_for_writes(Duration::from_secs(5)).await);
    let banked: i64 = sqlx::query_scalar("SELECT count(*) FROM match_results WHERE profile_id=$1")
        .bind(pid)
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(banked, 0, "expired gameplay cannot bank a forced MIA");
    director.drain().await;
    drop(director);
    sqlx::query(&format!("DROP DATABASE {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await
        .unwrap();
}

#[cfg(feature = "postgres")]
mod admission_identity {
    use super::*;
    use rh_protocol::{RejectCode, PROTOCOL_VERSION};
    use rh_server::{
        director::{Director, DirectorConfig, Hello, LeasePolicy},
        hosting::Lifecycle,
        outbox::Outbox,
        persist::Auth,
        room::RoomCmd,
    };
    use std::{sync::Arc, time::Duration};

    struct Db {
        admin: rh_persist::Store,
        name: String,
        db: Arc<rh_persist::Store>,
    }
    impl Db {
        async fn new() -> Option<Self> {
            let Ok(url) = std::env::var("DATABASE_URL") else {
                assert_eq!(std::env::var("RH_SKIP_PG_TESTS").as_deref(), Ok("1"));
                return None;
            };
            let admin = rh_persist::Store::connect(&url).await.unwrap();
            let name = format!("rh_admit_{}", uuid::Uuid::new_v4().simple());
            sqlx::query(&format!("CREATE DATABASE {name}"))
                .execute(admin.pool())
                .await
                .unwrap();
            let db = Arc::new(
                rh_persist::Store::connect(&format!("{}/{name}", url.rsplit_once('/').unwrap().0))
                    .await
                    .unwrap(),
            );
            db.migrate().await.unwrap();
            Some(Self { admin, name, db })
        }
        fn director(&self, min_players: usize) -> Arc<Director> {
            let mut cfg = DirectorConfig::new(
                rh_sim::SimConfig {
                    min_players,
                    fill_seconds: 0.0,
                    ..Default::default()
                },
                rh_sim::arenas::practice_arena(),
            );
            cfg.tick = Duration::from_millis(10);
            cfg.leases = LeasePolicy {
                ttl: Duration::from_secs(3),
                renew_interval: Duration::from_millis(200),
                db_timeout: Duration::from_millis(250),
            };
            Director::new(
                cfg,
                Arc::new(Persistence::postgres(self.db.clone(), "test".into())),
                Arc::new(Auth::Postgres(self.db.clone())),
                Arc::new(Lifecycle::default()),
            )
        }
        async fn finish(self) {
            sqlx::query(&format!("DROP DATABASE {} WITH (FORCE)", self.name))
                .execute(self.admin.pool())
                .await
                .unwrap();
        }
    }
    fn hello(name: &str, token: &str) -> Hello {
        Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            profile: name.into(),
            ticket: token.as_bytes().to_vec(),
            faction: None,
            resume: None,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
    async fn aliases_share_ownership_but_reused_names_bank_two_distinct_results() {
        let Some(case) = Db::new().await else { return };
        let store = &case.db;
        let d = case.director(3);
        store.create_profile("Archer", "old").await.unwrap();
        let old = store.profile_id("Archer").await.unwrap().unwrap();
        let (tx, a) = d
            .admit(hello("Archer", "old"), Arc::new(Outbox::default()), 1)
            .await
            .unwrap();
        sqlx::query("UPDATE profiles SET callsign='Renamed' WHERE profile_id=$1")
            .bind(old)
            .execute(store.pool())
            .await
            .unwrap();
        assert!(matches!(
            d.admit(hello("Renamed", "old"), Arc::new(Outbox::default()), 2)
                .await,
            Err((RejectCode::ProfileInUse, _))
        ));
        store.create_profile("Archer", "new").await.unwrap();
        let new = store.profile_id("Archer").await.unwrap().unwrap();
        let (_, b) = d
            .admit(hello("Archer", "new"), Arc::new(Outbox::default()), 3)
            .await
            .unwrap();
        assert_ne!(a.session, b.session);
        let rows: Vec<(uuid::Uuid, i64)> =
            sqlx::query_as("SELECT match_id,fence FROM session_leases ORDER BY profile_id")
                .fetch_all(store.pool())
                .await
                .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], rows[1]);
        store.create_profile("Guard", "guard").await.unwrap();
        let (_, g) = d
            .admit(hello("Guard", "guard"), Arc::new(Outbox::default()), 4)
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        for (player, conn) in [(a.player, 1), (b.player, 3), (g.player, 4)] {
            tx.send(RoomCmd::Leave { player, conn }).await.unwrap();
        }
        tokio::time::timeout(Duration::from_secs(4), async {
            while d.room_count() > 0 {
                tokio::time::sleep(Duration::from_millis(10)).await
            }
        })
        .await
        .unwrap();
        assert!(d.wait_for_writes(Duration::from_secs(4)).await);
        let ids:Vec<i64>=sqlx::query_scalar("SELECT profile_id FROM match_results WHERE match_id=$1 AND profile_id IN($2,$3) ORDER BY profile_id").bind(rows[0].0).bind(old).bind(new).fetch_all(store.pool()).await.unwrap();
        assert_eq!(ids, vec![old, new]);
        case.finish().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
    async fn credential_waiters_keep_the_verified_id_and_blocked_acquires_leave_no_lease() {
        let Some(case) = Db::new().await else { return };
        let store = &case.db;
        let d = case.director(8);
        for name in ["Anchor", "Swap", "Ghost"] {
            store.create_profile(name, "old").await.unwrap();
        }
        let (_, anchor) = d
            .admit(hello("Anchor", "old"), Arc::new(Outbox::default()), 1)
            .await
            .unwrap();
        let (tx, first) = d
            .admit(hello("Swap", "old"), Arc::new(Outbox::default()), 2)
            .await
            .unwrap();
        let orig = store.profile_id("Swap").await.unwrap().unwrap();
        let mut lock = store.pool().begin().await.unwrap();
        sqlx::query("SELECT profile_id FROM session_leases WHERE profile_id=$1 FOR UPDATE")
            .bind(orig)
            .execute(&mut *lock)
            .await
            .unwrap();
        tx.send(RoomCmd::Leave {
            player: first.player,
            conn: 2,
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(3),async{
            loop{
                let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE 'UPDATE session_leases SET released_at%')").bind(&case.name).fetch_one(case.admin.pool()).await.unwrap();
                if waiting{break} tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        let before: f64 =
            sqlx::query_scalar("SELECT extract(epoch from clock_timestamp())::float8")
                .fetch_one(case.admin.pool())
                .await
                .unwrap();
        let cloned = d.clone();
        let waiter = tokio::spawn(async move {
            cloned
                .admit(hello("Swap", "old"), Arc::new(Outbox::default()), 3)
                .await
        });
        // Observe the actual auth query complete on the target database before changing either name.
        tokio::time::timeout(Duration::from_secs(3),async{
            loop{
                let done:bool=sqlx::query_scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=$1 AND state='idle' AND query LIKE 'SELECT profile_id, token_sha256 FROM profiles%' AND extract(epoch from query_start)::float8 > $2)").bind(&case.name).bind(before).fetch_one(case.admin.pool()).await.unwrap();
                if done{break}tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.unwrap();
        assert!(!waiter.is_finished());
        sqlx::query("UPDATE profiles SET callsign='Moved' WHERE profile_id=$1")
            .bind(orig)
            .execute(store.pool())
            .await
            .unwrap();
        store.create_profile("Swap", "new").await.unwrap();
        let replacement = store.profile_id("Swap").await.unwrap().unwrap();
        lock.commit().await.unwrap();
        let (_, rejoined) = waiter.await.unwrap().unwrap();
        let active:Vec<i64>=sqlx::query_scalar("SELECT profile_id FROM session_leases WHERE released_at IS NULL AND profile_id IN($1,$2)").bind(orig).bind(replacement).fetch_all(store.pool()).await.unwrap();
        assert_eq!(active, [orig]);
        assert!(!store.verify_token("Swap", "old").await.unwrap());

        let ghost = store
            .acquire_lease(
                "Ghost",
                uuid::Uuid::new_v4(),
                "seed",
                Duration::from_secs(3),
            )
            .await
            .unwrap();
        store
            .release_lease_by_id(ghost.profile_id, ghost.fence)
            .await
            .unwrap();
        let mut lock = store.pool().begin().await.unwrap();
        sqlx::query("SELECT profile_id FROM session_leases WHERE profile_id=$1 FOR UPDATE")
            .bind(ghost.profile_id)
            .execute(&mut *lock)
            .await
            .unwrap();
        assert!(d
            .admit(hello("Ghost", "old"), Arc::new(Outbox::default()), 4)
            .await
            .is_err());
        tokio::time::sleep(Duration::from_millis(350)).await;
        lock.commit().await.unwrap();
        let after: (i64, bool) = sqlx::query_as(
            "SELECT fence,released_at IS NULL FROM session_leases WHERE profile_id=$1",
        )
        .bind(ghost.profile_id)
        .fetch_one(store.pool())
        .await
        .unwrap();
        assert_eq!(after, (ghost.fence, false));

        // Cancel a different first admission inside its INSERT, before a fence has been published.
        store.create_profile("Cancel", "old").await.unwrap();
        sqlx::query("CREATE FUNCTION pause_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$").execute(store.pool()).await.unwrap();
        sqlx::query("CREATE TRIGGER cancel_probe BEFORE INSERT ON session_leases FOR EACH ROW EXECUTE FUNCTION pause_insert()").execute(store.pool()).await.unwrap();
        let cloned = d.clone();
        let cancelled = tokio::spawn(async move {
            cloned
                .admit(hello("Cancel", "old"), Arc::new(Outbox::default()), 5)
                .await
        });
        tokio::time::timeout(Duration::from_secs(2),async{loop{
            let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=$1 AND wait_event='PgSleep')").bind(&case.name).fetch_one(case.admin.pool()).await.unwrap();
            if busy{break}tokio::time::sleep(Duration::from_millis(5)).await;
        }}).await.unwrap();
        cancelled.abort();
        assert!(cancelled.await.is_err());
        sqlx::query("DROP TRIGGER cancel_probe ON session_leases")
            .execute(store.pool())
            .await
            .unwrap();
        let (_, fresh) = d
            .admit(hello("Cancel", "old"), Arc::new(Outbox::default()), 6)
            .await
            .unwrap();
        for (player, conn) in [(anchor.player, 1), (rejoined.player, 3), (fresh.player, 6)] {
            tx.send(RoomCmd::Leave { player, conn }).await.unwrap();
        }
        case.finish().await;
    }
}
