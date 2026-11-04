//! Downs, settlement, the end of the run and the results (legacy arena.ts `downPlayer`, `settle`, `endRun`).
//!
//! Touches: the players' standing and results, the run bookkeeping (`rt`, winner, phase) and the event log; `settle`
//! drains the tick's downed list, `mark_tick_start` writes the tick-start snapshot.

use crate::constants::*;
use crate::events::Event;
use crate::hooks::{self, HookArgs, Hx, OutCause};
use crate::math::js_round;
use crate::results::{GvBreakdown, Outcome, RunResult, WinBonusWhy};
use crate::state::{Phase, PlayerId, Status, World};
use crate::statics::MatchStatic;
use crate::systems::credit;
use crate::systems::weapons::release_trigger;
use crate::systems::Cx;

/// System (legacy arena.markTickStart): what the tick's outcomes are judged against, before anyone acts. The hp
/// fraction decides simultaneous deaths; the bounty is what a kill this tick pays.
pub(crate) fn mark_tick_start(cx: &mut Cx) {
    let Cx { w, s, .. } = cx;
    s.bounty_at_tick_start.clear();
    for p in &mut w.players {
        p.hp_frac_at_tick_start = if p.max_hp > 0.0 {
            (p.hp + p.barrier) / p.max_hp
        } else {
            0.0
        };
        s.bounty_at_tick_start.push((p.id, p.bounty));
    }
}

/// Takes player `vi` out of the run (legacy `downPlayer`). Inside a step (`in_step` is the tick's downed list) the
/// result waits for the settle at the end of the step; between steps (a leave) it is resolved at once.
pub(crate) fn down_player(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    in_step: Option<&mut Vec<PlayerId>>,
    vi: usize,
    outcome: Outcome,
) {
    if !w.players[vi].standing() {
        return;
    }
    let now = w.server_time;
    let credited = if outcome == Outcome::Mia {
        let at = w.players[vi].dropped_at.unwrap_or(now);
        credit::recent_rival(w, vi, at)
    } else {
        None
    };
    let v = &mut w.players[vi];
    v.down = Some(outcome);
    v.path.clear();
    release_trigger(v, now);
    v.status = if outcome == Outcome::Died {
        Status::Dead
    } else {
        Status::Mia
    };
    let victim_bot = v.bot;
    let id = v.id;
    // Legacy order: fighterOut, the kill credit, then dropBody.
    let mut hx = Hx { k, w, ev };
    hooks::fire(
        &mut hx,
        HookArgs::FighterOut {
            id,
            cause: OutCause::Down,
        },
    );
    if let Some(c) = credited {
        let bounty = hx.w.players[vi].bounty;
        credit::credit_kill(hx.w, hx.ev, c, victim_bot, bounty);
    }
    hooks::fire(&mut hx, HookArgs::DropBody { victim: id });
    if let Some(downed) = in_step {
        downed.push(id);
        return;
    }
    w.rt.downs_between_ticks += 1;
    let alive = w.players.iter().filter(|p| p.standing()).count() as u32;
    let vi = w.idx(id).expect("still present");
    resolve(w, ev, vi, outcome, alive + 1, 0, None);
}

/// System (legacy arena.settle): resolve the tick's downs, or end the run when at most one fighter stands.
pub(crate) fn settle(cx: &mut Cx) {
    let Cx { k, w, s, ev, .. } = cx;
    let downed = &mut s.downed_this_tick;
    w.rt.downs_between_ticks = 0;
    let alive: Vec<PlayerId> = w
        .players
        .iter()
        .filter(|p| p.standing())
        .map(|p| p.id)
        .collect();
    let contested = w.rt.started_with >= 2;
    if alive.is_empty() || (contested && alive.len() == 1) {
        end_run(k, w, ev, &alive, downed, contested);
        downed.clear();
        return;
    }
    for &id in downed.iter() {
        if let Some(i) = w.idx(id) {
            let outcome = w.players[i].down.expect("downed");
            resolve(w, ev, i, outcome, alive.len() as u32 + 1, 0, None);
        }
    }
    downed.clear();
    // [patience timer, coliseum teleport, sudden death] -- not in the slice (docs/backlog P-ARENA-1)
}

