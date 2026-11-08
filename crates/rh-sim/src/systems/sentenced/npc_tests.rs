//! Native production/ownership regressions. No synthetic setup below is called source parity.
use super::*;
use crate::{
    validate, FactionMode, Placement, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
};

fn training_source(ty: crate::mob_catalog::MobTypeId) -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            training: true,
            dummies: false,
            quests: false,
            consumables: false,
            regen: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[Placement {
            profile: "native-source-target".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: Some(4000.),
            weapon0: Some(WeaponId::Bow),
            weapon1: None,
        }],
    );
    let code = crate::mob_catalog::MobTypeId::ALL
        .iter()
        .position(|id| *id == ty)
        .unwrap() as u32;
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Train(crate::input::TrainRaw {
            command: 3,
            id: code,
            count: 0,
            options: [0; 3],
            option_count: 0,
        }))
        .unwrap(),
    )
    .unwrap();
    sim.step();
    assert!(!sim.mobs().is_empty());
    assert!(sim
        .mobs()
        .iter()
        .filter(|m| m.kind == crate::mob_runtime::MobKind::Practice)
        .all(|m| m.core.vitals.faction == FactionId::Sentenced));
    let npc = sim
        .mobs()
        .iter()
        .find(|m| m.mob_type == Some(ty))
        .expect("real typed practice producer");
    let target = npc.core.id;
    let a = crate::math::atan2(
        npc.core.body.y - sim.players()[0].body.y,
        npc.core.body.x - sim.players()[0].body.x,
    );
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Target { id: target }).unwrap(),
    )
    .unwrap();
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a, t: None }).unwrap(),
    )
    .unwrap();
    sim.step();
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Release { a, t: None }).unwrap(),
    )
    .unwrap();
    sim.step();
    sim
}

#[test]
fn actual_training_melee_and_bow_sources_mark_players_and_restore_without_input() {
    for ty in [
        crate::mob_catalog::MobTypeId::Bailiff,
        crate::mob_catalog::MobTypeId::Pardoner,
    ] {
        let mut sim = training_source(ty);
        let mut marked = false;
        let mut pulsed = false;
        for _ in 0..180 {
            let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
            let mut cloned = sim.clone();
            let events = sim.step();
            assert_eq!(events, restored.step());
            assert_eq!(events, cloned.step());
            assert_eq!(sim.state_hash(), restored.state_hash());
            assert_eq!(sim.state_hash(), cloned.state_hash());
            marked |= sim.mobs().iter().any(|m| {
                m.core.signature.mark.hits > 0
                    && m.core.signature.mark.tier > 0
                    && m.core.signature.mark.group
                        == Some(crate::fighter::MarkGroup::Fighter(PlayerId(1)))
            });
            pulsed |= sim.damage_entries().iter().any(|e| {
                e.sig == Some(SignatureKind::Mark)
                    && e.by
                        .is_some_and(|id| sim.mobs().iter().any(|m| m.core.id == id))
                    && e.victim == PlayerId(1)
            });
            assert_eq!(sim.players()[0].credit.sentence, 0);
        }
        assert!(marked, "actual {ty:?} AI must produce a Mark");
        assert!(pulsed, "actual {ty:?} AI must produce a Mark pulse");
    }
}

