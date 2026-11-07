//! cardHooks.afterDamage: the card-state streak memory hears of the tick's weapon hits.
//!
//! Source: `packages/server/src/sim/cardHooks.ts` (`afterDamage` → `noteStreak`). Entries read the pass-start memory
//! (`cards::streak_before`); this system is the only writer. Hits are grouped by attacker first and every decision depends
//! on the group alone: the streak keeps its target if it was hit this tick (one more per hit), else it restarts on the
//! biggest hit (ties by the source tick hash rank).
use crate::cards::Streak;
use crate::constants::STREAK_GAP_MS;
use crate::state::{PlayerId, World};
use crate::systems::signatures::LandedHit;
use crate::systems::Cx;

/// A weapon hit: not a DoT, an ability, a signature or a returned/follow-on packet (source `isWeaponHit`).
fn is_weapon_hit(h: &LandedHit) -> bool {
    h.by.is_some() && h.weapon.is_some() && h.sig.is_none() && h.ability.is_none() && !h.dot
}

/// Source `tieRank`: orderSalt ^ imul(tick, 0x9e3779b1), FNV-folded over the actor id chars, through mulberry32.
fn tie_rank(w: &World, order_salt: u32, tick: u32, id: PlayerId) -> f64 {
    let mut h = order_salt ^ tick.wrapping_mul(0x9e37_79b1);
    if let Some(label) = w.roster.label(id) {
        for b in label.as_bytes() {
            h = (h ^ u32::from(*b)).wrapping_mul(0x0100_0193);
        }
    }
    crate::rng::Mulberry32::new(h).next_f64()
}

fn sum_for(landed: &[LandedHit], by: PlayerId, victim: PlayerId) -> (f64, u32) {
    let mut sum = 0.;
    let mut n = 0;
    for h in landed {
        if h.by == Some(by) && h.victim == victim && is_weapon_hit(h) {
            sum += h.amount;
            n += 1;
        }
    }
    (sum, n)
}

pub(crate) fn after_damage(cx: &mut Cx) {
    let Cx { k, w, s, .. } = cx;
    let now = w.server_time;
    let tick = w.tick;
    let order_salt = k.secrets.order_salt;
    let landed = &s.landed;
    let blocks = &s.blocks;
    for i in 0..w.players.len() {
        let by = w.players[i].id;
        let best_offense = w.players[i]
            .build
            .has_flag(crate::stat_fold::EffectFlag::BlockHits);
        // Wishful Thinking hears the same group: every weapon hit (and Best Offense block) shortens a cast Wish.
        let mut n_total = 0u32;
        for h in landed.iter() {
            if h.by == Some(by) && is_weapon_hit(h) {
                n_total += 1;
            }
        }
        if best_offense {
            n_total += blocks
                .iter()
                .filter(|b| b.holder == by && !b.passive)
                .count() as u32;
        }
        let mut wish_ms = 0.;
        for id in w.players[i].build.cards() {
            for row in id.definition().rows {
                if let crate::cards::CardRow::Trigger(t) = row {
                    if t.on == crate::cards::TriggerOn::Hit {
                        if let crate::cards::TriggerAction::Cooldown { ms } = t.action {
                            wish_ms += ms;
                        }
                    }
                }
            }
        }
        // A lapsed Adrenaline boost stops contributing (the legacy buffs.expireBoosts slice for cards).
        if w.players[i].card_boost.until > 0. && now >= w.players[i].card_boost.until {
            w.players[i].card_boost = crate::cards::Boost::default();
            crate::modifiers::recompute(k, w, crate::fighter::FighterIx::of_slot(i));
        }
        if n_total > 0 && wish_ms > 0. {
            let p = &mut w.players[i];
            let cast = p.card_runtime.and_then(|r| r.wish_cast);
            crate::cards::wishful_thinking(
                n_total,
                wish_ms,
                now,
                &mut p.stocks,
                cast,
                &mut p.card_trims,
            );
        }
        // A block under Best Offense is a hit by the holder on the blocked attacker: it counts for the streak.
        let hits_for = |victim: PlayerId| -> (f64, u32) {
            let (damage, mut n) = sum_for(landed, by, victim);
            if best_offense {
                for b in blocks {
                    if b.holder == by && !b.passive && b.attacker == victim {
                        n += 1;
                    }
                }
            }
            (damage, n)
        };
        let mem = w.players[i].card_streak;
        let live = mem.is_some_and(|m| now - m.last < STREAK_GAP_MS);
        if let Some(m) = mem.filter(|_| live) {
            let (_, n) = hits_for(m.target);
            if n > 0 {
                w.players[i].card_streak = Some(Streak {
                    target: m.target,
                    count: m.count.saturating_add(n as u16),
                    last: now,
                });
                continue;
            }
        }
        // Otherwise restart on the biggest hit; ties by the tick's hash rank.
        let mut target: Option<PlayerId> = None;
        let mut best = -1.;
        let consider = |victim: PlayerId, target: &mut Option<PlayerId>, best: &mut f64| {
            let (damage, _) = hits_for(victim);
            let better = target.is_none()
                || damage > *best
                || (damage == *best
                    && tie_rank(w, order_salt, tick, victim)
                        < tie_rank(w, order_salt, tick, target.unwrap()));
            if better {
                *target = Some(victim);
                *best = damage;
            }
        };
        for h in landed
            .iter()
            .filter(|h| h.by == Some(by) && is_weapon_hit(h))
        {
            consider(h.victim, &mut target, &mut best);
        }
        if best_offense {
            for b in blocks.iter().filter(|b| b.holder == by && !b.passive) {
                consider(b.attacker, &mut target, &mut best);
            }
        }
        if let Some(t) = target {
            let (_, n) = hits_for(t);
            w.players[i].card_streak = Some(Streak {
                target: t,
                count: n as u16,
                last: now,
            });
        }
    }
    crate::cards::stillness(w, now);
    resolve_splashes(w);
}

