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
    let now = cx.w.server_time;
    let ability = l.cast.ability;
    let src = source(cx, l.id);
    match ability {
        AbilityId::Swarm => {
            apply(
                cx,
                l.id,
                src.clone(),
                ability,
                K::Hidden,
                a::SWARM_MS,
                None,
                None,
            );
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
                field(
                    src,
                    ability,
                    FieldKind::Cloud,
                    p,
                    now,
                    a::SWARM_MS,
                    a::SWARM_RADIUS,
                ),
            );
        }
        AbilityId::Blaze => {
            if let Some(to) = l.to {
                super::super::displace::apply(cx.k, cx.w, cx.pf, l.id, to);
                let mut f = field(
                    src,
                    ability,
                    FieldKind::Trail,
                    l.origin,
                    now,
                    a::BLAZE_TRAIL_MS,
                    a::BLAZE_HALF_WIDTH,
                );
                f.x2 = to.x;
                f.y2 = to.y;
                super::super::fields::add(cx.w, f);
            }
        }
        AbilityId::LastStand => {
            let result = apply(
                cx,
                l.id,
                src.clone(),
                ability,
                K::DeathFloor,
                a::LAST_STAND_MS,
                None,
                Some(Payload {
                    floor_hp: Some(a::LAST_STAND_FLOOR),
                    heal_share: Some(a::LAST_STAND_HEAL),
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
            apply(
                cx,
                l.id,
                src,
                ability,
                K::Haste,
                a::LAST_STAND_MS,
                Some(a::LAST_STAND_HASTE),
                None,
            );
        }
        AbilityId::Freeze | AbilityId::Trial => {}
    }
}
pub(super) fn target_effects(cx: &mut Cx, l: Landing) {
    let Some(target) = l.cast.producer.unwrap().target else {
        return;
    };
    let src = source(cx, l.id);
    let ability = l.cast.ability;
    match ability {
        AbilityId::Freeze => {
            apply(
                cx,
                target,
                src,
                ability,
                K::Stun,
                a::FREEZE_STUN_MS,
                None,
                None,
            );
        }
        AbilityId::Trial => {
            let Some(j) = cx.w.fighter_idx(target) else {
                return;
            };
            let p = cx.w.core(j).pos();
            let own_mark =
                cx.w.player(l.id)
                    .filter(|p| p.signature.target == Some(target))
                    .map_or(0, |p| p.signature.mark.tier);
            let radius = if own_mark >= 3 {
                a::TRIAL_CONVICTED_RADIUS
            } else {
                a::TRIAL_RADIUS
            };
            let patient = cx.w.idx(l.id).is_some_and(|i| {
                cx.w.players[i].build.has_flag(
                    cx.w.players[i].vitals.faction,
                    crate::stat_fold::EffectFlag::GallowsPatience,
                )
            });
            let duration = a::TRIAL_MS
                + if patient {
                    crate::constants::GALLOWS_PATIENCE_EXTRA_MS
                } else {
                    0.
                };
            let mut f = field(
                src.clone(),
                ability,
                FieldKind::Zone,
                p,
                cx.w.server_time,
                duration,
                radius,
            );
            f.subject = Some(target);
            f.exit_stun_ms = if patient {
                Some(crate::constants::GALLOWS_PATIENCE_STUN_MS)
            } else {
                rt::TRIAL_FIELD_POLICY.exit_stun_ms
            };
            let field_id = super::super::fields::add(cx.w, f);
            if apply(
                cx,
                target,
                src,
                ability,
                K::Zoned,
                duration,
                Some(a::TRIAL_DEALT_MULT),
                Some(Payload {
                    field_id: Some(field_id),
                    dealt_mult: Some(a::TRIAL_DEALT_MULT),
                    taken_from_source_mult: Some(a::TRIAL_TAKEN_MULT),
                    move_mult: Some(a::TRIAL_MOVE_MULT),
                    ..Default::default()
                }),
            )
            .is_none()
            {
                super::super::fields::remove(cx.w, field_id);
            }
        }
        _ => {}
    }
}
