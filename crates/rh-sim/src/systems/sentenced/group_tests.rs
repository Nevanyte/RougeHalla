//! Public training lifecycle tests and explicitly labelled ledger/query diagnostics.
use super::*;
use crate::{
    validate, FactionMode, Placement, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};

fn group_scene() -> Sim {
    group_scene_kind(crate::mob_catalog::MobTypeId::Bailiff, 50)
}
fn group_scene_kind(ty: crate::mob_catalog::MobTypeId, offense: u64) -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            training: true,
            consumables: false,
            regen: false,
            quests: false,
            abilities: crate::abilities::Mode::Full,
            pvp_rules: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[Placement {
            profile: "group-source".into(),
            faction: FactionId::Sentenced,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }],
    );
    for (ty, count) in [
        (crate::mob_catalog::MobTypeId::MagmaBrute, 200),
        (crate::mob_catalog::MobTypeId::Pardoner, offense),
    ] {
        if count == 0 {
            continue;
        }
        let id = crate::mob_catalog::MobTypeId::ALL
            .iter()
            .position(|x| *x == ty)
            .unwrap() as u32;
        submit(
            &mut sim,
            RawCommand::Train(crate::input::TrainRaw {
                command: 2,
                id,
                count,
                options: [0; 3],
                option_count: 0,
            }),
        );
    }
    sim.step();
    let code = crate::mob_catalog::MobTypeId::ALL
        .iter()
        .position(|x| *x == ty)
        .unwrap() as u32;
    submit(
        &mut sim,
        RawCommand::Train(crate::input::TrainRaw {
            command: 3,
            id: code,
            count: 0,
            options: [0; 3],
            option_count: 0,
        }),
    );
    sim.step();
    let mob = sim.mobs().iter().find(|m| m.mob_type == Some(ty)).unwrap();
    let (id, x, y) = (mob.core.id, mob.core.body.x + 20., mob.core.body.y);
    let p = &mut sim.w.players[0];
    // Declared native placement; health/Offense above came from real validated training stat grants.
    p.body.x = x;
    p.body.y = y;
    p.body.history.reset(crate::state::Sample {
        t: sim.w.server_time,
        x,
        y,
    });
    submit(&mut sim, RawCommand::Target { id });
    sim
}
fn submit(s: &mut Sim, raw: RawCommand) {
    s.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
}
fn attack(s: &mut Sim, id: PlayerId) {
    let p = &s.players()[0];
    let m = s.w.actor(id).unwrap();
    let a = crate::math::atan2(m.body.y - p.body.y, m.body.x - p.body.x);
    submit(s, RawCommand::Attack { a, t: None });
}

#[test]
fn real_training_group_retains_original_size_across_death_restore_and_clone() {
    let mut sim = group_scene();
    sim.w.players[0].weapon.weapon0 = Some(WeaponId::Bow);
    let target = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type.is_some())
        .unwrap()
        .core
        .id;
    let camp = group_of(&sim.w, target).unwrap();
    let size = sim
        .mobs()
        .iter()
        .filter(|m| group_of(&sim.w, m.core.id) == Some(camp))
        .count();
    assert_eq!(size, 3);
    let mut marked = false;
    let mut shrank = false;
    for tick in 0..1000 {
        if tick % 10 == 0 {
            let focus = sim.players()[0]
                .signature
                .target
                .filter(|id| sim.w.actor(*id).is_some())
                .or_else(|| {
                    sim.mobs()
                        .iter()
                        .find(|m| {
                            group_of(&sim.w, m.core.id) == Some(camp)
                                && m.status == crate::Status::Alive
                        })
                        .map(|m| m.core.id)
                });
            if let Some(id) = focus {
                attack(&mut sim, id);
            }
        }
        let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
        let mut cloned = sim.clone();
        let events = sim.step();
        assert_eq!(events, restored.step());
        assert_eq!(events, cloned.step());
        assert_eq!(sim.state_hash(), restored.state_hash());
        assert_eq!(sim.state_hash(), cloned.state_hash());
        let f = &sim.players()[0].signature;
        if f.mark.tier > 0 && f.mark.group == Some(camp) {
            marked = true;
            assert_eq!(f.mark.group_size, size);
            let alive = sim
                .mobs()
                .iter()
                .filter(|m| {
                    m.status == crate::Status::Alive && group_of(&sim.w, m.core.id) == Some(camp)
                })
                .count();
            if alive > 0 && alive < size {
                shrank = true;
                assert!(f.target.is_some_and(|id| sim.w.actor(id).is_some()));
                break;
            }
        }
    }
    assert!(marked, "validated weapon commands must create the group");
    assert!(
        shrank,
        "real damage must kill a member while the original group survives; mark={:?} mobs={:?}",
        sim.players()[0].signature.mark,
        sim.mobs()
            .iter()
            .filter(|m| m.mob_type.is_some())
            .map(|m| (m.core.id, m.status, m.core.vitals.hp, m.core.pos()))
            .collect::<Vec<_>>()
    );
}

