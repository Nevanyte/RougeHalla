//! Private source contracts for the complete legacy tactics layer (P-BOT-TACTICS-1).
//!
//! These are declared source-method types only: no World/Sim handle, public Brain/HumanBot wiring, observation or
//! protocol change, live identity resolver or public Goal adapter. Inputs are an owned declared Percept, the admitted
//! private Memory view, Knowledge, the source path service and the declared decide stream; outputs are the source's
//! ordered intents, GoalStatus, attacking flag and lifetime stats. The private Goal union is reused from the admitted
//! strategy layer (P-BOT-STRATEGY-1) without any type or algorithm change.

pub(crate) use super::super::memory::{
    CampGeom, ContainerMemory, ContainersWeapon, FighterMemory, MobMemory, SelfMemory, Whereabouts,
};
pub(crate) use super::super::strategy::types::{
    Goal, GoalKind, GoalState, GoalStatus, HoldWhy, RoamWhy,
};
use crate::bots::types::{
    BotWeapon, PersonaParams, ServerMs, Stimulus, StimulusKind, TierParams, PRIORITY_CHORE,
    PRIORITY_COMBAT, PRIORITY_GOAL, PRIORITY_REFLEX,
};
use crate::bots::view::Features;
pub(crate) use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

/// A source value that is either absent, explicitly Undefined, or present. The legacy `windupMult` is the one optional
/// number on SelfView and `self.windupMult ?? 1` reads absent and explicit Undefined the same, but the declared witness
/// keeps them apart and so does the callback encoding.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Presence<T> {
    Absent,
    Undefined,
    Value(T),
}
impl<T: Copy> Presence<T> {
    pub(crate) fn value_or(self, default: T) -> T {
        match self {
            Self::Value(value) => value,
            Self::Absent | Self::Undefined => default,
        }
    }
}

/// Source FighterId (`types.ts` FighterId): an arbitrary string identity, never an alias or a truncated key.
pub(crate) type FighterId = String;

/// Source `TacticsStats` (tactics.ts): both `stats()` and `getStats()` return this same shape.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct TacticsStats {
    pub dodges: u64,
    pub jukes: u64,
    pub kite_cycles: u64,
    pub retreats: u64,
    pub mob_targets: u64,
}

/// Source `TacticsOutput` (types.ts): ordered intents, one goal status and the "server is attacking for it" flag.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticsOutput {
    pub intents: Vec<Intent>,
    pub status: GoalStatus,
    pub attacking: bool,
}

/// The one cross-language boundary this packet maps: the unchanged World loot route dereferences the missing last
/// waypoint of the explicitly declared empty (not null) test-service route. The real service normalises an empty
/// `findPath` answer to null; this error exists only at that declared missing-waypoint boundary and carries the source
/// exception identity for the replay comparator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TacticsError {
    EmptyWorldRoute,
}
impl TacticsError {
    /// The source exception name the unchanged World method raises at the missing-waypoint dereference.
    pub(crate) fn thrown_name(self) -> &'static str {
        "TypeError"
    }
    /// The source exception message (`next.x` on `undefined`, as V8 prints it).
    pub(crate) fn thrown_message(self) -> &'static str {
        "Cannot read properties of undefined (reading 'x')"
    }
}

/// A declared argument-sensitive path-service denial descriptor (the frozen witness's `path`/`env.path`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum PathDescriptor {
    /// Deny any request whose from/to distance exceeds `radius` (some `los`/`clear` calls are still allowed).
    RadiusDenial { radius: f64 },
    /// Deny any request whose target `x` is at or beyond `x`.
    HalfPlane { x: f64 },
}

/// Source `FightRef.kind`: which goal family opened the fight (it only changes the bounty rule's hunt check).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FightKind {
    Farm,
    Hunt,
    Fight,
}
impl FightKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Farm => "farm",
            Self::Hunt => "hunt",
            Self::Fight => "fight",
        }
    }
}

/// Source `FightRef`: arbitrary source identity plus the opening goal kind.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FightRef {
    pub id: FighterId,
    pub kind: FightKind,
}

