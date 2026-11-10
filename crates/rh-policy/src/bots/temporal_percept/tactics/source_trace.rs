//! Callback/RNG transcript, retained-state encoders and the declared tolerance whitelist for the private-tactics replay.
//!
//! Test-only. Every recorded event is produced while the real native classes run: the wrappers below forward the actual
//! admitted Memory/Knowledge/RoomPathService calls (or the declared argument-sensitive denial descriptor), clone the
//! exact source arguments the native caller passed and encode the value it actually returned, in one ordered sequence
//! shared with the declared decide/knowledge draw streams. Expected corpus rows are compared afterwards and are never
//! installed as native inputs. The only numeric allowance is the independently reviewed derived-geometry whitelist
//! (`2e-6` absolute); everything else compares exact bits/order/absence.

use std::cell::RefCell;
use std::rc::Rc;

use rh_sim::{Vec2, WeaponId};

use super::source_decode::{Method, OpEnv, Suite};
use super::source_reader::{self, SVal};
use super::types::{
    Foe, Intent, IntentBody, IntentKind, IntentTiming, PathArg, PathDescriptor, PathRoute,
    Presence, RouteElement, TacticContainer, TacticSelf, TacticsOutput, TacticsStats,
};
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{RoomPathService, WalkAnswer};
use crate::bots::random::Rng;
use crate::bots::types::{Stimulus, StimulusKind};

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
fn num_sv(value: f64) -> SVal {
    n(value)
}
fn bool_sv(value: bool) -> SVal {
    b(value)
}
fn vec2_sv(value: Vec2) -> SVal {
    obj(vec![("x", n(value.x)), ("y", n(value.y))])
}
fn opt_num_sv(value: Option<f64>) -> SVal {
    value.map(n).unwrap_or_else(null)
}
fn opt_string_sv(value: Option<&str>) -> SVal {
    value.map(s).unwrap_or_else(null)
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

/// The declared source `decide` stream: the admitted Mulberry32 draws, each recorded with its per-stream ordinal.
pub(crate) struct TraceDecide {
    rng: Rng,
    index: usize,
    trace: TraceHandle,
}
impl TraceDecide {
    pub(crate) fn new(seed: u32, trace: TraceHandle) -> Self {
        Self {
            rng: Rng::new(seed),
            index: 0,
            trace,
        }
    }
    pub(crate) fn draws(&self) -> usize {
        self.index
    }
}
impl super::types::RngStream for TraceDecide {
    fn draw(&mut self) -> f64 {
        let value = self.rng.next_f64();
        self.trace
            .borrow_mut()
            .rng_event("decide", self.index, value);
        self.index += 1;
        value
    }
}

/// Replay the one declared Knowledge constructor: the source `createKnowledge(tier, rng.knowledge)` takes exactly the
/// fixed 70 draws (10 faction + 10 weapon masks, then 50 mob-share errors) from the declared seeded stream. The witness
/// records those draws in order before the real admitted constructor consumes an identically seeded instance.
pub(crate) const KNOWLEDGE_SETUP_DRAWS: usize = 70;
pub(crate) fn create_knowledge_traced(
    tier: &crate::bots::types::TierParams,
    seed: u32,
    trace: &TraceHandle,
) -> Knowledge {
    let mut probe = Rng::new(seed);
    for index in 0..KNOWLEDGE_SETUP_DRAWS {
        let value = probe.next_f64();
        trace.borrow_mut().rng_event("knowledge", index, value);
    }
    Knowledge::create_with(tier.knowledge, tier.mob_share_noise, &mut Rng::new(seed))
}

pub(crate) fn setup_transcript(trace: &TraceHandle) -> SVal {
    trace.borrow().encoded()
}

// ---------------------------------------------------------------------------------------------------------------------
// Recording service wrappers (forward to the real admitted implementations)

pub(crate) struct RecordedKnowledge<'a> {
    pub inner: &'a Knowledge,
    pub trace: TraceHandle,
}
impl super::types::KnowledgeApi for RecordedKnowledge<'_> {
    fn weapon_edge(&self, a: WeaponId, b: WeaponId) -> i8 {
        let edge = Knowledge::weapon_edge(
            self.inner,
            super::types::to_bot_weapon(a),
            super::types::to_bot_weapon(b),
        );
        record_callback(
            &self.trace,
            "knowledge.weaponEdge",
            vec![s(a.as_str()), s(b.as_str())],
            n(f64::from(edge)),
        );
        edge
    }
}

pub(crate) struct RecordedMemory<'a> {
    pub inner: &'a super::super::memory::Memory,
    pub trace: TraceHandle,
}
impl super::types::MemoryApi for RecordedMemory<'_> {
    fn fighter(&self, id: &str) -> Option<super::super::memory::FighterMemory> {
        self.inner
            .view()
            .fighters
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn mob(&self, id: &str) -> Option<super::super::memory::MobMemory> {
        self.inner
            .view()
            .mobs
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn container(&self, id: &str) -> Option<super::super::memory::ContainerMemory> {
        self.inner
            .view()
            .containers
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value.clone())
    }
    fn self_memory(&self) -> super::super::memory::SelfMemory {
        self.inner.view().self_memory.clone()
    }
    fn stimuli(&self) -> Vec<Stimulus> {
        self.inner.view().stimuli.to_vec()
    }
    fn whereabouts(&mut self, id: &str, now: f64) -> Option<super::super::memory::Whereabouts> {
        let found = self
            .inner
            .whereabouts(id, now)
            .expect("admitted Memory whereabouts");
        let result = match &found {
            None => null(),
            Some(at) => obj(vec![("at", vec2_sv(at.at)), ("radius", n(at.radius))]),
        };
        record_callback(
            &self.trace,
            "memory.whereabouts",
            vec![s(id), n(now)],
            result,
        );
        found
    }
}

