use crate::mapgen::landmarks::templates::{parse_template, stamp_template, LandmarkTemplate};
use serde_json::{json, Value};
const FIXTURE: &str = include_str!("../../fixtures/landmark-templates.json");
#[test]
fn captured_template_orientations_and_requirement_rectangles_match_actual_typescript() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let templates = f["actualTemplates"].as_array().unwrap();
    let requirements = f["requirements"].as_array().unwrap();
    let stamps = f["orientationAndWidthCases"].as_array().unwrap();
    let keys = ["forge", "burrow", "watchtower", "shrine", "guardHouse"];
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(templates.len(), keys.len());
    assert_eq!(requirements.len(), keys.len());
    assert_eq!(stamps.len(), keys.len());
    for (i, key) in keys.iter().enumerate() {
        assert_eq!(templates[i]["template"]["key"], *key);
        assert_eq!(requirements[i]["key"], *key);
        assert_eq!(stamps[i]["key"], *key);
        assert_eq!(requirements[i]["orientations"].as_array().unwrap().len(), 8);
        assert_eq!(stamps[i]["orientations"].as_array().unwrap().len(), 8);
    }
    assert_eq!(
        f["sparseCases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "sparse-admission-checks-only-non-underscore-cells",
            "sparse-stamp-rejects-non-underscore-outside-grid"
        ]
    );
    assert_eq!(
        f["actualCallerSource"]["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|case| (
                case["name"].as_str().unwrap(),
                case["events"].as_array().unwrap().len(),
                case["views"].as_array().unwrap().len(),
                case["states"].as_array().unwrap().len(),
                case["finalVerified"].as_bool().unwrap(),
                case["finalHash"].is_string()
            ))
            .collect::<Vec<_>>(),
        [
            ("actual-1-0", 243, 6, 42, true, true),
            ("actual--1-0", 199, 6, 27, true, true),
            ("actual-4294967297-4294967296", 315, 6, 47, true, true)
        ]
    );
    assert_eq!(
        f["actualCallerSource"]["sourceSha256"]
            .as_object()
            .unwrap()
            .len(),
        11
    );
    assert_eq!(f["actualCallerSource"]["actualSourceTaps"], true);
    assert_eq!(f["actualCallerSource"]["finalOutputEqualityRequired"], true);
    for (idx, entry) in templates.iter().enumerate() {
        let t: LandmarkTemplate = serde_json::from_value(entry["template"].clone()).unwrap();
        let parsed = parse_template(t).unwrap();
        assert_eq!(parsed.template.key, requirements[idx]["key"]);
        for o in 0..8 {
            let got = &parsed.orientations[o];
            let want = &requirements[idx]["orientations"][o];
            assert_eq!(
                json!({"bw":got.bw,"bh":got.bh,"count":got.count,"full":got.full,"dx":got.dx,"dy":got.dy,"code":got.code,"rects":got.rects}),
                *want,
                "{} orientation {o}",
                parsed.template.key
            );
            let expected = &stamps[idx]["orientations"][o]["stamp"];
            let actual = stamp_template(&parsed, 2, 3, (o & 3) as u8, o >= 4, 40, 40);
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                *expected,
                "{} stamp orientation {o}",
                parsed.template.key
            );
        }
        let first = stamp_template(&parsed, 2, 3, 0, false, 40, 40);
        let changed = stamp_template(&parsed, 2, 3, 0, false, 41, 40);
        assert_eq!(
            serde_json::to_value(first).unwrap(),
            stamps[idx]["changedWidth"]["first"]
        );
        assert_eq!(
            serde_json::to_value(changed).unwrap(),
            stamps[idx]["changedWidth"]["second"]
        );
    }
}
#[test]
fn sparse_templates_check_each_non_underscore_cell_for_bounds() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let t = LandmarkTemplate {
        key: "direct-sparse-bounds".into(),
        rows: vec!["#_d".into(), "._c".into()],
        jobs: vec![crate::mapdata::FeatureJob::Landmark],
    };
    let p = parse_template(t).unwrap();
    let a = stamp_template(&p, 2, 2, 0, false, 8, 8);
    assert_eq!(
        serde_json::to_value(a).unwrap(),
        f["sparseCases"][0]["stamp"]
    );
    assert!(stamp_template(&p, 6, 6, 0, false, 8, 8).is_none());

    let offset_template = LandmarkTemplate {
        key: "direct-int16-offset-wrap".into(),
        rows: vec![format!("{}#", "_".repeat(32768))],
        jobs: vec![],
    };
    let offset = parse_template(offset_template).unwrap();
    assert_eq!(
        f["int16OffsetCases"][0]["name"],
        "legacy-int32-offset-overflow-yields-invalid-runtime-index"
    );
    assert_eq!(
        f["int16OffsetCases"][0]["stamp"]["walls"],
        json!([4294967296u64])
    );
    assert!(stamp_template(&offset, 0, 32768, 1, false, 65537, 1).is_none());
    assert_eq!(
        f["int16OffsetCases"][1]["name"],
        "int16-coordinate-wrap-with-valid-final-index"
    );
    let valid_wrap = stamp_template(&offset, 0, 32768, 1, false, 1, 32769).unwrap();
    assert_eq!(
        serde_json::to_value(valid_wrap).unwrap(),
        f["int16OffsetCases"][1]["stamp"]
    );
    assert_eq!(
        f["invalidRuntimeGrids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["zero-width-grid", "area-exceeds-i32-runtime-index-space"]
    );
    assert!(stamp_template(&offset, 0, 0, 0, false, 0, 8).is_none());
    assert!(stamp_template(&offset, 0, 0, 0, false, 46_341, 46_341).is_none());
}
#[test]
fn fit_uses_the_planning_view_and_commit_preserves_parameter_and_reservation_order() {
    use crate::map::{TILE_FLOOR, TILE_WALL};
    use crate::mapdata::Zone;
    use crate::mapgen::landmarks::runtime::{
        LandmarkDefinition, LandmarkRuntime, Stage4State, ZoneGeometry,
    };
    use crate::mapgen::landmarks::templates::{place_landmark, stamp_fits, stamp_fits_with};
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let t = LandmarkTemplate {
        key: "direct-door-order".into(),
        rows: vec!["d#d".into(), "c.c".into()],
        jobs: vec![crate::mapdata::FeatureJob::Landmark],
    };
    let parsed = parse_template(t).unwrap();
    let stamp = stamp_template(&parsed, 3, 3, 0, true, 16, 16).unwrap();
    let n = 16 * 16;
    let tiles = vec![TILE_FLOOR; n];
    let zone = vec![1; n];
    let geom = ZoneGeometry::new(1, Zone::Fire, &zone, &tiles, 16, 16, &[]);
    let hard = vec![0; n];
    let mut state = Stage4State::new(16, 16, tiles, vec![], vec![0; n]);
    let rules = LandmarkDefinition {
        join_checks: 128,
        footprint_percent: 100.0,
        rim_tiles: 0.0,
    };
    let mut rt = LandmarkRuntime::new(&mut state, &geom, &hard, None, &rules);
    assert!(stamp_fits(&rt, &stamp));
    let mut planning_hard = hard.clone();
    planning_hard[stamp.floor[0] as usize] = 1;
    assert!(!stamp_fits_with(&rt, &stamp, &planning_hard, |i| rt.open(i)));
    assert!(!stamp_fits_with(&rt, &stamp, &hard, |_| false));
    assert!(stamp_fits_with(&rt, &stamp, &hard, |_| true));
    let expected = &f["placement"]["writes"][0];
    let actual = place_landmark(&mut rt, &parsed, &stamp, 0, true);
    assert!(
        actual.is_some(),
        "the direct whole wall should stand in open ground"
    );
    let feature = &rt.state().features[0];
    assert_eq!(feature.variant, "direct-door-order");
    assert_eq!(
        feature.p,
        expected["params"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap() as i32)
            .collect::<Vec<_>>()
    );
    assert_eq!(feature.jobs, vec![crate::mapdata::FeatureJob::Landmark]);
    let doors = stamp.doors.clone();
    assert_eq!(
        serde_json::to_value(&doors).unwrap(),
        f["placement"]["stampDoors"]
    );
    assert_eq!(
        f["placement"]["reserveEvents"],
        f["placement"]["stampDoors"]
    );
    let mut sorted = doors.clone();
    sorted.sort_unstable();
    assert_eq!(
        feature.p,
        vec![0, 1].into_iter().chain(sorted).collect::<Vec<_>>()
    );
    let reserved = rt.reserved();
    for &d in &doors {
        assert_eq!(reserved[d as usize], 1, "door reserve order/value");
    }
    for (i, &tile) in rt.state().tiles.iter().enumerate() {
        if stamp.walls.contains(&(i as i32)) {
            assert_eq!(tile, TILE_WALL);
        } else {
            assert!(tile == TILE_FLOOR || tile == TILE_WALL);
        }
    }
}

