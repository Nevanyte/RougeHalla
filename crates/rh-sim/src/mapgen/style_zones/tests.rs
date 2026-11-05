use super::*;
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
fn fixture() -> Value {
    let raw = include_str!("../fixtures/styled-open.json");
    assert_eq!(raw.len(), 10317499);
    assert_eq!(
        raw.bytes()
            .fold(0xcbf29ce484222325_u64, |h, b| (h ^ u64::from(b))
                .wrapping_mul(0x100000001b3)),
        3540821989239448692_u64,
        "exact canonical fixture bytes"
    );
    serde_json::from_str::<UniqueValue>(include_str!("../fixtures/styled-open.json"))
        .unwrap()
        .0
}
fn unpack_state(v: &Value, n: usize, runtime: bool) -> Value {
    fields(
        v,
        if runtime {
            &[
                "w",
                "h",
                "tiles",
                "terrain",
                "props",
                "features",
                "featureOwner",
                "wrote",
                "scratch",
                "reserved",
                "counters",
            ]
        } else {
            &[
                "w",
                "h",
                "tiles",
                "terrain",
                "props",
                "features",
                "featureOwner",
                "wrote",
                "scratch",
            ]
        },
    );
    let mut out = v.clone();
    for key in ["tiles", "terrain", "wrote"] {
        out[key] = json!(bytes(&v[key], n))
    }
    let owner: Vec<_> = expanded(&v["featureOwner"], n)
        .into_iter()
        .map(|v| u16::try_from(v).unwrap())
        .collect();
    out["featureOwner"] = json!(owner);
    let sc = &v["scratch"];
    fields(sc, &["mark", "qa", "qb", "depth", "epoch"]);
    for key in ["mark", "qa", "qb"] {
        out["scratch"][key] = json!(ints(&sc[key], n))
    }
    let depth: Vec<_> = expanded(&sc["depth"], n)
        .into_iter()
        .map(|v| i16::try_from(v).unwrap())
        .collect();
    out["scratch"]["depth"] = json!(depth);
    if runtime {
        out["reserved"] = json!(bytes(&v["reserved"], n));
        fields(
            &v["counters"],
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
    }
    out
}
fn snap(rt: &style_runtime::Runtime<'_>) -> Value {
    let mut v = json!(rt.state());
    v["reserved"] = json!(rt.reserved());
    v["counters"] = json!(rt.counters());
    v
}
const CASES: [&str; 18] = [
    "open-1",
    "open-2",
    "open-3",
    "open-4",
    "open-5",
    "open-6",
    "open-7",
    "open-8",
    "full-1",
    "full-4",
    "full-8",
    "wide-64x64",
    "wide-70x110",
    "wide-112x80",
    "decor-off",
    "caps-partial",
    "mask-precedence",
    "empty-zone-and-invalid-spawn-filter",
];
const SOURCE_NAMES: [&str; 77] = [
    "src/abilities.ts",
    "src/achievements.ts",
    "src/blink.ts",
    "src/bushes.ts",
    "src/cards.ts",
    "src/championPassives.ts",
    "src/chestBoosts.ts",
    "src/coliseum.ts",
    "src/combatReadability.ts",
    "src/constants.ts",
    "src/consumables.ts",
    "src/cosmetics.ts",
    "src/detMath.ts",
    "src/effectText.ts",
    "src/effects.ts",
    "src/factions.ts",
    "src/fireRoam.ts",
    "src/fxCodec.ts",
    "src/geometry.ts",
    "src/glossary.ts",
    "src/gridOps.ts",
    "src/gridTopology.ts",
    "src/hpView.ts",
    "src/index.ts",
    "src/interactions.ts",
    "src/interp.ts",
    "src/killAugments.ts",
    "src/map.ts",
    "src/mapWire.ts",
    "src/mapgen.ts",
    "src/mark.ts",
    "src/messages.ts",
    "src/mobStats.ts",
    "src/mobs.ts",
    "src/mods.ts",
    "src/pathfind.ts",
    "src/plagueCorpses.ts",
    "src/planning.ts",
    "src/policies.ts",
    "src/propKinds.ts",
    "src/quests.ts",
    "src/rewards.ts",
    "src/rng.ts",
    "src/rosters.ts",
    "src/rules.ts",
    "src/schema.ts",
    "src/sentencedHunt.ts",
    "src/signatureShares.ts",
    "src/signatures.ts",
    "src/status.ts",
    "src/styler.ts",
    "src/telemetry.ts",
    "src/terrain.ts",
    "src/traders.ts",
    "src/training.ts",
    "src/vision.ts",
    "src/walk.ts",
    "src/weapons.ts",
    "src/wheel.ts",
    "src/zoneStyle/context.ts",
    "src/zoneStyle/features.ts",
    "src/zoneStyle/gallows.ts",
    "src/zoneStyle/hook.ts",
    "src/zoneStyle/index.ts",
    "src/zoneStyle/kit.ts",
    "src/zoneStyle/landmarks.ts",
    "src/zoneStyle/propKinds.ts",
    "src/zoneStyle/rime.ts",
    "src/zoneStyle/sanctum.ts",
    "src/zoneStyle/scale.ts",
    "src/zoneStyle/scorch.ts",
    "src/zoneStyle/styleZones.ts",
    "src/zoneStyle/types.ts",
    "src/zoneStyle/warren.ts",
    "src/zones.ts",
    "test/mapPins.ts",
    "test/zoneStyleOpen.ts",
];
fn inventory(f: &Value) {
    fields(
        f,
        &[
            "format",
            "node",
            "platform",
            "arch",
            "scope",
            "sourceSha256",
            "registry",
            "openPins",
            "generatorControls",
            "cases",
        ],
    );
    assert_eq!(f["format"], "rh-styled-open/1");
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    eq(&json!(ENTRIES), &f["registry"], "actual registry");
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), CASES.len());
    let mut seen = BTreeSet::new();
    for (row, name) in cases.iter().zip(CASES) {
        fields(
            row,
            &[
                "name",
                "input",
                "options",
                "initial",
                "noBlock",
                "noProp",
                "zones",
                "completeCallerStateEquality",
                "completeReportEquality",
                "final",
                "reports",
                "zoneHashes",
            ],
        );
        assert_eq!(row["name"], name);
        assert!(seen.insert(name));
        assert_eq!(row["completeCallerStateEquality"], true);
        assert_eq!(row["completeReportEquality"], true);
    }
    let hashes = f["sourceSha256"].as_object().unwrap();
    assert_eq!(
        hashes.keys().map(String::as_str).collect::<BTreeSet<_>>(),
        SOURCE_NAMES.into_iter().collect()
    );
    for v in hashes.values() {
        let hash = v.as_str().unwrap();
        assert_eq!(hash.len(), 64);
        assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    let pins = f["openPins"].as_array().unwrap();
    assert_eq!(pins.len(), 8);
    for (row, (seed, faction, hash)) in pins.iter().zip([
        (1, "fire", 920272476_u32),
        (2, "fire", 385815520),
        (3, "sentenced", 2758225256),
        (4, "sentenced", 1415584020),
        (5, "plague", 1293505797),
        (6, "plague", 486767237),
        (7, "frost", 2217016722),
        (8, "holy", 1606022005),
    ]) {
        fields(row, &["seed", "faction", "hash", "version"]);
        assert_eq!(row["seed"], seed);
        assert_eq!(row["faction"], faction);
        assert_eq!(row["hash"], hash);
        assert_eq!(row["version"], 400);
    }
    let controls = f["generatorControls"].as_array().unwrap();
    assert_eq!(controls.len(), 2);
    for (c, seed) in controls.iter().zip([1, -1]) {
        fields(
            c,
            &["seed", "attempt", "completeFinalOutputEquality", "hash"],
        );
        assert_eq!(c["seed"], seed);
        assert_eq!(c["attempt"], 0);
        assert_eq!(c["completeFinalOutputEquality"], true);
    }
}
fn zone_hash(state: &State, zone: &[u8], faction: Zone) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for (i, &z) in zone.iter().enumerate() {
        if z == faction.code() {
            hash = (hash ^ u32::from(state.tiles()[i])).wrapping_mul(0x01000193);
            hash = (hash ^ u32::from(state.terrain()[i])).wrapping_mul(0x01000193);
        }
    }
    hash
}
fn replay(registry: &Registry<'_>, row: &Value) -> State {
    let i = &row["input"];
    fields(
        i,
        &[
            "w",
            "h",
            "seed",
            "attempt",
            "featuresPresent",
            "featureOwnerPresent",
            "spawnsPresent",
            "tiles",
            "terrain",
            "props",
            "zone",
            "order",
            "protect",
            "noBlock",
            "noProp",
            "territory",
            "camps",
            "spawns",
            "centreWalk",
            "features",
            "featureOwner",
        ],
    );
    for flag in ["featuresPresent", "featureOwnerPresent", "spawnsPresent"] {
        i[flag].as_bool().expect("presence flag");
    }
    let w = usize::try_from(i["w"].as_u64().unwrap()).unwrap();
    let h = usize::try_from(i["h"].as_u64().unwrap()).unwrap();
    let n = w.checked_mul(h).unwrap();
    assert!(w > 0 && h > 0 && n <= 2_097_152);
    let mut state = State::new(
        w,
        h,
        bytes(&i["tiles"], n),
        bytes(&i["terrain"], n),
        serde_json::from_value(i["props"].clone()).unwrap(),
        serde_json::from_value(i["features"].clone()).unwrap(),
        expanded(&i["featureOwner"], n)
            .into_iter()
            .map(|v| u16::try_from(v).unwrap())
            .collect(),
    )
    .unwrap();
    eq(
        &json!(state),
        &unpack_state(&row["initial"], n, false),
        "fresh source pass state",
    );
    let zone = bytes(&i["zone"], n);
    let protect = bytes(&i["protect"], n);
    let order: Vec<Zone> = serde_json::from_value(i["order"].clone()).unwrap();
    let camps: Vec<StyleCamp> = i["camps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            fields(c, &["site", "r", "territory", "elite"]);
            StyleCamp {
                site: usize::try_from(c["site"].as_u64().unwrap()).unwrap(),
                r: c["r"].as_f64().unwrap(),
                territory: u8::try_from(c["territory"].as_u64().unwrap()).unwrap(),
                elite: c["elite"].as_bool().unwrap(),
            }
        })
        .collect();
    let spawns: Vec<i32> = serde_json::from_value(i["spawns"].clone()).unwrap();
    let territory = (!i["territory"].is_null()).then(|| bytes(&i["territory"], n));
    let no_block = (!i["noBlock"].is_null()).then(|| bytes(&i["noBlock"], n));
    let no_prop = (!i["noProp"].is_null()).then(|| bytes(&i["noProp"], n));
    let walk = (!i["centreWalk"].is_null()).then(|| ints(&i["centreWalk"], n));
    let opts = row["options"].as_object().unwrap();
    assert!(opts.keys().all(|k| ["decor", "caps"].contains(&k.as_str())));
    let caps = opts
        .get("caps")
        .map(|v| serde_json::from_value::<Caps>(v.clone()).unwrap());
    let input = Input {
        w,
        h,
        seed: i["seed"].as_i64().unwrap(),
        attempt: i["attempt"].as_u64().unwrap(),
        order: &order,
        zone: &zone,
        territory: territory.as_deref(),
        camps: &camps,
        protect: &protect,
        spawns: &spawns,
        centre_walk: walk.as_deref(),
        decor: opts.get("decor").is_none_or(|v| v.as_bool().unwrap()),
        no_block: no_block.as_deref(),
        no_prop: no_prop.as_deref(),
        caps: caps.as_ref(),
    };
    eq(
        &json!(style_runtime::no_block(&protect, no_block.as_deref()).unwrap()),
        &json!(bytes(&row["noBlock"], n)),
        "global noBlock precedence",
    );
    eq(
        &json!(no_prop.as_deref().unwrap_or(&protect)),
        &json!(bytes(&row["noProp"], n)),
        "global noProp precedence",
    );
    let zones = row["zones"].as_array().unwrap();
    assert_eq!(zones.len(), order.len());
    let mut geometry_count = vec![0; order.len()];
    let mut starts = vec![0; order.len()];
    let mut phases = vec![0; order.len()];
    let mut dones = vec![0; order.len()];
    let reports = registry
        .apply_observed(&input, &mut state, |event| match event {
            Observation::Geometry { index, geometry } => {
                let z = &zones[index - 1];
                fields(
                    z,
                    &["index", "faction", "geometry", "initial", "phases", "final"],
                );
                assert_eq!(z["index"], index);
                assert_eq!(z["faction"], json!(order[index - 1]));
                let g = &z["geometry"];
                fields(g, &["info", "mask", "edgeDist", "camps"]);
                eq(
                    &json!(geometry.info),
                    &g["info"],
                    "current collision geometry",
                );
                eq(&json!(geometry.mask), &json!(bytes(&g["mask"], n)), "mask");
                eq(
                    &json!(geometry.edge_dist),
                    &json!(ints(&g["edgeDist"], n)),
                    "edge",
                );
                eq(&json!(geometry.camps), &g["camps"], "original camp indices");
                geometry_count[index - 1] += 1;
            }
            Observation::Start { index, runtime } => {
                eq(
                    &snap(runtime),
                    &unpack_state(&zones[index - 1]["initial"], n, true),
                    "shared state at zone start",
                );
                starts[index - 1] += 1;
            }
            Observation::Phase {
                index,
                phase,
                runtime,
                plan,
                streams,
            } => {
                let p = &zones[index - 1]["phases"][phases[index - 1]];
                fields(p, &["stream", "plan", "state", "rng"]);
                let stream = match phase {
                    style_runtime::Phase::Shape => 0,
                    style_runtime::Phase::Decor => 1,
                    style_runtime::Phase::Surface => 2,
                };
                assert_eq!(p["stream"], stream);
                eq(&json!(plan), &p["plan"], "phase plan");
                eq(
                    &snap(runtime),
                    &unpack_state(&p["state"], n, true),
                    "phase complete runtime",
                );
                let r = &p["rng"];
                fields(r, &["stream", "seed", "noiseSeed", "draws", "next"]);
                assert_eq!(r["stream"], stream);
                let draws = r["draws"].as_u64().unwrap();
                assert!(draws <= 1_000_000);
                let seed = crate::rng::hash_seed(
                    input.seed as u32,
                    input.attempt as u32,
                    u32::try_from(index).unwrap(),
                    u32::try_from(stream).unwrap(),
                );
                assert_eq!(u32::try_from(r["seed"].as_u64().unwrap()).unwrap(), seed);
                let mut source_random = crate::rng::Mulberry32::new(seed);
                for _ in 0..draws {
                    source_random.next_f64();
                }
                let source_next: Vec<_> = (0..4).map(|_| source_random.next_f64()).collect();
                eq(
                    &json!(source_next),
                    &r["next"],
                    "source draw count continuation",
                );
                assert_eq!(r["noiseSeed"], streams.noise.stream_seed);
                let mut random = streams.rng.clone();
                let next: Vec<_> = (0..4).map(|_| random.next_f64()).collect();
                eq(&json!(next), &r["next"], "private phase RNG continuation");
                phases[index - 1] += 1;
            }
            Observation::Done { index, runtime } => {
                eq(
                    &snap(runtime),
                    &unpack_state(&zones[index - 1]["final"], n, true),
                    "zone final complete runtime",
                );
                dones[index - 1] += 1;
            }
        })
        .unwrap();
    for k in 0..order.len() {
        assert_eq!(geometry_count[k], 1);
        let active = !zones[k]["initial"].is_null();
        assert_eq!(starts[k], usize::from(active));
        assert_eq!(dones[k], usize::from(active));
        assert_eq!(phases[k], zones[k]["phases"].as_array().unwrap().len());
        if order[k] == Zone::Sentenced {
            assert!(zones[k]["phases"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p["stream"] != 2));
        }
    }
    eq(&json!(reports), &row["reports"], "all source reports");
    eq(
        &json!(state),
        &unpack_state(&row["final"], n, false),
        "shared pass final layers and buffers",
    );
    for faction in [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ] {
        assert_eq!(
            json!(zone_hash(&state, &zone, faction)),
            row["zoneHashes"][faction.as_str()]
        );
    }
    if row["name"].as_str().unwrap().starts_with("open-") {
        assert_eq!(i["featuresPresent"], false);
        assert_eq!(i["featureOwnerPresent"], false);
        assert_eq!(i["spawnsPresent"], false);
    }
    state
}
#[test]
fn complete_source_open_full_wide_options_and_original_pins() {
    let f = fixture();
    inventory(&f);
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let registry = Registry::new(&fixed).unwrap();
    for row in f["cases"].as_array().unwrap() {
        eprintln!("{}", row["name"]);
        replay(&registry, row);
    }
}

