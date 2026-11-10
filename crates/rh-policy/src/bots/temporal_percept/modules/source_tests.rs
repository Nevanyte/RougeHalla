//! Frozen actual-source parity for the complete private feature modules (P-BOT-MODULES-1).
//!
//! This is the replay half of the witness: raw declared source facts drive the real admitted Memory/Knowledge/path
//! services and the real private module classes; the captured Memory snapshots, hunter diagnostics, intent/goal/status
//! outputs, callback transcripts and draw counts are comparisons only and never feed native inputs. No expected state is
//! installed, no hidden chest content is read, no actor id is fabricated, and every comparison starts exact.
//!
//! The corpus is `parity/policy/bot-private-modules/source.json` (rh-bot-private-modules-source/1, frozen at
//! SHA-256 645e85f1…): 255 cases / 3,259 operations covering choice, hunter, chests, planning, wishes, hazards and the
//! ordered registry.

#![allow(clippy::too_many_arguments)]

use std::cell::RefCell;
use std::rc::Rc;

use super::super::memory::{Memory, MemoryConfig};
use super::source_input::{
    self, Case, ContextExpected, Declaration, EnvSpec, HelperArgs, HelperName, HunterInput,
    Initial, Operation, PathDescriptor, SightDescriptor, Source, SourceConfig, WalkDescriptor,
};
use super::source_reader::SVal;
use super::source_trace as tr;
use super::{chest_hunt, types};

use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{PathBudget, RoomPathService, WalkAnswer};
use crate::bots::random::Rng;
use crate::bots::types::{Intent, TierParams};
use crate::bots::view::Features;
use rh_sim::geometry::has_line_of_sight;
use rh_sim::map::MASK_SIGHT;
use rh_sim::{FactionId, TileMap, Vec2};

use super::chests::ChestsModule;
use super::hazards::HazardsModule;
use super::planning::PlanningModule;
use super::registry::{CustomModule, Registry};
use super::types::{
    CfgToken, Goal, HuntChest, HuntSelf, LearnedBiasFn, ModuleConfig, ModuleContext, ModuleId,
    ModuleOutput, ModulePaths, ModulePercept, RngLanes, SourceModule,
};
use super::wishes::WishesModule;

const CASES: usize = 255;
const OPERATIONS: usize = 3_259;

// -------------------------------------------------------------------------------------------------------- case context

struct Bundle {
    key: String,
    cfg: SourceConfig,
    map_index: usize,
    knowledge_draws: u64,
    memory: Memory,
    paths: RoomPathService,
    decide: tr::TraceRng,
    motor: tr::TraceRng,
    lapse: tr::TraceRng,
    percept: Option<ModulePercept>,
}

struct Modules {
    wishes: WishesModule,
    planning: PlanningModule,
    chests: ChestsModule,
    hazards: HazardsModule,
}

struct CaseCtx<'a> {
    source: &'a Source,
    case: &'a Case,
    bundles: Vec<Bundle>,
    modules: Modules,
    registry: Registry,
    hunter: chest_hunt::ChestHunter,
    trace: tr::TraceHandle,
    setup: tr::TraceHandle,
    policy: Option<std::sync::Arc<dyn Fn() + Send + Sync>>,
    /// Declared custom-registry `enabled` callbacks are captured here because the persistent registry closure must be
    /// `Send + Sync`; they are appended to the per-operation ordered trace after the operation (the source corpus calls
    /// no other callback inside the registry `enabled` operations, so the recorded order and sequence are exact).
    custom_callbacks: std::sync::Arc<std::sync::Mutex<Vec<(SVal, SVal, SVal)>>>,
}

/// The declared per-cfg learned view (produces the same enabled/raw-bias surface the source callback has).
struct LearnedView {
    enabled: bool,
    entries: Vec<(String, f64)>,
}
impl LearnedBiasFn for LearnedView {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn bias(&self, key: &str) -> f64 {
        self.entries
            .iter()
            .find(|(id, _)| id == key)
            .map_or(0., |(_, value)| *value)
    }
}

fn token_of(bundles: &[Bundle], key: &str) -> Result<(CfgToken, usize), String> {
    bundle_index(bundles, key).map(|index| (CfgToken(index as u64), index))
}
fn bundle_index(bundles: &[Bundle], key: &str) -> Result<usize, String> {
    bundles
        .iter()
        .position(|bundle| bundle.key == key)
        .ok_or_else(|| format!("unknown cfg identity {key}"))
}

// --------------------------------------------------------------------------------------------------- service wrappers

