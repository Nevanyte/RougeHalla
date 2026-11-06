//! Sentenced hunt (legacy `sentencedHunt.ts`): selection, the toward-target walk bonus,
//! completed-hunt Mark stacks and the selected actor's visibility exception.
use crate::constants::*;
use crate::content::FactionId;
use crate::events::{Event, MarkNotice};
use crate::fighter::FighterIx;
use crate::hooks::{HookArgs, Hx, OutCause};
use crate::math::hypot;
use crate::state::{Phase, Player, Status, World};
use crate::systems::Cx;
use crate::{input::ActionCmd, statics::MatchStatic};

/// Whether `target` is the living rival `viewer` selected. The source requires an active,
/// non-training Sentenced viewer; the caller is already inside an active tick.
pub(crate) fn sees_target(viewer: &Player, target: &Player) -> bool {
    viewer.standing()
        && viewer.vitals.faction == FactionId::Sentenced
        && viewer.hunt_target() == Some(target.id)
        && target.status == Status::Alive
}

/// The one-selection rule: a living target cannot be replaced, but a dead or absent one can.
pub(crate) fn target(cx: &mut Cx, ix: FighterIx, cmd: &ActionCmd) {
    let ActionCmd::HuntTarget { id } = *cmd else {
        return;
    };
    if !cx.k.config.faction_mode.sentenced() || cx.w.phase != Phase::Active {
        return;
    }
    let hunter_id = cx.w.core(ix).id;
    let Some(hi) = cx.w.idx(hunter_id) else {
        return;
    };
    let hunter = &cx.w.players[hi];
    if !hunter.standing() || hunter.vitals.faction != FactionId::Sentenced {
        return;
    }
    if hunter
        .hunt_target()
        .and_then(|current| cx.w.player(current))
        .is_some_and(|current| current.standing())
    {
        return;
    }
    let Some(ti) = cx.w.idx(id) else {
        return;
    };
    if id == hunter_id || !cx.w.players[ti].standing() {
        return;
    }
    cx.w.players[hi].set_hunt_target(Some(id));
    cx.ev.push(Event::MarkNotice {
        recipient: hunter_id,
        notice: MarkNotice::Hunting { target: id },
    });
}

/// Legacy `huntMoveMultiplier`: +5% while the next route leg points clearly at the living rival.
pub(crate) fn movement(
    k: &MatchStatic,
    w: &World,
    ix: FighterIx,
    _dt_ms: f64,
    _stats: crate::status_runtime::StatView,
) -> f64 {
    if !k.config.faction_mode.sentenced() || !w.is_player(ix) {
        return 1.;
    }
    let p = &w.players[ix.slot()];
    if !p.standing() || p.vitals.faction != FactionId::Sentenced {
        return 1.;
    }
    let Some(target_id) = p.hunt_target() else {
        return 1.;
    };
    let Some(target) = w.player(target_id) else {
        return 1.;
    };
    if !target.standing() {
        return 1.;
    }
    let Some(next) = p.motion.path.first() else {
        return 1.;
    };
    if toward(p.pos(), target.pos(), next) {
        1. + SENTENCED_HUNT_MOVE_BONUS
    } else {
        1.
    }
}

/// Source `isMovingTowardHuntTarget`: normalized dot above the threshold, both vectors nonzero.
fn toward(from: crate::math::Vec2, target: crate::math::Vec2, next: crate::math::Vec2) -> bool {
    let (vx, vy) = (next.x - from.x, next.y - from.y);
    let (tx, ty) = (target.x - from.x, target.y - from.y);
    let speed = hypot(vx, vy);
    let distance = hypot(tx, ty);
    if !(speed > 1e-6) || !(distance > 1e-6) {
        return false;
    }
    (vx * tx + vy * ty) / (speed * distance) > SENTENCED_HUNT_TOWARD_DOT
}

/// `fighterOut`: clear the departing player's own selection; a real death rewards every other
/// living Sentenced hunter tracking it, while a removal/MIA only clears.
pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::FighterOut { id, cause } = *args else {
        return;
    };
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    let Some(vi) = hx.w.idx(id) else {
        return;
    };
    let real_death = cause == OutCause::Down
        && hx.w.players[vi].status == Status::Dead
        && hx.w.phase == Phase::Active;
    hx.w.players[vi].set_hunt_target(None);
    for hi in 0..hx.w.players.len() {
        if hx.w.players[hi].hunt_target() != Some(id) {
            continue;
        }
        hx.w.players[hi].set_hunt_target(None);
        let hunter = &hx.w.players[hi];
        if !real_death || hunter.id == id || !hunter.standing() {
            continue;
        }
        if hunter.vitals.faction != FactionId::Sentenced {
            continue;
        }
        let hunter_id = hunter.id;
        let stacks = hx.w.players[hi].hunt_stacks.saturating_add(1);
        hx.w.players[hi].hunt_stacks = stacks;
        hx.ev.push(Event::MarkNotice {
            recipient: hunter_id,
            notice: MarkNotice::HuntComplete {
                stacks: u32::from(stacks),
            },
        });
    }
}

/// `runEnded`: selections do not survive the run; completed-hunt stacks are run state and go with it.
pub(crate) fn run_ended(hx: &mut Hx, _args: &HookArgs) {
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    for p in &mut hx.w.players {
        p.set_hunt_target(None);
    }
}

/// Source `sentencedHuntMarkMultiplier`: completed hunts scale Mark strength without a cap.
pub(crate) fn mark_multiplier(stacks: u32) -> f64 {
    1. + SENTENCED_HUNT_MARK_PER_STACK * f64::from(stacks)
}

#[cfg(test)]
mod tests;
