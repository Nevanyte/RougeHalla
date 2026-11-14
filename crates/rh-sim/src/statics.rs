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

/// Explicitly partial faction installations. Unimplemented factions never silently activate. The last variant is the
/// full five-faction foundation plus the explicit Fire roam auxiliary installer (legacy `signatures: true` installs both
/// together; the parity capture worlds name the module set instead).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum FactionMode {
    #[default]
    Off,
    EngagementHoly,
    EngagementHolyPlague,
    EngagementHolyPlagueFire,
    EngagementHolyPlagueFireFrost,
    EngagementHolyPlagueFireFrostSentenced,
    EngagementHolyPlagueFireFrostSentencedFireRoam,
}
impl FactionMode {
    pub const fn engagement(self) -> bool {
        !matches!(self, Self::Off)
    }
    /// The explicit Fire roam auxiliary installer is part of this partial foundation.
    pub const fn fire_roam(self) -> bool {
        matches!(self, Self::EngagementHolyPlagueFireFrostSentencedFireRoam)
    }
    pub const fn fire(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFire
                | Self::EngagementHolyPlagueFireFrost
                | Self::EngagementHolyPlagueFireFrostSentenced
                | Self::EngagementHolyPlagueFireFrostSentencedFireRoam
        )
    }
    pub const fn frost(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFireFrost
                | Self::EngagementHolyPlagueFireFrostSentenced
                | Self::EngagementHolyPlagueFireFrostSentencedFireRoam
        )
    }
    pub const fn sentenced(self) -> bool {
        matches!(
            self,
            Self::EngagementHolyPlagueFireFrostSentenced
                | Self::EngagementHolyPlagueFireFrostSentencedFireRoam
        )
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
                | Self::EngagementHolyPlagueFireFrostSentencedFireRoam
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
    /// Installs the consumables module's travel producer (the source full-game profile). Off models the capture
    /// worlds whose recorded installer list has no `consumables` entry; default and serde default true.
    #[serde(default = "default_consumables")]
    pub consumables: bool,
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
    /// Passive player health regeneration (legacy `regen`). Unset or false: none, so tests, benches and the parity
    /// harness keep hp deterministic. The live server turns it on.
    #[serde(default)]
    pub regen: bool,
    /// The K1 quest module (legacy config.quests): a config switch so a test/experiment can turn it off.
    #[serde(default)]
    pub quests: bool,
    /// A training world (legacy `SimConfig.training`, `sim/training.ts`): the run never ends and nothing is recorded —
    /// no patience timer, teleport, sudden death, results or GV, and a fighter who goes down is revived. It implies the
    /// practice setup (`dummies`) and a world with no planning and no arena lifecycle.
    #[serde(default)]
    pub training: bool,
    /// The practice setup (legacy `SimConfig.dummies`, `sim/mobs.ts`): dummies and a rack of every weapon next to each
    /// spawn when the run starts. A training world always has it; on its own it stays an arena run.
    #[serde(default)]
    pub dummies: bool,
    /// Explicit source installer override. None preserves the existing foundation/Training preset.
    #[serde(default)]
    pub walk_hints: Option<bool>,
    /// Which hitboxes the fighters get (ADR0024): the legacy 12 u circle (default: tests, parity, benches, headless) or the
    /// measured archetype boxes (the live server opts in). Recorded in the statics digest and replay identity.
    #[serde(default)]
    pub hitboxes: crate::archetype::HitboxMode,
    /// Mob spacing (ADR0024 addendum "Mob spacing"): `Auto` (the default: on exactly under `Archetypes`) or `Off`, the
    /// measurement-only A/B of `rh-headless --example hitbox_compare`, which the server refuses to host
    /// (`rh_server::wire::profile_supported`). `Off` is recorded in the statics digest, so in the state hash, every
    /// checkpoint and every replay; `Auto` adds nothing to the digest (every hash from before the field is unchanged).
    #[serde(default)]
    pub mob_spacing: crate::archetype::MobSpacing,
    /// Passive regeneration while fighting (P-REGEN-COMBAT-1): `Legacy` (the default: the in-repo legacy oracle's
    /// `PLAYER_REGEN_SHARE_IN`) or `Off` (unreleased legacy f8cd956e, owner decision 2026-11-10: out of combat only; the
    /// live profiles opt in). `Legacy` adds nothing to any hash; `Off` folds a tag of its own, never `mob_spacing`'s
    /// `"off"` (see [`RegenInCombat`]).
    #[serde(default)]
    pub regen_in_combat: RegenInCombat,
    /// Which stat a camp's normal kills pay (P-CAMP-BUFF-THEMES-1): `Legacy` (the default: the in-repo legacy oracle,
    /// a camp pays its own mob type's stat, `packages/shared/src/rosters.ts` bag roll) or `Themed` (unreleased legacy
    /// a7b5c4ce, owner decision 2026-11-10: each zone a theme of four stats, every stat within a max distance of every
    /// camp, an even spread; the live profiles opt in). `Legacy` adds nothing to any hash; `Themed` folds a tag of its
    /// own (see [`CampBuffRule`]).
    #[serde(default)]
    pub camp_buffs: CampBuffRule,
    /// What Frost's Wish is (P-FROST-WALL-1): `Freeze` (the default: the in-repo legacy oracle's point-and-click stun) or
    /// `Wall` (unreleased legacy 78dd8bd4, owner decision 2026-11-10: Frost Wall, a placed barrier whose floor tiles are
    /// LOW while it stands). `Freeze` adds nothing to any hash; `Wall` folds a tag of its own (see [`FrostWish`]). No
    /// live profile selects `Wall` until clients can see the barrier (P-FROST-WALL-2).
    #[serde(default)]
    pub frost_wish: FrostWish,
}

