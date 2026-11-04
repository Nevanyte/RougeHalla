//! Applying the seats' queued inputs in the secret action order (legacy step.ts `actionOrder`, `applyInputs`).
//!
//! Touches each fighter's inputs, path, move ack and weapon trigger; writes the tick's action-order ranks; reads the
//! order salt, the clock and the collision map, and searches paths.

use crate::input::{ActionCmd, MoveCmd};
use crate::map::TileMap;
use crate::math::Vec2;
use crate::pathfind::{plan_path, Pathfinder};
use crate::rng::action_order;
use crate::state::{Player, PlayerId, Status};
use crate::systems::{weapons, Cx};

/// System (legacy step.applyInputs): the tick's secret action order (also the kill-credit ranks), then every present
/// player's queued inputs in that order.
pub(crate) fn apply_all(cx: &mut Cx) {
    let Cx { k, w, s, pf, .. } = cx;
    let join: Vec<PlayerId> = w.players.iter().map(|p| p.id).collect();
    let order = action_order(k.secrets.order_salt, w.tick, &join);
    s.rank.clear();
    s.rank
        .extend(order.iter().enumerate().map(|(i, id)| (*id, i)));
    let now = w.server_time;
    for id in &order {
        if let Some(i) = w.idx(*id) {
            apply_inputs(&mut w.players[i], now, &k.arena.map, pf);
        }
    }
}

/// Drops every queued input (lobby and ended phases: nothing is applied there).
pub(crate) fn drain_all(cx: &mut Cx) {
    for p in &mut cx.w.players {
        p.inputs.drain();
    }
}

fn apply_inputs(p: &mut Player, now: f64, map: &TileMap, pf: &mut Pathfinder) {
    let d = p.inputs.drain();
    let n = d.actions.len();
    for k in 0..=n {
        if p.status != Status::Alive {
            return;
        }
        if k == d.move_before.min(n) {
            if let Some(mv) = d.mv {
                apply_move(p, map, pf, mv);
            }
        }
        if k == d.aim_before.min(n) {
            if let Some(a) = d.aim {
                weapons::set_aim(p, now, a);
            }
        }
        if let Some(cmd) = d.actions.get(k) {
            match *cmd {
                ActionCmd::Attack { a, t } => weapons::handle_press(p, now, a, t),
                ActionCmd::Release { a, t } => weapons::handle_release(p, now, a, t),
            }
        }
    }
}

fn apply_move(p: &mut Player, map: &TileMap, pf: &mut Pathfinder, mv: MoveCmd) {
    // cancelLockedWindup / dropLock: no target lock in the slice.
    let from = p.pos();
    let (path, stop, seq) = match mv {
        MoveCmd::Stop { seq } => (Vec::new(), true, seq),
        MoveCmd::Move { x, y, seq } => (plan_path(pf, map, from, Vec2::new(x, y)), false, seq),
    };
    if stop || !path.is_empty() {
        p.path = path;
    }
    if let Some(s) = seq {
        p.move_seq = s;
    }
}
