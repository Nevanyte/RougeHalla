//! Process-level crash/restart tests. A CHILD service process (`placement-crash-child`) runs the real `PlacementService`
//! over a real PostgreSQL ledger and a remote fake GameLift/DNS hosted by THIS process; the child is killed at one boundary
//! (a fault point that aborts the process, or a SIGKILL from here while the fake holds its call) and a NEW child restarts
//! through the real service path (reap, identical retry, release). The fake outlives every child and records every external
//! mutation; each test asserts the durable rows AND that trace. Ordering comes from fault points and fake barriers; the only
//! waiting is for a dead worker's lease to run out.
#[path = "support/crash_harness.rs"]
mod crash_harness;
mod ledger_support;

use crash_harness::remote_fake::{Matcher, Op, ReplyState, Stage};
use crash_harness::*;
use rh_placement::fake::RegionBehaviour;
use rh_placement::ledger::{DnsStep, Phase, Resolution, StartStep, StopStep, TermStep};
use serde_json::Value;

fn code(v: &Value) -> &str {
    v["code"].as_str().unwrap_or("")
}

/// Run a child that dies at `at`, then wait for its row to become reapable.
async fn abandon_at(h: &H, id: &str, at: &str) {
    h.crash(&["place", id], at, &[]).await;
    h.wait_reapable(id).await;
}

#[tokio::test]
async fn a_committed_start_intent_survives_a_crash_before_the_start_is_sent() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    // A foreign placement already sits under the id the second request will use.
    let colliding = rh_placement::backend::StartPlacement {
        placement_id: pid("crashA02"),
        queue_name: "q".into(),
        max_player_sessions: 2,
        players: vec!["mallory".into()],
        game_session_data: r#"{"requestId":"crashA02","ownership":"not-ours"}"#.into(),
        location_order: vec!["us-west-2".into()],
        fallback: rh_placement::backend::Fallback::None,
    };
    remote_start(&h, &colliding).await;
    let before = h.fake.trace().len();

    h.crash(&["place", "crashA01"], "after.write.start_intent", &[])
        .await;
    assert_eq!(
        h.fake.trace().len(),
        before,
        "the crash came before any effect was sent"
    );
    assert!(h.ops("crashA01", ZONE).is_empty());
    let row = h.row("crashA01").await;
    assert_eq!(row.phase, Phase::Active);
    assert_eq!(row.state.attempts.len(), 1);
    assert!(matches!(
        row.state.attempts[0].start,
        StartStep::Intent { .. }
    ));
    assert_eq!(row.state.attempts[0].resolution, Resolution::Open);
    h.wait_reapable("crashA01").await;

    // Restart: the provider has never heard of it. Two NotFound answers an instant after the intent do NOT settle it.
    for expected in 1..=2u64 {
        let r = h.run(&["reap"], &[]).await;
        assert_eq!(r["resolved"], 0, "{r}");
        assert_eq!(r["unresolved"], 1, "{r}");
        let row = h.row("crashA01").await;
        assert_eq!(row.state.attempts[0].not_found.count as u64, expected);
        assert_eq!(row.state.attempts[0].resolution, Resolution::Open);
        h.wait_reapable("crashA01").await;
    }
    // The identical retry is bound to the row: it is not a restart of the same id, and it sends nothing.
    let retry = h.run(&["place", "crashA01"], &[]).await;
    assert_eq!(
        (retry["ok"].as_bool(), code(&retry)),
        (Some(false), "request_id_reused"),
        "{retry}"
    );
    assert!(h.ops("crashA01", ZONE).is_empty());

    // A foreign placement under our id is recognised by its binding and left alone.
    h.crash(&["place", "crashA02"], "after.write.start_intent", &[])
        .await;
    h.wait_reapable("crashA02").await;
    let r = h.run(&["reap"], &[]).await;
    assert_eq!(
        r["resolved"], 1,
        "only the foreign-collision row became final: {r}"
    );
    let row = h.row("crashA02").await;
    assert_eq!(row.phase, Phase::Finished);
    assert_eq!(row.state.attempts[0].resolution, Resolution::Foreign);
    h.assert_foreign_untouched();
    for m in h.fake.trace() {
        assert!(
            matches!(m.op, Op::Start | Op::DnsUpsert),
            "nothing was stopped, terminated or deleted: {m:?}"
        );
    }
    let still = h.fake.placements();
    assert_eq!(
        still[&pid("crashA02")].game_session_data.as_deref(),
        Some(r#"{"requestId":"crashA02","ownership":"not-ours"}"#)
    );
    // The unresolved row is still discoverable.
    assert_eq!(h.counts().await.unresolved, 1);
    h.finish().await;
}

