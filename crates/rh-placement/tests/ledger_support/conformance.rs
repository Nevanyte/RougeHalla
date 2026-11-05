//! Conformance cases for `Ledger`. Every body takes two handles onto the SAME data: `fx.a` and `fx.b` (PostgreSQL: two
//! independent pools; memory: one store). Expiry waits use short leases and `tokio::time::sleep`, which a paused clock
//! (memory) skips and real time (PostgreSQL) simply waits out; no case orders events by sleeping.
use rh_placement::backend::PlacementStatus;
use rh_placement::ledger::{
    AttemptRec, Begin, ClaimKind, DnsStep, Identity, Ledger, LedgerError, LedgerState, OfferRecord,
    Phase, ReleaseClaim, Resolution, StopStep, TermStep, WriteOutcome,
};
use std::sync::Arc;
use std::time::Duration;

pub struct Fx<L> {
    pub a: Arc<L>,
    pub b: Arc<L>,
}

pub const LONG: Duration = Duration::from_secs(60);
pub const SHORT: Duration = Duration::from_millis(100);
const PAST_SHORT: Duration = Duration::from_millis(400);

pub fn ident(id: &str, scope: &str, fp: &str) -> Identity {
    Identity {
        request_id: id.into(),
        scope: scope.into(),
        fingerprint: format!("{fp:0<64}"),
        request_json: "{}".into(),
        config_json: "{}".into(),
        zone: "g.example.com".into(),
    }
}

pub fn attempt(id: &str) -> AttemptRec {
    AttemptRec::new(
        1,
        format!("rh-{id}-1"),
        format!("binding-{id}"),
        vec!["us-west-2".into()],
        0,
    )
}

pub fn offer(id: &str) -> OfferRecord {
    OfferRecord {
        region: "us-west-2".into(),
        hostname: format!("us-west-2-{id}.g.example.com"),
        port: 35010,
        url: format!("wss://us-west-2-{id}.g.example.com:35010/ws"),
        placement_id: format!("rh-{id}-1"),
        game_session_arn: format!("arn:{id}"),
        player_sessions: vec![("alice".into(), "psess".into())],
        warnings: vec![],
        attempts_used: 1,
    }
}

/// An attempt that was fulfilled, whose DNS was verified, with its offer: ready to be written as `offered`.
pub fn offered_state(id: &str) -> LedgerState {
    let mut a = attempt(id);
    a.status = Some(PlacementStatus::Fulfilled);
    a.dns = DnsStep::Verified {
        host: offer(id).hostname,
    };
    a.resolution = Resolution::Offered;
    LedgerState {
        attempts: vec![a],
        offer: Some(offer(id)),
        ..LedgerState::default()
    }
}

pub fn resolved_state(id: &str) -> LedgerState {
    let mut a = attempt(id);
    a.resolution = Resolution::NoHost;
    LedgerState {
        attempts: vec![a],
        ..LedgerState::default()
    }
}

async fn pass_lease() {
    tokio::time::sleep(PAST_SHORT).await;
}

async fn started<L: Ledger>(l: &L, id: &str, lease: Duration) -> rh_placement::ledger::Claim {
    match l.begin(&ident(id, "s", "f"), "w1", lease).await.unwrap() {
        Begin::Started(c) => c,
        other => panic!("expected Started, got {other:?}"),
    }
}

async fn offered<L: Ledger>(l: &L, id: &str) {
    let c = started(l, id, LONG).await;
    assert_eq!(
        l.write(&c, &offered_state(id), Phase::Offered, LONG)
            .await
            .unwrap(),
        WriteOutcome::Written
    );
}

pub async fn begin_identical_is_in_progress_then_reused<L: Ledger>(fx: &Fx<L>) {
    let c = started(&*fx.a, "req00001", LONG).await;
    assert_eq!((c.fence, c.kind), (1, ClaimKind::Worker));
    // Same identity while a live worker holds it, from either handle.
    for l in [&fx.a, &fx.b] {
        assert_eq!(
            l.begin(&ident("req00001", "s", "f"), "w2", LONG).await.unwrap(),
            Begin::InProgress
        );
    }
    // After the worker gives up, the abandoned row is not re-startable: a new id is needed.
    fx.a.relinquish(&c).await.unwrap();
    assert_eq!(
        fx.b.begin(&ident("req00001", "s", "f"), "w2", LONG).await.unwrap(),
        Begin::Reused(Phase::Active)
    );
}

