//! The differential gate: every `parity: "slice"` legacy fixture must replay identically through the Rust core.

use rh_parity::*;

#[test]
fn every_slice_fixture_matches_legacy() {
    let all = scenario_paths();
    let fixtures = scenarios("slice");
    // The original 13 slice scenarios plus the budget-admission case must not vanish quietly.
    assert!(
        fixtures.len() >= 14,
        "expected at least 14 captured slice fixtures, found {}",
        fixtures.len()
    );
    assert_eq!(
        all.len(),
        fixtures.len() + scenarios("capture-only").len(),
        "every scenario fixture is either slice or capture-only"
    );
    let mut failed = Vec::new();
    for fx in &fixtures {
        let rep = compare(fx);
        eprintln!(
            "{:<22} ticks {:>4} events {:>5} results {} max pos err {:.2e} max hp err {:.2e} {}",
            fx.scenario,
            rep.ticks,
            rep.events,
            rep.results,
            rep.max_pos_err,
            rep.max_hp_err,
            if rep.mismatches.is_empty() {
                "OK"
            } else {
                "MISMATCH"
            }
        );
        if !rep.mismatches.is_empty() {
            failed.push(format!(
                "{}:\n  {}",
                fx.scenario,
                rep.mismatches.join("\n  ")
            ));
        }
    }
    assert!(failed.is_empty(), "parity failures:\n{}", failed.join("\n"));
}

#[test]
fn pathfinding_matches_legacy_on_a_generated_map() {
    let (n, bad) = compare_paths(&fixtures_dir().join("pathfinding_seed1.json"));
    assert_eq!(n, 300);
    assert!(bad.is_empty(), "path mismatches:\n{}", bad.join("\n"));
}

#[test]
fn a_changed_rule_is_caught() {
    // The harness must not hide a changed rule: fight the duel with another faction (other damage, other mitigation)
    // and the comparison must fail; replay the brawl under another secret order salt and it must fail too.
    // A legacy rule change from a 7% block to a 9% block scales the passive
    // riposte by 9/7; every other recorded field stays unchanged. The first
    // mismatch must identify the amount of that hit, not a metadata mismatch.
    let mut shield = load(&fixtures_dir().join("shield_block_riposte.json"));
    let tick = shield
        .ticks
        .iter_mut()
        .find(|t| t.events.iter().any(|e| e["passive"] == true))
        .unwrap();
    let n = tick.tick;
    let hit = tick
        .events
        .iter_mut()
        .find(|e| e["passive"] == true)
        .unwrap();
    hit["amount"] = serde_json::json!(hit["amount"].as_f64().unwrap() * 9.0 / 7.0);
    let mismatch = compare(&shield).mismatches;
    assert!(
        mismatch
            .iter()
            .any(|m| m.starts_with(&format!("tick {n}: events[")) && m.contains(".amount")),
        "{mismatch:?}"
    );
    let mut fx = load(&fixtures_dir().join("fists_duel.json"));
    fx.players[1].faction = "frost".into();
    assert!(
        !compare(&fx).mismatches.is_empty(),
        "a changed faction must change the outcome"
    );
    // Another secret salt (with its consistent seed, so the metadata check passes) must change who gets a tied kill: the
    // harness has to see the outcome itself, not only the recorded salt.
    let mut tie = load(&fixtures_dir().join("tie_kill_credit_3.json"));
    let other = load(&fixtures_dir().join("tie_kill_credit_17.json"));
    assert_ne!(
        tie.results[0].killed_by, other.results[0].killed_by,
        "the two salts give the kill to different attackers"
    );
    tie.legacy_config.order_salt = other.legacy_config.order_salt;
    tie.legacy_config.random_seed = other.legacy_config.random_seed;
    let rep = compare(&tie);
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("result") || m.contains("death")),
        "the changed killer is caught: {:?}",
        rep.mismatches
    );
}

// -------------------------------------------------------------------------------------------------------------------
// False-MATCH protection: a key the harness does not read can never pass silently.

