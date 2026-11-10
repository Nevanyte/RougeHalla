//! Strict tagged-value + finite envelope reader for the frozen private-strategy witness. Test-only, and used on the actual
//! replay path before any native instance is created or mutated: the corpus is checked as a closed tagged method-value
//! schema (unknown/extra tags, duplicate keys/collection members, malformed pairs, u8 bytes and forbidden shapes rejected)
//! and every case/operation/declaration/callback/draw-count/diagnostic row is shape-checked here. Typed enum/field/range
//! checks for the values the replay actually consumes live in the source_tests preflight that runs per operation.
use serde_json::Value;

use super::source_reader::{self, SVal, R};

/// Tagged method values are either declared inputs (no instance/callable diagnostics) or expected-output diagnostics.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Input,
    Diagnostic,
}

fn err(path: &str, message: impl Into<String>) -> String {
    format!("{path}: {}", message.into())
}

fn as_object<'a>(value: &'a Value, path: &str) -> R<(&'a str, &'a serde_json::Map<String, Value>)> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "expected a tagged object"))?;
    let tag = object
        .get("$")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "missing $ tag"))?;
    Ok((tag, object))
}

fn exact_keys(object: &serde_json::Map<String, Value>, allowed: &[&str], path: &str) -> R<()> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unexpected tag field {key}")));
        }
    }
    for key in allowed {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing tag field {key}")));
        }
    }
    Ok(())
}

fn raw_finite(value: &Value, path: &str) -> R<f64> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| err(path, "expected a finite JSON number"))
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

pub(crate) fn decode(value: &Value, path: &str, mode: Mode) -> R<SVal> {
    match value {
        Value::Null => Ok(SVal::Null),
        Value::Bool(flag) => Ok(SVal::Bool(*flag)),
        Value::Number(_) => Ok(SVal::Num(raw_finite(value, path)?)),
        Value::String(text) => Ok(SVal::Str(text.clone())),
        Value::Array(_) => Err(err(
            path,
            "untagged JSON array is not a method value (wrap arrays in {$:'array'})",
        )),
        Value::Object(_) => {
            let (tag, object) = as_object(value, path)?;
            match tag {
                "undefined" => {
                    exact_keys(object, &["$"], path)?;
                    Ok(SVal::Undefined)
                }
                "number" => {
                    exact_keys(object, &["$", "value"], path)?;
                    let raw = object
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "number tag value must be a string"))?;
                    let number = match raw {
                        "-0" => -0.0,
                        "NaN" => f64::NAN,
                        "+Infinity" => f64::INFINITY,
                        "-Infinity" => f64::NEG_INFINITY,
                        other => return Err(err(path, format!("unsupported number tag {other}"))),
                    };
                    Ok(SVal::Num(number))
                }
                "array" => {
                    exact_keys(object, &["$", "values"], path)?;
                    let values = object
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "array tag values must be an array"))?;
                    let mut out = Vec::with_capacity(values.len());
                    for (index, entry) in values.iter().enumerate() {
                        out.push(decode(entry, &format!("{path}[{index}]"), mode)?);
                    }
                    Ok(SVal::Arr(out))
                }
                "u8" => {
                    exact_keys(object, &["$", "values"], path)?;
                    let values = object
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "u8 tag values must be an array"))?;
                    let mut out = Vec::with_capacity(values.len());
                    for (index, entry) in values.iter().enumerate() {
                        let byte = entry.as_u64().ok_or_else(|| {
                            err(
                                &format!("{path}[{index}]"),
                                "u8 value must be a non-negative integer",
                            )
                        })?;
                        if byte > u64::from(u8::MAX) {
                            return Err(err(&format!("{path}[{index}]"), "u8 value out of range"));
                        }
                        out.push(byte as u8);
                    }
                    Ok(SVal::U8(out))
                }
                "map" => {
                    exact_keys(object, &["$", "entries"], path)?;
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
                        match &key {
                            SVal::Undefined
                            | SVal::Null
                            | SVal::Bool(_)
                            | SVal::Num(_)
                            | SVal::Str(_) => {}
                            other => {
                                return Err(err(
                                    &format!("{entry_path}.key"),
                                    format!("fixture Map key must be primitive, got {other:?}"),
                                ))
                            }
                        }
                        if out
                            .iter()
                            .any(|(existing, _)| same_value_zero(existing, &key))
                        {
                            return Err(err(&entry_path, "duplicate Map key"));
                        }
                        let entry_value = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, entry_value));
                    }
                    Ok(SVal::Map(out))
                }
                "set" => {
                    exact_keys(object, &["$", "values"], path)?;
                    let values = object
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "set tag values must be an array"))?;
                    let mut out: Vec<SVal> = Vec::with_capacity(values.len());
                    for (index, entry) in values.iter().enumerate() {
                        let member = decode(entry, &format!("{path}[{index}]"), mode)?;
                        if out
                            .iter()
                            .any(|existing| same_value_zero(existing, &member))
                        {
                            return Err(err(&format!("{path}[{index}]"), "duplicate Set value"));
                        }
                        out.push(member);
                    }
                    Ok(SVal::Set(out))
                }
                "object" => {
                    exact_keys(object, &["$", "entries"], path)?;
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
                        if out.iter().any(|(existing, _)| existing == &key) {
                            return Err(err(&entry_path, "duplicate object key"));
                        }
                        let entry_value = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, entry_value));
                    }
                    Ok(SVal::Obj(out))
                }
                "instance" => {
                    if mode != Mode::Diagnostic {
                        return Err(err(path, "instance diagnostics are not input values"));
                    }
                    exact_keys(object, &["$", "name", "entries"], path)?;
                    let name = object
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .ok_or_else(|| err(path, "instance name must be a non-empty string"))?
                        .to_string();
                    let raw_entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "instance tag entries must be an array"))?;
                    let mut entries: Vec<(String, SVal)> = Vec::with_capacity(raw_entries.len());
                    for (index, entry) in raw_entries.iter().enumerate() {
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
                        if entries.iter().any(|(existing, _)| existing == &key) {
                            return Err(err(&entry_path, "duplicate instance key"));
                        }
                        entries
                            .push((key, decode(&pair[1], &format!("{entry_path}.value"), mode)?));
                    }
                    Ok(SVal::Instance { name, entries })
                }
                "callable" => {
                    if mode != Mode::Diagnostic {
                        return Err(err(path, "callable diagnostics are not input values"));
                    }
                    exact_keys(object, &["$"], path)?;
                    Ok(SVal::Callable)
                }
                "hole" => Err(err(
                    path,
                    "array-hole diagnostics are outside this finite corpus representation",
                )),
                other => Err(err(path, format!("unsupported tag {other}"))),
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Envelope, case, operation and transcript validation

