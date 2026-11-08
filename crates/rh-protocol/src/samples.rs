//! The golden vectors: deterministic sample messages, and frames that must be rejected. `protocol/fixtures/v11.json` is
//! generated from these (`cargo run -p rh-protocol --bin protocol-fixtures`) and read by the Rust, C# and JS tests. A
//! Snapshot or Fx vector also carries what a client must DECODE (floats as their exact bit patterns), so the three decoders are
//! held to the same quantization, not just to the same bytes.

use crate::delta::{
    AD_ALL, AD_BOUNTY, AD_HP, AD_NEW, AD_STATUS, AD_X, DH_DEPARTED, DH_GV, DH_HP, DH_KILLS,
    DH_MOVE_SEQ, DH_PHASE, DH_PRESENT, DH_STATUS, DH_X, DH_Y,
};
use crate::map::MapBlob;
use crate::*;
use crate::{AM_BOUNTY, AM_HP, AM_STATUS};

// The aim of -3.1415927 is deliberate: an f32 at the -PI edge of the angle range.
#[allow(clippy::approx_constant)]
pub fn client_samples() -> Vec<(&'static str, ClientMsg)> {
    vec![
        (
            "input_pve",
            ClientMsg::Input {
                seq: 45,
                commands: vec![
                    WireCommand::UseConsumable,
                    WireCommand::Target { actor: u32::MAX },
                    WireCommand::AttackMove {
                        x: 10.5,
                        y: -0.0,
                        seq: None,
                    },
                    WireCommand::AttackMove {
                        x: -1.0,
                        y: 20.0,
                        seq: Some(255),
                    },
                ],
            },
        ),
        (
            "input_choices",
            ClientMsg::Input {
                seq: 44,
                commands: (-1..=2)
                    .map(|pick| WireCommand::Choose {
                        handle: RewardChestHandle::new(u32::MAX).unwrap(),
                        pick,
                    })
                    .collect(),
            },
        ),
        (
            "input_corpse",
            ClientMsg::Input {
                seq: 47,
                commands: vec![WireCommand::ConsumeCorpse {
                    handle: PickupHandle::new(42).unwrap(),
                }],
            },
        ),
        (
            "input_hunt",
            ClientMsg::Input {
                seq: 46,
                commands: vec![WireCommand::HuntTarget { actor: 2 }],
            },
        ),
        (
            "input_plan",
            ClientMsg::Input {
                seq: 10,
                commands: vec![
                    WireCommand::Plan {
                        spawn: Some(0),
                        boon: None,
                        ready: None,
                    },
                    WireCommand::Plan {
                        spawn: None,
                        boon: Some(1),
                        ready: None,
                    },
                    WireCommand::Plan {
                        spawn: None,
                        boon: None,
                        ready: Some(true),
                    },
                    WireCommand::Plan {
                        spawn: Some(1),
                        boon: Some(0),
                        ready: Some(false),
                    },
                ],
            },
        ),
        (
            "input_combat",
            ClientMsg::Input {
                seq: 43,
                commands: vec![
                    WireCommand::Swap { slot: None },
                    WireCommand::Swap { slot: Some(0) },
                    WireCommand::Swap { slot: Some(1) },
                    WireCommand::Pickup {
                        handle: PickupHandle::new(42).unwrap(),
                    },
                ],
            },
        ),
        // Protocol 8 practice console: all five commands, including a chest with three chosen card positions and the
        // largest stat count (a multi-byte varint).
        (
            "input_train",
            ClientMsg::Input {
                seq: 46,
                commands: vec![
                    WireCommand::Train {
                        command: 1,
                        id: 2,
                        count: 3,
                        options: [0; 3],
                        option_count: 0,
                    },
                    WireCommand::Train {
                        command: 2,
                        id: 0,
                        count: 9_007_199_254_740_991,
                        options: [0; 3],
                        option_count: 0,
                    },
                    WireCommand::Train {
                        command: 3,
                        id: 29,
                        count: 0,
                        options: [0; 3],
                        option_count: 0,
                    },
                    WireCommand::Train {
                        command: 4,
                        id: 0,
                        count: 0,
                        options: [3, 7, 12],
                        option_count: 3,
                    },
                    WireCommand::Train {
                        command: 5,
                        id: 0,
                        count: 0,
                        options: [0; 3],
                        option_count: 0,
                    },
                ],
            },
        ),
        (
            "hello",
            ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: 0x1122_3344_5566_7788,
                build: "web-0.1.0".into(),
                profile: "Nevan_01".into(),
                ticket: b"tok-abc".to_vec(),
                faction: Some(4),
                resume: None,
            },
        ),
        (
            "hello_resume",
            ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: 7,
                build: "".into(),
                profile: "Ünïcode".into(),
                ticket: Vec::new(),
                faction: None,
                resume: Some([9; 16]),
            },
        ),
        // An opaque binary ticket of the longest legal size (the whole Hello stays under MAX_CLIENT_FRAME).
        (
            "hello_ticket_max",
            ClientMsg::Hello {
                protocol: PROTOCOL_VERSION,
                content_hash: 1,
                build: "b".repeat(255),
                profile: "p".repeat(255),
                ticket: (0..MAX_TICKET).map(|i| (i * 7 + 3) as u8).collect(),
                faction: Some(15),
                resume: Some([0xab; 16]),
            },
        ),
        (
            "input_all_commands",
            ClientMsg::Input {
                seq: 42,
                commands: vec![
                    WireCommand::Move {
                        x: 1234.5,
                        y: -0.25,
                        seq: Some(7),
                    },
                    WireCommand::Stop { seq: None },
                    WireCommand::Aim { a: -3.1415927 },
                    WireCommand::Attack {
                        a: 0.5,
                        t: Some(12345.75),
                    },
                    WireCommand::Release { a: 0.5, t: None },
                ],
            },
        ),
        (
            "ping",
            ClientMsg::Ping {
                nonce: 0xdead_beef,
                client_ms: 1.5,
            },
        ),
        (
            "input_union_commands",
            ClientMsg::Input {
                seq: 51,
                commands: vec![
                    WireCommand::HuntTarget { actor: u32::MAX },
                    WireCommand::ConsumeCorpse {
                        handle: PickupHandle::new(u32::MAX).unwrap(),
                    },
                    WireCommand::Plan {
                        spawn: Some(1),
                        boon: Some(0),
                        ready: Some(false),
                    },
                    WireCommand::Train {
                        command: 4,
                        id: u32::MAX,
                        count: u64::MAX,
                        options: [1, 2, 79],
                        option_count: 3,
                    },
                ],
            },
        ),
        ("leave", ClientMsg::Leave),
        ("resync", ClientMsg::Resync),
    ]
}

fn sample_field() -> WireField {
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
fn state_sample() -> ServerMsg {
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
                        handle: PickupHandle::new(1).unwrap(),
                        x: 800,
                        y: 900,
                        kind: WirePropKind::Ground(0),
                    },
                    WireProp {
                        handle: PickupHandle::new(2).unwrap(),
                        x: 801,
                        y: 902,
                        kind: WirePropKind::Chest { open: true },
                    },
                    WireProp {
                        handle: PickupHandle::new(3).unwrap(),
                        x: 802,
                        y: 903,
                        kind: WirePropKind::Body {
                            label: "\u{feff}BÖB".into(),
                        },
                    },
                    WireProp {
                        handle: PickupHandle::new(4).unwrap(),
                        x: 803,
                        y: 904,
                        kind: WirePropKind::WindEmblem,
                    },
                ],
                focus: Some(WireFocus {
                    handle: PickupHandle::new(3).unwrap(),
                    body_hint: Some(4),
                }),
            }),
            StateItem::Fields(vec![sample_field(), sample_field()]),
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
                cards: {
                    let mut c = [0; 80];
                    c[0] = 1;
                    c[2] = 1;
                    c
                },
                boosts: [0, 1, 2, 3, 0, 1, 2, 3],
            })),
            StateItem::Camps(vec![WireCamp {
                mob_type: 0,
                elite: Some(29),
                alive: 0,
                state: 2,
                cleared_at: 1000.,
                respawn_at: 181000.,
            }]),
            StateItem::Projectiles(vec![
                WireProjectile {
                    kind: 0,
                    x: 800,
                    y: 900,
                    facing: 12345,
                    owner: Some(1)
                };
                2
            ]),
            StateItem::Plan(None),
            StateItem::Arena(None),
        ],
    }
}

