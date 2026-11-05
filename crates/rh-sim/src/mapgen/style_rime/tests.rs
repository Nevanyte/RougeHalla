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
const UNITS: [&str; 14] = [
    "open-two-lakes",
    "empty-small-zone",
    "single-small-lake",
    "wide-two-lakes",
    "vertical-two-basins",
    "protected-clearance-and-ice",
    "shelves-refused-footprint",
    "shelves-guard-budget-zero",
    "all-props-excluded",
    "props-cap-repeated",
    "source-stamped-watchtower",
    "fixed-grid-ring-clearance",
    "route-corridor-clearance",
    "surface-ring-distance-boundaries",
];
fn fixture() -> Value {
    serde_json::from_str::<UniqueValue>(include_str!("../fixtures/style-rime.json"))
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
            "facets",
        ],
    );
    assert_eq!(f["format"], "rh-style-rime/1");
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
    let facets = f["facets"].as_array().unwrap();
    assert_eq!(facets.len(), 20);
    let mut keys = BTreeSet::new();
    for c in facets {
        fields(c, &["seed", "radius", "cells", "draws", "next"]);
        assert!(keys.insert(json!([c["seed"], c["radius"]]).to_string()));
    }
    let expected: BTreeSet<_> = [0_u64, 1, 2147483648, 4294967295]
        .into_iter()
        .flat_map(|seed| {
            [1.6, 1.9, 2.2, 2.6, 3.2]
                .into_iter()
                .map(move |radius| json!([seed, radius]).to_string())
        })
        .collect();
    assert_eq!(keys, expected, "facet exact input inventory");
    let hashes = f["sourceSha256"].as_object().unwrap();
    assert_eq!(
        hashes.keys().map(String::as_str).collect::<Vec<_>>(),
        SOURCES
    );
    assert_eq!(
        hashes["zoneStyle/rime.ts"],
        "d25714c3b647392a03662b33082b48de2c7ec2933755501fe55260c2a1daa19a"
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
fn callbacks(fixed: &FixedLayout) -> Callbacks<'_> {
    let catalog = crate::mapgen::terrain_gate::default_definition();
    Callbacks::new(
        &default_definition(),
        &rime::default_definition(),
        fixed,
        &crate::mapgen::coliseum::default_definition(),
        catalog.props,
        catalog.kinds,
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
                "surfaceInputPlan",
                "init",
                "initial",
                "phases",
                "streams",
                "plan",
                "final",
            ],
        );
    }
    let captured_surface_input: Option<Plan> =
        serde_json::from_value(row["surfaceInputPlan"].clone()).unwrap();
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
            if row["name"] == "props-cap-repeated" {
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
    let cb = callbacks(&fixed);
    let phases = row["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 2);
    let mut streams = vec![];
    let before = style_runtime::floor_components(rt.state().tiles(), w, h)
        .unwrap()
        .1
        .len();
    let mut plan = {
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
            if !actual && row["name"] == "surface-ring-distance-boundaries" {
                let mut explicit_input = plan.clone();
                let mut cells: Vec<i32> = [4, 5, 6, 255]
                    .into_iter()
                    .map(|d| {
                        i32::try_from(
                            fixed
                                .dist_fp
                                .iter()
                                .enumerate()
                                .position(|(k, &v)| {
                                    v == d && mask[k] == 1 && rt.state().tiles()[k] == 0
                                })
                                .unwrap(),
                        )
                        .unwrap()
                    })
                    .collect();
                cells.sort_unstable();
                explicit_input.lakes[0].tiles = cells;
                explicit_input.lakes[0].ice = 0;
                let captured_input = captured_surface_input.clone().unwrap();
                eq(
                    &json!(explicit_input),
                    &json!(captured_input),
                    "labelled surface input",
                );
                plan = captured_input;
            } else if !actual {
                assert!(row["surfaceInputPlan"].is_null());
            }
            let mut c = rt.surface_context();
            cb.surface(&mut c, &mut plan).unwrap();
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
        fields(e, &["stream", "seed", "noiseSeed", "draws", "next"]);
        assert_eq!(e["stream"], [0, 2, 1][index]);
        let draws = e["draws"].as_u64().unwrap();
        assert!(draws <= 100000);
        assert_eq!(e["noiseSeed"], stream.noise.stream_seed);
        let mut source =
            crate::rng::Mulberry32::new(u32::try_from(e["seed"].as_u64().unwrap()).unwrap());
        for _ in 0..draws {
            source.next_f64();
        }
        let next: Vec<_> = (0..4).map(|_| stream.rng.next_f64()).collect();
        eq(&json!(next), &e["next"], "stream continuation");
        assert_eq!(next, (0..4).map(|_| source.next_f64()).collect::<Vec<_>>());
    }
    // Invalid continuation carriers must refuse before touching phase state.
    let before = snap(&rt);
    for which in 0..13 {
        let mut bad = plan.clone();
        match which {
            0 => bad.causeway.push(i32::try_from(n).unwrap()),
            1 => bad.routed = spawns.len() + 1,
            2..=7 => {
                let Some(l) = bad.lakes.first_mut() else {
                    continue;
                };
                match which {
                    2 => l.seed = -1,
                    3 => l.index = usize::MAX,
                    4 => l.grown = n + 1,
                    5 => l.ice = l.tiles.len() + 1,
                    6 => l.tiles.push(i32::try_from(n).unwrap()),
                    _ => {
                        if let Some(&i) = l.tiles.first() {
                            l.tiles.insert(0, i);
                        } else {
                            continue;
                        }
                    }
                }
            }
            _ => {
                let Some(sh) = bad.shelves.first_mut() else {
                    continue;
                };
                match which {
                    8 => sh.centre = -1,
                    9 => sh.dir = 16,
                    10 => sh.lake = bad.lakes.len(),
                    11 => sh.walls.push(i32::try_from(n).unwrap()),
                    _ => {
                        sh.spire = true;
                        sh.dir = 1;
                    }
                }
            }
        }
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &mut bad),
            Err(Error::Feature),
            "plan {which}"
        );
        assert_eq!(
            cb.props(&mut rt.prop_context(), &bad),
            Err(Error::Feature),
            "plan {which}"
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
    let shared = rime::default_definition();
    let fr = crate::mapgen::coliseum::default_definition();
    let cat = crate::mapgen::terrain_gate::default_definition();
    for value in [f64::NAN, f64::INFINITY, -1.0, 1.01] {
        let mut d = default_definition();
        d.facet_diagonal_chance = value;
        assert!(Callbacks::new(&d, &shared, &fixed, &fr, cat.props, cat.kinds).is_err());
    }
    assert!(Callbacks::new(&default_definition(), &shared, &fixed, &fr, &[], cat.kinds).is_err());
    assert!(serde_json::from_value::<Plan>(
        json!({"lakes":[],"shelves":[],"causeway":[],"routed":0,"unknown":1})
    )
    .is_err());
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
    let d = default_definition();
    let Definition {
        lake_grow,
        ice_want,
        grow_max_percent,
        salt_one,
        salt_two,
        lake_min,
        lake_gap,
        headlands,
        head_tries,
        head_look,
        head_edge,
        head_sep2,
        spire_clearance,
        spire_min_cells,
        spire_tries,
        spire_separation,
        route_band,
        route_near,
        route_second,
        gate_mouth_offset,
        margin_spawn,
        margin_corridor,
        value_clearance,
        value_noise,
        value_centre,
        noise_cell,
        noise_octaves,
        smooth_passes,
        smooth_threshold,
        smooth_window,
        fill_share_min,
        facet_diagonal_chance,
        facet_axis_base,
        facet_axis_range,
        facet_diag_base,
        facet_diag_range,
        facet_reach,
        head_radius_first,
        head_radius_later,
        head_outset,
        causeway_min,
        ring_extra,
        variant_salt,
        variant_count,
        shelf_prop_salt,
        spire_prop_chance,
        icicle_chance,
        drift_radius,
        drift_salt,
        drift_chance,
        ice_prop_salt,
        ice_prop_scale,
        sparkle_bound,
        crack_bound,
        tower_prop_salt,
        tower_chance,
        spire_radii,
    } = d;
    let expected = [
        lake_grow as u64,
        ice_want as u64,
        grow_max_percent as u64,
        salt_one.to_bits(),
        salt_two.to_bits(),
        lake_min as u64,
        lake_gap as u64,
        headlands as u64,
        head_tries as u64,
        head_look as u64,
        head_edge as u64,
        head_sep2 as u64,
        spire_clearance as u64,
        spire_min_cells as u64,
        spire_tries as u64,
        spire_separation as u64,
        route_band as u64,
        route_near as u64,
        route_second.to_bits(),
        gate_mouth_offset.to_bits(),
        margin_spawn as u64,
        margin_corridor as u64,
        value_clearance as u64,
        value_noise as u64,
        value_centre as u64,
        noise_cell.to_bits(),
        noise_octaves as u64,
        smooth_passes as u64,
        smooth_threshold as u64,
        smooth_window as u64,
        fill_share_min as u64,
        facet_diagonal_chance.to_bits(),
        facet_axis_base.to_bits(),
        facet_axis_range.to_bits(),
        facet_diag_base.to_bits(),
        facet_diag_range.to_bits(),
        facet_reach.to_bits(),
        head_radius_first.to_bits(),
        head_radius_later.to_bits(),
        head_outset.to_bits(),
        causeway_min as u64,
        ring_extra as u64,
        variant_salt.to_bits(),
        variant_count as u64,
        shelf_prop_salt.to_bits(),
        spire_prop_chance.to_bits(),
        icicle_chance.to_bits(),
        drift_radius as u64,
        drift_salt.to_bits(),
        drift_chance.to_bits(),
        ice_prop_salt.to_bits(),
        ice_prop_scale.to_bits(),
        sparkle_bound.to_bits(),
        crack_bound.to_bits(),
        tower_prop_salt.to_bits(),
        tower_chance.to_bits(),
    ];
    let mut words = vec![];
    visit_content(&d, |w| words.push(w));
    // Exact source NORMALS order in zoneStyle/rime.ts; these same runtime coordinates now join identity.
    let source_normals: [[i32; 2]; 8] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
    ];
    let mut identity = vec![source_normals.len() as u64];
    identity.extend(source_normals.into_iter().flatten().map(|v| v as u64));
    identity.extend(expected);
    let mut expected = identity;
    expected.extend(spire_radii.map(f64::to_bits));
    assert_eq!(words, expected);
    {
        let mut v = d;
        v.lake_grow += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "lake_grow"
        );
    }
    {
        let mut v = d;
        v.ice_want += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "ice_want"
        );
    }
    {
        let mut v = d;
        v.grow_max_percent += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "grow_max_percent"
        );
    }
    {
        let mut v = d;
        v.salt_one += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "salt_one"
        );
    }
    {
        let mut v = d;
        v.salt_two += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "salt_two"
        );
    }
    {
        let mut v = d;
        v.lake_min += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "lake_min"
        );
    }
    {
        let mut v = d;
        v.lake_gap += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "lake_gap"
        );
    }
    {
        let mut v = d;
        v.headlands += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "headlands"
        );
    }
    {
        let mut v = d;
        v.head_tries += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_tries"
        );
    }
    {
        let mut v = d;
        v.head_look += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_look"
        );
    }
    {
        let mut v = d;
        v.head_edge += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_edge"
        );
    }
    {
        let mut v = d;
        v.head_sep2 += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_sep2"
        );
    }
    {
        let mut v = d;
        v.spire_clearance += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "spire_clearance"
        );
    }
    {
        let mut v = d;
        v.spire_min_cells += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "spire_min_cells"
        );
    }
    {
        let mut v = d;
        v.spire_tries += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "spire_tries"
        );
    }
    {
        let mut v = d;
        v.spire_separation += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "spire_separation"
        );
    }
    {
        let mut v = d;
        v.route_band += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "route_band"
        );
    }
    {
        let mut v = d;
        v.route_near += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "route_near"
        );
    }
    {
        let mut v = d;
        v.route_second += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "route_second"
        );
    }
    {
        let mut v = d;
        v.gate_mouth_offset += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "gate_mouth_offset"
        );
    }
    {
        let mut v = d;
        v.margin_spawn += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "margin_spawn"
        );
    }
    {
        let mut v = d;
        v.margin_corridor += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "margin_corridor"
        );
    }
    {
        let mut v = d;
        v.value_clearance += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "value_clearance"
        );
    }
    {
        let mut v = d;
        v.value_noise += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "value_noise"
        );
    }
    {
        let mut v = d;
        v.value_centre += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "value_centre"
        );
    }
    {
        let mut v = d;
        v.noise_cell += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "noise_cell"
        );
    }
    {
        let mut v = d;
        v.noise_octaves += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "noise_octaves"
        );
    }
    {
        let mut v = d;
        v.smooth_passes += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "smooth_passes"
        );
    }
    {
        let mut v = d;
        v.smooth_threshold += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "smooth_threshold"
        );
    }
    {
        let mut v = d;
        v.smooth_window += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "smooth_window"
        );
    }
    {
        let mut v = d;
        v.fill_share_min += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "fill_share_min"
        );
    }
    {
        let mut v = d;
        v.facet_diagonal_chance += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_diagonal_chance"
        );
    }
    {
        let mut v = d;
        v.facet_axis_base += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_axis_base"
        );
    }
    {
        let mut v = d;
        v.facet_axis_range += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_axis_range"
        );
    }
    {
        let mut v = d;
        v.facet_diag_base += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_diag_base"
        );
    }
    {
        let mut v = d;
        v.facet_diag_range += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_diag_range"
        );
    }
    {
        let mut v = d;
        v.facet_reach += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "facet_reach"
        );
    }
    {
        let mut v = d;
        v.head_radius_first += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_radius_first"
        );
    }
    {
        let mut v = d;
        v.head_radius_later += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_radius_later"
        );
    }
    {
        let mut v = d;
        v.head_outset += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "head_outset"
        );
    }
    {
        let mut v = d;
        v.causeway_min += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "causeway_min"
        );
    }
    {
        let mut v = d;
        v.ring_extra += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "ring_extra"
        );
    }
    {
        let mut v = d;
        v.variant_salt += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "variant_salt"
        );
    }
    {
        let mut v = d;
        v.variant_count += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "variant_count"
        );
    }
    {
        let mut v = d;
        v.shelf_prop_salt += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "shelf_prop_salt"
        );
    }
    {
        let mut v = d;
        v.spire_prop_chance += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "spire_prop_chance"
        );
    }
    {
        let mut v = d;
        v.icicle_chance += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "icicle_chance"
        );
    }
    {
        let mut v = d;
        v.drift_radius += 1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "drift_radius"
        );
    }
    {
        let mut v = d;
        v.drift_salt += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "drift_salt"
        );
    }
    {
        let mut v = d;
        v.drift_chance += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "drift_chance"
        );
    }
    {
        let mut v = d;
        v.ice_prop_salt += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "ice_prop_salt"
        );
    }
    {
        let mut v = d;
        v.ice_prop_scale += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "ice_prop_scale"
        );
    }
    {
        let mut v = d;
        v.sparkle_bound += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "sparkle_bound"
        );
    }
    {
        let mut v = d;
        v.crack_bound += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "crack_bound"
        );
    }
    {
        let mut v = d;
        v.tower_prop_salt += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "tower_prop_salt"
        );
    }
    {
        let mut v = d;
        v.tower_chance += 1.0;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_eq!(
            changed.iter().zip(&words).filter(|(a, b)| a != b).count(),
            1,
            "tower_chance"
        );
    }
    for k in 0..3 {
        let mut v = d;
        v.spire_radii[k] += 0.1;
        let mut changed = vec![];
        visit_content(&v, |w| changed.push(w));
        assert_ne!(changed, words);
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
fn actual_facet_cells_and_rng_continuations_match() {
    let f = fixture();
    inventory(&f);
    for c in f["facets"].as_array().unwrap() {
        let seed = u32::try_from(c["seed"].as_u64().unwrap()).unwrap();
        let mut rng = crate::rng::Mulberry32::new(seed);
        let cells = shape::facet(
            &mut rng,
            c["radius"].as_f64().unwrap(),
            &default_definition(),
        );
        eq(&json!(cells), &c["cells"], "facet order");
        let next: Vec<_> = (0..4).map(|_| rng.next_f64()).collect();
        eq(&json!(next), &c["next"], "facet RNG");
        let mut reference = crate::rng::Mulberry32::new(seed);
        let draws = c["draws"].as_u64().unwrap();
        assert!((12..=16).contains(&draws));
        for _ in 0..draws {
            reference.next_f64();
        }
        assert_eq!(
            next,
            (0..4).map(|_| reference.next_f64()).collect::<Vec<_>>()
        );
    }
}

#[test]
fn oversized_callback_geometry_refuses_before_writes() {
    let (w, h) = (2049, 1);
    let n = w * h;
    let mut state = State::new(
        w,
        h,
        vec![TILE_FLOOR; n],
        vec![0; n],
        vec![],
        vec![],
        vec![0; n],
    )
    .unwrap();
    let geometry = Geometry::new(
        1,
        crate::mapdata::Zone::Frost,
        &vec![1; n],
        state.tiles(),
        w,
        h,
        &[],
    )
    .unwrap();
    let zero = vec![0; n];
    let catalog = crate::mapgen::terrain_gate::default_definition();
    let rules = style_runtime::default_definition();
    let mut rt = Runtime::new(
        &mut state,
        Inputs {
            geometry: &geometry,
            hard: &zero,
            no_block: &zero,
            no_prop: &zero,
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
        &rules,
    )
    .unwrap();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let cb = callbacks(&fixed);
    let before = snap(&rt);
    let mut plan = Plan::default();
    assert_eq!(cb.shape(&mut rt.shape_context()), Err(Error::Dimensions));
    assert_eq!(
        cb.surface(&mut rt.surface_context(), &mut plan),
        Err(Error::Dimensions)
    );
    assert_eq!(
        cb.props(&mut rt.prop_context(), &plan),
        Err(Error::Dimensions)
    );
    eq(&snap(&rt), &before, "dimension refusal");
}

#[test]
fn malformed_tower_boxes_refuse_continuations_without_writes() {
    let (w, h) = (25, 25);
    let n = w * h;
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let cb = callbacks(&fixed);
    for bbox in [
        crate::mapdata::TileRect {
            x: -1,
            y: 2,
            w: 3,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: -1,
            w: 3,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 24,
            y: 2,
            w: 3,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: 24,
            w: 3,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: 2,
            w: u32::MAX,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: 2,
            w: 3,
            h: u32::MAX,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: 2,
            w: 0,
            h: 3,
        },
        crate::mapdata::TileRect {
            x: 2,
            y: 2,
            w: 3,
            h: 0,
        },
    ] {
        let mut tiles = vec![TILE_FLOOR; n];
        tiles[312] = TILE_WALL;
        let feature = crate::mapdata::MapFeature {
            kind: FeatureKind::Landmark,
            variant: rime::default_definition().template.key.to_string(),
            zone: crate::mapdata::Zone::Frost,
            jobs: vec![],
            ax: 5,
            ay: 5,
            p: vec![],
            bbox,
            tiles: 1,
        };
        let mut state =
            State::new(w, h, tiles, vec![0; n], vec![], vec![feature], vec![0; n]).unwrap();
        let geometry = Geometry::new(
            1,
            crate::mapdata::Zone::Frost,
            &vec![1; n],
            state.tiles(),
            w,
            h,
            &[],
        )
        .unwrap();
        let zero = vec![0; n];
        let catalog = crate::mapgen::terrain_gate::default_definition();
        let rules = style_runtime::default_definition();
        let mut rt = Runtime::new(
            &mut state,
            Inputs {
                geometry: &geometry,
                hard: &zero,
                no_block: &zero,
                no_prop: &zero,
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
            &rules,
        )
        .unwrap();
        // Valid continuation has shelf decoration that used to write before the bad box was reached.
        let mut plan = Plan {
            lakes: vec![LakePlan {
                index: 0,
                seed: 10,
                clr: 20,
                tiles: vec![],
                grown: 40,
                ice: 0,
            }],
            shelves: vec![ShelfPlan {
                lake: 0,
                centre: 312,
                dir: 0,
                spire: true,
                walls: vec![312],
            }],
            ..Plan::default()
        };
        let before = snap(&rt);
        let before_plan = plan.clone();
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &mut plan),
            Err(Error::Feature)
        );
        assert_eq!(cb.props(&mut rt.prop_context(), &plan), Err(Error::Feature));
        assert_eq!(plan, before_plan);
        eq(&snap(&rt), &before, "tower box no-write");
    }
}

#[test]
fn malformed_gate_geometry_refuses_before_sampling_or_writes() {
    let catalog = crate::mapgen::terrain_gate::default_definition();
    let d = default_definition();
    let shared = rime::default_definition();
    let fixed_rules = crate::mapgen::coliseum::default_definition();
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        2048.0 * crate::constants::TILE,
        1e300,
    ] {
        for axis in 0..2 {
            let mut fixed = crate::mapgen::coliseum::fixed_layout();
            if axis == 0 {
                fixed.gates[0].x = value
            } else {
                fixed.gates[0].y = value
            }
            assert!(matches!(
                Callbacks::new(
                    &d,
                    &shared,
                    &fixed,
                    &fixed_rules,
                    catalog.props,
                    catalog.kinds
                ),
                Err(Error::Definition)
            ));
        }
    }
    let (w, h) = (160, 160);
    let n = w * h;
    for which in 0..3 {
        let mut fixed = crate::mapgen::coliseum::fixed_layout();
        let mut policy = d;
        match which {
            0 => fixed.gates[0].x = 6000.0,
            1 => fixed.gates[0].y = 6000.0,
            _ => policy.gate_mouth_offset = 1e6,
        }
        let cb = Callbacks::new(
            &policy,
            &shared,
            &fixed,
            &fixed_rules,
            catalog.props,
            catalog.kinds,
        )
        .unwrap();
        let mut state = State::new(
            w,
            h,
            vec![TILE_FLOOR; n],
            vec![0; n],
            vec![],
            vec![],
            vec![0; n],
        )
        .unwrap();
        let geometry = Geometry::new(
            1,
            crate::mapdata::Zone::Frost,
            &vec![1; n],
            state.tiles(),
            w,
            h,
            &[],
        )
        .unwrap();
        let zero = vec![0; n];
        let rules = style_runtime::default_definition();
        let mut rt = Runtime::new(
            &mut state,
            Inputs {
                geometry: &geometry,
                hard: &zero,
                no_block: &zero,
                no_prop: &zero,
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
            &rules,
        )
        .unwrap();
        let before = snap(&rt);
        let mut plan = Plan::default();
        assert_eq!(cb.shape(&mut rt.shape_context()), Err(Error::Definition));
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &mut plan),
            Err(Error::Definition)
        );
        assert_eq!(
            cb.props(&mut rt.prop_context(), &plan),
            Err(Error::Definition)
        );
        eq(&snap(&rt), &before, "gate geometry no-write");
    }
}
