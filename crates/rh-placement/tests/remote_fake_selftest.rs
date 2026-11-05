//! Self-tests of the parent-hosted remote fake (tests/support/remote_fake). Real TCP, no sleeps for ordering: barriers, held
//! effects and `wait_client_gone` decide every ordering; the only wall-clock use is a client timeout that is asserted AFTER
//! the effect's barrier has fired.
#[path = "support/remote_fake/mod.rs"]
mod remote_fake;

use remote_fake::{
    ErrorKind, HeldKind, Matcher, Op, RemoteDns, RemoteFake, RemoteGameLift, ReplyState, Stage,
};
use rh_placement::backend::{
    BackendError, DnsBackend, Fallback, GameLiftBackend, PlacementStatus, StartPlacement,
};
use rh_placement::fake::RegionBehaviour;
use std::time::Duration;

const BINDING: &str = "owner-binding-v1";

fn start_req(id: &str) -> StartPlacement {
    StartPlacement {
        placement_id: id.into(),
        queue_name: "q".into(),
        max_player_sessions: 2,
        players: vec!["alice".into()],
        game_session_data: BINDING.into(),
        location_order: vec!["us-west-2".into()],
        fallback: Fallback::None,
    }
}

async fn fake() -> RemoteFake {
    RemoteFake::spawn(&[(
        "us-west-2",
        RegionBehaviour::Fulfil {
            after_polls: 1,
            ip: "203.0.113.7".into(),
            port: 35010,
        },
    )])
    .await
}

fn gl(f: &RemoteFake, ms: u64) -> RemoteGameLift {
    RemoteGameLift::new(f.addr(), Duration::from_millis(ms))
}

#[tokio::test]
async fn server_survives_client_task_drop_mid_request_and_garbage() {
    let f = fake().await;
    f.hold_effect(Op::Start, Matcher::key("rh-a-"));
    let arrived = f.notify_on(Op::Start, Matcher::key("rh-a-"), Stage::Arrived);
    let c = RemoteGameLift::with_default_timeout(f.addr());
    let h = tokio::spawn(async move { c.start_placement(&start_req("rh-a-1")).await });
    arrived.wait().await;
    let held = f.held();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].kind, HeldKind::Effect);
    h.abort();
    assert!(h.await.unwrap_err().is_cancelled());
    f.wait_client_gone(held[0].id).await;
    // A half-written request from another dying client changes nothing.
    {
        use tokio::io::AsyncWriteExt;
        let mut s = tokio::net::TcpStream::connect(f.addr()).await.unwrap();
        s.write_all(b"{\"op\":\"start\",\"placement_")
            .await
            .unwrap();
    }
    // The server still answers; the held start was NOT applied by the dead client.
    let c2 = gl(&f, 2000);
    assert_eq!(
        c2.describe_placement("rh-a-1").await.unwrap_err(),
        BackendError::NotFound
    );
    assert!(f.trace().is_empty());
    let applied = f.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    assert!(f.release_held(held[0].id));
    applied.wait().await;
    // Late application: recorded, identity preserved, and the server kept serving.
    let t = f.trace();
    assert_eq!(t.len(), 1);
    assert!(t[0].late);
    assert_eq!(t[0].binding.as_deref(), Some(BINDING));
    assert_eq!(
        c2.describe_placement("rh-a-1")
            .await
            .unwrap()
            .game_session_data
            .as_deref(),
        Some(BINDING)
    );
}