/// Source `createTactics`'s resolved non-Memory configuration: the full resolved tier/persona values (the fixture's
/// `tierValues`/`personaValues`), the declared map, features and the room path budget.
#[derive(Clone, Debug)]
pub(crate) struct TacticsConfig {
    pub id: FighterId,
    pub name: String,
    pub seed: u32,
    pub tier: TierParams,
    pub persona: PersonaParams,
    pub map: TacticsMap,
    pub features: Features,
    pub path_budget: u32,
    /// The case-level declared path-service denial descriptor (`config.path`), applied to every operation.
    pub path: Option<PathDescriptor>,
}

/// The declared source `GameMap` surface the tactics closure reads: the collision tiles (real path service and geometry
/// leaves), the region grid only for `inColiseum`, the declared coliseum centre, and the Memory camp geometry.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticsMap {
    pub tile_map: TileMap,
    pub width: u32,
    pub height: u32,
    /// Row-major REGION_IDS indices (1..5 are the faction zones, 6 is "coliseum").
    pub region_grid: Vec<u8>,
    pub coliseum_centre: Vec2,
    pub camps: Vec<CampGeom>,
}
impl TacticsMap {
    /// Source `inColiseum(map, x, y)` = `regionAt(map, x, y) === "coliseum"`: the region grid, out of bounds "none".
    pub(crate) fn in_coliseum(&self, x: f64, y: f64) -> bool {
        let (tx, ty) = (rh_sim::map::world_to_tile(x), rh_sim::map::world_to_tile(y));
        if tx < 0 || ty < 0 || tx >= i64::from(self.width) || ty >= i64::from(self.height) {
            return false;
        }
        self.region_grid[ty as usize * self.width as usize + tx as usize] == COLISEUM_REGION_CODE
    }
}

/// REGION_IDS = ["none", "fire", "sentenced", "plague", "frost", "holy", "coliseum"].
pub(crate) const COLISEUM_REGION_CODE: u8 = 6;

// --------------------------------------------------------------------------------------------------------------- intents

/// Source `IntentTiming` is reused from the private source bot contracts (types.ts IntentTiming).
pub(crate) use crate::bots::types::IntentTiming;

/// Source `IntentBody` as the tactics layer emits it: lock, move, stop, swap and pickup are the only kinds the legacy
/// tactics closure produces (cast/plan/choose belong to modules, which this packet does not run).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum IntentBody {
    Lock { target: FighterId, at: Vec2 },
    Move { to: RouteElement },
    Stop {},
    Swap { slot: u8 },
    Pickup { container: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IntentKind {
    Lock,
    Move,
    Stop,
    Swap,
    Pickup,
}
impl IntentKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Lock => "lock",
            Self::Move => "move",
            Self::Stop => "stop",
            Self::Swap => "swap",
            Self::Pickup => "pickup",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IntentChannel {
    Order,
    Swap,
    Pickup,
    Cast,
    Menu,
}

impl IntentBody {
    pub(crate) fn kind(&self) -> IntentKind {
        match self {
            Self::Lock { .. } => IntentKind::Lock,
            Self::Move { .. } => IntentKind::Move,
            Self::Stop {} => IntentKind::Stop,
            Self::Swap { .. } => IntentKind::Swap,
            Self::Pickup { .. } => IntentKind::Pickup,
        }
    }
    pub(crate) fn channel(&self) -> IntentChannel {
        match self {
            Self::Lock { .. } | Self::Move { .. } | Self::Stop {} => IntentChannel::Order,
            Self::Swap { .. } => IntentChannel::Swap,
            Self::Pickup { .. } => IntentChannel::Pickup,
        }
    }
}

/// One source `Intent` (types.ts): the body, priority, timing/stimulus and why.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Intent {
    pub body: IntentBody,
    pub priority: u8,
    pub timing: IntentTiming,
    pub why: String,
}
impl Intent {
    pub(crate) fn kind(&self) -> IntentKind {
        self.body.kind()
    }
}

