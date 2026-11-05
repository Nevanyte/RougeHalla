use super::super::runtime::{Counters, LandmarkSpec, PlacedFeature};
use super::*;
use crate::mapdata::{FeatureJob, MapFeature};
use serde_json::Value;

fn decode<T: TryFrom<i64>>(v: &Value) -> Vec<T>
where
    T::Error: std::fmt::Debug,
{
    v.as_array()
        .unwrap()
        .iter()
        .flat_map(|r| std::iter::repeat_n(r[0].as_i64().unwrap(), r[1].as_u64().unwrap() as usize))
        .map(|n| T::try_from(n).unwrap())
        .collect()
}

fn snapshot(rt: &LandmarkRuntime<'_>, expected: &Value) {
    let s = rt.state();
    assert_eq!(s.tiles, decode::<u8>(&expected["tiles"]));
    assert_eq!(s.terrain, decode::<u8>(&expected["terrain"]));
    assert_eq!(s.feature_owner, decode::<u16>(&expected["featureOwner"]));
    assert_eq!(s.wrote, decode::<u8>(&expected["wrote"]));
    assert_eq!(rt.reserved(), decode::<u8>(&expected["reserved"]));
    assert_eq!(
        s.features,
        serde_json::from_value::<Vec<MapFeature>>(expected["features"].clone()).unwrap()
    );
    let scratch = serde_json::to_value(&s.scratch).unwrap();
    for field in ["mark", "qa", "qb"] {
        assert_eq!(
            scratch[field],
            serde_json::to_value(decode::<i32>(&expected[field])).unwrap()
        );
    }
    assert_eq!(scratch["epoch"], expected["epoch"]);
    assert_eq!(
        rt.counters(),
        serde_json::from_value::<Counters>(expected["counters"].clone()).unwrap()
    );
}

#[test]
fn ordered_stage_wrapper_replays_source_transactions_without_drawing_main_rng() {
    // This checks orchestration/admission using the accepted transaction oracle, not recipe implementation.
    let f: Value =
        serde_json::from_str(include_str!("../../fixtures/landmark-runtime.json")).unwrap();
    assert_eq!(f["format"], "rh-landmark-runtime/1");
    assert_eq!(f["cases"].as_array().unwrap().len(), 3);
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let attempt = crate::mapgen::attempt::AttemptContext::new(&fixed);
    let context = StageContext::new(&fixed);
    for case in f["cases"].as_array().unwrap() {
        let input = &case["input"];
        let frame = crate::mapgen::attempt::begin_attempt(
            &attempt,
            input["seed"].as_i64().unwrap(),
            input["attempt"].as_u64().unwrap(),
        )
        .unwrap()
        .unwrap();
        let original = frame.clone();
        let commands = case["commands"].as_array().unwrap();
        let mut cursor = 0;
        let mut expected_results = Vec::new();
        let out = context
            .apply_with(&frame, |faction, rt, _inputs| {
                let start = &commands[cursor];
                assert_eq!(start["type"], "zone");
                assert_eq!(faction.as_str(), start["info"]["faction"]);
                assert_eq!(
                    serde_json::to_value(&rt.geometry().info).unwrap(),
                    start["info"]
                );
                assert_eq!(rt.geometry().mask, decode::<u8>(&start["mask"]));
                assert_eq!(rt.geometry().edge_dist, decode::<i32>(&start["edgeDist"]));
                assert_eq!(
                    rt.original_hard(),
                    serde_json::from_value::<Vec<u8>>(input["protect"].clone()).unwrap()
                );
                snapshot(rt, &start["snapshot"]);
                cursor += 1;
                let before = rt.state().features.len();
                while cursor < commands.len() && commands[cursor]["type"] != "zone" {
                    let command = &commands[cursor];
                    match command["type"].as_str().unwrap() {
                        "place" => {
                            let spec: LandmarkSpec =
                                serde_json::from_value(command["spec"].clone()).unwrap();
                            assert_eq!(
                                rt.place_whole(&spec),
                                serde_json::from_value::<Option<PlacedFeature>>(
                                    command["result"].clone()
                                )
                                .unwrap()
                            );
                        }
                        "reserve" => rt.reserve(command["tile"].as_i64().unwrap() as i32),
                        other => panic!("unexpected actual-source command {other}"),
                    }
                    snapshot(rt, &command["snapshot"]);
                    cursor += 1;
                }
                expected_results.push(ZoneResult {
                    index: rt.geometry().info.index,
                    faction,
                    landmarks: rt.state().features.len() - before,
                    walls: rt.counters().walls,
                });
            })
            .unwrap()
            .unwrap();
        assert_eq!(cursor, commands.len());
        assert_eq!(out.zones, expected_results);
        assert_eq!(
            frame, original,
            "stage must not change its prefix or main stream"
        );
        assert_eq!(
            out.protect,
            serde_json::from_value::<Vec<u8>>(input["protect"].clone()).unwrap()
        );
        assert_eq!(out.buildings.len(), out.state.features.len());
        for (b, f) in out.buildings.iter().zip(&out.state.features) {
            assert_eq!(
                (b.x, b.y, b.w, b.h),
                (f.bbox.x, f.bbox.y, f.bbox.w as i32, f.bbox.h as i32)
            );
        }
        assert!(out.masks.boxes.iter().any(|&v| v != 0));
        assert!(out
            .masks
            .near1
            .iter()
            .zip(&out.masks.boxes)
            .all(|(&n, &b)| n >= b));
    }
}

