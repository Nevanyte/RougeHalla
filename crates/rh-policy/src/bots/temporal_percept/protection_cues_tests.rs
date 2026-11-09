//! P-TEMPORAL-PROTECTION-CUES-CONSUMER: private mechanical test adapter for the immutable
//! root-composed 2112-Frame protection/cues actual capture. Declared method/data only: no
//! algorithm, source, public/wire, Memory/FIFO/live or identity change.
use super::data::MethodValue;
use super::input::{Compose, Frame, Maps};
use super::Ring;
use crate::bots::view::Features;
use rh_sim::map::TILE_WALL;
use rh_sim::TileMap;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::File;

const FIXTURE_BYTES: u64 = 45_079_140;
const FRAME_KEYS: [&str; 11] = [
    "t",
    "self",
    "hud",
    "fighters",
    "mobs",
    "containers",
    "projectiles",
    "minimap",
    "events",
    "immediate",
    "extras",
];
const TEMPORAL_KEYS: [&str; 11] = [
    "step",
    "tick",
    "time",
    "viewerId",
    "viewerOrder",
    "frame",
    "composed",
    "filtered",
    "memory",
    "stimuli",
    "composeConfigSha256",
];
const COMPOSED_KEYS: [&str; 12] = [
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
const TOLERANCE: f64 = 2e-6;

#[derive(Clone, Copy, PartialEq, Eq)]
enum TagAllow {
    Frame,
    Expected,
}

fn fixture_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-protection-cues/source.json")
}

fn load_fixture() -> Value {
    let path = fixture_path();
    let meta = std::fs::metadata(&path).expect("tracked protection-cues fixture metadata");
    assert_eq!(meta.len(), FIXTURE_BYTES, "pinned fixture byte length");
    let file = File::open(&path).expect("tracked protection-cues fixture opens");
    let doc: Value = serde_json::from_reader(file).expect("float_roundtrip canonical fixture JSON");
    assert_eq!(doc["format"], "rh-p15-protection-cues-source/2");
    assert_eq!(
        doc["profile"]["sourceBase"],
        "bb564d3b53728cbd205af375b5342eca466f3656"
    );
    assert_eq!(
        doc["profile"]["driverCode"],
        "4fe7aa8285ad65f2c9a1123297426cd48b03bdef"
    );
    assert_eq!(doc["serialization"]["codec"], "rh-tagged-value/1");
    assert_eq!(doc["cases"].as_array().unwrap().len(), 11);
    doc
}

