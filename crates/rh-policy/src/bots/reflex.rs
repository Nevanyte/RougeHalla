//! Standalone source Reflexes component. These are declared method facts, not a delivered-frame adapter.
//! Complete public fact publication, source Memory production and live activation are separately gated.
use super::kite::{angle_gap, own_timings, projectile_course, Course, CourseFacts};
use super::paths::RoomPathService;
use super::random::Rng;
use super::types::{
    BotWeapon, Intent, IntentBody, IntentTiming, Stimulus, StimulusKind, TierId, TierParams,
    PRIORITY_REFLEX,
};
use rh_sim::constants::{BOW_WINDUP_MAX_S, PLAYER_RADIUS, PLAYER_SPEED, RANGED_SLACK};
use rh_sim::mapgen::certify::source_hypot;
use rh_sim::mapgen::map_hash::number_string;
use rh_sim::{math, FactionId, Vec2};
use std::collections::VecDeque;

/// Unavailable is never an empty collection, an empty hand, a null faction or a zero clock.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fact<T> {
    Known(T),
    Unavailable,
}
impl<T: Copy> Fact<T> {
    fn get(self) -> Result<T, Refusal> {
        match self {
            Self::Known(v) => Ok(v),
            Self::Unavailable => Err(Refusal::MissingFacts),
        }
    }
}

/// Equality token in a declared method input. It is NOT a private actor ID, public handle or live adapter.
/// Source keys deliberately share one string space; a projectile token may equal an actor@time token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MethodKey(pub String);

