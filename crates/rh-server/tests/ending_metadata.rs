//! The legacy adapter oracle goes through the real mapper and atomic PostgreSQL writer.
#[path = "../../../parity/persistence/cases.rs"]
mod cases;
use rh_sim::{FactionId, Outcome, RunResult, WeaponId};

fn result(c: &cases::Case) -> RunResult {
    let r = c.result.as_ref().unwrap();
    let record = c.record.as_ref();
    RunResult {
        outcome: match r.outcome.as_str() {
            "won" => Outcome::Won,
            "died" => Outcome::Died,
            "mia" => Outcome::Mia,
            "draw" => Outcome::Draw,
            _ => panic!("unknown outcome"),
        },
        profile: r.profile.clone(),
        faction: record
            .and_then(|r| r.faction.as_deref())
            .map(|f| FactionId::parse(f).unwrap()),
        weapon: record
            .and_then(|r| r.weapon.as_deref())
            .map(|w| WeaponId::parse(w).unwrap()),
        duration_sec: r.duration_sec,
        kills: r.kills,
        killed_by: r.killed_by.clone(),
        killed_by_bot: r.killed_by_bot,
        place: r.place,
        players: r.players,
        gv: rh_sim::results::GvBreakdown {
            kills: r.gv.kills,
            mobs: r.gv.mobs,
            bounty: r.gv.bounty,
            quest: r.gv.quest,
            win: r.gv.win,
            total: r.gv.total,
        },
        win_bonus_withheld: r.win_bonus_withheld,
        win_bonus_why: r.win_bonus_why.as_deref().map(|w| match w {
            "starters" => rh_sim::results::WinBonusWhy::Starters,
            "opponents" => rh_sim::results::WinBonusWhy::Opponents,
            _ => panic!("unknown withholding"),
        }),
    }
}

#[test]
fn metadata_has_no_effect_on_current_protocol_result_bytes() {
    use rh_protocol::{ServerMsg, WireEvent};
    assert_eq!(rh_protocol::PROTOCOL_VERSION, 13);
    for c in cases::capture().cases.iter().filter(|c| c.result.is_some()) {
        let mut r = result(c);
        let encode = |r: &RunResult| {
            ServerMsg::Events {
                tick: 3,
                events: vec![WireEvent::Result(rh_server::wire::result(r))],
            }
            .encode()
        };
        r.faction = None;
        r.weapon = None;
        let original = encode(&r);
        for faction in FactionId::ALL {
            for weapon in WeaponId::ALL {
                r.faction = Some(faction);
                r.weapon = Some(weapon);
                assert_eq!(original, encode(&r), "{}", c.input.name);
            }
        }
    }
}

