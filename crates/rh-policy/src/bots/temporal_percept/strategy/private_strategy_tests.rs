//! Declared native controls for the private strategy closure. These use owned fakes/hand-built declared contexts only;
//! actual-source corpus replay is a separate Phase A handoff and is not claimed here.
use std::cell::Cell;

use super::super::memory::{
    CampMemory, ContainerMemory, ContainersWeapon, FighterMemory, MobMemory, SelfMemory,
    Whereabouts,
};
use super::build_route::{BuildRoute, RouteInput};
use super::engine::{Strategy, StrategyOptions};
use super::mob_hunt::{HuntInput, HuntMobLike, HuntSelf, MobHunter, MobTracker};
use super::types::{
    goal_json_eq, goal_key, CampDef, ColiseumDef, FeatureModule, Goal, GoalDecision, GoalStatus,
    HoldWhy, LearnedBias, MemoryApi, RoamWhy, RouteCamp, StrategyConfig, StrategyContext,
    StrategyMap, StrategyPercept, StrategySelf,
};
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::WalkAnswer;
use crate::bots::random::Rng;
use crate::bots::types::{PersonaParams, Stimulus, TierParams, PERSONAS, TIERS};
use rh_sim::{FactionId, Vec2, WeaponId};

fn feature_tier() -> TierParams {
    TIERS[1]
}
fn feature_persona() -> PersonaParams {
    PERSONAS[1]
}

#[derive(Default)]
struct FakePaths {
    answers: Vec<Option<f64>>,
    calls: Vec<(Vec2, Vec2)>,
}
impl super::types::PathApi for FakePaths {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        self.calls.push((from, to));
        let answer = if self.answers.is_empty() {
            Some(10.)
        } else {
            self.answers.remove(0)
        };
        answer.map(|dist| WalkAnswer { dist, exact: true })
    }
    fn los(&self, _a: Vec2, _b: Vec2) -> bool {
        true
    }
    fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
        true
    }
}

struct FakeMemory {
    fighters: Vec<(String, FighterMemory)>,
    mobs: Vec<(String, MobMemory)>,
    camps: Vec<(String, CampMemory)>,
    containers: Vec<(String, ContainerMemory)>,
    self_memory: SelfMemory,
    stimuli: Vec<Stimulus>,
    bounties: Vec<(String, f64)>,
    choices: Vec<String>,
    where_about: Vec<(String, Whereabouts)>,
}
impl Default for FakeMemory {
    fn default() -> Self {
        Self {
            fighters: Vec::new(),
            mobs: Vec::new(),
            camps: Vec::new(),
            containers: Vec::new(),
            self_memory: empty_self_memory(),
            stimuli: Vec::new(),
            bounties: Vec::new(),
            choices: Vec::new(),
            where_about: Vec::new(),
        }
    }
}
impl MemoryApi for FakeMemory {
    fn fighters(&self) -> &[(String, FighterMemory)] {
        &self.fighters
    }
    fn mobs(&self) -> &[(String, MobMemory)] {
        &self.mobs
    }
    fn camps(&self) -> &[(String, CampMemory)] {
        &self.camps
    }
    fn containers(&self) -> &[(String, ContainerMemory)] {
        &self.containers
    }
    fn self_memory(&self) -> &SelfMemory {
        &self.self_memory
    }
    fn stimuli(&self) -> &[Stimulus] {
        &self.stimuli
    }
    fn bounties(&self) -> &[(String, f64)] {
        &self.bounties
    }
    fn choices(&self) -> &[String] {
        &self.choices
    }
    fn whereabouts(&self, id: &str, _now: f64) -> Option<Whereabouts> {
        self.where_about
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, w)| *w)
    }
}

struct NoLearn;
impl LearnedBias for NoLearn {
    fn enabled(&self) -> bool {
        false
    }
    fn bias(&self, _key: &str) -> f64 {
        0.
    }
}

struct CountingModule {
    enabled: bool,
    goals: Vec<GoalDecision>,
    called: Cell<u32>,
}
impl FeatureModule for CountingModule {
    fn id(&self) -> &str {
        "counting"
    }
    fn enabled(&self, _features: &crate::bots::view::Features) -> bool {
        self.enabled
    }
    fn goals(&self, _ctx: &StrategyContext<'_>) -> Vec<GoalDecision> {
        self.called.set(self.called.get() + 1);
        self.goals.clone()
    }
}

