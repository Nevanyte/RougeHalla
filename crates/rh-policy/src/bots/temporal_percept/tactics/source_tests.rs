//! Declared-method replay harness for the frozen private-tactics witness (P-BOT-TACTICS-1).
//!
//! Every case recreates the real native closure from its declared config/map and replays the operations in order through
//! the real admitted Memory, the admitted Knowledge and the real path service: `observe` drives Memory and starts a fresh
//! path budget tick, `noteSent`/`recordChoice` call the real Memory methods, and every context method is the real private
//! tactical class. Compiled outputs are compared against the frozen expected channels only afterwards; expected rows never
//! feed native inputs. Recreate/reset determinism is checked by replaying the whole corpus twice and comparing the
//! produced transcripts bit for bit.

use std::path::Path;

use serde_json::Value;

use super::fight::{self as fight_mod, Fight};
use super::kite::{OrbFoe, OrbStep, OrbWalk, Reflexes, Retreat};
use super::source_decode::{decode_corpus, DecodedCase, DecodedCorpus, Method, OpEnv, Suite};
use super::source_reader::SVal;
use super::source_trace::{
    b, compare_callbacks, compare_draw_counts, compare_memory, compare_node, compare_result,
    create_knowledge_traced, encode_intent, encode_memory_snapshot, encode_stimuli,
    encode_tactics_stats, encode_vec2_point, obj, record_callback, s, undefined, CompareCtx,
    RecordedKnowledge, RecordedMemory, RecordedPaths, TraceDecide, TraceHandle, TraceLog,
};
use super::types::{
    FightKind, FightRef, Goal, TacticPercept, TacticsConfig, TacticsContext, TacticsError,
    TacticsOutput, TacticsStats,
};
use super::world::{pick_hold_spot, WorldTactics};
use super::Tactics;
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{PathBudget, RoomPathService};
use crate::bots::types::TierParams;
use rh_sim::Vec2;

const SOURCE_CASES: usize = 154;
const SOURCE_OPERATIONS: usize = 720;
const KNOWLEDGE_DRAWS: u64 = 70;

fn source_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-private-tactics/source.json")
}

fn load_source() -> Value {
    let text = std::fs::read_to_string(source_path()).expect("frozen private-tactics source.json");
    let source: Value = serde_json::from_str(&text).expect("valid private-tactics JSON");
    super::source_strict::validate_corpus(&source)
        .unwrap_or_else(|error| panic!("strict tactics corpus reader: {error}"));
    source
}

/// The declared map value for a decoded case (looked up by the raw config's map id).
pub(crate) fn case_map_value(corpus: &Corpus, index: usize) -> SVal {
    let raw_case = corpus.raw_case(index);
    let map_id = case_map_id(&raw_case);
    corpus
        .decoded
        .maps
        .iter()
        .find(|map| map.id == map_id)
        .map(|map| map.value.clone())
        .unwrap_or_else(|| panic!("case {index}: declared map {map_id}"))
}

/// Decode one tagged corpus leaf into SVal. The envelope is plain JSON; every payload leaf is MethodValue-tagged.
pub(crate) fn sv(value: &Value) -> SVal {
    if value
        .as_object()
        .is_some_and(|object| object.contains_key("$"))
    {
        return super::source_reader::parse(value, "corpus payload")
            .unwrap_or_else(|error| panic!("strict corpus decode: {error}"));
    }
    match value {
        Value::Null => SVal::Null,
        Value::Bool(flag) => SVal::Bool(*flag),
        Value::Number(_) => SVal::Num(
            value
                .as_f64()
                .filter(|number| number.is_finite())
                .expect("finite JSON number"),
        ),
        Value::String(text) => SVal::Str(text.clone()),
        Value::Array(entries) => SVal::Arr(entries.iter().map(sv).collect()),
        Value::Object(object) => SVal::Obj(
            object
                .iter()
                .map(|(key, value)| (key.clone(), sv(value)))
                .collect(),
        ),
    }
}

/// The map id a case's declared config names (read from the raw tagged config value).
fn case_map_id(raw_case: &Value) -> String {
    let config = sv(&raw_case["config"]);
    config
        .field("map", "config")
        .expect("config.map")
        .string("config.map")
        .expect("config.map string")
        .to_string()
}

pub(crate) struct Corpus {
    pub(crate) decoded: DecodedCorpus,
    raw: Value,
}

