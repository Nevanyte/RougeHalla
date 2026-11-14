//! Complete source Wishes feature module (`packages/server/src/bots/brain/modules/wishes.ts`) over the leased shared
//! Wish core (P-BOT-MODULES-1, Root-corrected `wish.rs` lease).
//!
//! This is the unchanged source module object, not a public-observation adapter: it consumes the private typed inputs the
//! source consumes (`ModulePercept` with the complete `extras.wish`/`extras.effects` facts, the admitted private `Memory`,
//! declared cfg identity, the real path service and the source streams) and returns the source's own goals/intents/statuses.
//! State is keyed on the declared cfg object identity exactly like the source `WeakMap`: equal-valued distinct cfg tokens
//! isolate state, the same token continues it, and nothing is keyed on an actor id/name.
//!
//! Hook bodies follow `wishes.ts` literally:
//! - `observe`: the availability edge and the Easy tier's one remember draw per usable edge (from the declared decide lane).
//! - `goals`: `defOf` + `slipping` + (retained slip origin or a nearest enemy on screen) → the single slip module goal
//!   `{kind:"module", module:"wishes", data:{mode:"slip"}}` with utility 1.4 and the source why string.
//! - `intents`: the cast decision first (arming the slipping state inside it), then the slip step.
//! - `act`: source goal-mode/`defOf`/`slipping` guards, cast retry, then the slip step and the exact done/running reasons.
//!
//! The cast situation is built from the declared percept + admitted Memory (`mem.self.lastHitAt`, `mem.fighters[*].hitMeAt`,
//! `mem.self.lastCast`, `mem.stimuli`), the real open map and the real path-service collision map + gate flag. The declared
//! `extras.wish.def` is read through the finite-profile admission entry (`bots::wish::admit_ranks`): the five actual built-in
//! definitions are decided on exactly; an unsupported future shape (dir targeting, blink distances other than the proved
//! `(300, 64)`, an absent consumed rank member) is refused before any state mutation, which is this module's "no decision",
//! never a silently converted catalog row. Unknown `ai`/`blockedBy` tags are refused by the typed reader at its own boundary
//! (`admit_ai_tag`/`admit_blocked_by`).
use super::super::data::MethodValue;
use super::super::memory::MemoryCommand;
use super::types::{
    AbilityDef, AbilityRank, CfgToken, Features, Goal, GoalDecision, GoalStatus, Intent,
    ModuleContext, ModuleFighter, ModuleId, ModuleOutput, ModulePaths, ModulePercept, SourceModule,
    WishTargeting, WishView, EFFECT_CASTING, EFFECT_HIDDEN,
};
use crate::bots::types::{IntentBody, IntentTiming, TierId, PRIORITY_COMBAT, PRIORITY_REFLEX};
use crate::bots::wish::{
    admit_ranks, source_cast_why, source_decide_cast, source_hides_caster, source_rank_of,
    AiIntent, DeclaredRank, DeclaredTargeting, FoeView, HypotMode, MeView, SourceAbility,
    SourceCastSituation, SourceRank, TargetRule, ThreatView, WishStateCore, CAST_STIMULI,
    DONE_CORNERED, DONE_NOBODY, DONE_NOT_SLIPPING, ESCAPE_HP_HIT, FAILED_UNKNOWN_GOAL,
    RUNNING_SLIPPING, SLIP_GOAL_MODE, SLIP_GOAL_MODULE, SLIP_GOAL_WHY, SLIP_STEP_WHY, SLIP_UTILITY,
    TARGET_SNAP_RADIUS, WISH_RULES,
};
use rh_sim::abilities::blink;
use rh_sim::mapgen::certify::source_hypot as js_hypot;
use rh_sim::Vec2;

/// The finite `WishTargeting` -> core declared targeting adapter. `dir` (and any unknown kind the reader could not name) is
/// `Unsupported`, refined/refused by `admit_ranks` before a decision and therefore before any state mutation.
fn declared_rank(rank: &AbilityRank) -> DeclaredRank {
    DeclaredRank {
        cast_ms: rank.cast_ms,
        targeting: rank.targeting.map(|targeting| match targeting {
            WishTargeting::Self_ => DeclaredTargeting::Self_,
            WishTargeting::Unit {
                range,
                los,
                snap_radius,
            } => DeclaredTargeting::Unit {
                range,
                los,
                snap_radius,
            },
            WishTargeting::Point { range, min_range } => {
                DeclaredTargeting::Point { range, min_range }
            }
            WishTargeting::Dir => DeclaredTargeting::Unsupported,
        }),
        hides_caster: rank.hides_caster,
        blink: rank.blink,
        wall: rank.wall,
    }
}

/// The finite-profile reader/validation entry for a guard-passing declared def: every consumed rank member must be present
/// and in the proved five-Wish shape, or this refuses with the exact source field path before the caller mutates anything.
/// `Ok(None)` is the source `defOf` null case (absent/invalid def object); `Err` is a declared-but-unsupported shape.
pub(crate) fn read_declared_ranks(
    view: &WishView,
) -> Result<Option<Vec<SourceRank>>, crate::bots::wish::WishRefusal> {
    let Some(def) = view.def_of() else {
        return Ok(None);
    };
    let ranks: Vec<DeclaredRank> = def.ranks.iter().map(declared_rank).collect();
    Ok(Some(admit_ranks(&ranks)?))
}

/// Source `playedDef`: every tier plays all declared tags; Easy keeps only the defensive tags (escape/sustain) in order.
fn played_ai(def: &AbilityDef, easy: bool) -> Vec<AiIntent> {
    if !easy {
        return def.ai.clone();
    }
    def.ai
        .iter()
        .copied()
        .filter(|intent| matches!(intent, AiIntent::Escape | AiIntent::Sustain))
        .collect()
}

/// Source `usable`: the run is on, the bot stands, and the slot's ready time has come.
fn usable(p: &ModulePercept, view: &WishView) -> bool {
    p.hud.phase == "active" && p.self_.status == "alive" && p.now >= view.ready_at
}

/// Source `ownBits`: the bot's own declared EFFECT_* bits. The policy only consumes the actual EFFECT_* bit domain, so the
/// declared bits are read as the source's own bits (values outside the status-bit domain are not part of this profile).
fn own_bits(p: &ModulePercept) -> u16 {
    (p.own_effects() & u32::from(u16::MAX)) as u16
}

/// Source `nearestEnemy`: the first alive percept player with the strict minimum source `dist` (ties keep the earlier row).
fn nearest_enemy(p: &ModulePercept) -> Option<&ModuleFighter> {
    let mut best: Option<&ModuleFighter> = None;
    for fighter in &p.fighters {
        if fighter.status != "alive" {
            continue;
        }
        if best.is_none_or(|current| fighter.dist < current.dist) {
            best = Some(fighter);
        }
    }
    best
}