/// `SimConfig::frost_wish`. `Freeze` serializes as nothing (JSON `null`; the hashing serializer folds no word for a
/// unit), so a config that leaves it alone has the statics digest, state hashes, checkpoints and replays it had before
/// the field existed. `Wall` is the string `"wall"` in a human-readable format (the JSON config, checkpoint and replay)
/// and the string `"frost_wish=wall"` (length 15) in any other (the state hasher): a value no other config field writes,
/// for the reason [`RegenInCombat`] documents (this field follows three others whose default also folds nothing).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FrostWish {
    #[default]
    Freeze,
    Wall,
}

/// What `FrostWish::Wall` writes to a serializer that is not human-readable (the state hasher). JSON keeps `"wall"`.
const FROST_WISH_WALL_TAG: &str = "frost_wish=wall";

impl serde::Serialize for FrostWish {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Freeze => s.serialize_unit(),
            Self::Wall if s.is_human_readable() => s.serialize_str("wall"),
            Self::Wall => s.serialize_str(FROST_WISH_WALL_TAG),
        }
    }
}

impl<'de> serde::Deserialize<'de> for FrostWish {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Each format reads back exactly what it writes; JSON refuses the tag as it refuses any other unknown value.
        let human = d.is_human_readable();
        match Option::<String>::deserialize(d)?.as_deref() {
            None => Ok(Self::Freeze),
            Some("wall") if human => Ok(Self::Wall),
            Some(FROST_WISH_WALL_TAG) if !human => Ok(Self::Wall),
            Some(other) => Err(serde::de::Error::custom(format!(
                "frost_wish must be null or \"wall\", not {other:?}"
            ))),
        }
    }
}

/// `SimConfig::camp_buffs`. `Legacy` serializes as nothing (JSON `null`; the hashing serializer folds no word for a
/// unit), so a config that leaves it alone has the statics digest, state hashes, checkpoints and replays it had before
/// the field existed. `Themed` is the string `"themed"` in a human-readable format (the JSON config, checkpoint and
/// replay) and the string `"camp_buffs=themed"` in any other (the state hasher): a value no other config field writes,
/// for the reason [`RegenInCombat`] documents (the hasher folds values, not field names, and this field follows two
/// others whose default also folds nothing).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CampBuffRule {
    #[default]
    Legacy,
    Themed,
}

