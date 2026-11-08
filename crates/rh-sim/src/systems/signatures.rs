//! Shared engagement and basic Holy/Fire/Plague faction consumers.
//! Regional Frost/Sentenced and auxiliary faction producers remain outside the admitted PvE domain.
use super::{heal, Cx};
use crate::constants::*;
use crate::content::{self, FactionId, Shape, WeaponId};
use crate::fighter::FighterIx;
use crate::geometry::has_line_of_sight;
use crate::hooks::{HookArgs, Hx};
use crate::state::{PlayerId, World};

#[derive(Clone, Copy, Debug)]
pub(crate) struct BlockContact {
    pub attacker: PlayerId,
    pub holder: PlayerId,
    pub passive: bool,
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct LandedHit {
    pub critical: bool,
    pub cut: f64,
    pub ability: Option<crate::status_runtime::AbilityId>,
    pub dot: bool,
    pub sig: Option<crate::factions::SignatureKind>,
    pub weapon: Option<WeaponId>,
    pub victim: PlayerId,
    pub by: Option<PlayerId>,
    pub amount: f64,
    /// The Race to 0 share of the entry's multiplier (G4: lifesteal must not feed on it; 1 for none).
    pub race: f64,
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct Contact {
    attacker: PlayerId,
    victim: PlayerId,
    amount: f64,
    passive: bool,
}

pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::RaidStarted {
        hx.w.factions.dot.clear();
        hx.w.factions.dot_since = hx.w.server_time;
        if let Some(fx) = hx.fx.as_deref_mut() {
            fx.ops.push(crate::fx_report::Op::Reset(hx.ev.len()));
        }
        for p in hx.w.players.iter_mut() {
            p.credit.sentence = 0;
            let mut ap_hits = std::mem::take(&mut p.signature.ap_hits);
            ap_hits.reset();
            p.signature = crate::fighter::Signature {
                ap_hits,
                ..Default::default()
            };
        }
    }
}
/// Source `factions`' teleported hook: `resetAll(world, true)`, then `dropHealsOverTime`, then `rearmTriggers`.
/// A fresh fight in the coliseum: nobody carries a target, a mark or a chill through the teleport (the heal lockout
/// keeps running), and the damage-over-time buckets are dropped without a flush.
pub(crate) fn teleported(hx: &mut Hx, args: &HookArgs) {
    if *args != HookArgs::Teleported {
        return;
    }
    // resetAll(world, keepCombat = true): every combatant's faction runtime starts over; only the heal lockout's clock
    // (source `combatAt`) survives. The source also drops the ephemeral mark index and re-folds the mirrors of whoever
    // it taxed; the shipped sheet's tax is neutral and unported (the row stays Pending), so there is no index and no
    // mirror to re-fold here.
    let fighters = hx.w.fighter_count();
    for slot in 0..fighters {
        let core = hx.w.core_mut(FighterIx::of_slot(slot));
        let combat_at = core.signature.combat_at;
        // The source clears only the mark-derived bits of the synced `sig` field (taxed, suppressed, exec-blocked) and
        // lets the next after-damage pass rebuild the rest; only the exec-blocked bit exists in the ported domain.
        let bits = core.signature.bits & !crate::constants::SIG_EXEC_BLOCKED;
        let mut ap_hits = std::mem::take(&mut core.signature.ap_hits);
        ap_hits.reset();
        core.signature = crate::fighter::Signature {
            ap_hits,
            combat_at,
            bits,
            ..Default::default()
        };
    }
    hx.w.factions.dot.clear();
    hx.w.factions.dot_since = hx.w.server_time;
    // dropHealsOverTime: the steps still to come are forgotten (the first paid step has already landed).
    super::heal::drop_over_time(hx.w);
    // rearmTriggers: forget the once-keys of a `rearm: "teleport"` trigger row. The shipped catalog has no such row
    // (the captured catalog source carries no `rearm` field), so the source loop deletes nothing and the fired set is
    // kept across the teleport; `teleport_tests` pins the retention.
}
fn contact(
    w: &World,
    out: &mut Vec<Contact>,
    attacker: PlayerId,
    victim: PlayerId,
    amount: f64,
    passive: bool,
) {
    let Some(ai) = w.fighter_idx(attacker) else {
        return;
    };
    let Some(vi) = w.fighter_idx(victim) else {
        return;
    };
    if attacker != victim
        && w.standing(ai)
        && w.standing(vi)
        && (w.is_player(ai) || w.is_player(vi))
        && !returning(w, attacker)
        && (!w.is_player(vi) || w.server_time >= w.core(vi).vitals.immune_until)
    {
        out.push(Contact {
            attacker,
            victim,
            amount,
            passive,
        });
    }
}
fn largest<'a>(
    origins: &crate::store::Store<crate::mob_runtime::ActorProvenance>,
    contacts: impl Iterator<Item = (PlayerId, &'a Contact)>,
    salt: u32,
    tick: u32,
) -> Option<PlayerId> {
    let mut best: Option<(PlayerId, f64)> = None;
    for (id, c) in contacts {
        if best.is_none_or(|(bid, amount)| {
            c.amount > amount
                || (c.amount == amount
                    && crate::rng::tie_rank_origin(
                        salt,
                        tick,
                        &origins.get(id).expect("known fighter").origin,
                    ) < crate::rng::tie_rank_origin(
                        salt,
                        tick,
                        &origins.get(bid).expect("known fighter").origin,
                    ))
        }) {
            best = Some((id, c.amount));
        }
    }
    best.map(|(id, _)| id)
}
fn returning(w: &World, id: PlayerId) -> bool {
    w.mobs
        .get(id)
        .is_some_and(|m| m.brain.mode == crate::mob_runtime::BrainMode::Return)
}
pub(crate) fn after_weapons(cx: &mut Cx) {
    if cx.k.config.faction_mode.frost() {
        super::frost::after_weapons(cx);
    }
    let s = &mut cx.s;
    s.performed.clear();
    s.performed_bounded =
        s.melee.len() + s.flight.spawns.len() <= crate::fx_report::FX_INSTANT_BUCKETS_MAX;
    // Each weapon update has exactly two request-producing land sites: an old due action,
    // then a newly started zero-windup action. Check the per-owner limit independently.
    for a in s
        .melee
        .iter()
        .map(|m| crate::factions::PerformedAttack {
            by: m.attacker,
            weapon: m.weapon,
        })
        .chain(
            s.flight
                .spawns
                .iter()
                .map(|p| crate::factions::PerformedAttack {
                    by: p.owner,
                    weapon: p.weapon,
                }),
        )
    {
        if s.performed.iter().filter(|p| p.by == a.by).count() >= 2 {
            s.performed_bounded = false;
        }
        s.performed.push(a);
    }
}
/// The original beforeDamage row, shared by admitted standing combatants.
pub(crate) fn before_damage(cx: &mut Cx) {
    let Cx { k, w, s, .. } = cx;
    let now = w.server_time;
    // Legacy removes nonstanding runtime on this pass. A fighter downed later in the
    // same ledger retains this tick's state until the next active pass, including at run end.
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        if !w.standing(ix) {
            w.core_mut(ix).signature = Default::default();
            continue;
        }
        let p = w.core(ix);
        let clear = returning(w, p.id)
            || p.signature
                .target
                .is_some_and(|id| w.fighter_idx(id).is_none_or(|ti| !w.standing(ti)));
        let p = w.core_mut(ix);
        if clear {
            p.signature.clear_target();
        }
        p.signature.hp_frac = if p.vitals.max_hp > 0. {
            p.vitals.hp / p.vitals.max_hp
        } else {
            0.
        };
    }
    s.contacts.clear();
    for e in &s.ledger {
        let raw = e.packet.raw * e.scale;
        if let Some(by) =
            e.by.filter(|_| raw > 0.0 && e.sig.is_none() && e.ability.is_none() && !e.dot)
        {
            contact(
                w,
                &mut s.contacts,
                by,
                e.victim,
                raw,
                e.passive || (e.projectile.is_some() && e.weapon == Some(WeaponId::Shield)),
            );
        }
    }
    for b in &s.blocks {
        contact(w, &mut s.contacts, b.attacker, b.holder, 0.0, b.passive);
    }
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        let p = w.core(ix);
        if !w.standing(ix) || returning(w, p.id) {
            continue;
        }
        let id = p.id;
        let mut target = p.signature.target;
        let outgoing = || {
            s.contacts
                .iter()
                .filter(|c| c.attacker == id)
                .map(|c| (c.victim, c))
        };
        let incoming = || {
            s.contacts
                .iter()
                .filter(|c| c.victim == id)
                .map(|c| (c.attacker, c))
        };
        let mut selected = None;
        if target.is_none() || !outgoing().any(|(other, _)| Some(other) == target) {
            selected = largest(
                &w.actor_history,
                outgoing().filter(|(_, c)| !c.passive),
                k.secrets.order_salt,
                w.tick,
            );
            if selected.is_some() {
                target = selected;
            }
        }
        if target.is_none() {
            selected = largest(
                &w.actor_history,
                outgoing().chain(incoming()),
                k.secrets.order_salt,
                w.tick,
            );
            target = selected;
        }
        let contacted = target.is_some()
            && outgoing()
                .chain(incoming())
                .any(|(other, _)| Some(other) == target);
        let f = &mut w.core_mut(ix).signature;
        if let Some(t) = selected {
            f.set_target(t, now);
        }
        if contacted {
            f.contact_at = Some(now);
        }
    }
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        let p = w.core(ix);
        if !w.standing(ix) || returning(w, p.id) {
            continue;
        }
        let Some(ti) = p.signature.target.and_then(|id| w.fighter_idx(id)) else {
            continue;
        };
        if p.signature
            .contact_at
            .is_some_and(|t| now - t >= TARGET_FORGET_MS)
        {
            w.core_mut(ix).signature.clear_target();
            continue;
        }
        let t = w.core(ti);
        let weapon = p.active_weapon();
        let (reach, mask) = match content::weapon(weapon).shape {
            Shape::Arc { reach, .. } => (reach + PLAYER_RADIUS, MASK_MELEE),
            Shape::Projectile { range, .. } => (range + PLAYER_RADIUS + RANGED_SLACK, MASK_SIGHT),
        };
        let in_reach = crate::math::hypot(t.body.x - p.body.x, t.body.y - p.body.y) <= reach
            && has_line_of_sight(k.collision_map(w.rt.gates_locked), p.pos(), t.pos(), mask);
        // Source signature cadence deliberately excludes the attack-speed mirror.
        let cadence = |i| {
            let p = w.core(i);
            content::attack_interval(&w.paced_sheet(i), p.active_weapon(), 1.) / p.signature.chill
        };
        let trade = ENGAGE_TRADE_SECONDS
            .max(cadence(ix).max(cadence(ti)) + ENGAGE_TRADE_SLACK_SECONDS)
            * 1000.;
        let linger = if matches!(p.vitals.faction, FactionId::Fire | FactionId::Plague) {
            p.modifiers.linger_mult()
        } else {
            1.
        };
        let f = &mut w.core_mut(ix).signature;
        f.in_reach = in_reach;
        if in_reach {
            f.reach_at = Some(now);
        }
        f.engaged = f
            .reach_at
            .is_some_and(|t| now - t <= ENGAGE_LINGER_MS * linger + TIE_EPS_MS)
            && f.contact_at.is_some_and(|t| now - t <= trade + TIE_EPS_MS);
    }
    if k.config.faction_mode.sentenced() {
        super::sentenced::before_damage(k, w, &mut s.ledger, cx.ev);
    }
    s.mark_denials = [None; MAX_PLAYERS];
    if k.config.faction_mode.sentenced() {
        for (i, p) in w.players.iter().enumerate() {
            if p.standing()
                && p.vitals.faction == FactionId::Sentenced
                && p.signature.mark.tier >= MARK_TOP_TIER
            {
                s.mark_denials[i] = p.signature.target.map(|target| (p.id, target));
            }
        }
    }
    crate::modifiers::hit_window::update(w, &s.ledger);
    if k.config.faction_mode.plague() {
        super::plague::damage(k, w, &s.performed, &mut s.ledger);
    }
}
/// Ordered post-barrier landed damage feeds combat clocks and surviving Holy attackers.
pub(crate) fn after_damage(cx: &mut Cx) {
    let Cx {
        k, w, s, ev, stats, ..
    } = cx;
    s.dealt.clear();
    for h in &s.landed {
        if h.sig.is_some_and(crate::factions::SignatureKind::is_dot) {
            super::plague::accumulate(w, h);
            s.fx.ops.push(crate::fx_report::Op::Contribution(*h));
        }
        for id in [Some(h.victim), h.by].into_iter().flatten() {
            if let Some(i) = w.fighter_idx(id).filter(|&i| w.standing(i)) {
                w.core_mut(i).signature.combat_at = Some(w.server_time);
            }
        }
        let Some(by) = h.by else { continue };
        let dot = h.dot || h.sig.is_some_and(crate::factions::SignatureKind::is_dot);
        let fed = h.amount / h.cut / if h.race > 0. { h.race } else { 1. };
        if let Some((_, amount, dot_amount)) = s.dealt.iter_mut().find(|(id, _, _)| *id == by) {
            *amount += fed;
            if dot {
                *dot_amount += fed;
            }
        } else {
            s.dealt.push((by, fed, if dot { fed } else { 0. }));
        }
    }
    for &(id, amount, dot_amount) in &s.dealt {
        let Some(i) = w.fighter_idx(id).filter(|&i| w.standing(i)) else {
            continue;
        };
        let p = w.core(i);
        let v = stats.view(p);
        let holy = p.vitals.faction == FactionId::Holy;
        let own = if holy {
            content::holy_lifesteal_fraction(p.signature.hp_frac)
        } else {
            0.
        };
        let rows = if holy && w.is_player(i) {
            v.lifesteal_rows * crate::status_runtime::stats::HOLY_LEECH_ROW_MULT
        } else {
            v.lifesteal_rows
        };
        let share = crate::status_runtime::stats::lifesteal_total(
            own,
            rows,
            v.lifesteal_mult,
            0.,
            v.farm_lifesteal_rows,
        );
        let dot = if v.lifesteal_dot > 0. { dot_amount } else { 0. };
        let gain = (amount - dot) * share
            + dot
                * crate::status_runtime::stats::lifesteal_total(
                    own,
                    rows,
                    v.lifesteal_mult,
                    v.lifesteal_dot,
                    v.farm_lifesteal_rows,
                );
        if gain > 0. {
            heal::apply(w, ev, i.slot(), gain, heal::Kind::Lifesteal);
        }
    }
    if k.config.faction_mode.frost() {
        super::frost::ranged_hits(w, &s.landed);
    }
    super::plague::after_damage(k, w, ev, &mut s.fx);
    // Festering Arcana: the damage-over-time signature stopped running on a target (source engagedOn).
    for i in 0..w.players.len() {
        let faction = w.players[i].vitals.faction;
        let deals_dot = matches!(faction, FactionId::Fire | FactionId::Plague);
        let engaged = w.players[i].signature.engaged;
        let current = if deals_dot && engaged {
            w.players[i].signature.target
        } else {
            None
        };
        let was = w.players[i].signature.engaged_on;
        w.players[i].signature.engaged_on = current;
        if was.is_none() || was == current || !deals_dot {
            continue;
        }
        let from = was.unwrap();
        if !w.players[i]
            .build
            .has_flag(crate::stat_fold::EffectFlag::Festering)
        {
            continue;
        }
        let ap = w.players[i].modifiers.mirrors().ap_bonus;
        if !(ap > 0.) {
            continue;
        }
        let Some(ti) = w.fighter_idx(from) else {
            continue;
        };
        if !w.standing(ti)
            || crate::status_runtime::untargetable(&w.core(ti).statuses.instances, w.server_time)
        {
            continue;
        }
        let owner = w.players[i].id;
        let Some(name) = w.roster.label(owner).cloned() else {
            continue;
        };
        let apply = crate::status_runtime::StatusApply {
            kind: crate::status_runtime::StatusKind::Dot,
            source: crate::status_runtime::StatusSource {
                id: Some(owner),
                name,
                owner_id: None,
            },
            ms: f64::from(crate::constants::FESTERING_TICKS) * crate::constants::FESTERING_TICK_MS,
            ability: None,
            tag: Some(crate::status_runtime::StatusTag::Text(
                std::sync::Arc::from("festering"),
            )),
            value: Some(ap * crate::constants::FESTERING_AP_SHARE),
            add: None,
            data: Some(crate::status_runtime::Payload {
                shares: Some(crate::content::DamageShares {
                    phys: 0.,
                    magic: 1.,
                    true_: 0.,
                }),
                ..Default::default()
            }),
        };
        crate::systems::status::operations::apply_with(k, w, ev, from, apply, true, *stats);
    }
}

