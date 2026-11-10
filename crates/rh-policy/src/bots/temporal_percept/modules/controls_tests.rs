//! P-BOT-MODULES-1 bounded intake/semantic controls (new-file lease).
//!
//! Two kinds of control live here, and neither is a second parity harness:
//!
//! 1. **Strict atomic-reader negatives** — the `verify.mjs` reader controls adapted to the native reader. Each control mutates
//!    exactly one fact of the frozen `rh-bot-private-modules-source/1` body (raw serde_json on a clone, never the frozen file)
//!    and requires `source_input::validate_body`/`build_body` to return a path-bearing `Err` — never a panic, never a partial
//!    conversion. The untouched body must still load 255 cases / 3,259 operations.
//! 2. **Bounded semantic controls** — native inputs are mutated (never corpus answer tapes) and the native decision must move
//!    accordingly: card risk/block/order/cost leaves, `ChestHunter` hold/margin/cache/stall/clock boundaries, the shared
//!    planning transitions (event-time schedule, no-deal, read boundary/asks/lapse/bias/latch) and the ordered registry.
//!
//! All numeric comparisons are exact binary64 (`f64::to_bits` where a value is not an exact literal), the corpus and the
//! frozen source are read-only, and every failure message names the control that moved.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

use serde_json::{json, Value};

use rh_sim::mapdata::Zone;
use rh_sim::{FactionId, Vec2, WeaponId};

use super::chest_hunt::{ChestDecision, ChestHunter, ChestInput, CHEST_HUNT};
use super::choice::{active_weapon, card_score, choose_option, costs_something, option_score};
use super::registry::{CustomModule, Registry};
use super::source_input::{load, parse_raw, validate_body};
use super::types::{CardCounts, ChestSelf, Features, HuntChest, HuntSelf, ModuleId};
use crate::bots::planning::{
    learned_bias_of, plan_spawn_score_raw, source_choose_boon, source_choose_spawn, source_intents,
    source_observe, LearnedBiasView, PlanCamp, PlanDirective, PlanMap, PlanSpawn, PlanState,
    ReadyWhy, SourcePlanDeal, PLAN_CAMPS, PLAN_RULES,
};
use crate::bots::random::Rng;
use crate::bots::types::{TierId, TierParams, TIERS};

// =================================================================================================== strict reader controls

/// The frozen witness path relative to `crates/rh-policy` (`env!("CARGO_MANIFEST_DIR")`), as sealed in the packet evidence.
const SOURCE_RELATIVE_PATH: &str = "../../parity/policy/bot-private-modules/source.json";

/// The frozen witness text, read once and shared read-only by every control.
fn corpus_text() -> &'static str {
    static TEXT: OnceLock<String> = OnceLock::new();
    TEXT.get_or_init(|| {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SOURCE_RELATIVE_PATH);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("frozen source {}: {error}", path.display()))
    })
}

/// The frozen witness parsed once with the strict raw reader; each negative control mutates a clone of it.
fn corpus_body() -> &'static Value {
    static BODY: OnceLock<Value> = OnceLock::new();
    BODY.get_or_init(|| parse_raw(corpus_text()).expect("strict raw parse of the frozen body"))
}

fn tagged_entries_mut(value: &mut Value) -> &mut Vec<Value> {
    match value.get_mut("entries").and_then(Value::as_array_mut) {
        Some(entries) => entries,
        None => panic!("expected a tagged object envelope"),
    }
}

/// One field of a `{$:"object",entries:[[key,value],...]}` tagged envelope.
fn tagged_field_mut<'a>(value: &'a mut Value, name: &str) -> &'a mut Value {
    tagged_entries_mut(value)
        .iter_mut()
        .find(|pair| pair.get(0).and_then(Value::as_str) == Some(name))
        .map(|pair| &mut pair[1])
        .unwrap_or_else(|| panic!("tagged object has no field {name}"))
}

fn tagged_field_opt_mut<'a>(value: &'a mut Value, name: &str) -> Option<&'a mut Value> {
    let entries = value.get_mut("entries")?.as_array_mut()?;
    entries
        .iter_mut()
        .find(|pair| pair.get(0).and_then(Value::as_str) == Some(name))
        .map(|pair| &mut pair[1])
}

fn remove_tagged_field(value: &mut Value, name: &str) {
    let entries = tagged_entries_mut(value);
    let index = entries
        .iter()
        .position(|pair| pair.get(0).and_then(Value::as_str) == Some(name))
        .unwrap_or_else(|| panic!("tagged object has no field {name}"));
    entries.remove(index);
}

fn tagged_field<'a>(value: &'a Value, name: &str) -> &'a Value {
    value
        .get("entries")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries
                .iter()
                .find(|pair| pair.get(0).and_then(Value::as_str) == Some(name))
        })
        .map(|pair| &pair[1])
        .unwrap_or_else(|| panic!("tagged object has no field {name}"))
}

/// JS number read of a declared scalar (`{$:"number",value:"..."}` or a plain JSON number).
fn tagged_number(value: &Value) -> f64 {
    if let Some(number) = value.as_f64() {
        return number;
    }
    match value
        .get("value")
        .and_then(Value::as_str)
        .expect("a declared number is a plain JSON number or a number tag")
    {
        "-0" => -0.0,
        "NaN" => f64::NAN,
        "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        other => panic!("unknown declared number spelling {other}"),
    }
}

fn operation_mut<'a>(body: &'a mut Value, method: &str) -> &'a mut Value {
    let cases = body
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .expect("source cases");
    for case in cases.iter_mut() {
        let Some(operations) = case.get_mut("operations").and_then(Value::as_array_mut) else {
            continue;
        };
        for operation in operations.iter_mut() {
            if operation.get("method").and_then(Value::as_str) == Some(method) {
                return operation;
            }
        }
    }
    panic!("the frozen corpus has a {method} operation")
}

fn observe_operations_mut(body: &mut Value) -> &mut Vec<Value> {
    let cases = body
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .expect("source cases");
    for case in cases.iter_mut() {
        let Some(operations) = case.get_mut("operations").and_then(Value::as_array_mut) else {
            continue;
        };
        let observes = operations
            .iter()
            .filter(|operation| operation.get("method").and_then(Value::as_str) == Some("observe"))
            .count();
        if observes > 1 {
            return operations;
        }
    }
    panic!("the frozen corpus has a case with two observations")
}

fn first_config_mut(body: &mut Value) -> &mut Value {
    let cases = body
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .expect("source cases");
    for case in cases.iter_mut() {
        let Some(entries) = case
            .get_mut("configs")
            .and_then(|configs| configs.get_mut("entries"))
            .and_then(Value::as_array_mut)
        else {
            continue;
        };
        if let Some(first) = entries.first_mut() {
            return &mut first[1];
        }
    }
    panic!("the frozen corpus declares a source config")
}

fn first_chest_mut(body: &mut Value) -> &mut Value {
    let cases = body
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .expect("source cases");
    for case in cases.iter_mut() {
        let Some(operations) = case.get_mut("operations").and_then(Value::as_array_mut) else {
            continue;
        };
        for operation in operations.iter_mut() {
            if operation.get("method").and_then(Value::as_str) != Some("observe") {
                continue;
            }
            let declaration = operation.get_mut("declaration").expect("declaration");
            let Some(input) = tagged_field_opt_mut(declaration, "input") else {
                continue;
            };
            let Some(extras) = tagged_field_opt_mut(input, "extras") else {
                continue;
            };
            let Some(chests) = tagged_field_opt_mut(extras, "chests") else {
                continue;
            };
            let Some(values) = chests.get_mut("values").and_then(Value::as_array_mut) else {
                continue;
            };
            if let Some(first) = values.first_mut() {
                return first;
            }
        }
    }
    panic!("the frozen corpus has an observation with a declared chest")
}

/// Replace the first map's `seed` with an arbitrary tagged value: the strict tagged-value decode controls all hook in there,
/// so each is rejected while decoding the first map rather than after the whole body converts.
fn map_value_tag_mut<'a>(body: &'a mut Value, name: &str) -> &'a mut Value {
    let maps = body
        .get_mut("maps")
        .and_then(Value::as_array_mut)
        .expect("source maps");
    let value = maps
        .first_mut()
        .expect("a source map")
        .get_mut("value")
        .expect("map value");
    tagged_field_mut(value, name)
}

