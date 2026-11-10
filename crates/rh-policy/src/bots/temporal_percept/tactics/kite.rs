//! Private source moving-while-fighting components (packages/server/src/bots/brain/tactics/kite.ts): ownTimings,
//! the away/retreat/sidestep geometry leaves, OrbWalk, Reflexes and Retreat. Real source behaviour over the declared
//! tier values; the admitted reflex component's TierId-only contract cannot carry the declared per-case tier.
//!
//! Every move here drops the server target lock, so each one costs a re-click: the orb-walk only walks after its own
//! shot has left, and a juke is timed to land just after the other fighter's release.

use rh_sim::constants::{BOW_WINDUP_MAX_S, PLAYER_RADIUS, PLAYER_SPEED, RANGED_SLACK, TILE};
use rh_sim::mapgen::certify::source_hypot;
use rh_sim::mapgen::map_hash::number_string;
use rh_sim::{math, FactionId, Vec2, WeaponId};

use super::types::{
    dist, priority, Intent, IntentBody, IntentTiming, PathArg, RouteElement, TacticEventKind,
    TacticProjectile, TacticSelf, TacticsContext,
};
use crate::bots::types::{BotWeapon, StimulusKind};

pub(crate) use crate::bots::kite::OwnTimings;

/// Source `ownTimings`: the bot's own attack rhythm (ms) or None while it has no faction.
pub(crate) fn own_timings(
    self_: &super::types::TacticSelf,
    weapon: WeaponId,
) -> Option<OwnTimings> {
    crate::bots::kite::own_timings(
        self_.faction,
        super::types::to_bot_weapon(weapon),
        self_.as_mult,
        Some(self_.windup_mult()),
    )
}

// ------------------------------------------------------------------------------------------------------------ a step away

/// Source `awayPoint`: a point about `step_u` straight away from `threat` (turned by `jitter`), turned or shortened
/// until the walk to it is clear; None when no heading is clear (cornered). The headings are the shared source
/// `TURNS` (straight, then slide along the wall either side, never more than 60 degrees off) and `LENGTHS` (a
/// shortened step is tried when the full one is not clear).
pub(crate) fn away_point(
    ctx: &mut TacticsContext<'_>,
    self_at: Vec2,
    threat: Vec2,
    step_u: f64,
    jitter: f64,
) -> Option<Vec2> {
    let base = math::atan2(self_at.y - threat.y, self_at.x - threat.x) + jitter;
    for turn in crate::bots::kite::TURNS {
        for share in crate::bots::kite::LENGTHS {
            let a = base + turn;
            let p = Vec2::new(
                self_at.x + math::cos(a) * step_u * share,
                self_at.y + math::sin(a) * step_u * share,
            );
            if ctx.paths.clear(&ctx.p.self_, PathArg::Point(p)) {
                return Some(p);
            }
        }
    }
    None
}

// ------------------------------------------------------------------------------------------------------------- orb-walk

/// A walk-away whose lock never dropped (the move was lost) is given up on after this long.
const AWAY_TAKE_MS: f64 = 900.;
/// An orb-walk cycle that has not locked again by now is over: the ordinary lock logic takes the fight back.
const AWAY_MAX_MS: f64 = 3000.;
/// The re-lock lands this long before the cooldown ends, so the server attacks the moment it can.
const RELOCK_LEAD_MS: f64 = 100.;
/// Walking off needs cooldown left to walk in: a step's delay and the uplink to land, and the re-lock goes out early.
const MIN_WALK_MS: f64 = 100.;
/// A readyAt that rose by less than this share of the cooldown was a swap's penalty or a chill stretching it.
const NEW_SHOT_SHARE: f64 = 0.9;
/// Uplink and the wait for the next step between a click and the server applying it (docs/BOTS.md 2.1).
const APPLY_LAG_MS: f64 = 55.;

