//! Headless native constructor/record/restore path; no AI or full-match mob acceptance claim.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{Arena, FactionId, SimConfig, TileMap, Vec2};
#[test]
fn nonseat_mobs_survive_headless_record_and_restore() {
    let f: serde_json::Value = serde_json::from_str(include_str!(
        "../../rh-sim/tests/fixtures/mob-foundation-small.json"
    ))
    .unwrap();
    let export = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: serde_json::from_value(f["map"].clone()).unwrap(),
    };
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
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
    let config = EnvConfig {
        arena,
        sim: SimConfig {
            quests: false,
            consumables: true,
            mob_mode: rh_sim::mob_runtime::MobMode::SpawnFoundation,
            ..SimConfig::default()
        },
        max_ticks: 4,
        record: true,
    };
    let specs = (0..2)
        .map(|i| AgentSpec {
            profile: i.to_string(),
            faction: FactionId::Fire,
            bot: false,
            agent: Agent::External,
        })
        .collect();
    let mut env = Env::new(config, specs, 1);
    assert_eq!(env.external_players().len(), 2);
    assert_eq!(env.sim.mobs().len(), 3);
    for _ in 0..3 {
        env.step(&[vec![], vec![]]);
    }
    let hash = env.sim.state_hash();
    let restored = rh_sim::Sim::restore(serde_json::to_value(&env.sim).unwrap()).unwrap();
    assert_eq!(hash, restored.state_hash());
    let replay = env.into_replay().unwrap();
    let (rerun, _) = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(hash, rerun.state_hash());
}
