//! Service-level durability tests through the REAL `PlacementService` methods (`place_scoped`, `reap_abandoned`,
//! `release_session`) with the crate's fakes, over a shared ledger. The same bodies run against the memory store (paused
//! clock) and PostgreSQL (`--features postgres`, real time, `DATABASE_URL` required). "Restart" is a second service object
//! over the same ledger and backends; process-level kills are the crash harness's job.
//!
//! Ordering is deterministic: barriers (`Gate`), ledger wrappers that fail or commit-then-fail a named write, and receipts
//! that are held after the provider applied the effect. Sleeps only wait for a lease or a budget to elapse.
mod ledger_support;

use ledger_support::wrappers::*;
use rh_placement::backend::{Fallback, GameLiftBackend, StartPlacement};
use rh_placement::fake::{Call, FakeDns, FakeGameLift, RegionBehaviour};
use rh_placement::ledger::{DnsStep, Ledger, Phase, Resolution, Scope, StartStep, StopStep};
use rh_placement::service::{
    DurabilityConfig, PlaceError, PlacementService, ReleaseError, ServiceConfig,
};
use rh_placement::{MemberReport, PlacementPolicy, PlacementRequest, RegionConfig};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

type Gl = Shared<Tamper<FakeGameLift>>;
type Dn = Shared<FlakyDns<FakeDns>>;
type Lg<L> = Shared<FaultLedger<Shared<L>>>;
type Svc<L> = PlacementService<Gl, Dn, Lg<L>>;

fn cfg() -> ServiceConfig {
    ServiceConfig {
        regions: vec![RegionConfig {
            id: "us-west-2".into(),
            label: "west".into(),
            probe_url: String::new(),
        }],
        policy: PlacementPolicy {
            poll_interval_ms: 5,
            ..PlacementPolicy::default()
        },
        queue_name: "rh-q".into(),
        zone: "g.rougehalla.com".into(),
        max_players: 8,
    }
}

fn dur() -> DurabilityConfig {
    DurabilityConfig {
        worker_lease: Duration::from_secs(1),
        ..DurabilityConfig::default()
    }
}

fn req(id: &str) -> PlacementRequest {
    PlacementRequest {
        request_id: id.into(),
        party: vec![MemberReport {
            callsign: "alice".into(),
            age_s: 0,
            rtt_ms: BTreeMap::from([("us-west-2".into(), Some(30))]),
        }],
        region_override: None,
    }
}

fn fulfil() -> RegionBehaviour {
    RegionBehaviour::Fulfil {
        after_polls: 1,
        ip: "203.0.113.1".into(),
        port: 35010,
    }
}

struct World<L: Ledger> {
    raw: Shared<L>,
    fl: Arc<FaultLedger<Shared<L>>>,
    gl: Gl,
    dns: Dn,
}

impl<L: Ledger + 'static> World<L> {
    fn new(raw: Shared<L>, behaviour: RegionBehaviour) -> Self {
        World {
            fl: Arc::new(FaultLedger::new(raw.clone())),
            raw,
            gl: Shared::new(Tamper::new(FakeGameLift::new(&[("us-west-2", behaviour)]))),
            dns: Shared::new(FlakyDns::new(FakeDns::new())),
        }
    }
    async fn svc(&self, nonce: u8) -> Svc<L> {
        self.svc_with(nonce, cfg(), dur()).await
    }
    async fn svc_with(&self, nonce: u8, cfg: ServiceConfig, d: DurabilityConfig) -> Svc<L> {
        PlacementService::with_ledger(
            [nonce; 32],
            cfg,
            self.gl.clone(),
            self.dns.clone(),
            Shared(self.fl.clone()),
            d,
        )
        .await
        .unwrap()
    }
    fn calls(&self) -> usize {
        self.gl.inner.calls().len() + self.dns.inner.log().len()
    }
    /// Stops and terminations sent to the provider.
    fn mutations(&self) -> usize {
        self.gl
            .inner
            .calls()
            .iter()
            .filter(|c| matches!(c, Call::Stop(_) | Call::Terminate(_)))
            .count()
    }
    fn deletes(&self) -> Vec<String> {
        self.dns
            .inner
            .log()
            .into_iter()
            .filter_map(|l| l.strip_prefix("delete ").map(str::to_string))
            .collect()
    }
    async fn row(&self, id: &str) -> rh_placement::ledger::Record {
        self.raw.get(id).await.unwrap().unwrap()
    }
}

/// Run `place` until the provider has applied the start and the receipt is held, then drop the future (a crash that lost the
/// receipt), and wait out the worker's lease.
async fn abandon_after_start<L: Ledger + 'static>(w: &World<L>, s: &Svc<L>, id: &str) {
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_receipt.lock().unwrap() = Some(gate.clone());
    {
        let rq = req(id);
        let fut = s.place(&rq);
        tokio::pin!(fut);
        tokio::select! {
            r = &mut fut => panic!("place finished early: {r:?}"),
            _ = gate.arrived.notified() => {}
        }
    }
    tokio::time::sleep(s.durability.worker_lease * 2).await;
}

