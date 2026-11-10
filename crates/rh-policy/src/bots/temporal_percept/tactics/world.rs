//! Private source World tactics (packages/server/src/bots/brain/tactics/world.ts): the goals with no fight in them.
//!
//! LOOT walks to a container, holds still and presses F; ROAM walks to a point; HOLD stands at the coliseum (or an
//! ambush spot); IDLE stands. It only ever emits move, stop and pickup, and it re-emits the move every think so a walk
//! that the humanizer turns into edge or minimap clicks keeps going. The one shared state is the source per-goal slot
//! table, stale-pruned after [`STALE_MS`] of no use; ROAM owns no slot.

use rh_sim::constants::{INTERACT_RANGE, PLAYER_RADIUS, TILE};
use rh_sim::map::MASK_MOVE;
use rh_sim::mapgen::certify::source_hypot;
use rh_sim::math::{cos, js_round, sin, PI};
use rh_sim::Vec2;

use super::types::{
    carried, dist, priority, ContainerMemory, ContainersWeapon, GoalStatus, HoldWhy, Intent,
    IntentBody, IntentTiming, PathArg, RouteElement, TacticContainer, TacticEventKind, TacticMob,
    TacticsContext, TacticsError, TacticsOutput, WorldGoal,
};

/// Inside this distance of a container we start taking; a margin under INTERACT_RANGE for stale positions.
const PICKUP_DISTANCE: f64 = INTERACT_RANGE - 12.;
/// Standing this long (ms) before F: the server position has settled, a pickup from a stale one is refused as too far.
const STILL_BEFORE_PICKUP_MS: f64 = 150.;
const PICKUP_RETRY_MS: f64 = 400.;
/// A detour that takes longer than this is dropped for good, so it can never stall the hunt.
const LOOT_BUDGET_MS: f64 = 6_000.;
const LOOT_ENEMY_DISTANCE: f64 = 240.;
const LOOT_MOB_DISTANCE: f64 = 220.;
const LOOT_MAX_FAILS: u64 = 2;
/// Behind a wall and farther than this, the walk is sent waypoint by waypoint.
const WAYPOINT_FROM: f64 = 150.;
/// Within this (u) of its destination a roam is over.
const ARRIVE_DISTANCE: f64 = 48.;
/// A hold has arrived this close: the click scatter is under it for most clicks, and `SETTLED_*` catches the rest.
const HOLD_ARRIVE_DISTANCE: f64 = 24.;
/// The hand can land short of a point (click scatter): a bot that has stood still this long this close is as near as it
/// will get.
const SETTLED_MS: f64 = 800.;
const SETTLED_DISTANCE: f64 = 120.;
const ROAM_SETTLED_MS: f64 = 1_200.;
const ROAM_SETTLED_DISTANCE: f64 = 150.;
/// A stop that did not take (the bot still moves) is sent again after this long.
const STOP_RESEND_MS: f64 = 800.;
/// The coliseum point is crowded when another fighter stands this close to it.
const CROWDED_DISTANCE: f64 = 160.;
/// A goal not run for this long starts afresh when it comes back.
const STALE_MS: f64 = 3_000.;
const HOLD_SPOT_STEPS: usize = 24;
const HOLD_SPOT_JITTER: f64 = 48.;
/// Source shared COLISEUM_RING_RADIUS: rh-sim keeps its systems' ring radius private and this is the same 5 * TILE.
const COLISEUM_RING_RADIUS: f64 = 5. * TILE;

// ------------------------------------------------------------------------------------------------------------------ state

/// Source `LootState`: the detour's own bookkeeping (the carried count is compared with the count carried now).
#[derive(Clone, Debug)]
pub(crate) struct LootState {
    pub last_act_at: f64,
    pub started_at: f64,
    /// The last percept whose events were counted (act can run twice on one percept).
    pub last_now: f64,
    pub carried_at_start: u64,
    pub stop_at: Option<f64>,
    pub pickup_at: Option<f64>,
    pub fails: u64,
    pub final_status: Option<GoalStatus>,
}

/// Source `HoldState`: the one sent halt and, when the crowd made the bot pick, its spot on the ring.
#[derive(Clone, Debug)]
pub(crate) struct HoldState {
    pub last_act_at: f64,
    pub stop_at: Option<f64>,
    pub spot: Option<Vec2>,
}

