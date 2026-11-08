//! Delayed EFFECT application, not just delayed receipts. Worker A runs the real service in this process; the remote fake
//! HOLDS one of its already-sent requests (the provider has not applied it). A's claim runs out, worker B (a second service
//! over its own PostgreSQL pool) takes the row over and finishes or advances it, and only then is A's old request applied.
//! Ordering is decided by fake barriers and held requests; the only waiting is for A's lease to run out.
//!
//! What the fence can and cannot do (README, "Known boundary"): it stops every durable write of a stale worker, so a stale
//! worker never publishes an offer or marks work finished; it cannot recall a request already sent, so the late request is
//! applied and the effects after the last fence check are the idempotent cleanup ones. These tests assert both halves.
#[path = "support/crash_harness.rs"]
mod crash_harness;
mod ledger_support;

use crash_harness::remote_fake::{Matcher, Op, Stage};
use crash_harness::*;
use rh_placement::fake::RegionBehaviour;
use rh_placement::ledger::{DnsStep, Phase, Resolution, StartStep, StopStep, TermStep};
use rh_placement::service::{DurabilityConfig, PlaceError};
use std::time::Duration;

fn dur(backend_ms: u64) -> DurabilityConfig {
    DurabilityConfig {
        worker_lease: Duration::from_millis(800),
        reaper_lease: Duration::from_millis(800),
        backend_op_timeout: Duration::from_millis(backend_ms),
        ..DurabilityConfig::default()
    }
}

/// A barrier that never fires (a mutant or a regression changed the order of effects) fails the test instead of hanging it.
async fn bounded<T>(f: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(30), f)
        .await
        .expect("a fake barrier never fired: the expected request was never sent")
}

fn unavailable(r: &Result<rh_placement::service::JoinOffer, PlaceError>) -> bool {
    matches!(r, Err(PlaceError::ServiceUnavailable(_)))
}

fn late_ops(h: &H, id: &str) -> Vec<(Op, bool)> {
    h.mine(id, ZONE).iter().map(|m| (m.op, m.late)).collect()
}

#[tokio::test]
async fn a_stop_applied_after_takeover_changes_nothing_and_the_stale_worker_cannot_finish() {
    let h = H::new(RegionBehaviour::NoHost).await;
    let (a, b) = (
        h.worker(ZONE, 1_000, dur(20_000)).await,
        h.worker(ZONE, 1_000, dur(20_000)).await,
    );
    let id = "delayA01";
    let key = pid(id);
    h.fake.hold_effect(Op::Stop, Matcher::key(&key));
    let held = h
        .fake
        .notify_on(Op::Stop, Matcher::key(&key), Stage::Arrived);
    let rq = request(id, "alice");
    let scope = rh_placement::ledger::Scope::default();
    let (res, ()) = tokio::join!(a.place_scoped(&scope, &rq), async {
        bounded(held.wait()).await; // A's stop is sent and held: the provider has not applied it
        let row = h.row(id).await;
        assert_eq!(
            row.state.attempts[0].stop,
            StopStep::Intent,
            "the intent was durable before the effect"
        );
        assert_eq!(h.ops(id, ZONE), vec![Op::Start]);
        h.wait_reapable(id).await;
        assert_eq!(
            b.reap_abandoned().await,
            1,
            "B takes the row over and finishes it"
        );
        let row = h.row(id).await;
        assert_eq!((row.phase, row.fence), (Phase::Finished, 2));
        assert_eq!(h.ops(id, ZONE), vec![Op::Start, Op::Stop], "B's own stop");
        let applied = h
            .fake
            .notify_on(Op::Stop, Matcher::key(&key), Stage::Applied);
        assert_eq!(h.fake.release_all(), 1);
        bounded(applied.wait()).await; // A's old stop is applied late
    });
    assert!(unavailable(&res), "{res:?}");
    assert_eq!(
        late_ops(&h, id),
        vec![(Op::Start, false), (Op::Stop, false), (Op::Stop, true)],
        "the trace shows the late application"
    );
    let row = h.row(id).await;
    assert_eq!(
        (row.phase, row.fence),
        (Phase::Finished, 2),
        "A's receipt could not rewrite the row"
    );
    assert_eq!(row.state.attempts[0].resolution, Resolution::NoHost);
    assert!(row.state.offer.is_none());
    h.assert_no_orphans();
    h.finish().await;
}

