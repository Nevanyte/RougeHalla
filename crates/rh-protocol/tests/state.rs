use rh_protocol::*;

fn handle(id: u32) -> PickupHandle {
    PickupHandle::new(id).unwrap()
}
fn field() -> WireField {
    WireField {
        kind: 2,
        ability: 3,
        owner: None,
        subject: Some(1),
        x: 20.,
        y: 30.,
        x2: 40.,
        y2: 50.,
        r: 12.,
        vx: -2.,
        vy: 0.,
        started_at: 1000.5,
        ends_at: 6000.5,
    }
}
fn state() -> ServerMsg {
    ServerMsg::State {
        tick: 200,
        items: vec![
            StateItem::Inventory(Some(WireInventory {
                active_slot: 1,
                slots: [None, Some(2)],
                potion_small: 5,
                potion_large: 4,
                potions_healing: 3,
            })),
            StateItem::Props(WireProps {
                rows: vec![
                    WireProp {
                        handle: handle(1),
                        x: 800,
                        y: 900,
                        kind: WirePropKind::Ground(0),
                    },
                    WireProp {
                        handle: handle(2),
                        x: 801,
                        y: 902,
                        kind: WirePropKind::Chest { open: true },
                    },
                    WireProp {
                        handle: handle(3),
                        x: 802,
                        y: 903,
                        kind: WirePropKind::Body {
                            label: "\u{feff}BÖB".into(),
                        },
                    },
                ],
                focus: Some(WireFocus {
                    handle: handle(3),
                    body_hint: Some(4),
                }),
            }),
            StateItem::Fields(vec![field(), field()]),
            StateItem::RewardChests(vec![WireRewardChest {
                handle: RewardChestHandle::new(u32::MAX).unwrap(),
                x: 100,
                y: 200,
                expires_at: 15000.,
                options: vec![
                    WireRewardOption {
                        id: WireRewardId::Card(0),
                        taken: false,
                        taken_by: None,
                    },
                    WireRewardOption {
                        id: WireRewardId::Boost(7),
                        taken: true,
                        taken_by: Some(1),
                    },
                ],
                picked: false,
                can_choose: true,
            }]),
            StateItem::Build(Some(WireBuild {
                cards: [1, 0, 1],
                boosts: [0, 1, 2, 3, 0, 1, 2, 3],
            })),
        ],
    }
}

#[test]
fn complete_replacement_keys_roundtrip_exactly_and_refuse_every_truncation() {
    let msg = state();
    let bytes = msg.try_encode().unwrap();
    assert_eq!(bytes.len(), msg.encoded_len());
    assert_eq!(ServerMsg::decode(&bytes).unwrap(), msg);
    for end in 0..bytes.len() {
        assert!(ServerMsg::decode(&bytes[..end]).is_err(), "prefix {end}");
    }
    let empty = ServerMsg::State {
        tick: 201,
        items: vec![
            StateItem::Inventory(None),
            StateItem::Props(WireProps::default()),
            StateItem::Fields(vec![]),
            StateItem::RewardChests(vec![]),
            StateItem::Build(None),
        ],
    };
    assert_eq!(
        ServerMsg::decode(&empty.try_encode().unwrap()).unwrap(),
        empty
    );
}

#[test]
fn unsafe_key_handle_kind_and_count_combinations_are_refused() {
    assert!(PickupHandle::new(0).is_none());
    assert!(RewardChestHandle::new(0).is_none());
    for raw in [
        vec![0x88, 0, 2, 1, 0, 1, 0],          // duplicate key
        vec![0x88, 0, 2, 3, 0, 1, 0],          // out-of-order key
        vec![0x88, 0, 1, 8],                   // unknown key
        vec![0x88, 0, 1, 2, 0x81, 4],          // too many props, before row allocation
        vec![0x88, 0, 1, 3, 0x81, 4],          // too many fields
        vec![0x88, 0, 1, 1, 1, 0, 0, 0, 6, 0], // impossible stored potion count
        vec![0x88, 0, 1, 1, 1, 0, 0, 0, 0, 4], // impossible active healing count
    ] {
        assert!(ServerMsg::decode(&raw).is_err(), "{raw:?}");
    }
    let prop = WireProp {
        handle: handle(1),
        x: 0,
        y: 0,
        kind: WirePropKind::Ground(0),
    };
    for props in [
        WireProps {
            rows: vec![prop.clone(), prop.clone()],
            focus: None,
        },
        WireProps {
            rows: vec![prop.clone()],
            focus: Some(WireFocus {
                handle: handle(2),
                body_hint: None,
            }),
        },
        WireProps {
            rows: vec![prop],
            focus: Some(WireFocus {
                handle: handle(1),
                body_hint: Some(0),
            }),
        },
    ] {
        assert!(ServerMsg::State {
            tick: 0,
            items: vec![StateItem::Props(props)]
        }
        .try_encode()
        .is_err());
    }
    let mut bad = field();
    bad.owner = Some(0);
    assert!(ServerMsg::State {
        tick: 0,
        items: vec![StateItem::Fields(vec![bad])]
    }
    .try_encode()
    .is_err());
    bad = field();
    bad.r = f32::INFINITY;
    assert!(ServerMsg::State {
        tick: 0,
        items: vec![StateItem::Fields(vec![bad])]
    }
    .try_encode()
    .is_err());
}

#[test]
fn scalar_status_changes_and_clears_survive_full_and_fast_delta_paths() {
    let me = WireSelf {
        sig: 255,
        id: 1,
        faction: 0,
        x: 100.,
        y: 100.,
        facing: 0.,
        hp: 900.,
        max_hp: 950.,
        status: 1,
        weapon: 0,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        hunt_target: None,
        hunt_stacks: 0,
        effects: 4096 | 8,
        displace_seq: 255,
    };
    let actors: Vec<_> = (2..18)
        .map(|id| WireActor {
            sig: 255,
            mob_type_code: 30,
            id,
            faction: 0,
            x: 200.,
            y: 100.,
            facing: 0.,
            hp_pct: 100,
            status: 1,
            weapon: 0,
            bounty: 0,
            kind: 1,
            effects: 256,
            displace_seq: 1,
        })
        .collect();
    let first = SnapshotData::build(10, 1, 0, Some(me), actors.clone().into_iter()).unwrap();
    let mut next_me = me;
    next_me.sig = 0;
    next_me.effects = 0;
    next_me.displace_seq = 0;
    let mut next_actors = actors;
    next_actors[0].sig = 0;
    next_actors[0].mob_type_code = 0;
    next_actors[0].effects = 0;
    next_actors[0].displace_seq = 0;
    let second =
        SnapshotData::build(11, 1, 0, Some(next_me), next_actors.clone().into_iter()).unwrap();
    let reference = rh_protocol::delta::diff(&first, &second).unwrap();
    let reference_bytes = ServerMsg::SnapshotDelta(reference).encode();
    let mut encoder = ConnEncoder::default();
    let (a, kind) = encoder.encode_frame(first);
    assert_eq!(kind, FrameKind::Full);
    let (b, kind) = encoder.encode_frame(second);
    assert_eq!(kind, FrameKind::Delta);
    assert_eq!(&*b, &reference_bytes);
    let mut tracker = SnapshotTracker::default();
    tracker.decode(&a).unwrap();
    let decoded = tracker.decode(&b).unwrap();
    assert_eq!(
        decoded,
        ServerMsg::Snapshot {
            tick: 11,
            phase: 1,
            ack_input: 0,
            me: Some(next_me),
            actors: next_actors.iter().map(WireActor::quantized).collect()
        }
    );
}
