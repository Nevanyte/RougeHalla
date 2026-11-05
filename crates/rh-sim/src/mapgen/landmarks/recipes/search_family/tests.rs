use super::*;
use crate::mapgen::{
    attempt::{begin_attempt, AttemptContext},
    coliseum,
    landmarks::{
        recipe_support::{self, RecipeInputs},
        runtime::{LandmarkRuntime, Stage4State, ZoneGeometry, ZoneInfo},
        templates::{parse_template, place_landmark, LandmarkTemplate, Stamp},
    },
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
};
const FIXTURE: &str = include_str!("../../../fixtures/landmark-recipes-search.json");
fn rle(v: &Value) -> Value {
    let mut out = Vec::<Value>::new();
    for x in v.as_array().unwrap() {
        if let Some(last) = out.last_mut() {
            if last[0] == *x {
                last[1] = json!(last[1].as_u64().unwrap() + 1);
                continue;
            }
        }
        out.push(json!([x, 1]))
    }
    json!(out)
}
fn snapshot(rt: &LandmarkRuntime<'_>) -> Value {
    let s = json!(rt.state());
    json!({"tiles":rle(&s["tiles"]),"terrain":rle(&s["terrain"]),"featureOwner":rle(&s["featureOwner"]),"features":s["features"],"wrote":rle(&s["wrote"]),"reserved":rle(&json!(rt.reserved())),"mark":rle(&s["scratch"]["mark"]),"qa":rle(&s["scratch"]["qa"]),"qb":rle(&s["scratch"]["qb"]),"epoch":s["scratch"]["epoch"],"counters":rt.counters()})
}
#[derive(Default)]
struct Observation {
    enabled: bool,
    callbacks: VecDeque<Value>,
    planning: VecDeque<Value>,
    searches: VecDeque<Value>,
    states: Value,
    seen: BTreeMap<
        usize,
        (
            Stage4State,
            Vec<u8>,
            crate::mapgen::landmarks::runtime::Counters,
        ),
    >,
}
thread_local! {static OBS:RefCell<Observation>=RefCell::new(Observation::default());}
pub(super) fn open(i: i32, result: bool) {
    OBS.with(|o| {
        let mut o = o.borrow_mut();
        if !o.enabled {
            return;
        }
        let e = o.callbacks.pop_front().expect("extra open");
        assert_eq!(e["type"], "open");
        assert_eq!(e["i"], i);
        assert_eq!(e["result"], result);
    })
}
pub(super) fn planning(k: usize, margin: f64, ext: &[u8], memo: &[u8]) {
    OBS.with(|o| {
        let mut o = o.borrow_mut();
        if !o.enabled {
            return;
        }
        let e = o.planning.pop_front().expect("extra margin");
        assert_eq!(e["k"], k);
        assert_eq!(e["margin"], margin);
        assert_eq!(e["ext"], rle(&json!(ext)));
        assert_eq!(e["wallOk"], rle(&json!(memo)));
    })
}
pub(super) fn callback(
    rt: &LandmarkRuntime<'_>,
    kind: &str,
    geometry: Value,
    rot: u8,
    mirror: bool,
    value: f64,
) {
    OBS.with(|o| {
        let mut o = o.borrow_mut();
        if !o.enabled {
            return;
        }
        let e = o.callbacks.pop_front().expect("extra callback");
        assert_eq!(e["type"], kind);
        assert_eq!(e[if kind == "score" { "stamp" } else { "box" }], geometry);
        assert_eq!(e["rot"], rot);
        assert_eq!(e["mirror"], mirror);
        assert_eq!(e["bits"], format!("{:016x}", value.to_bits()));
        let sid = e["stateId"].as_u64().unwrap() as usize;
        if let Some((s, r, c)) = o.seen.get(&sid) {
            assert_eq!(rt.state(), s);
            assert_eq!(rt.reserved(), r);
            assert_eq!(rt.counters(), *c)
        } else {
            assert_eq!(snapshot(rt), o.states[sid]);
            o.seen.insert(
                sid,
                (rt.state().clone(), rt.reserved().to_vec(), rt.counters()),
            );
        }
    })
}