fn diagnostic_scene() -> Sim {
    Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: false,
            regen: false,
            pvp_rules: false,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &(0..4)
            .map(|i| Placement {
                profile: format!("diagnostic-{i}"),
                faction: if i % 2 == 0 {
                    FactionId::Sentenced
                } else {
                    FactionId::Plague
                },
                bot: false,
                at: Vec2::new(400. + i as f64 * 30., 320.),
                hp: None,
                weapon0: Some(WeaponId::Sword),
                weapon1: None,
            })
            .collect::<Vec<_>>(),
    )
}
fn entry(by: PlayerId, victim: PlayerId, raw: f64, execute: bool) -> Entry {
    Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: execute.then_some(SignatureKind::Disease),
        execute,
        victim,
        by: Some(by),
        packet: Packet {
            raw,
            phys: 0.,
            magic: 0.,
            true_: 1.,
        },
        weapon: Some(WeaponId::Sword),
        stagger: false,
        projectile: None,
        scale: 1.,
        derived: false,
        passive: false,
    }
}
#[test]
fn diagnostic_frozen_edges_survive_earlier_foe_death_and_multiple_payout_spans() {
    let mut s = diagnostic_scene();
    for owner in [PlayerId(1), PlayerId(3)] {
        assert!(crate::cards::grant(
            &s.k,
            &mut s.w,
            owner,
            crate::cards::CardId::FinalVerdict
        ));
    }
    for (owner, foe) in [(0, PlayerId(2)), (2, PlayerId(4))] {
        s.w.players[owner]
            .signature
            .set_target(foe, s.w.server_time);
        s.w.players[owner].signature.mark = crate::fighter::Mark {
            group: Some(crate::fighter::MarkGroup::Fighter(foe)),
            tier: 4,
            hits: 9,
            progress: 9.,
            ..Default::default()
        };
    }
    // Declared already-mitigated ledger diagnostic: victim2 is applied first and dies. Its later entry must still be
    // denied by owner1's pass-start mark; owner3's independent batch must not overwrite the first queued span.
    s.s.ledger.extend([
        entry(PlayerId(4), PlayerId(2), 100000., false),
        entry(PlayerId(2), PlayerId(1), 100000., true),
        entry(PlayerId(4), PlayerId(3), 100000., true),
    ]);
    let mut events = Vec::new();
    let mut cx = super::super::Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut events,
        pf: &mut s.pf,
    };
    super::super::signatures::before_damage(&mut cx);
    assert_eq!(
        cx.s.mark_denials,
        [(PlayerId(1), PlayerId(2)), (PlayerId(3), PlayerId(4))]
    );
    super::super::ledger::apply(&mut cx);
    assert!(!s.players()[1].standing());
    for owner in [0, 2] {
        assert_eq!(s.players()[owner].vitals.hp, 1.);
        assert!(s.players()[owner].signature.mark.denied);
        assert_eq!(s.players()[owner].credit.sentence, 1);
    }
    assert!(s.w.pay.mark_denied_amounts.is_empty());
    assert!(s.w.pay.is_settled());
    // The ordinary Plague participants can exchange disease in this same signature pass. Isolate returned damage:
    // a Final Verdict's large passive true row is absent from this ledger, and the living foe survives it.
    assert!(s.players()[3].standing());
    assert!(!s
        .landed_hits()
        .iter()
        .any(|e| e.sig.is_none() && matches!(e.by, Some(PlayerId(1) | PlayerId(3)))));
    assert_eq!(s.w.deferred.hits.len(), 2);
    assert_eq!(
        s.w.deferred
            .hits
            .iter()
            .map(|e| (e.by, e.victim))
            .collect::<Vec<_>>(),
        [
            (Some(PlayerId(1)), PlayerId(2)),
            (Some(PlayerId(3)), PlayerId(4))
        ]
    );
    assert!(s
        .w
        .deferred
        .hits
        .iter()
        .all(|e| e.passive && e.packet.true_ == 1. && e.packet.raw > 0.));
    assert!(events.iter().any(|e| matches!(
        e,
        crate::Event::MarkNotice {
            recipient: PlayerId(2),
            notice: crate::events::MarkNotice::ExecuteBlocked
        }
    )));
    assert!(events.iter().any(|e| matches!(
        e,
        crate::Event::MarkNotice {
            recipient: PlayerId(4),
            notice: crate::events::MarkNotice::ExecuteBlocked
        }
    )));
}
#[test]
fn diagnostic_denial_bank_tail_spans_are_immutable_and_payment_is_sealed() {
    let mut s = diagnostic_scene();
    s.w.pay.collecting = true;
    let mut a = Denied::begin(&s.w);
    a.add(&mut s.w, PlayerId(2), 1.);
    a.add(&mut s.w, PlayerId(2), 2.);
    let mut b = Denied::begin(&s.w);
    b.add(&mut s.w, PlayerId(4), 4.);
    assert_eq!(
        s.w.pay.mark_denied_amounts,
        [(PlayerId(2), 3.), (PlayerId(4), 4.)]
    );
    assert_eq!((a.start, a.len, b.start, b.len), (0, 1, 1, 1));
    assert!(
        serde_json::to_value(&s).is_err(),
        "live bank cannot checkpoint"
    );
    s.w.pay.collecting = false;
    let prior = s.w.pay.mark_denied_amounts.clone();
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.add(
            &mut s.w,
            PlayerId(4),
            1.
        )))
        .is_err()
    );
    assert_eq!(s.w.pay.mark_denied_amounts, prior);
}
#[test]
fn checked_edge_budget_covers_training_and_refuses_overflow() {
    let mut s = diagnostic_scene();
    assert_eq!(edge_budget(&s.k, 0), Ok(8));
    s.k.config.training = true;
    assert_eq!(edge_budget(&s.k, 8), Ok(108));
    assert_eq!(edge_budget(&s.k, 24), Ok(300));
    assert_eq!(
        edge_budget(&s.k, usize::MAX),
        Err("Sentenced edge budget overflow")
    );
}

