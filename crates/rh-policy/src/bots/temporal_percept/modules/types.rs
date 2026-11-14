//! Complete private source feature-module contracts (P-BOT-MODULES-1).
//!
//! This is the new private typed input/context layer for the four unchanged legacy built-ins
//! (`brain/modules/{wishes,planning,chests,hazards}.ts`), their ordered registry and the genuinely missing chest
//! dependencies (`chestHunt.ts`, `abilityPolicy.ts`, `bots/chests.ts`). It is source-method data only: no World/Sim
//! handle, no authoritative ID resolver, no secret RNG, no wall clock, no public Brain/Bot wiring, no hidden live
//! state. A whole-object read is closed and atomic: nothing here coerces an unsupported/absent fact to a default.
//!
//! The public observation types are deliberately not extended. `ModulePercept` retains the declared source facts
//! (complete private extras, ordered events, full self record) that the public `Percept`/`Perception` narrows; a
//! caller must satisfy this contract explicitly, and the declared cfg **object identity** is the state key, not an
//! actor id or a structural value.

use super::super::data::MethodValue;
use crate::bots::paths::{RoomPathService, WalkAnswer};
use crate::bots::wish::{AiIntent, BlockedBy, WishDef, WISHES};
use rh_sim::mapgen::certify::source_hypot as js_hypot;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

#[cfg(test)]
pub(crate) use super::super::strategy::types::GoalState;
/// The private module layer keeps the already-admitted strategy/source contracts as its goal/intent language; the
/// source-shaped module lanes import everything they share through this module.
pub(crate) use super::super::strategy::types::{
    Goal, GoalDecision, GoalKind, GoalStatus, HoldWhy, MemoryApi, RngStream,
};
pub(crate) use crate::bots::types::{Intent, PersonaParams, ServerMs, TierParams};
pub(crate) use crate::bots::view::Features;

// ----------------------------------------------------------------------------------------------- shared chest constants
// shared/constants.ts (not yet ported as a whole; the module layer declares exactly the leaves it consumes).
pub(crate) const CHEST_SECONDS: f64 = 15.;
pub(crate) const CHEST_RANGE: f64 = 96.;
pub(crate) const CHEST_PANEL_SLACK: f64 = 8.;
pub(crate) const CHEST_BOOST_MAX_PICKS: f64 = 3.;
pub(crate) const TRADEOFF_RISK: f64 = 0.5;
pub(crate) const DANGER_RISK: f64 = 0.7;

/// JS `Math.hypot` (shared helper): correctly sourced through the admitted mapgen leaf, never `f64::hypot`.
pub(crate) fn dist(a: Vec2, b: Vec2) -> f64 {
    js_hypot(a.x - b.x, a.y - b.y)
}

// ----------------------------------------------------------------------------------------------------------- card facts

/// `CardCounts` (source `build`): insertion-ordered id -> count. Values are the source's own binary64 counts (the
/// bot floors where the source floors; it never normalises here). `None` is source `null` (not an empty record).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct CardCounts {
    pub(crate) entries: Vec<(String, f64)>,
}
impl CardCounts {
    pub(crate) fn count(&self, id: &str) -> f64 {
        self.entries
            .iter()
            .find(|(key, _)| key == id)
            .map_or(0., |(_, value)| *value)
    }
    /// source `countIn`/truthy-card checks count whole positive picks only where the source floors.
    pub(crate) fn count_in(&self, id: &str) -> f64 {
        let n = self.count(id);
        if n > 0. {
            n.floor()
        } else {
            0.
        }
    }
    pub(crate) fn set(&mut self, id: impl Into<String>, value: f64) {
        let id = id.into();
        match self.entries.iter_mut().find(|(key, _)| *key == id) {
            Some((_, slot)) => *slot = value,
            None => self.entries.push((id, value)),
        }
    }
    pub(crate) fn add_one(&mut self, id: &str) {
        let n = self.count(id) + 1.;
        self.set(id, n);
    }
    /// Source spread-then-`Math.max` merge order: the seen keys keep their places, local-only keys append.
    pub(crate) fn merged_max(&self, other: &CardCounts) -> CardCounts {
        let mut out = self.clone();
        for (id, value) in &other.entries {
            let next = out.count(id).max(*value);
            out.set(id.clone(), next);
        }
        out
    }
    pub(crate) fn owns_base(&self, base: &str) -> bool {
        super::choice::base_card_ids(base)
            .iter()
            .any(|id| self.count_in(id) > 0.)
    }
}

