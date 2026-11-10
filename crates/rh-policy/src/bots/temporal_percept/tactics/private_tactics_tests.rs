//! Declared native controls for the private tactics layer (P-BOT-TACTICS-1).
//!
//! These controls exercise the real typed intake and the real replay entrypoint (never a preflight-only substitute):
//! - malformed/consumed-data mutations must be rejected by the same typed decode the ordinary replay uses, with the
//!   intended typed error, and must leave delivered Memory/retained counters/RNG draws/callbacks/path statistics untouched
//!   (the partial-replay control resumes the exact remaining transcript afterwards);
//! - changed expected channels (result/status/intent/callback/RNG index/memory/stats/pathStats) must turn the comparison RED,
//!   proving the expected rows are compared and never installed as inputs;
//! - a changed declared input must change the real native execution transcript.

use serde_json::Value;

use super::source_decode::decode_corpus;
use super::source_tests::{case_map_value, reached_runner, run_native_case, ApplyError, Corpus};

// ---------------------------------------------------------------------------------------------- tagged-value mutation helpers

fn entries_mut(value: &mut Value) -> Option<&mut Vec<Value>> {
    value.get_mut("entries")?.as_array_mut()
}
fn pair_mut<'a>(value: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    entries_mut(value)?.iter_mut().find_map(|pair| {
        let pair = pair.as_array_mut()?;
        if pair[0].as_str()? == key {
            Some(&mut pair[1])
        } else {
            None
        }
    })
}
fn pair<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get("entries")?.as_array()?.iter().find_map(|pair| {
        let pair = pair.as_array()?;
        if pair[0].as_str()? == key {
            Some(&pair[1])
        } else {
            None
        }
    })
}
fn values_mut(value: &mut Value) -> Option<&mut Vec<Value>> {
    value.get_mut("values")?.as_array_mut()
}
fn path_mut<'a>(root: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    let mut current = root;
    for key in path {
        current = pair_mut(current, key)?;
    }
    Some(current)
}
fn set_tagged_number(value: &mut Value, key: &str, number: Value) -> bool {
    match pair_mut(value, key) {
        Some(slot) => {
            *slot = number;
            true
        }
        None => false,
    }
}
fn remove_pair(value: &mut Value, key: &str) -> bool {
    let Some(entries) = entries_mut(value) else {
        return false;
    };
    let before = entries.len();
    entries.retain(|pair| pair.as_array().and_then(|pair| pair[0].as_str()) != Some(key));
    entries.len() != before
}

fn infinity_tag(sign: &str) -> Value {
    serde_json::json!({"$": "number", "value": sign})
}
fn nan_tag() -> Value {
    serde_json::json!({"$": "number", "value": "NaN"})
}
fn number(value: f64) -> Value {
    serde_json::json!(value)
}

/// The first `observe` operation declaration inside a raw case row.
fn observe_declaration(case: &mut Value) -> &mut Value {
    let operations = case
        .get_mut("operations")
        .and_then(Value::as_array_mut)
        .expect("operations");
    for operation in operations.iter_mut() {
        let declaration = operation
            .get_mut("declaration")
            .expect("operation declaration");
        if pair(declaration, "method").and_then(Value::as_str) == Some("observe") {
            return declaration;
        }
    }
    panic!("no observe operation");
}

fn declared_input(case: &mut Value) -> &mut Value {
    pair_mut(observe_declaration(case), "input").expect("observe input")
}

/// The declared `self` object of the first observe operation.
fn declared_self(case: &mut Value) -> &mut Value {
    pair_mut(declared_input(case), "self").expect("percept self")
}

/// The first act operation declaration of a tactic-suite case.
fn act_goal(case: &mut Value) -> &mut Value {
    let operations = case
        .get_mut("operations")
        .and_then(Value::as_array_mut)
        .expect("operations");
    for operation in operations.iter_mut() {
        let declaration = operation
            .get_mut("declaration")
            .expect("operation declaration");
        if pair(declaration, "method").and_then(Value::as_str) == Some("act") {
            return pair_mut(declaration, "goal").expect("act goal");
        }
    }
    panic!("no act operation");
}

fn corpus_case_mut(raw: &mut Value, index: usize) -> &mut Value {
    raw.get_mut("cases")
        .and_then(Value::as_array_mut)
        .expect("cases")
        .get_mut(index)
        .expect("case index")
}

/// The declared `self` object of a standalone observe declaration (checked-intake control input).
fn observe_self_of(declaration: &mut Value) -> &mut Value {
    let input = pair_mut(declaration, "input").expect("declared observe input");
    pair_mut(input, "self").expect("declared percept self")
}

/// Swap two entries of a genuine tagged source object while keeping every value (order mutation control).
fn swap_tagged_entries(value: &mut Value, first: usize, second: usize) -> bool {
    let Some(entries) = value.get_mut("entries").and_then(Value::as_array_mut) else {
        return false;
    };
    if first >= entries.len() || second >= entries.len() || first == second {
        return false;
    }
    entries.swap(first, second);
    true
}

