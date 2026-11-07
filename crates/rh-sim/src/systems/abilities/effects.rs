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
    self_pass(cx, l, a::definition(l.cast.ability));
}

pub(super) fn target_effects(cx: &mut Cx, l: Landing) {
    let Some(target) = l.cast.producer.unwrap().target else {
        return;
    };
    target_pass(cx, l, a::definition(l.cast.ability), target);
}

fn self_pass(cx: &mut Cx, l: Landing, def: a::Definition) {
    for e in def.effects.iter().copied() {
        if a::effect_side(e) == a::Side::Self_ {
            run(cx, l, None, e);
        }
    }
}

fn target_pass(cx: &mut Cx, l: Landing, def: a::Definition, target: PlayerId) {
    for e in def.effects.iter().copied() {
        if a::effect_side(e) == a::Side::Target {
            run(cx, l, Some(target), e);
        }
    }
}

/// The generic harness's entry: run ANY row (the production table or a test-only sample) through the one interpreter.
#[cfg(test)]
pub(crate) fn run_row(cx: &mut Cx, l: Landing, def: a::Definition) {
    self_pass(cx, l, def);
    if let Some(target) = l.cast.producer.and_then(|p| p.target) {
        target_pass(cx, l, def, target);
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

#[cfg(test)]
mod row_harness {
    use super::*;
    use crate::abilities::{sample, validate_row, CastDetail};
    use crate::{arenas::practice_arena, Placement, Secrets, Sim, SimConfig, Vec2};

    fn sim() -> Sim {
        let p = |i: usize, at: Vec2| Placement {
            profile: format!("row{i}"),
            faction: crate::FactionId::Fire,
            bot: false,
            at,
            hp: None,
            weapon0: None,
            weapon1: None,
        };
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &[p(0, Vec2::new(320., 320.)), p(1, Vec2::new(380., 320.))],
        )
    }

    fn landing_for(s: &Sim, ability: rt::AbilityId, to: Option<Vec2>) -> Landing {
        let id = s.players()[0].id;
        let target = s.players()[1].id;
        let now = s.server_time();
        Landing {
            id,
            cast: rt::CastFact {
                ability,
                started_at: now,
                lands_at: now,
                cancelled_by: a::CANCELLED_BY,
                producer: Some(CastDetail {
                    rank: 1,
                    slot: a::Slot::Q,
                    target: Some(target),
                    point: Vec2::new(0., 0.),
                    previous_ready_at: 0.,
                    previous_full_at: None,
                    lag_ms: 0.,
                }),
            },
            origin: s.players()[0].pos(),
            to,
        }
    }

    #[test]
    fn every_row_validates_and_the_test_only_sixth_row_runs_with_no_system_code() {
        for id in rt::AbilityId::ALL {
            validate_row(a::definition(id)).expect("production row valid");
        }
        validate_row(sample::row()).expect("sample row valid");
        let mut first = sim();
        let l = landing_for(&first, sample::row().id, None);
        let before = first.state_hash();
        first.with_cx(|cx| run_row(cx, l, sample::row()));
        assert!(first.players()[0]
            .statuses
            .instances
            .iter()
            .any(|st| st.kind == rt::StatusKind::Haste));
        assert!(first
            .w
            .abilities
            .as_ref()
            .is_some_and(|rt| rt.fields.iter().any(|f| f.kind == FieldKind::Cloud)));
        assert_ne!(first.state_hash(), before);
        // Determinism on an identical world, and a checkpoint round-trip keeps the same hash.
        let mut second = sim();
        second.with_cx(|cx| run_row(cx, l, sample::row()));
        assert_eq!(first.state_hash(), second.state_hash());
        let restored = Sim::restore(serde_json::to_value(&first).unwrap()).unwrap();
        assert_eq!(restored.state_hash(), first.state_hash());
    }

    #[test]
    fn trial_convicted_radius_is_a_row_number_and_uses_the_casters_mark() {
        let def = a::definition(rt::AbilityId::Trial);
        let mut s = sim();
        let target = s.players()[1].id;
        s.w.players[0].signature.target = Some(target);
        s.w.players[0].signature.mark.tier = 3;
        let l = landing_for(&s, rt::AbilityId::Trial, None);
        s.with_cx(|cx| run_row(cx, l, def));
        let radius =
            s.w.abilities
                .as_ref()
                .unwrap()
                .fields
                .iter()
                .find(|f| f.kind == FieldKind::Zone)
                .unwrap()
                .r;
        assert_eq!(radius, a::TRIAL_CONVICTED_RADIUS);
        let mut s = sim();
        let target = s.players()[1].id;
        s.w.players[0].signature.target = Some(target);
        s.w.players[0].signature.mark.tier = 2;
        let l = landing_for(&s, rt::AbilityId::Trial, None);
        s.with_cx(|cx| run_row(cx, l, def));
        let radius =
            s.w.abilities
                .as_ref()
                .unwrap()
                .fields
                .iter()
                .find(|f| f.kind == FieldKind::Zone)
                .unwrap()
                .r;
        assert_eq!(radius, a::TRIAL_RADIUS);
    }

    #[test]
    fn last_stand_verbs_carry_the_row_numbers() {
        let def = a::definition(rt::AbilityId::LastStand);
        let mut s = sim();
        s.w.players[0].vitals.hp = 100.;
        let l = landing_for(&s, rt::AbilityId::LastStand, None);
        s.with_cx(|cx| run_row(cx, l, def));
        let p = &s.players()[0];
        let haste = p
            .statuses
            .instances
            .iter()
            .find(|st| st.kind == rt::StatusKind::Haste)
            .expect("haste");
        assert_eq!(haste.value, a::LAST_STAND_HASTE);
        let floor = p
            .statuses
            .instances
            .iter()
            .find(|st| st.kind == rt::StatusKind::DeathFloor)
            .expect("floor");
        assert_eq!(floor.data.heal_share, Some(a::LAST_STAND_HEAL));
    }

    #[test]
    fn trial_zone_is_removed_when_the_zoned_status_is_refused() {
        let def = a::definition(rt::AbilityId::Trial);
        let mut s = sim();
        s.w.players[1].status = crate::Status::Dead;
        let l = landing_for(&s, rt::AbilityId::Trial, None);
        s.with_cx(|cx| run_row(cx, l, def));
        assert!(
            s.w.abilities
                .as_ref()
                .is_none_or(|rt| rt.fields.iter().all(|f| f.kind != FieldKind::Zone)),
            "a refused zoned status leaves no zone"
        );
    }
}