async fn remote_start(h: &H, sp: &rh_placement::backend::StartPlacement) {
    use rh_placement::backend::GameLiftBackend;
    crash_harness::remote_fake::RemoteGameLift::with_default_timeout(h.fake.addr())
        .start_placement(sp)
        .await
        .expect("seed start");
}

#[tokio::test]
async fn a_start_accepted_with_a_lost_receipt_is_found_by_its_binding_and_cleaned() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    let key = pid("crashB01");
    h.fake.drop_receipt(Op::Start, Matcher::key(&key));
    let applied = h
        .fake
        .notify_on(Op::Start, Matcher::key(&key), Stage::Applied);
    let child = h.spawn(&["place", "crashB01"], &[]);
    applied.wait().await; // the provider accepted the start; the child never gets the answer
    H::sigkill(child);

    let t = h.mine("crashB01", ZONE);
    assert_eq!(t.len(), 1);
    assert_eq!((t[0].op, t[0].reply), (Op::Start, ReplyState::Dropped));
    let row = h.row("crashB01").await;
    assert_eq!(row.phase, Phase::Active);
    assert!(
        matches!(row.state.attempts[0].start, StartStep::Intent { .. }),
        "the receipt was lost: the row still says Intent"
    );
    assert_eq!(
        t[0].binding.as_deref(),
        Some(row.state.attempts[0].binding.as_str()),
        "the stored binding is exactly what the provider holds"
    );
    h.wait_reapable("crashB01").await;

    let r = h.run(&["reap"], &[]).await;
    assert_eq!(r["resolved"], 1, "{r}");
    let row = h.row("crashB01").await;
    assert_eq!(row.phase, Phase::Finished);
    assert!(row.state.offer.is_none());
    assert!(
        matches!(
            row.state.attempts[0].resolution,
            Resolution::CleanedUp | Resolution::NoHost
        ),
        "{:?}",
        row.state.attempts[0].resolution
    );
    h.assert_no_orphans();
    h.assert_foreign_untouched();
    // Every mutation of this request is accounted for: one start, then only cleanup of that very placement.
    let ops = h.ops("crashB01", ZONE);
    assert_eq!(ops[0], Op::Start);
    assert!(
        ops[1..]
            .iter()
            .all(|o| matches!(o, Op::Stop | Op::DnsDelete | Op::Terminate)),
        "{ops:?}"
    );
    let retry = h.run(&["place", "crashB01"], &[]).await;
    assert_eq!(code(&retry), "request_id_reused", "{retry}");
    assert_eq!(h.ops("crashB01", ZONE), ops, "the retry changed nothing");
    h.finish().await;
}

