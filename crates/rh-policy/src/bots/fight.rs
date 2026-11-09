//! Source visible-player normal-fight component, deliberately NOT live HumanBot dispatch.
//! Frame inputs are declared method facts, not an accepted-frame receipt or a claim that
//! missing remote windup/projectile facts mean no reflex. Full cue publication is held by Root.
use super::brain::{Output, Status as GoalStatus};
use super::delivered::{Epoch, PlayerRef};
use super::kite::own_timings;
use super::knowledge::Knowledge;
use super::memory_prefix::{Memory, OwnerSight, PlayerSight, Scene, MAX_RECORDS};
use super::orbwalk::{OrbWalk, Step};
use super::paths::RoomPathService;
use super::random::Rng;
use super::types::{
    BotWeapon, Command, Intent, IntentBody, IntentTiming, PersonaParams, Stimulus, StimulusKind,
    TierId, TierParams, TimedCommand, PRIORITY_COMBAT, PRIORITY_GOAL,
};
use super::world_tactics::{Context as WorldContext, WorldTactics};
use rh_sim::{content, FactionId, Status, Vec2, WeaponId};

pub fn key(id: PlayerRef) -> String {
    format!("p{}", id.get())
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lock {
    Clear,
    Held { target: Option<PlayerRef> },
}
#[derive(Clone, Debug, PartialEq)]
pub struct Owner {
    pub id: PlayerRef,
    pub at: Vec2,
    pub status: Status,
    /// Exact owner HUD facts supplied by the caller; never inferred from a missing owner row.
    pub hp: f64,
    pub max_hp: f64,
    pub faction: Option<FactionId>,
    /// None is unavailable, not an available empty hand.
    pub inventory: Option<[Option<BotWeapon>; 2]>,
    pub slot: u8,
    pub lock: Option<Lock>,
    pub ready_at: f64,
    pub draw_started_at: f64,
    pub as_mult: f64,
    pub windup_mult: Option<f64>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SeenPlayer {
    pub id: PlayerRef,
    pub at: Vec2,
    pub velocity: Vec2,
    pub status: Status,
    pub faction: FactionId,
    pub weapon: Option<BotWeapon>,
    pub hp_frac: f64,
    pub targetable: bool,
    pub bounty: u32,
}
/// Normal-component method input only. There is intentionally no Frame14 constructor.
/// A future live adapter must prove actual source Reflexes==null and no retained hold.
pub struct Frame<'a> {
    pub epoch: Epoch,
    pub viewer: PlayerRef,
    pub now: f64,
    pub view_time: f64,
    pub owner: Option<&'a Owner>,
    pub players: &'a [SeenPlayer],
    pub in_coliseum: bool,
    pub sudden_death_at: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    OwnerUnavailable,
    InventoryUnavailable,
    LockUnavailable,
    InvalidFacts,
    Memory,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Goal {
    Idle,
    Fight(PlayerRef),
}
pub struct Context<'a> {
    pub tier: &'a TierParams,
    pub persona: &'a PersonaParams,
    pub know: &'a Knowledge,
    pub paths: &'a mut RoomPathService,
    pub decide: &'a mut Rng,
}
#[derive(Clone, Debug, PartialEq)]
struct Progress {
    id: PlayerRef,
    best: f64,
    hp: f64,
    since: f64,
}
#[derive(Clone, Debug, PartialEq)]
struct Plan {
    id: PlayerRef,
    at: f64,
    goal: Vec2,
    points: Option<Vec<Vec2>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Fight {
    orb: OrbWalk,
    engagement: Option<(PlayerRef, bool)>,
    last_fight_at: f64,
    progress: Option<Progress>,
    plan: Option<Plan>,
    no_path: f64,
    last_move: Option<(Vec2, f64)>,
    next_swap_at: f64,
    sd_hold: bool,
    held: bool,
    retreat: retreat::Retreat,
}
impl Default for Fight {
    fn default() -> Self {
        Self {
            orb: OrbWalk::default(),
            engagement: None,
            last_fight_at: f64::NEG_INFINITY,
            progress: None,
            plan: None,
            no_path: 0.,
            last_move: None,
            next_swap_at: 0.,
            sd_hold: false,
            held: false,
            retreat: retreat::Retreat::default(),
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Dropped {
    id: PlayerRef,
    at: f64,
    intentional: bool,
}
pub struct NormalTactics {
    tier: TierId,
    memory: Memory,
    fight: Fight,
    world: WorldTactics,
    knows_sudden_death: Option<bool>,
    previous_target: Option<PlayerRef>,
    dropped: Option<Dropped>,
    previous_coliseum: Option<bool>,
}
impl NormalTactics {
    pub fn new(epoch: Epoch, viewer: PlayerRef, tier: TierId) -> Self {
        Self {
            tier,
            memory: Memory::new(epoch, viewer, tier, MAX_RECORDS)
                .expect("fixed valid memory limit"),
            fight: Fight::default(),
            world: WorldTactics::default(),
            knows_sudden_death: None,
            previous_target: None,
            dropped: None,
            previous_coliseum: None,
        }
    }
    /// Explicit lifecycle reset drops every retained engagement/identity, shot, timer and belief.
    pub fn reset(&mut self, epoch: Epoch, viewer: PlayerRef, tier: TierId) {
        *self = Self::new(epoch, viewer, tier);
    }
    pub fn kite_cycles(&self) -> u64 {
        self.fight.orb.cycles()
    }
    pub fn note_sent(&mut self, command: &TimedCommand) {
        self.memory.note_sent(command);
    }
    pub fn act(
        &mut self,
        frame: Frame<'_>,
        goal: Goal,
        ctx: Context<'_>,
    ) -> Result<Output, Refusal> {
        let Context {
            tier,
            persona,
            know,
            paths,
            decide,
        } = ctx;
        let me = frame.owner.ok_or(Refusal::OwnerUnavailable)?;
        me.inventory.ok_or(Refusal::InventoryUnavailable)?;
        let target = match me.lock.ok_or(Refusal::LockUnavailable)? {
            Lock::Clear => None,
            Lock::Held { target: Some(id) } => Some(id),
            Lock::Held { target: None } => return Err(Refusal::LockUnavailable),
        };
        if tier.id != self.tier
            || me.id != frame.viewer
            || me.slot > 1
            || !frame.now.is_finite()
            || !frame.view_time.is_finite()
            || ![
                me.at.x,
                me.at.y,
                me.ready_at,
                me.draw_started_at,
                me.as_mult,
                me.hp,
                me.max_hp,
            ]
            .iter()
            .all(|n| n.is_finite())
            || me.windup_mult.is_some_and(|n| !n.is_finite())
            || !frame.sudden_death_at.is_finite()
            || frame
                .players
                .iter()
                .any(|p| ![p.velocity.x, p.velocity.y].iter().all(|v| v.is_finite()))
        {
            return Err(Refusal::InvalidFacts);
        }
        let players: Vec<_> = frame
            .players
            .iter()
            .map(|p| PlayerSight {
                id: p.id,
                at: p.at,
                faction: p.faction,
                in_hand: p.weapon.map(weapon_id),
                hp_share: p.hp_frac,
                bounty: p.bounty,
                status: p.status,
                hidden: false,
            })
            .collect();
        let scene = Scene {
            epoch: frame.epoch,
            viewer: frame.viewer,
            now: frame.now,
            owner: Some(OwnerSight {
                at: me.at,
                status: me.status,
            }),
            players: &players,
        };
        self.memory
            .check_scene(scene)
            .map_err(|_| Refusal::Memory)?;
        self.memory
            .observe_scene(scene)
            .map_err(|_| Refusal::Memory)?;
        let mut stimuli = self.memory.stimuli().to_vec();
        self.fold_lock(&frame, target, &mut stimuli, tier.attention.central);
        if matches!(me.status, Status::Dead | Status::Mia) {
            // This normal method input has no announcements; source filters all other spectator stimuli.
            stimuli.clear();
        }
        // Source tactics.ts draws this before ANY first goal, including idle/world dispatch.
        self.knows_sudden_death
            .get_or_insert_with(|| decide.next_f64() < tier.knowledge);
        let still_since = self.memory.own_motion().expect("checked owner").still_since;
        match goal {
            Goal::Idle => {
                self.fight.leave();
                Ok(self
                    .world
                    .act(
                        &super::brain::Goal::Idle,
                        WorldContext {
                            now: frame.now,
                            at: me.at,
                            still_since,
                        },
                        |a, b| paths.walk(a, b).is_some(),
                    )
                    .expect("idle is a world goal"))
            }
            Goal::Fight(id) => Ok(self.fight.act(
                FightInput {
                    frame: &frame,
                    me,
                    target,
                    id,
                    memory: &self.memory,
                    stimuli: &stimuli,
                    still_since,
                    knows_sudden_death: self.knows_sudden_death.expect("source one-time draw"),
                },
                Context {
                    tier,
                    persona,
                    know,
                    paths,
                    decide,
                },
            )),
        }
    }
    fn fold_lock(
        &mut self,
        frame: &Frame<'_>,
        target: Option<PlayerRef>,
        stimuli: &mut Vec<Stimulus>,
        central_share: f64,
    ) {
        let flip = self
            .previous_coliseum
            .is_some_and(|old| old != frame.in_coliseum);
        self.previous_coliseum = Some(frame.in_coliseum);
        if self.previous_target.is_some() && target != self.previous_target {
            let intentional = self.memory.last_order().is_some_and(|t| {
                matches!(t.cmd, Command::Move { .. } | Command::Stop { .. })
                    && frame.now - t.at <= 1000.
            });
            self.dropped = if target.is_none() {
                self.previous_target.map(|id| Dropped {
                    id,
                    at: frame.now,
                    intentional,
                })
            } else {
                None
            };
        }
        self.previous_target = target;
        if target.is_some() || flip {
            self.dropped = None;
        }
        let Some(d) = self.dropped.clone() else {
            return;
        };
        let seen = frame.players.iter().find(|f| f.id == d.id);
        let down = seen.is_some_and(|f| f.status != Status::Alive)
            || self
                .memory
                .records()
                .iter()
                .any(|r| r.id == d.id && !r.alive);
        let kind = if down {
            Some(StimulusKind::TargetDown)
        } else if d.intentional {
            None
        } else if seen.is_some_and(|f| {
            f.hp_frac > 0.15 || frame.now - d.at >= (frame.now - frame.view_time).max(0.) + 60.
        }) {
            Some(StimulusKind::LockLost)
        } else {
            if frame.now - d.at > 1500. {
                self.dropped = None;
            }
            return;
        };
        self.dropped = None;
        if !d.intentional {
            if let Some(kind) = kind {
                stimuli.push(Stimulus {
                    kind,
                    at: if kind == StimulusKind::LockLost {
                        d.at
                    } else {
                        frame.now
                    },
                    subject: Some(key(d.id)),
                    central: seen.is_some_and(|f| {
                        central(f.at, frame.owner.expect("checked owner").at, central_share)
                    }),
                    value: None,
                });
            }
        }
    }
}
fn central(at: Vec2, own: Vec2, share: f64) -> bool {
    (at.x - own.x).abs() <= super::types::BOT_VIEW_HALF_W * share
        && (at.y - own.y).abs() <= super::types::BOT_VIEW_HALF_H * share
}
fn dist(a: Vec2, b: Vec2) -> f64 {
    rh_sim::math::hypot(a.x - b.x, a.y - b.y)
}
pub(super) fn weapon_id(w: BotWeapon) -> WeaponId {
    WeaponId::parse(w.as_str()).expect("all BotWeapon variants are catalog weapons")
}
fn react_or(stimuli: &[Stimulus], kinds: &[StimulusKind], id: PlayerRef) -> IntentTiming {
    let id = key(id);
    stimuli
        .iter()
        .find(|s| {
            kinds.contains(&s.kind) && (s.subject.as_deref() == Some(&id) || s.subject.is_none())
        })
        .map_or(IntentTiming::Step {}, |s| IntentTiming::React {
            stimulus: s.clone(),
        })
}
fn output(
    intent: Option<Intent>,
    status: GoalStatus,
    why: &'static str,
    attacking: bool,
) -> Output {
    Output {
        intents: intent.into_iter().collect(),
        status,
        why,
        attacking,
    }
}
#[derive(Clone)]
struct Foe {
    id: PlayerRef,
    at: Vec2,
    velocity: Vec2,
    dist: f64,
    los: bool,
    hp: f64,
    weapon: Option<BotWeapon>,
    seen: bool,
    targetable: bool,
}
struct FightInput<'a, 'b> {
    frame: &'a Frame<'b>,
    me: &'a Owner,
    target: Option<PlayerRef>,
    id: PlayerRef,
    memory: &'a Memory,
    stimuli: &'a [Stimulus],
    still_since: f64,
    knows_sudden_death: bool,
}
impl Fight {
    pub fn leave(&mut self) {
        self.last_move = None;
        self.held = false;
        self.plan = None;
    }
    fn act(&mut self, input: FightInput<'_, '_>, ctx: Context<'_>) -> Output {
        let FightInput {
            frame,
            me,
            target,
            id,
            memory,
            stimuli,
            still_since,
            knows_sudden_death,
        } = input;
        let mut ctx = ctx;
        let tier = ctx.tier;
        let persona = ctx.persona;
        if me.status != Status::Alive {
            return output(None, GoalStatus::Failed, "not alive", false);
        }
        if me.faction.is_none() {
            return output(None, GoalStatus::Failed, "no faction yet", false);
        }
        let inventory = me.inventory.expect("preflight inventory");
        let slot = usize::from(me.slot);
        if inventory[slot].is_none() && inventory[1 - slot].is_some() {
            return output(
                Some(Intent {
                    body: IntentBody::Swap {
                        slot: (1 - slot) as u8,
                    },
                    priority: PRIORITY_COMBAT,
                    timing: IntentTiming::Step {},
                    why: "empty hand".into(),
                }),
                GoalStatus::Running,
                "taking the other weapon",
                false,
            );
        }
        let weapon = inventory[slot].unwrap_or(BotWeapon::Fists);
        let foe = if let Some(f) = frame.players.iter().find(|f| f.id == id) {
            if f.status != Status::Alive {
                self.engagement = None;
                return output(None, GoalStatus::Done, "target down", false);
            }
            Foe {
                id,
                at: f.at,
                velocity: f.velocity,
                dist: dist(me.at, f.at),
                los: ctx.paths.los(me.at, f.at),
                hp: f.hp_frac,
                weapon: f.weapon,
                seen: true,
                targetable: f.targetable,
            }
        } else if let Some(r) = memory.records().iter().find(|r| r.id == id) {
            if !r.alive {
                self.engagement = None;
                return output(None, GoalStatus::Done, "target down", false);
            }
            let Some(w) = memory.whereabouts(id) else {
                return output(None, GoalStatus::Failed, "lost track of the target", false);
            };
            Foe {
                id,
                at: w.at,
                velocity: Vec2::new(0., 0.),
                dist: dist(me.at, w.at),
                los: ctx.paths.los(me.at, w.at),
                hp: memory
                    .hp_belief(id)
                    .expect("known record")
                    .source_estimate(),
                weapon: r.in_hand.and_then(|w| BotWeapon::parse(w.as_str())),
                seen: false,
                targetable: true,
            }
        } else {
            self.engagement = None;
            return output(None, GoalStatus::Done, "target down", false);
        };
        let now = frame.now;
        if self.engagement.is_none_or(|e| e.0 != id) || now - self.last_fight_at > 4000. {
            self.engagement = Some((id, ctx.decide.next_f64() < tier.orbwalk.p * persona.kite));
            self.progress = None;
            self.plan = None;
            self.no_path = 0.;
            self.last_move = None;
            self.held = false;
            self.sd_hold = false;
            self.orb.reset(me.ready_at);
        }
        self.last_fight_at = now;
        let locked = target == Some(id);
        let spec = content::weapon(weapon_id(weapon));
        let (far, attack_range, mask) = match spec.shape {
            content::Shape::Arc { reach, .. } => (
                reach * 0.85,
                reach + rh_sim::constants::PLAYER_RADIUS - 6.,
                rh_sim::map::MASK_MELEE,
            ),
            content::Shape::Projectile { range, .. } if weapon == BotWeapon::Wand => {
                (range * 0.88, range * 0.96, rh_sim::map::MASK_SIGHT)
            }
            content::Shape::Projectile { range, .. } => {
                (range * (400. / 480.), range * 0.92, rh_sim::map::MASK_SIGHT)
            }
        };
        let in_reach = foe.los
            && (mask == rh_sim::map::MASK_SIGHT
                || rh_sim::geometry::has_line_of_sight(
                    ctx.paths.collision_map(),
                    me.at,
                    foe.at,
                    mask,
                ));
        let attacking = (locked || weapon != BotWeapon::Wand)
            && foe.seen
            && in_reach
            && foe.dist <= attack_range + 24.;
        let swap = self.swap(&mut ctx, now, me, &foe, weapon, stimuli);
        let Context { paths, decide, .. } = ctx;
        let finish = |mut out: Output| {
            if let Some(s) = swap.clone() {
                out.intents.push(s);
            }
            out
        };
        // Source fight.ts: actual public HP shares and clock; no inferred hidden enemy stats.
        let sd_on = knows_sudden_death
            && frame.sudden_death_at > 0.
            && now >= frame.sudden_death_at
            && foe.seen;
        if sd_on {
            let mine = if me.max_hp > 0. {
                me.hp / me.max_hp
            } else {
                1.
            };
            let lead = mine - foe.hp;
            self.sd_hold = if self.sd_hold {
                lead > -0.02
            } else {
                lead > 0.02
            };
        } else {
            self.sd_hold = false;
        }
        if self.sd_hold {
            if let Some(progress) = self.progress.as_mut() {
                progress.since = now;
            }
            if foe.dist < 340. {
                if let Some(to) = self.retreat.point(now, me.at, foe.at, paths) {
                    self.last_move = None;
                    self.held = false;
                    return finish(output(
                        Some(Intent {
                            body: IntentBody::Move { to },
                            priority: PRIORITY_COMBAT,
                            timing: react_or(stimuli, &[StimulusKind::NewThreat], id),
                            why: "sudden death: ahead, keeping distance".into(),
                        }),
                        GoalStatus::Running,
                        "sudden death: keeping distance",
                        false,
                    ));
                }
                // A real failed retreat falls through to the ordinary fight, just as source does.
            } else {
                if self.held {
                    return finish(output(
                        None,
                        GoalStatus::Running,
                        "sudden death: keeping distance",
                        false,
                    ));
                }
                self.held = true;
                self.last_move = None;
                return finish(output(
                    Some(Intent {
                        body: IntentBody::Stop {},
                        priority: PRIORITY_COMBAT,
                        timing: IntentTiming::Step {},
                        why: "sudden death: ahead, standing off".into(),
                    }),
                    GoalStatus::Running,
                    "sudden death: keeping distance",
                    false,
                ));
            }
        }
        if self.progress.as_ref().is_some_and(|p| p.id != id) {
            self.progress = None;
        }
        if let Some(p) = self.progress.as_mut() {
            if attacking || foe.dist < p.best - 40. || foe.hp < p.hp - 0.001 {
                p.best = p.best.min(foe.dist);
                p.hp = foe.hp;
                p.since = now;
            } else if now - p.since > 10_000. {
                self.progress = None;
                return finish(output(
                    None,
                    GoalStatus::Failed,
                    "no progress in 10 s",
                    false,
                ));
            }
        } else {
            self.progress = Some(Progress {
                id,
                best: foe.dist,
                hp: foe.hp,
                since: now,
            });
        }
        if self.engagement.is_some_and(|e| e.1)
            && foe.seen
            && matches!(weapon, BotWeapon::Bow | BotWeapon::Wand)
            && melee_chaser(me, &foe)
        {
            match self.orb.step(
                super::orbwalk::Context {
                    now,
                    owner: me,
                    tier,
                    paths,
                    decide,
                },
                id,
                foe.at,
                weapon,
                locked,
            ) {
                Step::Wait => {
                    return finish(output(
                        None,
                        GoalStatus::Running,
                        "orb-walk: stepping off",
                        false,
                    ))
                }
                Step::Order(i) => {
                    self.last_move = None;
                    self.held = false;
                    return finish(output(Some(i), GoalStatus::Running, "orb-walk", false));
                }
                Step::Ordinary => {}
            }
        }
        if locked && weapon == BotWeapon::Wand {
            return finish(output(
                None,
                GoalStatus::Running,
                "locked: the server is fighting",
                attacking,
            ));
        }
        let reach = if weapon == BotWeapon::Wand {
            rh_sim::constants::TARGET_RANGE - 40.
        } else {
            far
        };
        let toward = !foe.seen || foe.dist > reach || (weapon != BotWeapon::Wand && !in_reach);
        if !toward && !foe.targetable {
            return finish(output(
                None,
                GoalStatus::Running,
                "target cannot be clicked now",
                false,
            ));
        }
        let mut to = foe.at;
        if !foe.los {
            if !self
                .plan
                .as_ref()
                .is_some_and(|p| p.id == id && now - p.at < 400. && dist(p.goal, foe.at) < 96.)
            {
                let points = paths.path(me.at, foe.at).filter(|p| !p.is_empty());
                self.no_path = if points.is_some() {
                    0.
                } else {
                    self.no_path + 1.
                };
                self.plan = Some(Plan {
                    id,
                    at: now,
                    goal: foe.at,
                    points,
                });
            }
            let Some(points) = self.plan.as_ref().and_then(|p| p.points.as_ref()) else {
                return finish(output(
                    None,
                    if self.no_path >= 3. {
                        GoalStatus::Failed
                    } else {
                        GoalStatus::Running
                    },
                    if self.no_path >= 3. {
                        "no path to the target"
                    } else {
                        "looking for a way to the target"
                    },
                    false,
                ));
            };
            if toward {
                let mut best = None;
                for q in points {
                    let d = dist(me.at, *q);
                    if d <= 24. {
                        continue;
                    }
                    if best.is_none() {
                        best = Some(*q);
                    }
                    if d > 520. {
                        break;
                    }
                    if paths.clear(me.at, *q) {
                        best = Some(*q);
                    }
                }
                to = best.unwrap_or(foe.at);
            }
        }
        if toward {
            let mut intent = None;
            if !self.last_move.is_some_and(|(old, at)| {
                dist(old, to) < 48.
                    && now - at < 1500.
                    && !(now - still_since > 700. && now - at > 700.)
            }) {
                self.last_move = Some((to, now));
                self.held = false;
                intent = Some(Intent {
                    body: IntentBody::Move { to },
                    priority: PRIORITY_GOAL,
                    timing: react_or(stimuli, &[StimulusKind::NewThreat], id),
                    why: if foe.seen {
                        "approach"
                    } else {
                        "go to where it was last seen"
                    }
                    .into(),
                });
            }
            return finish(output(intent, GoalStatus::Running, "approaching", false));
        }
        self.last_move = None;
        self.held = false;
        let wand = weapon == BotWeapon::Wand;
        finish(output(
            Some(Intent {
                body: IntentBody::Lock {
                    target: key(id),
                    at: foe.at,
                },
                priority: PRIORITY_COMBAT,
                timing: react_or(
                    stimuli,
                    &[
                        StimulusKind::LockLost,
                        StimulusKind::ClickMissed,
                        StimulusKind::OrderFailed,
                        StimulusKind::TargetDown,
                        StimulusKind::NewThreat,
                    ],
                    id,
                ),
                why: if wand {
                    "lock the foe"
                } else {
                    "click an aimed attack"
                }
                .into(),
            }),
            GoalStatus::Running,
            if wand { "locking" } else { "attacking" },
            !wand && attacking,
        ))
    }
    fn swap(
        &mut self,
        ctx: &mut Context<'_>,
        now: f64,
        me: &Owner,
        foe: &Foe,
        weapon: BotWeapon,
        stimuli: &[Stimulus],
    ) -> Option<Intent> {
        let know = ctx.know;
        let theirs = foe.weapon?;
        if now < self.next_swap_at || me.draw_started_at > 0. || !foe.seen || foe.dist > 600. {
            return None;
        }
        if own_timings(me.faction, weapon, me.as_mult, me.windup_mult)
            .is_some_and(|t| now < me.ready_at - t.interval_ms + t.windup_ms)
        {
            return None;
        }
        let slot = usize::from(me.slot);
        let inventory = me.inventory.expect("checked inventory");
        let next = inventory[1 - slot]?;
        let current = inventory[slot];
        if current.is_some_and(|w| {
            super::mob_hunt::weapon_edge(weapon_id(next), weapon_id(theirs))
                <= super::mob_hunt::weapon_edge(weapon_id(w), weapon_id(theirs))
        }) || know.weapon_edge(next, theirs) <= know.weapon_edge(weapon, theirs)
        {
            return None;
        }
        self.next_swap_at = now + 2000. + ctx.decide.next_f64() * 2000.;
        Some(Intent {
            body: IntentBody::Swap {
                slot: (1 - slot) as u8,
            },
            priority: PRIORITY_COMBAT,
            timing: react_or(
                stimuli,
                &[StimulusKind::FoeSwapped, StimulusKind::NewThreat],
                foe.id,
            ),
            why: format!(
                "{} -> {} against {}",
                weapon.as_str(),
                next.as_str(),
                theirs.as_str()
            ),
        })
    }
}
fn melee_chaser(me: &Owner, foe: &Foe) -> bool {
    if foe
        .weapon
        .is_none_or(|w| matches!(w, BotWeapon::Bow | BotWeapon::Wand))
        || foe.dist > 380.
    {
        return false;
    }
    let closing = ((me.at.x - foe.at.x) * foe.velocity.x + (me.at.y - foe.at.y) * foe.velocity.y)
        / foe.dist.max(1.);
    let speed = rh_sim::math::hypot(foe.velocity.x, foe.velocity.y);
    let source_chasing = speed >= 20. && foe.dist >= 1. && closing >= 20. && closing / speed > 0.7;
    closing > 40. || foe.dist < 260. || source_chasing
}

mod retreat;
#[cfg(test)]
mod source_tests;
