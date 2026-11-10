//! Native replay of the frozen direct Hand supplement (`handSupplement`, 6 profiles / 12 operations), P-BOT-BRAIN-NATIVE-1.
//!
//! This is the separately declared real-Hand + real-Memory overlap witness from `tools/bot-private-brain-fixtures/hand.mts`
//! (`createHumanizer` direct, no createBrain composition). Inputs are the declared percepts/intents from
//! `parity/policy/bot-private-brain/source.json`; expected rows are compared, never installed as state. The hand's
//! source verdicts are the exported stats, misses, Memory snapshot, released commands and the two wrapper RNG transcripts.
//!
//! The Root-granted test-only draw observer at `Rng::next_f64` records the actual motor/lapse draws at their real draw
//! sites, so both transcripts are compared as exact ordered sequences (global sequence/interleaving included, no lane
//! regrouping or sorting). Observed runs are proven elsewhere (`bots::random::draw_trace_tests`) to have identical
//! outputs/final RNG states/draw counts to unobserved runs.

use super::super::memory::{Memory, MemoryCommand, MemoryConfig, MemoryTimedCommand};
use super::adapters;
use super::source_input::{self, HandSeeds};
use super::trace::{self, BVal};
use crate::bots::clicks::BotMap;
use crate::bots::humanizer::{Humanizer, HumanizerStats};
use crate::bots::random::{self, Rng};
use crate::bots::types::{ClickMiss, Command, TierId, TierParams, TimedCommand, COMMAND_TYPES};
use crate::bots::view::Features;
use std::sync::{Arc, Mutex};

fn hard_tier() -> &'static TierParams {
    TierParams::by_id(TierId::Hard)
}

/// Source builders `features()` defaults (all flags true, wire message set), as used by hand.mts for Memory.
fn source_features() -> Features {
    Features {
        message_types: [
            "move",
            "stop",
            "target",
            "attack",
            "release",
            "swap",
            "pickup",
            "cast",
            "plan",
            "choose",
            "useConsumable",
        ]
        .iter()
        .map(|kind| (*kind).to_string())
        .collect(),
        wishes: true,
        status_effects: true,
        fields: true,
        planning: true,
        chests: true,
        skills: false,
        relics: false,
        camps: true,
        hazards: true,
    }
}

fn absent_profile_memory_features() -> Features {
    // Source hand.mts: `f = features({messageTypes: []})` for the absent profile (all other feature flags default).
    let mut features = source_features();
    features.message_types.clear();
    features
}

fn map_fixture() -> source_input::MapFixture {
    source_input::load()
        .expect("frozen rh-bot-private-brain source")
        .map("open")
        .expect("declared open map fixture")
        .clone()
}

fn encode_stats(stats: &HumanizerStats) -> BVal {
    let commands = BVal::Obj(
        COMMAND_TYPES
            .iter()
            .map(|command| {
                (
                    command.as_str().to_string(),
                    BVal::Num(stats.command(*command) as f64),
                )
            })
            .collect(),
    );
    let reactions = BVal::Obj(
        stats
            .reactions
            .iter()
            .map(|(kind, values)| {
                (
                    kind.as_str().to_string(),
                    BVal::Arr(values.iter().map(|value| BVal::Num(*value)).collect()),
                )
            })
            .collect(),
    );
    BVal::obj([
        ("commands", commands),
        ("reactions", reactions),
        ("targetClicks", BVal::Num(stats.target_clicks as f64)),
        ("clickMissed", BVal::Num(stats.click_missed as f64)),
        ("clickWrong", BVal::Num(stats.click_wrong as f64)),
        ("hesitations", BVal::Num(stats.hesitations as f64)),
        ("lapses", BVal::Num(stats.lapses as f64)),
        ("throttled", BVal::Num(stats.throttled as f64)),
        ("superseded", BVal::Num(stats.superseded as f64)),
        ("apmPeak", BVal::Num(stats.apm_peak as f64)),
    ])
}

fn encode_misses(misses: &[ClickMiss]) -> BVal {
    BVal::Arr(
        misses
            .iter()
            .map(|miss| {
                BVal::obj([
                    ("target", BVal::text(&miss.target)),
                    ("at", BVal::Num(miss.at)),
                ])
            })
            .collect(),
    )
}

