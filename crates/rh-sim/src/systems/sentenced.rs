//! Shared Sentenced singleton-source seam. Complete player-to-camp groups remain the next held integration seam.
use super::ledger::Entry;
use crate::constants::*;
use crate::content::FactionId;
use crate::factions::SignatureKind;
use crate::hooks::{HookArgs, Hx};
use crate::state::{Packet, PlayerId, World};
use crate::statics::MatchStatic;

/// An opaque span into the same-pass PayQueue amount bank. No borrowed rows or owned Vec are cloned into payouts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Denied {
    start: usize,
    len: usize,
}
impl Denied {
    pub(crate) fn begin(w: &World) -> Self {
        assert!(
            w.pay.collecting,
            "denial amounts belong to an open ledger pass"
        );
        Self {
            start: w.pay.mark_denied_amounts.len(),
            len: 0,
        }
    }
    pub(crate) fn add(&mut self, w: &mut World, id: PlayerId, amount: f64) {
        assert!(w.pay.collecting, "payout amount bank is sealed");
        // Only the current tail span may grow. Earlier spans remain immutable until all payouts finish.
        assert_eq!(self.start + self.len, w.pay.mark_denied_amounts.len());
        if let Some((_, sum)) = w.pay.mark_denied_amounts[self.start..]
            .iter_mut()
            .find(|(by, _)| *by == id)
        {
            *sum += amount;
        } else {
            assert!(
                w.pay.mark_denied_amounts.len() < w.pay.mark_denied_amounts.capacity(),
                "denial edge preparation missing"
            );
            w.pay.mark_denied_amounts.push((id, amount));
            self.len += 1;
        }
    }
    pub(crate) fn any(self) -> bool {
        self.len != 0
    }
}

/// Every player has one group; NPC sources have only player singleton targets (no mob-on-mob trades).
/// MAX_PLAYERS prepares future legal joins; synthetic measurement seats extend it explicitly.
pub(crate) fn edge_budget(k: &MatchStatic, players: usize) -> Result<usize, &'static str> {
    let (camp, sources) = if k.config.training {
        (TRAIN_MAX_MOBS as usize, TRAIN_MAX_MOBS as usize)
    } else if k.config.mob_mode != crate::mob_runtime::MobMode::Off {
        let mut camp = 1usize;
        let mut sources = 0usize;
        if let Some(layers) = k.arena.map.layers() {
            for row in &layers.data().camps {
                camp = camp.max(row.spots.len());
                if row.zone.as_str() == "sentenced" {
                    sources = sources
                        .checked_add(row.spots.len())
                        .ok_or("Sentenced edge budget overflow")?;
                }
            }
        }
        (camp, sources)
    } else {
        (1, 0)
    };
    players
        .max(MAX_PLAYERS)
        .checked_mul(camp.max(1))
        .and_then(|n| n.checked_add(sources))
        .ok_or("Sentenced edge budget overflow")
}
pub(crate) fn prepare(
    k: &MatchStatic,
    w: &mut World,
    s: &mut crate::scratch::TickScratch,
) -> Result<(), &'static str> {
    if !k.config.faction_mode.sentenced() {
        return Ok(());
    }
    let edges = edge_budget(k, w.players.len())?;
    if s.mark_denials.capacity() < edges {
        s.mark_denials
            .reserve_exact(edges.saturating_sub(s.mark_denials.len()));
    }
    let bank = &mut w.pay.mark_denied_amounts;
    if bank.capacity() < edges {
        bank.reserve_exact(edges.saturating_sub(bank.len()));
    }
    // Existing pending work survives restore/clone. This producer can add at most one return per denied edge.
    let deferred = w
        .deferred
        .hits
        .len()
        .checked_add(edges)
        .ok_or("Sentenced deferred budget overflow")?;
    if w.deferred.hits.capacity() < deferred {
        w.deferred
            .hits
            .reserve_exact(deferred.saturating_sub(w.deferred.hits.len()));
    }
    Ok(())
}

/// Snapshot at the signature/ledger boundary, not recomputed from victims after any damage has landed.
pub(crate) fn freeze_denials(k: &MatchStatic, w: &World, out: &mut Vec<(PlayerId, PlayerId)>) {
    out.clear();
    if !k.config.faction_mode.sentenced() {
        return;
    }
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let p = w.core(ix);
        if w.standing(ix) && source(w, ix) && p.signature.mark.tier >= MARK_TOP_TIER {
            if let Some(target) = p.signature.target {
                assert!(
                    out.len() < out.capacity(),
                    "Mark snapshot preparation missing"
                );
                out.push((p.id, target));
            }
        }
    }
}

