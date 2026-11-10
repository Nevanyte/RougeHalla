//! Actual callback/RNG transcript and retained-own diagnostics for the frozen private-strategy source replay.
//!
//! Test-only. Every recorded event is produced while the real native classes run: a callback wrapper forwards the real
//! declared descriptor or admitted service (path/Knowledge/Memory/learned/module/options) and records the receiver name,
//! the complete arguments the native caller passed, and the value it actually returned, in one ordered sequence shared
//! with the four RNG streams (stream name, per-stream ordinal and drawn value). The retained-state encoders read the
//! native class fields (never the corpus) through the source's own-property shape. Expected corpus rows are compared
//! afterwards and are never installed as native inputs.
use std::cell::RefCell;
use std::rc::Rc;

use super::build_route::BuildRoute;
use super::engine::Strategy;
use super::hunt_adapter::HuntAdapter;
use super::mob_hunt::{HuntMobLike, MobHunter, MobTracker};
use super::source_reader::{self, SVal};
use super::types::{
    AttackFn, CampDef, Enemy, FeatureModule, Goal, GoalDecision, LearnedBias, LogFn, MemoryApi,
    RngStream, RouteCamp, RouteStep, StrategyContext, StrategySelf, StrategyState,
};
use crate::bots::build_route::BuildGoal;
use crate::bots::knowledge::Knowledge;
use crate::bots::mob_hunt::MobHuntConfig;
use crate::bots::random::Rng;
use crate::bots::types::{BotWeapon, FightOdds};
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2};

pub(crate) fn n(v: f64) -> SVal {
    source_reader::n(v)
}
pub(crate) fn s(v: &str) -> SVal {
    source_reader::s(v)
}
pub(crate) fn b(v: bool) -> SVal {
    source_reader::b(v)
}
pub(crate) fn arr(values: Vec<SVal>) -> SVal {
    source_reader::arr(values)
}
pub(crate) fn obj(fields: Vec<(&str, SVal)>) -> SVal {
    source_reader::obj(fields)
}
pub(crate) fn map(entries: Vec<(SVal, SVal)>) -> SVal {
    source_reader::map(entries)
}
pub(crate) fn null() -> SVal {
    source_reader::null()
}
pub(crate) fn undefined() -> SVal {
    source_reader::undefined()
}
pub(crate) fn callable() -> SVal {
    SVal::Callable
}
fn opt_string(value: Option<&str>) -> SVal {
    value.map(s).unwrap_or_else(null)
}
fn string_map(entries: &[(String, f64)]) -> SVal {
    map(entries
        .iter()
        .map(|(key, value)| (s(key), n(*value)))
        .collect())
}

// ---------------------------------------------------------------------------------------------------------------------
// Ordered callback/RNG transcript

#[derive(Default)]
pub(crate) struct TraceLog {
    sequence: usize,
    events: Vec<SVal>,
}

pub(crate) type TraceHandle = Rc<RefCell<TraceLog>>;

impl TraceLog {
    pub(crate) fn new_handle() -> TraceHandle {
        Rc::new(RefCell::new(Self::default()))
    }
    pub(crate) fn reset(&mut self) {
        self.sequence = 0;
        self.events.clear();
    }
    fn callback_event(&mut self, name: &str, args: Vec<SVal>, result: SVal) {
        self.events.push(obj(vec![
            ("sequence", n(self.sequence as f64)),
            ("kind", s("callback")),
            ("name", s(name)),
            ("args", arr(args)),
            ("result", result),
        ]));
        self.sequence += 1;
    }
    fn rng_event(&mut self, stream: &str, index: usize, value: f64) {
        self.events.push(obj(vec![
            ("sequence", n(self.sequence as f64)),
            ("kind", s("rng")),
            ("stream", s(stream)),
            ("index", n(index as f64)),
            ("value", n(value)),
        ]));
        self.sequence += 1;
    }
    pub(crate) fn encoded(&self) -> SVal {
        arr(self.events.clone())
    }
}

pub(crate) fn record_callback(
    trace: &TraceHandle,
    name: &str,
    args: Vec<SVal>,
    result: SVal,
) -> SVal {
    trace
        .borrow_mut()
        .callback_event(name, args, result.clone());
    result
}

/// A source-compatible decision/lapse Knowledge draw stream. Optional declared overrides replace a draw without advancing
/// the fallback Mulberry stream until the overrides are exhausted (the source runner's exact semantics); every draw is
/// appended to the shared ordered transcript with its stream and per-stream ordinal.
pub(crate) struct TraceRng {
    fallback: Rng,
    overrides: Vec<f64>,
    index: usize,
    draws: usize,
    stream: &'static str,
    trace: TraceHandle,
}

impl TraceRng {
    pub(crate) fn new(
        seed: u32,
        overrides: Vec<f64>,
        stream: &'static str,
        trace: &TraceHandle,
    ) -> Self {
        Self {
            fallback: Rng::new(seed),
            overrides,
            index: 0,
            draws: 0,
            stream,
            trace: trace.clone(),
        }
    }
    pub(crate) fn draws(&self) -> usize {
        self.draws
    }
}

impl RngStream for TraceRng {
    fn draw(&mut self) -> f64 {
        let value = self
            .overrides
            .get(self.index)
            .copied()
            .unwrap_or_else(|| self.fallback.next_f64());
        self.trace
            .borrow_mut()
            .rng_event(self.stream, self.index, value);
        self.index += 1;
        self.draws += 1;
        value
    }
}

