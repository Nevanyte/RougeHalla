//! Test-only mechanical adapter for the bot-vision witness: the `rh-vision-value/1` decoder,
//! the captured seed-1 map, the declared Percept reader and one replay loop shared by the
//! declared-input check and the future actual-source comparison. It installs nothing from an
//! expected output: grids, wards and reveals are produced only by `BotVision` itself.
use super::super::data::{MethodValue, Object};
use super::super::input::Percept;
use super::declared::UpdateInput;
use super::BotVision;
use crate::bots::view::Features;
use rh_sim::mapdata::MapExport;
use rh_sim::{TileMap, Vec2};
use serde_json::Value;

pub(super) const MAP_PATH: &str = "crates/rh-sim/src/mapdata/fixtures/seed1.map.json";
pub(super) const DECLARED_PATH: &str = "parity/policy/bot-vision/declared-inputs.json";
pub(super) const SOURCE_PATH: &str = "parity/policy/bot-vision/source.json";

pub(super) fn repo_path(rel: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(rel)
}

/// The captured legacy seed-1 `rh-map/2` export, validated with its public layers.
pub(super) fn seed1() -> TileMap {
    let text = std::fs::read_to_string(repo_path(MAP_PATH)).expect("seed-1 map fixture");
    let export: MapExport = serde_json::from_str(&text).expect("rh-map/2 document");
    let (w, h, tiles, layers) = export.validate().expect("valid map").into_parts();
    TileMap::new(w, h, tiles)
        .and_then(|m| m.with_layers(layers))
        .expect("map with layers")
}

// ------------------------------------------------------------------------------- rh-vision-value/1
fn tag<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value
        .as_object()
        .filter(|o| o.len() == 1)
        .and_then(|o| o.get(key))
}

/// Strict decoder. Holes and Maps refuse here; a Map is decoded only where the source has one.
pub(super) fn decode(value: &Value, path: &str) -> Result<MethodValue, String> {
    Ok(match value {
        Value::Null => MethodValue::Null,
        Value::Bool(v) => MethodValue::Bool(*v),
        Value::Number(n) => MethodValue::Num(n.as_f64().ok_or_else(|| format!("{path}: number"))?),
        Value::String(s) => MethodValue::Str(s.clone()),
        Value::Array(rows) => MethodValue::Arr(
            rows.iter()
                .enumerate()
                .map(|(i, v)| decode(v, &format!("{path}[{i}]")))
                .collect::<Result<_, _>>()?,
        ),
        Value::Object(_) => {
            if tag(value, "$u").is_some() {
                MethodValue::Undefined
            } else if let Some(n) = tag(value, "$n") {
                MethodValue::Num(match n.as_str() {
                    Some("-0") => -0.,
                    Some("NaN") => f64::NAN,
                    Some("Infinity") => f64::INFINITY,
                    Some("-Infinity") => f64::NEG_INFINITY,
                    _ => return Err(format!("{path}: bad $n")),
                })
            } else if let Some(entries) = tag(value, "$o") {
                MethodValue::Obj(decode_entries(entries, path)?)
            } else {
                return Err(format!("{path}: unsupported tag {value}"));
            }
        }
    })
}

fn decode_entries(entries: &Value, path: &str) -> Result<Vec<(String, MethodValue)>, String> {
    entries
        .as_array()
        .ok_or_else(|| format!("{path}: entries"))?
        .iter()
        .map(|pair| match pair.as_array().map(Vec::as_slice) {
            Some([Value::String(k), v]) => Ok((k.clone(), decode(v, &format!("{path}.{k}"))?)),
            _ => Err(format!("{path}: entry")),
        })
        .collect()
}

