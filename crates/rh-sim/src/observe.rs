//! Three views of a match, kept apart on purpose (docs/CONTRACTS.md C-OBS):
//!
//! * the full authoritative state: [`crate::Sim`] itself (server-only; secrets, inputs, runtime);
//! * the public snapshot: [`public_snapshot`], what anyone may see of the match with no secrets (replays, spectators, results);
//! * the per-player observation: [`observe`], exactly what that player can legitimately perceive. The live server replicates
//!   THIS to each client (interest management) and future policies receive THIS, so humans, scripted bots and learned
//!   policies decide from the same information.
//!
//! Other actors appear at their current position only within the living viewer’s direct sight or unexpired tile trail. They are
//! sorted by public id, never by join order, action order or hidden state; counts are counts of visible things; events are
//! filtered by what the observer could see; nothing derived from a secret stream is included.

use crate::content::{FactionId, WeaponId};
use crate::events::{Class, Visibility};
use crate::sight::SightCache;
use crate::sim::{Event, Phase, PlayerId, Sim, Status};
use crate::state::Player;
use crate::vision::{actor_with, scene_line_blocked};

pub const OBSERVATION_VERSION: u16 = 20;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SelfView {
    pub wish: Option<crate::abilities::OwnerView>,
    pub effects: u16,
    pub displace_seq: u8,
    pub mark_tier: u8,
    pub brand: u8,
    pub mark_by: Option<PlayerId>,
    pub mark_tax: u8,
    pub sig: u8,
    /// The owner’s attack lock, when that actor is also visible in this frame.
    pub attack_target: Option<PlayerId>,
    pub id: PlayerId,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    /// Widened source-f32 barrier, never a private deadline or decay flag.
    pub barrier: f64,
    pub barrier_ring_step: u8,
    pub status: Status,
    pub weapon: WeaponId,
    /// Milliseconds until the next attack may start (0 when ready).
    pub ready_in_ms: f64,
    pub kills: u32,
    pub bounty: u32,
    pub gv: u32,
    /// The last movement order number the server applied (prediction ack).
    pub move_seq: u8,
    /// The Sentenced hunt selection and completed-hunt count (self only; legacy `huntTarget`/`huntStacks`).
    pub hunt_target: Option<PlayerId>,
    pub hunt_stacks: u32,
    pub corpse_stacks: u16,
    pub plague_zombie: Option<PlayerId>,
}

/// Native actor identity; public protocol tags are checked by the server adapter.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum ActorKind {
    Player,
    Regional,
    Zombie,
    Dummy,
    QuestGiver,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ActorView {
    /// Kind 0 preserves human IDs; kind 1 uses the delivering observer's NPC reference namespace.
    pub kind: ActorKind,
    pub mob_type: Option<crate::mob_catalog::MobTypeId>,
    pub effects: u16,
    pub displace_seq: u8,
    pub mark_tier: u8,
    pub brand: u8,
    pub mark_by: Option<PlayerId>,
    pub mark_tax: u8,
    pub sig: u8,
    /// The Plague owner of a kind-2 companion; None for players and regional mobs.
    pub owner: Option<PlayerId>,
    pub id: PlayerId,
    pub faction: crate::fighter::FighterAffiliation,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    /// Combined-bar share in source twentieths, with a positive sliver.
    pub hp_frac: f64,
    pub barrier_frac: f64,
    /// Human ring cue (0..=8); NPCs have no source barrier cue.
    pub barrier_ring_step: u8,
    pub status: Status,
    pub weapon: Option<WeaponId>,
    pub bounty: u32,
}

