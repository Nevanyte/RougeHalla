//! Native projection/domain controls. Actual-source corpus consumption is a separate pending proof.
use super::*;
use crate::{
    ContainerKind, ItemObserver, OfferError, Placement, PublicCommand, Secrets, SimConfig, Vec2,
};

fn world(visible: bool) -> Sim {
    let mut arena = crate::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(100., 176.)];
    let placements = [
        (100., "owner"),
        (if visible { 150. } else { 300. }, "other"),
    ]
    .into_iter()
    .map(|(x, profile)| Placement {
        profile: profile.into(),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 176.),
        hp: None,
        weapon0: None,
        weapon1: None,
    })
    .collect::<Vec<_>>();
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(7),
        &placements,
    )
}

#[test]
fn checked_f32_domain_preserves_signed_zero_underflow_and_roundable_over_max() {
    let value = public_vitals(-0., -0., -0.).unwrap();
    for v in [value.hp, value.max_hp, value.barrier] {
        assert_eq!(v.to_bits(), (-0.0f64).to_bits());
    }
    assert_eq!((value.hp_frac, value.barrier_frac, value.ring), (0., 0., 0));
    let value = public_vitals(1e-300, 1e-300, 1e-300).unwrap();
    assert_eq!(
        (value.hp, value.max_hp, value.barrier, value.hp_frac),
        (0., 0., 0., 0.)
    );
    let above = f64::from(f32::MAX) + 1e30;
    assert!(above > f64::from(f32::MAX));
    assert_eq!(source_f32(above).unwrap(), f64::from(f32::MAX));
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e300, -1e300] {
        assert!(public_vitals(bad, 100., 0.).is_err());
        assert!(public_vitals(50., bad, 0.).is_err());
        assert!(public_vitals(50., 100., bad).is_err());
    }
    for bad in [-1., -1e-300] {
        assert!(public_vitals(50., 100., bad).is_err());
    }
    // Source positive guards are presentation behavior, not new positive HP/maxHP restore invariants.
    let negative = public_vitals(-1., -1., 0.).unwrap();
    assert_eq!(
        (negative.hp, negative.max_hp, negative.hp_frac),
        (-1., -1., 0.)
    );
}

#[test]
fn bars_use_source_twentieths_slivers_combined_denominator_and_independent_rounding() {
    let lower = f64::from(f32::from_bits(7.5f32.to_bits() - 1));
    assert_eq!(public_vitals(lower, 100., 0.).unwrap().hp_frac, 0.05);
    assert_eq!(public_vitals(7.5, 100., 0.).unwrap().hp_frac, 0.1);
    assert_eq!(public_vitals(0.001, 100., 0.001).unwrap().hp_frac, 0.05);
    assert_eq!(
        public_vitals(0.001, 100., 0.001).unwrap().barrier_frac,
        0.05
    );
    let overfull = public_vitals(100., 100., 25.).unwrap();
    assert_eq!(
        (overfull.hp_frac, overfull.barrier_frac, overfull.ring),
        (0.8, 0.2, 7)
    );
    let later_max_decrease = public_vitals(20., 20., 25.).unwrap();
    assert_eq!(
        (
            later_max_decrease.hp_frac,
            later_max_decrease.barrier_frac,
            later_max_decrease.ring
        ),
        (0.45, 0.55, 8)
    );
    let independent = public_vitals(92.5, 100., 7.5).unwrap();
    assert_eq!((independent.hp_frac, independent.barrier_frac), (0.95, 0.1));
    assert_eq!(independent.hp_frac + independent.barrier_frac, 1.05);
    assert_eq!(
        bar_share(0.12499999999999999),
        0.1,
        "round below the tie exactly, without x+0.5 double rounding"
    );
}

#[test]
fn human_ring_uses_original_float64_maximum_and_positive_eight_step_cue() {
    let original = 53.33333333333334;
    assert_eq!(public_vitals(20., original, 3.).unwrap().ring, 1);
    assert_eq!(
        public_vitals(20., f64::from(original as f32), 3.)
            .unwrap()
            .ring,
        2
    );
    assert_eq!(public_vitals(1., 100., 1e-20).unwrap().ring, 1);
    assert_eq!(public_vitals(1., 100., 0.).unwrap().ring, 0);
    assert_eq!(public_vitals(1., 100., 300.).unwrap().ring, 8);
}

#[test]
fn owner_is_source_f32_but_privileged_hp_keeps_native_precision_and_no_private_fields() {
    let mut sim = world(true);
    let p = &mut sim.w.players[0];
    p.vitals.hp = 1.0000000000000002;
    p.vitals.max_hp = 100.00000000000001;
    p.vitals.barrier = 0.1;
    let obs = try_observe(&sim, PlayerId(1), &[]).unwrap();
    let me = obs.me.unwrap();
    assert_eq!(me.hp, 1.);
    assert_eq!(me.max_hp, 100.);
    assert_eq!(me.barrier, f64::from(0.1f32));
    let snap = try_public_snapshot(&sim).unwrap();
    assert_eq!(snap.players[0].hp, 1.0000000000000002);
    assert_eq!(snap.players[0].max_hp, 100.00000000000001);
    assert_eq!(snap.players[0].barrier, f64::from(0.1f32));
    let me_json = serde_json::to_value(me).unwrap();
    for name in ["barrier_until", "barrier_decay", "barrier_expires_at"] {
        assert!(me_json.get(name).is_none());
    }
}

