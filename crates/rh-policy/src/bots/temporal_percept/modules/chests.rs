//! Complete source chests feature module (`brain/modules/chests.ts`).
//!
//! Source-exact port of the unchanged legacy built-in: the per-source-cfg-object state (`WeakMap<object, ChestState>`
//! becomes a per-`CfgToken` entry, so equal-valued distinct cfg objects isolate and equal identity continues), the retained
//! `ChestHunter` plus the locally kept build/counted/readable/asks maps, the panel-close reset, the pick retry/window, the
//! blind (unreadable) chest rule, the fresh temporary hunter for `goals`, the source worth utility, and the exact
//! walk/wait/take/done reasons and intents. No hidden chest content is read from afar: a chest's cards only reach the
//! decision through the percept's own readable `options`.

use std::cell::RefCell;

use super::super::data::MethodValue;
use super::chest_hunt::{ChestDecision, ChestHunter, ChestInput, CHEST_HUNT};
use super::types::{
    chest_id_of, dist, module_goal, CardCounts, CfgToken, ChestSelf, Features, Goal, GoalDecision,
    GoalKind, GoalStatus, HuntChest, HuntSelf, Intent, MemoryApi, ModuleConfig, ModuleContext,
    ModuleOutput, ModulePaths, ModulePercept, PersonaParams, SourceChest, SourceModule,
    CHEST_RANGE, CHEST_SECONDS, EFFECT_CASTING, EFFECT_STUNNED,
};
use crate::bots::types::{
    ChooseMsg, IntentBody, IntentTiming, Stimulus, StimulusKind, PRIORITY_COMBAT, PRIORITY_GOAL,
};

/// Source `CHEST_RULES`: the module's numbers (u, ms, utility on strategy's 0..1 scale).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ChestRules {
    pub(crate) value: f64,
    pub(crate) crowd: f64,
    pub(crate) crowd_reach: f64,
    pub(crate) near: f64,
    pub(crate) near_reach: f64,
    pub(crate) cap: f64,
    pub(crate) ask_window_ms: f64,
    pub(crate) max_asks: f64,
    pub(crate) mob_near: f64,
}

/// Source `CHEST_RULES` literal.
pub(crate) const CHEST_RULES: ChestRules = ChestRules {
    value: 0.9,
    crowd: 0.15,
    crowd_reach: 3. * CHEST_RANGE,
    near: 0.2,
    near_reach: 800.,
    cap: 0.84,
    ask_window_ms: 4000.,
    max_asks: 3.,
    mob_near: 220.,
};

/// A chest seen from afar: one card the bot will take, whatever it is.
const BLIND: &[&str] = &["?"];

/// Source `Ask`.
#[derive(Clone, Debug, PartialEq)]
struct Ask {
    first: f64,
    option: i64,
    n: f64,
}

/// What the module keeps for one bot (source `ChestState`).
#[derive(Clone, Debug)]
struct ChestState {
    /// The retained hunter: its stall record belongs to the real walk `act` runs.
    hunter: ChestHunter,
    /// Card id -> count, from the chests this bot took a card at.
    build: CardCounts,
    counted: Vec<String>,
    /// When each chest's cards were first readable, and the pick asked for.
    readable: Vec<(String, f64)>,
    asks: Vec<(String, Ask)>,
    /// The goal kind the brain last ran.
    goal: GoalKind,
}
impl ChestState {
    fn new() -> Self {
        Self {
            hunter: ChestHunter::new(CHEST_HUNT),
            build: CardCounts::default(),
            counted: Vec::new(),
            readable: Vec::new(),
            asks: Vec::new(),
            goal: GoalKind::Idle,
        }
    }
}

fn state_of(states: &mut Vec<(CfgToken, ChestState)>, token: CfgToken) -> &mut ChestState {
    let index = match states.iter().position(|(existing, _)| *existing == token) {
        Some(index) => index,
        None => {
            states.push((token, ChestState::new()));
            states.len() - 1
        }
    };
    &mut states[index].1
}

/// JS `Math.min` (NaN-propagating; the chests' clocks are binary64).
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a <= b {
        a
    } else {
        b
    }
}

/// JS `Math.max` (NaN-propagating).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a >= b {
        a
    } else {
        b
    }
}

/// The run is on, the bot stands, and the gates are open.
fn live(p: &ModulePercept) -> bool {
    p.self_.status == "alive" && p.hud.phase == "active" && !p.hud.in_coliseum
}

/// Is the chest still inside the server's birth hold? Its age by its own clock.
fn in_hold(p: &ModulePercept, chest: &SourceChest) -> bool {
    chest.life_ms.unwrap_or(CHEST_SECONDS * 1000.) - (chest.expires_at - p.now) < CHEST_HUNT.hold_ms
}

