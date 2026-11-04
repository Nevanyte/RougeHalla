//! Melee resolution against rewound positions (legacy melee.ts).

use crate::constants::*;
use crate::content::{staggers, Shape, WeaponId};
use crate::events::Event;
use crate::geometry::ray_blocked;
use crate::map::MASK_MELEE;
use crate::math::{angle_between, asin, atan2, hypot, Vec2};
use crate::state::{Packet, PlayerId, World};
use crate::systems::ledger::Entry;
use crate::systems::weapons::weapon_shape;
use crate::scratch::TickScratch;
use crate::systems::Cx;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct MeleeReq {
    pub(crate) attacker: PlayerId,
    pub(crate) weapon: WeaponId,
    pub(crate) a: f64,
    pub(crate) rewind_t: f64,
    pub(crate) packet: Packet,
}

/// System (legacy melee.resolveMelee): every swing that landed this tick, tested against the bodies standing at its
/// rewound time; each contact joins the ledger. Reads the world (it moves nobody and damages nobody); the melee queue
/// is empty afterwards.
pub(crate) fn resolve(cx: &mut Cx) {
    let Cx { k, w, s, ev, .. } = cx;
    let w: &World = w;
    let TickScratch {
        melee,
        ledger,
        bodies,
        ..
    } = &mut **s;
    if melee.is_empty() {
        return;
    }
    bodies.clear();
    bodies.extend((0..w.players.len()).filter(|&i| w.players[i].standing()));
    for req in melee.iter() {
        let Some(ai) = w.idx(req.attacker) else {
            continue;
        };
        if !w.players[ai].standing() {
            continue;
        }
        let Shape::Arc { reach, half_arc } = weapon_shape(req.weapon) else {
            continue;
        };
        let origin = w.players[ai].position_at(req.rewind_t);
        ev.push(Event::Swing {
            by: req.attacker,
            weapon: req.weapon,
            x: origin.x,
            y: origin.y,
            a: req.a,
        });
        for &ti in bodies.iter() {
            if ti == ai {
                continue;
            }
            let at = w.players[ti].position_at(req.rewind_t);
            if !in_arc(origin, req.a, reach, half_arc, at, PLAYER_RADIUS) {
                continue;
            }
            if ray_blocked(&k.arena.map, origin.x, origin.y, at.x, at.y, MASK_MELEE) {
                continue;
            }
            // Shields (block/riposte) need a shield in hand: no item flow in the slice (docs/backlog P-COMBAT-1).
            let victim = w.players[ti].id;
            ledger.push(Entry {
                victim,
                by: req.attacker,
                packet: req.packet,
                weapon: req.weapon,
                stagger: staggers(req.weapon),
            });
        }
    }
    melee.clear();
}

/// Is `p` (a disc of radius `r`) inside the arc? Legacy `inArc`.
pub fn in_arc(origin: Vec2, a: f64, reach: f64, half_arc: f64, p: Vec2, r: f64) -> bool {
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    let d = hypot(dx, dy);
    if d <= r {
        return true;
    }
    if d > reach + r {
        return false;
    }
    angle_between(atan2(dy, dx), a) <= half_arc + asin((r / d).min(1.0)) + ARC_EPS
}
