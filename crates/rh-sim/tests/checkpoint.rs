//! Checkpoint scope (docs/CONTRACTS.md C-DET): a checkpoint is `{format, content_hash, build, statics, world}`; per-tick scratch (the action
//! rank, the damage ledger, the melee requests, the bounty snapshot) is never serialized, and a restored match continues
//! bit-identically.

use rh_sim::arenas::practice_arena;
use rh_sim::{
    validate, Command, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};

/// A command through the one door in (C-INPUT): these tests only use valid ones.
fn cmd(raw: RawCommand) -> Command {
    validate(raw).expect("a valid test command")
}
use serde_json::Value;

/// Eight fighters packed into one corner of the practice arena, all swinging at their neighbour.
fn crowded_8() -> Sim {
    let factions = [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Frost,
        FactionId::Holy,
        FactionId::Fire,
    ];
    let ps: Vec<Placement> = factions
        .iter()
        .enumerate()
        .map(|(i, &faction)| Placement {
            profile: format!("p{i}"),
            faction,
            bot: false,
            at: Vec2::new(400.0 + 28.0 * (i % 4) as f64, 400.0 + 28.0 * (i / 4) as f64),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(9),
        &ps,
    )
}

fn drive(sim: &mut Sim, ticks: u32) {
    for t in 0..ticks {
        for i in 1..=8u32 {
            let a = (t as f64 * 0.05) + i as f64;
            let _ = sim.submit(PlayerId(i), cmd(RawCommand::Aim { a }));
            if t % 7 == 0 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Attack { a, t: None }));
            }
            if t % 7 == 3 {
                let _ = sim.submit(PlayerId(i), cmd(RawCommand::Release { a, t: None }));
            }
        }
        sim.step();
    }
}

fn keys(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

#[test]
fn a_checkpoint_contains_no_scratch_keys() {
    let mut sim = crowded_8();
    drive(&mut sim, 100);
    assert!(
        sim.players().iter().any(|p| p.vitals.hp < p.vitals.max_hp),
        "the crowd fought, so the ledger and melee scratch were used"
    );
    let json = serde_json::to_value(&sim).unwrap();
    let mut all = Vec::new();
    keys(&json, &mut all);
    for banned in [
        "rank",
        "ledger",
        "melee",
        "stepping",
        "bounty_at_tick_start",
        "downed_this_tick",
        "scratch",
    ] {
        assert!(
            !all.iter().any(|k| k == banned),
            "a checkpoint must not carry the scratch key `{banned}`"
        );
    }
    assert_eq!(json["format"], "rh-checkpoint/18");
    let top: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert_eq!(
        top.len(),
        5,
        "format, content_hash, build, statics, world: {top:?}"
    );
}

#[test]
fn a_mid_fight_checkpoint_continues_identically() {
    let mut a = crowded_8();
    drive(&mut a, 100);
    let mut b = Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    assert_eq!(a.state_hash(), b.state_hash());
    for sim in [&mut a, &mut b] {
        drive(sim, 120);
    }
    assert_eq!(a.state_hash(), b.state_hash());
}

/// Reorders the three top-level keys of a checkpoint document (as text, so the order is the order on the wire).
fn reordered(json: &Value, order: [&str; 3]) -> String {
    let parts: Vec<String> = order
        .iter()
        .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), json[k]))
        .collect();
    format!("{{{}}}", parts.join(","))
}

#[test]
fn the_format_tag_is_refused_before_the_payload_whatever_the_key_order() {
    use rh_sim::CheckpointError;
    let mut a = crowded_8();
    drive(&mut a, 30);
    let good = serde_json::to_value(&a).unwrap();
    // Every order restores a good checkpoint, identically.
    for order in [
        ["format", "statics", "world"],
        ["world", "statics", "format"],
        ["statics", "world", "format"],
        ["world", "format", "statics"],
    ] {
        let text = reordered(&good, order);
        let b = Sim::restore(&mut serde_json::Deserializer::from_str(&text))
            .unwrap_or_else(|e| panic!("{order:?}: {e}"));
        assert_eq!(b.state_hash(), a.state_hash(), "{order:?}");
    }
    let mut prior = good.clone();
    prior["format"] = "rh-checkpoint/8".into();
    assert_eq!(
        Sim::restore(prior).err(),
        Some(CheckpointError::UnsupportedFormat {
            found: "rh-checkpoint/8".into()
        })
    );
    // A stale layout under a stale tag is refused by its tag, wherever the tag is, even though its payload would not parse.
    let mut stale = good.clone();
    stale["format"] = "rh-checkpoint/2".into();
    stale["world"] = serde_json::json!({"players": [{"id": 1, "x": 0.0}], "tick": "soon"});
    stale["statics"] = serde_json::json!([1, 2, 3]);
    for order in [
        ["format", "statics", "world"],
        ["world", "statics", "format"],
        ["statics", "world", "format"],
    ] {
        let text = reordered(&stale, order);
        assert_eq!(
            Sim::restore(&mut serde_json::Deserializer::from_str(&text)).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/2".into()
            }),
            "{order:?}"
        );
    }
    // No tag at all, payload last or first: still MissingFormat, not a payload error.
    for order in [
        ["world", "statics", "format"],
        ["statics", "world", "format"],
    ] {
        let mut text = reordered(&stale, order);
        text = text.replace("\"format\":\"rh-checkpoint/2\"", "\"other\":1");
        assert_eq!(
            Sim::restore(&mut serde_json::Deserializer::from_str(&text)).err(),
            Some(CheckpointError::MissingFormat),
            "{order:?}"
        );
    }
    // A good tag over a broken payload is Malformed, in either order.
    let mut broken = good.clone();
    broken["world"] = serde_json::json!({"tick": "soon"});
    for order in [
        ["format", "statics", "world"],
        ["world", "statics", "format"],
    ] {
        let text = reordered(&broken, order);
        assert!(matches!(
            Sim::restore(&mut serde_json::Deserializer::from_str(&text)),
            Err(CheckpointError::Malformed(_))
        ));
    }
}

