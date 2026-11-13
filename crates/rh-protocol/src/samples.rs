//! The golden vectors: deterministic sample messages, and frames that must be rejected. The current versioned fixture is
//! generated from these (`cargo run -p rh-protocol --bin protocol-fixtures`) and read by the Rust, C# and JS tests. A
//! Snapshot or Fx vector also carries what a client must DECODE (floats as their exact bit patterns), so the three decoders are
//! held to the same quantization, not just to the same bytes.

use crate::delta::{
    AD_ALL, AD_BOUNTY, AD_HP, AD_KIND, AD_KIT, AD_NEW, AD_STATUS, AD_X, DH_DEPARTED, DH_GV, DH_HP,
    DH_KILLS, DH_MOVE_SEQ, DH_OWNER_COMBAT, DH_PHASE, DH_PRESENT, DH_STATUS, DH_X, DH_Y,
};
use crate::map::{MapBlob, MapCamp, MapColiseum, MapGate, MapProp, MapPublic, MapTile};
use crate::state::{
    WireBuildSummary, WireCampReward, WireMobBonusRow, WirePanelValue, WireWard, HUD_STAT_COUNT,
    MAX_QUEST_ROWS, MAX_QUEST_VIEW_BYTES, MAX_REWARD_CHESTS, MAX_ROSTER_NAME, MAX_SUMMARY_MOB_ROWS,
    MAX_VISIBLE_FIELDS, MAX_VISIBLE_PROPS, PANEL_CODE_COUNT,
};
use crate::*;
use crate::{
    AM_BOUNTY, AM_BUILD_MARKS, AM_FLAGS, AM_HP, AM_KIND, AM_KIT, AM_MARK, AM_MOB_TYPE, AM_OFFHAND,
    AM_STATUS, HM_BUILD_MARKS, HM_FLAGS, HM_MARK,
};

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
        ("input_cast_matrix_a", cast_matrix(&[0, 1])),
        ("input_cast_matrix_b", cast_matrix(&[2])),
        (
            "input_quest_accept",
            ClientMsg::Input {
                seq: 78,
                commands: vec![WireCommand::QuestAccept {
                    handle: QuestHandle::new(u32::MAX).unwrap(),
                }],
            },
        ),
        (
            "input_trade",
            ClientMsg::Input {
                seq: 79,
                commands: (0..=1)
                    .flat_map(|kind| {
                        (0..=2).map(move |pick| WireCommand::Trade {
                            kind: WireTradeKind::from_code(kind).unwrap(),
                            pick,
                        })
                    })
                    .collect(),
            },
        ),
        ("leave", ClientMsg::Leave),
        ("resync", ClientMsg::Resync),
    ]
}

fn cast_matrix(slots: &[u8]) -> ClientMsg {
    let commands = slots
        .iter()
        .flat_map(|slot| {
            (0..8u8).map(move |mask| WireCommand::Cast {
                slot: *slot,
                x: 321.25 + *slot as f32,
                y: 654.5,
                actor: (mask & 1 != 0).then_some(99),
                t: (mask & 2 != 0).then_some(1234.5),
                seq: (mask & 4 != 0).then_some(17),
            })
        })
        .collect();
    ClientMsg::Input { seq: 77, commands }
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
                healing_until: None,
                speed_boost_until: None,
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
                reward: None,
                ward: None,
            }]),
            StateItem::Projectiles(vec![
                WireProjectile {
                    kind: 0,
                    x: 800,
                    y: 900,
                    facing: 12345,
                    owner: Some(1),
                    height: 30,
                };
                2
            ]),
            StateItem::Plan(None),
            StateItem::Arena(None),
            StateItem::Quests(None),
            StateItem::Trade(None),
        ],
    }
}

fn quest_view_sample() -> WireQuestView {
    let roster = RosterId::new(7).unwrap();
    let quest = QuestHandle::new(17).unwrap();
    WireQuestView {
        unknown_count: 10,
        display_unknown_count: 9,
        owner_roster: Some(roster),
        roster: vec![WireRosterEntry {
            id: roster,
            label: "Ada".into(),
        }],
        rows: vec![WireQuestRow {
            handle: quest,
            def: "cull-fire".into(),
            giver: WireQuestPoint { x: 100.0, y: 200.0 },
            state: 1,
            expires_at: 6000.0,
            participants: vec![WireQuestParticipant {
                id: roster,
                accepted: true,
                progress: 1,
                visited: 1,
            }],
            carrier: None,
            carrier_actor: None,
            done_by: None,
            can_accept: true,
            owner_accepted: false,
            owner_progress: 0,
            owner_visited: 0,
            name: "The Ember Sweep".into(),
            giver_label: "Keeper Asha".into(),
            brief: "Thin the nearby fire mobs.".into(),
            objective: "Defeat 3 fire mobs".into(),
            reward: "A small reward".into(),
            owner_completed: false,
            owner_ready: false,
        }],
        objectives: vec![WireQuestObjective {
            quest,
            at: WireQuestPoint { x: 125.0, y: 250.0 },
        }],
    }
}

/// [`quest_view_sample`] whose row is carried by roster 7, with the carrier's public actor id when the viewer is
/// delivered that fighter (P-WIRE17-MAP-2).
fn quest_view_carried(actor: Option<u32>) -> WireQuestView {
    let mut view = quest_view_sample();
    view.rows[0].carrier = Some(RosterId::new(7).unwrap());
    view.rows[0].carrier_actor = actor;
    view
}

fn quest_view_at_max_bytes() -> WireQuestView {
    let mut view = WireQuestView {
        unknown_count: 0,
        display_unknown_count: 0,
        owner_roster: None,
        roster: vec![],
        rows: (1..=MAX_QUEST_ROWS as u32)
            .map(|id| WireQuestRow {
                handle: QuestHandle::new(id).unwrap(),
                def: "q".into(),
                giver: WireQuestPoint { x: 0.0, y: 0.0 },
                state: 0,
                expires_at: 0.0,
                participants: vec![],
                carrier: None,
                carrier_actor: None,
                done_by: None,
                can_accept: false,
                owner_accepted: false,
                owner_progress: 0,
                owner_visited: 0,
                name: String::new(),
                giver_label: String::new(),
                brief: String::new(),
                objective: String::new(),
                reward: String::new(),
                owner_completed: false,
                owner_ready: false,
            })
            .collect(),
        objectives: vec![],
    };
    view.rows.last_mut().unwrap().reward = "QUEST_MAX_SENTINEL".into();
    let encoded_size = |view: &WireQuestView| {
        ServerMsg::State {
            tick: 0,
            items: vec![StateItem::Quests(Some(view.clone()))],
        }
        .try_encode()
        .unwrap()
        .len()
            - 4 // tag, tick, item count, and collection key
    };
    let mut remaining = MAX_QUEST_VIEW_BYTES - encoded_size(&view);
    for (row_index, row) in view.rows.iter_mut().enumerate() {
        for (field_index, field) in [
            &mut row.name,
            &mut row.giver_label,
            &mut row.brief,
            &mut row.objective,
            &mut row.reward,
        ]
        .into_iter()
        .enumerate()
        {
            if row_index + 1 == MAX_QUEST_ROWS && field_index == 4 {
                continue;
            }
            let add = remaining.min(255 - field.len());
            field.push_str(&"x".repeat(add));
            remaining -= add;
        }
    }
    assert_eq!(
        remaining, 0,
        "Quest row strings can fill the exact view cap"
    );
    assert_eq!(encoded_size(&view), MAX_QUEST_VIEW_BYTES);
    view
}

fn trade_view_sample() -> WireTradeView {
    WireTradeView {
        trade_used: true,
        offers: vec![WireTradeOffer {
            cost: WireTradeStat::Ad,
            cost_value: f64::from_bits(0x3ff0_0000_0000_0001),
            gain: WireTradeStat::Shield,
            gain_value: f64::MAX,
            label: "Cost É → Gain".into(),
        }],
        stats: vec![
            WireTradeDelta {
                stat: WireTradeStat::Ad,
                value: -0.0,
            },
            WireTradeDelta {
                stat: WireTradeStat::Ad,
                value: -f64::MAX,
            },
        ],
        barter_ready_at: Some(-0.0),
        merchants: vec![
            WireMerchant {
                kind: WireTradeKind::Barter,
                x: 0.0,
                y: 8191.875,
                name: "Wandering Villager".into(),
            },
            WireMerchant {
                kind: WireTradeKind::Stats,
                x: f64::from_bits(0x3ff0_0000_0000_0001),
                y: 200.0,
                name: "Soul Broker".into(),
            },
        ],
        barter_labels: [
            "Give held weapon → Sword".into(),
            "Give held weapon → small healing potion".into(),
            "Give a small healing potion → Bow".into(),
        ],
    }
}

fn trade_view_max() -> WireTradeView {
    WireTradeView {
        trade_used: true,
        offers: (0..MAX_TRADE_OFFERS)
            .map(|i| WireTradeOffer {
                cost: WireTradeStat::MaxHp,
                cost_value: f64::MIN_POSITIVE,
                gain: WireTradeStat::Shield,
                gain_value: f64::MAX,
                label: format!("{}", (b'o' + i as u8) as char).repeat(255),
            })
            .collect(),
        stats: (0..MAX_TRADE_STATS)
            .map(|i| WireTradeDelta {
                stat: WireTradeStat::from_code(i as u8).unwrap(),
                value: if i == 0 { -0.0 } else { f64::MAX },
            })
            .collect(),
        barter_ready_at: Some(f64::MAX),
        merchants: (0..MAX_TRADE_MERCHANTS)
            .map(|i| WireMerchant {
                kind: if i == 0 {
                    WireTradeKind::Barter
                } else {
                    WireTradeKind::Stats
                },
                x: if i == 0 { 0.0 } else { 8191.875 },
                y: 8191.875,
                name: format!("{}", (b'm' + i as u8) as char).repeat(255),
            })
            .collect(),
        barter_labels: ["a".repeat(255), "b".repeat(255), "c".repeat(255)],
    }
}

fn state_all_max_budget() -> ServerMsg {
    let prop_start = u32::MAX - MAX_VISIBLE_PROPS as u32 + 1;
    let props = (0..MAX_VISIBLE_PROPS)
        .map(|i| WireProp {
            handle: PickupHandle::new(prop_start + i as u32).unwrap(),
            x: u16::MAX,
            y: u16::MAX,
            kind: WirePropKind::Body {
                label: String::new(),
            },
        })
        .collect::<Vec<_>>();
    let focus = WireFocus {
        handle: props.last().unwrap().handle,
        body_hint: Some(4),
    };
    let fields = (0..MAX_VISIBLE_FIELDS)
        .map(|_| WireField {
            kind: 2,
            ability: 4,
            owner: Some(u32::MAX),
            subject: Some(u32::MAX),
            x: f32::MAX,
            y: f32::MAX,
            x2: f32::MAX,
            y2: f32::MAX,
            r: f32::MAX,
            vx: f32::MAX,
            vy: f32::MAX,
            started_at: f64::MAX / 2.0,
            ends_at: f64::MAX,
        })
        .collect();
    let reward_start = u32::MAX - MAX_REWARD_CHESTS as u32 + 1;
    let rewards = (0..MAX_REWARD_CHESTS)
        .map(|i| WireRewardChest {
            handle: RewardChestHandle::new(reward_start + i as u32).unwrap(),
            x: u16::MAX,
            y: u16::MAX,
            expires_at: f64::MAX,
            options: (0..3)
                .map(|key| WireRewardOption {
                    id: WireRewardId::Kill {
                        key: TrophyStatKey::from_code(key).unwrap(),
                        gain: f64::MAX,
                    },
                    taken: true,
                    taken_by: Some(u32::MAX),
                })
                .collect(),
            picked: true,
            can_choose: true,
        })
        .collect();
    let build = WireBuild {
        cards: [u8::MAX; 80],
        boosts: [u8::MAX; 8],
    };
    let camps = (0..512)
        .map(|_| WireCamp {
            mob_type: 29,
            elite: Some(29),
            alive: 512,
            state: 2,
            cleared_at: f64::MAX / 2.0,
            respawn_at: f64::MAX,
            reward: Some(WireCampReward {
                stat: HUD_STAT_COUNT - 1,
                amount: u16::MAX,
            }),
            ward: Some(WireWard {
                yours: false,
                expires_at: f64::MAX,
            }),
        })
        .collect();
    let summary = WireBuildSummary {
        gains: [i32::MIN; 9],
        mob_rows: (0..MAX_SUMMARY_MOB_ROWS as u8)
            .map(|i| WireMobBonusRow {
                mob_type: 10 + i,
                stat: HUD_STAT_COUNT - 1,
                stacks: u32::MAX,
                total: i32::MIN,
            })
            .collect(),
        // P-WIRE17-HUD-2: every panel code; the prop-label padding below absorbs its bytes.
        panel: (0..PANEL_CODE_COUNT)
            .map(|code| WirePanelValue {
                code,
                value: i32::MIN,
            })
            .collect(),
    };
    let projectiles = (0..512)
        .map(|i| WireProjectile {
            kind: 1,
            x: u16::MAX,
            y: u16::MAX,
            facing: u16::MAX,
            owner: Some(u32::MAX - i),
            height: u8::MAX,
        })
        .collect();
    let plan = WirePlan {
        ends_at: f64::MAX,
        spawns: [Some(u32::MAX), Some(u32::MAX - 1)],
        taken: [true, true],
        pick: Some(1),
        boons: vec!["b".repeat(255); 4],
        boon: Some(1),
        ready: true,
        options: [
            Some(WirePlanOption {
                index: u32::MAX,
                x: u16::MAX,
                y: u16::MAX,
                zone: 5,
                walk_seconds: Some(f32::MAX),
            }),
            Some(WirePlanOption {
                index: u32::MAX - 1,
                x: u16::MAX,
                y: u16::MAX,
                zone: 5,
                walk_seconds: Some(f32::MAX),
            }),
        ],
    };
    let arena = WireArena {
        lobby_ends_at: f64::MAX,
        plan_ends_at: f64::MAX,
        raid_started_at: f64::MAX,
        patience_ends_at: Some(f64::MAX),
        in_coliseum: true,
        gates_locked: true,
        sudden_death_at: f64::MAX,
        started_with: 512,
        min_players: crate::state::MAX_MIN_PLAYERS,
    };
    let mut msg = ServerMsg::State {
        tick: u32::MAX,
        items: vec![
            StateItem::Inventory(Some(WireInventory {
                active_slot: 1,
                slots: [Some(4), Some(4)],
                potion_small: 5,
                potion_large: 5,
                potions_healing: 3,
                healing_until: Some(f64::MAX),
                speed_boost_until: Some(f64::MAX),
            })),
            StateItem::Props(WireProps {
                rows: props,
                focus: Some(focus),
            }),
            StateItem::Fields(fields),
            StateItem::RewardChests(rewards),
            StateItem::Build(Some(build)),
            StateItem::Camps(camps),
            StateItem::Projectiles(projectiles),
            StateItem::Plan(Some(plan)),
            StateItem::Arena(Some(arena)),
            StateItem::Quests(Some(quest_view_at_max_bytes())),
            StateItem::Trade(Some(trade_view_max())),
            StateItem::BuildSummary(Some(summary)),
        ],
    };

    let length = |msg: &ServerMsg| msg.try_encode().unwrap().len();
    let current = length(&msg);
    assert!(
        current <= 247_696,
        "unlabelled max State is {current} bytes"
    );
    let mut remaining = 247_696 - current;
    let ServerMsg::State { items, .. } = &mut msg else {
        unreachable!()
    };
    let StateItem::Props(props) = &mut items[1] else {
        unreachable!()
    };
    for row in &mut props.rows {
        let WirePropKind::Body { label } = &mut row.kind else {
            unreachable!()
        };
        let add = remaining.min(255 - label.len());
        label.push_str(&"p".repeat(add));
        remaining -= add;
    }
    assert_eq!(
        remaining,
        0,
        "Prop labels can reach the all-key budget exactly (unlabelled={current}, rows={})",
        props.rows.len()
    );
    assert_eq!(length(&msg), 247_696);
    msg
}

/// A sample archetype table (protocol 16): the legacy circle and two boxed rows, one with an id gap.
pub fn sample_archetypes() -> Vec<WireArchetype> {
    vec![
        WireArchetype {
            id: 0,
            key: "legacy_circle".into(),
            hull: WireHull::Circle { r: 12 },
            chest: 0,
        },
        WireArchetype {
            id: 1,
            key: "hero".into(),
            hull: WireHull::Boxes {
                fx: 10,
                fy: 6,
                bx: 16,
                by: 35,
                ox: 0,
                oy: -30,
            },
            chest: 30,
        },
        WireArchetype {
            id: 12,
            key: "mob-zombie".into(),
            hull: WireHull::Boxes {
                fx: 10,
                fy: 6,
                bx: 9,
                by: 21,
                ox: 0,
                oy: -21,
            },
            chest: 21,
        },
    ]
}

/// Writes an archetype table without checking it (for decoder refusal tests).
pub fn write_archetype_table_for_tests(w: &mut Writer, rows: &[WireArchetype]) {
    crate::archetype::write_table(w, rows);
}

/// A sample vision block: rule version 1 and a 2 x 1 coliseum rectangle at tile (1, 1).
pub fn sample_vision() -> WireVision {
    WireVision {
        coliseum: Some(WireRect {
            x: 1,
            y: 1,
            w: 2,
            h: 1,
        }),
        ..WireVision::default()
    }
}

/// A sample weapon table: the six weapons of the current content (`rh_sim::content::weapon`, wire ids 0..=5: sword, bow,
/// wand, shield, axe, fists) as the server sends them, plus a reserved no-shape row (id 31) so every kind is on the wire.
pub fn sample_weapons() -> Vec<WireWeapon> {
    use std::f64::consts::PI;
    let arc = |id, reach, half_arc| WireWeapon {
        id,
        kind: WEAPON_KIND_ARC,
        reach,
        half_arc,
        speed: 0.0,
        radius: 0.0,
    };
    let projectile = |id, reach, speed, radius| WireWeapon {
        id,
        kind: WEAPON_KIND_PROJECTILE,
        reach,
        half_arc: 0.0,
        speed,
        radius,
    };
    vec![
        arc(0, 112.0, PI / 4.0),
        projectile(1, 520.0, 900.0, 7.0),
        projectile(2, 640.0, 380.0, 2.0),
        arc(3, 96.0, PI / 3.0),
        arc(4, 112.0, PI / 2.0),
        arc(5, 72.0, PI / 3.0),
        WireWeapon {
            id: 31,
            kind: WEAPON_KIND_NONE,
            reach: 0.0,
            half_arc: 0.0,
            speed: 0.0,
            radius: 0.0,
        },
    ]
}

/// The sample HUD content block (P-WIRE17-HUD-2b): exactly what the server sends (`rh_policy::delivery::projection::
/// wire_hud`, held equal by the rh-policy oracle): the six weapons' scaling rows and every [`crate::HudTerm`] code.
/// Scaling: legacy `WEAPONS[w].scaling` / `.dominant` (packages/shared/src/weapons.ts:96-124) by wire id (sword, bow, wand,
/// shield, axe, fists). Terms: the legacy Wish constants (packages/shared/src/abilities.ts:140-167) and the Fire roam
/// constants (packages/shared/src/fireRoam.ts:2-7) by `HudTerm` code.
pub fn sample_hud() -> crate::WireHudContent {
    use crate::{WireHudTerm, WireWeaponScaling};
    let row = |id, ad, ap, bonus_hp, bonus_defense, dominant| WireWeaponScaling {
        id,
        ad,
        ap,
        bonus_hp,
        bonus_defense,
        dominant,
    };
    let terms: [f64; crate::MAX_HUD_TERMS] = [
        1250.0, // FreezeStunMs
        450.0,  // FreezeRange
        8000.0, // SwarmHiddenMs
        72.0,   // SwarmCloudRadius
        5000.0, // TrialZoneMs
        0.8,    // TrialDealtMult
        0.7,    // TrialMoveMult
        1.2,    // TrialTakenMult
        1500.0, // TrialExitStunMs
        300.0,  // TrialRadius
        200.0,  // TrialConvictedRadius
        30.0,   // BlazeBurnDps
        2000.0, // BlazeBurnMs
        64.0,   // BlazeMinDist
        300.0,  // BlazeMaxDist
        5000.0, // LastStandMs
        0.3,    // LastStandSpeedBonus
        0.3,    // LastStandHealShare
        1.0,    // LastStandFloorHp
        // P-WIRE17-HUD-2c: the legacy Fire roam constants (packages/shared/src/fireRoam.ts:2-7).
        20000.0, // FireRoamRampMs
        1000.0,  // FireRoamChargeMax
        50.0,    // FireRoamBurstBase
        0.4,     // FireRoamBurstAdShare
    ];
    crate::WireHudContent {
        scaling: vec![
            row(0, 1.0, 1.0, 0.0, 0.0, true),
            row(1, 1.0, 0.0, 0.0, 0.0, false),
            row(2, 0.3, 1.0, 0.0, 0.0, false),
            row(3, 0.0, 0.3, 0.0, 0.4, false),
            row(4, 1.0, 0.0, 0.02, 0.0, false),
            row(5, 0.6, 0.6, 0.0, 0.0, false),
        ],
        terms: terms
            .into_iter()
            .enumerate()
            .map(|(code, value)| WireHudTerm {
                code: code as u8,
                value,
            })
            .collect(),
    }
}

/// Writes a weapon table without checking it (for decoder refusal tests).
pub fn write_weapon_table_for_tests(w: &mut Writer, rows: &[WireWeapon]) {
    crate::weapon::write_weapon_table_for_tests(w, rows);
}

