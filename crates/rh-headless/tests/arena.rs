//! Native Source lifecycle through owner observations, validated policy commands and replay.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::scripted::Brawler;
use rh_sim::{Arena, ArenaMode, ArenaRules, FactionId, Phase, PublicCommand, SimConfig};
fn map() -> Arena {
    let export: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
        "../../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .unwrap();
    export.validate().unwrap().into_arena().unwrap()
}
fn config() -> SimConfig {
    SimConfig {
        consumables: true,
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 1.,
            first_patience_seconds: Some(0.1),
            coliseum_schedule: None,
            patience_seconds: 0.2,
            patience_min_seconds: 0.2,
            sudden_death_seconds: 0.05,
        }),
        min_players: 2,
        lobby_seconds: 0.,
        fill_seconds: 0.,
        hazards: rh_sim::terrain::Mode::Off,
        ..Default::default()
    }
}
fn agents(policy: bool) -> Vec<AgentSpec> {
    (0..2)
        .map(|i| AgentSpec {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: policy,
            agent: if policy {
                Agent::Policy {
                    policy: Box::new(Brawler::new(1)),
                }
            } else {
                Agent::External
            },
        })
        .collect()
}
#[test]
fn external_owner_choices_enter_the_real_raid_then_lock_and_replay() {
    let mut env = Env::new(
        EnvConfig {
            arena: map(),
            sim: config(),
            max_ticks: 300,
            record: true,
        },
        agents(false),
        12,
    );
    assert_eq!(env.sim.phase(), Phase::Lobby);
    let out = env.step(&[]);
    assert_eq!(env.sim.phase(), Phase::Planning);
    assert_eq!(out.observations.len(), 2);
    let commands = out
        .observations
        .iter()
        .map(|o| {
            let own = o.plan.as_ref().unwrap();
            assert_eq!(own.plan.pick, -1);
            assert!(own.options.iter().all(Option::is_some));
            vec![PublicCommand::Plan {
                spawn: Some(0),
                boon: None,
                ready: Some(true),
            }]
        })
        .collect::<Vec<_>>();
    env.step(&commands);
    assert_eq!(env.sim.phase(), Phase::Active);
    let mut locked = false;
    for _ in 0..200 {
        let out = env.step(&[]);
        locked |= out
            .observations
            .iter()
            .any(|o| o.arena.is_some_and(|a| a.gates_locked));
        assert!(out.observations.iter().all(|o| o.plan.is_none()));
        if out.terminated {
            break;
        }
    }
    assert!(locked);
    assert_eq!(env.sim.phase(), Phase::Ended);
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    assert!(matches!(replay.start, rh_sim::replay::ReplayStart::Lobby));
    let (replayed, _) = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(replayed.state_hash(), hash);
}
#[test]
fn policy_uses_its_owner_plan_before_deadline_and_records_validated_choices() {
    let mut env = Env::new(
        EnvConfig {
            arena: map(),
            sim: config(),
            max_ticks: 200,
            record: true,
        },
        agents(true),
        12,
    );
    env.step(&[]);
    assert_eq!(env.sim.phase(), Phase::Planning);
    env.step(&[]);
    assert_eq!(env.sim.phase(), Phase::Active);
    assert!(env
        .seat_stats()
        .iter()
        .all(|(_, s, f)| s.accepted > 0 && f.is_none()));
    for _ in 0..8 {
        env.step(&[]);
    }
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    let (replayed, _) = rh_sim::replay::run_replay(&replay).unwrap();
    assert_eq!(replayed.state_hash(), hash);
}
