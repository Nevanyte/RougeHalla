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
const UNITS: [&str; 23] = [
    "open-default-rows-square",
    "empty-short-box",
    "vertical-axis",
    "no-square",
    "period-ten-auto-phases",
    "odd-period-auto-phases",
    "negative-explicit-phases",
    "fixed-gap-zero-penalty-row-tie",
    "tight-spacing-wiggled-rows",
    "overlapping-tight-rows-partial-guards",
    "all-gate-open-no-fence",
    "zigzag-blocked-detours",
    "partial-guard-budget-piece-trimming",
    "dense-row-wall-hard-partial-guard-relaxation",
    "zero-footprint-no-square-or-rows",
    "route-open-corridor",
    "route-repair-real-walks",
    "route-none-ablation",
    "route-short-row-retention",
    "route-protected-short-row-keep-feature",
    "prop-protection",
    "prop-cap-repeated-callback",
    "actual-guard-house-props",
];
fn fixture() -> Value {
    serde_json::from_str::<UniqueValue>(include_str!("../fixtures/style-gallows.json"))
        .unwrap()
        .0
}
fn inventory(f: &Value) {
    gate_inventory(f);
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
            "gateCases",
            "phaseCases",
            "distanceCases",
            "cases",
            "units",
        ],
    );
    assert_eq!(f["format"], "rh-style-gallows/1");
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
        hashes["zoneStyle/gallows.ts"],
        "0edb95a89d06fc6b0f60a6dc85da41613177362679c03e2073f2be24bbe186e4"
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
fn callbacks(dials: Dials) -> Callbacks<'static> {
    Callbacks::new(
        &default_definition(),
        &dials,
        &gallows::default_definition(),
        crate::mapgen::terrain_gate::default_definition().props,
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
                "dials",
                "init",
                "initial",
                "phases",
                "streams",
                "plan",
                "final",
            ],
        );
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
    let dials = if actual {
        default_dials()
    } else {
        resolve_dials(&serde_json::from_value::<PartialDials>(row["dials"].clone()).unwrap())
            .unwrap()
    };
    let cb = callbacks(dials);
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
        // Source surface phase is absent: no context/stream is created.
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
        assert_eq!(e["stream"], [0, 1][index]);
        assert_eq!(e["draws"], 0);
        assert_eq!(e["noiseSeed"], stream.noise.stream_seed);
        let mut source =
            crate::rng::Mulberry32::new(u32::try_from(e["seed"].as_u64().unwrap()).unwrap());
        let next: Vec<_> = (0..4).map(|_| stream.rng.next_f64()).collect();
        eq(&json!(next), &e["next"], "stream continuation");
        assert_eq!(next, (0..4).map(|_| source.next_f64()).collect::<Vec<_>>());
    }
    let before = snap(&rt);
    for which in 0..9 {
        let mut bad = plan.clone();
        match which {
            0 => bad.axis = 2,
            1 => bad.gallows = vec![0],
            2 => bad.dropped.push(-1),
            3 => {
                bad.square = Some(Square {
                    k: usize::MAX,
                    s: 0,
                })
            }
            4 => bad.base_rows.push(-1),
            _ => {
                if bad.rows.is_empty() {
                    continue;
                }
                let row = &mut bad.rows[0];
                match which {
                    5 => row.tiles.push(i32::try_from(n).unwrap()),
                    6 => row.posts.push(-1),
                    7 => row.gates.push(i32::try_from(n).unwrap()),
                    _ => row.index = usize::MAX,
                }
            }
        }
        assert_eq!(cb.props(&mut rt.prop_context(), &bad), Err(Error::Feature));
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

fn gate_inventory(f: &Value) {
    for (key, len, keys) in [
        (
            "gateCases",
            572,
            &["period", "width", "phase", "s", "result"][..],
        ),
        ("phaseCases", 24, &["phases", "index", "result"][..]),
        ("distanceCases", 14, &["period", "width", "result"][..]),
    ] {
        let cases = f[key].as_array().unwrap();
        assert_eq!(cases.len(), len);
        let mut seen = BTreeSet::new();
        for c in cases {
            fields(c, keys);
            let id = match key {
                "gateCases" => json!([c["period"], c["width"], c["phase"], c["s"]]),
                "phaseCases" => json!([c["phases"], c["index"]]),
                _ => json!([c["period"], c["width"]]),
            };
            assert!(seen.insert(id.to_string()));
            let i = |k: &str| i32::try_from(c[k].as_i64().unwrap()).unwrap();
            let actual = match key {
                "gateCases" => json!(gate_open(i("s"), i("phase"), i("period"), i("width"))),
                "phaseCases" => json!(row_phase(
                    i("index"),
                    &serde_json::from_value::<Vec<i32>>(c["phases"].clone()).unwrap()
                )
                .unwrap()),
                _ => json!(max_gate_distance(i("period"), i("width"))),
            };
            eq(&actual, &c["result"], key);
        }
    }
}
#[test]
fn admitted_factory_domain_and_absent_surface() {
    let d = resolve_dials(&PartialDials {
        period: Some(10),
        ..PartialDials::default()
    })
    .unwrap();
    assert_eq!(d.phases, vec![2, 7]);
    let d = resolve_dials(&PartialDials {
        period: Some(11),
        phases: Some(vec![-5, 13]),
        ..PartialDials::default()
    })
    .unwrap();
    assert_eq!(d.phases, vec![-5, 13]);
    for bad in [
        json!({"unknown":1}),
        json!({"period":null}),
        json!({"period":1.5}),
        json!({"period":2147483648_u64}),
    ] {
        assert!(serde_json::from_value::<PartialDials>(bad).is_err())
    }
    for bad in [
        json!({"phases":[]}),
        json!({"period":0}),
        json!({"width":13}),
        json!({"gapMin":0}),
        json!({"gapMin":10,"gapMax":9}),
        json!({"squares":2}),
        json!({"gapPenalty":-1}),
    ] {
        let p = serde_json::from_value::<PartialDials>(bad).unwrap();
        assert!(resolve_dials(&p).is_err());
    }
    assert_eq!(row_phase(0, &[]), None);
    assert!(serde_json::from_value::<Plan>(json!({"unknown":1})).is_err());
}
#[test]
fn all_definition_and_factory_fields_drive_content() {
    let d = default_definition();
    let a = default_dials();
    let words = |d: &Definition<'_>, a: &Dials| {
        let mut w = Vec::new();
        visit_content(d, a, |v| w.push(v));
        w
    };
    let baseline = words(&d, &a);
    let Definition {
        open_run_min: _,
        value_bias: _,
        wiggle: _,
        blocked_cost: _,
        deviation_cost: _,
        jog_cost: _,
        square_window: _,
        offsets_s: _,
        offsets_t: _,
        square_tries: _,
        min_piece: _,
        square_blocked_cost: _,
        route_checks: _,
        relax_rounds: _,
        plan_rounds: _,
        detour_reach: _,
        detour_pair_reach: _,
        repair_radius_max: _,
        variant_salt: _,
        variants: _,
        lantern_salt: _,
        lantern_chance: _,
        side_salt: _,
        side_threshold: _,
        chain_salt: _,
        chain_chance: _,
        banner_salt: _,
        banner_chance: _,
        banner_limit: _,
    } = d;
    let mut changed = d;
    changed.open_run_min += 1;
    assert_ne!(words(&changed, &a), baseline, "open_run_min");
    let mut changed = d;
    changed.value_bias += 1;
    assert_ne!(words(&changed, &a), baseline, "value_bias");
    let mut changed = d;
    changed.wiggle += 1;
    assert_ne!(words(&changed, &a), baseline, "wiggle");
    let mut changed = d;
    changed.blocked_cost += 1;
    assert_ne!(words(&changed, &a), baseline, "blocked_cost");
    let mut changed = d;
    changed.deviation_cost += 1;
    assert_ne!(words(&changed, &a), baseline, "deviation_cost");
    let mut changed = d;
    changed.jog_cost += 1.0;
    assert_ne!(words(&changed, &a), baseline, "jog_cost");
    let mut changed = d;
    changed.square_window += 1;
    assert_ne!(words(&changed, &a), baseline, "square_window");
    let mut changed = d;
    changed.square_tries += 1;
    assert_ne!(words(&changed, &a), baseline, "square_tries");
    let mut changed = d;
    changed.min_piece += 1;
    assert_ne!(words(&changed, &a), baseline, "min_piece");
    let mut changed = d;
    changed.square_blocked_cost += 1.0;
    assert_ne!(words(&changed, &a), baseline, "square_blocked_cost");
    let mut changed = d;
    changed.route_checks += 1;
    assert_ne!(words(&changed, &a), baseline, "route_checks");
    let mut changed = d;
    changed.relax_rounds += 1;
    assert_ne!(words(&changed, &a), baseline, "relax_rounds");
    let mut changed = d;
    changed.plan_rounds += 1;
    assert_ne!(words(&changed, &a), baseline, "plan_rounds");
    let mut changed = d;
    changed.detour_reach += 1;
    assert_ne!(words(&changed, &a), baseline, "detour_reach");
    let mut changed = d;
    changed.detour_pair_reach += 1;
    assert_ne!(words(&changed, &a), baseline, "detour_pair_reach");
    let mut changed = d;
    changed.repair_radius_max += 1;
    assert_ne!(words(&changed, &a), baseline, "repair_radius_max");
    let mut changed = d;
    changed.variant_salt += 1.0;
    assert_ne!(words(&changed, &a), baseline, "variant_salt");
    let mut changed = d;
    changed.variants += 1;
    assert_ne!(words(&changed, &a), baseline, "variants");
    let mut changed = d;
    changed.lantern_salt += 1.0;
    assert_ne!(words(&changed, &a), baseline, "lantern_salt");
    let mut changed = d;
    changed.lantern_chance += 1.0;
    assert_ne!(words(&changed, &a), baseline, "lantern_chance");
    let mut changed = d;
    changed.side_salt += 1.0;
    assert_ne!(words(&changed, &a), baseline, "side_salt");
    let mut changed = d;
    changed.side_threshold += 1.0;
    assert_ne!(words(&changed, &a), baseline, "side_threshold");
    let mut changed = d;
    changed.chain_salt += 1.0;
    assert_ne!(words(&changed, &a), baseline, "chain_salt");
    let mut changed = d;
    changed.chain_chance += 1.0;
    assert_ne!(words(&changed, &a), baseline, "chain_chance");
    let mut changed = d;
    changed.banner_salt += 1.0;
    assert_ne!(words(&changed, &a), baseline, "banner_salt");
    let mut changed = d;
    changed.banner_chance += 1.0;
    assert_ne!(words(&changed, &a), baseline, "banner_chance");
    let mut changed = d;
    changed.banner_limit += 1;
    assert_ne!(words(&changed, &a), baseline, "banner_limit");
    let mut values = d.offsets_s.to_vec();
    values[0] += 1;
    let changed = Definition {
        offsets_s: &values,
        ..d
    };
    assert_ne!(words(&changed, &a), baseline, "offsets_s");
    let mut values = d.offsets_t.to_vec();
    values[0] += 1;
    let changed = Definition {
        offsets_t: &values,
        ..d
    };
    assert_ne!(words(&changed, &a), baseline, "offsets_t");
    let Dials {
        gap_min: _,
        gap_max: _,
        gap_target: _,
        gap_penalty: _,
        period: _,
        width: _,
        phases: _,
        min_run: _,
        squares: _,
        route: _,
    } = a;
    let mut changed = a.clone();
    changed.gap_min += 1;
    assert_ne!(words(&d, &changed), baseline, "gap_min");
    let mut changed = a.clone();
    changed.gap_max += 1;
    assert_ne!(words(&d, &changed), baseline, "gap_max");
    let mut changed = a.clone();
    changed.gap_target += 1;
    assert_ne!(words(&d, &changed), baseline, "gap_target");
    let mut changed = a.clone();
    changed.period += 1;
    assert_ne!(words(&d, &changed), baseline, "period");
    let mut changed = a.clone();
    changed.width += 1;
    assert_ne!(words(&d, &changed), baseline, "width");
    let mut changed = a.clone();
    changed.min_run += 1;
    assert_ne!(words(&d, &changed), baseline, "min_run");
    let mut changed = a.clone();
    changed.squares += 1;
    assert_ne!(words(&d, &changed), baseline, "squares");
    let mut changed = a.clone();
    changed.gap_penalty += 1.0;
    assert_ne!(words(&d, &changed), baseline);
    let mut changed = a.clone();
    changed.phases[0] += 1;
    assert_ne!(words(&d, &changed), baseline);
    for route in [Route::Open, Route::None] {
        let mut changed = a.clone();
        changed.route = route;
        assert_ne!(words(&d, &changed), baseline)
    }
}

