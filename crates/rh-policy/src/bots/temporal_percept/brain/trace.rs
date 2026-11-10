//! Private Brain component trace: the lossless tagged value model, the per-case identity table and the ordered
//! recorder the frozen-source component trace is compared against (P-BOT-BRAIN-NATIVE-1).
//!
//! The recorder is a private test instrumentation surface, not game state: it stores native facts observed at the
//! composition boundaries (RNG draws, path/knowledge/log/learned callbacks, module hook arguments/results, Memory
//! snapshots and object identities) so the native replay can be compared value-for-value with the frozen source
//! histories. It is `Send + Sync` and owned by the Brain graph, so the persistent Brain keeps the `Policy: Send`
//! contract; production callers construct it as `None`. No expected value, callback answer tape or frozen fixture row is
//! ever installed as Brain/component state: the recorder only ever receives values the native composition produced.

use super::super::data::MethodValue;
use super::super::memory::{
    CampMemory, ContainerMemory, ContainersWeapon, FighterMemory, Memory, MobMemory, SelfMemory,
};
use super::super::modules::types::ModuleOutput;
use super::super::strategy::types::{
    Goal, GoalDecision, GoalKind, GoalState, GoalStatus, MemoryApi,
};
use super::config::{BrainStats, ReleasedCommand, RunSummary};
use crate::bots::humanizer::HumanizerStats;
use crate::bots::paths::PathStats;
use crate::bots::types::{
    ChooseMsg, Command, Intent, IntentBody, IntentTiming, PlanMsg, Stimulus, TimedCommand,
};
use crate::bots::view::Features;
use rh_sim::Vec2;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// The lossless tagged method-value model of the frozen source witness (`rh-method-value/1`), owned and `Send`.
/// Every ordered object/array/map record keeps the source's own order; tagged numbers keep the source's -0/NaN/nonfinite
/// identity instead of normalising it.
#[derive(Clone, Debug)]
pub(crate) enum BVal {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<BVal>),
    Map(Vec<(BVal, BVal)>),
    Set(Vec<BVal>),
    U8(Vec<u8>),
    Obj(Vec<(String, BVal)>),
    Instance {
        name: String,
        entries: Vec<(String, BVal)>,
    },
    Callable,
}

impl BVal {
    pub(crate) fn obj(fields: impl IntoIterator<Item = (&'static str, BVal)>) -> Self {
        Self::Obj(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }
    pub(crate) fn arr(values: impl IntoIterator<Item = BVal>) -> Self {
        Self::Arr(values.into_iter().collect())
    }
    pub(crate) fn num(value: f64) -> Self {
        Self::Num(value)
    }
    pub(crate) fn text(value: impl Into<String>) -> Self {
        Self::Str(value.into())
    }
    pub(crate) fn flag(value: bool) -> Self {
        Self::Bool(value)
    }
    pub(crate) fn opt_text(value: Option<&str>) -> Self {
        value.map_or(Self::Null, |v| Self::Str(v.to_owned()))
    }
    pub(crate) fn opt_num(value: Option<f64>) -> Self {
        value.map_or(Self::Null, Self::Num)
    }
    pub(crate) fn get(&self, key: &str) -> Option<&BVal> {
        match self {
            BVal::Obj(fields)
            | BVal::Instance {
                entries: fields, ..
            } => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub(crate) fn as_obj(&self) -> Option<&[(String, BVal)]> {
        match self {
            BVal::Obj(fields)
            | BVal::Instance {
                entries: fields, ..
            } => Some(fields),
            _ => None,
        }
    }
    pub(crate) fn as_arr(&self) -> Option<&[BVal]> {
        match self {
            BVal::Arr(values) => Some(values),
            _ => None,
        }
    }
    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            BVal::Str(value) => Some(value),
            _ => None,
        }
    }
    pub(crate) fn as_num(&self) -> Option<f64> {
        match self {
            BVal::Num(value) => Some(*value),
            _ => None,
        }
    }
    pub(crate) fn as_bool(&self) -> Option<bool> {
        match self {
            BVal::Bool(value) => Some(*value),
            _ => None,
        }
    }
    /// Source deepEqual on decoded values: same tag/type, ordered objects/maps/arrays, binary64 by bit pattern with NaN
    /// equal to NaN (`-0` stays distinct from `0`). Never coerces a number to a string or treats null as absent.
    pub(crate) fn same(&self, other: &BVal) -> bool {
        match (self, other) {
            (BVal::Undefined, BVal::Undefined)
            | (BVal::Null, BVal::Null)
            | (BVal::Callable, BVal::Callable) => true,
            (BVal::Bool(a), BVal::Bool(b)) => a == b,
            (BVal::Num(a), BVal::Num(b)) => {
                a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
            }
            (BVal::Str(a), BVal::Str(b)) => a == b,
            (BVal::Arr(a), BVal::Arr(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.same(y))
            }
            (BVal::Map(a), BVal::Map(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|((ak, av), (bk, bv))| ak.same(bk) && av.same(bv))
            }
            (BVal::Set(a), BVal::Set(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.same(y))
            }
            (BVal::U8(a), BVal::U8(b)) => a == b,
            (BVal::Obj(a), BVal::Obj(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|((ak, av), (bk, bv))| ak == bk && av.same(bv))
            }
            (
                BVal::Instance {
                    name: an,
                    entries: ae,
                },
                BVal::Instance {
                    name: bn,
                    entries: be,
                },
            ) => {
                an == bn
                    && ae.len() == be.len()
                    && ae
                        .iter()
                        .zip(be)
                        .all(|((ak, av), (bk, bv))| ak == bk && av.same(bv))
            }
            _ => false,
        }
    }
    /// Source `JSON.stringify`/display for the first-difference receipt: compact, own-key ordered.
    pub(crate) fn display(&self) -> String {
        match self {
            BVal::Undefined => "undefined".into(),
            BVal::Null => "null".into(),
            BVal::Bool(v) => v.to_string(),
            BVal::Num(v) => {
                if v.is_nan() {
                    "NaN".into()
                } else {
                    format!("{v}")
                }
            }
            BVal::Str(v) => format!("{v:?}"),
            BVal::Arr(values) => format!(
                "[{}]",
                values
                    .iter()
                    .map(BVal::display)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            BVal::Map(entries) => format!(
                "Map({})",
                entries
                    .iter()
                    .map(|(k, v)| format!("{} => {}", k.display(), v.display()))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            BVal::Set(values) => format!(
                "Set({})",
                values
                    .iter()
                    .map(BVal::display)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            BVal::U8(values) => format!("Uint8Array[{}]", values.len()),
            BVal::Obj(fields) => format!(
                "{{{}}}",
                fields
                    .iter()
                    .map(|(k, v)| format!("{k}:{}", v.display()))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            BVal::Instance { name, entries } => format!(
                "{name}{{{}}}",
                entries
                    .iter()
                    .map(|(k, v)| format!("{k}:{}", v.display()))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            BVal::Callable => "<callable>".into(),
        }
    }
}

impl PartialEq for BVal {
    fn eq(&self, other: &Self) -> bool {
        self.same(other)
    }
}

/// `MethodValue` (the temporal-core declared record model) to the lossless trace model.
pub(crate) fn from_method_value(value: &MethodValue) -> BVal {
    match value {
        MethodValue::Undefined => BVal::Undefined,
        MethodValue::Null => BVal::Null,
        MethodValue::Bool(v) => BVal::Bool(*v),
        MethodValue::Num(v) => BVal::Num(*v),
        MethodValue::Str(v) => BVal::Str(v.clone()),
        MethodValue::Arr(rows) => BVal::Arr(rows.iter().map(from_method_value).collect()),
        MethodValue::Obj(fields) => BVal::Obj(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), from_method_value(v)))
                .collect(),
        ),
    }
}

/// The lossless trace model narrowed back to the declared `MethodValue` subset the component types retain as raw
/// callback arguments. Tagged `Map`/`Set`/`U8`/`Instance`/callable values have no declared-record representation and
/// are refused (`None`) instead of being coerced.
pub(crate) fn to_method_value(value: &BVal) -> Option<MethodValue> {
    Some(match value {
        BVal::Undefined => MethodValue::Undefined,
        BVal::Null => MethodValue::Null,
        BVal::Bool(v) => MethodValue::Bool(*v),
        BVal::Num(v) => MethodValue::Num(*v),
        BVal::Str(v) => MethodValue::Str(v.clone()),
        BVal::Arr(rows) => MethodValue::Arr(
            rows.iter()
                .map(to_method_value)
                .collect::<Option<Vec<_>>>()?,
        ),
        BVal::Obj(fields) => MethodValue::Obj(
            fields
                .iter()
                .map(|(k, v)| Some((k.clone(), to_method_value(v)?)))
                .collect::<Option<Vec<_>>>()?,
        ),
        BVal::Map(_) | BVal::Set(_) | BVal::U8(_) | BVal::Instance { .. } | BVal::Callable => {
            return None
        }
    })
}

/// One distinct source object identity the frozen runner assigns a lazily increasing number to. The Brain assigns these
/// keys from actual construction/handles (never expected identity numbers), so equal values never merge an identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum IdentityKey {
    /// The caller's original cfg object (one per distinct config declaration/handle).
    OriginalCfg(u64),
    /// One caller module object (shared across Brains that reuse the same original list).
    OriginalModule(u64),
    /// One Brain's fresh guarded `{...cfg, modules}` identity (empty module lists keep `OriginalCfg`).
    Bcfg(u64),
    /// One Brain's runtime RNG tuple identity.
    Rng(u64),
    /// One Brain's actual Knowledge object identity.
    Knowledge(u64),
    /// One Brain's guarded wrapper identity at the original list slot.
    Wrapper { brain: u64, slot: u64 },
    /// A source intent-list array identity (persistent across an adjust chain exactly as the source array is).
    IntentList(u64),
}

/// The ordered trace of one declared operation plus the per-case identity table, per-brain lane draw counters and the
/// observer activation state (the source neutral observer installs the RNG/Knowledge wrappers on its first `observe`).
#[derive(Default)]
pub(crate) struct TraceLog {
    pub(crate) events: Vec<BVal>,
    identities: BTreeMap<IdentityKey, u64>,
    next_identity: u64,
    lanes: Vec<(String, [u64; 3])>,
    active: Vec<String>,
    /// The source runner's `counters[active + '|' + handle + '|' + hook]` calls: a per-(actor, handle, hook) 0-based
    /// ordinal that persists for the whole case (it is not cleared with `events`).
    hook_indexes: BTreeMap<String, u64>,
}

/// The `Send + Sync` recorder handle the Brain/adapters/host write through. Cloning shares the one log.
#[derive(Clone, Default)]
pub(crate) struct Recorder {
    log: Arc<Mutex<TraceLog>>,
}

impl Recorder {
    pub(crate) fn new() -> Self {
        let log = TraceLog {
            next_identity: 1,
            ..TraceLog::default()
        };
        Self {
            log: Arc::new(Mutex::new(log)),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, TraceLog> {
        self.log.lock().unwrap_or_else(|poison| poison.into_inner())
    }

    /// Allocate/return the source identity number for one actual object token, assigning in first-use order exactly as
    /// the frozen runner's per-case object identity map does.
    pub(crate) fn identity(&self, key: IdentityKey) -> u64 {
        let mut log = self.lock();
        if let Some(id) = log.identities.get(&key) {
            return *id;
        }
        let id = log.next_identity;
        log.next_identity += 1;
        log.identities.insert(key, id);
        id
    }

    /// The source runner's `recreate` operation replaces the Brain object (and with it the observer-state key `ctx.rng`):
    /// the recreated Brain's observer activation and per-lane draw ordinals restart, while the case identity table, the
    /// per-(actor,handle,hook) call counters and the event log (reset separately per operation) stay.
    pub(crate) fn replace_instance(&self, actor: &str) {
        let mut log = self.lock();
        log.active.retain(|id| id != actor);
        if let Some((_, counts)) = log.lanes.iter_mut().find(|(id, _)| id == actor) {
            *counts = [0; 3];
        }
    }

    /// The source runner's per-(actor, handle, hook) 0-based call ordinal (`counters[active+'|'+handle+'|'+hook]`): it is
    /// consulted/incremented when a callback row is constructed and persists across operations, unlike `events`.
    pub(crate) fn next_hook_index(&self, actor: &str, handle: &str, hook: &str) -> u64 {
        let mut log = self.lock();
        let key = format!("{actor}|{handle}|{hook}");
        let index = log.hook_indexes.entry(key).or_insert(0);
        let value = *index;
        *index += 1;
        value
    }

    /// Append one event row with the runner's `sequence` property added last; returns its slot for nested/late fields.
    pub(crate) fn push(&self, fields: Vec<(&'static str, BVal)>) -> usize {
        let mut log = self.lock();
        let sequence = log.events.len();
        let mut row = Vec::with_capacity(fields.len() + 1);
        row.extend(fields);
        row.push(("sequence", BVal::Num(sequence as f64)));
        log.events.push(BVal::Obj(
            row.into_iter().map(|(k, v)| (k.to_owned(), v)).collect(),
        ));
        sequence
    }

    /// Set one late property on an already-pushed row (result/error/returnedInput/listIdentity/resultIdentity), keeping
    /// the source's own assignment order: every extra property is appended after `sequence`.
    pub(crate) fn finish(&self, slot: usize, key: &'static str, value: BVal) {
        let mut log = self.lock();
        if let Some(BVal::Obj(fields)) = log.events.get_mut(slot) {
            fields.push((key.to_owned(), value));
        }
    }

    /// Drop the events of the finished operation; identities, draw counters and observer activation persist for the
    /// whole case exactly as the source runner's per-case state does.
    pub(crate) fn reset_events(&self) {
        self.lock().events.clear();
    }

    /// The transcript as one tagged array (the frozen trace comparison's actual value).
    pub(crate) fn events(&self) -> BVal {
        BVal::Arr(self.lock().events.clone())
    }

    pub(crate) fn events_len(&self) -> usize {
        self.lock().events.len()
    }

    /// The neutral observer's first `observe` for a Brain installs the runtime RNG/Knowledge wrappers; only from then on
    /// are lane draws and Knowledge callbacks part of the trace (a Brain whose module list has no observer records none).
    pub(crate) fn activate(&self, brain: &str) {
        let mut log = self.lock();
        if !log.active.iter().any(|id| id == brain) {
            log.active.push(brain.to_owned());
        }
    }

    pub(crate) fn is_active(&self, brain: &str) -> bool {
        self.lock().active.iter().any(|id| id == brain)
    }

    fn lane_slot(log: &mut TraceLog, brain: &str) -> usize {
        match log.lanes.iter().position(|(id, _)| id == brain) {
            Some(index) => index,
            None => {
                log.lanes.push((brain.to_owned(), [0; 3]));
                log.lanes.len() - 1
            }
        }
    }

    /// Record one active Brain runtime draw (`decide`=0, `motor`=1, `lapse`=2) with its per-lane ordinal.
    pub(crate) fn rng(&self, brain: &str, lane: usize, value: f64) {
        let mut log = self.lock();
        if !log.active.iter().any(|id| id == brain) {
            return;
        }
        let slot = Self::lane_slot(&mut log, brain);
        let index = log.lanes[slot].1[lane];
        log.lanes[slot].1[lane] += 1;
        let sequence = log.events.len();
        log.events.push(BVal::obj([
            ("kind", BVal::text("rng")),
            ("actor", BVal::text(brain)),
            ("stream", BVal::text(lane_name(lane))),
            ("index", BVal::num(index as f64)),
            ("value", BVal::num(value)),
            ("sequence", BVal::num(sequence as f64)),
        ]));
    }

    /// The observer-owned per-lane draw counters `{decide,motor,lapse}` for one Brain.
    pub(crate) fn counts(&self, brain: &str) -> [u64; 3] {
        let mut log = self.lock();
        let slot = Self::lane_slot(&mut log, brain);
        log.lanes[slot].1
    }

    /// A child recorder whose events are not linked (never used; keeps the API honest about one shared operation log).
    pub(crate) fn share(&self) -> Self {
        self.clone()
    }
}

pub(crate) fn lane_name(lane: usize) -> &'static str {
    match lane {
        0 => "decide",
        1 => "motor",
        _ => "lapse",
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Recording entry points.
//
// Every row helper accepts either a live `&Recorder` or the caller's `Option<&Recorder>`: a production Brain (recorder
// `None`) runs the identical call sites with no trace work (`NO_SLOT` is inert). Object own-key order below is the
// frozen source runner's construction/assignment order (`tools/bot-private-brain-fixtures/runner.mts`), never a native
// struct order: the runner pushes a row, `emit` appends `sequence`, then the runner assigns `result`/`error` and the
// adjust extras afterwards.

/// `Recorder::push`'s "no row was recorded" slot: every `finish`-style helper ignores it.
pub(crate) const NO_SLOT: usize = usize::MAX;

/// One trace sink: a live recorder or the caller's optional test-only recorder.
pub(crate) trait TraceSink {
    fn recorder(&self) -> Option<&Recorder>;
}

impl TraceSink for &Recorder {
    fn recorder(&self) -> Option<&Recorder> {
        Some(*self)
    }
}

impl TraceSink for Option<&Recorder> {
    fn recorder(&self) -> Option<&Recorder> {
        *self
    }
}

/// The source identity number for one actual object token (0 when no recorder watches this Brain).
pub(crate) fn identity_number(rec: impl TraceSink, key: IdentityKey) -> u64 {
    rec.recorder().map_or(0, |recorder| recorder.identity(key))
}

/// The empty own-key-ordered `args` array.
pub(crate) fn empty_args() -> BVal {
    BVal::Arr(Vec::new())
}

/// Append one caller-side row (`{kind:"caller",name,...}`): the runner emits these with `sequence` last.
pub(crate) fn record_caller(rec: impl TraceSink, fields: Vec<(&'static str, BVal)>) -> usize {
    match rec.recorder() {
        Some(recorder) => recorder.push(fields),
        None => NO_SLOT,
    }
}

/// Source caller row `createPathBudget`: `{kind,name,handle,perTick,sequence}`.
pub(crate) fn caller_path_budget(rec: impl TraceSink, handle: &str, per_tick: u64) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("caller")),
            ("name", BVal::text("createPathBudget")),
            ("handle", BVal::text(handle)),
            ("perTick", BVal::num(per_tick as f64)),
        ],
    )
}

/// Source caller row `createPathService`: `{kind,name,handle,budget,map,sequence}`.
pub(crate) fn caller_path_service(
    rec: impl TraceSink,
    handle: &str,
    budget: &str,
    map: &str,
) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("caller")),
            ("name", BVal::text("createPathService")),
            ("handle", BVal::text(handle)),
            ("budget", BVal::text(budget)),
            ("map", BVal::text(map)),
        ],
    )
}

