use super::*;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
#[path = "styled_tests.rs"]
mod styled;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    format: String,
    node: String,
    platform: String,
    arch: String,
    sources: BTreeMap<String, String>,
    pins_file_sha256: String,
    pin_styler_versions: BTreeMap<String, u64>,
    pins: Vec<Pin>,
    cases: Vec<Case>,
    wrappers: Vec<Wrapper>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pin {
    seed: i64,
    pin: String,
    map: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    seed: i64,
    attempt: u64,
    options: Options,
    complete_final_output_equality: bool,
    hash: Option<String>,
    map: Option<Value>,
    trace: Vec<Trace>,
    failures: BTreeMap<String, u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Wrapper {
    seed: i64,
    map: Value,
    hash: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Packed {
    rle: Vec<[u64; 2]>,
}
fn decode(v: Value) -> Result<Vec<u8>, &'static str> {
    let p: Packed = serde_json::from_value(v).map_err(|_| "codec shape")?;
    let mut out = Vec::new();
    let mut last = None;
    for [value, count] in p.rle {
        if value > 255
            || count == 0
            || count > W as u64 * H as u64
            || last == Some(value)
            || out.len() + count as usize > W * H
        {
            return Err("codec run");
        }
        out.extend(std::iter::repeat_n(value as u8, count as usize));
        last = Some(value);
    }
    if out.len() != W * H {
        return Err("codec length");
    }
    Ok(out)
}
fn unpack(mut v: Value) -> GameMapData {
    for key in [
        "tiles",
        "terrain",
        "regionGrid",
        "territoryGrid",
        "featureGrid",
    ] {
        v[key] = serde_json::to_value(decode(v[key].take()).unwrap()).unwrap();
    }
    serde_json::from_value(v).unwrap()
}
fn fixture() -> Fixture {
    let f: Fixture =
        serde_json::from_str(include_str!("../fixtures/map-plain-pipeline.json")).unwrap();
    assert_eq!(f.format, "rh-map-plain-pipeline/1");
    assert_eq!(
        (&*f.node, &*f.platform, &*f.arch),
        ("v22.23.4", "linux", "x64")
    );
    assert_eq!(f.sources.len(), 75);
    assert!(
        f.sources.contains_key("mapgen.ts")
            && f.sources
                .values()
                .all(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
    );
    assert_eq!(
        f.pins_file_sha256,
        "cc1e7c0682f9426ecef97c8b4e8df70c307319456a0b64562d171074410d1d45"
    );
    assert_eq!(
        f.pin_styler_versions,
        BTreeMap::from([
            ("fire".into(), 400),
            ("sentenced".into(), 400),
            ("plague".into(), 400),
            ("frost".into(), 400),
            ("holy".into(), 400)
        ])
    );
    assert_eq!(
        (f.pins.len(), f.cases.len(), f.wrappers.len()),
        (200, 11, 2)
    );
    f
}
fn plain_options() -> Options {
    Options {
        decor: false,
        ..Options::default()
    }
}
#[test]
fn smoke_complete_map() {
    let f = fixture();
    let fixed = super::super::coliseum::fixed_layout();
    let p = Pipeline::new(&fixed);
    let expected = unpack(f.pins[1].map.clone());
    let map = p.plain_attempt(1, 0, plain_options()).unwrap().unwrap();
    assert_eq!(super::super::map_hash::map_hash(&map), "b94d0723");
    assert_eq!(map, expected);
    assert!(map
        .features
        .iter()
        .any(|f| f.kind == crate::mapdata::FeatureKind::Landmark));
    assert!(map
        .features
        .iter()
        .any(|f| f.kind == crate::mapdata::FeatureKind::Bush));
}
#[test]
fn all_original_plain_pins_full_maps_and_independent_hard_checks() {
    let f = fixture();
    let fixed = super::super::coliseum::fixed_layout();
    let p = Pipeline::new(&fixed);
    for (seed, c) in f.pins.into_iter().enumerate() {
        assert_eq!(c.seed, seed as i64);
        let expected = unpack(c.map);
        let actual = p.certified_plain(c.seed, plain_options()).unwrap().unwrap();
        assert_eq!(
            format!(
                "{}:{}:{}",
                seed,
                actual.attempt,
                super::super::map_hash::map_hash(&actual)
            ),
            c.pin,
            "original plain pin {seed}"
        );
        assert_eq!(actual, expected, "full source plain map {seed}");
        // Independent, separately authored certifier: unstyled invariants plus the additional zone-floor checks.
        for zone in [false, true] {
            let certificate = super::super::certify::certify(
                &actual,
                &super::super::certify::Options {
                    styled: false,
                    zone,
                    strict: super::super::certify::Strict::None,
                },
            )
            .unwrap();
            assert!(
                certificate.failures.is_empty(),
                "independent plain hard checks seed {seed}, zone={zone}: {:?}",
                certificate.failures
            );
        }
    }
}
#[test]
fn actual_phase_streams_options_null_and_retry_wrappers() {
    let f = fixture();
    let fixed = super::super::coliseum::fixed_layout();
    let p = Pipeline::new(&fixed);
    let expected_ids = [
        (0, 0),
        (1, 0),
        (17, 1),
        (-1, 0),
        (4294967297, 4294967296),
        (9007199254740991, 9007199254740991),
        (1, 0),
        (1, 0),
        (1, 0),
        (2459, 0),
        (2459, 1),
    ];
    let mut refused = 0;
    let mut phases = 0;
    for (index, (case, id)) in f.cases.into_iter().zip(expected_ids).enumerate() {
        assert_eq!((case.seed, case.attempt), id);
        assert_eq!(
            case.options,
            Options {
                decor: index == 6,
                shape_gates: index != 7,
                bushes: index != 8
            }
        );
        if case.map.is_some() {
            assert_eq!(
                case.trace.iter().map(|t| t.phase).collect::<Vec<_>>(),
                vec![
                    Phase::Prefix,
                    Phase::Landmarks,
                    Phase::Spawns,
                    Phase::Nets,
                    Phase::Crates,
                    Phase::Post,
                    Phase::Terrain,
                    Phase::Ground,
                    Phase::Bushes,
                    Phase::SpawnGate,
                    Phase::Records,
                    Phase::Gates
                ]
            );
        } else {
            assert!(case.trace.is_empty());
        }
        assert!(case.failures.iter().all(|(key, &n)| n > 0
            && ["zoneSliver", "campRadius", "camps", "A:camps"].contains(&key.as_str())));
        assert!(case.complete_final_output_equality);
        assert_eq!(case.map.is_none(), case.hash.is_none());
        let (actual, trace) = p
            .plain_attempt_with_trace(case.seed, case.attempt, case.options)
            .unwrap();
        assert_eq!(
            trace, case.trace,
            "phase/RNG/original pool seed {} attempt {}",
            case.seed, case.attempt
        );
        phases += trace.len();
        if let Some(expected) = case.map {
            assert!(actual.refusal.is_none());
            let map = actual.map.unwrap();
            assert_eq!(super::super::map_hash::map_hash(&map), case.hash.unwrap());
            assert_eq!(map, unpack(expected));
        } else {
            refused += 1;
            assert!(actual.map.is_none());
            assert_eq!(actual.refusal, Some(Refusal::Prefix));
            assert_eq!(case.failures.get("A:camps"), Some(&1));
        }
    }
    assert_eq!((refused, phases), (1, 120));
    for (c, seed) in f.wrappers.into_iter().zip([1, 2459]) {
        assert_eq!(c.seed, seed);
        let certified = p.certified_plain(seed, plain_options()).unwrap().unwrap();
        let generated = p.generate_plain(seed, None, plain_options()).unwrap();
        assert_eq!(certified, generated);
        assert_eq!(certified, unpack(c.map));
        assert_eq!(super::super::map_hash::map_hash(&certified), c.hash);
        assert_eq!(certified.attempt, u64::from(seed == 2459));
    }
    assert!(matches!(
        p.generate_plain(2459, Some(0), plain_options()),
        Err(Error::AttemptRefused(Refusal::Prefix))
    ));
}
#[test]
fn wrapper_bounds_and_input_errors_are_explicit() {
    for limit in [16, 64] {
        let mut seen = Vec::new();
        let out = first_attempt::<u64, ()>(limit, |n| {
            seen.push(n);
            Ok(None)
        })
        .unwrap();
        assert_eq!(out, None);
        assert_eq!(seen, (0..limit).collect::<Vec<_>>());
        let mut seen = Vec::new();
        let out = first_attempt::<u64, ()>(limit, |n| {
            seen.push(n);
            Ok((n == limit - 1).then_some(n))
        })
        .unwrap();
        assert_eq!(out, Some(limit - 1));
        assert_eq!(seen.len(), limit as usize);
    }
    let mut calls = Vec::new();
    assert_eq!(
        first_attempt::<u64, ()>(64, |n| {
            calls.push(n);
            Ok((n == 2).then_some(n))
        }),
        Ok(Some(2))
    );
    assert_eq!(calls, vec![0, 1, 2]);
    let mut seen = Vec::new();
    assert_eq!(
        first_attempt::<u64, &str>(64, |n| {
            seen.push(n);
            if n == 2 {
                Err("typed")
            } else {
                Ok(None)
            }
        }),
        Err("typed")
    );
    assert_eq!(seen, vec![0, 1, 2]);
    let fixed = super::super::coliseum::fixed_layout();
    let p = Pipeline::new(&fixed);
    assert!(matches!(
        p.plain_attempt(i64::MAX, 0, Options::default()),
        Err(Error::Input(attempt::AttemptInputError::SeedNotSafeInteger))
    ));
    assert!(matches!(
        p.plain_attempt(1, u64::MAX, Options::default()),
        Err(Error::Input(
            attempt::AttemptInputError::AttemptNotSafeInteger
        ))
    ));
    let mut d = default_definition();
    d.certified_attempts = 1;
    let one = Pipeline::from_definition(&fixed, &d).unwrap();
    assert!(one
        .certified_plain(2459, plain_options())
        .unwrap()
        .is_none());
    assert_eq!(
        one.generate_plain(2459, None, plain_options())
            .unwrap()
            .attempt,
        1
    );
    let original = default_definition();
    let mut d = original;
    d.features_max = 0;
    let mut a = Vec::new();
    let mut b = Vec::new();
    visit_content(&original, |w| a.push(w));
    visit_content(&d, |w| b.push(w));
    assert_ne!(a, b);
    let limited = Pipeline::from_definition(&fixed, &d).unwrap();
    let (r, t) = limited
        .plain_attempt_with_trace(1, 0, plain_options())
        .unwrap();
    assert_eq!(r.refusal, Some(Refusal::Features));
    assert_eq!(t.last().unwrap().phase, Phase::SpawnGate);
}
#[test]
fn strict_lossless_codec_rejects_malformed_or_empty_layers() {
    for bad in [
        serde_json::json!({"rle":[]}),
        serde_json::json!({"rle":[[0,0]]}),
        serde_json::json!({"rle":[[256,25600]]}),
        serde_json::json!({"rle":[[0,12800],[0,12800]]}),
        serde_json::json!({"rle":[[0,25601]]}),
        serde_json::json!({"rle":[[0,25600]],"extra":1}),
    ] {
        assert!(decode(bad).is_err());
    }
    assert_eq!(
        decode(serde_json::json!({"rle":[[0,25600]]})).unwrap(),
        vec![0; 25600]
    );
}

#[path = "styled_controls.rs"]
mod styled_controls;
