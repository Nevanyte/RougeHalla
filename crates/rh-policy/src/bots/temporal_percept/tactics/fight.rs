//! Private source Fight (packages/server/src/bots/brain/tactics/fight.ts): the complete player/mob and
//! remembered/current fight state machine. Owner of the one shared OrbWalk/Reflexes/Retreat instance.
//!
//! Choose the opponent, weapon and movement for one fight. Wands use the server lock; other weapons approach their own
//! reach and ask the humanizer for aimed clicks with its usual scatter. Ported line for line, in source order: the
//! arithmetic, guards, path/memory callback order and decide draws are the source's and must stay that way (the frozen
//! witness replays them).

use rh_sim::constants::{PLAYER_RADIUS, TARGET_RANGE};
use rh_sim::content::{self, Shape};
use rh_sim::{FactionId, Vec2, WeaponId};

use crate::bots::mob_hunt::{best_edge, best_slot_vs_mob, is_ranged, weapon_edge};
use crate::bots::types::{ServerMs, StimulusKind};

use super::kite::{OrbFoe, OrbStep, OrbWalk, Reflexes, Retreat};
use super::types::{
    dist, is_regional_kind, mob_weapon, priority, react_or, to_bot_weapon, FightKind, FightRef,
    Foe, GoalStatus, Intent, IntentBody, IntentTiming, Lookup, PathArg, RouteElement,
    TacticFighter, TacticMob, TacticSelf, TacticsContext, TacticsOutput,
};

/// The server takes a lock within TARGET_RANGE; the bot clicks this much (u) inside it, since what it sees is a patch old.
const LOCK_MARGIN: f64 = 40.;
/// The foe counts as being attacked while locked, in sight and this much (u) past the weapon's attack range at most.
const ATTACK_SLACK: f64 = 24.;
/// Weapons are swapped for a foe this close, and no more often than SWAP_EVERY_MS plus up to SWAP_JITTER_MS (two bots
/// answering each other would swap in lockstep).
const SWAP_DISTANCE: f64 = 600.;
const SWAP_EVERY_MS: f64 = 2_000.;
const SWAP_JITTER_MS: f64 = 2_000.;
/// No progress toward the foe, no hit on it, not attacking for this long: the goal failed.
const NO_PROGRESS_MS: f64 = 10_000.;
const PROGRESS_U: f64 = 40.;
/// Walk orders are re-sent only when the destination moved this far, or after this long, or when the bot stands still.
const MOVE_RESEND_U: f64 = 48.;
const MOVE_RESEND_MS: f64 = 1_500.;
const STILL_RESEND_MS: f64 = 700.;
/// The walk round a wall is planned no more often than this, and given up after this many plans in a row found no path.
const REPLAN_MS: f64 = 400.;
const NO_PATH_FAILS: u32 = 3;
/// The farthest waypoint of a path that is clicked: on screen, with a clear walk.
const WAYPOINT_REACH: f64 = 520.;
/// A bounty carrier below this hp share opens no new fight with a player.
const BOUNTY_MIN_HP: f64 = 0.7;
/// Sudden death: the bot ahead on hp share keeps this far from its opponent; the lead needed to start and to keep doing
/// it (hp shares).
const SD_KEEP: f64 = 340.;
const SD_BAND: f64 = 0.02;
/// A camp fights as one (camp-wide aggro), so its mobs bunch round the bot and a click meant for one lands on its
/// neighbour. A lock on a mob this close (u) to the goal's mob, or in its camp, is a lock on the same fight: the server
/// is already swinging at it, and clicking the goal's mob again only cancels that windup for a flip between two mates.
const MATE_RADIUS: f64 = 140.;
/// A melee foe is a chaser when it closes in on the bot, was seen chasing, or is this close (u); farther than
/// CHASE_RANGE it is not yet.
const CHASE_CLOSE: f64 = 260.;
const CHASE_RANGE: f64 = 380.;
const CHASE_SPEED: f64 = 40.;
/// A fight not touched for this long is over: the next one is a new engagement (the orb-walk dice are rolled again).
const ENGAGEMENT_GAP_MS: f64 = 4_000.;

