//! Private Brain module host: the actual shared module objects, the caller-owned ordered registry and the per-Brain
//! guarded wrapper boundary (P-BOT-BRAIN-NATIVE-1).
//!
//! Source `createBrain` keeps the caller's module **objects** (shared singleton allocations, original order, duplicates
//! preserved) and mints one wrapper per object per Brain: `{id, enabled, ...(present hook)}`. A wrapper's hook catches a
//! represented source throw, logs it and moves the id into that Brain's fault set; only a later `enabled` check consults
//! the fault marker (an already-selected wrapper still runs later in the same tick). The wrapper identity, the original
//! object identity and the per-Brain `bcfg` identity stay distinct.
//!
//! This host owns the actual builtin allocations and the caller registry; the Brain never recreates a builtin per hook,
//! uses an id as object identity, sorts/deduplicates an explicit list or duplicates a module FSM.

use crate::bots::temporal_percept::modules::types::{
    CfgToken, Goal, GoalDecision, Intent, ModuleContext, ModuleId, ModuleOutput, SourceModule,
};
use crate::bots::temporal_percept::modules::{
    ChestsModule, HazardsModule, PlanningModule, Registry, WishesModule,
};
use crate::bots::temporal_percept::strategy::types::GoalStatus;
use crate::bots::view::Features;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// One represented source hook failure (the frozen witness's declared custom-module throw): the wrapper marks the id
/// faulted, logs with the source wording and applies the exact source fallback. It is never a native invariant panic.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SourceHookFault {
    pub(crate) message: String,
}

impl SourceHookFault {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// One module `intents` result: the typed composition list plus an optional source-shaped trace override for declared
/// caller-rule intents whose literal (e.g. a negative priority) has no typed representation. Production builtins leave the
/// override `None` (their typed intents are already the source values).
pub(crate) struct HookIntents {
    pub(crate) intents: Vec<Intent>,
    pub(crate) trace: Option<super::trace::BVal>,
}

impl HookIntents {
    pub(crate) fn typed(intents: Vec<Intent>) -> Self {
        Self {
            intents,
            trace: None,
        }
    }
}

/// One module `act` result: the typed output plus an optional source-shaped trace override for the declared output's
/// intents. Production builtins leave it `None`.
pub(crate) struct HookOutput {
    pub(crate) output: ModuleOutput,
    pub(crate) trace: Option<super::trace::BVal>,
}

impl HookOutput {
    pub(crate) fn typed(output: ModuleOutput) -> Self {
        Self {
            output,
            trace: None,
        }
    }
}

/// A fallible source module-object call boundary: the actual module object executes and either returns its value or
/// reports a represented source throw. Builtin objects are inherently infallible (`Ok`); the frozen witness's declared
/// custom-module throw rules and the neutral observer use `Err` without panicking through a lock.
pub(crate) trait BrainModuleCell: Send {
    fn id(&self) -> &str;
    /// The source object's own function keys in declaration order (the wrapper's hook-presence mask).
    fn hooks(&self) -> &'static [&'static str];
    fn enabled(&mut self, features: &Features) -> Result<bool, SourceHookFault>;
    fn observe(&mut self, ctx: &mut ModuleContext<'_>) -> Result<(), SourceHookFault> {
        let _ = ctx;
        Ok(())
    }
    fn goals(&mut self, ctx: &mut ModuleContext<'_>) -> Result<Vec<GoalDecision>, SourceHookFault> {
        let _ = ctx;
        Ok(Vec::new())
    }
    fn intents(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
    ) -> Result<HookIntents, SourceHookFault> {
        let _ = (ctx, goal);
        Ok(HookIntents::typed(Vec::new()))
    }
    fn adjust<'a>(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
        intents: &'a [Intent],
    ) -> Result<std::borrow::Cow<'a, [Intent]>, SourceHookFault> {
        let _ = (ctx, goal);
        Ok(std::borrow::Cow::Borrowed(intents))
    }
    fn act(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
    ) -> Result<HookOutput, SourceHookFault> {
        let _ = (ctx, goal);
        Ok(HookOutput::typed(ModuleOutput::new(
            Vec::new(),
            GoalStatus::failed("missing module act"),
            false,
        )))
    }
}

/// The three kinds of caller module object the Brain wrapper set can hold. `Observer` is the frozen histories' neutral
/// observer: a test-only caller extension whose `observe` the composition special-cases for the trace (its `enabled` is
/// an inert true), not a production provider. `Builtin` are the four actual shared allocations; `Custom` are the
/// caller's finite declared extension objects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ModuleKind {
    Builtin,
    Custom,
    Observer,
}

