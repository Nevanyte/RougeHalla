use rh_placement::{
    backend::{GameLiftBackend, PlacementStatus},
    fake::{FakeDns, FakeGameLift, RegionBehaviour},
    service::*,
    *,
};
use std::{collections::BTreeMap, time::Duration};
fn cfg() -> ServiceConfig {
    ServiceConfig {
        regions: vec![RegionConfig {
            id: "us-west-2".into(),
            label: "west".into(),
            probe_url: "".into(),
        }],
        policy: PlacementPolicy::default(),
        queue_name: "rh-q".into(),
        zone: "g.rougehalla.com".into(),
        max_players: 8,
    }
}
fn req() -> PlacementRequest {
    PlacementRequest {
        request_id: "review001".into(),
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
#[tokio::test(start_paused = true)]
async fn describe_failure_fulfilment_race_retains_cleanup() {
    let gl = FakeGameLift::new(&[("us-west-2", fulfil())])
        .with_describe_errors(5)
        .with_fulfil_on_stop();
    let svc = PlacementService::new([1; 32], cfg(), gl, FakeDns::new());
    assert!(svc.place(&req()).await.is_err());
    let state = svc
        .gamelift()
        .describe_placement("rh-review001-1")
        .await
        .unwrap();
    assert_eq!(state.status, PlacementStatus::Fulfilled);
    assert!(
        svc.abandoned_count() > 0 || !svc.gamelift().terminated().is_empty(),
        "fulfilled orphan lost: abandoned={}, terminated={:?}",
        svc.abandoned_count(),
        svc.gamelift().terminated()
    );
}
#[tokio::test(start_paused = true)]
async fn retry_success_revokes_stale_abandoned_reaper() {
    let svc = PlacementService::new(
        [1; 32],
        cfg(),
        FakeGameLift::new(&[("us-west-2", fulfil())]),
        FakeDns::new(),
    );
    let r = req();
    {
        let first = svc.place(&r);
        tokio::pin!(first);
        tokio::select! {res=&mut first=>panic!("completed prematurely:{res:?}"),_=tokio::time::sleep(Duration::from_millis(10))=>{}}
    }
    assert_eq!(svc.abandoned_count(), 1);
    assert_eq!(
        svc.place(&r).await.unwrap_err(),
        PlaceError::RequestIdReused
    );
    assert_eq!(svc.reap_abandoned().await, 1);
    assert_eq!(
        svc.place(&r).await.unwrap_err(),
        PlaceError::RequestIdReused
    );
}

use rh_placement::backend::{BackendError, PlacementState, StartPlacement};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
struct Unreliable {
    inner: FakeGameLift,
    hold_stop: AtomicBool,
    hold_start: AtomicBool,
    lose_start: AtomicBool,
    stop_failures: AtomicUsize,
    terminate_failures: AtomicUsize,
}
impl Unreliable {
    fn new(behaviour: RegionBehaviour) -> Self {
        Self {
            inner: FakeGameLift::new(&[("us-west-2", behaviour)]),
            hold_stop: AtomicBool::new(false),
            hold_start: AtomicBool::new(false),
            lose_start: AtomicBool::new(false),
            stop_failures: AtomicUsize::new(0),
            terminate_failures: AtomicUsize::new(0),
        }
    }
    fn fail(counter: &AtomicUsize) -> bool {
        counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
    }
}
impl GameLiftBackend for Unreliable {
    async fn start_placement(&self, r: &StartPlacement) -> Result<PlacementState, BackendError> {
        let result = self.inner.start_placement(r).await;
        if self.hold_start.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        if self.lose_start.swap(false, Ordering::SeqCst) {
            return Err(BackendError::Unavailable("response lost".into()));
        }
        result
    }
    async fn describe_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        self.inner.describe_placement(id).await
    }
    async fn stop_placement(&self, id: &str) -> Result<PlacementState, BackendError> {
        if self.hold_stop.load(Ordering::SeqCst) {
            std::future::pending::<()>().await;
        }
        if Self::fail(&self.stop_failures) {
            return Err(BackendError::Unavailable("stop failed".into()));
        }
        self.inner.stop_placement(id).await
    }
    async fn terminate_game_session(&self, id: &str) -> Result<(), BackendError> {
        if Self::fail(&self.terminate_failures) {
            return Err(BackendError::Unavailable("terminate failed".into()));
        }
        self.inner.terminate_game_session(id).await
    }
    async fn capacity(&self) -> Result<BTreeMap<String, RegionCapacity>, BackendError> {
        self.inner.capacity().await
    }
}
async fn abandon<G: GameLiftBackend, D: rh_placement::backend::DnsBackend>(
    svc: &PlacementService<G, D>,
    r: &PlacementRequest,
) {
    let future = svc.place(r);
    tokio::pin!(future);
    tokio::select! {result=&mut future=>panic!("unexpected completion {result:?}"),_=tokio::time::sleep(Duration::from_millis(10))=>{}}
}
#[tokio::test(start_paused = true)]
async fn cancellation_of_reaper_preserves_current_and_unvisited_requests() {
    let svc = PlacementService::new(
        [1; 32],
        cfg(),
        Unreliable::new(RegionBehaviour::NoHost),
        FakeDns::new(),
    );
    abandon(&svc, &req()).await;
    let mut r = req();
    r.request_id = "review002".into();
    abandon(&svc, &r).await;
    svc.gamelift().hold_stop.store(true, Ordering::SeqCst);
    {
        let reaper = svc.reap_abandoned();
        tokio::pin!(reaper);
        tokio::select! {_=&mut reaper=>panic!("reaper should block"),_=tokio::time::sleep(Duration::from_millis(10))=>{}}
    }
    assert_eq!(svc.abandoned_count(), 2);
    svc.gamelift().hold_stop.store(false, Ordering::SeqCst);
    assert_eq!(svc.reap_abandoned().await, 2);
    assert_eq!(svc.abandoned_count(), 0);
}
#[tokio::test(start_paused = true)]
async fn failed_stop_and_termination_remain_retryable() {
    let svc = PlacementService::new(
        [1; 32],
        cfg(),
        Unreliable::new(RegionBehaviour::NoHost),
        FakeDns::new(),
    );
    abandon(&svc, &req()).await;
    svc.gamelift().stop_failures.store(1, Ordering::SeqCst);
    assert_eq!(svc.reap_abandoned().await, 0);
    assert_eq!(svc.abandoned_count(), 1);
    assert_eq!(svc.reap_abandoned().await, 1);
    let svc = PlacementService::new([1; 32], cfg(), Unreliable::new(fulfil()), FakeDns::new());
    abandon(&svc, &req()).await;
    svc.gamelift().terminate_failures.store(1, Ordering::SeqCst);
    assert_eq!(svc.reap_abandoned().await, 0);
    assert_eq!(svc.abandoned_count(), 1);
    assert_eq!(svc.reap_abandoned().await, 1);
    assert_eq!(svc.gamelift().inner.terminated().len(), 1);
}
#[tokio::test(start_paused = true)]
async fn concurrent_retry_cannot_take_ownership_and_successful_retry_is_bound() {
    let mut svc = PlacementService::new(
        [1; 32],
        cfg(),
        FakeGameLift::new(&[("us-west-2", fulfil())]),
        FakeDns::new(),
    );
    let r = req();
    let offer = {
        let first = svc.place(&r);
        tokio::pin!(first);
        tokio::select! {_=&mut first=>panic!("unexpected completion"),_=tokio::time::sleep(Duration::from_millis(10))=>{}}
        assert!(matches!(
            svc.place(&r).await,
            Err(PlaceError::ServiceUnavailable(_))
        ));
        first.await.unwrap()
    };
    let calls = svc.gamelift().calls();
    assert_eq!(svc.place(&r).await.unwrap(), offer);
    assert_eq!(svc.gamelift().calls(), calls);
    assert_eq!(svc.reap_abandoned().await, 0);
    assert!(svc.gamelift().terminated().is_empty());
    let mut conflicting = r.clone();
    conflicting.party[0].callsign = "mallory".into();
    assert!(matches!(
        svc.place(&conflicting).await,
        Err(PlaceError::Invalid(_))
    ));
    svc.cfg.queue_name = "different-queue".into();
    assert!(matches!(svc.place(&r).await, Err(PlaceError::Invalid(_))));
    assert!(svc.gamelift().terminated().is_empty());
}
#[tokio::test(start_paused = true)]
async fn foreign_backend_collision_returns_no_credentials_and_is_never_reaped() {
    let fake = FakeGameLift::new(&[("us-west-2", fulfil())]);
    fake.start_placement(&StartPlacement {
        placement_id: "rh-review001-1".into(),
        queue_name: "foreign".into(),
        max_player_sessions: 8,
        players: vec!["mallory".into()],
        game_session_data: "{}".into(),
        location_order: vec!["us-west-2".into()],
        fallback: rh_placement::backend::Fallback::None,
    })
    .await
    .unwrap();
    let svc = PlacementService::new([1; 32], cfg(), fake, FakeDns::new());
    assert_eq!(
        svc.place(&req()).await.unwrap_err(),
        PlaceError::RequestIdReused
    );
    assert_eq!(svc.reap_abandoned().await, 0);
    assert!(svc.gamelift().terminated().is_empty());
    assert!(svc.dns().records().is_empty());
}

#[tokio::test(start_paused = true)]
async fn canceled_start_ack_cannot_reap_another_services_accepted_offer() {
    let old = PlacementService::new(
        [1; 32],
        cfg(),
        FakeGameLift::new(&[("us-west-2", fulfil())]),
        FakeDns::new(),
    );
    let offer = old.place(&req()).await.unwrap();
    let (old_gamelift, old_dns) = old.into_backends();
    let backend = Unreliable {
        inner: old_gamelift,
        ..Unreliable::new(fulfil())
    };
    backend.hold_start.store(true, Ordering::SeqCst);
    let fresh = PlacementService::new([2; 32], cfg(), backend, old_dns);
    abandon(&fresh, &req()).await;
    assert_eq!(fresh.abandoned_count(), 1);
    assert_eq!(fresh.reap_abandoned().await, 1);
    assert!(fresh.gamelift().inner.terminated().is_empty());
    assert!(fresh.dns().records().contains_key(&offer.hostname));
}
#[tokio::test(start_paused = true)]
async fn new_service_cannot_attach_to_identical_request_with_old_owner() {
    let old = PlacementService::new(
        [1; 32],
        cfg(),
        FakeGameLift::new(&[("us-west-2", fulfil())]),
        FakeDns::new(),
    );
    let offer = old.place(&req()).await.unwrap();
    let (old_gamelift, old_dns) = old.into_backends();
    let fresh = PlacementService::new([2; 32], cfg(), old_gamelift, old_dns);
    assert_eq!(
        fresh.place(&req()).await.unwrap_err(),
        PlaceError::RequestIdReused
    );
    assert_eq!(fresh.reap_abandoned().await, 0);
    assert!(fresh.gamelift().terminated().is_empty());
    assert!(fresh.dns().records().contains_key(&offer.hostname));
}
#[tokio::test(start_paused = true)]
async fn lost_start_response_reconciles_only_our_binding() {
    let backend = Unreliable::new(fulfil());
    backend.lose_start.store(true, Ordering::SeqCst);
    let svc = PlacementService::new([1; 32], cfg(), backend, FakeDns::new());
    let offer = svc.place(&req()).await.unwrap();
    assert_eq!(offer.player_sessions[0].0, "alice");
    assert_eq!(svc.reap_abandoned().await, 0);
    assert!(svc.gamelift().inner.terminated().is_empty());
}
#[tokio::test(start_paused = true)]
async fn canceled_owned_start_ack_still_reaps_the_created_host() {
    let backend = Unreliable::new(fulfil());
    backend.hold_start.store(true, Ordering::SeqCst);
    let svc = PlacementService::new([1; 32], cfg(), backend, FakeDns::new());
    abandon(&svc, &req()).await;
    assert_eq!(svc.reap_abandoned().await, 1);
    assert_eq!(svc.gamelift().inner.terminated().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn ledger_is_bounded_and_full_or_invalid_requests_make_no_external_call() {
    let svc = PlacementService::new(
        [1; 32],
        cfg(),
        FakeGameLift::new(&[("us-west-2", RegionBehaviour::Fail)]),
        FakeDns::new(),
    );
    let mut invalid = req();
    invalid.request_id = "".into();
    assert!(svc.place(&invalid).await.is_err());
    assert!(svc.gamelift().calls().is_empty());
    for i in 0..4096 {
        let mut r = req();
        r.request_id = format!("bound{i:05}");
        assert!(svc.place(&r).await.is_err());
    }
    let calls = svc.gamelift().calls();
    let mut extra = req();
    extra.request_id = "boundextra".into();
    assert!(matches!(
        svc.place(&extra).await,
        Err(PlaceError::ServiceUnavailable(_))
    ));
    assert_eq!(svc.gamelift().calls(), calls);
}