/// The declared source path-service wrapper: the real admitted `RoomPathService` behind the witness's optional
/// argument-sensitive radius-denial / half-plane descriptor. A denied request answers exactly as the source test service
/// does (los/clear false; path null, or the explicitly declared empty vector; walk null) and never touches the real
/// service's budget/cache/stats. Every full source argument and result is recorded.
pub(crate) struct RecordedPaths {
    pub inner: RoomPathService,
    pub env: OpEnv,
    pub map_value: SVal,
    pub trace: TraceHandle,
}
impl RecordedPaths {
    fn denied(&self, from: Vec2, to: Vec2) -> bool {
        let Some(descriptor) = self.env.path else {
            return false;
        };
        match descriptor {
            PathDescriptor::RadiusDenial { radius } => {
                rh_sim::mapgen::certify::source_hypot(to.x - from.x, to.y - from.y) > radius
            }
            PathDescriptor::HalfPlane { x } => to.x >= x,
        }
    }
    /// Rebuild the source route: the observed source `findPath` shortcut can hand the caller's own target object back as
    /// the single waypoint, and the source then keeps that object's identity downstream.
    fn route_from(&self, path: Vec<Vec2>, target: PathArg<'_>) -> PathRoute {
        let target_point = target.point();
        let last = path.len().saturating_sub(1);
        let elements = path
            .iter()
            .enumerate()
            .map(|(index, point)| {
                // `findPath` reconstructs the goal as the caller's own target object when its position is unchanged
                // (the observed shortcut/clear-target case); every intermediate waypoint is a plain tile point.
                let identity = index == last
                    && point.x.to_bits() == target_point.x.to_bits()
                    && point.y.to_bits() == target_point.y.to_bits();
                if identity {
                    match target {
                        PathArg::Foe(foe) => RouteElement::Foe(foe.clone()),
                        PathArg::Container(container) => RouteElement::Container(container.clone()),
                        PathArg::Point(_) => RouteElement::Point(*point),
                    }
                } else {
                    RouteElement::Point(*point)
                }
            })
            .collect();
        PathRoute { elements }
    }
}
impl super::types::PathApi for RecordedPaths {
    fn walk(&mut self, from: &TacticSelf, to: PathArg<'_>) -> Option<WalkAnswer> {
        let (from_point, to_point) = (from.pos(), to.point());
        let result = if self.denied(from_point, to_point) {
            None
        } else {
            self.inner.walk(from_point, to_point)
        };
        let encoded = match &result {
            None => null(),
            Some(answer) => obj(vec![("dist", n(answer.dist)), ("exact", b(answer.exact))]),
        };
        record_callback(
            &self.trace,
            "paths.walk",
            vec![encode_self(from), encode_path_arg(to)],
            encoded,
        );
        result
    }
    fn path(&mut self, from: &TacticSelf, to: PathArg<'_>) -> Option<PathRoute> {
        let (from_point, to_point) = (from.pos(), to.point());
        let denied = self.denied(from_point, to_point);
        let result = if denied {
            if self.env.empty_path {
                Some(self.route_from(Vec::new(), to))
            } else {
                None
            }
        } else {
            self.inner
                .path(from_point, to_point)
                .map(|path| self.route_from(path, to))
        };
        let encoded = match &result {
            None => null(),
            Some(route) => encode_route(route),
        };
        record_callback(
            &self.trace,
            "paths.path",
            vec![encode_self(from), encode_path_arg(to)],
            encoded,
        );
        result
    }
    fn los(&mut self, a: &TacticSelf, to: PathArg<'_>) -> bool {
        let (from_point, to_point) = (a.pos(), to.point());
        let result = if self.denied(from_point, to_point) {
            false
        } else {
            self.inner.los(from_point, to_point)
        };
        record_callback(
            &self.trace,
            "paths.los",
            vec![encode_self(a), encode_path_arg(to)],
            bool_sv(result),
        );
        result
    }
    fn clear(&mut self, a: &TacticSelf, to: PathArg<'_>) -> bool {
        let (from_point, to_point) = (a.pos(), to.point());
        let result = if self.denied(from_point, to_point) {
            false
        } else {
            self.inner.clear(from_point, to_point)
        };
        record_callback(
            &self.trace,
            "paths.clear",
            vec![encode_self(a), encode_path_arg(to)],
            bool_sv(result),
        );
        result
    }
    fn collision_map(&mut self) -> &rh_sim::TileMap {
        record_callback(
            &self.trace,
            "paths.collisionMap",
            Vec::new(),
            self.map_value.clone(),
        );
        self.inner.collision_map()
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Value encoders (exact declared source shapes; object field order is set-based in the comparator)

pub(crate) fn encode_features(features: &crate::bots::view::Features) -> SVal {
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

pub(crate) fn encode_self(self_: &TacticSelf) -> SVal {
    let mut fields = vec![
        ("id", s(&self_.id)),
        ("name", s(&self_.name)),
        ("x", n(self_.x)),
        ("y", n(self_.y)),
        ("facing", n(self_.facing)),
        ("status", s(&self_.status)),
        ("hp", n(self_.hp)),
        ("maxHp", n(self_.max_hp)),
        ("barrier", n(self_.barrier)),
        ("faction", opt_string_sv(self_.faction.map(|f| f.as_str()))),
        (
            "weapons",
            arr(self_
                .weapons
                .iter()
                .map(|weapon| opt_string_sv(weapon.map(|w| w.as_str())))
                .collect()),
        ),
        ("slot", n(f64::from(self_.slot))),
        (
            "attackTarget",
            opt_string_sv(self_.attack_target.as_deref()),
        ),
        ("drawStartedAt", n(self_.draw_started_at)),
        ("readyAt", n(self_.ready_at)),
        ("immuneUntil", n(self_.immune_until)),
        ("sig", n(self_.sig)),
        ("brand", n(self_.brand)),
        ("power", n(self_.power)),
        ("asMult", n(self_.as_mult)),
    ];
    match self_.windup_mult {
        Presence::Absent => {}
        Presence::Undefined => fields.push(("windupMult", undefined())),
        Presence::Value(value) => fields.push(("windupMult", n(value))),
    }
    fields.extend([
        ("speedMult", n(self_.speed_mult)),
        ("kills", n(self_.kills)),
        ("mobKills", n(self_.mob_kills)),
        ("gv", n(self_.gv)),
        ("bounty", n(self_.bounty)),
        ("moveSeq", n(self_.move_seq)),
    ]);
    obj(fields)
}

pub(crate) fn encode_foe(foe: &Foe) -> SVal {
    obj(vec![
        ("id", s(&foe.id)),
        ("mob", b(foe.mob)),
        ("seen", b(foe.seen)),
        ("x", n(foe.x)),
        ("y", n(foe.y)),
        ("vx", n(foe.vx)),
        ("vy", n(foe.vy)),
        ("dist", n(foe.dist)),
        ("los", b(foe.los)),
        ("facing", n(foe.facing)),
        ("hpFrac", n(foe.hp_frac)),
        ("faction", opt_string_sv(foe.faction.map(|f| f.as_str()))),
        ("theirs", opt_string_sv(foe.theirs.map(|w| w.as_str()))),
        ("targetable", b(foe.targetable)),
    ])
}

pub(crate) fn encode_container(container: &TacticContainer) -> SVal {
    let weapon = match container.weapon {
        super::super::memory::ContainersWeapon::Undefined => undefined(),
        super::super::memory::ContainersWeapon::Null => null(),
        super::super::memory::ContainersWeapon::Weapon(weapon) => s(weapon.as_str()),
    };
    obj(vec![
        ("id", s(&container.id)),
        ("kind", s(&container.kind)),
        ("x", n(container.x)),
        ("y", n(container.y)),
        ("label", s(&container.label)),
        ("closed", b(container.closed)),
        ("weapon", weapon),
        ("interactable", b(container.interactable)),
        ("dist", n(container.dist)),
    ])
}

pub(crate) fn encode_path_arg(arg: PathArg<'_>) -> SVal {
    match arg {
        PathArg::Point(point) => vec2_sv(point),
        PathArg::Foe(foe) => encode_foe(foe),
        PathArg::Container(container) => encode_container(container),
    }
}

pub(crate) fn encode_route_element(element: &RouteElement) -> SVal {
    match element {
        RouteElement::Point(point) => vec2_sv(*point),
        RouteElement::Foe(foe) => encode_foe(foe),
        RouteElement::Container(container) => encode_container(container),
    }
}

pub(crate) fn encode_vec2_point(point: Vec2) -> SVal {
    vec2_sv(point)
}

pub(crate) fn encode_route(route: &PathRoute) -> SVal {
    arr(route.elements.iter().map(encode_route_element).collect())
}

pub(crate) fn encode_stimulus(stimulus: &Stimulus) -> SVal {
    let mut fields = vec![
        ("kind", s(stimulus.kind.as_str())),
        ("at", n(stimulus.at)),
        ("subject", opt_string_sv(stimulus.subject.as_deref())),
        ("central", b(stimulus.central)),
    ];
    if let Some(value) = stimulus.value {
        fields.push(("value", n(value)));
    }
    obj(fields)
}

pub(crate) fn encode_stimuli(stimuli: &[Stimulus]) -> SVal {
    arr(stimuli.iter().map(encode_stimulus).collect())
}

fn encode_timing(timing: &IntentTiming) -> SVal {
    match timing {
        IntentTiming::React { stimulus } => obj(vec![
            ("kind", s("react")),
            ("stimulus", encode_stimulus(stimulus)),
        ]),
        IntentTiming::Step {} => obj(vec![("kind", s("step"))]),
        IntentTiming::Timed { due } => obj(vec![("kind", s("timed")), ("due", n(*due))]),
    }
}

pub(crate) fn encode_intent(intent: &Intent) -> SVal {
    let mut fields = match &intent.body {
        IntentBody::Lock { target, at } => vec![
            ("kind", s("lock")),
            ("target", s(target)),
            ("at", vec2_sv(*at)),
        ],
        IntentBody::Move { to } => vec![("kind", s("move")), ("to", encode_route_element(to))],
        IntentBody::Stop {} => vec![("kind", s("stop"))],
        IntentBody::Swap { slot } => {
            vec![("kind", s("swap")), ("slot", n(f64::from(*slot)))]
        }
        IntentBody::Pickup { container } => {
            vec![("kind", s("pickup")), ("container", s(container))]
        }
    };
    fields.push(("priority", n(f64::from(intent.priority))));
    fields.push(("timing", encode_timing(&intent.timing)));
    fields.push(("why", s(&intent.why)));
    obj(fields)
}

pub(crate) fn encode_output(output: &TacticsOutput) -> SVal {
    obj(vec![
        (
            "intents",
            arr(output.intents.iter().map(encode_intent).collect()),
        ),
        (
            "status",
            obj(vec![
                ("state", s(output.status.state.as_str())),
                ("why", s(&output.status.why)),
            ]),
        ),
        ("attacking", b(output.attacking)),
    ])
}

pub(crate) fn encode_tactics_stats(stats: TacticsStats) -> SVal {
    obj(vec![
        ("dodges", n(stats.dodges as f64)),
        ("jukes", n(stats.jukes as f64)),
        ("kiteCycles", n(stats.kite_cycles as f64)),
        ("retreats", n(stats.retreats as f64)),
        ("mobTargets", n(stats.mob_targets as f64)),
    ])
}

/// The source `stats()` shape per suite.
pub(crate) fn encode_stats(
    suite: Suite,
    tactics: Option<TacticsStats>,
    fight: Option<(u64, u64, f64, u64, u64)>,
    orb_cycles: u64,
    reflex: Option<(f64, u64, u64)>,
) -> SVal {
    match suite {
        Suite::Tactics => {
            let stats = tactics.expect("tactics stats");
            let encoded = encode_tactics_stats(stats);
            obj(vec![("stats", encoded.clone()), ("getStats", encoded)])
        }
        Suite::Fight => {
            let (mob_targets, cycles, hold_until, dodges, jukes) = fight.expect("fight stats");
            obj(vec![
                ("mobTargets", n(mob_targets as f64)),
                ("cycles", n(cycles as f64)),
                ("holdUntil", n(hold_until)),
                ("dodges", n(dodges as f64)),
                ("jukes", n(jukes as f64)),
            ])
        }
        Suite::Orb => obj(vec![("cycles", n(orb_cycles as f64))]),
        Suite::Reflex => {
            let (hold_until, dodges, jukes) = reflex.expect("reflex stats");
            obj(vec![
                ("holdUntil", n(hold_until)),
                ("dodges", n(dodges as f64)),
                ("jukes", n(jukes as f64)),
            ])
        }
        Suite::World | Suite::Retreat => obj(Vec::new()),
    }
}

pub(crate) fn encode_walk_answer(answer: &Option<WalkAnswer>) -> SVal {
    match answer {
        None => null(),
        Some(answer) => obj(vec![("dist", n(answer.dist)), ("exact", b(answer.exact))]),
    }
}

pub(crate) fn encode_method_value(value: &super::super::data::MethodValue) -> SVal {
    use super::super::data::MethodValue;
    match value {
        MethodValue::Undefined => undefined(),
        MethodValue::Null => null(),
        MethodValue::Bool(flag) => b(*flag),
        MethodValue::Num(number) => n(*number),
        MethodValue::Str(text) => s(text),
        MethodValue::Arr(items) => arr(items.iter().map(encode_method_value).collect()),
        MethodValue::Obj(fields) => SVal::Obj(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), encode_method_value(value)))
                .collect(),
        ),
    }
}

