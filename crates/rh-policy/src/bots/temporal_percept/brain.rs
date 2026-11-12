//! Complete private Brain composition (P-BOT-BRAIN-NATIVE-1): the unchanged legacy `createBrain` coordinator over the
//! admitted private Memory, Strategy, Tactics, four feature modules, Knowledge, path service and Humanizer.
//!
//! This is a private method-level policy component. It accepts the declared source-shaped inputs (the complete private
//! `Percept`, caller services/modules/tier) and emits source-shaped timed commands, goals, statuses and diagnostics. It
//! does not bind those inputs to accepted live observations, validate/submit commands, activate bots, change the public
//! wire or claim full gameplay completion. Source order, identities, ordered collections, absence/Undefined/Null, f64
//! values and the three runtime RNG lanes are preserved; expected frozen outputs are never installed as state or fed back
//! as inputs.
//!
//! Source: `packages/server/src/bots/brain/brain.ts` at the frozen witness; components are the admitted private ports in
//! this subsystem (`strategy/`, `tactics.rs`, `modules/`, `memory.rs`, `../humanizer.rs`, `../knowledge.rs`, `../paths.rs`).

mod adapters;
mod config;
#[cfg(test)]
mod controls_tests;
#[cfg(test)]
mod hand_tests;
mod host;
#[cfg(test)]
mod knowledge_tests;
mod percept;
#[cfg(test)]
mod source_input;
#[cfg(test)]
mod tests;
mod trace;

pub(crate) mod compose14;
pub(crate) mod room_paths;

pub(crate) use super::modules::types::CfgToken as BrainCfgToken;
pub(crate) use super::strategy::types::LearnedBias as SeatLearnedBias;
pub(crate) use config::{
    BrainConfig as SeatBrainConfig, CallerServices as SeatCallerServices,
    PathHandle as SeatPathHandle, RoomFrame as SeatRoomFrame, RunResult as SeatRunResult,
};
pub(crate) use host::ModuleHost as SeatModuleHost;
#[cfg(test)]
pub(crate) use trace::BVal as SeatBVal;

use config::{
    BrainConfig, BrainError, BrainMap, BrainRngs, BrainStats, CallerServices, ReleasedCommand,
    ReleasedCommands, RoomFrame, RunResult, RunSummary, ACT_MAX_GAP_MS, GRAB_WINDOW_MS, STILL_EPS,
    STILL_GRACE_MS,
};
use host::{guard_act_fallback, guard_log_message, new_bcfg_token, ModuleHandle, ModuleKind};
use percept::Percept;
use trace::{BVal, IdentityKey, Recorder};

use super::memory::{Memory, MemoryCommand, MemoryConfig, MemoryTimedCommand};
use super::modules::types::{
    CfgToken, Goal, GoalDecision, GoalKind, GoalStatus, ModuleConfig, ModuleContext, ModulePaths,
    ModulePercept, RngLanes,
};
use super::strategy::types::{
    AttackFn, FeatureModule, GoalState, LearnedBias, LogFn, MemoryApi as StrategyMemoryApi,
    StrategyConfig, StrategyContext,
};
use super::strategy::{Strategy, StrategyOptions};
use super::tactics::types::{
    Intent as TacticsIntent, IntentBody as TacticsIntentBody, TacticPercept, TacticsConfig,
    TacticsContext,
};
use super::tactics::Tactics;
use crate::bots::clicks::BotMap;
use crate::bots::humanizer::{Context as HandContext, Humanizer};
use crate::bots::knowledge::Knowledge;
use crate::bots::random::Rng;
use crate::bots::types::{
    Cadence, Command, Intent as HandIntent, PersonaParams, ServerMs, Stimulus, StimulusKind,
    TierParams, TimedCommand,
};
use crate::bots::view::Features;
use rh_sim::mapgen::certify::source_hypot as hypot;
use rh_sim::{FactionId, Vec2};
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

const SALIENT: [StimulusKind; 8] = [
    StimulusKind::NewThreat,
    StimulusKind::LowHp,
    StimulusKind::Teleport,
    StimulusKind::TargetDown,
    StimulusKind::Announcement,
    StimulusKind::ChestUp,
    StimulusKind::PlanOffer,
    StimulusKind::LockLost,
];

fn is_salient(stimuli: &[Stimulus]) -> bool {
    stimuli.iter().any(|s| SALIENT.contains(&s.kind))
}

fn running_start() -> GoalStatus {
    GoalStatus::running("start")
}

#[derive(Clone, Debug, PartialEq)]
struct LastTactics {
    intents: Vec<HandIntent>,
    status: GoalStatus,
    attacking: bool,
}

impl Default for LastTactics {
    fn default() -> Self {
        Self {
            intents: Vec::new(),
            status: running_start(),
            attacking: false,
        }
    }
}

fn describe(goal: &Goal) -> String {
    match goal {
        Goal::Farm { mob, .. } => format!("farm {mob}"),
        Goal::Hunt { target } => format!("hunt {target}"),
        Goal::Fight { target } => format!("fight {target}"),
        Goal::Loot { container } => format!("loot {container}"),
        Goal::Roam { to, why } => format!(
            "roam to {},{} ({})",
            js_round(to.x) as i64,
            js_round(to.y) as i64,
            why.as_str()
        ),
        Goal::Hold { why, .. } => format!("hold {}", why.as_str()),
        Goal::Module { module, .. } => format!("module {module}"),
        Goal::Flee { .. } => "flee".into(),
        Goal::Idle => "idle".into(),
    }
}

fn js_round(value: f64) -> f64 {
    super::strategy::types::js_round(value)
}

