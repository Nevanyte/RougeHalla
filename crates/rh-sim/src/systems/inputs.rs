//! The seats' inputs: how a command reaches a queue (`submit`, C-INPUT) and how the queues are applied in the secret action
//! order (legacy step.ts `actionOrder`, `applyInputs`).
//!
//! Touches each fighter's inputs, path, move ack and weapon trigger; writes the tick's action-order ranks; reads the
//! order salt, the clock and the collision map, and searches paths. A queued action is run by its handler in the
//! schedule's `ACTIONS` table (legacy `world.actions[kind]`).

use crate::fighter::{FighterCore, FighterIx};
use crate::input::{self, ActionCmd, Command, MoveCmd, Reject};
use crate::map::TileMap;
use crate::math::Vec2;
use crate::pathfind::{plan_path_into, Pathfinder};
use crate::rng::action_order_in_place;
use crate::schedule::{self, ActionId};
use crate::state::{PlayerId, World};
use crate::systems::{weapons, Cx};

/// Queues a validated command for the next tick through the seat's order budget (sim time): what `Sim::submit` and
/// `Cx::submit` both run, the only way a command reaches a queue (C-INPUT). A seat that is not present drops it.
pub(crate) fn submit(w: &mut World, id: PlayerId, cmd: Command) -> Result<(), Reject> {
    let now = w.server_time;
    let Some(ix) = w.fighter_idx(id) else {
        return Ok(());
    };
    if !w.is_player(ix)
        && !cmd.is_foundation_movement()
        && (!cmd.is_mob_combat() || w.mob_runtime.as_ref().is_none_or(|m| !m.combat))
    {
        return Err(Reject::UnsupportedActorAction);
    }
    let (queue, budget) = w.intake(ix);
    input::accept(queue, budget, cmd, now)
}

/// Queues a command with no order budget: the parity harness only (the legacy capture fed the sim directly).
pub(crate) fn submit_unbudgeted(w: &mut World, id: PlayerId, cmd: Command) -> Result<(), Reject> {
    let now = w.server_time;
    let Some(ix) = w.fighter_idx(id) else {
        return Ok(());
    };
    if !w.is_player(ix)
        && !cmd.is_foundation_movement()
        && (!cmd.is_mob_combat() || w.mob_runtime.as_ref().is_none_or(|m| !m.combat))
    {
        return Err(Reject::UnsupportedActorAction);
    }
    let (queue, _) = w.intake(ix);
    input::accept(queue, None, cmd, now)
}

/// System (legacy step.actionOrder): the tick's secret action order, kept as slots in apply order (`action_order`) and as
/// each slot's place in it (`rank`, dense by slot): the order the inputs apply in and the rank of kill credit among a
/// victim's hits.
pub(crate) fn action_order(cx: &mut Cx) {
    let Cx { k, w, s, .. } = cx;
    // The join order (slot order), shuffled in place by the secret order; a slot's rank is its place in the result.
    s.action_order.clear();
    s.action_order.extend(0..w.players.len() as u32);
    action_order_in_place(k.secrets.order_salt, w.tick, &mut s.action_order);
    // The order is a permutation of the slots, so every entry is overwritten below: only a change of size needs a fill.
    if s.rank.len() != w.players.len() {
        s.rank.clear();
        s.rank.resize(w.players.len(), 0);
    }
    for (r, &slot) in s.action_order.iter().enumerate() {
        s.rank[slot as usize] = r as u32;
    }
}

/// System (legacy step.applyInputs for players): every present player's queued inputs, in the action order.
pub(crate) fn apply_players(cx: &mut Cx) {
    for r in 0..cx.s.action_order.len() {
        let ix = FighterIx(cx.s.action_order[r]);
        apply_inputs(cx, ix);
    }
}