fn declaration_mut(operation: &mut Value) -> &mut Value {
    operation.get_mut("declaration").expect("declaration")
}

fn input_mut(declaration: &mut Value) -> &mut Value {
    tagged_field_mut(declaration, "input")
}

fn input_now(declaration: &Value) -> f64 {
    tagged_number(tagged_field(tagged_field(declaration, "input"), "now"))
}

#[test]
fn strict_reader_positive_body_loads() {
    // The frozen witness is unchanged and the strict reader still builds it atomically.
    let source = load().expect("the frozen private-modules corpus loads atomically");
    assert_eq!(source.cases.len(), 255, "the witness declares 255 cases");
    let operations: usize = source.cases.iter().map(|case| case.operations.len()).sum();
    assert_eq!(operations, 3_259, "the witness declares 3,259 operations");
    assert_eq!(source.maps.len(), 8, "the witness embeds 8 source maps");
    assert_eq!(source.catalog.card_ids.len(), 80, "all 80 source cards");
    assert_eq!(source.catalog.ability_ids.len(), 5, "all 5 source Wishes");

    // The sealed raw bytes are pinned, strict-parse without duplicate keys, and the owned body validates exactly.
    assert_eq!(
        corpus_text().len(),
        12_755_158,
        "the sealed source.json byte length is pinned"
    );
    assert!(
        validate_body(corpus_body()).is_ok(),
        "the untouched frozen body builds atomically"
    );
}

/// One strict-negative control: exactly one mutation on a clone of the frozen body, then the strict atomic reader must
/// return a path-bearing `Err` — never a panic and never a partially converted value.
fn reject_mutation(
    original: &Value,
    controls: &mut usize,
    label: &str,
    needles: &[&str],
    mutate: impl FnOnce(&mut Value),
) -> String {
    *controls += 1;
    let mut body = original.clone();
    mutate(&mut body);
    let error = match validate_body(&body) {
        Ok(()) => panic!("{label}: the strict atomic reader accepted a mutated body"),
        Err(error) => error,
    };
    assert!(!error.is_empty(), "{label}: the rejection message is empty");
    let path = error.split(':').next().unwrap_or("");
    assert!(
        !path.is_empty() && path.starts_with("source"),
        "{label}: the rejection must name its source path, got {error:?}"
    );
    assert!(
        needles.iter().any(|needle| error.contains(*needle)),
        "{label}: rejection {error:?} names none of {needles:?}"
    );
    error
}

fn reject_raw(controls: &mut usize, label: &str, raw: &str, needle: &str) {
    *controls += 1;
    let error = parse_raw(raw).expect_err(label);
    assert!(!error.is_empty(), "{label}: empty raw parse rejection");
    assert!(
        error.starts_with("raw JSON") && error.contains(needle),
        "{label}: raw parse rejection {error:?} does not name {needle:?}"
    );
}

/// Raw duplicate keys plus every tagged `rh-method-value/1` shape the frozen format does not admit (10 controls).
#[test]
fn strict_reader_controls_reject_duplicate_keys_and_tagged_values() {
    let original = corpus_body();
    let mut controls = 0usize;

    // 1-2: raw JSON duplicate keys, including a duplicate that only collides after escape decoding.
    reject_raw(
        &mut controls,
        "raw duplicate key",
        r#"{"format":1,"format":2}"#,
        "duplicate raw JSON key",
    );
    reject_raw(
        &mut controls,
        "escaped raw duplicate key",
        r#"{"a":1,"\u0061":2}"#,
        "duplicate raw JSON key",
    );

    // 3: unsupported future tag.
    reject_mutation(
        original,
        &mut controls,
        "unsupported tag object",
        &["future"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "future"});
        },
    );
    // 4: a tag that carries an extra (closed-tag) field.
    reject_mutation(
        original,
        &mut controls,
        "tag with extra field",
        &["tag field"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "undefined", "x": 1});
        },
    );
    // 5: duplicate keys inside a tagged Map.
    reject_mutation(
        original,
        &mut controls,
        "duplicate tagged map keys",
        &["duplicate Map key"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "map", "entries": [["a", 1], ["a", 2]]});
        },
    );
    // 6: duplicate keys inside a tagged object.
    reject_mutation(
        original,
        &mut controls,
        "duplicate tagged object keys",
        &["duplicate object key"],
        |body| {
            *map_value_tag_mut(body, "seed") =
                json!({"$": "object", "entries": [["a", 1], ["a", 2]]});
        },
    );
    // 7: the number tag accepts only "-0"/"NaN"/"+Infinity"/"-Infinity", never "Infinity".
    reject_mutation(
        original,
        &mut controls,
        "number tag Infinity",
        &["number tag"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "number", "value": "Infinity"});
        },
    );
    // 8: u8 member out of range.
    reject_mutation(original, &mut controls, "u8 value 256", &["u8"], |body| {
        *map_value_tag_mut(body, "seed") = json!({"$": "u8", "values": [256]});
    });
    // 9: callable tags are output diagnostics only, never declared input.
    reject_mutation(
        original,
        &mut controls,
        "callable in input position",
        &["callable"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "callable"});
        },
    );
    // 10: instance tags are output diagnostics only, never declared input.
    reject_mutation(
        original,
        &mut controls,
        "instance in input position",
        &["instance"],
        |body| {
            *map_value_tag_mut(body, "seed") = json!({"$": "instance", "name": "x", "entries": []});
        },
    );

    assert_eq!(controls, 10, "tagged-value/raw-key strict controls");
}

/// The corpus envelope is closed and case ids are unique (3 controls).
#[test]
fn strict_reader_controls_reject_envelope_mutations() {
    let original = corpus_body();
    let mut controls = 0usize;

    // 11: envelope format token must be the sealed one.
    reject_mutation(
        original,
        &mut controls,
        "future envelope format",
        &["source.format"],
        |body| {
            body.as_object_mut()
                .expect("source envelope")
                .insert("format".into(), json!("future"));
        },
    );
    // 12: the envelope is closed.
    reject_mutation(
        original,
        &mut controls,
        "extra envelope field",
        &["unsupported envelope field"],
        |body| {
            body.as_object_mut()
                .expect("source envelope")
                .insert("extra".into(), json!(1));
        },
    );
    // 13: case ids are unique (a duplicate would silently shadow a witness case).
    reject_mutation(
        original,
        &mut controls,
        "duplicate case id",
        &["duplicate case id"],
        |body| {
            let cases = body
                .get_mut("cases")
                .and_then(Value::as_array_mut)
                .expect("source cases");
            let duplicate = cases.first().expect("a source case").clone();
            cases.push(duplicate);
        },
    );

    assert_eq!(controls, 3, "envelope strict controls");
}

/// The declared percept facts every module consumes (6 controls).
#[test]
fn strict_reader_controls_reject_observe_mutations() {
    let original = corpus_body();
    let mut controls = 0usize;

    // 14: the observe clock must be a finite declared number (tagged +Infinity refused).
    reject_mutation(
        original,
        &mut controls,
        "nonfinite observe now",
        &["finite"],
        |body| {
            let operation = operation_mut(body, "observe");
            let declaration = declaration_mut(operation);
            *tagged_field_mut(input_mut(declaration), "now") =
                json!({"$": "number", "value": "+Infinity"});
        },
    );
    // 15: every consumed self fact is present (readyAt is mandatory).
    reject_mutation(
        original,
        &mut controls,
        "percept self missing readyAt",
        &["readyAt"],
        |body| {
            let operation = operation_mut(body, "observe");
            let declaration = declaration_mut(operation);
            let self_object = tagged_field_mut(input_mut(declaration), "self");
            remove_tagged_field(self_object, "readyAt");
        },
    );
    // 16: the self status is a consumed enum, not free text.
    reject_mutation(
        original,
        &mut controls,
        "unsupported self status",
        &["status"],
        |body| {
            let operation = operation_mut(body, "observe");
            let declaration = declaration_mut(operation);
            let self_object = tagged_field_mut(input_mut(declaration), "self");
            *tagged_field_mut(self_object, "status") = json!("future");
        },
    );
    // 17: the cfg is a declared case-local identity token.
    reject_mutation(
        original,
        &mut controls,
        "unknown cfg token",
        &["unknown cfg identity token"],
        |body| {
            let operation = operation_mut(body, "observe");
            *tagged_field_mut(declaration_mut(operation), "cfg") = json!("absent");
        },
    );
    // 18: the view clock must be finite (tagged NaN refused).
    reject_mutation(
        original,
        &mut controls,
        "nonfinite viewT",
        &["finite"],
        |body| {
            let operation = operation_mut(body, "observe");
            let declaration = declaration_mut(operation);
            *tagged_field_mut(input_mut(declaration), "viewT") =
                json!({"$": "number", "value": "NaN"});
        },
    );
    // 19: Memory's observe clock is nondecreasing per cfg.
    reject_mutation(
        original,
        &mut controls,
        "backwards Memory clock",
        &["backwards"],
        |body| {
            let operations = observe_operations_mut(body);
            let first_now = {
                let first = operations
                    .iter()
                    .find(|operation| {
                        operation.get("method").and_then(Value::as_str) == Some("observe")
                    })
                    .expect("first observation");
                input_now(declaration_mut_value(first))
            };
            let second = operations
                .iter_mut()
                .filter(|operation| {
                    operation.get("method").and_then(Value::as_str) == Some("observe")
                })
                .nth(1)
                .expect("second observation");
            let declaration = declaration_mut(second);
            *tagged_field_mut(input_mut(declaration), "now") = json!(first_now - 1.0);
        },
    );

    assert_eq!(controls, 6, "observe strict controls");
}

