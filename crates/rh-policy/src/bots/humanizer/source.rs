//! Strict native intake and comparison for the sealed direct feature-aware hand source supplement
//! (`parity/policy/bot-private-brain/source.json`, format `rh-bot-private-brain-source/1`, `handSupplement`).
//!
//! Root source release: independent fresh pinned reproduction of source `6aaa4c6d` released the frozen corpus through
//! cherry-pick `90b191b3` (source bytes pinned by `docs/evidence/bot-private-brain-source/README.md`; independent review
//! `docs/evidence/bot-private-brain-source-review/README.md`). The supplement was produced by the actual unchanged
//! `createHumanizer` (`tools/bot-private-brain-fixtures/hand.mts`): six feature profiles, two real submit→later-release
//! operations each, twelve operations in total, with the raw `motor`/`lapse` draw sequence, released commands, misses,
//! stats and continued draw counts recorded from real source.
//!
//! This reader is strict native intake, not a reimplementation of the expected answers: it decodes the declared inputs
//! (feature profile, full hard tier, seeds, open map, percepts, intents), validates every consumed source fact and leaves
//! the hand to compute the results. The expected traces/commands/stats are compared exactly (continuous geometry and delay
//! leaves at the same 1e-9 relative tolerance the admitted bot-core hand parity uses; every discrete value and every draw
//! is exact). Nothing here is generated from native answers, and no source expected value is installed as hand state.
//!
//! Boundary: this is the narrow hand lease of `docs/backlog/packets/P-BOT-HAND-FEATURE-1.md`. The declared `memory`
//! snapshots are a side observation of the real Memory the source supplement also constructed; the hand itself never reads
//! them and the admitted Memory component owns its own witnesses, so the reader validates their declared shape and the
//! hand comparison does not compare them. No full Brain composition, fair observation binding or live activation is implied.

use super::{Context, Humanizer, HumanizerStats};
use crate::bots::clicks::BotMap;
use crate::bots::random::Rng;
use crate::bots::types::{
    Appraisal, Attention, BotWeapon, Cadence, Caution, ChooseMsg, ClickMiss, Command,
    ContainerView, ExGaussian, FighterView, Hesitation, HudView, Intent, IntentBody, IntentKind,
    IntentTiming, MobView, MoveScatter, Orbwalk, OwnerLock, Percept, PerceptExtras, PlanMsg, Route,
    SelfView, Stimulus, StimulusKind, TargetScatter, TierId, TierParams, TimedCommand,
    COMMAND_TYPES,
};
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2};
use serde_json::Value;

/// The sealed corpus is read from the worktree at test run time (22 MB: too large to embed in the test binary).
fn load_source() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-private-brain/source.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read sealed hand source {}: {error}", path.display()));
    serde_json::from_str(&text).expect("sealed hand source.json is valid JSON")
}

fn err(path: &str, message: impl Into<String>) -> String {
    format!("{path}: {}", message.into())
}

// ------------------------------------------------------------------------------------------------ tagged MethodValue

/// The sealed corpus's ordered MethodValue codec (`tools/bot-private-brain-fixtures/codec.mts`, `rh-method-value/1`).
/// Only the tags the direct hand supplement declares are accepted; instance/callable/hole/map/set are rejected here (the
/// one declared side observation that carries Maps, `memory`, is shape-checked raw below and never decoded).
#[derive(Clone, Debug, PartialEq)]
enum Mv {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Mv>),
    U8(Vec<u8>),
    Obj(Vec<(String, Mv)>),
}

fn decode_mv(value: &Value, path: &str) -> Result<Mv, String> {
    match value {
        Value::Null => Ok(Mv::Null),
        Value::Bool(flag) => Ok(Mv::Bool(*flag)),
        Value::Number(number) => number
            .as_f64()
            .filter(|number| number.is_finite())
            .map(Mv::Num)
            .ok_or_else(|| err(path, "expected a finite JSON number")),
        Value::String(text) => Ok(Mv::Str(text.clone())),
        Value::Array(_) => Err(err(path, "raw JSON arrays are not tagged method values")),
        Value::Object(fields) => {
            let tag = fields
                .get("$")
                .and_then(Value::as_str)
                .ok_or_else(|| err(path, "missing $ tag"))?;
            match tag {
                "undefined" => {
                    exact_tag_fields(fields, &["$"], path)?;
                    Ok(Mv::Undefined)
                }
                "number" => {
                    exact_tag_fields(fields, &["$", "value"], path)?;
                    let encoded = fields
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "number tag needs a string value"))?;
                    let number = match encoded {
                        "NaN" => f64::NAN,
                        "+Infinity" => f64::INFINITY,
                        "-Infinity" => f64::NEG_INFINITY,
                        "-0" => -0.0,
                        other => return Err(err(path, format!("unknown number tag {other}"))),
                    };
                    Ok(Mv::Num(number))
                }
                "u8" => {
                    exact_tag_fields(fields, &["$", "values"], path)?;
                    let values = fields
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "u8 tag needs a values array"))?;
                    let mut bytes = Vec::with_capacity(values.len());
                    for (index, value) in values.iter().enumerate() {
                        let byte = value
                            .as_u64()
                            .filter(|value| *value <= u64::from(u8::MAX))
                            .ok_or_else(|| {
                                err(&format!("{path}.values[{index}]"), "expected a u8")
                            })?;
                        bytes.push(byte as u8);
                    }
                    Ok(Mv::U8(bytes))
                }
                "array" => {
                    exact_tag_fields(fields, &["$", "values"], path)?;
                    let values = fields
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "array tag needs a values array"))?;
                    let mut items = Vec::with_capacity(values.len());
                    for (index, value) in values.iter().enumerate() {
                        items.push(decode_mv(value, &format!("{path}[{index}]"))?);
                    }
                    Ok(Mv::Arr(items))
                }
                "object" => {
                    exact_tag_fields(fields, &["$", "entries"], path)?;
                    let entries = fields
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "object tag needs an entries array"))?;
                    let mut members: Vec<(String, Mv)> = Vec::with_capacity(entries.len());
                    for (index, pair) in entries.iter().enumerate() {
                        let pair = pair.as_array().ok_or_else(|| {
                            err(
                                &format!("{path}.entries[{index}]"),
                                "expected a key/value pair",
                            )
                        })?;
                        if pair.len() != 2 {
                            return Err(err(
                                &format!("{path}.entries[{index}]"),
                                "expected [key, value]",
                            ));
                        }
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(&format!("{path}.entries[{index}]"), "expected a string key")
                            })?
                            .to_string();
                        if members.iter().any(|(member, _)| *member == key) {
                            return Err(err(
                                &format!("{path}.entries[{index}]"),
                                format!("duplicate object key {key}"),
                            ));
                        }
                        let value = decode_mv(&pair[1], &format!("{path}.{key}"))?;
                        members.push((key, value));
                    }
                    Ok(Mv::Obj(members))
                }
                other => Err(err(path, format!("unsupported method-value tag {other}"))),
            }
        }
    }
}

fn exact_tag_fields(
    fields: &serde_json::Map<String, Value>,
    allowed: &[&str],
    path: &str,
) -> Result<(), String> {
    for key in fields.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unexpected tag field {key}")));
        }
    }
    for key in allowed {
        if !fields.contains_key(*key) {
            return Err(err(path, format!("missing tag field {key}")));
        }
    }
    Ok(())
}

impl Mv {
    fn obj<'a>(&'a self, path: &str) -> Result<&'a [(String, Mv)], String> {
        match self {
            Mv::Obj(members) => Ok(members),
            _ => Err(err(path, "expected a tagged object")),
        }
    }

    fn arr<'a>(&'a self, path: &str) -> Result<&'a [Mv], String> {
        match self {
            Mv::Arr(items) => Ok(items),
            _ => Err(err(path, "expected a tagged array")),
        }
    }

    fn get<'a>(&'a self, key: &str, path: &str) -> Result<&'a Mv, String> {
        self.obj(path)?
            .iter()
            .find(|(member, _)| member == key)
            .map(|(_, value)| value)
            .ok_or_else(|| err(path, format!("missing member {key}")))
    }

    fn optional<'a>(&'a self, key: &str, path: &str) -> Result<Option<&'a Mv>, String> {
        Ok(self
            .obj(path)?
            .iter()
            .find(|(member, _)| member == key)
            .map(|(_, value)| value))
    }

    /// The object is closed over exactly `keys` (any order; duplicates are rejected by `decode_mv`).
    fn exact(&self, keys: &[&str], path: &str) -> Result<(), String> {
        let members = self.obj(path)?;
        for (member, _) in members {
            if !keys.contains(&member.as_str()) {
                return Err(err(path, format!("unexpected member {member}")));
            }
        }
        for key in keys {
            if !members.iter().any(|(member, _)| member == key) {
                return Err(err(path, format!("missing member {key}")));
            }
        }
        Ok(())
    }

    /// The object carries exactly `required` plus any of `optional`.
    fn closed(&self, required: &[&str], optional: &[&str], path: &str) -> Result<(), String> {
        let members = self.obj(path)?;
        for (member, _) in members {
            if !required.contains(&member.as_str()) && !optional.contains(&member.as_str()) {
                return Err(err(path, format!("unexpected member {member}")));
            }
        }
        for key in required {
            if !members.iter().any(|(member, _)| member == key) {
                return Err(err(path, format!("missing member {key}")));
            }
        }
        Ok(())
    }

    fn num(&self, path: &str) -> Result<f64, String> {
        match self {
            Mv::Num(value) if value.is_finite() => Ok(*value),
            Mv::Num(_) => Err(err(path, "nonfinite declared number")),
            _ => Err(err(path, "expected a number")),
        }
    }

    fn uint(&self, path: &str) -> Result<u32, String> {
        match self {
            Mv::Num(value)
                if value.is_finite()
                    && value.fract() == 0.
                    && *value >= 0.
                    && *value <= f64::from(u32::MAX) =>
            {
                Ok(*value as u32)
            }
            _ => Err(err(path, "expected a u32")),
        }
    }

    fn i8_number(&self, path: &str) -> Result<i8, String> {
        match self {
            Mv::Num(value)
                if value.is_finite()
                    && value.fract() == 0.
                    && *value >= f64::from(i8::MIN)
                    && *value <= f64::from(i8::MAX) =>
            {
                Ok(*value as i8)
            }
            _ => Err(err(path, "expected an i8")),
        }
    }

    fn boolean(&self, path: &str) -> Result<bool, String> {
        match self {
            Mv::Bool(flag) => Ok(*flag),
            _ => Err(err(path, "expected a boolean")),
        }
    }

    fn text(&self, path: &str) -> Result<&str, String> {
        match self {
            Mv::Str(text) => Ok(text),
            _ => Err(err(path, "expected a string")),
        }
    }

    fn null(&self) -> bool {
        matches!(self, Mv::Null)
    }

    fn string_list(&self, path: &str) -> Result<Vec<String>, String> {
        self.arr(path)?
            .iter()
            .enumerate()
            .map(|(index, item)| item.text(&format!("{path}[{index}]")).map(str::to_string))
            .collect()
    }
}