/// The tagged `entries` field of an event/object value.
fn tagged_field_mut<'a>(value: &'a mut Value, field: &str) -> Option<&'a mut Value> {
    pair_mut(value, field)
}

/// The callback events of an operation row.
fn callback_events_mut(row: &mut Value) -> Option<&mut Vec<Value>> {
    row.get_mut("callbacks")?.get_mut("values")?.as_array_mut()
}

/// The first recorded callback event with `name`.
fn callback_named<'a>(events: &'a mut [Value], name: &str) -> Option<&'a mut Value> {
    events.iter_mut().find(|event| {
        event
            .get("entries")
            .and_then(Value::as_array)
            .and_then(|entries| {
                entries.iter().find_map(|pair| {
                    let pair = pair.as_array()?;
                    (pair[0].as_str()? == "name").then(|| pair[1].as_str())
                })
            })
            .flatten()
            == Some(name)
    })
}

/// The mutable `x` entry of a tagged plain point.
fn point_x_mut(value: &mut Value) -> Option<&mut Value> {
    let entries = value.get_mut("entries")?.as_array_mut()?;
    entries.iter_mut().find_map(|pair| {
        let pair = pair.as_array_mut()?;
        (pair[0].as_str()? == "x").then(|| &mut pair[1])
    })
}

/// The mutable `x` of `paths.walk` argument 1 (the walk target) in an operation row.
fn walk_target_x_mut(row: &mut Value) -> Option<&mut Value> {
    let event = callback_named(callback_events_mut(row)?, "paths.walk")?;
    let args = tagged_field_mut(event, "args")?;
    let values = values_mut(args)?;
    let target = values.get_mut(1)?;
    point_x_mut(target)
}

fn find_raw_operation_mut(
    raw: &mut Value,
    case_index: usize,
    predicate: impl Fn(&Value) -> bool,
) -> Option<&mut Value> {
    raw.get_mut("cases")
        .and_then(Value::as_array_mut)
        .and_then(|cases| cases.get_mut(case_index))
        .and_then(|case| case.get_mut("operations"))
        .and_then(Value::as_array_mut)
        .and_then(|operations| operations.iter_mut().find(|op| predicate(op)))
}

/// Locate (case index, operation index) of the first declared `check` row whose expected result is an object.
fn find_check_object_row(raw: &Value) -> Option<(usize, usize)> {
    let cases = raw.get("cases")?.as_array()?;
    for (case_index, case) in cases.iter().enumerate() {
        let operations = case.get("operations")?.as_array()?;
        for (op_index, op) in operations.iter().enumerate() {
            if op.get("method").and_then(Value::as_str) != Some("check") {
                continue;
            }
            if op
                .get("result")
                .and_then(|result| result.get("entries"))
                .is_some()
            {
                return Some((case_index, op_index));
            }
        }
    }
    None
}