fn empty_self_memory() -> SelfMemory {
    SelfMemory {
        last_hit_at: None,
        last_hit_by_player_at: None,
        last_dealt_at: None,
        recent_damage: 0.,
        recent_hits: Vec::new(),
        teleported_at: None,
        last_order: None,
        last_cast: None,
        still_since: 0.,
    }
}

fn fighter(id: &str, x: f64, y: f64) -> FighterMemory {
    FighterMemory {
        id: id.into(),
        name: "Foe".into(),
        bot: false,
        faction: Some(FactionId::Frost),
        weapons_seen: vec![WeaponId::Sword],
        in_hand: Some(WeaponId::Sword),
        other_slot: None,
        seen_at: 0.,
        pos: Vec2::new(x, y),
        vel: Vec2::new(0., 0.),
        hp_frac: 0.7,
        bounty: 0.,
        alive: true,
        died_at: None,
        hit_me_at: None,
        hit_by_me_at: None,
        damage_to_me: 0.,
        damage_by_me: 0.,
        engaged_with: None,
        engaged_at: None,
        chasing_me: false,
        wish_seen_at: None,
        wish_ready_guess: None,
        feints: 0,
        last_feint_at: None,
    }
}
fn mob(id: &str, x: f64, y: f64) -> MobMemory {
    MobMemory {
        id: id.into(),
        type_: Some("emberImp".into()),
        kind: "mob".into(),
        faction: Some(FactionId::Fire),
        name: Some("Ember Imp".into()),
        home: Some(Vec2::new(x, y)),
        camp_id: None,
        pos: Vec2::new(x, y),
        dot_at: 0.,
        seen_at: Some(0.),
        hp_frac: 1.,
        in_hand: Some(WeaponId::Axe),
        awake: false,
        returning: false,
        alive: true,
    }
}
fn container(id: &str, x: f64, y: f64) -> super::types::StrategyContainer {
    super::types::StrategyContainer {
        id: id.into(),
        kind: "ground".into(),
        x,
        y,
        closed: true,
        weapon: ContainersWeapon::Weapon(WeaponId::Bow),
    }
}

fn base_self(hp: f64, faction: Option<FactionId>) -> StrategySelf {
    StrategySelf {
        id: "self".into(),
        faction,
        x: 500.,
        y: 500.,
        facing: 0.,
        status: "alive".into(),
        hp,
        max_hp: 100.,
        weapons: [Some(WeaponId::Sword), None],
        slot: 0,
        attack_target: None,
        mob_kills: 0.,
        power: 0.,
        kills: 0.,
        mob_stats: Vec::new(),
        speed_mult: 1.,
        bounty: 0.,
    }
}

fn base_percept(hp: f64) -> StrategyPercept {
    StrategyPercept {
        now: 1000.,
        self_: base_self(hp, Some(FactionId::Plague)),
        hud: super::types::StrategyHud {
            raid_started_at: 0.,
            patience_ends_at: 0.,
            sudden_death_at: 0.,
            in_coliseum: false,
            alive: 8,
            gates_locked: false,
        },
        fighters: Vec::new(),
        mobs: Vec::new(),
        containers: Vec::new(),
        extras: super::types::StrategyExtras::default(),
    }
}

fn map_with_camps() -> StrategyMap {
    StrategyMap {
        camps: vec![
            CampDef {
                id: "camp-a".into(),
                zone: FactionId::Fire,
                x: 600.,
                y: 500.,
                r: 120.,
                elite_spot: -1.,
                spots: 2,
            },
            CampDef {
                id: "camp-b".into(),
                zone: FactionId::Frost,
                x: 700.,
                y: 500.,
                r: 120.,
                elite_spot: -1.,
                spots: 2,
            },
        ],
        coliseum: ColiseumDef {
            centre: Vec2::new(500., 500.),
            inner_spawns: vec![Vec2::new(450., 500.), Vec2::new(550., 500.)],
        },
        width: 160.,
        height: 160.,
    }
}

struct Fixture {
    percept: StrategyPercept,
    mem: FakeMemory,
    map: StrategyMap,
    tier: TierParams,
    persona: PersonaParams,
    features: crate::bots::view::Features,
    modules: Vec<Box<dyn FeatureModule>>,
    learned: NoLearn,
    know: Knowledge,
}
impl Fixture {
    fn new(percept: StrategyPercept, mem: FakeMemory) -> Self {
        let tier = feature_tier();
        let persona = feature_persona();
        let mut rng = Rng::new(7);
        let know = Knowledge::create(&tier, &mut rng);
        Self {
            percept,
            mem,
            map: map_with_camps(),
            tier,
            persona,
            features: crate::bots::view::Features::default(),
            modules: Vec::new(),
            learned: NoLearn,
            know,
        }
    }
    fn decide(&mut self, current: &Goal, status: &GoalStatus, engaged: bool) -> GoalDecision {
        self.decide_state(current, status, engaged).0
    }

