//! Private Brain native replay harness (P-BOT-BRAIN-NATIVE-1): the frozen source histories replayed over the actual
//! native composition and compared field-for-field with the released `rh-bot-private-brain-source/1` oracle.
//!
//! The corpus (`parity/policy/bot-private-brain/source.json`) is a **declared method witness**, never an input source:
//! [`super::source_input`] strictly converts every declared fact (percept/config/module/env/operation) into private
//! typed values and retains every frozen expectation only as a lossless [`BVal`] comparison value. This module owns the
//! caller half of the source `runner.mts`: the caller path service/budget handles, the actual module host and the declared
//! caller-module cells, per-case Brain creation/recreation, the 855-operation loop and the per-operation snapshots.
//!
//! The frozen expected rows are read exactly once, at comparison time (and mutated only as in-memory copies by the
//! separate control group); they are never installed as Brain/component state and never fed back as inputs. The harness
//! exposes `pub(crate)` replay rows so the reached-assertion/control tests can assert over native *actual* values.
//!
//! Every operation transcript is compared as one exact global ordered sequence: event count, event order and every row
//! value (the Root-granted test-only draw observer bridge in `crate::bots::random` records the Humanizer's motor/lapse
//! draws at their real draw sites, so the rng rows are exact in sequence as well). Row values use the frozen source
//! `assert.deepEqual` comparator policy: a plain object's own-key order is not observable, while keys/values, `Map`
//! insertion order, array/`Set`/`U8` order and the `sequence` field stay exact. The one declared consequence is recorded
//! explicitly in [`ReplayedCase::limitations`] ([`DECLARED_OBJECT_ORDER_LIMITATION`]): the admitted `memory::MobMemory`
//! has no creation-path bit, so the frozen memory record's dot-first vs visible-first `name`/`type` insertion order is
//! not representable natively; it is compared with the source's own deepEqual policy and never silently reordered.

#![allow(clippy::too_many_lines)]

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};

use rh_sim::mapgen::certify::source_hypot as js_hypot;
use rh_sim::{TileMap, Vec2};

use super::super::modules::types::{
    CfgToken, Goal, GoalDecision, GoalStatus, Intent, ModuleContext, ModuleId, ModuleOutput,
};
use super::super::strategy::types::LearnedBias;
use super::config::{self, BrainConfig, BrainError, CallerServices, RoomFrame, RunSummary};
use super::host::{
    BrainModuleCell, HookIntents, HookOutput, ModuleHandle, ModuleHost, SourceHookFault,
};
use super::source_input::{
    self, AdjustKind, CallerModuleDecl, Case, ExpectedBrain, ExpectedOp, ExpectedService,
    ModuleRule, OpMethod, PathDescriptor, Source,
};
use super::trace::{self, BVal, IdentityKey, Recorder};
use crate::bots::paths::{PathBudget, PathStats, RoomPathService, WalkAnswer};
use crate::bots::types::{PersonaParams, TierParams};
use crate::bots::view::Features;

/// The one frozen history whose declared path service is the admitted argument-sensitive empty-route test: the actual
/// source JavaScript `TypeError` (and its exact message) is what the corpus records for that throw.
const EMPTY_ROUTE_CASE: &str = "core-empty-route-test";
const EMPTY_ROUTE_MESSAGE: &str = "Cannot read properties of undefined (reading 'x')";

/// The caller original-cfg `CfgToken` value space. A nonempty guarded module list makes the Brain mint one fresh
/// `bcfg` token; the host's token allocator counts from 1, so the caller's original identity tokens start well above it
/// (both are opaque caller/host tokens, but `bcfg == original_cfg` is the source `bcfg === cfg` empty-list test, and the
/// two allocators must never alias). This is an opaque token, not a Brain/actor id and not an expected identity number.
const ORIGINAL_CFG_TOKEN_BASE: u64 = 1 << 40;

fn original_cfg_token(declared_ordinal: u64) -> u64 {
    ORIGINAL_CFG_TOKEN_BASE + declared_ordinal
}

/// Declared frozen-comparator policy (Lead decision, faithful source semantics): the source tool compares values with
/// `assert.deepEqual`/`deepStrictEqual`, under which plain-object **property order is not observable** (Map/Set/Array/U8
/// order and every value are still exact). The admitted `memory::MobMemory` has no creation-path bit, so the source
/// memory snapshot's dot-first vs visible-first own-key order for `name`/`type` is not representable natively; that order
/// is therefore compared with the source's own deepEqual policy, never silently reordered or normalised.
pub(crate) const DECLARED_OBJECT_ORDER_LIMITATION: &str = "declared plain-object property-order limitation (source assert.deepEqual/deepStrictEqual semantics): a plain object's own-key order is not observable, so the frozen memory record's dot-first vs visible-first name/type insertion order is not representable by the admitted MobMemory; keys/values, Map id order, arrays and sequence are compared exactly";

fn record_limitation(limitations: &mut Vec<String>, limitation: &str) {
    if !limitations.iter().any(|known| known == limitation) {
        limitations.push(limitation.to_string());
    }
}

/// The source runner's global `active` handle: its `call()`/observer wrappers read it for actor names. The Brain's own
/// `trace_actor` is fixed per instance; this cell is the caller-side `services.log` actor.
type ActiveActor = Arc<Mutex<String>>;

fn current_actor(actor: &ActiveActor) -> String {
    actor
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
}

fn set_actor(actor: &ActiveActor, value: &str) {
    *actor.lock().unwrap_or_else(|poison| poison.into_inner()) = value.to_string();
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen corpus load (strict, once per process) and declared setup-row accessors.

/// The strictly loaded frozen corpus, cached for the process (the file is 22 MB; the typed conversion is pure/atomic).
pub(crate) fn frozen_source() -> Result<&'static Source, String> {
    static SOURCE: OnceLock<Result<Source, String>> = OnceLock::new();
    match SOURCE.get_or_init(source_input::load) {
        Ok(source) => Ok(source),
        Err(error) => Err(error.clone()),
    }
}

fn row_field<'a>(row: &'a BVal, key: &str) -> Result<&'a BVal, String> {
    row.get(key).ok_or_else(|| {
        format!(
            "frozen setup row is missing field {key:?}: {}",
            row.display()
        )
    })
}

fn row_str<'a>(row: &'a BVal, key: &str) -> Result<&'a str, String> {
    row_field(row, key)?.as_str().ok_or_else(|| {
        format!(
            "frozen setup row field {key:?} is not a string: {}",
            row.display()
        )
    })
}

fn row_u64(row: &BVal, key: &str) -> Result<u64, String> {
    let value = row_field(row, key)?.as_num().ok_or_else(|| {
        format!(
            "frozen setup row field {key:?} is not a number: {}",
            row.display()
        )
    })?;
    if !(value.is_finite() && value >= 0. && value.fract() == 0. && value <= u32::MAX as f64) {
        return Err(format!(
            "frozen setup row field {key:?} is not a non-negative u32 number: {value:?}"
        ));
    }
    Ok(value as u64)
}

fn declaration_method(declaration: &BVal) -> String {
    declaration
        .get("method")
        .and_then(BVal::as_str)
        .unwrap_or("?")
        .to_string()
}

fn builtin_module_id(name: &str) -> Option<ModuleId> {
    ModuleId::DEFAULT_ORDER
        .iter()
        .copied()
        .find(|id| id.as_str() == name)
}