// ---- restart, identity, scope ----

async fn restart_recovers_a_committed_offer_and_keeps_the_epoch<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s1 = w.svc(1).await;
    let offer = s1.place(&req("req00001")).await.unwrap();
    let before = w.calls();
    drop(s1);
    // A new process: another candidate nonce, the same ledger and provider.
    let s2 = w.svc(2).await;
    assert_eq!(
        w.raw.open_epoch([7; 32]).await.unwrap(),
        [1; 32],
        "the epoch stays the first one"
    );
    assert_eq!(
        s2.place(&req("req00001")).await.unwrap(),
        offer,
        "an identical retry replays the committed offer"
    );
    assert_eq!(w.calls(), before, "the replay makes no backend call at all");
    // Automatic recovery never touches an offered session, however long it has been.
    tokio::time::sleep(s2.durability.worker_lease * 3).await;
    assert_eq!(s2.reap_abandoned().await, 0);
    assert_eq!((w.mutations(), w.deletes().len()), (0, 0));
    assert_eq!(w.row("req00001").await.phase, Phase::Offered);
    assert_eq!(w.dns.inner.records().len(), 1);
}

async fn conflicting_retries_fail_before_any_backend_call<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let scope = Scope::new("account-a").unwrap();
    let offer = s.place_scoped(&scope, &req("req00002")).await.unwrap();
    let before = w.calls();
    let mut other = req("req00002");
    other.party[0].callsign = "mallory".into();
    assert!(matches!(
        s.place_scoped(&scope, &other).await,
        Err(PlaceError::Invalid(_))
    ));
    // Same request, another scope: the id is one ledger key and the scope is part of identity.
    let foreign = Scope::new("account-b").unwrap();
    assert!(matches!(
        s.place_scoped(&foreign, &req("req00002")).await,
        Err(PlaceError::Invalid(_))
    ));
    assert!(
        matches!(s.place(&req("req00002")).await, Err(PlaceError::Invalid(_))),
        "default scope is a scope too"
    );
    // Same request, changed configuration (another service instance).
    let mut c2 = cfg();
    c2.queue_name = "other-queue".into();
    let s2 = w.svc_with(2, c2, dur()).await;
    assert!(matches!(
        s2.place_scoped(&scope, &req("req00002")).await,
        Err(PlaceError::Invalid(_))
    ));
    assert_eq!(w.calls(), before, "no capacity read, no start, nothing");
    assert_eq!(
        s.place_scoped(&scope, &req("req00002")).await.unwrap(),
        offer
    );
    assert_eq!(w.calls(), before);
    // The stored identity is complete.
    let rec = w.row("req00002").await;
    assert_eq!(rec.identity.scope, "account-a");
    assert_eq!(rec.identity.zone, "g.rougehalla.com");
    assert!(
        rec.identity.request_json.contains("req00002") && rec.identity.config_json.contains("rh-q")
    );
}

async fn conflicting_retry_while_another_worker_is_in_progress_fails_before_effects<
    L: Ledger + 'static,
>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_effect.lock().unwrap() = Some(gate.clone());
    let rq = req("req00003");
    let first = s.place(&rq);
    let control = async {
        gate.arrived.notified().await;
        let calls = w.calls();
        let mut other = req("req00003");
        other.party[0].callsign = "mallory".into();
        assert!(matches!(s.place(&other).await, Err(PlaceError::Invalid(_))));
        assert!(matches!(
            s.place(&req("req00003")).await,
            Err(PlaceError::ServiceUnavailable(m)) if m.contains("in progress")
        ));
        assert_eq!(w.calls(), calls);
        gate.release.notify_one();
    };
    let (res, ()) = tokio::join!(first, control);
    res.unwrap();
}

async fn scope_is_part_of_identity<L: Ledger + 'static>(l: Shared<L>) {
    assert!(
        Scope::new("").is_err()
            && Scope::new("has space").is_err()
            && Scope::new("x".repeat(129)).is_err()
    );
    assert_eq!(Scope::default().as_str(), "default");
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let a = Scope::new("a").unwrap();
    let b = Scope::new("b").unwrap();
    s.place_scoped(&a, &req("req00004")).await.unwrap();
    s.place_scoped(&b, &req("req00005")).await.unwrap();
    assert_eq!(w.row("req00004").await.identity.scope, "a");
    assert_eq!(w.row("req00005").await.identity.scope, "b");
}