/// PRIORITY (types.ts) as the tactics layer uses it.
pub(crate) mod priority {
    pub(crate) const REFLEX: u8 = super::PRIORITY_REFLEX;
    pub(crate) const COMBAT: u8 = super::PRIORITY_COMBAT;
    pub(crate) const GOAL: u8 = super::PRIORITY_GOAL;
    pub(crate) const CHORE: u8 = super::PRIORITY_CHORE;
}

// ---------------------------------------------------------------------------------------------------------- percept

/// The source `Percept.self` (SelfView): every declared field, with the one optional `windupMult` kept apart.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticSelf {
    pub id: FighterId,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp: f64,
    pub max_hp: f64,
    pub barrier: f64,
    pub faction: Option<FactionId>,
    pub weapons: [Option<WeaponId>; 2],
    pub slot: u8,
    pub attack_target: Option<FighterId>,
    pub draw_started_at: ServerMs,
    pub ready_at: ServerMs,
    pub immune_until: ServerMs,
    pub sig: f64,
    pub brand: f64,
    pub power: f64,
    pub as_mult: f64,
    pub windup_mult: Presence<f64>,
    pub speed_mult: f64,
    pub kills: f64,
    pub mob_kills: f64,
    pub gv: f64,
    pub bounty: f64,
    pub move_seq: f64,
}
impl TacticSelf {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    pub(crate) fn hp_share(&self) -> f64 {
        if self.max_hp > 0. {
            self.hp / self.max_hp
        } else {
            1.
        }
    }
    /// Source `self.windupMult ?? 1`.
    pub(crate) fn windup_mult(&self) -> f64 {
        self.windup_mult.value_or(1.)
    }
    pub(crate) fn weapon_in_hand(&self) -> Option<WeaponId> {
        self.weapons[usize::from(self.slot.min(1))]
    }
}

/// The source `Percept.hud` (HudView): retained in full so the declared facts stay complete.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticHud {
    pub phase: String,
    pub training: bool,
    pub lobby_ends_at: ServerMs,
    pub raid_started_at: ServerMs,
    pub patience_ends_at: ServerMs,
    pub sudden_death_at: ServerMs,
    pub in_coliseum: bool,
    pub gates_locked: bool,
    pub started_with: f64,
    pub alive: f64,
    pub player_count: f64,
    pub min_players: f64,
    pub winner: String,
}

/// The source `Percept.fighters[i]` (FighterView).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticFighter {
    pub id: FighterId,
    pub name: String,
    pub bot: bool,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp_frac: f64,
    pub barrier_frac: f64,
    pub faction: Option<FactionId>,
    pub in_hand: Option<WeaponId>,
    pub draw_started_at: ServerMs,
    pub bounty: f64,
    pub immune: bool,
    pub sig: f64,
    pub brand: f64,
    pub targetable: bool,
    pub vx: f64,
    pub vy: f64,
    pub dist: f64,
    pub los: bool,
    pub tint: f64,
    pub central: bool,
}
impl TacticFighter {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// The source `Percept.mobs[i]` (MobView).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticMob {
    pub id: FighterId,
    pub type_: Option<String>,
    pub kind: String,
    pub name: String,
    pub faction: Option<FactionId>,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp_frac: f64,
    pub in_hand: Option<WeaponId>,
    pub draw_started_at: ServerMs,
    pub sig: f64,
    pub brand: f64,
    pub vx: f64,
    pub vy: f64,
    pub dist: f64,
    pub los: bool,
    pub central: bool,
}
impl TacticMob {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// The source `Percept.containers[i]` (ContainerView).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticContainer {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub closed: bool,
    /// `undefined` = cannot tell from here; `null` = nothing in it.
    pub weapon: ContainersWeapon,
    pub interactable: bool,
    pub dist: f64,
}
impl TacticContainer {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProjectileKind {
    Arrow,
    Ball,
}
impl ProjectileKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Arrow => "arrow",
            Self::Ball => "ball",
        }
    }
}

