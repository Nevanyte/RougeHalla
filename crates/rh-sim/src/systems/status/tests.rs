use super::*;
use crate::{
    content::DamageShares, systems::ledger, validate, FactionId, Placement, RawCommand, Secrets,
    Sim, SimConfig, Vec2, WeaponId,
};
fn sim() -> Sim {
    let ps: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400. + 56. * i as f64, 400.),
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig::default(),
        crate::arenas::practice_arena(),
        Secrets::from_seed(4),
        &ps,
    )
}
fn a(s: &Sim, kind: StatusKind) -> rt::StatusApply {
    rt::StatusApply {
        kind,
        source: rt::StatusSource {
            id: Some(PlayerId(1)),
            name: s.w.roster.label(PlayerId(1)).unwrap().clone(),
            owner_id: None,
        },
        ms: 1000.,
        ability: None,
        tag: None,
        value: None,
        add: None,
        data: None,
    }
}
fn add(s: &mut Sim, id: PlayerId, a: rt::StatusApply, ev: &mut Vec<Event>) {
    operations::apply(&s.k, &mut s.w, ev, id, a, false);
}
#[test]
fn real_fifo_freezes_status_membership_and_immediate_mirror_until_all_payouts() {
    let mut s = sim();
    let mut ev = Vec::new();
    s.w.pay.collecting = true;
    let mut first = a(&s, StatusKind::SlowAttack);
    first.value = Some(0.3);
    add(&mut s, PlayerId(2), first, &mut ev);
    let mut removed = Vec::new();
    operations::remove_into(
        &s.k,
        &mut s.w,
        &mut ev,
        PlayerId(2),
        Selector::Kind(StatusKind::SlowAttack),
        &mut removed,
    );
    let mut second = a(&s, StatusKind::SlowAttack);
    second.value = Some(0.2);
    add(&mut s, PlayerId(2), second, &mut ev);
    assert!(removed.is_empty());
    assert!(s.w.players[1].statuses.instances.is_empty());
    assert_eq!(s.w.players[1].modifiers.attack_rate_wire(), 1000.);
    assert!(ev.is_empty());
    ledger::pay_all(&s.k, &mut s.w, &mut ev, &mut s.pf);
    assert_eq!(s.w.players[1].statuses.instances[0].value, 0.2);
    assert_eq!(s.w.players[1].modifiers.attack_rate_wire(), 800.);
    assert_eq!(ev.len(), 2);
}
#[test]
fn queued_displacement_reads_current_goal_and_collision_map_at_drain() {
    for block in [false, true] {
        let mut s = sim();
        let to = Vec2::new(400., 300.);
        s.w.players[1]
            .motion
            .path
            .set_from(&[Vec2::new(620., 400.)]);
        s.w.pay.collecting = true;
        super::super::displace::apply(&s.k, &mut s.w, &mut s.pf, PlayerId(2), to);
        let goal = Vec2::new(800., 400.);
        s.w.players[1].motion.path.set_from(&[goal]);
        if block {
            // Trusted test-only collision replacement. Ordinary match statics remain immutable.
            let mut arena = (*s.k.arena).clone();
            let mut tiles = arena.map.tiles.clone();
            let tx = 20;
            for y in 0..arena.map.h {
                tiles[(y * arena.map.w + tx) as usize] = 1;
            }
            arena.map = crate::map::TileMap::new(arena.map.w, arena.map.h, tiles).unwrap();
            s.k = crate::statics::MatchStatic::new(s.k.config.clone(), arena, s.k.secrets);
        }
        let mut expected = Vec::new();
        crate::pathfind::Pathfinder::default().find_path_into(
            &s.k.arena.map,
            to,
            goal,
            crate::constants::PLAYER_RADIUS,
            &mut expected,
        );
        if block {
            assert!(expected.is_empty());
        } else {
            assert!(!expected.is_empty());
        }
        ledger::pay_all(&s.k, &mut s.w, &mut Vec::new(), &mut s.pf);
        assert_eq!(s.w.players[1].motion.path.as_slice(), expected.as_slice());
    }
}
#[test]
fn queued_apply_rechecks_standing_but_displacement_still_runs_and_resets_only_target_lock_memory() {
    let mut s = sim();
    let mut ev = Vec::new();
    s.w.players[1]
        .motion
        .path
        .set_from(&[Vec2::new(620., 400.)]);
    let lock = &mut s.w.players[2].weapon.targeting;
    lock.target = Some(PlayerId(2));
    lock.seen = true;
    lock.lost_at = Some(1.);
    lock.plan_at = Some(3.);
    lock.search_at = Some(7.);
    lock.goal = Some(Vec2::new(456., 400.));
    s.w.pay.collecting = true;
    let status = a(&s, StatusKind::Invulnerable);
    add(&mut s, PlayerId(2), status, &mut ev);
    super::super::displace::apply(
        &s.k,
        &mut s.w,
        &mut s.pf,
        PlayerId(2),
        Vec2::new(500., 450.),
    );
    assert_eq!(s.w.players[1].body.x, 456.);
    s.w.players[1].status = crate::Status::Dead;
    s.w.players[1].vitals.hp = 0.;
    ledger::pay_all(&s.k, &mut s.w, &mut ev, &mut s.pf);
    let p = &s.w.players[1];
    assert!(p.statuses.instances.is_empty());
    assert_eq!(p.pos(), Vec2::new(500., 450.));
    assert_eq!(p.body.history.len(), 1);
    assert_eq!(p.motion.displace_seq, 1);
    assert_eq!(
        p.motion.path.as_slice().last(),
        Some(&Vec2::new(620., 400.))
    );
    let lock = &s.w.players[2].weapon.targeting;
    assert_eq!(lock.target, Some(PlayerId(2)));
    assert!(!lock.seen);
    assert_eq!(lock.lost_at, None);
    assert_eq!(lock.plan_at, None);
    assert_eq!(lock.goal, None);
    assert_eq!(lock.search_at, Some(7.));
}
#[test]
fn status_stun_cancels_actual_bow_draw_including_quiet_refresh_hook() {
    let mut s = sim();
    s.w.players[1].weapon.weapon0 = Some(WeaponId::Bow);
    s.submit(
        PlayerId(2),
        validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s.w.players[1].weapon.action.is_some());
    let status = a(&s, StatusKind::Stun);
    let mut ev = Vec::new();
    operations::apply(&s.k, &mut s.w, &mut ev, PlayerId(2), status, true);
    assert!(s.w.players[1].weapon.action.is_none());
    assert!(ev.is_empty());
    assert_eq!(s.w.players[1].statuses.effects, 1);
}
#[test]
fn floor_sees_post_barrier_overkill_and_antiheal_cuts_expiry_heal_without_lockout() {
    let mut s = sim();
    let mut ev = Vec::new();
    s.w.players[1].vitals.hp = 10.;
    s.w.players[1].vitals.barrier = 20.;
    let mut floor = a(&s, StatusKind::DeathFloor);
    floor.ms = 100.;
    floor.data = Some(rt::Payload {
        floor_hp: Some(1.),
        heal_share: Some(0.5),
        ..Default::default()
    });
    add(&mut s, PlayerId(2), floor, &mut ev);
    let mut anti = a(&s, StatusKind::AntiHeal);
    anti.value = Some(0.5);
    add(&mut s, PlayerId(2), anti, &mut ev);
    s.w.deferred.defer_hit(ledger::Entry {
        terrain: false,
        dot: false,
        ability: None,
        arena: false,
        source: None,
        critical: false,
        critical_mult: None,
        sig: None,
        execute: false,
        victim: PlayerId(2),
        by: Some(PlayerId(1)),
        packet: crate::state::Packet {
            raw: 200.,
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
    // Disable PvP scaling for the helper arithmetic branch.
    s.k.config.pvp_rules = false;
    s.step();
    let p = &s.w.players[1];
    assert_eq!(p.vitals.hp, 1.);
    assert_eq!(p.statuses.instances[0].taken, Some(180.));
    s.w.players[1].signature.combat_at = Some(s.w.server_time);
    let ev = s.step();
    assert_eq!(s.w.players[1].vitals.hp, 46.);
    assert!(ev
        .iter()
        .any(|e| matches!(e,Event::Heal{id:PlayerId(2),amount} if *amount==45.)));
}
#[test]
fn generic_dot_uses_shared_cap_reports_landed_amounts_and_restores_private_chunk() {
    let mut s = sim();
    let mut ev = Vec::new();
    let mut dot = a(&s, StatusKind::Dot);
    dot.ability = Some(rt::AbilityId::Blaze);
    dot.value = Some(10000.);
    dot.data = Some(rt::Payload {
        shares: Some(DamageShares {
            phys: 0.,
            magic: 0.,
            true_: 1.,
        }),
        ..Default::default()
    });
    add(&mut s, PlayerId(2), dot, &mut ev);
    let mut projector = crate::FxProjector::attach(&s, PlayerId(2));
    let hp = s.w.players[1].vitals.hp;
    s.step();
    let expected = crate::constants::PVP_DOT_CAP_SHARE
        * s.w.players[1].vitals.max_hp
        * (crate::constants::TICK_MS / 1000.);
    assert_eq!(s.w.players[1].vitals.hp, hp - expected);
    assert_eq!(s.w.abilities.as_ref().unwrap().dot[0].amount, expected);
    let saved = serde_json::to_value(&s).unwrap();
    let mut restored = Sim::restore(saved).unwrap();
    for _ in 0..3 {
        assert_eq!(s.step(), restored.step());
        assert_eq!(s.state_hash(), restored.state_hash());
    }
    // Projection observes only reports after attach; gap intentionally discards earlier private history.
    projector.feed(s.fx_report()).unwrap();
}
#[test]
fn zone_boundary_and_owner_departure_use_the_scheduled_field_lifecycle() {
    let mut s = sim();
    let mut ev = Vec::new();
    let source = a(&s, StatusKind::Stun).source;
    let zone = rt::Field {
        id: 0,
        kind: rt::FieldKind::Zone,
        ability: rt::AbilityId::Trial,
        owner: source.clone(),
        subject: Some(PlayerId(2)),
        x: 406.,
        y: 400.,
        x2: 0.,
        y2: 0.,
        r: 50.,
        vx: 0.,
        vy: 0.,
        started_at: 0.,
        ends_at: 5000.,
        exit_stun_ms: None,
    };
    let id = super::super::fields::add(&mut s.w, zone);
    let mut zoned = a(&s, StatusKind::Zoned);
    zoned.data = Some(rt::Payload {
        field_id: Some(id),
        move_mult: Some(0.7),
        ..Default::default()
    });
    add(&mut s, PlayerId(2), zoned, &mut ev);
    s.step();
    assert_eq!(s.w.abilities.as_ref().unwrap().fields.len(), 1);
    s.w.players[1].body.x += 0.001;
    s.step();
    assert!(s.w.abilities.as_ref().unwrap().fields.is_empty());
    assert!(rt::has(
        &s.w.players[1].statuses.instances,
        StatusKind::Stun,
        s.w.server_time
    ));
    let trail = rt::Field {
        id: 0,
        kind: rt::FieldKind::Trail,
        ability: rt::AbilityId::Blaze,
        owner: source,
        subject: None,
        x: 200.,
        y: 200.,
        x2: 220.,
        y2: 200.,
        r: 20.,
        vx: 0.,
        vy: 0.,
        started_at: s.w.server_time,
        ends_at: 5000.,
        exit_stun_ms: None,
    };
    super::super::fields::add(&mut s.w, trail);
    s.remove_player(PlayerId(1));
    assert_eq!(s.w.abilities.as_ref().unwrap().fields.len(), 1);
    let mut removed = Vec::new();
    super::super::fields::remove_into(&mut s.w, rt::FieldSelector::All, &mut removed);
    assert_eq!(removed.len(), 1);
    assert!(s.w.abilities.as_ref().unwrap().fields.is_empty());
}

/// The abilities chain on the staggered hook: a Wish lists stun and silence alone, so a sword stagger never
/// wastes it; a definition that lists stagger is interrupted at once (the legacy cancelIf rule).
#[test]
fn the_staggered_hook_interrupts_only_casts_that_list_it() {
    let ps = [
        Placement {
            profile: "caster".into(),
            faction: FactionId::Sentenced,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: Some(500.),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        },
        Placement {
            profile: "foe".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(430., 400.),
            hp: Some(500.),
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut s = Sim::reset_active(
        SimConfig {
            quests: false,
            abilities: crate::abilities::Mode::Full,
            wish_lock_ms: 0.,
            ..SimConfig::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(4),
        &ps,
    );
    let caster = s.w.players[0].id;
    let foe = s.w.players[1].id;
    let command = validate(RawCommand::Cast {
        slot: crate::abilities::Slot::Wish,
        x: 430.,
        y: 400.,
        id: Some(foe),
        t: None,
        seq: None,
    })
    .unwrap();
    assert!(s.submit(caster, command).is_ok());
    s.step();
    let pending = s.w.players[0]
        .statuses
        .cast
        .expect("the Trial cast is pending");
    assert!(
        !pending.cancelled_by.stagger,
        "a Wish does not list stagger"
    );
    s.take_events();
    s.with_cx(|cx| {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: cx.stats,
                fx: None,
                k: cx.k,
                w: &mut *cx.w,
                ev: &mut *cx.ev,
            },
            crate::hooks::HookArgs::Staggered { id: caster },
        );
    });
    assert_eq!(
        s.w.players[0].statuses.cast.map(|c| c.started_at),
        Some(pending.started_at),
        "the Wish survives a sword stagger"
    );
    assert!(!s
        .take_events()
        .iter()
        .any(|e| matches!(e, crate::Event::CastEnded { .. })));
    // A cast whose definition lists stagger is interrupted at once (the generic cancelIf rule).
    s.w.players[0]
        .statuses
        .cast
        .as_mut()
        .unwrap()
        .cancelled_by
        .stagger = true;
    s.with_cx(|cx| {
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: cx.stats,
                fx: None,
                k: cx.k,
                w: &mut *cx.w,
                ev: &mut *cx.ev,
            },
            crate::hooks::HookArgs::Staggered { id: caster },
        );
    });
    assert!(s.w.players[0].statuses.cast.is_none());
    assert!(s.take_events().iter().any(|e| matches!(
        e,
        crate::Event::CastEnded {
            reason: crate::status_runtime::CastEndReason::Interrupted,
            ..
        }
    )));
}