/// Caller-owned component lifecycle tokens, not delivered namespaces or exposed World counters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scope {
    pub session: u64,
    pub epoch: u64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Clocks {
    pub now: f64,
    pub view_time: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Owner {
    pub key: MethodKey,
    pub at: Vec2,
    pub speed_mult: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectileKind {
    Ball,
    Arrow,
}
impl ProjectileKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ball => "ball",
            Self::Arrow => "arrow",
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Projectile {
    pub key: MethodKey,
    pub kind: ProjectileKind,
    /// Includes explicit ownership equality; no missing origin/range/ownership default is supplied.
    pub course: Fact<CourseFacts>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Actor {
    pub key: MethodKey,
    pub at: Vec2,
    pub alive: bool,
    pub facing: f64,
    pub hand: Fact<Option<BotWeapon>>,
    pub draw_started_at: Fact<f64>,
    /// Known(None) is the actual source base-Bow fallback, distinct from an unavailable faction.
    pub faction: Fact<Option<FactionId>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct WandWindup {
    pub by: MethodKey,
    pub at: f64,
    pub duration_ms: f64,
    pub aim: f64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerFeints {
    pub key: MethodKey,
    /// From the actual Memory Windup→Cancel producer, never inferred from the actor's current hand.
    pub count: u64,
}
/// Complete chronological component facts. No Frame/wire/World constructor is provided.
pub struct Frame<'a> {
    pub scope: Scope,
    pub clocks: Fact<Clocks>,
    pub owner: Fact<&'a Owner>,
    pub projectiles: Fact<&'a [Projectile]>,
    pub players: Fact<&'a [Actor]>,
    pub mobs: Fact<&'a [Actor]>,
    /// Ordered Wand-only projection of the complete source event stream; own/unseen cues are retained.
    pub wand_windups: Fact<&'a [WandWindup]>,
    /// The genuine current Memory stimuli, including the original incoming stimulus payload.
    pub stimuli: Fact<&'a [Stimulus]>,
    /// Complete player FighterMemory feint rows; mobs do not acquire a fabricated player record.
    pub player_feints: Fact<&'a [PlayerFeints]>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    WrongScope,
    WrongOwner,
    MissingFacts,
    InvalidFacts,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Dodge,
    Juke,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Reflex {
    pub kind: Kind,
    pub intent: Intent,
    pub hold_until: f64,
}
/// Narrow forwarding seam for observing actual path calls in parity tests. Production uses RoomPathService.
pub trait Paths {
    fn clear(&mut self, from: Vec2, to: Vec2) -> bool;
}
impl Paths for RoomPathService {
    fn clear(&mut self, from: Vec2, to: Vec2) -> bool {
        RoomPathService::clear(self, from, to)
    }
}

const REMEMBER: usize = 48;
const SIDESTEP_U: f64 = PLAYER_RADIUS + RANGED_SLACK + PLAYER_RADIUS;
const APPLY_LAG_MS: f64 = 55.;

struct Shot {
    key: String,
    by: MethodKey,
    from: Vec2,
    aim: f64,
    due: f64,
}
struct Prepared<'a> {
    clocks: Clocks,
    owner: &'a Owner,
    projectiles: Vec<(&'a Projectile, Option<Course>)>,
    shots: Vec<Shot>,
    stimuli: &'a [Stimulus],
    feints: &'a [PlayerFeints],
    tier: &'static TierParams,
    walk_ms: f64,
}
fn finite(v: Vec2) -> bool {
    v.x.is_finite() && v.y.is_finite()
}
fn shot_key(actor: &MethodKey, at: f64) -> String {
    format!("{}@{}", actor.0, number_string(at))
}
fn prepared<'a>(frame: Frame<'a>, tier: TierId) -> Result<Prepared<'a>, Refusal> {
    let clocks = frame.clocks.get()?;
    let owner = frame.owner.get()?;
    let projectiles = frame.projectiles.get()?;
    let players = frame.players.get()?;
    let mobs = frame.mobs.get()?;
    let windups = frame.wand_windups.get()?;
    let stimuli = frame.stimuli.get()?;
    let feints = frame.player_feints.get()?;
    if !clocks.now.is_finite()
        || !clocks.view_time.is_finite()
        || !finite(owner.at)
        || !owner.speed_mult.is_finite()
        || stimuli
            .iter()
            .any(|s| !s.at.is_finite() || s.value.is_some_and(|v| !v.is_finite()))
    {
        return Err(Refusal::InvalidFacts);
    }
    let tier = TierParams::by_id(tier);
    let lag = (clocks.now - clocks.view_time).max(0.);
    let walk_ms = (SIDESTEP_U / (PLAYER_SPEED * owner.speed_mult.max(0.3))) * 1000.;
    if !lag.is_finite()
        || !walk_ms.is_finite()
        || !(clocks.now + tier.reaction.mean() + walk_ms + 200.).is_finite()
        || !(clocks.now + tier.step.mean() + walk_ms + 200.).is_finite()
    {
        return Err(Refusal::InvalidFacts);
    }
    // All availability, geometry and computed-time validation completes before decisions, RNG or paths.
    let projectiles = projectiles
        .iter()
        .map(|p| {
            let facts = p.course.get()?;
            let course =
                projectile_course(facts, owner.at, lag).map_err(|_| Refusal::InvalidFacts)?;
            if course.is_some_and(|c| {
                ![c.tti_ms, c.offset, c.nx, c.ny]
                    .iter()
                    .all(|v| v.is_finite())
            }) {
                return Err(Refusal::InvalidFacts);
            }
            Ok((p, course))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut shots = Vec::new();
    for actor in players.iter().chain(mobs) {
        let hand = actor.hand.get()?;
        let draw = actor.draw_started_at.get()?;
        let faction = actor.faction.get()?;
        if !finite(actor.at)
            || !finite(Vec2::new(actor.at.x - owner.at.x, actor.at.y - owner.at.y))
            || !actor.facing.is_finite()
            || !draw.is_finite()
        {
            return Err(Refusal::InvalidFacts);
        }
        if !actor.alive || hand != Some(BotWeapon::Bow) || draw <= 0. {
            continue;
        }
        let windup_ms = faction.map_or(BOW_WINDUP_MAX_S * 1000., |f| {
            own_timings(Some(f), BotWeapon::Bow, 1., Some(1.))
                .expect("known faction timing")
                .windup_ms
        });
        let due = draw + windup_ms + 30.;
        if !due.is_finite() || !(due + 450.).is_finite() {
            return Err(Refusal::InvalidFacts);
        }
        shots.push(Shot {
            key: shot_key(&actor.key, draw),
            by: actor.key.clone(),
            from: actor.at,
            aim: actor.facing,
            due,
        });
    }
    for cue in windups {
        if ![cue.at, cue.duration_ms, cue.aim]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err(Refusal::InvalidFacts);
        }
        let due = cue.at + cue.duration_ms + 30.;
        if !due.is_finite() || !(due + 450.).is_finite() {
            return Err(Refusal::InvalidFacts);
        }
        if cue.by == owner.key {
            continue;
        }
        if let Some(actor) = players.iter().chain(mobs).find(|a| a.key == cue.by) {
            shots.push(Shot {
                key: shot_key(&cue.by, cue.at),
                by: cue.by.clone(),
                from: actor.at,
                aim: cue.aim,
                due,
            });
        }
    }
    Ok(Prepared {
        clocks,
        owner,
        projectiles,
        shots,
        stimuli,
        feints,
        tier,
        walk_ms,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reflexes {
    scope: Scope,
    owner: MethodKey,
    decided: VecDeque<(String, bool)>,
    hold_until: f64,
    dodges: u64,
    jukes: u64,
}
impl Reflexes {
    pub fn new(scope: Scope, owner: MethodKey) -> Self {
        Self {
            scope,
            owner,
            decided: VecDeque::new(),
            hold_until: 0.,
            dodges: 0,
            jukes: 0,
        }
    }
    /// A new session/epoch/owner clears all retained identities, choices, hold and counters.
    pub fn reset(&mut self, scope: Scope, owner: MethodKey) {
        *self = Self::new(scope, owner);
    }
    pub fn hold_until(&self) -> f64 {
        self.hold_until
    }
    pub fn dodges(&self) -> u64 {
        self.dodges
    }
    pub fn jukes(&self) -> u64 {
        self.jukes
    }
    fn has(&self, key: &str) -> bool {
        self.decided.iter().any(|(k, _)| k == key)
    }
    fn remember(&mut self, key: String, yes: bool) {
        self.decided.retain(|(k, _)| *k != key);
        self.decided.push_back((key, yes));
        if self.decided.len() > REMEMBER {
            self.decided.pop_front();
        }
    }
    pub fn check<P: Paths>(
        &mut self,
        frame: Frame<'_>,
        tier: TierId,
        paths: &mut P,
        decide: &mut Rng,
    ) -> Result<Option<Reflex>, Refusal> {
        if frame.scope != self.scope {
            return Err(Refusal::WrongScope);
        }
        if frame.owner.get()?.key != self.owner {
            return Err(Refusal::WrongOwner);
        }
        let p = prepared(frame, tier)?;
        let found = self.dodge(&p, paths, decide).or_else(|| {
            if p.clocks.now < self.hold_until {
                None
            } else {
                self.juke(&p, paths, decide)
            }
        });
        if let Some(reflex) = &found {
            self.hold_until = reflex.hold_until;
        }
        Ok(found)
    }
    fn dodge<P: Paths>(
        &mut self,
        p: &Prepared<'_>,
        paths: &mut P,
        decide: &mut Rng,
    ) -> Option<Reflex> {
        if p.tier.dodge_p <= 0. {
            return None;
        }
        for (projectile, course) in &p.projectiles {
            if self.has(&projectile.key.0) {
                continue;
            }
            let Some(course) = course else {
                continue;
            };
            let stimulus = p.stimuli.iter().find(|s| {
                s.kind == StimulusKind::Incoming
                    && s.subject.as_deref() == Some(projectile.key.0.as_str())
            });
            let lead = if stimulus.is_some() {
                p.tier.reaction.mean()
            } else {
                p.tier.step.mean()
            };
            if course.tti_ms < lead + APPLY_LAG_MS + p.walk_ms {
                self.remember(projectile.key.0.clone(), false);
                continue;
            }
            let yes = decide.next_f64() < p.tier.dodge_p;
            self.remember(projectile.key.0.clone(), yes);
            if !yes {
                continue;
            }
            let side = if course.offset >= 0. { 1. } else { -1. };
            let Some(to) = side_step(paths, p.owner.at, course.nx, course.ny, side, 32.) else {
                continue;
            };
            self.dodges += 1;
            return Some(Reflex {
                kind: Kind::Dodge,
                hold_until: p.clocks.now + lead + p.walk_ms + 200.,
                intent: Intent {
                    body: IntentBody::Move { to },
                    priority: PRIORITY_REFLEX,
                    timing: stimulus.map_or(IntentTiming::Step {}, |s| IntentTiming::React {
                        stimulus: s.clone(),
                    }),
                    why: format!("sidestep an incoming {}", projectile.kind.as_str()),
                },
            });
        }
        None
    }
    fn juke<P: Paths>(
        &mut self,
        p: &Prepared<'_>,
        paths: &mut P,
        decide: &mut Rng,
    ) -> Option<Reflex> {
        if p.tier.juke_p <= 0. {
            return None;
        }
        for shot in &p.shots {
            if self.has(&shot.key) {
                continue;
            }
            if shot.due <= p.clocks.now || shot.due - p.clocks.now > 1500. {
                self.remember(shot.key.clone(), false);
                continue;
            }
            if !aimed_at(shot.from, shot.aim, p.owner.at) {
                continue;
            }
            if p.feints
                .iter()
                .find(|f| f.key == shot.by)
                .is_some_and(|f| f.count > 0)
                && p.tier.feint_read > 0.
                && decide.next_f64() < p.tier.feint_read
            {
                self.remember(shot.key.clone(), false);
                continue;
            }
            let yes = decide.next_f64() < p.tier.juke_p;
            self.remember(shot.key.clone(), yes);
            if !yes {
                continue;
            }
            let bearing = math::atan2(p.owner.at.y - shot.from.y, p.owner.at.x - shot.from.x);
            let side = if decide.next_f64() < 0.5 { 1. } else { -1. };
            let Some(to) = side_step(
                paths,
                p.owner.at,
                -math::sin(bearing),
                math::cos(bearing),
                side,
                44.,
            ) else {
                continue;
            };
            self.jukes += 1;
            return Some(Reflex {
                kind: Kind::Juke,
                hold_until: shot.due + 450.,
                intent: Intent {
                    body: IntentBody::Move { to },
                    priority: PRIORITY_REFLEX,
                    timing: IntentTiming::Timed { due: shot.due },
                    why: "juke the shot as it leaves".into(),
                },
            });
        }
        None
    }
}
fn side_step<P: Paths>(
    paths: &mut P,
    at: Vec2,
    nx: f64,
    ny: f64,
    side: f64,
    len: f64,
) -> Option<Vec2> {
    for sign in [side, -side] {
        let to = Vec2::new(at.x + nx * sign * len, at.y + ny * sign * len);
        if paths.clear(at, to) {
            return Some(to);
        }
    }
    None
}
fn aimed_at(from: Vec2, aim: f64, at: Vec2) -> bool {
    // Source Math.hypot uses scaled compensation: one ulp decides the literal lateral60 guard.
    let d = source_hypot(from.x - at.x, from.y - at.y);
    if d > 300. {
        return false;
    }
    let diff =
        angle_gap(aim, math::atan2(at.y - from.y, at.x - from.x)).expect("preflight finite angles");
    d < 1. || (diff < math::PI / 2. && d * math::sin(diff) <= 60.)
}

#[cfg(test)]
mod tests;