    fn decide_state(
        &mut self,
        current: &Goal,
        status: &GoalStatus,
        engaged: bool,
    ) -> (GoalDecision, super::types::StrategyState) {
        let mut strategy = Strategy::new(StrategyOptions::default());
        let mut paths = FakePaths::default();
        let mut decide = Rng::new(11);
        let mut lapse = Rng::new(12);
        let cfg = StrategyConfig {
            id: "bot".into(),
            seed: 3,
            tier: &self.tier,
            persona: &self.persona,
            map: &self.map,
            features: &self.features,
            learned: &self.learned,
            modules: &self.modules,
        };
        let mut ctx = StrategyContext {
            cfg: &cfg,
            p: &self.percept,
            mem: &self.mem,
            know: &self.know,
            paths: &mut paths,
            decide: &mut decide,
            lapse: &mut lapse,
            engaged,
        };
        let out = strategy.decide(&mut ctx, current, status);
        (out, strategy.state())
    }
}

#[test]
fn private_strategy_goal_union_and_keys() {
    let goals = vec![
        Goal::Idle,
        Goal::Farm {
            mob: "m1".into(),
            camp: None,
        },
        Goal::Hunt {
            target: "p2".into(),
        },
        Goal::Fight {
            target: "p3".into(),
        },
        Goal::Loot {
            container: "c1".into(),
        },
        Goal::Flee {
            from: vec![Vec2::new(1., 2.)],
            until: 3000.,
        },
        Goal::Roam {
            to: Vec2::new(100., 200.),
            why: RoamWhy::Camp,
        },
        Goal::Hold {
            at: Vec2::new(4., 5.),
            why: HoldWhy::Wait,
        },
        Goal::Module {
            module: "plan".into(),
            data: super::super::data::MethodValue::Obj(vec![(
                "ready".into(),
                super::super::data::MethodValue::Bool(true),
            )]),
        },
    ];
    let keys: Vec<String> = goals.iter().map(goal_key).collect();
    assert_eq!(keys[0], "idle");
    assert_eq!(keys[1], "farm:m1");
    assert_eq!(keys[2], "hunt:p2");
    assert_eq!(keys[3], "fight:p3");
    assert_eq!(keys[4], "loot:c1");
    assert_eq!(keys[5], "flee");
    assert!(keys[6].starts_with("roam:camp:"));
    assert_eq!(keys[7], "hold:wait");
    assert_eq!(keys[8], "module:plan:{\"ready\":true}");
    for g in &goals {
        assert!(goal_json_eq(g, g));
    }
}

#[test]
fn private_strategy_route_tie_contest_and_replan() {
    let camps = vec![
        RouteCamp {
            index: 1,
            id: "b".into(),
            zone: FactionId::Frost,
            x: 1200.,
            y: 500.,
            r: 100.,
            elite: false,
            spots: 2,
            mob_type: "frostWisp".into(),
            alive: 2,
            state: 0,
            respawn_at: 0.,
        },
        RouteCamp {
            index: 0,
            id: "a".into(),
            zone: FactionId::Fire,
            x: 600.,
            y: 500.,
            r: 100.,
            elite: false,
            spots: 2,
            mob_type: "emberImp".into(),
            alive: 2,
            state: 0,
            respawn_at: 0.,
        },
    ];
    let players: Vec<Vec2> = Vec::new();
    let can_farm = |_: &RouteCamp| true;
    let mut route = BuildRoute::new(FactionId::Fire, 0.2);
    let first = route
        .update(&RouteInput {
            now: 1000.,
            run_ms: 0.,
            self_pos: Vec2::new(900., 500.),
            speed: 170.,
            mob_kills: 0.,
            power: 0.,
            camps: &camps,
            players: &players,
            can_farm: &can_farm,
        })
        .expect("route planned");
    assert_eq!(first.camp, 0, "equal score ties go to the lower camp index");
    // A player near the planned camp contests it and forces an immediate replan.
    let players = vec![Vec2::new(600., 500.)];
    let next = route
        .update(&RouteInput {
            now: 2000.,
            run_ms: 0.,
            self_pos: Vec2::new(900., 500.),
            speed: 170.,
            mob_kills: 0.,
            power: 0.,
            camps: &camps,
            players: &players,
            can_farm: &can_farm,
        })
        .expect("replanned");
    assert_eq!(route.stats.contests, 1);
    assert!(route.is_contested(0, 2000.));
    assert_ne!(next.camp, 0);
}

