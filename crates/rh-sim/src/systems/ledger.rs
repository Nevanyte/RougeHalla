//! The damage ledger: every hit of the tick lands at once (legacy combat.ts `applyLedger`, arena.ts `applyHits`).
//!
//! Touches: the victims' vitals and kill fields, the attackers' damage lists and credit, the event log and the tick's
//! downed list; reads the ledger, the action-order ranks and the tick-start bounties from the tick scratch.

use crate::constants::*;
use crate::content::{mitigate_shares, pvp_factor, DamageShares, WeaponId};
use crate::events::Event;
use crate::results::Outcome;
use crate::scratch::TickScratch;
use crate::state::{Packet, PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::{credit, settle, weapons, Cx};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Entry {
    pub(crate) victim: PlayerId,
    pub(crate) by: PlayerId,
    pub(crate) by_name: String,
    pub(crate) packet: Packet,
    pub(crate) weapon: WeaponId,
    pub(crate) stagger: bool,
}

pub(crate) struct Payout {
    pub(crate) by: PlayerId,
    pub(crate) victim_bot: bool,
    pub(crate) bounty: u32,
}

/// What applying one victim's hits touches: everything but the ledger, which it only reads.
struct Pass<'a> {
    k: &'a MatchStatic,
    w: &'a mut World,
    ev: &'a mut Vec<Event>,
    rank: &'a [(PlayerId, usize)],
    bounty_at_tick_start: &'a [(PlayerId, u32)],
    downed: &'a mut Vec<PlayerId>,
}

fn rank_of(rank: &[(PlayerId, usize)], id: PlayerId) -> usize {
    rank.iter()
        .find(|(p, _)| *p == id)
        .map(|(_, r)| *r)
        .unwrap_or(usize::MAX)
}

/// System (legacy ledger.applyLedger): every hit of the tick lands at once. Outgoing multipliers are fixed before any
/// victim takes damage, each victim's hits are mitigated, capped and applied together (ranked by the secret action order
/// for kill credit), and kill spoils are paid only after every victim took its damage, so no reward decides who survives
/// the pass. The ledger is empty afterwards.
pub(crate) fn apply(cx: &mut Cx) {
    let Cx { k, w, s, ev, .. } = cx;
    let TickScratch {
        ledger,
        rank,
        bounty_at_tick_start,
        downed_this_tick,
        ..
    } = &mut **s;
    if ledger.is_empty() {
        return;
    }
    // Group by victim in order of first appearance (legacy Map insertion order).
    let mut victims: Vec<PlayerId> = Vec::new();
    for e in ledger.iter() {
        if !victims.contains(&e.victim) {
            victims.push(e.victim);
        }
    }
    let mults: Vec<f64> = ledger
        .iter()
        .map(|e| {
            if k.config.pvp_rules && w.idx(e.by).is_some() && w.idx(e.victim).is_some() {
                pvp_factor(0.0)
            } else {
                1.0
            }
        })
        .collect();
    let mut payouts: Vec<Payout> = Vec::new();
    let mut pass = Pass {
        k,
        w,
        ev,
        rank,
        bounty_at_tick_start,
        downed: downed_this_tick,
    };
    for v in victims {
        let idxs: Vec<usize> = (0..ledger.len())
            .filter(|&k| ledger[k].victim == v)
            .collect();
        apply_victim(&mut pass, v, ledger, &idxs, &mults, &mut payouts);
    }
    for pay in payouts {
        credit::credit_kill(pass.w, pass.ev, pay.by, pay.victim_bot, pay.bounty);
    }
    ledger.clear();
}

