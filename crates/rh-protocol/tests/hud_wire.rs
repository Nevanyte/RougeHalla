//! P-WIRE17-HUD-1 oracle: the camp row's reward and ward verdict, and the owner-only build summary (State key 13).
//! The byte layouts below are the packet brief's (docs/backlog/packets/P-WIRE17-HUD-1.md, "Wire layout"); every
//! multi-byte integer is little-endian, every HUD number is fixed point in `HUD_QUANTUM` (1e-4) units.
use rh_protocol::state::{
    WireBuildSummary, WireCampReward, WireMobBonusRow, WireWard, HUD_QUANTUM, MAX_STATE_KEYS,
    MAX_SUMMARY_MOB_ROWS,
};
use rh_protocol::*;

const T_STATE: u8 = 0x88;

fn camp(reward: Option<WireCampReward>, ward: Option<WireWard>) -> WireCamp {
    WireCamp {
        mob_type: 3,
        elite: Some(29),
        alive: 2,
        state: 0,
        cleared_at: 1000.,
        respawn_at: 181000.,
        reward,
        ward,
    }
}

fn state(items: Vec<StateItem>) -> ServerMsg {
    ServerMsg::State { tick: 5, items }
}

fn round_trip(msg: &ServerMsg) -> Vec<u8> {
    let bytes = msg.try_encode().expect("the HUD state encodes");
    assert_eq!(
        &ServerMsg::decode(&bytes).expect("the HUD state decodes"),
        msg,
        "decode(encode(x)) == x"
    );
    bytes
}

/// The bytes of one camp row before the HUD additions (`WireCamp` as of protocol 17 before this packet).
fn camp_head() -> Vec<u8> {
    let mut b = vec![3, 30, 2, 0];
    b.extend_from_slice(&1000f64.to_le_bytes());
    b.extend_from_slice(&181000f64.to_le_bytes());
    b
}

/// T_STATE, tick 5, one item, key 6, one row, then the row's pre-HUD bytes.
fn camps_prefix() -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 6, 1];
    b.extend(camp_head());
    b
}

#[test]
fn camp_row_round_trips_reward_and_each_ward_verdict() {
    let reward = Some(WireCampReward {
        stat: 2,
        amount: 100,
    });
    for ward in [
        None,
        Some(WireWard {
            yours: true,
            expires_at: 61_000.,
        }),
        Some(WireWard {
            yours: false,
            expires_at: 90_500.5,
        }),
    ] {
        for reward in [None, reward] {
            round_trip(&state(vec![StateItem::Camps(vec![camp(reward, ward)])]));
        }
    }
}

/// Layout: after `respawn_at`, reward u8 (0 none, else 1 + stat code) [+ amount u16 when present], then ward u8
/// (0 none, 1 yours, 2 another player's) [+ expires_at f64 when not none].
#[test]
fn camp_row_bytes_follow_the_brief_layout() {
    let none = camps_prefix();
    let mut want = none.clone();
    want.extend([0, 0]);
    assert_eq!(
        round_trip(&state(vec![StateItem::Camps(vec![camp(None, None)])])),
        want,
        "no reward, no ward: two zero bytes appended"
    );

    let row = camp(
        Some(WireCampReward {
            stat: 6,
            amount: 12_500,
        }),
        Some(WireWard {
            yours: true,
            expires_at: 61_000.,
        }),
    );
    let mut want = none.clone();
    want.push(7);
    want.extend_from_slice(&12_500u16.to_le_bytes());
    want.push(1);
    want.extend_from_slice(&61_000f64.to_le_bytes());
    assert_eq!(
        round_trip(&state(vec![StateItem::Camps(vec![row])])),
        want,
        "Defense 1.25 reward, own ward"
    );

    let row = camp(
        Some(WireCampReward {
            stat: 8,
            amount: 50,
        }),
        Some(WireWard {
            yours: false,
            expires_at: 90_500.5,
        }),
    );
    let mut want = none;
    want.push(9);
    want.extend_from_slice(&50u16.to_le_bytes());
    want.push(2);
    want.extend_from_slice(&90_500.5f64.to_le_bytes());
    assert_eq!(
        round_trip(&state(vec![StateItem::Camps(vec![row])])),
        want,
        "Move speed 0.005 reward, another player's ward"
    );
}