const PRIMARY_SUITES: [(&str, &[&str]); 6] = [
    (
        "memory-api",
        &[
            "nullPercept",
            "observe",
            "noteSent",
            "recordChoice",
            "whereabouts",
        ],
    ),
    ("strategy", &["observe", "recordChoice", "decide"]),
    (
        "hunt-adapter",
        &["observe", "adapterDecide", "release", "awakeNear"],
    ),
    ("mob-tracker", &["trackerObserve", "trackerQuery"]),
    ("mob-hunter", &["hunterDecide", "isBanned"]),
    (
        "build-route",
        &["routeUpdate", "routePlan", "isContested", "campValue"],
    ),
];

const SUPPLEMENT_METHODS: &[&str] = &["observe", "recordChoice", "decide"];

fn suite_methods(suite: &str) -> Option<&'static [&'static str]> {
    PRIMARY_SUITES
        .iter()
        .find(|(name, _)| *name == suite)
        .map(|(_, methods)| *methods)
}

fn allowed_callback_name(name: &str) -> bool {
    const EXACT: [&str; 19] = [
        "paths.walk",
        "paths.path",
        "paths.los",
        "paths.clear",
        "paths.collisionMap",
        "services.log",
        "knowledge.factionEdge",
        "knowledge.weaponEdge",
        "knowledge.mobShare",
        "knowledge.odds",
        "learned.bias",
        "memory.whereabouts",
        "options.log",
        "options.attacking",
        "hunter.walk",
        "hunter.typeWeight",
        "adapter.typeWeight",
        "route.canFarm",
        "source.never",
    ];
    EXACT.contains(&name)
        || (name.starts_with("module.") && (name.ends_with(".enabled") || name.ends_with(".goals")))
}