/// The source OrbWalk's foe argument: `{ id, x, y }`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct OrbFoe<'a> {
    pub id: &'a str,
    pub x: f64,
    pub y: f64,
}
impl OrbFoe<'_> {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// Source `OrbWalk.step`'s answer: an intent, "wait" (the step is on its way), or null (play the lock as usual).
pub(crate) enum OrbStep {
    Wait,
    Order(Intent),
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Shoot,
    Away,
}

/// Source createOrbWalk: retained cycle phase/timers/counter.
pub(crate) struct OrbWalk {
    cycle_ready: f64,
    phase: Phase,
    away_at: f64,
    applied: bool,
    cycles: u64,
}

impl OrbWalk {
    pub(crate) fn new() -> Self {
        Self {
            cycle_ready: f64::INFINITY,
            phase: Phase::Shoot,
            away_at: 0.,
            applied: false,
            cycles: 0,
        }
    }

    /// Source `orb.reset(readyAt)`: a new engagement; the shots already fired are not cycles.
    pub(crate) fn reset(&mut self, ready_at: f64) {
        self.cycle_ready = ready_at;
        self.phase = Phase::Shoot;
        self.applied = false;
    }

    /// Source `orb.step(ctx, foe, weapon, locked)`.
    pub(crate) fn step(
        &mut self,
        ctx: &mut TacticsContext<'_>,
        foe: OrbFoe<'_>,
        weapon: WeaponId,
        locked: bool,
    ) -> OrbStep {
        let now = ctx.p.now;
        let self_ = ctx.p.self_.clone();
        if self.phase == Phase::Away {
            if !self.applied {
                if !locked {
                    self.applied = true;
                } else if now - self.away_at > AWAY_TAKE_MS {
                    self.phase = Phase::Shoot;
                    return OrbStep::None;
                } else {
                    return OrbStep::Wait;
                }
            }
            if locked || now - self.away_at > AWAY_MAX_MS {
                self.phase = Phase::Shoot;
                return OrbStep::None;
            }
            return OrbStep::Order(Intent {
                body: IntentBody::Lock {
                    target: foe.id.to_string(),
                    at: Vec2::new(foe.x, foe.y),
                },
                priority: priority::COMBAT,
                timing: IntentTiming::Timed {
                    due: (self_.ready_at - RELOCK_LEAD_MS).max(now),
                },
                why: "orb-walk re-lock at the cooldown".into(),
            });
        }
        let Some(t) = own_timings(&self_, weapon) else {
            return OrbStep::None;
        };
        if !locked || self_.ready_at <= self.cycle_ready {
            return OrbStep::None;
        }
        if self_.ready_at - self.cycle_ready < t.interval_ms * NEW_SHOT_SHARE {
            self.cycle_ready = self_.ready_at;
            return OrbStep::None;
        }
        let launch_at = self_.ready_at - t.interval_ms + t.windup_ms;
        if now < launch_at || (weapon == WeaponId::Bow && self_.draw_started_at > 0.) {
            // Still winding up: a move now would cancel the shot.
            return OrbStep::None;
        }
        // This shot has left; whether the bot walks after it or not, it is settled.
        self.cycle_ready = self_.ready_at;
        let tier = ctx.cfg.tier;
        if self_.ready_at - now < tier.step.mean() + APPLY_LAG_MS + MIN_WALK_MS + RELOCK_LEAD_MS {
            // Nearly over: stand and shoot again.
            return OrbStep::None;
        }
        let o = tier.orbwalk;
        let jitter = (ctx.decide.draw() * 2.0 - 1.0) * o.angle_jitter;
        let Some(to) = away_point(ctx, self_.pos(), foe.pos(), o.step_u, jitter) else {
            // Cornered: stand and trade.
            return OrbStep::None;
        };
        self.phase = Phase::Away;
        self.away_at = now;
        self.applied = false;
        self.cycles += 1;
        OrbStep::Order(Intent {
            body: IntentBody::Move {
                to: RouteElement::Point(to),
            },
            priority: priority::COMBAT,
            timing: IntentTiming::Step {},
            why: "orb-walk: step away after the shot".into(),
        })
    }

    pub(crate) fn cycles(&self) -> u64 {
        self.cycles
    }
}

