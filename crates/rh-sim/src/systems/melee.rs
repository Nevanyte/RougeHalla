//! Melee resolution against rewound positions (legacy melee.ts).

use crate::constants::*;
use crate::content::{staggers, Shape, WeaponId};
use crate::events::Event;
use crate::fighter::FighterIx;
use crate::geometry::{arc_hits_box, ray_blocked};
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
    let Cx {
        k, w, s, ev, stats, ..
    } = cx;
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
            .filter(|&ix| w.standing(ix) && !crate::quests::giver::is_giver(w, w.core(ix).id)),
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
            // Source: ordinary camp-mates still meet bodies/shields and record zero-scaled hits. Only allied
            // pairs involving an owned zombie are transparent, before any per-target crit/armed mutation.
            if !super::plague_zombies::hostile(w, req.attacker, w.core(ti).id)
                && [req.attacker, w.core(ti).id]
                    .into_iter()
                    .any(|id| w.mobs.get(id).is_some_and(|m| m.zombie.is_some()))
            {
                continue;
            }
            let at = if shared {
                rewound[bi]
            } else {
                w.core(ti).position_at(req.rewind_t)
            };
            let reached = reaches(origin, req.a, reach, half_arc, at, w.core(ti).hull());
            if !reached {
                continue;
            }
            if ray_blocked(
                k.collision_map(w.rt.gates_locked),
                origin.x,
                origin.y,
                at.x,
                at.y,
                MASK_MELEE,
            ) {
                continue;
            }
            let mut packet = req.packet;
            let mut critical = false;
            let mut critical_mult = None;
            if let Some(ai) = w.idx(req.attacker) {
                let mut baked = 1.;
                if crate::cards::roll_attack_crit(&mut w.players[ai]) {
                    critical = true;
                    baked *= crate::status_runtime::stats::CRIT_MULT;
                }
                // Plant Your Feet: an armed attack carries its bonus and spends the clock.
                if crate::cards::plant_armed(&w.players[ai], w.server_time) {
                    baked *= 1. + crate::constants::PLANT_FEET_BONUS;
                    crate::cards::spend_plant(&mut w.players[ai], w.server_time);
                }
                if baked > 1. {
                    packet.raw *= baked;
                    critical_mult = Some(baked);
                }
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
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical,
                critical_mult,
                sig: None,
                execute: false,
                victim: target.id,
                by: Some(req.attacker),
                packet,
                weapon: Some(req.weapon),
                stagger: staggers(req.weapon),
                projectile: None,
                scale: 1.0,
                derived: false,
                passive: false,
            };
            if blocked {
                // Recorded in every world: the faction layer reads the contact (its rows are gated on it), Best Offense's
                // pending note the hook (cardHooks.onBlocked; melee.ts:83 fires it for every melee block).
                blocks.push(crate::systems::signatures::BlockContact {
                    attacker: req.attacker,
                    holder: target.id,
                    passive: false,
                    hooked: true,
                });
                ev.push(Event::Block {
                    id: target.id,
                    by: req.attacker,
                    weapon: req.weapon,
                    passive: false,
                });
                let holder = target.id;
                crate::hooks::fire(
                    &mut crate::hooks::Hx {
                        k,
                        w,
                        ev,
                        stats: *stats,
                        fx: None,
                    },
                    crate::hooks::HookArgs::Blocked {
                        holder,
                        attacker: req.attacker,
                        prevented: Packet {
                            raw: req.packet.raw * SHIELD_BLOCK_SHARE,
                            ..req.packet
                        },
                        melee: true,
                    },
                );
                if req.weapon == WeaponId::Sword {
                    // Read after the hook, as the source records the riposte after `blocked` returns.
                    let riposte_returned = w
                        .fighter_idx(holder)
                        .map_or(1., |i| w.core(i).modifiers.returned_mult());
                    super::ledger::record_hit(
                        w,
                        ledger,
                        Entry {
                            terrain: false,
                            dot: false,
                            ability: None,
                            arena: false,
                            source: None,
                            critical: false,
                            critical_mult: None,
                            sig: None,
                            execute: false,
                            victim: req.attacker,
                            by: Some(holder),
                            // Source melee.ts:88: returned damage carries the holder's `returned` mult (Boom's x1.25),
                            // `raw * SHIELD_BLOCK_SHARE * riposteShare() * returnedMultOf(target.s)`.
                            packet: Packet {
                                raw: req.packet.raw
                                    * SHIELD_BLOCK_SHARE
                                    * RIPOSTE_SHARE
                                    * riposte_returned,
                                ..req.packet
                            },
                            weapon: Some(WeaponId::Shield),
                            stagger: false,
                            projectile: None,
                            scale: 1.0,
                            derived: false,
                            passive: true,
                        },
                    );
                }
                entry.packet.raw *= 1.0 - SHIELD_BLOCK_SHARE;
                entry.stagger = false;
            }
            super::ledger::record_hit(w, ledger, entry);
        }
        super::projectiles::meet_balls(
            w,
            flight,
            ledger,
            ev,
            k.collision_map(w.rt.gates_locked),
            req,
            (reach, half_arc),
        );
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

/// Does a swing from `origin` along `a` reach a target with feet at `at` and hitbox `hull`? ADR0024 Decision 5:
/// * a legacy circle is today's disc test (`in_arc` with `PLAYER_RADIUS`), bit for bit;
/// * a body box is tested from the attacker's feet raised by the TARGET's chest (the box centre), so reach is even north
///   and south for every pair: the arc must meet the box within reach and within its angular span;
/// * but when that raised origin is already inside the target's box (the two overlap on screen), the target is resolved
///   with the legacy disc test against its feet instead, so the facing-independent zone stays legacy's 12 u disc and a
///   target behind the attacker is not hit (review finding 2). The two agree for every target in front: inside the box
///   the target's feet are at most 44 u away (skeleton), well within the shortest legacy reach (fists, 72 + 12).
pub fn reaches(
    origin: Vec2,
    a: f64,
    reach: f64,
    half_arc: f64,
    at: Vec2,
    hull: &crate::archetype::Archetype,
) -> bool {
    match hull.body_box(at) {
        None => in_arc(origin, a, reach, half_arc, at, PLAYER_RADIUS),
        Some(body) => {
            let o = Vec2::new(origin.x, origin.y + hull.body_oy());
            if body.contains(o) {
                in_arc(origin, a, reach, half_arc, at, PLAYER_RADIUS)
            } else {
                arc_hits_box(o, a, reach, half_arc, body)
            }
        }
    }
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

#[cfg(test)]
mod contact_controls;