#[allow(clippy::approx_constant)]
pub fn server_samples() -> Vec<(&'static str, ServerMsg)> {
    let tiles: Vec<u8> = (0..12)
        .map(|i| {
            if i < 4 || i % 4 == 0 {
                1
            } else if i == 6 {
                2
            } else {
                0
            }
        })
        .collect();
    vec![
        ("state_all", state_sample()),
        (
            "state_full_catalog_rewards",
            ServerMsg::State {
                tick: 202,
                items: vec![StateItem::RewardChests(vec![WireRewardChest {
                    handle: RewardChestHandle::new(1).unwrap(),
                    x: 100,
                    y: 200,
                    expires_at: 15000.,
                    options: vec![
                        WireRewardOption {
                            id: WireRewardId::Card(3),
                            taken: false,
                            taken_by: None,
                        },
                        WireRewardOption {
                            id: WireRewardId::Card(79),
                            taken: false,
                            taken_by: None,
                        },
                        WireRewardOption {
                            id: WireRewardId::Boost(7),
                            taken: false,
                            taken_by: None,
                        },
                    ],
                    picked: false,
                    can_choose: true,
                }])],
            },
        ),
        (
            "state_union_props",
            ServerMsg::State {
                tick: 201,
                items: vec![StateItem::Props(WireProps {
                    rows: vec![
                        WireProp {
                            handle: PickupHandle::new(1).unwrap(),
                            x: 80,
                            y: 160,
                            kind: WirePropKind::Corpse {
                                label: "fallen".into(),
                            },
                        },
                        WireProp {
                            handle: PickupHandle::new(2).unwrap(),
                            x: 81,
                            y: 161,
                            kind: WirePropKind::WindEmblem,
                        },
                        WireProp {
                            handle: PickupHandle::new(3).unwrap(),
                            x: 82,
                            y: 162,
                            kind: WirePropKind::Cannon { ready_at: u32::MAX },
                        },
                    ],
                    focus: None,
                })],
            },
        ),
        (
            "events_union",
            ServerMsg::Events {
                tick: 201,
                events: vec![
                    WireEvent::WindEmblem,
                    WireEvent::CannonNotice {
                        code: 4,
                        seconds: Some(75),
                    },
                    WireEvent::Toast {
                        text: "Practice ready".into(),
                    },
                    WireEvent::PotionNotice { notice: 10 },
                ],
            },
        ),
        (
            "props_corpse",
            ServerMsg::State {
                tick: 13,
                items: vec![StateItem::Props(WireProps {
                    rows: vec![WireProp {
                        handle: PickupHandle::new(7).unwrap(),
                        x: 800,
                        y: 900,
                        kind: WirePropKind::Corpse { label: "P1".into() },
                    }],
                    focus: None,
                })],
            },
        ),
        (
            "potion_notices",
            ServerMsg::Events {
                tick: 11,
                events: (1..=10)
                    .map(|notice| WireEvent::PotionNotice { notice })
                    .collect(),
            },
        ),
        (
            "wind_emblem",
            ServerMsg::Events {
                tick: 12,
                events: vec![WireEvent::WindEmblem],
            },
        ),
        (
            "camps_limits",
            ServerMsg::State {
                tick: 12,
                items: vec![StateItem::Camps(vec![
                    WireCamp {
                        mob_type: 29,
                        elite: None,
                        alive: 512,
                        state: 0,
                        cleared_at: 0.,
                        respawn_at: 0.
                    };
                    512
                ])],
            },
        ),
        (
            "chest_refusals",
            ServerMsg::Events {
                tick: 10,
                events: (1..=9)
                    .map(|reason| WireEvent::ChestRefused { reason })
                    .collect(),
            },
        ),
        // Protocol 8 owner-only practice-console toasts (the source's exact texts).
        (
            "events_toasts",
            ServerMsg::Events {
                tick: 31,
                events: vec![
                    WireEvent::Toast {
                        text: "Slow down".into(),
                    },
                    WireEvent::Toast {
                        text: "Cleared: cards, practice mobs and chests".into(),
                    },
                ],
            },
        ),
        // Protocol 11: a training snapshot (head bit 16) with a training dummy actor (kind 3, no catalog type, shield in hand).
        (
            "snapshot_training",
            ServerMsg::Snapshot {
                training: true,
                tick: 8,
                phase: 2,
                ack_input: 3,
                me: None,
                actors: vec![WireActor {
                    sig: 0,
                    mob_type_code: 0,
                    effects: 0,
                    displace_seq: 0,
                    id: 9,
                    faction: 1,
                    x: 336.0,
                    y: 256.0,
                    facing: 0.0,
                    hp_pct: 100,
                    status: 1,
                    weapon: 4,
                    bounty: 0,
                    kind: 3,
                }],
            },
        ),
        // Protocol 11: a delta carrying the training bit (head bit 20).
        (
            "snapshot_delta_training",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                training: true,
                tick: 12,
                base_tick: 10,
                phase: None,
                ack_input: 4,
                me: Some(SelfDelta::default()),
                changed: Vec::new(),
                departed: Vec::new(),
            }),
        ),
        (
            "cannon_notices",
            ServerMsg::Events {
                tick: 12,
                events: vec![
                    WireEvent::CannonNotice {
                        code: 1,
                        seconds: None,
                    },
                    WireEvent::CannonNotice {
                        code: 2,
                        seconds: None,
                    },
                    WireEvent::CannonNotice {
                        code: 3,
                        seconds: None,
                    },
                    WireEvent::CannonNotice {
                        code: 4,
                        seconds: Some(74),
                    },
                ],
            },
        ),
        (
            "state_clear",
            ServerMsg::State {
                tick: 201,
                items: vec![
                    StateItem::Inventory(None),
                    StateItem::Props(WireProps::default()),
                    StateItem::Fields(vec![]),
                    StateItem::RewardChests(vec![]),
                    StateItem::Build(None),
                    StateItem::Camps(vec![]),
                    StateItem::Projectiles(vec![]),
                    StateItem::Plan(None),
                    StateItem::Arena(None),
                ],
            },
        ),
        (
            "state_planning",
            ServerMsg::State {
                tick: 3,
                items: vec![
                    StateItem::Plan(Some(WirePlan {
                        ends_at: 500.5,
                        spawns: [Some(12), None],
                        taken: [true, false],
                        pick: Some(1),
                        boons: vec!["ad".into(), String::new()],
                        boon: Some(0),
                        ready: true,
                        options: [
                            Some(WirePlanOption {
                                index: 12,
                                x: 2464,
                                y: 3456,
                                zone: 3,
                                walk_seconds: Some(12.25),
                            }),
                            Some(WirePlanOption {
                                index: 0,
                                x: 0,
                                y: 32760,
                                zone: 5,
                                walk_seconds: None,
                            }),
                        ],
                    })),
                    StateItem::Arena(Some(WireArena {
                        lobby_ends_at: 150.,
                        plan_ends_at: 501.,
                        raid_started_at: 0.,
                        patience_ends_at: Some(601_000.),
                        in_coliseum: false,
                        gates_locked: false,
                        sudden_death_at: 0.,
                        started_with: 7,
                    })),
                ],
            },
        ),
        (
            "reject_unknown_bom",
            ServerMsg::Reject {
                code: RejectCode::Unknown(300),
                reason: "\u{feff}a".into(),
            },
        ),
        (
            "fx_combat",
            ServerMsg::Fx {
                tick: 10,
                fx: vec![
                    WireFx::Block {
                        id: 2,
                        by: u32::MAX,
                        weapon: 1,
                    },
                    WireFx::Block {
                        id: 2,
                        by: 1,
                        weapon: 2,
                    },
                    WireFx::Stagger { id: 2 },
                    WireFx::Hit {
                        victim: 2,
                        by: u32::MAX,
                        amount: 4.0,
                        passive: true,
                    },
                ],
            },
        ),
        (
            "fx_teleport",
            ServerMsg::Fx {
                tick: 777,
                fx: vec![WireFx::Teleport],
            },
        ),
        (
            "pickup_refusals",
            ServerMsg::Events {
                tick: 10,
                events: (1..=5)
                    .map(|reason| WireEvent::PickupRefused { reason })
                    .collect(),
            },
        ),
        (
            "welcome",
            ServerMsg::Welcome {
                protocol: PROTOCOL_VERSION,
                content_hash: 0x0102_0304_0506_0708,
                match_id: [1; 16],
                player_id: 3,
                session: [2; 16],
                tick_rate: 20,
                tick: 100,
                server_ms: 5000.0,
                map: MapBlob::new(4, 3, tiles),
            },
        ),
        (
            "reject",
            ServerMsg::Reject {
                code: RejectCode::ProtocolMismatch,
                reason: "client protocol 1, server 2".into(),
            },
        ),
        // A code no build of this protocol names yet: decoders accept it and carry the raw value and the reason text.
        (
            "reject_code_unknown",
            ServerMsg::Reject {
                code: RejectCode::Unknown(12),
                reason: String::new(),
            },
        ),
        (
            "snapshot",
            ServerMsg::Snapshot {
                training: false,
                tick: 101,
                phase: 1,
                ack_input: 42,
                me: Some(WireSelf {
                    sig: 0,
                    effects: 0x1234,
                    displace_seq: 255,
                    id: 3,
                    faction: 4,
                    x: 400.0,
                    y: 320.5,
                    facing: 1.5,
                    hp: 1000.25,
                    max_hp: 1145.0,
                    status: 1,
                    weapon: 5,
                    ready_in_ms: 250,
                    kills: 2,
                    bounty: 0,
                    gv: 20,
                    move_seq: 7,
                    hunt_target: Some(2),
                    hunt_stacks: 3,
                }),
                actors: vec![WireActor {
                    sig: 0,
                    mob_type_code: 0,
                    effects: 0x1234,
                    displace_seq: 255,
                    id: 1,
                    faction: 0,
                    x: 456.0,
                    y: 320.0,
                    facing: -1.0,
                    hp_pct: 87,
                    status: 1,
                    weapon: 5,
                    bounty: 28,
                    kind: 0,
                }],
            },
        ),
        (
            "snapshot_planning",
            ServerMsg::Snapshot {
                training: false,
                tick: 7,
                phase: 3,
                ack_input: 6,
                me: None,
                actors: vec![],
            },
        ),
        (
            "snapshot_spectator",
            ServerMsg::Snapshot {
                training: false,
                tick: 1,
                phase: 0,
                ack_input: 0,
                me: None,
                actors: vec![],
            },
        ),
        // Every default: the self and the actor omit all their optional fields.
        (
            "snapshot_defaults",
            ServerMsg::Snapshot {
                training: false,
                tick: 127,
                phase: 1,
                ack_input: 128,
                me: Some(WireSelf {
                    sig: 0,
                    effects: 0,
                    displace_seq: 0,
                    id: 1,
                    faction: 0,
                    x: 160.0,
                    y: 96.0,
                    facing: 0.0,
                    hp: 1145.0,
                    max_hp: 1145.0,
                    status: 1,
                    weapon: 0,
                    ready_in_ms: 0,
                    kills: 0,
                    bounty: 0,
                    gv: 0,
                    move_seq: 0,
                    hunt_target: None,
                    hunt_stacks: 0,
                }),
                actors: vec![WireActor {
                    sig: 0,
                    mob_type_code: 0,
                    effects: 0,
                    displace_seq: 0,
                    id: 2,
                    faction: 0,
                    x: 0.0,
                    y: 0.0,
                    facing: 0.0,
                    hp_pct: 100,
                    status: 1,
                    weapon: 0,
                    bounty: 0,
                    kind: 0,
                }],
            },
        ),
        // Every field set, multi-byte varints everywhere, off-grid and edge positions and angles (a tie rounds away from
        // zero, the facing of +pi wraps to -pi, the largest positions, 8191.875 and 8191.8, and a tiny one rounding to 0; the encoder refuses a position outside 0..=8191.875).
        (
            "snapshot_full",
            ServerMsg::Snapshot {
                training: false,
                tick: 1_000_000,
                phase: 2,
                ack_input: 300,
                me: Some(WireSelf {
                    sig: 0,
                    effects: 0,
                    displace_seq: 0,
                    id: 300,
                    faction: 3,
                    x: 5119.875,
                    y: 0.1,
                    facing: -3.1415927,
                    hp: -0.0,
                    max_hp: 1145.5,
                    status: 2,
                    weapon: 1,
                    ready_in_ms: 65535,
                    kills: 200,
                    bounty: 65535,
                    gv: 16384,
                    move_seq: 255,
                    hunt_target: None,
                    hunt_stacks: 0,
                }),
                actors: vec![
                    WireActor {
                        sig: 0,
                        mob_type_code: 0,
                        effects: 0,
                        displace_seq: 0,
                        id: 2,
                        faction: 1,
                        x: 0.0625,
                        y: 5120.0,
                        facing: 3.1415927,
                        hp_pct: 0,
                        status: 2,
                        weapon: 5,
                        bounty: 127,
                        kind: 0,
                    },
                    WireActor {
                        sig: 0,
                        mob_type_code: 0,
                        effects: 0,
                        displace_seq: 0,
                        id: 128,
                        faction: 4,
                        x: 1234.5678,
                        y: 8191.8,
                        facing: 0.7853982,
                        hp_pct: 100,
                        status: 3,
                        weapon: 0,
                        bounty: 128,
                        kind: 0,
                    },
                    WireActor {
                        sig: 0,
                        mob_type_code: 0,
                        effects: 0,
                        displace_seq: 0,
                        id: 70_000,
                        faction: 0,
                        x: 0.03,
                        y: 8191.875,
                        facing: -1.0,
                        hp_pct: 33,
                        status: 1,
                        weapon: 2,
                        bounty: 65535,
                        kind: 2,
                    },
                    WireActor {
                        sig: 0,
                        mob_type_code: 0,
                        effects: 0,
                        displace_seq: 0,
                        id: u32::MAX,
                        faction: 0,
                        x: 2559.9375,
                        y: 77.7,
                        facing: 6.2831855,
                        hp_pct: 99,
                        status: 1,
                        weapon: 0,
                        bounty: 0,
                        kind: 255,
                    },
                ],
            },
        ),
        // A zero max_hp (a varint 0) and a hp of -0.0 (bits preserved: the hp bit is set, as the bit patterns differ).
        (
            "snapshot_zero_hp",
            ServerMsg::Snapshot {
                training: false,
                tick: 16384,
                phase: 3,
                ack_input: 16383,
                me: Some(WireSelf {
                    sig: 0,
                    effects: 0,
                    displace_seq: 0,
                    id: 8,
                    faction: 15,
                    x: 0.0,
                    y: 8191.875,
                    facing: 3.0,
                    hp: -0.0,
                    max_hp: 0.0,
                    status: 3,
                    weapon: 15,
                    ready_in_ms: 1,
                    kills: 1,
                    bounty: 1,
                    gv: 1,
                    move_seq: 1,
                    hunt_target: None,
                    hunt_stacks: 0,
                }),
                actors: vec![],
            },
        ),
        // Deltas (protocol v3). Nothing changed and no self: the smallest delta.
        (
            "snapshot_delta_empty",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                training: false,
                tick: 102,
                base_tick: 101,
                phase: None,
                ack_input: 42,
                me: None,
                changed: vec![],
                departed: vec![],
            }),
        ),
        // A self with some fields changed (f32 pairs, a varint, a status), a changed actor, a new actor and a departed one.
        (
            "snapshot_delta",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                training: false,
                tick: 1_000_000,
                base_tick: 999_990,
                phase: Some(2),
                ack_input: 300,
                me: Some(SelfDelta {
                    mask: DH_X | DH_Y | DH_HP | DH_KILLS | DH_MOVE_SEQ | DH_STATUS | DH_GV,
                    x: 5119.875,
                    y: 0.1,
                    hp: -0.0,
                    kills: 200,
                    gv: 16384,
                    move_seq: 255,
                    hunt_target: None,
                    hunt_stacks: 0,
                    status: 2,
                    ..SelfDelta::default()
                }),
                changed: vec![
                    ActorDelta {
                        mask: AD_X | AD_HP | AD_STATUS,
                        q: QActor {
                            id: 2,
                            x: 65535,
                            hp_pct: 0,
                            status: 2,
                            ..QActor::default()
                        },
                    },
                    ActorDelta {
                        mask: AD_ALL,
                        q: QActor {
                            sig: 0,
                            mob_type_code: 0,
                            effects: 0,
                            displace_seq: 0,
                            id: 128,
                            x: 100,
                            y: 200,
                            facing: 0x8000,
                            kit: 0x52,
                            hp_pct: 100,
                            status: 3,
                            bounty: 65535,
                            kind: 0,
                        },
                    },
                ],
                departed: vec![5, 70_000],
            }),
        ),
        (
            "events",
            ServerMsg::Events {
                tick: 281,
                events: vec![
                    WireEvent::Death { id: 1, by: Some(2) },
                    WireEvent::Bounty { id: 2, bounty: 28 },
                    WireEvent::MatchEnded {
                        winner: Some(2),
                        draw: false,
                    },
                    WireEvent::Result(WireResult {
                        outcome: 0,
                        place: 1,
                        players: 2,
                        kills: 1,
                        killed_by: None,
                        gv_total: 10,
                        gv_win: 0,
                        duration_sec: 14,
                        win_bonus_withheld: true,
                    }),
                    WireEvent::Result(WireResult {
                        outcome: 2,
                        place: 2,
                        players: 2,
                        kills: 0,
                        killed_by: Some("P1".into()),
                        gv_total: 0,
                        gv_win: 0,
                        duration_sec: 14,
                        win_bonus_withheld: false,
                    }),
                ],
            },
        ),
        (
            "fx",
            ServerMsg::Fx {
                tick: 3,
                fx: vec![
                    WireFx::Swing {
                        by: 1,
                        weapon: 5,
                        x: 400.0,
                        y: 320.0,
                        a: 0.0,
                    },
                    WireFx::Hit {
                        victim: 2,
                        by: 1,
                        amount: 17.690966,
                        passive: false,
                    },
                ],
            },
        ),
        // Swings quantized like remote actors; multi-byte ids; an empty list.
        (
            "fx_quantized",
            ServerMsg::Fx {
                tick: 300,
                fx: vec![
                    WireFx::Swing {
                        by: 70_000,
                        weapon: 2,
                        x: 1234.5678,
                        y: 0.0,
                        a: -2.5,
                    },
                    WireFx::Hit {
                        victim: 128,
                        by: u32::MAX,
                        amount: 0.5,
                        passive: false,
                    },
                ],
            },
        ),
        (
            "fx_empty",
            ServerMsg::Fx {
                tick: 0,
                fx: vec![],
            },
        ),
        // An empty keyed-state message retains all current collections.
        (
            "state_empty",
            ServerMsg::State {
                tick: 300,
                items: vec![],
            },
        ),
        (
            "pong",
            ServerMsg::Pong {
                nonce: 0xdead_beef,
                client_ms: 1.5,
                server_ms: 5051.25,
            },
        ),
    ]
}