/// The declared `inReach` foe argument: only x/y/los are consumed by the source method.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ReachFoe {
    pub x: f64,
    pub y: f64,
    pub los: bool,
}
impl ReachFoe {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// The tile mask that stops a weapon's reach: an arc (melee) weapon is stopped by MASK_MELEE (walls and, by default,
/// LOW: a swing does not cross a fence), a projectile weapon or nothing in hand by MASK_SIGHT (a shot flies over LOW).
fn reach_mask(weapon: WeaponId) -> u8 {
    if !is_ranged(weapon) {
        rh_sim::map::MASK_MELEE
    } else {
        rh_sim::map::MASK_SIGHT
    }
}

/// How the server's target lock plays a weapon (`lockSpacing` in packages/shared/src/policies.ts): the shared spacing,
/// but for the wand the 0.88 far share and 0.96 attack share of its range; arc weapons swing a little inside the edge.
/// Returns (far, attackRange).
pub(crate) fn lock_spacing(weapon: WeaponId) -> (f64, f64) {
    match content::weapon(weapon).shape {
        Shape::Arc { reach, .. } => (reach * 0.85, reach + PLAYER_RADIUS - 6.),
        Shape::Projectile { range, .. } if weapon == WeaponId::Wand => (range * 0.88, range * 0.96),
        Shape::Projectile { range, .. } => (range * (400. / 480.), range * 0.92),
    }
}

/// Source `inReach`: is the foe within the weapon's REACH as the server's lock decides it (`reachMask(weapon)` on the
/// collision map)? Sight is not reach: a fence, a lava stream or a crevasse stops a swing but not a shot or a look, so
/// across one a melee bot is still being walked round and attacks nothing. A ranged weapon's reach is sight, which is
/// the foe's own `los`. The collision map is read only for the melee mask (source short-circuit).
pub(crate) fn in_reach(ctx: &mut TacticsContext<'_>, foe: ReachFoe, weapon: WeaponId) -> bool {
    if !foe.los {
        return false;
    }
    let mask = reach_mask(weapon);
    if mask == rh_sim::map::MASK_SIGHT {
        return true;
    }
    let self_at = ctx.p.self_.pos();
    rh_sim::geometry::has_line_of_sight(ctx.paths.collision_map(), self_at, foe.pos(), mask)
}

// ------------------------------------------------------------------------------------------------------------- the foe

fn from_fighter(f: &TacticFighter) -> Foe {
    Foe {
        id: f.id.clone(),
        mob: false,
        seen: true,
        x: f.x,
        y: f.y,
        vx: f.vx,
        vy: f.vy,
        dist: f.dist,
        los: f.los,
        facing: f.facing,
        hp_frac: f.hp_frac,
        faction: f.faction,
        theirs: f.in_hand,
        targetable: f.targetable,
    }
}

fn from_mob(m: &TacticMob) -> Foe {
    Foe {
        id: m.id.clone(),
        mob: true,
        seen: true,
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy,
        dist: m.dist,
        los: m.los,
        facing: m.facing,
        hp_frac: m.hp_frac,
        faction: m.faction,
        theirs: mob_weapon(m.in_hand, m.faction),
        targetable: true,
    }
}

/// A foe known once but no longer on screen: its last known/remembered position and facts, velocity unknown.
fn remembered(
    ctx: &mut TacticsContext<'_>,
    id: &str,
    mob: bool,
    at: Vec2,
    hp_frac: f64,
    faction: Option<FactionId>,
    theirs: Option<WeaponId>,
) -> Foe {
    let me = ctx.p.self_.pos();
    let los = ctx.paths.los(&ctx.p.self_, PathArg::Point(at));
    Foe {
        id: id.to_string(),
        mob,
        seen: false,
        x: at.x,
        y: at.y,
        vx: 0.,
        vy: 0.,
        dist: dist(me, at),
        los,
        facing: 0.,
        hp_frac,
        faction,
        theirs,
        targetable: true,
    }
}

/// Source `lookup`: current fighter first, then current mob, then the actual Memory fighter (whereabouts) then the
/// actual Memory mob. A dead current row, dead Memory record or absent identity is Dead; a remembered fighter whose
/// whereabouts have lapsed and a mob walking home are Lost.
pub(crate) fn lookup(ctx: &mut TacticsContext<'_>, id: &str) -> Lookup {
    if let Some(fighter) = ctx.p.fighters.iter().find(|fighter| fighter.id == id) {
        return if fighter.status == "alive" {
            Lookup::Ready(from_fighter(fighter))
        } else {
            Lookup::Dead
        };
    }
    if let Some(mob) = ctx.p.mobs.iter().find(|mob| mob.id == id) {
        return if mob.status == "alive" {
            Lookup::Ready(from_mob(mob))
        } else {
            Lookup::Dead
        };
    }
    let now = ctx.p.now;
    if let Some(memory) = ctx.mem.fighter(id) {
        if !memory.alive {
            return Lookup::Dead;
        }
        let Some(whereabouts) = ctx.mem.whereabouts(id, now) else {
            return Lookup::Lost;
        };
        return Lookup::Ready(remembered(
            ctx,
            id,
            false,
            whereabouts.at,
            memory.hp_frac,
            memory.faction,
            memory.in_hand,
        ));
    }
    if let Some(memory) = ctx.mem.mob(id) {
        if !memory.alive {
            return Lookup::Dead;
        }
        if memory.returning {
            return Lookup::Lost;
        }
        let theirs = mob_weapon(memory.in_hand, memory.faction);
        return Lookup::Ready(remembered(
            ctx,
            id,
            true,
            memory.pos,
            memory.hp_frac,
            memory.faction,
            theirs,
        ));
    }
    Lookup::Dead
}

/// A melee foe that is coming for the bot (or already on it): the one an orb-walk is for.
fn is_melee_chaser(ctx: &mut TacticsContext<'_>, foe: &Foe) -> bool {
    let Some(theirs) = foe.theirs else {
        return false;
    };
    if is_ranged(theirs) || foe.dist > CHASE_RANGE {
        return false;
    }
    let me = ctx.p.self_.pos();
    let closing = ((me.x - foe.x) * foe.vx + (me.y - foe.y) * foe.vy) / foe.dist.max(1.);
    closing > CHASE_SPEED
        || foe.dist < CHASE_CLOSE
        || ctx
            .mem
            .fighter(&foe.id)
            .is_some_and(|memory| memory.chasing_me)
}

/// The camp mate of the goal's mob the lock is on, if it is a fight worth keeping: a live mob (not walking home) the
/// bot's weapons can hurt, no elite when the goal's mob is none, no shooter when the goal's mob is no shooter (mobHunt's
/// `skipRanged`: they back off to their leash). None when the lock is empty, on the goal's mob, on a player, or on a
/// mob that is not worth the fight.
fn locked_mate(ctx: &mut TacticsContext<'_>, foe: &Foe) -> Option<Foe> {
    if !foe.mob {
        return None;
    }
    let id = ctx.p.self_.attack_target.clone()?;
    if id == foe.id {
        return None;
    }
    let mate = ctx.p.mobs.iter().find(|mob| mob.id == id)?;
    if mate.status != "alive" || !is_regional_kind(&mate.kind) {
        return None;
    }
    if ctx.mem.mob(&id).is_some_and(|memory| memory.returning) {
        return None;
    }
    let camp = ctx.mem.mob(&id).and_then(|memory| memory.camp_id.clone());
    if dist(mate.pos(), foe.pos()) > MATE_RADIUS
        && (camp.is_none()
            || camp
                != ctx
                    .mem
                    .mob(&foe.id)
                    .and_then(|memory| memory.camp_id.clone()))
    {
        return None;
    }
    let goal_kind = ctx
        .p
        .mobs
        .iter()
        .find(|mob| mob.id == foe.id)
        .map(|mob| mob.kind.clone())
        .or_else(|| ctx.mem.mob(&foe.id).map(|memory| memory.kind.clone()));
    if mate.kind == "elite" && goal_kind.as_deref() != Some("elite") {
        return None;
    }
    let mate = from_mob(mate);
    if let Some(theirs) = mate.theirs {
        if best_edge(&ctx.p.self_.weapons, theirs) <= -2
            || (is_ranged(theirs) && !(foe.theirs.is_some_and(is_ranged)))
        {
            return None;
        }
    }
    Some(mate)
}

/// The players' best slot (policies.ts `bestSlot`): the better weapon edge against `theirs`; the current slot on a tie;
/// an empty slot never.
fn best_slot(slots: &[Option<WeaponId>; 2], current: u8, theirs: WeaponId) -> u8 {
    let score = |weapon: Option<WeaponId>| -> f64 {
        match weapon {
            None => f64::NEG_INFINITY,
            Some(weapon) => f64::from(weapon_edge(weapon, theirs)),
        }
    };
    let current = current.min(1);
    let other = 1 - current;
    if score(slots[usize::from(other)]) > score(slots[usize::from(current)]) {
        other
    } else {
        current
    }
}

/// The hand holds nothing (fists): take the other slot if it has a weapon, since any weapon beats bare hands. None
/// when it has none: the bot then fights on fists, which is how every run starts.
fn arm(view: &TacticSelf) -> Option<TacticsOutput> {
    let slot = if view.slot == 0 { 1 } else { 0 };
    view.weapons[usize::from(slot)]?;
    Some(TacticsOutput {
        intents: vec![Intent {
            body: IntentBody::Swap { slot },
            priority: priority::COMBAT,
            timing: IntentTiming::Step {},
            why: "empty hand".into(),
        }],
        status: GoalStatus::running("taking the other weapon"),
        attacking: false,
    })
}

/// The lock click: where the foe is drawn now, with the stimuli a failed lock/click/order answers.
fn lock_intent(ctx: &mut TacticsContext<'_>, foe: &Foe, why: &str) -> Intent {
    let timing = react_or(
        ctx,
        &[
            StimulusKind::LockLost,
            StimulusKind::ClickMissed,
            StimulusKind::OrderFailed,
            StimulusKind::TargetDown,
            StimulusKind::NewThreat,
        ],
        Some(foe.id.as_str()),
    );
    Intent {
        body: IntentBody::Lock {
            target: foe.id.clone(),
            at: Vec2::new(foe.x, foe.y),
        },
        priority: priority::COMBAT,
        timing,
        why: why.into(),
    }
}

/// The retained state of one source engagement.
struct Engagement {
    id: String,
    kite: bool,
}

/// The watch for a fight that goes nowhere.
struct Progress {
    id: String,
    best: f64,
    hp: f64,
    since: ServerMs,
}

/// The walk round a wall: planned at most every REPLAN_MS; None points = no path (counted, see NO_PATH_FAILS).
struct Plan {
    id: String,
    at: ServerMs,
    goal: Vec2,
    pts: Option<Vec<RouteElement>>,
}

/// The walk order last sent, so the same one is not sent twice.
struct LastMove {
    to: Vec2,
    at: ServerMs,
}

/// Source createFight: one shared OrbWalk/Reflexes/Retreat and the retained fight closure state.
pub(crate) struct Fight {
    orb: OrbWalk,
    reflexes: Reflexes,
    retreat: Retreat,
    engagement: Option<Engagement>,
    last_fight_at: f64,
    progress: Option<Progress>,
    plan: Option<Plan>,
    no_path: u32,
    last_move: Option<LastMove>,
    held: bool,
    next_swap_at: f64,
    sd_hold: bool,
    mobs_seen: Vec<String>,
    mob_targets: u64,
}

impl Fight {
    pub(crate) fn new(orb: OrbWalk, reflexes: Reflexes, retreat: Retreat) -> Self {
        Self {
            orb,
            reflexes,
            retreat,
            engagement: None,
            last_fight_at: f64::NEG_INFINITY,
            progress: None,
            plan: None,
            no_path: 0,
            last_move: None,
            held: false,
            next_swap_at: 0.,
            sd_hold: false,
            mobs_seen: Vec::new(),
            mob_targets: 0,
        }
    }