/// Ordered callback/RNG diagnostics: exactly one sequence position per entry, a closed callback/rng field set, a known
/// receiver identity and a four-stream RNG contract (stream/index/value).
pub(crate) fn validate_transcript(value: &SVal, path: &str) -> R<()> {
    let events = match value {
        SVal::Arr(events) => events,
        other => return Err(err(path, format!("expected a tagged array, got {other:?}"))),
    };
    for (index, event) in events.iter().enumerate() {
        let event_path = format!("{path}[{index}]");
        let entries = match event {
            SVal::Obj(entries) => entries,
            other => {
                return Err(err(
                    &event_path,
                    format!("expected an object, got {other:?}"),
                ))
            }
        };
        let field = |name: &str| {
            entries
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value)
        };
        let require = |name: &str| {
            field(name).ok_or_else(|| err(&event_path, format!("missing field {name}")))
        };
        let sequence = require("sequence")?;
        if !matches!(sequence, SVal::Num(value) if *value == index as f64) {
            return Err(err(
                &event_path,
                format!("sequence must equal its position {index}"),
            ));
        }
        let kind = require("kind")?;
        match kind {
            SVal::Str(kind) if kind == "callback" => {
                if entries.len() != 5 {
                    return Err(err(
                        &event_path,
                        "callback event must have exactly sequence/kind/name/args/result",
                    ));
                }
                let name = require("name")?;
                match name {
                    SVal::Str(name) if allowed_callback_name(name) => {}
                    other => {
                        return Err(err(
                            &format!("{event_path}.name"),
                            format!("unsupported callback identity {other:?}"),
                        ))
                    }
                }
                match require("args")? {
                    SVal::Arr(_) => {}
                    other => {
                        return Err(err(
                            &format!("{event_path}.args"),
                            format!("callback args must be a tagged array, got {other:?}"),
                        ))
                    }
                }
                require("result")?;
            }
            SVal::Str(kind) if kind == "rng" => {
                if entries.len() != 5 {
                    return Err(err(
                        &event_path,
                        "rng event must have exactly sequence/kind/stream/index/value",
                    ));
                }
                match require("stream")? {
                    SVal::Str(stream)
                        if matches!(
                            stream.as_str(),
                            "decide" | "motor" | "lapse" | "knowledge"
                        ) => {}
                    other => {
                        return Err(err(
                            &format!("{event_path}.stream"),
                            format!("unsupported stream {other:?}"),
                        ))
                    }
                }
                match require("index")? {
                    SVal::Num(value)
                        if value.is_finite() && *value >= 0. && value.fract() == 0. => {}
                    other => {
                        return Err(err(
                            &format!("{event_path}.index"),
                            format!("stream ordinal must be a non-negative integer, got {other:?}"),
                        ))
                    }
                }
                match require("value")? {
                    SVal::Num(value) if value.is_finite() => {}
                    other => {
                        return Err(err(
                            &format!("{event_path}.value"),
                            format!("drawn value must be finite, got {other:?}"),
                        ))
                    }
                }
            }
            other => {
                return Err(err(
                    &format!("{event_path}.kind"),
                    format!("unsupported transcript kind {other:?}"),
                ))
            }
        }
    }
    Ok(())
}

fn validate_draw_counts(value: &Value, path: &str) -> R<()> {
    let counts = value
        .as_object()
        .ok_or_else(|| err(path, "drawCounts must be a plain JSON object"))?;
    let expected = ["decide", "motor", "lapse", "knowledge"];
    if counts.len() != expected.len() {
        return Err(err(
            path,
            format!("drawCounts must have exactly {expected:?}"),
        ));
    }
    for key in expected {
        let value = counts
            .get(key)
            .ok_or_else(|| err(path, format!("missing drawCount {key}")))?;
        let count = value.as_u64().ok_or_else(|| {
            err(
                &format!("{path}.{key}"),
                "draw count must be a non-negative integer",
            )
        })?;
        if count > 10_000_000 {
            return Err(err(
                &format!("{path}.{key}"),
                "draw count outside the finite corpus bound",
            ));
        }
    }
    Ok(())
}

