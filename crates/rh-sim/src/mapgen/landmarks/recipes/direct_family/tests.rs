use super::*;
use crate::mapgen::{
    attempt::{begin_attempt, AttemptContext},
    coliseum::{default_definition as fixed_definition, fixed_layout},
    landmarks::{
        recipe_support::{self, RecipeInputs},
        runtime::{self, LandmarkSpec, Stage4State, ZoneGeometry},
    },
};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
};
const FIXTURE: &str = include_str!("../../../fixtures/landmark-recipes-direct.json");
fn expand<T: serde::de::DeserializeOwned + Clone>(v: &Value) -> Vec<T> {
    v.as_array()
        .unwrap()
        .iter()
        .flat_map(|r| {
            std::iter::repeat_n(
                serde_json::from_value::<T>(r[0].clone()).unwrap(),
                r[1].as_u64().unwrap() as usize,
            )
        })
        .collect()
}
fn rle(v: &Value) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for x in v.as_array().unwrap() {
        if let Some(last) = out.last_mut() {
            if last[0] == *x {
                last[1] = json!(last[1].as_u64().unwrap() + 1);
                continue;
            }
        }
        out.push(json!([x, 1]));
    }
    json!(out)
}
fn snapshot(rt: &LandmarkRuntime<'_>) -> Value {
    snapshot_parts(rt.state(), rt.reserved(), rt.counters())
}
fn snapshot_parts(state: &Stage4State, reserved: &[u8], counters: runtime::Counters) -> Value {
    let s = serde_json::to_value(state).unwrap();
    json!({"tiles":rle(&s["tiles"]),"terrain":rle(&s["terrain"]),"featureOwner":rle(&s["featureOwner"]),"features":s["features"],"wrote":rle(&s["wrote"]),"reserved":rle(&json!(reserved)),"mark":rle(&s["scratch"]["mark"]),"qa":rle(&s["scratch"]["qa"]),"qb":rle(&s["scratch"]["qb"]),"epoch":s["scratch"]["epoch"],"counters":counters})
}
#[derive(Default)]
struct Transcript {
    searches: VecDeque<SearchTranscript>,
    events: VecDeque<Value>,
    states: Vec<Value>,
    checked: BTreeMap<usize, (Stage4State, Vec<u8>, runtime::Counters)>,
}
struct SearchTranscript {
    diagnostics: Vec<Value>,
    opens: Vec<Value>,
    boundary: usize,
}
thread_local! {static TRACE:RefCell<Option<Transcript>>=const{RefCell::new(None)};}
pub(super) fn observe(rt: Option<&LandmarkRuntime<'_>>, event: Value) {
    TRACE.with(|t| {
        let mut t = t.borrow_mut();
        let Some(t) = t.as_mut() else { return };
        let mut expected = t.events.pop_front().expect("unexpected direct call");
        let sid = expected
            .as_object_mut()
            .unwrap()
            .remove("state")
            .unwrap()
            .as_u64()
            .unwrap() as usize;
        expected.as_object_mut().unwrap().remove("inSearch");
        same_json(&event, &expected, "event");
        if let Some(rt) = rt {
            if let Some((state, reserved, counters)) = t.checked.get(&sid) {
                assert_eq!(rt.state(), state);
                assert_eq!(rt.reserved(), reserved);
                assert_eq!(rt.counters(), *counters);
            } else {
                assert_eq!(snapshot(rt), t.states[sid], "boundary state differs");
                t.checked.insert(
                    sid,
                    (rt.state().clone(), rt.reserved().to_vec(), rt.counters()),
                );
            }
        }
    });
}
fn source_spec(v: &Value) -> LandmarkSpec {
    assert_eq!(v["kind"], "landmark");
    assert_eq!(v["mode"], "whole");
    let blocks = v["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            assert_eq!(b[1], "wall");
            b[0].as_i64().unwrap() as i32
        })
        .collect();
    LandmarkSpec {
        variant: v["variant"].as_str().unwrap().into(),
        jobs: serde_json::from_value(v["jobs"].clone()).unwrap(),
        anchor: serde_json::from_value(v["anchor"].clone()).unwrap(),
        params: serde_json::from_value(v["params"].clone()).unwrap(),
        blocks,
        floor: serde_json::from_value(v["floor"].clone()).unwrap(),
    }
}
#[test]
fn actual_direct_recipes_match_source_on_recomputed_prefix() {
    let corpus: Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(corpus["format"], "rh-landmark-recipes-direct/1");
    assert_eq!(corpus["node"], "v22.23.4");
    assert_eq!(corpus["platform"], "linux");
    assert_eq!(corpus["arch"], "x64");
    validate_corpus_inventory(&corpus).unwrap();
    let cases = corpus["cases"].as_array().unwrap();
    let fixed = fixed_layout();
    let fixed_rules = fixed_definition();
    let rules = recipe_support::default_definition();
    let context = AttemptContext::new(&fixed);
    let rime = rime::Recipe::from_definition(&rime::default_definition()).unwrap();
    let sanctum = sanctum::Recipe::from_definition(&sanctum::default_definition()).unwrap();
    let warren = warren::Recipe::from_definition(&warren::default_definition()).unwrap();
    let mut seen = std::collections::BTreeSet::new();
    for case in cases {
        let seed = case["seed"].as_i64().unwrap();
        let attempt = case["attempt"].as_u64().unwrap();
        assert_eq!(case["completeFinalOutputEquality"], true);
        let frame = begin_attempt(&context, seed, attempt).unwrap().unwrap();
        let main = frame.rng.clone();
        assert_eq!(
            serde_json::to_value(&main).unwrap()["state"],
            case["main"]["stateBefore"]
        );
        assert_eq!(case["main"]["stateBefore"], case["main"]["stateAfter"]);
        let stage = &case["stage"];
        let zone: Vec<u8> = serde_json::from_value(stage["zone"].clone()).unwrap();
        assert_eq!(
            frame.state.tiles,
            serde_json::from_value::<Vec<u8>>(stage["tiles"].clone()).unwrap()
        );
        assert_eq!(frame.state.partition.zone, zone);
        assert_eq!(
            frame.state.layout.territory_grid,
            serde_json::from_value::<Vec<u8>>(stage["territoryGrid"].clone()).unwrap()
        );
        let w = stage["w"].as_u64().unwrap() as usize;
        let h = stage["h"].as_u64().unwrap() as usize;
        let hard: Vec<u8> = serde_json::from_value(stage["protect"].clone()).unwrap();
        let mut state = Stage4State::new(w, h, frame.state.tiles.clone(), vec![], vec![0; w * h]);
        let inputs = RecipeInputs::new(seed, attempt, &fixed, &fixed_rules, &rules).unwrap();
        let zones = case["zones"].as_array().unwrap();
        assert_eq!(zones.len(), 5);
        for z in zones {
            let index = z["index"].as_u64().unwrap() as u8;
            let faction = serde_json::from_value(z["faction"].clone()).unwrap();
            let geometry = ZoneGeometry::new(
                index,
                faction,
                &zone,
                &state.tiles,
                w,
                h,
                &frame.state.style_camps,
            );
            assert_eq!(serde_json::to_value(&geometry.info).unwrap(), z["info"]);
            for (i, v) in [
                geometry.info.centroid.x,
                geometry.info.centroid.y,
                geometry.info.axis.x,
                geometry.info.axis.y,
            ]
            .iter()
            .enumerate()
            {
                assert_eq!(
                    format!("{:016x}", v.to_bits()),
                    z["infoBits"][i].as_str().unwrap()
                );
            }
            assert_eq!(geometry.mask, expand::<u8>(&z["mask"]));
            assert_eq!(geometry.edge_dist, expand::<i32>(&z["edgeDist"]));
            let mut rt = LandmarkRuntime::new(
                &mut state,
                &geometry,
                &hard,
                Some(&frame.state.layout.territory_grid),
                &runtime::default_definition(),
            );
            let states = case["states"].as_array().unwrap();
            assert!(!states.is_empty());
            assert_eq!(
                snapshot(&rt),
                states[z["before"].as_u64().unwrap() as usize]
            );
            let faction = z["faction"].as_str().unwrap();
            let events = z["events"].as_array().unwrap();
            assert!(!events.is_empty());
            if matches!(faction, "frost" | "holy" | "plague") {
                TRACE.with(|t| {
                    *t.borrow_mut() = Some(Transcript {
                        searches: search_transcripts(&z["events"], states),
                        events: direct_events(&z["events"]),
                        states: states.clone(),
                        checked: BTreeMap::new(),
                    })
                });
                match faction {
                    "frost" => rime.apply(&mut rt, &inputs),
                    "holy" => sanctum.apply(&mut rt, &inputs),
                    "plague" => warren.apply(&mut rt, &inputs),
                    _ => unreachable!(),
                };
                TRACE.with(|t| {
                    let t = t.borrow_mut().take().unwrap();
                    assert!(t.events.is_empty(), "unconsumed direct calls");
                    assert!(t.searches.is_empty(), "unconsumed fallback search");
                });
                seen.insert(faction.to_owned());
            } else {
                // Foreign recipe callbacks are infrastructure replay only. The parent gate replaces these with the other live leaf.
                for e in events {
                    match e["type"].as_str().unwrap() {
                        "transactionBefore" => {
                            rt.place_whole(&source_spec(&e["spec"]));
                        }
                        "reserve" => rt.reserve(e["i"].as_i64().unwrap() as i32),
                        "transactionAfter" | "stamp" | "fit" | "place" | "searchOptions"
                        | "searchStart" | "searchOpen" | "searchTables" | "searchCandidates"
                        | "searchScore" | "searchShortlist" | "searchAttempt" | "searchPatch"
                        | "searchEnd" => {}
                        kind => panic!("unexpected foreign infrastructure event {kind}"),
                    }
                }
            }
            assert_eq!(
                snapshot(&rt),
                states[z["after"].as_u64().unwrap() as usize],
                "{seed}/{attempt} {faction} final state"
            );
            let streams = inputs.streams(index);
            assert_eq!(
                streams.landmark_seed,
                z["stream"]["streamSeed"].as_u64().unwrap() as u32
            );
            assert_eq!(
                streams.noise_seed,
                z["stream"]["noiseSeed"].as_u64().unwrap() as u32
            );
            assert_eq!(z["stream"]["draws"], 0);
            assert_eq!(z["stream"]["initialState"], z["stream"]["finalState"]);
            assert_eq!(z["stream"]["finalState"], z["stream"]["streamSeed"]);
            let mut rng = streams.rng();
            for b in z["stream"]["continuation"].as_array().unwrap() {
                assert_eq!(
                    format!("{:016x}", rng.next_f64().to_bits()),
                    b.as_str().unwrap()
                );
            }
        }
        assert_eq!(frame.rng, main);
        let mut rng = main;
        for b in case["main"]["continuation"].as_array().unwrap() {
            assert_eq!(
                format!("{:016x}", rng.next_f64().to_bits()),
                b.as_str().unwrap()
            );
        }
    }
    assert_eq!(seen.len(), 3);
}