async fn with_ledger_refuses_records_without_an_epoch<L: Ledger + 'static>(l: Shared<L>) {
    use rh_placement::ledger::{Begin, Identity};
    let id = Identity {
        request_id: "orphan01".into(),
        scope: "s".into(),
        fingerprint: format!("{:0<64}", "f"),
        request_json: "{}".into(),
        config_json: "{}".into(),
        zone: "z.example.com".into(),
    };
    assert!(matches!(
        l.begin(&id, "w", Duration::from_secs(60)).await.unwrap(),
        Begin::Started(_)
    ));
    let r = PlacementService::with_ledger(
        [5; 32],
        cfg(),
        Shared::new(FakeGameLift::new(&[])),
        Shared::new(FakeDns::new()),
        l.clone(),
        dur(),
    )
    .await;
    assert!(
        matches!(r, Err(rh_placement::ledger::LedgerError::Corrupt(_))),
        "a new epoch is never minted over old records"
    );
}

// ---- DB outage and uncertain commit ----

async fn failed_offer_commit_is_not_turned_into_cleanup<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.offer_write.store(FAIL_BEFORE, Ordering::SeqCst);
    let e = s.place(&req("req00006")).await.unwrap_err();
    assert!(matches!(e, PlaceError::ServiceUnavailable(_)), "{e:?}");
    assert_eq!(
        w.fl.offer_writes.load(Ordering::SeqCst),
        3,
        "bounded retries of the unchanged write"
    );
    // The worker did NOT start cleanup because a write failed: the host and name are still there.
    assert_eq!((w.mutations(), w.deletes().len()), (0, 0));
    assert_eq!(w.dns.inner.records().len(), 1);
    let rec = w.row("req00006").await;
    assert_eq!(rec.phase, Phase::Active);
    assert!(rec.state.offer.is_none() && rec.state.attempts[0].is_open());
    // The row is the reaper's now, which cleans a never-offered host.
    w.fl.offer_write.store(PASS, Ordering::SeqCst);
    assert_eq!(s.reap_abandoned().await, 1);
    assert_eq!(
        (w.gl.inner.terminated().len(), w.dns.inner.records().len()),
        (1, 0)
    );
    assert_eq!(w.row("req00006").await.phase, Phase::Finished);
}

async fn uncertain_commit_that_landed_returns_the_offer_and_is_protected<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.offer_write.store(COMMIT_THEN_FAIL, Ordering::SeqCst);
    let offer = s
        .place(&req("req00007"))
        .await
        .expect("the commit landed: the stored outcome is the answer");
    assert_eq!(w.fl.offer_writes.load(Ordering::SeqCst), 1);
    let rec = w.row("req00007").await;
    assert_eq!(rec.phase, Phase::Offered);
    assert_eq!(
        rec.state.offer.as_ref().map(|o| o.hostname.clone()),
        Some(offer.hostname.clone())
    );
    assert_eq!(s.reap_abandoned().await, 0);
    assert_eq!((w.mutations(), w.deletes().len()), (0, 0));
    assert_eq!(s.place(&req("req00007")).await.unwrap(), offer);
}

async fn uncertain_commit_with_an_unreadable_database_stops_without_cleanup<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.offer_write.store(COMMIT_THEN_FAIL, Ordering::SeqCst);
    w.fl.get_down_after_commit.store(true, Ordering::SeqCst);
    let e = s.place(&req("req00008")).await.unwrap_err();
    assert!(matches!(e, PlaceError::ServiceUnavailable(_)), "{e:?}");
    // The commit landed but could not be confirmed. No cleanup was started on a guess.
    assert_eq!((w.mutations(), w.deletes().len()), (0, 0));
    w.fl.get_down.store(false, Ordering::SeqCst);
    w.fl.offer_write.store(PASS, Ordering::SeqCst);
    assert_eq!(w.row("req00008").await.phase, Phase::Offered);
    let s2 = w.svc(2).await;
    let offer = s2
        .place(&req("req00008"))
        .await
        .expect("an identical retry recovers the committed offer");
    assert!(offer.hostname.starts_with("us-west-2-"));
    assert_eq!(s2.reap_abandoned().await, 0);
    assert_eq!((w.mutations(), w.deletes().len()), (0, 0));
    assert_eq!(w.dns.inner.records().len(), 1);
}

async fn outage_before_the_first_write_makes_no_external_call<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.all_down.store(true, Ordering::SeqCst);
    assert!(matches!(
        s.place(&req("req00009")).await,
        Err(PlaceError::ServiceUnavailable(_))
    ));
    assert_eq!(
        w.calls(),
        0,
        "the ledger is written before any capacity read or start"
    );
    assert_eq!(s.reap_abandoned().await, 0);
}

// ---- receipts and cleanup ----