// ------------------------------------------------------------------------------------------------------------- reflexes

/// The sidestep a dodge must make to be clear of a ball (BOTS.md 2.6: hit reach plus the body), and the step it takes.
const RANGED_HIT_REACH: f64 = PLAYER_RADIUS + RANGED_SLACK;
const SIDESTEP_U: f64 = RANGED_HIT_REACH + PLAYER_RADIUS;
const DODGE_U: f64 = 32.;
/// The juke's step: enough to put an arrow's lead in the wrong place.
const JUKE_U: f64 = 44.;
/// A projectile whose origin is this close to the bot was loosed from its own body.
const OWN_ORIGIN: f64 = 20.;
/// An arrow's release is read this far ahead; the juke lands this long after it.
const JUKE_AFTER_MS: f64 = 30.;
/// A shot is "at the bot" when it is this close and its aim line passes within JUKE_LATERAL u of it.
const JUKE_RANGE: f64 = 300.;
const JUKE_LATERAL: f64 = 60.;
const JUKE_WINDOW_MS: f64 = 1500.;
/// Decisions remembered (a projectile id, or a windup), oldest forgotten first.
const REMEMBER: usize = 48;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReflexKind {
    Dodge,
    Juke,
}
impl ReflexKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Dodge => "dodge",
            Self::Juke => "juke",
        }
    }
}

/// Source `Reflex`: the kind and the order intent (the hold time its kind sets is retained by the component).
pub(crate) struct Reflex {
    pub kind: ReflexKind,
    pub intent: Intent,
}

/// Source createReflexes: decision cache, order hold and counters.
pub(crate) struct Reflexes {
    decided: Vec<(String, bool)>,
    hold_until: f64,
    dodges: u64,
    jukes: u64,
}

/// Source `Course`: where a straight projectile will pass the bot, and how long it has.
struct Course {
    tti_ms: f64,
    offset: f64,
    nx: f64,
    ny: f64,
}

/// Source `Shot`: when a visible fighter's weapon will release, and where from / at what aim.
struct Shot {
    key: String,
    by: String,
    x: f64,
    y: f64,
    aim: f64,
    release_at: f64,
}

/// The smallest absolute difference of two angles (radians), source `angleGap`.
fn angle_gap(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % (2.0 * math::PI);
    if d > math::PI {
        2.0 * math::PI - d
    } else {
        d
    }
}

/// Source `course`: where a straight projectile will pass the bot, and how long it has; null when it is not coming
/// at it, or is its own.
fn course(pr: &TacticProjectile, self_: &TacticSelf, lag_ms: f64) -> Option<Course> {
    if pr.from.as_deref() == Some(self_.id.as_str())
        || source_hypot(pr.x0 - self_.x, pr.y0 - self_.y) < OWN_ORIGIN
    {
        return None;
    }
    let speed = source_hypot(pr.vx, pr.vy);
    if speed < 1. {
        return None;
    }
    let ux = pr.vx / speed;
    let uy = pr.vy / speed;
    let rx = self_.x - pr.x;
    let ry = self_.y - pr.y;
    let along = rx * ux + ry * uy;
    let offset = -rx * uy + ry * ux;
    let left = pr.range - source_hypot(pr.x - pr.x0, pr.y - pr.y0);
    if offset.abs() > SIDESTEP_U || along < 0. || along > left + RANGED_HIT_REACH {
        return None;
    }
    // The percept shows the ball where it was `lag_ms` ago.
    let tti_ms = (along / speed) * 1000. - lag_ms;
    if tti_ms > 0. {
        Some(Course {
            tti_ms,
            offset,
            nx: -uy,
            ny: ux,
        })
    } else {
        None
    }
}

/// A point `len` along the unit normal (nx, ny) on `side`, else on the other side; null when neither walk is clear.
fn side_step(
    ctx: &mut TacticsContext<'_>,
    at: Vec2,
    nx: f64,
    ny: f64,
    side: f64,
    len: f64,
) -> Option<Vec2> {
    for s in [side, -side] {
        let p = Vec2::new(at.x + nx * s * len, at.y + ny * s * len);
        if ctx.paths.clear(&ctx.p.self_, PathArg::Point(p)) {
            return Some(p);
        }
    }
    None
}