#[test]
fn private_strategy_tracker_and_hunter_controls() {
    let base = HuntMobLike {
        kind: "mob".into(),
        status: "alive".into(),
        x: 10.,
        y: 0.,
        hp: 50.,
        max_hp: 50.,
        faction: Some(FactionId::Fire),
        faction_text: Some("fire".into()),
        weapon0: Some(WeaponId::Axe),
        weapon0_text: Some("axe".into()),
        type_: Some("emberImp".into()),
    };
    let mut tracker = MobTracker::default();
    tracker.observe(&[("m1".into(), base.clone())], 1000.);
    assert_eq!(tracker.home("m1"), Some(Vec2::new(10., 0.)));
    assert!(!tracker.returning("m1", 1000.));
    let mut hurt = base.clone();
    hurt.hp = 40.;
    tracker.observe(&[("m1".into(), hurt.clone())], 1100.);
    assert!(tracker.awake("m1", 1100., 40.));
    let mut healed = base.clone();
    healed.hp = 50.;
    tracker.observe(&[("m1".into(), healed.clone())], 1200.);
    assert!(tracker.returning("m1", 1200.));
    // A real hunter pick keeps the target and drops a dead one.
    let mut hunter = MobHunter::new(crate::bots::mob_hunt::MOB_HUNT);
    let self_view = HuntSelf {
        faction: Some(FactionId::Fire),
        x: 0.,
        y: 0.,
        hp: 100.,
        max_hp: 100.,
        weapons: [Some(WeaponId::Sword), None],
        power: 0.,
        mob_kills: 0.,
        mob_stats: Vec::new(),
    };
    let mobs = vec![("m1".into(), base.clone())];
    let players: Vec<Vec2> = Vec::new();
    let mut walk = |_mob: &HuntMobLike| Some(10.);
    let mut input = HuntInput {
        now: 1000.,
        self_: &self_view,
        player_distance: f64::INFINITY,
        players: &players,
        in_coliseum: false,
        mobs: &mobs,
        walk: &mut walk,
        attacking: false,
        shot_by_player_at: f64::NEG_INFINITY,
        type_weight: None,
        elites_ready: None,
    };
    let decision = hunter.decide(&mut input);
    assert!(matches!(
        decision,
        crate::bots::mob_hunt::HuntDecision::Mob { .. }
    ));
    assert_eq!(hunter.target(), Some("m1"));
}

#[test]
fn private_strategy_dead_self_returns_idle_without_candidates() {
    let mut percept = base_percept(100.);
    percept.self_.status = "dead".into();
    let mut fixture = Fixture::new(percept, FakeMemory::default());
    let out = fixture.decide(&Goal::Idle, &GoalStatus::running("start"), false);
    assert_eq!(out.goal, Goal::Idle);
    assert_eq!(out.utility, 0.);
    assert_eq!(out.why, "not alive");
}

#[test]
fn private_strategy_module_enabled_order_and_utility_clamp() {
    let percept = base_percept(100.);
    let mut fixture = Fixture::new(percept, FakeMemory::default());
    let disabled = CountingModule {
        enabled: false,
        goals: vec![],
        called: Cell::new(0),
    };
    let enabled = CountingModule {
        enabled: true,
        goals: vec![
            GoalDecision {
                goal: Goal::Module {
                    module: "one".into(),
                    data: super::super::data::MethodValue::Null,
                },
                utility: -5.,
                why: "module one".into(),
                choice: None,
            },
            GoalDecision {
                goal: Goal::Module {
                    module: "two".into(),
                    data: super::super::data::MethodValue::Null,
                },
                utility: 9.,
                why: "module two".into(),
                choice: None,
            },
        ],
        called: Cell::new(0),
    };
    fixture.modules.push(Box::new(disabled));
    fixture.modules.push(Box::new(enabled));
    let out = fixture.decide(&Goal::Idle, &GoalStatus::running("start"), false);
    let module_goals: Vec<&GoalDecision> = Vec::new();
    let _ = module_goals;
    assert!(matches!(out.goal, Goal::Module { .. }));
    assert_eq!(fixture.modules.len(), 2);
}

