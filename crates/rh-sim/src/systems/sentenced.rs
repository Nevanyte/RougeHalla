//! Power-zero base-player singleton Sentenced Mark. No auxiliary installer or bonus-stat producers.
use super::ledger::Entry;
use crate::constants::*;
use crate::content::{self, FactionId};
use crate::factions::SignatureKind;
use crate::hooks::{HookArgs, Hx};
use crate::state::{Packet, PlayerId, World};
use crate::statics::MatchStatic;

/// Ordered denied-source amounts, fixed to the bounded current player domain.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Denied {
    pub rows: [Option<(PlayerId, f64)>; MAX_PLAYERS],
}
impl Default for Denied {
    fn default() -> Self {
        Self {
            rows: [None; MAX_PLAYERS],
        }
    }
}
impl Denied {
    pub(crate) fn add(&mut self, id: PlayerId, amount: f64) {
        for cell in &mut self.rows {
            match cell {
                Some((by, sum)) if *by == id => {
                    *sum += amount;
                    return;
                }
                None => {
                    *cell = Some((id, amount));
                    return;
                }
                _ => {}
            }
        }
        unreachable!("denied sources are current players");
    }
    pub(crate) fn any(&self) -> bool {
        self.rows[0].is_some()
    }
}
fn qualifies(w: &World, owner: usize, e: &Entry) -> bool {
    e.by == Some(w.players[owner].id)
        && e.weapon.is_some()
        && e.sig.is_none()
        && !e.passive
        && !e.derived
        && !e.execute
        && e.scale > 0.
        && e.packet.raw > 0.
        && Some(e.victim) == w.players[owner].signature.target
        && w.player(e.victim)
            .is_some_and(|p| p.standing() && w.server_time >= p.vitals.immune_until)
}
pub(crate) fn before_damage(
    _k: &MatchStatic,
    w: &mut World,
    ledger: &mut Vec<Entry>,
    ev: &mut Vec<crate::Event>,
) {
    let original = ledger.len();
    let now = w.server_time;
    for i in 0..w.players.len() {
        if !w.players[i].standing() || w.players[i].vitals.faction != FactionId::Sentenced {
            continue;
        }
        let Some(ti) = w.players[i].signature.target.and_then(|id| w.idx(id)) else {
            continue;
        };
        let distance = crate::math::hypot(
            w.players[ti].body.x - w.players[i].body.x,
            w.players[ti].body.y - w.players[i].body.y,
        );
        let m = &mut w.players[i].signature.mark;
        if distance > TARGET_RANGE {
            if let Some(since) = m.far_since {
                if now - since >= TARGET_LOS_GRACE_MS {
                    w.players[i].signature.clear_target();
                    continue;
                }
            } else {
                m.far_since = Some(now);
            }
        } else {
            m.far_since = None;
        }
        let mut count = 0;
        for e in &ledger[..original] {
            if qualifies(w, i, e) {
                count += 1;
            }
        }
        let chill = w.players[i].signature.chill;
        let m = &mut w.players[i].signature.mark;
        for _ in 0..count {
            m.hits += 1;
            m.progress += 1. / chill.max(MARK_CHILL_FLOOR);
        }
        if count > 0 || m.tier > 0 {
            let tier = if m.progress > 0. || m.swaps > 0 {
                (1. + ((m.progress.max(0.) / MARK_TIER_HITS + MARK_TIER_EPS).floor())
                    .max(m.swaps as f64))
                .min(MARK_TOP_TIER as f64) as u8
            } else {
                0
            };
            if tier > m.tier {
                if m.tier == 0 {
                    ev.push(crate::Event::MarkNotice {
                        recipient: w.players[ti].id,
                        notice: crate::events::MarkNotice::Marked,
                    });
                }
                w.players[i].signature.mark.tier = tier;
            }
        }
        for n in 0..original {
            if !qualifies(w, i, &ledger[n]) {
                continue;
            }
            let e = ledger[n];
            ledger.push(Entry {
                sig: Some(SignatureKind::Mark),
                execute: false,
                victim: e.victim,
                by: e.by,
                packet: Packet {
                    raw: content::sentenced_pulse(
                        e.weapon.unwrap(),
                        w.players[ti].vitals.max_hp,
                        w.players[i].credit.sentence,
                        distance <= MARK_NEAR_RANGE,
                    ),
                    phys: MARK_PHYS_SHARE,
                    magic: MARK_MAGIC_SHARE,
                    true_: MARK_TRUE_SHARE,
                },
                weapon: e.weapon,
                stagger: false,
                projectile: None,
                scale: 1.,
                derived: false,
                passive: false,
            });
        }
    }
}
pub(crate) fn weapon_swapped(hx: &mut Hx, args: &HookArgs) {
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    let HookArgs::WeaponSwapped(id) = *args else {
        return;
    };
    for p in hx.w.players.iter_mut() {
        if p.signature.mark.tier > 0 && p.signature.target == Some(id) {
            p.signature.mark.swaps += 1;
        }
    }
}
pub(crate) fn player_killed(hx: &mut Hx, args: &HookArgs) {
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    let HookArgs::PlayerKilled {
        by,
        victim,
        outcome: crate::results::Outcome::Died,
    } = *args
    else {
        return;
    };
    let Some(i) = hx.w.idx(by) else {
        return;
    };
    let p = &mut hx.w.players[i];
    if p.vitals.faction != FactionId::Sentenced {
        return;
    }
    if p.signature.target == Some(victim) && p.signature.mark.tier > 0 {
        hx.ev.push(crate::Event::MarkNotice {
            recipient: by,
            notice: crate::events::MarkNotice::CarriedOut,
        });
    }
    p.credit.sentence = p.credit.sentence.saturating_add(1).min(MARK_KILL_STACK_CAP);
}
pub(crate) fn execute_denied(hx: &mut Hx, args: &HookArgs) {
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    let HookArgs::ExecuteDenied { owner, denied } = *args else {
        return;
    };
    let Some(i) = hx.w.idx(owner) else {
        return;
    };
    let p = &mut hx.w.players[i];
    if p.vitals.faction != FactionId::Sentenced {
        return;
    }
    p.signature.mark.amp_until = p
        .signature
        .mark
        .amp_until
        .max(hx.w.server_time + MARK_DENIAL_LINGER_MS);
    if !p.signature.mark.denied {
        p.signature.mark.denied = true;
        p.credit.sentence = p.credit.sentence.saturating_add(1).min(MARK_KILL_STACK_CAP);
    }
    for (id, _) in denied.rows.into_iter().flatten() {
        if hx.w.idx(id).is_some() {
            hx.ev.push(crate::Event::MarkNotice {
                recipient: id,
                notice: crate::events::MarkNotice::ExecuteBlocked,
            });
        }
    }
}
pub(crate) fn after_damage(w: &mut World) {
    for i in 0..w.players.len() {
        if w.players[i].vitals.faction == FactionId::Sentenced
            && (!w.players[i].standing()
                || w.players[i]
                    .signature
                    .target
                    .is_some_and(|id| w.player(id).is_none_or(|p| !p.standing())))
        {
            w.players[i].signature.clear_target();
        }
    }
    let mut blocked = [false; MAX_PLAYERS];
    for p in w.players.iter() {
        if p.standing() && p.signature.mark.tier >= MARK_TOP_TIER {
            if let Some(i) = p.signature.target.and_then(|id| w.idx(id)) {
                blocked[i] = true;
            }
        }
    }
    for (i, p) in w.players.iter_mut().enumerate() {
        if p.standing() && blocked[i] {
            p.signature.bits |= SIG_EXEC_BLOCKED;
        }
    }
}
/// Survivor-only incoming effect tier. No private owner identity is returned.
pub(crate) fn public_mark_tier(w: &World, id: PlayerId) -> u8 {
    if w.player(id).is_none_or(|p| !p.standing()) {
        return 0;
    }
    w.players
        .iter()
        .filter(|p| p.standing() && p.signature.target == Some(id))
        .map(|p| p.signature.mark.tier)
        .max()
        .unwrap_or(0)
}
/// Select among observer-eligible owners at the public maximum, before choosing a tie winner.
/// Numeric IDs are Rust's public actor order; source lexical identity remains a private parity diagnostic.
pub(crate) fn public_mark_by(
    w: &World,
    id: PlayerId,
    tier: u8,
    eligible: impl Fn(PlayerId) -> bool,
) -> Option<PlayerId> {
    if tier == 0 {
        return None;
    }
    w.players
        .iter()
        .filter(|p| {
            p.standing()
                && p.signature.target == Some(id)
                && p.signature.mark.tier == tier
                && eligible(p.id)
        })
        .map(|p| p.id)
        .min()
}