pub(crate) fn options_log(trace: &TraceHandle) -> LogFn {
    let trace = trace.clone();
    Rc::new(move |message: &str| {
        record_callback(&trace, "options.log", vec![s(message)], undefined());
    })
}

pub(crate) fn options_attacking(value: Option<bool>, trace: &TraceHandle) -> Option<AttackFn> {
    value.map(|declared| {
        let trace = trace.clone();
        Rc::new(move || {
            record_callback(&trace, "options.attacking", Vec::new(), b(declared));
            declared
        }) as AttackFn
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Recording services

pub(crate) struct RecordedKnowledge<'a> {
    pub(crate) inner: &'a Knowledge,
    pub(crate) trace: TraceHandle,
}

impl super::types::KnowledgeApi for RecordedKnowledge<'_> {
    fn faction_edge(&self, a: FactionId, b_: FactionId) -> i8 {
        let result = <Knowledge as super::types::KnowledgeApi>::faction_edge(self.inner, a, b_);
        record_callback(
            &self.trace,
            "knowledge.factionEdge",
            vec![s(a.as_str()), s(b_.as_str())],
            n(f64::from(result)),
        );
        result
    }
    fn weapon_edge(&self, a: BotWeapon, b_: BotWeapon) -> i8 {
        let result = <Knowledge as super::types::KnowledgeApi>::weapon_edge(self.inner, a, b_);
        record_callback(
            &self.trace,
            "knowledge.weaponEdge",
            vec![s(a.as_str()), s(b_.as_str())],
            n(f64::from(result)),
        );
        result
    }
    fn mob_share(&self, me: FactionId, region: FactionId, elite: bool) -> f64 {
        let result =
            <Knowledge as super::types::KnowledgeApi>::mob_share(self.inner, me, region, elite);
        record_callback(
            &self.trace,
            "knowledge.mobShare",
            vec![s(me.as_str()), s(region.as_str()), b(elite)],
            n(result),
        );
        result
    }
    fn odds(&self, me: &StrategySelf, them: &Enemy) -> FightOdds {
        let result = <Knowledge as super::types::KnowledgeApi>::odds(self.inner, me, them);
        record_callback(
            &self.trace,
            "knowledge.odds",
            vec![encode_strategy_self(me), encode_opponent_snapshot(them)],
            encode_fight_odds(&result),
        );
        result
    }
}

pub(crate) struct RecordedMemory<'a> {
    pub(crate) inner: &'a super::super::memory::Memory,
    pub(crate) trace: TraceHandle,
}

impl MemoryApi for RecordedMemory<'_> {
    fn fighters(&self) -> &[(String, super::super::memory::FighterMemory)] {
        MemoryApi::fighters(self.inner)
    }
    fn mobs(&self) -> &[(String, super::super::memory::MobMemory)] {
        MemoryApi::mobs(self.inner)
    }
    fn camps(&self) -> &[(String, super::super::memory::CampMemory)] {
        MemoryApi::camps(self.inner)
    }
    fn containers(&self) -> &[(String, super::super::memory::ContainerMemory)] {
        MemoryApi::containers(self.inner)
    }
    fn self_memory(&self) -> &super::super::memory::SelfMemory {
        MemoryApi::self_memory(self.inner)
    }
    fn stimuli(&self) -> &[crate::bots::types::Stimulus] {
        MemoryApi::stimuli(self.inner)
    }
    fn bounties(&self) -> &[(String, f64)] {
        MemoryApi::bounties(self.inner)
    }
    fn choices(&self) -> &[String] {
        MemoryApi::choices(self.inner)
    }
    fn whereabouts(&self, id: &str, now: f64) -> Option<super::super::memory::Whereabouts> {
        let result = MemoryApi::whereabouts(self.inner, id, now);
        let encoded = match &result {
            None => null(),
            Some(w) => obj(vec![("at", encode_vec2(w.at)), ("radius", n(w.radius))]),
        };
        record_callback(
            &self.trace,
            "memory.whereabouts",
            vec![s(id), n(now)],
            encoded,
        );
        result
    }
}

pub(crate) struct RecordedLearned<'a> {
    pub(crate) enabled: bool,
    pub(crate) entries: &'a [(String, f64)],
    pub(crate) trace: TraceHandle,
}

impl LearnedBias for RecordedLearned<'_> {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn bias(&self, key: &str) -> f64 {
        let value = self
            .entries
            .iter()
            .find(|(k, _)| k == key)
            .map_or(0., |(_, v)| *v);
        record_callback(&self.trace, "learned.bias", vec![s(key)], n(value));
        value
    }
}

/// A declared source feature module (constant goals plus the source `when` context filter), recording its enabled/goals
/// callbacks with the exact source-boundary projection the declared descriptor reads.
pub(crate) struct RecordedModule {
    pub(crate) id: String,
    pub(crate) enabled: bool,
    pub(crate) feature: Option<String>,
    pub(crate) goals: Option<Vec<GoalDecision>>,
    pub(crate) after: Option<f64>,
    pub(crate) hp_below: Option<f64>,
    pub(crate) op_index: usize,
    pub(crate) trace: TraceHandle,
}