/// The source `Percept.projectiles[i]` (ProjectileView).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticProjectile {
    pub id: String,
    pub kind: ProjectileKind,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub x0: f64,
    pub y0: f64,
    pub t0: ServerMs,
    pub range: f64,
    pub from: Option<FighterId>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticMinimapMob {
    pub id: FighterId,
    pub x: f64,
    pub y: f64,
    pub faction: Option<FactionId>,
    pub elite: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticMinimap {
    pub t: ServerMs,
    pub mobs: Vec<TacticMinimapMob>,
    pub gates_locked: bool,
}

/// The source `ObservedEvent` union (EventView).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TacticEventKind {
    Windup {
        by: FighterId,
        weapon: WeaponId,
        a: f64,
        ms: f64,
    },
    Swing {
        by: FighterId,
        weapon: WeaponId,
        a: f64,
    },
    Hit {
        id: FighterId,
        by: Option<FighterId>,
        amount: f64,
        weapon: Option<WeaponId>,
        sig: Option<String>,
    },
    Block {
        id: FighterId,
        by: Option<FighterId>,
        weapon: Option<WeaponId>,
    },
    Stagger {
        id: FighterId,
    },
    Cancel {
        id: FighterId,
    },
    ProjEnd {
        id: String,
        proj: ProjectileKind,
        reason: String,
    },
    Death {
        id: FighterId,
        name: String,
        by: Option<FighterId>,
        mob: bool,
    },
    Heal {
        id: FighterId,
        amount: f64,
    },
    Teleport,
    Bounty {
        id: FighterId,
        name: String,
        bounty: f64,
    },
    Victory {
        id: Option<FighterId>,
        name: Option<String>,
        draw: bool,
    },
    Toast {
        text: String,
    },
    Result,
    Private {
        type_: String,
        msg: super::super::data::MethodValue,
    },
    Ext {
        fx: String,
        data: super::super::data::MethodValue,
    },
}
impl TacticEventKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Windup { .. } => "windup",
            Self::Swing { .. } => "swing",
            Self::Hit { .. } => "hit",
            Self::Block { .. } => "block",
            Self::Stagger { .. } => "stagger",
            Self::Cancel { .. } => "cancel",
            Self::ProjEnd { .. } => "projEnd",
            Self::Death { .. } => "death",
            Self::Heal { .. } => "heal",
            Self::Teleport => "teleport",
            Self::Bounty { .. } => "bounty",
            Self::Victory { .. } => "victory",
            Self::Toast { .. } => "toast",
            Self::Result => "result",
            Self::Private { .. } => "private",
            Self::Ext { .. } => "ext",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TacticEvent {
    pub t: ServerMs,
    pub at: Option<Vec2>,
    pub kind: TacticEventKind,
}

/// The consumed `Percept.extras` subset: the camp/chest/plan facts the admitted Memory folds read. The corpus declares
/// no other extras key; any other key is rejected by the strict reader rather than silently defaulted.
pub(crate) type TacticExtras = super::super::memory::source_input::PerceptExtras;

/// The complete declared source Percept (Percept, types.ts).
#[derive(Clone, Debug)]
pub(crate) struct TacticPercept {
    pub now: ServerMs,
    pub view_t: ServerMs,
    pub self_: TacticSelf,
    pub hud: TacticHud,
    pub fighters: Vec<TacticFighter>,
    pub mobs: Vec<TacticMob>,
    pub containers: Vec<TacticContainer>,
    pub projectiles: Vec<TacticProjectile>,
    pub minimap: TacticMinimap,
    pub events: Vec<TacticEvent>,
    pub extras: TacticExtras,
    pub features: Features,
}
impl TacticPercept {
    pub(crate) fn pos(&self) -> Vec2 {
        self.self_.pos()
    }
}