/// A publishes, the hostname never verifies, so A cleans up inline: delete, then terminate. One of the two is held.
async fn held_cleanup(op: Op, id: &str) {
    let h = H::new(fulfil()).await;
    let (a, b) = (
        h.worker(ZONE, 20_000, dur(20_000)).await,
        h.worker(ZONE, 20_000, dur(20_000)).await,
    );
    h.fake.set_dns_resolve_delay(10_000); // the authoritative servers never show the name
    let host = host_of(id, ZONE);
    let key = if op == Op::DnsDelete {
        host.clone()
    } else {
        format!(
            "arn:aws:gamelift:us-west-2::gamesession/fleet-x/us-west-2/{}",
            pid(id)
        )
    };
    h.fake.hold_effect(op, Matcher::key(&key));
    let held = h.fake.notify_on(op, Matcher::key(&key), Stage::Arrived);
    let rq = request(id, "alice");
    let scope = rh_placement::ledger::Scope::default();
    let (res, ()) = tokio::join!(a.place_scoped(&scope, &rq), async {
        bounded(held.wait()).await;
        let row = h.row(id).await;
        assert_eq!(row.phase, Phase::Active);
        assert!(
            row.state.offer.is_none(),
            "no offer while a cleanup operation is in flight"
        );
        assert_eq!(
            row.state.attempts[0].dns,
            DnsStep::DeleteIntent { host: host.clone() }
        );
        assert!(
            matches!(row.state.attempts[0].terminate, TermStep::Intent { .. }),
            "both cleanup intents were durable first"
        );
        h.fake.set_dns_resolve_delay(0);
        h.wait_reapable(id).await;
        assert_eq!(
            b.reap_abandoned().await,
            1,
            "B repeats the idempotent cleanup and finishes"
        );
        let row = h.row(id).await;
        assert_eq!(
            (row.phase, row.fence, row.state.attempts[0].resolution),
            (Phase::Finished, 2, Resolution::CleanedUp)
        );
        assert!(row.state.offer.is_none());
        let applied = h.fake.notify_on(op, Matcher::key(&key), Stage::Applied);
        assert_eq!(h.fake.release_all(), 1);
        bounded(applied.wait()).await; // A's old operation lands after B finished
    });
    assert!(unavailable(&res), "{res:?}");
    let trace = late_ops(&h, id);
    assert_eq!(
        trace.iter().filter(|(_, late)| *late).count(),
        1,
        "exactly the held operation is late: {trace:?}"
    );
    assert!(trace.iter().any(|(o, late)| *o == op && *late));
    // After the takeover only idempotent cleanup operations of THIS placement ever appear.
    assert!(
        trace
            .iter()
            .all(|(o, _)| matches!(o, Op::Start | Op::DnsUpsert | Op::DnsDelete | Op::Terminate)),
        "{trace:?}"
    );
    let row = h.row(id).await;
    assert_eq!(
        (row.phase, row.fence, row.state.attempts[0].resolution),
        (Phase::Finished, 2, Resolution::CleanedUp),
        "the stale worker finished nothing"
    );
    assert!(row.state.offer.is_none());
    assert_eq!(h.counts().await.offered, 0);
    h.assert_no_orphans();
    h.finish().await;
}

#[tokio::test]
async fn a_dns_delete_applied_after_takeover_is_idempotent_and_the_stale_worker_cannot_finish() {
    held_cleanup(Op::DnsDelete, "delayB01").await;
}

#[tokio::test]
async fn a_terminate_applied_after_takeover_is_idempotent_and_the_stale_worker_cannot_finish() {
    held_cleanup(Op::Terminate, "delayC01").await;
}