#[test]
fn actual_npc_mark_owner_denial_uses_actor_state_without_player_credit_or_verdict() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Executioner);
    let mut owner = None;
    for _ in 0..500 {
        if let Some(m) = s.mobs().iter().find(|m| m.core.signature.mark.tier == 4) {
            owner = Some(m.core.id);
            break;
        }
        s.step();
    }
    let owner = owner.expect("actual single elite AI must earn tier4");
    let before = s.players()[0].credit.sentence;
    // Declared native denial diagnostic after a genuine AI-produced Mark. This execute row is not claimed to be a
    // client/Plague producer; no tier, target, investment, HP, or expected denial is installed.
    s.s.ledger.push(entry(PlayerId(1), owner, 100000., true));
    freeze_denials(&s.k, &s.w, &mut s.s.mark_denials);
    let mut events = Vec::new();
    let mut cx = super::super::Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut events,
        pf: &mut s.pf,
    };
    super::super::ledger::apply(&mut cx);
    let npc = s.w.actor(owner).unwrap();
    assert!(
        (npc.vitals.hp - 1.).abs() < 1e-8,
        "source proportional execute subtraction has binary64 cancellation: {}",
        npc.vitals.hp
    );
    assert!(npc.signature.mark.denied);
    assert_eq!(
        npc.signature.mark.amp_until,
        s.w.server_time + MARK_DENIAL_LINGER_MS
    );
    assert_eq!(s.players()[0].credit.sentence, before);
    assert!(
        s.w.deferred.hits.is_empty(),
        "NPCs have no player Final Verdict flag"
    );
    assert!(s.w.pay.is_settled());
}

#[test]
fn actual_npc_base_pulse_filters_nonweapon_ability_dot_arena_and_immune_diagnostics() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Executioner);
    let owner = s
        .mobs()
        .iter()
        .find(|m| m.mob_type == Some(crate::mob_catalog::MobTypeId::Executioner))
        .unwrap()
        .core
        .id;
    let ix = s.w.fighter_idx(owner).unwrap();
    let now = s.w.server_time;
    s.w.core_mut(ix).signature.set_target(PlayerId(1), now);
    let good = entry(owner, PlayerId(1), 1., false);
    let mut rows = vec![good.clone()];
    for n in 0..9 {
        let mut e = good.clone();
        match n {
            0 => e.weapon = None,
            1 => e.sig = Some(SignatureKind::Burn),
            2 => e.ability = Some(crate::status_runtime::AbilityId::Blaze),
            3 => e.dot = true,
            4 => e.arena = true,
            5 => e.passive = true,
            6 => e.derived = true,
            7 => e.scale = 0.,
            _ => e.packet.raw = 0.,
        };
        rows.push(e);
    }
    let mut events = Vec::new();
    before_damage(&s.k, &mut s.w, &mut rows, &mut events);
    assert_eq!(
        rows.iter()
            .filter(|e| e.sig == Some(SignatureKind::Mark))
            .count(),
        1
    );
    assert_eq!(rows.last().unwrap().by, Some(owner));
    assert_eq!(rows.last().unwrap().victim, PlayerId(1));
    assert_eq!(rows.last().unwrap().weapon, Some(WeaponId::Sword));
    s.w.players[0].vitals.immune_until = s.w.server_time + 100.;
    let mut immune = vec![good];
    before_damage(&s.k, &mut s.w, &mut immune, &mut events);
    assert_eq!(immune.len(), 1);
}