#[cfg(feature = "postgres")]
mod pg {
    use super::*;
    use rh_persist::{MatchMeta, MatchResult, RecordOutcome, Store};
    use rh_server::persist::{Persistence, RecordError, Recorded};
    use std::{sync::Arc, time::Duration};
    use uuid::Uuid;
    struct Db {
        admin: Store,
        store: Arc<Store>,
        name: String,
    }
    impl Db {
        async fn new() -> Option<Self> {
            let Ok(url) = std::env::var("DATABASE_URL") else {
                if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
                    return None;
                }
                panic!("DATABASE_URL required for ending metadata proof");
            };
            let admin = Store::connect(&url).await.unwrap();
            let name = format!("rh_ending_{}", Uuid::new_v4().simple());
            sqlx::query(&format!("CREATE DATABASE {name}"))
                .execute(admin.pool())
                .await
                .unwrap();
            let store = Arc::new(
                Store::connect(&format!("{}/{name}", url.rsplit_once('/').unwrap().0))
                    .await
                    .unwrap(),
            );
            store.migrate().await.unwrap();
            Some(Self { admin, store, name })
        }
        async fn close(self) {
            self.store.pool().close().await;
            sqlx::query(&format!("DROP DATABASE {} WITH (FORCE)", self.name))
                .execute(self.admin.pool())
                .await
                .unwrap();
        }
    }
    const TTL: Duration = Duration::from_secs(60);
    #[tokio::test]
    async fn actual_legacy_metadata_and_progress_commit_once_with_the_result() {
        let Some(db) = Db::new().await else {
            return;
        };
        let persist = Persistence::postgres(db.store.clone(), "ending-proof".into());
        for (i, c) in cases::capture().cases.iter().enumerate() {
            let name = format!("Profile{i}");
            db.store
                .create_profile(&name, "synthetic-token")
                .await
                .unwrap();
            let mid = Uuid::new_v4();
            let held = db
                .store
                .acquire_lease(&name, mid, "ending-proof", TTL)
                .await
                .unwrap();
            if c.input.finish == "void" {
                // Store capability only; this slice does not add a live shutdown/abandon path.
                if c.banks.is_empty() {
                    assert_eq!(c.input.earned, 0);
                    db.store
                        .release_match_lease_by_id(held.profile_id, mid, held.fence)
                        .await
                        .unwrap();
                } else {
                    assert_eq!(c.banks, [c.input.earned]);
                    let r = MatchResult {
                        gv: rh_persist::GvBreakdown {
                            total: i64::from(c.banks[0]),
                            ..Default::default()
                        },
                        ..Default::default()
                    };
                    db.store
                        .record_result_by_id(
                            mid,
                            held.profile_id,
                            held.fence,
                            &r,
                            &MatchMeta::unknown(),
                        )
                        .await
                        .unwrap();
                }
            } else if c.record.is_some() {
                let mut r = result(c);
                r.profile = name.clone();
                let mapped = rh_server::persist::pg::to_persist(&r);
                let raw = c.record.as_ref().unwrap();
                assert!(c.banks.is_empty());
                assert_eq!(serde_json::to_value(mapped.outcome).unwrap(), raw.outcome);
                assert_eq!(mapped.kills, i64::from(raw.kills));
                assert_eq!(mapped.gv.total, i64::from(raw.gv));
                assert_eq!(mapped.gv.bounty, i64::from(raw.bounty));
                assert_eq!(mapped.faction, raw.faction);
                assert_eq!(mapped.weapon, raw.weapon);
                assert_eq!(mapped.win_qualified, raw.win_qualified);
                let (a, b) = tokio::join!(
                    persist.record_by_id(
                        *mid.as_bytes(),
                        held.profile_id,
                        held.fence,
                        &r,
                        Default::default()
                    ),
                    persist.record_by_id(
                        *mid.as_bytes(),
                        held.profile_id,
                        held.fence,
                        &r,
                        Default::default()
                    )
                );
                assert!(
                    (a == Ok(Recorded::Applied) && b == Ok(Recorded::AlreadyApplied))
                        || (b == Ok(Recorded::Applied) && a == Ok(Recorded::AlreadyApplied))
                );
                let stored: serde_json::Value =
                    sqlx::query_scalar("SELECT result FROM match_results WHERE profile_id=$1")
                        .bind(held.profile_id)
                        .fetch_one(db.store.pool())
                        .await
                        .unwrap();
                assert_eq!(stored["v"], 1);
                assert_eq!(
                    stored["faction"],
                    serde_json::to_value(&raw.faction).unwrap()
                );
                assert_eq!(stored["weapon"], serde_json::to_value(&raw.weapon).unwrap());
            } else {
                // Bot/training are rejected by the legacy adapter before any Store call; their zero
                // captures are retained explicitly, not reinterpreted as a bankable Rust result.
                assert!(c.input.bot || c.input.training);
                assert!(c.banks.is_empty());
                db.store
                    .release_match_lease_by_id(held.profile_id, mid, held.fence)
                    .await
                    .unwrap();
            }
            let (stats, progress, gv): (serde_json::Value, serde_json::Value, i64) =
                sqlx::query_as("SELECT stats,progress,gv FROM profiles WHERE profile_id=$1")
                    .bind(held.profile_id)
                    .fetch_one(db.store.pool())
                    .await
                    .unwrap();
            assert_eq!(stats, c.stats, "{}", c.input.name);
            assert_eq!(progress, c.progress, "{}", c.input.name);
            assert_eq!(gv, i64::from(c.gv), "{}", c.input.name);
        }
        drop(persist);
        db.close().await;
    }

    #[tokio::test]
    async fn metadata_obeys_captured_identity_fences_and_transaction_rollback() {
        let Some(db) = Db::new().await else {
            return;
        };
        let persist = Persistence::postgres(db.store.clone(), "ending-proof".into());
        db.store
            .create_profile("Subject", "synthetic-token")
            .await
            .unwrap();
        let mid = Uuid::new_v4();
        let held = db
            .store
            .acquire_lease("Subject", mid, "ending-proof", TTL)
            .await
            .unwrap();
        let r = result(&cases::capture().cases[0]);
        let mapped = rh_server::persist::pg::to_persist(&r);
        assert!(db
            .store
            .record_result_crash_before_commit(
                mid,
                "Subject",
                held.fence,
                &mapped,
                &MatchMeta::unknown()
            )
            .await
            .is_err());
        let before: (i64, serde_json::Value, i64) = sqlx::query_as("SELECT gv,progress,(SELECT count(*) FROM match_results) FROM profiles WHERE profile_id=$1").bind(held.profile_id).fetch_one(db.store.pool()).await.unwrap();
        assert_eq!(before.0, 0);
        assert_eq!(before.1["qualifiedWins"], 0);
        assert_eq!(before.2, 0);
        sqlx::query("UPDATE profiles SET callsign='Renamed' WHERE profile_id=$1")
            .bind(held.profile_id)
            .execute(db.store.pool())
            .await
            .unwrap();
        db.store
            .create_profile("Subject", "replacement-token")
            .await
            .unwrap();
        let replacement = db.store.profile_id("Subject").await.unwrap().unwrap();
        assert_eq!(
            persist
                .record_by_id(
                    *mid.as_bytes(),
                    held.profile_id,
                    held.fence,
                    &r,
                    Default::default()
                )
                .await,
            Ok(Recorded::Applied)
        );
        assert_eq!(
            persist
                .record_by_id(
                    *mid.as_bytes(),
                    held.profile_id,
                    held.fence,
                    &r,
                    Default::default()
                )
                .await,
            Ok(Recorded::AlreadyApplied)
        );
        let progress: serde_json::Value =
            sqlx::query_scalar("SELECT progress FROM profiles WHERE profile_id=$1")
                .bind(held.profile_id)
                .fetch_one(db.store.pool())
                .await
                .unwrap();
        assert_eq!(progress["winsByFaction"]["frost"], 1);
        assert_eq!(progress["winsByWeapon"]["wand"], 1);
        let replacement_runs: i64 =
            sqlx::query_scalar("SELECT (stats->>'runs')::bigint FROM profiles WHERE profile_id=$1")
                .bind(replacement)
                .fetch_one(db.store.pool())
                .await
                .unwrap();
        assert_eq!(replacement_runs, 0);
        let old_mid = Uuid::new_v4();
        let old = db
            .store
            .acquire_lease("Renamed", old_mid, "old", TTL)
            .await
            .unwrap();
        db.store
            .release_match_lease_by_id(old.profile_id, old_mid, old.fence)
            .await
            .unwrap();
        let new_mid = Uuid::new_v4();
        let newer = db
            .store
            .acquire_lease("Renamed", new_mid, "new", TTL)
            .await
            .unwrap();
        assert!(newer.fence > old.fence);
        assert_eq!(
            persist
                .record_by_id(
                    *old_mid.as_bytes(),
                    old.profile_id,
                    old.fence,
                    &r,
                    Default::default()
                )
                .await,
            Err(RecordError::Refused("StaleFence".into()))
        );
        assert!(matches!(
            db.store
                .record_result_by_id(
                    new_mid,
                    newer.profile_id,
                    newer.fence,
                    &mapped,
                    &MatchMeta::unknown()
                )
                .await
                .unwrap(),
            RecordOutcome::Applied { .. }
        ));
        let progress: serde_json::Value =
            sqlx::query_scalar("SELECT progress FROM profiles WHERE profile_id=$1")
                .bind(held.profile_id)
                .fetch_one(db.store.pool())
                .await
                .unwrap();
        assert_eq!(progress["qualifiedWins"], 2);
        assert_eq!(progress["winsByWeapon"]["wand"], 2);
        // Existing v1 documents with missing optional metadata remain readable.
        let old: rh_persist::StoredResult =
            serde_json::from_value(serde_json::json!({"v":1,"outcome":"won"})).unwrap();
        assert_eq!(old.result.faction, None);
        assert_eq!(old.result.weapon, None);
        drop(persist);
        db.close().await;
    }
}