pub(super) fn search(actual: &[Value]) {
    OBS.with(|o| {
        let mut o = o.borrow_mut();
        if !o.enabled {
            return;
        }
        let e = o.searches.pop_front().expect("extra search");
        let expected: Vec<Value> = e["trace"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| {
                matches!(
                    e["type"].as_str(),
                    Some(
                        "build"
                            | "reuse"
                            | "rebuild"
                            | "candidates"
                            | "shortlist"
                            | "attempt"
                            | "patch"
                    )
                )
            })
            .map(|e| {
                let mut e = e.clone();
                if e["type"] == "rebuild" {
                    e["type"] = json!("build");
                }
                if e["type"] == "attempt" {
                    let sid = e.as_object_mut().unwrap().remove("stateId").unwrap();
                    e["state"] = o.states[sid.as_u64().unwrap() as usize].clone();
                }
                e
            })
            .collect();
        let actual: Vec<_> = actual
            .iter()
            .filter(|v| e["sessionId"].is_number() || v["type"] != "patch")
            .cloned()
            .collect();
        fn exact(a: &Value, b: &Value, path: &str) {
            match (a, b) {
                (Value::Array(a), Value::Array(b)) => {
                    assert_eq!(a.len(), b.len(), "{path} length");
                    for (i, (a, b)) in a.iter().zip(b).enumerate() {
                        exact(a, b, &format!("{path}/{i}"));
                    }
                }
                (Value::Object(a), Value::Object(b)) => {
                    assert_eq!(a.len(), b.len(), "{path} keys");
                    for (k, v) in a {
                        exact(v, &b[k], &format!("{path}/{k}"));
                    }
                }
                _ => assert_eq!(a, b, "{path}"),
            }
        }
        exact(&json!(actual), &json!(expected), "search");
    })
}
#[test]
fn actual_recipes_match_source_callbacks_and_complete_zone_states() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(f["format"], "rh-landmark-recipes-search/1");
    assert_eq!(f["node"], "v22.23.4");
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 7);
    assert_eq!(f["sourceSha256"].as_object().unwrap().len(), 19);
    assert!(f["sourceSha256"]
        .as_object()
        .unwrap()
        .values()
        .all(|v| v.as_str().unwrap().len() == 64));
    assert_eq!(
        cases
            .iter()
            .map(|c| (
                c["seed"].as_i64().unwrap(),
                c["attempt"].as_u64().unwrap(),
                c["styledObserverControl"].as_bool().unwrap()
            ))
            .collect::<Vec<_>>(),
        [
            (1, 0, false),
            (-1, 0, false),
            (4294967297, 4294967296, false),
            (176, 0, false),
            (54, 0, false),
            (17, 1, false),
            (1, 0, true)
        ]
    );
    let keys: Vec<_> = f["sourceSha256"]
        .as_object()
        .unwrap()
        .keys()
        .map(|s| s.as_str())
        .collect();
    assert_eq!(
        keys,
        [
            "coliseum.ts",
            "gridTopology.ts",
            "map.ts",
            "mapgen.ts",
            "rng.ts",
            "styler.ts",
            "zoneStyle/context.ts",
            "zoneStyle/features.ts",
            "zoneStyle/gallows.ts",
            "zoneStyle/hook.ts",
            "zoneStyle/kit.ts",
            "zoneStyle/landmarks.ts",
            "zoneStyle/rime.ts",
            "zoneStyle/sanctum.ts",
            "zoneStyle/scale.ts",
            "zoneStyle/scorch.ts",
            "zoneStyle/styleZones.ts",
            "zoneStyle/types.ts",
            "zoneStyle/warren.ts"
        ]
    );
    let fixed = coliseum::fixed_layout();
    let fixed_rules = coliseum::default_definition();
    let common = recipe_support::default_definition();
    let scorch = scorch::Recipe::from_definition(&scorch::default_definition()).unwrap();
    let gallows = gallows::Recipe::from_definition(&gallows::default_definition()).unwrap();
    let templates: BTreeMap<String, _> = f["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let t: LandmarkTemplate = serde_json::from_value(v.clone()).unwrap();
            (t.key.clone(), parse_template(t).unwrap())
        })
        .collect();
    let mut target_zones = 0;
    for case in cases {
        assert_eq!(case["finalVerified"], true);
        let seed = case["seed"].as_i64().unwrap();
        let attempt = case["attempt"].as_u64().unwrap();
        let frame = begin_attempt(&AttemptContext::new(&fixed), seed, attempt)
            .unwrap()
            .unwrap();
        let rng_before = frame.rng.clone();
        assert_eq!(json!(frame.rng)["state"], case["main"]["before"]["state"]);
        assert_eq!(
            case["main"]["before"]["draws"],
            case["main"]["words"].as_array().unwrap().len()
        );
        let mut main_continuation = frame.rng.clone();
        assert_eq!(
            json!((0..3)
                .map(|_| format!("{:016x}", main_continuation.next_f64().to_bits()))
                .collect::<Vec<_>>()),
            case["main"]["before"]["continuation"]
        );
        assert_eq!(
            case["main"]["before"]["state"],
            case["main"]["after"]["state"]
        );
        assert_eq!(
            case["main"]["before"]["draws"],
            case["main"]["after"]["draws"]
        );

        let inputs = RecipeInputs::new(seed, attempt, &fixed, &fixed_rules, &common).unwrap();
        let events = case["events"].as_array().unwrap();
        let states = &case["states"];
        let input = &events.iter().find(|e| e["type"] == "stageInput").unwrap()["input"];
        assert_eq!(json!(frame.state.tiles), input["tiles"]);
        assert_eq!(json!(frame.state.partition.zone), input["zone"]);
        assert_eq!(
            json!(frame.state.layout.territory_grid),
            input["territoryGrid"]
        );
        let hard: Vec<u8> = serde_json::from_value(input["protect"].clone()).unwrap();
        let zone = &frame.state.partition.zone;
        let territory = &frame.state.layout.territory_grid;
        let mut state = Stage4State::new(
            coliseum::W,
            coliseum::H,
            frame.state.tiles.clone(),
            vec![],
            vec![0; coliseum::W * coliseum::H],
        );
        for (start, event) in events
            .iter()
            .enumerate()
            .filter(|(_, e)| e["type"] == "zoneStart")
        {
            let end = events[start + 1..]
                .iter()
                .position(|e| e["type"] == "zoneEnd")
                .unwrap()
                + start
                + 1;
            let info: ZoneInfo = serde_json::from_value(event["info"].clone()).unwrap();
            let g = ZoneGeometry::new(
                info.index,
                info.faction,
                zone,
                &state.tiles,
                coliseum::W,
                coliseum::H,
                &frame.state.style_camps,
            );
            assert_eq!(json!(g.info), event["info"]);
            assert_eq!(
                json!({"centroid":[format!("{:016x}",g.info.centroid.x.to_bits()),format!("{:016x}",g.info.centroid.y.to_bits())],"axis":[format!("{:016x}",g.info.axis.x.to_bits()),format!("{:016x}",g.info.axis.y.to_bits())]}),
                event["infoBits"]
            );
            assert_eq!(rle(&json!(g.mask)), event["mask"]);
            assert_eq!(rle(&json!(g.edge_dist)), event["edgeDist"]);
            let mut rt = LandmarkRuntime::new(
                &mut state,
                &g,
                &hard,
                Some(territory),
                &crate::mapgen::landmarks::runtime::default_definition(),
            );
            assert_eq!(
                snapshot(&rt),
                states[event["stateId"].as_u64().unwrap() as usize]
            );
            let target = matches!(
                info.faction,
                crate::mapdata::Zone::Fire | crate::mapdata::Zone::Sentenced
            );
            if target {
                target_zones += 1;
                let callbacks = events[start + 1..end]
                    .iter()
                    .filter(|e| e["type"] == "search")
                    .flat_map(|e| e["trace"].as_array().unwrap())
                    .filter(|e| {
                        matches!(e["type"].as_str(), Some("score" | "bound"))
                            || (info.faction == crate::mapdata::Zone::Fire && e["type"] == "open")
                    })
                    .cloned()
                    .collect();
                let planning = events[start + 1..end]
                    .iter()
                    .filter(|e| e["type"] == "margin")
                    .cloned()
                    .collect();
                OBS.with(|o| {
                    *o.borrow_mut() = Observation {
                        enabled: true,
                        callbacks,
                        planning,
                        searches: events[start + 1..end]
                            .iter()
                            .filter(|e| e["type"] == "search")
                            .cloned()
                            .collect(),
                        states: states.clone(),
                        seen: BTreeMap::new(),
                    }
                });
                if info.faction == crate::mapdata::Zone::Fire {
                    scorch.apply(&mut rt, &inputs)
                } else {
                    gallows.apply(&mut rt, &inputs)
                }
                OBS.with(|o| {
                    let mut o = o.borrow_mut();
                    assert!(o.callbacks.is_empty());
                    assert!(o.planning.is_empty());
                    assert!(o.searches.is_empty());
                    o.enabled = false;
                });
            } else {
                // Non-owned recipes are source placement replays only, preserving the shared scratch prefix.
                for e in &events[start + 1..end] {
                    let attempts: Vec<&Value> = if e["type"] == "search" {
                        e["trace"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .filter(|t| t["type"] == "attempt")
                            .collect()
                    } else if e["type"] == "place" {
                        vec![e]
                    } else {
                        vec![]
                    };
                    for a in attempts {
                        let (key, stamp, rot, mirror) = if e["type"] == "search" {
                            let o = a["o"].as_u64().unwrap() as u8;
                            let origin = a["origin"].as_i64().unwrap() as i32;
                            let key = e["template"]["key"].as_str().unwrap();
                            (
                                key,
                                crate::mapgen::landmarks::templates::stamp_template(
                                    &templates[key],
                                    origin % coliseum::W as i32,
                                    origin / coliseum::W as i32,
                                    o & 3,
                                    o >= 4,
                                    coliseum::W,
                                    coliseum::H,
                                )
                                .unwrap(),
                                o & 3,
                                o >= 4,
                            )
                        } else {
                            (
                                a["template"].as_str().unwrap(),
                                serde_json::from_value::<Stamp>(a["stamp"].clone()).unwrap(),
                                a["rot"].as_u64().unwrap() as u8,
                                a["mirror"].as_bool().unwrap(),
                            )
                        };
                        assert_eq!(
                            json!(place_landmark(
                                &mut rt,
                                &templates[key],
                                &stamp,
                                rot,
                                mirror
                            )),
                            a["result"]
                        );
                    }
                }
            }
            assert_eq!(
                snapshot(&rt),
                states[events[end]["stateId"].as_u64().unwrap() as usize],
                "{} zone {}",
                case["name"],
                info.index
            );
            let streams = inputs.streams(info.index);
            assert_eq!(json!(streams.landmark_seed), events[end]["stream"]["seed"]);
            assert_eq!(
                json!(streams.noise_seed),
                events[end]["stream"]["noiseSeed"]
            );
            let mut rng = streams.rng();
            let continuation: Vec<_> = (0..3)
                .map(|_| format!("{:016x}", rng.next_f64().to_bits()))
                .collect();
            assert_eq!(json!(continuation), events[end]["stream"]["continuation"]);
            assert_eq!(events[end]["stream"]["draws"], 0);
        }
        assert_eq!(frame.rng, rng_before);
        assert_eq!(json!(state.tiles), case["main"]["after"]["output"]["tiles"]);
        assert_eq!(
            json!(state.features),
            case["main"]["after"]["output"]["features"]
        );
        assert_eq!(
            json!(state.feature_owner),
            case["main"]["after"]["output"]["featureOwner"]
        );
    }
    assert_eq!(target_zones, 14);
}