pub(crate) fn memory_timed_sv(command: &super::super::memory::MemoryTimedCommand) -> SVal {
    encode_method_value(&command.raw)
}

pub(crate) fn encode_memory_snapshot(mem: &super::super::memory::Memory) -> SVal {
    encode_memory(mem)
}

include!("source_memory_encoder.rs");

// ---------------------------------------------------------------------------------------------------------------------
// Declared comparison: exact bits/order/absence, plus the independently reviewed derived-geometry whitelist only.

/// The reviewed maximum absolute error for the explicitly enumerated derived geometry leaves (NUMERICS.md): retreat/
/// away/sidestep/juke/pick-spot points and the path service's continuous walk distance estimate.
pub(crate) const GEOMETRY_TOLERANCE: f64 = 2e-6;

/// Per-operation comparison context derived from the declared operation and its expected row.
pub(crate) struct CompareCtx {
    pub suite: Suite,
    pub method: &'static str,
    /// True for carried tagged MethodValue source values (callback arguments/results, Memory payloads, intent/status
    /// objects): their property insertion order is part of the frozen source value and is compared. False only for the
    /// plain fixed-schema corpus envelopes (drawCounts, and the compatibility corpora's plain envelope wrappers), whose
    /// JSON object order the serde envelope map does not preserve and which is not carried source data.
    pub ordered: bool,
    /// True when this operation's output carries geometry leaves computed through the whitelisted leaves (flee, sudden
    /// death keep-away, orb away/sidestep/juke, crowded coliseum spot).
    pub geometry: bool,
    /// True when the walk target may be the computed crowded coliseum spot (`to the coliseum spot` slots).
    pub coliseum_spot: bool,
    /// The declared hold/roam destination: a move to this exact point is a declared goal point and compares exact.
    pub declared_union: Option<Vec2>,
}

