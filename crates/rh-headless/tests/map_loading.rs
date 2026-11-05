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