impl Corpus {
    pub(crate) fn load() -> Self {
        let raw = load_source();
        let decoded =
            decode_corpus(&raw).unwrap_or_else(|error| panic!("typed corpus decode: {error}"));
        let raw_cases = raw["cases"].as_array().expect("cases");
        assert_eq!(decoded.cases.len(), raw_cases.len(), "decoded case count");
        for (case, raw_case) in decoded.cases.iter().zip(raw_cases) {
            assert_eq!(case.id, raw_case["id"].as_str().unwrap());
            assert_eq!(
                case.operations.len(),
                raw_case["operations"].as_array().unwrap().len(),
                "{}: decoded/raw operation count",
                case.id
            );
        }
        Self { decoded, raw }
    }
    pub(crate) fn raw_case(&self, index: usize) -> Value {
        self.raw["cases"][index].clone()
    }
    pub(crate) fn raw(&self) -> &Value {
        &self.raw
    }
    pub(crate) fn case_index(&self, id: &str) -> usize {
        self.decoded
            .cases
            .iter()
            .position(|case| case.id == id)
            .unwrap_or_else(|| panic!("case {id}"))
    }
}

enum Objects {
    Tactics(Tactics),
    Fight(Fight),
    World(WorldTactics),
    Orb(OrbWalk),
    Reflex(Reflexes),
    Retreat(Retreat),
}

impl Objects {
    fn construct(suite: Suite) -> Self {
        match suite {
            Suite::Tactics => Self::Tactics(Tactics::new()),
            Suite::Fight => {
                Self::Fight(Fight::new(OrbWalk::new(), Reflexes::new(), Retreat::new()))
            }
            Suite::World => Self::World(WorldTactics::new()),
            Suite::Orb => Self::Orb(OrbWalk::new()),
            Suite::Reflex => Self::Reflex(Reflexes::new()),
            Suite::Retreat => Self::Retreat(Retreat::new()),
        }
    }
}

fn encode_suite_stats(objects: &Objects) -> SVal {
    match objects {
        Objects::Tactics(tactics) => {
            let encoded = encode_tactics_stats(tactics.get_stats());
            obj(vec![("stats", encoded.clone()), ("getStats", encoded)])
        }
        Objects::Fight(fight) => obj(vec![
            (
                "mobTargets",
                super::source_trace::n(fight.mob_targets() as f64),
            ),
            (
                "cycles",
                super::source_trace::n(fight.orb().cycles() as f64),
            ),
            (
                "holdUntil",
                super::source_trace::n(fight.reflexes().hold_until()),
            ),
            (
                "dodges",
                super::source_trace::n(fight.reflexes().dodges() as f64),
            ),
            (
                "jukes",
                super::source_trace::n(fight.reflexes().jukes() as f64),
            ),
        ]),
        Objects::Orb(orb) => obj(vec![(
            "cycles",
            super::source_trace::n(orb.cycles() as f64),
        )]),
        Objects::Reflex(reflexes) => obj(vec![
            ("holdUntil", super::source_trace::n(reflexes.hold_until())),
            ("dodges", super::source_trace::n(reflexes.dodges() as f64)),
            ("jukes", super::source_trace::n(reflexes.jukes() as f64)),
        ]),
        Objects::World(_) | Objects::Retreat(_) => obj(Vec::new()),
    }
}

fn initial_stats(suite: Suite) -> SVal {
    match suite {
        Suite::Tactics => {
            let zero = encode_tactics_stats(TacticsStats::default());
            obj(vec![("stats", zero.clone()), ("getStats", zero)])
        }
        Suite::Fight => obj(vec![
            ("mobTargets", super::source_trace::n(0.)),
            ("cycles", super::source_trace::n(0.)),
            ("holdUntil", super::source_trace::n(0.)),
            ("dodges", super::source_trace::n(0.)),
            ("jukes", super::source_trace::n(0.)),
        ]),
        Suite::Orb => obj(vec![("cycles", super::source_trace::n(0.))]),
        Suite::Reflex => obj(vec![
            ("holdUntil", super::source_trace::n(0.)),
            ("dodges", super::source_trace::n(0.)),
            ("jukes", super::source_trace::n(0.)),
        ]),
        Suite::World | Suite::Retreat => obj(Vec::new()),
    }
}