/// An event the observer could perceive.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SeenEvent {
    Teleported,
    Plan(crate::PlanView),
    MobArmed {
        weapon: WeaponId,
    },
    CampCleared {
        camp: u32,
    },
    PotionNotice {
        notice: crate::potions::Notice,
    },
    /// The training console's owner-only notice (legacy `toast`); text is the source's exact message.
    Toast {
        text: String,
    },
    /// A private travel-cannon notice (sealed, still reloading, cannot enter, or the blast).
    CannonNotice {
        notice: crate::events::CannonNotice,
    },
    /// A wind emblem was walked over (the fixed "+50% movement for 5s" feedback).
    WindEmblem,
    ChestRefused {
        reason: crate::reward_chests::Refusal,
    },
    AbilityHit {
        victim: PlayerId,
        by: Option<PlayerId>,
        ability: crate::status_runtime::AbilityId,
        amount: f64,
    },
    CastStarted {
        event_time: f64,
        id: PlayerId,
        ability: crate::status_runtime::AbilityId,
        ms: f64,
        target: Option<PlayerId>,
        at: Option<crate::Vec2>,
    },
    CastLanded {
        event_time: f64,
        /// An unseen caster does not suppress a permitted spatial impact.
        id: Option<PlayerId>,
        ability: crate::status_runtime::AbilityId,
        target: Option<PlayerId>,
        at: Option<crate::Vec2>,
        to: Option<crate::Vec2>,
    },
    CastEnded {
        event_time: f64,
        id: PlayerId,
        ability: crate::status_runtime::AbilityId,
        reason: crate::status_runtime::CastEndReason,
    },
    StatusApplied {
        id: PlayerId,
        kind: crate::status_runtime::StatusKind,
        ms: f64,
        by: Option<PlayerId>,
    },
    SignatureHit {
        victim: PlayerId,
        by: Option<PlayerId>,
        sig: crate::factions::SignatureKind,
        weapon: Option<WeaponId>,
        amount: f64,
    },
    Block {
        id: PlayerId,
        by: Option<PlayerId>,
        weapon: WeaponId,
    },
    Heal {
        id: PlayerId,
        amount: f64,
    },
    AttackCancelled {
        id: PlayerId,
    },
    Stagger {
        id: PlayerId,
    },
    PickupRefused {
        reason: crate::PickupRefusal,
    },
    Swing {
        by: PlayerId,
        weapon: WeaponId,
        x: f64,
        y: f64,
        a: f64,
    },
    Hit {
        victim: PlayerId,
        /// Absent for an unseen source or for damage dealt by the arena.
        by: Option<PlayerId>,
        amount: f64,
        passive: bool,
    },
    Death {
        id: PlayerId,
        by: Option<PlayerId>,
    },
    Bounty {
        id: PlayerId,
        bounty: u32,
    },
    Ended {
        winner: Option<PlayerId>,
        draw: bool,
    },
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Observation {
    /// Seat-local quest facts; None when quests are disabled or viewer is ineligible.
    pub quests: Option<crate::quest_view::QuestView>,
    /// Own saved trade state plus the merchants this viewer can actually see.
    pub trade: Option<crate::traders::TradeView>,
    pub arena: Option<crate::ArenaView>,
    pub plan: Option<crate::PlanningView>,
    pub projectiles: Vec<crate::ProjectileView>,
    pub reward_chests: Vec<crate::reward_chests::RewardChestView>,
    pub build: Option<crate::reward_chests::BuildView>,
    pub version: u16,
    /// The source's public training fact (a training room is a practice world: no run, no results).
    pub training: bool,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub me: Option<SelfView>,
    pub inventory: Option<crate::Inventory>,
    pub props: Vec<crate::VisibleProp>,
    pub fields: Vec<crate::status_runtime::FieldView>,
    pub visible: Vec<ActorView>,
    pub camps: Vec<crate::mob_runtime::CampRoster>,
    pub events: Vec<SeenEvent>,
}

impl SeenEvent {
    /// How a client receives this: the same declaration as the [`Event`] it came from (a test holds them equal). No
    /// wildcard arm, on purpose.
    pub fn class(&self) -> Class {
        match self {
            SeenEvent::Plan(..) => Class::Important,
            SeenEvent::Teleported => Class::Fx,
            SeenEvent::Death { .. } | SeenEvent::Bounty { .. } | SeenEvent::Ended { .. } => {
                Class::Important
            }
            SeenEvent::AbilityHit { .. }
            | SeenEvent::CastStarted { .. }
            | SeenEvent::CastLanded { .. }
            | SeenEvent::CastEnded { .. }
            | SeenEvent::StatusApplied { .. }
            | SeenEvent::SignatureHit { .. }
            | SeenEvent::Swing { .. }
            | SeenEvent::Hit { .. }
            | SeenEvent::Block { .. }
            | SeenEvent::Heal { .. }
            | SeenEvent::AttackCancelled { .. }
            | SeenEvent::Stagger { .. } => Class::Fx,
            SeenEvent::PickupRefused { .. }
            | SeenEvent::ChestRefused { .. }
            | SeenEvent::MobArmed { .. }
            | SeenEvent::CampCleared { .. }
            | SeenEvent::PotionNotice { .. }
            | SeenEvent::Toast { .. }
            | SeenEvent::CannonNotice { .. }
            | SeenEvent::WindEmblem => Class::Important,
        }
    }
}