// ---------------------------------------------------------------------------------------------------- sealed hand model

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Lane {
    Decide,
    Motor,
    Lapse,
}

impl Lane {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "decide" => Some(Lane::Decide),
            "motor" => Some(Lane::Motor),
            "lapse" => Some(Lane::Lapse),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct Counts {
    decide: u32,
    motor: u32,
    lapse: u32,
}

impl Counts {
    fn get(&self, lane: Lane) -> u32 {
        match lane {
            Lane::Decide => self.decide,
            Lane::Motor => self.motor,
            Lane::Lapse => self.lapse,
        }
    }

    fn add(&mut self, lane: Lane, drawn: u32) {
        match lane {
            Lane::Decide => self.decide += drawn,
            Lane::Motor => self.motor += drawn,
            Lane::Lapse => self.lapse += drawn,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Draw {
    lane: Lane,
    index: u32,
    value: f64,
}

#[derive(Clone, Debug)]
struct Seeds {
    decide: u32,
    motor: u32,
    lapse: u32,
    knowledge: u32,
}

#[derive(Clone, Debug)]
struct HandOperation {
    percept: Percept,
    intents: Vec<Intent>,
    submit_trace: Vec<Draw>,
    release_percept: Percept,
    result: Vec<TimedCommand>,
    release_trace: Vec<Draw>,
    misses: Vec<ClickMiss>,
    stats: HumanizerStats,
    counts: Counts,
    memory_keys: Vec<String>,
}

#[derive(Clone, Debug)]
struct HandProfile {
    name: String,
    features: Option<Features>,
    tier: TierParams,
    seeds: Seeds,
    operations: Vec<HandOperation>,
}

struct HandCorpus {
    map: BotMap,
    map_hash_u32: u32,
    profiles: Vec<HandProfile>,
}

// ------------------------------------------------------------------------------------------------------------ reading

const PROFILE_ORDER: [&str; 6] = [
    "absent",
    "empty",
    "attack-only",
    "target-only",
    "partial",
    "all",
];

fn read_hand_corpus(source: &Value) -> Result<HandCorpus, String> {
    let format = source
        .get("format")
        .and_then(Value::as_str)
        .ok_or_else(|| err("source", "missing format"))?;
    if format != "rh-bot-private-brain-source/1" {
        return Err(err("source.format", format!("unexpected format {format}")));
    }
    let method_value = source
        .get("methodValue")
        .and_then(Value::as_str)
        .ok_or_else(|| err("source", "missing methodValue"))?;
    if method_value != "rh-method-value/1" {
        return Err(err(
            "source.methodValue",
            format!("unexpected method-value format {method_value}"),
        ));
    }
    let (map, map_hash_u32) = read_open_map(source)?;
    let profiles_json = source
        .get("handSupplement")
        .and_then(Value::as_array)
        .ok_or_else(|| err("source.handSupplement", "expected an array"))?;
    if profiles_json.len() != PROFILE_ORDER.len() {
        return Err(err(
            "source.handSupplement",
            format!(
                "expected {} direct hand profiles, found {}",
                PROFILE_ORDER.len(),
                profiles_json.len()
            ),
        ));
    }
    let mut profiles = Vec::with_capacity(PROFILE_ORDER.len());
    for (index, expected) in PROFILE_ORDER.iter().enumerate() {
        profiles.push(read_profile(&profiles_json[index], expected, index)?);
    }
    Ok(HandCorpus {
        map,
        map_hash_u32,
        profiles,
    })
}

fn read_open_map(source: &Value) -> Result<(BotMap, u32), String> {
    let maps = source
        .get("maps")
        .and_then(Value::as_array)
        .ok_or_else(|| err("source.maps", "expected an array"))?;
    let entry = maps
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some("open"))
        .ok_or_else(|| err("source.maps", "missing the open map"))?;
    let object = entry
        .as_object()
        .ok_or_else(|| err("source.maps.open", "expected an object"))?;
    for key in object.keys() {
        if !["id", "mapHashU32", "value"].contains(&key.as_str()) {
            return Err(err("source.maps.open", format!("unexpected member {key}")));
        }
    }
    let hash = object
        .get("mapHashU32")
        .and_then(Value::as_u64)
        .filter(|hash| *hash <= u64::from(u32::MAX))
        .ok_or_else(|| err("source.maps.open.mapHashU32", "expected a u32"))? as u32;
    let value = object
        .get("value")
        .ok_or_else(|| err("source.maps.open", "missing value"))?;
    let decoded = decode_mv(value, "source.maps.open.value")?;
    let map_path = "source.maps.open.value";
    decoded.exact(
        &[
            "seed",
            "w",
            "h",
            "tiles",
            "terrain",
            "props",
            "attempt",
            "territoryGrid",
            "regionGrid",
            "coliseum",
            "regions",
            "camps",
            "spawnPool",
            "buildings",
            "spawns",
            "crateSpots",
            "groundSpots",
            "features",
            "featureGrid",
        ],
        map_path,
    )?;
    let seed = decoded
        .get("seed", map_path)?
        .uint(&format!("{map_path}.seed"))?;
    if seed != 0 {
        return Err(err(
            &format!("{map_path}.seed"),
            format!("the declared open arena seed is {seed}, expected 0"),
        ));
    }
    let w = decoded.get("w", map_path)?.uint(&format!("{map_path}.w"))?;
    let h = decoded.get("h", map_path)?.uint(&format!("{map_path}.h"))?;
    if w == 0 || h == 0 {
        return Err(err(map_path, "empty map dimensions"));
    }
    let cells = (w as usize) * (h as usize);
    decoded
        .get("attempt", map_path)?
        .uint(&format!("{map_path}.attempt"))?;
    let tiles = read_byte_grid(
        decoded.get("tiles", map_path)?,
        &format!("{map_path}.tiles"),
        cells,
    )?;
    // The other map layers are declared GameMap facts; the hand's click model reads only the collision layer (tiles),
    // so the remaining declared grids/records are shape-checked here and not reconstructed.
    for key in ["terrain", "territoryGrid", "regionGrid", "featureGrid"] {
        read_byte_grid(
            decoded.get(key, map_path)?,
            &format!("{map_path}.{key}"),
            cells,
        )?;
    }
    for key in [
        "props",
        "regions",
        "camps",
        "spawnPool",
        "buildings",
        "spawns",
        "crateSpots",
        "groundSpots",
        "features",
    ] {
        decoded
            .get(key, map_path)?
            .arr(&format!("{map_path}.{key}"))?;
    }
    decoded
        .get("coliseum", map_path)?
        .obj(&format!("{map_path}.coliseum"))?;
    Ok((BotMap::new(i64::from(w), i64::from(h), tiles), hash))
}

fn read_byte_grid(value: &Mv, path: &str, cells: usize) -> Result<Vec<u8>, String> {
    let bytes = match value {
        Mv::U8(bytes) => bytes.clone(),
        _ => return Err(err(path, "expected a u8 array")),
    };
    if bytes.len() != cells {
        return Err(err(
            path,
            format!("{} bytes for a {cells}-cell grid", bytes.len()),
        ));
    }
    Ok(bytes)
}

fn read_profile(
    value: &Value,
    expected: &str,
    profile_index: usize,
) -> Result<HandProfile, String> {
    let path = format!("source.handSupplement[{profile_index}]");
    let object = value
        .as_object()
        .ok_or_else(|| err(&path, "expected an object"))?;
    for key in object.keys() {
        if !["profile", "features", "tier", "seeds", "operations"].contains(&key.as_str()) {
            return Err(err(&path, format!("unexpected member {key}")));
        }
    }
    let name = object
        .get("profile")
        .and_then(Value::as_str)
        .ok_or_else(|| err(&path, "missing profile name"))?;
    if name != expected {
        return Err(err(
            &format!("{path}.profile"),
            format!("expected profile {expected}, found {name}"),
        ));
    }
    let features = read_features(
        &decode_mv(
            object
                .get("features")
                .ok_or_else(|| err(&path, "missing features"))?,
            &format!("{path}.features"),
        )?,
        &format!("{path}.features"),
    )?;
    let tier = read_tier(
        &decode_mv(
            object
                .get("tier")
                .ok_or_else(|| err(&path, "missing tier"))?,
            &format!("{path}.tier"),
        )?,
        &format!("{path}.tier"),
    )?;
    // The direct hand supplement declares the four runtime seed numbers as plain JSON (an input descriptor, not a
    // tagged method value); they are still required to be exact non-negative 32-bit integers.
    let seeds = read_seeds(
        object
            .get("seeds")
            .ok_or_else(|| err(&path, "missing seeds"))?,
        &format!("{path}.seeds"),
    )?;
    let operations = object
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| err(&format!("{path}.operations"), "expected an array"))?;
    if operations.len() != 2 {
        return Err(err(
            &format!("{path}.operations"),
            format!(
                "expected 2 real submit/release operations, found {}",
                operations.len()
            ),
        ));
    }
    let mut prof = HandProfile {
        name: name.to_string(),
        features,
        tier,
        seeds,
        operations: Vec::with_capacity(operations.len()),
    };
    let mut drawn = Counts::default();
    for (index, operation) in operations.iter().enumerate() {
        let op = read_operation(operation, &format!("{path}.operations[{index}]"))?;
        let label = format!("{}.operations[{index}]", prof.name);
        // The declared draw indices are the actual chronological per-lane sequence of one profile lifetime: submit
        // first, then the later release of the same hand. They must start at 0, be contiguous, and agree with the
        // recorded cumulative counts after every operation; the decoder never reorders traces.
        for draw in op.submit_trace.iter().chain(op.release_trace.iter()) {
            if draw.lane == Lane::Decide {
                return Err(err(
                    &label,
                    "the direct hand reads only the motor and lapse lanes but a decide draw is recorded",
                ));
            }
            if draw.index != drawn.get(draw.lane) {
                return Err(err(
                    &label,
                    format!(
                        "{} draw index {} is not the next declared index {}",
                        match draw.lane {
                            Lane::Decide => "decide",
                            Lane::Motor => "motor",
                            Lane::Lapse => "lapse",
                        },
                        draw.index,
                        drawn.get(draw.lane)
                    ),
                ));
            }
            drawn.add(draw.lane, 1);
        }
        if drawn != op.counts {
            return Err(err(
                &label,
                format!(
                    "recorded counts {:?} disagree with the trace's cumulative counts {:?}",
                    op.counts, drawn
                ),
            ));
        }
        if drawn.decide != 0 {
            return Err(err(&label, "the direct hand records no decide draws"));
        }
        prof.operations.push(op);
    }
    Ok(prof)
}

fn read_operation(value: &Value, path: &str) -> Result<HandOperation, String> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "expected an object"))?;
    for key in object.keys() {
        if ![
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
        ]
        .contains(&key.as_str())
        {
            return Err(err(path, format!("unexpected member {key}")));
        }
    }
    for key in [
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
    ] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing member {key}")));
        }
    }
    Ok(HandOperation {
        percept: read_percept(
            &decode_mv(&object["percept"], &format!("{path}.percept"))?,
            &format!("{path}.percept"),
        )?,
        intents: read_intents(
            &decode_mv(&object["intents"], &format!("{path}.intents"))?,
            &format!("{path}.intents"),
        )?,
        submit_trace: read_trace(
            &decode_mv(&object["submitTrace"], &format!("{path}.submitTrace"))?,
            &format!("{path}.submitTrace"),
        )?,
        release_percept: read_percept(
            &decode_mv(&object["releasePercept"], &format!("{path}.releasePercept"))?,
            &format!("{path}.releasePercept"),
        )?,
        result: read_timed_commands(
            &decode_mv(&object["result"], &format!("{path}.result"))?,
            &format!("{path}.result"),
        )?,
        release_trace: read_trace(
            &decode_mv(&object["releaseTrace"], &format!("{path}.releaseTrace"))?,
            &format!("{path}.releaseTrace"),
        )?,
        misses: read_misses(
            &decode_mv(&object["misses"], &format!("{path}.misses"))?,
            &format!("{path}.misses"),
        )?,
        stats: read_stats(
            &decode_mv(&object["stats"], &format!("{path}.stats"))?,
            &format!("{path}.stats"),
        )?,
        counts: read_counts(&object["counts"], &format!("{path}.counts"))?,
        memory_keys: read_memory_keys(&object["memory"], &format!("{path}.memory"))?,
    })
}