#[tokio::test]
async fn a_stale_worker_whose_dns_check_succeeds_late_cannot_publish_an_offer() {
    let h = H::new(fulfil()).await;
    let (a, b) = (
        h.worker(ZONE, 20_000, dur(20_000)).await,
        h.worker(ZONE, 20_000, dur(20_000)).await,
    );
    let id = "delayD01";
    let host = host_of(id, ZONE);
    // The authoritative check is applied (it sees the record) but its reply reaches A only after the takeover.
    h.fake
        .hold_reply_after_apply(Op::DnsResolve, Matcher::key(&host));
    let held = h
        .fake
        .notify_on(Op::DnsResolve, Matcher::key(&host), Stage::Applied);
    let rq = request(id, "alice");
    let scope = rh_placement::ledger::Scope::default();
    let (res, ()) = tokio::join!(a.place_scoped(&scope, &rq), async {
        bounded(held.wait()).await;
        assert_eq!(
            h.row(id).await.state.attempts[0].dns,
            DnsStep::Intent { host: host.clone() }
        );
        h.wait_reapable(id).await;
        // B's first pass cannot finish the cleanup (its DNS delete fails): the row stays ACTIVE with sent-and-unconfirmed
        // cleanup intents. A stale offer written now would coexist with an unresolved cleanup.
        h.fake.inject_error(
            Op::DnsDelete,
            Matcher::any(),
            crash_harness::remote_fake::ErrorKind::Unavailable,
        );
        assert_eq!(b.reap_abandoned().await, 0);
        let row = h.row(id).await;
        assert_eq!(row.phase, Phase::Active);
        assert_eq!(
            row.state.attempts[0].dns,
            DnsStep::DeleteIntent { host: host.clone() }
        );
        assert_eq!(row.state.attempts[0].resolution, Resolution::Open);
        assert_eq!(
            h.counts().await.unresolved,
            1,
            "the unresolved cleanup stays discoverable"
        );
        assert_eq!(h.fake.release_all(), 1); // A now believes the hostname verified
    });
    assert!(
        unavailable(&res),
        "A was fenced out instead of publishing: {res:?}"
    );
    let row = h.row(id).await;
    assert_eq!(
        row.phase,
        Phase::Active,
        "A's dns_verified/offer writes were refused"
    );
    assert!(row.state.offer.is_none());
    assert_eq!(
        row.state.attempts[0].dns,
        DnsStep::DeleteIntent { host: host.clone() }
    );
    assert_eq!(h.counts().await.offered, 0);
    // The next pass completes the cleanup.
    h.wait_reapable(id).await;
    assert_eq!(b.reap_abandoned().await, 1);
    let row = h.row(id).await;
    assert_eq!(
        (row.phase, row.state.attempts[0].resolution),
        (Phase::Finished, Resolution::CleanedUp)
    );
    assert!(row.state.offer.is_none());
    h.assert_no_orphans();
    h.finish().await;
}

/// A start that the provider accepts only after earlier `describe`s said NotFound: A's three start calls are held, A gives
/// up (the outcome of each is unknown), B looks twice and finds nothing, then the provider applies the old start.
async fn ambiguous_start(settle_after: Duration) -> (H, String) {
    let h = H::new(fulfil()).await;
    let id = "delayE01".to_string();
    let key = pid(&id);
    let mut d = dur(300);
    d.start_settle_after = settle_after;
    let (a, b) = (
        h.worker(ZONE, 20_000, d.clone()).await,
        h.worker(ZONE, 20_000, d).await,
    );
    h.fake.start_accepted_later(Matcher::key(&key).times(3));
    let rq = request(&id, "alice");
    let res = a
        .place_scoped(&rh_placement::ledger::Scope::default(), &rq)
        .await;
    assert!(unavailable(&res), "{res:?}");
    assert_eq!(h.fake.held().len(), 3, "every start A sent is held");
    assert!(
        h.mine(&id, ZONE).is_empty(),
        "the provider has applied nothing yet"
    );
    let row = h.row(&id).await;
    assert!(matches!(
        row.state.attempts[0].start,
        StartStep::Intent { .. }
    ));
    h.wait_reapable(&id).await;
    for n in 1..=2u32 {
        let r = b.reap_abandoned().await;
        let row = h.row(&id).await;
        assert_eq!(row.state.attempts[0].not_found.count, n, "pass {n}");
        if settle_after > Duration::ZERO {
            assert_eq!(
                (r, row.phase, row.state.attempts[0].resolution),
                (0, Phase::Active, Resolution::Open),
                "a NotFound proves nothing"
            );
            assert_eq!(
                h.counts().await.unresolved,
                1,
                "the intent is never dropped"
            );
            h.wait_reapable(&id).await;
        }
    }
    // The provider now applies the old start (the first of the three; the others find the id taken).
    let applied = h.fake.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    assert_eq!(h.fake.release_all(), 3);
    bounded(applied.wait()).await;
    let t = h.mine(&id, ZONE);
    assert!(t.iter().any(|m| m.op == Op::Start && m.late), "{t:?}");
    drop((a, b));
    (h, id)
}