/// What an observer is shown of `e`, after the actor/spatial permission gate in `filter_events`.
/// Exhaustive, no wildcard: a new [`Event`] variant must say here whether it reaches observers at all.
fn to_seen(e: &Event, can_see: &impl Fn(PlayerId) -> bool, points: [bool; 2]) -> Option<SeenEvent> {
    match *e {
        Event::Plan { ref plan, .. } => Some(SeenEvent::Plan(plan.clone())),
        Event::PlanningStarted => None,
        Event::Teleported => Some(SeenEvent::Teleported),
        Event::MobArmed { weapon, .. } => Some(SeenEvent::MobArmed { weapon }),
        Event::CampCleared { camp } => Some(SeenEvent::CampCleared { camp }),
        Event::PotionNotice { notice, .. } => Some(SeenEvent::PotionNotice { notice }),
        Event::Toast { ref text, .. } => Some(SeenEvent::Toast { text: text.clone() }),
        Event::CannonNotice { notice, .. } => Some(SeenEvent::CannonNotice { notice }),
        Event::WindEmblem { .. } => Some(SeenEvent::WindEmblem),
        Event::ChestRefused { reason, .. } => Some(SeenEvent::ChestRefused { reason }),
        Event::ChestTaken { .. } => None,
        Event::Swing {
            by,
            weapon,
            x,
            y,
            a,
        } => Some(SeenEvent::Swing {
            by,
            weapon,
            x,
            y,
            a,
        }),
        Event::Hit {
            victim,
            by,
            amount,
            passive,
            ..
        } => Some(SeenEvent::Hit {
            victim,
            by: by.filter(|&source| can_see(source)),
            amount,
            passive,
        }),
        Event::Block { id, by, weapon, .. } => Some(SeenEvent::Block {
            id,
            by: can_see(by).then_some(by),
            weapon,
        }),
        Event::CastStarted {
            event_time,
            id,
            ability,
            ms,
            target,
            x,
            y,
        } => Some(SeenEvent::CastStarted {
            event_time,
            id,
            ability,
            ms,
            target: target.filter(|id| can_see(*id)),
            at: target
                .map_or(points[0], can_see)
                .then_some(crate::Vec2::new(x, y)),
        }),
        Event::CastLanded {
            event_time,
            id,
            ability,
            target,
            x,
            y,
            to,
        } => {
            let id = can_see(id).then_some(id);
            let at_allowed = target.map_or(points[0], can_see);
            let target = target.filter(|id| can_see(*id));
            // Unit-target coordinates follow the actor verdict, never the visibility of its ground tile.
            // Blaze art is a pair, including its connecting streak; a single visible endpoint is not art.
            let (at, to) = if ability == crate::status_runtime::AbilityId::Blaze {
                if at_allowed && points[1] && to.is_some() {
                    (Some(crate::Vec2::new(x, y)), to)
                } else {
                    (None, None)
                }
            } else {
                (at_allowed.then_some(crate::Vec2::new(x, y)), None)
            };
            // Target identity alone cannot describe an anonymous spatial effect.
            (id.is_some() || at.is_some()).then_some(SeenEvent::CastLanded {
                event_time,
                id,
                ability,
                target,
                at,
                to,
            })
        }
        Event::CastEnded {
            event_time,
            id,
            ability,
            reason,
        } => Some(SeenEvent::CastEnded {
            event_time,
            id,
            ability,
            reason,
        }),
        Event::StatusApplied { id, kind, ms, by } => Some(SeenEvent::StatusApplied {
            id,
            kind,
            ms,
            by: by.filter(|&id| can_see(id)),
        }),
        Event::Heal { id, amount } => Some(SeenEvent::Heal { id, amount }),
        Event::AttackCancelled { id } => Some(SeenEvent::AttackCancelled { id }),
        Event::Stagger { id } => Some(SeenEvent::Stagger { id }),
        Event::PickupRefused {
            reason,
            target_visible,
            ..
        } => {
            let reason = if target_visible || reason == crate::PickupRefusal::Blocked {
                reason
            } else {
                crate::PickupRefusal::NothingThere
            };
            Some(SeenEvent::PickupRefused { reason })
        }
        Event::Death { id, by, .. } => Some(SeenEvent::Death {
            id,
            by: by.filter(|&source| can_see(source)),
        }),
        Event::Bounty { id, bounty } => Some(SeenEvent::Bounty { id, bounty }),
        Event::Victory { id, draw } => Some(SeenEvent::Ended { winner: id, draw }),
        Event::AbilityHit { .. }
        | Event::MarkNotice { .. }
        | Event::PlagueNotice { .. }
        | Event::SignatureHit { .. }
        | Event::ProjectileLaunched(_)
        | Event::ProjectileEnded { .. }
        | Event::RaidStarted
        | Event::Windup { .. }
        | Event::Gv { .. }
        | Event::RaidEnded
        | Event::Resolved { .. } => None,
    }
}

impl Default for Observation {
    /// An empty observation, for a buffer that [`observe_into`] fills.
    fn default() -> Self {
        Self {
            quests: None,
            trade: None,
            arena: None,
            plan: None,
            projectiles: Vec::new(),
            version: OBSERVATION_VERSION,
            training: false,
            tick: 0,
            server_time: 0.0,
            phase: Phase::Lobby,
            me: None,
            inventory: None,
            reward_chests: Vec::new(),
            build: None,
            props: Vec::new(),
            fields: Vec::new(),
            visible: Vec::new(),
            camps: Vec::new(),
            events: Vec::new(),
        }
    }
}

/// The same current line and private trail apply to full observations and event-only catch-up.
fn sees(sim: &Sim, me: &Player, other: &Player, cache: &mut Option<&mut SightCache>) -> bool {
    let map = sim.collision_view();
    let wards = crate::vision::WardSight::of_sim(sim);
    let a = me.pos();
    let b = other.pos();
    actor_with(map, me, other, sim.tick(), wards, || match cache {
        Some(c) => c.blocked(&map, me.id, other.id, a.x, a.y, b.x, b.y),
        None => scene_line_blocked(&map, a.x, a.y, b.x, b.y),
    })
}

/// Readies `cache` for a pass over `sim` (it drops entries computed on another arena).
fn begin(sim: &Sim, cache: &mut Option<&mut SightCache>) {
    if let Some(c) = cache {
        let k = &sim.k;
        c.begin(
            sim.collision_map() as *const crate::TileMap as usize,
            k.digest,
            sim.players().len(),
            u64::from(sim.tick()),
        );
    }
}

