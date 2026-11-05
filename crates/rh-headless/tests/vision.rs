//! Whole private memory and gameplay agree across public sampling schedules, including an odd-phase mover.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::{scripted::Idle, MatchStart, Policy, PolicySpec};
use rh_sim::{
    arenas::practice_arena, replay::run_replay, ContainerKind, FactionId, Observation, PlayerId,
    PublicCommand, Sim, SimConfig, Vec2, WeaponId,
};
use std::sync::{Arc, Mutex};

struct Watch {
    interval: u32,
    received: Arc<Mutex<Vec<u32>>>,
}
impl Policy for Watch {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            decision_interval_ticks: self.interval,
            ..Idle.spec()
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        self.received.lock().unwrap().push(obs.tick);
        Vec::new()
    }
}

fn env(policy: Option<u32>) -> (Env, Arc<Mutex<Vec<u32>>>) {
    let mut arena = practice_arena();
    arena.spawns = vec![
        Vec2::new(100., 272.),
        Vec2::new(215., 272.),
        Vec2::new(1200., 272.),
    ];
    let received = Arc::new(Mutex::new(Vec::new()));
    let agents = (0..3)
        .map(|i| AgentSpec {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            agent: match (i, policy) {
                (2, Some(interval)) => Agent::Policy {
                    policy: Box::new(Watch {
                        interval,
                        received: received.clone(),
                    }),
                },
                _ => Agent::External,
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: 800,
            record: true,
        },
        agents,
        0,
    );
    env.seed_weapon_container(
        ContainerKind::Ground,
        Vec2::new(220., 272.),
        &[WeaponId::Bow],
    )
    .unwrap();
    (env, received)
}

#[test]
fn publication_and_policy_cadence_cannot_change_a_moving_viewers_trail_or_replay() {
    let (mut every, every_log) = env(Some(1));
    let (mut sparse, sparse_log) = env(Some(7));
    let (mut no_reads, _) = env(None);
    let walker = PlayerId(2);
    for age in 0..125 {
        let target = match age {
            0 => Some(Vec2::new(460., 272.)),
            40 => Some(Vec2::new(460., 440.)),
            85 => Some(Vec2::new(215., 272.)),
            _ => None,
        };
        let cmds = vec![
            vec![],
            target
                .into_iter()
                .map(|p| PublicCommand::Move {
                    x: p.x,
                    y: p.y,
                    seq: None,
                })
                .collect(),
        ];
        let full = every.step(&cmds).observations;
        sparse.advance(&cmds);
        no_reads.advance(&cmds);
        assert_eq!(every.sim.state_hash(), sparse.sim.state_hash());
        assert_eq!(every.sim.state_hash(), no_reads.sim.state_hash());
        if age % 11 == 0 {
            let view = &sparse.observations()[1];
            // Offers may renew on different samples; all public cues come from the same frozen world.
            assert_eq!(view.visible, full[1].visible);
            assert_eq!(
                view.props.iter().map(|p| &p.cue).collect::<Vec<_>>(),
                full[1].props.iter().map(|p| &p.cue).collect::<Vec<_>>()
            );
        }
        if age == 65 {
            let cp = serde_json::to_value(&every.sim).unwrap();
            let trail = &cp["world"]["players"][1]["vision"];
            assert_eq!(trail["phase"], 1);
            let reveals = trail["reveals"].as_array().unwrap();
            assert!(reveals.len() > 8);
            assert!(reveals.iter().all(|r| r["tick"].as_u64().unwrap() % 2 == 1));
            let restored = Sim::restore(cp).unwrap();
            assert_eq!(restored.state_hash(), every.sim.state_hash());
            assert_eq!(
                rh_sim::observe(&restored, walker, &[]),
                rh_sim::observe(&every.sim, walker, &[])
            );
            let (mut fresh, first) = Env::from_external_checkpoint(restored, 800).unwrap();
            assert_eq!(first[1].visible, full[1].visible);
            let mut comparison = every.sim.clone();
            fresh.advance(&[]);
            comparison.step();
            assert_eq!(fresh.sim.state_hash(), comparison.state_hash());
        }
    }
    assert!(every_log.lock().unwrap().len() > sparse_log.lock().unwrap().len() * 5);
    let h = no_reads.sim.state_hash();
    let replay = no_reads.into_replay().unwrap();
    assert_eq!(every.into_replay().unwrap(), replay);
    assert_eq!(sparse.into_replay().unwrap(), replay);
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), h);
}