/// The part of the source `ChestSelf`/`cardScore` self the pure choice leaves read.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ChestSelf {
    pub(crate) faction: String,
    pub(crate) weapons: [Option<WeaponId>; 2],
    /// Source `slot?: 0 | 1`: `None` is absent (the source defaults to 0); an own `undefined` has the same read.
    pub(crate) slot: Option<u8>,
    /// Source `risk?: number`: `None` is absent (default 0.5).
    pub(crate) risk: Option<f64>,
    pub(crate) build: Option<CardCounts>,
}
impl ChestSelf {
    pub(crate) fn slot_or_zero(&self) -> u8 {
        self.slot.unwrap_or(0)
    }
}

// ------------------------------------------------------------------------------------------------ source module facts

/// One declared `extras.chests` row (RewardChestView as the module sees it). `options: None` is the source `null`
/// BLIND panel; `takenBy` is only present when the options are readable.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SourceChest {
    pub(crate) id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) expires_at: f64,
    /// `lifeMs?: number`; absent stays absent (a Trophy is born older than CHEST_SECONDS).
    pub(crate) life_ms: Option<f64>,
    pub(crate) options: Option<Vec<String>>,
    pub(crate) taken_by: Vec<String>,
    pub(crate) picked: bool,
}
impl SourceChest {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// Source `AbilityDef.ranks[i].targeting` as the cast policy consumes it (kind plus the fields that decision reads).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum WishTargeting {
    Self_,
    Unit {
        range: f64,
        los: bool,
        snap_radius: f64,
    },
    Point {
        range: f64,
        min_range: f64,
    },
    Dir,
}

/// One declared rank's policy-consumed facts (`rankOf` narrowing happens in the adapter, not the reader). A captured
/// structurally-valid guard rank (`ranks: [{}]`) keeps its absent members absent: source `defOf` is true, but a decision
/// is never taken from an empty `ai` list, and a decision that would consume a missing member is refused by the finite
/// profile check before any state mutation. `raw` retains the complete declared rank object.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AbilityRank {
    pub(crate) cast_ms: Option<f64>,
    pub(crate) targeting: Option<WishTargeting>,
    pub(crate) hides_caster: bool,
    /// `do: "blink"` effect distances, in source effect order.
    pub(crate) blink: Option<(f64, f64)>,
    /// A declared `do: "wall"` effect (legacy 78dd8bd4 Frost Wall). STUB (P-FROST-WALL-BOTS-1): the readers leave it false.
    pub(crate) wall: bool,
    pub(crate) raw: MethodValue,
}