/// Freeze only the Wish cue's point permissions against this completed world. Unit-target visibility is checked
/// separately by `to_seen`; ownership permits own effect points but never a hidden unit target.
pub(crate) fn wish_point_permissions(
    k: &crate::statics::MatchStatic,
    w: &crate::state::World,
    viewer: PlayerId,
    event: &Event,
) -> [bool; 2] {
    let (id, at, to) = match *event {
        Event::CastStarted { id, x, y, .. } => (id, crate::Vec2::new(x, y), None),
        Event::CastLanded { id, x, y, to, .. } => (id, crate::Vec2::new(x, y), to),
        _ => return [false; 2],
    };
    if id == viewer {
        return [true, to.is_some()];
    }
    let Some(me) = w.players.iter().find(|p| p.id == viewer) else {
        return [false; 2];
    };
    let wards = crate::vision::WardSight::of(k, w);
    let visible = |point| {
        crate::vision::point_visible(
            k.collision_view(w.rt.gates_locked),
            me,
            point,
            w.tick,
            wards,
        )
    };
    [visible(at), to.is_some_and(visible)]
}

/// The events an observer is shown, in order. Ordinary events retain their declared actor visibility.
/// Wish landing is the named spatial exception: allowed geometry can survive an unseen caster.
/// `points` supplies per-event permissions from this step, including when a sealed report is used later.
pub(crate) fn filter_events(
    events: &[Event],
    me: Option<PlayerId>,
    can_see: impl Fn(PlayerId) -> bool,
    points: impl Fn(usize) -> [bool; 2],
    out: &mut Vec<SeenEvent>,
) {
    for (i, e) in events.iter().enumerate() {
        let shown = matches!(e, Event::CastLanded { .. })
            || match e.visibility() {
                Visibility::Everyone => true,
                Visibility::Owner(id) => Some(id) == me,
                Visibility::IfSeen(id) => can_see(id),
                Visibility::IfSeenOrBy { seen, by } => can_see(seen) || (by.is_some() && by == me),
                Visibility::ServerOnly => false,
            };
        if shown {
            if let Some(s) = to_seen(e, &can_see, points(i)) {
                out.push(s);
            }
        }
    }
}

/// Mark presentation uses current survivors, including between-step departures. Other stored bits
/// retain their source timing; projection never writes the private signature diagnostics.
fn projected_signature_bits(bits: u8, tier: u8) -> u8 {
    (bits & !crate::constants::SIG_EXEC_BLOCKED)
        | if tier >= crate::constants::MARK_TOP_TIER {
            crate::constants::SIG_EXEC_BLOCKED
        } else {
            0
        }
}

/// Checked disposable preview. Action-producing callers keep a persistent [`crate::ItemObserver`].
pub fn try_observe(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
) -> Result<Observation, crate::OfferError> {
    let mut out = Observation::default();
    try_observe_into(sim, viewer, events, &mut out)?;
    Ok(out)
}

/// Checked disposable preview into reusable scratch. On error the buffer is unspecified and MUST NOT
/// be delivered. No offer is committed on failure. Use a persistent ItemObserver for actionable views.
pub fn try_observe_into(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
) -> Result<(), crate::OfferError> {
    crate::ItemObserver::new(viewer).observe_into(sim, events, out, None)
}

/// Cached checked preview, with the same refusal and scratch-buffer contract as [`try_observe_into`].
pub fn try_observe_into_cached(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
    cache: &mut SightCache,
) -> Result<(), crate::OfferError> {
    crate::ItemObserver::new(viewer).observe_into(sim, events, out, Some(cache))
}

/// Trusted preview wrapper. Panics when the selected scene is not publicly representable.
/// Live/headless delivery uses checked persistent observers instead.
pub fn observe(sim: &Sim, viewer: PlayerId, events: &[Event]) -> Observation {
    try_observe(sim, viewer, events).expect("trusted observation is not publicly representable")
}

/// Trusted reusable preview wrapper; see [`observe`] and [`try_observe_into`].
pub fn observe_into(sim: &Sim, viewer: PlayerId, events: &[Event], out: &mut Observation) {
    try_observe_into(sim, viewer, events, out)
        .expect("trusted observation is not publicly representable");
}

/// Trusted cached preview wrapper; see [`try_observe_into_cached`].
pub fn observe_into_cached(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
    cache: &mut SightCache,
) {
    try_observe_into_cached(sim, viewer, events, out, cache)
        .expect("trusted observation is not publicly representable");
}

/// Source values after Math.fround, widened for JavaScript-number arithmetic and JSON publication.
struct PublicVitals {
    hp: f64,
    max_hp: f64,
    barrier: f64,
    hp_frac: f64,
    barrier_frac: f64,
    ring: u8,
}

fn source_f32(value: f64) -> Result<f64, crate::OfferError> {
    let rounded = value as f32;
    if !value.is_finite() || !rounded.is_finite() {
        return Err(crate::OfferError::UnrepresentablePublicVitals);
    }
    Ok(f64::from(rounded))
}