/// Locate (case index, operation index) of the first row whose `paths.walk` callback result is an object.
fn find_walk_object_row(raw: &Value) -> Option<(usize, usize)> {
    let cases = raw.get("cases")?.as_array()?;
    for (case_index, case) in cases.iter().enumerate() {
        let operations = case.get("operations")?.as_array()?;
        for (op_index, op) in operations.iter().enumerate() {
            let Some(events) = op
                .get("callbacks")
                .and_then(|callbacks| callbacks.get("values"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            let found = events.iter().any(|event| {
                let entries = event.get("entries").and_then(Value::as_array);
                let name = entries.and_then(|entries| {
                    entries.iter().find_map(|pair| {
                        let pair = pair.as_array()?;
                        (pair[0].as_str()? == "name").then(|| pair[1].as_str())
                    })
                });
                let result_object = entries.and_then(|entries| {
                    entries.iter().find_map(|pair| {
                        let pair = pair.as_array()?;
                        (pair[0].as_str()? == "result").then(|| pair[1].get("entries").is_some())
                    })
                });
                name.flatten() == Some("paths.walk") && result_object == Some(true)
            });
            if found {
                return Some((case_index, op_index));
            }
        }
    }
    None
}

fn act_row_mut(case: &mut Value) -> &mut Value {
    case.get_mut("operations")
        .and_then(Value::as_array_mut)
        .expect("operations")
        .iter_mut()
        .find(|operation| operation.get("method").and_then(Value::as_str) == Some("act"))
        .expect("act row")
}

// ----------------------------------------------------------------------------------------------------------- controls

/// The typed intake rejects malformed/consumed-data mutations with the intended error and without advancing any real
/// delivered state: a fresh runner's Memory/stats/decide draws/callbacks/path counters are byte-identical before and
/// after every rejected intake. Reported as one control per mutation.
#[test]
#[allow(clippy::type_complexity)]
fn private_tactics_source_typed_intake_non_advance() {
    let corpus = Corpus::load();
    let index = corpus.case_index("swap-player-cooldown");
    let map_value = case_map_value(&corpus, index);
    let raw_case = corpus.raw_case(index);
    let case = corpus.decoded.cases[index].clone();
    let raw_ops = raw_case["operations"]
        .as_array()
        .expect("operations")
        .clone();
    assert!(
        raw_ops.len() >= 4,
        "the non-advance control needs a multi-operation case"
    );

    // The full native baseline, executed through the ONE checked decode/apply entry.
    let baseline =
        run_native_case(&raw_case, &case, map_value.clone()).expect("baseline native case");
    // The baseline prefix through the same checked entry (a fresh reached runner is used per mutation).
    let (baseline_prefix, _) =
        reached_runner(&raw_case, &case, map_value.clone(), 2).expect("baseline prefix");
    assert_eq!(baseline_prefix, baseline[..2].to_vec());
    let target_declaration = raw_ops[2]["declaration"].clone();

    let mut mutations: Vec<(&str, Vec<&str>, Box<dyn Fn(&mut Value) -> bool>)> = Vec::new();
    mutations.push((
        "self.readyAt nonfinite",
        vec!["readyAt"],
        Box::new(|declaration: &mut Value| {
            set_tagged_number(
                observe_self_of(declaration),
                "readyAt",
                infinity_tag("+Infinity"),
            )
        }),
    ));
    mutations.push((
        "self.readyAt missing",
        vec!["readyAt"],
        Box::new(|declaration: &mut Value| remove_pair(observe_self_of(declaration), "readyAt")),
    ));
    mutations.push((
        "self.status unsupported enum",
        vec!["status"],
        Box::new(|declaration: &mut Value| {
            match pair_mut(observe_self_of(declaration), "status") {
                Some(slot) => {
                    *slot = serde_json::json!("future");
                    true
                }
                None => false,
            }
        }),
    ));
    mutations.push((
        "self.x NaN",
        vec!["self.x", ".x"],
        Box::new(|declaration: &mut Value| {
            set_tagged_number(observe_self_of(declaration), "x", nan_tag())
        }),
    ));
    mutations.push((
        "percept viewT nonfinite",
        vec!["viewT"],
        Box::new(|declaration: &mut Value| {
            let input = pair_mut(declaration, "input").expect("input");
            set_tagged_number(input, "viewT", infinity_tag("-Infinity"))
        }),
    ));
    mutations.push((
        "self duplicate consumed field",
        vec!["duplicate", "readyAt"],
        Box::new(|declaration: &mut Value| {
            let self_value = observe_self_of(declaration);
            let Some(entries) = entries_mut(self_value) else {
                return false;
            };
            let duplicate = entries
                .iter()
                .find(|pair| pair.as_array().and_then(|pair| pair[0].as_str()) == Some("readyAt"))
                .cloned();
            match duplicate {
                Some(pair) => {
                    entries.push(pair);
                    true
                }
                None => false,
            }
        }),
    ));
    mutations.push((
        "self.slot unsupported enum",
        vec!["slot"],
        Box::new(|declaration: &mut Value| {
            set_tagged_number(observe_self_of(declaration), "slot", number(2.0))
        }),
    ));
    mutations.push((
        "self.weapons[0] unsupported enum",
        vec!["weapon"],
        Box::new(|declaration: &mut Value| {
            let weapons = pair_mut(observe_self_of(declaration), "weapons").expect("weapons");
            let Some(values) = values_mut(weapons) else {
                return false;
            };
            values[0] = serde_json::json!("future");
            true
        }),
    ));

    let mut reached = 0usize;
    for (name, tokens, mutate) in &mutations {
        // A reached mutable runner: real state after two chronological operations through the same entry.
        let (prefix, mut runner) =
            reached_runner(&raw_case, &case, map_value.clone(), 2).expect("reached runner");
        assert_eq!(
            prefix,
            baseline[..2].to_vec(),
            "control {name}: reached runner prefix"
        );
        let before = runner.snapshot();
        let mut declaration = target_declaration.clone();
        assert!(mutate(&mut declaration), "control {name}: mutation applied");
        // The injected declaration goes through the SAME checked entry normal replay uses.
        let error = match runner.apply_checked(&declaration) {
            Ok(_) => panic!("control {name}: malformed declaration was accepted"),
            Err(ApplyError::Intake(error)) => error,
        };
        assert!(
            tokens.iter().any(|token| error
                .to_ascii_lowercase()
                .contains(&token.to_ascii_lowercase())),
            "control {name}: typed error does not name the consumed field ({}): {error}",
            tokens.join("/")
        );
        // Real pre/post state: Memory, retained counters, full ordered trace, RNG ordinal, callbacks and path budget.
        assert_eq!(
            before,
            runner.snapshot(),
            "control {name}: rejected intake advanced delivered Memory/retained state/RNG/callback/path/budget state"
        );
        // The same reached runner then continues the case through the same entry; the remaining transcript matches
        // the baseline exactly (no hidden reset, no dropped/replayed operation).
        let mut resumed: Vec<String> = Vec::new();
        for raw_op in &raw_ops[2..] {
            resumed.push(
                runner
                    .apply_transcript(&raw_op["declaration"])
                    .expect("valid continuation accepted"),
            );
        }
        assert_eq!(
            resumed,
            baseline[2..].to_vec(),
            "control {name}: same remaining continuation differs"
        );
        reached += 1;
    }

    // Case-level config is the same strict typed decoder; it is rejected before any case runner state exists.
    let mut mutated_corpus = corpus.raw().clone();
    {
        let case_value = corpus_case_mut(&mut mutated_corpus, index);
        let config = case_value.get_mut("config").expect("config");
        let tier_values = pair_mut(config, "tierValues").expect("tierValues");
        let orbwalk = pair_mut(tier_values, "orbwalk").expect("orbwalk");
        assert!(
            remove_pair(orbwalk, "p"),
            "config tierValues.orbwalk.p removed"
        );
    }
    let error =
        decode_corpus(&mutated_corpus).expect_err("malformed config typed intake must be rejected");
    assert!(
        error.to_ascii_lowercase().contains("orbwalk")
            || error.to_ascii_lowercase().contains("tiervalues"),
        "config error does not name the consumed field: {error}"
    );

    eprintln!(
        "private-tactics typed-intake non-advance controls reached: {reached} injected operations on a reached runner + 1 config intake"
    );
    assert_eq!(reached, mutations.len());
}

/// The replay's comparison must detect changed expected channels (result/status/intent/callback/RNG index/memory/stats/
/// pathStats). A changed expected row produces a RED comparison through the same replay entrypoint.
#[test]
fn private_tactics_expected_channel_controls() {
    let corpus = Corpus::load();
    let index = corpus.case_index("fight-plan-drift-resend");
    let raw = corpus.raw_case(index);
    let (baseline, _) = super::source_tests::replay_case(&corpus, index, &raw);
    assert!(
        baseline.is_empty(),
        "baseline case must be green before its expected-channel controls: {:?}",
        baseline.first()
    );

    fn mutated_raw(base: &Value, mutate: impl FnOnce(&mut Value)) -> Value {
        let mut raw = base.clone();
        mutate(&mut raw);
        raw
    }

    /// The first act row of a raw case.
    fn act_row(case: &mut Value) -> &mut Value {
        case.get_mut("operations")
            .and_then(Value::as_array_mut)
            .expect("operations")
            .iter_mut()
            .find(|operation| operation.get("method").and_then(Value::as_str) == Some("act"))
            .expect("act operation")
    }

    let mut mutations: Vec<(&str, Value)> = Vec::new();
    mutations.push((
        "result status why",
        mutated_raw(&raw, |case| {
            let status = act_row(case)
                .get_mut("result")
                .and_then(|result| pair_mut(result, "status"));
            if let Some(status) = status {
                if let Some(slot) = pair_mut(status, "why") {
                    *slot = serde_json::json!("tampered status");
                }
            }
        }),
    ));
    mutations.push((
        "intent to geometry bits",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(result) = row.get_mut("result") {
                if let Some(intents) = pair_mut(result, "intents").and_then(values_mut) {
                    if let Some(intent) = intents.first_mut() {
                        if let Some(to) = pair_mut(intent, "to") {
                            if let Some(x) = pair_mut(to, "x") {
                                *x = number(1.0);
                            }
                        }
                    }
                }
            }
        }),
    ));
    mutations.push((
        "callback result flipped",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(callbacks) = row.get_mut("callbacks").and_then(values_mut) {
                for event in callbacks.iter_mut() {
                    if let Some(result) = pair_mut(event, "result") {
                        if let Some(flag) = result.as_bool() {
                            *result = serde_json::json!(!flag);
                            break;
                        }
                    }
                }
            }
        }),
    ));
    mutations.push((
        "callback event removed",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(callbacks) = row.get_mut("callbacks").and_then(values_mut) {
                callbacks.pop();
            }
        }),
    ));
    mutations.push((
        "rng index changed",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(callbacks) = row.get_mut("callbacks").and_then(values_mut) {
                for event in callbacks.iter_mut() {
                    if pair(event, "kind").and_then(Value::as_str) == Some("rng") {
                        if let Some(slot) = pair_mut(event, "index") {
                            *slot = number(9999.0);
                        }
                        break;
                    }
                }
            }
        }),
    ));
    mutations.push((
        "memory self.stillSince",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(self_memory) = pair_mut(row.get_mut("memory").expect("memory"), "self") {
                if let Some(slot) = pair_mut(self_memory, "stillSince") {
                    *slot = number(123_456.0);
                }
            }
        }),
    ));
    mutations.push((
        "stats counter",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(stats) = pair_mut(row.get_mut("stats").expect("stats"), "stats") {
                if let Some(slot) = pair_mut(stats, "kiteCycles") {
                    *slot = number(7.0);
                }
            }
        }),
    ));
    mutations.push((
        "pathStats counter",
        mutated_raw(&raw, |case| {
            let row = act_row(case);
            if let Some(slot) = pair_mut(row.get_mut("pathStats").expect("pathStats"), "searches") {
                *slot = number(999.0);
            }
        }),
    ));

    let mut detected = 0usize;
    for (name, mutated) in &mutations {
        let (failures, _) = super::source_tests::replay_case(&corpus, index, mutated);
        assert!(
            !failures.is_empty(),
            "control {name}: a changed expected channel was not detected"
        );
        detected += 1;
    }
    eprintln!("private-tactics changed-expected-channel controls detected: {detected}");
    assert_eq!(detected, mutations.len());
}