/// The source-opaque `extras.wish.def`, parsed losslessly enough to guard and decide on it. `raw` keeps the complete
/// declared object (unconsumed ability fields included) for callback/diagnostic use; no catalog row is substituted.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AbilityDef {
    pub(crate) name: String,
    pub(crate) ai: Vec<AiIntent>,
    pub(crate) blocked_by: Vec<BlockedBy>,
    pub(crate) ranks: Vec<AbilityRank>,
    pub(crate) raw: MethodValue,
}
impl AbilityDef {
    /// Source `rankOf`: `floor(finite ? rank : 1)`, clamped to 1..=ranks.length (a rank is a number, never narrowed).
    pub(crate) fn rank_of(&self, rank: f64) -> Option<&AbilityRank> {
        let bare = if rank.is_finite() { rank } else { 1. };
        let index = bare.floor().max(1.).min(self.ranks.len() as f64) as usize;
        self.ranks.get(index - 1)
    }
    /// Source `hidesCaster(def, rank)` over the declared rank effects.
    pub(crate) fn hides(&self, rank: f64) -> bool {
        self.rank_of(rank).is_some_and(|r| r.hides_caster)
    }
    /// Source `rankOf` with the rank's complete declared record (finite-profile validation lives in the adapter).
    pub(crate) fn rank_raw(&self, rank: f64) -> Option<&MethodValue> {
        self.rank_of(rank).map(|r| &r.raw)
    }
    pub(crate) fn blink(&self, rank: f64) -> Option<(f64, f64)> {
        self.rank_of(rank).and_then(|r| r.blink)
    }
    /// Source `defOf` guard: object with non-empty `ranks`, array `ai`, array `blockedBy`.
    pub(crate) fn guard_ok(&self) -> bool {
        !self.ranks.is_empty()
    }
}
/// A catalog Wish row for cross-checking only; the declared def is authoritative for decisions.
pub(crate) fn catalog_wish(id: &str) -> Option<&'static WishDef> {
    WISHES.iter().find(|def| def.name.eq_ignore_ascii_case(id))
}

/// Source `extras.wish` (WishView): an opaque ability id, declared def, numeric rank and the weapon bar's clocks.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WishView {
    pub(crate) ability: String,
    pub(crate) def: Option<AbilityDef>,
    pub(crate) rank: f64,
    pub(crate) ready_at: f64,
    pub(crate) casting: bool,
}
impl WishView {
    /// Source `defOf(view)`: a valid opaque def object.
    pub(crate) fn def_of(&self) -> Option<&AbilityDef> {
        self.def.as_ref().filter(|def| def.guard_ok())
    }
}

