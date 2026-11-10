//! Complete source hazards feature module (`brain/modules/hazards.ts`) over the leased shared hazard core.
//!
//! The source module object keeps one hazard state per **cfg object identity** (`WeakMap<object, HazardState>`): this
//! adapter's `states` map is keyed by the declared `CfgToken`, so equal-valued distinct configs isolate state and the
//! same token continues it exactly as source. Its hooks are exactly the source object's own keys (`enabled`, `intents`,
//! `adjust`). Every fact comes from the earned private context (`p.self`, `p.hud`, `p.now`, `ctx.mem.self.stillSince`,
//! `ctx.cfg.persona.reengageHp`, `ctx.engaged`) and every path call is the caller's real `ModulePaths` service at the
//! source call point. No `Observation`, `PlayerId` or synthetic percept is fabricated here and no authoritative
//! movement/terrain rule lives here: the module proposes policy intents only.
//!
//! The transitions themselves are not re-implemented: `crate::bots::hazards::source_core` is the one fact/service core,
//! and the public `Hazards` state struct is reused directly as the per-cfg state.

use std::borrow::Cow;
use std::collections::BTreeMap;

use super::types::{
    dist, CfgToken, Features, Goal, HoldWhy, Intent, ModuleContext, ModuleId, ModulePaths,
    SourceModule,
};
use crate::bots::hazards::{source_core, Goal as HazardGoal, Hazards};
use rh_sim::{FactionId, TileMap, Vec2};

/// The source `hazardsModule`: one module instance serves every bot of a room, with state per cfg identity.
#[derive(Default)]
pub(crate) struct HazardsModule {
    states: BTreeMap<CfgToken, Hazards>,
}

impl HazardsModule {
    /// Source `me.faction` spelling -> home faction only for the known five names. Any other spelling (including the
    /// empty spelling retained for a null faction) has no home rule and is never coerced to a recognized faction.
    fn home(faction_text: &str) -> Option<FactionId> {
        source_core::faction_of_text(faction_text)
    }

    /// The source hook facts, delivered by the earning private context.
    fn facts(ctx: &ModuleContext<'_>, goal: HazardGoal) -> source_core::Facts {
        let me = &ctx.p.self_;
        source_core::Facts {
            now: ctx.p.now,
            pos: me.pos(),
            status_alive: ctx.p.alive(),
            faction_present: !me.faction_text.is_empty(),
            home: Self::home(&me.faction_text),
            hp: me.hp,
            max_hp: me.max_hp,
            attack_target: me.attack_target.is_some(),
            phase_active: ctx.p.hud.phase == "active",
            in_coliseum: ctx.p.hud.in_coliseum,
            goal,
            engaged: ctx.engaged,
            reengage_hp: ctx.cfg.persona.reengage_hp,
            still_since: ctx.mem.self_memory().still_since,
        }
    }
}

/// The source hazard goal subset (`goal.kind` plus a hold's `why`); everything else is `other`.
fn hazard_goal(goal: &Goal) -> HazardGoal {
    match goal {
        Goal::Loot { .. } => HazardGoal::Loot,
        Goal::Hold {
            why: HoldWhy::Ambush,
            ..
        } => HazardGoal::HoldAmbush,
        Goal::Hold {
            why: HoldWhy::Wait, ..
        } => HazardGoal::HoldWait,
        _ => HazardGoal::Other,
    }
}

/// The caller's declared path service exposed as the core's two source callbacks.
struct Paths<'a> {
    paths: &'a dyn ModulePaths,
}
impl source_core::Services for Paths<'_> {
    fn collision_map(&self) -> &TileMap {
        self.paths.collision_map()
    }
    fn clear(&self, a: Vec2, b: Vec2) -> bool {
        self.paths.clear(a, b)
    }
}

impl SourceModule for HazardsModule {
    fn id(&self) -> &'static str {
        "hazards"
    }
    fn enabled(&self, features: &Features) -> bool {
        features.hazards
    }
    fn hooks(&self) -> &'static [&'static str] {
        ModuleId::Hazards.hooks()
    }
    fn intents(&mut self, ctx: &mut ModuleContext<'_>, goal: &Goal) -> Vec<Intent> {
        let facts = Self::facts(ctx, hazard_goal(goal));
        let state = self.states.entry(ctx.cfg.token).or_default();
        let services = Paths { paths: &*ctx.paths };
        source_core::intents(state, &facts, &services, ctx.cfg.terrain, &dist)
            .map(source_core::intent)
            .into_iter()
            .collect()
    }
    fn adjust<'a>(
        &mut self,
        ctx: &mut ModuleContext<'_>,
        _goal: &Goal,
        intents: &'a [Intent],
    ) -> Cow<'a, [Intent]> {
        let facts = Self::facts(ctx, HazardGoal::Other);
        let services = Paths { paths: &*ctx.paths };
        source_core::adjust(&facts, &services, ctx.cfg.terrain, intents, &dist)
    }
}