async fn missing_and_foreign_receipts_stay_unresolved_or_untouched<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let s = w.svc(1).await;
    // Missing ownership evidence: unresolved, nothing mutated, still discoverable.
    abandon_after_start(&w, &s, "req00010").await;
    assert_eq!(s.unresolved_count().await.unwrap(), 1);
    w.gl.tamper.store(T_MISSING, Ordering::SeqCst);
    assert_eq!(s.reap_abandoned().await, 0);
    assert_eq!(w.mutations(), 0);
    assert_eq!(
        s.unresolved_count().await.unwrap(),
        1,
        "kept for reconciliation"
    );
    assert!(w.row("req00010").await.state.attempts[0].is_open());
    // Evidence comes back: our own binding is cleaned up (stop), nothing else is.
    w.gl.tamper.store(T_NONE, Ordering::SeqCst);
    assert_eq!(s.reap_abandoned().await, 1);
    assert_eq!(w.row("req00010").await.phase, Phase::Finished);
    // A foreign binding / a foreign id is resolved without ever being mutated.
    for (i, mode) in [T_FOREIGN, T_WRONG_ID].into_iter().enumerate() {
        let id = format!("req0002{i}");
        abandon_after_start(&w, &s, &id).await;
        let before = w.mutations();
        w.gl.tamper.store(mode, Ordering::SeqCst);
        assert_eq!(s.reap_abandoned().await, 1);
        w.gl.tamper.store(T_NONE, Ordering::SeqCst);
        assert_eq!(
            w.mutations(),
            before,
            "foreign evidence never authorizes a stop or a termination"
        );
        assert!(w.deletes().is_empty());
        let a = &w.row(&id).await.state.attempts[0];
        assert_eq!(a.resolution, Resolution::Foreign);
        // The provider-side placement is still pending: nobody touched it.
        let st =
            w.gl.inner
                .describe_placement(&a.placement_id)
                .await
                .unwrap();
        assert_eq!(st.status, rh_placement::backend::PlacementStatus::Pending);
    }
}

async fn lost_receipt_is_recovered_by_the_reaper_with_the_stored_binding<L: Ledger + 'static>(
    l: Shared<L>,
) {
    // The provider accepted the start; the receipt was lost with the process.
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    abandon_after_start(&w, &s, "req00011").await;
    let rec = w.row("req00011").await;
    assert!(
        matches!(rec.state.attempts[0].start, StartStep::Intent { .. }),
        "only the intent was durable"
    );
    // Fulfilment arrives while nobody waits.
    for _ in 0..3 {
        let _ = w.gl.inner.describe_placement("rh-req00011-1").await;
    }
    // A restarted service (another nonce) still reconciles by the STORED binding.
    let s2 = w.svc(2).await;
    assert_eq!(s2.reap_abandoned().await, 1);
    assert_eq!(w.gl.inner.terminated().len(), 1);
    assert_eq!(
        w.row("req00011").await.state.attempts[0].resolution,
        Resolution::CleanedUp
    );
}

async fn cleanup_effect_failure_keeps_the_attempt_unresolved<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.offer_write.store(FAIL_BEFORE, Ordering::SeqCst);
    assert!(s.place(&req("req00012")).await.is_err());
    w.fl.offer_write.store(PASS, Ordering::SeqCst);
    // The first cleanup's DNS delete fails: completion must NOT be recorded.
    w.dns.fail_deletes.store(1, Ordering::SeqCst);
    assert_eq!(s.reap_abandoned().await, 0);
    let rec = w.row("req00012").await;
    assert_eq!(rec.phase, Phase::Active);
    assert!(
        rec.state.attempts[0].is_open(),
        "an unconfirmed effect is not done"
    );
    assert!(
        matches!(rec.state.attempts[0].dns, DnsStep::DeleteIntent { .. }),
        "the intent survives"
    );
    assert_eq!(w.dns.inner.records().len(), 1);
    assert!(w.gl.inner.terminated().is_empty());
    // The retry performs the effects and only then records completion.
    assert_eq!(s.reap_abandoned().await, 1);
    assert_eq!(
        (w.dns.inner.records().len(), w.gl.inner.terminated().len()),
        (0, 1)
    );
    assert_eq!(
        w.row("req00012").await.state.attempts[0].resolution,
        Resolution::CleanedUp
    );
}

async fn original_zone_is_used_after_the_configured_zone_changes<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    w.fl.offer_write.store(FAIL_BEFORE, Ordering::SeqCst);
    assert!(s.place(&req("req00013")).await.is_err());
    w.fl.offer_write.store(PASS, Ordering::SeqCst);
    let host = w.dns.inner.records().keys().next().cloned().unwrap();
    assert!(host.ends_with(".g.rougehalla.com"));
    // The configured zone changed before the restart.
    let mut moved = cfg();
    moved.zone = "g2.example.net".into();
    let s2 = w.svc_with(2, moved, dur()).await;
    assert_eq!(s2.reap_abandoned().await, 1);
    assert_eq!(
        w.deletes(),
        [host],
        "the host in the ORIGINAL zone is deleted, no other name is touched"
    );
    assert!(w.dns.inner.records().is_empty());
    assert_eq!(w.row("req00013").await.identity.zone, "g.rougehalla.com");
}

// ---- stale workers and ambiguous starts ----

