//! Admission for source-timed state added by the status packet. Synthetic helper identities
//! never widen the ordinary checkpoint domain: source IDs must belong to retained typed actor provenance (never an allocation-counter range).
use super::*;
use crate::state::World;
pub(crate) fn validate_world(w: &World, _near: impl Fn(f64, f64) -> bool) -> Result<(), String> {
    let provenance = |source: &StatusSource| {
        [source.id, source.owner_id]
            .into_iter()
            .flatten()
            .all(|id| w.known_actor(id))
    };
    for i in 0..w.fighter_count() {
        let p = w.core(crate::fighter::FighterIx::of_slot(i));
        if p.statuses.instances.iter().any(|st| {
            st.data
                .field_id
                .is_some_and(|id| id == 0 || id > w.entity_counter)
        }) {
            return Err("status field reference was never allocated".into());
        }
        if !p.modifiers.attack_rate_wire().is_finite()
            || p.modifiers.attack_rate_wire() < crate::stat_fold::encode_mult(0.)
            || p.modifiers.attack_rate_wire().fract() != 0.
        {
            return Err("invalid attack mirror".into());
        }
        if let Some(c) = p.card_dot_crit {
            if !c.accumulator.is_finite()
                || !(-stats::CRIT_EPSILON..1.).contains(&c.accumulator)
                || c.roll_tick.is_some_and(|tick| tick > w.tick)
            {
                return Err("invalid card DoT critical runtime".into());
            }
        }
        if let Some(s) = &p.motion.slip {
            if ![s.vx, s.vy, s.ax, s.ay]
                .iter()
                .all(|v| geometry_scalar_is_safe(*v))
                || [s.stuck_x, s.stuck_y]
                    .into_iter()
                    .flatten()
                    .any(|v| !geometry_scalar_is_safe(v))
                || ![
                    s.stuck_x,
                    s.stuck_y,
                    s.stuck_n,
                    s.stuck_best,
                    s.stuck_at,
                    s.grip_until,
                ]
                .into_iter()
                .flatten()
                .all(|v| v.is_finite())
                || s.replan_at.is_some_and(|v| !v.is_finite())
                || s.path
                    .is_some_and(|generation| generation > p.motion.path.generation)
            {
                return Err("invalid slip memory".into());
            }
        }
    }
    if let Some(a) = &w.abilities {
        if !(0. ..=w.server_time).contains(&a.dot_since)
            || a.teleported_at
                .is_some_and(|at| !(0. ..=w.server_time).contains(&at))
        {
            return Err("invalid ability runtime clock".into());
        }
        for (i, f) in a.fields.iter().enumerate() {
            if f.id == 0
                || f.id > w.entity_counter
                || a.fields[..i].iter().any(|p| p.id >= f.id)
                || w.containers.iter().any(|p| p.id == f.id)
                || w.projectiles.iter().any(|p| p.launch.id == f.id)
                || !provenance(&f.owner)
                || f.subject.is_some_and(|id| !w.known_actor(id))
                || ![f.x, f.y, f.x2, f.y2, f.r, f.vx, f.vy]
                    .into_iter()
                    .all(geometry_scalar_is_safe)
                || ![
                    f.x,
                    f.y,
                    f.x2,
                    f.y2,
                    f.r,
                    f.vx,
                    f.vy,
                    f.started_at,
                    f.ends_at,
                ]
                .iter()
                .all(|v| v.is_finite())
                || !(0. ..=w.server_time).contains(&f.started_at)
                || f.exit_stun_ms.is_some_and(|v| !v.is_finite())
            {
                return Err("invalid ability field".into());
            }
        }
        for (i, b) in a.dot.iter().enumerate() {
            if !(b.amount > 0.)
                || !b.amount.is_finite()
                || !w.known_actor(b.victim)
                || b.by.is_some_and(|id| !w.known_actor(id))
                || a.dot[..i]
                    .iter()
                    .any(|p| (p.victim, p.by, p.ability) == (b.victim, b.by, b.ability))
            {
                return Err("invalid private ability DoT bucket".into());
            }
        }
    }
    for e in &w.deferred.hits {
        if e.terrain
            || !w.known_actor(e.victim)
            || e.by.is_some_and(|id| !w.known_actor(id))
            || e.source
                .as_ref()
                .is_some_and(|s| s.id != e.by || !provenance(s))
            || ![
                e.packet.raw,
                e.packet.phys,
                e.packet.magic,
                e.packet.true_,
                e.scale,
            ]
            .iter()
            .all(|v| v.is_finite())
            || e.critical_mult.is_some_and(|v| !v.is_finite())
        {
            return Err("invalid deferred hit source or packet".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
    use serde_json::{json, Value};
    fn world() -> Sim {
        let ps = (0..3)
            .map(|i| Placement {
                profile: format!("p{i}"),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(400. + i as f64 * 60., 400.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>();
        let mut s = Sim::reset_active(
            SimConfig::default(),
            crate::arenas::practice_arena(),
            Secrets::from_seed(4),
            &ps,
        );
        let source = StatusSource {
            id: Some(PlayerId(1)),
            name: "snapshot label".into(),
            owner_id: Some(PlayerId(3)),
        };
        for kind in [StatusKind::Hidden, StatusKind::Shred] {
            apply(
                &mut s.w.players[1].statuses,
                0.,
                StatusApply {
                    kind,
                    source: source.clone(),
                    ms: 500.,
                    ability: None,
                    tag: Some(StatusTag::from("fixture")),
                    value: Some(-0.25),
                    add: None,
                    data: Some(Payload {
                        reveal_until: Some(200.),
                        floor_hp: Some(1.),
                        ..Default::default()
                    }),
                },
            );
        }
        s.w.players[1].statuses.cast = Some(CastFact {
            producer: None,
            ability: AbilityId::Freeze,
            started_at: 0.,
            lands_at: 1000.,
            cancelled_by: CancelCauses {
                stun: true,
                silence: true,
                root: false,
                stagger: false,
            },
        });
        s.w.players[1].statuses.refresh_effects(0.);
        s.w.players[1].modifiers.test_set_attack_wire(800.);
        s.w.players[1].card_dot_crit = Some(DotCritState {
            accumulator: 0.5,
            roll_tick: Some(0),
            critical: false,
        });

        let mut a = AbilityRuntime::new(0.);
        a.teleported_at = Some(0.);
        a.fields.push(Field {
            id: 1,
            kind: FieldKind::Trail,
            ability: AbilityId::Blaze,
            owner: source.clone(),
            subject: None,
            x: 100.,
            y: 100.,
            x2: 150.,
            y2: 100.,
            r: 10.,
            vx: 0.,
            vy: 0.,
            started_at: 0.,
            ends_at: 5000.,
            exit_stun_ms: None,
        });
        a.dot.push(AbilityDotBucket {
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            ability: AbilityId::Blaze,
            amount: 1.,
        });
        s.w.abilities = Some(a);
        s.w.entity_counter = 1;
        s.w.deferred.defer_hit(crate::systems::ledger::Entry {
            terrain: false,
            dot: true,
            ability: Some(AbilityId::Blaze),
            arena: false,
            source: Some(source),
            critical: true,
            critical_mult: Some(1.5),
            sig: None,
            execute: false,
            victim: PlayerId(2),
            by: Some(PlayerId(1)),
            packet: crate::state::Packet {
                raw: 1.,
                phys: 0.,
                magic: 0.,
                true_: 1.,
            },
            weapon: None,
            stagger: false,
            projectile: None,
            scale: 1.,
            derived: false,
            passive: false,
        });
        s
    }
    fn changed(base: &Value, path: &str, value: Value) -> Value {
        let mut v = base.clone();
        *v.pointer_mut(path)
            .unwrap_or_else(|| panic!("missing {path}")) = value;
        v
    }
    #[test]
    fn removed_field_references_restore_but_future_field_references_do_not() {
        let mut s = world();
        let field = s.w.abilities.as_ref().unwrap().fields[0].clone();
        let owner = field.owner.clone();
        let id = crate::systems::fields::add(&mut s.w, field);
        apply(
            &mut s.w.players[1].statuses,
            0.,
            StatusApply {
                kind: StatusKind::Zoned,
                source: owner,
                ms: 500.,
                ability: Some(AbilityId::Trial),
                tag: None,
                value: None,
                add: None,
                data: Some(Payload {
                    field_id: Some(id),
                    ..Default::default()
                }),
            },
        );
        assert!(crate::systems::fields::remove(&mut s.w, id).is_some());
        let valid = serde_json::to_value(&s).unwrap();
        let restored = Sim::restore(&valid).unwrap();
        assert_eq!(s.state_hash(), restored.state_hash());
        let index = s.w.players[1].statuses.instances.len() - 1;
        let path = format!("/world/players/1/core/statuses/instances/{index}/data/field_id");
        for bad in [0, s.w.entity_counter + 1, 999] {
            assert!(Sim::restore(changed(&valid, &path, json!(bad))).is_err());
        }
    }
    #[test]
    fn status_fields_slip_card_mirror_and_deferred_sources_restore_and_continue() {
        let mut a = world();
        let mut b = Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
        assert_eq!(a.state_hash(), b.state_hash());
        for _ in 0..24 {
            assert_eq!(a.step(), b.step());
            assert_eq!(a.state_hash(), b.state_hash());
        }
    }
    #[test]
    fn every_new_state_owner_changes_the_hash_without_using_fixture_outputs() {
        let s = world();
        let hash = s.state_hash();
        let base = serde_json::to_value(&s).unwrap();
        let changes = [
            (
                "/world/players/1/core/statuses/instances/0/source/name",
                json!("changed snapshot"),
            ),
            (
                "/world/players/1/core/statuses/instances/0/source/owner_id",
                json!(2),
            ),
            (
                "/world/players/1/core/statuses/instances/0/tag",
                json!("other"),
            ),
            (
                "/world/players/1/core/statuses/instances/0/value",
                json!(-0.5),
            ),
            (
                "/world/players/1/core/statuses/instances/0/until",
                json!(550.),
            ),
            (
                "/world/players/1/core/statuses/instances/0/data/reveal_until",
                json!(250.),
            ),
            ("/world/players/1/core/statuses/cast/lands_at", json!(1100.)),
            ("/world/players/1/core/statuses/effects", json!(1)),
            ("/world/players/1/core/modifiers/wire/0", json!(850.)),
            (
                "/world/players/1/core/card_dot_crit/accumulator",
                json!(0.25),
            ),
            ("/world/players/1/core/card_dot_crit/critical", json!(true)),
            ("/world/players/1/core/motion/displace_seq", json!(1)),
            (
                "/world/abilities/fields/0/owner/name",
                json!("field source snapshot"),
            ),
            ("/world/abilities/fields/0/x", json!(101.)),
            ("/world/abilities/fields/0/ends_at", json!(5500.)),
            ("/world/abilities/dot/0/amount", json!(2.)),
            (
                "/world/deferred/hits/0/source/name",
                json!("deferred source snapshot"),
            ),
            ("/world/deferred/hits/0/critical", json!(false)),
        ];
        for (path, value) in changes {
            let other =
                Sim::restore(changed(&base, path, value)).unwrap_or_else(|e| panic!("{path}: {e}"));
            assert_ne!(other.state_hash(), hash, "{path}");
        }
    }
    #[test]
    fn every_serialized_status_leaf_participates_in_the_hash() {
        let mut s = world();
        let st = &mut s.w.players[1].statuses.instances[0];
        st.ability = Some(AbilityId::Freeze);
        st.reveal_from = Some(50.);
        st.taken = Some(2.);
        st.data = Payload {
            undefined_fields: 0,
            reveal_until: Some(200.),
            field_id: Some(1),
            dealt_mult: Some(0.8),
            taken_from_source_mult: Some(0.7),
            move_mult: Some(0.6),
            floor_hp: Some(1.),
            heal_share: Some(0.5),
            shares: Some(crate::content::DamageShares {
                phys: 0.2,
                magic: 0.3,
                true_: 0.5,
            }),
        };
        // Raw serialized-leaf hashing only. Ordinary slip admission/continuation now belongs
        // to terrain::native_tests with real map hazards enabled.
        s.w.players[1].motion.slip = Some(crate::fighter::SlipState {
            vx: 1.,
            vy: 2.,
            ax: 3.,
            ay: 4.,
            path: Some(0),
            replan_at: Some(0.),
            stuck_x: Some(460.),
            stuck_y: Some(400.),
            stuck_n: Some(1.),
            stuck_best: Some(0.),
            stuck_at: Some(0.),
            grip_until: Some(10.),
        });
        s.w.players[1].fate.killed_by_name = Some("source label".into());
        let field = &mut s.w.abilities.as_mut().unwrap().fields[0];
        field.subject = Some(PlayerId(2));
        field.exit_stun_ms = Some(500.);
        let base = serde_json::to_value(&s.w).unwrap();
        let hash = s.state_hash();
        fn leaves(v: &Value, path: String, out: &mut Vec<(String, Value)>) {
            match v {
                Value::Object(o) => {
                    for (k, v) in o {
                        leaves(v, format!("{path}/{k}"), out)
                    }
                }
                Value::Array(a) => {
                    for (i, v) in a.iter().enumerate() {
                        leaves(v, format!("{path}/{i}"), out)
                    }
                }
                Value::Null => {} // Option discriminants are exercised separately below.
                _ => out.push((path, v.clone())),
            }
        }
        let roots = [
            "/players/1/core/statuses",
            "/players/1/core/modifiers/wire/0",
            "/players/1/core/card_dot_crit",
            "/players/1/core/motion/slip",
            "/players/1/core/motion/displace_seq",
            "/players/1/fate/killed_by_name",
            "/abilities",
            "/deferred/hits/0/source",
            "/deferred/hits/0/dot",
            "/deferred/hits/0/ability",
            "/deferred/hits/0/arena",
            "/deferred/hits/0/critical",
            "/deferred/hits/0/critical_mult",
        ];
        let mut all = Vec::new();
        for path in roots {
            leaves(
                base.pointer(path).unwrap_or_else(|| panic!("{path}")),
                path.into(),
                &mut all,
            );
        }
        assert!(
            all.len() > 90,
            "all new serialized owners must be populated"
        );
        for (path, old) in all {
            let new = match old {
                Value::Bool(v) => json!(!v),
                Value::Number(v) if v.is_u64() => json!(v.as_u64().unwrap() + 1),
                Value::Number(v) => json!(v.as_f64().unwrap() + 0.125),
                Value::String(v) => json!(match v.as_str() {
                    "hidden" => "root".to_owned(),
                    "shred" => "haste".to_owned(),
                    "freeze" => "swarm".to_owned(),
                    "blaze" => "trial".to_owned(),
                    "trail" => "cloud".to_owned(),
                    _ => format!("{v} changed"),
                }),
                _ => unreachable!(),
            };
            let mut other = s.clone();
            // Hash coverage is independent of checkpoint validity; malformed-state refusal has its own test.
            other.w = serde_json::from_value(changed(&base, &path, new))
                .unwrap_or_else(|e| panic!("{path}: {e}"));
            assert_ne!(hash, other.state_hash(), "{path}");
        }
        for path in [
            "/players/1/core/statuses/instances/0/ability",
            "/players/1/core/statuses/instances/0/reveal_from",
            "/players/1/core/statuses/instances/0/taken",
            "/players/1/core/statuses/cast",
            "/players/1/core/card_dot_crit",
            "/abilities",
            "/deferred/hits/0/source",
        ] {
            let mut other = s.clone();
            other.w = serde_json::from_value(changed(&base, path, Value::Null)).unwrap();
            assert_ne!(hash, other.state_hash(), "Option presence {path}");
        }
    }
    #[test]
    fn invalid_new_state_is_refused_including_forged_provenance_at_large_next_id() {
        let base = serde_json::to_value(world()).unwrap();
        let invalid = [
            ("/world/abilities/fields/0/x2", json!(1e308)),
            ("/world/abilities/fields/0/r", json!(-1e308)),
            (
                "/world/players/1/core/statuses/instances/0/source/id",
                json!(999),
            ),
            (
                "/world/players/1/core/statuses/instances/0/source/owner_id",
                json!(999),
            ),
            (
                "/world/players/1/core/statuses/instances/0/data/undefined_fields",
                json!(1),
            ),
            (
                "/world/players/1/core/statuses/instances/0/data/undefined_fields",
                json!(256),
            ),
            (
                "/world/players/1/core/statuses/instances/0/data/field_id",
                json!(0),
            ),
            (
                "/world/players/1/core/statuses/instances/0/started_at",
                json!(1000.),
            ),
            ("/world/players/1/core/modifiers/wire/0", json!(49.)),
            ("/world/players/1/core/modifiers/wire/0", json!(800.5)),
            ("/world/players/1/core/card_dot_crit/accumulator", json!(1.)),
            ("/world/players/1/core/card_dot_crit/roll_tick", json!(1000)),
            ("/world/abilities/dot_since", json!(1000.)),
            ("/world/abilities/teleported_at", json!(1000.)),
            ("/world/abilities/fields/0/id", json!(2)),
            ("/world/abilities/fields/0/owner/id", json!(999)),
            ("/world/abilities/fields/0/subject", json!(999)),
            ("/world/abilities/fields/0/started_at", json!(1000.)),
            ("/world/abilities/dot/0/amount", json!(0.)),
            ("/world/deferred/hits/0/source/id", json!(2)),
            ("/world/deferred/hits/0/source/owner_id", json!(999)),
            ("/world/deferred/hits/0/critical_mult", json!("invalid")),
        ];
        for (path, value) in invalid {
            for elevated in [false, true] {
                let mut v = changed(&base, path, value.clone());
                if elevated {
                    v["world"]["next_id"] = json!(u32::MAX - 1)
                }
                assert!(
                    Sim::restore(v).is_err(),
                    "accepted {path} at elevated={elevated}"
                );
            }
        }
    }
    #[test]
    fn same_tick_payouts_cannot_escape_through_checkpoint_serialization() {
        let mut s = world();
        s.w.pay.collecting = true;
        assert!(serde_json::to_value(&s).is_err());
        s.w.pay.collecting = false;
        s.w.pay.items.push(crate::systems::ledger::Payout::Ordinary(
            crate::systems::ledger::PayLater::RemoveStatuses {
                victim: PlayerId(2),
                selector: Selector::All,
            },
        ));
        assert!(serde_json::to_value(&s).is_err());
        s.w.pay.items.clear();
        assert!(Sim::restore(serde_json::to_value(&s).unwrap()).is_ok());
    }
}