fn bar_share(value: f64) -> f64 {
    if !(value > 0.) {
        0.
    } else {
        crate::math::js_round(value * 20.).max(1.) / 20.
    }
}

fn public_vitals(hp: f64, max_hp: f64, barrier: f64) -> Result<PublicVitals, crate::OfferError> {
    if barrier < 0. {
        return Err(crate::OfferError::UnrepresentablePublicVitals);
    }
    let original_max = max_hp;
    let hp = source_f32(hp)?;
    let max_hp = source_f32(max_hp)?;
    let barrier = source_f32(barrier)?;
    // Source hpBarFractions: do not impose gameplay bounds or clamp barrier on publication.
    let h = if hp > 0. { hp } else { 0. };
    let b = if barrier > 0. { barrier } else { 0. };
    let total = (if max_hp > 0. { max_hp } else { 0. }).max(h + b);
    let (hp_frac, barrier_frac) = if total > 0. {
        (bar_share(h / total), bar_share(b / total))
    } else {
        (0., 0.)
    };
    // Human PlayerState.maxHp is float64; fighterSeen separately frounds it for bar shares.
    let strength = if barrier > 0. && original_max > 0. {
        (barrier / (original_max * 0.3)).min(1.)
    } else {
        0.
    };
    let ring = if strength > 0. {
        crate::math::js_round(strength * 8.).max(1.) as u8
    } else {
        0
    };
    Ok(PublicVitals {
        hp,
        max_hp,
        barrier,
        hp_frac,
        barrier_frac,
        ring,
    })
}

pub(crate) fn observe_with(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
    mut cache: Option<&mut SightCache>,
) -> Result<(), crate::OfferError> {
    begin(sim, &mut cache);
    let me = sim.player(viewer);
    let now = sim.server_time();
    out.quests = None;
    crate::traders::trade_view_into(sim, viewer, &mut out.trade)
        .map_err(crate::OfferError::Trades)?;
    out.projectiles.clear();
    out.reward_chests.clear();
    out.build = me.map(|p| crate::reward_chests::BuildView::from(&p.build));
    out.version = OBSERVATION_VERSION;
    out.training = sim.config().training;
    out.tick = sim.tick();
    out.server_time = now;
    out.phase = sim.phase();
    out.arena = crate::systems::planning::view::arena_view(&sim.k, &sim.w);
    out.plan = crate::systems::planning::view::owner_view(&sim.k, &sim.w, viewer);
    out.me = if let Some(p) = me {
        let vitals = public_vitals(p.vitals.hp, p.vitals.max_hp, p.vitals.barrier)?;
        Some(SelfView {
            wish: (sim.k.config.abilities == crate::abilities::Mode::Full)
                .then(|| crate::abilities::OwnerView::of(p, now, sim.k.config.training)),
            effects: p.statuses.effects,
            displace_seq: p.motion.displace_seq,
            mark_tier: crate::systems::sentenced::public_mark_tier(&sim.w, p.id),
            brand: crate::systems::sentenced::public_mark_tier(&sim.w, p.id) * 25,
            mark_by: None,
            mark_tax: 0,
            sig: projected_signature_bits(
                p.signature.bits,
                crate::systems::sentenced::public_mark_tier(&sim.w, p.id),
            ),
            attack_target: None,
            id: p.id,
            faction: p.faction(),
            x: p.body.x,
            y: p.body.y,
            facing: p.body.facing,
            hp: vitals.hp,
            max_hp: vitals.max_hp,
            barrier: vitals.barrier,
            barrier_ring_step: vitals.ring,
            status: p.status,
            weapon: p.active_weapon(),
            ready_in_ms: (p.weapon.ready_at - now).max(0.0),
            kills: p.credit.kills,
            bounty: p.credit.bounty,
            gv: p.credit.gv,
            move_seq: p.motion.move_seq,
            hunt_target: p.hunt_target(),
            hunt_stacks: u32::from(p.hunt_stacks),
            corpse_stacks: u16::from(p.farm.corpse_stacks()),
            plague_zombie: crate::systems::plague_zombies::zombie_of(&sim.w, p.id),
        })
    } else {
        None
    };
    out.camps.clear();
    out.camps.extend_from_slice(sim.camp_rosters());
    out.visible.clear();
    if let Some(m) = me {
        let map = sim.collision_view();
        let wards = crate::vision::WardSight::of_sim(sim);
        let (ax, ay) = (m.body.x, m.body.y);
        // Use the same actor verdict as the event-only pass; the table memoizes direct lines only.
        out.visible.reserve(sim.players().len());
        // Decided once per observation: a viewer that moved takes the plain traversal with no table in the loop.
        let probing = match &mut cache {
            Some(c) => c.probing(m.id, ax, ay),
            None => false,
        };
        for o in sim.players() {
            if o.id == m.id || o.status == Status::Lobby {
                continue;
            }
            if actor_with(map, m, o, sim.tick(), wards, || match &mut cache {
                Some(c) if probing => c.probe(&map, m.id, o.id, ax, ay, o.body.x, o.body.y),
                _ => scene_line_blocked(&map, ax, ay, o.body.x, o.body.y),
            }) {
                let vitals = public_vitals(o.vitals.hp, o.vitals.max_hp, o.vitals.barrier)?;
                out.visible.push(ActorView {
                    kind: ActorKind::Player,
                    owner: None,
                    mob_type: None,
                    effects: o.statuses.effects,
                    displace_seq: o.motion.displace_seq,
                    mark_tier: crate::systems::sentenced::public_mark_tier(&sim.w, o.id),
                    brand: crate::systems::sentenced::public_mark_tier(&sim.w, o.id) * 25,
                    mark_by: None,
                    mark_tax: 0,
                    sig: projected_signature_bits(
                        o.signature.bits,
                        crate::systems::sentenced::public_mark_tier(&sim.w, o.id),
                    ),
                    id: o.id,
                    faction: o.vitals.faction,
                    x: o.body.x,
                    y: o.body.y,
                    facing: o.body.facing,
                    hp_frac: vitals.hp_frac,
                    barrier_frac: vitals.barrier_frac,
                    barrier_ring_step: vitals.ring,
                    status: o.status,
                    weapon: Some(o.active_weapon()),
                    bounty: o.credit.bounty,
                });
            }
        }
    }
    // Public id order, never join order (a no-op scan when the store already iterates in id order).
    // Ids are unique, so any sort gives this order; the unstable one never allocates (the stable one does from ~85 entries).
    if let Some(me) = me {
        let wards = crate::vision::WardSight::of_sim(sim);
        for mob in sim.mobs() {
            if crate::vision::point_visible(
                sim.collision_view(),
                me,
                mob.core.pos(),
                sim.tick(),
                wards,
            ) && !crate::status_runtime::hidden(&mob.core.statuses.instances, now)
            {
                out.visible.push(mob_view(&sim.w, mob)?);
            }
        }
    }
    if !out.visible.is_sorted_by_key(|a| a.id) {
        out.visible.sort_unstable_by_key(|a| a.id);
    }
    crate::status_runtime::observe::project(sim, viewer, &out.visible, &mut out.fields);
    if let (Some(p), Some(view)) = (me, &mut out.me) {
        view.attack_target = p
            .weapon
            .targeting
            .target
            .filter(|id| out.visible.binary_search_by_key(id, |a| a.id).is_ok());
    }
    out.events.clear();
    let me_id = me.map(|m| m.id);
    let visible = &out.visible;
    // `visible` is sorted by id: a binary search instead of a scan per event.
    let can_see =
        |id: PlayerId| Some(id) == me_id || visible.binary_search_by_key(&id, |v| v.id).is_ok();
    if let Some(me) = &mut out.me {
        me.mark_by =
            crate::systems::sentenced::public_mark_by(&sim.w, me.id, me.mark_tier, can_see);
    }
    // Select only after visibility is settled; a hidden tied owner never suppresses a visible one.
    for i in 0..out.visible.len() {
        let actor = &out.visible[i];
        let by =
            crate::systems::sentenced::public_mark_by(&sim.w, actor.id, actor.mark_tier, |id| {
                Some(id) == me_id || out.visible.binary_search_by_key(&id, |a| a.id).is_ok()
            });
        out.visible[i].mark_by = by;
    }
    filter_events(
        events,
        me_id,
        |id| Some(id) == me_id || out.visible.binary_search_by_key(&id, |a| a.id).is_ok(),
        |i| wish_point_permissions(&sim.k, &sim.w, viewer, &events[i]),
        &mut out.events,
    );
    Ok(())
}

