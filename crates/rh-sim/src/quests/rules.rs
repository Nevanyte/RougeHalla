//! Source `shared/quests.ts` reward rules and wording: the time-parity formulas, the reward card's feed brake, the
//! zone-matched mob-stat stack payout, the quest log's fixed wording and the accept/refusal phrases. Pure functions over
//! the registered catalog and the registered mob rewards.
use super::catalog::{Def, Kind};
use crate::cards::{BaseStatId, CardId};
use crate::constants::*;
use crate::mob_catalog::MobTypeId;
use crate::modifiers::farm::{self, RewardStat};
use crate::stat_fold::{EffectStat, FlatStat};

/// Source `QUEST_ITEM_PREFIX` (a durable id prefix, not a gameplay number).
pub const QUEST_ITEM_PREFIX: &str = "quest:";

/// Source `QUEST_REFUSAL`: the five refusals a quest accept can produce, in source order.
pub const REFUSAL: [(&str, &str); 5] = [
    ("busy", "Can't do that now"),
    ("far", "Too far away"),
    ("blocked", "Can't reach that"),
    ("over", "That quest is over"),
    ("already", "You already accepted that quest"),
];

pub const REFUSAL_BUSY: &str = "Can't do that now";
pub const REFUSAL_FAR: &str = "Too far away";
pub const REFUSAL_BLOCKED: &str = "Can't reach that";
pub const REFUSAL_OVER: &str = "That quest is over";
pub const REFUSAL_ALREADY: &str = "You already accepted that quest";

/// Source `questTierPoints`: tier points a quest taking (objSec + 40% of travel) should pay.
pub fn tier_points(def: &Def) -> f64 {
    ((def.obj_sec + TRAVEL_RATE_SHARE * def.travel_sec) / CAMP_SECONDS)
        * CARD_TIER_RATE
        * STACK_PREMIUM
}

/// Source `parityGv`: GV the same quest should pay for time parity.
pub fn parity_gv(def: &Def) -> f64 {
    def.obj_sec * FARM_GV_RATE + def.travel_sec * FARM_GV_RATE * TRAVEL_RATE_SHARE
}

/// Source `questTier`: the nominal card tier (1-3), at most 1 for the player-kill offer.
pub fn tier(def: &Def) -> u8 {
    if def.players {
        return 1;
    }
    let points = tier_points(def);
    // JS Math.round: floor(x + 0.5) for the non-negative finite points here.
    let rounded = (points + 0.5).floor();
    rounded.clamp(1., 3.) as u8
}

/// The catalog card's historical tier digit (source `def.reward.card.slice(base.length)`).
pub fn reward_card_tier(def: &Def) -> u8 {
    (def.reward_card
        .as_str()
        .as_bytes()
        .last()
        .copied()
        .unwrap_or(b'1')
        - b'0')
        .clamp(1, 3)
}

/// The card's base stat (source `questBase` / `cardDef(...).base`).
pub fn base(def: &Def) -> BaseStatId {
    def.reward_card
        .definition()
        .base
        .expect("every quest reward card is a base card")
}

/// `cardFor(base, tier)`: the catalog card with that base and tier (all 24 exist; P-CARDS-1 ported the full catalog).
fn card_for(base: BaseStatId, tier: u8) -> CardId {
    CardId::ALL
        .into_iter()
        .find(|c| {
            let d = c.definition();
            d.base == Some(base) && d.tier == tier
        })
        .expect("every base stat has all three catalog tiers")
}

/// Source `rewardCurve`: the mob reward multiplier at a feed value.
pub fn reward_curve(feed: f64) -> f64 {
    MOB_REWARD_FLOOR
        + (1. - MOB_REWARD_FLOOR)
            * (1. - 1. / (1. + crate::math::exp(-(feed - MOB_REWARD_MID) / MOB_REWARD_WIDTH)))
}

/// Source `questRewardCard`: the quest's nominal card, one tier lower once the mob reward curve at the player's feed falls
/// below `QUEST_FEED_BRAKE`.
pub fn reward_card(def: &Def, feed: f64) -> CardId {
    let tier = reward_card_tier(def);
    let lowered = if reward_curve(feed) < QUEST_FEED_BRAKE {
        tier.saturating_sub(1).max(1)
    } else {
        tier
    };
    card_for(base(def), lowered)
}

/// Source `questRewardCopies`.
pub fn reward_copies(def: &Def) -> u8 {
    def.reward_copies
}

fn zone_rows(def: &Def) -> Vec<farm::Reward> {
    farm::DEFINITION
        .rows
        .into_iter()
        .filter(|r| {
            crate::mob_catalog::mob_type_by_id(r.mob.as_str())
                .is_some_and(|m| m.zone == def.far_zone && !m.elite)
        })
        .collect()
}

fn wanted_stat(base: BaseStatId) -> RewardStat {
    match base {
        BaseStatId::Ad => RewardStat::Stat(EffectStat::Damage),
        BaseStatId::Ap => RewardStat::Flat(FlatStat::Ap),
        BaseStatId::Haste => RewardStat::Stat(EffectStat::AttackSpeed),
        BaseStatId::Vitality => RewardStat::Stat(EffectStat::MaxHp),
        BaseStatId::Armor => RewardStat::Flat(FlatStat::Armor),
        BaseStatId::Mr => RewardStat::Flat(FlatStat::Shield),
        BaseStatId::Leech => RewardStat::Stat(EffectStat::Lifesteal),
        BaseStatId::Fleet => RewardStat::Stat(EffectStat::MoveSpeed),
    }
}