/// Source `IdleState`: the one sent halt.
#[derive(Clone, Debug)]
pub(crate) struct IdleState {
    pub last_act_at: f64,
    pub stop_at: Option<f64>,
}

/// Source `State`: the variant a slot's key namespaces (goal kind and identity), never widened in place.
#[derive(Clone, Debug)]
pub(crate) enum WorldState {
    Loot(LootState),
    Hold(HoldState),
    Idle(IdleState),
}

impl WorldState {
    fn last_act_at(&self) -> f64 {
        match self {
            Self::Loot(state) => state.last_act_at,
            Self::Hold(state) => state.last_act_at,
            Self::Idle(state) => state.last_act_at,
        }
    }

    fn set_last_act_at(&mut self, now: f64) {
        match self {
            Self::Loot(state) => state.last_act_at = now,
            Self::Hold(state) => state.last_act_at = now,
            Self::Idle(state) => state.last_act_at = now,
        }
    }
}

/// Source createWorldTactics: one goal slot state per source key, stale-pruned at [`STALE_MS`].
pub(crate) struct WorldTactics {
    slots: Vec<(String, WorldState)>,
}

impl WorldTactics {
    pub(crate) fn new() -> Self {
        Self { slots: Vec::new() }
    }

    /// Source `slot`: prune the stale slots in iteration order, then get-or-create this key's state, widen it to the
    /// requested source state and refresh its last-act time. A source `Map.delete` followed by a `set` appends the new
    /// entry at the end, so a fresh slot is pushed; a live slot keeps its position.
    fn slot(
        &mut self,
        key: String,
        now: f64,
        fresh: impl FnOnce() -> WorldState,
    ) -> &mut WorldState {
        // Source `for (const [k, s] of states) if (now - s.lastActAt > STALE_MS) states.delete(k)`; Vec::retain keeps the
        // surviving source insertion order and the exact strict `>` predicate (a NaN clock keeps the slot, as in JS).
        fn stale(now: f64, last_act_at: f64) -> bool {
            now - last_act_at > STALE_MS
        }
        self.slots
            .retain(|(_, state)| !stale(now, state.last_act_at()));
        let index = match self.slots.iter().position(|(existing, _)| *existing == key) {
            Some(index) => index,
            None => {
                self.slots.push((key, fresh()));
                self.slots.len() - 1
            }
        };
        let state = &mut self.slots[index].1;
        state.set_last_act_at(now);
        state
    }

    /// Source `world.act`: the four no-fight goals. Only loot can raise the mapped empty-route boundary.
    pub(crate) fn act(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        goal: &WorldGoal,
    ) -> Result<TacticsOutput, TacticsError> {
        let now = ctx.p.now;
        match goal {
            WorldGoal::Loot { container } => {
                // Source fresh(): carried(ctx) is read when the slot is created. The read is pure (a count over the
                // declared weapons array), so reading it ahead of the get-or-create is the same source value.
                let carried_at_start = carried(&ctx.p.self_.weapons) as u64;
                let state = self.slot(format!("loot:{container}"), now, move || {
                    WorldState::Loot(LootState {
                        last_act_at: now,
                        started_at: now,
                        last_now: -1.,
                        carried_at_start,
                        stop_at: None,
                        pickup_at: None,
                        fails: 0,
                        final_status: None,
                    })
                });
                let WorldState::Loot(st) = state else {
                    unreachable!("the loot key namespaces a loot slot")
                };
                act_loot(ctx, container, st)
            }
            WorldGoal::Roam { to, .. } => Ok(act_roam(ctx, *to)),
            WorldGoal::Hold { at, why } => {
                let key = format!(
                    "hold:{}:{},{}",
                    why.as_str(),
                    js_round(at.x / 16.) as i64,
                    js_round(at.y / 16.) as i64
                );
                let state = self.slot(key, now, move || {
                    WorldState::Hold(HoldState {
                        last_act_at: now,
                        stop_at: None,
                        spot: None,
                    })
                });
                let WorldState::Hold(st) = state else {
                    unreachable!("the hold key namespaces a hold slot")
                };
                Ok(act_hold(ctx, *at, *why, st))
            }
            WorldGoal::Idle => {
                let state = self.slot("idle".to_string(), now, move || {
                    WorldState::Idle(IdleState {
                        last_act_at: now,
                        stop_at: None,
                    })
                });
                let WorldState::Idle(st) = state else {
                    unreachable!("the idle key namespaces an idle slot")
                };
                Ok(act_idle(ctx, st))
            }
        }
    }
}