#[test]
fn empty_and_unicode_parser_boundaries_follow_javascript_cell_width() {
    let t = LandmarkTemplate {
        key: "empty".into(),
        rows: vec![],
        jobs: vec![],
    };
    let p = parse_template(t).unwrap();
    assert_eq!(p.orientations[0].bw, 0);
    assert!(stamp_template(&p, 99, 99, 0, false, 1, 1).is_some());
    let t = LandmarkTemplate {
        key: "unicode".into(),
        rows: vec!["#💫".into()],
        jobs: vec![],
    };
    assert_eq!(
        parse_template(t),
        Err(
            crate::mapgen::landmarks::templates::TemplateError::UnknownCell {
                x: 1,
                y: 0,
                cell: 0xd83d
            }
        )
    );
}
#[test]
fn landmark_gap_uses_the_registered_boundary_and_strict_overlap_comparisons() {
    use crate::map::TILE_FLOOR;
    use crate::mapdata::{FeatureKind, MapFeature, TileRect, Zone};
    use crate::mapgen::landmarks::runtime::{
        LandmarkDefinition, LandmarkRuntime, Stage4State, ZoneGeometry,
    };
    use crate::mapgen::landmarks::templates::{stamp_fits, LandmarkTemplate};
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let t = LandmarkTemplate {
        key: "direct-door-order".into(),
        rows: vec!["d#d".into(), "c.c".into()],
        jobs: vec![crate::mapdata::FeatureJob::Landmark],
    };
    let parsed = parse_template(t).unwrap();
    let stamp = stamp_template(&parsed, 3, 3, 0, true, 16, 16).unwrap();
    let n = 256;
    let tiles = vec![TILE_FLOOR; n];
    let zone = vec![1; n];
    let geom = ZoneGeometry::new(1, Zone::Fire, &zone, &tiles, 16, 16, &[]);
    let hard = vec![0; n];
    let rules = LandmarkDefinition {
        join_checks: 128,
        footprint_percent: 100.0,
        rim_tiles: 0.0,
    };
    let feature = |x| MapFeature {
        kind: FeatureKind::Landmark,
        variant: "prior".into(),
        zone: Zone::Fire,
        jobs: vec![crate::mapdata::FeatureJob::Landmark],
        ax: x,
        ay: 3,
        p: vec![],
        bbox: TileRect {
            x,
            y: 3,
            w: 1,
            h: 2,
        },
        tiles: 2,
    };
    let mut boundary = Stage4State::new(16, 16, tiles.clone(), vec![feature(9)], vec![0; n]);
    let rt = LandmarkRuntime::new(&mut boundary, &geom, &hard, None, &rules);
    assert_eq!(stamp_fits(&rt, &stamp), f["fits"]["gapBoundary"]["fits"]);
    let mut near = Stage4State::new(16, 16, tiles, vec![feature(8)], vec![0; n]);
    let rt = LandmarkRuntime::new(&mut near, &geom, &hard, None, &rules);
    assert_eq!(stamp_fits(&rt, &stamp), f["fits"]["gapNear"]["fits"]);
}
fn rle_len(value: &Value) -> usize {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|run| run[1].as_u64().unwrap() as usize)
        .sum()
}
fn expand_rle(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    for run in value.as_array().unwrap() {
        let v = run[0].as_u64().unwrap() as u8;
        let n = run[1].as_u64().unwrap() as usize;
        out.extend(std::iter::repeat_n(v, n));
    }
    out
}