fn validate_declaration(declaration: &SVal, method: &str, input: &SVal, path: &str) -> R<()> {
    let entries = match declaration {
        SVal::Obj(entries) => entries,
        other => {
            return Err(err(
                path,
                format!("declaration must be an object, got {other:?}"),
            ))
        }
    };
    let field = |name: &str| entries.iter().find(|(key, _)| key == name).map(|(_, v)| v);
    match field("method") {
        Some(SVal::Str(declared)) if declared == method => {}
        other => {
            return Err(err(
                &format!("{path}.method"),
                format!("declaration method must equal {method}, got {other:?}"),
            ))
        }
    }
    let mut keys: Vec<&str> = entries.iter().map(|(key, _)| key.as_str()).collect();
    keys.sort_unstable();
    let allowed: &[&str] = if method == "decide" {
        &["current", "engaged", "env", "method", "status"]
    } else {
        &["input", "method"]
    };
    for key in &keys {
        if !allowed.contains(key) {
            return Err(err(path, format!("unsupported declaration field {key}")));
        }
    }
    if method != "decide" {
        match field("input") {
            Some(declared_input) => {
                if !super::source_trace::ordered_same(declared_input, input) {
                    return Err(err(
                        path,
                        "declaration.input differs from the operation input (source declaration was mutated)",
                    ));
                }
            }
            None => {
                if !matches!(input, SVal::Undefined) {
                    return Err(err(
                        path,
                        "only a declaration with no caller input may omit it (and then the operation input is Undefined)",
                    ));
                }
            }
        }
    } else {
        for required in ["current", "status"] {
            if field(required).is_none() {
                return Err(err(path, format!("decide declaration missing {required}")));
            }
        }
        if let Some(engaged) = field("engaged") {
            if !matches!(engaged, SVal::Bool(_)) {
                return Err(err(
                    &format!("{path}.engaged"),
                    "declaration engaged must be a boolean",
                ));
            }
        }
        if let Some(env) = field("env") {
            let env_entries = match env {
                SVal::Obj(entries) => entries,
                other => {
                    return Err(err(
                        &format!("{path}.env"),
                        format!("environment override must be an object, got {other:?}"),
                    ))
                }
            };
            for (key, _) in env_entries {
                if key != "moduleGoals" {
                    return Err(err(
                        &format!("{path}.env"),
                        format!("unsupported environment override {key}"),
                    ));
                }
            }
            if let Some(goals) = env_entries
                .iter()
                .find(|(key, _)| key == "moduleGoals")
                .map(|(_, value)| value)
            {
                match goals {
                    SVal::Obj(modules) => {
                        for (module, offered) in modules {
                            match offered {
                                SVal::Arr(_) => {}
                                other => {
                                    return Err(err(
                                        &format!("{path}.env.moduleGoals"),
                                        format!(
                                        "module {module} offers must be an array, got {other:?}"
                                    ),
                                    ))
                                }
                            }
                        }
                    }
                    other => {
                        return Err(err(
                            &format!("{path}.env.moduleGoals"),
                            format!("moduleGoals must be an object, got {other:?}"),
                        ))
                    }
                }
            }
        }
    }
    Ok(())
}

fn validate_initial(case: &Value, suite: &str, path: &str) -> R<()> {
    let initial = case["initial"]
        .as_object()
        .ok_or_else(|| err(path, "initial must be a plain JSON object"))?;
    let expected: &[&str] = if suite == "strategy" {
        &["memory", "own", "state", "plan", "huntStats", "huntTarget"]
    } else {
        &["memory", "own"]
    };
    if initial.len() != expected.len() {
        return Err(err(path, format!("initial must have exactly {expected:?}")));
    }
    for key in expected {
        let value = initial
            .get(*key)
            .ok_or_else(|| err(path, format!("missing initial field {key}")))?;
        decode(value, &format!("{path}.{key}"), Mode::Diagnostic)?;
    }
    Ok(())
}

