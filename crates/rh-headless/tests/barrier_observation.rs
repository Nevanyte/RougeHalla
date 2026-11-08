//! Trusted checkpoint probes exercise public refusal; no native barrier producer or source parity is claimed.
use rh_headless::{digest::OutcomeDigest, Env};
use rh_policy::{drive_seats_with, scripted::Idle, Fault, MatchStart, Seat};
use rh_sim::{FactionId, OfferError, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn scene(hidden: bool, barrier: f64) -> Sim {
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(100., 176.)];
    let placements = [("one", 100.), ("two", if hidden { 300. } else { 150. })]
        .into_iter()
        .map(|(profile, x)| Placement {
            profile: profile.into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(x, 176.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let sim = Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(9),
        &placements,
    );
    let mut value = serde_json::to_value(&sim).unwrap();
    value["world"]["players"][1]["core"]["vitals"]["barrier"] = barrier.into();
    let sim = Sim::restore(&mut serde_json::Deserializer::from_str(&value.to_string())).unwrap();
    assert_eq!(
        sim.players()[1].vitals.barrier,
        barrier,
        "declared checkpoint pre-state is applied"
    );
    sim
}

#[test]
fn headless_checkpoint_refusal_is_typed_and_a_valid_new_session_recovers() {
    assert!(matches!(
        Env::from_external_checkpoint(scene(false, 1e300), 20),
        Err(OfferError::UnrepresentablePublicVitals)
    ));
    let (_, full) = Env::from_external_checkpoint(scene(false, 25.), 20).unwrap();
    assert_eq!(full.len(), 2);
    assert_eq!(full[1].me.as_ref().unwrap().barrier, 25.);
    assert!(full[0].visible[0].barrier_frac > 0.);
}

#[test]
fn synchronous_policy_fault_is_per_view_and_never_delivers_the_invalid_owner() {
    let mut sim = scene(true, 1e300);
    let mut seats: Vec<_> = [PlayerId(1), PlayerId(2)]
        .into_iter()
        .map(|id| {
            let mut seat = Seat::new(&MatchStart::of(&sim, id, 7), Box::new(Idle), Box::new(Idle));
            seat.bind_fx(&sim).unwrap();
            seat
        })
        .collect();
    drive_seats_with(
        &mut sim,
        &mut seats,
        &[],
        &mut rh_sim::SightCache::new(),
        |_, _| {},
    );
    assert_eq!(seats[0].fault, None);
    assert_eq!(seats[0].stats.decisions, 1);
    assert_eq!(
        seats[1].fault,
        Some(Fault::ItemObservation(
            OfferError::UnrepresentablePublicVitals
        ))
    );
    assert_eq!(seats[1].stats.decisions, 0);
}

#[test]
fn checked_private_digest_refuses_atomically_and_folds_the_new_public_barrier() {
    let good = scene(false, 0.);
    let mut digest = OutcomeDigest::new();
    digest.try_tick(&good, &[]).unwrap();
    let before = digest.clone();
    assert_eq!(
        digest.try_tick(&scene(false, 1e300), &[]),
        Err(OfferError::UnrepresentablePublicVitals)
    );
    assert_eq!(digest.value(), before.value());
    assert_eq!(
        (digest.ticks(), digest.events()),
        (before.ticks(), before.events())
    );
    let mut control = before.clone();
    control.try_tick(&good, &[]).unwrap();
    digest.try_tick(&good, &[]).unwrap();
    assert_eq!(digest.value(), control.value());
    let mut barrier = OutcomeDigest::new();
    barrier.try_tick(&scene(false, 25.), &[]).unwrap();
    assert_ne!(barrier.value(), before.value());
}

#[test]
fn async_policy_refuses_before_worker_delivery_or_submission() {
    let mut sim = scene(false, 1e300);
    let mut seat = rh_policy::AsyncSeat::spawn(
        &MatchStart::of(&sim, PlayerId(2), 9),
        Box::new(Idle),
        Box::new(Idle),
        2,
    );
    seat.bind_fx(&sim).unwrap();
    assert_eq!(
        seat.poll(&mut sim, &[], |_, _| panic!(
            "invalid observation submitted a command"
        )),
        Err(OfferError::UnrepresentablePublicVitals)
    );
}
