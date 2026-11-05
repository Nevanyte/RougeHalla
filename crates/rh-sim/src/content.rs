//! Content tables of the slice: the faction sheet, the weapon catalog and the damage law, copied from the legacy
//! `packages/shared/src/factions.ts` and `weapons.ts` at the tested revision. Content is versioned by [`content_hash`]: a
//! server and a client (or a replay) with different hashes are running different rules and must not be mixed.
//!
//! ## One registry, one rule
//!
//! Every gameplay number is declared once, as one line of the `content!` registry in [`crate::constants`] (name, type,
//! value, unit). That line is all a new tunable needs: it becomes the `pub const` the code uses and a row of
//! [`REGISTRY`], and [`content_hash`] folds the whole registry, so the rules identity cannot miss it. Rules that are code
//! rather than numbers are registered as data here (the faction and weapon tables, [`STAGGER_WEAPONS`], the player
//! windup formula's constants) and are folded too; the derived-value probes in [`content_hash`] additionally pin the
//! formulas (`attack_interval`, `damage_per_hit`, `pvp_factor`, `bounty_for`, `player_timings`) to their results.
//! `tests/content.rs` fails when a `const` appears anywhere in `crates/rh-sim/src` that is neither registered nor listed
//! (with a reason) as not gameplay, and when changing any single registry row leaves the hash unchanged.
//!
//! ## Durable ids (append only)
//!
//! The `as_str` spellings of [`FactionId`] and [`WeaponId`], and the cosmetic and achievement id strings the profile store
//! keeps, are DURABLE identifiers: they are jsonb keys and values in stored profiles (`winsByFaction`, `cosmetics`,
//! `achievements`) and in match records. Add new ones, never rename or reuse one. `crates/rh-server/tests/durable_ids.rs`
//! pins the strings and fails on any change.

use crate::constants::*;
pub use crate::constants::{ContentVal, Entry, REGISTRY};
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
        WeaponId::Bow => t.windup = BOW_WINDUP_MAX_S.min(BOW_WINDUP_INTERVAL_SHARE * interval),
        WeaponId::Wand => t.windup = WAND_WINDUP_MAX_S.min(WAND_WINDUP_INTERVAL_SHARE * interval),
        _ => {}
    }
    t
}

/// Weapons whose hits stagger the victim (legacy: the sword). A rule flag registered as data so the rules identity covers
/// it; the sim's stagger check still compares against `WeaponId::Sword` directly until it is switched to read this table.
pub const STAGGER_WEAPONS: &[WeaponId] = &[WeaponId::Sword];

/// Whether a hit by `w` staggers (reads [`STAGGER_WEAPONS`]).
pub fn staggers(w: WeaponId) -> bool {
    STAGGER_WEAPONS.contains(&w)
}

/// FNV-1a over a byte stream; the only hasher of the rules identity.
struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn byte(&mut self, b: u8) {
        self.0 ^= b as u64;
        self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
    }
    fn u64(&mut self, v: u64) {
        for b in v.to_le_bytes() {
            self.byte(b);
        }
    }
    fn f64(&mut self, v: f64) {
        self.u64(v.to_bits());
    }
    /// Length-prefixed so that adjacent strings cannot run together.
    fn str(&mut self, s: &str) {
        self.u64(s.len() as u64);
        for b in s.bytes() {
            self.byte(b);
        }
    }
    fn val(&mut self, v: &ContentVal) {
        match *v {
            ContentVal::F64(x) => {
                self.byte(1);
                self.f64(x);
            }
            ContentVal::U64(x) => {
                self.byte(2);
                self.u64(x);
            }
            ContentVal::I64(x) => {
                self.byte(3);
                self.u64(x as u64);
            }
        }
    }
}

/// Identity of the rules in this build: a 64-bit FNV-1a over the whole content registry, the faction and weapon tables,
/// the rule flags and probes of the content formulas. Sent in the protocol's Welcome and recorded in replays.
pub fn content_hash() -> u64 {
    content_hash_of(REGISTRY)
}

/// [`content_hash`] with the registry rows given by the caller (the tables are always the build's own). Public so that
/// `tests/content.rs` can perturb any single row and require the hash to move.
pub fn content_hash_of(registry: &[Entry]) -> u64 {
    content_hash_of_rules(registry, STAGGER_WEAPONS)
}

/// [`content_hash_of`] with the stagger rule flag table given as well (for the perturbation tests).
pub fn content_hash_of_rules(registry: &[Entry], stagger_weapons: &[WeaponId]) -> u64 {
    content_hash_of_map_definition(
        registry,
        stagger_weapons,
        &crate::mapgen::coliseum::default_definition(),
    )
}

/// The map foundation's fixed geometry is content too. The same definition drives generation;
/// this entry point lets the identity tests perturb it without constructing a map.
pub fn content_hash_of_map_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::coliseum::FixedDefinition<'_>,
) -> u64 {
    let mut h = Fnv::new();

    h.str("registry");
    h.u64(registry.len() as u64);
    for e in registry {
        h.str(e.name);
        h.val(&e.val);
    }

    h.str("mapgen/coliseum/1");
    crate::mapgen::coliseum::visit_content(definition, |word| h.u64(word));

    h.str("factions");
    for f in FactionId::ALL {
        h.str(f.as_str());
        let s = faction(f);
        for v in [s.hp, s.rate, s.hit, s.phys, s.true_share, s.armor, s.shield] {
            h.f64(v);
        }
    }

    h.str("weapons");
    for w in WeaponId::ALL {
        h.str(w.as_str());
        let s = weapon(w);
        h.f64(s.boost);
        h.f64(s.floor);
        h.f64(s.dps_mult);
        match s.shape {
            Shape::Arc { reach, half_arc } => {
                h.byte(1);
                h.f64(reach);
                h.f64(half_arc);
            }
            Shape::Projectile { speed, range } => {
                h.byte(2);
                h.f64(speed);
                h.f64(range);
            }
        }
    }

    h.str("stagger");
    for w in WeaponId::ALL {
        h.byte(stagger_weapons.contains(&w) as u8);
    }

    // Probes: the content formulas are code, so their results are folded for fixed inputs. A formula edit that moves any
    // outcome moves the identity even when no registered number changed.
    h.str("probes");
    for f in FactionId::ALL {
        let spec = paced(f);
        for w in WeaponId::ALL {
            for as_mult in [1.0, 1.35] {
                let interval = attack_interval(&spec, w, as_mult);
                h.f64(interval);
                h.f64(damage_per_hit(&spec, w, as_mult));
                let t = player_timings(w, interval);
                h.f64(t.windup);
                h.f64(t.root);
                h.byte(t.ranged as u8);
            }
        }
        let shares = damage_shares(&spec);
        h.f64(mitigate_shares(100.0, &shares, spec.armor, spec.shield));
    }
    for p in [0.0, 1.0, 6.0, 25.0] {
        h.f64(pvp_factor(p));
    }
    for k in 0..10 {
        h.u64(bounty_for(k) as u64);
    }
    h.0
}
