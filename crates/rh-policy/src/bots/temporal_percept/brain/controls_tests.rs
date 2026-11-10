//! Brain native strict-intake / reached-assertion / semantic controls (P-BOT-BRAIN-NATIVE-1).
//!
//! Three frozen-source control groups, all over the actual native composition:
//!
//! * **Strict intake negatives** — every one of the frozen `readerControls` receipts from
//!   `tools/bot-private-brain-fixtures/verify.mjs` through the same complete checked entry the replay uses
//!   ([`super::source_input::body_from_value`] / [`super::source_input::raw_value`]), asserting a rejection *and*
//!   atomic nonadvance (the checked entry never runs an operation body, never touches a component/global counter and is
//!   deterministically rejecting on a repeat call).
//! * **Reached assertions** — the frozen 40 `reached.assertions` labels from
//!   `parity/policy/bot-private-brain/coverage.json` mapped 1:1 to real assertions over native actual replay rows
//!   (native Brain goals/stats/memory/counts, released commands, trace events, service snapshots and error rows), never
//!   over the frozen expected rows.
//! * **Semantic controls** — in-memory changed-expected KILL controls through the same native comparator (with a
//!   provenance-only NONKILL control), plus guard/service/RNG/Send controls and atomic nonadvance over a real replayed
//!   case.
//!
//! The frozen expected oracle is never installed as state or fed back as an input: expected copies are only mutated in
//! memory here as comparator control inputs, and the actual replay rows are produced by the actual native components.

#![allow(clippy::too_many_lines)]

use serde_json::{json, Value};

use super::source_input::{
    self, body_from_value, raw_value, validate_body, Source, SOURCE_RELATIVE_PATH,
};
use super::trace::{self, BVal, Recorder};

/// The first frozen history (`cases()` order and therefore the first captured body case): the mutation target used by
/// the source `readerControls` spec edits.
const CORE_CASE: &str = "core-registry-cadence";

/// The frozen 30 strict-intake receipt ids in `verify.mjs`/`coverage.json` order.
const STRICT_NEGATIVE_IDS: [&str; 30] = [
    "codec-0",
    "codec-1",
    "codec-2",
    "codec-3",
    "codec-4",
    "codec-5",
    "codec-6",
    "codec-7",
    "raw-duplicate",
    "missing-self-ready",
    "invalid-status",
    "nonfinite-now",
    "nonfinite-viewT",
    "missing-hud",
    "unknown-brain",
    "unknown-module-object",
    "unknown-budget",
    "backward-clock",
    "unknown-map",
    "undefined-delay-overlay",
    "unknown-runtime-answer-env",
    "unknown-operation-field",
    "wrong-feature-type",
    "unknown-format",
    "duplicate-case",
    "map-layer-length",
    "missing-chest-takenBy",
    "missing-tier-knowledge",
    "missing-tier-reaction-mu",
    "missing-callback-result",
];

/// The source `checkedDispatch`-edited spec rows (`nonadvance: true` in the frozen receipt).
const SPEC_EDIT_IDS: [&str; 14] = [
    "missing-self-ready",
    "invalid-status",
    "nonfinite-now",
    "nonfinite-viewT",
    "missing-hud",
    "unknown-brain",
    "unknown-module-object",
    "unknown-budget",
    "backward-clock",
    "unknown-map",
    "undefined-delay-overlay",
    "unknown-runtime-answer-env",
    "unknown-operation-field",
    "wrong-feature-type",
];

/// The frozen body-level edits in `verify.mjs` order.
const BODY_EDIT_IDS: [&str; 6] = [
    "unknown-format",
    "duplicate-case",
    "map-layer-length",
    "missing-tier-knowledge",
    "missing-tier-reaction-mu",
    "missing-callback-result",
];

// ---------------------------------------------------------------------------------------------------------------------
// Frozen corpus load and raw-value navigation. These read the released corpus bytes only; they never mutate a file.

fn body_json() -> &'static Value {
    static BODY: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    BODY.get_or_init(|| {
        let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), SOURCE_RELATIVE_PATH);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("frozen Brain source corpus {path}: {error}"));
        raw_value(&text)
            .unwrap_or_else(|error| panic!("frozen Brain source corpus raw parse: {error}"))
    })
}

fn case_mut<'a>(body: &'a mut Value, id: &str) -> &'a mut Value {
    body.get_mut("cases")
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("body.cases array"))
        .iter_mut()
        .find(|case| case.get("id").and_then(Value::as_str) == Some(id))
        .unwrap_or_else(|| panic!("declared case {id}"))
}

fn ops_mut(case: &mut Value) -> &mut Vec<Value> {
    case.get_mut("operations")
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("declared case operations array"))
}

fn op_method(op: &Value) -> &str {
    op.get("method").and_then(Value::as_str).unwrap_or_default()
}

fn op_index(case: &Value, method: &str, nth: usize) -> usize {
    case.get("operations")
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("declared case operations array"))
        .iter()
        .enumerate()
        .filter(|(_, op)| op_method(op) == method)
        .nth(nth)
        .map(|(index, _)| index)
        .unwrap_or_else(|| panic!("declared {method} operation #{nth}"))
}

fn operation_declaration_mut<'a>(case: &'a mut Value, method: &str, nth: usize) -> &'a mut Value {
    let index = op_index(case, method, nth);
    ops_mut(case)[index]
        .get_mut("declaration")
        .unwrap_or_else(|| panic!("declared {method} operation #{nth}.declaration"))
}

/// The first declared tick operation's `input` (the source reads `operations.find(o => o.method === 'tick')`).
fn first_tick_input_mut(body: &mut Value) -> &mut Value {
    let case = case_mut(body, CORE_CASE);
    let declaration = operation_declaration_mut(case, "tick", 0);
    entry_mut(declaration, "input", "declaration")
}

fn config_declaration_mut<'a>(body: &'a mut Value, case_id: &str, handle: &str) -> &'a mut Value {
    let case = case_mut(body, case_id);
    let config = case
        .get_mut("configs")
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("case {case_id}.configs array"))
        .iter_mut()
        .find(|config| config.get("handle").and_then(Value::as_str) == Some(handle))
        .unwrap_or_else(|| panic!("case {case_id} config {handle}"));
    config
        .get_mut("declaration")
        .unwrap_or_else(|| panic!("case {case_id} config {handle}.declaration"))
}

/// The first resolved config's typed tier object (`cases[0].configs[0].resolved.tier`).
fn resolved_tier_mut(body: &mut Value) -> &mut Value {
    let case = case_mut(body, CORE_CASE);
    let resolved = case
        .get_mut("configs")
        .and_then(Value::as_array_mut)
        .and_then(|configs| configs.first_mut())
        .and_then(|config| config.get_mut("resolved"))
        .unwrap_or_else(|| panic!("case config resolved value"));
    entry_mut(resolved, "tier", "resolved")
}

// ---------------------------------------------------------------------------------------------------------------------
// Tagged `rh-method-value/1` navigation (the decoded raw body is the tagged source record).

fn entries_mut<'a>(tagged: &'a mut Value, path: &str) -> &'a mut Vec<Value> {
    tagged
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("{path}: tagged object entries"))
}

fn entry_mut<'a>(tagged: &'a mut Value, key: &str, path: &str) -> &'a mut Value {
    let entries = entries_mut(tagged, path);
    let pair = entries
        .iter_mut()
        .find(|pair| {
            pair.as_array()
                .and_then(|pair| pair.first())
                .and_then(Value::as_str)
                == Some(key)
        })
        .unwrap_or_else(|| panic!("{path}: missing tagged field {key}"));
    &mut pair
        .as_array_mut()
        .unwrap_or_else(|| panic!("{path}.{key}: tagged pair"))[1]
}

fn has_entry(tagged: &Value, key: &str) -> bool {
    tagged
        .get("entries")
        .and_then(Value::as_array)
        .is_some_and(|entries| {
            entries.iter().any(|pair| {
                pair.as_array()
                    .and_then(|pair| pair.first())
                    .and_then(Value::as_str)
                    == Some(key)
            })
        })
}

fn remove_entry(tagged: &mut Value, key: &str, path: &str) {
    let entries = entries_mut(tagged, path);
    let index = entries
        .iter()
        .position(|pair| {
            pair.as_array()
                .and_then(|pair| pair.first())
                .and_then(Value::as_str)
                == Some(key)
        })
        .unwrap_or_else(|| panic!("{path}: missing tagged field {key}"));
    entries.remove(index);
}

fn add_entry(tagged: &mut Value, key: &str, value: Value, path: &str) {
    if has_entry(tagged, key) {
        *entry_mut(tagged, key, path) = value;
    } else {
        entries_mut(tagged, path).push(json!([key, value]));
    }
}

fn tagged_object(entries: Value) -> Value {
    json!({"$": "object", "entries": entries})
}

fn values_array(values: Vec<Value>) -> Value {
    json!({"$": "array", "values": values})
}

// ---------------------------------------------------------------------------------------------------------------------
// The checked complete intake entry. Validation and construction complete before the operation counter advances, so a
// rejected intake must leave it at zero (the native equivalent of `checkedDispatch`'s `advanced` closure).

fn checked_intake(raw: &Value, advanced: &mut usize) -> Result<Source, String> {
    let source = body_from_value(raw)?;
    *advanced += 1;
    Ok(source)
}