fn rle_json(value: &Value) -> Value {
    let values = value.as_array().expect("serialized runtime vector");
    let mut runs: Vec<Value> = Vec::new();
    for item in values {
        if let Some(last) = runs.last_mut() {
            if last[0] == *item {
                last[1] = json!(last[1].as_u64().unwrap() + 1);
                continue;
            }
        }
        runs.push(json!([item, 1]));
    }
    Value::Array(runs)
}

fn runtime_snapshot(runtime: &crate::mapgen::landmarks::runtime::LandmarkRuntime<'_>) -> Value {
    let state = serde_json::to_value(runtime.state()).unwrap();
    json!({
        "tiles": rle_json(&state["tiles"]),
        "terrain": rle_json(&state["terrain"]),
        "featureOwner": rle_json(&state["featureOwner"]),
        "features": state["features"],
        "wrote": rle_json(&state["wrote"]),
        "reserved": rle_json(&serde_json::to_value(runtime.reserved()).unwrap()),
        "mark": rle_json(&state["scratch"]["mark"]),
        "qa": rle_json(&state["scratch"]["qa"]),
        "qb": rle_json(&state["scratch"]["qb"]),
        "epoch": state["scratch"]["epoch"],
        "counters": serde_json::to_value(runtime.counters()).unwrap()
    })
}