/// Source `aimedAt`: a shot this close whose aim line passes within JUKE_LATERAL u of the bot is at it.
fn aimed_at(from: Vec2, aim: f64, at: Vec2) -> bool {
    let d = dist(from, at);
    if d > JUKE_RANGE {
        return false;
    }
    let diff = angle_gap(aim, math::atan2(at.y - from.y, at.x - from.x));
    d < 1. || (diff < math::PI / 2. && d * math::sin(diff) <= JUKE_LATERAL)
}

/// Source `shots`'s bow row: one alive fighter/mob with a drawn bow is a shot about to leave.
#[allow(clippy::too_many_arguments)]
fn push_bow_shot(
    out: &mut Vec<Shot>,
    id: &str,
    status: &str,
    in_hand: Option<WeaponId>,
    draw_started_at: f64,
    faction: Option<FactionId>,
    x: f64,
    y: f64,
    aim: f64,
) {
    if status != "alive" || in_hand != Some(WeaponId::Bow) || draw_started_at <= 0. {
        return;
    }
    // Another fighter's mirrors are not drawn: its pull is read at base speed, which no ranged fighter's is ever
    // shorter than (G9).
    let windup_ms = match faction {
        Some(faction) => {
            crate::bots::kite::own_timings(Some(faction), BotWeapon::Bow, 1., Some(1.))
                .map_or(BOW_WINDUP_MAX_S * 1000., |t| t.windup_ms)
        }
        None => BOW_WINDUP_MAX_S * 1000.,
    };
    out.push(Shot {
        key: format!("{}@{}", id, number_string(draw_started_at)),
        by: id.to_string(),
        x,
        y,
        aim,
        release_at: draw_started_at + windup_ms,
    });
}

/// Source `shots`: bow draws in sight (the pull is drawn) and wand windups announced since the last percept: when
/// each shot will leave.
fn shots(ctx: &TacticsContext<'_>) -> Vec<Shot> {
    let p = ctx.p;
    let mut out = Vec::new();
    for f in &p.fighters {
        push_bow_shot(
            &mut out,
            &f.id,
            &f.status,
            f.in_hand,
            f.draw_started_at,
            f.faction,
            f.x,
            f.y,
            f.facing,
        );
    }
    for m in &p.mobs {
        push_bow_shot(
            &mut out,
            &m.id,
            &m.status,
            m.in_hand,
            m.draw_started_at,
            m.faction,
            m.x,
            m.y,
            m.facing,
        );
    }
    for e in &p.events {
        let TacticEventKind::Windup { by, weapon, a, ms } = &e.kind else {
            continue;
        };
        if *weapon != WeaponId::Wand || by == &p.self_.id {
            continue;
        }
        let who = p
            .fighters
            .iter()
            .find(|f| &f.id == by)
            .map(|f| (f.x, f.y))
            .or_else(|| p.mobs.iter().find(|m| &m.id == by).map(|m| (m.x, m.y)));
        let Some((x, y)) = who else {
            continue;
        };
        out.push(Shot {
            key: format!("{}@{}", by, number_string(e.t)),
            by: by.clone(),
            x,
            y,
            aim: *a,
            release_at: e.t + *ms,
        });
    }
    out
}

impl Reflexes {
    pub(crate) fn new() -> Self {
        Self {
            decided: Vec::new(),
            hold_until: 0.,
            dodges: 0,
            jukes: 0,
        }
    }

    fn has(&self, key: &str) -> bool {
        self.decided.iter().any(|(k, _)| k == key)
    }

    /// Source `remember`: a Map set (re-inserting moves the key to the back), oldest forgotten beyond REMEMBER.
    fn remember(&mut self, key: String, yes: bool) {
        if let Some(index) = self.decided.iter().position(|(k, _)| *k == key) {
            self.decided.remove(index);
        }
        self.decided.push((key, yes));
        if self.decided.len() > REMEMBER {
            self.decided.remove(0);
        }
    }

