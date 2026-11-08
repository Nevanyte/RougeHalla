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
        if super::planning::enabled(k) {
            super::planning::start(k, w, ev);
        } else {
            start_raid(k, w, s, ev, &[]);
        }
    }
}

pub(super) fn start_raid(
    k: &MatchStatic,
    w: &mut World,
    s: &mut TickScratch,
    ev: &mut Vec<Event>,
    placed: &[(crate::PlayerId, crate::Vec2)],
) {
    w.phase = Phase::Active;
    w.raid_started_at = w.server_time;
    w.plan_ends_at = 0.;
    let mut spawns = k.arena.spawns.clone();
    let mut i = spawns.len();
    while i > 1 {
        i -= 1;
        // A draw in [0, 1) times (i + 1) is non-negative: truncation is its floor.
        let j = (w.spawn_rng.next_f64() * (i + 1) as f64) as usize;
        spawns.swap(i, j);
    }
    let now = w.server_time;
    let mut fallback = 0;
    for p in w.players.iter_mut() {
        if let Some((_, at)) = placed.iter().find(|(id, _)| *id == p.id) {
            p.body.x = at.x;
            p.body.y = at.y;
        } else if !spawns.is_empty() {
            let s = spawns[fallback % spawns.len()];
            fallback += 1;
            p.body.x = s.x;
            p.body.y = s.y;
        }
        p.status = Status::Alive;
        p.motion.path.clear();
        p.motion.slip = None;
        p.inputs.clear();
        let (x, y) = (p.body.x, p.body.y);
        p.body.history.reset(Sample { t: now, x, y });
        p.weapon.reset_runtime();
        p.weapon.ready_at = 0.0;
        p.weapon.draw_started_at = 0.0;
    }
    super::arena_rules::begin_run(k, w);
    s.downed_this_tick.clear();
    w.rt.downs_between_ticks = 0;
    w.winner = None;
    // Legacy startRaid: beginRun, then the raidStarted hook chain, then the event.
    hooks::fire(
        &mut Hx {
            stats: crate::status_runtime::stats::Inputs::default(),
            k,
            w,
            ev,
            fx: Some(&mut s.fx),
        },
        HookArgs::RaidStarted,
    );
    super::frost::prepare(k, w).expect("validated Frost source budget");
    s.reserve_actors(w.fighter_count());
    super::sentenced::prepare(k, w, s).expect("validated Mark edge budget");
    ev.push(Event::RaidStarted);
}
