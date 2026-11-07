//! Closed five-Wish effects. All status mutation and damage use the shared fighter paths.
use super::*;
use rt::{Field, FieldKind, Payload, StatusApply, StatusKind as K, StatusSource};
fn source(cx: &Cx, id: PlayerId) -> StatusSource {
    StatusSource {
        id: Some(id),
        owner_id: None,
        name: cx
            .w
            .roster
            .label(id)
            .expect("player cast source in roster")
            .clone(),
    }
}
// Closed status payload adapter keeps its fields explicit at the five producer sites.
#[allow(clippy::too_many_arguments)]
fn apply(
    cx: &mut Cx,
    id: PlayerId,
    source: StatusSource,
    ability: AbilityId,
    kind: K,
    ms: f64,
    value: Option<f64>,
    data: Option<Payload>,
) -> Option<rt::Applied> {
    super::super::status::operations::apply_with(
        cx.k,
        cx.w,
        cx.ev,
        id,
        StatusApply {
            kind,
            source,
            ability: Some(ability),
            ms,
            value,
            data,
            tag: None,
            add: None,
        },
        false,
        cx.stats,
    )
}
fn field(
    source: StatusSource,
    ability: AbilityId,
    kind: FieldKind,
    p: Vec2,
    now: f64,
    ms: f64,
    r: f64,
) -> Field {
    Field {
        id: 0,
        kind,
        ability,
        owner: source,
        subject: None,
        x: p.x,
        y: p.y,
        x2: 0.,
        y2: 0.,
        r,
        vx: 0.,
        vy: 0.,
        started_at: now,
        ends_at: now + ms,
        exit_stun_ms: None,
    }
}
pub(super) fn self_effects(cx: &mut Cx, l: Landing) {
    let effects = a::definition(l.cast.ability).effects;
    for e in effects.iter().copied() {
        if a::effect_side(e) == a::Side::Self_ {
            run(cx, l, None, e);
        }
    }
}

pub(super) fn target_effects(cx: &mut Cx, l: Landing) {
    let Some(target) = l.cast.producer.unwrap().target else {
        return;
    };
    let effects = a::definition(l.cast.ability).effects;
    for e in effects.iter().copied() {
        if a::effect_side(e) == a::Side::Target {
            run(cx, l, Some(target), e);
        }
    }
}

/// The one interpreter: an exhaustive match over the closed verb set. A new verb is a compile error until it is handled.
fn run(cx: &mut Cx, l: Landing, target: Option<PlayerId>, e: a::Effect) {
    let now = cx.w.server_time;
    let ability = l.cast.ability;
    let src = source(cx, l.id);
    match e {
        a::Effect::Status {
            to,
            kind,
            ms,
            value,
        } => {
            let id = match to {
                a::Side::Self_ => l.id,
                a::Side::Target => match target {
                    Some(t) => t,
                    None => return,
                },
            };
            apply(cx, id, src, ability, kind, ms, value, None);
        }
        a::Effect::DeathFloor {
            ms,
            floor_hp,
            heal_back,
        } => {
            let result = apply(
                cx,
                l.id,
                src.clone(),
                ability,
                K::DeathFloor,
                ms,
                None,
                Some(Payload {
                    floor_hp: Some(floor_hp),
                    heal_share: Some(heal_back),
                    ..Default::default()
                }),
            );
            if let Some(r) = result {
                let p = cx.w.player(l.id).unwrap();
                let reset = p.statuses.instances[r.index].started_at == now
                    || p.statuses.instances[r.index].taken.is_none();
                if reset {
                    let i = cx.w.idx(l.id).unwrap();
                    cx.w.players[i].statuses.instances[r.index].taken = Some(0.);
                }
            }
        }
        a::Effect::Zone {
            ms,
            radius,
            convicted_radius,
            dealt_mult,
            taken_from_source_mult,
            move_mult,
            exit_stun_ms,
        } => {
            let Some(target) = target else {
                return;
            };
            let Some(j) = cx.w.fighter_idx(target) else {
                return;
            };
            let p = cx.w.core(j).pos();
            let own_mark =
                cx.w.player(l.id)
                    .filter(|p| p.signature.target == Some(target))
                    .map_or(0, |p| p.signature.mark.tier);
            let radius = if own_mark >= 3 {
                convicted_radius.unwrap_or(radius)
            } else {
                radius
            };
            let mut f = field(src.clone(), ability, FieldKind::Zone, p, now, ms, radius);
            f.subject = Some(target);
            f.exit_stun_ms = exit_stun_ms;
            let field_id = super::super::fields::add(cx.w, f);
            if apply(
                cx,
                target,
                src,
                ability,
                K::Zoned,
                ms,
                Some(dealt_mult),
                Some(Payload {
                    field_id: Some(field_id),
                    dealt_mult: Some(dealt_mult),
                    taken_from_source_mult: Some(taken_from_source_mult),
                    move_mult: Some(move_mult),
                    ..Default::default()
                }),
            )
            .is_none()
            {
                super::super::fields::remove(cx.w, field_id);
            }
        }
        a::Effect::Cloud { ms, radius } => {
            if let Some(rt) = &mut cx.w.abilities {
                rt.fields.retain(|f| {
                    !(f.kind == FieldKind::Cloud
                        && f.owner.id == Some(l.id)
                        && f.ability == ability)
                });
            }
            let p = cx.w.player(l.id).unwrap().pos();
            super::super::fields::add(
                cx.w,
                field(src, ability, FieldKind::Cloud, p, now, ms, radius),
            );
        }
        a::Effect::Blink => {
            if let Some(to) = l.to {
                super::super::displace::apply(cx.k, cx.w, cx.pf, l.id, to);
            }
        }
        a::Effect::Trail { ms, half_width } => {
            if let Some(to) = l.to {
                let mut f = field(
                    src,
                    ability,
                    FieldKind::Trail,
                    l.origin,
                    now,
                    ms,
                    half_width,
                );
                f.x2 = to.x;
                f.y2 = to.y;
                super::super::fields::add(cx.w, f);
            }
        }
    }
}
