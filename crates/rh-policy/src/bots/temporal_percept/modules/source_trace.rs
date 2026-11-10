//! Source-exact encode/compare/diagnostic half of the frozen private-modules replay (`rh-method-value/1`).
//!
//! Test-only. The native module layer, Memory, ChestHunter and registry run against the real admitted leaves; this file
//! only turns their retained native state, intents, goals, service-callback arguments/results and RNG draws into the
//! *exact* tagged `rh-method-value/1` shape the frozen source corpus records, and compares expected against actual with
//! binary64 bit equality, tag identity (`Undefined` vs `null` vs absent), ordered source own-property order and ordered
//! maps/sets/arrays. NaN is the codec's one sentinel tag (`{"$":"number","value":"NaN"}`): its payload is not
//! representable, so any NaN equals any NaN; every finite value (including `-0`) and `+/-Infinity` stays bit-exact.
//! No tolerance is approved here: the first raw difference and its path are reported, never relaxed.
//!
//! Provenance (patterns copied, not imported — both admitted sources are `#[cfg(test)]` private to their own modules):
//! - Encoded/`ordered_same`/`first_difference`/`TraceLog`/`TraceRng` structure adapted from the admitted private-strategy
//!   trace layer `temporal_percept/strategy/source_trace.rs` (in this checkout), with two module-corpus additions: every
//!   transcript event owns the source runner's `cfg` field, and callbacks may be opened before their result is computed
//!   so that a nested declared callback keeps the runner's `sequence` order.
//! - `encode_memory_snapshot` is a field-for-field copy of the admitted `encode_memory` in
//!   `temporal_percept/strategy/source_tests.rs` (which mirrors `codec.mts::memorySnapshot` and the source `memory.ts`
//!   `MemoryView` own-key order). The section/field order is pinned by the frozen modules corpus
//!   (`parity/policy/bot-private-modules/source.json`), never by the native struct field order.
//! - Intent/timing/stimulus/feature/goal key order is pinned by the legacy literals
//!   (`packages/server/src/bots/brain/types.ts`, `tactics/fight.ts`, `modules/{wishes,planning,chests,hazards}.ts`) and
//!   re-checked against the corpus rows.
//!
//! Rules honoured here: encoding never mutates native state, never reads the corpus, never fabricates an actor identity,
//! never consumes RNG (only the caller's trace wrapper does), and never installs expected values as native inputs.

use std::cell::RefCell;
use std::rc::Rc;

use super::super::data::MethodValue;
use super::super::memory::{ContainersWeapon, Memory};
use super::super::strategy::types::{Goal, GoalDecision, GoalState, GoalStatus, RngStream};
use super::chest_hunt::{ChestHuntConfig, ChestHuntStats};
use super::registry::EnabledModule;
use super::source_reader;
use super::types::ModuleOutput;
use crate::bots::paths::{PathStats, WalkAnswer};
use crate::bots::random::Rng;
use crate::bots::types::{ChooseMsg, Intent, IntentBody, IntentTiming, PlanMsg, Stimulus};
use crate::bots::view::Features;
use rh_sim::Vec2;

// ---------------------------------------------------------------------------------------------------------------------
// Tagged value constructors (thin aliases over the pinned source_reader codec)

pub(crate) fn n(value: f64) -> SVal {
    source_reader::n(value)
}
pub(crate) fn s(value: &str) -> SVal {
    source_reader::s(value)
}
pub(crate) fn b(value: bool) -> SVal {
    source_reader::b(value)
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

/// Exact source equality for one tagged value (its leaves); re-exported so the replay harness has one canonical leaf
/// comparator. Object/instance/map order is checked by [`ordered_same`], not here (the source codec's `same` is keyed).
pub(crate) use super::source_reader::{same, SVal};

/// A source `Option<T>` leaf: absent is source `null` in every place the modules corpus records one (the source literals
/// always own the key; there is no `undefined`-vs-absent short cut here unless the caller encodes `undefined()` itself).
pub(crate) fn encode_opt<T>(value: Option<&T>, encode: impl FnOnce(&T) -> SVal) -> SVal {
    value.map_or_else(null, encode)
}

/// A source Map key / id string. Kept explicit so the replay harness spells the same helper at every map-key site.
pub(crate) fn encode_map_id(id: &str) -> SVal {
    s(id)
}

fn opt_string(value: Option<&str>) -> SVal {
    value.map(s).unwrap_or_else(null)
}

/// Source `{ x, y }` vector (the intermediate, non-finite blind read is the admitted `Vec2`).
pub(crate) fn encode_vec2(v: Vec2) -> SVal {
    obj(vec![("x", n(v.x)), ("y", n(v.y))])
}

/// A declared/source `Map<string, V>` record in insertion order.
pub(crate) fn encode_string_map<V>(entries: &[(String, V)], encode: impl Fn(&V) -> SVal) -> SVal {
    map(entries
        .iter()
        .map(|(key, value)| (s(key), encode(value)))
        .collect())
}

pub(crate) fn encode_string_set(ids: &[String]) -> SVal {
    SVal::Set(ids.iter().map(|id| s(id)).collect())
}

/// Source `Map<string, number>` (bounties, excluded clocks, ...).
fn string_number_map(entries: &[(String, f64)]) -> SVal {
    encode_string_map(entries, |value| n(*value))
}

/// The complete declared `MethodValue` record (`goal.data`, `lastOrder`/`lastCast` raw commands, callback arguments).
pub(crate) fn encode_method_value(value: &MethodValue) -> SVal {
    match value {
        MethodValue::Undefined => undefined(),
        MethodValue::Null => null(),
        MethodValue::Bool(value) => b(*value),
        MethodValue::Num(value) => n(*value),
        MethodValue::Str(value) => s(value),
        MethodValue::Arr(values) => arr(values.iter().map(encode_method_value).collect()),
        MethodValue::Obj(entries) => SVal::Obj(
            entries
                .iter()
                .map(|(key, value)| (key.clone(), encode_method_value(value)))
                .collect(),
        ),
    }
}

/// The source `WalkAnswer` record the declared `paths.walk` callback returns (`{ dist, exact }`).
pub(crate) fn encode_walk_answer(answer: &WalkAnswer) -> SVal {
    obj(vec![("dist", n(answer.dist)), ("exact", b(answer.exact))])
}

// ---------------------------------------------------------------------------------------------------------------------
// Ordered callback/RNG transcript
//
// The source runner (`tools/bot-private-modules-fixtures/runner.mts`) builds one array per operation, shared by declared
// callbacks and the four RNG lanes. A callback event is pushed *before* its native body runs and its `result` is filled
// afterwards, so a callback that itself calls another declared service gets the parent's lower `sequence`. The trace log
// models exactly that: `begin_callback`/`finish_callback` (`record_callback_with` for the common case) plus the leaf
// `record_callback` for recorders whose body cannot nest.

#[derive(Default)]
pub(crate) struct TraceLog {
    entries: Vec<SVal>,
}

pub(crate) type TraceHandle = Rc<RefCell<TraceLog>>;

impl TraceLog {
    pub(crate) fn new_handle() -> TraceHandle {
        Rc::new(RefCell::new(Self::default()))
    }

    /// Forget every event (the runner resets the transcript before each operation).
    pub(crate) fn reset(&mut self) {
        self.entries.clear();
    }

    /// Open a callback event with the source runner's own-key order `sequence, kind, cfg, name, args, result` and return
    /// its slot so the caller can fill `result` after the native body returned (nested callbacks then append after it).
    pub(crate) fn begin_callback(&mut self, cfg: &str, name: &str, args: &[SVal]) -> usize {
        let sequence = self.entries.len();
        self.entries.push(obj(vec![
            ("sequence", n(sequence as f64)),
            ("kind", s("callback")),
            ("cfg", s(cfg)),
            ("name", s(name)),
            ("args", arr(args.to_vec())),
            ("result", undefined()),
        ]));
        sequence
    }

    /// Fill the `result` of an event opened by [`TraceLog::begin_callback`] (no-op on an unknown slot).
    pub(crate) fn finish_callback(&mut self, slot: usize, result: SVal) {
        if let Some(SVal::Obj(fields)) = self.entries.get_mut(slot) {
            if let Some((_, value)) = fields.iter_mut().find(|(key, _)| key == "result") {
                *value = result;
            }
        }
    }

    /// Record one declared callback whose native body cannot re-enter the trace (all corpus service callbacks except the
    /// nested `hunter.walk -> paths.walk` pair; use [`record_callback_with`] whenever nesting is possible).
    pub(crate) fn record_callback(&mut self, cfg: &str, name: &str, args: &[SVal], result: SVal) {
        let slot = self.begin_callback(cfg, name, args);
        self.finish_callback(slot, result);
    }

    /// Record one RNG draw. `index` is the source per-stream ordinal the runner records (0-based, increasing per lane).
    pub(crate) fn record_rng(&mut self, cfg: &str, stream: &str, index: u64, value: f64) {
        let sequence = self.entries.len();
        self.entries.push(obj(vec![
            ("sequence", n(sequence as f64)),
            ("kind", s("rng")),
            ("cfg", s(cfg)),
            ("stream", s(stream)),
            ("index", n(index as f64)),
            ("value", n(value)),
        ]));
    }

    /// The transcript as the source corpus owns it: a tagged array of the events in append order.
    pub(crate) fn sequence(&self) -> SVal {
        arr(self.entries.clone())
    }
}

/// Free-function form of [`TraceLog::record_callback`] for code that holds only the handle.
pub(crate) fn record_callback(
    trace: &TraceHandle,
    cfg: &str,
    name: &str,
    args: &[SVal],
    result: SVal,
) {
    trace.borrow_mut().record_callback(cfg, name, args, result);
}

/// Record a declared callback exactly like the source runner: push the event (so its `sequence` is the current length),
/// run `compute` (which may record nested declared callbacks), then fill the result. Returns the native result.
pub(crate) fn record_callback_with(
    trace: &TraceHandle,
    cfg: &str,
    name: &str,
    args: &[SVal],
    compute: impl FnOnce() -> SVal,
) -> SVal {
    let slot = trace.borrow_mut().begin_callback(cfg, name, args);
    let result = compute();
    trace.borrow_mut().finish_callback(slot, result.clone());
    result
}

/// Free-function form of [`TraceLog::record_rng`].
pub(crate) fn record_rng(trace: &TraceHandle, cfg: &str, stream: &str, index: u64, value: f64) {
    trace.borrow_mut().record_rng(cfg, stream, index, value);
}

/// A declared draw value supplied by the corpus instead of the admitted stream (the source runner's override path: the
/// fallback stream is not advanced and the recorded ordinal still increases). Not used by this corpus.
pub(crate) fn record_external_draw(
    trace: &TraceHandle,
    cfg: &str,
    stream: &str,
    index: u64,
    value: f64,
) {
    trace.borrow_mut().record_rng(cfg, stream, index, value);
}

/// One source-compatible draw stream (the `RngStream` the module context expects) that records every drawn binary64
/// value with its `cfg` identity, stream name and per-stream ordinal, in the one shared ordered transcript.
pub(crate) struct TraceRng {
    rng: Rng,
    cfg: String,
    stream: &'static str,
    index: u64,
    trace: TraceHandle,
}

impl TraceRng {
    pub(crate) fn new(seed: u32, cfg: &str, stream: &'static str, trace: &TraceHandle) -> Self {
        Self {
            rng: Rng::new(seed),
            cfg: cfg.to_string(),
            stream,
            index: 0,
            trace: trace.clone(),
        }
    }

    pub(crate) fn draws(&self) -> u64 {
        self.index
    }

    /// The declared-value path: record `value` as this stream's next draw without consuming the admitted stream (the
    /// source override semantics). The corpus declares no overrides; kept as the small, honest hook for a future case.
    pub(crate) fn declared(&mut self, value: f64) -> f64 {
        self.trace
            .borrow_mut()
            .record_rng(&self.cfg, self.stream, self.index, value);
        self.index += 1;
        value
    }
}

impl RngStream for TraceRng {
    fn draw(&mut self) -> f64 {
        let value = self.rng.next_f64();
        record_rng(&self.trace, &self.cfg, self.stream, self.index, value);
        self.index += 1;
        value
    }
}

/// The declared per-cfg `services.log` callback shape (`services.log(message) -> undefined`).
pub(crate) fn services_log(trace: &TraceHandle, cfg: &str, message: &str) {
    record_callback(trace, cfg, "services.log", &[s(message)], undefined());
}

/// The source `ChestHunter` log callback shape (`cfg "$hunter"`, `hunter.log(message) -> undefined`).
pub(crate) fn record_hunter_log(trace: &TraceHandle, message: &str) {
    record_callback(trace, "$hunter", "hunter.log", &[s(message)], undefined());
}

/// The declared `learned` callback surface as a source-compatible [`super::types::LearnedBiasFn`] that records every
/// `bias(key)` call with its raw returned binary64 (the corpus deliberately returns +/-Infinity/NaN: the callback result
/// is recorded before the module's own `Number.isFinite` sanitise). `enabled` is a plain declared flag, never a callback.
pub(crate) struct RecordedLearned {
    pub(crate) enabled: bool,
    pub(crate) entries: Vec<(String, f64)>,
    pub(crate) cfg: String,
    pub(crate) trace: TraceHandle,
}

impl RecordedLearned {
    pub(crate) fn new(
        enabled: bool,
        entries: Vec<(String, f64)>,
        cfg: &str,
        trace: &TraceHandle,
    ) -> Self {
        Self {
            enabled,
            entries,
            cfg: cfg.to_string(),
            trace: trace.clone(),
        }
    }
}

impl super::types::LearnedBiasFn for RecordedLearned {
    fn enabled(&self) -> bool {
        self.enabled
    }

    fn bias(&self, key: &str) -> f64 {
        // Source runner: `(env.learned ?? cfg.learned.entries).find(([id]) => id === key)`, absent -> 0.
        let value = self
            .entries
            .iter()
            .find(|(id, _)| id == key)
            .map_or(0., |(_, value)| *value);
        record_callback(&self.trace, &self.cfg, "learned.bias", &[s(key)], n(value));
        value
    }
}

/// The per-cfg declared `services.log(message)` closure the module context takes (`ModuleContext.log`).
pub(crate) fn module_log(trace: &TraceHandle, cfg: &str) -> impl Fn(&str) + 'static {
    let trace = trace.clone();
    let cfg = cfg.to_string();
    move |message: &str| services_log(&trace, &cfg, message)
}