/// A changed declared input must change the real native execution transcript: the replay emits real intents/stats from
/// the declared facts, not captured expected rows.
#[test]
fn private_tactics_changed_input_changes_execution() {
    let corpus = Corpus::load();
    let index = corpus.case_index("swap-player-cooldown");
    let map_value = case_map_value(&corpus, index);
    let raw_case = corpus.raw_case(index);
    let case = corpus.decoded.cases[index].clone();
    let baseline =
        run_native_case(&raw_case, &case, map_value.clone()).expect("baseline native case");
    let mut changed = raw_case.clone();
    {
        let operations = changed
            .get_mut("operations")
            .and_then(Value::as_array_mut)
            .expect("operations");
        let observe = operations
            .iter_mut()
            .find(|operation| operation.get("method").and_then(Value::as_str) == Some("observe"))
            .expect("observe operation");
        let declaration = observe.get_mut("declaration").expect("declaration");
        let weapons = pair_mut(observe_self_of(declaration), "weapons").expect("weapons");
        let values = values_mut(weapons).expect("weapon values");
        values[0] = serde_json::json!("axe");
        values[1] = serde_json::json!("sword");
    }
    // The changed declared input is decoded by the SAME checked entry and then really executed.
    let changed_transcript =
        run_native_case(&changed, &case, map_value).expect("changed native case");
    assert_ne!(
        baseline, changed_transcript,
        "a changed declared input must change real execution"
    );
    eprintln!("private-tactics changed-input control: native transcript changed");
}

