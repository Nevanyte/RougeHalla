use rh_sim::{map::TileMap, mapdata::MapExport, FactionId, Placement, Secrets, Sim, SimConfig};

fn export() -> MapExport {
    serde_json::from_str(include_str!("../src/mapdata/fixtures/seed1.map.json")).unwrap()
}

#[test]
fn full_layers_survive_map_and_checkpoint_admission() {
    let arena = export().validate().unwrap().into_arena().unwrap();
    assert_eq!(arena.map.layers().unwrap().dimensions(), (160, 160));
    let point = arena.spawns[0];
    let sim = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(1),
        &[Placement {
            profile: "layercheck".into(),
            faction: FactionId::Fire,
            bot: false,
            at: point,
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    let encoded = serde_json::to_string(&sim).unwrap();
    let restored = Sim::restore(&mut serde_json::Deserializer::from_str(&encoded)).unwrap();
    assert_eq!(sim.state_hash(), restored.state_hash());
    let before = sim.arena().map.layers().unwrap();
    assert_eq!(before, restored.arena().map.layers().unwrap());
    assert_eq!(before.data().camps.len(), 50);
    assert!(before.is_coliseum_at_world(before.coliseum().centre.x, before.coliseum().centre.y));
}

#[test]
fn deserialization_cannot_attach_layers_to_equal_area_wrong_dimensions_or_wrong_floor() {
    let arena = export().validate().unwrap().into_arena().unwrap();
    let original = serde_json::to_value(&arena.map).unwrap();
    let mut wrong_shape = original.clone();
    wrong_shape["w"] = 80.into();
    wrong_shape["h"] = 320.into();
    assert!(serde_json::from_value::<TileMap>(wrong_shape).is_err());

    let mut wrong_floor = original;
    let spawn = arena.spawns[0];
    let index = (spawn.y / 32.0).floor() as usize * 160 + (spawn.x / 32.0).floor() as usize;
    wrong_floor["tiles"][index] = 1.into();
    assert!(serde_json::from_value::<TileMap>(wrong_floor).is_err());
}

#[test]
fn static_identity_includes_metadata_and_old_collision_map_input_still_loads() {
    let first = export();
    let mut changed = first.clone();
    changed.map.seed = changed.map.seed.wrapping_add(1);
    let make = |file: MapExport| {
        Sim::new(
            SimConfig::default(),
            file.validate().unwrap().into_arena().unwrap(),
            Secrets::from_seed(3),
        )
    };
    assert_ne!(make(first).state_hash(), make(changed).state_hash());
    let plain = TileMap::from_rows(&["###", "#.#", "###"]).unwrap();
    let mut json = serde_json::to_value(&plain).unwrap();
    assert!(json["layers"].is_null());
    json.as_object_mut().unwrap().remove("layers");
    assert!(serde_json::from_value::<TileMap>(json)
        .unwrap()
        .layers()
        .is_none());
}

#[test]
fn layer_typos_and_wall_spawn_overrides_are_refused_but_walkable_overrides_restore() {
    let arena = export().validate().unwrap().into_arena().unwrap();
    let valid_override = arena.spawns[1];
    let sim = Sim::new(SimConfig::default(), arena, Secrets::from_seed(9));
    let original = serde_json::to_value(&sim).unwrap();

    let mut typo = original.clone();
    let map = typo["statics"]["arena"]["map"].as_object_mut().unwrap();
    let layers = map.remove("layers").unwrap();
    map.insert("layerz".into(), layers);
    assert!(Sim::restore(typo).is_err());

    let mut wall = original.clone();
    wall["statics"]["arena"]["spawns"] = serde_json::json!([{"x":16.0,"y":16.0}]);
    assert!(Sim::restore(wall).is_err());

    let mut custom = original;
    custom["statics"]["arena"]["spawns"] = serde_json::json!([valid_override]);
    assert!(Sim::restore(custom).is_ok());
}