/// JS `utility.toFixed(2)`: round the exact binary64 to two decimals; a tie selects the larger integer n (JS spec).
fn js_to_fixed_2(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value > 0. {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    let negative = value < 0. || (value == 0. && value.is_sign_negative());
    let scaled = value.abs() * 100.;
    let floor = scaled.floor();
    let fraction = scaled - floor;
    let rounded = if fraction >= 0.5 { floor + 1. } else { floor };
    let n = rounded as i64;
    let sign = if negative { "-" } else { "" };
    format!("{sign}{}.{:02}", n / 100, n % 100)
}

macro_rules! engine_frame {
    ($brain:expr, $now:expr, $raw:expr, $module_percept:expr, $engaged:expr, $recorder:expr, $actor:expr) => {{
        EngineFrame {
            brain_key: $brain.brain_key,
            bcfg: $brain.bcfg,
            original_cfg: $brain.original_cfg,
            now: $now,
            engaged: $engaged,
            percept_raw: $raw,
            module_percept: $module_percept,
            tier: $brain.tier,
            persona: $brain.persona,
            map: &$brain.map,
            features: &$brain.features,
            id: $brain.id.clone(),
            learned: Arc::clone(&$brain.services.learned),
            log: Arc::clone(&$brain.services.log),
            recorder: $recorder.clone(),
            actor: $actor.clone(),
        }
    }};
}
macro_rules! with_module_context {
    ($frame:expr, $paths:expr, $mem:expr, $decide:expr, $lapse:expr, $motor:expr, |$ctx:ident| $body:expr) => {{
        let frame_ = $frame;
        let actor_ = frame_.actor.as_deref().unwrap_or("");
        let learned_ = adapters::StrategyLearned {
            learned: &*frame_.learned,
            recorder: frame_.recorder.as_ref(),
            actor: actor_,
        };
        let cfg_ = ModuleConfig {
            token: frame_.bcfg,
            id: frame_.id.clone(),
            tier: frame_.tier,
            persona: frame_.persona,
            map: &frame_.map.open,
            terrain: &frame_.map.terrain,
            plan_map: &frame_.map.plan,
            features: frame_.features,
            learned: &learned_,
        };
        let collision_ = frame_.map.collision(frame_.module_percept.hud.gates_locked);
        let mut ctx_owned_ = ModuleContext {
            cfg: &cfg_,
            p: frame_.module_percept,
            mem: $mem,
            paths: $paths,
            collision: collision_,
            log: &*frame_.log,
            rng: RngLanes {
                decide: $decide,
                motor: $motor,
                lapse: $lapse,
            },
            engaged: frame_.engaged,
        };
        let $ctx = &mut ctx_owned_;
        $body
    }};
}

/// A stack-local recording draw lane over one actual Brain RNG (the source observer's wrapped `ctx.rng[lane]`).
fn recorded_lane<'a>(
    rng: &'a mut Rng,
    recorder: Option<Recorder>,
    actor: &'a str,
    lane: usize,
) -> adapters::RecordedLane<'a> {
    adapters::RecordedLane {
        rng,
        recorder,
        actor,
        lane,
    }
}

struct ModuleSet {
    handles: Vec<ModuleHandle>,
    faults: RefCell<BTreeSet<String>>,
}

/// One Brain's complete mutable state (source `createBrain` closure state).
pub(crate) struct Brain {
    id: String,
    name: String,
    seed: u32,
    tier: &'static TierParams,
    persona: &'static PersonaParams,
    map: Arc<BrainMap>,
    features: Features,
    services: CallerServices,
    service_label: String,
    recorder: Option<Recorder>,
    trace_actor: Option<String>,
    brain_key: u64,
    original_cfg: CfgToken,
    bcfg: CfgToken,
    rngs: BrainRngs,
    knowledge: Knowledge,
    memory: Memory,
    humanizer: Humanizer,
    tactics: Tactics,
    tactics_config: TacticsConfig,
    strategy: Strategy,
    attacking_flag: Arc<AtomicBool>,
    modules: ModuleSet,
    stimuli: Vec<Stimulus>,
    goal: Goal,
    status: GoalStatus,
    started: bool,
    next_strategy_at: ServerMs,
    next_think_at: ServerMs,
    order_seq: u16,
    faction: Option<FactionId>,
    goal_counts: Vec<(GoalKind, u64)>,
    still_since: Option<ServerMs>,
    last_pos: Option<Vec2>,
    max_stall: f64,
    grabs: u64,
    carried: Option<usize>,
    loot_at: ServerMs,
    last_tactics: LastTactics,
    last_engaged: bool,
    last_percept_now: f64,
}

