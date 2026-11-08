//! External presentation cadence cannot change gameplay or lose eligible buffered chunks.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{replay::run_replay, FactionId, FactionMode, PublicCommand, SimConfig, Vec2};
fn env() -> Env {
    let mut arena = rh_sim::arenas::practice_arena();
    arena.spawns = vec![
        Vec2::new(400., 320.),
        Vec2::new(456., 320.),
        Vec2::new(1300., 600.),
    ];
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig {
                quests: false,
                consumables: true,
                faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
                ..Default::default()
            },
            max_ticks: 300,
            record: true,
        },
        (0..3)
            .map(|i| AgentSpec {
                profile: format!("p{i}"),
                faction: if i == 0 {
                    FactionId::Frost
                } else {
                    FactionId::Holy
                },
                bot: false,
                agent: Agent::External,
            })
            .collect(),
        12,
    )
}
#[test]
fn every_step_feed_sparse_delivery_repeated_reads_and_replay() {
    let mut a = env();
    let mut b = env();
    let mut all = Vec::new();
    let mut sparse = Vec::new();
    for n in 0..100 {
        let commands = if n == 2 {
            vec![
                vec![PublicCommand::Attack { a: 0., t: None }],
                vec![PublicCommand::Attack {
                    a: std::f64::consts::PI,
                    t: None,
                }],
            ]
        } else {
            vec![]
        };
        let out = a.step(&commands);
        b.advance(&commands);
        all.extend(out.observations[0].events.clone());
        if n % 13 == 12 || n == 99 {
            let first = b.observations();
            let repeated = b.observations();
            assert_eq!(first, repeated, "same-tick observation is stable");
            sparse.extend(first[0].events.clone());
        }
        assert_eq!(a.sim.state_hash(), b.sim.state_hash());
    }
    assert!(a.sim.players().iter().any(|p| p.signature.chill < 1.));
    assert!(a
        .observations()
        .iter()
        .any(|o| o.me.as_ref().is_some_and(|p| p.sig & 1 != 0)));
    assert_eq!(all, sparse);
    let hash = a.sim.state_hash();
    let replay = a.into_replay().unwrap();
    assert_eq!(replay, b.into_replay().unwrap());
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
}
