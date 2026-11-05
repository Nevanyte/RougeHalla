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

pub const OBSERVATION_VERSION: u16 = 7;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SelfView {
    /// The owner’s attack lock, when that actor is also visible in this frame.
    pub attack_target: Option<PlayerId>,
    pub id: PlayerId,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub status: Status,
    pub weapon: WeaponId,
    /// Milliseconds until the next attack may start (0 when ready).
    pub ready_in_ms: f64,
    pub kills: u32,
    pub bounty: u32,
    pub gv: u32,
    /// The last movement order number the server applied (prediction ack).
    pub move_seq: u8,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ActorView {
    pub id: PlayerId,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    /// What an hp bar shows: the fraction, quantized to hundredths.
    pub hp_frac: f64,
    pub status: Status,
    pub weapon: WeaponId,
    pub bounty: u32,
}

/// An event the observer could perceive.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SeenEvent {
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
    pub version: u16,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub me: Option<SelfView>,
    pub inventory: Option<crate::Inventory>,
    pub props: Vec<crate::VisibleProp>,
    pub visible: Vec<ActorView>,
    pub events: Vec<SeenEvent>,
}

impl SeenEvent {
    /// How a client receives this: the same declaration as the [`Event`] it came from (a test holds them equal). No
    /// wildcard arm, on purpose.
    pub fn class(&self) -> Class {
        match self {
            SeenEvent::Death { .. } | SeenEvent::Bounty { .. } | SeenEvent::Ended { .. } => {
                Class::Important
            }
            SeenEvent::Swing { .. }
            | SeenEvent::Hit { .. }
            | SeenEvent::Block { .. }
            | SeenEvent::Heal { .. }
            | SeenEvent::AttackCancelled { .. }
            | SeenEvent::Stagger { .. } => Class::Fx,
            SeenEvent::PickupRefused { .. } => Class::Important,
        }
    }
}

/// What an observer is shown of `e`, if anything (whether THIS observer may know of it is [`Event::visibility`]'s call).
/// Exhaustive, no wildcard: a new [`Event`] variant must say here whether it reaches observers at all.
fn to_seen(e: &Event, can_see: &impl Fn(PlayerId) -> bool) -> Option<SeenEvent> {
    match *e {
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
        Event::ProjectileLaunched(_)
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
            version: OBSERVATION_VERSION,
            tick: 0,
            server_time: 0.0,
            phase: Phase::Lobby,
            me: None,
            inventory: None,
            props: Vec::new(),
            visible: Vec::new(),
            events: Vec::new(),
        }
    }
}

/// The same current line and private trail apply to full observations and event-only catch-up.
fn sees(sim: &Sim, me: &Player, other: &Player, cache: &mut Option<&mut SightCache>) -> bool {
    let map = &sim.arena().map;
    let a = me.pos();
    let b = other.pos();
    actor_with(map, me, other, sim.tick(), || match cache {
        Some(c) => c.blocked(map, me.id, other.id, a.x, a.y, b.x, b.y),
        None => scene_line_blocked(map, a.x, a.y, b.x, b.y),
    })
}

/// Readies `cache` for a pass over `sim` (it drops entries computed on another arena).
fn begin(sim: &Sim, cache: &mut Option<&mut SightCache>) {
    if let Some(c) = cache {
        let k = &sim.k;
        c.begin(
            std::sync::Arc::as_ptr(&k.arena) as usize,
            k.digest,
            sim.players().len(),
            u64::from(sim.tick()),
        );
    }
}

/// The events an observer is shown, in order: each is judged by its own declared [`Event::visibility`] against `can_see`
/// (which already includes the observer itself).
fn filter_events(
    events: &[Event],
    me: Option<PlayerId>,
    can_see: impl Fn(PlayerId) -> bool,
    out: &mut Vec<SeenEvent>,
) {
    for e in events {
        let shown = match e.visibility() {
            Visibility::Everyone => true,
            Visibility::Owner(id) => Some(id) == me,
            Visibility::IfSeen(id) => can_see(id),
            Visibility::IfSeenOrBy { seen, by } => can_see(seen) || (by.is_some() && by == me),
            Visibility::ServerOnly => false,
        };
        if shown {
            if let Some(s) = to_seen(e, &can_see) {
                out.push(s);
            }
        }
    }
}

/// Disposable preview, with handles scoped to this call. Use [`crate::ItemObserver`] for actions.
/// The observation of player `viewer` after a step whose events are `events` (pass the step's return value).
pub fn observe(sim: &Sim, viewer: PlayerId, events: &[Event]) -> Observation {
    let mut obs = Observation::default();
    observe_into(sim, viewer, events, &mut obs);
    obs
}

/// Disposable preview into a caller-owned buffer. For reusable scratch, stable handles and fallible
/// scene bounds, deliver observations through [`crate::ItemObserver::observe_into`].
pub fn observe_into(sim: &Sim, viewer: PlayerId, events: &[Event], out: &mut Observation) {
    crate::ItemObserver::new(viewer)
        .observe_into(sim, events, out, None)
        .expect("scene exceeds item observation bounds");
}