fn keyset(value: &Value, path: &str) -> Vec<String> {
    let mut keys: Vec<String> = value
        .as_object()
        .unwrap_or_else(|| panic!("{path}: expected object"))
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

fn assert_key_shape(value: &Value, wanted: &[&str], path: &str) {
    let mut want: Vec<String> = wanted.iter().map(|s| (*s).to_string()).collect();
    want.sort();
    assert_eq!(
        keyset(value, path),
        want,
        "{path}: complete declared key shape"
    );
}

fn num_field(value: &Value, key: &str, path: &str) -> f64 {
    value[key]
        .as_f64()
        .unwrap_or_else(|| panic!("{path}.{key}: expected captured binary64"))
}

/// Strict decoder for the one tag actually present in the temporal/expected selections: an own
/// $rh:undefined leaf. Unknown tags, extra tag fields, and misplaced typed-array tags refuse.
fn decode_value(value: &Value, path: &str, allow: TagAllow) -> Result<MethodValue, String> {
    match value {
        Value::Null => Ok(MethodValue::Null),
        Value::Bool(b) => Ok(MethodValue::Bool(*b)),
        Value::Number(n) => Ok(MethodValue::Num(
            n.as_f64()
                .ok_or_else(|| format!("{path}: non-binary64 number"))?,
        )),
        Value::String(s) => Ok(MethodValue::Str(s.clone())),
        Value::Array(rows) => {
            let mut out = Vec::with_capacity(rows.len());
            for (i, row) in rows.iter().enumerate() {
                out.push(decode_value(row, &format!("{path}[{i}]"), allow)?);
            }
            Ok(MethodValue::Arr(out))
        }
        Value::Object(map) => {
            if map.contains_key("$rh") {
                if allow == TagAllow::Frame
                    && map.len() == 1
                    && map.get("$rh").and_then(Value::as_str) == Some("undefined")
                {
                    return Ok(MethodValue::Undefined);
                }
                if allow == TagAllow::Expected
                    && map.len() == 1
                    && map.get("$rh").and_then(Value::as_str) == Some("undefined")
                {
                    return Ok(MethodValue::Undefined);
                }
                return Err(format!(
                    "{path}: unsupported/misplaced tagged value with fields {:?}",
                    keyset(value, path)
                ));
            }
            let mut fields = Vec::with_capacity(map.len());
            for (key, member) in map {
                fields.push((
                    key.clone(),
                    decode_value(member, &format!("{path}.{key}"), allow)?,
                ));
            }
            Ok(MethodValue::Obj(fields))
        }
    }
}

fn decode_frame(value: &Value, path: &str) -> Result<MethodValue, String> {
    decode_value(value, path, TagAllow::Frame)
}

fn decode_expected(value: &Value, path: &str) -> Result<MethodValue, String> {
    decode_value(value, path, TagAllow::Expected)
}

fn decode_tagged_u8_array(
    value: &Value,
    path: &str,
    expected_len: usize,
) -> Result<Vec<u8>, String> {
    let map = value
        .as_object()
        .ok_or_else(|| format!("{path}: typed array must be an object"))?;
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort();
    let mut wanted = ["$rh", "type", "values"];
    wanted.sort();
    if keys != wanted.to_vec() {
        return Err(format!(
            "{path}: typed-array tag fields must be exactly $rh/type/values"
        ));
    }
    if map["$rh"] != "typed" || map["type"] != "Uint8Array" {
        return Err(format!("{path}: unsupported typed value"));
    }
    let values = map["values"]
        .as_array()
        .ok_or_else(|| format!("{path}: typed values must be an array"))?;
    if values.len() != expected_len {
        return Err(format!(
            "{path}: typed Uint8Array length {} is not {expected_len}",
            values.len()
        ));
    }
    let mut out = Vec::with_capacity(values.len());
    for (i, v) in values.iter().enumerate() {
        let n = v
            .as_u64()
            .ok_or_else(|| format!("{path}[{i}]: typed value is not an integer u8"))?;
        if n > 255 {
            return Err(format!(
                "{path}[{i}]: typed Uint8Array value {n} exceeds 255"
            ));
        }
        out.push(n as u8);
    }
    Ok(out)
}

fn count_undefined(value: &MethodValue) -> usize {
    match value {
        MethodValue::Undefined => 1,
        MethodValue::Arr(rows) => rows.iter().map(count_undefined).sum(),
        MethodValue::Obj(fields) => fields.iter().map(|(_, v)| count_undefined(v)).sum(),
        _ => 0,
    }
}

fn feature_bool(
    map: &serde_json::Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<bool, String> {
    map.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("{path}.{key}: missing/invalid boolean feature"))
}

fn read_features(value: &Value, path: &str) -> Result<Features, String> {
    let map = value
        .as_object()
        .ok_or_else(|| format!("{path}: features must be an object"))?;
    let mut got: Vec<&str> = map.keys().map(String::as_str).collect();
    got.sort();
    let mut want = [
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
    want.sort();
    if got != want.to_vec() {
        return Err(format!("{path}: features keyset mismatch"));
    }
    let types = map["messageTypes"]
        .as_array()
        .ok_or_else(|| format!("{path}.messageTypes: not an array"))?;
    if types.len() != 19 {
        return Err(format!("{path}.messageTypes: length {}", types.len()));
    }
    let mut message_types = Vec::with_capacity(types.len());
    for (i, v) in types.iter().enumerate() {
        message_types.push(
            v.as_str()
                .ok_or_else(|| format!("{path}.messageTypes[{i}]: not a string"))?
                .to_string(),
        );
    }
    Ok(Features {
        message_types,
        wishes: feature_bool(map, "wishes", path)?,
        status_effects: feature_bool(map, "statusEffects", path)?,
        fields: feature_bool(map, "fields", path)?,
        planning: feature_bool(map, "planning", path)?,
        chests: feature_bool(map, "chests", path)?,
        skills: feature_bool(map, "skills", path)?,
        relics: feature_bool(map, "relics", path)?,
        camps: feature_bool(map, "camps", path)?,
        hazards: feature_bool(map, "hazards", path)?,
    })
}

struct CaseMaps {
    maps: Maps,
    gate_tiles: Vec<(i64, i64)>,
}

fn read_maps(case: &Value, profile_map: &Value, case_path: &str) -> Result<CaseMaps, String> {
    let composition = &case["composition"];
    let map = &composition["map"];
    let w = map["w"]
        .as_u64()
        .ok_or_else(|| format!("{case_path}.map.w: missing"))? as usize;
    let h = map["h"]
        .as_u64()
        .ok_or_else(|| format!("{case_path}.map.h: missing"))? as usize;
    if (w, h) != (24, 24) {
        return Err(format!(
            "{case_path}.map: captured dims {w}x{h} are not 24x24"
        ));
    }
    let expected_len = w * h;
    let mut arrays: Vec<Vec<u8>> = Vec::with_capacity(5);
    for name in [
        "tiles",
        "terrain",
        "regionGrid",
        "territoryGrid",
        "featureGrid",
    ] {
        let path = format!("{case_path}.map.{name}");
        arrays.push(decode_tagged_u8_array(&map[name], &path, expected_len)?);
    }
    let open_tiles = arrays[0].clone();
    let mut locked_tiles = open_tiles.clone();
    if composition["mapSha256"] != profile_map["sha256"]
        || composition["mapInput"]["sha256"] != profile_map["sha256"]
        || composition["mapInput"]["bytes"] != profile_map["bytes"]
        || composition["mapInput"]["path"] != profile_map["path"]
    {
        return Err(format!(
            "{case_path}: captured born-map pins differ: mapSha={:?} profileSha={:?} mapInput={:?}",
            composition["mapSha256"], profile_map["sha256"], composition["mapInput"]
        ));
    }
    let gates = map["coliseum"]["gates"]
        .as_array()
        .ok_or_else(|| format!("{case_path}.map.coliseum.gates: missing gate array"))?;
    let mut gate_tiles = Vec::new();
    for (gi, gate) in gates.iter().enumerate() {
        let tiles = gate["tiles"]
            .as_array()
            .ok_or_else(|| format!("{case_path}.gate[{gi}].tiles: missing"))?;
        for (ti, tile) in tiles.iter().enumerate() {
            let x = tile["x"]
                .as_i64()
                .ok_or_else(|| format!("{case_path}.gate[{gi}].tiles[{ti}].x: missing"))?;
            let y = tile["y"]
                .as_i64()
                .ok_or_else(|| format!("{case_path}.gate[{gi}].tiles[{ti}].y: missing"))?;
            if x < 0 || y < 0 || x as usize >= w || y as usize >= h {
                return Err(format!(
                    "{case_path}.gate[{gi}].tiles[{ti}]: ({x},{y}) out of map bounds"
                ));
            }
            let index = y as usize * w + x as usize;
            if open_tiles[index] != 0 {
                return Err(format!(
                    "{case_path}.gate[{gi}].tiles[{ti}]: open tile is not floor"
                ));
            }
            if locked_tiles[index] == TILE_WALL {
                return Err(format!(
                    "{case_path}.gate[{gi}].tiles[{ti}]: duplicate locked gate tile"
                ));
            }
            locked_tiles[index] = TILE_WALL;
            gate_tiles.push((x, y));
        }
    }
    let want_gates = [(11, 9), (14, 11), (11, 14), (9, 11)];
    if gate_tiles != want_gates {
        return Err(format!(
            "{case_path}: captured gate tiles {gate_tiles:?} differ from {want_gates:?}"
        ));
    }
    let open = TileMap::new(w as u32, h as u32, open_tiles)
        .map_err(|_| format!("{case_path}: actual open map rejected"))?;
    let locked = TileMap::new(w as u32, h as u32, locked_tiles)
        .map_err(|_| format!("{case_path}: actual locked map rejected"))?;
    if open.blocked(11, 9, u8::MAX) {
        return Err(format!(
            "{case_path}: captured open map unexpectedly blocks gate"
        ));
    }
    if !locked.blocked(11, 9, u8::MAX) {
        return Err(format!(
            "{case_path}: derived locked map does not block gate"
        ));
    }
    Ok(CaseMaps {
        maps: Maps { open, locked },
        gate_tiles,
    })
}

#[derive(Default)]
struct Totals {
    frames: usize,
    nonnull: usize,
    null: usize,
    in_fighters: usize,
    in_projectiles: usize,
    in_containers: usize,
    in_events: usize,
    in_undefined: usize,
    out_fighters: usize,
    out_projectiles: usize,
    out_containers: usize,
    out_events: usize,
    out_undefined: usize,
    out_arrow: usize,
    out_ball: usize,
    delayed_empty_frame: usize,
    max_error: f64,
}

fn readable_key(path: &str) -> &str {
    let after_dot = path.rsplit('.').next().unwrap_or(path);
    after_dot.split('[').next().unwrap_or(after_dot)
}

fn tolerant_key(path: &str) -> bool {
    matches!(
        readable_key(path),
        "x" | "y" | "x0" | "y0" | "vx" | "vy" | "dist" | "tint"
    )
}

fn compare_values(
    native: &MethodValue,
    expected: &MethodValue,
    path: &str,
    tol: &mut f64,
) -> Result<(), String> {
    match (native, expected) {
        (MethodValue::Num(a), MethodValue::Num(e)) => {
            if tolerant_key(path) {
                let delta = (a - e).abs();
                if delta > TOLERANCE {
                    return Err(format!("{path}: |{a} - {e}| = {delta} exceeds {TOLERANCE}"));
                }
                if delta > *tol {
                    *tol = delta;
                }
            } else if a.to_bits() != e.to_bits() {
                return Err(format!("{path}: exact binary64 mismatch {a} != {e}"));
            }
        }
        (MethodValue::Undefined, MethodValue::Undefined)
        | (MethodValue::Null, MethodValue::Null) => {}
        (MethodValue::Bool(a), MethodValue::Bool(e)) if a == e => {}
        (MethodValue::Str(a), MethodValue::Str(e)) if a == e => {}
        (MethodValue::Arr(a), MethodValue::Arr(e)) => {
            if a.len() != e.len() {
                return Err(format!("{path}: array length {} != {}", a.len(), e.len()));
            }
            for (i, (av, ev)) in a.iter().zip(e).enumerate() {
                compare_values(av, ev, &format!("{path}[{i}]"), tol)?;
            }
        }
        (MethodValue::Obj(a), MethodValue::Obj(e)) => {
            if a.len() != e.len() {
                return Err(format!(
                    "{path}: object field count {} != {}",
                    a.len(),
                    e.len()
                ));
            }
            for (key, ev) in e {
                let Some((_, av)) = a.iter().find(|(k, _)| k == key) else {
                    return Err(format!("{path}.{key}: native record lacks expected field"));
                };
                compare_values(av, ev, &format!("{path}.{key}"), tol)?;
            }
        }
        _ => {
            return Err(format!(
                "{path}: value variant mismatch native={native:?} expected={expected:?}"
            ));
        }
    }
    Ok(())
}

fn method_object<'a>(
    value: &'a MethodValue,
    path: &str,
) -> Result<Vec<(&'a str, &'a MethodValue)>, String> {
    match value {
        MethodValue::Obj(fields) => Ok(fields.iter().map(|(k, v)| (k.as_str(), v)).collect()),
        _ => Err(format!("{path}: expected composed object")),
    }
}

fn method_field<'a>(
    fields: &[(&'a str, &'a MethodValue)],
    key: &str,
    path: &str,
) -> Result<&'a MethodValue, String> {
    fields
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| *v)
        .ok_or_else(|| format!("{path}.{key}: missing composed field"))
}