fn declared_union(method: &Method) -> Option<Vec2> {
    match method {
        Method::Act(Goal::Hold { at, .. }) | Method::Act(Goal::Roam { to: at, .. }) => Some(*at),
        _ => None,
    }
}

fn visit_why(value: &SVal, predicate: &dyn Fn(&str) -> bool) -> bool {
    match value {
        SVal::Obj(entries) => {
            if entries.iter().any(|(key, value)| {
                key == "why" && matches!(value, SVal::Str(why) if predicate(why))
            }) {
                return true;
            }
            entries.iter().any(|(_, value)| visit_why(value, predicate))
        }
        SVal::Arr(values) | SVal::Set(values) => {
            values.iter().any(|value| visit_why(value, predicate))
        }
        SVal::Map(entries) => entries
            .iter()
            .any(|(key, value)| visit_why(key, predicate) || visit_why(value, predicate)),
        SVal::Instance { entries, .. } => {
            entries.iter().any(|(_, value)| visit_why(value, predicate))
        }
        _ => false,
    }
}

fn has_geometry_leaf(expected: &SVal) -> bool {
    visit_why(expected, &super::source_trace::geometry_why)
}

/// Plain `{x,y}` tagged point coordinates (no ordering requirement; only used to classify a declared-vs-computed target).
fn plain_point_coords(value: &SVal) -> Option<Vec2> {
    let SVal::Obj(entries) = value else {
        return None;
    };
    let x = entries.iter().find(|(key, _)| key == "x").map(|(_, v)| v);
    let y = entries.iter().find(|(key, _)| key == "y").map(|(_, v)| v);
    match (x, y) {
        (Some(SVal::Num(x)), Some(SVal::Num(y))) => Some(Vec2::new(*x, *y)),
        _ => None,
    }
}

/// True only when the expected result's `to the coliseum spot` move target is an actually computed `pickHoldSpot` leaf:
/// the move target differs from the declared Hold goal endpoint. A direct declared Hold.at walk keeps
/// `coliseum_spot == false`, so its `paths.walk` argument (the declared endpoint) compares exact.
fn coliseum_spot_is_computed(expected: &SVal, declared_union: Option<Vec2>) -> bool {
    fn visit(value: &SVal, declared: Option<Vec2>, found: &mut bool) {
        match value {
            SVal::Obj(entries) => {
                let why = entries
                    .iter()
                    .find(|(key, _)| key == "why")
                    .and_then(|(_, value)| match value {
                        SVal::Str(why) => Some(why.as_str()),
                        _ => None,
                    });
                let target = entries
                    .iter()
                    .find(|(key, _)| key == "to")
                    .map(|(_, value)| value);
                if why == Some("to the coliseum spot") {
                    let direct_declared = target
                        .and_then(plain_point_coords)
                        .zip(declared)
                        .is_some_and(|(point, declared)| {
                            point.x.to_bits() == declared.x.to_bits()
                                && point.y.to_bits() == declared.y.to_bits()
                        });
                    if !direct_declared {
                        *found = true;
                    }
                }
                for (_, value) in entries {
                    visit(value, declared, found);
                }
            }
            SVal::Arr(values) | SVal::Set(values) => {
                for value in values {
                    visit(value, declared, found);
                }
            }
            SVal::Map(entries) => {
                for (key, value) in entries {
                    visit(key, declared, found);
                    visit(value, declared, found);
                }
            }
            SVal::Instance { entries, .. } => {
                for (_, value) in entries {
                    visit(value, declared, found);
                }
            }
            _ => {}
        }
    }
    let mut found = false;
    visit(expected, declared_union, &mut found);
    found
}

pub(crate) struct CaseRunner {
    suite: Suite,
    cfg: TacticsConfig,
    memory: super::super::memory::Memory,
    knowledge: Knowledge,
    paths: RecordedPaths,
    decide: TraceDecide,
    trace: TraceHandle,
    setup: TraceHandle,
    objects: Objects,
    percept: Option<TacticPercept>,
    failures: Vec<String>,
}