/// Trusted catch-up intermediate: filter events against this step's visibility while retaining
/// private actor IDs. Pass the result to `ItemObserver::prepare_with_seen` before public delivery;
/// that boundary assigns the same presented references as the delivered scene. Never append
/// this raw intermediate after an observation has been prepared.
pub fn observe_events_into(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Vec<SeenEvent>,
) {
    observe_events_with(sim, viewer, events, out, None);
}

/// [`observe_events_into`] reusing verdicts from `cache` (see [`SightCache`]); appends exactly the same events.
pub fn observe_events_into_cached(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Vec<SeenEvent>,
    cache: &mut SightCache,
) {
    observe_events_with(sim, viewer, events, out, Some(cache));
}

fn observe_events_with(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Vec<SeenEvent>,
    mut cache: Option<&mut SightCache>,
) {
    begin(sim, &mut cache);
    let cache = std::cell::RefCell::new(cache);
    let me = sim.player(viewer);
    let me_id = me.map(|m| m.id);
    let wards = crate::vision::WardSight::of_sim(sim);
    let can_see = |id: PlayerId| {
        Some(id) == me_id
            || me.is_some_and(|m| {
                sim.player(id).is_some_and(|o| {
                    o.status != Status::Lobby && sees(sim, m, o, &mut cache.borrow_mut())
                }) || sim
                    .mobs()
                    .iter()
                    .find(|mob| mob.core.id == id)
                    .is_some_and(|mob| {
                        crate::vision::point_visible(
                            sim.collision_view(),
                            m,
                            mob.core.pos(),
                            sim.tick(),
                            wards,
                        ) && !crate::status_runtime::hidden(
                            &mob.core.statuses.instances,
                            sim.server_time(),
                        )
                    })
            })
    };
    filter_events(
        events,
        me_id,
        can_see,
        |i| wish_point_permissions(&sim.k, &sim.w, viewer, &events[i]),
        out,
    );
}