fn method_len(value: &MethodValue, path: &str) -> Result<usize, String> {
    match value {
        MethodValue::Arr(rows) => Ok(rows.len()),
        _ => Err(format!("{path}: expected array")),
    }
}

fn count_composed_kinds(value: &MethodValue) -> Result<(usize, usize), String> {
    let MethodValue::Arr(rows) = value else {
        return Err("composed.projectiles: expected array".to_string());
    };
    let mut arrow = 0;
    let mut ball = 0;
    for (i, row) in rows.iter().enumerate() {
        let MethodValue::Obj(fields) = row else {
            return Err(format!("composed.projectiles[{i}]: expected object"));
        };
        let kind = fields
            .iter()
            .find(|(k, _)| k == "kind")
            .map(|(_, v)| v)
            .ok_or_else(|| format!("composed.projectiles[{i}].kind: missing"))?;
        match kind {
            MethodValue::Str(k) if k == "arrow" => arrow += 1,
            MethodValue::Str(k) if k == "ball" => ball += 1,
            other => {
                return Err(format!(
                    "composed.projectiles[{i}].kind: unsupported {other:?}"
                ))
            }
        }
    }
    Ok((arrow, ball))
}

fn run_case(doc: &Value, case: &Value, totals: &mut Totals) -> Result<(), String> {
    let case_id = case["caseId"].as_str().ok_or("caseId missing")?;
    let temporal = case["temporal"]
        .as_array()
        .ok_or_else(|| format!("{case_id}: temporal missing"))?;
    if temporal.len() != 192 || case["temporalCount"].as_u64() != Some(192) {
        return Err(format!("{case_id}: captured temporal count mismatch"));
    }
    let composition = &case["composition"];
    let features = read_features(
        &composition["features"],
        &format!("{case_id}.composition.features"),
    )?;
    let case_maps = read_maps(
        case,
        &doc["profile"]["map"],
        &format!("{case_id}.composition"),
    )?;
    let self_delay = num_field(composition, "selfDelayMs", case_id);
    let world_delay = num_field(composition, "worldDelayMs", case_id);
    let attention = num_field(composition, "attentionCentral", case_id);
    if !self_delay.is_finite() || !world_delay.is_finite() || !attention.is_finite() {
        return Err(format!("{case_id}: nonfinite supplied compose config"));
    }
    if self_delay != 0.0 || world_delay != 125.0 {
        return Err(format!(
            "{case_id}: supplied delays {self_delay}/{world_delay} differ from captured views"
        ));
    }
    let mut rings: BTreeMap<String, Ring> = BTreeMap::new();
    let mut lock_false = false;
    let mut lock_true = false;
    let mut lock_flips = 0usize;
    let mut last_lock: Option<bool> = None;
    let mut case_nulls = 0usize;
    let mut max_error = 0.0f64;
    for (index, entry) in temporal.iter().enumerate() {
        assert_key_shape(entry, &TEMPORAL_KEYS, &format!("{case_id}[{index}]"));
        let viewer = entry["viewerId"]
            .as_str()
            .ok_or_else(|| format!("{case_id}[{index}]: viewerId missing"))?;
        let step = entry["step"].as_u64().unwrap_or(0);
        let tick = entry["tick"].as_u64().unwrap_or(0);
        let time = num_field(entry, "time", case_id);
        if time != tick as f64 * 50.0 {
            return Err(format!(
                "{case_id} viewer {viewer} step {step}: time {time} is not tick*50"
            ));
        }
        if entry["viewerOrder"].as_u64().is_none() {
            return Err(format!(
                "{case_id} viewer {viewer} step {step}: viewerOrder missing"
            ));
        }
        let frame_value = &entry["frame"];
        assert_key_shape(
            frame_value,
            &FRAME_KEYS,
            &format!("{case_id} viewer {viewer} step {step} frame"),
        );
        if num_field(frame_value, "t", case_id) != time {
            return Err(format!(
                "{case_id} viewer {viewer} step {step}: frame.t differs from entry time"
            ));
        }
        let frame_path = format!("{case_id} viewer {viewer} step {step} frame");
        let decoded_frame = decode_frame(frame_value, &frame_path)?;
        let frame_undefined = count_undefined(&decoded_frame);
        let frame = Frame::read(decoded_frame)
            .map_err(|e| format!("{case_id} viewer {viewer} step {step}: Frame::read {e:?}"))?;
        totals.frames += 1;
        totals.in_fighters += frame.fighters.len();
        totals.in_projectiles += frame.projectiles.len();
        totals.in_containers += frame.containers.len();
        totals.in_events += frame.events.len();
        totals.in_undefined += frame_undefined;
        let lock = frame.hud.locked;
        if let Some(prev) = last_lock {
            if prev != lock {
                lock_flips += 1;
            }
        }
        last_lock = Some(lock);
        if lock {
            lock_true = true;
        } else {
            lock_false = true;
        }
        let ring = rings.entry(viewer.to_string()).or_default();
        let _report = ring.push(frame);
        let percept = ring
            .compose(&Compose {
                self_delay_ms: self_delay,
                world_delay_ms: world_delay,
                attention_central: attention,
                maps: &case_maps.maps,
                features: &features,
            })
            .map_err(|e| format!("{case_id} viewer {viewer} step {step}: compose {e:?}"))?;
        let composed_value = &entry["composed"];
        if composed_value.is_null() {
            if percept.is_some() {
                return Err(format!(
                    "{case_id} viewer {viewer} step {step}: expected null composition"
                ));
            }
            totals.null += 1;
            case_nulls += 1;
            continue;
        }
        let expected = decode_expected(
            composed_value,
            &format!("{case_id} viewer {viewer} step {step} composed"),
        )?;
        let percept = percept.ok_or_else(|| {
            format!("{case_id} viewer {viewer} step {step}: expected nonnull composition")
        })?;
        let native = percept.data();
        compare_values(
            &native,
            &expected,
            &format!("{case_id} viewer {viewer} step {step} composed"),
            &mut max_error,
        )?;
        let fields = method_object(&expected, "composed")?;
        let expected_keys: Vec<&str> = fields.iter().map(|(k, _)| *k).collect();
        for key in COMPOSED_KEYS {
            if !expected_keys.contains(&key) {
                return Err(format!(
                    "{case_id} viewer {viewer} step {step}: expected composed lacks {key}"
                ));
            }
        }
        let out_fighters = method_len(
            method_field(&fields, "fighters", "composed")?,
            "composed.fighters",
        )?;
        let out_containers = method_len(
            method_field(&fields, "containers", "composed")?,
            "composed.containers",
        )?;
        let out_events = method_len(
            method_field(&fields, "events", "composed")?,
            "composed.events",
        )?;
        let out_projectiles = method_field(&fields, "projectiles", "composed")?;
        let out_proj = method_len(out_projectiles, "composed.projectiles")?;
        let (arrow, ball) = count_composed_kinds(out_projectiles)?;
        totals.out_fighters += out_fighters;
        totals.out_containers += out_containers;
        totals.out_events += out_events;
        totals.out_projectiles += out_proj;
        totals.out_arrow += arrow;
        totals.out_ball += ball;
        totals.out_undefined += count_undefined(&expected);
        if out_proj > 0 && frame_value["projectiles"].as_array().unwrap().is_empty() {
            totals.delayed_empty_frame += 1;
        }
        totals.nonnull += 1;
    }
    if case_nulls != 6 {
        return Err(format!(
            "{case_id}: null compositions {case_nulls}, expected 6"
        ));
    }
    if !lock_false || !lock_true || lock_flips == 0 {
        return Err(format!(
            "{case_id}: supplied hud.gatesLocked lacks an actual open/closed transition"
        ));
    }
    if case_maps.gate_tiles.len() != 4 {
        return Err(format!(
            "{case_id}: captured gate tile count {}",
            case_maps.gate_tiles.len()
        ));
    }
    if max_error > TOLERANCE {
        return Err(format!(
            "{case_id}: raw numeric error {max_error} exceeds tolerance"
        ));
    }
    totals.max_error = totals.max_error.max(max_error);
    Ok(())
}

