//! What a match is played with and never changes once it starts: the configuration, the arena and the secrets.

use crate::map::TileMap;
use crate::math::Vec2;
use std::sync::Arc;

/// The match's immutable inputs, fixed when the [`crate::Sim`] is created. The arena is shared ([`Arc`]): rooms and
/// recorders can hold the same map without copying it. Part of a checkpoint. `digest` is derived (config, map layer and
/// spawns, never the secrets: see `hash.rs`), computed by [`MatchStatic::new`] and by deserialization, so a decoded value
/// is complete; it seeds the state hash, which therefore pins the statics without re-hashing the map every step.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(from = "StaticRepr")]
pub(crate) struct MatchStatic {
    pub(crate) config: SimConfig,
    pub(crate) arena: Arc<Arena>,
    pub(crate) secrets: Secrets,
    #[serde(skip)] // derived from the fields above
    pub(crate) digest: u64,
}

/// The serialized shape of [`MatchStatic`]: exactly its stored fields.
#[derive(serde::Deserialize)]
#[serde(rename = "MatchStatic")]
struct StaticRepr {
    config: SimConfig,
    arena: Arc<Arena>,
    secrets: Secrets,
}

impl From<StaticRepr> for MatchStatic {
    fn from(r: StaticRepr) -> Self {
        MatchStatic::new(r.config, r.arena, r.secrets)
    }
}

impl MatchStatic {
    pub(crate) fn new(config: SimConfig, arena: impl Into<Arc<Arena>>, secrets: Secrets) -> Self {
        let arena = arena.into();
        // The statics secrets stay out of the digest. The state hash still depends on spawn_seed through World.spawn_rng,
        // so it is server-private (see hash.rs).
        let digest = crate::hash::hash_of(0, &(&config, &*arena));
        Self {
            config,
            arena,
            secrets,
            digest,
        }
    }
}

/// Everything the core needs that must not be derivable by clients. The live server draws these from the OS CSPRNG; tests
/// and the headless runner derive them from a run seed ([`Secrets::from_seed`]). Never sent to clients or public exports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Secrets {
    /// Keys the per-tick action order and tie ranks (legacy `orderSalt`).
    pub order_salt: u32,
    /// Seeds the spawn shuffle stream.
    pub spawn_seed: u32,
}

impl Secrets {
    /// Deterministic secrets for tests and headless runs. Not for live matches (a seed in a log would expose them).
    pub fn from_seed(seed: u64) -> Self {
        let lo = seed as u32;
        let hi = (seed >> 32) as u32;
        Self {
            order_salt: crate::rng::hash_seed(lo, hi, 0x4f52_4452, 1),
            spawn_seed: crate::rng::hash_seed(lo, hi, 0x5350_574e, 2),
        }
    }
}

/// Explicitly partial faction installations. Unimplemented factions never silently activate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum FactionMode {
    #[default]
    Off,
    EngagementHoly,
    EngagementHolyPlague,
    EngagementHolyPlagueFire,
    EngagementHolyPlagueFireFrost,
}
impl FactionMode {
    pub const fn engagement(self) -> bool {
        !matches!(self, Self::Off)
    }
    pub const fn fire(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFire | Self::EngagementHolyPlagueFireFrost
        )
    }
    pub const fn frost(self) -> bool {
        matches!(self, Self::EngagementHolyPlagueFireFrost)
    }
    pub const fn supports(self, sig: crate::factions::SignatureKind) -> bool {
        match sig {
            crate::factions::SignatureKind::Disease => self.plague(),
            _ => self.fire(),
        }
    }
    pub const fn plague(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlague
                | Self::EngagementHolyPlagueFire
                | Self::EngagementHolyPlagueFireFrost
        )
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SimConfig {
    pub min_players: usize,
    pub lobby_seconds: f64,
    pub fill_seconds: f64,
    /// The PvP factor and hit cap (legacy `pvpRules`). A live run never turns it off.
    pub pvp_rules: bool,
    /// Enables the axe's shred and the wand's splash in the legacy rules.
    #[serde(default = "specials_enabled")]
    pub weapon_specials: bool,
    /// Partial player-only faction foundation: engagement and Holy lifesteal.
    /// Other faction producers and installers remain pending. Recorded in replay identity.
    #[serde(default)]
    pub faction_mode: FactionMode,
}

fn specials_enabled() -> bool {
    true
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 5.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: FactionMode::Off,
        }
    }
}

/// The public arena a match is played on: the collision layer and the spawn points.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Arena {
    pub map: TileMap,
    pub spawns: Vec<Vec2>,
}

impl Arena {
    pub fn centre(&self) -> Vec2 {
        let tx = (self.map.w / 2) as i64;
        let ty = (self.map.h / 2) as i64;
        Vec2::new(
            crate::map::tile_to_world_center(tx),
            crate::map::tile_to_world_center(ty),
        )
    }
}