impl CaseRunner {
    pub(crate) fn create(case: &DecodedCase, map_value: SVal) -> Self {
        let trace = TraceLog::new_handle();
        let setup = TraceLog::new_handle();
        let tier: &'static TierParams = Box::leak(Box::new(case.config.tier));
        let memory = super::super::memory::Memory::new(super::super::memory::MemoryConfig {
            self_id: case.config.id.clone(),
            tier,
            map: super::super::memory::MemoryMap {
                camps: case.config.map.camps.clone(),
            },
            features: case.config.features.clone(),
        })
        .expect("valid declared Memory config");
        let knowledge =
            create_knowledge_traced(&case.config.tier, case.config.seed.wrapping_add(3), &setup);
        let paths = RecordedPaths {
            inner: RoomPathService::new(
                &case.config.map.tile_map,
                PathBudget::new(case.config.path_budget),
            ),
            env: OpEnv::default(),
            map_value,
            trace: trace.clone(),
        };
        let decide = TraceDecide::new(case.config.seed, trace.clone());
        Self {
            suite: case.suite,
            cfg: case.config.clone(),
            memory,
            knowledge,
            paths,
            decide,
            trace,
            setup,
            objects: Objects::construct(case.suite),
            percept: None,
            failures: Vec::new(),
        }
    }

    fn execute(&mut self, op: &super::source_decode::DecodedOp) -> Result<SVal, TacticsError> {
        let suite = self.suite;
        let engaged = op.engaged;
        let method = &op.method;
        match method {
            Method::Observe(input) => {
                let now = input.percept.now;
                let gates = input.percept.hud.gates_locked;
                record_callback(
                    &self.trace,
                    "paths.setFrame",
                    vec![super::source_trace::n(now), b(gates)],
                    undefined(),
                );
                self.paths.inner.set_frame(now, gates);
                self.paths.inner.budget_mut().start_tick();
                self.percept = Some(input.percept.clone());
                let stimuli = self
                    .memory
                    .observe(&input.memory)
                    .expect("admitted Memory observe")
                    .to_vec();
                Ok(encode_stimuli(&stimuli))
            }
            Method::NoteSent(input) => {
                self.memory
                    .note_sent(input.clone())
                    .expect("admitted Memory noteSent");
                Ok(undefined())
            }
            Method::RecordChoice(key) => {
                self.memory.record_choice(key);
                Ok(undefined())
            }
            _ => {
                let percept = self
                    .percept
                    .clone()
                    .expect("observe must precede a context method");
                let mut memory = RecordedMemory {
                    inner: &self.memory,
                    trace: self.trace.clone(),
                };
                let mut know = RecordedKnowledge {
                    inner: &self.knowledge,
                    trace: self.trace.clone(),
                };
                let mut ctx = TacticsContext {
                    cfg: &self.cfg,
                    p: &percept,
                    mem: &mut memory,
                    know: &mut know,
                    paths: &mut self.paths,
                    decide: &mut self.decide,
                    engaged,
                };
                match method {
                    Method::Act(goal) => match &mut self.objects {
                        Objects::Tactics(tactics) => {
                            tactics.act(&mut ctx, goal).map(|out| encode_output(&out))
                        }
                        Objects::Fight(fight) => {
                            let reference = fight_ref(goal);
                            Ok(encode_output(&fight.act(
                                &mut ctx,
                                &reference,
                                op.knows_sudden_death,
                            )))
                        }
                        _ => panic!("act is not a method of the {suite:?} suite"),
                    },
                    Method::Step {
                        foe,
                        weapon,
                        locked,
                    } => match &mut self.objects {
                        Objects::Orb(orb) => {
                            let step = orb.step(
                                &mut ctx,
                                OrbFoe {
                                    id: &foe.0,
                                    x: foe.1.x,
                                    y: foe.1.y,
                                },
                                *weapon,
                                *locked,
                            );
                            Ok(match step {
                                OrbStep::Wait => s("wait"),
                                OrbStep::Order(intent) => encode_intent(&intent),
                                OrbStep::None => super::source_trace::null(),
                            })
                        }
                        _ => panic!("step is not a method of the {suite:?} suite"),
                    },
                    Method::Reset(ready_at) => match &mut self.objects {
                        Objects::Orb(orb) => {
                            orb.reset(ready_at.expect("orb reset carries readyAt"));
                            Ok(undefined())
                        }
                        Objects::Retreat(retreat) => {
                            retreat.reset();
                            Ok(undefined())
                        }
                        _ => panic!("reset is not a method of the {suite:?} suite"),
                    },
                    Method::Point(threats) => match &mut self.objects {
                        Objects::Retreat(retreat) => {
                            let point = retreat.point(&mut ctx, threats);
                            Ok(point
                                .map(encode_vec2_point)
                                .unwrap_or_else(super::source_trace::null))
                        }
                        _ => panic!("point is not a method of the {suite:?} suite"),
                    },
                    Method::Check => match &mut self.objects {
                        Objects::Reflex(reflexes) => {
                            let found = reflexes.check(&mut ctx);
                            Ok(match found {
                                None => super::source_trace::null(),
                                Some(reflex) => obj(vec![
                                    ("kind", s(reflex.kind.as_str())),
                                    ("holdUntil", super::source_trace::n(reflexes.hold_until())),
                                    ("intent", encode_intent(&reflex.intent)),
                                ]),
                            })
                        }
                        _ => panic!("check is not a method of the {suite:?} suite"),
                    },
                    Method::PickHoldSpot { centre, radius } => match &mut self.objects {
                        Objects::World(_) => Ok(encode_vec2_point(pick_hold_spot(
                            &mut ctx, *centre, *radius,
                        ))),
                        _ => panic!("pickHoldSpot is not a method of the {suite:?} suite"),
                    },
                    Method::InReach { foe, weapon } => match &mut self.objects {
                        Objects::Fight(_) => Ok(b(fight_mod::in_reach(
                            &mut ctx,
                            fight_mod::ReachFoe {
                                x: foe.0,
                                y: foe.1,
                                los: foe.2,
                            },
                            *weapon,
                        ))),
                        _ => panic!("inReach is not a method of the {suite:?} suite"),
                    },
                    Method::Observe(_) | Method::NoteSent(_) | Method::RecordChoice(_) => {
                        unreachable!("handled above")
                    }
                }
            }
        }
    }