fn same_json(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(
            a.as_f64().unwrap().to_bits(),
            b.as_f64().unwrap().to_bits(),
            "{path}: {a} != {b}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path} length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                same_json(a, b, &format!("{path}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.len(),
                b.len(),
                "{path} keys {:?} != {:?}",
                a.keys(),
                b.keys()
            );
            for (k, a) in a {
                same_json(a, b.get(k).expect("missing key"), &format!("{path}.{k}"));
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
fn direct_events(events: &Value) -> VecDeque<Value> {
    events
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| match event_kind(e).unwrap() {
            EventKind::Direct => !e["inSearch"].as_bool().unwrap(),
            EventKind::Score => true,
            EventKind::Search => false,
        })
        .cloned()
        .collect()
}
#[test]
fn labelled_source_synthetic_boundaries_match_actual_helpers() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    validate_corpus_inventory(&f).unwrap();
    let units = f["synthetic"].as_array().unwrap();
    let fixed = fixed_layout();
    let fixed_rules = fixed_definition();
    let rules = recipe_support::default_definition();
    let inputs = RecipeInputs::new(1, 0, &fixed, &fixed_rules, &rules).unwrap();
    for unit in units {
        let input = &unit["input"];
        let w = input["w"].as_u64().unwrap() as usize;
        let h = input["h"].as_u64().unwrap() as usize;
        let tiles: Vec<u8> = serde_json::from_value(input["tiles"].clone()).unwrap();
        let zone: Vec<u8> = serde_json::from_value(input["mask"].clone()).unwrap();
        let hard: Vec<u8> = serde_json::from_value(input["hard"].clone()).unwrap();
        let camps: Vec<runtime::CampInfo> = serde_json::from_value(input["camps"].clone()).unwrap();
        let camps = camps
            .iter()
            .map(|c| crate::mapgen::attempt::StyleCamp {
                site: c.y as usize * w + c.x as usize,
                r: c.r,
                territory: c.territory,
                elite: c.elite,
            })
            .collect::<Vec<_>>();
        let faction = serde_json::from_value(input["info"]["faction"].clone()).unwrap();
        let geometry = ZoneGeometry::new(1, faction, &zone, &tiles, w, h, &camps);
        let mut state = Stage4State::new(w, h, tiles, vec![], vec![0; w * h]);
        let caps = runtime::LandmarkDefinition {
            join_checks: input["caps"]["joinChecks"].as_u64().unwrap() as u32,
            footprint_percent: input["caps"]["footprintPct"].as_f64().unwrap(),
            rim_tiles: 0.0,
        };
        let mut rt = LandmarkRuntime::new(&mut state, &geometry, &hard, None, &caps);
        for i in input["reserved"].as_array().unwrap() {
            rt.reserve(i.as_i64().unwrap() as i32);
        }
        let states = unit["states"].as_array().unwrap();
        assert!(!states.is_empty());
        assert_eq!(
            snapshot(&rt),
            states[unit["before"].as_u64().unwrap() as usize]
        );
        TRACE.with(|t| {
            *t.borrow_mut() = Some(Transcript {
                searches: search_transcripts(&unit["events"], states),
                events: direct_events(&unit["events"]),
                states: states.clone(),
                checked: BTreeMap::new(),
            })
        });
        match unit["module"].as_str().unwrap() {
            "rime" => {
                let recipe = rime::Recipe::from_definition(&rime::default_definition()).unwrap();
                if let Some(tower) = input["tower"].as_array() {
                    recipe.place_tower(
                        &mut rt,
                        tower[0].as_i64().unwrap() as i32,
                        tower[1].as_i64().unwrap() as i32,
                        tower[2].as_bool().unwrap(),
                    );
                } else {
                    recipe.apply(&mut rt, &inputs);
                }
            }
            "sanctum" => sanctum::Recipe::from_definition(&sanctum::default_definition())
                .unwrap()
                .apply(&mut rt, &inputs),
            "warren" => warren::Recipe::from_definition(&warren::default_definition())
                .unwrap()
                .apply(&mut rt, &inputs),
            _ => panic!("unknown synthetic helper"),
        }
        TRACE.with(|t| {
            let t = t.borrow_mut().take().unwrap();
            assert!(t.events.is_empty(), "unconsumed synthetic events");
            assert!(t.searches.is_empty(), "unconsumed synthetic search");
        });
        assert_eq!(
            snapshot(&rt),
            states[unit["after"].as_u64().unwrap() as usize],
            "{} final",
            unit["name"]
        );
    }
}
fn open_test_zone(run: impl FnOnce(&mut LandmarkRuntime<'_>, &RecipeInputs<'_>)) -> Stage4State {
    let w = 64;
    let h = 64;
    let mut zone = vec![0u8; w * h];
    let mut tiles = vec![crate::map::TILE_WALL; w * h];
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            zone[y * w + x] = 1;
            tiles[y * w + x] = crate::map::TILE_FLOOR;
        }
    }
    let camps = [
        crate::mapgen::attempt::StyleCamp {
            site: 12 * w + 12,
            r: 3.2,
            territory: 1,
            elite: false,
        },
        crate::mapgen::attempt::StyleCamp {
            site: 48 * w + 48,
            r: 3.2,
            territory: 2,
            elite: false,
        },
    ];
    let geometry = ZoneGeometry::new(1, crate::mapdata::Zone::Holy, &zone, &tiles, w, h, &camps);
    let hard = vec![0; w * h];
    let mut state = Stage4State::new(w, h, tiles, vec![], vec![0; w * h]);
    let fixed = fixed_layout();
    let fd = fixed_definition();
    let rules = recipe_support::default_definition();
    let input = RecipeInputs::new(1, 0, &fixed, &fd, &rules).unwrap();
    let caps = runtime::LandmarkDefinition {
        join_checks: 128,
        footprint_percent: 100.0,
        rim_tiles: 0.0,
    };
    {
        let mut rt = LandmarkRuntime::new(&mut state, &geometry, &hard, None, &caps);
        run(&mut rt, &input);
    }
    state
}
#[test]
fn live_tuning_templates_and_jobs_change_behavior_and_content() {
    macro_rules! check {
        ($module:ident,$field:ident,$value:expr) => {{
            let d = $module::default_definition();
            let baseline = open_test_zone(|rt, input| {
                $module::Recipe::from_definition(&d)
                    .unwrap()
                    .apply(rt, input)
            });
            assert!(!baseline.features.is_empty(), stringify!($module));
            let mut words = Vec::new();
            $module::visit_content(&d, |w| words.push(w));
            assert!(!words.is_empty());
            let mut changed = d;
            changed.$field = $value;
            let actual = open_test_zone(|rt, input| {
                $module::Recipe::from_definition(&changed)
                    .unwrap()
                    .apply(rt, input)
            });
            assert_ne!(
                actual,
                baseline,
                "{} tuning must change live behavior",
                stringify!($module)
            );
            let mut other = Vec::new();
            $module::visit_content(&changed, |w| other.push(w));
            assert_ne!(words, other);
            let mut changed = d;
            changed.template.key = "mutated-live-key";
            let actual = open_test_zone(|rt, input| {
                $module::Recipe::from_definition(&changed)
                    .unwrap()
                    .apply(rt, input)
            });
            assert_ne!(actual.features, baseline.features);
            let mut other = Vec::new();
            $module::visit_content(&changed, |w| other.push(w));
            assert_ne!(words, other);
            let mut changed = d;
            changed.template.jobs = &[crate::mapdata::FeatureJob::Seal];
            let actual = open_test_zone(|rt, input| {
                $module::Recipe::from_definition(&changed)
                    .unwrap()
                    .apply(rt, input)
            });
            assert_ne!(actual.features, baseline.features);
            let mut other = Vec::new();
            $module::visit_content(&changed, |w| other.push(w));
            assert_ne!(words, other);
            let row = d.template.rows[0].replace('#', ".");
            let mut rows = d.template.rows.to_vec();
            rows[0] = &row;
            let mut changed = d;
            changed.template.rows = &rows;
            let actual = open_test_zone(|rt, input| {
                $module::Recipe::from_definition(&changed)
                    .unwrap()
                    .apply(rt, input)
            });
            assert_ne!(actual, baseline);
            let mut other = Vec::new();
            $module::visit_content(&changed, |w| other.push(w));
            assert_ne!(words, other);
        }};
    }
    check!(rime, margin_edge, 100);
    check!(sanctum, radius_ref, 0.0);
    check!(warren, road_min2, 1e12);
}