/// Source percept `self` (the whole object is retained for callback arguments; typed leaves are what modules read).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleSelf {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) facing: f64,
    pub(crate) status: String,
    pub(crate) hp: f64,
    pub(crate) max_hp: f64,
    pub(crate) barrier: f64,
    /// Source `faction: FactionId | null`, retained as its string spelling (`""` for null) for the card fits.
    pub(crate) faction_text: String,
    pub(crate) faction: Option<FactionId>,
    pub(crate) weapons: [Option<WeaponId>; 2],
    pub(crate) slot: u8,
    pub(crate) attack_target: Option<String>,
    pub(crate) build: Option<CardCounts>,
    /// The complete declared source self object, used only to reproduce declared service-callback arguments.
    pub(crate) record: MethodValue,
}
impl ModuleSelf {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    pub(crate) fn hp_frac(&self) -> f64 {
        if self.max_hp > 0. {
            self.hp / self.max_hp
        } else {
            1.
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleHud {
    pub(crate) phase: String,
    pub(crate) in_coliseum: bool,
    pub(crate) gates_locked: bool,
    pub(crate) patience_ends_at: f64,
}

/// Source percept fighter row (the module subsets: chest crowd, Wish foe/threat, hazard facts).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleFighter {
    pub(crate) id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) status: String,
    pub(crate) dist: f64,
    pub(crate) los: bool,
    pub(crate) targetable: bool,
    pub(crate) vx: f64,
    pub(crate) vy: f64,
    pub(crate) faction: Option<FactionId>,
}
impl ModuleFighter {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// Source percept mob row (the module subsets: awake/far chest safety, farm target facts).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleMob {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) status: String,
    pub(crate) dist: f64,
    pub(crate) los: bool,
}
impl ModuleMob {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// The source `ChestLike` row a hunt receives (BLIND options for a chest whose cards are shut). `raw` retains the exact
/// declared source row when there is one, so declared path-callback arguments reproduce the source object; a row the chests
/// module derives itself (far chest converted from the percept) has no raw and encodes in the source literal's order.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HuntChest {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) expires_at: f64,
    pub(crate) life_ms: Option<f64>,
    pub(crate) options: Vec<String>,
    pub(crate) taken_by: Vec<String>,
    pub(crate) pickers: Vec<String>,
    pub(crate) raw: Option<MethodValue>,
}
impl HuntChest {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    /// The source object the hunt/callback receives. The derived far-chest literal is
    /// `{ id, kind, x, y, expiresAt, ...(lifeMs), options, takenBy, pickers }`.
    pub(crate) fn data(&self) -> MethodValue {
        if let Some(raw) = &self.raw {
            return raw.clone();
        }
        let mut fields = vec![
            ("id".to_string(), MethodValue::Str(self.id.clone())),
            ("kind".to_string(), MethodValue::Str(self.kind.clone())),
            ("x".to_string(), MethodValue::Num(self.x)),
            ("y".to_string(), MethodValue::Num(self.y)),
            ("expiresAt".to_string(), MethodValue::Num(self.expires_at)),
        ];
        if let Some(life) = self.life_ms {
            fields.push(("lifeMs".to_string(), MethodValue::Num(life)));
        }
        fields.push((
            "options".to_string(),
            MethodValue::Arr(self.options.iter().cloned().map(MethodValue::Str).collect()),
        ));
        fields.push((
            "takenBy".to_string(),
            MethodValue::Arr(
                self.taken_by
                    .iter()
                    .cloned()
                    .map(MethodValue::Str)
                    .collect(),
            ),
        ));
        fields.push((
            "pickers".to_string(),
            MethodValue::Arr(self.pickers.iter().cloned().map(MethodValue::Str).collect()),
        ));
        MethodValue::Obj(fields)
    }
}

/// The source hunt input's `self` (ChestSelf plus the bot's room id and position).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HuntSelf {
    pub(crate) id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) base: ChestSelf,
    pub(crate) raw: Option<MethodValue>,
}
impl HuntSelf {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    pub(crate) fn data(&self) -> MethodValue {
        if let Some(raw) = &self.raw {
            return raw.clone();
        }
        let mut fields = vec![
            ("id".to_string(), MethodValue::Str(self.id.clone())),
            ("x".to_string(), MethodValue::Num(self.x)),
            ("y".to_string(), MethodValue::Num(self.y)),
            (
                "faction".to_string(),
                MethodValue::Str(self.base.faction.clone()),
            ),
            (
                "weapons".to_string(),
                MethodValue::Arr(
                    self.base
                        .weapons
                        .iter()
                        .map(|weapon| {
                            weapon.map_or(MethodValue::Null, |w| {
                                MethodValue::Str(weapon_name(w).into())
                            })
                        })
                        .collect(),
                ),
            ),
        ];
        if let Some(slot) = self.base.slot {
            fields.push(("slot".to_string(), MethodValue::Num(f64::from(slot))));
        }
        if let Some(risk) = self.base.risk {
            fields.push(("risk".to_string(), MethodValue::Num(risk)));
        }
        match &self.base.build {
            None => fields.push(("build".to_string(), MethodValue::Null)),
            Some(build) => fields.push((
                "build".to_string(),
                MethodValue::Obj(
                    build
                        .entries
                        .iter()
                        .map(|(key, value)| (key.clone(), MethodValue::Num(*value)))
                        .collect(),
                ),
            )),
        }
        MethodValue::Obj(fields)
    }
}
pub(crate) fn weapon_name(weapon: WeaponId) -> &'static str {
    match weapon {
        WeaponId::Sword => "sword",
        WeaponId::Bow => "bow",
        WeaponId::Wand => "wand",
        WeaponId::Shield => "shield",
        WeaponId::Axe => "axe",
        WeaponId::Fists => "fists",
    }
}