/// A partial replay that reaches a mutable runner, injects a malformed operation through the same checked entry, is
/// rejected without any state/RNG/callback/budget change, then resumes the remaining operations to the exact full
/// transcript.
#[test]
fn private_tactics_partial_replay_resumes_exactly() {
    let corpus = Corpus::load();
    let index = corpus.case_index("swap-player-cooldown");
    let map_value = case_map_value(&corpus, index);
    let raw_case = corpus.raw_case(index);
    let case = corpus.decoded.cases[index].clone();
    let raw_ops = raw_case["operations"]
        .as_array()
        .expect("operations")
        .clone();
    assert!(case.operations.len() >= 3);
    let baseline =
        run_native_case(&raw_case, &case, map_value.clone()).expect("baseline native case");
    let (prefix, mut runner) =
        reached_runner(&raw_case, &case, map_value.clone(), 2).expect("reached runner");
    assert_eq!(prefix, baseline[..2].to_vec());
    let before = runner.snapshot();
    let mut declaration = raw_ops[2]["declaration"].clone();
    assert!(set_tagged_number(
        observe_self_of(&mut declaration),
        "readyAt",
        infinity_tag("+Infinity")
    ));
    let error = runner
        .apply_checked(&declaration)
        .expect_err("malformed typed intake must be rejected");
    assert!(error.to_string().to_ascii_lowercase().contains("readyat"));
    assert_eq!(
        before,
        runner.snapshot(),
        "rejected intake advanced Memory/retained counters/RNG/callbacks/path/budget state"
    );
    let mut resumed = prefix;
    for raw_op in &raw_ops[2..] {
        resumed.push(
            runner
                .apply_transcript(&raw_op["declaration"])
                .expect("valid continuation accepted"),
        );
    }
    assert_eq!(
        baseline, resumed,
        "the partial replay did not resume to the exact full transcript"
    );
    eprintln!("private-tactics partial-replay non-advance control: reached runner resumed transcript exact");
}

