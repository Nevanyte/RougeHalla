use rh_protocol::{
    delta::{ActorDelta, SnapshotDelta, AD_KIT, AD_X},
    snapshot_server_ms, EncodeError, ServerMsg, SnapshotData, SnapshotTracker, TrackError,
    WireActor,
};

fn actor(kind: u8, faction: u8, weapon: u8, mob_type_code: u8) -> WireActor {
    WireActor {
        id: 5,
        kind,
        faction,
        weapon,
        mob_type_code,
        x: 123.125,
        y: 456.75,
        facing: -0.75,
        hp_pct: 73,
        status: 1,
        bounty: 321,
        effects: 0x1234,
        displace_seq: 17,
        sig: 29,
        barrier_pct: 11,
        barrier_ring_step: 2,
    }
}

fn full(actor: WireActor) -> ServerMsg {
    ServerMsg::Snapshot {
        tick: 10,
        server_time: snapshot_server_ms(10),
        phase: 1,
        ack_input: 0,
        me: None,
        actors: vec![actor],
        training: false,
        owner_combat: None,
    }
}

#[test]
fn giver_tuple_is_contextual_and_unknown_kinds_keep_their_full_domains() {
    let giver = actor(4, 15, 15, 0);
    let bytes = full(giver).try_encode().unwrap();
    let decoded = ServerMsg::decode(&bytes).unwrap();
    let ServerMsg::Snapshot { actors, .. } = decoded else {
        panic!("snapshot expected")
    };
    assert_eq!(actors[0], giver.quantized());

    for bad in [
        actor(4, 0, 0, 0),
        actor(4, 15, 0, 0),
        actor(4, 0, 15, 0),
        actor(4, 15, 15, 1),
    ] {
        assert!(matches!(
            SnapshotData::build(10, 1, 0, None, [bad].into_iter()),
            Err(EncodeError::BadValue("giver actor"))
        ));
        assert!(matches!(
            full(bad).try_encode(),
            Err(EncodeError::BadValue("giver actor"))
        ));
    }

    // Kind values remain extensible and all four-bit kit values remain valid outside kind 4.
    let opaque = actor(255, 15, 15, 15);
    let opaque_bytes = full(opaque).try_encode().unwrap();
    let want = SnapshotData::build(10, 1, 0, None, [opaque].into_iter())
        .unwrap()
        .decoded();
    assert_eq!(ServerMsg::decode(&opaque_bytes).unwrap(), want);
}

#[test]
fn retained_delta_fields_are_checked_after_reconstruction_and_refusal_is_atomic() {
    let base = full(actor(4, 15, 15, 0));
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&base.try_encode().unwrap()).unwrap();
    let held = tracker.snapshot();

    let invalid = ServerMsg::SnapshotDelta(SnapshotDelta {
        tick: 11,
        server_time: snapshot_server_ms(11),
        base_tick: 10,
        training: false,
        owner_combat: None,
        phase: None,
        ack_input: 1,
        me: None,
        changed: vec![ActorDelta {
            mask: AD_KIT,
            q: rh_protocol::QActor {
                id: 5,
                kit: 0x0f,
                ..rh_protocol::QActor::default()
            },
        }],
        departed: Vec::new(),
    });
    let err = tracker.decode(&invalid.try_encode().unwrap()).unwrap_err();
    assert!(matches!(err, TrackError::Delta(e) if e.code() == "giver_actor"));
    assert_eq!(tracker.snapshot(), held);

    // A coordinate-only partial update retains kind4, kitFF and mob_type_code0 and remains valid.
    let valid = ServerMsg::SnapshotDelta(SnapshotDelta {
        tick: 11,
        server_time: snapshot_server_ms(11),
        base_tick: 10,
        training: false,
        owner_combat: None,
        phase: None,
        ack_input: 1,
        me: None,
        changed: vec![ActorDelta {
            mask: AD_X,
            q: rh_protocol::QActor {
                id: 5,
                x: 900,
                ..rh_protocol::QActor::default()
            },
        }],
        departed: Vec::new(),
    });
    tracker.decode(&valid.try_encode().unwrap()).unwrap();
    assert_eq!(tracker.held_tick(), Some(11));
    assert_eq!(tracker.actors()[0].kind, 4);
    assert_eq!(
        (tracker.actors()[0].faction, tracker.actors()[0].weapon),
        (15, 15)
    );
}

#[test]
fn direct_apply_rejects_invalid_full_before_replacing_held_state() {
    let mut tracker = SnapshotTracker::new();
    let base = full(actor(255, 15, 15, 15));
    tracker.apply(base).unwrap();
    let held = tracker.snapshot();

    let error = tracker.apply(full(actor(4, 0, 0, 0))).unwrap_err();
    assert_eq!(error, rh_protocol::delta::DeltaError::InvalidGiverActor(5));
    assert_eq!(tracker.snapshot(), held);
}