/// What anyone may see with no secrets: every player's public fields (for replays, spectators and results pages). Never
/// replicate this to a playing client: it ignores line of sight.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PublicPlayer {
    pub effects: u16,
    pub displace_seq: u8,
    pub mark_tier: u8,
    pub brand: u8,
    pub mark_by: Option<PlayerId>,
    pub mark_tax: u8,
    pub id: PlayerId,
    pub name: String,
    pub bot: bool,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    /// Widened source-f32 barrier; HP/maxHP retain this diagnostic's native precision.
    pub barrier: f64,
    pub status: Status,
    pub kills: u32,
    pub bounty: u32,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PublicSnapshot {
    pub arena: Option<crate::ArenaView>,
    pub mobs: Vec<ActorView>,
    pub camps: Vec<crate::mob_runtime::CampRoster>,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub winner: Option<String>,
    pub players: Vec<PublicPlayer>,
    pub fields: Vec<crate::status_runtime::FieldView>,
}

/// Checked privileged all-row snapshot. Never deliver this view to a playing client.
pub fn try_public_snapshot(sim: &Sim) -> Result<PublicSnapshot, crate::OfferError> {
    let mut players: Vec<PublicPlayer> = sim
        .players()
        .iter()
        .map(|p| {
            let vitals = public_vitals(p.vitals.hp, p.vitals.max_hp, p.vitals.barrier)?;
            Ok(PublicPlayer {
                effects: p.statuses.effects,
                displace_seq: p.motion.displace_seq,
                mark_tier: crate::systems::sentenced::public_mark_tier(&sim.w, p.id),
                brand: crate::systems::sentenced::public_mark_tier(&sim.w, p.id) * 25,
                mark_by: None,
                mark_tax: 0,
                id: p.id,
                name: p.seat.name.clone(),
                bot: p.seat.bot,
                faction: p.faction(),
                x: p.body.x,
                y: p.body.y,
                facing: p.body.facing,
                hp: p.vitals.hp,
                max_hp: p.vitals.max_hp,
                barrier: vitals.barrier,
                status: p.status,
                kills: p.credit.kills,
                bounty: p.credit.bounty,
            })
        })
        .collect::<Result<_, crate::OfferError>>()?;
    if !players.is_sorted_by_key(|p| p.id) {
        players.sort_unstable_by_key(|p| p.id);
    }
    Ok(PublicSnapshot {
        arena: crate::systems::planning::view::arena_view(&sim.k, &sim.w),
        mobs: sim
            .mobs()
            .iter()
            .map(|mob| mob_view(&sim.w, mob))
            .collect::<Result<_, _>>()?,
        camps: sim.camp_rosters().to_vec(),
        tick: sim.tick(),
        server_time: sim.server_time(),
        phase: sim.phase(),
        winner: sim.winner().map(str::to_owned),
        players,
        fields: crate::status_runtime::observe::public(sim),
    })
}

/// Trusted privileged snapshot wrapper. Arbitrary-checkpoint diagnostics use [`try_public_snapshot`].
pub fn public_snapshot(sim: &Sim) -> PublicSnapshot {
    try_public_snapshot(sim).expect("trusted public snapshot is not representable")
}

