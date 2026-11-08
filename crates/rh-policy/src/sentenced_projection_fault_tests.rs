use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
struct Active {
    calls: Arc<AtomicUsize>,
}
impl Policy for Active {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "projection-fault-active-control".into(),
            version: "1".into(),
            contract: POLICY_CONTRACT_VERSION,
            observation_version: OBSERVATION_VERSION,
            decision_interval_ticks: 1,
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        vec![PublicCommand::Target { actor: PlayerId(1) }]
    }
}
fn scene() -> Sim {
    Sim::reset_active(
        rh_sim::SimConfig {
            quests: false,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        rh_sim::Secrets::from_seed(12),
        &(0..3)
            .map(|i| rh_sim::Placement {
                profile: format!("fault{i}"),
                faction: if i == 0 {
                    rh_sim::FactionId::Sentenced
                } else {
                    rh_sim::FactionId::Holy
                },
                bot: false,
                at: rh_sim::Vec2::new(400. + i as f64 * 56., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}
fn seat(sim: &Sim) -> (Seat, Arc<AtomicUsize>, Arc<AtomicUsize>) {
    let policy = Arc::new(AtomicUsize::new(0));
    let fallback = Arc::new(AtomicUsize::new(0));
    let mut seat = Seat::new(
        &MatchStart::of(sim, PlayerId(2), 1),
        Box::new(Active {
            calls: Arc::clone(&policy),
        }),
        Box::new(Active {
            calls: Arc::clone(&fallback),
        }),
    );
    seat.bind_fx(sim).unwrap();
    (seat, policy, fallback)
}
fn assert_refuses(
    sim: &mut Sim,
    seat: &mut Seat,
    policy: &AtomicUsize,
    fallback: &AtomicUsize,
    error: rh_sim::FxError,
) {
    assert!(sim.player(PlayerId(2)).unwrap().standing());
    assert!(seat.wants(sim.tick()), "alive seat must actually be due");
    let cadence = seat.next_tick;
    let stats = seat.stats.clone();
    let obs = seat.obs.clone();
    let hash = sim.state_hash();
    let missing = rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap();
    assert_eq!(
        seat.observer
            .resolve(sim, PublicCommand::Target { actor: PlayerId(1) })
            .unwrap(),
        missing,
        "no complete observation has issued actor eligibility"
    );
    // A stale buffered event must be discarded even on an already-faulted feed.
    seat.pending.push(SeenEvent::Heal {
        id: PlayerId(2),
        amount: 1.,
    });
    let mut attempts = 0;
    drive_inner(sim, std::slice::from_mut(seat), &[], None, |_, _| {
        attempts += 1
    });
    assert_eq!(seat.fault, Some(Fault::FxProjection(error)));
    assert_eq!(attempts, 0);
    assert_eq!(seat.stats, stats);
    assert_eq!(seat.next_tick, cadence);
    assert_eq!(seat.obs, obs);
    assert!(seat.pending.is_empty());
    assert_eq!(policy.load(Ordering::SeqCst), 0);
    assert_eq!(fallback.load(Ordering::SeqCst), 0);
    assert_eq!(sim.state_hash(), hash);
    assert_eq!(
        seat.observer
            .resolve(sim, PublicCommand::Target { actor: PlayerId(1) })
            .unwrap(),
        missing
    );
    let mut commands = vec![];
    seat.decide_into(&rh_sim::observe(sim, PlayerId(2), &[]), &mut commands);
    assert!(commands.is_empty());
    assert_eq!(seat.next_tick, cadence);
    assert_eq!(seat.stats, stats);
}
fn fresh_control(sim: &mut Sim) {
    let (mut fresh, policy, fallback) = seat(sim);
    let before = sim.tick();
    sim.step();
    let mut attempts = 0;
    drive_inner(sim, std::slice::from_mut(&mut fresh), &[], None, |_, _| {
        attempts += 1
    });
    assert!(fresh.fault.is_none());
    assert_eq!(policy.load(Ordering::SeqCst), 1);
    assert_eq!(fallback.load(Ordering::SeqCst), 0);
    assert_eq!(fresh.stats.decisions, 1);
    assert_eq!(fresh.stats.accepted, 1);
    assert_eq!(attempts, 1);
    assert!(fresh.next_tick > before);
    assert!(fresh.obs.me.is_some());
    assert_ne!(
        fresh
            .observer
            .resolve(sim, PublicCommand::Target { actor: PlayerId(1) })
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap()
    );
}
#[test]
fn foreign_clone_fault_never_observes_decides_advances_or_submits_and_stays_failed() {
    let source = scene();
    let (mut failed, policy, fallback) = seat(&source);
    let mut foreign = source.clone();
    foreign.step();
    feed_seats(&foreign, std::slice::from_mut(&mut failed));
    assert_refuses(
        &mut foreign,
        &mut failed,
        &policy,
        &fallback,
        rh_sim::FxError::ForeignInstance,
    );
    foreign.step();
    assert_refuses(
        &mut foreign,
        &mut failed,
        &policy,
        &fallback,
        rh_sim::FxError::ForeignInstance,
    );
    fresh_control(&mut foreign);
}
/// Trusted restored volley, not claimed to arise from ordinary power-zero command intake.
fn dense_mark_step() -> Sim {
    use serde_json::json;
    let original = scene();
    let mut cp = serde_json::to_value(&original).unwrap();
    cp["world"]["players"][0]["core"]["weapon"]["weapon0"] = json!("Bow");
    cp["world"]["players"][1]["core"]["body"]["x"] = json!(800.);
    cp["world"]["players"][2]["core"]["body"]["y"] = json!(600.);
    let mut sim = Sim::restore(cp).unwrap();
    sim.submit(
        PlayerId(1),
        rh_sim::validate(rh_sim::RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    let mut cp = serde_json::to_value(&sim).unwrap();
    for _ in 0..40 {
        sim.step();
        cp = serde_json::to_value(&sim).unwrap();
        if !cp["world"]["projectiles"].as_array().unwrap().is_empty() {
            break;
        }
    }
    let flight = cp["world"]["projectiles"][0].clone();
    assert!(flight.is_object());
    let x = flight["pos"]["x"].as_f64().unwrap() + 35.;
    let y = flight["pos"]["y"].as_f64().unwrap();
    cp["world"]["projectiles"] = json!((1..=200)
        .map(|id| {
            let mut p = flight.clone();
            p["launch"]["id"] = json!(id);
            p
        })
        .collect::<Vec<_>>());
    cp["world"]["entity_counter"] = json!(200);
    let p = &mut cp["world"]["players"][1];
    p["core"]["body"]["x"] = json!(x);
    p["core"]["body"]["history"] = json!([{"t":sim.server_time(),"x":x,"y":y}]);
    p["core"]["vitals"]["hp"] = json!(1000000.);
    let mut sim =
        Sim::restore(cp).expect("existing checkpoint admission accepts this helper volley");
    sim.submit(
        PlayerId(1),
        rh_sim::validate(rh_sim::RawCommand::Stop { seq: None }).unwrap(),
    )
    .unwrap();
    sim
}
#[test]
fn dense_mark_report_fault_never_issues_authority_or_calls_policy_or_fallback() {
    let mut sim = dense_mark_step();
    let (mut failed, policy, fallback) = seat(&sim);
    let events = sim.step();
    assert!(events.len() > 512);
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(
                e,
                Event::SignatureHit {
                    sig: rh_sim::factions::SignatureKind::Mark,
                    ..
                }
            ))
            .count(),
        200
    );
    assert!(sim.player(PlayerId(2)).unwrap().vitals.hp < 1000000.);
    feed_seats(&sim, std::slice::from_mut(&mut failed));
    assert_refuses(
        &mut sim,
        &mut failed,
        &policy,
        &fallback,
        rh_sim::FxError::UnsupportedBounds,
    );
    sim.step();
    assert_refuses(
        &mut sim,
        &mut failed,
        &policy,
        &fallback,
        rh_sim::FxError::UnsupportedBounds,
    );
    fresh_control(&mut sim);
}
