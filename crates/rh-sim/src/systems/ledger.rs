//! The damage ledger: every hit of the tick lands at once (legacy combat.ts `applyLedger`, arena.ts `applyHits`).
//!
//! Touches: the victims' vitals and kill fields, the attackers' damage lists and credit, the event log and the tick's
//! downed list; reads the ledger, the action-order ranks and the tick-start bounties from the tick scratch.

use crate::constants::*;
use crate::content::{mitigate_shares, pvp_factor, DamageShares, WeaponId};
use crate::events::Event;
use crate::fighter::FighterIx;
use crate::results::Outcome;
use crate::scratch::{TickScratch, NONE};
use crate::state::{Packet, PlayerId, World};
use crate::statics::MatchStatic;
use crate::systems::{credit, settle, weapons, Cx};

/// One hit of the tick's ledger. `Copy` and name-free: the attacker is an id, and its display name is resolved from the
/// roster only when a result needs it (`World::roster`), so a hit never clones a string.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Entry {
    pub(crate) victim: PlayerId,
    /// Who dealt it; `None` for damage no fighter dealt (legacy `SUDDEN_DEATH_KILLER`, terrain). Such a hit takes no PvP
    /// factor, gives no damage credit and no rival credit.
    pub(crate) by: Option<PlayerId>,
    pub(crate) packet: Packet,
    /// What dealt it; `None` for damage no weapon dealt (an ability, a field).
    pub(crate) weapon: Option<WeaponId>,
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
    bounty_at_tick_start: &'a [u32],
    downed: &'a mut Vec<PlayerId>,
}

/// One victim's working lists (tick scratch, reused for every victim of the pass).
struct Bufs<'a> {
    idxs: &'a mut Vec<usize>,
    amounts: &'a mut Vec<f64>,
    order: &'a mut Vec<(usize, usize)>,
    hits: &'a mut Vec<(f64, Option<PlayerId>)>,
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
        slot_head,
        slot_tail,
        entry_next,
        entry_rank,
        idxs,
        amounts,
        order,
        hits,
        ..
    } = &mut **s;
    if ledger.is_empty() {
        return;
    }
    // Group by victim in order of first appearance (legacy Map insertion order): each entry is chained on its victim's
    // slot, so a pass costs O(entries + victims) however many fighters there are. A victim who is no longer present has no
    // slot and nothing to apply to.
    victims.clear();
    entry_next.clear();
    entry_rank.clear();
    if slot_head.len() < w.fighter_count() {
        slot_head.resize(w.fighter_count(), NONE);
        slot_tail.resize(w.fighter_count(), NONE);
    }
    mults.clear();
    for (n, e) in ledger.iter().enumerate() {
        let vix = w.fighter_idx(e.victim);
        let bix = e.by.and_then(|b| w.fighter_idx(b));
        entry_next.push(NONE);
        // The hit's place in the action order (anyone not in it, such as a leaver, after everyone), looked up once here.
        entry_rank.push(
            bix.and_then(|b| rank.get(b.slot()))
                .map_or(u32::MAX, |&r| r),
        );
        if let Some(v) = vix.map(FighterIx::slot) {
            if slot_head[v] == NONE {
                victims.push(v as u32);
                slot_head[v] = n as u32;
            } else {
                entry_next[slot_tail[v] as usize] = n as u32;
            }
            slot_tail[v] = n as u32;
        }
        // The PvP factor is for a player hitting a player: a mob on either side, or no attacker, takes none.
        mults.push(
            if k.config.pvp_rules
                && vix
                    .zip(bix)
                    .is_some_and(|(v, b)| w.is_player(v) && w.is_player(b))
            {
                pvp_factor(0.0)
            } else {
                1.0
            },
        );
    }
    w.pay.items.clear();
    w.pay.collecting = true;
    let mut pass = Pass {
        k,
        w,
        ev,
        bounty_at_tick_start,
        downed: downed_this_tick,
    };
    let mut bufs = Bufs {
        idxs,
        amounts,
        order,
        hits,
    };
    for &vi in victims.iter() {
        let vi = vi as usize;
        bufs.idxs.clear();
        let mut n = slot_head[vi];
        while n != NONE {
            bufs.idxs.push(n as usize);
            n = entry_next[n as usize];
        }
        slot_head[vi] = NONE;
        slot_tail[vi] = NONE;
        apply_victim(&mut pass, &mut bufs, vi, ledger, mults, entry_rank);
    }
    pay_all(pass.w, pass.ev);
    ledger.clear();
}