/// Where the weapon table starts after the Welcome header in the hand-built frames below: after an empty archetype table
/// and the default vision block.
const PRE_WEAPON_LEN: usize = 1 + crate::vision::VISION_BLOCK_LEN;

/// Where the HUD content block starts after the Welcome header in the hand-built frames below: after the empty weapon
/// table.
const PRE_HUD_LEN: usize = PRE_WEAPON_LEN + 1;

/// Bytes between the Welcome header and the map in the hand-built frames below: an empty archetype table, the default
/// vision block, an empty weapon table (protocol 16 and later) and an empty HUD content block (two count bytes,
/// P-WIRE17-HUD-2b).
const PRE_MAP_LEN: usize = PRE_HUD_LEN + 2;

const PUBLIC_W: u16 = 8;
const PUBLIC_H: u16 = 6;

/// An 8 x 6 map with protocol 17 public sections. `all` adds the reserved props and ground variants the server does not
/// ship yet; without it the map carries what the server ships (terrain, regions, camps, coliseum, bushes).
fn public_map(all: bool) -> MapBlob {
    let (w, h) = (PUBLIC_W as usize, PUBLIC_H as usize);
    let total = w * h;
    let mut tiles = vec![0u8; total];
    for x in 0..w {
        tiles[x] = 1;
        tiles[(h - 1) * w + x] = 1;
    }
    tiles[2 * w + 3] = 2;
    let terrain: Vec<u8> = tiles.iter().map(|&c| if c == 0 { 4 } else { 1 }).collect();
    let regions: Vec<u8> = (0..total).map(|i| (i % 7) as u8).collect();
    let mut bushes = vec![0u8; total];
    bushes[w + 1] = 1;
    bushes[w + 2] = 1;
    bushes[3 * w + 6] = 7;
    let public = MapPublic {
        camps: vec![
            MapCamp {
                x: 80,
                y: 48,
                r: 80,
                zone: 1,
            },
            MapCamp {
                x: 208,
                y: 144,
                r: 80,
                zone: 5,
            },
            MapCamp {
                x: 112,
                y: 80,
                r: 80,
                zone: 3,
            },
        ],
        coliseum: Some(MapColiseum {
            x: 2,
            y: 1,
            w: 4,
            h: 3,
            gates: vec![
                MapGate {
                    side: 0,
                    tiles: vec![MapTile { x: 3, y: 1 }, MapTile { x: 4, y: 1 }],
                },
                MapGate {
                    side: 1,
                    tiles: vec![MapTile { x: 5, y: 2 }],
                },
                MapGate {
                    side: 2,
                    tiles: vec![MapTile { x: 3, y: 3 }, MapTile { x: 4, y: 3 }],
                },
                MapGate {
                    side: 3,
                    tiles: vec![MapTile { x: 2, y: 2 }],
                },
            ],
        }),
        bushes: Some(bushes),
        props: if all {
            vec![
                MapProp {
                    kind: 3,
                    x: 100,
                    y: 60,
                    variant: 2,
                    flags: 1,
                },
                MapProp {
                    kind: 9,
                    x: 250,
                    y: 180,
                    variant: 0,
                    flags: 0,
                },
            ]
        } else {
            Vec::new()
        },
        ground_variants: all.then(|| (0..total).map(|i| (i / 5 % 3) as u8).collect()),
        patience: None,
        anchors: Vec::new(),
    };
    MapBlob::new_with_ground(
        PUBLIC_W,
        PUBLIC_H,
        tiles,
        Some(terrain),
        Some(regions),
        crate::GroundMode::Map,
    )
    .and_then(|map| map.with_public(public))
    .expect("the public sample map is valid")
}

/// [`public_map`] with every section plus a camp patience plane over its three camps: cell `i` carries `i % 4`
/// (P-WIRE17-MAP-2; section version 3).
fn public_map_patience() -> MapBlob {
    let map = public_map(true);
    let total = usize::from(map.w) * usize::from(map.h);
    let public = MapPublic {
        patience: Some((0..total).map(|i| (i % 4) as u8).collect()),
        ..map.public.clone()
    };
    map.with_public(public)
        .expect("the patience sample map is valid")
}

/// An 8 x 6 map dressed at the wire's boundaries (P-DRESS-BAKE-1): props in `(y, x, kind)` order covering a tall rule
/// prop, two props on one y, two on one `(y, x)`, the highest legacy kind with an unchecked variant and the highest rule
/// kind on the last world unit inside the map; with `ground`, every ground variant id 0..=15 row-major.
fn dressed_map(ground: bool) -> MapBlob {
    let (w, h) = (8u16, 6u16);
    let total = usize::from(w) * usize::from(h);
    let tiles: Vec<u8> = (0..total).map(|i| u8::from(i % 7 == 3)).collect();
    let prop = |kind, x, y, variant, flags| MapProp {
        kind,
        x,
        y,
        variant,
        flags,
    };
    let props = vec![
        prop(41, 48, 40, 0, 1),
        prop(3, 100, 60, 2, 0),
        prop(3, 101, 60, 3, 0),
        prop(7, 101, 60, 0, 0),
        prop(33, 16, 176, 200, 2),
        prop(100, 255, 191, 1, 1),
    ];
    MapBlob::new(w, h, tiles)
        .with_public(MapPublic {
            props,
            ground_variants: ground.then(|| (0..total).map(|i| (i % 16) as u8).collect()),
            ..MapPublic::default()
        })
        .expect("the dressed sample map is valid")
}

