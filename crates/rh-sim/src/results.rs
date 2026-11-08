//! A player's resolved run and its parts: what persistence banks (legacy `RunResult`).

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Outcome {
    Won,
    Draw,
    Died,
    Mia,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WinBonusWhy {
    Starters,
    Opponents,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GvReason {
    Mob,
    Elite,
    Skip,
    Kill,
    Bounty,
    Win,
    /// A completed quest's GV (source `awardQuestGv`).
    Quest,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GvBreakdown {
    pub kills: u32,
    pub mobs: u32,
    pub bounty: u32,
    pub quest: u32,
    pub win: u32,
    pub total: u32,
}

/// A player's resolved run (legacy `RunResult`): what persistence banks, idempotently, keyed by (match, profile).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunResult {
    pub outcome: Outcome,
    pub profile: String,
    /// Explicit join choice, not the runtime round-robin default (legacy RaidRoom.picked).
    pub faction: Option<crate::FactionId>,
    /// Selected carried item at resolution, after body drops. Empty hands are None, not Fists.
    pub weapon: Option<crate::WeaponId>,
    pub duration_sec: u32,
    pub kills: u32,
    pub killed_by: Option<String>,
    pub killed_by_bot: bool,
    pub place: u32,
    pub players: u32,
    pub gv: GvBreakdown,
    pub win_bonus_withheld: bool,
    pub win_bonus_why: Option<WinBonusWhy>,
}

#[cfg(test)]
mod tests;
