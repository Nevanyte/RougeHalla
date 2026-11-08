//! Native publication refusal seams only. Protocol11 does not publish the new barrier fields.
use rh_protocol::{ConnEncoder, ServerMsg};
use rh_server::wire::{PrepareFramesError, Publisher, ViewFrames};
use rh_sim::{
    observe::SeenEvent, FactionId, ItemObserver, OfferError, Placement, PlayerId, Secrets, Sim,
    SimConfig, Vec2,
};

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
fn full_bytes(frame: ViewFrames) -> (Option<Vec<u8>>, Option<Vec<u8>>, Vec<u8>) {
    assert!(frame.refused.is_none());
    let mut bytes = Vec::new();
    frame.snapshot.unwrap().encode_full_into(&mut bytes);
    assert!(matches!(
        ServerMsg::decode(&bytes).unwrap(),
        ServerMsg::Snapshot { .. }
    ));
    (frame.important, frame.fx, bytes)
}

#[test]
fn hidden_bad_vitals_keep_successful_published_frames_identical() {
    let mut publisher = Publisher::default();
    let normal =
        full_bytes(publisher.frames(&scene(true, 0.), PlayerId(1), 7, &[], &mut Vec::new(), &[]));
    let hidden_bad = full_bytes(publisher.frames(
        &scene(true, 1e300),
        PlayerId(1),
        7,
        &[],
        &mut Vec::new(),
        &[],
    ));
    assert_eq!(normal, hidden_bad);
}

#[test]
fn preview_numeric_refusal_emits_no_partial_frames_or_catchup_consumption() {
    let mut publisher = Publisher::default();
    let mut carry = vec![SeenEvent::Bounty {
        id: PlayerId(1),
        bounty: 7,
    }];
    let before = carry.clone();
    let frames = publisher.frames(&scene(false, 1e300), PlayerId(1), 0, &[], &mut carry, &[]);
    assert!(matches!(
        frames.snapshot,
        Err(rh_protocol::EncodeError::BadValue("public vitals"))
    ));
    assert!(frames.important.is_none() && frames.fx.is_none());
    assert_eq!(carry, before);
    assert!(publisher
        .frames(&scene(false, 25.), PlayerId(1), 0, &[], &mut carry, &[])
        .snapshot
        .is_ok());
    assert!(carry.is_empty());
}

#[test]
fn prepared_refusal_keeps_carry_handles_and_connection_baseline_uncommitted() {
    let original = scene(false, 0.);
    let mut publisher = Publisher::default();
    let mut control_publisher = Publisher::default();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut control_observer = ItemObserver::new(PlayerId(1));
    let mut encoder = ConnEncoder::new();
    let mut control_encoder = ConnEncoder::new();
    for (p, o, e) in [
        (&mut publisher, &mut observer, &mut encoder),
        (
            &mut control_publisher,
            &mut control_observer,
            &mut control_encoder,
        ),
    ] {
        let (frames, offer) = p
            .frames_prepared(o, None, &original, 0, &[], &mut Vec::new(), &[])
            .unwrap();
        e.encode(frames.snapshot.unwrap(), &mut Vec::new());
        offer.commit();
    }
    let mut carry = vec![SeenEvent::Bounty {
        id: PlayerId(1),
        bounty: 7,
    }];
    let before = carry.clone();
    assert!(matches!(
        publisher.frames_prepared(
            &mut observer,
            None,
            &scene(false, 1e300),
            0,
            &[],
            &mut carry,
            &[]
        ),
        Err(PrepareFramesError::Offer(
            OfferError::UnrepresentablePublicVitals
        ))
    ));
    assert_eq!(carry, before);
    let mut recovered = scene(false, 25.);
    recovered.step();
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for (p, o, e, bytes) in [
        (&mut publisher, &mut observer, &mut encoder, &mut actual),
        (
            &mut control_publisher,
            &mut control_observer,
            &mut control_encoder,
            &mut expected,
        ),
    ] {
        let mut carried = before.clone();
        let (frames, offer) = p
            .frames_prepared(o, None, &recovered, 9, &[], &mut carried, &[])
            .unwrap();
        e.encode(frames.snapshot.unwrap(), bytes);
        offer.commit();
        assert!(carried.is_empty());
    }
    assert_eq!(actual, expected);
    assert_eq!(publisher.observation(), control_publisher.observation());
}
