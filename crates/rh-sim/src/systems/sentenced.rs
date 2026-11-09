//! Shared Sentenced source/group kernel; admission requires the complete source-born consumer gates.
pub(crate) mod mark_tax;
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
    mark_tax::prepare(w, &mut s.mark_tax_next, edges);
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
            if let Some(target) = p
                .signature
                .target
                .filter(|id| w.fighter_idx(*id).is_some_and(|ix| w.standing(ix)))
            {
                if p.signature.mark.group.is_none() {
                    continue;
                }
                for slot in 0..w.fighter_count() {
                    let id = w.core(crate::fighter::FighterIx::of_slot(slot)).id;
                    if member(w, p.id, target, id) {
                        assert!(
                            out.len() < out.capacity(),
                            "Mark snapshot preparation missing"
                        );
                        out.push((p.id, id));
                    }
                }
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
/// Runtime group identity; unlike original size, this is an immutable birth property of an actor.
pub(crate) fn group_of(w: &World, id: PlayerId) -> Option<crate::fighter::MarkGroup> {
    use crate::fighter::MarkGroup;
    w.fighter_idx(id)?;
    Some(
        if let Some(m) = w.mobs.get(id).filter(|m| {
            m.zombie.is_none()
                && m.mob_type.is_some()
                && matches!(
                    m.kind,
                    crate::mob_runtime::MobKind::Regional | crate::mob_runtime::MobKind::Practice
                )
        }) {
            MarkGroup::Camp(m.camp)
        } else {
            MarkGroup::Fighter(id)
        },
    )
}
fn historical_group(w: &World, id: PlayerId) -> Option<crate::fighter::MarkGroup> {
    use crate::{fighter::MarkGroup, mob_runtime::ActorOrigin};
    w.actor_origin(id).map(|origin| match origin {
        ActorOrigin::Mob { camp, .. } | ActorOrigin::Practice { camp, .. } => {
            MarkGroup::Camp(*camp)
        }
        _ => MarkGroup::Fighter(id),
    })
}
fn in_marked_group(w: &World, owner: PlayerId, member: PlayerId) -> bool {
    w.mobs
        .get(member)
        .is_some_and(|m| m.zombie.is_none() && m.mob_type.is_some() && !returning(w, member))
        && w.actor(owner).zip(w.actor(member)).is_some_and(|(a, b)| {
            crate::math::hypot(a.body.x - b.body.x, a.body.y - b.body.y) <= TARGET_RANGE
        })
}
fn member(w: &World, owner: PlayerId, target: PlayerId, id: PlayerId) -> bool {
    w.fighter_idx(id).is_some_and(|ix| w.standing(ix))
        && match group_of(w, target) {
            Some(crate::fighter::MarkGroup::Camp(camp)) => {
                group_of(w, id) == Some(crate::fighter::MarkGroup::Camp(camp))
                    && in_marked_group(w, owner, id)
            }
            _ => id == target,
        }
}
/// Matches source markTierOn: camp members have an immediate leash/Return exclusion; singleton grace is preserved.
pub(crate) fn mark_tier_on(w: &World, owner: PlayerId, target: PlayerId) -> u8 {
    let Some(ox) = w.fighter_idx(owner).filter(|&ix| w.standing(ix)) else {
        return 0;
    };
    let Some(_) = w.fighter_idx(target).filter(|&ix| w.standing(ix)) else {
        return 0;
    };
    let m = &w.core(ox).signature.mark;
    if m.tier == 0 || m.group.is_none() || m.group != group_of(w, target) {
        return 0;
    }
    if matches!(m.group, Some(crate::fighter::MarkGroup::Camp(_)))
        && !in_marked_group(w, owner, target)
    {
        return 0;
    }
    m.tier
}
fn near(w: &World, owner: PlayerId, target: PlayerId) -> bool {
    w.actor(owner).zip(w.actor(target)).is_some_and(|(a, b)| {
        crate::math::hypot(a.body.x - b.body.x, a.body.y - b.body.y) <= MARK_NEAR_RANGE
    }) || w.actor(target).is_some_and(|c| {
        c.statuses.instances.iter().any(|s| {
            s.kind == crate::status_runtime::StatusKind::Zoned
                && s.source.id == Some(owner)
                && s.until > w.server_time
        })
    })
}
fn pool(w: &World, id: PlayerId) -> f64 {
    let c = w.actor(id).expect("standing Mark member");
    if w.mobs.get(id).is_some_and(|m| {
        m.mob_type.is_some() && m.zombie.is_none() && m.kind != crate::mob_runtime::MobKind::Dummy
    }) {
        crate::content::faction(c.faction_id().expect("typed regional Mark member")).hp
    } else {
        c.vitals.max_hp
    }
}
fn serial_bytes(mut serial: u32, buf: &mut [u8; 7]) -> &[u8] {
    let mut start = buf.len();
    loop {
        start -= 1;
        let d = (serial % 36) as u8;
        buf[start] = if d < 10 { b'0' + d } else { b'a' + d - 10 };
        serial /= 36;
        if serial == 0 {
            break;
        }
    }
    &buf[start..]
}
fn lexical_birth(w: &World, a: PlayerId, b: PlayerId) -> std::cmp::Ordering {
    let mut aa = [0; 7];
    let mut bb = [0; 7];
    serial_bytes(
        w.actor_origin(a)
            .and_then(crate::mob_runtime::ActorOrigin::birth_serial)
            .expect("typed group member"),
        &mut aa,
    )
    .cmp(serial_bytes(
        w.actor_origin(b)
            .and_then(crate::mob_runtime::ActorOrigin::birth_serial)
            .expect("typed group member"),
        &mut bb,
    ))
}
/// Pre-pass source excludes Return, post-pass source excludes evasion (currently no evasion state), allowing Return.
pub(crate) fn lost_target(w: &mut World, ix: crate::fighter::FighterIx, before: bool) {
    let f = &w.core(ix).signature;
    let group = f.mark.group;
    let survivor = if f.mark.tier > 0 && matches!(group, Some(crate::fighter::MarkGroup::Camp(_))) {
        w.mobs
            .iter()
            .filter(|m| {
                m.status == crate::Status::Alive
                    && group_of(w, m.core.id) == group
                    && (!before || !returning(w, m.core.id))
            })
            .map(|m| m.core.id)
            .min_by(|a, b| lexical_birth(w, *a, *b))
    } else {
        None
    };
    let f = &mut w.core_mut(ix).signature;
    if let Some(target) = survivor {
        f.target = Some(target);
        f.in_reach = false;
        f.engaged = false;
        f.reach_at = None;
    } else {
        f.clear_target();
    }
}
fn source(w: &World, ix: crate::fighter::FighterIx) -> bool {
    let c = w.core(ix);
    c.vitals.faction == FactionId::Sentenced
        && !returning(w, c.id)
        && (w.is_player(ix) || typed_npc_source(w, c.id))
}
fn returning(w: &World, id: PlayerId) -> bool {
    w.mobs.get(id).is_some_and(|m| m.returning())
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
        && c.signature.target.is_some_and(|target| {
            let group = c.signature.mark.group.or_else(|| group_of(w, target));
            (e.victim == target || (group.is_some() && group == group_of(w, e.victim)))
                && member(w, c.id, target, e.victim)
        })
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
        let target = w.core(ti).id;
        let target_player = w.is_player(ti);
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
        let group = w
            .core(ix)
            .signature
            .mark
            .group
            .or_else(|| group_of(w, target));
        if w.core(ix).signature.mark.tier > 0 && w.core(ix).signature.mark.group != group {
            w.core_mut(ix).signature.clear_target();
            continue;
        }
        if w.core(ix).signature.mark.tier == 0 {
            let size = if matches!(group, Some(crate::fighter::MarkGroup::Camp(_))) {
                cores(w)
                    .filter(|c| {
                        w.fighter_idx(c.id).is_some_and(|i| w.standing(i))
                            && !returning(w, c.id)
                            && group_of(w, c.id) == group
                    })
                    .count()
                    .max(1)
            } else {
                1
            };
            let m = &mut w.core_mut(ix).signature.mark;
            m.group = group;
            m.group_size = size;
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
                if m.tier == 0 && target_player {
                    ev.push(crate::Event::MarkNotice {
                        recipient: target,
                        notice: crate::events::MarkNotice::Marked,
                    });
                }
                w.core_mut(ix).signature.mark.tier = tier;
            }
        }
        let grouped = matches!(
            w.core(ix).signature.mark.group,
            Some(crate::fighter::MarkGroup::Camp(_))
        );
        let share =
            (1. / crate::math::sqrt(w.core(ix).signature.mark.group_size.max(1) as f64)).min(1.);
        // The first qualifying hit visits every group member before the source Set excludes all later hits.
        // Membership/immunity cannot change while appending pulse entries, so this streams the identical rows.
        for n in 0..original {
            if !qualifies(w, ix, &ledger[n]) {
                continue;
            }
            let weapon = ledger[n].weapon.unwrap();
            for slot in 0..w.fighter_count() {
                let mx = crate::fighter::FighterIx::of_slot(slot);
                let victim = w.core(mx).id;
                if !member(w, w.core(ix).id, target, victim) || now < w.core(mx).vitals.immune_until
                {
                    continue;
                }
                let raw = if player {
                    if share == 1. {
                        crate::modifiers::mark_pulse(
                            &w.players[ix.slot()],
                            weapon,
                            pool(w, victim),
                            near(w, w.core(ix).id, victim),
                        )
                    } else {
                        crate::modifiers::mark_pulse_group(
                            &w.players[ix.slot()],
                            weapon,
                            pool(w, victim),
                            near(w, w.core(ix).id, victim),
                            share,
                        )
                    }
                } else {
                    npc_pulse(
                        w,
                        ix,
                        weapon,
                        pool(w, victim),
                        near(w, w.core(ix).id, victim),
                    ) * share
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
                    victim,
                    by: Some(w.core(ix).id),
                    packet: Packet {
                        raw,
                        phys: MARK_PHYS_SHARE,
                        magic: MARK_MAGIC_SHARE,
                        true_: MARK_TRUE_SHARE,
                    },
                    weapon: Some(weapon),
                    stagger: false,
                    projectile: None,
                    scale: 1.,
                    derived: false,
                    passive: false,
                });
            }
            if grouped {
                break;
            }
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
    let group = group_of(hx.w, id);
    for slot in 0..hx.w.fighter_count() {
        let p = hx.w.core_mut(crate::fighter::FighterIx::of_slot(slot));
        if p.signature.mark.tier > 0 && p.signature.mark.group == group && group.is_some() {
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
        if w.core(ix).vitals.faction != FactionId::Sentenced {
            continue;
        }
        if !w.standing(ix) || returning(w, w.core(ix).id) {
            w.core_mut(ix).signature.clear_target();
            continue;
        }
        if w.core(ix)
            .signature
            .target
            .is_some_and(|id| w.fighter_idx(id).is_none_or(|t| !w.standing(t)))
        {
            lost_target(w, ix, false);
        }
    }
    for slot in 0..w.fighter_count() {
        let ix = crate::fighter::FighterIx::of_slot(slot);
        let id = w.core(ix).id;
        let blocked = w.standing(ix)
            && cores(w).any(|p| {
                p.vitals.faction == FactionId::Sentenced
                    && mark_tier_on(w, p.id, id) >= MARK_TOP_TIER
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
    cores(w)
        .filter(|p| p.vitals.faction == FactionId::Sentenced)
        .map(|p| mark_tier_on(w, p.id, id))
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
            p.vitals.faction == FactionId::Sentenced
                && eligible(p.id)
                && mark_tier_on(w, p.id, id) == tier
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
    let group_valid = match m.group {
        None => m.group_size == 1 && m.tier == 0,
        Some(group) => {
            p.signature.target.is_some_and(|target| {
                historical_group(w, target) == Some(group)
                    && group_of(w, target).is_none_or(|current| current == group)
            }) && match group {
                crate::fighter::MarkGroup::Fighter(id) => {
                    m.group_size == 1
                        && (player.is_some()
                            || w.actor_origin(id).is_some_and(|o| {
                                matches!(o, crate::mob_runtime::ActorOrigin::Player { .. })
                            }))
                }
                crate::fighter::MarkGroup::Camp(camp) => {
                    player.is_some()
                        && m.group_size > 0
                        && if k.config.training {
                            (PRACTICE_CAMP_FIRST..=PRACTICE_CAMP_LAST).contains(&camp)
                                && m.group_size <= TRAIN_MAX_MOBS as usize
                        } else {
                            k.arena
                                .map
                                .layers()
                                .and_then(|l| l.data().camps.get(camp as usize))
                                .is_some_and(|c| m.group_size <= c.spots.len())
                        }
                }
            }
        }
    };
    if (enabled && player.is_none() && !typed_npc_source(w,p.id))
        || (!enabled && (*m != empty || player.is_some_and(|p|p.credit.sentence!=0)))
        || player.is_some_and(|p|p.credit.sentence>MARK_KILL_STACK_CAP)
        || !group_valid
        || (enabled && player.is_none() && p.signature.target.is_some_and(|id|!w.actor_origin(id).is_some_and(|o|matches!(o,crate::mob_runtime::ActorOrigin::Player{..}))))
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

#[cfg(test)]
mod group_tests;

#[cfg(test)]
mod group_source_tests;
