use rh_sim::{status_runtime::*, PlayerId};
use std::sync::Arc;
#[test]
fn geometric_admission_rejects_binary64_overflow_without_a_gameplay_radius_cap() {
    for v in [0., -0., 1e150, -1e150] {
        assert!(geometry_scalar_is_safe(v));
    }
    for v in [1e308, -1e308, f64::INFINITY, f64::NAN] {
        assert!(!geometry_scalar_is_safe(v));
    }
    let a: f64 = 1e150;
    assert!(((a - -a) * (a - -a) * 2.).is_finite());
}
fn request(kind: StatusKind) -> StatusApply {
    StatusApply {
        kind,
        source: StatusSource {
            id: Some(PlayerId(1)),
            name: Arc::from("first"),
            owner_id: None,
        },
        ms: 1000.,
        ability: None,
        tag: None,
        value: Some(0.),
        add: None,
        data: None,
    }
}
#[test]
fn all_fourteen_rules_preserve_presence_and_expiry_independently_of_magnitude() {
    for kind in STATUS_KINDS {
        let mut rt = StatusRuntime::default();
        let a = request(kind);
        assert!(admits(&a, Recipient::Player, true));
        assert_eq!(admits(&a, Recipient::Mob, true), !kind.rule().players_only);
        assert!(!admits(&a, Recipient::QuestGiver, true));
        assert!(!admits(&a, Recipient::Player, false));
        apply(&mut rt, 10., a);
        assert!(has(&rt.instances, kind, 1009.));
        assert!(!has(&rt.instances, kind, 1010.));
        assert_eq!(effects_of(&rt.instances, None, 10.), kind.rule().bit);
        assert!(find(&rt.instances, kind, None).is_some());
    }
}
#[test]
fn effective_key_collision_keeps_metadata_and_stale_payload_but_replaces_source() {
    let mut rt = StatusRuntime::default();
    let mut a = request(StatusKind::Hidden);
    a.tag = Some(StatusTag::from("swarm"));
    a.data = Some(Payload {
        floor_hp: Some(7.),
        reveal_until: Some(80.),
        ..Default::default()
    });
    apply(&mut rt, 0., a.clone());
    a.tag = Some(StatusTag::from("ignored"));
    a.ability = Some(AbilityId::Swarm);
    a.source.name = Arc::from("second");
    a.data = None;
    let r = apply(&mut rt, 50., a.clone());
    assert!(!r.fresh);
    assert_eq!(rt.instances.len(), 1);
    assert_eq!(&*rt.instances[0].source.name, "first");
    let r = apply(&mut rt, 1050., a);
    assert!(r.fresh);
    let st = &rt.instances[0];
    assert_eq!(&*st.source.name, "second");
    assert_eq!(st.ability, None);
    assert_eq!(st.tag.as_ref().map(StatusTag::as_str), Some("swarm"));
    assert_eq!(st.data.floor_hp, Some(7.));
    assert_eq!(st.data.reveal_until, None);
}
#[test]
fn hidden_reveal_starts_next_tick_and_open_windows_only_extend() {
    let mut rt = StatusRuntime::default();
    apply(&mut rt, 0., request(StatusKind::Hidden));
    reveal(&mut rt, 100., 500.);
    assert!(hidden(&rt.instances, 149.));
    assert!(!hidden(&rt.instances, 150.));
    reveal(&mut rt, 200., 600.);
    assert_eq!(rt.instances[0].reveal_from, Some(150.));
    assert!(!hidden(&rt.instances, 599.));
    assert!(hidden(&rt.instances, 600.));
    reveal(&mut rt, 600., 800.);
    assert_eq!(rt.instances[0].reveal_from, Some(650.));
}
#[test]
fn cleanse_is_stable_and_never_ignores_stale_matches() {
    let mut rt = StatusRuntime::default();
    for kind in STATUS_KINDS {
        apply(&mut rt, 0., request(kind));
    }
    let mut out = Vec::new();
    assert!(remove_into(
        &mut rt,
        1000.,
        Selector::Cleanse {
            soft: true,
            hard: true
        },
        &mut out
    ));
    assert!(rt
        .instances
        .iter()
        .all(|s| s.kind.rule().cleanse == CleanseClass::Never));
    assert_eq!(
        out.iter().map(|s| s.kind).collect::<Vec<_>>(),
        STATUS_KINDS
            .into_iter()
            .filter(|k| k.rule().cleanse != CleanseClass::Never)
            .collect::<Vec<_>>()
    );
}
#[test]
fn floor_accumulates_hp_reaching_overkill_and_uses_first_active_instance() {
    let mut rt = StatusRuntime::default();
    let mut a = request(StatusKind::DeathFloor);
    a.data = Some(Payload {
        floor_hp: Some(10.),
        ..Default::default()
    });
    apply(&mut rt, 0., a);
    assert_eq!(floor_hp(&mut rt.instances, 50., 5., 100.), 5.);
    assert_eq!(rt.instances[0].taken, Some(100.));
    assert_eq!(floor_hp(&mut rt.instances, 1000., 5., 100.), 0.);
    assert_eq!(rt.instances[0].taken, Some(100.));
}
#[test]
fn numeric_reader_boundary_accepts_finite_negative_values_and_unclamped_resistance() {
    let mut rt = StatusRuntime::default();
    let mut a = request(StatusKind::SlowMove);
    a.value = Some(-0.5);
    apply(&mut rt, 0., a);
    assert_eq!(move_multiplier(&rt, 0., 0.4, 1.), 1.5);
    assert!(validate(&rt, 0.).is_ok());
    assert_eq!(resist_slow(0.5, 2.), 1.);
    assert_eq!(resist_slow(1.5, 0.4), 1.5);
    rt.instances[0].value = f64::INFINITY;
    assert!(validate(&rt, 0.).is_err());
}
#[test]
fn ordinary_axe_source_departure_preserves_snapshot_and_restore_continuation() {
    use rh_sim::{
        validate, FactionId, Placement, RawCommand, Secrets, Sim, SimConfig, Vec2, WeaponId,
    };
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("p{}", i + 1),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400. + 56. * i as f64, 400.),
            hp: None,
            weapon0: if i == 0 { Some(WeaponId::Axe) } else { None },
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(4),
        &ps,
    );
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    sim.step();
    let snapshot = sim.player(PlayerId(2)).unwrap().statuses.instances[0].clone();
    assert_eq!(snapshot.kind, StatusKind::Shred);
    assert_eq!(snapshot.source.id, Some(PlayerId(1)));
    sim.remove_player(PlayerId(1));
    assert!(sim.player(PlayerId(1)).is_none());
    assert_eq!(
        sim.player(PlayerId(2)).unwrap().statuses.instances[0],
        snapshot
    );
    let checkpoint = serde_json::to_value(&sim).unwrap();
    for large_counter in [false, true] {
        let mut bad = checkpoint.clone();
        bad["world"]["players"][0]["core"]["statuses"]["instances"][0]["source"]["id"] =
            serde_json::json!(999);
        if large_counter {
            bad["world"]["next_id"] = serde_json::json!(u32::MAX - 1)
        }
        assert!(Sim::restore(bad).is_err());
    }
    let mut copy = Sim::restore(checkpoint).unwrap();
    assert_eq!(copy.state_hash(), sim.state_hash());
    for _ in 0..65 {
        assert_eq!(copy.step(), sim.step());
        assert_eq!(copy.state_hash(), sim.state_hash());
    }
}