#[tokio::test]
async fn a_fulfilled_placement_whose_dns_receipt_was_lost_is_cleaned_not_offered() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    let host = host_of("crashC01", ZONE);
    h.fake.drop_receipt(Op::DnsUpsert, Matcher::key(&host));
    let applied = h
        .fake
        .notify_on(Op::DnsUpsert, Matcher::key(&host), Stage::Applied);
    let child = h.spawn(&["place", "crashC01"], &[]);
    applied.wait().await; // the record is written; the answer is withheld
    H::sigkill(child);

    assert!(h.fake.dns().contains_key(&host), "the upsert was applied");
    let row = h.row("crashC01").await;
    assert_eq!(row.phase, Phase::Active);
    assert!(row.state.offer.is_none());
    let a = &row.state.attempts[0];
    assert!(
        a.fulfilled.is_some(),
        "the fulfilment was durable before the DNS intent"
    );
    assert_eq!(a.dns, DnsStep::Intent { host: host.clone() });
    h.wait_reapable("crashC01").await;

    let r = h.run(&["reap"], &[]).await;
    assert_eq!(r["resolved"], 1, "{r}");
    assert_eq!(
        h.ops("crashC01", ZONE),
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete, Op::Terminate]
    );
    let row = h.row("crashC01").await;
    assert_eq!(
        (row.phase, row.state.attempts[0].resolution),
        (Phase::Finished, Resolution::CleanedUp)
    );
    assert_eq!(
        row.state.attempts[0].dns,
        DnsStep::Deleted { host: host.clone() }
    );
    assert_eq!(row.state.attempts[0].terminate, TermStep::Done);
    h.assert_no_orphans();
    h.assert_foreign_untouched();
    let retry = h.run(&["place", "crashC01"], &[]).await;
    assert_eq!(
        code(&retry),
        "request_id_reused",
        "a name that was never offered is never replayed: {retry}"
    );
    h.finish().await;
}

#[tokio::test]
async fn dns_written_and_verified_but_not_yet_offered_is_cleaned_after_a_crash() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    abandon_at(&h, "crashD01", "before.write.offer").await;

    let host = host_of("crashD01", ZONE);
    assert_eq!(
        h.ops("crashD01", ZONE),
        vec![Op::Start, Op::DnsUpsert],
        "the hostname was really published"
    );
    assert!(h.fake.dns().contains_key(&host));
    let row = h.row("crashD01").await;
    assert_eq!(row.phase, Phase::Active, "the offer commit never happened");
    assert!(row.state.offer.is_none());
    assert_eq!(
        row.state.attempts[0].dns,
        DnsStep::Verified { host: host.clone() }
    );

    let r = h.run(&["reap"], &[]).await;
    assert_eq!(r["resolved"], 1, "{r}");
    assert_eq!(
        h.ops("crashD01", ZONE),
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete, Op::Terminate]
    );
    assert_eq!(h.row("crashD01").await.phase, Phase::Finished);
    h.assert_no_orphans();
    h.assert_foreign_untouched();
    let retry = h.run(&["place", "crashD01"], &[]).await;
    assert_eq!(code(&retry), "request_id_reused", "{retry}");
    h.finish().await;
}

