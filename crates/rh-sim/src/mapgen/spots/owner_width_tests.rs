//! Captured unchanged source crate body on explicit synthetic Uint16 ownership boundaries.
use super::*;
use crate::rng::Mulberry32;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
fn value<T: DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap()
}
fn fixture() -> Value {
    let f: Value =
        serde_json::from_str(include_str!("../fixtures/map-spots-owner-width.json")).unwrap();
    assert_eq!(f["format"], "rh-map-spots-owner-width/1");
    assert_eq!(
        f["runtime"],
        json!({"node":"v22.23.4","platform":"linux","arch":"x64"})
    );
    assert_eq!(
        f["inventory"],
        json!({"cases":12,"ids":[255,256,257,65535],"controls":["same-owner","foreign-wall","foreign-floor"],"zones":60})
    );
    assert_eq!(f["cases"].as_array().unwrap().len(), 12);
    assert_eq!(f["sources"].as_object().unwrap().len(), 5);
    for key in [
        "mapgen.ts",
        "rng.ts",
        "map.ts",
        "constants.ts",
        "zoneStyle/types.ts",
    ] {
        let h = f["sources"][key].as_str().unwrap();
        assert_eq!(h.len(), 64);
        assert!(h.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    assert_eq!(
        f["sourceBlockSha256"],
        "d6c948d5aa500f5ad5ac8be2bce48e2703944dc6e853e8752be48ec9d3b9dc41"
    );
    assert_eq!(
        f["sources"]["mapgen.ts"],
        "975591aed836a345c4efd957ced95a478638e6e870fe8ea9bb8740526ef06d10"
    );
    f
}
struct Data {
    tiles: Vec<u8>,
    terrain: Vec<u8>,
    zone: Vec<u8>,
    owners: Vec<u16>,
    features: Vec<MapFeature>,
    pool: Vec<usize>,
    camps: Vec<CampSite>,
    styled: bool,
}
fn data(f: &Value, case: &Value) -> Data {
    let c = &case["input"];
    let id: usize = value(&c["ownerId"]);
    let padding: MapFeature = value(&f["paddingFeature"]);
    assert_eq!(padding.kind, FeatureKind::Infill);
    let mut features = vec![padding; id];
    features[id - 1] = value(&c["landmark"]);
    assert_eq!(features[id - 1].kind, FeatureKind::Landmark);
    let mut tiles = vec![TILE_WALL; N];
    let mut zone = vec![0; N];
    let floor_zones: Vec<[usize; 2]> = value(&c["floorZones"]);
    let expected: Vec<_> = (1..=5)
        .flat_map(|z| (0..8).map(move |k| [30 * W + 8 + 28 * (z - 1) + 3 * k, z]))
        .collect();
    assert_eq!(floor_zones, expected);
    for [t, z] in floor_zones {
        tiles[t] = TILE_FLOOR;
        zone[t] = z as u8;
    }
    let mut owners = vec![0; N];
    let writes: Vec<(usize, u16)> = value(&c["ownership"]);
    assert_eq!(writes.len(), 12);
    let mut seen = vec![false; N];
    for (t, owner) in writes {
        assert!(!seen[t]);
        seen[t] = true;
        owners[t] = owner;
    }
    Data {
        tiles,
        terrain: vec![0; N],
        zone,
        owners,
        features,
        pool: value(&c["pool"]),
        camps: value(&c["camps"]),
        styled: value(&c["styled"]),
    }
}
fn input<'a>(fixed: &'a FixedLayout, d: &'a Data) -> CrateInput<'a> {
    CrateInput {
        fixed,
        tiles: &d.tiles,
        terrain: &d.terrain,
        zone: &d.zone,
        feature_owner: &d.owners,
        features: &d.features,
        pool: &d.pool,
        camps: &d.camps,
        styled: d.styled,
    }
}
fn mask(v: &Value) -> Vec<u8> {
    assert_eq!(v.as_object().unwrap().len(), 2);
    assert_eq!(v["length"], N);
    let ones: Vec<usize> = value(&v["ones"]);
    assert!(ones.windows(2).all(|w| w[0] < w[1]));
    let mut a = vec![0; N];
    for t in ones {
        a[t] = 1;
    }
    a
}
#[test]
fn source_uint16_owner_boundaries_match_all_masks_zones_and_rng() {
    let f = fixture();
    let mut fixed = super::super::coliseum::fixed_layout();
    fixed.ring.fill(0);
    let mut zones = 0;
    for (i, case) in f["cases"].as_array().unwrap().iter().enumerate() {
        let id = [255, 256, 257, 65535][i / 3];
        let control = ["same-owner", "foreign-wall", "foreign-floor"][i % 3];
        assert_eq!(case["input"]["ownerId"], id);
        assert_eq!(case["input"]["control"], control);
        assert_eq!(case["completeOutputAndRngEquality"], true);
        let d = data(&f, case);
        let mut rng = Mulberry32::new(value(&case["input"]["seed"]));
        let mut words = Vec::new();
        let actual = weapon_crates(
            input(&fixed, &d),
            &mut || {
                let w = rng.next_u32();
                words.push(w);
                f64::from(w) / 4294967296.0
            },
            &default_definition(),
        )
        .unwrap();
        let mut expected = case["output"].clone();
        for key in ["doorNear", "initialNo", "crateNo"] {
            expected[key] = json!(mask(&expected[key]));
        }
        let expected: CrateOutput = value(&expected);
        assert_eq!(
            actual, expected,
            "complete crate output owner={id}, control={control}"
        );
        let first = 30 * W + 8;
        let start = usize::from(control != "same-owner");
        assert_eq!(
            actual.nooks_by_zone[1],
            (start..4).map(|k| first + 3 * k).collect::<Vec<_>>()
        );
        assert_eq!(actual.zones.len(), 5);
        assert_eq!(actual.refusal, None);
        assert_eq!(
            json!(actual.zones.iter().map(|z| &z.chosen).collect::<Vec<_>>()),
            case["result"]
        );
        assert!(!words.is_empty());
        assert_eq!(
            json!(words),
            case["words"],
            "draw order owner={id}, control={control}"
        );
        let continuation: Vec<u32> = value(&case["continuation"]);
        assert_eq!(continuation.len(), 8);
        for w in continuation {
            assert_eq!(rng.next_u32(), w);
        }
        zones += actual.zones.len();
    }
    assert_eq!(zones, 60);
}
#[test]
fn widened_ownership_preserves_admission_errors_before_any_draw() {
    let f = fixture();
    let fixed = super::super::coliseum::fixed_layout();
    for i in [3, 6, 9] {
        for bad in 0..7 {
            let mut d = data(&f, &f["cases"][i]);
            let mut definition = default_definition();
            let expected = match bad {
                0 => {
                    d.owners.pop();
                    Error::Length
                }
                1 => {
                    d.owners.push(0);
                    Error::Length
                }
                2 => {
                    d.zone[0] = 6;
                    Error::Index
                }
                3 => {
                    d.pool.push(N);
                    Error::Index
                }
                4 => {
                    d.features.last_mut().unwrap().bbox.x = -1;
                    Error::FeatureBounds
                }
                5 => {
                    d.features.last_mut().unwrap().p.push(N as i32);
                    Error::Index
                }
                6 => {
                    definition.crate_gap = 0;
                    Error::Definition
                }
                _ => unreachable!(),
            };
            let mut draws = 0;
            let out = weapon_crates(
                input(&fixed, &d),
                &mut || {
                    draws += 1;
                    0.5
                },
                &definition,
            );
            assert_eq!(out, Err(expected), "owner index={i}, malformed={bad}");
            assert_eq!(draws, 0);
        }
    }
}