#[tokio::test]
async fn an_ambiguous_start_accepted_late_is_reconciled_and_never_offered() {
    let (h, id) = ambiguous_start(Duration::from_secs(3600)).await;
    let b = h.worker(ZONE, 20_000, dur(300)).await;
    h.wait_reapable(&id).await;
    assert_eq!(
        b.reap_abandoned().await,
        1,
        "the late placement is found by its stored binding and cleaned"
    );
    let row = h.row(&id).await;
    assert_eq!(row.phase, Phase::Finished);
    assert!(row.state.offer.is_none());
    assert!(matches!(
        row.state.attempts[0].resolution,
        Resolution::CleanedUp | Resolution::NoHost
    ));
    assert_eq!(h.counts().await.offered, 0);
    h.assert_no_orphans();
    let ops = h.ops(&id, ZONE);
    assert_eq!(ops[0], Op::Start);
    assert!(
        ops[1..]
            .iter()
            .all(|o| matches!(o, Op::Stop | Op::DnsDelete | Op::Terminate)),
        "{ops:?}"
    );
    h.finish().await;
}

/// Coordinator contract regression: elapsed time and repeated absence cannot prove an already-sent start is canceled.
#[tokio::test]
async fn late_start_intent_stays_reapable_until_definitive_provider_evidence() {
    let (h, id) = ambiguous_start(Duration::ZERO).await;
    let row = h.row(&id).await;
    assert_eq!(
        (row.phase, row.state.attempts[0].resolution),
        (Phase::Active, Resolution::Open),
        "an ambiguous start must remain tracked even after any configured settling interval"
    );
    assert_eq!(h.counts().await.unresolved, 1);
    let b = h.worker(ZONE, 20_000, dur(300)).await;
    h.wait_reapable(&id).await;
    assert_eq!(b.reap_abandoned().await, 1);
    let row = h.row(&id).await;
    assert_eq!(row.phase, Phase::Finished);
    assert!(row.state.offer.is_none());
    h.assert_no_orphans();
    h.finish().await;
}

/// Coordinator contract regression: an already-sent upsert can arrive after the replacement worker deleted the name.
#[tokio::test]
async fn late_dns_upsert_keeps_recovery_discoverable_until_the_name_is_cleaned() {
    let h = H::new(fulfil()).await;
    let (a, b) = (
        h.worker(ZONE, 20_000, dur(20_000)).await,
        h.worker(ZONE, 20_000, dur(20_000)).await,
    );
    let id = "delayF01";
    let host = host_of(id, ZONE);
    h.fake.hold_effect(Op::DnsUpsert, Matcher::key(&host));
    let held = h
        .fake
        .notify_on(Op::DnsUpsert, Matcher::key(&host), Stage::Arrived);
    let rq = request(id, "alice");
    let scope = rh_placement::ledger::Scope::default();
    let (res, ()) = tokio::join!(a.place_scoped(&scope, &rq), async {
        bounded(held.wait()).await;
        assert!(matches!(
            h.row(id).await.state.attempts[0].dns,
            DnsStep::Intent { .. }
        ));
        h.wait_reapable(id).await;
        b.reap_abandoned().await;
        let applied = h
            .fake
            .notify_on(Op::DnsUpsert, Matcher::key(&host), Stage::Applied);
        assert_eq!(h.fake.release_all(), 1);
        bounded(applied.wait()).await;
    });
    assert!(unavailable(&res), "{res:?}");
    let row = h.row(id).await;
    assert!(row.state.offer.is_none());
    assert!(h
        .mine(id, ZONE)
        .iter()
        .any(|m| m.op == Op::DnsUpsert && m.late));
    assert!(
        !h.fake.dns().contains_key(&host)
            || (row.phase == Phase::Active && row.state.attempts[0].resolution == Resolution::Open),
        "late DNS remains outside recovery: phase={:?}, resolution={:?}, trace={:?}",
        row.phase,
        row.state.attempts[0].resolution,
        h.mine(id, ZONE)
    );
    h.wait_reapable(id).await;
    b.reap_abandoned().await;
    h.assert_no_orphans();
    h.finish().await;
}

