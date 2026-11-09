//! Scheduled status lifecycle and hooks. Ability spending/landing/refunds remain P-ABIL-owned.
pub(crate) mod dot;
pub(crate) mod operations;
use crate::status_runtime::stats::Inputs;
use crate::{
    events::Event,
    hooks::{HookArgs, Hx},
    state::{PlayerId, World},
    statics::MatchStatic,
    status_runtime::{self as rt, FieldKind, FieldSelector, Selector, StatusInstance, StatusKind},
    systems::Cx,
};

pub(crate) fn expire(cx: &mut Cx) {
    let Cx {
        k, w, s, ev, stats, ..
    } = cx;
    let stats = *stats;
    let now = w.server_time;
    s.status_active.clear();
    s.status_active.extend(
        (0..w.fighter_count())
            .map(|i| w.core(crate::fighter::FighterIx::of_slot(i)))
            .filter(|p| p.statuses.cast.is_some() || !p.statuses.instances.is_empty())
            .map(|p| p.id),
    );
    for n in 0..s.status_active.len() {
        let id = s.status_active[n];
        s.status_removed.clear();
        operations::remove_into_with(
            k,
            w,
            ev,
            id,
            Selector::Expired { at: now },
            &mut s.status_removed,
            stats,
        );
        for index in 0..s.status_removed.len() {
            let st = &s.status_removed[index];
            match st.kind {
                StatusKind::DeathFloor => pay_floor(w, ev, id, st, stats),
                StatusKind::Hidden => end_fields_with(
                    k,
                    w,
                    FieldSelector::Cloud {
                        owner: id,
                        ability: st.ability,
                    },
                    stats,
                ),
                StatusKind::Zoned => {
                    if let Some(field) = st.data.field_id {
                        super::fields::remove(w, field);
                    }
                }
                _ => {}
            }
        }
    }
    s.status_removed.clear();
    end_fields_with(k, w, FieldSelector::Expired(now), stats);
}

