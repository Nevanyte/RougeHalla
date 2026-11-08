//! Shape parity for the docs/TELEMETRY.md RunRecord v1 type surface: EVERY captured REAL source record (the base record in
//! run-record.json and the variant matrix in run-record-matrix.json, both pinned-container captures from the unmodified
//! legacy recorder) must deserialize into the ported shape and re-serialize to the committed source NDJSON bytes exactly,
//! including field order, optional-field presence/absence and JSON number representation. This certifies the SHAPE only:
//! the module is a fixture-consumer type surface pending the lead's producer-wiring decision (follow-ups A/B in the
//! SCOPED_PLAN); no runner path fills a record and no value is fabricated.
use rh_headless::telemetry_record::{record_from_line, record_to_line, RunRecord};
use serde_json::Value;

const BASE: &str = include_str!("../../../parity/telemetry/run-record.json");
const MATRIX: &str = include_str!("../../../parity/telemetry/run-record-matrix.json");

fn base_corpus() -> Value {
    let corpus: Value = serde_json::from_str(BASE).expect("the base telemetry corpus parses");
    assert_eq!(corpus["format"], "rh-bot-telemetry-source/1");
    assert_eq!(corpus["profile"]["schemaVersion"].as_u64(), Some(1));
    assert_eq!(corpus["profile"]["node"], "v22.23.4");
    assert_eq!(corpus["profile"]["platform"], "linux");
    assert_eq!(corpus["profile"]["arch"], "x64");
    assert_eq!(
        corpus["profile"]["captureSha256"].as_str().unwrap().len(),
        64
    );
    corpus
}

fn matrix_corpus() -> Value {
    let corpus: Value = serde_json::from_str(MATRIX).expect("the telemetry matrix corpus parses");
    assert_eq!(corpus["format"], "rh-bot-telemetry-matrix/1");
    assert_eq!(corpus["profile"]["schemaVersion"].as_u64(), Some(1));
    assert_eq!(corpus["profile"]["node"], "v22.23.4");
    assert_eq!(corpus["profile"]["platform"], "linux");
    assert_eq!(corpus["profile"]["arch"], "x64");
    assert_eq!(
        corpus["profile"]["captureSha256"].as_str().unwrap().len(),
        64
    );
    corpus
}

/// Every captured record line with a label: the base one plus every matrix variant.
fn captured_lines() -> Vec<(String, String)> {
    let mut out = vec![(
        "base".to_owned(),
        base_corpus()["recordLine"].as_str().unwrap().to_owned(),
    )];
    for row in matrix_corpus()["records"].as_array().unwrap() {
        out.push((
            row["name"].as_str().unwrap().to_owned(),
            row["recordLine"].as_str().unwrap().to_owned(),
        ));
    }
    out
}

fn line_value(line: &str) -> Value {
    serde_json::from_str(line).expect("a captured record line is JSON")
}

fn input(value: &Value) -> String {
    serde_json::to_string(value).expect("test input serializes")
}

#[test]
fn every_captured_source_record_round_trips_byte_identically() {
    let lines = captured_lines();
    assert!(
        lines.len() >= 12,
        "the base record and the variant matrix are captured"
    );
    for (name, line) in &lines {
        let record: RunRecord = record_from_line(line)
            .unwrap_or_else(|err| panic!("{name}: the captured record parses: {err}"));
        assert_eq!(
            record_to_line(&record),
            *line,
            "{name}: field order, optional presence and number representation are the source bytes"
        );
    }
    // The matrix covers the documented optional-variant gaps (the blockers are documented in the corpus).
    let matrix = matrix_corpus();
    let names: Vec<&str> = matrix["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    for required in [
        "bot-client-net",
        "death-terrain-sudden",
        "death-quit",
        "draw-both-down",
        "void-null-nullables",
        "abandoned-end",
        "long-run-snapshots-tiles-afk",
        "offers-truncated",
        "duels-truncated",
        "planning-mia",
        "win-bonus-opponents",
    ] {
        assert!(names.contains(&required), "the matrix covers {required}");
    }
    assert!(matrix["blockers"].as_array().unwrap().len() >= 3);
}

