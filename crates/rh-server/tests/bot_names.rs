//! P-BOTS-7 remainder: the read-only profile-name seam (source isNameTaken) against the pinned throwaway PostgreSQL
//! cluster: the durable callsigns are read without touching a profile, lower-cased for the fill policy's read-only set.
#![cfg(feature = "postgres")]

use rh_server::persist::Persistence;
use std::sync::Arc;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_profile_name_set_is_read_only_and_lower_cased() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\")");
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_botnames_{}", std::process::id());
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
    sqlx::query(&format!("CREATE DATABASE {db}"))
        .execute(admin.pool())
        .await
        .unwrap();
    let db_url = match url.rfind('/') {
        Some(i) => format!("{}/{db}", &url[..i]),
        None => panic!("DATABASE_URL has no database name"),
    };
    let store = Arc::new(rh_persist::Store::connect(&db_url).await.unwrap());
    store.migrate().await.unwrap();
    store.create_profile("Wren", "tok-wren").await.unwrap();
    store
        .create_profile("Kestrel_7", "tok-kestrel")
        .await
        .unwrap();
    // The durable read path: every profile callsign, and nothing else.
    let mut names = store.profile_callsigns().await.unwrap();
    names.sort();
    assert_eq!(names, ["Kestrel_7", "Wren"]);
    // The server seam lower-cases the same set for the fill policy (source isNameTaken compares case-insensitively).
    let persistence = Persistence::postgres(store.clone(), "test".into());
    let set = persistence.bot_names().await;
    assert_eq!(set.len(), 2);
    assert!(set.contains("wren"));
    assert!(set.contains("kestrel_7"));
    assert!(!set.contains("Wren"), "the set is lower-cased for the draw");
    // Reading the set changes nothing: both profiles still exist and keep their callsigns.
    assert_eq!(store.profile_callsigns().await.unwrap().len(), 2);
    drop(store);
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}