/// One operation's declared path service: the admitted `RoomPathService` behind the source's callback recording and
/// the runner's argument-sensitive denial adapter. The denial rule is exactly runner.mts: `env.path ?? cfg.path`;
/// `collisionMap` is never denied.
struct OpPaths<'a> {
    service: &'a mut RoomPathService,
    trace: tr::TraceHandle,
    cfg: String,
    /// The source object the module passes as the walk/clear `from` argument (percept self or hunter input self).
    from_args: Vec<SVal>,
    env: Option<PathDescriptor>,
    global: Option<PathDescriptor>,
    map_raw: SVal,
    gated: bool,
    locked_raw: Option<SVal>,
    /// The declared collision view handed to `collision_map()` consumers (opened map; the source gated view is a
    /// `withGates` copy whose only module consumer is classification, and the declared corpus never reaches a gated
    /// hazard collision-map hook).
    collision: TileMap,
}
impl OpPaths<'_> {
    fn descriptor(&self) -> Option<&PathDescriptor> {
        self.env.as_ref().or(self.global.as_ref())
    }
    fn denied(&self, a: Vec2, b: Vec2) -> bool {
        match self.descriptor() {
            Some(PathDescriptor::RadiusDenial { radius }) => {
                crate::bots::temporal_percept::modules::types::dist(a, b) > *radius
            }
            Some(PathDescriptor::HalfPlane { x }) => b.x >= *x,
            None => false,
        }
    }
    fn callback_args(&self, target: &[SVal]) -> Vec<SVal> {
        let mut args = self.from_args.clone();
        args.extend_from_slice(target);
        args
    }
}
impl ModulePaths for OpPaths<'_> {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        let args = self.callback_args(&[tr::encode_vec2(to)]);
        let result = self.walk_result(from, to);
        let encoded = result.map_or_else(tr::null, |answer| tr::encode_walk_answer(&answer));
        tr::record_callback(&self.trace, &self.cfg, "paths.walk", &args, encoded);
        result
    }
    fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
        let args = self.callback_args(&[tr::encode_vec2(to)]);
        let result = self.path_result(from, to);
        let encoded = result.as_ref().map_or_else(tr::null, |points| {
            tr::arr(points.iter().map(|point| tr::encode_vec2(*point)).collect())
        });
        tr::record_callback(&self.trace, &self.cfg, "paths.path", &args, encoded);
        result
    }
    fn los(&self, a: Vec2, b: Vec2) -> bool {
        let args = self.callback_args(&[tr::encode_vec2(b)]);
        let result = self.los_result(a, b);
        tr::record_callback(&self.trace, &self.cfg, "paths.los", &args, tr::b(result));
        result
    }
    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        let args = self.callback_args(&[tr::encode_vec2(b)]);
        let result = self.clear_result(a, b);
        tr::record_callback(&self.trace, &self.cfg, "paths.clear", &args, tr::b(result));
        result
    }
    fn collision_map(&self) -> &TileMap {
        let result = if self.gated {
            self.locked_raw
                .clone()
                .unwrap_or_else(|| self.map_raw.clone())
        } else {
            self.map_raw.clone()
        };
        tr::record_callback(&self.trace, &self.cfg, "paths.collisionMap", &[], result);
        &self.collision
    }
    fn walk_target(&mut self, from: Vec2, target: &HuntChest) -> Option<WalkAnswer> {
        let args = self.callback_args(&[tr::encode_method_value(&target.data())]);
        let result = self.walk_result(from, target.pos());
        let encoded = result.map_or_else(tr::null, |answer| tr::encode_walk_answer(&answer));
        tr::record_callback(&self.trace, &self.cfg, "paths.walk", &args, encoded);
        result
    }
    fn los_target(&self, from: Vec2, target: &HuntChest) -> bool {
        let args = self.callback_args(&[tr::encode_method_value(&target.data())]);
        let result = self.los_result(from, target.pos());
        tr::record_callback(&self.trace, &self.cfg, "paths.los", &args, tr::b(result));
        result
    }
}

impl OpPaths<'_> {
    fn denied_result(&self, a: Vec2, b: Vec2) -> Option<bool> {
        self.denied(a, b).then_some(false)
    }
    fn walk_result(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        if self.denied(from, to) {
            return None;
        }
        self.service.walk(from, to)
    }
    fn path_result(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
        if self.denied(from, to) {
            return None;
        }
        self.service.path(from, to)
    }
    fn los_result(&self, a: Vec2, b: Vec2) -> bool {
        if let Some(denied) = self.denied_result(a, b) {
            return denied;
        }
        self.service.los(a, b)
    }
    fn clear_result(&self, a: Vec2, b: Vec2) -> bool {
        if let Some(denied) = self.denied_result(a, b) {
            return denied;
        }
        self.service.clear(a, b)
    }
}

fn encode_hunt_self(self_: &HuntSelf) -> SVal {
    tr::encode_method_value(&self_.data())
}
fn encode_hunt_chest(chest: &HuntChest) -> SVal {
    tr::encode_method_value(&chest.data())
}

// ------------------------------------------------------------------------------------------------------ build/replay

fn load_source() -> Source {
    source_input::load().unwrap_or_else(|error| panic!("frozen modules source corpus: {error}"))
}

