//! P-BOT-BRAIN-LIVE-1 acceptance: eight ported-Brain seats (BrainBot, the degraded fair profile) play the live
//! `--runtime source-arena` configuration on the admitted full map, through the ordinary seat path (accepted Frame14 in,
//! validate + Sim::submit out), for two seeds: no seat faults, every seat proposes and has commands accepted, a kill
//! resolves, two runs end on the same state hash, and the recorded replay verifies. Per-seat decision CPU against
//! P-BOTS-1's legacy target (8 bots: mean < 1.5 ms, p99 < 6 ms) is measured by the ignored `profile_brain_seats`
//! diagnostic in rh-policy (`compose14/tests.rs`) and recorded in the hand-off, not gated.
//!
//! P-BOT-BRAIN-CONTINUITY-1 adds the passivity floors: the same seeds are played by eight HumanBot seats (the live fill
//! bot) and the Brain seats must reach a stated fraction of that baseline (see [`floors`]). Measured before the packet
//! (2026-11-12, seeds 3 and 11, 6,000 ticks; the window is now 16,000 ticks, see [`MAX_TICKS`]): Brain 4 resolved deaths, 16 mob kills, 1,773 proposals, the quietest seat
//! 7; HumanBot 13 deaths, 52 mob kills, 2,175 proposals (136 a seat), the quietest seat 23 (seed 3 ends at tick 3,209).
//!
//! The matches take about a minute on four cores in release and over ten in debug, so a debug build skips them (the
//! debug suites keep the shorter Brain seat tests in rh-policy: `compose14/tests.rs`, `brain_bot/tests.rs`):
//!   cargo test --release -p rh-headless --test brain_bots -- --nocapture
use rh_headless::{BotKind, Env, EnvConfig};
use rh_sim::archetype::HitboxMode;
use rh_sim::replay::run_replay;
use rh_sim::{abilities, mob_runtime::MobMode, terrain, ArenaMode, Event, FactionMode, SimConfig};

/// Long enough to reach the coliseum: on this configuration the raid's patience ends 600 s after the raid starts (about
/// tick 12,300), and the legacy Brain farms through the raid and fights in the coliseum, where HumanBot hunts players
/// from the start. Measured 2026-11-12 (P-BOT-BRAIN-CONTINUITY-1, with the tracker): Brain seats resolve 2 player deaths
/// by tick 6,000 and 11 by tick 16,000 over seeds 3 and 11; HumanBot's matches end with a winner at ticks 3,209 and
/// 6,961 (13 deaths).
const MAX_TICKS: u32 = 16_000;

/// The recorded runs whose replays are verified. A 16,000-tick recorded seed-3 run diverges on replay at step 11,004
/// (an rh-sim or recorder fault, not bot code: `the_replay_of_a_long_brain_match_verifies` below, ignored until
/// P-SIM-REPLAY-LONG-1 lands), so the replay check keeps the 6,000-tick window it had before this packet.
const REPLAY_TICKS: u32 = 6000;

/// What "plays" means against the HumanBot baseline on the same seeds, summed over both seeds: (resolved deaths, mob
/// kills credited to a seat, the quietest Brain seat's proposals against the mean HumanBot seat's), each a fraction.
fn floors() -> (f64, f64, f64) {
    (0.5, 0.5, 0.25)
}

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
    /// Regional mobs, elites and zombies whose death the sim credits to a player seat.
    mob_kills: u32,
    first_death: Option<u32>,
    stats: Vec<(
        rh_sim::PlayerId,
        rh_policy::SeatStats,
        Option<rh_policy::Fault>,
    )>,
    replay: Option<rh_sim::replay::Replay>,
}