fn end_run(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    alive: &[PlayerId],
    downed: &[PlayerId],
    contested: bool,
) {
    let mut winners: Vec<PlayerId> = Vec::new();
    if alive.len() == 1 {
        winners = alive.to_vec();
    } else if contested && !downed.is_empty() {
        let best = downed
            .iter()
            .filter_map(|id| w.player(*id))
            .map(|p| p.hp_frac_at_tick_start)
            .fold(f64::NEG_INFINITY, f64::max);
        winners = downed
            .iter()
            .copied()
            .filter(|id| {
                w.player(*id)
                    .is_some_and(|p| p.hp_frac_at_tick_start == best)
            })
            .collect();
    }
    let draw = winners.len() > 1;
    for id in downed {
        if !winners.contains(id) {
            if let Some(i) = w.idx(*id) {
                let outcome = w.players[i].down.expect("downed");
                resolve(w, ev, i, outcome, winners.len() as u32 + 1, 0, None);
            }
        }
    }
    for id in &winners {
        let Some(i) = w.idx(*id) else { continue };
        if draw {
            resolve(w, ev, i, Outcome::Draw, 1, 0, None);
            continue;
        }
        let why = if contested {
            withheld_why(w, i)
        } else {
            Some(WinBonusWhy::Starters)
        };
        resolve(
            w,
            ev,
            i,
            Outcome::Won,
            1,
            if why.is_some() { 0 } else { GV_WIN },
            why,
        );
    }
    let winner = if !draw && winners.len() == 1 {
        Some(winners[0])
    } else {
        None
    };
    w.winner = winner.and_then(|id| w.player(id)).map(|p| p.name.clone());
    w.phase = Phase::Ended;
    hooks::fire(&mut Hx { k, w, ev }, HookArgs::RunEnded);
    ev.push(Event::Victory { id: winner, draw });
    ev.push(Event::RaidEnded);
}

fn withheld_why(w: &World, i: usize) -> Option<WinBonusWhy> {
    if w.rt.started_humans < WIN_BONUS_MIN_PLAYERS {
        return Some(WinBonusWhy::Starters);
    }
    if w.players[i].damaged_humans.len() < WIN_BONUS_MIN_OPPONENTS {
        return Some(WinBonusWhy::Opponents);
    }
    None
}

/// Banks player `i`'s run once (legacy `resolvePlayer`): the result event persistence consumes.
fn resolve(
    w: &mut World,
    ev: &mut Vec<Event>,
    i: usize,
    outcome: Outcome,
    place: u32,
    win: u32,
    why: Option<WinBonusWhy>,
) {
    let now = w.server_time;
    let started = w.raid_started_at;
    let players = w.rt.started_with;
    let p = &mut w.players[i];
    if p.resolved {
        return;
    }
    p.resolved = true;
    p.path.clear();
    let g = p.gv_parts;
    let gv = GvBreakdown {
        win,
        total: g.kills + g.mobs + g.bounty + g.quest + win,
        ..g
    };
    let result = RunResult {
        outcome,
        profile: p.profile.clone(),
        duration_sec: if started > 0.0 {
            js_round((now - started) / 1000.0) as u32
        } else {
            0
        },
        kills: p.kills - p.bot_kills,
        killed_by: if outcome == Outcome::Died {
            p.killed_by.clone()
        } else {
            None
        },
        killed_by_bot: outcome == Outcome::Died && p.killed_by_bot,
        place,
        players,
        gv,
        win_bonus_withheld: why.is_some(),
        win_bonus_why: why,
    };
    let (id, bot) = (p.id, p.bot);
    ev.push(Event::Resolved { id, result, bot });
}