fn apply_victim(
    pass: &mut Pass,
    b: &mut Bufs,
    vi: usize,
    ledger: &[Entry],
    mults: &[f64],
    entry_rank: &[u32],
) {
    let v = pass.w.players[vi].id;
    if !pass.w.players[vi].standing() {
        return;
    }
    let vf = crate::content::faction(pass.w.players[vi].vitals.faction);
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
        let cap = PVP_HIT_CAP_SHARE * pass.w.players[vi].vitals.max_hp;
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
    order.extend((0..idxs.len()).map(|j| (entry_rank[idxs[j]] as usize, j)));
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

/// Legacy `applyHits` for a player victim: the hits land together; the kill goes to the largest rival hit.
fn apply_hits(pass: &mut Pass, vi: usize, hits: &[(f64, Option<PlayerId>)]) -> f64 {
    let w = &mut *pass.w;
    let now = w.server_time;
    {
        let v = &w.players[vi];
        if !v.standing() || v.vitals.hp <= 0.0 || now < v.vitals.immune_until {
            return 0.0;
        }
    }
    let victim_id = w.players[vi].id;
    let victim_bot = w.players[vi].seat.bot;
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
        if let Some((si, by)) = by.and_then(|b| w.idx(b).map(|si| (si, b))) {
            if !w.players[si].resolved && by != victim_id {
                let src = &mut w.players[si];
                if !src.credit.damaged.contains(&victim_id) {
                    src.credit.damaged.push(victim_id);
                }
                if !victim_bot && !src.credit.damaged_humans.contains(&victim_id) {
                    src.credit.damaged_humans.push(victim_id);
                }
                if top_rival.is_none_or(|t| *amount > hits[t].0) {
                    top_rival = Some(h);
                }
            }
        }
    }
    let Some(top) = top else { return 0.0 };
    if let Some(r) = top_rival {
        w.players[vi].credit.last_hit = hits[r].1.map(|b| (b, now));
    }
    let v = &mut w.players[vi];
    if v.vitals.barrier > 0.0 {
        let taken = v.vitals.barrier.min(total);
        v.vitals.barrier = if v.vitals.barrier - taken < BARRIER_EPS {
            0.0
        } else {
            v.vitals.barrier - taken
        };
        total -= taken;
    }
    if !(total > 0.0) {
        return 0.0;
    }
    let before = v.vitals.hp;
    let unheld = (before - total).max(0.0);
    v.vitals.hp = (before - total).max(0.0);
    if v.vitals.hp > 0.0 {
        return if v.vitals.hp > unheld {
            total
        } else {
            before - v.vitals.hp
        };
    }
    let killer = top_rival.unwrap_or(top);
    let kid = hits[killer].1;
    let killer_idx = kid
        .and_then(|k| w.idx(k))
        .filter(|&k| !w.players[k].resolved);
    let killer_bot = killer_idx.map(|k| w.players[k].seat.bot).unwrap_or(false);
    let (vx, vy) = (w.players[vi].body.x, w.players[vi].body.y);
    {
        let v = &mut w.players[vi];
        // The killer, by id: the roster names it when the result is built (legacy: the attacker's name, or the source
        // name of one who already left).
        v.fate.killed_by = kid;
        if killer_bot {
            v.fate.killed_by_bot = true;
        }
    }
    pass.ev.push(Event::Death {
        id: victim_id,
        x: vx,
        y: vy,
        by: killer_idx.and(kid),
    });
    let credited = match top_rival {
        Some(r) => hits[r].1,
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
