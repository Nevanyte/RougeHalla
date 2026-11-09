use rh_protocol::{
    codec::Writer,
    delta::{diff, FrameKind, SnapshotDelta, SnapshotTracker},
    snapshot_server_ms, EncodeError, ServerMsg, TrackError, WireActor, WireOwnerCombat,
    WireOwnerLock, WireSelf,
};

fn actor(id: u32, kind: u8) -> WireActor {
    WireActor {
        id,
        kind,
        x: 10.0,
        y: 20.0,
        facing: 0.0,
        hp_pct: 100,
        status: 1,
        ..WireActor::default()
    }
}

fn owner(lock: WireOwnerLock) -> WireOwnerCombat {
    WireOwnerCombat {
        lock,
        draw_started_at: u32::MAX,
        ready_at: 42,
        as_milli: 50.0,
        windup_milli: f64::MAX,
        speed_milli: 65_000.0,
    }
}

fn snapshot(tick: u32, me: Option<WireSelf>, actors: &[WireActor]) -> rh_protocol::SnapshotData {
    rh_protocol::SnapshotData::build(tick, 1, tick, me, actors.iter().copied()).unwrap()
}

fn full(data: &rh_protocol::SnapshotData) -> Vec<u8> {
    let mut bytes = Vec::new();
    data.encode_full_into(&mut bytes);
    bytes
}

#[test]
fn full_group_round_trips_and_uses_all_closed_lock_shapes() {
    let me = Some(WireSelf {
        id: 7,
        ..WireSelf::default()
    });
    for lock in [
        WireOwnerLock::Clear,
        WireOwnerLock::Held { target: None },
        WireOwnerLock::Held { target: Some(99) },
    ] {
        let mut data = snapshot(10, me, &[actor(99, 1)]);
        data.set_owner_combat(Some(owner(lock))).unwrap();
        let bytes = full(&data);
        assert_eq!(bytes.len(), data.full_len());
        assert_eq!(bytes.len(), data.decoded().encoded_len());
        assert_eq!(ServerMsg::decode(&bytes).unwrap(), data.decoded());
        assert_eq!(data.owner_combat(), Some(owner(lock)));
    }
}

#[test]
fn rejected_builder_update_preserves_prior_group_and_checked_sizes() {
    let mut data = snapshot(
        10,
        Some(WireSelf {
            id: 7,
            ..WireSelf::default()
        }),
        &[actor(99, 1)],
    );
    let accepted = owner(WireOwnerLock::Held { target: Some(99) });
    data.set_owner_combat(Some(accepted)).unwrap();
    let size = data.full_len();
    assert_eq!(
        data.set_owner_combat(Some(owner(WireOwnerLock::Held { target: Some(100) }))),
        Err(EncodeError::BadValue("owner combat"))
    );
    assert_eq!(data.owner_combat(), Some(accepted));
    assert_eq!(data.full_len(), size);
    assert_eq!(full(&data), data.decoded().encode());

    let mut unavailable = snapshot(11, None, &[]);
    unavailable.set_owner_combat(None).unwrap();
    assert_eq!(unavailable.owner_combat(), None);
}

#[test]
fn delta_retains_explicitly_clears_and_replaces_on_current_npc_sequence_change() {
    let me = Some(WireSelf {
        id: 7,
        ..WireSelf::default()
    });
    let npc_a = actor(90, 2);
    let npc_b = actor(91, 2);
    let mut base = snapshot(20, me, &[npc_a]);
    let lock = owner(WireOwnerLock::Clear);
    base.set_owner_combat(Some(lock)).unwrap();

    let mut same = snapshot(21, me, &[npc_a]);
    same.set_owner_combat(Some(lock)).unwrap();
    let retain = diff(&base, &same).unwrap();
    assert_eq!(retain.owner_combat, None);

    let mut cleared = snapshot(21, me, &[npc_a]);
    cleared.set_owner_combat(None).unwrap();
    assert_eq!(diff(&base, &cleared).unwrap().owner_combat, Some(None));

    // The public NPC-reference sequence is part of the wire renewal predicate even if this group is otherwise unchanged.
    let mut changed_refs = snapshot(21, me, &[npc_b]);
    changed_refs.set_owner_combat(Some(lock)).unwrap();
    assert_eq!(
        diff(&base, &changed_refs).unwrap().owner_combat,
        Some(Some(lock))
    );
    let mut unavailable = snapshot(21, me, &[npc_b]);
    unavailable.set_owner_combat(None).unwrap();
    assert_eq!(
        diff(&snapshot(20, me, &[]), &unavailable)
            .unwrap()
            .owner_combat,
        None
    );
    assert_eq!(
        diff(&snapshot(20, me, &[]), &snapshot(21, me, &[]))
            .unwrap()
            .owner_combat,
        None,
        "an unavailable group on an empty scene stays omitted"
    );
}

