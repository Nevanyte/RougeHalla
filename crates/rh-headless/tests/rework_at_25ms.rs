//! P-SYNC-ORIGIN-2 decision 6: the augment and elite rework at the 40 Hz step. A live-content world
//! (`SimConfig::live_content()`, Rework cards and elites) at `tick_ms` 25 with the live fill bots, native and retuned
//! cards granted through the trusted build setup (P-SIM-BENCH-SEAM-1), checkpointed every 200 steps: every checkpoint
//! restores and the restored world hashes as the original. Before this packet the rework's own restore rules (the Wish
//! restore lattice above all) assumed the legacy 50 ms step, so a 25 ms world with Wish casts refused its own
//! checkpoints.
//!
//! A release smoke (minutes in debug): `cargo test --release -p rh-headless --test rework_at_25ms`.
use rh_headless::{AgentSpec, BotKind, Env, EnvConfig};
use rh_sim::cards::CardId;
use rh_sim::trusted_build::{self, BuildRefusal, TrustedBuild};
use rh_sim::{AugmentRule, EliteRule, FactionId, PlayerId, Sim, SimConfig};

/// At least 60 s at 25 ms (the brief's 2400 steps); the match runs on until it ends or 120 s, so the Wish lock (45 s after
/// the raid starts) is open for a good while.
const MIN_STEPS: u32 = 2400;
const MAX_STEPS: u32 = 4800;
const CHECKPOINT_EVERY: u32 = 200;
const SEATS: usize = 8;

/// The rework's retuned legacy cards (`cards/rework_overrides.rs`).
const RETUNED: [CardId; 19] = [
    CardId::HereComesTheBoom,
    CardId::MachineGun,
    CardId::GlassCannon,
    CardId::VampiricPact,
    CardId::ArcaneOverload,
    CardId::Committed,
    CardId::SlowBurn,
    CardId::FistsOfFury,
    CardId::Overkill,
    CardId::TankEngine,
    CardId::PocketSand,
    CardId::Gambler,
    CardId::ThirdTimesTheCharm,
    CardId::PlantYourFeet,
    CardId::WishfulThinking,
    CardId::Hemorrhage,
    CardId::SpikedShell,
    CardId::Siphon,
    CardId::SecondWind,
];

/// The cards seat `i` is granted, one request each: two native cards (seats 0 to 6 cover all fourteen), three retuned
/// ones, and the Wish cards whose clocks the restore lattice judges: Wish Engine for every seat, with Wishful Thinking
/// (even seats) or Arcane Overload (odd seats). A card the seat already holds is refused as held and skipped.
fn grants(i: usize) -> Vec<CardId> {
    let n = CardId::NATIVE.len();
    vec![
        CardId::NATIVE[(2 * i) % n],
        CardId::NATIVE[(2 * i + 1) % n],
        RETUNED[(3 * i) % RETUNED.len()],
        RETUNED[(3 * i + 1) % RETUNED.len()],
        RETUNED[(3 * i + 2) % RETUNED.len()],
        CardId::WishEngine,
        if i % 2 == 0 {
            CardId::WishfulThinking
        } else {
            CardId::ArcaneOverload
        },
    ]
}

fn arena() -> rh_sim::Arena {
    rh_headless::load_arena(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rh-sim/src/mapdata/fixtures/seed1.map.json"
    ))
    .expect("admitted seed1 map")
}

/// Checkpoints `sim` as the server does (JSON), restores it and compares the state hash.
fn round_trip(sim: &Sim, what: &str) {
    let text = serde_json::to_string(sim).expect("a checkpoint serializes");
    let back = Sim::restore(&mut serde_json::Deserializer::from_str(&text))
        .unwrap_or_else(|e| panic!("{what}: a real checkpoint was refused: {e}"));
    assert_eq!(back.state_hash(), sim.state_hash(), "{what}: restored hash");
}

/// What one run did.
#[derive(Debug, Default)]
struct Run {
    granted: usize,
    natives_granted: usize,
    steps: u32,
    checkpoints: usize,
    faults: usize,
    /// Wish casts that landed (the restore lattice judges their clocks).
    wishes: usize,
    /// Of those, casts that landed on a 25 ms step off the legacy 50 ms grid.
    odd_step_wishes: usize,
}