#[test]
fn a_viewed_target_and_budgeted_guesses_share_the_recorded_headless_path() {
    let mut arena = practice_arena();
    let from = Vec2::new(100., 272.);
    arena.spawns = vec![from, Vec2::new(390., 272.)];
    let agents = (0..2)
        .map(|i| AgentSpec {
            profile: format!("actor{i}"),
            faction: FactionId::Holy,
            bot: false,
            agent: Agent::External,
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: 300,
            record: true,
        },
        agents,
        0,
    );
    env.seed_weapon_container(ContainerKind::Ground, from, &[WeaponId::Wand])
        .unwrap();
    let initial = env.observations();
    let handle = initial[0].props[0].handle;
    let other = initial[0].visible[0].id;
    let picked = env.step(&[vec![PublicCommand::Pickup { handle }]]);
    assert_eq!(
        picked.observations[0].me.as_ref().unwrap().weapon,
        WeaponId::Wand
    );
    let miss = PublicCommand::Target {
        actor: PlayerId(899),
    };
    let hit = PublicCommand::Target { actor: other };
    let locked = env.step(&[vec![miss, hit]]);
    assert_eq!(
        locked.observations[0].me.as_ref().unwrap().attack_target,
        Some(other)
    );
    for _ in 0..40 {
        env.advance(&[]);
    }
    let cp = serde_json::to_value(&env.sim).unwrap();
    let restored = Sim::restore(cp).unwrap();
    let (mut fresh, obs) = Env::from_external_checkpoint(restored, 300).unwrap();
    assert_eq!(obs[0].me.as_ref().unwrap().attack_target, Some(other));
    for _ in 0..20 {
        env.advance(&[]);
        fresh.advance(&[]);
        assert_eq!(fresh.sim.state_hash(), env.sim.state_hash());
        assert_eq!(fresh.last_events(), env.last_events());
    }
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    let commands: Vec<_> = replay
        .ticks
        .iter()
        .flat_map(|tick| &tick.inputs)
        .filter_map(|input| match input {
            rh_sim::replay::ReplayInput::Command {
                player: PlayerId(1),
                cmd,
            } => Some(*cmd),
            _ => None,
        })
        .collect();
    assert_eq!(
        commands[1..],
        [
            rh_sim::validate(rh_sim::RawCommand::MissingTarget).unwrap(),
            rh_sim::validate(rh_sim::RawCommand::Target { id: other }).unwrap()
        ]
    );
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
}

struct TakeWandAndLock;
impl Policy for TakeWandAndLock {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            decision_interval_ticks: 1,
            ..Idle.spec()
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let Some(me) = &obs.me else {
            return vec![];
        };
        if me.weapon != WeaponId::Wand {
            return obs
                .props
                .iter()
                .find(|p| p.cue.focused)
                .map(|p| PublicCommand::Pickup { handle: p.handle })
                .into_iter()
                .collect();
        }
        if me.attack_target.is_none() {
            return obs
                .visible
                .first()
                .map(|a| PublicCommand::Target { actor: a.id })
                .into_iter()
                .collect();
        }
        vec![]
    }
}
#[test]
fn an_inline_policy_locks_via_its_delivered_actor_rows() {
    let mut arena = practice_arena();
    let spawn = Vec2::new(100., 272.);
    arena.spawns = vec![spawn, Vec2::new(360., 272.)];
    let specs = vec![
        AgentSpec {
            profile: "policy".into(),
            faction: FactionId::Holy,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(TakeWandAndLock),
            },
        },
        AgentSpec {
            profile: "other".into(),
            faction: FactionId::Frost,
            bot: false,
            agent: Agent::External,
        },
    ];
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks: 50,
            record: true,
        },
        specs,
        0,
    );
    env.seed_weapon_container(ContainerKind::Ground, spawn, &[WeaponId::Wand])
        .unwrap();
    for _ in 0..6 {
        env.advance(&[]);
    }
    let own = rh_sim::observe(&env.sim, PlayerId(1), &[]);
    assert_eq!(own.me.unwrap().attack_target, Some(PlayerId(2)));
    let hash = env.sim.state_hash();
    assert_eq!(
        run_replay(&env.into_replay().unwrap())
            .unwrap()
            .0
            .state_hash(),
        hash
    );
}
