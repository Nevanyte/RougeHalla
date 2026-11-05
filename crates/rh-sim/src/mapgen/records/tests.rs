use super::*;
use serde::Deserialize;
use serde_json::Value;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CapturedInput {
    seed: i64,
    attempt: u64,
    tiles: Vec<u8>,
    terrain: Vec<u8>,
    props: Vec<MapProp>,
    region_grid: Vec<u8>,
    zone: Vec<u8>,
    territory_grid: Vec<u8>,
    order: Vec<Zone>,
    camps: Vec<CampSite>,
    reach2: Vec<i32>,
    pool: Vec<usize>,
    crates_by_zone: Vec<Vec<usize>>,
    landmark_box: Vec<u8>,
    buildings: Vec<TileRect>,
    ground_spots: Vec<WorldPt>,
    drafts: Vec<MapFeature>,
    feature_owner: Vec<u16>,
}
impl CapturedInput {
    fn borrow(&self) -> Input<'_> {
        Input {
            seed: self.seed,
            attempt: self.attempt,
            tiles: &self.tiles,
            terrain: &self.terrain,
            props: &self.props,
            region_grid: &self.region_grid,
            zone: &self.zone,
            order: &self.order,
            camps: &self.camps,
            reach2: &self.reach2,
            pool: &self.pool,
            crates_by_zone: &self.crates_by_zone,
            landmark_box: &self.landmark_box,
            buildings: &self.buildings,
            ground_spots: &self.ground_spots,
            drafts: &self.drafts,
            feature_owner: &self.feature_owner,
        }
    }
}
fn unpack(v: &mut Value) {
    for key in [
        "tiles",
        "terrain",
        "regionGrid",
        "territoryGrid",
        "zone",
        "landmarkBox",
        "featureOwner",
        "featureGrid",
    ] {
        if let Some(a) = v.get_mut(key) {
            keys(a, &["rle"]);
            let runs = a["rle"].as_array().expect("nonempty rle inventory");
            assert!(!runs.is_empty());
            let mut out = Vec::new();
            for r in runs {
                let r = r.as_array().unwrap();
                assert_eq!(r.len(), 2);
                let n = r[1].as_u64().unwrap();
                assert!(n > 0 && n <= (W * H) as u64);
                out.extend(std::iter::repeat_n(r[0].clone(), n as usize));
            }
            assert_eq!(out.len(), W * H);
            *a = Value::Array(out);
        }
    }
}
fn keys(v: &Value, expected: &[&str]) {
    let mut actual: Vec<_> = v.as_object().unwrap().keys().map(String::as_str).collect();
    let mut expected = expected.to_vec();
    actual.sort_unstable();
    expected.sort_unstable();
    assert_eq!(actual, expected);
}
fn fixture() -> Value {
    let v: Value = serde_json::from_str(include_str!("../fixtures/map-records.json")).unwrap();
    assert_eq!(v["format"], "rh-map-records/1");
    assert_eq!(v["node"], "v22.23.4");
    assert_eq!(v["platform"], "linux");
    assert_eq!(v["arch"], "x64");
    assert_eq!(v["sources"].as_object().unwrap().len(), 75);
    assert_eq!(
        v["sources"]["mapgen.ts"],
        "975591aed836a345c4efd957ced95a478638e6e870fe8ea9bb8740526ef06d10"
    );
    keys(
        &v,
        &[
            "format",
            "node",
            "platform",
            "arch",
            "sources",
            "cases",
            "synthetic",
        ],
    );
    assert!(v["sources"].get("mapgen.ts").is_some());
    v
}
fn assert_bits(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => assert_eq!(
            x.as_f64().unwrap().to_bits(),
            y.as_f64().unwrap().to_bits(),
            "{path}"
        ),
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len(), "{path}");
            for (k, (x, y)) in x.iter().zip(y).enumerate() {
                assert_bits(x, y, &format!("{path}[{k}]"));
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            assert_eq!(x.len(), y.len(), "{path}");
            for (k, x) in x {
                assert_bits(
                    x,
                    y.get(k).expect("missing output field"),
                    &format!("{path}.{k}"),
                );
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
fn check(case: &Value) {
    let mut iv = case["input"].clone();
    unpack(&mut iv);
    let x: CapturedInput = serde_json::from_value(iv).unwrap();
    let mut ev = case["output"].clone();
    unpack(&mut ev);
    let expected: GameMapData = serde_json::from_value(ev.clone()).unwrap();
    let mut territory = x.territory_grid.clone();
    let out = finalize(
        &default_definition(),
        &crate::mapgen::zones::default_definition(),
        &crate::mapgen::coliseum::fixed_layout(),
        &x.borrow(),
        &mut territory,
    )
    .unwrap();
    assert_eq!(territory, expected.territory_grid);
    assert_eq!(out, expected);
    if let Some(hash) = case.get("finalHash") {
        assert_eq!(
            crate::mapgen::map_hash::map_hash(&out),
            hash.as_str().unwrap()
        );
        let problems = crate::mapgen::terrain_gate::validate(
            &out,
            &crate::mapgen::terrain_gate::Options {
                styled: case["styled"].as_bool().unwrap(),
                prop_kinds: None,
            },
        )
        .unwrap();
        assert!(
            problems.is_empty(),
            "genuine finalized map failed terrain admission: {problems:?}"
        );
        crate::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32: u32::from_str_radix(hash.as_str().unwrap(), 16).unwrap(),
            map: out.clone(),
        }
        .validate()
        .unwrap();
    }
    assert_bits(&serde_json::to_value(out).unwrap(), &ev, "map");
}
#[test]
fn genuine_post_gate_records_match_all_layers() {
    let v = fixture();
    let cases = v["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 9);
    let inventory: Vec<_> = cases
        .iter()
        .map(|c| {
            (
                c["seed"].as_i64().unwrap(),
                c["attempt"].as_u64().unwrap(),
                c["styled"].as_bool().unwrap(),
                c["decor"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        inventory,
        vec![
            (1, 0, false, false),
            (-1, 0, false, false),
            (4294967297, 4294967296, false, false),
            (17, 0, false, false),
            (17, 1, false, false),
            (176, 0, false, false),
            (1, 0, true, false),
            (1, 0, false, true),
            (1, 0, true, true)
        ]
    );
    let mut reached = 0;
    for c in cases {
        keys(
            c,
            &[
                "seed",
                "attempt",
                "styled",
                "decor",
                "completeFinalOutputEquality",
                "finalHash",
                "input",
                "output",
            ],
        );
        assert_eq!(c["completeFinalOutputEquality"], true);
        // Every pinned real case reached records and returned a complete map in this source capture.
        // Null/null must not silently delete a valid wide-seed or retry comparison.
        assert!(
            c["input"].is_object(),
            "known real records input is missing"
        );
        assert!(
            c["output"].is_object(),
            "known real records output is missing"
        );
        assert!(c["finalHash"].as_str().is_some_and(|h| h.len() == 8));
        reached += 1;
        check(c);
    }
    assert_eq!(reached, 9);
}
#[test]
fn synthetic_ownership_payload_and_stable_order_boundaries() {
    let v = fixture();
    let cases = v["synthetic"].as_array().unwrap();
    assert_eq!(cases.len(), 2);
    assert_eq!(cases[0]["name"], "empty-owner");
    assert_eq!(cases[1]["name"], "sparse-owner");
    for c in cases {
        keys(c, &["name", "provenance", "input", "output"]);
        assert!(c["provenance"]
            .as_str()
            .unwrap()
            .starts_with("synthetic boundary input"));
        assert_eq!(c["input"]["drafts"].as_array().unwrap().len(), 35);
        check(c);
    }
}
#[test]
fn malformed_inputs_refused_without_territory_mutation() {
    let v = fixture();
    let mut iv = v["cases"][0]["input"].clone();
    unpack(&mut iv);
    let mut x: CapturedInput = serde_json::from_value(iv).unwrap();
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let zones = crate::mapgen::zones::default_definition();
    let original = x.territory_grid.clone();
    let mut territory = original.clone();
    x.seed = 9_007_199_254_740_992;
    assert_eq!(
        finalize(
            &default_definition(),
            &zones,
            &fixed,
            &x.borrow(),
            &mut territory
        ),
        Err(Error::Metadata)
    );
    x.seed = 1;
    x.feature_owner[0] = u16::MAX;
    assert_eq!(
        finalize(
            &default_definition(),
            &zones,
            &fixed,
            &x.borrow(),
            &mut territory
        ),
        Err(Error::Reference)
    );
    x.feature_owner[0] = 0;
    x.pool[0] = W * H;
    assert_eq!(
        finalize(
            &default_definition(),
            &zones,
            &fixed,
            &x.borrow(),
            &mut territory
        ),
        Err(Error::Reference)
    );
    assert_eq!(territory, original);
}
#[test]
fn live_policy_borrow_and_content_words() {
    let v = fixture();
    let mut iv = v["synthetic"][1]["input"].clone();
    unpack(&mut iv);
    let x: CapturedInput = serde_json::from_value(iv).unwrap();
    let mut pairs = DEFAULT_DEFINITION.factions.to_vec();
    pairs[0].1 = RegionWeapon::Fists;
    let d = Definition {
        factions: &pairs,
        terrain_ice: 255,
    };
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let mut territory = x.territory_grid.clone();
    let out = finalize(
        &d,
        &crate::mapgen::zones::default_definition(),
        &fixed,
        &x.borrow(),
        &mut territory,
    )
    .unwrap();
    assert!(out.regions[0]
        .mob_camps
        .iter()
        .all(|c| c.weapon == RegionWeapon::Fists));
    let mut a = Vec::new();
    let mut b = Vec::new();
    visit_content(&DEFAULT_DEFINITION, |w| a.push(w));
    visit_content(&d, |w| b.push(w));
    assert!(out
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Mere && f.p.len() > 1)
        .all(|f| f.p[1] == 0));
    assert_eq!(a.len(), 12);
    assert_ne!(a, b);
}