/// Source `pickHoldSpot`: the point on the ring about `centre` farthest from the other fighters in sight, with a seeded
/// jitter so two bots in the same spot do not pick the same one. On a walkable disc, and inside the coliseum when
/// `centre` is. The source reads the collision map here (its only recorded callback on this path) and draws from the
/// decide stream once for the phase and once per candidate for the jitter.
pub(crate) fn pick_hold_spot(ctx: &mut TacticsContext<'_>, centre: Vec2, ring_radius: f64) -> Vec2 {
    let map = ctx.paths.collision_map();
    // uniform(ctx.rng.decide, 0, (2 * Math.PI) / HOLD_SPOT_STEPS): lo + (hi - lo) * rng().
    let phase = 0.0 + (((2.0 * PI) / HOLD_SPOT_STEPS as f64) - 0.0) * ctx.decide.draw();
    let inside = ctx.cfg.map.in_coliseum(centre.x, centre.y);
    let mut best: Option<Vec2> = None;
    let mut best_score = f64::NEG_INFINITY;
    let mut fallback: Option<Vec2> = None;
    let mut fallback_score = f64::NEG_INFINITY;
    for i in 0..HOLD_SPOT_STEPS {
        let angle = phase + (2.0 * PI * i as f64) / HOLD_SPOT_STEPS as f64;
        // uniform(ctx.rng.decide, 0, HOLD_SPOT_JITTER); drawn at the top of the step, before the clear test.
        let jitter = 0.0 + (HOLD_SPOT_JITTER - 0.0) * ctx.decide.draw();
        let pt = Vec2::new(
            centre.x + cos(angle) * ring_radius,
            centre.y + sin(angle) * ring_radius,
        );
        if !rh_sim::geometry::circle_clear(map, pt, PLAYER_RADIUS, MASK_MOVE) {
            continue;
        }
        let mut nearest = f64::INFINITY;
        for fighter in &ctx.p.fighters {
            if fighter.status != "alive" {
                continue;
            }
            nearest = nearest.min(dist(fighter.pos(), pt));
        }
        let score = (if nearest == f64::INFINITY {
            0.
        } else {
            nearest
        }) + jitter;
        if score > fallback_score {
            fallback = Some(pt);
            fallback_score = score;
        }
        if inside && !ctx.cfg.map.in_coliseum(pt.x, pt.y) {
            continue;
        }
        if score > best_score {
            best = Some(pt);
            best_score = score;
        }
    }
    best.or(fallback).unwrap_or(centre)
}

// ================================================================================================================= loot

// The source `carried` and `dist` leaves are shared with the other tactic components (super::types).

/// Source `out`: the ordered intents, one status and "not attacking" (a world order never fights).
fn out(intents: Vec<Intent>, status: GoalStatus) -> TacticsOutput {
    TacticsOutput {
        intents,
        status,
        attacking: false,
    }
}

/// Source `goalIntent`: the body at the given priority, step timing and the source why.
fn goal_intent(body: IntentBody, why: impl Into<String>, priority: u8) -> Intent {
    Intent {
        body,
        priority,
        timing: IntentTiming::Step {},
        why: why.into(),
    }
}

/// The two refusal toasts the pickup can raise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToastKind {
    Gone,
    Far,
}

/// Source `toastKind`: trim, strip one trailing full stop, lower-case, then classify the refusal text.
fn toast_kind(text: &str) -> Option<ToastKind> {
    let trimmed = text.trim();
    let normalized = trimmed.strip_suffix('.').unwrap_or(trimmed).to_lowercase();
    match normalized.as_str() {
        "nothing there" | "nothing to take" => Some(ToastKind::Gone),
        "too far away" | "can't reach that" => Some(ToastKind::Far),
        _ => None,
    }
}