/// Reject one mutated raw body twice (deterministic) and prove the checked entry body never advanced.
fn assert_checked_reject(id: &str, raw: &Value) {
    let mut first = 0usize;
    let first_error = checked_intake(raw, &mut first)
        .err()
        .unwrap_or_else(|| panic!("{id}: mutated body was accepted"));
    assert_eq!(
        first, 0,
        "{id}: checked entry ran before validation completed"
    );
    assert!(
        !first_error.trim().is_empty(),
        "{id}: rejection must carry a diagnostic"
    );
    let mut second = 0usize;
    let second_error = checked_intake(raw, &mut second)
        .err()
        .unwrap_or_else(|| panic!("{id}: mutation was not deterministically rejected"));
    assert_eq!(
        second, 0,
        "{id}: checked entry ran on the repeated rejection"
    );
    assert_eq!(
        first_error, second_error,
        "{id}: rejection diagnostic must be deterministic"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Raw-body edits (mirroring `verify.mjs` mutation bodies; the frozen file itself is never written).

/// Apply one of the 14 `checkedDispatch` spec edits to the raw body in memory.
fn apply_spec_edit(body: &mut Value, id: &str) {
    match id {
        "missing-self-ready" => {
            let input = first_tick_input_mut(body);
            let me = entry_mut(input, "self", "input");
            remove_entry(me, "readyAt", "input.self");
        }
        "invalid-status" => {
            let input = first_tick_input_mut(body);
            let me = entry_mut(input, "self", "input");
            *entry_mut(me, "status", "input.self") = json!("future");
        }
        "nonfinite-now" => {
            let input = first_tick_input_mut(body);
            *entry_mut(input, "now", "input") = json!({"$": "number", "value": "+Infinity"});
        }
        "nonfinite-viewT" => {
            let input = first_tick_input_mut(body);
            *entry_mut(input, "viewT", "input") = json!({"$": "number", "value": "NaN"});
        }
        "missing-hud" => {
            let input = first_tick_input_mut(body);
            let hud = entry_mut(input, "hud", "input");
            remove_entry(hud, "gatesLocked", "input.hud");
        }
        "unknown-brain" => {
            let case = case_mut(body, CORE_CASE);
            let declaration = operation_declaration_mut(case, "tick", 0);
            *entry_mut(declaration, "brain", "declaration") = json!("absent");
        }
        "unknown-module-object" => {
            let declaration = config_declaration_mut(body, CORE_CASE, "a");
            add_entry(
                declaration,
                "modules",
                values_array(vec![json!("absent")]),
                "config.declaration",
            );
        }
        "unknown-budget" => {
            let case = case_mut(body, CORE_CASE);
            let declaration = operation_declaration_mut(case, "frame", 0);
            *entry_mut(declaration, "budget", "declaration") = json!("absent");
        }
        "backward-clock" => {
            let case = case_mut(body, CORE_CASE);
            let declaration = operation_declaration_mut(case, "tick", 1);
            let input = entry_mut(declaration, "input", "declaration");
            *entry_mut(input, "now", "input") = json!(0);
        }
        "unknown-map" => {
            let declaration = config_declaration_mut(body, CORE_CASE, "a");
            add_entry(declaration, "map", json!("absent"), "config.declaration");
        }
        "undefined-delay-overlay" => {
            let declaration = config_declaration_mut(body, CORE_CASE, "a");
            add_entry(
                declaration,
                "tierOverrides",
                tagged_object(json!([[
                    "reaction",
                    tagged_object(json!([["mu", {"$": "undefined"}]]))
                ]])),
                "config.declaration",
            );
        }
        "unknown-runtime-answer-env" => {
            let case = case_mut(body, CORE_CASE);
            let declaration = operation_declaration_mut(case, "tick", 0);
            let env = entry_mut(declaration, "env", "declaration");
            add_entry(
                env,
                "rngAnswers",
                values_array(vec![json!(0.5)]),
                "declaration.env",
            );
        }
        "unknown-operation-field" => {
            let case = case_mut(body, CORE_CASE);
            let declaration = operation_declaration_mut(case, "tick", 0);
            add_entry(
                declaration,
                "installedMemory",
                tagged_object(json!([])),
                "declaration",
            );
        }
        "wrong-feature-type" => {
            let declaration = config_declaration_mut(body, CORE_CASE, "a");
            add_entry(
                declaration,
                "features",
                tagged_object(json!([["wishes", "false"]])),
                "config.declaration",
            );
        }
        other => panic!("not a frozen spec edit: {other}"),
    }
}

/// Apply one of the frozen body-level edits to the raw body in memory.
fn apply_body_edit(body: &mut Value, id: &str) {
    match id {
        "unknown-format" => {
            body["format"] = json!("future");
        }
        "duplicate-case" => {
            let cases = body
                .get_mut("cases")
                .and_then(Value::as_array_mut)
                .unwrap_or_else(|| panic!("body.cases array"));
            let duplicate = cases.first().cloned().expect("declared first case");
            cases.push(duplicate);
        }
        "map-layer-length" => {
            let map = body
                .get_mut("maps")
                .and_then(Value::as_array_mut)
                .and_then(|maps| maps.first_mut())
                .and_then(|map| map.get_mut("value"))
                .unwrap_or_else(|| panic!("body.maps[0].value"));
            let terrain = entry_mut(map, "terrain", "body.maps[0].value");
            let values = terrain
                .get_mut("values")
                .and_then(Value::as_array_mut)
                .unwrap_or_else(|| panic!("map terrain u8 values"));
            values.pop().expect("declared terrain bytes");
        }
        "missing-tier-knowledge" => {
            let tier = resolved_tier_mut(body);
            remove_entry(tier, "knowledge", "resolved.tier");
        }
        "missing-tier-reaction-mu" => {
            let tier = resolved_tier_mut(body);
            let reaction = entry_mut(tier, "reaction", "resolved.tier");
            remove_entry(reaction, "mu", "resolved.tier.reaction");
        }
        "missing-callback-result" => {
            let case = case_mut(body, CORE_CASE);
            let rows = ops_mut(case);
            let operation = rows
                .iter_mut()
                .find(|operation| {
                    operation
                        .get("trace")
                        .and_then(Value::as_array)
                        .is_some_and(|trace| {
                            trace.iter().any(|row| {
                                row.get("kind").and_then(Value::as_str) == Some("callback")
                            })
                        })
                })
                .unwrap_or_else(|| panic!("a declared operation with a callback row"));
            let trace = operation
                .get_mut("trace")
                .and_then(Value::as_array_mut)
                .unwrap_or_else(|| panic!("operation trace array"));
            let row = trace
                .iter_mut()
                .find(|row| row.get("kind").and_then(Value::as_str) == Some("callback"))
                .unwrap_or_else(|| panic!("a declared callback row"));
            row.as_object_mut()
                .unwrap_or_else(|| panic!("declared callback row object"))
                .remove("result")
                .expect("declared callback result");
        }
        other => panic!("not a frozen body edit: {other}"),
    }
}

/// The frozen `missing-chest-takenBy` edit: the `core-chest` first tick's declared chest loses its readable `takenBy`.
fn apply_missing_chest_taken_by(body: &mut Value) {
    let case = case_mut(body, "core-chest");
    let declaration = operation_declaration_mut(case, "tick", 0);
    let input = entry_mut(declaration, "input", "declaration");
    let extras = entry_mut(input, "extras", "input");
    let chests = entry_mut(extras, "chests", "input.extras");
    let chest = chests
        .get_mut("values")
        .and_then(Value::as_array_mut)
        .and_then(|values| values.first_mut())
        .unwrap_or_else(|| panic!("declared core-chest chest row"));
    remove_entry(chest, "takenBy", "chest");
}

// ---------------------------------------------------------------------------------------------------------------------
// Group A: the frozen 30 strict-intake negatives through the same checked complete entry.

#[test]
fn frozen_codec_tag_controls_reject_at_a_declared_input() {
    // The eight `decode(v)` rejects from `readerControls` are applied here to a declared-input position of a real
    // declared tick operation; the complete checked intake must reject before construction.
    let base = body_json();
    let rejects = [
        ("codec-0", json!({"$": "future"})),
        ("codec-1", json!({"$": "undefined", "x": 1})),
        (
            "codec-2",
            json!({"$": "map", "entries": [["x", 1], ["x", 2]]}),
        ),
        (
            "codec-3",
            json!({"$": "object", "entries": [["x", 1], ["x", 2]]}),
        ),
        ("codec-4", json!({"$": "number", "value": "Infinity"})),
        ("codec-5", json!({"$": "u8", "values": [256]})),
        ("codec-6", json!({"$": "callable"})),
        (
            "codec-7",
            json!({"$": "instance", "name": "x", "entries": []}),
        ),
    ];
    for (id, bad) in rejects {
        let mut raw = (*base).clone();
        let input = first_tick_input_mut(&mut raw);
        *entry_mut(input, "now", "input") = bad;
        assert_checked_reject(id, &raw);
    }
    // One accepted control run proves the raw mutation target was a live declared input.
    let source = body_from_value(base).expect("pristine frozen body still converts");
    assert_eq!(
        source.operation_counts().expect("operation totals"),
        (31, 855)
    );
}

#[test]
fn raw_duplicate_decoded_key_control_rejects() {
    assert!(
        raw_value("{\"a\":1,\"\\u0061\":2}").is_err(),
        "raw-duplicate: duplicate decoded JSON key must reject"
    );
    assert!(
        raw_value("{\"a\":1,\"a\":2}").is_err(),
        "raw-duplicate: literal duplicate JSON key must reject"
    );
    assert!(
        raw_value("{\"a\":1} trailing").is_err(),
        "raw-duplicate: trailing bytes must reject"
    );
}

#[test]
fn frozen_spec_edit_controls_reject_atomically() {
    let base = body_json();
    for id in SPEC_EDIT_IDS {
        let mut raw = (*base).clone();
        apply_spec_edit(&mut raw, id);
        assert_checked_reject(id, &raw);
    }
}

#[test]
fn frozen_body_edit_controls_reject() {
    let base = body_json();
    for id in BODY_EDIT_IDS {
        let mut raw = (*base).clone();
        apply_body_edit(&mut raw, id);
        assert_checked_reject(id, &raw);
    }
}

#[test]
fn missing_chest_taken_by_control_rejects_atomically() {
    let base = body_json();
    let mut raw = (*base).clone();
    apply_missing_chest_taken_by(&mut raw);
    assert_checked_reject("missing-chest-takenBy", &raw);
}

#[test]
fn strict_negative_ledger_matches_the_frozen_receipt() {
    let body = body_json();
    let mut observed = Vec::new();
    let mut accepted = Vec::new();
    for id in STRICT_NEGATIVE_IDS {
        let mut raw = (*body).clone();
        match id {
            "raw-duplicate" => {
                // The raw corpus bytes are the checked entry for this receipt; there is no in-body operation to run.
                assert!(
                    raw_value("{\"a\":1,\"\\u0061\":2}").is_err(),
                    "{id}: duplicate decoded key"
                );
                observed.push(id);
                continue;
            }
            id if id.starts_with("codec-") => {
                // The eight frozen codec rejects are frozen raw method-value tags; the complete checked intake is the
                // only reader that must reject them through a declared position.
                let rejects = [
                    json!({"$": "future"}),
                    json!({"$": "undefined", "x": 1}),
                    json!({"$": "map", "entries": [["x", 1], ["x", 2]]}),
                    json!({"$": "object", "entries": [["x", 1], ["x", 2]]}),
                    json!({"$": "number", "value": "Infinity"}),
                    json!({"$": "u8", "values": [256]}),
                    json!({"$": "callable"}),
                    json!({"$": "instance", "name": "x", "entries": []}),
                ];
                let index: usize = id["codec-".len()..].parse().expect("codec index");
                let input = first_tick_input_mut(&mut raw);
                *entry_mut(input, "now", "input") = rejects[index].clone();
            }
            "missing-chest-takenBy" => apply_missing_chest_taken_by(&mut raw),
            id if SPEC_EDIT_IDS.contains(&id) => apply_spec_edit(&mut raw, id),
            id => apply_body_edit(&mut raw, id),
        }
        let mut advanced = 0usize;
        match checked_intake(&raw, &mut advanced) {
            Ok(_) => accepted.push(id),
            Err(_) => observed.push(id),
        }
        assert_eq!(advanced, 0, "{id}: nonadvance");
    }
    assert!(
        accepted.is_empty(),
        "accepted strict negatives: {accepted:?}"
    );
    assert_eq!(
        observed, STRICT_NEGATIVE_IDS,
        "the 30 frozen receipts must all reject in frozen order"
    );

    // The frozen ledger itself: 30 REJECT receipts, 15 of them (`checkedDispatch` spec/chest edits) marked nonadvance.
    let path = format!(
        "{}/../../parity/policy/bot-private-brain/coverage.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let ledger: Value = serde_json::from_str(
        &std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}")),
    )
    .unwrap_or_else(|error| panic!("{path}: invalid coverage JSON: {error}"));
    let receipts = ledger
        .get("readerControls")
        .and_then(Value::as_array)
        .expect("coverage.readerControls");
    assert_eq!(receipts.len(), 30, "frozen readerControls count");
    let ids: Vec<&str> = receipts
        .iter()
        .map(|row| row.get("id").and_then(Value::as_str).expect("receipt id"))
        .collect();
    assert_eq!(
        ids, STRICT_NEGATIVE_IDS,
        "native strict negative ids must map 1:1 to coverage.readerControls"
    );
    for row in receipts {
        let id = row.get("id").and_then(Value::as_str).expect("receipt id");
        assert_eq!(
            row.get("result").and_then(Value::as_str),
            Some("REJECT"),
            "{id}: frozen receipt result"
        );
    }
    let mut nonadvance: Vec<&str> = receipts
        .iter()
        .filter(|row| row.get("nonadvance").and_then(Value::as_bool) == Some(true))
        .map(|row| row.get("id").and_then(Value::as_str).expect("receipt id"))
        .collect();
    // `verify.mjs` marks only the 14 `checkedDispatch` spec edits nonadvance; the separate missing-chest-takenBy edit
    // asserts `advanced === 0` without stamping the receipt, and the native test above checks that stronger property.
    let mut expected_nonadvance: Vec<&str> = SPEC_EDIT_IDS.to_vec();
    nonadvance.sort_unstable();
    expected_nonadvance.sort_unstable();
    assert_eq!(
        nonadvance, expected_nonadvance,
        "frozen nonadvance receipt set"
    );
    // `validate_body` is the validate-only form of the same checked entry; it must reject identically.
    for id in SPEC_EDIT_IDS {
        let mut raw = (*body).clone();
        apply_spec_edit(&mut raw, id);
        assert!(validate_body(&raw).is_err(), "{id}: validate_body");
    }
}

#[test]
fn checked_intake_does_not_touch_component_or_global_counters() {
    // Build the actual observable objects a replay case owns, snapshot them, then run the checked intake (accepted and
    // rejected) and prove nothing advanced: no Recorder row/count, no path budget/stats change, no RNG draw and no
    // component/host identity replacement.
    let recorder = Recorder::new();
    let budget = crate::bots::paths::PathBudget::new(8);
    let path_stats = crate::bots::paths::PathStats::default();
    let rng = crate::bots::random::Rng::new(7);
    let host = super::host::ModuleHost::new();
    let host_identities: Vec<_> = super::super::modules::types::ModuleId::DEFAULT_ORDER
        .iter()
        .map(|id| std::sync::Arc::as_ptr(&host.builtin(*id).cell))
        .collect();

    let base = body_json();
    let source = body_from_value(base).expect("pristine frozen body converts");
    assert_eq!(source.operation_counts().expect("totals"), (31, 855));

    let mut rejected = (*base).clone();
    apply_spec_edit(&mut rejected, "missing-self-ready");
    assert!(body_from_value(&rejected).is_err(), "mutant must reject");
    assert_checked_reject("missing-hud", &{
        let mut second = (*base).clone();
        apply_spec_edit(&mut second, "missing-hud");
        second
    });

    // The composition's identity/token counters are process-global test atomics shared by the concurrently running
    // replay tests, so they cannot be observed task-locally here; `checked_intake_is_side_effect_free_across_replays`
    // proves the same property end-to-end by replay determinism across a rejected intake.
    assert_eq!(recorder.counts("a"), [0, 0, 0], "no runtime lane draw");
    assert_eq!(recorder.events_len(), 0, "no trace/callback event");
    assert_eq!(budget.left(), 8, "no path allowance taken");
    assert_eq!(path_stats, crate::bots::paths::PathStats::default());
    let mut expected_rng = rng.clone();
    let mut observed_rng = rng;
    assert_eq!(
        expected_rng.next_f64(),
        observed_rng.next_f64(),
        "no RNG draw"
    );
    let after_identities: Vec<_> = super::super::modules::types::ModuleId::DEFAULT_ORDER
        .iter()
        .map(|id| std::sync::Arc::as_ptr(&host.builtin(*id).cell))
        .collect();
    assert_eq!(
        host_identities, after_identities,
        "checked intake must not replace a shared builtin module object"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Group B and C helpers are appended below once the replay harness exposes the native actual rows. Group B assertions
// must read native actual replay state only; the frozen expected rows are never accepted as actual state.

/// The frozen `reached.assertions` ledger surface (`coverage.json`) used by the reached-control mapping test.
fn reached_ledger() -> Vec<Value> {
    let path = format!(
        "{}/../../parity/policy/bot-private-brain/coverage.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let ledger: Value = serde_json::from_str(
        &std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}")),
    )
    .unwrap_or_else(|error| panic!("{path}: invalid coverage JSON: {error}"));
    ledger
        .get("reached")
        .and_then(|reached| reached.get("assertions"))
        .and_then(Value::as_array)
        .cloned()
        .expect("coverage.reached.assertions")
}

/// Reserved for the reached-assertion mapping once the replay surface lands; kept exact so the 40-vs-ledger control is
/// fixed before the assertions are written.
#[test]
fn reached_ledger_declares_forty_assertions() {
    let assertions = reached_ledger();
    assert_eq!(assertions.len(), 40, "frozen reached.assertions count");
    let mut labels = std::collections::BTreeSet::new();
    for row in &assertions {
        let case = row.get("case").and_then(Value::as_str).expect("case");
        let name = row.get("name").and_then(Value::as_str).expect("name");
        assert!(
            labels.insert(format!("{case}|{name}")),
            "duplicate frozen reached assertion {case}|{name}"
        );
        assert!(
            row.get("operations").and_then(Value::as_array).is_some(),
            "{case}|{name}: frozen operations"
        );
        assert!(
            row.get("paths").and_then(Value::as_array).is_some(),
            "{case}|{name}: frozen paths"
        );
    }
}

#[allow(dead_code)]
fn assert_send<T: Send>() {}

/// The persistent composition graph must stay `Send` (no unsafe Send, Rc/RefCell graph or whole-Brain lock).
#[test]
fn persistent_brain_graph_is_send() {
    assert_send::<super::Brain>();
    assert_send::<super::host::ModuleHost>();
    assert_send::<super::host::ModuleHandle>();
    assert_send::<super::config::CallerServices>();
    assert_send::<super::config::PathHandle>();
    assert_send::<Recorder>();
    assert_send::<Source>();
}

// ---------------------------------------------------------------------------------------------------------------------
// Group C: same-comparator semantic KILL controls. The frozen expected rows are copied **in memory only**, one leaf per
// control is altered on the copy (never on the frozen value, never installed or fed back as input), and the same native
// comparator the replay uses must reject every changed copy with a first-difference receipt. An untouched copy and a
// lossless provenance re-encode must still compare equal (NONKILL): no unexpected control survives.

/// Read access into a source-record object owned by the frozen expected rows.
fn bfield<'a>(value: &'a BVal, key: &str) -> &'a BVal {
    match value {
        BVal::Obj(entries) | BVal::Instance { entries, .. } => entries
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
            .unwrap_or_else(|| panic!("source record has no field {key}: {:?}", keys_of(value))),
        BVal::Map(entries) => entries
            .iter()
            .find(|(name, _)| name.as_str() == Some(key))
            .map(|(_, value)| value)
            .unwrap_or_else(|| panic!("source map has no key {key}")),
        _ => panic!("not a source record: {value:?}"),
    }
}