async fn stale_worker_cannot_complete_after_takeover<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let s = w.svc(1).await;
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_receipt.lock().unwrap() = Some(gate.clone());
    let rq = req("req00014");
    let worker = s.place(&rq);
    let control = async {
        gate.arrived.notified().await; // the provider applied the start; the worker holds the receipt
        tokio::time::sleep(s.durability.worker_lease * 3).await; // its lease runs out
        let n = s.reap_abandoned().await; // another instance takes over and finishes the row
        gate.release.notify_one();
        n
    };
    let (res, reaped) = tokio::join!(worker, control);
    assert_eq!(reaped, 1);
    assert!(
        matches!(res, Err(PlaceError::ServiceUnavailable(_))),
        "{res:?}"
    );
    let rec = w.row("req00014").await;
    assert_eq!((rec.phase, rec.fence), (Phase::Finished, 2));
    assert!(rec.state.offer.is_none());
    assert!(
        matches!(rec.state.attempts[0].start, StartStep::Intent { .. }),
        "the stale worker's acceptance was fenced out"
    );
    assert_eq!(rec.state.attempts[0].resolution, Resolution::NoHost);
}

async fn stale_worker_cannot_overwrite_a_takeover_that_left_work_unresolved<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let s = w.svc(1).await;
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_receipt.lock().unwrap() = Some(gate.clone());
    let rq = req("req00040");
    let worker = s.place(&rq);
    let control = async {
        gate.arrived.notified().await;
        tokio::time::sleep(s.durability.worker_lease * 3).await;
        // The takeover cannot prove ownership (receipts lack metadata): it leaves the row ACTIVE and unresolved.
        w.gl.tamper.store(T_MISSING, Ordering::SeqCst);
        let n = s.reap_abandoned().await;
        w.gl.tamper.store(T_NONE, Ordering::SeqCst);
        gate.release.notify_one();
        n
    };
    let (res, reaped) = tokio::join!(worker, control);
    assert_eq!(reaped, 0);
    assert!(
        matches!(res, Err(PlaceError::ServiceUnavailable(_))),
        "{res:?}"
    );
    let rec = w.row("req00040").await;
    assert_eq!((rec.phase, rec.fence), (Phase::Active, 2));
    assert!(
        matches!(rec.state.attempts[0].start, StartStep::Intent { .. }),
        "a stale acceptance must not overwrite the takeover's row"
    );
    assert_eq!(
        s.unresolved_count().await.unwrap(),
        1,
        "the work stays discoverable"
    );
}

async fn start_that_was_never_seen_is_not_settled_by_one_not_found<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let s = w.svc(1).await;
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_effect.lock().unwrap() = Some(gate.clone());
    {
        let rq = req("req00015");
        let fut = s.place(&rq);
        tokio::pin!(fut);
        tokio::select! {
            r = &mut fut => panic!("{r:?}"),
            _ = gate.arrived.notified() => {} // the intent is durable, the provider has not seen the start
        }
    }
    tokio::time::sleep(s.durability.worker_lease * 2).await;
    // One NotFound, then a second one: still not settled (the start was sent moments ago; it can still be accepted).
    assert_eq!(s.reap_abandoned().await, 0);
    assert_eq!(s.reap_abandoned().await, 0);
    let rec = w.row("req00015").await;
    assert_eq!(rec.state.attempts[0].not_found.count, 2);
    assert!(rec.state.attempts[0].is_open() && rec.phase == Phase::Active);
    // The delayed start is accepted AFTER both NotFounds. The intent was never dropped, so the reaper finds and stops it.
    let a = &rec.state.attempts[0];
    w.gl.inner
        .start_placement(&StartPlacement {
            placement_id: a.placement_id.clone(),
            queue_name: "rh-q".into(),
            max_player_sessions: 8,
            players: vec!["alice".into()],
            game_session_data: a.binding.clone(),
            location_order: a.locations.clone(),
            fallback: Fallback::None,
        })
        .await
        .unwrap();
    assert_eq!(s.reap_abandoned().await, 1);
    assert!(w
        .gl
        .inner
        .calls()
        .contains(&Call::Stop("rh-req00015-1".into())));
    let rec = w.row("req00015").await;
    assert_eq!(
        (rec.phase, rec.state.attempts[0].stop),
        (Phase::Finished, StopStep::Resolved)
    );
}

async fn two_not_found_answers_long_after_the_start_settle_it<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let d = DurabilityConfig {
        start_settle_after: Duration::ZERO,
        ..dur()
    };
    let s = w.svc_with(1, cfg(), d).await;
    let gate = Arc::new(Gate::default());
    *w.gl.hold_start_effect.lock().unwrap() = Some(gate.clone());
    {
        let rq = req("req00016");
        let fut = s.place(&rq);
        tokio::pin!(fut);
        tokio::select! {
            r = &mut fut => panic!("{r:?}"),
            _ = gate.arrived.notified() => {}
        }
    }
    tokio::time::sleep(s.durability.worker_lease * 2).await;
    assert_eq!(s.reap_abandoned().await, 0, "one NotFound proves nothing");
    assert_eq!(s.reap_abandoned().await, 1);
    let rec = w.row("req00016").await;
    assert_eq!(
        (rec.phase, rec.state.attempts[0].resolution),
        (Phase::Finished, Resolution::Settled)
    );
}

