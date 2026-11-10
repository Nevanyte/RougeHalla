use super::*;
use rh_protocol::map::MapBlob;
use rh_protocol::GroundMode;

fn first_playable() -> Arena {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../../../../maps/first-playable.json")).unwrap();
    export.validate().unwrap().into_arena().unwrap()
}

fn canonical_seed1() -> Arena {
    let export: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .unwrap();
    export.validate().unwrap().into_arena().unwrap()
}

fn header() -> WelcomeHeader {
    WelcomeHeader {
        protocol: rh_protocol::PROTOCOL_VERSION,
        content_hash: rh_sim::content::content_hash(),
        match_id: [3; 16],
        player_id: 1,
        session: [7; 16],
        tick_rate: rh_sim::constants::TICK_RATE as u8,
        tick: 0,
        server_ms: 0.,
    }
}

fn decoded(assets: &MapAssets, mode: GroundMode) -> MapBlob {
    let bytes = encode_welcome(&header(), super::archetype_table(), &assets.welcome_map, mode);
    assert!(bytes.len() <= rh_protocol::MAX_SERVER_FRAME);
    match ServerMsg::decode(&bytes).unwrap() {
        ServerMsg::Welcome { map, .. } => map,
        _ => panic!("expected Welcome"),
    }
}

#[test]
fn public_ground_projects_both_real_maps_without_inference() {
    for arena in [first_playable(), canonical_seed1()] {
        let assets = MapAssets::new(arena.clone()).unwrap();
        let map = decoded(&assets, GroundMode::Off);
        let layers = arena.map.layers().unwrap().data();
        assert_eq!(map.tiles, arena.map.tiles);
        assert_eq!(map.layer_hash, arena.map.layer_hash());
        assert_eq!(map.terrain.as_deref(), Some(layers.terrain.as_slice()));
        assert_eq!(map.regions.as_deref(), Some(layers.region_grid.as_slice()));
        assert_eq!(map.terrain_mode, GroundMode::Off);
        assert!(crate::public_ground::matches_static_map(
            &assets.welcome_map,
            &arena.map
        ));
    }
}

#[test]
fn public_ground_absence_differs_from_present_zero_surface() {
    let arena = first_playable();
    let rich = MapAssets::new(arena.clone()).unwrap();
    let plain = Arena {
        map: rh_sim::TileMap::new(arena.map.w, arena.map.h, arena.map.tiles.clone()).unwrap(),
        spawns: arena.spawns.clone(),
    };
    let absent = MapAssets::new(plain.clone()).unwrap();
    let a = decoded(&rich, GroundMode::Off);
    let b = decoded(&absent, GroundMode::Off);
    assert!(a.terrain.as_ref().unwrap().iter().all(|&cell| cell == 0));
    assert!(a.regions.is_some());
    assert!(b.terrain.is_none() && b.regions.is_none());
    assert_eq!(a.layer_hash, b.layer_hash);
    assert_ne!(a.semantic_hash, b.semantic_hash);
    assert!(!crate::public_ground::matches_static_map(
        &rich.welcome_map,
        &plain.map
    ));
    assert!(!crate::public_ground::matches_static_map(
        &absent.welcome_map,
        &arena.map
    ));
}

#[test]
fn public_ground_equal_collision_does_not_reuse_different_surface() {
    let original = first_playable();
    // Synthetic identity control based on a validated asset, not a claim that the generator emitted a new map.
    let mut export: rh_sim::mapdata::MapExport =
        serde_json::from_str(include_str!("../../../../maps/first-playable.json")).unwrap();
    let index = export
        .map
        .tiles
        .iter()
        .zip(&export.map.region_grid)
        .position(|(&tile, &region)| tile == 0 && region == 5)
        .unwrap();
    export.map.terrain[index] = 7;
    let altered = export.validate().unwrap().into_arena().unwrap();
    assert_eq!(original.map.tiles, altered.map.tiles);
    let a = MapAssets::new(original.clone()).unwrap();
    let b = MapAssets::new(altered.clone()).unwrap();
    let decoded_a = decoded(&a, GroundMode::Off);
    let decoded_b = decoded(&b, GroundMode::Off);
    assert_eq!(decoded_a.layer_hash, decoded_b.layer_hash);
    assert_ne!(decoded_a.semantic_hash, decoded_b.semantic_hash);
    assert_ne!(a.welcome_map, b.welcome_map);
    assert!(!crate::public_ground::matches_static_map(
        &a.welcome_map,
        &altered.map
    ));
    assert!(!crate::public_ground::matches_static_map(
        &b.welcome_map,
        &original.map
    ));
}