/// What the bot holds: its own cards row (the percept), merged with the cards it took at a chest whose patch has not come
/// yet (source spread-then-Math.max order: the seen keys keep their places, local-only keys append).
fn own_build(p: &ModulePercept, st: &ChestState) -> CardCounts {
    match &p.self_.build {
        None => st.build.clone(),
        Some(seen) => seen.merged_max(&st.build),
    }
}

/// The source `cardScore` self the pick uses.
fn choice_self(p: &ModulePercept, persona: &PersonaParams, st: &ChestState) -> ChestSelf {
    let me = &p.self_;
    ChestSelf {
        faction: me.faction_text.clone(),
        weapons: me.weapons,
        slot: Some(me.slot),
        risk: Some(persona.risk),
        build: Some(own_build(p, st)),
    }
}

/// The source hunt input's `self`.
fn hunt_self(p: &ModulePercept, persona: &PersonaParams, st: &ChestState) -> HuntSelf {
    HuntSelf {
        id: p.self_.id.clone(),
        x: p.self_.x,
        y: p.self_.y,
        base: choice_self(p, persona, st),
        raw: None,
    }
}

/// In a fight, or one is on the bot's doorstep: only a near chest is worth leaving it for.
fn fighting(
    cfg: &ModuleConfig,
    mem: &dyn MemoryApi,
    p: &ModulePercept,
    st: &ChestState,
    engaged: bool,
) -> bool {
    if engaged || st.goal == GoalKind::Fight || st.goal == GoalKind::Hunt {
        return true;
    }
    if p.fighters
        .iter()
        .any(|fighter| fighter.status == "alive" && fighter.dist < cfg.persona.player_threat)
    {
        return true;
    }
    for (_, mob) in mem.mobs() {
        if mob.alive && mob.awake && dist(mob.pos, p.self_.pos()) <= CHEST_RULES.mob_near {
            return true;
        }
    }
    false
}

/// Running from something, or too hurt to be walking anywhere: no chest is worth it.
fn retreating(cfg: &ModuleConfig, p: &ModulePercept, st: &ChestState) -> bool {
    let me = &p.self_;
    st.goal == GoalKind::Flee || (me.max_hp > 0. && me.hp / me.max_hp < cfg.persona.flee_hp)
}

/// The hunt's input from the percept: a chest whose cards are shut gets the blind card, one it can read gets its cards.
fn hunt_chests(p: &ModulePercept, st: &ChestState, skip_tried: bool) -> Vec<HuntChest> {
    let mut chests = Vec::new();
    for chest in p.chests.iter().flatten() {
        if chest.picked || (skip_tried && st.hunter.tried(&chest.id)) {
            continue;
        }
        let options = chest
            .options
            .clone()
            .unwrap_or_else(|| BLIND.iter().map(|id| (*id).to_owned()).collect());
        let taken_by = if chest.options.is_some() {
            chest.taken_by.clone()
        } else {
            Vec::new()
        };
        chests.push(HuntChest {
            id: chest.id.clone(),
            kind: "reward".into(),
            x: chest.x,
            y: chest.y,
            expires_at: chest.expires_at,
            life_ms: chest.life_ms,
            options,
            taken_by,
            pickers: Vec::new(),
            raw: None,
        });
    }
    chests
}

/// What a walk to this chest is worth to this bot (a goal's utility).
fn worth(cfg: &ModuleConfig, p: &ModulePercept, chest: &SourceChest) -> f64 {
    let persona = cfg.persona;
    let crowded = p.fighters.iter().any(|fighter| {
        fighter.status == "alive" && dist(fighter.pos(), chest.pos()) <= CHEST_RULES.crowd_reach
    });
    let near = js_max(
        0.,
        1. - dist(p.self_.pos(), chest.pos()) / CHEST_RULES.near_reach,
    );
    js_min(
        CHEST_RULES.cap,
        CHEST_RULES.value * (0.25 + 0.75 * persona.loot)
            + if crowded {
                CHEST_RULES.crowd * persona.third_party
            } else {
                0.
            }
            + CHEST_RULES.near * near,
    )
}