    /// Source `touch`: out of the ordinary; the watch for a fight going nowhere starts again from here.
    fn touch(&mut self, now: ServerMs) {
        if let Some(progress) = self.progress.as_mut() {
            progress.since = now;
        }
    }

    /// Source `ordered`: an order that is not a walk replaces the walk on the server, so the next walk must be sent again.
    fn ordered(&mut self) {
        self.last_move = None;
        self.held = false;
    }

    /// The walk round a wall, planned at most every REPLAN_MS; None = no path (counted: see NO_PATH_FAILS).
    fn planned(&mut self, ctx: &mut TacticsContext<'_>, foe: &Foe) -> Option<Vec<RouteElement>> {
        let now = ctx.p.now;
        if let Some(plan) = self.plan.as_ref() {
            if plan.id == foe.id && now - plan.at < REPLAN_MS && dist(plan.goal, foe.pos()) < 96. {
                return plan.pts.clone();
            }
        }
        let route = ctx.paths.path(&ctx.p.self_, PathArg::Foe(foe));
        let ok = route
            .as_ref()
            .is_some_and(|route| !route.elements.is_empty());
        let points = if ok {
            route.map(|route| route.elements)
        } else {
            None
        };
        self.plan = Some(Plan {
            id: foe.id.clone(),
            at: now,
            goal: foe.pos(),
            pts: points,
        });
        self.no_path = if ok { 0 } else { self.no_path + 1 };
        self.plan.as_ref().and_then(|plan| plan.pts.clone())
    }