/// Source `holdsNoWeapon` on a seen ContainerView: closed with a named weapon only.
fn holds_no_weapon_view(container: &TacticContainer) -> bool {
    !container.closed || container.weapon == ContainersWeapon::Null
}

/// Source `holdsNoWeapon` on a remembered container: Undefined is not null (it cannot tell from here).
fn holds_no_weapon_memory(container: &ContainerMemory) -> bool {
    !container.closed || container.weapon == ContainersWeapon::Null
}

/// Source `finish` inside actLoot: record the terminal status so a later think repeats it without acting.
fn finish_loot(st: &mut LootState, status: GoalStatus) -> TacticsOutput {
    st.final_status = Some(status.clone());
    out(Vec::new(), status)
}

/// Source `actLoot`: the whole no-fight container detour, from the slot's carried/start facts and the observed refusal
/// toasts through the terminal statuses and the walk/settle/press.
fn act_loot(
    ctx: &mut TacticsContext<'_>,
    id: &str,
    st: &mut LootState,
) -> Result<TacticsOutput, TacticsError> {
    let now = ctx.p.now;
    if let Some(status) = st.final_status.clone() {
        return Ok(out(Vec::new(), status));
    }

    if st.last_now != now {
        st.last_now = now;
        for event in &ctx.p.events {
            let TacticEventKind::Toast { text } = &event.kind else {
                continue;
            };
            let Some(pickup_at) = st.pickup_at else {
                continue;
            };
            if event.t < pickup_at {
                continue;
            }
            match toast_kind(text) {
                Some(ToastKind::Gone) => st.fails = LOOT_MAX_FAILS,
                Some(ToastKind::Far) => st.fails += 1,
                None => {}
            }
        }
    }

    // Source `seen ? holdsNoWeapon(seen) : remembered && holdsNoWeapon(remembered)`.
    let seen = ctx.p.containers.iter().find(|container| container.id == id);
    let remembered = ctx.mem.container(id);
    if carried(&ctx.p.self_.weapons) as u64 > st.carried_at_start {
        return Ok(finish_loot(st, GoalStatus::done("picked up")));
    }
    if st.fails >= LOOT_MAX_FAILS {
        return Ok(finish_loot(st, GoalStatus::failed("refused")));
    }
    let emptied = match seen {
        Some(container) => holds_no_weapon_view(container),
        None => remembered.as_ref().is_some_and(holds_no_weapon_memory),
    };
    if emptied {
        return Ok(finish_loot(st, GoalStatus::done("emptied")));
    }
    if remembered
        .as_ref()
        .is_some_and(|container| container.skipped)
    {
        return Ok(finish_loot(st, GoalStatus::failed("skipped")));
    }
    if seen.is_none() && remembered.is_none() {
        return Ok(finish_loot(st, GoalStatus::failed("gone")));
    }
    if now - st.started_at > LOOT_BUDGET_MS {
        return Ok(finish_loot(st, GoalStatus::failed("budget")));
    }
    if ctx
        .p
        .fighters
        .iter()
        .any(|fighter| fighter.status == "alive" && fighter.dist < LOOT_ENEMY_DISTANCE)
    {
        return Ok(finish_loot(st, GoalStatus::failed("enemy near")));
    }
    // `p.mobs.some(m => m.status !== "dead" && m.dist < LOOT_MOB_DISTANCE && mobAwake(ctx, m))`: the Memory read runs
    // only for the non-dead mobs inside the distance, in percept order.
    let mob_near = {
        let mut near = false;
        for mob in &ctx.p.mobs {
            if mob.status == "dead" || mob.dist >= LOOT_MOB_DISTANCE {
                continue;
            }
            if mob_awake(ctx, mob) {
                near = true;
                break;
            }
        }
        near
    };
    if mob_near {
        return Ok(finish_loot(st, GoalStatus::failed("mob near")));
    }

    // `const at = seen ?? remembered!.pos`: the seen object itself (so the walk keeps its identity) or the remembered
    // position. The "gone" status above guarantees one of them exists.
    let at = match seen {
        Some(container) => container.pos(),
        None => {
            remembered
                .as_ref()
                .expect("a loot target is seen or remembered")
                .pos
        }
    };
    let d = dist(ctx.p.self_.pos(), at);
    if let Some(container) = seen {
        if container.interactable && d <= PICKUP_DISTANCE {
            return Ok(take_it(ctx, st, container));
        }
    }

    let at_arg = match seen {
        Some(container) => PathArg::Container(container),
        None => PathArg::Point(
            remembered
                .as_ref()
                .expect("a loot target is seen or remembered")
                .pos,
        ),
    };
    let Some(to) = next_step(ctx, at_arg, d)? else {
        return Ok(finish_loot(st, GoalStatus::failed("unreachable")));
    };
    Ok(out(
        vec![goal_intent(
            IntentBody::Move {
                to: RouteElement::Point(to),
            },
            "to the container",
            priority::GOAL,
        )],
        GoalStatus::running("walking"),
    ))
}

