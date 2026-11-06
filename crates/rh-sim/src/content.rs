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

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
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

/// Source weaponTimings NPC profile; all attack arithmetic still uses this shared weapon catalog.
pub fn npc_timings(w: WeaponId, interval: f64) -> Timings {
    let mut t = player_timings(w, interval);
    match w {
        WeaponId::Sword => t.windup = NPC_SWORD_WINDUP.min(interval),
        WeaponId::Shield => t.windup = NPC_BASH_WINDUP.min(interval),
        WeaponId::Fists => t.windup = NPC_FISTS_WINDUP.min(interval),
        WeaponId::Axe => {
            t.windup = NPC_AXE_WINDUP.min(NPC_AXE_WINDUP_SHARE * interval);
            t.root = NPC_AXE_ROOT.min(NPC_AXE_ROOT_SHARE * interval);
        }
        WeaponId::Bow => t.windup = NPC_BOW_WINDUP.min(NPC_BOW_WINDUP_SHARE * interval),
        WeaponId::Wand => t.windup = NPC_WAND_WINDUP.min(NPC_WAND_WINDUP_SHARE * interval),
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

/// Stat-fold tuning shares its actual definition with the aggregate rules identity.
pub fn content_hash_of_stat_fold_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::stat_fold::StatFoldDefinition,
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        definition,
        &crate::mob_catalog::DEFINITION,
        RuntimeWords::default(),
    )
}

/// The roster helpers and aggregate identity consume the same catalog definition.
pub fn content_hash_of_mob_catalog_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mob_catalog::Definition,
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        definition,
        RuntimeWords::default(),
    )
}

/// The map foundation's fixed geometry is content too. The same definition drives generation;
/// this entry point lets the identity tests perturb it without constructing a map.
pub fn content_hash_of_map_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::coliseum::FixedDefinition<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            coliseum: definition,
            ..Default::default()
        },
    )
}

/// The exact zone-partition definition is shared by generation and this identity fold.
pub fn content_hash_of_zone_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::zones::ZoneDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            zones: definition,
            ..Default::default()
        },
    )
}

/// Camp placement rules share one definition with the initial territory generator.
pub fn content_hash_of_camp_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::zones::camps::CampDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            camps: definition,
            ..Default::default()
        },
    )
}

/// Attempt-prefix retry/arithmetic rules are shared by the producer and its identity.
pub fn content_hash_of_attempt_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::attempt::AttemptDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            attempt: definition,
            ..Default::default()
        },
    )
}

/// Spawn selection/protection and gate decisions use the same rules as this fold.
pub fn content_hash_of_spawn_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::spawns::SpawnDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            spawns: definition,
            ..Default::default()
        },
    )
}

/// Elite-bush rules share the actual placement definition with the content identity.
pub fn content_hash_of_bush_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::bushes::BushDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            bushes: definition,
            ..Default::default()
        },
    )
}

/// The whole-wall landmark guard shares its actual runtime definition with this fold.
pub fn content_hash_of_landmark_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::landmarks::runtime::LandmarkDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            landmarks: definition,
            ..Default::default()
        },
    )
}

/// Search defaults drive candidate selection and placement attempts, and share their runtime definition.
pub fn content_hash_of_landmark_search_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::landmarks::search::SearchDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            landmark_search: definition,
            ..Default::default()
        },
    )
}

/// Shared recipe helpers consume one definition; fixed direction encodings are folded alongside it.
pub fn content_hash_of_landmark_support_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::landmarks::recipe_support::RecipeSupportDefinition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            recipe_support: definition,
            ..Default::default()
        },
    )
}

/// Actual callback tunables and live template rows/keys/jobs share the same definitions as execution.
pub fn content_hash_of_landmark_recipe_definitions(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::landmarks::recipes::Definitions<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            recipes: *definition,
            ..Default::default()
        },
    )
}