// ---- explicit release ----

async fn release_session_is_bound_to_scope_request_and_placement<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let scope = Scope::new("account-a").unwrap();
    let offer = s.place_scoped(&scope, &req("req00017")).await.unwrap();
    let pid = offer.placement_id.clone();
    // Wrong scope, wrong request, wrong placement: refused, and no DNS call is made.
    assert_eq!(
        s.release_session(&Scope::new("account-b").unwrap(), "req00017", &pid)
            .await,
        Err(ReleaseError::Unknown)
    );
    assert_eq!(
        s.release_session(&scope, "req99999", &pid).await,
        Err(ReleaseError::Unknown)
    );
    assert_eq!(
        s.release_session(&scope, "req00017", "rh-req00017-2").await,
        Err(ReleaseError::WrongPlacement)
    );
    assert_eq!(
        s.release_session(&scope, "req00017", "").await,
        Err(ReleaseError::WrongPlacement)
    );
    assert!(w.deletes().is_empty());
    assert_eq!(w.dns.inner.records().len(), 1);
    assert_eq!(w.row("req00017").await.phase, Phase::Offered);
    // Authorized.
    s.release_session(&scope, "req00017", &pid).await.unwrap();
    assert!(w.dns.inner.records().is_empty());
    assert_eq!(w.deletes(), std::slice::from_ref(&offer.hostname));
    let rec = w.row("req00017").await;
    assert_eq!(rec.phase, Phase::Released);
    let rel = rec.state.release.unwrap();
    assert!(rel.done_at_ms.is_some());
    // Duplicate: Ok, and no further DNS call.
    s.release_session(&scope, "req00017", &pid).await.unwrap();
    assert_eq!(w.deletes().len(), 1);
    // A released identity never replays its dead join URL.
    assert_eq!(
        s.place_scoped(&scope, &req("req00017")).await,
        Err(PlaceError::RequestIdReused)
    );
    let s2 = w.svc(2).await;
    assert_eq!(
        s2.place_scoped(&scope, &req("req00017")).await,
        Err(PlaceError::RequestIdReused)
    );
    assert_eq!(s2.reap_abandoned().await, 0);
}

async fn release_of_a_request_without_an_offer_is_refused<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, RegionBehaviour::NoHost);
    let s = w.svc(1).await;
    abandon_after_start(&w, &s, "req00018").await;
    let scope = Scope::default();
    assert_eq!(
        s.release_session(&scope, "req00018", "rh-req00018-1").await,
        Err(ReleaseError::NotOffered)
    );
    assert!(w.deletes().is_empty());
    assert_eq!(s.reap_abandoned().await, 1);
    assert_eq!(
        s.release_session(&scope, "req00018", "rh-req00018-1").await,
        Err(ReleaseError::NotOffered)
    );
    assert!(w.deletes().is_empty());
}

async fn release_uses_the_original_zone<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let offer = s.place(&req("req00019")).await.unwrap();
    let mut moved = cfg();
    moved.zone = "g2.example.net".into();
    let s2 = w.svc_with(2, moved, dur()).await;
    s2.release_session(&Scope::default(), "req00019", &offer.placement_id)
        .await
        .unwrap();
    assert_eq!(w.deletes(), [offer.hostname]);
    assert!(w.deletes()[0].ends_with(".g.rougehalla.com"));
}

async fn a_half_done_release_is_resumed_by_retry_and_by_the_reaper<L: Ledger + 'static>(
    l: Shared<L>,
) {
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    let scope = Scope::default();
    let a = s.place(&req("req00022")).await.unwrap();
    let b = s.place(&req("req00023")).await.unwrap();
    // DNS delete fails once: the release intent is durable, the row is `releasing`, the error is retryable.
    w.dns.fail_deletes.store(1, Ordering::SeqCst);
    assert!(matches!(
        s.release_session(&scope, "req00022", &a.placement_id).await,
        Err(ReleaseError::Unavailable(_))
    ));
    let rec = w.row("req00022").await;
    assert_eq!(rec.phase, Phase::Releasing);
    assert!(rec.state.release.is_some_and(|r| r.done_at_ms.is_none()));
    assert_eq!(w.dns.inner.records().len(), 2);
    // A replayed offer is not offered for a releasing session.
    assert_eq!(
        s.place(&req("req00022")).await,
        Err(PlaceError::RequestIdReused)
    );
    // The reaper completes the recorded release (and only that: the other offer is untouched).
    assert_eq!(s.reap_abandoned().await, 1);
    assert_eq!(w.row("req00022").await.phase, Phase::Released);
    assert_eq!(w.row("req00023").await.phase, Phase::Offered);
    assert_eq!(
        w.dns.inner.records().keys().cloned().collect::<Vec<_>>(),
        std::slice::from_ref(&b.hostname)
    );
    // A retry on a releasing row resumes it too.
    w.dns.fail_deletes.store(1, Ordering::SeqCst);
    assert!(s
        .release_session(&scope, "req00023", &b.placement_id)
        .await
        .is_err());
    s.release_session(&scope, "req00023", &b.placement_id)
        .await
        .unwrap();
    assert!(w.dns.inner.records().is_empty());
    assert_eq!(w.row("req00023").await.phase, Phase::Released);
}