impl crate::Sim {
    /// Trusted diagnostics of the most recent active ledger pass, in victim/entry order.
    /// Not observer data. Scratch starts empty on restore and is replaced on the next active step.
    pub fn landed_hits(&self) -> &[LandedHit] {
        &self.s.landed
    }
}

/// Shared trusted restore checks; historical actor identity is typed and retained.
pub(crate) fn validate_basic(
    k: &crate::statics::MatchStatic,
    w: &World,
    id: PlayerId,
    sig: &crate::fighter::Signature,
) -> Result<(), String> {
    if !sig.ap_hits.valid(w.server_time) || sig.ap_hits.target.is_some_and(|t| !w.known_actor(t)) {
        return Err("invalid AP hit history".into());
    }
    super::frost::validate_signature(k.config.faction_mode.frost(), w, id, sig)?;
    let owner = id;
    if (!k.config.faction_mode.engagement() && *sig != crate::fighter::Signature::default())
        || !sig.hp_frac.is_finite()
        || !(0.0..=w.server_time + crate::constants::WAND_WINDUP_MAX_S * 1000.0)
            .contains(&sig.dot_paused_until)
        || sig.bits
            & !(crate::constants::SIG_CHILLED
                | crate::constants::SIG_DISEASED
                | crate::constants::SIG_EXECUTE
                | crate::constants::SIG_BURNING
                | crate::constants::SIG_EXEC_BLOCKED)
            != 0
        || (!k.config.faction_mode.plague() && sig.bits != 0)
        || (!k.config.faction_mode.fire() && sig.bits & crate::constants::SIG_BURNING != 0)
        || (!k.config.faction_mode.sentenced()
            && sig.bits & crate::constants::SIG_EXEC_BLOCKED != 0)
        || [sig.reach_at, sig.contact_at, sig.combat_at]
            .into_iter()
            .flatten()
            .any(|t| !(0.0..=w.server_time).contains(&t))
        || sig
            .target
            .is_some_and(|id| id == owner || !w.known_actor(id))
        || (sig.target.is_some() && sig.contact_at.is_none())
        || (sig.target.is_none() && (sig.in_reach || sig.engaged || sig.reach_at.is_some()))
        || ((sig.in_reach || sig.engaged) && sig.reach_at.is_none())
    {
        return Err(format!("invalid signature state for actor {}", id.0));
    }
    Ok(())
}

#[cfg(test)]
mod pve_tests;
#[cfg(test)]
mod teleport_tests;