#[test]
fn diagnostic_group_pulses_once_per_member_but_counts_every_qualifying_hit() {
    let mut sim = group_scene();
    let target = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type.is_some())
        .unwrap()
        .core
        .id;
    sim.w.players[0]
        .signature
        .set_target(target, sim.w.server_time);
    let entry = |victim| Entry {
        victim,
        by: Some(PlayerId(1)),
        packet: Packet {
            raw: 1.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
        weapon: Some(WeaponId::Sword),
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    };
    let other = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type.is_some() && m.core.id != target)
        .unwrap()
        .core
        .id;
    let mut ledger = vec![entry(target), entry(other)];
    before_damage(&sim.k, &mut sim.w, &mut ledger, &mut Vec::new());
    assert_eq!(sim.players()[0].signature.mark.hits, 2);
    assert_eq!(sim.players()[0].signature.mark.group_size, 3);
    let rows: Vec<_> = ledger
        .iter()
        .filter(|e| e.sig == Some(SignatureKind::Mark) && e.by == Some(PlayerId(1)))
        .collect();
    assert_eq!(
        rows.len(),
        3,
        "source Set pays each member only once this pass"
    );
    for row in rows {
        let expected = crate::modifiers::mark_pulse_group(
            &sim.players()[0],
            WeaponId::Sword,
            pool(&sim.w, row.victim),
            near(&sim.w, PlayerId(1), row.victim),
            1. / crate::math::sqrt(3.),
        );
        assert_eq!(row.packet.raw, expected);
    }
}

#[test]
fn diagnostic_group_query_excludes_return_leash_and_hidden_owner_before_tie() {
    let mut sim = group_scene();
    let id = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type.is_some())
        .unwrap()
        .core
        .id;
    let group = group_of(&sim.w, id);
    let f = &mut sim.w.players[0].signature;
    f.set_target(id, sim.w.server_time);
    f.mark = crate::fighter::Mark {
        group,
        group_size: 3,
        tier: 3,
        hits: 6,
        progress: 6.,
        ..Default::default()
    };
    assert_eq!(mark_tier_on(&sim.w, PlayerId(1), id), 3);
    assert_eq!(
        crate::observe::public_snapshot(&sim)
            .mobs
            .iter()
            .find(|v| v.id == id)
            .unwrap()
            .mark_tier,
        3
    );
    sim.w.mobs.get_mut(id).unwrap().regional_brain_mut().mode =
        crate::mob_runtime::BrainMode::Return;
    assert_eq!(mark_tier_on(&sim.w, PlayerId(1), id), 0);
    sim.w.mobs.get_mut(id).unwrap().regional_brain_mut().mode = crate::mob_runtime::BrainMode::Idle;
    sim.w.players[0].body.x += TARGET_RANGE + 1.;
    assert_eq!(mark_tier_on(&sim.w, PlayerId(1), id), 0);
    assert_eq!(public_mark_by(&sim.w, id, 3, |_| false), None);
}

#[test]
fn source_lexical_birth_order_is_not_numeric_serial_order() {
    let mut a = [0; 7];
    let mut b = [0; 7];
    assert!(serial_bytes(35, &mut a) > serial_bytes(36, &mut b));
    assert_eq!(serial_bytes(36, &mut a), b"10");
}

#[test]
fn real_typed_fire_source_remains_live_while_dummies_are_not_signature_sources() {
    let mut sim = group_scene_kind(crate::mob_catalog::MobTypeId::EmberImp, 0);
    let id = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type == Some(crate::mob_catalog::MobTypeId::EmberImp))
        .unwrap()
        .core
        .id;
    attack(&mut sim, id);
    let mut real_fire = false;
    for _ in 0..100 {
        sim.step();
        for e in sim.damage_entries() {
            if e.sig.is_some() {
                assert!(!e.by.is_some_and(|by| sim
                    .mobs()
                    .iter()
                    .any(|m| m.core.id == by && m.kind == crate::mob_runtime::MobKind::Dummy)));
                real_fire |= e.by == Some(id)
                    && matches!(e.sig, Some(SignatureKind::Burn | SignatureKind::Backlash));
            }
        }
    }
    assert!(
        real_fire,
        "typed Fire AI/engagement must still emit its genuine signature"
    );
}

