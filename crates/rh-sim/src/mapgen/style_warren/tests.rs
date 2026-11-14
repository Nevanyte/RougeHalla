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
    "open-nine-camp-roads",
    "empty-no-camps",
    "road-shorter-than-minimum",
    "road-exact-minimum-endpoint-padding",
    "partial-barrow-footprint-cap",
    "barrows-refused-zero-footprint",
    "protected-centres-and-crescent",
    "prop-protection",
    "route-core-fringe-cap-and-prune",
    "route-short-walks-to-unowned-floor",
    "route-pruning-short-real-walk",
    "route-pruning-short-real-walk-obstacles",
    "prop-cap-repeated-callback",
    "burrow-road-exclusion-and-rubble",
];
fn fixture() -> Value {
    serde_json::from_str::<UniqueValue>(include_str!("../fixtures/style-warren.json"))
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
    assert_eq!(f["format"], "rh-style-warren/1");
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
        hashes["zoneStyle/warren.ts"],
        "bdb057ebaf226fbe803403cc338d38f50c154c276a30fcb652b5229741a9ddcc"
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
fn callbacks() -> Callbacks<'static> {
    static FIXED: std::sync::OnceLock<(FixedLayout, FixedDefinition<'static>)> =
        std::sync::OnceLock::new();
    let (fixed, rules) = FIXED.get_or_init(|| {
        (
            crate::mapgen::coliseum::fixed_layout(),
            crate::mapgen::coliseum::default_definition(),
        )
    });
    Callbacks::new(
        &default_definition(),
        &crate::mapgen::landmarks::recipe_support::default_definition(),
        fixed,
        rules,
        &warren::default_definition(),
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
    let cb = callbacks();
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
        assert_eq!(e["draws"], 0);
        assert_eq!(e["noiseSeed"], stream.noise.stream_seed);
        let mut source =
            crate::rng::Mulberry32::new(u32::try_from(e["seed"].as_u64().unwrap()).unwrap());
        let next: Vec<_> = (0..4).map(|_| stream.rng.next_f64()).collect();
        eq(&json!(next), &e["next"], "stream continuation");
        assert_eq!(next, (0..4).map(|_| source.next_f64()).collect::<Vec<_>>());
    }
    let before = snap(&rt);
    for which in 0..12 {
        let mut corrupt = plan.clone();
        match which {
            0 => corrupt.crescent.push(i32::try_from(n).unwrap()),
            1 => corrupt.mouths.push(-1),
            2 => corrupt.bog.push(i32::try_from(n).unwrap()),
            3 => corrupt.tunnels.push(vec![-1]),
            4 => corrupt.placed = usize::MAX,
            _ => {
                if corrupt.barrows.is_empty() {
                    continue;
                }
                let b = &mut corrupt.barrows[0];
                match which {
                    5 => b.walls.push(-1),
                    6 => b.slot.push(i32::try_from(n).unwrap()),
                    7 => b.crescent.push(-1),
                    8 => b.dir16 = 16,
                    9 => b.wet = 0,
                    10 => b.r4 = i32::MAX,
                    _ => b.id = usize::MAX,
                }
            }
        }
        assert_eq!(
            cb.surface(&mut rt.surface_context(), &mut corrupt),
            Err(Error::Feature)
        );
        assert_eq!(
            cb.props(&mut rt.prop_context(), &corrupt),
            Err(Error::Feature)
        );
        eq(&snap(&rt), &before, "malformed no write");
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

#[test]
fn definitions_and_plan_json_refuse_malformed() {
    let cb = callbacks();
    for value in [f64::NAN, f64::INFINITY, -1.0, 1.01] {
        let mut d = default_definition();
        d.fungus_chance = value;
        assert!(Callbacks::new(
            &d,
            &cb.scale,
            cb.fixed,
            cb.fixed_rules,
            &warren::default_definition(),
            crate::mapgen::terrain_gate::default_definition().props
        )
        .is_err());
    }
    assert!(Callbacks::new(
        &default_definition(),
        &cb.scale,
        cb.fixed,
        cb.fixed_rules,
        &warren::default_definition(),
        &[]
    )
    .is_err());
    assert!(serde_json::from_value::<Plan>(json!({"unknown":1})).is_err());
    assert!(serde_json::from_value::<Barrow>(json!({"id":-1})).is_err());
}
#[test]
fn every_numeric_field_drives_content() {
    let Definition {
        barrows_per_ref: _,
        tunnels_per_ref: _,
        road_min2: _,
        r4_min: _,
        r4_max: _,
        r4_tunnel: _,
        pad_camp10: _,
        pad_door10: _,
        t_permille: _,
        across: _,
        accept_permille: _,
        member_gap4: _,
        clip_max: _,
        bog_min_piece: _,
        bog_camp_gap: _,
        burrow_road_near2: _,
        route_tries: _,
        radius_length: _,
        radius_shrink: _,
        jitter_cell: _,
        jitter_salt: _,
        jitter_scale: _,
        jitter_divisor: _,
        wet_cell: _,
        wet_salt: _,
        wet_threshold: _,
        camp_window: _,
        crescent_inner20: _,
        crescent_outer20: _,
        crescent_along4: _,
        slot_width_squared: _,
        score_across: _,
        score_along_divisor: _,
        variants: _,
        wall_variant_salt: _,
        wall_salt: _,
        fungus_chance: _,
        drip_chance: _,
        reed_salt: _,
        reed_chance: _,
        reed_variant_salt: _,
        rubble_salt: _,
        rubble_chance: _,
        rubble_variant_salt: _,
    } = default_definition();
    let d = default_definition();
    let words = |d: &Definition<'_>| {
        let mut v = Vec::new();
        visit_content(d, |word| v.push(word));
        v
    };
    let baseline = words(&d);
    let mut changed = d;
    changed.barrows_per_ref += 1.0;
    assert_ne!(words(&changed), baseline, "barrows_per_ref");
    let mut changed = d;
    changed.tunnels_per_ref += 1.0;
    assert_ne!(words(&changed), baseline, "tunnels_per_ref");
    let mut changed = d;
    changed.road_min2 += 1.0;
    assert_ne!(words(&changed), baseline, "road_min2");
    let mut changed = d;
    changed.r4_min += 1;
    assert_ne!(words(&changed), baseline, "r4_min");
    let mut changed = d;
    changed.r4_max += 1;
    assert_ne!(words(&changed), baseline, "r4_max");
    let mut changed = d;
    changed.r4_tunnel += 1;
    assert_ne!(words(&changed), baseline, "r4_tunnel");
    let mut changed = d;
    changed.pad_camp10 += 1.0;
    assert_ne!(words(&changed), baseline, "pad_camp10");
    let mut changed = d;
    changed.pad_door10 += 1.0;
    assert_ne!(words(&changed), baseline, "pad_door10");
    let mut changed = d;
    changed.accept_permille += 1;
    assert_ne!(words(&changed), baseline, "accept_permille");
    let mut changed = d;
    changed.member_gap4 += 1;
    assert_ne!(words(&changed), baseline, "member_gap4");
    let mut changed = d;
    changed.clip_max += 1;
    assert_ne!(words(&changed), baseline, "clip_max");
    let mut changed = d;
    changed.bog_min_piece += 1;
    assert_ne!(words(&changed), baseline, "bog_min_piece");
    let mut changed = d;
    changed.bog_camp_gap += 1.0;
    assert_ne!(words(&changed), baseline, "bog_camp_gap");
    let mut changed = d;
    changed.burrow_road_near2 += 1.0;
    assert_ne!(words(&changed), baseline, "burrow_road_near2");
    let mut changed = d;
    changed.route_tries += 1;
    assert_ne!(words(&changed), baseline, "route_tries");
    let mut changed = d;
    changed.radius_length += 1.0;
    assert_ne!(words(&changed), baseline, "radius_length");
    let mut changed = d;
    changed.radius_shrink += 1;
    assert_ne!(words(&changed), baseline, "radius_shrink");
    let mut changed = d;
    changed.jitter_cell += 1.0;
    assert_ne!(words(&changed), baseline, "jitter_cell");
    let mut changed = d;
    changed.jitter_salt += 1.0;
    assert_ne!(words(&changed), baseline, "jitter_salt");
    let mut changed = d;
    changed.jitter_scale += 1.0;
    assert_ne!(words(&changed), baseline, "jitter_scale");
    let mut changed = d;
    changed.jitter_divisor += 1.0;
    assert_ne!(words(&changed), baseline, "jitter_divisor");
    let mut changed = d;
    changed.wet_cell += 1.0;
    assert_ne!(words(&changed), baseline, "wet_cell");
    let mut changed = d;
    changed.wet_salt += 1.0;
    assert_ne!(words(&changed), baseline, "wet_salt");
    let mut changed = d;
    changed.wet_threshold += 1.0;
    assert_ne!(words(&changed), baseline, "wet_threshold");
    let mut changed = d;
    changed.camp_window += 1;
    assert_ne!(words(&changed), baseline, "camp_window");
    let mut changed = d;
    changed.crescent_inner20 += 1;
    assert_ne!(words(&changed), baseline, "crescent_inner20");
    let mut changed = d;
    changed.crescent_outer20 += 1;
    assert_ne!(words(&changed), baseline, "crescent_outer20");
    let mut changed = d;
    changed.crescent_along4 += 1;
    assert_ne!(words(&changed), baseline, "crescent_along4");
    let mut changed = d;
    changed.slot_width_squared += 1.0;
    assert_ne!(words(&changed), baseline, "slot_width_squared");
    let mut changed = d;
    changed.score_across += 1;
    assert_ne!(words(&changed), baseline, "score_across");
    let mut changed = d;
    changed.score_along_divisor += 1;
    assert_ne!(words(&changed), baseline, "score_along_divisor");
    let mut changed = d;
    changed.variants += 1;
    assert_ne!(words(&changed), baseline, "variants");
    let mut changed = d;
    changed.wall_variant_salt += 1.0;
    assert_ne!(words(&changed), baseline, "wall_variant_salt");
    let mut changed = d;
    changed.wall_salt += 1.0;
    assert_ne!(words(&changed), baseline, "wall_salt");
    let mut changed = d;
    changed.fungus_chance += 1.0;
    assert_ne!(words(&changed), baseline, "fungus_chance");
    let mut changed = d;
    changed.drip_chance += 1.0;
    assert_ne!(words(&changed), baseline, "drip_chance");
    let mut changed = d;
    changed.reed_salt += 1.0;
    assert_ne!(words(&changed), baseline, "reed_salt");
    let mut changed = d;
    changed.reed_chance += 1.0;
    assert_ne!(words(&changed), baseline, "reed_chance");
    let mut changed = d;
    changed.reed_variant_salt += 1.0;
    assert_ne!(words(&changed), baseline, "reed_variant_salt");
    let mut changed = d;
    changed.rubble_salt += 1.0;
    assert_ne!(words(&changed), baseline, "rubble_salt");
    let mut changed = d;
    changed.rubble_chance += 1.0;
    assert_ne!(words(&changed), baseline, "rubble_chance");
    let mut changed = d;
    changed.rubble_variant_salt += 1.0;
    assert_ne!(words(&changed), baseline, "rubble_variant_salt");
    let mut values = d.t_permille.to_vec();
    values[0] += 1;
    let changed = Definition {
        t_permille: &values,
        ..d
    };
    assert_ne!(words(&changed), baseline, "t_permille");
    let mut values = d.across.to_vec();
    values[0] += 1;
    let changed = Definition {
        across: &values,
        ..d
    };
    assert_ne!(words(&changed), baseline, "across");
}

#[test]
fn overflowing_fixture_scalars_refuse_before_use() {
    let f = fixture();
    let original = &f["units"][0];
    for which in 0..7 {
        let mut bad = original.clone();
        match which {
            0 => bad["init"]["w"] = json!(u64::MAX),
            1 => bad["init"]["caps"]["joinChecks"] = json!(4294967296_u64),
            2 => bad["init"]["caps"]["fenceDetour"] = json!(65536),
            3 => bad["streams"][0]["seed"] = json!(4294967296_u64),
            4 => bad["streams"][0]["noiseSeed"] = json!(4294967296_u64),
            5 => bad["init"]["spawns"] = json!([2147483648_u64]),
            _ => bad["init"]["camps"][0]["x"] = json!(-1),
        }
        assert!(
            std::panic::catch_unwind(|| replay(&bad, &f["metadata"], false)).is_err(),
            "scalar {which}"
        );
    }
}

#[test]
fn jitter_envelope_admission_matches_disc_shortcuts() {
    let cb = callbacks();
    let props = crate::mapgen::terrain_gate::default_definition().props;
    let build = |d: &Definition<'_>| {
        Callbacks::new(
            d,
            &cb.scale,
            cb.fixed,
            cb.fixed_rules,
            &warren::default_definition(),
            props,
        )
        .is_ok()
    };
    assert!(build(&default_definition()));
    assert!(build(&Definition {
        jitter_scale: 0.0,
        ..default_definition()
    }));
    for d in [
        Definition {
            jitter_scale: 1000.0,
            ..default_definition()
        },
        Definition {
            jitter_divisor: 1e-300,
            ..default_definition()
        },
        Definition {
            jitter_scale: 17.5,
            jitter_divisor: 2560.0,
            ..default_definition()
        },
    ] {
        assert!(!build(&d));
    }
}
