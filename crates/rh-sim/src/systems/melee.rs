//! Melee resolution against rewound positions (legacy melee.ts).

use crate::constants::*;
use crate::content::{Shape, WeaponId};
use crate::geometry::raycast;
use crate::map::MASK_MELEE;
use crate::math::{angle_between, asin, atan2, hypot, Vec2};
use crate::sim::{Event, Packet, PlayerId, Sim};
use crate::systems::ledger::Entry;
use crate::systems::weapons::weapon_shape;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct MeleeReq {
    pub(crate) attacker: PlayerId,
    pub(crate) weapon: WeaponId,
    pub(crate) a: f64,
    pub(crate) rewind_t: f64,
    pub(crate) packet: Packet,
}

impl Sim {
    pub(crate) fn resolve_melee(&mut self) {
        let reqs = std::mem::take(&mut self.s.melee);
        if reqs.is_empty() {
            return;
        }
        let bodies: Vec<usize> = (0..self.w.players.len())
            .filter(|&i| self.w.players[i].standing())
            .collect();
        for req in reqs {
            let Some(ai) = self.idx(req.attacker) else {
                continue;
            };
            if !self.w.players[ai].standing() {
                continue;
            }
            let Shape::Arc { reach, half_arc } = weapon_shape(req.weapon) else {
                continue;
            };
            let origin = self.w.players[ai].position_at(req.rewind_t);
            self.emit(Event::Swing {
                by: req.attacker,
                weapon: req.weapon,
                x: origin.x,
                y: origin.y,
                a: req.a,
            });
            for &ti in &bodies {
                if ti == ai {
                    continue;
                }
                let at = self.w.players[ti].position_at(req.rewind_t);
                if !in_arc(origin, req.a, reach, half_arc, at, PLAYER_RADIUS) {
                    continue;
                }
                if raycast(
                    &self.k.arena.map,
                    origin.x,
                    origin.y,
                    at.x,
                    at.y,
                    MASK_MELEE,
                )
                .hit
                {
                    continue;
                }
                // Shields (block/riposte) need a shield in hand: no item flow in the slice (docs/backlog P-COMBAT-1).
                let victim = self.w.players[ti].id;
                let by_name = self.w.players[ai].name.clone();
                self.s.ledger.push(Entry {
                    victim,
                    by: req.attacker,
                    by_name,
                    packet: req.packet,
                    weapon: req.weapon,
                    stagger: req.weapon == WeaponId::Sword,
                });
            }
        }
    }
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
    angle_between(atan2(dy, dx), a) <= half_arc + asin((r / d).min(1.0)) + 1e-9
}