/// The reviewed whitelisted why strings: a `move.to` under only these reasons is a derived geometry leaf.
pub(crate) fn geometry_why(why: &str) -> bool {
    matches!(
        why,
        "flee"
            | "sudden death: ahead, keeping distance"
            | "orb-walk: step away after the shot"
            | "sidestep an incoming ball"
            | "sidestep an incoming arrow"
            | "juke the shot as it leaves"
            | "to the coliseum spot"
    )
}

fn within(expected: f64, actual: f64) -> bool {
    (expected - actual).abs() <= GEOMETRY_TOLERANCE
}

/// Check the ordered key sequence of a genuine tagged source object before any leaf-specific/tolerant field comparison.
/// Returns true when the key sequences match; every mismatch is recorded.
fn ordered_keys(
    label: &str,
    expected: &[(String, SVal)],
    actual: &[(String, SVal)],
    path: &str,
    failures: &mut Vec<String>,
) -> bool {
    let mut ok = expected.len() == actual.len();
    for (index, ((expected_key, _), (actual_key, _))) in
        expected.iter().zip(actual.iter()).enumerate()
    {
        if expected_key != actual_key {
            ok = false;
            fail(
                label,
                path,
                format!(
                    "object entry {index} order/name expected {expected_key} actual {actual_key}"
                ),
                failures,
            );
        }
    }
    ok
}