fn read_features(value: &Mv, path: &str) -> Result<Option<Features>, String> {
    if matches!(value, Mv::Undefined) {
        return Ok(None);
    }
    value.exact(
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
    Ok(Some(Features {
        message_types: value
            .get("messageTypes", path)?
            .string_list(&format!("{path}.messageTypes"))?,
        wishes: value
            .get("wishes", path)?
            .boolean(&format!("{path}.wishes"))?,
        status_effects: value
            .get("statusEffects", path)?
            .boolean(&format!("{path}.statusEffects"))?,
        fields: value
            .get("fields", path)?
            .boolean(&format!("{path}.fields"))?,
        planning: value
            .get("planning", path)?
            .boolean(&format!("{path}.planning"))?,
        chests: value
            .get("chests", path)?
            .boolean(&format!("{path}.chests"))?,
        skills: value
            .get("skills", path)?
            .boolean(&format!("{path}.skills"))?,
        relics: value
            .get("relics", path)?
            .boolean(&format!("{path}.relics"))?,
        camps: value
            .get("camps", path)?
            .boolean(&format!("{path}.camps"))?,
        hazards: value
            .get("hazards", path)?
            .boolean(&format!("{path}.hazards"))?,
    }))
}

fn read_seeds(value: &Value, path: &str) -> Result<Seeds, String> {
    let fields = value
        .as_object()
        .ok_or_else(|| err(path, "expected an object"))?;
    for key in fields.keys() {
        if !["decide", "motor", "lapse", "knowledge"].contains(&key.as_str()) {
            return Err(err(path, format!("unexpected member {key}")));
        }
    }
    let seed = |key: &str| -> Result<u32, String> {
        fields
            .get(key)
            .and_then(Value::as_u64)
            .filter(|seed| *seed <= u64::from(u32::MAX))
            .map(|seed| seed as u32)
            .ok_or_else(|| err(&format!("{path}.{key}"), "expected a u32 seed"))
    };
    Ok(Seeds {
        decide: seed("decide")?,
        motor: seed("motor")?,
        lapse: seed("lapse")?,
        knowledge: seed("knowledge")?,
    })
}

fn read_trace(value: &Mv, path: &str) -> Result<Vec<Draw>, String> {
    let mut draws = Vec::new();
    for (index, entry) in value.arr(path)?.iter().enumerate() {
        let entry_path = format!("{path}[{index}]");
        entry.exact(&["kind", "lane", "index", "value"], &entry_path)?;
        let kind = entry
            .get("kind", &entry_path)?
            .text(&format!("{entry_path}.kind"))?;
        if kind != "rng" {
            return Err(err(
                &format!("{entry_path}.kind"),
                format!("unexpected trace kind {kind}"),
            ));
        }
        let lane_name = entry
            .get("lane", &entry_path)?
            .text(&format!("{entry_path}.lane"))?;
        let lane = Lane::parse(lane_name).ok_or_else(|| {
            err(
                &format!("{entry_path}.lane"),
                format!("unknown lane {lane_name}"),
            )
        })?;
        let draw_index = entry
            .get("index", &entry_path)?
            .uint(&format!("{entry_path}.index"))?;
        let value = entry
            .get("value", &entry_path)?
            .num(&format!("{entry_path}.value"))?;
        if !(0.0..1.0).contains(&value) {
            return Err(err(
                &format!("{entry_path}.value"),
                format!("a raw uniform draw left [0,1): {value}"),
            ));
        }
        draws.push(Draw {
            lane,
            index: draw_index,
            value,
        });
    }
    Ok(draws)
}

fn read_counts(value: &Value, path: &str) -> Result<Counts, String> {
    let fields = value
        .as_object()
        .ok_or_else(|| err(path, "expected an object"))?;
    for key in fields.keys() {
        if !["decide", "motor", "lapse"].contains(&key.as_str()) {
            return Err(err(path, format!("unexpected member {key}")));
        }
    }
    let count = |key: &str| -> Result<u32, String> {
        fields
            .get(key)
            .and_then(Value::as_u64)
            .filter(|count| *count <= u64::from(u32::MAX))
            .map(|count| count as u32)
            .ok_or_else(|| err(&format!("{path}.{key}"), "expected a u32 count"))
    };
    Ok(Counts {
        decide: count("decide")?,
        motor: count("motor")?,
        lapse: count("lapse")?,
    })
}

/// The declared `memory` is a side observation of the real Memory the supplement constructed; the direct hand never
/// reads it, so only its declared ordered eight-field shape is checked (its tagged Map/Set contents are not decoded and
/// are explicitly outside the narrow hand lease).
fn read_memory_keys(value: &Value, path: &str) -> Result<Vec<String>, String> {
    let fields = value
        .as_object()
        .ok_or_else(|| err(path, "expected a tagged object"))?;
    let tag = fields
        .get("$")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "missing $ tag"))?;
    if tag != "object" {
        return Err(err(path, format!("unexpected memory tag {tag}")));
    }
    exact_tag_fields(fields, &["$", "entries"], path)?;
    let entries = fields
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| err(path, "expected an entries array"))?;
    let mut keys = Vec::with_capacity(entries.len());
    for (index, pair) in entries.iter().enumerate() {
        let pair_path = format!("{path}.entries[{index}]");
        let pair = pair
            .as_array()
            .ok_or_else(|| err(&pair_path, "expected [key, value]"))?;
        if pair.len() != 2 {
            return Err(err(&pair_path, "expected [key, value]"));
        }
        let key = pair[0]
            .as_str()
            .ok_or_else(|| err(&pair_path, "expected a string key"))?
            .to_string();
        if keys.contains(&key) {
            return Err(err(&pair_path, format!("duplicate memory field {key}")));
        }
        keys.push(key);
    }
    let expected = [
        "fighters",
        "mobs",
        "camps",
        "containers",
        "self",
        "stimuli",
        "bounties",
        "choices",
    ];
    if keys != expected {
        return Err(err(
            path,
            format!(
                "memory fields {keys:?} are not the declared eight-field snapshot {expected:?}"
            ),
        ));
    }
    Ok(keys)
}

// ------------------------------------------------------------------------------------------------------- typed reads

fn read_ex_gaussian(value: &Mv, path: &str) -> Result<ExGaussian, String> {
    value.exact(&["mu", "sigma", "tau", "floor", "cap"], path)?;
    Ok(ExGaussian {
        mu: value.get("mu", path)?.num(&format!("{path}.mu"))?,
        sigma: value.get("sigma", path)?.num(&format!("{path}.sigma"))?,
        tau: value.get("tau", path)?.num(&format!("{path}.tau"))?,
        floor: value.get("floor", path)?.num(&format!("{path}.floor"))?,
        cap: value.get("cap", path)?.num(&format!("{path}.cap"))?,
    })
}