fn validate_setup(case: &Value, suite: &str, path: &str) -> R<()> {
    let setup_path = format!("{path}.setupTranscript");
    let value = decode(&case["setupTranscript"], &setup_path, Mode::Diagnostic)?;
    validate_transcript(&value, &setup_path)?;
    let events = match &value {
        SVal::Arr(events) => events,
        _ => unreachable!("checked"),
    };
    match suite {
        "strategy" | "hunt-adapter" => {
            if events.len() != 70 {
                return Err(err(
                    &setup_path,
                    format!(
                        "knowledge constructor transcript must hold exactly 70 draws, got {}",
                        events.len()
                    ),
                ));
            }
            for (index, event) in events.iter().enumerate() {
                let entries = match event {
                    SVal::Obj(entries) => entries,
                    _ => unreachable!("checked"),
                };
                let field = |name: &str| {
                    entries
                        .iter()
                        .find(|(key, _)| key == name)
                        .map(|(_, value)| value)
                };
                let stream = field("stream");
                let kind = field("kind");
                if !matches!(kind, Some(SVal::Str(kind)) if kind == "rng")
                    || !matches!(stream, Some(SVal::Str(stream)) if stream == "knowledge")
                {
                    return Err(err(
                        &format!("{setup_path}[{index}]"),
                        "setup transcript must be knowledge-stream RNG draws only",
                    ));
                }
                let expected_index = field("index");
                if !matches!(expected_index, Some(SVal::Num(value)) if *value == index as f64) {
                    return Err(err(
                        &format!("{setup_path}[{index}].index"),
                        "setup knowledge draw ordinal must equal its position",
                    ));
                }
            }
        }
        _ => {
            if !events.is_empty() {
                return Err(err(
                    &setup_path,
                    "this suite has no source constructor callbacks",
                ));
            }
        }
    }
    Ok(())
}

