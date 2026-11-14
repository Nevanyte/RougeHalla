use super::*;
use crate::mapgen::style_runtime::{self, Geometry, Inputs, Metadata, Runtime, State};
use serde_json::{json, Value};
use std::collections::BTreeSet;
fn fields(v: &Value, expected: &[&str]) {
    let got: BTreeSet<_> = v
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    let expected: BTreeSet<_> = expected.iter().copied().collect();
    assert_eq!(got, expected, "unknown/missing fields");
}
fn eq(a: &Value, b: &Value, label: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64(), "{label}"),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label} length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                eq(a, b, &format!("{label}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label} keys");
            for (k, a) in a {
                eq(
                    a,
                    b.get(k).unwrap_or_else(|| panic!("missing {label}.{k}")),
                    &format!("{label}.{k}"),
                );
            }
        }
        _ => assert_eq!(a, b, "{label}"),
    }
}
fn expanded(v: &Value, n: usize) -> Vec<i64> {
    let mut out = Vec::new();
    for pair in v.as_array().expect("RLE") {
        let p = pair.as_array().expect("run");
        assert_eq!(p.len(), 2);
        let val = p[0].as_i64().expect("integer");
        let count = usize::try_from(p[1].as_u64().expect("count")).unwrap();
        assert!(
            out.last().is_none_or(|&prior| prior != val),
            "noncanonical RLE"
        );
        assert!(count > 0 && count <= n - out.len());
        out.extend(std::iter::repeat_n(val, count));
    }
    assert_eq!(out.len(), n);
    out
}
fn bytes(v: &Value, n: usize) -> Vec<u8> {
    expanded(v, n)
        .into_iter()
        .map(|v| u8::try_from(v).unwrap())
        .collect()
}
fn ints(v: &Value, n: usize) -> Vec<i32> {
    expanded(v, n)
        .into_iter()
        .map(|v| i32::try_from(v).unwrap())
        .collect()
}