#[test]
fn actual_protection_cues_frames_compose_exact() {
    let doc = load_fixture();
    let mut totals = Totals::default();
    for case in doc["cases"].as_array().unwrap() {
        if !case["error"].is_null() {
            panic!("case {} records a source error", case["caseId"]);
        }
        run_case(&doc, case, &mut totals).unwrap_or_else(|e| panic!("{e}"));
    }
    assert_eq!(totals.frames, 2112, "all actual Frames consumed");
    assert_eq!(totals.null, 66, "exact source null compositions");
    assert_eq!(
        totals.nonnull, 2046,
        "exact source nonnull prefilter Percepts"
    );
    assert_eq!(totals.in_fighters, 1824, "fighter input rows");
    assert_eq!(totals.in_projectiles, 12, "projectile input rows");
    assert_eq!(totals.in_containers, 88, "container input rows");
    assert_eq!(totals.in_events, 98, "event input rows");
    assert_eq!(totals.in_undefined, 88, "input Undefined weapon leaves");
    assert_eq!(totals.out_fighters, 1711, "composed fighter rows");
    assert_eq!(totals.out_projectiles, 42, "composed projectile rows");
    assert_eq!(totals.out_arrow, 12, "composed Arrow rows");
    assert_eq!(totals.out_ball, 30, "composed Ball rows");
    assert_eq!(totals.out_containers, 82, "composed container rows");
    assert_eq!(totals.out_events, 98, "composed event rows");
    assert_eq!(totals.out_undefined, 82, "composed Undefined weapon leaves");
    assert_eq!(
        totals.delayed_empty_frame, 42,
        "delayed-course outputs with empty contemporaneous Frame projectiles"
    );
    eprintln!(
        "protection-cues actual: frames={} nonnull={} null={} max_raw_numeric_error={:.17e}",
        totals.frames, totals.nonnull, totals.null, totals.max_error
    );
}