#[tokio::test]
async fn an_offer_committed_before_the_response_survives_and_is_replayed_to_the_same_request_only()
{
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    h.crash(&["place", "crashE01"], "after.write.offer", &[])
        .await;

    let row = h.row("crashE01").await;
    assert_eq!(row.phase, Phase::Offered);
    let stored = row.state.offer.clone().expect("the offer is durable");
    assert_eq!(row.state.attempts[0].resolution, Resolution::Offered);
    assert!(!row.claim.live, "an offered row holds no claim");
    let trace = h.ops("crashE01", ZONE);
    assert_eq!(trace, vec![Op::Start, Op::DnsUpsert]);

    // The reaper never selects it, however often it runs and whatever the age of the offer.
    for _ in 0..2 {
        let r = h.run(&["reap"], &[]).await;
        assert_eq!(
            (r["resolved"].as_u64(), r["unresolved"].as_u64()),
            (Some(0), Some(0)),
            "{r}"
        );
    }
    assert_eq!(
        h.ops("crashE01", ZONE),
        trace,
        "the reaper touched an offered session"
    );
    assert!(h.fake.dns().contains_key(&stored.hostname));
    assert_eq!(h.row("crashE01").await.phase, Phase::Offered);

    // An identical retry is an idempotent replay: the stored offer, with no backend call at all.
    let calls = h.fake.calls().len();
    let retry = h.run(&["place", "crashE01"], &[]).await;
    assert_eq!(retry["ok"], true, "{retry}");
    let o = &retry["offer"];
    assert_eq!(o["url"], stored.url.as_str());
    assert_eq!(o["hostname"], stored.hostname.as_str());
    assert_eq!(o["placement_id"], stored.placement_id.as_str());
    assert_eq!(o["game_session_arn"], stored.game_session_arn.as_str());
    assert_eq!(
        h.fake.calls().len(),
        calls,
        "a replay makes no backend call"
    );

    // A different scope, party or configuration under the same id is a conflict that fails before any external call.
    let other_scope = h.run(&["place", "crashE01", "someone-else"], &[]).await;
    let other_party = h
        .run(&["place", "crashE01"], &[("RH_CHILD_CALLSIGN", "mallory")])
        .await;
    let other_config = h
        .run(
            &["place", "crashE01"],
            &[("RH_CHILD_ZONE", "other.example.com")],
        )
        .await;
    for r in [&other_scope, &other_party, &other_config] {
        assert_eq!(
            (r["ok"].as_bool(), code(r)),
            (Some(false), "invalid_request"),
            "{r}"
        );
    }
    assert_eq!(
        h.fake.calls().len(),
        calls,
        "conflicts made no backend call"
    );
    let row = h.row("crashE01").await;
    assert_eq!(
        (row.phase, row.state.offer.as_ref()),
        (Phase::Offered, Some(&stored))
    );
    h.assert_foreign_untouched();
    h.finish().await;
}