/// serde_json::Value ordinarily overwrites duplicate object keys. The oracle refuses them at every depth.
struct UniqueValue(Value);
impl<'de> serde::Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueValue;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON with unique object keys")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|v| UniqueValue(Value::Number(v)))
                    .ok_or_else(|| E::custom("nonfinite"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(json!(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = vec![];
                while let Some(v) = seq.next_element::<UniqueValue>()? {
                    values.push(v.0);
                }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((k, v)) = map.next_entry::<String, UniqueValue>()? {
                    if values.insert(k, v.0).is_some() {
                        return Err(serde::de::Error::custom("duplicate object key"));
                    }
                }
                Ok(UniqueValue(Value::Object(values)))
            }
        }
        d.deserialize_any(Visitor)
    }
}
const CASES: [&str; 6] = [
    "actual-1-0-true",
    "actual--1-0-false",
    "actual-17-1-true",
    "actual-4294967297-4294967296-false",
    "actual-2-0-true",
    "actual-29-2-true",
];
const UNITS: [&str; 15] = [
    "open-craters-and-river",
    "small-empty-no-draw",
    "no-depth-band-one-draw",
    "river-without-camps",
    "isolated-elite-crater",
    "frontier-crescents",
    "partial-footprint-guards",
    "all-placement-refused",
    "routes-cross-craters-and-river",
    "extra-stretch-breach",
    "ford-merge-boundary",
    "protected-river-window",
    "prop-protection",
    "prop-cap-repeated-callback",
    "forge-restamp-and-door-clearance",
];
fn fixture() -> Value {
    serde_json::from_str::<UniqueValue>(include_str!("../fixtures/style-scorch.json"))
        .unwrap()
        .0
}
fn inventory(f: &Value) {
    fields(
        f,
        &[
            "format",
            "node",
            "platform",
            "arch",
            "sourceSha256",
            "omittedTelemetry",
            "metadata",
            "cases",
            "units",
        ],
    );
    assert_eq!(f["format"], "rh-style-scorch/1");
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(f["omittedTelemetry"], json!(["StyleResult.ms"]));
    for (key, names) in [("cases", CASES.as_slice()), ("units", UNITS.as_slice())] {
        let rows = f[key].as_array().unwrap();
        assert_eq!(rows.len(), names.len());
        for (row, name) in rows.iter().zip(names) {
            assert_eq!(row["name"], *name);
        }
    }
    let hashes = f["sourceSha256"].as_object().unwrap();
    assert_eq!(
        hashes.keys().map(String::as_str).collect::<Vec<_>>(),
        SOURCES
    );
    assert_eq!(
        hashes["zoneStyle/scorch.ts"],
        "52b324dd4dfc9a77986a9ffdcb9704041a2d3608e6e61e9af98b0f697fd2f02a"
    );
    for value in hashes.values() {
        let s = value.as_str().unwrap();
        assert_eq!(s.len(), 64);
        assert!(s.bytes().all(|c| c.is_ascii_hexdigit()));
    }
    fields(&f["metadata"], &["tile", "terrain", "props"]);
    assert_eq!(f["metadata"]["tile"], 32);
    let catalog = crate::mapgen::terrain_gate::default_definition();
    assert_eq!(
        f["metadata"]["props"].as_array().unwrap().len(),
        catalog.props.len()
    );
    assert_eq!(
        f["metadata"]["terrain"].as_array().unwrap().len(),
        catalog.kinds.len()
    );
    for (p, v) in catalog
        .props
        .iter()
        .zip(f["metadata"]["props"].as_array().unwrap())
    {
        eq(
            &json!({"key":p.key,"on":p.on,"home":p.home}),
            v,
            "prop metadata",
        );
    }
    for (t, v) in catalog
        .kinds
        .iter()
        .zip(f["metadata"]["terrain"].as_array().unwrap())
    {
        let home = t.home.map(|h| match h {
            1 => "fire",
            2 => "sentenced",
            3 => "plague",
            4 => "frost",
            5 => "holy",
            _ => panic!("unknown faction code"),
        });
        eq(
            &json!({"key":t.key,"tile":t.tile,"home":home}),
            v,
            "terrain metadata",
        );
    }
    for p in f["metadata"]["props"].as_array().unwrap() {
        fields(p, &["key", "on", "home"]);
    }
    for t in f["metadata"]["terrain"].as_array().unwrap() {
        fields(t, &["key", "tile", "home"]);
    }
}
fn unpack(s: &Value, n: usize) -> Value {
    fields(
        s,
        &[
            "w",
            "h",
            "tiles",
            "terrain",
            "featureOwner",
            "wrote",
            "reserved",
            "scratch",
            "counters",
            "features",
            "props",
        ],
    );
    let mut out = s.clone();
    for key in ["tiles", "terrain", "featureOwner", "wrote", "reserved"] {
        out[key] = json!(expanded(&s[key], n));
    }
    fields(&s["scratch"], &["mark", "qa", "qb", "depth", "epoch"]);
    for key in ["mark", "qa", "qb", "depth"] {
        out["scratch"][key] = json!(expanded(&s["scratch"][key], n));
    }
    fields(
        &s["counters"],
        &[
            "walls",
            "lows",
            "refused",
            "joinUsed",
            "joinLeft",
            "surfaced",
            "propsAdded",
            "featuresAdded",
        ],
    );
    for f in s["features"].as_array().unwrap() {
        fields(
            f,
            &[
                "kind", "variant", "zone", "jobs", "ax", "ay", "p", "bbox", "tiles",
            ],
        );
        fields(&f["bbox"], &["x", "y", "w", "h"]);
    }
    for p in s["props"].as_array().unwrap() {
        fields(p, &["kind", "x", "y", "v"]);
    }
    out
}
fn snap(rt: &Runtime<'_>) -> Value {
    let mut v = serde_json::to_value(rt.state()).unwrap();
    v["reserved"] = json!(rt.reserved());
    v["counters"] = json!(rt.counters());
    v
}
fn callbacks<'a>(fixed: &'a FixedLayout, fixed_rules: &'a FixedDefinition<'a>) -> Callbacks<'a> {
    Callbacks::new(
        &default_definition(),
        &forge::default_definition(),
        &recipe_support::default_definition(),
        &kit::default_definition(),
        fixed,
        fixed_rules,
        &crate::mapgen::terrain_gate::default_definition(),
    )
    .unwrap()
}
fn camp_site(x: i32, y: i32, w: usize, h: usize) -> usize {
    let x = usize::try_from(x).unwrap();
    let y = usize::try_from(y).unwrap();
    assert!(x < w && y < h);
    y.checked_mul(w).unwrap().checked_add(x).unwrap()
}
fn replay(row: &Value, metadata: &Value, actual: bool) {
    replay_policy(row, metadata, actual, None);
}
fn replay_policy(
    row: &Value,
    metadata: &Value,
    actual: bool,
    policy: Option<(&Definition, bool, Option<f64>)>,
) {
    for stream in row["streams"].as_array().unwrap() {
        for key in ["stream", "seed", "noiseSeed"] {
            u32::try_from(stream[key].as_u64().unwrap()).unwrap();
        }
    }

    if actual {
        fields(
            row,
            &[
                "name",
                "seed",
                "attempt",
                "decor",
                "completeFinalOutputEquality",
                "finalHash",
                "init",
                "initial",
                "phases",
                "streams",
                "plan",
                "final",
            ],
        );
        assert_eq!(row["completeFinalOutputEquality"], true);
    } else {
        fields(
            row,
            &[
                "name",
                "propCalls",
                "init",
                "initial",
                "phases",
                "streams",
                "plan",
                "final",
            ],
        );
    }
    // Admit stream scalars before constructing/restoring or executing any native state.
    for stream in row["streams"].as_array().unwrap() {
        fields(
            stream,
            &["stream", "seed", "noiseSeed", "draws", "values", "next"],
        );
        for key in ["stream", "seed", "noiseSeed"] {
            u32::try_from(stream[key].as_u64().unwrap()).unwrap();
        }
        let draws = usize::try_from(stream["draws"].as_u64().unwrap()).unwrap();
        assert_eq!(draws, stream["values"].as_array().unwrap().len());
        assert_eq!(stream["next"].as_array().unwrap().len(), 4);
        for values in ["values", "next"] {
            for value in stream[values].as_array().unwrap() {
                assert!((0.0..1.0).contains(&value.as_f64().unwrap()));
            }
        }
    }
    let i = &row["init"];
    if actual {
        assert_eq!(row["seed"], i["seed"]);
        assert_eq!(row["attempt"], i["attempt"]);
        assert!(row["decor"].is_boolean());
        let hash = row["finalHash"].as_str().unwrap();
        assert_eq!(hash.len(), 8);
        assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
    } else {
        assert_eq!(
            row["propCalls"],
            if row["name"] == "prop-cap-repeated-callback" {
                8
            } else {
                1
            }
        );
    }

    fields(
        i,
        &[
            "w",
            "h",
            "seed",
            "attempt",
            "info",
            "mask",
            "hard",
            "noBlock",
            "noProp",
            "edgeDist",
            "territory",
            "camps",
            "spawns",
            "centreWalk",
            "caps",
        ],
    );
    let (w, h) = (
        usize::try_from(i["w"].as_u64().unwrap()).unwrap(),
        usize::try_from(i["h"].as_u64().unwrap()).unwrap(),
    );
    let n = w.checked_mul(h).unwrap();
    assert!(w > 0 && h > 0 && n <= 2_097_152);
    let initial = unpack(&row["initial"], n);
    let mut state = State::new(
        w,
        h,
        serde_json::from_value(initial["tiles"].clone()).unwrap(),
        serde_json::from_value(initial["terrain"].clone()).unwrap(),
        serde_json::from_value(initial["props"].clone()).unwrap(),
        serde_json::from_value(initial["features"].clone()).unwrap(),
        serde_json::from_value(initial["featureOwner"].clone()).unwrap(),
    )
    .unwrap();
    let sc = &initial["scratch"];
    style_runtime::restore_fixture_prefix(
        &mut state,
        style_runtime::FixturePrefix {
            wrote: serde_json::from_value(initial["wrote"].clone()).unwrap(),
            mark: serde_json::from_value(sc["mark"].clone()).unwrap(),
            qa: serde_json::from_value(sc["qa"].clone()).unwrap(),
            qb: serde_json::from_value(sc["qb"].clone()).unwrap(),
            depth: serde_json::from_value(sc["depth"].clone()).unwrap(),
            epoch: sc["epoch"].as_i64().unwrap(),
        },
    )
    .unwrap();
    let info: crate::mapgen::landmarks::runtime::ZoneInfo =
        serde_json::from_value(i["info"].clone()).unwrap();
    fields(
        &i["info"],
        &[
            "index", "faction", "painted", "floor", "bbox", "pole", "centroid", "axis",
        ],
    );
    for k in ["pole", "centroid", "axis"] {
        fields(&i["info"][k], &["x", "y"]);
    }
    fields(&i["info"]["bbox"], &["x", "y", "w", "h"]);
    let mask = bytes(&i["mask"], n);
    let zones: Vec<_> = mask
        .iter()
        .map(|&m| if m == 1 { info.index } else { 0 })
        .collect();
    let camps: Vec<crate::mapgen::landmarks::runtime::CampInfo> =
        serde_json::from_value(i["camps"].clone()).unwrap();
    for c in i["camps"].as_array().unwrap() {
        fields(c, &["x", "y", "r", "territory", "elite", "index"]);
    }
    let camps: Vec<_> = camps
        .iter()
        .map(|c| crate::mapgen::attempt::StyleCamp {
            site: camp_site(c.x, c.y, w, h),
            r: c.r,
            territory: c.territory,
            elite: c.elite,
        })
        .collect();
    let geometry = Geometry::new(
        info.index,
        info.faction,
        &zones,
        state.tiles(),
        w,
        h,
        &camps,
    )
    .unwrap();
    eq(&json!(geometry.info), &i["info"], "geometry");
    let scoped_camps: Vec<_> = i["camps"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .filter_map(|(index, c)| {
            assert_eq!(c["index"], index);
            (mask[camp_site(
                i32::try_from(c["x"].as_i64().unwrap()).unwrap(),
                i32::try_from(c["y"].as_i64().unwrap()).unwrap(),
                w,
                h,
            )] == 1)
                .then_some(c)
        })
        .collect();
    eq(
        &json!(geometry.camps),
        &json!(scoped_camps),
        "camp geometry",
    );
    eq(
        &json!(geometry.edge_dist),
        &json!(ints(&i["edgeDist"], n)),
        "edge",
    );
    let hard = bytes(&i["hard"], n);
    let nb = bytes(&i["noBlock"], n);
    let np = bytes(&i["noProp"], n);
    let territory = (!i["territory"].is_null()).then(|| bytes(&i["territory"], n));
    let walk = (!i["centreWalk"].is_null()).then(|| ints(&i["centreWalk"], n));
    let spawns: Vec<i32> = serde_json::from_value(i["spawns"].clone()).unwrap();
    fields(
        &i["caps"],
        &["joinChecks", "footprintPct", "rimTiles", "fenceDetour"],
    );
    let mut rules = style_runtime::default_definition();
    rules.join_checks = u32::try_from(i["caps"]["joinChecks"].as_u64().unwrap()).unwrap();
    rules.footprint_percent = i["caps"]["footprintPct"].as_f64().unwrap();
    rules.rim_tiles = i["caps"]["rimTiles"].as_f64().unwrap();
    rules.fence_detour = u16::try_from(i["caps"]["fenceDetour"].as_u64().unwrap()).unwrap();
    let catalog = crate::mapgen::terrain_gate::default_definition();
    for (prop, expected) in catalog
        .props
        .iter()
        .zip(metadata["props"].as_array().unwrap())
    {
        assert_eq!(prop.key, expected["key"].as_str().unwrap());
        assert_eq!(json!(prop.home), expected["home"]);
        assert_eq!(json!(prop.on), expected["on"]);
    }
    let mut rt = Runtime::new(
        &mut state,
        Inputs {
            landmark: None,
            geometry: &geometry,
            hard: &hard,
            no_block: &nb,
            no_prop: &np,
            territory: territory.as_deref(),
            spawns: &spawns,
            centre_walk: walk.as_deref(),
            seed: i["seed"].as_i64().unwrap(),
            attempt: i["attempt"].as_u64().unwrap(),
        },
        Metadata {
            terrain: catalog.kinds,
            props: catalog.props,
            tile_size: 32.0,
        },
        &rules,
    )
    .unwrap();
    eq(&snap(&rt), &initial, "initial complete runtime");
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let fixed_rules = crate::mapgen::coliseum::default_definition();
    if let Some((d, refused, radius4)) = policy {
        let before = snap(&rt);
        let mut forge = forge::default_definition();
        if let Some(r) = radius4 {
            forge.radius_min4 = r;
            forge.radius_max4 = r;
            forge.radius_elite_max4 = r;
        }
        let cb = Callbacks::new(
            d,
            &forge,
            &recipe_support::default_definition(),
            &kit::default_definition(),
            &fixed,
            &fixed_rules,
            &catalog,
        );
        if refused {
            assert!(matches!(cb, Err(Error::Definition)));
            eq(&snap(&rt), &before, "custom policy refused before writes");
        } else {
            let cb = cb.unwrap();
            let plan = cb.shape(&mut rt.shape_context()).unwrap();
            cb.surface(&mut rt.surface_context(), &plan).unwrap();
            cb.props(&mut rt.prop_context(), &plan).unwrap();
            assert_ne!(
                snap(&rt),
                before,
                "admitted boundary must execute real work"
            );
            assert!(plan.river_path.iter().all(|&i| i >= 0 && (i as usize) < n));
            assert!(plan
                .craters
                .iter()
                .flat_map(|c| &c.rim)
                .all(|&i| i >= 0 && (i as usize) < n));
        }
        return;
    }
    let cb = callbacks(&fixed, &fixed_rules);
    let phases = row["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 2);
    let mut streams = vec![];
    let before = style_runtime::floor_components(rt.state().tiles(), w, h)
        .unwrap()
        .1
        .len();
    let plan = {
        let mut c = rt.shape_context();
        let p = cb.shape(&mut c).unwrap();
        streams.push(c.streams);
        p
    };
    if actual {
        rt.finish_shape(before);
    }
    for (index, label) in ["shape", "surface"].iter().enumerate() {
        if index == 1 {
            let mut c = rt.surface_context();
            cb.surface(&mut c, &plan).unwrap();
            streams.push(c.streams);
        }
        fields(&phases[index], &["phase", "plan", "state"]);
        assert_eq!(phases[index]["phase"], *label);
        eq(&json!(plan), &phases[index]["plan"], "phase plan");
        eq(&snap(&rt), &unpack(&phases[index]["state"], n), label);
    }
    if !actual || row["decor"] == true {
        let mut c = rt.prop_context();
        for _ in 0..if actual {
            1
        } else {
            row["propCalls"].as_u64().unwrap()
        } {
            cb.props(&mut c, &plan).unwrap();
        }
        streams.push(c.streams);
    }
    eq(&json!(plan), &row["plan"], "final plan");
    eq(
        &snap(&rt),
        &unpack(&row["final"], n),
        "final complete runtime",
    );
    let expected = row["streams"].as_array().unwrap();
    assert_eq!(expected.len(), streams.len());
    for (index, (mut stream, e)) in streams.into_iter().zip(expected).enumerate() {
        fields(
            e,
            &["stream", "seed", "noiseSeed", "draws", "values", "next"],
        );
        assert_eq!(e["stream"], [0, 2, 1][index]);
        assert_eq!(
            e["draws"].as_u64().unwrap(),
            e["values"].as_array().unwrap().len() as u64
        );
        assert_eq!(e["noiseSeed"], stream.noise.stream_seed);
        let mut source =
            crate::rng::Mulberry32::new(u32::try_from(e["seed"].as_u64().unwrap()).unwrap());
        for v in e["values"].as_array().unwrap() {
            assert_eq!(source.next_f64(), v.as_f64().unwrap());
        }
        let next: Vec<_> = (0..4).map(|_| stream.rng.next_f64()).collect();
        eq(&json!(next), &e["next"], "stream continuation");
        assert_eq!(next, (0..4).map(|_| source.next_f64()).collect::<Vec<_>>());
    }
    // Reject malformed continuation plans atomically, including every list and the empty-plan carrier.
    let before = snap(&rt);
    for which in 0..6 {
        let mut corrupt = plan.clone();
        match which {
            0 => corrupt.river_path.push(i32::try_from(n).unwrap()),
            1 => corrupt.fords.push(-1),
            2 => corrupt.lava.push(i32::try_from(n).unwrap()),
            3 => corrupt.no_ember.push(-1),
            4 => corrupt.craters.push(Crater {
                camp: usize::MAX,
                x: -1,
                y: -1,
                r4: -1,
                dirs: vec![16],
                rim: vec![-1],
            }),
            _ => corrupt.loops = usize::MAX,
        }
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &corrupt),
            Err(Error::Feature)
        );
        assert_eq!(
            cb.props(&mut rt.prop_context(), &corrupt),
            Err(Error::Feature)
        );
        eq(&snap(&rt), &before, "malformed no-write");
    }
}
#[test]
fn captured_callbacks_match_complete_plans_states_and_streams() {
    let f = fixture();
    inventory(&f);
    for (key, actual) in [("cases", true), ("units", false)] {
        for row in f[key].as_array().unwrap() {
            eprintln!("{}", row["name"]);
            replay(row, &f["metadata"], actual);
        }
    }
}
#[test]
fn fixture_inventory_rejects_unknown_empty_missing_and_duplicate() {
    assert!(serde_json::from_str::<UniqueValue>(r#"{"x":1,"x":2}"#).is_err());
    assert!(serde_json::from_str::<UniqueValue>(r#"{"nested":{"x":1,"x":2}}"#).is_err());
    let original = fixture();
    for change in 0..4 {
        let mut f = original.clone();
        match change {
            0 => f["cases"] = json!([]),
            1 => f["units"]
                .as_array_mut()
                .unwrap()
                .pop()
                .map(|_| ())
                .unwrap(),
            2 => {
                f["unknown"] = json!(1);
            }
            _ => f["units"][1] = f["units"][0].clone(),
        };
        assert!(std::panic::catch_unwind(|| inventory(&f)).is_err());
    }
}
#[test]
fn definitions_and_plans_refuse_malformed_values() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let fixed_rules = crate::mapgen::coliseum::default_definition();
    let forge = forge::default_definition();
    let scale = recipe_support::default_definition();
    let kit = kit::default_definition();
    let catalog = crate::mapgen::terrain_gate::default_definition();
    for value in [f64::NAN, f64::INFINITY, -1.0, 1.01] {
        let mut d = default_definition();
        d.decor.ember_chance = value;
        assert!(Callbacks::new(&d, &forge, &scale, &kit, &fixed, &fixed_rules, &catalog).is_err());
    }
    assert!(Callbacks::new(
        &default_definition(),
        &forge,
        &scale,
        &kit,
        &fixed,
        &fixed_rules,
        &crate::mapgen::terrain_gate::TerrainGateDefinition {
            props: &[],
            ..catalog
        }
    )
    .is_err());
    assert!(serde_json::from_value::<Plan>(json!({"unknown":1})).is_err());
}
const SOURCES: [&str; 75] = [
    "abilities.ts",
    "achievements.ts",
    "blink.ts",
    "bushes.ts",
    "cards.ts",
    "championPassives.ts",
    "chestBoosts.ts",
    "coliseum.ts",
    "combatReadability.ts",
    "constants.ts",
    "consumables.ts",
    "cosmetics.ts",
    "detMath.ts",
    "effectText.ts",
    "effects.ts",
    "factions.ts",
    "fireRoam.ts",
    "fxCodec.ts",
    "geometry.ts",
    "glossary.ts",
    "gridOps.ts",
    "gridTopology.ts",
    "hpView.ts",
    "index.ts",
    "interactions.ts",
    "interp.ts",
    "killAugments.ts",
    "map.ts",
    "mapWire.ts",
    "mapgen.ts",
    "mark.ts",
    "messages.ts",
    "mobStats.ts",
    "mobs.ts",
    "mods.ts",
    "pathfind.ts",
    "plagueCorpses.ts",
    "planning.ts",
    "policies.ts",
    "propKinds.ts",
    "quests.ts",
    "rewards.ts",
    "rng.ts",
    "rosters.ts",
    "rules.ts",
    "schema.ts",
    "sentencedHunt.ts",
    "signatureShares.ts",
    "signatures.ts",
    "status.ts",
    "styler.ts",
    "telemetry.ts",
    "terrain.ts",
    "traders.ts",
    "training.ts",
    "vision.ts",
    "walk.ts",
    "weapons.ts",
    "wheel.ts",
    "zoneStyle/context.ts",
    "zoneStyle/features.ts",
    "zoneStyle/gallows.ts",
    "zoneStyle/hook.ts",
    "zoneStyle/index.ts",
    "zoneStyle/kit.ts",
    "zoneStyle/landmarks.ts",
    "zoneStyle/propKinds.ts",
    "zoneStyle/rime.ts",
    "zoneStyle/sanctum.ts",
    "zoneStyle/scale.ts",
    "zoneStyle/scorch.ts",
    "zoneStyle/styleZones.ts",
    "zoneStyle/types.ts",
    "zoneStyle/warren.ts",
    "zones.ts",
];

#[test]
fn every_callback_rule_word_reaches_content_identity() {
    fn paths(v: &Value, path: Vec<String>, out: &mut Vec<Vec<String>>) {
        match v {
            Value::Object(o) => {
                for (k, v) in o {
                    let mut p = path.clone();
                    p.push(k.clone());
                    paths(v, p, out);
                }
            }
            Value::Array(a) => {
                for (i, v) in a.iter().enumerate() {
                    let mut p = path.clone();
                    p.push(i.to_string());
                    paths(v, p, out);
                }
            }
            Value::Number(_) => out.push(path),
            _ => panic!("non-numeric policy"),
        }
    }
    fn leaf<'a>(v: &'a mut Value, p: &[String]) -> &'a mut Value {
        if p.is_empty() {
            return v;
        }
        if v.is_array() {
            leaf(&mut v[p[0].parse::<usize>().unwrap()], &p[1..])
        } else {
            leaf(&mut v[&p[0]], &p[1..])
        }
    }
    let d = default_definition();
    let mut words = vec![];
    visit_content(&d, |w| words.push(w));
    let value = json!(d);
    let mut all = vec![];
    paths(&value, vec![], &mut all);
    assert_eq!(words.len(), all.len());
    for path in all {
        let mut changed = value.clone();
        let v = leaf(&mut changed, &path);
        *v = if let Some(i) = v.as_i64() {
            json!(i + 1)
        } else {
            json!(v.as_f64().unwrap() + 0.001)
        };
        let d: Definition = serde_json::from_value(changed).unwrap();
        let mut other = vec![];
        visit_content(&d, |w| other.push(w));
        assert_eq!(other.len(), words.len());
        assert_eq!(
            other.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "policy {:?}",
            path
        );
    }
}

#[test]
fn overflowing_fixture_scalars_are_rejected() {
    let f = fixture();
    let original = &f["cases"][0];
    for which in 0..6 {
        let mut row = original.clone();
        match which {
            0 => row["init"]["caps"]["joinChecks"] = json!(512_u64 + (1_u64 << 32)),
            1 => row["init"]["caps"]["fenceDetour"] = json!(10_u64 + (1_u64 << 16)),
            2 => {
                row["streams"][0]["seed"] =
                    json!(row["streams"][0]["seed"].as_u64().unwrap() + (1_u64 << 32))
            }
            3 => row["init"]["w"] = json!(u64::MAX),
            4 => row["init"]["camps"][0]["x"] = json!(-1),
            _ => row["init"]["camps"][0]["y"] = json!(i32::MAX),
        }
        assert!(
            std::panic::catch_unwind(|| replay(&row, &f["metadata"], true)).is_err(),
            "overflow case {which}"
        );
    }
}

#[test]
fn malformed_source_prefix_is_refused_without_writes() {
    let n = 16;
    let mut state = State::new(
        4,
        4,
        vec![TILE_FLOOR; n],
        vec![0; n],
        vec![],
        vec![],
        vec![0; n],
    )
    .unwrap();
    // Keep every restored buffer distinct from the refused candidates, detecting partial early writes.
    style_runtime::restore_fixture_prefix(
        &mut state,
        style_runtime::FixturePrefix {
            wrote: vec![1; n],
            mark: vec![2; n],
            qa: vec![3; n],
            qb: vec![4; n],
            depth: vec![5; n],
            epoch: 7,
        },
    )
    .unwrap();
    let before = state.clone();
    for which in 0..14 {
        let mut prefix = style_runtime::FixturePrefix {
            wrote: vec![0; n],
            mark: vec![0; n],
            qa: vec![0; n],
            qb: vec![0; n],
            depth: vec![0; n],
            epoch: 0,
        };
        match which {
            0 => {
                prefix.wrote.pop();
            }
            1 => {
                prefix.mark.pop();
            }
            2 => {
                prefix.qa.pop();
            }
            3 => {
                prefix.qb.pop();
            }
            4 => {
                prefix.depth.pop();
            }
            5 => prefix.wrote[0] = 3,
            6 => prefix.mark[0] = 1,
            7 => prefix.mark[0] = -1,
            8 => prefix.qa[0] = -1,
            9 => prefix.qa[0] = i32::try_from(n).unwrap(),
            10 => prefix.qb[0] = -1,
            11 => prefix.qb[0] = i32::try_from(n).unwrap(),
            12 => prefix.epoch = -1,
            _ => prefix.epoch = i64::from(i32::MAX) + 1,
        }
        assert_eq!(
            style_runtime::restore_fixture_prefix(&mut state, prefix),
            Err(Error::Layer)
        );
        assert_eq!(state, before, "prefix refusal {which} wrote state");
    }
}

#[test]
fn malformed_forge_boxes_refuse_both_callbacks_before_writes() {
    let fixture = fixture();
    let row = fixture["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == "forge-restamp-and-door-clearance")
        .unwrap();
    let original: crate::mapdata::MapFeature =
        serde_json::from_value(row["initial"]["features"].as_array().unwrap()[0].clone()).unwrap();
    let (w, h) = (25, 25);
    let n = w * h;
    let empty = vec![0; n];
    let catalog = crate::mapgen::terrain_gate::default_definition();
    let runtime_rules = style_runtime::default_definition();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let fixed_rules = crate::mapgen::coliseum::default_definition();
    let cb = callbacks(&fixed, &fixed_rules);
    for which in 0..4 {
        let mut feature = original.clone();
        feature.bbox.x = 5;
        feature.bbox.y = 5;
        feature.bbox.w = 5;
        feature.bbox.h = 5;
        match which {
            0 => feature.bbox.x = -1,
            1 => feature.bbox.y = -1,
            2 => feature.bbox.w = u32::MAX,
            _ => feature.bbox.h = u32::MAX,
        }
        let mut state = State::new(
            w,
            h,
            vec![TILE_FLOOR; n],
            empty.clone(),
            vec![],
            vec![feature],
            vec![0; n],
        )
        .unwrap();
        let geometry = Geometry::new(
            1,
            crate::mapdata::Zone::Fire,
            &vec![1; n],
            state.tiles(),
            w,
            h,
            &[],
        )
        .unwrap();
        let mut rt = Runtime::new(
            &mut state,
            Inputs {
                landmark: None,
                geometry: &geometry,
                hard: &empty,
                no_block: &empty,
                no_prop: &empty,
                territory: None,
                spawns: &[],
                centre_walk: None,
                seed: 1,
                attempt: 0,
            },
            Metadata {
                terrain: catalog.kinds,
                props: catalog.props,
                tile_size: 32.0,
            },
            &runtime_rules,
        )
        .unwrap();
        let before = snap(&rt);
        let plan = Plan {
            lava: vec![312],
            ..Plan::default()
        };
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &plan),
            Err(Error::Feature)
        );
        assert_eq!(cb.props(&mut rt.prop_context(), &plan), Err(Error::Feature));
        eq(&snap(&rt), &before, "malformed Forge box no-write");
    }
}

