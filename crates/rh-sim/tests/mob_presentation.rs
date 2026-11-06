use rh_sim::{Arena, FactionId, Placement, Secrets, Sim, SimConfig, TileMap, Vec2};
fn scene() -> Sim {
    let map = serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    let arena = Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    };
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    Sim::reset_active(
        SimConfig {
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        secrets,
        &[
            Placement {
                profile: "viewer".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(80., 112.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "distant".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(624., 624.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}
#[test]
fn restore_reserves_camp_birth_batch_before_other_actor_validation() {
    let s = scene();
    let original = serde_json::to_value(s).unwrap();
    let mut v = original.clone();
    v["world"]["next_id"] = (u32::MAX - 3).into();
    let error = Sim::restore(v).err().unwrap().to_string();
    assert!(error.contains("camp births"), "{error}");
    // Exercise the entity admission boundary directly; later provenance checks are deliberately
    // not a claim that this synthetic near-exhaustion checkpoint was otherwise reachable.
    let mut v = original;
    v["world"]["tick"] = 1_000_000_000u32.into();
    v["world"]["server_time"] = 50_000_000_000u64.into();
    v["world"]["mobs"] = serde_json::json!([]);
    v["world"]["entity_counter"] = (u32::MAX - 40).into();
    let error = Sim::restore(v).err().unwrap().to_string();
    assert!(error.contains("entity identity headroom"), "{error}");
}