/// Canonical record ordering and region defaults use this same live definition.
pub fn content_hash_of_records_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::records::Definition<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            records: definition,
            ..Default::default()
        },
    )
}

/// The actual terrain acceptance tables and protection distances share the execution definitions.
pub fn content_hash_of_terrain_gate_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::terrain_gate::TerrainGateDefinition<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            terrain_gate: definition,
            ..Default::default()
        },
    )
}

/// The independent hard-certifier thresholds are part of generator content identity.
pub fn content_hash_of_certify_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::certify::rules::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            certify: definition,
            ..Default::default()
        },
    )
}

/// Stage-six guards, transactions and stream selection share the execution policy.
pub fn content_hash_of_style_runtime_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_runtime::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_runtime: definition,
            ..Default::default()
        },
    )
}

/// Shared style feature/search arithmetic uses these exact policies.
pub fn content_hash_of_style_features_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_features::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_features: definition,
            ..Default::default()
        },
    )
}
/// Holy shape, surface and decor consume the registered callback definition.
pub fn content_hash_of_style_sanctum_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_sanctum::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_sanctum: definition,
            ..Default::default()
        },
    )
}

/// Warren geometry, route repair and decor read the same borrowed definition as this identity fold.
pub fn content_hash_of_style_warren_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_warren::Definition<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_warren: *definition,
            ..Default::default()
        },
    )
}

/// Scorch nested crater/river/decor policies participate in the same aggregate identity.
pub fn content_hash_of_style_scorch_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_scorch::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_scorch: *definition,
            ..Default::default()
        },
    )
}

/// Frost callback geometry, ICE growth, path repair and decor share this exact identity fold.
pub fn content_hash_of_style_rime_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_rime::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_rime: *definition,
            ..Default::default()
        },
    )
}

/// Sentenced row definitions and the actual resolved factory dials are content, including route policy.
pub fn content_hash_of_style_gallows_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::style_gallows::Definition<'_>,
    dials: &crate::mapgen::style_gallows::Dials,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_gallows: *definition,
            style_gallows_dials: dials.clone(),
            ..Default::default()
        },
    )
}

/// Actual callback identity/phase metadata drives the registry and aggregate rules identity.
pub fn content_hash_of_style_registry_entries(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    entries: &[crate::mapgen::style_zones::Entry],
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            style_registry: entries,
            ..Default::default()
        },
    )
}

/// Bounded plain/styled orchestration uses these same retry and feature limits.
pub fn content_hash_of_pipeline_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::pipeline::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            pipeline: definition,
            ..Default::default()
        },
    )
}

/// Camp/crate/ground placement consumes the same borrowed definition visited here.
pub fn content_hash_of_spot_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::spots::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            spots: definition,
            ..Default::default()
        },
    )
}

/// Final shape admission and loot clearing use these same live policy values.
pub fn content_hash_of_tail_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::tail::Definition,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            tail: definition,
            ..Default::default()
        },
    )
}

/// Safety-net and territory-repair policy uses the same borrowed terrain classification.
pub fn content_hash_of_repair_definition(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definition: &crate::mapgen::repair::Definition<'_>,
) -> u64 {
    content_hash_of_map_definitions(
        registry,
        stagger_weapons,
        MapDefinitions {
            repair: *definition,
            ..Default::default()
        },
    )
}

/// Signature classification affects damage budgets and reporting, so it is content as well.
pub fn content_hash_of_signature_rules(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    signature_rules: &[(crate::factions::SignatureKind, bool)],
) -> u64 {
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        signature_rules,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords::default(),
    )
}