fn replay() -> (usize, usize, usize, Vec<String>, bool) {
    let source = load_source();
    assert_eq!(source.cases.len(), CASES, "frozen case count");
    let operations: usize = source.cases.iter().map(|case| case.operations.len()).sum();
    assert_eq!(operations, OPERATIONS, "frozen operation count");
    let selected = std::env::var("RH_MODULES_SUITES").ok();
    let filtered = selected.is_some();
    let mut cases = 0usize;
    let mut ops_run = 0usize;
    let mut failures = Vec::new();
    for case in &source.cases {
        if let Some(filter) = &selected {
            let suite = case.suite.as_str();
            if !filter.split(',').any(|item| item == suite) {
                continue;
            }
        }
        cases += 1;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut ctx = build_case(&source, case);
            let mut case_failures = Vec::new();
            check_initial(&mut ctx, &mut case_failures);
            let mut ran = 0usize;
            for (index, op) in case.operations.iter().enumerate() {
                ctx.trace.borrow_mut().reset();
                run_operation(&mut ctx, index, op, &mut case_failures);
                check_operation_state(&ctx, index, op, &mut case_failures);
                ran += 1;
            }
            (ran, case_failures)
        }));
        match result {
            Ok((ran, mut case_failures)) => {
                ops_run += ran;
                failures.append(&mut case_failures);
            }
            Err(payload) => {
                let message = payload
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_else(|| "panic".into());
                failures.push(format!("{}: replayed with panic: {message}", case.id));
                ops_run += case.operations.len();
            }
        }
    }
    (cases, ops_run, operations, failures, filtered)
}

fn build_case<'a>(source: &'a Source, case: &'a Case) -> CaseCtx<'a> {
    let setup = tr::TraceLog::new_handle();
    let trace = tr::TraceLog::new_handle();
    let mut bundles = Vec::new();
    for (key, cfg) in &case.configs {
        let map = &source.maps[cfg.map_index];
        let leaked_tier: &'static TierParams = Box::leak(Box::new(cfg.tier));
        // The knowledge constructor is called before any module state exists; its seed+3 draws are the setup transcript.
        let mut rng = Rng::new(cfg.seeds.knowledge);
        let _knowledge = Knowledge::create(&cfg.tier, &mut rng);
        let mut probe = Rng::new(cfg.seeds.knowledge);
        for index in 0..70u64 {
            let value = probe.next_f64();
            tr::record_external_draw(&setup, key, "knowledge", index, value);
        }
        assert_eq!(
            rng.next_u32(),
            probe.next_u32(),
            "{key}: admitted Knowledge constructor consumed exactly 70 seed+3 draws"
        );
        let mut memory_config: MemoryConfig = cfg
            .memory_config(map)
            .unwrap_or_else(|error| panic!("{key}: memory config: {error}"));
        memory_config.tier = leaked_tier;
        let memory =
            Memory::new(memory_config).unwrap_or_else(|error| panic!("{key}: memory: {error:?}"));
        let paths = RoomPathService::new(&map.open, PathBudget::new(cfg.path_budget));
        bundles.push(Bundle {
            key: key.clone(),
            cfg: cfg.clone(),
            map_index: cfg.map_index,
            knowledge_draws: 70,
            memory,
            paths,
            decide: tr::TraceRng::new(cfg.seeds.decide, key, "decide", &trace),
            motor: tr::TraceRng::new(cfg.seeds.motor, key, "motor", &trace),
            lapse: tr::TraceRng::new(cfg.seeds.lapse, key, "lapse", &trace),
            percept: None,
        });
    }
    CaseCtx {
        source,
        case,
        bundles,
        modules: Modules {
            wishes: WishesModule::default(),
            planning: PlanningModule::default(),
            chests: ChestsModule::default(),
            hazards: HazardsModule::default(),
        },
        registry: Registry::with_defaults(),
        hunter: chest_hunt::ChestHunter::new(case.hunter_config),
        trace,
        setup,
        policy: None,
        custom_callbacks: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
    }
}

fn context_state(bundle: &Bundle) -> SVal {
    tr::encode_context_state(
        &bundle.memory,
        [
            bundle.decide.draws(),
            bundle.motor.draws(),
            bundle.lapse.draws(),
            bundle.knowledge_draws,
        ],
        &bundle.paths.stats(),
    )
}

fn native_contexts(ctx: &CaseCtx<'_>) -> SVal {
    let states: Vec<(&str, SVal)> = ctx
        .bundles
        .iter()
        .map(|bundle| (bundle.key.as_str(), context_state(bundle)))
        .collect();
    tr::encode_contexts(&states)
}

fn expected_contexts(rows: &[(String, ContextExpected)]) -> SVal {
    let mut fields = Vec::new();
    for (key, row) in rows {
        let draw_counts = tr::obj(vec![
            ("decide", tr::n(row.draw_counts[0] as f64)),
            ("motor", tr::n(row.draw_counts[1] as f64)),
            ("lapse", tr::n(row.draw_counts[2] as f64)),
            ("knowledge", tr::n(row.draw_counts[3] as f64)),
        ]);
        fields.push((
            key.clone(),
            tr::obj(vec![
                ("memory", row.memory.clone()),
                ("drawCounts", draw_counts),
                ("pathStats", row.path_stats.clone()),
            ]),
        ));
    }
    SVal::Obj(fields)
}