/// Source `questRewardStats`: the zone's normal-mob stat row matched to the reward card's base, and the time-based stack
/// payout (10-20 stacks, independent of feed).
pub fn reward_stats(def: &Def) -> (MobTypeId, u64) {
    let wanted = wanted_stat(base(def));
    let rows = zone_rows(def);
    let row = rows
        .iter()
        .find(|r| r.stat == wanted)
        .or_else(|| rows.first())
        .copied()
        .expect("every faction zone has normal mob reward rows");
    let farm_equivalent = (def.obj_sec + def.travel_sec * TRAVEL_RATE_SHARE) / FARM_SECONDS_PER_MOB;
    let stacks = (farm_equivalent * QUEST_STAT_STACKS_PER_FARM_EQUIVALENT).ceil();
    let stacks = stacks.clamp(
        f64::from(QUEST_MIN_STAT_STACKS),
        f64::from(QUEST_MAX_STAT_STACKS),
    );
    (row.mob, stacks as u64)
}

/// Source `mobStatText`: the cumulative bonus for one mob type and stack count, in player-facing stat units.
pub fn mob_stat_text(id: MobTypeId, count: u64) -> String {
    let Some(row) = farm::DEFINITION.rows.into_iter().find(|r| r.mob == id) else {
        return String::new();
    };
    let amount = match row.stat {
        RewardStat::Stat(_) => format!("{}%", js_locale(row.value * count as f64 * 100.)),
        RewardStat::Flat(_) => js_number(row.value * count as f64),
    };
    format!("+{amount} {}", suffix(row.stat))
}

fn suffix(stat: RewardStat) -> &'static str {
    match stat {
        RewardStat::Stat(EffectStat::Damage) => "damage",
        RewardStat::Stat(EffectStat::MoveSpeed) => "move speed",
        RewardStat::Stat(EffectStat::MaxHp) => "max health",
        RewardStat::Stat(EffectStat::AttackSpeed) => "attack speed",
        RewardStat::Stat(EffectStat::Lifesteal) => "lifesteal",
        RewardStat::Flat(FlatStat::Armor) => "Defense",
        RewardStat::Flat(FlatStat::Shield) => "Soul Defense",
        RewardStat::Flat(FlatStat::Ad) => "Offense",
        RewardStat::Flat(FlatStat::Ap) => "Soul Offence",
        _ => "stat",
    }
}

/// Source `questRewardText`: fixed reward wording for the quest log and planning screen (all advertised stacks are
/// granted).
pub fn reward_text(def: &Def) -> String {
    let (id, stacks) = reward_stats(def);
    let name = crate::mob_catalog::mob_type_by_id(id.as_str()).map_or("mob", |m| m.name);
    format!(
        "{stacks} {name} stacks ({}) and {} GV",
        mob_stat_text(id, stacks),
        def.reward_gv
    )
}

/// Source `questAcceptedText`.
pub fn accepted_text(def: &Def) -> String {
    format!("Quest accepted: {}", def.name)
}

/// Source `questAcceptFirstText`.
pub fn accept_first_text(def: &Def) -> String {
    format!("Accept {} at {} first", def.name, def.giver)
}

/// JS `Number.prototype.toLocaleString("en-US", {maximumFractionDigits: 2})` for the reward wording: exact binary
/// rounding to two decimals, trailing zeros trimmed, and thousands grouping.
pub fn js_locale(value: f64) -> String {
    let fixed = crate::kill_augments::js_to_fixed(value, 2);
    let (sign, body) = match fixed.strip_prefix('-') {
        Some(rest) => ("-", rest.to_string()),
        None => ("", fixed),
    };
    let (integer, fraction) = match body.split_once('.') {
        Some((i, f)) => (i.to_string(), f.trim_end_matches('0').to_string()),
        None => (body, String::new()),
    };
    let mut grouped = String::new();
    for (i, ch) in integer.chars().enumerate() {
        if i > 0 && (integer.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    if fraction.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{fraction}")
    }
}

/// JS number-to-string for the flat reward amount (the values are quarter increments, whose shortest form is stable).
pub fn js_number(value: f64) -> String {
    if value.fract() == 0. && value.abs() < 1e21 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

/// The closed reward model the catalog row describes (used by the evidence/tests): card, copies, GV, stat payout.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reward {
    pub card: CardId,
    pub copies: u8,
    pub gv: u16,
    pub stat: MobTypeId,
    pub stacks: u64,
}
pub fn reward(def: &Def, feed: f64) -> Reward {
    let (stat, stacks) = reward_stats(def);
    Reward {
        card: reward_card(def, feed),
        copies: reward_copies(def),
        gv: def.reward_gv,
        stat,
        stacks,
    }
}

/// The quest's verb kind, for the selection test.
pub fn kind(def: &Def) -> Kind {
    def.kind
}