async fn retention_purge_keeps_tombstones_that_never_replay<L: Ledger + 'static>(l: Shared<L>) {
    let w = World::new(l, fulfil());
    let d = DurabilityConfig {
        retention: Duration::from_millis(50),
        ..dur()
    };
    let s = w.svc_with(1, cfg(), d).await;
    let scope = Scope::default();
    let offer = s.place(&req("req00024")).await.unwrap();
    let kept = s.place(&req("req00025")).await.unwrap();
    s.release_session(&scope, "req00024", &offer.placement_id)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        s.purge_retained().await.unwrap(),
        1,
        "only the released row; the offered one is never purged"
    );
    let rec = w.row("req00024").await;
    assert_eq!(
        (rec.phase, rec.final_phase),
        (Phase::Tombstone, Some(Phase::Released))
    );
    assert_eq!(
        s.place(&req("req00024")).await,
        Err(PlaceError::RequestIdReused)
    );
    assert!(matches!(
        s.place_scoped(&Scope::new("x").unwrap(), &req("req00024"))
            .await,
        Err(PlaceError::Invalid(_))
    ));
    s.release_session(&scope, "req00024", &offer.placement_id)
        .await
        .unwrap(); // duplicate after purge: still Ok
    assert_eq!(s.place(&req("req00025")).await.unwrap(), kept);
}

// ---- negative-control scenarios: they pass unchanged and fail under the matching mutant ----

async fn every_effect_is_preceded_by_its_committed_intent<L: Ledger + 'static>(l: Shared<L>) {
    // Publication fails -> inline cleanup: start, dns upsert, dns delete and terminate are all sent.
    let ledger = Arc::new(l);
    let gl = Probe::new(
        FakeGameLift::new(&[("us-west-2", fulfil())]),
        ledger.clone(),
    );
    let dns = Probe::new(FakeDns::new().failing_upserts(1000), ledger.clone());
    let s = PlacementService::with_ledger(
        [1; 32],
        cfg(),
        Shared::new(gl),
        Shared::new(dns),
        Shared(ledger.clone()),
        dur(),
    )
    .await
    .unwrap();
    let e = s.place(&req("probe001")).await.unwrap_err();
    assert_eq!(e, PlaceError::DnsUnavailable);
    let mut seen = s.gamelift.effects();
    seen.extend(s.dns.effects());
    for kind in ["start", "upsert", "delete", "terminate"] {
        assert!(
            seen.iter().any(|(k, _)| k == kind),
            "{kind} was not exercised: {seen:?}"
        );
    }
    let bad: Vec<_> = seen.iter().filter(|(_, ok)| !ok).collect();
    assert!(
        bad.is_empty(),
        "effects sent before their intent was committed: {bad:?}"
    );
}

async fn a_stop_is_preceded_by_its_committed_intent<L: Ledger + 'static>(l: Shared<L>) {
    let ledger = Arc::new(l);
    let gl = Probe::new(
        FakeGameLift::new(&[("us-west-2", RegionBehaviour::NoHost)]),
        ledger.clone(),
    );
    let mut c = cfg();
    c.policy.attempt_timeout_ms = 1_000;
    c.policy.total_budget_ms = 1_000;
    let s = PlacementService::with_ledger(
        [1; 32],
        c,
        Shared::new(gl),
        Shared::new(FakeDns::new()),
        Shared(ledger.clone()),
        dur(),
    )
    .await
    .unwrap();
    assert!(matches!(
        s.place(&req("probe001")).await,
        Err(PlaceError::NoCapacity { .. })
    ));
    let seen = s.gamelift.effects();
    assert!(seen.iter().any(|(k, _)| k == "stop"), "{seen:?}");
    assert!(seen.iter().all(|(_, ok)| *ok), "{seen:?}");
}

async fn foreign_receipts_never_authorize_cleanup<L: Ledger + 'static>(l: Shared<L>) {
    // A fulfilled placement whose receipts carry someone else's binding: the reaper must not terminate it or touch DNS.
    let w = World::new(l, fulfil());
    let s = w.svc(1).await;
    abandon_after_start(&w, &s, "req00026").await;
    for _ in 0..3 {
        let _ = w.gl.inner.describe_placement("rh-req00026-1").await;
    }
    w.gl.tamper.store(T_FOREIGN, Ordering::SeqCst);
    assert_eq!(s.reap_abandoned().await, 1);
    assert!(
        w.gl.inner.terminated().is_empty(),
        "a foreign session was terminated"
    );
    assert!(w.deletes().is_empty());
    assert_eq!(w.mutations(), 0);
}

