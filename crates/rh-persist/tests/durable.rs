//! Durable-data lock-in: profile identity is the surrogate id, the match record is complete and versioned, and the profile
//! blobs survive a read-modify-write by a binary that does not know all of their fields.

mod common;

use std::time::Duration;

use common::{run, setup};
use rh_persist::admin::reconcile;
use rh_persist::{EquipOutcome, GvBreakdown, MatchMeta, MatchResult, Outcome, RecordOutcome};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

const TTL: Duration = Duration::from_secs(60);

async fn sql_json(db: &common::TestDb, q: &str, name: &str) -> Value {
    sqlx::query_scalar(q)
        .bind(name)
        .fetch_one(db.store.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_rename_changes_one_row_and_every_link_follows_the_profile_id() {
    let Some(db) = setup().await else { return };
    let token = db.profile("Oldname").await;
    let first = db.bank("Oldname", 30).await;
    let id = db.store.profile_id("oldname").await.unwrap().unwrap();
    // A live lease and a purchase too: all keyed by the id.
    let m2 = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("Oldname", m2, "srv", TTL)
        .await
        .unwrap();
    assert_eq!(lease.profile_id, id);
    db.store
        .purchase("Oldname", &token, Uuid::new_v4(), "skin", 10)
        .await
        .unwrap();

    // Moderation renames the profile: ONE row changes (the append-only ledger is not touched).
    let n = sqlx::query("UPDATE profiles SET callsign = 'Newname' WHERE profile_id = $1")
        .bind(id)
        .execute(db.store.pool())
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 1);
    assert!(db.store.get_profile("Oldname").await.unwrap().is_none());
    let p = db.store.get_profile("newname").await.unwrap().unwrap();
    assert_eq!((p.callsign.as_str(), p.gv), ("Newname", 20));
    assert_eq!(db.store.profile_id("NEWNAME").await.unwrap(), Some(id));
    assert_eq!(db.ledger_sum("Newname").await, 20);
    assert_eq!(db.store.leaderboard("2000-01", 10).await.unwrap(), vec![]);
    // The old name is free again, but a case-variant of a live name is not.
    assert!(
        sqlx::query("UPDATE profiles SET callsign = 'NEWNAME' WHERE profile_id = $1")
            .bind(id)
            .execute(db.store.pool())
            .await
            .is_ok()
    );
    db.profile("Someone").await;
    assert!(
        sqlx::query("UPDATE profiles SET callsign = 'someone' WHERE profile_id = $1")
            .bind(id)
            .execute(db.store.pool())
            .await
            .is_err(),
        "callsigns stay case-insensitively unique"
    );

    // The lease taken under the old name is still this profile's: the live match banks with the id its admission got
    // (it does not know the new name), and the earlier result is still applied.
    assert!(db
        .store
        .renew_lease_by_id(lease.profile_id, lease.fence, TTL)
        .await
        .unwrap());
    let out = db
        .store
        .record_result_by_id(
            m2,
            lease.profile_id,
            lease.fence,
            &run(5),
            &MatchMeta::unknown(),
        )
        .await
        .unwrap();
    assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
    let again = db
        .store
        .record_result(first, "newname", 1, &run(30), &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(again, RecordOutcome::AlreadyApplied);
    assert_eq!(db.ledger_sum("newname").await, 25);
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn the_match_record_is_complete_versioned_and_shared_by_the_players_of_a_match() {
    let Some(db) = setup().await else { return };
    db.profile("ann").await;
    db.profile("bob").await;
    let m = Uuid::new_v4();
    let meta = MatchMeta {
        owner: "host-7".into(),
        region: Some("eu-west-1".into()),
        placement_id: Some("placement-1".into()),
        build: "abc123".into(),
        content_hash: 0xFEDC_BA98_7654_3210,
        humans: 2,
        bots: 6,
    };
    let result = MatchResult {
        outcome: Some(Outcome::Died),
        kills: 3,
        gv: GvBreakdown {
            kills: 12,
            bounty: 4,
            total: 16,
            ..Default::default()
        },
        faction: Some("fire".into()),
        weapon: Some("axe".into()),
        win_qualified: false,
        duration_sec: 421,
        killed_by: Some("bob".into()),
        killed_by_bot: false,
        place: 2,
        players: 8,
        win_bonus_withheld: true,
        win_bonus_why: Some("starters".into()),
    };
    for (name, r) in [("ann", &result), ("bob", &run(40))] {
        let l = db
            .store
            .acquire_lease(name, m, "host-7", TTL)
            .await
            .unwrap();
        let out = db
            .store
            .record_result(m, name, l.fence, r, &meta)
            .await
            .unwrap();
        assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
    }
    // One matches row for both players, with the host's facts.
    assert_eq!(db.count("matches").await, 1);
    assert_eq!(db.count("match_results").await, 2);
    let row = sqlx::query(
        "SELECT owner, region, placement_id, build, content_hash, humans, bots, replay_ref FROM matches WHERE match_id = $1",
    )
    .bind(m)
    .fetch_one(db.store.pool())
    .await
    .unwrap();
    let owner: String = row.get("owner");
    let region: Option<String> = row.get("region");
    let placement: Option<String> = row.get("placement_id");
    let build: String = row.get("build");
    let hash: i64 = row.get("content_hash");
    let (humans, bots): (i32, i32) = (row.get("humans"), row.get("bots"));
    let replay: Option<String> = row.get("replay_ref");
    assert_eq!(
        (owner.as_str(), region.as_deref()),
        ("host-7", Some("eu-west-1"))
    );
    assert_eq!(placement.as_deref(), Some("placement-1"));
    assert_eq!(
        (build.as_str(), humans, bots, replay),
        ("abc123", 2, 6, None)
    );
    assert_eq!(hash as u64, 0xFEDC_BA98_7654_3210);

    // The stored document: versioned, camelCase, every RunResult field plus faction and weapon.
    let doc = sql_json(
        &db,
        "SELECT r.result FROM match_results r JOIN profiles p USING (profile_id) WHERE p.callsign = $1",
        "ann",
    )
    .await;
    assert_eq!(
        doc,
        json!({
            "v": 1,
            "outcome": "died",
            "kills": 3,
            "gv": {"kills": 12, "mobs": 0, "bounty": 4, "quest": 0, "win": 0, "total": 16},
            "faction": "fire",
            "weapon": "axe",
            "winQualified": false,
            "durationSec": 421,
            "killedBy": "bob",
            "killedByBot": false,
            "place": 2,
            "players": 8,
            "winBonusWithheld": true,
            "winBonusWhy": "starters",
        })
    );

    // A retry of either result changes nothing, and does not touch the match row.
    let l = db.store.profile_id("ann").await.unwrap().unwrap();
    assert!(l > 0);
    let retry = db
        .store
        .record_result(m, "ann", 1, &result, &MatchMeta::unknown())
        .await
        .unwrap();
    assert_eq!(retry, RecordOutcome::AlreadyApplied);
    let build_after: String = sqlx::query_scalar("SELECT build FROM matches WHERE match_id = $1")
        .bind(m)
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    assert_eq!(build_after, "abc123");
    db.teardown().await;
}

#[tokio::test]
async fn unknown_blob_keys_survive_a_write_back_and_missing_fields_decode() {
    let Some(db) = setup().await else { return };
    let token = db.profile("zed").await;
    // A newer binary added keys the older one does not know, and left out nothing this one needs.
    sqlx::query(
        "UPDATE profiles SET
           stats = '{\"runs\":2,\"wins\":1,\"draws\":0,\"deaths\":1,\"kills\":5,\"seasonXp\":900,\"streak\":{\"best\":3}}',
           progress = '{\"qualifiedWins\":1,\"bountyRuns\":0,\"bestRunKills\":4,\"winsByFaction\":{},\"winsByWeapon\":{},\"cards\":[\"a\",\"b\"]}',
           cosmetics = '{\"owned\":[\"skin\"],\"equipped\":{},\"loadouts\":{\"1\":\"x\"}}',
           gv = 100
         WHERE callsign = 'zed'",
    )
    .execute(db.store.pool())
    .await
    .unwrap();
    // The ledger rule: keep sum(ledger) == gv for the profile used here.
    sqlx::query("INSERT INTO gv_ledger (profile_id, delta, reason) SELECT profile_id, 100, 'test' FROM profiles WHERE callsign = 'zed'")
        .execute(db.store.pool())
        .await
        .unwrap();

    db.bank("zed", 7).await; // record_result writes stats and progress back
    db.store
        .purchase("zed", &token, Uuid::new_v4(), "skin2", 10)
        .await
        .unwrap(); // purchase writes cosmetics back
    assert_eq!(
        db.store
            .equip("zed", &token, "head", Some("skin2"))
            .await
            .unwrap(),
        EquipOutcome::Ok
    );

    let q = |col: &str| format!("SELECT {col} FROM profiles WHERE callsign = $1");
    let stats = sql_json(&db, &q("stats"), "zed").await;
    assert_eq!(stats["seasonXp"], 900);
    assert_eq!(stats["streak"], json!({"best": 3}));
    assert_eq!(stats["runs"], 3, "typed fields still update");
    let progress = sql_json(&db, &q("progress"), "zed").await;
    assert_eq!(progress["cards"], json!(["a", "b"]));
    let cosmetics = sql_json(&db, &q("cosmetics"), "zed").await;
    assert_eq!(cosmetics["loadouts"], json!({"1": "x"}));
    assert_eq!(cosmetics["equipped"], json!({"head": "skin2"}));

    // A row that lacks fields this binary has (an older writer's row) decodes with defaults.
    sqlx::query(
        "UPDATE profiles SET stats = '{\"runs\":4}', progress = '{}', cosmetics = '{}' WHERE callsign = 'zed'",
    )
    .execute(db.store.pool())
    .await
    .unwrap();
    let p = db.store.get_profile("zed").await.unwrap().unwrap();
    assert_eq!((p.stats.runs, p.stats.wins), (4, 0));
    assert_eq!(p.progress.best_run_kills, 0);
    assert!(p.cosmetics.owned.is_empty());
    db.bank("zed", 1).await; // and banking on it works
    db.teardown().await;
}

/// The swap: two players hold leases in one match (both fence 1) and moderation renames them so one takes the other's old
/// name. By-id calls still credit and release the right profiles; the callsign path would have crossed them.
#[tokio::test]
async fn a_rename_swap_mid_match_credits_and_releases_the_right_profiles() {
    let Some(db) = setup().await else { return };
    db.profile("alice").await;
    db.profile("bob").await;
    let m = Uuid::new_v4();
    let la = db
        .store
        .acquire_lease("alice", m, "srv", TTL)
        .await
        .unwrap();
    let lb = db.store.acquire_lease("bob", m, "srv", TTL).await.unwrap();
    assert_eq!((la.fence, lb.fence), (1, 1));
    for (id, name) in [
        (la.profile_id, "tmp"),
        (lb.profile_id, "alice"),
        (la.profile_id, "alice2"),
    ] {
        sqlx::query("UPDATE profiles SET callsign = $2 WHERE profile_id = $1")
            .bind(id)
            .bind(name)
            .execute(db.store.pool())
            .await
            .unwrap();
    }
    // "alice" now names bob's profile. Banking alice's run by id must credit alice's profile (now "alice2").
    let out = db
        .store
        .record_result_by_id(m, la.profile_id, la.fence, &run(40), &MatchMeta::unknown())
        .await
        .unwrap();
    assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
    assert_eq!(db.ledger_sum("alice2").await, 40);
    assert_eq!(
        db.ledger_sum("alice").await,
        0,
        "bob's profile is untouched"
    );
    // Bob's own result lands on bob's profile, and his lease is renewed by id.
    assert!(db
        .store
        .renew_lease_by_id(lb.profile_id, lb.fence, TTL)
        .await
        .unwrap());
    let out = db
        .store
        .record_result_by_id(m, lb.profile_id, lb.fence, &run(7), &MatchMeta::unknown())
        .await
        .unwrap();
    assert!(matches!(out, RecordOutcome::Applied { .. }), "{out:?}");
    assert_eq!(db.ledger_sum("alice").await, 7);
    // A lease released by id frees the slot: a new admission for the profile gets the next fence at once.
    let m2 = Uuid::new_v4();
    let l2 = db
        .store
        .acquire_lease("alice2", m2, "srv", TTL)
        .await
        .unwrap();
    assert_eq!(l2.fence, 2);
    assert!(db
        .store
        .release_lease_by_id(l2.profile_id, l2.fence)
        .await
        .unwrap());
    assert!(!db
        .store
        .release_lease_by_id(l2.profile_id, l2.fence)
        .await
        .unwrap());
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

/// `matches.ended_at` follows the latest result of the match, not the first.
#[tokio::test]
async fn the_match_end_time_advances_with_each_result() {
    let Some(db) = setup().await else { return };
    db.profile("ann").await;
    db.profile("bob").await;
    let m = Uuid::new_v4();
    let mut seen = Vec::new();
    for name in ["ann", "bob"] {
        let l = db.store.acquire_lease(name, m, "srv", TTL).await.unwrap();
        db.store
            .record_result_by_id(m, l.profile_id, l.fence, &run(1), &MatchMeta::unknown())
            .await
            .unwrap();
        let t: f64 = sqlx::query_scalar(
            "SELECT extract(epoch FROM ended_at)::float8 FROM matches WHERE match_id = $1",
        )
        .bind(m)
        .fetch_one(db.store.pool())
        .await
        .unwrap();
        seen.push(t);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(
        seen[1] > seen[0],
        "ended_at must move to the later result: {seen:?}"
    );
    db.teardown().await;
}
