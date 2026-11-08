//! A seeded headless match with passive regeneration on: every checkpoint restores into an identical continuation, the
//! recorded match replays to the same final hash, and the regeneration share really ran (a quiet hp rise with no heal event
//! for that player).
use rh_headless::*;
use rh_policy::scripted::Brawler;
use rh_sim::arenas::practice_arena;
use rh_sim::{replay::run_replay, Event, FactionId, PlayerId, Sim, SimConfig};
use std::collections::BTreeSet;

fn round_trip(sim: &Sim, what: &str) -> Sim {
    let text = serde_json::to_string(sim).unwrap();
    let back = Sim::restore(&mut serde_json::Deserializer::from_str(&text))
        .unwrap_or_else(|e| panic!("{what}: a real checkpoint was refused: {e}"));
    assert_eq!(sim.state_hash(), back.state_hash(), "{what}");
    back
}

#[test]
fn a_seeded_regen_match_restores_and_replays_exactly_and_the_share_ran() {
    let agents = (0..6)
        .map(|i| AgentSpec {
            profile: format!("r{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(Brawler::new(2 + (i as u32 % 3))),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena: practice_arena(),
            sim: SimConfig {
                regen: true,
                faction_mode: rh_sim::FactionMode::EngagementHoly,
                ..Default::default()
            },
            max_ticks: 1200,
            record: true,
        },
        agents,
        21,
    );
    let mut restored = 0;
    let mut quiet_steps = 0;
    let mut before: Vec<(PlayerId, f64)> = Vec::new();
    loop {
        env.advance(&[]);
        let healed: BTreeSet<PlayerId> = env
            .last_events()
            .iter()
            .filter_map(|e| match e {
                Event::Heal { id, .. } => Some(*id),
                _ => None,
            })
            .collect();
        for p in env.sim.players() {
            if let Some((_, prev)) = before.iter().find(|(id, _)| *id == p.id) {
                if p.vitals.hp > *prev && !healed.contains(&p.id) {
                    quiet_steps += 1;
                }
            }
        }
        before = env
            .sim
            .players()
            .iter()
            .map(|p| (p.id, p.vitals.hp))
            .collect();
        if env.sim.phase() == rh_sim::Phase::Ended {
            break;
        }
        if env.sim.tick() % 7 == 0 {
            round_trip(&env.sim, &format!("tick {}", env.sim.tick()));
            restored += 1;
        }
        if env.sim.tick() >= 1200 {
            break;
        }
    }
    assert!(restored > 50, "only {restored} checkpoint restores");
    assert!(
        quiet_steps > 20,
        "only {quiet_steps} quiet hp rises: regeneration did not run"
    );
    let hash = env.sim.state_hash();
    let replay = env.into_replay().unwrap();
    let (sim, _) = run_replay(&replay).unwrap();
    assert_eq!(sim.state_hash(), hash);
}
