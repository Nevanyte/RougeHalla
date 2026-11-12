//! Complete checked intake for the frozen private Brain source witness (P-BOT-BRAIN-NATIVE-1).
//!
//! `parity/policy/bot-private-brain/source.json` (`rh-bot-private-brain-source/1`, `rh-method-value/1`, 31 cases /
//! 855 declared operations / 6 direct Hand profiles / 32 Knowledge constructor dependencies / 8 maps) is a released
//! **declared method witness** produced by the unchanged legacy `createBrain`. It is not a public intake path and never
//! an oracle for native state: [verify.mjs] is the executable grammar, this file converts every fact the native replay
//! consumes into the private Brain/component types *before* any native component, RNG, Memory, path or module state
//! exists, and keeps every frozen expectation only as a lossless tagged comparison value (never as an input or as
//! installed Brain state).
//!
//! Strictness: the raw envelope is duplicate-decoded-key strict (reusing the admitted Modules `parse_raw`); every
//! consumed leaf is checked with the exact frozen grammar (closed declared records, finite declared numbers, the four
//! status domain alive/dead/mia/lobby for Brain Percepts, caller module rules, per-operation caller env overrides,
//! expected trace rows, complete resolved tier/persona profiles). Validation is side effect free and atomic: any
//! failure returns `Err` and no partially converted case escapes; `load` only hands the caller a fully converted
//! [Source].
//!
//! The complete declared Brain `Percept` is kept losslessly as a [`BVal`] (own-key order preserved) alongside the small
//! typed header [`super::percept::Percept`]; component projections are built by the composition, never by re-reading or
//! narrowing this record. `CallerIntent` keeps the declared caller-rule intent source shape (including non-u8 source
//! priorities such as -1/-2 and `timing.kind:"current"`, which the frozen runner rewrites per hook call) because typed
//! [`crate::bots::types::Intent`] cannot represent those exact source values.
//!
//! Test-only: the enclosing `brain` module declares this file under `#[cfg(test)]`.

use std::sync::Arc;

use serde_json::Value;

use super::super::data::MethodValue;
use super::super::memory::{CampGeom, MemoryMap};
pub(crate) use super::super::modules::source_reader::R;
use super::super::modules::source_reader::{self, SVal};
use super::super::modules::types::ModuleOutput;
use super::super::strategy::types::{
    CampDef, ColiseumDef, Goal, GoalDecision, GoalStatus, HoldWhy, RoamWhy, StrategyMap,
};
use super::super::tactics::types::TacticsMap;
use super::config::RunResult;
use super::percept::Percept;
pub(crate) use super::trace::BVal;
use crate::bots::planning::{PlanCamp, PlanMap, PlanSpawn};
use crate::bots::types::{
    Appraisal, Attention, Cadence, Caution, ChooseMsg, ExGaussian, Hesitation, Intent, IntentBody,
    IntentTiming, MoveScatter, Orbwalk, PersonaParams, PlanMsg, Route, Stimulus, StimulusKind,
    TargetScatter, TierParams, PERSONAS, TIERS,
};
use crate::bots::view::Features;
use rh_sim::mapdata::{GameMapData, MapExport, MapLayers};
use rh_sim::mapgen::map_hash::map_hash;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

pub(crate) const SOURCE_FORMAT: &str = "rh-bot-private-brain-source/1";
pub(crate) const METHOD_VALUE_FORMAT: &str = "rh-method-value/1";
pub(crate) const SOURCE_RELATIVE_PATH: &str = "../../parity/policy/bot-private-brain/source.json";
pub(crate) const MAP_EXPORT_FORMAT: &str = "rh-map/2";

const FEATURES_MESSAGES: [&str; 11] = [
    "move",
    "stop",
    "target",
    "attack",
    "release",
    "swap",
    "pickup",
    "cast",
    "plan",
    "choose",
    "useConsumable",
];
const HOOK_NAMES: [&str; 6] = ["enabled", "observe", "goals", "intents", "act", "adjust"];
const GOAL_KINDS: [&str; 9] = [
    "idle", "farm", "hunt", "fight", "loot", "flee", "roam", "hold", "module",
];
const INTENT_KINDS: [&str; 8] = [
    "lock", "move", "stop", "swap", "pickup", "cast", "plan", "choose",
];
const INTENT_TIMING: [&str; 4] = ["step", "timed", "react", "current"];
const STATUS_NAMES: [&str; 4] = ["alive", "dead", "mia", "lobby"];
const FACTION_NAMES: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
const WEAPON_NAMES: [&str; 6] = ["sword", "axe", "shield", "bow", "wand", "fists"];
const MOB_KINDS: [&str; 4] = ["mob", "elite", "dummy", "npc"];
const PROJECTILE_KINDS: [&str; 2] = ["ball", "arrow"];
const EVENT_KINDS: [&str; 16] = [
    "windup", "swing", "hit", "block", "stagger", "cancel", "projEnd", "death", "heal", "teleport",
    "bounty", "victory", "toast", "result", "private", "ext",
];
const TRACE_KINDS: [&str; 7] = [
    "callback",
    "caller",
    "module",
    "builtin",
    "observe",
    "rng",
    "retainedMemoryBeforeFrame",
];
const EXTRA_KEYS: [&str; 10] = [
    "wish",
    "skills",
    "chests",
    "camps",
    "effects",
    "fields",
    "plan",
    "building",
    "relics",
    "effectsNext",
];
pub(super) const PERCEPT_KEYS: [&str; 12] = [
    "now",
    "viewT",
    "self",
    "hud",
    "fighters",
    "mobs",
    "containers",
    "projectiles",
    "minimap",
    "events",
    "extras",
    "features",
];
const BUILTIN_MODULE_HANDLES: [&str; 4] = ["wishes", "planning", "chests", "hazards"];
const BUILD_ACTIONS: [&str; 7] = ["move", "stop", "swap", "pickup", "cast", "plan", "choose"];

fn err(path: &str, message: impl Into<String>) -> String {
    format!("{path}: {}", message.into())
}

fn kind_of(value: &SVal) -> &'static str {
    match value {
        SVal::Undefined => "undefined",
        SVal::Null => "null",
        SVal::Bool(_) => "bool",
        SVal::Num(_) => "number",
        SVal::Str(_) => "string",
        SVal::Arr(_) => "array",
        SVal::Map(_) => "map",
        SVal::Set(_) => "set",
        SVal::Obj(_) => "object",
        SVal::U8(_) => "u8",
        SVal::Instance { .. } => "instance",
        SVal::Callable => "callable",
    }
}

fn object<'a>(value: &'a SVal, path: &str) -> R<&'a [(String, SVal)]> {
    match value {
        SVal::Obj(entries) => Ok(entries),
        other => Err(err(
            path,
            format!("expected an object, got {}", kind_of(other)),
        )),
    }
}

fn field<'a>(value: &'a SVal, name: &str, path: &str) -> R<&'a SVal> {
    match value {
        SVal::Obj(entries) => entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
            .ok_or_else(|| err(path, format!("missing consumed fact {name}"))),
        other => Err(err(
            path,
            format!("expected an object, got {}", kind_of(other)),
        )),
    }
}

fn optional<'a>(value: &'a SVal, name: &str) -> Option<&'a SVal> {
    match value {
        SVal::Obj(entries) => entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value),
        _ => None,
    }
}

fn string_field(value: &SVal, name: &str, path: &str) -> R<String> {
    match field(value, name, path)? {
        SVal::Str(text) => Ok(text.clone()),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a string, got {}", kind_of(other)),
        )),
    }
}

fn string_value(value: &SVal, path: &str) -> R<String> {
    match value {
        SVal::Str(text) => Ok(text.clone()),
        other => Err(err(
            path,
            format!("expected a string, got {}", kind_of(other)),
        )),
    }
}

fn finite_number(value: &SVal, name: &str, path: &str) -> R<f64> {
    match field(value, name, path)? {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a finite declared number, got {}", kind_of(other)),
        )),
    }
}

fn finite_number_value(value: &SVal, path: &str) -> R<f64> {
    match value {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(err(
            path,
            format!("expected a finite declared number, got {}", kind_of(other)),
        )),
    }
}

fn bool_field(value: &SVal, name: &str, path: &str) -> R<bool> {
    match field(value, name, path)? {
        SVal::Bool(flag) => Ok(*flag),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a bool, got {}", kind_of(other)),
        )),
    }
}

fn bool_value(value: &SVal, path: &str) -> R<bool> {
    match value {
        SVal::Bool(flag) => Ok(*flag),
        other => Err(err(
            path,
            format!("expected a bool, got {}", kind_of(other)),
        )),
    }
}

fn array_field<'a>(value: &'a SVal, name: &str, path: &str) -> R<&'a [SVal]> {
    match field(value, name, path)? {
        SVal::Arr(rows) => Ok(rows),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected an array, got {}", kind_of(other)),
        )),
    }
}

fn array_value<'a>(value: &'a SVal, path: &str) -> R<&'a [SVal]> {
    match value {
        SVal::Arr(rows) => Ok(rows),
        other => Err(err(
            path,
            format!("expected an array, got {}", kind_of(other)),
        )),
    }
}

fn closed(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, _) in entries {
        if !keys.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported field {key}")));
        }
    }
    for key in keys {
        if !entries.iter().any(|(name, _)| name == key) {
            return Err(err(path, format!("missing consumed fact {key}")));
        }
    }
    Ok(())
}

/// Reject only unknown fields (the declared schema's optional set stays optional).
fn allowed_keys(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, _) in entries {
        if !keys.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported field {key}")));
        }
    }
    Ok(())
}

fn require_fields(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    object(value, path)?;
    for key in keys {
        if optional(value, key).is_none() {
            return Err(err(path, format!("missing consumed fact {key}")));
        }
    }
    Ok(())
}

fn one_of(text: &str, values: &[&str], path: &str) -> R<String> {
    if values.contains(&text) {
        Ok(text.to_string())
    } else {
        Err(err(path, format!("unsupported enum value {text}")))
    }
}

fn enum_field(value: &SVal, name: &str, values: &[&str], path: &str) -> R<String> {
    one_of(
        &string_field(value, name, path)?,
        values,
        &format!("{path}.{name}"),
    )
}

fn enum_value(value: &SVal, values: &[&str], path: &str) -> R<String> {
    one_of(&string_value(value, path)?, values, path)
}

/// Non-negative integer, no fractional part, at most `max`, never a silent `f64 as u64` truncation.
fn uint_field(value: &SVal, name: &str, max: u64, path: &str) -> R<u64> {
    let number = finite_number(value, name, path)?;
    if number >= 0. && number.fract() == 0. && number <= max as f64 {
        Ok(number as u64)
    } else {
        Err(err(
            &format!("{path}.{name}"),
            format!("expected an integer in 0..={max}, got {number}"),
        ))
    }
}

fn uint_value(value: &SVal, max: u64, path: &str) -> R<u64> {
    let number = finite_number_value(value, path)?;
    if number >= 0. && number.fract() == 0. && number <= max as f64 {
        Ok(number as u64)
    } else {
        Err(err(
            path,
            format!("expected an integer in 0..={max}, got {number}"),
        ))
    }
}

fn string_array(value: &SVal, name: &str, path: &str) -> R<Vec<String>> {
    array_field(value, name, path)?
        .iter()
        .enumerate()
        .map(|(index, row)| match row {
            SVal::Str(text) => Ok(text.clone()),
            other => Err(err(
                &format!("{path}.{name}[{index}]"),
                format!("expected a string, got {}", kind_of(other)),
            )),
        })
        .collect()
}

fn string_array_value(value: &SVal, path: &str) -> R<Vec<String>> {
    array_value(value, path)?
        .iter()
        .enumerate()
        .map(|(index, row)| match row {
            SVal::Str(text) => Ok(text.clone()),
            other => Err(err(
                &format!("{path}[{index}]"),
                format!("expected a string, got {}", kind_of(other)),
            )),
        })
        .collect()
}

fn point_field(value: &SVal, name: &str, path: &str) -> R<Vec2> {
    let at = field(value, name, path)?;
    let path = format!("{path}.{name}");
    closed(at, &["x", "y"], &path)?;
    Ok(Vec2::new(
        finite_number(at, "x", &path)?,
        finite_number(at, "y", &path)?,
    ))
}

fn point_value(value: &SVal, path: &str) -> R<Vec2> {
    closed(value, &["x", "y"], path)?;
    Ok(Vec2::new(
        finite_number(value, "x", path)?,
        finite_number(value, "y", path)?,
    ))
}

fn opt_weapon_value(value: &SVal, path: &str) -> R<Option<WeaponId>> {
    match value {
        SVal::Null => Ok(None),
        SVal::Undefined => Ok(None),
        SVal::Str(text) => WeaponId::parse(text)
            .map(Some)
            .ok_or_else(|| err(path, format!("unknown weapon {text}"))),
        other => Err(err(
            path,
            format!("expected a weapon string|null, got {}", kind_of(other)),
        )),
    }
}

fn weapon_value(value: &SVal, path: &str) -> R<WeaponId> {
    match value {
        SVal::Str(text) => {
            WeaponId::parse(text).ok_or_else(|| err(path, format!("unknown weapon {text}")))
        }
        other => Err(err(
            path,
            format!("expected a weapon string, got {}", kind_of(other)),
        )),
    }
}

fn opt_faction_value(value: &SVal, path: &str) -> R<Option<FactionId>> {
    match value {
        SVal::Null | SVal::Undefined => Ok(None),
        SVal::Str(text) => FactionId::parse(text)
            .map(Some)
            .ok_or_else(|| err(path, format!("unknown declared faction {text}"))),
        other => Err(err(
            path,
            format!("expected a faction string|null, got {}", kind_of(other)),
        )),
    }
}

fn weapon_pair(value: &SVal, name: &str, path: &str) -> R<[Option<WeaponId>; 2]> {
    let rows = array_field(value, name, path)?;
    let path = format!("{path}.{name}");
    if rows.len() != 2 {
        return Err(err(
            &path,
            format!(
                "the source weapon tuple has exactly two slots, got {}",
                rows.len()
            ),
        ));
    }
    Ok([
        opt_weapon_value(&rows[0], &format!("{path}[0]"))?,
        opt_weapon_value(&rows[1], &format!("{path}[1]"))?,
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Raw JSON: reuse the admitted Modules strict parser (duplicate *decoded* keys, depth bound, no trailing bytes).

/// Strict raw object parse with duplicate decoded-key rejection, depth bounded and no trailing bytes.
pub(crate) fn raw_value(text: &str) -> R<Value> {
    super::super::modules::parse_raw(text)
}

/// Load the frozen Brain source corpus from the repository parity directory.
pub(crate) fn load() -> R<Source> {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), SOURCE_RELATIVE_PATH);
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("frozen Brain source corpus {path}: {error}"))?;
    body_from_str(&text)
}

/// `build_body` from text: strict raw parse first, then the complete typed/atomic build.
pub(crate) fn body_from_str(text: &str) -> R<Source> {
    let raw = raw_value(text)?;
    body_from_value(&raw)
}

// ---------------------------------------------------------------------------------------------------------------------
// Tagged `rh-method-value/1` decode. Input mode is declared caller data; diagnostic mode is expected/observed output.

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Input,
    Diagnostic,
}

fn tag_parts<'a>(value: &'a Value, path: &str) -> R<(&'a str, &'a serde_json::Map<String, Value>)> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "expected a tagged method-value object"))?;
    let tag = object
        .get("$")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "missing $ method-value tag"))?;
    Ok((tag, object))
}

fn exact_tag_keys(object: &serde_json::Map<String, Value>, allowed: &[&str], path: &str) -> R<()> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(
                path,
                format!("unexpected method-value tag field {key}"),
            ));
        }
    }
    for key in allowed {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing method-value tag field {key}")));
        }
    }
    Ok(())
}

/// SameValueZero: the source Map/Set key equality (signed zero and NaN collide).
fn same_value_zero(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Num(x), SVal::Num(y)) => {
            x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()) || x == y
        }
        _ => source_reader::same(a, b),
    }
}

fn raw_json_number(value: &Value, path: &str) -> R<f64> {
    let number = value
        .as_f64()
        .ok_or_else(|| err(path, "expected a JSON number"))?;
    if !number.is_finite() {
        return Err(err(path, "JSON number outside the finite double range"));
    }
    if number == 0. && number.is_sign_negative() {
        return Err(err(
            path,
            "raw -0 is not a declared method value (use the {$:'number',value:'-0'} tag)",
        ));
    }
    Ok(number)
}

fn decode(value: &Value, path: &str, mode: Mode) -> R<SVal> {
    match value {
        Value::Null => Ok(SVal::Null),
        Value::Bool(flag) => Ok(SVal::Bool(*flag)),
        Value::Number(_) => Ok(SVal::Num(raw_json_number(value, path)?)),
        Value::String(text) => Ok(SVal::Str(text.clone())),
        Value::Array(_) => Err(err(
            path,
            "untagged JSON array is not a method value (wrap it in {$:'array',values:[...]})",
        )),
        Value::Object(_) => {
            let (tag, object) = tag_parts(value, path)?;
            match tag {
                "undefined" => {
                    exact_tag_keys(object, &["$"], path)?;
                    Ok(SVal::Undefined)
                }
                "number" => {
                    exact_tag_keys(object, &["$", "value"], path)?;
                    let raw = object
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "number tag value must be a string"))?;
                    match raw {
                        "-0" => Ok(SVal::Num(-0.0)),
                        "NaN" => Ok(SVal::Num(f64::NAN)),
                        "+Infinity" => Ok(SVal::Num(f64::INFINITY)),
                        "-Infinity" => Ok(SVal::Num(f64::NEG_INFINITY)),
                        other => Err(err(path, format!("unsupported number tag value {other}"))),
                    }
                }
                "callable" => {
                    exact_tag_keys(object, &["$"], path)?;
                    if mode != Mode::Diagnostic {
                        return Err(err(
                            path,
                            "callable diagnostics are not declared input values",
                        ));
                    }
                    Ok(SVal::Callable)
                }
                "hole" => Err(err(
                    path,
                    "array-hole diagnostics are outside the finite fixture representation",
                )),
                "array" | "set" | "u8" => {
                    exact_tag_keys(object, &["$", "values"], path)?;
                    let values = object
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "tag values must be an array"))?;
                    let mut out: Vec<SVal> = Vec::with_capacity(values.len());
                    for (index, entry) in values.iter().enumerate() {
                        let entry_path = format!("{path}.values[{index}]");
                        let member = decode(entry, &entry_path, mode)?;
                        if tag == "set" && out.iter().any(|seen| same_value_zero(seen, &member)) {
                            return Err(err(&entry_path, "duplicate Set member"));
                        }
                        out.push(member);
                    }
                    match tag {
                        "u8" => {
                            let mut bytes = Vec::with_capacity(out.len());
                            for (index, member) in out.iter().enumerate() {
                                match member {
                                    SVal::Num(number)
                                        if number.is_finite()
                                            && *number >= 0.
                                            && *number <= 255.
                                            && number.fract() == 0. =>
                                    {
                                        bytes.push(*number as u8)
                                    }
                                    other => {
                                        return Err(err(
                                            &format!("{path}.values[{index}]"),
                                            format!(
                                                "u8 value must be an integer 0..=255, got {}",
                                                kind_of(other)
                                            ),
                                        ))
                                    }
                                }
                            }
                            Ok(SVal::U8(bytes))
                        }
                        "set" => Ok(SVal::Set(out)),
                        _ => Ok(SVal::Arr(out)),
                    }
                }
                "map" => {
                    exact_tag_keys(object, &["$", "entries"], path)?;
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "map tag entries must be an array"))?;
                    let mut out: Vec<(SVal, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair = entry
                            .as_array()
                            .filter(|pair| pair.len() == 2)
                            .ok_or_else(|| err(&entry_path, "map entry must be [key,value]"))?;
                        let key = decode(&pair[0], &format!("{entry_path}.key"), mode)?;
                        if !matches!(
                            key,
                            SVal::Undefined
                                | SVal::Null
                                | SVal::Bool(_)
                                | SVal::Num(_)
                                | SVal::Str(_)
                        ) {
                            return Err(err(
                                &format!("{entry_path}.key"),
                                "fixture Map key must be primitive",
                            ));
                        }
                        if out.iter().any(|(seen, _)| same_value_zero(seen, &key)) {
                            return Err(err(&entry_path, "duplicate Map key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Map(out))
                }
                "object" => {
                    exact_tag_keys(object, &["$", "entries"], path)?;
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "object tag entries must be an array"))?;
                    let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair = entry
                            .as_array()
                            .filter(|pair| pair.len() == 2)
                            .ok_or_else(|| err(&entry_path, "object entry must be [key,value]"))?;
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(&format!("{entry_path}.key"), "object key must be a string")
                            })?
                            .to_string();
                        if out.iter().any(|(seen, _)| seen == &key) {
                            return Err(err(&entry_path, "duplicate object key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Obj(out))
                }
                "instance" => {
                    if mode != Mode::Diagnostic {
                        return Err(err(
                            path,
                            "instance diagnostics are not declared input values",
                        ));
                    }
                    exact_tag_keys(object, &["$", "name", "entries"], path)?;
                    let name = object
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .ok_or_else(|| err(path, "instance name must be a non-empty string"))?
                        .to_string();
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "instance tag entries must be an array"))?;
                    let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair =
                            entry
                                .as_array()
                                .filter(|pair| pair.len() == 2)
                                .ok_or_else(|| {
                                    err(&entry_path, "instance entry must be [key,value]")
                                })?;
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(
                                    &format!("{entry_path}.key"),
                                    "instance key must be a string",
                                )
                            })?
                            .to_string();
                        if out.iter().any(|(seen, _)| seen == &key) {
                            return Err(err(&entry_path, "duplicate instance key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Instance { name, entries: out })
                }
                other => Err(err(path, format!("unsupported method-value tag {other}"))),
            }
        }
    }
}

fn decode_input(value: &Value, path: &str) -> R<SVal> {
    decode(value, path, Mode::Input)
}