pub async fn begin_conflicting_request_or_config_fails<L: Ledger>(fx: &Fx<L>) {
    started(&*fx.a, "req00002", LONG).await;
    assert_eq!(
        fx.b.begin(&ident("req00002", "s", "other"), "w2", LONG).await.unwrap(),
        Begin::Conflict
    );
}

pub async fn begin_different_scope_same_id_conflicts<L: Ledger>(fx: &Fx<L>) {
    started(&*fx.a, "req00003", LONG).await;
    assert_eq!(
        fx.b.begin(&ident("req00003", "another-scope", "f"), "w2", LONG)
            .await
            .unwrap(),
        Begin::Conflict
    );
    // Also once the original is offered: a foreign scope never sees the offer.
    offered(&*fx.a, "req00004").await;
    assert_eq!(
        fx.b.begin(&ident("req00004", "another-scope", "f"), "w2", LONG)
            .await
            .unwrap(),
        Begin::Conflict
    );
}

pub async fn offered_replays_only_to_the_identical_identity<L: Ledger>(fx: &Fx<L>) {
    offered(&*fx.a, "req00005").await;
    assert_eq!(
        fx.b.begin(&ident("req00005", "s", "f"), "w2", LONG).await.unwrap(),
        Begin::Offered(Box::new(offer("req00005")))
    );
    assert_eq!(
        fx.b.begin(&ident("req00005", "s", "g"), "w2", LONG).await.unwrap(),
        Begin::Conflict
    );
    let r = fx.b.get("req00005").await.unwrap().unwrap();
    assert_eq!((r.phase, r.claim.kind), (Phase::Offered, ClaimKind::None));
}

pub async fn write_is_fenced_after_takeover<L: Ledger>(fx: &Fx<L>) {
    let old = started(&*fx.a, "req00006", SHORT).await;
    let mut s = LedgerState::default();
    s.attempts.push(attempt("req00006"));
    assert_eq!(
        fx.a.write(&old, &s, Phase::Active, SHORT).await.unwrap(),
        WriteOutcome::Written
    );
    pass_lease().await;
    let mut taken = fx.b.claim_reapable("reaper", LONG, 8).await.unwrap();
    assert_eq!(taken.len(), 1);
    let (new, rec) = taken.pop().unwrap();
    assert_eq!((new.fence, new.kind), (2, ClaimKind::Reaper));
    assert_eq!(rec.state, s, "the reaper reads what the worker committed");
    // The old holder's every write is fenced, whatever it carries.
    let mut other = s.clone();
    other.note = "stale".into();
    assert_eq!(
        fx.a.write(&old, &other, Phase::Active, LONG).await.unwrap(),
        WriteOutcome::Fenced
    );
    assert_eq!(fx.b.get("req00006").await.unwrap().unwrap().state, s);
    // The new holder's is not.
    assert_eq!(
        fx.b.write(&new, &other, Phase::Active, LONG).await.unwrap(),
        WriteOutcome::Written
    );
    assert_eq!(fx.a.get("req00006").await.unwrap().unwrap().state, other);
}

pub async fn claim_expiry_and_takeover<L: Ledger>(fx: &Fx<L>) {
    started(&*fx.a, "req00007", LONG).await; // live: never reapable
    let short = started(&*fx.a, "req00008", SHORT).await;
    pass_lease().await;
    let got = fx.b.claim_reapable("r1", LONG, 8).await.unwrap();
    let ids: Vec<_> = got.iter().map(|(c, _)| c.request_id.as_str()).collect();
    assert_eq!(ids, ["req00008"]);
    assert_eq!(got[0].0.fence, short.fence + 1);
    // Claimed rows are not handed out again while the claim is live.
    assert!(fx.a.claim_reapable("r2", LONG, 8).await.unwrap().is_empty());
    // A row with a live reaper claim reads as in progress to an identical retry? No: a reaper's row is abandoned work.
    assert_eq!(
        fx.a.begin(&ident("req00008", "s", "f"), "w", LONG).await.unwrap(),
        Begin::Reused(Phase::Active)
    );
}