#[test]
fn camp_row_refuses_bad_reward_and_ward() {
    let bad = [
        camp(Some(WireCampReward { stat: 9, amount: 1 }), None),
        camp(Some(WireCampReward { stat: 0, amount: 0 }), None),
        camp(
            None,
            Some(WireWard {
                yours: true,
                expires_at: f64::NAN,
            }),
        ),
        camp(
            None,
            Some(WireWard {
                yours: false,
                expires_at: -1.,
            }),
        ),
    ];
    for row in bad {
        assert!(
            state(vec![StateItem::Camps(vec![row])])
                .try_encode()
                .is_err(),
            "encoder refuses {row:?}"
        );
    }
    // Decoder: a valid frame, then the same frame with an out-of-range reward code, amount 0 or ward byte.
    let good = round_trip(&state(vec![StateItem::Camps(vec![camp(
        Some(WireCampReward {
            stat: 0,
            amount: 10_000,
        }),
        None,
    )])]));
    let reward_at = camps_prefix().len();
    let mut b = good.clone();
    b[reward_at] = 10;
    assert!(ServerMsg::decode(&b).is_err(), "reward code 10 refused");
    let mut b = good.clone();
    b[reward_at + 1] = 0;
    b[reward_at + 2] = 0;
    assert!(ServerMsg::decode(&b).is_err(), "reward amount 0 refused");
    let mut b = good;
    b[reward_at + 3] = 3;
    assert!(ServerMsg::decode(&b).is_err(), "ward verdict 3 refused");
}

fn summary() -> WireBuildSummary {
    WireBuildSummary {
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
    }
}

fn summary_frame(s: &WireBuildSummary) -> Vec<u8> {
    let mut b = vec![T_STATE, 5, 1, 13, 1];
    for g in s.gains {
        b.extend_from_slice(&g.to_le_bytes());
    }
    b.push(s.mob_rows.len() as u8);
    for r in &s.mob_rows {
        b.push(r.mob_type);
        b.push(r.stat);
        let mut v = r.stacks;
        while v >= 0x80 {
            b.push((v as u8) | 0x80);
            v >>= 7;
        }
        b.push(v as u8);
        b.extend_from_slice(&r.total.to_le_bytes());
    }
    b
}

/// Layout of key 13: present u8; 9 x i32 gains; row count u8; rows of mob u8, stat u8, stacks varint, total i32.
#[test]
fn build_summary_round_trips_with_the_brief_layout() {
    assert_eq!(MAX_STATE_KEYS, 13, "key 13 is the newest state key");
    assert_eq!(MAX_SUMMARY_MOB_ROWS, 20);
    assert_eq!(HUD_QUANTUM, 1e-4);
    let s = summary();
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(Some(s.clone()))])),
        summary_frame(&s)
    );
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(None)])),
        vec![T_STATE, 5, 1, 13, 0]
    );
    let empty = WireBuildSummary::default();
    assert_eq!(
        round_trip(&state(vec![StateItem::BuildSummary(Some(empty.clone()))])),
        summary_frame(&empty)
    );
}

fn rows(n: usize) -> Vec<WireMobBonusRow> {
    (0..n)
        .map(|i| WireMobBonusRow {
            mob_type: i as u8,
            stat: (i % 9) as u8,
            stacks: 1,
            total: 1,
        })
        .collect()
}

#[test]
fn build_summary_refuses_an_over_cap_mob_row_count() {
    let full = WireBuildSummary {
        gains: [0; 9],
        mob_rows: rows(MAX_SUMMARY_MOB_ROWS),
    };
    let ok = round_trip(&state(vec![StateItem::BuildSummary(Some(full.clone()))]));
    assert_eq!(ok, summary_frame(&full));

    let over = WireBuildSummary {
        gains: [0; 9],
        mob_rows: rows(MAX_SUMMARY_MOB_ROWS + 1),
    };
    match state(vec![StateItem::BuildSummary(Some(over.clone()))]).try_encode() {
        Err(EncodeError::TooMany { n, max, .. }) => {
            assert_eq!((n, max), (21, 20));
        }
        other => panic!("21 mob rows must be refused as TooMany, got {other:?}"),
    }
    assert!(
        ServerMsg::decode(&summary_frame(&over)).is_err(),
        "the decoder refuses a row count of 21"
    );
}

#[test]
fn build_summary_refuses_bad_rows() {
    let mut cases = Vec::new();
    let mut s = summary();
    s.mob_rows.swap(0, 1);
    cases.push(("rows out of mob order", s));
    let mut s = summary();
    s.mob_rows[1].mob_type = 0;
    cases.push(("duplicate mob", s));
    let mut s = summary();
    s.mob_rows[0].stat = 9;
    cases.push(("stat code 9", s));
    let mut s = summary();
    s.mob_rows[0].stacks = 0;
    cases.push(("zero stacks", s));
    let mut s = summary();
    s.mob_rows[0].mob_type = 30;
    cases.push(("mob code 30", s));
    // Sanity: the unmodified summary is accepted, so the refusals below are about the named fault.
    round_trip(&state(vec![StateItem::BuildSummary(Some(summary()))]));
    for (why, s) in cases {
        assert!(
            state(vec![StateItem::BuildSummary(Some(s.clone()))])
                .try_encode()
                .is_err(),
            "encoder refuses: {why}"
        );
        assert!(
            ServerMsg::decode(&summary_frame(&s)).is_err(),
            "decoder refuses: {why}"
        );
    }
    let mut b = summary_frame(&summary());
    b[4] = 2;
    assert!(ServerMsg::decode(&b).is_err(), "presence byte 2 refused");
}
