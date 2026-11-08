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
    let set = persistence
        .bot_names()
        .await
        .expect("the durable profile-name set reads");
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

/// P-BOTS-7b repair: an unreadable durable profile registry fails the startup seam explicitly instead of being reported
/// as an empty read-only set (the pre-repair swallow would have let a claimable callsign go to the fill name draw).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreadable_profile_registry_is_a_startup_error_not_an_empty_set() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        if std::env::var("RH_SKIP_PG_TESTS").as_deref() == Ok("1") {
            eprintln!("SKIPPED: RH_SKIP_PG_TESTS=1");
            return;
        }
        panic!("DATABASE_URL is not set (eval \"$(tools/pgtest/start.sh)\"");
    };
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let db = format!("rh_botnames_err_{}", std::process::id());
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
    let persistence = Persistence::postgres(store.clone(), "test".into());
    // The readable path first: the seam lowers the durable callsigns.
    let names = persistence
        .bot_names_for_startup()
        .await
        .expect("a readable registry");
    assert!(names.contains("wren"));
    // Break the registry at the source: the durable read now fails and the seam reports it (main exits 2 on it).
    sqlx::query("DROP TABLE profiles CASCADE")
        .execute(store.pool())
        .await
        .unwrap();
    let err = persistence
        .bot_names_for_startup()
        .await
        .expect_err("an unreadable registry must not pretend success");
    assert!(
        err.contains("profile-name set unreadable"),
        "the startup error names the seam: {err}"
    );
    assert!(
        persistence.bot_names().await.is_err(),
        "the underlying read propagates too, not only the startup wrapper"
    );
    // Memory behavior is preserved: it cannot hit a durable read error and returns the seats this process has seen.
    let memory = Persistence::memory();
    let set = memory
        .bot_names_for_startup()
        .await
        .expect("memory mode cannot fail the seam");
    assert!(
        set.is_empty(),
        "no seat names have been seen in this process"
    );
    drop(store);
    let admin = rh_persist::Store::connect(&url).await.unwrap();
    let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS {db} WITH (FORCE)"))
        .execute(admin.pool())
        .await;
}