/// Borrowed rule definitions avoid duplicating default lists at every perturbation entry point.
struct MapDefinitions<'rules, 'pillars> {
    coliseum: &'rules crate::mapgen::coliseum::FixedDefinition<'pillars>,
    zones: &'rules crate::mapgen::zones::ZoneDefinition,
    camps: &'rules crate::mapgen::zones::camps::CampDefinition,
    attempt: &'rules crate::mapgen::attempt::AttemptDefinition,
    spawns: &'rules crate::mapgen::spawns::SpawnDefinition,
    bushes: &'rules crate::mapgen::bushes::BushDefinition,
    landmarks: &'rules crate::mapgen::landmarks::runtime::LandmarkDefinition,
    landmark_search: &'rules crate::mapgen::landmarks::search::SearchDefinition,
    recipe_support: &'rules crate::mapgen::landmarks::recipe_support::RecipeSupportDefinition,
    recipes: crate::mapgen::landmarks::recipes::Definitions<'pillars>,
    records: &'rules crate::mapgen::records::Definition<'pillars>,
    terrain_gate: &'rules crate::mapgen::terrain_gate::TerrainGateDefinition<'pillars>,
    style_features: &'rules crate::mapgen::style_features::Definition,
    style_sanctum: &'rules crate::mapgen::style_sanctum::Definition,
    style_warren: crate::mapgen::style_warren::Definition<'pillars>,
    style_scorch: crate::mapgen::style_scorch::Definition,
    style_rime: crate::mapgen::style_rime::Definition,
    style_gallows: crate::mapgen::style_gallows::Definition<'pillars>,
    style_gallows_dials: crate::mapgen::style_gallows::Dials,
    style_registry: &'rules [crate::mapgen::style_zones::Entry],
    pipeline: &'rules crate::mapgen::pipeline::Definition,
    certify: &'rules crate::mapgen::certify::rules::Definition,
    style_runtime: &'rules crate::mapgen::style_runtime::Definition,
    spots: &'rules crate::mapgen::spots::Definition,
    tail: &'rules crate::mapgen::tail::Definition,
    repair: crate::mapgen::repair::Definition<'pillars>,
}

impl Default for MapDefinitions<'_, '_> {
    fn default() -> Self {
        Self {
            coliseum: &crate::mapgen::coliseum::DEFAULT_DEFINITION,
            zones: &crate::mapgen::zones::DEFAULT_DEFINITION,
            camps: &crate::mapgen::zones::camps::DEFAULT_DEFINITION,
            attempt: &crate::mapgen::attempt::DEFAULT_DEFINITION,
            spawns: &crate::mapgen::spawns::DEFAULT_DEFINITION,
            bushes: &crate::mapgen::bushes::DEFAULT_DEFINITION,
            landmarks: &crate::mapgen::landmarks::runtime::DEFAULT_DEFINITION,
            landmark_search: &crate::mapgen::landmarks::search::DEFAULT_DEFINITION,
            recipe_support: &crate::mapgen::landmarks::recipe_support::DEFAULT_DEFINITION,
            recipes: crate::mapgen::landmarks::recipes::default_definitions(),
            records: &crate::mapgen::records::DEFAULT_DEFINITION,
            terrain_gate: &crate::mapgen::terrain_gate::DEFAULT_DEFINITION,
            style_features: &crate::mapgen::style_features::DEFAULT_DEFINITION,
            style_sanctum: &crate::mapgen::style_sanctum::DEFAULT_DEFINITION,
            style_warren: crate::mapgen::style_warren::default_definition(),
            style_scorch: crate::mapgen::style_scorch::default_definition(),
            style_rime: crate::mapgen::style_rime::default_definition(),
            style_gallows: crate::mapgen::style_gallows::default_definition(),
            style_gallows_dials: crate::mapgen::style_gallows::default_dials(),
            style_registry: &crate::mapgen::style_zones::ENTRIES,
            pipeline: &crate::mapgen::pipeline::DEFAULT_DEFINITION,
            certify: &crate::mapgen::certify::rules::R,
            style_runtime: &crate::mapgen::style_runtime::DEFAULT_DEFINITION,
            spots: &crate::mapgen::spots::DEFAULT_DEFINITION,
            tail: &crate::mapgen::tail::DEFAULT_DEFINITION,
            repair: crate::mapgen::repair::default_definition(
                &crate::mapgen::terrain_gate::GENERATOR_TILE_CLASSES,
            ),
        }
    }
}

