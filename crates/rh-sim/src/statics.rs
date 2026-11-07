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
    #[serde(skip)]
    pub(crate) locked_map: Option<TileMap>,
    #[serde(skip)] // immutable source spawnWalks cache, reconstructed from canonical map
    pub(crate) planning_walks: Vec<Option<f64>>,
    #[serde(skip)]
    pub(crate) blink_ring: crate::abilities::blink::Ring,
    #[serde(skip)]
    pub(crate) hazards: crate::terrain::Hazards,
    #[serde(skip)]
    pub(crate) terrain_source: crate::status_runtime::StatusSource,
    #[serde(skip)] // constant-derived environmental source, not stored gameplay state
    pub(crate) arena_source: crate::status_runtime::StatusSource,
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
    pub(crate) fn collision_view(&self, locked: bool) -> crate::collision::View<'_> {
        crate::collision::View {
            open: &self.arena.map,
            locked: self.locked_map.as_ref().unwrap_or(&self.arena.map),
            variant: crate::collision::Variant::of(locked),
        }
    }
    pub(crate) fn collision_map(&self, locked: bool) -> &TileMap {
        self.collision_view(locked).current()
    }

    pub(crate) fn new(config: SimConfig, arena: impl Into<Arc<Arena>>, secrets: Secrets) -> Self {
        let arena = arena.into();
        // The statics secrets stay out of the digest. The state hash still depends on spawn_seed through World.spawn_rng,
        // so it is server-private (see hash.rs).
        let locked_map = arena.map.closed_gates();
        let blink_ring = crate::abilities::blink::Ring::new(&arena.map);
        let planning_walks = if config
            .lifecycle
            .rules()
            .is_some_and(|r| r.plan_seconds > 0.)
        {
            crate::systems::planning::deal::spawn_walks(&arena.map)
        } else {
            Vec::new()
        };
        let hazards = crate::terrain::Hazards::of(&arena.map, config.hazards);
        let digest = crate::hash::hash_of(0, &(&config, &*arena));
        Self {
            config,
            arena,
            secrets,
            digest,
            hazards,
            locked_map,
            blink_ring,
            planning_walks,
            arena_source: crate::status_runtime::StatusSource {
                id: None,
                owner_id: None,
                name: crate::systems::arena_rules::SUDDEN_DEATH_NAME.into(),
            },
            terrain_source: crate::status_runtime::StatusSource {
                id: None,
                owner_id: None,
                name: crate::terrain::EMBER_NAME.into(),
            },
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
    pub reward_salt: [u32; 4],
}

impl Secrets {
    /// Deterministic secrets for tests and headless runs. Not for live matches (a seed in a log would expose them).
    pub fn from_seed(seed: u64) -> Self {
        let lo = seed as u32;
        let hi = (seed >> 32) as u32;
        Self {
            order_salt: crate::rng::hash_seed(lo, hi, 0x4f52_4452, 1),
            spawn_seed: crate::rng::hash_seed(lo, hi, 0x5350_574e, 2),
            reward_salt: std::array::from_fn(|i| {
                crate::rng::hash_seed(lo, hi, 0x5245_5744, i as u32)
            }),
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
    EngagementHolyPlagueFireFrostSentenced,
}
impl FactionMode {
    pub const fn engagement(self) -> bool {
        !matches!(self, Self::Off)
    }
    pub const fn fire(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFire
                | Self::EngagementHolyPlagueFireFrost
                | Self::EngagementHolyPlagueFireFrostSentenced
        )
    }
    pub const fn frost(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFireFrost | Self::EngagementHolyPlagueFireFrostSentenced
        )
    }
    pub const fn sentenced(self) -> bool {
        matches!(self, Self::EngagementHolyPlagueFireFrostSentenced)
    }
    pub const fn supports(self, sig: crate::factions::SignatureKind) -> bool {
        match sig {
            crate::factions::SignatureKind::Disease => self.plague(),
            crate::factions::SignatureKind::Burn | crate::factions::SignatureKind::Backlash => {
                self.fire()
            }
            crate::factions::SignatureKind::Mark => self.sentenced(),
        }
    }
    pub const fn plague(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlague
                | Self::EngagementHolyPlagueFire
                | Self::EngagementHolyPlagueFireFrost
                | Self::EngagementHolyPlagueFireFrostSentenced
        )
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SimConfig {
    #[serde(default)]
    pub abilities: crate::abilities::Mode,
    #[serde(default = "default_wish_lock")]
    pub wish_lock_ms: f64,
    #[serde(default)]
    pub lifecycle: crate::ArenaMode,
    /// Native terrain rules are opt-in until clients carry public terrain layers.
    #[serde(default)]
    pub hazards: crate::terrain::Mode,
    #[serde(default)]
    pub initial_loot: bool,
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
    #[serde(default)]
    pub mob_mode: crate::mob_runtime::MobMode,
    /// Whether the world installs the consumables module (potions, wind emblems; cannons later). Capture worlds that
    /// omit the module have no wind spawn timer; the live server and the production captures install it.
    #[serde(default = "consumables_installed")]
    pub consumables: bool,
}

fn consumables_installed() -> bool {
    true
}

fn default_wish_lock() -> f64 {
    crate::abilities::WISH_LOCK_MS
}

fn specials_enabled() -> bool {
    true
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            abilities: crate::abilities::Mode::Off,
            wish_lock_ms: crate::abilities::WISH_LOCK_MS,
            lifecycle: crate::ArenaMode::Off,
            initial_loot: false,
            hazards: crate::terrain::Mode::Off,
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 5.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: FactionMode::Off,
            mob_mode: crate::mob_runtime::MobMode::Off,
            consumables: true,
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
