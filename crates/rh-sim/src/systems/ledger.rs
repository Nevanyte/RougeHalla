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

/// One hit of the tick's ledger. `Copy` and name-free: the attacker is an id, and its display name is resolved from the
/// roster only when a result needs it (`World::roster`), so a hit never clones a string.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Entry {
    pub(crate) victim: PlayerId,
    pub(crate) by: PlayerId,
    pub(crate) packet: Packet,
    pub(crate) weapon: WeaponId,
    pub(crate) stagger: bool,
}

/// What a payout does when it is paid (legacy `payLater(world, () => ...)`, as typed data). The slice has one: a kill's
/// credit. A packet whose legacy code calls `payLater` adds its variant here and its arm to [`PayLater::pay`]; it never
/// puts the effect in `World::deferred`, which is the NEXT tick's ledger.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum PayLater {
    /// legacy arena.ts `creditKill`: the kill's GV, bounty and rampage, after every victim took their damage.
    CreditKill {
        by: PlayerId,
        victim_bot: bool,
        bounty: u32,
    },
}

impl PayLater {
    fn pay(self, w: &mut World, ev: &mut Vec<Event>) {
        match self {
            PayLater::CreditKill {
                by,
                victim_bot,
                bounty,
            } => credit::credit_kill(w, ev, by, victim_bot, bounty),
        }
    }
}

/// Legacy `payLater`: queues `p` while the ledger pass runs and pays it at once otherwise (a hook fired outside the pass:
/// `remove_player`, the lobby, the run's end).
pub(crate) fn pay_later(w: &mut World, ev: &mut Vec<Event>, p: PayLater) {
    if w.pay.collecting {
        w.pay.items.push(p);
    } else {
        p.pay(w, ev);
    }
}

/// Ends the pass: everyone has taken their damage, so the queued payouts go out in the order they were queued. A payout
/// that itself calls `pay_later` pays at once, as in legacy (`collecting` is off by then).
pub(crate) fn pay_all(w: &mut World, ev: &mut Vec<Event>) {
    w.pay.collecting = false;
    // Index, not take: the queue keeps its capacity, and a payout cannot queue another (it pays at once now).
    let mut i = 0;
    while i < w.pay.items.len() {
        let p = w.pay.items[i];
        i += 1;
        p.pay(w, ev);
    }
    w.pay.items.clear();
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

/// One victim's working lists (tick scratch, reused for every victim of the pass).
struct Bufs<'a> {
    idxs: &'a mut Vec<usize>,
    amounts: &'a mut Vec<f64>,
    order: &'a mut Vec<(usize, usize)>,
    hits: &'a mut Vec<(f64, PlayerId)>,
}

fn rank_of(rank: &[(PlayerId, usize)], id: PlayerId) -> usize {
    rank.iter()
        .find(|(p, _)| *p == id)
        .map(|(_, r)| *r)
        .unwrap_or(usize::MAX)
}

/// System (legacy step.ts, the ledger's opening): the entries a hook link deferred last tick (returned damage, Overkill's
/// splash: `World::deferred`, legacy `combat.deferred`; not `payLater`, which is paid inside its own tick, see
/// [`pay_later`]) open this tick's ledger, in the order they were queued, and the melee queue starts empty. The scratch
/// buffers are already empty at the end of every step; this keeps the opening explicit. The slice has no link that
/// defers, so the queue is empty until P-CARDS-1.
pub(crate) fn open(cx: &mut Cx) {
    let Cx { w, s, .. } = cx;
    s.ledger.clear();
    s.ledger.append(&mut w.deferred.hits);
    s.melee.clear();
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
        victims,
        ledger_mults: mults,
        idxs,
        amounts,
        order,
        hits,
        ..
    } = &mut **s;
    if ledger.is_empty() {
        return;
    }
    // Group by victim in order of first appearance (legacy Map insertion order).
    victims.clear();
    for e in ledger.iter() {
        if !victims.contains(&e.victim) {
            victims.push(e.victim);
        }
    }
    mults.clear();
    mults.extend(ledger.iter().map(|e| {
        if k.config.pvp_rules && w.idx(e.by).is_some() && w.idx(e.victim).is_some() {
            pvp_factor(0.0)
        } else {
            1.0
        }
    }));
    w.pay.items.clear();
    w.pay.collecting = true;
    let mut pass = Pass {
        k,
        w,
        ev,
        rank,
        bounty_at_tick_start,
        downed: downed_this_tick,
    };
    let mut bufs = Bufs {
        idxs,
        amounts,
        order,
        hits,
    };
    for &v in victims.iter() {
        bufs.idxs.clear();
        bufs.idxs
            .extend((0..ledger.len()).filter(|&k| ledger[k].victim == v));
        apply_victim(&mut pass, &mut bufs, v, ledger, mults);
    }
    pay_all(pass.w, pass.ev);
    ledger.clear();
}

fn apply_victim(pass: &mut Pass, b: &mut Bufs, v: PlayerId, ledger: &[Entry], mults: &[f64]) {
    let Some(vi) = pass.w.idx(v) else { return };
    if !pass.w.players[vi].standing() {
        return;
    }
    let vf = crate::content::faction(pass.w.players[vi].faction);
    let (armor, shield) = (vf.armor.max(0.0), vf.shield);
    let Bufs {
        idxs,
        amounts,
        order,
        hits,
    } = b;
    amounts.clear();
    amounts.extend(idxs.iter().map(|&k| {
        let e = &ledger[k];
        let raw = e.packet.raw * mults[k];
        let s = DamageShares {
            phys: e.packet.phys,
            magic: e.packet.magic,
            true_: e.packet.true_,
        };
        mitigate_shares(raw, &s, armor, shield)
    }));
    if pass.k.config.pvp_rules {
        let cap = PVP_HIT_CAP_SHARE * pass.w.players[vi].max_hp;
        for a in amounts.iter_mut() {
            if *a > 0.0 && *a > cap {
                *a = cap;
            }
        }
    }
    // The hits land in action-order rank (anyone not in the order, such as a leaver, after everyone). Ties keep the
    // entries' own order: the key (rank, position) is total, so an unstable sort gives the stable sort's order and needs no
    // merge buffer however many hits a victim takes.
    order.clear();
    order.extend((0..idxs.len()).map(|j| (rank_of(pass.rank, ledger[idxs[j]].by), j)));
    order.sort_unstable();
    hits.clear();
    hits.extend(order.iter().map(|&(_, j)| (amounts[j], ledger[idxs[j]].by)));
    let applied = apply_hits(pass, vi, hits);
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
fn apply_hits(pass: &mut Pass, vi: usize, hits: &[(f64, PlayerId)]) -> f64 {
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
    for (h, (amount, by)) in hits.iter().enumerate() {
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
        v.barrier = if v.barrier - taken < BARRIER_EPS {
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
    let (_, kid) = &hits[killer];
    let killer_idx = w.idx(*kid).filter(|&k| !w.players[k].resolved);
    let killer_bot = killer_idx.map(|k| w.players[k].bot).unwrap_or(false);
    let (vx, vy) = (w.players[vi].x, w.players[vi].y);
    {
        let v = &mut w.players[vi];
        // The killer, by id: the roster names it when the result is built (legacy: the attacker's name, or the source
        // name of one who already left).
        v.killed_by = Some(*kid);
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
        pay_later(
            w,
            pass.ev,
            PayLater::CreditKill {
                by: c,
                victim_bot,
                bounty,
            },
        );
    }
    settle::down_player(pass.k, w, pass.ev, Some(pass.downed), vi, Outcome::Died);
    before
}