fn search_transcripts(events: &Value, states: &[Value]) -> VecDeque<SearchTranscript> {
    validate_events(events, states).unwrap();
    let mut out = VecDeque::new();
    let mut current: Option<SearchTranscript> = None;
    let mut last_stamp = Value::Null;
    let mut boundary = None;
    for e in events.as_array().unwrap() {
        let kind = e["type"].as_str().unwrap();
        if kind == "rimeFallback" {
            assert!(current.is_none());
            boundary = Some(e["state"].as_u64().unwrap() as usize);
        }
        if kind == "searchOptions" {
            assert_eq!(
                e["shared"], false,
                "Rime fallback must use a fresh unshared search"
            );
        }
        if kind == "searchStart" {
            assert!(current.is_none());
            current = Some(SearchTranscript {
                diagnostics: Vec::new(),
                opens: Vec::new(),
                boundary: boundary
                    .take()
                    .expect("search without observed Rime fallback boundary"),
            });
        } else if kind == "searchEnd" {
            out.push_back(current.take().expect("search end"));
        } else if let Some(c) = current.as_mut() {
            match kind{
   "searchOpen"=>c.opens.push(e.clone()),
   "place"=>last_stamp=e["stamp"].clone(),
   "searchTables"=>c.diagnostics.push(json!({"type":e["decision"],"tables":e["tab"]})),
   "searchCandidates"=>c.diagnostics.push(json!({"type":"candidates","values":e["values"]})),
   "searchShortlist"=>c.diagnostics.push(json!({"type":"shortlist","values":e["values"]})),
   "searchAttempt"=>c.diagnostics.push(json!({"type":"attempt","origin":e["origin"],"o":e["o"],"result":e["result"],"state":states[e["state"].as_u64().unwrap() as usize],"__stamp":last_stamp})),
   "searchPatch"=>c.diagnostics.push(json!({"type":"patch","tables":e["tab"]})),
   "stamp"|"fit"|"transactionBefore"|"transactionAfter"|"reserve"|"searchScore"=>{},
   unexpected=>panic!("unexpected event inside Rime search {unexpected}"),
  }
        } else if kind == "searchOpen" {
            panic!("open outside search");
        }
    }
    assert!(current.is_none());
    out
}
pub(super) fn observe_search(rt: &LandmarkRuntime<'_>, diagnostics: &[Value]) {
    TRACE.with(|t| {
        let mut t = t.borrow_mut();
        let Some(t) = t.as_mut() else { return };
        let search = t.searches.pop_front().expect("unexpected fallback search");
        let (boundary, reserved, counters) = t
            .checked
            .get(&search.boundary)
            .expect("fallback boundary was not observed against Rust runtime");
        let boundary_state = snapshot_parts(boundary, reserved, *counters);
        let build = diagnostics
            .first()
            .expect("missing actual Rust initial build");
        assert_eq!(build["type"], "build");
        verify_search_opens(
            &search.opens,
            &build["tables"],
            rt.geometry().info.bbox,
            rt.state().w,
            &boundary_state,
            &t.states,
        )
        .unwrap();
        if !search.opens.is_empty() {
            open_negative_controls(
                &search.opens,
                &build["tables"],
                rt.geometry().info.bbox,
                rt.state().w,
                &boundary_state,
                &t.states,
            );
        }
        let mut expected = search.diagnostics;
        let success_stamp = expected
            .iter_mut()
            .filter(|e| e["type"] == "attempt")
            .map(|e| e.as_object_mut().unwrap().remove("__stamp").unwrap())
            .last();
        let diagnostics = if diagnostics.last().is_some_and(|e| e["type"] == "patch") {
            assert!(expected
                .last()
                .is_some_and(|e| e["type"] == "attempt" && !e["result"].is_null()));
            let stamp = success_stamp.expect("successful source stamp");
            let mut tables = expected.first().unwrap()["tables"].clone();
            let bb = rt.geometry().info.bbox;
            let bw = tables["bw"].as_u64().unwrap() as usize;
            let bh = tables["bh"].as_u64().unwrap() as usize;
            for name in ["walls", "floor", "doors", "nooks", "lights"] {
                for i in stamp[name].as_array().unwrap() {
                    let i = i.as_u64().unwrap() as usize;
                    let x = i % rt.state().w - bb.x as usize;
                    let y = i / rt.state().w - bb.y as usize;
                    tables["okWall"][y * bw + x] = json!(0);
                    tables["okFloor"][y * bw + x] = json!(0);
                }
            }
            for (ok, sat) in [("okWall", "satWall"), ("okFloor", "satFloor")] {
                let mut sums = vec![0i32; (bw + 1) * (bh + 1)];
                for y in 0..bh {
                    for x in 0..bw {
                        let q = (y + 1) * (bw + 1) + x + 1;
                        sums[q] = sums[q - 1] + sums[q - bw - 1] - sums[q - bw - 2]
                            + tables[ok][y * bw + x].as_i64().unwrap() as i32;
                    }
                }
                tables[sat] = json!(sums);
            }
            tables["features"] = json!(rt.zone_features().count());
            tables["sum"] = json!((bb.y..bb.y + bb.h as i32)
                .flat_map(|y| (bb.x..bb.x + bb.w as i32)
                    .map(move |x| rt.state().tiles[y as usize * rt.state().w + x as usize] as u64))
                .sum::<u64>());
            same_json(
                diagnostics.last().unwrap(),
                &json!({"type":"patch","tables":tables}),
                "extra discarded Rust patch",
            );
            &diagnostics[..diagnostics.len() - 1]
        } else {
            diagnostics
        };
        same_json(
            &json!(diagnostics),
            &json!(expected),
            "fallback diagnostics",
        );
    });
}

