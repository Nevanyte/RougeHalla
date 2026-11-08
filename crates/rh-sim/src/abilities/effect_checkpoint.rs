//! Producer-specific field and status tuples. The isolated status harness keeps its own Off domain.
use super::*;
use crate::state::World;
use crate::status_runtime as rt;
fn source(w: &World, s: &rt::StatusSource) -> bool {
    s.owner_id.is_none()
        && s.id
            .is_some_and(|id| w.roster.label(id).is_some_and(|name| name == &s.name))
}
/// Gallows' Patience is the only card producer of the longer Trial tuple, so the owner must really hold it.
fn owns_gallows(w: &World, s: &rt::StatusSource) -> bool {
    s.id.and_then(|id| w.player(id)).is_some_and(|p| {
        p.build
            .has_flag(crate::stat_fold::EffectFlag::GallowsPatience)
    })
}
pub(super) fn validate(w: &World) -> Result<(), String> {
    if let Some(a) = &w.abilities {
        for f in &a.fields {
            let shape = match (f.kind, f.ability) {
                (rt::FieldKind::Cloud, AbilityId::Swarm) => {
                    f.subject.is_none()
                        && f.r == SWARM_RADIUS
                        && f.ends_at == f.started_at + SWARM_MS
                        && f.x2 == 0.
                        && f.y2 == 0.
                        && f.exit_stun_ms.is_none()
                }
                (rt::FieldKind::Trail, AbilityId::Blaze) => {
                    f.subject.is_none()
                        && f.r == BLAZE_HALF_WIDTH
                        && f.ends_at == f.started_at + BLAZE_TRAIL_MS
                        && f.exit_stun_ms.is_none()
                }
                (rt::FieldKind::Zone, AbilityId::Trial) => {
                    let plain = f.ends_at == f.started_at + TRIAL_MS
                        && f.exit_stun_ms == rt::TRIAL_FIELD_POLICY.exit_stun_ms;
                    let patient = f.ends_at
                        == f.started_at + TRIAL_MS + crate::constants::GALLOWS_PATIENCE_EXTRA_MS
                        && f.exit_stun_ms == Some(crate::constants::GALLOWS_PATIENCE_STUN_MS)
                        && owns_gallows(w, &f.owner);
                    f.subject.is_some()
                        && (f.r == TRIAL_RADIUS || f.r == TRIAL_CONVICTED_RADIUS)
                        && (plain || patient)
                        && f.x2 == 0.
                        && f.y2 == 0.
                }
                _ => false,
            };
            if !shape || !source(w, &f.owner) || f.vx != 0. || f.vy != 0. {
                return Err("incoherent Wish field producer".into());
            }
        }
    }
    for i in 0..w.fighter_count() {
        for st in &w
            .core(crate::fighter::FighterIx::of_slot(i))
            .statuses
            .instances
        {
            let Some(ability) = st.ability else {
                continue;
            };
            let exact_duration = |ms| st.until == st.started_at + ms;
            let default = rt::Payload::default();
            let shape = match (ability, st.kind) {
                (AbilityId::Freeze, rt::StatusKind::Stun) => {
                    exact_duration(FREEZE_STUN_MS)
                        && st.value == 0.
                        && st.data == default
                        && st.taken.is_none()
                }
                (AbilityId::Swarm, rt::StatusKind::Hidden) => {
                    // Recasting refreshes until while retaining the original Hidden start. The one live cloud
                    // proves the latest landing; repeated five-second training recasts can extend this indefinitely.
                    st.until >= st.started_at + SWARM_MS
                        && st.until <= w.server_time + SWARM_MS
                        && w.abilities.as_ref().is_some_and(|a| {
                            a.fields.iter().any(|f| {
                                f.kind == rt::FieldKind::Cloud
                                    && f.ability == AbilityId::Swarm
                                    && f.owner == st.source
                                    && f.started_at >= st.started_at
                                    && f.ends_at == st.until
                            })
                        })
                        && st.value == 0.
                        && st.data
                            == rt::Payload {
                                reveal_until: st.data.reveal_until,
                                ..default
                            }
                        && st.taken.is_none()
                        && st.reveal_from.is_some() == st.data.reveal_until.is_some()
                        && st.reveal_from.is_none_or(|from| {
                            from >= st.started_at
                                && st.data.reveal_until.is_some_and(|until| until > from)
                        })
                }
                (AbilityId::Trial, rt::StatusKind::Stun) => {
                    (rt::TRIAL_FIELD_POLICY
                        .exit_stun_ms
                        .is_some_and(exact_duration)
                        || (exact_duration(crate::constants::GALLOWS_PATIENCE_STUN_MS)
                            && owns_gallows(w, &st.source)))
                        && st.value == 0.
                        && st.data == default
                        && st.taken.is_none()
                }
                (AbilityId::Trial, rt::StatusKind::Zoned) => {
                    (exact_duration(TRIAL_MS)
                        || (exact_duration(TRIAL_MS + crate::constants::GALLOWS_PATIENCE_EXTRA_MS)
                            && owns_gallows(w, &st.source)))
                        && st.value == TRIAL_DEALT_MULT
                        && st.taken.is_none()
                        && st.data.field_id.is_some()
                        && st.data
                            == rt::Payload {
                                field_id: st.data.field_id,
                                dealt_mult: Some(TRIAL_DEALT_MULT),
                                taken_from_source_mult: Some(TRIAL_TAKEN_MULT),
                                move_mult: Some(TRIAL_MOVE_MULT),
                                ..default
                            }
                }
                (AbilityId::Blaze, rt::StatusKind::Dot) => super::checkpoint::blaze_dot(w, st),
                (AbilityId::LastStand, rt::StatusKind::Haste) => {
                    exact_duration(LAST_STAND_MS)
                        && st.value == LAST_STAND_HASTE
                        && st.data == default
                        && st.taken.is_none()
                }
                (AbilityId::LastStand, rt::StatusKind::DeathFloor) => {
                    exact_duration(LAST_STAND_MS)
                        && st.value == 0.
                        && st.taken.is_some_and(|n| n >= 0.)
                        && st.data
                            == rt::Payload {
                                floor_hp: Some(LAST_STAND_FLOOR),
                                heal_share: Some(LAST_STAND_HEAL),
                                ..default
                            }
                }
                _ => false,
            };
            if !shape
                || !source(w, &st.source)
                || st.tag.is_some()
                || (st.kind != rt::StatusKind::Hidden && st.reveal_from.is_some())
            {
                return Err("incoherent Wish status producer".into());
            }
        }
    }
    Ok(())
}