fn fists_duel_json() -> serde_json::Value {
    let text = std::fs::read_to_string(fixtures_dir().join("fists_duel.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn reparse(v: &serde_json::Value) -> Result<Fixture, String> {
    parse(&v.to_string())
}

#[test]
fn the_untouched_copy_matches() {
    // The mutations below start from this: the JSON round trip itself changes nothing.
    let fx = reparse(&fists_duel_json()).unwrap();
    assert!(compare(&fx).mismatches.is_empty());
}

#[test]
fn an_unknown_tick_key_fails_the_gate() {
    // A new per-tick entity list (the next mechanic's capture) must not be ignored: it is refused until the harness
    // compares it.
    let mut v = fists_duel_json();
    v["ticks"][3]["mobs"] = serde_json::json!([]);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("unported stream mobs")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn unknown_keys_anywhere_fail_the_gate() {
    for (path, key) in [
        (vec![], "barrier"),
        (vec!["legacyConfig"], "cards"),
        (vec!["map"], "hazards"),
        (vec!["players", "0"], "armor"),
        (vec!["inputs", "0"], "lag"),
        (vec!["results", "0"], "gvQuest"),
    ] {
        let mut v = fists_duel_json();
        let mut at = &mut v;
        for p in &path {
            at = match p.parse::<usize>() {
                Ok(i) => &mut at[i],
                Err(_) => &mut at[*p],
            };
        }
        at[key] = serde_json::json!(0);
        let err = reparse(&v)
            .err()
            .unwrap_or_else(|| panic!("{path:?}.{key} must be refused"));
        assert!(err.contains(&format!("unknown field `{key}`")), "{err}");
    }
}

#[test]
fn an_unported_entity_key_fails_unless_declared_not_compared() {
    let mut v = fists_duel_json();
    for t in v["ticks"].as_array_mut().unwrap() {
        for p in t["players"].as_array_mut().unwrap() {
            p["barrier"] = serde_json::json!(0);
        }
    }
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.starts_with("unported key players.barrier")),
        "{:?}",
        rep.mismatches
    );
    // Reported once, not once per tick.
    assert_eq!(
        rep.mismatches
            .iter()
            .filter(|m| m.contains("players.barrier"))
            .count(),
        1
    );
    // Explicitly not compared: then the rest still matches.
    v["notCompared"] = serde_json::json!(["players.barrier"]);
    let rep = compare(&reparse(&v).unwrap());
    assert!(rep.mismatches.is_empty(), "{:?}", rep.mismatches);
    // notCompared cannot hide a compared key.
    v["notCompared"] = serde_json::json!(["players.barrier", "players.hp"]);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches.iter().any(|m| m.contains("notCompared")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn a_missing_compared_key_fails() {
    let mut v = fists_duel_json();
    v["ticks"][5]["players"][0]
        .as_object_mut()
        .unwrap()
        .remove("hp");
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("lacks the compared key hp")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn the_capture_configuration_is_asserted() {
    let cases: Vec<(&str, serde_json::Value, &str)> = vec![
        ("/legacyConfig/tickMs", serde_json::json!(40), "tickMs"),
        ("/legacyConfig/startTick", serde_json::json!(2), "startTick"),
        (
            "/legacyConfig/mobsPresent",
            serde_json::json!(3),
            "mobsPresent",
        ),
        (
            "/legacyConfig/unexpectedEventTypes",
            serde_json::json!(["chestOpened"]),
            "unexpectedEventTypes",
        ),
        (
            "/legacyConfig/startEvents",
            serde_json::json!([]),
            "startEvents",
        ),
        (
            "/legacyConfig/world",
            serde_json::json!("createGameWorld()"),
            "legacyConfig.world",
        ),
        ("/players/0/maxHp", serde_json::json!(1000), "maxHp"),
        ("/players/0/weapon0", serde_json::json!("fists"), "weapon0"),
        ("/map/tile", serde_json::json!(16), "map.tile"),
        ("/parity", serde_json::json!("all"), "parity class"),
    ];
    for (ptr, val, want) in cases {
        let mut v = fists_duel_json();
        *v.pointer_mut(ptr).unwrap() = val;
        let rep = compare(&reparse(&v).unwrap());
        assert!(
            rep.mismatches
                .iter()
                .any(|m| m.starts_with("precondition:") && m.contains(want)),
            "{ptr}: {:?}",
            rep.mismatches
        );
    }
}

#[test]
fn only_scenario_files_are_scenarios() {
    // The pathfinding fixture (another format) sits in the same directory and is never loaded as a scenario.
    let paths = scenario_paths();
    assert!(paths.iter().all(|p| !p
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("pathfinding")));
    assert_eq!(
        peek_format(&fixtures_dir().join("pathfinding_seed1.json")).as_deref(),
        Some(PATHFINDING_FORMAT)
    );
    // A JSON file whose first key is not `format` is not a scenario either.
    let dir = std::env::temp_dir().join(format!("rh-parity-peek-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let odd = dir.join("odd.json");
    std::fs::write(&odd, r#"{"scenario":"x","format":"rh-legacy-scenario/1"}"#).unwrap();
    assert_eq!(peek_format(&odd), None);
    std::fs::write(&odd, "{ \"format\" : \"rh-legacy-schedule/1\", \"x\": 1}").unwrap();
    assert_eq!(peek_format(&odd).as_deref(), Some("rh-legacy-schedule/1"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn fixture_discovery_is_loud_and_complete() {
    // Every JSON file in parity/fixtures is a scenario or the pathfinding fixture: nothing is skipped without a word.
    let files = discover(&fixtures_dir());
    assert!(files.problems().is_empty(), "{:?}", files.problems());
    assert_eq!(
        files.pathfinding,
        vec![fixtures_dir().join("pathfinding_seed1.json")]
    );
    let json = std::fs::read_dir(fixtures_dir())
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|x| x == "json")
        })
        .count();
    assert_eq!(json, files.scenarios.len() + files.pathfinding.len());
    assert_eq!(scenario_paths(), files.scenarios);

    // A stray JSON file (no leading format key, or another format) is reported, never silently dropped.
    let dir = std::env::temp_dir().join(format!("rh-parity-discover-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.json"), r#"{"scenario":"x"}"#).unwrap();
    std::fs::write(dir.join("b.json"), r#"{"format":"rh-legacy-scenario/2"}"#).unwrap();
    std::fs::write(dir.join("c.txt"), "not json").unwrap();
    let got = discover(&dir);
    assert!(got.scenarios.is_empty() && got.pathfinding.is_empty());
    assert_eq!(
        got.unrecognised,
        vec![
            (dir.join("a.json"), None),
            (dir.join("b.json"), Some("rh-legacy-scenario/2".to_string()))
        ]
    );
    assert_eq!(got.problems().len(), 2);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_multibyte_character_at_the_peek_boundary_keeps_the_scenario() {
    // Regression: a 3-byte U+2014 straddling bytes 255..258 of the 256-byte peek once made the scenario vanish from the
    // gate. Place it there, in the description of a copy of fists_duel.
    let text = std::fs::read_to_string(fixtures_dir().join("fists_duel.json")).unwrap();
    let key = "\"description\":\"";
    let at = text.find(key).unwrap() + key.len();
    assert!(at < 255);
    let padded = format!(
        "{}{}\u{2014}{}",
        &text[..at],
        "x".repeat(255 - at),
        &text[at..]
    );
    assert_eq!(&padded.as_bytes()[255..258], "\u{2014}".as_bytes());
    let dir = std::env::temp_dir().join(format!("rh-parity-utf8-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("zz_utf8.json");
    std::fs::write(&p, &padded).unwrap();
    assert_eq!(peek_format(&p).as_deref(), Some(SCENARIO_FORMAT));
    let got = discover(&dir);
    assert_eq!(got.scenarios, vec![p.clone()]);
    assert!(got.unrecognised.is_empty());
    // And it is a whole scenario that still matches.
    assert!(compare(&load(&p)).mismatches.is_empty());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn an_unread_input_msg_key_fails() {
    // raw_command reads only the keys it knows; any other msg key (a future attack `charge`) is reported.
    let mut v = fists_duel_json();
    let i = v["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .position(|i| i["type"] == "attack")
        .unwrap();
    v["inputs"][i]["msg"]["charge"] = serde_json::json!(1);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("input attack msg key charge is not read")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn unmapped_event_and_input_kinds_name_the_missing_comparison() {
    let mut v = fists_duel_json();
    v["ticks"][0]["events"] =
        serde_json::json!([{ "kind": "futureFx", "payload": { "hidden": 3 } }]);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("unmapped event kind futureFx")),
        "{:?}",
        rep.mismatches
    );
    let mut v = fists_duel_json();
    v["inputs"][0]["type"] = serde_json::json!("futureInput");
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("unmapped input kind futureInput")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn required_kinds_cannot_pass_an_empty_scenario() {
    let mut v = fists_duel_json();
    v["requires"] = serde_json::json!(["projEnd", "input:target", "launch"]);
    let rep = compare(&reparse(&v).unwrap());
    for kind in ["projEnd", "input:target", "launch"] {
        assert!(
            rep.mismatches
                .iter()
                .any(|m| m == &format!("required kind {kind} never occurred")),
            "{:?}",
            rep.mismatches
        );
    }
}

#[test]
fn every_capture_only_stream_fails_loudly_on_promotion() {
    for (key, value) in [
        ("launches", serde_json::json!([{ "id": "arrow1" }])),
        ("mobs", serde_json::json!([])),
        ("fields", serde_json::json!([])),
    ] {
        let mut v = fists_duel_json();
        v["ticks"][0][key] = value;
        let rep = compare(&reparse(&v).unwrap());
        assert!(
            rep.mismatches.iter().any(|m| if key == "launches" {
                m.contains("launches.length")
            } else {
                m.contains(&format!("unported stream {key}"))
            }),
            "{:?}",
            rep.mismatches
        );
    }
}

#[test]
fn first_event_field_and_exact_timing_are_reported() {
    let mut v = fists_duel_json();
    let ticks = v["ticks"].as_array_mut().unwrap();
    let tick = ticks
        .iter_mut()
        .find(|t| {
            t["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["kind"] == "windup")
        })
        .unwrap();
    let event = tick["events"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|e| e["kind"] == "windup")
        .unwrap();
    let ms = event["ms"].as_f64().unwrap();
    event["ms"] = serde_json::json!(ms + 0.000001);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches.iter().any(|m| m.contains("events[0].ms")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn every_catalogue_scenario_declares_its_owner_and_exercises_its_requirements() {
    let captures = scenarios("capture-only");
    assert!(captures.len() >= 14);
    for fx in captures {
        assert!(
            fx.packet.as_deref().is_some_and(|p| p.starts_with("P-")),
            "{} lacks a promotion packet",
            fx.scenario
        );
        assert!(
            !fx.requires.is_empty(),
            "{} lacks required kinds",
            fx.scenario
        );
        let ticks: std::collections::BTreeSet<_> = fx.ticks.iter().map(|t| t.tick).collect();
        assert!(fx.inputs.iter().all(|i| ticks.contains(&i.tick)));
        assert!(fx.actions.iter().all(|a| ticks.contains(&a.tick)));
        let mut occurred = std::collections::BTreeSet::new();
        for i in &fx.inputs {
            occurred.insert(format!("input:{}", i.kind));
        }
        for a in &fx.actions {
            occurred.insert(format!("action:{}", a.kind));
        }
        for t in &fx.ticks {
            for event in &t.events {
                occurred.insert(event["kind"].as_str().unwrap().to_string());
            }
            if !t.launches.is_empty() {
                occurred.insert("launch".to_string());
            }
            if t.containers
                .as_ref()
                .is_some_and(|cs| cs.iter().any(|c| c["kind"] == "consumable"))
            {
                occurred.insert("state:consumable".into());
            }
            if t.mobs.as_ref().is_some_and(|m| !m.is_empty()) {
                occurred.insert("state:mobs".to_string());
            }
        }
        for required in &fx.requires {
            assert!(
                occurred.contains(required),
                "{}: required kind {required} never occurred",
                fx.scenario
            );
        }
    }
}

#[test]
fn recorded_actions_replay_independently_of_scenario_name_and_accept_v1_aliases() {
    let mut fx = load(&fixtures_dir().join("leave_mia.json"));
    fx.scenario = "arbitrary_leave_name".into();
    fx.actions[0].kind = "leave".into();
    assert!(compare(&fx).mismatches.is_empty());
    let mut fx = load(&fixtures_dir().join("drop_releases_trigger.json"));
    fx.actions[1].kind = "join".into();
    assert!(compare(&fx).mismatches.is_empty());
    let mut v: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures_dir().join("leave_mia.json")).unwrap(),
    )
    .unwrap();
    v["actions"][0].as_object_mut().unwrap().remove("kind");
    v["actions"][0]["type"] = serde_json::json!("leave");
    assert!(compare(&reparse(&v).unwrap()).mismatches.is_empty());
}

#[test]
fn records_outside_or_out_of_order_in_the_timeline_cannot_hide_behind_requires() {
    for (kind, tick) in [("futureInput", 99999), ("move", 99999), ("move", 0)] {
        let mut v = fists_duel_json();
        v["inputs"].as_array_mut().unwrap().push(serde_json::json!({ "tick": tick, "player": "p0", "type": kind, "msg": {"x":400,"y":320} }));
        v["requires"] = serde_json::json!([format!("input:{kind}")]);
        assert!(
            !compare(&reparse(&v).unwrap()).mismatches.is_empty(),
            "input {kind} at {tick} passed"
        );
    }
    let mut v = fists_duel_json();
    v["inputs"].as_array_mut().unwrap().swap(0, 5);
    assert!(compare(&reparse(&v).unwrap())
        .mismatches
        .iter()
        .any(|m| m.contains("out of order")));
    for kind in ["futureAction", "drop"] {
        let mut v = fists_duel_json();
        v["actions"] = serde_json::json!([{ "tick": 99999, "player": "p0", "kind": kind }]);
        v["requires"] = serde_json::json!([format!("action:{kind}")]);
        assert!(
            !compare(&reparse(&v).unwrap()).mismatches.is_empty(),
            "action {kind} passed"
        );
    }
}

#[test]
fn an_invisible_submit_rejection_still_fails_acceptance_parity() {
    let mut v = fists_duel_json();
    v["budgeted"] = serde_json::json!(true);
    let moves: Vec<_> = (0..100).map(|_| serde_json::json!({ "tick":2, "player":"p0", "type":"move", "msg":{"x":400,"y":320} })).collect();
    v["inputs"].as_array_mut().unwrap().splice(0..0, moves);
    let rep = compare(&reparse(&v).unwrap());
    assert!(
        rep.mismatches
            .iter()
            .any(|m| m.contains("acceptance mismatch") && m.contains("OverBudget")),
        "{:?}",
        rep.mismatches
    );
}

#[test]
fn melee_packet_covers_equipment_statuses_and_settlement() {
    for name in [
        "sword_vs_fists",
        "shield_block_riposte",
        "axe_shred_stack",
        "sword_stagger_cancel",
        "swap_cooldown",
        "pickup_replace_drop",
    ] {
        let mut fx = load(&fixtures_dir().join(format!("{name}.json")));
        assert_eq!(fx.parity, "slice");
        assert_eq!(fx.packet.as_deref(), Some("P-COMBAT-1"));
        assert!(fx.ticks.len() >= 200);
        assert_eq!(fx.results.len(), 2);
        assert!(fx
            .ticks
            .iter()
            .any(|t| t.events.iter().any(|e| e["kind"] == "hit")));
        fx.ticks[0].combat = None;
        assert!(compare(&fx)
            .mismatches
            .iter()
            .any(|m| m.contains("missing combat packet stream combat")));
    }
}

#[test]
fn unported_emblem_is_detected_in_a_full_module_capture() {
    let fixture = load(&fixtures_dir().join("emblem_during_melee.json"));
    let report = compare(&fixture);
    assert!(
        report
            .mismatches
            .iter()
            .any(|m| m.contains("tick 238: containers.length")),
        "{:?}",
        report.mismatches
    );
}

#[test]
fn directional_projectile_fixtures_require_complete_launch_end_and_authoritative_effects() {
    for name in [
        "bow_duel",
        "wand_duel",
        "ball_vs_arrow",
        "sword_swing_ball",
        "shield_arrow_reflect",
        "wand_splash_group",
        "projectile_outlives_owner",
    ] {
        let mut fx = load(&fixtures_dir().join(format!("{name}.json")));
        assert_eq!(fx.packet.as_deref(), Some("P-COMBAT-2"));
        assert_eq!(fx.parity, "slice");
        assert!(fx
            .ticks
            .iter()
            .any(|t| t.events.iter().any(|e| e["kind"] == "projEnd")));
        let launch = fx
            .ticks
            .iter_mut()
            .flat_map(|t| &mut t.launches)
            .next()
            .unwrap();
        launch["targetId"] = serde_json::json!("invented");
        assert!(compare(&fx)
            .mismatches
            .iter()
            .any(|m| m.contains("launches[0].targetId")));
    }
    let fx = load(&fixtures_dir().join("projectile_outlives_owner.json"));
    let victim = fx.results.iter().find(|r| r.id == "p1").unwrap();
    assert_eq!(victim.killed_by.as_deref(), Some("P0"));
    let locked = load(&fixtures_dir().join("bow_wand_capture.json"));
    assert_eq!(locked.parity, "capture-only");
    assert!(locked.inputs.iter().any(|i| i.kind == "target"));
}