    /// The farthest waypoint that is on screen and walkable in a straight line: one click carries the bot round the
    /// corner.
    fn waypoint(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        points: &[RouteElement],
        foe: &Foe,
    ) -> RouteElement {
        let me = ctx.p.self_.pos();
        let mut best: Option<RouteElement> = None;
        for point in points {
            let at = point.point();
            let distance = dist(me, at);
            if distance <= 24. {
                continue;
            }
            if best.is_none() {
                best = Some(point.clone());
            }
            if distance > WAYPOINT_REACH {
                break;
            }
            if ctx.paths.clear(&ctx.p.self_, point.as_path_arg()) {
                best = Some(point.clone());
            }
        }
        best.unwrap_or_else(|| RouteElement::Point(foe.pos()))
    }

    /// A walk order to `to`, unless the same one is already on its way.
    fn walk(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        to: RouteElement,
        foe: &Foe,
        why: &str,
    ) -> Option<Intent> {
        let now = ctx.p.now;
        let at = to.point();
        if let Some(last_move) = self.last_move.as_ref() {
            if dist(last_move.to, at) < MOVE_RESEND_U && now - last_move.at < MOVE_RESEND_MS {
                let still_since = ctx.mem.self_memory().still_since;
                let idle =
                    now - still_since > STILL_RESEND_MS && now - last_move.at > STILL_RESEND_MS;
                if !idle {
                    return None;
                }
            }
        }
        self.last_move = Some(LastMove { to: at, at: now });
        self.held = false;
        let timing = react_or(ctx, &[StimulusKind::NewThreat], Some(foe.id.as_str()));
        Some(Intent {
            body: IntentBody::Move { to },
            priority: priority::GOAL,
            timing,
            why: why.into(),
        })
    }

