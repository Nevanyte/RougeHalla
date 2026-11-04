//! Kill credit, GV and bounty, and the bounty announcements (legacy arena.ts `creditKill`, `updateBounty`, feed.ts).
//!
//! Touches: the players' credit fields (kills, gv, bounty, announce) and the event log; reads the clock and, for the
//! bounty a kill pays, the tick-start bounty snapshot.

use crate::constants::*;
use crate::events::Event;
use crate::results::GvReason;
use crate::state::{PlayerId, World};
use crate::systems::Cx;

/// The bounty a kill of player `vi` pays inside a step: its bounty at the start of the tick (legacy `owedBounty`), so
/// the tick's own kills never raise what it is worth. Only the ledger pays bounties this way, always inside a step; a
/// leave between steps pays the current bounty (`settle::down_player`).
pub(crate) fn owed_bounty(w: &World, bounty_at_tick_start: &[u32], vi: usize) -> u32 {
    bounty_at_tick_start
        .get(vi)
        .copied()
        .unwrap_or(w.players[vi].credit.bounty)
}

/// The rival who hit player `vi` recently enough at time `at` to be credited (legacy `recentRival`).
pub(crate) fn recent_rival(w: &World, vi: usize, at: f64) -> Option<PlayerId> {
    let (by, when) = w.players[vi].credit.last_hit?;
    if at - when > KILL_CREDIT_SECONDS * 1000.0 {
        return None;
    }
    let si = w.idx(by)?;
    (!w.players[si].resolved).then_some(by)
}

pub(crate) fn credit_kill(
    w: &mut World,
    ev: &mut Vec<Event>,
    by: PlayerId,
    victim_bot: bool,
    bounty: u32,
) {
    let Some(bi) = w.idx(by) else { return };
    if w.players[bi].resolved {
        return;
    }
    w.players[bi].credit.kills = w.players[bi].credit.kills.saturating_add(1);
    if victim_bot {
        w.players[bi].credit.bot_kills = w.players[bi].credit.bot_kills.saturating_add(1);
    } else {
        credit(w, ev, bi, GvReason::Kill, GV_KILL);
    }
    if bounty > 0 && !victim_bot {
        credit(w, ev, bi, GvReason::Bounty, bounty);
    }
    update_bounty(w, ev, bi);
}

fn credit(w: &mut World, ev: &mut Vec<Event>, i: usize, reason: GvReason, amount: u32) {
    let p = &mut w.players[i];
    if p.resolved || amount == 0 {
        return;
    }
    match reason {
        GvReason::Kill => p.credit.gv_parts.kills = p.credit.gv_parts.kills.saturating_add(amount),
        GvReason::Bounty => {
            p.credit.gv_parts.bounty = p.credit.gv_parts.bounty.saturating_add(amount)
        }
        GvReason::Win => {}
    }
    p.credit.gv = p
        .credit
        .gv_parts
        .kills
        .saturating_add(p.credit.gv_parts.mobs)
        .saturating_add(p.credit.gv_parts.bounty)
        .saturating_add(p.credit.gv_parts.quest);
    let id = p.id;
    ev.push(Event::Gv { id, amount, reason });
}

fn update_bounty(w: &mut World, ev: &mut Vec<Event>, i: usize) {
    let p = &mut w.players[i];
    if !p.standing() {
        return;
    }
    let b = crate::content::bounty_for(p.credit.kills as i64 - p.credit.bot_kills as i64);
    if b <= p.credit.bounty {
        return;
    }
    p.credit.bounty = b;
    announce_bounty(w, ev, i);
}

fn announce_bounty(w: &mut World, ev: &mut Vec<Event>, i: usize) {
    let now = w.server_time;
    let p = &mut w.players[i];
    let (last_at, sent) = p.credit.announce.unwrap_or((f64::NEG_INFINITY, 0));
    if p.credit.bounty <= sent || now - last_at < BOUNTY_ANNOUNCE_MS {
        p.credit.announce = Some((last_at, sent));
        return;
    }
    p.credit.announce = Some((now, p.credit.bounty));
    let (id, bounty) = (p.id, p.credit.bounty);
    ev.push(Event::Bounty { id, bounty });
}

/// System (legacy feed.flushAnnouncements): announce every bounty raise that the throttle held back.
pub(crate) fn flush_announcements(cx: &mut Cx) {
    let Cx { w, ev, .. } = cx;
    for i in 0..w.players.len() {
        let p = &w.players[i];
        if let Some((_, sent)) = p.credit.announce {
            if p.standing() && p.credit.bounty > sent {
                announce_bounty(w, ev, i);
            }
        }
    }
}