fn content_hash_of_map_definitions(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definitions: MapDefinitions<'_, '_>,
) -> u64 {
    let signature_rules = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        definitions,
        &signature_rules,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords::default(),
    )
}

fn fold_mob_catalog(h: &mut Fnv, definition: &crate::mob_catalog::Definition) {
    use crate::mob_catalog::{visit_definition, Metadata};
    h.str("mob-catalog/1");
    h.u64(definition.roles.len() as u64);
    h.u64(definition.types.len() as u64);
    h.u64(definition.regions.len() as u64);
    visit_definition(definition, |entry| match entry {
        Metadata::Role(row) => {
            h.str("role");
            h.str(row.id.as_str());
            h.str(row.label);
            h.f64(row.hp_mult);
            h.f64(row.dmg_mult);
            h.f64(row.move_mult);
            h.u64(row.tags.len() as u64);
            for tag in row.tags {
                h.str(tag.as_str());
            }
            h.str(row.blurb);
        }
        Metadata::Type(row) => {
            h.str("type");
            h.str(row.id.as_str());
            h.str(row.zone.as_str());
            h.u64(u64::from(row.elite));
            h.str(row.name);
            h.str(row.role.as_str());
            h.str(row.weapon.as_str());
        }
        Metadata::Region(row) => {
            h.str("region");
            h.str(row.zone.as_str());
            h.u64(row.names.len() as u64);
            for name in row.names {
                h.str(name);
            }
            h.str(row.weapon.as_str());
        }
        Metadata::Rules(row) => {
            h.str("rules");
            h.u64(row.bag_copies as u64);
            h.f64(row.melee_damage);
            h.f64(row.ranged_damage);
            h.f64(row.elite_damage);
        }
    });
}

/// Perturbs the words emitted by the actual status visitors through the real aggregate path.
pub fn content_hash_of_status_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    rule_words: &[u64],
    extra_words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords {
            status: Some((rule_words, extra_words)),
            ..Default::default()
        },
    )
}

// Only output words are injected; no status rules or gameplay operations are mutated.
// The default streams the real visitors twice (length, then words), without collecting.
fn fold_status_stream(
    h: &mut Fnv,
    label: &str,
    supplied: Option<&[u64]>,
    visit: fn(&mut dyn FnMut(u64)),
) {
    h.str(label);
    if let Some(words) = supplied {
        h.u64(words.len() as u64);
        for &word in words {
            h.u64(word);
        }
    } else {
        let mut count = 0u64;
        visit(&mut |_| count += 1);
        h.u64(count);
        visit(&mut |word| h.u64(word));
    }
}
fn fold_status_content(h: &mut Fnv, supplied: Option<(&[u64], &[u64])>) {
    fold_status_stream(h, "status-rules/1", supplied.map(|words| words.0), |word| {
        crate::status_runtime::visit_content(word)
    });
    fold_status_stream(h, "status-extra/1", supplied.map(|words| words.1), |word| {
        crate::status_runtime::visit_extra_content(word)
    });
}

#[derive(Default)]
struct RuntimeWords<'a> {
    status: Option<(&'a [u64], &'a [u64])>,
    progression: Option<&'a [u64]>,
}