    fn swap_for(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        foe: &Foe,
        weapon: WeaponId,
    ) -> Option<Intent> {
        let view = &ctx.p.self_;
        let now = ctx.p.now;
        if now < self.next_swap_at
            || view.draw_started_at > 0.
            || !foe.seen
            || foe.dist > SWAP_DISTANCE
        {
            return None;
        }
        let theirs = foe.theirs?;
        if let Some(timings) = super::kite::own_timings(view, weapon) {
            if now < view.ready_at - timings.interval_ms + timings.windup_ms {
                return None;
            }
        }
        let slot = view.slot;
        let want = if foe.mob {
            best_slot_vs_mob(view.weapons, slot, Some(theirs))
        } else {
            best_slot(&view.weapons, slot, theirs)
        };
        if want == slot {
            return None;
        }
        let next = view.weapons[usize::from(want.min(1))];
        // A player's wheel is only as good as what the bot knows of it (an unknown edge reads 0, so there is nothing to
        // gain).
        if !foe.mob {
            if let Some(next) = next {
                let next_edge = ctx.know.weapon_edge(next, theirs);
                let current_edge = ctx.know.weapon_edge(weapon, theirs);
                if next_edge <= current_edge {
                    return None;
                }
            }
        }
        let draw = ctx.decide.draw();
        self.next_swap_at = now + SWAP_EVERY_MS + draw * SWAP_JITTER_MS;
        let timing = react_or(
            ctx,
            &[StimulusKind::FoeSwapped, StimulusKind::NewThreat],
            Some(foe.id.as_str()),
        );
        let next_name = next.map_or_else(
            || "null".to_string(),
            |weapon| to_bot_weapon(weapon).as_str().to_string(),
        );
        Some(Intent {
            body: IntentBody::Swap { slot: want },
            priority: priority::COMBAT,
            timing,
            why: format!(
                "{} -> {} against {}",
                to_bot_weapon(weapon).as_str(),
                next_name,
                to_bot_weapon(theirs).as_str()
            ),
        })
    }

