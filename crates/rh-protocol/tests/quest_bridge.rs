use rh_protocol::*;

fn quest(id: u32) -> QuestHandle {
    QuestHandle::new(id).unwrap()
}
fn roster(id: u32) -> RosterId {
    RosterId::new(id).unwrap()
}

fn view() -> WireQuestView {
    WireQuestView {
        unknown_count: 0,
        display_unknown_count: 0,
        owner_roster: Some(roster(7)),
        roster: vec![WireRosterEntry {
            id: roster(7),
            label: "owner".into(),
        }],
        rows: vec![WireQuestRow {
            handle: quest(11),
            def: "collect".into(),
            giver: WireQuestPoint { x: 10.0, y: 20.0 },
            state: 1,
            expires_at: 100.0,
            participants: vec![WireQuestParticipant {
                id: roster(7),
                accepted: true,
                progress: 2,
                visited: 1,
            }],
            carrier: None,
            carrier_actor: None,
            done_by: None,
            can_accept: true,
            owner_accepted: false,
            owner_progress: 2,
            owner_visited: 1,
            name: "Gather".into(),
            giver_label: "Keeper".into(),
            brief: "Collect the item".into(),
            objective: "Find one".into(),
            reward: "A token".into(),
            owner_completed: false,
            owner_ready: false,
        }],
        objectives: vec![WireQuestObjective {
            quest: quest(11),
            at: WireQuestPoint { x: 30.0, y: 40.0 },
        }],
    }
}

#[test]
fn quest_accept_has_a_distinct_nonzero_handle_and_round_trips() {
    let msg = ClientMsg::Input {
        seq: 9,
        commands: vec![WireCommand::QuestAccept {
            handle: quest(u32::MAX),
        }],
    };
    assert_eq!(ClientMsg::decode(&msg.encode()).unwrap(), msg);
}

#[test]
fn quest_rows_and_explicit_unavailable_empty_views_round_trip() {
    let available = ServerMsg::State {
        tick: 5,
        items: vec![StateItem::Quests(Some(view()))],
    };
    assert_eq!(ServerMsg::decode(&available.encode()).unwrap(), available);
    for value in [None, Some(WireQuestView::default())] {
        let msg = ServerMsg::State {
            tick: 6,
            items: vec![StateItem::Quests(value)],
        };
        assert_eq!(ServerMsg::decode(&msg.encode()).unwrap(), msg);
    }
}

#[test]
fn quest_prop_validation_checks_any_supplied_view_and_cross_references() {
    let props = WireProps::default();
    let mut invalid = view();
    invalid.unknown_count = 21;
    assert_eq!(
        validate_quest_props(&props, Some(&invalid)),
        Err(EncodeError::BadValue("quest counts"))
    );

    let item = WireProps {
        rows: vec![WireProp {
            handle: PickupHandle::new(3).unwrap(),
            x: 10,
            y: 20,
            kind: WirePropKind::QuestItem {
                quest: quest(11),
                fetch: false,
            },
        }],
        focus: None,
    };
    assert!(validate_quest_props(&item, Some(&view())).is_ok());
    assert_eq!(
        validate_quest_props(&item, None),
        Err(EncodeError::BadValue("quest prop reference"))
    );
    let unavailable = ServerMsg::State {
        tick: 1,
        items: vec![StateItem::Props(item), StateItem::Quests(None)],
    };
    assert!(unavailable.try_encode().is_err());
}

#[test]
fn overlong_done_by_is_refused_by_encoder() {
    let mut bad = view();
    bad.rows[0].done_by = Some("x".repeat(256));
    let msg = ServerMsg::State {
        tick: 7,
        items: vec![StateItem::Quests(Some(bad))],
    };
    assert_eq!(
        msg.try_encode(),
        Err(EncodeError::StringTooLong {
            what: "quest done_by",
            len: 256
        })
    );
}
