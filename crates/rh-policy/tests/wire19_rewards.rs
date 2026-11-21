//! P-WIRE19-A oracle (projection): the delivery projection puts a native card option on the wire as its `CardId` index
//! (80..=93) and the observed first-pick window as the row's trailing `first_pick` (its end and this viewer's own `mine`,
//! nothing else); the bots read a native option by its name. Brief `docs/backlog/packets/P-WIRE19-A.md`.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::bots::perception::reward_option_id;
use rh_policy::delivery::collections::CollectionPublisher;
use rh_protocol::{ServerMsg, StateItem, WireFirstPick, WireRewardChest, WireRewardId};
use rh_sim::cards::CardId;
use rh_sim::reward_chests::{
    BoostId, FirstPickView, OptionId, RewardChestHandle, RewardChestView, RewardOptionView,
};
use rh_sim::{Observation, Vec2};

fn view(handle: u32, options: &[OptionId], first_pick: Option<FirstPickView>) -> RewardChestView {
    RewardChestView {
        handle: RewardChestHandle::from_wire(handle).unwrap(),
        at: Vec2::new(100., 120.),
        expires_at: 21_000.,
        options: options
            .iter()
            .map(|id| RewardOptionView {
                id: *id,
                taken: false,
                taken_by: None,
            })
            .collect(),
        picked: false,
        can_choose: first_pick.is_some_and(|f| f.mine),
        first_pick,
    }
}

/// The reward rows of a full State frame published for `obs`.
fn published(obs: &Observation) -> Vec<WireRewardChest> {
    let publisher = CollectionPublisher::default();
    let pending = publisher
        .prepare(obs, true, true, false)
        .expect("the observation encodes (card ids run to 93 on the wire)");
    let ServerMsg::State { items, .. } =
        ServerMsg::decode(pending.frame.as_ref().expect("a full state")).expect("state frame")
    else {
        panic!("not a state frame")
    };
    items
        .into_iter()
        .find_map(|item| match item {
            StateItem::RewardChests(rows) => Some(rows),
            _ => None,
        })
        .expect("a reward chest item")
}

#[test]
fn a_native_option_and_the_window_reach_the_wire_per_viewer() {
    let options = [
        OptionId::Card(CardId::MarkedMan),
        OptionId::Card(CardId::NATIVE[0]),
        OptionId::Boost(BoostId::ALL[2]),
    ];
    for mine in [false, true] {
        let mut obs = Observation::default();
        obs.reward_chests = vec![
            view(
                3,
                &options,
                Some(FirstPickView {
                    until: 11_000.,
                    mine,
                }),
            ),
            view(4, &[OptionId::Card(CardId::ALL[79])], None),
        ];
        let rows = published(&obs);
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[0].options.iter().map(|o| o.id).collect::<Vec<_>>(),
            [
                WireRewardId::Card(93),
                WireRewardId::Card(80),
                WireRewardId::Boost(2)
            ],
            "native ids travel as their CardId index"
        );
        assert_eq!(
            rows[0].first_pick,
            Some(WireFirstPick {
                until: 11_000.,
                mine
            }),
            "mine={mine}: the window's end and this viewer's own flag"
        );
        assert_eq!(rows[0].can_choose, mine);
        assert_eq!(rows[1].first_pick, None, "a row without a window");
        assert_eq!(rows[1].options[0].id, WireRewardId::Card(79));
    }
}

#[test]
fn bots_read_a_native_option_by_its_name() {
    for (i, id) in CardId::NATIVE.iter().enumerate() {
        assert_eq!(
            reward_option_id(&WireRewardId::Card(80 + i as u8)),
            id.as_str(),
            "native index {}",
            80 + i
        );
    }
    assert_eq!(reward_option_id(&WireRewardId::Card(93)), "markedMan");
    assert_eq!(
        reward_option_id(&WireRewardId::Card(79)),
        CardId::ALL[79].as_str()
    );
    assert_eq!(
        reward_option_id(&WireRewardId::Card(94)),
        "",
        "past the native ids"
    );
}

#[test]
fn the_policy_contract_moved_past_25() {
    assert!(
        std::hint::black_box(rh_policy::POLICY_CONTRACT_VERSION) > 25,
        "the projected State key 4 gains native ids and the first-pick window (P-WIRE19-A): POLICY_CONTRACT_VERSION \
         moves past 25 (26, or the next number if P-AUG-NATIVE-1b took 26 first)"
    );
}
