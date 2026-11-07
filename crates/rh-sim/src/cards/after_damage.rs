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
    let mut h = (order_salt ^ tick.wrapping_mul(0x9e37_79b1)) as u32;
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
            let (mut damage, mut n) = sum_for(landed, by, victim);
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
        let mut consider = |victim: PlayerId, target: &mut Option<PlayerId>, best: &mut f64| {
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
}