fn mob_view(
    w: &crate::state::World,
    mob: &crate::mob_runtime::Mob,
) -> Result<ActorView, crate::OfferError> {
    let core = &mob.core;
    let vitals = public_vitals(core.vitals.hp, core.vitals.max_hp, 0.)?;
    Ok(ActorView {
        kind: if mob.zombie.is_some() {
            ActorKind::Zombie
        } else {
            match mob.kind {
                crate::mob_runtime::MobKind::Dummy => ActorKind::Dummy,
                crate::mob_runtime::MobKind::QuestGiver => ActorKind::QuestGiver,
                crate::mob_runtime::MobKind::Regional | crate::mob_runtime::MobKind::Practice => {
                    ActorKind::Regional
                }
            }
        },
        owner: mob.owner,
        mob_type: if mob.zombie.is_some() {
            None
        } else {
            mob.mob_type
        },
        effects: core.statuses.effects,
        displace_seq: core.motion.displace_seq,
        mark_tier: crate::systems::sentenced::public_mark_tier(w, core.id),
        brand: crate::systems::sentenced::public_mark_tier(w, core.id) * 25,
        mark_by: None,
        mark_tax: 0,
        sig: core.signature.bits,
        id: core.id,
        faction: core.vitals.faction,
        x: core.body.x,
        y: core.body.y,
        facing: core.body.facing,
        hp_frac: vitals.hp_frac,
        barrier_frac: 0.,
        barrier_ring_step: 0,
        status: mob.status,
        weapon: (mob.kind != crate::mob_runtime::MobKind::QuestGiver).then(|| core.active_weapon()),
        bounty: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::WeaponId;
    use crate::results::{GvBreakdown, GvReason, Outcome, RunResult};

    /// One of every [`Event`] variant. The declarations themselves are exhaustive matches (a new variant fails to compile
    /// there); this list only has to hold them consistent with one another, so extend it with the variant.
    fn every_event() -> Vec<Event> {
        let (a, b) = (PlayerId(1), PlayerId(2));
        let shot = crate::ProjectileLaunch {
            id: 1,
            kind: crate::ProjectileKind::Ball,
            owner: a,
            reflected: false,
            origin: crate::Vec2::new(100., 100.),
            velocity: crate::Vec2::new(380., 0.),
            time: 50.,
            range: 640.,
            target: None,
        };
        vec![
            Event::RaidStarted,
            Event::ProjectileLaunched(shot),
            Event::ProjectileEnded {
                launch: shot,
                at: shot.origin,
                reason: crate::ProjectileEnd::Hit,
            },
            Event::Windup {
                by: a,
                weapon: WeaponId::Fists,
                a: 0.0,
                ms: 1.0,
            },
            Event::Swing {
                by: a,
                weapon: WeaponId::Fists,
                x: 1.0,
                y: 2.0,
                a: 0.5,
            },
            Event::Hit {
                victim: b,
                passive: false,
                by: Some(a),
                amount: 3.0,
                weapon: Some(WeaponId::Fists),
            },
            Event::Stagger { id: b },
            Event::AttackCancelled { id: b },
            Event::Block {
                id: b,
                by: a,
                weapon: WeaponId::Sword,
                passive: false,
            },
            Event::PickupRefused {
                id: b,
                reason: crate::PickupRefusal::NothingThere,
                target_visible: false,
            },
            Event::Death {
                id: b,
                x: 1.0,
                y: 2.0,
                by: Some(a),
            },
            Event::Gv {
                id: a,
                amount: 5,
                reason: GvReason::Kill,
            },
            Event::Bounty { id: a, bounty: 7 },
            Event::Victory {
                id: Some(a),
                draw: false,
            },
            Event::RaidEnded,
            Event::Resolved {
                id: a,
                bot: false,
                result: RunResult {
                    faction: None,
                    weapon: None,
                    outcome: Outcome::Won,
                    profile: "p".into(),
                    duration_sec: 1,
                    kills: 0,
                    killed_by: None,
                    killed_by_bot: false,
                    place: 1,
                    players: 2,
                    gv: GvBreakdown::default(),
                    win_bonus_withheld: false,
                    win_bonus_why: None,
                },
            },
        ]
    }

    #[test]
    fn neutral_giver_native_view_carries_no_invented_faction_or_weapon() {
        use crate::mob_runtime::{ActorOrigin, ActorProvenance, Mob};
        let sim = Sim::new(
            Default::default(),
            crate::arenas::practice_arena(),
            crate::Secrets::from_seed(5),
        );
        // Declared constructor-only fixture; no quest publication or source outcome is installed.
        let mob = Mob::born(
            &ActorProvenance {
                id: PlayerId(8),
                origin: ActorOrigin::QuestGiver {
                    birth_serial: 73,
                    born_tick: 0,
                    quest_id: 4,
                    def: 0,
                },
            },
            crate::Vec2::new(200., 300.),
            1.25,
            0.,
        );
        let view = mob_view(&sim.w, &mob).unwrap();
        assert_eq!(view.kind, ActorKind::QuestGiver);
        assert_eq!(view.faction, crate::fighter::FighterAffiliation::Neutral);
        assert_eq!(view.weapon, None);
        assert_eq!(view.mob_type, None);
        assert_eq!(
            (view.x, view.y, view.facing, view.hp_frac),
            (200., 300., 1.25, 1.)
        );
    }

    #[test]
    fn a_sourceless_hit_on_an_unseen_victim_is_not_shown_to_an_absent_viewer() {
        let hit = Event::Hit {
            victim: PlayerId(2),
            passive: false,
            by: None,
            amount: 5.0,
            weapon: None,
        };
        for me in [None, Some(PlayerId(1))] {
            let mut out = Vec::new();
            filter_events(
                std::slice::from_ref(&hit),
                me,
                |_| false,
                |_| [false; 2],
                &mut out,
            );
            assert!(out.is_empty(), "viewer {me:?} must not see it");
        }
        let mut out = Vec::new();
        filter_events(
            std::slice::from_ref(&hit),
            None,
            |_| true,
            |_| [false; 2],
            &mut out,
        );
        assert_eq!(out.len(), 1, "a seen victim's hit is shown");
    }

    #[test]
    fn the_declarations_agree_with_what_an_observer_is_shown() {
        for e in every_event() {
            let seen = to_seen(&e, &|_| true, [true; 2]);
            // Observed exactly when it is not server-only.
            assert_eq!(
                seen.is_some(),
                e.visibility() != Visibility::ServerOnly,
                "{e:?}"
            );
            match seen {
                Some(s) => assert_eq!(s.class(), e.class(), "{e:?}"),
                None => assert_ne!(e.class(), Class::Fx, "{e:?}: fx are always observed"),
            }
        }
    }
}

#[cfg(test)]
#[path = "observe/barrier_tests.rs"]
mod barrier_tests;