#[tokio::test]
async fn a_cleanup_effect_accepted_before_local_completion_is_repeated_idempotently_after_a_crash()
{
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    let reap_crash = |at: &'static str| {
        let h = &h;
        async move {
            h.crash(&["reap"], at, &[]).await;
        }
    };

    // (1) terminate accepted, crash before the completion write.
    abandon_at(&h, "crashF01", "before.write.offer").await;
    reap_crash("after.backend.terminate_game_session").await;
    assert_eq!(
        h.ops("crashF01", ZONE),
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete, Op::Terminate]
    );
    let a = h.row("crashF01").await;
    assert_eq!(a.phase, Phase::Active);
    assert_eq!(
        a.state.attempts[0].resolution,
        Resolution::Open,
        "the effect landed but the completion did not"
    );
    assert!(matches!(
        a.state.attempts[0].terminate,
        TermStep::Intent { .. }
    ));
    h.wait_reapable("crashF01").await; // the dead reaper's claim runs out: still discoverable
    let r = h.run(&["reap"], &[]).await;
    assert_eq!(r["resolved"], 1, "{r}");
    assert_eq!(
        h.ops("crashF01", ZONE),
        vec![
            Op::Start,
            Op::DnsUpsert,
            Op::DnsDelete,
            Op::Terminate,
            Op::DnsDelete,
            Op::Terminate
        ],
        "both cleanup effects were repeated (they are idempotent), nothing else"
    );
    let a = h.row("crashF01").await;
    assert_eq!(
        (a.phase, a.state.attempts[0].resolution),
        (Phase::Finished, Resolution::CleanedUp)
    );

    // (2) DNS delete accepted, crash before the terminate is sent.
    abandon_at(&h, "crashF02", "before.write.offer").await;
    reap_crash("after.backend.dns_delete").await;
    assert_eq!(
        h.ops("crashF02", ZONE),
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete]
    );
    assert_eq!(
        h.row("crashF02").await.state.attempts[0].resolution,
        Resolution::Open
    );
    h.wait_reapable("crashF02").await;
    assert_eq!(h.run(&["reap"], &[]).await["resolved"], 1);
    assert_eq!(h.row("crashF02").await.phase, Phase::Finished);

    // (3) the effect has NOT happened yet (premature completion would hide this): crash before the terminate is sent.
    abandon_at(&h, "crashF03", "before.write.offer").await;
    reap_crash("before.backend.terminate_game_session").await;
    let ops = h.ops("crashF03", ZONE);
    assert_eq!(
        ops,
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete],
        "no terminate was sent"
    );
    let a = h.row("crashF03").await;
    assert_eq!(
        a.state.attempts[0].resolution,
        Resolution::Open,
        "completion is never recorded before its effect"
    );
    h.wait_reapable("crashF03").await;
    assert_eq!(h.run(&["reap"], &[]).await["resolved"], 1);
    assert_eq!(h.ops("crashF03", ZONE).last(), Some(&Op::Terminate));
    assert_eq!(h.row("crashF03").await.phase, Phase::Finished);

    // (4) a stop accepted, crash before it is recorded (a placement that never got a host).
    h.fake.set_behaviour("us-west-2", RegionBehaviour::NoHost);
    abandon_at(&h, "crashF04", "after.write.start_accepted").await;
    reap_crash("after.backend.stop_placement").await;
    assert_eq!(h.ops("crashF04", ZONE), vec![Op::Start, Op::Stop]);
    let a = h.row("crashF04").await;
    assert_eq!(
        a.state.attempts[0].stop,
        StopStep::Intent,
        "the stop intent is durable"
    );
    assert_eq!(a.state.attempts[0].resolution, Resolution::Open);
    h.wait_reapable("crashF04").await;
    assert_eq!(h.run(&["reap"], &[]).await["resolved"], 1);
    let a = h.row("crashF04").await;
    assert_eq!(
        (a.phase, a.state.attempts[0].resolution),
        (Phase::Finished, Resolution::NoHost)
    );
    assert_eq!(
        h.ops("crashF04", ZONE),
        vec![Op::Start, Op::Stop],
        "a terminal placement needs no second stop"
    );

    h.assert_no_orphans();
    h.assert_foreign_untouched();
    assert_eq!(h.counts().await.unresolved, 0);
    h.finish().await;
}

fn err_of(v: &Value) -> String {
    assert_eq!(v["ok"], false, "{v}");
    v["error"].as_str().unwrap_or_default().to_string()
}

async fn offer_for(h: &H, id: &str, scope: &str, envs: &[(&str, &str)]) -> Value {
    let o = h.run(&["place", id, scope], envs).await;
    assert_eq!(o["ok"], true, "{o}");
    o["offer"].clone()
}