#[test]
fn real_npc_mark_has_required_typed_group_and_checked_restore_controls() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Executioner);
    for _ in 0..200 {
        if s.mobs().iter().any(|m| m.core.signature.mark.hits > 0) {
            break;
        }
        s.step();
    }
    let owner = s
        .mobs()
        .iter()
        .find(|m| m.core.signature.mark.hits > 0)
        .expect("AI-produced Mark");
    let index = s
        .mobs()
        .iter()
        .position(|m| m.core.id == owner.core.id)
        .unwrap();
    let field = format!("/world/mobs/{index}/core/signature/mark");
    let value = serde_json::to_value(&s).unwrap();
    assert_eq!(value["format"], "rh-checkpoint/27");
    Sim::restore(value.clone()).unwrap();
    for key in ["group", "group_size"] {
        let mut bad = value.clone();
        bad.pointer_mut(&field)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(
            Sim::restore(bad).is_err(),
            "required historical {key} cannot default"
        );
    }
    for (key, v) in [
        ("group", serde_json::json!({"Fighter":999999})),
        ("group", serde_json::json!({"Camp":0})),
        ("group_size", serde_json::json!(0)),
        ("group_size", serde_json::json!(2)),
        ("hits", serde_json::json!(0)),
    ] {
        let mut bad = value.clone();
        bad.pointer_mut(&field).unwrap()[key] = v;
        assert!(Sim::restore(bad).is_err());
    }
    let mut wrong_origin = value.clone();
    wrong_origin["world"]["actor_history"][owner.core.id.0 as usize - 1]["origin"]["Practice"]
        ["mob_type"] = serde_json::json!("bailiff");
    assert!(
        Sim::restore(wrong_origin).is_err(),
        "the new NPC source must match retained typed birth"
    );
    let mut wrong_elite = value.clone();
    wrong_elite["world"]["mobs"][index]["elite"] = serde_json::json!(false);
    assert!(
        Sim::restore(wrong_elite).is_err(),
        "catalog/source elite tuple is not a player approximation"
    );
    let mut old = value;
    old["format"] = serde_json::json!("rh-checkpoint/26");
    assert!(matches!(
        Sim::restore(old),
        Err(crate::CheckpointError::UnsupportedFormat { .. })
    ));
    let hash = s.state_hash();
    let mut changed = s.clone();
    changed
        .w
        .mobs
        .get_mut(owner.core.id)
        .unwrap()
        .core
        .signature
        .mark
        .group_size = 2;
    assert_ne!(
        hash,
        changed.state_hash(),
        "even malformed trusted group size is hashed"
    );
    let mut changed = s.clone();
    changed
        .w
        .mobs
        .get_mut(owner.core.id)
        .unwrap()
        .core
        .signature
        .mark
        .group = Some(crate::fighter::MarkGroup::Camp(0));
    assert_ne!(
        hash,
        changed.state_hash(),
        "typed group discriminator/payload is hashed"
    );
}

#[test]
fn diagnostic_npc_bonus_mirrors_do_not_enter_base_mark_and_return_clears_mark() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Executioner);
    let id = s
        .mobs()
        .iter()
        .find(|m| m.mob_type == Some(crate::mob_catalog::MobTypeId::Executioner))
        .unwrap()
        .core
        .id;
    let ix = s.w.fighter_idx(id).unwrap();
    let base = npc_pulse(&s.w, ix, WeaponId::Sword, 1000., true);
    // Encoded mirror-only diagnostic, not a restored NPC producer: player bonus fields must be ignored for NPC Mark.
    let mut mods = serde_json::to_value(&s.w.core(ix).modifiers).unwrap();
    for n in 1..5 {
        mods["wire"][n] = serde_json::json!(10000.);
    }
    s.w.core_mut(ix).modifiers = serde_json::from_value(mods).unwrap();
    assert_eq!(
        base.to_bits(),
        npc_pulse(&s.w, ix, WeaponId::Sword, 1000., true).to_bits()
    );
    let now = s.w.server_time;
    s.w.core_mut(ix).signature.set_target(PlayerId(1), now);
    let mut rows = vec![entry(id, PlayerId(1), 1., false)];
    before_damage(&s.k, &mut s.w, &mut rows, &mut Vec::new());
    assert_eq!(s.w.core(ix).signature.mark.hits, 1);
    s.w.mobs.get_mut(id).unwrap().brain.mode = crate::mob_runtime::BrainMode::Return;
    let mut rows = vec![entry(id, PlayerId(1), 1., false)];
    before_damage(&s.k, &mut s.w, &mut rows, &mut Vec::new());
    assert_eq!(rows.len(), 1);
    after_damage(&mut s.w);
    assert_eq!(s.w.core(ix).signature.mark, crate::fighter::Mark::default());
}