/// One actual source module object a caller binds into a Brain config: the original identity survives wrapper creation.
#[derive(Clone)]
pub(crate) struct ModuleHandle {
    /// The declared source module object id (source `m.id`; the guard fault set and module-goal dispatch key).
    pub(crate) id: String,
    /// The caller's list/env key for this object (source `cfg.modules` slot token, e.g. the extension handle "x"). The
    /// module trace row records both and its per-(actor,handle,hook) index counter uses this caller key.
    pub(crate) handle: String,
    pub(crate) hooks: Vec<&'static str>,
    pub(crate) kind: ModuleKind,
    pub(crate) cell: Arc<Mutex<Box<dyn BrainModuleCell>>>,
}

impl ModuleHandle {
    /// Wrap one actual caller module object (builtin or caller extension).
    pub(crate) fn new(kind: ModuleKind, cell: Arc<Mutex<Box<dyn BrainModuleCell>>>) -> Self {
        let guard = cell.lock().unwrap_or_else(|poison| poison.into_inner());
        let id = guard.id().to_owned();
        let hooks = guard.hooks().to_vec();
        drop(guard);
        Self {
            handle: id.clone(),
            id,
            hooks,
            kind,
            cell,
        }
    }

    /// Wrap one caller extension object whose caller list/env key differs from its declared module id (source
    /// `objects[handle]` vs `m.id`): the trace row carries both; the fault set/goal dispatch keep the declared id.
    pub(crate) fn caller(caller_handle: &str, cell: Arc<Mutex<Box<dyn BrainModuleCell>>>) -> Self {
        let mut wrapped = Self::new(ModuleKind::Custom, cell);
        wrapped.handle = caller_handle.to_string();
        wrapped
    }

    /// The frozen neutral observer object: source `{id:"$observer", enabled: () => true, observe}`.
    pub(crate) fn observer() -> Self {
        Self::new(
            ModuleKind::Observer,
            Arc::new(Mutex::new(Box::new(ObserverCell))),
        )
    }

    pub(crate) fn has_hook(&self, hook: &str) -> bool {
        self.hooks.contains(&hook)
    }

    /// Short module-local mutable borrow for exactly one source hook call. The caller must drop the guard before entering
    /// another module, Strategy, logger or guarded hook.
    pub(crate) fn lock(&self) -> MutexGuard<'_, Box<dyn BrainModuleCell>> {
        self.cell
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

/// Source `{ id: "$observer", enabled: () => true, observe }` (the frozen histories' caller-only observer).
struct ObserverCell;

impl BrainModuleCell for ObserverCell {
    fn id(&self) -> &str {
        "$observer"
    }
    fn hooks(&self) -> &'static [&'static str] {
        &["enabled", "observe"]
    }
    fn enabled(&mut self, _features: &Features) -> Result<bool, SourceHookFault> {
        Ok(true)
    }
    fn observe(&mut self, _ctx: &mut ModuleContext<'_>) -> Result<(), SourceHookFault> {
        Ok(())
    }
}

/// One actual builtin engine allocation. The four concrete structs are the admitted engines; the per-Brain wrapper set
/// clones only the `Arc` handle, never the module.
enum BuiltinCell {
    Wishes(WishesModule),
    Planning(PlanningModule),
    Chests(ChestsModule),
    Hazards(HazardsModule),
}

/// The delegating cell for one actual builtin allocation: each hook borrows the module-local lock, forwards to the
/// admitted `SourceModule` call and releases the guard before returning. All four engines are source-exact and
/// infallible.
struct BuiltinModule {
    cell: Mutex<BuiltinCell>,
}