/// What `CampBuffRule::Themed` writes to a serializer that is not human-readable (the state hasher). JSON keeps
/// `"themed"`.
const CAMP_BUFFS_THEMED_TAG: &str = "camp_buffs=themed";

impl serde::Serialize for CampBuffRule {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Legacy => s.serialize_unit(),
            Self::Themed if s.is_human_readable() => s.serialize_str("themed"),
            Self::Themed => s.serialize_str(CAMP_BUFFS_THEMED_TAG),
        }
    }
}

impl<'de> serde::Deserialize<'de> for CampBuffRule {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Each format reads back exactly what it writes; JSON refuses the tag as it refuses any other unknown value.
        let human = d.is_human_readable();
        match Option::<String>::deserialize(d)?.as_deref() {
            None => Ok(Self::Legacy),
            Some("themed") if human => Ok(Self::Themed),
            Some(CAMP_BUFFS_THEMED_TAG) if !human => Ok(Self::Themed),
            Some(other) => Err(serde::de::Error::custom(format!(
                "camp_buffs must be null or \"themed\", not {other:?}"
            ))),
        }
    }
}

/// `SimConfig::regen_in_combat`. `Legacy` serializes as nothing (JSON `null`; the hashing serializer folds no word for a
/// unit), so a config that leaves it alone has the statics digest, state hashes, checkpoints and replays it had before
/// the field existed. `Off` is the string `"off"` in a human-readable format (the JSON config, checkpoint and replay)
/// and the string `"regen_in_combat=off"` in any other (the state hasher), and is folded into all of them.
///
/// Why two spellings (P-REGEN-COMBAT-1-fix): the hasher folds values, not field names, and this field comes right after
/// [`crate::archetype::MobSpacing`], whose default also folds nothing and whose `Off` is also `"off"`. With `"off"` in
/// the hash, `mob_spacing = Off, regen_in_combat = Legacy` and `mob_spacing = Auto, regen_in_combat = Off` folded the same
/// words and shared one statics digest. The tag has another length (19 bytes, not 3), so the first word it folds (its
/// length) already differs from anything `mob_spacing` writes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RegenInCombat {
    #[default]
    Legacy,
    Off,
}

/// What `RegenInCombat::Off` writes to a serializer that is not human-readable (the state hasher): a string no other
/// config field writes. JSON keeps `"off"`.
const REGEN_IN_COMBAT_OFF_TAG: &str = "regen_in_combat=off";

impl serde::Serialize for RegenInCombat {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Legacy => s.serialize_unit(),
            Self::Off if s.is_human_readable() => s.serialize_str("off"),
            Self::Off => s.serialize_str(REGEN_IN_COMBAT_OFF_TAG),
        }
    }
}

impl<'de> serde::Deserialize<'de> for RegenInCombat {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Each format reads back exactly what it writes; JSON refuses the tag as it refuses any other unknown value.
        let human = d.is_human_readable();
        match Option::<String>::deserialize(d)?.as_deref() {
            None => Ok(Self::Legacy),
            Some("off") if human => Ok(Self::Off),
            Some(REGEN_IN_COMBAT_OFF_TAG) if !human => Ok(Self::Off),
            Some(other) => Err(serde::de::Error::custom(format!(
                "regen_in_combat must be null or \"off\", not {other:?}"
            ))),
        }
    }
}

fn default_wish_lock() -> f64 {
    crate::abilities::WISH_LOCK_MS
}

fn specials_enabled() -> bool {
    true
}

fn default_consumables() -> bool {
    true
}