/// Source caller row `enabledModules`: `{kind,name,features,handles,sequence}` (`observer` then the selected handles).
pub(crate) fn caller_enabled_modules(
    rec: impl TraceSink,
    features: &Features,
    handles: &[&str],
) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("caller")),
            ("name", BVal::text("enabledModules")),
            ("features", encode_features(features)),
            (
                "handles",
                BVal::arr(handles.iter().map(|handle| BVal::text(*handle))),
            ),
        ],
    )
}

/// Source caller row `createBrain`: `{kind,name,cfg,handle,sequence}`.
pub(crate) fn caller_create_brain(rec: impl TraceSink, cfg: &str, handle: &str) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("caller")),
            ("name", BVal::text("createBrain")),
            ("cfg", BVal::text(cfg)),
            ("handle", BVal::text(handle)),
        ],
    )
}

/// Begin one declared callback row: `{kind,actor,name,args,<extra...>,sequence}`. The runner pushes the row before the
/// native body runs, so a nested declared callback gets a higher `sequence`; the caller finishes it afterwards.
pub(crate) fn begin_callback(
    rec: impl TraceSink,
    actor: &str,
    name: &str,
    args: Vec<BVal>,
    extra: Vec<(&'static str, BVal)>,
) -> usize {
    let Some(recorder) = rec.recorder() else {
        return NO_SLOT;
    };
    let mut fields = Vec::with_capacity(4 + extra.len());
    fields.push(("kind", BVal::text("callback")));
    fields.push(("actor", BVal::text(actor)));
    fields.push(("name", BVal::text(name)));
    fields.push(("args", BVal::arr(args)));
    fields.extend(extra);
    recorder.push(fields)
}

/// Fill the `result` of a row opened by [`begin_callback`] (the runner assigns it after the native body returned).
pub(crate) fn finish_callback(rec: impl TraceSink, slot: usize, result: BVal) {
    if slot == NO_SLOT {
        return;
    }
    if let Some(recorder) = rec.recorder() {
        recorder.finish(slot, "result", result);
    }
}

/// The source `catch` on a declared callback (and builtin wrapper) row: `error:{name,message}` assigned after `sequence`,
/// with no `result`.
pub(crate) fn callback_row_error(rec: impl TraceSink, slot: usize, name: &str, message: &str) {
    if slot == NO_SLOT {
        return;
    }
    if let Some(recorder) = rec.recorder() {
        recorder.finish(
            slot,
            "error",
            BVal::obj([("name", BVal::text(name)), ("message", BVal::text(message))]),
        );
    }
}

/// Record one leaf declared callback (no nested declared callback can occur inside its body).
pub(crate) fn record_callback(
    rec: impl TraceSink,
    actor: &str,
    name: &str,
    args: Vec<BVal>,
    result: BVal,
) {
    let Some(recorder) = rec.recorder() else {
        return;
    };
    let fields = vec![
        ("kind", BVal::text("callback")),
        ("actor", BVal::text(actor)),
        ("name", BVal::text(name)),
        ("args", BVal::arr(args)),
    ];
    let slot = recorder.push(fields);
    recorder.finish(slot, "result", result);
}

/// The active Brain's `observe` row: `{kind,actor,cfgIdentity,originalCfg,rngIdentity,moduleIdentities,engaged,memory,sequence}`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn observe_row(
    rec: impl TraceSink,
    actor: &str,
    cfg_identity: u64,
    original_cfg: bool,
    rng_identity: u64,
    module_identities: &[u64],
    engaged: bool,
    memory: BVal,
) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("observe")),
            ("actor", BVal::text(actor)),
            ("cfgIdentity", BVal::num(cfg_identity as f64)),
            ("originalCfg", BVal::flag(original_cfg)),
            ("rngIdentity", BVal::num(rng_identity as f64)),
            (
                "moduleIdentities",
                BVal::arr(module_identities.iter().map(|id| BVal::num(*id as f64))),
            ),
            ("engaged", BVal::flag(engaged)),
            ("memory", memory),
        ],
    )
}

/// The source `retainedMemoryBeforeFrame` row (`paths.setFrame` body): `{kind,actor,lastHitAt,sequence}`. It is emitted
/// after the `paths.setFrame` callback row is begun and before its `result` is assigned.
pub(crate) fn retained_memory_row(rec: impl TraceSink, actor: &str, last_hit_at: BVal) -> usize {
    record_caller(
        rec,
        vec![
            ("kind", BVal::text("retainedMemoryBeforeFrame")),
            ("actor", BVal::text(actor)),
            ("lastHitAt", last_hit_at),
        ],
    )
}

/// The source builtin call context: `{cfgIdentity,originalCfg,percept,memory,engaged,rngIdentity,knowledgeIdentity}`.
pub(crate) fn builtin_context(
    percept_raw: &BVal,
    memory: BVal,
    engaged: bool,
    cfg_identity: u64,
    original_cfg: bool,
    rng_identity: u64,
    knowledge_identity: u64,
) -> BVal {
    BVal::obj([
        ("cfgIdentity", BVal::num(cfg_identity as f64)),
        ("originalCfg", BVal::flag(original_cfg)),
        ("percept", percept_raw.clone()),
        ("memory", memory),
        ("engaged", BVal::flag(engaged)),
        ("rngIdentity", BVal::num(rng_identity as f64)),
        ("knowledgeIdentity", BVal::num(knowledge_identity as f64)),
    ])
}

/// Begin one builtin module row: `{kind,actor,handle,hook,args,context?,sequence}` (the `enabled` hook passes no context).
pub(crate) fn builtin_row_begin(
    rec: impl TraceSink,
    actor: &str,
    handle: &str,
    hook: &str,
    args: Vec<BVal>,
    context: Option<BVal>,
) -> usize {
    let Some(recorder) = rec.recorder() else {
        return NO_SLOT;
    };
    let mut fields = Vec::with_capacity(6);
    fields.push(("kind", BVal::text("builtin")));
    fields.push(("actor", BVal::text(actor)));
    fields.push(("handle", BVal::text(handle)));
    fields.push(("hook", BVal::text(hook)));
    fields.push(("args", BVal::arr(args)));
    if let Some(context) = context {
        fields.push(("context", context));
    }
    recorder.push(fields)
}

/// Assign the `result` of a builtin row begun by [`builtin_row_begin`].
pub(crate) fn builtin_row_finish(rec: impl TraceSink, slot: usize, result: BVal) {
    finish_callback(rec, slot, result);
}

/// Assign a builtin `adjust` row's `result` then its `returnedInput` (the runner's source assignment order).
pub(crate) fn builtin_row_adjusted(
    rec: impl TraceSink,
    slot: usize,
    result: BVal,
    returned_input: bool,
) {
    if slot == NO_SLOT {
        return;
    }
    if let Some(recorder) = rec.recorder() {
        recorder.finish(slot, "result", result);
        recorder.finish(slot, "returnedInput", BVal::flag(returned_input));
    }
}