/// The nearest chest whose cards the bot can read, that it has not picked at and that has time left; null when its asks
/// have run out. One out of its birth hold comes before a nearer one still in it.
fn cards_in_reach<'a>(p: &'a ModulePercept, st: &ChestState) -> Option<&'a SourceChest> {
    if !live(p) {
        return None;
    }
    let mut chest: Option<&SourceChest> = None;
    for candidate in p.chests.iter().flatten() {
        if candidate.options.is_none()
            || candidate.picked
            || candidate.expires_at - p.now <= CHEST_HUNT.pick_margin_ms
        {
            continue;
        }
        match chest {
            None => chest = Some(candidate),
            Some(best) => {
                let candidate_held = in_hold(p, candidate);
                let best_held = in_hold(p, best);
                let better = if candidate_held == best_held {
                    dist(p.self_.pos(), candidate.pos()) < dist(p.self_.pos(), best.pos())
                } else {
                    best_held
                };
                if better {
                    chest = Some(candidate);
                }
            }
        }
    }
    let chest = chest?;
    let ask = st
        .asks
        .iter()
        .find(|(chest_id, _)| *chest_id == chest.id)
        .map(|(_, ask)| ask);
    if ask.is_some_and(|ask| p.now - ask.first > CHEST_RULES.ask_window_ms) {
        None
    } else {
        Some(chest)
    }
}

/// The `choose` to send for the chest it is in reach of, or null.
fn pick_intent(p: &ModulePercept, cfg: &ModuleConfig, st: &mut ChestState) -> Option<Intent> {
    // The server refuses a pick from a stunned or casting player, and a refusal is a try spent: wait it out.
    if (p.own_effects() & (EFFECT_STUNNED | EFFECT_CASTING)) != 0 {
        return None;
    }
    let chest = cards_in_reach(p, st)?.clone();
    let options = chest.options.as_ref()?;
    if in_hold(p, &chest) {
        // Too young: nothing is asked (no ask is counted) until the server would take the pick.
        return None;
    }
    let option =
        super::choice::choose_option(options, &chest.taken_by, &choice_self(p, cfg.persona, st));
    match st
        .asks
        .iter()
        .position(|(chest_id, _)| *chest_id == chest.id)
    {
        None => st.asks.push((
            chest.id.clone(),
            Ask {
                first: p.now,
                option,
                n: 1.,
            },
        )),
        Some(index) => {
            let ask = &mut st.asks[index].1;
            if ask.option != option {
                if ask.n >= CHEST_RULES.max_asks {
                    return None;
                }
                ask.option = option;
                ask.n += 1.;
            }
        }
    }
    let opened = st
        .readable
        .iter()
        .find(|(chest_id, _)| *chest_id == chest.id)
        .map_or(p.now, |(_, at)| *at);
    let why = if option >= 0 {
        format!(
            "chest {}: card {} ({})",
            chest.id, option, options[option as usize]
        )
    } else {
        format!("chest {}: nothing to use, skip", chest.id)
    };
    Some(Intent {
        body: IntentBody::Choose {
            msg: ChooseMsg {
                chest: chest.id.clone(),
                pick: option as i8,
                replace: None,
            },
        },
        priority: PRIORITY_COMBAT,
        timing: IntentTiming::React {
            stimulus: Stimulus {
                kind: StimulusKind::ChestUp,
                at: opened,
                subject: Some(chest.id.clone()),
                central: true,
                value: None,
            },
        },
        why,
    })
}

/// The declared state a hunt call consumes, assembled before the retained hunter is borrowed mutably.
struct HuntFacts {
    now: f64,
    chests: Vec<HuntChest>,
    self_: HuntSelf,
    fighting: bool,
    retreating: bool,
    in_coliseum: bool,
    teleport_at: Option<f64>,
}

fn hunt_facts(
    p: &ModulePercept,
    cfg: &ModuleConfig,
    mem: &dyn MemoryApi,
    engaged: bool,
    st: &ChestState,
    skip_tried: bool,
) -> HuntFacts {
    HuntFacts {
        now: p.now,
        chests: hunt_chests(p, st, skip_tried),
        self_: hunt_self(p, cfg.persona, st),
        fighting: fighting(cfg, mem, p, st, engaged),
        retreating: retreating(cfg, p, st),
        in_coliseum: p.hud.in_coliseum,
        teleport_at: Some(if p.hud.gates_locked {
            0.
        } else {
            p.hud.patience_ends_at
        }),
    }
}

/// One source hunt call over the declared path service: the walk/sight callbacks pass the chest row object itself.
fn run_hunt(
    hunter: &mut ChestHunter,
    paths: &mut dyn ModulePaths,
    walk_paths: bool,
    facts: HuntFacts,
    log: &mut dyn FnMut(&str),
) -> ChestDecision {
    let me = facts.self_.pos();
    let cells = RefCell::new(paths);
    let mut walk = |chest: &HuntChest| -> Option<f64> {
        if walk_paths {
            cells
                .borrow_mut()
                .walk_target(me, chest)
                .map(|answer| answer.dist)
        } else {
            Some(dist(me, chest.pos()) * 1.3)
        }
    };
    let mut sight = |chest: &HuntChest| -> bool { cells.borrow().los_target(me, chest) };
    let mut input = ChestInput {
        now: facts.now,
        server_time: facts.now,
        self_: facts.self_,
        chests: facts.chests,
        walk: &mut walk,
        sight: &mut sight,
        fighting: facts.fighting,
        retreating: facts.retreating,
        in_coliseum: facts.in_coliseum,
        teleport_at: facts.teleport_at,
    };
    hunter.decide(&mut input, log)
}