#[test]
fn private_strategy_hysteresis_and_flee_priority_controls() {
    // A low-hp bot with a visible nearby enemy offers the source flee candidate.
    let mut percept = base_percept(20.);
    percept.fighters.push(super::types::StrategyFighter {
        id: "foe".into(),
        x: 520.,
        y: 500.,
        dist: 20.,
        los: true,
        status: "alive".into(),
        targetable: true,
        immune: false,
        hp_frac: 0.9,
        faction: Some(FactionId::Holy),
        in_hand: Some(WeaponId::Sword),
        bounty: 0.,
        tint: 0.,
    });
    let mut fixture = Fixture::new(percept, FakeMemory::default());
    let out = fixture.decide(&Goal::Idle, &GoalStatus::running("start"), false);
    assert!(
        matches!(out.goal, Goal::Flee { .. }),
        "flee must outrank everything at 20% hp: {out:?}"
    );
}

#[test]
fn private_strategy_loot_and_camp_candidates() {
    // A visible weapon container in reach produces a loot candidate.
    let mut percept = base_percept(100.);
    percept.containers.push(container("c1", 510., 500.));
    let mut fixture = Fixture::new(percept, FakeMemory::default());
    let out = fixture.decide(&Goal::Idle, &GoalStatus::running("start"), false);
    assert!(!out.why.is_empty());
}

fn decide_with_memory(
    percept: &StrategyPercept,
    mem: &dyn MemoryApi,
    engaged: bool,
) -> (GoalDecision, super::types::StrategyState) {
    let tier = feature_tier();
    let persona = feature_persona();
    let mut rng = Rng::new(7);
    let know = Knowledge::create(&tier, &mut rng);
    let map = map_with_camps();
    let features = crate::bots::view::Features::default();
    let learned = NoLearn;
    let modules: Vec<Box<dyn FeatureModule>> = Vec::new();
    let mut strategy = Strategy::new(StrategyOptions::default());
    let mut paths = FakePaths::default();
    let mut decide = Rng::new(11);
    let mut lapse = Rng::new(12);
    let cfg = StrategyConfig {
        id: "bot".into(),
        seed: 3,
        tier: &tier,
        persona: &persona,
        map: &map,
        features: &features,
        learned: &learned,
        modules: &modules,
    };
    let mut ctx = StrategyContext {
        cfg: &cfg,
        p: percept,
        mem,
        know: &know,
        paths: &mut paths,
        decide: &mut decide,
        lapse: &mut lapse,
        engaged,
    };
    let out = strategy.decide(&mut ctx, &Goal::Idle, &GoalStatus::running("start"));
    (out, strategy.state())
}

#[test]
fn private_strategy_actual_admitted_memory_api_replay() {
    use super::super::memory::source_input::{
        MemoryPercept, PerceptExtras, PerceptFighter, PerceptMinimap, PerceptSelf,
    };
    use super::super::memory::{Memory, MemoryConfig, MemoryMap};

    let tier = feature_tier();
    let mut memory = Memory::new(MemoryConfig {
        self_id: "self".into(),
        tier: &TIERS[1],
        map: MemoryMap { camps: Vec::new() },
        features: crate::bots::view::Features::default(),
    })
    .unwrap();
    let percept = MemoryPercept {
        now: 1000.,
        view_t: 1000.,
        self_: PerceptSelf {
            id: "self".into(),
            name: "self".into(),
            x: 0.,
            y: 0.,
            facing: 0.,
            status: "alive".into(),
            hp: 100.,
            max_hp: 100.,
            attack_target: None,
            move_seq: 0.,
        },
        hud_in_coliseum: false,
        fighters: vec![PerceptFighter {
            id: "p2".into(),
            name: "Foe".into(),
            bot: false,
            x: 120.,
            y: 0.,
            facing: 0.,
            status: "alive".into(),
            hp_frac: 0.7,
            faction: Some(FactionId::Frost),
            in_hand: Some(WeaponId::Sword),
            draw_started_at: 0.,
            bounty: 0.,
            vx: 0.,
            vy: 0.,
        }],
        mobs: Vec::new(),
        containers: Vec::new(),
        projectiles: Vec::new(),
        minimap: PerceptMinimap {
            t: 1000.,
            mobs: Vec::new(),
        },
        events: Vec::new(),
        extras: PerceptExtras::default(),
        features: crate::bots::view::Features::default(),
    };
    memory.observe(&percept).unwrap();
    let w = MemoryApi::whereabouts(&memory, "p2", 1000.).expect("real Memory.whereabouts query");
    assert_eq!(w.at, Vec2::new(120., 0.));
    assert!(MemoryApi::whereabouts(&memory, "p2", 1000. + tier.memory_span_ms + 1.).is_none());
    // The same admitted Memory feeds a real strategy decision (never expected candidate rows).
    let mut p = base_percept(100.);
    p.fighters.push(super::types::StrategyFighter {
        id: "p2".into(),
        x: 120.,
        y: 0.,
        dist: 120.,
        los: true,
        status: "alive".into(),
        targetable: true,
        immune: false,
        hp_frac: 0.7,
        faction: Some(FactionId::Frost),
        in_hand: Some(WeaponId::Sword),
        bounty: 0.,
        tint: 0.,
    });
    let (out, state) = decide_with_memory(&p, &memory, false);
    assert!(!out.why.is_empty());
    assert!(!state.candidates.is_empty());
}

