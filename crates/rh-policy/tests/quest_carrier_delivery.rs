//! P-WIRE17-MAP-2 oracle (delivery side): the projection copies a quest row's carrier actor id from the observation into
//! State key 10 unchanged (`None` stays absent), and re-sends key 10 when it alone changes (the carrier enters or leaves
//! the viewer's sight). The identities move: the observation's quest row and the projected row gain a field.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_protocol::{ServerMsg, StateItem, WireQuestRow};
use rh_sim::quest_view::QuestView;
use rh_sim::Observation;

/// A quest view with one Fetch row carried by roster 2 (the sim's serde form; its ids have no public constructor).
fn view(carrier_actor: Option<u32>) -> QuestView {
    serde_json::from_value(serde_json::json!({
        "unknown_count": 0,
        "display_unknown_count": 0,
        "owner_roster": 1,
        "roster": [{"id": 1, "label": "owner"}, {"id": 2, "label": "runner"}],
        "rows": [{
            "handle": 3,
            "def": "fetch",
            "name": "N", "giver_label": "G", "brief": "B", "objective": "O", "reward": "R",
            "giver": {"x": 10.0, "y": 20.0},
            "state": "Open",
            "expires_at": 0.0,
            "participants": [{"id": 2, "accepted": true, "progress": 0, "visited": 0}],
            "carrier": 2,
            "carrier_actor": carrier_actor,
            "done_by": null,
            "can_accept": false,
            "owner_accepted": false,
            "owner_progress": 0,
            "owner_visited": 0,
            "owner_completed": false,
            "owner_ready": false
        }],
        "objectives": []
    }))
    .expect("the sim's QuestView serde form")
}

fn obs(carrier_actor: Option<u32>) -> Observation {
    let mut obs = Observation::default();
    obs.quests = Some(view(carrier_actor));
    obs
}

fn quest_row(items: &[StateItem]) -> Option<WireQuestRow> {
    items.iter().find_map(|i| match i {
        StateItem::Quests(Some(v)) => v.rows.first().cloned(),
        _ => None,
    })
}

fn items(frame: &[u8]) -> Vec<StateItem> {
    let ServerMsg::State { items, .. } = ServerMsg::decode(frame).expect("state frame") else {
        panic!("not a state frame")
    };
    items
}

#[test]
fn identities_move_for_the_carrier_actor() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        30,
        "the observed quest row gains the carrier's actor id (P-WIRE17-MAP-2)"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        24,
        "the projected quest row carries it (P-WIRE17-MAP-2)"
    );
}

#[test]
fn the_carrier_actor_rides_in_key_10_unchanged() {
    for actor in [None, Some(1), Some(300), Some((1u32 << 31) - 1)] {
        let pending = CollectionPublisher::default()
            .prepare(&obs(actor), false, false, false)
            .expect("encodes");
        let row = quest_row(&items(pending.frame.as_ref().expect("full state"))).expect("row");
        assert_eq!(row.carrier.map(|r| r.get()), Some(2), "the roster carrier");
        assert_eq!(row.carrier_actor, actor, "actor {actor:?}");
    }
}

#[test]
fn key_10_is_re_sent_when_only_the_carrier_actor_changes() {
    let mut publisher = CollectionPublisher::default();
    let mut hidden = obs(None);
    publisher
        .prepare(&hidden, false, false, false)
        .expect("encodes")
        .commit(&mut publisher);
    hidden.tick = 1;
    let quiet = publisher
        .prepare(&hidden, false, false, false)
        .expect("encodes");
    assert!(quiet.frame.is_none(), "nothing changed, nothing sent");
    quiet.commit(&mut publisher);
    let mut visible = obs(Some(7));
    visible.tick = 2;
    let seen = publisher
        .prepare(&visible, false, false, false)
        .expect("encodes");
    let frame = seen.frame.as_ref().expect("the change is sent");
    let sent = items(frame);
    assert_eq!(sent.len(), 1, "key 10 alone");
    assert_eq!(quest_row(&sent).and_then(|r| r.carrier_actor), Some(7));
}