#[test]
fn public_ground_rejects_dimension_narrowing_before_encoding() {
    let arena = Arena {
        map: rh_sim::TileMap::new(65_536, 1, vec![1; 65_536]).unwrap(),
        spawns: vec![],
    };
    assert!(matches!(
        MapAssets::new(arena),
        Err(rh_protocol::EncodeError::BadMap("size"))
    ));
}

#[test]
fn public_ground_rejects_stale_native_layer_dimensions_even_with_equal_cell_count() {
    let mut arena = first_playable();
    std::mem::swap(&mut arena.map.w, &mut arena.map.h);
    assert!(matches!(
        MapAssets::new(arena),
        Err(rh_protocol::EncodeError::BadMap("ground dimensions"))
    ));
}

fn room_config(assets: &MapAssets, mode: rh_sim::terrain::Mode) -> RoomConfig {
    RoomConfig {
        sim: SimConfig {
            hazards: mode,
            ..Default::default()
        },
        arena: assets.arena.clone(),
        welcome_map: assets.welcome_map.clone(),
        fill_bots_to: 0,
        tick: Duration::from_millis(50),
        record: false,
        fixed_secrets: Some(Secrets::from_seed(3)),
        fixed_bot_seed: Some(3),
        reconnect_grace: Duration::from_secs(1),
        linger: Duration::from_secs(1),
    }
}

#[tokio::test]
async fn public_ground_room_mode_is_actual_and_outside_static_cache() {
    let assets = MapAssets::new(first_playable()).unwrap();
    let (reports, _) = mpsc::unbounded_channel();
    let mut maps = vec![];
    for mode in [
        rh_sim::terrain::Mode::Off,
        rh_sim::terrain::Mode::Map,
        rh_sim::terrain::Mode::All,
    ] {
        let room = Room::new(
            [1; 16],
            room_config(&assets, mode),
            reports.clone(),
            Instant::now(),
        );
        assert!(Arc::ptr_eq(&room.welcome_map, &assets.welcome_map));
        let bytes = room.welcome(PlayerId(1), [2; 16]);
        let ServerMsg::Welcome { map, .. } = ServerMsg::decode(&bytes).unwrap() else {
            panic!("expected Welcome");
        };
        assert_eq!(
            map.terrain_mode,
            crate::public_ground::mode(room.sim.config().hazards)
        );
        maps.push(map);
    }
    for map in &maps[1..] {
        assert_eq!(map.layer_hash, maps[0].layer_hash);
        assert_eq!(map.semantic_hash, maps[0].semantic_hash);
        assert_eq!(map.terrain, maps[0].terrain);
        assert_eq!(map.regions, maps[0].regions);
        assert_ne!(map.context_hash, maps[0].context_hash);
        assert_ne!(map, &maps[0]);
    }
    assert_ne!(maps[1].context_hash, maps[2].context_hash);
}

#[tokio::test]
#[should_panic(expected = "refusing a Welcome cache")]
async fn public_ground_room_refuses_mismatched_cache_binding() {
    let arena = first_playable();
    let rich = MapAssets::new(arena.clone()).unwrap();
    let absent = MapAssets::new(Arena {
        map: rh_sim::TileMap::new(arena.map.w, arena.map.h, arena.map.tiles.clone()).unwrap(),
        spawns: arena.spawns.clone(),
    })
    .unwrap();
    let mut config = room_config(&rich, rh_sim::terrain::Mode::Off);
    config.welcome_map = absent.welcome_map;
    let (reports, _) = mpsc::unbounded_channel();
    Room::new([1; 16], config, reports, Instant::now());
}
