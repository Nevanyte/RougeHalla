//! The source reward pools and the exact tiered draw protocol (P-CARDS-1).
//!
//! Source: `packages/shared/src/rewards.ts` — `conditionalPool`, `rewardAugmentPool`, `pickTiered`, `rollChestOptions`
//! and `ZONE_AUGMENT_THEMES` — with the interactive augment set from `cards.ts` (`INTERACTIVE_AUGMENT_IDS`). A draw is a
//! unit double, as the source `Rng` is; the callers supply the stream (production: the reward RNG, tests: the frozen tape).
use crate::cards::{Build, CardId};
use crate::FactionId;

/// The source's interactive augments, in augment source order.
pub const INTERACTIVE: [CardId; 14] = [
    CardId::SlowBurn,
    CardId::Overkill,
    CardId::TankEngine,
    CardId::PocketSand,
    CardId::Gambler,
    CardId::ThirdTimesTheCharm,
    CardId::EyeForAnEye,
    CardId::BestOffense,
    CardId::PlantYourFeet,
    CardId::WishfulThinking,
    CardId::Hemorrhage,
    CardId::SpikedShell,
    CardId::Siphon,
    CardId::SecondWind,
];

/// P-AUG-POOL-1: the interactive augments a `Rework` world's chest may offer: `INTERACTIVE` plus Committed, Fists of
/// Fury, Machine Gun, Here Comes the Boom and A Race to 0 (plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md`).
/// Source order: the 14 of `INTERACTIVE`, then the five. A chest walks `CardId::ALL` (catalog order), not this order.
pub static REWORK_POOL: &[CardId] = &[
    CardId::SlowBurn,
    CardId::Overkill,
    CardId::TankEngine,
    CardId::PocketSand,
    CardId::Gambler,
    CardId::ThirdTimesTheCharm,
    CardId::EyeForAnEye,
    CardId::BestOffense,
    CardId::PlantYourFeet,
    CardId::WishfulThinking,
    CardId::Hemorrhage,
    CardId::SpikedShell,
    CardId::Siphon,
    CardId::SecondWind,
    CardId::Committed,
    CardId::FistsOfFury,
    CardId::MachineGun,
    CardId::HereComesTheBoom,
    CardId::RaceToZero,
];

/// P-AUG-POOL-1 (decision 5): who a pool entry may be offered to. `Faction(f)`: only when every eligible picker at the
/// chest is faction `f` (and there is at least one picker).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Offer {
    Any,
    Faction(FactionId),
}

/// P-AUG-POOL-1: one eligible picker at a chest, as the offer rules read it (its build and its faction).
#[derive(Clone, Copy, Debug)]
pub struct Picker {
    pub build: Build,
    pub faction: FactionId,
}

impl Offer {
    /// Decision 5: may this entry be offered to these eligible pickers? A `Faction(f)` entry needs at least one picker,
    /// every one of them faction `f` (with no picker, e.g. a campless elite's chest, no faction card is offered).
    pub fn admits(self, pickers: &[Picker]) -> bool {
        match self {
            Offer::Any => true,
            Offer::Faction(f) => !pickers.is_empty() && pickers.iter().all(|p| p.faction == f),
        }
    }
}

pub const fn is_interactive(id: CardId) -> bool {
    let mut i = 0;
    while i < INTERACTIVE.len() {
        if INTERACTIVE[i] as u8 == id as u8 {
            return true;
        }
        i += 1;
    }
    false
}

/// Source `conditionalPool`: live conditionals a picker's base unlocks and not every picker holds, in catalog order.
/// The legacy card table's; a world reads its own (`k.cards.conditional_pool`, `cards::Tuning`).
pub fn conditional_pool(pickers: &[Build]) -> Vec<CardId> {
    crate::cards::Tuning::legacy().conditional_pool(pickers)
}

/// Source `rewardAugmentPool`: live interactive augments not held by every picker, in catalog order. The legacy card
/// table's; a world reads its own (`k.cards.augment_pool`, `cards::Tuning`).
pub fn augment_pool(pickers: &[Build]) -> Vec<CardId> {
    crate::cards::Tuning::legacy().augment_pool(pickers)
}

/// Source `ZONE_AUGMENT_THEMES`.
pub const fn zone_theme(zone: FactionId) -> &'static [CardId] {
    match zone {
        FactionId::Fire => &[CardId::SlowBurn, CardId::Hemorrhage, CardId::Overkill],
        FactionId::Sentenced => &[
            CardId::PlantYourFeet,
            CardId::WishfulThinking,
            CardId::Overkill,
        ],
        FactionId::Plague => &[
            CardId::Hemorrhage,
            CardId::Siphon,
            CardId::ThirdTimesTheCharm,
        ],
        FactionId::Frost => &[CardId::PocketSand, CardId::BestOffense, CardId::TankEngine],
        FactionId::Holy => &[
            CardId::SecondWind,
            CardId::Siphon,
            CardId::EyeForAnEye,
            CardId::SpikedShell,
        ],
    }
}

fn tier_for(draw: &mut impl FnMut() -> f64, odds: [f64; 3]) -> u8 {
    let r = draw() * (odds[0] + odds[1] + odds[2]);
    if r < odds[0] {
        1
    } else if r < odds[0] + odds[1] {
        2
    } else {
        3
    }
}

fn tier_order(want: u8) -> [u8; 3] {
    let mut tiers = [1u8, 2, 3];
    tiers.sort_by_key(|t| ((*t as i32 - want as i32).abs(), *t));
    tiers
}

fn pick_in(draw: &mut impl FnMut() -> f64, pool: &[CardId]) -> CardId {
    let i = (draw() * pool.len() as f64).floor() as usize;
    pool[i.min(pool.len() - 1)]
}

/// Source `pickTiered`: one tier draw, then one index draw from the nearest non-empty tier (lower first on a tie).
pub fn pick_tiered(
    draw: &mut impl FnMut() -> f64,
    pool: &[CardId],
    odds: [f64; 3],
) -> Option<CardId> {
    if pool.is_empty() {
        return None;
    }
    let want = tier_for(draw, odds);
    for tier in tier_order(want) {
        let matching: Vec<CardId> = pool
            .iter()
            .copied()
            .filter(|id| id.tier() == tier)
            .collect();
        if !matching.is_empty() {
            return Some(pick_in(draw, &matching));
        }
    }
    None
}

/// Source `rollChestOptions`: up to three distinct picks, the first from the zone theme when it intersects the pool.
pub fn roll_with(
    draw: &mut impl FnMut() -> f64,
    pool: &[CardId],
    elite: bool,
    zone: Option<FactionId>,
) -> Vec<CardId> {
    let odds = if elite {
        crate::reward_chests::DEFINITION.tier_weights[1]
    } else {
        crate::reward_chests::DEFINITION.tier_weights[0]
    };
    let mut out = Vec::with_capacity(3);
    let theme: Vec<CardId> = zone
        .map(|z| {
            zone_theme(z)
                .iter()
                .copied()
                .filter(|id| pool.contains(id))
                .collect()
        })
        .unwrap_or_default();
    if let Some(first) = pick_tiered(draw, if theme.is_empty() { pool } else { &theme }, odds) {
        out.push(first);
    }
    while out.len() < 3 && !pool.is_empty() {
        let available: Vec<CardId> = pool
            .iter()
            .copied()
            .filter(|id| !out.contains(id))
            .collect();
        let Some(pick) = pick_tiered(draw, &available, odds) else {
            break;
        };
        out.push(pick);
    }
    out
}