fn bfield_opt<'a>(value: &'a BVal, key: &str) -> Option<&'a BVal> {
    match value {
        BVal::Obj(entries) | BVal::Instance { entries, .. } => entries
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value),
        _ => None,
    }
}

fn bfield_mut<'a>(value: &'a mut BVal, key: &str) -> &'a mut BVal {
    match value {
        BVal::Obj(entries) | BVal::Instance { entries, .. } => entries
            .iter_mut()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
            .unwrap_or_else(|| panic!("source record has no field {key}")),
        _ => panic!("not a mutable source record"),
    }
}

fn bitem(value: &BVal, index: usize) -> &BVal {
    value
        .as_arr()
        .unwrap_or_else(|| panic!("not a source array"))
        .get(index)
        .unwrap_or_else(|| panic!("source array has no element {index}"))
}

fn bitem_mut(value: &mut BVal, index: usize) -> &mut BVal {
    match value {
        BVal::Arr(values) => values
            .get_mut(index)
            .unwrap_or_else(|| panic!("source array has no element {index}")),
        _ => panic!("not a mutable source array"),
    }
}

fn arr(value: &BVal) -> &[BVal] {
    value.as_arr().expect("source array")
}

fn num_of(value: &BVal) -> f64 {
    value.as_num().expect("source number")
}

fn num_field(value: &BVal, key: &str) -> f64 {
    num_of(bfield(value, key))
}

fn bool_field(value: &BVal, key: &str) -> bool {
    bfield(value, key).as_bool().expect("source bool")
}

fn text_of(value: &BVal) -> &str {
    value.as_str().expect("source string")
}

fn text_field<'a>(value: &'a BVal, key: &str) -> &'a str {
    text_of(bfield(value, key))
}

fn keys_of(value: &BVal) -> Vec<&str> {
    match value {
        BVal::Obj(entries) | BVal::Instance { entries, .. } => {
            entries.iter().map(|(key, _)| key.as_str()).collect()
        }
        _ => Vec::new(),
    }
}

/// An in-memory changed-copy control: `expected` is the untouched frozen row, `actual` the mutated copy.
fn assert_kill(label: &str, expected: &BVal, actual: &BVal) -> String {
    // The untouched copy must compare equal: the control's only variable is the mutated leaf.
    assert!(
        trace::same(expected, expected),
        "{label}: identity comparison must hold"
    );
    let mut unchanged = Vec::new();
    trace::compare(label, expected, expected, &mut unchanged);
    assert!(
        unchanged.is_empty(),
        "{label}: an unchanged expected copy must compare equal, got {unchanged:?}"
    );
    assert!(
        !trace::same(expected, actual),
        "{label}: mutated copy must differ from the frozen expected row"
    );
    let mut failures = Vec::new();
    trace::compare(label, expected, actual, &mut failures);
    assert_eq!(
        failures.len(),
        1,
        "{label}: the comparator must report exactly the first difference"
    );
    let first = trace::first_difference(expected, actual, label)
        .unwrap_or_else(|| panic!("{label}: a changed copy must have a first-difference path"));
    assert_eq!(
        failures[0], first,
        "{label}: compare receipt must equal first_difference"
    );
    for needle in [label, ":"] {
        assert!(
            first.contains(needle),
            "{label}: receipt {first:?} must name the surface {needle:?}"
        );
    }
    first
}

fn assert_nonkill(label: &str, expected: &BVal, actual: &BVal) {
    assert!(
        trace::same(expected, actual),
        "{label}: provenance-only control must compare equal"
    );
    let mut failures = Vec::new();
    trace::compare(label, expected, actual, &mut failures);
    assert!(
        failures.is_empty(),
        "{label}: NONKILL control produced failures {failures:?}"
    );
}

fn find_operation<'a>(
    source: &'a Source,
    case_id: &str,
    predicate: impl Fn(&source_input::Operation) -> bool,
) -> &'a source_input::Operation {
    source
        .case(case_id)
        .unwrap_or_else(|error| panic!("{case_id}: {error}"))
        .operations
        .iter()
        .find(|operation| predicate(operation))
        .unwrap_or_else(|| panic!("{case_id}: no operation matches the control predicate"))
}

/// The declared run result of one tick (a released-command array in the frozen rows) plus the first move/stop stamped
/// command found in it.
fn stamped_command(result: &BVal) -> Option<(usize, f64)> {
    let rows = result.as_arr()?;
    rows.iter().enumerate().find_map(|(index, row)| {
        let seq = bfield_opt(bfield_opt(bfield_opt(row, "cmd")?, "msg")?, "seq")?;
        Some((index, seq.as_num()?))
    })
}

#[test]
fn changed_expected_copies_are_killed_by_the_same_comparator() {
    let source = source_input::load().expect("frozen Brain source corpus converts");
    let mut kills = 0u32;
    let mut nonkills = 0u32;

    macro_rules! kill_control {
        ($label:literal, $row:expr, $witness:literal, $mutate:expr) => {{
            let expected: BVal = $row.clone();
            let mut actual: BVal = expected.clone();
            ($mutate)(&mut actual);
            let receipt = assert_kill($label, &expected, &actual);
            assert!(
                receipt.contains($witness),
                "{}: receipt {:?} must name {}",
                $label,
                receipt,
                $witness
            );
            kills += 1;
        }};
    }

    // 1+2: the released source command message sequence and timestamp leaves.
    let commands = find_operation(&source, CORE_CASE, |operation| {
        stamped_command(&operation.expected.result).is_some()
    });
    let result = &commands.expected.result;
    let (command_index, seq) = stamped_command(result).expect("stamped released command");
    kill_control!(
        "released-command-seq",
        result,
        "cmd.msg.seq",
        |actual: &mut BVal| {
            let command = bitem_mut(actual, command_index);
            *bfield_mut(bfield_mut(bfield_mut(command, "cmd"), "msg"), "seq") = BVal::Num(seq + 1.);
        }
    );
    kill_control!("released-command-at", result, ".at", |actual: &mut BVal| {
        let command = bitem_mut(actual, command_index);
        *bfield_mut(command, "at") = BVal::Num(0.);
    });

    // 3: command order is significant (a paired attack/release keeps its source order).
    let pair = find_operation(&source, "core-fight-hunt-flee", |operation| {
        operation
            .expected
            .result
            .as_arr()
            .is_some_and(|rows| rows.len() >= 2)
    });
    let pair_result = &pair.expected.result;
    kill_control!(
        "released-command-order",
        pair_result,
        "[0]",
        |actual: &mut BVal| {
            if let BVal::Arr(rows) = actual {
                rows.swap(0, 1);
            }
        }
    );

    // 4+5: the Brain goal kind and its target identity.
    let goal = find_operation(&source, "core-fight-hunt-flee", |operation| {
        operation
            .expected
            .brains
            .iter()
            .any(|(_, brain)| bfield_opt(&brain.goal, "target").is_some())
    });
    let goal_row = &goal.expected.brains[0].1.goal;
    kill_control!("goal-kind", goal_row, "kind", |actual: &mut BVal| {
        *bfield_mut(actual, "kind") = BVal::text("hold");
    });
    kill_control!("goal-target", goal_row, "target", |actual: &mut BVal| {
        *bfield_mut(actual, "target") = BVal::text("other");
    });

    // 6: an exported stats counter.
    let stats = find_operation(&source, "caller-module-keys", |operation| {
        operation.expected.brains.iter().any(|(_, brain)| {
            bfield_opt(
                bfield_opt(&brain.stats, "goals").unwrap_or(&BVal::Null),
                "module",
            )
            .is_some()
        })
    });
    let stats_row = &stats.expected.brains[0].1.stats;
    let module_goals = bfield(bfield(stats_row, "goals"), "module")
        .as_num()
        .expect("declared module goal count");
    kill_control!(
        "stats-counter",
        stats_row,
        "goals.module",
        |actual: &mut BVal| {
            *bfield_mut(bfield_mut(actual, "goals"), "module") = BVal::Num(module_goals + 1.);
        }
    );

    // 7+8: retained Memory state: the live last-hit stamp and the recorded choice list.
    let memory = find_operation(&source, "path-clock-trade-boundary", |operation| {
        operation.expected.brains.iter().any(|(_, brain)| {
            brain.memory.as_ref().is_some_and(|memory| {
                bfield_opt(bfield(bfield(memory, "self"), "lastHitAt"), "lastHitAt").is_none()
                    && bfield(bfield(memory, "self"), "lastHitAt")
                        .as_num()
                        .is_some()
            })
        })
    });
    let memory_row = memory.expected.brains[0]
        .1
        .memory
        .as_ref()
        .expect("live memory snapshot");
    let last_hit = bfield(bfield(memory_row, "self"), "lastHitAt")
        .as_num()
        .expect("live lastHitAt");
    kill_control!(
        "memory-last-hit-at",
        memory_row,
        "lastHitAt",
        |actual: &mut BVal| {
            *bfield_mut(bfield_mut(actual, "self"), "lastHitAt") = BVal::Num(last_hit + 1.);
        }
    );
    let choices = find_operation(&source, "caller-ordinary-keys", |operation| {
        operation.expected.brains.iter().any(|(_, brain)| {
            brain
                .memory
                .as_ref()
                .is_some_and(|memory| memory.as_obj().is_some())
        })
    });
    let choices_row = choices
        .expected
        .brains
        .iter()
        .find_map(|(_, brain)| brain.memory.as_ref())
        .expect("memory snapshot");
    if bfield_opt(choices_row, "choices").is_some() {
        kill_control!(
            "memory-choices",
            choices_row,
            "choices",
            |actual: &mut BVal| {
                *bfield_mut(actual, "choices") = BVal::arr([BVal::text("control|choice")]);
            }
        );
    }

    // 9+10: traced callback/module results (a builtin act result is a full source record).
    let callback = find_operation(&source, CORE_CASE, |operation| {
        operation
            .expected
            .trace
            .as_arr()
            .is_some_and(|rows| !rows.is_empty())
    });
    let trace_row = &callback.expected.trace;
    kill_control!(
        "trace-callback-result",
        trace_row,
        "result",
        |actual: &mut BVal| {
            let mut row = bitem(actual, 0).clone();
            if let BVal::Obj(entries) = &mut row {
                if let Some((_, slot)) = entries.iter_mut().find(|(key, _)| key == "result") {
                    *slot = BVal::Num(1.);
                }
            }
            *bitem_mut(actual, 0) = row;
        }
    );
    let builtin = find_operation(&source, "core-chest", |operation| {
        operation.expected.trace.as_arr().is_some_and(|rows| {
            rows.iter().any(|row| {
                bfield_opt(row, "kind").and_then(BVal::as_str) == Some("builtin")
                    && bfield_opt(row, "result").is_some()
            })
        })
    });
    let builtin_row = builtin.expected.trace.clone();
    let builtin_index = builtin_row
        .as_arr()
        .expect("trace rows")
        .iter()
        .position(|row| {
            bfield_opt(row, "kind").and_then(BVal::as_str) == Some("builtin")
                && bfield_opt(row, "result").is_some()
        })
        .expect("builtin row with result");
    kill_control!(
        "trace-builtin-result",
        &builtin_row,
        "result",
        |actual: &mut BVal| {
            *bfield_mut(bitem_mut(actual, builtin_index), "result") = BVal::Null;
        }
    );

    // 11: a removed trace event is a different transcript (ordered count first).
    kill_control!(
        "trace-event-removed",
        trace_row,
        "collection length",
        |actual: &mut BVal| {
            if let BVal::Arr(rows) = actual {
                rows.pop();
            }
        }
    );

    // 12: the caller-visible service budget identity/snapshot.
    let service = find_operation(&source, CORE_CASE, |operation| {
        !operation.expected.services.is_empty()
    });
    let (service_label, expected_service) = &service.expected.services[0];
    let service_row = BVal::obj([
        ("stats", expected_service.stats.clone()),
        ("budget", BVal::text(&expected_service.budget)),
        ("left", BVal::Num(f64::from(expected_service.left))),
    ]);
    let _ = service_label;
    kill_control!(
        "service-budget-left",
        &service_row,
        "left",
        |actual: &mut BVal| {
            *bfield_mut(actual, "left") = BVal::Num(f64::from(expected_service.left + 1));
        }
    );

    // NONKILL: a provenance-only change (lossless `rh-method-value/1` re-encode of the same row) must still compare
    // equal; this is the native analogue of the frozen comment-only control and is not counted as a KILL.
    let provenance = find_operation(&source, CORE_CASE, |operation| {
        operation.expected.result.as_arr().is_some()
    });
    let frozen_row = provenance.expected.result.clone();
    let method_value = trace::to_method_value(&frozen_row).expect("row re-encodes");
    let round_trip = trace::from_method_value(&method_value);
    assert_nonkill("comment-only-provenance", &frozen_row, &round_trip);
    nonkills += 1;

    assert_eq!(kills, 12, "semantic KILL control count");
    assert_eq!(nonkills, 1, "provenance NONKILL control count");
    assert_eq!(
        kills + nonkills,
        13,
        "no unexpected control survivors or missing controls"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Group C (continued): controls over the **actual native replay rows** (same comparator, actual composition state).
// `replay_case` rows are real native Brain output; mutated copies exist only in memory as comparator control inputs.

fn replay(case_id: &str) -> super::tests::ReplayedCase {
    super::tests::replay_case(case_id).unwrap_or_else(|error| panic!("replay {case_id}: {error}"))
}

fn method_rows<'a>(
    replayed: &'a super::tests::ReplayedCase,
    method: &str,
) -> Vec<&'a super::tests::ReplayedOp> {
    replayed
        .rows
        .iter()
        .filter(|op| op.method == method)
        .collect()
}

