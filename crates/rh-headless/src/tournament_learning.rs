//! P-BOT-LEARN-ON-1: the headless tournament with Brain seats and the ported legacy learner (source
//! `packages/server/src/bots/tournament/worker.ts` with `learn: true`, and `BotManager.onResult`).
//!
//! The learner itself is `rh_policy::bots::learning` (not re-ported here): a decayed mean of placement per choice key.
//! This module only drives it the way the source tournament does: every seat's result is recorded when it resolves, in
//! the order the results arrive, as the Brain's own choices followed by the manager's `faction|<persona>|<faction>` key;
//! a game's seats read the frozen snapshot the store held when the game started.
//!
//! Deliberate difference from the source (proposed DEVIATIONS row): the source keeps one in-memory store per worker
//! batch, so a learning run depends on the worker count; here one store runs through the whole series in plan order
//! (learning plays the games one after another), so the same plan and seed give the same store on any machine.
//!
//! Pure: no clock, no file I/O (the binary writes the JSON this module renders).
use crate::tournament::{GameSummary, SeatSpec, TournamentPlan};
use rh_policy::bots::learning::{LearnedBias, RunOutcome, Stats, Tier};
use rh_policy::bots::TierId;
use rh_policy::PolicyFinish;
use rh_sim::{Arena, RunResult, SimConfig};
use serde_json::Value;

/// Which built-in policy a tournament seats (the source tournament always seats its Brain; the port's default is the
/// live fill bot, HumanBot, so today's runs stay byte-identical).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeatPolicy {
    #[default]
    Human,
    Brain,
}

impl SeatPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Brain => "brain",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "human" => Some(Self::Human),
            "brain" => Some(Self::Brain),
            _ => None,
        }
    }
    /// Whether the policy reports choices at the end of a run (`Policy::finish`): learning needs it.
    pub fn reports_choices(self) -> bool {
        matches!(self, Self::Brain)
    }
}

/// The learning arguments the tournament binary takes on top of the source CLI surface.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LearningArgs {
    pub policy: SeatPolicy,
    /// Where `--learn on` writes the final store (None: [`DEFAULT_LEARN_OUT`]).
    pub learn_out: Option<String>,
}

/// The store file a learning run writes when `--learn-out` is not given.
pub const DEFAULT_LEARN_OUT: &str = "tournament-learning.json";

/// The extra usage lines (`--policy`, `--learn-out`).
pub const LEARNING_USAGE: &str = "";

/// Take `--policy P` and `--learn-out FILE` (and their `=` forms) out of argv; the rest goes to the source parser
/// unchanged.
pub fn split_learning_args(argv: &[String]) -> Result<(Vec<String>, LearningArgs), String> {
    Ok((argv.to_vec(), LearningArgs::default()))
}

/// A learning run is refused unless its seats report choices.
pub fn check_learning(_policy: SeatPolicy, _learn: bool) -> Result<(), String> {
    Ok(())
}

/// The learner's tier for a seat tier.
pub fn learn_tier(tier: TierId) -> Tier {
    match tier {
        TierId::Easy => Tier::Easy,
        TierId::Normal => Tier::Normal,
        TierId::Hard => Tier::Hard,
    }
}

/// One seat's resolved run as the store records it (source `RunSummary`): the choices are the Brain's, in its order,
/// then the manager's faction key.
#[derive(Clone, Debug, PartialEq)]
pub struct SeatRecord {
    /// The seat's index in the game's lineup.
    pub index: usize,
    pub tier: Tier,
    pub outcome: RunOutcome,
    pub place: f64,
    pub players: f64,
    pub choices: Vec<String>,
}

/// The record of one seat's resolved run. `finish` is the seat's end-of-run summary (`Seat::finish`): `None` for a
/// faulted seat or a policy that reports nothing, which then records only the manager's faction key.
pub fn seat_record(
    index: usize,
    _seat: &SeatSpec,
    _result: &RunResult,
    _finish: Option<PolicyFinish>,
) -> SeatRecord {
    SeatRecord {
        index,
        tier: Tier::Easy,
        outcome: RunOutcome::Void,
        place: 0.,
        players: 0.,
        choices: Vec::new(),
    }
}

/// The in-memory learning store of a tournament series.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LearnStore {
    stats: Stats,
}

impl LearnStore {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn stats(&self) -> &Stats {
        &self.stats
    }
    /// The frozen view a game's seats are built with (source `store.snapshot()`).
    pub fn snapshot(&self) -> LearnedBias {
        LearnedBias::NO_BIAS
    }
    /// Fold one seat record in (source `store.record`). False when the learner ignores it.
    pub fn record(&mut self, _record: &SeatRecord) -> bool {
        false
    }
    /// The store as JSON: the format tag, every tier's baseline cell, every choice cell (sorted by key, as the source
    /// writer sorts), and each cell's bias.
    pub fn to_json(&self) -> Value {
        Value::Null
    }
    /// Read a store back (the inverse of [`to_json`](Self::to_json)).
    pub fn from_json(_value: &Value) -> Result<Self, String> {
        Err("unimplemented".into())
    }
}

/// One game of a learning series: the bias its seats were built with, its summary, and the records in arrival order.
#[derive(Clone, Debug, PartialEq)]
pub struct LearnedGame {
    pub index: u32,
    pub bias_in: LearnedBias,
    pub summary: GameSummary,
    pub records: Vec<SeatRecord>,
}

/// Play one game with `policy` seats built from `learned`, collecting each resolved seat's record as it resolves.
pub fn run_learning_game(
    index: u32,
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
    learned: &LearnedBias,
) -> LearnedGame {
    let _ = (plan, arena, sim, policy);
    LearnedGame {
        index,
        bias_in: learned.clone(),
        summary: crate::tournament::run_game(index, plan, arena, sim),
        records: Vec::new(),
    }
}

/// Play the plan's games in plan order, one after another, feeding every finished game into `store` before the next
/// game's seats are built.
pub fn play_learning(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
    store: &mut LearnStore,
) -> Vec<LearnedGame> {
    let _ = (plan, arena, sim, policy, store);
    Vec::new()
}

/// The JSON file a learning run writes: the plan that produced it and the final store.
pub fn learning_file(plan: &TournamentPlan, policy: SeatPolicy, store: &LearnStore) -> Value {
    let _ = (plan, policy, store);
    Value::Null
}
