//! The differential gate: every `parity: "slice"` legacy fixture must replay identically through the Rust core.

use rh_parity::*;

#[test]
fn every_slice_fixture_matches_legacy() {
    let all = scenario_paths();
    let fixtures = scenarios("slice");
    // 13 slice scenarios are captured (fists_duel .. tie_kill_credit_77); a vanished fixture must not pass quietly.
    assert!(
        fixtures.len() >= 13,
        "expected the 13 captured slice fixtures, found {}",
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
    let err = reparse(&v)
        .err()
        .expect("an unknown FixTick key is refused");
    assert!(err.contains("unknown field `mobs`"), "{err}");
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
        ("/players/0/weapon0", serde_json::json!("bow"), "weapon0"),
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