/// Resolve the recorded Overkill splash requests after the pass (source splashOverkill).
pub(crate) fn resolve_splashes(w: &mut crate::state::World) {
    // Overkill's splash: a share of each contributing hit goes to the nearest hostile within the card's radius of the
    // victim, queued for the next tick's ledger (source splashOverkill).
    let splashes = std::mem::take(&mut w.card_splashes);
    for req in splashes {
        let holder_faction = w.player(req.holder).map(|p| p.vitals.faction);
        let mut best: Option<(PlayerId, f64)> = None;
        for i in 0..w.players.len() {
            let p = &w.players[i];
            let id = p.core.id;
            if id == req.holder || id == req.victim || holder_faction.is_none() {
                continue;
            }
            if holder_faction == Some(p.vitals.faction) || w.server_time < p.vitals.immune_until {
                continue;
            }
            if crate::status_runtime::untargetable(&p.core.statuses.instances, w.server_time) {
                continue;
            }
            let pos = p.core.pos();
            let d = crate::math::hypot(pos.x - req.at.x, pos.y - req.at.y);
            if d > req.radius {
                continue;
            }
            if best.is_none() || d < best.unwrap().1 - 1e-9 {
                best = Some((id, d));
            }
        }
        for i in 0..w.mobs.len() {
            let m = &w.mobs[i];
            let id = m.core.id;
            if id == req.victim {
                continue;
            }
            if crate::status_runtime::untargetable(&m.core.statuses.instances, w.server_time) {
                continue;
            }
            let pos = m.core.pos();
            let d = crate::math::hypot(pos.x - req.at.x, pos.y - req.at.y);
            if d > req.radius {
                continue;
            }
            if best.is_none() || d < best.unwrap().1 - 1e-9 {
                best = Some((id, d));
            }
        }
        if let Some((target, _)) = best {
            w.deferred.defer_hit(crate::systems::ledger::Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                sig: None,
                execute: false,
                victim: target,
                by: Some(req.holder),
                packet: crate::state::Packet {
                    raw: req.raw,
                    phys: req.entry.packet.phys,
                    magic: req.entry.packet.magic,
                    true_: req.entry.packet.true_,
                },
                weapon: req.entry.weapon,
                stagger: false,
                projectile: None,
                scale: 1.,
                derived: true,
                passive: true,
            });
        }
    }
}