    /// The ONE checked decode/apply entry: decode the declared operation declaration through the same strict typed intake
    /// normal replay uses, and only after that intake succeeds reset the per-operation trace/environment and execute the
    /// real native method. A rejected declaration mutates nothing: no trace reset, no env change, no Memory/RNG/callback/
    /// path-budget/state effect.
    pub(crate) fn apply_checked(
        &mut self,
        declaration: &Value,
    ) -> Result<(super::source_decode::DecodedOp, Result<SVal, TacticsError>), ApplyError> {
        let decoded =
            super::source_decode::decode_declaration_checked(declaration, self.suite, &self.cfg)
                .map_err(ApplyError::Intake)?;
        // Intake succeeded: now (and only now) start the operation's transcript/environment.
        self.trace.borrow_mut().reset();
        self.paths.env = decoded.env;
        let result = self.execute(&decoded);
        Ok((decoded, result))
    }

    /// The complete native state snapshot used by the intake non-advance controls: delivered Memory, retained
    /// counters, the full ordered callback/RNG transcript, the decision-stream ordinal, path counters and path budget,
    /// and the observed-percept identity.
    pub(crate) fn snapshot(&self) -> NativeSnapshot {
        NativeSnapshot {
            memory: format!("{:?}", encode_memory_snapshot(&self.memory)),
            stats: format!("{:?}", encode_suite_stats(&self.objects)),
            decide_draws: self.decide.draws(),
            path_stats: format!(
                "{:?}",
                (
                    self.paths.inner.stats().searches,
                    self.paths.inner.stats().hits,
                    self.paths.inner.stats().fallbacks,
                )
            ),
            path_budget_left: self.paths.inner.budget().left(),
            callbacks: match self.trace.borrow().encoded() {
                SVal::Arr(values) => values.len(),
                _ => 0,
            },
            trace: format!("{:?}", self.trace.borrow().encoded()),
            percept: self.percept.as_ref().map(|p| format!("{p:?}")),
            rng_next_decide: {
                let mut probe = crate::bots::random::Rng::new(self.cfg.seed);
                for _ in 0..self.decide.draws() {
                    probe.next_f64();
                }
                format!("{:016x}", probe.next_f64().to_bits())
            },
            knowledge_fingerprint: {
                let mut edges = Vec::new();
                for a in rh_sim::WeaponId::ALL {
                    for b in rh_sim::WeaponId::ALL {
                        edges.push(format!(
                            "{}:{}",
                            a.as_str(),
                            crate::bots::knowledge::Knowledge::weapon_edge(
                                &self.knowledge,
                                super::types::to_bot_weapon(a),
                                super::types::to_bot_weapon(b),
                            )
                        ));
                    }
                }
                edges.join(",")
            },
            env: format!("{:?}", self.paths.env),
        }
    }