/// One ordered percept event as the module layer consumes it: the private event keeps its complete message record.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleEvent {
    pub(crate) kind: String,
    pub(crate) t: f64,
    /// `private` events: the declarative message type.
    pub(crate) type_: Option<String>,
    pub(crate) msg: Option<MethodValue>,
    pub(crate) record: MethodValue,
}

/// The complete declared module percept. Ordered rows and optional absence are preserved; nothing is reconstructed.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModulePercept {
    pub(crate) now: ServerMs,
    pub(crate) view_t: f64,
    pub(crate) self_: ModuleSelf,
    pub(crate) hud: ModuleHud,
    pub(crate) fighters: Vec<ModuleFighter>,
    pub(crate) mobs: Vec<ModuleMob>,
    /// `extras.chests`: absent stays absent (source `?? []` only where it reads that way).
    pub(crate) chests: Option<Vec<SourceChest>>,
    /// `extras.wish`: absent stays absent.
    pub(crate) wish: Option<WishView>,
    /// `extras.effects`: id -> source bit number (raw; readers validate shape, the module applies JS bit reads).
    pub(crate) effects: Vec<(String, f64)>,
    pub(crate) events: Vec<ModuleEvent>,
    pub(crate) features: Features,
}
impl ModulePercept {
    pub(crate) fn own_effects(&self) -> u32 {
        self.effects
            .iter()
            .find(|(id, _)| *id == self.self_.id)
            .map_or(0, |(_, value)| js_to_int32(*value))
    }
    pub(crate) fn alive(&self) -> bool {
        self.self_.status == "alive"
    }
}
/// JS ToInt32 for the declared numeric bit read (`effects[id] & mask`), never a blind finite-to-zero coercion.
pub(crate) fn js_to_int32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    (value.trunc() as i64 as i32) as u32
}

// ------------------------------------------------------------------------------------------------ cfg identity/config

/// The source `ctx.cfg` object identity. In source a module's per-bot state is a `WeakMap<object, State>` keyed on the
/// **same cfg object**; equal-valued distinct config objects isolate state and equal identity continues it. The module
/// layer therefore requires an explicit identity token (assigned by the composing caller), never actor/name/seed/struct
/// equality.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct CfgToken(pub(crate) u64);

/// The declared per-cfg facts a module reads. `map` is the open declared map; the paths service owns the collision
/// view and the frame clock. `learned` is the declared read-only bias callback surface.
pub(crate) struct ModuleConfig<'a> {
    pub(crate) token: CfgToken,
    pub(crate) id: String,
    pub(crate) tier: &'a TierParams,
    pub(crate) persona: &'a PersonaParams,
    pub(crate) map: &'a TileMap,
    /// The declared map's terrain layer (row-major w*h, source `GameMap.terrain`), supplied by the caller from the same
    /// declared map the collision TileMap comes from. Hand-built source arenas have no admitted full-layer metadata, so
    /// the private module layer takes the declared terrain slice explicitly instead of inventing layers.
    pub(crate) terrain: &'a [u8],
    /// The planning screen's static map view (camps + spawn pool) derived from the same declared map.
    pub(crate) plan_map: &'a crate::bots::planning::PlanMap,
    pub(crate) features: &'a Features,
    pub(crate) learned: &'a dyn LearnedBiasFn,
}

/// Source `LearnedBias` as the module layer calls it (`enabled` gate plus the declared key lookup). The admitted
/// strategy trait has the same shape; this further-narrowed alias keeps the module closure explicit.
pub(crate) trait LearnedBiasFn {
    fn enabled(&self) -> bool;
    fn bias(&self, key: &str) -> f64;
}
impl LearnedBiasFn for () {
    fn enabled(&self) -> bool {
        false
    }
    fn bias(&self, _key: &str) -> f64 {
        0.
    }
}

// ----------------------------------------------------------------------------------------------------- services/RNG

