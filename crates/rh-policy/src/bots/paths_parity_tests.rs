//! The brain path service and away-point step against the actual-source corpus parity/policy/bot-tactics.json (captured from
//! brain/services.ts and brain/tactics/kite.ts in the pinned linux/amd64 Node 22.23.4 container). Every declared service step is
//! replayed in order (frames, walks, paths, sight/clear queries) and the answers, the service counters and the budget left must
//! match the source capture; the away-point cases pin the heading/shortening search.
use crate::bots::kite::away_point;
use crate::bots::paths::{PathBudget, RoomPathService};
use rh_sim::{TileMap, Vec2};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../parity/policy/bot-tactics.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the captured tactics corpus parses")
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("a number")
}
fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}
fn point(v: &Value) -> Vec2 {
    let x = v["x"].as_f64().unwrap_or(f64::NAN);
    let y = v["y"].as_f64().unwrap_or(f64::NAN);
    Vec2::new(x, y)
}
fn close(a: f64, b: f64) -> bool {
    r6(a) == r6(b)
}
fn check_stats(step: &Value, svc: &RoomPathService) {
    let stats = svc.stats();
    let left = svc.budget().left();
    assert_eq!(
        stats.searches,
        step["stats"]["searches"].as_u64().expect("searches"),
        "searches after {:?}",
        step["op"]
    );
    assert_eq!(stats.hits, step["stats"]["hits"].as_u64().unwrap(), "hits");
    assert_eq!(
        stats.fallbacks,
        step["stats"]["fallbacks"].as_u64().unwrap(),
        "fallbacks"
    );
    assert_eq!(left as u64, step["left"].as_u64().unwrap(), "budget left");
}

#[test]
fn the_path_service_matches_the_source_step_by_step() {
    let f = fixture();
    assert_eq!(f["format"], "rh-bot-paths-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    let map_value = &f["profile"]["map"];
    let w = map_value["w"].as_u64().unwrap() as u32;
    let h = map_value["h"].as_u64().unwrap() as u32;
    let tiles: Vec<u8> = map_value["tiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t.as_u64().unwrap() as u8)
        .collect();
    let map = TileMap::new(w, h, tiles).expect("the declared map is admitted");
    let per_tick = f["profile"]["budgetPerTick"].as_u64().unwrap() as u32;
    let mut svc = RoomPathService::new(&map, PathBudget::new(per_tick));
    let script = f["script"].as_array().expect("script");
    assert!(script.len() >= 50, "the declared script: {}", script.len());
    for step in script {
        let op = step["op"].as_str().expect("op");
        match op {
            "frame" => {
                svc.budget_mut().start_tick();
                svc.set_frame(num(&step["now"]), step["gated"].as_bool().unwrap());
                check_stats(step, &svc);
            }
            "walk" => {
                let got = svc.walk(point(&step["from"]), point(&step["to"]));
                match (got, step["result"].is_null()) {
                    (None, true) => {}
                    (Some(g), false) => {
                        assert!(
                            close(g.dist, num(&step["result"]["dist"])),
                            "walk {} -> {}: {} != {}",
                            step["from"],
                            step["to"],
                            r6(g.dist),
                            num(&step["result"]["dist"])
                        );
                        assert_eq!(g.exact, step["result"]["exact"].as_bool().unwrap());
                    }
                    (got, want_null) => panic!("walk result {got:?} vs captured null={want_null}"),
                }
                check_stats(step, &svc);
            }
            "path" => {
                let got = svc.path(point(&step["from"]), point(&step["to"]));
                match (got, step["result"].is_null()) {
                    (None, true) => {}
                    (Some(points), false) => {
                        let want = step["result"].as_array().expect("path points");
                        assert_eq!(points.len(), want.len(), "path waypoint count");
                        for (p, w) in points.iter().zip(want) {
                            assert!(close(p.x, num(&w["x"])) && close(p.y, num(&w["y"])));
                        }
                    }
                    (got, want_null) => panic!("path result {got:?} vs captured null={want_null}"),
                }
                check_stats(step, &svc);
            }
            "los" => {
                assert_eq!(
                    svc.los(point(&step["a"]), point(&step["b"])),
                    step["result"].as_bool().unwrap(),
                    "los"
                );
                check_stats(step, &svc);
            }
            "clear" => {
                assert_eq!(
                    svc.clear(point(&step["a"]), point(&step["b"])),
                    step["result"].as_bool().unwrap(),
                    "clear"
                );
                check_stats(step, &svc);
            }
            "away" => {
                let got = away_point(
                    &svc,
                    point(&step["self"]),
                    point(&step["threat"]),
                    num(&step["stepU"]),
                    num(&step["jitter"]),
                );
                match (got, step["result"].is_null()) {
                    (None, true) => {}
                    (Some(p), false) => assert!(
                        close(p.x, num(&step["result"]["x"]))
                            && close(p.y, num(&step["result"]["y"])),
                        "away {} -> {}: ({}, {}) != ({}, {})",
                        step["self"],
                        step["threat"],
                        r6(p.x),
                        r6(p.y),
                        num(&step["result"]["x"]),
                        num(&step["result"]["y"])
                    ),
                    (got, want_null) => panic!("away result {got:?} vs captured null={want_null}"),
                }
            }
            other => panic!("unknown script op {other}"),
        }
    }
}