fn welcome_map_msg(map: MapBlob) -> ServerMsg {
    // The sample rectangle needs a map of at least 3 x 2 tiles; smaller sample maps carry no coliseum.
    let vision = if map.w >= 3 && map.h >= 2 {
        sample_vision()
    } else {
        WireVision::default()
    };
    ServerMsg::Welcome {
        vision,
        weapons: sample_weapons(),
        hud: sample_hud(),
        archetypes: sample_archetypes(),
        protocol: PROTOCOL_VERSION,
        content_hash: 0x0102_0304_0506_0708,
        match_id: [1; 16],
        player_id: 3,
        session: [2; 16],
        tick_rate: 20,
        tick: 100,
        server_ms: 5000.0,
        map,
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
        ("state_all_max_budget", state_all_max_budget()),
        (
            "state_quests_available",
            ServerMsg::State {
                tick: 204,
                items: vec![
                    StateItem::Props(WireProps {
                        rows: vec![WireProp {
                            handle: PickupHandle::new(1).unwrap(),
                            x: 1000,
                            y: 2000,
                            kind: WirePropKind::QuestItem {
                                quest: QuestHandle::new(17).unwrap(),
                                fetch: false,
                            },
                        }],
                        focus: None,
                    }),
                    StateItem::Quests(Some(quest_view_sample())),
                ],
            },
        ),
        // P-WIRE17-MAP-2: the carrier roster 7, delivered to this viewer as actor 5, then unseen (no actor id). "No
        // carrier" is `state_quests_available`.
        (
            "state_quests_carrier_visible",
            ServerMsg::State {
                tick: 207,
                items: vec![StateItem::Quests(Some(quest_view_carried(Some(5))))],
            },
        ),
        (
            "state_quests_carrier_hidden",
            ServerMsg::State {
                tick: 208,
                items: vec![StateItem::Quests(Some(quest_view_carried(None)))],
            },
        ),
        (
            "state_quests_empty",
            ServerMsg::State {
                tick: 205,
                items: vec![StateItem::Quests(Some(WireQuestView::default()))],
            },
        ),
        (
            "state_quests_unavailable",
            ServerMsg::State {
                tick: 206,
                items: vec![StateItem::Quests(None)],
            },
        ),
        (
            "state_quests_max_24576",
            ServerMsg::State {
                tick: 0,
                items: vec![StateItem::Quests(Some(quest_view_at_max_bytes()))],
            },
        ),
        (
            "state_ten_keys",
            ServerMsg::State {
                tick: 207,
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
                    StateItem::Quests(Some(WireQuestView::default())),
                ],
            },
        ),
        (
            "state_eleven_keys",
            ServerMsg::State {
                tick: 208,
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
                    StateItem::Quests(Some(WireQuestView::default())),
                    StateItem::Trade(None),
                ],
            },
        ),
        // P-WIRE17-HUD-1: camp rows with every reward/ward shape, and the owner's build summary (State key 13).
        (
            "state_camp_hud",
            ServerMsg::State {
                tick: 212,
                items: vec![StateItem::Camps(vec![
                    WireCamp {
                        mob_type: 3,
                        elite: Some(29),
                        alive: 2,
                        state: 0,
                        cleared_at: 1000.,
                        respawn_at: 181000.,
                        reward: Some(WireCampReward {
                            stat: 6,
                            amount: 12_500,
                        }),
                        ward: Some(WireWard {
                            yours: true,
                            expires_at: 61_000.,
                        }),
                    },
                    WireCamp {
                        mob_type: 7,
                        elite: None,
                        alive: 0,
                        state: 2,
                        cleared_at: 2000.,
                        respawn_at: 92_000.,
                        reward: Some(WireCampReward {
                            stat: 8,
                            amount: 50,
                        }),
                        ward: Some(WireWard {
                            yours: false,
                            expires_at: 90_500.5,
                        }),
                    },
                    WireCamp {
                        mob_type: 0,
                        elite: None,
                        alive: 3,
                        state: 0,
                        cleared_at: 0.,
                        respawn_at: 0.,
                        reward: None,
                        ward: None,
                    },
                ])],
            },
        ),
        (
            "state_build_summary",
            ServerMsg::State {
                tick: 213,
                items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
                    gains: [
                        120_000, 50_000, 905, 1_900, -337, 850_000, 65_000, -32_500, 600,
                    ],
                    mob_rows: vec![
                        WireMobBonusRow {
                            mob_type: 0,
                            stat: 2,
                            stacks: 7,
                            total: 700,
                        },
                        WireMobBonusRow {
                            mob_type: 4,
                            stat: 6,
                            stacks: 300,
                            total: 3_750_000,
                        },
                    ],
                    panel: Vec::new(),
                }))],
            },
        ),
        // P-WIRE17-HUD-2: a Fire owner's champion panel (codes 0..=9) after an empty mob list.
        (
            "state_build_summary_panel",
            ServerMsg::State {
                tick: 216,
                items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
                    gains: [25_000, 15_000, 0, -5_000, 0, 0, 0, 0, 0],
                    mob_rows: Vec::new(),
                    panel: [
                        (0, 18_182),
                        (1, 473_697),
                        (2, 0),
                        (3, 19_800),
                        (4, 643_750),
                        (5, 6_000),
                        (6, 5_000),
                        (7, 12_500),
                        (8, 2_500_000),
                        (9, 0),
                    ]
                    .into_iter()
                    .map(|(code, value)| WirePanelValue { code, value })
                    .collect(),
                }))],
            },
        ),
        // P-WIRE17-HUD-2c: the same Fire owner with the roam line and auto tooltip codes (Wand, Here Comes the Boom,
        // Offense I, SO I, 5 s out of combat): roam bonus 0.125, burst 54.8, hit mult 2.5, scaling 3.6 / 0.99 physical
        // and 12 / 0.99 magic.
        (
            "state_build_summary_panel_tooltip",
            ServerMsg::State {
                tick: 216,
                items: vec![StateItem::BuildSummary(Some(WireBuildSummary {
                    gains: [25_000, 15_000, 0, -5_000, 0, 0, 0, 0, 0],
                    mob_rows: Vec::new(),
                    panel: [
                        (0, 18_182),
                        (1, 473_697),
                        (2, 0),
                        (3, 19_800),
                        (4, 643_750),
                        (5, 6_000),
                        (6, 5_000),
                        (7, 12_500),
                        (8, 2_500_000),
                        (9, 0),
                        (23, 1_250),
                        (24, 548_000),
                        (25, 25_000),
                        (26, 36_364),
                        (27, 121_212),
                    ]
                    .into_iter()
                    .map(|(code, value)| WirePanelValue { code, value })
                    .collect(),
                }))],
            },
        ),
        (
            "state_build_summary_empty",
            ServerMsg::State {
                tick: 214,
                items: vec![StateItem::BuildSummary(Some(WireBuildSummary::default()))],
            },
        ),
        (
            "state_build_summary_none",
            ServerMsg::State {
                tick: 215,
                items: vec![StateItem::BuildSummary(None)],
            },
        ),
        // Protocol 16, ADR0026: State key 12, the roster (a multi-byte id gap, a bot, a 24-byte name, non-ASCII text).
        (
            "state_roster",
            ServerMsg::State {
                tick: 210,
                items: vec![StateItem::Roster(vec![
                    WireRosterRow {
                        id: 1,
                        bot: false,
                        name: "Wren".into(),
                    },
                    WireRosterRow {
                        id: 2,
                        bot: true,
                        name: "bot-Ashen_7".into(),
                    },
                    WireRosterRow {
                        id: 300,
                        bot: false,
                        name: "x".repeat(MAX_ROSTER_NAME),
                    },
                    WireRosterRow {
                        id: 301,
                        bot: true,
                        name: "S\u{f8}ren".into(),
                    },
                ])],
            },
        ),
        (
            "state_roster_empty",
            ServerMsg::State {
                tick: 211,
                items: vec![StateItem::Roster(vec![])],
            },
        ),
        (
            "state_trade_available",
            ServerMsg::State {
                tick: 209,
                items: vec![StateItem::Trade(Some(trade_view_sample()))],
            },
        ),
        (
            "state_trade_duplicate_delta_stats",
            ServerMsg::State {
                tick: 213,
                items: vec![StateItem::Trade(Some(trade_view_sample()))],
            },
        ),
        (
            "state_trade_empty",
            ServerMsg::State {
                tick: 210,
                items: vec![StateItem::Trade(Some(WireTradeView {
                    trade_used: false,
                    offers: vec![],
                    stats: vec![],
                    barter_ready_at: None,
                    merchants: vec![],
                    barter_labels: [String::new(), String::new(), String::new()],
                }))],
            },
        ),
        (
            "state_trade_unavailable",
            ServerMsg::State {
                tick: 211,
                items: vec![StateItem::Trade(None)],
            },
        ),
        (
            "state_trade_max_2213",
            ServerMsg::State {
                tick: 212,
                items: vec![StateItem::Trade(Some(trade_view_max()))],
            },
        ),
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
            "state_trophy_reward_keys",
            ServerMsg::State {
                tick: 203,
                items: vec![StateItem::RewardChests(
                    (0..3)
                        .map(|row| WireRewardChest {
                            handle: RewardChestHandle::new(row + 1).unwrap(),
                            x: 10 + row as u16,
                            y: 20 + row as u16,
                            expires_at: 9000.0,
                            options: (0..3)
                                .map(|slot| {
                                    let code = row * 3 + slot;
                                    let key = TrophyStatKey::from_code(code as u8).unwrap();
                                    WireRewardOption {
                                        id: WireRewardId::Kill {
                                            key,
                                            // Exact source-side codec control; deliberately not a gameplay corpus claim.
                                            gain: match code {
                                                0 => 0.125,
                                                1 => 0.25,
                                                2 => 0.375,
                                                3 => 0.5,
                                                4 => 0.625,
                                                5 => 0.75,
                                                6 => 0.875,
                                                7 => 1.0,
                                                _ => f64::from_bits(0x3fb9_9999_9999_999b),
                                            },
                                        },
                                        taken: false,
                                        taken_by: None,
                                    }
                                })
                                .collect(),
                            picked: false,
                            can_choose: true,
                        })
                        .collect(),
                )],
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
                        respawn_at: 0.,
                        reward: None,
                        ward: None,
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
                owner_combat: None,
                tick: 8,
                server_time: snapshot_server_ms(8),
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
                    ..WireActor::default()
                }],
            },
        ),
        (
            "snapshot_quest_giver_actor",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 14,
                server_time: snapshot_server_ms(14),
                phase: 1,
                ack_input: 9,
                me: None,
                actors: vec![WireActor {
                    id: 0x8000_0001,
                    faction: 15,
                    x: 123.125,
                    y: 456.75,
                    facing: -0.75,
                    hp_pct: 73,
                    status: 1,
                    weapon: 15,
                    bounty: 321,
                    kind: 4,
                    effects: 0x1234,
                    displace_seq: 17,
                    mob_type_code: 0,
                    sig: 29,
                    barrier_pct: 11,
                    barrier_ring_step: 2,
                    archetype: 1,
                    ..WireActor::default()
                }],
            },
        ),
        (
            "snapshot_unknown_kind_max_kit",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 15,
                server_time: snapshot_server_ms(15),
                phase: 1,
                ack_input: 10,
                me: Some(WireSelf {
                    id: 7,
                    faction: 15,
                    weapon: 15,
                    ..WireSelf::default()
                }),
                actors: vec![WireActor {
                    id: 9,
                    faction: 15,
                    weapon: 15,
                    kind: 255,
                    mob_type_code: 15,
                    hp_pct: 47,
                    effects: 0x00a5,
                    displace_seq: 9,
                    ..WireActor::default()
                }],
            },
        ),
        (
            "owner_combat_clear",
            ServerMsg::Snapshot {
                tick: 20,
                server_time: snapshot_server_ms(20),
                phase: 1,
                ack_input: 4,
                me: Some(WireSelf {
                    id: 3,
                    ..WireSelf::default()
                }),
                actors: vec![],
                training: false,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Clear,
                    draw_started_at: 0,
                    ready_at: 0,
                    as_milli: 1000.0,
                    windup_milli: 1000.0,
                    speed_milli: 1000.0,
                }),
            },
        ),
        (
            "owner_combat_held_none",
            ServerMsg::Snapshot {
                tick: 21,
                server_time: snapshot_server_ms(21),
                phase: 1,
                ack_input: 4,
                me: Some(WireSelf {
                    id: 3,
                    ..WireSelf::default()
                }),
                actors: vec![],
                training: false,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Held { target: None },
                    draw_started_at: 255,
                    ready_at: 510,
                    as_milli: 50.0,
                    windup_milli: 1500.0,
                    speed_milli: 2000.0,
                }),
            },
        ),
        (
            "owner_combat_held_player",
            ServerMsg::Snapshot {
                tick: 22,
                server_time: snapshot_server_ms(22),
                phase: 1,
                ack_input: 4,
                me: Some(WireSelf {
                    id: 3,
                    ..WireSelf::default()
                }),
                actors: vec![wa(9, 100.0, 100.0, 100, 1)],
                training: false,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Held { target: Some(9) },
                    draw_started_at: 3_000,
                    ready_at: 15_000,
                    as_milli: 650.0,
                    windup_milli: 1500.0,
                    speed_milli: 50.0,
                }),
            },
        ),
        (
            "owner_combat_mirror_min",
            ServerMsg::Snapshot {
                tick: 23,
                server_time: snapshot_server_ms(23),
                phase: 1,
                ack_input: 4,
                me: Some(WireSelf {
                    id: 3,
                    ..WireSelf::default()
                }),
                actors: vec![],
                training: false,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Clear,
                    draw_started_at: u32::MAX,
                    ready_at: u32::MAX,
                    as_milli: 50.0,
                    windup_milli: 50.0,
                    speed_milli: 50.0,
                }),
            },
        ),
        (
            "owner_combat_mirror_max_finite",
            ServerMsg::Snapshot {
                tick: 24,
                server_time: snapshot_server_ms(24),
                phase: 1,
                ack_input: 4,
                me: Some(WireSelf {
                    id: 3,
                    ..WireSelf::default()
                }),
                actors: vec![],
                training: false,
                owner_combat: Some(WireOwnerCombat {
                    lock: WireOwnerLock::Clear,
                    draw_started_at: u32::MAX,
                    ready_at: 0,
                    as_milli: f64::MAX,
                    windup_milli: f64::MAX,
                    speed_milli: f64::MAX,
                }),
            },
        ),
        (
            "delta_owner_combat_redundant_clear_owner_loss",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                tick: 25,
                server_time: snapshot_server_ms(25),
                training: false,
                base_tick: 24,
                phase: None,
                ack_input: 4,
                me: None,
                changed: vec![],
                departed: vec![],
                owner_combat: Some(None),
            }),
        ),
        // Protocol 11: a delta carrying the training bit (head bit 20).
        (
            "snapshot_delta_training",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                training: true,
                owner_combat: None,
                tick: 12,
                server_time: snapshot_server_ms(12),
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
                        // Legacy MIN_PLAYERS_TO_START (packages/shared/src/constants.ts:130).
                        min_players: 2,
                    })),
                ],
            },
        ),
        // P-WIRE17-HUD-3: the owner's healing-potion and wind-emblem end times on key 1 (server ms).
        (
            "state_inventory_clocks",
            ServerMsg::State {
                tick: 216,
                items: vec![StateItem::Inventory(Some(WireInventory {
                    active_slot: 1,
                    slots: [Some(0), Some(2)],
                    potion_small: 3,
                    potion_large: 1,
                    potions_healing: 2,
                    healing_until: Some(15_050.),
                    speed_boost_until: Some(17_000.),
                }))],
            },
        ),
        (
            "state_inventory_speed_boost",
            ServerMsg::State {
                tick: 216,
                items: vec![StateItem::Inventory(Some(WireInventory {
                    active_slot: 1,
                    slots: [Some(0), Some(2)],
                    potion_small: 3,
                    potion_large: 1,
                    potions_healing: 0,
                    healing_until: None,
                    speed_boost_until: Some(17_000.),
                }))],
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
                        critical: false,
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
        // Protocol 16, ADR0026: the windup telegraph (quantized angle, multi-byte attacker id), its cancel, a critical
        // passive hit, signature/ability chunks of every kind class, a redacted source and heals.
        (
            "fx_indicators",
            ServerMsg::Fx {
                tick: 901,
                fx: vec![
                    WireFx::Windup {
                        by: 70_000,
                        weapon: 0,
                        a: -2.5,
                        ms: 350,
                    },
                    WireFx::Windup {
                        by: 3,
                        weapon: 4,
                        a: 3.1415927,
                        ms: u16::MAX,
                    },
                    WireFx::Cancel { id: 70_000 },
                    WireFx::Hit {
                        victim: 2,
                        by: 3,
                        amount: 61.5,
                        passive: false,
                        critical: true,
                    },
                    WireFx::Hit {
                        victim: 3,
                        by: 2,
                        amount: 7.25,
                        passive: true,
                        critical: true,
                    },
                    WireFx::SigHit {
                        victim: 2,
                        by: 3,
                        kind: HIT_KIND_BURN,
                        amount: 12.0,
                    },
                    WireFx::SigHit {
                        victim: 2,
                        by: u32::MAX,
                        kind: HIT_KIND_DISEASE,
                        amount: 3.5,
                    },
                    WireFx::SigHit {
                        victim: 3,
                        by: 2,
                        kind: HIT_KIND_BACKLASH,
                        amount: 20.0,
                    },
                    WireFx::SigHit {
                        victim: 3,
                        by: 2,
                        kind: HIT_KIND_MARK,
                        amount: 40.0,
                    },
                    WireFx::SigHit {
                        victim: 3,
                        by: 2,
                        kind: HIT_KIND_ABILITY + 4,
                        amount: 9.0,
                    },
                    WireFx::Heal {
                        id: 3,
                        amount: 14.75,
                    },
                    WireFx::Heal {
                        id: 128,
                        amount: 0.5,
                    },
                ],
            },
        ),
        (
            "events_camp_cleared",
            ServerMsg::Events {
                tick: 902,
                events: vec![
                    WireEvent::CampCleared { camp: 0 },
                    WireEvent::CampCleared { camp: 511 },
                ],
            },
        ),
        (
            "wish_fx_started",
            ServerMsg::Fx {
                tick: 778,
                fx: vec![WireFx::WishStarted {
                    event_time: 38850.25,
                    caster: 17,
                    ability: 3,
                    duration: 625.5,
                    target: Some(42),
                    anchor: Some(WirePoint {
                        x: 100.25,
                        y: 200.5,
                    }),
                }],
            },
        ),
        (
            "wish_fx_landed",
            ServerMsg::Fx {
                tick: 779,
                fx: vec![WireFx::WishLanded {
                    event_time: 38900.75,
                    ability: 3,
                    caster: Some(17),
                    target: Some(42),
                    anchor: Some(WirePoint {
                        x: 100.25,
                        y: 200.5,
                    }),
                    destination: Some(WirePoint { x: 300.0, y: 400.0 }),
                }],
            },
        ),
        (
            "wish_fx_ended",
            ServerMsg::Fx {
                tick: 780,
                fx: vec![WireFx::WishEnded {
                    event_time: 38950.0,
                    caster: 17,
                    ability: 3,
                    reason: 2,
                }],
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
        ("welcome", welcome_map_msg(MapBlob::new(4, 3, tiles))),
        (
            "welcome_ground_both",
            welcome_map_msg(
                MapBlob::new_with_ground(
                    2,
                    2,
                    vec![0, 1, 2, 0],
                    Some(vec![0, 1, 2, 7]),
                    Some(vec![0, 1, 5, 6]),
                    crate::GroundMode::Map,
                )
                .unwrap(),
            ),
        ),
        (
            "welcome_ground_terrain_only",
            welcome_map_msg(
                MapBlob::new_with_ground(
                    2,
                    2,
                    vec![0, 1, 2, 0],
                    Some(vec![0, 1, 2, 7]),
                    None,
                    crate::GroundMode::Off,
                )
                .unwrap(),
            ),
        ),
        (
            "welcome_ground_regions_only",
            welcome_map_msg(
                MapBlob::new_with_ground(
                    2,
                    2,
                    vec![0, 1, 2, 0],
                    None,
                    Some(vec![0, 1, 5, 6]),
                    crate::GroundMode::All,
                )
                .unwrap(),
            ),
        ),
        (
            "welcome_ground_present_zero",
            welcome_map_msg(
                MapBlob::new_with_ground(
                    2,
                    2,
                    vec![0; 4],
                    Some(vec![0; 4]),
                    Some(vec![0; 4]),
                    crate::GroundMode::Off,
                )
                .unwrap(),
            ),
        ),
        (
            "welcome_ground_mode_all",
            welcome_map_msg(
                MapBlob::new_with_ground(2, 2, vec![0; 4], None, None, crate::GroundMode::All)
                    .unwrap(),
            ),
        ),
        // Protocol 17 public sections: every section, then what the server ships (camps, coliseum, bushes).
        ("welcome_public_all", welcome_map_msg(public_map(true))),
        ("welcome_public_shipped", welcome_map_msg(public_map(false))),
        // P-WIRE17-MAP-2: every section plus a camp patience plane (section version 3).
        (
            "welcome_public_patience",
            welcome_map_msg(public_map_patience()),
        ),
        // P-DRESS-BAKE-1: a dressed map, with and without its ground-variant plane.
        (
            "welcome_dress_props_ground",
            welcome_map_msg(dressed_map(true)),
        ),
        (
            "welcome_dress_props_only",
            welcome_map_msg(dressed_map(false)),
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
                owner_combat: None,
                tick: 101,
                server_time: snapshot_server_ms(101),
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
                    ..WireSelf::default()
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
                    ..WireActor::default()
                }],
            },
        ),
        (
            "snapshot_planning",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 7,
                server_time: snapshot_server_ms(7),
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
                owner_combat: None,
                tick: 1,
                server_time: snapshot_server_ms(1),
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
                owner_combat: None,
                tick: 127,
                server_time: snapshot_server_ms(127),
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
                    ..WireSelf::default()
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
                    ..WireActor::default()
                }],
            },
        ),
        // Every field set, multi-byte varints everywhere, off-grid and edge positions and angles (a tie rounds away from
        // zero, the facing of +pi wraps to -pi, the largest positions, 8191.875 and 8191.8, and a tiny one rounding to 0; the encoder refuses a position outside 0..=8191.875).
        (
            "snapshot_full",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 1_000_000,
                server_time: snapshot_server_ms(1_000_000),
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
                    ..WireSelf::default()
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
                        ..WireActor::default()
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
                        ..WireActor::default()
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
                        ..WireActor::default()
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
                        ..WireActor::default()
                    },
                ],
            },
        ),
        // Protocol 16, ADR0026: indicator facts on the self (flags, build marks, mark plate) and on actors (flags, off-hand,
        // build marks, mark plate): every flag bit, the largest stat key, an explicit fists off-hand (code 6), a lone first
        // mark, the mark plate's maxima and an engaged mob.
        (
            "snapshot_indicator_facts",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 77,
                server_time: snapshot_server_ms(77),
                phase: 1,
                ack_input: 5,
                me: Some(WireSelf {
                    id: 5,
                    faction: 1,
                    x: 100.0,
                    y: 200.0,
                    hp: 800.0,
                    max_hp: 1000.0,
                    status: 1,
                    flags: ACTOR_FLAG_WISH_READY
                        | ACTOR_FLAG_TELEPORT_IMMUNE
                        | ACTOR_FLAG_ROAM_READY,
                    build_marks: 1 | (3 << 4),
                    mark_tier: 2,
                    brand: 50,
                    mark_tax: 15,
                    ..WireSelf::default()
                }),
                actors: vec![
                    WireActor {
                        id: 6,
                        faction: 4,
                        x: 120.0,
                        y: 210.0,
                        hp_pct: 90,
                        status: 1,
                        weapon: 0,
                        flags: ACTOR_FLAG_WISH_READY,
                        offhand: 2,
                        build_marks: 9 | (5 << 4),
                        mark_tier: 4,
                        brand: 100,
                        mark_tax: 100,
                        ..WireActor::default()
                    },
                    WireActor {
                        id: 7,
                        faction: 2,
                        x: 130.0,
                        y: 210.0,
                        hp_pct: 100,
                        status: 1,
                        weapon: 3,
                        offhand: 6,
                        build_marks: 4,
                        ..WireActor::default()
                    },
                    WireActor {
                        id: 40,
                        faction: 3,
                        x: 160.0,
                        y: 220.0,
                        hp_pct: 100,
                        status: 1,
                        weapon: 4,
                        kind: 1,
                        mob_type_code: 3,
                        flags: ACTOR_FLAG_ENGAGED,
                        ..WireActor::default()
                    },
                    WireActor {
                        id: 41,
                        faction: 0,
                        x: 170.0,
                        y: 220.0,
                        hp_pct: 100,
                        status: 1,
                        weapon: 1,
                        flags: ACTOR_FLAGS_KNOWN,
                        ..WireActor::default()
                    },
                ],
            },
        ),
        // A zero max_hp (a varint 0) and a hp of -0.0 (bits preserved: the hp bit is set, as the bit patterns differ).
        (
            "snapshot_zero_hp",
            ServerMsg::Snapshot {
                training: false,
                owner_combat: None,
                tick: 16384,
                server_time: snapshot_server_ms(16384),
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
                    ..WireSelf::default()
                }),
                actors: vec![],
            },
        ),
        // Deltas (protocol v3). Nothing changed and no self: the smallest delta.
        (
            "snapshot_delta_empty",
            ServerMsg::SnapshotDelta(SnapshotDelta {
                training: false,
                owner_combat: None,
                tick: 102,
                server_time: snapshot_server_ms(102),
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
                owner_combat: None,
                tick: 1_000_000,
                server_time: snapshot_server_ms(1_000_000),
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
                            ..QActor::default()
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
                        critical: false,
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
                        critical: false,
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
    let cast_frame = |slot: u8, options: &[u8], x: f32| {
        let mut w = Writer::default();
        w.u8(2);
        w.u32(1);
        w.u16(1);
        w.u8(C_CAST);
        w.u8(slot);
        w.f32(x);
        w.f32(2.0);
        w.bytes(options);
        w.finish()
    };
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
        ("quest_accept_zero", vec![2, 0, 0, 0, 0, 1, 0, 17, 0]),
        ("quest_accept_truncated", vec![2, 0, 0, 0, 0, 1, 0, 17]),
        (
            "quest_accept_overlong",
            vec![2, 0, 0, 0, 0, 1, 0, 17, 0x81, 0],
        ),
        (
            "input_trade_kind_unknown",
            vec![2, 1, 0, 0, 0, 1, 0, C_TRADE, 2, 0],
        ),
        (
            "input_trade_pick_over_limit",
            vec![2, 1, 0, 0, 0, 1, 0, C_TRADE, 0, 3],
        ),
        ("cast_slot_over_2", cast_frame(3, &[], 1.0)),
        (
            "cast_actor_zero",
            cast_frame(0, &[1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1.0),
        ),
        ("cast_actor_option_over_1", cast_frame(0, &[2], 1.0)),
        ("cast_time_option_over_1", cast_frame(0, &[0, 2], 1.0)),
        ("cast_seq_option_over_1", cast_frame(0, &[0, 0, 2], 1.0)),
        ("cast_nonfinite_point", cast_frame(0, &[0, 0, 0], f32::NAN)),
        (
            "cast_nonfinite_time",
            cast_frame(0, &[0, 1, 0, 0, 0, 0, 0, 0, 0xf8, 0x7f, 0], 1.0),
        ),
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
/// A Welcome whose archetype table has rows `(id, shape)`: shape 0 a circle of radius 12, 1 a hero box row, 2 an unknown
/// hull tag, 3 a box with a zero half-extent. A valid 1x1 map follows.
fn welcome_archetypes(rows: &[(u8, u8)]) -> Vec<u8> {
    let good = welcome_map(1, 1, None, &[(1, 1)]);
    let mut table = Writer::default();
    table.u8(rows.len() as u8);
    for &(id, shape) in rows {
        table.u8(id);
        table.str("k");
        match shape {
            0 => {
                table.u8(0);
                table.u8(12);
            }
            2 => table.u8(2),
            _ => {
                table.u8(1);
                for v in [if shape == 3 { 0 } else { 10 }, 6, 16, 35, 0, (-30i8) as u8] {
                    table.u8(v);
                }
            }
        }
        table.u8(30);
    }
    let mut out = good[..WELCOME_HEADER_LEN].to_vec();
    out.extend(table.finish());
    out.extend_from_slice(&good[WELCOME_HEADER_LEN + 1..]);
    out
}

/// A Welcome on a valid 2 x 2 map whose vision block is these raw bytes (protocol 16 and later).
fn welcome_vision_bytes(block: &[u8]) -> Vec<u8> {
    let good = welcome_map(2, 2, None, &[(1, 4)]);
    let mut out = good[..WELCOME_HEADER_LEN + 1].to_vec();
    out.extend_from_slice(block);
    out.extend_from_slice(&good[WELCOME_HEADER_LEN + 1 + crate::vision::VISION_BLOCK_LEN..]);
    out
}

/// [`welcome_vision_bytes`] with `v` written unchecked.
fn welcome_vision(v: WireVision) -> Vec<u8> {
    let mut w = Writer::default();
    crate::vision::write_vision_for_tests(&mut w, &v);
    welcome_vision_bytes(&w.finish())
}

/// Vision blocks a client must refuse (each one fault), on a 2 x 2 map.
fn malformed_vision() -> Vec<(&'static str, Vec<u8>)> {
    let d = WireVision::default();
    let rect = |x, y, w, h| Some(WireRect { x, y, w, h });
    let mut flag = Writer::default();
    crate::vision::write_vision_for_tests(&mut flag, &d);
    let mut flag = flag.finish();
    *flag.last_mut().unwrap() = 2;
    let mut cut = Writer::default();
    crate::vision::write_vision_for_tests(&mut cut, &d);
    let cut = cut.finish();
    vec![
        (
            "welcome_vision_version_zero",
            welcome_vision(WireVision { version: 0, ..d }),
        ),
        (
            "welcome_vision_tile_zero",
            welcome_vision(WireVision { tile: 0.0, ..d }),
        ),
        (
            "welcome_vision_radius_nan",
            welcome_vision(WireVision {
                radius: f64::NAN,
                ..d
            }),
        ),
        (
            "welcome_vision_radius_negative",
            welcome_vision(WireVision {
                radius: -900.0,
                ..d
            }),
        ),
        (
            "welcome_vision_trail_negative",
            welcome_vision(WireVision {
                trail_ms: -1.0,
                ..d
            }),
        ),
        (
            "welcome_vision_update_infinite",
            welcome_vision(WireVision {
                update_ms: f64::INFINITY,
                ..d
            }),
        ),
        (
            "welcome_vision_mask_zero",
            welcome_vision(WireVision { sight_mask: 0, ..d }),
        ),
        ("welcome_vision_coliseum_flag", welcome_vision_bytes(&flag)),
        (
            "welcome_vision_coliseum_empty",
            welcome_vision(WireVision {
                coliseum: rect(0, 0, 0, 1),
                ..d
            }),
        ),
        (
            "welcome_vision_coliseum_outside",
            welcome_vision(WireVision {
                coliseum: rect(1, 0, 2, 1),
                ..d
            }),
        ),
        ("welcome_vision_truncated", {
            let good = welcome_map(2, 2, None, &[(1, 4)]);
            let mut out = good[..WELCOME_HEADER_LEN + 1].to_vec();
            out.extend_from_slice(&cut[..20]);
            out
        }),
    ]
}

/// A Welcome on a valid 2 x 2 map whose weapon table is these raw bytes (protocol 16 and later).
fn welcome_weapon_bytes(table: &[u8]) -> Vec<u8> {
    let good = welcome_map(2, 2, None, &[(1, 4)]);
    let at = WELCOME_HEADER_LEN + PRE_WEAPON_LEN;
    let mut out = good[..at].to_vec();
    out.extend_from_slice(table);
    out.extend_from_slice(&good[at + 1..]);
    out
}

/// [`welcome_weapon_bytes`] with `rows` written unchecked.
fn welcome_weapons(rows: &[WireWeapon]) -> Vec<u8> {
    let mut w = Writer::default();
    crate::weapon::write_weapon_table_for_tests(&mut w, rows);
    welcome_weapon_bytes(&w.finish())
}

/// Weapon tables a client must refuse (each one fault), on a 2 x 2 map.
fn malformed_weapons() -> Vec<(&'static str, Vec<u8>)> {
    use std::f64::consts::PI;
    let rows = sample_weapons();
    let (sword, bow) = (rows[0], rows[1]);
    let with = |i: usize, row: WireWeapon| {
        let mut t = rows.clone();
        t[i] = row;
        welcome_weapons(&t)
    };
    let mut kind = Writer::default();
    crate::weapon::write_weapon_table_for_tests(&mut kind, &[sword]);
    let mut kind = kind.finish();
    kind[2] = 3;
    let mut cut = Writer::default();
    crate::weapon::write_weapon_table_for_tests(&mut cut, &rows[..2]);
    let cut = cut.finish();
    vec![
        (
            "welcome_weapon_count",
            welcome_weapons(
                &(0..=MAX_WEAPONS as u8)
                    .map(|id| WireWeapon { id, ..sword })
                    .collect::<Vec<_>>(),
            ),
        ),
        ("welcome_weapon_truncated", {
            // Two rows promised, the second cut off inside its reach: the frame ends inside the table.
            let good = welcome_map(2, 2, None, &[(1, 4)]);
            let mut out = good[..WELCOME_HEADER_LEN + PRE_WEAPON_LEN].to_vec();
            out.extend_from_slice(&cut[..1 + crate::weapon::WEAPON_ROW_LEN + 6]);
            out
        }),
        ("welcome_weapon_kind", welcome_weapon_bytes(&kind)),
        ("welcome_weapon_order", {
            let mut t = rows.clone();
            t.swap(0, 1);
            welcome_weapons(&t)
        }),
        (
            "welcome_weapon_duplicate_id",
            with(1, WireWeapon { id: 0, ..bow }),
        ),
        (
            "welcome_weapon_reach_nan",
            with(
                0,
                WireWeapon {
                    reach: f64::NAN,
                    ..sword
                },
            ),
        ),
        (
            "welcome_weapon_speed_infinite",
            with(
                1,
                WireWeapon {
                    speed: f64::INFINITY,
                    ..bow
                },
            ),
        ),
        (
            "welcome_weapon_radius_negative",
            with(
                1,
                WireWeapon {
                    radius: -7.0,
                    ..bow
                },
            ),
        ),
        (
            "welcome_weapon_reach_over_max",
            with(
                1,
                WireWeapon {
                    reach: 1.0e6 + 1.0,
                    ..bow
                },
            ),
        ),
        (
            "welcome_weapon_arc_half_arc_over_pi",
            with(
                0,
                WireWeapon {
                    half_arc: PI + 0.001,
                    ..sword
                },
            ),
        ),
        (
            "welcome_weapon_arc_half_arc_zero",
            with(
                0,
                WireWeapon {
                    half_arc: 0.0,
                    ..sword
                },
            ),
        ),
        (
            "welcome_weapon_arc_reach_zero",
            with(
                0,
                WireWeapon {
                    reach: 0.0,
                    ..sword
                },
            ),
        ),
        (
            "welcome_weapon_arc_speed",
            with(
                0,
                WireWeapon {
                    speed: 1.0,
                    ..sword
                },
            ),
        ),
        (
            "welcome_weapon_projectile_speed_zero",
            with(1, WireWeapon { speed: 0.0, ..bow }),
        ),
        (
            "welcome_weapon_projectile_half_arc",
            with(
                1,
                WireWeapon {
                    half_arc: 0.5,
                    ..bow
                },
            ),
        ),
        (
            "welcome_weapon_none_values",
            with(
                6,
                WireWeapon {
                    reach: 1.0,
                    ..rows[6]
                },
            ),
        ),
    ]
}

/// A Welcome on a valid 2 x 2 map whose HUD content block (after the empty weapon table) is these raw bytes, followed by
/// the map (P-WIRE17-HUD-2b).
fn welcome_hud_bytes(block: &[u8]) -> Vec<u8> {
    let good = welcome_map(2, 2, None, &[(1, 4)]);
    let mut out = good[..WELCOME_HEADER_LEN + PRE_HUD_LEN].to_vec();
    out.extend_from_slice(block);
    out.extend_from_slice(&good[WELCOME_HEADER_LEN + PRE_MAP_LEN..]);
    out
}

/// [`welcome_hud_bytes`] with this block written unchecked.
fn welcome_hud(c: &crate::WireHudContent) -> Vec<u8> {
    let mut w = Writer::default();
    crate::hud_content::write_hud_content_for_tests(&mut w, c);
    welcome_hud_bytes(&w.finish())
}

/// HUD content blocks a client must refuse (each one fault), on a 2 x 2 map (P-WIRE17-HUD-2b).
fn malformed_hud_content() -> Vec<(&'static str, Vec<u8>)> {
    use crate::{WireHudContent, WireHudTerm};
    let sample = sample_hud();
    let sword = sample.scaling[0];
    let bow = sample.scaling[1];
    let scaling = |rows: Vec<crate::WireWeaponScaling>| {
        welcome_hud(&WireHudContent {
            scaling: rows,
            terms: Vec::new(),
        })
    };
    let terms = |rows: &[(u8, f64)]| {
        welcome_hud(&WireHudContent {
            scaling: Vec::new(),
            terms: rows
                .iter()
                .map(|&(code, value)| WireHudTerm { code, value })
                .collect(),
        })
    };
    let mut dominant = Writer::default();
    crate::hud_content::write_hud_content_for_tests(
        &mut dominant,
        &WireHudContent {
            scaling: vec![sword],
            terms: Vec::new(),
        },
    );
    let mut dominant = dominant.finish();
    // The sword row's dominant byte: after the count, the id and four f64.
    dominant[1 + crate::hud_content::SCALING_ROW_LEN - 1] = 2;
    vec![
        // Count 33, refused before any row is read: the map follows.
        ("welcome_hud_scaling_count", welcome_hud_bytes(&[33])),
        ("welcome_hud_scaling_dominant", welcome_hud_bytes(&dominant)),
        (
            "welcome_hud_scaling_nan",
            scaling(vec![crate::WireWeaponScaling {
                ad: f64::NAN,
                ..sword
            }]),
        ),
        (
            "welcome_hud_scaling_negative",
            scaling(vec![crate::WireWeaponScaling { ap: -0.5, ..sword }]),
        ),
        ("welcome_hud_scaling_order", scaling(vec![bow, sword])),
        // No rows, then a term count of 24 (MAX_HUD_TERMS + 1), refused before any term is read: the map follows.
        ("welcome_hud_term_count", welcome_hud_bytes(&[0, 24])),
        // The first unknown code (HUD_TERM_COUNT).
        ("welcome_hud_term_code", terms(&[(23, 1.0)])),
        ("welcome_hud_term_infinite", terms(&[(0, f64::INFINITY)])),
        (
            "welcome_hud_term_over_max",
            terms(&[(0, crate::hud_content::MAX_HUD_VALUE + 1.0)]),
        ),
        ("welcome_hud_term_order", terms(&[(4, 5000.0), (3, 72.0)])),
        ("welcome_hud_truncated", {
            // No rows, two terms promised, the second cut off after four bytes: the frame ends inside the block.
            let good = welcome_map(2, 2, None, &[(1, 4)]);
            let mut block = Writer::default();
            crate::hud_content::write_hud_content_for_tests(
                &mut block,
                &WireHudContent {
                    scaling: Vec::new(),
                    terms: vec![
                        WireHudTerm {
                            code: 0,
                            value: 1250.0,
                        },
                        WireHudTerm {
                            code: 1,
                            value: 450.0,
                        },
                    ],
                },
            );
            let block = block.finish();
            let mut out = good[..WELCOME_HEADER_LEN + PRE_HUD_LEN].to_vec();
            out.extend_from_slice(&block[..2 + crate::hud_content::HUD_TERM_ROW_LEN + 4]);
            out
        }),
    ]
}

/// A Welcome whose archetype table is one legacy-circle row with this key (written unchecked). A valid 1x1 map follows.
fn welcome_archetype_key(key: &str) -> Vec<u8> {
    let good = welcome_map(1, 1, None, &[(1, 1)]);
    let mut table = Writer::default();
    table.u8(1);
    table.u8(0);
    table.str(key);
    table.u8(0);
    table.u8(12);
    table.u8(0);
    let mut out = good[..WELCOME_HEADER_LEN].to_vec();
    out.extend(table.finish());
    out.extend_from_slice(&good[WELCOME_HEADER_LEN + 1..]);
    out
}

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
    // An empty archetype table, the default vision block and an empty weapon table (protocol 16 and later), then an empty
    // HUD content block (P-WIRE17-HUD-2b).
    b.u8(0);
    crate::vision::write_vision_for_tests(&mut b, &WireVision::default());
    b.u8(0);
    b.bytes(&[0, 0]);
    b.u16(w);
    b.u16(h);
    b.u32(hash.unwrap_or_else(|| crate::map::layer_hash(w as u32, h as u32, &tiles)));
    b.u32(runs.len() as u32);
    for &(t, n) in runs {
        b.u8(t);
        b.u16(n);
    }
    let semantic = crate::ground::semantic_hash(w, h, 0, None, None);
    b.u32(11);
    b.u8(crate::ground::SECTION_VERSION);
    b.u8(0);
    b.u32(semantic);
    b.u8(crate::GroundMode::Off as u8);
    b.u32(crate::ground::context_hash(
        hash.unwrap_or_else(|| crate::map::layer_hash(w as u32, h as u32, &tiles)),
        semantic,
        crate::GroundMode::Off,
    ));
    b.finish()
}

/// Run-length wire bytes of a plane (`u32` run count, then `value u8, len u16` maximal runs), for hand-built frames.
fn rle_wire(cells: &[u8]) -> Vec<u8> {
    let mut runs: Vec<(u8, u16)> = Vec::new();
    for &c in cells {
        match runs.last_mut() {
            Some((v, n)) if *v == c && *n < u16::MAX - 1 => *n += 1,
            _ => runs.push((c, 1)),
        }
    }
    let mut out = (runs.len() as u32).to_le_bytes().to_vec();
    for (v, n) in runs {
        out.push(v);
        out.extend_from_slice(&n.to_le_bytes());
    }
    out
}

/// One hand-built extension section: its wire bytes and what the semantic hash covers (cells for a plane, the wire bytes
/// for a list).
struct RawSection {
    wire: Vec<u8>,
    hashed: Vec<u8>,
}
fn raw_list(wire: Vec<u8>) -> RawSection {
    RawSection {
        hashed: wire.clone(),
        wire,
    }
}
fn raw_plane(cells: &[u8]) -> RawSection {
    RawSection {
        wire: rle_wire(cells),
        hashed: cells.to_vec(),
    }
}

const RAW_W: u16 = 4;
const RAW_H: u16 = 3;

/// A Welcome on a 4 x 3 all-floor map whose extension is written by hand (protocol 17): `version`, `flags` and the
/// sections as given, with the semantic hash over them, or (`stale_hash`) the hash of a map without those sections.
fn welcome_public_raw(
    version: u8,
    flags: u8,
    sections: &[RawSection],
    stale_hash: bool,
) -> Vec<u8> {
    welcome_public_raw_with(version, flags, None, sections, stale_hash)
}

/// [`welcome_public_raw`] for section version 3 (P-WIRE17-MAP-2): `presence2` follows `flags`, the semantic hash covers
/// `[3, flags, presence2]` (a zero `presence2` hashes as version 2: the decoder refuses it before the hash).
fn welcome_public_raw3(flags: u8, presence2: u8, sections: &[RawSection]) -> Vec<u8> {
    welcome_public_raw_with(3, flags, Some(presence2), sections, false)
}

fn welcome_public_raw_with(
    version: u8,
    flags: u8,
    presence2: Option<u8>,
    sections: &[RawSection],
    stale_hash: bool,
) -> Vec<u8> {
    let tiles = vec![0u8; usize::from(RAW_W) * usize::from(RAW_H)];
    let layer = crate::map::layer_hash(u32::from(RAW_W), u32::from(RAW_H), &tiles);
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
    // An empty archetype table, the default vision block, an empty weapon table and an empty HUD content block.
    b.u8(0);
    crate::vision::write_vision_for_tests(&mut b, &WireVision::default());
    b.u8(0);
    b.bytes(&[0, 0]);
    b.u16(RAW_W);
    b.u16(RAW_H);
    b.u32(layer);
    b.bytes(&rle_wire(&tiles));
    let semantic = if stale_hash {
        crate::ground::semantic_hash_parts(RAW_W, RAW_H, flags, [])
    } else {
        crate::ground::semantic_hash_parts2(
            RAW_W,
            RAW_H,
            flags,
            presence2.unwrap_or(0),
            sections.iter().map(|s| s.hashed.as_slice()),
        )
    };
    let mut ext = Writer::default();
    ext.u8(version);
    ext.u8(flags);
    if let Some(presence2) = presence2 {
        ext.u8(presence2);
    }
    ext.u32(semantic);
    for section in sections {
        ext.bytes(&section.wire);
    }
    ext.u8(crate::GroundMode::Off as u8);
    ext.u32(crate::ground::context_hash(
        layer,
        semantic,
        crate::GroundMode::Off,
    ));
    let ext = ext.finish();
    b.u32(ext.len() as u32);
    b.bytes(&ext);
    b.finish()
}

fn raw_camps(rows: &[(u16, u16, u16, u8)]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(rows.len() as u8);
    for &(x, y, r, zone) in rows {
        w.u16(x);
        w.u16(y);
        w.u16(r);
        w.u8(zone);
    }
    w.finish()
}

/// A gate in a hand-built coliseum section: its side code and its tiles.
type RawGate<'a> = (u8, &'a [(u16, u16)]);

/// `rect` (x, y, w, h) then the gates.
fn raw_coliseum(rect: (u16, u16, u16, u16), gates: &[RawGate<'_>]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u16(rect.0);
    w.u16(rect.1);
    w.u16(rect.2);
    w.u16(rect.3);
    w.u8(gates.len() as u8);
    for &(side, tiles) in gates {
        w.u8(side);
        w.u8(tiles.len() as u8);
        for &(x, y) in tiles {
            w.u16(x);
            w.u16(y);
        }
    }
    w.finish()
}

/// Protocol 17 map extensions every decoder refuses, each with the reason it must name (a `DecodeError::BadMap` reason,
/// or "truncated" for `DecodeError::Truncated`). Written to the vectors as `malformedMap`.
pub fn malformed_map() -> Vec<(&'static str, Vec<u8>, &'static str)> {
    let cells = usize::from(RAW_W) * usize::from(RAW_H);
    fn g(side: u8, tiles: &[(u16, u16)]) -> RawGate<'_> {
        (side, tiles)
    }
    fn col(gates: &[RawGate<'_>]) -> RawSection {
        raw_list(raw_coliseum((0, 0, RAW_W, RAW_H), gates))
    }
    let camps_over: Vec<(u16, u16, u16, u8)> = (0..=crate::map::MAX_MAP_CAMPS as u16)
        .map(|i| (16 + i, 16, 80, 1))
        .collect();
    let mut bush_truncated = rle_wire(&vec![0; cells]);
    bush_truncated[0..4].copy_from_slice(&5u32.to_le_bytes());
    let props_over = ((crate::map::MAX_MAP_PROPS + 1) as u16)
        .to_le_bytes()
        .to_vec();
    // P-WIRE17-MAP-2: one camp, and patience planes over the 4 x 3 map.
    let one_camp = || raw_list(raw_camps(&[(16, 16, 80, 1)]));
    let patience = |cell: u8| -> Vec<u8> { (0..cells).map(|i| u8::from(i == 5) * cell).collect() };
    // A run count past the extension (and past the cell count): truncation is checked first.
    let mut patience_truncated = rle_wire(&patience(1));
    patience_truncated[0..4].copy_from_slice(&200u32.to_le_bytes());
    vec![
        (
            "map17_section_version_1",
            welcome_public_raw(1, 0, &[], false),
            "section version",
        ),
        (
            "map17_presence_unknown",
            welcome_public_raw(2, 0x80, &[], false),
            "presence",
        ),
        (
            "map17_camp_count_zero",
            welcome_public_raw(2, 0x04, &[raw_list(vec![0])], false),
            "camp count",
        ),
        (
            "map17_camp_count_over",
            welcome_public_raw(2, 0x04, &[raw_list(raw_camps(&camps_over))], false),
            "camp count",
        ),
        (
            "map17_camp_zone_zero",
            welcome_public_raw(2, 0x04, &[raw_list(raw_camps(&[(16, 16, 80, 0)]))], false),
            "camp zone",
        ),
        (
            "map17_camp_zone_six",
            welcome_public_raw(2, 0x04, &[raw_list(raw_camps(&[(16, 16, 80, 6)]))], false),
            "camp zone",
        ),
        (
            "map17_coliseum_rect_empty",
            welcome_public_raw(
                2,
                0x08,
                &[raw_list(raw_coliseum((0, 0, 0, RAW_H), &[]))],
                false,
            ),
            "coliseum rect",
        ),
        (
            "map17_coliseum_rect_outside",
            welcome_public_raw(2, 0x08, &[raw_list(raw_coliseum((2, 0, 3, 1), &[]))], false),
            "coliseum rect",
        ),
        (
            "map17_gate_count",
            welcome_public_raw(
                2,
                0x08,
                &[col(&[g(0, &[(0, 0)]); crate::map::MAX_COLISEUM_GATES + 1])],
                false,
            ),
            "gate count",
        ),
        (
            "map17_gate_side",
            welcome_public_raw(2, 0x08, &[col(&[g(4, &[(0, 0)])])], false),
            "gate side",
        ),
        (
            "map17_gate_tiles_zero",
            welcome_public_raw(2, 0x08, &[col(&[g(0, &[])])], false),
            "gate tiles",
        ),
        (
            "map17_gate_tiles_over",
            welcome_public_raw(
                2,
                0x08,
                &[col(&[g(0, &[(0, 0); crate::map::MAX_GATE_TILES + 1])])],
                false,
            ),
            "gate tiles",
        ),
        (
            "map17_gate_tile_x",
            welcome_public_raw(2, 0x08, &[col(&[g(0, &[(RAW_W, 0)])])], false),
            "gate tile",
        ),
        (
            "map17_gate_tile_y",
            welcome_public_raw(2, 0x08, &[col(&[g(2, &[(0, RAW_H)])])], false),
            "gate tile",
        ),
        (
            "map17_bush_short",
            welcome_public_raw(2, 0x10, &[raw_plane(&vec![0; cells - 1])], false),
            "length",
        ),
        (
            "map17_bush_run_zero",
            welcome_public_raw(
                2,
                0x10,
                &[RawSection {
                    wire: 0u32.to_le_bytes().to_vec(),
                    hashed: Vec::new(),
                }],
                false,
            ),
            "run",
        ),
        (
            "map17_bush_truncated",
            welcome_public_raw(
                2,
                0x10,
                &[RawSection {
                    wire: bush_truncated,
                    hashed: vec![0; cells],
                }],
                false,
            ),
            "truncated",
        ),
        (
            "map17_prop_count_zero",
            welcome_public_raw(2, 0x20, &[raw_list(vec![0, 0])], false),
            "prop count",
        ),
        (
            "map17_prop_count_over",
            welcome_public_raw(2, 0x20, &[raw_list(props_over)], false),
            "prop count",
        ),
        (
            "map17_variants_short",
            welcome_public_raw(2, 0x40, &[raw_plane(&vec![1; cells - 1])], false),
            "length",
        ),
        (
            "map17_semantic_hash",
            welcome_public_raw(2, 0x04, &[raw_list(raw_camps(&[(16, 16, 80, 1)]))], true),
            "semantic hash",
        ),
        // P-DRESS-BAKE-1: dressing values a decoder refuses (the 4 x 3 map: x < 128, y < 96 world units).
        (
            "map17_dress_prop_kind_zero",
            one_prop((0, 16, 16, 0, 0)),
            "prop kind",
        ),
        (
            "map17_dress_prop_kind_over",
            one_prop((101, 16, 16, 0, 0)),
            "prop kind",
        ),
        (
            "map17_dress_legacy_kind_over",
            one_prop((34, 16, 16, 0, 2)),
            "prop kind",
        ),
        (
            "map17_dress_prop_flags",
            one_prop((1, 16, 16, 0, 4)),
            "prop flags",
        ),
        (
            "map17_dress_prop_variant",
            one_prop((1, 16, 16, 4, 0)),
            "prop variant",
        ),
        (
            "map17_dress_prop_x_outside",
            one_prop((1, 128, 16, 0, 0)),
            "prop tile",
        ),
        (
            "map17_dress_prop_y_outside",
            one_prop((1, 16, 96, 0, 0)),
            "prop tile",
        ),
        (
            "map17_dress_prop_order",
            welcome_public_raw(
                2,
                0x20,
                &[raw_list(raw_props(
                    2,
                    &[(1, 16, 48, 0, 0), (1, 16, 16, 0, 0)],
                ))],
                false,
            ),
            "prop order",
        ),
        (
            "map17_dress_prop_duplicate",
            welcome_public_raw(
                2,
                0x20,
                &[raw_list(raw_props(
                    2,
                    &[(1, 16, 16, 0, 0), (1, 16, 16, 0, 0)],
                ))],
                false,
            ),
            "prop order",
        ),
        (
            "map17_dress_props_truncated",
            welcome_public_raw(
                2,
                0x20,
                &[raw_list(raw_props(2, &[(1, 16, 16, 0, 0)]))],
                false,
            ),
            "truncated",
        ),
        (
            "map17_dress_ground_over",
            welcome_public_raw(2, 0x40, &[raw_plane(&vec![16; cells])], false),
            "ground variant",
        ),
        (
            "map17_dress_ground_long",
            welcome_public_raw(2, 0x40, &[raw_plane(&vec![1; cells + 1])], false),
            "run",
        ),
        // P-WIRE17-MAP-2: the camp patience plane (section version 3, presence2 0x01).
        (
            "map17_patience_camp_over",
            welcome_public_raw3(0x04, 0x01, &[one_camp(), raw_plane(&patience(2))]),
            "patience camp",
        ),
        (
            "map17_patience_without_camps",
            welcome_public_raw3(0x00, 0x01, &[raw_plane(&patience(1))]),
            "patience camp",
        ),
        (
            "map17_patience_length",
            welcome_public_raw3(0x04, 0x01, &[one_camp(), raw_plane(&vec![0; cells - 1])]),
            "length",
        ),
        (
            "map17_patience_truncated",
            welcome_public_raw3(
                0x04,
                0x01,
                &[
                    one_camp(),
                    RawSection {
                        wire: patience_truncated,
                        hashed: patience(1),
                    },
                ],
            ),
            "truncated",
        ),
        (
            "map17_v3_presence_empty",
            welcome_public_raw3(0x04, 0x00, &[one_camp()]),
            "presence",
        ),
        (
            "map17_v3_presence_unknown",
            welcome_public_raw3(0x04, 0x03, &[one_camp(), raw_plane(&patience(1))]),
            "presence",
        ),
    ]
}

/// A prop section with the given `count` and rows `(kind, x, y, variant, flags)` (a count above the rows is truncated).
fn raw_props(count: u16, rows: &[(u8, u16, u16, u8, u8)]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u16(count);
    for &(kind, x, y, variant, flags) in rows {
        w.u8(kind);
        w.u16(x);
        w.u16(y);
        w.u8(variant);
        w.u8(flags);
    }
    w.finish()
}

/// A Welcome on the 4 x 3 raw map whose only section is one prop row.
fn one_prop(row: (u8, u16, u16, u8, u8)) -> Vec<u8> {
    welcome_public_raw(2, 0x20, &[raw_list(raw_props(1, &[row]))], false)
}

fn ground_welcome_bytes(
    terrain: Option<Vec<u8>>,
    regions: Option<Vec<u8>>,
    mode: crate::GroundMode,
) -> Vec<u8> {
    let map = MapBlob::new_with_ground(1, 1, vec![0], terrain, regions, mode).unwrap();
    let mut w = Writer::default();
    w.u8(0x81);
    w.u16(PROTOCOL_VERSION);
    w.u64(0x1234);
    w.bytes(&[7; 16]);
    w.u32(1);
    w.bytes(&[9; 16]);
    w.u8(20);
    w.u32(0);
    w.f64(0.0);
    // An empty archetype table, the default vision block and an empty weapon table (protocol 16 and later), then an empty
    // HUD content block (P-WIRE17-HUD-2b).
    w.u8(0);
    crate::vision::write_vision_for_tests(&mut w, &WireVision::default());
    w.u8(0);
    w.bytes(&[0, 0]);
    map.write(&mut w);
    w.finish()
}

/// `at` is the offset in the frame without the blocks between the header and the map ([`PRE_MAP_LEN`]: the empty
/// archetype table, the vision block, the empty weapon table and the empty HUD content block move the map).
fn mutate_ground_welcome(mut frame: Vec<u8>, at: usize, bytes: &[u8]) -> Vec<u8> {
    let at = at + PRE_MAP_LEN;
    frame[at..at + bytes.len()].copy_from_slice(bytes);
    frame
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

fn actor_giver_tuple_bytes(faction: u8, weapon: u8, kind: u8, mob_type: Option<u8>) -> Vec<u8> {
    let mut mask = AM_KIT | AM_KIND;
    let mut extra = vec![(weapon << 4) | faction, kind];
    if let Some(mob_type) = mob_type {
        mask |= AM_MOB_TYPE;
        extra.push(mob_type);
    }
    actor_bytes(mask, &extra)
}

// Explicit malformed-wire builder: each independent field is deliberately mutable by the controls.
#[allow(clippy::too_many_arguments)]
fn quest_row_raw(
    handle: u32,
    def: &str,
    x: f64,
    y: f64,
    status: u8,
    expires: f64,
    participants: &[(u32, u8, u32, u8)],
    carrier: u32,
    done_by_flag: u8,
    done_by: Option<&str>,
    flags: u8,
    owner_progress: u32,
    owner_visited: u8,
) -> Vec<u8> {
    let mut w = Writer::default();
    w.varint(handle);
    w.str(def);
    w.f64(x);
    w.f64(y);
    w.u8(status);
    w.f64(expires);
    w.varint(participants.len() as u32);
    for &(id, accepted, progress, visited) in participants {
        w.varint(id);
        w.u8(accepted);
        w.varint(progress);
        w.u8(visited);
    }
    w.varint(carrier);
    w.u8(done_by_flag);
    if let Some(label) = done_by {
        w.str(label);
    }
    w.u8(flags);
    w.varint(owner_progress);
    w.u8(owner_visited);
    for _ in 0..5 {
        w.str("");
    }
    w.finish()
}

fn quest_view_raw(
    unknown: u32,
    display_unknown: u32,
    owner_roster: u32,
    roster: &[(u32, &str)],
    rows: &[Vec<u8>],
    objectives: &[(u32, f64, f64)],
) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(1);
    w.varint(unknown);
    w.varint(display_unknown);
    w.varint(owner_roster);
    w.varint(roster.len() as u32);
    for &(id, label) in roster {
        w.varint(id);
        w.str(label);
    }
    w.varint(rows.len() as u32);
    for row in rows {
        w.bytes(row);
    }
    w.varint(objectives.len() as u32);
    for &(quest, x, y) in objectives {
        w.varint(quest);
        w.f64(x);
        w.f64(y);
    }
    w.finish()
}

fn quest_state_raw(payload: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x88);
    w.varint(0);
    w.varint(1);
    w.varint(10);
    w.bytes(payload);
    w.finish()
}

fn trade_state_raw(payload: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x88);
    w.varint(0);
    w.varint(1);
    w.varint(11);
    w.bytes(payload);
    w.finish()
}

fn quest_props_state_raw(prop_quest: u32, fetch: u8, quest_view: &[u8]) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x88);
    w.varint(0);
    w.varint(2);
    w.varint(2); // Props key
    w.varint(1); // one prop
    w.varint(1);
    w.u16(0);
    w.u16(0);
    w.u8(7);
    w.varint(prop_quest);
    w.u8(fetch);
    w.varint(0); // no focus
    w.varint(10);
    w.bytes(quest_view);
    w.finish()
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
    w.bytes(&[0, 0]); // P-WIRE17-HUD-1: no reward, no ward (the fault under test is in the head)
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
    let mut quest_over_24576 = server_samples()
        .into_iter()
        .find(|(name, _)| *name == "state_quests_max_24576")
        .unwrap()
        .1
        .encode();
    let quest_sentinel = b"QUEST_MAX_SENTINEL";
    let sentinel_at = quest_over_24576
        .windows(quest_sentinel.len())
        .rposition(|window| window == quest_sentinel)
        .unwrap();
    let string_len_at = sentinel_at - 1;
    assert!(quest_over_24576[string_len_at] < u8::MAX);
    quest_over_24576[string_len_at] += 1;
    quest_over_24576.insert(sentinel_at + quest_sentinel.len(), b'x');
    let reward_frame = |option_count: u8, option_payload: &[u8]| {
        let mut w = Writer::default();
        w.u8(0x88);
        w.varint(1); // tick
        w.varint(1); // state item count
        w.varint(4); // reward chests
        w.varint(1); // chest count
        w.varint(1); // owner-issued chest handle
        w.u16(10);
        w.u16(20);
        w.f64(9000.0);
        w.u8(option_count);
        w.bytes(option_payload);
        w.finish()
    };
    let trade_offer_control = |cost: u8, cost_value: f64, gain: u8, gain_value: f64| {
        let mut w = Writer::default();
        w.bytes(&[1, 0, 1]); // available, unused, one offer
        w.u8(cost);
        w.f64(cost_value);
        w.u8(gain);
        w.f64(gain_value);
        w.str("");
        w.bytes(&[0, 0, 0]); // no stats, deadline, or merchants
        for _ in 0..3 {
            w.str("");
        }
        trade_state_raw(&w.finish())
    };
    let trade_delta_control = |stat: u8, value: f64| {
        let mut w = Writer::default();
        w.bytes(&[1, 0, 0, 1]); // available, unused, no offers, one stat
        w.u8(stat);
        w.f64(value);
        w.bytes(&[0, 0]); // no deadline or merchants
        for _ in 0..3 {
            w.str("");
        }
        trade_state_raw(&w.finish())
    };
    let trade_deadline_control = |deadline: f64| {
        let mut w = Writer::default();
        w.bytes(&[1, 0, 0, 0, 1]); // available, unused, empty offers/stats, deadline present
        w.f64(deadline);
        w.u8(0); // merchants
        for _ in 0..3 {
            w.str("");
        }
        trade_state_raw(&w.finish())
    };
    let trade_merchant_control = |kind: u8, x: f64, y: f64| {
        let mut w = Writer::default();
        w.bytes(&[1, 0, 0, 0, 0, 1, kind]); // available through one merchant
        w.f64(x);
        w.f64(y);
        w.str("");
        for _ in 0..3 {
            w.str("");
        }
        trade_state_raw(&w.finish())
    };
    let trade_invalid_utf8 = {
        let mut w = Writer::default();
        w.bytes(&[1, 0, 1, 0]); // available, unused, one offer, cost stat
        w.f64(1.0);
        w.u8(1); // gain stat
        w.f64(1.0);
        w.u8(1); // one-byte invalid UTF-8 label
        w.u8(0xff);
        trade_state_raw(&w.finish())
    };
    let good = ServerMsg::Snapshot {
        training: false,
        owner_combat: None,
        tick: 5,
        server_time: snapshot_server_ms(5),
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
            ..WireActor::default()
        }],
    }
    .encode();
    let mut trailing = good.clone();
    trailing.push(0);
    let bad_wish = |record: &[u8]| {
        let mut w = Writer::default();
        w.u8(T_SNAPSHOT);
        w.varint(1);
        w.varint(0);
        w.varint(HM_PRESENT | HM_WISH);
        w.varint(3);
        w.f32(0.);
        w.f32(0.);
        w.f32(0.);
        w.varint(1145);
        w.bytes(record);
        w.varint(0);
        w.finish()
    };
    let valid_wish = || {
        let mut w = Writer::default();
        w.u8(3);
        w.f64(100.);
        w.u8(1);
        w.f64(500.);
        w.u8(2);
        w.f64(4000.);
        w.u8(1);
        w.u8(1);
        w.f64(200.);
        w.u8(0);
        w.finish()
    };
    let fx_bad = |tag: u8, payload: &[u8]| {
        let mut w = Writer::default();
        w.u8(T_FX);
        w.varint(1);
        w.varint(1);
        w.u8(tag);
        w.bytes(payload);
        w.finish()
    };
    let owner_record = |lock: u8, target: Option<u32>, mirrors: [f64; 3]| {
        let mut w = Writer::default();
        w.u8(lock);
        if let Some(target) = target {
            w.varint(target);
        }
        w.u32(4_000);
        w.u32(20_000);
        for value in mirrors {
            w.f64(value);
        }
        w.finish()
    };
    let full_owner_frame = |record: &[u8], self_present: bool, actors: &[u8], count: u32| {
        let mut w = Writer::default();
        w.u8(T_SNAPSHOT);
        w.varint(10);
        w.varint(3);
        w.varint(HM_OWNER_COMBAT | if self_present { HM_PRESENT } else { 0 });
        if self_present {
            w.varint(3);
            w.f32(0.0);
            w.f32(0.0);
            w.f32(0.0);
            w.varint(1145);
        }
        w.varint(count);
        w.bytes(actors);
        w.bytes(record);
        w.finish()
    };
    #[allow(clippy::too_many_arguments)]
    let quest_row = |handle,
                     def: &str,
                     x: f64,
                     y: f64,
                     status,
                     expires: f64,
                     participants: &[(u32, u8, u32, u8)],
                     carrier,
                     done_flag,
                     done_by: Option<&str>,
                     flags,
                     owner_visited| {
        quest_row_raw(
            handle,
            def,
            x,
            y,
            status,
            expires,
            participants,
            carrier,
            done_flag,
            done_by,
            flags,
            0,
            owner_visited,
        )
    };
    let one_roster = &[(1, "owner")];
    let basic = quest_row(1, "collect", 0.0, 0.0, 1, 0.0, &[], 0, 0, None, 0, 0);
    let quest_bad_status = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            4,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_bad_flags = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0x10,
            0,
        )],
        &[],
    ));
    let quest_bad_visited = quest_state_raw(&quest_view_raw(
        0,
        0,
        1,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[(1, 1, 0, 0x20)],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_owner_visited = quest_state_raw(&quest_view_raw(
        0,
        0,
        1,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0x20,
        )],
        &[],
    ));
    let quest_missing_objective =
        quest_state_raw(&quest_view_raw(0, 0, 0, &[], &[], &[(1, 0.0, 0.0)]));
    let quest_row_handle_zero = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            0,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_roster_id_zero = quest_state_raw(&quest_view_raw(0, 0, 0, &[(0, "bad")], &[], &[]));
    let quest_objective_handle_zero = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        std::slice::from_ref(&basic),
        &[(0, 0.0, 0.0)],
    ));
    let quest_prop_handle_zero = quest_props_state_raw(0, 0, &[0]);
    let quest_availability_flag = quest_state_raw(&[2]);
    let quest_accepted_flag = quest_state_raw(&quest_view_raw(
        0,
        0,
        1,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[(1, 2, 0, 0)],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_done_flag = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            2,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_prop_fetch_flag = quest_props_state_raw(1, 2, &[0]);
    let quest_duplicate_row = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[basic.clone(), basic.clone()],
        &[],
    ));
    let quest_duplicate_roster =
        quest_state_raw(&quest_view_raw(0, 0, 0, &[(1, "a"), (1, "b")], &[], &[]));
    let quest_duplicate_participant = quest_state_raw(&quest_view_raw(
        0,
        0,
        1,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[(1, 1, 0, 0), (1, 0, 1, 0)],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_owner_missing = quest_state_raw(&quest_view_raw(0, 0, 2, one_roster, &[], &[]));
    let quest_carrier_missing = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            2,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_participant_missing = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        one_roster,
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            0.0,
            &[(2, 1, 0, 0)],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_unknown_count = quest_state_raw(&quest_view_raw(21, 0, 0, &[], &[], &[]));
    let quest_display_count = quest_state_raw(&quest_view_raw(0, 1, 0, &[], &[], &[]));
    let quest_def_empty = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(1, "", 0.0, 0.0, 1, 0.0, &[], 0, 0, None, 0, 0)],
        &[],
    ));
    let quest_def_long = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "12345678901234567",
            0.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_giver_nonfinite = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            f64::NAN,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_giver_out_of_range = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            8192.0,
            0.0,
            1,
            0.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_objective_nonfinite = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        std::slice::from_ref(&basic),
        &[(1, f64::INFINITY, 0.0)],
    ));
    let quest_objective_out_of_range = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        std::slice::from_ref(&basic),
        &[(1, 0.0, -0.001)],
    ));
    let quest_expiry_negative = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            -1.0,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let quest_expiry_nonfinite = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[quest_row(
            1,
            "collect",
            0.0,
            0.0,
            1,
            f64::INFINITY,
            &[],
            0,
            0,
            None,
            0,
            0,
        )],
        &[],
    ));
    let mut roster_over = Writer::default();
    roster_over.u8(1);
    roster_over.varint(0);
    roster_over.varint(0);
    roster_over.varint(0);
    roster_over.varint(9);
    let quest_roster_over = quest_state_raw(&roster_over.finish());
    let mut rows_over = Writer::default();
    rows_over.u8(1);
    rows_over.varint(0);
    rows_over.varint(0);
    rows_over.varint(0);
    rows_over.varint(0);
    rows_over.varint(21);
    let quest_rows_over = quest_state_raw(&rows_over.finish());
    let mut parts_over_row = Writer::default();
    parts_over_row.varint(1);
    parts_over_row.str("collect");
    parts_over_row.f64(0.0);
    parts_over_row.f64(0.0);
    parts_over_row.u8(1);
    parts_over_row.f64(0.0);
    parts_over_row.varint(9);
    let quest_parts_over = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        &[parts_over_row.finish()],
        &[],
    ));
    let mut objectives_over = Writer::default();
    objectives_over.u8(1);
    objectives_over.varint(0);
    objectives_over.varint(0);
    objectives_over.varint(0);
    objectives_over.varint(0);
    objectives_over.varint(0);
    objectives_over.varint(161);
    let quest_objectives_over = quest_state_raw(&objectives_over.finish());
    let many_objectives = (0..9).map(|_| (1, 0.0, 0.0)).collect::<Vec<_>>();
    let quest_objectives_per_row_over = quest_state_raw(&quest_view_raw(
        0,
        0,
        0,
        &[],
        std::slice::from_ref(&basic),
        &many_objectives,
    ));
    vec![
        (
            "owner_combat_bad_lock",
            full_owner_frame(&owner_record(3, None, [1000.0; 3]), true, &[], 0),
        ),
        (
            "owner_combat_zero_target",
            full_owner_frame(&owner_record(2, Some(0), [1000.0; 3]), true, &[], 0),
        ),
        (
            "owner_combat_missing_self",
            full_owner_frame(&owner_record(0, None, [1000.0; 3]), false, &[], 0),
        ),
        (
            "owner_combat_dangling_target",
            full_owner_frame(&owner_record(2, Some(9), [1000.0; 3]), true, &[], 0),
        ),
        (
            "owner_combat_nonfinite_mirror",
            full_owner_frame(
                &owner_record(0, None, [f64::NAN, 1000.0, 1000.0]),
                true,
                &[],
                0,
            ),
        ),
        (
            "owner_combat_fractional_mirror",
            full_owner_frame(
                &owner_record(0, None, [1000.5, 1000.0, 1000.0]),
                true,
                &[],
                0,
            ),
        ),
        (
            "owner_combat_below_min_mirror",
            full_owner_frame(&owner_record(0, None, [49.0, 1000.0, 1000.0]), true, &[], 0),
        ),
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
            vec![0x88, 0, 1, 7, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
        (
            "projectile_owner_zero",
            vec![0x88, 0, 1, 7, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
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
        // Protocol 16, ADR0026: the hit's flags byte (bit 0 passive, bit 1 critical) refuses any other bit.
        (
            "hit_flags_unknown_bit",
            vec![0x85, 0, 1, 2, 1, 2, 0, 0, 0, 0, 4],
        ),
        // Windup: by 1, weapon 16 (over the 4-bit code), angle, ms.
        (
            "fx_windup_weapon_over_15",
            vec![0x85, 0, 1, 9, 1, 16, 0, 0, 0, 0],
        ),
        ("fx_windup_truncated", vec![0x85, 0, 1, 9, 1, 2, 0, 0, 0]),
        // Signature hit: victim 1, by 2, kind, amount.
        (
            "fx_sig_hit_kind_zero",
            vec![0x85, 0, 1, 11, 1, 2, 0, 0, 0, 0, 0],
        ),
        (
            "fx_sig_hit_kind_6",
            vec![0x85, 0, 1, 11, 1, 2, 6, 0, 0, 0, 0],
        ),
        (
            "fx_sig_hit_kind_21",
            vec![0x85, 0, 1, 11, 1, 2, 21, 0, 0, 0, 0],
        ),
        ("fx_heal_truncated", vec![0x85, 0, 1, 12, 1, 0, 0, 0]),
        (
            "camp_cleared_truncated",
            vec![0x84, 0, 0, 0, 0, 1, 0, 11, 0],
        ),
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
        ("head_unknown_bit", snapshot_bytes(1 << 25, &[], 0, &[])),
        // Protocol 16, ADR0026: the self's indicator facts are checked like an actor's.
        (
            "self_flags_unknown_bit",
            snapshot_bytes(
                1 | HM_FLAGS,
                &[vec![1], vec![0; 12], vec![1], vec![0x10]].concat(),
                0,
                &[],
            ),
        ),
        (
            "self_build_marks_repeated",
            snapshot_bytes(
                1 | HM_BUILD_MARKS,
                &[vec![1], vec![0; 12], vec![1], vec![0x22]].concat(),
                0,
                &[],
            ),
        ),
        (
            "self_mark_tier_over_4",
            snapshot_bytes(
                1 | HM_MARK,
                &[vec![1], vec![0; 12], vec![1], vec![5, 0, 0]].concat(),
                0,
                &[],
            ),
        ),
        ("wish_ability_over_4", {
            let mut w = valid_wish();
            w[0] = 5;
            bad_wish(&w)
        }),
        ("wish_charge_count_invalid", {
            let mut w = valid_wish();
            w[18] = 0;
            bad_wish(&w)
        }),
        ("wish_time_nonfinite", {
            let mut w = valid_wish();
            w[1..9].copy_from_slice(&f64::NAN.to_le_bytes());
            bad_wish(&w)
        }),
        ("wish_option_over_1", {
            let mut w = valid_wish();
            w[9] = 2;
            bad_wish(&w)
        }),
        ("wish_cast_time_order", {
            let mut w = Writer::default();
            w.u8(3);
            w.f64(100.);
            w.u8(0);
            w.u8(2);
            w.f64(4000.);
            w.u8(1);
            w.u8(0);
            w.u8(1);
            w.u8(3);
            w.f64(300.);
            w.f64(200.);
            bad_wish(&w.finish())
        }),
        (
            "wish_fx_caster_zero",
            fx_bad(
                6,
                &[0; 8]
                    .into_iter()
                    .chain([0, 3])
                    .chain(0f64.to_le_bytes())
                    .chain([0, 0])
                    .collect::<Vec<_>>(),
            ),
        ),
        ("wish_fx_ability_over_4", {
            let mut p = Vec::new();
            p.extend(0f64.to_le_bytes());
            p.push(1);
            p.push(5);
            p.extend(0f64.to_le_bytes());
            p.push(0);
            p.push(0);
            fx_bad(6, &p)
        }),
        ("wish_fx_time_nonfinite", {
            let mut p = Vec::new();
            p.extend(f64::NAN.to_le_bytes());
            p.push(1);
            p.push(3);
            p.extend(0f64.to_le_bytes());
            p.push(0);
            p.push(0);
            fx_bad(6, &p)
        }),
        ("wish_fx_option_over_1", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.push(3);
            p.push(2);
            fx_bad(7, &p)
        }),
        ("wish_fx_blaze_one_point", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.extend([3, 1, 7, 0, 1, 1, 0, 1, 0, 0]);
            fx_bad(7, &p)
        }),
        ("wish_fx_nonblaze_destination", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.push(1);
            p.push(1);
            p.push(7);
            p.push(0);
            p.push(0);
            p.push(1);
            p.extend([1, 0, 1, 0]);
            fx_bad(7, &p)
        }),
        ("wish_fx_anonymous_landed_target", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.push(3);
            p.push(0);
            p.push(1);
            p.push(7);
            p.push(0);
            p.push(0);
            fx_bad(7, &p)
        }),
        ("wish_fx_anonymous_landed_no_target", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.push(3);
            p.push(0);
            p.push(0);
            p.push(0);
            p.push(0);
            fx_bad(7, &p)
        }),
        ("wish_fx_end_reason_over_2", {
            let mut p = Vec::new();
            p.extend(1f64.to_le_bytes());
            p.push(1);
            p.push(3);
            p.push(3);
            fx_bad(8, &p)
        }),
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
            snapshot_bytes(0, &[], 1, &actor_bytes(1 << 15, &[])),
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
        (
            "snapshot_giver_kit_default",
            snapshot_bytes(0, &[], 1, &actor_giver_tuple_bytes(0, 0, 4, None)),
        ),
        (
            "snapshot_giver_kit_half",
            snapshot_bytes(0, &[], 1, &actor_giver_tuple_bytes(15, 0, 4, None)),
        ),
        (
            "snapshot_giver_kit_half_weapon",
            snapshot_bytes(0, &[], 1, &actor_giver_tuple_bytes(0, 15, 4, None)),
        ),
        (
            "snapshot_giver_mob_type",
            snapshot_bytes(0, &[], 1, &actor_giver_tuple_bytes(15, 15, 4, Some(1))),
        ),
        // The actor mask 0x80 0x00 is a two-byte zero.
        (
            "actor_mask_overlong_varint",
            snapshot_bytes(0, &[], 1, &[1, 0x80, 0x00, 0, 0, 0, 0, 0, 0]),
        ),
        // Kind and status/displacement bits are known; bit 9 is not.
        (
            "actor_unknown_mask_bit_after_kind",
            snapshot_bytes(0, &[], 1, &actor_bytes(1 << 16, &[])),
        ),
        // Protocol 16, ADR0026: actor indicator facts out of range.
        (
            "actor_flags_unknown_bit",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_FLAGS, &[0x10])),
        ),
        (
            "actor_offhand_over_16",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_OFFHAND, &[17])),
        ),
        (
            "actor_build_marks_key_over_9",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_BUILD_MARKS, &[10])),
        ),
        (
            "actor_build_marks_second_without_first",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_BUILD_MARKS, &[0x30])),
        ),
        (
            "actor_build_marks_repeated",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_BUILD_MARKS, &[0x33])),
        ),
        (
            "actor_mark_tier_over_4",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_MARK, &[5, 0, 0])),
        ),
        (
            "actor_mark_brand_over_100",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_MARK, &[1, 101, 0])),
        ),
        (
            "actor_mark_tax_over_100",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_MARK, &[1, 25, 101])),
        ),
        (
            "actor_mark_truncated",
            snapshot_bytes(0, &[], 1, &actor_bytes(AM_MARK, &[1, 25])),
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
        ("fx_bad_tag", vec![0x85, 0, 1, 13]),
        // State: key zero is undefined; truncated and trailing bytes remain invalid.
        ("chest_bad_reason_zero", vec![0x84, 0, 0, 0, 0, 1, 0, 6, 0]),
        (
            "chest_bad_reason_unknown",
            vec![0x84, 0, 0, 0, 0, 1, 0, 6, 10],
        ),
        ("state_reward_card_id_80", bad_card_id),
        ("state_reward_kind_unknown", reward_frame(1, &[4])),
        (
            "state_reward_kill_key_unknown",
            reward_frame(1, &[3, 9, 0, 0, 0, 0, 0, 0, 224, 63]),
        ),
        (
            "state_reward_kill_gain_zero",
            reward_frame(1, &[3, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ),
        (
            "state_reward_kill_gain_negative",
            reward_frame(1, &[3, 0, 0, 0, 0, 0, 0, 0, 240, 191]),
        ),
        (
            "state_reward_kill_gain_nan",
            reward_frame(1, &[3, 0, 0, 0, 0, 0, 0, 0, 248, 127]),
        ),
        (
            "state_reward_kill_gain_infinity",
            reward_frame(1, &[3, 0, 0, 0, 0, 0, 0, 0, 240, 127]),
        ),
        ("state_reward_kill_truncated_key", reward_frame(1, &[3])),
        ("state_reward_kill_truncated_gain", reward_frame(1, &[3, 0])),
        ("state_reward_options_too_many", reward_frame(4, &[])),
        ("state_plan_negative_deadline", negative_plan),
        ("state_unknown_key", vec![0x88, 0, 1, 14]),
        ("state_quest_status_unknown", quest_bad_status),
        ("state_quest_flags_unknown", quest_bad_flags),
        ("state_quest_visited_unknown", quest_bad_visited),
        ("state_quest_owner_visited_unknown", quest_owner_visited),
        ("state_quest_ref_missing", quest_missing_objective),
        (
            "state_quest_prop_missing_view",
            quest_props_state_raw(1, 0, &[0]),
        ),
        ("state_quest_row_handle_zero", quest_row_handle_zero),
        ("state_quest_roster_id_zero", quest_roster_id_zero),
        (
            "state_quest_objective_handle_zero",
            quest_objective_handle_zero,
        ),
        ("state_quest_prop_handle_zero", quest_prop_handle_zero),
        ("state_quest_availability_flag", quest_availability_flag),
        ("state_quest_participant_accepted_flag", quest_accepted_flag),
        ("state_quest_done_by_flag", quest_done_flag),
        ("state_quest_prop_fetch_flag", quest_prop_fetch_flag),
        ("state_quest_duplicate_row_handle", quest_duplicate_row),
        ("state_quest_duplicate_roster_id", quest_duplicate_roster),
        (
            "state_quest_duplicate_participant_id",
            quest_duplicate_participant,
        ),
        ("state_quest_owner_roster_missing", quest_owner_missing),
        ("state_quest_carrier_missing", quest_carrier_missing),
        ("state_quest_participant_missing", quest_participant_missing),
        ("state_quest_unknown_count", quest_unknown_count),
        (
            "state_quest_display_count_over_unknown",
            quest_display_count,
        ),
        ("state_quest_def_empty", quest_def_empty),
        ("state_quest_def_over_16", quest_def_long),
        ("state_quest_giver_nonfinite", quest_giver_nonfinite),
        ("state_quest_giver_out_of_range", quest_giver_out_of_range),
        ("state_quest_objective_nonfinite", quest_objective_nonfinite),
        (
            "state_quest_objective_out_of_range",
            quest_objective_out_of_range,
        ),
        ("state_quest_expiry_negative", quest_expiry_negative),
        ("state_quest_expiry_nonfinite", quest_expiry_nonfinite),
        ("state_quest_roster_over_limit", quest_roster_over),
        ("state_quest_rows_over_limit", quest_rows_over),
        ("state_quests_over_24576", quest_over_24576),
        ("state_quest_participants_over_limit", quest_parts_over),
        ("state_quest_objectives_over_limit", quest_objectives_over),
        (
            "state_quest_objectives_per_row_over_limit",
            quest_objectives_per_row_over,
        ),
        ("state_trade_availability_flag", trade_state_raw(&[2])),
        ("state_trade_used_flag", trade_state_raw(&[1, 2])),
        (
            "state_trade_deadline_option_unknown",
            trade_state_raw(&[1, 0, 0, 0, 2]),
        ),
        (
            "state_trade_kind_unknown",
            trade_merchant_control(2, 0.0, 0.0),
        ),
        ("state_trade_stat_unknown", trade_delta_control(7, 1.0)),
        (
            "state_trade_offer_same_stat",
            trade_offer_control(0, 1.0, 0, 1.0),
        ),
        (
            "state_trade_offer_nonpositive",
            trade_offer_control(0, 0.0, 1, 1.0),
        ),
        (
            "state_trade_offer_nonfinite",
            trade_offer_control(0, 1.0, 1, f64::NAN),
        ),
        ("state_trade_label_bad_utf8", trade_invalid_utf8),
        (
            "state_trade_delta_nonfinite",
            trade_delta_control(1, f64::INFINITY),
        ),
        (
            "state_trade_deadline_negative",
            trade_deadline_control(-1.0),
        ),
        (
            "state_trade_deadline_nonfinite",
            trade_deadline_control(f64::NAN),
        ),
        (
            "state_trade_merchant_nonfinite",
            trade_merchant_control(0, f64::INFINITY, 0.0),
        ),
        (
            "state_trade_merchant_out_of_range",
            trade_merchant_control(0, 8192.0, 0.0),
        ),
        ("state_trade_offers_over_limit", trade_state_raw(&[1, 0, 4])),
        (
            "state_trade_stats_over_limit",
            trade_state_raw(&[1, 0, 0, 8]),
        ),
        (
            "state_trade_merchants_over_limit",
            trade_state_raw(&[1, 0, 0, 0, 0, 3]),
        ),
        ("state_duplicate_key", vec![0x88, 0, 2, 1, 0, 1, 0]),
        ("state_key_order", vec![0x88, 0, 2, 3, 0, 1, 0]),
        ("state_too_many_keys", vec![0x88, 0, 14]),
        // Protocol 16, ADR0026: State key 12, the roster.
        ("state_roster_count_over_32", vec![0x88, 0, 1, 12, 33]),
        (
            "state_roster_id_zero",
            vec![0x88, 0, 1, 12, 1, 0, 0, 1, b'a'],
        ),
        (
            "state_roster_order",
            vec![0x88, 0, 1, 12, 2, 5, 0, 1, b'a', 5, 0, 1, b'b'],
        ),
        (
            "state_roster_flags_unknown",
            vec![0x88, 0, 1, 12, 1, 1, 2, 1, b'a'],
        ),
        ("state_roster_name_empty", vec![0x88, 0, 1, 12, 1, 1, 0, 0]),
        ("state_roster_name_long", {
            let mut v = vec![0x88, 0, 1, 12, 1, 1, 0, 25];
            v.extend_from_slice(&[b'a'; 25]);
            v
        }),
        (
            "state_roster_name_control",
            vec![0x88, 0, 1, 12, 1, 1, 0, 2, b'a', 0x07],
        ),
        (
            "state_roster_name_utf8",
            vec![0x88, 0, 1, 12, 1, 1, 0, 1, 0xff],
        ),
        (
            "state_roster_truncated",
            vec![0x88, 0, 1, 12, 1, 1, 0, 3, b'a'],
        ),
        ("state_too_many_props", vec![0x88, 0, 1, 2, 0x81, 4]),
        ("state_too_many_fields", vec![0x88, 0, 1, 3, 0x81, 4]),
        ("state_too_many_rewards", vec![0x88, 0, 1, 4, 0x81, 4]),
        (
            "state_bad_potion_count",
            vec![0x88, 0, 1, 1, 1, 0, 0, 0, 6, 0, 0],
        ),
        // P-WIRE17-HUD-3: key 1's clocks (finite, non-negative, whole) and key 9's minimum players (at most 32, present).
        (
            "state_inventory_healing_nan",
            [
                &[0x88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1][..],
                &f64::NAN.to_le_bytes(),
                &[0],
            ]
            .concat(),
        ),
        (
            "state_inventory_healing_negative",
            [
                &[0x88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1][..],
                &(-50f64).to_le_bytes(),
                &[0],
            ]
            .concat(),
        ),
        (
            "state_inventory_boost_infinite",
            [
                &[0x88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1][..],
                &f64::INFINITY.to_le_bytes(),
            ]
            .concat(),
        ),
        (
            "state_inventory_clock_truncated",
            [
                &[0x88, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1][..],
                &1f64.to_le_bytes()[..4],
            ]
            .concat(),
        ),
        (
            "state_arena_min_players_over",
            [&[0x88, 0, 1, 9, 1][..], &[0; 36], &[33]].concat(),
        ),
        (
            "state_arena_min_players_missing",
            [&[0x88, 0, 1, 9, 1][..], &[0; 36]].concat(),
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
        (
            "welcome_archetype_order",
            welcome_archetypes(&[(1, 0), (1, 0)]),
        ),
        ("welcome_archetype_hull", welcome_archetypes(&[(0, 2)])),
        ("welcome_archetype_zero_box", welcome_archetypes(&[(0, 3)])),
        // Review finding 6: more than 32 rows, an over-long key, a non-ASCII key, a table cut short.
        (
            "welcome_archetype_count",
            welcome_archetypes(&(0..33).map(|id| (id, 0)).collect::<Vec<_>>()),
        ),
        (
            "welcome_archetype_key_long",
            welcome_archetype_key(&"k".repeat(crate::archetype::MAX_ARCHETYPE_KEY + 1)),
        ),
        (
            "welcome_archetype_key_ascii",
            welcome_archetype_key("h\u{e9}ro"),
        ),
        ("welcome_archetype_truncated", {
            // Two rows promised, the second cut off after its id: the frame ends inside the table.
            let good = welcome_map(1, 1, None, &[(1, 1)]);
            let mut table = Writer::default();
            table.u8(2);
            table.u8(0);
            table.str("k");
            table.u8(0);
            table.u8(12);
            table.u8(0);
            table.u8(1);
            let mut out = good[..WELCOME_HEADER_LEN].to_vec();
            out.extend(table.finish());
            out
        }),
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
        (
            "map_ext_short",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                75,
                &10u32.to_le_bytes(),
            ),
        ),
        (
            "map_ext_version",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                79,
                &[1],
            ),
        ),
        (
            "map_ext_presence",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                80,
                &[0x80],
            ),
        ),
        ("map_ext_run_zero", {
            let mut frame = ground_welcome_bytes(Some(vec![0]), None, crate::GroundMode::Off);
            // Offsets include the one-byte empty archetype table (protocol 16 and later); the vision block and the empty weapon
            // table after it move the map further.
            let v = PRE_MAP_LEN - 1;
            frame[86 + v..90 + v].copy_from_slice(&0u32.to_le_bytes());
            frame.drain(90 + v..93 + v);
            frame[76 + v..80 + v].copy_from_slice(&15u32.to_le_bytes());
            frame
        }),
        (
            "map_ext_terrain_value",
            mutate_ground_welcome(
                ground_welcome_bytes(Some(vec![0]), None, crate::GroundMode::Off),
                89,
                &[8],
            ),
        ),
        (
            "map_ext_region_value",
            mutate_ground_welcome(
                ground_welcome_bytes(Some(vec![0]), Some(vec![0]), crate::GroundMode::Off),
                96,
                &[7],
            ),
        ),
        (
            "map_ext_plane_length",
            mutate_ground_welcome(
                ground_welcome_bytes(Some(vec![0]), None, crate::GroundMode::Off),
                90,
                &2u16.to_le_bytes(),
            ),
        ),
        (
            "map_ext_terrain_collision",
            mutate_ground_welcome(
                ground_welcome_bytes(Some(vec![0]), None, crate::GroundMode::Off),
                89,
                &[1],
            ),
        ),
        (
            "map_ext_semantic_hash",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                81,
                &[0, 0, 0, 0],
            ),
        ),
        (
            "map_ext_mode",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                85,
                &[3],
            ),
        ),
        (
            "map_ext_context_hash",
            mutate_ground_welcome(
                ground_welcome_bytes(None, None, crate::GroundMode::Off),
                86,
                &[0, 0, 0, 0],
            ),
        ),
        ("map_ext_trailing", {
            let mut frame = ground_welcome_bytes(None, None, crate::GroundMode::Off);
            frame.push(0);
            let v = PRE_MAP_LEN - 1;
            frame[76 + v..80 + v].copy_from_slice(&12u32.to_le_bytes());
            frame
        }),
        ("welcome_trailing", {
            let mut frame = ground_welcome_bytes(None, None, crate::GroundMode::Off);
            frame.push(0);
            frame
        }),
    ]
    .into_iter()
    .chain(malformed_vision())
    .chain(malformed_weapons())
    .chain(malformed_hud_content())
    .chain(malformed_deltas())
    .chain(malformed_hud())
    .collect()
}

