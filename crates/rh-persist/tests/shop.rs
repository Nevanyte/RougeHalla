mod common;

use std::sync::Arc;

use common::setup;
use rh_persist::admin::reconcile;
use rh_persist::{EquipOutcome, PurchaseOutcome};
use uuid::Uuid;

#[tokio::test]
async fn concurrent_purchases_cannot_overspend() {
    let Some(db) = setup().await else { return };
    let token = db.profile("mona").await;
    db.bank("mona", 100).await;
    let before = db.store.get_profile("mona").await.unwrap().unwrap();

    let barrier = Arc::new(tokio::sync::Barrier::new(20));
    let mut tasks = Vec::new();
    for i in 0..20 {
        let (s, t, b) = (db.store.clone(), token.clone(), barrier.clone());
        tasks.push(tokio::spawn(async move {
            b.wait().await;
            s.purchase("mona", &t, Uuid::new_v4(), &format!("item-{i}"), 70)
                .await
                .unwrap()
        }));
    }
    let mut ok = 0;
    for t in tasks {
        match t.await.unwrap() {
            PurchaseOutcome::Ok { gv_left } => {
                assert_eq!(gv_left, 30);
                ok += 1;
            }
            PurchaseOutcome::Insufficient { need: 70, .. } => {}
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(ok, 1, "two 70-GV purchases cannot both fit in 100");
    let p = db.store.get_profile("mona").await.unwrap().unwrap();
    assert_eq!(p.gv, 30);
    assert_eq!(p.cosmetics.owned.len(), 1);
    // Legacy rule: spending touches the balance only.
    assert_eq!(p.gv_lifetime, before.gv_lifetime);
    assert_eq!(p.gv_by_month, before.gv_by_month);
    assert_eq!(db.ledger_sum("mona").await, 30);
    assert_eq!(db.count("purchases").await, 1);
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn purchase_is_idempotent_by_id_and_checks_the_token() {
    let Some(db) = setup().await else { return };
    let token = db.profile("nora").await;
    db.bank("nora", 100).await;
    let id = Uuid::new_v4();
    assert_eq!(
        db.store
            .purchase("nora", &token, id, "skin-ember", 40)
            .await
            .unwrap(),
        PurchaseOutcome::Ok { gv_left: 60 }
    );
    // The client retried (the response was lost): one debit only.
    assert_eq!(
        db.store
            .purchase("nora", &token, id, "skin-ember", 40)
            .await
            .unwrap(),
        PurchaseOutcome::AlreadyApplied
    );
    assert_eq!(db.store.get_profile("nora").await.unwrap().unwrap().gv, 60);
    // A new purchase id for an item already owned is refused, no charge.
    assert_eq!(
        db.store
            .purchase("nora", &token, Uuid::new_v4(), "skin-ember", 40)
            .await
            .unwrap(),
        PurchaseOutcome::AlreadyOwned
    );
    // Reusing an id for something else is an error, not a silent no-op.
    assert!(db
        .store
        .purchase("nora", &token, id, "trail-glow", 1)
        .await
        .is_err());
    assert_eq!(
        db.store
            .purchase("nora", "wrong", Uuid::new_v4(), "trail-glow", 1)
            .await
            .unwrap(),
        PurchaseOutcome::BadToken
    );
    assert_eq!(
        db.store
            .purchase("ghost", &token, Uuid::new_v4(), "trail-glow", 1)
            .await
            .unwrap(),
        PurchaseOutcome::BadToken
    );
    assert_eq!(
        db.store
            .purchase("nora", &token, Uuid::new_v4(), "title-big", 61)
            .await
            .unwrap(),
        PurchaseOutcome::Insufficient { need: 61, have: 60 }
    );
    assert!(db
        .store
        .purchase("nora", &token, Uuid::new_v4(), "x", -5)
        .await
        .is_err());
    let p = db.store.get_profile("nora").await.unwrap().unwrap();
    assert_eq!((p.gv, p.cosmetics.owned.len()), (60, 1));

    // Equip.
    assert_eq!(
        db.store
            .equip("nora", &token, "skin", Some("skin-ember"))
            .await
            .unwrap(),
        EquipOutcome::Ok
    );
    assert_eq!(
        db.store
            .equip("nora", &token, "trail", Some("trail-glow"))
            .await
            .unwrap(),
        EquipOutcome::NotOwned
    );
    assert_eq!(
        db.store.equip("nora", "wrong", "skin", None).await.unwrap(),
        EquipOutcome::BadToken
    );
    let p = db.store.get_profile("nora").await.unwrap().unwrap();
    assert_eq!(
        p.cosmetics.equipped.get("skin").map(String::as_str),
        Some("skin-ember")
    );
    assert_eq!(
        db.store.equip("nora", &token, "skin", None).await.unwrap(),
        EquipOutcome::Ok
    );
    assert!(db
        .store
        .get_profile("nora")
        .await
        .unwrap()
        .unwrap()
        .cosmetics
        .equipped
        .is_empty());
    assert!(reconcile(&db.store).await.unwrap().ok());
    db.teardown().await;
}

#[tokio::test]
async fn the_same_purchase_id_sent_concurrently_charges_once() {
    let Some(db) = setup().await else { return };
    let token = db.profile("omar").await;
    db.bank("omar", 100).await;
    let id = Uuid::new_v4();
    let mut tasks = Vec::new();
    for _ in 0..10 {
        let (s, t) = (db.store.clone(), token.clone());
        tasks.push(tokio::spawn(async move {
            s.purchase("omar", &t, id, "skin-ember", 40).await.unwrap()
        }));
    }
    let mut oks = 0;
    for t in tasks {
        match t.await.unwrap() {
            PurchaseOutcome::Ok { .. } => oks += 1,
            PurchaseOutcome::AlreadyApplied => {}
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(oks, 1);
    assert_eq!(db.store.get_profile("omar").await.unwrap().unwrap().gv, 60);
    db.teardown().await;
}