// Synthetic definition probes are deliberately separate from captured map attempts.
fn synthetic_run(run: impl FnOnce(&mut LandmarkRuntime<'_>, &RecipeInputs<'_>)) -> Stage4State {
    let w = 60;
    let n = w * w;
    let mut labels = vec![0; n];
    for y in 1..w - 1 {
        for x in 1..w - 1 {
            labels[y * w + x] = 1
        }
    }
    let mut state = Stage4State::new(w, w, vec![crate::map::TILE_FLOOR; n], vec![], vec![0; n]);
    let g = ZoneGeometry::new(
        1,
        crate::mapdata::Zone::Fire,
        &labels,
        &state.tiles,
        w,
        w,
        &[],
    );
    let hard = vec![0; n];
    let rules = crate::mapgen::landmarks::runtime::LandmarkDefinition {
        footprint_percent: 100.0,
        rim_tiles: 0.0,
        join_checks: 128,
    };
    let fixed = coliseum::fixed_layout();
    let fixed_rules = coliseum::default_definition();
    let common = recipe_support::default_definition();
    let inputs = RecipeInputs::new(1, 0, &fixed, &fixed_rules, &common).unwrap();
    let mut rt = LandmarkRuntime::new(&mut state, &g, &hard, None, &rules);
    run(&mut rt, &inputs);
    state
}
#[test]
fn definitions_and_templates_are_live() {
    let s = scorch::default_definition();
    let normal = synthetic_run(|r, i| scorch::Recipe::from_definition(&s).unwrap().apply(r, i));
    assert_eq!(normal.features.len(), 2);
    let mut changed = s;
    changed.tries = 0;
    let empty = synthetic_run(|r, i| {
        scorch::Recipe::from_definition(&changed)
            .unwrap()
            .apply(r, i)
    });
    assert!(empty.features.is_empty());
    let mut a = vec![];
    let mut b = vec![];
    scorch::visit_content(&s, |v| a.push(v));
    scorch::visit_content(&changed, |v| b.push(v));
    assert_ne!(a, b);
    changed = s;
    changed.template.key = "mutated-forge";
    changed.template.jobs = &[crate::mapdata::FeatureJob::Rest];
    changed.template.rows = &["#d#", "#c#", "###"];
    let mutated = synthetic_run(|r, i| {
        scorch::Recipe::from_definition(&changed)
            .unwrap()
            .apply(r, i)
    });
    assert_ne!(normal, mutated);
    assert!(mutated
        .features
        .iter()
        .all(|f| f.variant == "mutated-forge" && f.jobs == [crate::mapdata::FeatureJob::Rest]));
    let g = gallows::default_definition();
    let normal = synthetic_run(|r, i| gallows::Recipe::from_definition(&g).unwrap().apply(r, i));
    assert_eq!(normal.features.len(), 2);
    let mut changed = g;
    changed.min_separation = 0.0;
    let mutated = synthetic_run(|r, i| {
        gallows::Recipe::from_definition(&changed)
            .unwrap()
            .apply(r, i)
    });
    assert_ne!(normal, mutated);
    a.clear();
    b.clear();
    gallows::visit_content(&g, |v| a.push(v));
    gallows::visit_content(&changed, |v| b.push(v));
    assert_ne!(a, b);
    changed = g;
    changed.template.key = "mutated-house";
    changed.template.jobs = &[crate::mapdata::FeatureJob::Rest];
    changed.template.rows = &["#d#", "#c#", "###"];
    let mutated = synthetic_run(|r, i| {
        gallows::Recipe::from_definition(&changed)
            .unwrap()
            .apply(r, i)
    });
    assert_ne!(normal, mutated);
    assert!(mutated
        .features
        .iter()
        .all(|f| f.variant == "mutated-house" && f.jobs == [crate::mapdata::FeatureJob::Rest]));
}