/// Source `chasing(ctx, f)`: walking at the bot at least `chaseClosing` u/s within `chaseCos` of the line, or a remembered
/// hit on the bot this recent while this close (a melee fighter locked on stops at reach).
fn chasing(ctx: &ModuleContext<'_>, fighter: &ModuleFighter) -> bool {
    let speed = js_hypot(fighter.vx, fighter.vy);
    if speed > 0. && fighter.dist > 1. {
        let me = &ctx.p.self_;
        let toward =
            (fighter.vx * (me.x - fighter.x) + fighter.vy * (me.y - fighter.y)) / fighter.dist;
        if toward >= WISH_RULES.chase_closing && toward / speed > WISH_RULES.chase_cos {
            return true;
        }
    }
    let hit = ctx
        .mem
        .fighters()
        .iter()
        .find(|(id, _)| id == &fighter.id)
        .and_then(|(_, memory)| memory.hit_me_at);
    match hit {
        Some(at) => {
            ctx.p.now - at <= WISH_RULES.recent_hit_ms && fighter.dist <= WISH_RULES.on_it_distance
        }
        None => false,
    }
}

/// Source `foeOf`: the player or mob the goal is fighting, if it is on screen and alive. A mob foe is targetable by the
/// module's own rule; the policy still never engages/controls a mob.
fn foe_of(ctx: &ModuleContext<'_>, goal: &Goal) -> Option<FoeView> {
    let id = match goal {
        Goal::Hunt { target } | Goal::Fight { target } => target,
        Goal::Farm { mob, .. } => mob,
        _ => return None,
    };
    if let Some(fighter) = ctx
        .p
        .fighters
        .iter()
        .find(|fighter| &fighter.id == id && fighter.status == "alive")
    {
        return Some(FoeView {
            id: fighter.id.clone(),
            x: fighter.x,
            y: fighter.y,
            d: fighter.dist,
            los: fighter.los,
            targetable: fighter.targetable,
            mob: false,
        });
    }
    let mob = ctx
        .p
        .mobs
        .iter()
        .find(|mob| &mob.id == id && mob.status == "alive")?;
    Some(FoeView {
        id: mob.id.clone(),
        x: mob.x,
        y: mob.y,
        d: mob.dist,
        los: mob.los,
        targetable: true,
        mob: true,
    })
}

/// The moment as the shared policy wants it, from the declared percept and memory alone: own hp share, own bits and whether
/// it was hit lately; the goal's target if it is on screen; the nearest enemy player and whether it is coming; the real open
/// map (ring/region identity), the real current collision map and the real gate flag.
fn cast_situation<'a>(
    ctx: &'a ModuleContext<'_>,
    goal: &Goal,
    ring: &'a blink::Ring,
) -> SourceCastSituation<'a> {
    let p = ctx.p;
    let recently_hit = ctx
        .mem
        .self_memory()
        .last_hit_at
        .is_some_and(|at| p.now - at <= WISH_RULES.recent_hit_ms);
    let threat = nearest_enemy(p).map(|fighter| ThreatView {
        x: fighter.x,
        y: fighter.y,
        d: fighter.dist,
        chasing: chasing(ctx, fighter),
        id: Some(fighter.id.clone()),
        los: Some(fighter.los),
        targetable: Some(fighter.targetable),
    });
    SourceCastSituation {
        me: MeView {
            x: p.self_.x,
            y: p.self_.y,
            hp_frac: p.self_.hp_frac(),
            effects: own_bits(p),
            recently_hit,
        },
        foe: foe_of(ctx, goal),
        threat,
        map: ctx.cfg.map,
        collision: ctx.collision,
        ring,
        gates_locked: p.hud.gates_locked,
        hypot: HypotMode::Js,
    }
}

/// Source `timingOf`: a reaction to the most telling CAST_STIMULUS in the admitted Memory, else the next step.
fn timing_of(ctx: &ModuleContext<'_>) -> IntentTiming {
    let stimuli = ctx.mem.stimuli();
    for kind in CAST_STIMULI {
        if let Some(stimulus) = stimuli.iter().find(|stimulus| stimulus.kind == kind) {
            return IntentTiming::React {
                stimulus: stimulus.clone(),
            };
        }
    }
    IntentTiming::Step {}
}

/// Source `slipStep`'s `from` update: the nearest enemy player on screen, when there is one.
fn slip_from(p: &ModulePercept) -> Option<Vec2> {
    nearest_enemy(p).map(|fighter| Vec2::new(fighter.x, fighter.y))
}

/// Source `slipping(ctx, st)`'s sent-cast clock: `mem.self.lastCast` when it is a cast sent at/after the slip was armed,
/// filtered against the declared `armedAt` (`at >= armedAt`). The source never substitutes the first observed casting bit.
fn sent_cast_at(ctx: &ModuleContext<'_>, armed_at: Option<f64>) -> Option<f64> {
    let armed = armed_at?;
    let last = ctx.mem.self_memory().last_cast.as_ref()?;
    if !matches!(last.cmd, MemoryCommand::Cast) {
        return None;
    }
    (last.at >= armed).then_some(last.at)
}

/// Source `goal.data["mode"] !== "slip"`'s passing half: the goal is the declared `{module:"wishes", data:{mode:"slip"}}`.
fn is_slip_goal(goal: &Goal) -> bool {
    let Goal::Module { data, .. } = goal else {
        return false;
    };
    let MethodValue::Obj(fields) = data else {
        return false;
    };
    fields.iter().any(|(key, value)| {
        key == "mode" && matches!(value, MethodValue::Str(mode) if mode == SLIP_GOAL_MODE)
    })
}

/// The exact source `SLIP_GOAL` literal.
fn slip_goal() -> Goal {
    super::types::module_goal(
        SLIP_GOAL_MODULE,
        MethodValue::Obj(vec![(
            "mode".to_owned(),
            MethodValue::Str(SLIP_GOAL_MODE.to_owned()),
        )]),
    )
}

/// Complete source Wishes module: the shared per-cfg `WishState` map (the source module-level `WeakMap<object, WishState>`).
#[derive(Default)]
pub(crate) struct WishesModule {
    /// Insertion-order map from the declared cfg identity token to the source state entry. The source `WeakMap` is only
    /// ever read by key; insertion order is not observable, and a fresh module instance per replay case is the harness rule.
    states: Vec<(CfgToken, WishStateCore)>,
}
impl WishesModule {
    pub(crate) fn new() -> Self {
        Self::default()
    }
    /// Source `stateOf(ctx)`: the entry for exactly this declared cfg object identity, created with the source defaults.
    fn state(&mut self, token: CfgToken) -> &mut WishStateCore {
        if let Some(index) = self
            .states
            .iter()
            .position(|(candidate, _)| *candidate == token)
        {
            return &mut self.states[index].1;
        }
        self.states.push((token, WishStateCore::new()));
        &mut self.states.last_mut().expect("entry just pushed").1
    }

    /// Source `slipping(ctx, st)`: hidden short-circuits; otherwise the declared sent-cast clock / pending window decides and
    /// expiry retains `from`/`leg` exactly as the source does.
    fn slipping(&mut self, ctx: &ModuleContext<'_>) -> bool {
        let token = ctx.cfg.token;
        let bits = ctx.p.own_effects();
        let hidden = bits & EFFECT_HIDDEN != 0;
        let casting = bits & EFFECT_CASTING != 0;
        let now = ctx.p.now;
        let st = self.state(token);
        let sent = sent_cast_at(ctx, st.armed_at);
        st.slipping_source(now, hidden, casting, sent, &WISH_RULES)
    }

