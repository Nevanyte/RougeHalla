//! Current prepared-scene bridge controls. Direct field edits below are labelled projection diagnostics,
//! not gameplay/source producers; existing owner source consumers remain unchanged.
use super::*;
use crate::{
    Arena, FactionId, ItemObserver, Observation, OfferError, Placement, Secrets, Sim, SimConfig,
    Status, TileMap, Vec2, WeaponId,
};

fn sample(sim: &Sim, observer: &mut ItemObserver) -> Observation {
    let mut out = Observation::default();
    observer.observe_into(sim, &[], &mut out, None).unwrap();
    out
}
fn raw(sim: &Sim) -> Observation {
    let mut out = Observation::default();
    crate::observe::observe_with(sim, PlayerId(1), &[], &mut out, None).unwrap();
    out
}
fn world() -> Sim {
    let placement = |name: &str, x| Placement {
        profile: name.into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 272.),
        hp: None,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[
            placement("owner", 300.),
            placement("current", 420.),
            placement("hidden", 1400.),
        ],
    )
}
fn npc_world() -> Sim {
    let map = serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        Arena {
            map: TileMap::new(w, h, tiles)
                .unwrap()
                .with_layers(layers)
                .unwrap(),
            spawns,
        },
        Secrets::from_seed(7),
        &[
            ("owner", Vec2::new(80., 112.)),
            ("hidden-a", Vec2::new(624., 624.)),
            ("hidden-b", Vec2::new(656., 400.)),
        ]
        .map(|(name, at)| Placement {
            profile: name.into(),
            faction: FactionId::Holy,
            bot: false,
            at,
            hp: None,
            weapon0: Some(WeaponId::Wand),
            weapon1: None,
        }),
    )
}
fn hidden_pair_world() -> (Sim, [PlayerId; 2]) {
    let mut sim = npc_world();
    let hidden = [sim.w.mobs[1].core.id, sim.w.mobs[2].core.id];
    // Projection-only geometry diagnostic: retain two genuine live source-born identities while
    // placing their current rows beyond this viewer's sight. No lifecycle/restore parity claim.
    for id in hidden {
        let mob = sim.w.mobs.iter_mut().find(|m| m.core.id == id).unwrap();
        mob.core.body.x = 700.;
        mob.core.body.y = 700.;
    }
    assert!(!raw(&sim).visible.iter().any(|row| hidden.contains(&row.id)));
    (sim, hidden)
}

fn held(sim: &mut Sim, target: Option<crate::PlayerId>) {
    sim.w
        .players
        .get_mut(PlayerId(1))
        .unwrap()
        .weapon
        .targeting
        .target = target;
}

#[test]
fn prepared_player_group_uses_current_rows_not_roster_and_raw_observe_always_clears_it() {
    let mut sim = world();
    let mut observer = ItemObserver::new(PlayerId(1));
    held(&mut sim, Some(PlayerId(2)));
    let mut out = sample(&sim, &mut observer);
    assert!(out.visible.iter().any(|a| a.id == PlayerId(2)));
    assert_eq!(
        out.owner_combat.unwrap().lock,
        OwnerLockView::Held {
            target: Some(PlayerId(2))
        }
    );
    held(&mut sim, Some(PlayerId(3)));
    assert!(sim.w.roster.name(PlayerId(3)).is_some());
    out = sample(&sim, &mut observer);
    assert!(!out.visible.iter().any(|a| a.id == PlayerId(3)));
    assert_eq!(
        out.owner_combat.unwrap().lock,
        OwnerLockView::Held { target: None }
    );
    crate::observe::observe_with(&sim, PlayerId(1), &[], &mut out, None).unwrap();
    assert!(out.owner_combat.is_none());
    out = sample(&sim, &mut observer);
    sim.w.players.get_mut(PlayerId(1)).unwrap().vitals.hp = f64::NAN;
    assert_eq!(
        crate::observe::observe_with(&sim, PlayerId(1), &[], &mut out, None),
        Err(OfferError::UnrepresentablePublicVitals)
    );
    assert!(
        out.owner_combat.is_none(),
        "clear precedes even raw observation failure"
    );
}

