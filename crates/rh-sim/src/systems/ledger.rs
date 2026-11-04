//! The damage ledger: every hit of the tick lands at once (legacy combat.ts `applyLedger`, arena.ts `applyHits`).

use crate::constants::*;
use crate::content::{mitigate_shares, pvp_factor, DamageShares, WeaponId};
use crate::sim::{Event, Outcome, Packet, PlayerId, Sim};

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

impl Sim {
    pub(crate) fn rank_of(&self, id: PlayerId) -> usize {
        self.rank
            .iter()
            .find(|(p, _)| *p == id)
            .map(|(_, r)| *r)
            .unwrap_or(usize::MAX)
    }

    /// The damage ledger: every hit of the tick lands at once. Outgoing multipliers are fixed before any victim takes damage,
    /// each victim's hits are mitigated, capped and applied together (ranked by the secret action order for kill credit),
    /// and kill spoils are paid only after every victim took its damage, so no reward decides who survives the pass.
    pub(crate) fn apply_ledger(&mut self) {
        let ledger = std::mem::take(&mut self.ledger);
        if ledger.is_empty() {
            return;
        }
        // Group by victim in order of first appearance (legacy Map insertion order).
        let mut victims: Vec<PlayerId> = Vec::new();
        for e in &ledger {
            if !victims.contains(&e.victim) {
                victims.push(e.victim);
            }
        }
        let mults: Vec<f64> = ledger
            .iter()
            .map(|e| {
                if self.config.pvp_rules && self.idx(e.by).is_some() && self.idx(e.victim).is_some()
                {
                    pvp_factor(0.0)
                } else {
                    1.0
                }
            })
            .collect();
        let mut payouts: Vec<Payout> = Vec::new();
        for v in victims {
            let idxs: Vec<usize> = (0..ledger.len())
                .filter(|&k| ledger[k].victim == v)
                .collect();
            self.apply_victim(v, &ledger, &idxs, &mults, &mut payouts);
        }
        for pay in payouts {
            self.credit_kill(pay.by, pay.victim_bot, pay.bounty);
        }
    }

    pub(crate) fn apply_victim(
        &mut self,
        v: PlayerId,
        ledger: &[Entry],
        idxs: &[usize],
        mults: &[f64],
        payouts: &mut Vec<Payout>,
    ) {
        let Some(vi) = self.idx(v) else { return };
        if !self.players[vi].standing() {
            return;
        }
        let vf = crate::content::faction(self.players[vi].faction);
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
        if self.config.pvp_rules {
            let cap = PVP_HIT_CAP_SHARE * self.players[vi].max_hp;
            for a in amounts.iter_mut() {
                if *a > 0.0 && *a > cap {
                    *a = cap;
                }
            }
        }
        let mut order: Vec<usize> = (0..idxs.len()).collect();
        order.sort_by_key(|&j| self.rank_of(ledger[idxs[j]].by));
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
        let applied = self.apply_hits(vi, &hits, payouts);
        if !(applied > 0.0) {
            return;
        }
        for (j, &k) in idxs.iter().enumerate() {
            if amounts[j] > 0.0 {
                let e = &ledger[k];
                self.emit(Event::Hit {
                    victim: v,
                    by: e.by,
                    amount: amounts[j],
                    weapon: e.weapon,
                });
            }
        }
        if let Some(vi) = self.idx(v) {
            if self.players[vi].standing()
                && idxs
                    .iter()
                    .enumerate()
                    .any(|(j, &k)| ledger[k].stagger && amounts[j] > 0.0)
            {
                self.stagger(vi);
            }
        }
    }

    /// Legacy `applyHits` for a player victim: the hits land together; the kill goes to the largest rival hit.
    pub(crate) fn apply_hits(
        &mut self,
        vi: usize,
        hits: &[(f64, PlayerId, String)],
        payouts: &mut Vec<Payout>,
    ) -> f64 {
        let now = self.server_time;
        {
            let v = &self.players[vi];
            if !v.standing() || v.hp <= 0.0 || now < v.immune_until {
                return 0.0;
            }
        }
        let victim_id = self.players[vi].id;
        let victim_bot = self.players[vi].bot;
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
            if let Some(si) = self.idx(*by) {
                if !self.players[si].resolved && *by != victim_id {
                    let src = &mut self.players[si];
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
            self.players[vi].last_hit = Some((hits[r].1, now));
        }
        let v = &mut self.players[vi];
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
        let killer_idx = self.idx(*kid).filter(|&k| !self.players[k].resolved);
        let killer_bot = killer_idx.map(|k| self.players[k].bot).unwrap_or(false);
        let (vx, vy) = (self.players[vi].x, self.players[vi].y);
        {
            let v = &mut self.players[vi];
            // The killer's display name (legacy: the attacker's name, or the source name of one who already left).
            v.killed_by = Some(kname.clone());
            if killer_bot {
                v.killed_by_bot = true;
            }
        }
        self.emit(Event::Death {
            id: victim_id,
            x: vx,
            y: vy,
            by: killer_idx.map(|_| *kid),
        });
        let credited = match top_rival {
            Some(r) => Some(hits[r].1),
            None => self.recent_rival(vi, now),
        };
        if let Some(c) = credited {
            let bounty = self.owed_bounty(vi);
            payouts.push(Payout {
                by: c,
                victim_bot,
                bounty,
            });
        }
        self.down_player(vi, Outcome::Died);
        before
    }
}