// ----------------------------------------------------------------------------------------------------------- witnesses

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use serde_json::{json, Value};

    use super::super::types::{
        MemoryApi, ModuleConfig, ModuleHud, ModulePercept, ModuleSelf, RngLanes, RngStream,
    };
    use super::*;
    use crate::bots::hazards as public_hazards;
    use crate::bots::hazards::source_core::fixture;
    use crate::bots::paths::{PathBudget, RoomPathService, WalkAnswer};
    use crate::bots::planning::PlanMap;
    use crate::bots::temporal_percept::data::MethodValue;
    use crate::bots::temporal_percept::memory::{
        CampMemory, ContainerMemory, FighterMemory, MobMemory, SelfMemory, Whereabouts,
    };
    use crate::bots::types::{
        Intent, IntentBody, IntentTiming, PersonaId, PersonaParams, TierId, TierParams,
    };
    use rh_sim::TileMap;

    // --------------------------------------------------------------------------------------------- recording harness

    /// One declared path-service call, in source call order.
    #[derive(Debug, PartialEq)]
    enum PathCall {
        CollisionMap,
        Clear(Vec2, Vec2, bool),
    }

    /// The real admitted `RoomPathService` with every declared callback recorded in order.
    struct RecordingPaths {
        service: RoomPathService,
        calls: RefCell<Vec<PathCall>>,
    }
    impl RecordingPaths {
        fn new(map: &TileMap) -> Self {
            Self {
                service: RoomPathService::new(map, PathBudget::new(20)),
                calls: RefCell::new(Vec::new()),
            }
        }
        fn take(&self) -> Vec<PathCall> {
            std::mem::take(&mut *self.calls.borrow_mut())
        }
    }
    impl ModulePaths for RecordingPaths {
        fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
            self.service.walk(from, to)
        }
        fn path(&mut self, from: Vec2, to: Vec2) -> Option<Vec<Vec2>> {
            self.service.path(from, to)
        }
        fn los(&self, a: Vec2, b: Vec2) -> bool {
            self.service.los(a, b)
        }
        fn clear(&self, a: Vec2, b: Vec2) -> bool {
            let result = self.service.clear(a, b);
            self.calls.borrow_mut().push(PathCall::Clear(a, b, result));
            result
        }
        fn collision_map(&self) -> &TileMap {
            self.calls.borrow_mut().push(PathCall::CollisionMap);
            self.service.collision_map()
        }
    }

    /// The declared Memory surface; the hazards module reads only `self.stillSince`.
    struct TestMemory {
        self_memory: SelfMemory,
    }
    impl TestMemory {
        fn new() -> Self {
            Self {
                self_memory: SelfMemory {
                    last_hit_at: None,
                    last_hit_by_player_at: None,
                    last_dealt_at: None,
                    recent_damage: 0.,
                    recent_hits: Vec::new(),
                    teleported_at: None,
                    last_order: None,
                    last_cast: None,
                    still_since: 0.,
                },
            }
        }
    }
    impl MemoryApi for TestMemory {
        fn fighters(&self) -> &[(String, FighterMemory)] {
            &[]
        }
        fn mobs(&self) -> &[(String, MobMemory)] {
            &[]
        }
        fn camps(&self) -> &[(String, CampMemory)] {
            &[]
        }
        fn containers(&self) -> &[(String, ContainerMemory)] {
            &[]
        }
        fn self_memory(&self) -> &SelfMemory {
            &self.self_memory
        }
        fn stimuli(&self) -> &[crate::bots::types::Stimulus] {
            &[]
        }
        fn bounties(&self) -> &[(String, f64)] {
            &[]
        }
        fn choices(&self) -> &[String] {
            &[]
        }
        fn whereabouts(&self, _id: &str, _now: f64) -> Option<Whereabouts> {
            None
        }
    }

    /// The hazards module consumes no RNG lane; a draw is a source mismatch.
    struct NoRng;
    impl RngStream for NoRng {
        fn draw(&mut self) -> f64 {
            panic!("the hazards module must not consume an RNG lane")
        }
    }

    struct Harness {
        map: TileMap,
        terrain: Vec<u8>,
        tier: &'static TierParams,
        persona: &'static PersonaParams,
        plan_map: PlanMap,
        features: Features,
        memory: TestMemory,
        paths: RecordingPaths,
        percept: ModulePercept,
    }
    impl Harness {
        fn new(map: &TileMap) -> Self {
            let features = Features {
                hazards: true,
                ..Features::default()
            };
            let percept = percept_of(&features, &json!({}));
            let terrain = map.layers().map_or_else(
                || vec![0; map.w as usize * map.h as usize],
                |layers| layers.data().terrain.clone(),
            );
            Self {
                map: map.clone(),
                terrain,
                tier: TierParams::by_id(TierId::Hard),
                persona: PersonaParams::by_id(PersonaId::Hunter),
                plan_map: PlanMap::default(),
                features,
                memory: TestMemory::new(),
                paths: RecordingPaths::new(map),
                percept,
            }
        }

        /// Apply one declared corpus row spec: owner position/status/faction/hp/lock, HUD, now and `still` (the
        /// declared standing age; `stillSince = now - still`).
        fn apply(&mut self, spec: &Value) {
            self.percept = percept_of(&self.features, spec);
            self.memory.self_memory.still_since =
                self.percept.now - spec["still"].as_f64().unwrap_or(1000.);
        }
    }

    fn config_of<'a>(
        token: u64,
        map: &'a TileMap,
        terrain: &'a [u8],
        tier: &'a TierParams,
        persona: &'a PersonaParams,
        plan_map: &'a PlanMap,
        features: &'a Features,
    ) -> ModuleConfig<'a> {
        ModuleConfig {
            token: CfgToken(token),
            id: "me".into(),
            tier,
            persona,
            map,
            terrain,
            plan_map,
            features,
            learned: &(),
        }
    }

    fn no_log(_: &str) {}

    fn terrain_of(map: &TileMap) -> &[u8] {
        map.layers()
            .map_or(&[], |layers| layers.data().terrain.as_slice())
    }

    fn percept_of(features: &Features, spec: &Value) -> ModulePercept {
        let anchor = fixture::anchor();
        let me_spec = &spec["me"];
        let faction_text = me_spec["faction"].as_str().unwrap_or("sentenced");
        let now = spec["now"].as_f64().unwrap_or(100_000.);
        let me = ModuleSelf {
            id: "me".into(),
            name: "Me".into(),
            x: me_spec["x"].as_f64().unwrap_or(anchor.x),
            y: me_spec["y"].as_f64().unwrap_or(anchor.y),
            facing: 0.,
            status: if me_spec["status"] == "dead" {
                "dead".into()
            } else {
                "alive".into()
            },
            hp: me_spec["hp"].as_f64().unwrap_or(100.),
            max_hp: me_spec["maxHp"].as_f64().unwrap_or(100.),
            barrier: 0.,
            faction_text: faction_text.into(),
            faction: FactionId::parse(faction_text),
            weapons: [None, None],
            slot: 0,
            attack_target: me_spec["attackTarget"].as_str().map(str::to_owned),
            build: None,
            record: MethodValue::Null,
        };
        let hud = ModuleHud {
            phase: if spec["hud"]["phase"] == "planning" {
                "planning".into()
            } else {
                "active".into()
            },
            in_coliseum: spec["hud"]["inColiseum"].as_bool().unwrap_or(false),
            gates_locked: false,
            patience_ends_at: 0.,
        };
        ModulePercept {
            now,
            view_t: now,
            self_: me,
            hud,
            fighters: Vec::new(),
            mobs: Vec::new(),
            chests: None,
            wish: None,
            effects: Vec::new(),
            events: Vec::new(),
            features: features.clone(),
        }
    }

    fn goal_of(spec: &Value) -> Goal {
        match spec["goal"].as_str() {
            Some("loot") => Goal::Loot {
                container: "box".into(),
            },
            Some("holdWait") => Goal::Hold {
                at: Vec2::new(0., 0.),
                why: HoldWhy::Wait,
            },
            Some("holdAmbush") => Goal::Hold {
                at: Vec2::new(0., 0.),
                why: HoldWhy::Ambush,
            },
            _ => Goal::Idle,
        }
    }

    fn point(value: &Value) -> Vec2 {
        Vec2::new(value["x"].as_f64().unwrap(), value["y"].as_f64().unwrap())
    }

    fn intent_of(value: &Value) -> Intent {
        let body = match value["kind"].as_str().unwrap() {
            "move" => IntentBody::Move {
                to: point(&value["to"]),
            },
            "stop" => IntentBody::Stop {},
            other => panic!("unexpected declared intent kind {other}"),
        };
        let timing = match value["timing"]["kind"].as_str().unwrap() {
            "timed" => IntentTiming::Timed {
                due: value["timing"]["due"].as_f64().unwrap(),
            },
            _ => IntentTiming::Step {},
        };
        Intent {
            body,
            priority: value["priority"].as_u64().unwrap() as u8,
            timing,
            why: value["why"].as_str().unwrap().into(),
        }
    }

    fn intent_json(intent: &Intent) -> Value {
        let mut result = json!({
            "kind": intent.kind().as_str(),
            "priority": intent.priority,
            "why": intent.why,
        });
        if let IntentBody::Move { to } = intent.body {
            result["to"] = json!({"x": to.x, "y": to.y});
        }
        result["timing"] = match &intent.timing {
            IntentTiming::Step {} => json!({"kind": "step"}),
            IntentTiming::Timed { due } => json!({"kind": "timed", "due": due}),
            IntentTiming::React { .. } => panic!("hazards never emits a reaction timing"),
        };
        result
    }

    fn intents_json(intents: &[Intent]) -> Value {
        Value::Array(intents.iter().map(intent_json).collect())
    }

    /// Binary64-exact structural equality on the declared JSON surface (object keys and array order included).
    fn same_json(expected: &Value, actual: &Value) -> bool {
        match (expected, actual) {
            (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_json(a, b))
            }
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(key, value)| b.get(key).is_some_and(|other| same_json(value, other)))
            }
            _ => expected == actual,
        }
    }

    fn move_intent(x: f64, y: f64, priority: u8, why: &str) -> Intent {
        Intent {
            body: IntentBody::Move {
                to: Vec2::new(x, y),
            },
            priority,
            timing: IntentTiming::Step {},
            why: why.into(),
        }
    }

    /// Run the source module's `intents` hook against the harness facts and return the recorded callbacks.
    fn run_intents(
        module: &mut HazardsModule,
        harness: &mut Harness,
        token: u64,
        engaged: bool,
        goal: Goal,
    ) -> (Vec<Intent>, Vec<PathCall>) {
        harness.paths.take();
        let out = {
            let cfg = config_of(
                token,
                &harness.map,
                &harness.terrain,
                harness.tier,
                harness.persona,
                &harness.plan_map,
                &harness.features,
            );
            let mut decide = NoRng;
            let mut motor = NoRng;
            let mut lapse = NoRng;
            let mut ctx = ModuleContext {
                cfg: &cfg,
                p: &harness.percept,
                mem: &harness.memory,
                paths: &mut harness.paths,
                collision: &harness.map,
                log: &no_log,
                rng: RngLanes {
                    decide: &mut decide,
                    motor: &mut motor,
                    lapse: &mut lapse,
                },
                engaged,
            };
            module.intents(&mut ctx, &goal)
        };
        (out, harness.paths.take())
    }

    /// Run the source module's `adjust` hook; returns the intents, whether the input list identity was returned,
    /// and the recorded callbacks.
    fn run_adjust(
        module: &mut HazardsModule,
        harness: &mut Harness,
        intents: &[Intent],
    ) -> (Vec<Intent>, bool, Vec<PathCall>) {
        harness.paths.take();
        let (out, borrowed) = {
            let cfg = config_of(
                1,
                &harness.map,
                &harness.terrain,
                harness.tier,
                harness.persona,
                &harness.plan_map,
                &harness.features,
            );
            let mut decide = NoRng;
            let mut motor = NoRng;
            let mut lapse = NoRng;
            let mut ctx = ModuleContext {
                cfg: &cfg,
                p: &harness.percept,
                mem: &harness.memory,
                paths: &mut harness.paths,
                collision: &harness.map,
                log: &no_log,
                rng: RngLanes {
                    decide: &mut decide,
                    motor: &mut motor,
                    lapse: &mut lapse,
                },
                engaged: false,
            };
            let out = module.adjust(&mut ctx, &Goal::Idle, intents);
            let borrowed = matches!(out, Cow::Borrowed(_));
            (out.into_owned(), borrowed)
        };
        (out, borrowed, harness.paths.take())
    }

    fn map_calls(calls: &[PathCall]) -> usize {
        calls
            .iter()
            .filter(|call| matches!(call, PathCall::CollisionMap))
            .count()
    }

    fn clear_calls(calls: &[PathCall]) -> Vec<(Vec2, Vec2, bool)> {
        calls
            .iter()
            .filter_map(|call| match call {
                PathCall::Clear(a, b, result) => Some((*a, *b, *result)),
                PathCall::CollisionMap => None,
            })
            .collect()
    }

    fn ember_harness() -> Harness {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        Harness::new(fixture::map(&maps, "ember"))
    }

    fn anchored(spec: Value) -> Harness {
        let mut harness = ember_harness();
        harness.apply(&spec);
        harness
    }

    /// Ready step-off facts: on embers, alive/active, holy, standing for 250 ms.
    fn ready_spec() -> Value {
        json!({"now": 100_250., "still": 250.})
    }

    // --------------------------------------------------------------------------------------------------- witnesses

    #[test]
    fn listed_hooks_and_enabled_match_the_source_module_object() {
        let module = HazardsModule::default();
        assert_eq!(module.id(), "hazards");
        assert_eq!(module.hooks(), &["enabled", "intents", "adjust"]);
        assert!(module.enabled(&Features {
            hazards: true,
            ..Features::default()
        }));
        assert!(!module.enabled(&Features::default()));
    }

    #[test]
    fn classification_matches_the_source_surface_table() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let anchor = fixture::anchor();
        let spells = [
            "fire",
            "sentenced",
            "plague",
            "frost",
            "holy",
            "unknown",
            "",
        ];
        // (burns, bad) for the six faction spellings on each declared surface kind.
        let expected = [
            (
                "ember",
                [
                    (false, false),
                    (true, true),
                    (true, true),
                    (true, true),
                    (true, true),
                    (true, true),
                    (true, true),
                ],
            ),
            (
                "bog",
                [
                    (false, true),
                    (false, true),
                    (false, false),
                    (false, true),
                    (false, true),
                    (false, true),
                    (false, true),
                ],
            ),
            (
                "ice",
                [
                    (false, true),
                    (false, true),
                    (false, true),
                    (false, false),
                    (false, true),
                    (false, true),
                    (false, true),
                ],
            ),
            ("light", [(false, false); 7]),
            ("plain", [(false, false); 7]),
        ];
        for (map_name, rows) in expected {
            let map = fixture::map(&maps, map_name);
            for (spelling, (burns_expected, bad_expected)) in spells.iter().zip(rows) {
                let home = source_core::faction_of_text(spelling);
                let terrain = terrain_of(map);
                assert_eq!(
                    source_core::burns(map, terrain, home, anchor),
                    burns_expected,
                    "{map_name} burns {spelling}"
                );
                assert_eq!(
                    source_core::bad(map, terrain, home, anchor),
                    bad_expected,
                    "{map_name} bad {spelling}"
                );
                // The public adapter keeps the same answers for every recognized faction.
                if let Some(faction) = home {
                    assert_eq!(public_hazards::burns(map, faction, anchor), burns_expected);
                    assert_eq!(public_hazards::bad(map, faction, anchor), bad_expected);
                }
            }
        }
    }

    #[test]
    fn legacy_fsm_replay_matches_with_exact_callback_points() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let mut module = HazardsModule::default();
        let mut previous = "";
        let mut index = 0usize;
        let mut steps = 0usize;
        for row in corpus["steps"].as_array().unwrap() {
            let scenario = row["scenario"].as_str().unwrap();
            if previous != scenario {
                module = HazardsModule::default();
                previous = scenario;
                index = 0;
            }
            let mut harness = Harness::new(fixture::map(&maps, row["map"].as_str().unwrap()));
            harness.apply(&row["spec"]);
            let engaged = row["spec"]["engaged"].as_bool().unwrap_or(false);
            let (out, calls) =
                run_intents(&mut module, &mut harness, 1, engaged, goal_of(&row["spec"]));
            let got = intents_json(&out);
            assert!(
                same_json(&row["result"], &got),
                "{scenario}[{index}]: native {got} vs source {}",
                row["result"]
            );
            let expected_map_calls: &[usize] = match scenario {
                "stationary-boundary" => &[1, 1, 0, 0, 1, 1],
                "home" | "locked" | "loot" | "light-engaged" | "light-already" | "zero-max" => &[1],
                "coliseum" => &[0],
                "not-active" => &[0, 0],
                "light-hold" => &[1, 0, 1],
                "light-threshold" => &[1, 1, 1],
                "hold-arrival" => &[1, 1, 1, 1],
                "hold-boundary" => &[1, 0, 1],
                other => panic!("unexpected legacy scenario {other}"),
            };
            assert_eq!(
                map_calls(&calls),
                expected_map_calls[index],
                "{scenario}[{index}] collisionMap timing"
            );
            let expected_clears: usize = match (scenario, index) {
                ("stationary-boundary", 0 | 2 | 3 | 5) => 0,
                ("stationary-boundary", 1 | 4) => 1,
                ("home", _)
                | ("locked", _)
                | ("loot", _)
                | ("coliseum", _)
                | ("not-active", _)
                | ("light-engaged", _)
                | ("light-already", _)
                | ("zero-max", _) => 0,
                ("light-hold", 0) => 1,
                ("light-hold", 1 | 2) => 0,
                ("light-threshold", 1) => 1,
                ("light-threshold", 0 | 2) => 0,
                ("hold-arrival", 0 | 3) => 1,
                ("hold-arrival", 1 | 2) => 0,
                ("hold-boundary", 0 | 2) => 1,
                ("hold-boundary", 1) => 0,
                _ => panic!("unexpected legacy row {scenario}[{index}]"),
            };
            assert_eq!(
                clear_calls(&calls).len(),
                expected_clears,
                "{scenario}[{index}] clear timing"
            );
            // Callbacks are ordered: collisionMap precedes the search's clear calls.
            if let Some(first_clear) = calls.iter().position(|c| matches!(c, PathCall::Clear(..))) {
                let first_map = calls
                    .iter()
                    .position(|c| matches!(c, PathCall::CollisionMap))
                    .expect("a clear implies the collision map was obtained");
                assert!(
                    first_map < first_clear,
                    "{scenario}[{index}] callback order"
                );
            }
            index += 1;
            steps += 1;
        }
        assert_eq!(
            steps, 28,
            "the unaffected legacy step corpus is replayed in full"
        );

        let mut adjusts = 0usize;
        for row in corpus["adjusts"].as_array().unwrap() {
            let mut harness = Harness::new(fixture::map(&maps, row["map"].as_str().unwrap()));
            harness.apply(&row["spec"]);
            let inputs: Vec<Intent> = row["intents"]
                .as_array()
                .unwrap()
                .iter()
                .map(intent_of)
                .collect();
            let (out, borrowed, calls) = run_adjust(&mut module, &mut harness, &inputs);
            let got = intents_json(&out);
            assert!(
                same_json(&row["result"], &got),
                "adjust {}: native {got} vs source {}",
                row["map"],
                row["result"]
            );
            let unchanged = same_json(&row["result"], &intents_json(&inputs));
            assert_eq!(borrowed, unchanged, "adjust {}: list identity", row["map"]);
            assert_eq!(
                map_calls(&calls),
                1,
                "adjust obtains collisionMap for a live owner"
            );
            assert!(
                clear_calls(&calls).is_empty(),
                "the adjust search has no accept callback"
            );
            adjusts += 1;
        }
        assert_eq!(
            adjusts, 20,
            "the unaffected legacy adjust corpus is replayed in full"
        );
    }

    #[test]
    fn path_denial_traverses_both_passes_and_denies_every_accept() {
        // Source corpus `hazard-path-denial` declares a radius-denial path service: every accept is denied.
        struct DeniedPaths {
            service: RoomPathService,
            calls: RefCell<Vec<PathCall>>,
        }
        impl ModulePaths for DeniedPaths {
            fn walk(&mut self, _: Vec2, _: Vec2) -> Option<WalkAnswer> {
                None
            }
            fn path(&mut self, _: Vec2, _: Vec2) -> Option<Vec<Vec2>> {
                None
            }
            fn los(&self, _: Vec2, _: Vec2) -> bool {
                false
            }
            fn clear(&self, a: Vec2, b: Vec2) -> bool {
                self.calls.borrow_mut().push(PathCall::Clear(a, b, false));
                false
            }
            fn collision_map(&self) -> &TileMap {
                self.calls.borrow_mut().push(PathCall::CollisionMap);
                self.service.collision_map()
            }
        }
        let harness = anchored(ready_spec());
        let mut module = HazardsModule::default();
        let mut paths = DeniedPaths {
            service: RoomPathService::new(&harness.map, PathBudget::new(20)),
            calls: RefCell::new(Vec::new()),
        };
        let out = {
            let cfg = config_of(
                1,
                &harness.map,
                &harness.terrain,
                harness.tier,
                harness.persona,
                &harness.plan_map,
                &harness.features,
            );
            let mut decide = NoRng;
            let mut motor = NoRng;
            let mut lapse = NoRng;
            let mut ctx = ModuleContext {
                cfg: &cfg,
                p: &harness.percept,
                mem: &harness.memory,
                paths: &mut paths,
                collision: &harness.map,
                log: &no_log,
                rng: RngLanes {
                    decide: &mut decide,
                    motor: &mut motor,
                    lapse: &mut lapse,
                },
                engaged: false,
            };
            module.intents(&mut ctx, &Goal::Idle)
        };
        assert!(out.is_empty(), "every candidate is denied");
        let calls = std::mem::take(&mut *paths.calls.borrow_mut());
        assert_eq!(map_calls(&calls), 1);
        let clears = clear_calls(&calls);
        // Both ordered passes over the same sorted open list; the frozen corpus records 268 denied accepts for this
        // exact 5x5 ember geometry, in the source's call order.
        assert_eq!(clears.len(), 268);
        assert!(clears.iter().all(|(_, _, accepted)| !accepted));
        assert_eq!(
            clears[..4],
            [
                (Vec2::new(1552., 368.), Vec2::new(1552., 240.), false),
                (Vec2::new(1552., 368.), Vec2::new(1424., 368.), false),
                (Vec2::new(1552., 368.), Vec2::new(1680., 368.), false),
                (Vec2::new(1552., 368.), Vec2::new(1552., 496.), false),
            ]
        );
    }

    #[test]
    fn guards_return_before_any_collision_map_call() {
        let mut module = HazardsModule::default();
        let mut harness = anchored(ready_spec());

        let guarded = [
            json!({"now": 100_250., "still": 250., "hud": {"phase": "planning"}}),
            json!({"now": 100_250., "still": 250., "me": {"status": "dead"}}),
            json!({"now": 100_250., "still": 250., "hud": {"inColiseum": true}}),
        ];
        for spec in guarded {
            harness.apply(&spec);
            let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
            assert!(out.is_empty(), "guard {spec}");
            assert!(
                calls.is_empty(),
                "a guarded intents hook returns before collisionMap"
            );
        }

        // A null faction is a guard; it is never classified as a fabricated faction.
        harness.apply(&ready_spec());
        harness.percept.self_.faction_text.clear();
        harness.percept.self_.faction = None;
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert!(out.is_empty());
        assert!(calls.is_empty());

        // A loot goal suppresses the step search but the map is still obtained (source call order).
        harness.apply(&ready_spec());
        let (out, calls) = run_intents(
            &mut module,
            &mut harness,
            1,
            false,
            goal_of(&json!({"goal": "loot"})),
        );
        assert!(out.is_empty());
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());

        // An attack lock suppresses the step search after the map is obtained.
        harness.apply(&json!({"now": 100_250., "still": 250., "me": {"attackTarget": "foe"}}));
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert!(out.is_empty());
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());

        // The unguarded case steps once, calling clear only at the accepted candidate.
        harness.apply(&ready_spec());
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(
            intents_json(&out),
            json!([{
                "kind": "move", "to": {"x": 1552., "y": 240.}, "priority": 2,
                "timing": {"kind": "step"}, "why": "step off the embers"
            }])
        );
        assert_eq!(map_calls(&calls), 1);
        assert_eq!(
            clear_calls(&calls),
            vec![(Vec2::new(1552., 368.), Vec2::new(1552., 240.), true)]
        );
    }

    #[test]
    fn unknown_faction_has_no_home_rule_but_passes_the_null_guard() {
        let mut module = HazardsModule::default();
        let mut harness = anchored(ready_spec());
        harness.percept.self_.faction_text = "unknown".into();
        harness.percept.self_.faction = None;
        // Unknown is not null: the hook runs and the embers burn it (no home exemption).
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind().as_str(), "move");
        assert_eq!(out[0].why, "step off the embers");
        assert_eq!(map_calls(&calls), 1);

        // Null is a guard: no intents and no callback.
        let mut null = anchored(ready_spec());
        null.percept.self_.faction_text.clear();
        null.percept.self_.faction = None;
        let (out, calls) = run_intents(&mut module, &mut null, 2, false, Goal::Idle);
        assert!(out.is_empty());
        assert!(calls.is_empty());

        // adjust: an unknown (non-null) faction still redirects; null does not even obtain the map.
        let intents = vec![move_intent(1552., 368., 2, "walk")];
        let mut unknown_adjust = anchored(json!({}));
        unknown_adjust.percept.self_.faction_text = "unknown".into();
        unknown_adjust.percept.self_.faction = None;
        unknown_adjust.percept.self_.x = 1296.;
        unknown_adjust.percept.self_.y = 368.;
        let (out, borrowed, calls) = run_adjust(&mut module, &mut unknown_adjust, &intents);
        assert!(!borrowed);
        assert_eq!(out[0].why, "walk (round the bad ground)");
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());

        let mut null_adjust = anchored(json!({}));
        null_adjust.percept.self_.faction_text.clear();
        null_adjust.percept.self_.faction = None;
        null_adjust.percept.self_.x = 1296.;
        null_adjust.percept.self_.y = 368.;
        let (_, borrowed, calls) = run_adjust(&mut module, &mut null_adjust, &intents);
        assert!(borrowed);
        assert!(
            calls.is_empty(),
            "a null faction returns before collisionMap"
        );
    }

    #[test]
    fn adjust_is_phase_and_coliseum_independent() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let intents = vec![move_intent(1552., 368., 2, "walk")];
        for spec in [
            json!({"me": {"x": 1296., "y": 368.}, "hud": {"phase": "planning"}}),
            json!({"me": {"x": 1296., "y": 368.}, "hud": {"inColiseum": true}}),
        ] {
            let mut harness = Harness::new(fixture::map(&maps, "ember"));
            harness.apply(&spec);
            let mut module = HazardsModule::default();
            let (out, borrowed, calls) = run_adjust(&mut module, &mut harness, &intents);
            assert!(!borrowed, "planning/coliseum do not gate adjust");
            assert_eq!(out[0].why, "walk (round the bad ground)");
            assert_eq!(map_calls(&calls), 1);
        }
        // A dead owner returns before the collisionMap call, whatever the phase.
        let mut dead = Harness::new(fixture::map(&maps, "ember"));
        dead.apply(&json!({"me": {"x": 1296., "y": 368., "status": "dead"}}));
        let mut module = HazardsModule::default();
        let (_, borrowed, calls) = run_adjust(&mut module, &mut dead, &intents);
        assert!(borrowed);
        assert!(calls.is_empty());
        // An empty intent list still obtains the collision map for a live owner.
        let mut alive = Harness::new(fixture::map(&maps, "ember"));
        alive.apply(&json!({"me": {"x": 1296., "y": 368.}}));
        let (out, borrowed, calls) = run_adjust(&mut module, &mut alive, &[]);
        assert!(out.is_empty() && borrowed);
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());
    }

    #[test]
    fn adjust_copies_after_first_redirect_and_keeps_order_priority_and_why() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let mut harness = Harness::new(fixture::map(&maps, "ember"));
        harness.apply(&json!({"me": {"faction": "sentenced", "x": 1296., "y": 368.}}));
        let inputs = vec![
            move_intent(1552., 368., 2, "walk"),
            move_intent(1552., 400., 2, "walk"),
            Intent {
                body: IntentBody::Move {
                    to: Vec2::new(1328., 368.),
                },
                priority: 0,
                timing: IntentTiming::Timed { due: 100_050. },
                why: "dodge".into(),
            },
            Intent {
                body: IntentBody::Stop {},
                priority: 3,
                timing: IntentTiming::Step {},
                why: "stop".into(),
            },
        ];
        let mut module = HazardsModule::default();
        let (out, borrowed, calls) = run_adjust(&mut module, &mut harness, &inputs);
        assert!(!borrowed, "a real redirect must return an owned list");
        assert_eq!(
            intents_json(&out),
            json!([
                {"kind": "move", "to": {"x": 1456., "y": 272.}, "priority": 2,
                 "timing": {"kind": "step"}, "why": "walk (round the bad ground)"},
                {"kind": "move", "to": {"x": 1552., "y": 496.}, "priority": 2,
                 "timing": {"kind": "step"}, "why": "walk (round the bad ground)"},
                {"kind": "move", "to": {"x": 1328., "y": 368.}, "priority": 0,
                 "timing": {"kind": "timed", "due": 100050.}, "why": "dodge"},
                {"kind": "stop", "priority": 3, "timing": {"kind": "step"}, "why": "stop"}
            ])
        );
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());
        // Same facts, no redirect (far-but-clean and short intents): the original identity is returned.
        let clean_intents = vec![
            move_intent(1008., 1008., 1, "walk"),
            move_intent(1328., 368., 0, "dodge"),
        ];
        let (out, borrowed, calls) = run_adjust(&mut module, &mut harness, &clean_intents);
        assert!(borrowed);
        assert!(same_json(
            &intents_json(&out),
            &intents_json(&clean_intents)
        ));
        assert_eq!(map_calls(&calls), 1);
    }

    #[test]
    fn per_cfg_identity_isolates_and_continues_state() {
        let mut module = HazardsModule::default();
        let mut harness = anchored(json!({"now": 100_000., "still": 0.}));
        // cfg a: first call standing on embers for 0 ms -> no step yet, but the map is obtained.
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert!(out.is_empty());
        assert_eq!(map_calls(&calls), 1);
        // cfg a reaches the 250 ms standing bound: one step, one clear, lastStepAt stamped.
        harness.apply(&json!({"now": 100_250., "still": 250.}));
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].why, "step off the embers");
        assert_eq!(clear_calls(&calls).len(), 1);
        // A different cfg identity at 100251 has its own state: nothing retained, still 0 ms -> no step.
        harness.apply(&json!({"now": 100_251., "still": 0.}));
        let (out, calls) = run_intents(&mut module, &mut harness, 2, false, Goal::Idle);
        assert!(out.is_empty());
        assert_eq!(map_calls(&calls), 1);
        // The first identity continues its retained step with no collisionMap call.
        harness.apply(&json!({"now": 100_252., "still": 252.}));
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].why, "step off the embers");
        assert!(
            calls.is_empty(),
            "a retained step is offered before collisionMap"
        );
    }

    #[test]
    fn hold_coliseum_why_does_not_seek_light() {
        let corpus = fixture::corpus();
        let maps = fixture::maps(&corpus);
        let mut harness = Harness::new(fixture::map(&maps, "light"));
        harness.apply(&json!({"me": {"hp": 10.}}));
        let mut module = HazardsModule::default();
        let coliseum_goal = Goal::Hold {
            at: Vec2::new(0., 0.),
            why: HoldWhy::Coliseum,
        };
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, coliseum_goal);
        assert!(out.is_empty());
        assert_eq!(map_calls(&calls), 1);
        assert!(clear_calls(&calls).is_empty());
        // The wait/ambush why does seek light on the same facts (legacy `light-wait-false` shape).
        let wait_goal = Goal::Hold {
            at: Vec2::new(0., 0.),
            why: HoldWhy::Wait,
        };
        let (out, calls) = run_intents(&mut module, &mut harness, 2, false, wait_goal);
        assert_eq!(
            intents_json(&out),
            json!([{"kind": "move", "to": {"x": 1648., "y": 368.}, "priority": 2,
                "timing": {"kind": "step"}, "why": "lie low in the light"}])
        );
        assert_eq!(clear_calls(&calls).len(), 1);
    }

    #[test]
    fn arrival_is_inclusive_at_twenty_units() {
        // Build a retained step at now 100000, then stand exactly 20u from it: the step is cleared.
        let mut harness = anchored(json!({"now": 100_000., "still": 1000.}));
        let mut module = HazardsModule::default();
        let (out, _) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        harness.apply(&json!({"now": 100_100., "still": 1100., "me": {"x": 1552., "y": 260.}}));
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert!(
            out.is_empty(),
            "distance 20 <= arriveU clears the retained step"
        );
        assert_eq!(map_calls(&calls), 1);
        // At 21u it is kept: no collisionMap call at all.
        let mut harness = anchored(json!({"now": 100_000., "still": 1000.}));
        let mut module = HazardsModule::default();
        let (out, _) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        harness.apply(&json!({"now": 100_100., "still": 1100., "me": {"x": 1552., "y": 261.}}));
        let (out, calls) = run_intents(&mut module, &mut harness, 1, false, Goal::Idle);
        assert_eq!(out.len(), 1);
        assert!(
            calls.is_empty(),
            "a retained step never obtains the collision map"
        );
    }
}
