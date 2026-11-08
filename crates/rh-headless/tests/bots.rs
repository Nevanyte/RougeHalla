//! P-BOTS-1 native seat proof: eight human-like bots on the deterministic policy seats, playing through the ported
//! human-likeness core, with no client-side rules and no input path but validate + submit.
//!
//! The hand itself is compared against the frozen source corpus in rh-policy (parity/policy/bot-core.json); this file
//! proves the seat integration: a deterministic replay, no policy faults, real proposed/accepted commands, and that a
//! decision is a pure function of the delivered Observation.
use rh_headless::{Agent, AgentSpec, Env, EnvConfig};
use rh_policy::bots::{assign_seats, HumanBot};
use rh_policy::{MatchStart, Policy, SeatStats};
use rh_sim::arenas::practice_arena;
use rh_sim::{observe, FactionId, Phase, Placement, Secrets, Sim, SimConfig, Vec2};

fn seats(seed: u64, max_ticks: u32, record: bool) -> Env {
    let arena = practice_arena();
    let assigned = assign_seats(seed, 8);
    let agents = assigned
        .iter()
        .enumerate()
        .map(|(i, (tier, persona))| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(HumanBot::new(*tier, *persona)),
            },
        })
        .collect();
    Env::new(
        EnvConfig {
            arena,
            sim: SimConfig::default(),
            max_ticks,
            record,
        },
        agents,
        seed,
    )
}

struct Run {
    hashes: Vec<u64>,
    seeds: Vec<u64>,
    stats: Vec<(rh_sim::PlayerId, SeatStats, Option<rh_policy::Fault>)>,
    hits: u64,
    replay: Option<serde_json::Value>,
}

fn run(seed: u64, max_ticks: u32) -> Run {
    let mut env = seats(seed, max_ticks, true);
    let mut hashes = Vec::new();
    let mut seeds = Vec::new();
    let mut hits = 0u64;
    for _ in 0..max_ticks {
        env.advance(&[]);
        hashes.push(env.sim.state_hash());
        seeds.push(env.sim.tick() as u64);
        for e in env.last_events() {
            if matches!(e, rh_sim::Event::Hit { .. }) {
                hits += 1;
            }
        }
        if env.sim.phase() == Phase::Ended {
            break;
        }
    }
    let stats = env.seat_stats();
    let replay = env
        .into_replay()
        .map(|r| serde_json::to_value(r).expect("replay json"));
    Run {
        hashes,
        seeds,
        stats,
        hits,
        replay,
    }
}

#[test]
fn human_bots_play_deterministically_on_the_policy_seats() {
    let a = run(7, 400);
    let b = run(7, 400);
    assert_eq!(a.seeds, b.seeds, "same seed plays the same ticks");
    assert_eq!(a.hashes, b.hashes, "same seed replays exactly");
    assert_eq!(a.replay, b.replay, "the recorded replay is byte-identical");
    assert!(
        a.hits > 0,
        "the human-like bots actually fight: {} hits",
        a.hits
    );
    let mut proposed = 0;
    let mut accepted = 0;
    for (_, s, fault) in &a.stats {
        assert!(fault.is_none(), "no policy fault: {fault:?}");
        proposed += s.proposed;
        accepted += s.accepted;
    }
    assert!(proposed > 0, "the seats propose commands");
    assert!(accepted > 0, "the commands pass validate + submit");
    let c = run(8, 400);
    assert_ne!(
        a.hashes, c.hashes,
        "a different seat seed plays differently"
    );
}

#[test]
fn a_decision_is_a_pure_function_of_the_delivered_observation() {
    let arena = practice_arena();
    let placements: Vec<Placement> = (0..2)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: true,
            at: Vec2::new(400. + 64. * i as f64, 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(3),
        &placements,
    );
    let me = sim.players()[0].id;
    let start = MatchStart::of(&sim, me, 11);
    let mut a = HumanBot::new(
        rh_policy::bots::TierId::Normal,
        rh_policy::bots::PersonaId::Hunter,
    );
    let mut b = HumanBot::new(
        rh_policy::bots::TierId::Normal,
        rh_policy::bots::PersonaId::Hunter,
    );
    a.reset(&start);
    b.reset(&start);
    let mut any = 0usize;
    for _ in 0..200 {
        let events: Vec<rh_sim::Event> = Vec::new();
        let obs = observe(&sim, me, &events);
        let ca = a.decide(&obs);
        let cb = b.decide(&obs);
        assert_eq!(
            ca, cb,
            "identical delivered observations decide identically"
        );
        any += ca.len();
        sim.step();
    }
    assert!(any > 0, "the bot acted from observations alone");
}

#[test]
fn seat_assignment_is_deterministic_and_mixed() {
    let a = assign_seats(42, 8);
    let b = assign_seats(42, 8);
    assert_eq!(a, b, "the same manager seed seats the same bots");
    let c = assign_seats(43, 8);
    assert_ne!(a, c, "a different manager seed mixes the seats differently");
    // 8 seats at 30/45/25 should include at least two tiers in practice (the exact draw is pinned by the same seed).
    let mut tiers = std::collections::BTreeSet::new();
    for (tier, _) in &a {
        tiers.insert(*tier);
    }
    assert!(tiers.len() >= 2, "the tier mix is not degenerate: {a:?}");
}