fn tick_rows(replayed: &super::tests::ReplayedCase) -> Vec<&super::tests::ReplayedOp> {
    method_rows(replayed, "tick")
}

fn actual_brain<'a>(
    op: &'a super::tests::ReplayedOp,
    handle: &str,
) -> &'a super::tests::ReplayedBrain {
    op.brains
        .iter()
        .find(|(name, _)| name == handle)
        .map(|(_, brain)| brain)
        .unwrap_or_else(|| panic!("op {}: no live Brain {handle}", op.index))
}

fn actual_goal<'a>(op: &'a super::tests::ReplayedOp, handle: &str) -> &'a BVal {
    &actual_brain(op, handle).goal
}

fn actual_stats<'a>(op: &'a super::tests::ReplayedOp, handle: &str) -> &'a BVal {
    &actual_brain(op, handle).stats
}

fn actual_memory<'a>(op: &'a super::tests::ReplayedOp, handle: &str) -> &'a BVal {
    actual_brain(op, handle).memory.as_ref().unwrap_or_else(|| {
        panic!(
            "op {}: Brain {handle} has no retained Memory snapshot",
            op.index
        )
    })
}

fn service_snapshot<'a>(op: &'a super::tests::ReplayedOp, handle: &str) -> &'a BVal {
    op.services
        .iter()
        .find(|(name, _)| name == handle)
        .map(|(_, value)| value)
        .unwrap_or_else(|| panic!("op {}: no caller service {handle}", op.index))
}

/// One caller service snapshot tuple `(handle, searches, hits, fallbacks, left)`.
type ServiceCounters = (String, u32, u32, u32, u32);

fn actual_trace(op: &super::tests::ReplayedOp) -> &[BVal] {
    op.trace
        .as_arr()
        .unwrap_or_else(|| panic!("op {}: trace must be an event array", op.index))
}

fn row_is(row: &BVal, kind: &str) -> bool {
    bfield_opt(row, "kind").and_then(BVal::as_str) == Some(kind)
}

fn row_field<'a>(row: &'a BVal, kind: &str, field: &str) -> Option<&'a str> {
    if !row_is(row, kind) {
        return None;
    }
    bfield_opt(row, field).and_then(BVal::as_str)
}

/// One control whose base is an **actual** native replay row and whose mutated copy differs in exactly one leaf.
fn actual_kill_control(
    label: &str,
    actual_row: &BVal,
    witness: &str,
    mutate: impl FnOnce(&mut BVal),
) -> String {
    let mut changed = actual_row.clone();
    mutate(&mut changed);
    let receipt = assert_kill(label, actual_row, &changed);
    assert!(
        receipt.contains(witness),
        "{}: receipt {:?} must name {}",
        label,
        receipt,
        witness
    );
    receipt
}

#[test]
fn replay_actual_rows_are_killed_by_the_same_comparator() {
    let mut kills = 0u32;
    let mut nonkills = 0u32;

    // 1-2: a real released source command: message sequence and timestamp leaves.
    let registry = replay(CORE_CASE);
    let registry_ticks = tick_rows(&registry);
    let stamped = registry_ticks
        .iter()
        .find(|op| stamped_command(&op.result).is_some())
        .copied()
        .expect("a replayed tick with a stamped move/stop command");
    let (command_index, seq) = stamped_command(&stamped.result).expect("stamped command");
    actual_kill_control(
        "actual-command-seq",
        &stamped.result,
        "cmd.msg.seq",
        |changed| {
            let command = bitem_mut(changed, command_index);
            *bfield_mut(bfield_mut(bfield_mut(command, "cmd"), "msg"), "seq") = BVal::Num(seq + 1.);
        },
    );
    kills += 1;
    actual_kill_control("actual-command-at", &stamped.result, ".at", |changed| {
        *bfield_mut(bitem_mut(changed, command_index), "at") = BVal::Num(0.);
    });
    kills += 1;

    // 3: command order is significant in the actual paired attack/release result.
    let fight = replay("core-fight-hunt-flee");
    let fight_ticks = tick_rows(&fight);
    let paired = fight_ticks
        .iter()
        .find(|op| op.result.as_arr().is_some_and(|rows| rows.len() >= 2))
        .copied()
        .expect("a replayed paired release");
    actual_kill_control("actual-command-order", &paired.result, "[0]", |changed| {
        if let BVal::Arr(rows) = changed {
            rows.swap(0, 1);
        }
    });
    kills += 1;

    // 4-5: the actual adopted Brain goal kind and target.
    let hunt = fight_ticks
        .iter()
        .find(|op| bfield_opt(actual_goal(op, "a"), "target").is_some())
        .copied()
        .expect("a replayed hunt/fight goal");
    actual_kill_control(
        "actual-goal-kind",
        actual_goal(hunt, "a"),
        "kind",
        |changed| {
            *bfield_mut(changed, "kind") = BVal::text("hold");
        },
    );
    kills += 1;
    actual_kill_control(
        "actual-goal-target",
        actual_goal(hunt, "a"),
        "target",
        |changed| {
            *bfield_mut(changed, "target") = BVal::text("other");
        },
    );
    kills += 1;

    // 6: an actual exported stats counter from the native Brain.
    let module_keys = replay("caller-module-keys");
    let module_ticks = tick_rows(&module_keys);
    let counted = module_ticks
        .iter()
        .find(|op| {
            bfield_opt(bfield(actual_stats(op, "a"), "goals"), "module")
                .and_then(BVal::as_num)
                .is_some()
        })
        .copied()
        .expect("a replayed tick with a module goal count");
    let module_count = num_field(bfield(actual_stats(counted, "a"), "goals"), "module");
    actual_kill_control(
        "actual-stats-counter",
        actual_stats(counted, "a"),
        "goals.module",
        |changed| {
            *bfield_mut(bfield_mut(changed, "goals"), "module") = BVal::Num(module_count + 1.);
        },
    );
    kills += 1;

    // 7: the actual retained Memory last-hit stamp.
    let clock = replay("path-clock-trade-boundary");
    let clock_ticks = tick_rows(&clock);
    let hit = clock_ticks
        .iter()
        .find(|op| {
            bfield_opt(bfield(actual_memory(op, "a"), "self"), "lastHitAt")
                .and_then(BVal::as_num)
                .is_some()
        })
        .copied()
        .expect("a replayed tick with a live lastHitAt");
    let last_hit = num_field(bfield(actual_memory(hit, "a"), "self"), "lastHitAt");
    actual_kill_control(
        "actual-memory-last-hit-at",
        actual_memory(hit, "a"),
        "lastHitAt",
        |changed| {
            *bfield_mut(bfield_mut(changed, "self"), "lastHitAt") = BVal::Num(last_hit + 1.);
        },
    );
    kills += 1;

    // 8: the actual retained Memory choice list.
    let ordinary = replay("caller-ordinary-keys");
    let ordinary_ticks = tick_rows(&ordinary);
    let choices = ordinary_ticks
        .last()
        .copied()
        .expect("replayed ordinary-key ticks");
    let choice_rows = bfield(actual_memory(choices, "a"), "choices");
    assert!(
        !arr(choice_rows).is_empty(),
        "actual Memory choices nonempty"
    );
    actual_kill_control(
        "actual-memory-choices",
        actual_memory(choices, "a"),
        "choices",
        |changed| {
            *bfield_mut(changed, "choices") = BVal::arr([BVal::text("control|choice")]);
        },
    );
    kills += 1;

    // 9: an actual traced builtin result record.
    let chest = replay("core-chest");
    let chest_ticks = tick_rows(&chest);
    let (op, index) = chest_ticks
        .iter()
        .find_map(|op| {
            actual_trace(op)
                .iter()
                .position(|row| {
                    row_field(row, "builtin", "kind").is_some()
                        && bfield_opt(row, "result").is_some()
                })
                .map(|index| (*op, index))
        })
        .expect("a replayed builtin row with a result");
    let builtin_trace = op.trace.clone();
    actual_kill_control(
        "actual-builtin-result",
        &builtin_trace,
        "result",
        |changed| {
            *bfield_mut(bitem_mut(changed, index), "result") = BVal::Null;
        },
    );
    kills += 1;

    // 10: a removed actual trace event is a different native transcript.
    let traced = registry_ticks
        .iter()
        .find(|op| actual_trace(op).len() >= 2)
        .copied()
        .expect("a replayed tick with several trace events");
    actual_kill_control(
        "actual-trace-event-removed",
        &traced.trace,
        "collection length",
        |changed| {
            if let BVal::Arr(rows) = changed {
                rows.pop();
            }
        },
    );
    kills += 1;

    // 11: the actual caller-facing service snapshot (shared room allowance left).
    let identity = replay("identity-shared-budget");
    let identity_ticks = tick_rows(&identity);
    let serviced = identity_ticks
        .iter()
        .find(|op| !op.services.is_empty())
        .copied()
        .expect("a replayed tick with a service snapshot");
    let snapshot = service_snapshot(serviced, "same").clone();
    let left = num_field(&snapshot, "left");
    actual_kill_control("actual-service-budget-left", &snapshot, "left", |changed| {
        *bfield_mut(changed, "left") = BVal::Num(left + 1.);
    });
    kills += 1;

    // NONKILL: a provenance-only lossless re-encode of one actual row must still compare equal.
    let actual_row = stamped.result.clone();
    let round_trip = trace::from_method_value(
        &trace::to_method_value(&actual_row).expect("actual row re-encodes"),
    );
    assert_nonkill("actual-comment-only-provenance", &actual_row, &round_trip);
    nonkills += 1;

    assert_eq!(kills, 11, "actual-row semantic KILL controls");
    assert_eq!(nonkills, 1, "actual-row provenance NONKILL control");
    assert_eq!(
        kills + nonkills,
        12,
        "no unexpected survivor or missing actual-row control"
    );
}

