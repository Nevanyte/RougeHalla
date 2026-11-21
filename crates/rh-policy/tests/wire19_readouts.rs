//! P-WIRE19-B oracle (projection): the delivery projection puts the observed own readout rows on State key 14 (card as its
//! `CardId` index, kind 0 counter / 1 meter / 2 marks, value and max bit for bit) only when they differ from what the client
//! holds, from an empty baseline, so a viewer without rows (every Legacy world) is never sent key 14, not even in a full
//! or forced State. The decoded view keeps the rows and is complete without key 14. Brief
//! `docs/backlog/packets/P-WIRE19-B.md`.
#![allow(clippy::field_reassign_with_default)]
use rh_policy::delivery::collections::CollectionPublisher;
use rh_policy::delivery::CollectionView;
use rh_protocol::{ServerMsg, StateItem, WireReadout};
use rh_sim::cards::native::{Readout, ReadoutKind};
use rh_sim::cards::CardId;
use rh_sim::Observation;

fn readout(card: CardId, kind: ReadoutKind, value: f64, max: f64) -> Readout {
    Readout {
        card,
        kind,
        value,
        max,
    }
}

fn observation(tick: u32, rows: Vec<Readout>) -> Observation {
    let mut obs = Observation::default();
    obs.tick = tick;
    obs.readouts = rows;
    obs
}

fn three() -> Vec<Readout> {
    vec![
        readout(CardId::MarksmansTally, ReadoutKind::Counter, 0.12, 0.3),
        readout(CardId::Bastion, ReadoutKind::Meter, 40., 250.),
        readout(CardId::Pathfinder, ReadoutKind::Marks, 3., 20.),
    ]
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

fn key_14(items: &[StateItem]) -> Option<&Vec<WireReadout>> {
    items.iter().find_map(|item| match item {
        StateItem::Readouts(rows) => Some(rows),
        _ => None,
    })
}

#[test]
fn the_owners_readouts_reach_key_14_as_card_kind_value_max() {
    let mut publisher = CollectionPublisher::default();
    let (items, _) = publish(&mut publisher, &observation(1, three()), false);
    assert_eq!(
        key_14(&items),
        Some(&vec![
            WireReadout {
                card: 80,
                kind: 0,
                value: 0.12,
                max: 0.3
            },
            WireReadout {
                card: 81,
                kind: 1,
                value: 40.,
                max: 250.
            },
            WireReadout {
                card: 85,
                kind: 2,
                value: 3.,
                max: 20.
            },
        ]),
        "the first State carries the owner's rows"
    );
    assert_eq!(
        items.last().map(StateItem::key),
        Some(14),
        "key 14 is the last item"
    );
}

#[test]
fn key_14_is_sent_on_change_only_and_never_to_a_viewer_without_rows() {
    // A viewer without rows: neither the first (full) State nor a forced one names key 14.
    let mut none = CollectionPublisher::default();
    let (first, frame) = publish(&mut none, &observation(1, vec![]), false);
    assert!(
        frame.is_some() && !first.is_empty(),
        "premise: a full State"
    );
    assert!(
        key_14(&first).is_none(),
        "no rows, no key 14 in a full State"
    );
    for tick in 2..40 {
        let (items, _) = publish(&mut none, &observation(tick, vec![]), tick == 30);
        assert!(key_14(&items).is_none(), "tick {tick}: never key 14");
    }
    // A holder: the rows go out once, again only when they change, and an emptied list is sent once to clear them.
    let mut holder = CollectionPublisher::default();
    let (items, _) = publish(&mut holder, &observation(1, three()), false);
    assert_eq!(key_14(&items).map(Vec::len), Some(3), "the first State");
    let (items, _) = publish(&mut holder, &observation(2, three()), false);
    assert!(key_14(&items).is_none(), "unchanged rows are not resent");
    let mut moved = three();
    moved[0].value = 0.123;
    let (items, _) = publish(&mut holder, &observation(3, moved.clone()), false);
    assert_eq!(
        key_14(&items).map(|rows| rows[0].value),
        Some(0.123),
        "a changed value is resent"
    );
    let (items, _) = publish(&mut holder, &observation(4, moved.clone()), true);
    assert_eq!(
        key_14(&items).map(Vec::len),
        Some(3),
        "a forced State repeats the rows the client holds"
    );
    let (items, _) = publish(&mut holder, &observation(5, vec![]), false);
    assert_eq!(
        key_14(&items).map(Vec::len),
        Some(0),
        "an emptied list clears the client's rows"
    );
    let (items, _) = publish(&mut holder, &observation(6, vec![]), false);
    assert!(key_14(&items).is_none(), "and is not resent");
    // A reconnect starts from an empty baseline again.
    holder.reconnect();
    let (items, _) = publish(&mut holder, &observation(7, moved), false);
    assert_eq!(key_14(&items).map(Vec::len), Some(3), "after a reconnect");
}

#[test]
fn the_decoded_view_keeps_the_rows_and_is_complete_without_key_14() {
    let mut publisher = CollectionPublisher::default();
    let mut view = CollectionView::default();
    let (_, frame) = publish(&mut publisher, &observation(1, vec![]), false);
    view.apply(&ServerMsg::decode(&frame.unwrap()).unwrap())
        .expect("the full State applies");
    assert!(view.complete(), "complete without key 14");
    assert!(view.readouts().is_empty());
    let (_, frame) = publish(&mut publisher, &observation(2, three()), false);
    view.apply(&ServerMsg::decode(&frame.expect("key 14 is sent")).unwrap())
        .expect("key 14 applies");
    assert_eq!(view.readouts().len(), 3, "the decoded view keeps the rows");
    assert_eq!(view.readouts()[1].card, 81);
    assert!(view.complete());
}

#[test]
fn the_wire_bound_is_the_producers_and_the_contract_moves() {
    assert_eq!(
        rh_protocol::state::MAX_READOUTS,
        rh_sim::cards::native::MAX_READOUTS,
        "one bound on both sides"
    );
    assert_eq!(rh_sim::OBSERVATION_VERSION, 35); // 32 -> 33: P-SYNC-ORIGIN-1; 34: P-AUG-NATIVE-5; 35: P-SYNC-ORIGIN-2
    assert_eq!(
        rh_policy::POLICY_CONTRACT_VERSION,
        31,
        "the projected State gains key 14 and the decoded view its rows (P-WIRE19-B); 28: P-SYNC-ORIGIN-1; 29: P-AUG-BOTS-1; 30: P-AUG-NATIVE-5; 27 on origin: P-COLISEUM-HEALS-2; 31: P-SYNC-ORIGIN-2 (protocol 22)"
    );
}
