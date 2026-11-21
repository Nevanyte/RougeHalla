//! P-AUG-NATIVE-5 oracle (projection): the delivery projection puts the observed Marked Man rows on State key 15 (id as
//! the player id, position at the actor quantization) only when the quantized rows differ from what the client holds, from
//! an empty baseline, so a world without a holder (every Legacy world) is never sent key 15, not even in a full or forced
//! State, and a sub-quantum move is not resent. The decoded view keeps the rows and is complete without key 15. Brief
//! `docs/backlog/packets/P-AUG-NATIVE-5.md`.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_policy::delivery::CollectionView;
use rh_protocol::{ServerMsg, StateItem, WireMarked};
use rh_sim::observe::MarkedView;
use rh_sim::{Observation, PlayerId};

fn view(id: u32, x: f64, y: f64) -> MarkedView {
    MarkedView {
        id: PlayerId(id),
        x,
        y,
    }
}

fn observation(tick: u32, rows: Vec<MarkedView>) -> Observation {
    let mut obs = Observation::default();
    obs.tick = tick;
    obs.marked = rows;
    obs
}

fn two() -> Vec<MarkedView> {
    vec![view(2, 100., 2000.5), view(7, 640.25, 96.)]
}

/// Prepares and commits one State for `obs`; returns the decoded items (empty when nothing was sent) and the frame.
fn publish(
    publisher: &mut CollectionPublisher,
    obs: &Observation,
    resync: bool,
) -> (Vec<StateItem>, Option<Vec<u8>>) {
    let pending = publisher
        .prepare(obs, false, false, resync)
        .expect("the observation encodes");
    let frame = pending.frame.clone();
    pending.commit(publisher);
    let items = match frame.as_ref() {
        None => Vec::new(),
        Some(bytes) => match ServerMsg::decode(bytes).expect("a decodable State") {
            ServerMsg::State { items, .. } => items,
            other => panic!("not a State: {other:?}"),
        },
    };
    (items, frame)
}

fn key_15(items: &[StateItem]) -> Option<&Vec<WireMarked>> {
    items.iter().find_map(|item| match item {
        StateItem::Marked(rows) => Some(rows),
        _ => None,
    })
}

#[test]
fn the_holders_reach_key_15_as_id_and_position() {
    let mut publisher = CollectionPublisher::default();
    let (items, _) = publish(&mut publisher, &observation(1, two()), false);
    assert_eq!(
        key_15(&items),
        Some(&vec![
            WireMarked {
                id: 2,
                x: 100.,
                y: 2000.5
            },
            WireMarked {
                id: 7,
                x: 640.25,
                y: 96.
            },
        ]),
        "the first State carries every holder"
    );
    assert_eq!(
        items.last().map(StateItem::key),
        Some(15),
        "key 15 is the last item"
    );
}

#[test]
fn key_15_is_sent_on_change_only_and_never_without_a_holder() {
    // No holder: neither the first (full) State nor a forced one names key 15.
    let mut none = CollectionPublisher::default();
    let (first, frame) = publish(&mut none, &observation(1, vec![]), false);
    assert!(
        frame.is_some() && !first.is_empty(),
        "premise: a full State"
    );
    assert!(key_15(&first).is_none(), "no holder, no key 15");
    for tick in 2..40 {
        let (items, _) = publish(&mut none, &observation(tick, vec![]), tick == 30);
        assert!(key_15(&items).is_none(), "tick {tick}: never key 15");
    }
    // A holder: the rows go out once, again only when a quantized position changes, and an emptied list once.
    let mut holder = CollectionPublisher::default();
    let (items, _) = publish(&mut holder, &observation(1, two()), false);
    assert_eq!(key_15(&items).map(Vec::len), Some(2), "the first State");
    let (items, _) = publish(&mut holder, &observation(2, two()), false);
    assert!(key_15(&items).is_none(), "unchanged rows are not resent");
    let mut nudged = two();
    nudged[0].x += 0.01;
    let (items, _) = publish(&mut holder, &observation(3, nudged), false);
    assert!(
        key_15(&items).is_none(),
        "a move under the 1/8 u quantum is not resent"
    );
    let mut moved = two();
    moved[1].y += 32.;
    let (items, _) = publish(&mut holder, &observation(4, moved.clone()), false);
    assert_eq!(
        key_15(&items).map(|rows| rows[1].y),
        Some(128.),
        "a moved holder is resent"
    );
    let (items, _) = publish(&mut holder, &observation(5, moved.clone()), true);
    assert_eq!(
        key_15(&items).map(Vec::len),
        Some(2),
        "a forced State repeats the rows the client holds"
    );
    let (items, _) = publish(&mut holder, &observation(6, vec![]), false);
    assert_eq!(
        key_15(&items).map(Vec::len),
        Some(0),
        "an emptied list clears the client's rows"
    );
    let (items, _) = publish(&mut holder, &observation(7, vec![]), false);
    assert!(key_15(&items).is_none(), "and is not resent");
    holder.reconnect();
    let (items, _) = publish(&mut holder, &observation(8, moved), false);
    assert_eq!(key_15(&items).map(Vec::len), Some(2), "after a reconnect");
}

#[test]
fn the_decoded_view_keeps_the_rows_and_is_complete_without_key_15() {
    let mut publisher = CollectionPublisher::default();
    let mut view = CollectionView::default();
    let (_, frame) = publish(&mut publisher, &observation(1, vec![]), false);
    view.apply(&ServerMsg::decode(&frame.unwrap()).unwrap())
        .expect("the full State applies");
    assert!(view.complete(), "complete without key 15");
    assert!(view.marked().is_empty());
    let (_, frame) = publish(&mut publisher, &observation(2, two()), false);
    view.apply(&ServerMsg::decode(&frame.expect("key 15 is sent")).unwrap())
        .expect("key 15 applies");
    assert_eq!(view.marked().len(), 2, "the decoded view keeps the rows");
    assert_eq!(view.marked()[1].id, 7);
    let (_, frame) = publish(&mut publisher, &observation(3, vec![]), false);
    view.apply(&ServerMsg::decode(&frame.expect("the clear is sent")).unwrap())
        .expect("an empty key 15 applies");
    assert!(view.marked().is_empty(), "an empty key 15 clears the rows");
}

#[test]
fn the_versions_move() {
    assert_eq!(
        rh_sim::OBSERVATION_VERSION,
        35,
        "Observation gains `marked` (P-AUG-NATIVE-5); 35: P-SYNC-ORIGIN-2"
    );
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        31,
        "the projected State gains key 15 and the decoded view its rows (P-AUG-NATIVE-5; 29 was P-AUG-BOTS-1); 31: P-SYNC-ORIGIN-2"
    );
}
