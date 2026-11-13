//! P-BOT-TUNER-1: the port of legacy `tune.ts` (`applyTune`: a JSON patch of the Brain's TIERS / PERSONAS numbers for a
//! tournament run) and an offline, seeded search over those same existing numbers (R-ML narrow exception, clause 2).
//!
//! What this is not: a learning system. The search moves numbers that already exist, inside stated bounds, scores each
//! proposal by headless tournament placement, and writes the best table found as a JSON file for a person to review.
//! Nothing here runs in the live server, which reads only the compiled tables (the checked-in
//! `crates/rh-policy/data/brain_tuning.json` equals them; adopting a searched table is a separate, reviewed change).
//!
//! Pure: no clock, no file I/O (the binaries read and write files); the search's draws come from its own seeded stream.
use crate::tournament::{GameSummary, TournamentPlan};
use crate::tournament_learning::SeatPolicy;
use rh_policy::bots::types::BrainTables;
use rh_sim::{Arena, SimConfig};
use serde_json::Value;

/// The format tag of a table file (the checked-in table and a search's `table`).
pub const TABLE_FORMAT: &str = "rh-brain-tuning/1";
/// The format tag of a search's output file.
pub const SEARCH_FORMAT: &str = "rh-brain-search/1";
/// The objective's weight on the persona spread (relative to the compiled spread, capped at 1).
pub const SPREAD_WEIGHT: f64 = 0.1;

/// The two tables as the legacy spec spells them: `{"tiers":{"easy":{...}},"personas":{"farmer":{...}}}`, every number
/// of both tables with the legacy camelCase names (no `id`).
pub fn tables_json(tables: &BrainTables) -> Value {
    let _ = tables;
    Value::Null
}

/// Read a complete table (every key present, nothing else, every value in its validity range).
pub fn tables_from_json(value: &Value) -> Result<BrainTables, String> {
    let _ = value;
    Err("unimplemented".into())
}

/// The checked-in table file: the format tag and the tables.
pub fn table_file(tables: &BrainTables) -> Value {
    let _ = tables;
    Value::Null
}

/// Read a table file written by [`table_file`].
pub fn read_table_file(value: &Value) -> Result<BrainTables, String> {
    let _ = value;
    Err("unimplemented".into())
}

/// Every leaf of the tables as `tiers.easy.reaction.mu` paths, in table order.
pub fn leaf_paths() -> Vec<String> {
    Vec::new()
}

/// One leaf's value (a bool reads as 0/1).
pub fn leaf(tables: &BrainTables, path: &str) -> Option<f64> {
    let _ = (tables, path);
    None
}

/// Source `applyTune(spec)`, on a copy: deep-merge plain numbers and booleans into keys the tables already have. An
/// unknown tier, persona or key, a group where a number is (or the reverse), a wrong type or a value outside its validity
/// range is refused, as is a result that breaks the tier order (unless the spec says `"ablation": true`) or brings two
/// personas closer than [`spread_floor`].
pub fn apply_tune(base: &BrainTables, spec: &Value) -> Result<BrainTables, String> {
    let _ = (base, spec);
    Err("unimplemented".into())
}

/// The tier-ordered leaves the tables break: a leaf whose compiled values run easy -> normal -> hard in one direction
/// must keep that (weak) direction.
pub fn tier_order_violations(tables: &BrainTables) -> Vec<String> {
    let _ = tables;
    Vec::new()
}

/// How distinct the four personas are: the smallest pairwise RMS distance over the persona leaves, each leaf scaled by
/// its largest compiled magnitude.
pub fn persona_spread(tables: &BrainTables) -> f64 {
    let _ = tables;
    0.
}

/// The least spread a table may have: half the compiled tables' spread.
pub fn spread_floor() -> f64 {
    0.
}

/// The search bounds of one leaf: half to one and a half times its compiled value (a zero or boolean leaf is not searched:
/// None).
pub fn search_bounds(path: &str) -> Option<(f64, f64)> {
    let _ = path;
    None
}

/// The tables a plan's `tune` patch asks for (None: no patch), leaked once for [`rh_policy::bots::types::with_tables`].
pub fn plan_tables(plan: &TournamentPlan) -> Result<Option<&'static BrainTables>, String> {
    let _ = plan;
    Ok(None)
}

/// Play the plan with `policy` seats reading `tables` (the plan's own `tune` is ignored here).
pub fn play_tuned(
    plan: &TournamentPlan,
    arena: &Arena,
    sim: &SimConfig,
    policy: SeatPolicy,
    tables: &'static BrainTables,
) -> Vec<GameSummary> {
    let _ = tables;
    crate::tournament_learning::play_policy(plan, arena, sim, policy)
}

/// The objective of a played table: minus each tier's distance from its legacy win band (`tournament::win_band`), plus
/// [`SPREAD_WEIGHT`] times the table's spread relative to the compiled spread (capped at 1).
pub fn objective(games: &[GameSummary], tables: &BrainTables) -> f64 {
    let _ = (games, tables);
    0.
}

/// A search's settings.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchConfig {
    pub seed: u32,
    pub generations: u32,
    /// Proposals per generation.
    pub population: u32,
    /// Leaves changed per proposal.
    pub changes: u32,
    /// Largest step, as a share of a leaf's bound width.
    pub step: f64,
    pub plan: TournamentPlan,
    pub policy: SeatPolicy,
    /// The commit the search ran on (written into the file).
    pub commit: String,
}

/// One scored table of a search.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub generation: u32,
    /// The leaves this proposal changed from the table it was drawn from, with their new values.
    pub changed: Vec<(String, f64)>,
    pub score: f64,
    pub spread: f64,
    /// It became the current table.
    pub accepted: bool,
}

/// What a search found.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchResult {
    pub best: BrainTables,
    pub best_score: f64,
    /// The compiled tables' score under the same plan (generation 0).
    pub baseline_score: f64,
    pub candidates: Vec<Candidate>,
}

/// A seeded (1+lambda) hill-climb from the compiled tables.
pub fn search(config: &SearchConfig, arena: &Arena, sim: &SimConfig) -> SearchResult {
    let _ = (config, arena, sim);
    SearchResult {
        best: BrainTables::COMPILED,
        best_score: 0.,
        baseline_score: 0.,
        candidates: Vec::new(),
    }
}

/// The search's output file: seed, commit, plan, objective, bounds, every candidate, and the best table.
pub fn search_file(config: &SearchConfig, result: &SearchResult) -> Value {
    let _ = (config, result);
    Value::Null
}