#[test]
fn protection_cues_tagged_value_controls_are_strict() {
    let unknown = serde_json::json!({"$rh": "typed", "type": "Map", "values": []});
    assert!(decode_frame(&unknown, "$").is_err());
    assert!(decode_expected(&unknown, "$").is_err());
    let extra = serde_json::json!({"$rh": "undefined", "extra": 1});
    assert!(decode_expected(&extra, "$").is_err());
    let undefined = decode_expected(&serde_json::json!({"$rh": "undefined"}), "$").unwrap();
    let null = decode_expected(&Value::Null, "$").unwrap();
    assert_ne!(undefined, null, "explicit Undefined differs from Null");
    let complete = decode_expected(&serde_json::json!({"a": {"$rh": "undefined"}}), "$").unwrap();
    let omitted = decode_expected(&serde_json::json!({"a": null}), "$").unwrap();
    assert_ne!(
        complete, omitted,
        "Undefined member differs from Null member"
    );
    let typed = serde_json::json!({"$rh":"typed","type":"Uint8Array","values":[0,1]});
    assert!(decode_expected(&typed, "$").is_err());
}

#[test]
fn protection_cues_map_controls_are_strict() {
    let good = serde_json::json!({
        "$rh":"typed","type":"Uint8Array","values":vec![0u8; 576]
    });
    assert!(decode_tagged_u8_array(&good, "$map", 576).is_ok());
    let short = serde_json::json!({
        "$rh":"typed","type":"Uint8Array","values":vec![0u8; 575]
    });
    assert!(decode_tagged_u8_array(&short, "$map", 576).is_err());
    let mut overflow = vec![0u16; 576];
    overflow[7] = 256;
    let bad = serde_json::json!({
        "$rh":"typed","type":"Uint8Array","values":overflow
    });
    assert!(decode_tagged_u8_array(&bad, "$map", 576).is_err());
    let wrong_type = serde_json::json!({
        "$rh":"typed","type":"Map","values":vec![0u8; 576]
    });
    assert!(decode_tagged_u8_array(&wrong_type, "$map", 576).is_err());
    let extra = serde_json::json!({
        "$rh":"typed","type":"Uint8Array","values":vec![0u8; 576],"extra":1
    });
    assert!(decode_tagged_u8_array(&extra, "$map", 576).is_err());
}