fn validate_operation(op: &Value, suite: &str, methods: &[&str], path: &str) -> R<()> {
    let operation = op
        .as_object()
        .ok_or_else(|| err(path, "operation must be a plain JSON object"))?;
    let method = operation
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "operation method must be a string"))?;
    if !methods.contains(&method) {
        return Err(err(
            &format!("{path}.method"),
            format!("method {method} is not part of suite {suite}"),
        ));
    }
    let mut allowed = vec![
        "method",
        "input",
        "declaration",
        "result",
        "memory",
        "own",
        "callbacks",
        "drawCounts",
    ];
    let suite_extras: &[&str] = match suite {
        "strategy" => &["state", "plan", "huntStats", "huntTarget"],
        "hunt-adapter" => &["stats", "target"],
        _ => &[],
    };
    allowed.extend_from_slice(suite_extras);
    if method == "decide" {
        allowed.push("identity");
    }
    for key in operation.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported operation field {key}")));
        }
    }
    for required in [
        "method",
        "input",
        "declaration",
        "result",
        "memory",
        "own",
        "callbacks",
        "drawCounts",
    ] {
        if !operation.contains_key(required) {
            return Err(err(path, format!("missing operation field {required}")));
        }
    }
    for key in suite_extras {
        if !operation.contains_key(*key) {
            return Err(err(
                path,
                format!("suite {suite} operation must carry the {key} getter row"),
            ));
        }
    }
    let input = decode(&op["input"], &format!("{path}.input"), Mode::Input)?;
    let declaration = decode(
        &op["declaration"],
        &format!("{path}.declaration"),
        Mode::Input,
    )?;
    validate_declaration(&declaration, method, &input, &format!("{path}.declaration"))?;
    let result = decode(&op["result"], &format!("{path}.result"), Mode::Diagnostic)?;
    let _ = result;
    decode(&op["memory"], &format!("{path}.memory"), Mode::Diagnostic)?;
    decode(&op["own"], &format!("{path}.own"), Mode::Diagnostic)?;
    let callbacks = decode(
        &op["callbacks"],
        &format!("{path}.callbacks"),
        Mode::Diagnostic,
    )?;
    validate_transcript(&callbacks, &format!("{path}.callbacks"))?;
    validate_draw_counts(&op["drawCounts"], &format!("{path}.drawCounts"))?;
    for extra in suite_extras {
        decode(&op[*extra], &format!("{path}.{extra}"), Mode::Diagnostic)?;
    }
    if method == "decide" {
        let identity = op["identity"].as_object().ok_or_else(|| {
            err(
                &format!("{path}.identity"),
                "identity must be a plain {returnedCurrentGoal: boolean} object",
            )
        })?;
        if identity.len() != 1
            || identity
                .get("returnedCurrentGoal")
                .and_then(Value::as_bool)
                .is_none()
        {
            return Err(err(
                &format!("{path}.identity"),
                "identity must be exactly {returnedCurrentGoal: boolean}",
            ));
        }
    } else if operation.contains_key("identity") {
        return Err(err(path, "identity is only recorded for decide operations"));
    }
    // Method-compatible declared input shape (the typed detail is checked again by the replay preflight).
    match (suite, method) {
        (_, "observe") => {
            if !matches!(input, SVal::Obj(_)) {
                return Err(err(
                    &format!("{path}.input"),
                    "observe input must be a tagged percept object",
                ));
            }
        }
        ("memory-api", "nullPercept") => {
            if !matches!(input, SVal::Null) {
                return Err(err(
                    &format!("{path}.input"),
                    "nullPercept input must be null",
                ));
            }
            if !op["result"].is_null() {
                return Err(err(
                    &format!("{path}.result"),
                    "nullPercept result must be null",
                ));
            }
        }
        ("memory-api", "recordChoice") | ("strategy", "recordChoice") => {
            if !matches!(input, SVal::Str(_)) {
                return Err(err(
                    &format!("{path}.input"),
                    "recordChoice input must be a declared choice key string",
                ));
            }
        }
        ("memory-api", "noteSent") => {
            if !matches!(input, SVal::Obj(_)) {
                return Err(err(
                    &format!("{path}.input"),
                    "noteSent input must be a tagged command object",
                ));
            }
        }
        ("memory-api", "whereabouts") => {
            if !matches!(input, SVal::Obj(_)) {
                return Err(err(
                    &format!("{path}.input"),
                    "whereabouts input must be a tagged object",
                ));
            }
        }
        (_, "decide") => {
            if !matches!(input, SVal::Obj(_)) {
                return Err(err(
                    &format!("{path}.input"),
                    "decide input must be a tagged object",
                ));
            }
        }
        ("hunt-adapter", "adapterDecide") | ("hunt-adapter", "release") => {
            if !matches!(input, SVal::Undefined) {
                return Err(err(
                    &format!("{path}.input"),
                    "this source method takes no caller input; the declaration must be method-only",
                ));
            }
        }
        ("mob-tracker", "trackerObserve")
        | ("mob-tracker", "trackerQuery")
        | ("mob-hunter", "hunterDecide")
        | ("mob-hunter", "isBanned")
        | ("build-route", "routeUpdate")
        | ("build-route", "routePlan")
        | ("build-route", "isContested")
        | ("build-route", "campValue")
        | ("hunt-adapter", "awakeNear") => {
            if matches!(input, SVal::Undefined) {
                return Err(err(
                    &format!("{path}.input"),
                    "this method consumes a declared input",
                ));
            }
        }
        (suite, method) => {
            return Err(err(
                path,
                format!("no declared-input contract for {suite}.{method}"),
            ))
        }
    }
    Ok(())
}

fn validate_case(case: &Value, supplement: bool, path: &str) -> R<()> {
    let object = case
        .as_object()
        .ok_or_else(|| err(path, "case must be a plain JSON object"))?;
    let expected: &[&str] = &[
        "id",
        "suite",
        "covers",
        "config",
        "initial",
        "setupTranscript",
        "operations",
    ];
    if object.len() != expected.len() {
        return Err(err(path, format!("case must have exactly {expected:?}")));
    }
    for key in expected {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing case field {key}")));
        }
    }
    let id = case["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| err(path, "case id must be a non-empty string"))?;
    let suite = case["suite"]
        .as_str()
        .ok_or_else(|| err(path, "case suite must be a string"))?;
    let methods: &'static [&'static str] = if supplement {
        if suite != "strategy" {
            return Err(err(
                path,
                format!("supplement cases are strategy histories, got suite {suite}"),
            ));
        }
        SUPPLEMENT_METHODS
    } else {
        suite_methods(suite).ok_or_else(|| err(path, format!("unsupported suite {suite}")))?
    };
    match case["covers"].as_array() {
        Some(covers) if covers.iter().all(|cover| cover.as_str().is_some()) => {}
        _ => return Err(err(path, "covers must be an array of strings")),
    }
    decode(&case["config"], &format!("{path}.config"), Mode::Input)?;
    validate_initial(case, suite, &format!("{path}.initial"))?;
    validate_setup(case, suite, &format!("{path}.setupTranscript"))?;
    let operations = case["operations"]
        .as_array()
        .filter(|operations| !operations.is_empty())
        .ok_or_else(|| err(path, "case operations must be a non-empty array"))?;
    for (index, op) in operations.iter().enumerate() {
        validate_operation(
            op,
            suite,
            methods,
            &format!("{path}[{id}].operations[{index}]"),
        )?;
    }
    Ok(())
}