/// The declared config, map, hook and chest facts the modules consume (5 controls).
#[test]
fn strict_reader_controls_reject_module_fact_mutations() {
    let original = corpus_body();
    let mut controls = 0usize;

    // 20: a config's tier values carry every consumed tier fact (knowledge is read).
    reject_mutation(
        original,
        &mut controls,
        "tierValues missing knowledge",
        &["knowledge"],
        |body| {
            let config = first_config_mut(body);
            let tier_values = tagged_field_mut(config, "tierValues");
            remove_tagged_field(tier_values, "knowledge");
        },
    );
    // 21: cfg.map is a foreign key into the declared maps.
    reject_mutation(
        original,
        &mut controls,
        "absent map label",
        &["absent-map"],
        |body| {
            let config = first_config_mut(body);
            *tagged_field_mut(config, "map") = json!("absent-map");
        },
    );
    // 22: the declared terrain layer is exactly w*h bytes (one short is refused).
    reject_mutation(
        original,
        &mut controls,
        "terrain one byte short",
        &["terrain", "map", "hash"],
        |body| {
            let maps = body
                .get_mut("maps")
                .and_then(Value::as_array_mut)
                .expect("source maps");
            let value = maps
                .first_mut()
                .expect("a source map")
                .get_mut("value")
                .expect("map value");
            let terrain = tagged_field_mut(value, "terrain");
            terrain
                .get_mut("values")
                .and_then(Value::as_array_mut)
                .expect("terrain bytes")
                .pop();
        },
    );
    // 23: module hook names are the source hook set.
    reject_mutation(
        original,
        &mut controls,
        "future hook name",
        &["future"],
        |body| {
            let operation = operation_mut(body, "hook");
            let declaration = declaration_mut(operation);
            *tagged_field_mut(declaration, "name") = json!("future");
        },
    );
    // 24: an observe chest row carries who took each option (takenBy is consumed at pick time).
    reject_mutation(
        original,
        &mut controls,
        "chest row missing takenBy",
        &["takenBy"],
        |body| {
            let chest = first_chest_mut(body);
            remove_tagged_field(chest, "takenBy");
        },
    );

    assert_eq!(controls, 5, "module-fact strict controls");
}

/// Immutable declaration view for the backwards-clock control's first observation.
fn declaration_mut_value(operation: &Value) -> &Value {
    operation.get("declaration").expect("declaration")
}

// ======================================================================================================= card-choice leaves

fn chest_self() -> ChestSelf {
    ChestSelf {
        faction: "fire".into(),
        weapons: [Some(WeaponId::Sword), None],
        slot: None,
        risk: None,
        build: Some(CardCounts::default()),
    }
}

fn with_risk(risk: f64) -> ChestSelf {
    let mut me = chest_self();
    me.risk = Some(risk);
    me
}

fn with_build(entries: &[(&str, f64)]) -> ChestSelf {
    let mut me = chest_self();
    let mut build = CardCounts::default();
    for (id, count) in entries {
        build.set(*id, *count);
    }
    me.build = Some(build);
    me
}

#[test]
fn choice_risk_boundaries_are_strict() {
    // A dangerous augment is refused at exactly 0.7 and accepted above it (source `risk > DANGER_RISK`).
    assert_eq!(
        card_score("glassCannon", &with_risk(0.7)).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "Glass Cannon must be unusable at risk 0.7 exactly"
    );
    let accepted = card_score("glassCannon", &with_risk(0.700001));
    // tier 2 + 1 + 2 * clamp(risk) with no fitting tags.
    assert_eq!(
        accepted.to_bits(),
        (2.0f64 + 1.0 + 2.0 * 0.700001).to_bits(),
        "Glass Cannon is accepted a hair above the danger line"
    );
    // The second dangerous card shares the boundary.
    assert_eq!(
        card_score("raceToZero", &with_risk(0.7)).to_bits(),
        f64::NEG_INFINITY.to_bits()
    );

    // A card that gives something up is refused below 0.5 and accepted at exactly 0.5 (`risk < TRADEOFF_RISK`).
    assert_eq!(
        card_score("committed", &with_risk(0.499999)).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "Committed must be refused at risk 0.499999"
    );
    let accepted = card_score("committed", &with_risk(0.5));
    // tier 3 + 1 + 2 * 0.5, no tags, the lock flag only costs (it is not a tag fit).
    assert_eq!(
        accepted.to_bits(),
        5.0f64.to_bits(),
        "Committed at risk 0.5"
    );
    // The bounds clamp: a negative risk reads as 0, a risk above 1 reads as 1.
    let mut low = chest_self();
    low.risk = Some(-0.25);
    assert_eq!(
        card_score("thickSkull", &low).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "a clamped-to-zero risk refuses a tradeoff card"
    );
}

#[test]
fn choice_boost_cap_reads_the_raw_build_count() {
    // CHEST_BOOST_MAX_PICKS is 3: raw count 2 is usable, raw count 3 is refused (never floored/half-picked).
    let with_picks = |picks: f64| {
        let mut me = chest_self();
        let mut build = CardCounts::default();
        build.set("boost:ad", picks);
        me.build = Some(build);
        me
    };
    // 2.5 + baseFit("ad", sword) = 3.5.
    assert_eq!(
        card_score("boost:ad", &with_picks(2.0)).to_bits(),
        3.5f64.to_bits()
    );
    assert_eq!(
        card_score("boost:ad", &with_picks(2.999_999)).to_bits(),
        3.5f64.to_bits(),
        "the raw count below the cap still scores"
    );
    assert_eq!(
        card_score("boost:ad", &with_picks(3.0)).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "a third pick is refused"
    );
    // The shield boost resembles magic resist: a sword gets no fit (2.5 + 0).
    assert_eq!(
        card_score("boost:shield", &chest_self()).to_bits(),
        2.5f64.to_bits()
    );
}

#[test]
fn choice_option_order_is_first_equal_and_skips_taken_entries() {
    let me = chest_self();
    let ids = |list: &[&str]| list.iter().map(|id| (*id).to_string()).collect::<Vec<_>>();
    let taken = |list: &[&str]| list.iter().map(|id| (*id).to_string()).collect::<Vec<_>>();
    // Equal scores: the first index wins (never the later equal one).
    assert_eq!(choose_option(&ids(&["ad1", "ad1"]), &[], &me), 0);
    // A taken index is skipped even when it scores higher; takenBy[i] == "" is free.
    assert_eq!(
        choose_option(&ids(&["ad1", "ap1"]), &taken(&["someone", ""]), &me),
        1
    );
    assert_eq!(
        choose_option(&ids(&["ad1", "ap1"]), &taken(&["", ""]), &me),
        0
    );
    // An unknown id (0) loses to a real card.
    assert_eq!(choose_option(&ids(&["future-card", "ad1"]), &[], &me), 1);
    // Empty and all-refused panels skip with -1.
    assert_eq!(choose_option(&[], &[], &me), -1);
    assert_eq!(
        choose_option(&ids(&["glassCannon"]), &[], &with_risk(0.5)),
        -1
    );
    // The slot in hand decides the active weapon (fists for an empty slot).
    let mut slot_one = chest_self();
    slot_one.slot = Some(1);
    assert_eq!(active_weapon(&slot_one), WeaponId::Fists);
    assert_eq!(active_weapon(&chest_self()), WeaponId::Sword);
}