/// Assign the builtin `catch` error: `error:{name,message}` after `sequence`, no `result`.
pub(crate) fn builtin_row_error(rec: impl TraceSink, slot: usize, name: &str, message: &str) {
    callback_row_error(rec, slot, name, message);
}

/// The source module-wrapper context fields, spread inline on the row (`...{now,engaged,cfgIdentity}`).
const MODULE_CONTEXT_KEYS: [&str; 3] = ["now", "engaged", "cfgIdentity"];

/// The module hook call context: `{now,engaged,cfgIdentity}` (module `enabled` rows pass no context). Pass the value to
/// [`module_row_begin`], which flattens these three fields inline exactly as the source wrapper does.
pub(crate) fn module_context(now: f64, engaged: bool, cfg_identity: u64) -> BVal {
    BVal::obj([
        ("now", BVal::num(now)),
        ("engaged", BVal::flag(engaged)),
        ("cfgIdentity", BVal::num(cfg_identity as f64)),
    ])
}

/// Begin one caller module hook row:
/// `{kind,actor,handle,id,hook,index,args,now?,engaged?,cfgIdentity?,sequence}` (the `enabled` hook passes no context).
/// Unlike a builtin row's `context` object, the source module wrapper spreads the three context fields inline, so the
/// context object built by [`module_context`] is flattened in its own-key order here.
#[allow(clippy::too_many_arguments)]
pub(crate) fn module_row_begin(
    rec: impl TraceSink,
    actor: &str,
    handle: &str,
    id: &str,
    hook: &str,
    index: u64,
    args: Vec<BVal>,
    context: Option<BVal>,
) -> usize {
    let Some(recorder) = rec.recorder() else {
        return NO_SLOT;
    };
    let mut fields = Vec::with_capacity(10);
    fields.push(("kind", BVal::text("module")));
    fields.push(("actor", BVal::text(actor)));
    fields.push(("handle", BVal::text(handle)));
    fields.push(("id", BVal::text(id)));
    fields.push(("hook", BVal::text(hook)));
    fields.push(("index", BVal::num(index as f64)));
    fields.push(("args", BVal::arr(args)));
    if let Some(BVal::Obj(context_fields)) = context {
        // The source wrapper spreads exactly `{now, engaged, cfgIdentity}` inline: flatten the module context object in
        // its own-key order (the only producer is `module_context`).
        fields.extend(
            context_fields
                .into_iter()
                .zip(MODULE_CONTEXT_KEYS)
                .map(|((_, value), key)| (key, value)),
        );
    }
    recorder.push(fields)
}

/// Assign the `result` of a module row begun by [`module_row_begin`].
pub(crate) fn module_row_finish(rec: impl TraceSink, slot: usize, result: BVal) {
    finish_callback(rec, slot, result);
}

/// Assign an `adjust` module row's source extras then its result: the runner assigns `listIdentity`, `returnedInput`,
/// `resultIdentity` after `sequence` and `result` last.
pub(crate) fn module_row_adjusted(
    rec: impl TraceSink,
    slot: usize,
    list_identity: u64,
    returned_input: bool,
    result_identity: u64,
    result: BVal,
) {
    if slot == NO_SLOT {
        return;
    }
    if let Some(recorder) = rec.recorder() {
        recorder.finish(slot, "listIdentity", BVal::num(list_identity as f64));
        recorder.finish(slot, "returnedInput", BVal::flag(returned_input));
        recorder.finish(slot, "resultIdentity", BVal::num(result_identity as f64));
        recorder.finish(slot, "result", result);
    }
}

/// Assign the source module-hook throw: `error:"<message>"` (a plain string, not the callback Error object).
pub(crate) fn module_row_error(rec: impl TraceSink, slot: usize, message: &str) {
    if slot == NO_SLOT {
        return;
    }
    if let Some(recorder) = rec.recorder() {
        recorder.finish(slot, "error", BVal::text(message));
    }
}