#[test]
fn actual_second_seed_helper_includes_equality_and_earliest_tie() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let probes = f["helperProbes"].as_array().unwrap();
    assert_eq!(probes.len(), 1);
    let p = &probes[0];
    let clr: Vec<i32> = serde_json::from_value(p["clr"].clone()).unwrap();
    let allow: Vec<u8> = serde_json::from_value(p["allow"].clone()).unwrap();
    assert_eq!(
        rime::second_seed(
            p["w"].as_u64().unwrap() as usize,
            &clr,
            &allow,
            p["first"].as_u64().unwrap() as usize,
            &rime::default_definition()
        ),
        Some(p["result"].as_u64().unwrap() as usize)
    );
    assert_eq!(p["result"], 61);
}
#[test]
fn every_live_field_and_template_entry_reaches_content_visitor() {
    macro_rules! words {
        ($module:ident,$d:expr) => {{
            let mut words = Vec::new();
            $module::visit_content(&$d, |w| words.push(w));
            words
        }};
    }
    macro_rules! numeric{($module:ident,$d:ident,$($field:ident),+)=>{$({let mut changed=$d;changed.$field=Increment::increment(changed.$field);assert_ne!(words!($module,$d),words!($module,changed),"{} {}",stringify!($module),stringify!($field));})+};}
    macro_rules! template {
        ($module:ident,$d:ident) => {{
            let original = words!($module, $d);
            for i in 0..$d.template.key.len() {
                let mut key = $d.template.key.as_bytes().to_vec();
                key[i] = b'X';
                let key = String::from_utf8(key).unwrap();
                let mut changed = $d;
                changed.template.key = &key;
                assert_ne!(original, words!($module, changed));
            }
            for row in 0..$d.template.rows.len() {
                for col in 0..$d.template.rows[row].len() {
                    let mut value = $d.template.rows[row].as_bytes().to_vec();
                    value[col] = if value[col] == b'#' { b'.' } else { b'#' };
                    let value = String::from_utf8(value).unwrap();
                    let mut rows = $d.template.rows.to_vec();
                    rows[row] = &value;
                    let mut changed = $d;
                    changed.template.rows = &rows;
                    assert_ne!(original, words!($module, changed));
                }
            }
            for i in 0..$d.template.jobs.len() {
                let mut jobs = $d.template.jobs.to_vec();
                jobs[i] = crate::mapdata::FeatureJob::Seal;
                let mut changed = $d;
                changed.template.jobs = &jobs;
                assert_ne!(original, words!($module, changed));
            }
        }};
    }
    let r = rime::default_definition();
    numeric!(
        rime,
        r,
        margin_camp,
        margin_edge,
        margin_ring,
        margin_landmark,
        clearance_slack,
        lake_min_clearance,
        second_clearance,
        second_sep2,
        two_lakes_painted,
        tower_beyond,
        tower_span,
        axis_penalty,
        local_bad_max,
        local_failures,
        fallback_tries
    );
    template!(rime, r);
    let s = sanctum::default_definition();
    numeric!(
        sanctum,
        s,
        hall_pitch,
        radius_ref,
        radius_min,
        radius_max,
        min_piers,
        pier_score,
        shrine_gap,
        turn_cost,
        inward_cost
    );
    template!(sanctum, s);
    for i in 0..s.extras.len() {
        let mut extras = s.extras.to_vec();
        extras[i] += 1;
        let mut changed = s;
        changed.extras = &extras;
        assert_ne!(words!(sanctum, s), words!(sanctum, changed));
    }
    let w = warren::default_definition();
    numeric!(
        warren,
        w,
        road_min2,
        roads_tried,
        mirror_cell,
        mirror_salt,
        mirror_threshold
    );
    template!(warren, w);
    for across in [false, true] {
        let source = if across { w.across } else { w.t_permille };
        for i in 0..source.len() {
            let mut values = source.to_vec();
            values[i] += 1.0;
            let mut changed = w;
            if across {
                changed.across = &values;
            } else {
                changed.t_permille = &values;
            }
            assert_ne!(words!(warren, w), words!(warren, changed));
        }
    }
}