    /// Source `reflexes.check(ctx)`: at most one reflex per call; a dodge outranks a juke.
    pub(crate) fn check(&mut self, ctx: &mut TacticsContext<'_>) -> Option<Reflex> {
        let found = match self.dodge(ctx) {
            Some(found) => Some(found),
            None => {
                if ctx.p.now < self.hold_until {
                    None
                } else {
                    self.juke(ctx)
                }
            }
        };
        match found {
            Some((reflex, hold_until)) => {
                self.hold_until = hold_until;
                Some(reflex)
            }
            None => None,
        }
    }

    /// Source `dodge`: a sidestep of an incoming ball, with the order hold its kind sets.
    fn dodge(&mut self, ctx: &mut TacticsContext<'_>) -> Option<(Reflex, f64)> {
        let tier = ctx.cfg.tier;
        if tier.dodge_p <= 0. {
            return None;
        }
        let now = ctx.p.now;
        let lag_ms = (now - ctx.p.view_t).max(0.);
        let count = ctx.p.projectiles.len();
        for index in 0..count {
            let pr = &ctx.p.projectiles[index];
            if self.has(&pr.id) {
                continue;
            }
            let Some(c) = course(pr, &ctx.p.self_, lag_ms) else {
                continue;
            };
            // A ball seen for the first time is answered at the reaction time; one the bot was already watching,
            // at a plan's step.
            let stim = ctx.mem.stimuli().into_iter().find(|s| {
                s.kind == StimulusKind::Incoming && s.subject.as_deref() == Some(pr.id.as_str())
            });
            let lead = if stim.is_some() {
                tier.reaction.mean()
            } else {
                tier.step.mean()
            };
            let walk_ms = (SIDESTEP_U / (PLAYER_SPEED * ctx.p.self_.speed_mult.max(0.3))) * 1000.;
            if c.tti_ms < lead + APPLY_LAG_MS + walk_ms {
                self.remember(pr.id.clone(), false);
                continue;
            }
            let yes = ctx.decide.draw() < tier.dodge_p;
            self.remember(pr.id.clone(), yes);
            if !yes {
                continue;
            }
            let side = if c.offset >= 0. { 1. } else { -1. };
            let kind = pr.kind;
            let self_at = ctx.p.self_.pos();
            let Some(to) = side_step(ctx, self_at, c.nx, c.ny, side, DODGE_U) else {
                continue;
            };
            self.dodges += 1;
            let timing = match stim {
                Some(stimulus) => IntentTiming::React { stimulus },
                None => IntentTiming::Step {},
            };
            let hold_until = now + lead + walk_ms + 200.;
            return Some((
                Reflex {
                    kind: ReflexKind::Dodge,
                    intent: Intent {
                        body: IntentBody::Move {
                            to: RouteElement::Point(to),
                        },
                        priority: priority::REFLEX,
                        timing,
                        why: format!("sidestep an incoming {}", kind.as_str()),
                    },
                },
                hold_until,
            ));
        }
        None
    }

