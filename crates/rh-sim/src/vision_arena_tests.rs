//! Declared-input helper parity only. Full ordinary teleport lifecycle is a separate gate.
use super::*;
use crate::collision::tests::{fixture, fixture_map, point};
use serde_json::Value;
fn anchor(map: &TileMap, input: &Value) -> Vec2 {
    use crate::mapdata::GateSide;
    let gate =
        &map.layers().unwrap().coliseum().gates[input["index"].as_u64().unwrap_or(0) as usize];
    let tile = &gate.tiles[gate.tiles.len() / 2];
    let centre = Vec2::new(
        crate::map::tile_to_world_center(tile.x.into()),
        crate::map::tile_to_world_center(tile.y.into()),
    );
    let direction = match gate.side {
        GateSide::North => Vec2::new(0., 1.),
        GateSide::East => Vec2::new(-1., 0.),
        GateSide::South => Vec2::new(0., -1.),
        GateSide::West => Vec2::new(1., 0.),
    };
    let distance = match input["anchor"].as_str().unwrap() {
        "gateTile" => 0.,
        "gateIn" => input["distance"].as_f64().unwrap_or(64.),
        "gateOut" => -input["distance"].as_f64().unwrap_or(64.),
        bad => panic!("unsupported declared anchor {bad}"),
    };
    Vec2::new(
        centre.x + direction.x * distance,
        centre.y + direction.y * distance,
    )
}
#[test]
fn source_vision_helper_retains_expiries_across_same_tick_geometry_changes() {
    let source = fixture();
    let open = fixture_map(&source);
    let locked = open.closed_gates().unwrap();
    for case in source["visionHelpers"].as_array().unwrap() {
        let mut trail = VisionTrail::default();
        assert!(trail.reveals.is_empty());
        let actions = case["input"]["actions"].as_array().unwrap();
        assert_eq!(actions.len(), case["frames"].as_array().unwrap().len());
        for (action, expected) in actions.iter().zip(case["frames"].as_array().unwrap()) {
            let tick = action["now"].as_u64().unwrap() as u32 / 50;
            let variant = if action["variant"] == "locked" {
                Variant::Locked
            } else {
                Variant::Open
            };
            let view = View {
                open: &open,
                locked: &locked,
                variant,
            };
            let origin = anchor(&open, &action["origin"]);
            trail.refresh_on(origin, tick, variant);
            trail
                .check(tick, true, |x, y| x.is_finite() && y.is_finite())
                .unwrap();
            let last = trail.reveals.back().unwrap();
            let memory = &expected["memory"];
            assert_eq!(
                f64::from(last.tick) * TICK_MS,
                memory["lastUpdate"].as_f64().unwrap()
            );
            assert_eq!(last.origin.x, memory["lastX"].as_f64().unwrap());
            assert_eq!(last.origin.y, memory["lastY"].as_f64().unwrap());
            assert_eq!(
                if last.variant == Variant::Open {
                    "open"
                } else {
                    "locked"
                },
                memory["lastMapVariant"].as_str().unwrap()
            );
            let mut expires = Vec::new();
            for y in 0..open.h {
                for x in 0..open.w {
                    if let Some(seen) = trail.latest_reveal(view, x.into(), y.into(), tick, None) {
                        expires.push((
                            u64::from(y) * u64::from(open.w) + u64::from(x),
                            f64::from(seen) * TICK_MS + VISION_TRAIL_MS,
                        ));
                    }
                }
            }
            let want = memory["expiresAt"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| (v[0].as_u64().unwrap(), v[1].as_f64().unwrap()))
                .collect::<Vec<_>>();
            assert_eq!(
                expires, want,
                "full tile expiry parity at {tick} {variant:?}"
            );
            for (query, expected_query) in case["input"]["queries"]
                .as_array()
                .unwrap()
                .iter()
                .zip(expected["queries"].as_array().unwrap())
            {
                let at = anchor(&open, query);
                assert_eq!(at, point(&expected_query["point"]));
                assert_eq!(
                    trail.remembers(view, at, tick),
                    expected_query["trailCanSee"]
                );
                let current = !scene_line_blocked(&view, origin.x, origin.y, at.x, at.y);
                assert_eq!(current, expected_query["currentLOS"]);
                assert_eq!(
                    current && in_radius(origin, at),
                    expected_query["currentIsInVision"]
                );
            }
        }
    }
}
#[test]
fn tile_cache_consumes_same_tick_new_reveal_and_checks_tail_geometry() {
    let map =
        TileMap::from_rows(&["................................................................."])
            .unwrap();
    let mut trail = VisionTrail::default();
    trail.refresh_on(Vec2::new(16., 16.), 5, Variant::Locked);
    let prior = trail.reveals.iter().copied().collect::<Vec<_>>();
    let cache = TileVisionCache {
        tick: Some(5),
        previous: prior,
        ..Default::default()
    };
    trail.refresh_on(Vec2::new(1800., 16.), 5, Variant::Open);
    assert!(cache.extends(&trail, 5));
    let view = View {
        open: &map,
        locked: &map,
        variant: Variant::Open,
    };
    assert_eq!(trail.latest_reveal(view, 56, 0, 5, Some((5, 0))), Some(5));
    // Replacement, not extension: equal origin alone cannot justify reusing old cells.
    let mut replaced = VisionTrail::default();
    replaced.refresh_on(Vec2::new(16., 16.), 7, Variant::Open);
    assert!(!cache.extends(&replaced, 7));
}
#[test]
fn reveal_validation_rejects_impossible_same_tick_sequences() {
    let mut trail = VisionTrail::default();
    trail.refresh_on(Vec2::new(16., 16.), 5, Variant::Open);
    trail.refresh_on(Vec2::new(16., 16.), 5, Variant::Locked);
    assert!(trail.check(5, true, |_, _| true).is_ok());
    trail.reveals[1].ordinal = 0;
    assert!(trail.check(5, true, |_, _| true).is_err());
    trail.reveals[1].ordinal = 1;
    trail.reveals[1].variant = Variant::Open;
    assert!(trail.check(5, true, |_, _| true).is_err());
}