#[test]
fn synthetic_actual_callbacks_cover_refusal_continuation_and_no_camps() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let units = f["units"].as_array().unwrap();
    assert_eq!(
        units
            .iter()
            .map(|u| u["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "synthetic-gallows-first-refusal-second-still-runs",
            "synthetic-scorch-no-camps"
        ]
    );
    for unit in units {
        let i = &unit["input"];
        let w = i["w"].as_u64().unwrap() as usize;
        let h = i["h"].as_u64().unwrap() as usize;
        let zone: Vec<u8> = serde_json::from_value(i["zone"].clone()).unwrap();
        let hard: Vec<u8> = serde_json::from_value(i["protect"].clone()).unwrap();
        let events = unit["events"].as_array().unwrap();
        let start = events.iter().find(|e| e["type"] == "zoneStart").unwrap();
        let end = events.iter().find(|e| e["type"] == "zoneEnd").unwrap();
        let info: ZoneInfo = serde_json::from_value(start["info"].clone()).unwrap();
        let mut state = Stage4State::new(
            w,
            h,
            serde_json::from_value(i["tiles"].clone()).unwrap(),
            vec![],
            vec![0; w * h],
        );
        let g = ZoneGeometry::new(1, info.faction, &zone, &state.tiles, w, h, &[]);
        assert_eq!(g.info, info);
        let rules = serde_json::from_value(i["definition"].clone()).unwrap();
        let mut rt = LandmarkRuntime::new(&mut state, &g, &hard, None, &rules);
        let fixed = coliseum::fixed_layout();
        let fixed_rules = coliseum::default_definition();
        let common = recipe_support::default_definition();
        let inputs = RecipeInputs::new(1, 0, &fixed, &fixed_rules, &common).unwrap();
        let fire = info.faction == crate::mapdata::Zone::Fire;
        let callbacks = events
            .iter()
            .filter(|e| e["type"] == "search")
            .flat_map(|e| e["trace"].as_array().unwrap())
            .filter(|e| {
                matches!(e["type"].as_str(), Some("score" | "bound"))
                    || (fire && e["type"] == "open")
            })
            .cloned()
            .collect();
        let planning = events
            .iter()
            .filter(|e| e["type"] == "margin")
            .cloned()
            .collect();
        OBS.with(|o| {
            *o.borrow_mut() = Observation {
                enabled: true,
                callbacks,
                planning,
                searches: events
                    .iter()
                    .filter(|e| e["type"] == "search")
                    .cloned()
                    .collect(),
                states: unit["states"].clone(),
                seen: BTreeMap::new(),
            }
        });
        if fire {
            scorch::Recipe::from_definition(&scorch::default_definition())
                .unwrap()
                .apply(&mut rt, &inputs)
        } else {
            gallows::Recipe::from_definition(&gallows::default_definition())
                .unwrap()
                .apply(&mut rt, &inputs)
        }
        OBS.with(|o| {
            let mut o = o.borrow_mut();
            assert!(o.callbacks.is_empty());
            assert!(o.planning.is_empty());
            assert!(o.searches.is_empty());
            o.enabled = false;
        });
        assert_eq!(
            snapshot(&rt),
            unit["states"][end["stateId"].as_u64().unwrap() as usize]
        );
        if !fire {
            let searches: Vec<_> = events.iter().filter(|e| e["type"] == "search").collect();
            assert_eq!(searches.len(), 2);
            assert!(searches.iter().all(|s| s["result"].is_null()));
            assert_eq!(searches[0]["sessionId"], searches[1]["sessionId"]);
            assert!(searches[1]["trace"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["type"] == "reuse"));
            assert_eq!(rt.counters().refused, 24);
        }
    }
}

