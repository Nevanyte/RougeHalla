//! The seats' inputs: how a command reaches a queue (`submit`, C-INPUT) and how the queues are applied in the secret action
//! order (legacy step.ts `actionOrder`, `applyInputs`).
//!
//! Touches each fighter's inputs, path, move ack and weapon trigger; writes the tick's action-order ranks; reads the
//! order salt, the clock and the collision map, and searches paths. A queued action is run by its handler in the
//! schedule's `ACTIONS` table (legacy `world.actions[kind]`).

use crate::input::{self, ActionCmd, Command, MoveCmd, Reject};
use crate::map::TileMap;
use crate::math::Vec2;
use crate::pathfind::{plan_path_into, Pathfinder};
use crate::rng::action_order_in_place;
use crate::schedule::{self, ActionId};
use crate::state::{Player, PlayerId, Status, World};
use crate::systems::{weapons, Cx};

/// Queues a validated command for the next tick through the seat's order budget (sim time): what `Sim::submit` and
/// `Cx::submit` both run, the only way a command reaches a queue (C-INPUT). A seat that is not present drops it.
pub(crate) fn submit(w: &mut World, id: PlayerId, cmd: Command) -> Result<(), Reject> {
    let now = w.server_time;
    let Some(i) = w.idx(id) else {
        return Ok(());
    };
    input::accept(&mut w.players[i], cmd, now, true)
}

/// Queues a command with no order budget: the parity harness only (the legacy capture fed the sim directly).
pub(crate) fn submit_unbudgeted(w: &mut World, id: PlayerId, cmd: Command) -> Result<(), Reject> {
    let now = w.server_time;
    let Some(i) = w.idx(id) else {
        return Ok(());
    };
    input::accept(&mut w.players[i], cmd, now, false)
}

/// System (legacy step.actionOrder): the tick's secret action order, kept as (id, rank): the order the inputs apply in
/// and the rank of kill credit among a victim's hits.
pub(crate) fn action_order(cx: &mut Cx) {
    let Cx { k, w, s, .. } = cx;
    // The join order, shuffled in place by the secret order; each id's rank is its place in the result.
    s.rank.clear();
    s.rank.extend(w.players.iter().map(|p| (p.id, 0)));
    action_order_in_place(k.secrets.order_salt, w.tick, &mut s.rank);
    for (i, e) in s.rank.iter_mut().enumerate() {
        e.1 = i;
    }
}

/// System (legacy step.applyInputs for players): every present player's queued inputs, in the action order.
pub(crate) fn apply_players(cx: &mut Cx) {
    for r in 0..cx.s.rank.len() {
        let id = cx.s.rank[r].0;
        if let Some(i) = cx.w.idx(id) {
            apply_inputs(cx, i);
        }
    }
}

/// Drops every queued input (lobby and ended phases: nothing is applied there).
pub(crate) fn drain_all(cx: &mut Cx) {
    for p in &mut cx.w.players {
        p.inputs.clear();
    }
}

fn apply_inputs(cx: &mut Cx, i: usize) {
    let now = cx.w.server_time;
    let d = cx.w.players[i].inputs.drain();
    let n = d.actions.len();
    for k in 0..=n {
        if cx.w.players[i].status != Status::Alive {
            return;
        }
        if k == d.move_before.min(n) {
            if let Some(mv) = d.mv {
                apply_move(&mut cx.w.players[i], &cx.k.arena.map, cx.pf, &mut cx.s.path, mv);
            }
        }
        if k == d.aim_before.min(n) {
            if let Some(a) = d.aim {
                weapons::set_aim(&mut cx.w.players[i], now, a);
            }
        }
        if let Some(cmd) = d.actions.get(k) {
            schedule::run_action(cx, action_id(cmd), i, cmd);
        }
    }
}

fn action_id(cmd: &ActionCmd) -> ActionId {
    match cmd {
        ActionCmd::Attack { .. } => ActionId::Attack,
        ActionCmd::Release { .. } => ActionId::Release,
    }
}

fn apply_move(
    p: &mut Player,
    map: &TileMap,
    pf: &mut Pathfinder,
    out: &mut Vec<Vec2>,
    mv: MoveCmd,
) {
    // cancelLockedWindup / dropLock: no target lock in the slice.
    let from = p.pos();
    let (stop, seq) = match mv {
        MoveCmd::Stop { seq } => {
            out.clear();
            (true, seq)
        }
        MoveCmd::Move { x, y, seq } => {
            plan_path_into(pf, map, from, Vec2::new(x, y), out);
            (false, seq)
        }
    };
    // An order with no route (a goal in a wall with nothing to snap to) leaves the current path alone.
    if stop || !out.is_empty() {
        p.path.set_from(out);
    }
    if let Some(s) = seq {
        p.move_seq = s;
    }
}