trait Increment {
    fn increment(self) -> Self;
}
impl Increment for i32 {
    fn increment(self) -> Self {
        self + 1
    }
}
impl Increment for usize {
    fn increment(self) -> Self {
        self + 1
    }
}
impl Increment for f64 {
    fn increment(self) -> Self {
        self + 1.0
    }
}

pub(super) fn placement_before(
    rt: &LandmarkRuntime<'_>,
    t: &ParsedTemplate,
    s: &Stamp,
    rot: u8,
    mirror: bool,
) -> Option<Vec<u8>> {
    TRACE.with(|trace|{let mut trace=trace.borrow_mut();let tlog=trace.as_mut()?;let e=tlog.events.pop_front().expect("missing transaction before");assert_eq!(e["type"],"transactionBefore");let spec=source_spec(&e["spec"]);let mut doors=s.doors.clone();doors.sort_unstable();let mut params=vec![rot as i32,i32::from(mirror)];params.extend(doors);let floor=[&s.floor,&s.doors,&s.nooks,&s.lights].into_iter().flatten().copied().collect::<Vec<_>>();assert_eq!(serde_json::to_value(spec).unwrap(),json!({"variant":t.template.key,"jobs":t.template.jobs,"anchor":[s.bbox.x,s.bbox.y],"params":params,"blocks":s.walls,"floor":floor}));assert_eq!(snapshot(rt),tlog.states[e["state"].as_u64().unwrap() as usize]);Some(rt.reserved().to_vec())})
}
pub(super) fn placement_after(
    rt: &LandmarkRuntime<'_>,
    s: &Stamp,
    success: bool,
    before: Option<Vec<u8>>,
) {
    let Some(mut reserved) = before else { return };
    TRACE.with(|trace| {
        let mut trace = trace.borrow_mut();
        let t = trace.as_mut().unwrap();
        let e = t.events.pop_front().expect("missing transaction after");
        assert_eq!(e["type"], "transactionAfter");
        let mut actual = snapshot(rt);
        actual["reserved"] = rle(&json!(reserved));
        assert_eq!(actual, t.states[e["state"].as_u64().unwrap() as usize]);
        assert_eq!(!e["result"].is_null(), success);
        if success {
            for &door in &s.doors {
                let e = t.events.pop_front().expect("missing reservation");
                assert_eq!(e["type"], "reserve");
                assert_eq!(e["i"], door);
                reserved[door as usize] = 1;
                actual["reserved"] = rle(&json!(reserved));
                assert_eq!(actual, t.states[e["state"].as_u64().unwrap() as usize]);
            }
        }
        assert_eq!(rt.reserved(), reserved);
    });
}

