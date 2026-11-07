//! Public inputs through the real headless adapter, native terrain, replay and continuation.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{terrain::Mode, FactionId, PublicCommand, SimConfig, Vec2};
#[test]
fn terrain_headless_public_inputs_replay_and_restore() {
    let export: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .unwrap();
    let mut arena = export.validate().unwrap().into_arena().unwrap();
    arena.spawns = [4, 5, 6]
        .into_iter()
        .map(|kind| {
            let i = arena
                .map
                .layers()
                .unwrap()
                .data()
                .terrain
                .iter()
                .position(|k| *k == kind)
                .unwrap();
            Vec2::new(
                (i % arena.map.w as usize) as f64 * 32. + 16.,
                (i / arena.map.w as usize) as f64 * 32. + 16.,
            )
        })
        .collect();
    let agents = (0..3)
        .map(|i| AgentSpec {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            agent: Agent::External,
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig {
                consumables: true,
                hazards: Mode::All,
                ..Default::default()
            },
            max_ticks: 80,
            record: true,
        },
        agents,
        4,
    );
    let commands = env
        .sim
        .players()
        .iter()
        .map(|p| {
            vec![PublicCommand::Move {
                x: p.body.x + 32.,
                y: p.body.y,
                seq: Some(1),
            }]
        })
        .collect::<Vec<_>>();
    let mut had_slip = false;
    let mut harmed = false;
    for t in 0..80 {
        let out = env.step(if t == 0 { &commands } else { &[] });
        let state = serde_json::to_value(&env.sim).unwrap();
        had_slip |= state["world"]["players"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| !p["core"]["motion"]["slip"].is_null());
        harmed |= env
            .sim
            .players()
            .iter()
            .any(|p| p.vitals.hp < p.vitals.max_hp);
        if t % 10 == 0 {
            let mut restored = rh_sim::Sim::restore(&state).unwrap();
            let mut original = env.sim.clone();
            assert_eq!(original.step(), restored.step());
            assert_eq!(original.state_hash(), restored.state_hash());
        }
        assert_eq!(out.truncated, t == 79);
        assert!(!out.terminated);
    }
    assert!(had_slip && harmed, "headless ran real ice and ember rules");
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    let (sim, _) = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(sim.state_hash(), hash);
}