impl FeatureModule for RecordedModule {
    fn id(&self) -> &str {
        &self.id
    }
    fn enabled(&self, features: &Features) -> bool {
        let enabled = self.enabled
            || self
                .feature
                .as_ref()
                .is_some_and(|feature| match feature.as_str() {
                    "wishes" => features.wishes,
                    "planning" => features.planning,
                    "chests" => features.chests,
                    "skills" => features.skills,
                    "relics" => features.relics,
                    "camps" => features.camps,
                    "hazards" => features.hazards,
                    "fields" => features.fields,
                    _ => false,
                });
        record_callback(
            &self.trace,
            &format!("module.{}.enabled", self.id),
            vec![encode_features(features)],
            b(enabled),
        );
        enabled
    }
    fn goals(&self, ctx: &StrategyContext<'_>) -> Vec<GoalDecision> {
        let Some(goals) = &self.goals else {
            return Vec::new();
        };
        let out: Vec<GoalDecision> = goals
            .iter()
            .filter(|_| self.after.is_none_or(|after| ctx.p.now >= after))
            .filter(|_| self.hp_below.is_none_or(|hp| ctx.p.self_.hp < hp))
            .cloned()
            .collect();
        let projection = obj(vec![
            ("contextOperation", n(self.op_index as f64)),
            ("now", n(ctx.p.now)),
            (
                "self",
                obj(vec![("id", s(&ctx.p.self_.id)), ("hp", n(ctx.p.self_.hp))]),
            ),
        ]);
        record_callback(
            &self.trace,
            &format!("module.{}.goals", self.id),
            vec![projection],
            arr(out.iter().map(encode_goal_decision).collect()),
        );
        out
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Source-shaped encoders (native retained state and callback arguments)

pub(crate) fn encode_vec2(v: Vec2) -> SVal {
    obj(vec![("x", n(v.x)), ("y", n(v.y))])
}

pub(crate) fn encode_features(features: &Features) -> SVal {
    obj(vec![
        (
            "messageTypes",
            arr(features.message_types.iter().map(|m| s(m)).collect()),
        ),
        ("wishes", b(features.wishes)),
        ("statusEffects", b(features.status_effects)),
        ("fields", b(features.fields)),
        ("planning", b(features.planning)),
        ("chests", b(features.chests)),
        ("skills", b(features.skills)),
        ("relics", b(features.relics)),
        ("camps", b(features.camps)),
        ("hazards", b(features.hazards)),
    ])
}

pub(crate) fn encode_strategy_self(me: &StrategySelf) -> SVal {
    obj(vec![
        ("id", s(&me.id)),
        ("name", s(&me.name)),
        ("x", n(me.x)),
        ("y", n(me.y)),
        ("facing", n(me.facing)),
        ("status", s(&me.status)),
        ("hp", n(me.hp)),
        ("maxHp", n(me.max_hp)),
        ("barrier", n(me.barrier)),
        (
            "faction",
            me.faction.map(|f| s(f.as_str())).unwrap_or_else(null),
        ),
        (
            "weapons",
            arr(me
                .weapons
                .iter()
                .map(|w| w.map(|w| s(w.as_str())).unwrap_or_else(null))
                .collect()),
        ),
        ("slot", n(f64::from(me.slot))),
        ("attackTarget", opt_string(me.attack_target.as_deref())),
        ("drawStartedAt", n(me.draw_started_at)),
        ("readyAt", n(me.ready_at)),
        ("immuneUntil", n(me.immune_until)),
        ("sig", n(me.sig)),
        ("brand", n(me.brand)),
        ("power", n(me.power)),
        ("asMult", n(me.as_mult)),
        ("windupMult", n(me.windup_mult)),
        ("speedMult", n(me.speed_mult)),
        ("kills", n(me.kills)),
        ("mobKills", n(me.mob_kills)),
        ("gv", n(me.gv)),
        ("bounty", n(me.bounty)),
        ("moveSeq", n(me.move_seq)),
    ])
}

pub(crate) fn encode_opponent_snapshot(enemy: &Enemy) -> SVal {
    obj(vec![
        ("id", s(&enemy.id)),
        (
            "faction",
            enemy
                .snap
                .faction
                .map(|f| s(f.as_str()))
                .unwrap_or_else(null),
        ),
        (
            "inHand",
            enemy
                .snap
                .in_hand
                .map(|w| s(w.as_str()))
                .unwrap_or_else(null),
        ),
        (
            "otherSlot",
            enemy
                .snap
                .other_slot
                .map(|w| s(w.as_str()))
                .unwrap_or_else(null),
        ),
        ("hpFrac", n(enemy.hp_frac)),
        ("bounty", n(enemy.bounty)),
        ("dist", n(enemy.dist)),
        ("tint", n(enemy.snap.tint)),
    ])
}

pub(crate) fn encode_fight_odds(odds: &FightOdds) -> SVal {
    obj(vec![
        ("edge", n(odds.edge)),
        ("score", n(odds.score)),
        ("known", b(odds.known)),
        ("why", s(&odds.why)),
    ])
}

/// The source MobLike/HuntMobLike shape: `type` is the canonical catalog id or Undefined, faction/weapon0 are strings.
pub(crate) fn encode_hunt_mob_like(mob: &HuntMobLike) -> SVal {
    let type_ = mob
        .type_
        .as_deref()
        .and_then(rh_sim::mob_catalog::mob_type_by_id)
        .map_or_else(undefined, |t| s(t.id.as_str()));
    obj(vec![
        ("kind", s(&mob.kind)),
        ("type", type_),
        ("status", s(&mob.status)),
        ("x", n(mob.x)),
        ("y", n(mob.y)),
        ("hp", n(mob.hp)),
        ("maxHp", n(mob.max_hp)),
        ("faction", s(mob.faction_text.as_deref().unwrap_or(""))),
        ("weapon0", s(mob.weapon0_text.as_deref().unwrap_or(""))),
    ])
}

/// The complete generated-map camp record the strategy hands to the declared path service.
pub(crate) fn encode_source_camp(camp: &CampDef) -> SVal {
    obj(vec![
        ("id", s(&camp.id)),
        ("zone", s(camp.zone.as_str())),
        ("x", n(camp.x)),
        ("y", n(camp.y)),
        ("r", n(camp.r)),
        (
            "spots",
            arr(camp.spots.iter().map(|p| encode_vec2(*p)).collect()),
        ),
        ("eliteSpot", n(camp.elite_spot)),
        ("chest", encode_vec2(camp.chest)),
        ("area", n(camp.area)),
        ("radius", n(camp.radius)),
    ])
}

pub(crate) fn encode_route_camp(camp: &RouteCamp) -> SVal {
    obj(vec![
        ("index", n(f64::from(camp.index))),
        ("id", s(&camp.id)),
        ("zone", s(camp.zone.as_str())),
        ("x", n(camp.x)),
        ("y", n(camp.y)),
        ("r", n(camp.r)),
        ("elite", b(camp.elite)),
        ("spots", n(f64::from(camp.spots))),
        ("type", s(&camp.mob_type)),
        ("alive", n(f64::from(camp.alive))),
        ("state", n(f64::from(camp.state))),
        ("respawnAt", n(camp.respawn_at)),
    ])
}

pub(crate) fn encode_route_step(step: &RouteStep) -> SVal {
    obj(vec![
        ("camp", n(f64::from(step.camp))),
        ("arriveAt", n(step.arrive_at)),
        ("startAt", n(step.start_at)),
    ])
}

pub(crate) fn encode_goal(goal: &Goal) -> SVal {
    match goal {
        Goal::Idle => obj(vec![("kind", s("idle"))]),
        Goal::Farm { mob, camp } => obj(vec![
            ("kind", s("farm")),
            ("mob", s(mob)),
            ("camp", opt_string(camp.as_deref())),
        ]),
        Goal::Hunt { target } => obj(vec![("kind", s("hunt")), ("target", s(target))]),
        Goal::Fight { target } => obj(vec![("kind", s("fight")), ("target", s(target))]),
        Goal::Loot { container } => obj(vec![("kind", s("loot")), ("container", s(container))]),
        Goal::Flee { from, until } => obj(vec![
            ("kind", s("flee")),
            ("from", arr(from.iter().map(|p| encode_vec2(*p)).collect())),
            ("until", n(*until)),
        ]),
        Goal::Roam { to, why } => obj(vec![
            ("kind", s("roam")),
            ("to", encode_vec2(*to)),
            ("why", s(why.as_str())),
        ]),
        Goal::Hold { at, why } => obj(vec![
            ("kind", s("hold")),
            ("at", encode_vec2(*at)),
            ("why", s(why.as_str())),
        ]),
        Goal::Module { module, data } => obj(vec![
            ("kind", s("module")),
            ("module", s(module)),
            ("data", encode_method_value(data)),
        ]),
    }
}

pub(crate) fn encode_method_value(value: &super::super::data::MethodValue) -> SVal {
    use super::super::data::MethodValue;
    match value {
        MethodValue::Undefined => undefined(),
        MethodValue::Null => null(),
        MethodValue::Bool(v) => b(*v),
        MethodValue::Num(v) => n(*v),
        MethodValue::Str(v) => s(v),
        MethodValue::Arr(values) => arr(values.iter().map(encode_method_value).collect()),
        MethodValue::Obj(entries) => obj(entries
            .iter()
            .map(|(k, v)| (k.as_str(), encode_method_value(v)))
            .collect()),
    }
}

pub(crate) fn encode_goal_decision(decision: &GoalDecision) -> SVal {
    let mut fields = vec![
        ("goal", encode_goal(&decision.goal)),
        ("utility", n(decision.utility)),
        ("why", s(&decision.why)),
    ];
    if let Some(choice) = &decision.choice {
        fields.push(("choice", s(choice)));
    }
    obj(fields)
}

pub(crate) fn encode_strategy_state(state: &StrategyState) -> SVal {
    obj(vec![
        ("avoidId", opt_string(state.avoid_id.as_deref())),
        ("avoidUntil", n(state.avoid_until)),
        (
            "chase",
            match &state.chase {
                None => null(),
                Some(chase) => obj(vec![
                    ("id", s(&chase.id)),
                    ("best", n(chase.best)),
                    ("since", n(chase.since)),
                    ("limit", n(chase.limit)),
                ]),
            },
        ),
        ("goalSince", n(state.goal_since)),
        (
            "candidates",
            arr(state.candidates.iter().map(encode_goal_decision).collect()),
        ),
    ])
}

pub(crate) fn encode_hunt_stats(stats: &super::mob_hunt::MobHuntStats) -> SVal {
    obj(vec![
        ("targets", n(stats.targets as f64)),
        ("drops", n(stats.drops as f64)),
        ("retreats", n(stats.retreats as f64)),
        ("focusMs", n(stats.focus_ms)),
    ])
}

pub(crate) fn encode_plan(plan: &Option<(String, Vec<RouteStep>, u64)>) -> SVal {
    match plan {
        None => null(),
        Some((build, route, contests)) => obj(vec![
            ("build", s(build)),
            ("route", arr(route.iter().map(encode_route_step).collect())),
            ("contests", n(*contests as f64)),
        ]),
    }
}

pub(crate) struct StrategyGetterState {
    pub(crate) state: StrategyState,
    pub(crate) plan: Option<(String, Vec<RouteStep>, u64)>,
    pub(crate) hunt_stats: super::mob_hunt::MobHuntStats,
    pub(crate) hunt_target: Option<String>,
}

pub(crate) fn strategy_getters(strategy: &Strategy) -> StrategyGetterState {
    StrategyGetterState {
        state: strategy.state(),
        plan: strategy.plan(),
        hunt_stats: strategy.hunt_stats(),
        hunt_target: strategy.hunt_target(),
    }
}

pub(crate) fn encode_strategy_getters(getters: &StrategyGetterState) -> [(&'static str, SVal); 4] {
    [
        ("state", encode_strategy_state(&getters.state)),
        ("plan", encode_plan(&getters.plan)),
        ("huntStats", encode_hunt_stats(&getters.hunt_stats)),
        (
            "huntTarget",
            getters.hunt_target.as_deref().map(s).unwrap_or_else(null),
        ),
    ]
}

pub(crate) fn encode_mob_hunt_config(config: &MobHuntConfig) -> SVal {
    obj(vec![
        ("playerThreat", n(config.player_threat)),
        ("playerRelease", n(config.player_release)),
        ("underFireRange", n(config.under_fire_range)),
        ("underFireMs", n(config.under_fire_ms)),
        ("reach", n(config.reach)),
        ("firstReach", n(config.first_reach)),
        ("walkSlack", n(config.walk_slack)),
        ("maxCandidates", n(f64::from(config.max_candidates))),
        ("startMinHp", n(config.start_min_hp)),
        ("eliteMinPower", n(config.elite_min_power)),
        ("eliteFullHp", n(config.elite_full_hp)),
        ("mobMinShare", n(config.mob_min_share)),
        ("eliteMinShare", n(config.elite_min_share)),
        ("eliteSureShare", n(config.elite_sure_share)),
        ("eliteSurePower", n(config.elite_sure_power)),
        ("retreatHp", n(config.retreat_hp)),
        ("retreatClear", n(config.retreat_clear)),
        ("retreatMinMs", n(config.retreat_min_ms)),
        ("retreatMaxMs", n(config.retreat_max_ms)),
        ("retreatBanMs", n(config.retreat_ban_ms)),
        ("killGoal", n(config.kill_goal)),
        ("focusBudgetMs", n(config.focus_budget_ms)),
        ("targetBudgetMs", n(config.target_budget_ms)),
        ("stallAttackMs", n(config.stall_attack_ms)),
        ("approachMs", n(config.approach_ms)),
        ("returnBanMs", n(config.return_ban_ms)),
        ("stallBanMs", n(config.stall_ban_ms)),
        ("awakeMoved", n(config.awake_moved)),
        ("skipRanged", b(config.skip_ranged)),
        ("repickMs", n(config.repick_ms)),
    ])
}

pub(crate) fn encode_mob_tracker(tracker: &MobTracker) -> SVal {
    SVal::Instance {
        name: "MobTracker".into(),
        entries: vec![(
            "rec".into(),
            map(tracker
                .rec
                .iter()
                .map(|record| {
                    (
                        s(&record.id),
                        obj(vec![
                            ("mob", encode_hunt_mob_like(&record.mob)),
                            ("home", encode_vec2(record.home)),
                            ("hp", n(record.hp)),
                            ("risingUntil", n(record.rising_until)),
                        ]),
                    )
                })
                .collect()),
        )],
    }
}

pub(crate) fn encode_mob_hunter(hunter: &MobHunter) -> SVal {
    SVal::Instance {
        name: "MobHunter".into(),
        entries: vec![
            ("cfg".into(), encode_mob_hunt_config(hunter.config())),
            ("log".into(), callable()),
            ("tracker".into(), encode_mob_tracker(&hunter.tracker)),
            ("stats".into(), encode_hunt_stats(&hunter.stats)),
            (
                "banned".into(),
                map(hunter
                    .banned
                    .iter()
                    .map(|(id, until)| (s(id), n(*until)))
                    .collect()),
            ),
            (
                "eng".into(),
                hunter.eng.as_ref().map_or_else(null, |engagement| {
                    obj(vec![
                        ("id", s(&engagement.id)),
                        ("since", n(engagement.since)),
                        ("bestHp", n(engagement.best_hp)),
                        ("stallMs", n(engagement.stall_ms)),
                        ("approachMs", n(engagement.approach_ms)),
                    ])
                }),
            ),
            ("lastAt".into(), n(hunter.last_at)),
            ("lastKind".into(), s(&hunter.last_kind)),
            ("playerLock".into(), b(hunter.player_lock)),
            ("retreatUntil".into(), n(hunter.retreat_until)),
            ("retreatMinUntil".into(), n(hunter.retreat_min_until)),
            ("mobBanUntil".into(), n(hunter.mob_ban_until)),
            ("nextPickAt".into(), n(hunter.next_pick_at)),
        ],
    }
}

pub(crate) fn encode_build_goal(build: &BuildGoal) -> SVal {
    obj(vec![
        ("id", s(build.id)),
        ("name", s(build.name)),
        (
            "weights",
            obj(build
                .weights
                .iter()
                .map(|(stat, value)| (stat.as_str(), n(*value)))
                .collect()),
        ),
    ])
}

pub(crate) fn encode_build_route(route: &BuildRoute) -> SVal {
    SVal::Instance {
        name: "BuildRoute".into(),
        entries: vec![
            ("build".into(), encode_build_goal(route.build)),
            (
                "route".into(),
                arr(route.route.iter().map(encode_route_step).collect()),
            ),
            ("plannedAt".into(), n(route.planned_at)),
            (
                "contested".into(),
                map(route
                    .contested
                    .iter()
                    .map(|(camp, until)| (n(f64::from(*camp)), n(*until)))
                    .collect()),
            ),
            (
                "zoneHits".into(),
                map(route
                    .zone_hits
                    .iter()
                    .map(|(zone, hits)| {
                        (s(zone.as_str()), arr(hits.iter().map(|t| n(*t)).collect()))
                    })
                    .collect()),
            ),
            (
                "zoneAvoid".into(),
                map(route
                    .zone_avoid
                    .iter()
                    .map(|(zone, until)| (s(zone.as_str()), n(*until)))
                    .collect()),
            ),
            (
                "heading".into(),
                match route.heading {
                    None => null(),
                    Some((camp, state)) => obj(vec![
                        ("camp", n(f64::from(camp))),
                        ("state", n(f64::from(state))),
                    ]),
                },
            ),
            (
                "lastAlive".into(),
                map(route
                    .last_alive
                    .iter()
                    .map(|(camp, alive)| (n(f64::from(*camp)), n(f64::from(*alive))))
                    .collect()),
            ),
            (
                "stats".into(),
                obj(vec![
                    ("plans", n(route.stats.plans as f64)),
                    ("contests", n(route.stats.contests as f64)),
                ]),
            ),
        ],
    }
}

pub(crate) fn encode_hunt_adapter(adapter: &HuntAdapter) -> SVal {
    obj(vec![
        ("hunter", encode_mob_hunter(&adapter.hunter)),
        ("config", encode_mob_hunt_config(&adapter.config)),
        ("stats", encode_hunt_stats(adapter.stats())),
        ("decide", callable()),
        ("release", callable()),
        ("awakeNear", callable()),
    ])
}

pub(crate) fn encode_strategy_own(strategy: &Strategy) -> SVal {
    let mut opts = vec![("log", callable())];
    if strategy.opts.attacking.is_some() {
        opts.push(("attacking", callable()));
    }
    SVal::Instance {
        name: "StrategyImpl".into(),
        entries: vec![
            ("opts".into(), obj(opts)),
            (
                "adapter".into(),
                strategy
                    .adapter
                    .as_ref()
                    .map_or_else(null, encode_hunt_adapter),
            ),
            ("avoidId".into(), opt_string(strategy.avoid_id.as_deref())),
            ("avoidUntil".into(), n(strategy.avoid_until)),
            ("avoidSince".into(), n(strategy.avoid_since)),
            (
                "chase".into(),
                strategy.chase.as_ref().map_or_else(null, |chase| {
                    obj(vec![
                        ("id", s(&chase.id)),
                        ("best", n(chase.best)),
                        ("since", n(chase.since)),
                        ("limit", n(chase.limit)),
                    ])
                }),
            ),
            ("currentKey".into(), s(&strategy.current_key)),
            ("goalSince".into(), n(strategy.goal_since)),
            ("fleeBanUntil".into(), n(strategy.flee_ban_until)),
            ("excluded".into(), string_map(&strategy.excluded)),
            ("lootSkip".into(), string_map(&strategy.loot_skip)),
            (
                "judged".into(),
                map(strategy
                    .judged
                    .iter()
                    .map(|(id, until, z)| (s(id), obj(vec![("until", n(*until)), ("z", n(*z))])))
                    .collect()),
            ),
            (
                "last".into(),
                arr(strategy.last.iter().map(encode_goal_decision).collect()),
            ),
            (
                "route".into(),
                strategy
                    .route
                    .as_ref()
                    .map_or_else(null, encode_build_route),
            ),
            (
                "routeNext".into(),
                strategy
                    .route_next
                    .as_ref()
                    .map_or_else(null, encode_route_step),
            ),
        ],
    }
}

/// The complete retained-state diagnostics for one source method suite instance.
pub(crate) enum OwnState<'a> {
    None,
    Tracker(&'a MobTracker),
    Hunter(&'a MobHunter),
    Route(&'a BuildRoute),
    Adapter(&'a HuntAdapter),
    Strategy(&'a Strategy),
}

pub(crate) fn encode_own(state: OwnState<'_>) -> SVal {
    match state {
        OwnState::None => null(),
        OwnState::Tracker(tracker) => encode_mob_tracker(tracker),
        OwnState::Hunter(hunter) => encode_mob_hunter(hunter),
        OwnState::Route(route) => encode_build_route(route),
        OwnState::Adapter(adapter) => encode_hunt_adapter(adapter),
        OwnState::Strategy(strategy) => encode_strategy_own(strategy),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact comparison helpers

fn same_seq(a: &[SVal], b: &[SVal]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| ordered_same(x, y))
}

/// Exact source-value equality with ordered object/instance entries (source own/shape order is observable) and binary64
/// bits, tag identity and ordered collections preserved. Schema records (memory sections) keep the keyed comparator.
pub(crate) fn ordered_same(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Obj(x), SVal::Obj(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| ka == kb && ordered_same(va, vb))
        }
        (
            SVal::Instance {
                name: n1,
                entries: e1,
            },
            SVal::Instance {
                name: n2,
                entries: e2,
            },
        ) => {
            n1 == n2
                && e1.len() == e2.len()
                && e1
                    .iter()
                    .zip(e2)
                    .all(|((ka, va), (kb, vb))| ka == kb && ordered_same(va, vb))
        }
        (SVal::Arr(x), SVal::Arr(y)) | (SVal::Set(x), SVal::Set(y)) => same_seq(x, y),
        (SVal::Map(x), SVal::Map(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| ordered_same(ka, kb) && ordered_same(va, vb))
        }
        (SVal::U8(x), SVal::U8(y)) => x == y,
        _ => source_reader::same(a, b),
    }
}

/// The reviewed transcendental whitelist, path-scoped to the native retained `judged[id].z` leaf: the source draw is a
/// Box-Muller Gaussian (log/sqrt/cos), so the inherited bot-core bound `1e-9 * max(1,abs(source))` applies to that leaf
/// only. Every other retained field, expiry clock and projection stays exact; the bound can never change a comparison,
/// winner, branch or RNG consumption.
const JUDGED_Z_RELATIVE: f64 = 1e-9;

fn own_z_within(expected: f64, actual: f64) -> bool {
    expected.to_bits() == actual.to_bits()
        || (expected - actual).abs() <= JUDGED_Z_RELATIVE * expected.abs().max(1.)
}

/// The reviewed Gaussian tolerance is scoped through the actual retained `StrategyImpl.judged` field only: the root
/// instance must be the real strategy class, the field key must be `judged`, its Map values' direct `until/z` objects are
/// visited there, and only their direct `z` numeric leaf gets the bound. A same-shaped `{until,z}` object anywhere else
/// (including raw Module.data) is compared with ordinary binary64-exact equality.
fn own_judged_entry_same(expected: &SVal, actual: &SVal) -> bool {
    let (SVal::Obj(e), SVal::Obj(a)) = (expected, actual) else {
        return ordered_same(expected, actual);
    };
    e.len() == a.len()
        && e.iter().zip(a).all(|((ek, ev), (ak, av))| {
            if ek != ak {
                return false;
            }
            if ek == "z" {
                if let (SVal::Num(en), SVal::Num(an)) = (ev, av) {
                    return own_z_within(*en, *an);
                }
            }
            ordered_same(ev, av)
        })
}

fn own_judged_map_same(expected: &SVal, actual: &SVal) -> bool {
    let (SVal::Map(e), SVal::Map(a)) = (expected, actual) else {
        return ordered_same(expected, actual);
    };
    e.len() == a.len()
        && e.iter()
            .zip(a)
            .all(|((ek, ev), (ak, av))| ordered_same(ek, ak) && own_judged_entry_same(ev, av))
}

/// The complete retained own-state/diagnostic comparison: source own-property order and binary64 bits everywhere, except
/// the reviewed `judged[id].z` Gaussian leaf above, reachable only through the real `StrategyImpl.judged` retention path.
pub(crate) fn own_same(expected: &SVal, actual: &SVal) -> bool {
    match (expected, actual) {
        (
            SVal::Instance {
                name: en,
                entries: ee,
            },
            SVal::Instance {
                name: an,
                entries: ae,
            },
        ) if en == "StrategyImpl" && an == "StrategyImpl" => {
            ee.len() == ae.len()
                && ee.iter().zip(ae).all(|((ek, ev), (ak, av))| {
                    if ek != ak {
                        return false;
                    }
                    if ek == "judged" {
                        own_judged_map_same(ev, av)
                    } else {
                        ordered_same(ev, av)
                    }
                })
        }
        _ => ordered_same(expected, actual),
    }
}

/// The strict goal-aware decision comparison: module Goal `data` keeps source property order; every other field is exact.
pub(crate) fn ordered_same_goal(a: &SVal, b: &SVal) -> bool {
    let (SVal::Obj(ax), SVal::Obj(bx)) = (a, b) else {
        return ordered_same(a, b);
    };
    let field = |entries: &[(String, SVal)], name: &str| {
        entries
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    match (field(ax, "kind"), field(bx, "kind")) {
        (Some(SVal::Str(k1)), Some(SVal::Str(k2))) if k1 == "module" && k2 == "module" => {
            ax.len() == bx.len()
                && ax.iter().all(|(k, v)| {
                    bx.iter().find(|(bk, _)| bk == k).is_some_and(|(_, bv)| {
                        if k == "data" {
                            ordered_same(v, bv)
                        } else {
                            source_reader::same(v, bv)
                        }
                    })
                })
        }
        _ => ordered_same(a, b),
    }
}

pub(crate) fn ordered_same_goal_decision(a: &SVal, b: &SVal) -> bool {
    let (SVal::Obj(ax), SVal::Obj(bx)) = (a, b) else {
        return ordered_same(a, b);
    };
    ax.len() == bx.len()
        && ax.iter().all(|(k, v)| {
            bx.iter().find(|(bk, _)| bk == k).is_some_and(|(_, bv)| {
                if k == "goal" {
                    ordered_same_goal(v, bv)
                } else {
                    ordered_same(v, bv)
                }
            })
        })
}

fn location(label: &str, expected: &SVal, actual: &SVal) -> String {
    format!("{label}: expected={expected:?} actual={actual:?}")
}

pub(crate) fn compare_ordered(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    if !ordered_same(expected, actual) {
        failures.push(location(label, expected, actual));
    }
}

pub(crate) fn compare_goal_ordered(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    if !ordered_same_goal_decision(expected, actual) {
        failures.push(location(label, expected, actual));
    }
}

/// The reviewed numeric whitelist leaf (docs/evidence/bot-private-strategy-source/NUMERIC_CONTRACT.md): the declared
/// path walk return distance is a source `Math.hypot` geometric leaf and may use the inherited C-PARITY 2e-6 absolute
/// bound. Nothing else in the transcript is tolerant: identities, order, arguments, RNG and every other result stay exact.
const PATH_DIST_TOLERANCE: f64 = 2e-6;

fn leaf_within(expected: &SVal, actual: &SVal) -> bool {
    match (expected, actual) {
        (SVal::Num(e), SVal::Num(a)) => {
            e.to_bits() == a.to_bits() || (e - a).abs() <= PATH_DIST_TOLERANCE
        }
        _ => false,
    }
}

fn path_walk_result_same(expected: &SVal, actual: &SVal) -> bool {
    match (expected, actual) {
        (SVal::Null, SVal::Null) => true,
        (SVal::Obj(e), SVal::Obj(a)) => {
            e.len() == a.len()
                && e.iter().zip(a).all(|((ek, ev), (ak, av))| {
                    if ek != ak {
                        return false;
                    }
                    if ek == "dist" {
                        leaf_within(ev, av)
                    } else {
                        ordered_same(ev, av)
                    }
                })
        }
        _ => false,
    }
}

pub(crate) fn first_difference(expected: &SVal, actual: &SVal, path: &str) -> Option<String> {
    match (expected, actual) {
        (SVal::Obj(e), SVal::Obj(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: object length expected {} actual {}",
                    e.len(),
                    a.len()
                ));
            }
            for ((ek, ev), (ak, av)) in e.iter().zip(a) {
                if ek != ak {
                    return Some(format!("{path}: key expected {ek:?} actual {ak:?}"));
                }
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}.{ek}"));
                }
            }
            None
        }
        (
            SVal::Instance {
                name: en,
                entries: ee,
            },
            SVal::Instance {
                name: an,
                entries: ae,
            },
        ) => {
            if en != an || ee.len() != ae.len() {
                return Some(format!(
                    "{path}: instance expected {en}/{}, actual {an}/{}",
                    ee.len(),
                    ae.len()
                ));
            }
            for ((ek, ev), (ak, av)) in ee.iter().zip(ae) {
                if ek != ak {
                    return Some(format!(
                        "{path}: instance key expected {ek:?} actual {ak:?}"
                    ));
                }
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}.{ek}"));
                }
            }
            None
        }
        (SVal::Arr(e), SVal::Arr(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: array length expected {} actual {}",
                    e.len(),
                    a.len()
                ));
            }
            for (i, (ev, av)) in e.iter().zip(a).enumerate() {
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}[{i}]"));
                }
            }
            None
        }
        (SVal::Map(e), SVal::Map(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: map length expected {} actual {}",
                    e.len(),
                    a.len()
                ));
            }
            for (i, ((ek, ev), (ak, av))) in e.iter().zip(a).enumerate() {
                if !ordered_same(ek, ak) {
                    return Some(format!("{path}: map key {i} differs"));
                }
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}[{i}]"));
                }
            }
            None
        }
        _ => Some(format!("{path}: expected={expected:?} actual={actual:?}")),
    }
}

