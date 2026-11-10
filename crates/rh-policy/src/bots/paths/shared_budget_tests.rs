//! Packet-owned tests for the borrowed room path allowance (P-BOT-PATH-BUDGET-1). The frozen source service script
//! `parity/policy/bot-tactics.json` (unchanged) is replayed through the borrowed entries: every walk/path answer, the service
//! counters and the caller allowance left must match the captured source rows, while the service-owned budget stays exactly
//! where it was. A small native sequence then pins the actual sharing capability: two distinct services consume one caller
//! allowance in order, a fresh cache hit answers before any take, only the caller resets at a frame boundary, the services
//! keep separate caches, and a cloned PathBudget still makes an independent value.
use crate::bots::kite::away_point;
use crate::bots::paths::{PathBudget, PathStats, RoomPathService, WalkAnswer};
use rh_sim::{TileMap, Vec2};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../../parity/policy/bot-tactics.json");

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
fn declared_map(f: &Value) -> TileMap {
    let map = &f["profile"]["map"];
    let w = map["w"].as_u64().expect("map width") as u32;
    let h = map["h"].as_u64().expect("map height") as u32;
    let tiles: Vec<u8> = map["tiles"]
        .as_array()
        .expect("map tiles")
        .iter()
        .map(|t| t.as_u64().expect("a tile") as u8)
        .collect();
    TileMap::new(w, h, tiles).expect("the declared map is admitted")
}
fn stats(searches: u64, hits: u64, fallbacks: u64) -> PathStats {
    PathStats {
        searches,
        hits,
        fallbacks,
    }
}
fn assert_walk(step: &Value, got: Option<WalkAnswer>) {
    match (got, step["result"].is_null()) {
        (None, true) => {}
        (Some(g), false) => {
            assert!(
                close(g.dist, num(&step["result"]["dist"])),
                "borrowed walk {} -> {}: {} != {}",
                step["from"],
                step["to"],
                r6(g.dist),
                num(&step["result"]["dist"])
            );
            assert_eq!(g.exact, step["result"]["exact"].as_bool().expect("exact"));
        }
        (got, want_null) => panic!("borrowed walk result {got:?} vs captured null={want_null}"),
    }
}
fn assert_path(step: &Value, got: Option<Vec<Vec2>>) {
    match (got, step["result"].is_null()) {
        (None, true) => {}
        (Some(points), false) => {
            let want = step["result"].as_array().expect("path points");
            assert_eq!(points.len(), want.len(), "borrowed path waypoint count");
            for (p, w) in points.iter().zip(want) {
                assert!(
                    close(p.x, num(&w["x"])) && close(p.y, num(&w["y"])),
                    "borrowed path point ({}, {}) != ({}, {})",
                    r6(p.x),
                    r6(p.y),
                    num(&w["x"]),
                    num(&w["y"])
                );
            }
        }
        (got, want_null) => panic!("borrowed path result {got:?} vs captured null={want_null}"),
    }
}
fn check_step(step: &Value, svc: &RoomPathService, room_left: u32, owned_left: u32) {
    let op = step["op"].as_str().expect("op");
    let got = svc.stats();
    let want = &step["stats"];
    assert_eq!(
        got.searches,
        want["searches"].as_u64().expect("searches"),
        "searches after {op}"
    );
    assert_eq!(
        got.hits,
        want["hits"].as_u64().expect("hits"),
        "hits after {op}"
    );
    assert_eq!(
        got.fallbacks,
        want["fallbacks"].as_u64().expect("fallbacks"),
        "fallbacks after {op}"
    );
    assert_eq!(
        room_left as u64,
        step["left"].as_u64().expect("left"),
        "caller allowance left after {op}"
    );
    assert_eq!(
        svc.budget().left(),
        owned_left,
        "the service-owned budget after {op}"
    );
}