    /// Apply one declared operation through [`Self::apply_checked`] and return its encoded native transcript line.
    pub(crate) fn apply_transcript(&mut self, declaration: &Value) -> Result<String, ApplyError> {
        let (decoded, result) = self.apply_checked(declaration)?;
        Ok(format!(
            "{:?} result={result:?} memory={:?} callbacks={:?} stats={:?}",
            decoded.method,
            encode_memory_snapshot(&self.memory),
            self.trace.borrow().encoded(),
            encode_suite_stats(&self.objects),
        ))
    }

    /// The retained decision-stream draw count (per-case cumulative).
    pub(crate) fn decide_draws(&self) -> usize {
        self.decide.draws()
    }

    /// The real path service counters (searches, hits, fallbacks).
    pub(crate) fn path_stats(&self) -> (u64, u64, u64) {
        let stats = self.paths.inner.stats();
        (stats.searches, stats.hits, stats.fallbacks)
    }

    /// The ordered callback/RNG transcript recorded for the current operation.
    pub(crate) fn trace_events(&self) -> usize {
        match self.trace.borrow().encoded() {
            SVal::Arr(values) => values.len(),
            _ => 0,
        }
    }

    fn check_row(
        &mut self,
        case_id: &str,
        op_index: usize,
        expected: &Value,
        decoded: &Method,
        result: &Result<SVal, TacticsError>,
    ) {
        let method = super::source_trace::encode_direct_result_method(decoded);
        let label = format!("{case_id}[{op_index}] {method}");
        let expected_result = sv(&expected["result"]);
        let ctx = CompareCtx {
            suite: self.suite,
            method,
            ordered: true,
            geometry: has_geometry_leaf(&expected_result),
            coliseum_spot: coliseum_spot_is_computed(&expected_result, declared_union(decoded)),
            declared_union: declared_union(decoded),
        };
        let expected_thrown = expected.get("thrown");
        match (result, expected_thrown) {
            (Ok(actual), None) => {
                compare_result(&label, &expected_result, actual, &ctx, &mut self.failures);
            }
            (Err(error), Some(thrown)) => {
                let name = thrown["name"].as_str().unwrap_or("");
                let message = thrown["message"].as_str().unwrap_or("");
                if error.thrown_name() != name || error.thrown_message() != message {
                    self.failures.push(format!(
                        "{label}: thrown expected {name}: {message}, actual {}: {}",
                        error.thrown_name(),
                        error.thrown_message()
                    ));
                }
                compare_result(
                    &label,
                    &expected_result,
                    &undefined(),
                    &ctx,
                    &mut self.failures,
                );
            }
            (Ok(actual), Some(thrown)) => {
                self.failures.push(format!(
                    "{label}: expected thrown {thrown}, native returned {actual:?}"
                ));
            }
            (Err(error), None) => {
                self.failures.push(format!(
                    "{label}: unexpected native error {}: {}",
                    error.thrown_name(),
                    error.thrown_message()
                ));
            }
        }
        let expected_memory = sv(&expected["memory"]);
        let actual_memory = encode_memory_snapshot(&self.memory);
        compare_memory(
            &format!("{label} memory"),
            &expected_memory,
            &actual_memory,
            &mut self.failures,
        );
        let expected_stats = sv(&expected["stats"]);
        let actual_stats = encode_suite_stats(&self.objects);
        compare_node(
            &format!("{label} stats"),
            &expected_stats,
            &actual_stats,
            &ctx,
            "stats",
            &mut self.failures,
        );
        let expected_callbacks = sv(&expected["callbacks"]);
        compare_callbacks(
            &format!("{label} callbacks"),
            &expected_callbacks,
            &self.trace,
            &ctx,
            &mut self.failures,
        );
        let expected_counts = sv(&expected["drawCounts"]);
        compare_draw_counts(
            &format!("{label} draws"),
            &expected_counts,
            [self.decide.draws() as u64, 0, 0, KNOWLEDGE_DRAWS],
            &mut self.failures,
        );
        let expected_path_stats = sv(&expected["pathStats"]);
        let stats = self.paths.inner.stats();
        let actual_path_stats = obj(vec![
            ("searches", super::source_trace::n(stats.searches as f64)),
            ("hits", super::source_trace::n(stats.hits as f64)),
            ("fallbacks", super::source_trace::n(stats.fallbacks as f64)),
        ]);
        compare_node(
            &format!("{label} pathStats"),
            &expected_path_stats,
            &actual_path_stats,
            &ctx,
            "pathStats",
            &mut self.failures,
        );
    }
}