/// Object property order is part of the carried tagged source value: swapping two entries of a genuine tagged source
/// object (same values, different insertion order) must turn the comparison RED. The only intentional exclusion is the
/// plain fixed-schema corpus envelope (`drawCounts`): the serde envelope map does not preserve JSON object order, so the
/// comparator compares that one channel as a key set; that exclusion is checked here explicitly and an extra/missing key
/// still fails (the unordered comparison is not blind).
#[test]
fn private_tactics_object_order_controls() {
    fn swap_tagged_entries(value: &mut Value, first: usize, second: usize) -> bool {
        let Some(entries) = value.get_mut("entries").and_then(Value::as_array_mut) else {
            return false;
        };
        if first >= entries.len() || second >= entries.len() || first == second {
            return false;
        }
        entries.swap(first, second);
        true
    }
    fn first_callback_with_args(row: &mut Value) -> Option<&mut Value> {
        let callbacks = row
            .get_mut("callbacks")?
            .get_mut("values")?
            .as_array_mut()?;
        callbacks.iter_mut().find(|event| {
            event
                .get("entries")
                .and_then(Value::as_array)
                .is_some_and(|entries| {
                    entries.iter().any(|pair| {
                        pair.as_array().and_then(|pair| pair[0].as_str()) == Some("args")
                    }) && entries.iter().any(|pair| {
                        pair.as_array().and_then(|pair| pair[0].as_str()) == Some("kind")
                            && pair.as_array().and_then(|pair| pair[1].as_str()) == Some("callback")
                    })
                })
        })
    }

    let corpus = Corpus::load();
    let index = corpus.case_index("fight-plan-drift-resend");
    let raw = corpus.raw_case(index);
    let (baseline, _) = super::source_tests::replay_case(&corpus, index, &raw);
    assert!(
        baseline.is_empty(),
        "baseline case must be green before its object-order controls: {:?}",
        baseline.first()
    );

    // 1. A tagged Memory payload object (the source Memory view is a carried MethodValue): reordering two entries with
    //    all values kept must be detected.
    let mut mutated = raw.clone();
    {
        let case = mutated.as_object_mut().expect("case");
        let operations = case
            .get_mut("operations")
            .and_then(Value::as_array_mut)
            .expect("operations");
        let act = operations
            .iter_mut()
            .find(|operation| operation.get("method").and_then(Value::as_str) == Some("act"))
            .expect("act row");
        let memory = act.get_mut("memory").expect("memory channel");
        let self_memory = memory
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .expect("memory entries")
            .iter_mut()
            .find_map(|pair| {
                let pair = pair.as_array_mut()?;
                if pair[0].as_str()? == "self" {
                    Some(&mut pair[1])
                } else {
                    None
                }
            })
            .expect("memory self section");
        assert!(swap_tagged_entries(self_memory, 0, 1), "memory self swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, index, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("memory")),
        "tagged Memory property order was not detected: {failures:?}"
    );

    // 2. A tagged callback argument object (the full source SelfView handed to the path service): swapping two entries
    //    with all values kept must be detected.
    let mut mutated = raw.clone();
    {
        let case = mutated.as_object_mut().expect("case");
        let operations = case
            .get_mut("operations")
            .and_then(Value::as_array_mut)
            .expect("operations");
        let act = operations
            .iter_mut()
            .find(|operation| operation.get("method").and_then(Value::as_str) == Some("act"))
            .expect("act row");
        let event = first_callback_with_args(act).expect("a callback with args");
        let args = event
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .expect("event entries")
            .iter_mut()
            .find_map(|pair| {
                let pair = pair.as_array_mut()?;
                if pair[0].as_str()? == "args" {
                    Some(&mut pair[1])
                } else {
                    None
                }
            })
            .expect("args value");
        let first_arg = args
            .get_mut("values")
            .and_then(Value::as_array_mut)
            .expect("args values")
            .first_mut()
            .expect("first arg");
        assert!(
            swap_tagged_entries(first_arg, 0, 1),
            "callback argument self swap"
        );
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, index, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("callbacks")
            && (failure.contains("order") || failure.contains("entry"))),
        "tagged callback argument property order was not detected: {failures:?}"
    );

    // 3. The documented limited exclusion: drawCounts is a plain fixed-schema envelope, parsed through the serde envelope
    //    map (which does not preserve JSON object order) and compared as a key set. A pure reordering must still pass.
    use super::source_trace::{compare_draw_counts, n, obj, s};
    let counts = [125u64, 0, 0, 70];
    let reordered = obj(vec![
        ("knowledge", n(70.0)),
        ("decide", n(125.0)),
        ("motor", n(0.0)),
        ("lapse", n(0.0)),
    ]);
    let mut failures = Vec::new();
    compare_draw_counts(
        "drawCounts order envelope",
        &reordered,
        counts,
        &mut failures,
    );
    assert!(
        failures.is_empty(),
        "fixed-schema envelope order should not be compared: {failures:?}"
    );
    // ... but the envelope comparison still checks the consumed keys exactly.
    let missing = obj(vec![
        ("decide", n(125.0)),
        ("motor", n(0.0)),
        ("lapse", n(0.0)),
        ("knowledge", n(70.0)),
        ("future", n(0.0)),
    ]);
    let mut failures = Vec::new();
    compare_draw_counts("drawCounts envelope keys", &missing, counts, &mut failures);
    assert!(
        !failures.is_empty(),
        "the fixed-schema envelope key set must still be compared"
    );
    let _ = s;
    eprintln!(
        "private-tactics object-order controls: tagged Memory + tagged callback argument order detected; plain envelope order excluded"
    );
}

// ---------------------------------------------------------------------------------------------- repair-round 2 controls

/// Helper: the mutable expected `intents` array of an operation row's result.
fn result_intents_mut(row: &mut Value) -> Option<&mut Vec<Value>> {
    values_mut(pair_mut(row.get_mut("result")?, "intents")?)
}

/// Helper: the tagged `paths.walk` result object of an operation row.
fn walk_result_mut(row: &mut Value) -> Option<&mut Value> {
    let event = callback_named(callback_events_mut(row)?, "paths.walk")?;
    tagged_field_mut(event, "result")
}

/// Helper: `(x, y)` of a tagged plain point.
fn point_coords_t(value: &Value) -> Option<(f64, f64)> {
    let entries = value.get("entries")?.as_array()?;
    let read = |key: &str| {
        entries.iter().find_map(|pair| {
            let pair = pair.as_array()?;
            (pair[0].as_str()? == key)
                .then(|| pair[1].as_f64())
                .flatten()
        })
    };
    Some((read("x")?, read("y")?))
}

