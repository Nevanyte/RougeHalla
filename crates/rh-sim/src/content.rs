//! Content tables of the slice: the faction sheet, the weapon catalog and the damage law, copied from the legacy
//! `packages/shared/src/factions.ts` and `weapons.ts` at the tested revision. Content is versioned by [`content_hash`]: a
//! server and a client (or a replay) with different hashes are running different rules and must not be mixed.

use crate::constants::*;
use crate::math::{exp, PI};

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum FactionId {
    Fire,
    Sentenced,
    Plague,
    Frost,
    Holy,
}

impl FactionId {
    pub const ALL: [FactionId; 5] = [
        FactionId::Fire,
        FactionId::Sentenced,
        FactionId::Plague,
        FactionId::Frost,
        FactionId::Holy,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            FactionId::Fire => "fire",
            FactionId::Sentenced => "sentenced",
            FactionId::Plague => "plague",
            FactionId::Frost => "frost",
            FactionId::Holy => "holy",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|f| f.as_str() == s)
    }
    /// Wire code (index in [`FactionId::ALL`]; append only).
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn from_code(c: u8) -> Option<Self> {
        Self::ALL.get(c as usize).copied()
    }
    /// Legacy `defaultFaction`: round robin over join order.
    pub fn default_for(join_index: usize) -> Self {
        Self::ALL[join_index % Self::ALL.len()]
    }
}

/// The sheet numbers the slice reads (signature params are out of the slice: docs/backlog).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FactionSpec {
    pub hp: f64,
    pub rate: f64,
    pub hit: f64,
    pub phys: f64,
    pub true_share: f64,
    pub armor: f64,
    pub shield: f64,
}

pub fn faction(id: FactionId) -> FactionSpec {
    match id {
        FactionId::Fire => FactionSpec {
            hp: 950.0,
            rate: 0.6,
            hit: 85.2,
            phys: 0.0,
            true_share: 0.0,
            armor: 20.0,
            shield: 20.0,
        },
        FactionId::Sentenced => FactionSpec {
            hp: 1085.0,
            rate: 0.95,
            hit: 72.1,
            phys: 0.4,
            true_share: 0.0,
            armor: 94.0,
            shield: 94.0,
        },
        FactionId::Plague => FactionSpec {
            hp: 1020.0,
            rate: 1.85,
            hit: 28.7,
            phys: 0.8,
            true_share: 0.0,
            armor: 77.0,
            shield: 77.0,
        },
        FactionId::Frost => FactionSpec {
            hp: 985.0,
            rate: 0.45,
            hit: 168.2,
            phys: 0.9,
            true_share: 0.0,
            armor: 116.0,
            shield: 116.0,
        },
        FactionId::Holy => FactionSpec {
            hp: 1145.0,
            rate: 0.95,
            hit: 92.2,
            phys: 1.0,
            true_share: 0.0,
            armor: 78.0,
            shield: 78.0,
        },
    }
}