#[test]
fn choice_block_rules_and_unknown_ids_are_source_exact() {
    // An id the catalog does not know is still takeable for 0 exactly.
    assert_eq!(
        card_score("future-card", &chest_self()).to_bits(),
        0.0f64.to_bits()
    );
    assert_eq!(
        option_score("future-card", &chest_self()).to_bits(),
        0.0f64.to_bits()
    );
    // A conditional without its base is unusable; owning the base makes it usable (Bloodthirst requires leech).
    assert_eq!(
        card_score("bloodthirst", &chest_self()).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "Bloodthirst without any leech base"
    );
    let with_base = with_build(&[("leech1", 1.0)]);
    // conditional: 4 + tier 2 + rule fit (no leech tag fit) = 6.
    assert_eq!(
        card_score("bloodthirst", &with_base).to_bits(),
        6.0f64.to_bits(),
        "Bloodthirst with its base owned"
    );
    // A unique card already held is unusable; a plain base card deepens instead (3 + tier 1 + ad fit 1).
    assert_eq!(
        card_score("thickSkull", &with_build(&[("thickSkull", 1.0)])).to_bits(),
        f64::NEG_INFINITY.to_bits(),
        "a unique card already held"
    );
    assert_eq!(
        card_score("thickSkull", &chest_self()).to_bits(),
        (2.0f64 + 1.0 + 2.0 * 0.5).to_bits(),
        "the same unique card when not held"
    );
    assert_eq!(
        card_score("ad1", &with_build(&[("ad2", 1.0)])).to_bits(),
        5.0f64.to_bits(),
        "owning a higher tier deepens the base stat"
    );
}

#[test]
fn choice_kill_augment_base_fit_matches_a_plain_base_card() {
    for weapon in [
        WeaponId::Sword,
        WeaponId::Axe,
        WeaponId::Bow,
        WeaponId::Shield,
        WeaponId::Wand,
        WeaponId::Fists,
    ] {
        let mut me = chest_self();
        me.weapons = [Some(weapon), None];
        // `kill:damage:10` is the ad base fit at 3.0; `ad1` is 1.5 + tier 1 + the same fit at 2.5.
        let kill = card_score("kill:damage:10", &me);
        let base = card_score("ad1", &me);
        assert_eq!(
            kill.to_bits(),
            (3.0f64 + (base - 2.5)).to_bits(),
            "{weapon:?}: the trophy's base fit must be the plain base card's fit"
        );
    }
    // Concrete values on the hand fixture: sword ad fits (kill 4, base 3.5).
    assert_eq!(
        card_score("kill:damage:10", &chest_self()).to_bits(),
        4.0f64.to_bits()
    );
    assert_eq!(card_score("ad1", &chest_self()).to_bits(), 3.5f64.to_bits());
    // A trophy for a stat the bot does not invest in still scores its fit (health -> vitality 0 on a sword).
    assert_eq!(
        card_score("kill:health:10", &chest_self()).to_bits(),
        3.0f64.to_bits()
    );
    // A malformed trophy id is not a trophy: unknown 0.
    assert_eq!(
        card_score("kill:notAStat:1", &chest_self()).to_bits(),
        0.0f64.to_bits()
    );
}

#[test]
fn choice_costs_something_mult_and_cost_flag_vs_plain_stat() {
    // A multiplier under 1 costs: Machine Gun (hit x0.5), Here Comes the Boom (attack speed x0.5), Slow Burn (dot x0.7).
    assert!(costs_something("machineGun"), "multiplier under one");
    assert!(costs_something("hereComesTheBoom"), "attack speed halved");
    assert!(costs_something("slowBurn"), "damage over time 30% less");
    // A cost flag costs: Committed locks the slot, Gambler gambles, Thick Skull forbids crits.
    assert!(costs_something("committed"), "lockSecondSlot flag");
    assert!(costs_something("gambler"), "gambler flag");
    assert!(costs_something("thickSkull"), "noCrit flag");
    // A plain stat card and an unknown id give nothing up.
    assert!(!costs_something("ad1"), "a plain base stat card");
    assert!(!costs_something("ap1"), "a plain base stat card");
    assert!(!costs_something("future-card"), "an unknown id");
}

// ============================================================================================================ ChestHunter

fn hunt_self_fixture() -> HuntSelf {
    HuntSelf {
        id: "me".into(),
        x: 1008.0,
        y: 1008.0,
        base: ChestSelf {
            faction: "fire".into(),
            weapons: [Some(WeaponId::Sword), None],
            slot: Some(0),
            risk: Some(0.5),
            build: Some(CardCounts::default()),
        },
        raw: None,
    }
}

fn hunt_chest(id: &str, dx: f64, expires_at: f64) -> HuntChest {
    HuntChest {
        id: id.into(),
        kind: "reward".into(),
        x: 1008.0 + dx,
        y: 1008.0,
        expires_at,
        life_ms: None,
        options: vec!["ad1".into(), "ap1".into()],
        taken_by: vec!["".into(), "".into()],
        pickers: Vec::new(),
        raw: None,
    }
}

/// A chest row whose declared birth age is exactly `age` at `server_time` (its own `lifeMs` clock).
fn hunt_chest_with_age(id: &str, dx: f64, age: f64, server_time: f64) -> HuntChest {
    let left = 10_000.0;
    let mut chest = hunt_chest(id, dx, server_time + left);
    chest.life_ms = Some(left + age);
    chest
}

/// Declared walk/sight callbacks plus the source log sink; every call is counted.
struct HuntCalls {
    walk: Rc<Cell<u32>>,
    sight: Rc<Cell<u32>>,
    logs: Rc<RefCell<Vec<String>>>,
}

impl HuntCalls {
    fn new() -> Self {
        Self {
            walk: Rc::new(Cell::new(0)),
            sight: Rc::new(Cell::new(0)),
            logs: Rc::new(RefCell::new(Vec::new())),
        }
    }
    fn walker(&self) -> impl FnMut(&HuntChest) -> Option<f64> {
        let calls = self.walk.clone();
        let me = Vec2::new(1008.0, 1008.0);
        move |chest: &HuntChest| {
            calls.set(calls.get() + 1);
            Some(super::types::dist(me, chest.pos()))
        }
    }
    fn sighter(&self) -> impl FnMut(&HuntChest) -> bool {
        let calls = self.sight.clone();
        move |_chest: &HuntChest| {
            calls.set(calls.get() + 1);
            true
        }
    }
    fn logger(&self) -> impl FnMut(&str) {
        let logs = self.logs.clone();
        move |message: &str| logs.borrow_mut().push(message.to_owned())
    }
    fn logs(&self) -> Vec<String> {
        self.logs.borrow().clone()
    }
}

fn hunt_decide(
    hunter: &mut ChestHunter,
    calls: &HuntCalls,
    now: f64,
    server_time: f64,
    chests: Vec<HuntChest>,
    fighting: bool,
    retreating: bool,
) -> ChestDecision {
    let mut walk = calls.walker();
    let mut sight = calls.sighter();
    let mut input = ChestInput {
        now,
        server_time,
        self_: hunt_self_fixture(),
        chests,
        walk: &mut walk,
        sight: &mut sight,
        fighting,
        retreating,
        in_coliseum: false,
        teleport_at: None,
    };
    let mut log = calls.logger();
    hunter.decide(&mut input, &mut log)
}

#[test]
fn hunter_birth_hold_boundary_is_149_150() {
    // A chest younger than holdMs (3 ticks = 150ms) is not read, not tried and not walked to; at 150ms it is picked.
    for (age, expect_pick) in [(149.0, false), (150.0, true)] {
        let calls = HuntCalls::new();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        let decision = hunt_decide(
            &mut hunter,
            &calls,
            100_000.0,
            100_000.0,
            vec![hunt_chest_with_age("young", 30.0, age, 100_000.0)],
            false,
            false,
        );
        if expect_pick {
            assert_eq!(
                decision,
                ChestDecision::Pick {
                    chest: "young".into(),
                    option: 0,
                    why: "taking option 0 (ad1)".into(),
                },
                "age {age} must be picked"
            );
            assert!(hunter.tried("young"), "age {age} spends the one pick");
        } else {
            assert_eq!(decision, ChestDecision::None, "age {age} must wait");
            assert!(!hunter.tried("young"), "age {age} must not spend the pick");
            assert_eq!(calls.walk.get(), 0, "age {age} must not start a walk");
        }
        assert_eq!(calls.sight.get(), 1, "age {age} is seen once");
    }
}

