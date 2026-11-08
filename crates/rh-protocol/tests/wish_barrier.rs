use rh_protocol::*;

fn wish() -> WireWishOwner {
    WireWishOwner {
        ability: 3,
        ready_at: 2_000.5,
        full_at: Some(6_000.5),
        max_charges: 2,
        recharge_ms: 4_000.0,
        charges: 1,
        next_charge_at: Some(4_000.5),
        cast: Some(WireWishCast {
            ability: 3,
            started_at: 2_500.25,
            lands_at: 2_900.75,
        }),
    }
}

fn self_view(wish: Option<WireWishOwner>, barrier: f32, ring: u8) -> WireSelf {
    WireSelf {
        id: 1,
        x: 100.0,
        y: 200.0,
        facing: 0.5,
        hp: 100.0,
        max_hp: 100.0,
        faction: 1,
        weapon: 2,
        status: 1,
        wish,
        barrier,
        barrier_ring_step: ring,
        ..WireSelf::default()
    }
}

fn actor(barrier_pct: u8, ring: u8) -> WireActor {
    WireActor {
        id: 2,
        x: 120.0,
        y: 220.0,
        facing: 0.0,
        faction: 1,
        weapon: 2,
        status: 1,
        hp_pct: 100,
        barrier_pct,
        barrier_ring_step: ring,
        ..WireActor::default()
    }
}

#[test]
fn wish_barrier_clear_and_per_frame_time_are_lossless_through_tracker() {
    let first = SnapshotData::build_with_server_time(
        40,
        2_025.5,
        1,
        3,
        Some(self_view(Some(wish()), 38.5, 4)),
        [actor(77, 6)].into_iter(),
    )
    .unwrap();
    let mut encoder = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let (full, kind) = encoder.encode_frame(first.clone());
    assert_eq!(kind, FrameKind::Full);
    assert_eq!(tracker.decode(&full).unwrap(), first.decoded());

    let cleared = SnapshotData::build(
        41,
        1,
        4,
        Some(self_view(None, 0.0, 0)),
        [actor(0, 0)].into_iter(),
    )
    .unwrap();
    let (delta, kind) = encoder.encode_frame(cleared.clone());
    assert_eq!(kind, FrameKind::Delta);
    let got = tracker.decode(&delta).unwrap();
    assert_eq!(got, cleared.decoded());
    let ServerMsg::Snapshot {
        server_time,
        me: Some(me),
        actors,
        ..
    } = got
    else {
        panic!("snapshot");
    };
    assert_eq!(
        server_time, 2_050.0,
        "a default delta clock belongs to its own tick"
    );
    assert_eq!(me.wish, None);
    assert_eq!(me.barrier.to_bits(), 0.0f32.to_bits());
    assert_eq!(me.barrier_ring_step, 0);
    assert_eq!((actors[0].barrier_pct, actors[0].barrier_ring_step), (0, 0));
}

#[test]
fn cast_slot_and_option_matrix_round_trips_and_bad_closed_values_are_refused() {
    let vectors = samples::client_samples();
    let casts: Vec<_> = vectors
        .into_iter()
        .filter(|(n, _)| n.starts_with("input_cast_matrix"))
        .collect();
    let mut slots = [false; 3];
    let mut masks = [false; 8];
    let mut count = 0;
    for (name, message) in casts {
        let bytes = message.encode();
        assert_eq!(ClientMsg::decode(&bytes).unwrap(), message, "{name}");
        let ClientMsg::Input { commands, .. } = message else {
            panic!("input");
        };
        for command in commands {
            let WireCommand::Cast {
                slot,
                actor,
                t,
                seq,
                ..
            } = command
            else {
                panic!("cast");
            };
            slots[slot as usize] = true;
            let mask = usize::from(actor.is_some())
                | (usize::from(t.is_some()) << 1)
                | (usize::from(seq.is_some()) << 2);
            masks[mask] = true;
            count += 1;
        }
    }
    assert_eq!(count, 24);
    assert!(slots.into_iter().all(|v| v));
    assert!(masks.into_iter().all(|v| v));
    assert!(ClientMsg::Input {
        seq: 0,
        commands: vec![WireCommand::Cast {
            slot: 3,
            x: 1.0,
            y: 2.0,
            actor: None,
            t: None,
            seq: None
        }]
    }
    .try_encode()
    .is_err());
    assert!(ClientMsg::Input {
        seq: 0,
        commands: vec![WireCommand::Cast {
            slot: 1,
            x: 1.0,
            y: 2.0,
            actor: Some(0),
            t: None,
            seq: None
        }]
    }
    .try_encode()
    .is_err());
}

#[test]
fn landed_fx_rejects_open_or_mismatched_geometry() {
    let fx = |ability, anchor, destination, caster| ServerMsg::Fx {
        tick: 1,
        fx: vec![WireFx::WishLanded {
            event_time: 50.0,
            ability,
            caster,
            target: Some(9),
            anchor,
            destination,
        }],
    };
    let point = Some(WirePoint { x: 100.0, y: 200.0 });
    assert!(fx(3, point, point, Some(7)).try_encode().is_ok());
    assert!(fx(3, point, None, Some(7)).try_encode().is_err());
    assert!(fx(1, None, point, Some(7)).try_encode().is_err());
    assert!(fx(3, None, None, None).try_encode().is_err());
}
