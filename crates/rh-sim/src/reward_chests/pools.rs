//! The source reward pools and the exact tiered draw protocol (P-CARDS-1).
//!
//! Source: `packages/shared/src/rewards.ts` — `conditionalPool`, `rewardAugmentPool`, `pickTiered`, `rollChestOptions`
//! and `ZONE_AUGMENT_THEMES` — with the interactive augment set from `cards.ts` (`INTERACTIVE_AUGMENT_IDS`). A draw is a
//! unit double, as the source `Rng` is; the callers supply the stream (production: the reward RNG, tests: the frozen tape).
use crate::cards::{Build, CardId, CardKind};
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

fn owned_base(build: &Build, base: crate::cards::BaseStatId) -> bool {
    build.cards().any(|id| id.definition().base == Some(base))
}

fn held_by_all(pickers: &[Build], id: CardId) -> bool {
    !pickers.is_empty() && pickers.iter().all(|b| b.owns(id))
}

/// Source `conditionalPool`: live conditionals a picker's base unlocks and not every picker holds, in catalog order.
pub fn conditional_pool(pickers: &[Build]) -> Vec<CardId> {
    CardId::ALL
        .into_iter()
        .filter(|id| {
            let def = id.definition();
            def.kind == CardKind::Conditional
                && def.ready
                && def
                    .requires
                    .is_some_and(|base| pickers.iter().any(|b| owned_base(b, base)))
                && !held_by_all(pickers, *id)
        })
        .collect()
}

/// Source `rewardAugmentPool`: live interactive augments not held by every picker, in catalog order.
pub fn augment_pool(pickers: &[Build]) -> Vec<CardId> {
    CardId::ALL
        .into_iter()
        .filter(|id| {
            let def = id.definition();
            def.kind == CardKind::Augment
                && def.ready
                && is_interactive(*id)
                && !held_by_all(pickers, *id)
        })
        .collect()
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