/// P-WIRE17-HUD-2: shared negative vectors for the HUD fields (camp reward and ward, State key 6; the build summary and
/// its champion panel, key 13), refused identically by the Rust, C# and JS decoders.
fn malformed_hud() -> Vec<(&'static str, Vec<u8>)> {
    // T_STATE, tick 5, one item, key 6, one camp: mob 3, elite 29 (present: 30), alive 2, state 0, cleared_at 1000,
    // respawn_at 181000; the HUD tail (reward, ward) follows.
    let camp = |tail: &[u8]| {
        let mut b = vec![0x88, 5, 1, 6, 1, 3, 30, 2, 0];
        b.extend_from_slice(&1000f64.to_le_bytes());
        b.extend_from_slice(&181000f64.to_le_bytes());
        b.extend_from_slice(tail);
        b
    };
    // T_STATE, tick 5, one item, key 13, present, nine zero gains; the mob rows and the panel follow.
    let summary = |tail: &[u8]| {
        let mut b = vec![0x88, 5, 1, 13, 1];
        b.extend_from_slice(&[0; 36]);
        b.extend_from_slice(tail);
        b
    };
    let row = |lead: &[u8], value: i32| {
        let mut b = lead.to_vec();
        b.extend_from_slice(&value.to_le_bytes());
        b
    };
    let mut gains_short = vec![0x88, 5, 1, 13, 1];
    gains_short.extend_from_slice(&[0; 32]);
    let mut mob_stat_9 = vec![1];
    mob_stat_9.extend(row(&[0, 9, 1], 1));
    mob_stat_9.push(0);
    // The first unknown code (PANEL_CODE_COUNT): bound-neutral name, the bytes follow the bound.
    let mut code_unknown = vec![0, 1];
    code_unknown.extend(row(&[crate::state::PANEL_CODE_COUNT], 1));
    let mut order = vec![0, 2];
    order.extend(row(&[3], 1));
    order.extend(row(&[3], 1));
    // MAX_PANEL_VALUES + 1 rows, codes 0..=28.
    let mut over = vec![0, crate::state::MAX_PANEL_VALUES as u8 + 1];
    for code in 0..=crate::state::PANEL_CODE_COUNT {
        over.extend(row(&[code], 1));
    }
    vec![
        ("state_camp_reward_stat_10", camp(&[10, 0x10, 0x27, 0])),
        ("state_camp_ward_verdict_3", camp(&[0, 3])),
        ("state_camp_ward_missing_expiry", camp(&[0, 1])),
        ("state_build_summary_gains_short", gains_short),
        ("state_build_summary_mob_stat_9", summary(&mob_stat_9)),
        (
            "state_build_summary_panel_code_unknown",
            summary(&code_unknown),
        ),
        ("state_build_summary_panel_order", summary(&order)),
        ("state_build_summary_panel_count_over", summary(&over)),
    ]
}