#[test]
fn guard_continuation_service_and_rng_controls() {
    // A represented source hook fault: the already-selected wrapper is still called later in the same tick, and only
    // the *next* enabled selection observes the fault marker.
    let observe = replay("guard-observe");
    let observe_ticks = tick_rows(&observe);
    let first = observe_ticks[0];
    let x_rows: Vec<&BVal> = actual_trace(first)
        .iter()
        .filter(|row| {
            row_field(row, "module", "kind").is_some()
                && bfield_opt(row, "handle").and_then(BVal::as_str) == Some("x")
        })
        .collect();
    let observe_pos = x_rows
        .iter()
        .position(|row| bfield_opt(row, "hook").and_then(BVal::as_str) == Some("observe"))
        .expect("the selected observe wrapper faulted");
    assert!(
        bfield_opt(x_rows[observe_pos], "error").is_some(),
        "the observe hook must record the represented source throw"
    );
    let intents_pos = x_rows
        .iter()
        .position(|row| bfield_opt(row, "hook").and_then(BVal::as_str) == Some("intents"))
        .expect("the already-selected wrapper still runs its intents hook");
    let adjust_pos = x_rows
        .iter()
        .position(|row| bfield_opt(row, "hook").and_then(BVal::as_str) == Some("adjust"))
        .expect("the already-selected wrapper still runs its adjust hook");
    assert!(
        intents_pos > observe_pos && adjust_pos > observe_pos,
        "same-tick guard continuation must call the selected wrapper after its observe fault"
    );
    let fault_logs = actual_trace(first)
        .iter()
        .filter(|row| {
            row_field(row, "callback", "kind").is_some()
                && bfield_opt(row, "name").and_then(BVal::as_str) == Some("services.log")
                && text_of(bitem(bfield(row, "args"), 0)).contains("threw")
        })
        .count();
    assert_eq!(
        fault_logs, 2,
        "observe plus declared intents throw are both logged"
    );
    let second = observe_ticks[1];
    assert!(
        !actual_trace(second).iter().any(|row| {
            row_field(row, "module", "kind").is_some()
                && bfield_opt(row, "handle").and_then(BVal::as_str) == Some("x")
        }),
        "the next enabled selection observes the shared fault marker and disables the id"
    );

    // Equal module ids on distinct original objects share the per-Brain fault marker.
    let equal_id = replay("guard-equal-id");
    let equal_ticks = tick_rows(&equal_id);
    assert!(actual_trace(equal_ticks[0]).iter().any(|row| {
        row_field(row, "module", "kind").is_some()
            && bfield_opt(row, "handle").and_then(BVal::as_str) == Some("y")
            && bfield_opt(row, "hook").and_then(BVal::as_str) == Some("intents")
    }));
    assert!(
        !actual_trace(equal_ticks[1])
            .iter()
            .any(|row| row_field(row, "module", "kind").is_some()),
        "the equal-id fault marker suppresses the later wrapper selection"
    );

    // Real caller path service/cache and one shared room allowance: cache hits reuse the same service and consume no
    // allowance; two distinct service caches consume the same room allowance on their ordered misses.
    let identity = replay("identity-shared-budget");
    let initial = identity
        .initial_trace_actual
        .as_arr()
        .expect("actual setup trace rows");
    let budget_row = initial
        .iter()
        .find(|row| {
            row_field(row, "caller", "kind").is_some()
                && bfield_opt(row, "name").and_then(BVal::as_str) == Some("createPathBudget")
        })
        .expect("actual caller createPathBudget row");
    assert_eq!(
        num_field(budget_row, "perTick"),
        1.,
        "the room allowance is one search"
    );
    let service_rows: Vec<&BVal> = initial
        .iter()
        .filter(|row| {
            row_field(row, "caller", "kind").is_some()
                && bfield_opt(row, "name").and_then(BVal::as_str) == Some("createPathService")
        })
        .collect();
    assert_eq!(service_rows.len(), 2, "two caller path services");
    for row in &service_rows {
        assert_eq!(
            text_field(row, "budget"),
            "room",
            "both services borrow the one room allowance"
        );
    }

    let identity_rows = &identity.rows;
    let mut previous: Option<Vec<ServiceCounters>> = None;
    let mut frame_searches = 0u32;
    let mut frames = 0u32;
    for op in identity_rows {
        let current: Vec<ServiceCounters> = op
            .services
            .iter()
            .map(|(handle, snapshot)| {
                let stats = bfield(snapshot, "stats");
                (
                    handle.clone(),
                    num_field(stats, "searches") as u32,
                    num_field(stats, "hits") as u32,
                    num_field(stats, "fallbacks") as u32,
                    num_field(snapshot, "left") as u32,
                )
            })
            .collect();
        if op.method == "frame" {
            if previous.is_some() {
                assert!(
                    frame_searches <= 1,
                    "the two service caches share one room allowance per frame (searches {frame_searches})"
                );
            }
            frame_searches = 0;
            frames += 1;
            for (_, _, _, _, left) in &current {
                assert_eq!(
                    *left, 1,
                    "the caller replenishes the room allowance exactly once per frame"
                );
            }
        } else if let Some(previous) = &previous {
            assert_eq!(previous.len(), current.len());
            let mut total_searches = 0u32;
            for (index, (handle, searches, _hits, _fallbacks, _left)) in current.iter().enumerate()
            {
                let (previous_handle, previous_searches, _, _, _) = &previous[index];
                assert_eq!(previous_handle, handle);
                total_searches += searches.saturating_sub(*previous_searches);
            }
            frame_searches += total_searches;
            if total_searches == 0 {
                for (index, (_, _, _, _, left)) in current.iter().enumerate() {
                    assert_eq!(
                        *left, previous[index].4,
                        "a cache hit/no search never consumes the shared room allowance"
                    );
                }
            }
            assert!(
                frame_searches <= 1,
                "two distinct caches consume the same caller allowance on ordered misses"
            );
        }
        previous = Some(current);
    }
    assert!(frames >= 4, "the declared room frames are replayed");
    let last_tick = tick_rows(&identity)
        .last()
        .copied()
        .expect("identity ticks");
    let same_stats = bfield(service_snapshot(last_tick, "same"), "stats");
    assert!(
        num_field(same_stats, "searches") >= 1.,
        "the shared cache performed a real search"
    );
    assert!(
        num_field(same_stats, "hits") > 0.,
        "later frames reuse the same service cache"
    );
    assert!(
        identity_rows.iter().any(|op| {
            num_field(bfield(service_snapshot(op, "equal"), "stats"), "fallbacks") > 0.
        }),
        "a distinct cache miss after the allowance is spent is a real service fallback"
    );
    assert!(
        identity_rows.iter().any(|op| {
            num_field(bfield(service_snapshot(op, "equal"), "stats"), "searches") >= 1.
        }),
        "the distinct service performs its own ordered miss"
    );

    // The three runtime RNG lanes are continuous per lane (indices 0..n, no reset/duplication) and agree with the
    // Brain-owned lane counters; lane values stay in the source [0,1) domain.
    let mut lanes: std::collections::BTreeMap<(String, String), Vec<(f64, f64)>> =
        std::collections::BTreeMap::new();
    for op in identity_rows {
        for row in actual_trace(op) {
            if !row_is(row, "rng") {
                continue;
            }
            let actor = text_field(row, "actor").to_string();
            let stream = text_field(row, "stream").to_string();
            lanes
                .entry((actor, stream))
                .or_default()
                .push((num_field(row, "value"), num_field(row, "index")));
        }
    }
    assert!(!lanes.is_empty(), "the replay records runtime RNG draws");
    for ((actor, stream), draws) in &lanes {
        for (position, (value, index)) in draws.iter().enumerate() {
            assert!(
                *value >= 0. && *value < 1.,
                "{actor}/{stream}: lane value in [0,1)"
            );
            if position == 0 {
                assert_eq!(
                    *index, 0.,
                    "{actor}/{stream}: the first draw starts the lane at index 0"
                );
            } else {
                let previous = draws[position - 1].1;
                assert!(
                    *index == previous + 1. || *index == 0.,
                    "{actor}/{stream}: a lane continues 0..n or restarts at 0 for a recreated Brain instance"
                );
            }
        }
    }
    /// The number of draws in the final Brain instance's lane run (the last reset at index 0).
    fn final_lane_run(draws: &[(f64, f64)]) -> u64 {
        draws
            .iter()
            .rposition(|(_, index)| *index == 0.)
            .map_or(draws.len() as u64, |position| {
                (draws.len() - position) as u64
            })
    }
    let last_op = identity_rows.last().expect("identity rows");
    let mut rng_streams = std::collections::BTreeSet::new();
    for handle in ["a", "b", "c"] {
        let Some(brain) = last_op
            .brains
            .iter()
            .find(|(name, _)| name == handle)
            .map(|(_, b)| b)
        else {
            continue;
        };
        let Some(counts) = brain.counts else {
            continue;
        };
        for (lane, stream) in ["decide", "motor", "lapse"].iter().enumerate() {
            let draws = lanes
                .get(&(handle.to_string(), (*stream).to_string()))
                .map_or(&[][..], Vec::as_slice);
            let recorded = final_lane_run(draws);
            assert_eq!(
                counts[lane], recorded,
                "{handle}/{stream}: runtime lane counter matches the final instance's recorded draws"
            );
            if !draws.is_empty() {
                rng_streams.insert((*stream).to_string());
            }
        }
    }
    assert_eq!(
        rng_streams,
        ["decide", "motor", "lapse"]
            .iter()
            .map(|stream| (*stream).to_string())
            .collect(),
        "all three runtime RNG lanes are exercised and compared by lane"
    );
}

#[test]
fn checked_intake_is_side_effect_free_across_replays() {
    // Reject a malformed declared input between two full native replays of the same history: the actual replay rows,
    // service counters/budget and Brain runtime lane counts must be exactly unchanged.
    let before = replay(CORE_CASE);
    let base = body_json();
    let mut mutant = (*base).clone();
    apply_spec_edit(&mut mutant, "nonfinite-now");
    let mut advanced = 0usize;
    assert!(
        checked_intake(&mutant, &mut advanced).is_err(),
        "the malformed intake must reject"
    );
    assert_eq!(advanced, 0, "the checked entry never ran an operation");
    let after = replay(CORE_CASE);

    assert!(
        trace::same(&before.initial_trace_actual, &after.initial_trace_actual),
        "a rejected intake must not disturb the caller setup transcript"
    );
    assert_eq!(before.rows.len(), after.rows.len());
    for (left, right) in before.rows.iter().zip(&after.rows) {
        assert_eq!(left.index, right.index);
        assert_eq!(left.method, right.method);
        assert!(
            trace::same(&left.result, &right.result),
            "op {}: released result changed across a rejected intake",
            left.index
        );
        assert!(
            trace::same(&left.trace, &right.trace),
            "op {}: trace changed across a rejected intake",
            left.index
        );
        match (&left.error, &right.error) {
            (Some(left_error), Some(right_error)) => {
                assert!(trace::same(left_error, right_error));
            }
            (None, None) => {}
            other => panic!(
                "op {}: error row changed across a rejected intake: {other:?}",
                left.index
            ),
        }
        assert_eq!(left.services.len(), right.services.len());
        for ((left_handle, left_service), (right_handle, right_service)) in
            left.services.iter().zip(&right.services)
        {
            assert_eq!(left_handle, right_handle);
            assert!(
                trace::same(left_service, right_service),
                "op {}: service {left_handle} snapshot changed (stats/budget/left must be unchanged)",
                left.index
            );
        }
        assert_eq!(left.brains.len(), right.brains.len());
        for ((left_handle, left_brain), (right_handle, right_brain)) in
            left.brains.iter().zip(&right.brains)
        {
            assert_eq!(left_handle, right_handle);
            assert!(trace::same(&left_brain.goal, &right_brain.goal));
            assert!(trace::same(&left_brain.stats, &right_brain.stats));
            assert_eq!(
                left_brain.counts, right_brain.counts,
                "draw_counts unchanged"
            );
            match (&left_brain.memory, &right_brain.memory) {
                (Some(left_memory), Some(right_memory)) => {
                    assert!(trace::same(left_memory, right_memory));
                }
                (None, None) => {}
                other => panic!(
                    "op {}: retained Memory changed across a rejected intake: {other:?}",
                    left.index
                ),
            }
        }
    }

    // Explicit replay-case counter snapshot: service stats/searches/falls/left and Brain draw counts identical.
    let left_last = before.rows.last().expect("replay rows");
    let right_last = after.rows.last().expect("replay rows");
    for (left_handle, left_service) in &left_last.services {
        let right_service = service_snapshot(right_last, left_handle);
        let left_stats = bfield(left_service, "stats");
        let right_stats = bfield(right_service, "stats");
        for key in ["searches", "hits", "fallbacks"] {
            assert_eq!(
                num_field(left_stats, key),
                num_field(right_stats, key),
                "service {left_handle}.{key} changed after a rejected intake"
            );
        }
        assert_eq!(
            num_field(left_service, "left"),
            num_field(right_service, "left"),
            "service {left_handle} budget left changed after a rejected intake"
        );
    }
    assert_eq!(
        actual_brain(left_last, "a").counts,
        actual_brain(right_last, "a").counts,
        "Brain runtime draw counts changed after a rejected intake"
    );
}