#[test]
fn every_live_definition_field_changes_content() {
    let base = scorch::default_definition();
    let mut expected = vec![];
    scorch::visit_content(&base, |v| expected.push(v));
    macro_rules! scalar {
        ($field:ident) => {{
            let mut d = base;
            d.$field += 1.0;
            let mut words = vec![];
            scorch::visit_content(&d, |v| words.push(v));
            assert_ne!(expected, words, stringify!($field));
        }};
    }
    scalar!(forge_disc);
    scalar!(radius_min4);
    scalar!(radius_max4);
    scalar!(radius_elite_max4);
    scalar!(radius_subtract);
    scalar!(score_margin);
    scalar!(distance_cap);
    scalar!(depth_min);
    scalar!(depth_max);
    scalar!(depth_bonus);
    scalar!(facing_weight);
    scalar!(noise_cell);
    scalar!(noise_salt);
    scalar!(noise_weight);
    let mut d = base;
    d.tries += 1;
    let mut words = vec![];
    scorch::visit_content(&d, |v| words.push(v));
    assert_ne!(expected, words);
    for q in 0..base.margins.len() {
        let mut margins = base.margins.to_vec();
        margins[q] += 1.0;
        let d = scorch::Definition {
            margins: &margins,
            ..base
        };
        words.clear();
        scorch::visit_content(&d, |v| words.push(v));
        assert_ne!(expected, words);
    }
    let base = gallows::default_definition();
    let mut expected = vec![];
    gallows::visit_content(&base, |v| expected.push(v));
    for d in [
        gallows::Definition {
            far: base.far + 1.0,
            ..base
        },
        gallows::Definition {
            min_separation: base.min_separation + 1.0,
            ..base
        },
    ] {
        words.clear();
        gallows::visit_content(&d, |v| words.push(v));
        assert_ne!(expected, words);
    }
    // Each actual template entry, including every row and every ordered job, is visited.
    for t in [
        scorch::default_definition().template,
        gallows::default_definition().template,
    ] {
        let mut baseline = vec![];
        t.visit_content(|v| baseline.push(v));
        for q in 0..t.rows.len() {
            let mut rows = t.rows.to_vec();
            let changed = format!("{}#", rows[q]);
            rows[q] = &changed;
            let changed = super::super::TemplateDefinition { rows: &rows, ..t };
            words.clear();
            changed.visit_content(|v| words.push(v));
            assert_ne!(baseline, words);
        }
        for q in 0..t.jobs.len() {
            let mut jobs = t.jobs.to_vec();
            jobs[q] = crate::mapdata::FeatureJob::Rest;
            let changed = super::super::TemplateDefinition { jobs: &jobs, ..t };
            words.clear();
            changed.visit_content(|v| words.push(v));
            assert_ne!(baseline, words);
        }
        let changed = super::super::TemplateDefinition {
            key: "changed",
            ..t
        };
        words.clear();
        changed.visit_content(|v| words.push(v));
        assert_ne!(baseline, words);
    }
}
