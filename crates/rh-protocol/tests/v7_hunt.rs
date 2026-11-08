//! Protocol 7: the Sentenced-hunt command and self fields.
use rh_protocol::*;

fn self_view() -> WireSelf {
    WireSelf {
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id: 1,
        faction: 4,
        x: 400.0,
        y: 320.0,
        facing: 0.0,
        hp: 1000.0,
        max_hp: 1000.0,
        status: 1,
        weapon: 5,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        hunt_target: Some(2),
        hunt_stacks: 3,
    }
}

#[test]
fn hunt_command_round_trips_and_zero_is_refused() {
    let msg = ClientMsg::Input {
        seq: 7,
        commands: vec![WireCommand::HuntTarget { actor: 2 }],
    };
    let bytes = msg.encode();
    assert_eq!(ClientMsg::decode(&bytes), Ok(msg));
    let zero = [2, 7, 0, 0, 0, 1, 0, 12, 0, 0, 0, 0];
    assert_eq!(
        ClientMsg::decode(&zero),
        Err(DecodeError::BadField("hunt target"))
    );
}

#[test]
fn full_self_hunt_fields_round_trip_and_zero_target_is_refused() {
    let msg = ServerMsg::Snapshot {
        tick: 1,
        phase: 1,
        ack_input: 0,
        me: Some(self_view()),
        actors: vec![],
    };
    let bytes = msg.encode();
    let ServerMsg::Snapshot { me, .. } = ServerMsg::decode(&bytes).unwrap() else {
        panic!("snapshot")
    };
    assert_eq!(me.unwrap().hunt_target, Some(2));
    assert_eq!(me.unwrap().hunt_stacks, 3);

    let mut bad = self_view();
    bad.hunt_target = Some(0);
    let msg = ServerMsg::Snapshot {
        tick: 1,
        phase: 1,
        ack_input: 0,
        me: Some(bad),
        actors: vec![],
    };
    assert!(msg.try_encode().is_err());
}

#[test]
fn a_delta_carries_hunt_target_and_stacks() {
    let full = ServerMsg::Snapshot {
        tick: 1,
        phase: 1,
        ack_input: 0,
        me: Some(WireSelf {
            hunt_target: None,
            ..self_view()
        }),
        actors: vec![],
    };
    let mut tracker = SnapshotTracker::new();
    tracker.decode(&full.encode()).unwrap();
    let delta = ServerMsg::SnapshotDelta(SnapshotDelta {
        tick: 2,
        base_tick: 1,
        ack_input: 0,
        phase: None,
        me: Some(SelfDelta {
            mask: delta::DH_HUNT_TARGET | delta::DH_HUNT_STACKS,
            hunt_target: Some(2),
            hunt_stacks: 3,
            ..SelfDelta::default()
        }),
        changed: vec![],
        departed: vec![],
    });
    let bytes = delta.encode();
    let decoded = tracker.decode(&bytes).unwrap();
    let ServerMsg::Snapshot { me, .. } = decoded else {
        panic!("snapshot")
    };
    assert_eq!(me.unwrap().hunt_target, Some(2));
    assert_eq!(me.unwrap().hunt_stacks, 3);
}
