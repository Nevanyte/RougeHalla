//! Source `packages/server/src/bots/learning/BotStatsStore.ts` + the `LEARN`/`ChoiceKey`/`LearnedBias` model in
//! `brain/types.ts` (BOTS.md 6.2): what the filler bots learn across matches, as a pure model.
//!
//! The source keeps this store in its own JSON file with its own module and never lets it touch a human's profile data.
//! The Rust port keeps the algorithm here (pure, no I/O, no clock) and puts the durable rows in PostgreSQL through
//! `rh-persist` (P-BOTS-5): a `Stats` value is the decoded store, `apply` is one run summary folded in, and `snapshot` is
//! the read-only bias view a bot or the fill policy reads.
use std::collections::{BTreeMap, BTreeSet};

/// Source `LEARN` (brain/types.ts): the model's durable numbers.
pub const LEARN_VERSION: i32 = 1;
pub const LEARN_PRIOR: f64 = 0.5;
pub const LEARN_STRENGTH: f64 = 8.;
pub const LEARN_DECAY: f64 = 0.99;
pub const LEARN_CAP: f64 = 0.25;
pub const LEARN_WEIGHT: f64 = 0.3;
pub const LEARN_EXPLORE: f64 = 0.05;
pub const LEARN_MAX_ENTRIES: usize = 2000;
pub const LEARN_WRITE_EVERY_MS: i64 = 10_000;
/// The score where a run says nothing (source `NEUTRAL`).
pub const NEUTRAL: f64 = 0.5;
/// A choice key is `domain|a|b`, at most this long (source `MAX_KEY_LENGTH`).
pub const MAX_KEY_LENGTH: usize = 96;
/// Source `DOMAINS`, in the emitted order (the order does not affect behaviour; a key needs one of them).
pub const DOMAINS: [&str; 8] = [
    "faction", "opener", "second", "spawn", "boon", "skill", "relic", "camp",
];

/// Source `TierId` order (`TIER_IDS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Tier {
    Easy,
    Normal,
    Hard,
}
impl Tier {
    pub const ALL: [Tier; 3] = [Tier::Easy, Tier::Normal, Tier::Hard];
    pub fn index(self) -> usize {
        match self {
            Tier::Easy => 0,
            Tier::Normal => 1,
            Tier::Hard => 2,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Easy => "easy",
            Tier::Normal => "normal",
            Tier::Hard => "hard",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.as_str() == value)
    }
}

/// Source `RunOutcome | "void"`: a void run (the room closed) is never recorded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunOutcome {
    Won,
    Draw,
    Died,
    Mia,
    Void,
}

/// A decayed count and a decayed sum of residuals (or, for a tier's baseline, of placement scores).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    n: f64,
    s: f64,
}
impl Cell {
    pub const ZERO: Cell = Cell { n: 0., s: 0. };
    /// Source `toCell`: a cell with negative numbers or more sum than count is damaged.
    pub fn try_new(n: f64, s: f64) -> Option<Cell> {
        (n.is_finite() && s.is_finite() && n >= 0. && s >= 0. && s <= n + 1e-9)
            .then_some(Cell { n, s })
    }
    pub fn n(self) -> f64 {
        self.n
    }
    pub fn s(self) -> f64 {
        self.s
    }
    /// Source `biasOf`: the smoothed mean (the prior is worth `LEARN_STRENGTH` runs) minus the neutral score, capped.
    pub fn bias(self) -> f64 {
        let m = (self.s + LEARN_PRIOR * LEARN_STRENGTH) / (self.n + LEARN_STRENGTH);
        (m - NEUTRAL).clamp(-LEARN_CAP, LEARN_CAP)
    }
}

/// Source `validKey`: `domain|a|b`, three non-empty parts, a known domain, at most `MAX_KEY_LENGTH` bytes.
pub fn valid_key(key: &str) -> bool {
    if key.len() > MAX_KEY_LENGTH {
        return false;
    }
    let parts: Vec<&str> = key.split('|').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty()) && DOMAINS.contains(&parts[0])
}

/// What one applied run changed, for a durable store's written batch.
#[derive(Clone, Debug, PartialEq)]
pub struct Applied {
    pub tier: Tier,
    /// Every distinct, valid choice key the run touched (upserted).
    pub touched: BTreeSet<String>,
    /// Keys the table dropped to stay at `LEARN_MAX_ENTRIES` (deleted).
    pub evicted: Vec<String>,
}

/// One run's outcome for one bot (source `RunSummary`, minus the persona/faction fields the store never reads).
#[derive(Clone, Debug, PartialEq)]
pub struct RunSummary<'a> {
    pub tier: Tier,
    pub outcome: RunOutcome,
    pub place: f64,
    pub players: f64,
    pub choices: &'a [String],
}