/// Client frames the server must reject, with the reason.
pub fn malformed_client() -> Vec<(&'static str, Vec<u8>)> {
    let input = ClientMsg::Input {
        seq: 1,
        commands: vec![WireCommand::Aim { a: 0.0 }],
    }
    .encode();
    let mut nan = input.clone();
    let n = nan.len();
    nan[n - 4..].copy_from_slice(&f32::NAN.to_le_bytes());
    let mut trailing = input.clone();
    trailing.push(0);
    let truncated = input[..input.len() - 1].to_vec();
    let mut too_many = vec![0x02, 1, 0, 0, 0];
    too_many.extend_from_slice(&(17u16).to_le_bytes());
    for _ in 0..17 {
        too_many.extend_from_slice(&[3, 0, 0, 0, 0]);
    }
    let mut bad_utf8 = vec![0x01, 1, 0];
    bad_utf8.extend_from_slice(&[0; 8]);
    bad_utf8.extend_from_slice(&[2, 0xff, 0xfe]);
    vec![
        ("target_zero", vec![2, 0, 0, 0, 0, 1, 0, 10, 0, 0, 0, 0]),
        ("target_truncated", vec![2, 0, 0, 0, 0, 1, 0, 10, 1, 0, 0]),
        ("use_consumable_payload", vec![2, 0, 0, 0, 0, 1, 0, 9, 0]),
        (
            "attack_move_bad_option",
            vec![2, 0, 0, 0, 0, 1, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        ),
        (
            "attack_move_nonfinite",
            vec![2, 0, 0, 0, 0, 1, 0, 11, 0, 0, 128, 127, 0, 0, 0, 0, 0],
        ),
        (
            "choice_zero_handle",
            vec![2, 0, 0, 0, 0, 1, 0, 8, 0, 0, 0, 0, 0],
        ),
        (
            "choice_pick_three",
            vec![2, 0, 0, 0, 0, 1, 0, 8, 1, 0, 0, 0, 3],
        ),
        (
            "choice_pick_minus_two",
            vec![2, 0, 0, 0, 0, 1, 0, 8, 1, 0, 0, 0, 254],
        ),
        ("swap_bad_slot", vec![2, 1, 0, 0, 0, 1, 0, 6, 1, 2]),
        ("swap_bad_flag", vec![2, 1, 0, 0, 0, 1, 0, 6, 2]),
        ("pickup_bad_id", vec![2, 1, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0]),
        ("empty", vec![]),
        ("unknown_tag", vec![0x7f]),
        ("server_tag_from_client", vec![0x81]),
        ("nan_angle", nan),
        ("trailing_byte", trailing),
        ("truncated", truncated),
        ("too_many_commands", too_many),
        ("bad_utf8", bad_utf8),
        ("oversize", vec![0x03; MAX_CLIENT_FRAME + 1]),
        ("bad_option_flag", vec![0x02, 1, 0, 0, 0, 1, 0, 2, 2]),
    ]
}

/// A small valid Snapshot to corrupt: tick 1, ack 0, `head`, then `body` (a self, if the head says so), an actor count and
/// the actors' bytes.
fn snapshot_bytes(head: u32, body: &[u8], count: u32, actors: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x83);
    w.varint(1);
    w.varint(0);
    w.varint(head);
    w.bytes(body);
    w.varint(count);
    w.bytes(actors);
    w.finish()
}