    /// Source `fight.act`.
    pub(crate) fn act(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        reference: &FightRef,
        knows_sudden_death: bool,
    ) -> TacticsOutput {
        let view = ctx.p.self_.clone();
        let now = ctx.p.now;
        if view.status != "alive" {
            return TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::failed("not alive"),
                attacking: false,
            };
        }
        if view.faction.is_none() {
            return TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::failed("no faction yet"),
                attacking: false,
            };
        }
        let in_hand = view.weapons[usize::from(view.slot.min(1))];
        if in_hand.is_none() {
            if let Some(armed) = arm(&view) {
                return armed;
            }
        }
        // An empty hand with nothing in the other slot fights with fists, as the server does (sim/combatant.ts
        // activeWeapon).
        let weapon: WeaponId = in_hand.unwrap_or(WeaponId::Fists);

        let foe = match lookup(ctx, reference.id.as_str()) {
            Lookup::Dead => {
                self.engagement = None;
                return TacticsOutput {
                    intents: Vec::new(),
                    status: GoalStatus::done("target down"),
                    attacking: false,
                };
            }
            Lookup::Lost => {
                return TacticsOutput {
                    intents: Vec::new(),
                    status: GoalStatus::failed("lost track of the target"),
                    attacking: false,
                };
            }
            Lookup::Ready(foe) => foe,
        };
        if foe.mob && ctx.p.hud.in_coliseum {
            return TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::failed("no mobs in the coliseum"),
                attacking: false,
            };
        }
        if foe.mob && ctx.p.hud.gates_locked {
            return TacticsOutput {
                intents: Vec::new(),
                status: GoalStatus::failed("the gates are locked: no mob can be reached"),
                attacking: false,
            };
        }

        let new_engagement = match self.engagement.as_ref() {
            None => true,
            Some(engagement) => {
                engagement.id != foe.id || now - self.last_fight_at > ENGAGEMENT_GAP_MS
            }
        };
        if new_engagement {
            let draw = ctx.decide.draw();
            let kite = draw < ctx.cfg.tier.orbwalk.p * ctx.cfg.persona.kite;
            self.engagement = Some(Engagement {
                id: foe.id.clone(),
                kite,
            });
            self.progress = None;
            self.plan = None;
            self.no_path = 0;
            self.sd_hold = false;
            self.ordered();
            let ready_at = view.ready_at;
            self.orb.reset(ready_at);
            if foe.mob && !self.mobs_seen.contains(&foe.id) {
                self.mobs_seen.push(foe.id.clone());
                self.mob_targets += 1;
            }
        }
        self.last_fight_at = now;

        // The lock is on the goal's mob, or on a camp mate (see locked_mate): then the fight is that mate's, and nothing
        // is re-clicked.
        let mate = locked_mate(ctx, &foe);
        let locked = view.attack_target.as_deref() == Some(foe.id.as_str()) || mate.is_some();
        let on = mate.unwrap_or_else(|| foe.clone());
        let (far, attack_range) = lock_spacing(weapon);
        let attacking = (locked || weapon != WeaponId::Wand)
            && on.seen
            && in_reach(
                ctx,
                ReachFoe {
                    x: on.x,
                    y: on.y,
                    los: on.los,
                },
                weapon,
            )
            && on.dist <= attack_range + ATTACK_SLACK;
        let mine = if view.max_hp > 0. {
            view.hp / view.max_hp
        } else {
            1.
        };
        let swap = self.swap_for(ctx, &on, weapon);
        let finish =
            |order: Option<Intent>, status: GoalStatus, attacking: bool| -> TacticsOutput {
                let mut intents = Vec::with_capacity(2);
                if let Some(order) = order {
                    intents.push(order);
                }
                if let Some(swap) = swap.clone() {
                    intents.push(swap);
                }
                TacticsOutput {
                    intents,
                    status,
                    attacking,
                }
            };

        // A ball or an arrow on its way pre-empts everything on the order channel; strategy hears of it as "blocked".
        let reflex = self.reflexes.check(ctx);
        if let Some(reflex) = reflex {
            self.touch(now);
            self.ordered();
            let why = format!("{}: {}", reflex.kind.as_str(), reflex.intent.why);
            return finish(Some(reflex.intent), GoalStatus::blocked(why), false);
        }
        if now < self.reflexes.hold_until() {
            self.touch(now);
            return finish(None, GoalStatus::running("a sidestep is on its way"), false);
        }

        // Whoever opens a fight with a player while wearing a crown and hurt is asking for it.
        if reference.kind == FightKind::Hunt
            && !foe.mob
            && view.bounty > 0.
            && mine < BOUNTY_MIN_HP
            && !locked
            && !ctx.engaged
        {
            self.touch(now);
            return finish(
                None,
                GoalStatus::blocked("carrying a bounty below 70% hp: no new fight"),
                false,
            );
        }

        // Sudden death burns every hp pool at the same share, so the lower share falls first: the bot ahead, if it knows,
        // stays away.
        let sd_on = knows_sudden_death
            && ctx.p.hud.sudden_death_at > 0.
            && now >= ctx.p.hud.sudden_death_at
            && !foe.mob
            && foe.seen;
        if sd_on {
            let lead = mine - foe.hp_frac;
            self.sd_hold = if self.sd_hold {
                lead > -SD_BAND
            } else {
                lead > SD_BAND
            };
        } else {
            self.sd_hold = false;
        }
        if self.sd_hold {
            self.touch(now);
            if foe.dist < SD_KEEP {
                let to = self.retreat.point(ctx, &[foe.pos()]);
                if let Some(to) = to {
                    self.ordered();
                    let timing = react_or(ctx, &[StimulusKind::NewThreat], Some(foe.id.as_str()));
                    return finish(
                        Some(Intent {
                            body: IntentBody::Move {
                                to: RouteElement::Point(to),
                            },
                            priority: priority::COMBAT,
                            timing,
                            why: "sudden death: ahead, keeping distance".into(),
                        }),
                        GoalStatus::running("sudden death: keeping distance"),
                        false,
                    );
                }
                // Cornered: nothing to gain by waiting, fight.
            } else {
                if self.held {
                    return finish(
                        None,
                        GoalStatus::running("sudden death: keeping distance"),
                        false,
                    );
                }
                self.held = true;
                self.last_move = None;
                return finish(
                    Some(Intent {
                        body: IntentBody::Stop {},
                        priority: priority::COMBAT,
                        timing: IntentTiming::Step {},
                        why: "sudden death: ahead, standing off".into(),
                    }),
                    GoalStatus::running("sudden death: keeping distance"),
                    false,
                );
            }
        }

        // The watch for a fight that goes nowhere.
        let progress_continues = self
            .progress
            .as_ref()
            .is_some_and(|progress| progress.id == foe.id);
        if !progress_continues {
            self.progress = Some(Progress {
                id: foe.id.clone(),
                best: foe.dist,
                hp: foe.hp_frac,
                since: now,
            });
        } else {
            let mut timed_out = false;
            if let Some(progress) = self.progress.as_mut() {
                if attacking
                    || foe.dist < progress.best - PROGRESS_U
                    || foe.hp_frac < progress.hp - 0.001
                {
                    progress.best = progress.best.min(foe.dist);
                    progress.hp = foe.hp_frac;
                    progress.since = now;
                } else if now - progress.since > NO_PROGRESS_MS {
                    timed_out = true;
                }
            }
            if timed_out {
                self.progress = None;
                return finish(None, GoalStatus::failed("no progress in 10 s"), false);
            }
        }

        // A ranged bot against a melee chaser, with the chance it rolled for this engagement: shoot, walk, shoot (kite.ts).
        let engagement_kite = self
            .engagement
            .as_ref()
            .is_some_and(|engagement| engagement.kite);
        if engagement_kite && on.seen && is_ranged(weapon) && is_melee_chaser(ctx, &on) {
            match self.orb.step(
                ctx,
                OrbFoe {
                    id: &on.id,
                    x: on.x,
                    y: on.y,
                },
                weapon,
                locked,
            ) {
                OrbStep::Wait => {
                    return finish(None, GoalStatus::running("orb-walk: stepping off"), false);
                }
                OrbStep::Order(intent) => {
                    self.ordered();
                    return finish(Some(intent), GoalStatus::running("orb-walk"), false);
                }
                OrbStep::None => {}
            }
        }

        if locked && weapon == WeaponId::Wand {
            return finish(
                None,
                GoalStatus::running("locked: the server is fighting"),
                attacking,
            );
        }

        // Not locked yet: walk until the server will take the click, then click once (and again only while it has not
        // taken it).
        let reach = if weapon == WeaponId::Wand {
            TARGET_RANGE - LOCK_MARGIN
        } else {
            far
        };
        let toward = !foe.seen
            || foe.dist > reach
            || (weapon != WeaponId::Wand
                && !in_reach(
                    ctx,
                    ReachFoe {
                        x: foe.x,
                        y: foe.y,
                        los: foe.los,
                    },
                    weapon,
                ));
        if !toward && !foe.targetable {
            return finish(
                None,
                GoalStatus::running("target cannot be clicked now"),
                false,
            );
        }
        let mut to = RouteElement::Point(foe.pos());
        if !foe.los {
            match self.planned(ctx, &foe) {
                None => {
                    if self.no_path >= NO_PATH_FAILS {
                        return finish(None, GoalStatus::failed("no path to the target"), false);
                    }
                    return finish(
                        None,
                        GoalStatus::running("looking for a way to the target"),
                        false,
                    );
                }
                Some(points) => {
                    if toward {
                        to = self.waypoint(ctx, &points, &foe);
                    }
                }
            }
        }
        if toward {
            let why = if foe.seen {
                "approach"
            } else {
                "go to where it was last seen"
            };
            let walk = self.walk(ctx, to, &foe, why);
            return finish(walk, GoalStatus::running("approaching"), false);
        }
        self.ordered();
        let (why, status) = if weapon == WeaponId::Wand {
            ("lock the foe", "locking")
        } else {
            ("click an aimed attack", "attacking")
        };
        let intent = lock_intent(ctx, &foe, why);
        finish(
            Some(intent),
            GoalStatus::running(status),
            weapon != WeaponId::Wand && attacking,
        )
    }

    /// Source `fight.leave`: the walk this fight sent is no longer on its way (not a full engagement reset).
    pub(crate) fn leave(&mut self) {
        self.last_move = None;
        self.held = false;
        self.plan = None;
    }

    /// Source `fight.mobTargets`: mob engagements started (lifetime).
    pub(crate) fn mob_targets(&self) -> u64 {
        self.mob_targets
    }

    pub(crate) fn orb(&self) -> &OrbWalk {
        &self.orb
    }
    pub(crate) fn reflexes(&self) -> &Reflexes {
        &self.reflexes
    }
    pub(crate) fn reflexes_mut(&mut self) -> &mut Reflexes {
        &mut self.reflexes
    }
    pub(crate) fn retreat_mut(&mut self) -> &mut Retreat {
        &mut self.retreat
    }
}
