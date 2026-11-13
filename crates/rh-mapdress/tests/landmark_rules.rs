//! P-DRESS-ANCHOR-1, the rule file: the `signature.landmark` block (landmark kind plus rings named by the generator's
//! bands). `rules_file.rs` is untouched; its checks of the legacy `signature.feature` and `rings` keep holding because
//! those keys are the fallback path. Tests marked GUARD pass on the stub.
use rh_mapdress::rules::{Band, Rules};
use rh_sim::mapdata::{FeatureKind, Zone};
use serde_json::{json, Value};

const STARTER: &str = include_str!("../rules/zones.json");
/// A copy of `rules/zones.json` as it was before this packet (schema without `landmark`).
const LEGACY: &str = include_str!("fixtures/zones_v1_legacy.json");

/// Per zone: the landmark kind the rules name, and the legacy fallback kind (`signature.feature`, unchanged).
const KINDS: [(Zone, &str, FeatureKind, FeatureKind); 5] = [
    (
        Zone::Fire,
        "fire",
        FeatureKind::Volcano,
        FeatureKind::Crater,
    ),
    (
        Zone::Sentenced,
        "sentenced",
        FeatureKind::Church,
        FeatureKind::Gallows,
    ),
    (
        Zone::Plague,
        "plague",
        FeatureKind::BogTree,
        FeatureKind::Barrow,
    ),
    (Zone::Frost, "frost", FeatureKind::Cave, FeatureKind::Mere),
    (Zone::Holy, "holy", FeatureKind::Hall, FeatureKind::Hall),
];

fn starter_json() -> Value {
    serde_json::from_str(STARTER).unwrap()
}

fn refused(v: &Value) -> String {
    match Rules::from_json(&v.to_string()) {
        Ok(_) => panic!("a malformed rule file was accepted"),
        Err(e) => e,
    }
}

/// The shipped file with Fire's landmark block replaced by `rings` (kinds that exist in the file today).
fn with_fire_rings(rings: Value) -> Value {
    let mut v = starter_json();
    v["zones"]["fire"]["signature"]["landmark"] = json!({ "feature": "volcano", "rings": rings });
    v
}

fn ring(name: &str, band: &str) -> Value {
    json!({ "name": name, "band": band, "groundVariant": 3,
            "props": [{ "kind": "fire.ash", "density": 1.0 }] })
}

#[test]
fn the_shipped_file_names_the_five_landmark_kinds_and_a_fallback_for_each() {
    let r = Rules::starter();
    for (zone, _, landmark, fallback) in KINDS {
        let z = r.zone(zone).expect("every zone has rules");
        let lm = z
            .landmark
            .as_ref()
            .unwrap_or_else(|| panic!("{zone:?}: no signature.landmark block in rules/zones.json"));
        assert_eq!(lm.feature, landmark, "{zone:?}: landmark kind");
        // The fallback is the pre-existing `signature.feature` with its legacy rings, kept as they were.
        assert_eq!(z.signature_feature, fallback, "{zone:?}: fallback kind");
        assert!(z.rings.len() >= 2, "{zone:?}: fallback rings kept");
    }
}

#[test]
fn landmark_rings_run_core_near_mid_with_distinct_ground_and_their_own_kinds() {
    let r = Rules::starter();
    // Which rule owns each kind code, across the whole file, landmark rings included.
    let mut owner: Vec<(u8, String)> = Vec::new();
    for z in &r.zones {
        let mut claim = |kinds: Vec<u8>, rule: &str| {
            for k in kinds {
                if let Some((_, other)) = owner.iter().find(|(c, _)| *c == k) {
                    panic!("kind {k} is used by both {other} and {rule}");
                }
                owner.push((k, rule.to_string()));
            }
        };
        for x in &z.rings {
            claim(x.props.iter().map(|p| p.kind).collect(), &x.name);
        }
        for x in &z.clusters {
            claim(x.kinds.clone(), &x.name);
        }
        for x in &z.edges {
            claim(x.kinds.clone(), &x.name);
        }
        for x in &z.fillers {
            claim(x.kinds.clone(), &x.name);
        }
        let lm = z
            .landmark
            .as_ref()
            .unwrap_or_else(|| panic!("{:?}: no signature.landmark block", z.zone));
        for x in &lm.rings {
            claim(x.props.iter().map(|p| p.kind).collect(), &x.name);
        }
    }
    for z in &r.zones {
        let lm = z.landmark.as_ref().unwrap();
        for band in [Band::Core, Band::Near, Band::Mid] {
            let n = lm.rings.iter().filter(|x| x.band == band).count();
            assert_eq!(n, 1, "{:?}: exactly one {band:?} ring", z.zone);
        }
        assert!(
            lm.rings.iter().filter(|x| x.band == Band::Far).count() <= 1,
            "{:?}: at most one Far ring",
            z.zone
        );
        let mut variants: Vec<u8> = lm.rings.iter().map(|x| x.ground_variant).collect();
        assert!(
            variants.iter().all(|v| *v != 0),
            "{:?}: a ring leaves the ground plain",
            z.zone
        );
        variants.sort_unstable();
        variants.dedup();
        assert_eq!(
            variants.len(),
            lm.rings.len(),
            "{:?}: ground variants are distinct per band",
            z.zone
        );
        for x in &lm.rings {
            assert!(!x.props.is_empty(), "{}: no props", x.name);
            assert!(
                x.props.iter().all(|p| p.density > 0.0),
                "{}: a prop of density 0",
                x.name
            );
            if x.band == Band::Core {
                assert!(
                    x.props.iter().all(|p| !r.is_tall(p.kind)),
                    "{}: the core band holds no tall prop",
                    x.name
                );
            }
        }
    }
}