/// Bitwise identity of method values: every NaN is the one JS NaN; -0 differs from +0;
/// object members compare in order.
pub(super) fn first_difference(
    got: &MethodValue,
    want: &MethodValue,
    path: &str,
) -> Option<String> {
    use MethodValue as V;
    match (got, want) {
        (V::Num(a), V::Num(b)) => (!(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())))
            .then(|| format!("{path}: {a:?} != {b:?}")),
        (V::Arr(a), V::Arr(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path}: length {} != {}", a.len(), b.len()));
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (x, y))| first_difference(x, y, &format!("{path}[{i}]")))
        }
        (V::Obj(a), V::Obj(b)) => {
            let ka: Vec<&str> = a.iter().map(|(k, _)| k.as_str()).collect();
            let kb: Vec<&str> = b.iter().map(|(k, _)| k.as_str()).collect();
            if ka != kb {
                return Some(format!("{path}: keys {ka:?} != {kb:?}"));
            }
            a.iter()
                .zip(b)
                .find_map(|((k, x), (_, y))| first_difference(x, y, &format!("{path}.{k}")))
        }
        _ => (got != want).then(|| format!("{path}: {got:?} != {want:?}")),
    }
}

// ----------------------------------------------------------------------------------- declared reads
/// `{state, privates?}` with `state.players` a Map.
pub(super) fn update_input(input: &Value, path: &str) -> Result<UpdateInput, String> {
    let entries = tag(input, "$o")
        .and_then(Value::as_array)
        .ok_or(format!("{path}: input"))?;
    let mut state = None;
    let mut privates = None;
    for pair in entries {
        match pair.as_array().map(Vec::as_slice) {
            Some([Value::String(k), v]) if k == "state" => state = Some(v),
            Some([Value::String(k), v]) if k == "privates" => {
                privates = Some(decode(v, &format!("{path}.privates"))?)
            }
            _ => return Err(format!("{path}: undeclared PerceptionInput member {pair}")),
        }
    }
    let state = state.ok_or(format!("{path}: state"))?;
    let mut fields = Vec::new();
    let mut players = None;
    for pair in tag(state, "$o")
        .and_then(Value::as_array)
        .ok_or(format!("{path}: state"))?
    {
        let Some([Value::String(k), v]) = pair.as_array().map(Vec::as_slice) else {
            return Err(format!("{path}: state entry"));
        };
        if k == "players" {
            let map = tag(v, "$m").ok_or(format!("{path}: players must be a Map"))?;
            players = Some(decode_entries(map, &format!("{path}.players"))?);
        } else {
            fields.push((k.clone(), decode(v, &format!("{path}.state.{k}"))?));
        }
    }
    let players = players.ok_or(format!("{path}: players"))?;
    UpdateInput::read(&Object(fields), players, privates)
        .map_err(|e| format!("{path}: refused {e:?}"))
}