/// A plain derived point: exactly the two source entries `x`,`y` in source insertion order.
fn is_ordered_plain_point(value: &SVal) -> Option<Vec2> {
    let SVal::Obj(entries) = value else {
        return None;
    };
    if entries.len() != 2 || entries[0].0 != "x" || entries[1].0 != "y" {
        return None;
    }
    match (&entries[0].1, &entries[1].1) {
        (SVal::Num(x), SVal::Num(y)) => Some(Vec2::new(*x, *y)),
        _ => None,
    }
}

fn is_plain_point(value: &SVal) -> Option<Vec2> {
    let SVal::Obj(entries) = value else {
        return None;
    };
    if entries.len() != 2 {
        return None;
    }
    let x = entries.iter().find(|(key, _)| key == "x").map(|(_, v)| v)?;
    let y = entries.iter().find(|(key, _)| key == "y").map(|(_, v)| v)?;
    match (x, y) {
        (SVal::Num(x), SVal::Num(y)) => Some(Vec2::new(*x, *y)),
        _ => None,
    }
}

fn fail(label: &str, path: &str, message: impl Into<String>, failures: &mut Vec<String>) {
    failures.push(format!("{label}: {path}: {}", message.into()));
}

/// Ordered source-value equality for carried tagged values: object entries compare key AND insertion order, arrays/Map/
/// Set order compares as `source_reader::same`, scalars/undefined/null stay exact.
pub(crate) fn same_ordered(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Obj(a), SVal::Obj(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b.iter())
                    .all(|((ak, av), (bk, bv))| ak == bk && same_ordered(av, bv))
        }
        (SVal::Arr(a), SVal::Arr(b)) => same_ordered_seq(a, b),
        (SVal::Set(a), SVal::Set(b)) => same_ordered_seq(a, b),
        (SVal::Map(a), SVal::Map(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b.iter())
                    .all(|((ak, av), (bk, bv))| same_ordered(ak, bk) && same_ordered(av, bv))
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
                    .zip(e2.iter())
                    .all(|((ak, av), (bk, bv))| ak == bk && same_ordered(av, bv))
        }
        _ => source_reader::same(a, b),
    }
}
fn same_ordered_seq(a: &[SVal], b: &[SVal]) -> bool {
    a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| same_ordered(x, y))
}

/// Exact source-value comparison with the reviewed derived-geometry leaf allowance for direct point results.
/// Exact comparison of a carried tagged source value: object property insertion order is compared (see
/// [`compare_node`] docs), plus the reviewed derived-geometry allowance for direct point results.
pub(crate) fn compare_node(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    compare_value(label, expected, actual, ctx, path, ctx.ordered, failures);
}

/// Comparison of the plain fixed-schema corpus envelope (the `drawCounts` channel): its JSON object order is not carried
/// source data (the serde envelope map does not preserve it), so consumed keys compare as a set; values and all nested
/// arrays remain exact/ordered.
pub(crate) fn compare_envelope(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    compare_value(label, expected, actual, ctx, path, false, failures);
}

fn compare_value(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    ordered: bool,
    failures: &mut Vec<String>,
) {
    match (expected, actual) {
        (SVal::Num(expected), SVal::Num(actual)) => {
            if expected.to_bits() == actual.to_bits() {
                return;
            }
            let direct_point = (ctx.method == "point" && ctx.suite == Suite::Retreat)
                || (ctx.method == "pickHoldSpot" && ctx.suite == Suite::World);
            if direct_point
                && (path == "result.x" || path == "result.y")
                && within(*expected, *actual)
            {
                return;
            }
            fail(
                label,
                path,
                format!(
                    "expected {} bits {:016x}, actual {} bits {:016x}",
                    expected,
                    expected.to_bits(),
                    actual,
                    actual.to_bits()
                ),
                failures,
            );
        }
        (SVal::Obj(expected), SVal::Obj(actual)) => {
            if actual.len() != expected.len() {
                fail(
                    label,
                    path,
                    format!(
                        "object field count expected {} actual {}",
                        expected.len(),
                        actual.len()
                    ),
                    failures,
                );
                return;
            }
            if ordered {
                // Carried tagged source object: property insertion order is part of the frozen source value.
                for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                    expected.iter().zip(actual.iter()).enumerate()
                {
                    if expected_key != actual_key {
                        fail(
                            label,
                            path,
                            format!(
                                "object entry {index} order/name expected {expected_key} actual {actual_key}"
                            ),
                            failures,
                        );
                        continue;
                    }
                    compare_value(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        &format!("{path}.{expected_key}"),
                        ordered,
                        failures,
                    );
                }
            } else {
                for (key, expected_value) in expected {
                    match actual.iter().find(|(actual_key, _)| actual_key == key) {
                        Some((_, actual_value)) => compare_value(
                            label,
                            expected_value,
                            actual_value,
                            ctx,
                            &format!("{path}.{key}"),
                            ordered,
                            failures,
                        ),
                        None => fail(label, path, format!("missing field {key}"), failures),
                    }
                }
            }
        }
        (SVal::Arr(expected), SVal::Arr(actual)) => {
            if expected.len() != actual.len() {
                fail(
                    label,
                    path,
                    format!(
                        "array length expected {} actual {}",
                        expected.len(),
                        actual.len()
                    ),
                    failures,
                );
                return;
            }
            for (index, (expected_value, actual_value)) in
                expected.iter().zip(actual.iter()).enumerate()
            {
                compare_value(
                    label,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}[{index}]"),
                    ordered,
                    failures,
                );
            }
        }
        (SVal::Map(expected), SVal::Map(actual)) => {
            if expected.len() != actual.len() {
                fail(
                    label,
                    path,
                    format!(
                        "map length expected {} actual {}",
                        expected.len(),
                        actual.len()
                    ),
                    failures,
                );
                return;
            }
            for (index, ((expected_key, expected_value), (actual_key, actual_value))) in
                expected.iter().zip(actual.iter()).enumerate()
            {
                compare_value(
                    label,
                    expected_key,
                    actual_key,
                    ctx,
                    &format!("{path}[{index}].key"),
                    ordered,
                    failures,
                );
                compare_value(
                    label,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}[{index}].value"),
                    ordered,
                    failures,
                );
            }
        }
        _ => {
            if !source_reader::same(expected, actual) {
                fail(
                    label,
                    path,
                    format!("expected {expected:?} actual {actual:?}"),
                    failures,
                );
            }
        }
    }
}

