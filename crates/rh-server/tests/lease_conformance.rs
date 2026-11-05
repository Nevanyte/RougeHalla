//! One table of lease cases, run against both stores the director can sit on: the strict in-memory store (always) and
//! rh-persist's PostgreSQL store (feature `postgres`, DATABASE_URL; `eval "$(tools/pgtest/start.sh)"`). The director's
//! lease proofs run on `MemoryStore::strict`, which re-implements rh-persist's rules, so the two must agree on every case
//! here or a test fails.
//!
//! Deliberately outside the table, because the memory store has no counterpart:
//! - expiry: memory leases never expire (Postgres leases carry a ttl; the server asks for an hour);
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
                let got = p.record(mid(m), profile, fence, &result(profile)).await;
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
        let p = Persistence::Postgres {
            store: store.clone(),
            owner: "conformance".into(),
        };
        run(&p, "postgres", name, &ops).await;
    }
}