fn encode_output(output: &TacticsOutput) -> SVal {
    super::source_trace::encode_output(output)
}

fn fight_ref(goal: &Goal) -> FightRef {
    match goal {
        Goal::Farm { mob, .. } => FightRef {
            id: mob.clone(),
            kind: FightKind::Farm,
        },
        Goal::Hunt { target } => FightRef {
            id: target.clone(),
            kind: FightKind::Hunt,
        },
        Goal::Fight { target } => FightRef {
            id: target.clone(),
            kind: FightKind::Fight,
        },
        other => panic!("fight suite act goal must be a FightRef, got {other:?}"),
    }
}

/// Replay one declared case with the given raw expected case row; returns comparison failures and the native
/// transcript (encoded results/memory/callbacks) of the operations it actually executed.
pub(crate) fn replay_case(
    corpus: &Corpus,
    index: usize,
    raw_case: &Value,
) -> (Vec<String>, Vec<String>) {
    let case = &corpus.decoded.cases[index];
    let mut failures: Vec<String> = Vec::new();
    let mut transcript: Vec<String> = Vec::new();
    let map_id = case_map_id(raw_case);
    let map_value = corpus
        .decoded
        .maps
        .iter()
        .find(|map| map.id == map_id)
        .map(|map| map.value.clone())
        .unwrap_or_else(|| panic!("{}: declared map {map_id}", case.id));
    let mut runner = CaseRunner::create(case, map_value);
    let setup_ctx = CompareCtx {
        suite: case.suite,
        method: "setup",
        ordered: true,
        geometry: false,
        coliseum_spot: false,
        declared_union: None,
    };
    let expected_setup = sv(&raw_case["setupTranscript"]);
    compare_callbacks(
        &format!("{} setupTranscript", case.id),
        &expected_setup,
        &runner.setup,
        &setup_ctx,
        &mut runner.failures,
    );
    let expected_initial_memory = sv(&raw_case["initial"]["memory"]);
    let actual_initial_memory = encode_memory_snapshot(&runner.memory);
    compare_memory(
        &format!("{} initial.memory", case.id),
        &expected_initial_memory,
        &actual_initial_memory,
        &mut runner.failures,
    );
    let expected_initial_stats = sv(&raw_case["initial"]["stats"]);
    let actual_initial_stats = initial_stats(case.suite);
    compare_node(
        &format!("{} initial.stats", case.id),
        &expected_initial_stats,
        &actual_initial_stats,
        &setup_ctx,
        "initial.stats",
        &mut runner.failures,
    );
    let raw_operations = raw_case["operations"].as_array().expect("operations");
    assert_eq!(
        raw_operations.len(),
        case.operations.len(),
        "{}: raw/decoded operation count",
        case.id
    );
    for (op_index, raw_op) in raw_operations.iter().enumerate() {
        // Normal replay itself goes through the ONE checked decode/apply entry, exactly like an injected operation.
        let declaration = &raw_op["declaration"];
        match runner.apply_checked(declaration) {
            Err(error) => failures.push(format!(
                "{}[{op_index}] declared corpus operation rejected: {error}",
                case.id
            )),
            Ok((decoded_op, result)) => {
                runner.check_row(&case.id, op_index, raw_op, &decoded_op.method, &result);
                transcript.push(format!(
                    "{}[{}] method={:?} result={result:?} memory={:?} callbacks={:?} stats={:?}",
                    case.id,
                    op_index,
                    decoded_op.method,
                    encode_memory_snapshot(&runner.memory),
                    runner.trace.borrow().encoded(),
                    encode_suite_stats(&runner.objects),
                ));
            }
        }
    }
    failures.append(&mut runner.failures);
    (failures, transcript)
}