impl Brain {
    /// Source `createBrain(cfg)`: validate the composition capability, create the tag-3 Knowledge, the actual Memory,
    /// the feature-aware Humanizer, Tactics, the per-Brain guarded module wrapper set / `bcfg` identity and Strategy with
    /// its attacking closure. No expected value is installed.
    pub(crate) fn new(cfg: BrainConfig) -> Result<Self, BrainError> {
        {
            let paths = Arc::clone(&cfg.services.paths);
            let service = paths.lock().unwrap_or_else(|poison| poison.into_inner());
            let capable = service.module_paths_capable();
            drop(service);
            #[cfg(test)]
            let capable = capable && !cfg.force_missing_module_paths;
            if !capable {
                return Err(BrainError::MissingModulePathsCapability);
            }
        }
        let seed = cfg.seed;
        let mut knowledge_rng = BrainRngs::knowledge(seed);
        let knowledge = Knowledge::create(cfg.tier, &mut knowledge_rng);
        let memory = Memory::new(MemoryConfig {
            self_id: cfg.id.clone(),
            tier: cfg.tier,
            map: cfg.map.memory.clone(),
            features: cfg.features.clone(),
        })
        .map_err(|_| BrainError::Shape("memory"))?;
        let humanizer = Humanizer::with_features(
            cfg.tier,
            BotMap::from_tile_map(&cfg.map.open),
            &cfg.features,
        );
        let tactics = Tactics::new();
        let tactics_config = TacticsConfig {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            seed,
            tier: *cfg.tier,
            persona: *cfg.persona,
            map: cfg.map.tactics.clone(),
            features: cfg.features.clone(),
            path_budget: 0,
            path: None,
        };
        let original_cfg = cfg.original_cfg;
        let bcfg = if cfg.modules.is_empty() {
            original_cfg
        } else {
            new_bcfg_token()
        };
        let attacking_flag = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&attacking_flag);
        let attacking: AttackFn = Arc::new(move || flag.load(Ordering::Relaxed));
        let log = Arc::clone(&cfg.services.log);
        let name = cfg.name.clone();
        let log_fn: LogFn = Arc::new(move |message: &str| log(&format!("{name}: {message}")));
        let strategy = Strategy::new(StrategyOptions {
            attacking: Some(attacking),
            log: Some(log_fn),
        });
        let brain_key = next_brain_key();
        Ok(Self {
            id: cfg.id,
            name: cfg.name,
            seed,
            tier: cfg.tier,
            persona: cfg.persona,
            map: cfg.map,
            features: cfg.features,
            services: cfg.services,
            service_label: cfg.service_label,
            recorder: cfg.recorder,
            trace_actor: cfg.trace_actor,
            brain_key,
            original_cfg,
            bcfg,
            rngs: BrainRngs::derive(seed),
            knowledge,
            memory,
            humanizer,
            tactics,
            tactics_config,
            strategy,
            attacking_flag,
            modules: ModuleSet {
                handles: cfg.modules,
                faults: RefCell::new(BTreeSet::new()),
            },
            stimuli: Vec::new(),
            goal: Goal::Idle,
            status: running_start(),
            started: false,
            next_strategy_at: 0.,
            next_think_at: 0.,
            order_seq: 0,
            faction: None,
            goal_counts: Vec::new(),
            still_since: None,
            last_pos: None,
            max_stall: 0.,
            grabs: 0,
            carried: None,
            loot_at: f64::NEG_INFINITY,
            last_tactics: LastTactics::default(),
            last_engaged: false,
            last_percept_now: 0.,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    /// The live seat's mob ids are sample-scoped references (P-BOT-BRAIN-LIVE-1): Memory drops a mob record once the
    /// percept no longer carries its reference (it can never be refreshed), instead of keeping it for the run.
    pub(crate) fn use_sample_scoped_mob_ids(&mut self) {
        self.memory.set_sample_scoped_mobs(true);
    }

    pub(crate) fn goal(&self) -> &Goal {
        &self.goal
    }

    pub(crate) fn status(&self) -> &GoalStatus {
        &self.status
    }

    /// Source `brain.stats` getter.
    pub(crate) fn stats(&self) -> BrainStats {
        let hunt = self.strategy.hunt_stats();
        let t = self.tactics.stats();
        let plan = self.strategy.plan();
        BrainStats {
            humanizer: self.humanizer.stats().clone(),
            mob_targets: hunt.targets as f64,
            mob_drops: hunt.drops as f64,
            retreats: hunt.retreats as f64,
            mob_focus_ms: hunt.focus_ms,
            grabs: self.grabs,
            max_stall_ms: self.max_stall,
            dodges: t.dodges,
            jukes: t.jukes,
            kite_cycles: t.kite_cycles,
            goals: self.goal_counts.clone(),
            build: plan
                .as_ref()
                .map_or(String::new(), |(build, _, _)| build.clone()),
            route_contests: plan.as_ref().map_or(0, |(_, _, contests)| *contests),
        }
    }

    /// Source `brain.tick(p)`.
    pub(crate) fn tick(
        &mut self,
        p: &Percept,
        room: &mut RoomFrame<'_>,
    ) -> Result<ReleasedCommands, BrainError> {
        let mut modules = std::mem::replace(
            &mut self.modules,
            ModuleSet {
                handles: Vec::new(),
                faults: RefCell::new(BTreeSet::new()),
            },
        );
        let result = self.tick_inner(p, room, &mut modules);
        self.modules = modules;
        result
    }

    fn tick_inner(
        &mut self,
        p: &Percept,
        room: &mut RoomFrame<'_>,
        modules: &mut ModuleSet,
    ) -> Result<ReleasedCommands, BrainError> {
        let now = p.now;
        let alive = p.alive();
        let recorder = self.recorder.clone();
        let actor = self.trace_actor.clone();
        let service_label = self.service_label.clone();
        let source_self = p.raw.get("self").ok_or(BrainError::Missing("self"))?;

        let paths_handle = Arc::clone(&self.services.paths);
        let mut service = paths_handle
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let mut set_frame_slot = trace::NO_SLOT;
        if let (Some(rec), Some(trace_actor)) = (recorder.as_ref(), actor.as_deref()) {
            set_frame_slot = trace::begin_callback(
                rec,
                trace_actor,
                "paths.setFrame",
                vec![BVal::num(now), BVal::flag(p.hud_gates_locked)],
                vec![("service", BVal::text(&service_label))],
            );
            let last_hit = if rec.is_active(trace_actor) {
                self.memory
                    .view()
                    .self_memory
                    .last_hit_at
                    .map_or(BVal::Null, BVal::num)
            } else {
                BVal::Undefined
            };
            trace::retained_memory_row(rec, trace_actor, last_hit);
        }
        service.set_frame(now, p.hud_gates_locked);
        if let (Some(rec), Some(_trace_actor)) = (recorder.as_ref(), actor.as_deref()) {
            trace::finish_callback(rec, set_frame_slot, BVal::Undefined);
        }

        let memory_percept = adapters::memory_percept(p)?;
        let observed: Vec<Stimulus> = self
            .memory
            .observe(&memory_percept)
            .map_err(|_| BrainError::Shape("memory.observe"))?
            .to_vec();
        let missed = self.humanizer.drain_misses();
        self.stimuli = if alive && !missed.is_empty() {
            let mut stimuli = observed;
            stimuli.extend(missed.iter().map(|m| Stimulus {
                kind: StimulusKind::ClickMissed,
                at: now,
                subject: Some(m.target.clone()),
                central: true,
                value: None,
            }));
            stimuli
        } else {
            observed
        };
        if let Some(faction) = p.me_faction {
            self.faction = Some(faction);
        }
        let last_hit_at = self.memory.view().self_memory.last_hit_at;
        let last_dealt_at = self.memory.view().self_memory.last_dealt_at;
        let engaged = is_engaged(p, &self.last_tactics, now, last_hit_at, last_dealt_at);
        self.last_engaged = engaged;
        self.last_percept_now = now;

        let module_percept = adapters::module_percept(p)?;
        let hand_percept = adapters::hand_percept(p)?;
        let strategy_percept = adapters::strategy_percept(p)?;
        let tactic_percept = adapters::tactic_percept(p)?;

        // A: selected guarded wrappers and their observe hooks, in original order, even when dead/nonactive.
        let mut selected: Vec<usize> = Vec::new();
        {
            let frame = engine_frame!(self, now, &p.raw, &module_percept, engaged, recorder, actor);
            let hook_trace = frame.trace();
            for index in 0..modules.handles.len() {
                let handle = &modules.handles[index];
                if guard_enabled(handle, &modules.faults, &self.features, &hook_trace) {
                    selected.push(index);
                }
            }
            for index in &selected {
                let handle = &modules.handles[*index];
                if !handle.has_hook("observe") {
                    continue;
                }
                if handle.kind == ModuleKind::Observer {
                    let mem = adapters::StrategyMemory {
                        mem: &self.memory,
                        stimuli: &self.stimuli,
                    };
                    record_observe(&frame, modules, &mem);
                    continue;
                }
                let mut adapter = adapters::BrainPathAdapter::new(
                    &mut **service,
                    room.budget,
                    frame.recorder.as_ref(),
                    frame.actor.as_deref().unwrap_or(""),
                    &service_label,
                    frame.percept_raw,
                    &self.map.raw,
                )?;
                let mem = adapters::StrategyMemory {
                    mem: &self.memory,
                    stimuli: &self.stimuli,
                };
                let mut decide = recorded_lane(
                    &mut self.rngs.decide,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    0,
                );
                let mut lapse = recorded_lane(
                    &mut self.rngs.lapse,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    2,
                );
                let mut motor = recorded_lane(
                    &mut self.rngs.motor,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    1,
                );
                with_module_context!(
                    &frame,
                    &mut adapter,
                    &mem,
                    &mut decide,
                    &mut lapse,
                    &mut motor,
                    |ctx| {
                        guard_observe(handle, &modules.faults, ctx, &hook_trace);
                    }
                );
            }
        }

        if !alive || !p.active() {
            self.still_since = None;
            self.last_pos = None;
            if p.planning() {
                let mut intents: Vec<HandIntent> = Vec::new();
                {
                    let frame =
                        engine_frame!(self, now, &p.raw, &module_percept, engaged, recorder, actor);
                    let hook_trace = frame.trace();
                    for index in &selected {
                        let handle = &modules.handles[*index];
                        if !handle.has_hook("intents") {
                            continue;
                        }
                        let mut adapter = adapters::BrainPathAdapter::new(
                            &mut **service,
                            room.budget,
                            frame.recorder.as_ref(),
                            frame.actor.as_deref().unwrap_or(""),
                            &service_label,
                            frame.percept_raw,
                            &self.map.raw,
                        )?;
                        let mem = adapters::StrategyMemory {
                            mem: &self.memory,
                            stimuli: &self.stimuli,
                        };
                        let mut decide = recorded_lane(
                            &mut self.rngs.decide,
                            frame.recorder.clone(),
                            frame.actor.as_deref().unwrap_or(""),
                            0,
                        );
                        let mut lapse = recorded_lane(
                            &mut self.rngs.lapse,
                            frame.recorder.clone(),
                            frame.actor.as_deref().unwrap_or(""),
                            2,
                        );
                        let mut motor = recorded_lane(
                            &mut self.rngs.motor,
                            frame.recorder.clone(),
                            frame.actor.as_deref().unwrap_or(""),
                            1,
                        );
                        with_module_context!(
                            &frame,
                            &mut adapter,
                            &mem,
                            &mut decide,
                            &mut lapse,
                            &mut motor,
                            |ctx| {
                                intents.extend(
                                    guard_intents(
                                        handle,
                                        &modules.faults,
                                        ctx,
                                        &Goal::Idle,
                                        &hook_trace,
                                    )
                                    .intents,
                                );
                            }
                        );
                    }
                }
                if !intents.is_empty() {
                    self.humanizer_submit(&hand_percept, &intents, engaged);
                }
            }
            let released = self.humanizer_release(&hand_percept, engaged);
            return self.flush(released);
        }

        self.watch_stall(p);
        self.watch_grabs(p);

        let first = !self.started;
        self.started = true;
        let mut changed = first;
        if first
            || now >= self.next_strategy_at
            || self.status.state != GoalState::Running
            || is_salient(&self.stimuli)
        {
            let decision = {
                let frame =
                    engine_frame!(self, now, &p.raw, &module_percept, engaged, recorder, actor);
                let goal_frame = GoalFrame {
                    engine: frame.clone(),
                    handles: &modules.handles,
                    faults: &modules.faults,
                    features: &self.features,
                };
                let motor_cell = RefCell::new(&mut self.rngs.motor);
                let mut goal_adapters: Vec<Box<dyn FeatureModule + '_>> = Vec::new();
                for index in 0..modules.handles.len() {
                    goal_adapters.push(Box::new(GoalAdapter::new(
                        index,
                        &modules.handles[index],
                        &goal_frame,
                        &motor_cell,
                    )));
                }
                let learned = adapters::StrategyLearned {
                    learned: &*self.services.learned,
                    recorder: frame.recorder.as_ref(),
                    actor: frame.actor.as_deref().unwrap_or(""),
                };
                let strategy_config = StrategyConfig {
                    id: self.id.clone(),
                    seed: self.seed,
                    tier: self.tier,
                    persona: self.persona,
                    map: &self.map.strategy,
                    features: &self.features,
                    learned: &learned,
                    modules: &goal_adapters,
                };
                let mut adapter = adapters::BrainPathAdapter::new(
                    &mut **service,
                    room.budget,
                    frame.recorder.as_ref(),
                    frame.actor.as_deref().unwrap_or(""),
                    &service_label,
                    frame.percept_raw,
                    &self.map.raw,
                )?;
                let mut mem = adapters::StrategyMemory {
                    mem: &self.memory,
                    stimuli: &self.stimuli,
                };
                let mut knowledge = adapters::StrategyKnowledge {
                    know: &self.knowledge,
                    recorder: frame.recorder.as_ref(),
                    actor: frame.actor.as_deref().unwrap_or(""),
                    source_self,
                };
                let mut decide = recorded_lane(
                    &mut self.rngs.decide,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    0,
                );
                let mut lapse = recorded_lane(
                    &mut self.rngs.lapse,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    2,
                );
                let mut strategy_ctx = StrategyContext {
                    cfg: &strategy_config,
                    p: &strategy_percept,
                    mem: &mut mem,
                    know: &mut knowledge,
                    paths: &mut adapter,
                    decide: &mut decide,
                    lapse: &mut lapse,
                    engaged,
                };
                self.strategy
                    .decide(&mut strategy_ctx, &self.goal, &self.status)
            };
            self.status = GoalStatus::running("decided");
            let cadence = self.tier.strategy_ms;
            let draw = self.draw_cadence(cadence);
            self.next_strategy_at = now + draw;
            changed = self.adopt(decision, now) || first;
        }

        let toast = p.has_toast;
        if changed || toast || !self.stimuli.is_empty() || now >= self.next_think_at {
            let out = self.act(
                &tactic_percept,
                &module_percept,
                &mut **service,
                room.budget,
                modules,
                &selected,
                engaged,
                now,
                &p.raw,
            )?;
            self.last_tactics = out.clone();
            self.attacking_flag.store(out.attacking, Ordering::Relaxed);
            self.status = out.status;
            let cadence = self.tier.think_ms;
            let draw = self.draw_cadence(cadence).min(ACT_MAX_GAP_MS);
            self.next_think_at = now + draw;
            if !out.intents.is_empty() {
                self.humanizer_submit(&hand_percept, &out.intents, engaged);
            }
        }

        let released = self.humanizer_release(&hand_percept, engaged);
        self.flush(released)
    }

    fn draw_cadence(&mut self, cadence: Cadence) -> f64 {
        let draw = self.rngs.decide.next_f64();
        if let (Some(rec), Some(actor)) = (self.recorder.as_ref(), self.trace_actor.as_deref()) {
            rec.rng(actor, 0, draw);
        }
        let lo = cadence.mean - cadence.jitter;
        let hi = cadence.mean + cadence.jitter;
        lo + (hi - lo) * draw
    }

    /// The Root-granted test-only draw observer scope for the two concrete Hand lanes: bind the actual lane instances to
    /// their recorder sinks for exactly one synchronous Hand call (the observer sits at `Rng::next_f64`, so motor/lapse
    /// draws append in their real global order). The lane addresses are identity keys only; the borrowed instances stay in
    /// place and the RAII scope restores the previous registration on return and unwind. Production builds compile the
    /// whole scope away.
    #[cfg(test)]
    fn hand_draw_scope(&self) -> Option<crate::bots::random::draw_observer::DrawScope> {
        let (rec, actor) = match (self.recorder.as_ref(), self.trace_actor.as_deref()) {
            (Some(rec), Some(actor)) => (rec, actor),
            _ => return None,
        };
        let sink = |lane: usize| {
            let rec = rec.clone();
            let actor = actor.to_string();
            Box::new(move |value: f64| rec.rng(&actor, lane, value))
        };
        let motor = std::ptr::addr_of!(self.rngs.motor) as usize;
        let lapse = std::ptr::addr_of!(self.rngs.lapse) as usize;
        Some(crate::bots::random::draw_observer::scope_draws(vec![
            (motor, sink(1)),
            (lapse, sink(2)),
        ]))
    }

    fn humanizer_submit(
        &mut self,
        p: &crate::bots::types::Percept,
        intents: &[HandIntent],
        engaged: bool,
    ) {
        #[cfg(test)]
        let _draw_scope = self.hand_draw_scope();
        let mut hand = HandContext {
            p,
            engaged,
            motor: &mut self.rngs.motor,
            lapse: &mut self.rngs.lapse,
        };
        self.humanizer.submit(intents, &mut hand);
    }

    fn humanizer_release(
        &mut self,
        p: &crate::bots::types::Percept,
        engaged: bool,
    ) -> Vec<TimedCommand> {
        #[cfg(test)]
        let _draw_scope = self.hand_draw_scope();
        let mut hand = HandContext {
            p,
            engaged,
            motor: &mut self.rngs.motor,
            lapse: &mut self.rngs.lapse,
        };
        self.humanizer.release(&mut hand)
    }

    #[allow(clippy::too_many_arguments)]
    fn act(
        &mut self,
        tactic_percept: &TacticPercept,
        module_percept: &ModulePercept,
        service: &mut dyn config::BrainPathService,
        budget: &mut crate::bots::paths::PathBudget,
        modules: &mut ModuleSet,
        selected: &[usize],
        engaged: bool,
        now: f64,
        percept_raw: &BVal,
    ) -> Result<LastTactics, BrainError> {
        let goal = self.goal.clone();
        if let Goal::Module { module, .. } = &goal {
            let found = selected
                .iter()
                .find(|index| modules.handles[**index].id == *module);
            let Some(index) = found else {
                return Ok(failed_output(format!(
                    "no module \"{module}\" to run this goal"
                )));
            };
            let handle = &modules.handles[*index];
            if !handle.has_hook("act") {
                return Ok(failed_output(format!(
                    "no module \"{module}\" to run this goal"
                )));
            }
            let recorder = self.recorder.clone();
            let actor = self.trace_actor.clone();
            let frame = engine_frame!(
                self,
                now,
                percept_raw,
                module_percept,
                engaged,
                recorder,
                actor
            );
            let hook_trace = frame.trace();
            let service_label = self.service_label.clone();
            let mut adapter = adapters::BrainPathAdapter::new(
                service,
                budget,
                frame.recorder.as_ref(),
                frame.actor.as_deref().unwrap_or(""),
                &service_label,
                frame.percept_raw,
                &self.map.raw,
            )?;
            let mem = adapters::StrategyMemory {
                mem: &self.memory,
                stimuli: &self.stimuli,
            };
            let mut decide = recorded_lane(
                &mut self.rngs.decide,
                frame.recorder.clone(),
                frame.actor.as_deref().unwrap_or(""),
                0,
            );
            let mut lapse = recorded_lane(
                &mut self.rngs.lapse,
                frame.recorder.clone(),
                frame.actor.as_deref().unwrap_or(""),
                2,
            );
            let mut motor = recorded_lane(
                &mut self.rngs.motor,
                frame.recorder.clone(),
                frame.actor.as_deref().unwrap_or(""),
                1,
            );
            let out = with_module_context!(
                &frame,
                &mut adapter,
                &mem,
                &mut decide,
                &mut lapse,
                &mut motor,
                |ctx| guard_act(handle, &modules.faults, ctx, &goal, &hook_trace)
            );
            return Ok(LastTactics {
                intents: out.intents,
                status: out.status,
                attacking: out.attacking,
            });
        }

        // Ordinary path: core Tactics first, then the ordered module intents, one merge and sequential adjust hooks.
        let out = {
            let recorder = self.recorder.clone();
            let actor = self.trace_actor.clone();
            let service_label = self.service_label.clone();
            let mut adapter = adapters::BrainPathAdapter::new(
                service,
                budget,
                recorder.as_ref(),
                actor.as_deref().unwrap_or(""),
                &service_label,
                percept_raw,
                &self.map.raw,
            )?;
            let mut mem = adapters::TacticsMemory {
                mem: &mut self.memory,
                stimuli: &self.stimuli,
            };
            let mut knowledge = adapters::TacticsKnowledge {
                know: &self.knowledge,
                recorder: recorder.as_ref(),
                actor: actor.as_deref().unwrap_or(""),
            };
            let mut decide = recorded_lane(
                &mut self.rngs.decide,
                recorder.clone(),
                actor.as_deref().unwrap_or(""),
                0,
            );
            let mut tactics_ctx = TacticsContext {
                cfg: &self.tactics_config,
                p: tactic_percept,
                mem: &mut mem,
                know: &mut knowledge,
                paths: &mut adapter,
                decide: &mut decide,
                engaged,
            };
            self.tactics
                .act(&mut tactics_ctx, &goal)
                .map_err(|_| BrainError::Shape("tactics.emptyWorldRoute"))?
        };
        let mut intents: Vec<HandIntent> = tactics_intents(out.intents);
        let mut list_token = next_intent_list_token();
        let mut extra: Vec<HandIntent> = Vec::new();
        {
            let recorder = self.recorder.clone();
            let actor = self.trace_actor.clone();
            let service_label = self.service_label.clone();
            let frame = engine_frame!(
                self,
                now,
                percept_raw,
                module_percept,
                engaged,
                recorder,
                actor
            );
            let hook_trace = frame.trace();
            for index in selected {
                let handle = &modules.handles[*index];
                if !handle.has_hook("intents") {
                    continue;
                }
                let mut adapter = adapters::BrainPathAdapter::new(
                    service,
                    budget,
                    frame.recorder.as_ref(),
                    frame.actor.as_deref().unwrap_or(""),
                    &service_label,
                    frame.percept_raw,
                    &self.map.raw,
                )?;
                let mem = adapters::StrategyMemory {
                    mem: &self.memory,
                    stimuli: &self.stimuli,
                };
                let mut decide = recorded_lane(
                    &mut self.rngs.decide,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    0,
                );
                let mut lapse = recorded_lane(
                    &mut self.rngs.lapse,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    2,
                );
                let mut motor = recorded_lane(
                    &mut self.rngs.motor,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    1,
                );
                let hook_intents = with_module_context!(
                    &frame,
                    &mut adapter,
                    &mem,
                    &mut decide,
                    &mut lapse,
                    &mut motor,
                    |ctx| guard_intents(handle, &modules.faults, ctx, &goal, &hook_trace)
                );
                extra.extend(hook_intents.intents);
            }
            if !extra.is_empty() {
                intents = crate::bots::brain::merge_intents(intents, extra);
                list_token = next_intent_list_token();
            }
            for index in selected {
                let handle = &modules.handles[*index];
                if !handle.has_hook("adjust") {
                    continue;
                }
                let mut adapter = adapters::BrainPathAdapter::new(
                    service,
                    budget,
                    frame.recorder.as_ref(),
                    frame.actor.as_deref().unwrap_or(""),
                    &service_label,
                    frame.percept_raw,
                    &self.map.raw,
                )?;
                let mem = adapters::StrategyMemory {
                    mem: &self.memory,
                    stimuli: &self.stimuli,
                };
                let mut decide = recorded_lane(
                    &mut self.rngs.decide,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    0,
                );
                let mut lapse = recorded_lane(
                    &mut self.rngs.lapse,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    2,
                );
                let mut motor = recorded_lane(
                    &mut self.rngs.motor,
                    frame.recorder.clone(),
                    frame.actor.as_deref().unwrap_or(""),
                    1,
                );
                let adjusted = with_module_context!(
                    &frame,
                    &mut adapter,
                    &mem,
                    &mut decide,
                    &mut lapse,
                    &mut motor,
                    |ctx| guard_adjust(
                        handle,
                        &modules.faults,
                        ctx,
                        &goal,
                        &intents,
                        list_token,
                        &hook_trace
                    )
                );
                intents = adjusted.0;
                list_token = adjusted.1;
            }
        }
        Ok(LastTactics {
            intents,
            status: out.status,
            attacking: out.attacking,
        })
    }

    fn watch_stall(&mut self, p: &Percept) {
        let me = Vec2::new(p.me_x, p.me_y);
        let busy = self.last_tactics.attacking
            || p.me_draw_started_at > 0.
            || self.goal.kind() == GoalKind::Loot
            || matches!(&self.goal, Goal::Hold { why, .. } if *why != super::strategy::types::HoldWhy::Wait)
            || p.sudden_death();
        let moved = match self.last_pos {
            None => true,
            Some(last) => hypot(me.x - last.x, me.y - last.y) >= STILL_EPS,
        };
        match self.still_since {
            None => self.still_since = Some(p.now),
            Some(_) if busy || moved => self.still_since = Some(p.now),
            Some(_) => {}
        }
        self.last_pos = Some(me);
        let since = self.still_since.unwrap_or(p.now);
        self.max_stall = self.max_stall.max(p.now - since - STILL_GRACE_MS);
    }

    fn watch_grabs(&mut self, p: &Percept) {
        let n = p.me_weapons.iter().filter(|w| w.is_some()).count();
        if self.goal.kind() == GoalKind::Loot {
            self.loot_at = p.now;
        }
        if self.carried.is_some_and(|carried| n > carried) && p.now - self.loot_at <= GRAB_WINDOW_MS
        {
            self.grabs += 1;
        }
        self.carried = Some(n);
    }

    fn adopt(&mut self, decision: GoalDecision, now: ServerMs) -> bool {
        let changed = super::strategy::types::goal_key(&decision.goal)
            != super::strategy::types::goal_key(&self.goal);
        self.goal = decision.goal;
        if !changed {
            return false;
        }
        let kind = self.goal.kind();
        match self.goal_counts.iter_mut().find(|(k, _)| *k == kind) {
            Some((_, count)) => *count += 1,
            None => self.goal_counts.push((kind, 1)),
        }
        if let Some(choice) = &decision.choice {
            self.memory.record_choice(choice);
        }
        self.last_tactics.attacking = false;
        self.attacking_flag.store(false, Ordering::Relaxed);
        (self.services.log)(&format!(
            "{}: {} ({}, utility {}) at {}",
            self.name,
            describe(&self.goal),
            decision.why,
            js_to_fixed_2(decision.utility),
            js_round(now) as i64
        ));
        true
    }

    fn flush(&mut self, released: Vec<TimedCommand>) -> Result<ReleasedCommands, BrainError> {
        if released.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(released.len());
        for tc in released {
            let mut seq = None;
            if matches!(tc.cmd, Command::Move { .. } | Command::Stop {}) {
                self.order_seq = (self.order_seq % 255) + 1;
                seq = Some(f64::from(self.order_seq));
            }
            let released = ReleasedCommand {
                at: tc.at,
                cmd: tc.cmd,
                intent: tc.intent,
                priority: tc.priority,
                stimulus: tc.stimulus,
                seq,
            };
            let memory_command = match &released.cmd {
                Command::Move { x, y } => MemoryCommand::Move { x: *x, y: *y, seq },
                Command::Stop {} => MemoryCommand::Stop { seq },
                Command::Target { id } => MemoryCommand::Target { id: id.clone() },
                Command::Pickup { container_id } => MemoryCommand::Pickup {
                    container_id: container_id.clone(),
                },
                Command::Cast { .. } => MemoryCommand::Cast,
                _ => MemoryCommand::Other,
            };
            let raw = trace::to_method_value(&trace::encode_released_command(&released))
                .ok_or(BrainError::Shape("released command"))?;
            self.memory
                .note_sent(MemoryTimedCommand {
                    at: released.at,
                    cmd: memory_command,
                    raw,
                })
                .map_err(|_| BrainError::Shape("memory.noteSent"))?;
            out.push(released);
        }
        Ok(out)
    }

    /// Source `brain.end(result)`: last known result fields or the void/zero defaults and a fresh choices copy.
    pub(crate) fn end(&self, result: Option<&RunResult>) -> RunSummary {
        RunSummary {
            tier: self.tier.id.as_str().to_string(),
            persona: self.persona.id.as_str().to_string(),
            faction: self.faction,
            outcome: result.map_or_else(|| "void".into(), |r| r.outcome.clone()),
            place: result.map_or(0., |r| r.place),
            players: result.map_or(0., |r| r.players),
            choices: self.memory.view().choices.to_vec(),
        }
    }

    pub(crate) fn draw_counts(&self) -> [u64; 3] {
        match (&self.recorder, &self.trace_actor) {
            (Some(rec), Some(actor)) => rec.counts(actor),
            _ => [0; 3],
        }
    }

    pub(crate) fn memory_snapshot(&self) -> BVal {
        trace::encode_memory_snapshot(&self.memory, &self.stimuli)
    }

    pub(crate) fn stats_snapshot(&self) -> BVal {
        trace::encode_brain_stats(&self.stats())
    }

    pub(crate) fn goal_snapshot(&self) -> BVal {
        trace::encode_goal(&self.goal)
    }

    pub(crate) fn engaged(&self) -> bool {
        self.last_engaged
    }

    pub(crate) fn last_now(&self) -> f64 {
        self.last_percept_now
    }
}

fn failed_output(why: String) -> LastTactics {
    LastTactics {
        intents: Vec::new(),
        status: GoalStatus::failed(why),
        attacking: false,
    }
}

fn next_brain_key() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn is_engaged(
    p: &Percept,
    last_tactics: &LastTactics,
    now: ServerMs,
    last_hit_at: Option<ServerMs>,
    last_dealt_at: Option<ServerMs>,
) -> bool {
    let trade = |at: Option<ServerMs>| {
        at.is_some_and(|at| now - at <= rh_sim::constants::ENGAGE_TRADE_SECONDS * 1000.)
    };
    (p.me_attack_target.is_some() && last_tactics.attacking)
        || trade(last_hit_at)
        || trade(last_dealt_at)
}

fn tactics_intents(intents: Vec<TacticsIntent>) -> Vec<HandIntent> {
    intents
        .into_iter()
        .map(|intent| HandIntent {
            body: match intent.body {
                TacticsIntentBody::Lock { target, at } => {
                    crate::bots::types::IntentBody::Lock { target, at }
                }
                TacticsIntentBody::Move { to } => {
                    crate::bots::types::IntentBody::Move { to: to.point() }
                }
                TacticsIntentBody::Stop {} => crate::bots::types::IntentBody::Stop {},
                TacticsIntentBody::Swap { slot } => crate::bots::types::IntentBody::Swap { slot },
                TacticsIntentBody::Pickup { container } => {
                    crate::bots::types::IntentBody::Pickup { container }
                }
            },
            priority: intent.priority,
            timing: intent.timing,
            why: intent.why,
        })
        .collect()
}

/// The per-tick frame the module/builtin callback contexts and their trace rows are built from. It borrows only the
/// caller's map/features/module-projection and holds cloned handles to the log/learned/recorder; every call site builds
/// it field-by-field so the mutable component fields stay independently borrowable (no whole-Brain lock).
#[derive(Clone)]
struct EngineFrame<'a> {
    brain_key: u64,
    bcfg: CfgToken,
    original_cfg: CfgToken,
    now: f64,
    engaged: bool,
    percept_raw: &'a BVal,
    module_percept: &'a ModulePercept,
    tier: &'static TierParams,
    persona: &'static PersonaParams,
    map: &'a BrainMap,
    features: &'a Features,
    id: String,
    learned: Arc<dyn LearnedBias + Send + Sync>,
    log: Arc<dyn Fn(&str) + Send + Sync>,
    recorder: Option<Recorder>,
    actor: Option<String>,
}

#[derive(Clone, Copy)]
struct HookTrace<'a> {
    recorder: Option<&'a Recorder>,
    actor: Option<&'a str>,
    cfg_identity: IdentityKey,
    original_cfg: bool,
    rng_identity: IdentityKey,
    knowledge_identity: IdentityKey,
    engaged: bool,
    percept_raw: &'a BVal,
    now: f64,
    log: &'a (dyn Fn(&str) + Send + Sync),
}