fn legal_wall() -> (Vec<u8>, Vec<u8>, Vec<u8>, Stage4State) {
    let before = vec![TILE_FLOOR; 6];
    let zone = vec![1; 6];
    let protect = vec![0; 6];
    let mut state = Stage4State::new(
        3,
        2,
        before.clone(),
        vec![MapFeature {
            kind: FeatureKind::Landmark,
            variant: "gate-probe".into(),
            zone: Zone::Fire,
            jobs: vec![FeatureJob::Landmark],
            ax: 1,
            ay: 0,
            p: vec![],
            bbox: crate::mapdata::TileRect {
                x: 1,
                y: 0,
                w: 1,
                h: 1,
            },
            tiles: 1,
        }],
        vec![0; 6],
    );
    state.tiles[1] = TILE_WALL;
    state.feature_owner[1] = 1;
    (before, zone, protect, state)
}

#[test]
fn each_source_changed_cell_breach_is_refused() {
    let (before, zone, protect, state) = legal_wall();
    let order = [FactionId::Fire];
    let admit = |b: &[u8], z: &[u8], p: &[u8], s: &Stage4State| admit_changes(b, z, &order, p, s);
    assert!(admit(&before, &zone, &protect, &state));
    let mut b = before.clone();
    b[1] = TILE_WALL;
    let mut s = state.clone();
    s.tiles[1] = TILE_FLOOR;
    assert!(!admit(&b, &zone, &protect, &s)); // walls may not be opened
    let mut s = state.clone();
    s.tiles[1] = crate::map::TILE_LOW;
    assert!(!admit(&before, &zone, &protect, &s));
    for invalid in [0, 2] {
        let mut z = zone.clone();
        z[1] = invalid;
        assert!(!admit(&before, &z, &protect, &state));
    }
    let mut p = protect.clone();
    p[1] = 1;
    assert!(!admit(&before, &zone, &p, &state));
    for invalid in [0, 2] {
        let mut s = state.clone();
        s.feature_owner[1] = invalid;
        assert!(!admit(&before, &zone, &protect, &s));
    }
    let mut s = state.clone();
    s.features[0].kind = FeatureKind::Bush;
    assert!(!admit(&before, &zone, &protect, &s));
    let mut s = state.clone();
    s.features[0].zone = Zone::Holy;
    assert!(!admit(&before, &zone, &protect, &s));
    assert!(!admit(&before[..5], &zone, &protect, &state));
    // The source gate deliberately examines only changed collision cells.
    assert!(admit(&state.tiles, &[0; 6], &[1; 6], &state));
}

#[test]
fn stage_reuses_corresponding_protection_rules_and_validates_metadata() {
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let attempt = crate::mapgen::attempt::AttemptContext::new(&fixed);
    let mut frame = crate::mapgen::attempt::begin_attempt(&attempt, 1, 0)
        .unwrap()
        .unwrap();
    let mut definitions = Definitions::default();
    definitions.spawns.landmark_road_margin += 1;
    let context = StageContext::from_definitions(&fixed, &definitions);
    let original = StageContext::new(&fixed)
        .apply_with(&frame, |_, _, _| {})
        .unwrap()
        .unwrap();
    let changed = context.apply_with(&frame, |_, _, _| {}).unwrap().unwrap();
    assert_ne!(original.protect, changed.protect);
    assert_eq!(original.state, changed.state);
    assert_eq!(changed.zones.len(), 5);
    frame.state.attempt = 9_007_199_254_740_992;
    assert_eq!(
        context.apply_with(&frame, |_, _, _| {}).unwrap_err(),
        AttemptInputError::AttemptNotSafeInteger
    );
}

