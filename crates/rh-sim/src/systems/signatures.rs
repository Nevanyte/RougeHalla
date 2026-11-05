//! Partial faction foundation: genuine player contacts, engagement and Holy sustain.
//! Fire, Plague, Frost, Sentenced, cards and mob signatures are separate pending producers.
use super::{heal, Cx};
use crate::constants::*;
use crate::content::{self, FactionId, Shape, WeaponId};
use crate::geometry::has_line_of_sight;
use crate::hooks::{HookArgs, Hx};
use crate::state::{PlayerId, World};

#[derive(Clone, Copy, Debug)]
pub(crate) struct BlockContact {
    pub attacker: PlayerId,
    pub holder: PlayerId,
    pub passive: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct LandedHit {
    pub sig: Option<crate::factions::SignatureKind>,
    pub weapon: Option<WeaponId>,
    pub victim: PlayerId,
    pub by: Option<PlayerId>,
    pub amount: f64,
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
            p.signature = Default::default();
        }
    }
}
fn contact(
    w: &World,
    out: &mut Vec<Contact>,
    attacker: PlayerId,
    victim: PlayerId,
    amount: f64,
    passive: bool,
) {
    let Some(ai) = w.idx(attacker) else { return };
    let Some(vi) = w.idx(victim) else { return };
    if attacker != victim
        && w.players[ai].standing()
        && w.players[vi].standing()
        && w.server_time >= w.players[vi].vitals.immune_until
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
    contacts: impl Iterator<Item = (PlayerId, &'a Contact)>,
    salt: u32,
    tick: u32,
) -> Option<PlayerId> {
    let mut best: Option<(PlayerId, f64)> = None;
    for (id, c) in contacts {
        if best.is_none_or(|(bid, amount)| {
            c.amount > amount
                || (c.amount == amount
                    && crate::rng::tie_rank(salt, tick, id) < crate::rng::tie_rank(salt, tick, bid))
        }) {
            best = Some((id, c.amount));
        }
    }
    best.map(|(id, _)| id)
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
/// The original beforeDamage row, currently implementing only player engagement.
pub(crate) fn before_damage(cx: &mut Cx) {
    let Cx { k, w, s, .. } = cx;
    let now = w.server_time;
    // Legacy removes nonstanding runtime on this pass. A fighter downed later in the
    // same ledger retains this tick's state until the next active pass, including at run end.
    for i in 0..w.players.len() {
        if !w.players[i].standing() {
            w.players[i].signature = Default::default();
            continue;
        }
        let target = w.players[i].signature.target;
        if target.is_some_and(|id| w.idx(id).is_none_or(|ti| !w.players[ti].standing())) {
            w.players[i].signature.clear_target();
        }
        let p = &mut w.players[i];
        p.signature.hp_frac = if p.vitals.max_hp > 0.0 {
            p.vitals.hp / p.vitals.max_hp
        } else {
            0.0
        };
    }
    s.contacts.clear();
    for e in &s.ledger {
        let raw = e.packet.raw * e.scale;
        if let Some(by) = e.by.filter(|_| raw > 0.0 && e.sig.is_none()) {
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
    for p in w.players.iter_mut().filter(|p| p.standing()) {
        let id = p.id;
        let f = &mut p.signature;
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
        if f.target.is_none() || !outgoing().any(|(other, _)| Some(other) == f.target) {
            if let Some(target) = largest(
                outgoing().filter(|(_, c)| !c.passive),
                k.secrets.order_salt,
                w.tick,
            ) {
                f.set_target(target, now);
            }
        }
        if f.target.is_none() {
            if let Some(target) =
                largest(outgoing().chain(incoming()), k.secrets.order_salt, w.tick)
            {
                f.set_target(target, now);
            }
        }
        if f.target.is_some()
            && outgoing()
                .chain(incoming())
                .any(|(other, _)| Some(other) == f.target)
        {
            f.contact_at = Some(now);
        }
    }
    for i in 0..w.players.len() {
        let p = &w.players[i];
        if !p.standing() {
            continue;
        }
        let Some(ti) = p.signature.target.and_then(|id| w.idx(id)) else {
            continue;
        };
        if p.signature
            .contact_at
            .is_some_and(|t| now - t >= TARGET_FORGET_MS)
        {
            w.players[i].signature.clear_target();
            continue;
        }
        let t = &w.players[ti];
        let weapon = p.active_weapon();
        let (reach, mask) = match content::weapon(weapon).shape {
            Shape::Arc { reach, .. } => (reach + PLAYER_RADIUS, MASK_MELEE),
            Shape::Projectile { range, .. } => (range + PLAYER_RADIUS + RANGED_SLACK, MASK_SIGHT),
        };
        let in_reach = crate::math::hypot(t.body.x - p.body.x, t.body.y - p.body.y) <= reach
            && has_line_of_sight(&k.arena.map, p.pos(), t.pos(), mask);
        let cadence = |p: &crate::state::Player| {
            content::attack_interval(&content::paced(p.vitals.faction), p.active_weapon(), 1.0)
                / p.signature.chill
        };
        let trade = ENGAGE_TRADE_SECONDS
            .max(cadence(p).max(cadence(t)) + ENGAGE_TRADE_SLACK_SECONDS)
            * 1000.0;
        let f = &mut w.players[i].signature;
        f.in_reach = in_reach;
        if in_reach {
            f.reach_at = Some(now);
        }
        f.engaged = f
            .reach_at
            .is_some_and(|t| now - t <= ENGAGE_LINGER_MS + TIE_EPS_MS)
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
    if k.config.faction_mode.plague() {
        super::plague::damage(k, w, &s.performed, &mut s.ledger);
    }
}
/// Ordered post-barrier landed damage feeds combat clocks and surviving Holy attackers.
pub(crate) fn after_damage(cx: &mut Cx) {
    let Cx { k, w, s, ev, .. } = cx;
    s.dealt.clear();
    for h in &s.landed {
        if h.sig.is_some_and(crate::factions::SignatureKind::is_dot) {
            super::plague::accumulate(w, h);
            s.fx.ops.push(crate::fx_report::Op::Contribution(*h));
        }
        for id in [Some(h.victim), h.by].into_iter().flatten() {
            if let Some(i) = w.idx(id).filter(|&i| w.players[i].standing()) {
                w.players[i].signature.combat_at = Some(w.server_time);
            }
        }
        let Some(by) = h.by else { continue };
        if let Some((_, amount)) = s.dealt.iter_mut().find(|(id, _)| *id == by) {
            *amount += h.amount;
        } else {
            s.dealt.push((by, h.amount));
        }
    }
    for &(id, amount) in &s.dealt {
        let Some(i) = w.idx(id).filter(|&i| w.players[i].standing()) else {
            continue;
        };
        let p = &w.players[i];
        if p.vitals.faction == FactionId::Holy {
            let gain = amount * content::holy_lifesteal_fraction(p.signature.hp_frac);
            heal::apply(w, ev, i, gain, heal::Kind::Lifesteal);
        }
    }
    if k.config.faction_mode.frost() {
        super::frost::ranged_hits(w, &s.landed);
    }
    super::plague::after_damage(k, w, ev, &mut s.fx);
}

impl crate::Sim {
    /// Trusted diagnostics of the most recent active ledger pass, in victim/entry order.
    /// Not observer data. Scratch starts empty on restore and is replaced on the next active step.
    pub fn landed_hits(&self) -> &[LandedHit] {
        &self.s.landed
    }
}
