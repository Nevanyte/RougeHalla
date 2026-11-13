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
use crate::tournament::{
    plan_game, play_each, run_game_seats, GameSummary, SeatSpec, TournamentPlan,
};
use crate::tournament_cli::lineup_text;
use rh_policy::bots::learning::LEARN_VERSION;
use rh_policy::bots::learning::{Cell, LearnedBias, RunOutcome, RunSummary, Stats, Tier};
use rh_policy::bots::TierId;
use rh_policy::bots::{BrainBot, HumanBot};
use rh_policy::PolicyFinish;
use rh_sim::{Arena, Outcome, RunResult, SimConfig};
use serde_json::{json, Map, Value};

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
pub const LEARNING_USAGE: &str = "  --policy P       human (default: the live fill bot) or brain (the ported legacy Brain)
  --learn on       with --policy brain: play the games in plan order through one in-memory store of the ported
                   legacy learner (each game's seats read the store as it stood when the game began)
  --learn-out FILE where --learn on writes the final store (default tournament-learning.json)";

/// The format tag of a store file.
pub const STORE_FORMAT: &str = "rh-bot-learning/1";

/// Take `--policy P` and `--learn-out FILE` (and their `=` forms) out of argv; the rest goes to the source parser
/// unchanged.
pub fn split_learning_args(argv: &[String]) -> Result<(Vec<String>, LearningArgs), String> {
    let mut rest = Vec::with_capacity(argv.len());
    let mut args = LearningArgs::default();
    let mut i = 0;
    while i < argv.len() {
        let raw = &argv[i];
        i += 1;
        let (flag, inline) = match raw.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag, Some(value.to_owned())),
            _ => (raw.as_str(), None),
        };
        if flag != "--policy" && flag != "--learn-out" {
            rest.push(raw.clone());
            continue;
        }
        let value = match inline {
            Some(value) => value,
            None => {
                let value = argv
                    .get(i)
                    .cloned()
                    .ok_or_else(|| format!("{flag} needs a value"))?;
                i += 1;
                value
            }
        };
        if flag == "--policy" {
            let v = value.to_lowercase();
            args.policy = SeatPolicy::parse(&v)
                .ok_or_else(|| format!("--policy takes human or brain, got \"{v}\""))?;
        } else {
            if value.is_empty() {
                return Err("--learn-out needs a file name".into());
            }
            args.learn_out = Some(value);
        }
    }
    Ok((rest, args))
}

/// A learning run is refused unless its seats report choices.
pub fn check_learning(policy: SeatPolicy, learn: bool) -> Result<(), String> {
    if learn && !policy.reports_choices() {
        return Err(format!(
            "--learn on needs seats that report their choices; --policy {} reports none, so no learning store is \
             activated (use --policy brain)",
            policy.as_str()
        ));
    }
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
    seat: &SeatSpec,
    result: &RunResult,
    finish: Option<PolicyFinish>,
) -> SeatRecord {
    let mut choices = finish.map(|f| f.choices).unwrap_or_default();
    // Source onResult: the faction was the manager's pick, recorded after the Brain's own choices.
    choices.push(format!(
        "faction|{}|{}",
        seat.persona.as_str(),
        seat.faction.as_str()
    ));
    SeatRecord {
        index,
        tier: learn_tier(seat.tier),
        outcome: match result.outcome {
            Outcome::Won => RunOutcome::Won,
            Outcome::Draw => RunOutcome::Draw,
            Outcome::Died => RunOutcome::Died,
            Outcome::Mia => RunOutcome::Mia,
        },
        place: f64::from(result.place),
        players: f64::from(result.players),
        choices,
    }
}

fn cell_json(cell: Cell) -> Value {
    json!({ "n": cell.n(), "s": cell.s() })
}