#[tokio::test]
async fn release_is_bound_to_scope_request_and_placement_and_is_idempotent() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    let o1 = offer_for(&h, "crashR01", "default", &[]).await;
    let o2 = offer_for(&h, "crashR02", "default", &[]).await;
    let o3 = offer_for(&h, "crashR03", "acct-a", &[]).await;
    let (p1, p2) = (
        o1["placement_id"].as_str().unwrap(),
        o2["placement_id"].as_str().unwrap(),
    );
    let h1 = o1["hostname"].as_str().unwrap();
    let mutations = h.fake.trace().len();

    // Every refusal is decided before any DNS call.
    let refusals = [
        h.run(
            &[
                "release",
                "acct-b",
                "crashR03",
                o3["placement_id"].as_str().unwrap(),
            ],
            &[],
        )
        .await, // wrong scope
        h.run(
            &[
                "release",
                "default",
                "crashR03",
                o3["placement_id"].as_str().unwrap(),
            ],
            &[],
        )
        .await, // another scope's id
        h.run(&["release", "default", "crashR01", "rh-crashR01-9"], &[])
            .await, // wrong placement
        h.run(&["release", "default", "crashR01", p2], &[]).await, // another request's offer
        h.run(&["release", "default", "crashR02", p1], &[]).await,
        h.run(&["release", "default", "nosuchid1", p1], &[]).await, // unknown request id
    ];
    let names: Vec<String> = refusals.iter().map(err_of).collect();
    assert_eq!(
        names,
        [
            "Unknown",
            "Unknown",
            "WrongPlacement",
            "WrongPlacement",
            "WrongPlacement",
            "Unknown"
        ]
    );
    assert_eq!(
        h.fake.trace().len(),
        mutations,
        "a refused release made an external mutation"
    );
    for id in ["crashR01", "crashR02", "crashR03"] {
        assert_eq!(h.row(id).await.phase, Phase::Offered);
    }

    // The authorized release deletes that offer's name, in the zone stored with the request, and nothing else.
    assert_eq!(
        h.run(&["release", "default", "crashR01", p1], &[]).await["ok"],
        true
    );
    assert_eq!(
        h.ops("crashR01", ZONE),
        vec![Op::Start, Op::DnsUpsert, Op::DnsDelete]
    );
    assert!(!h.fake.dns().contains_key(h1));
    for o in [&o2, &o3] {
        assert!(
            h.fake.dns().contains_key(o["hostname"].as_str().unwrap()),
            "another offer's name was deleted"
        );
    }
    let row = h.row("crashR01").await;
    assert_eq!(row.phase, Phase::Released);
    assert!(row.state.release.is_some_and(|r| r.done_at_ms.is_some()));
    assert!(
        h.fake.terminated().is_empty(),
        "release removes the name only; the game host ends itself"
    );

    // A duplicate is Ok and does nothing; a released id never replays its dead join URL.
    let n = h.fake.trace().len();
    assert_eq!(
        h.run(&["release", "default", "crashR01", p1], &[]).await["ok"],
        true
    );
    assert_eq!(h.fake.trace().len(), n);
    let again = h.run(&["place", "crashR01"], &[]).await;
    assert_eq!(code(&again), "request_id_reused", "{again}");
    assert_eq!(h.fake.trace().len(), n);
    assert_eq!(h.row("crashR02").await.phase, Phase::Offered);
    h.assert_foreign_untouched();
    h.finish().await;
}

#[tokio::test]
async fn release_deletes_in_the_zone_the_request_was_placed_under() {
    let h = H::new(fulfil()).await;
    let o = offer_for(
        &h,
        "crashR04",
        "default",
        &[("RH_CHILD_ZONE", "a.example.com")],
    )
    .await;
    let host = o["hostname"].as_str().unwrap().to_string();
    assert!(host.ends_with(".a.example.com"), "{host}");
    // The configured zone has changed since: the stored one decides.
    let r = h
        .run(
            &[
                "release",
                "default",
                "crashR04",
                o["placement_id"].as_str().unwrap(),
            ],
            &[("RH_CHILD_ZONE", "b.example.com")],
        )
        .await;
    assert_eq!(r["ok"], true, "{r}");
    let deletes = h.fake.trace_of(Op::DnsDelete);
    assert_eq!(deletes.len(), 1);
    assert_eq!(deletes[0].key, host);
    assert!(h.fake.dns().is_empty());
    h.finish().await;
}