/// The source `PathService` methods the modules call, in the order they call them. Implemented over the admitted
/// `RoomPathService` in production; declared replay traces wrap the same service and record every argument/result.
pub(crate) trait ModulePaths {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer>;
    fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>>;
    fn los(&self, a: Vec2, b: Vec2) -> bool;
    fn clear(&self, a: Vec2, b: Vec2) -> bool;
    fn collision_map(&self) -> &TileMap;
    /// Source `paths.walk(me, chestObject)` (the chests hunt and a real hunter walk pass the row object): production reads
    /// only its coordinates; a declared replay wrapper records the exact source object.
    fn walk_target(&mut self, from: Vec2, target: &HuntChest) -> Option<WalkAnswer> {
        self.walk(from, target.pos())
    }
    /// Source `paths.los(me, chestObject)`.
    fn los_target(&self, from: Vec2, target: &HuntChest) -> bool {
        self.los(from, target.pos())
    }
}
impl ModulePaths for RoomPathService {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        RoomPathService::walk(self, from, to)
    }
    fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
        RoomPathService::path(self, from, to)
    }
    fn los(&self, a: Vec2, b: Vec2) -> bool {
        RoomPathService::los(self, a, b)
    }
    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        RoomPathService::clear(self, a, b)
    }
    fn collision_map(&self) -> &TileMap {
        RoomPathService::collision_map(self)
    }
}

/// The three independent source `BrainContext` RNG lanes. Only the lanes the source calls are recorded/consumed.
pub(crate) struct RngLanes<'a> {
    pub(crate) decide: &'a mut dyn RngStream,
    pub(crate) motor: &'a mut dyn RngStream,
    pub(crate) lapse: &'a mut dyn RngStream,
}

/// One source module call's environment: declared cfg identity/facts, the current source percept, admitted Memory,
/// the path service, the per-cfg log sink, the RNG lanes and the caller's `engaged` fact. No hidden clock.
pub(crate) struct ModuleContext<'a> {
    pub(crate) cfg: &'a ModuleConfig<'a>,
    pub(crate) p: &'a ModulePercept,
    pub(crate) mem: &'a dyn MemoryApi,
    pub(crate) paths: &'a mut dyn ModulePaths,
    /// The declared collision view for the current gate state (source `withGates(map)` semantics): the composing
    /// caller supplies the open map normally and the gates-sealed copy when the percept says the gates are locked.
    /// Modules that derive collision internally (the Wish blink policy's `withGates`) read this instead of calling the
    /// path service's `collisionMap`, so no callback the source does not make is invented.
    pub(crate) collision: &'a TileMap,
    pub(crate) log: &'a dyn Fn(&str),
    pub(crate) rng: RngLanes<'a>,
    pub(crate) engaged: bool,
}
impl ModuleContext<'_> {
    pub(crate) fn now(&self) -> ServerMs {
        self.p.now
    }
}

// ----------------------------------------------------------------------------------------------------------- outputs

/// Source `TacticsOutput` as a module hook returns it (`{ intents, status, attacking }`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ModuleOutput {
    pub(crate) intents: Vec<Intent>,
    pub(crate) status: GoalStatus,
    pub(crate) attacking: bool,
}
impl ModuleOutput {
    pub(crate) fn new(intents: Vec<Intent>, status: GoalStatus, attacking: bool) -> Self {
        Self {
            intents,
            status,
            attacking,
        }
    }
    pub(crate) fn empty_attacking() -> Self {
        Self::new(Vec::new(), GoalStatus::done(""), false)
    }
}