/// A plain `{x,y}` point under a whitelisted derived-geometry leaf: the reviewed absolute allowance only.
fn compare_point_tolerant(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ordered_point: bool,
    path: &str,
    failures: &mut Vec<String>,
) {
    let (expected, actual) = if ordered_point {
        (
            is_ordered_plain_point(expected),
            is_ordered_plain_point(actual),
        )
    } else {
        (is_plain_point(expected), is_plain_point(actual))
    };
    let (Some(expected), Some(actual)) = (expected, actual) else {
        fail(
            label,
            path,
            "expected a plain derived point with the declared x,y source keys",
            failures,
        );
        return;
    };
    for (axis, expected, actual) in [("x", expected.x, actual.x), ("y", expected.y, actual.y)] {
        if expected.to_bits() != actual.to_bits() && !within(expected, actual) {
            fail(
                label,
                &format!("{path}.{axis}"),
                format!("expected {expected} actual {actual} (max abs {GEOMETRY_TOLERANCE})"),
                failures,
            );
        }
    }
}

/// Compare one source `Intent`, with the declared whitelist applied to its `move.to` geometry leaf.
pub(crate) fn compare_intent(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    let (SVal::Obj(expected), SVal::Obj(actual)) = (expected, actual) else {
        compare_node(label, expected, actual, ctx, path, failures);
        return;
    };
    let why = expected
        .iter()
        .find(|(key, _)| key == "why")
        .and_then(|(_, value)| match value {
            SVal::Str(why) => Some(why.as_str()),
            _ => None,
        })
        .unwrap_or("");
    let expected_to = expected
        .iter()
        .find(|(key, _)| key == "to")
        .map(|(_, value)| value);
    let declared_equal = expected_to
        .and_then(is_plain_point)
        .zip(ctx.declared_union)
        .is_some_and(|(point, declared)| {
            point.x.to_bits() == declared.x.to_bits() && point.y.to_bits() == declared.y.to_bits()
        });
    let tolerant_to = geometry_why(why) && !declared_equal;
    if ctx.ordered {
        let _ = ordered_keys(label, expected, actual, path, failures);
    }
    if actual.len() != expected.len() {
        fail(
            label,
            path,
            format!(
                "intent field count expected {} actual {}",
                expected.len(),
                actual.len()
            ),
            failures,
        );
        return;
    }
    for (key, expected_value) in expected {
        let Some((_, actual_value)) = actual.iter().find(|(actual_key, _)| actual_key == key)
        else {
            fail(
                label,
                &format!("{path}.{key}"),
                "missing intent field",
                failures,
            );
            continue;
        };
        if key == "to" && tolerant_to {
            let (expected_point, actual_point) = if ctx.ordered {
                (
                    is_ordered_plain_point(expected_value),
                    is_ordered_plain_point(actual_value),
                )
            } else {
                (is_plain_point(expected_value), is_plain_point(actual_value))
            };
            match (expected_point, actual_point) {
                (Some(expected_point), Some(actual_point)) => {
                    for (axis, expected, actual) in [
                        ("x", expected_point.x, actual_point.x),
                        ("y", expected_point.y, actual_point.y),
                    ] {
                        if expected.to_bits() != actual.to_bits() && !within(expected, actual) {
                            fail(
                                label,
                                &format!("{path}.to.{axis}"),
                                format!("expected {expected} actual {actual}"),
                                failures,
                            );
                        }
                    }
                }
                _ => compare_node(
                    label,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}.{key}"),
                    failures,
                ),
            }
            continue;
        }
        compare_node(
            label,
            expected_value,
            actual_value,
            ctx,
            &format!("{path}.{key}"),
            failures,
        );
    }
}

fn compare_intents(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    let (SVal::Arr(expected), SVal::Arr(actual)) = (expected, actual) else {
        compare_node(label, expected, actual, ctx, path, failures);
        return;
    };
    if expected.len() != actual.len() {
        fail(
            label,
            path,
            format!(
                "intent count expected {} actual {}",
                expected.len(),
                actual.len()
            ),
            failures,
        );
        return;
    }
    for (index, (expected_value, actual_value)) in expected.iter().zip(actual.iter()).enumerate() {
        compare_intent(
            label,
            expected_value,
            actual_value,
            ctx,
            &format!("{path}[{index}]"),
            failures,
        );
    }
}