#[test]
fn the_borrowed_entries_replay_the_frozen_source_script() {
    let f = fixture();
    assert_eq!(f["format"], "rh-bot-paths-source/1");
    assert_eq!(f["profile"]["node"], "v22.23.4");
    assert_eq!(f["profile"]["platform"], "linux");
    assert_eq!(f["profile"]["arch"], "x64");
    let map = declared_map(&f);
    let per_tick = f["profile"]["budgetPerTick"]
        .as_u64()
        .expect("budgetPerTick") as u32;
    // Deliberately different from the caller allowance: a borrowed call must leave this owned value untouched.
    const OWNED_PER_TICK: u32 = 7;
    let mut svc = RoomPathService::new(&map, PathBudget::new(OWNED_PER_TICK));
    let mut room = PathBudget::new(per_tick);
    assert_eq!(
        room.left(),
        per_tick,
        "a fresh caller PathBudget starts full"
    );
    let script = f["script"].as_array().expect("script");
    assert!(script.len() >= 50, "the declared script: {}", script.len());
    for step in script {
        match step["op"].as_str().expect("op") {
            "frame" => {
                // The caller owns the once-per-room-frame reset; set_frame is a frame/geometry update only.
                room.start_tick();
                svc.set_frame(num(&step["now"]), step["gated"].as_bool().expect("gated"));
                check_step(step, &svc, room.left(), OWNED_PER_TICK);
            }
            "walk" => {
                let got = svc.walk_with_budget(point(&step["from"]), point(&step["to"]), &mut room);
                assert_walk(step, got);
                check_step(step, &svc, room.left(), OWNED_PER_TICK);
            }
            "path" => {
                let got = svc.path_with_budget(point(&step["from"]), point(&step["to"]), &mut room);
                assert_path(step, got);
                check_step(step, &svc, room.left(), OWNED_PER_TICK);
            }
            "los" => {
                let before = room.left();
                assert_eq!(
                    svc.los(point(&step["a"]), point(&step["b"])),
                    step["result"].as_bool().expect("los"),
                    "los"
                );
                assert_eq!(room.left(), before, "los is allowance-free");
                check_step(step, &svc, room.left(), OWNED_PER_TICK);
            }
            "clear" => {
                let before = room.left();
                assert_eq!(
                    svc.clear(point(&step["a"]), point(&step["b"])),
                    step["result"].as_bool().expect("clear"),
                    "clear"
                );
                assert_eq!(room.left(), before, "clear is allowance-free");
                check_step(step, &svc, room.left(), OWNED_PER_TICK);
            }
            "away" => {
                let (left, before) = (room.left(), svc.stats());
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
                assert_eq!(room.left(), left, "away is allowance-free");
                assert_eq!(svc.stats(), before, "away is allowance-free");
                assert_eq!(
                    svc.budget().left(),
                    OWNED_PER_TICK,
                    "away touches no owned budget"
                );
            }
            other => panic!("unknown script op {other}"),
        }
    }
    assert_eq!(
        svc.budget().left(),
        OWNED_PER_TICK,
        "the owned budget is never touched by the borrowed entries"
    );
}