fn hunter_capture(ctx: &CaseCtx<'_>) -> SVal {
    ctx.hunter.capture(&ctx.case.hunter_config, tr::callable())
}
fn expected_hunter(initial: &Initial) -> SVal {
    tr::obj(vec![
        ("own", initial.hunter_own.clone()),
        ("target", initial.target.clone()),
        ("stats", initial.stats.clone()),
    ])
}

fn check_initial(ctx: &mut CaseCtx<'_>, failures: &mut Vec<String>) {
    let label = format!("{} initial", ctx.case.id);
    tr::compare_callbacks(
        &format!("{label} setupTranscript"),
        &ctx.case.setup_transcript,
        &ctx.setup,
        failures,
    );
    let expected = expected_contexts(&ctx.case.initial.contexts);
    let actual = native_contexts(ctx);
    tr::compare_ordered(&format!("{label} contexts"), &expected, &actual, failures);
    let expected = expected_hunter(&ctx.case.initial);
    tr::compare_ordered(
        &format!("{label} hunter"),
        &expected,
        &hunter_capture(ctx),
        failures,
    );
}

fn check_operation_state(
    ctx: &CaseCtx<'_>,
    index: usize,
    op: &Operation,
    failures: &mut Vec<String>,
) {
    let label = format!("{} op {index} {}", ctx.case.id, op.method.as_str());
    tr::compare_callbacks(
        &format!("{label} callbacks"),
        &op.expected_callbacks,
        &ctx.trace,
        failures,
    );
    let expected = expected_contexts(&op.expected_contexts);
    let actual = native_contexts(ctx);
    tr::compare_ordered(&format!("{label} contexts"), &expected, &actual, failures);
    let expected = tr::obj(vec![
        ("own", op.expected_hunter.own.clone()),
        ("target", op.expected_hunter.target.clone()),
        ("stats", op.expected_hunter.stats.clone()),
    ]);
    tr::compare_ordered(
        &format!("{label} hunter"),
        &expected,
        &hunter_capture(ctx),
        failures,
    );
}

fn check_result(label: &str, expected: &SVal, actual: SVal, failures: &mut Vec<String>) {
    tr::compare_ordered(&format!("{label} result"), expected, &actual, failures);
}

// ----------------------------------------------------------------------------------------------------- operation drive

fn run_operation(ctx: &mut CaseCtx<'_>, index: usize, op: &Operation, failures: &mut Vec<String>) {
    let label = format!("{} op {index} {}", ctx.case.id, op.method.as_str());
    run_operation_inner(ctx, op, &label, failures);
    let captured: Vec<(SVal, SVal, SVal)> = ctx
        .custom_callbacks
        .lock()
        .map(|mut rows| std::mem::take(&mut *rows))
        .unwrap_or_default();
    for (token, features, enabled) in captured {
        tr::record_callback(
            &ctx.trace,
            "$registry",
            "custom.enabled",
            &[token, features],
            enabled,
        );
    }
}

