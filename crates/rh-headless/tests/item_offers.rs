//! A nonprivileged policy and external seat both discover equipment from the returned observation.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::{scripted::Idle, MatchStart, Policy, PolicySpec};
use rh_sim::{
    arenas::practice_arena, replay::run_replay, ContainerKind, FactionId, ItemObserver,
    Observation, PickupHandle, PickupRefusal, PlayerId, PublicCommand, SeenEvent, Sim, SimConfig,
    WeaponId,
};
use WeaponId::{Axe, Bow, Sword};

/// Uses only the human-visible focus, slots and current hand.
fn propose(obs: &Observation) -> Vec<PublicCommand> {
    let inv = obs.inventory.unwrap();
    if inv.slots.iter().any(Option::is_none) {
        obs.props
            .iter()
            .find(|p| p.cue.focused)
            .map(|p| vec![PublicCommand::Pickup { handle: p.handle }])
            .unwrap_or_default()
    } else if inv.active_slot == 0 {
        vec![PublicCommand::Swap { slot: Some(1) }]
    } else {
        Vec::new()
    }
}
struct Equip;
impl Policy for Equip {
    fn spec(&self) -> PolicySpec {
        PolicySpec {
            name: "equip".into(),
            decision_interval_ticks: 3,
            ..Idle.spec()
        }
    }
    fn reset(&mut self, _: &MatchStart) {}
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        propose(obs)
    }
}

fn env(agent: Agent) -> Env {
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig::default(),
            max_ticks: 200,
            record: true,
        },
        vec![
            AgentSpec {
                profile: "equipper".into(),
                faction: FactionId::Holy,
                bot: false,
                agent,
            },
            AgentSpec {
                profile: "idle".into(),
                faction: FactionId::Fire,
                bot: false,
                agent: Agent::External,
            },
        ],
        2,
    );
    let me = env.sim.player(PlayerId(1)).unwrap().pos();
    let remote = env.sim.player(PlayerId(2)).unwrap().pos();
    env.seed_weapon_container(ContainerKind::Ground, remote, &[Sword])
        .unwrap();
    env.seed_weapon_container(ContainerKind::Ground, me, &[Axe])
        .unwrap();
    env.seed_weapon_container(ContainerKind::Ground, me, &[Bow])
        .unwrap();
    env
}

#[test]
fn policy_and_external_equip_from_observation_and_replay_without_sampling() {
    for policy in [false, true] {
        let mut env = env(if policy {
            Agent::Policy {
                policy: Box::new(Equip),
            }
        } else {
            Agent::External
        });
        let mut ob = env.observations();
        for _ in 0..10 {
            let orders = if policy {
                Vec::new()
            } else {
                vec![propose(&ob[0])]
            };
            ob = env.step(&orders).observations;
        }
        let own = rh_sim::observe(&env.sim, PlayerId(1), &[]);
        assert_eq!(own.inventory.unwrap().slots, [Some(Bow), Some(Axe)]);
        assert_eq!(own.inventory.unwrap().active_slot, 1);
        let hash = env.sim.state_hash();
        let replay = env.into_replay().unwrap();
        let (sim, _) = run_replay(&replay).unwrap();
        assert_eq!(sim.state_hash(), hash);
        assert_eq!(
            rh_sim::observe(&sim, PlayerId(1), &[]).inventory,
            own.inventory
        );
    }
}

#[test]
fn missed_handles_use_normal_queue_budget_and_owner_feedback_and_restore_between_submit_and_step() {
    let mut env = env(Agent::External);
    let mut views = env.observations();
    let h = views[0]
        .props
        .iter()
        .find(|p| p.cue.focused)
        .unwrap()
        .handle;
    let unknown = PublicCommand::Pickup {
        handle: PickupHandle::new(999).unwrap(),
    };
    let max = rh_sim::constants::MAX_ACTIONS_PER_TICK;
    let mut flood = vec![unknown; 40];
    flood[1] = PublicCommand::Pickup { handle: h };
    let result = env.step(&[flood]);
    views = result.observations;
    assert_eq!(
        views[0].events,
        vec![
            SeenEvent::PickupRefused {
                reason: PickupRefusal::NothingThere
            };
            max - 1
        ]
    );
    assert!(views[1].events.is_empty());
    assert_eq!(views[0].inventory.unwrap().slots, [Some(Bow), None]);
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    // Recording all 40 attempts (even refused queue/budget attempts) reconstitutes both the queue and budget.
    let commands: Vec<_> = replay.ticks[0]
        .inputs
        .iter()
        .filter_map(|i| match i {
            rh_sim::replay::ReplayInput::Command { cmd, .. } => Some(*cmd),
            _ => None,
        })
        .collect();
    assert_eq!(commands.len(), 40);
    assert_eq!(serde_json::to_value(commands[0]).unwrap(), "MissingPickup");
    assert_eq!(
        serde_json::to_value(commands[1]).unwrap()["Pickup"]["container_id"],
        3
    );
    assert_eq!(run_replay(&replay).unwrap().0.state_hash(), hash);
    // Build the same world from its trusted start. Snapshot after intake, before execution.
    let mut pending = rh_sim::replay::start_sim(&replay);
    for i in &replay.ticks[0].inputs {
        rh_sim::replay::apply_input(&mut pending, i);
    }
    let restored = Sim::restore(serde_json::to_value(&pending).unwrap()).unwrap();
    let (mut fresh, full) = Env::from_external_checkpoint(restored, 200).unwrap();
    assert_eq!(full.len(), 2);
    assert_eq!(full[0].inventory.unwrap().slots, [None, None]);
    assert_eq!(fresh.step(&[]).observations, views);
    assert_eq!(fresh.sim.state_hash(), hash);
}

#[test]
fn skipped_external_reads_do_not_issue_handles_or_affect_authoritative_state() {
    let mut observed = env(Agent::External);
    let mut sparse = env(Agent::External);
    let initial = observed.observations();
    for _ in 0..25 {
        observed.step(&[]);
        sparse.advance(&[]);
    }
    let frequent = observed.observations();
    let once = sparse.observations();
    assert_eq!(once[0].props, initial[0].props);
    assert_ne!(once[0].props, frequent[0].props);
    assert_eq!(observed.sim.state_hash(), sparse.sim.state_hash());
    assert_eq!(
        observed.into_replay().unwrap(),
        sparse.into_replay().unwrap()
    );
    // A fresh projector has no pre-restore bindings before it delivers an observation.
    let orphan = ItemObserver::new(PlayerId(1));
    assert_eq!(
        orphan
            .resolve(
                &env(Agent::External).sim,
                PublicCommand::Pickup {
                    handle: initial[0].props[0].handle
                }
            )
            .unwrap(),
        rh_sim::validate(rh_sim::RawCommand::MissingPickup).unwrap()
    );
}