#[test]
fn two_services_share_one_caller_allowance_without_sharing_caches() {
    let f = fixture();
    let map = declared_map(&f);
    const OWNED_PER_TICK: u32 = 5;
    let mut first = RoomPathService::new(&map, PathBudget::new(OWNED_PER_TICK));
    let mut second = RoomPathService::new(&map, PathBudget::new(OWNED_PER_TICK));
    let mut room = PathBudget::new(1);
    room.start_tick();
    first.set_frame(0., false);
    second.set_frame(0., false);
    assert_eq!(room.left(), 1, "one caller allowance for the room frame");
    assert_eq!(first.budget().left(), OWNED_PER_TICK);
    assert_eq!(second.budget().left(), OWNED_PER_TICK);

    // The ordered first uncached request searches and spends the one caller allowance.
    let near = (Vec2::new(400., 400.), Vec2::new(400., 500.));
    let first_walk = first
        .walk_with_budget(near.0, near.1, &mut room)
        .expect("the granted search answers exactly");
    assert!(
        first_walk.exact && close(first_walk.dist, 64.),
        "{first_walk:?}"
    );
    assert_eq!(
        room.left(),
        0,
        "the first actual service spent the shared allowance"
    );
    assert_eq!(first.stats(), stats(1, 0, 0));
    assert_eq!(second.stats(), stats(0, 0, 0));
    assert_eq!(first.budget().left(), OWNED_PER_TICK);

    // Both entry families see the same service cache without duplicating the trip or spending the owned budget.
    let cached = first
        .path(near.0, near.1)
        .expect("the borrowed search cached the trip for the owned entry");
    assert_eq!(cached, vec![Vec2::new(400., 464.)]);
    assert_eq!(first.stats(), stats(1, 1, 0));
    assert_eq!(
        first.budget().left(),
        OWNED_PER_TICK,
        "a cache hit takes no owned allowance"
    );
    // A fresh hit still answers through the borrowed entries before any take.
    let hit_walk = first
        .walk_with_budget(near.0, near.1, &mut room)
        .expect("the fresh cache hit answers");
    assert!(hit_walk.exact && close(hit_walk.dist, 64.), "{hit_walk:?}");
    let hit_path = first
        .path_with_budget(near.0, near.1, &mut room)
        .expect("the same fresh trip answers path");
    assert_eq!(hit_path, vec![Vec2::new(400., 464.)]);
    assert_eq!(first.stats(), stats(1, 3, 0));
    assert_eq!(room.left(), 0, "cache hits take no caller allowance");

    // The second actual service has its own cache: it observes exhaustion, not the first service's hit.
    let fallback = second
        .walk_with_budget(near.0, near.1, &mut room)
        .expect("over budget answers the straight line guess");
    assert!(!fallback.exact);
    assert!(close(fallback.dist, rh_sim::math::hypot(0., 100.) * 1.3));
    assert_eq!(second.stats(), stats(0, 0, 1));
    assert_eq!(
        second.path_with_budget(near.0, near.1, &mut room),
        None,
        "over budget with no cached trip: no path"
    );
    assert_eq!(second.stats(), stats(0, 0, 2));

    // The frame server time advances without replenishing; only the caller resets the room allowance.
    first.set_frame(50., false);
    second.set_frame(50., false);
    assert_eq!(
        room.left(),
        0,
        "set_frame never replenishes the caller allowance"
    );
    assert_eq!(second.budget().left(), OWNED_PER_TICK);
    room.start_tick();
    assert_eq!(room.left(), 1);

    // The caller's reset lets the next missed search run; the second service still cannot see the first's trips.
    let far = (Vec2::new(16., 16.), Vec2::new(80., 400.));
    let far_walk = first
        .walk_with_budget(far.0, far.1, &mut room)
        .expect("the reset funds a new search");
    assert!(
        far_walk.exact && close(far_walk.dist, 282.509668),
        "{far_walk:?}"
    );
    assert_eq!(room.left(), 0);
    assert_eq!(first.stats(), stats(2, 3, 0));
    let far_fallback = second
        .walk_with_budget(far.0, far.1, &mut room)
        .expect("the second service is still over budget");
    assert!(!far_fallback.exact);
    assert!(close(
        far_fallback.dist,
        rh_sim::math::hypot(64., 384.) * 1.3
    ));
    assert_eq!(
        second.stats(),
        stats(0, 0, 3),
        "the second cache stayed empty across every first-service trip"
    );

    // Cloning a PathBudget still makes an independent value; no clone shares the remaining allowance.
    let mut clone = room.clone();
    assert_eq!(clone.left(), room.left());
    clone.start_tick();
    assert_eq!(clone.left(), 1);
    assert_eq!(
        room.left(),
        0,
        "the cloned budget did not refill the caller's"
    );

    // The owned entries ignore the caller allowance and spend only the service-owned budget.
    let owned_walk = first.walk(Vec2::new(80., 80.), Vec2::new(720., 720.));
    assert_eq!(
        owned_walk, None,
        "an empty path is the existing owned walk answer"
    );
    assert_eq!(first.stats(), stats(3, 3, 0));
    assert_eq!(
        first.budget().left(),
        OWNED_PER_TICK - 1,
        "the owned entry spent its own allowance"
    );
    assert_eq!(
        room.left(),
        0,
        "the owned entry never touches the caller allowance"
    );
    assert_eq!(second.budget().left(), OWNED_PER_TICK);

    // A borrowed call on the other service still cannot refill anything or see the first cache.
    assert_eq!(second.path_with_budget(far.0, far.1, &mut room), None);
    assert_eq!(second.stats(), stats(0, 0, 4));
    assert_eq!(second.budget().left(), OWNED_PER_TICK);

    // The caller alone permits the next missed search, whichever actual service asks next.
    room.start_tick();
    let second_walk = second
        .walk_with_budget(near.0, near.1, &mut room)
        .expect("the caller reset funds this service's search");
    assert!(
        second_walk.exact && close(second_walk.dist, 64.),
        "{second_walk:?}"
    );
    assert_eq!(second.stats(), stats(1, 0, 4));
    assert_eq!(room.left(), 0);
}
