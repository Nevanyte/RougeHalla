use super::*;
pub const HASTE_BASE_FLOOR: f64 = 0.05;
pub const DEATH_FLOOR_DEFAULT_HP: f64 = 1.;
pub fn value(list: &[StatusInstance], kind: StatusKind, now: f64) -> f64 {
    let rule = kind.rule();
    let mut any = false;
    let mut v = if rule.combine == Combine::Product {
        1.
    } else {
        0.
    };
    for st in list {
        if st.kind != kind || st.until <= now {
            continue;
        }
        any = true;
        match rule.combine {
            Combine::Any => {}
            Combine::Sum => v += st.value,
            Combine::Max => v = v.max(st.value),
            Combine::Product => v *= st.value,
        }
    }
    if rule.combine == Combine::Any {
        return if any { 1. } else { 0. };
    }
    rule.cap.map_or(v, |cap| v.min(cap))
}
pub fn has(list: &[StatusInstance], kind: StatusKind, now: f64) -> bool {
    list.iter().any(|st| st.kind == kind && st.until > now)
}
/// Deliberately includes stale entries, unlike presence/value readers.
pub fn find(
    list: &[StatusInstance],
    kind: StatusKind,
    source: Option<Option<crate::PlayerId>>,
) -> Option<&StatusInstance> {
    list.iter()
        .find(|st| st.kind == kind && source.is_none_or(|id| st.source.id == id))
}
pub fn revealed_at(st: &StatusInstance, now: f64) -> bool {
    now >= st.reveal_from.unwrap_or(0.) && now < st.data.reveal_until.unwrap_or(0.)
}
pub fn hidden(list: &[StatusInstance], now: f64) -> bool {
    list.iter()
        .any(|st| st.kind == StatusKind::Hidden && st.until > now && !revealed_at(st, now))
}
pub fn untargetable(list: &[StatusInstance], now: f64) -> bool {
    has(list, StatusKind::Untargetable, now) || hidden(list, now)
}
pub fn is_casting(cast: Option<CastFact>) -> bool {
    cast.is_some_and(|c| c.lands_at > c.started_at)
}
pub fn cannot_move(rt: &StatusRuntime, now: f64) -> bool {
    has(&rt.instances, StatusKind::Stun, now)
        || has(&rt.instances, StatusKind::Root, now)
        || is_casting(rt.cast)
}
pub fn action_blocked(rt: &StatusRuntime, now: f64) -> bool {
    has(&rt.instances, StatusKind::Stun, now) || is_casting(rt.cast)
}
pub fn cast_blocked(rt: &StatusRuntime, now: f64, causes: CancelCauses) -> bool {
    (causes.stun && has(&rt.instances, StatusKind::Stun, now))
        || (causes.silence && has(&rt.instances, StatusKind::Silence, now))
        || (causes.root && has(&rt.instances, StatusKind::Root, now))
}
pub fn slowed(list: &[StatusInstance], now: f64, frost_chilled: bool) -> bool {
    has(list, StatusKind::SlowMove, now) || frost_chilled
}
pub fn dealt_factor(list: &[StatusInstance], now: f64) -> f64 {
    list.iter()
        .filter(|st| st.kind == StatusKind::Zoned && st.until > now)
        .fold(1., |f, st| f * st.data.dealt_mult.unwrap_or(1.))
}
pub fn damage_factor(
    attacker: &[StatusInstance],
    victim: &[StatusInstance],
    by: Option<crate::PlayerId>,
    now: f64,
) -> f64 {
    victim
        .iter()
        .filter(|st| st.kind == StatusKind::Zoned && st.until > now && st.source.id == by)
        .fold(dealt_factor(attacker, now), |f, st| {
            f * st.data.taken_from_source_mult.unwrap_or(1.)
        })
}
pub fn floor_hp(list: &mut [StatusInstance], now: f64, before: f64, total: f64) -> f64 {
    let after = (before - total).max(0.);
    for st in list {
        if st.kind == StatusKind::DeathFloor && st.until > now {
            st.taken = Some(st.taken.unwrap_or(0.) + total);
            return after.max(
                st.data
                    .floor_hp
                    .unwrap_or(DEATH_FLOOR_DEFAULT_HP)
                    .min(before),
            );
        }
    }
    after
}
pub fn heal_factor(list: &[StatusInstance], now: f64) -> f64 {
    1. - value(list, StatusKind::AntiHeal, now)
}
pub fn resist_slow(mult: f64, resist: f64) -> f64 {
    if resist > 0. && mult < 1. {
        1. - (1. - mult) * (1. - resist.min(1.))
    } else {
        mult
    }
}
pub fn haste_multiplier(base: f64, bonus: f64) -> f64 {
    1. + bonus / base.max(HASTE_BASE_FLOOR)
}
pub fn attack_slow_factor(list: &[StatusInstance], now: f64, resist: f64) -> f64 {
    resist_slow(1. - value(list, StatusKind::SlowAttack, now), resist)
}
pub fn move_multiplier(rt: &StatusRuntime, now: f64, resist: f64, buff_move: f64) -> f64 {
    if rt.instances.is_empty() && rt.cast.is_none() {
        return 1.;
    }
    if cannot_move(rt, now) {
        return 0.;
    }
    let slow = value(&rt.instances, StatusKind::SlowMove, now);
    let haste = value(&rt.instances, StatusKind::Haste, now);
    let zone = rt
        .instances
        .iter()
        .filter(|st| st.kind == StatusKind::Zoned && st.until > now)
        .fold(1., |f, st| f * st.data.move_mult.unwrap_or(1.));
    if slow == 0. && haste == 0. {
        return resist_slow(zone, resist);
    }
    resist_slow((1. - slow) * zone, resist)
        * if haste > 0. {
            haste_multiplier(buff_move, haste)
        } else {
            1.
        }
}
pub fn effects_of(list: &[StatusInstance], cast: Option<CastFact>, now: f64) -> u16 {
    let mut bits = 0;
    for st in list {
        if st.until <= now || (st.kind == StatusKind::Hidden && revealed_at(st, now)) {
            continue;
        }
        bits |= st.kind.rule().bit;
    }
    if is_casting(cast) {
        bits |= EFFECT_CASTING
    }
    bits
}
pub fn reveal(rt: &mut StatusRuntime, now: f64, until: f64) {
    let mut changed = false;
    for st in &mut rt.instances {
        if st.kind != StatusKind::Hidden || until <= st.data.reveal_until.unwrap_or(0.) {
            continue;
        }
        if st.data.reveal_until.unwrap_or(0.) <= now {
            st.reveal_from = Some(now + crate::constants::TICK_MS)
        }
        st.data.reveal_until = Some(until);
        st.data.undefined_fields &= !1;
        changed = true;
    }
    if changed {
        rt.refresh_effects(now)
    }
}
/// Ledger status factor, including the source explicit arena exemption and Mark substitution.
/// Current Sentenced sheet supplies no nonneutral suppression; helper probes exercise the supplied boundary.
pub fn settlement_factor(
    attacker: &[StatusInstance],
    victim: &[StatusInstance],
    by: Option<crate::PlayerId>,
    now: f64,
    arena: bool,
    suppression: Option<f64>,
) -> f64 {
    if arena {
        return 1.;
    }
    let cut = suppression_cut(attacker, now, suppression);
    damage_factor(attacker, victim, by, now) * cut
}

pub fn suppression_cut(attacker: &[StatusInstance], now: f64, suppression: Option<f64>) -> f64 {
    suppression.map_or(1., |mark| (mark / dealt_factor(attacker, now)).min(1.))
}
