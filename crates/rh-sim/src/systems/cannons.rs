//! The travel-cannon action (legacy `consumables.ts useCannon`), the pickup handler's cannon branch.
//!
//! The source order is preserved exactly: the arena gate lock, the reload clock, the cannot-move status check, the
//! landing disc validation, the reload stamp, the path clear, the displacement, the queued-input drain, the
//! target/attack-move/held clears, `weaponChanged` and the toast. No new schedule row: the source dispatches it from the
//! pickup action handler, so it runs inside the same `loot.handlePickup` slot.

use crate::constants::{CANNON_COOLDOWN_MS, PLAYER_RADIUS};
use crate::events::{CannonNotice, Event};
use crate::fighter::FighterIx;
use crate::map::MASK_MOVE;
use crate::systems::{displace, items, Cx};

/// The source's `useCannon`, called after the ordinary reach/line-of-sight pickup admission.
pub(crate) fn use_cannon(cx: &mut Cx, ix: FighterIx, i: usize) {
    let now = cx.w.server_time;
    let id = cx.w.core(ix).id;
    // Source: cannons are sealed during the coliseum fight.
    if cx.w.rt.gates_locked {
        cx.ev.push(Event::CannonNotice {
            id,
            notice: CannonNotice::Sealed,
        });
        return;
    }
    // Source: the whole-second rounded-up reload notice (a large remaining clock still renders exactly).
    let ready_at = cx.w.containers[i].ready_at;
    if ready_at > now {
        let seconds = ((ready_at - now) / 1000.).ceil().clamp(0., u32::MAX as f64) as u32;
        cx.ev.push(Event::CannonNotice {
            id,
            notice: CannonNotice::Reloading { seconds },
        });
        return;
    }
    // Source: a stun or an unfinished cast refuses before the destination is looked at.
    if crate::status_runtime::cannot_move(&cx.w.core(ix).statuses, now) {
        cx.ev.push(Event::CannonNotice {
            id,
            notice: CannonNotice::CantEnter,
        });
        return;
    }
    let Some(landing) = cx.w.containers[i].target else {
        return;
    };
    // The source silently declines a blocked landing; this is not a refusal toast. A standing wall blocks it too
    // (legacy `collisionMap` carries the barrier overlay, P-FROST-WALL-1c).
    if !crate::geometry::circle_clear(
        crate::barriers::body_map(cx.k, &crate::barriers::held(cx.w), cx.w.rt.gates_locked),
        landing,
        PLAYER_RADIUS,
        MASK_MOVE,
    ) {
        return;
    }
    // Source order from here: box.readyAt first, then path = [], displace, inputs.drain(), the lock/attack-move/held
    // clears, the attack-target mirror clear, weaponChanged, toast.
    cx.w.containers[i].ready_at = now + CANNON_COOLDOWN_MS;
    cx.w.core_mut(ix).motion.path.clear();
    displace::apply(cx.k, cx.w, cx.pf, id, landing);
    let p = cx.w.core_mut(ix);
    p.inputs.clear();
    p.weapon.targeting.target = None;
    p.weapon.targeting.attack_move = None;
    p.weapon.held = false;
    items::weapon_changed(p, now);
    cx.ev.push(Event::CannonNotice {
        id,
        notice: CannonNotice::Blast,
    });
}