#[test]
fn unrepresentable_hidden_vitals_do_not_refuse_or_change_the_view() {
    let mut sim = world(false);
    let normal = try_observe(&sim, PlayerId(1), &[]).unwrap();
    assert!(!normal.visible.iter().any(|a| a.id == PlayerId(2)));
    for field in ["hp", "max_hp", "barrier"] {
        let old = sim.w.players[1].vitals.clone();
        match field {
            "hp" => sim.w.players[1].vitals.hp = 1e300,
            "max_hp" => sim.w.players[1].vitals.max_hp = f64::INFINITY,
            _ => sim.w.players[1].vitals.barrier = f64::NAN,
        }
        assert_eq!(
            try_observe(&sim, PlayerId(1), &[]).unwrap(),
            normal,
            "{field}"
        );
        assert!(matches!(
            try_public_snapshot(&sim),
            Err(OfferError::UnrepresentablePublicVitals)
        ));
        sim.w.players[1].vitals = old;
    }
}

#[test]
fn failed_preparation_keeps_issued_handles_and_recovers_without_hidden_commits() {
    let mut sim = world(true);
    sim.seed_weapon_container(
        ContainerKind::Ground,
        Vec2::new(100., 176.),
        &[WeaponId::Axe],
    )
    .unwrap();
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut out = Observation::default();
    observer.observe_into(&sim, &[], &mut out, None).unwrap();
    let handle = out.props[0].handle;
    let mut control = ItemObserver::new(PlayerId(1));
    let mut control_out = Observation::default();
    control
        .observe_into(&sim, &[], &mut control_out, None)
        .unwrap();
    assert_eq!(out, control_out);
    // An additional public row would stage new handles, but the numeric refusal happens first.
    sim.seed_weapon_container(
        ContainerKind::Ground,
        Vec2::new(104., 176.),
        &[WeaponId::Sword],
    )
    .unwrap();
    sim.step();
    sim.w.players[1].vitals.barrier = 1e300;
    assert_eq!(
        observer.observe_into(&sim, &[], &mut out, None),
        Err(OfferError::UnrepresentablePublicVitals)
    );
    assert!(observer
        .resolve(&sim, PublicCommand::Pickup { handle })
        .is_ok());
    sim.w.players[1].vitals.barrier = 25.;
    observer.observe_into(&sim, &[], &mut out, None).unwrap();
    assert!(out.visible[0].barrier_frac > 0.);
    control
        .observe_into(&sim, &[], &mut control_out, None)
        .unwrap();
    assert_eq!(
        out, control_out,
        "failed preparation consumes no handle/reference issuance"
    );
    sim.w.players[1].vitals.barrier = 0.;
    observer.observe_into(&sim, &[], &mut out, None).unwrap();
    assert_eq!(
        (
            out.visible[0].barrier_frac,
            out.visible[0].barrier_ring_step
        ),
        (0., 0)
    );
    sim.remove_player(PlayerId(1));
    observer.observe_into(&sim, &[], &mut out, None).unwrap();
    assert!(out.me.is_none() && out.visible.is_empty() && out.inventory.is_none());
}

#[test]
fn npc_hp_uses_twentieths_and_never_exposes_a_player_barrier() {
    let mut sim = Sim::reset_active(
        SimConfig {
            training: true,
            dummies: true,
            consumables: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(3),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(100., 176.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    assert!(
        !sim.w.mobs.is_empty(),
        "actual training setup supplies NPCs"
    );
    let mob = &mut sim.w.mobs[0];
    mob.core.vitals.hp = 7.5;
    mob.core.vitals.max_hp = 100.;
    mob.core.vitals.barrier = f64::NAN; // no source MobState barrier field: ignored in presentation.
    let view = mob_view(&sim.w, &sim.w.mobs[0]).unwrap();
    assert_eq!(
        (view.hp_frac, view.barrier_frac, view.barrier_ring_step),
        (0.1, 0., 0)
    );
}

#[test]
fn owner_refusal_and_retained_dead_end_values_use_checked_delivery_without_sentinels() {
    let mut sim = world(true);
    for (hp, max_hp, barrier) in [(1e300, 100., 0.), (50., 1e300, 0.), (50., 100., -1.)] {
        sim.w.players[0].vitals.hp = hp;
        sim.w.players[0].vitals.max_hp = max_hp;
        sim.w.players[0].vitals.barrier = barrier;
        assert!(matches!(
            try_observe(&sim, PlayerId(1), &[]),
            Err(OfferError::UnrepresentablePublicVitals)
        ));
    }
    sim.w.players[0].vitals.hp = 0.;
    sim.w.players[0].vitals.max_hp = 100.;
    sim.w.players[0].vitals.barrier = 25.;
    sim.w.players[0].status = Status::Dead;
    sim.w.phase = Phase::Ended;
    let me = try_observe(&sim, PlayerId(1), &[]).unwrap().me.unwrap();
    assert_eq!(
        (me.status, me.barrier, me.barrier_ring_step),
        (Status::Dead, 25., 7)
    );
    sim.w.players[0].vitals.hp = -0.;
    sim.w.players[0].vitals.max_hp = -0.;
    sim.w.players[0].vitals.barrier = -0.;
    let me = try_observe(&sim, PlayerId(1), &[]).unwrap().me.unwrap();
    for v in [me.hp, me.max_hp, me.barrier] {
        assert_eq!(v.to_bits(), (-0.0f64).to_bits());
    }
}