/// The `ChestHunter` log closure (`hunter.log`, cfg `"$hunter"`), as the source hunt constructor receives it.
pub(crate) fn hunter_log(trace: &TraceHandle) -> impl FnMut(&str) + 'static {
    let trace = trace.clone();
    move |message: &str| record_hunter_log(&trace, message)
}

/// A declared source row passed through unchanged: declared callback arguments (percept `self` record already retained
/// as `ModuleSelf.record`, declared chest rows, declared map objects) are the *same* source objects the runner cloned,
/// so re-encoding must preserve their own-key order exactly rather than rebuild from a narrowed native struct.
pub(crate) fn encode_declared_record(raw: &SVal) -> SVal {
    raw.clone()
}

// ---------------------------------------------------------------------------------------------------------------------
// Source Memory view snapshot (codec.mts memorySnapshot: {fighters,mobs,camps,containers,self,stimuli,bounties,choices})

pub(crate) fn encode_memory_snapshot(mem: &Memory) -> SVal {
    use super::super::memory::MemoryView as View;
    let View {
        fighters,
        mobs,
        camps,
        containers,
        self_memory,
        stimuli,
        bounties,
        choices,
    } = mem.view();
    // ADAPTED FROM strategy/source_tests.rs encode_memory; the native field order is NOT used — every nested record is
    // written in the source literal's own-key order the frozen corpus pins.
    let fighters = map(fighters
        .iter()
        .map(|(id, f)| {
            (
                s(id),
                obj(vec![
                    ("id", s(&f.id)),
                    ("name", s(&f.name)),
                    ("bot", b(f.bot)),
                    (
                        "faction",
                        f.faction.map(|v| s(v.as_str())).unwrap_or_else(null),
                    ),
                    (
                        "weaponsSeen",
                        arr(f.weapons_seen.iter().map(|w| s(w.as_str())).collect()),
                    ),
                    (
                        "inHand",
                        f.in_hand.map(|w| s(w.as_str())).unwrap_or_else(null),
                    ),
                    (
                        "otherSlot",
                        f.other_slot.map(|w| s(w.as_str())).unwrap_or_else(null),
                    ),
                    ("seenAt", n(f.seen_at)),
                    ("pos", encode_vec2(f.pos)),
                    ("vel", encode_vec2(f.vel)),
                    ("hpFrac", n(f.hp_frac)),
                    ("bounty", n(f.bounty)),
                    ("alive", b(f.alive)),
                    ("diedAt", encode_opt(f.died_at.as_ref(), |v| n(*v))),
                    ("hitMeAt", encode_opt(f.hit_me_at.as_ref(), |v| n(*v))),
                    ("hitByMeAt", encode_opt(f.hit_by_me_at.as_ref(), |v| n(*v))),
                    ("damageToMe", n(f.damage_to_me)),
                    ("damageByMe", n(f.damage_by_me)),
                    ("engagedWith", opt_string(f.engaged_with.as_deref())),
                    ("engagedAt", encode_opt(f.engaged_at.as_ref(), |v| n(*v))),
                    ("chasingMe", b(f.chasing_me)),
                    ("wishSeenAt", encode_opt(f.wish_seen_at.as_ref(), |v| n(*v))),
                    (
                        "wishReadyGuess",
                        encode_opt(f.wish_ready_guess.as_ref(), |v| n(*v)),
                    ),
                    ("feints", n(f.feints as f64)),
                    (
                        "lastFeintAt",
                        encode_opt(f.last_feint_at.as_ref(), |v| n(*v)),
                    ),
                ]),
            )
        })
        .collect());
    let mobs = map(mobs
        .iter()
        .map(|(id, m)| {
            // Source creation order: {id,kind,faction,(name when the record has one),home,campId,pos,dotAt,seenAt,
            // hpFrac,inHand,awake,returning,alive}; `type` is assigned later on the live object, so it appends last.
            let mut fields = vec![
                ("id", s(&m.id)),
                ("kind", s(&m.kind)),
                (
                    "faction",
                    m.faction.map(|v| s(v.as_str())).unwrap_or_else(null),
                ),
            ];
            if let Some(name) = &m.name {
                fields.push(("name", s(name)));
            }
            fields.extend([
                ("home", encode_opt(m.home.as_ref(), |v| encode_vec2(*v))),
                ("campId", opt_string(m.camp_id.as_deref())),
                ("pos", encode_vec2(m.pos)),
                ("dotAt", n(m.dot_at)),
                ("seenAt", encode_opt(m.seen_at.as_ref(), |v| n(*v))),
                ("hpFrac", n(m.hp_frac)),
                (
                    "inHand",
                    m.in_hand.map(|w| s(w.as_str())).unwrap_or_else(null),
                ),
                ("awake", b(m.awake)),
                ("returning", b(m.returning)),
                ("alive", b(m.alive)),
            ]);
            if let Some(ty) = &m.type_ {
                fields.push(("type", s(ty)));
            }
            (s(id), obj(fields))
        })
        .collect());
    let camps = map(camps
        .iter()
        .map(|(id, c)| {
            (
                s(id),
                obj(vec![
                    ("id", s(&c.id)),
                    ("zone", s(c.zone.as_str())),
                    ("elite", b(c.elite)),
                    ("aliveSeen", n(f64::from(c.alive_seen))),
                    ("clearedAt", encode_opt(c.cleared_at.as_ref(), |v| n(*v))),
                    (
                        "contestedAt",
                        encode_opt(c.contested_at.as_ref(), |v| n(*v)),
                    ),
                    ("visitedAt", encode_opt(c.visited_at.as_ref(), |v| n(*v))),
                ]),
            )
        })
        .collect());
    let containers = map(containers
        .iter()
        .map(|(id, c)| {
            (
                s(id),
                obj(vec![
                    ("id", s(&c.id)),
                    ("kind", s(&c.kind)),
                    ("pos", encode_vec2(c.pos)),
                    ("closed", b(c.closed)),
                    (
                        "weapon",
                        match c.weapon {
                            ContainersWeapon::Undefined => undefined(),
                            ContainersWeapon::Null => null(),
                            ContainersWeapon::Weapon(w) => s(w.as_str()),
                        },
                    ),
                    ("seenAt", n(c.seen_at)),
                    ("skipped", b(c.skipped)),
                ]),
            )
        })
        .collect());
    let recent_hits = arr(self_memory
        .recent_hits
        .iter()
        .map(|hit| {
            obj(vec![
                ("t", n(hit.t)),
                ("by", opt_string(hit.by.as_deref())),
                ("amount", n(hit.amount)),
            ])
        })
        .collect());
    let self_sv = obj(vec![
        (
            "lastHitAt",
            encode_opt(self_memory.last_hit_at.as_ref(), |v| n(*v)),
        ),
        (
            "lastHitByPlayerAt",
            encode_opt(self_memory.last_hit_by_player_at.as_ref(), |v| n(*v)),
        ),
        (
            "lastDealtAt",
            encode_opt(self_memory.last_dealt_at.as_ref(), |v| n(*v)),
        ),
        ("recentDamage", n(self_memory.recent_damage)),
        ("recentHits", recent_hits),
        (
            "teleportedAt",
            encode_opt(self_memory.teleported_at.as_ref(), |v| n(*v)),
        ),
        (
            "lastOrder",
            encode_opt(self_memory.last_order.as_ref(), |cmd| {
                encode_method_value(&cmd.raw)
            }),
        ),
        (
            "lastCast",
            encode_opt(self_memory.last_cast.as_ref(), |cmd| {
                encode_method_value(&cmd.raw)
            }),
        ),
        ("stillSince", n(self_memory.still_since)),
    ]);
    obj(vec![
        ("fighters", fighters),
        ("mobs", mobs),
        ("camps", camps),
        ("containers", containers),
        ("self", self_sv),
        (
            "stimuli",
            arr(stimuli.iter().map(encode_stimulus).collect()),
        ),
        ("bounties", string_number_map(bounties)),
        (
            "choices",
            arr(choices.iter().map(|choice| s(choice)).collect()),
        ),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-context replay state (runner.mts `state()`: {memory, drawCounts, pathStats} per cfg key, insertion order)

pub(crate) fn encode_path_stats(stats: &PathStats) -> SVal {
    obj(vec![
        ("searches", n(stats.searches as f64)),
        ("hits", n(stats.hits as f64)),
        ("fallbacks", n(stats.fallbacks as f64)),
    ])
}

pub(crate) fn encode_draw_counts(decide: u64, motor: u64, lapse: u64, knowledge: u64) -> SVal {
    obj(vec![
        ("decide", n(decide as f64)),
        ("motor", n(motor as f64)),
        ("lapse", n(lapse as f64)),
        ("knowledge", n(knowledge as f64)),
    ])
}

pub(crate) fn encode_context_state(
    memory: &Memory,
    draw_counts: [u64; 4],
    path_stats: &PathStats,
) -> SVal {
    obj(vec![
        ("memory", encode_memory_snapshot(memory)),
        (
            "drawCounts",
            encode_draw_counts(
                draw_counts[0],
                draw_counts[1],
                draw_counts[2],
                draw_counts[3],
            ),
        ),
        ("pathStats", encode_path_stats(path_stats)),
    ])
}

pub(crate) fn encode_contexts(states: &[(&str, SVal)]) -> SVal {
    SVal::Obj(
        states
            .iter()
            .map(|(cfg, state)| ((*cfg).to_string(), state.clone()))
            .collect(),
    )
}

// ---------------------------------------------------------------------------------------------------------------------
// Source Features (perception.ts `detectFeatures`; own-key order the corpus callback arguments record)

pub(crate) fn encode_features(features: &Features) -> SVal {
    obj(vec![
        (
            "messageTypes",
            arr(features.message_types.iter().map(|kind| s(kind)).collect()),
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

// ---------------------------------------------------------------------------------------------------------------------
// Registry `enabledModules` rows
//
// The source runner maps each returned module object to `{id, hooks, builtin, token}` where both optional properties are
// always own keys: `builtin` is the builtin module's key into the module table, `token` is the key of the opaque custom
// object in the runner's `custom` table. `modules/registry.rs` retains that declared token spelling; an absent match is
// source `undefined` (never a fabricated token).

pub(crate) fn encode_enabled_module(module: &EnabledModule) -> SVal {
    // registry.rs now carries the declared source token spelling itself (`Option<String>`); both optional source
    // properties are own keys, so an absent match is `undefined`, never an omitted field.
    obj(vec![
        ("id", s(&module.id)),
        (
            "hooks",
            arr(module.hooks.iter().map(|hook| s(hook)).collect()),
        ),
        (
            "builtin",
            module
                .builtin
                .map(|id| s(id.as_str()))
                .unwrap_or_else(undefined),
        ),
        (
            "token",
            module.token.as_deref().map(s).unwrap_or_else(undefined),
        ),
    ])
}

pub(crate) fn encode_enabled_modules(modules: &[EnabledModule]) -> SVal {
    arr(modules.iter().map(encode_enabled_module).collect())
}

// ---------------------------------------------------------------------------------------------------------------------
// Goals / goal decisions / status (strategy-types Goal union; module hooks use the same language)

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
            (
                "from",
                arr(from.iter().map(|point| encode_vec2(*point)).collect()),
            ),
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

pub(crate) fn encode_goal_decision(decision: &GoalDecision) -> SVal {
    let mut fields = vec![
        ("goal", encode_goal(&decision.goal)),
        ("utility", n(decision.utility)),
        ("why", s(&decision.why)),
    ];
    // The source decision's `choice` is an own property only once the strategy records one.
    if let Some(choice) = &decision.choice {
        fields.push(("choice", s(choice)));
    }
    obj(fields)
}

pub(crate) fn encode_goal_state(state: GoalState) -> SVal {
    s(state.as_str())
}

pub(crate) fn encode_goal_status(status: &GoalStatus) -> SVal {
    obj(vec![
        ("state", encode_goal_state(status.state)),
        ("why", s(&status.why)),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Intents (brain/types.ts Intent literals; own-key order pinned by corpus rows)
//
//   lock    {kind,target,at,priority,timing,why}
//   move    {kind,to,priority,timing,why}
//   stop    {kind,priority,timing,why}
//   swap    {kind,slot,priority,timing,why}
//   pickup  {kind,container,priority,timing,why}
//   cast    {kind,slot,x,y,target?,at?,snapRadius?,priority,timing,why}
//   plan    {kind,msg,priority,timing,why}
//   choose  {kind,msg,priority,timing,why}

pub(crate) fn encode_plan_msg(msg: &PlanMsg) -> SVal {
    // PlanMsg source order: spawn, boon, ready. The source literals pass a single-field object (`{spawn:k}`,
    // `{boon:b}`, `{ready:true}`), so an absent Rust `Option` is an absent own key, never `undefined`.
    let mut fields = Vec::new();
    if let Some(spawn) = msg.spawn {
        fields.push(("spawn", n(f64::from(spawn))));
    }
    if let Some(boon) = msg.boon {
        fields.push(("boon", n(f64::from(boon))));
    }
    if let Some(ready) = msg.ready {
        fields.push(("ready", b(ready)));
    }
    obj(fields)
}

pub(crate) fn encode_choose_msg(msg: &ChooseMsg) -> SVal {
    // ChooseMsg source order: chest, pick, replace? (the frozen corpus builds `{chest, pick}` only).
    let mut fields = vec![("chest", s(&msg.chest)), ("pick", n(f64::from(msg.pick)))];
    if let Some(replace) = msg.replace {
        fields.push(("replace", n(f64::from(replace))));
    }
    obj(fields)
}

pub(crate) fn encode_timing(timing: &IntentTiming) -> SVal {
    match timing {
        IntentTiming::React { stimulus } => obj(vec![
            ("kind", s("react")),
            ("stimulus", encode_stimulus(stimulus)),
        ]),
        IntentTiming::Step {} => obj(vec![("kind", s("step"))]),
        IntentTiming::Timed { due } => obj(vec![("kind", s("timed")), ("due", n(*due))]),
    }
}

/// Source `Stimulus` own-key order: kind, at, subject, central[, value] (types.ts; the memory snapshot's `stimuli` rows
/// and the `react` timing argument both use this object).
pub(crate) fn encode_stimulus(stimulus: &Stimulus) -> SVal {
    let mut fields = vec![
        ("kind", s(stimulus.kind.as_str())),
        ("at", n(stimulus.at)),
        ("subject", opt_string(stimulus.subject.as_deref())),
        ("central", b(stimulus.central)),
    ];
    if let Some(value) = stimulus.value {
        fields.push(("value", n(value)));
    }
    obj(fields)
}

pub(crate) fn encode_intent(intent: &Intent) -> SVal {
    let mut fields: Vec<(&str, SVal)> = match &intent.body {
        IntentBody::Lock { target, at } => vec![
            ("kind", s("lock")),
            ("target", s(target)),
            ("at", encode_vec2(*at)),
        ],
        IntentBody::Move { to } => vec![("kind", s("move")), ("to", encode_vec2(*to))],
        IntentBody::Stop {} => vec![("kind", s("stop"))],
        IntentBody::Swap { slot } => vec![("kind", s("swap")), ("slot", n(f64::from(*slot)))],
        IntentBody::Pickup { container } => {
            vec![("kind", s("pickup")), ("container", s(container))]
        }
        IntentBody::Cast {
            slot,
            x,
            y,
            target,
            at,
            snap_radius,
        } => {
            let mut cast = vec![
                ("kind", s("cast")),
                ("slot", s(slot)),
                ("x", n(*x)),
                ("y", n(*y)),
            ];
            // The source builder spreads the unit-cast facts only for a unit cast (no `target: undefined` own key).
            if let Some(target) = target {
                cast.push(("target", s(target)));
            }
            if let Some(at) = at {
                cast.push(("at", encode_vec2(*at)));
            }
            if let Some(snap_radius) = snap_radius {
                cast.push(("snapRadius", n(*snap_radius)));
            }
            cast
        }
        IntentBody::Plan { msg } => vec![("kind", s("plan")), ("msg", encode_plan_msg(msg))],
        IntentBody::Choose { msg } => {
            vec![("kind", s("choose")), ("msg", encode_choose_msg(msg))]
        }
    };
    fields.push(("priority", n(f64::from(intent.priority))));
    fields.push(("timing", encode_timing(&intent.timing)));
    fields.push(("why", s(&intent.why)));
    obj(fields)
}

pub(crate) fn encode_intent_list(intents: &[Intent]) -> SVal {
    arr(intents.iter().map(encode_intent).collect())
}

/// The `observe`/Memory `stimuli` list (source order; the same rows the memory snapshot owns).
pub(crate) fn encode_stimulus_list(stimuli: &[Stimulus]) -> SVal {
    arr(stimuli.iter().map(encode_stimulus).collect())
}

/// The module `goals` hook result: GoalDecision rows in source order.
pub(crate) fn encode_goal_decision_list(decisions: &[GoalDecision]) -> SVal {
    arr(decisions.iter().map(encode_goal_decision).collect())
}

// ChestDecision results (chestHunt.ts `decide()`): {kind:"none"} | {kind:"pick",chest,option,why} |
// {kind:"walk",chest,to,why}. Primitive builders keep this file independent of the chest-core lane's private enum.

pub(crate) fn encode_chest_none() -> SVal {
    obj(vec![("kind", s("none"))])
}

pub(crate) fn encode_chest_pick(chest: &str, option: i64, why: &str) -> SVal {
    obj(vec![
        ("kind", s("pick")),
        ("chest", s(chest)),
        ("option", n(option as f64)),
        ("why", s(why)),
    ])
}

pub(crate) fn encode_chest_walk(chest: &str, to: Vec2, why: &str) -> SVal {
    obj(vec![
        ("kind", s("walk")),
        ("chest", s(chest)),
        ("to", encode_vec2(to)),
        ("why", s(why)),
    ])
}

/// The `hunter.inspect` operation result: {target, stats}.
pub(crate) fn encode_hunter_inspect(target: Option<&str>, stats: SVal) -> SVal {
    obj(vec![("target", opt_string(target)), ("stats", stats)])
}

/// Source `TacticsOutput`/module output: {intents, status, attacking}.
pub(crate) fn encode_module_output(output: &ModuleOutput) -> SVal {
    obj(vec![
        ("intents", encode_intent_list(&output.intents)),
        ("status", encode_goal_status(&output.status)),
        ("attacking", b(output.attacking)),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared ChestHunter diagnostics (`bots/chestHunt.ts`; the frozen corpus' `initial.hunter` and every operation's
// `hunter.own` shape). The chest-core lane owns the hunter's internal state; these are the thin, source-ordered pieces
// the replay harness passes in, so this encoder does not couple to that lane's private field names.
//
//   ChestHunter instance own keys: cfg, log, stats, done, walking, stalls, walks
//   cfg:    pickRange,pickMarginMs,holdMs,arriveSlackMs,paceShare,fightWalk,stallMs,stallProgress,stallStepMaxMs,
//           maxCandidates,walkCacheMs
//   stats:  {walks, gaveUp}
//   walking: null | {id, at}
//   stalls: Map<id, {best, walkedMs}>
//   walks:  Map<id, {at, len}>
//   done:   Set<id>

pub(crate) fn encode_hunt_config(config: &ChestHuntConfig) -> SVal {
    obj(vec![
        ("pickRange", n(config.pick_range)),
        ("pickMarginMs", n(config.pick_margin_ms)),
        ("holdMs", n(config.hold_ms)),
        ("arriveSlackMs", n(config.arrive_slack_ms)),
        ("paceShare", n(config.pace_share)),
        ("fightWalk", n(config.fight_walk)),
        ("stallMs", n(config.stall_ms)),
        ("stallProgress", n(config.stall_progress)),
        ("stallStepMaxMs", n(config.stall_step_max_ms)),
        ("maxCandidates", n(config.max_candidates)),
        ("walkCacheMs", n(config.walk_cache_ms)),
    ])
}

pub(crate) fn encode_hunt_stats(stats: &ChestHuntStats) -> SVal {
    obj(vec![
        ("walks", n(stats.walks as f64)),
        ("gaveUp", n(stats.gave_up as f64)),
    ])
}

pub(crate) fn encode_hunt_walking(id: &str, at: f64) -> SVal {
    obj(vec![("id", s(id)), ("at", n(at))])
}

pub(crate) fn encode_hunt_stall(best: f64, walked_ms: f64) -> SVal {
    obj(vec![("best", n(best)), ("walkedMs", n(walked_ms))])
}

pub(crate) fn encode_hunt_walk(at: f64, len: f64) -> SVal {
    obj(vec![("at", n(at)), ("len", n(len))])
}

pub(crate) fn encode_hunter_done(ids: &[String]) -> SVal {
    SVal::Set(ids.iter().map(|id| s(id)).collect())
}

/// The `ChestHunter` source instance own state (the corpus' retained-state diagnostic; never an input).
pub(crate) fn encode_hunter_own(
    cfg: SVal,
    log: SVal,
    stats: SVal,
    done: SVal,
    walking: SVal,
    stalls: SVal,
    walks: SVal,
) -> SVal {
    SVal::Instance {
        name: "ChestHunter".into(),
        entries: vec![
            ("cfg".into(), cfg),
            ("log".into(), log),
            ("stats".into(), stats),
            ("done".into(), done),
            ("walking".into(), walking),
            ("stalls".into(), stalls),
            ("walks".into(), walks),
        ],
    }
}

/// One operation's `hunter` diagnostic: {own, target, stats}.
pub(crate) fn encode_hunter_capture(own: SVal, target: Option<&str>, stats: SVal) -> SVal {
    obj(vec![
        ("own", own),
        ("target", opt_string(target)),
        ("stats", stats),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact comparison (binary64 bits, -0, NaN/Infinity tags, Undefined vs null vs absent, ordered source own keys,
// ordered arrays/maps/sets, instance names). No tolerance, no whitelist, no ignored leaf.

fn same_seq(a: &[SVal], b: &[SVal]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| ordered_same(x, y))
}

/// Exact source-value equality with **ordered** object/instance own-property entries (source own-key order is
/// observable), ordered arrays/maps/sets, and the pinned codec leaves (`source_reader::same`) for scalars/tags.
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
        // `rh-method-value/1` has one NaN sentinel tag (`{"$":"number","value":"NaN"}`): the source codec cannot
        // represent a NaN payload, so any NaN equals any NaN at the encoded-value level. Finite values (including -0)
        // and +/-Infinity stay binary64-bit exact below and above; this is sentinel identity, not tolerance.
        (SVal::Num(x), SVal::Num(y)) => x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()),
        _ => source_reader::same(a, b),
    }
}

/// Compact exact-number description: bits, including the tagged non-finite/-0 spellings, so a last-bit difference is
/// legible without widening the comparison.
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

/// Compact value description for a mismatch message (never the whole tree).
fn describe(value: &SVal) -> String {
    match value {
        SVal::Undefined => "undefined".into(),
        SVal::Null => "null".into(),
        SVal::Bool(v) => format!("bool {v}"),
        SVal::Num(v) => describe_number(*v),
        SVal::Str(v) => format!("string {v:?}"),
        SVal::Arr(values) => format!("array({})", values.len()),
        SVal::Map(entries) => format!("map({})", entries.len()),
        SVal::Set(values) => format!("set({})", values.len()),
        SVal::Obj(entries) => format!(
            "object({}; keys={:?})",
            entries.len(),
            entries
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>()
        ),
        SVal::U8(bytes) => format!("u8({})", bytes.len()),
        SVal::Instance { name, entries } => {
            format!(
                "instance {name}({}; keys={:?})",
                entries.len(),
                entries
                    .iter()
                    .map(|(key, _)| key.as_str())
                    .collect::<Vec<_>>()
            )
        }
        SVal::Callable => "callable".into(),
    }
}

/// The first raw difference between two source values with a compact path to it (`key`, `[index]`, `{map index}`, `u8`
/// byte index; numbers report exact bits). `None` only when [`ordered_same`] holds.
pub(crate) fn first_difference(expected: &SVal, actual: &SVal, path: &str) -> Option<String> {
    match (expected, actual) {
        (SVal::Obj(e), SVal::Obj(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: object length expected {} actual {} (expected keys {:?}, actual keys {:?})",
                    e.len(),
                    a.len(),
                    e.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
                    a.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
                ));
            }
            for (index, ((ek, ev), (ak, av))) in e.iter().zip(a).enumerate() {
                if ek != ak {
                    return Some(format!(
                        "{path}: object key[{index}] expected {ek:?} actual {ak:?} (misspelled or reordered)"
                    ));
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
            if en != an {
                return Some(format!(
                    "{path}: instance name expected {en:?} actual {an:?}"
                ));
            }
            if ee.len() != ae.len() {
                return Some(format!(
                    "{path}: instance {en} length expected {} actual {} (expected keys {:?}, actual keys {:?})",
                    ee.len(),
                    ae.len(),
                    ee.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
                    ae.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(),
                ));
            }
            for (index, ((ek, ev), (ak, av))) in ee.iter().zip(ae).enumerate() {
                if ek != ak {
                    return Some(format!(
                        "{path}: instance key[{index}] expected {ek:?} actual {ak:?} (misspelled or reordered)"
                    ));
                }
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}.{ek}"));
                }
            }
            None
        }
        (SVal::Arr(e), SVal::Arr(a)) | (SVal::Set(e), SVal::Set(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: collection length expected {} actual {}",
                    e.len(),
                    a.len()
                ));
            }
            for (index, (ev, av)) in e.iter().zip(a).enumerate() {
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}[{index}]"));
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
            for (index, ((ek, ev), (ak, av))) in e.iter().zip(a).enumerate() {
                if !ordered_same(ek, ak) {
                    return Some(format!(
                        "{path}: map key[{index}] expected {} actual {} (entry order matters)",
                        describe(ek),
                        describe(ak)
                    ));
                }
                if !ordered_same(ev, av) {
                    return first_difference(ev, av, &format!("{path}[{index}]"));
                }
            }
            None
        }
        (SVal::U8(e), SVal::U8(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path}: u8 length expected {} actual {}",
                    e.len(),
                    a.len()
                ));
            }
            e.iter().zip(a).enumerate().find_map(|(index, (ev, av))| {
                (ev != av).then(|| format!("{path}: u8 byte[{index}] expected {ev} actual {av}"))
            })
        }
        (SVal::Num(e), SVal::Num(a)) => {
            // NaN is a codec sentinel (payload not representable), so only "one is NaN" is a difference there.
            (e.to_bits() != a.to_bits() && !(e.is_nan() && a.is_nan())).then(|| {
                format!(
                    "{path}: number expected {} actual {}",
                    describe_number(*e),
                    describe_number(*a)
                )
            })
        }
        _ => {
            if source_reader::same(expected, actual) {
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
pub(crate) fn compare_ordered(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    if ordered_same(expected, actual) {
        return;
    }
    failures.push(
        first_difference(expected, actual, label)
            .unwrap_or_else(|| format!("{label}: expected {expected:?} actual {actual:?}")),
    );
}

/// Compare two complete callback/RNG transcripts exactly (ordered entries, shared `sequence`, binary64 values).
pub(crate) fn compare_callback_values(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    let (SVal::Arr(expected_events), SVal::Arr(actual_events)) = (expected, actual) else {
        failures.push(format!(
            "{label} callbacks: non-array transcript expected {} actual {}",
            describe(expected),
            describe(actual)
        ));
        return;
    };
    if expected_events.len() != actual_events.len() {
        failures.push(format!(
            "{label} callbacks: expected {} events actual {} (first missing/extra index {})",
            expected_events.len(),
            actual_events.len(),
            expected_events.len().min(actual_events.len())
        ));
        return;
    }
    for (sequence, (expected_event, actual_event)) in
        expected_events.iter().zip(actual_events).enumerate()
    {
        if ordered_same(expected_event, actual_event) {
            continue;
        }
        let detail = first_difference(expected_event, actual_event, "event")
            .unwrap_or_else(|| "event differs".into());
        failures.push(format!("{label} callbacks[{sequence}]: {detail}"));
        return;
    }
}

/// Compare the recorded transcript against the frozen corpus transcript; report the first entry mismatch and its
/// sequence index (nothing is tolerated, including the callback `name`/`cfg`/arguments/result and every RNG value).
pub(crate) fn compare_callbacks(
    label: &str,
    expected: &SVal,
    trace: &TraceHandle,
    failures: &mut Vec<String>,
) {
    compare_callback_values(label, expected, &trace.borrow().sequence(), failures);
}

/// Compare the four per-lane draw counters exactly (`{decide, motor, lapse, knowledge}` in source order).
pub(crate) fn compare_draw_counts(
    label: &str,
    expected: &SVal,
    counts: [u64; 4],
    failures: &mut Vec<String>,
) {
    let actual = encode_draw_counts(counts[0], counts[1], counts[2], counts[3]);
    if ordered_same(expected, &actual) {
        return;
    }
    failures.push(
        first_difference(expected, &actual, &format!("{label} drawCounts")).unwrap_or_else(|| {
            format!("{label} drawCounts: expected {expected:?} actual {actual:?}")
        }),
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Unit tests: exact hand-built source shapes, transcript ordering, and the admitted Memory/view wiring.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::types::{
        ChooseMsg, Intent, IntentBody, IntentTiming, PlanMsg, Stimulus, StimulusKind,
    };
    use crate::bots::view::Features;

    fn assert_same(expected: &SVal, actual: &SVal) {
        if !ordered_same(expected, actual) {
            panic!(
                "expected {expected:?}\nactual   {actual:?}\nfirst difference: {:?}",
                first_difference(expected, actual, "value")
            );
        }
    }

    fn keys(value: &SVal) -> Vec<&str> {
        match value {
            SVal::Obj(entries) => entries.iter().map(|(key, _)| key.as_str()).collect(),
            other => panic!("expected object, got {other:?}"),
        }
    }

    fn vec2(x: f64, y: f64) -> SVal {
        encode_vec2(Vec2::new(x, y))
    }

    fn intent(body: IntentBody, priority: u8, timing: IntentTiming, why: &str) -> Intent {
        Intent {
            body,
            priority,
            timing,
            why: why.to_string(),
        }
    }

    fn chest_up_stimulus() -> Stimulus {
        Stimulus {
            kind: StimulusKind::ChestUp,
            at: 100_000.,
            subject: Some("box".to_string()),
            central: true,
            value: None,
        }
    }

    #[test]
    fn move_intent_matches_source_literal_order() {
        let move_intent = intent(
            IntentBody::Move {
                to: Vec2::new(4., 5.),
            },
            2,
            IntentTiming::Step {},
            "walk",
        );
        let expected = obj(vec![
            ("kind", s("move")),
            ("to", vec2(4., 5.)),
            ("priority", n(2.)),
            ("timing", obj(vec![("kind", s("step"))])),
            ("why", s("walk")),
        ]);
        let actual = encode_intent(&move_intent);
        assert_same(&expected, &actual);
        assert_eq!(keys(&actual), ["kind", "to", "priority", "timing", "why"]);
    }

    #[test]
    fn cast_intent_omits_absent_unit_cast_facts() {
        let cast = intent(
            IntentBody::Cast {
                slot: "wish".to_string(),
                x: 1108.,
                y: 1008.,
                target: None,
                at: None,
                snap_radius: None,
            },
            1,
            IntentTiming::Timed { due: 100_250. },
            "cast Freeze",
        );
        let expected = obj(vec![
            ("kind", s("cast")),
            ("slot", s("wish")),
            ("x", n(1108.)),
            ("y", n(1008.)),
            ("priority", n(1.)),
            (
                "timing",
                obj(vec![("kind", s("timed")), ("due", n(100_250.))]),
            ),
            ("why", s("cast Freeze")),
        ]);
        assert_same(&expected, &encode_intent(&cast));
        assert_eq!(
            keys(&encode_intent(&cast)),
            ["kind", "slot", "x", "y", "priority", "timing", "why"]
        );
    }

    #[test]
    fn cast_intent_includes_present_unit_cast_facts_in_source_order() {
        let cast = intent(
            IntentBody::Cast {
                slot: "wish".to_string(),
                x: 1108.,
                y: 1008.,
                target: Some("foe".to_string()),
                at: Some(Vec2::new(1108., 1008.)),
                snap_radius: Some(64.),
            },
            1,
            IntentTiming::React {
                stimulus: chest_up_stimulus(),
            },
            "cast Freeze",
        );
        let expected = obj(vec![
            ("kind", s("cast")),
            ("slot", s("wish")),
            ("x", n(1108.)),
            ("y", n(1008.)),
            ("target", s("foe")),
            ("at", vec2(1108., 1008.)),
            ("snapRadius", n(64.)),
            ("priority", n(1.)),
            (
                "timing",
                obj(vec![
                    ("kind", s("react")),
                    (
                        "stimulus",
                        obj(vec![
                            ("kind", s("chestUp")),
                            ("at", n(100_000.)),
                            ("subject", s("box")),
                            ("central", b(true)),
                        ]),
                    ),
                ]),
            ),
            ("why", s("cast Freeze")),
        ]);
        let actual = encode_intent(&cast);
        assert_same(&expected, &actual);
        assert_eq!(
            keys(&actual),
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
    }

    #[test]
    fn plan_and_choose_messages_own_only_present_source_keys() {
        // Source planning.ts: plan({ready:true}) / plan({spawn:k}) / plan({boon:b}).
        let ready = intent(
            IntentBody::Plan {
                msg: PlanMsg {
                    spawn: None,
                    boon: None,
                    ready: Some(true),
                },
            },
            2,
            IntentTiming::Step {},
            "no deal came: ready, the server picks",
        );
        let expected = obj(vec![
            ("kind", s("plan")),
            ("msg", obj(vec![("ready", b(true))])),
            ("priority", n(2.)),
            ("timing", obj(vec![("kind", s("step"))])),
            ("why", s("no deal came: ready, the server picks")),
        ]);
        assert_same(&expected, &encode_intent(&ready));

        let spawn = intent(
            IntentBody::Plan {
                msg: PlanMsg {
                    spawn: Some(1),
                    boon: None,
                    ready: None,
                },
            },
            2,
            IntentTiming::Step {},
            "spawn 1 (option 1)",
        );
        assert_same(
            &obj(vec![
                ("kind", s("plan")),
                ("msg", obj(vec![("spawn", n(1.))])),
                ("priority", n(2.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("spawn 1 (option 1)")),
            ]),
            &encode_intent(&spawn),
        );

        // Source chests.ts: choose({kind:"choose", msg:{chest, pick}, ...}) — replace is only owned when supplied.
        let choose = intent(
            IntentBody::Choose {
                msg: ChooseMsg {
                    chest: "box".to_string(),
                    pick: 0,
                    replace: None,
                },
            },
            1,
            IntentTiming::React {
                stimulus: chest_up_stimulus(),
            },
            "chest box: card 0 (ad1)",
        );
        let actual = encode_intent(&choose);
        assert_eq!(keys(&actual), ["kind", "msg", "priority", "timing", "why"]);
        assert_same(
            &obj(vec![("chest", s("box")), ("pick", n(0.))]),
            match &actual {
                SVal::Obj(entries) => &entries[1].1,
                other => panic!("expected object, got {other:?}"),
            },
        );

        let with_replace = intent(
            IntentBody::Choose {
                msg: ChooseMsg {
                    chest: "box".to_string(),
                    pick: -1,
                    replace: Some(1),
                },
            },
            1,
            IntentTiming::Step {},
            "skip",
        );
        let actual = encode_intent(&with_replace);
        assert_same(
            &obj(vec![
                ("chest", s("box")),
                ("pick", n(-1.)),
                ("replace", n(1.)),
            ]),
            match &actual {
                SVal::Obj(entries) => &entries[1].1,
                other => panic!("expected object, got {other:?}"),
            },
        );
    }

    #[test]
    fn lock_swap_pickup_stop_intents_match_source_literal_order() {
        let lock = intent(
            IntentBody::Lock {
                target: "foe".to_string(),
                at: Vec2::new(1108., 1008.),
            },
            1,
            IntentTiming::Step {},
            "lock",
        );
        assert_same(
            &obj(vec![
                ("kind", s("lock")),
                ("target", s("foe")),
                ("at", vec2(1108., 1008.)),
                ("priority", n(1.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("lock")),
            ]),
            &encode_intent(&lock),
        );
        let swap = intent(
            IntentBody::Swap { slot: 1 },
            1,
            IntentTiming::Step {},
            "swap",
        );
        assert_same(
            &obj(vec![
                ("kind", s("swap")),
                ("slot", n(1.)),
                ("priority", n(1.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("swap")),
            ]),
            &encode_intent(&swap),
        );
        let pickup = intent(
            IntentBody::Pickup {
                container: "box".to_string(),
            },
            3,
            IntentTiming::Step {},
            "take the weapon",
        );
        assert_same(
            &obj(vec![
                ("kind", s("pickup")),
                ("container", s("box")),
                ("priority", n(3.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("take the weapon")),
            ]),
            &encode_intent(&pickup),
        );
        let stop = intent(IntentBody::Stop {}, 1, IntentTiming::Step {}, "still");
        assert_same(
            &obj(vec![
                ("kind", s("stop")),
                ("priority", n(1.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("still")),
            ]),
            &encode_intent(&stop),
        );
    }

    #[test]
    fn stimulus_value_is_owned_only_when_present() {
        let without = chest_up_stimulus();
        assert_same(
            &obj(vec![
                ("kind", s("chestUp")),
                ("at", n(100_000.)),
                ("subject", s("box")),
                ("central", b(true)),
            ]),
            &encode_stimulus(&without),
        );
        let with = Stimulus {
            kind: StimulusKind::LowHp,
            at: 100_000.,
            subject: None,
            central: true,
            value: Some(0.25),
        };
        assert_same(
            &obj(vec![
                ("kind", s("lowHp")),
                ("at", n(100_000.)),
                ("subject", null()),
                ("central", b(true)),
                ("value", n(0.25)),
            ]),
            &encode_stimulus(&with),
        );
    }

    #[test]
    fn intent_list_keeps_source_order() {
        let first = intent(
            IntentBody::Move {
                to: Vec2::new(1., 2.),
            },
            2,
            IntentTiming::Step {},
            "first",
        );
        let second = intent(IntentBody::Stop {}, 1, IntentTiming::Step {}, "second");
        let encoded = encode_intent_list(&[first, second]);
        let SVal::Arr(entries) = &encoded else {
            panic!("expected array");
        };
        assert_eq!(entries.len(), 2);
        assert_same(entries[0].optional("why").expect("first why"), &s("first"));
        assert_same(
            entries[1].optional("why").expect("second why"),
            &s("second"),
        );
    }

    #[test]
    fn ordered_same_is_order_sensitive_for_objects_and_maps() {
        let ordered = obj(vec![("a", n(1.)), ("b", n(2.))]);
        assert!(ordered_same(&ordered, &ordered));
        assert!(!ordered_same(
            &ordered,
            &obj(vec![("b", n(2.)), ("a", n(1.))])
        ));
        // Keyed leaf equality ignores order; the ordered comparator does not.
        assert!(same(&ordered, &obj(vec![("b", n(2.)), ("a", n(1.))])));
        let map_a = map(vec![(s("a"), n(1.)), (s("b"), n(2.))]);
        let map_b = map(vec![(s("b"), n(2.)), (s("a"), n(1.))]);
        assert!(!ordered_same(&map_a, &map_b));
        assert!(!same(&map_a, &map_b));
    }

    #[test]
    fn first_difference_reports_the_bit_flipped_number_and_path() {
        let expected = obj(vec![
            ("drawCounts", obj(vec![("decide", n(1.5))])),
            ("ok", b(true)),
        ]);
        let flipped = f64::from_bits(1.5f64.to_bits() + 1);
        let actual = obj(vec![
            ("drawCounts", obj(vec![("decide", n(flipped))])),
            ("ok", b(true)),
        ]);
        let detail = first_difference(&expected, &actual, "case").expect("a difference");
        assert!(
            detail.contains("case.drawCounts.decide"),
            "detail: {detail}"
        );
        assert!(detail.contains("bits=0x"), "detail: {detail}");
        assert!(
            detail.contains(&format!("0x{:016x}", flipped.to_bits())),
            "detail: {detail}"
        );
        // Distinct tagged spellings are never collapsed.
        assert!(first_difference(&n(f64::NAN), &n(0.), "nan").is_some());
        assert!(first_difference(&n(-0.0), &n(0.), "zero").is_some());
        assert!(first_difference(&undefined(), &null(), "absent").is_some());
    }

    #[test]
    fn recorded_learned_records_the_raw_result_even_when_nonfinite() {
        use super::super::types::LearnedBiasFn;
        let trace = TraceLog::new_handle();
        let learned = RecordedLearned::new(
            true,
            vec![
                ("spawn|fire|fire".to_string(), 0.25),
                ("boon|fire|vigor".to_string(), f64::INFINITY),
            ],
            "a",
            &trace,
        );
        assert!(LearnedBiasFn::enabled(&learned));
        let infinity = LearnedBiasFn::bias(&learned, "boon|fire|vigor");
        assert!(infinity.is_infinite() && infinity.is_sign_positive());
        assert_eq!(LearnedBiasFn::bias(&learned, "missing"), 0.);
        let expected = arr(vec![
            obj(vec![
                ("sequence", n(0.)),
                ("kind", s("callback")),
                ("cfg", s("a")),
                ("name", s("learned.bias")),
                ("args", arr(vec![s("boon|fire|vigor")])),
                ("result", n(f64::INFINITY)),
            ]),
            obj(vec![
                ("sequence", n(1.)),
                ("kind", s("callback")),
                ("cfg", s("a")),
                ("name", s("learned.bias")),
                ("args", arr(vec![s("missing")])),
                ("result", n(0.)),
            ]),
        ]);
        assert_same(&expected, &trace.borrow().sequence());
    }

    #[test]
    fn log_recorders_own_the_runner_cfg_and_name() {
        let trace = TraceLog::new_handle();
        let log = module_log(&trace, "a");
        log("going for chest box (650 u of walking)");
        let hunter = hunter_log(&trace);
        let mut hunter = hunter;
        hunter("going for chest box (300 u of walking)");
        let expected = arr(vec![
            obj(vec![
                ("sequence", n(0.)),
                ("kind", s("callback")),
                ("cfg", s("a")),
                ("name", s("services.log")),
                (
                    "args",
                    arr(vec![s("going for chest box (650 u of walking)")]),
                ),
                ("result", undefined()),
            ]),
            obj(vec![
                ("sequence", n(1.)),
                ("kind", s("callback")),
                ("cfg", s("$hunter")),
                ("name", s("hunter.log")),
                (
                    "args",
                    arr(vec![s("going for chest box (300 u of walking)")]),
                ),
                ("result", undefined()),
            ]),
        ]);
        assert_same(&expected, &trace.borrow().sequence());
    }

    #[test]
    fn nan_is_a_source_codec_sentinel_not_a_payload() {
        let canonical = n(f64::NAN);
        let payload = n(f64::from_bits(0x7ff8_0000_0000_0001));
        // The tagged grammar normalises every NaN, so ordered comparison is sentinel identity for NaN only.
        assert!(ordered_same(&canonical, &payload));
        assert!(first_difference(&canonical, &payload, "leaf").is_none());
        // The pinned leaf codec stays payload-strict; the corpus never relies on a NaN payload.
        assert!(!same(&canonical, &payload));
        // Signed zero and the finite/infinite bit patterns remain exactly distinct.
        assert!(!ordered_same(&n(0.), &n(-0.)));
        assert!(first_difference(&n(0.), &n(-0.), "zero").is_some());
        assert!(!ordered_same(&n(f64::INFINITY), &n(f64::NEG_INFINITY)));
        assert!(ordered_same(
            &n(f64::INFINITY),
            &n(f64::from_bits(f64::INFINITY.to_bits()))
        ));
    }

    #[test]
    fn nested_callbacks_keep_the_source_runner_sequence() {
        // runner.mts pushes the event before calling the native body, so hunter.walk precedes its nested paths.walk.
        let trace = TraceLog::new_handle();
        let outer_result = record_callback_with(&trace, "a", "hunter.walk", &[s("box")], || {
            record_callback(
                &trace,
                "a",
                "paths.walk",
                &[s("me"), s("box")],
                obj(vec![("dist", n(300.)), ("exact", b(true))]),
            );
            n(300.)
        });
        assert_same(&n(300.), &outer_result);
        let expected = arr(vec![
            obj(vec![
                ("sequence", n(0.)),
                ("kind", s("callback")),
                ("cfg", s("a")),
                ("name", s("hunter.walk")),
                ("args", arr(vec![s("box")])),
                ("result", n(300.)),
            ]),
            obj(vec![
                ("sequence", n(1.)),
                ("kind", s("callback")),
                ("cfg", s("a")),
                ("name", s("paths.walk")),
                ("args", arr(vec![s("me"), s("box")])),
                ("result", obj(vec![("dist", n(300.)), ("exact", b(true))])),
            ]),
        ]);
        assert_same(&expected, &trace.borrow().sequence());
        let mut failures = Vec::new();
        compare_callbacks("a", &expected, &trace, &mut failures);
        assert!(failures.is_empty(), "unexpected failures: {failures:?}");
    }

    #[test]
    fn trace_rng_records_the_admitted_values_and_indices_in_order() {
        let trace = TraceLog::new_handle();
        let mut rng = TraceRng::new(1, "a", "decide", &trace);
        let first = RngStream::draw(&mut rng);
        let second = RngStream::draw(&mut rng);
        assert_eq!(rng.draws(), 2);
        let mut reference = Rng::new(1);
        assert_eq!(first.to_bits(), reference.next_f64().to_bits());
        assert_eq!(second.to_bits(), reference.next_f64().to_bits());
        let expected = arr(vec![
            obj(vec![
                ("sequence", n(0.)),
                ("kind", s("rng")),
                ("cfg", s("a")),
                ("stream", s("decide")),
                ("index", n(0.)),
                ("value", n(first)),
            ]),
            obj(vec![
                ("sequence", n(1.)),
                ("kind", s("rng")),
                ("cfg", s("a")),
                ("stream", s("decide")),
                ("index", n(1.)),
                ("value", n(second)),
            ]),
        ]);
        assert_same(&expected, &trace.borrow().sequence());
        let mut failures = Vec::new();
        compare_callbacks("a", &expected, &trace, &mut failures);
        assert!(failures.is_empty(), "unexpected failures: {failures:?}");
    }

    #[test]
    fn compare_callbacks_reports_a_reordered_draw() {
        let expected = {
            let handle = TraceLog::new_handle();
            {
                let mut log = handle.borrow_mut();
                log.record_rng("a", "decide", 0, 0.25);
                log.record_rng("a", "decide", 1, 0.5);
            }
            let transcript = handle.borrow().sequence();
            transcript
        };
        // The same two draws with the values swapped (a reordered RNG transcript) must fail at sequence 0.
        let trace = TraceLog::new_handle();
        {
            let mut log = trace.borrow_mut();
            log.record_rng("a", "decide", 0, 0.5);
            log.record_rng("a", "decide", 1, 0.25);
        }
        let mut failures = Vec::new();
        compare_callbacks("case-one", &expected, &trace, &mut failures);
        assert_eq!(failures.len(), 1, "failures: {failures:?}");
        assert!(failures[0].contains("callbacks[0]"), "{failures:?}");

        // A short transcript reports the event count instead of pretending the prefix matched.
        let short = TraceLog::new_handle();
        short.borrow_mut().record_rng("a", "decide", 0, 0.25);
        let mut failures = Vec::new();
        compare_callbacks("case-one", &expected, &short, &mut failures);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("expected 2 events"), "{failures:?}");
        assert!(failures[0].contains("actual 1"), "{failures:?}");
    }

    #[test]
    fn compare_draw_counts_is_exact_per_lane() {
        let expected = encode_draw_counts(4, 0, 2, 70);
        let mut failures = Vec::new();
        compare_draw_counts("a", &expected, [4, 0, 2, 70], &mut failures);
        assert!(failures.is_empty(), "unexpected failures: {failures:?}");
        let mut failures = Vec::new();
        compare_draw_counts("a", &expected, [4, 1, 2, 70], &mut failures);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("drawCounts.motor"), "{failures:?}");
    }

    #[test]
    fn encode_path_stats_uses_the_source_field_order() {
        let stats = PathStats {
            searches: 2,
            hits: 1,
            fallbacks: 4,
        };
        let actual = encode_path_stats(&stats);
        assert_eq!(keys(&actual), ["searches", "hits", "fallbacks"]);
        assert_same(
            &obj(vec![
                ("searches", n(2.)),
                ("hits", n(1.)),
                ("fallbacks", n(4.)),
            ]),
            &actual,
        );
        assert_eq!(
            keys(&encode_draw_counts(0, 0, 0, 0)),
            ["decide", "motor", "lapse", "knowledge"]
        );
    }

    #[test]
    fn encode_features_uses_the_source_field_order() {
        let features = Features {
            message_types: vec!["move".into(), "stop".into()],
            wishes: true,
            status_effects: true,
            fields: false,
            planning: true,
            chests: true,
            skills: false,
            relics: true,
            camps: true,
            hazards: false,
        };
        let actual = encode_features(&features);
        assert_eq!(
            keys(&actual),
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
        assert_same(
            &obj(vec![
                ("messageTypes", arr(vec![s("move"), s("stop")])),
                ("wishes", b(true)),
                ("statusEffects", b(true)),
                ("fields", b(false)),
                ("planning", b(true)),
                ("chests", b(true)),
                ("skills", b(false)),
                ("relics", b(true)),
                ("camps", b(true)),
                ("hazards", b(false)),
            ]),
            &actual,
        );
    }

    #[test]
    fn encode_enabled_modules_owns_builtin_and_token_keys_as_undefined() {
        use super::super::registry::{CustomModule, Registry};
        use crate::bots::view::Features;
        let features = Features {
            wishes: true,
            planning: true,
            chests: false,
            hazards: true,
            ..Features::default()
        };
        let mut registry = Registry::with_defaults();
        let modules = registry.enabled(&features);
        let encoded = encode_enabled_modules(&modules);
        let SVal::Arr(rows) = &encoded else {
            panic!("expected rows array");
        };
        assert_eq!(rows.len(), 3); // wishes, planning, hazards (chests disabled)
        assert_eq!(keys(&rows[0]), ["id", "hooks", "builtin", "token"]);
        assert_same(
            &obj(vec![
                ("id", s("wishes")),
                (
                    "hooks",
                    arr(vec![
                        s("enabled"),
                        s("observe"),
                        s("goals"),
                        s("intents"),
                        s("act"),
                    ]),
                ),
                ("builtin", s("wishes")),
                ("token", undefined()),
            ]),
            &rows[0],
        );

        // A custom module's token is the declared spelling table entry; the builtin slot stays undefined.
        registry.register_custom(CustomModule {
            id: "extra".to_string(),
            token: "extra".to_string(),
            enabled: std::sync::Arc::new(|_features: &Features| true),
        });
        let encoded = encode_enabled_modules(&registry.enabled(&features));
        let SVal::Arr(rows) = &encoded else {
            panic!("expected rows array");
        };
        assert_same(
            &obj(vec![
                ("id", s("extra")),
                ("hooks", arr(vec![s("enabled")])),
                ("builtin", undefined()),
                ("token", s("extra")),
            ]),
            rows.last().expect("row"),
        );
    }

    #[test]
    fn encode_hunt_config_pins_the_frozen_corpus_values() {
        use super::super::chest_hunt::CHEST_HUNT;
        let actual = encode_hunt_config(&CHEST_HUNT);
        assert_eq!(
            keys(&actual),
            [
                "pickRange",
                "pickMarginMs",
                "holdMs",
                "arriveSlackMs",
                "paceShare",
                "fightWalk",
                "stallMs",
                "stallProgress",
                "stallStepMaxMs",
                "maxCandidates",
                "walkCacheMs"
            ]
        );
        assert_same(
            &obj(vec![
                ("pickRange", n(88.)),
                ("pickMarginMs", n(350.)),
                ("holdMs", n(150.)),
                ("arriveSlackMs", n(1000.)),
                ("paceShare", n(0.85)),
                ("fightWalk", n(384.)),
                ("stallMs", n(3000.)),
                ("stallProgress", n(24.)),
                ("stallStepMaxMs", n(500.)),
                ("maxCandidates", n(3.)),
                ("walkCacheMs", n(250.)),
            ]),
            &actual,
        );
    }

    #[test]
    fn hunter_own_is_an_ordered_source_instance() {
        let own = encode_hunter_own(
            obj(vec![("pickRange", n(88.))]),
            callable(),
            obj(vec![("walks", n(0.)), ("gaveUp", n(0.))]),
            encode_hunter_done(&[]),
            null(),
            map(vec![(s("box"), encode_hunt_stall(300., 0.))]),
            map(vec![(s("box"), encode_hunt_walk(100_000., 300.))]),
        );
        let SVal::Instance { name, entries } = &own else {
            panic!("expected instance");
        };
        assert_eq!(name.as_str(), "ChestHunter");
        assert_eq!(
            entries
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["cfg", "log", "stats", "done", "walking", "stalls", "walks"]
        );
        let capture = encode_hunter_capture(own.clone(), Some("box"), obj(vec![("walks", n(1.))]));
        assert_eq!(keys(&capture), ["own", "target", "stats"]);
        assert_same(
            &s("box"),
            match &capture {
                SVal::Obj(entries) => &entries[1].1,
                other => panic!("expected object, got {other:?}"),
            },
        );
        let no_target = encode_hunter_capture(own, None, null());
        assert_same(
            &null(),
            match &no_target {
                SVal::Obj(entries) => &entries[1].1,
                other => panic!("expected object, got {other:?}"),
            },
        );
    }

    #[test]
    fn encode_goal_status_decision_and_module_output_use_source_order() {
        let status = GoalStatus::running("walking to the chest");
        assert_same(
            &obj(vec![
                ("state", s("running")),
                ("why", s("walking to the chest")),
            ]),
            &encode_goal_status(&status),
        );
        assert_same(&s("done"), &encode_goal_state(GoalState::Done));

        let decision = GoalDecision {
            goal: Goal::Module {
                module: "chests".to_string(),
                data: MethodValue::Obj(vec![(
                    "chest".to_string(),
                    MethodValue::Str("box".to_string()),
                )]),
            },
            utility: 0.75,
            why: "chest".to_string(),
            choice: Some("chest|box".to_string()),
        };
        let actual = encode_goal_decision(&decision);
        assert_eq!(keys(&actual), ["goal", "utility", "why", "choice"]);
        let SVal::Obj(decision_fields) = &actual else {
            panic!("expected object");
        };
        assert_same(
            &obj(vec![
                ("kind", s("module")),
                ("module", s("chests")),
                ("data", obj(vec![("chest", s("box"))])),
            ]),
            &decision_fields[0].1,
        );
        assert_same(&n(0.75), &decision_fields[1].1);
        assert_same(&s("chest"), &decision_fields[2].1);
        assert_same(&s("chest|box"), &decision_fields[3].1);

        let output = ModuleOutput::new(
            vec![intent(
                IntentBody::Stop {},
                1,
                IntentTiming::Step {},
                "still",
            )],
            GoalStatus::done("the chest is gone, or already picked"),
            false,
        );
        let actual = encode_module_output(&output);
        assert_eq!(keys(&actual), ["intents", "status", "attacking"]);
        assert_same(
            &arr(vec![obj(vec![
                ("kind", s("stop")),
                ("priority", n(1.)),
                ("timing", obj(vec![("kind", s("step"))])),
                ("why", s("still")),
            ])]),
            match &actual {
                SVal::Obj(entries) => &entries[0].1,
                other => panic!("expected object, got {other:?}"),
            },
        );
    }

    #[test]
    fn chest_decision_and_inspect_results_match_the_source_literals() {
        assert_same(&obj(vec![("kind", s("none"))]), &encode_chest_none());
        assert_same(
            &obj(vec![
                ("kind", s("pick")),
                ("chest", s("young")),
                ("option", n(0.)),
                ("why", s("taking option 0 (ad1)")),
            ]),
            &encode_chest_pick("young", 0, "taking option 0 (ad1)"),
        );
        assert_eq!(
            keys(&encode_chest_pick("young", 0, "why")),
            ["kind", "chest", "option", "why"]
        );
        assert_same(
            &obj(vec![
                ("kind", s("walk")),
                ("chest", s("box")),
                ("to", vec2(1308., 1008.)),
                ("why", s("chest box")),
            ]),
            &encode_chest_walk("box", Vec2::new(1308., 1008.), "chest box"),
        );
        assert_eq!(
            keys(&encode_chest_walk("box", Vec2::new(1308., 1008.), "why")),
            ["kind", "chest", "to", "why"]
        );
        let inspect = encode_hunter_inspect(Some("box"), obj(vec![("walks", n(1.))]));
        assert_eq!(keys(&inspect), ["target", "stats"]);
        assert_same(
            &s("box"),
            match &inspect {
                SVal::Obj(entries) => &entries[0].1,
                other => panic!("expected object, got {other:?}"),
            },
        );
    }

    #[test]
    fn stimulus_and_goal_decision_lists_keep_source_order() {
        let stimuli = vec![chest_up_stimulus()];
        let SVal::Arr(rows) = &encode_stimulus_list(&stimuli) else {
            panic!("expected array");
        };
        assert_eq!(rows.len(), 1);
        assert_same(
            &obj(vec![
                ("kind", s("chestUp")),
                ("at", n(100_000.)),
                ("subject", s("box")),
                ("central", b(true)),
            ]),
            &rows[0],
        );
        let decisions = vec![GoalDecision {
            goal: Goal::Idle,
            utility: 1.,
            why: "idle".to_string(),
            choice: None,
        }];
        let SVal::Arr(rows) = &encode_goal_decision_list(&decisions) else {
            panic!("expected array");
        };
        assert_eq!(rows.len(), 1);
        assert_same(
            &obj(vec![
                ("goal", obj(vec![("kind", s("idle"))])),
                ("utility", n(1.)),
                ("why", s("idle")),
            ]),
            &rows[0],
        );
    }

    #[test]
    fn memory_snapshot_against_an_admitted_memory_matches_the_empty_source_view() {
        use super::super::super::memory::{Memory, MemoryConfig, MemoryMap};
        let tier: &'static crate::bots::types::TierParams =
            Box::leak(Box::new(crate::bots::types::TIERS[2]));
        let memory = Memory::new(MemoryConfig {
            self_id: "me".to_string(),
            tier,
            map: MemoryMap { camps: Vec::new() },
            features: Features::default(),
        })
        .expect("valid memory config");
        let expected = obj(vec![
            ("fighters", map(Vec::new())),
            ("mobs", map(Vec::new())),
            ("camps", map(Vec::new())),
            ("containers", map(Vec::new())),
            (
                "self",
                obj(vec![
                    ("lastHitAt", null()),
                    ("lastHitByPlayerAt", null()),
                    ("lastDealtAt", null()),
                    ("recentDamage", n(0.)),
                    ("recentHits", arr(Vec::new())),
                    ("teleportedAt", null()),
                    ("lastOrder", null()),
                    ("lastCast", null()),
                    ("stillSince", n(0.)),
                ]),
            ),
            ("stimuli", arr(Vec::new())),
            ("bounties", map(Vec::new())),
            ("choices", arr(Vec::new())),
        ]);
        let actual = encode_memory_snapshot(&memory);
        assert_eq!(
            keys(&actual),
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
        assert_same(&expected, &actual);
    }
}