/// The first declared intent with the given `why`, as (case index, operation index, intent index).
fn find_intent_row(raw: &Value, why: &str) -> Option<(usize, usize, usize)> {
    let cases = raw.get("cases")?.as_array()?;
    for (case_index, case) in cases.iter().enumerate() {
        let operations = case.get("operations")?.as_array()?;
        for (op_index, op) in operations.iter().enumerate() {
            let Some(result) = op.get("result") else {
                continue;
            };
            let Some(intents) = result
                .get("entries")
                .and_then(Value::as_array)
                .and_then(|entries| {
                    entries.iter().find_map(|pair| {
                        let pair = pair.as_array()?;
                        (pair[0].as_str()? == "intents")
                            .then(|| pair[1].get("values"))
                            .flatten()
                    })
                })
                .and_then(Value::as_array)
            else {
                continue;
            };
            for (intent_index, intent) in intents.iter().enumerate() {
                let matched = intent
                    .get("entries")
                    .and_then(Value::as_array)
                    .and_then(|entries| {
                        entries.iter().find_map(|pair| {
                            let pair = pair.as_array()?;
                            (pair[0].as_str()? == "why").then(|| pair[1].as_str())
                        })
                    })
                    .flatten()
                    == Some(why);
                if matched {
                    return Some((case_index, op_index, intent_index));
                }
            }
        }
    }
    None
}

