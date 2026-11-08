//! Power-zero base-player singleton Sentenced Mark. No auxiliary installer or bonus-stat producers.
use super::ledger::Entry;
use crate::constants::*;
use crate::content::FactionId;
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
        let no_commutation = w.players[i]
            .build
            .has_flag(crate::stat_fold::EffectFlag::NoCommutation);
        let swift_judgment = w.players[i]
            .build
            .has_flag(crate::stat_fold::EffectFlag::SwiftJudgment);
        // Source `markStep`: `f.markProgress += markRateOf(c.s) / Math.max(f.chill, 0.05)` for every qualifying hit.
        // The folded MarkRate accessor is read here (runtime cache, not a new fold) and the pure progress helper keeps
        // the source arithmetic order and the prior-tick chill denominator floor.
        let increment =
            crate::modifiers::mark_progress_increment(w.players[i].modifiers.mark_rate(), chill);
        let m = &mut w.players[i].signature.mark;
        for _ in 0..count {
            m.hits += 1;
            m.progress += increment;
        }
        if count > 0 || m.tier > 0 {
            // No Commutation counts each weapon swap twice; Swift Judgment adds every second mark hit.
            let swaps = (m.swaps as f64) * if no_commutation { 2. } else { 1. }
                + if swift_judgment {
                    (m.hits / 2) as f64
                } else {
                    0.
                };
            let tier = if m.progress > 0. || swaps > 0. {
                (1. + ((m.progress.max(0.) / MARK_TIER_HITS + MARK_TIER_EPS).floor()).max(swaps))
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
            let e = ledger[n].clone();
            ledger.push(Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                sig: Some(SignatureKind::Mark),
                execute: false,
                victim: e.victim,
                by: e.by,
                packet: Packet {
                    raw: crate::modifiers::mark_pulse(
                        &w.players[i],
                        e.weapon.unwrap(),
                        w.players[ti].vitals.max_hp,
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
    let final_verdict = p.build.has_flag(crate::stat_fold::EffectFlag::FinalVerdict);
    let weapon = p.core.active_weapon();
    let mut returns = [(crate::PlayerId(0), 0f64); crate::constants::MAX_PLAYERS];
    let mut n = 0;
    for (id, amount) in denied.rows.into_iter().flatten() {
        if hx.w.idx(id).is_some() {
            hx.ev.push(crate::Event::MarkNotice {
                recipient: id,
                notice: crate::events::MarkNotice::ExecuteBlocked,
            });
        }
        if final_verdict && amount > 0. && n < returns.len() {
            returns[n] = (id, amount);
            n += 1;
        }
    }
    if final_verdict {
        for &(foe, amount) in &returns[..n] {
            hx.w.deferred.defer_hit(crate::systems::ledger::Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                sig: None,
                execute: false,
                victim: foe,
                by: Some(owner),
                packet: crate::state::Packet {
                    raw: amount,
                    phys: 0.,
                    magic: 0.,
                    true_: 1.,
                },
                weapon: Some(weapon),
                stagger: false,
                projectile: None,
                scale: 1.,
                derived: false,
                passive: true,
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
    // Mark accumulates the prior tick's cached chill, not today's folded resistance or source stats. Iron Will
    // weakens Frost, while the source's bonus shield/haste can deepen it as far as frost_cap. Either build can change
    // during a mark. No per-hit chill history is serialized, so only the admitted per-hit envelope is recoverable;
    // the old mixture of just neutral and base-Frost increments rejects genuine resisted/deepened hits.
    let min_chill =
        (1. - FROST_SLOW - crate::modifiers::DEFINITION.frost_cap).max(MARK_CHILL_FLOOR);
    // The historical rate is not today's rate: ordinary card ownership only grows and Gathering Storm may be added
    // mid-Mark, while training Clear may remove it without resetting the Mark, so past increments are never recomputed.
    // The shipped unique catalog producer bounds every reachable rate (currently 1.5); derive it from the catalog
    // instead of inventing a permissive constant. The rate itself is never below 1: no shipped card/farm/trade/status
    // row subtracts MarkRate (verified against the actual catalog and the farm/trade/status registries).
    let max_increment =
        crate::modifiers::mark_progress_increment(crate::modifiers::maximum_mark_rate(), min_chill);
    let count = m.hits as f64;
    let max_progress = count * max_increment;
    // Retain the conservative sequential-binary64 addition envelope, including long-running restored marks.
    let slack = MARK_TIER_EPS.max(4. * f64::EPSILON * count * count * max_increment);
    let tier_for = |swaps: f64| {
        if m.progress > 0. || swaps > 0. {
            (1. + (m.progress.max(0.) / MARK_TIER_HITS + MARK_TIER_EPS)
                .floor()
                .max(swaps))
            .min(MARK_TOP_TIER as f64) as u8
        } else {
            0
        }
    };
    // Promotion only raises the cached tier. A real grant can add a flag after the latest mark pass, so today's
    // flagged formula is an upper bound, not an equality. The unflagged formula is always the lower bound.
    // Ordinary card ownership only grows; training Clear can remove either flag without resetting this mark.
    // With no serialized grant/removal chronology, training must retain the upper bound from either former flag.
    let no_commutation = k.config.training
        || p.build
            .has_flag(crate::stat_fold::EffectFlag::NoCommutation);
    let swift_judgment = k.config.training
        || p.build
            .has_flag(crate::stat_fold::EffectFlag::SwiftJudgment);
    let tier_min = tier_for(m.swaps as f64);
    let tier_max = tier_for(
        m.swaps as f64 * if no_commutation { 2. } else { 1. }
            + if swift_judgment {
                (m.hits / 2) as f64
            } else {
                0.
            },
    );
    if (!enabled && (*m != empty || p.credit.sentence != 0))
        || p.credit.sentence > MARK_KILL_STACK_CAP
        // Counters mirror JavaScript Number integers; reject unrepresentable trusted payloads.
        || m.hits > 9_007_199_254_740_991
        || m.swaps > 9_007_199_254_740_991
        || !m.progress.is_finite()
        || m.progress < 0.
        || (m.hits == 0 && m.progress != 0.)
        || m.progress < m.hits as f64 - slack
        || m.progress > max_progress + slack
        || m.tier > MARK_TOP_TIER
        || !(tier_min..=tier_max).contains(&m.tier)
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
mod mark_rate_source_tests;
#[cfg(test)]
mod mark_rate_tests;
#[cfg(test)]
mod public_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod resistance_tests;

#[cfg(test)]
mod tier_tests;
