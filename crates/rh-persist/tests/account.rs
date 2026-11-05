//! Read paths added for the account HTTP service: ranking order and rank agree, months, the GV epoch, constant-time compare.
mod common;

use rh_persist::ct_eq;

#[tokio::test]
async fn leaderboard_rows_rank_months_and_epoch_agree() {
    let Some(db) = common::setup().await else {
        return;
    };
    for n in ["bb", "aa", "cc", "zz"] {
        db.profile(n).await;
    }
    let e0 = db.store.gv_epoch();
    db.bank("bb", 300).await;
    db.bank("aa", 300).await;
    db.bank("cc", 50).await;
    db.bank("zz", 0).await;
    assert!(db.store.gv_epoch() > e0, "credits bump the epoch");
    let e1 = db.store.gv_epoch();
    db.bank("zz", 0).await;
    assert_eq!(
        db.store.gv_epoch(),
        e1,
        "a result crediting nothing leaves it alone"
    );

    let month: String = sqlx::query_scalar("SELECT month FROM gv_by_month LIMIT 1")
        .fetch_one(db.store.pool())
        .await
        .unwrap();
    let rows = db.store.leaderboard_rows(&month, 10).await.unwrap();
    let names: Vec<_> = rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["aa", "bb", "cc"]);
    assert_eq!(
        db.store.leaderboard_rows(&month, 0).await.unwrap().len(),
        1,
        "limit clamps to 1"
    );
    assert!(db
        .store
        .leaderboard_rows("garbage", 10)
        .await
        .unwrap()
        .is_empty());
    for (i, r) in rows.iter().enumerate() {
        let pid = db.store.profile_id(&r.name).await.unwrap().unwrap();
        assert_eq!(
            db.store.leaderboard_rank(&month, pid).await.unwrap(),
            Some((i as i64 + 1, r.gv))
        );
    }
    let zz = db.store.profile_id("zz").await.unwrap().unwrap();
    assert_eq!(db.store.leaderboard_rank(&month, zz).await.unwrap(), None);
    assert_eq!(db.store.leaderboard_months(24).await.unwrap(), vec![month]);
    db.store.ping().await.unwrap();
    db.teardown().await;
}

#[test]
fn ct_eq_is_equality() {
    assert!(ct_eq(&[1, 2, 3], &[1, 2, 3]));
    assert!(!ct_eq(&[1, 2, 3], &[1, 2, 4]));
    assert!(!ct_eq(&[1, 2], &[1, 2, 0]));
}
