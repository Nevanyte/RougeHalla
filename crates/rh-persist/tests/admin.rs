mod common;

use common::setup;
use rh_persist::admin::{export_legacy, import_legacy, reconcile};
use rh_persist::legacy::parse_file;
use rh_persist::PurchaseOutcome;
use uuid::Uuid;

const V2: &str = include_str!("fixtures/legacy_v2.json");
const V1: &str = include_str!("fixtures/legacy_v1.json");

#[tokio::test]
async fn dry_run_changes_nothing_then_real_import_then_idempotent_rerun() {
    let Some(db) = setup().await else { return };

    let dry = import_legacy(&db.store, V2, true).await.unwrap();
    assert!(dry.dry_run);
    assert_eq!((dry.parsed, dry.inserted, dry.inserted_gv), (3, 3, 125));
    assert_eq!(
        dry.dropped.len(),
        1,
        "the entry whose name differs from its key is dropped, as the legacy store does"
    );
    assert_eq!(dry.dropped[0].0, "broken");
    assert_eq!(db.count("profiles").await, 0);
    assert_eq!(db.count("gv_ledger").await, 0);

    let real = import_legacy(&db.store, V2, false).await.unwrap();
    assert_eq!(
        (real.inserted, real.identical, real.conflicts.len()),
        (3, 0, 0)
    );
    assert_eq!(db.count("profiles").await, 3);
    assert_eq!(
        db.count("gv_ledger").await,
        3,
        "one opening row per profile"
    );
    let ashen = db.store.get_profile("ashen").await.unwrap().unwrap();
    assert_eq!(ashen.callsign, "Ashen");
    assert_eq!((ashen.gv, ashen.gv_lifetime), (120, 300));
    assert_eq!(ashen.gv_by_month.get("2026-10"), Some(&200));
    assert_eq!(ashen.progress.wins_by_weapon.len(), 2);
    assert_eq!(
        ashen.achievements.get("first-blood"),
        Some(&1_760_000_000_000)
    );
    // Tokens were hashed, and the original token still verifies.
    assert!(db
        .store
        .verify_token("Ashen", "11111111-1111-4111-8111-111111111111")
        .await
        .unwrap());
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT token_sha256 FROM profiles WHERE callsign = 'Ashen'")
            .fetch_one(db.store.pool())
            .await
            .unwrap();
    assert_eq!(stored.len(), 32);
    let rep = reconcile(&db.store).await.unwrap();
    assert!(rep.ok());
    assert_eq!(
        (rep.profiles, rep.total_gv, rep.total_ledger),
        (3, 125, 125)
    );

    // Re-run: everything identical, nothing written.
    let again = import_legacy(&db.store, V2, false).await.unwrap();
    assert_eq!(
        (again.inserted, again.identical, again.conflicts.len()),
        (0, 3, 0)
    );
    assert_eq!(db.count("gv_ledger").await, 3);

    // A profile that has since changed in the database is reported as a conflict and left alone.
    let token = "11111111-1111-4111-8111-111111111111";
    assert!(matches!(
        db.store
            .purchase("Ashen", token, Uuid::new_v4(), "trail-new", 20)
            .await
            .unwrap(),
        PurchaseOutcome::Ok { gv_left: 100 }
    ));
    let third = import_legacy(&db.store, V2, false).await.unwrap();
    assert_eq!(
        (third.inserted, third.identical, third.conflicts.len()),
        (0, 2, 1)
    );
    assert_eq!(third.conflicts[0].0, "Ashen");
    assert_eq!(
        db.store.get_profile("Ashen").await.unwrap().unwrap().gv,
        100
    );
    db.teardown().await;
}

#[tokio::test]
async fn name_collisions_by_case_are_conflicts() {
    let Some(db) = setup().await else { return };
    db.profile("Zed").await;
    let file = r#"{"version":2,"profiles":{
      "zed":{"name":"zed","token":"t1","gv":1,"gvLifetime":1,"gvByMonth":{},"stats":{"runs":0,"wins":0,"draws":0,"deaths":0,"kills":0},"cosmetics":{"owned":[],"equipped":{}}},
      "fresh":{"name":"fresh","token":"t2","gv":2,"gvLifetime":2,"gvByMonth":{"2026-01":2},"stats":{"runs":0,"wins":0,"draws":0,"deaths":0,"kills":0},"cosmetics":{"owned":[],"equipped":{}}},
      "FRESH":{"name":"FRESH","token":"t3","gv":3,"gvLifetime":3,"gvByMonth":{},"stats":{"runs":0,"wins":0,"draws":0,"deaths":0,"kills":0},"cosmetics":{"owned":[],"equipped":{}}}}}"#;
    let r = import_legacy(&db.store, file, false).await.unwrap();
    assert_eq!(r.inserted, 1);
    assert_eq!(r.conflicts.len(), 2);
    assert!(parse_file("not json").is_err());
    assert!(parse_file(r#"{"version":3,"profiles":{}}"#).is_err());
    db.teardown().await;
}

#[tokio::test]
async fn v1_files_migrate_like_the_legacy_store() {
    let Some(db) = setup().await else { return };
    let r = import_legacy(&db.store, V1, false).await.unwrap();
    assert_eq!((r.file_version, r.inserted), (1, 1));
    let p = db.store.get_profile("oldtimer").await.unwrap().unwrap();
    assert_eq!(
        (
            p.stats.runs,
            p.stats.wins,
            p.stats.deaths,
            p.stats.kills,
            p.gv
        ),
        (9, 0, 5, 7, 0)
    );
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn reconcile_detects_a_tampered_balance() {
    let Some(db) = setup().await else { return };
    import_legacy(&db.store, V2, false).await.unwrap();
    db.bank("Ashen", 10).await;
    assert!(reconcile(&db.store).await.unwrap().ok());
    sqlx::query("UPDATE profiles SET gv = gv + 5 WHERE callsign = 'frost_mage'")
        .execute(db.store.pool())
        .await
        .unwrap();
    let rep = reconcile(&db.store).await.unwrap();
    assert!(!rep.ok());
    assert_eq!(rep.mismatches, vec![("frost_mage".to_owned(), 5, 0)]);
    db.teardown().await;
}

#[tokio::test]
async fn export_round_trips_the_legacy_shape_without_tokens() {
    let Some(db) = setup().await else { return };
    import_legacy(&db.store, V2, false).await.unwrap();
    let out = export_legacy(&db.store).await.unwrap();
    assert_eq!(out["version"], 2);
    let text = serde_json::to_string(&out).unwrap();
    assert!(
        !text.contains("11111111-1111"),
        "plain tokens are unrecoverable"
    );
    let back = parse_file(&text).unwrap();
    assert_eq!(back.profiles.len(), 3);
    let original = parse_file(V2).unwrap();
    for o in &original.profiles {
        let b = back
            .profiles
            .iter()
            .find(|b| b.profile.callsign == o.profile.callsign)
            .unwrap();
        let (mut want, mut got) = (o.profile.clone(), b.profile.clone());
        want.token_sha256 = [0; 32];
        got.token_sha256 = [0; 32];
        assert_eq!(want, got);
    }
    db.teardown().await;
}