/// The source module goal for a chest.
fn chest_goal(id: &str) -> Goal {
    module_goal(
        "chests",
        MethodValue::Obj(vec![("chest".to_owned(), MethodValue::Str(id.to_owned()))]),
    )
}

/// A walk is the answer to the chest appearing when this percept brought it, else the next step of a plan.
fn walk_timing(mem: &dyn MemoryApi, chest: &str) -> IntentTiming {
    match mem.stimuli().iter().find(|stimulus| {
        stimulus.kind == StimulusKind::ChestUp && stimulus.subject.as_deref() == Some(chest)
    }) {
        Some(stimulus) => IntentTiming::React {
            stimulus: stimulus.clone(),
        },
        None => IntentTiming::Step {},
    }
}

fn move_intent(chest: &SourceChest, timing: IntentTiming) -> Intent {
    Intent {
        body: IntentBody::Move { to: chest.pos() },
        priority: PRIORITY_GOAL,
        timing,
        why: format!("to reward chest {}", chest.id),
    }
}

fn end_done(why: &str, intents: Vec<Intent>) -> ModuleOutput {
    ModuleOutput::new(intents, GoalStatus::done(why), false)
}

fn end_running(why: &str, intents: Vec<Intent>) -> ModuleOutput {
    ModuleOutput::new(intents, GoalStatus::running(why), false)
}

/// Source `chestsModule`.
#[derive(Default)]
pub(crate) struct ChestsModule {
    /// Per source cfg-object identity (the source `WeakMap<object, ChestState>`).
    states: Vec<(CfgToken, ChestState)>,
}