#[test]
fn custom_policy_geometry_bounds_refuse_before_writes_and_execute_at_boundaries() {
    let f = fixture();
    let row = &f["cases"][0];
    for strength in [f64::NAN, f64::INFINITY, -0.000001, 16.000001, 100000.0] {
        let mut d = default_definition();
        d.crater.jitter_strength = strength;
        replay_policy(row, &f["metadata"], true, Some((&d, true, None)));
    }
    for strength in [0.0, 16.0] {
        let mut d = default_definition();
        d.crater.jitter_strength = strength;
        replay_policy(row, &f["metadata"], true, Some((&d, false, None)));
    }
    // Radius 2 quarter-cells puts the zero-length vector on the ideal ring;
    // reject it before the radial normalization divides by its distance.
    let mut d = default_definition();
    replay_policy(row, &f["metadata"], true, Some((&d, true, Some(2.0))));
    replay_policy(row, &f["metadata"], true, Some((&d, false, Some(3.0))));
    d.crater.jitter_strength = 16.0;
    replay_policy(row, &f["metadata"], true, Some((&d, false, Some(64.0))));
    // The reviewer's admitted empty-window reproducer. Only the lower window bound
    // changes between refusal and the successful boundary run against genuine input.
    let mut d = default_definition();
    d.river.min_steps = 2;
    d.river.target_extra = 0;
    d.river.steps_per_len = 0.0;
    d.river.length_min = 0;
    d.river.length_offsets = [-2; 3];
    d.river.blocks_min = 0;
    d.river.placement_tries = 10000;
    d.river.window_distinct = 0;
    d.river.window_step = 1;
    replay_policy(row, &f["metadata"], true, Some((&d, true, None)));
    d.river.length_min = 1;
    replay_policy(row, &f["metadata"], true, Some((&d, false, None)));

    // Exhaust the admitted gap-fill envelope against the source Number arithmetic,
    // including both signs. No intermediate product exceeds the documented bound.
    for dx in -64_i32..=64 {
        for dy in -64_i32..=64 {
            let n = dx.abs().max(dy.abs());
            for step in 1..n {
                for delta in [dx, dy] {
                    let numerator = 2 * delta * step + n;
                    assert!(numerator.abs() <= 8256);
                    let native = (f64::from(numerator) / f64::from(2 * n)).floor();
                    let source = ((2.0 * f64::from(delta) * f64::from(step) + f64::from(n))
                        / (2.0 * f64::from(n)))
                    .floor();
                    assert_eq!(native, source);
                }
            }
        }
    }
}
