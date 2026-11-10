//! Private source contracts for the complete legacy strategy and its stateful hunting/build-route closure.
//!
//! These are declared source-method types only: no World/Sim handle, authoritative ID resolver, secret RNG, wall clock or
//! public Bot/Brain wiring. Inputs are owned Percept/Memory facts and declarative callback descriptors; outputs are ordered
//! GoalDecision candidates and the source's own retained state. The public compatibility Goal stays untouched.
use super::super::data::MethodValue;
use super::super::memory::{
    CampMemory, ContainerMemory, ContainersWeapon, FighterMemory, Memory, MobMemory, SelfMemory,
    Whereabouts,
};
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{RoomPathService, WalkAnswer};
use crate::bots::types::{
    BotWeapon, FightOdds, OpponentSnapshot, PersonaParams, SelfView, ServerMs, TierParams,
};
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2, WeaponId};

/// One goal family of the full source union (strategy.ts Goal). The public brain::Goal is an incomplete compatibility
/// surface and is deliberately not used here.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Goal {
    Idle,
    Farm { mob: String, camp: Option<String> },
    Hunt { target: String },
    Fight { target: String },
    Loot { container: String },
    Flee { from: Vec<Vec2>, until: ServerMs },
    Roam { to: Vec2, why: RoamWhy },
    Hold { at: Vec2, why: HoldWhy },
    Module { module: String, data: MethodValue },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GoalKind {
    Idle,
    Farm,
    Hunt,
    Fight,
    Loot,
    Flee,
    Roam,
    Hold,
    Module,
}
impl Goal {
    pub(crate) fn kind(&self) -> GoalKind {
        match self {
            Self::Idle => GoalKind::Idle,
            Self::Farm { .. } => GoalKind::Farm,
            Self::Hunt { .. } => GoalKind::Hunt,
            Self::Fight { .. } => GoalKind::Fight,
            Self::Loot { .. } => GoalKind::Loot,
            Self::Flee { .. } => GoalKind::Flee,
            Self::Roam { .. } => GoalKind::Roam,
            Self::Hold { .. } => GoalKind::Hold,
            Self::Module { .. } => GoalKind::Module,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RoamWhy {
    Explore,
    Camp,
    LastSeen,
    Coliseum,
    Centre,
}
impl RoamWhy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Explore => "explore",
            Self::Camp => "camp",
            Self::LastSeen => "lastSeen",
            Self::Coliseum => "coliseum",
            Self::Centre => "centre",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HoldWhy {
    Coliseum,
    Ambush,
    Wait,
}
impl HoldWhy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Coliseum => "coliseum",
            Self::Ambush => "ambush",
            Self::Wait => "wait",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GoalDecision {
    pub goal: Goal,
    pub utility: f64,
    pub why: String,
    /// The source learning key this decision instantiates, when it has one (types.ts ChoiceKey).
    pub choice: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GoalState {
    Running,
    Done,
    Failed,
    Blocked,
}
impl GoalState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GoalStatus {
    pub state: GoalState,
    pub why: String,
}
impl GoalStatus {
    pub(crate) fn running(why: impl Into<String>) -> Self {
        Self {
            state: GoalState::Running,
            why: why.into(),
        }
    }
    pub(crate) fn done(why: impl Into<String>) -> Self {
        Self {
            state: GoalState::Done,
            why: why.into(),
        }
    }
    pub(crate) fn failed(why: impl Into<String>) -> Self {
        Self {
            state: GoalState::Failed,
            why: why.into(),
        }
    }
    pub(crate) fn blocked(why: impl Into<String>) -> Self {
        Self {
            state: GoalState::Blocked,
            why: why.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Chase {
    pub id: String,
    pub best: f64,
    pub since: ServerMs,
    pub limit: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyState {
    pub avoid_id: Option<String>,
    pub avoid_until: ServerMs,
    pub chase: Option<Chase>,
    pub goal_since: ServerMs,
    /// Every candidate of the last decision, before the pick, in source order.
    pub candidates: Vec<GoalDecision>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RouteStep {
    pub camp: u32,
    pub arrive_at: f64,
    pub start_at: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RouteCamp {
    pub index: u32,
    pub id: String,
    pub zone: FactionId,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub elite: bool,
    pub spots: u32,
    pub mob_type: String,
    pub alive: u32,
    pub state: u8,
    pub respawn_at: f64,
}

/// One complete generated-map camp record (gameMap.camps). The full source record is retained, not just the fields the
/// decision reads, so declared path-service callbacks receive the exact camp object the source hands them.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CampDef {
    pub id: String,
    pub zone: FactionId,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    /// Camp spot positions, in map order (the route reads the count; path callbacks receive the array).
    pub spots: Vec<Vec2>,
    pub elite_spot: f64,
    pub chest: Vec2,
    pub area: f64,
    pub radius: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ColiseumDef {
    pub centre: Vec2,
    pub inner_spawns: Vec<Vec2>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyMap {
    pub camps: Vec<CampDef>,
    pub coliseum: ColiseumDef,
    pub width: f64,
    pub height: f64,
}
impl StrategyMap {
    pub(crate) fn span(&self) -> f64 {
        self.width * rh_sim::constants::TILE
    }
    pub(crate) fn centre(&self) -> Vec2 {
        Vec2::new(
            (self.width * rh_sim::constants::TILE) / 2.,
            (self.height * rh_sim::constants::TILE) / 2.,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategySelf {
    pub id: String,
    /// The percept's display name; retained so path/knowledge callback arguments reproduce the source self object.
    pub name: String,
    pub faction: Option<FactionId>,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub status: String,
    pub hp: f64,
    pub max_hp: f64,
    /// Remaining source percept self facts. The strategy decision reads only a subset; retaining them keeps the declared
    /// service callbacks (which receive the self object) complete. No decision formula reads these extra fields.
    pub barrier: f64,
    pub draw_started_at: f64,
    pub ready_at: f64,
    pub immune_until: f64,
    pub sig: f64,
    pub brand: f64,
    pub as_mult: f64,
    pub windup_mult: f64,
    pub gv: f64,
    pub move_seq: f64,
    pub weapons: [Option<WeaponId>; 2],
    pub slot: u8,
    pub attack_target: Option<String>,
    pub mob_kills: f64,
    pub power: f64,
    pub kills: f64,
    /// Per normal-type credited kill stacks (source HuntSelf.mobStats).
    pub mob_stats: Vec<(String, u32)>,
    pub speed_mult: f64,
    pub bounty: f64,
}
impl StrategySelf {
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
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyHud {
    pub raid_started_at: f64,
    pub patience_ends_at: f64,
    pub sudden_death_at: f64,
    pub in_coliseum: bool,
    pub alive: u32,
    pub gates_locked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyFighter {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub dist: f64,
    pub los: bool,
    pub status: String,
    pub targetable: bool,
    pub immune: bool,
    pub hp_frac: f64,
    pub faction: Option<FactionId>,
    pub in_hand: Option<WeaponId>,
    pub bounty: f64,
    pub tint: f64,
}
impl StrategyFighter {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyMob {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub status: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyContainer {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub closed: bool,
    pub weapon: ContainersWeapon,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CampView {
    pub index: usize,
    pub type_: Option<String>,
    pub alive: u32,
    pub state: u8,
    pub respawn_at: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct StrategyExtras {
    pub camps: Option<Vec<CampView>>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StrategyPercept {
    pub now: ServerMs,
    pub self_: StrategySelf,
    pub hud: StrategyHud,
    pub fighters: Vec<StrategyFighter>,
    pub mobs: Vec<StrategyMob>,
    pub containers: Vec<StrategyContainer>,
    pub extras: StrategyExtras,
}

pub(crate) type AttackFn = std::sync::Arc<dyn Fn() -> bool + Send + Sync>;
pub(crate) type LogFn = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

/// A source-compatible draw stream. Production uses the admitted Mulberry32 Rng; the frozen corpus replaces individual
/// draws with declared overrides without advancing the fallback stream until the overrides are exhausted.
pub(crate) trait RngStream {
    fn draw(&mut self) -> f64;
}
impl RngStream for crate::bots::random::Rng {
    fn draw(&mut self) -> f64 {
        self.next_f64()
    }
}

/// One own-state snapshot for tests/fixtures; source BrainStats' strategy subset (mobTargets, mobDrops, retreats,
/// mobFocusMs, build, routeContests, goals).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct StrategyStats {
    pub mob_targets: f64,
    pub mob_drops: f64,
    pub retreats: f64,
    pub mob_focus_ms: f64,
    pub build: String,
    pub route_contests: f64,
    pub goals: Vec<(GoalKind, u64)>,
}

/// The source's private Memory read surface. Production instances are the admitted crate-private Memory; declared tests
/// may supply an owned fake, but no expected candidate/source row ever feeds native inputs.
pub(crate) trait MemoryApi {
    fn fighters(&self) -> &[(String, FighterMemory)];
    fn mobs(&self) -> &[(String, MobMemory)];
    fn camps(&self) -> &[(String, CampMemory)];
    fn containers(&self) -> &[(String, ContainerMemory)];
    fn self_memory(&self) -> &SelfMemory;
    fn stimuli(&self) -> &[crate::bots::types::Stimulus];
    fn bounties(&self) -> &[(String, f64)];
    fn choices(&self) -> &[String];
    fn whereabouts(&self, id: &str, now: ServerMs) -> Option<Whereabouts>;
}
impl MemoryApi for Memory {
    fn fighters(&self) -> &[(String, FighterMemory)] {
        self.view().fighters
    }
    fn mobs(&self) -> &[(String, MobMemory)] {
        self.view().mobs
    }
    fn camps(&self) -> &[(String, CampMemory)] {
        self.view().camps
    }
    fn containers(&self) -> &[(String, ContainerMemory)] {
        self.view().containers
    }
    fn self_memory(&self) -> &SelfMemory {
        self.view().self_memory
    }
    fn stimuli(&self) -> &[crate::bots::types::Stimulus] {
        self.view().stimuli
    }
    fn bounties(&self) -> &[(String, f64)] {
        self.view().bounties
    }
    fn choices(&self) -> &[String] {
        self.view().choices
    }
    fn whereabouts(&self, id: &str, now: ServerMs) -> Option<Whereabouts> {
        Memory::whereabouts(self, id, now).ok().flatten()
    }
}

pub(crate) fn lookup<'a, T>(entries: &'a [(String, T)], id: &str) -> Option<&'a T> {
    entries
        .iter()
        .find(|(key, _)| key == id)
        .map(|(_, value)| value)
}

/// The source's knowledge callback surface as the strategy calls it (knowledge.ts createKnowledge). Declared tests wrap
/// the admitted Knowledge to record every identity/argument/return; production uses the admitted instance directly.
pub(crate) trait KnowledgeApi {
    fn faction_edge(&self, a: FactionId, b: FactionId) -> i8;
    fn weapon_edge(&self, a: BotWeapon, b: BotWeapon) -> i8;
    fn mob_share(&self, me: FactionId, region: FactionId, elite: bool) -> f64;
    /// Source odds(me, them): `me` is the percept self the strategy passes (a source SelfView shape); `them` is the
    /// source OpponentSnapshot derived from the enemy.
    fn odds(&self, me: &StrategySelf, them: &Enemy) -> FightOdds;
}
impl KnowledgeApi for Knowledge {
    fn faction_edge(&self, a: FactionId, b: FactionId) -> i8 {
        Knowledge::faction_edge(self, a, b)
    }
    fn weapon_edge(&self, a: BotWeapon, b: BotWeapon) -> i8 {
        Knowledge::weapon_edge(self, a, b)
    }
    fn mob_share(&self, me: FactionId, region: FactionId, elite: bool) -> f64 {
        Knowledge::mob_share(self, me, region, elite)
    }
    fn odds(&self, me: &StrategySelf, them: &Enemy) -> FightOdds {
        Knowledge::odds(self, &self_view(me), &them.snap)
    }
}

/// The source's path service as the strategy calls it. Implemented over the existing RoomPathService for real runs;
/// declared tests use a transcript-aware fake. The strategy passes the whole percept self and the whole generated-map
/// camp record to `walk` (the source does), while the hunt adapter passes a plain position and the mob it is walking to;
/// the typed entry points record those exact arguments and fall through to the position walk in production.
pub(crate) trait PathApi {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer>;
    fn walk_camp(&mut self, from: &StrategySelf, to: &CampDef) -> Option<WalkAnswer> {
        self.walk(from.pos(), Vec2::new(to.x, to.y))
    }
    fn walk_mob(&mut self, from: Vec2, to: &super::mob_hunt::HuntMobLike) -> Option<WalkAnswer> {
        self.walk(from, Vec2::new(to.x, to.y))
    }
    fn los(&self, a: Vec2, b: Vec2) -> bool;
    #[allow(dead_code)] // source PathService surface; the strategy itself does not need clear in this closure
    fn clear(&self, a: Vec2, b: Vec2) -> bool;
}
impl PathApi for RoomPathService {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        RoomPathService::walk(self, from, to)
    }
    fn los(&self, a: Vec2, b: Vec2) -> bool {
        RoomPathService::los(self, a, b)
    }
    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        RoomPathService::clear(self, a, b)
    }
}

/// A learned-bias callback (types.ts LearnedBias): enabled plus a bounded source key bias. Declared inputs only.
pub(crate) trait LearnedBias {
    fn enabled(&self) -> bool;
    fn bias(&self, key: &str) -> f64;
}
impl LearnedBias for () {
    fn enabled(&self) -> bool {
        false
    }
    fn bias(&self, _key: &str) -> f64 {
        0.
    }
}

/// A feature module's strategy-facing surface: enabled gate and extra goal candidates, called in registration order.
pub(crate) trait FeatureModule {
    fn id(&self) -> &str;
    fn enabled(&self, features: &Features) -> bool;
    fn goals(&self, ctx: &mut StrategyContext<'_>) -> Vec<GoalDecision> {
        let _ = ctx;
        Vec::new()
    }
}

pub(crate) struct StrategyConfig<'a> {
    pub id: String,
    pub seed: u32,
    pub tier: &'a TierParams,
    pub persona: &'a PersonaParams,
    pub map: &'a StrategyMap,
    pub features: &'a Features,
    pub learned: &'a dyn LearnedBias,
    pub modules: &'a [Box<dyn FeatureModule>],
}

pub(crate) struct StrategyContext<'a> {
    pub cfg: &'a StrategyConfig<'a>,
    pub p: &'a StrategyPercept,
    pub mem: &'a dyn MemoryApi,
    pub know: &'a dyn KnowledgeApi,
    pub paths: &'a mut dyn PathApi,
    pub decide: &'a mut dyn RngStream,
    pub lapse: &'a mut dyn RngStream,
    pub engaged: bool,
}

impl StrategyContext<'_> {
    pub(crate) fn now(&self) -> f64 {
        self.p.now
    }
    pub(crate) fn whereabouts(&self, id: &str, now: f64) -> Option<Whereabouts> {
        self.mem.whereabouts(id, now)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Enemy {
    pub id: String,
    pub pos: Vec2,
    pub dist: f64,
    pub hp_frac: f64,
    pub bounty: f64,
    pub visible: bool,
    pub immune: bool,
    pub targetable: bool,
    pub age: f64,
    pub snap: OpponentSnapshot,
    pub cue: f64,
}

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

pub(crate) fn self_view(me: &StrategySelf) -> SelfView {
    SelfView {
        id: crate::bots::types::FighterId::from(me.id.as_str()),
        faction: me.faction,
        x: me.x,
        y: me.y,
        facing: me.facing,
        status: me.status.clone(),
        hp: me.hp,
        max_hp: me.max_hp,
        effects: 0,
        weapons: [
            me.weapons[0].map(to_bot_weapon),
            me.weapons[1].map(to_bot_weapon),
        ],
        slot: me.slot.min(1),
        attack_target: me
            .attack_target
            .as_ref()
            .map(|id| crate::bots::types::FighterId::from(id.as_str())),
        owner_lock: None,
        ready_at: 0.,
    }
}

pub(crate) fn odds(know: &dyn KnowledgeApi, me: &StrategySelf, enemy: &Enemy) -> FightOdds {
    know.odds(me, enemy)
}

/// JS Math.round for the source goal keys: ties go toward +Infinity.
pub(crate) fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

pub(crate) fn goal_key(goal: &Goal) -> String {
    match goal {
        Goal::Idle => "idle".into(),
        Goal::Farm { mob, .. } => format!("farm:{mob}"),
        Goal::Hunt { target } => format!("hunt:{target}"),
        Goal::Fight { target } => format!("fight:{target}"),
        Goal::Loot { container } => format!("loot:{container}"),
        Goal::Flee { .. } => "flee".into(),
        Goal::Roam { to, why } => format!(
            "roam:{}:{},{}",
            why.as_str(),
            js_round(to.x / (3. * rh_sim::constants::TILE)) as i64,
            js_round(to.y / (3. * rh_sim::constants::TILE)) as i64
        ),
        Goal::Hold { why, .. } => format!("hold:{}", why.as_str()),
        Goal::Module { module, data } => {
            format!("module:{module}:{}", js_stringify(data).unwrap_or_default())
        }
    }
}

/// Source goal identity for the "keeping" branch (strategy.ts compares JSON.stringify of the chosen/current goals).
pub(crate) fn goal_json(goal: &Goal) -> String {
    match goal {
        Goal::Idle => "{\"kind\":\"idle\"}".into(),
        Goal::Farm { mob, camp } => format!(
            "{{\"kind\":\"farm\",\"mob\":{},\"camp\":{}}}",
            js_json_string(mob),
            camp.as_ref().map_or("null".into(), |c| js_json_string(c))
        ),
        Goal::Hunt { target } => format!(
            "{{\"kind\":\"hunt\",\"target\":{}}}",
            js_json_string(target)
        ),
        Goal::Fight { target } => format!(
            "{{\"kind\":\"fight\",\"target\":{}}}",
            js_json_string(target)
        ),
        Goal::Loot { container } => format!(
            "{{\"kind\":\"loot\",\"container\":{}}}",
            js_json_string(container)
        ),
        Goal::Flee { from, until } => format!(
            "{{\"kind\":\"flee\",\"from\":[{}],\"until\":{}}}",
            from.iter()
                .map(|p| format!("{{\"x\":{},\"y\":{}}}", js_number(p.x), js_number(p.y)))
                .collect::<Vec<_>>()
                .join(","),
            js_number(*until)
        ),
        Goal::Roam { to, why } => format!(
            "{{\"kind\":\"roam\",\"to\":{{\"x\":{},\"y\":{}}},\"why\":{}}}",
            js_number(to.x),
            js_number(to.y),
            js_json_string(why.as_str())
        ),
        Goal::Hold { at, why } => format!(
            "{{\"kind\":\"hold\",\"at\":{{\"x\":{},\"y\":{}}},\"why\":{}}}",
            js_number(at.x),
            js_number(at.y),
            js_json_string(why.as_str())
        ),
        Goal::Module { module, data } => format!(
            "{{\"kind\":\"module\",\"module\":{},\"data\":{}}}",
            js_json_string(module),
            js_stringify(data).unwrap_or_default()
        ),
    }
}

pub(crate) fn goal_json_eq(a: &Goal, b: &Goal) -> bool {
    goal_json(a) == goal_json(b)
}

pub(crate) fn js_number(value: f64) -> String {
    if value == 0. {
        return "0".into();
    }
    if !value.is_finite() {
        return "null".into();
    }
    let abs = value.abs();
    // ECMAScript Number::toString uses ordinary decimal notation for [1e-6, 1e21), scientific outside.
    if abs < 1e-6 {
        return js_exponent(value);
    }
    if abs >= 1e21 {
        return js_exponent(value);
    }
    if value.fract() == 0. {
        return format!("{value:.0}");
    }
    // Shortest round-trip decimal representation; Rust's Display emits the same significant digits as ECMAScript.
    let text = format!("{value}");
    text
}

fn js_exponent(value: f64) -> String {
    // Rust's lower-exp form is shortest round-trip; ECMAScript adds an explicit '+' for non-negative exponents.
    let text = format!("{value:e}");
    if let Some((mantissa, exponent)) = text.split_once('e') {
        let exponent: i32 = exponent.parse().unwrap_or(0);
        if exponent >= 0 {
            format!("{mantissa}e+{exponent}")
        } else {
            format!("{mantissa}e{exponent}")
        }
    } else {
        text
    }
}
pub(crate) fn js_json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if c <= '\u{1f}' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// JSON.stringify for the ordered MethodValue/model data. Undefined object members are omitted; undefined array
/// entries and non-finite numbers become null, as the source does.
pub(crate) fn js_stringify(value: &MethodValue) -> Option<String> {
    match value {
        MethodValue::Undefined => None,
        MethodValue::Null => Some("null".into()),
        MethodValue::Bool(v) => Some(v.to_string()),
        MethodValue::Num(v) => Some(js_number(*v)),
        MethodValue::Str(v) => Some(js_json_string(v)),
        MethodValue::Arr(items) => Some(format!(
            "[{}]",
            items
                .iter()
                .map(|v| js_stringify(v).unwrap_or_else(|| "null".into()))
                .collect::<Vec<_>>()
                .join(",")
        )),
        MethodValue::Obj(fields) => Some(format!(
            "{{{}}}",
            fields
                .iter()
                .filter_map(|(key, value)| {
                    js_stringify(value).map(|v| format!("{}:{}", js_json_string(key), v))
                })
                .collect::<Vec<_>>()
                .join(",")
        )),
    }
}
