//! Real native lifecycle/restore controls; source capture comparisons are kept separate below.
use super::{catalog, giver, live, live_tests};
use crate::{
    input::{validate, RawCommand},
    mob_runtime::{ActorOrigin, MobKind},
    PlayerId, Sim, Vec2,
};
fn place(s: &mut Sim, id: PlayerId, at: Vec2) {
    let now = s.w.server_time;
    let p = s.w.players.get_mut(id).unwrap();
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}
fn send(s: &mut Sim, raw: RawCommand) {
    s.submit(PlayerId(1), validate(raw).unwrap()).unwrap();
}
fn restore(s: &Sim) -> Sim {
    Sim::restore(serde_json::to_value(s).unwrap()).expect("real lifecycle checkpoint")
}

#[test]
fn neutral_giver_live_birth_and_inputs_have_real_identity_without_action_authority() {
    let mut s = live_tests::sim();
    let giver =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find_map(|o| o.giver)
            .unwrap();
    let before = s.state_hash();
    for raw in [
        RawCommand::Move {
            x: 2400.,
            y: 1600.,
            seq: None,
        },
        RawCommand::Stop { seq: None },
        RawCommand::Aim { a: 1. },
        RawCommand::Attack { a: 1., t: None },
        RawCommand::Release { a: 1., t: None },
        RawCommand::Target { id: PlayerId(1) },
    ] {
        let command = validate(raw).unwrap();
        assert_eq!(
            s.submit(giver, command),
            Err(crate::Reject::UnsupportedActorAction)
        );
        assert_eq!(
            s.submit_unbudgeted(giver, command),
            Err(crate::Reject::UnsupportedActorAction)
        );
        assert_eq!(
            s.state_hash(),
            before,
            "refused giver input changed authoritative state/budget"
        );
    }
    let mut replay = restore(&s);
    for _ in 0..12 {
        assert_eq!(s.step(), replay.step());
        assert_eq!(s.state_hash(), replay.state_hash());
    }
    let m = s.w.mobs.get(giver).unwrap();
    assert_eq!(m.core.faction_id(), None);
    assert!(m.brain.is_none());
    assert!(m.core.body.history.len() > 1);
    let view = crate::public_snapshot(&s)
        .mobs
        .into_iter()
        .find(|m| m.id == giver)
        .unwrap();
    assert_eq!(view.kind, crate::observe::ActorKind::QuestGiver);
    assert_eq!(view.weapon, None);
    assert!(!crate::systems::plague_zombies::hostile(
        &s.w,
        PlayerId(1),
        giver
    ));
    assert!(!crate::systems::plague_zombies::hostile(
        &s.w,
        giver,
        PlayerId(1)
    ));
}

#[test]
fn neutral_giver_retirement_preserves_provenance_after_the_offer_is_swept() {
    let mut s = live_tests::sim();
    let o = s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.published && catalog::DEFINITION[o.def as usize].kind == catalog::Kind::Collect)
        .unwrap()
        .clone();
    let gid = o.giver.unwrap();
    let provenance = s.w.actor_origin(gid).unwrap().clone();
    place(&mut s, PlayerId(1), o.at);
    send(
        &mut s,
        RawCommand::QuestAccept {
            quest_id: Some(o.id),
        },
    );
    s.step();
    for cid in o.containers {
        let at = s.w.containers.iter().find(|c| c.id == cid).unwrap().at;
        place(&mut s, PlayerId(1), at);
        send(&mut s, RawCommand::Pickup { container_id: cid });
        s.step();
    }
    place(&mut s, PlayerId(1), o.at);
    let events = s.step();
    assert_eq!(
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|q| q.id == o.id)
            .unwrap()
            .status,
        live::Status::Done
    );
    assert!(s.w.mobs.get(gid).is_none());
    assert_eq!(s.w.actor_origin(gid), Some(&provenance));
    assert!(!events
        .iter()
        .any(|e| matches!(e, crate::Event::Death { id, .. } if *id == gid)));
    restore(&s);
    for _ in 0..(crate::constants::CLOSED_QUEST_LINGER_MS / crate::constants::TICK_MS) as usize + 2
    {
        s.step();
    }
    assert!(!s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .any(|q| q.id == o.id));
    assert!(s.w.mobs.get(gid).is_none());
    assert_eq!(s.w.actor_origin(gid), Some(&provenance));
    assert_eq!(
        s.w.actor_label(gid).as_deref(),
        Some(catalog::DEFINITION[o.def as usize].giver)
    );
    restore(&s);
}

