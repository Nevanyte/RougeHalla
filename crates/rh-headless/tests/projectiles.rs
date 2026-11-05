//! External seats use the ordinary observer/validated intake; flights are private and replay without observing.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    arenas::practice_arena, replay::run_replay, ContainerKind, Event, FactionId, PlayerId,
    PublicCommand, Sim, SimConfig, Vec2, WeaponId,
};

fn env(weapon: WeaponId) -> Env {
    let mut arena = practice_arena();
    arena.spawns = vec![
        Vec2::new(100., 272.),
        Vec2::new(480., 272.),
        Vec2::new(1480., 272.),
    ];
    let agents = (0..3)
        .map(|i| AgentSpec {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            agent: Agent::External,
        })
        .collect();
    let mut e = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: 150,
            record: true,
        },
        agents,
        0,
    );
    e.seed_weapon_container(ContainerKind::Ground, Vec2::new(100., 272.), &[weapon])
        .unwrap();
    let handle = e.observations()[0]
        .props
        .iter()
        .find(|r| r.cue.focused)
        .unwrap()
        .handle;
    let out = e.step(&[vec![PublicCommand::Pickup { handle }]]);
    assert_eq!(
        out.observations[0].inventory.unwrap().slots,
        [Some(weapon), None]
    );
    e
}

#[test]
fn directional_shots_replay_restore_in_flight_and_reveal_nothing_outside_sight() {
    for weapon in [WeaponId::Bow, WeaponId::Wand] {
        let (mut fired, mut quiet) = (env(weapon), env(weapon));
        let mut restored = None::<Sim>;
        let mut launches = 0;
        let mut ends = 0;
        let mut hits = 0;
        for n in 0..68 {
            let order = if n == 5 {
                vec![vec![
                    PublicCommand::Attack { a: 0., t: Some(0.) },
                    PublicCommand::Release { a: 0., t: None },
                ]]
            } else {
                Vec::new()
            };
            let out = fired.step(&order);
            let idle = quiet.step(&[]);
            assert_eq!(
                out.observations[2], idle.observations[2],
                "hidden {weapon:?}: tick {}",
                out.tick
            );
            if let Some(copy) = &mut restored {
                assert_eq!(copy.step(), out.events);
                assert_eq!(copy.state_hash(), fired.sim.state_hash());
            }
            for event in &out.events {
                match event {
                    Event::ProjectileLaunched(_) => {
                        launches += 1;
                        let cp = serde_json::to_value(&fired.sim).unwrap();
                        let live = &cp["world"]["projectiles"][0];
                        assert_eq!(live["launch"]["owner"], 1);
                        assert_eq!(
                            live["pos"], live["launch"]["origin"],
                            "fresh shot first moves next tick"
                        );
                        for (field, value) in [
                            ("time", serde_json::json!(-1)),
                            ("traveled", serde_json::json!(1e300)),
                            ("reflections", serde_json::json!(3)),
                        ] {
                            let mut bad = cp.clone();
                            bad["world"]["projectiles"][0][field] = value;
                            assert!(Sim::restore(&bad).is_err(), "{field}");
                        }
                        restored = Some(Sim::restore(cp).unwrap());
                    }
                    Event::ProjectileEnded { reason, .. } => {
                        ends += 1;
                        assert_eq!(*reason, rh_sim::ProjectileEnd::Hit);
                    }
                    Event::Hit { victim, by, .. }
                        if *victim == PlayerId(2) && *by == Some(PlayerId(1)) =>
                    {
                        hits += 1
                    }
                    _ => (),
                }
            }
        }
        assert_eq!((launches, ends, hits), (1, 1, 1));
        let hash = fired.sim.state_hash();
        let replay = fired.into_replay().unwrap();
        assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
    }
}