fn typed_npc_source(w: &World, id: PlayerId) -> bool {
    use crate::mob_runtime::ActorOrigin;
    w.mobs.get(id).is_some_and(|m| {
        m.zombie.is_none()
            && m.mob_type
                .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
                .is_some_and(|ty| {
                    ty.zone == FactionId::Sentenced
                        && m.elite == ty.elite
                        && w.actor_origin(id).is_some_and(|origin| match origin {
                            ActorOrigin::Mob {
                                mob_type, elite, ..
                            }
                            | ActorOrigin::Practice {
                                mob_type, elite, ..
                            } => Some(*mob_type) == m.mob_type && *elite == m.elite,
                            _ => false,
                        })
                })
    })
}
fn source(w: &World, ix: crate::fighter::FighterIx) -> bool {
    let c = w.core(ix);
    c.vitals.faction == FactionId::Sentenced
        && !returning(w, c.id)
        && (w.is_player(ix) || typed_npc_source(w, c.id))
}
fn returning(w: &World, id: PlayerId) -> bool {
    w.mobs
        .get(id)
        .is_some_and(|m| m.brain.mode == crate::mob_runtime::BrainMode::Return)
}
fn qualifies(w: &World, owner: crate::fighter::FighterIx, e: &Entry) -> bool {
    let c = w.core(owner);
    e.by == Some(c.id)
        && e.weapon.is_some()
        && e.sig.is_none()
        && e.ability.is_none()
        && !e.dot
        && !e.arena
        && !e.passive
        && !e.derived
        && !e.execute
        && e.scale > 0.
        && e.packet.raw > 0.
        && Some(e.victim) == c.signature.target
        && w.fighter_idx(e.victim).is_some_and(|ix| {
            w.standing(ix)
                && (w.is_player(owner) || w.is_player(ix))
                && w.server_time >= w.core(ix).vitals.immune_until
        })
}
pub(crate) fn before_damage(
    _k: &MatchStatic,
    w: &mut World,
    ledger: &mut Vec<Entry>,
    ev: &mut Vec<crate::Event>,
) {
    let original = ledger.len();
    let now = w.server_time;
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        if !w.standing(ix) || !source(w, ix) {
            continue;
        }
        let Some(ti) = w.core(ix).signature.target.and_then(|id| w.fighter_idx(id)) else {
            continue;
        };
        // Seam A: genuine NPC -> player and the admitted player singleton kernel. Camp recipients are seam B,
        // and remain excluded by the unchanged Full/PvE gate rather than being flattened into singleton parity.
        if !w.is_player(ti) {
            continue;
        }
        let target = w.core(ti).id;
        let distance = crate::math::hypot(
            w.core(ti).body.x - w.core(ix).body.x,
            w.core(ti).body.y - w.core(ix).body.y,
        );
        let m = &mut w.core_mut(ix).signature.mark;
        if distance > TARGET_RANGE {
            if let Some(since) = m.far_since {
                if now - since >= TARGET_LOS_GRACE_MS {
                    w.core_mut(ix).signature.clear_target();
                    continue;
                }
            } else {
                m.far_since = Some(now);
            }
        } else {
            m.far_since = None;
        }
        if m.tier == 0 {
            m.group = Some(crate::fighter::MarkGroup::Fighter(target));
            m.group_size = 1;
        }
        let count = ledger[..original]
            .iter()
            .filter(|e| qualifies(w, ix, e))
            .count();
        let chill = w.core(ix).signature.chill;
        let player = w.is_player(ix);
        let no_commutation = player
            && w.players[ix.slot()]
                .build
                .has_flag(crate::stat_fold::EffectFlag::NoCommutation);
        let swift_judgment = player
            && w.players[ix.slot()]
                .build
                .has_flag(crate::stat_fold::EffectFlag::SwiftJudgment);
        let increment =
            crate::modifiers::mark_progress_increment(w.core(ix).modifiers.mark_rate(), chill);
        let m = &mut w.core_mut(ix).signature.mark;
        for _ in 0..count {
            m.hits += 1;
            m.progress += increment;
        }
        if count > 0 || m.tier > 0 {
            let swaps = m.swaps as f64 * if no_commutation { 2. } else { 1. }
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
                        recipient: target,
                        notice: crate::events::MarkNotice::Marked,
                    });
                }
                w.core_mut(ix).signature.mark.tier = tier;
            }
        }
        for n in 0..original {
            if !qualifies(w, ix, &ledger[n]) {
                continue;
            }
            let e = &ledger[n];
            let raw = if player {
                crate::modifiers::mark_pulse(
                    &w.players[ix.slot()],
                    e.weapon.unwrap(),
                    w.core(ti).vitals.max_hp,
                    distance <= MARK_NEAR_RANGE,
                )
            } else {
                npc_pulse(
                    w,
                    ix,
                    e.weapon.unwrap(),
                    w.core(ti).vitals.max_hp,
                    distance <= MARK_NEAR_RANGE,
                )
            };
            if !(raw > 0.) {
                continue;
            }
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
                    raw,
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
/// NPC owners read the faction's base Mark, not player bonus mirrors, sentence, cards or Hunt stacks.
fn npc_pulse(
    w: &World,
    ix: crate::fighter::FighterIx,
    weapon: crate::WeaponId,
    hp: f64,
    near: bool,
) -> f64 {
    let c = w.core(ix);
    let mob = w.mobs.get(c.id).expect("typed NPC source");
    let ty = crate::mob_catalog::mob_type_by_id(mob.mob_type.expect("typed NPC").as_str())
        .expect("known catalog type");
    let k = if mob.elite { ELITE_K } else { MOB_K };
    let d = MOB_DMG_MULT * if mob.elite { ELITE_DMG_MULT } else { 1. };
    // Source mobFaction scales this percentage by k*d in one multiplication, mobTypeFaction applies role/reach
    // (Sentenced has no zone correction), then pacedFaction applies DUEL_PACE. HP multipliers never enter MarkPct.
    let role = ty.role_def().dmg_mult * crate::mob_catalog::mob_reach_damage(ty);
    let pct = ((MARK_BASE_PCT * (k * d)) * role) * DUEL_PACE;
    let f = crate::content::paced(FactionId::Sentenced);
    let speed = c.modifiers.mirrors().as_mult;
    let weight = f.rate
        * crate::content::weapon(weapon).dps_mult
        * speed
        * crate::content::attack_interval(&f, weapon, speed);
    pct * hp * weight * if near { 1. } else { MARK_FAR_SHARE }
}
pub(crate) fn weapon_swapped(hx: &mut Hx, args: &HookArgs) {
    if !hx.k.config.faction_mode.sentenced() {
        return;
    }
    let HookArgs::WeaponSwapped(id) = *args else {
        return;
    };
    for slot in 0..hx.w.fighter_count() {
        let p = hx.w.core_mut(crate::fighter::FighterIx::of_slot(slot));
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
    let Some(ix) = hx.w.fighter_idx(owner) else {
        return;
    };
    if hx.w.core(ix).vitals.faction != FactionId::Sentenced {
        return;
    }
    let player = hx.w.is_player(ix);
    let now = hx.w.server_time;
    let p = hx.w.core_mut(ix);
    p.signature.mark.amp_until = p.signature.mark.amp_until.max(now + MARK_DENIAL_LINGER_MS);
    let newly_denied = !p.signature.mark.denied;
    p.signature.mark.denied = true;
    if player && newly_denied {
        hx.w.players[ix.slot()].credit.sentence = hx.w.players[ix.slot()]
            .credit
            .sentence
            .saturating_add(1)
            .min(MARK_KILL_STACK_CAP);
    }
    let final_verdict = player
        && hx.w.players[ix.slot()]
            .build
            .has_flag(crate::stat_fold::EffectFlag::FinalVerdict);
    let weapon = hx.w.core(ix).active_weapon();
    debug_assert!(
        !hx.w.pay.collecting,
        "payout bank is sealed before hook delivery"
    );
    assert!(denied.start + denied.len <= hx.w.pay.mark_denied_amounts.len());
    for n in denied.start..denied.start + denied.len {
        let (id, amount) = hx.w.pay.mark_denied_amounts[n];
        if hx.w.idx(id).is_some() {
            hx.ev.push(crate::Event::MarkNotice {
                recipient: id,
                notice: crate::events::MarkNotice::ExecuteBlocked,
            });
        }
        if final_verdict && amount > 0. {
            hx.w.deferred.defer_hit(Entry {
                terrain: false,
                dot: false,
                ability: None,
                arena: false,
                source: None,
                critical: false,
                critical_mult: None,
                sig: None,
                execute: false,
                victim: id,
                by: Some(owner),
                packet: Packet {
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
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        if w.core(ix).vitals.faction == FactionId::Sentenced
            && (!w.standing(ix)
                || returning(w, w.core(ix).id)
                || w.core(ix)
                    .signature
                    .target
                    .is_some_and(|id| w.fighter_idx(id).is_none_or(|t| !w.standing(t))))
        {
            w.core_mut(ix).signature.clear_target();
        }
    }
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let id = w.core(ix).id;
        let blocked = w.standing(ix)
            && cores(w).any(|p| {
                p.signature.mark.tier >= MARK_TOP_TIER
                    && p.signature.target == Some(id)
                    && w.fighter_idx(p.id).is_some_and(|owner| w.standing(owner))
            });
        if blocked {
            w.core_mut(ix).signature.bits |= SIG_EXEC_BLOCKED;
        }
    }
}
fn cores(w: &World) -> impl Iterator<Item = &crate::fighter::FighterCore> {
    w.players
        .iter()
        .map(|p| &p.core)
        .chain(w.mobs.iter().map(|m| &m.core))
}
/// Survivor-only incoming effect tier. No private owner identity is returned.
pub(crate) fn public_mark_tier(w: &World, id: PlayerId) -> u8 {
    if w.fighter_idx(id).is_none_or(|ix| !w.standing(ix)) {
        return 0;
    }
    cores(w)
        .filter(|p| {
            p.signature.target == Some(id) && w.fighter_idx(p.id).is_some_and(|ix| w.standing(ix))
        })
        .map(|p| p.signature.mark.tier)
        .max()
        .unwrap_or(0)
}
/// Public actor eligibility precedes tie selection, including NPC owners. Source lexical labels stay private.
pub(crate) fn public_mark_by(
    w: &World,
    id: PlayerId,
    tier: u8,
    eligible: impl Fn(PlayerId) -> bool,
) -> Option<PlayerId> {
    if tier == 0 {
        return None;
    }
    cores(w)
        .filter(|p| {
            p.signature.target == Some(id)
                && p.signature.mark.tier == tier
                && eligible(p.id)
                && w.fighter_idx(p.id).is_some_and(|ix| w.standing(ix))
        })
        .map(|p| p.id)
        .min()
}

pub(crate) fn validate(k: &MatchStatic, w: &World, p: &crate::state::Player) -> Result<(), String> {
    validate_actor(k, w, &p.core, Some(p))
}
pub(crate) fn validate_actor(
    k: &MatchStatic,
    w: &World,
    p: &crate::fighter::FighterCore,
    player: Option<&crate::state::Player>,
) -> Result<(), String> {
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
    // Ordinary ownership only grows: today's folded rate bounds every earlier rate, even when Gathering Storm was
    // acquired mid-Mark. Only training Clear can remove it without resetting the Mark, so training needs the shipped
    // catalog maximum for historical increments. Never recompute past progress from today's rate. No shipped
    // card/farm/trade/status row subtracts MarkRate.
    let history_rate = if k.config.training && player.is_some() {
        crate::modifiers::maximum_mark_rate()
    } else {
        p.modifiers.mark_rate()
    };
    let max_increment = crate::modifiers::mark_progress_increment(history_rate, min_chill);
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
    let no_commutation = (k.config.training && player.is_some())
        || player.is_some_and(|p| {
            p.build
                .has_flag(crate::stat_fold::EffectFlag::NoCommutation)
        });
    let swift_judgment = (k.config.training && player.is_some())
        || player.is_some_and(|p| {
            p.build
                .has_flag(crate::stat_fold::EffectFlag::SwiftJudgment)
        });
    let tier_min = tier_for(m.swaps as f64);
    let tier_max = tier_for(
        m.swaps as f64 * if no_commutation { 2. } else { 1. }
            + if swift_judgment {
                (m.hits / 2) as f64
            } else {
                0.
            },
    );
    if (enabled && player.is_none() && !typed_npc_source(w,p.id))
        || (!enabled && (*m != empty || player.is_some_and(|p|p.credit.sentence!=0)))
        || player.is_some_and(|p|p.credit.sentence>MARK_KILL_STACK_CAP)
        || m.group_size != 1
        || m.group.is_some_and(|g| match g {
            crate::fighter::MarkGroup::Fighter(id) => p.signature.target!=Some(id) || !w.known_actor(id),
            crate::fighter::MarkGroup::Camp(_) => true, // Grouped camp production/admission belongs to seam B.
        })
        || (m.tier>0 && m.group.is_none())
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
        return Err(format!("invalid Sentenced state for actor {}", p.id.0));
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

#[cfg(test)]
mod npc_tests;
