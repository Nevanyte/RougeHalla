//! The fair-view foundation against the actual-source corpus parity/policy/bot-perception.json, captured from the
//! unmodified legacy brain in the pinned linux/amd64 Node 22.23.4 container (tools/perception-fixtures/). The corpus is
//! immutable source output: this test replays every declared feature probe, window, field and message-copy through the Rust
//! port and requires the same answers, and kills mutants of the expected outputs.
use crate::bots::view::{
    detect_features, field_in_view, in_view, plain_copy, FeatureProbe, Features, FieldInView,
    MessageData, CLIENT_MESSAGE_TYPES,
};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-perception.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured perception corpus parses")
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}
fn text(v: &Value) -> &str {
    v.as_str().expect("a string")
}

fn to_data(v: &Value) -> MessageData {
    match v {
        Value::Null => MessageData::Null,
        Value::Bool(b) => MessageData::Bool(*b),
        Value::Number(n) => MessageData::Num(n.as_f64().expect("a number")),
        Value::String(s) => MessageData::Str(s.clone()),
        Value::Array(items) => MessageData::Arr(items.iter().map(to_data).collect()),
        Value::Object(map) => {
            MessageData::Obj(map.iter().map(|(k, v)| (k.clone(), to_data(v))).collect())
        }
    }
}
fn to_value(d: &MessageData) -> Value {
    match d {
        MessageData::Null => Value::Null,
        MessageData::Bool(b) => Value::Bool(*b),
        MessageData::Num(n) => {
            Value::Number(serde_json::Number::from_f64(*n).expect("a finite number"))
        }
        MessageData::Str(s) => Value::String(s.clone()),
        MessageData::Arr(items) => Value::Array(items.iter().map(to_value).collect()),
        MessageData::Obj(members) => {
            let mut map = serde_json::Map::new();
            for (k, v) in members {
                map.insert(k.clone(), to_value(v));
            }
            Value::Object(map)
        }
    }
}
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Number(x), Value::Number(y)) => {
            (x.as_f64().expect("number") - y.as_f64().expect("number")).abs() <= f64::EPSILON
        }
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same_json(a, b))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => false,
    }
}
fn probe_of(spec: &Value) -> FeatureProbe {
    FeatureProbe {
        state: to_data(&spec["state"]),
        player: spec.get("player").map(to_data),
        map_terrain: spec["mapTerrain"]
            .as_array()
            .map(|a| a.iter().map(|v| v.as_u64().expect("tile") as u8).collect()),
        map_hazards: spec["mapHazards"].as_bool().unwrap_or(false),
        message_types: spec["messageTypes"]
            .as_array()
            .map(|a| a.iter().map(|v| text(v).to_string()).collect()),
    }
}
fn features_of(v: &Value) -> Features {
    let types = v["messageTypes"]
        .as_array()
        .expect("message_types")
        .iter()
        .map(|t| text(t).to_string())
        .collect();
    Features {
        message_types: types,
        wishes: v["wishes"].as_bool().expect("wishes"),
        status_effects: v["statusEffects"].as_bool().expect("statusEffects"),
        fields: v["fields"].as_bool().expect("fields"),
        planning: v["planning"].as_bool().expect("planning"),
        chests: v["chests"].as_bool().expect("chests"),
        skills: v["skills"].as_bool().expect("skills"),
        relics: v["relics"].as_bool().expect("relics"),
        camps: v["camps"].as_bool().expect("camps"),
        hazards: v["hazards"].as_bool().expect("hazards"),
    }
}

fn check_features(f: &Value) -> Result<(), String> {
    for row in f["features"].as_array().expect("features") {
        let spec = &row["spec"];
        let got = detect_features(&probe_of(spec));
        let want = features_of(&row["result"]);
        if got != want {
            return Err(format!(
                "feature probe {}: native {got:?} source {want:?}",
                row["name"]
            ));
        }
    }
    if CLIENT_MESSAGE_TYPES.len()
        != f["profile"]["clientMessageTypes"]
            .as_array()
            .expect("types")
            .len()
    {
        return Err("the client message set length differs".into());
    }
    for (i, t) in CLIENT_MESSAGE_TYPES.iter().enumerate() {
        if *t != text(&f["profile"]["clientMessageTypes"][i]) {
            return Err("the client message set differs".into());
        }
    }
    Ok(())
}
fn check_windows(f: &Value) -> Result<(), String> {
    for row in f["windows"].as_array().expect("windows") {
        let got = in_view(
            num(&row["cx"]),
            num(&row["cy"]),
            num(&row["x"]),
            num(&row["y"]),
            num(&row["pad"]),
        );
        if got != row["result"].as_bool().expect("result") {
            return Err(format!("inView row {row}"));
        }
    }
    Ok(())
}
fn check_fields(f: &Value) -> Result<(), String> {
    for row in f["fields"].as_array().expect("fields") {
        let field = &row["field"];
        let f = FieldInView {
            kind: text(&field["kind"]).to_string(),
            x: num(&field["x"]),
            y: num(&field["y"]),
            x2: num(&field["x2"]),
            y2: num(&field["y2"]),
            r: num(&field["r"]),
        };
        let got = field_in_view(num(&row["cx"]), num(&row["cy"]), &f, num(&row["pad"]));
        if got != row["result"].as_bool().expect("result") {
            return Err(format!("fieldInView row {row}"));
        }
    }
    Ok(())
}
fn check_plain(f: &Value) -> Result<(), String> {
    for row in f["plain"].as_array().expect("plain") {
        let input = to_data(&row["input"]);
        let got = plain_copy(&input)
            .map(|d| to_value(&d))
            .unwrap_or(Value::Null);
        if !same_json(&got, &row["result"]) {
            return Err(format!("plainCopy row {}: native {got}", row["input"]));
        }
    }
    Ok(())
}

#[test]
fn captured_feature_detection_reproduces() {
    let f = fixture();
    check_features(&f).expect("feature detection matches the source capture");
}

#[test]
fn captured_window_helpers_reproduce() {
    let f = fixture();
    check_windows(&f).expect("inView matches the source capture");
    check_fields(&f).expect("fieldInView matches the source capture");
}

#[test]
fn captured_message_copy_reproduces() {
    let f = fixture();
    check_plain(&f).expect("plainCopy matches the source capture");
}

#[test]
fn mutants_of_the_perception_corpus_cannot_false_match() {
    let f = fixture();
    // A flipped feature flag.
    let mut bad = f.clone();
    let i = bad["features"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["name"] == "full")
        .unwrap();
    bad["features"][i]["result"]["hazards"] = Value::from(false);
    assert!(
        check_features(&bad).is_err(),
        "a flipped feature flag must fail"
    );
    // A nudged window boundary.
    let mut bad = f.clone();
    let i = bad["windows"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["result"] == false)
        .unwrap();
    bad["windows"][i]["result"] = Value::from(true);
    assert!(
        check_windows(&bad).is_err(),
        "a flipped window answer must fail"
    );
    // A field that slides into the window once its radius grows.
    let mut bad = f.clone();
    let i = bad["fields"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["result"] == false)
        .unwrap();
    bad["fields"][i]["field"]["r"] = Value::from(10000.0);
    assert!(check_fields(&bad).is_err(), "a field radius must matter");
    // A plain copy that keeps a depth beyond the source's limit.
    let mut bad = f.clone();
    let i = bad["plain"]
        .as_array()
        .unwrap()
        .iter()
        .position(|r| r["input"].is_object())
        .unwrap();
    bad["plain"][i]["result"]["injected"] = Value::from(1);
    assert!(check_plain(&bad).is_err(), "an extra copied key must fail");
}
