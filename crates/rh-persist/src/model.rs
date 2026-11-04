//! Data shapes. The JSON field names match the legacy v2 profile file (camelCase) so a profile round-trips.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Legacy `Number.MAX_SAFE_INTEGER`: counters saturate here, as `addCount` does.
pub const MAX_SAFE: i64 = 9_007_199_254_740_991;

pub fn add_count(a: i64, b: i64) -> i64 {
    a.saturating_add(b).min(MAX_SAFE)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stats {
    pub runs: i64,
    pub wins: i64,
    pub draws: i64,
    pub deaths: i64,
    pub kills: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    #[serde(default)]
    pub qualified_wins: i64,
    pub bounty_runs: i64,
    pub best_run_kills: i64,
    #[serde(default)]
    pub wins_by_faction: BTreeMap<String, i64>,
    #[serde(default)]
    pub wins_by_weapon: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cosmetics {
    pub owned: Vec<String>,
    pub equipped: BTreeMap<String, String>,
}

/// A whole profile, minus the token (only its hash is kept).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub callsign: String,
    pub token_sha256: [u8; 32],
    pub gv: i64,
    pub gv_lifetime: i64,
    pub gv_by_month: BTreeMap<String, i64>,
    pub stats: Stats,
    pub cosmetics: Cosmetics,
    pub achievements: BTreeMap<String, i64>,
    pub progress: Progress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Won,
    Draw,
    Died,
    Mia,
}

/// `RunResult.gv` (GvBreakdown) of the legacy messages. Only `total` is credited; the parts are kept for audit.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GvBreakdown {
    #[serde(default)]
    pub kills: i64,
    #[serde(default)]
    pub mobs: i64,
    #[serde(default)]
    pub bounty: i64,
    #[serde(default)]
    pub quest: i64,
    #[serde(default)]
    pub win: i64,
    pub total: i64,
}

/// What one match banks for one player (legacy `RunRecord` plus the breakdown).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchResult {
    /// `None` is a run voided by a shutdown (legacy `bankGv`): only the GV is paid, no run is recorded.
    pub outcome: Option<Outcome>,
    pub kills: i64,
    pub gv: GvBreakdown,
    pub faction: Option<String>,
    /// The weapon in hand at the end.
    pub weapon: Option<String>,
    /// `!RunResult.winBonusWithheld` on a win. Only qualified wins feed `progress`.
    pub win_qualified: bool,
}

pub const GOLD_FACTIONS: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
pub const GOLD_WEAPONS: [&str; 5] = ["sword", "axe", "bow", "wand", "shield"];

/// The legacy `PROFILE_RE`: `^[A-Za-z0-9_-]{2,16}$`.
pub fn valid_callsign(s: &str) -> bool {
    (2..=16).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn valid_month(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && matches!((b[5], b[6]), (b'0', b'1'..=b'9') | (b'1', b'0'..=b'2'))
}