// ---------------------------------------------------------------------------------------------------------------------
// Caller half of `runner.mts`: the declared caller module cell, the actual path service wrapper, the learned table.

/// The caller's per-operation `env.modules` rule table (source runner `env`, reset to `{}` at every operation start).
type RuleTable = Arc<Mutex<BTreeMap<String, ModuleRule>>>;

/// One declared caller extension module object (`case.modules[handle]`): the frozen runner's own object behavior.
///
/// Source order per hook call: the per-(actor,handle,hook) 0-based counter is incremented, the hook body runs, and a
/// declared `throws` rule for `(hook,index)` raises `declared <handle> <hook> <index>` *after* the counter advanced (the
/// source mutates its counters then throws). The engine guard writes the trace row before this body runs and converts the
/// typed fault into the source fault/log/fallback path; the cell never touches the trace recorder.
struct CallerCell {
    decl: CallerModuleDecl,
    hooks: &'static [&'static str],
    actor: ActiveActor,
    rules: RuleTable,
    counters: BTreeMap<String, u64>,
}

impl CallerCell {
    fn new(decl: CallerModuleDecl, actor: ActiveActor, rules: RuleTable) -> Self {
        // Finite test-only fixture storage: the declared hook presence list is `&'static` at its source (the frozen
        // corpus strings) but the cell owns its slice, so leak the fixed per-case list once (same finite fixture rule
        // the tier/persona storage uses).
        let hooks: &'static [&'static str] = Box::leak(decl.hooks.clone().into_boxed_slice());
        Self {
            decl,
            hooks,
            actor,
            rules,
            counters: BTreeMap::new(),
        }
    }

    /// The source `counters[active+'|'+handle+'|'+hook']` 0-based ordinal, incremented per call and never reset.
    fn next_index(&mut self, hook: &str) -> u64 {
        let key = format!("{}|{hook}", current_actor(&self.actor));
        let counter = self.counters.entry(key).or_insert(0);
        let index = *counter;
        *counter += 1;
        index
    }

    fn throws_at(&self, hook: &str, index: u64) -> bool {
        self.decl
            .throws
            .iter()
            .any(|rule| rule.hook == hook && rule.index == index)
    }

    fn fault(&self, hook: &str, index: u64) -> SourceHookFault {
        SourceHookFault::new(format!("declared {} {hook} {index}", self.decl.handle))
    }

    /// The current per-operation env rule for this handle (`env.modules[handle]`); `None` means the case declaration.
    fn rule(&self) -> Option<ModuleRule> {
        self.rules
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .get(&self.decl.handle)
            .cloned()
    }

    fn goals_rule(&self) -> Vec<GoalDecision> {
        match self.rule() {
            Some(rule) => rule.goals.unwrap_or_default(),
            None => self.decl.goals.clone(),
        }
    }

    fn intents_rule(&self) -> Vec<source_input::CallerIntent> {
        match self.rule() {
            Some(rule) => rule.intents.unwrap_or_default(),
            None => self.decl.intents.clone(),
        }
    }

    fn adjust_rule(&self) -> Option<AdjustRuleRef> {
        let rule = match self.rule() {
            Some(rule) => rule.adjust,
            None => self.decl.adjust.clone(),
        };
        rule.map(|rule| AdjustRuleRef {
            kind: rule.kind,
            intents: rule.intents,
        })
    }

    fn output_rule(&self) -> Option<source_input::DeclaredModuleOutput> {
        match self.rule() {
            Some(rule) => rule.output,
            None => self.decl.output.clone(),
        }
    }
}

/// One declared adjust rule's data (local clone so the cell can release the rule-table lock before returning).
struct AdjustRuleRef {
    kind: AdjustKind,
    intents: Vec<source_input::CallerIntent>,
}

impl BrainModuleCell for CallerCell {
    fn id(&self) -> &str {
        &self.decl.id
    }

    fn hooks(&self) -> &'static [&'static str] {
        self.hooks
    }

    fn enabled(&mut self, _features: &Features) -> Result<bool, SourceHookFault> {
        let index = self.next_index("enabled");
        if self.throws_at("enabled", index) {
            return Err(self.fault("enabled", index));
        }
        // Source: `if (hook === 'enabled') result = desc.enabled !== false;` (the per-op env rule never changes it).
        Ok(self.decl.enabled)
    }

    fn observe(&mut self, _ctx: &mut ModuleContext<'_>) -> Result<(), SourceHookFault> {
        let index = self.next_index("observe");
        if self.throws_at("observe", index) {
            return Err(self.fault("observe", index));
        }
        Ok(())
    }

    fn goals(
        &mut self,
        _ctx: &mut ModuleContext<'_>,
    ) -> Result<Vec<GoalDecision>, SourceHookFault> {
        let index = self.next_index("goals");
        if self.throws_at("goals", index) {
            return Err(self.fault("goals", index));
        }
        Ok(self.goals_rule())
    }

    fn intents(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        _goal: &Goal,
    ) -> Result<HookIntents, SourceHookFault> {
        let index = self.next_index("intents");
        if self.throws_at("intents", index) {
            return Err(self.fault("intents", index));
        }
        let now = ctx.p.now;
        let declared = self.intents_rule();
        let mut typed = Vec::with_capacity(declared.len());
        let mut trace_rows = Vec::with_capacity(declared.len());
        for intent in &declared {
            // Source returns every declared rule intent; typed composition keeps only the representable subset and the
            // exact source-shaped result is carried as the row override.
            trace_rows.push(intent.to_trace(now));
            if let Some(typed_intent) = intent.to_typed_at(now) {
                typed.push(typed_intent);
            }
        }
        Ok(HookIntents {
            intents: typed,
            trace: Some(BVal::arr(trace_rows)),
        })
    }

    fn adjust<'a>(
        &mut self,
        _ctx: &mut ModuleContext<'_>,
        _goal: &Goal,
        intents: &'a [Intent],
    ) -> Result<Cow<'a, [Intent]>, SourceHookFault> {
        let index = self.next_index("adjust");
        if self.throws_at("adjust", index) {
            return Err(self.fault("adjust", index));
        }
        let Some(rule) = self.adjust_rule() else {
            return Ok(Cow::Borrowed(intents));
        };
        let append = match &rule.kind {
            AdjustKind::Append => true,
            AdjustKind::AppendIfWhy(why) => intents.iter().any(|intent| intent.why == *why),
        };
        if !append {
            return Ok(Cow::Borrowed(intents));
        }
        let mut out = intents.to_vec();
        for intent in &rule.intents {
            // Source appends the declared intents verbatim (no current→timed rewrite on this hook). The frozen corpus'
            // adjust rules are typed-representable; an unrepresentable append would be caught by the frozen comparison.
            if let Some(typed) = intent.to_typed() {
                out.push(typed);
            }
        }
        Ok(Cow::Owned(out))
    }

    fn act(
        &mut self,
        _ctx: &mut ModuleContext<'_>,
        _goal: &Goal,
    ) -> Result<HookOutput, SourceHookFault> {
        let index = self.next_index("act");
        if self.throws_at("act", index) {
            return Err(self.fault("act", index));
        }
        match self.output_rule() {
            Some(declared) => {
                let mut typed = Vec::with_capacity(declared.intents.len());
                let mut complete = true;
                for intent in &declared.intents {
                    match intent.to_typed() {
                        Some(intent) => typed.push(intent),
                        None => complete = false,
                    }
                }
                let output = ModuleOutput::new(typed, declared.status.clone(), declared.attacking);
                let trace = if complete {
                    None
                } else {
                    Some(declared.to_trace())
                };
                Ok(HookOutput { output, trace })
            }
            None => Ok(HookOutput::typed(ModuleOutput::new(
                Vec::new(),
                GoalStatus::running("declared extension running"),
                false,
            ))),
        }
    }
}