/// Ordered words from the actual selected-card, modifier, farm, reward and private-stream definitions.
/// Component names/lengths and actual public key mappings prevent membership/order ambiguity.
pub fn visit_progression_content(mut word: impl FnMut(u64)) {
    type Visit = fn(&mut dyn FnMut(u64));
    let visitors: [(&str, Visit); 6] = [
        ("cards/1", |f| {
            crate::cards::visit_content(&crate::cards::DEFINITION, f)
        }),
        ("modifiers/1", |f| {
            crate::modifiers::visit_content(&crate::modifiers::DEFINITION, f)
        }),
        ("farm/1", |f| {
            crate::modifiers::farm::visit_content(&crate::modifiers::farm::DEFINITION, f)
        }),
        ("reward-chests/1", |f| {
            crate::reward_chests::visit_content(&crate::reward_chests::DEFINITION, f)
        }),
        ("private-sfc32/1", |f| crate::private_rng::visit_content(f)),
        ("small-potions/1", |f| crate::potions::visit_content(f)),
    ];
    for (tag, visit) in visitors {
        word(tag.len() as u64);
        for b in tag.bytes() {
            word(u64::from(b));
        }
        let mut n = 0;
        visit(&mut |_| n += 1);
        word(n);
        visit(&mut word);
    }
    word(FactionId::ALL.len() as u64);
    for faction in FactionId::ALL {
        word(u64::from(faction.code()));
        word(u64::from(crate::systems::mobs::basic_faction(faction)));
    }
    word(crate::cards::CardId::ALL.len() as u64);
    for id in crate::cards::CardId::ALL {
        word(id.index() as u64);
        word(id.as_str().len() as u64);
        for b in id.as_str().bytes() {
            word(u64::from(b));
        }
    }
    word(crate::reward_chests::BoostId::ALL.len() as u64);
    for id in crate::reward_chests::BoostId::ALL {
        word(id.index() as u64);
        word(id.as_str().len() as u64);
        for b in id.as_str().bytes() {
            word(u64::from(b));
        }
    }
}

/// Sensitivity seam for the real aggregate fold; only output words are supplied, no gameplay state changes.
pub fn content_hash_of_progression_words(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    words: &[u64],
) -> u64 {
    let signatures = crate::factions::SignatureKind::ALL.map(|kind| (kind, kind.is_dot()));
    content_hash_of_definitions(
        registry,
        stagger_weapons,
        MapDefinitions::default(),
        &signatures,
        &crate::stat_fold::default_definition(),
        &crate::mob_catalog::DEFINITION,
        RuntimeWords {
            progression: Some(words),
            ..Default::default()
        },
    )
}

