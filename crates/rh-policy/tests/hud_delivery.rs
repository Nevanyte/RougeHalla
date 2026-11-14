//! P-WIRE17-HUD-1 oracle: the delivery projection carries the observation's camp HUD rows and the viewer's own build
//! summary onto the wire (State keys 6 and 13), quantized to `HUD_QUANTUM`, and re-sends the summary only when its
//! quantized value changes.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_protocol::state::{WireCampReward, WireMobBonusRow, WireWard, HUD_QUANTUM};
use rh_protocol::{ServerMsg, StateItem};
use rh_sim::mob_catalog::MobTypeId as M;
use rh_sim::mob_runtime::CampRoster;
use rh_sim::observe::{CampHudView, CampReward, HudStat, SummaryMobRow, SummaryView, WardVerdict};
use rh_sim::Observation;

fn items(frame: &[u8]) -> Vec<StateItem> {
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).expect("state frame") else {
        panic!("not a state frame")
    };
    items
}

fn roster(mob: M) -> CampRoster {
    CampRoster {
        mob_type: mob,
        elite: None,
        alive: 3,
        state: 0,
        cleared_at: 0.,
        respawn_at: 0.,
    }
}

/// A known mixed build (values of the shape `rh_sim::build_summary` produces for a Holy player with cards and farmed
/// mobs; see crates/rh-sim/src/build_summary_tests.rs).
fn known_summary() -> SummaryView {
    SummaryView {
        gains: [
            12.0,      // Offense (points)
            5.0,       // Soul Offense (points)
            0.0905,    // Damage (fraction)
            0.19,      // Attack speed (fraction)
            0.0337412, // Life steal (fraction, hp-dependent)
            85.0,      // Health (points)
            6.5,       // Defense (points)
            -3.25,     // Soul Defense (points)
            0.06,      // Move speed (fraction)
        ],
        mob_rows: vec![
            SummaryMobRow {
                mob: M::EmberImp,
                stacks: 7,
                stat: HudStat::Damage,
                total: 0.07,
            },
            SummaryMobRow {
                mob: M::Bailiff,
                stacks: 4,
                stat: HudStat::Defense,
                total: 5.0,
            },
            SummaryMobRow {
                mob: M::Acolyte,
                stacks: 8,
                stat: HudStat::LifeSteal,
                total: 0.02,
            },
        ],
    }
}

fn summary_of(items: &[StateItem]) -> Option<Option<rh_protocol::state::WireBuildSummary>> {
    items.iter().find_map(|item| match item {
        StateItem::BuildSummary(v) => Some(v.clone()),
        _ => None,
    })
}

#[test]
fn identities_move_for_the_new_observation_fields() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        30,
        "observation gains camp_hud and summary (25), the champion panel (26, P-WIRE17-HUD-2), its codes 23-27 (27, P-WIRE17-HUD-2c), the owner's clocks and the room minimum (28, P-WIRE17-HUD-3)"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        24,
        "policy projection gains the HUD facts"
    );
}

#[test]
fn camp_rows_carry_the_observed_reward_and_ward_verdict() {
    let mut obs = Observation::default();
    obs.camps = vec![roster(M::EmberImp), roster(M::Bailiff), roster(M::Acolyte)];
    obs.camp_hud = vec![
        CampHudView {
            reward: Some(CampReward {
                stat: HudStat::Damage,
                amount: 0.01,
            }),
            ward: WardVerdict::Yours,
            ward_expires_at: 61_000.,
        },
        CampHudView {
            reward: Some(CampReward {
                stat: HudStat::Defense,
                amount: 1.25,
            }),
            ward: WardVerdict::Other,
            ward_expires_at: 90_500.5,
        },
        CampHudView {
            reward: Some(CampReward {
                stat: HudStat::LifeSteal,
                amount: 0.0025,
            }),
            ward: WardVerdict::None,
            ward_expires_at: 0.,
        },
    ];
    let publisher = CollectionPublisher::default();
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    let items = items(pending.frame.as_ref().expect("full state"));
    let camps = items
        .iter()
        .find_map(|item| match item {
            StateItem::Camps(v) => Some(v.clone()),
            _ => None,
        })
        .expect("camps item");
    assert_eq!(camps.len(), 3);
    let got: Vec<_> = camps.iter().map(|c| (c.reward, c.ward)).collect();
    assert_eq!(
        got,
        vec![
            (
                Some(WireCampReward {
                    stat: 2,
                    amount: 100
                }),
                Some(WireWard {
                    yours: true,
                    expires_at: 61_000.
                })
            ),
            (
                Some(WireCampReward {
                    stat: 6,
                    amount: 12_500
                }),
                Some(WireWard {
                    yours: false,
                    expires_at: 90_500.5
                })
            ),
            (
                Some(WireCampReward {
                    stat: 4,
                    amount: 25
                }),
                None
            ),
        ]
    );
}