#[test]
fn hunter_pick_margin_boundary_is_strict() {
    // A pick is sent only with strictly more than pickMarginMs (350ms) of usable life left.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let at_margin = hunt_chest("box", 30.0, 100_000.0 + 350.0);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        100_000.0,
        100_000.0,
        vec![at_margin],
        false,
        false,
    );
    assert_eq!(decision, ChestDecision::None, "350ms of life is too late");
    assert!(!hunter.tried("box"));

    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let above_margin = hunt_chest("box", 30.0, 100_000.0 + 350.5);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        100_000.0,
        100_000.0,
        vec![above_margin],
        false,
        false,
    );
    assert_eq!(
        decision,
        ChestDecision::Pick {
            chest: "box".into(),
            option: 0,
            why: "taking option 0 (ad1)".into(),
        },
        "350.5ms of life is enough"
    );
}

#[test]
fn hunter_in_range_pick_is_free_while_retreating() {
    // Running away still takes an in-range pick (it moves nobody), but never starts a walk.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        100_000.0,
        100_000.0,
        vec![hunt_chest("near", 30.0, 110_000.0)],
        false,
        true,
    );
    assert_eq!(
        decision,
        ChestDecision::Pick {
            chest: "near".into(),
            option: 0,
            why: "taking option 0 (ad1)".into(),
        },
        "a retreating bot still picks a chest in reach"
    );

    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        100_000.0,
        100_000.0,
        vec![hunt_chest("far", 500.0, 110_000.0)],
        false,
        true,
    );
    assert_eq!(decision, ChestDecision::None, "retreating starts no walk");
    assert_eq!(
        calls.walk.get(),
        0,
        "retreating computes no walking distance"
    );
}

#[test]
fn hunter_fighting_walk_cap_is_384_385() {
    // In a fight only a chest within fightWalk = 12 * TILE = 384 u is worth the detour.
    for (dx, expect_walk) in [(384.0, true), (385.0, false)] {
        let calls = HuntCalls::new();
        let mut hunter = ChestHunter::new(CHEST_HUNT);
        let decision = hunt_decide(
            &mut hunter,
            &calls,
            0.0,
            100_000.0,
            vec![hunt_chest("box", dx, 110_000.0)],
            true,
            false,
        );
        if expect_walk {
            assert_eq!(
                decision,
                ChestDecision::Walk {
                    chest: "box".into(),
                    to: Vec2::new(1008.0 + dx, 1008.0),
                    why: "chest box".into(),
                },
                "384 u is exactly fightWalk"
            );
            assert_eq!(
                calls.logs(),
                vec!["going for chest box (384 u of walking)".to_string()]
            );
        } else {
            assert_eq!(decision, ChestDecision::None, "385 u is past fightWalk");
            assert_eq!(hunter.target(), None, "no walk is remembered");
        }
        assert_eq!(
            calls.walk.get(),
            1,
            "the distance is computed before the fight cap"
        );
    }
}

#[test]
fn hunter_walk_cache_silence_249_recompute_250() {
    // A cached walking distance is reused below walkCacheMs = 250 and recomputed at 250 (one callback each time).
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    for (now, expected_calls) in [(0.0, 1), (249.0, 1), (250.0, 2)] {
        let decision = hunt_decide(
            &mut hunter,
            &calls,
            now,
            now,
            vec![hunt_chest("box", 500.0, 10_000.0)],
            false,
            false,
        );
        assert_eq!(
            decision,
            ChestDecision::Walk {
                chest: "box".into(),
                to: Vec2::new(1508.0, 1008.0),
                why: "chest box".into(),
            },
            "now {now} keeps walking"
        );
        assert_eq!(
            calls.walk.get(),
            expected_calls,
            "walk callbacks at now {now}"
        );
    }
    assert_eq!(hunter.next_walk_index(), 2);
    assert_eq!(hunter.walk_cache().len(), 1, "one cached row per chest");
}

#[test]
fn hunter_stall_gives_up_at_3000_logs_and_marks_done() {
    // Walking 3000ms without getting stallProgress closer gives the chest up: log, counter, done set, state cleanup.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let mut decision = ChestDecision::None;
    for step in 0..7 {
        let now = f64::from(step) * 500.0;
        decision = hunt_decide(
            &mut hunter,
            &calls,
            now,
            now + 10_000.0,
            vec![hunt_chest("box", 500.0, 20_000.0)],
            false,
            false,
        );
    }
    assert_eq!(decision, ChestDecision::None, "the seventh think gives up");
    assert_eq!(hunter.stats.walks, 1, "only the first think began a walk");
    assert_eq!(hunter.stats.gave_up, 1, "one give-up counted");
    assert!(hunter.tried("box"), "the chest is marked done");
    assert_eq!(hunter.target(), None, "the walk is cleared");
    assert!(hunter.done_ids() == vec!["box".to_string()]);
    assert!(hunter.stalls().is_empty(), "the stall row is forgotten");
    assert!(
        hunter.walk_cache().is_empty(),
        "the walk cache row is forgotten"
    );
    assert_eq!(
        calls.logs(),
        vec![
            "going for chest box (500 u of walking)".to_string(),
            "giving up on chest box: not getting any closer".to_string(),
        ],
        "the exact source log strings"
    );
}

#[test]
fn hunter_stall_progress_needs_strictly_more_than_24() {
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    // The first think starts the walk to a chest 500 u away.
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        0.0,
        90_000.0,
        vec![hunt_chest("box", 500.0, 100_000.0)],
        false,
        false,
    );
    assert!(matches!(decision, ChestDecision::Walk { .. }));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("box".to_string(), 500.0, 0.0)]
    );
    // Exactly 24 u closer is not progress: the walked time keeps counting and the best distance does not move.
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        500.0,
        90_500.0,
        vec![hunt_chest("box", 476.0, 100_000.0)],
        false,
        false,
    );
    assert!(matches!(decision, ChestDecision::Walk { .. }));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("box".to_string(), 500.0, 500.0)]
    );
    // A hair more than 24 u closer resets both the best distance and the walk time (475.5 is exactly representable).
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        1000.0,
        91_000.0,
        vec![hunt_chest("box", 475.5, 100_000.0)],
        false,
        false,
    );
    assert!(matches!(decision, ChestDecision::Walk { .. }));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("box".to_string(), 475.5, 0.0)]
    );
}

#[test]
fn hunter_interrupted_walk_time_is_not_added() {
    // The stall record belongs to the chest: walking away to another chest (a fight interruption) adds no walked time.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let decide = |hunter: &mut ChestHunter, now: f64, chests: Vec<HuntChest>| {
        hunt_decide(hunter, &calls, now, now + 90_000.0, chests, false, false)
    };
    // t=0: only a is up (500 u away) -> walk a, stall a = (500, 0).
    assert!(matches!(
        decide(&mut hunter, 0.0, vec![hunt_chest("a", 500.0, 100_000.0)]),
        ChestDecision::Walk { .. }
    ));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("a".to_string(), 500.0, 0.0)]
    );
    // t=500: b appears 300 u away -> walk b (a new walk counted; a's record is untouched, no time added).
    assert!(matches!(
        decide(
            &mut hunter,
            500.0,
            vec![
                hunt_chest("a", 500.0, 100_000.0),
                hunt_chest("b", 300.0, 100_000.0),
            ]
        ),
        ChestDecision::Walk { .. }
    ));
    assert_eq!(hunter.target(), Some("b"));
    // t=1000: a is nearer again -> walk a; the last walk was to b, so a gains no walked time (still (500, 0)).
    assert!(matches!(
        decide(
            &mut hunter,
            1000.0,
            vec![
                hunt_chest("a", 500.0, 100_000.0),
                hunt_chest("b", 600.0, 100_000.0),
            ]
        ),
        ChestDecision::Walk { .. }
    ));
    assert_eq!(hunter.target(), Some("a"));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("a".to_string(), 500.0, 0.0), ("b".to_string(), 300.0, 0.0),],
        "the interrupted walk added no time to a"
    );
    assert_eq!(hunter.stats.walks, 2, "two different chests were walked to");
    // t=1500: b is gone (its stall row is pruned) and a is walked again: now the 500ms gap counts (capped at stallStepMax).
    assert!(matches!(
        decide(&mut hunter, 1500.0, vec![hunt_chest("a", 500.0, 100_000.0)]),
        ChestDecision::Walk { .. }
    ));
    assert_eq!(
        hunter.stalls().to_vec(),
        vec![("a".to_string(), 500.0, 500.0)]
    );
}

