//! Source `shared/traders.ts` and `server/src/sim/traders.ts`: the neutral traders (a wandering barter villager and a Soul
//! Broker stat trader), their placement/wandering, the per-run stat-exchange offers and the trade action.
//!
//! Native slice choices, recorded in `docs/evidence/stage2-trade-1/README.md`: the two traders are native world actors
//! (kind/name/position/walker state) and the trade action runs through the C-INPUT door; the client wire message stays
//! coordinator-owned (no protocol bump) and the source toasts are presentation-only, so refusals are observable by their
//! state effect only. Traders are enabled with the live-content config switch (`config.quests`, the same live-module family)
//! so the capture/parity worlds match the source's always-installed traders while the pure combat corpora keep their
//! recorded reward streams.
mod notices;
pub(crate) mod runtime;
mod trade_view;
pub(crate) use trade_view::project_into as trade_view_into;
pub use trade_view::{MerchantView, TradeView, ViewError};
#[cfg(test)]
mod view_tests;

// Weapon display names are durable client labels, part of the traders content table.
pub(crate) fn weapon_name(weapon: crate::content::WeaponId) -> &'static str {
    match weapon {
        crate::content::WeaponId::Sword => "Sword",
        crate::content::WeaponId::Bow => "Bow",
        crate::content::WeaponId::Wand => "Wand",
        crate::content::WeaponId::Shield => "Shield",
        crate::content::WeaponId::Axe => "Axe",
        crate::content::WeaponId::Fists => "Fists",
    }
}

/// Source `TraderKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Kind {
    Barter,
    Stats,
}
impl Kind {
    pub const ALL: [Self; 2] = [Self::Barter, Self::Stats];
    pub const fn index(self) -> usize {
        self as usize
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Barter => "barter",
            Self::Stats => "stats",
        }
    }
    pub const fn name(self) -> &'static str {
        match self {
            Self::Barter => "Wandering Villager",
            Self::Stats => "Soul Broker",
        }
    }
    pub const fn id(self) -> &'static str {
        match self {
            Self::Barter => "trader-barter",
            Self::Stats => "trader-stats",
        }
    }
    pub fn from_code(code: u8) -> Option<Self> {
        Self::ALL.get(code as usize).copied()
    }
}

/// Source `TRADE_STATS` order.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum Stat {
    MaxHp,
    Ad,
    Ap,
    AttackSpeed,
    MoveSpeed,
    Armor,
    Shield,
}
impl Stat {
    pub const ALL: [Self; 7] = [
        Self::MaxHp,
        Self::Ad,
        Self::Ap,
        Self::AttackSpeed,
        Self::MoveSpeed,
        Self::Armor,
        Self::Shield,
    ];
    pub const fn index(self) -> usize {
        self as usize
    }
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MaxHp => "maxHp",
            Self::Ad => "ad",
            Self::Ap => "ap",
            Self::AttackSpeed => "attackSpeed",
            Self::MoveSpeed => "moveSpeed",
            Self::Armor => "armor",
            Self::Shield => "shield",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == value)
    }
    pub const fn name(self) -> &'static str {
        match self {
            Self::MaxHp => "max HP",
            Self::Ad => "Offense",
            Self::Ap => "Soul Offence",
            Self::AttackSpeed => "attack speed",
            Self::MoveSpeed => "movement speed",
            Self::Armor => "Defense",
            Self::Shield => "Soul Defense",
        }
    }
    pub const fn flat(self) -> bool {
        matches!(self, Self::Ad | Self::Ap | Self::Armor | Self::Shield)
    }
}

/// Source `StatTrade`: the stored offer (the source keeps its JSON text on the player; the sim keeps the parsed form and
/// renders the source JSON for observations/tests).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StatTrade {
    pub cost: Stat,
    pub cost_value: f64,
    pub gain: Stat,
    pub gain_value: f64,
    pub label: String,
}
impl StatTrade {
    /// Source `parseStatTrade`: a closed stat pair (different), positive finite amounts and a string label.
    pub fn valid(&self) -> bool {
        self.cost != self.gain
            && self.cost_value.is_finite()
            && self.cost_value > 0.
            && self.gain_value.is_finite()
            && self.gain_value > 0.
    }
}