/// A Welcome whose map is `w` x `h` with these (tile, length) runs and `hash` (by default the true hash of the tiles the
/// runs spell, so only the named fault is wrong).
fn welcome_map(w: u16, h: u16, hash: Option<u32>, runs: &[(u8, u16)]) -> Vec<u8> {
    let tiles: Vec<u8> = runs
        .iter()
        .flat_map(|&(t, n)| std::iter::repeat_n(t, n as usize))
        .collect();
    let mut b = Writer::default();
    b.u8(0x81);
    b.u16(PROTOCOL_VERSION);
    b.u64(0x1234);
    b.bytes(&[7; 16]);
    b.u32(1);
    b.bytes(&[9; 16]);
    b.u8(20);
    b.u32(0);
    b.f64(0.0);
    b.u16(w);
    b.u16(h);
    b.u32(hash.unwrap_or_else(|| crate::map::layer_hash(w as u32, h as u32, &tiles)));
    b.u32(runs.len() as u32);
    for &(t, n) in runs {
        b.u8(t);
        b.u16(n);
    }
    b.finish()
}

/// One minimal actor record: id 1, `mask`, x y facing all 0, then `extra`.
fn actor_bytes(mask: u32, extra: &[u8]) -> Vec<u8> {
    let mut a = Writer::with_capacity(16);
    a.varint(1);
    a.varint(mask);
    a.bytes(&[0; 6]);
    a.bytes(extra);
    a.finish()
}

/// Server frames a client must reject (the C# and JS tests check the same names against the reason they expect).
fn camp_bytes(mob_type: u8, elite: u8, alive: u32, state: u8, clear: f64, respawn: f64) -> Vec<u8> {
    let mut w = Writer::default();
    w.bytes(&[0x88, 0, 1, 6, 1]);
    w.u8(mob_type);
    w.u8(elite);
    w.varint(alive);
    w.u8(state);
    w.f64(clear);
    w.f64(respawn);
    w.finish()
}