#[test]
fn npc_lock_alias_matches_same_scene_and_dropped_or_renewed_offers_consume_no_ids() {
    let mut sim = npc_world();
    let npc = raw(&sim)
        .visible
        .into_iter()
        .find(|a| a.kind == crate::observe::ActorKind::Regional)
        .expect("actual source-born regional NPC")
        .id;
    held(&mut sim, Some(npc));
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut out = Observation::default();
    let offer = observer.prepare_into(&sim, &[], &mut out, None).unwrap();
    let first = out.owner_combat.unwrap();
    let reference = out.me.as_ref().unwrap().attack_target.unwrap();
    assert!(out.visible.iter().any(|a| a.id == reference));
    assert_ne!(reference, npc);
    assert_eq!(
        first.lock,
        OwnerLockView::Held {
            target: Some(reference)
        }
    );
    drop(offer);
    assert_eq!(sample(&sim, &mut observer).owner_combat, Some(first));
    let original = sample(&sim, &mut observer);
    let mut replacement = observer.renewed();
    let offer = replacement.prepare_into(&sim, &[], &mut out, None).unwrap();
    let renewed = out.owner_combat.unwrap();
    assert_ne!(renewed, first);
    assert!(out.visible.iter().any(|a| Some(a.id)
        == match renewed.lock {
            OwnerLockView::Held { target } => target,
            _ => None,
        }));
    drop(offer);
    drop(replacement);
    assert_eq!(
        sample(&sim, &mut observer),
        original,
        "discarding renewal preserves committed scene"
    );
    let mut replacement = observer.renewed();
    assert_eq!(sample(&sim, &mut replacement).owner_combat, Some(renewed));
    // A formerly delivered alias remains an intake grace binding, not current display permission.
    let mob = sim.w.mobs.iter_mut().find(|m| m.core.id == npc).unwrap();
    mob.core.body.x = 700.;
    mob.core.body.y = 700.;
    assert!(!raw(&sim).visible.iter().any(|a| a.id == npc));
    let hidden = sample(&sim, &mut observer);
    assert!(!hidden.visible.iter().any(|a| a.id == reference));
    assert_eq!(
        hidden.owner_combat.unwrap().lock,
        OwnerLockView::Held { target: None }
    );
    let command = observer
        .resolve(&sim, crate::PublicCommand::Target { actor: reference })
        .unwrap();
    assert_eq!(
        command,
        crate::validate(crate::RawCommand::MissingTarget).unwrap(),
        "current visibility still guards retired intake"
    );
}

#[test]
fn same_phase_and_training_values_are_actual_not_phase_defaults() {
    let mut sim = world();
    let mut observer = ItemObserver::new(PlayerId(1));
    for (phase, status) in [
        (crate::Phase::Lobby, Status::Alive),
        (crate::Phase::Active, Status::Dead),
        (crate::Phase::Ended, Status::Dead),
    ] {
        sim.w.phase = phase;
        let owner = sim.w.players.get_mut(PlayerId(1)).unwrap();
        owner.status = status;
        owner.weapon.draw_started_at = 4_294_967_570.75;
        owner.weapon.ready_at = 4_294_968_425.450854;
        owner.modifiers.test_set_attack_wire(1e303);
        let expected = project(owner, &[]).unwrap();
        let out = sample(&sim, &mut observer);
        let got = out.owner_combat.unwrap();
        assert_eq!(
            (got.draw_started_at, got.ready_at),
            (expected.draw_started_at, expected.ready_at)
        );
        assert_eq!(got.as_milli.to_bits(), 1e303_f64.to_bits());
    }
    let mut sim = Sim::try_new(
        SimConfig {
            training: true,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
    )
    .unwrap();
    let id = sim
        .add_player("trainee", Some(FactionId::Holy), false)
        .unwrap();
    let owner = sim.w.players.get_mut(id).unwrap();
    owner.weapon.draw_started_at = -1.5;
    owner.weapon.ready_at = 101.75;
    let got = sample(&sim, &mut ItemObserver::new(id))
        .owner_combat
        .unwrap();
    assert_eq!((got.draw_started_at, got.ready_at), (u32::MAX, 101));
    sim.remove_player(id);
    assert!(sample(&sim, &mut ItemObserver::new(id))
        .owner_combat
        .is_none());
}

#[test]
fn invalid_clocks_or_mirrors_refuse_whole_offer_without_consuming_aliases() {
    for field in 0..3 {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut sim = npc_world();
            let mut observer = ItemObserver::new(PlayerId(1));
            let mut peer = ItemObserver::new(PlayerId(1));
            let original = sim.player(PlayerId(1)).unwrap().clone();
            let owner = sim.w.players.get_mut(PlayerId(1)).unwrap();
            match field {
                0 => owner.weapon.draw_started_at = bad,
                1 => owner.weapon.ready_at = bad,
                _ => owner.modifiers.test_set_attack_wire(bad),
            }
            let mut out = Observation::default();
            assert!(matches!(
                observer.prepare_into(&sim, &[], &mut out, None),
                Err(OfferError::UnrepresentableOwnerCombat)
            ));
            assert!(out.owner_combat.is_none());
            *sim.w.players.get_mut(PlayerId(1)).unwrap() = original;
            assert_eq!(sample(&sim, &mut observer), sample(&sim, &mut peer));
        }
    }
}

