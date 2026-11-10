use rh_protocol::{delta::*, *};

#[test]
fn independent_branch_tags_are_distinct_and_keep_their_payloads() {
    let commands = [
        (12, WireCommand::HuntTarget { actor: u32::MAX }),
        (
            13,
            WireCommand::ConsumeCorpse {
                handle: PickupHandle::new(1).unwrap(),
            },
        ),
        (
            14,
            WireCommand::Plan {
                spawn: Some(1),
                boon: Some(0),
                ready: Some(false),
            },
        ),
        (
            15,
            WireCommand::Train {
                command: 4,
                id: u32::MAX,
                count: u64::MAX,
                options: [1, 2, 79],
                option_count: 3,
            },
        ),
    ];
    for (tag, command) in commands {
        let message = ClientMsg::Input {
            seq: 9,
            commands: vec![command],
        };
        let bytes = message.try_encode().unwrap();
        assert_eq!(bytes[7], tag);
        assert_eq!(ClientMsg::decode(&bytes).unwrap(), message);
    }
}

#[test]
fn delta_zero_explicitly_clears_hunt_and_never_looks_like_a_zero_actor_reference() {
    let make = |target| {
        ServerMsg::SnapshotDelta(SnapshotDelta {
            tick: 11,
            server_time: snapshot_server_ms(11),
            base_tick: 10,
            training: true,
            owner_combat: None,
            phase: None,
            ack_input: 7,
            me: Some(SelfDelta {
                mask: DH_HUNT_TARGET | DH_HUNT_STACKS,
                hunt_target: target,
                hunt_stacks: 0,
                ..SelfDelta::default()
            }),
            changed: vec![],
            departed: vec![],
        })
    };
    let clear = make(None);
    let bytes = clear.try_encode().unwrap();
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), clear);
    assert!(make(Some(0)).try_encode().is_err());
    assert_eq!(DH_TRAINING, 1 << 20);
    assert_eq!(DH_KNOWN, (1 << 29) - 1);
    assert_eq!(
        DH_FIELDS & DH_TRAINING,
        0,
        "training does not require a self"
    );
}

#[test]
fn actual_writer_and_reference_chains_retain_training_and_clear_targets() {
    let (_, steps) = samples::chain_samples()
        .into_iter()
        .find(|(name, _)| *name == "union_training_hunt_clear")
        .unwrap();
    let mut tracker = SnapshotTracker::new();
    let mut saw_clear_delta = false;
    for step in steps {
        let message = tracker.decode(&step.frame).unwrap();
        let ServerMsg::Snapshot {
            training,
            me,
            actors,
            ..
        } = &message
        else {
            panic!("snapshot")
        };
        assert_eq!(tracker.snapshot(), Some(message.clone()));
        assert_eq!(actors[0].kind, 2);
        assert_eq!(actors[1].kind, 3);
        if step.frame[0] == 0x87 && me.as_ref().unwrap().hunt_target.is_none() {
            saw_clear_delta = true;
        }
        if tracker.held_tick() == Some(2) {
            assert!(*training);
        }
    }
    assert!(saw_clear_delta, "a full fallback would hide the clear bug");
    tracker.reset();
    assert!(tracker.snapshot().is_none());
}

#[test]
fn reward_card_positions_cover_the_catalog_and_refuse_the_next_position_atomically() {
    let (_, mut message) = samples::server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_full_catalog_rewards")
        .unwrap();
    assert_eq!(
        ServerMsg::decode(&message.try_encode().unwrap()).unwrap(),
        message
    );
    let ServerMsg::State { items, .. } = &mut message else {
        panic!()
    };
    let StateItem::RewardChests(rows) = &mut items[0] else {
        panic!()
    };
    rows[0].options[1].id = WireRewardId::Card(80);
    let mut bytes = vec![1, 2, 3];
    assert!(message.encode_into(&mut bytes).is_err());
    assert_eq!(bytes, [1, 2, 3]);
}
