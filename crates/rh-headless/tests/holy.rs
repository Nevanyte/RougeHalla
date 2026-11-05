//! The same partial foundation runs through external observed intake and private replay.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    arenas::practice_arena, replay::run_replay, Event, FactionId, PlayerId, PublicCommand,
    SeenEvent, Sim, SimConfig, Vec2,
};
fn env() -> Env {
    let mut arena = practice_arena();
    arena.spawns = vec![
        Vec2::new(100., 272.),
        Vec2::new(156., 272.),
        Vec2::new(1480., 272.),
    ];
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig {
                holy_foundation: true,
                ..Default::default()
            },
            max_ticks: 400,
            record: true,
        },
        (0..3)
            .map(|i| AgentSpec {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                agent: Agent::External,
            })
            .collect(),
        0,
    )
}
#[test]
fn external_holy_heals_replay_without_public_sampling_and_restore_in_engagement() {
    let (mut full, mut sparse, mut quiet) = (env(), env(), env());
    let mut heals = 0;
    let mut restored = None::<Sim>;
    for n in 0..180 {
        let order = if n == 2 {
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
        let out = full.step(&order);
        sparse.advance(&order);
        let idle = quiet.step(&[]);
        if n % 19 == 0 {
            let views = sparse.observations();
            assert_eq!(views[0].me, out.observations[0].me);
        }
        assert_eq!(full.sim.state_hash(), sparse.sim.state_hash());
        assert_eq!(
            out.observations[2], idle.observations[2],
            "hidden healing cannot change a remote observer"
        );
        for e in &out.events {
            if matches!(e, Event::Heal { .. }) {
                heals += 1;
            }
        }
        assert!(out.observations[2]
            .events
            .iter()
            .all(|e| !matches!(e, SeenEvent::Heal { .. })));
        if let Some(s) = &mut restored {
            assert_eq!(s.step(), out.events);
            assert_eq!(s.state_hash(), full.sim.state_hash());
        }
        if n == 70 {
            assert!(full.sim.player(PlayerId(1)).unwrap().signature.engaged);
            restored = Some(Sim::restore(serde_json::to_value(&full.sim).unwrap()).unwrap());
        }
    }
    assert!(heals > 20);
    let hash = full.sim.state_hash();
    let replay = full.into_replay().unwrap();
    assert!(replay.config.holy_foundation);
    assert_eq!(replay, sparse.into_replay().unwrap());
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
}