fn run(seed: u64) -> Run {
    let arena = arena();
    let sim = SimConfig {
        min_players: 1,
        lobby_seconds: 5.,
        fill_seconds: 3.,
        tick_ms: 25,
        ..SimConfig::live_content()
    };
    assert_eq!(
        (sim.augments, sim.elites),
        (AugmentRule::Rework, EliteRule::Rework)
    );
    let agents = (0..SEATS)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: rh_headless::Agent::Policy {
                policy: BotKind::Human.policy(&arena, &sim, SEATS, seed, i),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena,
            sim,
            max_ticks: MAX_STEPS + 100,
            record: false,
        },
        agents,
        seed,
    );
    assert_eq!(env.sim.tick_ms(), 25);
    let ids: Vec<PlayerId> = env.sim.players().iter().map(|p| p.id).collect();
    assert_eq!(ids.len(), SEATS);
    // Per seat: the cards still to grant (granted once the seat stands in the match).
    let mut pending: Vec<Vec<CardId>> = (0..SEATS).map(grants).collect();
    let mut out = Run::default();
    for step in 1..=MAX_STEPS {
        for (i, &id) in ids.iter().enumerate() {
            if pending[i].is_empty() || env.sim.phase() != rh_sim::Phase::Active {
                continue;
            }
            let mut left = Vec::new();
            for card in pending[i].drain(..) {
                let build = TrustedBuild {
                    cards: vec![(card, 1)],
                    ..Default::default()
                };
                match trusted_build::apply(&mut env.sim, id, &build) {
                    Ok(()) => {
                        out.granted += 1;
                        out.natives_granted += usize::from(CardId::NATIVE.contains(&card));
                    }
                    // Not standing yet (or down): try again next step.
                    Err(BuildRefusal::NotStanding(_)) => left.push(card),
                    // A conditional retuned card without its base: this seat simply goes without it.
                    Err(BuildRefusal::NeedsBase(_) | BuildRefusal::UniqueHeld(_)) => {}
                    Err(e) => panic!("seed {seed}: {card:?} for {id:?} refused: {e:?}"),
                }
            }
            pending[i] = left;
        }
        let progress = env.advance(&[]);
        let mut wish_step = false;
        for e in env.last_events() {
            let (rh_sim::Event::CastStarted { id, ability, .. }
            | rh_sim::Event::CastLanded { id, ability, .. }) = e
            else {
                continue;
            };
            let Some(p) = env.sim.player(*id) else {
                continue;
            };
            if p.faction_id()
                .is_some_and(|f| rh_sim::abilities::wish(f) == *ability)
            {
                wish_step = true;
                if matches!(e, rh_sim::Event::CastLanded { .. }) {
                    out.wishes += 1;
                    out.odd_step_wishes += usize::from(env.sim.server_time() % 50. != 0.);
                }
            }
        }
        out.steps = step;
        let ended = progress.terminated || progress.truncated;
        // Every 200 steps, on every step a Wish was cast or landed (its clocks are new), and the ended world once more.
        if step % CHECKPOINT_EVERY == 0 || wish_step || ended {
            round_trip(&env.sim, &format!("seed {seed} step {step}"));
            out.checkpoints += 1;
        }
        if ended {
            break;
        }
    }
    out.faults = env.seat_stats().iter().filter(|s| s.2.is_some()).count();
    out
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "release smoke: cargo test --release -p rh-headless --test rework_at_25ms"
)]
fn a_rework_world_at_25_ms_restores_every_checkpoint() {
    // Eight seeds: Wish casts are rare in a 60 to 120 s match (the lock opens 45 s into the raid), so the seeds together
    // carry the Wish restore lattice; a Wish lattice left at the legacy 50 ms refuses seed 4's checkpoint at step 2613
    // (measured on this branch).
    let (mut wishes, mut odd) = (0, 0);
    for seed in 1u64..=8 {
        let r = run(seed);
        wishes += r.wishes;
        odd += r.odd_step_wishes;
        eprintln!("seed {seed}: {r:?}");
        assert!(
            r.steps >= MIN_STEPS,
            "seed {seed}: the match ran {} steps, fewer than {MIN_STEPS} ({r:?})",
            r.steps
        );
        assert!(
            r.checkpoints >= (r.steps / CHECKPOINT_EVERY) as usize,
            "seed {seed}: a checkpoint every {CHECKPOINT_EVERY} steps ({r:?})"
        );
        assert!(
            r.natives_granted >= 10,
            "seed {seed}: native cards granted ({r:?})"
        );
        assert!(r.granted >= 20, "seed {seed}: cards granted ({r:?})");
        assert_eq!(r.faults, 0, "seed {seed}: no seat faulted ({r:?})");
    }
    assert!(
        wishes >= 5 && odd >= 1,
        "Wish casts landed and were checkpointed: {wishes}, {odd} off the 50 ms grid"
    );
}
