use super::*;
use crate::mapdata::MapFeature;
use crate::mapgen::attempt::StyleCamp;
use crate::mapgen::landmarks::runtime::{LandmarkDefinition, Stage4State, ZoneGeometry, ZoneInfo};
use crate::mapgen::landmarks::templates::{parse_template, LandmarkTemplate};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
const FIXTURE: &str = include_str!("../../fixtures/landmark-search.json");
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
    for item in v.as_array().unwrap() {
        if let Some(last) = out.last_mut() {
            if last[0] == *item {
                last[1] = json!(last[1].as_u64().unwrap() + 1);
                continue;
            }
        }
        out.push(json!([item, 1]));
    }
    json!(out)
}
pub(super) fn runtime_snapshot(rt: &LandmarkRuntime<'_>) -> Value {
    let s = serde_json::to_value(rt.state()).unwrap();
    json!({"tiles":rle(&s["tiles"]),"terrain":rle(&s["terrain"]),"featureOwner":rle(&s["featureOwner"]),"features":s["features"],"wrote":rle(&s["wrote"]),"reserved":rle(&json!(rt.reserved())),"mark":rle(&s["scratch"]["mark"]),"qa":rle(&s["scratch"]["qa"]),"qb":rle(&s["scratch"]["qb"]),"epoch":s["scratch"]["epoch"],"counters":rt.counters()})
}
#[derive(Default)]
struct Transcript {
    events: VecDeque<Value>,
    snapshots: BTreeMap<
        usize,
        (
            Stage4State,
            Vec<u8>,
            crate::mapgen::landmarks::runtime::Counters,
        ),
    >,
}
struct ReplayPolicy {
    hard: Vec<u8>,
    callbacks: Rc<RefCell<Transcript>>,
}
impl PlanningPolicy for ReplayPolicy {
    fn hard<'a>(&'a self, _: &'a LandmarkRuntime<'_>) -> &'a [u8] {
        &self.hard
    }
    fn open(&mut self, _: &LandmarkRuntime<'_>, i: i32) -> bool {
        let e = self
            .callbacks
            .borrow_mut()
            .events
            .pop_front()
            .expect("unexpected planning open");
        assert_eq!(e["type"], "open");
        assert_eq!(e["i"], i);
        e["result"].as_bool().unwrap()
    }
}
fn result_bits(e: &Value) -> f64 {
    f64::from_bits(u64::from_str_radix(e["bits"].as_str().unwrap(), 16).unwrap())
}
fn callback(
    q: &RefCell<Transcript>,
    states: &Value,
    rt: &LandmarkRuntime<'_>,
    kind: &str,
    geometry: Value,
    rot: u8,
    mirror: bool,
) -> f64 {
    let e = q.borrow_mut().events.pop_front().expect("extra callback");
    assert_eq!(e["type"], kind);
    assert_eq!(e[if kind == "score" { "stamp" } else { "box" }], geometry);
    assert_eq!(e["rot"], rot);
    assert_eq!(e["mirror"], mirror);
    let sid = e["stateId"].as_u64().unwrap() as usize;
    // Verify the source snapshot once, then compare every immutable callback against its
    // complete typed clone (including scratch), avoiding repeated JSON encoding of the grid.
    let mut transcript = q.borrow_mut();
    if let Some((state, reserved, counters)) = transcript.snapshots.get(&sid) {
        assert_eq!(rt.state(), state);
        assert_eq!(rt.reserved(), reserved);
        assert_eq!(rt.counters(), *counters);
    } else {
        assert_eq!(runtime_snapshot(rt), states[sid]);
        transcript.snapshots.insert(
            sid,
            (rt.state().clone(), rt.reserved().to_vec(), rt.counters()),
        );
    }
    result_bits(&e)
}
fn replay_search<P: PlanningPolicy>(
    session: &mut LandmarkSearch<'_, '_, P>,
    event: &Value,
    states: &Value,
    q: &Rc<RefCell<Transcript>>,
) {
    let trace = event["trace"].as_array().unwrap();
    q.borrow_mut().events = trace
        .iter()
        .filter(|e| matches!(e["type"].as_str(), Some("open" | "bound" | "score")))
        .cloned()
        .collect();
    let p = parse_template(serde_json::from_value(event["template"].clone()).unwrap()).unwrap();
    assert_eq!(
        runtime_snapshot(session.runtime()),
        states[event["stateId"].as_u64().unwrap() as usize]
    );
    session.diagnostics.clear();
    let mut bound = |rt: &LandmarkRuntime<'_>, b: &TileRect, r: u8, m: bool| {
        callback(q, states, rt, "bound", json!(b), r, m)
    };
    let score = |rt: &LandmarkRuntime<'_>, s: &Stamp, r: u8, m: bool| {
        callback(q, states, rt, "score", json!(s), r, m)
    };
    let result = if event["useDefault"] == true {
        session.best_default(
            &p,
            score,
            if event["hasBound"].as_bool().unwrap() {
                Some(&mut bound)
            } else {
                None
            },
        )
    } else {
        session.best(
            &p,
            score,
            event["tries"].as_i64().unwrap() as i32,
            if event["hasBound"].as_bool().unwrap() {
                Some(&mut bound)
            } else {
                None
            },
        )
    };
    assert!(
        q.borrow().events.is_empty(),
        "unconsumed callback transcript"
    );
    assert_eq!(json!(result), event["result"]);
    assert_eq!(
        runtime_snapshot(session.runtime()),
        states[event["finalStateId"].as_u64().unwrap() as usize]
    );
    let expected: Vec<Value> = trace
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
                e["state"] = states[sid.as_u64().unwrap() as usize].clone();
            }
            e
        })
        .collect();
    let actual: Vec<Value> = session
        .diagnostics
        .iter()
        .filter(|e| event["sessionId"].is_number() || e["type"] != "patch")
        .cloned()
        .collect();
    assert_eq!(
        actual, expected,
        "candidate/cache/shortlist/attempt transcript"
    );
}