#[test]
fn hidden_target_identity_does_not_change_group_scene_or_future_alias_counters() {
    let (mut a, hidden) = hidden_pair_world();
    let mut b = a.clone();
    let mut oa = ItemObserver::new(PlayerId(1));
    let mut ob = ItemObserver::new(PlayerId(1));
    held(&mut a, Some(hidden[0]));
    held(&mut b, Some(hidden[1]));
    for _ in 0..3 {
        assert_eq!(sample(&a, &mut oa), sample(&b, &mut ob));
        // same-step prepared/drop and replacement/drop cannot introduce target-dependent issuance.
        let mut va = Observation::default();
        let mut vb = Observation::default();
        drop(oa.prepare_into(&a, &[], &mut va, None).unwrap());
        drop(ob.prepare_into(&b, &[], &mut vb, None).unwrap());
        assert_eq!(va, vb);
        a.step();
        b.step();
    }
    held(&mut a, None);
    held(&mut b, None);
    assert_eq!(sample(&a, &mut oa), sample(&b, &mut ob));
}

#[test]
fn no_matching_owner_means_unavailable_and_only_current_stage_rows_can_map() {
    let sim = npc_world();
    let mut out = raw(&sim);
    let refs = crate::actor_refs::ActorRefs::default();
    let stage = refs.stage(&sim, &out).unwrap();
    let npc = out
        .visible
        .iter()
        .find(|a| a.kind != crate::observe::ActorKind::Player)
        .unwrap()
        .id;
    assert!(crate::actor_refs::current_presented(&sim, &stage, &out, npc).is_some());
    // An older-stage canonical identity cannot map a replacement row, even if public cues tie.
    let replacement = PlayerId(999_999);
    out.visible.iter_mut().find(|a| a.id == npc).unwrap().id = replacement;
    assert_eq!(
        crate::actor_refs::current_presented(&sim, &stage, &out, npc),
        None
    );
    assert_eq!(
        crate::actor_refs::current_presented(&sim, &stage, &out, replacement),
        None
    );
    out.me.as_mut().unwrap().id = PlayerId(2);
    assert_eq!(
        public_bridge::prepare(&sim, PlayerId(1), &out).unwrap(),
        None
    );
    out.me = None;
    assert_eq!(
        public_bridge::prepare(&sim, PlayerId(1), &out).unwrap(),
        None
    );
}