fn memory_command(command: &Command) -> MemoryCommand {
    match command {
        Command::Move { x, y } => MemoryCommand::Move {
            x: *x,
            y: *y,
            seq: None,
        },
        Command::Stop {} => MemoryCommand::Stop { seq: None },
        Command::Target { id } => MemoryCommand::Target { id: id.clone() },
        Command::Pickup { container_id } => MemoryCommand::Pickup {
            container_id: container_id.clone(),
        },
        Command::Cast { .. } => MemoryCommand::Cast,
        _ => MemoryCommand::Other,
    }
}

fn note_sent(memory: &mut Memory, command: &TimedCommand) {
    let encoded = trace::encode_timed_command(command);
    let raw = trace::to_method_value(&encoded).expect("timed command is declared method data");
    memory
        .note_sent(MemoryTimedCommand {
            at: command.at,
            cmd: memory_command(&command.cmd),
            raw,
        })
        .expect("Memory.noteSent accepts a released source command");
}

/// The shared recording sinks one hand profile uses: the actual returned draws append `{kind,lane,index,value}` in their
/// real global order, with the same per-lane ordinal counters the source wrapper keeps.
#[derive(Clone)]
struct DrawRecorder {
    rows: Arc<Mutex<Vec<BVal>>>,
    counts: Arc<Mutex<[u64; 3]>>,
}

impl DrawRecorder {
    fn new() -> Self {
        Self {
            rows: Arc::new(Mutex::new(Vec::new())),
            counts: Arc::new(Mutex::new([0; 3])),
        }
    }

    fn sink(&self, lane: usize, lane_name: &'static str) -> Box<dyn FnMut(f64)> {
        let rows = Arc::clone(&self.rows);
        let counts = Arc::clone(&self.counts);
        Box::new(move |value: f64| {
            let index = {
                let mut counts = counts.lock().unwrap_or_else(|poison| poison.into_inner());
                let index = counts[lane];
                counts[lane] += 1;
                index
            };
            rows.lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .push(BVal::obj([
                    ("kind", BVal::text("rng")),
                    ("lane", BVal::text(lane_name)),
                    ("index", BVal::Num(index as f64)),
                    ("value", BVal::Num(value)),
                ]));
        })
    }

    fn take_rows(&self) -> BVal {
        BVal::Arr(
            self.rows
                .lock()
                .unwrap_or_else(|poison| poison.into_inner())
                .drain(..)
                .collect(),
        )
    }