pub(crate) fn apply_mobs(cx: &mut Cx) {
    for slot in 0..cx.w.mobs.len() {
        apply_inputs(cx, FighterIx::of_slot(cx.w.players.len() + slot));
    }
}
/// Drops every queued input (lobby and ended phases: nothing is applied there).
pub(crate) fn drain_all(cx: &mut Cx) {
    for i in 0..cx.w.fighter_count() {
        cx.w.core_mut(FighterIx::of_slot(i)).inputs.clear();
    }
}

fn apply_inputs(cx: &mut Cx, ix: FighterIx) {
    let now = cx.w.server_time;
    let map = cx.k.collision_map(cx.w.rt.gates_locked);
    cx.w.core_mut(ix).inputs.drain_into(&mut cx.s.drained);
    if !cx.w.is_player(ix)
        && crate::status_runtime::has(
            &cx.w.core(ix).statuses.instances,
            crate::status_runtime::StatusKind::Stun,
            now,
        )
    {
        return;
    }
    let (mv, aim) = (cx.s.drained.mv, cx.s.drained.aim);
    let (move_before, aim_before) = (cx.s.drained.move_before, cx.s.drained.aim_before);
    let n = cx.s.drained.actions.len();
    for k in 0..=n {
        if !cx.w.alive(ix) {
            return;
        }
        if k == move_before.min(n) {
            if let Some(mv) = mv {
                apply_move(cx.w.core_mut(ix), map, cx.pf, &mut cx.s.path, mv);
            }
        }
        if k == aim_before.min(n)
            && cx.w.core(ix).weapon.targeting.target.is_none()
            && !crate::status_runtime::has(
                &cx.w.core(ix).statuses.instances,
                crate::status_runtime::StatusKind::Stun,
                now,
            )
        {
            if let Some(a) = aim {
                weapons::set_aim(cx.w.core_mut(ix), now, a);
            }
        }
        if let Some(cmd) = cx.s.drained.actions.get(k).copied() {
            if let Some(id) = action_id(&cmd) {
                schedule::run_action(cx, id, ix, &cmd);
            }
        }
    }
}

fn action_id(cmd: &ActionCmd) -> Option<ActionId> {
    Some(match cmd {
        ActionCmd::Plan { .. } => return None,
        ActionCmd::Cast { .. } => ActionId::Cast,
        ActionCmd::UseConsumable => ActionId::UseConsumable,
        ActionCmd::Choose { .. } => ActionId::Choose,
        ActionCmd::Target { .. } | ActionCmd::MissingTarget => ActionId::Target,
        ActionCmd::HuntTarget { .. } => ActionId::HuntTarget,
        ActionCmd::Swap { .. } => ActionId::Swap,
        ActionCmd::Pickup { .. } | ActionCmd::MissingPickup => ActionId::Pickup,
        ActionCmd::Attack { .. } => ActionId::Attack,
        ActionCmd::Release { .. } => ActionId::Release,
    })
}

fn apply_move(
    p: &mut FighterCore,
    map: &TileMap,
    pf: &mut Pathfinder,
    out: &mut Vec<Vec2>,
    mv: MoveCmd,
) {
    // Move/stop preserve a committed ranged cast. Only a wand can have a targeted pending action.
    super::targeting::drop_lock(p);
    let from = p.pos();
    let (stop, seq) = match mv {
        MoveCmd::Stop { seq } => {
            out.clear();
            (true, seq)
        }
        MoveCmd::Move { x, y, seq } | MoveCmd::AttackMove { x, y, seq } => {
            plan_path_into(pf, map, from, Vec2::new(x, y), out);
            (false, seq)
        }
    };
    // An order with no route (a goal in a wall with nothing to snap to) leaves the current path alone.
    if stop || !out.is_empty() {
        p.motion.path.set_from(out);
    }
    p.weapon.targeting.attack_move = match mv {
        MoveCmd::AttackMove { x, y, .. }
            if !out.is_empty()
                || crate::math::hypot(x - from.x, y - from.y)
                    <= crate::constants::ATTACK_MOVE_ARRIVAL =>
        {
            Some(Vec2::new(x, y))
        }
        _ => None,
    };
    if let Some(s) = seq {
        p.motion.move_seq = s;
    }
}
