//! Data shapes. The JSON field names match the legacy v2 profile file (camelCase) so a profile round-trips.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// Legacy `Number.MAX_SAFE_INTEGER`: counters saturate here, as `addCount` does.
pub const MAX_SAFE: i64 = 9_007_199_254_740_991;

pub fn add_count(a: i64, b: i64) -> i64 {
    a.saturating_add(b).min(MAX_SAFE)
}

// The three profile blobs below are read-modify-written whole, so each is TOLERANT in both directions (rolling deploys
// run two binaries on one database): `default` lets a row that lacks a field a newer binary added still decode, and the
// flattened `rest` carries every key this binary does not know through the write-back untouched, so an older binary never
// deletes a newer binary's field. Typed fields are filled first, so `rest` can never shadow one. Only add fields with
// a default, and never change the meaning of an existing key.

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub runs: i64,
    pub wins: i64,
    pub draws: i64,
    pub deaths: i64,
    pub kills: i64,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Progress {
    pub qualified_wins: i64,
    pub bounty_runs: i64,
    pub best_run_kills: i64,
    pub wins_by_faction: BTreeMap<String, i64>,
    pub wins_by_weapon: BTreeMap<String, i64>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Cosmetics {
    pub owned: Vec<String>,
    pub equipped: BTreeMap<String, String>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
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

impl Profile {
    /// What a just-created profile reads back as (the column defaults of `profiles`), so a claim can answer from its own
    /// insert without a second read. A test pins this against the database.
    pub fn fresh(callsign: &str) -> Self {
        Self {
            callsign: callsign.to_owned(),
            token_sha256: [0; 32],
            gv: 0,
            gv_lifetime: 0,
            gv_by_month: BTreeMap::new(),
            stats: Stats::default(),
            cosmetics: Cosmetics::default(),
            achievements: BTreeMap::new(),
            progress: Progress::default(),
        }
    }
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

/// What one match banks for one player: the legacy `RunRecord` plus the breakdown, and every other field of the sim's
/// `RunResult` (so support and the results screen can answer "why was my win bonus withheld" and "who killed me" for
/// matches played long ago), plus the faction and weapon the player ended with. Stored in `match_results.result` as camelCase
/// JSON with a `"v":1` key ([`StoredResult`]); fields added later must have a default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    pub duration_sec: i64,
    pub killed_by: Option<String>,
    pub killed_by_bot: bool,
    pub place: i64,
    pub players: i64,
    pub win_bonus_withheld: bool,
    pub win_bonus_why: Option<String>,
}

/// Version of the stored `match_results.result` document.
pub const RESULT_VERSION: u8 = 1;

/// The document in `match_results.result`: [`MatchResult`] under a version key.
#[derive(Serialize, Deserialize)]
pub struct StoredResult {
    pub v: u8,
    #[serde(flatten)]
    pub result: MatchResult,
}

/// The match a result belongs to, for the `matches` row written with the first result of the match (idempotent: the
/// other players' results of the same match find it there).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchMeta {
    /// The host that played it (the lease owner / instance id).
    pub owner: String,
    pub region: Option<String>,
    pub placement_id: Option<String>,
    /// `rh_sim::replay::BUILD_ID` of the recording binary.
    pub build: String,
    /// `rh_sim::content::content_hash()` of the rules it ran under.
    pub content_hash: u64,
    pub humans: u32,
    pub bots: u32,
}

impl MatchMeta {
    /// For callers that know nothing about the match (tests, admin tools).
    pub fn unknown() -> Self {
        Self {
            owner: "unknown".into(),
            region: None,
            placement_id: None,
            build: "unknown".into(),
            content_hash: 0,
            humans: 0,
            bots: 0,
        }
    }
}

/// Durable ids (append only, see the README): they are keys in stored `winsByFaction` / `winsByWeapon`. The server's
/// `tests/durable_ids.rs` pins them to the sim's `as_str` spellings.
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