#[test]
fn real_group_checkpoint_refuses_wrong_identity_and_size_without_reconstructing_survivors() {
    let mut s = group_scene();
    let id = s
        .mobs()
        .iter()
        .find(|m| m.mob_type.is_some())
        .unwrap()
        .core
        .id;
    attack(&mut s, id);
    for _ in 0..20 {
        s.step();
        if s.players()[0].signature.mark.tier > 0 {
            break;
        }
    }
    assert!(s.players()[0].signature.mark.tier > 0);
    assert_eq!(s.players()[0].signature.mark.group_size, 3);
    let value = serde_json::to_value(&s).unwrap();
    let field = "/world/players/0/core/signature/mark";
    for (key, bad) in [
        ("group", serde_json::Value::Null),
        ("group", serde_json::json!({"Camp":999999})),
        ("group", serde_json::json!({"Fighter":id.0})),
        ("group_size", serde_json::json!(0)),
        ("group_size", serde_json::json!(TRAIN_MAX_MOBS + 1)),
    ] {
        let mut v = value.clone();
        v.pointer_mut(field).unwrap()[key] = bad;
        assert!(Sim::restore(v).is_err(), "invalid {key}");
    }
    // Source records only original size, not a per-member chronology. A returning sibling may have been excluded then.
    let mut history = value.clone();
    history.pointer_mut(field).unwrap()["group_size"] = serde_json::json!(2);
    let restored = Sim::restore(history).unwrap();
    assert_ne!(
        s.state_hash(),
        restored.state_hash(),
        "original size is owned identity, not derived current size"
    );
    assert_eq!(restored.players()[0].signature.mark.group_size, 2);
}

#[test]
fn diagnostic_real_trial_uses_own_group_tier_on_unfocused_member_and_ring_near_exception() {
    for (tier, hits, radius) in [
        (1, 1, crate::abilities::TRIAL_RADIUS),
        (3, 6, crate::abilities::TRIAL_CONVICTED_RADIUS),
    ] {
        let mut s = group_scene();
        let ids: Vec<_> = s
            .mobs()
            .iter()
            .filter(|m| m.mob_type.is_some())
            .map(|m| m.core.id)
            .collect();
        let target = ids[1];
        let group = group_of(&s.w, ids[0]);
        s.w.players[0].signature.set_target(ids[0], s.w.server_time);
        // Declared incoming-tier diagnostic; the real cast/effect below must not require exact focused-target equality.
        s.w.players[0].signature.mark = crate::fighter::Mark {
            group,
            group_size: 3,
            tier,
            hits,
            progress: hits as f64,
            ..Default::default()
        };
        let at = s.w.actor(target).unwrap().pos();
        submit(
            &mut s,
            RawCommand::Cast {
                slot: crate::abilities::Slot::Wish,
                x: at.x,
                y: at.y,
                id: Some(target),
                t: None,
                seq: None,
            },
        );
        let mut landed = false;
        for _ in 0..30 {
            landed|=s.step().iter().any(|e|matches!(e,crate::Event::CastLanded{id:PlayerId(1),target:Some(id),..} if *id==target));
            if landed {
                break;
            }
        }
        assert!(landed, "genuine validated Trial must land");
        let field =
            s.w.abilities
                .as_ref()
                .unwrap()
                .fields
                .iter()
                .find(|f| f.subject == Some(target))
                .unwrap();
        assert_eq!(field.r, radius);
        assert_ne!(s.players()[0].signature.target, Some(target));
        let now_at = s.w.actor(target).unwrap().pos();
        s.w.players[0].body.x = now_at.x + MARK_NEAR_RANGE + 250.;
        s.w.players[0].body.y = now_at.y;
        assert!(
            near(&s.w, PlayerId(1), target),
            "own active Zoned status overrides only the near/far cut"
        );
        assert!(
            !near(&s.w, PlayerId(1), ids[2]),
            "unaffected sibling does not borrow the ring status"
        );
    }
}

#[test]
#[ignore = "allocation profiler runs alone: cargo test -p rh-sim --lib sentenced_group_warm_alloc -- --ignored --test-threads=1"]
fn sentenced_group_warm_alloc_after_real_birth_restore_and_teleport_reset() {
    for phase in ["birth", "restore", "reset"] {
        let mut s = group_scene_kind(crate::mob_catalog::MobTypeId::Executioner, 0);
        s.w.players[0].weapon.weapon0 = Some(WeaponId::Bow); // Declared equipment, before any group outcome.
        let target = s
            .mobs()
            .iter()
            .find(|m| m.mob_type.is_some())
            .unwrap()
            .core
            .id;
        attack(&mut s, target);
        let mut events = Vec::with_capacity(512);
        for _ in 0..20 {
            events.clear();
            s.step_into(&mut events);
        }
        assert!(s.players()[0].signature.mark.tier > 0);
        if phase == "restore" {
            s = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        }
        if phase == "reset" {
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: Default::default(),
                    k: &s.k,
                    w: &mut s.w,
                    ev: &mut events,
                    fx: None,
                },
                HookArgs::Teleported,
            );
            assert_eq!(s.players()[0].signature.mark.group, None);
            submit(&mut s, RawCommand::Target { id: target });
            attack(&mut s, target);
        }
        for _ in 0..20 {
            events.clear();
            s.step_into(&mut events);
        }
        assert!(matches!(
            s.players()[0].signature.mark.group,
            Some(crate::fighter::MarkGroup::Camp(_))
        ));
        let dir = std::env::var_os("RH_SENTENCED_ALLOC_DIRECTORY")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(dir.join(format!("rh-sentenced-group-{phase}.json")))
            .build();
        for _ in 0..20 {
            events.clear();
            #[cfg(feature = "schedule-trace")]
            s.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            s.step_into(&mut events);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}