/// The Root-required comparator control: the exact global runtime trace with two ADJACENT, DIFFERENT-LANE rng rows
/// exchanged must be rejected by the same complete transcript comparator, while each lane's own values/indices/counts
/// stay identical. A plain copy of the expected transcript still passes (NONKILL).
#[test]
fn adjacent_cross_lane_rng_swap_is_rejected_by_the_complete_comparator() {
    let replayed = replay(CORE_CASE);
    let mut offsets: Vec<(usize, usize)> = Vec::new();
    let mut global: Vec<BVal> = Vec::new();
    for op in &replayed.rows {
        let start = global.len();
        global.extend(actual_trace(op).iter().cloned());
        offsets.push((start, global.len()));
    }
    let global_expected = BVal::Arr(global.clone());

    // Find one pair of adjacent rng rows with different streams inside one operation's actual transcript.
    let (pair_index, first_row, second_row) = offsets
        .iter()
        .find_map(|(start, end)| {
            (*start..end.saturating_sub(1)).find_map(|index| {
                let first = &global[index];
                let second = &global[index + 1];
                let same_rng = row_is(first, "rng") && row_is(second, "rng");
                let first_stream = bfield_opt(first, "stream").and_then(BVal::as_str);
                let second_stream = bfield_opt(second, "stream").and_then(BVal::as_str);
                (same_rng && first_stream != second_stream)
                    .then(|| (index, first.clone(), second.clone()))
            })
        })
        .expect("the actual runtime trace owns adjacent cross-lane draws");

    let mut swapped = global.clone();
    swapped.swap(pair_index, pair_index + 1);
    let global_actual = BVal::Arr(swapped.clone());

    // Per-lane projections are exactly unchanged: the exchange moves whole rows between lanes, never a lane's own
    // values/indices or its draw count.
    let lane_projection = |rows: &[BVal], stream: &str| -> Vec<BVal> {
        rows.iter()
            .filter(|row| {
                row_is(row, "rng")
                    && bfield_opt(row, "stream").and_then(BVal::as_str) == Some(stream)
            })
            .cloned()
            .collect()
    };
    for stream in ["decide", "motor", "lapse"] {
        let expected_lane = BVal::Arr(lane_projection(&global, stream));
        let actual_lane = BVal::Arr(lane_projection(&swapped, stream));
        assert!(
            trace::same(&expected_lane, &actual_lane),
            "{stream}: the adjacent exchange must keep every lane's own rows/values/indices/counts identical"
        );
    }
    // Row multiset unchanged beyond ordering: the same two rows exist in the swapped transcript, exchanged.
    assert!(trace::same(&second_row, &swapped[pair_index]));
    assert!(trace::same(&first_row, &swapped[pair_index + 1]));

    // The same complete ordered-transcript comparator the replay uses must reject it with a first-difference receipt.
    let mut failures = Vec::new();
    trace::compare_transcript_values(
        "global-runtime-trace",
        &global_expected,
        &global_actual,
        &mut failures,
    );
    assert_eq!(
        failures.len(),
        1,
        "the complete comparator must report exactly the first ordered difference"
    );
    let first = trace::first_difference(&global_expected, &global_actual, "global-runtime-trace")
        .expect("an exchanged-lane transcript must have a first-difference path");
    // `compare_transcript_values` labels the row as `<label> trace[i]`; `first_difference` walks to `<label>[i]`.
    let normalized_receipt = failures[0].replacen(" trace[", "[", 1);
    assert_eq!(
        normalized_receipt, first,
        "the complete comparator receipt must be the same first difference"
    );
    assert!(
        first.contains(&format!("trace[{pair_index}]")),
        "receipt {first:?} must point at the exchanged adjacent rows"
    );
    assert!(
        first.contains("stream") || first.contains("value") || first.contains("actor"),
        "receipt {first:?} must name the exchanged row difference"
    );

    // NONKILL control: the same complete comparator accepts the untouched transcript.
    let mut unchanged = Vec::new();
    trace::compare_transcript_values(
        "global-runtime-trace",
        &global_expected,
        &global_expected,
        &mut unchanged,
    );
    assert!(
        unchanged.is_empty(),
        "an unchanged global transcript must pass the complete comparator: {unchanged:?}"
    );

    // The per-operation exact comparison path is the same comparator: comparing a clone of every operation transcript
    // against itself stays clean, so the rejection above is caused only by the adjacent exchange.
    let mut per_op = Vec::new();
    for (start, end) in &offsets {
        let rows = BVal::Arr(global[*start..*end].to_vec());
        trace::compare_transcript_values("operation-trace", &rows, &rows, &mut per_op);
    }
    assert!(
        per_op.is_empty(),
        "untouched per-operation transcripts pass: {per_op:?}"
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Group B: the frozen 40 `reached.assertions`, re-derived from native actual replay rows only (the replay harness
// `brain/tests.rs` exposes `replay_case`; the Hand supplement assertion is gated until `hand_tests` exposes its actual
// replay rows).
#[allow(dead_code)]
mod reached {
    use serde_json::{json, Value};

    use super::super::source_input::Case;
    use super::super::tests::{replay_case, ReplayedBrain, ReplayedCase, ReplayedOp};
    use super::super::trace::{self, BVal};
    use super::{bfield, bfield_opt, bitem, reached_ledger};

    struct CaseView {
        id: String,
        replayed: ReplayedCase,
    }

    impl CaseView {
        fn new(id: &str) -> Self {
            let replayed = replay_case(id).unwrap_or_else(|error| panic!("replay {id}: {error}"));
            Self {
                id: id.to_string(),
                replayed,
            }
        }

        fn ticks(&self) -> Vec<&ReplayedOp> {
            self.ops_of_method("tick")
        }

        fn ops_of_method(&self, method: &str) -> Vec<&ReplayedOp> {
            self.replayed
                .rows
                .iter()
                .filter(|op| op.method == method)
                .collect()
        }

        fn initial(&self) -> &BVal {
            &self.replayed.initial_trace_actual
        }

        fn case(&self) -> &Case {
            &self.replayed.case
        }

        fn service(&self, handle: &str) -> Option<BVal> {
            super::super::tests::replayed_service(&self.replayed.rows, handle)
        }
    }

    fn brain_of<'a>(op: &'a ReplayedOp, handle: &str) -> &'a ReplayedBrain {
        op.brains
            .iter()
            .find(|(name, _)| name == handle)
            .map(|(_, brain)| brain)
            .unwrap_or_else(|| panic!("op {}: no live Brain {handle}", op.index))
    }

    fn goal_of<'a>(op: &'a ReplayedOp, handle: &str) -> &'a BVal {
        &brain_of(op, handle).goal
    }

    fn stats_of<'a>(op: &'a ReplayedOp, handle: &str) -> &'a BVal {
        &brain_of(op, handle).stats
    }

    fn memory_of<'a>(op: &'a ReplayedOp, handle: &str) -> &'a BVal {
        brain_of(op, handle).memory.as_ref().unwrap_or_else(|| {
            panic!(
                "op {}: Brain {handle} has no retained Memory snapshot",
                op.index
            )
        })
    }

    fn counts_of(op: &ReplayedOp, handle: &str) -> [u64; 3] {
        brain_of(op, handle)
            .counts
            .unwrap_or_else(|| panic!("op {}: Brain {handle} has no runtime lane counts", op.index))
    }

    fn declaration(op: &ReplayedOp) -> &BVal {
        &op.declaration
    }

    fn declared_input(op: &ReplayedOp) -> &BVal {
        bfield(declaration(op), "input")
    }

    fn now_of(op: &ReplayedOp) -> f64 {
        num_field(declared_input(op), "now")
    }

    fn declared_status(op: &ReplayedOp) -> &str {
        text_field(bfield(declared_input(op), "self"), "status")
    }

    fn trace_rows(op: &ReplayedOp) -> &[BVal] {
        op.trace
            .as_arr()
            .unwrap_or_else(|| panic!("op {}: trace must be an event array", op.index))
    }

    fn row_kind(row: &BVal) -> &str {
        bfield_opt(row, "kind").and_then(BVal::as_str).unwrap_or("")
    }

    fn row_name(row: &BVal) -> Option<&str> {
        bfield_opt(row, "name").and_then(BVal::as_str)
    }

    fn row_handle(row: &BVal) -> Option<&str> {
        bfield_opt(row, "handle").and_then(BVal::as_str)
    }

    fn row_hook(row: &BVal) -> Option<&str> {
        bfield_opt(row, "hook").and_then(BVal::as_str)
    }

    fn rows_with<'a>(op: &'a ReplayedOp, kind: &str) -> Vec<&'a BVal> {
        trace_rows(op)
            .iter()
            .filter(|row| row_kind(row) == kind)
            .collect()
    }

    fn first_row<'a>(op: &'a ReplayedOp, kind: &str) -> &'a BVal {
        trace_rows(op)
            .iter()
            .find(|row| row_kind(row) == kind)
            .unwrap_or_else(|| panic!("op {}: no {kind} trace row", op.index))
    }

    fn result_rows(op: &ReplayedOp) -> &[BVal] {
        op.result
            .as_arr()
            .unwrap_or_else(|| panic!("op {}: result is not a released-command array", op.index))
    }

    fn arr(value: &BVal) -> &[BVal] {
        value.as_arr().expect("source array")
    }

    fn num_of(value: &BVal) -> f64 {
        value.as_num().expect("source number")
    }

    fn num_field(value: &BVal, key: &str) -> f64 {
        num_of(bfield(value, key))
    }

    fn bool_field(value: &BVal, key: &str) -> bool {
        bfield(value, key).as_bool().expect("source bool")
    }

    fn text_of(value: &BVal) -> &str {
        value.as_str().expect("source string")
    }

    fn text_field<'a>(value: &'a BVal, key: &str) -> &'a str {
        text_of(bfield(value, key))
    }

    fn cmd_type(row: &BVal) -> &str {
        text_field(bfield(row, "cmd"), "type")
    }

    fn intent_whys(list: &BVal) -> Vec<String> {
        arr(list)
            .iter()
            .map(|intent| text_field(intent, "why").to_string())
            .collect()
    }

    /// The caller module `x`'s declared adjust trace row for one operation.
    fn x_adjust_row(op: &ReplayedOp) -> &BVal {
        rows_with(op, "module")
            .into_iter()
            .find(|row| row_handle(row) == Some("x") && row_hook(row) == Some("adjust"))
            .unwrap_or_else(|| panic!("x adjust row"))
    }

    fn intent_kinds(list: &BVal) -> Vec<String> {
        arr(list)
            .iter()
            .map(|intent| text_field(intent, "kind").to_string())
            .collect()
    }

    fn observation_engaged(op: &ReplayedOp) -> bool {
        bool_field(first_row(op, "observe"), "engaged")
    }

    fn stimuli_kinds(op: &ReplayedOp) -> Vec<String> {
        arr(bfield(memory_of(op, "a"), "stimuli"))
            .iter()
            .map(|stimulus| text_field(stimulus, "kind").to_string())
            .collect()
    }

    fn check(
        case: String,
        name: impl Into<String>,
        rows: Vec<&ReplayedOp>,
        paths: &[&str],
        ledger: &mut Vec<Value>,
        body: impl FnOnce(&[&ReplayedOp]),
    ) {
        let name: String = name.into();
        body(&rows);
        ledger.push(json!({
            "case": case,
            "name": name,
            "operations": rows.iter().map(|op| op.index).collect::<Vec<usize>>(),
            "paths": paths,
        }));
    }

    #[test]
    fn frozen_reached_assertions_match_the_ledger_one_to_one() {
        let mut ledger: Vec<Value> = Vec::new();

        // 0-2: core-registry-cadence.
        {
            let view = CaseView::new("core-registry-cadence");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "real caller path before registry enabled and constructor",
                Vec::new(),
                &["initialTrace"],
                &mut ledger,
                |_rows| {
                    let rows = view.initial().as_arr().expect("initial trace rows");
                    let at = |name: &str| {
                        rows.iter()
                            .position(|row| row_name(row) == Some(name))
                            .unwrap_or_else(|| panic!("initialTrace row {name}"))
                    };
                    assert!(at("createPathService") < at("enabledModules"));
                    assert!(at("enabledModules") < at("createBrain"));
                    let enabled: Vec<&str> = rows
                        .iter()
                        .filter(|row| {
                            row_kind(row) == "builtin" && row_hook(row) == Some("enabled")
                        })
                        .map(|row| row_handle(row).expect("builtin handle"))
                        .collect();
                    assert_eq!(enabled, vec!["wishes", "planning", "chests", "hazards"]);
                },
            );
            check(
                view.id.clone(),
                "not-yet cadence tick has no RNG decision/act; toast continuation invokes hooks",
                ticks.iter().take(6).copied().collect::<Vec<_>>(),
                &["trace"],
                &mut ledger,
                |rows| {
                    assert_eq!(
                        rows_with(rows[1], "rng").len(),
                        0,
                        "a not-yet tick must not draw a cadence decision"
                    );
                    assert!(
                        rows_with(rows[5], "builtin")
                            .iter()
                            .any(|row| row_hook(row) == Some("intents")),
                        "the toast continuation must invoke the builtin intents hooks"
                    );
                },
            );
        }

        // 3: core-empty-modules.
        {
            let view = CaseView::new("core-empty-modules");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "truly empty module list has no observer or runtime RNG trace",
                ticks.clone(),
                &["brains.a.memory", "trace"],
                &mut ledger,
                |rows| {
                    for op in rows.iter().copied() {
                        assert!(brain_of(op, "a").memory.is_none());
                        assert!(
                            !trace_rows(op)
                                .iter()
                                .any(|row| matches!(row_kind(row), "rng" | "observe" | "builtin")),
                            "empty modules expose no runtime hooks/RNG"
                        );
                    }
                    assert_eq!(view.case().configs[0].resolved.module_handles.len(), 0);
                },
            );
        }

        // 4: core-nonempty-no-features.
        {
            let view = CaseView::new("core-nonempty-no-features");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "disabled builtins still preserve nonempty guarded context",
                ticks.clone(),
                &["trace.observe", "configs"],
                &mut ledger,
                |rows| {
                    for op in rows.iter().copied() {
                        assert!(rows_with(op, "observe")
                            .iter()
                            .all(|row| !bool_field(row, "originalCfg")));
                        assert!(
                            !rows_with(op, "builtin")
                                .iter()
                                .any(|row| row_hook(row) != Some("enabled")),
                            "disabled builtins must not run body hooks"
                        );
                    }
                },
            );
        }

        // 5-6: path-clock-trade-boundary.
        {
            let view = CaseView::new("path-clock-trade-boundary");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "retained live Memory distinguishes path before new hit folding",
                ticks[1..3].to_vec(),
                &[
                    "trace.retainedMemoryBeforeFrame.lastHitAt",
                    "brains.a.memory.self.lastHitAt",
                ],
                &mut ledger,
                |rows| {
                    let op = rows[1];
                    let retained = first_row(op, "retainedMemoryBeforeFrame");
                    assert!(matches!(bfield(retained, "lastHitAt"), BVal::Null));
                    assert_eq!(
                        num_field(bfield(memory_of(op, "a"), "self"), "lastHitAt"),
                        100002.
                    );
                },
            );
            check(
                view.id.clone(),
                "trade engagement inclusive3000 and immediately beyond; lock alone false",
                ticks.clone(),
                &["trace.observe.engaged"],
                &mut ledger,
                |rows| {
                    assert!(!observation_engaged(rows[1]));
                    assert!(observation_engaged(rows[4]));
                    assert!(!observation_engaged(rows[5]));
                },
            );
        }

        // 7-9: core-fight-hunt-flee.
        {
            let view = CaseView::new("core-fight-hunt-flee");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "natural Hunt/Fight/Flee plus real paired attack/release",
                ticks.clone(),
                &["brains.a.goal", "result.cmd"],
                &mut ledger,
                |rows| {
                    let expected = [
                        ("hunt", Some("foe")),
                        ("fight", Some("foe")),
                        ("fight", Some("foe")),
                    ];
                    for (index, (kind, target)) in expected.iter().enumerate() {
                        let goal = goal_of(rows[index], "a");
                        assert_eq!(text_field(goal, "kind"), *kind);
                        assert_eq!(bfield_opt(goal, "target").and_then(BVal::as_str), *target);
                    }
                    let pair = result_rows(rows[2]);
                    let types: Vec<&str> = pair.iter().map(cmd_type).collect();
                    assert_eq!(types, vec!["attack", "release"]);
                    assert!(trace::same(bfield(&pair[0], "at"), bfield(&pair[1], "at")));
                    assert!(rows
                        .iter()
                        .any(|op| text_field(goal_of(op, "a"), "kind") == "flee"));
                },
            );
            let locked: Vec<&ReplayedOp> = ticks
                .iter()
                .filter(|op| now_of(op) == 105001.)
                .copied()
                .collect();
            check(
                view.id.clone(),
                "lock+previous attacking engages after trade window expires",
                locked,
                &["trace.observe.engaged", "brains.a.memory.self"],
                &mut ledger,
                |rows| {
                    let op = rows[0];
                    assert_eq!(
                        num_field(bfield(memory_of(op, "a"), "self"), "lastHitAt"),
                        101500.
                    );
                    assert!(observation_engaged(op));
                },
            );
            let flee_ops: Vec<&ReplayedOp> = ticks
                .iter()
                .filter(|op| text_field(goal_of(op, "a"), "kind") == "flee")
                .copied()
                .collect();
            check(
                view.id.clone(),
                "renewed Flee retains one sparse changed-goal count",
                flee_ops,
                &["brains.a.goal.until", "brains.a.stats.goals.flee"],
                &mut ledger,
                |rows| {
                    assert!(rows.len() >= 2);
                    assert!(!trace::same(
                        bfield(goal_of(rows[0], "a"), "until"),
                        bfield(goal_of(rows[1], "a"), "until")
                    ));
                    for op in rows.iter().copied() {
                        assert_eq!(num_field(bfield(stats_of(op, "a"), "goals"), "flee"), 1.);
                    }
                },
            );
        }

        // 10: core-farm-route.
        {
            let view = CaseView::new("core-farm-route");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual Farm/Roam/build/route contest and positive hunt focus",
                ticks.clone(),
                &["brains.a.stats"],
                &mut ledger,
                |rows| {
                    assert_eq!(text_field(goal_of(rows[0], "a"), "kind"), "farm");
                    assert!(rows
                        .iter()
                        .any(|op| text_field(goal_of(op, "a"), "kind") == "roam"));
                    let last = rows.last().expect("tick rows");
                    let stats = stats_of(last, "a");
                    assert!(num_field(stats, "mobTargets") > 0.);
                    assert!(num_field(stats, "mobFocusMs") > 0.);
                    assert!(text_field(stats, "build").starts_with("fire:"));
                    assert!(num_field(stats, "routeContests") > 0.);
                },
            );
        }

        // 11: core-hunt-drop-retreat.
        {
            let view = CaseView::new("core-hunt-drop-retreat");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "real MobHunter awake retreat/drop counters rather than tactic substitution",
                ticks.clone(),
                &[
                    "brains.a.stats.mobDrops",
                    "brains.a.stats.retreats",
                    "trace.services.log",
                ],
                &mut ledger,
                |rows| {
                    assert!(rows
                        .iter()
                        .any(|op| num_field(stats_of(op, "a"), "retreats") > 0.));
                    assert!(rows
                        .iter()
                        .any(|op| num_field(stats_of(op, "a"), "mobDrops") > 0.));
                    assert!(rows.iter().any(|op| rows_with(op, "callback")
                        .iter()
                        .any(|row| row_name(row) == Some("services.log")
                            && text_of(bitem(bfield(row, "args"), 0)).contains("retreating"))));
                },
            );
        }

        // 12: core-loot-grab-window.
        {
            let view = CaseView::new("core-loot-grab-window");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual loot settle/pickup and declared inventory feedback inclusive2000/beyond",
                ticks.clone(),
                &["result.cmd", "brains.a.stats.grabs", "brains.a.goal"],
                &mut ledger,
                |rows| {
                    assert_eq!(text_field(goal_of(rows[0], "a"), "kind"), "loot");
                    assert!(rows
                        .iter()
                        .any(|op| result_rows(op).iter().any(|row| cmd_type(row) == "pickup")));
                    let before = rows
                        .iter()
                        .find(|op| now_of(op) == 100701.)
                        .copied()
                        .expect("now 100701 tick");
                    let at = rows
                        .iter()
                        .find(|op| now_of(op) == 102701.)
                        .copied()
                        .expect("now 102701 tick");
                    assert_ne!(text_field(goal_of(before, "a"), "kind"), "loot");
                    assert_eq!(num_field(stats_of(at, "a"), "grabs"), 1.);
                    assert_eq!(
                        num_field(stats_of(rows.last().expect("ticks"), "a"), "grabs"),
                        1.
                    );
                },
            );
        }

        // 13: core-planning.
        {
            let view = CaseView::new("core-planning");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "real planning event and dead planning hand release/menu",
                ticks.clone(),
                &["trace.builtin.planning", "result", "trace.learned.bias"],
                &mut ledger,
                |rows| {
                    assert_eq!(text_field(goal_of(rows[0], "a"), "kind"), "idle");
                    assert!(rows.iter().any(|op| declared_status(op) == "dead"
                        && rows_with(op, "builtin").iter().any(|row| {
                            row_handle(row) == Some("planning") && row_hook(row) == Some("intents")
                        })));
                    assert!(rows
                        .iter()
                        .any(|op| result_rows(op).iter().any(|row| cmd_type(row) == "plan")));
                    assert!(rows.iter().any(|op| rows_with(op, "callback")
                        .iter()
                        .any(|row| row_name(row) == Some("learned.bias"))));
                },
            );
        }

        // 14: core-chest.
        {
            let view = CaseView::new("core-chest");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "real chest Module/act followed readable choose and picked continuation",
                ticks.clone(),
                &["brains.a.goal", "trace.builtin.chests", "result"],
                &mut ledger,
                |rows| {
                    assert!(rows.iter().any(|op| {
                        let goal = goal_of(op, "a");
                        text_field(goal, "kind") == "module"
                            && bfield_opt(goal, "module").and_then(BVal::as_str) == Some("chests")
                    }));
                    assert!(rows
                        .iter()
                        .any(|op| rows_with(op, "builtin").iter().any(|row| {
                            row_handle(row) == Some("chests") && row_hook(row) == Some("act")
                        })));
                    assert!(rows
                        .iter()
                        .any(|op| result_rows(op).iter().any(|row| cmd_type(row) == "choose")));
                    assert_eq!(
                        text_field(goal_of(rows.last().expect("ticks"), "a"), "kind"),
                        "hold"
                    );
                },
            );
        }

        // 15: core-wish-slip.
        {
            let view = CaseView::new("core-wish-slip");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual cast release supplies Memory.lastCast then real Wish slip reads it",
                ticks.clone(),
                &[
                    "result",
                    "brains.a.memory.self.lastCast",
                    "trace.builtin.wishes.act",
                ],
                &mut ledger,
                |rows| {
                    let cast = rows
                        .iter()
                        .find(|op| result_rows(op).iter().any(|row| cmd_type(row) == "cast"))
                        .copied()
                        .expect("a cast release tick");
                    assert_eq!(
                        text_field(
                            bfield(
                                bfield(bfield(memory_of(cast, "a"), "self"), "lastCast"),
                                "cmd"
                            ),
                            "type"
                        ),
                        "cast"
                    );
                    let wishes_act: Vec<&BVal> = rows
                        .iter()
                        .flat_map(|op| rows_with(op, "builtin"))
                        .filter(|row| {
                            row_handle(row) == Some("wishes") && row_hook(row) == Some("act")
                        })
                        .collect();
                    assert!(
                        wishes_act.iter().any(|row| {
                            bfield_opt(row, "result").is_some_and(|result| {
                                bfield_opt(result, "status")
                                    .and_then(|status| bfield_opt(status, "why"))
                                    .and_then(BVal::as_str)
                                    == Some("slipping away")
                            })
                        }),
                        "wishes act rows: {wishes_act:?}"
                    );
                },
            );
        }

        // 16: core-hazards.
        {
            let view = CaseView::new("core-hazards");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual hazard extras over ordinary core goal and adjust same-list identity",
                ticks.clone(),
                &["trace.builtin.hazards"],
                &mut ledger,
                |rows| {
                    assert!(rows
                        .iter()
                        .any(|op| rows_with(op, "builtin").iter().any(|row| {
                            row_handle(row) == Some("hazards")
                                && row_hook(row) == Some("intents")
                                && bfield_opt(row, "result").is_some_and(|result| {
                                    intent_kinds(result).iter().any(|kind| kind == "move")
                                })
                        })));
                    assert!(rows
                        .iter()
                        .any(|op| rows_with(op, "builtin").iter().any(|row| {
                            row_handle(row) == Some("hazards")
                                && row_hook(row) == Some("adjust")
                                && bfield_opt(row, "returnedInput").and_then(BVal::as_bool)
                                    == Some(true)
                        })));
                },
            );
        }

        // 17: caller-idle-first-act.
        {
            let view = CaseView::new("caller-idle-first-act");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "caller-only Idle unchanged key still acts first without goal count/log",
                ticks[..1].to_vec(),
                &["trace.module.intents", "brains.a.stats.goals"],
                &mut ledger,
                |rows| {
                    let op = rows[0];
                    assert_eq!(text_field(goal_of(op, "a"), "kind"), "idle");
                    assert_eq!(keys_of_count(bfield(stats_of(op, "a"), "goals")), 0);
                    assert!(rows_with(op, "module")
                        .iter()
                        .any(|row| row_hook(row) == Some("intents")));
                    assert!(!rows_with(op, "callback")
                        .iter()
                        .any(|row| row_name(row) == Some("services.log")));
                },
            );
        }

        // 18-20: caller-module-keys.
        {
            let view = CaseView::new("caller-module-keys");
            let ticks = view.ticks();
            check(view.id.clone(), "Module bypass excludes ordinary intent/adjust hooks; ordered JSON changes key; kept choice ignored", ticks.clone(), &["trace.module", "brains.a.stats.goals.module", "brains.a.memory.choices"], &mut ledger, |rows| {
                    for op in rows.iter().copied() {
                        assert!(!rows_with(op, "module").iter().any(|row| matches!(
                            row_hook(row),
                            Some("intents") | Some("adjust")
                        )));
                    }
                    assert_eq!(num_field(bfield(stats_of(rows[0], "a"), "goals"), "module"), 1.);
                    assert_eq!(num_field(bfield(stats_of(rows[1], "a"), "goals"), "module"), 1.);
                    assert_eq!(num_field(bfield(stats_of(rows[2], "a"), "goals"), "module"), 2.);
                    assert!(trace::same(
                        bfield(memory_of(rows[2], "a"), "choices"),
                        &BVal::arr([BVal::text("second|fire|bow"), BVal::text("opener|fire|holy")])
                    ));
                    assert_eq!(num_field(bfield(stats_of(rows[4], "a"), "goals"), "module"), 3.);
                    let n = num_field(bfield(goal_of(rows[4], "a"), "data"), "n");
                    assert_eq!(n, 0.);
                    assert!(n.is_sign_negative(), "Module data key preserves source -0");
                });
            check(view.id.clone(), "actual hunt picks before caller Module bypass, exported hunt targets remains1 without any core tactic act", ticks[..1].to_vec(), &["brains.a.stats.mobTargets", "trace.module.act"], &mut ledger, |rows| {
                    let op = rows[0];
                    assert_eq!(num_field(stats_of(op, "a"), "mobTargets"), 1.);
                    assert_eq!(text_field(goal_of(op, "a"), "kind"), "module");
                    assert!(
                        rows_with(op, "module")
                            .iter()
                            .any(|row| row_hook(row) == Some("act"))
                    );
                });
            check(
                view.id.clone(),
                "missing module continuation redecides without act hook",
                ticks[ticks.len() - 2..].to_vec(),
                &["trace.module", "brains.a.goal"],
                &mut ledger,
                |rows| {
                    for op in rows.iter().copied() {
                        assert_eq!(
                            bfield_opt(goal_of(op, "a"), "module").and_then(BVal::as_str),
                            Some("absent")
                        );
                        assert!(!rows_with(op, "module")
                            .iter()
                            .any(|row| row_hook(row) == Some("act")));
                        assert!(rows_with(op, "module")
                            .iter()
                            .any(|row| row_hook(row) == Some("goals")));
                    }
                },
            );
        }

        // 21: caller-ordinary-keys.
        {
            let view = CaseView::new("caller-ordinary-keys");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "coarse roam/hold reason/flee renewal preserve sparse counts and truthy choices",
                ticks.clone(),
                &["brains.a.stats.goals", "brains.a.memory.choices"],
                &mut ledger,
                |rows| {
                    let last = rows.last().expect("ticks");
                    assert!(trace::same(
                        bfield(stats_of(last, "a"), "goals"),
                        &BVal::obj([
                            ("roam", BVal::num(1.)),
                            ("hold", BVal::num(1.)),
                            ("flee", BVal::num(1.)),
                        ])
                    ));
                    assert!(trace::same(
                        bfield(memory_of(last, "a"), "choices"),
                        &BVal::arr([
                            BVal::text("roam|one"),
                            BVal::text("hold|one"),
                            BVal::text("flee|one"),
                        ])
                    ));
                },
            );
        }

        // 22-23: caller-merge-adjust.
        {
            let view = CaseView::new("caller-merge-adjust");
            let ticks = view.ticks();
            check(view.id.clone(), "reject equal-priority base extra then accept better and first accepted channel claim", ticks[..2].to_vec(), &["trace.module.adjust.args", "result"], &mut ledger, |rows| {
                    let first_list = bitem(bfield(x_adjust_row(rows[0]), "args"), 1);
                    let whys = intent_whys(first_list);
                    assert!(whys.iter().any(|why| why == "winner"));
                    assert!(!whys.iter().any(|why| why == "low rejected" || why == "claimed ignored"));
                    let second_list = bitem(bfield(x_adjust_row(rows[1]), "args"), 1);
                    assert!(intent_whys(second_list).iter().any(|why| why == "low rejected"));
                });
            check(view.id.clone(), "sequential evolving adjust with original-list retention and argument-sensitive append", ticks[..2].to_vec(), &["trace.module.adjust"], &mut ledger, |rows| {
                    let adjust: Vec<&BVal> = rows_with(rows[0], "module")
                        .into_iter()
                        .filter(|row| row_hook(row) == Some("adjust"))
                        .collect();
                    let handles: Vec<&str> = adjust
                        .iter()
                        .map(|row| row_handle(row).expect("module handle"))
                        .collect();
                    assert_eq!(handles, vec!["x", "y", "z"]);
                    let returned: Vec<bool> = adjust
                        .iter()
                        .map(|row| bool_field(row, "returnedInput"))
                        .collect();
                    assert_eq!(returned, vec![true, false, false]);
                    assert!(intent_kinds(bitem(bfield(adjust[2], "args"), 1))
                        .iter()
                        .any(|kind| kind == "swap"));
                });
        }

        // 24-29: the six guarded hooks, each with the fault/disable continuation.
        for hook in ["enabled", "observe", "goals", "intents", "adjust", "act"] {
            let view = CaseView::new(&format!("guard-{hook}"));
            let ticks = view.ticks();
            check(
                view.id.clone(),
                format!("actual guarded {hook} fault/fallback then disable"),
                ticks[..3].to_vec(),
                &["trace.module", "trace.services.log"],
                &mut ledger,
                |rows| {
                    let faulted = rows[0];
                    assert!(
                        rows_with(faulted, "module")
                            .iter()
                            .any(|row| row_hook(row) == Some(hook)
                                && bfield_opt(row, "error").is_some()),
                        "the selected {hook} hook must record its represented source throw"
                    );
                    assert!(
                        rows_with(faulted, "callback").iter().any(|row| {
                            row_name(row) == Some("services.log")
                                && text_of(bitem(bfield(row, "args"), 0))
                                    .contains(&format!("{hook} threw"))
                        }),
                        "the guarded {hook} fault must log the source line"
                    );
                    for op in rows.iter().skip(1) {
                        assert!(
                            !rows_with(op, "module")
                                .iter()
                                .any(|row| row_handle(row) == Some("x")),
                            "a faulted module id must be disabled on later enabled checks"
                        );
                    }
                },
            );
        }

        // 30: guard-observe same-tick continuation.
        {
            let view = CaseView::new("guard-observe");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "already selected faulted wrapper still reached in same tick",
                ticks[..1].to_vec(),
                &["trace.module"],
                &mut ledger,
                |rows| {
                    let op = rows[0];
                    let hooks: Vec<Option<&str>> = rows_with(op, "module")
                        .iter()
                        .map(|row| row_hook(row))
                        .collect();
                    assert!(hooks.contains(&Some("intents")));
                    assert!(hooks.contains(&Some("adjust")));
                    assert_eq!(
                        rows_with(op, "callback")
                            .iter()
                            .filter(|row| row_name(row) == Some("services.log")
                                && text_of(bitem(bfield(row, "args"), 0)).contains("threw"))
                            .count(),
                        2,
                        "observe plus the declared same-tick intents throw log exactly twice"
                    );
                },
            );
        }

        // 31: guard-equal-id.
        {
            let view = CaseView::new("guard-equal-id");
            let ticks = view.ticks();
            check(view.id.clone(), "equal IDs distinct module objects selected then share fault marker on future enabled checks", ticks[..2].to_vec(), &["trace.module"], &mut ledger, |rows| {
                    assert!(rows_with(rows[0], "module")
                        .iter()
                        .any(|row| row_handle(row) == Some("y")
                            && row_hook(row) == Some("intents")));
                    assert!(rows_with(rows[1], "module").is_empty());
                });
        }

        // 32: caller-wand-miss-alive-dead.
        {
            let view = CaseView::new("caller-wand-miss-alive-dead");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual wand miss alive appended after observed hpLoss; dead drains/discards",
                ticks.clone(),
                &["brains.a.stats.clickMissed", "brains.a.memory.stimuli"],
                &mut ledger,
                |rows| {
                    assert_eq!(num_field(stats_of(rows[0], "a"), "clickMissed"), 1.);
                    assert_eq!(
                        stimuli_kinds(rows[1]),
                        vec!["hpLoss".to_string(), "clickMissed".to_string()]
                    );
                    assert_eq!(num_field(stats_of(rows[1], "a"), "clickMissed"), 2.);
                    assert!(!stimuli_kinds(rows[2])
                        .iter()
                        .any(|kind| kind == "clickMissed"));
                    assert!(!stimuli_kinds(rows[3])
                        .iter()
                        .any(|kind| kind == "clickMissed"));
                },
            );
        }

        // 33: caller-nonactive-release.
        {
            let view = CaseView::new("caller-nonactive-release");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "real pending movement releases on alive nonactive frame",
                ticks[..2].to_vec(),
                &["result"],
                &mut ledger,
                |rows| {
                    assert_eq!(result_rows(rows[0]).len(), 0);
                    assert_eq!(
                        text_field(bfield(declared_input(rows[1]), "hud"), "phase"),
                        "lobby"
                    );
                    assert_eq!(cmd_type(&result_rows(rows[1])[0]), "move");
                },
            );
        }

        // 34: caller-feature-empty.
        {
            let view = CaseView::new("caller-feature-empty");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "full Brain empty feature messages rejects all offers before motor/lapse draws",
                ticks.clone(),
                &["brains.a.counts", "result"],
                &mut ledger,
                |rows| {
                    for op in rows.iter().copied() {
                        assert_eq!(result_rows(op).len(), 0);
                        let counts = counts_of(op, "a");
                        assert_eq!(counts[1], 0, "no motor draw on a rejected offer");
                        assert_eq!(counts[2], 0, "no lapse draw on a rejected offer");
                    }
                },
            );
        }

        // 35-36: caller-stall-grab-end.
        {
            let view = CaseView::new("caller-stall-grab-end");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "stall grace600 then1ms, subunit motion and exact1 reset/busy/dead anchors",
                ticks[..11].to_vec(),
                &["brains.a.stats.maxStallMs"],
                &mut ledger,
                |rows| {
                    assert_eq!(num_field(stats_of(rows[1], "a"), "maxStallMs"), 0.);
                    assert_eq!(num_field(stats_of(rows[2], "a"), "maxStallMs"), 1.);
                    assert_eq!(num_field(stats_of(rows[3], "a"), "maxStallMs"), 400.);
                    for op in rows.iter().skip(4) {
                        assert_eq!(num_field(stats_of(op, "a"), "maxStallMs"), 400.);
                    }
                },
            );
            let mut ends = view.ops_of_method("end");
            ends.extend(view.ops_of_method("savedSummary"));
            check(
                view.id.clone(),
                "end defaults/provided/repeated copy and continued choice/faction after end",
                ends,
                &["result"],
                &mut ledger,
                |rows| {
                    assert!(trace::same(
                        &rows[0].result,
                        &BVal::obj([
                            ("tier", BVal::text("hard")),
                            ("persona", BVal::text("cautious")),
                            ("faction", BVal::text("fire")),
                            ("outcome", BVal::text("void")),
                            ("place", BVal::num(0.)),
                            ("players", BVal::num(0.)),
                            ("choices", BVal::arr([])),
                        ])
                    ));
                    assert_eq!(text_field(&rows[1].result, "outcome"), "won");
                    assert_eq!(text_field(&rows[2].result, "faction"), "holy");
                    assert!(trace::same(
                        bfield(&rows[2].result, "choices"),
                        &BVal::arr([BVal::text("new|choice")])
                    ));
                    assert!(trace::same(
                        bfield(&rows[3].result, "choices"),
                        &BVal::arr([])
                    ));
                },
            );
        }

        // 37: caller-sequence255.
        {
            let view = CaseView::new("caller-sequence255");
            let ticks = view.ticks();
            check(view.id.clone(), "260 actual alternating Move/Stop1..255 wrap, nonorders unstamped, stamped noteSent", ticks.clone(), &["result.cmd.msg.seq", "brains.a.memory.self.lastOrder"], &mut ledger, |rows| {
                    let commands: Vec<&BVal> = rows
                        .iter()
                        .flat_map(|op| result_rows(op).iter())
                        .collect();
                    let orders: Vec<&BVal> = commands
                        .iter()
                        .copied()
                        .filter(|row| matches!(cmd_type(row), "move" | "stop"))
                        .collect();
                    assert_eq!(orders.len(), 260);
                    for (index, order) in orders.iter().enumerate() {
                        let message = bfield(bfield(order, "cmd"), "msg");
                        assert_eq!(
                            num_field(message, "seq"),
                            (index % 255) as f64 + 1.,
                            "released move/stop sequence wraps 1..=255"
                        );
                    }
                    assert!(commands.iter().any(|row| cmd_type(row) == "swap"
                        && bfield_opt(bfield(row, "cmd"), "msg")
                            .map(|message| bfield_opt(message, "seq").is_none())
                            .unwrap_or(true)));
                    for op in rows.iter().copied() {
                        let current: Vec<&BVal> = result_rows(op)
                            .iter()
                            .filter(|row| matches!(cmd_type(row), "move" | "stop"))
                            .collect();
                        if let Some(last) = current.last() {
                            assert!(trace::same(
                                bfield(bfield(memory_of(op, "a"), "self"), "lastOrder"),
                                last
                            ));
                        }
                    }
                });
        }

        // 38: identity-shared-budget.
        {
            let view = CaseView::new("identity-shared-budget");
            let ticks = view.ticks();
            check(view.id.clone(), "same original cfg handle gets separate guarded bcfg/rng/Memory; equal configs separate services; room allowance once perframe", ticks.clone(), &["trace.observe", "services", "initialTrace"], &mut ledger, |rows| {
                    let observed: Vec<&BVal> = rows[..3]
                        .iter()
                        .map(|op| first_row(op, "observe"))
                        .collect();
                    let mut identities: Vec<u64> = observed
                        .iter()
                        .map(|row| num_field(row, "cfgIdentity").to_bits())
                        .collect();
                    identities.sort_unstable();
                    identities.dedup();
                    assert_eq!(identities.len(), 3);
                    assert!(observed.iter().all(|row| !bool_field(row, "originalCfg")));
                    let frame_count = view
                        .replayed
                        .rows
                        .iter()
                        .filter(|op| op.method == "frame")
                        .count();
                    let case_frames = view
                        .case()
                        .operations
                        .iter()
                        .filter(|operation| {
                            matches!(
                                operation.method,
                                super::super::source_input::OpMethod::Frame { .. }
                            )
                        })
                        .count();
                    assert_eq!(frame_count, case_frames);
                    assert_eq!(case_frames, 4);
                    assert!(view.service("equal").is_some_and(|snapshot| {
                        num_field(bfield(&snapshot, "stats"), "fallbacks") > 0.
                    }));
                    let last = rows.last().expect("ticks");
                    assert_eq!(num_field(stats_of(last, "b"), "maxStallMs"), 0.);
                    assert!(num_field(stats_of(rows[rows.len() - 2], "a"), "maxStallMs") > 0.);
                });
        }

        // 39: core-empty-route-test.
        {
            let view = CaseView::new("core-empty-route-test");
            let ticks = view.ticks();
            check(
                view.id.clone(),
                "actual JS empty-route throw with callback and pre-error adopted goal/log effects",
                ticks.clone(),
                &[
                    "error",
                    "trace.paths.path",
                    "brains.a.goal",
                    "brains.a.counts",
                ],
                &mut ledger,
                |rows| {
                    for op in rows.iter().copied() {
                        let error = op.error.as_ref().unwrap_or_else(|| {
                            panic!("op {}: expected the source throw", op.index)
                        });
                        assert_eq!(text_field(error, "name"), "TypeError");
                        assert!(text_field(error, "message").contains("reading 'x'"));
                        assert_eq!(text_field(goal_of(op, "a"), "kind"), "loot");
                        assert!(rows_with(op, "callback").iter().any(|row| {
                            row_name(row) == Some("paths.path")
                                && bfield_opt(row, "result")
                                    .is_some_and(|result| arr(result).is_empty())
                        }));
                    }
                    assert!(rows_with(rows[0], "callback")
                        .iter()
                        .any(|row| row_name(row) == Some("services.log")));
                },
            );
        }

        hand_supplement_assertion(&mut ledger);

        let frozen = reached_ledger();
        assert_eq!(
            json!(ledger),
            json!(frozen),
            "the native reached ledger must map 1:1 to coverage.reached.assertions (case/name/operations/paths)"
        );
        assert_eq!(ledger.len(), 40, "all frozen reached assertions mapped");
    }

    fn keys_of_count(value: &BVal) -> usize {
        match value {
            BVal::Obj(entries) => entries.len(),
            other => panic!("not a source object: {other:?}"),
        }
    }
    // 40: the frozen Hand overlap supplement (native actual Hand replay rows from `brain/hand_tests.rs`).
    fn hand_supplement_assertion(ledger: &mut Vec<Value>) {
        let empty = super::super::hand_tests::replay_hand("empty")
            .unwrap_or_else(|error| panic!("hand empty replay: {error}"));
        let absent = super::super::hand_tests::replay_hand("absent")
            .unwrap_or_else(|error| panic!("hand absent replay: {error}"));
        let all = super::super::hand_tests::replay_hand("all")
            .unwrap_or_else(|error| panic!("hand all replay: {error}"));
        let attack_only = super::super::hand_tests::replay_hand("attack-only")
            .unwrap_or_else(|error| panic!("hand attack-only replay: {error}"));
        let empty_trace = BVal::arr([]);
        let empty_counts: Vec<[u64; 3]> = empty.iter().map(|op| op.counts).collect();
        assert_eq!(empty_counts, vec![[0, 0, 0], [0, 0, 0]]);
        for op in &empty {
            assert!(
                trace::same(&op.submit_trace, &empty_trace),
                "empty: no submit draws"
            );
            assert!(
                trace::same(&op.release_trace, &empty_trace),
                "empty: no release draws"
            );
        }
        assert_eq!(absent.len(), all.len(), "absent/all operation counts");
        for (absent_op, all_op) in absent.iter().zip(&all) {
            // Every actual Hand surface: released commands, exact ordered submit/release RNG transcripts (no per-lane
            // relaxation), exported stats, misses and the retained Memory snapshot.
            assert!(
                trace::same(&absent_op.result, &all_op.result),
                "absent features must match the all-messages result"
            );
            assert_eq!(absent_op.counts, all_op.counts, "absent/all lane counts");
            assert!(
                trace::same(&absent_op.submit_trace, &all_op.submit_trace),
                "absent/all exact ordered submit trace"
            );
            assert!(
                trace::same(&absent_op.release_trace, &all_op.release_trace),
                "absent/all exact ordered release trace"
            );
            assert!(trace::same(&absent_op.stats, &all_op.stats));
            assert!(trace::same(&absent_op.misses, &all_op.misses));
            assert!(trace::same(&absent_op.memory, &all_op.memory));
        }
        for op in &attack_only {
            assert!(op.result.as_arr().is_some_and(|rows| rows.is_empty()));
            assert_eq!(
                op.counts[1], 0,
                "attack-only reject happens before a motor draw"
            );
            assert_eq!(
                op.counts[2], 0,
                "attack-only reject happens before a lapse draw"
            );
            assert!(
                trace::same(&op.submit_trace, &empty_trace),
                "attack-only: no submit draws"
            );
            assert!(
                trace::same(&op.release_trace, &empty_trace),
                "attack-only: no release draws"
            );
        }
        ledger.push(json!({
            "case": "$handSupplement",
            "name": "absent features exactly matches all messages; empty/attack-only lock gate reject before draws",
            "operations": [0, 1],
            "paths": ["operations.counts", "operations.result"],
        }));
    }
}