#[test]
fn direct_actual_helpers_cover_ordering_special_numbers_failures_and_cache_boundaries() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let units = f["units"].as_array().unwrap();
    assert_eq!(
        units
            .iter()
            .map(|u| u["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "direct-tries--1",
            "direct-tries-0",
            "direct-tries-1",
            "direct-tries-6",
            "direct-tries-12",
            "direct-tries-48",
            "direct-tries-10000",
            "direct-default-tries",
            "direct-empty-candidate-set",
            "direct-mask-hard-owner-rejection",
            "direct-heap-special",
            "direct-heap-equal-bound",
            "direct-heap-strict-prune",
            "direct-heap-descending-bound",
            "direct-special-scores-without-pruning",
            "direct-signed-zero-bound-and-score-ties",
            "direct-nan-and-negative-infinity-rank-ties",
            "direct-n-equal-or-less-than-keep-8",
            "direct-n-equal-or-less-than-keep-12",
            "direct-gap-strict-edge-5",
            "direct-gap-strict-edge-4",
            "direct-cached-sparse-success-patch-and-reuse",
            "direct-cached-foreign-placement-rebuild",
            "direct-cached-reserve-reset",
            "direct-cached-sum-and-explicit-reset",
            "direct-foreign-context-falls-back",
            "direct-planning-open-memo-and-reset",
            "direct-failed-attempt-budget-6",
            "direct-failed-attempt-budget-12",
            "direct-second-only-budget-control"
        ]
    );
    let mut failures = 0;
    let mut has_success_after_failures = false;
    for unit in units {
        let input = &unit["input"];
        let states = &unit["states"];
        let events = unit["events"].as_array().unwrap();
        let start = events.iter().find(|e| e["type"] == "zoneStart").unwrap();
        let initial = &states[start["stateId"].as_u64().unwrap() as usize];
        let w = input["w"].as_u64().unwrap() as usize;
        let h = input["h"].as_u64().unwrap() as usize;
        let zone: Vec<u8> = serde_json::from_value(input["zone"].clone()).unwrap();
        let mut hard: Vec<u8> = serde_json::from_value(input["protect"].clone()).unwrap();
        let info: ZoneInfo = serde_json::from_value(start["info"].clone()).unwrap();
        let mut state = Stage4State::new(
            w,
            h,
            expand(&initial["tiles"]),
            serde_json::from_value(initial["features"].clone()).unwrap(),
            expand(&initial["featureOwner"]),
        );
        let mut g = ZoneGeometry::new(info.index, info.faction, &zone, &state.tiles, w, h, &[]);
        g.info = info;
        g.edge_dist = expand(&start["edgeDist"]);
        let rules: LandmarkDefinition =
            serde_json::from_value(input["definition"].clone()).unwrap();
        let q = Rc::new(RefCell::new(Transcript::default()));
        let mut caches = BTreeMap::<u64, Tables>::new();
        // Mutation fixtures have no placements before edits. This private test transfers tables
        // across successive captured read views; no product API can transfer a cache/context.
        let mut cursor = 0;
        while cursor < events.len() {
            let mut rt = LandmarkRuntime::new(&mut state, &g, &hard, None, &rules);
            let mut session = LandmarkSearch::from_policy(
                &mut rt,
                ReplayPolicy {
                    hard: hard.clone(),
                    callbacks: q.clone(),
                },
            );
            while cursor < events.len()
                && !matches!(
                    events[cursor]["type"].as_str(),
                    Some("tileEdit" | "hardEdit")
                )
            {
                let e = &events[cursor];
                match e["type"].as_str().unwrap() {
                    "search" => {
                        let sid = e["sessionId"].as_u64();
                        session.tab = sid.and_then(|id| caches.remove(&id));
                        session.policy.hard = expand(&e["hard"]);
                        let mut event = e.clone();
                        if unit["name"] == "direct-default-tries" {
                            event["useDefault"] = json!(true);
                        }
                        replay_search(&mut session, &event, states, &q);
                        if let Some(id) = sid {
                            caches.insert(id, session.tab.take().unwrap());
                        }
                        let attempts: Vec<_> = e["trace"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .filter(|e| e["type"] == "attempt")
                            .collect();
                        let nfail = attempts.iter().filter(|e| e["result"].is_null()).count();
                        failures += nfail;
                        if nfail >= 2 && !e["result"].is_null() {
                            has_success_after_failures = true;
                        }
                    }
                    "place" => {
                        let t = f["templates"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|t| t["key"] == e["template"])
                            .cloned()
                            .unwrap_or_else(
                                || json!({"key":"direct-floor","rows":["."],"jobs":["landmark"]}),
                            );
                        let p = parse_template(serde_json::from_value(t).unwrap()).unwrap();
                        let stamp: Stamp = serde_json::from_value(e["stamp"].clone()).unwrap();
                        assert_eq!(
                            json!(session.place_stamp(
                                &p,
                                &stamp,
                                e["rot"].as_u64().unwrap() as u8,
                                e["mirror"].as_bool().unwrap()
                            )),
                            e["result"]
                        );
                        assert_eq!(
                            runtime_snapshot(session.runtime()),
                            states[e["stateId"].as_u64().unwrap() as usize]
                        );
                    }
                    "reset" => {
                        caches.remove(&e["sessionId"].as_u64().unwrap());
                    }
                    "reserve" => {
                        session.reserve(e["tile"].as_i64().unwrap() as i32);
                    }
                    _ => {}
                }
                cursor += 1;
            }
            drop(session);
            drop(rt);
            if cursor < events.len() {
                let e = &events[cursor];
                let tile = e["tile"].as_u64().unwrap() as usize;
                let value = e["value"].as_u64().unwrap() as u8;
                if e["type"] == "tileEdit" {
                    state.tiles[tile] = value;
                } else {
                    hard[tile] = value;
                }
                cursor += 1;
            }
        }
    }
    assert!(failures >= 8);
    assert!(
        has_success_after_failures,
        "capture failed attempts followed by a real guarded success"
    );
    let first_search = |name: &str| {
        units.iter().find(|u| u["name"] == name).unwrap()["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["type"] == "search")
            .unwrap()
    };
    let sparse = first_search("direct-cached-sparse-success-patch-and-reuse");
    assert!(
        !sparse["result"].is_null(),
        "sparse patch helper must succeed"
    );
    let patch = &sparse["trace"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "patch")
        .expect("sparse success must patch tables")["tables"];
    // Origin (5,5), orientation 0 has holes at (6,5) and (5,6).
    // Both eligibility arrays must preserve those cells, while the occupied wall is taken.
    for kind in ["okWall", "okFloor"] {
        assert_eq!(patch[kind][4 * 13 + 5], 1);
        assert_eq!(patch[kind][5 * 13 + 4], 1);
        assert_eq!(patch[kind][4 * 13 + 4], 0);
    }
    let failed = first_search("direct-failed-attempt-budget-12");
    let control = first_search("direct-second-only-budget-control");
    let counters = |name: &str, e: &Value| {
        let u = units.iter().find(|u| u["name"] == name).unwrap();
        u["states"][e["finalStateId"].as_u64().unwrap() as usize]["counters"].clone()
    };
    assert_eq!(
        counters("direct-failed-attempt-budget-12", failed)["joinUsed"],
        8
    );
    assert_eq!(
        counters("direct-failed-attempt-budget-12", failed)["joinLeft"],
        8
    );
    assert_eq!(
        counters("direct-second-only-budget-control", control)["joinUsed"],
        0
    );
    assert_eq!(
        counters("direct-second-only-budget-control", control)["joinLeft"],
        16
    );
}

#[test]
fn public_planning_policy_preserves_mutable_memo_lifetime_and_rule_words_drive_search() {
    use crate::map::TILE_FLOOR;
    use crate::mapdata::Zone;
    let w = 15;
    let n = w * w;
    let tiles = vec![TILE_FLOOR; n];
    let mut zone = vec![0; n];
    for y in 1..14 {
        for x in 1..14 {
            zone[y * w + x] = 1;
        }
    }
    let g = ZoneGeometry::new(1, Zone::Fire, &zone, &tiles, w, w, &[]);
    let hard = vec![0; n];
    let rules = LandmarkDefinition {
        join_checks: 128,
        footprint_percent: 100.0,
        rim_tiles: 0.0,
    };
    let p = parse_template(LandmarkTemplate {
        key: "memo".into(),
        rows: vec!["#".into()],
        jobs: vec![],
    })
    .unwrap();
    let mut state = Stage4State::new(w, w, tiles.clone(), vec![], vec![0; n]);
    let mut rt = LandmarkRuntime::new(&mut state, &g, &hard, None, &rules);
    let mut memo = BTreeMap::new();
    let mut open_calls = 0;
    let mut computes = 0;
    let mut scores = 0;
    {
        let mut session = LandmarkSearch::with_planning(&mut rt, &hard, |rt, i| {
            open_calls += 1;
            *memo.entry(i).or_insert_with(|| {
                computes += 1;
                rt.open(i)
            })
        });
        let mut score = |_: &LandmarkRuntime<'_>, _: &Stamp, _: u8, _: bool| {
            scores += 1;
            0.0
        };
        assert!(session.best(&p, &mut score, 0, None).is_none());
        assert!(session.best(&p, &mut score, -1, None).is_none());
        assert_eq!(session.runtime().counters().refused, 0);
        session.reset();
        assert!(session.best(&p, &mut score, 0, None).is_none());
    }
    assert_eq!(open_calls, 338);
    assert_eq!(computes, 169);
    assert_eq!(scores, 3 * 49 * 8);
    let mut words = Vec::new();
    visit_content(&DEFAULT_DEFINITION, |w| words.push(w));
    assert_eq!(words, [12, 2]);
    let mut state = Stage4State::new(w, w, tiles, vec![], vec![0; n]);
    let mut rt = LandmarkRuntime::new(&mut state, &g, &hard, None, &rules);
    let mut session = LandmarkSearch::new(&mut rt).with_definition(SearchDefinition {
        default_tries: 0,
        origin_stride: 3,
    });
    let mut changed_scores = 0;
    assert!(session
        .best_default(
            &p,
            |_, _, _, _| {
                changed_scores += 1;
                0.0
            },
            None
        )
        .is_none());
    assert_eq!(changed_scores, 25 * 8);
    assert_eq!(session.runtime().counters().features_added, 0);
}

#[test]
fn actual_source_search_callbacks_selection_transactions_and_cache_match() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(f["node"], "v22.23.4");
    assert_eq!(f["platform"], "linux");
    assert_eq!(f["arch"], "x64");
    assert_eq!(f["sourceSha256"].as_object().unwrap().len(), 11);
    assert_eq!(f["actualSourceTaps"], true);
    assert_eq!(f["finalOutputEqualityRequired"], true);
    assert_eq!(f["noSpeculativeStatefulCalls"], true);
    assert_eq!(
        f["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "actual-1-0",
            "actual--1-0",
            "actual-4294967297-4294967296",
            "actual-176-0",
            "actual-54-0"
        ]
    );
    let inventory = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let events = c["events"].as_array().unwrap();
            let searches: Vec<_> = events.iter().filter(|e| e["type"] == "search").collect();
            let count = |kind: &str| {
                searches
                    .iter()
                    .flat_map(|e| e["trace"].as_array().unwrap())
                    .filter(|e| e["type"] == kind)
                    .count()
            };
            (
                c["finalHash"].as_str().unwrap(),
                events.len(),
                c["states"].as_array().unwrap().len(),
                searches.len(),
                count("bound"),
                count("score"),
                count("attempt"),
                count("patch"),
                count("reuse"),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        inventory,
        [
            ("b94d0723", 32, 42, 4, 3540, 818, 20, 2, 1),
            ("bf972bff", 28, 27, 4, 3744, 706, 9, 2, 1),
            ("803a5416", 48, 47, 4, 4408, 812, 9, 2, 1),
            ("8a047a06", 35, 39, 5, 3748, 2916, 16, 2, 1),
            ("965ea5e1", 30, 153, 5, 4304, 1788, 135, 2, 1),
        ]
    );
    let templates: BTreeMap<String, ParsedTemplate> = f["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let t: LandmarkTemplate = serde_json::from_value(v.clone()).unwrap();
            (t.key.clone(), parse_template(t).unwrap())
        })
        .collect();
    let mut searches = 0;
    let mut rime = 0;
    let mut cached_reuses = 0;
    for case in f["cases"].as_array().unwrap() {
        assert_eq!(case["finalVerified"], true);
        assert!(case["finalHash"].is_string());
        let events = case["events"].as_array().unwrap();
        let states = &case["states"];
        let input = &events.iter().find(|e| e["type"] == "stageInput").unwrap()["input"];
        let w = input["w"].as_u64().unwrap() as usize;
        let h = input["h"].as_u64().unwrap() as usize;
        let zone: Vec<u8> = serde_json::from_value(input["zone"].clone()).unwrap();
        let hard: Vec<u8> = serde_json::from_value(input["protect"].clone()).unwrap();
        let territory: Vec<u8> = serde_json::from_value(input["territoryGrid"].clone()).unwrap();
        let camps: Vec<StyleCamp> = input["camps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| StyleCamp {
                site: c["site"].as_u64().unwrap() as usize,
                r: c["r"].as_f64().unwrap(),
                territory: c["territory"].as_u64().unwrap() as u8,
                elite: c["elite"].as_bool().unwrap(),
            })
            .collect();
        let mut state = Stage4State::new(
            w,
            h,
            serde_json::from_value(input["tiles"].clone()).unwrap(),
            Vec::<MapFeature>::new(),
            serde_json::from_value(input["featureOwner"].clone()).unwrap(),
        );
        for (start, e) in events
            .iter()
            .enumerate()
            .filter(|(_, e)| e["type"] == "zoneStart")
        {
            let info: ZoneInfo = serde_json::from_value(e["info"].clone()).unwrap();
            let g = ZoneGeometry::new(info.index, info.faction, &zone, &state.tiles, w, h, &camps);
            assert_eq!(json!(g.info), e["info"]);
            assert_eq!(rle(&json!(g.mask)), e["mask"]);
            assert_eq!(rle(&json!(g.edge_dist)), e["edgeDist"]);
            let mut rt = LandmarkRuntime::new(
                &mut state,
                &g,
                &hard,
                Some(&territory),
                &super::super::runtime::DEFAULT_DEFINITION,
            );
            assert_eq!(
                runtime_snapshot(&rt),
                states[e["stateId"].as_u64().unwrap() as usize]
            );
            let q = Rc::new(RefCell::new(Transcript::default()));
            let mut session = LandmarkSearch::from_policy(
                &mut rt,
                ReplayPolicy {
                    hard: hard.clone(),
                    callbacks: q.clone(),
                },
            );
            let end = events[start + 1..]
                .iter()
                .position(|e| e["type"] == "zoneStart")
                .map_or(events.len(), |i| start + 1 + i);
            let mut previous_session = Value::Null;
            for e in &events[start + 1..end] {
                match e["type"].as_str().unwrap() {
                    "search" => {
                        if e["sessionId"].is_null() || e["sessionId"] != previous_session {
                            session.reset();
                        } else {
                            cached_reuses += 1;
                        }
                        session.policy.hard = expand(&e["hard"]);
                        previous_session = e["sessionId"].clone();
                        replay_search(&mut session, e, states, &q);
                        searches += 1;
                        if e["template"]["key"] == "watchtower" {
                            rime += 1;
                        }
                    }
                    "place" => {
                        let s: Stamp = serde_json::from_value(e["stamp"].clone()).unwrap();
                        let placed = session.place_stamp(
                            &templates[e["template"].as_str().unwrap()],
                            &s,
                            e["rot"].as_u64().unwrap() as u8,
                            e["mirror"].as_bool().unwrap(),
                        );
                        assert_eq!(json!(placed), e["result"]);
                        assert_eq!(
                            runtime_snapshot(session.runtime()),
                            states[e["stateId"].as_u64().unwrap() as usize]
                        );
                    }
                    "reset" => session.reset(),
                    _ => {}
                }
            }
        }
    }
    assert!(searches >= 13);
    assert!(rime > 0, "must capture a genuine Rime whole-zone fallback");
    assert!(cached_reuses >= 3);
}
