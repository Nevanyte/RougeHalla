//! P-BOT-BRAIN-LIVE-1 acceptance: eight ported-Brain seats (BrainBot, the degraded fair profile) play the live
//! `--runtime source-arena` configuration on the admitted full map, through the ordinary seat path (accepted Frame14 in,
//! validate + Sim::submit out), for two seeds: no seat faults, every seat proposes and has commands accepted, a kill
//! resolves, two runs end on the same state hash, and the recorded replay verifies. Per-seat decision CPU against
//! P-BOTS-1's legacy target (8 bots: mean < 1.5 ms, p99 < 6 ms) is measured by the ignored `profile_brain_seats`
//! diagnostic in rh-policy (`compose14/tests.rs`) and recorded in the hand-off, not gated.
//!
//! The matches take about a minute on four cores in release and over ten in debug, so a debug build skips them (the
//! debug suites keep the shorter Brain seat tests in rh-policy: `compose14/tests.rs`, `brain_bot/tests.rs`):
//!   cargo test --release -p rh-headless --test brain_bots -- --nocapture
use rh_headless::{BotKind, Env, EnvConfig};
use rh_sim::archetype::HitboxMode;
use rh_sim::replay::run_replay;
use rh_sim::{abilities, mob_runtime::MobMode, terrain, ArenaMode, Event, FactionMode, SimConfig};

const MAX_TICKS: u32 = 6000;

fn live_config() -> SimConfig {
    SimConfig {
        walk_hints: Some(true),
        regen: true,
        quests: true,
        hazards: terrain::Mode::All,
        abilities: abilities::Mode::Full,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentencedFireRoam,
        lifecycle: ArenaMode::Source(Default::default()),
        mob_mode: MobMode::Pve,
        initial_loot: true,
        consumables: true,
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        hitboxes: HitboxMode::LegacyCircle,
        ..SimConfig::default()
    }
}

fn arena() -> rh_sim::Arena {
    rh_headless::load_arena(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("admitted seed1 map")
}

struct Run {
    hash: u64,
    ticks: u32,
    deaths: u32,
    first_death: Option<u32>,
    stats: Vec<(
        rh_sim::PlayerId,
        rh_policy::SeatStats,
        Option<rh_policy::Fault>,
    )>,
    replay: Option<rh_sim::replay::Replay>,
}

fn run(seed: u64) -> Run {
    let arena = arena();
    let sim = live_config();
    let agents = (0..8)
        .map(|i| rh_headless::AgentSpec {
            profile: format!("bot{i}"),
            faction: rh_sim::FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: rh_headless::Agent::Policy {
                policy: BotKind::Brain.policy(&arena, &sim, 8, seed, i),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: MAX_TICKS,
            record: true,
        },
        agents,
        seed,
    );
    let (mut deaths, mut ticks, mut first_death) = (0, 0, None);
    loop {
        let out = env.advance(&[]);
        ticks += 1;
        deaths += env
            .last_events()
            .iter()
            .filter(|e| {
                matches!(e, Event::Resolved { result, .. } if result.outcome == rh_sim::Outcome::Died)
            })
            .count() as u32;
        if deaths > 0 && first_death.is_none() {
            first_death = Some(ticks);
        }
        if out.terminated || out.truncated {
            break;
        }
    }
    Run {
        hash: env.sim.state_hash(),
        ticks,
        deaths,
        first_death,
        stats: env.seat_stats(),
        replay: env.into_replay(),
    }
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "four 6,000-tick 8-Brain matches: run with `cargo test --release -p rh-headless --test brain_bots`"
)]
fn eight_brain_seats_play_the_source_arena_deterministically() {
    // The four runs (two seeds, each twice) are independent matches: play them side by side.
    let runs: Vec<(u64, Run)> = std::thread::scope(|scope| {
        let handles: Vec<_> = [3u64, 3, 11, 11]
            .into_iter()
            .map(|seed| scope.spawn(move || (seed, run(seed))))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("run"))
            .collect()
    });
    let mut checks = Vec::new();
    for pair in runs.chunks(2) {
        let [(seed, a), (_, b)] = pair else {
            unreachable!("two runs per seed")
        };
        let seed = *seed;
        eprintln!(
            "seed {seed}: {} ticks, {} resolved deaths (first at tick {:?}), hash {:016x}",
            a.ticks, a.deaths, a.first_death, a.hash
        );
        for (player, stats, fault) in &a.stats {
            eprintln!("  {player:?}: {stats:?} fault {fault:?}");
            assert_eq!(fault, &None, "seed {seed}: {player:?} faulted");
            assert!(
                stats.proposed > 0,
                "seed {seed}: {player:?} proposed nothing"
            );
            assert!(
                stats.accepted > 0,
                "seed {seed}: {player:?} had nothing accepted"
            );
        }
        assert!(a.deaths > 0, "seed {seed}: no death resolved");
        assert_eq!(a.hash, b.hash, "seed {seed}: two runs, two hashes");
        assert_eq!(a.ticks, b.ticks);
        assert_eq!(
            a.stats, b.stats,
            "seed {seed}: the seats played identically"
        );
        checks.push((seed, a.hash, a.replay.as_ref().expect("recorded")));
    }
    std::thread::scope(|scope| {
        for (seed, hash, replay) in checks {
            scope.spawn(move || {
                let (replayed, _) = run_replay(replay).expect("the replay verifies every step");
                assert_eq!(
                    replayed.state_hash(),
                    hash,
                    "seed {seed}: the replay ends on the run's hash"
                );
            });
        }
    });
}