pub async fn concurrent_claim_reapable_is_exclusive<L: Ledger + 'static>(fx: &Fx<L>) {
    const N: usize = 12;
    for i in 0..N {
        started(&*fx.a, &format!("race{i:04}"), SHORT).await;
    }
    pass_lease().await;
    let mut tasks = Vec::new();
    for i in 0..4 {
        let l = if i % 2 == 0 { fx.a.clone() } else { fx.b.clone() };
        tasks.push(tokio::spawn(async move {
            l.claim_reapable(&format!("reaper-{i}"), LONG, N).await.unwrap()
        }));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut total = 0;
    for t in tasks {
        for (claim, rec) in t.await.unwrap() {
            total += 1;
            assert_eq!(claim.fence, 2, "{}", claim.request_id);
            assert_eq!(rec.fence, 2);
            assert!(seen.insert(claim.request_id.clone()), "{} claimed twice", claim.request_id);
        }
    }
    assert_eq!((total, seen.len()), (N, N), "every row is claimed exactly once");
}

pub async fn stale_worker_cannot_commit_offer_or_finish<L: Ledger>(fx: &Fx<L>) {
    let old = started(&*fx.a, "req00009", SHORT).await;
    let mut s = LedgerState::default();
    s.attempts.push(attempt("req00009"));
    fx.a.write(&old, &s, Phase::Active, SHORT).await.unwrap();
    pass_lease().await;
    let (new, _) = fx.b.claim_reapable("reaper", LONG, 8).await.unwrap().remove(0);
    // The stale worker finished a fulfilment and tries to commit the offer, or to finish the row.
    assert_eq!(
        fx.a.write(&old, &offered_state("req00009"), Phase::Offered, LONG)
            .await
            .unwrap(),
        WriteOutcome::Fenced
    );
    assert_eq!(
        fx.a.write(&old, &resolved_state("req00009"), Phase::Finished, LONG)
            .await
            .unwrap(),
        WriteOutcome::Fenced
    );
    let r = fx.b.get("req00009").await.unwrap().unwrap();
    assert_eq!((r.phase, r.fence), (Phase::Active, new.fence));
    assert_eq!(r.state, s);
    assert_eq!(r.state.offer, None);
}

pub async fn store_refuses_offered_with_cleanup_intent<L: Ledger>(fx: &Fx<L>) {
    let id = "req00010";
    let c = started(&*fx.a, id, LONG).await;
    let refused = |r: Result<WriteOutcome, LedgerError>| {
        assert!(matches!(r, Err(LedgerError::Refused(_))), "{r:?}");
    };
    let mut terminate = offered_state(id);
    terminate.attempts[0].terminate = TermStep::Intent { arn: "arn".into() };
    refused(fx.a.write(&c, &terminate, Phase::Offered, LONG).await);
    let mut delete = offered_state(id);
    delete.attempts[0].dns = DnsStep::DeleteIntent {
        host: offer(id).hostname,
    };
    refused(fx.a.write(&c, &delete, Phase::Offered, LONG).await);
    let mut deleted = offered_state(id);
    deleted.attempts[0].dns = DnsStep::Deleted {
        host: offer(id).hostname,
    };
    refused(fx.a.write(&c, &deleted, Phase::Offered, LONG).await);
    let mut stop = offered_state(id);
    stop.attempts[0].stop = StopStep::Intent;
    refused(fx.a.write(&c, &stop, Phase::Offered, LONG).await);
    let mut no_offer = offered_state(id);
    no_offer.offer = None;
    refused(fx.a.write(&c, &no_offer, Phase::Offered, LONG).await);
    // `finished` with an unresolved attempt is refused too: an unknown outcome is never final.
    let mut open = LedgerState::default();
    open.attempts.push(attempt(id));
    refused(fx.a.write(&c, &open, Phase::Finished, LONG).await);
    // None of it changed the row, and the claim still works.
    let r = fx.b.get(id).await.unwrap().unwrap();
    assert_eq!((r.phase, r.state), (Phase::Active, LedgerState::default()));
    assert_eq!(
        fx.a.write(&c, &offered_state(id), Phase::Offered, LONG).await.unwrap(),
        WriteOutcome::Written
    );
}