/// Compare the source result channel for the declared operation.
pub(crate) fn compare_result(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    failures: &mut Vec<String>,
) {
    match ctx.method {
        "act" => {
            let (SVal::Obj(expected), SVal::Obj(actual)) = (expected, actual) else {
                compare_node(label, expected, actual, ctx, "result", failures);
                return;
            };
            if ctx.ordered {
                let _ = ordered_keys(label, expected, actual, "result", failures);
            }
            for (key, expected_value) in expected {
                let Some((_, actual_value)) =
                    actual.iter().find(|(actual_key, _)| actual_key == key)
                else {
                    fail(label, "result", format!("missing field {key}"), failures);
                    continue;
                };
                if key == "intents" {
                    compare_intents(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        "result.intents",
                        failures,
                    );
                } else {
                    compare_node(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        &format!("result.{key}"),
                        failures,
                    );
                }
            }
            if actual.len() != expected.len() {
                fail(label, "result", "act result field count differs", failures);
            }
        }
        "step" => {
            if matches!(expected, SVal::Null) || matches!(expected, SVal::Str(_)) {
                compare_node(label, expected, actual, ctx, "result", failures);
            } else {
                compare_intent(label, expected, actual, ctx, "result", failures);
            }
        }
        "check" => {
            if matches!(expected, SVal::Null) {
                compare_node(label, expected, actual, ctx, "result", failures);
                return;
            }
            let (SVal::Obj(expected), SVal::Obj(actual)) = (expected, actual) else {
                compare_node(label, expected, actual, ctx, "result", failures);
                return;
            };
            if ctx.ordered {
                let _ = ordered_keys(label, expected, actual, "result", failures);
            }
            for (key, expected_value) in expected {
                let Some((_, actual_value)) =
                    actual.iter().find(|(actual_key, _)| actual_key == key)
                else {
                    fail(label, "result", format!("missing field {key}"), failures);
                    continue;
                };
                if key == "intent" {
                    compare_intent(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        "result.intent",
                        failures,
                    );
                } else {
                    compare_node(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        &format!("result.{key}"),
                        failures,
                    );
                }
            }
            if actual.len() != expected.len() {
                fail(
                    label,
                    "result",
                    "check result field count differs",
                    failures,
                );
            }
        }
        "pickHoldSpot" | "point" => compare_node(label, expected, actual, ctx, "result", failures),
        _ => compare_node(label, expected, actual, ctx, "result", failures),
    }
}

/// Compare the ordered callback/RNG transcript of one operation (or of the constructor setup).
pub(crate) fn compare_callbacks(
    label: &str,
    expected: &SVal,
    trace: &TraceHandle,
    ctx: &CompareCtx,
    failures: &mut Vec<String>,
) {
    let actual = trace.borrow().encoded();
    let (SVal::Arr(expected), SVal::Arr(actual)) = (&expected, &actual) else {
        fail(label, "callbacks", "expected an event array", failures);
        return;
    };
    if expected.len() != actual.len() {
        fail(
            label,
            "callbacks",
            format!(
                "event count expected {} actual {} (first expected {:?}, first actual {:?})",
                expected.len(),
                actual.len(),
                expected.first(),
                actual.first()
            ),
            failures,
        );
        return;
    }
    for (index, (expected_event, actual_event)) in expected.iter().zip(actual.iter()).enumerate() {
        let path = format!("callbacks[{index}]");
        let (SVal::Obj(expected_event), SVal::Obj(actual_event)) = (expected_event, actual_event)
        else {
            compare_node(label, expected_event, actual_event, ctx, &path, failures);
            continue;
        };
        if actual_event.len() != expected_event.len() {
            fail(label, &path, "event field count differs", failures);
            continue;
        }
        if ctx.ordered {
            let _ = ordered_keys(label, expected_event, actual_event, &path, failures);
        }
        let name = expected_event
            .iter()
            .find(|(key, _)| key == "name")
            .and_then(|(_, value)| match value {
                SVal::Str(name) => Some(name.as_str()),
                _ => None,
            });
        for (key, expected_value) in expected_event {
            let Some((_, actual_value)) = actual_event
                .iter()
                .find(|(actual_key, _)| actual_key == key)
            else {
                fail(label, &path, format!("missing event field {key}"), failures);
                continue;
            };
            match key.as_str() {
                "args" => compare_callback_args(
                    label,
                    name,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}.args"),
                    failures,
                ),
                "result" => compare_callback_result(
                    label,
                    name,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}.result"),
                    failures,
                ),
                _ => compare_node(
                    label,
                    expected_value,
                    actual_value,
                    ctx,
                    &format!("{path}.{key}"),
                    failures,
                ),
            }
        }
    }
}

fn compare_callback_args(
    label: &str,
    name: Option<&str>,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    let (SVal::Arr(expected), SVal::Arr(actual)) = (expected, actual) else {
        compare_node(label, expected, actual, ctx, path, failures);
        return;
    };
    if expected.len() != actual.len() {
        fail(
            label,
            path,
            format!(
                "arg count expected {} actual {}",
                expected.len(),
                actual.len()
            ),
            failures,
        );
        return;
    }
    for (index, (expected_value, actual_value)) in expected.iter().zip(actual.iter()).enumerate() {
        let arg_path = format!("{path}[{index}]");
        let tolerant_point = index == 1
            && match name {
                // The retreat/away/sidestep clear leaves are derived geometry; fight waypoint clears are real route
                // coordinates and only reach here when the operation carries no whitelisted geometry leaf.
                Some("paths.clear") => ctx.geometry,
                // A computed crowded coliseum spot is a pickHoldSpot leaf.
                Some("paths.walk") => ctx.coliseum_spot,
                _ => false,
            };
        if tolerant_point
            && is_plain_point(expected_value).is_some()
            && is_plain_point(actual_value).is_some()
        {
            compare_point_tolerant(
                label,
                expected_value,
                actual_value,
                ctx.ordered,
                &arg_path,
                failures,
            );
            continue;
        }
        compare_node(
            label,
            expected_value,
            actual_value,
            ctx,
            &arg_path,
            failures,
        );
    }
}