#[derive(Clone, Copy)]
enum EventKind {
    Direct,
    Score,
    Search,
}
fn event_kind(e: &Value) -> Result<EventKind, String> {
    match e["type"].as_str() {
        Some(
            "stamp" | "fit" | "place" | "transactionBefore" | "transactionAfter" | "reserve"
            | "rimeFallback" | "rimeFields" | "rimeKeys" | "rimeSeeds" | "rimeSixFailures"
            | "rimeTarget" | "sanctumCandidate" | "sanctumScan" | "sanctumSlots" | "sanctumSpot"
            | "warrenCentre" | "warrenMirror" | "warrenNodes" | "warrenRoads",
        ) => Ok(EventKind::Direct),
        Some("searchScore") => Ok(EventKind::Score),
        Some(
            "searchAttempt" | "searchCandidates" | "searchEnd" | "searchOpen" | "searchOptions"
            | "searchPatch" | "searchShortlist" | "searchStart" | "searchTables",
        ) => Ok(EventKind::Search),
        other => Err(format!("unknown source operation {other:?}")),
    }
}
fn state_ref(v: &Value, states: &[Value]) -> Result<usize, String> {
    let i = v
        .as_u64()
        .ok_or("state reference must be an unsigned integer")?;
    let i = usize::try_from(i).map_err(|_| "state reference overflow")?;
    if i >= states.len() {
        return Err(format!("invalid state reference {i}"));
    }
    Ok(i)
}
fn validate_events(events: &Value, states: &[Value]) -> Result<(), String> {
    let events = events.as_array().ok_or("events missing")?;
    if events.is_empty() {
        return Err("empty event section".into());
    }
    for e in events {
        event_kind(e)?;
        state_ref(&e["state"], states)?;
        e["inSearch"].as_bool().ok_or("missing inSearch flag")?;
    }
    Ok(())
}
fn verify_search_opens(
    opens: &[Value],
    actual_tables: &Value,
    bb: crate::mapdata::TileRect,
    w: usize,
    boundary: &Value,
    states: &[Value],
) -> Result<(), String> {
    let bw = actual_tables["bw"]
        .as_u64()
        .ok_or("actual build width missing")? as usize;
    let bh = actual_tables["bh"]
        .as_u64()
        .ok_or("actual build height missing")? as usize;
    if bw != bb.w as usize || bh != bb.h as usize {
        return Err("actual build bounds differ".into());
    }
    let floors = actual_tables["okFloor"]
        .as_array()
        .ok_or("actual floor table missing")?;
    let walls = actual_tables["okWall"]
        .as_array()
        .ok_or("actual wall table missing")?;
    if floors.len() != bw * bh || walls.len() != bw * bh {
        return Err("actual build lengths differ".into());
    }
    let mut position = 0;
    let mut verified = std::collections::BTreeSet::new();
    for y in 0..bh {
        for x in 0..bw {
            let k = y * bw + x;
            if floors[k].as_u64() != Some(1) {
                continue;
            }
            let e = opens
                .get(position)
                .ok_or_else(|| format!("missing source open at {position}"))?;
            if e["type"] != "searchOpen" {
                return Err("non-open in open transcript".into());
            }
            let expected = (bb.y as usize + y) * w + bb.x as usize + x;
            if e["i"].as_u64() != Some(expected as u64) {
                return Err(format!("open index/order differs at {position}"));
            }
            let value = walls[k].as_u64().ok_or("actual wall bit missing")? != 0;
            if e["value"].as_bool() != Some(value) {
                return Err(format!("open result differs at {position}"));
            }
            let sid = state_ref(&e["state"], states)?;
            if verified.insert(sid) && states[sid] != *boundary {
                return Err(format!("open full state differs at {position}"));
            }
            position += 1;
        }
    }
    if position != opens.len() {
        return Err(format!(
            "unexpected source open count {} vs {position}",
            opens.len()
        ));
    }
    Ok(())
}
fn open_negative_controls(
    opens: &[Value],
    tables: &Value,
    bb: crate::mapdata::TileRect,
    w: usize,
    boundary: &Value,
    states: &[Value],
) {
    let valid = |events: &[Value]| verify_search_opens(events, tables, bb, w, boundary, states);
    assert!(valid(opens).is_ok(), "unchanged open control");
    let mut mutated = opens.to_vec();
    mutated.remove(0);
    assert!(valid(&mutated).is_err(), "missing open survived");
    let mut mutated = opens.to_vec();
    mutated.swap(0, 1);
    assert!(valid(&mutated).is_err(), "reordered opens survived");
    for field in ["i", "value", "state"] {
        let mut mutated = opens.to_vec();
        mutated[0][field] = match field {
            "i" => json!(-999),
            "value" => json!(!mutated[0][field].as_bool().unwrap()),
            "state" => json!(999999),
            _ => unreachable!(),
        };
        assert!(valid(&mutated).is_err(), "corrupted open {field} survived");
    }
    if let Some(sid) = states.iter().position(|s| s != boundary) {
        let mut mutated = opens.to_vec();
        mutated[0]["state"] = json!(sid);
        assert!(
            valid(&mutated).is_err(),
            "valid but different full state survived"
        );
    }
    let mut mutated = opens.to_vec();
    for e in &mut mutated {
        e["i"] = json!(-999);
        e["value"] = json!(!e["value"].as_bool().unwrap());
        e["state"] = json!(999999);
    }
    assert!(valid(&mutated).is_err(), "all-open corruption survived");
    assert!(
        valid(opens).is_ok(),
        "unchanged open control after corruptions"
    );
}