#[test]
fn malformed_fixture_controls_fail_closed() {
    let f = fixture();
    for mutation in 0..5 {
        let mut bad = f.clone();
        match mutation {
            0 => {
                bad["cases"] = json!([]);
            }
            1 => {
                bad["cases"][1] = bad["cases"][0].clone();
            }
            2 => {
                let hashes = bad["sourceSha256"].as_object_mut().unwrap();
                let value = hashes.remove(SOURCE_NAMES[0]).unwrap();
                hashes.insert("unknown.ts".into(), value);
            }
            3 => {
                bad["openPins"][0]["hash"] = json!(0);
            }
            _ => {
                bad["cases"][0].as_object_mut().unwrap().remove("initial");
            }
        }
        assert!(std::panic::catch_unwind(|| inventory(&bad)).is_err());
    }
    for raw in [r#"{"a":1,"a":2}"#, r#"{"a":{"b":1,"b":2}}"#] {
        assert!(serde_json::from_str::<UniqueValue>(raw).is_err());
    }
    for (raw, n) in [
        (json!([[256, 1]]), 1),
        (json!([[-1, 1]]), 1),
        (json!([[0, 0]]), 1),
        (json!([]), 1),
    ] {
        assert!(std::panic::catch_unwind(|| bytes(&raw, n)).is_err());
    }
    assert!(std::panic::catch_unwind(|| ints(&json!([[2147483648_i64, 1]]), 1)).is_err());
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let registry = Registry::new(&fixed).unwrap();
    for key in ["noBlock", "territory", "centreWalk", "featuresPresent"] {
        let mut bad = f["cases"][0].clone();
        bad["input"].as_object_mut().unwrap().remove(key);
        assert!(std::panic::catch_unwind(|| replay(&registry, &bad)).is_err());
    }
    for raw in [
        json!({"joinChecks":null}),
        json!({"fenceDetour":65536}),
        json!({"unknown":1}),
    ] {
        assert!(serde_json::from_value::<Caps>(raw).is_err());
    }
}
#[test]
fn input_refusals_leave_all_state_unchanged_and_pass_reset_is_fresh() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let registry = Registry::new(&fixed).unwrap();
    let (w, h) = (80, 320);
    let n = w * h;
    let mut state = State::new(w, h, vec![0; n], vec![0; n], vec![], vec![], vec![0; n]).unwrap();
    let zone: Vec<_> = (0..n).map(|i| if i / w < 160 { 1 } else { 2 }).collect();
    let protect = vec![0; n];
    let camps = [StyleCamp {
        site: 80 * 80 + 40,
        r: 8.0,
        territory: 1,
        elite: false,
    }];
    let mut input = Input {
        w,
        h,
        seed: 1,
        attempt: 0,
        order: &[Zone::Fire, Zone::Frost],
        zone: &zone,
        territory: None,
        camps: &camps,
        protect: &protect,
        spawns: &[],
        centre_walk: None,
        decor: true,
        no_block: None,
        no_prop: None,
        caps: None,
    };
    let before = state.clone();
    assert_eq!(
        registry.apply(&input, &mut state).unwrap_err(),
        Error::Definition
    );
    assert_eq!(state, before);
    input.order = &[Zone::Fire];
    let bad_caps = Caps {
        rim_tiles: Some(f64::NAN),
        ..Caps::default()
    };
    input.caps = Some(&bad_caps);
    assert!(registry.apply(&input, &mut state).is_err());
    assert_eq!(state, before);
    input.caps = None;
    // The same malformed Forge box used by the existing Fire admission must refuse before shape.
    let feature = crate::mapdata::MapFeature {
        kind: crate::mapdata::FeatureKind::Landmark,
        variant: "forge".into(),
        zone: Zone::Fire,
        jobs: vec![],
        ax: 0,
        ay: 0,
        p: vec![],
        bbox: crate::mapdata::TileRect {
            x: -1,
            y: 0,
            w: 2,
            h: 2,
        },
        tiles: 0,
    };
    let mut malformed = State::new(
        w,
        h,
        vec![0; n],
        vec![0; n],
        vec![],
        vec![feature],
        vec![0; n],
    )
    .unwrap();
    let original = malformed.clone();
    assert_eq!(
        registry.apply(&input, &mut malformed).unwrap_err(),
        Error::Feature
    );
    assert_eq!(malformed, original);
    registry.apply(&input, &mut state).unwrap();
    let mut fresh = State::new(
        w,
        h,
        state.tiles().to_vec(),
        state.terrain().to_vec(),
        state.props().to_vec(),
        state.features().to_vec(),
        state.feature_owner().to_vec(),
    )
    .unwrap();
    let a = registry.apply(&input, &mut state).unwrap();
    let b = registry.apply(&input, &mut fresh).unwrap();
    eq(&json!(a), &json!(b), "repeated pass reports");
    assert_eq!(state, fresh);
}
#[test]
fn registry_metadata_identity_visits_each_field_and_row() {
    let mut baseline = vec![];
    visit_content(|w| baseline.push(w));
    for index in 0..ENTRIES.len() {
        for field in 0..5 {
            let mut entries = ENTRIES;
            match field {
                0 => {
                    entries[index].faction = if entries[index].faction == Zone::Fire {
                        Zone::Holy
                    } else {
                        Zone::Fire
                    }
                }
                1 => entries[index].id = "other",
                2 => entries[index].version += 1,
                3 => entries[index].surface = !entries[index].surface,
                _ => entries[index].props = !entries[index].props,
            }
            let mut changed = vec![];
            visit_entries(&entries, |w| changed.push(w));
            assert_ne!(baseline, changed);
        }
    }
    let mut changed = vec![];
    visit_entries(&ENTRIES[..4], |w| changed.push(w));
    assert_ne!(baseline, changed);
    let mut entries = ENTRIES;
    entries.swap(0, 1);
    changed.clear();
    visit_entries(&entries, |w| changed.push(w));
    assert_ne!(baseline, changed);
}