impl SourceModule for ChestsModule {
    fn id(&self) -> &'static str {
        "chests"
    }
    fn enabled(&self, features: &Features) -> bool {
        features.chests
    }
    fn hooks(&self) -> &'static [&'static str] {
        super::types::ModuleId::Chests.hooks()
    }
    fn observe(&mut self, ctx: &mut ModuleContext<'_>) {
        let p = ctx.p;
        let cfg = ctx.cfg;
        let Some(chests) = p.chests.as_ref() else {
            return;
        };
        let me = &p.self_;
        let st = state_of(&mut self.states, cfg.token);
        for chest in chests {
            if chest.options.is_none() {
                // Out of reach of the cards again (the panel closed): a pick still on its way is not clicked.
                st.readable.retain(|(id, _)| *id != chest.id);
                st.asks.retain(|(id, _)| *id != chest.id);
                continue;
            }
            if !st.readable.iter().any(|(id, _)| *id == chest.id) {
                st.readable.push((chest.id.clone(), p.now));
            }
            if st.counted.contains(&chest.id) {
                continue;
            }
            let Some(index) = chest.taken_by.iter().position(|id| id == &me.id) else {
                continue;
            };
            st.counted.push(chest.id.clone());
            let card = chest
                .options
                .as_ref()
                .and_then(|options| options.get(index));
            if let Some(card) = card {
                if !card.is_empty() {
                    st.build.add_one(card);
                }
            }
        }
    }

    fn goals(&mut self, ctx: &mut ModuleContext<'_>) -> Vec<GoalDecision> {
        let p = ctx.p;
        let cfg = ctx.cfg;
        let mem = ctx.mem;
        let engaged = ctx.engaged;
        let Some(chests) = p.chests.as_ref() else {
            return Vec::new();
        };
        if chests.is_empty() || !live(p) {
            return Vec::new();
        }
        let st = state_of(&mut self.states, cfg.token);
        // In reach of the cards with the pick still to make: the bot stays for it.
        if let Some(here) = cards_in_reach(p, st) {
            let utility = worth(cfg, p, here);
            let why = format!("taking its pick at chest {}", here.id);
            return vec![GoalDecision {
                goal: chest_goal(&here.id),
                utility,
                why,
                choice: None,
            }];
        }
        // A fresh hunt each time: its stall record belongs to the real walk `act` runs, not to a question.
        let mut temporary = ChestHunter::new(CHEST_HUNT);
        let facts = hunt_facts(p, cfg, mem, engaged, st, true);
        let mut noop = |_message: &str| {};
        let decision = run_hunt(
            &mut temporary,
            &mut *ctx.paths,
            cfg.tier.route.walk_paths,
            facts,
            &mut noop,
        );
        let ChestDecision::Walk { chest: id, .. } = decision else {
            return Vec::new();
        };
        let Some(chest) = chests.iter().find(|chest| chest.id == id) else {
            return Vec::new();
        };
        let utility = worth(cfg, p, chest);
        vec![GoalDecision {
            goal: chest_goal(&id),
            utility,
            why: format!("reward chest {id}"),
            choice: None,
        }]
    }

    fn intents(&mut self, ctx: &mut ModuleContext<'_>, goal: &Goal) -> Vec<Intent> {
        let p = ctx.p;
        let cfg = ctx.cfg;
        let st = state_of(&mut self.states, cfg.token);
        st.goal = goal.kind();
        match pick_intent(p, cfg, st) {
            Some(intent) => vec![intent],
            None => Vec::new(),
        }
    }

    fn act(&mut self, ctx: &mut ModuleContext<'_>, goal: &Goal) -> ModuleOutput {
        let p = ctx.p;
        let cfg = ctx.cfg;
        let mem = ctx.mem;
        let engaged = ctx.engaged;
        let sink = ctx.log;
        let st = state_of(&mut self.states, cfg.token);
        st.goal = GoalKind::Module;
        let id = chest_id_of(goal).unwrap_or_else(|| "undefined".to_owned());
        let chest = p
            .chests
            .as_ref()
            .and_then(|chests| chests.iter().find(|chest| chest.id == id))
            .cloned();
        let Some(chest) = chest else {
            return end_done("the chest is gone, or already picked", Vec::new());
        };
        if chest.picked || chest.expires_at <= p.now || !live(p) {
            return end_done("the chest is gone, or already picked", Vec::new());
        }

        let mut intents: Vec<Intent> = Vec::new();
        let mut picked = false;
        if let Some(pick) = pick_intent(p, cfg, st) {
            intents.push(pick);
            picked = true;
        }
        let facts = hunt_facts(p, cfg, mem, engaged, st, false);
        let mut log = |message: &str| sink(message);
        let decision = run_hunt(
            &mut st.hunter,
            &mut *ctx.paths,
            cfg.tier.route.walk_paths,
            facts,
            &mut log,
        );
        let mut walking_to_goal = false;
        if let ChestDecision::Walk {
            chest: walk_chest, ..
        } = &decision
        {
            if *walk_chest == id {
                walking_to_goal = true;
                // In reach of its cards it stands: the pick is on its way.
                if chest.options.is_none() {
                    intents.push(move_intent(&chest, walk_timing(mem, &id)));
                }
            }
        }
        if walking_to_goal {
            return end_running("walking to the chest", intents);
        }
        // In reach of its cards but still in the birth hold: it stands and waits the few ticks.
        if chest.options.is_some() && in_hold(p, &chest) {
            return end_running("waiting out the chest's birth hold", intents);
        }
        let ask = st
            .asks
            .iter()
            .find(|(chest_id, _)| *chest_id == id)
            .map(|(_, ask)| ask);
        if picked
            || (chest.options.is_some()
                && ask.is_some_and(|ask| p.now - ask.first <= CHEST_RULES.ask_window_ms))
        {
            return end_running("taking its pick", intents);
        }
        let why = if matches!(decision, ChestDecision::Walk { .. }) {
            "another chest is nearer"
        } else {
            "not worth the walk, or given up"
        };
        end_done(why, intents)
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::memory::{
        CampMemory, ContainerMemory, FighterMemory, MobMemory, SelfMemory, Whereabouts,
    };
    use super::super::types::{ModuleHud, ModuleSelf, RngLanes, RngStream};
    use super::*;
    use crate::bots::planning::PlanMap;
    use crate::bots::types::{PERSONAS, TIERS};
    #[cfg(test)]
    use rh_sim::Vec2;
    use rh_sim::{FactionId, TileMap, WeaponId};
    use std::cell::RefCell;
    use std::rc::Rc;

    struct DummyRng;
    impl RngStream for DummyRng {
        fn draw(&mut self) -> f64 {
            0.
        }
    }

    fn arena() -> &'static TileMap {
        Box::leak(Box::new(
            TileMap::new(64, 64, vec![0u8; 64 * 64]).expect("hand-built arena"),
        ))
    }

    fn plan_map() -> &'static PlanMap {
        Box::leak(Box::new(PlanMap::default()))
    }

    struct FakePaths;
    impl ModulePaths for FakePaths {
        fn walk(&mut self, from: Vec2, to: Vec2) -> Option<crate::bots::paths::WalkAnswer> {
            Some(crate::bots::paths::WalkAnswer {
                dist: dist(from, to),
                exact: true,
            })
        }
        fn path(&mut self, _from: Vec2, _to: Vec2) -> Option<Vec<Vec2>> {
            None
        }
        fn los(&self, _a: Vec2, _b: Vec2) -> bool {
            true
        }
        fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
            true
        }
        fn collision_map(&self) -> &TileMap {
            arena()
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
    }
    impl FakeMemory {
        fn new() -> Self {
            Self {
                fighters: Vec::new(),
                mobs: Vec::new(),
                camps: Vec::new(),
                containers: Vec::new(),
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
                stimuli: Vec::new(),
                bounties: Vec::new(),
                choices: Vec::new(),
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
        fn whereabouts(&self, _id: &str, _now: f64) -> Option<Whereabouts> {
            None
        }
    }

    fn me_self(build: Option<CardCounts>) -> ModuleSelf {
        ModuleSelf {
            id: "me".into(),
            name: "Me".into(),
            x: 1008.,
            y: 1008.,
            facing: 0.,
            status: "alive".into(),
            hp: 100.,
            max_hp: 100.,
            barrier: 0.,
            faction_text: "fire".into(),
            faction: Some(FactionId::Fire),
            weapons: [Some(WeaponId::Sword), None],
            slot: 0,
            attack_target: None,
            build,
            record: MethodValue::Obj(Vec::new()),
        }
    }

    fn percept(now: f64, chests: Vec<SourceChest>) -> ModulePercept {
        ModulePercept {
            now,
            view_t: now - 30.,
            self_: me_self(Some(CardCounts::default())),
            hud: ModuleHud {
                phase: "active".into(),
                in_coliseum: false,
                gates_locked: false,
                patience_ends_at: 200_000.,
            },
            fighters: Vec::new(),
            mobs: Vec::new(),
            chests: Some(chests),
            wish: None,
            effects: Vec::new(),
            events: Vec::new(),
            features: Features::default(),
        }
    }

    fn chest(id: &str, dx: f64, expires_at: f64) -> SourceChest {
        SourceChest {
            id: id.into(),
            x: 1008. + dx,
            y: 1008.,
            expires_at,
            life_ms: None,
            options: None,
            taken_by: Vec::new(),
            picked: false,
        }
    }

    fn readable(mut chest: SourceChest, options: &[&str], taken_by: &[&str]) -> SourceChest {
        chest.options = Some(options.iter().map(|id| (*id).to_owned()).collect());
        chest.taken_by = taken_by.iter().map(|id| (*id).to_owned()).collect();
        chest
    }

    struct Fixture {
        tier: &'static crate::bots::types::TierParams,
        persona: &'static PersonaParams,
        map: &'static TileMap,
        terrain: Vec<u8>,
        plan_map: &'static PlanMap,
        features: Features,
        learned: (),
        percept: ModulePercept,
        memory: FakeMemory,
        paths: FakePaths,
        messages: Rc<RefCell<Vec<String>>>,
        token: CfgToken,
        engaged: bool,
    }
    impl Fixture {
        fn new(now: f64, chests: Vec<SourceChest>) -> Self {
            Self {
                tier: &TIERS[2],
                persona: &PERSONAS[3],
                map: arena(),
                terrain: vec![0u8; 64 * 64],
                plan_map: plan_map(),
                features: Features {
                    chests: true,
                    ..Features::default()
                },
                learned: (),
                percept: percept(now, chests),
                memory: FakeMemory::new(),
                paths: FakePaths,
                messages: Rc::new(RefCell::new(Vec::new())),
                token: CfgToken(1),
                engaged: false,
            }
        }
        fn set_scene(&mut self, now: f64, chests: Vec<SourceChest>) {
            self.percept.now = now;
            self.percept.chests = Some(chests);
        }
        fn run<R>(&mut self, f: impl FnOnce(&mut ModuleContext<'_>) -> R) -> R {
            let cfg = ModuleConfig {
                token: self.token,
                id: "me".into(),
                tier: self.tier,
                persona: self.persona,
                map: self.map,
                terrain: self.terrain.as_slice(),
                plan_map: self.plan_map,
                features: &self.features,
                learned: &self.learned,
            };
            let mut decide = DummyRng;
            let mut motor = DummyRng;
            let mut lapse = DummyRng;
            let rng = RngLanes {
                decide: &mut decide,
                motor: &mut motor,
                lapse: &mut lapse,
            };
            let messages = self.messages.clone();
            let log = move |message: &str| messages.borrow_mut().push(message.to_owned());
            let mut ctx = ModuleContext {
                cfg: &cfg,
                p: &self.percept,
                mem: &self.memory,
                paths: &mut self.paths,
                collision: self.map,
                log: &log,
                rng,
                engaged: self.engaged,
            };
            f(&mut ctx)
        }
        fn observe(&mut self, module: &mut ChestsModule) {
            self.run(|ctx| module.observe(ctx));
        }
        fn goals(&mut self, module: &mut ChestsModule) -> Vec<GoalDecision> {
            self.run(|ctx| module.goals(ctx))
        }
        fn intents(&mut self, module: &mut ChestsModule) -> Vec<Intent> {
            self.run(|ctx| {
                let goal = Goal::Idle;
                module.intents(ctx, &goal)
            })
        }
        fn act(&mut self, module: &mut ChestsModule, goal: &Goal) -> ModuleOutput {
            self.run(|ctx| module.act(ctx, goal))
        }
    }

    fn chest_goal_for(id: &str) -> Goal {
        module_goal(
            "chests",
            MethodValue::Obj(vec![("chest".to_owned(), MethodValue::Str(id.to_owned()))]),
        )
    }

    fn choose(chest: &str, pick: i8, at: f64, why: &str) -> Intent {
        Intent {
            body: IntentBody::Choose {
                msg: ChooseMsg {
                    chest: chest.into(),
                    pick,
                    replace: None,
                },
            },
            priority: PRIORITY_COMBAT,
            timing: IntentTiming::React {
                stimulus: Stimulus {
                    kind: StimulusKind::ChestUp,
                    at,
                    subject: Some(chest.into()),
                    central: true,
                    value: None,
                },
            },
            why: why.into(),
        }
    }

    #[test]
    fn same_option_retry_keeps_the_intent_and_the_window_is_4000() {
        let mut module = ChestsModule::default();
        let mut fx = Fixture::new(
            100_000.,
            vec![readable(
                chest("box", 30., 114_000.),
                &["ad1", "ap1", "vitality1"],
                &[],
            )],
        );
        fx.observe(&mut module);
        assert_eq!(
            fx.intents(&mut module),
            vec![choose("box", 0, 100_000., "chest box: card 0 (ad1)")]
        );
        // The same option again: still asked (the humanizer dedupes), the ask is not counted again.
        for now in [100_001., 104_000.] {
            fx.set_scene(
                now,
                vec![readable(
                    chest("box", 30., 114_000.),
                    &["ad1", "ap1", "vitality1"],
                    &[],
                )],
            );
            fx.observe(&mut module);
            assert_eq!(
                fx.intents(&mut module),
                vec![choose("box", 0, 100_000., "chest box: card 0 (ad1)")],
                "now {now}"
            );
        }
        // Past the 4000 ms window from the first ask, the chest is no longer in reach for asks.
        fx.set_scene(
            104_001.,
            vec![readable(
                chest("box", 30., 114_000.),
                &["ad1", "ap1", "vitality1"],
                &[],
            )],
        );
        fx.observe(&mut module);
        assert_eq!(fx.intents(&mut module), Vec::new());
    }

    #[test]
    fn a_changed_option_is_asked_again_at_most_three_times() {
        let mut module = ChestsModule::default();
        let mut fx = Fixture::new(100_000., Vec::new());
        let taken_by: [&[&str]; 4] = [&[], &["x"], &["x", "y"], &["x", "y", "z"]];
        let expected: [i8; 4] = [0, 1, 2, -1];
        for (step, taken) in taken_by.iter().enumerate() {
            let now = 100_000. + step as f64;
            fx.set_scene(
                now,
                vec![readable(
                    chest("box", 30., 114_000.),
                    &["ad1", "ap1", "vitality1"],
                    taken,
                )],
            );
            fx.observe(&mut module);
            let intents = fx.intents(&mut module);
            if step < 3 {
                let pick = expected[step];
                let card = ["ad1", "ap1", "vitality1"][pick as usize];
                assert_eq!(
                    intents,
                    vec![choose(
                        "box",
                        pick,
                        100_000.,
                        &format!("chest box: card {pick} ({card})")
                    )],
                    "step {step}"
                );
            } else {
                // A fourth different option is never asked.
                assert_eq!(intents, Vec::new(), "step {step}");
            }
        }
    }

    #[test]
    fn a_blind_panel_is_not_read_and_a_reopen_resets_the_reading_clock() {
        let mut module = ChestsModule::default();
        let mut fx = Fixture::new(100_000., vec![chest("box", 30., 114_000.)]);
        fx.observe(&mut module);
        assert_eq!(fx.intents(&mut module), Vec::new());
        // The panel opens later: readable from then on, and the choose reacts to that first read.
        fx.set_scene(
            100_100.,
            vec![readable(chest("box", 30., 114_000.), &["ad1", "ap1"], &[])],
        );
        fx.observe(&mut module);
        assert_eq!(
            fx.intents(&mut module),
            vec![choose("box", 0, 100_100., "chest box: card 0 (ad1)")]
        );
    }

    #[test]
    fn a_taken_card_is_counted_once_and_unlocks_the_conditional() {
        let mut module = ChestsModule::default();
        let mut picked = readable(chest("box", 30., 114_000.), &["ad1"], &["me"]);
        picked.picked = true;
        let mut fx = Fixture::new(
            100_000.,
            vec![
                picked,
                readable(chest("choice", 40., 114_000.), &["spellsword", "?"], &[]),
            ],
        );
        fx.observe(&mut module);
        assert_eq!(
            fx.intents(&mut module),
            vec![choose(
                "choice",
                0,
                100_000.,
                "chest choice: card 0 (spellsword)"
            )]
        );
        // Counting the same chest a second time does not stack the local build again (the conditional still reads it).
        fx.observe(&mut module);
        assert_eq!(
            fx.intents(&mut module),
            vec![choose(
                "choice",
                0,
                100_000.,
                "chest choice: card 0 (spellsword)"
            )]
        );
    }

    #[test]
    fn goals_score_the_pick_stop_and_the_fresh_hunt_walk() {
        let mut module = ChestsModule::default();
        let mut fx = Fixture::new(
            100_000.,
            vec![readable(
                chest("box", 30., 114_000.),
                &["ad1", "ap1", "vitality1"],
                &[],
            )],
        );
        fx.observe(&mut module);
        let decisions = fx.goals(&mut module);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].goal, chest_goal_for("box"));
        assert_eq!(decisions[0].why, "taking its pick at chest box");
        // worth = min(0.84, 0.9 * (0.25 + 0.75 * 0.5) + 0.2 * (1 - 30 / 800)).
        assert_eq!(decisions[0].utility, 0.755);
        assert!(decisions[0].choice.is_none());

        // A far, unreadable chest: only the temporary hunt decides the walk, so goals keeps no stall record.
        let mut fx = Fixture::new(100_000., vec![chest("box", 500., 114_000.)]);
        fx.observe(&mut module);
        let decisions = fx.goals(&mut module);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].goal, chest_goal_for("box"));
        assert_eq!(decisions[0].why, "reward chest box");
        assert_eq!(decisions[0].utility, 0.6375);
    }

    #[test]
    fn act_reports_the_source_walk_wait_and_done_reasons() {
        let mut module = ChestsModule::default();
        // A blind chest out of reach: walk to it and move there (the cards are not read).
        let mut fx = Fixture::new(100_000., vec![chest("box", 500., 114_000.)]);
        fx.observe(&mut module);
        let output = fx.act(&mut module, &chest_goal_for("box"));
        assert_eq!(output.status, GoalStatus::running("walking to the chest"));
        assert_eq!(
            output.intents,
            vec![Intent {
                body: IntentBody::Move {
                    to: Vec2::new(1508., 1008.)
                },
                priority: PRIORITY_GOAL,
                timing: IntentTiming::Step {},
                why: "to reward chest box".into(),
            }]
        );
        assert!(!output.attacking);

        // A young chest in reach: stand and wait out the birth hold.
        let mut young = readable(chest("box", 30., 120_100.), &["ad1", "ap1"], &[]);
        young.life_ms = Some(15_000.);
        let mut fx = Fixture::new(100_000., vec![young]);
        fx.observe(&mut module);
        let output = fx.act(&mut module, &chest_goal_for("box"));
        assert_eq!(
            output.status,
            GoalStatus::running("waiting out the chest's birth hold")
        );
        assert_eq!(output.intents, Vec::new());

        // The goal chest is not the nearest one: the source stops with "another chest is nearer".
        let mut fx = Fixture::new(
            100_000.,
            vec![
                chest("wanted", 700., 114_000.),
                chest("nearer", 300., 114_000.),
            ],
        );
        fx.observe(&mut module);
        let output = fx.act(&mut module, &chest_goal_for("wanted"));
        assert_eq!(output.status, GoalStatus::done("another chest is nearer"));
        assert_eq!(output.intents, Vec::new());

        // A missing (or picked/expired) goal chest is done.
        let mut fx = Fixture::new(100_000., Vec::new());
        fx.observe(&mut module);
        let output = fx.act(&mut module, &chest_goal_for("gone"));
        assert_eq!(
            output.status,
            GoalStatus::done("the chest is gone, or already picked")
        );
        assert_eq!(output.intents, Vec::new());
    }
}