impl BuiltinModule {
    fn new(id: ModuleId) -> Self {
        Self {
            cell: Mutex::new(match id {
                ModuleId::Wishes => BuiltinCell::Wishes(WishesModule::new()),
                ModuleId::Planning => BuiltinCell::Planning(PlanningModule::default()),
                ModuleId::Chests => BuiltinCell::Chests(ChestsModule::default()),
                ModuleId::Hazards => BuiltinCell::Hazards(HazardsModule::default()),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, BuiltinCell> {
        self.cell
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

macro_rules! with_builtin {
    ($cell:expr, $module:ident => $body:expr) => {
        match $cell {
            BuiltinCell::Wishes($module) => $body,
            BuiltinCell::Planning($module) => $body,
            BuiltinCell::Chests($module) => $body,
            BuiltinCell::Hazards($module) => $body,
        }
    };
}

impl BrainModuleCell for BuiltinModule {
    fn id(&self) -> &str {
        match &*self.lock() {
            BuiltinCell::Wishes(_) => ModuleId::Wishes.as_str(),
            BuiltinCell::Planning(_) => ModuleId::Planning.as_str(),
            BuiltinCell::Chests(_) => ModuleId::Chests.as_str(),
            BuiltinCell::Hazards(_) => ModuleId::Hazards.as_str(),
        }
    }
    fn hooks(&self) -> &'static [&'static str] {
        match &*self.lock() {
            BuiltinCell::Wishes(_) => ModuleId::Wishes.hooks(),
            BuiltinCell::Planning(_) => ModuleId::Planning.hooks(),
            BuiltinCell::Chests(_) => ModuleId::Chests.hooks(),
            BuiltinCell::Hazards(_) => ModuleId::Hazards.hooks(),
        }
    }
    fn enabled(&mut self, features: &Features) -> Result<bool, SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(with_builtin!(cell, module => SourceModule::enabled(module, features)))
    }
    fn observe(&mut self, ctx: &mut ModuleContext<'_>) -> Result<(), SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        with_builtin!(cell, module => SourceModule::observe(module, ctx));
        Ok(())
    }
    fn goals(&mut self, ctx: &mut ModuleContext<'_>) -> Result<Vec<GoalDecision>, SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(with_builtin!(cell, module => SourceModule::goals(module, ctx)))
    }
    fn intents(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
    ) -> Result<HookIntents, SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(HookIntents::typed(
            with_builtin!(cell, module => SourceModule::intents(module, ctx, goal)),
        ))
    }
    fn adjust<'a>(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
        intents: &'a [Intent],
    ) -> Result<std::borrow::Cow<'a, [Intent]>, SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(with_builtin!(cell, module => SourceModule::adjust(module, ctx, goal, intents)))
    }
    fn act(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        goal: &Goal,
    ) -> Result<HookOutput, SourceHookFault> {
        let cell = self
            .cell
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(HookOutput::typed(
            with_builtin!(cell, module => SourceModule::act(module, ctx, goal)),
        ))
    }
}

/// The caller-owned module host: the four actual builtin allocations plus the ordered registry the caller selects
/// enabled modules from. The host is shared by every Brain in a room and never reclaims source WeakMap keys (a later
/// interface gate); `end` does not reset module state.
pub(crate) struct ModuleHost {
    pub(crate) wishes: ModuleHandle,
    pub(crate) planning: ModuleHandle,
    pub(crate) chests: ModuleHandle,
    pub(crate) hazards: ModuleHandle,
    pub(crate) registry: Registry,
}

impl Default for ModuleHost {
    fn default() -> Self {
        Self::new()
    }
}

impl ModuleHost {
    pub(crate) fn new() -> Self {
        let builtin = |id: ModuleId| {
            ModuleHandle::new(
                ModuleKind::Builtin,
                Arc::new(Mutex::new(Box::new(BuiltinModule::new(id)))),
            )
        };
        Self {
            wishes: builtin(ModuleId::Wishes),
            planning: builtin(ModuleId::Planning),
            chests: builtin(ModuleId::Chests),
            hazards: builtin(ModuleId::Hazards),
            registry: Registry::with_defaults(),
        }
    }

    pub(crate) fn builtin(&self, id: ModuleId) -> ModuleHandle {
        match id {
            ModuleId::Wishes => self.wishes.clone(),
            ModuleId::Planning => self.planning.clone(),
            ModuleId::Chests => self.chests.clone(),
            ModuleId::Hazards => self.hazards.clone(),
        }
    }

    /// The source `enabledModules(features)` list as actual object handles (caller order preserved; a caller may prepend
    /// its own object such as the neutral observer).
    pub(crate) fn enabled_handles(&self, features: &Features) -> Vec<ModuleHandle> {
        let mut out = Vec::new();
        for module in self.registry.enabled(features) {
            if let Some(id) = module.builtin {
                out.push(self.builtin(id));
            }
        }
        out
    }
}

/// Allocate a fresh module per-cfg state token for one Brain's guarded list. Source WeakMap identity semantics: a
/// nonempty guarded list is a new cfg object so it gets a fresh token; a truly empty list keeps the original cfg token.
pub(crate) fn new_bcfg_token() -> CfgToken {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    CfgToken(NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Source `guardModules` fallback for a faulted `act`: the exact source literal `{state:"failed", why:"module <id> failed"}`.
pub(crate) fn guard_act_fallback(id: &str) -> ModuleOutput {
    ModuleOutput::new(
        Vec::new(),
        GoalStatus::failed(format!("module {id} failed")),
        false,
    )
}

/// The source guard log line: `module <id>: <what> threw (<message>); switched off`.
pub(crate) fn guard_log_message(id: &str, what: &str, fault: &SourceHookFault) -> String {
    format!(
        "module {id}: {what} threw ({}); switched off",
        fault.message
    )
}