impl EngineFrame<'_> {
    fn trace(&self) -> HookTrace<'_> {
        let same_cfg = self.bcfg == self.original_cfg;
        HookTrace {
            recorder: self.recorder.as_ref(),
            actor: self.actor.as_deref(),
            cfg_identity: if same_cfg {
                IdentityKey::OriginalCfg(self.original_cfg.0)
            } else {
                IdentityKey::Bcfg(self.brain_key)
            },
            original_cfg: same_cfg,
            rng_identity: IdentityKey::Rng(self.brain_key),
            knowledge_identity: IdentityKey::Knowledge(self.brain_key),
            engaged: self.engaged,
            percept_raw: self.percept_raw,
            now: self.now,
            log: &*self.log,
        }
    }
}

impl HookTrace<'_> {
    fn active(&self) -> Option<(&Recorder, &str)> {
        match (self.recorder, self.actor) {
            (Some(rec), Some(actor)) => Some((rec, actor)),
            _ => None,
        }
    }

    fn builtin_context(&self, mem: &dyn StrategyMemoryApi) -> BVal {
        let stimuli = mem.stimuli().to_vec();
        let Some((rec, _)) = self.active() else {
            return BVal::Null;
        };
        let cfg_identity = rec.identity(self.cfg_identity);
        let rng_identity = rec.identity(self.rng_identity);
        let knowledge_identity = rec.identity(self.knowledge_identity);
        trace::builtin_context(
            self.percept_raw,
            trace::encode_memory_snapshot_api(mem, &stimuli),
            self.engaged,
            cfg_identity,
            self.original_cfg,
            rng_identity,
            knowledge_identity,
        )
    }

    fn module_context(&self) -> BVal {
        let Some((rec, _)) = self.active() else {
            return BVal::Null;
        };
        trace::module_context(self.now, self.engaged, rec.identity(self.cfg_identity))
    }
}