/// The caller's actual `RoomPathService` behind the frozen runner's wrapped `services.paths` object.
///
/// The engine's `BrainPathAdapter` records every `paths.setFrame/walk/path/los/clear/collisionMap` callback row with the
/// source argument records and the `service` extra; the Brain records `setFrame` itself. This wrapper therefore only
/// forwards to the one actual service/cache/allowance and implements the frozen runner's one admitted denial descriptor:
/// over the declared radius, `walk` answers `null`, `path` answers `[]`, `los`/`clear` answer `false`.
struct CallerPathService {
    room: RoomPathService,
    deny_radius: Option<f64>,
}

impl CallerPathService {
    fn denied(&self, from: Vec2, to: Vec2) -> bool {
        self.deny_radius
            .is_some_and(|radius| js_hypot(to.x - from.x, to.y - from.y) > radius)
    }
}

impl config::BrainPathService for CallerPathService {
    fn set_frame(&mut self, now: f64, gates_locked: bool) {
        self.room.set_frame(now, gates_locked);
    }

    fn walk(&mut self, from: Vec2, to: Vec2, budget: &mut PathBudget) -> Option<WalkAnswer> {
        if self.denied(from, to) {
            None
        } else {
            self.room.walk_with_budget(from, to, budget)
        }
    }

    fn path(&mut self, from: Vec2, to: Vec2, budget: &mut PathBudget) -> Option<Vec<Vec2>> {
        if self.denied(from, to) {
            Some(Vec::new())
        } else {
            self.room.path_with_budget(from, to, budget)
        }
    }

    fn los(&self, a: Vec2, b: Vec2) -> bool {
        if self.denied(a, b) {
            false
        } else {
            self.room.los(a, b)
        }
    }

    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        if self.denied(a, b) {
            false
        } else {
            self.room.clear(a, b)
        }
    }

    fn collision_map(&self) -> &TileMap {
        self.room.collision_map()
    }

    fn stats(&self) -> PathStats {
        self.room.stats()
    }

    fn module_paths_capable(&self) -> bool {
        true
    }
}

/// The caller's declared mutable learned-bias table (source `cfg.learned`): a pure lookup over the ordered entries; the
/// engine's `adapters::StrategyLearned` records the `learned.bias` callback rows itself, so this impl never records.
struct DeclaredLearned {
    enabled: bool,
    entries: Vec<(String, f64)>,
}

impl LearnedBias for DeclaredLearned {
    fn enabled(&self) -> bool {
        self.enabled
    }

    fn bias(&self, key: &str) -> f64 {
        self.entries
            .iter()
            .find(|(known, _)| known == key)
            .map_or(0., |(_, value)| *value)
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-case caller state.

struct BudgetRecord {
    handle: String,
    budget: PathBudget,
    per_tick: u32,
}

struct ServiceRecord {
    handle: String,
    budget: String,
    paths: config::PathHandle,
}

struct ConfigRecord {
    config_index: usize,
    tier: &'static TierParams,
    persona: &'static PersonaParams,
    map: Arc<config::BrainMap>,
    features: Features,
    module_handles: Vec<ModuleHandle>,
    original_cfg: u64,
    service_index: usize,
    service_label: String,
    log: Arc<dyn Fn(&str) + Send + Sync>,
    learned: Arc<dyn LearnedBias + Send + Sync>,
}

struct Instance {
    handle: String,
    config_index: usize,
    brain: super::Brain,
}

/// One operation's native post-state rows: Brain snapshots in instance creation order, then caller service snapshots in
/// service creation order.
type OperationSnapshot = (Vec<(String, ReplayedBrain)>, Vec<(String, BVal)>);

/// One Brain history replayed over the actual native composition.
struct CaseEngine<'s> {
    case: &'s Case,
    source: &'s Source,
    host: ModuleHost,
    recorder: Recorder,
    actor: ActiveActor,
    rules: RuleTable,
    observer: Option<ModuleHandle>,
    caller_modules: BTreeMap<String, ModuleHandle>,
    configs: Vec<Option<ConfigRecord>>,
    config_index: BTreeMap<String, usize>,
    budgets: Vec<BudgetRecord>,
    services: Vec<ServiceRecord>,
    instances: Vec<Instance>,
    summaries: BTreeMap<String, RunSummary>,
    limitations: Vec<String>,
}

impl<'s> CaseEngine<'s> {
    fn new(case: &'s Case, source: &'s Source) -> Self {
        Self {
            case,
            source,
            host: ModuleHost::new(),
            recorder: Recorder::new(),
            actor: Arc::new(Mutex::new("a".to_string())),
            rules: Arc::new(Mutex::new(BTreeMap::new())),
            observer: None,
            caller_modules: BTreeMap::new(),
            configs: (0..case.configs.len()).map(|_| None).collect(),
            config_index: case
                .configs
                .iter()
                .enumerate()
                .map(|(index, config)| (config.handle.clone(), index))
                .collect(),
            budgets: Vec::new(),
            services: Vec::new(),
            instances: Vec::new(),
            summaries: BTreeMap::new(),
            limitations: Vec::new(),
        }
    }

    fn replay(mut self) -> Result<ReplayedCase, String> {
        let case = self.case;
        self.setup()?;
        let initial_trace_actual = self.recorder.events();
        let mut rows = Vec::with_capacity(case.operations.len());
        for index in 0..case.operations.len() {
            rows.push(self.run_operation(index)?);
        }
        let limitations = std::mem::take(&mut self.limitations);
        Ok(ReplayedCase {
            case: case.clone(),
            initial_trace_actual,
            initial_trace_expected: case.initial_trace.clone(),
            rows,
            limitations,
        })
    }