const PERCEPT_KEYS: [&str; 12] = [
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
const FEATURE_KEYS: [&str; 10] = [
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

/// A declared composed Percept in exactly the shape `Percept::data` writes back.
pub(super) fn percept(value: &MethodValue) -> Result<Percept, String> {
    let MethodValue::Obj(fields) = value else {
        return Err("percept".into());
    };
    let keys: Vec<&str> = fields.iter().map(|(k, _)| k.as_str()).collect();
    if keys != PERCEPT_KEYS {
        return Err(format!("percept keys {keys:?}"));
    }
    let get = |i: usize| &fields[i].1;
    let obj = |v: &MethodValue| match v {
        MethodValue::Obj(f) => Ok(Object(f.clone())),
        _ => Err("object".to_string()),
    };
    let rows = |v: &MethodValue| match v {
        MethodValue::Arr(r) => r.iter().map(obj).collect::<Result<Vec<_>, _>>(),
        _ => Err("rows".to_string()),
    };
    let num = |v: &MethodValue| match v {
        MethodValue::Num(n) => Ok(*n),
        _ => Err("number".to_string()),
    };
    let MethodValue::Arr(projectiles) = get(7) else {
        return Err("projectiles".into());
    };
    Ok(Percept {
        now: num(get(0))?,
        view_time: num(get(1))?,
        owner: obj(get(2))?,
        hud: obj(get(3))?,
        fighters: rows(get(4))?,
        mobs: rows(get(5))?,
        containers: rows(get(6))?,
        projectiles: projectiles.clone(),
        minimap: get(8).clone(),
        events: rows(get(9))?,
        extras: obj(get(10))?,
        features: features(get(11))?,
    })
}

fn features(value: &MethodValue) -> Result<Features, String> {
    let MethodValue::Obj(f) = value else {
        return Err("features".into());
    };
    let keys: Vec<&str> = f.iter().map(|(k, _)| k.as_str()).collect();
    if keys != FEATURE_KEYS {
        return Err(format!("feature keys {keys:?}"));
    }
    let bit = |i: usize| match &f[i].1 {
        MethodValue::Bool(b) => Ok(*b),
        _ => Err(format!("feature {}", f[i].0)),
    };
    let MethodValue::Arr(types) = &f[0].1 else {
        return Err("messageTypes".into());
    };
    Ok(Features {
        message_types: types
            .iter()
            .map(|t| match t {
                MethodValue::Str(s) => Ok(s.clone()),
                _ => Err("messageType".to_string()),
            })
            .collect::<Result<_, _>>()?,
        wishes: bit(1)?,
        status_effects: bit(2)?,
        fields: bit(3)?,
        planning: bit(4)?,
        chests: bit(5)?,
        skills: bit(6)?,
        relics: bit(7)?,
        camps: bit(8)?,
        hazards: bit(9)?,
    })
}

fn point(value: &MethodValue) -> Result<Vec2, String> {
    match value {
        MethodValue::Obj(f) => Object(f.clone()).at().map_err(|e| format!("point {e:?}")),
        _ => Err("point".into()),
    }
}

// ------------------------------------------------------------------------------------------ replay
/// One step: the declared input and, when replaying an actual capture, what the source did.
pub(super) struct Step {
    pub(super) op: String,
    pub(super) input: Option<Value>,
    pub(super) self_id: Option<String>,
    pub(super) points: Option<Value>,
    pub(super) actual: Option<Value>,
}
pub(super) struct Case {
    pub(super) id: String,
    pub(super) expect_throw: bool,
    pub(super) steps: Vec<Step>,
}

fn entries_of(value: &Value) -> Vec<(String, Value)> {
    tag(value, "$o")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|p| match p.as_array().map(Vec::as_slice) {
                    Some([Value::String(k), v]) => Some((k.clone(), v.clone())),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The declared cases exactly as `encode(cases())` wrote them.
pub(super) fn declared_cases(doc: &Value) -> Vec<Case> {
    doc.as_array()
        .expect("declared cases array")
        .iter()
        .map(|c| {
            let c: std::collections::BTreeMap<_, _> = entries_of(c).into_iter().collect();
            Case {
                id: c["id"].as_str().expect("id").to_owned(),
                expect_throw: c.get("expectThrow") == Some(&Value::Bool(true)),
                steps: c["steps"]
                    .as_array()
                    .expect("steps")
                    .iter()
                    .map(|s| {
                        let s: std::collections::BTreeMap<_, _> =
                            entries_of(s).into_iter().collect();
                        Step {
                            op: s["op"].as_str().expect("op").to_owned(),
                            input: s.get("input").or(s.get("percept")).cloned(),
                            self_id: s.get("selfId").and_then(Value::as_str).map(str::to_owned),
                            points: s.get("points").cloned(),
                            actual: None,
                        }
                    })
                    .collect(),
            }
        })
        .collect()
}

/// Replays every case through a fresh native `BotVision` on the seed-1 map. Without `actual`
/// records this only proves every declared input is consumable (refusing exactly where the
/// source is declared to throw). With them it is the parity comparison; the first
/// discrepancy is returned as `case[step]: path: got != want`.
pub(super) fn replay(map: &TileMap, cases: &[Case]) -> Result<usize, String> {
    let mut compared = 0;
    for case in cases {
        let mut vision =
            BotVision::new(map.clone()).map_err(|e| format!("{}: new {e:?}", case.id))?;
        for (i, step) in case.steps.iter().enumerate() {
            let at = format!("{}[{i}]", case.id);
            let threw = step
                .actual
                .as_ref()
                .is_some_and(|a| a.get("threw").is_some());
            let last = i + 1 == case.steps.len();
            let declared_throw = case.expect_throw && last;
            if step.actual.is_some() && threw != declared_throw {
                return Err(format!(
                    "{at}: source threw={threw}, declared throw={declared_throw}"
                ));
            }
            match step.op.as_str() {
                "update" => {
                    let input = step.input.as_ref().ok_or(format!("{at}: input"))?;
                    let self_id = step.self_id.as_deref().ok_or(format!("{at}: selfId"))?;
                    let result = update_input(input, &at).and_then(|input| {
                        vision
                            .update(&input, self_id)
                            .map_err(|e| format!("{at}: refused {e:?}"))
                    });
                    if declared_throw {
                        // The source throws here (its partial mutation is not modeled); native
                        // must refuse. The throwing step is always the case's last.
                        if result.is_ok() {
                            return Err(format!("{at}: source throws but native accepted"));
                        }
                        compared += usize::from(step.actual.is_some());
                        continue;
                    }
                    result?;
                    if let Some(actual) = &step.actual {
                        let want = decode(&actual["diagnostic"], &format!("{at}.diagnostic"))?;
                        if let Some(d) = first_difference(
                            &vision.diagnostic(),
                            &want,
                            &format!("{at}.diagnostic"),
                        ) {
                            return Err(d);
                        }
                        compared += 1;
                    }
                }
                "canSee" => {
                    let points = decode(step.points.as_ref().ok_or(format!("{at}: points"))?, &at)?;
                    let MethodValue::Arr(points) = points else {
                        return Err(format!("{at}: points"));
                    };
                    let got: Vec<bool> = points
                        .iter()
                        .map(|p| point(p).map(|p| vision.can_see(p)))
                        .collect::<Result<_, _>>()?;
                    if let Some(actual) = &step.actual {
                        let want: Vec<bool> = serde_json::from_value(actual["results"].clone())
                            .map_err(|e| format!("{at}: {e}"))?;
                        if got != want {
                            return Err(format!("{at}: canSee {got:?} != {want:?}"));
                        }
                        compared += 1;
                    }
                }
                "filter" => {
                    let input = decode(step.input.as_ref().ok_or(format!("{at}: percept"))?, &at)?;
                    let percept = percept(&input).map_err(|e| format!("{at}: {e}"))?;
                    let result = vision.filter(&percept);
                    if declared_throw {
                        if result.is_ok() {
                            return Err(format!("{at}: source throws but native accepted"));
                        }
                        compared += usize::from(step.actual.is_some());
                        continue;
                    }
                    let out = result.map_err(|e| format!("{at}: refused {e:?}"))?;
                    if let Some(actual) = &step.actual {
                        for probe in actual["probes"].as_array().ok_or(format!("{at}: probes"))? {
                            let p = point(&decode(&probe["point"], &at)?)?;
                            if probe["seen"].as_bool() != Some(vision.can_see(p)) {
                                return Err(format!("{at}: probe {probe}"));
                            }
                        }
                        let want = decode(&actual["output"], &format!("{at}.output"))?;
                        if let Some(d) =
                            first_difference(&out.data(), &want, &format!("{at}.output"))
                        {
                            return Err(d);
                        }
                        compared += 1;
                    }
                }
                other => return Err(format!("{at}: op {other}")),
            }
        }
    }
    Ok(compared)
}