#[test]
fn all_five_live_recipes_match_ordered_source_stages_and_exact_admission_masks() {
    let direct: Value =
        serde_json::from_str(include_str!("../../fixtures/landmark-recipes-direct.json")).unwrap();
    let admission: Value =
        serde_json::from_str(include_str!("../../fixtures/landmark-stage.json")).unwrap();
    assert_eq!(direct["format"], "rh-landmark-recipes-direct/1");
    assert_eq!(admission["format"], "rh-landmark-stage/1");
    assert_eq!(admission["node"], "v22.23.4");
    assert_eq!(admission["platform"], "linux");
    assert_eq!(admission["arch"], "x64");
    assert_eq!(admission["sourceSha256"].as_object().unwrap().len(), 75);
    assert!(admission["sourceSha256"]
        .as_object()
        .unwrap()
        .values()
        .all(|h| h.as_str().is_some_and(|v| v.len() == 64)));
    let inventory = [
        (1, 0, false),
        (-1, 0, false),
        (4_294_967_297, 4_294_967_296, false),
        (176, 0, false),
        (54, 0, false),
        (17, 0, false),
        (17, 1, false),
        (1, 0, true),
    ];
    assert_eq!(direct["cases"].as_array().unwrap().len(), inventory.len());
    assert_eq!(
        admission["cases"].as_array().unwrap().len(),
        inventory.len()
    );
    let fixed = crate::mapgen::coliseum::fixed_layout();
    let prefix = crate::mapgen::attempt::AttemptContext::new(&fixed);
    let context = StageContext::new(&fixed);
    let recipes = super::super::recipes::Recipes::default();
    for (i, (seed, attempt, styled)) in inventory.into_iter().enumerate() {
        let case = &direct["cases"][i];
        let expected = &admission["cases"][i];
        for record in [case, expected] {
            assert_eq!(record["seed"], seed);
            assert_eq!(record["attempt"], attempt);
            assert_eq!(record["styledObserverControl"], styled);
            assert_eq!(record["completeFinalOutputEquality"], true);
        }
        assert_eq!(case["finalHash"], expected["finalHash"]);
        assert_eq!(case["options"], expected["options"]);
        let frame = crate::mapgen::attempt::begin_attempt(&prefix, seed, attempt)
            .unwrap()
            .unwrap();
        let original = frame.clone();
        assert_eq!(
            frame.state.tiles,
            decode::<u8>(&expected["before"]["tiles"])
        );
        assert_eq!(
            frame.state.partition.zone,
            decode::<u8>(&expected["before"]["zone"])
        );
        assert_eq!(case["zones"].as_array().unwrap().len(), 5);
        let mut z = 0;
        let out = context
            .apply_with(&frame, |faction, rt, inputs| {
                let zone = &case["zones"][z];
                assert_eq!(zone["index"], z + 1);
                assert_eq!(zone["faction"], faction.as_str());
                let info: super::super::runtime::ZoneInfo =
                    serde_json::from_value(zone["info"].clone()).unwrap();
                assert_eq!(rt.geometry().info, info);
                for (actual, expected) in [
                    (rt.geometry().info.centroid.x, info.centroid.x),
                    (rt.geometry().info.centroid.y, info.centroid.y),
                    (rt.geometry().info.axis.x, info.axis.x),
                    (rt.geometry().info.axis.y, info.axis.y),
                ] {
                    assert_eq!(actual.to_bits(), expected.to_bits());
                }
                assert_eq!(rt.geometry().mask, decode::<u8>(&zone["mask"]));
                assert_eq!(rt.geometry().edge_dist, decode::<i32>(&zone["edgeDist"]));
                snapshot(
                    rt,
                    &case["states"][zone["before"].as_u64().unwrap() as usize],
                );
                recipes.apply(rt, inputs);
                snapshot(
                    rt,
                    &case["states"][zone["after"].as_u64().unwrap() as usize],
                );
                let streams = inputs.streams(rt.geometry().info.index);
                assert_eq!(zone["stream"]["streamSeed"], streams.landmark_seed);
                assert_eq!(zone["stream"]["noiseSeed"], streams.noise_seed);
                assert_eq!(zone["stream"]["draws"], 0);
                assert_eq!(zone["stream"]["continuation"].as_array().unwrap().len(), 3);
                let mut rng = streams.rng();
                for word in zone["stream"]["continuation"].as_array().unwrap() {
                    assert_eq!(
                        format!("{:016x}", rng.next_f64().to_bits()),
                        word.as_str().unwrap()
                    );
                }
                z += 1;
            })
            .unwrap()
            .unwrap();
        assert_eq!(z, 5);
        assert_eq!(frame, original);
        let mut rng = frame.rng.clone();
        assert_eq!(case["main"]["continuation"].as_array().unwrap().len(), 3);
        for word in case["main"]["continuation"].as_array().unwrap() {
            assert_eq!(
                format!("{:016x}", rng.next_f64().to_bits()),
                word.as_str().unwrap()
            );
        }
        assert_eq!(out.protect, decode::<u8>(&expected["before"]["protect"]));
        let after = &expected["admitted"];
        assert_eq!(out.state.tiles, decode::<u8>(&after["tiles"]));
        assert_eq!(
            out.state.feature_owner,
            decode::<u16>(&after["featureOwner"])
        );
        assert_eq!(
            out.state.features,
            serde_json::from_value::<Vec<MapFeature>>(after["features"].clone()).unwrap()
        );
        assert_eq!(
            out.buildings,
            serde_json::from_value::<Vec<TileRect>>(after["buildings"].clone()).unwrap()
        );
        assert_eq!(out.masks.boxes, decode::<u8>(&after["landmarkBox"]));
        assert_eq!(out.masks.near1, decode::<u8>(&after["landmarkNear1"]));
        if i == 0 {
            assert_eq!(context.apply(&frame, &recipes).unwrap().unwrap(), out);
        }
    }
}
