//! Determinism, replay, checkpoint, resets, terminal/truncation, policy faults and the input budget, through the headless
//! environment (docs/CONTRACTS.md C-DET, C-POLICY, C-INPUT).

use rh_headless::*;
use rh_policy::scripted::{Brawler, Flood, Idle, Panicky};
use rh_sim::arenas::practice_arena;
use rh_sim::{FactionId, RawCommand, SimConfig};

fn bots(n: usize) -> Vec<AgentSpec> {
    (0..n)
        .map(|i| AgentSpec {
            profile: format!("b{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2)),
            },
        })
        .collect()
}

#[test]
fn same_seed_same_match_and_different_seeds_differ() {
    let arena = practice_arena();
    let (_, a) = run_bot_match(&arena, 8, 7, 4000, false);
    let (_, b) = run_bot_match(&arena, 8, 7, 4000, false);
    let (_, c) = run_bot_match(&arena, 8, 8, 4000, false);
    assert_eq!(a.state_hash, b.state_hash);
    assert_eq!(a.ticks, b.ticks);
    assert_ne!(a.state_hash, c.state_hash);
    assert!(a.hits > 0, "the bots fought");
}

#[test]
fn a_recorded_match_replays_exactly() {
    let (env, s) = run_bot_match(&practice_arena(), 6, 3, 3000, true);
    let replay = env.into_replay().unwrap();
    assert_eq!(replay.hashes.len() as u32, s.ticks);
    // Through JSON and back, as a file would.
    let text = serde_json::to_string(&replay).unwrap();
    let mut back: rh_sim::replay::Replay = serde_json::from_str(&text).unwrap();
    back.arena.map.rebuild();
    let (sim, _) = rh_sim::replay::run_replay(&back).expect("replays");
    assert_eq!(sim.state_hash(), s.state_hash);
}

#[test]
fn a_checkpoint_continues_identically() {
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig::default(),
            max_ticks: 5000,
            record: false,
        },
        bots(4),
        11,
    );
    for _ in 0..300 {
        env.step(&[]);
    }
    let text = serde_json::to_string(&env.sim).unwrap();
    let mut restored: rh_sim::Sim = serde_json::from_str(&text).unwrap();
    restored.after_restore();
    assert_eq!(restored.state_hash(), env.sim.state_hash());
    // Step both with no further inputs: identical.
    for _ in 0..200 {
        env.sim.step();
        restored.step();
    }
    assert_eq!(restored.state_hash(), env.sim.state_hash());
}

#[test]
fn resets_are_independent() {
    let arena = practice_arena();
    let (_, first) = run_bot_match(&arena, 4, 21, 2000, false);
    let _ = run_bot_match(&arena, 4, 99, 2000, false);
    let (_, again) = run_bot_match(&arena, 4, 21, 2000, false);
    assert_eq!(
        first.state_hash, again.state_hash,
        "nothing leaks from one match into the next"
    );
}

#[test]
fn terminated_and_truncated_are_distinct() {
    let arena = practice_arena();
    let (_, short) = run_bot_match(&arena, 4, 5, 10, false);
    assert!(short.truncated && !short.terminated);
    let (_, long) = run_bot_match(&arena, 2, 5, 20_000, false);
    assert!(
        long.terminated && !long.truncated,
        "a 2-bot brawl ends by the rules"
    );
    assert_eq!(long.results.len(), 2);
}

#[test]
fn a_failing_policy_falls_back_and_the_match_goes_on() {
    let agents = vec![
        AgentSpec {
            profile: "p".into(),
            faction: FactionId::Fire,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Panicky(5)),
            },
        },
        AgentSpec {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(1)),
            },
        },
    ];
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig::default(),
            max_ticks: 400,
            record: false,
        },
        agents,
        1,
    );
    for _ in 0..50 {
        env.step(&[]);
    }
    let stats = env.seat_stats();
    assert_eq!(stats[0].2, Some(rh_policy::Fault::Panicked));
    assert!(stats[0].1.fallback_decisions > 0);
    assert!(stats[1].2.is_none());
}

#[test]
fn a_flooding_policy_gets_no_extra_actions() {
    let agents = vec![
        AgentSpec {
            profile: "f".into(),
            faction: FactionId::Fire,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Flood),
            },
        },
        AgentSpec {
            profile: "i".into(),
            faction: FactionId::Holy,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Idle),
            },
        },
    ];
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig::default(),
            max_ticks: 400,
            record: false,
        },
        agents,
        1,
    );
    for _ in 0..200 {
        env.step(&[]);
    }
    let s = &env.seat_stats()[0].1;
    // 10 s of sim time: at most the burst (30) + 15/s x 10 s = 180 orders accepted, whatever was proposed.
    assert!(s.accepted <= 180, "accepted {}", s.accepted);
    assert!(s.proposed > 50_000);
}

#[test]
fn external_agents_act_through_the_same_path() {
    let agents = vec![
        AgentSpec {
            profile: "me".into(),
            faction: FactionId::Frost,
            bot: false,
            agent: Agent::External,
        },
        AgentSpec {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Idle),
            },
        },
    ];
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig::default(),
            max_ticks: 400,
            record: false,
        },
        agents,
        2,
    );
    let obs = env.observations();
    let me = obs[0].me.clone().unwrap();
    let out = env.step(&[vec![
        RawCommand::Move {
            x: me.x + 200.0,
            y: me.y,
            seq: Some(5),
        },
        RawCommand::Aim { a: f64::NAN },
    ]]);
    assert_eq!(out.observations[0].me.as_ref().unwrap().move_seq, 5);
    let after = env.step(&[vec![]]).observations[0].me.clone().unwrap();
    assert!(after.x > me.x, "walked");
}