#[test]
fn hunter_uses_distinct_now_and_server_time_clocks() {
    // The chest's life is on serverTime, never on now: a chest long past its expiresAt is still picked while serverTime says
    // it has 1000ms left.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        50_000.0,
        9_000.0,
        vec![hunt_chest("box", 30.0, 10_000.0)],
        false,
        false,
    );
    assert_eq!(
        decision,
        ChestDecision::Pick {
            chest: "box".into(),
            option: 0,
            why: "taking option 0 (ad1)".into(),
        },
        "serverTime (not now) decides that the chest is alive"
    );
    // Conversely a chest whose usable life ended on serverTime is not up, however early now is.
    let calls = HuntCalls::new();
    let mut hunter = ChestHunter::new(CHEST_HUNT);
    let decision = hunt_decide(
        &mut hunter,
        &calls,
        50_000.0,
        10_000.0,
        vec![hunt_chest("box", 30.0, 10_000.0)],
        false,
        false,
    );
    assert_eq!(decision, ChestDecision::None, "serverTime expiry wins");
    assert!(!hunter.tried("box"));
}

// ================================================================================================= shared planning transitions

fn plan_map() -> PlanMap {
    PlanMap {
        camps: vec![
            PlanCamp {
                id: "fire-camp".into(),
                zone: Zone::Fire,
                x: 200.0,
                y: 200.0,
                elite_spot: -1,
            },
            PlanCamp {
                id: "frost-camp".into(),
                zone: Zone::Frost,
                x: 800.0,
                y: 200.0,
                elite_spot: 0,
            },
        ],
        spawn_pool: vec![
            PlanSpawn {
                x: 180.0,
                y: 220.0,
                zone: Zone::Fire,
            },
            PlanSpawn {
                x: 820.0,
                y: 220.0,
                zone: Zone::Frost,
            },
        ],
    }
}

fn source_deal(spawns: [f64; 2], pick: f64, boons: &[&str], boon: f64) -> SourcePlanDeal {
    SourcePlanDeal {
        ends_at: 145_000.0,
        spawns,
        taken: [false, false],
        pick,
        boons: boons.iter().map(|id| (*id).to_string()).collect(),
        boon,
    }
}

fn zero_bias(_key: &str) -> f64 {
    0.0
}

/// A stable disabled learned-bias view (the source default): every key reads 0.
fn disabled_learned() -> LearnedBiasView<'static> {
    static ZERO_BIAS: fn(&str) -> f64 = zero_bias;
    LearnedBiasView {
        enabled: false,
        bias: &ZERO_BIAS,
    }
}

/// One `source_intents` call over the shared plan map with the caller's declared draw lanes.
fn plan_intents(
    state: &mut PlanState,
    now: f64,
    params: &TierParams,
    deal: Option<&SourcePlanDeal>,
    learned: &LearnedBiasView<'_>,
    decide: &mut dyn FnMut() -> f64,
    lapse: &mut dyn FnMut() -> f64,
) -> Option<PlanDirective> {
    let map = plan_map();
    source_intents(
        state,
        now,
        true,
        params,
        &map,
        Some(FactionId::Fire),
        Some(WeaponId::Sword),
        learned,
        deal,
        decide,
        lapse,
    )
}

#[test]
fn planning_first_deal_schedules_at_the_event_time_and_only_once() {
    let event_t = 100_000.0;
    let ends_at = 145_000.0;
    let draws = Cell::new(0u32);
    let mut state = PlanState::default();
    {
        let mut decide = || {
            draws.set(draws.get() + 1);
            0.0
        };
        source_observe(
            &mut state,
            event_t,
            true,
            ends_at,
            TierId::Normal,
            &mut decide,
        );
    }
    assert_eq!(
        draws.get(),
        2,
        "the schedule draws the reading and settling times"
    );
    // Normal read [3000, 6000] / settle [500, 1400], window 45,000ms (scale 1), draw 0 -> the lower bounds.
    assert_eq!(state.read_until.to_bits(), (event_t + 3_000.0).to_bits());
    assert_eq!(state.settle_ms.to_bits(), 500.0f64.to_bits());
    assert_eq!(state.last_call.to_bits(), 142_500.0f64.to_bits());

    // The `at` argument is the source event time: a later event clock (with the same window length) shifts the schedule
    // by exactly that difference, never by the percept's `now`.
    let mut later = PlanState::default();
    let mut decide = || 0.0;
    source_observe(
        &mut later,
        event_t + 17_000.0,
        true,
        ends_at + 17_000.0,
        TierId::Normal,
        &mut decide,
    );
    assert_eq!(
        (later.read_until - state.read_until).to_bits(),
        17_000.0f64.to_bits(),
        "the schedule is anchored on the deal event's time"
    );

    // Only the first valid deal schedules; later deals replace the deal in the adapter but never redraw the schedule.
    let redraws = Cell::new(0u32);
    {
        let mut decide = || {
            redraws.set(redraws.get() + 1);
            0.25
        };
        source_observe(
            &mut state,
            120_000.0,
            false,
            200_000.0,
            TierId::Hard,
            &mut decide,
        );
    }
    assert_eq!(redraws.get(), 0, "a later deal must not reschedule");
    assert_eq!(state.read_until.to_bits(), (event_t + 3_000.0).to_bits());
    assert_eq!(state.settle_ms.to_bits(), 500.0f64.to_bits());
    assert_eq!(state.last_call.to_bits(), 142_500.0f64.to_bits());
}

#[test]
fn planning_no_deal_ready_is_at_1000ms() {
    assert_eq!(PLAN_RULES.no_deal_ms.to_bits(), 1_000.0f64.to_bits());
    let params = TIERS[1];
    let learned = disabled_learned();
    let mut decide = || 0.0;
    let mut lapse = || 0.0;
    let mut state = PlanState::default();
    assert_eq!(
        plan_intents(
            &mut state,
            0.0,
            &params,
            None,
            &learned,
            &mut decide,
            &mut lapse
        ),
        None,
        "no deal yet"
    );
    assert_eq!(
        state.phase_at.map(|at| at.to_bits()),
        Some(0.0f64.to_bits())
    );
    assert_eq!(
        plan_intents(
            &mut state,
            999.999,
            &params,
            None,
            &learned,
            &mut decide,
            &mut lapse
        ),
        None,
        "999.999ms is still inside the no-deal wait"
    );
    assert_eq!(
        plan_intents(
            &mut state,
            1_000.0,
            &params,
            None,
            &learned,
            &mut decide,
            &mut lapse
        ),
        Some(PlanDirective::Ready {
            why: ReadyWhy::NoDeal
        }),
        "exactly 1000ms into the planning phase the bot readies"
    );
    assert!(state.ready_sent, "the ready latch is set");
}

