//! Melee resolution against rewound positions (legacy melee.ts).

use crate::constants::*;
use crate::content::{staggers, Shape, WeaponId};
use crate::events::Event;
use crate::fighter::FighterIx;
use crate::geometry::ray_blocked;
use crate::map::MASK_MELEE;
use crate::math::{angle_between, asin, atan2, hypot, Vec2};
use crate::scratch::TickScratch;
use crate::state::{Packet, PlayerId, World};
use crate::systems::ledger::Entry;
use crate::systems::weapons::weapon_shape;
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
#[inline]
pub(crate) fn resolve(cx: &mut Cx) {
    // Most ticks have no swing: the empty test comes before the frame of the pass that has the work.
    if !cx.s.melee.is_empty() {
        resolve_swings(cx);
    }
}

#[inline(never)]
fn resolve_swings(cx: &mut Cx) {
    let Cx { k, w, s, ev, .. } = cx;
    let w: &mut World = w;
    let TickScratch {
        melee,
        ledger,
        blocks,
        bodies,
        flight,
        rewound,
        ..
    } = &mut **s;
    bodies.clear();
    bodies.extend(
        (0..w.fighter_count())
            .map(FighterIx::of_slot)
            .filter(|&ix| w.standing(ix)),
    );
    // When two swings share a rewind time (every bot swing in a tick does) the bodies' rewound positions are computed once per
    // run of equal times (exact bits) and the swings read them. `position_at` is a pure function of a world this system does
    // not change, so a reused value is the very same `Vec2`. Swings that all differ (one swing, or humans with their own lag)
    // keep the direct path, which has no table to fill.
    let shared = repeats_a_time(melee);
    let mut rewound_t: Option<u64> = None;
    for req in melee.iter() {
        let Some(ai) = w.fighter_idx(req.attacker) else {
            continue;
        };
        if !w.standing(ai) {
            continue;
        }
        let Shape::Arc { reach, half_arc } = weapon_shape(req.weapon) else {
            continue;
        };
        if shared && rewound_t != Some(req.rewind_t.to_bits()) {
            rewound.clear();
            rewound.extend(
                bodies
                    .iter()
                    .map(|&ix| w.core(ix).position_at(req.rewind_t)),
            );
            rewound_t = Some(req.rewind_t.to_bits());
        }
        // The attacker stands, so it is one of `bodies` (ascending slots).
        let origin = match shared.then(|| bodies.binary_search(&ai)) {
            Some(Ok(k)) => rewound[k],
            _ => w.core(ai).position_at(req.rewind_t),
        };
        ev.push(Event::Swing {
            by: req.attacker,
            weapon: req.weapon,
            x: origin.x,
            y: origin.y,
            a: req.a,
        });
        for (bi, &ti) in bodies.iter().enumerate() {
            if ti == ai {
                continue;
            }
            let at = if shared {
                rewound[bi]
            } else {
                w.core(ti).position_at(req.rewind_t)
            };
            if !in_arc(origin, req.a, reach, half_arc, at, PLAYER_RADIUS) {
                continue;
            }
            if ray_blocked(&k.arena.map, origin.x, origin.y, at.x, at.y, MASK_MELEE) {
                continue;
            }
            let target = w.core(ti);
            let dx = origin.x - at.x;
            let dy = origin.y - at.y;
            let blocked = matches!(req.weapon, WeaponId::Sword | WeaponId::Shield)
                && target.active_weapon() == WeaponId::Shield
                && ((dx == 0.0 && dy == 0.0)
                    || angle_between(atan2(dy, dx), target.body.facing)
                        <= SHIELD_HALF_ARC + ARC_EPS);
            let mut entry = Entry {
                sig: None,
                execute: false,
                victim: target.id,
                by: Some(req.attacker),
                packet: req.packet,
                weapon: Some(req.weapon),
                stagger: staggers(req.weapon),
                projectile: None,
                scale: 1.0,
                derived: false,
                passive: false,
            };
            if blocked {
                if k.config.faction_mode.engagement() {
                    blocks.push(crate::systems::signatures::BlockContact {
                        attacker: req.attacker,
                        holder: target.id,
                        passive: false,
                    });
                }
                ev.push(Event::Block {
                    id: target.id,
                    by: req.attacker,
                    weapon: req.weapon,
                    passive: false,
                });
                if req.weapon == WeaponId::Sword {
                    ledger.push(Entry {
                        sig: None,
                        execute: false,
                        victim: req.attacker,
                        by: Some(target.id),
                        packet: Packet {
                            raw: req.packet.raw * SHIELD_BLOCK_SHARE * RIPOSTE_SHARE,
                            ..req.packet
                        },
                        weapon: Some(WeaponId::Shield),
                        stagger: false,
                        projectile: None,
                        scale: 1.0,
                        derived: false,
                        passive: true,
                    });
                }
                entry.packet.raw *= 1.0 - SHIELD_BLOCK_SHARE;
                entry.stagger = false;
            }
            ledger.push(entry);
        }
        super::projectiles::meet_balls(w, flight, ledger, ev, &k.arena.map, req, (reach, half_arc));
    }
    melee.clear();
}

/// Does any of the first swings have the rewind time (exact bits) of an earlier one?
fn repeats_a_time(melee: &[MeleeReq]) -> bool {
    melee.iter().take(16).enumerate().any(|(i, r)| {
        melee[..i]
            .iter()
            .any(|q| q.rewind_t.to_bits() == r.rewind_t.to_bits())
    })
}

/// Is `p` (a disc of radius `r`) inside the arc? Legacy `inArc`.
pub fn in_arc(origin: Vec2, a: f64, reach: f64, half_arc: f64, p: Vec2, r: f64) -> bool {
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    // A target far outside the reach is out whatever its bearing: decided on the squared distance with a margin far above
    // any rounding error (1e-9 relative on the radius against ~1e-16), which is the same verdict `d > reach + r` gives
    // below without the hypot call. Anything near the edge falls through to the exact test.
    let far = (reach + r) * (1.0 + 1e-9);
    if reach >= 0.0 && dx * dx + dy * dy > far * far {
        return false;
    }
    let d = hypot(dx, dy);
    if d <= r {
        return true;
    }
    if d > reach + r {
        return false;
    }
    angle_between(atan2(dy, dx), a) <= half_arc + asin((r / d).min(1.0)) + ARC_EPS
}