fn validate_profile(profile: &Value, path: &str) -> R<()> {
    validate_profile_kind(profile, path, true)
}

fn validate_profile_kind(profile: &Value, path: &str, primary: bool) -> R<()> {
    let object = profile
        .as_object()
        .ok_or_else(|| err(path, "profile must be a plain JSON object"))?;
    for key in [
        "sourceBase",
        "boundary",
        "image",
        "node",
        "platform",
        "arch",
    ] {
        match object.get(key) {
            Some(Value::String(text)) if !text.is_empty() => {}
            _ => return Err(err(&format!("{path}.{key}"), "required non-empty string")),
        }
    }
    let required_objects: &[&str] = if primary {
        &[
            "actualRuntimeImports",
            "sourceInventory",
            "configFiles",
            "dependencyVersions",
            "toolFiles",
        ]
    } else {
        &[
            "primaryManifest",
            "primaryFilesBefore",
            "primaryFilesAfter",
            "sourceInventory",
            "configFiles",
            "toolFiles",
        ]
    };
    for key in required_objects {
        if !object.get(*key).is_some_and(Value::is_object) {
            return Err(err(&format!("{path}.{key}"), "required non-empty object"));
        }
    }
    if !primary {
        match object.get("primarySeal") {
            Some(Value::String(seal)) if seal.len() >= 8 => {}
            _ => {
                return Err(err(
                    &format!("{path}.primarySeal"),
                    "required primary seal string",
                ))
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_primary(source: &Value) -> R<()> {
    let object = source
        .as_object()
        .ok_or_else(|| err("source", "expected a JSON object"))?;
    let keys: Vec<&str> = object.keys().map(String::as_str).collect();
    let mut expected = vec!["format", "methodValue", "profile", "maps", "cases"];
    expected.sort_unstable();
    let mut keys_sorted = keys.clone();
    keys_sorted.sort_unstable();
    if keys_sorted != expected {
        return Err(err(
            "source",
            format!("source envelope must have exactly {expected:?}"),
        ));
    }
    if source["format"] != "rh-bot-private-strategy-source/1" {
        return Err(err("source.format", "unsupported source format"));
    }
    if source["methodValue"] != "rh-method-value/1" {
        return Err(err("source.methodValue", "unsupported method value format"));
    }
    validate_profile(&source["profile"], "source.profile")?;
    let maps = source["maps"]
        .as_array()
        .filter(|maps| maps.len() == 1)
        .ok_or_else(|| err("source.maps", "exactly one generated map is required"))?;
    match maps[0].as_object() {
        Some(map)
            if map.len() == 4
                && map.get("id").and_then(Value::as_str) == Some("generated7")
                && map.get("constructor").is_some()
                && map.get("mapHashU32").and_then(Value::as_u64).is_some() =>
        {
            decode(
                map.get("constructor").expect("checked"),
                "source.maps[0].constructor",
                Mode::Input,
            )?;
            decode(&map["value"], "source.maps[0].value", Mode::Input)?;
        }
        _ => {
            return Err(err(
                "source.maps[0]",
                "expected {id:'generated7', constructor, mapHashU32, value: map}",
            ))
        }
    }
    let cases = source["cases"]
        .as_array()
        .filter(|cases| !cases.is_empty())
        .ok_or_else(|| err("source.cases", "cases must be a non-empty array"))?;
    let mut ids = std::collections::BTreeSet::new();
    let mut suites = std::collections::BTreeMap::new();
    for (index, case) in cases.iter().enumerate() {
        validate_case(case, false, &format!("source.cases[{index}]"))?;
        let id = case["id"].as_str().expect("validated").to_string();
        if !ids.insert(id.clone()) {
            return Err(err("source.cases", format!("duplicate case id {id}")));
        }
        *suites
            .entry(case["suite"].as_str().expect("validated").to_string())
            .or_insert(0usize) += 1;
    }
    for (suite, _) in PRIMARY_SUITES {
        if suites.get(suite).copied().unwrap_or(0) == 0 {
            return Err(err(
                "source.cases",
                format!("required suite {suite} is absent (skipped suites are rejected)"),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_supplement(supplement: &Value) -> R<()> {
    let object = supplement
        .as_object()
        .ok_or_else(|| err("supplement", "expected a JSON object"))?;
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    let expected = [
        "assertions",
        "cases",
        "format",
        "mapReference",
        "methodValue",
        "profile",
    ];
    if keys != expected {
        return Err(err(
            "supplement",
            format!("supplement envelope must have exactly {expected:?}"),
        ));
    }
    if supplement["format"] != "rh-bot-module-goal-key-source/1" {
        return Err(err("supplement.format", "unsupported supplement format"));
    }
    if supplement["methodValue"] != "rh-method-value/1" {
        return Err(err(
            "supplement.methodValue",
            "unsupported method value format",
        ));
    }
    validate_profile_kind(&supplement["profile"], "supplement.profile", false)?;
    match supplement["mapReference"].as_object() {
        Some(reference)
            if reference.len() == 3
                && reference.get("id").and_then(Value::as_str) == Some("generated7")
                && reference
                    .get("primarySourceSha256")
                    .and_then(Value::as_str)
                    .is_some_and(|sha| sha.len() == 64)
                && reference
                    .get("mapHashU32")
                    .and_then(Value::as_u64)
                    .is_some() => {}
        _ => {
            return Err(err(
                "supplement.mapReference",
                "expected {primarySourceSha256, id:'generated7', mapHashU32}",
            ))
        }
    }
    let assertions = supplement["assertions"]
        .as_array()
        .filter(|assertions| assertions.len() == 4)
        .ok_or_else(|| err("supplement.assertions", "exactly four reached assertions"))?;
    for (index, assertion) in assertions.iter().enumerate() {
        let object = assertion.as_object().ok_or_else(|| {
            err(
                &format!("supplement.assertions[{index}]"),
                "expected object",
            )
        })?;
        if object.len() != 2
            || object.get("name").and_then(Value::as_str).is_none()
            || object.get("result").and_then(Value::as_str) != Some("PASS")
        {
            return Err(err(
                &format!("supplement.assertions[{index}]"),
                "expected {name: string, result: 'PASS'}",
            ));
        }
    }
    let cases = supplement["cases"]
        .as_array()
        .filter(|cases| cases.len() == 4)
        .ok_or_else(|| err("supplement.cases", "exactly four cases"))?;
    let mut ids = std::collections::BTreeSet::new();
    for (index, case) in cases.iter().enumerate() {
        validate_case(case, true, &format!("supplement.cases[{index}]"))?;
        let id = case["id"].as_str().expect("validated").to_string();
        if !ids.insert(id.clone()) {
            return Err(err("supplement.cases", format!("duplicate case id {id}")));
        }
    }
    Ok(())
}

/// One actual operation's structural intake: strict tagged decode + envelope/key/method/declaration/transcript checks.
/// The typed consumed-field preflight in source_tests runs after this and before any native mutation.
pub(crate) fn validate_operation_on_path(
    op: &Value,
    suite: &str,
    supplement: bool,
    path: &str,
) -> R<()> {
    let methods: &[&str] = if supplement {
        SUPPLEMENT_METHODS
    } else {
        suite_methods(suite).ok_or_else(|| err(path, format!("unsupported suite {suite}")))?
    };
    validate_operation(op, suite, methods, path)
}