fn decode_diagnostic(value: &Value, path: &str) -> R<SVal> {
    decode(value, path, Mode::Diagnostic)
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared -> owned conversions.

/// Lossless tagged SVal -> [`BVal`] (the frozen comparison model). Every tag/order/value identity is preserved.
pub(crate) fn sval_to_bval(value: &SVal) -> BVal {
    match value {
        SVal::Undefined => BVal::Undefined,
        SVal::Null => BVal::Null,
        SVal::Bool(flag) => BVal::Bool(*flag),
        SVal::Num(number) => BVal::Num(*number),
        SVal::Str(text) => BVal::Str(text.clone()),
        SVal::Arr(rows) => BVal::Arr(rows.iter().map(sval_to_bval).collect()),
        SVal::Map(entries) => BVal::Map(
            entries
                .iter()
                .map(|(key, member)| (sval_to_bval(key), sval_to_bval(member)))
                .collect(),
        ),
        SVal::Set(rows) => BVal::Set(rows.iter().map(sval_to_bval).collect()),
        SVal::U8(bytes) => BVal::U8(bytes.clone()),
        SVal::Obj(entries) => BVal::Obj(
            entries
                .iter()
                .map(|(key, member)| (key.clone(), sval_to_bval(member)))
                .collect(),
        ),
        SVal::Instance { name, entries } => BVal::Instance {
            name: name.clone(),
            entries: entries
                .iter()
                .map(|(key, member)| (key.clone(), sval_to_bval(member)))
                .collect(),
        },
        SVal::Callable => BVal::Callable,
    }
}

/// Lossless tagged SVal -> the declared record [`MethodValue`] model where a component type needs it (e.g. the
/// ordered opaque `Goal::Module` data). Tagged Map/Set/u8/instance/callable have no declared-record spelling and are
/// refused (`None`), never coerced.
pub(crate) fn sval_to_method_value(value: &SVal) -> Option<MethodValue> {
    Some(match value {
        SVal::Undefined => MethodValue::Undefined,
        SVal::Null => MethodValue::Null,
        SVal::Bool(flag) => MethodValue::Bool(*flag),
        SVal::Num(number) => MethodValue::Num(*number),
        SVal::Str(text) => MethodValue::Str(text.clone()),
        SVal::Arr(rows) => MethodValue::Arr(
            rows.iter()
                .map(sval_to_method_value)
                .collect::<Option<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => MethodValue::Obj(
            entries
                .iter()
                .map(|(key, member)| Some((key.clone(), sval_to_method_value(member)?)))
                .collect::<Option<Vec<_>>>()?,
        ),
        SVal::Map(_) | SVal::Set(_) | SVal::U8(_) | SVal::Instance { .. } | SVal::Callable => {
            return None
        }
    })
}

/// Tagged SVal -> plain JSON the admitted map DTO consumes (`undefined` keeps its explicit `{"$rh":"undefined"}`
/// spelling; nonfinite values have no plain spelling and are refused).
fn sval_to_json(value: &SVal, path: &str) -> R<Value> {
    Ok(match value {
        SVal::Undefined => {
            let mut object = serde_json::Map::new();
            object.insert("$rh".into(), Value::String("undefined".into()));
            Value::Object(object)
        }
        SVal::Null => Value::Null,
        SVal::Bool(flag) => Value::Bool(*flag),
        SVal::Num(number) => {
            if !number.is_finite() {
                return Err(err(
                    path,
                    "nonfinite value has no plain-JSON spelling for the map reader",
                ));
            }
            if number.fract() == 0.
                && !(*number == 0. && number.is_sign_negative())
                && number.abs() <= 9_007_199_254_740_992.
            {
                if *number >= 0. {
                    Value::from(*number as u64)
                } else {
                    Value::from(*number as i64)
                }
            } else {
                Value::Number(
                    serde_json::Number::from_f64(*number)
                        .ok_or_else(|| err(path, "number out of JSON range"))?,
                )
            }
        }
        SVal::Str(text) => Value::String(text.clone()),
        SVal::Arr(rows) => Value::Array(
            rows.iter()
                .enumerate()
                .map(|(index, row)| sval_to_json(row, &format!("{path}[{index}]")))
                .collect::<R<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => {
            let mut object = serde_json::Map::new();
            for (key, member) in entries {
                object.insert(key.clone(), sval_to_json(member, &format!("{path}.{key}"))?);
            }
            Value::Object(object)
        }
        SVal::U8(bytes) => Value::Array(bytes.iter().map(|byte| Value::from(*byte)).collect()),
        other => {
            return Err(err(
                path,
                format!("{} cannot be read as plain declared JSON", kind_of(other)),
            ))
        }
    })
}

/// A `$`-tagged object of the given fields in the frozen own-key order.
pub(crate) fn tagged_object(fields: Vec<(&str, SVal)>) -> SVal {
    SVal::Obj(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}

// ---------------------------------------------------------------------------------------------------------------------
// Finite declared values.

fn check_finite(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Num(number) if !number.is_finite() => Err(err(
            path,
            "nonfinite declared number is outside the finite source profile",
        )),
        SVal::Arr(rows) => rows
            .iter()
            .enumerate()
            .try_for_each(|(index, row)| check_finite(row, &format!("{path}[{index}]"))),
        SVal::Obj(entries) => entries
            .iter()
            .try_for_each(|(key, member)| check_finite(member, &format!("{path}.{key}"))),
        SVal::Map(entries) => entries
            .iter()
            .enumerate()
            .try_for_each(|(index, (key, member))| {
                let path = format!("{path}.entries[{index}]");
                check_finite(key, &format!("{path}.key"))?;
                check_finite(member, &format!("{path}.value"))
            }),
        SVal::Set(rows) => rows
            .iter()
            .enumerate()
            .try_for_each(|(index, row)| check_finite(row, &format!("{path}[{index}]"))),
        SVal::U8(_) | SVal::Instance { .. } | SVal::Callable => Ok(()),
        SVal::Num(_) | SVal::Undefined | SVal::Null | SVal::Bool(_) | SVal::Str(_) => Ok(()),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tier, persona and feature profiles. Every resolved profile is COMPLETE (closed) and every declared leaf is finite;
// arbitrary custom full profiles resolve exactly from their supplied values (never a `TierParams::by_id` replacement).

fn parse_ex_gaussian(value: &SVal, path: &str) -> R<ExGaussian> {
    closed(value, &["mu", "sigma", "tau", "floor", "cap"], path)?;
    Ok(ExGaussian {
        mu: finite_number(value, "mu", path)?,
        sigma: finite_number(value, "sigma", path)?,
        tau: finite_number(value, "tau", path)?,
        floor: finite_number(value, "floor", path)?,
        cap: finite_number(value, "cap", path)?,
    })
}

fn parse_tier(values: &SVal, path: &str) -> R<TierParams> {
    closed(
        values,
        &[
            "id",
            "reaction",
            "step",
            "daze",
            "refractoryMs",
            "thinkMs",
            "strategyMs",
            "apm",
            "burst",
            "minGapMs",
            "moveScatter",
            "targetScatter",
            "minimapSigma",
            "edgeClickP",
            "timingSigmaMs",
            "hesitation",
            "softmaxT",
            "lapseP",
            "dodgeP",
            "jukeP",
            "orbwalk",
            "knowledge",
            "mobShareNoise",
            "route",
            "attention",
            "memorySpanMs",
            "feintRead",
            "appraisal",
            "wary",
            "caution",
        ],
        path,
    )?;
    let id = enum_field(values, "id", &["easy", "normal", "hard"], path)?;
    let mut tier = match id.as_str() {
        "easy" => TIERS[0],
        "normal" => TIERS[1],
        _ => TIERS[2],
    };
    tier.reaction = parse_ex_gaussian(
        field(values, "reaction", path)?,
        &format!("{path}.reaction"),
    )?;
    tier.step = parse_ex_gaussian(field(values, "step", path)?, &format!("{path}.step"))?;
    tier.daze = parse_ex_gaussian(field(values, "daze", path)?, &format!("{path}.daze"))?;
    tier.refractory_ms = finite_number(values, "refractoryMs", path)?;
    let think = field(values, "thinkMs", path)?;
    closed(think, &["mean", "jitter"], &format!("{path}.thinkMs"))?;
    tier.think_ms = Cadence {
        mean: finite_number(think, "mean", &format!("{path}.thinkMs"))?,
        jitter: finite_number(think, "jitter", &format!("{path}.thinkMs"))?,
    };
    let strategy = field(values, "strategyMs", path)?;
    closed(strategy, &["mean", "jitter"], &format!("{path}.strategyMs"))?;
    tier.strategy_ms = Cadence {
        mean: finite_number(strategy, "mean", &format!("{path}.strategyMs"))?,
        jitter: finite_number(strategy, "jitter", &format!("{path}.strategyMs"))?,
    };
    tier.apm = finite_number(values, "apm", path)?;
    tier.burst = finite_number(values, "burst", path)?;
    tier.min_gap_ms = finite_number(values, "minGapMs", path)?;
    let scatter = field(values, "moveScatter", path)?;
    closed(
        scatter,
        &["base", "perUnit"],
        &format!("{path}.moveScatter"),
    )?;
    tier.move_scatter = MoveScatter {
        base: finite_number(scatter, "base", &format!("{path}.moveScatter"))?,
        per_unit: finite_number(scatter, "perUnit", &format!("{path}.moveScatter"))?,
    };
    let target_scatter = field(values, "targetScatter", path)?;
    closed(
        target_scatter,
        &["sigma", "lagS", "slipP", "slipMult"],
        &format!("{path}.targetScatter"),
    )?;
    tier.target_scatter = TargetScatter {
        sigma: finite_number(target_scatter, "sigma", &format!("{path}.targetScatter"))?,
        lag_s: finite_number(target_scatter, "lagS", &format!("{path}.targetScatter"))?,
        slip_p: finite_number(target_scatter, "slipP", &format!("{path}.targetScatter"))?,
        slip_mult: finite_number(target_scatter, "slipMult", &format!("{path}.targetScatter"))?,
    };
    tier.minimap_sigma = finite_number(values, "minimapSigma", path)?;
    tier.edge_click_p = finite_number(values, "edgeClickP", path)?;
    tier.timing_sigma_ms = finite_number(values, "timingSigmaMs", path)?;
    let hesitation = field(values, "hesitation", path)?;
    closed(
        hesitation,
        &["p", "minMs", "maxMs"],
        &format!("{path}.hesitation"),
    )?;
    tier.hesitation = Hesitation {
        p: finite_number(hesitation, "p", &format!("{path}.hesitation"))?,
        min_ms: finite_number(hesitation, "minMs", &format!("{path}.hesitation"))?,
        max_ms: finite_number(hesitation, "maxMs", &format!("{path}.hesitation"))?,
    };
    tier.softmax_t = finite_number(values, "softmaxT", path)?;
    tier.lapse_p = finite_number(values, "lapseP", path)?;
    tier.dodge_p = finite_number(values, "dodgeP", path)?;
    tier.juke_p = finite_number(values, "jukeP", path)?;
    let orbwalk = field(values, "orbwalk", path)?;
    closed(
        orbwalk,
        &["p", "stepU", "angleJitter"],
        &format!("{path}.orbwalk"),
    )?;
    tier.orbwalk = Orbwalk {
        p: finite_number(orbwalk, "p", &format!("{path}.orbwalk"))?,
        step_u: finite_number(orbwalk, "stepU", &format!("{path}.orbwalk"))?,
        angle_jitter: finite_number(orbwalk, "angleJitter", &format!("{path}.orbwalk"))?,
    };
    tier.knowledge = finite_number(values, "knowledge", path)?;
    tier.mob_share_noise = finite_number(values, "mobShareNoise", path)?;
    let route = field(values, "route", path)?;
    closed(
        route,
        &["horizon", "walkPaths", "reach"],
        &format!("{path}.route"),
    )?;
    tier.route = Route {
        horizon: uint_field(
            route,
            "horizon",
            u64::from(u32::MAX),
            &format!("{path}.route"),
        )? as u32,
        walk_paths: bool_field(route, "walkPaths", &format!("{path}.route"))?,
        reach: finite_number(route, "reach", &format!("{path}.route"))?,
    };
    let attention = field(values, "attention", path)?;
    closed(
        attention,
        &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
        &format!("{path}.attention"),
    )?;
    tier.attention = Attention {
        central: finite_number(attention, "central", &format!("{path}.attention"))?,
        periphery_mult: finite_number(attention, "peripheryMult", &format!("{path}.attention"))?,
        engaged_mult: finite_number(attention, "engagedMult", &format!("{path}.attention"))?,
        reconsider_ms: finite_number(attention, "reconsiderMs", &format!("{path}.attention"))?,
    };
    tier.memory_span_ms = finite_number(values, "memorySpanMs", path)?;
    tier.feint_read = finite_number(values, "feintRead", path)?;
    let appraisal = field(values, "appraisal", path)?;
    closed(
        appraisal,
        &["bias", "lead", "busy", "hue", "noise"],
        &format!("{path}.appraisal"),
    )?;
    tier.appraisal = Appraisal {
        bias: finite_number(appraisal, "bias", &format!("{path}.appraisal"))?,
        lead: finite_number(appraisal, "lead", &format!("{path}.appraisal"))?,
        busy: finite_number(appraisal, "busy", &format!("{path}.appraisal"))?,
        hue: finite_number(appraisal, "hue", &format!("{path}.appraisal"))?,
        noise: finite_number(appraisal, "noise", &format!("{path}.appraisal"))?,
    };
    tier.wary = finite_number(values, "wary", path)?;
    let caution = field(values, "caution", path)?;
    closed(
        caution,
        &["mobShare", "eliteShare", "startHp"],
        &format!("{path}.caution"),
    )?;
    tier.caution = Caution {
        mob_share: finite_number(caution, "mobShare", &format!("{path}.caution"))?,
        elite_share: finite_number(caution, "eliteShare", &format!("{path}.caution"))?,
        start_hp: finite_number(caution, "startHp", &format!("{path}.caution"))?,
    };
    Ok(tier)
}

/// Partial tier overrides (`tierOverrides`) keep the declared full-profile grammar but may omit any leaf; unknown
/// keys and undefined members are refused (the source merges them over the base profile).
fn validate_tier_overrides(values: &SVal, path: &str) -> R<()> {
    let entries = object(values, path)?;
    for (key, member) in entries {
        match key.as_str() {
            "id" => {
                enum_value(member, &["easy", "normal", "hard"], &format!("{path}.id"))?;
            }
            "reaction" | "step" | "daze" => validate_ex_gaussian_overrides(
                member,
                &["mu", "sigma", "tau", "floor", "cap"],
                &format!("{path}.{key}"),
            )?,
            "thinkMs" | "strategyMs" => {
                validate_numbers_overrides(member, &["mean", "jitter"], &format!("{path}.{key}"))?
            }
            "moveScatter" => validate_numbers_overrides(
                member,
                &["base", "perUnit"],
                &format!("{path}.moveScatter"),
            )?,
            "targetScatter" => validate_numbers_overrides(
                member,
                &["sigma", "lagS", "slipP", "slipMult"],
                &format!("{path}.targetScatter"),
            )?,
            "hesitation" => validate_numbers_overrides(
                member,
                &["p", "minMs", "maxMs"],
                &format!("{path}.hesitation"),
            )?,
            "orbwalk" => validate_numbers_overrides(
                member,
                &["p", "stepU", "angleJitter"],
                &format!("{path}.orbwalk"),
            )?,
            "route" => {
                let route_path = format!("{path}.route");
                let route = object(member, &route_path)?;
                for (name, leaf) in route {
                    match name.as_str() {
                        "horizon" => {
                            uint_value(
                                leaf,
                                u64::from(u32::MAX),
                                &format!("{route_path}.horizon"),
                            )?;
                        }
                        "walkPaths" => {
                            bool_value(leaf, &format!("{route_path}.walkPaths"))?;
                        }
                        "reach" => {
                            finite_number_value(leaf, &format!("{route_path}.reach"))?;
                        }
                        other => {
                            return Err(err(&route_path, format!("unsupported field {other}")));
                        }
                    }
                }
            }
            "attention" => validate_numbers_overrides(
                member,
                &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
                &format!("{path}.attention"),
            )?,
            "appraisal" => validate_numbers_overrides(
                member,
                &["bias", "lead", "busy", "hue", "noise"],
                &format!("{path}.appraisal"),
            )?,
            "caution" => validate_numbers_overrides(
                member,
                &["mobShare", "eliteShare", "startHp"],
                &format!("{path}.caution"),
            )?,
            "refractoryMs" | "apm" | "burst" | "minGapMs" | "minimapSigma" | "edgeClickP"
            | "timingSigmaMs" | "softmaxT" | "lapseP" | "dodgeP" | "jukeP" | "knowledge"
            | "mobShareNoise" | "memorySpanMs" | "feintRead" | "wary" => {
                finite_number_value(member, &format!("{path}.{key}"))?;
            }
            other => return Err(err(path, format!("unsupported field {other}"))),
        }
    }
    Ok(())
}

fn validate_ex_gaussian_overrides(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    validate_numbers_overrides(value, keys, path)
}

fn validate_numbers_overrides(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, member) in entries {
        if !keys.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported field {key}")));
        }
        finite_number_value(member, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn parse_persona(values: &SVal, path: &str) -> R<PersonaParams> {
    closed(
        values,
        &[
            "id",
            "pve",
            "pvp",
            "loot",
            "bounty",
            "thirdParty",
            "engageEdge",
            "bountyCaution",
            "fleeHp",
            "reengageHp",
            "kite",
            "chaseGiveUpMs",
            "mobKillGoal",
            "playerThreat",
            "eliteAppetite",
            "coliseum",
            "risk",
        ],
        path,
    )?;
    let id = enum_field(
        values,
        "id",
        &["farmer", "hunter", "opportunist", "cautious"],
        path,
    )?;
    let mut persona = match id.as_str() {
        "farmer" => PERSONAS[0],
        "hunter" => PERSONAS[1],
        "opportunist" => PERSONAS[2],
        _ => PERSONAS[3],
    };
    persona.pve = finite_number(values, "pve", path)?;
    persona.pvp = finite_number(values, "pvp", path)?;
    persona.loot = finite_number(values, "loot", path)?;
    persona.bounty = finite_number(values, "bounty", path)?;
    persona.third_party = finite_number(values, "thirdParty", path)?;
    persona.engage_edge = finite_number(values, "engageEdge", path)?;
    persona.bounty_caution = finite_number(values, "bountyCaution", path)?;
    persona.flee_hp = finite_number(values, "fleeHp", path)?;
    persona.reengage_hp = finite_number(values, "reengageHp", path)?;
    persona.kite = finite_number(values, "kite", path)?;
    persona.chase_give_up_ms = finite_number(values, "chaseGiveUpMs", path)?;
    persona.mob_kill_goal = finite_number(values, "mobKillGoal", path)?;
    persona.player_threat = finite_number(values, "playerThreat", path)?;
    persona.elite_appetite = finite_number(values, "eliteAppetite", path)?;
    persona.coliseum = finite_number(values, "coliseum", path)?;
    persona.risk = finite_number(values, "risk", path)?;
    Ok(persona)
}

const PERSONA_SCALARS: [&str; 16] = [
    "pve",
    "pvp",
    "loot",
    "bounty",
    "thirdParty",
    "engageEdge",
    "bountyCaution",
    "fleeHp",
    "reengageHp",
    "kite",
    "chaseGiveUpMs",
    "mobKillGoal",
    "playerThreat",
    "eliteAppetite",
    "coliseum",
    "risk",
];

fn validate_persona_overrides(values: &SVal, path: &str) -> R<()> {
    let entries = object(values, path)?;
    for (key, member) in entries {
        if key == "id" {
            enum_value(
                member,
                &["farmer", "hunter", "opportunist", "cautious"],
                &format!("{path}.id"),
            )?;
        } else if PERSONA_SCALARS.contains(&key.as_str()) {
            finite_number_value(member, &format!("{path}.{key}"))?;
        } else {
            return Err(err(path, format!("unsupported field {key}")));
        }
    }
    Ok(())
}

fn parse_features(value: &SVal, path: &str) -> R<Features> {
    closed(
        value,
        &[
            "messageTypes",
            "wishes",
            "statusEffects",
            "fields",
            "planning",
            "chests",
            "skills",
            "relics",
            "camps",
            "hazards",
        ],
        path,
    )?;
    let mut message_types = Vec::new();
    for (index, message) in array_field(value, "messageTypes", path)?.iter().enumerate() {
        let message = match message {
            SVal::Str(message) => message.clone(),
            other => {
                return Err(err(
                    &format!("{path}.messageTypes[{index}]"),
                    format!("expected a string, got {}", kind_of(other)),
                ))
            }
        };
        one_of(
            &message,
            &FEATURES_MESSAGES,
            &format!("{path}.messageTypes[{index}]"),
        )?;
        message_types.push(message);
    }
    Ok(Features {
        message_types,
        wishes: bool_field(value, "wishes", path)?,
        status_effects: bool_field(value, "statusEffects", path)?,
        fields: bool_field(value, "fields", path)?,
        planning: bool_field(value, "planning", path)?,
        chests: bool_field(value, "chests", path)?,
        skills: bool_field(value, "skills", path)?,
        relics: bool_field(value, "relics", path)?,
        camps: bool_field(value, "camps", path)?,
        hazards: bool_field(value, "hazards", path)?,
    })
}

/// Partial declared feature overrides (`config.features`): every present key is checked, absent keys keep the base.
fn validate_feature_overrides(value: &SVal, path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, member) in entries {
        match key.as_str() {
            "messageTypes" => {
                for (index, message) in array_value(member, &format!("{path}.messageTypes"))?
                    .iter()
                    .enumerate()
                {
                    let message = string_value(message, &format!("{path}.messageTypes[{index}]"))?;
                    one_of(
                        &message,
                        &FEATURES_MESSAGES,
                        &format!("{path}.messageTypes[{index}]"),
                    )?;
                }
            }
            "wishes" | "statusEffects" | "fields" | "planning" | "chests" | "skills" | "relics"
            | "camps" | "hazards" => {
                bool_value(member, &format!("{path}.{key}"))?;
            }
            other => return Err(err(path, format!("unsupported feature field {other}"))),
        }
    }
    Ok(())
}

fn parse_learned_config(value: &SVal, path: &str) -> R<LearnedConfig> {
    closed(value, &["enabled", "entries"], path)?;
    let enabled = bool_field(value, "enabled", path)?;
    let mut entries = Vec::new();
    let entries_path = format!("{path}.entries");
    for (index, row) in array_field(value, "entries", path)?.iter().enumerate() {
        let pair_path = format!("{entries_path}[{index}]");
        let pair = array_value(row, &pair_path)?;
        if pair.len() != 2 {
            return Err(err(&pair_path, "learned entry must be a [key,bias] pair"));
        }
        let key = string_value(&pair[0], &format!("{pair_path}[0]"))?;
        // Source-sanitized learned bias values may legitimately be non-finite; every other config number is finite.
        let bias = match &pair[1] {
            SVal::Num(number) => *number,
            other => {
                return Err(err(
                    &format!("{pair_path}[1]"),
                    format!("expected a number, got {}", kind_of(other)),
                ))
            }
        };
        entries.push((key, bias));
    }
    Ok(LearnedConfig { enabled, entries })
}

/// The declared config's `learned` surface: `enabled` plus ordered entries (entry values may be non-finite).
fn validate_declared_learned(value: &SVal, path: &str) -> R<()> {
    let _ = parse_learned_config(value, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared descriptors: path denial test service.

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PathDescriptor {
    /// The frozen witness's one explicitly admitted argument-sensitive empty-route test service (radius 0).
    TacticsEmptyRouteTest { radius: f64 },
}

pub(crate) fn parse_path_descriptor(value: &SVal, path: &str) -> R<PathDescriptor> {
    closed(value, &["kind", "radius"], path)?;
    let kind = string_field(value, "kind", path)?;
    if kind != "tactics-empty-route-test" {
        return Err(err(
            &format!("{path}.kind"),
            format!("unsupported path descriptor {kind}"),
        ));
    }
    let radius = finite_number(value, "radius", path)?;
    if radius != 0. {
        return Err(err(
            &format!("{path}.radius"),
            "the admitted tactics empty-route test service declares radius 0",
        ));
    }
    Ok(PathDescriptor::TacticsEmptyRouteTest { radius })
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen corpus envelope, maps and component map projections.

#[derive(Clone, Debug)]
pub(crate) struct Source {
    /// The frozen `profile` pin block, retained losslessly (loosely validated; labels are not replay inputs).
    pub(crate) profile: Value,
    pub(crate) maps: Vec<MapFixture>,
    pub(crate) knowledge: Vec<KnowledgeDependency>,
    pub(crate) hand: Vec<HandProfile>,
    pub(crate) cases: Vec<Case>,
}

impl Source {
    pub(crate) fn map_index(&self, label: &str) -> R<usize> {
        self.maps
            .iter()
            .position(|map| map.id == label)
            .ok_or_else(|| format!("source map label {label:?} is not declared in body.maps"))
    }

    pub(crate) fn map(&self, label: &str) -> R<&MapFixture> {
        self.map_index(label).map(|index| &self.maps[index])
    }
}

#[derive(Clone, Debug)]
pub(crate) struct MapFixture {
    pub(crate) id: String,
    pub(crate) map_hash_u32: u32,
    /// Collision map of the declared source `GameMap`; carries the admitted full layers when the map has them.
    pub(crate) open: TileMap,
    /// Source `withGates`: the same map with every `coliseum.gates[].tiles` tile set to `TILE_WALL`.
    pub(crate) locked: TileMap,
    /// The complete decoded source `GameMap` metadata.
    pub(crate) data: GameMapData,
    /// The declared source `GameMap.terrain` layer (row major, `w*h`).
    pub(crate) terrain: Vec<u8>,
    /// The source planning-screen map view (camps and spawn pool).
    pub(crate) plan: PlanMap,
    /// Admitted full gameplay layers; `None` for a source hand-built `mapFromTiles` arena.
    pub(crate) layers: Option<Arc<MapLayers>>,
    /// The stable decoded tagged source map value for callback-result replay.
    pub(crate) raw: BVal,
}

impl MapFixture {
    pub(crate) fn layers(&self) -> Option<&MapLayers> {
        self.layers.as_deref()
    }

    pub(crate) fn terrain(&self) -> &[u8] {
        &self.terrain
    }

    /// Whether this map passed the complete strict `MapExport::validate` layer admission.
    pub(crate) fn fully_admitted(&self) -> bool {
        self.layers.is_some()
    }

    /// Source `campGeoms` (memory.ts): the declared camps, else the regions' mob camps, exactly as the admitted
    /// Memory/Modules readers derive them.
    pub(crate) fn memory_camps(&self) -> R<Vec<CampGeom>> {
        let mut camps: Vec<CampGeom> = Vec::new();
        if !self.data.camps.is_empty() {
            for camp in &self.data.camps {
                camps.push(CampGeom {
                    id: camp.id.clone(),
                    zone: faction_from_zone(camp.zone)?,
                    elite: camp.elite_spot >= 0,
                    x: camp.x,
                    y: camp.y,
                    radius: if camp.radius > 0. {
                        camp.radius
                    } else {
                        camp.r
                    },
                    spots: camp
                        .spots
                        .iter()
                        .map(|spot| Vec2::new(spot.x, spot.y))
                        .collect(),
                });
            }
            return Ok(camps);
        }
        for region in &self.data.regions {
            for camp in &region.mob_camps {
                camps.push(CampGeom {
                    id: camp.id.clone(),
                    zone: faction_from_zone(camp.region)?,
                    elite: camp.elite,
                    x: camp.x,
                    y: camp.y,
                    radius: rh_sim::constants::MOB_LEASH_RADIUS,
                    spots: camp
                        .spots
                        .iter()
                        .map(|spot| Vec2::new(spot.x, spot.y))
                        .collect(),
                });
            }
        }
        Ok(camps)
    }

    /// The admitted Memory map projection (declared camp geometry).
    pub(crate) fn memory_map(&self) -> R<MemoryMap> {
        Ok(MemoryMap {
            camps: self.memory_camps()?,
        })
    }

    /// The admitted Strategy map projection: source camps, coliseum centre/inner spawns and tile spans.
    pub(crate) fn strategy_map(&self) -> R<StrategyMap> {
        let mut camps = Vec::with_capacity(self.data.camps.len());
        for camp in &self.data.camps {
            camps.push(CampDef {
                id: camp.id.clone(),
                zone: faction_from_zone(camp.zone)?,
                x: camp.x,
                y: camp.y,
                r: camp.r,
                spots: camp
                    .spots
                    .iter()
                    .map(|spot| Vec2::new(spot.x, spot.y))
                    .collect(),
                elite_spot: f64::from(camp.elite_spot),
                chest: Vec2::new(camp.chest.x, camp.chest.y),
                area: f64::from(camp.area),
                radius: camp.radius,
            });
        }
        Ok(StrategyMap {
            camps,
            coliseum: ColiseumDef {
                centre: Vec2::new(self.data.coliseum.centre.x, self.data.coliseum.centre.y),
                inner_spawns: self
                    .data
                    .coliseum
                    .inner_spawns
                    .iter()
                    .map(|spot| Vec2::new(spot.x, spot.y))
                    .collect(),
            },
            width: f64::from(self.data.w),
            height: f64::from(self.data.h),
        })
    }

    /// The admitted Tactics map projection: collision tiles, region grid, coliseum centre and Memory camp geometry.
    pub(crate) fn tactics_map(&self) -> R<TacticsMap> {
        Ok(TacticsMap {
            tile_map: self.open.clone(),
            width: self.data.w,
            height: self.data.h,
            region_grid: self.data.region_grid.clone(),
            coliseum_centre: Vec2::new(self.data.coliseum.centre.x, self.data.coliseum.centre.y),
            camps: self.memory_camps()?,
        })
    }

    /// The complete caller-supplied [`super::config::BrainMap`] projection for one Brain config.
    pub(crate) fn brain_map(&self) -> R<super::config::BrainMap> {
        Ok(super::config::BrainMap {
            raw: self.raw.clone(),
            open: self.open.clone(),
            locked: self.locked.clone(),
            terrain: self.terrain.clone(),
            strategy: self.strategy_map()?,
            tactics: self.tactics_map()?,
            memory: self.memory_map()?,
            plan: self.plan.clone(),
        })
    }
}

fn faction_from_zone(zone: rh_sim::mapdata::Zone) -> R<FactionId> {
    FactionId::parse(zone.as_str()).ok_or_else(|| format!("unknown map zone {}", zone.as_str()))
}

fn source_hand_map(data: &GameMapData) -> bool {
    let zero_grid = |grid: &[u8]| grid.iter().all(|value| *value == 0);
    data.coliseum.rect.w == 0
        && data.coliseum.rect.h == 0
        && data.coliseum.rect.x == 0
        && data.coliseum.rect.y == 0
        && data.coliseum.gates.is_empty()
        && data.coliseum.inner_spawns.is_empty()
        && data.regions.is_empty()
        && data.camps.is_empty()
        && data.spawn_pool.is_empty()
        && data.buildings.is_empty()
        && data.spawns.is_empty()
        && data.crate_spots.is_empty()
        && data.ground_spots.is_empty()
        && data.features.is_empty()
        && data.props.is_empty()
        && data.attempt == 0
        && zero_grid(&data.region_grid)
        && zero_grid(&data.territory_grid)
        && zero_grid(&data.feature_grid)
}

fn parse_map_fixture(raw: &Value, path: &str) -> R<MapFixture> {
    let map_value = raw
        .as_object()
        .ok_or_else(|| err(path, "map fixture must be a JSON object"))?;
    for key in map_value.keys() {
        if !["id", "mapHashU32", "value"].contains(&key.as_str()) {
            return Err(err(path, format!("unsupported map fixture field {key}")));
        }
    }
    for key in ["id", "mapHashU32", "value"] {
        if !map_value.contains_key(key) {
            return Err(err(path, format!("missing map fixture field {key}")));
        }
    }
    let id = raw["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| err(&format!("{path}.id"), "expected a non-empty map id"))?
        .to_string();
    let declared_hash = raw["mapHashU32"]
        .as_u64()
        .filter(|hash| *hash <= u64::from(u32::MAX))
        .ok_or_else(|| {
            err(
                &format!("{path}.mapHashU32"),
                "expected the uint32 source map hash",
            )
        })? as u32;
    let value_path = format!("{path}.value");
    let tagged = decode_input(&raw["value"], &value_path)?;
    if !matches!(tagged, SVal::Obj(_)) {
        return Err(err(
            &value_path,
            "expected the tagged source GameMap object",
        ));
    }
    let plain = sval_to_json(&tagged, &value_path)?;
    let data: GameMapData = serde_json::from_value(plain).map_err(|error| {
        err(
            &value_path,
            format!("embedded source GameMap does not match the admitted map DTO: {error}"),
        )
    })?;
    if data.tiles.len() != data.w as usize * data.h as usize {
        return Err(err(
            &format!("{value_path}.tiles"),
            format!(
                "declared tile layer length {} does not match the {w}x{h} map grid",
                data.tiles.len(),
                w = data.w,
                h = data.h
            ),
        ));
    }
    for (layer, rows) in [
        ("terrain", &data.terrain),
        ("regionGrid", &data.region_grid),
        ("territoryGrid", &data.territory_grid),
        ("featureGrid", &data.feature_grid),
    ] {
        if rows.len() != data.w as usize * data.h as usize {
            return Err(err(
                &format!("{value_path}.{layer}"),
                format!(
                    "declared {layer} layer length {} does not match the {w}x{h} map grid",
                    rows.len(),
                    w = data.w,
                    h = data.h
                ),
            ));
        }
    }
    let recomputed = map_hash(&data);
    let recomputed_u32 = u32::from_str_radix(&recomputed, 16)
        .map_err(|error| err(&value_path, format!("map hash is not hex: {error}")))?;
    if recomputed_u32 != declared_hash {
        return Err(err(
            &format!("{path}.mapHashU32"),
            format!(
                "embedded map hash {declared_hash} does not match the recomputed source hash {recomputed} ({recomputed_u32})"
            ),
        ));
    }
    let export = MapExport {
        format: MAP_EXPORT_FORMAT.into(),
        legacy_map_hash_u32: declared_hash,
        map: data.clone(),
    };
    let (open, locked, layers) = match export.validate() {
        Ok(validated) => {
            let (width, height, tiles, layers) = validated.into_parts();
            let layers = Arc::new(layers);
            let mut locked_tiles = tiles.clone();
            for gate in &data.coliseum.gates {
                for tile in &gate.tiles {
                    if tile.x < 0 || tile.y < 0 {
                        return Err(err(&value_path, "gate tile must lie inside the map grid"));
                    }
                    let index = tile.y as usize * width as usize + tile.x as usize;
                    let Some(slot) = locked_tiles.get_mut(index) else {
                        return Err(err(&value_path, "gate tile must lie inside the map grid"));
                    };
                    *slot = rh_sim::map::TILE_WALL;
                }
            }
            let open = TileMap::new(width, height, tiles)
                .map_err(|error| err(&value_path, format!("collision map: {error}")))?
                .with_layers(layers.clone())
                .map_err(|error| err(&value_path, format!("map layers: {error}")))?;
            let locked = TileMap::new(width, height, locked_tiles)
                .map_err(|error| err(&value_path, format!("locked collision map: {error}")))?;
            (open, locked, Some(layers))
        }
        Err(error) => {
            if !source_hand_map(&data) {
                return Err(err(
                    &value_path,
                    format!(
                        "source map {id} is neither fully admissible nor a source hand-built mapFromTiles arena: {error}"
                    ),
                ));
            }
            let open = TileMap::new(data.w, data.h, data.tiles.clone())
                .map_err(|error| err(&value_path, format!("collision map: {error}")))?;
            let mut locked_tiles = data.tiles.clone();
            for gate in &data.coliseum.gates {
                for tile in &gate.tiles {
                    if tile.x < 0 || tile.y < 0 {
                        continue;
                    }
                    let index = tile.y as usize * data.w as usize + tile.x as usize;
                    if let Some(slot) = locked_tiles.get_mut(index) {
                        *slot = rh_sim::map::TILE_WALL;
                    }
                }
            }
            let locked = TileMap::new(data.w, data.h, locked_tiles)
                .map_err(|error| err(&value_path, format!("locked collision map: {error}")))?;
            (open, locked, None)
        }
    };
    let terrain = data.terrain.clone();
    let plan = PlanMap {
        camps: data
            .camps
            .iter()
            .map(|camp| PlanCamp {
                id: camp.id.clone(),
                zone: camp.zone,
                x: camp.x,
                y: camp.y,
                elite_spot: camp.elite_spot,
            })
            .collect(),
        spawn_pool: data
            .spawn_pool
            .iter()
            .map(|spawn| PlanSpawn {
                x: spawn.x,
                y: spawn.y,
                zone: spawn.zone,
            })
            .collect(),
    };
    Ok(MapFixture {
        id,
        map_hash_u32: declared_hash,
        open,
        locked,
        data,
        terrain,
        plan,
        layers,
        raw: sval_to_bval(&tagged),
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// The complete declared private source `Percept` (value-reader.mjs `percept()` + `extras()`). The Brain accepts the
// complete four-status domain alive/dead/mia/lobby for self, fighters and mobs (the component readers stay
// alive/dead/mia); no status is relabelled and no consumed field is dropped.

const SELF_REQUIRED: [&str; 25] = [
    "id",
    "name",
    "x",
    "y",
    "facing",
    "status",
    "hp",
    "maxHp",
    "barrier",
    "faction",
    "weapons",
    "slot",
    "attackTarget",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "speedMult",
    "kills",
    "mobKills",
    "gv",
    "bounty",
];
pub(super) const SELF_KEYS: [&str; 28] = [
    "id",
    "name",
    "x",
    "y",
    "facing",
    "status",
    "hp",
    "maxHp",
    "barrier",
    "faction",
    "weapons",
    "slot",
    "attackTarget",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "windupMult",
    "speedMult",
    "kills",
    "mobKills",
    "gv",
    "bounty",
    "moveSeq",
    "build",
];
pub(super) const HUD_KEYS: [&str; 13] = [
    "phase",
    "training",
    "lobbyEndsAt",
    "raidStartedAt",
    "patienceEndsAt",
    "suddenDeathAt",
    "inColiseum",
    "gatesLocked",
    "startedWith",
    "alive",
    "playerCount",
    "minPlayers",
    "winner",
];
pub(super) const FIGHTER_KEYS: [&str; 23] = [
    "id",
    "name",
    "bot",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "barrierFrac",
    "faction",
    "inHand",
    "drawStartedAt",
    "bounty",
    "immune",
    "sig",
    "brand",
    "targetable",
    "vx",
    "vy",
    "dist",
    "los",
    "tint",
    "central",
];
pub(super) const MOB_KEYS: [&str; 19] = [
    "id",
    "kind",
    "name",
    "type",
    "faction",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "inHand",
    "drawStartedAt",
    "sig",
    "brand",
    "vx",
    "vy",
    "dist",
    "los",
    "central",
];
pub(super) const CONTAINER_KEYS: [&str; 9] = [
    "id",
    "kind",
    "x",
    "y",
    "label",
    "closed",
    "weapon",
    "interactable",
    "dist",
];
pub(super) const PROJECTILE_KEYS: [&str; 11] = [
    "id", "kind", "x", "y", "vx", "vy", "x0", "y0", "t0", "range", "from",
];
pub(super) const MINIMAP_KEYS: [&str; 3] = ["t", "mobs", "gatesLocked"];
pub(super) const MINIMAP_MOB_KEYS: [&str; 5] = ["id", "x", "y", "faction", "elite"];
pub(super) const FEATURE_KEYS: [&str; 10] = [
    "messageTypes",
    "wishes",
    "statusEffects",
    "fields",
    "planning",
    "chests",
    "skills",
    "relics",
    "camps",
    "hazards",
];
pub(super) const EXTRAS_KEYS: [&str; 6] =
    ["wish", "skills", "chests", "camps", "effects", "fields"];

fn number_field_finite(value: &SVal, name: &str, path: &str) -> R<f64> {
    finite_number(value, name, path)
}

fn num_keys(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    for key in keys {
        finite_number(value, key, &format!("{path}.{key}"))?;
    }
    Ok(())
}

fn validate_weapon_pair(value: &SVal, name: &str, path: &str) -> R<()> {
    let _ = weapon_pair(value, name, path)?;
    Ok(())
}

fn validate_self_record(value: &SVal, path: &str) -> R<()> {
    allowed_keys(value, &SELF_KEYS, path)?;
    require_fields(value, &SELF_REQUIRED, path)?;
    string_field(value, "id", path)?;
    string_field(value, "name", path)?;
    // source `vec(self)`: req x/y, both finite numbers.
    let x = finite_number(value, "x", path)?;
    let y = finite_number(value, "y", path)?;
    let _ = (x, y);
    for key in [
        "facing",
        "hp",
        "maxHp",
        "barrier",
        "drawStartedAt",
        "readyAt",
        "immuneUntil",
        "sig",
        "brand",
        "power",
        "asMult",
        "speedMult",
        "kills",
        "mobKills",
        "gv",
        "bounty",
        "moveSeq",
    ] {
        number_field_finite(value, key, path)?;
    }
    if let Some(windup) = optional(value, "windupMult") {
        if !matches!(windup, SVal::Undefined) {
            finite_number_value(windup, &format!("{path}.windupMult"))?;
        }
    }
    enum_field(value, "status", &STATUS_NAMES, path)?;
    let faction = field(value, "faction", path)?;
    if !matches!(faction, SVal::Null) {
        enum_value(faction, &FACTION_NAMES, &format!("{path}.faction"))?;
    }
    validate_weapon_pair(value, "weapons", path)?;
    let slot = uint_field(value, "slot", 1, path)?;
    let _ = slot;
    let target = field(value, "attackTarget", path)?;
    match target {
        SVal::Null | SVal::Str(_) => {}
        other => {
            return Err(err(
                &format!("{path}.attackTarget"),
                format!("expected a string|null, got {}", kind_of(other)),
            ))
        }
    }
    if let Some(build) = optional(value, "build") {
        match build {
            SVal::Null | SVal::Undefined => {}
            SVal::Obj(entries) => {
                for (id, count) in entries {
                    finite_number_value(count, &format!("{path}.build.{id}"))?;
                }
            }
            other => {
                return Err(err(
                    &format!("{path}.build"),
                    format!("expected an object|null, got {}", kind_of(other)),
                ))
            }
        }
    }
    Ok(())
}

fn validate_hud(value: &SVal, path: &str) -> R<()> {
    closed(value, &HUD_KEYS, path)?;
    for key in [
        "lobbyEndsAt",
        "raidStartedAt",
        "patienceEndsAt",
        "suddenDeathAt",
        "startedWith",
        "alive",
        "playerCount",
        "minPlayers",
    ] {
        number_field_finite(value, key, path)?;
    }
    string_field(value, "phase", path)?;
    string_field(value, "winner", path)?;
    bool_field(value, "training", path)?;
    bool_field(value, "gatesLocked", path)?;
    bool_field(value, "inColiseum", path)?;
    Ok(())
}

fn validate_in_hand(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Null => Ok(()),
        SVal::Str(text) => {
            one_of(text, &WEAPON_NAMES, path)?;
            Ok(())
        }
        other => Err(err(
            path,
            format!("expected a weapon string|null, got {}", kind_of(other)),
        )),
    }
}

fn validate_fighter(value: &SVal, path: &str) -> R<()> {
    closed(value, &FIGHTER_KEYS, path)?;
    string_field(value, "id", path)?;
    string_field(value, "name", path)?;
    // source `vec(record)` requires direct finite x and y numbers.
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    enum_field(value, "status", &STATUS_NAMES, path)?;
    let faction = field(value, "faction", path)?;
    if !matches!(faction, SVal::Null) {
        enum_value(faction, &FACTION_NAMES, &format!("{path}.faction"))?;
    }
    validate_in_hand(field(value, "inHand", path)?, &format!("{path}.inHand"))?;
    bool_field(value, "bot", path)?;
    bool_field(value, "immune", path)?;
    bool_field(value, "targetable", path)?;
    bool_field(value, "los", path)?;
    bool_field(value, "central", path)?;
    for key in [
        "facing",
        "hpFrac",
        "drawStartedAt",
        "vx",
        "vy",
        "dist",
        "sig",
        "brand",
        "barrierFrac",
        "bounty",
        "tint",
    ] {
        number_field_finite(value, key, path)?;
    }
    Ok(())
}

fn validate_mob(value: &SVal, path: &str) -> R<()> {
    allowed_keys(value, &MOB_KEYS, path)?;
    require_fields(
        value,
        &[
            "id",
            "kind",
            "name",
            "faction",
            "x",
            "y",
            "facing",
            "status",
            "hpFrac",
            "inHand",
            "drawStartedAt",
            "sig",
            "brand",
            "vx",
            "vy",
            "dist",
            "los",
            "central",
        ],
        path,
    )?;
    string_field(value, "id", path)?;
    string_field(value, "name", path)?;
    if let Some(kind_text) = optional(value, "type") {
        match kind_text {
            SVal::Undefined => {}
            other => {
                string_value(other, &format!("{path}.type"))?;
            }
        }
    }
    enum_field(value, "kind", &MOB_KINDS, path)?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    enum_field(value, "status", &STATUS_NAMES, path)?;
    let faction = field(value, "faction", path)?;
    if !matches!(faction, SVal::Null) {
        enum_value(faction, &FACTION_NAMES, &format!("{path}.faction"))?;
    }
    validate_in_hand(field(value, "inHand", path)?, &format!("{path}.inHand"))?;
    bool_field(value, "los", path)?;
    bool_field(value, "central", path)?;
    for key in [
        "facing",
        "hpFrac",
        "drawStartedAt",
        "vx",
        "vy",
        "dist",
        "sig",
        "brand",
    ] {
        number_field_finite(value, key, path)?;
    }
    Ok(())
}

fn validate_container(value: &SVal, path: &str) -> R<()> {
    closed(value, &CONTAINER_KEYS, path)?;
    string_field(value, "id", path)?;
    string_field(value, "kind", path)?;
    string_field(value, "label", path)?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    bool_field(value, "closed", path)?;
    bool_field(value, "interactable", path)?;
    if let Some(weapon) = optional(value, "weapon") {
        if !matches!(weapon, SVal::Undefined) {
            validate_in_hand(weapon, &format!("{path}.weapon"))?;
        }
    }
    finite_number(value, "dist", path)?;
    Ok(())
}

fn validate_projectile(value: &SVal, path: &str) -> R<()> {
    closed(value, &PROJECTILE_KEYS, path)?;
    string_field(value, "id", path)?;
    enum_field(value, "kind", &PROJECTILE_KINDS, path)?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    for key in ["vx", "vy", "x0", "y0", "t0", "range"] {
        number_field_finite(value, key, path)?;
    }
    // `from` is part of the declared record; source never narrows it, so it is retained losslessly (presence checked).
    let _ = field(value, "from", path)?;
    Ok(())
}

fn validate_minimap(value: &SVal, path: &str) -> R<()> {
    closed(value, &MINIMAP_KEYS, path)?;
    number_field_finite(value, "t", path)?;
    bool_field(value, "gatesLocked", path)?;
    for (index, row) in array_field(value, "mobs", path)?.iter().enumerate() {
        let row_path = format!("{path}.mobs[{index}]");
        closed(row, &MINIMAP_MOB_KEYS, &row_path)?;
        string_field(row, "id", &row_path)?;
        finite_number(row, "x", &row_path)?;
        finite_number(row, "y", &row_path)?;
        let faction = field(row, "faction", &row_path)?;
        if !matches!(faction, SVal::Null) {
            enum_value(faction, &FACTION_NAMES, &format!("{row_path}.faction"))?;
        }
        bool_field(row, "elite", &row_path)?;
    }
    Ok(())
}

fn validate_event(value: &SVal, path: &str) -> R<()> {
    let kind = string_field(value, "kind", path)?;
    let fields: &[&str] = match kind.as_str() {
        "windup" => &["by", "weapon", "a", "ms"],
        "swing" => &["by", "weapon", "a"],
        "hit" => &["id", "by", "amount", "weapon", "sig"],
        "block" => &["id", "by", "weapon"],
        "stagger" => &["id"],
        "cancel" => &["id"],
        "projEnd" => &["id", "proj", "reason"],
        "death" => &["id", "name", "by", "mob"],
        "heal" => &["id", "amount"],
        "teleport" => &[],
        "bounty" => &["id", "name", "bounty"],
        "victory" => &["id", "name", "draw"],
        "toast" => &["text"],
        "result" => &["result"],
        "private" => &["type", "msg"],
        "ext" => &["fx", "data"],
        other => {
            return Err(err(
                &format!("{path}.kind"),
                format!("unsupported event kind {other}"),
            ))
        }
    };
    let mut allowed = vec!["kind", "t", "at"];
    allowed.extend_from_slice(fields);
    closed(value, &allowed, path)?;
    number_field_finite(value, "t", path)?;
    match field(value, "at", path)? {
        SVal::Null => {}
        at => {
            let _ = point_value(at, &format!("{path}.at"))?;
        }
    }
    if kind == "toast" {
        string_field(value, "text", path)?;
    }
    if kind == "windup" {
        string_field(value, "by", path)?;
        let weapon = field(value, "weapon", path)?;
        enum_value(weapon, &WEAPON_NAMES, &format!("{path}.weapon"))?;
        number_field_finite(value, "a", path)?;
        number_field_finite(value, "ms", path)?;
    }
    if kind == "cancel" || kind == "stagger" {
        string_field(value, "id", path)?;
    }
    for key in ["id", "by"] {
        if let Some(member) = optional(value, key) {
            match member {
                SVal::Null | SVal::Str(_) => {}
                other => {
                    return Err(err(
                        &format!("{path}.{key}"),
                        format!("expected a string|null, got {}", kind_of(other)),
                    ))
                }
            }
        }
    }
    for key in ["amount", "bounty", "a", "ms"] {
        if optional(value, key).is_some() {
            number_field_finite(value, key, path)?;
        }
    }
    if kind == "death" {
        bool_field(value, "mob", path)?;
    }
    if kind == "hit" {
        let weapon = field(value, "weapon", path)?;
        enum_value(weapon, &WEAPON_NAMES, &format!("{path}.weapon"))?;
    }
    if kind == "ext" {
        string_field(value, "fx", path)?;
        let data = field(value, "data", path)?;
        object(data, &format!("{path}.data"))?;
    }
    if kind == "private" {
        string_field(value, "type", path)?;
        let msg = field(value, "msg", path)?;
        object(msg, &format!("{path}.msg"))?;
    }
    Ok(())
}

fn validate_wish_value(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Null | SVal::Undefined => Ok(()),
        SVal::Obj(_) => {
            allowed_keys(
                value,
                &["ability", "def", "rank", "readyAt", "casting"],
                path,
            )?;
            require_fields(
                value,
                &["ability", "def", "rank", "readyAt", "casting"],
                path,
            )?;
            string_field(value, "ability", path)?;
            number_field_finite(value, "rank", path)?;
            number_field_finite(value, "readyAt", path)?;
            bool_field(value, "casting", path)?;
            match field(value, "def", path)? {
                SVal::Null => Ok(()),
                SVal::Obj(_) => {
                    let def = field(value, "def", path)?;
                    let def_path = format!("{path}.def");
                    require_fields(def, &["id", "name", "ranks", "ai", "blockedBy"], &def_path)?;
                    string_field(def, "id", &def_path)?;
                    string_field(def, "name", &def_path)?;
                    for key in ["ranks", "ai", "blockedBy"] {
                        let rows = field(def, key, &def_path)?;
                        array_value(rows, &format!("{def_path}.{key}"))?;
                    }
                    Ok(())
                }
                other => Err(err(
                    &format!("{path}.def"),
                    format!(
                        "expected the opaque ability def object|null, got {}",
                        kind_of(other)
                    ),
                )),
            }
        }
        other => Err(err(
            path,
            format!(
                "expected the opaque wish object|null, got {}",
                kind_of(other)
            ),
        )),
    }
}

fn validate_skills(value: &SVal, path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (slot, wish) in entries {
        validate_wish_value(wish, &format!("{path}.{slot}"))?;
    }
    Ok(())
}

fn validate_chest_row(value: &SVal, path: &str) -> R<()> {
    closed(
        value,
        &["id", "x", "y", "expiresAt", "options", "takenBy", "picked"],
        path,
    )?;
    string_field(value, "id", path)?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    number_field_finite(value, "expiresAt", path)?;
    bool_field(value, "picked", path)?;
    match field(value, "options", path)? {
        SVal::Null => {}
        options => {
            string_array_value(options, &format!("{path}.options"))?;
        }
    }
    let taken_by = field(value, "takenBy", path)?;
    string_array_value(taken_by, &format!("{path}.takenBy"))?;
    Ok(())
}

fn validate_camp_view(value: &SVal, path: &str) -> R<()> {
    // The declared camp view keeps the source record's optional `respawnAt` clock when the camp is dead.
    allowed_keys(
        value,
        &[
            "index",
            "id",
            "type",
            "reward",
            "alive",
            "state",
            "respawnAt",
        ],
        path,
    )?;
    require_fields(
        value,
        &["index", "id", "type", "reward", "alive", "state"],
        path,
    )?;
    for key in ["index", "alive", "state"] {
        number_field_finite(value, key, path)?;
    }
    for key in ["id", "type", "reward"] {
        string_field(value, key, path)?;
    }
    if optional(value, "respawnAt").is_some() {
        number_field_finite(value, "respawnAt", path)?;
    }
    Ok(())
}

fn validate_field_row(value: &SVal, path: &str) -> R<()> {
    closed(
        value,
        &[
            "id", "kind", "ability", "x", "y", "x2", "y2", "r", "owner", "endsAt",
        ],
        path,
    )?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    for key in ["x2", "y2", "r", "endsAt"] {
        number_field_finite(value, key, path)?;
    }
    for key in ["id", "kind", "ability"] {
        string_field(value, key, path)?;
    }
    let owner = field(value, "owner", path)?;
    match owner {
        SVal::Null | SVal::Str(_) => Ok(()),
        other => Err(err(
            &format!("{path}.owner"),
            format!("expected a string|null, got {}", kind_of(other)),
        )),
    }
}

fn validate_extras(value: &SVal, path: &str) -> R<()> {
    allowed_keys(value, &EXTRAS_KEYS, path)?;
    if let Some(wish) = optional(value, "wish") {
        validate_wish_value(wish, &format!("{path}.wish"))?;
    }
    if let Some(skills) = optional(value, "skills") {
        if !matches!(skills, SVal::Undefined) {
            validate_skills(skills, &format!("{path}.skills"))?;
        }
    }
    if let Some(chests) = optional(value, "chests") {
        for (index, row) in array_value(chests, &format!("{path}.chests"))?
            .iter()
            .enumerate()
        {
            validate_chest_row(row, &format!("{path}.chests[{index}]"))?;
        }
    }
    if let Some(camps) = optional(value, "camps") {
        for (index, row) in array_value(camps, &format!("{path}.camps"))?
            .iter()
            .enumerate()
        {
            validate_camp_view(row, &format!("{path}.camps[{index}]"))?;
        }
    }
    if let Some(effects) = optional(value, "effects") {
        match effects {
            SVal::Obj(entries) => {
                for (id, number) in entries {
                    finite_number_value(number, &format!("{path}.effects.{id}"))?;
                }
            }
            other => {
                return Err(err(
                    &format!("{path}.effects"),
                    format!("expected an effects object, got {}", kind_of(other)),
                ))
            }
        }
    }
    if let Some(fields) = optional(value, "fields") {
        for (index, row) in array_value(fields, &format!("{path}.fields"))?
            .iter()
            .enumerate()
        {
            validate_field_row(row, &format!("{path}.fields[{index}]"))?;
        }
    }
    Ok(())
}

fn validate_features_record(value: &SVal, path: &str) -> R<()> {
    closed(value, &FEATURE_KEYS, path)?;
    for (index, message) in array_field(value, "messageTypes", path)?.iter().enumerate() {
        let message = string_value(message, &format!("{path}.messageTypes[{index}]"))?;
        one_of(
            &message,
            &FEATURES_MESSAGES,
            &format!("{path}.messageTypes[{index}]"),
        )?;
    }
    for key in [
        "wishes",
        "statusEffects",
        "fields",
        "planning",
        "chests",
        "skills",
        "relics",
        "camps",
        "hazards",
    ] {
        bool_field(value, key, path)?;
    }
    Ok(())
}

/// The complete declared Brain percept grammar. `diagnostic` values (frozen expected trace context percepts) use the
/// same grammar: they are declared source percepts, never a different shape.
pub(super) fn validate_percept(value: &SVal, path: &str) -> R<()> {
    // `closed(p, [...])` then `finite(p)`: every declared input number anywhere in the percept is finite.
    closed(value, &PERCEPT_KEYS, path)?;
    check_finite(value, path)?;
    finite_number(value, "now", path)?;
    finite_number(value, "viewT", path)?;
    let self_value = field(value, "self", path)?;
    validate_self_record(self_value, &format!("{path}.self"))?;
    validate_hud(field(value, "hud", path)?, &format!("{path}.hud"))?;
    for (index, fighter) in array_field(value, "fighters", path)?.iter().enumerate() {
        validate_fighter(fighter, &format!("{path}.fighters[{index}]"))?;
    }
    for (index, mob) in array_field(value, "mobs", path)?.iter().enumerate() {
        validate_mob(mob, &format!("{path}.mobs[{index}]"))?;
    }
    for (index, container) in array_field(value, "containers", path)?.iter().enumerate() {
        validate_container(container, &format!("{path}.containers[{index}]"))?;
    }
    for (index, projectile) in array_field(value, "projectiles", path)?.iter().enumerate() {
        validate_projectile(projectile, &format!("{path}.projectiles[{index}]"))?;
    }
    validate_minimap(field(value, "minimap", path)?, &format!("{path}.minimap"))?;
    for (index, event) in array_field(value, "events", path)?.iter().enumerate() {
        validate_event(event, &format!("{path}.events[{index}]"))?;
    }
    validate_extras(field(value, "extras", path)?, &format!("{path}.extras"))?;
    validate_features_record(field(value, "features", path)?, &format!("{path}.features"))?;
    Ok(())
}

/// Build the typed Brain percept header plus the complete lossless raw [`BVal`] of the same declared record.
pub(crate) fn build_percept(value: &SVal, path: &str) -> R<Percept> {
    validate_percept(value, path)?;
    let now = finite_number(value, "now", path)?;
    let view_time = finite_number(value, "viewT", path)?;
    let self_value = field(value, "self", path)?;
    let me_weapons = weapon_pair(self_value, "weapons", &format!("{path}.self"))?;
    let attack_target = match field(self_value, "attackTarget", &format!("{path}.self"))? {
        SVal::Null => None,
        SVal::Str(target) => Some(target.clone()),
        other => {
            return Err(err(
                &format!("{path}.self.attackTarget"),
                format!("expected a string|null, got {}", kind_of(other)),
            ))
        }
    };
    let hud = field(value, "hud", path)?;
    let has_toast = array_field(value, "events", path)?.iter().any(|event| {
        event
            .field("kind", &format!("{path}.events[]"))
            .map(|kind| matches!(kind, SVal::Str(text) if text == "toast"))
            .unwrap_or(false)
    });
    let features = parse_features(field(value, "features", path)?, &format!("{path}.features"))?;
    Ok(Percept {
        now,
        view_time,
        me_x: finite_number(self_value, "x", &format!("{path}.self"))?,
        me_y: finite_number(self_value, "y", &format!("{path}.self"))?,
        me_status: string_field(self_value, "status", &format!("{path}.self"))?,
        me_faction: opt_faction_value(
            field(self_value, "faction", &format!("{path}.self"))?,
            &format!("{path}.self.faction"),
        )?,
        me_weapons,
        me_draw_started_at: finite_number(self_value, "drawStartedAt", &format!("{path}.self"))?,
        me_attack_held: attack_target.is_some(),
        me_attack_target: attack_target,
        hud_phase: string_field(hud, "phase", &format!("{path}.hud"))?,
        hud_gates_locked: bool_field(hud, "gatesLocked", &format!("{path}.hud"))?,
        hud_sudden_death_at: finite_number(hud, "suddenDeathAt", &format!("{path}.hud"))?,
        has_toast,
        features,
        raw: sval_to_bval(value),
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Source goals, decisions, intents, module outputs and caller module rules.

fn parse_goal(value: &SVal, path: &str) -> R<Goal> {
    let kind = string_field(value, "kind", path)?;
    let fields: &[&str] = match kind.as_str() {
        "idle" => &[],
        "farm" => &["mob", "camp"],
        "hunt" | "fight" => &["target"],
        "loot" => &["container"],
        "flee" => &["from", "until"],
        "roam" => &["to", "why"],
        "hold" => &["at", "why"],
        "module" => &["module", "data"],
        other => {
            return Err(err(
                &format!("{path}.kind"),
                format!("unsupported source goal kind {other}"),
            ))
        }
    };
    let mut allowed = vec!["kind"];
    allowed.extend_from_slice(fields);
    closed(value, &allowed, path)?;
    Ok(match kind.as_str() {
        "idle" => Goal::Idle,
        "farm" => Goal::Farm {
            mob: string_field(value, "mob", path)?,
            camp: match field(value, "camp", path)? {
                SVal::Null => None,
                SVal::Str(text) => Some(text.clone()),
                other => {
                    return Err(err(
                        &format!("{path}.camp"),
                        format!("expected a camp id string|null, got {}", kind_of(other)),
                    ))
                }
            },
        },
        "hunt" => Goal::Hunt {
            target: string_field(value, "target", path)?,
        },
        "fight" => Goal::Fight {
            target: string_field(value, "target", path)?,
        },
        "loot" => Goal::Loot {
            container: string_field(value, "container", path)?,
        },
        "flee" => {
            let mut from = Vec::new();
            for (index, row) in array_field(value, "from", path)?.iter().enumerate() {
                from.push(point_value(row, &format!("{path}.from[{index}]"))?);
            }
            Goal::Flee {
                from,
                until: finite_number(value, "until", path)?,
            }
        }
        "roam" => {
            let why = match string_field(value, "why", path)?.as_str() {
                "explore" => RoamWhy::Explore,
                "camp" => RoamWhy::Camp,
                "lastSeen" => RoamWhy::LastSeen,
                "coliseum" => RoamWhy::Coliseum,
                "centre" => RoamWhy::Centre,
                other => {
                    return Err(err(
                        &format!("{path}.why"),
                        format!("unsupported source roam reason {other}"),
                    ))
                }
            };
            Goal::Roam {
                to: point_field(value, "to", path)?,
                why,
            }
        }
        "hold" => {
            let why = match string_field(value, "why", path)?.as_str() {
                "coliseum" => HoldWhy::Coliseum,
                "ambush" => HoldWhy::Ambush,
                "wait" => HoldWhy::Wait,
                other => {
                    return Err(err(
                        &format!("{path}.why"),
                        format!("unsupported source hold reason {other}"),
                    ))
                }
            };
            Goal::Hold {
                at: point_field(value, "at", path)?,
                why,
            }
        }
        "module" => {
            let data = field(value, "data", path)?;
            object(data, &format!("{path}.data"))?;
            let data = sval_to_method_value(data).ok_or_else(|| {
                err(
                    &format!("{path}.data"),
                    "module goal data holds a non-record tagged value",
                )
            })?;
            Goal::Module {
                module: string_field(value, "module", path)?,
                data,
            }
        }
        _ => unreachable!("goal kind list is exhaustive"),
    })
}

fn parse_goal_decision(value: &SVal, path: &str) -> R<GoalDecision> {
    allowed_keys(value, &["goal", "utility", "why", "choice"], path)?;
    require_fields(value, &["goal", "utility", "why"], path)?;
    let choice = match optional(value, "choice") {
        None | Some(SVal::Undefined) => None,
        Some(SVal::Str(choice)) => Some(choice.clone()),
        Some(other) => {
            return Err(err(
                &format!("{path}.choice"),
                format!("expected a choice key string, got {}", kind_of(other)),
            ))
        }
    };
    Ok(GoalDecision {
        goal: parse_goal(field(value, "goal", path)?, &format!("{path}.goal"))?,
        utility: finite_number(value, "utility", path)?,
        why: string_field(value, "why", path)?,
        choice,
    })
}

/// Source `IntentTiming` as the declared caller-rule object spells it. `Current` is the declared placeholder the frozen
/// runner rewrites to `{kind:"timed",due:p.now}` per hook call; typed [`IntentTiming`] cannot represent it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CallerTiming {
    Current,
    Step,
    Timed { due: f64 },
    React { stimulus: Stimulus },
}

/// Source `IntentBody` as a declared caller-rule object spells it (the full 8-kind union).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CallerIntentBody {
    Lock {
        target: String,
        at: Vec2,
    },
    Move {
        to: Vec2,
    },
    Stop,
    Swap {
        slot: u8,
    },
    Pickup {
        container: String,
    },
    Cast {
        slot: String,
        x: f64,
        y: f64,
        target: Option<String>,
        at: Option<Vec2>,
        snap_radius: Option<f64>,
    },
    Plan {
        msg: PlanMsg,
    },
    Choose {
        msg: ChooseMsg,
    },
}

/// One declared caller-rule/Hand source intent, kept losslessly source-shaped.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CallerIntent {
    pub(crate) body: CallerIntentBody,
    /// Source `priority` as a finite JS number: the frozen caller rules legitimately contain -1/-2.
    pub(crate) priority: f64,
    pub(crate) timing: CallerTiming,
    pub(crate) why: String,
    /// The declared tagged source intent object, own-key order preserved (trace-result encoding).
    pub(crate) raw: BVal,
}

impl CallerIntent {
    /// Source kind string (`lock`/`move`/`stop`/`swap`/`pickup`/`cast`/`plan`/`choose`).
    pub(crate) fn kind(&self) -> &'static str {
        match self.body {
            CallerIntentBody::Lock { .. } => "lock",
            CallerIntentBody::Move { .. } => "move",
            CallerIntentBody::Stop => "stop",
            CallerIntentBody::Swap { .. } => "swap",
            CallerIntentBody::Pickup { .. } => "pickup",
            CallerIntentBody::Cast { .. } => "cast",
            CallerIntentBody::Plan { .. } => "plan",
            CallerIntentBody::Choose { .. } => "choose",
        }
    }

    /// The typed composition intent, only when the source value is representable by [`Intent`]: an integral priority
    /// in `0..=255` and a `step`/`timed`/`react` timing (`current` must be rewritten by the caller first).
    pub(crate) fn to_typed(&self) -> Option<Intent> {
        if !(self.priority >= 0.
            && self.priority <= 255.
            && self.priority.fract() == 0.
            && self.priority.is_finite())
        {
            return None;
        }
        let timing = match &self.timing {
            CallerTiming::Step => IntentTiming::Step {},
            CallerTiming::Timed { due } => IntentTiming::Timed { due: *due },
            CallerTiming::React { stimulus } => IntentTiming::React {
                stimulus: stimulus.clone(),
            },
            CallerTiming::Current => return None,
        };
        let body = match &self.body {
            CallerIntentBody::Lock { target, at } => IntentBody::Lock {
                target: target.clone(),
                at: *at,
            },
            CallerIntentBody::Move { to } => IntentBody::Move { to: *to },
            CallerIntentBody::Stop => IntentBody::Stop {},
            CallerIntentBody::Swap { slot } => IntentBody::Swap { slot: *slot },
            CallerIntentBody::Pickup { container } => IntentBody::Pickup {
                container: container.clone(),
            },
            CallerIntentBody::Cast {
                slot,
                x,
                y,
                target,
                at,
                snap_radius,
            } => IntentBody::Cast {
                slot: slot.clone(),
                x: *x,
                y: *y,
                target: target.clone(),
                at: *at,
                snap_radius: *snap_radius,
            },
            CallerIntentBody::Plan { msg } => IntentBody::Plan { msg: msg.clone() },
            CallerIntentBody::Choose { msg } => IntentBody::Choose { msg: msg.clone() },
        };
        Some(Intent {
            body,
            priority: self.priority as u8,
            timing,
            why: self.why.clone(),
        })
    }

    /// The typed composition intent after the frozen per-hook-call `current` → `timed(due:now)` rewrite.
    pub(crate) fn to_typed_at(&self, now: f64) -> Option<Intent> {
        self.rewritten_at(now).to_typed()
    }

    /// The declared source intent with `timing.kind:"current"` rewritten to the frozen runner's
    /// `{kind:"timed",due:now}` value (otherwise a clone). The raw tagged object keeps its own-key order.
    pub(crate) fn rewritten_at(&self, now: f64) -> Self {
        match self.timing {
            CallerTiming::Current => {
                let raw = match &self.raw {
                    BVal::Obj(entries) => BVal::Obj(
                        entries
                            .iter()
                            .map(|(key, member)| {
                                if key == "timing" {
                                    (
                                        key.clone(),
                                        BVal::Obj(vec![
                                            ("kind".into(), BVal::text("timed")),
                                            ("due".into(), BVal::Num(now)),
                                        ]),
                                    )
                                } else {
                                    (key.clone(), member.clone())
                                }
                            })
                            .collect(),
                    ),
                    other => other.clone(),
                };
                Self {
                    timing: CallerTiming::Timed { due: now },
                    raw,
                    ..self.clone()
                }
            }
            _ => self.clone(),
        }
    }

    /// The exact source-result row for one `intents` hook result: the frozen runner maps every declared rule intent
    /// with `{...i, ...(i.timing?.kind==='current' ? {timing:{kind:'timed',due:ctx.p.now}} : {})}`.
    pub(crate) fn to_trace(&self, now: f64) -> BVal {
        self.rewritten_at(now).raw.clone()
    }

    /// The declared source intent object verbatim (no per-hook `current` rewrite): used where the frozen runner returns
    /// the rule object unchanged (`adjust` appended intents, declared `ModuleOutput` intents).
    pub(crate) fn to_trace_verbatim(&self) -> BVal {
        self.raw.clone()
    }
}

/// One declared caller `ModuleOutput` rule (`{intents,status,attacking}`): source-shaped intents are retained so the
/// exact `act` result row can be reproduced; typed conversion is available for composition.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DeclaredModuleOutput {
    pub(crate) intents: Vec<CallerIntent>,
    pub(crate) status: GoalStatus,
    pub(crate) attacking: bool,
    /// The declared tagged output object, own-key order preserved (the frozen runner returns it unchanged).
    pub(crate) raw: BVal,
}

impl DeclaredModuleOutput {
    pub(crate) fn to_typed(&self) -> Result<ModuleOutput, String> {
        let mut intents = Vec::with_capacity(self.intents.len());
        for (index, intent) in self.intents.iter().enumerate() {
            let typed = intent.to_typed().ok_or_else(|| {
                format!(
                    "declared module output intent {index} is not representable as a typed Intent"
                )
            })?;
            intents.push(typed);
        }
        Ok(ModuleOutput::new(
            intents,
            self.status.clone(),
            self.attacking,
        ))
    }

    pub(crate) fn to_trace(&self) -> BVal {
        self.raw.clone()
    }
}

fn parse_plan_msg(value: &SVal, path: &str) -> R<PlanMsg> {
    object(value, path)?;
    let mut msg = PlanMsg::default();
    for (key, member) in object(value, path)? {
        match key.as_str() {
            "spawn" => match member {
                SVal::Null | SVal::Undefined => {}
                leaf => {
                    msg.spawn =
                        Some(uint_value(leaf, u64::from(u8::MAX), &format!("{path}.spawn"))? as u8);
                }
            },
            "boon" => match member {
                SVal::Null | SVal::Undefined => {}
                leaf => {
                    msg.boon =
                        Some(uint_value(leaf, u64::from(u8::MAX), &format!("{path}.boon"))? as u8);
                }
            },
            "ready" => match member {
                SVal::Null | SVal::Undefined => {}
                leaf => {
                    msg.ready = Some(bool_value(leaf, &format!("{path}.ready"))?);
                }
            },
            other => return Err(err(path, format!("unsupported plan message field {other}"))),
        }
    }
    Ok(msg)
}

fn parse_choose_msg(value: &SVal, path: &str) -> R<ChooseMsg> {
    object(value, path)?;
    require_fields(value, &["chest", "pick"], path)?;
    allowed_keys(value, &["chest", "pick", "replace"], path)?;
    let pick = finite_number(value, "pick", path)?;
    if !(pick >= f64::from(i8::MIN) && pick <= f64::from(i8::MAX) && pick.fract() == 0.) {
        return Err(err(
            &format!("{path}.pick"),
            format!("expected an i8 pick index, got {pick}"),
        ));
    }
    let replace = match optional(value, "replace") {
        None | Some(SVal::Null) | Some(SVal::Undefined) => None,
        Some(leaf) => Some(uint_value(leaf, u64::from(u8::MAX), &format!("{path}.replace"))? as u8),
    };
    Ok(ChooseMsg {
        chest: string_field(value, "chest", path)?,
        pick: pick as i8,
        replace,
    })
}

fn parse_stimulus(value: &SVal, path: &str) -> R<Stimulus> {
    allowed_keys(value, &["kind", "at", "subject", "central", "value"], path)?;
    require_fields(value, &["kind", "at", "subject", "central"], path)?;
    let kind_text = string_field(value, "kind", path)?;
    let kind = StimulusKind::parse(&kind_text).ok_or_else(|| {
        err(
            &format!("{path}.kind"),
            format!("unknown stimulus kind {kind_text}"),
        )
    })?;
    let subject = match field(value, "subject", path)? {
        SVal::Null | SVal::Undefined => None,
        SVal::Str(subject) => Some(subject.clone()),
        other => {
            return Err(err(
                &format!("{path}.subject"),
                format!("expected a string|null, got {}", kind_of(other)),
            ))
        }
    };
    let stimulus_value = match optional(value, "value") {
        None | Some(SVal::Null) | Some(SVal::Undefined) => None,
        Some(leaf) => Some(finite_number_value(leaf, &format!("{path}.value"))?),
    };
    Ok(Stimulus {
        kind,
        at: finite_number(value, "at", path)?,
        subject,
        central: bool_field(value, "central", path)?,
        value: stimulus_value,
    })
}

/// One declared caller-rule source intent (`verify.mjs` `intent()` grammar) kept source-shaped.
fn parse_caller_intent(value: &SVal, path: &str) -> R<CallerIntent> {
    let kind = enum_field(value, "kind", &INTENT_KINDS, path)?;
    let priority = finite_number(value, "priority", path)?;
    let why = string_field(value, "why", path)?;
    let timing_value = field(value, "timing", path)?;
    let timing_path = format!("{path}.timing");
    let timing_kind = string_field(timing_value, "kind", &timing_path)?;
    let timing = match timing_kind.as_str() {
        "current" => {
            closed(timing_value, &["kind"], &timing_path)?;
            CallerTiming::Current
        }
        "step" => {
            closed(timing_value, &["kind"], &timing_path)?;
            CallerTiming::Step
        }
        "timed" => {
            closed(timing_value, &["kind", "due"], &timing_path)?;
            CallerTiming::Timed {
                due: finite_number(timing_value, "due", &timing_path)?,
            }
        }
        "react" => {
            closed(timing_value, &["kind", "stimulus"], &timing_path)?;
            CallerTiming::React {
                stimulus: parse_stimulus(
                    field(timing_value, "stimulus", &timing_path)?,
                    &format!("{timing_path}.stimulus"),
                )?,
            }
        }
        other => {
            return Err(err(
                &format!("{timing_path}.kind"),
                format!("unsupported intent timing {other}"),
            ))
        }
    };
    let body = match kind.as_str() {
        "lock" => {
            closed(
                value,
                &["kind", "priority", "timing", "why", "target", "at"],
                path,
            )?;
            CallerIntentBody::Lock {
                target: string_field(value, "target", path)?,
                at: point_field(value, "at", path)?,
            }
        }
        "move" => {
            closed(value, &["kind", "priority", "timing", "why", "to"], path)?;
            CallerIntentBody::Move {
                to: point_field(value, "to", path)?,
            }
        }
        "stop" => {
            closed(value, &["kind", "priority", "timing", "why"], path)?;
            CallerIntentBody::Stop
        }
        "swap" => {
            closed(value, &["kind", "priority", "timing", "why", "slot"], path)?;
            CallerIntentBody::Swap {
                slot: uint_field(value, "slot", 1, path)? as u8,
            }
        }
        "pickup" => {
            closed(
                value,
                &["kind", "priority", "timing", "why", "container"],
                path,
            )?;
            CallerIntentBody::Pickup {
                container: string_field(value, "container", path)?,
            }
        }
        "cast" => {
            // `target`/`at`/`snapRadius` are declared optional leaves of the source cast intent.
            allowed_keys(
                value,
                &[
                    "kind",
                    "priority",
                    "timing",
                    "why",
                    "slot",
                    "x",
                    "y",
                    "target",
                    "at",
                    "snapRadius",
                ],
                path,
            )?;
            let slot = one_of(
                &string_field(value, "slot", path)?,
                &["wish", "q", "e"],
                &format!("{path}.slot"),
            )?;
            finite_number(value, "x", path)?;
            finite_number(value, "y", path)?;
            let target = match optional(value, "target") {
                None | Some(SVal::Null) | Some(SVal::Undefined) => None,
                Some(SVal::Str(target)) => Some(target.clone()),
                Some(other) => {
                    return Err(err(
                        &format!("{path}.target"),
                        format!("expected a fighter id string|null, got {}", kind_of(other)),
                    ))
                }
            };
            let at = match optional(value, "at") {
                None | Some(SVal::Null) | Some(SVal::Undefined) => None,
                Some(leaf) => Some(point_value(leaf, &format!("{path}.at"))?),
            };
            let snap_radius = match optional(value, "snapRadius") {
                None | Some(SVal::Null) | Some(SVal::Undefined) => None,
                Some(leaf) => Some(finite_number_value(leaf, &format!("{path}.snapRadius"))?),
            };
            CallerIntentBody::Cast {
                slot,
                x: finite_number(value, "x", path)?,
                y: finite_number(value, "y", path)?,
                target,
                at,
                snap_radius,
            }
        }
        "plan" => {
            closed(value, &["kind", "priority", "timing", "why", "msg"], path)?;
            CallerIntentBody::Plan {
                msg: parse_plan_msg(field(value, "msg", path)?, &format!("{path}.msg"))?,
            }
        }
        "choose" => {
            closed(value, &["kind", "priority", "timing", "why", "msg"], path)?;
            CallerIntentBody::Choose {
                msg: parse_choose_msg(field(value, "msg", path)?, &format!("{path}.msg"))?,
            }
        }
        _ => unreachable!("intent kind list is exhaustive"),
    };
    Ok(CallerIntent {
        body,
        priority,
        timing,
        why,
        raw: sval_to_bval(value),
    })
}

fn parse_declared_module_output(value: &SVal, path: &str) -> R<DeclaredModuleOutput> {
    closed(value, &["intents", "status", "attacking"], path)?;
    let intents_path = format!("{path}.intents");
    let mut intents = Vec::new();
    for (index, row) in array_field(value, "intents", path)?.iter().enumerate() {
        intents.push(parse_caller_intent(
            row,
            &format!("{intents_path}[{index}]"),
        )?);
    }
    let status_value = field(value, "status", path)?;
    let status_path = format!("{path}.status");
    closed(status_value, &["state", "why"], &status_path)?;
    let state = enum_field(
        status_value,
        "state",
        &["running", "done", "blocked", "failed"],
        &status_path,
    )?;
    let why = string_field(status_value, "why", &status_path)?;
    let status = match state.as_str() {
        "running" => GoalStatus::running(why),
        "done" => GoalStatus::done(why),
        "blocked" => GoalStatus::blocked(why),
        _ => GoalStatus::failed(why),
    };
    Ok(DeclaredModuleOutput {
        intents,
        status,
        attacking: bool_field(value, "attacking", path)?,
        raw: sval_to_bval(value),
    })
}

fn parse_adjust_rule(value: &SVal, path: &str) -> R<AdjustRule> {
    let kind = enum_field(value, "kind", &["append", "append-if-why"], path)?;
    let why = match kind.as_str() {
        "append" => {
            closed(value, &["kind", "intents"], path)?;
            None
        }
        _ => {
            closed(value, &["kind", "why", "intents"], path)?;
            Some(string_field(value, "why", path)?)
        }
    };
    let intents_path = format!("{path}.intents");
    let mut intents = Vec::new();
    for (index, row) in array_field(value, "intents", path)?.iter().enumerate() {
        intents.push(parse_caller_intent(
            row,
            &format!("{intents_path}[{index}]"),
        )?);
    }
    let kind = match why {
        None => AdjustKind::Append,
        Some(why) => AdjustKind::AppendIfWhy(why),
    };
    Ok(AdjustRule { kind, intents })
}

fn parse_throws(value: &SVal, hooks: &[&'static str], path: &str) -> R<Vec<ThrowRule>> {
    let mut throws = Vec::new();
    for (index, row) in array_value(value, path)?.iter().enumerate() {
        let row_path = format!("{path}[{index}]");
        closed(row, &["hook", "index"], &row_path)?;
        let hook = string_field(row, "hook", &row_path)?;
        if !hooks.contains(&hook.as_str()) {
            return Err(err(
                &format!("{row_path}.hook"),
                format!("throw hook {hook} is not one of the module's own hooks"),
            ));
        }
        let throw_index = uint_field(row, "index", u64::from(u32::MAX), &row_path)?;
        throws.push(ThrowRule {
            hook,
            index: throw_index,
        });
    }
    Ok(throws)
}

/// The declared hook presence mask (source `Object.keys(module)` function keys, in declaration order).
fn parse_hooks(value: &SVal, path: &str) -> R<Vec<&'static str>> {
    let mut hooks = Vec::new();
    for (index, row) in array_value(value, path)?.iter().enumerate() {
        let hook = string_value(row, &format!("{path}[{index}]"))?;
        let known = HOOK_NAMES
            .iter()
            .copied()
            .find(|name| *name == hook)
            .ok_or_else(|| {
                err(
                    &format!("{path}[{index}]"),
                    format!("unsupported module hook {hook}"),
                )
            })?;
        if hooks.contains(&known) {
            return Err(err(
                &format!("{path}[{index}]"),
                format!("duplicate module hook {known}"),
            ));
        }
        hooks.push(known);
    }
    Ok(hooks)
}

/// A full declared caller module rule (case `modules`); partial per-operation env overrides never carry these.
pub(crate) fn parse_caller_module_decl(
    handle: &str,
    value: &SVal,
    path: &str,
) -> R<CallerModuleDecl> {
    allowed_keys(
        value,
        &[
            "id", "enabled", "hooks", "goals", "intents", "adjust", "throws", "output",
        ],
        path,
    )?;
    require_fields(value, &["id", "enabled", "hooks"], path)?;
    let hooks = parse_hooks(field(value, "hooks", path)?, &format!("{path}.hooks"))?;
    let mut goals = Vec::new();
    if let Some(rule_goals) = optional(value, "goals") {
        let goals_path = format!("{path}.goals");
        for (index, row) in array_value(rule_goals, &goals_path)?.iter().enumerate() {
            goals.push(parse_goal_decision(row, &format!("{goals_path}[{index}]"))?);
        }
    }
    let mut intents = Vec::new();
    if let Some(rule_intents) = optional(value, "intents") {
        let intents_path = format!("{path}.intents");
        for (index, row) in array_value(rule_intents, &intents_path)?.iter().enumerate() {
            intents.push(parse_caller_intent(
                row,
                &format!("{intents_path}[{index}]"),
            )?);
        }
    }
    let output = match optional(value, "output") {
        None => None,
        Some(output) => Some(parse_declared_module_output(
            output,
            &format!("{path}.output"),
        )?),
    };
    let adjust = match optional(value, "adjust") {
        None => None,
        Some(adjust) => Some(parse_adjust_rule(adjust, &format!("{path}.adjust"))?),
    };
    let throws = match optional(value, "throws") {
        None => Vec::new(),
        Some(throws) => parse_throws(throws, &hooks, &format!("{path}.throws"))?,
    };
    Ok(CallerModuleDecl {
        handle: handle.to_string(),
        id: string_field(value, "id", path)?,
        enabled: bool_field(value, "enabled", path)?,
        hooks,
        goals,
        intents,
        output,
        adjust,
        throws,
    })
}

/// One partial per-operation caller env override (source runner `env.modules[handle]`): only the declared rule fields
/// exist; absent rules fall back to the case's full declaration.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ModuleRule {
    pub(crate) goals: Option<Vec<GoalDecision>>,
    pub(crate) intents: Option<Vec<CallerIntent>>,
    pub(crate) adjust: Option<AdjustRule>,
    pub(crate) output: Option<DeclaredModuleOutput>,
}

fn parse_module_rule(value: &SVal, path: &str) -> R<ModuleRule> {
    allowed_keys(value, &["goals", "intents", "adjust", "output"], path)?;
    let mut rule = ModuleRule::default();
    if let Some(goals) = optional(value, "goals") {
        let goals_path = format!("{path}.goals");
        let mut parsed = Vec::new();
        for (index, row) in array_value(goals, &goals_path)?.iter().enumerate() {
            parsed.push(parse_goal_decision(row, &format!("{goals_path}[{index}]"))?);
        }
        rule.goals = Some(parsed);
    }
    if let Some(intents) = optional(value, "intents") {
        let intents_path = format!("{path}.intents");
        let mut parsed = Vec::new();
        for (index, row) in array_value(intents, &intents_path)?.iter().enumerate() {
            parsed.push(parse_caller_intent(
                row,
                &format!("{intents_path}[{index}]"),
            )?);
        }
        rule.intents = Some(parsed);
    }
    if let Some(adjust) = optional(value, "adjust") {
        rule.adjust = Some(parse_adjust_rule(adjust, &format!("{path}.adjust"))?);
    }
    if let Some(output) = optional(value, "output") {
        rule.output = Some(parse_declared_module_output(
            output,
            &format!("{path}.output"),
        )?);
    }
    Ok(rule)
}

// ---------------------------------------------------------------------------------------------------------------------
// Observable op methods and per-operation expected rows.

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum OpMethod {
    Frame {
        budget: String,
    },
    Tick {
        brain: String,
        percept: Percept,
        env: Env,
    },
    Stats,
    Goal,
    End {
        input: Option<RunResult>,
        save: Option<String>,
    },
    SavedSummary {
        key: String,
    },
    Recreate {
        cfg: String,
        brain: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Env {
    pub(crate) modules: Vec<(String, ModuleRule)>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ErrorRow {
    pub(crate) name: String,
    pub(crate) message: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ExpectedBrain {
    pub(crate) goal: BVal,
    pub(crate) stats: BVal,
    pub(crate) memory: Option<BVal>,
    pub(crate) counts: Option<[u64; 3]>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ExpectedService {
    pub(crate) stats: BVal,
    pub(crate) budget: String,
    pub(crate) left: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ExpectedOp {
    pub(crate) result: BVal,
    pub(crate) error: Option<ErrorRow>,
    pub(crate) brains: Vec<(String, ExpectedBrain)>,
    pub(crate) services: Vec<(String, ExpectedService)>,
    pub(crate) trace: BVal,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Operation {
    pub(crate) method: OpMethod,
    /// Source `op.brain ?? "a"`: the active Brain handle for this operation.
    pub(crate) actor: String,
    /// The complete tagged declared source operation object (own-key order preserved): trace/input reconstruction.
    pub(crate) declaration: BVal,
    pub(crate) expected: ExpectedOp,
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolved caller config.

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LearnedConfig {
    pub(crate) enabled: bool,
    /// Ordered bounded learned-bias table. Source-sanitised values may legitimately be non-finite.
    pub(crate) entries: Vec<(String, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ResolvedConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) seed: u32,
    pub(crate) tier: TierParams,
    pub(crate) persona: PersonaParams,
    pub(crate) features: Features,
    pub(crate) map: String,
    pub(crate) budget: String,
    pub(crate) service: String,
    pub(crate) module_handles: Vec<String>,
    pub(crate) learned: LearnedConfig,
    /// Source `derive(seed, tag)` for tags 0..=3 in index order.
    pub(crate) derived_seeds: [u32; 4],
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CaseConfig {
    pub(crate) handle: String,
    /// The frozen runner's declared original-cfg identity ordinal (an expectation, never installed identity state).
    pub(crate) original_cfg_identity: u64,
    /// The frozen runner's declared caller module object identity ordinals (expectations only).
    pub(crate) module_object_identities: Vec<u64>,
    /// The complete tagged declared config object (`encode(c)`), own-key order preserved.
    pub(crate) declaration: BVal,
    pub(crate) resolved: ResolvedConfig,
    /// Declared caller path-service denial/test descriptor (`config.path`), if any.
    pub(crate) path: Option<PathDescriptor>,
    /// Declared room path allowance per frame (`config.pathBudget ?? 8`).
    pub(crate) path_budget: u32,
}

// ---------------------------------------------------------------------------------------------------------------------
// Caller module declarations.

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AdjustRule {
    pub(crate) kind: AdjustKind,
    pub(crate) intents: Vec<CallerIntent>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AdjustKind {
    Append,
    AppendIfWhy(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ThrowRule {
    pub(crate) hook: String,
    pub(crate) index: u64,
}

/// One full declared caller extension module (`case.modules[handle]`): the replay harness's declared caller cell.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CallerModuleDecl {
    pub(crate) handle: String,
    pub(crate) id: String,
    pub(crate) enabled: bool,
    /// The module object's own present hook keys, in declaration order.
    pub(crate) hooks: Vec<&'static str>,
    pub(crate) goals: Vec<GoalDecision>,
    pub(crate) intents: Vec<CallerIntent>,
    pub(crate) output: Option<DeclaredModuleOutput>,
    pub(crate) adjust: Option<AdjustRule>,
    pub(crate) throws: Vec<ThrowRule>,
}

// ---------------------------------------------------------------------------------------------------------------------
// Case.

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Case {
    pub(crate) id: String,
    pub(crate) family: String,
    pub(crate) covers: Vec<String>,
    pub(crate) modules: Vec<CallerModuleDecl>,
    pub(crate) configs: Vec<CaseConfig>,
    /// The setup caller/builtin rows (`case.initialTrace`) as lossless comparison values.
    pub(crate) initial_trace: BVal,
    pub(crate) operations: Vec<Operation>,
    /// Brain handles created during setup, in source creation order.
    pub(crate) brains: Vec<String>,
    /// Caller path-service handles declared during setup, in source creation order.
    pub(crate) services: Vec<String>,
    /// Caller path-budget handles declared during setup, in source creation order.
    pub(crate) budgets: Vec<String>,
}

impl Case {
    pub(crate) fn config(&self, handle: &str) -> R<&CaseConfig> {
        self.configs
            .iter()
            .find(|config| config.handle == handle)
            .ok_or_else(|| format!("case {}: unknown config handle {handle}", self.id))
    }

    pub(crate) fn module(&self, handle: &str) -> R<&CallerModuleDecl> {
        self.modules
            .iter()
            .find(|module| module.handle == handle)
            .ok_or_else(|| format!("case {}: unknown module handle {handle}", self.id))
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Envelope-level declared config validation (the spec-shaped caller config; `resolved` carries the merged result).

const CONFIG_DECL_KEYS: [&str; 15] = [
    "id",
    "name",
    "seed",
    "tier",
    "persona",
    "map",
    "features",
    "modules",
    "service",
    "budget",
    "pathBudget",
    "tierOverrides",
    "personaOverrides",
    "learned",
    "path",
];

const MAP_LABELS: [&str; 8] = [
    "open",
    "wall",
    "detour",
    "ember",
    "bog",
    "ice",
    "light",
    "generated7",
];

fn parse_config_declaration(
    value: &SVal,
    path: &str,
    allowed_handles: &[String],
) -> R<(Option<PathDescriptor>, u32, Vec<String>)> {
    allowed_keys(value, &CONFIG_DECL_KEYS, path)?;
    // Declared finite config numbers, with the source-sanitized learned-entry bias values exempted.
    for (key, member) in object(value, path)? {
        match key.as_str() {
            "learned" => validate_declared_learned(member, &format!("{path}.learned"))?,
            "tierOverrides" => {
                validate_tier_overrides(member, &format!("{path}.tierOverrides"))?;
            }
            "personaOverrides" => {
                validate_persona_overrides(member, &format!("{path}.personaOverrides"))?;
            }
            "features" => validate_feature_overrides(member, &format!("{path}.features"))?,
            "path" => {
                parse_path_descriptor(member, &format!("{path}.path"))?;
            }
            "modules" => {}
            "id" | "name" | "map" | "service" | "budget" => {
                string_value(member, &format!("{path}.{key}"))?;
            }
            "seed" => {
                finite_number_value(member, &format!("{path}.seed"))?;
            }
            "pathBudget" => {
                finite_number_value(member, &format!("{path}.pathBudget"))?;
            }
            "tier" | "persona" => {
                string_value(member, &format!("{path}.{key}"))?;
            }
            other => unreachable!("allowed key list is exhaustive: {other}"),
        }
    }
    if let Some(seed) = optional(value, "seed") {
        let seed = finite_number_value(seed, &format!("{path}.seed"))?;
        if !(seed >= 0. && seed.fract() == 0. && seed <= f64::from(u32::MAX)) {
            return Err(err(
                &format!("{path}.seed"),
                format!("expected a uint32 seed, got {seed}"),
            ));
        }
    }
    if let Some(map) = optional(value, "map") {
        let map = string_value(map, &format!("{path}.map"))?;
        one_of(&map, &MAP_LABELS, &format!("{path}.map"))?;
    }
    if let Some(tier) = optional(value, "tier") {
        let tier = string_value(tier, &format!("{path}.tier"))?;
        one_of(&tier, &["easy", "normal", "hard"], &format!("{path}.tier"))?;
    }
    if let Some(persona) = optional(value, "persona") {
        let persona = string_value(persona, &format!("{path}.persona"))?;
        one_of(
            &persona,
            &["farmer", "hunter", "opportunist", "cautious"],
            &format!("{path}.persona"),
        )?;
    }
    let path_descriptor = match optional(value, "path") {
        None => None,
        Some(path_value) => Some(parse_path_descriptor(path_value, &format!("{path}.path"))?),
    };
    let path_budget = match optional(value, "pathBudget") {
        None => 8,
        Some(budget) => {
            let budget = finite_number_value(budget, &format!("{path}.pathBudget"))?;
            if !(budget >= 0. && budget.fract() == 0. && budget <= f64::from(u32::MAX)) {
                return Err(err(
                    &format!("{path}.pathBudget"),
                    format!("expected a uint32 path allowance, got {budget}"),
                ));
            }
            budget as u32
        }
    };
    let declared_modules = match optional(value, "modules") {
        None => Vec::new(),
        Some(SVal::Str(text)) => {
            if text != "registry" {
                return Err(err(
                    &format!("{path}.modules"),
                    format!("unsupported caller module list token {text}"),
                ));
            }
            Vec::new()
        }
        Some(SVal::Arr(rows)) => {
            let mut handles = Vec::with_capacity(rows.len());
            for (index, row) in rows.iter().enumerate() {
                let handle = string_value(row, &format!("{path}.modules[{index}]"))?;
                if !allowed_handles.iter().any(|allowed| allowed == &handle) {
                    return Err(err(
                        &format!("{path}.modules[{index}]"),
                        format!("unknown caller module handle {handle}"),
                    ));
                }
                handles.push(handle);
            }
            handles
        }
        Some(other) => {
            return Err(err(
                &format!("{path}.modules"),
                format!(
                    "expected the \"registry\" token or an array of module handles, got {}",
                    kind_of(other)
                ),
            ))
        }
    };
    Ok((path_descriptor, path_budget, declared_modules))
}

fn parse_resolved_config(value: &SVal, path: &str, map_labels: &[String]) -> R<ResolvedConfig> {
    closed(
        value,
        &[
            "id",
            "name",
            "seed",
            "tier",
            "persona",
            "features",
            "map",
            "budget",
            "service",
            "moduleHandles",
            "learned",
            "derivedSeeds",
        ],
        path,
    )?;
    let seed_value = finite_number(value, "seed", path)?;
    if !(seed_value >= 0. && seed_value.fract() == 0. && seed_value <= f64::from(u32::MAX)) {
        return Err(err(
            &format!("{path}.seed"),
            format!("expected a uint32 seed, got {seed_value}"),
        ));
    }
    let map = string_field(value, "map", path)?;
    if !map_labels.iter().any(|label| label == &map) {
        return Err(err(
            &format!("{path}.map"),
            format!("unknown source map label {map}"),
        ));
    }
    let learned =
        parse_resolved_learned(field(value, "learned", path)?, &format!("{path}.learned"))?;
    let derived_seeds = parse_derived_seeds(
        field(value, "derivedSeeds", path)?,
        &format!("{path}.derivedSeeds"),
    )?;
    let module_handles = string_array(value, "moduleHandles", path)?;
    Ok(ResolvedConfig {
        id: string_field(value, "id", path)?,
        name: string_field(value, "name", path)?,
        seed: seed_value as u32,
        tier: parse_tier(field(value, "tier", path)?, &format!("{path}.tier"))?,
        persona: parse_persona(field(value, "persona", path)?, &format!("{path}.persona"))?,
        features: parse_features(field(value, "features", path)?, &format!("{path}.features"))?,
        map,
        budget: string_field(value, "budget", path)?,
        service: string_field(value, "service", path)?,
        module_handles,
        learned,
        derived_seeds,
    })
}

fn parse_resolved_learned(value: &SVal, path: &str) -> R<LearnedConfig> {
    closed(value, &["kind", "enabled", "entries"], path)?;
    let kind = string_field(value, "kind", path)?;
    if kind != "argument-sensitive-immutable-table" {
        return Err(err(
            &format!("{path}.kind"),
            format!("unsupported resolved learned surface kind {kind}"),
        ));
    }
    let enabled = bool_field(value, "enabled", path)?;
    let mut entries = Vec::new();
    let entries_path = format!("{path}.entries");
    for (index, row) in array_field(value, "entries", path)?.iter().enumerate() {
        let pair_path = format!("{entries_path}[{index}]");
        let pair = array_value(row, &pair_path)?;
        if pair.len() != 2 {
            return Err(err(&pair_path, "learned entry must be a [key,bias] pair"));
        }
        let key = string_value(&pair[0], &format!("{pair_path}[0]"))?;
        let bias = match &pair[1] {
            SVal::Num(number) => *number,
            other => {
                return Err(err(
                    &format!("{pair_path}[1]"),
                    format!("expected a number, got {}", kind_of(other)),
                ))
            }
        };
        entries.push((key, bias));
    }
    Ok(LearnedConfig { enabled, entries })
}

fn parse_derived_seeds(value: &SVal, path: &str) -> R<[u32; 4]> {
    let entries = object(value, path)?;
    if entries.len() != 4 {
        return Err(err(
            path,
            format!("expected the four derived seeds, got {}", entries.len()),
        ));
    }
    let mut seeds = [0u32; 4];
    let mut seen = [false; 4];
    for (key, member) in entries {
        let index: usize = key.parse().map_err(|_| {
            err(
                path,
                format!("expected derived seed tag key 0..=3, got {key:?}"),
            )
        })?;
        if index > 3 || seen[index] {
            return Err(err(path, format!("unexpected derived seed tag key {key}")));
        }
        seen[index] = true;
        let seed = finite_number_value(member, &format!("{path}.{key}"))?;
        if !(seed >= 0. && seed.fract() == 0. && seed <= f64::from(u32::MAX)) {
            return Err(err(
                &format!("{path}.{key}"),
                format!("expected a uint32 derived seed, got {seed}"),
            ));
        }
        seeds[index] = seed as u32;
    }
    Ok(seeds)
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen expected trace rows. Rows are ordinary JSON records (own-key order is not semantically significant in the
// source `assert.deepEqual` policy, but the frozen writer's canonical field order is reproduced here so the lossless
// comparison values match the recorder's source-order rows). Nested declared values stay tagged and are decoded with
// the diagnostic-allowed codec (callable/instance never occur for a frozen expected row).

const CALLBACK_NAMES: [&str; 13] = [
    "budget.startTick",
    "paths.setFrame",
    "paths.walk",
    "paths.path",
    "paths.los",
    "paths.clear",
    "paths.collisionMap",
    "services.log",
    "learned.bias",
    "knowledge.factionEdge",
    "knowledge.weaponEdge",
    "knowledge.mobShare",
    "knowledge.odds",
];
const MEMORY_SNAPSHOT_KEYS: [&str; 8] = [
    "fighters",
    "mobs",
    "camps",
    "containers",
    "self",
    "stimuli",
    "bounties",
    "choices",
];
const CONTEXT_KEYS: [&str; 7] = [
    "cfgIdentity",
    "originalCfg",
    "percept",
    "memory",
    "engaged",
    "rngIdentity",
    "knowledgeIdentity",
];

fn json_object<'a>(value: &'a Value, path: &str) -> R<&'a serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| err(path, "expected an ordinary JSON record"))
}

fn json_allowed(object: &serde_json::Map<String, Value>, allowed: &[&str], path: &str) -> R<()> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported trace row field {key}")));
        }
    }
    Ok(())
}

fn json_required(object: &serde_json::Map<String, Value>, required: &[&str], path: &str) -> R<()> {
    for key in required {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing trace row field {key}")));
        }
    }
    Ok(())
}

fn json_str<'a>(object: &'a serde_json::Map<String, Value>, key: &str, path: &str) -> R<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, format!("expected the string field {key}")))
}

fn json_bool(object: &serde_json::Map<String, Value>, key: &str, path: &str) -> R<bool> {
    object
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| err(path, format!("expected the bool field {key}")))
}

fn json_uint(object: &serde_json::Map<String, Value>, key: &str, path: &str) -> R<u64> {
    let number = object
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| err(path, format!("expected the number field {key}")))?;
    if !number.is_finite() || number < 0. || number.fract() != 0. || number > u64::MAX as f64 {
        return Err(err(
            path,
            format!("expected a non-negative integer field {key}, got {number}"),
        ));
    }
    Ok(number as u64)
}

fn json_number(object: &serde_json::Map<String, Value>, key: &str, path: &str) -> R<f64> {
    let number = object
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| err(path, format!("expected the number field {key}")))?;
    if !number.is_finite() {
        return Err(err(
            path,
            format!("expected a finite number field {key}, got {number}"),
        ));
    }
    Ok(number)
}

fn tagged_field(object: &serde_json::Map<String, Value>, key: &str, path: &str) -> R<BVal> {
    let value = object
        .get(key)
        .ok_or_else(|| err(path, format!("missing tagged row field {key}")))?;
    let decoded = decode_diagnostic(value, &format!("{path}.{key}"))?;
    Ok(sval_to_bval(&decoded))
}

/// The frozen memory snapshot (`codec.mts memorySnapshot`): exactly the eight live Memory view rows in source order.
fn parse_memory_snapshot(value: &SVal, path: &str) -> R<BVal> {
    let entries = object(value, path)?;
    if entries.len() != MEMORY_SNAPSHOT_KEYS.len() {
        return Err(err(
            path,
            format!(
                "expected the eight Memory snapshot rows, got {}",
                entries.len()
            ),
        ));
    }
    let mut fields = Vec::with_capacity(entries.len());
    for (index, (key, member)) in entries.iter().enumerate() {
        if key != MEMORY_SNAPSHOT_KEYS[index] {
            return Err(err(
                path,
                format!(
                    "Memory snapshot row {index} must be {}, got {key}",
                    MEMORY_SNAPSHOT_KEYS[index]
                ),
            ));
        }
        match member {
            SVal::Undefined | SVal::Null | SVal::Bool(_) | SVal::Str(_) | SVal::Num(_) => {}
            SVal::Arr(_)
            | SVal::Obj(_)
            | SVal::Map(_)
            | SVal::Set(_)
            | SVal::U8(_)
            | SVal::Instance { .. }
            | SVal::Callable => {}
        }
        fields.push((key.clone(), sval_to_bval(member)));
    }
    Ok(BVal::Obj(fields))
}

fn parse_memory_snapshot_field(
    object: &serde_json::Map<String, Value>,
    key: &str,
    path: &str,
) -> R<BVal> {
    let value = object
        .get(key)
        .ok_or_else(|| err(path, format!("missing memory snapshot field {key}")))?;
    let decoded = decode_diagnostic(value, &format!("{path}.{key}"))?;
    parse_memory_snapshot(&decoded, &format!("{path}.{key}"))
}

fn parse_trace_context(value: &Value, path: &str) -> R<BVal> {
    let object = json_object(value, path)?;
    json_allowed(object, &CONTEXT_KEYS, path)?;
    json_required(object, &CONTEXT_KEYS, path)?;
    let cfg_identity = json_uint(object, "cfgIdentity", path)?;
    let original_cfg = json_bool(object, "originalCfg", path)?;
    let percept = {
        let raw = object
            .get("percept")
            .ok_or_else(|| err(path, "missing context percept"))?;
        let decoded = decode_diagnostic(raw, &format!("{path}.percept"))?;
        validate_percept(&decoded, &format!("{path}.percept"))?;
        sval_to_bval(&decoded)
    };
    let memory = parse_memory_snapshot_field(object, "memory", path)?;
    let engaged = json_bool(object, "engaged", path)?;
    let rng_identity = json_uint(object, "rngIdentity", path)?;
    let knowledge_identity = json_uint(object, "knowledgeIdentity", path)?;
    Ok(BVal::Obj(vec![
        ("cfgIdentity".into(), BVal::Num(cfg_identity as f64)),
        ("originalCfg".into(), BVal::Bool(original_cfg)),
        ("percept".into(), percept),
        ("memory".into(), memory),
        ("engaged".into(), BVal::Bool(engaged)),
        ("rngIdentity".into(), BVal::Num(rng_identity as f64)),
        (
            "knowledgeIdentity".into(),
            BVal::Num(knowledge_identity as f64),
        ),
    ]))
}

fn parse_rng_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(
        object,
        &["kind", "actor", "stream", "index", "value", "sequence"],
        path,
    )?;
    json_required(
        object,
        &["kind", "actor", "stream", "index", "value", "sequence"],
        path,
    )?;
    let actor = json_str(object, "actor", path)?.to_string();
    let stream = {
        let stream = json_str(object, "stream", path)?;
        one_of(
            stream,
            &["decide", "motor", "lapse"],
            &format!("{path}.stream"),
        )?
    };
    let index = json_uint(object, "index", path)?;
    let value = json_number(object, "value", path)?;
    if !(0. ..1.).contains(&value) {
        return Err(err(
            &format!("{path}.value"),
            format!("runtime draw {value} is outside [0,1)"),
        ));
    }
    let sequence = json_uint(object, "sequence", path)?;
    Ok(BVal::Obj(vec![
        ("kind".into(), BVal::text("rng")),
        ("actor".into(), BVal::text(actor)),
        ("stream".into(), BVal::text(stream)),
        ("index".into(), BVal::Num(index as f64)),
        ("value".into(), BVal::Num(value)),
        ("sequence".into(), BVal::Num(sequence as f64)),
    ]))
}

fn parse_observe_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(
        object,
        &[
            "kind",
            "actor",
            "cfgIdentity",
            "originalCfg",
            "rngIdentity",
            "moduleIdentities",
            "engaged",
            "memory",
            "sequence",
        ],
        path,
    )?;
    json_required(
        object,
        &[
            "kind",
            "actor",
            "cfgIdentity",
            "originalCfg",
            "rngIdentity",
            "moduleIdentities",
            "engaged",
            "memory",
            "sequence",
        ],
        path,
    )?;
    let actor = json_str(object, "actor", path)?.to_string();
    let cfg_identity = json_uint(object, "cfgIdentity", path)?;
    let original_cfg = json_bool(object, "originalCfg", path)?;
    let rng_identity = json_uint(object, "rngIdentity", path)?;
    let module_identities = {
        let rows = object
            .get("moduleIdentities")
            .and_then(Value::as_array)
            .ok_or_else(|| err(&format!("{path}.moduleIdentities"), "expected an array"))?;
        let mut identities = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            let number = row.as_f64().ok_or_else(|| {
                err(
                    &format!("{path}.moduleIdentities[{index}]"),
                    "expected an identity number",
                )
            })?;
            if !number.is_finite() || number < 0. || number.fract() != 0. {
                return Err(err(
                    &format!("{path}.moduleIdentities[{index}]"),
                    "expected a non-negative integer identity",
                ));
            }
            identities.push(BVal::Num(number));
        }
        BVal::Arr(identities)
    };
    let engaged = json_bool(object, "engaged", path)?;
    let memory = parse_memory_snapshot_field(object, "memory", path)?;
    let sequence = json_uint(object, "sequence", path)?;
    Ok(BVal::Obj(vec![
        ("kind".into(), BVal::text("observe")),
        ("actor".into(), BVal::text(actor)),
        ("cfgIdentity".into(), BVal::Num(cfg_identity as f64)),
        ("originalCfg".into(), BVal::Bool(original_cfg)),
        ("rngIdentity".into(), BVal::Num(rng_identity as f64)),
        ("moduleIdentities".into(), module_identities),
        ("engaged".into(), BVal::Bool(engaged)),
        ("memory".into(), memory),
        ("sequence".into(), BVal::Num(sequence as f64)),
    ]))
}

fn parse_retained_memory_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(object, &["kind", "actor", "lastHitAt", "sequence"], path)?;
    json_required(object, &["kind", "actor", "lastHitAt", "sequence"], path)?;
    let actor = json_str(object, "actor", path)?.to_string();
    let last_hit_at = {
        let value = object
            .get("lastHitAt")
            .ok_or_else(|| err(path, "missing lastHitAt"))?;
        let decoded = decode_diagnostic(value, &format!("{path}.lastHitAt"))?;
        match &decoded {
            SVal::Null | SVal::Undefined => {}
            SVal::Num(number) if number.is_finite() => {}
            other => {
                return Err(err(
                    &format!("{path}.lastHitAt"),
                    format!(
                        "expected the retained lastHitAt clock, got {}",
                        kind_of(other)
                    ),
                ))
            }
        }
        sval_to_bval(&decoded)
    };
    let sequence = json_uint(object, "sequence", path)?;
    Ok(BVal::Obj(vec![
        ("kind".into(), BVal::text("retainedMemoryBeforeFrame")),
        ("actor".into(), BVal::text(actor)),
        ("lastHitAt".into(), last_hit_at),
        ("sequence".into(), BVal::Num(sequence as f64)),
    ]))
}

fn parse_caller_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    let name = json_str(object, "name", path)?.to_string();
    let sequence = object
        .get("sequence")
        .and_then(Value::as_u64)
        .ok_or_else(|| err(path, "missing sequence"))?;
    match name.as_str() {
        "createPathBudget" => {
            json_allowed(
                object,
                &["kind", "name", "handle", "perTick", "sequence"],
                path,
            )?;
            json_required(
                object,
                &["kind", "name", "handle", "perTick", "sequence"],
                path,
            )?;
            let handle = json_str(object, "handle", path)?.to_string();
            let per_tick = json_uint(object, "perTick", path)?;
            Ok(BVal::Obj(vec![
                ("kind".into(), BVal::text("caller")),
                ("name".into(), BVal::text("createPathBudget")),
                ("handle".into(), BVal::text(handle)),
                ("perTick".into(), BVal::Num(per_tick as f64)),
                ("sequence".into(), BVal::Num(sequence as f64)),
            ]))
        }
        "createPathService" => {
            json_allowed(
                object,
                &["kind", "name", "handle", "budget", "map", "sequence"],
                path,
            )?;
            json_required(
                object,
                &["kind", "name", "handle", "budget", "map", "sequence"],
                path,
            )?;
            let handle = json_str(object, "handle", path)?.to_string();
            let budget = json_str(object, "budget", path)?.to_string();
            let map = json_str(object, "map", path)?.to_string();
            one_of(&map, &MAP_LABELS, &format!("{path}.map"))?;
            Ok(BVal::Obj(vec![
                ("kind".into(), BVal::text("caller")),
                ("name".into(), BVal::text("createPathService")),
                ("handle".into(), BVal::text(handle)),
                ("budget".into(), BVal::text(budget)),
                ("map".into(), BVal::text(map)),
                ("sequence".into(), BVal::Num(sequence as f64)),
            ]))
        }
        "enabledModules" => {
            json_allowed(
                object,
                &["kind", "name", "features", "handles", "sequence"],
                path,
            )?;
            json_required(
                object,
                &["kind", "name", "features", "handles", "sequence"],
                path,
            )?;
            let features = {
                let value = object
                    .get("features")
                    .ok_or_else(|| err(path, "missing enabledModules features"))?;
                let decoded = decode_diagnostic(value, &format!("{path}.features"))?;
                parse_features(&decoded, &format!("{path}.features"))?;
                sval_to_bval(&decoded)
            };
            let handles = {
                // The frozen runner emits `handles` as an ordinary JSON array (only `features` is tagged there).
                let value = object
                    .get("handles")
                    .ok_or_else(|| err(path, "missing enabledModules handles"))?;
                let rows = value.as_array().ok_or_else(|| {
                    err(
                        &format!("{path}.handles"),
                        "expected the caller handle array",
                    )
                })?;
                let mut handles = Vec::with_capacity(rows.len());
                for (index, row) in rows.iter().enumerate() {
                    handles.push(BVal::text(row.as_str().ok_or_else(|| {
                        err(
                            &format!("{path}.handles[{index}]"),
                            "expected a caller module handle string",
                        )
                    })?));
                }
                BVal::Arr(handles)
            };
            Ok(BVal::Obj(vec![
                ("kind".into(), BVal::text("caller")),
                ("name".into(), BVal::text("enabledModules")),
                ("features".into(), features),
                ("handles".into(), handles),
                ("sequence".into(), BVal::Num(sequence as f64)),
            ]))
        }
        "createBrain" => {
            json_allowed(object, &["kind", "name", "cfg", "handle", "sequence"], path)?;
            json_required(object, &["kind", "name", "cfg", "handle", "sequence"], path)?;
            let cfg = json_str(object, "cfg", path)?.to_string();
            let handle = json_str(object, "handle", path)?.to_string();
            Ok(BVal::Obj(vec![
                ("kind".into(), BVal::text("caller")),
                ("name".into(), BVal::text("createBrain")),
                ("cfg".into(), BVal::text(cfg)),
                ("handle".into(), BVal::text(handle)),
                ("sequence".into(), BVal::Num(sequence as f64)),
            ]))
        }
        other => Err(err(path, format!("unsupported caller trace row {other}"))),
    }
}

fn parse_builtin_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(
        object,
        &[
            "kind",
            "actor",
            "handle",
            "hook",
            "args",
            "context",
            "sequence",
            "result",
            "error",
            "returnedInput",
        ],
        path,
    )?;
    let actor = json_str(object, "actor", path)?.to_string();
    let handle = one_of(
        json_str(object, "handle", path)?,
        &BUILTIN_MODULE_HANDLES,
        &format!("{path}.handle"),
    )?;
    let hook = one_of(
        json_str(object, "hook", path)?,
        &HOOK_NAMES,
        &format!("{path}.hook"),
    )?;
    let sequence = json_uint(object, "sequence", path)?;
    if !object.contains_key("args") {
        return Err(err(path, "missing trace row field args"));
    }
    let args = tagged_field(object, "args", path)?;
    let context = match object.get("context") {
        None => None,
        Some(value) => Some(parse_trace_context(value, &format!("{path}.context"))?),
    };
    if hook == "enabled" && context.is_some() {
        return Err(err(
            &format!("{path}.context"),
            "the source enabled hook receives no Brain context",
        ));
    }
    if hook != "enabled" && context.is_none() {
        return Err(err(path, "missing trace row field context"));
    }
    let returned_input = match object.get("returnedInput") {
        None => None,
        Some(value) => Some(
            value
                .as_bool()
                .ok_or_else(|| err(&format!("{path}.returnedInput"), "expected a bool"))?,
        ),
    };
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    if has_result == has_error {
        return Err(err(
            path,
            "a builtin hook row must own exactly one of result|error",
        ));
    }
    let mut fields = vec![
        ("kind".to_owned(), BVal::text("builtin")),
        ("actor".to_owned(), BVal::text(actor)),
        ("handle".to_owned(), BVal::text(handle)),
        ("hook".to_owned(), BVal::text(hook)),
        ("args".to_owned(), args),
    ];
    if let Some(context) = context {
        fields.push(("context".to_owned(), context));
    }
    fields.push(("sequence".to_owned(), BVal::Num(sequence as f64)));
    if has_result {
        fields.push(("result".to_owned(), tagged_field(object, "result", path)?));
    } else {
        let error = object
            .get("error")
            .ok_or_else(|| err(path, "missing error"))?;
        let error_object = json_object(error, &format!("{path}.error"))?;
        json_allowed(error_object, &["name", "message"], &format!("{path}.error"))?;
        json_required(error_object, &["name", "message"], &format!("{path}.error"))?;
        fields.push((
            "error".to_owned(),
            BVal::Obj(vec![
                (
                    "name".to_owned(),
                    BVal::text(json_str(error_object, "name", &format!("{path}.error"))?),
                ),
                (
                    "message".to_owned(),
                    BVal::text(json_str(error_object, "message", &format!("{path}.error"))?),
                ),
            ]),
        ));
    }
    if let Some(returned_input) = returned_input {
        fields.push(("returnedInput".to_owned(), BVal::Bool(returned_input)));
    }
    Ok(BVal::Obj(fields))
}

fn parse_module_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(
        object,
        &[
            "kind",
            "actor",
            "handle",
            "id",
            "hook",
            "index",
            "args",
            "now",
            "engaged",
            "cfgIdentity",
            "sequence",
            "result",
            "error",
            "listIdentity",
            "returnedInput",
            "resultIdentity",
        ],
        path,
    )?;
    json_required(
        object,
        &[
            "kind", "actor", "handle", "id", "hook", "index", "args", "sequence",
        ],
        path,
    )?;
    let actor = json_str(object, "actor", path)?.to_string();
    let handle = {
        let handle = json_str(object, "handle", path)?;
        if handle.is_empty() {
            return Err(err(&format!("{path}.handle"), "empty module handle"));
        }
        handle.to_string()
    };
    let id = json_str(object, "id", path)?.to_string();
    let hook = one_of(
        json_str(object, "hook", path)?,
        &HOOK_NAMES,
        &format!("{path}.hook"),
    )?;
    let index = json_uint(object, "index", path)?;
    let args = tagged_field(object, "args", path)?;
    let sequence = json_uint(object, "sequence", path)?;
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    if has_result == has_error {
        return Err(err(
            path,
            "a declared module hook row must own exactly one of result|error",
        ));
    }
    let mut fields = vec![
        ("kind".to_owned(), BVal::text("module")),
        ("actor".to_owned(), BVal::text(actor)),
        ("handle".to_owned(), BVal::text(handle)),
        ("id".to_owned(), BVal::text(id)),
        ("hook".to_owned(), BVal::text(hook.clone())),
        ("index".to_owned(), BVal::Num(index as f64)),
        ("args".to_owned(), args),
    ];
    let context_present = object.contains_key("now");
    if hook == "enabled" {
        if context_present {
            return Err(err(
                &format!("{path}.now"),
                "the source enabled hook receives no Brain context",
            ));
        }
    } else {
        if !context_present
            || !object.contains_key("engaged")
            || !object.contains_key("cfgIdentity")
        {
            return Err(err(
                path,
                "a declared non-enabled hook row owns now/engaged/cfgIdentity",
            ));
        }
        let now = json_number(object, "now", path)?;
        let engaged = json_bool(object, "engaged", path)?;
        let cfg_identity = json_uint(object, "cfgIdentity", path)?;
        fields.push(("now".to_owned(), BVal::Num(now)));
        fields.push(("engaged".to_owned(), BVal::Bool(engaged)));
        fields.push(("cfgIdentity".to_owned(), BVal::Num(cfg_identity as f64)));
    }
    fields.push(("sequence".to_owned(), BVal::Num(sequence as f64)));
    if hook == "adjust" && has_result {
        let list_identity = json_uint(object, "listIdentity", path)?;
        let returned_input = json_bool(object, "returnedInput", path)?;
        let result_identity = json_uint(object, "resultIdentity", path)?;
        fields.push(("listIdentity".to_owned(), BVal::Num(list_identity as f64)));
        fields.push(("returnedInput".to_owned(), BVal::Bool(returned_input)));
        fields.push((
            "resultIdentity".to_owned(),
            BVal::Num(result_identity as f64),
        ));
    }
    if has_result {
        fields.push(("result".to_owned(), tagged_field(object, "result", path)?));
    } else {
        let error = object.get("error").and_then(Value::as_str).ok_or_else(|| {
            err(
                &format!("{path}.error"),
                "a declared module hook error is a source string",
            )
        })?;
        fields.push(("error".to_owned(), BVal::text(error)));
    }
    Ok(BVal::Obj(fields))
}

fn parse_callback_row(object: &serde_json::Map<String, Value>, path: &str) -> R<BVal> {
    json_allowed(
        object,
        &[
            "kind", "actor", "name", "args", "service", "sequence", "result", "error",
        ],
        path,
    )?;
    json_required(object, &["kind", "actor", "name", "args", "sequence"], path)?;
    let actor = json_str(object, "actor", path)?.to_string();
    let name = one_of(
        json_str(object, "name", path)?,
        &CALLBACK_NAMES,
        &format!("{path}.name"),
    )?;
    let args = tagged_field(object, "args", path)?;
    let sequence = json_uint(object, "sequence", path)?;
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    if has_result == has_error {
        return Err(err(
            path,
            "a callback row must own exactly one of result|error",
        ));
    }
    let service = match object.get("service") {
        None => None,
        Some(value) => Some(
            value
                .as_str()
                .ok_or_else(|| err(&format!("{path}.service"), "expected a service handle"))?
                .to_string(),
        ),
    };
    if name.starts_with("paths.") && service.is_none() {
        return Err(err(
            path,
            "a path-service callback row owns its service handle",
        ));
    }
    if !name.starts_with("paths.") && service.is_some() {
        return Err(err(
            &format!("{path}.service"),
            "only path-service callback rows own a service handle",
        ));
    }
    let mut fields = vec![
        ("kind".to_owned(), BVal::text("callback")),
        ("actor".to_owned(), BVal::text(actor)),
        ("name".to_owned(), BVal::text(name)),
        ("args".to_owned(), args),
    ];
    if let Some(service) = service {
        fields.push(("service".to_owned(), BVal::text(service)));
    }
    fields.push(("sequence".to_owned(), BVal::Num(sequence as f64)));
    if has_result {
        fields.push(("result".to_owned(), tagged_field(object, "result", path)?));
    } else {
        let error = object
            .get("error")
            .ok_or_else(|| err(path, "missing error"))?;
        let error_object = json_object(error, &format!("{path}.error"))?;
        json_allowed(error_object, &["name", "message"], &format!("{path}.error"))?;
        json_required(error_object, &["name", "message"], &format!("{path}.error"))?;
        fields.push((
            "error".to_owned(),
            BVal::Obj(vec![
                (
                    "name".to_owned(),
                    BVal::text(json_str(error_object, "name", &format!("{path}.error"))?),
                ),
                (
                    "message".to_owned(),
                    BVal::text(json_str(error_object, "message", &format!("{path}.error"))?),
                ),
            ]),
        ));
    }
    Ok(BVal::Obj(fields))
}

/// Parse one frozen expected trace array with contiguous sequence values and per-kind closed row grammars.
pub(crate) fn parse_expected_trace(value: &Value, path: &str) -> R<BVal> {
    let rows = value
        .as_array()
        .ok_or_else(|| err(path, "expected the frozen trace row array"))?;
    let mut out = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let row_path = format!("{path}[{index}]");
        let object = json_object(row, &row_path)?;
        let kind = json_str(object, "kind", &row_path)?;
        if !TRACE_KINDS.contains(&kind) {
            return Err(err(
                &format!("{row_path}.kind"),
                format!("unsupported trace row kind {kind}"),
            ));
        }
        let sequence = object
            .get("sequence")
            .and_then(Value::as_u64)
            .ok_or_else(|| err(&row_path, "missing sequence"))?;
        if sequence != index as u64 {
            return Err(err(
                &format!("{row_path}.sequence"),
                format!("expected contiguous sequence {index}, got {sequence}"),
            ));
        }
        let parsed = match kind {
            "caller" => parse_caller_row(object, &row_path)?,
            "builtin" => parse_builtin_row(object, &row_path)?,
            "module" => parse_module_row(object, &row_path)?,
            "callback" => parse_callback_row(object, &row_path)?,
            "observe" => parse_observe_row(object, &row_path)?,
            "rng" => parse_rng_row(object, &row_path)?,
            _ => parse_retained_memory_row(object, &row_path)?,
        };
        out.push(parsed);
    }
    Ok(BVal::Arr(out))
}

// ---------------------------------------------------------------------------------------------------------------------
// Expected operation rows.

fn parse_expected_brain(value: &Value, path: &str) -> R<ExpectedBrain> {
    let object = json_object(value, path)?;
    json_allowed(object, &["goal", "stats", "memory", "counts"], path)?;
    json_required(object, &["goal", "stats", "memory", "counts"], path)?;
    let goal = tagged_field(object, "goal", path)?;
    let stats = tagged_field(object, "stats", path)?;
    let memory = match object.get("memory") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let decoded = decode_diagnostic(value, &format!("{path}.memory"))?;
            let snapshot = parse_memory_snapshot(&decoded, &format!("{path}.memory"))?;
            Some(snapshot)
        }
    };
    let counts = match object.get("counts") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let counts_path = format!("{path}.counts");
            let counts_object = json_object(value, &counts_path)?;
            json_allowed(counts_object, &["decide", "motor", "lapse"], &counts_path)?;
            json_required(counts_object, &["decide", "motor", "lapse"], &counts_path)?;
            Some([
                json_uint(counts_object, "decide", &counts_path)?,
                json_uint(counts_object, "motor", &counts_path)?,
                json_uint(counts_object, "lapse", &counts_path)?,
            ])
        }
    };
    if memory.is_some() != counts.is_some() {
        return Err(err(
            path,
            "a live Brain snapshot owns both memory and runtime counts, or neither",
        ));
    }
    Ok(ExpectedBrain {
        goal,
        stats,
        memory,
        counts,
    })
}