#[test]
fn planning_read_boundary_three_asks_resend_and_settle() {
    // Shared schedule: read at event time 100,000 with draw 0 -> readUntil 103,000, settle 500, lastCall 142,500.
    let mut state = PlanState::default();
    let mut decide = || 0.0;
    source_observe(
        &mut state,
        100_000.0,
        true,
        145_000.0,
        TierId::Normal,
        &mut decide,
    );
    assert_eq!(state.read_until.to_bits(), 103_000.0f64.to_bits());
    assert_eq!(state.settle_ms.to_bits(), 500.0f64.to_bits());

    // The tier's reaction.mu is the extra resend wait: 400 + 100 = 500ms between asks.
    let mut params = TIERS[1];
    params.reaction.mu = 100.0;
    let learned = disabled_learned();
    let deal = source_deal([0.0, 1.0], -1.0, &[], -1.0);
    let decide_calls = Cell::new(0u32);
    let advance = |state: &mut PlanState, now: f64, decide_calls: &Cell<u32>| {
        let mut decide_rng = Rng::new(11);
        let mut lapse_rng = Rng::new(12);
        let mut decide = || {
            decide_calls.set(decide_calls.get() + 1);
            decide_rng.next_f64()
        };
        let mut lapse = || lapse_rng.next_f64();
        plan_intents(
            state,
            now,
            &params,
            Some(&deal),
            &learned,
            &mut decide,
            &mut lapse,
        )
    };

    // Just before the reading boundary nothing happens and no draw is spent.
    assert_eq!(advance(&mut state, 102_999.999, &decide_calls), None);
    assert_eq!(decide_calls.get(), 0, "no choice is drawn while reading");
    // At the reading boundary the first spawn ask is sent.
    let first = advance(&mut state, 103_000.0, &decide_calls);
    let Some(PlanDirective::Spawn { option, index }) = first else {
        panic!("the reading boundary must ask for a spawn");
    };
    assert_eq!(index.to_bits(), deal.spawns[option].to_bits());
    assert_eq!(
        state.spawn_ask,
        Some(crate::bots::planning::PlanAsk {
            at: 103_000.0,
            n: 1
        })
    );
    // A resend waits `resendMs + reaction.mu`; one tenth of a millisecond early is refused and draws nothing.
    let before_resend = decide_calls.get();
    assert_eq!(advance(&mut state, 103_499.999, &decide_calls), None);
    assert_eq!(
        decide_calls.get(),
        before_resend,
        "no redraw before the resend wait"
    );
    assert!(matches!(
        advance(&mut state, 103_500.0, &decide_calls),
        Some(PlanDirective::Spawn { .. })
    ));
    assert_eq!(
        state.spawn_ask,
        Some(crate::bots::planning::PlanAsk {
            at: 103_500.0,
            n: 2
        })
    );
    // The third and last ask.
    assert!(matches!(
        advance(&mut state, 104_000.0, &decide_calls),
        Some(PlanDirective::Spawn { .. })
    ));
    assert_eq!(
        state.spawn_ask,
        Some(crate::bots::planning::PlanAsk {
            at: 104_000.0,
            n: 3
        })
    );
    // With the three asks spent no fourth ask is sent; the "both choices stood" clock starts when the wait is over.
    assert_eq!(advance(&mut state, 104_499.999, &decide_calls), None);
    assert_eq!(advance(&mut state, 104_500.0, &decide_calls), None);
    assert_eq!(
        state.done_at.map(|at| at.to_bits()),
        Some(104_500.0f64.to_bits())
    );
    assert_eq!(state.spawn_ask.map(|ask| ask.n), Some(3));
    // Ready is pressed at exactly doneAt + settleMs, once (the latch).
    assert_eq!(advance(&mut state, 104_999.999, &decide_calls), None);
    assert_eq!(
        advance(&mut state, 105_000.0, &decide_calls),
        Some(PlanDirective::Ready {
            why: ReadyWhy::Choices
        }),
        "settle boundary"
    );
    assert!(state.ready_sent);
    assert_eq!(
        advance(&mut state, 106_000.0, &decide_calls),
        None,
        "ready is latched"
    );

    // The resend wait really is resendMs + reaction.mu: with mu = 250 the second ask needs 650ms.
    let mut state = PlanState::default();
    let mut decide = || 0.0;
    source_observe(
        &mut state,
        100_000.0,
        true,
        145_000.0,
        TierId::Normal,
        &mut decide,
    );
    let mut params = TIERS[1];
    params.reaction.mu = 250.0;
    let mut ask = |now: f64| {
        let mut decide_rng = Rng::new(11);
        let mut lapse_rng = Rng::new(12);
        let mut decide = || decide_rng.next_f64();
        let mut lapse = || lapse_rng.next_f64();
        plan_intents(
            &mut state,
            now,
            &params,
            Some(&deal),
            &learned,
            &mut decide,
            &mut lapse,
        )
    };
    assert!(matches!(ask(103_000.0), Some(PlanDirective::Spawn { .. })));
    assert_eq!(ask(103_500.0), None, "mu 250 needs 650ms, not 500");
    assert!(matches!(ask(103_650.0), Some(PlanDirective::Spawn { .. })));
}

#[test]
fn planning_forced_lapse_picks_the_lapse_branch_and_ignores_nonfinite_bias() {
    // A learned bias that rewards the fire spawn and punishes the frost one makes the fire option the better utility.
    let learned = LearnedBiasView {
        enabled: true,
        bias: &|key| match key {
            "spawn|fire|fire" => 10.0,
            "spawn|fire|frost" => -10.0,
            _ => 0.0,
        },
    };
    let map = plan_map();
    let deal = source_deal([0.0, 1.0], -1.0, &[], -1.0);
    let utility = |option: usize| {
        plan_spawn_score_raw(
            &map,
            deal.spawns[option],
            FactionId::Fire,
            Some(WeaponId::Sword),
        ) / PLAN_CAMPS as f64
            + learned_bias_of(
                &learned,
                &format!("spawn|fire|{}", map.spawn_pool[option].zone.as_str()),
            )
    };
    let (u0, u1) = (utility(0), utility(1));
    assert!(
        u0 != u1,
        "the fixture must separate the two spawn utilities: {u0} vs {u1}"
    );
    let argmax = if u0 > u1 { 0 } else { 1 };

    // lapseP = 1 forces the lapse lane: the second lapse draw picks among the ordered top utilities.
    let mut params = TIERS[1];
    params.lapse_p = 1.0;
    let decide_calls = Cell::new(0u32);
    let lapse_draws = Cell::new(0u32);
    let mut decide = || {
        decide_calls.set(decide_calls.get() + 1);
        0.0
    };
    let mut lapse = || {
        let draw = lapse_draws.get();
        lapse_draws.set(draw + 1);
        if draw == 0 {
            0.0
        } else {
            // k = floor(0.75 * 2) = 1 -> the second-best utility (the lapse mistake).
            0.75
        }
    };
    let picked = source_choose_spawn(
        &deal,
        &[0, 1],
        &map,
        Some(FactionId::Fire),
        Some(WeaponId::Sword),
        &learned,
        &params,
        &mut decide,
        &mut lapse,
    );
    assert_eq!(lapse_draws.get(), 2, "the lapse lane rolls and indexes");
    assert_eq!(
        decide_calls.get(),
        0,
        "the forced lapse never draws the softmax"
    );
    assert_ne!(picked, argmax, "the forced lapse takes the worse utility");
    assert_eq!(
        picked,
        1 - argmax,
        "the forced lapse takes exactly the second-best"
    );

    // With lapse disabled the tier's temperature picks the better utility (the same fixture, no lapse draw).
    let mut params = TIERS[1];
    params.lapse_p = 0.0;
    params.softmax_t = 0.0;
    let mut decide = || {
        decide_calls.set(decide_calls.get() + 1);
        0.0
    };
    let mut lapse = || 0.75;
    let picked = source_choose_spawn(
        &deal,
        &[0, 1],
        &map,
        Some(FactionId::Fire),
        Some(WeaponId::Sword),
        &learned,
        &params,
        &mut decide,
        &mut lapse,
    );
    assert_eq!(picked, argmax, "without the lapse the better utility wins");

    // A nonfinite learned callback return is source-sanitized to exactly +0, so it cannot move the choice.
    for nonfinite in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let view = LearnedBiasView {
            enabled: true,
            bias: &|_| nonfinite,
        };
        assert_eq!(
            learned_bias_of(&view, "spawn|fire|fire").to_bits(),
            0.0f64.to_bits(),
            "Number.isFinite sanitizes the field to +0 ({nonfinite})"
        );
        for seed in 0..6u32 {
            let mut decide_a = Rng::new(seed);
            let mut lapse_a = Rng::new(seed + 1);
            let mut decide = || decide_a.next_f64();
            let mut lapse = || lapse_a.next_f64();
            let sanitized = source_choose_spawn(
                &deal,
                &[0, 1],
                &map,
                Some(FactionId::Fire),
                Some(WeaponId::Sword),
                &view,
                &params,
                &mut decide,
                &mut lapse,
            );
            let mut decide_b = Rng::new(seed);
            let mut lapse_b = Rng::new(seed + 1);
            let mut decide = || decide_b.next_f64();
            let mut lapse = || lapse_b.next_f64();
            let disabled = disabled_learned();
            let without = source_choose_spawn(
                &deal,
                &[0, 1],
                &map,
                Some(FactionId::Fire),
                Some(WeaponId::Sword),
                &disabled,
                &params,
                &mut decide,
                &mut lapse,
            );
            assert_eq!(
                sanitized, without,
                "seed {seed}: a nonfinite bias must not influence the spawn pick"
            );
        }
    }
}