#[test]
fn neutral_giver_hidden_birth_restores_before_and_after_its_real_head_start() {
    let mut s = live_tests::sim();
    let offer =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| !o.published)
            .unwrap()
            .clone();
    place(&mut s, PlayerId(1), offer.at);
    s.step();
    let deadline =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == offer.id)
            .unwrap()
            .publish_at;
    assert!(deadline > s.server_time());
    assert!(s
        .w
        .quests
        .as_ref()
        .unwrap()
        .offers
        .iter()
        .find(|o| o.id == offer.id)
        .unwrap()
        .giver
        .is_none());
    let mut restored = restore(&s);
    while s.server_time() < deadline {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
    let o =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.id == offer.id)
            .unwrap();
    let giver = o.giver.expect("actual reveal births a standing giver");
    let Some(ActorOrigin::QuestGiver {
        birth_serial,
        born_tick,
        ..
    }) = s.w.actor_origin(giver)
    else {
        panic!("typed giver provenance")
    };
    assert_eq!(f64::from(*born_tick) * crate::constants::TICK_MS, deadline);
    assert!(o.containers.iter().all(|id| *id > *birth_serial));
    assert_eq!(s.w.mobs.get(giver).unwrap().core.body.history.len(), 1);
    let oi =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .position(|o| o.id == offer.id)
            .unwrap();
    for field in ["finder", "publish_at"] {
        let mut bad = serde_json::to_value(&s).unwrap();
        bad["world"]["quests"]["offers"][oi][field] = if field == "finder" {
            serde_json::Value::Null
        } else {
            serde_json::json!(deadline + 100.)
        };
        assert!(Sim::restore(bad).is_err(), "forged hidden {field}");
    }
    let mut restored = restore(&s);
    for _ in 0..12 {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
}

#[test]
fn neutral_giver_rejects_forged_identity_links_body_and_brain_without_restore_panics() {
    let s = live_tests::sim();
    restore(&s);
    let o =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .find(|o| o.giver.is_some())
            .unwrap();
    let gid = o.giver.unwrap();
    let mi = s.w.mobs.idx(gid).unwrap();
    let oi =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .position(|q| q.id == o.id)
            .unwrap();
    let original = serde_json::to_value(&s).unwrap();
    let mut cases = Vec::new();
    for (field, value) in [
        (
            "brain",
            serde_json::to_value(crate::mob_runtime::Brain::default()).unwrap(),
        ),
        ("kind", serde_json::to_value(MobKind::Regional).unwrap()),
        (
            "mob_type",
            serde_json::to_value(crate::mob_catalog::MobTypeId::Archon).unwrap(),
        ),
        ("last_hit_at", serde_json::json!(50.)),
    ] {
        let mut v = original.clone();
        v["world"]["mobs"][mi][field] = value;
        cases.push(v);
    }
    let mut v = original.clone();
    v["world"]["mobs"][mi]["core"]["vitals"]["faction"] = serde_json::json!("Fire");
    cases.push(v);
    let mut v = original.clone();
    v["world"]["mobs"][mi]["core"]["vitals"]["hp"] = serde_json::json!(4999.);
    cases.push(v);
    let mut v = original.clone();
    v["world"]["mobs"][mi]["core"]["body"]["x"] = serde_json::json!(200.);
    cases.push(v);
    let mut v = original.clone();
    v["world"]["quests"]["offers"][oi]["giver"] = serde_json::Value::Null;
    cases.push(v);
    let mut v = original.clone();
    v["world"]["quests"]["offers"][oi]["giver"] = serde_json::json!(1);
    cases.push(v);
    let mut v = original.clone();
    v["world"]["players"][0]["core"]["weapon"]["targeting"]["target"] = serde_json::json!(gid.0);
    cases.push(v);
    let hidden =
        s.w.quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .position(|q| !q.published)
            .unwrap();
    let mut v = original.clone();
    v["world"]["quests"]["offers"][hidden]["expires_at"] = serde_json::json!(1.);
    cases.push(v);
    let hi = s.w.actor_history.idx(gid).unwrap();
    let mut v = original.clone();
    v["world"]["actor_history"][hi]["origin"]["QuestGiver"]["def"] = serde_json::json!(u16::MAX);
    cases.push(v);
    for (i, v) in cases.iter().enumerate() {
        let result = std::panic::catch_unwind(|| Sim::restore(v));
        assert!(result.is_ok(), "malformed giver control {i} panicked");
        assert!(
            result.unwrap().is_err(),
            "malformed giver control {i} restored"
        );
    }
    assert!(matches!(
        s.w.actor_origin(gid),
        Some(ActorOrigin::QuestGiver { .. })
    ));
    assert!(giver::is_giver(&s.w, gid));
}