    fn counts(&self) -> [u64; 3] {
        *self
            .counts
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

fn lane_address(rng: &Rng) -> usize {
    rng as *const Rng as usize
}

fn check_all(label: &str, expected: &BVal, actual: &BVal) {
    let mut failures = Vec::new();
    trace::compare(label, expected, actual, &mut failures);
    assert!(
        failures.is_empty(),
        "{label}: first source mismatch: {}",
        failures.first().cloned().unwrap_or_default()
    );
}

/// One replayed Hand operation's actual native rows, exposed for the reached-assertion controls (`$handSupplement`).
#[derive(Clone, Debug)]
pub(crate) struct ReplayedHandOp {
    pub(crate) result: BVal,
    pub(crate) counts: [u64; 3],
    pub(crate) submit_trace: BVal,
    pub(crate) release_trace: BVal,
    pub(crate) stats: BVal,
    pub(crate) misses: BVal,
    pub(crate) memory: BVal,
}

/// Replay one frozen Hand profile over the actual admitted Humanizer + Memory (no expected value is installed). The
/// returned transcripts are the actual ordered draws recorded at the real draw site.
pub(crate) fn replay_hand(profile_name: &str) -> Result<Vec<ReplayedHandOp>, String> {
    let source = source_input::load()?;
    let profile = source
        .hand
        .iter()
        .find(|profile| profile.profile == profile_name)
        .ok_or_else(|| format!("unknown frozen hand profile {profile_name}"))?;
    let map = map_fixture();
    let tier: &'static TierParams = hard_tier();
    let memory_features = match &profile.features {
        Some(features) => features.clone(),
        None => absent_profile_memory_features(),
    };
    let mut memory = Memory::new(MemoryConfig {
        self_id: "me".to_string(),
        tier,
        map: map.memory_map()?,
        features: memory_features,
    })
    .map_err(|error| format!("Memory::new: {error}"))?;
    let bot_map = BotMap::from_tile_map(&map.open);
    let mut humanizer = match &profile.features {
        Some(features) => Humanizer::with_features(tier, bot_map, features),
        None => Humanizer::new(tier, bot_map),
    };
    let mut motor_rng = Rng::new(profile.seeds.motor);
    let mut lapse_rng = Rng::new(profile.seeds.lapse);
    let draws = DrawRecorder::new();
    let mut out = Vec::with_capacity(profile.operations.len());
    for operation in &profile.operations {
        let percept = adapters::memory_percept(&operation.percept)
            .map_err(|error| format!("memory percept projection: {error}"))?;
        memory
            .observe(&percept)
            .map_err(|error| format!("Memory.observe: {error}"))?;
        let hand_percept = adapters::hand_percept(&operation.percept)
            .map_err(|error| format!("hand percept projection: {error}"))?;
        let submit_trace;
        {
            let motor = lane_address(&motor_rng);
            let lapse = lane_address(&lapse_rng);
            let _scope = random::draw_observer::scope_draws(vec![
                (motor, draws.sink(1, "motor")),
                (lapse, draws.sink(2, "lapse")),
            ]);
            let mut ctx = crate::bots::humanizer::Context {
                p: &hand_percept,
                engaged: false,
                motor: &mut motor_rng,
                lapse: &mut lapse_rng,
            };
            humanizer.submit(&operation.intents, &mut ctx);
            submit_trace = draws.take_rows();
        }

        let release_percept = adapters::memory_percept(&operation.release_percept)
            .map_err(|error| format!("release percept projection: {error}"))?;
        memory
            .observe(&release_percept)
            .map_err(|error| format!("release Memory.observe: {error}"))?;
        let release_hand_percept = adapters::hand_percept(&operation.release_percept)
            .map_err(|error| format!("release hand percept projection: {error}"))?;
        let release_trace;
        let released: Vec<TimedCommand>;
        {
            let motor = lane_address(&motor_rng);
            let lapse = lane_address(&lapse_rng);
            let _scope = random::draw_observer::scope_draws(vec![
                (motor, draws.sink(1, "motor")),
                (lapse, draws.sink(2, "lapse")),
            ]);
            let mut ctx = crate::bots::humanizer::Context {
                p: &release_hand_percept,
                engaged: false,
                motor: &mut motor_rng,
                lapse: &mut lapse_rng,
            };
            released = humanizer.release(&mut ctx);
            release_trace = draws.take_rows();
        }
        for command in &released {
            note_sent(&mut memory, command);
        }
        let misses = humanizer.drain_misses();
        let stimuli = memory.view().stimuli.to_vec();
        out.push(ReplayedHandOp {
            result: trace::encode_timed_commands(&released),
            counts: draws.counts(),
            submit_trace,
            release_trace,
            stats: encode_stats(humanizer.stats()),
            misses: encode_misses(&misses),
            memory: trace::encode_memory_snapshot(&memory, &stimuli),
        });
    }
    Ok(out)
}

#[test]
fn hand_supplement_replays_all_6_profiles_12_operations() {
    let source = source_input::load().expect("checked frozen source intake");
    assert_eq!(source.hand.len(), 6, "six frozen Hand profiles");
    let operations: usize = source
        .hand
        .iter()
        .map(|profile| profile.operations.len())
        .sum();
    assert_eq!(operations, 12, "twelve frozen Hand operations");
    let HandSeeds {
        decide,
        motor,
        lapse,
        knowledge,
    } = source.hand[0].seeds;
    assert_eq!((decide, motor, lapse, knowledge), (123, 124, 125, 126));
    let mut total_checks = 0usize;
    for profile in &source.hand {
        let actual = replay_hand(&profile.profile)
            .unwrap_or_else(|error| panic!("hand {} replay: {error}", profile.profile));
        assert_eq!(actual.len(), profile.operations.len());
        for (index, (operation, actual)) in profile.operations.iter().zip(actual.iter()).enumerate()
        {
            let label = format!("hand {} operation {index}", profile.profile);
            check_all(
                &format!("{label} submitTrace"),
                &operation.submit_trace,
                &actual.submit_trace,
            );
            check_all(
                &format!("{label} releaseTrace"),
                &operation.release_trace,
                &actual.release_trace,
            );
            check_all(
                &format!("{label} result"),
                &operation.result,
                &actual.result,
            );
            check_all(&format!("{label} stats"), &operation.stats, &actual.stats);
            check_all(
                &format!("{label} misses"),
                &operation.misses,
                &actual.misses,
            );
            check_all(
                &format!("{label} memory"),
                &operation.memory,
                &actual.memory,
            );
            assert_eq!(
                actual.counts, operation.counts,
                "{label}: cumulative draw counts differ from the frozen source"
            );
            total_checks += 1;
        }
    }
    assert_eq!(total_checks, 12, "six profiles x two operations replayed");
}