/// Independent repair regression: a successful retry acknowledges only itself. Three unknown
/// sends also remain three potential late effects; neither restart, deletion nor purge drains them.
#[tokio::test]
async fn ambiguous_dns_retries_survive_restarts_age_and_purge_in_the_original_zone() {
    use rh_placement::ledger::DnsUpsert;
    for held_count in [1, 3] {
        let h = H::new(fulfil()).await;
        let id = if held_count == 1 {
            "reviewG1"
        } else {
            "reviewG3"
        };
        let host = host_of(id, ZONE);
        let mut d = dur(150);
        d.retention = Duration::ZERO;
        h.fake
            .hold_effect(Op::DnsUpsert, Matcher::key(&host).times(held_count));
        let a = h.worker(ZONE, 20_000, d.clone()).await;
        let result = a.place(&request(id, "alice")).await;
        assert!(
            unavailable(&result),
            "an ambiguous earlier send forbids publication: {result:?}"
        );
        assert_eq!(h.fake.held().len(), held_count);
        assert_eq!(
            h.row(id).await.state.attempts[0].dns_upsert,
            DnsUpsert::Ambiguous
        );
        assert!(h.row(id).await.state.offer.is_none());
        drop(a);
        // Arbitrarily old persistence metadata must not turn missing evidence into certainty.
        sqlx::query("UPDATE rh_placement_requests SET created_at = clock_timestamp() - interval '100 years', updated_at = clock_timestamp() - interval '100 years', finished_at = clock_timestamp() - interval '100 years' WHERE request_id = $1")
            .bind(id).execute(h.ledger.pool()).await.unwrap();
        for _ in 0..3 {
            let b = h.worker("changed.example.com", 20_000, d.clone()).await;
            assert_eq!(b.reap_abandoned().await, 0);
            assert_eq!(b.purge_retained().await.unwrap(), 0);
            let row = h.row(id).await;
            assert_eq!(
                (row.phase, row.state.attempts[0].resolution),
                (Phase::Active, Resolution::Open)
            );
            assert_eq!(row.state.attempts[0].dns_upsert, DnsUpsert::Ambiguous);
            assert_eq!(h.counts().await.unresolved, 1);
            drop(b);
        }
        // Apply each held send after a prior successful deletion, then restart and reconcile it.
        for held in h.fake.held() {
            let applied = h
                .fake
                .notify_on(Op::DnsUpsert, Matcher::key(&host), Stage::Applied);
            assert!(h.fake.release_held(held.id));
            bounded(applied.wait()).await;
            assert!(h.fake.dns().contains_key(&host));
            let b = h.worker("changed.example.com", 20_000, d.clone()).await;
            assert_eq!(b.reap_abandoned().await, 0);
            assert!(!h.fake.dns().contains_key(&host));
            assert_eq!(b.purge_retained().await.unwrap(), 0);
            assert_eq!(
                h.row(id).await.state.attempts[0].dns_upsert,
                DnsUpsert::Ambiguous
            );
        }
        assert!(h.fake.trace_of(Op::DnsDelete).iter().all(|m| m.key == host));
        assert_eq!(h.counts().await.offered, 0);
        h.assert_no_orphans();
        h.finish().await;
    }
}

#[tokio::test]
async fn held_start_survives_a_century_of_age_restarts_repeated_absence_and_purge() {
    let h = H::new(fulfil()).await;
    let id = "reviewH1";
    let mut d = dur(150);
    d.start_settle_after = Duration::ZERO;
    d.retention = Duration::ZERO;
    h.fake.start_accepted_later(Matcher::key(&pid(id)).times(3));
    let a = h.worker(ZONE, 20_000, d.clone()).await;
    assert!(unavailable(&a.place(&request(id, "alice")).await));
    drop(a);
    sqlx::query("UPDATE rh_placement_requests SET state = jsonb_set(state, '{attempts,0,start,at_ms}', '-3000000000000'), created_at = clock_timestamp() - interval '100 years', finished_at = clock_timestamp() - interval '100 years' WHERE request_id = $1")
        .bind(id).execute(h.ledger.pool()).await.unwrap();
    for n in 1..=4 {
        let b = h.worker("changed.example.com", 20_000, d.clone()).await;
        assert_eq!(b.reap_abandoned().await, 0);
        assert_eq!(b.purge_retained().await.unwrap(), 0);
        let row = h.row(id).await;
        assert_eq!(
            (row.phase, row.state.attempts[0].resolution),
            (Phase::Active, Resolution::Open)
        );
        assert_eq!(row.state.attempts[0].not_found.count, n);
        assert_eq!(h.counts().await.unresolved, 1);
    }
    let applied = h.fake.notify_on(Op::Start, Matcher::any(), Stage::Applied);
    assert_eq!(h.fake.release_all(), 3);
    bounded(applied.wait()).await;
    let b = h.worker("changed.example.com", 20_000, d).await;
    assert_eq!(b.reap_abandoned().await, 1);
    assert_eq!(h.row(id).await.phase, Phase::Finished);
    assert!(h.row(id).await.state.offer.is_none());
    h.assert_no_orphans();
    h.finish().await;
}