struct GoalFrame<'a> {
    engine: EngineFrame<'a>,
    handles: &'a [ModuleHandle],
    faults: &'a RefCell<BTreeSet<String>>,
    features: &'a Features,
}

struct GoalAdapter<'a, 'f> {
    slot: usize,
    handle: &'a ModuleHandle,
    frame: &'a GoalFrame<'f>,
    motor: &'a RefCell<&'a mut Rng>,
}

impl<'a, 'f> GoalAdapter<'a, 'f> {
    fn new(
        slot: usize,
        handle: &'a ModuleHandle,
        frame: &'a GoalFrame<'f>,
        motor: &'a RefCell<&'a mut Rng>,
    ) -> Self {
        Self {
            slot,
            handle,
            frame,
            motor,
        }
    }
}

impl FeatureModule for GoalAdapter<'_, '_> {
    fn id(&self) -> &str {
        let _ = self.slot;
        &self.handle.id
    }

    fn enabled(&self, features: &Features) -> bool {
        let trace = self.frame.engine.trace();
        guard_enabled(self.handle, self.frame.faults, features, &trace)
    }

    fn goals(&self, ctx: &mut StrategyContext<'_>) -> Vec<GoalDecision> {
        if !self.handle.has_hook("goals") {
            // Source `guardModules` copies the `goals` property only when the actual module object declares it; Strategy
            // calls only present hooks, so an absent hook produces no call, no row and no fallback.
            return Vec::new();
        }
        let Some(paths) = ctx.paths.module_paths() else {
            return Vec::new();
        };
        let paths: &mut dyn ModulePaths = paths;
        let trace = self.frame.engine.trace();
        let mem = ctx.mem;
        let mut motor = self.motor.borrow_mut();
        let rng: &mut Rng = &mut motor;
        let mut motor_lane = recorded_lane(
            rng,
            self.frame.engine.recorder.clone(),
            self.frame.engine.actor.as_deref().unwrap_or(""),
            1,
        );
        with_module_context!(
            &self.frame.engine,
            paths,
            mem,
            ctx.decide,
            ctx.lapse,
            &mut motor_lane,
            |module_ctx| guard_goals(self.handle, self.frame.faults, module_ctx, &trace)
        )
    }
}

