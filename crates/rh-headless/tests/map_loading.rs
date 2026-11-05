//! Real map files enter the same authoritative runner and replay path as practice arenas.
use rh_headless::{load_arena, run_bot_match};

#[test]
fn full_map_file_retains_layers_through_headless_play_and_replay() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    );
    let arena = load_arena(path).unwrap();
    let layers = arena.map.layers().unwrap();
    assert_eq!(layers.data().seed, 1);
    assert_eq!(layers.data().camps.len(), 50);
    let (env, first) = run_bot_match(&arena, 4, 11, 120, true);
    let (_, again) = run_bot_match(&load_arena(path).unwrap(), 4, 11, 120, false);
    assert_eq!(first.state_hash, again.state_hash);
    assert_eq!(first.ticks, again.ticks);
    let replay = env.into_replay().unwrap();
    let encoded = serde_json::to_string(&replay).unwrap();
    let replay = serde_json::from_str(&encoded).unwrap();
    let (sim, _) = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(sim.state_hash(), first.state_hash);
    assert_eq!(sim.arena().map.layers(), arena.map.layers());
}

#[test]
fn existing_collision_map_files_keep_their_legacy_loading_path() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let arena = load_arena(path).unwrap();
    assert_eq!((arena.map.w, arena.map.h), (160, 160));
    assert!(arena.map.layers().is_none());
    assert!(!arena.spawns.is_empty());
}

#[test]
fn native_styled_generation_enters_the_same_headless_checkpoint_and_replay_path() {
    use rh_sim::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    // The second source seed genuinely refuses attempt zero, exercising generation's retry path.
    for seed in [1, 2459] {
        let map = generator
            .generate_styled(seed, None, pipeline::Options::default())
            .unwrap();
        assert_eq!(map.attempt, u64::from(seed == 2459));
        let legacy_map_hash_u32 = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
        let arena = rh_sim::mapdata::MapExport {
            format: "rh-map/2".into(),
            legacy_map_hash_u32,
            map,
        }
        .validate()
        .unwrap()
        .into_arena()
        .unwrap();
        let layers = arena.map.layers().unwrap();
        assert_eq!(layers.data().seed, seed);
        assert_eq!(layers.data().camps.len(), 50);
        assert!(!layers.data().props.is_empty());
        let (env, summary) = run_bot_match(&arena, 8, 37, 200, true);
        assert!(summary.ticks > 0);
        let checkpoint = serde_json::to_string(&env.sim).unwrap();
        let mut restored =
            rh_sim::Sim::restore(&mut serde_json::Deserializer::from_str(&checkpoint)).unwrap();
        let mut original = env.sim.clone();
        assert_eq!(restored.state_hash(), original.state_hash());
        for _ in 0..10 {
            original.step();
            restored.step();
        }
        assert_eq!(restored.state_hash(), original.state_hash());
        assert_eq!(restored.arena().map.layers(), arena.map.layers());
        let replay = serde_json::to_string(&env.into_replay().unwrap()).unwrap();
        let replay = serde_json::from_str(&replay).unwrap();
        let (replayed, _) = rh_sim::replay::run_replay(&replay).unwrap();
        assert_eq!(replayed.state_hash(), summary.state_hash);
        assert_eq!(replayed.arena().map.layers(), arena.map.layers());
    }
}