#[test]
fn a_truncated_or_garbled_checkpoint_is_an_error_never_a_panic() {
    let mut a = crowded_8();
    drive(&mut a, 20);
    let text = serde_json::to_string(&a).unwrap();
    let step = text.len() / 97 + 1;
    for cut in (0..text.len()).step_by(step) {
        let r = Sim::restore(&mut serde_json::Deserializer::from_str(&text[..cut]));
        assert!(r.is_err(), "cut at {cut} of {}", text.len());
    }
    for junk in [
        "",
        "null",
        "[]",
        "42",
        "\"rh-checkpoint/18\"",
        "{}",
        "{\"format\":3}",
    ] {
        assert!(Sim::restore(&mut serde_json::Deserializer::from_str(junk)).is_err());
    }
    // Structurally valid, semantically broken parts: a map of the wrong shape, a store out of order, a ring too long.
    let good = serde_json::to_value(&a).unwrap();
    let mut v = good.clone();
    v["statics"]["arena"]["map"]["tiles"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(Sim::restore(&v).is_err(), "map shape");
    let mut v = good.clone();
    v["world"]["players"].as_array_mut().unwrap().reverse();
    assert!(Sim::restore(&v).is_err(), "store order");
    let mut v = good;
    let h = v["world"]["players"][0]["core"]["body"]["history"].clone();
    let long = serde_json::Value::Array(
        h.as_array()
            .unwrap()
            .iter()
            .cycle()
            .take(500)
            .cloned()
            .collect(),
    );
    v["world"]["players"][0]["core"]["body"]["history"] = long;
    assert!(Sim::restore(&v).is_err(), "history ring");
}

#[test]
fn a_checkpoint_whose_next_id_is_not_past_the_last_player_is_malformed_not_a_panic() {
    use rh_sim::CheckpointError;
    let mut a = crowded_8();
    drive(&mut a, 5);
    let good: Value = serde_json::to_value(&a).unwrap();
    let last = good["world"]["next_id"].as_u64().unwrap() - 1;
    assert!(last >= 1, "the crowded match has players");
    for bad in [last, 1, 0] {
        let mut v = good.clone();
        v["world"]["next_id"] = serde_json::json!(bad);
        let r = Sim::restore(v);
        assert!(
            matches!(r, Err(CheckpointError::Malformed(ref m)) if m.contains("next_id")),
            "next_id {bad}: {:?}",
            r.err()
        );
    }
    // The honest value restores.
    let ok = Sim::restore(good).unwrap();
    assert_eq!(ok.state_hash(), a.state_hash());
}

#[test]
fn a_checkpoint_names_its_content_and_build_and_refuses_other_content() {
    use rh_sim::CheckpointError;
    let mut a = crowded_8();
    drive(&mut a, 10);
    let good = serde_json::to_value(&a).unwrap();
    let content = rh_sim::content::content_hash();
    assert_eq!(good["content_hash"], content);
    assert_eq!(good["build"], rh_sim::replay::BUILD_ID);
    assert!(serde_json::to_string(&a)
        .unwrap()
        .starts_with("{\"format\":\"rh-checkpoint/18\",\"content_hash\":"));
    assert!(Sim::restore(&good).is_ok());

    // Other content: refused with the typed error, whichever side of the tag it arrives on, and even when the payload
    // of that content's checkpoint would not parse.
    let mut other = good.clone();
    other["content_hash"] = (content ^ 1).into();
    let expect = CheckpointError::ContentMismatch {
        checkpoint: content ^ 1,
        build: content,
    };
    assert_eq!(Sim::restore(&other).err(), Some(expect.clone()));
    other["world"] = Value::from("not a world");
    assert_eq!(Sim::restore(&other).err(), Some(expect.clone()));
    let text = format!(
        "{{\"world\":1,\"content_hash\":{},\"format\":\"rh-checkpoint/18\"}}",
        content ^ 1
    );
    assert_eq!(
        Sim::restore(&mut serde_json::Deserializer::from_str(&text)).err(),
        Some(expect)
    );

    // The REAL serialized key order (format, content_hash, build, statics, world): other content with a world that does
    // not parse is still refused as other content, not as malformed.
    let mut text = serde_json::to_string(&a).unwrap().replace(
        &format!("\"content_hash\":{content}"),
        &format!("\"content_hash\":{}", content ^ 1),
    );
    let at = text.find("\"world\":").unwrap();
    text.truncate(at);
    text.push_str("\"world\":\"not a world\"}");
    assert_eq!(
        Sim::restore(&mut serde_json::Deserializer::from_str(&text)).err(),
        Some(CheckpointError::ContentMismatch {
            checkpoint: content ^ 1,
            build: content
        })
    );
    // Another layout's `content_hash` need not be a number: its tag decides, not the shape of this key.
    let text = "{\"content_hash\":\"x\",\"format\":\"rh-checkpoint/1\"}";
    assert!(matches!(
        Sim::restore(&mut serde_json::Deserializer::from_str(text)).err(),
        Some(CheckpointError::UnsupportedFormat { .. })
    ));

    // A checkpoint written before the keys existed still restores (it cannot be compared).
    let mut old = good.clone();
    old.as_object_mut().unwrap().remove("content_hash");
    old.as_object_mut().unwrap().remove("build");
    let b = Sim::restore(&old).expect("an older checkpoint without the keys restores");
    assert_eq!(a.state_hash(), b.state_hash());
}