fn record_observe(frame: &EngineFrame<'_>, modules: &ModuleSet, mem: &dyn StrategyMemoryApi) {
    let trace = frame.trace();
    let Some((rec, actor)) = trace.active() else {
        return;
    };
    let cfg_identity = rec.identity(trace.cfg_identity);
    let rng_identity = rec.identity(trace.rng_identity);
    let mut module_identities = Vec::with_capacity(modules.handles.len());
    for slot in 0..modules.handles.len() {
        module_identities.push(rec.identity(IdentityKey::Wrapper {
            brain: frame.brain_key,
            slot: slot as u64,
        }));
    }
    let stimuli = mem.stimuli().to_vec();
    trace::observe_row(
        rec,
        actor,
        cfg_identity,
        trace.original_cfg,
        rng_identity,
        &module_identities,
        trace.engaged,
        trace::encode_memory_snapshot_api(mem, &stimuli),
    );
    rec.activate(actor);
}

// ---------------------------------------------------------------------------------------------------------------------
// Guarded module hook boundary (source `guardModules`).

fn guard_fault(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    trace: &HookTrace<'_>,
    what: &str,
    fault: &host::SourceHookFault,
) {
    // Source `guardModules.run` logs every caught throw (an id already in the fault set still logs each later throw).
    faults.borrow_mut().insert(handle.id.clone());
    (trace.log)(&guard_log_message(&handle.id, what, fault));
}

