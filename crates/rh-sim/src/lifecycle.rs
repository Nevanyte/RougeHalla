//! Replayable administrative seat lifecycle, below the Sim facade.
use crate::{
    hooks::{self, HookArgs, Hx, OutCause},
    state::{Phase, PlayerId, World},
    systems::{self, Cx},
};
pub(crate) fn dropped(w: &mut World, id: PlayerId, dropped: bool) {
    let now = w.server_time;
    let active = w.phase == Phase::Active;
    let held = active || w.phase == Phase::Planning;
    let locked = w.rt.gates_locked;
    if let Some(i) = w.idx(id) {
        let p = &mut w.players[i];
        if dropped {
            if p.seat.dropped_at.is_none() && held {
                p.seat.dropped_at = Some(now);
            }
            p.inputs.clear();
        } else {
            p.seat.dropped_at = None;
            if active {
                crate::vision::refresh_player(p, w.tick, locked);
            }
        }
        systems::weapons::release_trigger(p, now);
    }
}
fn removed_hook(cx: &mut Cx, id: PlayerId) {
    hooks::fire(
        &mut Hx {
            stats: Default::default(),
            fx: None,
            k: cx.k,
            w: cx.w,
            ev: cx.ev,
        },
        HookArgs::FighterOut {
            id,
            cause: OutCause::Removed,
        },
    );
}
pub(crate) fn remove(cx: &mut Cx, id: PlayerId) {
    let index = cx.w.idx(id);
    if index.is_none() && cx.k.config.lifecycle.rules().is_none() {
        return;
    }
    if let Some(i) = index {
        if cx.w.phase == Phase::Active {
            systems::settle::down_player(cx.k, cx.w, cx.ev, None, i, crate::Outcome::Mia);
        } else if cx.w.phase == Phase::Planning {
            systems::settle::miss_in_planning(cx.w, cx.ev, i);
        }
    }
    removed_hook(cx, id);
    cx.w.players.remove(id);
    systems::planning::leave(cx.w, cx.ev, id);
}
pub(crate) fn abandon(cx: &mut Cx, id: PlayerId) -> u32 {
    let index = cx.w.idx(id);
    if index.is_none() && cx.k.config.lifecycle.rules().is_none() {
        return 0;
    }
    let gv = index.map_or(0, |i| {
        let p = &mut cx.w.players[i];
        let gv = if p.resolved {
            0
        } else {
            let g = p.credit.gv_parts;
            g.kills
                .saturating_add(g.mobs)
                .saturating_add(g.bounty)
                .saturating_add(g.quest)
        };
        p.resolved = true;
        gv
    });
    if matches!(cx.w.phase, Phase::Active | Phase::Planning) {
        cx.w.rt.voided = true;
    }
    removed_hook(cx, id);
    cx.w.players.remove(id);
    systems::planning::leave(cx.w, cx.ev, id);
    gv
}