fn run_operation_inner(
    ctx: &mut CaseCtx<'_>,
    op: &Operation,
    label: &str,
    failures: &mut Vec<String>,
) {
    match &op.declaration {
        Declaration::Observe {
            cfg,
            percept,
            memory_percept,
        } => {
            let index = match bundle_index(&ctx.bundles, cfg) {
                Ok(index) => index,
                Err(error) => return failures.push(format!("{label}: {error}")),
            };
            {
                let bundle = &mut ctx.bundles[index];
                bundle.paths.budget_mut().start_tick();
                bundle
                    .paths
                    .set_frame(percept.now, percept.hud.gates_locked);
                tr::record_callback(
                    &ctx.trace,
                    cfg,
                    "paths.setFrame",
                    &[tr::n(percept.now), tr::b(percept.hud.gates_locked)],
                    tr::undefined(),
                );
                match bundle.memory.observe(memory_percept) {
                    Ok(stimuli) => {
                        let result = tr::encode_stimulus_list(stimuli);
                        bundle.percept = Some((**percept).clone());
                        check_result(label, &op.expected_result, result, failures);
                    }
                    Err(error) => {
                        failures.push(format!("{label}: Memory.observe refused: {error:?}"));
                    }
                }
            }
        }
        Declaration::NoteSent { cfg, input } => {
            let index = match bundle_index(&ctx.bundles, cfg) {
                Ok(index) => index,
                Err(error) => return failures.push(format!("{label}: {error}")),
            };
            if let Err(error) = ctx.bundles[index].memory.note_sent(input.clone()) {
                failures.push(format!("{label}: Memory.noteSent refused: {error:?}"));
                return;
            }
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::RecordChoice { cfg, input } => {
            let index = match bundle_index(&ctx.bundles, cfg) {
                Ok(index) => index,
                Err(error) => return failures.push(format!("{label}: {error}")),
            };
            ctx.bundles[index].memory.record_choice(input);
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::Helper { name, args } => match run_helper(ctx, op, name, args) {
            Ok(result) => check_result(label, &op.expected_result, result, failures),
            Err(error) => failures.push(format!("{label}: {error}")),
        },
        Declaration::Hook {
            cfg,
            module,
            name,
            features,
            goal,
            engaged,
            env,
            intents,
        } => {
            if name == "enabled" {
                let declared = match features.clone().or_else(|| {
                    find_bundle_ref(ctx, cfg)
                        .ok()
                        .map(|b| b.cfg.features.clone())
                }) {
                    Some(features) => features,
                    None => return failures.push(format!("{label}: no features for enabled")),
                };
                let result = match module {
                    ModuleId::Wishes => ctx.modules.wishes.enabled(&declared),
                    ModuleId::Planning => ctx.modules.planning.enabled(&declared),
                    ModuleId::Chests => ctx.modules.chests.enabled(&declared),
                    ModuleId::Hazards => ctx.modules.hazards.enabled(&declared),
                };
                check_result(label, &op.expected_result, tr::b(result), failures);
                return;
            }
            match run_hook(
                ctx,
                cfg,
                *module,
                name,
                goal.as_ref(),
                *engaged,
                env,
                intents.as_deref(),
                label,
            ) {
                Ok(result) => {
                    let (value, identity) = result;
                    check_result(label, &op.expected_result, value, failures);
                    if let Some(identity) = identity {
                        if let Some(expected) = &op.identity {
                            tr::compare_ordered(
                                &format!("{label} identity"),
                                expected,
                                &identity,
                                failures,
                            );
                        }
                    }
                }
                Err(error) => failures.push(format!("{label}: {error}")),
            }
        }
        Declaration::HunterDecide { cfg, input } => {
            match run_hunter_decide(ctx, cfg, input, label) {
                Ok(result) => check_result(label, &op.expected_result, result, failures),
                Err(error) => failures.push(format!("{label}: {error}")),
            }
        }
        Declaration::HunterMarkDone { id } => {
            ctx.hunter.mark_done(id);
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::HunterTried { id } => {
            check_result(
                label,
                &op.expected_result,
                tr::b(ctx.hunter.tried(id)),
                failures,
            );
        }
        Declaration::HunterInspect => {
            let stats = tr::encode_hunt_stats(&ctx.hunter.stats);
            check_result(
                label,
                &op.expected_result,
                tr::encode_hunter_inspect(ctx.hunter.target(), stats),
                failures,
            );
        }
        Declaration::RegistryReset => {
            ctx.registry.reset();
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::RegistryDefaults => {
            ctx.registry.reset_defaults();
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::RegistryRegister(super::source_input::RegistryRegister {
            builtin,
            id,
            token,
            feature,
        }) => {
            match (builtin, id, token, feature) {
                (Some(module), _, _, _) => ctx.registry.register_builtin(*module),
                (None, Some(id), Some(token), Some(feature)) => {
                    let token = token.clone();
                    let feature = feature.clone();
                    let capture = ctx.custom_callbacks.clone();
                    ctx.registry.register_custom(CustomModule {
                        id: id.clone(),
                        token: token.clone(),
                        enabled: std::sync::Arc::new(move |features: &Features| {
                            let enabled =
                                feature == "always" || feature_enabled(features, &feature);
                            if let Ok(mut rows) = capture.lock() {
                                rows.push((
                                    tr::s(&token),
                                    tr::encode_features(features),
                                    tr::b(enabled),
                                ));
                            }
                            enabled
                        }),
                    });
                }
                _ => failures.push(format!("{label}: malformed custom registration")),
            }
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::RegistryEnabled { features } => {
            let rows = ctx.registry.enabled(features);
            check_result(
                label,
                &op.expected_result,
                tr::encode_enabled_modules(&rows),
                failures,
            );
        }
        Declaration::RegistryPolicySet => {
            let policy: std::sync::Arc<dyn Fn() + Send + Sync> =
                std::sync::Arc::new(|| panic!("opaque registered policy must not be called"));
            ctx.policy = Some(policy.clone());
            ctx.registry.register_cast_policy(policy);
            check_result(label, &op.expected_result, tr::undefined(), failures);
        }
        Declaration::RegistryPolicyGet => {
            let present = ctx.registry.cast_policy().is_some();
            // Source `getCastPolicy() === policyValue`: both are initially null, so the absent/absent case is true.
            let same = match (ctx.policy.as_ref(), ctx.registry.cast_policy()) {
                (None, None) => true,
                (Some(stored), Some(current)) => std::sync::Arc::ptr_eq(stored, current),
                _ => false,
            };
            check_result(
                label,
                &op.expected_result,
                tr::obj(vec![
                    ("present", tr::b(present)),
                    ("sameRegistered", tr::b(same)),
                ]),
                failures,
            );
        }
    }
}

fn feature_enabled(features: &Features, name: &str) -> bool {
    match name {
        "wishes" => features.wishes,
        "planning" => features.planning,
        "chests" => features.chests,
        "hazards" => features.hazards,
        "skills" => features.skills,
        "relics" => features.relics,
        "camps" => features.camps,
        "fields" => features.fields,
        "statusEffects" => features.status_effects,
        _ => false,
    }
}

fn find_bundle<'ctx>(ctx: &'ctx mut CaseCtx<'_>, key: &str) -> Result<&'ctx mut Bundle, String> {
    let index = bundle_index(&ctx.bundles, key)?;
    Ok(&mut ctx.bundles[index])
}

fn find_bundle_ref<'ctx>(ctx: &'ctx CaseCtx<'_>, key: &str) -> Result<&'ctx Bundle, String> {
    let index = bundle_index(&ctx.bundles, key)?;
    Ok(&ctx.bundles[index])
}

// ----------------------------------------------------------------------------------------------------------- helpers

fn run_helper(
    ctx: &mut CaseCtx<'_>,
    _op: &Operation,
    name: &HelperName,
    args: &HelperArgs,
) -> Result<SVal, String> {
    use super::choice;
    match (name, args) {
        (HelperName::CostsSomething, HelperArgs::Id { id }) => {
            Ok(tr::b(choice::costs_something(id)))
        }
        (HelperName::ActiveWeapon, HelperArgs::Self_ { self_ }) => {
            Ok(tr::s(types::weapon_name(choice::active_weapon(self_))))
        }
        (HelperName::CardScore, HelperArgs::IdSelf { id, self_ }) => {
            Ok(tr::n(choice::card_score(id, self_)))
        }
        (HelperName::OptionScore, HelperArgs::IdSelf { id, self_ }) => {
            Ok(tr::n(choice::option_score(id, self_)))
        }
        (
            HelperName::ChooseOption,
            HelperArgs::Choose {
                options,
                taken_by,
                self_,
            },
        ) => Ok(tr::n(choice::choose_option(options, taken_by, self_) as f64)),
        (HelperName::Burns, HelperArgs::MapFactionAt { map, faction, at }) => {
            let fixture = ctx
                .source
                .map(map)
                .map_err(|error| format!("burns map {map}: {error}"))?;
            Ok(tr::b(crate::bots::hazards::source_core::burns(
                &fixture.open,
                fixture.terrain(),
                source_faction(faction),
                *at,
            )))
        }
        (HelperName::Bad, HelperArgs::MapFactionAt { map, faction, at }) => {
            let fixture = ctx
                .source
                .map(map)
                .map_err(|error| format!("bad map {map}: {error}"))?;
            Ok(tr::b(crate::bots::hazards::source_core::bad(
                &fixture.open,
                fixture.terrain(),
                source_faction(faction),
                *at,
            )))
        }
        _ => Err("helper declaration and args tag mismatch".to_string()),
    }
}

fn source_faction(name: &str) -> Option<FactionId> {
    match name {
        "fire" => Some(FactionId::Fire),
        "sentenced" => Some(FactionId::Sentenced),
        "plague" => Some(FactionId::Plague),
        "frost" => Some(FactionId::Frost),
        "holy" => Some(FactionId::Holy),
        _ => None,
    }
}

// ------------------------------------------------------------------------------------------------------------ hooks

type HookRun = (SVal, Option<SVal>);

fn run_hook(
    ctx: &mut CaseCtx<'_>,
    cfg: &str,
    module: ModuleId,
    name: &str,
    goal: Option<&Goal>,
    engaged: Option<bool>,
    env: &EnvSpec,
    intents: Option<&[Intent]>,
    _label: &str,
) -> Result<HookRun, String> {
    let index = bundle_index(&ctx.bundles, cfg)?;
    let map_index = ctx.bundles[index].map_index;
    let env_path = env.path;
    let learned_entries = env
        .learned
        .clone()
        .unwrap_or_else(|| ctx.bundles[index].cfg.learned.entries.clone());
    let learned_enabled = ctx.bundles[index].cfg.learned.enabled;
    let CaseCtx {
        source,
        bundles,
        modules,
        trace,
        ..
    } = ctx;
    let map = &source.maps[map_index];
    let recorded_learned = tr::RecordedLearned::new(learned_enabled, learned_entries, cfg, trace);
    let log = tr::module_log(trace, cfg);
    let bundle = &mut bundles[index];
    let Bundle {
        cfg: source_cfg,
        memory,
        paths,
        decide,
        motor,
        lapse,
        percept,
        ..
    } = bundle;
    let Some(percept) = percept.as_ref() else {
        return Err("a module hook requires a preceding observe (source real Memory)".into());
    };
    let config = ModuleConfig {
        token: CfgToken(index as u64),
        id: source_cfg.id.clone(),
        tier: &source_cfg.tier,
        persona: &source_cfg.persona,
        map: &map.open,
        terrain: map.terrain(),
        plan_map: &map.plan,
        features: &source_cfg.features,
        learned: &recorded_learned,
    };
    let mut recorder = OpPaths {
        service: paths,
        trace: trace.clone(),
        cfg: cfg.to_string(),
        from_args: vec![tr::encode_method_value(&percept.self_.record)],
        env: env_path,
        global: source_cfg.path,
        map_raw: map.raw.clone(),
        gated: percept.hud.gates_locked,
        locked_raw: None,
        collision: map.open.clone(),
    };
    let mut context = ModuleContext {
        cfg: &config,
        p: percept,
        mem: memory,
        paths: &mut recorder,
        collision: if percept.hud.gates_locked {
            &map.locked
        } else {
            &map.open
        },
        log: &log,
        rng: RngLanes {
            decide,
            motor,
            lapse,
        },
        engaged: engaged.unwrap_or(false),
    };
    let goal = goal.cloned().unwrap_or(Goal::Idle);
    let outcome = match module {
        ModuleId::Wishes => dispatch(&mut modules.wishes, name, &mut context, &goal, intents),
        ModuleId::Planning => dispatch(&mut modules.planning, name, &mut context, &goal, intents),
        ModuleId::Chests => dispatch(&mut modules.chests, name, &mut context, &goal, intents),
        ModuleId::Hazards => dispatch(&mut modules.hazards, name, &mut context, &goal, intents),
    }?;
    Ok(outcome.into_value())
}

enum HookOutcome {
    Void,
    Goals(Vec<super::super::strategy::types::GoalDecision>),
    Intents(Vec<Intent>),
    Adjust {
        intents: Vec<Intent>,
        identity: bool,
    },
    Act(ModuleOutput),
}
impl HookOutcome {
    fn into_value(self) -> HookRun {
        match self {
            HookOutcome::Void => (tr::undefined(), None),
            HookOutcome::Goals(decisions) => (
                tr::arr(decisions.iter().map(tr::encode_goal_decision).collect()),
                None,
            ),
            HookOutcome::Intents(intents) => (tr::encode_intent_list(&intents), None),
            HookOutcome::Adjust { intents, identity } => (
                tr::encode_intent_list(&intents),
                Some(tr::obj(vec![("returnedInputList", tr::b(identity))])),
            ),
            HookOutcome::Act(output) => (tr::encode_module_output(&output), None),
        }
    }
}

fn dispatch<M: SourceModule>(
    module: &mut M,
    name: &str,
    ctx: &mut ModuleContext<'_>,
    goal: &Goal,
    intents: Option<&[Intent]>,
) -> Result<HookOutcome, String> {
    match name {
        "observe" => {
            module.observe(ctx);
            Ok(HookOutcome::Void)
        }
        "goals" => Ok(HookOutcome::Goals(module.goals(ctx))),
        "intents" => Ok(HookOutcome::Intents(module.intents(ctx, goal))),
        "act" => Ok(HookOutcome::Act(module.act(ctx, goal))),
        "adjust" => {
            let empty: [Intent; 0] = [];
            let input = intents.unwrap_or(&empty);
            let output = module.adjust(ctx, goal, input);
            let identity = matches!(output, std::borrow::Cow::Borrowed(_));
            Ok(HookOutcome::Adjust {
                intents: output.into_owned(),
                identity,
            })
        }
        other => Err(format!("module {} has no source hook {other}", module.id())),
    }
}

// ------------------------------------------------------------------------------------------------------ hunter decide

fn run_hunter_decide(
    ctx: &mut CaseCtx<'_>,
    cfg: &str,
    input: &HunterInput,
    label: &str,
) -> Result<SVal, String> {
    let index = bundle_index(&ctx.bundles, cfg)?;
    let map_index = ctx.bundles[index].map_index;
    let map = &ctx.source.maps[map_index];
    let map_raw = map.raw.clone();
    let locked_raw: Option<SVal> = None;
    let trace = ctx.trace.clone();
    let cfg_key = cfg.to_string();
    let walk_descriptor = input.walk;
    let sight_descriptor = input.sight;
    let env_path = ctx.bundles[index].cfg.path;
    let global_path = ctx.bundles[index].cfg.path;
    let self_data = tr::encode_declared_record(&input.self_.raw);
    let self_pos = Vec2::new(input.self_.x, input.self_.y);
    let chests: Vec<HuntChest> = input
        .chests
        .iter()
        .map(|row| row.to_hunt_chest())
        .collect::<Result<Vec<_>, String>>()?;
    let open_map = map.open.clone();
    let denied = |a: Vec2, b: Vec2| -> bool {
        match env_path.as_ref().or(global_path.as_ref()) {
            Some(PathDescriptor::RadiusDenial { radius }) => {
                crate::bots::temporal_percept::modules::types::dist(a, b) > *radius
            }
            Some(PathDescriptor::HalfPlane { x }) => b.x >= *x,
            None => false,
        }
    };
    let service: &mut RoomPathService = &mut ctx.bundles[index].paths;
    let mut walk = |chest: &HuntChest| -> Option<f64> {
        let chest_data = tr::encode_method_value(&chest.data());
        let to = chest.pos();
        let distance = crate::bots::temporal_percept::modules::types::dist(self_pos, to);
        let result: Rc<RefCell<Option<f64>>> = Rc::new(RefCell::new(None));
        {
            let slot = result.clone();
            let denied = &denied;
            tr::record_callback_with(
                &trace,
                &cfg_key,
                "hunter.walk",
                std::slice::from_ref(&chest_data),
                || match &walk_descriptor {
                    WalkDescriptor::Direct { factor } => {
                        *slot.borrow_mut() = Some(distance * factor);
                        tr::n(distance * factor)
                    }
                    WalkDescriptor::RadiusDenial { radius } => {
                        if distance > *radius {
                            *slot.borrow_mut() = None;
                            tr::null()
                        } else {
                            let answer = walked(
                                service,
                                &trace,
                                &cfg_key,
                                &self_data,
                                &chest_data,
                                self_pos,
                                to,
                                denied,
                            );
                            *slot.borrow_mut() = answer;
                            answer.map_or_else(tr::null, tr::n)
                        }
                    }
                    WalkDescriptor::Real => {
                        let answer = walked(
                            service,
                            &trace,
                            &cfg_key,
                            &self_data,
                            &chest_data,
                            self_pos,
                            to,
                            denied,
                        );
                        *slot.borrow_mut() = answer;
                        answer.map_or_else(tr::null, tr::n)
                    }
                },
            );
        }
        let walked_distance = *result.borrow();
        walked_distance
    };
    let mut sight = |chest: &HuntChest| -> bool {
        let chest_data = tr::encode_method_value(&chest.data());
        let to = chest.pos();
        let distance = crate::bots::temporal_percept::modules::types::dist(self_pos, to);
        let result = has_line_of_sight(&open_map, self_pos, to, MASK_SIGHT)
            && match &sight_descriptor {
                SightDescriptor::Source => true,
                SightDescriptor::RadiusDenial { radius } => distance <= *radius,
            };
        tr::record_callback(
            &trace,
            &cfg_key,
            "hunter.sight",
            &[chest_data],
            tr::b(result),
        );
        result
    };
    let mut log = tr::hunter_log(&trace);
    let mut chest_input = chest_hunt::ChestInput {
        now: input.now,
        server_time: input.server_time,
        self_: input.self_.to_hunt_self()?,
        chests,
        walk: &mut walk,
        sight: &mut sight,
        fighting: input.fighting,
        retreating: input.retreating,
        in_coliseum: input.in_coliseum,
        teleport_at: input.teleport_at,
    };
    let _ = (map_raw, locked_raw, label);
    let decision = ctx.hunter.decide(&mut chest_input, &mut log);
    Ok(match decision {
        chest_hunt::ChestDecision::None => tr::encode_chest_none(),
        chest_hunt::ChestDecision::Pick { chest, option, why } => {
            tr::encode_chest_pick(&chest, option, &why)
        }
        chest_hunt::ChestDecision::Walk { chest, to, why } => {
            tr::encode_chest_walk(&chest, to, &why)
        }
    })
}

/// The runner's real-walk descriptor: record the nested `paths.walk` callback (which the admitted RoomPathService
/// executes) and return the source `WalkAnswer.dist` or null.
fn walked(
    service: &mut RoomPathService,
    trace: &tr::TraceHandle,
    cfg: &str,
    self_data: &SVal,
    chest_data: &SVal,
    from: Vec2,
    to: Vec2,
    denied: &dyn Fn(Vec2, Vec2) -> bool,
) -> Option<f64> {
    let slot: Rc<RefCell<Option<f64>>> = Rc::new(RefCell::new(None));
    {
        let slot = slot.clone();
        tr::record_callback_with(
            trace,
            cfg,
            "paths.walk",
            &[self_data.clone(), chest_data.clone()],
            || {
                if denied(from, to) {
                    return tr::null();
                }
                match service.walk(from, to) {
                    None => tr::null(),
                    Some(answer) => {
                        *slot.borrow_mut() = Some(answer.dist);
                        tr::encode_walk_answer(&answer)
                    }
                }
            },
        );
    }
    let walked_distance = *slot.borrow();
    walked_distance
}

// ------------------------------------------------------------------------------------------------------------- tests

#[test]
fn frozen_private_modules_source_replay() {
    let (cases, operations, expected_operations, failures, filtered) = replay();
    eprintln!(
        "PARITY_TOTAL bot-private-modules : {cases} cases / {operations} ops (corpus {expected_operations}) / {} failures",
        failures.len()
    );
    if !filtered {
        assert_eq!(cases, CASES, "case count");
        assert_eq!(operations, OPERATIONS, "operation count");
    } else {
        assert!(cases > 0, "the RH_MODULES_SUITES filter selected no case");
    }
    assert!(
        failures.is_empty(),
        "frozen modules replay failed {} checks; first:\n{}",
        failures.len(),
        failures
            .iter()
            .take(60)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
