//! Cancellation receipts are untrusted until both placement ID and ownership data match.
use rh_placement::{
    backend::{BackendError, GameLiftBackend, PlacementState, PlacementStatus, StartPlacement},
    fake::{FakeDns, FakeGameLift, RegionBehaviour},
    service::{PlaceError, PlacementService, ServiceConfig},
    MemberReport, PlacementPolicy, PlacementRequest, RegionCapacity, RegionConfig,
};
use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Copy)]
enum Identity {
    Valid,
    Missing,
    Foreign,
    WrongId,
}
struct CancellationReceipt {
    inner: FakeGameLift,
    describe_receipt: bool,
    after_stop: AtomicBool,
    identity: Identity,
    status: PlacementStatus,
}
impl CancellationReceipt {
    async fn receipt(&self, id: &str) -> PlacementState {
        let mut state = self.inner.describe_placement(id).await.unwrap();
        state.status = self.status;
        state.region = Some("us-west-2".into());
        state.ip_address = Some("203.0.113.1".into());
        state.port = Some(35010);
        state.game_session_arn =
            Some("arn:aws:gamelift:us-west-2::gamesession/fleet-x/receipt".into());
        state.placed_player_sessions = vec![("alice".into(), "psess-receipt".into())];
        match self.identity {
            Identity::Valid => {}
            Identity::Missing => state.game_session_data = None,
            Identity::Foreign => state.game_session_data = Some("another-owner".into()),
            Identity::WrongId => state.placement_id = "rh-another-id-1".into(),
        }
        state
    }
}
impl GameLiftBackend for CancellationReceipt {
    async fn start_placement(&self, req: &StartPlacement) -> Result<PlacementState, BackendError> {
        self.inner.start_placement(req).await
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        if self.after_stop.load(Ordering::SeqCst) {
            Ok(self.receipt(id).await)
        } else {
            self.inner.describe_placement(id).await
        }
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.after_stop.store(true, Ordering::SeqCst);
        if self.describe_receipt {
            Err(BackendError::Invalid("fulfilment race".into()))
        } else {
            Ok(self.receipt(id).await)
        }
    }
    async fn terminate_game_session(&self, arn: &str) -> Result<(), BackendError> {
        self.inner.terminate_game_session(arn).await
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        self.inner.capacity().await
    }
}
async fn check(describe_receipt: bool, identity: Identity, status: PlacementStatus) {
    let cfg = ServiceConfig {
        regions: vec![RegionConfig {
            id: "us-west-2".into(),
            label: "west".into(),
            probe_url: "".into(),
        }],
        policy: PlacementPolicy {
            attempt_timeout_ms: 1_000,
            total_budget_ms: 1_000,
            poll_interval_ms: 1_000,
            ..PlacementPolicy::default()
        },
        queue_name: "rh-q".into(),
        zone: "g.rougehalla.com".into(),
        max_players: 8,
    };
    let req = PlacementRequest {
        request_id: "cancel001".into(),
        region_override: None,
        party: vec![MemberReport {
            callsign: "alice".into(),
            age_s: 0,
            rtt_ms: BTreeMap::from([("us-west-2".into(), Some(30))]),
        }],
    };
    let backend = CancellationReceipt {
        inner: FakeGameLift::new(&[("us-west-2", RegionBehaviour::NoHost)]),
        describe_receipt,
        after_stop: AtomicBool::new(false),
        identity,
        status,
    };
    let svc = PlacementService::new([7; 32], cfg, backend, FakeDns::new());
    let result = svc.place(&req).await;
    assert!(
        svc.gamelift.after_stop.load(Ordering::SeqCst),
        "control must reach cancellation"
    );
    if matches!(identity, Identity::Valid) {
        if status == PlacementStatus::Fulfilled {
            assert!(result.is_ok(), "{result:?}");
            assert_eq!(svc.dns.records().len(), 1);
        } else {
            assert!(
                matches!(result, Err(PlaceError::NoCapacity { .. })),
                "{result:?}"
            );
            assert!(svc.dns.records().is_empty());
        }
        assert_eq!(svc.abandoned_count(), 0);
    } else {
        assert!(
            matches!(result, Err(PlaceError::ServiceUnavailable(_))),
            "unverified cancellation receipt escaped: {result:?}"
        );
        assert_eq!(
            svc.abandoned_count(),
            1,
            "unverified receipt cannot disarm owned work"
        );
        assert!(
            svc.dns.log().is_empty(),
            "unverified receipt cannot publish or delete DNS"
        );
        assert!(svc.gamelift.inner.terminated().is_empty());
    }
}
macro_rules! receipt_test {
    ($name:ident, $describe:expr, $identity:ident, $status:ident) => {
        #[tokio::test(start_paused = true)]
        async fn $name() {
            check($describe, Identity::$identity, PlacementStatus::$status).await;
        }
    };
}
receipt_test!(stop_missing_fulfilled, false, Missing, Fulfilled);
receipt_test!(stop_foreign_fulfilled, false, Foreign, Fulfilled);
receipt_test!(stop_wrong_id_fulfilled, false, WrongId, Fulfilled);
receipt_test!(describe_missing_fulfilled, true, Missing, Fulfilled);
receipt_test!(describe_foreign_fulfilled, true, Foreign, Fulfilled);
receipt_test!(describe_wrong_id_fulfilled, true, WrongId, Fulfilled);
receipt_test!(stop_missing_cancelled, false, Missing, Cancelled);
receipt_test!(stop_foreign_cancelled, false, Foreign, Cancelled);
receipt_test!(stop_wrong_id_cancelled, false, WrongId, Cancelled);
receipt_test!(describe_missing_cancelled, true, Missing, Cancelled);
receipt_test!(describe_foreign_cancelled, true, Foreign, Cancelled);
receipt_test!(describe_wrong_id_cancelled, true, WrongId, Cancelled);
receipt_test!(stop_valid_fulfilled, false, Valid, Fulfilled);
receipt_test!(describe_valid_fulfilled, true, Valid, Fulfilled);
receipt_test!(stop_valid_cancelled, false, Valid, Cancelled);
receipt_test!(describe_valid_cancelled, true, Valid, Cancelled);