    /// Source `castIntent`: the gates, the tier filter, the declared def's finite-profile admission, the one shared policy,
    /// then the attempt mark and the source arming transition. A refusal is no decision and touches no state.
    fn cast_intent(&mut self, ctx: &ModuleContext<'_>, goal: &Goal) -> Option<Intent> {
        let view = ctx.p.wish.as_ref()?;
        let def = view.def_of()?;
        if !usable(ctx.p, view) || view.casting {
            return None;
        }
        let token = ctx.cfg.token;
        if !self.state(token).remembers() || !self.state(token).retry_ready(ctx.p.now, &WISH_RULES)
        {
            return None;
        }
        let easy = ctx.cfg.tier.id == TierId::Easy;
        let played = played_ai(def, easy);
        // Source `playedDef` returns null when Easy's filter leaves nothing: no decision is attempted at all.
        if easy && played.is_empty() {
            return None;
        }
        // Finite-profile admission: the five actual Wish definitions decide; an unsupported declared shape is refused before
        // any mutation (and produces no decision), never mapped onto a catalog row.
        let ranks = match read_declared_ranks(view) {
            Ok(Some(ranks)) => ranks,
            Ok(None) | Err(_) => return None,
        };
        let ring = blink::Ring::new(ctx.cfg.map);
        let situation = cast_situation(ctx, goal, &ring);
        let ability = SourceAbility {
            name: &def.name,
            ai: &played,
            blocked_by: &def.blocked_by,
            ranks: &ranks,
        };
        let choice = source_decide_cast(&ability, view.rank, &situation)?;
        let rank = source_rank_of(&ranks, view.rank)?;
        let now = ctx.p.now;
        let from = situation
            .threat
            .as_ref()
            .map(|threat| Vec2::new(threat.x, threat.y))
            .or_else(|| situation.foe.as_ref().map(|foe| Vec2::new(foe.x, foe.y)));
        let priority = if situation.me.hp_frac < ESCAPE_HP_HIT {
            PRIORITY_REFLEX
        } else {
            PRIORITY_COMBAT
        };
        let snap_radius = match rank.targeting {
            TargetRule::Unit { snap_radius, .. } => snap_radius,
            _ => TARGET_SNAP_RADIUS,
        };
        let hides = source_hides_caster(&ranks, view.rank);
        let why = source_cast_why(&ability);
        let timing = timing_of(ctx);
        self.state(token).note_try(now);
        if hides {
            // Source arm: retain `from` when there is no enemy, and there is no inferred sent clock in the source state.
            self.state(token).arm_source(now, rank.cast_ms, from);
        }
        let body = match choice.id {
            Some(target) => IntentBody::Cast {
                slot: "wish".into(),
                x: choice.x,
                y: choice.y,
                target: Some(target),
                at: Some(Vec2::new(choice.x, choice.y)),
                snap_radius: Some(snap_radius),
            },
            None => IntentBody::Cast {
                slot: "wish".into(),
                x: choice.x,
                y: choice.y,
                target: None,
                at: None,
                snap_radius: None,
            },
        };
        Some(Intent {
            body,
            priority,
            timing,
            why,
        })
    }

    /// Source `slipStep`: update `from` from the nearest enemy (or keep the retained origin), keep the current leg while it is
    /// young and not arrived, else re-choose a clear heading; the move intent carries the source priority/timing/why.
    fn slip_step(&mut self, ctx: &ModuleContext<'_>) -> Option<Intent> {
        let token = ctx.cfg.token;
        let now = ctx.p.now;
        let self_at = ctx.p.self_.pos();
        if let Some(from) = slip_from(ctx.p) {
            self.state(token).from = Some(from);
        }
        let paths: &dyn ModulePaths = ctx.paths;
        let mut clear = |a: Vec2, b: Vec2| paths.clear(a, b);
        let to =
            self.state(token)
                .slip_leg(now, self_at, &mut clear, &WISH_RULES, HypotMode::Js)?;
        Some(Intent {
            body: IntentBody::Move { to },
            priority: PRIORITY_REFLEX,
            timing: timing_of(ctx),
            why: SLIP_STEP_WHY.into(),
        })
    }
}