fn guard_enabled(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    features: &Features,
    trace: &HookTrace<'_>,
) -> bool {
    if faults.borrow().contains(&handle.id) {
        return false;
    }
    if handle.kind == ModuleKind::Observer {
        return handle.lock().enabled(features).unwrap_or(true);
    }
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "enabled",
                    vec![trace::encode_features(features)],
                    None,
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "enabled",
                    rec.next_hook_index(actor, &handle.handle, "enabled"),
                    vec![trace::encode_features(features)],
                    None,
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let result = handle.lock().enabled(features);
    match result {
        Ok(value) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_finish(rec, slot, BVal::flag(value));
                } else {
                    trace::module_row_finish(rec, slot, BVal::flag(value));
                }
            }
            value
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "enabled", &fault);
            false
        }
    }
}

fn guard_observe(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    ctx: &mut ModuleContext<'_>,
    trace: &HookTrace<'_>,
) {
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "observe",
                    Vec::new(),
                    Some(trace.builtin_context(ctx.mem)),
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "observe",
                    rec.next_hook_index(actor, &handle.handle, "observe"),
                    Vec::new(),
                    Some(trace.module_context()),
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let result = handle.lock().observe(ctx);
    match result {
        Ok(()) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_finish(rec, slot, BVal::Undefined);
                } else {
                    trace::module_row_finish(rec, slot, BVal::Undefined);
                }
            }
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "observe", &fault);
        }
    }
}