fn parse_expected_service(value: &Value, path: &str) -> R<ExpectedService> {
    let object = json_object(value, path)?;
    json_allowed(object, &["stats", "budget", "left"], path)?;
    json_required(object, &["stats", "budget", "left"], path)?;
    let left = json_uint(object, "left", path)?;
    if left > u64::from(u32::MAX) {
        return Err(err(
            &format!("{path}.left"),
            "path allowance left exceeds u32",
        ));
    }
    Ok(ExpectedService {
        stats: tagged_field(object, "stats", path)?,
        budget: json_str(object, "budget", path)?.to_string(),
        left: left as u32,
    })
}

fn parse_expected_op(value: &Value, path: &str, _declaration: BVal) -> R<ExpectedOp> {
    let object = json_object(value, path)?;
    json_allowed(
        object,
        &[
            "method",
            "declaration",
            "result",
            "error",
            "brains",
            "services",
            "trace",
        ],
        path,
    )?;
    json_required(
        object,
        &[
            "method",
            "declaration",
            "result",
            "brains",
            "services",
            "trace",
        ],
        path,
    )?;
    let method = json_str(object, "method", path)?.to_string();
    one_of(
        &method,
        &[
            "frame",
            "tick",
            "stats",
            "goal",
            "end",
            "savedSummary",
            "recreate",
        ],
        &format!("{path}.method"),
    )?;
    // The expected row's declaration is the same declared source operation object; it is never a separate input.
    let declared_result = object
        .get("declaration")
        .ok_or_else(|| err(path, "missing declaration"))?;
    if declared_result.is_null() {
        return Err(err(&format!("{path}.declaration"), "missing declaration"));
    }
    let result = tagged_field(object, "result", path)?;
    let error = match object.get("error") {
        None => None,
        Some(value) => {
            let error_path = format!("{path}.error");
            let error_object = json_object(value, &error_path)?;
            json_allowed(error_object, &["name", "message"], &error_path)?;
            json_required(error_object, &["name", "message"], &error_path)?;
            Some(ErrorRow {
                name: json_str(error_object, "name", &error_path)?.to_string(),
                message: json_str(error_object, "message", &error_path)?.to_string(),
            })
        }
    };
    let brains = {
        let value = object
            .get("brains")
            .ok_or_else(|| err(path, "missing brains"))?;
        let brains_path = format!("{path}.brains");
        let brains_object = json_object(value, &brains_path)?;
        let mut rows = Vec::with_capacity(brains_object.len());
        for (handle, row) in brains_object {
            if handle.is_empty() {
                return Err(err(&brains_path, "empty Brain handle"));
            }
            rows.push((
                handle.clone(),
                parse_expected_brain(row, &format!("{brains_path}.{handle}"))?,
            ));
        }
        rows
    };
    let services = {
        let value = object
            .get("services")
            .ok_or_else(|| err(path, "missing services"))?;
        let services_path = format!("{path}.services");
        let services_object = json_object(value, &services_path)?;
        let mut rows = Vec::with_capacity(services_object.len());
        for (handle, row) in services_object {
            if handle.is_empty() {
                return Err(err(&services_path, "empty service handle"));
            }
            rows.push((
                handle.clone(),
                parse_expected_service(row, &format!("{services_path}.{handle}"))?,
            ));
        }
        rows
    };
    let trace = {
        let value = object
            .get("trace")
            .ok_or_else(|| err(path, "missing trace"))?;
        parse_expected_trace(value, &format!("{path}.trace"))?
    };
    Ok(ExpectedOp {
        result,
        error,
        brains,
        services,
        trace,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared operation parsing.

fn parse_run_result(value: &SVal, path: &str) -> R<RunResult> {
    closed(value, &["outcome", "place", "players"], path)?;
    Ok(RunResult {
        outcome: enum_field(value, "outcome", &["won", "draw", "died", "mia"], path)?,
        place: finite_number(value, "place", path)?,
        players: finite_number(value, "players", path)?,
    })
}

fn parse_env(value: &SVal, path: &str, case_modules: &[String]) -> R<Env> {
    allowed_keys(value, &["modules"], path)?;
    let mut env = Env::default();
    if let Some(modules) = optional(value, "modules") {
        let modules_path = format!("{path}.modules");
        for (handle, rule) in object(modules, &modules_path)? {
            if !case_modules.iter().any(|known| known == handle) {
                return Err(err(
                    &modules_path,
                    format!("unknown caller module env handle {handle}"),
                ));
            }
            env.modules.push((
                handle.clone(),
                parse_module_rule(rule, &format!("{modules_path}.{handle}"))?,
            ));
        }
    }
    Ok(env)
}

struct OperationLinks<'a> {
    configs: &'a [String],
    brains: &'a [String],
    modules: &'a [String],
    budgets: &'a [String],
}

fn parse_operation(value: &Value, path: &str, links: &OperationLinks<'_>) -> R<Operation> {
    let declaration_value = value
        .get("declaration")
        .ok_or_else(|| err(&format!("{path}.declaration"), "missing declaration"))?;
    let declaration = decode_input(declaration_value, &format!("{path}.declaration"))?;
    object(&declaration, &format!("{path}.declaration"))?;
    let method = string_field(&declaration, "method", &format!("{path}.declaration"))?;
    let method = one_of(
        &method,
        &[
            "frame",
            "tick",
            "stats",
            "goal",
            "end",
            "savedSummary",
            "recreate",
        ],
        &format!("{path}.declaration.method"),
    )?;
    let declared_brain = match optional(&declaration, "brain") {
        None | Some(SVal::Null) => None,
        Some(SVal::Str(brain)) => Some(brain.clone()),
        Some(SVal::Undefined) => None,
        Some(other) => {
            return Err(err(
                &format!("{path}.declaration.brain"),
                format!("expected a Brain handle string, got {}", kind_of(other)),
            ))
        }
    };
    let actor = declared_brain.clone().unwrap_or_else(|| "a".to_string());
    if !links.brains.iter().any(|handle| handle == &actor) {
        return Err(err(
            &format!("{path}.declaration.brain"),
            format!("unknown Brain handle {actor}"),
        ));
    }
    let method = match method.as_str() {
        "frame" => {
            closed(
                &declaration,
                &["method", "budget"],
                &format!("{path}.declaration"),
            )?;
            let budget = string_field(&declaration, "budget", &format!("{path}.declaration"))?;
            if !links.budgets.iter().any(|handle| handle == &budget) {
                return Err(err(
                    &format!("{path}.declaration.budget"),
                    format!("unknown path allowance budget handle {budget}"),
                ));
            }
            OpMethod::Frame { budget }
        }
        "tick" => {
            closed(
                &declaration,
                &["method", "brain", "input", "env"],
                &format!("{path}.declaration"),
            )?;
            let brain = declared_brain.clone().ok_or_else(|| {
                err(
                    &format!("{path}.declaration.brain"),
                    "a declared tick names its Brain handle",
                )
            })?;
            let percept = build_percept(
                field(&declaration, "input", &format!("{path}.declaration"))?,
                &format!("{path}.declaration.input"),
            )?;
            let env = parse_env(
                field(&declaration, "env", &format!("{path}.declaration"))?,
                &format!("{path}.declaration.env"),
                links.modules,
            )?;
            OpMethod::Tick {
                brain,
                percept,
                env,
            }
        }
        "stats" => {
            closed(&declaration, &["method"], &format!("{path}.declaration"))?;
            OpMethod::Stats
        }
        "goal" => {
            closed(&declaration, &["method"], &format!("{path}.declaration"))?;
            OpMethod::Goal
        }
        "end" => {
            // `save` is optional (only present on the declared saves); the declared method must be `end`.
            allowed_keys(
                &declaration,
                &["method", "input", "save"],
                &format!("{path}.declaration"),
            )?;
            if !matches!(
                field(&declaration, "method", &format!("{path}.declaration"))?,
                SVal::Str(_)
            ) {
                return Err(err(
                    &format!("{path}.declaration.method"),
                    "expected the operation method string",
                ));
            }
            if optional(&declaration, "input").is_none() {
                return Err(err(
                    &format!("{path}.declaration"),
                    "missing consumed fact input",
                ));
            }
            let input = match field(&declaration, "input", &format!("{path}.declaration"))? {
                SVal::Null => None,
                value => Some(parse_run_result(
                    value,
                    &format!("{path}.declaration.input"),
                )?),
            };
            let save = match optional(&declaration, "save") {
                None | Some(SVal::Null) | Some(SVal::Undefined) => None,
                Some(SVal::Str(save)) => Some(save.clone()),
                Some(other) => {
                    return Err(err(
                        &format!("{path}.declaration.save"),
                        format!("expected a save slot string, got {}", kind_of(other)),
                    ))
                }
            };
            OpMethod::End { input, save }
        }
        "savedSummary" => {
            closed(
                &declaration,
                &["method", "key"],
                &format!("{path}.declaration"),
            )?;
            OpMethod::SavedSummary {
                key: string_field(&declaration, "key", &format!("{path}.declaration"))?,
            }
        }
        "recreate" => {
            closed(
                &declaration,
                &["method", "cfg", "brain"],
                &format!("{path}.declaration"),
            )?;
            let cfg = string_field(&declaration, "cfg", &format!("{path}.declaration"))?;
            if !links.configs.iter().any(|handle| handle == &cfg) {
                return Err(err(
                    &format!("{path}.declaration.cfg"),
                    format!("unknown config handle {cfg}"),
                ));
            }
            let brain = string_field(&declaration, "brain", &format!("{path}.declaration"))?;
            if !links.brains.iter().any(|handle| handle == &brain) {
                return Err(err(
                    &format!("{path}.declaration.brain"),
                    format!("unknown Brain handle {brain}"),
                ));
            }
            OpMethod::Recreate { cfg, brain }
        }
        _ => unreachable!("operation method list is exhaustive"),
    };
    let declaration_bval = sval_to_bval(&declaration);
    let expected = parse_expected_op(value, path, declaration_bval.clone())?;
    Ok(Operation {
        method,
        actor,
        declaration: declaration_bval,
        expected,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared config resolution checks (the merged `resolved` value must agree with its declaration exactly).

fn config_declared_string(declaration: &SVal, key: &str) -> Option<String> {
    match optional(declaration, key) {
        Some(SVal::Str(text)) => Some(text.clone()),
        _ => None,
    }
}

fn resolution_error(path: &str, detail: impl Into<String>) -> String {
    err(path, detail.into())
}

fn same_f64(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn validate_tier_resolution(declaration: &SVal, resolved: &TierParams, path: &str) -> R<()> {
    let declared_id = config_declared_string(declaration, "tier").unwrap_or_else(|| "hard".into());
    let resolved_id = match resolved.id {
        crate::bots::types::TierId::Easy => "easy",
        crate::bots::types::TierId::Normal => "normal",
        crate::bots::types::TierId::Hard => "hard",
    };
    if declared_id != resolved_id {
        return Err(resolution_error(
            path,
            format!("declared tier {declared_id} resolved to {resolved_id}"),
        ));
    }
    let Some(overrides) = optional(declaration, "tierOverrides") else {
        return Ok(());
    };
    let overrides_path = format!("{path}.tierOverrides");
    for (key, member) in object(overrides, &overrides_path)? {
        match key.as_str() {
            "reaction" => check_ex_gaussian_override(
                member,
                &resolved.reaction,
                &format!("{overrides_path}.reaction"),
            )?,
            "step" => check_ex_gaussian_override(
                member,
                &resolved.step,
                &format!("{overrides_path}.step"),
            )?,
            "daze" => check_ex_gaussian_override(
                member,
                &resolved.daze,
                &format!("{overrides_path}.daze"),
            )?,
            "thinkMs" => check_cadence_override(
                member,
                &resolved.think_ms,
                &format!("{overrides_path}.thinkMs"),
            )?,
            "strategyMs" => check_cadence_override(
                member,
                &resolved.strategy_ms,
                &format!("{overrides_path}.strategyMs"),
            )?,
            "moveScatter" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.moveScatter"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.moveScatter.{name}"))?;
                    match name.as_str() {
                        "base" => check_number(
                            value,
                            resolved.move_scatter.base,
                            &format!("{overrides_path}.moveScatter.base"),
                        )?,
                        "perUnit" => check_number(
                            value,
                            resolved.move_scatter.per_unit,
                            &format!("{overrides_path}.moveScatter.perUnit"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.moveScatter"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "targetScatter" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.targetScatter"))? {
                    let value = finite_number_value(
                        leaf,
                        &format!("{overrides_path}.targetScatter.{name}"),
                    )?;
                    match name.as_str() {
                        "sigma" => check_number(
                            value,
                            resolved.target_scatter.sigma,
                            &format!("{overrides_path}.targetScatter.sigma"),
                        )?,
                        "lagS" => check_number(
                            value,
                            resolved.target_scatter.lag_s,
                            &format!("{overrides_path}.targetScatter.lagS"),
                        )?,
                        "slipP" => check_number(
                            value,
                            resolved.target_scatter.slip_p,
                            &format!("{overrides_path}.targetScatter.slipP"),
                        )?,
                        "slipMult" => check_number(
                            value,
                            resolved.target_scatter.slip_mult,
                            &format!("{overrides_path}.targetScatter.slipMult"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.targetScatter"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "hesitation" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.hesitation"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.hesitation.{name}"))?;
                    match name.as_str() {
                        "p" => check_number(
                            value,
                            resolved.hesitation.p,
                            &format!("{overrides_path}.hesitation.p"),
                        )?,
                        "minMs" => check_number(
                            value,
                            resolved.hesitation.min_ms,
                            &format!("{overrides_path}.hesitation.minMs"),
                        )?,
                        "maxMs" => check_number(
                            value,
                            resolved.hesitation.max_ms,
                            &format!("{overrides_path}.hesitation.maxMs"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.hesitation"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "orbwalk" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.orbwalk"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.orbwalk.{name}"))?;
                    match name.as_str() {
                        "p" => check_number(
                            value,
                            resolved.orbwalk.p,
                            &format!("{overrides_path}.orbwalk.p"),
                        )?,
                        "stepU" => check_number(
                            value,
                            resolved.orbwalk.step_u,
                            &format!("{overrides_path}.orbwalk.stepU"),
                        )?,
                        "angleJitter" => check_number(
                            value,
                            resolved.orbwalk.angle_jitter,
                            &format!("{overrides_path}.orbwalk.angleJitter"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.orbwalk"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "route" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.route"))? {
                    match name.as_str() {
                        "horizon" => {
                            let value = uint_value(
                                leaf,
                                u64::from(u32::MAX),
                                &format!("{overrides_path}.route.horizon"),
                            )?;
                            if value != u64::from(resolved.route.horizon) {
                                return Err(err(
                                    &format!("{overrides_path}.route.horizon"),
                                    format!(
                                        "declared {value} resolved to {}",
                                        resolved.route.horizon
                                    ),
                                ));
                            }
                        }
                        "walkPaths" => {
                            let value =
                                bool_value(leaf, &format!("{overrides_path}.route.walkPaths"))?;
                            if value != resolved.route.walk_paths {
                                return Err(err(
                                    &format!("{overrides_path}.route.walkPaths"),
                                    "declared override not resolved",
                                ));
                            }
                        }
                        "reach" => {
                            let value = finite_number_value(
                                leaf,
                                &format!("{overrides_path}.route.reach"),
                            )?;
                            check_number(
                                value,
                                resolved.route.reach,
                                &format!("{overrides_path}.route.reach"),
                            )?;
                        }
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.route"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "attention" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.attention"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.attention.{name}"))?;
                    match name.as_str() {
                        "central" => check_number(
                            value,
                            resolved.attention.central,
                            &format!("{overrides_path}.attention.central"),
                        )?,
                        "peripheryMult" => check_number(
                            value,
                            resolved.attention.periphery_mult,
                            &format!("{overrides_path}.attention.peripheryMult"),
                        )?,
                        "engagedMult" => check_number(
                            value,
                            resolved.attention.engaged_mult,
                            &format!("{overrides_path}.attention.engagedMult"),
                        )?,
                        "reconsiderMs" => check_number(
                            value,
                            resolved.attention.reconsider_ms,
                            &format!("{overrides_path}.attention.reconsiderMs"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.attention"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "appraisal" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.appraisal"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.appraisal.{name}"))?;
                    match name.as_str() {
                        "bias" => check_number(
                            value,
                            resolved.appraisal.bias,
                            &format!("{overrides_path}.appraisal.bias"),
                        )?,
                        "lead" => check_number(
                            value,
                            resolved.appraisal.lead,
                            &format!("{overrides_path}.appraisal.lead"),
                        )?,
                        "busy" => check_number(
                            value,
                            resolved.appraisal.busy,
                            &format!("{overrides_path}.appraisal.busy"),
                        )?,
                        "hue" => check_number(
                            value,
                            resolved.appraisal.hue,
                            &format!("{overrides_path}.appraisal.hue"),
                        )?,
                        "noise" => check_number(
                            value,
                            resolved.appraisal.noise,
                            &format!("{overrides_path}.appraisal.noise"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.appraisal"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            "caution" => {
                for (name, leaf) in object(member, &format!("{overrides_path}.caution"))? {
                    let value =
                        finite_number_value(leaf, &format!("{overrides_path}.caution.{name}"))?;
                    match name.as_str() {
                        "mobShare" => check_number(
                            value,
                            resolved.caution.mob_share,
                            &format!("{overrides_path}.caution.mobShare"),
                        )?,
                        "eliteShare" => check_number(
                            value,
                            resolved.caution.elite_share,
                            &format!("{overrides_path}.caution.eliteShare"),
                        )?,
                        "startHp" => check_number(
                            value,
                            resolved.caution.start_hp,
                            &format!("{overrides_path}.caution.startHp"),
                        )?,
                        other => {
                            return Err(err(
                                &format!("{overrides_path}.caution"),
                                format!("unsupported field {other}"),
                            ))
                        }
                    }
                }
            }
            scalar => {
                let value = finite_number_value(member, &format!("{overrides_path}.{scalar}"))?;
                let resolved_value = match scalar {
                    "refractoryMs" => resolved.refractory_ms,
                    "apm" => resolved.apm,
                    "burst" => resolved.burst,
                    "minGapMs" => resolved.min_gap_ms,
                    "minimapSigma" => resolved.minimap_sigma,
                    "edgeClickP" => resolved.edge_click_p,
                    "timingSigmaMs" => resolved.timing_sigma_ms,
                    "softmaxT" => resolved.softmax_t,
                    "lapseP" => resolved.lapse_p,
                    "dodgeP" => resolved.dodge_p,
                    "jukeP" => resolved.juke_p,
                    "knowledge" => resolved.knowledge,
                    "mobShareNoise" => resolved.mob_share_noise,
                    "memorySpanMs" => resolved.memory_span_ms,
                    "feintRead" => resolved.feint_read,
                    "wary" => resolved.wary,
                    other => {
                        return Err(err(
                            &overrides_path,
                            format!("unsupported tier override {other}"),
                        ))
                    }
                };
                check_number(value, resolved_value, &format!("{overrides_path}.{scalar}"))?;
            }
        }
    }
    Ok(())
}

fn check_number(declared: f64, resolved: f64, path: &str) -> R<()> {
    if !same_f64(declared, resolved) {
        return Err(err(
            path,
            format!("declared override {declared} resolved to {resolved}"),
        ));
    }
    Ok(())
}

fn check_ex_gaussian_override(value: &SVal, resolved: &ExGaussian, path: &str) -> R<()> {
    for (name, leaf) in object(value, path)? {
        let number = finite_number_value(leaf, &format!("{path}.{name}"))?;
        let expected = match name.as_str() {
            "mu" => resolved.mu,
            "sigma" => resolved.sigma,
            "tau" => resolved.tau,
            "floor" => resolved.floor,
            "cap" => resolved.cap,
            other => return Err(err(path, format!("unsupported field {other}"))),
        };
        check_number(number, expected, &format!("{path}.{name}"))?;
    }
    Ok(())
}

fn check_cadence_override(value: &SVal, resolved: &Cadence, path: &str) -> R<()> {
    for (name, leaf) in object(value, path)? {
        let number = finite_number_value(leaf, &format!("{path}.{name}"))?;
        match name.as_str() {
            "mean" => check_number(number, resolved.mean, &format!("{path}.mean"))?,
            "jitter" => check_number(number, resolved.jitter, &format!("{path}.jitter"))?,
            other => return Err(err(path, format!("unsupported field {other}"))),
        }
    }
    Ok(())
}

fn validate_persona_resolution(declaration: &SVal, resolved: &PersonaParams, path: &str) -> R<()> {
    let declared_id =
        config_declared_string(declaration, "persona").unwrap_or_else(|| "cautious".into());
    let resolved_id = match resolved.id {
        crate::bots::types::PersonaId::Farmer => "farmer",
        crate::bots::types::PersonaId::Hunter => "hunter",
        crate::bots::types::PersonaId::Opportunist => "opportunist",
        crate::bots::types::PersonaId::Cautious => "cautious",
    };
    if declared_id != resolved_id {
        return Err(resolution_error(
            path,
            format!("declared persona {declared_id} resolved to {resolved_id}"),
        ));
    }
    let Some(overrides) = optional(declaration, "personaOverrides") else {
        return Ok(());
    };
    let overrides_path = format!("{path}.personaOverrides");
    for (key, member) in object(overrides, &overrides_path)? {
        let value = finite_number_value(member, &format!("{overrides_path}.{key}"))?;
        let expected = match key.as_str() {
            "pve" => resolved.pve,
            "pvp" => resolved.pvp,
            "loot" => resolved.loot,
            "bounty" => resolved.bounty,
            "thirdParty" => resolved.third_party,
            "engageEdge" => resolved.engage_edge,
            "bountyCaution" => resolved.bounty_caution,
            "fleeHp" => resolved.flee_hp,
            "reengageHp" => resolved.reengage_hp,
            "kite" => resolved.kite,
            "chaseGiveUpMs" => resolved.chase_give_up_ms,
            "mobKillGoal" => resolved.mob_kill_goal,
            "playerThreat" => resolved.player_threat,
            "eliteAppetite" => resolved.elite_appetite,
            "coliseum" => resolved.coliseum,
            "risk" => resolved.risk,
            other => return Err(err(&overrides_path, format!("unsupported field {other}"))),
        };
        check_number(value, expected, &format!("{overrides_path}.{key}"))?;
    }
    Ok(())
}

fn default_features() -> Features {
    Features {
        message_types: FEATURES_MESSAGES
            .iter()
            .map(|name| name.to_string())
            .collect(),
        wishes: true,
        status_effects: true,
        fields: true,
        planning: true,
        chests: true,
        skills: false,
        relics: false,
        camps: true,
        hazards: true,
    }
}

fn validate_features_resolution(declaration: &SVal, resolved: &Features, path: &str) -> R<()> {
    let mut expected = default_features();
    if let Some(overrides) = optional(declaration, "features") {
        let overrides_path = format!("{path}.features");
        for (key, member) in object(overrides, &overrides_path)? {
            match key.as_str() {
                "messageTypes" => {
                    expected.message_types =
                        string_array_value(member, &format!("{overrides_path}.messageTypes"))?;
                }
                "wishes" => {
                    expected.wishes = bool_value(member, &format!("{overrides_path}.wishes"))?
                }
                "statusEffects" => {
                    expected.status_effects =
                        bool_value(member, &format!("{overrides_path}.statusEffects"))?
                }
                "fields" => {
                    expected.fields = bool_value(member, &format!("{overrides_path}.fields"))?
                }
                "planning" => {
                    expected.planning = bool_value(member, &format!("{overrides_path}.planning"))?
                }
                "chests" => {
                    expected.chests = bool_value(member, &format!("{overrides_path}.chests"))?
                }
                "skills" => {
                    expected.skills = bool_value(member, &format!("{overrides_path}.skills"))?
                }
                "relics" => {
                    expected.relics = bool_value(member, &format!("{overrides_path}.relics"))?
                }
                "camps" => expected.camps = bool_value(member, &format!("{overrides_path}.camps"))?,
                "hazards" => {
                    expected.hazards = bool_value(member, &format!("{overrides_path}.hazards"))?
                }
                other => return Err(err(&overrides_path, format!("unsupported field {other}"))),
            }
        }
    }
    if expected != *resolved {
        return Err(resolution_error(
            path,
            "declared features do not resolve to the frozen resolved feature verdicts",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// Knowledge constructor dependencies (separately labelled actual-source constructor witness).

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct KnowledgeQuery {
    pub(crate) name: String,
    pub(crate) args: BVal,
    pub(crate) result: BVal,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct KnowledgeCall {
    pub(crate) operation: u64,
    pub(crate) sequence: u64,
    pub(crate) name: String,
    pub(crate) args: BVal,
    pub(crate) result: BVal,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct KnowledgeDependency {
    pub(crate) case: String,
    pub(crate) cfg: String,
    pub(crate) seed: u32,
    pub(crate) derived: u32,
    pub(crate) tier: TierParams,
    /// The 70 source constructor draws in order (all finite runtime uniforms).
    pub(crate) draws: Vec<f64>,
    pub(crate) queries: Vec<KnowledgeQuery>,
    pub(crate) actual_calls: Vec<KnowledgeCall>,
    pub(crate) wiring: Vec<String>,
    pub(crate) derive_source: String,
    pub(crate) observability: String,
}

const KNOWLEDGE_NAMES: [&str; 4] = ["mobShare", "factionEdge", "weaponEdge", "odds"];

fn tags_bval(value: &Value, path: &str) -> R<BVal> {
    let decoded = decode_diagnostic(value, path)?;
    Ok(sval_to_bval(&decoded))
}

pub(crate) fn parse_knowledge_dependency(value: &Value, path: &str) -> R<KnowledgeDependency> {
    let decoded = decode_input(value, path)?;
    closed(
        &decoded,
        &[
            "case",
            "cfg",
            "seed",
            "derived",
            "tier",
            "draws",
            "queries",
            "actualCalls",
            "wiring",
            "deriveSource",
            "observability",
        ],
        path,
    )?;
    let seed = uint_field(&decoded, "seed", u64::from(u32::MAX), path)? as u32;
    let derived = uint_field(&decoded, "derived", u64::from(u32::MAX), path)? as u32;
    let tier = parse_tier(field(&decoded, "tier", path)?, &format!("{path}.tier"))?;
    let draws = {
        let rows = array_field(&decoded, "draws", path)?;
        if rows.len() != 70 {
            return Err(err(
                &format!("{path}.draws"),
                format!("expected the 70 constructor draws, got {}", rows.len()),
            ));
        }
        let mut draws = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            draws.push(finite_number_value(row, &format!("{path}.draws[{index}]"))?);
        }
        draws
    };
    let queries = {
        let rows = array_field(&decoded, "queries", path)?;
        if rows.len() <= 100 {
            return Err(err(
                &format!("{path}.queries"),
                format!(
                    "expected more than 100 constructor queries, got {}",
                    rows.len()
                ),
            ));
        }
        let mut queries = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            let row_path = format!("{path}.queries[{index}]");
            closed(row, &["name", "args", "result"], &row_path)?;
            let name = enum_field(row, "name", &KNOWLEDGE_NAMES, &row_path)?;
            queries.push(KnowledgeQuery {
                name,
                args: sval_to_bval(field(row, "args", &row_path)?),
                result: sval_to_bval(field(row, "result", &row_path)?),
            });
        }
        queries
    };
    let actual_calls = {
        let mut calls = Vec::new();
        for (index, row) in array_field(&decoded, "actualCalls", path)?
            .iter()
            .enumerate()
        {
            let row_path = format!("{path}.actualCalls[{index}]");
            closed(
                row,
                &["operation", "sequence", "name", "args", "result"],
                &row_path,
            )?;
            let name = enum_field(row, "name", &KNOWLEDGE_NAMES, &row_path)?;
            calls.push(KnowledgeCall {
                operation: uint_field(row, "operation", u64::from(u32::MAX), &row_path)?,
                sequence: uint_field(row, "sequence", u64::from(u32::MAX), &row_path)?,
                name,
                args: sval_to_bval(field(row, "args", &row_path)?),
                result: sval_to_bval(field(row, "result", &row_path)?),
            });
        }
        calls
    };
    Ok(KnowledgeDependency {
        case: string_field(&decoded, "case", path)?,
        cfg: string_field(&decoded, "cfg", path)?,
        seed,
        derived,
        tier,
        draws,
        queries,
        actual_calls,
        wiring: string_array(&decoded, "wiring", path)?,
        derive_source: string_field(&decoded, "deriveSource", path)?,
        observability: string_field(&decoded, "observability", path)?,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Direct Hand profiles (separate real Hand + Memory overlap witness, not part of a Brain history).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HandSeeds {
    pub(crate) decide: u32,
    pub(crate) motor: u32,
    pub(crate) lapse: u32,
    pub(crate) knowledge: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HandOperation {
    pub(crate) percept: Percept,
    pub(crate) release_percept: Percept,
    pub(crate) intents: Vec<Intent>,
    /// The frozen comparative rows and results (diagnostic values only).
    pub(crate) result: BVal,
    pub(crate) submit_trace: BVal,
    pub(crate) release_trace: BVal,
    pub(crate) stats: BVal,
    pub(crate) misses: BVal,
    pub(crate) memory: BVal,
    /// Runtime draw counts (decide, motor, lapse).
    pub(crate) counts: [u64; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HandProfile {
    pub(crate) profile: String,
    /// Source absent features (`undefined`) preserve legacy hand behavior: `None`.
    pub(crate) features: Option<Features>,
    pub(crate) tier: TierParams,
    pub(crate) seeds: HandSeeds,
    pub(crate) operations: Vec<HandOperation>,
}

const HAND_PROFILES: [&str; 6] = [
    "absent",
    "empty",
    "attack-only",
    "target-only",
    "partial",
    "all",
];

fn parse_hand_seeds(value: &Value, path: &str) -> R<HandSeeds> {
    let object = json_object(value, path)?;
    let keys = ["decide", "motor", "lapse", "knowledge"];
    json_allowed(object, &keys, path)?;
    json_required(object, &keys, path)?;
    let mut seeds = [0u32; 4];
    for (index, key) in keys.iter().enumerate() {
        let number = json_uint(object, key, path)?;
        if number > u64::from(u32::MAX) {
            return Err(err(
                &format!("{path}.{key}"),
                format!("seed {number} exceeds u32"),
            ));
        }
        seeds[index] = number as u32;
    }
    Ok(HandSeeds {
        decide: seeds[0],
        motor: seeds[1],
        lapse: seeds[2],
        knowledge: seeds[3],
    })
}

fn parse_hand_operation(value: &Value, path: &str) -> R<HandOperation> {
    let object = json_object(value, path)?;
    let keys = [
        "percept",
        "intents",
        "submitTrace",
        "releasePercept",
        "result",
        "releaseTrace",
        "misses",
        "stats",
        "counts",
        "memory",
    ];
    json_allowed(object, &keys, path)?;
    json_required(object, &keys, path)?;
    let input = |key: &str, path: &str| -> R<SVal> {
        let value = object
            .get(key)
            .ok_or_else(|| err(path, format!("missing {key}")))?;
        decode_input(value, &format!("{path}.{key}"))
    };
    let percept = build_percept(&input("percept", path)?, &format!("{path}.percept"))?;
    let release_percept = build_percept(
        &input("releasePercept", path)?,
        &format!("{path}.releasePercept"),
    )?;
    let intents = {
        let decoded = input("intents", path)?;
        let intents_path = format!("{path}.intents");
        let mut intents = Vec::new();
        for (index, row) in array_value(&decoded, &intents_path)?.iter().enumerate() {
            let intent = parse_caller_intent(row, &format!("{intents_path}[{index}]"))?;
            let typed = intent.to_typed().ok_or_else(|| {
                err(
                    &format!("{intents_path}[{index}]"),
                    "a direct Hand intent must be representable as a typed Intent",
                )
            })?;
            intents.push(typed);
        }
        intents
    };
    let counts = {
        let counts_path = format!("{path}.counts");
        let counts_value = object
            .get("counts")
            .ok_or_else(|| err(path, "missing counts"))?;
        let counts_object = json_object(counts_value, &counts_path)?;
        json_allowed(counts_object, &["decide", "motor", "lapse"], &counts_path)?;
        json_required(counts_object, &["decide", "motor", "lapse"], &counts_path)?;
        [
            json_uint(counts_object, "decide", &counts_path)?,
            json_uint(counts_object, "motor", &counts_path)?,
            json_uint(counts_object, "lapse", &counts_path)?,
        ]
    };
    Ok(HandOperation {
        percept,
        release_percept,
        intents,
        result: tags_bval(
            object
                .get("result")
                .ok_or_else(|| err(path, "missing result"))?,
            &format!("{path}.result"),
        )?,
        submit_trace: tags_bval(
            object
                .get("submitTrace")
                .ok_or_else(|| err(path, "missing submitTrace"))?,
            &format!("{path}.submitTrace"),
        )?,
        release_trace: tags_bval(
            object
                .get("releaseTrace")
                .ok_or_else(|| err(path, "missing releaseTrace"))?,
            &format!("{path}.releaseTrace"),
        )?,
        misses: tags_bval(
            object
                .get("misses")
                .ok_or_else(|| err(path, "missing misses"))?,
            &format!("{path}.misses"),
        )?,
        stats: tags_bval(
            object
                .get("stats")
                .ok_or_else(|| err(path, "missing stats"))?,
            &format!("{path}.stats"),
        )?,
        memory: tags_bval(
            object
                .get("memory")
                .ok_or_else(|| err(path, "missing memory"))?,
            &format!("{path}.memory"),
        )?,
        counts,
    })
}

pub(crate) fn parse_hand_profile(value: &Value, path: &str) -> R<HandProfile> {
    let object = json_object(value, path)?;
    json_allowed(
        object,
        &["profile", "features", "tier", "seeds", "operations"],
        path,
    )?;
    json_required(
        object,
        &["profile", "features", "tier", "seeds", "operations"],
        path,
    )?;
    let profile = one_of(
        json_str(object, "profile", path)?,
        &HAND_PROFILES,
        &format!("{path}.profile"),
    )?;
    let features = {
        let value = object
            .get("features")
            .ok_or_else(|| err(path, "missing features"))?;
        let decoded = decode_input(value, &format!("{path}.features"))?;
        match &decoded {
            SVal::Undefined => None,
            value => Some(parse_features(value, &format!("{path}.features"))?),
        }
    };
    let tier = parse_tier(
        &decode_input(
            object
                .get("tier")
                .ok_or_else(|| err(path, "missing tier"))?,
            &format!("{path}.tier"),
        )?,
        &format!("{path}.tier"),
    )?;
    let seeds = parse_hand_seeds(
        object
            .get("seeds")
            .ok_or_else(|| err(path, "missing seeds"))?,
        &format!("{path}.seeds"),
    )?;
    let operations = {
        let rows = object
            .get("operations")
            .and_then(Value::as_array)
            .ok_or_else(|| err(&format!("{path}.operations"), "expected an array"))?;
        let mut operations = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            operations.push(parse_hand_operation(
                row,
                &format!("{path}.operations[{index}]"),
            )?);
        }
        operations
    };
    Ok(HandProfile {
        profile,
        features,
        tier,
        seeds,
        operations,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Cases: declared configs, caller module rules, setup rows and chronological operations.

fn module_handle_allowed(handle: &str, module_handles: &[String]) -> bool {
    handle == "observer"
        || BUILTIN_MODULE_HANDLES.contains(&handle)
        || module_handles.iter().any(|known| known == handle)
}

fn parse_config_row(
    value: &Value,
    path: &str,
    map_labels: &[String],
    module_handles: &[String],
) -> R<CaseConfig> {
    let object = json_object(value, path)?;
    json_allowed(
        object,
        &[
            "handle",
            "originalCfgIdentity",
            "moduleObjectIdentities",
            "declaration",
            "resolved",
        ],
        path,
    )?;
    json_required(
        object,
        &[
            "handle",
            "originalCfgIdentity",
            "moduleObjectIdentities",
            "declaration",
            "resolved",
        ],
        path,
    )?;
    let handle = json_str(object, "handle", path)?.to_string();
    if handle.is_empty() {
        return Err(err(&format!("{path}.handle"), "empty config handle"));
    }
    let original_cfg_identity = json_uint(object, "originalCfgIdentity", path)?;
    let module_object_identities = {
        let rows = object
            .get("moduleObjectIdentities")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                err(
                    &format!("{path}.moduleObjectIdentities"),
                    "expected an array",
                )
            })?;
        let mut identities = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            let number = row.as_f64().ok_or_else(|| {
                err(
                    &format!("{path}.moduleObjectIdentities[{index}]"),
                    "expected an identity number",
                )
            })?;
            if !number.is_finite()
                || number < 0.
                || number.fract() != 0.
                || number > u64::MAX as f64
            {
                return Err(err(
                    &format!("{path}.moduleObjectIdentities[{index}]"),
                    "expected a non-negative integer identity",
                ));
            }
            identities.push(number as u64);
        }
        identities
    };
    let declaration = decode_input(
        object
            .get("declaration")
            .ok_or_else(|| err(path, "missing declaration"))?,
        &format!("{path}.declaration"),
    )?;
    let allowed_handles = {
        let mut allowed = Vec::with_capacity(module_handles.len() + 5);
        allowed.push("observer".to_string());
        allowed.extend(BUILTIN_MODULE_HANDLES.iter().map(|name| name.to_string()));
        allowed.extend(module_handles.iter().cloned());
        allowed
    };
    let (descriptor, path_budget, declared_modules) = parse_config_declaration(
        &declaration,
        &format!("{path}.declaration"),
        &allowed_handles,
    )?;
    let resolved = parse_resolved_config(
        &decode_input(
            object
                .get("resolved")
                .ok_or_else(|| err(path, "missing resolved"))?,
            &format!("{path}.resolved"),
        )?,
        &format!("{path}.resolved"),
        map_labels,
    )?;
    let declaration_path = format!("{path}.declaration");
    // The declared config resolves exactly to the frozen merged values (never a TierId/id lookup replacement).
    let declared_id = config_declared_string(&declaration, "id").unwrap_or_else(|| "me".into());
    if resolved.id != declared_id {
        return Err(resolution_error(
            &format!("{path}.resolved.id"),
            format!("declared id {declared_id} resolved to {}", resolved.id),
        ));
    }
    let declared_name =
        config_declared_string(&declaration, "name").unwrap_or_else(|| "Source Brain".into());
    if resolved.name != declared_name {
        return Err(resolution_error(
            &format!("{path}.resolved.name"),
            format!(
                "declared name {declared_name} resolved to {}",
                resolved.name
            ),
        ));
    }
    let declared_seed = match optional(&declaration, "seed") {
        None => 7f64,
        Some(value) => finite_number_value(value, &format!("{declaration_path}.seed"))?,
    };
    if !same_f64(declared_seed, f64::from(resolved.seed)) {
        return Err(resolution_error(
            &format!("{path}.resolved.seed"),
            format!(
                "declared seed {declared_seed} resolved to {}",
                resolved.seed
            ),
        ));
    }
    validate_tier_resolution(&declaration, &resolved.tier, &declaration_path)?;
    validate_persona_resolution(&declaration, &resolved.persona, &declaration_path)?;
    validate_features_resolution(&declaration, &resolved.features, &declaration_path)?;
    let declared_map = config_declared_string(&declaration, "map").unwrap_or_else(|| "open".into());
    if resolved.map != declared_map {
        return Err(resolution_error(
            &format!("{path}.resolved.map"),
            format!("declared map {declared_map} resolved to {}", resolved.map),
        ));
    }
    let declared_budget =
        config_declared_string(&declaration, "budget").unwrap_or_else(|| handle.clone());
    if resolved.budget != declared_budget {
        return Err(resolution_error(
            &format!("{path}.resolved.budget"),
            format!(
                "declared budget {declared_budget} resolved to {}",
                resolved.budget
            ),
        ));
    }
    let declared_service =
        config_declared_string(&declaration, "service").unwrap_or_else(|| handle.clone());
    if resolved.service != declared_service {
        return Err(resolution_error(
            &format!("{path}.resolved.service"),
            format!(
                "declared service {declared_service} resolved to {}",
                resolved.service
            ),
        ));
    }
    // The source caller's ordered module list: an explicit list maps 1:1 to the resolved handles; the registry token
    // selects the enabled builtins in their fixed registration order behind the neutral observer.
    if optional(&declaration, "modules").is_some_and(|value| matches!(value, SVal::Arr(_))) {
        if resolved.module_handles != declared_modules {
            return Err(resolution_error(
                &format!("{path}.resolved.moduleHandles"),
                "the resolved module handles do not match the declared caller list",
            ));
        }
    } else {
        let mut expected = vec!["observer".to_string()];
        expected.extend(
            BUILTIN_MODULE_HANDLES
                .iter()
                .filter(|name| resolved.module_handles.iter().any(|handle| handle == *name))
                .map(|name| name.to_string()),
        );
        if resolved.module_handles != expected {
            return Err(resolution_error(
                &format!("{path}.resolved.moduleHandles"),
                "the registry caller list is not the neutral observer followed by the enabled builtins in order",
            ));
        }
    }
    for handle in &resolved.module_handles {
        if !module_handle_allowed(handle, module_handles) {
            return Err(resolution_error(
                &format!("{path}.resolved.moduleHandles"),
                format!("unknown caller module handle {handle}"),
            ));
        }
    }
    let declared_learned = match optional(&declaration, "learned") {
        None => LearnedConfig {
            enabled: false,
            entries: Vec::new(),
        },
        Some(value) => parse_learned_config(value, &format!("{declaration_path}.learned"))?,
    };
    if declared_learned != resolved.learned {
        return Err(resolution_error(
            &format!("{path}.resolved.learned"),
            "the resolved learned surface does not match the declared one",
        ));
    }
    for tag in 0..4u32 {
        let expected = super::config::derive(resolved.seed, tag);
        if resolved.derived_seeds[tag as usize] != expected {
            return Err(resolution_error(
                &format!("{path}.resolved.derivedSeeds"),
                format!(
                    "derived seed tag {tag} is {} not {expected}",
                    resolved.derived_seeds[tag as usize]
                ),
            ));
        }
    }
    Ok(CaseConfig {
        handle,
        original_cfg_identity,
        module_object_identities,
        declaration: sval_to_bval(&declaration),
        resolved,
        path: descriptor,
        path_budget,
    })
}

struct SetupFacts {
    brains: Vec<String>,
    services: Vec<(String, String, String)>,
    budgets: Vec<(String, u64)>,
    enabled_rows: Vec<(Vec<String>, Features)>,
}

fn scan_initial_trace(
    rows: &[Value],
    path: &str,
    configs: &[CaseConfig],
    allowed_handles: &[String],
    map_labels: &[String],
) -> R<SetupFacts> {
    let mut facts = SetupFacts {
        brains: Vec::new(),
        services: Vec::new(),
        budgets: Vec::new(),
        enabled_rows: Vec::new(),
    };
    // Setup builtin rows are emitted while a Brain's caller config is being built (before that Brain's createBrain row),
    // so their actors are validated against the complete createBrain handle set after the scan.
    let mut actor_checks: Vec<(usize, String)> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let row_path = format!("{path}[{index}]");
        let object = json_object(row, &row_path)?;
        match json_str(object, "kind", &row_path)? {
            "caller" => {
                let name = json_str(object, "name", &row_path)?.to_string();
                match name.as_str() {
                    "createPathBudget" => {
                        let handle = json_str(object, "handle", &row_path)?.to_string();
                        if facts.budgets.iter().any(|(known, _)| known == &handle) {
                            return Err(err(
                                &format!("{row_path}.handle"),
                                format!("duplicate path budget handle {handle}"),
                            ));
                        }
                        let per_tick = json_uint(object, "perTick", &row_path)?;
                        facts.budgets.push((handle, per_tick));
                    }
                    "createPathService" => {
                        let handle = json_str(object, "handle", &row_path)?.to_string();
                        if facts.services.iter().any(|(known, _, _)| known == &handle) {
                            return Err(err(
                                &format!("{row_path}.handle"),
                                format!("duplicate path service handle {handle}"),
                            ));
                        }
                        let budget = json_str(object, "budget", &row_path)?.to_string();
                        if !facts.budgets.iter().any(|(known, _)| known == &budget) {
                            return Err(err(
                                &format!("{row_path}.budget"),
                                format!("unknown path allowance budget handle {budget}"),
                            ));
                        }
                        let map = json_str(object, "map", &row_path)?.to_string();
                        if !map_labels.iter().any(|label| label == &map) {
                            return Err(err(
                                &format!("{row_path}.map"),
                                format!("unknown source map label {map}"),
                            ));
                        }
                        facts.services.push((handle, budget, map));
                    }
                    "enabledModules" => {
                        let features = {
                            let value = object
                                .get("features")
                                .ok_or_else(|| err(&row_path, "missing features"))?;
                            let decoded =
                                decode_diagnostic(value, &format!("{row_path}.features"))?;
                            parse_features(&decoded, &format!("{row_path}.features"))?
                        };
                        let handles = {
                            // The frozen runner emits `handles` as an ordinary JSON array (only `features` is tagged).
                            let value = object
                                .get("handles")
                                .ok_or_else(|| err(&row_path, "missing handles"))?;
                            let rows = value.as_array().ok_or_else(|| {
                                err(
                                    &format!("{row_path}.handles"),
                                    "expected the caller handle array",
                                )
                            })?;
                            let mut handles = Vec::with_capacity(rows.len());
                            for (index, row) in rows.iter().enumerate() {
                                handles.push(
                                    row.as_str()
                                        .ok_or_else(|| {
                                            err(
                                                &format!("{row_path}.handles[{index}]"),
                                                "expected a caller module handle string",
                                            )
                                        })?
                                        .to_string(),
                                );
                            }
                            handles
                        };
                        for handle in &handles {
                            if !module_handle_allowed(handle, allowed_handles) {
                                return Err(err(
                                    &format!("{row_path}.handles"),
                                    format!("unknown caller module handle {handle}"),
                                ));
                            }
                        }
                        facts.enabled_rows.push((handles, features));
                    }
                    "createBrain" => {
                        let cfg = json_str(object, "cfg", &row_path)?.to_string();
                        if !configs.iter().any(|config| config.handle == cfg) {
                            return Err(err(
                                &format!("{row_path}.cfg"),
                                format!("unknown config handle {cfg}"),
                            ));
                        }
                        let handle = json_str(object, "handle", &row_path)?.to_string();
                        if handle.is_empty() {
                            return Err(err(&format!("{row_path}.handle"), "empty Brain handle"));
                        }
                        if facts.brains.iter().any(|known| known == &handle) {
                            return Err(err(
                                &format!("{row_path}.handle"),
                                format!("duplicate Brain handle {handle}"),
                            ));
                        }
                        let config = configs
                            .iter()
                            .find(|config| config.handle == cfg)
                            .expect("checked declared config handle");
                        let service = facts
                            .services
                            .iter()
                            .find(|(service, _, _)| service == &config.resolved.service)
                            .ok_or_else(|| {
                                err(
                                    &row_path,
                                    format!(
                                        "config {cfg} service {} is not declared by a createPathService row",
                                        config.resolved.service
                                    ),
                                )
                            })?;
                        if service.2 != config.resolved.map {
                            return Err(err(
                                &format!("{row_path}.cfg"),
                                format!(
                                    "config {cfg} path service map {} does not match resolved map {}",
                                    service.2, config.resolved.map
                                ),
                            ));
                        }
                        let budget = facts
                            .budgets
                            .iter()
                            .find(|(budget, _)| budget == &config.resolved.budget)
                            .ok_or_else(|| {
                                err(
                                    &row_path,
                                    format!(
                                        "config {cfg} budget {} is not declared by a createPathBudget row",
                                        config.resolved.budget
                                    ),
                                )
                            })?;
                        if budget.1 != u64::from(config.path_budget) {
                            return Err(err(
                                &format!("{row_path}.cfg"),
                                format!(
                                    "config {cfg} path allowance {} does not match declared perTick {}",
                                    config.path_budget, budget.1
                                ),
                            ));
                        }
                        if let Some((handles, features)) = facts.enabled_rows.last() {
                            if *handles != config.resolved.module_handles {
                                return Err(err(
                                    &row_path,
                                    format!(
                                        "config {cfg} enabled module handles do not match the resolved caller list"
                                    ),
                                ));
                            }
                            if *features != config.resolved.features {
                                return Err(err(
                                    &row_path,
                                    format!(
                                        "config {cfg} enabled module features do not match the resolved feature verdicts"
                                    ),
                                ));
                            }
                        }
                        facts.brains.push(handle);
                    }
                    other => {
                        return Err(err(
                            &row_path,
                            format!("unsupported setup caller row {other}"),
                        ))
                    }
                }
            }
            "builtin" => {
                let actor = json_str(object, "actor", &row_path)?.to_string();
                actor_checks.push((index, actor));
            }
            other => {
                return Err(err(
                    &row_path,
                    format!("setup trace rows are caller/builtin rows only, got {other}"),
                ))
            }
        }
    }
    for (index, actor) in &actor_checks {
        if !facts.brains.iter().any(|handle| handle == actor) {
            return Err(err(
                &format!("{path}[{index}].actor"),
                format!("setup builtin row actor {actor} is not a declared Brain handle"),
            ));
        }
    }
    if facts.brains.is_empty() {
        return Err(err(path, "the case declares no createBrain setup row"));
    }
    for config in configs {
        if !facts
            .services
            .iter()
            .any(|(service, _, _)| service == &config.resolved.service)
        {
            return Err(err(
                path,
                format!(
                    "config {} resolved service {} is never created by the caller",
                    config.handle, config.resolved.service
                ),
            ));
        }
        if !facts
            .budgets
            .iter()
            .any(|(budget, _)| budget == &config.resolved.budget)
        {
            return Err(err(
                path,
                format!(
                    "config {} resolved budget {} is never created by the caller",
                    config.handle, config.resolved.budget
                ),
            ));
        }
    }
    Ok(facts)
}

fn order_expected_rows<T>(rows: &mut Vec<(String, T)>, order: &[String], path: &str) -> R<()> {
    if rows.len() != order.len() {
        return Err(err(
            path,
            format!("expected {} rows, got {}", order.len(), rows.len()),
        ));
    }
    let mut ordered: Vec<(String, T)> = Vec::with_capacity(rows.len());
    for handle in order {
        let position = rows
            .iter()
            .position(|(known, _)| known == handle)
            .ok_or_else(|| err(path, format!("missing expected row for {handle}")))?;
        ordered.push(rows.swap_remove(position));
    }
    if !rows.is_empty() {
        return Err(err(path, "unexpected expected rows"));
    }
    *rows = ordered;
    Ok(())
}

pub(crate) fn parse_case(value: &Value, path: &str, map_labels: &[String]) -> R<Case> {
    let record = json_object(value, path)?;
    let keys = [
        "id",
        "family",
        "covers",
        "modules",
        "configs",
        "initialTrace",
        "operations",
    ];
    json_allowed(record, &keys, path)?;
    json_required(record, &keys, path)?;
    let id = {
        let id = json_str(record, "id", path)?;
        if id.is_empty() {
            return Err(err(&format!("{path}.id"), "empty case id"));
        }
        id.to_string()
    };
    let family = json_str(record, "family", path)?.to_string();
    let covers = {
        let value = record
            .get("covers")
            .ok_or_else(|| err(path, "missing covers"))?;
        let rows = value
            .as_array()
            .ok_or_else(|| err(&format!("{path}.covers"), "expected an array"))?;
        let mut covers = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            covers.push(
                row.as_str()
                    .ok_or_else(|| {
                        err(
                            &format!("{path}.covers[{index}]"),
                            "expected a cover string",
                        )
                    })?
                    .to_string(),
            );
        }
        covers
    };
    let modules = {
        let decoded = decode_input(
            record
                .get("modules")
                .ok_or_else(|| err(path, "missing modules"))?,
            &format!("{path}.modules"),
        )?;
        let modules_path = format!("{path}.modules");
        let entries = object(&decoded, &modules_path)?;
        let mut modules = Vec::with_capacity(entries.len());
        for (handle, rule) in entries {
            if handle.is_empty() {
                return Err(err(&modules_path, "empty caller module handle"));
            }
            modules.push(parse_caller_module_decl(
                handle,
                rule,
                &format!("{modules_path}.{handle}"),
            )?);
        }
        modules
    };
    let module_handles: Vec<String> = modules.iter().map(|module| module.handle.clone()).collect();
    let mut configs = Vec::new();
    {
        let rows = record
            .get("configs")
            .and_then(Value::as_array)
            .ok_or_else(|| err(&format!("{path}.configs"), "expected an array"))?;
        for (index, row) in rows.iter().enumerate() {
            let config = parse_config_row(
                row,
                &format!("{path}.configs[{index}]"),
                map_labels,
                &module_handles,
            )?;
            if configs
                .iter()
                .any(|known: &CaseConfig| known.handle == config.handle)
            {
                return Err(err(
                    &format!("{path}.configs[{index}].handle"),
                    format!("duplicate config handle {}", config.handle),
                ));
            }
            configs.push(config);
        }
    }
    let initial_value = record
        .get("initialTrace")
        .ok_or_else(|| err(path, "missing initialTrace"))?;
    let initial_rows = initial_value
        .as_array()
        .ok_or_else(|| err(&format!("{path}.initialTrace"), "expected an array"))?;
    let initial_trace = parse_expected_trace(initial_value, &format!("{path}.initialTrace"))?;
    let mut allowed_handles = vec!["observer".to_string()];
    allowed_handles.extend(BUILTIN_MODULE_HANDLES.iter().map(|name| name.to_string()));
    allowed_handles.extend(module_handles.iter().cloned());
    let facts = scan_initial_trace(
        initial_rows,
        &format!("{path}.initialTrace"),
        &configs,
        &allowed_handles,
        map_labels,
    )?;
    let config_handles: Vec<String> = configs.iter().map(|config| config.handle.clone()).collect();
    let links = OperationLinks {
        configs: &config_handles,
        brains: &facts.brains,
        modules: &module_handles,
        budgets: &facts
            .budgets
            .iter()
            .map(|(budget, _)| budget.clone())
            .collect::<Vec<_>>(),
    };
    let rows = record
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| err(&format!("{path}.operations"), "expected an array"))?;
    let mut operations = Vec::with_capacity(rows.len());
    let mut clocks: Vec<(String, f64)> = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let operation = parse_operation(row, &format!("{path}.operations[{index}]"), &links)?;
        if let OpMethod::Tick { brain, percept, .. } = &operation.method {
            match clocks.iter_mut().find(|(handle, _)| handle == brain) {
                Some((_, last)) => {
                    if percept.now < *last {
                        return Err(err(
                            &format!("{path}.operations[{index}]"),
                            format!("backward Brain clock for {brain}: {} < {last}", percept.now),
                        ));
                    }
                    *last = percept.now;
                }
                None => clocks.push((brain.clone(), percept.now)),
            }
        }
        // The expected snapshot covers every live instance and every caller service exactly once.
        let mut brains = operation.expected.brains.clone();
        order_expected_rows(
            &mut brains,
            &facts.brains,
            &format!("{path}.operations[{index}].brains"),
        )?;
        let service_order: Vec<String> = facts
            .services
            .iter()
            .map(|(handle, _, _)| handle.clone())
            .collect();
        let mut services = operation.expected.services.clone();
        order_expected_rows(
            &mut services,
            &service_order,
            &format!("{path}.operations[{index}].services"),
        )?;
        let budget_by_service: Vec<(String, String)> = facts
            .services
            .iter()
            .map(|(handle, budget, _)| (handle.clone(), budget.clone()))
            .collect();
        for (handle, expected) in &services {
            let (_, budget) = budget_by_service
                .iter()
                .find(|(service, _)| service == handle)
                .expect("ordered service handle");
            if &expected.budget != budget {
                return Err(err(
                    &format!("{path}.operations[{index}].services.{handle}.budget"),
                    format!(
                        "expected service budget {} does not match the caller budget {budget}",
                        expected.budget
                    ),
                ));
            }
        }
        let expected = ExpectedOp {
            result: operation.expected.result.clone(),
            error: operation.expected.error.clone(),
            brains,
            services,
            trace: operation.expected.trace.clone(),
        };
        operations.push(Operation {
            method: operation.method,
            actor: operation.actor,
            declaration: operation.declaration,
            expected,
        });
    }
    Ok(Case {
        id,
        family,
        covers,
        modules,
        configs,
        initial_trace,
        operations,
        brains: facts.brains,
        services: facts
            .services
            .iter()
            .map(|(handle, _, _)| handle.clone())
            .collect(),
        budgets: facts
            .budgets
            .iter()
            .map(|(handle, _)| handle.clone())
            .collect(),
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Body envelope: one atomic conversion of the frozen corpus into typed native data.

const BODY_KEYS: [&str; 7] = [
    "format",
    "methodValue",
    "profile",
    "maps",
    "knowledgeDependencies",
    "handSupplement",
    "cases",
];

fn validate_profile(value: &Value, path: &str) -> R<()> {
    let object = json_object(value, path)?;
    // Loose known-key shape check: the profile pin block is retained for provenance, not consumed for replay.
    for key in [
        "sourceBase",
        "boundary",
        "image",
        "node",
        "platform",
        "arch",
        "numberEncoding",
        "diagnosticOperations",
        "observer",
        "knowledge",
        "deriveSource",
        "sourceInventorySha256",
    ] {
        if let Some(member) = object.get(key) {
            if !member.is_string() {
                return Err(err(&format!("{path}.{key}"), "expected a string pin"));
            }
        }
    }
    if let Some(member) = object.get("wiring") {
        let rows = member
            .as_array()
            .ok_or_else(|| err(&format!("{path}.wiring"), "expected an array"))?;
        for (index, row) in rows.iter().enumerate() {
            if !row.is_string() {
                return Err(err(
                    &format!("{path}.wiring[{index}]"),
                    "expected a wiring source line",
                ));
            }
        }
    }
    for key in [
        "runtimeVersions",
        "sourceInventory",
        "configFiles",
        "protectedFiles",
        "dependencyVersions",
        "toolFiles",
        "codecProvenance",
        "readerProvenance",
    ] {
        if let Some(member) = object.get(key) {
            if !member.is_object() {
                return Err(err(
                    &format!("{path}.{key}"),
                    "expected an object pin block",
                ));
            }
        }
    }
    Ok(())
}

/// Complete typed build of the frozen body from an owned JSON value. Atomic: no partially built `Source` escapes.
pub(crate) fn body_from_value(raw: &Value) -> R<Source> {
    let object = json_object(raw, "body")?;
    json_allowed(object, &BODY_KEYS, "body")?;
    json_required(object, &BODY_KEYS, "body")?;
    let format = json_str(object, "format", "body.format")?;
    if format != SOURCE_FORMAT {
        return Err(err(
            "body.format",
            format!("expected {SOURCE_FORMAT}, got {format}"),
        ));
    }
    let method_value = json_str(object, "methodValue", "body.methodValue")?;
    if method_value != METHOD_VALUE_FORMAT {
        return Err(err(
            "body.methodValue",
            format!("expected {METHOD_VALUE_FORMAT}, got {method_value}"),
        ));
    }
    let profile_value = object
        .get("profile")
        .ok_or_else(|| err("body", "missing profile"))?;
    validate_profile(profile_value, "body.profile")?;
    // Maps first: the resolved config map labels are validated against the declared map fixtures.
    let maps = {
        let rows = object
            .get("maps")
            .and_then(Value::as_array)
            .ok_or_else(|| err("body.maps", "expected an array"))?;
        let mut maps = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            let fixture = parse_map_fixture(row, &format!("body.maps[{index}]"))?;
            if maps.iter().any(|known: &MapFixture| known.id == fixture.id) {
                return Err(err(
                    &format!("body.maps[{index}].id"),
                    format!("duplicate map id {}", fixture.id),
                ));
            }
            maps.push(fixture);
        }
        maps
    };
    if maps.is_empty() {
        return Err(err(
            "body.maps",
            "the frozen corpus declares its eight maps",
        ));
    }
    let map_labels: Vec<String> = maps.iter().map(|map| map.id.clone()).collect();
    let profile = profile_value.clone();
    let cases = {
        let rows = object
            .get("cases")
            .and_then(Value::as_array)
            .ok_or_else(|| err("body.cases", "expected an array"))?;
        let mut cases = Vec::with_capacity(rows.len());
        let mut seen = std::collections::BTreeSet::new();
        for (index, row) in rows.iter().enumerate() {
            let case = parse_case(row, &format!("body.cases[{index}]"), &map_labels)?;
            if !seen.insert(case.id.clone()) {
                return Err(err(
                    &format!("body.cases[{index}].id"),
                    format!("duplicate case id {}", case.id),
                ));
            }
            cases.push(case);
        }
        cases
    };
    if cases.is_empty() {
        return Err(err(
            "body.cases",
            "the frozen corpus declares its histories",
        ));
    }
    let knowledge = {
        let rows = object
            .get("knowledgeDependencies")
            .and_then(Value::as_array)
            .ok_or_else(|| err("body.knowledgeDependencies", "expected an array"))?;
        let mut knowledge = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            knowledge.push(parse_knowledge_dependency(
                row,
                &format!("body.knowledgeDependencies[{index}]"),
            )?);
        }
        knowledge
    };
    let hand = {
        let rows = object
            .get("handSupplement")
            .and_then(Value::as_array)
            .ok_or_else(|| err("body.handSupplement", "expected an array"))?;
        let mut hand = Vec::with_capacity(rows.len());
        let mut seen = std::collections::BTreeSet::new();
        for (index, row) in rows.iter().enumerate() {
            let profile = parse_hand_profile(row, &format!("body.handSupplement[{index}]"))?;
            if !seen.insert(profile.profile.clone()) {
                return Err(err(
                    &format!("body.handSupplement[{index}].profile"),
                    format!("duplicate Hand profile {}", profile.profile),
                ));
            }
            hand.push(profile);
        }
        hand
    };
    // Knowledge dependencies are emitted per declared config in case/config order: the ordering and cross-links are
    // structural facts, so validate them exactly against the histories (32 separately labelled constructors).
    {
        let mut expected_order: Vec<(String, String)> = Vec::new();
        for case in &cases {
            for config in &case.configs {
                expected_order.push((case.id.clone(), config.handle.clone()));
            }
        }
        if knowledge.len() != expected_order.len() {
            return Err(err(
                "body.knowledgeDependencies",
                format!(
                    "expected one constructor dependency per declared config ({}), got {}",
                    expected_order.len(),
                    knowledge.len()
                ),
            ));
        }
        for (index, dependency) in knowledge.iter().enumerate() {
            let (case_id, cfg) = &expected_order[index];
            if &dependency.case != case_id || &dependency.cfg != cfg {
                return Err(err(
                    &format!("body.knowledgeDependencies[{index}]"),
                    format!(
                        "constructor dependency {} is out of declared order (expected {case_id}/{cfg})",
                        dependency.case
                    ),
                ));
            }
            let case = cases
                .iter()
                .find(|case| &case.id == case_id)
                .expect("declared case");
            let config = case
                .configs
                .iter()
                .find(|config| &config.handle == cfg)
                .expect("declared config");
            if dependency.seed != config.resolved.seed {
                return Err(err(
                    &format!("body.knowledgeDependencies[{index}].seed"),
                    format!(
                        "constructor seed {} does not match the resolved config seed {}",
                        dependency.seed, config.resolved.seed
                    ),
                ));
            }
            if dependency.derived != config.resolved.derived_seeds[3] {
                return Err(err(
                    &format!("body.knowledgeDependencies[{index}].derived"),
                    format!(
                        "constructor tag-3 seed {} does not match the derived seed {}",
                        dependency.derived, config.resolved.derived_seeds[3]
                    ),
                ));
            }
            if dependency.tier != config.resolved.tier {
                return Err(err(
                    &format!("body.knowledgeDependencies[{index}].tier"),
                    "constructor tier does not match the resolved config tier",
                ));
            }
        }
    }
    Ok(Source {
        profile,
        maps,
        knowledge,
        hand,
        cases,
    })
}

/// Validate the frozen body without returning owned state (atomicity: every check returns before construction ends).
pub(crate) fn validate_body(raw: &Value) -> R<()> {
    body_from_value(raw).map(|_| ())
}

impl Source {
    pub(crate) fn case(&self, id: &str) -> R<&Case> {
        self.cases
            .iter()
            .find(|case| case.id == id)
            .ok_or_else(|| format!("source case {id:?} is not declared in body.cases"))
    }

    /// The declared case history totals (`31` histories / `855` operations in the frozen corpus).
    pub(crate) fn operation_counts(&self) -> R<(usize, usize)> {
        let operations = self
            .cases
            .iter()
            .try_fold(0usize, |total, case| {
                total.checked_add(case.operations.len())
            })
            .ok_or_else(|| "case operation count overflow".to_string())?;
        Ok((self.cases.len(), operations))
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Focused reader tests: the frozen corpus converts completely, and the same checked entry points reject malformed
// declared data atomically (the strict-negative policy).

#[cfg(test)]
mod tests {
    use super::*;

    fn body_json() -> Value {
        let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), SOURCE_RELATIVE_PATH);
        let text = std::fs::read_to_string(path).expect("frozen Brain source corpus bytes");
        raw_value(&text).expect("strict raw parse")
    }

    #[test]
    fn frozen_corpus_converts_completely() {
        let source = load().expect("frozen corpus converts");
        let (cases, operations) = source.operation_counts().expect("operation totals");
        assert_eq!(cases, 31);
        assert_eq!(operations, 855);
        assert_eq!(source.maps.len(), 8);
        assert_eq!(source.hand.len(), 6);
        assert_eq!(
            source
                .hand
                .iter()
                .map(|profile| profile.operations.len())
                .sum::<usize>(),
            12
        );
        assert_eq!(source.knowledge.len(), 32);
        let ticks = source
            .cases
            .iter()
            .flat_map(|case| case.operations.iter())
            .filter(|operation| matches!(operation.method, OpMethod::Tick { .. }))
            .count();
        assert_eq!(ticks, 425);
        for map in &source.maps {
            let brain_map = map.brain_map().expect("component map projections");
            assert_eq!(
                brain_map.terrain.len(),
                map.data.w as usize * map.data.h as usize
            );
            assert_eq!(brain_map.plan.camps.len(), map.data.camps.len());
        }
        // Every resolved config's derived seeds and its Knowledge constructor tier agree with the frozen rows.
        for case in &source.cases {
            for config in &case.configs {
                for tag in 0..4u32 {
                    assert_eq!(
                        config.resolved.derived_seeds[tag as usize],
                        super::super::config::derive(config.resolved.seed, tag)
                    );
                }
            }
        }
    }

    #[test]
    fn raw_duplicate_decoded_keys_rejected() {
        assert!(raw_value("{\"a\":1,\"\\u0061\":2}").is_err());
        assert!(raw_value("{\"a\":1,\"a\":2}").is_err());
        assert!(raw_value("{\"a\":1} trailing").is_err());
    }

    #[test]
    fn body_format_and_duplicate_case_rejected() {
        let mut body = body_json();
        body["format"] = Value::String("future".into());
        assert!(validate_body(&body).is_err());

        let mut body = body_json();
        let cases = body["cases"].as_array_mut().expect("case array");
        let duplicate = cases[0].clone();
        cases.push(duplicate);
        assert!(validate_body(&body).is_err());
    }

    fn tagged_entries_mut<'a>(value: &'a mut Value, key: &str, path: &str) -> &'a mut Value {
        let entries = value
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .unwrap_or_else(|| panic!("{path}: tagged entries"));
        entries
            .iter_mut()
            .find(|pair| {
                pair.as_array()
                    .and_then(|pair| pair.first())
                    .and_then(Value::as_str)
                    == Some(key)
            })
            .and_then(|pair| pair.as_array_mut())
            .and_then(|pair| pair.get_mut(1))
            .unwrap_or_else(|| panic!("{path}: missing tagged field {key}"))
    }

    #[test]
    fn mutated_declared_inputs_rejected_atomically() {
        // Missing self.readyAt in a declared tick percept.
        let mut body = body_json();
        {
            let cases = body["cases"].as_array_mut().expect("case array");
            let case = cases
                .iter_mut()
                .find(|case| case["id"] == Value::String("core-registry-cadence".into()))
                .expect("case");
            let operations = case["operations"].as_array_mut().expect("operations");
            let tick = operations
                .iter_mut()
                .find(|row| row["method"] == Value::String("tick".into()))
                .expect("tick row");
            let declaration = &mut tick["declaration"];
            let input = tagged_entries_mut(declaration, "input", "declaration");
            let self_value = tagged_entries_mut(input, "self", "input");
            let ready_at = tagged_entries_mut(self_value, "readyAt", "self");
            *ready_at = Value::String("removed".into());
        }
        assert!(validate_body(&body).is_err());

        // A malformed status outside the four-status Brain domain.
        let mut body = body_json();
        {
            let cases = body["cases"].as_array_mut().expect("case array");
            let case = &mut cases[0];
            let operations = case["operations"].as_array_mut().expect("operations");
            let tick = operations
                .iter_mut()
                .find(|row| row["method"] == Value::String("tick".into()))
                .expect("tick row");
            let declaration = &mut tick["declaration"];
            let input = tagged_entries_mut(declaration, "input", "declaration");
            let self_value = tagged_entries_mut(input, "self", "input");
            let status = tagged_entries_mut(self_value, "status", "self");
            *status = Value::String("future".into());
        }
        assert!(validate_body(&body).is_err());

        // A missing readable chest answer fails before any conversion completes.
        let mut body = body_json();
        {
            let cases = body["cases"].as_array_mut().expect("case array");
            let case = cases
                .iter_mut()
                .find(|case| case["id"] == Value::String("core-chest".into()))
                .expect("case");
            let operations = case["operations"].as_array_mut().expect("operations");
            let tick = operations
                .iter_mut()
                .find(|row| {
                    row["method"] == Value::String("tick".into())
                        && row["declaration"]["entries"]
                            .as_array()
                            .map(|entries| {
                                entries.iter().any(|pair| {
                                    pair.as_array()
                                        .and_then(|pair| pair.first())
                                        .and_then(Value::as_str)
                                        == Some("input")
                                })
                            })
                            .unwrap_or(false)
                })
                .expect("tick row");
            let declaration = &mut tick["declaration"];
            let input = tagged_entries_mut(declaration, "input", "declaration");
            let extras = tagged_entries_mut(input, "extras", "input");
            let chests = tagged_entries_mut(extras, "chests", "extras");
            let values = chests
                .get_mut("values")
                .and_then(Value::as_array_mut)
                .expect("chest rows");
            if let Some(first) = values.first_mut() {
                let taken_by = tagged_entries_mut(first, "takenBy", "chest");
                *taken_by = Value::String("removed".into());
            }
        }
        assert!(validate_body(&body).is_err());
    }
}
