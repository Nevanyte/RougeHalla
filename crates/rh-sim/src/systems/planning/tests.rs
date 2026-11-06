use super::deal::*;
use crate::collision::tests::{fixture, fixture_map};
use serde_json::Value;
fn number(v: &Value) -> f64 {
    v.as_f64()
        .unwrap_or_else(|| match v["$float"].as_str().unwrap() {
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            "NaN" => f64::NAN,
            bad => panic!("unexpected sentinel {bad}"),
        })
}
pub(super) fn reward(input: &Value) -> crate::private_rng::Sfc32 {
    crate::private_rng::Sfc32::from_words(std::array::from_fn(|i| {
        input["rewardSalt"][i].as_u64().unwrap() as u32
    }))
}
#[test]
fn actual_source_spawn_walks_and_tier_boundaries() {
    let source = fixture();
    let map = fixture_map(&source);
    let walks = spawn_walks(&map);
    assert_eq!(
        walks.len(),
        source["maths"]["spawnWalks"].as_array().unwrap().len()
    );
    for (got, want) in walks
        .iter()
        .zip(source["maths"]["spawnWalks"].as_array().unwrap())
    {
        assert_eq!(got.unwrap_or(f64::INFINITY), number(want));
    }
    for case in source["maths"]["sameTier"].as_array().unwrap() {
        let i = &case["input"];
        assert_eq!(
            same_tier(number(&i["a"]), number(&i["b"]), number(&i["tolerance"])),
            case["expected"]
        );
    }
}
#[test]
fn all_200_source_deals_match_options_reports_and_every_reward_draw() {
    let source = fixture();
    let map = fixture_map(&source);
    let pool = &map.layers().unwrap().data().spawn_pool;
    let walks = spawn_walks(&map);
    let cases = source["dealSamples"].as_array().unwrap();
    assert_eq!(cases.len(), 200);
    for (index, case) in cases.iter().enumerate() {
        let input = &case["input"];
        assert_eq!(input["profile"], "core");
        let mut rng = reward(input);
        let expected: Vec<_> = case["randomTape"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["stream"] == "reward")
            .collect();
        let mut calls = 0;
        let got = deal(
            pool,
            &walks,
            input["n"].as_u64().unwrap() as usize,
            &mut || {
                let n = rng.next_f64();
                assert_eq!(
                    n,
                    expected[calls]["value"].as_f64().unwrap(),
                    "case{index} draw{calls}"
                );
                calls += 1;
                n
            },
        );
        assert_eq!(calls, expected.len(), "case{index} draw count");
        assert_eq!(
            serde_json::to_value(got).unwrap(),
            case["expected"],
            "case{index}"
        );
    }
}
#[test]
fn source_world_short_and_empty_pool_initial_deals_are_compared_as_algorithm_leaves() {
    let source = fixture();
    let map = fixture_map(&source);
    let all_pool = &map.layers().unwrap().data().spawn_pool;
    let all_walks = spawn_walks(&map);
    for name in [
        "planning-short-pool-contention-switch-free",
        "planning-no-pool-fallback-shuffle",
    ] {
        let case = source["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .unwrap();
        let input = &case["input"];
        let indices: Vec<_> = input["poolIndices"].as_array().map_or_else(Vec::new, |v| {
            v.iter().map(|v| v.as_u64().unwrap() as usize).collect()
        });
        let pool: Vec<_> = indices.iter().map(|i| all_pool[*i]).collect();
        let walks: Vec<_> = indices.iter().map(|i| all_walks[*i]).collect();
        let mut rng = reward(input);
        let mut calls = 0;
        let tape: Vec<_> = case["randomTape"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["stream"] == "reward")
            .collect();
        let got = deal(
            &pool,
            &walks,
            input["players"].as_array().unwrap().len(),
            &mut || {
                let n = rng.next_f64();
                assert_eq!(n, tape[calls]["value"].as_f64().unwrap());
                calls += 1;
                n
            },
        );
        assert_eq!(calls, tape.len());
        let first = case["frames"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| !f["private"]["planning"].is_null())
            .unwrap();
        let plan = &first["private"]["planning"];
        let expected: Vec<[i32; 2]> = plan["deals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| std::array::from_fn(|i| row[1]["spawns"][i].as_i64().unwrap() as i32))
            .collect();
        assert_eq!(got.pairs, expected);
        assert_eq!(serde_json::to_value(got.report).unwrap(), plan["report"]);
    }
}
#[test]
fn source_arena_slots_patience_ramp_and_declared_inner_spots() {
    let source = fixture();
    let map = fixture_map(&source);
    let arena = crate::Arena {
        spawns: map
            .layers()
            .unwrap()
            .data()
            .spawns
            .iter()
            .map(|p| crate::Vec2::new(p.x, p.y))
            .collect(),
        map,
    };
    for c in source["maths"]["slots"].as_array().unwrap() {
        let i = &c["input"];
        let got = crate::systems::arena_rules::slot_at(
            number(&i["startedAt"]),
            number(&i["notBefore"]),
            crate::ColiseumSchedule {
                first_seconds: number(&i["firstSeconds"]),
                second_seconds: number(&i["secondSeconds"]),
                repeat_seconds: number(&i["repeatSeconds"]),
                min_gap_seconds: 0.,
            },
        );
        assert_eq!(got.unwrap_or(f64::INFINITY), number(&c["expected"]));
    }
    for c in source["maths"]["patience"].as_array().unwrap() {
        let i = &c["input"];
        assert_eq!(
            crate::systems::arena_rules::patience_seconds(
                i["alive"].as_u64().unwrap() as usize,
                number(&i["full"]),
                number(&i["min"])
            ),
            number(&c["expected"])
        );
    }
    for c in source["maths"]["suddenDeath"].as_array().unwrap() {
        assert_eq!(
            crate::systems::arena_rules::sudden_death_share(number(&c["input"]["elapsedMs"])),
            number(&c["expected"])
        );
    }
    for c in source["maths"]["coliseumSpots"].as_array().unwrap() {
        assert_eq!(
            crate::systems::coliseum::spots(&arena, c["input"]["n"].as_u64().unwrap() as usize),
            c["expected"]
                .as_array()
                .unwrap()
                .iter()
                .map(crate::collision::tests::point)
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn actual_source_fallback_spots_and_resolved_planning_eta() {
    let source: Value = serde_json::from_slice(include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/abilities/source.json"
    )))
    .unwrap();
    let cases = source["helpers"]["coliseumFallback"].as_array().unwrap();
    assert_eq!(cases.len(), 9);
    for c in cases {
        let r = &c["input"]["room"];
        let w = r["w"].as_u64().unwrap() as u32;
        let h = r["h"].as_u64().unwrap() as u32;
        let mut tiles = vec![0; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                    tiles[(y * w + x) as usize] = crate::map::TILE_WALL;
                }
            }
        }
        if let Some(walls) = r["walls"].as_array() {
            for xy in walls {
                tiles
                    [(xy[1].as_u64().unwrap() * u64::from(w) + xy[0].as_u64().unwrap()) as usize] =
                    crate::map::TILE_WALL;
            }
        }
        let arena = crate::Arena {
            map: crate::TileMap::new(w, h, tiles).unwrap(),
            spawns: r["spawns"]
                .as_array()
                .unwrap()
                .iter()
                .map(crate::collision::tests::point)
                .collect(),
        };
        assert_eq!(
            crate::systems::coliseum::spots(&arena, c["n"].as_u64().unwrap() as usize),
            c["output"]
                .as_array()
                .unwrap()
                .iter()
                .map(crate::collision::tests::point)
                .collect::<Vec<_>>(),
            "{}",
            c["label"]
        );
    }
    let arena = fixture();
    let map = fixture_map(&arena);
    let walks = spawn_walks(&map);
    let cases = source["helpers"]["planningEta"].as_array().unwrap();
    assert_eq!(cases.len(), 31);
    for c in cases {
        let input = &c["input"];
        let distance = if let Some(i) = input["index"].as_u64() {
            assert_eq!(input["map"], "seed1");
            let d = walks[i as usize].unwrap_or(f64::INFINITY);
            assert_eq!(d, number(&c["distance"]));
            d
        } else {
            number(&input["distance"])
        };
        assert_eq!(super::view::walk_seconds(distance), number(&c["seconds"]));
    }
}