fn apply_victim(
    pass: &mut Pass,
    v: PlayerId,
    ledger: &[Entry],
    idxs: &[usize],
    mults: &[f64],
    payouts: &mut Vec<Payout>,
) {
    let Some(vi) = pass.w.idx(v) else { return };
    if !pass.w.players[vi].standing() {
        return;
    }
    let vf = crate::content::faction(pass.w.players[vi].faction);
    let (armor, shield) = (vf.armor.max(0.0), vf.shield);
    let mut amounts: Vec<f64> = idxs
        .iter()
        .map(|&k| {
            let e = &ledger[k];
            let raw = e.packet.raw * mults[k];
            let s = DamageShares {
                phys: e.packet.phys,
                magic: e.packet.magic,
                true_: e.packet.true_,
            };
            mitigate_shares(raw, &s, armor, shield)
        })
        .collect();
    if pass.k.config.pvp_rules {
        let cap = PVP_HIT_CAP_SHARE * pass.w.players[vi].max_hp;
        for a in amounts.iter_mut() {
            if *a > 0.0 && *a > cap {
                *a = cap;
            }
        }
    }
    let mut order: Vec<usize> = (0..idxs.len()).collect();
    order.sort_by_key(|&j| rank_of(pass.rank, ledger[idxs[j]].by));
    let hits: Vec<(f64, PlayerId, String)> = order
        .iter()
        .map(|&j| {
            (
                amounts[j],
                ledger[idxs[j]].by,
                ledger[idxs[j]].by_name.clone(),
            )
        })
        .collect();
    let applied = apply_hits(pass, vi, &hits, payouts);
    if !(applied > 0.0) {
        return;
    }
    for (j, &k) in idxs.iter().enumerate() {
        if amounts[j] > 0.0 {
            let e = &ledger[k];
            pass.ev.push(Event::Hit {
                victim: v,
                by: e.by,
                amount: amounts[j],
                weapon: e.weapon,
            });
        }
    }
    if let Some(vi) = pass.w.idx(v) {
        if pass.w.players[vi].standing()
            && idxs
                .iter()
                .enumerate()
                .any(|(j, &k)| ledger[k].stagger && amounts[j] > 0.0)
        {
            let now = pass.w.server_time;
            weapons::stagger(&mut pass.w.players[vi], now, pass.ev);
        }
    }
}

/// Legacy `applyHits` for a player victim: the hits land together; the kill goes to the largest rival hit.
fn apply_hits(
    pass: &mut Pass,
    vi: usize,
    hits: &[(f64, PlayerId, String)],
    payouts: &mut Vec<Payout>,
) -> f64 {
    let w = &mut *pass.w;
    let now = w.server_time;
    {
        let v = &w.players[vi];
        if !v.standing() || v.hp <= 0.0 || now < v.immune_until {
            return 0.0;
        }
    }
    let victim_id = w.players[vi].id;
    let victim_bot = w.players[vi].bot;
    let mut total = 0.0;
    let mut top: Option<usize> = None;
    let mut top_rival: Option<usize> = None;
    for (h, (amount, by, _)) in hits.iter().enumerate() {
        if !(*amount > 0.0) {
            continue;
        }
        total += amount;
        if top.is_none_or(|t| *amount > hits[t].0) {
            top = Some(h);
        }
        // A source still in the run (not resolved) is an attacker; anyone else is a name only.
        if let Some(si) = w.idx(*by) {
            if !w.players[si].resolved && *by != victim_id {
                let src = &mut w.players[si];
                if !src.damaged.contains(&victim_id) {
                    src.damaged.push(victim_id);
                }
                if !victim_bot && !src.damaged_humans.contains(&victim_id) {
                    src.damaged_humans.push(victim_id);
                }
                if top_rival.is_none_or(|t| *amount > hits[t].0) {
                    top_rival = Some(h);
                }
            }
        }
    }
    let Some(top) = top else { return 0.0 };
    if let Some(r) = top_rival {
        w.players[vi].last_hit = Some((hits[r].1, now));
    }
    let v = &mut w.players[vi];
    if v.barrier > 0.0 {
        let taken = v.barrier.min(total);
        v.barrier = if v.barrier - taken < 1e-3 {
            0.0
        } else {
            v.barrier - taken
        };
        total -= taken;
    }
    if !(total > 0.0) {
        return 0.0;
    }
    let before = v.hp;
    let unheld = (before - total).max(0.0);
    v.hp = (before - total).max(0.0);
    if v.hp > 0.0 {
        return if v.hp > unheld { total } else { before - v.hp };
    }
    let killer = top_rival.unwrap_or(top);
    let (_, kid, kname) = &hits[killer];
    let killer_idx = w.idx(*kid).filter(|&k| !w.players[k].resolved);
    let killer_bot = killer_idx.map(|k| w.players[k].bot).unwrap_or(false);
    let (vx, vy) = (w.players[vi].x, w.players[vi].y);
    {
        let v = &mut w.players[vi];
        // The killer's display name (legacy: the attacker's name, or the source name of one who already left).
        v.killed_by = Some(kname.clone());
        if killer_bot {
            v.killed_by_bot = true;
        }
    }
    pass.ev.push(Event::Death {
        id: victim_id,
        x: vx,
        y: vy,
        by: killer_idx.map(|_| *kid),
    });
    let credited = match top_rival {
        Some(r) => Some(hits[r].1),
        None => credit::recent_rival(w, vi, now),
    };
    if let Some(c) = credited {
        let bounty = credit::owed_bounty(w, pass.bounty_at_tick_start, vi);
        payouts.push(Payout {
            by: c,
            victim_bot,
            bounty,
        });
    }
    settle::down_player(w, pass.ev, Some(pass.downed), vi, Outcome::Died);
    before
}