pub fn malformed_server() -> Vec<(&'static str, Vec<u8>)> {
    let mut bad_card_id = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_full_catalog_rewards")
        .unwrap()
        .1
        .encode();
    let at = bad_card_id
        .windows(4)
        .rposition(|bytes| bytes == [1, 79, 0, 0])
        .unwrap();
    bad_card_id[at + 1] = 80;
    let mut negative_plan = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_planning")
        .unwrap()
        .1
        .encode();
    negative_plan[5..13].copy_from_slice(&(-1.0f64).to_le_bytes());
    let good = ServerMsg::Snapshot {
        training: false,
        tick: 5,
        phase: 1,
        ack_input: 0,
        me: None,
        actors: vec![WireActor {
            sig: 0,
            mob_type_code: 0,
            effects: 0,
            displace_seq: 0,
            id: 1,
            faction: 0,
            x: 1.0,
            y: 2.0,
            facing: 0.5,
            hp_pct: 50,
            status: 1,
            weapon: 0,
            bounty: 0,
            kind: 0,
        }],
    }
    .encode();
    let mut trailing = good.clone();
    trailing.push(0);
    vec![
        ("potion_notice_zero", vec![0x84, 0, 0, 0, 0, 1, 0, 7, 0]),
        ("cannon_notice_zero", vec![0x84, 0, 0, 0, 0, 1, 0, 9, 0]),
        ("cannon_notice_unknown", vec![0x84, 0, 0, 0, 0, 1, 0, 9, 5]),
        (
            "cannon_notice_bad_seconds",
            vec![0x84, 0, 0, 0, 0, 1, 0, 9, 4, 0, 0],
        ),
        (
            "cannon_notice_seconds_over",
            vec![0x84, 0, 0, 0, 0, 1, 0, 9, 4, 76, 0],
        ),
        (
            "cannon_notice_missing_seconds",
            vec![0x84, 0, 0, 0, 0, 1, 0, 9, 4],
        ),
        ("potion_notice_unknown", vec![0x84, 0, 0, 0, 0, 1, 0, 7, 11]),
        ("state_too_many_projectiles", vec![0x88, 0, 1, 7, 0x81, 4]),
        (
            "projectile_kind",
            vec![0x88, 0, 1, 7, 1, 2, 0, 0, 0, 0, 0, 0, 0],
        ),
        (
            "projectile_owner_zero",
            vec![0x88, 0, 1, 7, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
        ),
        (
            "projectile_owner_flag",
            vec![0x88, 0, 1, 7, 1, 0, 0, 0, 0, 0, 0, 0, 2],
        ),
        (
            "projectile_owner_overlong",
            vec![0x88, 0, 1, 7, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0x81, 0],
        ),
        ("state_too_many_camps", vec![0x88, 0, 1, 6, 0x81, 4]),
        ("camp_mob_type", camp_bytes(30, 0, 0, 0, 0., 0.)),
        ("camp_elite", camp_bytes(0, 31, 0, 0, 0., 0.)),
        ("camp_alive", camp_bytes(0, 0, 513, 0, 0., 0.)),
        ("camp_state", camp_bytes(0, 0, 0, 3, 0., 0.)),
        ("camp_negative_time", camp_bytes(0, 0, 0, 0, -1., 0.)),
        (
            "camp_nonfinite_time",
            camp_bytes(0, 0, 0, 0, 0., f64::INFINITY),
        ),
        ("camp_time_order", camp_bytes(0, 0, 0, 0, 2., 1.)),
        (
            "actor_mob_type_over_30",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_MOB_TYPE, &[31])),
        ),
        (
            "delta_actor_mob_type_over_30",
            delta_bytes(10, 1, 0, &[1, 1, 0x80, 8, 31]),
        ),
        ("empty", vec![]),
        ("unknown_tag", vec![0x7f]),
        ("client_tag_from_server", vec![0x01]),
        ("hit_bad_passive", vec![0x85, 0, 1, 2, 1, 2, 0, 0, 0, 0, 2]),
        ("pickup_bad_reason_zero", vec![0x84, 0, 0, 0, 0, 1, 0, 5, 0]),
        (
            "pickup_bad_reason_unknown",
            vec![0x84, 0, 0, 0, 0, 1, 0, 5, 6],
        ),
        ("truncated_snapshot", good[..good.len() - 1].to_vec()),
        ("trailing_byte", trailing),
        // tick 0x80 0x00 is a two-byte zero: the canonical form is one byte.
        ("overlong_varint", vec![0x83, 0x80, 0x00, 0, 0, 0, 0, 0, 0]),
        // Five groups whose last carries more than the top 4 bits of a u32.
        (
            "varint_past_u32",
            vec![0x83, 0xff, 0xff, 0xff, 0xff, 0x1f, 0, 0, 0, 0, 0, 0],
        ),
        // Six continuation bytes.
        (
            "varint_too_long",
            vec![0x83, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0, 0, 0, 0],
        ),
        (
            "head_self_bit_without_present_bit",
            snapshot_bytes(0x0002, &[], 0, &[]),
        ),
        // Bit 13 is not a field of this version: a mask bit a decoder does not know is refused, never skipped.
        ("head_unknown_bit", snapshot_bytes(0x20001, &[], 0, &[])),
        // The head 0x80 0x00 is a two-byte zero: the canonical form is one byte.
        ("head_overlong_varint", vec![0x83, 0, 0, 0x80, 0x00, 0]),
        ("self_truncated", snapshot_bytes(0x0001, &[], 0, &[])),
        (
            "self_status_over_3",
            snapshot_bytes(
                0x0201,
                &[vec![1], vec![0; 12], vec![1], vec![4]].concat(),
                0,
                &[],
            ),
        ),
        ("phase_over_3", snapshot_bytes(0x0400, &[4], 0, &[])),
        (
            "self_max_hp_over_u16",
            snapshot_bytes(
                0x0001,
                &[vec![1], vec![0; 12], vec![0x80, 0x80, 0x04]].concat(),
                0,
                &[],
            ),
        ),
        (
            "too_many_actors",
            snapshot_bytes(0, &[], MAX_ACTORS as u32 + 1, &[]),
        ),
        ("actor_count_without_actors", snapshot_bytes(0, &[], 1, &[])),
        (
            "actor_reserved_mask_bit",
            snapshot_bytes(0, &[], 1, &actor_bytes(0x200, &[])),
        ),
        (
            "actor_id_gap_zero",
            snapshot_bytes(
                0,
                &[],
                2,
                &[actor_bytes(0, &[]), vec![0, 0, 0, 0, 0, 0, 0, 0]].concat(),
            ),
        ),
        (
            "actor_id_overflow",
            snapshot_bytes(
                0,
                &[],
                2,
                &[
                    vec![0xff, 0xff, 0xff, 0xff, 0x0f, 0, 0, 0, 0, 0, 0, 0],
                    vec![1, 0, 0, 0, 0, 0, 0, 0],
                ]
                .concat(),
            ),
        ),
        (
            "actor_status_over_3",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_STATUS, &[4])),
        ),
        // The actor mask 0x80 0x00 is a two-byte zero.
        (
            "actor_mask_overlong_varint",
            snapshot_bytes(0, &[], 1, &[1, 0x80, 0x00, 0, 0, 0, 0, 0, 0]),
        ),
        // Kind and status/displacement bits are known; bit 9 is not.
        (
            "actor_unknown_mask_bit_after_kind",
            snapshot_bytes(0, &[], 1, &actor_bytes(1 << 9, &[])),
        ),
        (
            "actor_hp_over_100",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_HP, &[101])),
        ),
        (
            "actor_bounty_over_u16",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_BOUNTY, &[0x80, 0x80, 0x04])),
        ),
        // Fx: a count past u16, a bad item tag.
        ("fx_too_many", vec![0x85, 0, 0x80, 0x80, 0x04]),
        ("fx_bad_tag", vec![0x85, 0, 1, 9]),
        // State: key zero is undefined; truncated and trailing bytes remain invalid.
        ("chest_bad_reason_zero", vec![0x84, 0, 0, 0, 0, 1, 0, 6, 0]),
        (
            "chest_bad_reason_unknown",
            vec![0x84, 0, 0, 0, 0, 1, 0, 6, 10],
        ),
        ("state_reward_card_id_80", bad_card_id),
        ("state_plan_negative_deadline", negative_plan),
        ("state_unknown_key", vec![0x88, 0, 1, 10]),
        ("state_duplicate_key", vec![0x88, 0, 2, 1, 0, 1, 0]),
        ("state_key_order", vec![0x88, 0, 2, 3, 0, 1, 0]),
        ("state_too_many_keys", vec![0x88, 0, 10]),
        ("state_too_many_props", vec![0x88, 0, 1, 2, 0x81, 4]),
        ("state_too_many_fields", vec![0x88, 0, 1, 3, 0x81, 4]),
        ("state_too_many_rewards", vec![0x88, 0, 1, 4, 0x81, 4]),
        (
            "state_bad_potion_count",
            vec![0x88, 0, 1, 1, 1, 0, 0, 0, 6, 0, 0],
        ),
        ("state_zero_prop_handle", vec![0x88, 0, 1, 2, 1, 0]),
        ("state_missing_focus", vec![0x88, 0, 1, 2, 0, 1, 0]),
        ("state_trailing_byte", vec![0x88, 0, 0, 0]),
        ("state_truncated", vec![0x88, 0]),
        // Reject: code 0 is not a code (codes start at 1; an unnamed code above that is accepted, see the "reject_code_unknown"
        // server vector); a reason that is not UTF-8 (the same strictness for every server string).
        ("reject_code_zero", vec![0x82, 0, 0, 0]),
        ("server_bad_utf8", vec![0x82, 7, 0, 2, 0xc3, 0x28]),
        // Welcome maps: every MapBlob rule, one fault each.
        ("map_zero_size", welcome_map(0, 4, None, &[])),
        ("map_too_large", welcome_map(2048, 1024, None, &[(0, 1)])),
        ("map_bad_tile", welcome_map(1, 1, None, &[(3, 1)])),
        ("map_zero_run", welcome_map(1, 1, None, &[(0, 0), (0, 1)])),
        ("map_run_past_size", welcome_map(1, 1, None, &[(0, 2)])),
        ("map_short", welcome_map(2, 1, None, &[(0, 1)])),
        (
            "map_hash_mismatch",
            welcome_map(
                1,
                1,
                Some(crate::map::layer_hash(1, 1, &[0]) ^ 1),
                &[(0, 1)],
            ),
        ),
    ]
    .into_iter()
    .chain(malformed_deltas())
    .collect()
}

