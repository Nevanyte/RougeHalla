//! The line-of-sight memo is exact: through a persistent `SightCache`, `observe_into` and `observe_events_into` give
//! byte-for-byte what the uncached functions give, on real bot matches (both maps), across restores (a restored sim has a new
//! arena `Arc`), and in a roster larger than the table (collisions only cost hits).

use rh_headless::*;
use rh_policy::scripted::Brawler;
use rh_sim::arenas::{practice_arena, MapFile};
use rh_sim::{
    observe_events_into, observe_events_into_cached, observe_into, observe_into_cached, Arena,
    FactionId, Observation, Placement, PlayerId, Secrets, SightCache, Sim, SimConfig, Vec2,
};

fn seed1() -> Arena {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/maps/seed1.map.json"
    );
    let file: MapFile = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    file.into_arena().unwrap()
}

/// Every viewer (and one id that is not in the match) through `cache` equals the uncached call.
fn check_tick(sim: &Sim, events: &[rh_sim::Event], cache: &mut SightCache, what: &str) {
    let mut ids: Vec<PlayerId> = sim.players().iter().map(|p| p.id).collect();
    ids.push(PlayerId(9999));
    let (mut want, mut got) = (Observation::default(), Observation::default());
    for id in ids {
        observe_into(sim, id, events, &mut want);
        observe_into_cached(sim, id, events, &mut got, cache);
        assert_eq!(want, got, "{what}: observe_into viewer {id:?}");
        let (mut we, mut ge) = (Vec::new(), Vec::new());
        observe_events_into(sim, id, events, &mut we);
        observe_events_into_cached(sim, id, events, &mut ge, cache);
        assert_eq!(we, ge, "{what}: observe_events_into viewer {id:?}");
    }
}

#[test]
fn cached_observations_equal_uncached_on_bot_matches_and_across_restores() {
    let (mut hits, mut misses) = (0, 0);
    for (name, arena) in [("practice", practice_arena()), ("seed1", seed1())] {
        for (seed, n) in [(1u64, 8usize), (2, 2), (3, 5), (11, 8)] {
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
                    max_ticks: 900,
                    record: false,
                },
                agents,
                seed,
            );
            // One cache for the whole match; a second one that sees only restored copies of the sim.
            let mut cache = SightCache::new();
            let mut restored_cache = SightCache::new();
            loop {
                let p = env.advance(&[]);
                let what = format!("{name} seed {seed} tick {}", env.sim.tick());
                check_tick(&env.sim, env.last_events(), &mut cache, &what);
                if env.sim.tick() % 5 == 0 {
                    let text = serde_json::to_string(&env.sim).unwrap();
                    let back =
                        Sim::restore(&mut serde_json::Deserializer::from_str(&text)).unwrap();
                    check_tick(&back, env.last_events(), &mut restored_cache, &what);
                    // The restored copy against the live cache too: a different Arc, the same map.
                    check_tick(&back, env.last_events(), &mut cache, &what);
                }
                if p.terminated || p.truncated {
                    break;
                }
            }
            let s = cache.stats();
            hits += s.hits;
            misses += s.misses;
        }
    }
    assert!(
        hits > 0 && misses > 0,
        "both paths were exercised: {hits} hits, {misses} misses"
    );
}

#[test]
fn a_cache_never_carries_a_verdict_to_another_map() {
    // The same players at the same coordinates on two maps: the cache must answer for the map it is asked about.
    let mk = |arena: Arena| {
        let ps: Vec<Placement> = (0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: FactionId::ALL[i],
                bot: false,
                at: Vec2::new(150.0 + 60.0 * i as f64, 176.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        Sim::reset_active(
            SimConfig::default(),
            arena,
            Secrets {
                order_salt: 1,
                spawn_seed: 1,
                reward_salt: [11, 22, 33, 44],
            },
            &ps,
        )
    };
    let (a, b) = (mk(practice_arena()), mk(seed1()));
    let mut cache = SightCache::new();
    for round in 0..3 {
        for sim in [&a, &b, &a] {
            check_tick(sim, &[], &mut cache, &format!("round {round}"));
        }
    }
}

#[test]
fn a_roster_larger_than_the_table_stays_exact() {
    // 160 players: 4 x 160^2 exceeds the table cap, so pairs collide and evict each other.
    let arena = practice_arena();
    let c = arena.centre();
    let ps: Vec<Placement> = (0..160)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::ALL[i % 5],
            bot: true,
            at: Vec2::new(
                c.x - 150.0 + (i % 16) as f64 * 20.0,
                c.y - 100.0 + (i / 16) as f64 * 20.0,
            ),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets {
            order_salt: 3,
            spawn_seed: 3,
            reward_salt: [11, 22, 33, 44],
        },
        &ps,
    );
    let mut cache = SightCache::new();
    for t in 0..4 {
        let ev = sim.step();
        check_tick(&sim, &ev, &mut cache, &format!("tick {t}"));
    }
}
