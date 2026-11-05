//! Server-owned achievement rules, in the legacy catalog order.
//!
//! Only durable counters are read. The result transaction records the returned ids
//! and grants their cosmetics together; retrying an applied result cannot unlock twice.

use crate::model::{Progress, Stats, GOLD_FACTIONS};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Goal {
    Stat { stat: Stat, min: i64 },
    Progress { key: Counter, min: i64 },
    LifetimeGv { min: i64 },
    FactionWins { faction: &'static str, min: i64 },
    WeaponWins { weapon: &'static str, min: i64 },
    EveryFactionWins { min: i64 },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stat {
    Kills,
    Runs,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Counter {
    QualifiedWins,
    BountyRuns,
    BestRunKills,
}

#[derive(Debug, Serialize)]
pub struct Achievement {
    pub id: &'static str,
    pub goal: Goal,
    pub reward: &'static [&'static str],
}

macro_rules! achievement {
    ($id:literal, $goal:expr, [$($reward:literal),+]) => {
        Achievement { id: $id, goal: $goal, reward: &[$($reward),+] }
    };
}

/// Ids, thresholds, order and rewards are pinned against the actual TypeScript
/// evaluator by `tests/fixtures/achievements.json`. They are durable ids: append only.
pub const ACHIEVEMENTS: &[Achievement] = &[
    achievement!(
        "first_blood",
        Goal::Stat {
            stat: Stat::Kills,
            min: 1
        },
        ["title-bloodied"]
    ),
    achievement!(
        "slayer",
        Goal::Stat {
            stat: Stat::Kills,
            min: 10
        },
        ["title-slayer"]
    ),
    achievement!(
        "reaper",
        Goal::Stat {
            stat: Stat::Kills,
            min: 50
        },
        ["title-reaper"]
    ),
    achievement!(
        "rampage",
        Goal::Progress {
            key: Counter::BestRunKills,
            min: 5
        },
        ["title-rampage", "trail-comet"]
    ),
    achievement!(
        "bounty_hunter",
        Goal::Progress {
            key: Counter::BountyRuns,
            min: 1
        },
        ["title-bounty-hunter", "outline-bounty"]
    ),
    achievement!(
        "first_win",
        Goal::Progress {
            key: Counter::QualifiedWins,
            min: 1
        },
        ["title-victor", "skin-laurel"]
    ),
    achievement!(
        "champion",
        Goal::Progress {
            key: Counter::QualifiedWins,
            min: 5
        },
        ["title-champion"]
    ),
    achievement!(
        "warlord",
        Goal::Progress {
            key: Counter::QualifiedWins,
            min: 20
        },
        ["title-warlord"]
    ),
    achievement!(
        "veteran",
        Goal::Stat {
            stat: Stat::Runs,
            min: 25
        },
        ["title-veteran", "skin-ghost"]
    ),
    achievement!(
        "glorious",
        Goal::LifetimeGv { min: 1000 },
        ["title-glorious"]
    ),
    achievement!(
        "win_fire",
        Goal::FactionWins {
            faction: "fire",
            min: 1
        },
        ["title-pyre-lord"]
    ),
    achievement!(
        "win_sentenced",
        Goal::FactionWins {
            faction: "sentenced",
            min: 1
        },
        ["title-the-judge"]
    ),
    achievement!(
        "win_plague",
        Goal::FactionWins {
            faction: "plague",
            min: 1
        },
        ["title-rat-king"]
    ),
    achievement!(
        "win_frost",
        Goal::FactionWins {
            faction: "frost",
            min: 1
        },
        ["title-ice-wall"]
    ),
    achievement!(
        "win_holy",
        Goal::FactionWins {
            faction: "holy",
            min: 1
        },
        ["title-demon-blood"]
    ),
    achievement!(
        "cycle_breaker",
        Goal::EveryFactionWins { min: 1 },
        ["title-cycle-breaker"]
    ),
    achievement!(
        "gild_fire",
        Goal::FactionWins {
            faction: "fire",
            min: 3
        },
        ["gilded-fire"]
    ),
    achievement!(
        "gild_sentenced",
        Goal::FactionWins {
            faction: "sentenced",
            min: 3
        },
        ["gilded-sentenced"]
    ),
    achievement!(
        "gild_plague",
        Goal::FactionWins {
            faction: "plague",
            min: 3
        },
        ["gilded-plague"]
    ),
    achievement!(
        "gild_frost",
        Goal::FactionWins {
            faction: "frost",
            min: 3
        },
        ["gilded-frost"]
    ),
    achievement!(
        "gild_holy",
        Goal::FactionWins {
            faction: "holy",
            min: 3
        },
        ["gilded-holy"]
    ),
    achievement!(
        "gild_sword",
        Goal::WeaponWins {
            weapon: "sword",
            min: 5
        },
        ["gilded-sword"]
    ),
    achievement!(
        "gild_axe",
        Goal::WeaponWins {
            weapon: "axe",
            min: 5
        },
        ["gilded-axe"]
    ),
    achievement!(
        "gild_bow",
        Goal::WeaponWins {
            weapon: "bow",
            min: 5
        },
        ["gilded-bow"]
    ),
    achievement!(
        "gild_wand",
        Goal::WeaponWins {
            weapon: "wand",
            min: 5
        },
        ["gilded-wand"]
    ),
    achievement!(
        "gild_shield",
        Goal::WeaponWins {
            weapon: "shield",
            min: 5
        },
        ["gilded-shield"]
    ),
];

fn met(goal: Goal, stats: &Stats, progress: &Progress, lifetime_gv: i64) -> bool {
    match goal {
        Goal::Stat { stat, min } => match stat {
            Stat::Kills => stats.kills >= min,
            Stat::Runs => stats.runs >= min,
        },
        Goal::Progress { key, min } => match key {
            Counter::QualifiedWins => progress.qualified_wins >= min,
            Counter::BountyRuns => progress.bounty_runs >= min,
            Counter::BestRunKills => progress.best_run_kills >= min,
        },
        Goal::LifetimeGv { min } => lifetime_gv >= min,
        Goal::FactionWins { faction, min } => {
            progress.wins_by_faction.get(faction).copied().unwrap_or(0) >= min
        }
        Goal::WeaponWins { weapon, min } => {
            progress.wins_by_weapon.get(weapon).copied().unwrap_or(0) >= min
        }
        Goal::EveryFactionWins { min } => GOLD_FACTIONS
            .iter()
            .all(|id| progress.wins_by_faction.get(*id).copied().unwrap_or(0) >= min),
    }
}

pub fn evaluate(
    stats: &Stats,
    progress: &Progress,
    lifetime_gv: i64,
    unlocked: &BTreeMap<String, i64>,
) -> Vec<&'static Achievement> {
    ACHIEVEMENTS
        .iter()
        .filter(|a| !unlocked.contains_key(a.id) && met(a.goal, stats, progress, lifetime_gv))
        .collect()
}