pub(crate) fn finish(cx: &mut Cx) {
    let Cx {
        k, w, ev, stats, ..
    } = cx;
    let stats = *stats;
    let now = w.server_time;
    end_zones(k, w, ev, stats);
    for i in 0..w.fighter_count() {
        let p = w.core_mut(crate::fighter::FighterIx::of_slot(i));
        if p.statuses.cast.is_none() && p.statuses.instances.is_empty() {
            continue;
        }
        if let Some(a) = p.weapon.action {
            rt::reveal(&mut p.statuses, now, a.lands_at + rt::HIDDEN_REVEAL_MS)
        }
        p.statuses.refresh_effects(now);
    }
}
fn pay_floor(w: &mut World, ev: &mut Vec<Event>, id: PlayerId, st: &StatusInstance, stats: Inputs) {
    let amount = st.taken.unwrap_or(0.) * st.data.heal_share.unwrap_or(0.);
    if amount > 0. {
        if let Some(i) = w.fighter_idx(id) {
            let view = stats.view(w.core(i));
            super::heal::apply_with(w, ev, i.slot(), amount, super::heal::Kind::DeathFloor, view);
        }
    }
}
fn end_fields_with(k: &MatchStatic, w: &mut World, selector: FieldSelector, stats: Inputs) {
    let mut i = 0;
    while let Some(f) = w.abilities.as_ref().and_then(|a| a.fields.get(i)) {
        if !selector.matches(f) {
            i += 1;
            continue;
        }
        let f = w.abilities.as_mut().unwrap().fields.remove(i);
        match f.kind {
            FieldKind::Zone => {
                if let Some(subject) = f.subject {
                    operations::remove_discard_with(
                        k,
                        w,
                        subject,
                        Selector::Field {
                            kind: StatusKind::Zoned,
                            id: f.id,
                        },
                        stats,
                    );
                }
            }
            FieldKind::Cloud => {
                if let Some(owner) = f.owner.id {
                    operations::remove_discard_with(
                        k,
                        w,
                        owner,
                        Selector::HiddenKey {
                            source: f.owner.id,
                            ability: Some(f.ability),
                        },
                        stats,
                    );
                }
            }
            FieldKind::Trail => {}
        }
    }
}
fn end_zones(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, stats: Inputs) {
    let mut i = 0;
    while let Some(f) = w.abilities.as_ref().and_then(|a| a.fields.get(i)) {
        if f.kind != FieldKind::Zone {
            i += 1;
            continue;
        }
        let subject = f
            .subject
            .and_then(|id| w.fighter_idx(id))
            .filter(|i| w.standing(*i))
            .map(|i| w.core(i));
        if subject.is_some_and(|p| crate::math::hypot(p.body.x - f.x, p.body.y - f.y) <= f.r) {
            i += 1;
            continue;
        }
        let outside = subject.map(|p| p.id);
        let f = f.clone();
        end_fields_with(k, w, FieldSelector::Id(f.id), stats);
        if let Some(id) = outside {
            if let Some(ms) = f
                .exit_stun_ms
                .or(rt::rank_one_field_policy(f.ability).exit_stun_ms)
            {
                operations::apply_with(
                    k,
                    w,
                    ev,
                    id,
                    rt::StatusApply {
                        kind: StatusKind::Stun,
                        source: f.owner,
                        ms,
                        ability: Some(f.ability),
                        tag: None,
                        value: None,
                        add: None,
                        data: None,
                    },
                    false,
                    stats,
                );
            }
        }
    }
}
pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    if let HookArgs::FighterOut { id, .. } = *args {
        hx.pay_later(crate::systems::ledger::PayLater::ClearStatuses { victim: id });
    }
}
pub(crate) fn clear_fighter_with(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    stats: Inputs,
) {
    cancel_cast(k, w, ev, id, rt::CastEndReason::Cancelled, false);
    operations::remove_discard_with(k, w, id, Selector::All, stats);
    end_fields_with(k, w, FieldSelector::Departed(id), stats);
}
pub(crate) fn on_applied(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::StatusApplied { id, kind, .. } = *args else {
        return;
    };
    let Some(i) = hx.w.fighter_idx(id) else {
        return;
    };
    let now = hx.w.server_time;
    if kind == StatusKind::Stun && hx.w.core(i).weapon.action.is_some() {
        super::weapons::cancel_action(hx.w.core_mut(i), now);
    }
    if let Some(c) = hx.w.core(i).statuses.cast {
        let cancel = match kind {
            StatusKind::Stun => c.cancelled_by.stun,
            StatusKind::Silence => c.cancelled_by.silence,
            StatusKind::Root => c.cancelled_by.root,
            _ => false,
        };
        if cancel {
            cancel_cast(hx.k, hx.w, hx.ev, id, rt::CastEndReason::Interrupted, false);
        }
    }
    if kind == StatusKind::SlowAttack {
        refold_attack_with(hx.k, hx.w, i.slot(), hx.stats);
    }
}
/// The abilities chain on the `staggered` hook: interrupts the pending cast only when its definition lists a
/// stagger. A Wish lists stun and silence alone, so a sword stagger never wastes a Wish (it can still drop the
/// weapon windup: weapons.stagger does that itself).
pub(crate) fn staggered(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::Staggered { id } = *args else {
        return;
    };
    let Some(i) = hx.w.fighter_idx(id) else {
        return;
    };
    if let Some(c) = hx.w.core(i).statuses.cast {
        if c.cancelled_by.stagger {
            cancel_cast(hx.k, hx.w, hx.ev, id, rt::CastEndReason::Interrupted, false);
        }
    }
}