/// Source `Foe` (tactics/fight.ts): whatever the bot is fighting, a player or a mob, as seen now or as remembered.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Foe {
    pub id: FighterId,
    pub mob: bool,
    /// On screen now (a click can land on it); false = remembered.
    pub seen: bool,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub dist: f64,
    pub los: bool,
    pub facing: f64,
    pub hp_frac: f64,
    pub faction: Option<FactionId>,
    /// The weapon in its hand (a mob's own, else its region's); None = not seen yet.
    pub theirs: Option<WeaponId>,
    pub targetable: bool,
}
impl Foe {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// Source `Lookup`: current/remembered lookup state.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Lookup {
    Ready(Foe),
    Dead,
    Lost,
}

/// Source WorldGoal: the goals with no fight in them (tactics/world.ts).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum WorldGoal {
    Loot { container: String },
    Roam { to: Vec2, why: RoamWhy },
    Hold { at: Vec2, why: HoldWhy },
    Idle,
}
impl WorldGoal {
    pub(crate) fn from_goal(goal: &Goal) -> Option<Self> {
        Some(match goal {
            Goal::Loot { container } => Self::Loot {
                container: container.clone(),
            },
            Goal::Roam { to, why } => Self::Roam { to: *to, why: *why },
            Goal::Hold { at, why } => Self::Hold { at: *at, why: *why },
            Goal::Idle => Self::Idle,
            _ => return None,
        })
    }
}

// ---------------------------------------------------------------------------------------------- paths / memory / rng

/// One source path-service target: a plain point, or the very Foe/ContainerView object the source passes (the
/// observed `findPath` shortcut can hand that object back as a waypoint and the source then keeps its identity).
#[derive(Clone, Copy, Debug)]
pub(crate) enum PathArg<'a> {
    Point(Vec2),
    Foe(&'a Foe),
    Container(&'a TacticContainer),
}
impl PathArg<'_> {
    pub(crate) fn point(self) -> Vec2 {
        match self {
            Self::Point(point) => point,
            Self::Foe(foe) => foe.pos(),
            Self::Container(container) => container.pos(),
        }
    }
}

/// One element of a source `path()` answer: an intermediate tile point or the caller's own target object.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RouteElement {
    Point(Vec2),
    Foe(Foe),
    Container(TacticContainer),
}
impl RouteElement {
    pub(crate) fn point(&self) -> Vec2 {
        match self {
            Self::Point(point) => *point,
            Self::Foe(foe) => foe.pos(),
            Self::Container(container) => container.pos(),
        }
    }
    pub(crate) fn as_path_arg(&self) -> PathArg<'_> {
        match self {
            Self::Point(point) => PathArg::Point(*point),
            Self::Foe(foe) => PathArg::Foe(foe),
            Self::Container(container) => PathArg::Container(container),
        }
    }
}

/// The source `path()` answer: the waypoint array (possibly empty only at the declared empty test-service boundary).
#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct PathRoute {
    pub elements: Vec<RouteElement>,
}

/// The admitted private Memory read surface the tactics closure uses (source MemoryView). Implemented over the real
/// admitted `Memory` in production; the declared corpus wraps it to record the actual whereabouts calls.
pub(crate) trait MemoryApi {
    fn fighter(&self, id: &str) -> Option<FighterMemory>;
    fn mob(&self, id: &str) -> Option<MobMemory>;
    fn container(&self, id: &str) -> Option<ContainerMemory>;
    fn self_memory(&self) -> SelfMemory;
    /// This frame's stimuli, in source order.
    fn stimuli(&self) -> Vec<Stimulus>;
    /// Source `whereabouts(id, now)`; the one Memory read with a side effect to record.
    fn whereabouts(&mut self, id: &str, now: ServerMs) -> Option<Whereabouts>;
}

/// The source `Knowledge` surface the tactics closure calls: only `weaponEdge` (weapon-swap policy).
pub(crate) trait KnowledgeApi {
    fn weapon_edge(&self, a: WeaponId, b: WeaponId) -> i8;
}

