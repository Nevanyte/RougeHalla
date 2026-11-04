//! The lobby and the raid start (legacy step.ts `updateLobby`, arena.ts `startRaid`).
//!
//! Touches the lobby timer, the phase, every player's placement and runtime reset, the spawn stream and the run
//! bookkeeping; reads the config and the arena's spawn points; emits the raid start.

use crate::constants::*;
use crate::events::Event;
use crate::hooks::{self, HookArgs, Hx};
use crate::scratch::TickScratch;
use crate::state::{Phase, Sample, Status, World};
use crate::statics::MatchStatic;
use crate::systems::{inputs, Cx};

/// System (legacy step.updateLobby): nothing is applied in the lobby; it closes when enough humans joined (after the
/// fill time) or when it times out, and the raid starts on that step.
pub(crate) fn update(cx: &mut Cx) {
    inputs::drain_all(cx);
    let Cx { k, w, s, ev, .. } = cx;
    if w.players.is_empty() {
        return;
    }
    let humans = w.players.iter().filter(|p| !p.seat.bot).count();
    if humans >= k.config.min_players {
        w.lobby_ends_at = w
            .lobby_ends_at
            .min(w.server_time + k.config.fill_seconds * 1000.0);
    }
    if humans >= MAX_PLAYERS || w.server_time >= w.lobby_ends_at {
        start_raid(k, w, s, ev);
    }
}

fn start_raid(k: &MatchStatic, w: &mut World, s: &mut TickScratch, ev: &mut Vec<Event>) {
    w.phase = Phase::Active;
    w.raid_started_at = w.server_time;
    let mut spawns = k.arena.spawns.clone();
    let mut i = spawns.len();
    while i > 1 {
        i -= 1;
        // A draw in [0, 1) times (i + 1) is non-negative: truncation is its floor.
        let j = (w.spawn_rng.next_f64() * (i + 1) as f64) as usize;
        spawns.swap(i, j);
    }
    let now = w.server_time;
    for (k, p) in w.players.iter_mut().enumerate() {
        if !spawns.is_empty() {
            let s = spawns[k % spawns.len()];
            p.body.x = s.x;
            p.body.y = s.y;
        }
        p.status = Status::Alive;
        p.inputs.clear();
        let (x, y) = (p.body.x, p.body.y);
        p.body.history.reset(Sample { t: now, x, y });
        p.weapon.reset_runtime();
        p.weapon.ready_at = 0.0;
        p.weapon.draw_started_at = 0.0;
    }
    w.rt.started_with = w.players.len() as u32;
    w.rt.started_humans = w.players.iter().filter(|p| !p.seat.bot).count();
    s.downed_this_tick.clear();
    w.rt.downs_between_ticks = 0;
    w.winner = None;
    // Legacy startRaid: beginRun, then the raidStarted hook chain, then the event.
    hooks::fire(&mut Hx { k, w, ev }, HookArgs::RaidStarted);
    ev.push(Event::RaidStarted);
}
