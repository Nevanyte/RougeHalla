//! Shape parity for the docs/TELEMETRY.md RunRecord v1 type surface: the captured REAL source record
//! (parity/telemetry/run-record.json, pinned-container capture in tools/bot-telemetry-fixtures) must deserialize into the
//! ported shape and re-serialize to the committed source NDJSON bytes exactly, including field order, optional-field
//! presence/absence and JSON number representation. This certifies the SHAPE only: the module is a fixture-consumer type
//! surface pending the lead's producer-wiring decision (follow-ups A/B in the SCOPED_PLAN); no runner path fills a record.
use rh_headless::telemetry_record::{record_from_line, record_to_line, RunRecord};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../parity/telemetry/run-record.json");

fn corpus() -> Value {
    let corpus: Value =
        serde_json::from_str(FIXTURE).expect("the captured telemetry corpus parses");
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

fn record_line() -> String {
    corpus()["recordLine"]
        .as_str()
        .expect("the corpus keeps the exact source NDJSON line")
        .to_owned()
}

/// The line as a JSON value (input construction only: serde_json's Value serializes keys sorted, never compare its
/// output to the source bytes).
fn line_value() -> Value {
    serde_json::from_str(&record_line()).expect("the record line is JSON")
}

fn input(value: &Value) -> String {
    serde_json::to_string(value).expect("test input serializes")
}

#[test]
fn the_captured_source_record_round_trips_byte_identically() {
    let line = record_line();
    let record: RunRecord =
        record_from_line(&line).expect("the captured record parses into the ported shape");
    assert_eq!(
        record_to_line(&record),
        line,
        "field order, optional presence and number representation are the source record's exact bytes"
    );
    let from_line: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(
        from_line,
        corpus()["record"],
        "the line is the committed record"
    );
}

#[test]
fn required_and_required_nullable_fields_cannot_be_absent() {
    for field in ["players", "duels", "config", "build"] {
        let mut missing = line_value();
        missing.as_object_mut().unwrap().remove(field);
        assert!(
            record_from_line(&input(&missing)).is_err(),
            "{field} is a required top-level field"
        );
    }
    // Required nested fields: a player's net counters, and its null-able death slot (nullable is not optional).
    for field in ["net", "death", "pid", "slot", "final"] {
        let mut missing = line_value();
        missing["players"][0].as_object_mut().unwrap().remove(field);
        assert!(
            record_from_line(&input(&missing)).is_err(),
            "player field {field} is required"
        );
    }
    // A required NULLABLE field keeps its key when it is null.
    let mut null_death = line_value();
    null_death["players"][1]["death"] = Value::Null;
    let parsed = record_from_line(&input(&null_death)).expect("a null required field parses");
    let out = record_to_line(&parsed);
    assert!(out.contains("\"death\":null"), "the null key is serialized");
    assert!(!out.contains("bySlot"), "the removed death cause is gone");
}

#[test]
fn an_absent_source_optional_field_stays_absent() {
    let line = record_line();
    // tiles is a source optional (the oversized-record retry drops it). Remove it from both captured players by
    // canonical-string surgery, so the expected bytes keep the source order; the port must not re-insert the key.
    let expected = line.replace(",\"tiles\":\"\"", "");
    assert_ne!(expected, line);
    let parsed = record_from_line(&expected).expect("an absent optional field parses");
    assert_eq!(
        record_to_line(&parsed),
        expected,
        "an absent optional field must not be re-inserted"
    );
    assert!(!record_to_line(&parsed).contains("\"tiles\""));
    assert!(
        line.contains("\"tiles\""),
        "the captured record carries tiles"
    );
}

#[test]
fn an_extra_field_cannot_pass_the_source_bytes_check() {
    // The source contract is additive-optional, so an unknown field deserializes; but it is not part of the captured
    // source bytes, so the serialized port drops it and the byte parity check detects the shape drift. This is the
    // negative control for a field-order/extra-field mutation: a changed record cannot satisfy the round-trip assertion.
    let line = record_line();
    let modified = format!("{},\"unexpectedField\":1}}{}", &line[..line.len() - 1], "");
    let parsed = record_from_line(&modified).expect("an additive unknown field still parses");
    assert_ne!(
        record_to_line(&parsed),
        modified,
        "an extra field cannot survive the source bytes check"
    );
    assert_eq!(
        record_to_line(&parsed),
        line,
        "dropping it recovers the captured bytes"
    );
}