#[test]
#[ignore = "allocation profiler must run alone: cargo test -p rh-sim --lib sentenced_npc_warm_alloc -- --ignored --test-threads=1"]
fn sentenced_npc_warm_alloc_after_birth_restore_and_actual_teleport_reset() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Executioner);
    let mut events = Vec::with_capacity(512);
    for phase in ["birth", "restore", "reset"] {
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
            let npc = s
                .mobs()
                .iter()
                .find(|m| m.mob_type == Some(crate::mob_catalog::MobTypeId::Executioner))
                .unwrap();
            let id = npc.core.id;
            let a = crate::math::atan2(
                npc.core.body.y - s.players()[0].body.y,
                npc.core.body.x - s.players()[0].body.x,
            );
            for raw in [RawCommand::Target { id }, RawCommand::Attack { a, t: None }] {
                s.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
            }
            s.step();
            s.submit(
                PlayerId(1),
                validate(RawCommand::Release { a, t: None }).unwrap(),
            )
            .unwrap();
            s.step();
        }
        for _ in 0..40 {
            events.clear();
            s.step_into(&mut events);
        }
        assert!(
            s.mobs().iter().any(|m| m.core.signature.mark.hits > 0),
            "{phase}: actual Mark source is active"
        );
        let directory = std::env::var_os("RH_SENTENCED_ALLOC_DIRECTORY")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(directory.join(format!("rh-sentenced-{phase}.json")))
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
fn diagnostic_twelve_real_practice_actors_keep_every_frozen_edge_and_payout_span() {
    let mut s = training_source(crate::mob_catalog::MobTypeId::Bailiff);
    let code = crate::mob_catalog::MobTypeId::ALL
        .iter()
        .position(|id| *id == crate::mob_catalog::MobTypeId::Bailiff)
        .unwrap() as u32;
    for _ in 0..3 {
        for _ in 0..6 {
            s.step();
        }
        s.submit(
            PlayerId(1),
            validate(RawCommand::Train(crate::input::TrainRaw {
                command: 3,
                id: code,
                count: 0,
                options: [0; 3],
                option_count: 0,
            }))
            .unwrap(),
        )
        .unwrap();
        s.step();
    }
    let ids = s
        .mobs()
        .iter()
        .filter(|m| m.kind == crate::mob_runtime::MobKind::Practice)
        .map(|m| m.core.id)
        .collect::<Vec<_>>();
    assert_eq!(
        ids.len(),
        TRAIN_MAX_MOBS as usize,
        "real console constructs the admitted twelve-live domain"
    );
    // Declared tier-state diagnostic on actual born/provenanced actors, NOT a claim that twelve NPCs earned tier4
    // simultaneously through AI. The separate ordinary melee/bow/elite tests prove the actual producers.
    let now = s.w.server_time;
    for id in &ids {
        let ix = s.w.fighter_idx(*id).unwrap();
        s.w.core_mut(ix).signature.set_target(PlayerId(1), now);
        s.w.core_mut(ix).signature.mark = crate::fighter::Mark {
            group: Some(crate::fighter::MarkGroup::Fighter(PlayerId(1))),
            tier: 4,
            hits: 9,
            progress: 9.,
            ..Default::default()
        };
    }
    freeze_denials(&s.k, &s.w, &mut s.s.mark_denials);
    assert_eq!(
        s.s.mark_denials
            .iter()
            .map(|(owner, _)| *owner)
            .collect::<Vec<_>>(),
        ids
    );
    let pointer = s.w.pay.mark_denied_amounts.as_ptr();
    let capacity = s.w.pay.mark_denied_amounts.capacity();
    let credit = s.players()[0].credit.sentence;
    let mut events = Vec::new();
    s.w.pay.collecting = true;
    for id in &ids {
        let mut denied = Denied::begin(&s.w);
        denied.add(&mut s.w, PlayerId(1), 1.);
        super::super::ledger::pay_later(
            &s.k,
            &mut s.w,
            &mut events,
            super::super::ledger::PayLater::ExecuteDenied { owner: *id, denied },
        );
    }
    assert_eq!(s.w.pay.mark_denied_amounts.len(), 12);
    super::super::ledger::pay_all(&s.k, &mut s.w, &mut events, &mut s.pf);
    assert!(s.w.pay.is_settled());
    assert_eq!(s.w.pay.mark_denied_amounts.as_ptr(), pointer);
    assert_eq!(s.w.pay.mark_denied_amounts.capacity(), capacity);
    assert_eq!(s.players()[0].credit.sentence, credit);
    assert!(ids
        .iter()
        .all(|id| s.w.actor(*id).unwrap().signature.mark.denied));
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(
                e,
                crate::Event::MarkNotice {
                    recipient: PlayerId(1),
                    notice: crate::events::MarkNotice::ExecuteBlocked
                }
            ))
            .count(),
        12
    );
}