/// Execute one raw declared case's operations on the real native classes through [`CaseRunner::apply_checked`] and
/// return only the native transcript (no comparison). A changed declared input must change real execution.
pub(crate) fn run_native_case(
    raw_case: &Value,
    case: &DecodedCase,
    map_value: SVal,
) -> Result<Vec<String>, String> {
    let mut runner = CaseRunner::create(case, map_value);
    let mut transcript = Vec::new();
    let raw_operations = raw_case["operations"].as_array().expect("operations");
    for raw_op in raw_operations {
        match runner.apply_transcript(&raw_op["declaration"]) {
            Ok(line) => transcript.push(line),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(transcript)
}

/// Replay `count` declared operations of a raw case through the same checked entry, returning the native transcript
/// lines so far and the reached mutable runner. `count` may be the full operation count.
pub(crate) fn reached_runner(
    raw_case: &Value,
    case: &DecodedCase,
    map_value: SVal,
    count: usize,
) -> Result<(Vec<String>, CaseRunner), String> {
    let mut runner = CaseRunner::create(case, map_value);
    let raw_operations = raw_case["operations"].as_array().expect("operations");
    let mut transcript = Vec::new();
    for raw_op in raw_operations.iter().take(count) {
        match runner.apply_transcript(&raw_op["declaration"]) {
            Ok(line) => transcript.push(line),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok((transcript, runner))
}

/// The native execution snapshot used by the intake non-advance controls.
#[derive(Debug, PartialEq)]
pub(crate) struct NativeSnapshot {
    pub memory: String,
    pub stats: String,
    pub decide_draws: usize,
    pub path_stats: String,
    pub path_budget_left: u32,
    pub callbacks: usize,
    /// Full ordered callback/RNG transcript encoding.
    pub trace: String,
    /// The currently observed declared percept identity (None before the first observe).
    pub percept: Option<String>,
    /// The next declared decide value after the retained ordinal (independent replay of the same seeded stream).
    pub rng_next_decide: String,
    /// Direct retained Knowledge state fingerprint: every weapon-edge answer of the real admitted instance.
    pub knowledge_fingerprint: String,
    /// The current declared operation environment (path denial/empty route descriptor).
    pub env: String,
}

/// A rejected typed intake (the declaration never reached a state mutation).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ApplyError {
    Intake(String),
}
impl std::fmt::Display for ApplyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Intake(error) => write!(f, "typed intake rejected: {error}"),
        }
    }
}

fn replay_all(corpus: &Corpus) -> (usize, usize, Vec<String>, Vec<String>) {
    let mut failures: Vec<String> = Vec::new();
    let mut transcript: Vec<String> = Vec::new();
    let mut operations = 0usize;
    for index in 0..corpus.decoded.cases.len() {
        let raw_case = corpus.raw_case(index);
        let (case_failures, case_transcript) = replay_case(corpus, index, &raw_case);
        operations += corpus.decoded.cases[index].operations.len();
        transcript.extend(case_transcript);
        failures.extend(case_failures);
    }
    if corpus.decoded.cases.len() != SOURCE_CASES {
        failures.push(format!(
            "source case total expected {SOURCE_CASES} got {}",
            corpus.decoded.cases.len()
        ));
    }
    if operations != SOURCE_OPERATIONS {
        failures.push(format!(
            "source method total expected {SOURCE_OPERATIONS} got {operations}"
        ));
    }
    transcript.push(format!("FAILURES:{}", failures.len()));
    transcript.push(format!(
        "TRANSCRIPT_HASH:{:016x}",
        fnv64(&transcript.join("\n"))
    ));
    (corpus.decoded.cases.len(), operations, transcript, failures)
}

fn fnv64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn into_green(label: &str, cases: usize, operations: usize, failures: Vec<String>) {
    eprintln!(
        "PARITY_TOTAL {label}: {cases} cases / {operations} operations / {} failures",
        failures.len()
    );
    if !failures.is_empty() {
        for failure in failures.iter().take(60) {
            eprintln!("MISMATCH {failure}");
        }
        panic!(
            "{label}: {} mismatched channels (first: {})",
            failures.len(),
            failures.first().cloned().unwrap_or_default()
        );
    }
}

#[test]
fn private_tactics_source_parity() {
    let corpus = Corpus::load();
    let (cases, operations, _transcript, failures) = replay_all(&corpus);
    into_green("private-tactics source parity", cases, operations, failures);
}

#[test]
fn private_tactics_source_recreate_is_exact() {
    let corpus = Corpus::load();
    let first = replay_all(&corpus);
    let second = replay_all(&corpus);
    assert_eq!(
        first.2, second.2,
        "recreate with the same seeds/inputs must replay identically"
    );
    let (cases, operations, _transcript, failures) = second;
    into_green(
        "private-tactics source recreate",
        cases,
        operations,
        failures,
    );
}