    /// Replay the declared caller setup rows over the actual host/service/Brain construction.
    fn setup(&mut self) -> Result<(), String> {
        let case = self.case;
        let rows = match &case.initial_trace {
            BVal::Arr(rows) => rows.clone(),
            other => {
                return Err(format!(
                    "case {} initialTrace is not an array: {}",
                    case.id,
                    other.display()
                ))
            }
        };
        for index in 0..rows.len() {
            let row = &rows[index];
            match row_str(row, "kind")? {
                "builtin" => {}
                "caller" => match row_str(row, "name")? {
                    "createPathBudget" => self.setup_budget(row)?,
                    "createPathService" => self.setup_service(row)?,
                    "enabledModules" => self.setup_enabled_modules(&rows, index)?,
                    "createBrain" => {
                        let cfg = row_str(row, "cfg")?.to_string();
                        let handle = row_str(row, "handle")?.to_string();
                        self.setup_brain(&cfg, &handle)?;
                    }
                    other => {
                        return Err(format!(
                            "case {} setup caller row {other:?} is unsupported",
                            case.id
                        ))
                    }
                },
                other => {
                    return Err(format!(
                        "case {} setup row kind {other:?} is unsupported",
                        case.id
                    ))
                }
            }
        }
        // The setup facts and the created native caller state must line up exactly (fail before any operation runs).
        if self.instances.len() != case.brains.len()
            || self
                .instances
                .iter()
                .zip(&case.brains)
                .any(|(instance, handle)| &instance.handle != handle)
        {
            return Err(format!(
                "case {} setup created Brain handles {:?} but the frozen declaration lists {:?}",
                case.id,
                self.instances
                    .iter()
                    .map(|instance| instance.handle.as_str())
                    .collect::<Vec<_>>(),
                case.brains
            ));
        }
        for (index, config) in case.configs.iter().enumerate() {
            if self.configs[index].is_none() {
                return Err(format!(
                    "case {} declared config {} was never created by a setup createBrain row",
                    case.id, config.handle
                ));
            }
        }
        if self.services.len() != case.services.len()
            || self
                .services
                .iter()
                .zip(&case.services)
                .any(|(service, handle)| &service.handle != handle)
        {
            return Err(format!(
                "case {} setup created path service handles {:?} but the frozen declaration lists {:?}",
                case.id,
                self.services
                    .iter()
                    .map(|service| service.handle.as_str())
                    .collect::<Vec<_>>(),
                case.services
            ));
        }
        Ok(())
    }

    fn setup_budget(&mut self, row: &BVal) -> Result<(), String> {
        let handle = row_str(row, "handle")?.to_string();
        let per_tick = row_u64(row, "perTick")? as u32;
        if self.budgets.iter().any(|budget| budget.handle == handle) {
            return Err(format!(
                "case {} setup declares path budget {handle} twice",
                self.case.id
            ));
        }
        self.budgets.push(BudgetRecord {
            handle: handle.clone(),
            budget: PathBudget::new(per_tick),
            per_tick,
        });
        trace::caller_path_budget(&self.recorder, &handle, u64::from(per_tick));
        Ok(())
    }

    fn budget_record(&self, handle: &str) -> Result<&BudgetRecord, String> {
        self.budgets
            .iter()
            .find(|budget| budget.handle == handle)
            .ok_or_else(|| {
                format!(
                    "case {} setup references undeclared path budget {handle}",
                    self.case.id
                )
            })
    }

    fn setup_service(&mut self, row: &BVal) -> Result<(), String> {
        let handle = row_str(row, "handle")?.to_string();
        let budget = row_str(row, "budget")?.to_string();
        let map_label = row_str(row, "map")?.to_string();
        let per_tick = self.budget_record(&budget)?.per_tick;
        let source = self.source;
        let fixture = source.map(&map_label)?;
        let service = CallerPathService {
            room: RoomPathService::new(&fixture.open, PathBudget::new(per_tick)),
            deny_radius: self.deny_radius(&handle)?,
        };
        let paths: config::PathHandle = Arc::new(Mutex::new(Box::new(service)));
        // Source `pathHandles[serviceHandle] = {paths, budget}`: a repeated handle keeps its original object insertion
        // position (a JS object assignment) while pointing at the newly constructed caller service.
        if let Some(existing) = self
            .services
            .iter_mut()
            .find(|service| service.handle == handle)
        {
            existing.budget = budget.clone();
            existing.paths = paths;
        } else {
            self.services.push(ServiceRecord {
                handle: handle.clone(),
                budget: budget.clone(),
                paths,
            });
        }
        trace::caller_path_service(&self.recorder, &handle, &budget, &map_label);
        Ok(())
    }

    /// The one admitted frozen path-denial descriptor (`config.path`), which every config bound to that service agrees on.
    fn deny_radius(&self, service: &str) -> Result<Option<f64>, String> {
        let mut radius: Option<f64> = None;
        for config in &self.case.configs {
            if config.resolved.service != service {
                continue;
            }
            let Some(PathDescriptor::TacticsEmptyRouteTest { radius: declared }) = &config.path
            else {
                continue;
            };
            match radius {
                Some(known) if known != *declared => {
                    return Err(format!(
                        "case {} path service {service} is bound by configs with different declared denial radii",
                        self.case.id
                    ))
                }
                Some(_) => {}
                None => radius = Some(*declared),
            }
        }
        Ok(radius)
    }

    fn setup_enabled_modules(&mut self, rows: &[BVal], row_index: usize) -> Result<(), String> {
        let case = self.case;
        let next = rows.get(row_index + 1).ok_or_else(|| {
            format!(
                "case {} enabledModules setup row is not followed by a createBrain row",
                case.id
            )
        })?;
        if row_str(next, "kind")? != "caller" || row_str(next, "name")? != "createBrain" {
            return Err(format!(
                "case {} enabledModules setup row is not followed by a createBrain row",
                case.id
            ));
        }
        let cfg_handle = row_str(next, "cfg")?;
        let brain_handle = row_str(next, "handle")?;
        let config_index = *self.config_index.get(cfg_handle).ok_or_else(|| {
            format!(
                "case {} setup createBrain references undeclared config {cfg_handle}",
                case.id
            )
        })?;
        let features = case.configs[config_index].resolved.features.clone();

        // Source `registry.enabledModules(features)` calls every registered module's own `enabled(features)`; the
        // instrumented actual builtin objects record those rows in registration order (no context on `enabled`). The
        // admitted registry filters with the same static gates, so replay the actual cells through the engine's own
        // builtin guard row helper (a fresh setup fault set: no Brain guard exists yet).
        let log: Arc<dyn Fn(&str) + Send + Sync> = Arc::new(|_| {});
        let percept = BVal::Undefined;
        let faults: RefCell<BTreeSet<String>> = RefCell::new(BTreeSet::new());
        for id in ModuleId::DEFAULT_ORDER {
            let handle = self.host.builtin(id);
            let hook_trace = super::HookTrace {
                recorder: Some(&self.recorder),
                actor: Some(brain_handle),
                cfg_identity: IdentityKey::OriginalCfg(0),
                original_cfg: false,
                rng_identity: IdentityKey::Rng(0),
                knowledge_identity: IdentityKey::Knowledge(0),
                engaged: false,
                percept_raw: &percept,
                now: 0.,
                log: &*log,
            };
            super::guard_enabled(&handle, &faults, &features, &hook_trace);
        }

        // Source caller row: `[objects.observer, ...registry.enabledModules(features)]` mapped back to handle names.
        let enabled = self.host.registry.enabled(&features);
        let mut names: Vec<&str> = Vec::with_capacity(enabled.len() + 1);
        names.push("observer");
        for module in &enabled {
            names.push(module.id.as_str());
        }
        trace::caller_enabled_modules(&self.recorder, &features, &names);
        Ok(())
    }

