//! P-WIRE17-MAP-2 oracle (State key 10): the quest row names its carrier's public actor id.
//!
//! Row layout (docs/backlog/packets/P-WIRE17-MAP-2.md "Wire layout"): unchanged up to the flags byte; flag `0x10` means
//! "carrier actor present" and a varint actor id (non-zero) follows the flags byte, before `owner_progress`. A row
//! without it is byte-identical to the row before this packet. Refusals: flag 0x10 on a row whose carrier is 0 is
//! `BadField("quest flags")` (the existing `state_quest_flags_unknown` vector is that case and keeps its reason); an actor id
//! of 0 is `BadField("quest carrier actor")`; bits 0x20..0x80 stay `"quest flags"`. The encoder refuses a carrier actor
//! without a carrier, and an actor id of 0, with `BadValue("quest carrier actor")`.

use rh_protocol::samples::{malformed_server, server_samples};
use rh_protocol::*;

fn quest(id: u32) -> QuestHandle {
    QuestHandle::new(id).unwrap()
}
fn roster(id: u32) -> RosterId {
    RosterId::new(id).unwrap()
}

fn view(carrier: Option<RosterId>, carrier_actor: Option<u32>) -> WireQuestView {
    WireQuestView {
        unknown_count: 0,
        display_unknown_count: 0,
        owner_roster: Some(roster(7)),
        roster: vec![
            WireRosterEntry {
                id: roster(7),
                label: "owner".into(),
            },
            WireRosterEntry {
                id: roster(8),
                label: "runner".into(),
            },
        ],
        rows: vec![WireQuestRow {
            handle: quest(11),
            def: "fetch".into(),
            giver: WireQuestPoint { x: 10.0, y: 20.0 },
            state: 1,
            expires_at: 100.0,
            participants: vec![WireQuestParticipant {
                id: roster(8),
                accepted: true,
                progress: 0,
                visited: 0,
            }],
            carrier,
            carrier_actor,
            done_by: None,
            can_accept: true,
            owner_accepted: false,
            owner_progress: 2,
            owner_visited: 1,
            name: "N".into(),
            giver_label: "G".into(),
            brief: "B".into(),
            objective: "O".into(),
            reward: "R".into(),
            owner_completed: false,
            owner_ready: false,
        }],
        objectives: vec![],
    }
}

fn state(view: WireQuestView) -> ServerMsg {
    ServerMsg::State {
        tick: 5,
        items: vec![StateItem::Quests(Some(view))],
    }
}

/// The State frame by hand: `0x88, tick 5, one item, key 10, available 1`, the view with one row whose flags byte is
/// `flags` and, when `actor` is given, a varint actor id after it.
fn raw(carrier: u32, flags: u8, actor: Option<&[u8]>) -> Vec<u8> {
    let mut w = Writer::default();
    w.u8(0x88);
    w.varint(5);
    w.varint(1);
    w.varint(10);
    w.u8(1);
    w.varint(0); // unknown
    w.varint(0); // display unknown
    w.varint(7); // owner roster
    w.varint(2);
    w.varint(7);
    w.str("owner");
    w.varint(8);
    w.str("runner");
    w.varint(1); // rows
    w.varint(11);
    w.str("fetch");
    w.f64(10.0);
    w.f64(20.0);
    w.u8(1);
    w.f64(100.0);
    w.varint(1);
    w.varint(8);
    w.u8(1);
    w.varint(0);
    w.u8(0);
    w.varint(carrier);
    w.u8(0); // done_by absent
    w.u8(flags);
    if let Some(bytes) = actor {
        w.bytes(bytes);
    }
    w.varint(2); // owner progress
    w.u8(1); // owner visited
    for s in ["N", "G", "B", "O", "R"] {
        w.str(s);
    }
    w.varint(0); // objectives
    w.finish()
}

fn first_row(msg: &ServerMsg) -> &WireQuestRow {
    let ServerMsg::State { items, .. } = msg else {
        panic!("state")
    };
    // The quest item is found by kind, not by position: state keys are sent in ascending order, so a vector that
    // also carries props (key 2) has them before the quests (key 10).
    let view = items
        .iter()
        .find_map(|item| match item {
            StateItem::Quests(Some(view)) => Some(view),
            _ => None,
        })
        .expect("quests");
    &view.rows[0]
}