/// What one frame of a chain does to a client's [`SnapshotTracker`].
#[allow(clippy::large_enum_variant)] // Golden chains retain the decoded message for exact assertions.
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
        barrier_pct: 0,
        barrier_ring_step: 0,
        archetype: (id % 13) as u8,
        ..WireActor::default()
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
        wish: None,
        barrier: 0.0,
        barrier_ring_step: 0,
        archetype: 3,
        ..WireSelf::default()
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
        owner_combat: None,
        tick: 11,
        server_time: snapshot_server_ms(11),
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
    // Protocol 16 (review finding 6): the self's archetype arrives in a delta (delta head bit 25), as it does when a
    // faction is chosen after the lobby Welcome; an unchanged archetype is not resent, a later change is.
    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let mut prior: Option<SnapshotData> = None;
        for (tick, archetype, sent) in [(1, 0, false), (2, 3, true), (3, 3, false), (4, 12, true)] {
            let mut me = chain_self(400.0 + tick as f32);
            me.archetype = archetype;
            let data = snap(tick, 1, tick, Some(me), &[wa(1, 10., 20., 100, 1)]);
            let (frame, kind) = encoder.encode_frame(data.clone());
            if let Some(base) = prior.as_ref() {
                assert_eq!(kind, FrameKind::Delta);
                let d = delta::diff(base, &data).unwrap();
                let mask = d.me.as_ref().expect("a self delta").mask;
                assert_eq!(mask & delta::DH_ARCHETYPE != 0, sent, "tick {tick}");
                assert_eq!(ServerMsg::SnapshotDelta(d).encode(), frame);
            } else {
                assert_eq!(kind, FrameKind::Full);
            }
            let got = tracker.decode(&frame).expect("the self archetype applies");
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
            prior = Some(data);
        }
        chains.push(("self_archetype_delta", steps));
    }
    // Protocol 16, ADR0026: indicator facts arrive with a new actor, change in deltas (delta actor bits 14..=17, self head
    // bits 26..=28) and are not resent while unchanged; a cleared fact returns to its default.
    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let mut prior: Option<SnapshotData> = None;
        // (tick, actor flags, off-hand, build marks, mark, self flags, self marks)
        #[allow(clippy::type_complexity)]
        let script: [(u32, u8, u8, u8, [u8; 3], u8, u8); 7] = [
            (
                1,
                ACTOR_FLAG_WISH_READY,
                2,
                0x31,
                [0; 3],
                ACTOR_FLAG_WISH_READY,
                0x21,
            ),
            (
                2,
                ACTOR_FLAG_WISH_READY,
                2,
                0x31,
                [0; 3],
                ACTOR_FLAG_WISH_READY,
                0x21,
            ),
            (3, 0, 0, 0x31, [1, 25, 10], 0, 0x21),
            (
                4,
                ACTOR_FLAG_ROAM_READY,
                5,
                0x13,
                [1, 25, 10],
                ACTOR_FLAG_TELEPORT_IMMUNE,
                0x08,
            ),
            (5, 0, 0, 0, [0; 3], 0, 0),
            // Tick 6: actor 2 departs. Tick 7: it returns inside a delta as a NEW actor with every fact set (delta actor
            // bits 14..=17 on the new-actor path).
            (6, 0, 0, 0, [0; 3], 0, 0),
            (
                7,
                ACTOR_FLAGS_KNOWN,
                MAX_OFFHAND_CODE,
                0x98,
                [MAX_MARK_TIER, 100, 100],
                ACTOR_FLAG_WISH_READY,
                0x12,
            ),
        ];
        for (tick, flags, offhand, marks, mark, self_flags, self_marks) in script {
            let mut me = chain_self(400.0);
            me.flags = self_flags;
            me.build_marks = self_marks;
            me.mark_tier = mark[0];
            me.brand = mark[1];
            me.mark_tax = mark[2];
            let mut a = wa(2, 10., 20., 100, 1);
            a.flags = flags;
            a.offhand = offhand;
            a.build_marks = marks;
            [a.mark_tier, a.brand, a.mark_tax] = mark;
            let mob = WireActor {
                kind: 1,
                mob_type_code: 7,
                flags: if tick % 2 == 0 { ACTOR_FLAG_ENGAGED } else { 0 },
                ..wa(9, 50., 60., 100, 1)
            };
            let data = if tick == 6 {
                snap(tick, 1, tick, Some(me), &[mob])
            } else {
                snap(tick, 1, tick, Some(me), &[a, mob])
            };
            let (frame, kind) = encoder.encode_frame(data.clone());
            if let Some(base) = prior.as_ref() {
                assert_eq!(kind, FrameKind::Delta);
                let d = delta::diff(base, &data).unwrap();
                if tick == 2 {
                    assert!(
                        d.changed.iter().all(|c| c.q.id != 2),
                        "unchanged facts are not resent"
                    );
                }
                assert_eq!(ServerMsg::SnapshotDelta(d).encode(), frame);
            } else {
                assert_eq!(kind, FrameKind::Full);
            }
            let got = tracker.decode(&frame).expect("indicator facts apply");
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
            prior = Some(data);
        }
        chains.push(("indicator_facts_delta", steps));
    }
    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let mut prior = None;
        let mut owner = chain_self(400.0);
        let records = [
            (1, None, 0.0, 0, vec![wa(1, 10., 20., 100, 1)]),
            (
                2,
                Some(WireWishOwner {
                    ability: 3,
                    ready_at: 1000.,
                    full_at: Some(5000.),
                    max_charges: 2,
                    recharge_ms: 4000.,
                    charges: 1,
                    next_charge_at: Some(3000.),
                    cast: Some(WireWishCast {
                        ability: 3,
                        started_at: 1500.,
                        lands_at: 1800.,
                    }),
                }),
                42.5,
                3,
                vec![WireActor {
                    barrier_pct: 80,
                    barrier_ring_step: 3,
                    ..wa(1, 10., 20., 100, 1)
                }],
            ),
        ];
        for (tick, wish, barrier, ring, actors) in records {
            owner.wish = wish;
            owner.barrier = barrier;
            owner.barrier_ring_step = ring;
            let data = snap(tick, 1, tick, Some(owner), &actors);
            let (frame, kind) = encoder.encode_frame(data.clone());
            assert_eq!(
                kind,
                if tick == 1 {
                    FrameKind::Full
                } else {
                    FrameKind::Delta
                }
            );
            if let Some(base) = prior.as_ref() {
                assert_eq!(
                    frame,
                    ServerMsg::SnapshotDelta(delta::diff(base, &data).unwrap()).encode()
                );
            }
            let got = tracker
                .decode(&frame)
                .expect("Wish/barrier lifecycle applies");
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
            prior = Some(data);
        }
        encoder.request_full();
        owner.wish = None;
        owner.barrier = 0.0;
        owner.barrier_ring_step = 0;
        let defaults = snap(3, 1, 3, Some(owner), &[wa(1, 10., 20., 100, 1)]);
        let (frame, kind) = encoder.encode_frame(defaults.clone());
        assert_eq!(kind, FrameKind::Full);
        let got = tracker.decode(&frame).expect("resync Full applies");
        assert_eq!(got, defaults.decoded());
        steps.push(ChainStep {
            frame,
            outcome: ChainOutcome::Applied(got),
        });
        prior = Some(defaults.clone());
        let records = [
            (
                4,
                Some(WireWishOwner {
                    ability: 3,
                    ready_at: 1300.,
                    full_at: Some(5300.),
                    max_charges: 2,
                    recharge_ms: 4000.,
                    charges: 1,
                    next_charge_at: Some(3300.),
                    cast: None,
                }),
                21.5,
                2,
                vec![WireActor {
                    barrier_pct: 65,
                    barrier_ring_step: 2,
                    ..wa(1, 10., 20., 100, 1)
                }],
            ),
            (5, None, 0.0, 0, vec![wa(1, 10., 20., 100, 1)]),
            (
                6,
                None,
                0.0,
                0,
                vec![wa(1, 10., 20., 100, 1), wa(4, 30., 40., 100, 1)],
            ),
        ];
        for (tick, wish, barrier, ring, actors) in records {
            owner.wish = wish;
            owner.barrier = barrier;
            owner.barrier_ring_step = ring;
            let data = snap(tick, 1, tick, Some(owner), &actors);
            let (frame, kind) = encoder.encode_frame(data.clone());
            assert_eq!(kind, FrameKind::Delta);
            let base = prior.as_ref().unwrap_or(&defaults);
            assert_eq!(
                frame,
                ServerMsg::SnapshotDelta(delta::diff(base, &data).unwrap()).encode()
            );
            let got = tracker.decode(&frame).expect("Wish/barrier clear applies");
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
            prior = Some(data);
        }
        chains.push(("wish_barrier_lifecycle", steps));
    }
    {
        let mut encoder = ConnEncoder::new();
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        for (tick, time) in [(20, 888.75), (21, snapshot_server_ms(21))] {
            let data = SnapshotData::build_with_server_time(
                tick,
                time,
                1,
                tick,
                Some(chain_self(400.)),
                [wa(1, 10., 20., 100, 1)].into_iter(),
            )
            .unwrap();
            let (frame, kind) = encoder.encode_frame(data.clone());
            assert_eq!(
                kind,
                if tick == 20 {
                    FrameKind::Full
                } else {
                    FrameKind::Delta
                }
            );
            let got = tracker
                .decode(&frame)
                .expect("per-frame source time applies");
            assert_eq!(got, data.decoded());
            steps.push(ChainStep {
                frame,
                outcome: ChainOutcome::Applied(got),
            });
        }
        chains.push(("wish_source_time_per_frame", steps));
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
        let before = t.snapshot();
        let e = t.decode(&f).expect_err("refused");
        match e {
            TrackError::Delta(d) => assert_eq!(d.code(), code),
            other => panic!("not a delta refusal: {other:?}"),
        }
        assert_eq!(t.snapshot(), before, "a refused delta is atomic");
        ChainStep {
            frame: f,
            outcome: ChainOutcome::Refused(code),
        }
    };
    let refusal = |name: &'static str, d: SnapshotDelta, code: &'static str| {
        let mut t = SnapshotTracker::new();
        let base = applied(&mut t, full_frame(&refusal_base()));
        let bad = refused(&mut t, delta_message(d), code);
        // The refusal changed nothing: the empty delta of the real base still applies and equals the base at tick 11.
        let ok = applied(&mut t, delta_message(empty_delta()));
        (name, vec![base, bad, ok])
    };
    let giver = |id, x| WireActor {
        faction: 15,
        weapon: 15,
        kind: 4,
        mob_type_code: 0,
        effects: 0x0123,
        displace_seq: 7,
        sig: 9,
        bounty: 31,
        barrier_pct: 12,
        barrier_ring_step: 2,
        ..wa(id, x, 25.0, 73, 1)
    };
    let actor_delta = |tick, base_tick, changed| SnapshotDelta {
        training: false,
        owner_combat: None,
        tick,
        server_time: snapshot_server_ms(tick),
        base_tick,
        phase: None,
        ack_input: 0,
        me: None,
        changed,
        departed: Vec::new(),
    };

    // A Full QG actor can be updated by fields unrelated to its tuple, then replaced by Full. Welcome resets the base.
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let base = snap(10, 1, 0, None, &[giver(5, 10.0)]);
        steps.push(applied(&mut tracker, full_frame(&base)));
        let retained = actor_delta(
            11,
            10,
            vec![ActorDelta {
                mask: AD_X,
                q: QActor {
                    id: 5,
                    x: 88,
                    ..QActor::default()
                },
            }],
        );
        steps.push(applied(&mut tracker, delta_message(retained)));
        let replaced = snap(
            12,
            1,
            0,
            None,
            &[WireActor {
                effects: 0x0042,
                ..giver(5, 42.0)
            }],
        );
        steps.push(applied(&mut tracker, full_frame(&replaced)));
        let welcome = server_samples()
            .into_iter()
            .find(|(name, _)| *name == "welcome")
            .expect("welcome sample")
            .1
            .encode();
        tracker.decode(&welcome).expect("Welcome resets snapshot");
        steps.push(ChainStep {
            frame: welcome,
            outcome: ChainOutcome::Reset,
        });
        let after_reset = actor_delta(13, 12, Vec::new());
        steps.push(refused(&mut tracker, delta_message(after_reset), "no_base"));
        let renewed = snap(14, 1, 0, None, &[giver(5, 50.0)]);
        steps.push(applied(&mut tracker, full_frame(&renewed)));
        chains.push(("quest_giver_retained_delta_reset", steps));
    }

    // Actor identity fields can change independently when the retained tuple is already valid.
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let unknown = WireActor {
            faction: 15,
            weapon: 15,
            kind: 255,
            mob_type_code: 0,
            ..wa(5, 20.0, 30.0, 61, 1)
        };
        let base = snap(20, 1, 0, None, &[unknown]);
        steps.push(applied(&mut tracker, full_frame(&base)));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(
                21,
                20,
                vec![ActorDelta {
                    mask: AD_KIND,
                    q: QActor {
                        id: 5,
                        kind: 4,
                        ..QActor::default()
                    },
                }],
            )),
        ));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(
                22,
                21,
                vec![ActorDelta {
                    mask: AD_KIND,
                    q: QActor {
                        id: 5,
                        kind: 255,
                        ..QActor::default()
                    },
                }],
            )),
        ));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(
                23,
                22,
                vec![ActorDelta {
                    mask: AD_KIT,
                    q: QActor {
                        id: 5,
                        kit: 0xff,
                        ..QActor::default()
                    },
                }],
            )),
        ));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(
                24,
                23,
                vec![ActorDelta {
                    mask: AD_KIND,
                    q: QActor {
                        id: 5,
                        kind: 255,
                        ..QActor::default()
                    },
                }],
            )),
        ));
        chains.push(("quest_giver_identity_edges", steps));
    }

    // Outside kind 4, every existing kind continues to accept every four-bit kit pairing.
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let base = snap(30, 1, 0, None, &[wa(5, 20.0, 30.0, 61, 1)]);
        steps.push(applied(&mut tracker, full_frame(&base)));
        let kit_only = actor_delta(
            31,
            30,
            vec![ActorDelta {
                mask: AD_KIT,
                q: QActor {
                    id: 5,
                    kit: 0xff,
                    ..QActor::default()
                },
            }],
        );
        steps.push(applied(&mut tracker, delta_message(kit_only)));
        assert_eq!(
            (
                tracker.actors()[0].kind,
                tracker.actors()[0].faction,
                tracker.actors()[0].weapon
            ),
            (0, 15, 15)
        );
        chains.push(("quest_giver_non4_kit_sentinel", steps));
    }

    // A kind-only transition to QG cannot manufacture a missing kit sentinel.
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        steps.push(applied(
            &mut tracker,
            full_frame(&snap(
                10,
                1,
                0,
                None,
                &[WireActor {
                    kind: 3,
                    ..wa(5, 20.0, 30.0, 61, 1)
                }],
            )),
        ));
        let bad = actor_delta(
            11,
            10,
            vec![ActorDelta {
                mask: AD_KIND,
                q: QActor {
                    id: 5,
                    kind: 4,
                    ..QActor::default()
                },
            }],
        );
        steps.push(refused(&mut tracker, delta_message(bad), "giver_actor"));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(11, 10, Vec::new())),
        ));
        chains.push(("quest_giver_kind_transition_missing_kit", steps));
    }
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        steps.push(applied(
            &mut tracker,
            full_frame(&snap(10, 1, 0, None, &[giver(5, 20.0)])),
        ));
        let bad = actor_delta(
            11,
            10,
            vec![ActorDelta {
                mask: AD_KIT,
                q: QActor {
                    id: 5,
                    kit: 0x0f,
                    ..QActor::default()
                },
            }],
        );
        steps.push(refused(&mut tracker, delta_message(bad), "giver_actor"));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(11, 10, Vec::new())),
        ));
        chains.push(("quest_giver_kit_transition_missing_kind", steps));
    }
    {
        let mut tracker = SnapshotTracker::new();
        let mut steps = Vec::new();
        let base = WireActor {
            kind: 3,
            mob_type_code: 1,
            ..wa(5, 20.0, 30.0, 61, 1)
        };
        steps.push(applied(
            &mut tracker,
            full_frame(&snap(10, 1, 0, None, &[base])),
        ));
        let bad = actor_delta(
            11,
            10,
            vec![ActorDelta {
                mask: AD_KIND | AD_KIT,
                q: QActor {
                    id: 5,
                    kind: 4,
                    kit: 0xff,
                    ..QActor::default()
                },
            }],
        );
        steps.push(refused(&mut tracker, delta_message(bad), "giver_actor"));
        steps.push(applied(
            &mut tracker,
            delta_message(actor_delta(11, 10, Vec::new())),
        ));
        chains.push(("quest_giver_kind_transition_retained_mob_type", steps));
    }
    let new_actor = |id: u32| ActorDelta {
        mask: AD_NEW,
        q: QActor {
            id,
            x: 8,
            y: 8,
            ..QActor::default()
        },
    };
    chains.push(refusal(
        "delta_base_mismatch",
        SnapshotDelta {
            training: false,
            owner_combat: None,
            base_tick: 9,
            tick: 11,
            server_time: snapshot_server_ms(11),
            ..empty_delta()
        },
        "base_mismatch",
    ));
    chains.push(refusal(
        "delta_departs_unknown_actor",
        SnapshotDelta {
            departed: vec![7],
            ..empty_delta()
        },
        "unknown_departed",
    ));
    chains.push(refusal(
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
    ));
    chains.push(refusal(
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
    ));
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
    {
        let mut tracker = SnapshotTracker::new();
        let mut encoder = ConnEncoder::new();
        let lock = WireOwnerCombat {
            lock: WireOwnerLock::Held { target: Some(9) },
            draw_started_at: 4_000,
            ready_at: 20_000,
            as_milli: 650.0,
            windup_milli: 1_500.0,
            speed_milli: 1_000.0,
        };
        let mut first = snap(
            10,
            1,
            4,
            Some(chain_self(500.0)),
            &[wa(9, 100., 100., 100, 1)],
        );
        first.set_owner_combat(Some(lock)).unwrap();
        let (frame, kind) = encoder.encode_frame(first.clone());
        assert_eq!(kind, FrameKind::Full);
        let mut steps = vec![ChainStep {
            frame: frame.clone(),
            outcome: ChainOutcome::Applied(tracker.decode(&frame).unwrap()),
        }];
        let mut next = snap(
            11,
            1,
            5,
            Some(chain_self(500.0)),
            &[wa(9, 100., 100., 100, 1)],
        );
        next.set_owner_combat(Some(lock)).unwrap();
        let (retained, kind) = encoder.encode_frame(next.clone());
        assert_eq!(kind, FrameKind::Delta);
        let got = tracker.decode(&retained).unwrap();
        assert_eq!(got, next.decoded());
        steps.push(ChainStep {
            frame: retained,
            outcome: ChainOutcome::Applied(got),
        });

        let mut cleared = snap(
            12,
            1,
            6,
            Some(chain_self(500.0)),
            &[wa(9, 100., 100., 100, 1)],
        );
        cleared.set_owner_combat(None).unwrap();
        let (clear, kind) = encoder.encode_frame(cleared.clone());
        assert_eq!(kind, FrameKind::Delta);
        let got = tracker.decode(&clear).unwrap();
        assert_eq!(got, cleared.decoded());
        steps.push(ChainStep {
            frame: clear,
            outcome: ChainOutcome::Applied(got),
        });
        chains.push(("owner_combat_retain_and_clear", steps));
    }
    {
        let mut tracker = SnapshotTracker::new();
        let mut base = snap(20, 1, 1, Some(chain_self(500.0)), &[]);
        base.set_owner_combat(Some(WireOwnerCombat {
            lock: WireOwnerLock::Held { target: None },
            draw_started_at: 10,
            ready_at: 500,
            as_milli: 1000.0,
            windup_milli: 1000.0,
            speed_milli: 1000.0,
        }))
        .unwrap();
        let s0 = applied(&mut tracker, full_frame(&base));
        let owner_lost = snap(21, 1, 2, None, &[]);
        let delta = delta::diff(&base, &owner_lost).expect("owner loss is a delta");
        assert!(
            delta.owner_combat.is_none(),
            "loss clears without redundant group bytes"
        );
        let s1 = applied(&mut tracker, delta_message(delta));
        assert!(matches!(
            s1.outcome,
            ChainOutcome::Applied(ServerMsg::Snapshot {
                owner_combat: None,
                ..
            })
        ));
        chains.push(("owner_combat_owner_loss_clears", vec![s0, s1]));
    }
    {
        let mut tracker = SnapshotTracker::new();
        let mut base = snap(
            30,
            1,
            1,
            Some(chain_self(500.0)),
            &[wa(9, 100., 100., 100, 1)],
        );
        base.set_owner_combat(Some(WireOwnerCombat {
            lock: WireOwnerLock::Held { target: Some(9) },
            draw_started_at: 10,
            ready_at: 500,
            as_milli: 1000.0,
            windup_milli: 1000.0,
            speed_milli: 1000.0,
        }))
        .unwrap();
        let s0 = applied(&mut tracker, full_frame(&base));
        let before = tracker.snapshot();
        let dangling = SnapshotDelta {
            tick: 31,
            server_time: snapshot_server_ms(31),
            base_tick: 30,
            ack_input: 2,
            me: Some(SelfDelta::default()),
            changed: vec![],
            departed: vec![9],
            phase: None,
            training: false,
            owner_combat: None,
        };
        let bad = refused(&mut tracker, delta_message(dangling), "owner_combat");
        assert_eq!(tracker.snapshot(), before, "dangling ref refusal is atomic");
        chains.push(("owner_combat_dangling_delta_refused", vec![s0, bad]));
    }
    {
        let mut tracker = SnapshotTracker::new();
        let base = snap(40, 1, 1, None, &[]);
        let s0 = applied(&mut tracker, full_frame(&base));
        let redundant_clear = SnapshotDelta {
            tick: 41,
            server_time: snapshot_server_ms(41),
            training: false,
            base_tick: 40,
            phase: None,
            ack_input: 2,
            me: None,
            changed: vec![],
            departed: vec![],
            owner_combat: Some(None),
        };
        let s1 = applied(&mut tracker, delta_message(redundant_clear));
        assert!(matches!(
            s1.outcome,
            ChainOutcome::Applied(ServerMsg::Snapshot {
                owner_combat: None,
                me: None,
                ..
            })
        ));
        chains.push((
            "owner_combat_redundant_unavailable_without_self",
            vec![s0, s1],
        ));
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
    let owner_record = |lock: u8, target: Option<u32>, mirrors: [f64; 3]| {
        let mut w = Writer::default();
        w.u8(lock);
        if let Some(target) = target {
            w.varint(target);
        }
        w.u32(4_000);
        w.u32(20_000);
        for value in mirrors {
            w.f64(value);
        }
        w.finish()
    };
    let delta_owner = |avail: u8, owner: &[u8], present: bool| {
        let head = DH_OWNER_COMBAT | if present { DH_PRESENT } else { 0 };
        let mut rest = vec![0]; // changed-actor count; self mask is carried in the head varint
        rest.push(avail);
        rest.extend_from_slice(owner);
        delta_bytes(11, 1, head, &rest)
    };
    vec![
        ("delta_age_zero", delta_bytes(10, 0, 0, &[0])),
        ("delta_age_over_max", delta_bytes(100, 65, 0, &[0])),
        ("delta_age_past_tick", delta_bytes(5, 6, 0, &[0])),
        (
            "delta_head_field_without_present_bit",
            delta_bytes(10, 1, DH_X, &[0]),
        ),
        // Review finding 6: the self archetype (bit 25) is a self field too.
        (
            "delta_head_archetype_without_present_bit",
            delta_bytes(10, 1, delta::DH_ARCHETYPE, &[3, 0]),
        ),
        // Bit 25 is not a field of this version; bit 24 carries owner combat.
        ("delta_head_unknown_bit", delta_bytes(10, 1, 1 << 29, &[0])),
        // Protocol 16, ADR0026: self and actor indicator facts in a delta.
        (
            "delta_head_flags_without_present_bit",
            delta_bytes(10, 1, delta::DH_FLAGS, &[1, 0]),
        ),
        (
            "delta_self_flags_unknown_bit",
            delta_bytes(10, 1, DH_PRESENT | delta::DH_FLAGS, &[0x20, 0]),
        ),
        (
            "delta_self_build_marks_key_over_9",
            delta_bytes(10, 1, DH_PRESENT | delta::DH_BUILD_MARKS, &[0x1a, 0]),
        ),
        (
            "delta_self_mark_brand_over_100",
            delta_bytes(10, 1, DH_PRESENT | delta::DH_MARK, &[1, 200, 0, 0]),
        ),
        (
            "delta_actor_flags_unknown_bit",
            delta_bytes(10, 1, 0, &[1, 5, 0x80, 0x80, 0x01, 0x10]),
        ),
        (
            "delta_actor_offhand_over_16",
            delta_bytes(10, 1, 0, &[1, 5, 0x80, 0x80, 0x02, 17]),
        ),
        (
            "delta_actor_build_marks_repeated",
            delta_bytes(10, 1, 0, &[1, 5, 0x80, 0x80, 0x04, 0x44]),
        ),
        (
            "delta_actor_mark_tier_over_4",
            delta_bytes(10, 1, 0, &[1, 5, 0x80, 0x80, 0x08, 9, 0, 0]),
        ),
        (
            "delta_owner_combat_option_unknown",
            delta_owner(2, &[], false),
        ),
        (
            "delta_owner_combat_available_without_self",
            delta_owner(1, &owner_record(0, None, [1000.0; 3]), false),
        ),
        (
            "delta_owner_combat_bad_lock",
            delta_owner(1, &owner_record(3, None, [1000.0; 3]), true),
        ),
        (
            "delta_owner_combat_zero_target",
            delta_owner(1, &owner_record(2, Some(0), [1000.0; 3]), true),
        ),
        (
            "delta_owner_combat_nonfinite_mirror",
            delta_owner(
                1,
                &owner_record(0, None, [f64::INFINITY, 1000.0, 1000.0]),
                true,
            ),
        ),
        (
            "delta_head_overlong_varint",
            vec![0x87, 10, 1, 0, 0x80, 0x00, 0],
        ),
        (
            "delta_self_status_over_3",
            delta_bytes(10, 1, DH_PRESENT | DH_STATUS, &[4, 0]),
        ),
        ("delta_phase_over_3", delta_bytes(10, 1, DH_PHASE, &[4, 0])),
        // Actor delta bit 18 is not a field of this version.
        (
            "delta_actor_mask_unknown_bit",
            delta_bytes(10, 1, 0, &[1, 1, 0x80, 0x80, 0x10]),
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

fn json_opt_f64(v: Option<f64>) -> String {
    v.map_or_else(|| "null".into(), |x| x.to_string())
}
fn json_point(v: Option<WirePoint>) -> String {
    v.map_or_else(
        || "null".into(),
        |p| format!("{{\"xBits\":{},\"yBits\":{}}}", bits(p.x), bits(p.y)),
    )
}
fn json_wish(v: Option<WireWishOwner>) -> String {
    v.map_or_else(|| "null".into(), |w| format!(
        "{{\"ability\":{},\"readyAt\":{},\"fullAt\":{},\"maxCharges\":{},\"rechargeMs\":{},\"charges\":{},\"nextChargeAt\":{},\"cast\":{}}}",
        w.ability,w.ready_at,json_opt_f64(w.full_at),w.max_charges,w.recharge_ms,w.charges,json_opt_f64(w.next_charge_at),
        w.cast.map_or_else(|| "null".into(), |c| format!("{{\"ability\":{},\"startedAt\":{},\"landsAt\":{}}}",c.ability,c.started_at,c.lands_at))
    ))
}

fn json_owner_combat(v: Option<WireOwnerCombat>) -> String {
    let Some(owner) = v else {
        return "null".into();
    };
    let lock = match owner.lock {
        WireOwnerLock::Clear => "{\"clear\":true}".into(),
        WireOwnerLock::Held { target: None } => "{\"held\":true,\"target\":null}".into(),
        WireOwnerLock::Held { target: Some(id) } => {
            format!("{{\"held\":true,\"target\":{id}}}")
        }
    };
    format!(
        "{{\"lock\":{lock},\"drawStartedAt\":{},\"readyAt\":{},\"asMilli\":{},\"windupMilli\":{},\"speedMilli\":{}}}",
        owner.draw_started_at,
        owner.ready_at,
        owner.as_milli,
        owner.windup_milli,
        owner.speed_milli
    )
}

fn decoded_client_json(m: &ClientMsg) -> Option<String> {
    let ClientMsg::Input { commands, .. } = m else {
        return None;
    };
    if !commands
        .iter()
        .any(|c| matches!(c, WireCommand::Cast { .. } | WireCommand::Trade { .. }))
    {
        return None;
    }
    let items: Vec<String> = commands.iter().filter_map(|c| match *c {
        WireCommand::Cast { slot, x, y, actor, t, seq } => Some(format!(
            "{{\"k\":\"cast\",\"slot\":{slot},\"xBits\":{},\"yBits\":{},\"actor\":{},\"t\":{},\"seq\":{}}}",
            bits(x), bits(y), actor.map_or("null".into(), |v| v.to_string()), json_opt_f64(t), seq.map_or("null".into(), |v| v.to_string())
        )),
        WireCommand::Trade { kind, pick } => {
            Some(format!("{{\"k\":\"trade\",\"kind\":{},\"pick\":{pick}}}", kind.code()))
        }
        _ => None,
    }).collect();
    Some(format!(
        "{{\"k\":\"input\",\"commands\":[{}]}}",
        items.join(",")
    ))
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
        server_time,
        owner_combat,
    } = m
    else {
        unreachable!("only snapshots carry a decoded form")
    };
    let me = match me {
        None => "null".to_string(),
        Some(s) => format!(
            "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpBits\": {}, \"maxHpBits\": {}, \"status\": {}, \"weapon\": {}, \"readyInMs\": {}, \"kills\": {}, \"bounty\": {}, \"gv\": {}, \"moveSeq\": {}, \"effects\": {}, \"displaceSeq\": {}, \"sig\": {}, \"huntTarget\": {}, \"huntStacks\": {}, \"wish\": {}, \"barrierBits\": {}, \"barrierRingStep\": {}, \"archetype\": {}, \"flags\": {}, \"buildMarks\": {}, \"markTier\": {}, \"brand\": {}, \"markTax\": {}}}",
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
            s.move_seq,
            s.effects,
            s.displace_seq,
            s.sig,
            s.hunt_target.map_or("null".to_string(), |v| v.to_string()),
            s.hunt_stacks,
            json_wish(s.wish),
            bits(s.barrier),
            s.barrier_ring_step,
            s.archetype,
            s.flags,
            s.build_marks,
            s.mark_tier,
            s.brand,
            s.mark_tax
        ),
    };
    let actors: Vec<String> = actors
        .iter()
        .map(|a| {
            format!(
                "{{\"id\": {}, \"faction\": {}, \"xBits\": {}, \"yBits\": {}, \"facingBits\": {}, \"hpPct\": {}, \"status\": {}, \"weapon\": {}, \"bounty\": {}, \"kind\": {}, \"effects\": {}, \"displaceSeq\": {}, \"mobTypeCode\": {}, \"sig\": {}, \"barrierPct\": {}, \"barrierRingStep\": {}, \"archetype\": {}, \"flags\": {}, \"offhand\": {}, \"buildMarks\": {}, \"markTier\": {}, \"brand\": {}, \"markTax\": {}}}",
                a.id,
                a.faction,
                bits(a.x),
                bits(a.y),
                bits(a.facing),
                a.hp_pct,
                a.status,
                a.weapon,
                a.bounty,
                a.kind, a.effects, a.displace_seq, a.mob_type_code, a.sig, a.barrier_pct, a.barrier_ring_step,
                a.archetype, a.flags, a.offhand, a.build_marks, a.mark_tier, a.brand, a.mark_tax
            )
        })
        .collect();
    format!(
        "{{\"tick\": {tick}, \"serverMs\": {}, \"phase\": {phase}, \"ack\": {ack_input}, \"training\": {training}, \"me\": {me}, \"actors\": [{}], \"ownerCombat\": {}}}",
        server_time,
        actors.join(", "),
        json_owner_combat(*owner_combat),
    )
}

fn decoded_map_json(m: &ServerMsg) -> String {
    let ServerMsg::Welcome {
        map,
        archetypes,
        vision,
        weapons,
        hud,
        ..
    } = m
    else {
        unreachable!()
    };
    // Rust prints each f64 as its shortest round-trip form, so a JSON reader gets the exact value back.
    let weapons: Vec<String> = weapons
        .iter()
        .map(|w| {
            format!(
                "{{\"id\":{},\"kind\":{},\"reach\":{},\"halfArc\":{},\"speed\":{},\"radius\":{}}}",
                w.id, w.kind, w.reach, w.half_arc, w.speed, w.radius
            )
        })
        .collect();
    let weapons = weapons.join(",");
    // P-WIRE17-HUD-2b: the HUD content block (f64 in shortest round-trip form, `dominant` a JSON boolean).
    let scaling = hud
        .scaling
        .iter()
        .map(|s| {
            format!(
                "{{\"id\":{},\"ad\":{},\"ap\":{},\"bonusHp\":{},\"bonusDefense\":{},\"dominant\":{}}}",
                s.id, s.ad, s.ap, s.bonus_hp, s.bonus_defense, s.dominant
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let terms = hud
        .terms
        .iter()
        .map(|t| format!("{{\"code\":{},\"value\":{}}}", t.code, t.value))
        .collect::<Vec<_>>()
        .join(",");
    let hud = format!("{{\"scaling\":[{scaling}],\"terms\":[{terms}]}}");
    let coliseum = vision.coliseum.map_or_else(
        || "null".to_string(),
        |r| {
            format!(
                "{{\"x\":{},\"y\":{},\"w\":{},\"h\":{}}}",
                r.x, r.y, r.w, r.h
            )
        },
    );
    let vision = format!(
        "{{\"version\":{},\"tile\":{},\"radius\":{},\"trailMs\":{},\"updateMs\":{},\"sightMask\":{},\"coliseum\":{coliseum}}}",
        vision.version,
        vision.tile,
        vision.radius,
        vision.trail_ms,
        vision.update_ms,
        vision.sight_mask,
    );
    let rows: Vec<String> = archetypes
        .iter()
        .map(|a| {
            let hull = match a.hull {
                WireHull::Circle { r } => format!("\"hull\":0,\"r\":{r}"),
                WireHull::Boxes {
                    fx,
                    fy,
                    bx,
                    by,
                    ox,
                    oy,
                } => format!(
                    "\"hull\":1,\"fx\":{fx},\"fy\":{fy},\"bx\":{bx},\"by\":{by},\"ox\":{ox},\"oy\":{oy}"
                ),
            };
            format!(
                "{{\"id\":{},\"key\":\"{}\",{hull},\"chest\":{}}}",
                a.id, a.key, a.chest
            )
        })
        .collect();
    let archetypes = rows.join(",");
    let nums = |values: &[u8]| {
        values
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(",")
    };
    let plane = |values: Option<&[u8]>| {
        values.map_or_else(|| "null".to_string(), |v| format!("[{}]", nums(v)))
    };
    let public = &map.public;
    let camps = public
        .camps
        .iter()
        .map(|c| {
            format!(
                "{{\"x\":{},\"y\":{},\"r\":{},\"zone\":{}}}",
                c.x, c.y, c.r, c.zone
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let map_coliseum = public.coliseum.as_ref().map_or_else(
        || "null".to_string(),
        |c| {
            let gates = c
                .gates
                .iter()
                .map(|g| {
                    let tiles = g
                        .tiles
                        .iter()
                        .map(|t| format!("{{\"x\":{},\"y\":{}}}", t.x, t.y))
                        .collect::<Vec<_>>()
                        .join(",");
                    format!("{{\"side\":{},\"tiles\":[{tiles}]}}", g.side)
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"x\":{},\"y\":{},\"w\":{},\"h\":{},\"gates\":[{gates}]}}",
                c.x, c.y, c.w, c.h
            )
        },
    );
    let props = public
        .props
        .iter()
        .map(|p| {
            format!(
                "{{\"kind\":{},\"x\":{},\"y\":{},\"variant\":{},\"flags\":{}}}",
                p.kind, p.x, p.y, p.variant, p.flags
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"archetypes\":[{archetypes}],\"vision\":{vision},\"weapons\":[{weapons}],\"hud\":{hud},\"map\":{{\"w\":{},\"h\":{},\"tiles\":[{}],\"layerHash\":{},\"terrain\":{},\"regions\":{},\"terrainMode\":{},\"semanticHash\":{},\"contextHash\":{},\"camps\":[{camps}],\"coliseum\":{map_coliseum},\"bushes\":{},\"props\":[{props}],\"groundVariants\":{}}}}}",
        map.w,
        map.h,
        nums(&map.tiles),
        map.layer_hash,
        plane(map.terrain.as_deref()),
        plane(map.regions.as_deref()),
        map.terrain_mode as u8,
        map.semantic_hash,
        map.context_hash,
        plane(public.bushes.as_deref()),
        plane(public.ground_variants.as_deref()),
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
            WireFx::Hit { victim, by, amount, passive, critical } => format!(
                "{{\"k\": \"hit\", \"victim\": {victim}, \"by\": {by}, \"passive\": {passive}, \"critical\": {critical}, \"amountBits\": {}}}",
                bits(amount)
            ),
            WireFx::Windup { by, weapon, a, ms } => format!(
                "{{\"k\": \"windup\", \"by\": {by}, \"weapon\": {weapon}, \"aBits\": {}, \"ms\": {ms}}}",
                bits(a)
            ),
            WireFx::Cancel { id } => format!("{{\"k\": \"cancel\", \"id\": {id}}}"),
            WireFx::SigHit { victim, by, kind, amount } => format!(
                "{{\"k\": \"sigHit\", \"victim\": {victim}, \"by\": {by}, \"kind\": {kind}, \"amountBits\": {}}}",
                bits(amount)
            ),
            WireFx::Heal { id, amount } => format!(
                "{{\"k\": \"heal\", \"id\": {id}, \"amountBits\": {}}}",
                bits(amount)
            ),
            WireFx::Teleport => "{\"k\": \"teleport\"}".to_owned(),
            WireFx::WishStarted { event_time, caster, ability, duration, target, anchor } => format!("{{\"k\":\"castStarted\",\"eventTime\":{event_time},\"caster\":{caster},\"ability\":{ability},\"duration\":{duration},\"target\":{},\"anchor\":{}}}", target.map_or("null".into(), |v| v.to_string()), json_point(anchor)),
            WireFx::WishLanded { event_time, ability, caster, target, anchor, destination } => format!("{{\"k\":\"castLanded\",\"eventTime\":{event_time},\"ability\":{ability},\"caster\":{},\"target\":{},\"anchor\":{},\"destination\":{}}}", caster.map_or("null".into(), |v| v.to_string()), target.map_or("null".into(), |v| v.to_string()), json_point(anchor), json_point(destination)),
            WireFx::WishEnded { event_time, caster, ability, reason } => format!("{{\"k\":\"castEnded\",\"eventTime\":{event_time},\"caster\":{caster},\"ability\":{ability},\"reason\":{reason}}}"),
        })
        .collect();
    format!("{{\"tick\": {tick}, \"fx\": [{}]}}", items.join(", "))
}

/// JSON reference for the typed reward-state control vector. Gain is an exact JSON number that round-trips to f64.
fn decoded_trophy_state_json(m: &ServerMsg) -> String {
    let ServerMsg::State { tick, items } = m else {
        unreachable!("not a state vector")
    };
    let StateItem::RewardChests(rows) = &items[0] else {
        unreachable!("not a reward-state vector")
    };
    let rows = rows
        .iter()
        .map(|row| {
            let options = row
                .options
                .iter()
                .map(|option| match option.id {
                    WireRewardId::Kill { key, gain } => format!(
                        "{{\"kind\":3,\"key\":{},\"gain\":{},\"taken\":{},\"takenBy\":{}}}",
                        key as u8,
                        gain,
                        option.taken,
                        option.taken_by.map_or("null".to_string(), |id| id.to_string())
                    ),
                    _ => unreachable!("trophy-state vector contains only Kill options"),
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "{{\"handle\":{},\"x\":{},\"y\":{},\"expiresAt\":{},\"options\":[{}],\"picked\":{},\"canChoose\":{}}}",
                row.handle.get(), row.x, row.y, row.expires_at, options, row.picked, row.can_choose
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"kind\":\"state\",\"tick\":{tick},\"items\":[{{\"key\":4,\"value\":[{rows}]}}]}}")
}

fn decoded_trade_state_json(m: &ServerMsg) -> String {
    let ServerMsg::State { tick, items } = m else {
        unreachable!("not a state vector")
    };
    let decoded_items = items
        .iter()
        .filter_map(|item| {
            let StateItem::Trade(view) = item else {
                return None;
            };
            let value = view.as_ref().map_or_else(|| "null".to_owned(), |view| {
                let offers = view.offers.iter().map(|offer| format!(
                    "{{\"cost\":{},\"costValue\":{},\"gain\":{},\"gainValue\":{},\"label\":\"{}\"}}",
                    offer.cost.code(), offer.cost_value, offer.gain.code(), offer.gain_value, escape(&offer.label)
                )).collect::<Vec<_>>().join(",");
                let stats = view.stats.iter().map(|stat| format!(
                    "{{\"stat\":{},\"value\":{}}}", stat.stat.code(), stat.value
                )).collect::<Vec<_>>().join(",");
                let merchants = view.merchants.iter().map(|merchant| format!(
                    "{{\"kind\":{},\"x\":{},\"y\":{},\"name\":\"{}\"}}",
                    merchant.kind.code(), merchant.x, merchant.y, escape(&merchant.name)
                )).collect::<Vec<_>>().join(",");
                let barter_labels = view.barter_labels.iter().map(|label| format!("\"{}\"", escape(label))).collect::<Vec<_>>().join(",");
                format!(
                    "{{\"tradeUsed\":{},\"offers\":[{}],\"stats\":[{}],\"barterReadyAt\":{},\"merchants\":[{}],\"barterLabels\":[{}]}}",
                    view.trade_used, offers, stats, json_opt_f64(view.barter_ready_at), merchants, barter_labels
                )
            });
            Some(format!("{{\"key\":11,\"value\":{value}}}"))
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"kind\":\"state\",\"tick\":{tick},\"items\":[{decoded_items}]}}")
}

fn decoded_quest_state_json(m: &ServerMsg) -> String {
    let ServerMsg::State { tick, items } = m else {
        unreachable!("not state")
    };
    let decoded_items = items.iter().filter_map(|item| match item {
        StateItem::Props(props) => {
            let rows = props.rows.iter().map(|row| {
                let kind = match &row.kind {
                    WirePropKind::Ground(_) => 1,
                    WirePropKind::Chest { .. } => 2,
                    WirePropKind::Body { .. } => 3,
                    WirePropKind::Corpse { .. } => 4,
                    WirePropKind::WindEmblem => 5,
                    WirePropKind::Cannon { .. } => 6,
                    WirePropKind::QuestItem { .. } => 7,
                };
                let specifics = match &row.kind {
                    WirePropKind::Ground(weapon) => format!("\"weapon\":{weapon}"),
                    WirePropKind::Chest { open } => format!("\"open\":{open}"),
                    WirePropKind::Body { label } | WirePropKind::Corpse { label } => format!("\"label\":\"{}\"", escape(label)),
                    WirePropKind::WindEmblem => String::new(),
                    WirePropKind::Cannon { ready_at } => format!("\"readyAt\":{ready_at}"),
                    WirePropKind::QuestItem { quest, fetch } => format!("\"quest\":{},\"fetch\":{fetch}", quest.get()),
                };
                let base = format!("\"handle\":{},\"x\":{},\"y\":{},\"kind\":{kind}", row.handle.get(), row.x, row.y);
                if specifics.is_empty() { format!("{{{base}}}") } else { format!("{{{base},{specifics}}}") }
            }).collect::<Vec<_>>().join(",");
            let focus = props.focus.map_or("null".to_owned(), |focus| format!("{{\"handle\":{},\"bodyHint\":{}}}", focus.handle.get(), focus.body_hint.map_or("null".to_owned(), |hint| hint.to_string())));
            Some(format!("{{\"key\":2,\"value\":{{\"rows\":[{}],\"focus\":{}}}}}", rows, focus))
        }
        StateItem::Quests(view) => {
            let value = view.as_ref().map_or_else(|| "null".to_owned(), |view| {
                let roster = view.roster.iter().map(|entry| format!("{{\"id\":{},\"label\":\"{}\"}}", entry.id.get(), escape(&entry.label))).collect::<Vec<_>>().join(",");
                let rows = view.rows.iter().map(|row| {
                    let participants = row.participants.iter().map(|part| format!("{{\"id\":{},\"accepted\":{},\"progress\":{},\"visited\":{}}}", part.id.get(), part.accepted, part.progress, part.visited)).collect::<Vec<_>>().join(",");
                    format!("{{\"handle\":{},\"def\":\"{}\",\"giver\":{{\"x\":{},\"y\":{}}},\"state\":{},\"expiresAt\":{},\"participants\":[{}],\"carrier\":{},\"carrierActor\":{},\"doneBy\":{},\"canAccept\":{},\"ownerAccepted\":{},\"ownerProgress\":{},\"ownerVisited\":{},\"name\":\"{}\",\"giverLabel\":\"{}\",\"brief\":\"{}\",\"objective\":\"{}\",\"reward\":\"{}\",\"ownerCompleted\":{},\"ownerReady\":{}}}",
                        row.handle.get(), escape(&row.def), row.giver.x, row.giver.y, row.state, row.expires_at,
                        participants, row.carrier.map_or("null".to_owned(), |id| id.get().to_string()),
                        row.carrier_actor.map_or("null".to_owned(), |id| id.to_string()),
                        row.done_by.as_ref().map_or("null".to_owned(), |label| format!("\"{}\"", escape(label))),
                        row.can_accept, row.owner_accepted, row.owner_progress, row.owner_visited,
                        escape(&row.name), escape(&row.giver_label), escape(&row.brief), escape(&row.objective), escape(&row.reward),
                        row.owner_completed, row.owner_ready)
                }).collect::<Vec<_>>().join(",");
                let objectives = view.objectives.iter().map(|objective| format!("{{\"quest\":{},\"at\":{{\"x\":{},\"y\":{}}}}}", objective.quest.get(), objective.at.x, objective.at.y)).collect::<Vec<_>>().join(",");
                format!("{{\"unknownCount\":{},\"displayUnknownCount\":{},\"ownerRoster\":{},\"roster\":[{}],\"rows\":[{}],\"objectives\":[{}]}}",
                    view.unknown_count, view.display_unknown_count, view.owner_roster.map_or("null".to_owned(), |id| id.get().to_string()), roster, rows, objectives)
            });
            Some(format!("{{\"key\":10,\"value\":{value}}}"))
        }
        _ => None,
    }).collect::<Vec<_>>().join(",");
    format!("{{\"kind\":\"state\",\"tick\":{tick},\"items\":[{decoded_items}]}}")
}

/// The manifest JSON (hand-written to keep this crate dependency-free; field names are the C# and JS tests' contract).
/// A server vector's `debug` is the message a client DECODES (quantized), not the sample as written.
pub fn manifest() -> String {
    let mut out = String::from("{\n  \"format\": \"rh-protocol-vectors/5\",\n  \"protocol\": ");
    out.push_str(&PROTOCOL_VERSION.to_string());
    out.push_str(",\n  \"client\": [\n");
    let c = client_samples();
    for (i, (name, m)) in c.iter().enumerate() {
        let decoded =
            decoded_client_json(m).map_or(String::new(), |json| format!(", \"decoded\": {json}"));
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"debug\": \"{}\"{decoded}}}{}\n",
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
            ServerMsg::Welcome { .. } => format!(", \"decoded\": {}", decoded_map_json(&decoded)),
            ServerMsg::State { .. } if *name == "state_trophy_reward_keys" => {
                format!(", \"decoded\": {}", decoded_trophy_state_json(&decoded))
            }
            ServerMsg::State { .. } if name.starts_with("state_trade_") => {
                format!(", \"decoded\": {}", decoded_trade_state_json(&decoded))
            }
            ServerMsg::State { .. } if name.starts_with("state_quests_") => {
                format!(", \"decoded\": {}", decoded_quest_state_json(&decoded))
            }
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
    // Protocol 17 map refusals carry the reason every decoder must name.
    out.push_str("  ],\n  \"malformedMap\": [\n");
    let maps = malformed_map();
    for (i, (name, bytes, reason)) in maps.iter().enumerate() {
        out.push_str(&format!(
            "    {{\"name\": \"{name}\", \"hex\": \"{}\", \"reason\": \"{reason}\"}}{}\n",
            hex(bytes),
            if i + 1 < maps.len() { "," } else { "" }
        ));
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

#[cfg(test)]
mod map_public_samples {
    use super::*;
    use crate::DecodeError;

    #[test]
    fn every_malformed_map_is_refused_for_its_reason() {
        for (name, bytes, reason) in malformed_map() {
            let got = ServerMsg::decode(&bytes).expect_err(name);
            let want = if reason == "truncated" {
                DecodeError::Truncated
            } else {
                DecodeError::BadMap(reason)
            };
            assert_eq!(got, want, "{name}");
        }
    }

    #[test]
    fn a_hand_built_public_map_with_valid_sections_decodes() {
        // The builder itself is sound: in-range sections decode.
        let ok = welcome_public_raw(
            2,
            0x04 | 0x08,
            &[
                raw_list(raw_camps(&[(16, 16, 80, 5)])),
                raw_list(raw_coliseum(
                    (0, 0, RAW_W, RAW_H),
                    &[(3, &[(RAW_W - 1, RAW_H - 1)][..])],
                )),
            ],
            false,
        );
        let ServerMsg::Welcome { map, .. } = ServerMsg::decode(&ok).expect("valid") else {
            panic!("welcome")
        };
        assert_eq!(map.public.camps.len(), 1);
        assert_eq!(map.public.coliseum.as_ref().map(|c| c.gates.len()), Some(1));
    }

    #[test]
    fn public_welcome_samples_carry_their_sections() {
        let all = public_map(true).public;
        assert_eq!(all.camps.len(), 3);
        assert_eq!(all.props.len(), 2);
        assert!(all.bushes.is_some() && all.ground_variants.is_some());
        let shipped = public_map(false).public;
        assert!(shipped.props.is_empty() && shipped.ground_variants.is_none());
        assert!(shipped.coliseum.is_some() && shipped.bushes.is_some());
    }
}