#[test]
fn malformed_watchtower_refuses_before_earlier_fire_writes() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let registry = Registry::new(&fixed).unwrap();
    let (w, h) = (96, 96);
    let n = w * h;
    let f = crate::mapdata::MapFeature {
        kind: crate::mapdata::FeatureKind::Landmark,
        variant: "watchtower".into(),
        zone: Zone::Frost,
        jobs: vec![],
        ax: 2,
        ay: 2,
        p: vec![],
        bbox: crate::mapdata::TileRect {
            x: -1,
            y: 2,
            w: 3,
            h: 3,
        },
        tiles: 0,
    };
    let mut state = State::new(w, h, vec![0; n], vec![0; n], vec![], vec![f], vec![0; n]).unwrap();
    let before = state.clone();
    let zone: Vec<_> = (0..n).map(|i| if i < n / 2 { 1 } else { 2 }).collect();
    let protect = vec![0; n];
    let input = Input {
        w,
        h,
        seed: 1,
        attempt: 0,
        order: &[Zone::Fire, Zone::Frost],
        zone: &zone,
        territory: None,
        camps: &[],
        protect: &protect,
        spawns: &[],
        centre_walk: None,
        decor: true,
        no_block: None,
        no_prop: None,
        caps: None,
    };
    assert_eq!(
        registry.apply(&input, &mut state).unwrap_err(),
        Error::Feature
    );
    assert_eq!(state, before);
}
