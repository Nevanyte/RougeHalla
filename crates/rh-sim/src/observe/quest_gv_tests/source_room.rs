//! One captured producer batch through native observation projection; no native Room/session is constructed.
//! Source broadcasts remain recorded public calls, never invented per-client source delivery rows.
use super::*;
use serde_json::Value as V;
fn source() -> V {
    serde_json::from_str(include_str!(
        "../../../../../parity/quest-room-feedback/source.json"
    ))
    .unwrap()
}
fn bind(alias: &V) -> PlayerId {
    // Declared fixture identity mapping, independent of decorative labels and native/private wire namespaces.
    match alias.as_str().unwrap() {
        "p0" => PlayerId(101),
        "p1" => PlayerId(202),
        "p2" => PlayerId(303),
        other => panic!("unmapped source identity {other}"),
    }
}
fn input(v: &V) -> Vec<Event> {
    v["input"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| match event["type"].as_str().unwrap() {
            "gv" => {
                assert_eq!(event["reason"], "quest");
                Event::Gv {
                    id: bind(&event["id"]),
                    amount: u32::try_from(event["amount"].as_u64().unwrap()).unwrap(),
                    reason: GvReason::Quest,
                }
            }
            "toast" => Event::Toast {
                to: (!event["to"].is_null()).then(|| bind(&event["to"])),
                text: event["text"].as_str().unwrap().into(),
            },
            other => panic!("unexpected captured completion input {other}"),
        })
        .collect()
}
fn source_calls(receiver: &V, viewer: Option<PlayerId>) -> Vec<&str> {
    receiver["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| {
            row["route"] == "broadcast"
                || (row["route"] == "client" && viewer == Some(bind(&row["recipient"])))
        })
        .map(|row| {
            assert_eq!(row["type"], "toast");
            row["payload"]["text"].as_str().unwrap()
        })
        .collect()
}
#[test]
fn actual_room_completion_calls_match_native_owner_and_foreign_text_order() {
    let source = source();
    assert_eq!(source["format"], "rh-quest-room-feedback/1");
    assert_eq!(
        source["input"]["sha256"],
        "039d4e058fa914f42080f1c55d8640cc508c5b4745504930ca3db49579adc8b4"
    );
    assert_eq!(
        source["input"]["rawEventsSha256"],
        "6e40908a3cf563b1d5778b185129c829218af6fd80c903a8a1605552563e7a26"
    );
    assert_eq!(source["input"]["caseName"], "completion-retirement");
    assert_eq!(source["input"]["frameLabel"], "turned-in");
    assert_eq!(source["input"]["tick"], 8);
    assert_eq!(source["input"]["time"], 400);
    let original: V = serde_json::from_str(include_str!(
        "../../../../../parity/quest-giver/source.json"
    ))
    .unwrap();
    assert_eq!(
        source["input"]["events"],
        original["cases"][7]["frames"][8]["events"]
    );
    let events = input(&source);
    assert_eq!(events.len(), 4);
    assert!(matches!(
        events[0],
        Event::Gv {
            id: PlayerId(101),
            amount: 10,
            reason: GvReason::Quest
        }
    ));
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, Event::Gv { .. }))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, Event::Toast { .. }))
            .count(),
        3
    );
    let before = serde_json::to_value(&events).unwrap();
    let receivers = source["receivers"].as_array().unwrap();
    assert_eq!(
        receivers[0]["name"],
        "genuine-completion-batch-human-receiver"
    );
    assert_eq!(receivers[1]["name"], "duplicate-label-route-control");
    assert_eq!(
        receivers[1]["dependencies"]["clients"][0]["label"],
        receivers[1]["dependencies"]["clients"][1]["label"]
    );
    for receiver in &receivers[..2] {
        for viewer in [
            Some(PlayerId(101)),
            Some(PlayerId(202)),
            Some(PlayerId(303)),
            None,
        ] {
            let observed = projected(&events, viewer);
            let text = observed
                .iter()
                .map(|event| match event {
                    SeenEvent::Toast { text } => text.as_str(),
                    other => panic!("unexpected native projection {other:?}"),
                })
                .collect::<Vec<_>>();
            // Compare actual ordered private sends + the one actual public broadcast CALL. This does not
            // fabricate Colyseus fanout, source sockets, a native session or an independent gameplay replay.
            assert_eq!(
                text,
                source_calls(receiver, viewer),
                "{} {viewer:?}",
                receiver["name"]
            );
        }
    }
    assert_eq!(
        serde_json::to_value(&events).unwrap(),
        before,
        "projection preserves raw banking/diagnostic events"
    );
}
#[test]
fn missing_owner_and_bot_receipts_are_dispatch_controls_only() {
    let source = source();
    let receivers = source["receivers"].as_array().unwrap();
    assert_eq!(receivers.len(), 4);
    let missing = &receivers[2];
    assert_eq!(missing["name"], "missing-owner-route-control");
    assert!(missing["role"]
        .as_str()
        .unwrap()
        .starts_with("declared dispatch control"));
    assert_eq!(missing["rows"].as_array().unwrap().len(), 1);
    assert_eq!(missing["rows"][0]["route"], "broadcast");
    assert_eq!(
        missing["clientLookups"],
        serde_json::json!(["p0", "p0", "p0"])
    );
    let bot = &receivers[3];
    assert_eq!(bot["name"], "bot-onToast-route-control");
    assert!(bot["role"]
        .as_str()
        .unwrap()
        .contains("not bot quest eligibility/production"));
    assert_eq!(
        bot["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["route"] == "bot.onToast")
            .count(),
        3
    );
    assert_eq!(bot["rows"][3]["route"], "broadcast");
    assert!(bot["clientLookups"].as_array().unwrap().is_empty());
    // Deliberately no native Room/client-absence or bot quest producer is inferred or manufactured here.
}