#[test]
fn source_gate_phase_and_distance_helpers() {
    gate_inventory(&fixture());
}

#[test]
fn all_helper_section_deletions_and_duplicates_refuse() {
    let good = fixture();
    for section in ["gateCases", "phaseCases", "distanceCases"] {
        let mut bad = good.clone();
        bad[section] = json!([]);
        assert!(std::panic::catch_unwind(|| inventory(&bad)).is_err());
        let mut bad = good.clone();
        bad[section][1] = bad[section][0].clone();
        assert!(std::panic::catch_unwind(|| inventory(&bad)).is_err());
    }
}

#[test]
fn malformed_fixture_integer_narrowing_refuses() {
    let f = fixture();
    for which in 0..7 {
        let mut bad = f["units"][0].clone();
        match which {
            0 => bad["init"]["w"] = json!(u64::MAX),
            1 => bad["init"]["caps"]["joinChecks"] = json!(4294967296_u64),
            2 => bad["init"]["caps"]["fenceDetour"] = json!(65536),
            3 => bad["streams"][0]["seed"] = json!(4294967296_u64),
            4 => bad["streams"][0]["noiseSeed"] = json!(4294967296_u64),
            5 => bad["init"]["spawns"] = json!([2147483648_u64]),
            _ => bad["dials"] = json!({"period":2147483648_u64}),
        }
        assert!(std::panic::catch_unwind(|| replay(&bad, &f["metadata"], false)).is_err());
    }
}
#[test]
fn malformed_definition_limits_and_catalog_refuse() {
    let catalog = crate::mapgen::terrain_gate::default_definition();
    let house = gallows::default_definition();
    let dials = default_dials();
    let build = |d: &Definition<'_>| Callbacks::new(d, &dials, &house, catalog.props).is_ok();
    for d in [
        Definition {
            route_checks: 0,
            ..default_definition()
        },
        Definition {
            route_checks: 7,
            ..default_definition()
        },
        Definition {
            square_tries: 0,
            ..default_definition()
        },
        Definition {
            wiggle: -1,
            ..default_definition()
        },
        Definition {
            min_piece: 0,
            ..default_definition()
        },
        Definition {
            detour_pair_reach: 4,
            ..default_definition()
        },
        Definition {
            jog_cost: f64::NAN,
            ..default_definition()
        },
        Definition {
            lantern_chance: f64::INFINITY,
            ..default_definition()
        },
        Definition {
            variant_salt: f64::NAN,
            ..default_definition()
        },
    ] {
        assert!(!build(&d));
    }
    assert!(Callbacks::new(&default_definition(), &dials, &house, &[]).is_err());
}