#[test]
fn persistent_tile_cache_reuses_source_helper_queries_without_changing_the_leaf_answer() {
    // A native actor is only the cache's carrier. This is declared-input VisionMemory helper
    // parity, not a claim that native arena transitions or full observer projections ran.
    let source = fixture();
    let map = fixture_map(&source);
    for case in source["visionHelpers"].as_array().unwrap() {
        let start = anchor(&map, &case["input"]["actions"][0]["origin"]);
        let placement = crate::Placement {
            profile: "vision helper".into(),
            faction: crate::FactionId::Holy,
            at: start,
            hp: None,
            weapon0: None,
            weapon1: None,
            bot: false,
        };
        let mut sim = Sim::reset_active(
            crate::SimConfig::default(),
            crate::Arena {
                map: map.clone(),
                spawns: vec![start],
            },
            crate::Secrets::from_seed(12),
            &[placement],
        );
        for _ in 0..2 {
            sim.seed_weapon_container(crate::ContainerKind::Ground, start, &[crate::WeaponId::Axe])
                .unwrap();
        }
        sim.w.players[0].vision = VisionTrail::default();
        let mut cache = TileVisionCache::default();
        for (action, expected) in case["input"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .zip(case["frames"].as_array().unwrap())
        {
            sim.w.tick = action["now"].as_u64().unwrap() as u32 / 50;
            sim.w.server_time = action["now"].as_f64().unwrap();
            sim.w.rt.gates_locked = action["variant"] == "locked";
            let origin = anchor(&map, &action["origin"]);
            sim.w.players[0].body.x = origin.x;
            sim.w.players[0].body.y = origin.y;
            refresh_player(&mut sim.w.players[0], sim.w.tick, sim.w.rt.gates_locked);
            let player = &sim.w.players[0];
            cache.begin(&sim, player, true);
            for (query, want) in case["input"]["queries"]
                .as_array()
                .unwrap()
                .iter()
                .zip(expected["queries"].as_array().unwrap())
            {
                let at = anchor(&map, query);
                let expected = want["currentIsInVision"].as_bool().unwrap()
                    || want["trailCanSee"].as_bool().unwrap();
                assert_eq!(
                    point_visible(
                        sim.collision_view(),
                        player,
                        at,
                        sim.tick(),
                        WardSight::none()
                    ),
                    expected
                );
                assert_eq!(
                    cache.sees(
                        sim.collision_view(),
                        player,
                        at,
                        sim.tick(),
                        WardSight::none()
                    ),
                    expected
                );
            }
        }
    }
}
#[test]
fn a_cached_negative_cell_sees_the_second_reveal_of_its_tick() {
    let map =
        TileMap::from_rows(&["................................................................."])
            .unwrap();
    let placement = crate::Placement {
        profile: "cache".into(),
        faction: crate::FactionId::Holy,
        at: Vec2::new(1800., 16.),
        hp: None,
        weapon0: None,
        weapon1: None,
        bot: false,
    };
    let mut sim = Sim::reset_active(
        crate::SimConfig::default(),
        crate::Arena {
            map: map.clone(),
            spawns: vec![placement.at],
        },
        crate::Secrets::from_seed(12),
        &[placement],
    );
    let player = &mut sim.w.players[0];
    player.vision = VisionTrail::default();
    player.vision.refresh_on(player.pos(), 5, Variant::Locked);
    let view = View {
        open: &map,
        locked: &map,
        variant: Variant::Open,
    };
    let mut cache = TileVisionCache {
        tick: Some(5),
        cells: vec![None; 64],
        ..Default::default()
    };
    let point = Vec2::new(16., 16.);
    assert!(!cache.sees(view, player, point, 5, WardSight::none()));
    player.vision.refresh_on(point, 5, Variant::Open);
    assert!(cache.sees(view, player, point, 5, WardSight::none()));
    assert!(point_visible(view, player, point, 5, WardSight::none()));
}
#[test]
fn every_new_persisted_reveal_fact_changes_identity() {
    let mut trail = VisionTrail::default();
    trail.refresh_on(Vec2::new(16., 16.), 5, Variant::Open);
    trail.refresh_on(Vec2::new(16., 16.), 5, Variant::Locked);
    let base = crate::hash::hash_of(0, &trail);
    let mut changed = trail.clone();
    changed.reveals[1].variant = Variant::Open;
    assert_ne!(base, crate::hash::hash_of(0, &changed));
    let mut changed = trail.clone();
    changed.reveals[1].ordinal = 0;
    assert_ne!(base, crate::hash::hash_of(0, &changed));
    assert!(
        trail.check(5, false, |_, _| true).is_err(),
        "locked history has no admitted producer in prerequisite-only stage"
    );
}

#[test]
fn restore_rejects_a_lone_open_reveal_with_second_ordinal() {
    let arena = crate::arenas::practice_arena();
    let at = arena.spawns[0];
    let placement = crate::Placement {
        profile: "restore ordinal".into(),
        faction: crate::FactionId::Holy,
        at,
        hp: None,
        weapon0: None,
        weapon1: None,
        bot: false,
    };
    let sim = Sim::reset_active(
        crate::SimConfig::default(),
        arena,
        crate::Secrets::from_seed(7),
        &[placement],
    );
    let mut checkpoint = serde_json::to_value(&sim).unwrap();
    let reveals = checkpoint["world"]["players"][0]["vision"]["reveals"]
        .as_array_mut()
        .unwrap();
    assert_eq!(reveals.len(), 1);
    assert_eq!(reveals[0]["variant"], "Open");
    reveals[0]["ordinal"] = serde_json::json!(1);
    assert!(Sim::restore(checkpoint).is_err());
}
