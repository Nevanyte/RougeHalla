mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{run, setup};
use rh_persist::admin::reconcile;
use rh_persist::{Claim, Error, GvBreakdown, MatchMeta, MatchResult, Outcome, RecordOutcome};
use uuid::Uuid;

const TTL: Duration = Duration::from_secs(60);

fn applied(o: &RecordOutcome) -> bool {
    matches!(o, RecordOutcome::Applied { .. })
}

#[tokio::test]
async fn duplicate_submission_credits_once() {
    let Some(db) = setup().await else { return };
    db.profile("alice").await;
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("alice", m, "srv-a", TTL)
        .await
        .unwrap();
    assert_eq!(lease.fence, 1);
    let first = db
        .store
        .record_result(m, "alice", lease.fence, &run(40), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(
        first,
        RecordOutcome::Applied {
            gv_credited: 40,
            unlocked: vec!["first_blood".into()]
        }
    );
    let second = db
        .store
        .record_result(m, "alice", lease.fence, &run(40), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(second, RecordOutcome::AlreadyApplied);

    let p = db.store.get_profile("alice").await.unwrap().unwrap();
    assert_eq!((p.gv, p.gv_lifetime), (40, 40));
    assert_eq!(p.stats.runs, 1);
    assert_eq!(p.gv_by_month.values().sum::<i64>(), 40);
    assert_eq!(db.ledger_sum("alice").await, 40);
    assert_eq!(db.count("match_results").await, 1);
    db.teardown().await;
}

#[tokio::test]
async fn stats_follow_the_legacy_record_run() {
    let Some(db) = setup().await else { return };
    db.profile("carol").await;
    let play =
        |outcome: Option<Outcome>, kills, bounty, qualified, faction: &str, weapon: &str, gv| {
            MatchResult {
                outcome,
                kills,
                gv: GvBreakdown {
                    bounty,
                    total: gv,
                    ..Default::default()
                },
                faction: Some(faction.into()),
                weapon: Some(weapon.into()),
                win_qualified: qualified,
                ..Default::default()
            }
        };
    for (r, _) in [
        (
            play(Some(Outcome::Won), 4, 3, true, "fire", "sword", 50),
            (),
        ),
        (
            play(Some(Outcome::Won), 9, 0, false, "fire", "sword", 10),
            (),
        ), // walkover: wins, not qualified
        (play(Some(Outcome::Mia), 0, 0, false, "holy", "bow", 0), ()),
        (play(Some(Outcome::Draw), 2, 0, false, "holy", "bow", 5), ()),
        (
            play(Some(Outcome::Won), 1, 0, true, "nonsense", "fists", 0),
            (),
        ), // unknown ids count for nothing
        (play(None, 99, 99, true, "fire", "sword", 7), ()), // voided run: GV only
    ] {
        let m = Uuid::new_v4();
        let l = db
            .store
            .acquire_lease("carol", m, "srv", TTL)
            .await
            .unwrap();
        assert!(applied(
            &db.store
                .record_result(m, "carol", l.fence, &r, &MatchMeta::unknown())
                .await
                .unwrap()
        ));
    }
    let p = db.store.get_profile("carol").await.unwrap().unwrap();
    assert_eq!(p.gv, 72);
    assert_eq!(p.stats.runs, 5);
    assert_eq!((p.stats.wins, p.stats.draws, p.stats.deaths), (3, 1, 1));
    assert_eq!(p.stats.kills, 16);
    assert_eq!(p.progress.qualified_wins, 2);
    assert_eq!(p.progress.bounty_runs, 1);
    assert_eq!(p.progress.best_run_kills, 9);
    assert_eq!(p.progress.wins_by_faction.get("fire"), Some(&1));
    assert_eq!(p.progress.wins_by_faction.len(), 1);
    assert_eq!(p.progress.wins_by_weapon.get("sword"), Some(&1));
    assert_eq!(db.ledger_sum("carol").await, 72);
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn retry_after_lost_acknowledgement_from_another_server() {
    let Some(db) = setup().await else { return };
    db.profile("dave").await;
    let m = Uuid::new_v4();
    let a = db.store.clone();
    let lease = a.acquire_lease("dave", m, "srv-a", TTL).await.unwrap();
    assert!(applied(
        &a.record_result(m, "dave", lease.fence, &run(25), &MatchMeta::unknown())
            .await
            .unwrap()
    ));
    // The ack never reached srv-a; it (or a replacement host, a new pool) retries the same write later.
    let b = db.other_server().await;
    let retry = b
        .record_result(m, "dave", lease.fence, &run(25), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(retry, RecordOutcome::AlreadyApplied);
    // Even after the fence moved on (the player is in a new match elsewhere) the committed write stays AlreadyApplied.
    let m2 = Uuid::new_v4();
    let l2 = b.acquire_lease("dave", m2, "srv-b", TTL).await.unwrap();
    assert_eq!(l2.fence, 2);
    assert_eq!(
        a.record_result(m, "dave", lease.fence, &run(25), &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    );
    assert_eq!(db.store.get_profile("dave").await.unwrap().unwrap().gv, 25);
    db.teardown().await;
}

#[tokio::test]
async fn fifty_concurrent_matches_on_one_profile_lose_no_update() {
    let Some(db) = setup().await else { return };
    db.profile("erin").await;
    let mut tasks = Vec::new();
    for i in 1..=50i64 {
        let store = db.store.clone();
        tasks.push(tokio::spawn(async move {
            let m = Uuid::new_v4();
            // One live match per profile: contend for the lease, then bank.
            let lease = loop {
                match store
                    .acquire_lease("erin", m, &format!("srv-{i}"), Duration::from_secs(30))
                    .await
                {
                    Ok(l) => break l,
                    Err(Error::LeaseHeld { .. }) => {
                        tokio::time::sleep(Duration::from_millis(3)).await
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            store
                .record_result(m, "erin", lease.fence, &run(i), &MatchMeta::unknown())
                .await
                .unwrap()
        }));
    }
    for t in tasks {
        assert!(applied(&t.await.unwrap()));
    }
    let p = db.store.get_profile("erin").await.unwrap().unwrap();
    assert_eq!(p.gv, 1275);
    assert_eq!(p.gv_lifetime, 1275);
    assert_eq!(p.stats.runs, 50);
    assert_eq!(p.gv_by_month.values().sum::<i64>(), 1275);
    assert_eq!(db.ledger_sum("erin").await, 1275);
    assert_eq!(db.count("gv_ledger").await, 50);
    let fence: i64 = sqlx::query_scalar("SELECT fence FROM session_leases WHERE profile_id = (SELECT profile_id FROM profiles WHERE callsign = 'erin')")
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert_eq!(fence, 50, "every one of the 50 holders got its own fence");
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn two_servers_racing_the_same_result_apply_exactly_once() {
    let Some(db) = setup().await else { return };
    db.profile("frank").await;
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("frank", m, "srv-a", TTL)
        .await
        .unwrap();
    let servers = [db.store.clone(), db.other_server().await];
    let barrier = Arc::new(tokio::sync::Barrier::new(16));
    let mut tasks = Vec::new();
    for i in 0..16 {
        let s = servers[i % 2].clone();
        let b = barrier.clone();
        let fence = lease.fence;
        tasks.push(tokio::spawn(async move {
            b.wait().await;
            s.record_result(m, "frank", fence, &run(100), &MatchMeta::unknown())
                .await
                .unwrap()
        }));
    }
    let mut outcomes = Vec::new();
    for t in tasks {
        outcomes.push(t.await.unwrap());
    }
    assert_eq!(
        outcomes.iter().filter(|o| applied(o)).count(),
        1,
        "{outcomes:?}"
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|o| **o == RecordOutcome::AlreadyApplied)
            .count(),
        15
    );
    let p = db.store.get_profile("frank").await.unwrap().unwrap();
    assert_eq!((p.gv, p.stats.runs), (100, 1));
    assert_eq!(db.ledger_sum("frank").await, 100);
    db.teardown().await;
}

#[tokio::test]
async fn stale_fence_changes_nothing_and_the_new_owner_applies() {
    let Some(db) = setup().await else { return };
    db.profile("gina").await;
    let (ma, mb) = (Uuid::new_v4(), Uuid::new_v4());
    let a = db
        .store
        .acquire_lease("gina", ma, "srv-a", TTL)
        .await
        .unwrap();
    assert_eq!(a.fence, 1);
    // B cannot take a live lease...
    assert!(matches!(
        db.store.acquire_lease("gina", mb, "srv-b", TTL).await,
        Err(Error::LeaseHeld { owner, .. }) if owner == "srv-a"
    ));
    // ...until A's expires (A's host hung).
    sqlx::query("UPDATE session_leases SET expires_at = now() - interval '1 second' WHERE profile_id = (SELECT profile_id FROM profiles WHERE callsign = 'gina')")
        .execute(db.store.pool())
        .await
        .unwrap();
    let b = db
        .store
        .acquire_lease("gina", mb, "srv-b", TTL)
        .await
        .unwrap();
    assert_eq!(b.fence, 2);

    // A wakes up and writes late.
    let late = db
        .store
        .record_result(ma, "gina", a.fence, &run(500), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(late, RecordOutcome::StaleFence);
    let p = db.store.get_profile("gina").await.unwrap().unwrap();
    assert_eq!((p.gv, p.stats.runs), (0, 0));
    assert_eq!(db.count("match_results").await, 0);
    assert_eq!(db.count("gv_ledger").await, 0);
    // A cannot renew or release B's slot either.
    assert!(!db.store.renew_lease("gina", a.fence, TTL).await.unwrap());
    assert!(!db.store.release_lease("gina", a.fence).await.unwrap());

    assert!(applied(
        &db.store
            .record_result(mb, "gina", b.fence, &run(30), &MatchMeta::unknown())
            .await
            .unwrap()
    ));
    assert_eq!(db.store.get_profile("gina").await.unwrap().unwrap().gv, 30);
    db.teardown().await;
}

#[tokio::test]
async fn crash_before_commit_applies_nothing_and_a_retry_applies_once() {
    let Some(db) = setup().await else { return };
    db.profile("hank").await;
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("hank", m, "srv-a", TTL)
        .await
        .unwrap();
    // All writes done inside the transaction, then the backend is killed before COMMIT.
    let crashed = db
        .store
        .record_result_crash_before_commit(m, "hank", lease.fence, &run(77), &MatchMeta::unknown())
        .await;
    assert!(
        crashed.is_err(),
        "commit on a terminated backend must fail: {crashed:?}"
    );
    let p = db.store.get_profile("hank").await.unwrap().unwrap();
    assert_eq!((p.gv, p.gv_lifetime, p.stats.runs), (0, 0, 0));
    assert!(p.gv_by_month.is_empty());
    assert!(p.achievements.is_empty());
    assert!(!p.cosmetics.owned.iter().any(|id| id == "title-bloodied"));
    assert_eq!(db.count("match_results").await, 0);
    assert_eq!(db.count("gv_ledger").await, 0);
    // The lease is still ours (its release was part of the lost transaction).
    assert!(db
        .store
        .renew_lease("hank", lease.fence, TTL)
        .await
        .unwrap());

    let retry = db
        .store
        .record_result(m, "hank", lease.fence, &run(77), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(
        retry,
        RecordOutcome::Applied {
            gv_credited: 77,
            unlocked: vec!["first_blood".into()]
        }
    );
    assert_eq!(
        db.store
            .record_result(m, "hank", lease.fence, &run(77), &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::AlreadyApplied
    );
    assert_eq!(db.store.get_profile("hank").await.unwrap().unwrap().gv, 77);
    assert_eq!(db.ledger_sum("hank").await, 77);
    db.teardown().await;
}

#[tokio::test]
async fn lease_semantics() {
    let Some(db) = setup().await else { return };
    db.profile("iris").await;
    let (m1, m2) = (Uuid::new_v4(), Uuid::new_v4());
    let l1 = db
        .store
        .acquire_lease("iris", m1, "srv-a", TTL)
        .await
        .unwrap();
    // Idempotent re-acquire by the same (match, owner) keeps the fence; callsign case does not matter.
    let again = db
        .store
        .acquire_lease("IRIS", m1, "srv-a", TTL)
        .await
        .unwrap();
    assert_eq!((again.fence, again.callsign.as_str()), (1, "iris"));
    // A different owner for the same match is a different holder.
    assert!(matches!(
        db.store.acquire_lease("iris", m1, "srv-b", TTL).await,
        Err(Error::LeaseHeld { .. })
    ));
    // Release keeps the row, so the next acquire gets a NEW fence: fences are never reused.
    assert!(db.store.release_lease("iris", l1.fence).await.unwrap());
    assert!(!db.store.release_lease("iris", l1.fence).await.unwrap());
    let l2 = db
        .store
        .acquire_lease("iris", m2, "srv-b", TTL)
        .await
        .unwrap();
    assert_eq!(l2.fence, 2);
    // A result for a released lease is refused; an unknown profile has no lease at all.
    assert!(db.store.release_lease("iris", 2).await.unwrap());
    assert_eq!(
        db.store
            .record_result(m2, "iris", 2, &run(5), &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::NoLease
    );
    assert_eq!(
        db.store
            .record_result(m2, "nobody", 1, &run(5), &MatchMeta::unknown())
            .await
            .unwrap(),
        RecordOutcome::NoLease
    );
    assert!(matches!(
        db.store.acquire_lease("nobody", m2, "x", TTL).await,
        Err(Error::UnknownProfile(_))
    ));
    // A short ttl really expires.
    let l3 = db
        .store
        .acquire_lease("iris", Uuid::new_v4(), "srv-c", Duration::from_millis(150))
        .await
        .unwrap();
    assert_eq!(l3.fence, 3);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let l4 = db
        .store
        .acquire_lease("iris", Uuid::new_v4(), "srv-d", TTL)
        .await
        .unwrap();
    assert_eq!(l4.fence, 4);
    // Only one wins when many servers race for a free profile.
    db.profile("jack").await;
    let mut tasks = Vec::new();
    for i in 0..12 {
        let s = db.store.clone();
        tasks.push(tokio::spawn(async move {
            s.acquire_lease("jack", Uuid::new_v4(), &format!("srv-{i}"), TTL)
                .await
        }));
    }
    let mut wins = 0;
    for t in tasks {
        if t.await.unwrap().is_ok() {
            wins += 1;
        }
    }
    assert_eq!(wins, 1);
    db.teardown().await;
}

#[tokio::test]
async fn profiles_are_case_insensitively_unique_and_tokens_are_hashed() {
    let Some(db) = setup().await else { return };
    assert_eq!(
        db.store.create_profile("Kate", "secret-1").await.unwrap(),
        Claim::Created
    );
    assert_eq!(
        db.store.create_profile("kate", "secret-1").await.unwrap(),
        Claim::Existing
    );
    assert_eq!(
        db.store.create_profile("KATE", "other").await.unwrap(),
        Claim::Forbidden
    );
    assert!(db.store.verify_token("kAtE", "secret-1").await.unwrap());
    assert!(!db.store.verify_token("kate", "secret-2").await.unwrap());
    assert!(!db.store.verify_token("ghost", "secret-1").await.unwrap());
    assert!(
        db.store.create_profile("x", "t").await.is_err(),
        "too short"
    );
    assert!(db.store.create_profile("bad name", "t").await.is_err());
    let hash: Vec<u8> = sqlx::query_scalar("SELECT token_sha256 FROM profiles")
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert_eq!(hash.len(), 32);
    assert!(!hash.windows(8).any(|w| w == b"secret-1"));
    assert_eq!(db.count("profiles").await, 1);
    db.teardown().await;
}

#[tokio::test]
async fn gv_ledger_is_append_only() {
    let Some(db) = setup().await else { return };
    db.profile("lena").await;
    db.bank("lena", 10).await;
    assert!(sqlx::query("UPDATE gv_ledger SET delta = 999")
        .execute(db.store.pool())
        .await
        .is_err());
    assert!(sqlx::query("DELETE FROM gv_ledger")
        .execute(db.store.pool())
        .await
        .is_err());
    assert_eq!(db.store.leaderboard("2000-01", 5).await.unwrap().len(), 0);
    db.teardown().await;
}
