//! Kill credit, GV and bounty, and the bounty announcements (legacy arena.ts `creditKill`, feed.ts).

use crate::constants::*;
use crate::sim::{Event, GvReason, PlayerId, Sim};

impl Sim {
    pub(crate) fn owed_bounty(&self, vi: usize) -> u32 {
        let v = &self.players[vi];
        if self.stepping {
            self.rt
                .bounty_at_tick_start
                .iter()
                .find(|(id, _)| *id == v.id)
                .map(|(_, b)| *b)
                .unwrap_or(v.bounty)
        } else {
            v.bounty
        }
    }

    pub(crate) fn recent_rival(&self, vi: usize, at: f64) -> Option<PlayerId> {
        let (by, when) = self.players[vi].last_hit?;
        if at - when > KILL_CREDIT_SECONDS * 1000.0 {
            return None;
        }
        let si = self.idx(by)?;
        (!self.players[si].resolved).then_some(by)
    }

    pub(crate) fn credit_kill(&mut self, by: PlayerId, victim_bot: bool, bounty: u32) {
        let Some(bi) = self.idx(by) else { return };
        if self.players[bi].resolved {
            return;
        }
        self.players[bi].kills += 1;
        if victim_bot {
            self.players[bi].bot_kills += 1;
        } else {
            self.credit(bi, GvReason::Kill, GV_KILL);
        }
        if bounty > 0 && !victim_bot {
            self.credit(bi, GvReason::Bounty, bounty);
        }
        self.update_bounty(bi);
    }

    pub(crate) fn credit(&mut self, i: usize, reason: GvReason, amount: u32) {
        let p = &mut self.players[i];
        if p.resolved || amount == 0 {
            return;
        }
        match reason {
            GvReason::Kill => p.gv_parts.kills += amount,
            GvReason::Bounty => p.gv_parts.bounty += amount,
            GvReason::Win => {}
        }
        p.gv = p.gv_parts.kills + p.gv_parts.mobs + p.gv_parts.bounty + p.gv_parts.quest;
        let id = p.id;
        self.emit(Event::Gv { id, amount, reason });
    }

    pub(crate) fn update_bounty(&mut self, i: usize) {
        let p = &mut self.players[i];
        if !p.standing() {
            return;
        }
        let b = crate::content::bounty_for(p.kills as i64 - p.bot_kills as i64);
        if b <= p.bounty {
            return;
        }
        p.bounty = b;
        self.announce_bounty(i);
    }

    pub(crate) fn announce_bounty(&mut self, i: usize) {
        let now = self.server_time;
        let p = &mut self.players[i];
        let (last_at, sent) = p.announce.unwrap_or((f64::NEG_INFINITY, 0));
        if p.bounty <= sent || now - last_at < BOUNTY_ANNOUNCE_MS {
            p.announce = Some((last_at, sent));
            return;
        }
        p.announce = Some((now, p.bounty));
        let (id, bounty) = (p.id, p.bounty);
        self.emit(Event::Bounty { id, bounty });
    }

    pub(crate) fn flush_bounty_announcements(&mut self) {
        for i in 0..self.players.len() {
            let p = &self.players[i];
            if let Some((_, sent)) = p.announce {
                if p.standing() && p.bounty > sent {
                    self.announce_bounty(i);
                }
            }
        }
    }
}
