//! Three views of a match, kept apart on purpose (docs/CONTRACTS.md C-OBS):
//!
//! * the full authoritative state: [`crate::Sim`] itself (server-only; secrets, inputs, runtime);
//! * the public snapshot: [`public_snapshot`], what anyone may see of the match with no secrets (replays, spectators, results);
//! * the per-player observation: [`observe`], exactly what that player can legitimately perceive. The live server replicates
//!   THIS to each client (interest management) and future policies receive THIS, so humans, scripted bots and learned
//!   policies decide from the same information.
//!
//! Leak rules: other actors appear only while in sight (within VISION_RADIUS with a clear line on the sight mask); they are
//! sorted by public id, never by join order, action order or hidden state; counts are counts of visible things; events are
//! filtered by what the observer could see; nothing derived from a secret stream is included.

use crate::constants::VISION_RADIUS;
use crate::content::{FactionId, WeaponId};
use crate::geometry::raycast;
use crate::map::MASK_SIGHT;
use crate::sim::{Event, Phase, Player, PlayerId, Sim, Status};

pub const OBSERVATION_VERSION: u16 = 1;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SelfView {
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
    Swing { by: PlayerId, weapon: WeaponId, x: f64, y: f64, a: f64 },
    Hit { victim: PlayerId, by: PlayerId, amount: f64 },
    Death { id: PlayerId, by: Option<PlayerId> },
    Bounty { id: PlayerId, bounty: u32 },
    Ended { winner: Option<PlayerId>, draw: bool },
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Observation {
    pub version: u16,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub me: Option<SelfView>,
    pub visible: Vec<ActorView>,
    pub events: Vec<SeenEvent>,
}

fn sees(sim: &Sim, me: &Player, other: &Player) -> bool {
    let dx = other.x - me.x;
    let dy = other.y - me.y;
    dx * dx + dy * dy <= VISION_RADIUS * VISION_RADIUS && !raycast(&sim.arena.map, me.x, me.y, other.x, other.y, MASK_SIGHT).hit
}

/// The observation of player `viewer` after a step whose events are `events` (pass the step's return value).
pub fn observe(sim: &Sim, viewer: PlayerId, events: &[Event]) -> Observation {
    let me = sim.player(viewer);
    let now = sim.server_time;
    let self_view = me.map(|p| SelfView {
        id: p.id,
        faction: p.faction,
        x: p.x,
        y: p.y,
        facing: p.facing,
        hp: p.hp,
        max_hp: p.max_hp,
        status: p.status,
        weapon: p.active_weapon(),
        ready_in_ms: (p.ready_at - now).max(0.0),
        kills: p.kills,
        bounty: p.bounty,
        gv: p.gv,
        move_seq: p.move_seq,
    });
    let mut visible: Vec<ActorView> = match me {
        None => Vec::new(),
        Some(m) => sim
            .players()
            .iter()
            .filter(|o| o.id != m.id && o.status != Status::Lobby && sees(sim, m, o))
            .map(|o| ActorView {
                id: o.id,
                faction: o.faction,
                x: o.x,
                y: o.y,
                facing: o.facing,
                hp_frac: if o.max_hp > 0.0 { (o.hp / o.max_hp * 100.0).round() / 100.0 } else { 0.0 },
                status: o.status,
                weapon: o.active_weapon(),
                bounty: o.bounty,
            })
            .collect(),
    };
    visible.sort_by_key(|a| a.id);
    let can_see = |id: PlayerId| Some(id) == me.map(|m| m.id) || visible.iter().any(|v| v.id == id);
    let mut seen = Vec::new();
    for e in events {
        match e {
            Event::Swing { by, weapon, x, y, a } if can_see(*by) => seen.push(SeenEvent::Swing { by: *by, weapon: *weapon, x: *x, y: *y, a: *a }),
            Event::Hit { victim, by, amount, .. } if can_see(*victim) || Some(*by) == me.map(|m| m.id) => {
                seen.push(SeenEvent::Hit { victim: *victim, by: *by, amount: *amount })
            }
            Event::Death { id, by, .. } if can_see(*id) => seen.push(SeenEvent::Death { id: *id, by: *by }),
            // Bounty announcements and the end of the run are announced to everyone in the legacy game.
            Event::Bounty { id, bounty } => seen.push(SeenEvent::Bounty { id: *id, bounty: *bounty }),
            Event::Victory { id, draw } => seen.push(SeenEvent::Ended { winner: *id, draw: *draw }),
            _ => {}
        }
    }
    Observation { version: OBSERVATION_VERSION, tick: sim.tick, server_time: now, phase: sim.phase, me: self_view, visible, events: seen }
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
            name: p.name.clone(),
            bot: p.bot,
            faction: p.faction,
            x: p.x,
            y: p.y,
            facing: p.facing,
            hp: p.hp,
            max_hp: p.max_hp,
            status: p.status,
            kills: p.kills,
            bounty: p.bounty,
        })
        .collect();
    players.sort_by_key(|p| p.id);
    PublicSnapshot { tick: sim.tick, server_time: sim.server_time, phase: sim.phase, winner: sim.winner.clone(), players }
}