/// Bounded permutation controls for every specialized tagged comparison boundary: all values stay identical, only the
/// source property order changes, and the genuine tagged comparator must fail. The one documented plain-envelope
/// exclusion is checked separately by `private_tactics_object_order_controls`.
#[test]
fn private_tactics_specialized_order_controls() {
    let corpus = Corpus::load();

    // 1) act result root object (intents/status/attacking).
    let act_case = corpus.case_index("fight-plan-drift-resend");
    let raw = corpus.raw_case(act_case);
    let (baseline, _) = super::source_tests::replay_case(&corpus, act_case, &raw);
    assert!(baseline.is_empty(), "baseline must be green");
    let mut mutated = raw.clone();
    {
        let row = act_row_mut(&mut mutated);
        let result = row.get_mut("result").expect("result");
        assert!(swap_tagged_entries(result, 0, 1), "act result root swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, act_case, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("result")
            && (failure.contains("order/name") || failure.contains("entry"))),
        "act result root property order was not detected: {failures:?}"
    );

    // 2) Intent object entries (priority/timing).
    let mut mutated = raw.clone();
    {
        let row = act_row_mut(&mut mutated);
        let intents = result_intents_mut(row).expect("result intents");
        let intent = intents.first_mut().expect("first intent");
        assert!(swap_tagged_entries(intent, 2, 3), "intent entry swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, act_case, &mutated);
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("order/name") || failure.contains("object entry")),
        "intent property order was not detected: {failures:?}"
    );

    // 3) check result root object (kind/holdUntil/intent) in the frozen reflex witness.
    let (check_case, check_op) =
        find_check_object_row(corpus.raw()).expect("a check result object row");
    let check_raw = corpus.raw_case(check_case);
    let (baseline, _) = super::source_tests::replay_case(&corpus, check_case, &check_raw);
    assert!(baseline.is_empty(), "check baseline must be green");
    let mut mutated = check_raw.clone();
    {
        let operations = mutated["operations"].as_array_mut().expect("operations");
        let row = operations.get_mut(check_op).expect("check op");
        let result = row.get_mut("result").expect("check result");
        assert!(swap_tagged_entries(result, 0, 1), "check result root swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, check_case, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("result")
            && (failure.contains("order/name") || failure.contains("entry"))),
        "check result property order was not detected: {failures:?}"
    );

    // 4) callback event object entries (sequence/kind).
    let mut mutated = raw.clone();
    {
        let row = act_row_mut(&mut mutated);
        let events = callback_events_mut(row).expect("callback events");
        let event = events.first_mut().expect("first event");
        assert!(swap_tagged_entries(event, 0, 1), "callback event swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, act_case, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("callbacks")
            && (failure.contains("order/name") || failure.contains("entry"))),
        "callback event property order was not detected: {failures:?}"
    );

    // 5) paths.walk result object entries (dist/exact).
    let (walk_case, walk_op) =
        find_walk_object_row(corpus.raw()).expect("paths.walk result object");
    let walk_raw = corpus.raw_case(walk_case);
    let (baseline, _) = super::source_tests::replay_case(&corpus, walk_case, &walk_raw);
    assert!(baseline.is_empty(), "walk baseline must be green");
    let mut mutated = walk_raw.clone();
    {
        let operations = mutated["operations"].as_array_mut().expect("operations");
        let row = operations.get_mut(walk_op).expect("walk op");
        let result = walk_result_mut(row).expect("walk result object");
        assert!(swap_tagged_entries(result, 0, 1), "walk result swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, walk_case, &mutated);
    assert!(
        failures.iter().any(|failure| failure.contains("callbacks")
            && (failure.contains("order/name") || failure.contains("entry"))),
        "paths.walk result property order was not detected: {failures:?}"
    );

    // 6) root tagged Memory section object entries (fighters/mobs).
    let mut mutated = raw.clone();
    {
        let row = act_row_mut(&mut mutated);
        let memory = row.get_mut("memory").expect("memory");
        assert!(swap_tagged_entries(memory, 0, 1), "memory root swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, act_case, &mutated);
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("memory section") || failure.contains("memory")),
        "root Memory property order was not detected: {failures:?}"
    );

    // 7) tolerant derived point (`flee` move target) entries x/y reordered.
    let (flee_case, flee_op, flee_intent) =
        find_intent_row(corpus.raw(), "flee").expect("a flee move intent");
    let flee_raw = corpus.raw_case(flee_case);
    let (baseline, _) = super::source_tests::replay_case(&corpus, flee_case, &flee_raw);
    assert!(baseline.is_empty(), "flee baseline must be green");
    let mut mutated = flee_raw.clone();
    {
        let operations = mutated["operations"].as_array_mut().expect("operations");
        let row = operations.get_mut(flee_op).expect("flee op");
        let intents = result_intents_mut(row).expect("intents");
        let intent = intents.get_mut(flee_intent).expect("flee intent");
        let target = pair_mut(intent, "to").expect("flee to");
        assert!(swap_tagged_entries(target, 0, 1), "derived point swap");
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, flee_case, &mutated);
    assert!(
        failures
            .iter()
            .any(|failure| failure.contains("derived point") || failure.contains("order/name")),
        "tolerant derived point property order was not detected: {failures:?}"
    );

    eprintln!(
        "private-tactics specialized order controls: act-result root, intent, check-result root, callback event, paths.walk result, root Memory and tolerant derived point order all detected"
    );
}

/// Group-3 repair control: the `paths.walk` argument tolerance is bound to actual computed `pickHoldSpot` ancestry. The
/// three captured direct declared `Hold.at` walk targets (`world-arrive-24.001-0`, `world-arrive-120.001-800`,
/// `world-arrive-100-799`) must stay bit-exact under a tiny delta; a genuinely computed crowded-slot target keeps the
/// approved `2e-6` derived-geometry allowance.
#[test]
fn private_tactics_coliseum_walk_target_controls() {
    let corpus = Corpus::load();
    let tiny = 1e-9;

    for case_id in [
        "world-arrive-24.001-0",
        "world-arrive-120.001-800",
        "world-arrive-100-799",
    ] {
        let index = corpus.case_index(case_id);
        let raw = corpus.raw_case(index);
        let (baseline, _) = super::source_tests::replay_case(&corpus, index, &raw);
        assert!(baseline.is_empty(), "{case_id}: baseline must be green");
        let mut mutated = raw.clone();
        let declared = {
            let operations = mutated["operations"].as_array_mut().expect("operations");
            let row = operations.get_mut(2).expect("world-arrive op2");
            assert_eq!(
                row["method"].as_str(),
                Some("act"),
                "{case_id}: op2 is the declared act"
            );
            // Prove the walked point is exactly the declared Hold.at endpoint, not a computed slot: the expected move
            // intent `to` and the expected paths.walk argument 1 are the same point.
            let intents = result_intents_mut(row).expect("act intents");
            let intent = intents.first().expect("hold-intent");
            let target = pair(intent, "to").expect("intent to").clone();
            let x = walk_target_x_mut(row).expect("paths.walk target");
            let old = x.as_f64().expect("walk target x");
            *x = serde_json::json!(old + tiny);
            point_coords_t(&target)
        };
        let (failures, _) = super::source_tests::replay_case(&corpus, index, &mutated);
        assert!(
            !failures.is_empty(),
            "{case_id}: a tiny delta on the direct declared paths.walk endpoint was accepted (declared={declared:?})"
        );
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("callbacks") && failure.contains("args[1]")),
            "{case_id}: expected walk-argument mismatch, got {failures:?}"
        );
    }

    // Genuine computed pickHoldSpot slot: the same tiny delta stays inside the reviewed derived-geometry allowance.
    let index = corpus.case_index("hold-crowded-spot-stale");
    let raw = corpus.raw_case(index);
    let (baseline, _) = super::source_tests::replay_case(&corpus, index, &raw);
    assert!(baseline.is_empty(), "computed-slot baseline must be green");
    let mut mutated = raw.clone();
    {
        let operations = mutated["operations"].as_array_mut().expect("operations");
        let act = operations
            .iter_mut()
            .find(|operation| operation["method"].as_str() == Some("act"))
            .expect("crowded act row");
        let x = walk_target_x_mut(act).expect("computed paths.walk target");
        let old = x.as_f64().expect("walk target x");
        *x = serde_json::json!(old + tiny);
    }
    let (failures, _) = super::source_tests::replay_case(&corpus, index, &mutated);
    assert!(
        failures.is_empty(),
        "a computed pickHoldSpot walk target must keep the approved 2e-6 allowance: {failures:?}"
    );

    eprintln!(
        "private-tactics coliseum walk-target controls: 3 direct declared endpoints bit-exact under {tiny:?}; computed crowded-slot target tolerated"
    );
}