#[test]
#[ignore = "global dhat allocator; run alone with --ignored --test-threads=1"]
fn current_membership_and_mapping_allocate_zero_for_hidden_visible_and_refused_groups() {
    let (mut sim, hidden) = hidden_pair_world();
    let out = raw(&sim);
    let refs = crate::actor_refs::ActorRefs::default();
    let stage = refs.stage(&sim, &out).unwrap();
    let npc = out
        .visible
        .iter()
        .find(|a| a.kind != crate::observe::ActorKind::Player)
        .unwrap()
        .id;
    let _profiler = dhat::Profiler::builder().testing().build();
    let _ = dhat::HeapStats::get();
    for target in [Some(npc), Some(hidden[0]), Some(hidden[1]), None] {
        held(&mut sim, target);
        let before = dhat::HeapStats::get().total_blocks;
        for _ in 0..10_000 {
            let raw = public_bridge::prepare(&sim, PlayerId(1), &out)
                .unwrap()
                .unwrap();
            std::hint::black_box(public_bridge::map_current(raw, |id| {
                crate::actor_refs::current_presented(&sim, &stage, &out, id)
            }));
        }
        assert_eq!(dhat::HeapStats::get().total_blocks - before, 0);
    }
    sim.w.players.get_mut(PlayerId(1)).unwrap().weapon.ready_at = f64::NAN;
    let before = dhat::HeapStats::get().total_blocks;
    for _ in 0..10_000 {
        assert!(public_bridge::prepare(&sim, PlayerId(1), &out).is_err());
    }
    assert_eq!(dhat::HeapStats::get().total_blocks - before, 0);
}

#[test]
fn validated_public_target_reaches_actual_prepared_player_and_npc_group() {
    for (mut sim, kind) in [
        (world(), crate::observe::ActorKind::Player),
        (npc_world(), crate::observe::ActorKind::Regional),
    ] {
        let mut observer = ItemObserver::new(PlayerId(1));
        let before = sample(&sim, &mut observer);
        let target = before
            .visible
            .iter()
            .find(|a| a.kind == kind)
            .expect("visible actual actor")
            .id;
        let command = observer
            .resolve(&sim, crate::PublicCommand::Target { actor: target })
            .unwrap();
        sim.submit(PlayerId(1), command).unwrap();
        sim.step();
        assert!(sim
            .player(PlayerId(1))
            .unwrap()
            .weapon
            .targeting
            .target
            .is_some());
        let hash = sim.state_hash();
        let after = sample(&sim, &mut observer);
        assert_eq!(sim.state_hash(), hash);
        let Some(OwnerCombatView {
            lock: OwnerLockView::Held {
                target: Some(mapped),
            },
            ..
        }) = after.owner_combat
        else {
            panic!("real validated target must reach prepared owner group");
        };
        assert!(after.visible.iter().any(|a| a.id == mapped));
        assert_eq!(after.me.unwrap().attack_target, Some(mapped));
    }
}

#[test]
fn strict_current_stage_resolver_refuses_both_committed_and_retired_fallbacks() {
    let sim = npc_world();
    let out = raw(&sim);
    let npc = out
        .visible
        .iter()
        .find(|a| a.kind != crate::observe::ActorKind::Player)
        .unwrap()
        .id;
    let mut refs = crate::actor_refs::ActorRefs::default();
    let stage = refs.stage(&sim, &out).unwrap();
    let old = crate::actor_refs::current_presented(&sim, &stage, &out, npc).unwrap();
    refs.commit(stage);
    // Deliberately mismatched projection inputs isolate the forbidden fallback: the supplied current
    // row alone is insufficient when the new staged batch does not bind it. This is not a live scene.
    let mut empty = out.clone();
    empty.visible.clear();
    let stage = refs.stage(&sim, &empty).unwrap();
    assert_eq!(
        refs.map(&sim, &stage, npc),
        Some(old),
        "old general mapper can use committed batch"
    );
    assert_eq!(
        crate::actor_refs::current_presented(&sim, &stage, &out, npc),
        None
    );
    refs.commit(stage);
    let stage = refs.stage(&sim, &empty).unwrap();
    assert_eq!(
        refs.map(&sim, &stage, npc),
        Some(old),
        "old general mapper can use retired batch"
    );
    assert_eq!(
        crate::actor_refs::current_presented(&sim, &stage, &out, npc),
        None
    );
}