/// The faction as fought (legacy `pacedFaction`): the hit times DUEL_PACE, hp unchanged.
pub fn paced(id: FactionId) -> FactionSpec {
    let f = faction(id);
    FactionSpec {
        hit: f.hit * DUEL_PACE,
        ..f
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DamageShares {
    pub phys: f64,
    pub magic: f64,
    pub true_: f64,
}

pub fn magic_share(f: &FactionSpec) -> f64 {
    (1.0 - f.phys - f.true_share).max(0.0)
}

pub fn damage_shares(f: &FactionSpec) -> DamageShares {
    DamageShares {
        phys: f.phys,
        magic: magic_share(f),
        true_: f.true_share,
    }
}

/// The damage law for a hit split into shares (legacy `mitigateShares`).
pub fn mitigate_shares(raw: f64, s: &DamageShares, armor: f64, shield: f64) -> f64 {
    raw * (s.phys / (1.0 + armor / 100.0) + s.magic / (1.0 + shield / 100.0) + s.true_)
}

/// PvP outgoing multiplier for card power `p` (legacy `pvpFactor`).
pub fn pvp_factor(power: f64) -> f64 {
    let p = if power > 0.0 { power } else { 0.0 };
    PVP_F0 + (PVP_FMAX - PVP_F0) * (1.0 - exp(-p / PVP_P0))
}

/// Legacy `bountyFor`: GV a player kill pays on top once the victim has more than BOUNTY_FREE_KILLS player kills.
pub fn bounty_for(player_kills: i64) -> u32 {
    let over = player_kills - BOUNTY_FREE_KILLS;
    if over > 0 {
        crate::math::js_round(BOUNTY_SCALE * crate::math::pow(over as f64, BOUNTY_EXPONENT)) as u32
    } else {
        0
    }
}

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum WeaponId {
    Sword,
    Bow,
    Wand,
    Shield,
    Axe,
    Fists,
}

impl WeaponId {
    /// Wire order of `ALL_WEAPON_IDS` (legacy): the five loop weapons, then fists. Append only.
    pub const ALL: [WeaponId; 6] = [
        WeaponId::Sword,
        WeaponId::Bow,
        WeaponId::Wand,
        WeaponId::Shield,
        WeaponId::Axe,
        WeaponId::Fists,
    ];
    pub fn as_str(self) -> &'static str {
        match self {
            WeaponId::Sword => "sword",
            WeaponId::Bow => "bow",
            WeaponId::Wand => "wand",
            WeaponId::Shield => "shield",
            WeaponId::Axe => "axe",
            WeaponId::Fists => "fists",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|w| w.as_str() == s)
    }
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn from_code(c: u8) -> Option<Self> {
        Self::ALL.get(c as usize).copied()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    Arc { reach: f64, half_arc: f64 },
    Projectile { speed: f64, range: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeaponSpec {
    pub boost: f64,
    pub floor: f64,
    pub dps_mult: f64,
    pub shape: Shape,
}

pub fn weapon(id: WeaponId) -> WeaponSpec {
    match id {
        WeaponId::Sword => WeaponSpec {
            boost: 1.15,
            floor: 0.25,
            dps_mult: 0.75,
            shape: Shape::Arc {
                reach: 112.0,
                half_arc: PI / 4.0,
            },
        },
        WeaponId::Bow => WeaponSpec {
            boost: 0.95,
            floor: 0.25,
            dps_mult: 0.8,
            shape: Shape::Projectile {
                speed: 900.0,
                range: 520.0,
            },
        },
        WeaponId::Wand => WeaponSpec {
            boost: 0.65,
            floor: 0.3,
            dps_mult: 0.8,
            shape: Shape::Projectile {
                speed: 380.0,
                range: 640.0,
            },
        },
        WeaponId::Shield => WeaponSpec {
            boost: 0.6,
            floor: 0.3,
            dps_mult: 0.75,
            shape: Shape::Arc {
                reach: 96.0,
                half_arc: PI / 3.0,
            },
        },
        WeaponId::Axe => WeaponSpec {
            boost: 0.4,
            floor: 0.35,
            dps_mult: 0.77,
            shape: Shape::Arc {
                reach: 112.0,
                half_arc: PI / 2.0,
            },
        },
        WeaponId::Fists => WeaponSpec {
            boost: 1.5,
            floor: 0.2,
            dps_mult: 0.6,
            shape: Shape::Arc {
                reach: 72.0,
                half_arc: PI / 3.0,
            },
        },
    }
}

/// Seconds between attacks (legacy `attackInterval`).
pub fn attack_interval(f: &FactionSpec, w: WeaponId, as_mult: f64) -> f64 {
    let s = weapon(w);
    s.floor.max(1.0 / (f.rate * (1.0 + s.boost) * as_mult))
}

/// Raw damage of one hit before mitigation (legacy `damagePerHit`).
pub fn damage_per_hit(f: &FactionSpec, w: WeaponId, as_mult: f64) -> f64 {
    f.rate * f.hit * weapon(w).dps_mult * as_mult * attack_interval(f, w, as_mult)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timings {
    pub interval: f64,
    pub windup: f64,
    pub root: f64,
    pub ranged: bool,
}

/// Player timings (legacy `weaponTimings(w, interval, "player")`): player melee has no windup; bow and wand keep theirs.
/// The NPC profile (mob telegraphs) is not in the slice.
pub fn player_timings(w: WeaponId, interval: f64) -> Timings {
    let ranged = matches!(weapon(w).shape, Shape::Projectile { .. });
    let mut t = Timings {
        interval,
        windup: 0.0,
        root: 0.0,
        ranged,
    };
    match w {
        WeaponId::Bow => t.windup = 0.5f64.min(0.55 * interval),
        WeaponId::Wand => t.windup = 0.45f64.min(0.5 * interval),
        _ => {}
    }
    t
}

/// Identity of the rules in this build: a 64-bit FNV-1a over every content number above, in a fixed order. Sent in the
/// protocol's Welcome and recorded in replays.
pub fn content_hash() -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |v: f64| {
        for b in v.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for f in FactionId::ALL {
        let s = faction(f);
        for v in [s.hp, s.rate, s.hit, s.phys, s.true_share, s.armor, s.shield] {
            eat(v);
        }
    }
    for w in WeaponId::ALL {
        let s = weapon(w);
        eat(s.boost);
        eat(s.floor);
        eat(s.dps_mult);
        match s.shape {
            Shape::Arc { reach, half_arc } => {
                eat(1.0);
                eat(reach);
                eat(half_arc);
            }
            Shape::Projectile { speed, range } => {
                eat(2.0);
                eat(speed);
                eat(range);
            }
        }
    }
    for v in [
        TICK_MS,
        MAX_REWIND_MS,
        TILE,
        PLAYER_RADIUS,
        PLAYER_SPEED,
        ATTACK_BUFFER_MS,
        DUEL_PACE,
        PVP_F0,
        PVP_FMAX,
        PVP_P0,
        PVP_HIT_CAP_SHARE,
        GV_KILL as f64,
        GV_WIN as f64,
        BOUNTY_SCALE,
        BOUNTY_EXPONENT,
        VISION_RADIUS,
    ] {
        eat(v);
    }
    h
}