fn compare_callback_result(
    label: &str,
    name: Option<&str>,
    expected: &SVal,
    actual: &SVal,
    ctx: &CompareCtx,
    path: &str,
    failures: &mut Vec<String>,
) {
    if name == Some("paths.walk") {
        match (expected, actual) {
            (SVal::Null, SVal::Null) => return,
            (SVal::Obj(expected), SVal::Obj(actual)) => {
                if ctx.ordered {
                    let _ = ordered_keys(label, expected, actual, path, failures);
                }
                for (key, expected_value) in expected {
                    let Some((_, actual_value)) =
                        actual.iter().find(|(actual_key, _)| actual_key == key)
                    else {
                        fail(label, path, format!("missing walk field {key}"), failures);
                        continue;
                    };
                    if key == "dist" {
                        if let (SVal::Num(expected), SVal::Num(actual)) =
                            (expected_value, actual_value)
                        {
                            if expected.to_bits() != actual.to_bits() && !within(*expected, *actual)
                            {
                                fail(
                                    label,
                                    &format!("{path}.dist"),
                                    format!("expected {expected} actual {actual}"),
                                    failures,
                                );
                            }
                            continue;
                        }
                    }
                    compare_node(
                        label,
                        expected_value,
                        actual_value,
                        ctx,
                        &format!("{path}.{key}"),
                        failures,
                    );
                }
                if actual.len() != expected.len() {
                    fail(label, path, "walk result field count differs", failures);
                }
                return;
            }
            _ => {
                compare_node(label, expected, actual, ctx, path, failures);
                return;
            }
        }
    }
    compare_node(label, expected, actual, ctx, path, failures);
}

/// Compare the cumulative per-stream draw counts of one operation.
pub(crate) fn compare_draw_counts(
    label: &str,
    expected: &SVal,
    counts: [u64; 4],
    failures: &mut Vec<String>,
) {
    let actual = obj(vec![
        ("decide", n(counts[0] as f64)),
        ("motor", n(counts[1] as f64)),
        ("lapse", n(counts[2] as f64)),
        ("knowledge", n(counts[3] as f64)),
    ]);
    let ctx = CompareCtx {
        suite: Suite::Tactics,
        method: "drawCounts",
        ordered: false,
        geometry: false,
        coliseum_spot: false,
        declared_union: None,
    };
    compare_envelope(label, expected, &actual, &ctx, "drawCounts", failures);
}

/// Compare the full Memory snapshot after one operation. Section-level diagnostics keep the first difference compact.
pub(crate) fn compare_memory(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    let (SVal::Obj(expected), SVal::Obj(actual)) = (expected, actual) else {
        failures.push(format!("{label}: non-object memory"));
        return;
    };
    if expected.iter().zip(actual.iter()).enumerate().any(
        |(index, ((expected_key, _), (actual_key, _)))| {
            if expected_key != actual_key {
                failures.push(format!(
                    "{label}: memory section {index} order/name expected {expected_key} actual {actual_key}"
                ));
                true
            } else {
                false
            }
        },
    ) || actual.len() != expected.len()
    {
        failures.push(format!(
            "{label}: memory section sequence expected {} actual {}",
            expected.len(),
            actual.len()
        ));
    }
    for (name, expected_value) in expected {
        let Some((_, actual_value)) = actual.iter().find(|(actual_key, _)| actual_key == name)
        else {
            failures.push(format!("{label}.{name}: missing native section"));
            continue;
        };
        if same_ordered(expected_value, actual_value) {
            continue;
        }
        let summary = match (expected_value, actual_value) {
            (SVal::Map(expected), SVal::Map(actual)) => {
                let detail = expected
                    .iter()
                    .find_map(|(expected_key, expected_value)| {
                        match actual
                            .iter()
                            .find(|(actual_key, _)| source_reader::same(actual_key, expected_key))
                        {
                            Some((_, actual_value))
                                if !same_ordered(expected_value, actual_value) =>
                            {
                                Some(format!(
                                    "first key {expected_key:?} expected={expected_value:?} actual={actual_value:?}"
                                ))
                            }
                            None => Some(format!("missing key {expected_key:?}")),
                            _ => None,
                        }
                    })
                    .unwrap_or_else(|| {
                        "same keys but map length/order differs".into()
                    });
                format!(
                    "map expected={} actual={}; {detail}",
                    expected.len(),
                    actual.len()
                )
            }
            (SVal::Arr(expected), SVal::Arr(actual)) => {
                format!("array expected={} actual={}", expected.len(), actual.len())
            }
            _ => format!("expected={expected_value:?} actual={actual_value:?}"),
        };
        failures.push(format!("{label}.{name}: {summary}"));
    }
    if actual.len() != expected.len() {
        failures.push(format!(
            "{label}: memory sections expected {} actual {}",
            expected.len(),
            actual.len()
        ));
    }
}

/// The declared direct-method result encoders for the suites whose results are not TacticsOutput.
pub(crate) fn encode_direct_result_method(method: &Method) -> &'static str {
    match method {
        Method::Observe(_) => "observe",
        Method::Act(_) => "act",
        Method::NoteSent(_) => "noteSent",
        Method::RecordChoice(_) => "recordChoice",
        Method::Step { .. } => "step",
        Method::Reset(_) => "reset",
        Method::Point(_) => "point",
        Method::Check => "check",
        Method::PickHoldSpot { .. } => "pickHoldSpot",
        Method::InReach { .. } => "inReach",
    }
}

#[allow(dead_code)]
fn unused_stimulus_kind(kind: StimulusKind) -> StimulusKind {
    kind
}

#[allow(dead_code)]
fn unused_intent_kind(kind: IntentKind) -> IntentKind {
    kind
}