#[test]
fn tracker_owner_loss_clears_and_dangling_retained_target_refuses_atomically() {
    let me = Some(WireSelf {
        id: 7,
        ..WireSelf::default()
    });
    let target = actor(99, 1);
    let mut base = snapshot(30, me, &[target]);
    let lock = owner(WireOwnerLock::Held { target: Some(99) });
    base.set_owner_combat(Some(lock)).unwrap();
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&full(&base)).unwrap();
    let held = tracker.snapshot();

    let dangling = SnapshotDelta {
        tick: 31,
        server_time: snapshot_server_ms(31),
        training: false,
        base_tick: 30,
        phase: None,
        ack_input: 31,
        me: Some(Default::default()),
        changed: vec![],
        departed: vec![99],
        owner_combat: None,
    };
    assert!(matches!(
        tracker.decode(&ServerMsg::SnapshotDelta(dangling).encode()),
        Err(TrackError::Delta(e)) if e.code() == "owner_combat"
    ));
    assert_eq!(tracker.snapshot(), held);

    let owner_lost = SnapshotDelta {
        tick: 31,
        server_time: snapshot_server_ms(31),
        training: false,
        base_tick: 30,
        phase: None,
        ack_input: 31,
        me: None,
        changed: vec![],
        departed: vec![],
        owner_combat: None,
    };
    let resolved = tracker
        .decode(&ServerMsg::SnapshotDelta(owner_lost).encode())
        .unwrap();
    assert!(matches!(
        resolved,
        ServerMsg::Snapshot {
            owner_combat: None,
            me: None,
            ..
        }
    ));
    let redundant_clear = SnapshotDelta {
        tick: 32,
        server_time: snapshot_server_ms(32),
        training: false,
        base_tick: 31,
        phase: None,
        ack_input: 32,
        me: None,
        changed: vec![],
        departed: vec![],
        owner_combat: Some(None),
    };
    assert!(matches!(
        tracker
            .decode(&ServerMsg::SnapshotDelta(redundant_clear).encode())
            .unwrap(),
        ServerMsg::Snapshot {
            owner_combat: None,
            me: None,
            ..
        }
    ));
}

#[test]
fn full_decode_and_direct_apply_refuse_dangling_target_before_held_state_changes() {
    let mut data = snapshot(
        40,
        Some(WireSelf {
            id: 7,
            ..WireSelf::default()
        }),
        &[],
    );
    data.set_owner_combat(None).unwrap();
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&full(&data)).unwrap();
    let held = tracker.snapshot();

    let invalid_full = ServerMsg::Snapshot {
        tick: 41,
        server_time: snapshot_server_ms(41),
        phase: 1,
        ack_input: 41,
        me: Some(WireSelf {
            id: 7,
            ..WireSelf::default()
        }),
        actors: vec![],
        training: false,
        owner_combat: Some(owner(WireOwnerLock::Held { target: Some(99) })),
    };
    assert_eq!(
        invalid_full.try_encode(),
        Err(EncodeError::BadValue("owner combat"))
    );
    assert_eq!(
        tracker.apply(invalid_full),
        Err(rh_protocol::delta::DeltaError::InvalidOwnerCombat)
    );
    assert_eq!(tracker.snapshot(), held);

    let mut raw = Writer::default();
    raw.u8(0x83);
    raw.varint(41);
    raw.varint(41);
    raw.varint((1 << 20) | 1); // owner group plus present self
    raw.varint(7);
    raw.f32(0.0);
    raw.f32(0.0);
    raw.f32(0.0);
    raw.varint(1145);
    raw.varint(0); // actors: target 99 is absent
    raw.u8(2);
    raw.varint(99);
    raw.u32(0);
    raw.u32(0);
    raw.f64(1000.0);
    raw.f64(1000.0);
    raw.f64(1000.0);
    assert_eq!(
        ServerMsg::decode(&raw.finish()),
        Err(rh_protocol::DecodeError::BadField("owner combat"))
    );
}

#[test]
fn conn_encoder_emits_reference_wire_and_omits_unchanged_group() {
    let me = Some(WireSelf {
        id: 7,
        ..WireSelf::default()
    });
    let mut first = snapshot(50, me, &[actor(99, 1)]);
    first
        .set_owner_combat(Some(owner(WireOwnerLock::Held { target: Some(99) })))
        .unwrap();
    let mut second = snapshot(51, me, &[actor(99, 1)]);
    second
        .set_owner_combat(Some(owner(WireOwnerLock::Held { target: Some(99) })))
        .unwrap();

    let mut encoder = rh_protocol::delta::ConnEncoder::new();
    let (full, kind) = encoder.encode_frame(first.clone());
    assert_eq!(kind, FrameKind::Full);
    assert_eq!(ServerMsg::decode(&full).unwrap(), first.decoded());
    let (delta, kind) = encoder.encode_frame(second.clone());
    assert_eq!(kind, FrameKind::Delta);
    let ServerMsg::SnapshotDelta(decoded) = ServerMsg::decode(&delta).unwrap() else {
        panic!("expected delta")
    };
    assert_eq!(decoded.owner_combat, None);
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&full).unwrap();
    assert_eq!(tracker.decode(&delta).unwrap(), second.decoded());

    let mut replacement = snapshot(52, me, &[actor(100, 1)]);
    let group = owner(WireOwnerLock::Held { target: Some(100) });
    replacement.set_owner_combat(Some(group)).unwrap();
    let reference = ServerMsg::SnapshotDelta(diff(&second, &replacement).unwrap()).encode();
    let (fast, kind) = encoder.encode_frame(replacement.clone());
    assert_eq!(kind, FrameKind::Delta);
    assert_eq!(fast, reference);
    assert_eq!(
        ServerMsg::decode(&fast).unwrap(),
        ServerMsg::SnapshotDelta(diff(&second, &replacement).unwrap())
    );
}