#[path = "giver_tests/source.rs"]
mod source;

#[test]
fn neutral_giver_input_guard_preserves_a_real_regional_actor_with_a_borrowed_brain() {
    let arena = live_tests::arena();
    let placements = arena
        .spawns
        .iter()
        .take(2)
        .enumerate()
        .map(|(i, at)| crate::Placement {
            profile: format!("positive{i}"),
            faction: crate::FactionId::Holy,
            bot: false,
            at: *at,
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect::<Vec<_>>();
    let mut s = Sim::reset_active(
        crate::SimConfig {
            quests: true,
            initial_loot: true,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        crate::Secrets::from_seed(5),
        &placements,
    );
    let id =
        s.w.mobs
            .iter()
            .find(|m| m.kind == MobKind::Regional && m.zombie.is_none())
            .unwrap()
            .core
            .id;
    let home = s.w.mobs.get(id).unwrap().home;
    // The real AI temporarily takes this brain while proposing through the same input door.
    let brain = s.w.mobs.get_mut(id).unwrap().brain.take();
    assert!(brain.is_some());
    let command = validate(RawCommand::Move {
        x: home.x,
        y: home.y,
        seq: None,
    })
    .unwrap();
    assert!(s.submit(id, command).is_ok());
    assert!(s.submit_unbudgeted(id, command).is_ok());
    assert!(s.w.mobs.get(id).unwrap().core.inputs.mv.is_some());
    s.w.mobs.get_mut(id).unwrap().brain = brain;
}

#[test]
fn neutral_giver_source_plans_select_existing_rows_for_valid_modes_and_keep_opt_outs() {
    use crate::{mob_runtime::MobMode as M, FactionMode as F};
    let arena = std::sync::Arc::new(live_tests::arena());
    for (mode, mobs, roam) in [
        (F::Off, M::Off, false),
        (F::Off, M::Pve, false),
        (F::EngagementHolyPlagueFireFrostSentenced, M::Pve, false),
        (
            F::EngagementHolyPlagueFireFrostSentencedFireRoam,
            M::Pve,
            true,
        ),
        (
            F::EngagementHolyPlagueFireFrostSentencedFireRoam,
            M::Off,
            true,
        ),
    ] {
        for quests in [false, true] {
            let s = Sim::try_new(
                crate::SimConfig {
                    quests,
                    initial_loot: true,
                    mob_mode: mobs,
                    faction_mode: mode,
                    ..Default::default()
                },
                arena.clone(),
                crate::Secrets::from_seed(5),
            )
            .unwrap();
            let g = crate::schedule::Gates::of(&s.k);
            let plan = crate::schedule::Plan::of(&s.k);
            assert_eq!(g.fire_roam, roam);
            assert_eq!(g.quests, quests);
            assert_eq!(
                plan.systems
                    .live()
                    .iter()
                    .any(|(name, _)| *name == "fireRoam.update"),
                roam
            );
            assert_eq!(
                plan.mod_sources
                    .live()
                    .iter()
                    .any(|(name, _)| *name == "fireRoam.roamingSpeed"),
                roam
            );
            assert_eq!(
                plan.systems
                    .live()
                    .iter()
                    .any(|(name, _)| *name == "quests.questSystem"),
                quests
            );
        }
    }
}

#[test]
fn neutral_giver_missing_runtime_rejects_only_a_world_that_really_spawned_quests() {
    let before = Sim::try_new(
        crate::SimConfig {
            quests: true,
            ..Default::default()
        },
        live_tests::arena(),
        crate::Secrets::from_seed(7),
    )
    .unwrap();
    assert!(before.w.quests.is_none());
    restore(&before); // A real source map is valid before the planning/raid spawn hook.
    let mut erased = live_tests::sim();
    let ids = erased
        .w
        .actor_history
        .iter()
        .filter(|a| matches!(a.origin, ActorOrigin::QuestGiver { .. }))
        .map(|a| a.id)
        .collect::<Vec<_>>();
    for id in ids {
        erased.w.mobs.remove(id);
        erased.w.actor_history.remove(id);
    }
    erased.w.next_id = erased.w.actor_history.len() as u32 + 1;
    erased.w.quests = None;
    assert!(giver::validate(&erased.k, &erased.w).is_err());
    assert!(Sim::restore(serde_json::to_value(&erased).unwrap()).is_err());

    for (training, quests, has_camps) in [
        (false, false, true),
        (false, true, false),
        (true, true, true),
    ] {
        let arena = if has_camps {
            live_tests::arena()
        } else {
            crate::arenas::practice_arena()
        };
        let mut s = Sim::try_new(
            crate::SimConfig {
                min_players: 1,
                lobby_seconds: 0.,
                fill_seconds: 0.,
                training,
                quests,
                ..Default::default()
            },
            arena,
            crate::Secrets::from_seed(7),
        )
        .unwrap();
        s.add_player("guard", Some(crate::FactionId::Holy), false)
            .unwrap();
        for _ in 0..3 {
            s.step();
        }
        assert_eq!(s.phase(), crate::Phase::Active);
        assert!(s.w.quests.is_none());
        restore(&s);
    }
}

#[test]
fn neutral_giver_known_and_hidden_births_preserve_fractional_clock_offsets() {
    for offset in [0.1, 1. / 3., 100_000.1, 100_000. + 1. / 3.] {
        let mut s = Sim::try_new(
            crate::SimConfig {
                quests: true,
                pvp_rules: false,
                min_players: 1,
                lobby_seconds: 0.,
                fill_seconds: 0.,
                ..Default::default()
            },
            live_tests::arena(),
            crate::Secrets {
                order_salt: 7,
                spawn_seed: 0,
                reward_salt: [1, 2, 3, 4],
            },
        )
        .unwrap();
        // Declared native clock setup, restored before any actor/quest birth. The existing
        // Baseline clock contract permits this finite nonintegral epoch; it is not a source outcome.
        s.w.server_time = offset;
        s = restore(&s);
        s.add_player("clock", Some(crate::FactionId::Holy), false)
            .unwrap();
        s.step();
        assert_eq!(s.phase(), crate::Phase::Active);
        assert!(s
            .w
            .quests
            .as_ref()
            .unwrap()
            .offers
            .iter()
            .any(|o| o.known && o.giver.is_some()));
        s = restore(&s);
        let hidden =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| !o.known)
                .unwrap()
                .clone();
        place(&mut s, PlayerId(1), hidden.at);
        s.step();
        // Declared native placement also resets this human's rewind. It isolates the giver
        // checks from the pre-existing player's exact >=50ms history-gap validator at low
        // fractional epochs; no giver history, clock, publication or provenance is edited.
        place(&mut s, PlayerId(1), hidden.at);
        let mut continued = restore(&s);
        for _ in 0..96 {
            assert_eq!(s.step(), continued.step());
            assert_eq!(s.state_hash(), continued.state_hash());
        }
        let hidden =
            s.w.quests
                .as_ref()
                .unwrap()
                .offers
                .iter()
                .find(|o| o.id == hidden.id)
                .unwrap();
        assert!(hidden.published && hidden.finder == Some(PlayerId(1)) && hidden.giver.is_some());
        let mut continued = restore(&s);
        for _ in 0..12 {
            assert_eq!(s.step(), continued.step());
            assert_eq!(s.state_hash(), continued.state_hash());
        }
    }
}