#[test]
fn a_visible_carrier_rides_after_the_flags_byte() {
    // can_accept (0x01) | carrier actor present (0x10); actor 300 is a two-byte varint.
    let want = raw(8, 0x11, Some(&[0xac, 0x02]));
    let msg = state(view(Some(roster(8)), Some(300)));
    assert_eq!(msg.try_encode().expect("encodes"), want, "pinned layout");
    let back = ServerMsg::decode(&want).expect("decodes");
    assert_eq!(first_row(&back).carrier_actor, Some(300));
    assert_eq!(back, msg);
}

#[test]
fn guard_rows_without_a_carrier_actor_keep_their_bytes() {
    for carrier in [None, Some(roster(8))] {
        let id = carrier.map_or(0, RosterId::get);
        let msg = state(view(carrier, None));
        assert_eq!(msg.try_encode().expect("encodes"), raw(id, 0x01, None));
        assert_eq!(ServerMsg::decode(&raw(id, 0x01, None)).as_ref(), Ok(&msg));
    }
}

#[test]
fn the_decoder_refuses_an_actor_where_the_row_has_no_carrier_or_a_zero_actor() {
    assert_eq!(
        ServerMsg::decode(&raw(0, 0x11, Some(&[5]))),
        Err(DecodeError::BadField("quest flags")),
        "flag 0x10 on a row without a carrier"
    );
    assert_eq!(
        ServerMsg::decode(&raw(8, 0x11, Some(&[0]))),
        Err(DecodeError::BadField("quest carrier actor")),
        "actor 0"
    );
    assert_eq!(
        ServerMsg::decode(&raw(8, 0x21, None)),
        Err(DecodeError::BadField("quest flags")),
        "bit 0x20 stays unknown"
    );
    // The flag set but the frame cut where the actor would be (no owner progress or later fields follow).
    let mut cut = raw(8, 0x11, None);
    let flags_at = cut.iter().rposition(|&b| b == 0x11).unwrap();
    cut.truncate(flags_at + 1);
    assert_eq!(
        ServerMsg::decode(&cut),
        Err(DecodeError::Truncated),
        "cut after the flags byte"
    );
}

#[test]
fn the_encoder_refuses_an_actor_without_a_carrier_or_a_zero_actor() {
    for (carrier, actor) in [(None, Some(5)), (Some(roster(8)), Some(0))] {
        assert!(
            matches!(
                state(view(carrier, actor)).try_encode(),
                Err(EncodeError::BadValue("quest carrier actor"))
            ),
            "carrier {carrier:?}, actor {actor:?}"
        );
    }
}

#[test]
fn guard_the_old_flags_vector_keeps_its_reason() {
    // `state_quest_flags_unknown`: flag 0x10 on a row with carrier 0, now "an actor where the row says none".
    let all = malformed_server();
    let (_, bytes) = all
        .iter()
        .find(|(n, _)| *n == "state_quest_flags_unknown")
        .expect("existing vector");
    assert_eq!(
        ServerMsg::decode(bytes),
        Err(DecodeError::BadField("quest flags"))
    );
}

#[test]
fn the_server_vectors_carry_a_visible_and_a_hidden_carrier() {
    let samples = server_samples();
    let row = |name: &str| -> WireQuestRow {
        let (_, msg) = samples
            .iter()
            .find(|(n, _)| *n == name)
            .unwrap_or_else(|| panic!("samples.rs has no {name} (P-WIRE17-MAP-2 adds it)"));
        first_row(msg).clone()
    };
    let visible = row("state_quests_carrier_visible");
    assert_eq!(
        (visible.carrier.map(RosterId::get), visible.carrier_actor),
        (Some(7), Some(5)),
        "carrier roster 7 seen as actor 5"
    );
    let hidden = row("state_quests_carrier_hidden");
    assert_eq!(
        (hidden.carrier.map(RosterId::get), hidden.carrier_actor),
        (Some(7), None),
        "carrier roster 7, unseen"
    );
    let none = row("state_quests_available");
    assert_eq!(
        (none.carrier, none.carrier_actor),
        (None, None),
        "no carrier"
    );
}