pub async fn offered_released_and_finished_rows_are_never_reapable<L: Ledger>(fx: &Fx<L>) {
    offered(&*fx.a, "req00011").await;
    let c = started(&*fx.a, "req00012", LONG).await;
    fx.a.write(&c, &resolved_state("req00012"), Phase::Finished, LONG)
        .await
        .unwrap();
    // released: offer -> release claim -> releasing -> released
    offered(&*fx.a, "req00013").await;
    let ReleaseClaim::Claimed(rc, _) = fx.a.claim_for_release("req00013", "rel", LONG).await.unwrap()
    else {
        panic!("claim");
    };
    fx.a.write(&rc, &offered_state("req00013"), Phase::Releasing, LONG).await.unwrap();
    fx.a.write(&rc, &offered_state("req00013"), Phase::Released, LONG).await.unwrap();
    pass_lease().await;
    assert!(fx.b.claim_reapable("r", LONG, 100).await.unwrap().is_empty());
    for id in ["req00011", "req00012", "req00013"] {
        let r = fx.b.get(id).await.unwrap().unwrap();
        assert!(matches!(r.phase, Phase::Offered | Phase::Finished | Phase::Released), "{id}");
        assert_eq!(r.claim.kind, ClaimKind::None);
    }
    // Writes cannot revive them either.
    assert_eq!(
        fx.a.write(&rc, &resolved_state("req00013"), Phase::Active, LONG).await.unwrap(),
        WriteOutcome::Fenced
    );
}

pub async fn relinquish_frees_only_the_holders_claim<L: Ledger>(fx: &Fx<L>) {
    let id = "req00014";
    let c = started(&*fx.a, id, LONG).await;
    assert!(fx.b.claim_reapable("r", LONG, 8).await.unwrap().is_empty());
    fx.a.relinquish(&c).await.unwrap();
    let (new, _) = fx.b.claim_reapable("r", LONG, 8).await.unwrap().remove(0);
    // The stale holder's relinquish does not free the new claim.
    fx.a.relinquish(&c).await.unwrap();
    assert!(fx.a.claim_reapable("r2", LONG, 8).await.unwrap().is_empty());
    assert_eq!(fx.a.get(id).await.unwrap().unwrap().claim.holder.as_deref(), Some("r"));
    fx.b.relinquish(&new).await.unwrap();
    assert_eq!(fx.a.claim_reapable("r2", LONG, 8).await.unwrap().len(), 1);
}

pub async fn release_claims<L: Ledger>(fx: &Fx<L>) {
    assert_eq!(
        fx.a.claim_for_release("nothere", "rel", LONG).await.unwrap(),
        ReleaseClaim::Missing
    );
    started(&*fx.a, "req00015", LONG).await;
    assert_eq!(
        fx.a.claim_for_release("req00015", "rel", LONG).await.unwrap(),
        ReleaseClaim::NotReleasable(Phase::Active)
    );
    offered(&*fx.a, "req00016").await;
    let ReleaseClaim::Claimed(rc, rec) = fx.a.claim_for_release("req00016", "rel", LONG).await.unwrap()
    else {
        panic!("claim");
    };
    assert_eq!((rc.fence, rc.kind, rec.phase), (2, ClaimKind::Release, Phase::Offered));
    // A release in flight: second claimant is busy, and a retry of the request never replays the offer.
    assert_eq!(
        fx.b.claim_for_release("req00016", "rel2", LONG).await.unwrap(),
        ReleaseClaim::Busy
    );
    assert_eq!(
        fx.b.begin(&ident("req00016", "s", "f"), "w", LONG).await.unwrap(),
        Begin::Reused(Phase::Offered)
    );
    // The intent is durable; giving up the claim hands the releasing row to the reaper.
    let s = offered_state("req00016");
    fx.a.write(&rc, &s, Phase::Releasing, LONG).await.unwrap();
    fx.a.relinquish(&rc).await.unwrap();
    let got = fx.b.claim_reapable("r", LONG, 8).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!((got[0].0.kind, got[0].1.phase), (ClaimKind::Release, Phase::Releasing));
    fx.b.write(&got[0].0, &s, Phase::Released, LONG).await.unwrap();
    assert_eq!(
        fx.a.claim_for_release("req00016", "rel", LONG).await.unwrap(),
        ReleaseClaim::AlreadyReleased
    );
    assert_eq!(
        fx.a.begin(&ident("req00016", "s", "f"), "w", LONG).await.unwrap(),
        Begin::Reused(Phase::Released)
    );
}