fn run(kind: BotKind, seed: u64, max_ticks: u32, record: bool) -> Run {
    let arena = arena();
    let sim = live_config();
    let agents = (0..8)
        .map(|i| rh_headless::AgentSpec {
            profile: format!("bot{i}"),
            faction: rh_sim::FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: rh_headless::Agent::Policy {
                policy: kind.policy(&arena, &sim, 8, seed, i),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks,
            record,
        },
        agents,
        seed,
    );
    let (mut deaths, mut ticks, mut first_death, mut mob_kills) = (0, 0, None, 0);
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
        mob_kills += env
            .last_events()
            .iter()
            .filter(|e| {
                matches!(e, Event::Death { id, by: Some(by), .. }
                    if env.sim.player(*id).is_none() && env.sim.player(*by).is_some())
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
        mob_kills,
        first_death,
        stats: env.seat_stats(),
        replay: env.into_replay(),
    }
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "four 16,000-tick 8-Brain matches: run with `cargo test --release -p rh-headless --test brain_bots`"
)]
fn eight_brain_seats_play_the_source_arena_deterministically() {
    // The six runs (two seeds, the Brain twice each, HumanBot once each) are independent matches: play them side by side.
    let all: Vec<(BotKind, u64, Run)> = std::thread::scope(|scope| {
        let handles: Vec<_> = [
            (BotKind::Brain, 3u64),
            (BotKind::Brain, 3),
            (BotKind::Brain, 11),
            (BotKind::Brain, 11),
            (BotKind::Human, 3),
            (BotKind::Human, 11),
        ]
        .into_iter()
        .map(|(kind, seed)| scope.spawn(move || (kind, seed, run(kind, seed, MAX_TICKS, false))))
        .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("run"))
            .collect()
    });
    let mut runs: Vec<(u64, Run)> = Vec::new();
    let mut baseline: Vec<(u64, Run)> = Vec::new();
    for (kind, seed, run) in all {
        if kind == BotKind::Brain {
            runs.push((seed, run));
        } else {
            baseline.push((seed, run));
        }
    }
    let mut checks = Vec::new();
    for pair in runs.chunks(2) {
        let [(seed, a), (_, b)] = pair else {
            unreachable!("two runs per seed")
        };
        let seed = *seed;
        eprintln!(
            "seed {seed}: {} ticks, {} resolved deaths (first at tick {:?}), {} mob kills, hash {:016x}",
            a.ticks, a.deaths, a.first_death, a.mob_kills, a.hash
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
        checks.push(seed);
    }

    // The passivity floors (P-BOT-BRAIN-CONTINUITY-1) against HumanBot on the same seeds.
    let brain: Vec<&Run> = runs.iter().step_by(2).map(|(_, r)| r).collect();
    let human: Vec<&Run> = baseline.iter().map(|(_, r)| r).collect();
    for (seed, h) in &baseline {
        eprintln!(
            "HumanBot seed {seed}: {} ticks, {} resolved deaths, {} mob kills, proposals {:?}",
            h.ticks,
            h.deaths,
            h.mob_kills,
            h.stats.iter().map(|s| s.1.proposed).collect::<Vec<_>>()
        );
    }
    let sum = |rs: &[&Run], f: &dyn Fn(&Run) -> u64| rs.iter().map(|r| f(r)).sum::<u64>() as f64;
    let (death_floor, kill_floor, seat_floor) = floors();
    let (bd, hd) = (
        sum(&brain, &|r| r.deaths.into()),
        sum(&human, &|r| r.deaths.into()),
    );
    let (bk, hk) = (
        sum(&brain, &|r| r.mob_kills.into()),
        sum(&human, &|r| r.mob_kills.into()),
    );
    let human_seats = human.iter().map(|r| r.stats.len()).sum::<usize>() as f64;
    let human_seat_mean = sum(&human, &|r| {
        r.stats.iter().map(|s| s.1.proposed).sum::<u64>()
    }) / human_seats;
    let quietest = brain
        .iter()
        .flat_map(|r| r.stats.iter().map(|s| s.1.proposed))
        .min()
        .expect("seats") as f64;
    eprintln!(
        "floors: deaths {bd} vs {hd}, mob kills {bk} vs {hk}, quietest Brain seat {quietest} vs HumanBot seat mean {human_seat_mean:.1}"
    );
    assert!(
        bd >= death_floor * hd,
        "Brain seats fight: {bd} resolved deaths, floor {death_floor} x {hd}"
    );
    assert!(
        bk >= kill_floor * hk,
        "Brain seats farm: {bk} mob kills, floor {kill_floor} x {hk}"
    );
    assert!(
        quietest >= seat_floor * human_seat_mean,
        "every Brain seat plays: the quietest proposed {quietest}, floor {seat_floor} x {human_seat_mean:.1}"
    );
    // Determinism through the recorder: a recorded run per seed (REPLAY_TICKS) replays step for step to its own hash.
    std::thread::scope(|scope| {
        for seed in checks {
            scope.spawn(move || {
                let recorded = run(BotKind::Brain, seed, REPLAY_TICKS, true);
                let hash = recorded.hash;
                let replay = recorded.replay.as_ref().expect("recorded");
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

/// P-SIM-REPLAY-LONG-1 repro (found by P-BOT-BRAIN-CONTINUITY-1, 2026-11-12): eight Brain seats on seed 3, recorded for
/// 11,100 ticks; two live runs agree on their hash, but the replay of the recording diverges at step 11,004 (expected
/// 16912772434412788001, got 4946499403885021848). Seed 11 replays clean over the same window. Bot commands are recorded
/// as inputs, so the fault is in what the sim or the recorder does not reproduce.
#[test]
#[ignore = "known replay divergence at step 11,004 (P-SIM-REPLAY-LONG-1): run with --release --ignored"]
fn the_replay_of_a_long_brain_match_verifies() {
    let recorded = run(BotKind::Brain, 3, 11_100, true);
    let (replayed, _) = run_replay(recorded.replay.as_ref().expect("recorded"))
        .expect("the replay verifies every step");
    assert_eq!(replayed.state_hash(), recorded.hash);
}
