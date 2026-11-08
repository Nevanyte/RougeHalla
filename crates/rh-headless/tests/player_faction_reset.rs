//! All five admitted player signatures use the real public seat and source lifecycle in replay.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_sim::{
    Arena, ArenaMode, ArenaRules, Event, FactionId, FactionMode, PublicCommand, Sim, SimConfig,
    TileMap, Vec2,
};
#[test]
fn all_five_public_player_faction_teleports_replay() {
    for faction in [
        FactionId::Holy,
        FactionId::Fire,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Sentenced,
    ] {
        let mut env = Env::new(
            EnvConfig {
                arena: Arena {
                    map: TileMap::new(40, 24, vec![0; 960]).unwrap(),
                    spawns: vec![
                        Vec2::new(300., 320.),
                        Vec2::new(332., 320.),
                        Vec2::new(316., 336.),
                    ],
                },
                sim: SimConfig {
                    // This bounded player reset profile installs no consumables/wind module.
                    consumables: false,
                    abilities: rh_sim::abilities::Mode::Full,
                    faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
                    lifecycle: ArenaMode::Source(ArenaRules {
                        plan_seconds: 0.,
                        first_patience_seconds: Some(5.1),
                        coliseum_schedule: None,
                        patience_seconds: 5.1,
                        patience_min_seconds: 5.1,
                        sudden_death_seconds: 60.,
                    }),
                    min_players: 3,
                    lobby_seconds: 0.,
                    fill_seconds: 0.,
                    wish_lock_ms: 0.,
                    ..Default::default()
                },
                max_ticks: 180,
                record: true,
            },
            [faction, FactionId::Holy, FactionId::Fire]
                .into_iter()
                .enumerate()
                .map(|(i, faction)| AgentSpec {
                    profile: format!("p{i}"),
                    faction,
                    bot: false,
                    agent: Agent::External,
                })
                .collect(),
            3,
        );
        env.step(&[]);
        let view = env.observations();
        let own = view[0].me.as_ref().unwrap();
        let other = &view[0].visible[0];
        let a = rh_sim::math::atan2(other.y - own.y, other.x - own.x);
        env.step(&[vec![PublicCommand::Attack { a, t: None }], vec![], vec![]]);
        let mut teleported = false;
        for _ in 0..140 {
            let out = env.step(&[vec![], vec![], vec![]]);
            if out.events.iter().any(|e| matches!(e, Event::Teleported)) {
                teleported = true;
                let json = serde_json::to_value(&env.sim).unwrap();
                assert_eq!(
                    Sim::restore(json).unwrap().state_hash(),
                    env.sim.state_hash()
                );
                for obs in &out.observations {
                    let p = obs.me.as_ref().unwrap();
                    assert_eq!(p.mark_tier, 0);
                    assert_eq!(p.mark_by, None);
                    assert_eq!(p.brand, 0);
                }
            }
        }
        assert!(teleported, "{faction:?}: genuine source teleport");
        let hash = env.sim.state_hash();
        let replay = env.into_replay().unwrap();
        assert_eq!(
            rh_sim::replay::run_replay(&replay).unwrap().0.state_hash(),
            hash
        );
    }
}