/// The decoded store: each tier's baseline cell and the choice cells.
#[derive(Clone, Debug, PartialEq)]
pub struct Stats {
    baseline: [Cell; 3],
    entries: BTreeMap<String, Cell>,
}
impl Default for Stats {
    fn default() -> Self {
        Self {
            baseline: [Cell::ZERO; 3],
            entries: BTreeMap::new(),
        }
    }
}
impl Stats {
    pub fn baseline(&self, tier: Tier) -> Cell {
        self.baseline[tier.index()]
    }
    pub fn entries(&self) -> &BTreeMap<String, Cell> {
        &self.entries
    }
    /// Restore decoded rows (a damaged entry is dropped on its own: one bad row is not worth the other rows).
    pub fn set_baseline(&mut self, tier: Tier, cell: Cell) {
        self.baseline[tier.index()] = cell;
    }
    pub fn insert_entry(&mut self, key: String, cell: Cell) -> bool {
        if !valid_key(&key) {
            return false;
        }
        self.entries.insert(key, cell);
        true
    }
    /// Source load: a full table keeps its smallest-n rows only; returns the dropped keys (the store deletes them).
    pub fn trim(&mut self) -> Vec<String> {
        self.evict(&BTreeSet::new())
    }
    /// The frozen view a bot reads (source `snapshot`): bias of every cell, 0 for an unknown key.
    pub fn snapshot(&self) -> LearnedBias {
        LearnedBias {
            enabled: true,
            biases: self
                .entries
                .iter()
                .map(|(k, c)| (k.clone(), c.bias()))
                .collect(),
        }
    }
    /// Source `record`: fold one run summary into the baseline and the choice cells. Returns false for a void/too-small/
    /// unreadable summary (nothing is changed then).
    pub fn apply(&mut self, summary: &RunSummary<'_>) -> bool {
        self.apply_logged(summary).is_some()
    }

    /// [`apply`](Self::apply) plus the rows it changed, for the durable store's batch boundary.
    pub fn apply_logged(&mut self, summary: &RunSummary<'_>) -> Option<Applied> {
        if summary.outcome == RunOutcome::Void {
            return None;
        }
        let players = summary.players.floor();
        if players < 2. || players.is_nan() {
            return None;
        }
        let rounded = js_round(summary.place);
        if summary.outcome != RunOutcome::Draw && !rounded.is_finite() {
            return None;
        }
        let place = if summary.outcome == RunOutcome::Draw {
            1.
        } else {
            rounded.clamp(1., players)
        };
        let s = (players - place) / (players - 1.);

        // The baseline takes this run in first: the first run of a tier has nothing to be compared with and so says nothing.
        let base = &mut self.baseline[summary.tier.index()];
        base.n = LEARN_DECAY * base.n + 1.;
        base.s = LEARN_DECAY * base.s + s;
        let r = (NEUTRAL + s - base.s / base.n).clamp(0., 1.);

        let mut touched = BTreeSet::new();
        for key in summary.choices {
            if !valid_key(key) || !touched.insert(key.clone()) {
                continue;
            }
            match self.entries.get_mut(key) {
                None => {
                    self.entries.insert(key.clone(), Cell { n: 1., s: r });
                }
                Some(cell) => {
                    cell.n = LEARN_DECAY * cell.n + 1.;
                    cell.s = LEARN_DECAY * cell.s + r;
                }
            }
        }
        let evicted = self.evict(&touched);
        Some(Applied {
            tier: summary.tier,
            touched,
            evicted,
        })
    }

    /// Source `evict`: the smallest n goes first (the oldest of equals); what this very run touched stays, or a full
    /// table would refuse every newcomer.
    fn evict(&mut self, keep: &BTreeSet<String>) -> Vec<String> {
        let mut evicted = Vec::new();
        while self.entries.len() > LEARN_MAX_ENTRIES {
            let victim = self
                .entries
                .iter()
                .filter(|(key, _)| !keep.contains(*key))
                .min_by(|(_, a), (_, b)| a.n.total_cmp(&b.n))
                .map(|(key, _)| key.clone());
            match victim {
                Some(key) => {
                    self.entries.remove(&key);
                    evicted.push(key);
                }
                None => break,
            }
        }
        evicted
    }
}

/// JS `Math.round`: halves go up (toward +Infinity), unlike Rust's half-away-from-zero `f64::round`.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A read-only snapshot of the stats (source `LearnedBias`): strategy adds `LEARN_WEIGHT * bias` to an option, and the
/// fill policy softmaxes `faction|<persona>|<faction>` with it.
#[derive(Clone, Debug, PartialEq)]
pub struct LearnedBias {
    enabled: bool,
    biases: BTreeMap<String, f64>,
}
impl Default for LearnedBias {
    fn default() -> Self {
        Self::NO_BIAS
    }
}
impl LearnedBias {
    /// Learning switched off: what a bot without a store reads.
    pub const NO_BIAS: LearnedBias = LearnedBias {
        enabled: false,
        biases: BTreeMap::new(),
    };
    /// A snapshot with explicit biases (tests and a store's read path).
    pub fn with_biases(biases: BTreeMap<String, f64>) -> Self {
        Self {
            enabled: true,
            biases,
        }
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    /// Source `bias`: -LEARN_CAP..+LEARN_CAP, 0 for an unknown key.
    pub fn bias(&self, key: &str) -> f64 {
        if !self.enabled {
            return 0.;
        }
        self.biases.get(key).copied().unwrap_or(0.)
    }
    pub fn len(&self) -> usize {
        self.biases.len()
    }
    pub fn is_empty(&self) -> bool {
        self.biases.is_empty()
    }
}

#[cfg(test)]
mod tests;
