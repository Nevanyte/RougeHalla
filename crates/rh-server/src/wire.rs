//! Conversions between simulation types and wire types (rh-protocol stays independent of the sim). Codes are the protocol's
//! (docs/CONTRACTS.md C-NET-3): status 0 lobby, 1 alive, 2 dead, 3 mia; phase 0 lobby, 1 active, 2 ended; outcome 0 won,
//! 1 draw, 2 died, 3 mia; faction and weapon codes are the content tables' order.

use rh_protocol::{ServerMsg, WireActor, WireCommand, WireEvent, WireFx, WireResult, WireSelf};
use rh_sim::observe::{Observation, SeenEvent};
use rh_sim::sim::{Outcome, Phase, Status};
use rh_sim::{RawCommand, RunResult};

pub fn command(c: WireCommand) -> RawCommand {
    match c {
        WireCommand::Move { x, y, seq } => RawCommand::Move { x: x as f64, y: y as f64, seq },
        WireCommand::Stop { seq } => RawCommand::Stop { seq },
        WireCommand::Aim { a } => RawCommand::Aim { a: a as f64 },
        WireCommand::Attack { a, t } => RawCommand::Attack { a: a as f64, t },
        WireCommand::Release { a, t } => RawCommand::Release { a: a as f64, t },
    }
}

pub fn status(s: Status) -> u8 {
    match s {
        Status::Lobby => 0,
        Status::Alive => 1,
        Status::Dead => 2,
        Status::Mia => 3,
    }
}

pub fn phase(p: Phase) -> u8 {
    match p {
        Phase::Lobby => 0,
        Phase::Active => 1,
        Phase::Ended => 2,
    }
}

fn sat16(v: u32) -> u16 {
    v.min(u16::MAX as u32) as u16
}

pub fn snapshot(obs: &Observation, ack_input: u32) -> ServerMsg {
    let me = obs.me.as_ref().map(|m| WireSelf {
        id: m.id.0,
        faction: m.faction.code(),
        x: m.x as f32,
        y: m.y as f32,
        facing: m.facing as f32,
        hp: m.hp as f32,
        max_hp: m.max_hp as f32,
        status: status(m.status),
        weapon: m.weapon.code(),
        ready_in_ms: m.ready_in_ms.min(u16::MAX as f64) as u16,
        kills: sat16(m.kills),
        bounty: sat16(m.bounty),
        gv: sat16(m.gv),
        move_seq: m.move_seq,
    });
    let actors = obs
        .visible
        .iter()
        .map(|a| WireActor {
            id: a.id.0,
            faction: a.faction.code(),
            x: a.x as f32,
            y: a.y as f32,
            facing: a.facing as f32,
            hp_pct: (a.hp_frac * 100.0).round().clamp(0.0, 100.0) as u8,
            status: status(a.status),
            weapon: a.weapon.code(),
            bounty: sat16(a.bounty),
        })
        .collect();
    ServerMsg::Snapshot { tick: obs.tick, server_ms: obs.server_time, phase: phase(obs.phase), ack_input, me, actors }
}

/// The important events this viewer may know of (already filtered by its observation).
pub fn important(_events: &[rh_sim::Event], obs: &Observation) -> Vec<WireEvent> {
    obs.events
        .iter()
        .filter_map(|e| match e {
            SeenEvent::Death { id, by } => Some(WireEvent::Death { id: id.0, by: by.map(|b| b.0) }),
            SeenEvent::Bounty { id, bounty } => Some(WireEvent::Bounty { id: id.0, bounty: sat16(*bounty) }),
            SeenEvent::Ended { winner, draw } => Some(WireEvent::MatchEnded { winner: winner.map(|w| w.0), draw: *draw }),
            _ => None,
        })
        .collect()
}

pub fn fx_seen(obs: &Observation) -> Vec<WireFx> {
    obs.events
        .iter()
        .filter_map(|e| match *e {
            SeenEvent::Swing { by, weapon, x, y, a } => Some(WireFx::Swing { by: by.0, weapon: weapon.code(), x: x as f32, y: y as f32, a: a as f32 }),
            SeenEvent::Hit { victim, by, amount } => Some(WireFx::Hit { victim: victim.0, by: by.0, amount: amount as f32 }),
            _ => None,
        })
        .collect()
}

pub fn result(r: &RunResult) -> WireResult {
    WireResult {
        outcome: match r.outcome {
            Outcome::Won => 0,
            Outcome::Draw => 1,
            Outcome::Died => 2,
            Outcome::Mia => 3,
        },
        place: r.place.min(255) as u8,
        players: r.players.min(255) as u8,
        kills: sat16(r.kills),
        killed_by: r.killed_by.clone(),
        gv_total: r.gv.total,
        gv_win: r.gv.win,
        duration_sec: r.duration_sec,
        win_bonus_withheld: r.win_bonus_withheld,
    }
}