macro_rules! cases {
    ($attr:meta, $setup:path, $teardown:path; $($case:ident),+ $(,)?) => {
        $(
            #[$attr]
            async fn $case() {
                let (l, h) = $setup().await;
                super::$case(l.clone()).await;
                $teardown(l, h).await;
            }
        )+
    };
}

macro_rules! all_cases {
    ($attr:meta, $setup:path, $teardown:path) => {
        cases!($attr, $setup, $teardown;
            restart_recovers_a_committed_offer_and_keeps_the_epoch,
            conflicting_retries_fail_before_any_backend_call,
            conflicting_retry_while_another_worker_is_in_progress_fails_before_effects,
            scope_is_part_of_identity,
            with_ledger_refuses_records_without_an_epoch,
            failed_offer_commit_is_not_turned_into_cleanup,
            uncertain_commit_that_landed_returns_the_offer_and_is_protected,
            uncertain_commit_with_an_unreadable_database_stops_without_cleanup,
            outage_before_the_first_write_makes_no_external_call,
            missing_and_foreign_receipts_stay_unresolved_or_untouched,
            lost_receipt_is_recovered_by_the_reaper_with_the_stored_binding,
            cleanup_effect_failure_keeps_the_attempt_unresolved,
            original_zone_is_used_after_the_configured_zone_changes,
            stale_worker_cannot_complete_after_takeover,
            stale_worker_cannot_overwrite_a_takeover_that_left_work_unresolved,
            start_that_was_never_seen_is_not_settled_by_one_not_found,
            two_not_found_answers_long_after_the_start_settle_it,
            release_session_is_bound_to_scope_request_and_placement,
            release_of_a_request_without_an_offer_is_refused,
            release_uses_the_original_zone,
            a_half_done_release_is_resumed_by_retry_and_by_the_reaper,
            retention_purge_keeps_tombstones_that_never_replay,
            every_effect_is_preceded_by_its_committed_intent,
            a_stop_is_preceded_by_its_committed_intent,
            foreign_receipts_never_authorize_cleanup,
        );
    };
}

mod memory {
    use super::Shared;
    use rh_placement::ledger::memory::MemoryLedger;
    async fn setup() -> (Shared<MemoryLedger>, ()) {
        (Shared::new(MemoryLedger::new()), ())
    }
    async fn teardown(_: Shared<MemoryLedger>, _: ()) {}
    all_cases!(tokio::test(start_paused = true), setup, teardown);

    /// A slow attempt keeps its claim by renewing the lease: a reaper running alongside never takes it.
    #[tokio::test(start_paused = true)]
    async fn lease_renewal_keeps_a_slow_attempt_claimed() {
        use super::*;
        let w = World::new(
            Shared::new(MemoryLedger::new()),
            RegionBehaviour::Fulfil {
                after_polls: 12,
                ip: "203.0.113.1".into(),
                port: 35010,
            },
        );
        let mut c = cfg();
        c.policy.poll_interval_ms = 1_000;
        let d = DurabilityConfig {
            worker_lease: Duration::from_secs(3),
            ..dur()
        };
        let s = w.svc_with(1, c, d).await;
        let rq = req("req00030");
        let worker = s.place(&rq);
        let control = async {
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                assert_eq!(s.reap_abandoned().await, 0);
                assert_eq!(w.mutations(), 0);
            }
        };
        let (res, ()) = tokio::join!(worker, control);
        assert!(res.is_ok(), "{res:?}");
    }

    /// Dropping the future frees the claim at once on the memory store; the reaper then owns the work.
    #[tokio::test(start_paused = true)]
    async fn dropped_place_is_immediately_reapable_in_memory() {
        use super::*;
        let w = World::new(Shared::new(MemoryLedger::new()), RegionBehaviour::NoHost);
        let s = w.svc(1).await;
        let gate = Arc::new(Gate::default());
        *w.gl.hold_start_receipt.lock().unwrap() = Some(gate.clone());
        {
            let rq = req("req00031");
            let fut = s.place(&rq);
            tokio::pin!(fut);
            tokio::select! { _ = &mut fut => panic!(), _ = gate.arrived.notified() => {} }
        }
        assert_eq!(s.unresolved_count().await.unwrap(), 1);
        assert_eq!(s.reap_abandoned().await, 1);
    }
}

#[cfg(feature = "postgres")]
mod postgres {
    use super::ledger_support::pg::TestDb;
    use super::Shared;
    use rh_placement::ledger::postgres::PgLedger;
    async fn setup() -> (Shared<PgLedger>, TestDb) {
        let db = TestDb::create().await;
        let l = db.ledger().await;
        (Shared::new(l), db)
    }
    async fn teardown(l: Shared<PgLedger>, db: TestDb) {
        l.pool().close().await;
        db.drop_db().await;
    }
    all_cases!(
        tokio::test(flavor = "multi_thread", worker_threads = 4),
        setup,
        teardown
    );
}