    fn setup_brain(&mut self, cfg_handle: &str, brain_handle: &str) -> Result<(), String> {
        let case = self.case;
        let config_index = *self.config_index.get(cfg_handle).ok_or_else(|| {
            format!(
                "case {} setup createBrain references undeclared config {cfg_handle}",
                case.id
            )
        })?;
        if self.configs[config_index].is_none() {
            self.create_config(config_index)?;
            // Source `create()` publishes the caller setup facts, then the runner assigns `identity(cfg)` before
            // `identity(each module object)` (in list order) and only then emits the createBrain row. The declared
            // ordinals are the source identity numbers and double as the per-case object tokens: assigned here in the
            // source order they come back out as the same numbers, so every later lazy bcfg/rng/knowledge/wrapper
            // identity matches the frozen trace.
            let config = &case.configs[config_index];
            if config.module_object_identities.len() != config.resolved.module_handles.len() {
                return Err(format!(
                    "case {} config {cfg_handle} declares {} module identities for {} module handles",
                    case.id,
                    config.module_object_identities.len(),
                    config.resolved.module_handles.len()
                ));
            }
            let assigned_cfg =
                self.recorder
                    .identity(IdentityKey::OriginalCfg(original_cfg_token(
                        config.original_cfg_identity,
                    )));
            if assigned_cfg != config.original_cfg_identity {
                return Err(format!(
                    "case {} config {cfg_handle} original cfg identity expected {} actual {assigned_cfg} (the frozen source setup order is not reproduced)",
                    case.id, config.original_cfg_identity
                ));
            }
            for (slot, expected) in config.module_object_identities.iter().enumerate() {
                let assigned = self
                    .recorder
                    .identity(IdentityKey::OriginalModule(*expected));
                if assigned != *expected {
                    return Err(format!(
                        "case {} config {cfg_handle} module slot {slot} identity expected {expected} actual {assigned} (the frozen source setup order is not reproduced)",
                        case.id
                    ));
                }
            }
        }
        trace::caller_create_brain(&self.recorder, cfg_handle, brain_handle);
        let brain_config = self.brain_config(config_index, brain_handle)?;
        let brain = super::Brain::new(brain_config).map_err(|error| {
            format!(
                "case {} createBrain {brain_handle} native composition refused: {error:?}",
                case.id
            )
        })?;
        self.instances.push(Instance {
            handle: brain_handle.to_string(),
            config_index,
            brain,
        });
        Ok(())
    }

    fn create_config(&mut self, config_index: usize) -> Result<(), String> {
        let resolved = self.case.configs[config_index].resolved.clone();
        let original_cfg = self.case.configs[config_index].original_cfg_identity;
        let mut module_handles = Vec::with_capacity(resolved.module_handles.len());
        for name in &resolved.module_handles {
            module_handles.push(self.resolve_module_handle(name)?);
        }
        let source = self.source;
        let map = Arc::new(source.map(&resolved.map)?.brain_map()?);
        // Root-approved finite test-only fixture storage: the declared full profiles are borrowed unchanged by the
        // Brain/Memory/Humanizer (never replaced by a `TierParams::by_id` canonical lookup).
        let tier: &'static TierParams = Box::leak(Box::new(resolved.tier));
        let persona: &'static PersonaParams = Box::leak(Box::new(resolved.persona));
        let service_index = self
            .services
            .iter()
            .position(|service| service.handle == resolved.service)
            .ok_or_else(|| {
                format!(
                    "case {} config {} resolved service {} was never created by the caller",
                    self.case.id, resolved.id, resolved.service
                )
            })?;
        let recorder = self.recorder.clone();
        let actor = Arc::clone(&self.actor);
        let log: Arc<dyn Fn(&str) + Send + Sync> = Arc::new(move |message: &str| {
            // Source `services.log(s)`: the runner's callback row records the current `active` actor and undefined result.
            trace::record_callback(
                &recorder,
                &current_actor(&actor),
                "services.log",
                vec![BVal::text(message)],
                BVal::Undefined,
            );
        });
        let learned: Arc<dyn LearnedBias + Send + Sync> = Arc::new(DeclaredLearned {
            enabled: resolved.learned.enabled,
            entries: resolved.learned.entries.clone(),
        });
        self.configs[config_index] = Some(ConfigRecord {
            config_index,
            tier,
            persona,
            map,
            features: resolved.features,
            module_handles,
            original_cfg: original_cfg_token(original_cfg),
            service_index,
            service_label: resolved.service,
            log,
            learned,
        });
        Ok(())
    }