pub(crate) fn validate(k: &MatchStatic, w: &World, p: &crate::state::Player) -> Result<(), String> {
    let m = &p.signature.mark;
    let enabled = k.config.faction_mode.sentenced() && p.vitals.faction == FactionId::Sentenced;
    let empty = crate::fighter::Mark::default();
    let reset = crate::fighter::Mark {
        amp_until: m.amp_until,
        ..empty
    };
    let max_progress = m.hits as f64 / (1. - FROST_SLOW).max(MARK_CHILL_FLOOR);
    // A qualifying hit sees only neutral or Frost's prior chill in this base domain.
    // Sequential binary64 additions may drift from the ideal mixture; retain their error envelope.
    let increment = 1. / (1. - FROST_SLOW).max(MARK_CHILL_FLOOR);
    let count = m.hits as f64;
    let slack = MARK_TIER_EPS.max(4. * f64::EPSILON * count * count * increment);
    let chilled = ((m.progress - count) / (increment - 1.)).round();
    let legal_progress = chilled >= 0.
        && chilled <= count
        && (m.progress - (count + chilled * (increment - 1.))).abs() <= slack;
    let tier = if m.progress > 0. || m.swaps > 0 {
        (1. + (m.progress.max(0.) / MARK_TIER_HITS + MARK_TIER_EPS)
            .floor()
            .max(m.swaps as f64))
        .min(MARK_TOP_TIER as f64) as u8
    } else {
        0
    };
    if (!enabled && (*m != empty || p.credit.sentence != 0))
        || p.credit.sentence > MARK_KILL_STACK_CAP
        // Counters mirror JavaScript Number integers; reject unrepresentable trusted payloads.
        || m.hits > 9_007_199_254_740_991
        || m.swaps > 9_007_199_254_740_991
        || !m.progress.is_finite()
        || !legal_progress
        || m.progress < m.hits as f64 - slack
        || m.progress > max_progress + slack
        || m.tier > MARK_TOP_TIER
        || m.tier != tier
        || (p.signature.target.is_none() && *m != reset)
        || (m.tier == 0 && (m.hits != 0 || m.progress != 0. || m.swaps != 0 || m.denied))
        || m.far_since
            .is_some_and(|t| !(0. ..=w.server_time).contains(&t))
        || !(0. ..=w.server_time + MARK_DENIAL_LINGER_MS).contains(&m.amp_until)
        || (m.denied && (m.tier < MARK_TOP_TIER || m.amp_until == 0.))
    {
        return Err(format!("invalid Sentenced state for player {}", p.id.0));
    }
    Ok(())
}

#[cfg(test)]
mod actual_source_tests;
#[cfg(test)]
mod public_tests;
#[cfg(test)]
mod tests;
