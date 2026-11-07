//! Shared Holy engagement, authoritative scratch provenance, checkpoint and observer regressions.
use rh_sim::{
    observe, validate, Arena, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, TileMap, Vec2, WeaponId,
};
fn scene() -> Sim {
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400.0 + 56.0 * i as f64, 320.0),
            hp: Some(500.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        Arena {
            map: TileMap::from_rows(
                &vec![".".repeat(118); 52]
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
            spawns: ps.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(12),
        &ps,
    )
}
fn press(sim: &mut Sim) {
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Attack { a: 0.0, t: None }).unwrap(),
    )
    .unwrap();
    sim.submit(
        PlayerId(2),
        validate(RawCommand::Attack {
            a: std::f64::consts::PI,
            t: None,
        })
        .unwrap(),
    )
    .unwrap();
}
#[test]
fn caller_owned_old_or_fabricated_output_never_creates_a_contact() {
    let mut a = scene();
    let mut b = a.clone();
    press(&mut a);
    press(&mut b);
    let prefix = vec![
        Event::Block {
            id: PlayerId(1),
            by: PlayerId(3),
            weapon: WeaponId::Shield,
            passive: false,
        },
        Event::Hit {
            victim: PlayerId(1),
            by: Some(PlayerId(3)),
            amount: 900.0,
            weapon: Some(WeaponId::Axe),
            passive: false,
        },
    ];
    for _ in 0..120 {
        let out = a.step();
        let mut fabricated = prefix.clone();
        b.step_into(&mut fabricated);
        assert_eq!(a.state_hash(), b.state_hash());
        assert_eq!(&fabricated[prefix.len()..], out);
        assert_ne!(b.players()[0].signature.target, Some(PlayerId(3)));
    }
}
#[test]
fn all_sample_schedules_and_checkpoint_continuations_agree() {
    let mut no_reads = scene();
    let mut every = no_reads.clone();
    let mut sparse = no_reads.clone();
    for s in [&mut no_reads, &mut every, &mut sparse] {
        press(s);
    }
    let mut heals = 0;
    for n in 0..220 {
        let out = no_reads.step();
        let e = every.step();
        let z = sparse.step();
        assert_eq!(out, e);
        assert_eq!(out, z);
        heals += out
            .iter()
            .filter(|e| matches!(e, Event::Heal { .. }))
            .count();
        for id in 1..=3 {
            let _ = observe(&every, PlayerId(id), &e);
            if n % 17 == 0 {
                let _ = observe(&sparse, PlayerId(id), &z);
            }
        }
        assert_eq!(no_reads.state_hash(), every.state_hash());
        assert_eq!(no_reads.state_hash(), sparse.state_hash());
        if n % 23 == 0 {
            let cp = serde_json::to_value(&no_reads).unwrap();
            let mut restored = Sim::restore(&cp).unwrap();
            assert_eq!(restored.state_hash(), no_reads.state_hash());
            assert!(restored.landed_hits().is_empty());
            let mut original = no_reads.clone();
            for _ in 0..7 {
                assert_eq!(original.step(), restored.step());
                assert_eq!(original.state_hash(), restored.state_hash());
            }
        }
    }
    assert!(heals > 10);
}
#[test]
fn private_signature_state_is_validated_and_cannot_be_installed_gate_off() {
    let mut s = scene();
    press(&mut s);
    for _ in 0..3 {
        s.step();
    }
    let base = serde_json::to_value(&s).unwrap();
    assert!(s.players()[0].signature.engaged);
    for (field, value) in [
        ("target", serde_json::json!(1)),
        ("target", serde_json::json!(0)),
        ("target", serde_json::json!(999)),
        ("contact_at", serde_json::Value::Null),
        ("combat_at", serde_json::json!(-1)),
        ("reach_at", serde_json::json!(1e300)),
        ("hp_frac", serde_json::Value::Null),
    ] {
        let mut cp = base.clone();
        cp["world"]["players"][0]["core"]["signature"][field] = value;
        assert!(Sim::restore(cp).is_err(), "{field}");
    }
    let mut cp = base.clone();
    cp["statics"]["config"]["faction_mode"] = false.into();
    assert!(Sim::restore(cp).is_err());
    let mut cp = base.clone();
    cp["world"]["players"][0]["core"]["signature"]["target"] = serde_json::Value::Null;
    assert!(Sim::restore(cp).is_err());
    // Genuine target removal between samples is valid; next active pass clears it.
    s.remove_player(PlayerId(2));
    assert!(Sim::restore(serde_json::to_value(&s).unwrap()).is_ok());
}
#[test]
fn heal_visibility_reveals_only_recipient_and_does_not_change_older_views() {
    // Bootstrap all seats on the far side, then use the documented scenario placement override.
    // The remote viewer has never legitimately revealed the near-side duel.
    let ps = vec![
        Placement {
            profile: "p0".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 320.),
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "p1".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 320.),
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "p2".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(3500., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut sim = Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        Arena {
            map: TileMap::from_rows(
                &vec![".".repeat(118); 52]
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
            spawns: vec![Vec2::new(3500., 320.)],
        },
        Secrets::from_seed(12),
        &ps,
    );
    let older = observe(&sim, PlayerId(3), &[]);
    press(&mut sim);
    let out = sim.step();
    assert!(out.iter().any(|e| matches!(e, Event::Heal { .. })));
    let hidden = observe(&sim, PlayerId(3), &out);
    assert!(hidden.events.is_empty());
    assert_eq!(older.visible, hidden.visible);
    let owner = observe(&sim, PlayerId(1), &out);
    assert!(owner
        .events
        .iter()
        .any(|e| matches!(e,rh_sim::SeenEvent::Heal{id:PlayerId(1),amount} if *amount>0.0)));
    assert!(!serde_json::to_string(&owner)
        .unwrap()
        .contains("contact_at"));
}

#[test]
fn trusted_initial_hp_above_maximum_keeps_its_unclamped_source_fraction() {
    let ps: Vec<_> = (0..2)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400.0 + 56.0 * i as f64, 320.0),
            hp: Some(2000.0),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: rh_sim::FactionMode::EngagementHoly,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(1),
        &ps,
    );
    sim.step();
    assert_eq!(sim.players()[0].signature.hp_frac, 2000.0 / 1145.0);
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    assert_eq!(restored.state_hash(), sim.state_hash());
    assert_eq!(restored.step(), sim.step());
    assert_eq!(restored.state_hash(), sim.state_hash());
}