fn content_hash_of_definitions(
    registry: &[Entry],
    stagger_weapons: &[WeaponId],
    definitions: MapDefinitions<'_, '_>,
    signature_rules: &[(crate::factions::SignatureKind, bool)],
    stat_fold: &crate::stat_fold::StatFoldDefinition,
    mob_catalog: &crate::mob_catalog::Definition,
    runtime_words: RuntimeWords<'_>,
) -> u64 {
    let MapDefinitions {
        coliseum,
        zones,
        camps,
        attempt,
        spawns,
        bushes,
        landmarks,
        landmark_search,
        recipe_support,
        recipes,
        records,
        terrain_gate,
        style_features,
        style_sanctum,
        style_warren,
        style_scorch,
        style_rime,
        style_gallows,
        style_gallows_dials,
        style_registry,
        pipeline,
        certify,
        style_runtime,
        spots,
        tail,
        repair,
    } = definitions;
    let mut h = Fnv::new();

    h.str("registry");
    h.u64(registry.len() as u64);
    for e in registry {
        h.str(e.name);
        h.val(&e.val);
    }

    fold_mob_catalog(&mut h, mob_catalog);
    h.str("initial-world/1");
    crate::initial_world::visit_content(|word| h.u64(word));

    h.str("status-runtime/1");
    fold_status_content(&mut h, runtime_words.status);
    fold_status_stream(
        &mut h,
        "mvp-progression/1",
        runtime_words.progression,
        |word| visit_progression_content(word),
    );

    h.str("stat-fold/1");
    crate::stat_fold::visit_content(stat_fold, |word| h.u64(word));
    // Fold the actual runtime key order/index/category mappings rather than shadow lists.
    let stat_keys = crate::stat_fold::StatKey::source_order();
    h.u64(stat_keys.len() as u64);
    for key in stat_keys {
        h.u64(key as u64);
        h.u64(key.index() as u64);
        h.u64(u64::from(crate::stat_fold::is_product_stat(key)));
        h.u64(u64::from(crate::stat_fold::is_flat_stat(key)));
    }
    let keys = crate::stat_fold::MultKey::source_order();
    h.str("mult-keys");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
        h.u64(key.index() as u64);
    }
    let keys = crate::stat_fold::EffectFlag::source_order();
    h.str("effect-flags");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
    }
    let keys = crate::stat_fold::ConvertFrom::source_order();
    h.str("convert-from");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
    }
    let keys = crate::stat_fold::ConvertTo::source_order();
    h.str("convert-to");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
        h.u64(key.stat_key() as u64);
    }
    let keys = crate::stat_fold::ChestBoostStat::source_order();
    h.str("chest-keys");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
        h.u64(key.index() as u64);
    }
    let keys = crate::stat_fold::MirrorField::source_order();
    h.str("mirror-fields");
    h.u64(keys.len() as u64);
    for key in keys {
        h.u64(key as u64);
    }

    h.str("mapgen/coliseum/1");
    crate::mapgen::coliseum::visit_content(coliseum, |word| h.u64(word));

    h.str("mapgen/zones/partition/1");
    crate::mapgen::zones::visit_content(zones, |word| h.u64(word));

    h.str("mapgen/zones/camps/1");
    crate::mapgen::zones::camps::visit_content(camps, |word| h.u64(word));

    h.str("mapgen/attempt-prefix/1");
    crate::mapgen::attempt::visit_content(attempt, |word| h.u64(word));

    h.str("mapgen/spawns/1");
    crate::mapgen::spawns::visit_content(spawns, |word| h.u64(word));

    h.str("mapgen/elite-bushes/1");
    crate::mapgen::bushes::visit_content(bushes, |word| h.u64(word));

    h.str("mapgen/landmark-runtime/1");
    crate::mapgen::landmarks::runtime::visit_content(landmarks, |word| h.u64(word));

    h.str("mapgen/landmark-search/1");
    crate::mapgen::landmarks::search::visit_content(landmark_search, |word| h.u64(word));

    h.str("mapgen/landmark-recipe-support/1");
    crate::mapgen::landmarks::recipe_support::visit_content(recipe_support, |word| h.u64(word));
    let directions = crate::mapgen::landmarks::recipe_support::DIR16;
    h.u64(directions.len() as u64);
    for direction in directions {
        for coordinate in direction {
            h.u64(coordinate as u64);
        }
    }

    h.str("mapgen/landmark-recipes/1");
    crate::mapgen::landmarks::recipes::visit_content(&recipes, |word| h.u64(word));

    h.str("mapgen/records/1");
    crate::mapgen::records::visit_content(records, |word| h.u64(word));

    h.str("mapgen/terrain-gate/1");
    crate::mapgen::terrain_gate::visit_content(terrain_gate, |word| h.u64(word));

    h.str("mapgen/plain-pipeline/1");
    crate::mapgen::pipeline::visit_content(pipeline, |word| h.u64(word));

    h.str("mapgen/hard-certifier/1");
    crate::mapgen::certify::rules::visit_definition(certify, |word| h.u64(word));
    h.str("mapgen/style-features/1");
    crate::mapgen::style_features::visit_content(style_features, |word| h.u64(word));
    h.u64(crate::mapgen::style_features::DIR8.len() as u64);
    for [dx, dy] in crate::mapgen::style_features::DIR8 {
        h.u64(dx as u64);
        h.u64(dy as u64);
    }
    h.str("mapgen/style-sanctum/1");
    crate::mapgen::style_sanctum::visit_content(style_sanctum, |word| h.u64(word));
    h.str("mapgen/style-warren/1");
    crate::mapgen::style_warren::visit_content(&style_warren, |word| h.u64(word));
    h.str("mapgen/style-scorch/1");
    crate::mapgen::style_scorch::visit_content(&style_scorch, |word| h.u64(word));
    h.str("mapgen/style-rime/1");
    crate::mapgen::style_rime::visit_content(&style_rime, |word| h.u64(word));
    h.str("mapgen/style-gallows/1");
    crate::mapgen::style_gallows::visit_content(&style_gallows, &style_gallows_dials, |word| {
        h.u64(word)
    });

    h.str("mapgen/style-zones/1");
    crate::mapgen::style_zones::visit_entries(style_registry, |word| h.u64(word));

    h.str("mapgen/style-runtime/1");
    crate::mapgen::style_runtime::visit_content(style_runtime, |word| h.u64(word));
    h.u64(crate::mapgen::style_runtime::MAX_CELLS as u64);
    h.u64(crate::mapgen::style_runtime::DIAMOND2.len() as u64);
    for (dx, dy) in crate::mapgen::style_runtime::DIAMOND2 {
        h.u64(dx as u64);
        h.u64(dy as u64);
    }

    h.str("mapgen/spots/1");
    crate::mapgen::spots::visit_content(spots, |word| h.u64(word));

    h.str("mapgen/tail/1");
    crate::mapgen::tail::visit_content(tail, |word| h.u64(word));

    h.str("mapgen/repair/1");
    crate::mapgen::repair::visit_content(&repair, |word| h.u64(word));

    h.str("signatures/1");
    h.u64(signature_rules.len() as u64);
    for &(kind, is_dot) in signature_rules {
        h.str(kind.as_str());
        h.u64(u64::from(is_dot));
    }

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
    h.str("frost/formulas/1");
    for multiplier in [1.0, 1.0 - FROST_SLOW] {
        for remaining in [-1.0, 0.0, 1.0, 33.999, 34.0, 50.0, 75.0] {
            h.f64(crate::systems::frost::stretch_until(
                1000.0 + remaining,
                1000.0,
                TICK_MS,
                multiplier,
            ));
        }
    }
    for exposure in [0.0, 999.0, 1000.0, 1001.0, 2500.0, 3999.0, 4000.0, 4001.0] {
        h.f64(crate::systems::frost::move_multiplier(exposure));
    }
    h.str("sentenced/base-pulse/1");
    for weapon in WeaponId::ALL {
        for sentence in [0, 1, 5] {
            for target_max_hp in [1.0, 1000.0, 1234.5] {
                for near in [false, true] {
                    h.f64(sentenced_pulse(weapon, target_max_hp, sentence, near));
                }
            }
        }
    }
    h.0
}

/// Holy's unmodified sustain share. Cards and camp rewards are separate future producers.
pub fn holy_lifesteal_fraction(hp_frac: f64) -> f64 {
    HOLY_LEECH_CAP.min(HOLY_LEECH_BASE + HOLY_LEECH_MISSING * (1.0 - hp_frac))
}

/// Source-exact base-player Mark pulse before mitigation. Tier/linger amplifiers and build/hunt
/// modifiers are neutral in this installation. The counter's kill cap is enforced where it grows;
/// the source percentage helper itself does not clamp a supplied sentence count.
pub fn sentenced_pulse(weapon_id: WeaponId, target_max_hp: f64, sentence: u8, near: bool) -> f64 {
    let spec = paced(FactionId::Sentenced);
    let weight = spec.rate * weapon(weapon_id).dps_mult * attack_interval(&spec, weapon_id, 1.0);
    let pct = MARK_BASE_PCT * DUEL_PACE + (MARK_KILL_PCT * DUEL_PACE) * f64::from(sentence);
    pct * target_max_hp * weight * if near { 1.0 } else { MARK_FAR_SHARE }
}