/// Disposable [`observe_into`] reusing line-of-sight verdicts from `cache` for pairs whose endpoints are bit-identical to the last
/// time that ordered pair was tested (see [`SightCache`]). The content is exactly what [`observe_into`] fills.
pub fn observe_into_cached(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
    cache: &mut SightCache,
) {
    crate::ItemObserver::new(viewer)
        .observe_into(sim, events, out, Some(cache))
        .expect("scene exceeds item observation bounds");
}

pub(crate) fn observe_with(
    sim: &Sim,
    viewer: PlayerId,
    events: &[Event],
    out: &mut Observation,
    mut cache: Option<&mut SightCache>,
) {
    begin(sim, &mut cache);
    let me = sim.player(viewer);
    let now = sim.server_time();
    out.version = OBSERVATION_VERSION;
    out.tick = sim.tick();
    out.server_time = now;
    out.phase = sim.phase();
    out.me = me.map(|p| SelfView {
        attack_target: None,
        id: p.id,
        faction: p.vitals.faction,
        x: p.body.x,
        y: p.body.y,
        facing: p.body.facing,
        hp: p.vitals.hp,
        max_hp: p.vitals.max_hp,
        status: p.status,
        weapon: p.active_weapon(),
        ready_in_ms: (p.weapon.ready_at - now).max(0.0),
        kills: p.credit.kills,
        bounty: p.credit.bounty,
        gv: p.credit.gv,
        move_seq: p.motion.move_seq,
    });
    out.visible.clear();
    if let Some(m) = me {
        let map = &sim.arena().map;
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
            if actor_with(map, m, o, sim.tick(), || match &mut cache {
                Some(c) if probing => c.probe(map, m.id, o.id, ax, ay, o.body.x, o.body.y),
                _ => scene_line_blocked(map, ax, ay, o.body.x, o.body.y),
            }) {
                out.visible.push(ActorView {
                    id: o.id,
                    faction: o.vitals.faction,
                    x: o.body.x,
                    y: o.body.y,
                    facing: o.body.facing,
                    hp_frac: if o.vitals.max_hp > 0.0 {
                        (o.vitals.hp / o.vitals.max_hp * 100.0).round() / 100.0
                    } else {
                        0.0
                    },
                    status: o.status,
                    weapon: o.active_weapon(),
                    bounty: o.credit.bounty,
                });
            }
        }
    }
    // Public id order, never join order (a no-op scan when the store already iterates in id order).
    // Ids are unique, so any sort gives this order; the unstable one never allocates (the stable one does from ~85 entries).
    if !out.visible.is_sorted_by_key(|a| a.id) {
        out.visible.sort_unstable_by_key(|a| a.id);
    }
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
    filter_events(events, me_id, can_see, &mut out.events);
}

/// Appends to `out` what `viewer` may know of `events` as the sim stands NOW, without building the whole observation. A
/// room that runs several steps in one wake calls this after each step but the last, so a step's events are judged against
/// that step's line of sight and not a later one's (C-OBS); for the same sim and events it appends exactly the events
/// [`observe_into`] would put in the observation.
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
    let can_see = |id: PlayerId| {
        Some(id) == me_id
            || me.is_some_and(|m| {
                sim.player(id).is_some_and(|o| {
                    o.status != Status::Lobby && sees(sim, m, o, &mut cache.borrow_mut())
                })
            })
    };
    filter_events(events, me_id, can_see, out);
}

/// What anyone may see with no secrets: every player's public fields (for replays, spectators and results pages). Never
/// replicate this to a playing client: it ignores line of sight.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PublicPlayer {
    pub id: PlayerId,
    pub name: String,
    pub bot: bool,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub status: Status,
    pub kills: u32,
    pub bounty: u32,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PublicSnapshot {
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub winner: Option<String>,
    pub players: Vec<PublicPlayer>,
}

pub fn public_snapshot(sim: &Sim) -> PublicSnapshot {
    let mut players: Vec<PublicPlayer> = sim
        .players()
        .iter()
        .map(|p| PublicPlayer {
            id: p.id,
            name: p.seat.name.clone(),
            bot: p.seat.bot,
            faction: p.vitals.faction,
            x: p.body.x,
            y: p.body.y,
            facing: p.body.facing,
            hp: p.vitals.hp,
            max_hp: p.vitals.max_hp,
            status: p.status,
            kills: p.credit.kills,
            bounty: p.credit.bounty,
        })
        .collect();
    if !players.is_sorted_by_key(|p| p.id) {
        players.sort_unstable_by_key(|p| p.id);
    }
    PublicSnapshot {
        tick: sim.tick(),
        server_time: sim.server_time(),
        phase: sim.phase(),
        winner: sim.winner().map(str::to_owned),
        players,
    }
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
            filter_events(std::slice::from_ref(&hit), me, |_| false, &mut out);
            assert!(out.is_empty(), "viewer {me:?} must not see it");
        }
        let mut out = Vec::new();
        filter_events(std::slice::from_ref(&hit), None, |_| true, &mut out);
        assert_eq!(out.len(), 1, "a seen victim's hit is shown");
    }

    #[test]
    fn the_declarations_agree_with_what_an_observer_is_shown() {
        for e in every_event() {
            let seen = to_seen(&e, &|_| true);
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