    /// Source `juke`: a shot about to leave a visible fighter's weapon at the bot, timed to land just after release.
    fn juke(&mut self, ctx: &mut TacticsContext<'_>) -> Option<(Reflex, f64)> {
        let tier = ctx.cfg.tier;
        if tier.juke_p <= 0. {
            return None;
        }
        let now = ctx.p.now;
        let me = ctx.p.self_.pos();
        let shots = shots(ctx);
        for shot in shots {
            if self.has(&shot.key) {
                continue;
            }
            let due = shot.release_at + JUKE_AFTER_MS;
            if due <= now || due - now > JUKE_WINDOW_MS {
                self.remember(shot.key.clone(), false);
                continue;
            }
            let from = Vec2::new(shot.x, shot.y);
            if !aimed_at(from, shot.aim, me) {
                continue;
            }
            if ctx
                .mem
                .fighter(&shot.by)
                .is_some_and(|known| known.feints > 0)
                && tier.feint_read > 0.
                && ctx.decide.draw() < tier.feint_read
            {
                self.remember(shot.key.clone(), false);
                continue;
            }
            let yes = ctx.decide.draw() < tier.juke_p;
            self.remember(shot.key.clone(), yes);
            if !yes {
                continue;
            }
            let bearing = math::atan2(me.y - shot.y, me.x - shot.x);
            let side = if ctx.decide.draw() < 0.5 { 1. } else { -1. };
            let Some(to) = side_step(
                ctx,
                me,
                -math::sin(bearing),
                math::cos(bearing),
                side,
                JUKE_U,
            ) else {
                continue;
            };
            self.jukes += 1;
            let hold_until = due + 450.;
            return Some((
                Reflex {
                    kind: ReflexKind::Juke,
                    intent: Intent {
                        body: IntentBody::Move {
                            to: RouteElement::Point(to),
                        },
                        priority: priority::REFLEX,
                        timing: IntentTiming::Timed { due },
                        why: "juke the shot as it leaves".into(),
                    },
                },
                hold_until,
            ));
        }
        None
    }

    pub(crate) fn hold_until(&self) -> f64 {
        self.hold_until
    }
    pub(crate) fn dodges(&self) -> u64 {
        self.dodges
    }
    pub(crate) fn jukes(&self) -> u64 {
        self.jukes
    }
}

// -------------------------------------------------------------------------------------------------------------- retreat

/// A walk to a retreat point is kept this long, then chosen again from where the threats are now.
const RETREAT_KEEP_MS: f64 = 1200.;
const RETREAT_ARRIVED: f64 = 48.;

/// Source createRetreat: the retained destination and its chosen-at time.
pub(crate) struct Retreat {
    dest: Option<Vec2>,
    at: f64,
}

impl Retreat {
    pub(crate) fn new() -> Self {
        Self { dest: None, at: 0. }
    }

    pub(crate) fn reset(&mut self) {
        self.dest = None;
    }

    /// Source `retreat.point(ctx, threats)`: mobHunt's retreatPoint kept while it still leads away; None when
    /// cornered. The candidate geometry is the source `retreatPoint` loop; `walkable` is the path service's clear
    /// check with the observed SelfView as the source argument.
    pub(crate) fn point(&mut self, ctx: &mut TacticsContext<'_>, threats: &[Vec2]) -> Option<Vec2> {
        let now = ctx.p.now;
        let self_pos = ctx.p.self_.pos();
        if let Some(dest) = self.dest {
            if now - self.at < RETREAT_KEEP_MS && dist(self_pos, dest) > RETREAT_ARRIVED {
                let mut near_me = f64::INFINITY;
                let mut near_dest = f64::INFINITY;
                for threat in threats {
                    near_me = near_me.min(dist(*threat, self_pos));
                    near_dest = near_dest.min(dist(*threat, dest));
                }
                if near_dest >= near_me {
                    return Some(dest);
                }
            }
        }
        // Source mobHunt.retreatPoint: the walkable point among sixteen headings at two distances that ends
        // farthest from the nearest threat; none when nothing is walkable.
        self.dest = if threats.is_empty() {
            None
        } else {
            let mut best: Option<Vec2> = None;
            let mut best_score = f64::NEG_INFINITY;
            for step in [7. * TILE, 4. * TILE] {
                for i in 0..16 {
                    let angle = (i as f64) * math::PI / 8.;
                    let at = Vec2::new(
                        self_pos.x + math::cos(angle) * step,
                        self_pos.y + math::sin(angle) * step,
                    );
                    if !ctx.paths.clear(&ctx.p.self_, PathArg::Point(at)) {
                        continue;
                    }
                    let mut nearest = f64::INFINITY;
                    for threat in threats {
                        nearest = nearest.min(dist(at, *threat));
                    }
                    let score = nearest.min(1e6) + step * 0.25;
                    if score > best_score {
                        best_score = score;
                        best = Some(at);
                    }
                }
            }
            best
        };
        self.at = now;
        self.dest
    }
}