#[test]
fn planning_finite_learned_bias_changes_the_boon_pick_both_directions() {
    // softmaxT 0 makes the choice the utility argmax: a finite learned bias is then the only thing that moves it.
    let mut params = TIERS[1];
    params.softmax_t = 0.0;
    params.lapse_p = 0.0;
    let deal = source_deal([0.0, 1.0], -1.0, &["vigor", "haste"], -1.0);
    let vigour_bias = |key: &str| {
        if key == "boon|fire|vigor" {
            4.0
        } else {
            0.0
        }
    };
    let haste_bias = |key: &str| {
        if key == "boon|fire|haste" {
            4.0
        } else {
            0.0
        }
    };
    let pick = |learned: &LearnedBiasView<'_>| {
        let mut decide_rng = Rng::new(5);
        let mut lapse_rng = Rng::new(6);
        let mut decide = || decide_rng.next_f64();
        let mut lapse = || lapse_rng.next_f64();
        source_choose_boon(
            &deal,
            Some(FactionId::Fire),
            learned,
            &params,
            &mut decide,
            &mut lapse,
        )
    };
    let vigor = LearnedBiasView {
        enabled: true,
        bias: &vigour_bias,
    };
    let haste = LearnedBiasView {
        enabled: true,
        bias: &haste_bias,
    };
    // LEARN.weight * capped 0.25 = 0.075 exactly for both directions.
    assert_eq!(
        learned_bias_of(&vigor, "boon|fire|vigor").to_bits(),
        (0.3f64 * 0.25).to_bits()
    );
    assert_eq!(pick(&vigor), 0, "a bias for the first boon takes it");
    assert_eq!(pick(&haste), 1, "a bias for the second boon takes it");
    // A nonfinite bias sanitizes to 0 for both, so the first boon keeps its source default.
    let nonfinite = LearnedBiasView {
        enabled: true,
        bias: &|_| f64::NAN,
    };
    assert_eq!(pick(&nonfinite), 0, "a nonfinite bias cannot favour a boon");
}

#[test]
fn planning_fractional_spawn_index_never_selects_a_camp_score() {
    let map = plan_map();
    // Only a nonnegative integral in-range JS array index resolves a spawn: everything else reads no entry (-Infinity).
    for invalid in [-1.0, 0.5, 1e10] {
        assert_eq!(
            plan_spawn_score_raw(&map, invalid, FactionId::Fire, Some(WeaponId::Sword)).to_bits(),
            f64::NEG_INFINITY.to_bits(),
            "spawnPool[{invalid}] has no entry"
        );
    }
    // A fractional spawn index can never win the choice: the finite option is selected instead.
    let deal = source_deal([0.5, 1.0], -1.0, &[], -1.0);
    let mut params = TIERS[1];
    params.softmax_t = 0.0;
    params.lapse_p = 0.0;
    let learned = disabled_learned();
    let mut decide_rng = Rng::new(21);
    let mut lapse_rng = Rng::new(22);
    let mut decide = || decide_rng.next_f64();
    let mut lapse = || lapse_rng.next_f64();
    let picked = source_choose_spawn(
        &deal,
        &[0, 1],
        &map,
        Some(FactionId::Fire),
        Some(WeaponId::Sword),
        &learned,
        &params,
        &mut decide,
        &mut lapse,
    );
    assert_eq!(picked, 1, "only the integral spawn index can be selected");
}

// ============================================================================================================== registry

fn all_features() -> Features {
    Features {
        message_types: Vec::new(),
        wishes: true,
        status_effects: false,
        fields: false,
        planning: true,
        chests: true,
        skills: false,
        relics: false,
        camps: false,
        hazards: true,
    }
}

#[test]
fn registry_default_order_replacement_and_enabled_filtering() {
    let mut registry = Registry::with_defaults();
    let default_order = vec![
        "wishes".to_string(),
        "planning".to_string(),
        "chests".to_string(),
        "hazards".to_string(),
    ];
    assert_eq!(
        registry.ids(),
        default_order,
        "source default registration order"
    );
    assert!(
        registry.enabled(&Features::default()).is_empty(),
        "every builtin is gated by its feature flag"
    );

    let features = all_features();
    let rows = registry.enabled(&features);
    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["wishes", "planning", "chests", "hazards"],
        "enabled filtering preserves registration order"
    );
    assert_eq!(
        rows[0].hooks,
        ["enabled", "observe", "goals", "intents", "act"],
        "the Wishes module's own hook inventory"
    );
    assert_eq!(rows[0].builtin, Some(ModuleId::Wishes));
    assert_eq!(rows[0].token, None);
    assert_eq!(
        rows[1].hooks,
        ["enabled", "observe", "intents"],
        "the planning module's own hook inventory"
    );
    assert_eq!(
        rows[2].hooks,
        ["enabled", "observe", "goals", "intents", "act"]
    );
    assert_eq!(rows[3].hooks, ["enabled", "intents", "adjust"]);

    // Registering a module with an existing id replaces it in place (source Map.set semantics).
    registry.register_custom(CustomModule {
        id: "planning".into(),
        token: "custom-planning".into(),
        enabled: std::sync::Arc::new(|_| true),
    });
    assert_eq!(
        registry.ids(),
        default_order,
        "replacement keeps the position"
    );
    let rows = registry.enabled(&features);
    assert_eq!(rows[1].id, "planning");
    assert_eq!(
        rows[1].builtin, None,
        "the custom descriptor replaced the builtin"
    );
    assert_eq!(rows[1].token.as_deref(), Some("custom-planning"));
    assert_eq!(
        rows[1].hooks,
        ["enabled"],
        "a custom object's only function key"
    );

    // A new id appends, and the custom enabled closure is filtered like a builtin's.
    registry.register_custom(CustomModule {
        id: "future".into(),
        token: "future-token".into(),
        enabled: std::sync::Arc::new(|features| features.planning),
    });
    let rows = registry.enabled(&features);
    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["wishes", "planning", "chests", "hazards", "future"]
    );
    let mut no_planning = all_features();
    no_planning.planning = false;
    no_planning.chests = false;
    no_planning.hazards = false;
    let rows = registry.enabled(&no_planning);
    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["wishes", "planning"],
        "disabled builtin flags and disabled custom closures are filtered (the custom planning descriptor is always on)"
    );
}

#[test]
fn registry_reset_policy_identity_and_wishes_never_reads_the_policy() {
    let mut registry = Registry::with_defaults();
    let features = all_features();
    let before_ids = registry.ids();
    let before_rows = registry.enabled(&features);

    // The opaque cast-policy slot: stored by identity, never consulted by the registry or the Wishes module path.
    let reads = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let policy: std::sync::Arc<dyn Fn() + Send + Sync> = {
        let reads = reads.clone();
        std::sync::Arc::new(move || {
            reads.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
    };
    registry.register_cast_policy(policy.clone());
    assert!(
        std::sync::Arc::ptr_eq(registry.cast_policy().expect("a policy is stored"), &policy),
        "getCastPolicy returns the exact registered definition (Rc identity)"
    );
    assert_eq!(
        registry.ids(),
        before_ids,
        "the registry order is unchanged by a policy"
    );
    assert_eq!(
        registry.enabled(&features),
        before_rows,
        "enabling/enumerating modules never reads the cast policy"
    );
    assert_eq!(
        reads.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "the Wishes module path calls the real decideCast, never the registered opaque policy"
    );

    // Re-registering replaces the definition (same slot, new identity).
    let replacement: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(|| {});
    registry.register_cast_policy(replacement.clone());
    assert!(std::sync::Arc::ptr_eq(
        registry.cast_policy().expect("the replacement is stored"),
        &replacement
    ));

    // resetModules forgets every module and the cast policy.
    registry.reset();
    assert!(registry.ids().is_empty(), "reset clears the registry");
    assert!(registry.enabled(&features).is_empty());
    assert!(
        registry.cast_policy().is_none(),
        "reset clears the policy slot"
    );
    // The source bottom-of-file default registration restores the four builtins without a policy.
    registry.reset_defaults();
    assert_eq!(registry.ids(), before_ids);
    assert!(registry.cast_policy().is_none());
}