/// The source PathService surface (services.ts) as the tactics closure calls it, with the exact source argument
/// objects so declared callbacks keep their complete arguments.
pub(crate) trait PathApi {
    fn walk(
        &mut self,
        from: &TacticSelf,
        to: PathArg<'_>,
    ) -> Option<crate::bots::paths::WalkAnswer>;
    fn path(&mut self, from: &TacticSelf, to: PathArg<'_>) -> Option<PathRoute>;
    fn los(&mut self, a: &TacticSelf, b: PathArg<'_>) -> bool;
    fn clear(&mut self, a: &TacticSelf, b: PathArg<'_>) -> bool;
    fn collision_map(&mut self) -> &TileMap;
}

/// A source-compatible decide draw stream (the admitted Mulberry32 Rng in production).
pub(crate) trait RngStream {
    fn draw(&mut self) -> f64;
}
impl RngStream for crate::bots::random::Rng {
    fn draw(&mut self) -> f64 {
        self.next_f64()
    }
}

/// One source `BrainContext` for a declared method: the declared config, percept, admitted Memory view, Knowledge,
/// path service, decide stream and engagement flag.
pub(crate) struct TacticsContext<'a> {
    pub cfg: &'a TacticsConfig,
    pub p: &'a TacticPercept,
    pub mem: &'a mut dyn MemoryApi,
    pub know: &'a mut dyn KnowledgeApi,
    pub paths: &'a mut dyn PathApi,
    pub decide: &'a mut dyn RngStream,
    pub engaged: bool,
}
impl TacticsContext<'_> {
    pub(crate) fn now(&self) -> ServerMs {
        self.p.now
    }
    pub(crate) fn self_view(&self) -> &TacticSelf {
        &self.p.self_
    }
    pub(crate) fn tier(&self) -> &TierParams {
        &self.cfg.tier
    }
    pub(crate) fn map(&self) -> &TacticsMap {
        &self.cfg.map
    }
}

/// Source `dist(a, b)` (kite.ts): `Math.hypot`.
pub(crate) fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::mapgen::certify::source_hypot(a.x - b.x, a.y - b.y)
}

/// Source `reactOr`: a reaction if one of `kinds` (about `subject`, or about nobody in particular) is among this frame's
/// stimuli, else the next step of a plan.
pub(crate) fn react_or(
    ctx: &mut TacticsContext<'_>,
    kinds: &[StimulusKind],
    subject: Option<&str>,
) -> IntentTiming {
    let stimuli = ctx.mem.stimuli();
    let found = stimuli.into_iter().find(|s| {
        kinds.contains(&s.kind)
            && (subject.is_none() || s.subject.as_deref() == subject || s.subject.is_none())
    });
    match found {
        Some(stimulus) => IntentTiming::React { stimulus },
        None => IntentTiming::Step {},
    }
}

/// Source `weapons.filter(w => w !== null).length`.
pub(crate) fn carried(weapons: &[Option<WeaponId>; 2]) -> usize {
    weapons.iter().filter(|weapon| weapon.is_some()).count()
}

/// Source `isRegionalKind`: the two camp-mob kinds a hunt fights.
pub(crate) fn is_regional_kind(kind: &str) -> bool {
    matches!(kind, "mob" | "elite")
}

/// Source `mobWeapon({ weapon0, faction })` on a MobView/MobMemory in-hand/faction pair.
pub(crate) fn mob_weapon(
    in_hand: Option<WeaponId>,
    faction: Option<FactionId>,
) -> Option<WeaponId> {
    in_hand.or_else(|| faction.map(rh_sim::mob_catalog::mob_weapon))
}

/// The source BotWeapon bridge for the admitted Knowledge callback.
pub(crate) fn to_bot_weapon(weapon: WeaponId) -> BotWeapon {
    match weapon {
        WeaponId::Sword => BotWeapon::Sword,
        WeaponId::Bow => BotWeapon::Bow,
        WeaponId::Wand => BotWeapon::Wand,
        WeaponId::Shield => BotWeapon::Shield,
        WeaponId::Axe => BotWeapon::Axe,
        WeaponId::Fists => BotWeapon::Fists,
    }
}