/// Source `mobAwake`: the real Memory's awake flag, else whether the seen mob is moving faster than a shuffle.
fn mob_awake(ctx: &mut TacticsContext<'_>, mob: &TacticMob) -> bool {
    if let Some(known) = ctx.mem.mob(&mob.id) {
        known.awake
    } else {
        source_hypot(mob.vx, mob.vy) > 20.
    }
}

/// Source `takeIt`: in reach, halt so the server's position settles, then press F once the bot has stood still.
fn take_it(
    ctx: &mut TacticsContext<'_>,
    st: &mut LootState,
    container: &TacticContainer,
) -> TacticsOutput {
    let now = ctx.p.now;
    let still = now - ctx.mem.self_memory().still_since >= STILL_BEFORE_PICKUP_MS;
    let running = GoalStatus::running(if still { "taking" } else { "settling" });
    if !still {
        if let Some(stop_at) = st.stop_at {
            if now - stop_at < STOP_RESEND_MS {
                return out(Vec::new(), running);
            }
        }
        st.stop_at = Some(now);
        return out(
            vec![goal_intent(
                IntentBody::Stop {},
                "hold still for the pickup",
                priority::GOAL,
            )],
            running,
        );
    }
    if let Some(pickup_at) = st.pickup_at {
        if now - pickup_at < PICKUP_RETRY_MS {
            return out(Vec::new(), running);
        }
    }
    st.pickup_at = Some(now);
    out(
        vec![goal_intent(
            IntentBody::Pickup {
                container: container.id.clone(),
            },
            "take the weapon",
            priority::GOAL,
        )],
        running,
    )
}

/// Source `nextStep`: where to click next, the container itself or, around a wall, the next waypoint of the walk; `None`
/// when there is no way. The source's missing last waypoint of an explicitly empty test-service route is the one mapped
/// cross-language boundary ([`TacticsError::EmptyWorldRoute`]).
fn next_step(
    ctx: &mut TacticsContext<'_>,
    at: PathArg<'_>,
    d: f64,
) -> Result<Option<Vec2>, TacticsError> {
    let me = ctx.p.self_.pos();
    // `d <= WAYPOINT_FROM || paths.los(me, at)`: the los request is short-circuited away when d is small.
    if d <= WAYPOINT_FROM || ctx.paths.los(&ctx.p.self_, at) {
        return Ok(Some(at.point()));
    }
    let route = ctx.paths.path(&ctx.p.self_, at);
    let Some(route) = route else {
        return Ok(if ctx.paths.walk(&ctx.p.self_, at).is_none() {
            None
        } else {
            Some(at.point())
        });
    };
    let next = route
        .elements
        .iter()
        .find(|element| dist(me, element.point()) > 2. * PLAYER_RADIUS)
        .or_else(|| route.elements.last());
    match next {
        Some(element) => Ok(Some(element.point())),
        None => Err(TacticsError::EmptyWorldRoute),
    }
}

// ================================================================================================================= roam