/// Record one runtime lane draw (`0=decide`, `1=motor`, `2=lapse`) through [`Recorder::rng`].
pub(crate) fn record_rng(rec: impl TraceSink, actor: &str, lane: usize, value: f64) {
    if let Some(recorder) = rec.recorder() {
        recorder.rng(actor, lane, value);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Source-shape value encoders. These only format native values into the frozen source record shapes; they never read
// the corpus, mutate native state, consume RNG or fabricate a fact. Own-key orders are pinned by the legacy literals
// (`packages/server/src/bots/brain/**`) and re-checked against the frozen expected rows.

/// Source `{ x, y }`.
pub(crate) fn encode_vec2(value: Vec2) -> BVal {
    BVal::obj([("x", BVal::num(value.x)), ("y", BVal::num(value.y))])
}

/// Source `Option` where the literal always owns the key: half is `null`.
fn encode_opt<T>(value: Option<&T>, encode: impl FnOnce(&T) -> BVal) -> BVal {
    value.map_or(BVal::Null, encode)
}

/// The complete declared `MethodValue` record (`goal.data`, retained raw commands, callback arguments).
pub(crate) fn encode_method_value(value: &MethodValue) -> BVal {
    from_method_value(value)
}

/// A declared source row passed through unchanged (own-key order must survive: e.g. a callback argument retained as the
/// exact declared record).
pub(crate) fn encode_declared_record(raw: &BVal) -> BVal {
    raw.clone()
}

/// Source `Features` (perception.ts `detectFeatures`): the own-key order the callback arguments record.
pub(crate) fn encode_features(features: &Features) -> BVal {
    BVal::obj([
        (
            "messageTypes",
            BVal::arr(
                features
                    .message_types
                    .iter()
                    .map(|kind| BVal::text(kind.as_str())),
            ),
        ),
        ("wishes", BVal::flag(features.wishes)),
        ("statusEffects", BVal::flag(features.status_effects)),
        ("fields", BVal::flag(features.fields)),
        ("planning", BVal::flag(features.planning)),
        ("chests", BVal::flag(features.chests)),
        ("skills", BVal::flag(features.skills)),
        ("relics", BVal::flag(features.relics)),
        ("camps", BVal::flag(features.camps)),
        ("hazards", BVal::flag(features.hazards)),
    ])
}

/// Source `GoalKind` spelling (`strategy.ts` goal union tags and the BrainStats `goals` keys).
pub(crate) fn goal_kind_name(kind: GoalKind) -> &'static str {
    match kind {
        GoalKind::Idle => "idle",
        GoalKind::Farm => "farm",
        GoalKind::Hunt => "hunt",
        GoalKind::Fight => "fight",
        GoalKind::Loot => "loot",
        GoalKind::Flee => "flee",
        GoalKind::Roam => "roam",
        GoalKind::Hold => "hold",
        GoalKind::Module => "module",
    }
}

/// The source Goal union: `{kind,<body fields>}` in the literal's own-key order.
pub(crate) fn encode_goal(goal: &Goal) -> BVal {
    match goal {
        Goal::Idle => BVal::obj([("kind", BVal::text("idle"))]),
        Goal::Farm { mob, camp } => BVal::obj([
            ("kind", BVal::text("farm")),
            ("mob", BVal::text(mob.as_str())),
            ("camp", BVal::opt_text(camp.as_deref())),
        ]),
        Goal::Hunt { target } => BVal::obj([
            ("kind", BVal::text("hunt")),
            ("target", BVal::text(target.as_str())),
        ]),
        Goal::Fight { target } => BVal::obj([
            ("kind", BVal::text("fight")),
            ("target", BVal::text(target.as_str())),
        ]),
        Goal::Loot { container } => BVal::obj([
            ("kind", BVal::text("loot")),
            ("container", BVal::text(container.as_str())),
        ]),
        Goal::Flee { from, until } => BVal::obj([
            ("kind", BVal::text("flee")),
            (
                "from",
                BVal::arr(from.iter().map(|point| encode_vec2(*point))),
            ),
            ("until", BVal::num(*until)),
        ]),
        Goal::Roam { to, why } => BVal::obj([
            ("kind", BVal::text("roam")),
            ("to", encode_vec2(*to)),
            ("why", BVal::text(why.as_str())),
        ]),
        Goal::Hold { at, why } => BVal::obj([
            ("kind", BVal::text("hold")),
            ("at", encode_vec2(*at)),
            ("why", BVal::text(why.as_str())),
        ]),
        Goal::Module { module, data } => BVal::obj([
            ("kind", BVal::text("module")),
            ("module", BVal::text(module.as_str())),
            ("data", encode_method_value(data)),
        ]),
    }
}

/// The source `ChoiceKey`/GoalDecision row: `{goal,utility,why[,choice]}` (source `scored`/module literals).
pub(crate) fn encode_goal_decision(decision: &GoalDecision) -> BVal {
    let mut fields = vec![
        ("goal", encode_goal(&decision.goal)),
        ("utility", BVal::num(decision.utility)),
        ("why", BVal::text(decision.why.as_str())),
    ];
    if let Some(choice) = &decision.choice {
        fields.push(("choice", BVal::text(choice.as_str())));
    }
    BVal::obj(fields)
}

pub(crate) fn encode_goal_decision_list(decisions: &[GoalDecision]) -> BVal {
    BVal::arr(decisions.iter().map(encode_goal_decision))
}

/// Source `GoalState` spelling.
pub(crate) fn encode_goal_state(state: GoalState) -> BVal {
    BVal::text(state.as_str())
}

/// Source `GoalStatus`: `{state,why}`.
pub(crate) fn encode_goal_status(status: &GoalStatus) -> BVal {
    BVal::obj([
        ("state", encode_goal_state(status.state)),
        ("why", BVal::text(status.why.as_str())),
    ])
}

/// Identity-form GoalKind leaf.
pub(crate) fn encode_goal_kind(kind: GoalKind) -> BVal {
    BVal::text(goal_kind_name(kind))
}

/// The BrainStats `goals` object: adopted GoalKind counts in first-adopt order (`goalCounts[...] = ...` insertion order).
pub(crate) fn encode_goal_counts(counts: &[(GoalKind, u64)]) -> BVal {
    BVal::obj(
        counts
            .iter()
            .map(|(kind, count)| (goal_kind_name(*kind), BVal::num(*count as f64))),
    )
}

/// Source `Stimulus`: `kind,at,subject,central[,value]` (the memory `stimuli` rows and `react` timing argument).
pub(crate) fn encode_stimulus(stimulus: &Stimulus) -> BVal {
    let mut fields = vec![
        ("kind", BVal::text(stimulus.kind.as_str())),
        ("at", BVal::num(stimulus.at)),
        ("subject", BVal::opt_text(stimulus.subject.as_deref())),
        ("central", BVal::flag(stimulus.central)),
    ];
    if let Some(value) = stimulus.value {
        fields.push(("value", BVal::num(value)));
    }
    BVal::obj(fields)
}

pub(crate) fn encode_stimulus_list(stimuli: &[Stimulus]) -> BVal {
    BVal::arr(stimuli.iter().map(encode_stimulus))
}

/// Source `PlanMsg` own keys: `spawn, boon, ready` — the source literals pass a single-field object, so an absent
/// native `Option` is an absent own key, never `undefined`.
pub(crate) fn encode_plan_msg(msg: &PlanMsg) -> BVal {
    BVal::obj(plan_msg_fields(msg.spawn, msg.boon, msg.ready))
}

fn plan_msg_fields(
    spawn: Option<u8>,
    boon: Option<u8>,
    ready: Option<bool>,
) -> Vec<(&'static str, BVal)> {
    let mut fields = Vec::with_capacity(3);
    if let Some(spawn) = spawn {
        fields.push(("spawn", BVal::num(f64::from(spawn))));
    }
    if let Some(boon) = boon {
        fields.push(("boon", BVal::num(f64::from(boon))));
    }
    if let Some(ready) = ready {
        fields.push(("ready", BVal::flag(ready)));
    }
    fields
}

/// Source `ChooseMsg` own keys: `chest, pick[, replace]`.
pub(crate) fn encode_choose_msg(msg: &ChooseMsg) -> BVal {
    BVal::obj(choose_msg_fields(msg.chest.as_str(), msg.pick, msg.replace))
}

fn choose_msg_fields(chest: &str, pick: i8, replace: Option<u8>) -> Vec<(&'static str, BVal)> {
    let mut fields = vec![
        ("chest", BVal::text(chest)),
        ("pick", BVal::num(f64::from(pick))),
    ];
    if let Some(replace) = replace {
        fields.push(("replace", BVal::num(f64::from(replace))));
    }
    fields
}

/// Source `IntentTiming`: `{kind:"react",stimulus}` | `{kind:"step"}` | `{kind:"timed",due}`.
pub(crate) fn encode_timing(timing: &IntentTiming) -> BVal {
    match timing {
        IntentTiming::React { stimulus } => BVal::obj([
            ("kind", BVal::text("react")),
            ("stimulus", encode_stimulus(stimulus)),
        ]),
        IntentTiming::Step {} => BVal::obj([("kind", BVal::text("step"))]),
        IntentTiming::Timed { due } => {
            BVal::obj([("kind", BVal::text("timed")), ("due", BVal::num(*due))])
        }
    }
}

/// Source `Intent` (brain/types.ts literals): `{kind,<body fields>,priority,timing,why}`.
pub(crate) fn encode_intent(intent: &Intent) -> BVal {
    let mut fields: Vec<(&'static str, BVal)> = match &intent.body {
        IntentBody::Lock { target, at } => vec![
            ("kind", BVal::text("lock")),
            ("target", BVal::text(target.as_str())),
            ("at", encode_vec2(*at)),
        ],
        IntentBody::Move { to } => vec![("kind", BVal::text("move")), ("to", encode_vec2(*to))],
        IntentBody::Stop {} => vec![("kind", BVal::text("stop"))],
        IntentBody::Swap { slot } => vec![
            ("kind", BVal::text("swap")),
            ("slot", BVal::num(f64::from(*slot))),
        ],
        IntentBody::Pickup { container } => vec![
            ("kind", BVal::text("pickup")),
            ("container", BVal::text(container.as_str())),
        ],
        IntentBody::Cast {
            slot,
            x,
            y,
            target,
            at,
            snap_radius,
        } => {
            let mut cast = vec![
                ("kind", BVal::text("cast")),
                ("slot", BVal::text(slot.as_str())),
                ("x", BVal::num(*x)),
                ("y", BVal::num(*y)),
            ];
            // The source builder spreads the unit-cast facts only for a unit cast (no `target: undefined` own key).
            if let Some(target) = target {
                cast.push(("target", BVal::text(target.as_str())));
            }
            if let Some(at) = at {
                cast.push(("at", encode_vec2(*at)));
            }
            if let Some(snap_radius) = snap_radius {
                cast.push(("snapRadius", BVal::num(*snap_radius)));
            }
            cast
        }
        IntentBody::Plan { msg } => {
            vec![("kind", BVal::text("plan")), ("msg", encode_plan_msg(msg))]
        }
        IntentBody::Choose { msg } => vec![
            ("kind", BVal::text("choose")),
            ("msg", encode_choose_msg(msg)),
        ],
    };
    fields.push(("priority", BVal::num(f64::from(intent.priority))));
    fields.push(("timing", encode_timing(&intent.timing)));
    fields.push(("why", BVal::text(intent.why.as_str())));
    BVal::obj(fields)
}

pub(crate) fn encode_intent_list(intents: &[Intent]) -> BVal {
    BVal::arr(intents.iter().map(encode_intent))
}

/// One source `Command` message. `seq` is the Brain's stamped order number and only `move`/`stop` own one (the source
/// `stamp` spreads `{...msg, seq}` after the client message fields); every other command ignores it.
pub(crate) fn encode_command(cmd: &Command) -> BVal {
    encode_command_with_seq(cmd, None)
}

/// [`encode_command`] with the source order-number stamp for `move`/`stop` (`{...msg, seq}` appended last).
pub(crate) fn encode_command_with_seq(cmd: &Command, seq: Option<f64>) -> BVal {
    let msg = match cmd {
        Command::Move { x, y } => {
            let mut fields = vec![("x", BVal::num(*x)), ("y", BVal::num(*y))];
            if let Some(seq) = seq {
                fields.push(("seq", BVal::num(seq)));
            }
            BVal::obj(fields)
        }
        Command::Stop {} => {
            let mut fields = Vec::with_capacity(1);
            if let Some(seq) = seq {
                fields.push(("seq", BVal::num(seq)));
            }
            BVal::obj(fields)
        }
        Command::Target { id } => BVal::obj([("id", BVal::text(id.as_str()))]),
        Command::Attack { a } => BVal::obj([("a", BVal::num(*a))]),
        Command::Release { a } => BVal::obj([("a", BVal::num(*a))]),
        Command::Swap { slot } => BVal::obj([("slot", BVal::num(f64::from(*slot)))]),
        Command::Pickup { container_id } => {
            BVal::obj([("containerId", BVal::text(container_id.as_str()))])
        }
        Command::Cast { slot, x, y, id } => {
            let mut fields = vec![
                ("slot", BVal::text(slot.as_str())),
                ("x", BVal::num(*x)),
                ("y", BVal::num(*y)),
            ];
            if let Some(id) = id {
                fields.push(("id", BVal::text(id.as_str())));
            }
            BVal::obj(fields)
        }
        Command::Plan { spawn, boon, ready } => BVal::obj(plan_msg_fields(*spawn, *boon, *ready)),
        Command::Choose {
            chest,
            pick,
            replace,
        } => BVal::obj(choose_msg_fields(chest.as_str(), *pick, *replace)),
    };
    BVal::obj([
        ("type", BVal::text(cmd.command_type().as_str())),
        ("msg", msg),
    ])
}

/// Source `TimedCommand`: `{at,cmd,intent,priority,stimulus}` (no stamp: the unstamped hand/command value).
pub(crate) fn encode_timed_command(command: &TimedCommand) -> BVal {
    BVal::obj([
        ("at", BVal::num(command.at)),
        ("cmd", encode_command(&command.cmd)),
        ("intent", BVal::text(command.intent.as_str())),
        ("priority", BVal::num(f64::from(command.priority))),
        (
            "stimulus",
            encode_opt(command.stimulus.as_ref(), encode_stimulus),
        ),
    ])
}

pub(crate) fn encode_timed_commands(commands: &[TimedCommand]) -> BVal {
    BVal::arr(commands.iter().map(encode_timed_command))
}

/// One released source command as the Brain returns it: the source `TimedCommand` order plus the stamped move/stop
/// sequence folded back into the command message exactly as source `stamp` spread it.
pub(crate) fn encode_released_command(command: &ReleasedCommand) -> BVal {
    let stamped = matches!(command.cmd, Command::Move { .. } | Command::Stop {});
    let seq = if stamped { command.seq } else { None };
    BVal::obj([
        ("at", BVal::num(command.at)),
        ("cmd", encode_command_with_seq(&command.cmd, seq)),
        ("intent", BVal::text(command.intent.as_str())),
        ("priority", BVal::num(f64::from(command.priority))),
        (
            "stimulus",
            encode_opt(command.stimulus.as_ref(), encode_stimulus),
        ),
    ])
}

pub(crate) fn encode_released_commands(commands: &[ReleasedCommand]) -> BVal {
    BVal::arr(commands.iter().map(encode_released_command))
}

/// Source `RunSummary` (`end()` literal): `{tier,persona,faction,outcome,place,players,choices}`.
pub(crate) fn encode_run_summary(summary: &RunSummary) -> BVal {
    BVal::obj([
        ("tier", BVal::text(summary.tier.as_str())),
        ("persona", BVal::text(summary.persona.as_str())),
        (
            "faction",
            summary
                .faction
                .map_or(BVal::Null, |faction| BVal::text(faction.as_str())),
        ),
        ("outcome", BVal::text(summary.outcome.as_str())),
        ("place", BVal::num(summary.place)),
        ("players", BVal::num(summary.players)),
        (
            "choices",
            BVal::arr(
                summary
                    .choices
                    .iter()
                    .map(|choice| BVal::text(choice.as_str())),
            ),
        ),
    ])
}

/// The humanizer's `commands` record: `COMMAND_TYPES` order (`move,stop,target,attack,release,swap,pickup,cast,plan,choose`).
fn encode_humanizer_commands(stats: &HumanizerStats) -> BVal {
    BVal::obj(
        crate::bots::types::COMMAND_TYPES
            .iter()
            .enumerate()
            .map(|(index, kind)| (kind.as_str(), BVal::num(stats.commands[index] as f64))),
    )
}

/// The humanizer's `reactions` record: only the kinds that produced a reaction, in the map's retained order.
fn encode_humanizer_reactions(stats: &HumanizerStats) -> BVal {
    BVal::obj(stats.reactions.iter().map(|(kind, delays)| {
        (
            kind.as_str(),
            BVal::arr(delays.iter().map(|delay| BVal::num(*delay))),
        )
    }))
}

/// Source `BrainStats` (brain.ts stats getter): the humanizer's own counters spread first in their creation order, then
/// the Brain/hunt/tactics/goal/build extras in the source literal's own-key order.
pub(crate) fn encode_brain_stats(stats: &BrainStats) -> BVal {
    let humanizer = &stats.humanizer;
    BVal::obj([
        ("commands", encode_humanizer_commands(humanizer)),
        ("reactions", encode_humanizer_reactions(humanizer)),
        ("targetClicks", BVal::num(humanizer.target_clicks as f64)),
        ("clickMissed", BVal::num(humanizer.click_missed as f64)),
        ("clickWrong", BVal::num(humanizer.click_wrong as f64)),
        ("hesitations", BVal::num(humanizer.hesitations as f64)),
        ("lapses", BVal::num(humanizer.lapses as f64)),
        ("throttled", BVal::num(humanizer.throttled as f64)),
        ("superseded", BVal::num(humanizer.superseded as f64)),
        ("apmPeak", BVal::num(humanizer.apm_peak as f64)),
        ("mobTargets", BVal::num(stats.mob_targets)),
        ("mobDrops", BVal::num(stats.mob_drops)),
        ("retreats", BVal::num(stats.retreats)),
        ("mobFocusMs", BVal::num(stats.mob_focus_ms)),
        ("grabs", BVal::num(stats.grabs as f64)),
        ("maxStallMs", BVal::num(stats.max_stall_ms)),
        ("dodges", BVal::num(stats.dodges as f64)),
        ("jukes", BVal::num(stats.jukes as f64)),
        ("kiteCycles", BVal::num(stats.kite_cycles as f64)),
        ("goals", encode_goal_counts(&stats.goals)),
        ("build", BVal::text(stats.build.as_str())),
        ("routeContests", BVal::num(stats.route_contests as f64)),
    ])
}

/// The three runtime lane draw counters the observer keeps: `{decide,motor,lapse}`.
pub(crate) fn encode_rng_counts(decide: u64, motor: u64, lapse: u64) -> BVal {
    BVal::obj([
        ("decide", BVal::num(decide as f64)),
        ("motor", BVal::num(motor as f64)),
        ("lapse", BVal::num(lapse as f64)),
    ])
}

/// Source `PathStats`: `{searches,hits,fallbacks}`.
pub(crate) fn encode_path_stats(stats: &PathStats) -> BVal {
    BVal::obj([
        ("searches", BVal::num(stats.searches as f64)),
        ("hits", BVal::num(stats.hits as f64)),
        ("fallbacks", BVal::num(stats.fallbacks as f64)),
    ])
}

/// One caller service diagnostic row: `{stats,budget,left}`.
pub(crate) fn encode_service_snapshot(stats: &PathStats, budget: &str, left: u32) -> BVal {
    BVal::obj([
        ("stats", encode_path_stats(stats)),
        ("budget", BVal::text(budget)),
        ("left", BVal::num(f64::from(left))),
    ])
}

/// Source module/tactics output: `{intents,status,attacking}`.
pub(crate) fn encode_module_output(output: &ModuleOutput) -> BVal {
    BVal::obj([
        ("intents", encode_intent_list(&output.intents)),
        ("status", encode_goal_status(&output.status)),
        ("attacking", BVal::flag(output.attacking)),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Source Memory snapshot (codec.mts `memorySnapshot`: {fighters,mobs,camps,containers,self,stimuli,bounties,choices}).
//
// The source Brain reads a tick overlay view whose `stimuli` getter returns this percept's observed stimuli plus the
// humanizer's drained misses, NOT the Memory object's own retained list. Every snapshot row therefore takes the tick
// overlay `stimuli` explicitly and uses it for the `stimuli` field while reading the actual Memory state for the rest.
// Nested record own-key order is the source `memory.ts` construction order, never the native struct order.

#[allow(clippy::too_many_arguments)]
fn encode_memory_parts(
    fighters: &[(String, FighterMemory)],
    mobs: &[(String, MobMemory)],
    camps: &[(String, CampMemory)],
    containers: &[(String, ContainerMemory)],
    self_memory: &SelfMemory,
    stimuli: &[Stimulus],
    bounties: &[(String, f64)],
    choices: &[String],
) -> BVal {
    let fighters = BVal::Map(
        fighters
            .iter()
            .map(|(id, fighter)| {
                (
                    BVal::text(id.as_str()),
                    BVal::obj([
                        ("id", BVal::text(fighter.id.as_str())),
                        ("name", BVal::text(fighter.name.as_str())),
                        ("bot", BVal::flag(fighter.bot)),
                        (
                            "faction",
                            fighter
                                .faction
                                .map_or(BVal::Null, |faction| BVal::text(faction.as_str())),
                        ),
                        (
                            "weaponsSeen",
                            BVal::arr(
                                fighter
                                    .weapons_seen
                                    .iter()
                                    .map(|weapon| BVal::text(weapon.as_str())),
                            ),
                        ),
                        (
                            "inHand",
                            fighter
                                .in_hand
                                .map_or(BVal::Null, |weapon| BVal::text(weapon.as_str())),
                        ),
                        (
                            "otherSlot",
                            fighter
                                .other_slot
                                .map_or(BVal::Null, |weapon| BVal::text(weapon.as_str())),
                        ),
                        ("seenAt", BVal::num(fighter.seen_at)),
                        ("pos", encode_vec2(fighter.pos)),
                        ("vel", encode_vec2(fighter.vel)),
                        ("hpFrac", BVal::num(fighter.hp_frac)),
                        ("bounty", BVal::num(fighter.bounty)),
                        ("alive", BVal::flag(fighter.alive)),
                        (
                            "diedAt",
                            encode_opt(fighter.died_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        (
                            "hitMeAt",
                            encode_opt(fighter.hit_me_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        (
                            "hitByMeAt",
                            encode_opt(fighter.hit_by_me_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        ("damageToMe", BVal::num(fighter.damage_to_me)),
                        ("damageByMe", BVal::num(fighter.damage_by_me)),
                        (
                            "engagedWith",
                            BVal::opt_text(fighter.engaged_with.as_deref()),
                        ),
                        (
                            "engagedAt",
                            encode_opt(fighter.engaged_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        ("chasingMe", BVal::flag(fighter.chasing_me)),
                        (
                            "wishSeenAt",
                            encode_opt(fighter.wish_seen_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        (
                            "wishReadyGuess",
                            encode_opt(fighter.wish_ready_guess.as_ref(), |value| {
                                BVal::num(*value)
                            }),
                        ),
                        ("feints", BVal::num(fighter.feints as f64)),
                        (
                            "lastFeintAt",
                            encode_opt(fighter.last_feint_at.as_ref(), |value| BVal::num(*value)),
                        ),
                    ]),
                )
            })
            .collect(),
    );
    let mobs = BVal::Map(
        mobs.iter()
            .map(|(id, mob)| {
                // Source creation order: {id,kind,faction,(name when the record has one),home,campId,pos,dotAt,seenAt,
                // hpFrac,inHand,awake,returning,alive}; `type` is assigned later on the live object, so it appends last.
                let mut fields = vec![
                    ("id", BVal::text(mob.id.as_str())),
                    ("kind", BVal::text(mob.kind.as_str())),
                    (
                        "faction",
                        mob.faction
                            .map_or(BVal::Null, |faction| BVal::text(faction.as_str())),
                    ),
                ];
                if let Some(name) = &mob.name {
                    fields.push(("name", BVal::text(name.as_str())));
                }
                fields.extend([
                    (
                        "home",
                        encode_opt(mob.home.as_ref(), |home| encode_vec2(*home)),
                    ),
                    ("campId", BVal::opt_text(mob.camp_id.as_deref())),
                    ("pos", encode_vec2(mob.pos)),
                    ("dotAt", BVal::num(mob.dot_at)),
                    (
                        "seenAt",
                        encode_opt(mob.seen_at.as_ref(), |value| BVal::num(*value)),
                    ),
                    ("hpFrac", BVal::num(mob.hp_frac)),
                    (
                        "inHand",
                        mob.in_hand
                            .map_or(BVal::Null, |weapon| BVal::text(weapon.as_str())),
                    ),
                    ("awake", BVal::flag(mob.awake)),
                    ("returning", BVal::flag(mob.returning)),
                    ("alive", BVal::flag(mob.alive)),
                ]);
                if let Some(kind) = &mob.type_ {
                    fields.push(("type", BVal::text(kind.as_str())));
                }
                (BVal::text(id.as_str()), BVal::obj(fields))
            })
            .collect(),
    );
    let camps = BVal::Map(
        camps
            .iter()
            .map(|(id, camp)| {
                (
                    BVal::text(id.as_str()),
                    BVal::obj([
                        ("id", BVal::text(camp.id.as_str())),
                        ("zone", BVal::text(camp.zone.as_str())),
                        ("elite", BVal::flag(camp.elite)),
                        ("aliveSeen", BVal::num(f64::from(camp.alive_seen))),
                        (
                            "clearedAt",
                            encode_opt(camp.cleared_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        (
                            "contestedAt",
                            encode_opt(camp.contested_at.as_ref(), |value| BVal::num(*value)),
                        ),
                        (
                            "visitedAt",
                            encode_opt(camp.visited_at.as_ref(), |value| BVal::num(*value)),
                        ),
                    ]),
                )
            })
            .collect(),
    );
    let containers = BVal::Map(
        containers
            .iter()
            .map(|(id, container)| {
                (
                    BVal::text(id.as_str()),
                    BVal::obj([
                        ("id", BVal::text(container.id.as_str())),
                        ("kind", BVal::text(container.kind.as_str())),
                        ("pos", encode_vec2(container.pos)),
                        ("closed", BVal::flag(container.closed)),
                        (
                            "weapon",
                            match container.weapon {
                                ContainersWeapon::Undefined => BVal::Undefined,
                                ContainersWeapon::Null => BVal::Null,
                                ContainersWeapon::Weapon(weapon) => BVal::text(weapon.as_str()),
                            },
                        ),
                        ("seenAt", BVal::num(container.seen_at)),
                        ("skipped", BVal::flag(container.skipped)),
                    ]),
                )
            })
            .collect(),
    );
    let recent_hits = BVal::arr(self_memory.recent_hits.iter().map(|hit| {
        BVal::obj([
            ("t", BVal::num(hit.t)),
            ("by", BVal::opt_text(hit.by.as_deref())),
            ("amount", BVal::num(hit.amount)),
        ])
    }));
    let self_record = BVal::obj([
        (
            "lastHitAt",
            encode_opt(self_memory.last_hit_at.as_ref(), |value| BVal::num(*value)),
        ),
        (
            "lastHitByPlayerAt",
            encode_opt(self_memory.last_hit_by_player_at.as_ref(), |value| {
                BVal::num(*value)
            }),
        ),
        (
            "lastDealtAt",
            encode_opt(self_memory.last_dealt_at.as_ref(), |value| {
                BVal::num(*value)
            }),
        ),
        ("recentDamage", BVal::num(self_memory.recent_damage)),
        ("recentHits", recent_hits),
        (
            "teleportedAt",
            encode_opt(self_memory.teleported_at.as_ref(), |value| {
                BVal::num(*value)
            }),
        ),
        (
            "lastOrder",
            encode_opt(self_memory.last_order.as_ref(), |command| {
                encode_method_value(&command.raw)
            }),
        ),
        (
            "lastCast",
            encode_opt(self_memory.last_cast.as_ref(), |command| {
                encode_method_value(&command.raw)
            }),
        ),
        ("stillSince", BVal::num(self_memory.still_since)),
    ]);
    let bounties = BVal::Map(
        bounties
            .iter()
            .map(|(id, bounty)| (BVal::text(id.as_str()), BVal::num(*bounty)))
            .collect(),
    );
    let choices = BVal::arr(choices.iter().map(|choice| BVal::text(choice.as_str())));
    BVal::obj([
        ("fighters", fighters),
        ("mobs", mobs),
        ("camps", camps),
        ("containers", containers),
        ("self", self_record),
        ("stimuli", encode_stimulus_list(stimuli)),
        ("bounties", bounties),
        ("choices", choices),
    ])
}

/// The source Memory snapshot of one admitted [`Memory`] with this tick's overlay stimuli.
pub(crate) fn encode_memory_snapshot(memory: &Memory, stimuli: &[Stimulus]) -> BVal {
    let view = memory.view();
    encode_memory_parts(
        view.fighters,
        view.mobs,
        view.camps,
        view.containers,
        view.self_memory,
        stimuli,
        view.bounties,
        view.choices,
    )
}

/// The same source Memory snapshot read through the private [`MemoryApi`] surface (native Memory or a declared test
/// adapter), with this tick's overlay stimuli.
pub(crate) fn encode_memory_snapshot_api(memory: &dyn MemoryApi, stimuli: &[Stimulus]) -> BVal {
    encode_memory_parts(
        memory.fighters(),
        memory.mobs(),
        memory.camps(),
        memory.containers(),
        memory.self_memory(),
        stimuli,
        memory.bounties(),
        memory.choices(),
    )
}

/// One Brain's diagnostic snapshot after an operation (`snapshot()` in the source runner):
/// `{goal,stats,memory,counts}` — `memory`/`counts` are `null` before the neutral observer activated that Brain.
pub(crate) fn encode_brain_snapshot(
    goal: BVal,
    stats: BVal,
    memory: Option<BVal>,
    counts: Option<BVal>,
) -> BVal {
    BVal::obj([
        ("goal", goal),
        ("stats", stats),
        ("memory", memory.unwrap_or(BVal::Null)),
        ("counts", counts.unwrap_or(BVal::Null)),
    ])
}

/// The per-brain snapshots of one operation, keyed by Brain handle in instance-creation order.
pub(crate) fn encode_brain_snapshots(entries: &[(&str, BVal)]) -> BVal {
    BVal::Obj(
        entries
            .iter()
            .map(|(handle, snapshot)| ((*handle).to_owned(), snapshot.clone()))
            .collect(),
    )
}

/// One operation row of the frozen `rh-bot-private-brain-source/1` history:
/// `{method,declaration,result[,error],brains,services,trace}` (the source runner writes `error` only when caught).
pub(crate) fn encode_operation_row(
    method: &str,
    declaration: BVal,
    result: BVal,
    error: Option<BVal>,
    brains: BVal,
    services: BVal,
    trace: BVal,
) -> BVal {
    let mut fields = vec![
        ("method", BVal::text(method)),
        ("declaration", declaration),
        ("result", result),
    ];
    if let Some(error) = error {
        fields.push(("error", error));
    }
    fields.push(("brains", brains));
    fields.push(("services", services));
    fields.push(("trace", trace));
    BVal::obj(fields)
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact ordered comparison.
//
// The comparator policy is the frozen witness's: binary64 bit identity (`-0` distinct from `0`; NaN is the codec's one
// unrepresentable sentinel, so any NaN equals any NaN), tag identity (`Undefined` vs `null` vs absent), and ordered
// object/instance/map/set/array entries (source own-key and insertion order are observable). No tolerance, whitelist or
// ignored leaf: the first raw difference and a path to it are reported.

/// Exact source-value equality: [`BVal::same`] already enforces ordered object/instance/map/set/array entries and the
/// tagged leaf identity, so it is the single canonical comparator (the wrapper keeps one callable name for the harness).
pub(crate) fn same(expected: &BVal, actual: &BVal) -> bool {
    expected.same(actual)
}

/// Compact exact-number description (bits, including the tagged non-finite/`-0` spellings) for a mismatch receipt.
fn describe_number(value: f64) -> String {
    if value.is_nan() {
        format!("NaN(bits=0x{:016x})", value.to_bits())
    } else if value == f64::INFINITY {
        format!("+Infinity(bits=0x{:016x})", value.to_bits())
    } else if value == f64::NEG_INFINITY {
        format!("-Infinity(bits=0x{:016x})", value.to_bits())
    } else if value == 0. && value.is_sign_negative() {
        format!("-0(bits=0x{:016x})", value.to_bits())
    } else {
        format!("{value:?}(bits=0x{:016x})", value.to_bits())
    }
}

fn key_names(entries: &[(String, BVal)]) -> Vec<&str> {
    entries.iter().map(|(key, _)| key.as_str()).collect()
}

/// Compact value description for a mismatch message (never the whole tree).
fn describe(value: &BVal) -> String {
    match value {
        BVal::Undefined => "undefined".into(),
        BVal::Null => "null".into(),
        BVal::Bool(value) => format!("bool {value}"),
        BVal::Num(value) => describe_number(*value),
        BVal::Str(value) => format!("string {value:?}"),
        BVal::Arr(values) => format!("array({})", values.len()),
        BVal::Map(entries) => format!("map({})", entries.len()),
        BVal::Set(values) => format!("set({})", values.len()),
        BVal::U8(bytes) => format!("u8({})", bytes.len()),
        BVal::Obj(entries) => format!("object({}; keys={:?})", entries.len(), key_names(entries)),
        BVal::Instance { name, entries } => format!(
            "instance {name}({}; keys={:?})",
            entries.len(),
            key_names(entries)
        ),
        BVal::Callable => "callable".into(),
    }
}

/// The first raw difference between two source values with a compact path to it (`key`, `[index]`, `{map index}`, `u8`
/// byte index; numbers report exact bits). `None` only when [`same`] holds.
pub(crate) fn first_difference(expected: &BVal, actual: &BVal, path: &str) -> Option<String> {
    match (expected, actual) {
        (BVal::Obj(expected_entries), BVal::Obj(actual_entries)) => {
            if expected_entries.len() != actual_entries.len() {
                return Some(format!(
                    "{path}: object length expected {} actual {} (expected keys {:?}, actual keys {:?})",
                    expected_entries.len(),
                    actual_entries.len(),
                    key_names(expected_entries),
                    key_names(actual_entries),
                ));
            }
            for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                expected_entries.iter().zip(actual_entries).enumerate()
            {
                if expected_key != actual_key {
                    return Some(format!(
                        "{path}: object key[{index}] expected {expected_key:?} actual {actual_key:?} (misspelled or reordered)"
                    ));
                }
                if !same(expected_value, actual_value) {
                    return first_difference(
                        expected_value,
                        actual_value,
                        &format!("{path}.{expected_key}"),
                    );
                }
            }
            None
        }
        (
            BVal::Instance {
                name: expected_name,
                entries: expected_entries,
            },
            BVal::Instance {
                name: actual_name,
                entries: actual_entries,
            },
        ) => {
            if expected_name != actual_name {
                return Some(format!(
                    "{path}: instance name expected {expected_name:?} actual {actual_name:?}"
                ));
            }
            if expected_entries.len() != actual_entries.len() {
                return Some(format!(
                    "{path}: instance {expected_name} length expected {} actual {} (expected keys {:?}, actual keys {:?})",
                    expected_entries.len(),
                    actual_entries.len(),
                    key_names(expected_entries),
                    key_names(actual_entries),
                ));
            }
            for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                expected_entries.iter().zip(actual_entries).enumerate()
            {
                if expected_key != actual_key {
                    return Some(format!(
                        "{path}: instance key[{index}] expected {expected_key:?} actual {actual_key:?} (misspelled or reordered)"
                    ));
                }
                if !same(expected_value, actual_value) {
                    return first_difference(
                        expected_value,
                        actual_value,
                        &format!("{path}.{expected_key}"),
                    );
                }
            }
            None
        }
        (BVal::Arr(expected_values), BVal::Arr(actual_values))
        | (BVal::Set(expected_values), BVal::Set(actual_values)) => {
            if expected_values.len() != actual_values.len() {
                return Some(format!(
                    "{path}: collection length expected {} actual {}",
                    expected_values.len(),
                    actual_values.len()
                ));
            }
            for (index, (expected_value, actual_value)) in
                expected_values.iter().zip(actual_values).enumerate()
            {
                if !same(expected_value, actual_value) {
                    return first_difference(
                        expected_value,
                        actual_value,
                        &format!("{path}[{index}]"),
                    );
                }
            }
            None
        }
        (BVal::Map(expected_entries), BVal::Map(actual_entries)) => {
            if expected_entries.len() != actual_entries.len() {
                return Some(format!(
                    "{path}: map length expected {} actual {}",
                    expected_entries.len(),
                    actual_entries.len()
                ));
            }
            for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                expected_entries.iter().zip(actual_entries).enumerate()
            {
                if !same(expected_key, actual_key) {
                    return Some(format!(
                        "{path}: map key[{index}] expected {} actual {} (entry order matters)",
                        describe(expected_key),
                        describe(actual_key)
                    ));
                }
                if !same(expected_value, actual_value) {
                    return first_difference(
                        expected_value,
                        actual_value,
                        &format!("{path}[{index}]"),
                    );
                }
            }
            None
        }
        (BVal::U8(expected_bytes), BVal::U8(actual_bytes)) => {
            if expected_bytes.len() != actual_bytes.len() {
                return Some(format!(
                    "{path}: u8 length expected {} actual {}",
                    expected_bytes.len(),
                    actual_bytes.len()
                ));
            }
            expected_bytes
                .iter()
                .zip(actual_bytes)
                .enumerate()
                .find_map(|(index, (expected_byte, actual_byte))| {
                    (expected_byte != actual_byte).then(|| {
                        format!(
                            "{path}: u8 byte[{index}] expected {expected_byte} actual {actual_byte}"
                        )
                    })
                })
        }
        (BVal::Num(expected_value), BVal::Num(actual_value)) => (expected_value.to_bits()
            != actual_value.to_bits()
            && !(expected_value.is_nan() && actual_value.is_nan()))
        .then(|| {
            format!(
                "{path}: number expected {} actual {}",
                describe_number(*expected_value),
                describe_number(*actual_value)
            )
        }),
        _ => {
            if same(expected, actual) {
                None
            } else {
                Some(format!(
                    "{path}: expected {} actual {}",
                    describe(expected),
                    describe(actual)
                ))
            }
        }
    }
}

/// Compare one labeled surface exactly; push the first raw difference (with its path) on failure.
pub(crate) fn compare(label: &str, expected: &BVal, actual: &BVal, failures: &mut Vec<String>) {
    if same(expected, actual) {
        return;
    }
    failures.push(
        first_difference(expected, actual, label).unwrap_or_else(|| {
            format!(
                "{label}: expected {} actual {}",
                describe(expected),
                describe(actual)
            )
        }),
    );
}

/// Compare two complete callback/RNG transcripts exactly: the event count, then every entry in order.
pub(crate) fn compare_transcript_values(
    label: &str,
    expected: &BVal,
    actual: &BVal,
    failures: &mut Vec<String>,
) {
    let (BVal::Arr(expected_events), BVal::Arr(actual_events)) = (expected, actual) else {
        failures.push(format!(
            "{label} trace: non-array transcript expected {} actual {}",
            describe(expected),
            describe(actual)
        ));
        return;
    };
    if expected_events.len() != actual_events.len() {
        failures.push(format!(
            "{label} trace: expected {} events actual {} (first missing/extra index {})",
            expected_events.len(),
            actual_events.len(),
            expected_events.len().min(actual_events.len())
        ));
        return;
    }
    for (sequence, (expected_event, actual_event)) in
        expected_events.iter().zip(actual_events).enumerate()
    {
        if same(expected_event, actual_event) {
            continue;
        }
        failures.push(
            first_difference(
                expected_event,
                actual_event,
                &format!("{label} trace[{sequence}]"),
            )
            .unwrap_or_else(|| format!("{label} trace[{sequence}]: event differs")),
        );
        return;
    }
}

/// Compare the recorder's transcript against the frozen operation transcript (exact ordered events).
pub(crate) fn compare_transcript(
    label: &str,
    expected: &BVal,
    recorder: &Recorder,
    failures: &mut Vec<String>,
) {
    let actual = recorder.events();
    compare_transcript_values(label, expected, &actual, failures);
}

// ---------------------------------------------------------------------------------------------------------------------
// Source `assert.deepEqual`-comparable equality (the frozen tool's own expected-vs-actual policy).
//
// The frozen comparator (`tools/bot-private-brain-fixtures/verify.mjs::validate`) asserts `deepEqual(encode(value),
// expected)`: a source object's own-property order is NOT semantically observable there, while arrays (and the encoded
// map/set entries) stay ordered and every tagged leaf stays exact. The frozen `memorySnapshot` mob record is the concrete
// case: source `foldMobs` creates a dot-first record without `name` and appends `name`/`type` when the mob is later seen,
// or creates a visible-first record with `name` inline, so the same native `MobMemory` state can legitimately encode
// either own-key order. The Brain replay compares values under this policy and keeps row-array/transcript order strict
// (`same`/`compare`/`compare_transcript*` above remain the strict comparators for our own controls).

fn entries_deep_equal(expected: &[(String, BVal)], actual: &[(String, BVal)]) -> bool {
    expected.len() == actual.len()
        && expected.iter().all(|(key, expected_value)| {
            actual
                .iter()
                .find(|(actual_key, _)| actual_key == key)
                .is_some_and(|(_, actual_value)| same_deep_equal(expected_value, actual_value))
        })
}

/// Source `assert.deepEqual` comparability over tagged values: object/instance entries compare as an exact key SET ->
/// value (own-property order not observable), arrays/maps/sets stay ordered, and leaves stay exact (binary64 bits with
/// NaN==NaN, `-0` distinct, tags/`Uint8Array` exact). Never a numeric tolerance and never a key whitelist.
pub(crate) fn same_deep_equal(expected: &BVal, actual: &BVal) -> bool {
    match (expected, actual) {
        (BVal::Obj(expected_entries), BVal::Obj(actual_entries)) => {
            entries_deep_equal(expected_entries, actual_entries)
        }
        (
            BVal::Instance {
                name: expected_name,
                entries: expected_entries,
            },
            BVal::Instance {
                name: actual_name,
                entries: actual_entries,
            },
        ) => expected_name == actual_name && entries_deep_equal(expected_entries, actual_entries),
        (BVal::Arr(expected_values), BVal::Arr(actual_values))
        | (BVal::Set(expected_values), BVal::Set(actual_values)) => {
            expected_values.len() == actual_values.len()
                && expected_values.iter().zip(actual_values).all(
                    |(expected_value, actual_value)| same_deep_equal(expected_value, actual_value),
                )
        }
        (BVal::Map(expected_entries), BVal::Map(actual_entries)) => {
            expected_entries.len() == actual_entries.len()
                && expected_entries.iter().zip(actual_entries).all(
                    |((expected_key, expected_value), (actual_key, actual_value))| {
                        same_deep_equal(expected_key, actual_key)
                            && same_deep_equal(expected_value, actual_value)
                    },
                )
        }
        (BVal::U8(expected_bytes), BVal::U8(actual_bytes)) => expected_bytes == actual_bytes,
        (BVal::Num(expected_value), BVal::Num(actual_value)) => {
            expected_value.to_bits() == actual_value.to_bits()
                || (expected_value.is_nan() && actual_value.is_nan())
        }
        _ => expected.same(actual),
    }
}

fn object_key_set_difference(
    expected_entries: &[(String, BVal)],
    actual_entries: &[(String, BVal)],
    path: &str,
) -> Option<String> {
    let missing: Vec<&str> = expected_entries
        .iter()
        .filter(|(key, _)| {
            !actual_entries
                .iter()
                .any(|(actual_key, _)| actual_key == key)
        })
        .map(|(key, _)| key.as_str())
        .collect();
    let extra: Vec<&str> = actual_entries
        .iter()
        .filter(|(key, _)| {
            !expected_entries
                .iter()
                .any(|(expected_key, _)| expected_key == key)
        })
        .map(|(key, _)| key.as_str())
        .collect();
    if !missing.is_empty() || !extra.is_empty() {
        return Some(format!(
            "{path}: object key set expected {} keys actual {} keys (missing keys {:?}, extra keys {:?}; property order is not observable)",
            expected_entries.len(),
            actual_entries.len(),
            missing,
            extra,
        ));
    }
    for (key, expected_value) in expected_entries {
        let Some((_, actual_value)) = actual_entries
            .iter()
            .find(|(actual_key, _)| actual_key == key)
        else {
            return Some(format!("{path}: missing object key {key:?}"));
        };
        if !same_deep_equal(expected_value, actual_value) {
            return first_difference_deep_equal(
                expected_value,
                actual_value,
                &format!("{path}.{key}"),
            );
        }
    }
    None
}

fn ordered_deep_difference(
    expected_values: &[BVal],
    actual_values: &[BVal],
    path: &str,
    what: &str,
) -> Option<String> {
    if expected_values.len() != actual_values.len() {
        return Some(format!(
            "{path}: {what} length expected {} actual {}",
            expected_values.len(),
            actual_values.len()
        ));
    }
    for (index, (expected_value, actual_value)) in
        expected_values.iter().zip(actual_values).enumerate()
    {
        if !same_deep_equal(expected_value, actual_value) {
            return first_difference_deep_equal(
                expected_value,
                actual_value,
                &format!("{path}[{index}]"),
            );
        }
    }
    None
}

/// The first source `deepEqual` difference with a compact path to it; object/instance key misses are reported by key
/// set, values are reported in expected own-key order (never by the unobservable property order itself).
pub(crate) fn first_difference_deep_equal(
    expected: &BVal,
    actual: &BVal,
    path: &str,
) -> Option<String> {
    match (expected, actual) {
        (BVal::Obj(expected_entries), BVal::Obj(actual_entries)) => {
            object_key_set_difference(expected_entries, actual_entries, path)
        }
        (
            BVal::Instance {
                name: expected_name,
                entries: expected_entries,
            },
            BVal::Instance {
                name: actual_name,
                entries: actual_entries,
            },
        ) => {
            if expected_name != actual_name {
                return Some(format!(
                    "{path}: instance name expected {expected_name:?} actual {actual_name:?}"
                ));
            }
            object_key_set_difference(expected_entries, actual_entries, path)
        }
        (BVal::Arr(expected_values), BVal::Arr(actual_values)) => {
            ordered_deep_difference(expected_values, actual_values, path, "array")
        }
        (BVal::Set(expected_values), BVal::Set(actual_values)) => {
            ordered_deep_difference(expected_values, actual_values, path, "set")
        }
        (BVal::Map(expected_entries), BVal::Map(actual_entries)) => {
            if expected_entries.len() != actual_entries.len() {
                return Some(format!(
                    "{path}: map length expected {} actual {}",
                    expected_entries.len(),
                    actual_entries.len()
                ));
            }
            for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                expected_entries.iter().zip(actual_entries).enumerate()
            {
                if !same_deep_equal(expected_key, actual_key) {
                    return Some(format!(
                        "{path}: map key[{index}] expected {} actual {} (entry order matters)",
                        describe(expected_key),
                        describe(actual_key)
                    ));
                }
                if !same_deep_equal(expected_value, actual_value) {
                    return first_difference_deep_equal(
                        expected_value,
                        actual_value,
                        &format!("{path}[{index}]"),
                    );
                }
            }
            None
        }
        (BVal::U8(expected_bytes), BVal::U8(actual_bytes)) => {
            if expected_bytes.len() != actual_bytes.len() {
                return Some(format!(
                    "{path}: u8 length expected {} actual {}",
                    expected_bytes.len(),
                    actual_bytes.len()
                ));
            }
            expected_bytes
                .iter()
                .zip(actual_bytes)
                .enumerate()
                .find_map(|(index, (expected_byte, actual_byte))| {
                    (expected_byte != actual_byte).then(|| {
                        format!(
                            "{path}: u8 byte[{index}] expected {expected_byte} actual {actual_byte}"
                        )
                    })
                })
        }
        (BVal::Num(expected_value), BVal::Num(actual_value)) => (expected_value.to_bits()
            != actual_value.to_bits()
            && !(expected_value.is_nan() && actual_value.is_nan()))
        .then(|| {
            format!(
                "{path}: number expected {} actual {}",
                describe_number(*expected_value),
                describe_number(*actual_value)
            )
        }),
        _ => {
            if same_deep_equal(expected, actual) {
                None
            } else {
                Some(format!(
                    "{path}: expected {} actual {}",
                    describe(expected),
                    describe(actual)
                ))
            }
        }
    }
}

/// Compare one labeled value under the frozen source tool's `deepEqual` policy (ordered arrays/maps/sets, exact tagged
/// leaves, object/instance entries as a key set). Use this for expected-vs-actual *values*; row-array/transcript order
/// stays under [`compare_transcript`]. The first difference's path/value is pushed on failure.
pub(crate) fn compare_deep_equal(
    label: &str,
    expected: &BVal,
    actual: &BVal,
    failures: &mut Vec<String>,
) {
    if same_deep_equal(expected, actual) {
        return;
    }
    failures.push(
        first_difference_deep_equal(expected, actual, label).unwrap_or_else(|| {
            format!(
                "{label}: expected {} actual {}",
                describe(expected),
                describe(actual)
            )
        }),
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Unit tests: the frozen source record orders this file must reproduce (hand-built tiny source shapes, no corpus).

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::humanizer::HumanizerStats;
    use crate::bots::temporal_percept::brain::config::{BrainStats, ReleasedCommand, RunSummary};
    use crate::bots::temporal_percept::data::MethodValue;
    use crate::bots::temporal_percept::memory::{Memory, MemoryConfig, MemoryMap};
    use crate::bots::temporal_percept::strategy::types::{
        Goal, GoalDecision, GoalKind, GoalStatus,
    };
    use crate::bots::types::{
        Command, Intent, IntentBody, IntentKind, IntentTiming, PlanMsg, Stimulus, StimulusKind,
        TimedCommand,
    };
    use crate::bots::view::Features;
    use rh_sim::Vec2;

    fn keys(value: &BVal) -> Vec<&str> {
        value
            .as_obj()
            .expect("object record")
            .iter()
            .map(|(key, _)| key.as_str())
            .collect()
    }

    #[test]
    fn encode_features_and_goals_keep_source_key_order() {
        let features = Features {
            message_types: vec!["move".into(), "stop".into()],
            wishes: true,
            ..Features::default()
        };
        let encoded = encode_features(&features);
        assert_eq!(
            keys(&encoded),
            [
                "messageTypes",
                "wishes",
                "statusEffects",
                "fields",
                "planning",
                "chests",
                "skills",
                "relics",
                "camps",
                "hazards"
            ]
        );

        let farm = Goal::Farm {
            mob: "meal".into(),
            camp: Some("camp-a".into()),
        };
        let encoded = encode_goal(&farm);
        assert_eq!(keys(&encoded), ["kind", "mob", "camp"]);
        assert_eq!(
            encoded.get("camp").and_then(|value| value.as_str()),
            Some("camp-a")
        );

        let module = Goal::Module {
            module: "chests".into(),
            data: MethodValue::Obj(vec![("chest".into(), MethodValue::Str("box".into()))]),
        };
        let encoded = encode_goal(&module);
        assert_eq!(keys(&encoded), ["kind", "module", "data"]);
        assert_eq!(keys(encoded.get("data").unwrap()), ["chest"]);

        let status = GoalStatus::running("walking");
        assert_eq!(keys(&encode_goal_status(&status)), ["state", "why"]);

        let decision = GoalDecision {
            goal: Goal::Idle,
            utility: 0.5,
            why: "rest".into(),
            choice: Some("rest|fire".into()),
        };
        assert_eq!(
            keys(&encode_goal_decision(&decision)),
            ["goal", "utility", "why", "choice"]
        );
        let encoded = encode_goal_decision_list(&[decision]);
        assert_eq!(encoded.as_arr().unwrap().len(), 1);
    }

    #[test]
    fn encode_intent_keeps_source_literal_order() {
        let move_intent = Intent {
            body: IntentBody::Move {
                to: Vec2::new(1608., 1008.),
            },
            priority: 2,
            timing: IntentTiming::Step {},
            why: "approach".into(),
        };
        let encoded = encode_intent(&move_intent);
        assert_eq!(keys(&encoded), ["kind", "to", "priority", "timing", "why"]);
        assert_eq!(keys(encoded.get("to").unwrap()), ["x", "y"]);
        assert_eq!(keys(encoded.get("timing").unwrap()), ["kind"]);

        let cast = Intent {
            body: IntentBody::Cast {
                slot: "wish".into(),
                x: 3.,
                y: 4.,
                target: Some("foe".into()),
                at: Some(Vec2::new(5., 6.)),
                snap_radius: Some(56.),
            },
            priority: 0,
            timing: IntentTiming::Timed { due: 7. },
            why: "cast Swarm".into(),
        };
        let encoded = encode_intent(&cast);
        assert_eq!(
            keys(&encoded),
            [
                "kind",
                "slot",
                "x",
                "y",
                "target",
                "at",
                "snapRadius",
                "priority",
                "timing",
                "why"
            ]
        );
        assert_eq!(keys(encoded.get("timing").unwrap()), ["kind", "due"]);

        let plan = Intent {
            body: IntentBody::Plan {
                msg: PlanMsg {
                    spawn: None,
                    boon: Some(1),
                    ready: None,
                },
            },
            priority: 2,
            timing: IntentTiming::Step {},
            why: "boon haste".into(),
        };
        let encoded = encode_intent(&plan);
        assert_eq!(keys(&encoded), ["kind", "msg", "priority", "timing", "why"]);
        assert_eq!(keys(encoded.get("msg").unwrap()), ["boon"]);
    }

    #[test]
    fn encode_command_and_released_command_keep_source_shape() {
        let plain_move = Command::Move { x: 3., y: 4. };
        let encoded = encode_command(&plain_move);
        assert_eq!(keys(&encoded), ["type", "msg"]);
        assert_eq!(keys(encoded.get("msg").unwrap()), ["x", "y"]);

        let stop = Command::Stop {};
        assert_eq!(
            keys(encode_command_with_seq(&stop, Some(1.)).get("msg").unwrap()),
            ["seq"]
        );

        let cast = Command::Cast {
            slot: "wish".into(),
            x: 5.,
            y: 6.,
            id: Some("foe".into()),
        };
        assert_eq!(
            keys(encode_command(&cast).get("msg").unwrap()),
            ["slot", "x", "y", "id"]
        );

        let choose = Command::Choose {
            chest: "box".into(),
            pick: 0,
            replace: None,
        };
        assert_eq!(
            keys(encode_command(&choose).get("msg").unwrap()),
            ["chest", "pick"]
        );

        let released = ReleasedCommand {
            at: 1002.5,
            cmd: Command::Move { x: 1., y: 2. },
            intent: IntentKind::Move,
            priority: 2,
            stimulus: Some(Stimulus {
                kind: StimulusKind::HpLoss,
                at: 1000.,
                subject: Some("foe".into()),
                central: true,
                value: Some(90.),
            }),
            seq: Some(255.),
        };
        let encoded = encode_released_command(&released);
        assert_eq!(
            keys(&encoded),
            ["at", "cmd", "intent", "priority", "stimulus"]
        );
        assert_eq!(
            keys(encoded.get("cmd").unwrap().get("msg").unwrap()),
            ["x", "y", "seq"]
        );
        assert_eq!(
            keys(encoded.get("stimulus").unwrap()),
            ["kind", "at", "subject", "central", "value"]
        );

        let timed = TimedCommand {
            at: 5.,
            cmd: Command::Stop {},
            intent: IntentKind::Stop,
            priority: 3,
            stimulus: None,
        };
        let encoded = encode_timed_command(&timed);
        assert_eq!(
            keys(&encoded),
            ["at", "cmd", "intent", "priority", "stimulus"]
        );
        assert!(matches!(encoded.get("stimulus"), Some(BVal::Null)));
    }

    #[test]
    fn encode_memory_snapshot_empty_memory_has_source_shape() {
        let memory = Memory::new(MemoryConfig {
            self_id: "me".into(),
            tier: &crate::bots::types::TIERS[2],
            map: MemoryMap { camps: Vec::new() },
            features: Features::default(),
        })
        .expect("empty memory constructs");
        let snapshot = encode_memory_snapshot(&memory, &[]);
        assert_eq!(
            keys(&snapshot),
            [
                "fighters",
                "mobs",
                "camps",
                "containers",
                "self",
                "stimuli",
                "bounties",
                "choices"
            ]
        );
        let self_record = snapshot.get("self").unwrap();
        assert_eq!(
            keys(self_record),
            [
                "lastHitAt",
                "lastHitByPlayerAt",
                "lastDealtAt",
                "recentDamage",
                "recentHits",
                "teleportedAt",
                "lastOrder",
                "lastCast",
                "stillSince"
            ]
        );
        assert!(matches!(self_record.get("lastOrder"), Some(BVal::Null)));
        assert!(matches!(snapshot.get("fighters"), Some(BVal::Map(rows)) if rows.is_empty()));
        assert!(matches!(snapshot.get("bounties"), Some(BVal::Map(rows)) if rows.is_empty()));
        assert!(matches!(snapshot.get("stimuli"), Some(BVal::Arr(rows)) if rows.is_empty()));

        // The passed tick overlay list owns the `stimuli` field, not the Memory's retained list.
        let stimulus = Stimulus {
            kind: StimulusKind::ChestUp,
            at: 100500.,
            subject: Some("box".into()),
            central: true,
            value: None,
        };
        let snapshot = encode_memory_snapshot(&memory, std::slice::from_ref(&stimulus));
        let stimuli = snapshot.get("stimuli").unwrap().as_arr().unwrap();
        assert_eq!(stimuli.len(), 1);
        assert_eq!(keys(&stimuli[0]), ["kind", "at", "subject", "central"]);

        // The API-flavoured snapshot shares the exact encoder.
        let via_api = encode_memory_snapshot_api(&memory, &[]);
        assert!(same(&via_api, &encode_memory_snapshot(&memory, &[])));
    }

    #[test]
    fn caller_observe_and_retained_rows_keep_source_order() {
        let recorder = Recorder::new();
        caller_path_budget(&recorder, "same", 8);
        caller_path_service(&recorder, "same", "same", "open");
        caller_enabled_modules(&recorder, &Features::default(), &["observer", "chests"]);
        caller_create_brain(&recorder, "a", "a");
        observe_row(&recorder, "a", 1, false, 2, &[3, 4], true, BVal::Null);
        retained_memory_row(&recorder, "a", BVal::Null);

        let events = recorder.events();
        let events = events.as_arr().unwrap();
        assert_eq!(events.len(), 6);
        assert_eq!(
            keys(&events[0]),
            ["kind", "name", "handle", "perTick", "sequence"]
        );
        assert_eq!(
            keys(&events[1]),
            ["kind", "name", "handle", "budget", "map", "sequence"]
        );
        assert_eq!(
            keys(&events[2]),
            ["kind", "name", "features", "handles", "sequence"]
        );
        assert_eq!(
            keys(&events[3]),
            ["kind", "name", "cfg", "handle", "sequence"]
        );
        assert_eq!(
            keys(&events[4]),
            [
                "kind",
                "actor",
                "cfgIdentity",
                "originalCfg",
                "rngIdentity",
                "moduleIdentities",
                "engaged",
                "memory",
                "sequence"
            ]
        );
        assert_eq!(keys(&events[5]), ["kind", "actor", "lastHitAt", "sequence"]);
        assert_eq!(
            events[4].get("sequence").and_then(|value| value.as_num()),
            Some(4.)
        );
    }

    #[test]
    fn callback_builtin_and_module_rows_keep_runner_assignment_order() {
        let recorder = Recorder::new();
        let slot = begin_callback(
            &recorder,
            "a",
            "paths.setFrame",
            vec![BVal::num(1000.), BVal::flag(false)],
            vec![("service", BVal::text("same"))],
        );
        finish_callback(&recorder, slot, BVal::Undefined);

        let slot = builtin_row_begin(
            &recorder,
            "a",
            "chests",
            "adjust",
            vec![BVal::Null, empty_args()],
            Some(builtin_context(
                &BVal::Null,
                BVal::Null,
                true,
                1,
                false,
                2,
                3,
            )),
        );
        builtin_row_adjusted(&recorder, slot, empty_args(), true);

        let index = recorder.next_hook_index("a", "x", "adjust");
        assert_eq!(index, 0);
        assert_eq!(recorder.next_hook_index("a", "x", "adjust"), 1);
        assert_eq!(recorder.next_hook_index("a", "x", "observe"), 0);
        let slot = module_row_begin(
            &recorder,
            "a",
            "x",
            "extension",
            "adjust",
            index,
            vec![BVal::Null, empty_args()],
            Some(module_context(1000., true, 7)),
        );
        module_row_adjusted(&recorder, slot, 5, false, 6, empty_args());

        let slot = builtin_row_begin(
            &recorder,
            "a",
            "chests",
            "act",
            Vec::new(),
            Some(builtin_context(
                &BVal::Null,
                BVal::Null,
                true,
                1,
                false,
                2,
                3,
            )),
        );
        builtin_row_error(&recorder, slot, "Error", "declared chests act 0");

        let slot = module_row_begin(
            &recorder,
            "a",
            "x",
            "extension",
            "goals",
            0,
            Vec::new(),
            Some(module_context(1000., true, 7)),
        );
        module_row_error(&recorder, slot, "declared x goals 0");

        let events = recorder.events();
        let events = events.as_arr().unwrap();
        assert_eq!(events.len(), 5);
        assert_eq!(
            keys(&events[0]),
            ["kind", "actor", "name", "args", "service", "sequence", "result"]
        );
        assert_eq!(
            keys(&events[1]),
            [
                "kind",
                "actor",
                "handle",
                "hook",
                "args",
                "context",
                "sequence",
                "result",
                "returnedInput"
            ]
        );
        assert_eq!(
            keys(events[1].get("context").unwrap()),
            [
                "cfgIdentity",
                "originalCfg",
                "percept",
                "memory",
                "engaged",
                "rngIdentity",
                "knowledgeIdentity"
            ]
        );
        assert_eq!(
            keys(&events[2]),
            [
                "kind",
                "actor",
                "handle",
                "id",
                "hook",
                "index",
                "args",
                "now",
                "engaged",
                "cfgIdentity",
                "sequence",
                "listIdentity",
                "returnedInput",
                "resultIdentity",
                "result"
            ]
        );
        assert_eq!(
            keys(&events[3]),
            ["kind", "actor", "handle", "hook", "args", "context", "sequence", "error"]
        );
        let error = events[3].get("error").expect("builtin error object");
        assert_eq!(keys(error), ["name", "message"]);
        assert_eq!(
            events[4].get("error").and_then(|value| value.as_str()),
            Some("declared x goals 0"),
            "module errors are plain strings"
        );
    }

    #[test]
    fn encode_brain_stats_and_run_summary_keep_source_order() {
        let stats = BrainStats {
            humanizer: HumanizerStats::default(),
            mob_targets: 0.,
            mob_drops: 0.,
            retreats: 0.,
            mob_focus_ms: 0.,
            grabs: 0,
            max_stall_ms: 0.,
            dodges: 0,
            jukes: 0,
            kite_cycles: 0,
            goals: vec![(GoalKind::Module, 1)],
            build: String::new(),
            route_contests: 0,
        };
        let encoded = encode_brain_stats(&stats);
        assert_eq!(
            keys(&encoded),
            [
                "commands",
                "reactions",
                "targetClicks",
                "clickMissed",
                "clickWrong",
                "hesitations",
                "lapses",
                "throttled",
                "superseded",
                "apmPeak",
                "mobTargets",
                "mobDrops",
                "retreats",
                "mobFocusMs",
                "grabs",
                "maxStallMs",
                "dodges",
                "jukes",
                "kiteCycles",
                "goals",
                "build",
                "routeContests"
            ]
        );
        assert_eq!(
            keys(encoded.get("commands").unwrap()),
            [
                "move", "stop", "target", "attack", "release", "swap", "pickup", "cast", "plan",
                "choose"
            ]
        );
        assert_eq!(keys(encoded.get("goals").unwrap()), ["module"]);

        let summary = RunSummary {
            tier: "hard".into(),
            persona: "cautious".into(),
            faction: None,
            outcome: "void".into(),
            place: 0.,
            players: 0.,
            choices: Vec::new(),
        };
        assert_eq!(
            keys(&encode_run_summary(&summary)),
            ["tier", "persona", "faction", "outcome", "place", "players", "choices"]
        );
    }

    #[test]
    fn comparison_reports_first_difference_path_and_exact_bits() {
        let expected = BVal::obj([
            ("goal", BVal::obj([("kind", BVal::text("idle"))])),
            ("count", BVal::num(1.)),
        ]);
        assert!(same(&expected, &expected.clone()));
        let different = BVal::obj([
            ("goal", BVal::obj([("kind", BVal::text("idle"))])),
            ("count", BVal::num(1. + f64::EPSILON)),
        ]);
        let difference = first_difference(&expected, &different, "stats").expect("difference");
        assert!(difference.contains("stats.count"), "{difference}");
        assert!(difference.contains("bits=0x"), "{difference}");

        let reordered = BVal::obj([
            ("count", BVal::num(1.)),
            ("goal", BVal::obj([("kind", BVal::text("idle"))])),
        ]);
        let difference = first_difference(&expected, &reordered, "stats").expect("key difference");
        assert!(difference.contains("object key[0]"), "{difference}");

        let mut failures = Vec::new();
        compare("stats", &expected, &different, &mut failures);
        assert_eq!(failures.len(), 1);
    }

    #[test]
    fn compare_transcript_reports_event_count_and_first_mismatch_index() {
        let recorder = Recorder::new();
        record_callback(
            &recorder,
            "a",
            "services.log",
            vec![BVal::text("hello")],
            BVal::Undefined,
        );
        let expected = BVal::arr([BVal::obj([
            ("kind", BVal::text("callback")),
            ("actor", BVal::text("a")),
            ("name", BVal::text("services.log")),
            ("args", BVal::arr([BVal::text("hello")])),
            ("sequence", BVal::num(0.)),
            ("result", BVal::Undefined),
        ])]);
        let mut failures = Vec::new();
        compare_transcript("core", &expected, &recorder, &mut failures);
        assert!(failures.is_empty(), "{failures:?}");

        let mut bad_event = expected.as_arr().unwrap()[0].clone();
        if let BVal::Obj(fields) = &mut bad_event {
            let result = fields
                .iter_mut()
                .find(|(key, _)| key == "result")
                .expect("expected event result");
            result.1 = BVal::Null;
        }
        let bad = BVal::arr([bad_event]);
        compare_transcript("core", &bad, &recorder, &mut failures);
        assert!(failures[0].contains("core trace[0]"), "{failures:?}");

        failures.clear();
        compare_transcript("core", &BVal::Arr(Vec::new()), &recorder, &mut failures);
        assert!(
            failures[0].contains("expected 0 events actual 1"),
            "{failures:?}"
        );
    }

    #[test]
    fn replace_instance_restarts_observer_state_but_keeps_identities() {
        let recorder = Recorder::new();
        recorder.activate("a");
        recorder.rng("a", 1, 0.25);
        recorder.rng("a", 2, 0.5);
        assert_eq!(recorder.counts("a"), [0, 1, 1]);
        let rng_identity = recorder.identity(IdentityKey::Rng(1));
        assert_eq!(recorder.next_hook_index("a", "x", "observe"), 0);
        assert_eq!(recorder.next_hook_index("a", "x", "observe"), 1);
        let events_before = recorder.events_len();

        recorder.replace_instance("a");
        assert!(!recorder.is_active("a"));
        assert_eq!(recorder.counts("a"), [0, 0, 0]);
        assert_eq!(
            recorder.identity(IdentityKey::Rng(1)),
            rng_identity,
            "the case identity table survives a recreate"
        );
        assert_eq!(
            recorder.next_hook_index("a", "x", "observe"),
            2,
            "hook call counters survive a recreate"
        );
        assert_eq!(recorder.events_len(), events_before);

        recorder.activate("a");
        recorder.rng("a", 1, 0.25);
        assert_eq!(recorder.counts("a"), [0, 1, 0], "lane ordinals restart");
    }

    #[test]
    fn deep_equal_treats_object_property_order_as_unobservable() {
        let expected = BVal::obj([
            ("id", BVal::text("meal")),
            ("kind", BVal::text("mob")),
            (
                "pos",
                BVal::obj([("x", BVal::num(1.)), ("y", BVal::num(2.))]),
            ),
            ("tags", BVal::arr([BVal::text("a"), BVal::text("b")])),
        ]);
        let reordered = BVal::obj([
            ("tags", BVal::arr([BVal::text("a"), BVal::text("b")])),
            (
                "pos",
                BVal::obj([("y", BVal::num(2.)), ("x", BVal::num(1.))]),
            ),
            ("kind", BVal::text("mob")),
            ("id", BVal::text("meal")),
        ]);
        assert!(same_deep_equal(&expected, &reordered));
        assert!(
            !same(&expected, &reordered),
            "strict comparator keeps order"
        );

        // Arrays and maps stay ordered.
        let array_different = BVal::obj([
            ("id", BVal::text("meal")),
            ("kind", BVal::text("mob")),
            (
                "pos",
                BVal::obj([("x", BVal::num(1.)), ("y", BVal::num(2.))]),
            ),
            ("tags", BVal::arr([BVal::text("b"), BVal::text("a")])),
        ]);
        assert!(!same_deep_equal(&expected, &array_different));
        let map_a = BVal::Map(vec![
            (BVal::text("a"), BVal::num(1.)),
            (BVal::text("b"), BVal::num(2.)),
        ]);
        let map_b = BVal::Map(vec![
            (BVal::text("b"), BVal::num(2.)),
            (BVal::text("a"), BVal::num(1.)),
        ]);
        assert!(!same_deep_equal(&map_a, &map_b));

        // Tagged leaves stay exact: -0 distinct, NaN==NaN, key sets must match.
        assert!(!same_deep_equal(&BVal::num(0.), &BVal::num(-0.)));
        assert!(same_deep_equal(&BVal::num(f64::NAN), &BVal::num(f64::NAN)));
        let missing = BVal::obj([
            ("id", BVal::text("meal")),
            ("kind", BVal::text("mob")),
            (
                "pos",
                BVal::obj([("x", BVal::num(1.)), ("y", BVal::num(2.))]),
            ),
        ]);
        let mut failures = Vec::new();
        compare_deep_equal("memory.mobs[0]", &expected, &missing, &mut failures);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("missing keys"), "{failures:?}");
        assert!(failures[0].contains("memory.mobs[0]"), "{failures:?}");

        let changed = BVal::obj([
            ("id", BVal::text("meal")),
            ("kind", BVal::text("elite")),
            (
                "pos",
                BVal::obj([("x", BVal::num(1.)), ("y", BVal::num(2.))]),
            ),
            ("tags", BVal::arr([BVal::text("a"), BVal::text("b")])),
        ]);
        failures.clear();
        compare_deep_equal("memory.mobs[0]", &expected, &changed, &mut failures);
        assert!(failures[0].contains("memory.mobs[0].kind"), "{failures:?}");
    }

    #[test]
    fn deep_equal_instance_name_and_key_set_stay_exact() {
        let expected = BVal::Instance {
            name: "Mob".into(),
            entries: vec![
                ("id".into(), BVal::text("meal")),
                ("alive".into(), BVal::flag(true)),
            ],
        };
        let reordered = BVal::Instance {
            name: "Mob".into(),
            entries: vec![
                ("alive".into(), BVal::flag(true)),
                ("id".into(), BVal::text("meal")),
            ],
        };
        assert!(same_deep_equal(&expected, &reordered));
        let renamed = BVal::Instance {
            name: "Fighter".into(),
            entries: vec![
                ("id".into(), BVal::text("meal")),
                ("alive".into(), BVal::flag(true)),
            ],
        };
        assert!(!same_deep_equal(&expected, &renamed));
        let mut failures = Vec::new();
        compare_deep_equal("state", &expected, &renamed, &mut failures);
        assert!(failures[0].contains("instance name"), "{failures:?}");
    }
}