/// The source `FeatureModule` surface. Absent hooks are represented by the **presence list**, so `enabled` filtering,
/// direct-method dispatch and the registry inventory cannot collapse the source's missing-vs-empty distinction. A
/// direct method call does not re-check `enabled`; only the registry filter does.
pub(crate) trait SourceModule {
    fn id(&self) -> &'static str;
    fn enabled(&self, features: &Features) -> bool;
    /// The source module object's own function keys, in declaration order (the registry lists exactly these).
    fn hooks(&self) -> &'static [&'static str];
    fn observe(&mut self, _ctx: &mut ModuleContext<'_>) {}
    fn goals(&mut self, _ctx: &mut ModuleContext<'_>) -> Vec<GoalDecision> {
        Vec::new()
    }
    fn intents(&mut self, _ctx: &mut ModuleContext<'_>, _goal: &Goal) -> Vec<Intent> {
        Vec::new()
    }
    fn act(&mut self, _ctx: &mut ModuleContext<'_>, _goal: &Goal) -> ModuleOutput {
        ModuleOutput::new(Vec::new(), GoalStatus::failed("missing module act"), false)
    }
    fn adjust<'a>(
        &mut self,
        _ctx: &mut ModuleContext<'_>,
        _goal: &Goal,
        intents: &'a [Intent],
    ) -> std::borrow::Cow<'a, [Intent]> {
        std::borrow::Cow::Borrowed(intents)
    }
}

/// The registered built-ins, in source declaration order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum ModuleId {
    Wishes,
    Planning,
    Chests,
    Hazards,
}
impl ModuleId {
    pub(crate) const DEFAULT_ORDER: [Self; 4] =
        [Self::Wishes, Self::Planning, Self::Chests, Self::Hazards];
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Wishes => "wishes",
            Self::Planning => "planning",
            Self::Chests => "chests",
            Self::Hazards => "hazards",
        }
    }
    /// The function keys each actual module object declares, in `Object.keys` order.
    pub(crate) fn hooks(self) -> &'static [&'static str] {
        match self {
            Self::Wishes => &["enabled", "observe", "goals", "intents", "act"],
            Self::Planning => &["enabled", "observe", "intents"],
            Self::Chests => &["enabled", "observe", "goals", "intents", "act"],
            Self::Hazards => &["enabled", "intents", "adjust"],
        }
    }
}

// ------------------------------------------------------------------------------------------- cross-module source goals

/// The source module goal the chests layer aims at (`{ kind:"module", module:"chests", data:{ chest } }`).
pub(crate) fn module_goal(module: &str, data: MethodValue) -> Goal {
    Goal::Module {
        module: module.to_owned(),
        data,
    }
}

/// The chest id from a declared source module goal data (`String(goal.data["chest"])`), or the source string spelling
/// of `undefined` (`"undefined"`) exactly as the JS conversion produces. Arbitrary strings stay strings; no actor id.
pub(crate) fn chest_id_of(goal: &Goal) -> Option<String> {
    let Goal::Module { module, data } = goal else {
        return None;
    };
    if module != "chests" {
        return None;
    }
    let MethodValue::Obj(fields) = data else {
        return Some("undefined".into());
    };
    let value = fields
        .iter()
        .find(|(key, _)| key == "chest")
        .map(|(_, value)| value.clone())
        .unwrap_or(MethodValue::Undefined);
    Some(js_string(value))
}

/// JS `String(value)` for the declared MethodValue subset.
pub(crate) fn js_string(value: MethodValue) -> String {
    match value {
        MethodValue::Undefined => "undefined".into(),
        MethodValue::Null => "null".into(),
        MethodValue::Bool(v) => v.to_string(),
        MethodValue::Num(v) => super::super::strategy::types::js_number(v),
        MethodValue::Str(v) => v,
        MethodValue::Arr(rows) => rows
            .into_iter()
            .map(|row| match row {
                MethodValue::Null | MethodValue::Undefined => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        MethodValue::Obj(_) => "[object Object]".into(),
    }
}

/// Convenience: the hidden/casting/rooted/silenced bit constants the modules and policy read (shared/status.ts).
pub(crate) const EFFECT_STUNNED: u32 = 1;
pub(crate) const EFFECT_ROOTED: u32 = 2;
pub(crate) const EFFECT_SILENCED: u32 = 4;
pub(crate) const EFFECT_HIDDEN: u32 = 256;
pub(crate) const EFFECT_CASTING: u32 = 4096;