impl SimConfig {
    /// P-SIM-LIVE-CONTENT-1 STUB (compile-only surface; the implementer replaces the body): the content world the live
    /// server plays, every content field including the live hitbox mode. Returns `SimConfig::default()` until then, so
    /// the oracle tests compile and fail on their assertions.
    pub fn live_content() -> Self {
        Self::default()
    }
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            abilities: crate::abilities::Mode::Off,
            wish_lock_ms: crate::abilities::WISH_LOCK_MS,
            lifecycle: crate::ArenaMode::Off,
            initial_loot: false,
            consumables: true,
            hazards: crate::terrain::Mode::Off,
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 5.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: FactionMode::Off,
            mob_mode: crate::mob_runtime::MobMode::Off,
            regen: false,
            quests: false,
            training: false,
            dummies: false,
            walk_hints: None,
            hitboxes: crate::archetype::HitboxMode::LegacyCircle,
            mob_spacing: crate::archetype::MobSpacing::Auto,
            regen_in_combat: RegenInCombat::Legacy,
            camp_buffs: CampBuffRule::Legacy,
            frost_wish: FrostWish::Freeze,
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

#[cfg(test)]
mod regen_in_combat_encoding_tests {
    use super::{RegenInCombat, REGEN_IN_COMBAT_OFF_TAG};
    use crate::archetype::MobSpacing;
    use serde::de::{Deserialize, Deserializer, Visitor};
    use serde_json::{json, Value};

    /// A JSON value read as a format that is not human-readable (none ships today; this checks the other branch).
    struct Compact(Value);

    impl<'de> Deserializer<'de> for Compact {
        type Error = serde_json::Error;
        fn deserialize_any<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
            self.0.deserialize_any(v)
        }
        fn deserialize_option<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
            match self.0 {
                Value::Null => v.visit_none(),
                other => v.visit_some(Compact(other)),
            }
        }
        fn is_human_readable(&self) -> bool {
            false
        }
        serde::forward_to_deserialize_any! {
            bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit
            unit_struct newtype_struct seq tuple tuple_struct map struct enum identifier ignored_any
        }
    }

    #[test]
    fn json_keeps_off_and_null_and_refuses_the_hash_tag() {
        assert_eq!(
            serde_json::to_value(RegenInCombat::Off).unwrap(),
            json!("off")
        );
        assert_eq!(
            serde_json::to_value(RegenInCombat::Legacy).unwrap(),
            Value::Null
        );
        let read = |v: Value| serde_json::from_value::<RegenInCombat>(v);
        assert_eq!(read(json!("off")).unwrap(), RegenInCombat::Off);
        assert_eq!(read(Value::Null).unwrap(), RegenInCombat::Legacy);
        assert!(read(json!(REGEN_IN_COMBAT_OFF_TAG)).is_err());
        assert!(read(json!("Off")).is_err());
    }

    #[test]
    fn a_compact_format_reads_the_tag_and_refuses_off() {
        let read = |v: Value| RegenInCombat::deserialize(Compact(v));
        assert_eq!(
            read(json!(REGEN_IN_COMBAT_OFF_TAG)).unwrap(),
            RegenInCombat::Off
        );
        assert_eq!(read(Value::Null).unwrap(), RegenInCombat::Legacy);
        assert!(read(json!("off")).is_err());
    }

    #[test]
    fn the_hasher_folds_the_tag_not_mob_spacings_off() {
        use crate::hash::hash_of;
        assert_eq!(
            hash_of(0, &RegenInCombat::Off),
            hash_of(0, REGEN_IN_COMBAT_OFF_TAG)
        );
        assert_ne!(
            hash_of(0, &RegenInCombat::Off),
            hash_of(0, &MobSpacing::Off)
        );
        assert_eq!(hash_of(0, &MobSpacing::Off), hash_of(0, "off"));
        assert_eq!(hash_of(0, &RegenInCombat::Legacy), hash_of(0, &()));
    }
}
