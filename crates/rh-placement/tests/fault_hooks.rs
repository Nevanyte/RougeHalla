//! The `fault-injection` hook points: named points around every durable write and backend call. The hook is process-global,
//! so these tests take one lock. (Mutants are separate: see README, `RH_PLACEMENT_MUTANT`.)
#![cfg(feature = "fault-injection")]
use rh_placement::fake::{FakeDns, FakeGameLift, RegionBehaviour};
use rh_placement::ledger::faults::{set_hook, Action, Hook};
use rh_placement::service::{PlacementService, ServiceConfig};
use rh_placement::{MemberReport, PlacementPolicy, PlacementRequest, RegionConfig};
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Script {
    seen: Mutex<Vec<String>>,
    fail: Mutex<Vec<(String, u32)>>,
}
impl Hook for Script {
    fn point<'a>(&'a self, name: &'a str) -> Pin<Box<dyn Future<Output = Action> + Send + 'a>> {
        self.seen.lock().unwrap().push(name.to_string());
        let mut f = self.fail.lock().unwrap();
        let act = match f.iter_mut().find(|(n, left)| n == name && *left > 0) {
            Some((_, left)) => {
                *left -= 1;
                Action::Fail
            }
            None => Action::Continue,
        };
        Box::pin(async move { act })
    }
}

fn svc() -> PlacementService<FakeGameLift, FakeDns> {
    let cfg = ServiceConfig {
        regions: vec![RegionConfig {
            id: "us-west-2".into(),
            label: "w".into(),
            probe_url: String::new(),
        }],
        policy: PlacementPolicy {
            poll_interval_ms: 5,
            ..PlacementPolicy::default()
        },
        queue_name: "q".into(),
        zone: "g.rougehalla.com".into(),
        max_players: 8,
    };
    PlacementService::new(
        [1; 32],
        cfg,
        FakeGameLift::new(&[(
            "us-west-2",
            RegionBehaviour::Fulfil {
                after_polls: 1,
                ip: "203.0.113.1".into(),
                port: 35010,
            },
        )]),
        FakeDns::new(),
    )
}

fn req() -> PlacementRequest {
    PlacementRequest {
        request_id: "hook0001".into(),
        party: vec![MemberReport {
            callsign: "alice".into(),
            age_s: 0,
            rtt_ms: BTreeMap::from([("us-west-2".into(), Some(30))]),
        }],
        region_override: None,
    }
}

fn install(fail: &[(&str, u32)]) -> Arc<Script> {
    let s = Arc::new(Script {
        seen: Mutex::new(vec![]),
        fail: Mutex::new(fail.iter().map(|(n, c)| (n.to_string(), *c)).collect()),
    });
    set_hook(Some(s.clone()));
    s
}

fn pos(seen: &[String], name: &str) -> usize {
    seen.iter()
        .position(|n| n == name)
        .unwrap_or_else(|| panic!("{name} not hit: {seen:?}"))
}

#[tokio::test(start_paused = true)]
async fn points_fire_around_every_write_and_effect_in_write_ahead_order() {
    let _g = ONE_AT_A_TIME.lock().await;
    let h = install(&[]);
    let offer = svc().place(&req()).await.unwrap();
    set_hook(None);
    let seen = h.seen.lock().unwrap().clone();
    let order = [
        "before.write.start_intent",
        "after.write.start_intent",
        "before.backend.start_placement",
        "after.backend.start_placement",
        "before.write.start_accepted",
        "before.write.fulfilled",
        "before.write.dns_intent",
        "before.backend.dns_upsert",
        "after.backend.dns_upsert",
        "before.backend.dns_resolve",
        "before.write.dns_verified",
        "before.write.offer",
        "after.write.offer",
    ];
    let idx: Vec<_> = order.iter().map(|n| pos(&seen, n)).collect();
    assert!(idx.windows(2).all(|w| w[0] < w[1]), "{seen:?}");
    assert!(offer.url.starts_with("wss://"));
}

#[tokio::test(start_paused = true)]
async fn failing_after_the_offer_write_is_an_uncertain_commit_the_service_reconciles() {
    let _g = ONE_AT_A_TIME.lock().await;
    let h = install(&[("after.write.offer", 1)]);
    let s = svc();
    let offer = s
        .place(&req())
        .await
        .expect("the write landed; the stored outcome is returned");
    set_hook(None);
    assert!(
        h.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|n| *n == "before.write.offer")
            .count()
            == 1
    );
    assert_eq!(s.place(&req()).await.unwrap(), offer);
    assert!(s.gamelift.terminated().is_empty());
}

#[tokio::test(start_paused = true)]
async fn failing_after_the_start_call_is_a_lost_receipt_recovered_through_the_stored_binding() {
    let _g = ONE_AT_A_TIME.lock().await;
    install(&[("after.backend.start_placement", 1)]);
    let s = svc();
    let offer = s
        .place(&req())
        .await
        .expect("the retried start finds the accepted placement by its binding");
    set_hook(None);
    assert_eq!(
        s.gamelift.starts().len(),
        2,
        "the second start was refused as already existing"
    );
    assert!(offer.hostname.starts_with("us-west-2-"));
}

#[tokio::test(start_paused = true)]
async fn failing_before_a_write_sends_nothing_and_stops_without_cleanup() {
    let _g = ONE_AT_A_TIME.lock().await;
    install(&[("before.write.start_intent", 99)]);
    let s = svc();
    assert!(s.place(&req()).await.is_err());
    set_hook(None);
    assert!(
        s.gamelift.starts().is_empty() && s.gamelift.terminated().is_empty(),
        "no effect without its committed intent"
    );
}