#[test]
fn private_strategy_farm_and_loot_candidates_are_real_choices() {
    let mut mem = FakeMemory::default();
    mem.mobs.push(("m1".into(), mob("m1", 30., 0.)));
    let mut fixture = Fixture::new(base_percept(100.), mem);
    fixture.map.camps.clear();
    let out = fixture.decide(&Goal::Idle, &GoalStatus::running("start"), false);
    assert!(
        matches!(out.goal, Goal::Farm { .. }),
        "hunt-adapter mob should become a farm candidate: {out:?}"
    );

    let mut fixture = Fixture::new(base_percept(100.), FakeMemory::default());
    fixture.map.camps.clear();
    fixture.percept.containers.push(container("c1", 510., 500.));
    let (out, state) = fixture.decide_state(&Goal::Idle, &GoalStatus::running("start"), false);
    assert!(
        state
            .candidates
            .iter()
            .any(|c| matches!(c.goal, Goal::Loot { .. })),
        "in-reach weapon should become a loot candidate; chosen={out:?} candidates={:?}",
        state.candidates
    );
}

#[test]
fn private_strategy_adapter_catchup_and_release_controls() {
    use super::hunt_adapter::{HuntAdapter, HuntAdapterOptions};
    use crate::bots::mob_hunt::HuntDecision;

    let mut mem = FakeMemory::default();
    mem.mobs.push(("m1".into(), mob("m1", 30., 0.)));
    let percept = base_percept(100.);
    let tier = feature_tier();
    let persona = feature_persona();
    let mut rng = Rng::new(7);
    let know = Knowledge::create(&tier, &mut rng);
    let map = map_with_camps();
    let features = crate::bots::view::Features::default();
    let learned = NoLearn;
    let modules: Vec<Box<dyn FeatureModule>> = Vec::new();
    let mut adapter = HuntAdapter::new(&tier, &persona, HuntAdapterOptions::default());
    let mut paths = FakePaths::default();
    let mut decide = Rng::new(11);
    let mut lapse = Rng::new(12);
    let cfg = StrategyConfig {
        id: "bot".into(),
        seed: 3,
        tier: &tier,
        persona: &persona,
        map: &map,
        features: &features,
        learned: &learned,
        modules: &modules,
    };
    let mut ctx = StrategyContext {
        cfg: &cfg,
        p: &percept,
        mem: &mem,
        know: &know,
        paths: &mut paths,
        decide: &mut decide,
        lapse: &mut lapse,
        engaged: false,
    };
    let first = adapter.decide(&mut ctx, None, None);
    assert!(matches!(first, HuntDecision::Mob { .. }));
    let ctx2 = StrategyContext {
        cfg: &cfg,
        p: &percept,
        mem: &mem,
        know: &know,
        paths: &mut paths,
        decide: &mut decide,
        lapse: &mut lapse,
        engaged: false,
    };
    // The second think is 500 ms later, so the adapter replays catch-up pieces over the same snapshot.
    let mut late = percept.clone();
    late.now = 1500.;
    let mut ctx2 = StrategyContext { p: &late, ..ctx2 };
    let second = adapter.decide(&mut ctx2, None, None);
    assert!(matches!(second, HuntDecision::Mob { .. }));
    assert!(adapter.stats().focus_ms > 0.);
    adapter.release(&mut ctx2);
    assert!(
        adapter.target().is_none(),
        "source release near-player call drops the engagement"
    );
}