/// The one numeric sanity test (loose proof, owner direction 2026-11-10): the known build's summary on the wire equals
/// the observed summary within half a quantum, and the key order and owner rows are as the brief fixes them.
#[test]
fn the_owner_summary_on_the_wire_equals_the_observed_build_within_one_quantum() {
    let mut obs = Observation::default();
    let known = known_summary();
    obs.summary = Some(known.clone());
    let publisher = CollectionPublisher::default();
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    let items = items(pending.frame.as_ref().expect("full state"));
    assert_eq!(
        items.iter().map(StateItem::key).collect::<Vec<_>>(),
        (1..=13).collect::<Vec<_>>(),
        "a full state carries every key, the summary last"
    );
    let wire = summary_of(&items)
        .expect("key 13 present")
        .expect("the owner's summary");
    for (i, (q, v)) in wire.gains.iter().zip(known.gains).enumerate() {
        let back = f64::from(*q) * HUD_QUANTUM;
        assert!(
            (back - v).abs() <= HUD_QUANTUM / 2. + 1e-12,
            "gain {i}: wire {q} -> {back}, observed {v}"
        );
    }
    assert_eq!(wire.gains[7], -32_500, "negative values keep their sign");
    assert_eq!(
        wire.mob_rows,
        vec![
            WireMobBonusRow {
                mob_type: M::EmberImp as u8,
                stat: 2,
                stacks: 7,
                total: 700
            },
            WireMobBonusRow {
                mob_type: M::Bailiff as u8,
                stat: 6,
                stacks: 4,
                total: 50_000
            },
            WireMobBonusRow {
                mob_type: M::Acolyte as u8,
                stat: 4,
                stacks: 8,
                total: 200
            },
        ]
    );
}

#[test]
fn an_unseated_viewer_receives_an_explicit_empty_summary() {
    let obs = Observation::default();
    let publisher = CollectionPublisher::default();
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    let items = items(pending.frame.as_ref().expect("full state"));
    assert_eq!(summary_of(&items), Some(None), "key 13 sent as None");
}

/// Hp-dependent life steal moves every tick; the summary is re-sent only when a quantized value changes, alone.
#[test]
fn the_summary_is_resent_only_when_its_quantized_value_changes() {
    let mut obs = Observation::default();
    obs.summary = Some(known_summary());
    let mut publisher = CollectionPublisher::default();
    publisher
        .prepare(&obs, false, false, false)
        .expect("encodes")
        .commit(&mut publisher);

    obs.tick = 1;
    obs.summary.as_mut().unwrap().gains[4] += HUD_QUANTUM / 10.;
    let quiet = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    assert!(quiet.frame.is_none(), "a sub-quantum change sends nothing");
    quiet.commit(&mut publisher);

    obs.tick = 2;
    obs.summary.as_mut().unwrap().gains[4] += 2. * HUD_QUANTUM;
    let pending = publisher
        .prepare(&obs, false, false, false)
        .expect("encodes");
    let items = items(pending.frame.as_ref().expect("a quantized change is sent"));
    assert_eq!(items.len(), 1, "only the summary is re-sent");
    assert!(matches!(items[0], StateItem::BuildSummary(Some(_))));
}