fn validate_corpus_inventory(corpus: &Value) -> Result<(), String> {
    let required_sources: &[(&str, &str)] = SOURCE_INVENTORY;
    let sources = corpus["sources"]
        .as_object()
        .ok_or("source inventory missing")?;
    if sources.len() != required_sources.len() {
        return Err("source inventory length differs".into());
    }
    for &(name, sha) in required_sources {
        if sources.get(name).and_then(Value::as_str) != Some(sha) {
            return Err(format!("source inventory differs: {name}"));
        }
    }
    let required_cases: &[(i64, u64, bool, usize)] = CASE_INVENTORY;
    let cases = corpus["cases"].as_array().ok_or("case inventory missing")?;
    if cases.len() != required_cases.len() {
        return Err("case inventory length differs".into());
    }
    for (case, &(seed, attempt, styled, count)) in cases.iter().zip(required_cases) {
        if case["seed"].as_i64() != Some(seed)
            || case["attempt"].as_u64() != Some(attempt)
            || case["styledObserverControl"].as_bool() != Some(styled)
        {
            return Err("case identity/order differs".into());
        }
        let states = case["states"].as_array().ok_or("case states missing")?;
        if states.len() != count {
            return Err("case state inventory differs".into());
        }
        let zones = case["zones"].as_array().ok_or("zones missing")?;
        if zones.len() != 5 {
            return Err("zone inventory differs".into());
        }
        for (i, z) in zones.iter().enumerate() {
            if z["index"].as_u64() != Some((i + 1) as u64) {
                return Err("zone order differs".into());
            }
            state_ref(&z["before"], states)?;
            state_ref(&z["after"], states)?;
            validate_events(&z["events"], states)?;
        }
    }
    let required_units: &[(&str, &str, usize)] = SYNTHETIC_INVENTORY;
    let units = corpus["synthetic"]
        .as_array()
        .ok_or("synthetic inventory missing")?;
    if units.len() != required_units.len() {
        return Err("synthetic inventory length differs".into());
    }
    for (unit, &(name, module, count)) in units.iter().zip(required_units) {
        if unit["name"].as_str() != Some(name) || unit["module"].as_str() != Some(module) {
            return Err("synthetic identity/order differs".into());
        }
        let states = unit["states"]
            .as_array()
            .ok_or("synthetic states missing")?;
        if states.len() != count {
            return Err("synthetic state inventory differs".into());
        }
        state_ref(&unit["before"], states)?;
        state_ref(&unit["after"], states)?;
        validate_events(&unit["events"], states)?;
    }
    let probes = corpus["helperProbes"]
        .as_array()
        .ok_or("helper inventory missing")?;
    if probes.len() != 1
        || probes[0]["name"] != "direct-second-seed-equality-earliest-and-clearance"
    {
        return Err("helper inventory differs".into());
    }
    Ok(())
}
const SOURCE_INVENTORY: &[(&str, &str)] = &[
    (
        "abilities.ts",
        "95ef39376a9d9f40cc529a0f7300700a97427050628941e801aaa1e299862518",
    ),
    (
        "bushes.ts",
        "ac64ce414134376d27b7b4819d59096e66edd01d82958e873d57348a79d85910",
    ),
    (
        "coliseum.ts",
        "48fc2fa156e70ff6520019605017939298144960d8871a748ef18aadbbf0c0e1",
    ),
    (
        "constants.ts",
        "51ce4dd800ec868abee525fb1ae375688066f336972a7da878644df1235924e7",
    ),
    (
        "detMath.ts",
        "a806636428155920a0c1c8675cd84d896057993d4d6ff7b9b4623daa5a312b15",
    ),
    (
        "factions.ts",
        "aa0cebf1c17af17b64bc1e020c4613ab10788ec66d82a72232aef8915d5403f3",
    ),
    (
        "geometry.ts",
        "b1a91a65281f8642b1779b81764768569311966ab493941101a2f988cfdc1f5d",
    ),
    (
        "gridOps.ts",
        "76587ddd597a2a6ecc05561427dd89b986b6f86026ffedc56848e1b03bb52493",
    ),
    (
        "gridTopology.ts",
        "deb2710d114cd669854a082c06bafe518f5ef750249722f89ede83a27d42d328",
    ),
    (
        "map.ts",
        "35caac04108a3bd0e1d880a9502f14bdccb3a9a17d262cba335c3d6436995eed",
    ),
    (
        "mapgen.ts",
        "975591aed836a345c4efd957ced95a478638e6e870fe8ea9bb8740526ef06d10",
    ),
    (
        "mark.ts",
        "44870381fa48b9c8f65f180ff74995725644d7264df5b069a3c43c2291540661",
    ),
    (
        "messages.ts",
        "f7f3b4eb6bb32c54bb97a7d3a8e2ba613b0aff0495a0f20c09fd6d36c797fe80",
    ),
    (
        "mobs.ts",
        "3b567c08363d8d4f1e9a897240b3d99d5b8ded7757b6809a4b534b63d72b5522",
    ),
    (
        "pathfind.ts",
        "300caa48788f84bdc780befe8c50db41c2c0b2be520d3fb43a7f91e16de424d9",
    ),
    (
        "planning.ts",
        "8d52b212f6fec391359787cf9d81b8fa31a067ea839a2b9ccadc58c059027cb2",
    ),
    (
        "propKinds.ts",
        "431d70881377a8059960f053dc9452946cc0e942d212c92765bacb8a063027ee",
    ),
    (
        "rng.ts",
        "412bdcee4a5adcb6163bff3561cb4a07eff423dc7e30e9ba0694cb41b05b1bec",
    ),
    (
        "signatureShares.ts",
        "e6996931487dde9d4e3f71481a9da996f7500fbcd2148f7924ed730a78eba1a4",
    ),
    (
        "signatures.ts",
        "0a6befbb5a6fe9870b13a540d72235085c491668c8cae3674fa8faf89816e191",
    ),
    (
        "status.ts",
        "98a0570d7620e424d9d522356fe378a6af049109d8af0342be0ecff970310df7",
    ),
    (
        "styler.ts",
        "314805a5a6cd9074763c9e555e48e7145c7ed7c87f265876c3712e4837abc51c",
    ),
    (
        "terrain.ts",
        "5ee4fe11e793f83f3d095720ba1156a186c5c7704e864f2cad74503ab13a07d6",
    ),
    (
        "weapons.ts",
        "2f22f037502fe63fae6b47f20408cfd35ebc72bfea081194ae8d18cfc21df99b",
    ),
    (
        "zoneStyle/context.ts",
        "8a87c8c930a11c2f1c83b3afe9384586a24f41690dd77a78f1c35b0f69a19dfb",
    ),
    (
        "zoneStyle/features.ts",
        "f0d987fc114394e514c0b9e194b219aa1f8f3429a0fa141c7b6181e6d87ee983",
    ),
    (
        "zoneStyle/gallows.ts",
        "0edb95a89d06fc6b0f60a6dc85da41613177362679c03e2073f2be24bbe186e4",
    ),
    (
        "zoneStyle/hook.ts",
        "56eeba0fb5019dc5dd02e8fd76059c6f82ede6cfa2aa46c763ecf63b619bc668",
    ),
    (
        "zoneStyle/kit.ts",
        "dc69161c080b9474a873d12ac194d876b78285a1ae2cdb7eb24cb86b30337e16",
    ),
    (
        "zoneStyle/landmarks.ts",
        "ad18e32099ceafc1b88fa33a2225ef2c02508ac6fa4a58c1a91473f0be4c6587",
    ),
    (
        "zoneStyle/propKinds.ts",
        "6a139d0727ab392512d427507ee3b027f67860734d56eea7db8085add24003b9",
    ),
    (
        "zoneStyle/rime.ts",
        "d25714c3b647392a03662b33082b48de2c7ec2933755501fe55260c2a1daa19a",
    ),
    (
        "zoneStyle/sanctum.ts",
        "dd2da40c09a1a5dc5fdbd6e45b568d2b4ada831a0e195e86fd0ab64f49b7babd",
    ),
    (
        "zoneStyle/scale.ts",
        "b8e055707f98dfa104233c1ceebd99358b9b3b5ae8e9fe001d9174806ca6a07e",
    ),
    (
        "zoneStyle/scorch.ts",
        "52b324dd4dfc9a77986a9ffdcb9704041a2d3608e6e61e9af98b0f697fd2f02a",
    ),
    (
        "zoneStyle/styleZones.ts",
        "9c328903541ae1e15ca473b288c788b5a2ebb55e8974a639c6215c7c804cbc36",
    ),
    (
        "zoneStyle/types.ts",
        "193b6f57c1e76ea6f8249a316fc8898191682937493fbbce7beb3a0ffb26c33e",
    ),
    (
        "zoneStyle/warren.ts",
        "bdb057ebaf226fbe803403cc338d38f50c154c276a30fcb652b5229741a9ddcc",
    ),
    (
        "zones.ts",
        "aa91d0c2b8d7b1957d6e28e29289c9dfa58ac6d4c8475b647445370fbcaeb814",
    ),
];
const CASE_INVENTORY: &[(i64, u64, bool, usize)] = &[
    (1i64, 0u64, false, 80usize),
    (-1i64, 0u64, false, 65usize),
    (4294967297i64, 4294967296u64, false, 85usize),
    (176i64, 0u64, false, 77usize),
    (54i64, 0u64, false, 187usize),
    (17i64, 0u64, false, 63usize),
    (17i64, 1u64, false, 108usize),
    (1i64, 0u64, true, 80usize),
];
const SYNTHETIC_INVENTORY: &[(&str, &str, usize)] = &[
    ("direct-rime-six-local-refusals-no-fallback", "rime", 7usize),
    ("direct-rime-genuine-empty-key-exhaustion", "rime", 1usize),
    ("direct-rime-clipped-shifted-field", "rime", 1usize),
    (
        "direct-sanctum-first-failure-bearing-seven",
        "sanctum",
        345usize,
    ),
    (
        "direct-sanctum-radius-minimum-pole-fallback",
        "sanctum",
        5usize,
    ),
    ("direct-warren-equal-roads-first-success", "warren", 11usize),
    ("direct-warren-road-length-equality", "warren", 6usize),
    ("direct-warren-no-nodes", "warren", 1usize),
];

