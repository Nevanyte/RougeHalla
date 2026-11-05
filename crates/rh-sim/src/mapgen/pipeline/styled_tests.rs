//! Original styled pins compare complete source maps, including ordered decor and independent hard checks.
use super::*;
use crate::mapgen::{certify, map_hash};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StyledFixture {
    format: String,
    node: String,
    platform: String,
    arch: String,
    sources: BTreeMap<String, String>,
    pins_file_sha256: String,
    pin_styler_versions: BTreeMap<String, u64>,
    backbone: Backbone,
    pins: Vec<StyledPin>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Backbone {
    file: String,
    sha256: String,
    verified_actual_bare_maps: usize,
    verified_decor_only_changes_props: usize,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StyledPin {
    seed: i64,
    pin: String,
    backbone_case: String,
    props: Vec<MapProp>,
}
fn digest(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}
fn structure(f: &StyledFixture) -> Result<(), &'static str> {
    if f.format != "rh-map-styled-pipeline/1"
        || (&*f.node, &*f.platform, &*f.arch) != ("v22.23.4", "linux", "x64")
        || f.sources.len() != 75
        || !f.sources.contains_key("mapgen.ts")
        || f.sources
            .values()
            .any(|h| h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()))
        || f.pins_file_sha256 != "cc1e7c0682f9426ecef97c8b4e8df70c307319456a0b64562d171074410d1d45"
        || f.pin_styler_versions
            != BTreeMap::from([
                ("fire".into(), 400),
                ("sentenced".into(), 400),
                ("plague".into(), 400),
                ("frost".into(), 400),
                ("holy".into(), 400),
            ])
        || f.backbone.file != "map-certify.json"
        || f.backbone.sha256 != "600267af8d96cb0078181818d445c93e9848e2f4cfdbbba6f1480ea8dcf13716"
        || f.backbone.verified_actual_bare_maps != 200
        || f.backbone.verified_decor_only_changes_props != 200
        || f.pins.len() != 200
    {
        return Err("styled fixture provenance/inventory");
    }
    for (seed, pin) in f.pins.iter().enumerate() {
        if pin.seed != seed as i64
            || pin.backbone_case != format!("generated-{seed}-strict")
            || pin.pin.split(':').count() != 3
            || pin.pin.split(':').next() != Some(seed.to_string().as_str())
            || pin.props.is_empty()
            || pin
                .props
                .iter()
                .any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return Err("styled pin inventory");
        }
    }
    if f.pins.iter().map(|p| p.props.len()).sum::<usize>() != 160_996 {
        return Err("styled ordered decor inventory");
    }
    Ok(())
}
fn captured() -> StyledFixture {
    let raw = include_str!("../fixtures/map-styled-pipeline.json");
    assert_eq!(
        digest(raw.as_bytes()),
        0xa8c0915abfd37a33,
        "reviewed source styled bytes"
    );
    let fixture: StyledFixture = serde_json::from_str(raw).unwrap();
    structure(&fixture).unwrap();
    fixture
}
#[test]
fn all_original_styled_pins_complete_decorated_dtos_and_hard_certificates() {
    let fixture = captured();
    let raw = include_str!("../fixtures/map-certify.json");
    assert_eq!(
        digest(raw.as_bytes()),
        0xba35662e930bfb76,
        "reviewed canonical DTO backbone bytes"
    );
    let backbone: Value = serde_json::from_str(raw).unwrap();
    assert_eq!(backbone["format"], "rh-map-certify/1");
    assert_eq!(backbone["sourceSeedCount"], 200);
    let cases = backbone["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 307);
    let mut by_name = BTreeMap::new();
    for case in cases {
        assert!(
            by_name
                .insert(case["name"].as_str().unwrap(), case)
                .is_none(),
            "duplicate backbone case"
        );
    }
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let pipeline = Pipeline::new(&fixed);
    for pin in fixture.pins {
        let case = by_name[pin.backbone_case.as_str()];
        assert!(case["failures"].as_array().unwrap().is_empty());
        let mut expected = unpack(case["map"].clone());
        assert!(expected.props.is_empty());
        expected.props = pin.props;
        let actual = pipeline
            .certified_styled(pin.seed, Options::default())
            .unwrap_or_else(|e| panic!("styled seed {}: {e:?}", pin.seed))
            .unwrap_or_else(|| panic!("styled pinned seed {} refused all attempts", pin.seed));
        assert_eq!(
            format!(
                "{}:{}:{}",
                pin.seed,
                actual.attempt,
                map_hash::map_hash(&actual)
            ),
            pin.pin,
            "original styled pin {}",
            pin.seed
        );
        if actual != expected {
            let got = serde_json::to_value(&actual).unwrap();
            let wanted = serde_json::to_value(&expected).unwrap();
            let fields: Vec<_> = wanted
                .as_object()
                .unwrap()
                .keys()
                .filter(|key| got[*key] != wanted[*key])
                .collect();
            panic!(
                "complete styled DTO differs for seed {}: fields {fields:?}",
                pin.seed
            );
        }
        for (zone, strict) in [(false, certify::Strict::None), (true, certify::Strict::All)] {
            let certificate = certify::certify(
                &actual,
                &certify::Options {
                    styled: true,
                    zone,
                    strict,
                },
            )
            .unwrap();
            assert!(
                certificate.failures.is_empty(),
                "styled hard checks seed {} zone={zone}: {:?}",
                pin.seed,
                certificate.failures
            );
        }
    }
}
#[test]
fn styled_fixture_rejects_missing_duplicate_reordered_unknown_or_drifted_evidence() {
    let f = captured();
    let mut changed = f.clone();
    changed.pins.pop();
    assert!(structure(&changed).is_err());
    let mut changed = f.clone();
    changed.pins[1] = changed.pins[0].clone();
    assert!(structure(&changed).is_err());
    let mut changed = f.clone();
    changed.pins.swap(0, 1);
    assert!(structure(&changed).is_err());
    let mut changed = f.clone();
    changed.sources.clear();
    assert!(structure(&changed).is_err());
    let mut changed = f.clone();
    changed.backbone.sha256.replace_range(..1, "f");
    assert!(structure(&changed).is_err());
    let mut changed = f;
    changed.pins[0].props.clear();
    assert!(structure(&changed).is_err());
    assert!(serde_json::from_str::<StyledPin>(
        r#"{"seed":0,"seed":0,"pin":"0:0:a","backboneCase":"x","props":[]}"#
    )
    .is_err());
    assert!(serde_json::from_str::<StyledPin>(
        r#"{"seed":0,"pin":"0:0:a","backboneCase":"x","props":[],"extra":0}"#
    )
    .is_err());
    assert!(
        serde_json::from_str::<StyledPin>(r#"{"seed":0,"pin":"0:0:a","backboneCase":"x"}"#)
            .is_err()
    );
    assert!(serde_json::from_str::<StyledPin>(
        r#"{"seed":0,"pin":"0:0:a","backboneCase":"x","props":[{"kind":1,"x":0,"x":1,"y":0}]}"#
    )
    .is_err());
}
