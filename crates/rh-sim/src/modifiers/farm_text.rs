//! Shared source mob-stat notice formatting; no progression or reward decisions.
use crate::mob_catalog::{mob_type_by_id, MobTypeId};
use crate::stat_fold::{EffectStat, FlatStat};
/// Legacy \`mobStatText\`: the cumulative player-facing bonus for one type and stack count.
pub(crate) fn stat_text(id: MobTypeId, stacks: u64) -> String {
    let Some(reward) = crate::modifiers::farm::Farm::reward_of(id) else {
        return String::new();
    };
    let n = stacks as f64;
    match reward.stat {
        crate::modifiers::farm::RewardStat::Stat(stat) => {
            let label = match stat {
                EffectStat::Damage => "damage",
                EffectStat::MoveSpeed => "move speed",
                EffectStat::MaxHp => "max health",
                EffectStat::AttackSpeed => "attack speed",
                EffectStat::Lifesteal => "lifesteal",
                _ => "stat",
            };
            format!("+{}% {label}", one(reward.value * n * 100.))
        }
        crate::modifiers::farm::RewardStat::Flat(flat) => {
            let label = match flat {
                FlatStat::Ap => "Soul Offence",
                FlatStat::Armor => "Defense",
                FlatStat::Shield => "Soul Defense",
                FlatStat::Ad => "Offense",
            };
            format!("+{} {label}", one(reward.value * n))
        }
    }
}

/// Legacy `toLocaleString("en-US", {maximumFractionDigits: 2})`: grouped thousands, at most two decimals (trailing
/// zeros trimmed).
fn one(n: f64) -> String {
    let mut s = format!("{n:.2}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.pop();
    }
    let (sign, digits) = match s.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", s.as_str()),
    };
    let (int_part, frac) = match digits.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (digits, None),
    };
    let mut grouped = String::with_capacity(s.len() + int_part.len() / 3);
    for (i, ch) in int_part.chars().enumerate() {
        if i > 0 && (int_part.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    match frac {
        Some(frac) => format!("{sign}{grouped}.{frac}"),
        None => format!("{sign}{grouped}"),
    }
}

pub(crate) fn mob_name(id: MobTypeId) -> &'static str {
    mob_type_by_id(id.as_str()).map_or("", |d| d.name)
}