fn guard_goals(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    ctx: &mut ModuleContext<'_>,
    trace: &HookTrace<'_>,
) -> Vec<GoalDecision> {
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "goals",
                    Vec::new(),
                    Some(trace.builtin_context(ctx.mem)),
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "goals",
                    rec.next_hook_index(actor, &handle.handle, "goals"),
                    Vec::new(),
                    Some(trace.module_context()),
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let result = handle.lock().goals(ctx);
    match result {
        Ok(goals) => {
            if let Some(rec) = rec {
                let encoded = trace::encode_goal_decision_list(&goals);
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_finish(rec, slot, encoded);
                } else {
                    trace::module_row_finish(rec, slot, encoded);
                }
            }
            goals
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "goals", &fault);
            Vec::new()
        }
    }
}

fn guard_intents(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    ctx: &mut ModuleContext<'_>,
    goal: &Goal,
    trace: &HookTrace<'_>,
) -> host::HookIntents {
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let args = vec![trace::encode_goal(goal)];
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "intents",
                    args,
                    Some(trace.builtin_context(ctx.mem)),
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "intents",
                    rec.next_hook_index(actor, &handle.handle, "intents"),
                    args,
                    Some(trace.module_context()),
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let result = handle.lock().intents(ctx, goal);
    match result {
        Ok(hook) => {
            if let Some(rec) = rec {
                let encoded = hook
                    .trace
                    .clone()
                    .unwrap_or_else(|| trace::encode_intent_list(&hook.intents));
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_finish(rec, slot, encoded);
                } else {
                    trace::module_row_finish(rec, slot, encoded);
                }
            }
            hook
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "intents", &fault);
            host::HookIntents::typed(Vec::new())
        }
    }
}

fn guard_adjust(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    ctx: &mut ModuleContext<'_>,
    goal: &Goal,
    intents: &[HandIntent],
    list_token: u64,
    trace: &HookTrace<'_>,
) -> (Vec<HandIntent>, u64) {
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let args = vec![trace::encode_goal(goal), trace::encode_intent_list(intents)];
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "adjust",
                    args,
                    Some(trace.builtin_context(ctx.mem)),
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "adjust",
                    rec.next_hook_index(actor, &handle.handle, "adjust"),
                    args,
                    Some(trace.module_context()),
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let list_identity = match (rec, trace.active()) {
        (Some(rec), Some(_)) => rec.identity(IdentityKey::IntentList(list_token)),
        _ => 0,
    };
    let result = handle.lock().adjust(ctx, goal, intents);
    match result {
        Ok(cow) => {
            let borrowed = matches!(cow, std::borrow::Cow::Borrowed(_));
            let token = if borrowed {
                list_token
            } else {
                next_intent_list_token()
            };
            let out = cow.into_owned();
            if let Some(rec) = rec {
                let result_identity = rec.identity(IdentityKey::IntentList(token));
                let encoded = trace::encode_intent_list(&out);
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_adjusted(rec, slot, encoded, borrowed);
                } else {
                    trace::module_row_adjusted(
                        rec,
                        slot,
                        list_identity,
                        borrowed,
                        result_identity,
                        encoded,
                    );
                }
            }
            (out, token)
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "adjust", &fault);
            (intents.to_vec(), list_token)
        }
    }
}

fn guard_act(
    handle: &ModuleHandle,
    faults: &RefCell<BTreeSet<String>>,
    ctx: &mut ModuleContext<'_>,
    goal: &Goal,
    trace: &HookTrace<'_>,
) -> super::modules::types::ModuleOutput {
    let (slot, rec) = match trace.active() {
        Some((rec, actor)) => {
            let args = vec![trace::encode_goal(goal)];
            let slot = if handle.kind == ModuleKind::Builtin {
                trace::builtin_row_begin(
                    rec,
                    actor,
                    &handle.id,
                    "act",
                    args,
                    Some(trace.builtin_context(ctx.mem)),
                )
            } else {
                trace::module_row_begin(
                    rec,
                    actor,
                    &handle.handle,
                    &handle.id,
                    "act",
                    rec.next_hook_index(actor, &handle.handle, "act"),
                    args,
                    Some(trace.module_context()),
                )
            };
            (slot, Some(rec))
        }
        None => (trace::NO_SLOT, None),
    };
    let result = handle.lock().act(ctx, goal);
    match result {
        Ok(hook) => {
            if let Some(rec) = rec {
                let encoded = hook
                    .trace
                    .clone()
                    .unwrap_or_else(|| trace::encode_module_output(&hook.output));
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_finish(rec, slot, encoded);
                } else {
                    trace::module_row_finish(rec, slot, encoded);
                }
            }
            hook.output
        }
        Err(fault) => {
            if let Some(rec) = rec {
                if handle.kind == ModuleKind::Builtin {
                    trace::builtin_row_error(rec, slot, "Error", &fault.message);
                } else {
                    trace::module_row_error(rec, slot, &fault.message);
                }
            }
            guard_fault(handle, faults, trace, "act", &fault);
            guard_act_fallback(&handle.id)
        }
    }
}

fn next_intent_list_token() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

#[cfg(test)]
mod send_assertions {
    use super::*;
    fn assert_send<T: Send>() {}
    #[test]
    fn persistent_brain_graph_is_send() {
        assert_send::<Brain>();
        assert_send::<ModuleHandle>();
        assert_send::<Recorder>();
    }
}