fn read_cadence(value: &Mv, path: &str) -> Result<Cadence, String> {
    value.exact(&["mean", "jitter"], path)?;
    Ok(Cadence {
        mean: value.get("mean", path)?.num(&format!("{path}.mean"))?,
        jitter: value.get("jitter", path)?.num(&format!("{path}.jitter"))?,
    })
}

fn read_tier(value: &Mv, path: &str) -> Result<TierParams, String> {
    value.exact(
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
    let get = |key: &str| value.get(key, path);
    let num = |key: &str| -> Result<f64, String> { get(key)?.num(&format!("{path}.{key}")) };
    let nested = |key: &str| -> Result<&Mv, String> { get(key) };
    let id_text = get("id")?.text(&format!("{path}.id"))?;
    let id = TierId::parse(id_text)
        .ok_or_else(|| err(&format!("{path}.id"), format!("unknown tier id {id_text}")))?;
    let move_scatter = {
        let nested_path = format!("{path}.moveScatter");
        let nested = nested("moveScatter")?;
        nested.exact(&["base", "perUnit"], &nested_path)?;
        MoveScatter {
            base: nested
                .get("base", &nested_path)?
                .num(&format!("{nested_path}.base"))?,
            per_unit: nested
                .get("perUnit", &nested_path)?
                .num(&format!("{nested_path}.perUnit"))?,
        }
    };
    let target_scatter = {
        let nested_path = format!("{path}.targetScatter");
        let nested = nested("targetScatter")?;
        nested.exact(&["sigma", "lagS", "slipP", "slipMult"], &nested_path)?;
        TargetScatter {
            sigma: nested
                .get("sigma", &nested_path)?
                .num(&format!("{nested_path}.sigma"))?,
            lag_s: nested
                .get("lagS", &nested_path)?
                .num(&format!("{nested_path}.lagS"))?,
            slip_p: nested
                .get("slipP", &nested_path)?
                .num(&format!("{nested_path}.slipP"))?,
            slip_mult: nested
                .get("slipMult", &nested_path)?
                .num(&format!("{nested_path}.slipMult"))?,
        }
    };
    let hesitation = {
        let nested_path = format!("{path}.hesitation");
        let nested = nested("hesitation")?;
        nested.exact(&["p", "minMs", "maxMs"], &nested_path)?;
        Hesitation {
            p: nested
                .get("p", &nested_path)?
                .num(&format!("{nested_path}.p"))?,
            min_ms: nested
                .get("minMs", &nested_path)?
                .num(&format!("{nested_path}.minMs"))?,
            max_ms: nested
                .get("maxMs", &nested_path)?
                .num(&format!("{nested_path}.maxMs"))?,
        }
    };
    let orbwalk = {
        let nested_path = format!("{path}.orbwalk");
        let nested = nested("orbwalk")?;
        nested.exact(&["p", "stepU", "angleJitter"], &nested_path)?;
        Orbwalk {
            p: nested
                .get("p", &nested_path)?
                .num(&format!("{nested_path}.p"))?,
            step_u: nested
                .get("stepU", &nested_path)?
                .num(&format!("{nested_path}.stepU"))?,
            angle_jitter: nested
                .get("angleJitter", &nested_path)?
                .num(&format!("{nested_path}.angleJitter"))?,
        }
    };
    let route = {
        let nested_path = format!("{path}.route");
        let nested = nested("route")?;
        nested.exact(&["horizon", "walkPaths", "reach"], &nested_path)?;
        Route {
            horizon: nested
                .get("horizon", &nested_path)?
                .uint(&format!("{nested_path}.horizon"))?,
            walk_paths: nested
                .get("walkPaths", &nested_path)?
                .boolean(&format!("{nested_path}.walkPaths"))?,
            reach: nested
                .get("reach", &nested_path)?
                .num(&format!("{nested_path}.reach"))?,
        }
    };
    let attention = {
        let nested_path = format!("{path}.attention");
        let nested = nested("attention")?;
        nested.exact(
            &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
            &nested_path,
        )?;
        Attention {
            central: nested
                .get("central", &nested_path)?
                .num(&format!("{nested_path}.central"))?,
            periphery_mult: nested
                .get("peripheryMult", &nested_path)?
                .num(&format!("{nested_path}.peripheryMult"))?,
            engaged_mult: nested
                .get("engagedMult", &nested_path)?
                .num(&format!("{nested_path}.engagedMult"))?,
            reconsider_ms: nested
                .get("reconsiderMs", &nested_path)?
                .num(&format!("{nested_path}.reconsiderMs"))?,
        }
    };
    let appraisal = {
        let nested_path = format!("{path}.appraisal");
        let nested = nested("appraisal")?;
        nested.exact(&["bias", "lead", "busy", "hue", "noise"], &nested_path)?;
        Appraisal {
            bias: nested
                .get("bias", &nested_path)?
                .num(&format!("{nested_path}.bias"))?,
            lead: nested
                .get("lead", &nested_path)?
                .num(&format!("{nested_path}.lead"))?,
            busy: nested
                .get("busy", &nested_path)?
                .num(&format!("{nested_path}.busy"))?,
            hue: nested
                .get("hue", &nested_path)?
                .num(&format!("{nested_path}.hue"))?,
            noise: nested
                .get("noise", &nested_path)?
                .num(&format!("{nested_path}.noise"))?,
        }
    };
    let caution = {
        let nested_path = format!("{path}.caution");
        let nested = nested("caution")?;
        nested.exact(&["mobShare", "eliteShare", "startHp"], &nested_path)?;
        Caution {
            mob_share: nested
                .get("mobShare", &nested_path)?
                .num(&format!("{nested_path}.mobShare"))?,
            elite_share: nested
                .get("eliteShare", &nested_path)?
                .num(&format!("{nested_path}.eliteShare"))?,
            start_hp: nested
                .get("startHp", &nested_path)?
                .num(&format!("{nested_path}.startHp"))?,
        }
    };
    Ok(TierParams {
        id,
        reaction: read_ex_gaussian(nested("reaction")?, &format!("{path}.reaction"))?,
        step: read_ex_gaussian(nested("step")?, &format!("{path}.step"))?,
        daze: read_ex_gaussian(nested("daze")?, &format!("{path}.daze"))?,
        refractory_ms: num("refractoryMs")?,
        think_ms: read_cadence(nested("thinkMs")?, &format!("{path}.thinkMs"))?,
        strategy_ms: read_cadence(nested("strategyMs")?, &format!("{path}.strategyMs"))?,
        apm: num("apm")?,
        burst: num("burst")?,
        min_gap_ms: num("minGapMs")?,
        move_scatter,
        target_scatter,
        minimap_sigma: num("minimapSigma")?,
        edge_click_p: num("edgeClickP")?,
        timing_sigma_ms: num("timingSigmaMs")?,
        hesitation,
        softmax_t: num("softmaxT")?,
        lapse_p: num("lapseP")?,
        dodge_p: num("dodgeP")?,
        juke_p: num("jukeP")?,
        orbwalk,
        knowledge: num("knowledge")?,
        mob_share_noise: num("mobShareNoise")?,
        route,
        attention,
        memory_span_ms: num("memorySpanMs")?,
        feint_read: num("feintRead")?,
        appraisal,
        wary: num("wary")?,
        caution,
    })
}

fn read_vec2(value: &Mv, path: &str) -> Result<Vec2, String> {
    value.exact(&["x", "y"], path)?;
    Ok(Vec2::new(
        value.get("x", path)?.num(&format!("{path}.x"))?,
        value.get("y", path)?.num(&format!("{path}.y"))?,
    ))
}

fn read_weapon(value: &Mv, path: &str) -> Result<Option<BotWeapon>, String> {
    if value.null() {
        return Ok(None);
    }
    let text = value.text(path)?;
    BotWeapon::parse(text)
        .map(Some)
        .ok_or_else(|| err(path, format!("unknown weapon {text}")))
}

fn read_faction(value: &Mv, path: &str) -> Result<Option<FactionId>, String> {
    if value.null() {
        return Ok(None);
    }
    let text = value.text(path)?;
    FactionId::parse(text)
        .map(Some)
        .ok_or_else(|| err(path, format!("unknown faction {text}")))
}

fn read_percept(value: &Mv, path: &str) -> Result<Percept, String> {
    value.exact(
        &[
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
        ],
        path,
    )?;
    let now = value.get("now", path)?.num(&format!("{path}.now"))?;
    // `viewT` is a declared source clock the narrowed hand Percept does not carry (it is not read by the hand); it is
    // still a required finite source fact here.
    let _view_t = value.get("viewT", path)?.num(&format!("{path}.viewT"))?;
    let self_view = read_self_view(value.get("self", path)?, &format!("{path}.self"))?;
    let hud = read_hud_view(value.get("hud", path)?, &format!("{path}.hud"))?;
    let mut fighters = Vec::new();
    for (index, fighter) in value
        .get("fighters", path)?
        .arr(&format!("{path}.fighters"))?
        .iter()
        .enumerate()
    {
        fighters.push(read_fighter(fighter, &format!("{path}.fighters[{index}]"))?);
    }
    let mut mobs = Vec::new();
    for (index, mob) in value
        .get("mobs", path)?
        .arr(&format!("{path}.mobs"))?
        .iter()
        .enumerate()
    {
        mobs.push(read_mob(mob, &format!("{path}.mobs[{index}]"))?);
    }
    let mut containers = Vec::new();
    for (index, container) in value
        .get("containers", path)?
        .arr(&format!("{path}.containers"))?
        .iter()
        .enumerate()
    {
        containers.push(read_container(
            container,
            &format!("{path}.containers[{index}]"),
        )?);
    }
    // Projectiles, the minimap and the event stream are declared source Percept facts the hand does not read; their
    // tagged shape is required but they are not asserted against a fabricated native projection.
    let _projectiles = value
        .get("projectiles", path)?
        .arr(&format!("{path}.projectiles"))?;
    {
        let minimap_path = format!("{path}.minimap");
        let minimap = value.get("minimap", path)?;
        minimap.exact(&["t", "mobs", "gatesLocked"], &minimap_path)?;
        let _t = minimap
            .get("t", &minimap_path)?
            .num(&format!("{minimap_path}.t"))?;
        let _dots = minimap
            .get("mobs", &minimap_path)?
            .arr(&format!("{minimap_path}.mobs"))?;
        let _locked = minimap
            .get("gatesLocked", &minimap_path)?
            .boolean(&format!("{minimap_path}.gatesLocked"))?;
    }
    let _events = value.get("events", path)?.arr(&format!("{path}.events"))?;
    let extras = read_extras(value.get("extras", path)?, &format!("{path}.extras"))?;
    // `Percept.features` is a declared source fact the narrowed hand Percept does not carry and the humanizer never
    // reads; the profile feature set (validated above) is the hand's gate input.
    let _percept_features =
        read_features(value.get("features", path)?, &format!("{path}.features"))?;
    Ok(Percept {
        now,
        self_view,
        hud,
        fighters,
        mobs,
        containers,
        extras,
    })
}

const SELF_KEYS: [&str; 27] = [
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
];

fn read_self_view(value: &Mv, path: &str) -> Result<SelfView, String> {
    value.exact(&SELF_KEYS, path)?;
    let get = |key: &str| value.get(key, path);
    let num = |key: &str| -> Result<f64, String> { get(key)?.num(&format!("{path}.{key}")) };
    let _name = get("name")?.text(&format!("{path}.name"))?;
    let _facing = num("facing")?;
    let _barrier = num("barrier")?;
    let _draw_started_at = num("drawStartedAt")?;
    let _immune_until = num("immuneUntil")?;
    let _sig = num("sig")?;
    let _brand = num("brand")?;
    let _power = num("power")?;
    let _as_mult = num("asMult")?;
    let _windup_mult = num("windupMult")?;
    let _speed_mult = num("speedMult")?;
    let _kills = num("kills")?;
    let _mob_kills = num("mobKills")?;
    let _gv = num("gv")?;
    let _bounty = num("bounty")?;
    let _move_seq = num("moveSeq")?;
    let weapons = get("weapons")?.arr(&format!("{path}.weapons"))?;
    if weapons.len() != 2 {
        return Err(err(
            &format!("{path}.weapons"),
            format!("expected two slots, found {}", weapons.len()),
        ));
    }
    let slot = get("slot")?.uint(&format!("{path}.slot"))?;
    if slot > 1 {
        return Err(err(
            &format!("{path}.slot"),
            format!("slot {slot} is not 0 or 1"),
        ));
    }
    let attack_target = match get("attackTarget")? {
        Mv::Null => None,
        Mv::Str(target) => Some(target.clone()),
        _ => {
            return Err(err(
                &format!("{path}.attackTarget"),
                "expected null or a fighter id",
            ))
        }
    };
    let owner_lock = match &attack_target {
        None => OwnerLock::Clear,
        Some(target) => OwnerLock::Held {
            target: Some(target.clone()),
        },
    };
    Ok(SelfView {
        id: get("id")?.text(&format!("{path}.id"))?.to_string(),
        faction: read_faction(get("faction")?, &format!("{path}.faction"))?,
        x: num("x")?,
        y: num("y")?,
        facing: num("facing")?,
        status: get("status")?.text(&format!("{path}.status"))?.to_string(),
        hp: num("hp")?,
        max_hp: num("maxHp")?,
        // The direct hand supplement's source SelfView has no effect bits; the narrowed hand never reads them.
        effects: 0,
        weapons: [
            read_weapon(&weapons[0], &format!("{path}.weapons[0]"))?,
            read_weapon(&weapons[1], &format!("{path}.weapons[1]"))?,
        ],
        slot: slot as u8,
        attack_target,
        owner_lock: Some(owner_lock),
        ready_at: num("readyAt")?,
    })
}

fn read_hud_view(value: &Mv, path: &str) -> Result<HudView, String> {
    value.exact(
        &[
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
        ],
        path,
    )?;
    let get = |key: &str| value.get(key, path);
    for key in [
        "lobbyEndsAt",
        "raidStartedAt",
        "patienceEndsAt",
        "suddenDeathAt",
    ] {
        get(key)?.num(&format!("{path}.{key}"))?;
    }
    for key in ["training", "inColiseum", "gatesLocked"] {
        get(key)?.boolean(&format!("{path}.{key}"))?;
    }
    for key in ["startedWith", "alive", "playerCount", "minPlayers"] {
        get(key)?.uint(&format!("{path}.{key}"))?;
    }
    get("winner")?.text(&format!("{path}.winner"))?;
    Ok(HudView {
        phase: get("phase")?.text(&format!("{path}.phase"))?.to_string(),
        gates_locked: get("gatesLocked")?.boolean(&format!("{path}.gatesLocked"))?,
    })
}

fn read_fighter(value: &Mv, path: &str) -> Result<FighterView, String> {
    value.exact(
        &[
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
        ],
        path,
    )?;
    let get = |key: &str| value.get(key, path);
    get("bot")?.boolean(&format!("{path}.bot"))?;
    get("immune")?.boolean(&format!("{path}.immune"))?;
    get("los")?.boolean(&format!("{path}.los"))?;
    get("central")?.boolean(&format!("{path}.central"))?;
    read_faction(get("faction")?, &format!("{path}.faction"))?;
    read_weapon(get("inHand")?, &format!("{path}.inHand"))?;
    for key in [
        "facing",
        "hpFrac",
        "barrierFrac",
        "drawStartedAt",
        "bounty",
        "sig",
        "brand",
        "dist",
        "tint",
    ] {
        get(key)?.num(&format!("{path}.{key}"))?;
    }
    Ok(FighterView {
        id: get("id")?.text(&format!("{path}.id"))?.to_string(),
        x: get("x")?.num(&format!("{path}.x"))?,
        y: get("y")?.num(&format!("{path}.y"))?,
        vx: get("vx")?.num(&format!("{path}.vx"))?,
        vy: get("vy")?.num(&format!("{path}.vy"))?,
        status: get("status")?.text(&format!("{path}.status"))?.to_string(),
        targetable: get("targetable")?.boolean(&format!("{path}.targetable"))?,
    })
}

fn read_mob(value: &Mv, path: &str) -> Result<MobView, String> {
    value.exact(
        &[
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
        ],
        path,
    )?;
    let get = |key: &str| value.get(key, path);
    get("name")?.text(&format!("{path}.name"))?;
    get("type")?.text(&format!("{path}.type"))?;
    read_faction(get("faction")?, &format!("{path}.faction"))?;
    read_weapon(get("inHand")?, &format!("{path}.inHand"))?;
    get("los")?.boolean(&format!("{path}.los"))?;
    get("central")?.boolean(&format!("{path}.central"))?;
    for key in ["facing", "hpFrac", "drawStartedAt", "sig", "brand", "dist"] {
        get(key)?.num(&format!("{path}.{key}"))?;
    }
    Ok(MobView {
        id: get("id")?.text(&format!("{path}.id"))?.to_string(),
        x: get("x")?.num(&format!("{path}.x"))?,
        y: get("y")?.num(&format!("{path}.y"))?,
        vx: get("vx")?.num(&format!("{path}.vx"))?,
        vy: get("vy")?.num(&format!("{path}.vy"))?,
        status: get("status")?.text(&format!("{path}.status"))?.to_string(),
        kind: get("kind")?.text(&format!("{path}.kind"))?.to_string(),
    })
}

fn read_container(value: &Mv, path: &str) -> Result<ContainerView, String> {
    value.exact(
        &[
            "id",
            "kind",
            "x",
            "y",
            "label",
            "closed",
            "weapon",
            "interactable",
            "dist",
        ],
        path,
    )?;
    let get = |key: &str| value.get(key, path);
    get("label")?.text(&format!("{path}.label"))?;
    get("closed")?.boolean(&format!("{path}.closed"))?;
    read_weapon(get("weapon")?, &format!("{path}.weapon"))?;
    get("dist")?.num(&format!("{path}.dist"))?;
    Ok(ContainerView {
        id: get("id")?.text(&format!("{path}.id"))?.to_string(),
        kind: get("kind")?.text(&format!("{path}.kind"))?.to_string(),
        x: get("x")?.num(&format!("{path}.x"))?,
        y: get("y")?.num(&format!("{path}.y"))?,
        interactable: get("interactable")?.boolean(&format!("{path}.interactable"))?,
    })
}

fn read_extras(value: &Mv, path: &str) -> Result<PerceptExtras, String> {
    // This direct hand supplement declares no extras; the two reads the hand can make (chests, wish) stay absent rather
    // than being reconstructed from a future/other profile.
    value.exact(&[], path)?;
    Ok(PerceptExtras::default())
}

fn read_stimulus(value: &Mv, path: &str) -> Result<Stimulus, String> {
    value.closed(&["kind", "at", "central"], &["subject", "value"], path)?;
    let kind_text = value.get("kind", path)?.text(&format!("{path}.kind"))?;
    let kind = StimulusKind::parse(kind_text).ok_or_else(|| {
        err(
            &format!("{path}.kind"),
            format!("unknown stimulus kind {kind_text}"),
        )
    })?;
    let subject = match value.optional("subject", path)? {
        None | Some(Mv::Null) => None,
        Some(Mv::Str(subject)) => Some(subject.clone()),
        Some(_) => return Err(err(&format!("{path}.subject"), "expected null or a string")),
    };
    let value_of = match value.optional("value", path)? {
        None => None,
        Some(number) => Some(number.num(&format!("{path}.value"))?),
    };
    Ok(Stimulus {
        kind,
        at: value.get("at", path)?.num(&format!("{path}.at"))?,
        subject,
        central: value
            .get("central", path)?
            .boolean(&format!("{path}.central"))?,
        value: value_of,
    })
}

fn read_timing(value: &Mv, path: &str) -> Result<IntentTiming, String> {
    let kind = value.get("kind", path)?.text(&format!("{path}.kind"))?;
    match kind {
        "step" => {
            value.exact(&["kind"], path)?;
            Ok(IntentTiming::Step {})
        }
        "timed" => {
            value.exact(&["kind", "due"], path)?;
            Ok(IntentTiming::Timed {
                due: value.get("due", path)?.num(&format!("{path}.due"))?,
            })
        }
        "react" => {
            value.exact(&["kind", "stimulus"], path)?;
            Ok(IntentTiming::React {
                stimulus: read_stimulus(value.get("stimulus", path)?, &format!("{path}.stimulus"))?,
            })
        }
        other => Err(err(
            &format!("{path}.kind"),
            format!("unknown timing {other}"),
        )),
    }
}

fn read_plan_msg(value: &Mv, path: &str) -> Result<PlanMsg, String> {
    value.closed(&[], &["spawn", "boon", "ready"], path)?;
    let spawn = match value.optional("spawn", path)? {
        None => None,
        Some(spawn) => Some(spawn.uint(&format!("{path}.spawn"))? as u8),
    };
    let boon = match value.optional("boon", path)? {
        None => None,
        Some(boon) => Some(boon.uint(&format!("{path}.boon"))? as u8),
    };
    let ready = match value.optional("ready", path)? {
        None => None,
        Some(ready) => Some(ready.boolean(&format!("{path}.ready"))?),
    };
    Ok(PlanMsg { spawn, boon, ready })
}

fn read_choose_msg(value: &Mv, path: &str) -> Result<ChooseMsg, String> {
    value.closed(&["chest", "pick"], &["replace"], path)?;
    let replace = match value.optional("replace", path)? {
        None => None,
        Some(replace) => Some(replace.uint(&format!("{path}.replace"))? as u8),
    };
    Ok(ChooseMsg {
        chest: value
            .get("chest", path)?
            .text(&format!("{path}.chest"))?
            .to_string(),
        pick: value
            .get("pick", path)?
            .i8_number(&format!("{path}.pick"))?,
        replace,
    })
}

fn read_intents(value: &Mv, path: &str) -> Result<Vec<Intent>, String> {
    let mut intents = Vec::new();
    for (index, item) in value.arr(path)?.iter().enumerate() {
        intents.push(read_intent(item, &format!("{path}[{index}]"))?);
    }
    Ok(intents)
}

fn read_intent(value: &Mv, path: &str) -> Result<Intent, String> {
    let kind = value.get("kind", path)?.text(&format!("{path}.kind"))?;
    fn keys(extra: &[&'static str]) -> Vec<&'static str> {
        ["kind", "priority", "timing", "why"]
            .into_iter()
            .chain(extra.iter().copied())
            .collect()
    }
    let body = match kind {
        "lock" => {
            value.exact(&keys(&["target", "at"]), path)?;
            IntentBody::Lock {
                target: value
                    .get("target", path)?
                    .text(&format!("{path}.target"))?
                    .to_string(),
                at: read_vec2(value.get("at", path)?, &format!("{path}.at"))?,
            }
        }
        "move" => {
            value.exact(&keys(&["to"]), path)?;
            IntentBody::Move {
                to: read_vec2(value.get("to", path)?, &format!("{path}.to"))?,
            }
        }
        "stop" => {
            value.exact(&keys(&[]), path)?;
            IntentBody::Stop {}
        }
        "swap" => {
            value.exact(&keys(&["slot"]), path)?;
            IntentBody::Swap {
                slot: value.get("slot", path)?.uint(&format!("{path}.slot"))? as u8,
            }
        }
        "pickup" => {
            value.exact(&keys(&["container"]), path)?;
            IntentBody::Pickup {
                container: value
                    .get("container", path)?
                    .text(&format!("{path}.container"))?
                    .to_string(),
            }
        }
        "cast" => {
            value.closed(
                &["kind", "slot", "x", "y", "priority", "timing", "why"],
                &["target", "at", "snapRadius"],
                path,
            )?;
            let target = match value.optional("target", path)? {
                None | Some(Mv::Null) => None,
                Some(target) => Some(target.text(&format!("{path}.target"))?.to_string()),
            };
            let at = match value.optional("at", path)? {
                None | Some(Mv::Null) => None,
                Some(point) => Some(read_vec2(point, &format!("{path}.at"))?),
            };
            let snap_radius = match value.optional("snapRadius", path)? {
                None | Some(Mv::Null) => None,
                Some(radius) => Some(radius.num(&format!("{path}.snapRadius"))?),
            };
            IntentBody::Cast {
                slot: value
                    .get("slot", path)?
                    .text(&format!("{path}.slot"))?
                    .to_string(),
                x: value.get("x", path)?.num(&format!("{path}.x"))?,
                y: value.get("y", path)?.num(&format!("{path}.y"))?,
                target,
                at,
                snap_radius,
            }
        }
        "plan" => {
            value.exact(&keys(&["msg"]), path)?;
            IntentBody::Plan {
                msg: read_plan_msg(value.get("msg", path)?, &format!("{path}.msg"))?,
            }
        }
        "choose" => {
            value.exact(&keys(&["msg"]), path)?;
            IntentBody::Choose {
                msg: read_choose_msg(value.get("msg", path)?, &format!("{path}.msg"))?,
            }
        }
        other => {
            return Err(err(
                &format!("{path}.kind"),
                format!("unknown intent kind {other}"),
            ))
        }
    };
    Ok(Intent {
        body,
        priority: value
            .get("priority", path)?
            .uint(&format!("{path}.priority"))? as u8,
        timing: read_timing(value.get("timing", path)?, &format!("{path}.timing"))?,
        why: value
            .get("why", path)?
            .text(&format!("{path}.why"))?
            .to_string(),
    })
}

fn read_intent_kind(text: &str) -> Option<IntentKind> {
    match text {
        "lock" => Some(IntentKind::Lock),
        "move" => Some(IntentKind::Move),
        "stop" => Some(IntentKind::Stop),
        "swap" => Some(IntentKind::Swap),
        "pickup" => Some(IntentKind::Pickup),
        "cast" => Some(IntentKind::Cast),
        "plan" => Some(IntentKind::Plan),
        "choose" => Some(IntentKind::Choose),
        _ => None,
    }
}

fn read_timed_commands(value: &Mv, path: &str) -> Result<Vec<TimedCommand>, String> {
    let mut commands = Vec::new();
    for (index, item) in value.arr(path)?.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        item.exact(&["at", "cmd", "intent", "priority", "stimulus"], &item_path)?;
        let intent_text = item
            .get("intent", &item_path)?
            .text(&format!("{item_path}.intent"))?;
        let intent = read_intent_kind(intent_text).ok_or_else(|| {
            err(
                &format!("{item_path}.intent"),
                format!("unknown released intent {intent_text}"),
            )
        })?;
        let stimulus = match item.get("stimulus", &item_path)? {
            Mv::Null => None,
            stimulus => Some(read_stimulus(stimulus, &format!("{item_path}.stimulus"))?),
        };
        commands.push(TimedCommand {
            at: item
                .get("at", &item_path)?
                .num(&format!("{item_path}.at"))?,
            cmd: read_command(item.get("cmd", &item_path)?, &format!("{item_path}.cmd"))?,
            intent,
            priority: item
                .get("priority", &item_path)?
                .uint(&format!("{item_path}.priority"))? as u8,
            stimulus,
        });
    }
    Ok(commands)
}

fn read_command(value: &Mv, path: &str) -> Result<Command, String> {
    value.exact(&["type", "msg"], path)?;
    let kind = value.get("type", path)?.text(&format!("{path}.type"))?;
    let msg = value.get("msg", path)?;
    let msg_path = format!("{path}.msg");
    match kind {
        "move" => {
            msg.exact(&["x", "y"], &msg_path)?;
            Ok(Command::Move {
                x: msg.get("x", &msg_path)?.num(&format!("{msg_path}.x"))?,
                y: msg.get("y", &msg_path)?.num(&format!("{msg_path}.y"))?,
            })
        }
        "stop" => {
            msg.exact(&[], &msg_path)?;
            Ok(Command::Stop {})
        }
        "target" => {
            msg.exact(&["id"], &msg_path)?;
            Ok(Command::Target {
                id: msg
                    .get("id", &msg_path)?
                    .text(&format!("{msg_path}.id"))?
                    .to_string(),
            })
        }
        "attack" => {
            msg.exact(&["a"], &msg_path)?;
            Ok(Command::Attack {
                a: msg.get("a", &msg_path)?.num(&format!("{msg_path}.a"))?,
            })
        }
        "release" => {
            msg.exact(&["a"], &msg_path)?;
            Ok(Command::Release {
                a: msg.get("a", &msg_path)?.num(&format!("{msg_path}.a"))?,
            })
        }
        "swap" => {
            msg.exact(&["slot"], &msg_path)?;
            Ok(Command::Swap {
                slot: msg
                    .get("slot", &msg_path)?
                    .uint(&format!("{msg_path}.slot"))? as u8,
            })
        }
        "pickup" => {
            msg.exact(&["containerId"], &msg_path)?;
            Ok(Command::Pickup {
                container_id: msg
                    .get("containerId", &msg_path)?
                    .text(&format!("{msg_path}.containerId"))?
                    .to_string(),
            })
        }
        "cast" => {
            msg.closed(&["slot", "x", "y"], &["id"], &msg_path)?;
            let id = match msg.optional("id", &msg_path)? {
                None | Some(Mv::Null) => None,
                Some(id) => Some(id.text(&format!("{msg_path}.id"))?.to_string()),
            };
            Ok(Command::Cast {
                slot: msg
                    .get("slot", &msg_path)?
                    .text(&format!("{msg_path}.slot"))?
                    .to_string(),
                x: msg.get("x", &msg_path)?.num(&format!("{msg_path}.x"))?,
                y: msg.get("y", &msg_path)?.num(&format!("{msg_path}.y"))?,
                id,
            })
        }
        "plan" => {
            msg.closed(&[], &["spawn", "boon", "ready"], &msg_path)?;
            Ok(Command::Plan {
                spawn: match msg.optional("spawn", &msg_path)? {
                    None => None,
                    Some(spawn) => Some(spawn.uint(&format!("{msg_path}.spawn"))? as u8),
                },
                boon: match msg.optional("boon", &msg_path)? {
                    None => None,
                    Some(boon) => Some(boon.uint(&format!("{msg_path}.boon"))? as u8),
                },
                ready: match msg.optional("ready", &msg_path)? {
                    None => None,
                    Some(ready) => Some(ready.boolean(&format!("{msg_path}.ready"))?),
                },
            })
        }
        "choose" => {
            msg.closed(&["chest", "pick"], &["replace"], &msg_path)?;
            Ok(Command::Choose {
                chest: msg
                    .get("chest", &msg_path)?
                    .text(&format!("{msg_path}.chest"))?
                    .to_string(),
                pick: msg
                    .get("pick", &msg_path)?
                    .i8_number(&format!("{msg_path}.pick"))?,
                replace: match msg.optional("replace", &msg_path)? {
                    None => None,
                    Some(replace) => Some(replace.uint(&format!("{msg_path}.replace"))? as u8),
                },
            })
        }
        other => Err(err(
            &format!("{path}.type"),
            format!("unknown command type {other}"),
        )),
    }
}

fn read_misses(value: &Mv, path: &str) -> Result<Vec<ClickMiss>, String> {
    let mut misses = Vec::new();
    for (index, item) in value.arr(path)?.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        item.exact(&["target", "at"], &item_path)?;
        misses.push(ClickMiss {
            target: item
                .get("target", &item_path)?
                .text(&format!("{item_path}.target"))?
                .to_string(),
            at: item
                .get("at", &item_path)?
                .num(&format!("{item_path}.at"))?,
        });
    }
    Ok(misses)
}

fn read_stats(value: &Mv, path: &str) -> Result<HumanizerStats, String> {
    value.exact(
        &[
            "commands",
            "reactions",
            "targetClicks",
            "clickMissed",
            "clickWrong",
            "hesitations",
            "lapses",
            "throttled",
            "superseded",
            "apmPeak",
        ],
        path,
    )?;
    let commands_value = value.get("commands", path)?;
    let commands_path = format!("{path}.commands");
    commands_value.exact(
        &[
            "move", "stop", "target", "attack", "release", "swap", "pickup", "cast", "plan",
            "choose",
        ],
        &commands_path,
    )?;
    let mut commands = [0u64; 10];
    for (index, command_type) in COMMAND_TYPES.iter().enumerate() {
        commands[index] = u64::from(
            commands_value
                .get(command_type.as_str(), &commands_path)?
                .uint(&format!("{commands_path}.{}", command_type.as_str()))?,
        );
    }
    let reactions_path = format!("{path}.reactions");
    let mut reactions = std::collections::BTreeMap::new();
    for (index, (kind, times)) in value
        .get("reactions", path)?
        .obj(&reactions_path)?
        .iter()
        .enumerate()
    {
        let stimulus_kind = StimulusKind::parse(kind).ok_or_else(|| {
            err(
                &format!("{reactions_path}.{kind}"),
                format!("unknown reaction kind {kind}"),
            )
        })?;
        let mut samples = Vec::new();
        for (sample_index, sample) in times
            .arr(&format!("{reactions_path}[{index}]"))?
            .iter()
            .enumerate()
        {
            samples.push(sample.num(&format!("{reactions_path}.{kind}[{sample_index}]"))?);
        }
        reactions.insert(stimulus_kind, samples);
    }
    Ok(HumanizerStats {
        commands,
        reactions,
        target_clicks: u64::from(
            value
                .get("targetClicks", path)?
                .uint(&format!("{path}.targetClicks"))?,
        ),
        click_missed: u64::from(
            value
                .get("clickMissed", path)?
                .uint(&format!("{path}.clickMissed"))?,
        ),
        click_wrong: u64::from(
            value
                .get("clickWrong", path)?
                .uint(&format!("{path}.clickWrong"))?,
        ),
        hesitations: u64::from(
            value
                .get("hesitations", path)?
                .uint(&format!("{path}.hesitations"))?,
        ),
        lapses: u64::from(value.get("lapses", path)?.uint(&format!("{path}.lapses"))?),
        throttled: u64::from(
            value
                .get("throttled", path)?
                .uint(&format!("{path}.throttled"))?,
        ),
        superseded: u64::from(
            value
                .get("superseded", path)?
                .uint(&format!("{path}.superseded"))?,
        ),
        apm_peak: u64::from(
            value
                .get("apmPeak", path)?
                .uint(&format!("{path}.apmPeak"))?,
        ),
    })
}

// --------------------------------------------------------------------------------------------------------- comparison

fn close(got: f64, want: f64, label: &str) {
    assert!(
        (got - want).abs() <= 1e-9 * want.abs().max(1.),
        "{label}: native {got} source {want}"
    );
}

fn compare_stimulus(got: &Option<Stimulus>, want: &Option<Stimulus>, label: &str) {
    match (got, want) {
        (None, None) => {}
        (Some(got), Some(want)) => {
            assert_eq!(got.kind, want.kind, "{label} stimulus kind");
            assert_eq!(got.subject, want.subject, "{label} stimulus subject");
            assert_eq!(got.central, want.central, "{label} stimulus central");
            close(got.at, want.at, &format!("{label} stimulus at"));
            match (got.value, want.value) {
                (None, None) => {}
                (Some(got), Some(want)) => close(got, want, &format!("{label} stimulus value")),
                _ => panic!("{label}: stimulus value presence differs"),
            }
        }
        _ => panic!("{label}: stimulus presence differs"),
    }
}

fn compare_command(got: &Command, want: &Command, label: &str) {
    match (got, want) {
        (Command::Move { x: gx, y: gy }, Command::Move { x: wx, y: wy }) => {
            close(*gx, *wx, &format!("{label} move.x"));
            close(*gy, *wy, &format!("{label} move.y"));
        }
        (Command::Stop {}, Command::Stop {}) => {}
        (Command::Target { id: got }, Command::Target { id: want }) => {
            assert_eq!(got, want, "{label} target id");
        }
        (Command::Attack { a: got }, Command::Attack { a: want }) => {
            close(*got, *want, &format!("{label} attack angle"));
        }
        (Command::Release { a: got }, Command::Release { a: want }) => {
            close(*got, *want, &format!("{label} release angle"));
        }
        (Command::Swap { slot: got }, Command::Swap { slot: want }) => {
            assert_eq!(got, want, "{label} swap slot");
        }
        (Command::Pickup { container_id: got }, Command::Pickup { container_id: want }) => {
            assert_eq!(got, want, "{label} pickup container");
        }
        (
            Command::Cast {
                slot: got_slot,
                x: got_x,
                y: got_y,
                id: got_id,
            },
            Command::Cast {
                slot: want_slot,
                x: want_x,
                y: want_y,
                id: want_id,
            },
        ) => {
            assert_eq!(got_slot, want_slot, "{label} cast slot");
            assert_eq!(got_id, want_id, "{label} cast id");
            close(*got_x, *want_x, &format!("{label} cast.x"));
            close(*got_y, *want_y, &format!("{label} cast.y"));
        }
        (
            Command::Plan {
                spawn: got_spawn,
                boon: got_boon,
                ready: got_ready,
            },
            Command::Plan {
                spawn: want_spawn,
                boon: want_boon,
                ready: want_ready,
            },
        ) => {
            assert_eq!(got_spawn, want_spawn, "{label} plan spawn");
            assert_eq!(got_boon, want_boon, "{label} plan boon");
            assert_eq!(got_ready, want_ready, "{label} plan ready");
        }
        (
            Command::Choose {
                chest: got_chest,
                pick: got_pick,
                replace: got_replace,
            },
            Command::Choose {
                chest: want_chest,
                pick: want_pick,
                replace: want_replace,
            },
        ) => {
            assert_eq!(got_chest, want_chest, "{label} choose chest");
            assert_eq!(got_pick, want_pick, "{label} choose pick");
            assert_eq!(got_replace, want_replace, "{label} choose replace");
        }
        _ => panic!("{label}: released command kind differs"),
    }
}

fn compare_commands(got: &[TimedCommand], want: &[TimedCommand], label: &str) {
    assert_eq!(got.len(), want.len(), "{label}: released command count");
    for (index, (got, want)) in got.iter().zip(want.iter()).enumerate() {
        let command_label = format!("{label} result[{index}]");
        close(got.at, want.at, &format!("{command_label}.at"));
        assert_eq!(got.intent, want.intent, "{command_label}.intent");
        assert_eq!(got.priority, want.priority, "{command_label}.priority");
        compare_stimulus(&got.stimulus, &want.stimulus, &command_label);
        compare_command(&got.cmd, &want.cmd, &command_label);
    }
}

fn compare_misses(got: &[ClickMiss], want: &[ClickMiss], label: &str) {
    assert_eq!(got.len(), want.len(), "{label}: miss count");
    for (index, (got, want)) in got.iter().zip(want.iter()).enumerate() {
        assert_eq!(got.target, want.target, "{label} miss[{index}].target");
        close(got.at, want.at, &format!("{label} miss[{index}].at"));
    }
}

fn compare_stats(got: &HumanizerStats, want: &HumanizerStats, label: &str) {
    for command_type in COMMAND_TYPES {
        assert_eq!(
            got.command(command_type),
            want.command(command_type),
            "{label}: commands.{}",
            command_type.as_str()
        );
    }
    assert_eq!(
        got.target_clicks, want.target_clicks,
        "{label}: targetClicks"
    );
    assert_eq!(got.click_missed, want.click_missed, "{label}: clickMissed");
    assert_eq!(got.click_wrong, want.click_wrong, "{label}: clickWrong");
    assert_eq!(got.hesitations, want.hesitations, "{label}: hesitations");
    assert_eq!(got.lapses, want.lapses, "{label}: lapses");
    assert_eq!(got.throttled, want.throttled, "{label}: throttled");
    assert_eq!(got.superseded, want.superseded, "{label}: superseded");
    assert_eq!(got.apm_peak, want.apm_peak, "{label}: apmPeak");
    assert_eq!(
        got.reactions.keys().collect::<Vec<_>>(),
        want.reactions.keys().collect::<Vec<_>>(),
        "{label}: reaction kinds"
    );
    for (kind, got_times) in &got.reactions {
        let want_times = &want.reactions[kind];
        assert_eq!(
            got_times.len(),
            want_times.len(),
            "{label}: reaction {kind:?} count"
        );
        for (index, (got, want)) in got_times.iter().zip(want_times.iter()).enumerate() {
            close(*got, *want, &format!("{label}: reaction {kind:?}[{index}]"));
        }
    }
}

/// The actual draw count and values between `from` and `to` on one lane, found by replaying the declared stream (the
/// hand API is driven, not instrumented: the seeded mulberry32 stream after n draws is unique for these bounded phases).
fn replay_draws(from: &Rng, to: &Rng, limit: usize) -> Option<(usize, Vec<f64>)> {
    let mut probe = from.clone();
    let mut values = Vec::new();
    for drawn in 0..=limit {
        if &probe == to {
            return Some((drawn, values));
        }
        values.push(probe.next_f64());
    }
    None
}

fn check_phase(
    label: &str,
    phase: &str,
    trace: &[Draw],
    replay: &mut [Rng; 2],
    actual: &[Rng; 2],
    drawn: &mut Counts,
) -> Result<(), String> {
    let lanes = [(Lane::Motor, 0usize), (Lane::Lapse, 1usize)];
    for (lane, slot) in lanes {
        let expected: Vec<f64> = trace
            .iter()
            .filter(|draw| draw.lane == lane)
            .map(|draw| draw.value)
            .collect();
        let (count, values) =
            replay_draws(&replay[slot], &actual[slot], 4096).ok_or_else(|| {
                err(
                    label,
                    format!(
                        "{phase} {lane:?} draws are not a prefix of the declared seeded stream"
                    ),
                )
            })?;
        if count != expected.len() {
            return Err(err(
                label,
                format!(
                    "{phase} {lane:?} consumed {count} draws but the source recorded {}",
                    expected.len()
                ),
            ));
        }
        for (index, (got, want)) in values.iter().zip(expected.iter()).enumerate() {
            if got.to_bits() != want.to_bits() {
                return Err(err(
                    label,
                    format!("{phase} {lane:?} draw[{index}] native {got} source {want}"),
                ));
            }
        }
        replay[slot] = actual[slot].clone();
        drawn.add(lane, count as u32);
    }
    Ok(())
}

// --------------------------------------------------------------------------------------------------------------- tests

#[test]
fn sealed_source_hand_supplement_matches_all_profiles() {
    let source = load_source();
    let corpus = read_hand_corpus(&source)
        .unwrap_or_else(|error| panic!("strict sealed hand source reader: {error}"));
    assert_eq!(
        corpus.map_hash_u32, 696510049,
        "the declared open arena map hash pin"
    );
    assert_eq!(
        corpus.profiles.len(),
        PROFILE_ORDER.len(),
        "direct hand profile count"
    );
    let hard = TierParams::by_id(TierId::Hard);
    let mut operations = 0usize;
    for profile in &corpus.profiles {
        assert_eq!(
            profile.tier, *hard,
            "{}: declared full tier differs from the admitted TIERS table",
            profile.name
        );
        assert_ne!(
            profile.seeds.decide, profile.seeds.motor,
            "{}: distinct declared runtime streams",
            profile.name
        );
        let mut hand = match &profile.features {
            None => Humanizer::new(hard, corpus.map.clone()),
            Some(features) => Humanizer::with_features(hard, corpus.map.clone(), features),
        };
        let mut motor = Rng::new(profile.seeds.motor);
        let mut lapse = Rng::new(profile.seeds.lapse);
        let mut replay = [Rng::new(profile.seeds.motor), Rng::new(profile.seeds.lapse)];
        let mut drawn = Counts::default();
        for (index, operation) in profile.operations.iter().enumerate() {
            let label = format!("{} operation {index}", profile.name);
            {
                let mut ctx = Context {
                    p: &operation.percept,
                    engaged: false,
                    motor: &mut motor,
                    lapse: &mut lapse,
                };
                hand.submit(&operation.intents, &mut ctx);
            }
            check_phase(
                &label,
                "submit",
                &operation.submit_trace,
                &mut replay,
                &[motor.clone(), lapse.clone()],
                &mut drawn,
            )
            .unwrap_or_else(|error| panic!("{label}: {error}"));
            let released = {
                let mut ctx = Context {
                    p: &operation.release_percept,
                    engaged: false,
                    motor: &mut motor,
                    lapse: &mut lapse,
                };
                hand.release(&mut ctx)
            };
            check_phase(
                &label,
                "release",
                &operation.release_trace,
                &mut replay,
                &[motor.clone(), lapse.clone()],
                &mut drawn,
            )
            .unwrap_or_else(|error| panic!("{label}: {error}"));
            assert_eq!(
                drawn, operation.counts,
                "{label}: continued draw counts after the real release"
            );
            let misses = hand.drain_misses();
            compare_commands(&released, &operation.result, &label);
            compare_misses(&misses, &operation.misses, &label);
            compare_stats(hand.stats(), &operation.stats, &label);
            assert_eq!(
                operation.memory_keys,
                vec![
                    "fighters".to_string(),
                    "mobs".to_string(),
                    "camps".to_string(),
                    "containers".to_string(),
                    "self".to_string(),
                    "stimuli".to_string(),
                    "bounties".to_string(),
                    "choices".to_string(),
                ],
                "{label}: declared real-Memory side snapshot shape"
            );
            operations += 1;
            // The declared Knowledge stream belongs to the companion Brain witness; the direct hand never draws it,
            // but the strict reader still requires and preserves the declared seed.
            let _knowledge_seed = profile.seeds.knowledge;
        }
    }
    assert_eq!(
        operations, 12,
        "6 direct profiles x 2 real submit/release calls"
    );
}

/// Malformed declared intake is refused by the strict reader before any hand is constructed or any draw can happen; the
/// expected source traces are never used as setup or repaired to fit a native result.
#[test]
fn sealed_source_hand_reader_rejects_malformed_declarations() {
    let source = load_source();
    let envelope = hand_envelope(&source);
    assert!(
        read_hand_corpus(&envelope).is_ok(),
        "the unmodified hand envelope reads"
    );
    let mutations: Vec<CorpusMutation> = vec![
        (
            "wrong source format",
            Box::new(|value| value["format"] = Value::from("rh-bot-private-brain-source/2")),
        ),
        (
            "wrong method-value format",
            Box::new(|value| value["methodValue"] = Value::from("rh-method-value/2")),
        ),
        (
            "missing direct hand supplement",
            Box::new(|value| {
                value.as_object_mut().unwrap().remove("handSupplement");
            }),
        ),
        (
            "renamed profile",
            Box::new(|value| {
                value["handSupplement"][0]["profile"] = Value::from("absent-features");
            }),
        ),
        (
            "extra profile member",
            Box::new(|value| {
                value["handSupplement"][0]["unexpected"] = Value::from(true);
            }),
        ),
        (
            "nonfinite declared clock",
            Box::new(|value| {
                tagged_set(
                    &mut value["handSupplement"][0]["operations"][0]["percept"],
                    "now",
                    serde_json::json!({"$": "number", "value": "+Infinity"}),
                );
            }),
        ),
        (
            "unknown tier id",
            Box::new(|value| {
                tagged_set(
                    &mut value["handSupplement"][0]["tier"],
                    "id",
                    Value::from("nightmare"),
                );
            }),
        ),
        (
            "unknown rng lane",
            Box::new(|value| {
                tagged_set(
                    &mut value["handSupplement"][0]["operations"][0]["submitTrace"]["values"][0],
                    "lane",
                    Value::from("decide"),
                );
            }),
        ),
        (
            "skipped rng index",
            Box::new(|value| {
                tagged_set(
                    &mut value["handSupplement"][0]["operations"][0]["submitTrace"]["values"][0],
                    "index",
                    Value::from(7),
                );
            }),
        ),
        (
            "unknown intent kind",
            Box::new(|value| {
                tagged_set(
                    &mut value["handSupplement"][0]["operations"][0]["intents"]["values"][0],
                    "kind",
                    Value::from("teleport"),
                );
            }),
        ),
        (
            "missing operation member",
            Box::new(|value| {
                value["handSupplement"][0]["operations"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("stats");
            }),
        ),
        (
            "short profile lifetime",
            Box::new(|value| {
                value["handSupplement"][0]["operations"]
                    .as_array_mut()
                    .unwrap()
                    .pop();
            }),
        ),
        (
            "memory side snapshot loses a declared field",
            Box::new(|value| {
                value["handSupplement"][0]["operations"][0]["memory"]["entries"]
                    .as_array_mut()
                    .unwrap()
                    .remove(0);
            }),
        ),
    ];
    for (label, mutate) in mutations {
        let mut mutated = envelope.clone();
        mutate(&mut mutated);
        assert!(
            read_hand_corpus(&mutated).is_err(),
            "strict reader accepted malformed declaration: {label}"
        );
    }
}

/// One malformed-declaration control: a label and an in-memory corpus mutation.
type CorpusMutation = (&'static str, Box<dyn Fn(&mut Value)>);

/// Replace the tagged `key` member of a tagged object in place (test-only corpus mutation).
fn tagged_set(object: &mut Value, key: &str, replacement: Value) {
    let entries = object["entries"]
        .as_array_mut()
        .expect("tagged object entries");
    for pair in entries {
        if pair[0].as_str() == Some(key) {
            pair[1] = replacement;
            return;
        }
    }
    panic!("tagged object has no member {key}");
}

/// The tiny envelope the strict reader is handed: the two format tags, the open map and the direct hand profiles. The
/// rest of the 22 MB corpus (Brain histories, coverage, knowledge dependencies) is not the hand lease's input.
fn hand_envelope(source: &Value) -> Value {
    let open = source["maps"]
        .as_array()
        .expect("maps array")
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some("open"))
        .expect("open map entry")
        .clone();
    serde_json::json!({
        "format": source["format"].clone(),
        "methodValue": source["methodValue"].clone(),
        "maps": [open],
        "handSupplement": source["handSupplement"].clone(),
    })
}