/// Source `tradeEffects`: the farm rows a player's trade stats fold as (flats keep their Effect stat, the rest a stat).
pub(crate) fn trade_effects(
    stats: &[(Stat, f64)],
) -> ([crate::stat_fold::EffectRow<'static>; 7], usize) {
    use crate::stat_fold::{EffectKind, EffectRow, EffectStat, FlatStat};
    let mut rows = [EffectRow::new(EffectKind::Trigger); 7];
    let mut n = 0;
    for (stat, value) in stats {
        if !value.is_finite() || *value == 0. {
            continue;
        }
        rows[n].kind = match stat {
            Stat::Ad => EffectKind::Flat {
                stat: FlatStat::Ad,
                v: *value,
            },
            Stat::Ap => EffectKind::Flat {
                stat: FlatStat::Ap,
                v: *value,
            },
            Stat::Armor => EffectKind::Flat {
                stat: FlatStat::Armor,
                v: *value,
            },
            Stat::Shield => EffectKind::Flat {
                stat: FlatStat::Shield,
                v: *value,
            },
            Stat::MaxHp => EffectKind::Stat {
                stat: EffectStat::MaxHp,
                v: *value,
            },
            Stat::AttackSpeed => EffectKind::Stat {
                stat: EffectStat::AttackSpeed,
                v: *value,
            },
            Stat::MoveSpeed => EffectKind::Stat {
                stat: EffectStat::MoveSpeed,
                v: *value,
            },
        };
        n += 1;
    }
    (rows, n)
}

/// Source `barterWeapons`: the villager's stable counter-cycle around the held weapon (a weapon id, or -1 when empty).
pub fn barter_weapons(held: Option<crate::content::WeaponId>) -> [crate::content::WeaponId; 2] {
    let ids = crate::content::WeaponId::ALL;
    let i = held
        .and_then(|held| ids.iter().position(|w| *w == held))
        .map_or(-1, |i| i as i64);
    let n = ids.len() as i64;
    let next = ids[((i + 1).rem_euclid(n)) as usize];
    let second = ids[((i + 2).rem_euclid(n)) as usize];
    [next, second]
}

/// Source `barterLabels`.
pub fn barter_labels(held: Option<crate::content::WeaponId>) -> [String; 3] {
    let [first, second] = barter_weapons(held);
    let name = held.map_or("held weapon", weapon_name);
    [
        format!("Give {name} → {}", weapon_name(first)),
        format!("Give {name} → small healing potion"),
        format!("Give a small healing potion → {}", weapon_name(second)),
    ]
}

/// Source `RollStatTrades`: three offers from the player's current effective stats, quoted and fixed once rolled.
pub fn roll_stat_trades(
    p: &crate::state::Player,
    random: &mut impl FnMut() -> f64,
) -> Vec<StatTrade> {
    use crate::constants::{
        TRADE_AP_DIVISOR_FLOOR, TRADE_COST_MIN_FLAT, TRADE_COST_MIN_PCT, TRADE_COST_SHARE,
        TRADE_FLAT_SCALE, TRADE_GAIN_FLAT_FLOOR, TRADE_GAIN_SHARE, TRADE_OFFER_COUNT,
        TRADE_PCT_SCALE,
    };
    let faction = crate::content::faction(p.faction());
    let m = p.modifiers.mirrors();
    let base_hp = faction.hp;
    let mult_of_ap = p.modifiers.mult_of(crate::stat_fold::MultKey::Ap);
    let current = |stat: Stat| -> f64 {
        match stat {
            Stat::MaxHp => p.vitals.max_hp / base_hp.max(1.),
            Stat::Ad => m.ad_bonus.max(0.),
            Stat::Ap => m.ap_bonus.max(0.),
            Stat::AttackSpeed => m.as_mult,
            Stat::MoveSpeed => m.speed_mult,
            Stat::Armor => (faction.armor + m.armor_bonus).max(0.),
            Stat::Shield => (faction.shield + m.shield_bonus).max(0.),
        }
    };
    let mut shuffled = |items: &mut Vec<Stat>| {
        for i in (1..items.len()).rev() {
            let j = (random() * (i + 1) as f64).floor() as usize;
            items.swap(i, j);
        }
    };
    let mut costs: Vec<Stat> = Stat::ALL
        .into_iter()
        .filter(|stat| {
            current(*stat)
                > if stat.flat() {
                    TRADE_COST_MIN_FLAT
                } else {
                    TRADE_COST_MIN_PCT
                }
        })
        .collect();
    shuffled(&mut costs);
    let rounded = |value: f64, stat: Stat| -> f64 {
        let scale = if stat.flat() {
            TRADE_FLAT_SCALE
        } else {
            TRADE_PCT_SCALE
        };
        (value * scale).round() / scale
    };
    let ap_divisor = |stat: Stat, value: f64| -> f64 {
        if stat == Stat::Ap {
            value / mult_of_ap.max(TRADE_AP_DIVISOR_FLOOR)
        } else {
            value
        }
    };
    let quote = |value: f64, stat: Stat| -> String {
        if stat.flat() {
            format!("{value}")
        } else {
            format!("{}%", (value * 100.).round())
        }
    };
    let shown = |value: f64, stat: Stat| -> String {
        if stat == Stat::MaxHp {
            format!("{}", (value * base_hp).round())
        } else {
            quote(rounded(value, stat), stat)
        }
    };
    let mut out = Vec::with_capacity(TRADE_OFFER_COUNT as usize);
    for cost in costs.into_iter().take(TRADE_OFFER_COUNT as usize) {
        let mut gains: Vec<Stat> = Stat::ALL.into_iter().filter(|s| *s != cost).collect();
        shuffled(&mut gains);
        let gain = gains[0];
        let cost_raw = current(cost) * TRADE_COST_SHARE;
        let gain_raw = current(gain).max(if gain.flat() {
            TRADE_GAIN_FLAT_FLOOR
        } else {
            1.
        }) * TRADE_GAIN_SHARE;
        out.push(StatTrade {
            cost,
            cost_value: rounded(ap_divisor(cost, cost_raw), cost),
            gain,
            gain_value: rounded(ap_divisor(gain, gain_raw), gain),
            label: format!(
                "−{} {} → +{} {}",
                shown(cost_raw, cost),
                cost.name(),
                shown(gain_raw, gain),
                gain.name()
            ),
        });
    }
    out
}

/// Source `TradersRuntime`: the two trader actors (with their walker state), the barter cooldown per player and the
/// installation-time destination grid.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Traders {
    pub traders: Vec<Trader>,
    pub destinations: Vec<crate::math::Vec2>,
    pub barter_at: Vec<(crate::PlayerId, f64)>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trader {
    pub kind: Kind,
    pub at: crate::math::Vec2,
    pub path: Vec<crate::math::Vec2>,
    pub next_walk_at: f64,
}
pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    word(Kind::ALL.len() as u64);
    for kind in Kind::ALL {
        for text in [kind.as_str(), kind.name(), kind.id()] {
            word(text.len() as u64);
            for b in text.bytes() {
                word(u64::from(b));
            }
        }
    }
    word(Stat::ALL.len() as u64);
    for stat in Stat::ALL {
        for text in [stat.as_str(), stat.name()] {
            word(text.len() as u64);
            for b in text.bytes() {
                word(u64::from(b));
            }
        }
        word(u64::from(stat.flat()));
    }
}

#[cfg(test)]
mod tests;
