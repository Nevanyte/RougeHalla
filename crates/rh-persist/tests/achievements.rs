mod common;

use common::setup;
use rh_persist::achievements::{evaluate, ACHIEVEMENTS};
use rh_persist::{GvBreakdown, MatchMeta, MatchResult, Outcome, Progress, RecordOutcome, Stats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Duration;
use uuid::Uuid;

#[derive(Deserialize)]
struct Snapshot {
    stats: Stats,
    progress: Progress,
    #[serde(rename = "gvLifetime")]
    gv_lifetime: i64,
}

#[derive(Deserialize)]
struct Case {
    label: String,
    snapshot: Snapshot,
    unlocked: BTreeMap<String, i64>,
    expected: Vec<String>,
}

#[derive(Deserialize)]
struct Fixture {
    format: String,
    catalog: Value,
    cases: Vec<Case>,
}

#[test]
fn legacy_catalog_and_threshold_observations_match() {
    let fixture: Fixture =
        serde_json::from_str(include_str!("fixtures/achievements.json")).unwrap();
    assert_eq!(fixture.format, "rh-achievement-parity/1");
    assert_eq!(serde_json::to_value(ACHIEVEMENTS).unwrap(), fixture.catalog);
    assert!(fixture.cases.len() >= 30);
    for case in fixture.cases {
        let actual: Vec<_> = evaluate(
            &case.snapshot.stats,
            &case.snapshot.progress,
            case.snapshot.gv_lifetime,
            &case.unlocked,
        )
        .iter()
        .map(|a| a.id)
        .collect();
        assert_eq!(actual, case.expected, "{}", case.label);
    }
}

fn qualifying_run() -> MatchResult {
    MatchResult {
        outcome: Some(Outcome::Won),
        kills: 5,
        gv: GvBreakdown {
            bounty: 10,
            total: 1000,
            ..Default::default()
        },
        faction: Some("fire".into()),
        weapon: Some("sword".into()),
        win_qualified: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn rewards_and_timestamps_commit_once_with_the_result() {
    let Some(db) = setup().await else { return };
    db.profile("achiever").await;
    // Unknown rolling-deploy data and already owned rewards must survive the grant.
    sqlx::query(
        "UPDATE profiles SET cosmetics = $1, achievements = $2 WHERE callsign = 'achiever'",
    )
    .bind(sqlx::types::Json(
        json!({"owned": ["title-bloodied"], "equipped": {}, "futureCosmeticField": 17}),
    ))
    .bind(sqlx::types::Json(json!({"unknown_future_id": 42})))
    .execute(db.store.pool())
    .await
    .unwrap();
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("achiever", m, "srv", Duration::from_secs(60))
        .await
        .unwrap();
    let result = qualifying_run();
    let other = db.other_server().await;
    let meta = MatchMeta::unknown();
    let (first, second) = tokio::join!(
        db.store
            .record_result(m, "achiever", lease.fence, &result, &meta),
        other.record_result(m, "achiever", lease.fence, &result, &meta),
    );
    let outcomes = [first.unwrap(), second.unwrap()];
    let expected = [
        "first_blood",
        "rampage",
        "bounty_hunter",
        "first_win",
        "glorious",
        "win_fire",
    ];
    assert!(outcomes.contains(&RecordOutcome::AlreadyApplied));
    assert!(outcomes.contains(&RecordOutcome::Applied {
        gv_credited: 1000,
        unlocked: expected.iter().map(|id| (*id).to_owned()).collect(),
    }));
    let profile = db.store.get_profile("achiever").await.unwrap().unwrap();
    assert_eq!(profile.stats.runs, 1);
    assert_eq!(profile.gv, 1000);
    assert_eq!(profile.progress.wins_by_faction.get("fire"), Some(&1));
    assert_eq!(profile.progress.wins_by_weapon.get("sword"), Some(&1));
    assert_eq!(profile.achievements.len(), expected.len() + 1);
    let timestamp = profile.achievements["first_blood"];
    assert!(timestamp > 0);
    assert!(expected
        .iter()
        .all(|id| profile.achievements[*id] == timestamp));
    assert_eq!(profile.achievements["unknown_future_id"], 42);
    assert_eq!(profile.cosmetics.rest["futureCosmeticField"], 17);
    for reward in [
        "title-bloodied",
        "title-rampage",
        "trail-comet",
        "title-bounty-hunter",
        "outline-bounty",
        "title-victor",
        "skin-laurel",
        "title-glorious",
        "title-pyre-lord",
    ] {
        assert_eq!(
            profile
                .cosmetics
                .owned
                .iter()
                .filter(|id| id.as_str() == reward)
                .count(),
            1,
            "{reward}"
        );
    }
    assert_eq!(db.ledger_sum("achiever").await, 1000);
    db.teardown().await;
}

#[tokio::test]
async fn voided_payout_grants_lifetime_only_and_zero_payout_is_a_noop() {
    let Some(db) = setup().await else { return };
    db.profile("voided").await;
    for (amount, expected) in [
        (0, Vec::<String>::new()),
        (1000, vec!["glorious".to_owned()]),
    ] {
        let m = Uuid::new_v4();
        let lease = db
            .store
            .acquire_lease("voided", m, "srv", Duration::from_secs(60))
            .await
            .unwrap();
        let mut result = qualifying_run();
        result.outcome = None;
        result.gv.total = amount;
        assert_eq!(
            db.store
                .record_result(m, "voided", lease.fence, &result, &MatchMeta::unknown())
                .await
                .unwrap(),
            RecordOutcome::Applied {
                gv_credited: amount,
                unlocked: expected
            },
        );
    }
    let profile = db.store.get_profile("voided").await.unwrap().unwrap();
    assert_eq!(profile.stats, Stats::default());
    assert_eq!(profile.progress, Progress::default());
    assert_eq!(profile.achievements.len(), 1);
    assert!(profile
        .cosmetics
        .owned
        .iter()
        .any(|id| id == "title-glorious"));
    db.teardown().await;
}

#[tokio::test]
async fn zero_void_payout_does_not_evaluate_preexisting_eligible_goals() {
    let Some(db) = setup().await else { return };
    db.profile("oldprofile").await;
    // For example, an imported profile may meet a goal without its unlock recorded.
    sqlx::query("UPDATE profiles SET stats = $1 WHERE callsign = 'oldprofile'")
        .bind(sqlx::types::Json(json!({"runs": 25})))
        .execute(db.store.pool())
        .await
        .unwrap();
    let m = Uuid::new_v4();
    let lease = db
        .store
        .acquire_lease("oldprofile", m, "srv", Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(
        db.store
            .record_result(
                m,
                "oldprofile",
                lease.fence,
                &MatchResult::default(),
                &MatchMeta::unknown()
            )
            .await
            .unwrap(),
        RecordOutcome::Applied {
            gv_credited: 0,
            unlocked: vec![]
        },
    );
    let profile = db.store.get_profile("oldprofile").await.unwrap().unwrap();
    assert_eq!(profile.stats.runs, 25);
    assert!(profile.achievements.is_empty());
    assert!(!profile
        .cosmetics
        .owned
        .iter()
        .any(|id| id == "title-veteran"));
    db.teardown().await;
}