/// What one frame of a chain does to a client's [`SnapshotTracker`].
pub enum ChainOutcome {
    /// The frame applies; a snapshot (Full or resolved from a delta) is the client's state afterwards.
    Applied(ServerMsg),
    /// The frame applies and the client then holds this many actors at this tick (a large state, not listed in full).
    Held { tick: u32, actors: usize },
    /// A Welcome: the tracker forgets its base.
    Reset,
    /// The delta is refused for this [`DeltaError::code`] and the client's state is unchanged.
    Refused(&'static str),
}

pub struct ChainStep {
    pub frame: Vec<u8>,
    pub outcome: ChainOutcome,
}

fn wa(id: u32, x: f32, y: f32, hp_pct: u8, status: u8) -> WireActor {
    WireActor {
        sig: 0,
        mob_type_code: 0,
        effects: 0,
        displace_seq: 0,
        id,
        faction: (id % 5) as u8,
        x,
        y,
        facing: 0.5,
        hp_pct,
        status,
        weapon: 2,
        bounty: 0,
        kind: 0,
    }
}

fn chain_self(x: f32) -> WireSelf {
    WireSelf {
        sig: 0,
        effects: 0,
        displace_seq: 0,
        id: 3,
        faction: 4,
        x,
        y: 320.5,
        facing: 1.5,
        hp: 1145.0,
        max_hp: 1145.0,
        status: 1,
        weapon: 5,
        ready_in_ms: 0,
        kills: 0,
        bounty: 0,
        gv: 0,
        move_seq: 0,
        hunt_target: None,
        hunt_stacks: 0,
    }
}

fn snap(
    tick: u32,
    phase: u8,
    ack: u32,
    me: Option<WireSelf>,
    actors: &[WireActor],
) -> SnapshotData {
    SnapshotData::build(tick, phase, ack, me, actors.iter().copied()).expect("a valid sample")
}

/// The base every refusal chain starts from: tick 10, a self (id 3) and actors 1, 5 and 9.
fn refusal_base() -> SnapshotData {
    snap(
        10,
        1,
        4,
        Some(chain_self(400.0)),
        &[
            wa(1, 100.0, 100.0, 100, 1),
            wa(5, 200.0, 100.0, 80, 1),
            wa(9, 300.0, 100.0, 100, 1),
        ],
    )
}

fn full_frame(s: &SnapshotData) -> Vec<u8> {
    let mut v = Vec::new();
    s.encode_full_into(&mut v);
    v
}

fn delta_message(d: SnapshotDelta) -> Vec<u8> {
    ServerMsg::SnapshotDelta(d).encode()
}

/// A delta of the refusal base (tick 10 -> 11) with nothing in it, to be filled in.
fn empty_delta() -> SnapshotDelta {
    SnapshotDelta {
        training: false,
        tick: 11,
        base_tick: 10,
        phase: None,
        ack_input: 4,
        me: Some(SelfDelta::default()),
        changed: vec![],
        departed: vec![],
    }
}

/// Chains of frames for a client's tracker, each starting from a fresh one: the result after every frame (the snapshot the
/// client holds, a reset, or the reason a delta is refused and the state kept). The first chain is produced by the real
/// [`ConnEncoder`] (a full house of cases); the others are hand-made deltas a correct writer never sends.
#[allow(clippy::approx_constant)] // a facing of -3.1415927 is deliberate: an f32 at the -PI edge of the angle range
pub fn chain_samples() -> Vec<(&'static str, Vec<ChainStep>)> {
    let mut chains = Vec::new();
    // The combined protocol must preserve independent training and hunt fields, including a real target clear.
    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut prior = None;
        let mut steps = Vec::new();
        for (tick, target, stacks, training) in [
            (1, Some(u32::MAX), u16::MAX, true),
            (2, None, 0, true),
            (3, Some(9), 4, true),
            (4, None, 0, false),
        ] {
            let mut me = chain_self(400.0 + tick as f32);
            me.hunt_target = target;
            me.hunt_stacks = stacks;
            let mut actors: Vec<_> = (1..=8).map(|id| wa(id, 10., 20., 100, 1)).collect();
            actors[0].kind = 2; // Zombie retains kind 2.
            actors[1].kind = 3; // TrainingDummy uses a distinct kind.
            let mut data = snap(tick, 3, tick, Some(me), &actors);
            data.set_training(training);
            let (frame, kind) = encoder.encode_frame(data.clone());
            assert_eq!(
                kind,
                if tick == 1 {
                    FrameKind::Full
                } else {
                    FrameKind::Delta
                }
            );
            if let Some(ref base) = prior {
                let reference = ServerMsg::SnapshotDelta(delta::diff(base, &data).unwrap());
                assert_eq!(
                    reference.encode(),
                    frame,
                    "fast and reference hunt clear agree"
                );
            }
            let got = tracker.decode(&frame).unwrap();
            assert_eq!(got, data.decoded());
            assert_eq!(tracker.snapshot(), Some(got.clone()));
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
            prior = Some(data);
        }
        chains.push(("union_training_hunt_clear", steps));
    }

    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        for (tick, code, sig) in [(1, 30, 255), (2, 1, 1), (3, 0, 0)] {
            let mut me = chain_self(1.);
            me.sig = sig;
            let mut actors: Vec<_> = (1..=8).map(|id| wa(id, 10., 20., 100, 1)).collect();
            actors[0].mob_type_code = code;
            actors[0].sig = sig;
            let data = snap(tick, 1, 0, Some(me), &actors);
            let mut frame = Vec::new();
            let kind = encoder.encode(data.clone(), &mut frame);
            assert_eq!(
                kind,
                if tick == 1 {
                    FrameKind::Full
                } else {
                    FrameKind::Delta
                }
            );
            let got = tracker.decode(&frame).unwrap();
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
        }
        chains.push(("pve_scalar_clears", steps));
    }
    // A connection's life: Full first, then deltas, a tick gap, an actor appearing and leaving, rare self fields, a self that
    // goes away (a delta) and comes back (a Full), a resync (a Full), and deltas again.
    let crowd = |dx: f32| -> Vec<WireActor> {
        (1..=6)
            .map(|i| wa(i * 2, 100.0 * i as f32 + dx, 50.0, 100, 1))
            .collect()
    };
    let mut s3 = crowd(1.0);
    s3.push(WireActor {
        kind: 3,
        ..wa(7, 9.0, 9.0, 100, 1)
    });
    s3.sort_by_key(|a| a.id);
    let mut s4 = crowd(2.0);
    s4.remove(1);
    s4[0].hp_pct = 41;
    s4[2].status = 2;
    s4[3].bounty = 300;
    s4[4].weapon = 5;
    s4[3].kind = 7;
    let mut self4 = chain_self(402.0);
    self4.hp = -0.0;
    self4.max_hp = 1145.5;
    self4.weapon = 1;
    self4.status = 2;
    let mut self5 = self4;
    self5.kills = 3;
    self5.bounty = 70;
    self5.gv = 20_000;
    self5.ready_in_ms = 250;
    self5.move_seq = 9;
    self5.x = 5119.875;
    self5.facing = -3.1415927;
    let plan: Vec<(SnapshotData, FrameKind)> = vec![
        (
            snap(100, 1, 1, Some(chain_self(400.0)), &crowd(0.0)),
            FrameKind::Full,
        ),
        (
            snap(101, 1, 1, Some(chain_self(401.0)), &crowd(0.5)),
            FrameKind::Delta,
        ),
        (
            snap(102, 1, 2, Some(chain_self(401.0)), &s3),
            FrameKind::Delta,
        ),
        (snap(103, 2, 2, Some(self4), &s4), FrameKind::Delta),
        (snap(108, 2, 300, Some(self5), &s4), FrameKind::Delta),
        (snap(109, 2, 300, None, &s4), FrameKind::Delta),
        (snap(110, 2, 300, Some(self5), &s4), FrameKind::Full),
        (snap(111, 2, 301, Some(self5), &s4), FrameKind::Delta),
        (snap(112, 2, 301, Some(self5), &s4), FrameKind::Delta),
    ];
    let mut enc = ConnEncoder::new();
    let mut tracker = SnapshotTracker::new();
    let mut steps = Vec::new();
    for (s, want) in plan {
        let mut frame = Vec::new();
        let kind = enc.encode(s.clone(), &mut frame);
        assert_eq!(kind, want, "chain sample at tick {}", s.tick());
        let msg = tracker.decode(&frame).expect("the chain applies");
        assert_eq!(msg, s.decoded());
        steps.push(ChainStep {
            frame,
            outcome: ChainOutcome::Applied(msg),
        });
    }
    // A resync request, then one more snapshot: Full.
    enc.request_full();
    let s = snap(113, 2, 302, Some(self5), &s4);
    let mut frame = Vec::new();
    assert_eq!(enc.encode(s.clone(), &mut frame), FrameKind::Full);
    let msg = tracker.decode(&frame).expect("applies");
    steps.push(ChainStep {
        frame,
        outcome: ChainOutcome::Applied(msg),
    });
    chains.push(("delta_chain", steps));

    let applied = |t: &mut SnapshotTracker, f: Vec<u8>| -> ChainStep {
        let msg = t.decode(&f).expect("applies");
        ChainStep {
            frame: f,
            outcome: ChainOutcome::Applied(msg),
        }
    };
    let refused = |t: &mut SnapshotTracker, f: Vec<u8>, code: &'static str| -> ChainStep {
        let e = t.decode(&f).expect_err("refused");
        match e {
            TrackError::Delta(d) => assert_eq!(d.code(), code),
            other => panic!("not a delta refusal: {other:?}"),
        }
        ChainStep {
            frame: f,
            outcome: ChainOutcome::Refused(code),
        }
    };
    let mut refusal = |name: &'static str, d: SnapshotDelta, code: &'static str| {
        let mut t = SnapshotTracker::new();
        let base = applied(&mut t, full_frame(&refusal_base()));
        let bad = refused(&mut t, delta_message(d), code);
        // The refusal changed nothing: the empty delta of the real base still applies and equals the base at tick 11.
        let ok = applied(&mut t, delta_message(empty_delta()));
        chains.push((name, vec![base, bad, ok]));
    };
    let new_actor = |id: u32| ActorDelta {
        mask: AD_NEW,
        q: QActor {
            id,
            x: 8,
            y: 8,
            ..QActor::default()
        },
    };
    refusal(
        "delta_base_mismatch",
        SnapshotDelta {
            training: false,
            base_tick: 9,
            tick: 11,
            ..empty_delta()
        },
        "base_mismatch",
    );
    refusal(
        "delta_departs_unknown_actor",
        SnapshotDelta {
            departed: vec![7],
            ..empty_delta()
        },
        "unknown_departed",
    );
    refusal(
        "delta_updates_departed_actor",
        SnapshotDelta {
            changed: vec![ActorDelta {
                mask: AD_X,
                q: QActor {
                    id: 5,
                    x: 77,
                    status: 1,
                    ..QActor::default()
                },
            }],
            departed: vec![5],
            ..empty_delta()
        },
        "departed_and_changed",
    );
    refusal(
        "delta_updates_unknown_actor",
        SnapshotDelta {
            changed: vec![ActorDelta {
                mask: AD_X,
                q: QActor {
                    id: 7,
                    x: 77,
                    status: 1,
                    ..QActor::default()
                },
            }],
            ..empty_delta()
        },
        "incomplete_new_actor",
    );
    // More than MAX_ACTORS after applying: a base of MAX_ACTORS actors and one new one.
    {
        let crowd512: Vec<WireActor> = (0..MAX_ACTORS as u32)
            .map(|i| wa(i * 2 + 2, 10.0, 10.0, 100, 1))
            .collect();
        let base = snap(10, 1, 0, None, &crowd512);
        let mut t = SnapshotTracker::new();
        let mut s0 = applied(&mut t, full_frame(&base));
        s0.outcome = ChainOutcome::Held {
            tick: 10,
            actors: MAX_ACTORS,
        };
        let bad = refused(
            &mut t,
            delta_message(SnapshotDelta {
                me: None,
                changed: vec![new_actor(1)],
                ..empty_delta()
            }),
            "too_many_actors",
        );
        chains.push(("delta_past_max_actors", vec![s0, bad]));
    }
    // Resume: a Welcome resets the client, so a delta before the first Full of the new connection is refused.
    {
        let mut t = SnapshotTracker::new();
        let base = applied(&mut t, full_frame(&refusal_base()));
        let welcome = server_samples()
            .into_iter()
            .find(|(n, _)| *n == "welcome")
            .expect("welcome sample")
            .1
            .encode();
        t.decode(&welcome).expect("welcome");
        let reset = ChainStep {
            frame: welcome,
            outcome: ChainOutcome::Reset,
        };
        let bad = refused(&mut t, delta_message(empty_delta()), "no_base");
        let full = applied(&mut t, full_frame(&refusal_base()));
        let ok = applied(&mut t, delta_message(empty_delta()));
        chains.push(("delta_after_welcome", vec![base, reset, bad, full, ok]));
    }
    // A delta with nothing before it.
    {
        let mut t = SnapshotTracker::new();
        let bad = refused(&mut t, delta_message(empty_delta()), "no_base");
        chains.push(("delta_without_base", vec![bad]));
    }
    // A self delta on a base that has no self.
    {
        let mut t = SnapshotTracker::new();
        let base = snap(10, 1, 4, None, &[wa(1, 1.0, 1.0, 100, 1)]);
        let s0 = applied(&mut t, full_frame(&base));
        let bad = refused(&mut t, delta_message(empty_delta()), "self_without_base");
        chains.push(("delta_self_without_base", vec![s0, bad]));
    }
    chains
}