pub async fn counts_follow_the_phases<L: Ledger>(fx: &Fx<L>) {
    started(&*fx.a, "req00017", LONG).await;
    offered(&*fx.a, "req00018").await;
    let c = started(&*fx.a, "req00019", LONG).await;
    fx.a.write(&c, &resolved_state("req00019"), Phase::Finished, LONG).await.unwrap();
    let d = started(&*fx.a, "req00020", LONG).await;
    fx.a.relinquish(&d).await.unwrap();
    let n = fx.b.counts().await.unwrap();
    assert_eq!(
        (n.total, n.active_live, n.unresolved, n.offered, n.finished),
        (4, 1, 1, 1, 1)
    );
}

pub async fn purge_makes_tombstones_that_never_replay<L: Ledger>(fx: &Fx<L>) {
    // Two final rows, one offered row, one active row.
    let c = started(&*fx.a, "purge001", LONG).await;
    fx.a.write(&c, &resolved_state("purge001"), Phase::Finished, LONG).await.unwrap();
    offered(&*fx.a, "purge002").await;
    let ReleaseClaim::Claimed(rc, _) = fx.a.claim_for_release("purge002", "rel", LONG).await.unwrap()
    else {
        panic!()
    };
    let s = offered_state("purge002");
    fx.a.write(&rc, &s, Phase::Releasing, LONG).await.unwrap();
    fx.a.write(&rc, &s, Phase::Released, LONG).await.unwrap();
    offered(&*fx.a, "purge003").await;
    started(&*fx.a, "purge004", LONG).await;
    // Nothing is old enough yet.
    assert_eq!(fx.a.purge(10, LONG).await.unwrap(), 0);
    tokio::time::sleep(Duration::from_millis(60)).await;
    // Bounded per call.
    assert_eq!(fx.a.purge(1, Duration::from_millis(10)).await.unwrap(), 1);
    assert_eq!(fx.b.purge(10, Duration::from_millis(10)).await.unwrap(), 1);
    assert_eq!(fx.b.purge(10, Duration::from_millis(10)).await.unwrap(), 0);
    for (id, was) in [("purge001", Phase::Finished), ("purge002", Phase::Released)] {
        let r = fx.b.get(id).await.unwrap().unwrap();
        assert_eq!((r.phase, r.final_phase), (Phase::Tombstone, Some(was)), "{id}");
        assert_eq!(r.state, LedgerState::default());
        assert!(r.identity.request_json.is_empty() && r.identity.config_json.is_empty());
        // A purged id never replays, restarts or is reaped; a different identity still conflicts.
        assert_eq!(
            fx.a.begin(&ident(id, "s", "f"), "w", LONG).await.unwrap(),
            Begin::Reused(Phase::Tombstone)
        );
        assert_eq!(
            fx.a.begin(&ident(id, "s", "different"), "w", LONG).await.unwrap(),
            Begin::Conflict
        );
        assert_eq!(
            fx.a.begin(&ident(id, "other-scope", "f"), "w", LONG).await.unwrap(),
            Begin::Conflict
        );
    }
    // Offered and active rows are untouched.
    assert_eq!(fx.b.get("purge003").await.unwrap().unwrap().phase, Phase::Offered);
    assert_eq!(fx.b.get("purge004").await.unwrap().unwrap().phase, Phase::Active);
    assert!(fx.b.claim_reapable("r", LONG, 10).await.unwrap().is_empty());
    assert_eq!(fx.b.counts().await.unwrap().tombstones, 2);
}