impl SourceModule for WishesModule {
    fn id(&self) -> &'static str {
        "wishes"
    }
    fn enabled(&self, features: &Features) -> bool {
        features.wishes
    }
    /// The actual module object's own function keys, in declaration order.
    fn hooks(&self) -> &'static [&'static str] {
        ModuleId::Wishes.hooks()
    }

    /// Source `observe`: the availability edge and the Easy remember draw (only a usable slot can raise the edge).
    fn observe(&mut self, ctx: &mut ModuleContext<'_>) {
        let usable = ctx.p.wish.as_ref().is_some_and(|view| usable(ctx.p, view));
        let easy = ctx.cfg.tier.id == TierId::Easy;
        let token = ctx.cfg.token;
        let decide = &mut ctx.rng.decide;
        self.state(token)
            .observe(usable, easy, &mut || decide.draw());
    }

    /// Source `goals`: the one module slip goal while defOf holds, the state is slipping, and there is somebody to slip from.
    fn goals(&mut self, ctx: &mut ModuleContext<'_>) -> Vec<GoalDecision> {
        if ctx.p.wish.as_ref().and_then(|view| view.def_of()).is_none() {
            return Vec::new();
        }
        if !self.slipping(ctx) {
            return Vec::new();
        }
        let has_enemy = nearest_enemy(ctx.p).is_some();
        let token = ctx.cfg.token;
        if !self.state(token).slip_goal_holds(has_enemy) {
            return Vec::new();
        }
        vec![GoalDecision {
            goal: slip_goal(),
            utility: SLIP_UTILITY,
            why: SLIP_GOAL_WHY.to_owned(),
            choice: None,
        }]
    }

    /// Source `intents`: the cast first (arming the slip inside the decision), then the slip step inside the same think.
    fn intents(&mut self, ctx: &mut ModuleContext<'_>, goal: &Goal) -> Vec<Intent> {
        if ctx.p.wish.as_ref().and_then(|view| view.def_of()).is_none() {
            return Vec::new();
        }
        let mut out = Vec::new();
        if let Some(cast) = self.cast_intent(ctx, goal) {
            out.push(cast);
        }
        if self.slipping(ctx) {
            if let Some(step) = self.slip_step(ctx) {
                out.push(step);
            }
        }
        out
    }

    /// Source `act`: the goal-mode guard, then `defOf`/`slipping`, the cast retry, the slip step, and the exact done/running
    /// reasons (nobody to slip from versus cornered) with the source intents order.
    fn act(&mut self, ctx: &mut ModuleContext<'_>, goal: &Goal) -> ModuleOutput {
        if !is_slip_goal(goal) {
            return ModuleOutput::new(Vec::new(), GoalStatus::failed(FAILED_UNKNOWN_GOAL), false);
        }
        if ctx.p.wish.as_ref().and_then(|view| view.def_of()).is_none() {
            return ModuleOutput::new(Vec::new(), GoalStatus::done(DONE_NOT_SLIPPING), false);
        }
        if !self.slipping(ctx) {
            return ModuleOutput::new(Vec::new(), GoalStatus::done(DONE_NOT_SLIPPING), false);
        }
        let mut intents = Vec::new();
        if let Some(cast) = self.cast_intent(ctx, goal) {
            intents.push(cast);
        }
        let step = self.slip_step(ctx);
        let token = ctx.cfg.token;
        let from_null = self.state(token).from.is_none();
        match step {
            Some(step) => {
                intents.push(step);
                ModuleOutput::new(intents, GoalStatus::running(RUNNING_SLIPPING), false)
            }
            None => ModuleOutput::new(
                intents,
                GoalStatus::done(if from_null {
                    DONE_NOBODY
                } else {
                    DONE_CORNERED
                }),
                false,
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    //! Focused witnesses for the complete source Wishes module over declared source facts only (no World/Observation): the
    //! unit/self/point cast intent fields, Easy's tag filter and single availability draw, real `Memory.lastCast`/
    //! `hitMeAt`/stimuli timing, the source partial-slip retention, the source done/running reasons, the cfg-token WeakMap
    //! isolation, the def guard, and the real collision-map/gate inputs. The frozen corpus replay lives in the separate
    //! replay harness; these witnesses pin the source literals it compares against.
    use super::*;
    use crate::bots::paths::WalkAnswer;
    use crate::bots::temporal_percept::memory::{
        CampMemory, ContainerMemory, FighterMemory, MemoryTimedCommand, MobMemory, SelfMemory,
        Whereabouts,
    };
    use crate::bots::temporal_percept::modules::types::MemoryApi;
    use crate::bots::temporal_percept::strategy::types::RngStream;
    use crate::bots::types::PERSONAS;
    use crate::bots::types::{Stimulus, TIERS};
    use crate::bots::view::Features;
    use crate::bots::wish::{wish_by_id, PolicyEffect};
    use rh_sim::map::{TILE_FLOOR, TILE_WALL};
    use rh_sim::{FactionId, TileMap, WeaponId};
    use std::cell::Cell;

    // ------------------------------------------------------------------------------------------------ declared fakes

    /// One addressable cfg identity (the source WeakMap key).
    const A: CfgToken = CfgToken(1);
    const B: CfgToken = CfgToken(2);

    fn tier_params(tier: TierId) -> &'static crate::bots::types::TierParams {
        match tier {
            TierId::Easy => &TIERS[0],
            TierId::Normal => &TIERS[1],
            TierId::Hard => &TIERS[2],
        }
    }

    struct CountingRng {
        values: Vec<f64>,
        draws: usize,
    }
    impl CountingRng {
        fn new(values: &[f64]) -> Self {
            Self {
                values: values.to_vec(),
                draws: 0,
            }
        }
    }
    impl RngStream for CountingRng {
        fn draw(&mut self) -> f64 {
            let value = self.values.get(self.draws).copied().unwrap_or(0.5);
            self.draws += 1;
            value
        }
    }
    struct ZeroRng;
    impl RngStream for ZeroRng {
        fn draw(&mut self) -> f64 {
            0.
        }
    }

    struct FakePaths {
        collision: TileMap,
        clear: bool,
        clears: Cell<usize>,
    }
    impl FakePaths {
        fn new() -> Self {
            Self {
                collision: open_map(),
                clear: true,
                clears: Cell::new(0),
            }
        }
    }
    impl ModulePaths for FakePaths {
        fn walk(&mut self, _from: Vec2, _to: Vec2) -> Option<WalkAnswer> {
            None
        }
        fn path(&mut self, _from: Vec2, _to: Vec2) -> Option<Vec<Vec2>> {
            None
        }
        fn los(&self, _a: Vec2, _b: Vec2) -> bool {
            true
        }
        fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
            self.clears.set(self.clears.get() + 1);
            self.clear
        }
        fn collision_map(&self) -> &TileMap {
            &self.collision
        }
    }

    struct FakeMem {
        fighters: Vec<(String, FighterMemory)>,
        mobs: Vec<(String, MobMemory)>,
        camps: Vec<(String, CampMemory)>,
        containers: Vec<(String, ContainerMemory)>,
        self_memory: SelfMemory,
        stimuli: Vec<Stimulus>,
        bounties: Vec<(String, f64)>,
        choices: Vec<String>,
    }
    impl FakeMem {
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
        fn set_last_cast(&mut self, at: f64) {
            self.self_memory.last_cast = Some(MemoryTimedCommand {
                at,
                cmd: MemoryCommand::Cast,
                raw: MethodValue::Obj(Vec::new()),
            });
        }
        fn set_hit(&mut self, by: &str, at: f64) {
            self.self_memory.last_hit_at = Some(at);
            self.fighters
                .push((by.to_owned(), fighter_memory(by, Some(at))));
        }
    }
    impl MemoryApi for FakeMem {
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

    fn fighter_memory(id: &str, hit_me_at: Option<f64>) -> FighterMemory {
        FighterMemory {
            id: id.to_owned(),
            name: id.to_owned(),
            bot: false,
            faction: Some(FactionId::Frost),
            weapons_seen: Vec::new(),
            in_hand: None,
            other_slot: None,
            seen_at: 0.,
            pos: Vec2::new(0., 0.),
            vel: Vec2::new(0., 0.),
            hp_frac: 1.,
            bounty: 0.,
            alive: true,
            died_at: None,
            hit_me_at,
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

    fn open_map() -> TileMap {
        let (w, h) = (64u32, 48u32);
        let mut tiles = vec![TILE_WALL; (w * h) as usize];
        for y in 1..h - 1 {
            for x in 1..w - 1 {
                tiles[(y * w + x) as usize] = TILE_FLOOR;
            }
        }
        TileMap::new(w, h, tiles).expect("a hand-built open map")
    }

    fn self_(hp: f64) -> super::super::types::ModuleSelf {
        super::super::types::ModuleSelf {
            id: "me".to_owned(),
            name: "Me".to_owned(),
            x: 1008.,
            y: 1008.,
            facing: 0.,
            status: "alive".to_owned(),
            hp,
            max_hp: 100.,
            barrier: 0.,
            faction_text: "fire".to_owned(),
            faction: Some(FactionId::Fire),
            weapons: [Some(WeaponId::Sword), None],
            slot: 0,
            attack_target: None,
            build: None,
            record: MethodValue::Obj(Vec::new()),
        }
    }

    fn fighter(id: &str, x: f64, y: f64, dist: f64) -> ModuleFighter {
        ModuleFighter {
            id: id.to_owned(),
            x,
            y,
            status: "alive".to_owned(),
            dist,
            los: true,
            targetable: true,
            vx: 0.,
            vy: 0.,
            faction: Some(FactionId::Frost),
        }
    }

    fn percept(
        now: f64,
        self_: super::super::types::ModuleSelf,
        fighters: Vec<ModuleFighter>,
        effects: u32,
        wish: Option<WishView>,
        gates_locked: bool,
    ) -> ModulePercept {
        ModulePercept {
            now,
            view_t: now - 30.,
            self_,
            hud: super::super::types::ModuleHud {
                phase: "active".to_owned(),
                in_coliseum: false,
                gates_locked,
                patience_ends_at: now + 100_000.,
            },
            fighters,
            mobs: Vec::new(),
            chests: None,
            wish,
            effects: vec![("me".to_owned(), f64::from(effects))],
            events: Vec::new(),
            features: Features {
                wishes: true,
                ..Default::default()
            },
        }
    }

    fn declared_wish(row_name: &str, rank: f64, ready_at: f64, casting: bool) -> WishView {
        use crate::bots::wish::TargetRule;
        let row = wish_by_id(match row_name {
            "Freeze" => rh_sim::status_runtime::AbilityId::Freeze,
            "Swarm" => rh_sim::status_runtime::AbilityId::Swarm,
            "Trial" => rh_sim::status_runtime::AbilityId::Trial,
            "Blaze Step" => rh_sim::status_runtime::AbilityId::Blaze,
            "Last Stand" => rh_sim::status_runtime::AbilityId::LastStand,
            other => panic!("unknown row {other}"),
        })
        .expect("admitted row");
        let targeting = match row.rank.targeting {
            TargetRule::Self_ => WishTargeting::Self_,
            TargetRule::Unit {
                range,
                los,
                snap_radius,
            } => WishTargeting::Unit {
                range,
                los,
                snap_radius,
            },
            TargetRule::Point { range, min_range } => WishTargeting::Point { range, min_range },
        };
        let hides_caster = row
            .rank
            .effects
            .iter()
            .any(|effect| matches!(effect, PolicyEffect::HidesCaster));
        let blink = row.rank.effects.iter().find_map(|effect| match effect {
            PolicyEffect::Blink { max_dist, min_dist } => Some((*max_dist, *min_dist)),
            PolicyEffect::HidesCaster | PolicyEffect::Wall { .. } => None,
        });
        WishView {
            ability: row.name.to_owned(),
            def: Some(AbilityDef {
                name: row.name.to_owned(),
                ai: row.ai.to_vec(),
                blocked_by: row.blocked_by.to_vec(),
                ranks: vec![AbilityRank {
                    cast_ms: Some(row.rank.cast_ms),
                    targeting: Some(targeting),
                    hides_caster,
                    blink,
                    wall: false,
                    raw: MethodValue::Obj(Vec::new()),
                }],
                raw: MethodValue::Obj(Vec::new()),
            }),
            rank,
            ready_at,
            casting,
        }
    }

    struct Harness {
        module: WishesModule,
        tier: TierId,
        map: TileMap,
        collision: TileMap,
        plan_map: crate::bots::planning::PlanMap,
        features: Features,
        percept: ModulePercept,
        mem: FakeMem,
        paths: FakePaths,
        decide: CountingRng,
        motor: ZeroRng,
        lapse: ZeroRng,
    }
    impl Harness {
        fn new(tier: TierId) -> Self {
            let map = open_map();
            let collision = open_map();
            let features = Features {
                wishes: true,
                ..Default::default()
            };
            Self {
                module: WishesModule::new(),
                tier,
                map: map.clone(),
                collision,
                plan_map: crate::bots::planning::PlanMap::default(),
                features,
                percept: percept(100_000., self_(100.), Vec::new(), 0, None, false),
                mem: FakeMem::new(),
                paths: FakePaths::new(),
                decide: CountingRng::new(&[0.1, 0.9]),
                motor: ZeroRng,
                lapse: ZeroRng,
            }
        }
        fn run<R>(
            &mut self,
            token: CfgToken,
            f: impl FnOnce(&mut WishesModule, &mut ModuleContext<'_>) -> R,
        ) -> R {
            use super::super::types::{ModuleConfig, RngLanes};
            let cfg = ModuleConfig {
                token,
                id: "me".to_owned(),
                tier: tier_params(self.tier),
                persona: &PERSONAS[0],
                map: &self.map,
                terrain: &[],
                plan_map: &self.plan_map,
                features: &self.features,
                learned: &(),
            };
            let log = |_: &str| {};
            let rng = RngLanes {
                decide: &mut self.decide,
                motor: &mut self.motor,
                lapse: &mut self.lapse,
            };
            let mut ctx = ModuleContext {
                cfg: &cfg,
                p: &self.percept,
                mem: &self.mem,
                paths: &mut self.paths,
                collision: &self.collision,
                log: &log,
                rng,
                engaged: false,
            };
            f(&mut self.module, &mut ctx)
        }
        fn observe(&mut self, token: CfgToken) {
            self.run(token, |module, ctx| module.observe(ctx));
        }
        fn goals(&mut self, token: CfgToken) -> Vec<GoalDecision> {
            self.run(token, |module, ctx| module.goals(ctx))
        }
        fn intents(&mut self, token: CfgToken, goal: &Goal) -> Vec<Intent> {
            self.run(token, |module, ctx| module.intents(ctx, goal))
        }
        fn act(&mut self, token: CfgToken, goal: &Goal) -> ModuleOutput {
            self.run(token, |module, ctx| module.act(ctx, goal))
        }
        fn scene(
            &mut self,
            now: f64,
            hp: f64,
            fighters: Vec<ModuleFighter>,
            effects: u32,
            wish: Option<WishView>,
        ) {
            self.percept = percept(now, self_(hp), fighters, effects, wish, false);
        }
    }

    fn fight_goal() -> Goal {
        Goal::Fight {
            target: "foe".to_owned(),
        }
    }
    fn slip_goal() -> Goal {
        Goal::Module {
            module: "wishes".to_owned(),
            data: MethodValue::Obj(vec![(
                "mode".to_owned(),
                MethodValue::Str("slip".to_owned()),
            )]),
        }
    }
    fn cast_of(intents: &[Intent]) -> Option<&IntentBody> {
        intents
            .iter()
            .find(|intent| matches!(intent.body, IntentBody::Cast { .. }))
            .map(|intent| &intent.body)
    }
    fn move_of(intents: &[Intent]) -> Option<Vec2> {
        intents.iter().find_map(|intent| match &intent.body {
            IntentBody::Move { to } => Some(*to),
            _ => None,
        })
    }

    use super::super::types::GoalState;

    #[test]
    fn hooks_inventory_and_enabled_gate_are_the_actual_source_object() {
        let module = WishesModule::new();
        assert_eq!(module.id(), "wishes");
        assert_eq!(
            module.hooks(),
            ["enabled", "observe", "goals", "intents", "act"]
        );
        let features = Features {
            wishes: true,
            ..Default::default()
        };
        assert!(module.enabled(&features));
        let features = Features::default();
        assert!(!module.enabled(&features));
    }

    #[test]
    fn unit_cast_intent_is_exactly_the_source_literal() {
        let mut h = Harness::new(TierId::Hard);
        h.mem.stimuli = vec![Stimulus {
            kind: crate::bots::types::StimulusKind::NewThreat,
            at: 100_000.,
            subject: Some("foe".to_owned()),
            central: true,
            value: Some(100.),
        }];
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        assert_eq!(intents.len(), 1, "{intents:?}");
        let intent = &intents[0];
        assert_eq!(
            intent.body,
            IntentBody::Cast {
                slot: "wish".to_owned(),
                x: 1108.,
                y: 1008.,
                target: Some("foe".to_owned()),
                at: Some(Vec2::new(1108., 1008.)),
                snap_radius: Some(TARGET_SNAP_RADIUS),
            }
        );
        assert_eq!(intent.why, "cast Freeze");
        assert_eq!(intent.priority, PRIORITY_COMBAT);
        assert_eq!(
            intent.timing,
            IntentTiming::React {
                stimulus: h.mem.stimuli[0].clone()
            }
        );
        // No slip state is armed by a Wish that does not hide its caster.
        assert_eq!(h.goals(A), Vec::new());
        // The source's goal-mode guard and done reason.
        assert_eq!(
            h.act(A, &slip_goal()).status.state,
            GoalState::Done,
            "not slipping"
        );
        assert_eq!(h.act(A, &slip_goal()).status.why, DONE_NOT_SLIPPING);
        assert_eq!(
            h.act(
                A,
                &Goal::Module {
                    module: "wishes".to_owned(),
                    data: MethodValue::Obj(vec![(
                        "mode".to_owned(),
                        MethodValue::Str("bad".to_owned())
                    )])
                }
            )
            .status,
            GoalStatus::failed(FAILED_UNKNOWN_GOAL)
        );
    }

    #[test]
    fn unit_cast_los_targetability_and_mob_rules_are_source_exact() {
        // A targetable player in sight casts; out of sight, untargetable, or a farm mob does not (engage/control never
        // spends the Wish on a mob; a unit cast requires the foe's own los).
        for (los, targetable, mob, cast) in [
            (true, true, false, true),
            (false, true, false, false),
            (true, false, false, false),
            (true, true, true, false),
        ] {
            let mut h = Harness::new(TierId::Hard);
            let mut foe = fighter("foe", 1108., 1008., 100.);
            foe.los = los;
            foe.targetable = targetable;
            let goal = if mob {
                Goal::Farm {
                    mob: "mob1".to_owned(),
                    camp: None,
                }
            } else {
                fight_goal()
            };
            let mut percept_fighters = Vec::new();
            let mut percept_mobs = Vec::new();
            if mob {
                percept_mobs.push(super::super::types::ModuleMob {
                    id: "mob1".to_owned(),
                    kind: "mob".to_owned(),
                    x: 1108.,
                    y: 1008.,
                    status: "alive".to_owned(),
                    dist: 100.,
                    los: true,
                });
            } else {
                percept_fighters.push(foe);
            }
            h.percept = ModulePercept {
                mobs: percept_mobs,
                ..percept(
                    100_000.,
                    self_(100.),
                    percept_fighters,
                    0,
                    Some(declared_wish("Freeze", 1., 0., false)),
                    false,
                )
            };
            h.observe(A);
            let intents = h.intents(A, &goal);
            assert_eq!(
                cast_of(&intents).is_some(),
                cast,
                "los={los} targetable={targetable} mob={mob}: {intents:?}"
            );
        }
    }

    #[test]
    fn peel_uses_the_real_velocity_or_memory_hit_chase_fact() {
        // Freeze's control→engage finds no goal foe, so peel is reached; it needs a chasing targetable threat.
        let mut h = Harness::new(TierId::Hard);
        let mut threat = fighter("foe", 1108., 1008., 100.);
        threat.vx = -40.;
        h.scene(
            100_000.,
            100.,
            vec![threat],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &Goal::Idle);
        assert_eq!(
            cast_of(&intents),
            Some(&IntentBody::Cast {
                slot: "wish".to_owned(),
                x: 1108.,
                y: 1008.,
                target: Some("foe".to_owned()),
                at: Some(Vec2::new(1108., 1008.)),
                snap_radius: Some(TARGET_SNAP_RADIUS),
            }),
            "walking at the bot is chasing"
        );

        // Still and no remembered hit: not chasing, no peel.
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.observe(A);
        assert!(cast_of(&h.intents(A, &Goal::Idle)).is_none());

        // Still, but `mem.fighters[id].hitMeAt` recent and within PEEL_DISTANCE: chasing (source's second predicate).
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.mem
            .fighters
            .push(("foe".to_owned(), fighter_memory("foe", Some(99_000.))));
        h.observe(A);
        let intents = h.intents(A, &Goal::Idle);
        assert!(cast_of(&intents).is_some(), "the remembered hit is on it");
        // A hit older than recentHitMs is not "on it" any more.
        h.mem.fighters[0].1.hit_me_at = Some(95_000.);
        assert!(cast_of(&h.intents(A, &Goal::Idle)).is_none());
    }

    #[test]
    fn stimulus_priority_is_the_cast_stimuli_order() {
        let mut h = Harness::new(TierId::Hard);
        let kinds = [
            crate::bots::types::StimulusKind::DrawAtMe,
            crate::bots::types::StimulusKind::WindupAtMe,
            crate::bots::types::StimulusKind::HpLoss,
            crate::bots::types::StimulusKind::LowHp,
        ];
        h.mem.stimuli = kinds
            .iter()
            .map(|kind| Stimulus {
                kind: *kind,
                at: 100_000.,
                subject: None,
                central: true,
                value: None,
            })
            .collect();
        h.scene(
            100_000.,
            20.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        let cast = intents
            .iter()
            .find(|intent| matches!(intent.body, IntentBody::Cast { .. }))
            .expect("a cast");
        assert_eq!(
            cast.timing,
            IntentTiming::React {
                stimulus: h.mem.stimuli[3].clone()
            },
            "lowHp is the most telling CAST_STIMULI"
        );
        assert_eq!(cast.priority, PRIORITY_REFLEX, "hpFrac below escapeHpHit");
    }

    #[test]
    fn nearest_enemy_ties_keep_the_first_source_row() {
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            25.,
            vec![
                fighter("foe", 1308., 1008., 300.),
                fighter("near", 908., 1008., 50.),
                fighter("tie", 1108., 1008., 50.),
            ],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        assert!(cast_of(&intents).is_some(), "{intents:?}");
        assert_eq!(
            move_of(&intents),
            Some(Vec2::new(1308., 1008.)),
            "away from the first of the equal-distance rows (near at 908)"
        );
    }

    #[test]
    fn self_cast_arms_the_slip_step_first_then_the_walk() {
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        assert_eq!(intents.len(), 2, "cast then slip step: {intents:?}");
        assert_eq!(
            intents[0].body,
            IntentBody::Cast {
                slot: "wish".to_owned(),
                x: 1008.,
                y: 1008.,
                target: None,
                at: None,
                snap_radius: None,
            },
            "a self cast omits target/at/snapRadius"
        );
        assert_eq!(intents[0].why, "cast Swarm");
        assert_eq!(intents[0].priority, PRIORITY_REFLEX);
        assert_eq!(intents[1].why, SLIP_STEP_WHY);
        assert_eq!(intents[1].priority, PRIORITY_REFLEX);
        assert_eq!(move_of(&intents), Some(Vec2::new(708., 1008.)));
        assert_eq!(
            h.paths.clears.get(),
            1,
            "the away heading is a real clear call"
        );
        // The pending slip keeps the module goal up.
        let goals = h.goals(A);
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].utility, 1.4);
        assert_eq!(goals[0].why, SLIP_GOAL_WHY);
        assert_eq!(
            goals[0].goal,
            Goal::Module {
                module: "wishes".to_owned(),
                data: MethodValue::Obj(vec![(
                    "mode".to_owned(),
                    MethodValue::Str("slip".to_owned())
                )])
            }
        );
        assert_eq!(goals[0].choice, None);
        // act: the retry gap holds at the same instant, and the kept leg is offered again.
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(act.status.why, RUNNING_SLIPPING);
        assert_eq!(move_of(&act.intents), Some(Vec2::new(708., 1008.)));
        assert_eq!(h.paths.clears.get(), 1, "the young leg is kept");

        // Exactly retryMs later the Wish is asked again (source retry boundary).
        h.scene(
            101_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        assert!(cast_of(&intents).is_some(), "retry at exactly 1000ms");
        assert_eq!(intents.len(), 2);
    }

    #[test]
    fn real_lastcast_grace_pending_hidden_and_partial_retention() {
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.intents(A, &fight_goal()).len(), 2);
        assert_eq!(h.paths.clears.get(), 1, "initial slip leg to 708");
        // The declared memory record of the sent cast (never an inferred observed casting bit).
        h.mem.set_last_cast(100_100.);

        // 100699 < sent + castMs(250) + grace(700) = 101050: still slipping; the leg is young and kept.
        h.scene(
            100_699.,
            100.,
            vec![fighter("foe", 908., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1, "grace keeps the module goal");
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(move_of(&act.intents), Some(Vec2::new(708., 1008.)));
        assert_eq!(h.paths.clears.get(), 1, "the 699ms leg is kept");

        // A young leg still kept at 101000 (age 1000 < 1200, sent grace still open at 101000 < 101050).
        h.scene(
            101_000.,
            100.,
            vec![fighter("foe", 908., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1);
        assert_eq!(
            move_of(&h.act(A, &slip_goal()).intents),
            Some(Vec2::new(708., 1008.))
        );

        // Past the grace the source clears only armedAt: the retained from/leg make a later hidden frame reuse the
        // retained slip origin and re-choose the heading from it.
        h.scene(
            101_200.,
            100.,
            vec![fighter("foe", 908., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A), Vec::new());
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Done);
        assert_eq!(act.status.why, DONE_NOT_SLIPPING);

        h.scene(
            102_501.,
            100.,
            Vec::new(),
            256,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1, "the hidden bit slips again");
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(
            move_of(&act.intents),
            Some(Vec2::new(1308., 1008.)),
            "away from the retained origin at 908"
        );
        assert_eq!(h.paths.clears.get(), 2, "the expired leg is re-chosen");
    }

    #[test]
    fn armed_at_expiry_retains_the_origin_and_leg() {
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.intents(A, &fight_goal()).len(), 2);
        // Pending window: armedAt + slipPendingMs (no sent cast, no casting bit).
        h.scene(
            102_499.,
            100.,
            Vec::new(),
            0,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1, "armedAt + 2500 pending");
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(move_of(&act.intents), Some(Vec2::new(708., 1008.)));
        assert_eq!(h.paths.clears.get(), 2, "the 2499ms leg is re-chosen");

        h.scene(
            102_500.,
            100.,
            Vec::new(),
            0,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(
            h.goals(A),
            Vec::new(),
            "exactly pendingMs later is no longer slipping"
        );
        assert_eq!(h.act(A, &slip_goal()).status.why, DONE_NOT_SLIPPING);

        // Hidden at 102600: source retained from/leg; the leg from 102499 is young and still 300u away -> kept.
        h.scene(
            102_600.,
            100.,
            Vec::new(),
            256,
            Some(declared_wish("Swarm", 1., 0., true)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1);
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(move_of(&act.intents), Some(Vec2::new(708., 1008.)));
        assert_eq!(h.paths.clears.get(), 2, "the retained young leg is kept");
    }

    #[test]
    fn done_reasons_are_nobody_cornered_and_running() {
        // Hidden with nobody to slip from (no retained origin and no enemy).
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            100.,
            Vec::new(),
            256,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.goals(A), Vec::new(), "no origin and no enemy");
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Done);
        assert_eq!(act.status.why, DONE_NOBODY);
        assert_eq!(h.paths.clears.get(), 0);

        // Hidden with an enemy but every heading denied: cornered (the source sets from before the search fails).
        let mut h = Harness::new(TierId::Hard);
        h.paths.clear = false;
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            256,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.goals(A).len(), 1);
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Done);
        assert_eq!(act.status.why, DONE_CORNERED);
        assert_eq!(h.paths.clears.get(), 10, "TURNS x LENGTHS");
        assert!(act.intents.is_empty());

        // Hidden with a clear heading: running with the step.
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            256,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        let act = h.act(A, &slip_goal());
        assert_eq!(act.status.state, GoalState::Running);
        assert_eq!(act.status.why, RUNNING_SLIPPING);
        assert_eq!(move_of(&act.intents), Some(Vec2::new(708., 1008.)));
    }

    #[test]
    fn easy_filter_and_the_single_availability_draw() {
        // Easy never spends an offensive-only Wish (Freeze's control/peel/engage filter to no tags).
        let mut h = Harness::new(TierId::Easy);
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Freeze", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(
            h.decide.draws, 1,
            "one Easy remember draw on the rising edge"
        );
        assert!(h.intents(A, &fight_goal()).is_empty());
        h.observe(A);
        assert_eq!(h.decide.draws, 1, "no draw while the slot stays usable");

        // Easy remembers with a draw below easyRemembers: the defensive Swarm is played.
        let mut h = Harness::new(TierId::Easy);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.decide.draws, 1);
        assert_eq!(h.intents(A, &fight_goal()).len(), 2);

        // Easy forgets with a draw at/above easyRemembers.
        let mut h = Harness::new(TierId::Easy);
        h.decide = CountingRng::new(&[0.6]);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.decide.draws, 1);
        assert!(
            h.intents(A, &fight_goal()).is_empty(),
            "forgotten this availability"
        );
        // The next availability edge draws again (unusable -> usable).
        h.scene(
            101_100.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 102_000., false)),
        );
        h.observe(A);
        assert_eq!(h.decide.draws, 1, "no draw on the falling edge");
        h.scene(
            102_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert_eq!(h.decide.draws, 2, "a new usable edge draws again");
        assert_eq!(h.intents(A, &fight_goal()).len(), 2);
    }

    #[test]
    fn two_cfg_tokens_isolate_state_and_the_same_token_continues() {
        let mut h = Harness::new(TierId::Easy);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A); // draw 0.1 -> remembers
        h.observe(B); // draw 0.9 -> forgets
        assert_eq!(
            h.decide.draws, 2,
            "each cfg identity has its own availability edge"
        );
        h.scene(
            100_001.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        h.observe(B);
        assert_eq!(
            h.intents(A, &fight_goal()).len(),
            2,
            "a remembers and casts"
        );
        assert!(h.intents(B, &fight_goal()).is_empty(), "b forgot its Wish");
        assert_eq!(h.goals(A).len(), 1, "a armed the slip");
        assert_eq!(h.goals(B), Vec::new(), "b has no armed slip state");
        // The same token continues: the retry/armed state was not reset by the interleaved cfg.
        h.scene(
            101_001.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        assert!(
            cast_of(&h.intents(A, &fight_goal())).is_some(),
            "a retry at 1000ms"
        );
        assert_eq!(h.goals(A).len(), 1);
    }

    #[test]
    fn def_guard_cases_observe_but_never_decide() {
        // Absent/opaque-invalid def: defOf null. `observe` still runs (the Easy edge draws); goals/intents are empty and act
        // reports the source reasons.
        let mut h = Harness::new(TierId::Easy);
        let mut view = declared_wish("Swarm", 1., 0., false);
        view.def = None;
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(view),
        );
        h.observe(A);
        assert_eq!(h.decide.draws, 1, "observe still runs with no def");
        assert_eq!(h.goals(A), Vec::new());
        assert!(h.intents(A, &fight_goal()).is_empty());
        assert_eq!(h.act(A, &slip_goal()).status.why, DONE_NOT_SLIPPING);
        assert_eq!(
            h.act(
                A,
                &Goal::Module {
                    module: "wishes".to_owned(),
                    data: MethodValue::Obj(Vec::new())
                }
            )
            .status,
            GoalStatus::failed(FAILED_UNKNOWN_GOAL)
        );

        // Guard-passing but structurally empty rank (`ranks: [{}]`, `ai: []`): source defOf is true, no decision consumes
        // the missing members, and the finite-profile admission refuses them before any state mutation.
        let mut h = Harness::new(TierId::Hard);
        let mut view = declared_wish("Swarm", 1., 0., false);
        if let Some(def) = view.def.as_mut() {
            def.ai.clear();
            def.blocked_by.clear();
            def.ranks = vec![AbilityRank {
                cast_ms: None,
                targeting: None,
                hides_caster: false,
                blink: None,
                wall: false,
                raw: MethodValue::Obj(Vec::new()),
            }];
        }
        h.scene(100_000., 100., Vec::new(), 0, Some(view.clone()));
        assert!(
            view.def_of().is_some(),
            "source defOf is true for a structurally empty rank"
        );
        let refused = read_declared_ranks(&view).expect_err("empty rank members refused");
        assert_eq!(refused.path, "ranks[0].castMs");
        h.observe(A);
        assert_eq!(h.goals(A), Vec::new());
        assert!(h.intents(A, &fight_goal()).is_empty());
        assert_eq!(
            h.act(
                A,
                &Goal::Module {
                    module: "wishes".to_owned(),
                    data: MethodValue::Obj(vec![(
                        "mode".to_owned(),
                        MethodValue::Str("bad".to_owned())
                    )])
                }
            )
            .status,
            GoalStatus::failed(FAILED_UNKNOWN_GOAL)
        );

        // A declared dir targeting or non-profile blink distances is refused by the same entry before any decision.
        let mut view = declared_wish("Blaze Step", 1., 0., false);
        if let Some(def) = view.def.as_mut() {
            if let Some(rank) = def.ranks.first_mut() {
                rank.targeting = Some(WishTargeting::Dir);
            }
        }
        assert_eq!(
            read_declared_ranks(&view).expect_err("dir refused").path,
            "ranks[0].targeting.kind"
        );
        let mut view = declared_wish("Blaze Step", 1., 0., false);
        if let Some(def) = view.def.as_mut() {
            if let Some(rank) = def.ranks.first_mut() {
                rank.blink = Some((400., 64.));
            }
        }
        assert_eq!(
            read_declared_ranks(&view).expect_err("blink refused").path,
            "ranks[0].effects.blink"
        );
        // And the captured five actual definitions are admitted.
        for name in ["Freeze", "Swarm", "Trial", "Blaze Step", "Last Stand"] {
            let view = declared_wish(name, 1., 0., false);
            assert_eq!(
                read_declared_ranks(&view)
                    .expect("actual def admitted")
                    .map(|r| r.len()),
                Some(1),
                "{name}"
            );
        }
    }

    #[test]
    fn absent_wish_slot_never_decides_and_keeps_the_source_reasons() {
        // `extras.wish` absent: defOf is null everywhere; observe still runs (no usable edge), and every hook is inert with
        // the source done reason.
        let mut h = Harness::new(TierId::Easy);
        h.scene(100_000., 100., Vec::new(), 256, None);
        h.observe(A);
        assert_eq!(
            h.decide.draws, 0,
            "no usable slot, so no Easy availability edge"
        );
        assert_eq!(h.goals(A), Vec::new());
        assert!(h.intents(A, &fight_goal()).is_empty());
        assert_eq!(h.act(A, &slip_goal()).status.why, DONE_NOT_SLIPPING);
    }

    #[test]
    fn two_hard_cfg_tokens_isolate_the_armed_state_like_the_source_weakmap() {
        // The corpus `wish-two-configs` shape: cfg a casts and arms; cfg b (equal values, distinct identity) has no armed
        // slip; the interleaved b hooks do not disturb a.
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            25.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(A);
        h.observe(B);
        assert_eq!(h.intents(A, &fight_goal()).len(), 2);
        h.scene(
            100_010.,
            100.,
            vec![fighter("foe", 1108., 1008., 100.)],
            0,
            Some(declared_wish("Swarm", 1., 0., false)),
        );
        h.observe(B);
        assert_eq!(h.goals(B), Vec::new(), "b has no armed slip");
        assert_eq!(h.act(B, &slip_goal()).status.why, DONE_NOT_SLIPPING);
        assert_eq!(h.goals(A).len(), 1, "a still holds its pending slip");
        assert_eq!(
            move_of(&h.act(A, &slip_goal()).intents),
            Some(Vec2::new(708., 1008.))
        );
    }

    #[test]
    fn the_collision_map_is_the_real_path_service_view() {
        // Blaze's point engage: targetable player 200u away, and we consult the REAL collision map for the landing. With an
        // open collision view the blink lands; with an all-wall collision view (the path service's current map) the landing
        // is refused, so no cast is emitted. The old public adapter instead always passes its static open map (documented).
        let mut h = Harness::new(TierId::Hard);
        h.scene(
            100_000.,
            100.,
            vec![fighter("foe", 1008., 808., 200.)],
            0,
            Some(declared_wish("Blaze Step", 1., 0., false)),
        );
        h.observe(A);
        let intents = h.intents(A, &fight_goal());
        let cast = cast_of(&intents).expect("open collision map: the blink closes the gap");
        match cast {
            IntentBody::Cast {
                x, y, snap_radius, ..
            } => {
                assert_eq!((*x, *y), (1008., 848.), "stop short of the foe");
                assert_eq!(*snap_radius, None, "a point cast omits snapRadius");
            }
            other => panic!("unexpected {other:?}"),
        }

        let mut h = Harness::new(TierId::Hard);
        let wall = TileMap::new(64, 48, vec![TILE_WALL; 64 * 48]).expect("wall map");
        h.collision = wall;
        h.percept = percept(
            100_000.,
            self_(100.),
            vec![fighter("foe", 1008., 808., 200.)],
            0,
            Some(declared_wish("Blaze Step", 1., 0., false)),
            true,
        );
        h.observe(A);
        assert!(
            cast_of(&h.intents(A, &fight_goal())).is_none(),
            "the real collision map refuses the landing"
        );
    }
}