#[test]
fn required_and_required_nullable_fields_cannot_be_absent() {
    for (name, line) in captured_lines() {
        for field in ["players", "duels", "config", "build", "coliseum"] {
            let mut missing = line_value(&line);
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                record_from_line(&input(&missing)).is_err(),
                "{name}: {field} is a required top-level field"
            );
        }
        for field in ["net", "death", "pid", "slot", "final"] {
            let mut missing = line_value(&line);
            missing["players"][0].as_object_mut().unwrap().remove(field);
            assert!(
                record_from_line(&input(&missing)).is_err(),
                "{name}: player field {field} is required"
            );
        }
    }
    // A required NULLABLE field keeps its key when it is null (the base record's player 0 death, the void record's deaths
    // and firstBlood, the bot record's build.commit).
    let lines = captured_lines();
    let base = &lines[0].1;
    let mut null_death = line_value(base);
    null_death["players"][1]["death"] = Value::Null;
    let parsed = record_from_line(&input(&null_death)).expect("a null required field parses");
    let out = record_to_line(&parsed);
    assert!(out.contains("\"death\":null"));
    assert!(!out.contains("bySlot"));
    let void_line = lines
        .iter()
        .find(|(n, _)| n == "void-null-nullables")
        .unwrap();
    let void = record_from_line(&void_line.1).expect("the void record parses");
    assert!(void.first_blood.is_none(), "firstBlood is a present null");
    assert!(void.players.iter().all(|p| p.death.is_none()));
}

/// Remove every player tiles member from the canonical line (source order preserved), or None when there is none.
fn strip_tiles(line: &str) -> Option<String> {
    let key = ",\"tiles\":\"";
    let mut out = line.to_owned();
    let mut found = false;
    while let Some(at) = out.find(key) {
        found = true;
        let value_start = at + key.len();
        let end_quote = out[value_start..]
            .find('"')
            .map(|i| value_start + i)
            .expect("a tiles value is a quoted string");
        out = format!("{}{}", &out[..at], &out[end_quote + 1..]);
    }
    found.then_some(out)
}

#[test]
fn an_absent_source_optional_field_stays_absent() {
    let mut checked = 0;
    for (name, line) in captured_lines() {
        let Some(expected) = strip_tiles(&line) else {
            continue;
        };
        checked += 1;
        // tiles is a source optional (the oversized-record retry drops it). Removed from every player here: the port must
        // not re-insert it, and inside the run the value may be the empty string (base) or dense 1 Hz data (long run).
        let parsed = record_from_line(&expected)
            .unwrap_or_else(|e| panic!("{name}: parses without tiles: {e}"));
        assert_eq!(
            record_to_line(&parsed),
            expected,
            "{name}: an absent optional field must not be re-inserted"
        );
        assert!(!record_to_line(&parsed).contains("\"tiles\""));
    }
    assert!(checked >= 10, "most records carry tiles: {checked}");
    // The long-run record carries non-empty tiles: the shape keeps the value exactly.
    let lines = captured_lines();
    let long = lines
        .iter()
        .find(|(n, _)| n == "long-run-snapshots-tiles-afk")
        .unwrap();
    assert!(long.1.contains("\"tiles\":\"") && !long.1.contains("\"tiles\":\"\""));
}

#[test]
fn an_extra_field_cannot_pass_the_source_bytes_check() {
    // The source contract is additive-optional, so an unknown field deserializes; but it is not part of the captured
    // source bytes, so the serialized port drops it and the byte parity check detects the shape drift.
    for (name, line) in captured_lines() {
        let modified = format!("{},\"unexpectedField\":1}}", &line[..line.len() - 1]);
        let parsed = record_from_line(&modified)
            .unwrap_or_else(|e| panic!("{name}: additive field parses: {e}"));
        assert_ne!(
            record_to_line(&parsed),
            modified,
            "{name}: an extra field cannot survive the source bytes check"
        );
        assert_eq!(
            record_to_line(&parsed),
            line,
            "{name}: dropping it recovers the captured bytes"
        );
    }
}