pub async fn epoch_is_created_once_and_never_over_old_records<L: Ledger>(fx: &Fx<L>) {
    // Records without an epoch are corruption: a new epoch is never minted over them.
    started(&*fx.a, "epoch001", LONG).await;
    let e = fx.b.open_epoch([9; 32]).await;
    assert!(matches!(e, Err(LedgerError::Corrupt(_))), "{e:?}");
}

pub async fn epoch_open_returns_the_stored_nonce<L: Ledger>(fx: &Fx<L>) {
    assert_eq!(fx.a.open_epoch([1; 32]).await.unwrap(), [1; 32]);
    // A later candidate (a restart, another instance) gets the stored one.
    assert_eq!(fx.b.open_epoch([2; 32]).await.unwrap(), [1; 32]);
    assert_eq!(fx.a.open_epoch([3; 32]).await.unwrap(), [1; 32]);
    // With an epoch in place, records are normal.
    started(&*fx.a, "epoch002", LONG).await;
    assert_eq!(fx.b.open_epoch([4; 32]).await.unwrap(), [1; 32]);
}

pub async fn concurrent_epoch_open_agrees<L: Ledger + 'static>(fx: &Fx<L>) {
    let mut t = Vec::new();
    for i in 0..6u8 {
        let l = if i % 2 == 0 { fx.a.clone() } else { fx.b.clone() };
        t.push(tokio::spawn(async move { l.open_epoch([i + 1; 32]).await.unwrap() }));
    }
    let mut got = std::collections::BTreeSet::new();
    for h in t {
        got.insert(h.await.unwrap());
    }
    assert_eq!(got.len(), 1, "every opener sees one epoch: {got:?}");
}

pub async fn illegal_phase_moves_are_refused<L: Ledger>(fx: &Fx<L>) {
    let c = started(&*fx.a, "req00021", LONG).await;
    // active -> released/releasing are not moves a worker can make.
    for p in [Phase::Releasing, Phase::Released] {
        let r = fx.a.write(&c, &offered_state("req00021"), p, LONG).await;
        assert!(matches!(r, Err(LedgerError::Refused(_))), "{p:?}: {r:?}");
    }
    let r = fx.a.write(&c, &LedgerState::default(), Phase::Tombstone, LONG).await;
    assert!(matches!(r, Err(LedgerError::Refused(_))), "{r:?}");
}

/// Expands to one test per case for a fixture. `$setup` builds an `Fx`, `$teardown` consumes it.
#[macro_export]
macro_rules! conformance_cases {
    ($attr:meta, $setup:path, $teardown:path) => {
        $crate::conformance_cases!(@each [$attr] $setup, $teardown;
            begin_identical_is_in_progress_then_reused,
            begin_conflicting_request_or_config_fails,
            begin_different_scope_same_id_conflicts,
            offered_replays_only_to_the_identical_identity,
            write_is_fenced_after_takeover,
            claim_expiry_and_takeover,
            concurrent_claim_reapable_is_exclusive,
            stale_worker_cannot_commit_offer_or_finish,
            store_refuses_offered_with_cleanup_intent,
            offered_released_and_finished_rows_are_never_reapable,
            relinquish_frees_only_the_holders_claim,
            release_claims,
            counts_follow_the_phases,
            purge_makes_tombstones_that_never_replay,
            epoch_is_created_once_and_never_over_old_records,
            epoch_open_returns_the_stored_nonce,
            concurrent_epoch_open_agrees,
            illegal_phase_moves_are_refused
        );
    };
    (@each [$attr:meta] $setup:path, $teardown:path; $($case:ident),+) => {
        $(
            #[$attr]
            async fn $case() {
                let fx = $setup().await;
                $crate::ledger_support::conformance::$case(&fx).await;
                $teardown(fx).await;
            }
        )+
    };
}