fn cell_of(value: &Value, what: &str) -> Result<Cell, String> {
    let n = value["n"].as_f64();
    let s = value["s"].as_f64();
    n.zip(s)
        .and_then(|(n, s)| Cell::try_new(n, s))
        .ok_or_else(|| format!("{what}: not a cell"))
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
        self.stats.snapshot()
    }
    /// Fold one seat record in (source `store.record`). False when the learner ignores it.
    pub fn record(&mut self, record: &SeatRecord) -> bool {
        self.stats.apply(&RunSummary {
            tier: record.tier,
            outcome: record.outcome,
            place: record.place,
            players: record.players,
            choices: &record.choices,
        })
    }
    /// The store as JSON: the format tag, every tier's baseline cell, every choice cell (sorted by key, as the source
    /// writer sorts), and each cell's bias.
    pub fn to_json(&self) -> Value {
        let mut baseline = Map::new();
        for tier in Tier::ALL {
            baseline.insert(tier.as_str().into(), cell_json(self.stats.baseline(tier)));
        }
        let mut entries = Map::new();
        let mut bias = Map::new();
        // BTreeMap order: sorted by key.
        for (key, cell) in self.stats.entries() {
            entries.insert(key.clone(), cell_json(*cell));
            bias.insert(key.clone(), json!(cell.bias()));
        }
        json!({
            "format": STORE_FORMAT,
            "version": LEARN_VERSION,
            "baseline": baseline,
            "entries": entries,
            // Oldest first: the age order eviction reads (the entries object above is sorted by key).
            "order": self.stats.entry_order(),
            "bias": bias,
        })
    }
    /// Read a store back (the inverse of [`to_json`](Self::to_json)). Anything damaged refuses the whole file.
    pub fn from_json(value: &Value) -> Result<Self, String> {
        if value["format"] != STORE_FORMAT {
            return Err(format!("not a {STORE_FORMAT} store"));
        }
        if value["version"] != LEARN_VERSION {
            return Err(format!(
                "store version {} is not {LEARN_VERSION}",
                value["version"]
            ));
        }
        let mut stats = Stats::default();
        for tier in Tier::ALL {
            let cell = cell_of(&value["baseline"][tier.as_str()], tier.as_str())?;
            stats.set_baseline(tier, cell);
        }
        let entries = value["entries"]
            .as_object()
            .ok_or("the store has no entries object")?;
        let order = value["order"]
            .as_array()
            .ok_or("the store has no order array")?;
        if order.len() != entries.len() {
            return Err("the store's order does not list every entry once".into());
        }
        // Restored oldest first, so the eviction age order comes back with the cells.
        for key in order {
            let key = key.as_str().ok_or("an order key is not a string")?;
            let cell = entries
                .get(key)
                .ok_or_else(|| format!("{key}: in the order but not in the entries"))?;
            if stats.entries().contains_key(key) {
                return Err(format!("{key}: listed twice in the order"));
            }
            if !stats.insert_entry(key.to_owned(), cell_of(cell, key)?) {
                return Err(format!("{key}: not a choice key"));
            }
        }
        Ok(Self { stats })
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
    let features = rh_policy::bots::brain_features(sim, arena);
    let mut records = Vec::new();
    let mut lineup: Vec<SeatSpec> = Vec::new();
    let summary = run_game_seats(
        index,
        plan,
        arena,
        sim,
        |seat| -> Box<dyn rh_policy::Policy> {
            match policy {
                SeatPolicy::Human => Box::new(HumanBot::new(seat.tier, seat.persona)),
                SeatPolicy::Brain => Box::new(
                    BrainBot::new(seat.tier, seat.persona, features.clone())
                        .with_learned(learned.clone()),
                ),
            }
        },
        |env, i, result| {
            if lineup.is_empty() {
                lineup = plan_game(plan, index).lineup;
            }
            let player = env.sim.players()[i].id;
            let finish = env.finish_seat(player, Some(result));
            records.push(seat_record(i, &lineup[i], result, finish));
        },
    );
    LearnedGame {
        index,
        bias_in: learned.clone(),
        summary,
        records,
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
    (0..plan.games)
        .map(|index| {
            let learned = store.snapshot();
            let game = run_learning_game(index, plan, arena, sim, policy, &learned);
            for record in &game.records {
                store.record(record);
            }
            game
        })
        .collect()
}

/// Play the plan with `policy` seats and no learning (the Brain reads the switched-off bias), split across the plan's
/// workers and returned in plan order.
pub fn play_policy(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
) -> Vec<GameSummary> {
    play_each(plan, plan.workers, |index| {
        run_learning_game(index, plan, arena, sim, policy, &LearnedBias::NO_BIAS).summary
    })
}

/// The JSON file a learning run writes: the plan that produced it and the final store.
pub fn learning_file(plan: &TournamentPlan, policy: SeatPolicy, store: &LearnStore) -> Value {
    json!({
        "plan": {
            "games": plan.games,
            "seed": plan.seed,
            "lineup": lineup_text(&plan.tiers),
            "persona": plan.persona.as_str(),
            "faction": plan.faction.as_str(),
            "maxSimMs": plan.max_sim_ms,
            "patienceSeconds": plan.patience_seconds,
            "suddenDeathSeconds": plan.sudden_death_seconds,
            "policy": policy.as_str(),
        },
        "store": store.to_json(),
    })
}