#[test]
#[ignore = "allocation profiler runs alone: cargo test -p rh-sim --lib sentenced_twelve_sources_warm_alloc -- --ignored --test-threads=1"]
fn sentenced_twelve_sources_warm_alloc_uses_real_training_ai_and_more_than_eight_edges() {
    let mut s = Sim::reset_active(
        SimConfig {
            training: true,
            quests: false,
            consumables: false,
            regen: false,
            pvp_rules: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[Placement {
            profile: "twelve-source-recipient".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }],
    );
    // Actual admitted training grants protect the human for the long real-AI warmup; no Mark/tier/outcome is seeded.
    for (ty, count) in [
        (crate::mob_catalog::MobTypeId::MagmaBrute, 5000),
        (crate::mob_catalog::MobTypeId::Bailiff, 10000),
        (crate::mob_catalog::MobTypeId::ChainWarden, 10000),
    ] {
        submit(
            &mut s,
            RawCommand::Train(crate::input::TrainRaw {
                command: 2,
                id: ty as u32,
                count,
                options: [0; 3],
                option_count: 0,
            }),
        );
    }
    s.step();
    let ty = crate::mob_catalog::MobTypeId::Bailiff;
    for _ in 0..4 {
        let before = s.w.mobs.len();
        submit(
            &mut s,
            RawCommand::Train(crate::input::TrainRaw {
                command: 3,
                id: ty as u32,
                count: 0,
                options: [0; 3],
                option_count: 0,
            }),
        );
        s.step();
        assert_eq!(s.w.mobs.len(), before + 3);
        let id = s
            .mobs()
            .iter()
            .rfind(|m| m.mob_type == Some(ty))
            .unwrap()
            .core
            .id;
        let at = s.w.actor(id).unwrap().pos();
        submit(
            &mut s,
            RawCommand::Move {
                x: at.x,
                y: at.y,
                seq: None,
            },
        );
        for _ in 0..200 {
            s.step();
            let p = s.players()[0].core.pos();
            let m = s.w.actor(id).unwrap().pos();
            if crate::math::hypot(p.x - m.x, p.y - m.y) < 40. {
                break;
            }
        }
        submit(&mut s, RawCommand::Stop { seq: None });
        submit(&mut s, RawCommand::Target { id });
        attack(&mut s, id);
        let camp = s.w.mobs.get(id).unwrap().camp;
        let mut woke = false;
        for _ in 0..30 {
            s.step();
            if s.landed_hits().iter().any(|h| {
                h.by == Some(PlayerId(1)) && s.w.mobs.get(h.victim).is_some_and(|m| m.camp == camp)
            }) {
                woke = true;
                break;
            }
        }
        assert!(woke, "real melee hit must wake each newly produced camp");
        submit(&mut s, RawCommand::Release { a: 0., t: None });
        s.step();
    }
    let mut events = Vec::with_capacity(1024);
    for _ in 0..400 {
        events.clear();
        s.step_into(&mut events);
        if s.mobs()
            .iter()
            .filter(|m| m.mob_type == Some(ty) && m.core.signature.mark.tier == 4)
            .count()
            == 12
        {
            break;
        }
    }
    assert_eq!(
        s.mobs()
            .iter()
            .filter(|m| m.mob_type == Some(ty) && m.core.signature.mark.tier == 4)
            .count(),
        12,
        "all twelve real NPCs must earn tier4 via their own AI weapon hits"
    );
    assert_eq!(s.s.mark_denials.len(), 12);
    for phase in ["birth", "restore"] {
        if phase == "restore" {
            s = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        }
        for _ in 0..20 {
            events.clear();
            s.step_into(&mut events);
        }
        assert_eq!(s.s.mark_denials.len(), 12);
        let dir = std::env::var_os("RH_SENTENCED_ALLOC_DIRECTORY")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(dir.join(format!("rh-sentenced-twelve-{phase}.json")))
            .build();
        for _ in 0..20 {
            events.clear();
            #[cfg(feature = "schedule-trace")]
            s.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            s.step_into(&mut events);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}