#[tokio::test]
async fn server_survives_sigkilled_client_process() {
    // The child entry point re-executes this very test binary; see `child_entry`.
    let f = fake().await;
    f.hold_effect(Op::Start, Matcher::key("rh-k-"));
    let arrived = f.notify_on(Op::Start, Matcher::key("rh-k-"), Stage::Arrived);
    let exe = std::env::current_exe().unwrap();
    let mut child = std::process::Command::new(exe)
        .args(["--exact", "child_entry", "--nocapture", "--test-threads=1"])
        .env("RF_CHILD_ADDR", f.addr().to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    arrived.wait().await;
    let id = f.held()[0].id;
    child.kill().unwrap(); // SIGKILL
    child.wait().unwrap();
    f.wait_client_gone(id).await;
    assert!(
        f.trace().is_empty(),
        "a held effect is not applied by the death of its requester"
    );
    let applied = f.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    f.release_all();
    applied.wait().await;
    let t = f.trace();
    assert_eq!(t.len(), 1);
    assert!(t[0].late);
    assert_eq!(t[0].placement_id.as_deref(), Some("rh-k-1"));
    assert_eq!(t[0].binding.as_deref(), Some(BINDING));
    // A fresh client (a restarted child) sees the placement and cannot reuse the id.
    let c = gl(&f, 2000);
    assert!(c.describe_placement("rh-k-1").await.is_ok());
    assert_eq!(
        c.start_placement(&start_req("rh-k-1")).await.unwrap_err(),
        BackendError::AlreadyExists
    );
}

/// Not a test of its own: the SIGKILL test spawns it with `RF_CHILD_ADDR` set. Without the variable it passes at once.
#[tokio::test]
async fn child_entry() {
    let Ok(addr) = std::env::var("RF_CHILD_ADDR") else {
        return;
    };
    let c = RemoteGameLift::new(addr.parse().unwrap(), Duration::from_secs(600));
    let _ = c.start_placement(&start_req("rh-k-1")).await;
}

#[tokio::test]
async fn drop_receipt_applies_effect_and_client_errors_on_timeout() {
    let f = fake().await;
    f.drop_receipt(Op::Start, Matcher::key("rh-d-"));
    let applied = f.notify_on(Op::Start, Matcher::key("rh-d-"), Stage::Applied);
    let c = gl(&f, 200);
    let call = tokio::spawn(async move { c.start_placement(&start_req("rh-d-1")).await });
    applied.wait().await;
    let err = call.await.unwrap().unwrap_err();
    assert!(matches!(err, BackendError::Unavailable(_)), "{err:?}");
    // The effect stands; the trace says the reply was dropped.
    assert!(f.placements().contains_key("rh-d-1"));
    let t = f.trace();
    assert_eq!(t.len(), 1);
    assert!(!t[0].late);
    assert_eq!(t[0].reply, ReplyState::Dropped);
    // The rule was consumed: a second start of another id is answered.
    assert!(gl(&f, 2000)
        .start_placement(&start_req("rh-d-2"))
        .await
        .is_ok());
    assert_eq!(f.trace()[1].reply, ReplyState::Delivered);
}

#[tokio::test]
async fn hold_effect_applies_only_on_release_after_connection_gone() {
    let f = fake().await;
    f.hold_effect(Op::DnsDelete, Matcher::key("host-1."));
    f.hold_effect(Op::Terminate, Matcher::any());
    let dns = RemoteDns::new(f.addr(), Duration::from_millis(100));
    let gle = gl(&f, 100);
    // Seed state through unheld paths.
    dns.upsert("host-1.example.test", "203.0.113.7", 60)
        .await
        .unwrap();
    let arrived = f.notify_on(Op::DnsDelete, Matcher::any(), Stage::Arrived);
    let r = tokio::spawn(async move { dns.delete("host-1.example.test").await });
    arrived.wait().await;
    // The client times out and its connection closes while the delete is held.
    assert!(matches!(
        r.await.unwrap(),
        Err(BackendError::Unavailable(_))
    ));
    let held = f.held();
    assert_eq!(held.len(), 1);
    f.wait_client_gone(held[0].id).await;
    assert!(
        f.dns().contains_key("host-1.example.test"),
        "held delete must not apply early"
    );
    assert_eq!(f.trace_of(Op::DnsDelete).len(), 0);
    // A held terminate for an ARN that matches the earlier start.
    gle.start_placement(&start_req("rh-h-1")).await.unwrap();
    gle.describe_placement("rh-h-1").await.unwrap(); // fulfils (after_polls 1) and fixes the ARN
    let arn = f.placements()["rh-h-1"].game_session_arn.clone().unwrap();
    let arrived_t = f.notify_on(Op::Terminate, Matcher::any(), Stage::Arrived);
    let t = tokio::spawn({
        let gle = gle.clone();
        let arn = arn.clone();
        async move { gle.terminate_game_session(&arn).await }
    });
    arrived_t.wait().await;
    assert!(matches!(
        t.await.unwrap(),
        Err(BackendError::Unavailable(_))
    ));
    assert!(f.terminated().is_empty());
    let both = f.held();
    assert_eq!(both.len(), 2);
    for h in &both {
        f.wait_client_gone(h.id).await;
    }
    let applied = f.notify_on(Op::DnsDelete, Matcher::any(), Stage::Applied);
    assert_eq!(f.release_all(), 2);
    applied.wait().await;
    let dd = f.trace_of(Op::DnsDelete);
    assert_eq!(dd.len(), 1);
    assert!(dd[0].late);
    assert_eq!(dd[0].hostname.as_deref(), Some("host-1.example.test"));
    assert_eq!(dd[0].reply, ReplyState::Dropped);
    assert!(!f.dns().contains_key("host-1.example.test"));
    // The terminate may land a moment after the delete; wait for it through a fresh describe-free path: held list empties.
    let tr = loop {
        let t = f.trace_of(Op::Terminate);
        if !t.is_empty() {
            break t;
        }
        tokio::task::yield_now().await;
    };
    assert!(tr[0].late);
    assert_eq!(tr[0].arn.as_deref(), Some(arn.as_str()));
    assert_eq!(tr[0].placement_id.as_deref(), Some("rh-h-1"));
    assert_eq!(tr[0].binding.as_deref(), Some(BINDING));
}

#[tokio::test]
async fn hold_reply_after_apply_records_held_then_delivered() {
    let f = fake().await;
    f.hold_reply_after_apply(Op::Start, Matcher::any());
    let arrived = f.notify_on(Op::Start, Matcher::any(), Stage::Arrived);
    let applied = f.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    let c = gl(&f, 5000);
    let call = tokio::spawn(async move { c.start_placement(&start_req("rh-r-1")).await });
    arrived.wait().await;
    applied.wait().await;
    assert!(
        f.placements().contains_key("rh-r-1"),
        "effect applied before the reply is released"
    );
    // `Held` is set just after the Applied barrier; wait for the held entry, not for time.
    let id = loop {
        if let Some(h) = f.held().first() {
            if f.trace()[0].reply == ReplyState::Held {
                break h.id;
            }
        }
        tokio::task::yield_now().await;
    };
    assert!(!call.is_finished());
    assert!(f.release_held(id));
    let st = call.await.unwrap().unwrap();
    assert_eq!(st.game_session_data.as_deref(), Some(BINDING));
    // Delivered is recorded just after the write; the client has the reply, so it is set or about to be.
    while f.trace()[0].reply != ReplyState::Delivered {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn not_found_then_late_start() {
    let f = fake().await;
    f.start_accepted_later(Matcher::key("rh-n-"));
    let arrived = f.notify_on(Op::Start, Matcher::any(), Stage::Arrived);
    let c = gl(&f, 100);
    let start = tokio::spawn({
        let c = c.clone();
        async move { c.start_placement(&start_req("rh-n-1")).await }
    });
    arrived.wait().await;
    assert!(matches!(
        start.await.unwrap(),
        Err(BackendError::Unavailable(_))
    ));
    let d = gl(&f, 2000);
    // Two describes: NotFound, deterministically, because the held start is not accepted yet.
    assert_eq!(
        d.describe_placement("rh-n-1").await.unwrap_err(),
        BackendError::NotFound
    );
    assert_eq!(
        d.describe_placement("rh-n-1").await.unwrap_err(),
        BackendError::NotFound
    );
    assert!(f.trace().is_empty());
    let applied = f.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    f.release_all();
    applied.wait().await;
    // Now the placement exists: the earlier NotFounds were not proof of absence.
    let st = d.describe_placement("rh-n-1").await.unwrap();
    assert_eq!(st.status, PlacementStatus::Fulfilled);
    assert_eq!(st.game_session_data.as_deref(), Some(BINDING));
    let t = f.trace();
    assert_eq!(t.len(), 1);
    assert!(t[0].late);
    assert_eq!(t[0].op, Op::Start);
    assert_eq!(t[0].locations, vec!["us-west-2".to_string()]);
    let outcomes: Vec<String> = f.calls().into_iter().map(|c| c.outcome).collect();
    assert_eq!(
        outcomes.iter().filter(|o| *o == "error:NotFound").count(),
        2
    );
}

#[tokio::test]
async fn identity_fields_survive_every_receipt() {
    let f = fake().await;
    let c = gl(&f, 2000);
    let s = c.start_placement(&start_req("rh-i-1")).await.unwrap();
    assert_eq!(s.game_session_data.as_deref(), Some(BINDING));
    assert_eq!(s.placement_id, "rh-i-1");
    let p = c.describe_placement("rh-i-1").await.unwrap(); // fulfilled
    assert_eq!(p.status, PlacementStatus::Fulfilled);
    assert_eq!(p.game_session_data.as_deref(), Some(BINDING));
    assert_eq!(p.placement_id, "rh-i-1");
    assert_eq!(p.port, Some(35010));
    assert_eq!(p.placed_player_sessions.len(), 1);
    // Stop on a fulfilled placement is Invalid.
    assert!(matches!(
        c.stop_placement("rh-i-1").await,
        Err(BackendError::Invalid(_))
    ));
    // Stop on a pending one cancels and keeps identity.
    f.set_behaviour(
        "us-west-2",
        RegionBehaviour::Fulfil {
            after_polls: 99,
            ip: "203.0.113.7".into(),
            port: 1,
        },
    );
    c.start_placement(&start_req("rh-i-2")).await.unwrap();
    let pend = c.describe_placement("rh-i-2").await.unwrap();
    assert_eq!(pend.game_session_data.as_deref(), Some(BINDING));
    assert!(pend.game_session_arn.is_none());
    let stopped = c.stop_placement("rh-i-2").await.unwrap();
    assert_eq!(stopped.status, PlacementStatus::Cancelled);
    assert_eq!(stopped.game_session_data.as_deref(), Some(BINDING));
    assert_eq!(stopped.placement_id, "rh-i-2");
    // Terminate is idempotent and traced with the stored binding.
    let arn = p.game_session_arn.clone().unwrap();
    c.terminate_game_session(&arn).await.unwrap();
    c.terminate_game_session(&arn).await.unwrap();
    let tr = f.trace_of(Op::Terminate);
    assert_eq!(tr.len(), 2);
    assert!(tr
        .iter()
        .all(|m| m.binding.as_deref() == Some(BINDING)
            && m.placement_id.as_deref() == Some("rh-i-1")));
    // Ids are never reused.
    assert_eq!(
        c.start_placement(&start_req("rh-i-1")).await.unwrap_err(),
        BackendError::AlreadyExists
    );
    // Every applied mutation's reply was delivered.
    assert!(f.trace().iter().all(|m| m.reply == ReplyState::Delivered));
}

#[tokio::test]
async fn barrier_fires_on_arrival_and_after_apply_and_errors_inject() {
    let f = fake().await;
    f.inject_error(Op::Start, Matcher::key("rh-e-"), ErrorKind::Unavailable);
    f.inject_error(Op::DnsUpsert, Matcher::any(), ErrorKind::Invalid);
    f.inject_error(Op::Capacity, Matcher::any(), ErrorKind::NotFound);
    let c = gl(&f, 2000);
    let dns = RemoteDns::new(f.addr(), Duration::from_secs(2));
    let b = f
        .notify_on(Op::Start, Matcher::key("rh-e-"), Stage::Arrived)
        .wait();
    let req = start_req("rh-e-1");
    let (seq, r) = tokio::join!(b, c.start_placement(&req));
    assert_eq!(seq, 1);
    assert!(matches!(r, Err(BackendError::Unavailable(_))));
    assert!(
        f.trace().is_empty() && f.placements().is_empty(),
        "an injected error applies nothing"
    );
    // Rule consumed (times 1): the retry works.
    assert!(c.start_placement(&start_req("rh-e-1")).await.is_ok());
    assert!(matches!(
        dns.upsert("h.example.test", "1.2.3.4", 60).await,
        Err(BackendError::Invalid(_))
    ));
    assert!(f.dns().is_empty());
    dns.upsert("h.example.test", "1.2.3.4", 60).await.unwrap();
    assert_eq!(
        dns.resolve_authoritative("h.example.test").await.unwrap(),
        vec!["1.2.3.4".to_string()]
    );
    assert_eq!(c.capacity().await.unwrap_err(), BackendError::NotFound);
    f.set_capacity(&[("us-west-2", Some(3)), ("eu-west-1", None)]);
    let cap = c.capacity().await.unwrap();
    assert_eq!(cap["us-west-2"].available_sessions, Some(3));
    assert_eq!(cap["eu-west-1"].available_sessions, None);
    // skip/times: let one describe through, then fail two.
    f.inject_error(
        Op::Describe,
        Matcher::any().skip(1).times(2),
        ErrorKind::Unavailable,
    );
    assert!(c.describe_placement("rh-e-1").await.is_ok());
    assert!(c.describe_placement("rh-e-1").await.is_err());
    assert!(c.describe_placement("rh-e-1").await.is_err());
    assert!(c.describe_placement("rh-e-1").await.is_ok());
}

#[tokio::test]
async fn dead_server_is_unavailable_not_a_panic() {
    let addr = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap()
    };
    let c = RemoteGameLift::new(addr, Duration::from_millis(500));
    let e = c.describe_placement("rh-x-1").await.unwrap_err();
    match e {
        BackendError::Unavailable(m) => assert!(!m.contains("rh-x-1")),
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        RemoteDns::new(addr, Duration::from_millis(500))
            .delete("h")
            .await,
        Err(BackendError::Unavailable(_))
    ));
    // A server that goes away mid-test: later calls fail soft.
    let f = fake().await;
    let a = f.addr();
    drop(f);
    tokio::task::yield_now().await;
    let c2 = RemoteGameLift::new(a, Duration::from_millis(500));
    assert!(matches!(
        c2.capacity().await,
        Err(BackendError::Unavailable(_))
    ));
}