/// A delta frame with a hand-written body: tag, tick, age, ack, `head`, then `rest`.
fn delta_bytes(tick: u32, age: u32, head: u32, rest: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x87);
    w.varint(tick);
    w.varint(age);
    w.varint(0);
    w.varint(head);
    w.bytes(rest);
    w.finish()
}

/// Delta frames a client must reject on syntax alone (the same names and reasons in the Rust, C# and JS tests).
pub fn malformed_deltas() -> Vec<(&'static str, Vec<u8>)> {
    let valid = delta_message(SnapshotDelta {
        me: None,
        changed: vec![ActorDelta {
            mask: AD_X,
            q: QActor {
                id: 5,
                x: 40,
                status: 1,
                ..QActor::default()
            },
        }],
        ..empty_delta()
    });
    let mut trailing = valid.clone();
    trailing.push(0);
    let record = |id: u8, mask: u32, extra: &[u8]| -> Vec<u8> {
        let mut v = vec![id, mask as u8];
        v.extend_from_slice(extra);
        v
    };
    vec![
        ("delta_age_zero", delta_bytes(10, 0, 0, &[0])),
        ("delta_age_over_max", delta_bytes(100, 65, 0, &[0])),
        ("delta_age_past_tick", delta_bytes(5, 6, 0, &[0])),
        (
            "delta_head_field_without_present_bit",
            delta_bytes(10, 1, DH_X, &[0]),
        ),
        // Bit 18 is not a field of this version.
        ("delta_head_unknown_bit", delta_bytes(10, 1, 1 << 21, &[0])),
        (
            "delta_head_overlong_varint",
            vec![0x87, 10, 1, 0, 0x80, 0x00, 0],
        ),
        (
            "delta_self_status_over_3",
            delta_bytes(10, 1, DH_PRESENT | DH_STATUS, &[4, 0]),
        ),
        ("delta_phase_over_3", delta_bytes(10, 1, DH_PHASE, &[4, 0])),
        // Actor delta bit 12 is not a field of this version.
        (
            "delta_actor_mask_unknown_bit",
            delta_bytes(10, 1, 0, &[1, 1, 0x80, 0x20]),
        ),
        (
            "delta_actor_status_over_3",
            delta_bytes(10, 1, 0, &[vec![1], record(1, AD_STATUS, &[4])].concat()),
        ),
        (
            "delta_actor_id_gap_zero",
            delta_bytes(
                10,
                1,
                0,
                &[vec![2], record(1, 0, &[]), record(0, 0, &[])].concat(),
            ),
        ),
        (
            "delta_actor_hp_over_100",
            delta_bytes(10, 1, 0, &[vec![1], record(1, AD_HP, &[101])].concat()),
        ),
        (
            "delta_actor_bounty_over_u16",
            delta_bytes(
                10,
                1,
                0,
                &[vec![1], record(1, AD_BOUNTY, &[0x80, 0x80, 0x04])].concat(),
            ),
        ),
        (
            "delta_too_many_actors",
            delta_bytes(10, 1, 0, &[0x81, 0x04]),
        ),
        (
            "delta_departed_empty",
            delta_bytes(10, 1, DH_DEPARTED, &[0, 0]),
        ),
        (
            "delta_departed_id_gap_zero",
            delta_bytes(10, 1, DH_DEPARTED, &[0, 2, 5, 0]),
        ),
        (
            "delta_departed_too_many",
            delta_bytes(10, 1, DH_DEPARTED, &[0, 0x81, 0x04]),
        ),
        ("delta_truncated", valid[..valid.len() - 1].to_vec()),
        ("delta_trailing_byte", trailing),
    ]
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A decoded float as the vectors carry it: its exact bit pattern.
fn bits(v: f32) -> u32 {
    v.to_bits()
}

/// What a decoder must produce for a Snapshot: every field, floats as bit patterns, server time derived from the tick.
fn decoded_snapshot_json(m: &ServerMsg) -> String {
    let ServerMsg::Snapshot {
        tick,
        phase,
        ack_input,
        me,
        actors,
        training,
    } = m
    else {
        unreachable!("only snapshots carry a decoded form")
    };
    let me = match me {
        None => "null".to_string(),
        Some(s) => format!(
            "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpBits\": {}, \"maxHpBits\": {}, \"status\": {}, \"weapon\": {}, \"readyInMs\": {}, \"kills\": {}, \"bounty\": {}, \"gv\": {}, \"moveSeq\": {}, \"effects\": {}, \"displaceSeq\": {}, \"sig\": {}, \"huntTarget\": {}, \"huntStacks\": {}}}",
            s.id,
            s.faction,
            bits(s.x),
            bits(s.y),
            bits(s.facing),
            bits(s.hp),
            bits(s.max_hp),
            s.status,
            s.weapon,
            s.ready_in_ms,
            s.kills,
            s.bounty,
            s.gv,
            s.move_seq, s.effects, s.displace_seq, s.sig,
            s.hunt_target.map_or("null".to_string(), |v| v.to_string()), s.hunt_stacks
        ),
    };
    let actors: Vec<String> = actors
        .iter()
        .map(|a| {
            format!(
                "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpPct\": {}, \"status\": {}, \"weapon\": {}, \"bounty\": {}, \"kind\": {}, \"effects\": {}, \"displaceSeq\": {}, \"mobTypeCode\": {}, \"sig\": {}}}",
                a.id,
                a.faction,
                bits(a.x),
                bits(a.y),
                bits(a.facing),
                a.hp_pct,
                a.status,
                a.weapon,
                a.bounty,
                a.kind, a.effects, a.displace_seq, a.mob_type_code, a.sig
            )
        })
        .collect();
    format!(
        "{{\"tick\": {tick}, \"serverMs\": {}, \"phase\": {phase}, \"ack\": {ack_input}, \"training\": {training}, \"me\": {me}, \"actors\": [{}]}}",
        snapshot_server_ms(*tick),
        actors.join(", ")
    )
}

/// What a decoder must produce for an Fx: floats as bit patterns.
fn decoded_fx_json(m: &ServerMsg) -> String {
    let ServerMsg::Fx { tick, fx } = m else {
        unreachable!("not an Fx")
    };
    let items: Vec<String> = fx
        .iter()
        .map(|f| match *f {
            WireFx::Block { id, by, weapon } => format!("{{\"k\":\"block\",\"id\":{id},\"by\":{by},\"weapon\":{weapon}}}"),
            WireFx::Stagger { id } => format!("{{\"k\":\"stagger\",\"id\":{id}}}"),
            WireFx::Swing { by, weapon, x, y, a } => format!(
                "{{\"k\": \"swing\", \"by\": {by}, \"weapon\": {weapon}, \"xBits\": {}, \"yBits\": {}, \"aBits\": {}}}",
                bits(x),
                bits(y),
                bits(a)
            ),
            WireFx::Hit { victim, by, amount, passive } => format!(
                "{{\"k\": \"hit\", \"victim\": {victim}, \"by\": {by}, \"passive\": {passive}, \"amountBits\": {}}}",
                bits(amount)
            ),
            WireFx::Teleport => "{\"k\": \"teleport\"}".to_owned(),
        })
        .collect();
    format!("{{\"tick\": {tick}, \"fx\": [{}]}}", items.join(", "))
}

/// The manifest JSON (hand-written to keep this crate dependency-free; field names are the C# and JS tests' contract).
/// A server vector's `debug` is the message a client DECODES (quantized), not the sample as written.
pub fn manifest() -> String {
    let mut out = String::from("{\n  \"format\": \"rh-protocol-vectors/5\",\n  \"protocol\": ");
    out.push_str(&PROTOCOL_VERSION.to_string());
    out.push_str(",\n  \"client\": [\n");
    let c = client_samples();
    for (i, (name, m)) in c.iter().enumerate() {
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"}}{}\n",
            hex(&m.encode()),
            escape(&format!("{m:?}")),
            if i + 1 < c.len() { "," } else { "" }
        ));
    }
    out.push_str("  ],\n  \"server\": [\n");
    let s = server_samples();
    for (i, (name, m)) in s.iter().enumerate() {
        let bytes = m.encode();
        let decoded = ServerMsg::decode(&bytes).expect("a sample decodes");
        let snapshot = match decoded {
            ServerMsg::Snapshot { .. } => {
                format!(", \"decoded\": {}", decoded_snapshot_json(&decoded))
            }
            ServerMsg::Fx { .. } => format!(", \"decoded\": {}", decoded_fx_json(&decoded)),
            _ => String::new(),
        };
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"{snapshot}}}{}\n",
            hex(&bytes),
            escape(&format!("{decoded:?}")),
            if i + 1 < s.len() { "," } else { "" }
        ));
    }
    for (section, list) in [
        ("malformedClient", malformed_client()),
        ("malformedServer", malformed_server()),
    ] {
        out.push_str(&format!("  ],\n  \"{section}\": [\n"));
        for (i, (name, bytes)) in list.iter().enumerate() {
            out.push_str(&format!(
                "    {{\"name\": \"{name}\", \"hex\": \"{}\"}}{}\n",
                hex(bytes),
                if i + 1 < list.len() { "," } else { "" }
            ));
        }
    }
    out.push_str("  ],\n  \"chains\": [\n");
    let chains = chain_samples();
    for (i, (name, steps)) in chains.iter().enumerate() {
        out.push_str(&format!("    {{\"name\": \"{name}\", \"steps\": [\n"));
        for (j, step) in steps.iter().enumerate() {
            let result = match &step.outcome {
                ChainOutcome::Applied(m) => format!("\"decoded\": {}", decoded_snapshot_json(m)),
                ChainOutcome::Held { tick, actors } => {
                    format!("\"held\": {{\"tick\": {tick}, \"actors\": {actors}}}")
                }
                ChainOutcome::Reset => "\"reset\": true".to_string(),
                ChainOutcome::Refused(why) => format!("\"refused\": \"{why}\""),
            };
            out.push_str(&format!(
                "      {{\"hex\": \"{}\", {result}}}{}\n",
                hex(&step.frame),
                if j + 1 < steps.len() { "," } else { "" }
            ));
        }
        out.push_str(&format!(
            "    ]}}{}\n",
            if i + 1 < chains.len() { "," } else { "" }
        ));
    }
    out.push_str("  ]\n}\n");
    out
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