/// GUARD: a file in the old schema (no `landmark`) still parses; every zone then has no landmark path.
#[test]
fn a_file_without_a_landmark_block_still_parses_and_keeps_its_fallback() {
    let r = Rules::from_json(LEGACY).expect("the pre-packet file parses");
    for (zone, _, _, fallback) in KINDS {
        let z = r.zone(zone).unwrap();
        assert!(z.landmark.is_none(), "{zone:?}");
        assert_eq!(z.signature_feature, fallback);
        assert_eq!(z.rings.len(), 2);
    }
}

/// GUARD: the legacy keys of the shipped file are exactly the pre-packet ones (the fallback path is not retuned).
#[test]
fn the_fallback_keys_of_the_shipped_file_are_the_pre_packet_ones() {
    let now = starter_json();
    let old: Value = serde_json::from_str(LEGACY).unwrap();
    for (_, name, _, _) in KINDS {
        let (a, b) = (&now["zones"][name], &old["zones"][name]);
        assert_eq!(
            a["signature"]["feature"], b["signature"]["feature"],
            "{name}"
        );
        assert_eq!(a["signature"]["rings"], b["signature"]["rings"], "{name}");
        for key in ["clusters", "edges", "filler"] {
            assert_eq!(a[key], b[key], "{name}.{key}");
        }
    }
    assert_eq!(now["keepClear"], old["keepClear"]);
    // Existing kinds keep their codes and tall flags; new kinds may be added.
    for (k, def) in old["kinds"].as_object().unwrap() {
        assert_eq!(&now["kinds"][k], def, "kind {k}");
    }
}

/// GUARD (passes on the stub): a minimal landmark block in a hand-built file parses to what it says.
#[test]
fn a_landmark_block_parses_bands_in_file_order() {
    let v = with_fire_rings(json!([ring("t-near", "near"), ring("t-core", "core")]));
    let r = Rules::from_json(&v.to_string()).expect("parses");
    let lm = r.zone(Zone::Fire).unwrap().landmark.as_ref().unwrap();
    assert_eq!(lm.feature, FeatureKind::Volcano);
    let bands: Vec<Band> = lm.rings.iter().map(|x| x.band).collect();
    assert_eq!(bands, vec![Band::Near, Band::Core]);
    assert_eq!(lm.rings[0].ground_variant, 3);
}

#[test]
fn an_unknown_band_is_refused_naming_the_rule() {
    let v = with_fire_rings(json!([ring("t-bad", "outer")]));
    let e = refused(&v);
    assert!(e.contains("t-bad") && e.contains("outer"), "{e}");
}

#[test]
fn two_rings_for_one_band_are_refused_naming_both_rules() {
    let v = with_fire_rings(json!([ring("t-a", "near"), ring("t-b", "near")]));
    let e = refused(&v);
    assert!(
        e.contains("t-a") && e.contains("t-b") && e.contains("near"),
        "{e}"
    );
}

#[test]
fn a_landmark_ring_without_props_is_refused_naming_the_rule() {
    let v = with_fire_rings(json!([{ "name": "t-empty", "band": "mid", "props": [] }]));
    let e = refused(&v);
    assert!(e.contains("t-empty"), "{e}");
}

/// GUARD: kind and density errors in a landmark ring name the rule (the shared code path).
#[test]
fn an_unknown_kind_or_negative_density_in_a_landmark_ring_is_refused_naming_the_rule() {
    let v = with_fire_rings(json!([{ "name": "t-k", "band": "core",
        "props": [{ "kind": "fire.nope", "density": 1.0 }] }]));
    let e = refused(&v);
    assert!(e.contains("t-k") && e.contains("fire.nope"), "{e}");
    let v = with_fire_rings(json!([{ "name": "t-d", "band": "core",
        "props": [{ "kind": "fire.ash", "density": -1.0 }] }]));
    assert!(refused(&v).contains("t-d"));
}

#[test]
fn a_kind_placed_by_a_landmark_ring_is_allowed_on_that_rings_tile_classes() {
    let v = with_fire_rings(
        json!([{ "name": "t-ember", "band": "core", "groundVariant": 1,
        "props": [{ "kind": "fire.vent", "density": 1.0 }], "on": ["floor", "ember"] }]),
    );
    let r = Rules::from_json(&v.to_string()).expect("parses");
    let code = r.kind_code("fire.vent").unwrap();
    let on = r.allowed_classes(code);
    assert!(
        on.contains(&rh_mapdress::TileClass::Ember),
        "allowed_classes ignores landmark rings: {on:?}"
    );
}
