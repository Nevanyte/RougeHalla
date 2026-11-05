//! Complete source attempts and observational main-stream traces, including refusal/retry and option controls.
use super::*;
use serde_json::json;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Controls {
    format: String,
    node: String,
    platform: String,
    arch: String,
    sources: BTreeMap<String, String>,
    pins_file_sha256: String,
    pin_styler_versions: BTreeMap<String, u64>,
    cases: Vec<ControlCase>,
    wrappers: Vec<Wrapper>,
    explicit: Vec<Explicit>,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ControlCase {
    seed: i64,
    attempt: u64,
    options: Options,
    complete_final_output_equality: bool,
    #[serde(deserialize_with = "required_option")]
    hash: Option<String>,
    #[serde(deserialize_with = "required_option")]
    map: Option<Value>,
    trace: Vec<Trace>,
    failures: BTreeMap<String, u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Explicit {
    seed: i64,
    attempt: u64,
    options: Options,
    #[serde(deserialize_with = "required_option")]
    map: Option<Value>,
    #[serde(deserialize_with = "required_option")]
    hash: Option<String>,
    #[serde(deserialize_with = "required_option")]
    error: Option<String>,
}
const SOURCE_FILES: [&str; 75] = [
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
const INPUTS: [(i64, u64, bool, bool, bool); 16] = [
    (200, 0, true, true, true),
    (201, 1, true, true, true),
    (1337, 0, false, true, true),
    (-2147483648, 2, true, true, true),
    (4294967301, 4294967297, true, true, true),
    (9007199254740991, 9007199254740991, true, true, true),
    (2459, 0, true, true, true),
    (2459, 1, true, true, true),
    (200, 0, false, true, true),
    (200, 0, true, false, true),
    (200, 0, true, true, false),
    (200, 0, false, false, false),
    (7, 2, true, true, true),
    (41, 1, true, true, true),
    (97, 3, true, true, true),
    (-1, 0, true, true, true),
];
fn inventory(f: &Controls) -> Result<(), &'static str> {
    if f.format != "rh-map-styled-controls/1"
        || (&*f.node, &*f.platform, &*f.arch) != ("v22.23.4", "linux", "x64")
        || f.sources.len() != 75
        || f.sources.keys().map(String::as_str).ne(SOURCE_FILES)
        || f.sources
            .values()
            .any(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
        || f.pins_file_sha256 != "cc1e7c0682f9426ecef97c8b4e8df70c307319456a0b64562d171074410d1d45"
        || f.pin_styler_versions
            != BTreeMap::from([
                ("fire".into(), 400),
                ("sentenced".into(), 400),
                ("plague".into(), 400),
                ("frost".into(), 400),
                ("holy".into(), 400),
            ])
        || f.cases.len() != 16
        || f.wrappers.len() != 2
        || f.explicit.len() != 7
    {
        return Err("controls provenance/inventory");
    }
    for (index, (c, &(seed, attempt, decor, shape_gates, bushes))) in
        f.cases.iter().zip(&INPUTS).enumerate()
    {
        if (c.seed, c.attempt) != (seed, attempt)
            || c.options
                != (Options {
                    decor,
                    shape_gates,
                    bushes,
                })
            || !c.complete_final_output_equality
            || c.map.is_none() != (index == 6)
            || c.hash.is_none() != (index == 6)
            || c.trace.len() != if index == 6 { 0 } else { 13 }
        {
            return Err("controls actual inventory");
        }
        if c.hash
            .as_ref()
            .is_some_and(|h| h.len() != 8 || !h.bytes().all(|b| b.is_ascii_hexdigit()))
            || c.failures.iter().any(|(k, &n)| {
                n == 0 || !["zoneSliver", "campRadius", "camps", "A:camps"].contains(&k.as_str())
            })
        {
            return Err("controls result metadata");
        }
    }
    for (c, seed) in f.wrappers.iter().zip([200, 2459]) {
        if c.seed != seed
            || c.hash.len() != 8
            || !c.hash.bytes().all(|b| b.is_ascii_hexdigit())
            || !c.map.is_object()
        {
            return Err("wrapper inventory");
        }
    }
    for (c, index) in f.explicit.iter().zip([0, 6, 7, 8, 9, 10, 11]) {
        let r = &f.cases[index];
        if (c.seed, c.attempt, c.options) != (r.seed, r.attempt, r.options)
            || c.map != r.map
            || c.hash != r.hash
            || c.error.as_deref()
                != if index == 6 {
                    Some("Error: generateMap: attempt 0 of seed 2459 does not certify")
                } else {
                    None
                }
        {
            return Err("explicit wrapper inventory");
        }
    }
    Ok(())
}
fn validated(v: Value) -> Result<Controls, String> {
    let f: Controls = serde_json::from_value(v).map_err(|e| e.to_string())?;
    inventory(&f).map_err(str::to_string)?;
    Ok(f)
}
fn controls() -> Value {
    let raw = include_str!("../fixtures/map-styled-controls.json");
    let digest = raw.bytes().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(
        digest, 0x74b3a6938acd7e85,
        "canonical controls byte integrity"
    );
    let v = serde_json::from_str::<UniqueValue>(raw).unwrap().0;
    validated(v.clone()).unwrap();
    v
}
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

#[test]
fn actual_styled_source_options_streams_and_wrappers() {
    let f = controls();
    assert_eq!(f["format"], "rh-map-styled-controls/1");
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let p = Pipeline::new(&fixed);
    let cases: Vec<Case> = serde_json::from_value(f["cases"].clone()).unwrap();
    let ids = [
        (200, 0),
        (201, 1),
        (1337, 0),
        (-2147483648, 2),
        (4294967301, 4294967297),
        (9007199254740991, 9007199254740991),
        (2459, 0),
        (2459, 1),
        (200, 0),
        (200, 0),
        (200, 0),
        (200, 0),
        (7, 2),
        (41, 1),
        (97, 3),
        (-1, 0),
    ];
    assert_eq!(cases.len(), ids.len());
    let mut phases = 0;
    let mut nulls = 0;
    for (case, id) in cases.into_iter().zip(ids) {
        assert_eq!((case.seed, case.attempt), id);
        assert!(case.complete_final_output_equality);
        let (report, trace) = p
            .styled_attempt_with_trace(case.seed, case.attempt, case.options)
            .unwrap();
        assert_eq!(trace, case.trace, "phase continuation/pool {id:?}");
        phases += trace.len();
        match case.map {
            Some(expected) => {
                assert!(report.refusal.is_none());
                let actual = report.map.unwrap();
                assert_eq!(
                    crate::mapgen::map_hash::map_hash(&actual),
                    case.hash.unwrap()
                );
                assert_eq!(actual, unpack(expected), "complete DTO {id:?}");
                if case.options.shape_gates && case.options.bushes {
                    for zone in [false, true] {
                        let cert = crate::mapgen::certify::certify(
                            &actual,
                            &crate::mapgen::certify::Options {
                                styled: true,
                                zone,
                                strict: crate::mapgen::certify::Strict::All,
                            },
                        )
                        .unwrap();
                        assert!(
                            cert.failures.is_empty(),
                            "hard cert {id:?}: {:?}",
                            cert.failures
                        );
                    }
                }
            }
            None => {
                nulls += 1;
                assert!(report.map.is_none());
                assert_eq!(report.refusal, Some(Refusal::Prefix));
                assert_eq!(case.failures.get("A:camps"), Some(&1));
            }
        }
    }
    assert_eq!((phases, nulls), (195, 1));
    let wrappers: Vec<Wrapper> = serde_json::from_value(f["wrappers"].clone()).unwrap();
    assert_eq!(wrappers.len(), 2);
    for (c, seed) in wrappers.into_iter().zip([200, 2459]) {
        assert_eq!(c.seed, seed);
        let options = Options {
            decor: false,
            ..Options::default()
        };
        let map = p.certified_styled(seed, options).unwrap().unwrap();
        assert_eq!(map, p.generate_styled(seed, None, options).unwrap());
        assert_eq!(map, unpack(c.map));
        assert_eq!(crate::mapgen::map_hash::map_hash(&map), c.hash);
        assert_eq!(map.attempt, u64::from(seed == 2459));
    }
    let explicit = f["explicit"].as_array().unwrap();
    assert_eq!(explicit.len(), 7);
    for row in explicit {
        let seed = row["seed"].as_i64().unwrap();
        let attempt = row["attempt"].as_u64().unwrap();
        let options: Options = serde_json::from_value(row["options"].clone()).unwrap();
        let actual = p.generate_styled(seed, Some(attempt), options);
        if row["error"].is_null() {
            let map = actual.unwrap();
            assert_eq!(map, unpack(row["map"].clone()));
            assert_eq!(crate::mapgen::map_hash::map_hash(&map), row["hash"]);
        } else {
            assert!(matches!(
                actual,
                Err(Error::AttemptRefused(Refusal::Prefix))
            ));
        }
    }
}

#[test]
fn controls_refuse_missing_duplicate_unknown_and_narrowed_evidence() {
    let f = controls();
    for key in ["cases", "wrappers", "explicit"] {
        let mut b = f.clone();
        b[key] = json!([]);
        assert!(validated(b).is_err());
        let mut b = f.clone();
        b[key][1] = b[key][0].clone();
        assert!(validated(b).is_err());
    }
    for which in 0..7 {
        let mut b = f.clone();
        match which {
            0 => b["cases"][0]["attempt"] = json!(u64::MAX),
            1 => b["cases"][0]["seed"] = json!(u64::MAX),
            2 => b["cases"][0]["trace"][0]["continuation"][0] = json!(4294967296_u64),
            3 => b["cases"][0]["options"]["unknown"] = json!(true),
            4 => b["unknown"] = json!(0),
            5 => b["cases"][0]
                .as_object_mut()
                .unwrap()
                .remove("map")
                .map(|_| ())
                .unwrap(),
            _ => b["sources"] = json!({}),
        };
        assert!(validated(b).is_err());
    }
    for (section, index, key) in [
        ("cases", 6, "map"),
        ("cases", 6, "hash"),
        ("explicit", 0, "error"),
        ("explicit", 1, "map"),
        ("explicit", 1, "hash"),
    ] {
        let mut bad = f.clone();
        bad[section][index].as_object_mut().unwrap().remove(key);
        assert!(validated(bad).is_err());
    }
    let mut renamed = f.clone();
    let value = renamed["sources"]
        .as_object_mut()
        .unwrap()
        .remove("bushes.ts")
        .unwrap();
    renamed["sources"]["unknown.ts"] = value;
    assert!(validated(renamed).is_err());
    for raw in [r#"{"a":1,"a":2}"#, r#"{"x":[{"seed":1,"seed":2}]}"#] {
        assert!(serde_json::from_str::<UniqueValue>(raw).is_err());
    }
}
