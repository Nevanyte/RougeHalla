//! Real public Wish proposals follow the ordinary seat, queue, cadence and replay paths.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::{MatchStart, Policy, PolicySpec};
use rh_sim::{
    abilities::{Mode, Slot},
    Arena, Event, FactionId, Observation, PlayerId, PublicCommand, SimConfig, TileMap, Vec2,
};
fn config() -> EnvConfig {
    let mut tiles = vec![0; 40 * 24];
    for y in 0..24 {
        for x in 0..40 {
            if x == 0 || y == 0 || x == 39 || y == 23 {
                tiles[y * 40 + x] = 1;
            }
        }
    }
    EnvConfig {
        arena: Arena {
            map: TileMap::new(40, 24, tiles).unwrap(),
            spawns: vec![
                Vec2::new(300., 320.),
                Vec2::new(450., 320.),
                Vec2::new(600., 320.),
            ],
        },
        sim: SimConfig {
            consumables: true,
            abilities: Mode::Full,
            lifecycle: rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: 3600.,
                patience_min_seconds: 3600.,
                sudden_death_seconds: 60.,
            }),
            min_players: 2,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            wish_lock_ms: 0.,
            ..Default::default()
        },
        max_ticks: 40,
        record: true,
    }
}
fn cast(target: Option<PlayerId>) -> PublicCommand {
    PublicCommand::Cast {
        slot: Slot::Wish,
        x: 450.,
        y: 320.,
        id: target,
        t: None,
        seq: Some(71),
    }
}
#[test]
fn public_external_cast_replays_and_restores_pending_input() {
    let mut env = Env::new(
        config(),
        vec![
            ("frost", FactionId::Frost),
            ("fire", FactionId::Fire),
            ("holy", FactionId::Holy),
        ]
        .into_iter()
        .map(|(name, faction)| AgentSpec {
            profile: name.into(),
            faction,
            bot: false,
            agent: Agent::External,
        })
        .collect(),
        3,
    );
    for _ in 0..2 {
        env.step(&[]);
    }
    assert_eq!(env.sim.phase(), rh_sim::Phase::Active);
    let initial = env.observations();
    let owner = initial[0].me.as_ref().unwrap();
    assert!(owner.wish.is_some());
    let target = initial[0]
        .visible
        .iter()
        .find(|p| p.faction == FactionId::Fire)
        .unwrap()
        .id;
    let out = env.step(&[vec![cast(Some(target))], vec![], vec![]]);
    assert!(out
        .events
        .iter()
        .any(|e| matches!(e, Event::CastStarted { .. })));
    let checkpoint = serde_json::to_value(&env.sim).unwrap();
    let restored = rh_sim::Sim::restore(checkpoint).unwrap();
    assert_eq!(restored.state_hash(), env.sim.state_hash());
    for _ in 0..8 {
        env.step(&[vec![], vec![], vec![]]);
    }
    let expected = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    let checked = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(checked.0.state_hash(), expected);
}
struct WishPolicy {
    sent: bool,
}
impl Policy for WishPolicy {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "wish-test".into(),
            version: "1".into(),
            contract: rh_policy::POLICY_CONTRACT_VERSION,
            observation_version: rh_sim::OBSERVATION_VERSION,
            decision_interval_ticks: 2,
        }
    }
    fn reset(&mut self, _: &MatchStart) {
        self.sent = false;
    }
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        if self.sent || obs.phase != rh_sim::Phase::Active {
            return vec![];
        }
        assert!(obs.me.as_ref().unwrap().wish.is_some());
        self.sent = true;
        vec![cast(None)]
    }
}
#[test]
fn policy_cast_uses_normal_cadence_and_authority() {
    let mut env = Env::new(
        config(),
        vec![
            AgentSpec {
                profile: "holy-policy".into(),
                faction: FactionId::Holy,
                bot: true,
                agent: Agent::Policy {
                    policy: Box::new(WishPolicy { sent: false }),
                },
            },
            AgentSpec {
                profile: "human".into(),
                faction: FactionId::Fire,
                bot: false,
                agent: Agent::External,
            },
        ],
        3,
    );
    let mut landed = 0;
    for _ in 0..8 {
        let out = env.step(&[vec![]]);
        landed += out
            .events
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    Event::CastLanded {
                        ability: rh_sim::status_runtime::AbilityId::LastStand,
                        ..
                    }
                )
            })
            .count();
    }
    assert_eq!(landed, 1);
    assert!(env.seat_stats().iter().all(|(_, _, fault)| fault.is_none()));
    let replay = env.into_replay().unwrap();
    rh_sim::replay::run_replay(&replay).unwrap();
}