#[tokio::test]
async fn a_release_that_died_midway_is_resumed_by_the_reaper_and_never_by_age() {
    let h = H::new(fulfil()).await;
    let o5 = offer_for(&h, "crashR05", "default", &[]).await;
    let o6 = offer_for(&h, "crashR06", "default", &[]).await;
    let (p5, p6) = (
        o5["placement_id"].as_str().unwrap(),
        o6["placement_id"].as_str().unwrap(),
    );

    // R05: the name was deleted but the completion was never written. R06: the intent is durable and nothing was deleted.
    h.crash(
        &["release", "default", "crashR05", p5],
        "after.backend.dns_delete",
        &[],
    )
    .await;
    h.crash(
        &["release", "default", "crashR06", p6],
        "after.write.release_intent",
        &[],
    )
    .await;
    for id in ["crashR05", "crashR06"] {
        let row = h.row(id).await;
        assert_eq!(row.phase, Phase::Releasing, "{id}");
        assert!(row.state.release.is_some_and(|r| r.done_at_ms.is_none()));
        assert_eq!(
            h.run(&["place", id], &[]).await["code"],
            "request_id_reused"
        );
    }
    assert_eq!(h.ops("crashR05", ZONE).last(), Some(&Op::DnsDelete));
    assert_eq!(h.ops("crashR06", ZONE), vec![Op::Start, Op::DnsUpsert]);
    h.wait_reapable("crashR05").await;
    h.wait_reapable("crashR06").await;
    assert_eq!(
        h.counts().await.unresolved,
        2,
        "half-done releases stay discoverable"
    );
    let r = h.run(&["reap"], &[]).await;
    assert_eq!(r["resolved"], 2, "{r}");
    for id in ["crashR05", "crashR06"] {
        assert_eq!(h.row(id).await.phase, Phase::Released);
    }
    assert!(h.fake.dns().is_empty());
    assert_eq!(
        h.fake.trace_of(Op::DnsDelete).len(),
        3,
        "R05 twice (idempotent), R06 once"
    );
    h.finish().await;
}

#[tokio::test]
async fn a_foreign_placement_under_our_id_is_never_adopted_stopped_or_offered() {
    let h = H::new(fulfil()).await;
    h.seed_foreign().await;
    let sp = rh_placement::backend::StartPlacement {
        placement_id: pid("crashG01"),
        queue_name: "q".into(),
        max_player_sessions: 2,
        players: vec!["mallory".into()],
        game_session_data: r#"{"requestId":"crashG01","ownership":"not-ours"}"#.into(),
        location_order: vec!["us-west-2".into()],
        fallback: rh_placement::backend::Fallback::None,
    };
    remote_start(&h, &sp).await;
    let r = h.run(&["place", "crashG01"], &[]).await;
    assert_eq!(
        (r["ok"].as_bool(), code(&r)),
        (Some(false), "request_id_reused"),
        "{r}"
    );
    let row = h.row("crashG01").await;
    assert!(row.state.offer.is_none());
    assert_eq!(row.state.attempts[0].resolution, Resolution::Foreign);
    for m in h.fake.trace() {
        assert!(
            matches!(m.op, Op::Start | Op::DnsUpsert),
            "foreign evidence authorized a mutation: {m:?}"
        );
    }
    assert_eq!(h.counts().await.offered, 0);
    h.finish().await;
}

/// The old ID-only `release_host(region, placement_id)` is gone. Rust offers no compile-fail check without a new
/// dependency, so this pins the public surface by reading the service source: the only public item that can release a name
/// is `release_session`, whose three arguments are the scope, the request id and the offer's placement id; the behavioural
/// tests above prove each argument is checked against the ledger before any DNS call.
#[test]
fn the_only_public_release_path_is_the_ledger_bound_release_session() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut found = vec![];
    for f in [
        "service/mod.rs",
        "service/run.rs",
        "ledger/mod.rs",
        "ledger/postgres.rs",
        "ledger/memory.rs",
    ] {
        let text = std::fs::read_to_string(root.join(f)).unwrap();
        for line in text.lines() {
            let l = line.trim_start();
            if l.starts_with("pub ") && l.contains("fn ") {
                let name = l
                    .split("fn ")
                    .nth(1)
                    .unwrap()
                    .split(['(', '<'])
                    .next()
                    .unwrap();
                if name.contains("release") || name.contains("delete") || name.contains("terminate")
                {
                    found.push(format!("{f}: {name}"));
                }
            }
        }
    }
    assert_eq!(found, ["service/mod.rs: release_session"], "{found:?}");
}
