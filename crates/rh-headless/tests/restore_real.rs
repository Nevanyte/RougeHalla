//! No false refusals: checkpoints of real matches (bots, random validated inputs, lobby joins and leaves) restore at many
//! steps, hash identically and keep stepping like the original. `Sim::restore` refuses broken states; it must never refuse
//! one the sim itself produces.

use rh_headless::*;
use rh_policy::scripted::Brawler;
use rh_sim::arenas::practice_arena;
use rh_sim::rng::Mulberry32;
use rh_sim::{validate, Event, FactionId, PlayerId, RawCommand, Sim, SimConfig};

fn round_trip(sim: &Sim, what: &str) -> Sim {
    let text = serde_json::to_string(sim).unwrap();
    let back = Sim::restore(&mut serde_json::Deserializer::from_str(&text))
        .unwrap_or_else(|e| panic!("{what}: a real checkpoint was refused: {e}"));
    assert_eq!(sim.state_hash(), back.state_hash(), "{what}");
    back
}

#[test]
fn bot_matches_restore_at_every_few_steps() {
    let arena = practice_arena();
    let (mut checked, mut resolved_seen) = (0, 0);
    for (seed, n) in [(1u64, 8usize), (2, 3), (3, 6), (7, 2), (11, 8)] {
        let agents = (0..n)
            .map(|i| AgentSpec {
                profile: format!("b{i}"),
                faction: FactionId::ALL[(i + seed as usize) % 5],
                bot: true,
                agent: Agent::Policy {
                    policy: Box::new(Brawler::new(2 + (i as u32 % 3))),
                },
            })
            .collect();
        let mut env = Env::new(
            EnvConfig {
                arena: arena.clone(),
                sim: SimConfig::default(),
                max_ticks: 6000,
                record: false,
            },
            agents,
            seed,
        );
        loop {
            let out = env.advance(&[]);
            resolved_seen += env
                .last_events()
                .iter()
                .filter(|e| matches!(e, Event::Resolved { .. }))
                .count();
            if env.sim.tick() % 5 == 0 {
                let mut back =
                    round_trip(&env.sim, &format!("seed {seed} tick {}", env.sim.tick()));
                // And the restored copy steps on identically.
                let mut orig = env.sim.clone();
                for _ in 0..3 {
                    orig.step();
                    back.step();
                }
                assert_eq!(orig.state_hash(), back.state_hash());
                checked += 1;
            }
            if out.terminated || out.truncated {
                break;
            }
        }
        round_trip(&env.sim, "final");
    }
    assert!(
        checked > 300 && resolved_seen > 10,
        "{checked} {resolved_seen}"
    );
}

#[test]
fn lobby_joins_leaves_and_random_inputs_restore() {
    let mut rng = Mulberry32::new(0xFEED);
    let mut checked = 0;
    for round in 0..6u32 {
        let mut sim = Sim::new(
            SimConfig::default(),
            practice_arena(),
            rh_sim::Secrets::from_seed(round as u64 + 40),
        );
        round_trip(&sim, "empty lobby");
        let mut ids: Vec<PlayerId> = Vec::new();
        for step in 0..2500u32 {
            // Lobby traffic while there is a lobby; random validated inputs always.
            match rng.next_u32() % 40 {
                0 | 1 => {
                    if let Some(id) = sim.add_player(&format!("p{step}"), None, step % 3 == 0) {
                        ids.push(id);
                    }
                }
                2 if !ids.is_empty() => {
                    let id = ids.remove(rng.next_u32() as usize % ids.len());
                    sim.remove_player(id);
                }
                _ => {}
            }
            for &id in &ids {
                let r = rng.next_u32();
                let f = |m: u32| (r % m) as f64;
                let raw = match r % 9 {
                    0 => RawCommand::Move {
                        x: 100.0 + f(2000),
                        y: 100.0 + f(2000),
                        seq: Some((r % 255) as u8),
                    },
                    1 => RawCommand::Stop { seq: None },
                    2 | 3 => RawCommand::Aim { a: f(628) / 100.0 },
                    4 | 5 => RawCommand::Attack {
                        a: f(628) / 100.0,
                        t: None,
                    },
                    6 => RawCommand::Release {
                        a: f(628) / 100.0,
                        t: None,
                    },
                    _ => continue,
                };
                let _ = sim.submit(id, validate(raw).unwrap());
            }
            sim.step();
            if step % 7 == 0 {
                round_trip(&sim, &format!("round {round} step {step}"));
                checked += 1;
            }
        }
    }
    assert!(checked > 1000);
}