fn event_field<'a>(entries: &'a [(String, SVal)], name: &str) -> Option<&'a SVal> {
    entries
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
}

fn callback_event_same(expected: &SVal, actual: &SVal) -> bool {
    let (SVal::Obj(ee), SVal::Obj(ae)) = (expected, actual) else {
        return false;
    };
    if matches!(event_field(ee, "kind"), Some(SVal::Str(kind)) if kind == "rng") {
        return ordered_same(expected, actual);
    }
    let name = match (event_field(ee, "name"), event_field(ae, "name")) {
        (Some(SVal::Str(e)), Some(SVal::Str(a))) if e == a => e.clone(),
        _ => return false,
    };
    if name == "paths.walk" {
        if ee.len() != ae.len() {
            return false;
        }
        return ee.iter().all(|(key, ev)| {
            ae.iter().find(|(ak, _)| ak == key).is_some_and(|(_, av)| {
                if key == "result" {
                    path_walk_result_same(ev, av)
                } else {
                    ordered_same(ev, av)
                }
            })
        });
    }
    ordered_same(expected, actual)
}

pub(crate) fn compare_callback_values(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    let (SVal::Arr(expected_events), SVal::Arr(actual_events)) = (expected, actual) else {
        failures.push(format!(
            "{label} callbacks: non-array transcript expected={expected:?} actual={actual:?}"
        ));
        return;
    };
    if expected_events.len() != actual_events.len() {
        failures.push(format!(
            "{label} callbacks: expected {} events actual {}",
            expected_events.len(),
            actual_events.len()
        ));
        return;
    }
    for (index, (expected_event, actual_event)) in
        expected_events.iter().zip(actual_events).enumerate()
    {
        if callback_event_same(expected_event, actual_event) {
            continue;
        }
        let detail = first_difference(expected_event, actual_event, "event")
            .unwrap_or_else(|| "event differs".into());
        failures.push(format!("{label} callbacks[{index}]: {detail}"));
        return;
    }
}

pub(crate) fn compare_callbacks(
    label: &str,
    expected: &SVal,
    trace: &TraceHandle,
    failures: &mut Vec<String>,
) {
    compare_callback_values(label, expected, &trace.borrow().encoded(), failures);
}

pub(crate) fn compare_draw_count_values(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    if !source_reader::same(expected, actual) {
        failures.push(format!(
            "{label} drawCounts: expected={expected:?} actual={actual:?}"
        ));
    }
}

pub(crate) fn compare_draw_counts(
    label: &str,
    expected: &SVal,
    decide: usize,
    motor: usize,
    lapse: usize,
    knowledge: usize,
    failures: &mut Vec<String>,
) {
    let actual = obj(vec![
        ("decide", n(decide as f64)),
        ("motor", n(motor as f64)),
        ("lapse", n(lapse as f64)),
        ("knowledge", n(knowledge as f64)),
    ]);
    compare_draw_count_values(label, expected, &actual, failures);
}