#[test]
fn strict_source_event_and_inventory_negative_controls() {
    let corpus: Value = serde_json::from_str(FIXTURE).unwrap();
    validate_corpus_inventory(&corpus).unwrap();
    for (case, zone) in [(0, 0), (0, 1)] {
        let states = corpus["cases"][case]["states"].as_array().unwrap();
        let mut events = corpus["cases"][case]["zones"][zone]["events"].clone();
        events
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"UNKNOWN_OPERATION","state":999999,"inSearch":false}));
        assert!(
            validate_events(&events, states).is_err(),
            "unknown owned/foreign operation survived"
        );
        let mut events = corpus["cases"][case]["zones"][zone]["events"].clone();
        events[0]["state"] = json!(999999);
        assert!(
            validate_events(&events, states).is_err(),
            "invalid state survived"
        );
    }
    for section in ["cases", "sources", "synthetic", "helperProbes"] {
        let mut changed = corpus.clone();
        match section {
            "sources" => {
                let first = changed[section]
                    .as_object()
                    .unwrap()
                    .keys()
                    .next()
                    .unwrap()
                    .clone();
                changed[section].as_object_mut().unwrap().remove(&first);
            }
            _ => {
                changed[section].as_array_mut().unwrap().pop();
            }
        }
        assert!(
            validate_corpus_inventory(&changed).is_err(),
            "missing required {section} survived"
        );
    }
    validate_corpus_inventory(&corpus).unwrap();
}
