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
    for i in 0..w.players.len() {
        let by = w.players[i].id;
        let mem = w.players[i].card_streak;
        let live = mem.is_some_and(|m| now - m.last < STREAK_GAP_MS);
        // Keep the streak when its target was hit this tick: one more per hit.
        if let Some(m) = mem.filter(|_| live) {
            let (_, n) = sum_for(landed, by, m.target);
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
        for h in landed
            .iter()
            .filter(|h| h.by == Some(by) && is_weapon_hit(h))
        {
            let victim = h.victim;
            let (damage, _) = sum_for(landed, by, victim);
            let better = target.is_none()
                || damage > best
                || (damage == best
                    && tie_rank(w, order_salt, tick, victim)
                        < tie_rank(w, order_salt, tick, target.unwrap()));
            if better {
                target = Some(victim);
                best = damage;
            }
        }
        if let Some(t) = target {
            let (_, n) = sum_for(landed, by, t);
            w.players[i].card_streak = Some(Streak {
                target: t,
                count: n as u16,
                last: now,
            });
        }
    }
}