    fn resolve_module_handle(&mut self, name: &str) -> Result<ModuleHandle, String> {
        if name == "observer" {
            if self.observer.is_none() {
                self.observer = Some(ModuleHandle::observer());
            }
            return self.observer.clone().ok_or_else(|| {
                format!("case {} observer module handle disappeared", self.case.id)
            });
        }
        if let Some(id) = builtin_module_id(name) {
            return Ok(self.host.builtin(id));
        }
        if let Some(handle) = self.caller_modules.get(name) {
            return Ok(handle.clone());
        }
        let decl = self
            .case
            .modules
            .iter()
            .find(|module| module.handle == name)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "case {} config module handle {name:?} is neither the observer, a builtin nor a declared caller module",
                    self.case.id
                )
            })?;
        let cell = CallerCell::new(decl, Arc::clone(&self.actor), Arc::clone(&self.rules));
        let handle = ModuleHandle::caller(
            name,
            Arc::new(Mutex::new(Box::new(cell) as Box<dyn BrainModuleCell>)),
        );
        self.caller_modules.insert(name.to_string(), handle.clone());
        Ok(handle)
    }

    fn brain_config(&self, config_index: usize, brain_handle: &str) -> Result<BrainConfig, String> {
        let case = self.case;
        let record = self.configs[config_index].as_ref().ok_or_else(|| {
            format!(
                "case {} createBrain {brain_handle} references an uncreated config",
                case.id
            )
        })?;
        let resolved = &case.configs[config_index].resolved;
        Ok(BrainConfig {
            id: resolved.id.clone(),
            name: resolved.name.clone(),
            seed: resolved.seed,
            tier: record.tier,
            persona: record.persona,
            map: Arc::clone(&record.map),
            features: record.features.clone(),
            modules: record.module_handles.clone(),
            services: CallerServices {
                paths: Arc::clone(&self.services[record.service_index].paths),
                log: Arc::clone(&record.log),
                learned: Arc::clone(&record.learned),
            },
            original_cfg: CfgToken(record.original_cfg),
            service_label: record.service_label.clone(),
            trace_actor: Some(brain_handle.to_string()),
            recorder: Some(self.recorder.clone()),
            force_missing_module_paths: false,
        })
    }

    fn instance_index(&self, handle: &str) -> Result<usize, String> {
        self.instances
            .iter()
            .position(|instance| instance.handle == handle)
            .ok_or_else(|| {
                format!(
                    "case {} operation targets unknown Brain handle {handle}",
                    self.case.id
                )
            })
    }

    // -----------------------------------------------------------------------------------------------------------------
    // The operation loop (source runner's chronological loop).

    fn run_operation(&mut self, index: usize) -> Result<ReplayedOp, String> {
        let case = self.case;
        let case_id = case.id.clone();
        let op = &case.operations[index];
        // Source runner: `trace = []; active = op.brain ?? 'a'; env = op.env ?? {}` before dispatching the operation.
        self.recorder.reset_events();
        set_actor(&self.actor, &op.actor);
        {
            let mut rules = self
                .rules
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            rules.clear();
            if let OpMethod::Tick { env, .. } = &op.method {
                for (handle, rule) in &env.modules {
                    rules.insert(handle.clone(), rule.clone());
                }
            }
        }
        // Source always resolves the active instance before the dispatch.
        let instance_index = self.instance_index(&op.actor)?;
        let mut result = BVal::Undefined;
        let mut error: Option<BVal> = None;
        match &op.method {
            OpMethod::Frame { budget } => {
                let slot = trace::begin_callback(
                    &self.recorder,
                    &op.actor,
                    "budget.startTick",
                    vec![BVal::text(budget)],
                    Vec::new(),
                );
                let allowance = self
                    .budgets
                    .iter_mut()
                    .find(|allowance| &allowance.handle == budget)
                    .ok_or_else(|| {
                        format!(
                            "case {case_id} op[{index}] frame references undeclared path budget {budget}"
                        )
                    })?;
                allowance.budget.start_tick();
                trace::finish_callback(&self.recorder, slot, BVal::Undefined);
            }
            OpMethod::Tick { percept, .. } => {
                let config_index = self.instances[instance_index].config_index;
                let budget_handle = case.configs[config_index].resolved.budget.clone();
                let budget_index = self
                    .budgets
                    .iter()
                    .position(|allowance| allowance.handle == budget_handle)
                    .ok_or_else(|| {
                        format!(
                            "case {case_id} op[{index}] Brain tick budget {budget_handle} is undeclared"
                        )
                    })?;
                let allowance = &mut self.budgets[budget_index].budget;
                let mut room = RoomFrame { budget: allowance };
                let instance = &mut self.instances[instance_index];
                match instance.brain.tick(percept, &mut room) {
                    Ok(commands) => result = trace::encode_released_commands(&commands),
                    Err(BrainError::Shape("tactics.emptyWorldRoute"))
                        if case.id == EMPTY_ROUTE_CASE =>
                    {
                        // The admitted labelled test service's `paths.path` empty answer reaches the real tactics
                        // empty-route access; the frozen source caught the actual JavaScript TypeError and kept going.
                        error = Some(BVal::obj([
                            ("name", BVal::text("TypeError")),
                            ("message", BVal::text(EMPTY_ROUTE_MESSAGE)),
                        ]));
                    }
                    Err(other) => {
                        return Err(format!(
                            "case {case_id} op[{index}] native Brain::tick failed: {other:?}"
                        ))
                    }
                }
            }
            OpMethod::Stats => {
                result = self.instances[instance_index].brain.stats_snapshot();
            }
            OpMethod::Goal => {
                result = self.instances[instance_index].brain.goal_snapshot();
            }
            OpMethod::End { input, save } => {
                let summary = self.instances[instance_index].brain.end(input.as_ref());
                result = trace::encode_run_summary(&summary);
                self.summaries
                    .insert(save.clone().unwrap_or_else(|| "last".to_string()), summary);
            }
            OpMethod::SavedSummary { key } => {
                result = self
                    .summaries
                    .get(key)
                    .map_or(BVal::Undefined, trace::encode_run_summary);
            }
            OpMethod::Recreate { cfg, brain } => {
                // Source `delete live[active]; create(op.cfg, active)`: the new actual Brain starts a fresh guarded
                // bcfg/wrapper set/rng tuple/memory while the original cfg identity and caller service/cache stay.
                self.recorder.replace_instance(&op.actor);
                let config_index = *self.config_index.get(cfg).ok_or_else(|| {
                    format!(
                        "case {case_id} op[{index}] recreate references undeclared config {cfg}"
                    )
                })?;
                if self.configs[config_index].is_none() {
                    return Err(format!(
                        "case {case_id} op[{index}] recreate references config {cfg} that was never created in setup"
                    ));
                }
                trace::caller_create_brain(&self.recorder, cfg, brain);
                let brain_config = self.brain_config(config_index, brain)?;
                let created = super::Brain::new(brain_config).map_err(|native| {
                    format!("case {case_id} op[{index}] recreate Brain::new failed: {native:?}")
                })?;
                self.instances[instance_index].brain = created;
            }
        }
        let (brains, services) = self.snapshot();
        let trace_value = self.recorder.events();
        let trace_mismatch = compare_transcript_exact(&op.expected.trace, &trace_value);
        let trace_exact = trace_mismatch.is_none();
        if transcript_differs_only_in_object_property_order(&op.expected.trace, &trace_value) {
            record_limitation(&mut self.limitations, DECLARED_OBJECT_ORDER_LIMITATION);
        }
        Ok(ReplayedOp {
            index,
            method: declaration_method(&op.declaration),
            declaration: op.declaration.clone(),
            result,
            error,
            brains,
            services,
            trace: trace_value,
            expected: op.expected.clone(),
            trace_exact,
            trace_mismatch,
        })
    }

    fn snapshot(&self) -> OperationSnapshot {
        let mut brains = Vec::with_capacity(self.instances.len());
        for instance in &self.instances {
            let observed = self.recorder.is_active(&instance.handle);
            let memory = observed.then(|| instance.brain.memory_snapshot());
            let counts = observed.then(|| self.recorder.counts(&instance.handle));
            brains.push((
                instance.handle.clone(),
                ReplayedBrain {
                    goal: instance.brain.goal_snapshot(),
                    stats: instance.brain.stats_snapshot(),
                    memory,
                    counts,
                },
            ));
        }
        let mut services = Vec::with_capacity(self.services.len());
        for service in &self.services {
            let stats = {
                let guard = service
                    .paths
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                guard.stats()
            };
            let left = self
                .budgets
                .iter()
                .find(|allowance| allowance.handle == service.budget)
                .map_or(0, |allowance| allowance.budget.left());
            services.push((
                service.handle.clone(),
                trace::encode_service_snapshot(&stats, &service.budget, left),
            ));
        }
        (brains, services)
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Replay rows exposed to the reached-assertion and control tests.

/// One Brain's native snapshot after an operation (source runner `snapshot()`): goal/stats always, live Memory and the
/// observer-owned runtime draw counters only when the neutral observer has activated that instance (`None` = source
/// `live[h]` undefined, encoded as `null`).
#[derive(Clone, Debug)]
pub(crate) struct ReplayedBrain {
    pub(crate) goal: BVal,
    pub(crate) stats: BVal,
    pub(crate) memory: Option<BVal>,
    pub(crate) counts: Option<[u64; 3]>,
}

/// One replayed operation: the native actual rows plus the frozen expected copy for the changed-expected controls.
#[derive(Clone, Debug)]
pub(crate) struct ReplayedOp {
    pub(crate) index: usize,
    pub(crate) method: String,
    pub(crate) declaration: BVal,
    pub(crate) result: BVal,
    pub(crate) error: Option<BVal>,
    pub(crate) brains: Vec<(String, ReplayedBrain)>,
    pub(crate) services: Vec<(String, BVal)>,
    pub(crate) trace: BVal,
    pub(crate) expected: ExpectedOp,
    /// True when the comparator matched the frozen transcript exactly: one exact global ordered transcript, with no
    /// per-lane reordering allowance. The only declared non-exact surface is [`DECLARED_OBJECT_ORDER_LIMITATION`]
    /// (plain-object property-order), reported through [`ReplayedCase::limitations`].
    pub(crate) trace_exact: bool,
    /// The first genuine transcript mismatch (empty trace compare passes are `None`).
    trace_mismatch: Option<String>,
}

/// One Brain history's native replay.
#[derive(Clone, Debug)]
pub(crate) struct ReplayedCase {
    pub(crate) case: Case,
    pub(crate) initial_trace_actual: BVal,
    pub(crate) initial_trace_expected: BVal,
    pub(crate) rows: Vec<ReplayedOp>,
    /// Declared source-API limitations observed in this history (explicitly reported, never silently reordered).
    pub(crate) limitations: Vec<String>,
}

/// Replay one frozen history by id (strict corpus load, cached for the process).
pub(crate) fn replay_case(id: &str) -> Result<ReplayedCase, String> {
    let source = frozen_source()?;
    replay_case_from(source, id)
}

/// Replay one frozen history against an already loaded strict [`Source`].
pub(crate) fn replay_case_from(source: &Source, id: &str) -> Result<ReplayedCase, String> {
    let case = source.case(id)?;
    CaseEngine::new(case, source).replay()
}

/// The 31 frozen history ids in corpus order.
pub(crate) fn case_ids() -> Result<Vec<String>, String> {
    Ok(frozen_source()?
        .cases
        .iter()
        .map(|case| case.id.clone())
        .collect())
}

/// The native actual `{stats,budget,left}` service snapshot for one caller service handle after one operation.
pub(crate) fn replayed_service(rows: &[ReplayedOp], handle: &str) -> Option<BVal> {
    rows.iter().rev().find_map(|row| {
        row.services
            .iter()
            .find(|(known, _)| known == handle)
            .map(|(_, value)| value.clone())
    })
}

/// `(operations, operations whose transcript matched the frozen transcript exactly)`: convenience ledger counts.
pub(crate) fn trace_tables(replayed: &ReplayedCase) -> (usize, usize) {
    let exact = replayed.rows.iter().filter(|row| row.trace_exact).count();
    (replayed.rows.len(), exact)
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen comparison (exact ordered values; the first raw difference with its path).

fn expected_error_value(error: &source_input::ErrorRow) -> BVal {
    BVal::obj([
        ("name", BVal::text(error.name.clone())),
        ("message", BVal::text(error.message.clone())),
    ])
}

fn compare_snapshots(
    label: &str,
    expected: &[(String, ExpectedBrain)],
    actual: &[(String, ReplayedBrain)],
    failures: &mut Vec<String>,
) {
    if expected.len() != actual.len() {
        failures.push(format!(
            "{label}: expected {} Brain snapshots actual {}",
            expected.len(),
            actual.len()
        ));
        return;
    }
    for ((expected_handle, expected_brain), (actual_handle, actual_brain)) in
        expected.iter().zip(actual)
    {
        if expected_handle != actual_handle {
            failures.push(format!(
                "{label}: Brain snapshot handle order expected {expected_handle:?} actual {actual_handle:?}"
            ));
            continue;
        }
        let path = format!("{label}.{expected_handle}");
        trace::compare_deep_equal(
            &format!("{path}.goal"),
            &expected_brain.goal,
            &actual_brain.goal,
            failures,
        );
        trace::compare_deep_equal(
            &format!("{path}.stats"),
            &expected_brain.stats,
            &actual_brain.stats,
            failures,
        );
        let expected_memory = expected_brain.memory.clone().unwrap_or(BVal::Null);
        let actual_memory = actual_brain.memory.clone().unwrap_or(BVal::Null);
        trace::compare_deep_equal(
            &format!("{path}.memory"),
            &expected_memory,
            &actual_memory,
            failures,
        );
        let expected_counts = expected_brain.counts.map_or(BVal::Null, |counts| {
            trace::encode_rng_counts(counts[0], counts[1], counts[2])
        });
        let actual_counts = actual_brain.counts.map_or(BVal::Null, |counts| {
            trace::encode_rng_counts(counts[0], counts[1], counts[2])
        });
        trace::compare_deep_equal(
            &format!("{path}.counts"),
            &expected_counts,
            &actual_counts,
            failures,
        );
    }
}

fn compare_services(
    label: &str,
    expected: &[(String, ExpectedService)],
    actual: &[(String, BVal)],
    failures: &mut Vec<String>,
) {
    if expected.len() != actual.len() {
        failures.push(format!(
            "{label}: expected {} service snapshots actual {}",
            expected.len(),
            actual.len()
        ));
        return;
    }
    for ((expected_handle, expected_service), (actual_handle, actual_service)) in
        expected.iter().zip(actual)
    {
        if expected_handle != actual_handle {
            failures.push(format!(
                "{label}: service snapshot handle order expected {expected_handle:?} actual {actual_handle:?}"
            ));
            continue;
        }
        let expected_value = BVal::obj([
            ("stats", expected_service.stats.clone()),
            ("budget", BVal::text(expected_service.budget.clone())),
            ("left", BVal::num(f64::from(expected_service.left))),
        ]);
        trace::compare_deep_equal(
            &format!("{label}.{expected_handle}"),
            &expected_value,
            actual_service,
            failures,
        );
    }
}

fn compare_operation(replayed: &ReplayedCase, op: &ReplayedOp, failures: &mut Vec<String>) {
    let case = &replayed.case;
    let label = format!("case {} op[{}] ({})", case.id, op.index, op.method);
    trace::compare_deep_equal(
        &format!("{label}.result"),
        &op.expected.result,
        &op.result,
        failures,
    );
    match (&op.expected.error, &op.error) {
        (None, None) => {}
        (Some(expected), Some(actual)) => {
            trace::compare_deep_equal(
                &format!("{label}.error"),
                &expected_error_value(expected),
                actual,
                failures,
            );
        }
        (Some(expected), None) => failures.push(format!(
            "{label}.error: expected {} actual absent",
            expected_error_value(expected).display()
        )),
        (None, Some(actual)) => failures.push(format!(
            "{label}.error: expected absent actual {}",
            actual.display()
        )),
    }
    compare_snapshots(
        &format!("{label}.brains"),
        &op.expected.brains,
        &op.brains,
        failures,
    );
    compare_services(
        &format!("{label}.services"),
        &op.expected.services,
        &op.services,
        failures,
    );
    if let Some(message) = &op.trace_mismatch {
        failures.push(format!("{label}.trace: {message}"));
    }
}

/// The complete exact frozen comparison for one replayed history: the setup trace first, then every operation's result,
/// error, Brain snapshots, service snapshots and transcript. Returns the first mismatch with its exact frozen path. Each
/// operation transcript is compared exactly as one global ordered sequence ([`compare_transcript_exact`]), including the
/// motor/lapse draws; the only non-exact surface is the declared plain-object property-order limitation
/// (`DECLARED_OBJECT_ORDER_LIMITATION`, the source `assert.deepEqual` policy), which is recorded, not reported as a mismatch.
pub(crate) fn compare_replayed_case(replayed: &ReplayedCase) -> Result<(), String> {
    let mut failures = Vec::new();
    let case = &replayed.case;
    trace::compare(
        &format!("case {} initialTrace", case.id),
        &replayed.initial_trace_expected,
        &replayed.initial_trace_actual,
        &mut failures,
    );
    for op in &replayed.rows {
        compare_operation(replayed, op, &mut failures);
        if failures.len() >= 16 {
            break;
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} native replay mismatch(es) in case {}; first: {}",
            failures.len(),
            case.id,
            failures[0]
        ))
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact transcript comparison.
//
// The Root-granted test-only draw observer bridge (crates/rh-policy/src/bots/random.rs, draw_observer) makes the actual
// Humanizer motor/lapse draws observable at their real draw sites, so every operation transcript is compared as one
// global ordered sequence: exact event count, exact order, exact values, no lane regrouping or normalisation.

/// Compare one complete operation transcript exactly as one global ordered sequence: event count, event order, every row
/// and every row value. Row values use the frozen source `assert.deepEqual` policy (a plain object's own-key order is
/// not observable; keys/values, Map id order, array element order and the `sequence` field are exact). No lane grouping,
/// regrouping or reordering is performed: the Root-granted draw observer bridge records motor/lapse draws in their real
/// global order, so every rng row is compared in sequence too.
fn compare_transcript_exact(expected: &BVal, actual: &BVal) -> Option<String> {
    let (Some(expected_rows), Some(actual_rows)) = (expected.as_arr(), actual.as_arr()) else {
        return Some(format!(
            "operation transcript expected {} actual {}",
            expected.display(),
            actual.display()
        ));
    };
    if expected_rows.len() != actual_rows.len() {
        return Some(format!(
            "operation transcript length expected {} actual {} (first missing/extra index {})",
            expected_rows.len(),
            actual_rows.len(),
            expected_rows.len().min(actual_rows.len())
        ));
    }
    for (sequence, (expected_row, actual_row)) in expected_rows.iter().zip(actual_rows).enumerate()
    {
        if trace::same_deep_equal(expected_row, actual_row) {
            continue;
        }
        return Some(
            trace::first_difference_deep_equal(
                expected_row,
                actual_row,
                &format!("operation trace[{sequence}]"),
            )
            .unwrap_or_else(|| format!("operation trace[{sequence}]: event differs")),
        );
    }
    None
}

/// Whether two transcripts differ ONLY in plain-object property order (the declared source `assert.deepEqual` policy):
/// every row is deep-equal, at least one row differs under the strict ordered comparator. Used only to record the
/// declared comparator limitation, never to accept a row whose keys/values/order-in-arrays differ.
fn transcript_differs_only_in_object_property_order(expected: &BVal, actual: &BVal) -> bool {
    let (Some(expected), Some(actual)) = (expected.as_arr(), actual.as_arr()) else {
        return false;
    };
    if expected.len() != actual.len() {
        return false;
    }
    expected
        .iter()
        .zip(actual)
        .any(|(expected_row, actual_row)| {
            !trace::same(expected_row, actual_row)
                && trace::same_deep_equal(expected_row, actual_row)
        })
}

// ---------------------------------------------------------------------------------------------------------------------
// Tests: the frozen corpus counts, and the complete 31-history/855-operation replay.

#[test]
fn frozen_corpus_declares_the_required_totals() {
    let source = frozen_source().expect("the frozen Brain source corpus must load strictly");
    assert_eq!(source.cases.len(), 31, "frozen histories");
    let (cases, operations) = source
        .operation_counts()
        .expect("the frozen operation count must not overflow");
    assert_eq!(
        (cases, operations),
        (31, 855),
        "frozen histories/operations"
    );
    let mut method_counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for operation in source.cases.iter().flat_map(|case| &case.operations) {
        let method = match operation.method {
            OpMethod::Frame { .. } => "frame",
            OpMethod::Tick { .. } => "tick",
            OpMethod::Stats => "stats",
            OpMethod::Goal => "goal",
            OpMethod::End { .. } => "end",
            OpMethod::SavedSummary { .. } => "savedSummary",
            OpMethod::Recreate { .. } => "recreate",
        };
        *method_counts.entry(method).or_insert(0) += 1;
    }
    assert_eq!(
        method_counts,
        BTreeMap::from([
            ("end", 8),
            ("frame", 418),
            ("goal", 1),
            ("recreate", 1),
            ("savedSummary", 1),
            ("stats", 1),
            ("tick", 425),
        ]),
        "frozen operation method counts (the replay loop must dispatch create path/frame, tick, stats, goal, end, savedSummary and recreate)"
    );
    assert_eq!(source.hand.len(), 6, "frozen direct Hand profiles");
    assert_eq!(
        source
            .hand
            .iter()
            .map(|profile| profile.operations.len())
            .sum::<usize>(),
        12,
        "frozen direct Hand operations"
    );
    assert_eq!(source.knowledge.len(), 32, "frozen Knowledge dependencies");
    assert_eq!(
        source
            .knowledge
            .iter()
            .map(|dependency| dependency.draws.len())
            .sum::<usize>(),
        2240,
        "frozen Knowledge constructor draws"
    );
    assert_eq!(
        source
            .knowledge
            .iter()
            .map(|dependency| dependency.actual_calls.len())
            .sum::<usize>(),
        111,
        "frozen Brain Knowledge call bindings"
    );
    assert_eq!(source.maps.len(), 8, "frozen source maps");
}

#[test]
fn replay_all_frozen_brain_histories() {
    let source = frozen_source().expect("the frozen Brain source corpus must load strictly");
    let mut failures: Vec<String> = Vec::new();
    let mut limitations: Vec<String> = Vec::new();
    let mut operations = 0usize;
    let mut clean_cases = 0usize;
    let mut executed: BTreeMap<&'static str, usize> = BTreeMap::new();
    for case in &source.cases {
        match replay_case_from(source, &case.id) {
            Ok(replayed) => {
                operations += replayed.rows.len();
                for row in &replayed.rows {
                    let method = match row.method.as_str() {
                        "frame" => "frame",
                        "tick" => "tick",
                        "stats" => "stats",
                        "goal" => "goal",
                        "end" => "end",
                        "savedSummary" => "savedSummary",
                        "recreate" => "recreate",
                        other => panic!("unexpected replayed operation method {other}"),
                    };
                    *executed.entry(method).or_insert(0) += 1;
                }
                limitations.extend(replayed.limitations.iter().cloned());
                if let Err(failure) = compare_replayed_case(&replayed) {
                    failures.push(failure);
                } else {
                    clean_cases += 1;
                }
            }
            Err(error) => failures.push(error),
        }
    }
    assert_eq!(
        operations, 855,
        "the native replay must execute every frozen operation"
    );
    assert_eq!(
        executed,
        BTreeMap::from([
            ("end", 8),
            ("frame", 418),
            ("goal", 1),
            ("recreate", 1),
            ("savedSummary", 1),
            ("stats", 1),
            ("tick", 425),
        ]),
        "every declared operation method must be dispatched by the replay loop"
    );
    // The one declared comparator limitation is the source deepEqual plain-object property-order policy: it is reported
    // explicitly and never hides a keys/values/Map-id-order/array-order/sequence difference (those are compared exactly).
    for limitation in &limitations {
        assert_eq!(
            limitation, DECLARED_OBJECT_ORDER_LIMITATION,
            "unexpected replay limitation: {limitation}"
        );
    }
    assert!(
        !limitations.is_empty(),
        "the frozen corpus contains source-created memory records whose plain-object property order is not representable; the declared deepEqual object-order limitation must be reported, not silently ignored"
    );
    assert!(
        failures.is_empty(),
        "{clean_cases}/{} frozen Brain histories replayed and compared clean; {} failed native replay (855/855 operations executed; 418 frame + 425 tick + 8 end + 1 goal + 1 stats + 1 savedSummary + 1 recreate). First mismatch: {}\nall mismatches:\n{}",
        source.cases.len(),
        failures.len(),
        failures.first().map_or("", String::as_str),
        failures.join("\n")
    );
}