pub(crate) fn cancel_cast(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    reason: rt::CastEndReason,
    refund: bool,
) {
    let Some(i) = w.fighter_idx(id) else { return };
    let Some(c) = w.core(i).statuses.cast else {
        return;
    };
    ev.push(Event::CastEnded {
        event_time: w.server_time,
        id,
        ability: c.ability,
        reason,
    });
    #[cfg(feature = "trusted-status-probes")]
    crate::status_runtime::probe::record_cast(w, id, c.ability, reason);
    crate::hooks::cast_ended(
        k,
        w,
        ev,
        id,
        c.ability,
        crate::hooks::CastOutcome::Cancelled(reason),
    );
    if refund && k.config.abilities == crate::abilities::Mode::Full {
        if let Some(detail) = c.producer {
            if let Some(p) = w.idx(id).map(|i| &mut w.players[i]) {
                p.stocks.wish_ready_at = detail.previous_ready_at;
                if let Some(full) = detail.previous_full_at {
                    p.stocks.wish_full_at = Some(full);
                }
            }
        }
    }
    w.core_mut(i).statuses.cast = None;
    let now = w.server_time;
    w.core_mut(i).statuses.refresh_effects(now);
}
pub(crate) fn attack_started(hx: &mut Hx, args: &HookArgs) {
    crate::vision::attack_started(hx, args);
    let HookArgs::AttackStarted(id) = *args else {
        return;
    };
    let now = hx.w.server_time;
    if let Some(i) = hx.w.fighter_idx(id) {
        if let Some(a) = hx.w.core(i).weapon.action {
            rt::reveal(
                &mut hx.w.core_mut(i).statuses,
                now,
                a.lands_at + rt::HIDDEN_REVEAL_MS,
            );
        }
    }
}
pub(crate) fn movement(
    w: &World,
    p: &crate::fighter::FighterCore,
    _dt: f64,
    stats: rt::StatView,
) -> f64 {
    rt::move_multiplier(
        &p.statuses,
        w.server_time,
        stats.slow_resist,
        stats.buff_move,
    )
}
pub(crate) fn attack_source(
    w: &World,
    p: &crate::fighter::FighterCore,
    stats: crate::schedule::ModSourceInputs,
) -> Option<crate::schedule::ModContribution> {
    let f = rt::attack_slow_factor(
        &p.statuses.instances,
        w.server_time,
        stats.stats.slow_resist,
    );
    (f < 1.).then_some(crate::schedule::ModContribution {
        as_mult: Some(f),
        ..Default::default()
    })
}

/// Recompute the attack mirror through the accepted shared stat-fold kernel codec.
pub(crate) fn refold_attack_with(k: &MatchStatic, w: &mut World, i: usize, stats: Inputs) {
    super::items::refold_modifiers_with(k, w, i, stats);
}

pub(crate) fn clear_all(hx: &mut Hx, teleport: bool) {
    let now = hx.w.server_time;
    if teleport {
        hx.w.abilities
            .get_or_insert_with(|| rt::AbilityRuntime::new(now))
            .teleported_at = Some(now);
    }
    for slot in 0..hx.w.fighter_count() {
        let i = crate::fighter::FighterIx::of_slot(slot);
        let id = hx.w.core(i).id;
        cancel_cast(
            hx.k,
            hx.w,
            hx.ev,
            id,
            rt::CastEndReason::Cancelled,
            teleport,
        );
        if teleport {
            let count = hx.w.core(i).statuses.instances.len();
            for j in 0..count {
                let st = &hx.w.core(i).statuses.instances[j];
                if st.kind == StatusKind::DeathFloor && st.until > now {
                    let st = st.clone();
                    pay_floor(hx.w, hx.ev, id, &st, hx.stats);
                }
            }
        }
        operations::remove_discard_with(hx.k, hx.w, id, Selector::All, hx.stats);
    }
    if let Some(a) = hx.w.abilities.as_mut() {
        a.fields.clear();
    }
}
pub(crate) fn teleported(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::Teleported {
        clear_all(hx, true);
    }
}
pub(crate) fn run_ended(hx: &mut Hx, args: &HookArgs) {
    if *args == HookArgs::RunEnded {
        dot::flush(hx.w, hx.ev, hx.fx.as_deref_mut());
        clear_all(hx, false);
    }
}
pub(crate) fn raid_started(hx: &mut Hx, args: &HookArgs) {
    if *args != HookArgs::RaidStarted {
        return;
    }
    if hx.k.config.abilities == crate::abilities::Mode::Full {
        let ready = if hx.k.config.training {
            0.
        } else {
            hx.w.raid_started_at + hx.k.config.wish_lock_ms.max(0.)
        };
        for p in &mut hx.w.players {
            p.stocks = crate::abilities::Stocks {
                wish_ready_at: ready,
                wish_full_at: Some(ready),
                ..Default::default()
            };
        }
    }
    for slot in 0..hx.w.fighter_count() {
        let i = crate::fighter::FighterIx::of_slot(slot);
        hx.w.core_mut(i).statuses.cast = None;
        let id = hx.w.core(i).id;
        operations::remove_discard_with(hx.k, hx.w, id, Selector::All, hx.stats);
    }
    if let Some(a) = hx.w.abilities.as_mut() {
        a.fields.clear();
        a.dot.clear();
        a.dot_since = hx.w.server_time;
    }
}

#[cfg(test)]
mod tests;