#[test]
fn real_tapped_stamp_fit_place_and_reservation_calls_match_rust() {
    use crate::mapdata::{FeatureJob, FeatureKind, MapFeature, TileRect, Zone};
    use crate::mapgen::landmarks::runtime::{
        LandmarkDefinition, LandmarkRuntime, Stage4State, ZoneGeometry,
    };
    use crate::mapgen::landmarks::templates::{stamp_fits_with, LandmarkTemplate, Stamp};
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let mut templates = std::collections::BTreeMap::new();
    for item in f["actualTemplates"].as_array().unwrap() {
        let t: LandmarkTemplate = serde_json::from_value(item["template"].clone()).unwrap();
        templates.insert(t.key.clone(), parse_template(t).unwrap());
    }
    let mut fit_count = 0usize;
    let mut stamp_count = 0usize;
    let mut place_count = 0usize;
    let mut variants = std::collections::BTreeSet::new();
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(f["actualTemplates"].as_array().unwrap().len(), 5);
    assert_eq!(f["actualCallerSource"]["actualSourceTaps"], true);
    assert_eq!(f["actualCallerSource"]["finalOutputEqualityRequired"], true);
    assert_eq!(
        f["actualCallerSource"]["sourceSha256"]
            .as_object()
            .unwrap()
            .len(),
        11
    );
    let cases = f["actualCallerSource"]["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3);
    let expected_counts = [
        ("actual-1-0", 37, 34, 54, 5, 42),
        ("actual--1-0", 22, 40, 49, 5, 27),
        ("actual-4294967297-4294967296", 42, 68, 77, 5, 47),
    ];
    for (case, (name, places, fits, stamps, zones, states)) in cases.iter().zip(expected_counts) {
        let events = case["events"].as_array().unwrap();
        assert_eq!(case["name"], name);
        assert_eq!(case["finalVerified"], true);
        assert!(!case["finalHash"].is_null());
        assert_eq!(
            events
                .iter()
                .filter(|e| e["type"] == "placeLandmark")
                .count(),
            places
        );
        assert_eq!(events.iter().filter(|e| e["type"] == "fits").count(), fits);
        assert_eq!(
            events.iter().filter(|e| e["type"] == "stamp").count(),
            stamps
        );
        assert_eq!(
            events.iter().filter(|e| e["type"] == "zoneStart").count(),
            zones
        );
        assert_eq!(case["states"].as_array().unwrap().len(), states);
        assert_eq!(case["views"].as_array().unwrap().len(), 6);
    }
    for case in cases {
        assert_eq!(case["finalVerified"], true);
        let n = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "stageInput")
            .unwrap()["input"]["w"]
            .as_u64()
            .unwrap() as usize
            * case["events"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["type"] == "stageInput")
                .unwrap()["input"]["h"]
                .as_u64()
                .unwrap() as usize;
        for event in case["events"].as_array().unwrap() {
            match event["type"].as_str().unwrap() {
                "stamp" => {
                    let key = event["template"].as_str().unwrap();
                    let p = &templates[key];
                    let actual = stamp_template(
                        p,
                        event["x0"].as_i64().unwrap() as i32,
                        event["y0"].as_i64().unwrap() as i32,
                        event["rot"].as_u64().unwrap() as u8,
                        event["mirror"].as_bool().unwrap(),
                        event["w"].as_u64().unwrap() as usize,
                        event["h"].as_u64().unwrap() as usize,
                    );
                    assert_eq!(
                        serde_json::to_value(actual).unwrap(),
                        event["stamp"],
                        "actual {key} stamp"
                    );
                    stamp_count += 1;
                }
                "fits" => {
                    let s: Stamp = serde_json::from_value(event["stamp"].clone()).unwrap();
                    let view = &case["views"][event["viewId"].as_u64().unwrap() as usize];
                    let w = view["w"].as_u64().unwrap() as usize;
                    let h = view["h"].as_u64().unwrap() as usize;
                    assert_eq!(w * h, n);
                    let tiles = expand_rle(&view["tiles"]);
                    let mask = expand_rle(&view["mask"]);
                    let hard = expand_rle(&view["hard"]);
                    let owned = expand_rle(&view["owned"]);
                    let open = expand_rle(&view["open"]);
                    assert_eq!(tiles.len(), n);
                    assert_eq!(mask.len(), n);
                    assert_eq!(hard.len(), n);
                    assert_eq!(owned.len(), n);
                    assert_eq!(open.len(), n);
                    let mut features: Vec<MapFeature> =
                        serde_json::from_value(view["features"].clone()).unwrap();
                    let faction: Zone =
                        serde_json::from_value(view["zone"]["faction"].clone()).unwrap();
                    if owned.iter().any(|&v| v != 0) && features.is_empty() {
                        features.push(MapFeature {
                            kind: FeatureKind::Bush,
                            variant: "owner-sentinel".into(),
                            zone: faction,
                            jobs: vec![FeatureJob::Landmark],
                            ax: 0,
                            ay: 0,
                            p: vec![],
                            bbox: TileRect {
                                x: 0,
                                y: 0,
                                w: 0,
                                h: 0,
                            },
                            tiles: 0,
                        });
                    }
                    let owners: Vec<u16> = owned.iter().map(|&v| u16::from(v != 0)).collect();
                    let state = Stage4State::new(w, h, tiles.clone(), features.clone(), owners);
                    let zone: Vec<u8> = mask.iter().map(|&v| if v == 0 { 0 } else { 1 }).collect();
                    let geometry = ZoneGeometry::new(1, faction, &zone, &tiles, w, h, &[]);
                    let rules = LandmarkDefinition {
                        join_checks: 128,
                        footprint_percent: 4.0,
                        rim_tiles: 3.0,
                    };
                    let mut state = state;
                    let runtime = LandmarkRuntime::new(&mut state, &geometry, &hard, None, &rules);
                    let actual = stamp_fits_with(&runtime, &s, &hard, |i| {
                        usize::try_from(i)
                            .ok()
                            .filter(|&i| i < open.len())
                            .is_some_and(|i| open[i] != 0)
                    });
                    assert_eq!(
                        actual,
                        event["result"].as_bool().unwrap(),
                        "actual fit view {}/{}",
                        case["name"],
                        fit_count
                    );
                    fit_count += 1;
                }
                "placeLandmark" => {
                    let key = event["template"].as_str().unwrap();
                    variants.insert(key.to_string());
                    let t = &templates[key];
                    let s: Stamp = serde_json::from_value(event["stamp"].clone()).unwrap();
                    let stage = case["events"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|e| e["type"] == "stageInput")
                        .unwrap();
                    let i = case["events"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .position(|e| e == event)
                        .unwrap();
                    let mut request = None;
                    let mut actual_result = None;
                    let mut reserve_order = Vec::new();
                    for previous in case["events"].as_array().unwrap()[..i].iter().rev() {
                        if previous["type"] == "placeLandmark" {
                            break;
                        }
                        if previous["type"] == "reserve" {
                            reserve_order.push(previous["tile"].as_i64().unwrap() as i32);
                        }
                        if previous["type"] == "featureAfter" {
                            actual_result = Some(previous["result"].clone());
                        }
                        if previous["type"] == "featureBefore" {
                            request = Some(previous["spec"].clone());
                            break;
                        }
                    }
                    reserve_order.reverse();
                    let req = request.expect("actual helper call has actual placeFeature input");
                    let rebuilt = stamp_template(
                        t,
                        s.bbox.x,
                        s.bbox.y,
                        event["rot"].as_u64().unwrap() as u8,
                        event["mirror"].as_bool().unwrap(),
                        stage["input"]["w"].as_u64().unwrap() as usize,
                        stage["input"]["h"].as_u64().unwrap() as usize,
                    )
                    .unwrap();
                    assert_eq!(rebuilt, s, "actual place stamp {key}");
                    assert_eq!(req["variant"], key);
                    assert_eq!(req["anchor"], json!([s.bbox.x, s.bbox.y]));
                    assert_eq!(
                        serde_json::to_value(
                            s.walls
                                .iter()
                                .map(|&tile| json!([tile, "wall"]))
                                .collect::<Vec<_>>()
                        )
                        .unwrap(),
                        req["blocks"]
                    );
                    let mut floor = s.floor.clone();
                    floor.extend_from_slice(&s.doors);
                    floor.extend_from_slice(&s.nooks);
                    floor.extend_from_slice(&s.lights);
                    assert_eq!(serde_json::to_value(floor).unwrap(), req["floor"]);
                    let mut doors = s.doors.clone();
                    doors.sort_unstable();
                    let mut params = vec![
                        i64::from(event["rot"].as_u64().unwrap() as u8),
                        i64::from(event["mirror"].as_bool().unwrap()),
                    ];
                    params.extend(doors.iter().map(|&d| i64::from(d)));
                    assert_eq!(serde_json::to_value(params).unwrap(), req["params"]);
                    if event["result"].is_null() {
                        assert!(
                            reserve_order.is_empty(),
                            "refused placements do not reserve doors"
                        );
                    } else {
                        assert_eq!(
                            serde_json::to_value(reserve_order).unwrap(),
                            serde_json::to_value(&s.doors).unwrap()
                        );
                    }
                    assert_eq!(
                        event["result"],
                        actual_result.expect("actual feature result")
                    );
                    let sid = event["stateId"].as_u64().unwrap() as usize;
                    let state = &case["states"][sid];
                    for name in [
                        "tiles",
                        "terrain",
                        "featureOwner",
                        "wrote",
                        "reserved",
                        "mark",
                        "qa",
                        "qb",
                    ] {
                        assert_eq!(rle_len(&state[name]), n, "{name} state length");
                    }
                    assert!(state["counters"].is_object());
                    place_count += 1;
                }
                _ => {}
            }
        }
    }
    assert_eq!(stamp_count, 180);
    assert_eq!(fit_count, 142);
    assert_eq!(place_count, 101);
    assert_eq!(
        variants,
        std::collections::BTreeSet::from([
            "forge".into(),
            "burrow".into(),
            "watchtower".into(),
            "shrine".into(),
            "guardHouse".into()
        ])
    );
}

#[test]
fn actual_callbacks_match_every_committed_stage4_runtime_snapshot() {
    use crate::mapdata::MapFeature;
    use crate::mapgen::attempt::StyleCamp;
    use crate::mapgen::landmarks::runtime::{
        LandmarkDefinition, LandmarkRuntime, Stage4State, ZoneGeometry, ZoneInfo,
    };
    use crate::mapgen::landmarks::templates::{place_landmark, LandmarkTemplate, Stamp};
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let mut templates = std::collections::BTreeMap::new();
    for item in fixture["actualTemplates"].as_array().unwrap() {
        let template: LandmarkTemplate = serde_json::from_value(item["template"].clone()).unwrap();
        templates.insert(template.key.clone(), parse_template(template).unwrap());
    }
    let mut compared_placements = 0;
    let mut compared_zones = 0;

    for case in fixture["actualCallerSource"]["cases"].as_array().unwrap() {
        assert_eq!(case["finalVerified"], true, "unverified {:?}", case["name"]);
        let events = case["events"].as_array().unwrap();
        let stage = &events
            .iter()
            .find(|event| event["type"] == "stageInput")
            .expect("actual stage-4 input")["input"];
        let w = stage["w"].as_u64().unwrap() as usize;
        let h = stage["h"].as_u64().unwrap() as usize;
        let zone: Vec<u8> = serde_json::from_value(stage["zone"].clone()).unwrap();
        let hard: Vec<u8> = serde_json::from_value(stage["protect"].clone()).unwrap();
        let territory: Vec<u8> = serde_json::from_value(stage["territoryGrid"].clone()).unwrap();
        let tiles: Vec<u8> = serde_json::from_value(stage["tiles"].clone()).unwrap();
        let feature_owner: Vec<u16> =
            serde_json::from_value(stage["featureOwner"].clone()).unwrap();
        let style_camps: Vec<StyleCamp> = stage["camps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|camp| StyleCamp {
                site: camp["site"].as_u64().unwrap() as usize,
                r: camp["r"].as_f64().unwrap(),
                territory: camp["territory"].as_u64().unwrap() as u8,
                elite: camp["elite"].as_bool().unwrap(),
            })
            .collect();
        let mut state = Stage4State::new(w, h, tiles, Vec::<MapFeature>::new(), feature_owner);
        let rules = LandmarkDefinition {
            join_checks: 128,
            footprint_percent: 4.0,
            rim_tiles: 3.0,
        };
        let mut last_place;

        for (event_index, event) in events.iter().enumerate() {
            if event["type"] != "zoneStart" {
                continue;
            }
            last_place = None;
            let index = event["index"].as_u64().unwrap() as u8;
            let source_info: ZoneInfo = serde_json::from_value(event["info"].clone()).unwrap();
            let geometry = ZoneGeometry::new(
                index,
                source_info.faction,
                &zone,
                &state.tiles,
                w,
                h,
                &style_camps,
            );
            assert_eq!(
                serde_json::to_value(&geometry.info).unwrap(),
                event["info"],
                "zone summary {} in {:?}",
                index,
                case["name"]
            );
            assert_eq!(
                rle_json(&serde_json::to_value(&geometry.mask).unwrap()),
                event["mask"],
                "zone mask {} in {:?}",
                index,
                case["name"]
            );
            assert_eq!(
                rle_json(&serde_json::to_value(&geometry.edge_dist).unwrap()),
                event["edgeDist"],
                "zone edge field {} in {:?}",
                index,
                case["name"]
            );
            assert_eq!(
                serde_json::to_value(&geometry.camps).unwrap(),
                event["camps"],
                "zone camp views {} in {:?}",
                index,
                case["name"]
            );

            let mut runtime =
                LandmarkRuntime::new(&mut state, &geometry, &hard, Some(&territory), &rules);
            let expected_start = &case["states"][event["stateId"].as_u64().unwrap() as usize];
            assert_eq!(
                runtime_snapshot(&runtime),
                *expected_start,
                "runtime state at zone {} in {:?}",
                index,
                case["name"]
            );
            compared_zones += 1;

            let zone_end = events[event_index + 1..]
                .iter()
                .position(|next| next["type"] == "zoneStart")
                .map_or(events.len(), |offset| event_index + 1 + offset);
            for current in event_index + 1..zone_end {
                if events[current]["type"] != "placeLandmark" {
                    continue;
                }
                let segment_start = last_place.map_or(event_index + 1, |p| p + 1);
                let request_index = (segment_start..current)
                    .rev()
                    .find(|&i| events[i]["type"] == "featureBefore")
                    .expect("actual landmark FeatureSpec");
                let feature_after = (request_index + 1..current)
                    .find(|&i| events[i]["type"] == "featureAfter")
                    .expect("actual FeatureSpec result");
                let request = &events[request_index]["spec"];
                let key = events[current]["template"].as_str().unwrap();
                let template = &templates[key];
                let stamp: Stamp =
                    serde_json::from_value(events[current]["stamp"].clone()).unwrap();
                assert_eq!(request["variant"], key);
                let placed = place_landmark(
                    &mut runtime,
                    template,
                    &stamp,
                    events[current]["rot"].as_u64().unwrap() as u8,
                    events[current]["mirror"].as_bool().unwrap(),
                );
                assert_eq!(
                    serde_json::to_value(&placed).unwrap(),
                    events[feature_after]["result"],
                    "transaction result {} in {:?}",
                    key,
                    case["name"]
                );
                assert_eq!(
                    events[current]["result"], events[feature_after]["result"],
                    "landmark result {} in {:?}",
                    key, case["name"]
                );

                let expected_final =
                    &case["states"][events[current]["stateId"].as_u64().unwrap() as usize];
                let reserve_events: Vec<i32> = events[feature_after + 1..current]
                    .iter()
                    .filter(|e| e["type"] == "reserve")
                    .map(|e| e["tile"].as_i64().unwrap() as i32)
                    .collect();
                if placed.is_some() {
                    assert_eq!(reserve_events, stamp.doors);
                } else {
                    assert!(reserve_events.is_empty());
                }
                assert_eq!(
                    runtime_snapshot(&runtime),
                    *expected_final,
                    "complete runtime state after {} in {:?}",
                    key,
                    case["name"]
                );
                compared_placements += 1;
                last_place = Some(current);
            }
            drop(runtime);
        }
    }
    assert_eq!(compared_zones, 15);
    assert_eq!(compared_placements, 101);
}