/// Source `actRoam`: stand within [`ARRIVE_DISTANCE`] (`done`), or within [`ROAM_SETTLED_DISTANCE`] after standing
/// still for [`ROAM_SETTLED_MS`] (the hand can land short), else walk on. No slot: a roam owns no state.
fn act_roam(ctx: &mut TacticsContext<'_>, to: Vec2) -> TacticsOutput {
    let d = dist(ctx.p.self_.pos(), to);
    if d <= ARRIVE_DISTANCE {
        return out(Vec::new(), GoalStatus::done("arrived"));
    }
    if d <= ROAM_SETTLED_DISTANCE
        && ctx.p.now - ctx.mem.self_memory().still_since >= ROAM_SETTLED_MS
    {
        return out(Vec::new(), GoalStatus::done("close enough"));
    }
    if ctx.paths.walk(&ctx.p.self_, PathArg::Point(to)).is_none() {
        return out(Vec::new(), GoalStatus::failed("unreachable"));
    }
    out(
        vec![goal_intent(
            IntentBody::Move {
                to: RouteElement::Point(to),
            },
            "roam",
            priority::GOAL,
        )],
        GoalStatus::running("walking"),
    )
}

// ================================================================================================================= hold

/// Source `stopOnce`: a halt that is sent once, and again only if the bot is still moving a while later (the first
/// never took).
fn stop_once(ctx: &mut TacticsContext<'_>, stop_at: &mut Option<f64>, why: &str) -> Vec<Intent> {
    let now = ctx.p.now;
    let moving = now - ctx.mem.self_memory().still_since < STILL_BEFORE_PICKUP_MS;
    if let Some(at) = *stop_at {
        if !(moving && now - at >= STOP_RESEND_MS) {
            return Vec::new();
        }
    }
    *stop_at = Some(now);
    vec![goal_intent(IntentBody::Stop {}, why, priority::CHORE)]
}

/// Source `crowded`: another alive fighter stands within [`CROWDED_DISTANCE`] of the point.
fn crowded(ctx: &TacticsContext<'_>, at: Vec2) -> bool {
    ctx.p
        .fighters
        .iter()
        .any(|fighter| fighter.status == "alive" && dist(fighter.pos(), at) < CROWDED_DISTANCE)
}

/// Source `actHold`: an ambush or a wait is standing where the bot is; only the coliseum is a place to walk to.
fn act_hold(
    ctx: &mut TacticsContext<'_>,
    at: Vec2,
    why: HoldWhy,
    st: &mut HoldState,
) -> TacticsOutput {
    if why != HoldWhy::Coliseum {
        let why_text = format!("hold ({})", why.as_str());
        return out(
            stop_once(ctx, &mut st.stop_at, &why_text),
            GoalStatus::running("holding"),
        );
    }

    if st.stop_at.is_none()
        && st.spot.is_none()
        && ctx.cfg.persona.coliseum < 0.5
        && crowded(ctx, at)
    {
        // The source evaluates `ctx.svc.paths.collisionMap().coliseum.centre` for the argument (one recorded call) and
        // pickHoldSpot then reads the collision map again for its own geometry (a second recorded call).
        let centre = {
            let _ = ctx.paths.collision_map();
            ctx.cfg.map.coliseum_centre
        };
        st.spot = Some(pick_hold_spot(ctx, centre, COLISEUM_RING_RADIUS));
    }
    let target = st.spot.unwrap_or(at);
    let d = dist(ctx.p.self_.pos(), target);
    let settled =
        d <= SETTLED_DISTANCE && ctx.p.now - ctx.mem.self_memory().still_since >= SETTLED_MS;
    if st.stop_at.is_some() || d <= HOLD_ARRIVE_DISTANCE || settled {
        return out(
            stop_once(ctx, &mut st.stop_at, "hold the coliseum"),
            GoalStatus::running("holding"),
        );
    }
    if ctx
        .paths
        .walk(&ctx.p.self_, PathArg::Point(target))
        .is_none()
    {
        return out(Vec::new(), GoalStatus::failed("unreachable"));
    }
    out(
        vec![goal_intent(
            IntentBody::Move {
                to: RouteElement::Point(target),
            },
            "to the coliseum spot",
            priority::GOAL,
        )],
        GoalStatus::running("walking"),
    )
}

// ================================================================================================================= idle

/// Source `actIdle`: stand, holding the one sent halt.
fn act_idle(ctx: &mut TacticsContext<'_>, st: &mut IdleState) -> TacticsOutput {
    out(
        stop_once(ctx, &mut st.stop_at, "idle"),
        GoalStatus::running("idle"),
    )
}
