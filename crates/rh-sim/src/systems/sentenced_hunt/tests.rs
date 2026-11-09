#![cfg(test)]
use super::*;
use crate::input::{validate, RawCommand};
use crate::results::Outcome;
use crate::state::Phase;
use crate::{FactionMode, Placement, Secrets, Sim, SimConfig, Vec2, WeaponId};

fn scene() -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(12),
        &[
            Placement {
                profile: "hunter".into(),
                faction: FactionId::Sentenced,
                bot: false,
                at: Vec2::new(400., 320.),
                hp: None,
                weapon0: Some(WeaponId::Bow),
                weapon1: None,
            },
            Placement {
                profile: "rival".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(460., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "other".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(520., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    )
}

fn hunt(s: &mut Sim, id: crate::PlayerId) -> Vec<Event> {
    s.submit(
        crate::PlayerId(1),
        validate(RawCommand::HuntTarget { id }).unwrap(),
    )
    .unwrap();
    s.step()
}

#[test]
fn selecting_a_living_target_is_sticky_and_dead_targets_can_be_replaced() {
    let mut s = scene();
    let ev = hunt(&mut s, crate::PlayerId(2));
    assert_eq!(s.players()[0].hunt_target(), Some(crate::PlayerId(2)));
    assert!(ev
        .iter()
        .any(|e| matches!(e, Event::MarkNotice { recipient, notice: MarkNotice::Hunting { target } } if *recipient == crate::PlayerId(1) && *target == crate::PlayerId(2))));

    hunt(&mut s, crate::PlayerId(3));
    assert_eq!(s.players()[0].hunt_target(), Some(crate::PlayerId(2)));

    let mut ev = Vec::new();
    crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, Outcome::Died);
    assert_eq!(s.players()[0].hunt_target(), None);
    assert_eq!(s.players()[0].hunt_stacks, 1);
    assert!(ev.iter().any(|e| matches!(e, Event::MarkNotice { recipient, notice: MarkNotice::HuntComplete { stacks: 1 } } if *recipient == crate::PlayerId(1))));
}

#[test]
fn mia_and_the_hunters_own_death_clear_without_a_stack() {
    let mut s = scene();
    hunt(&mut s, crate::PlayerId(2));
    let mut ev = Vec::new();
    crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 1, Outcome::Mia);
    assert_eq!(s.players()[0].hunt_target(), None);
    assert_eq!(s.players()[0].hunt_stacks, 0);
    assert!(!ev.iter().any(|e| matches!(
        e,
        Event::MarkNotice {
            notice: MarkNotice::HuntComplete { .. },
            ..
        }
    )));

    let mut s = scene();
    hunt(&mut s, crate::PlayerId(2));
    let mut ev = Vec::new();
    crate::systems::settle::down_player(&s.k, &mut s.w, &mut ev, None, 0, Outcome::Died);
    assert_eq!(s.players()[0].hunt_target(), None);
    assert_eq!(s.players()[0].hunt_stacks, 0);
}

#[test]
fn movement_bonus_uses_the_next_path_leg_toward_the_living_rival() {
    let mut s = scene();
    s.w.players[0].set_hunt_target(Some(crate::PlayerId(2)));
    s.w.players[0].body.x = 300.;
    s.w.players[0].body.y = 400.;
    s.w.players[1].body.x = 600.;
    s.w.players[1].body.y = 400.;
    let stats = crate::status_runtime::StatView::default();
    let at = |s: &mut Sim, p: Vec2| {
        s.w.players[0].motion.path.set_from(&[p]);
        movement(&s.k, &s.w, FighterIx(0), TICK_MS, stats)
    };
    assert_eq!(at(&mut s, Vec2::new(450., 400.)), 1.05);
    assert_eq!(at(&mut s, Vec2::new(200., 400.)), 1.);
    assert_eq!(at(&mut s, Vec2::new(300., 600.)), 1.);
    s.w.players[0].motion.path.clear();
    assert_eq!(movement(&s.k, &s.w, FighterIx(0), TICK_MS, stats), 1.);
}

#[test]
fn selected_actor_is_visible_through_fog_but_neighbours_are_not() {
    let mut s = scene();
    s.w.players[0].body.x = 300.;
    s.w.players[0].body.y = 400.;
    s.w.players[1].body.x = 2100.;
    s.w.players[1].body.y = 400.;
    s.w.players[2].body.x = 2100.;
    s.w.players[2].body.y = 400.;
    s.w.players[0].set_hunt_target(Some(crate::PlayerId(2)));
    let map = s.k.collision_view(false);
    let tick = s.tick();
    assert!(crate::vision::actor_with(
        map,
        &s.w.players[0],
        &s.w.players[1],
        tick,
        crate::vision::WardSight::of(&s.k, &s.w),
        || true
    ));
    assert!(!crate::vision::actor_with(
        map,
        &s.w.players[0],
        &s.w.players[2],
        tick,
        crate::vision::WardSight::of(&s.k, &s.w),
        || true
    ));
    s.w.players[1].status = crate::Status::Dead;
    assert!(!crate::vision::actor_with(
        map,
        &s.w.players[0],
        &s.w.players[1],
        tick,
        crate::vision::WardSight::of(&s.k, &s.w),
        || true
    ));
}

#[test]
fn completed_hunts_scale_mark_strength_and_run_end_clears_selections() {
    let mut s = scene();
    let base = crate::modifiers::mark_pulse(&s.players()[0], WeaponId::Bow, 1000., true);
    s.w.players[0].hunt_stacks = 5;
    let boosted = crate::modifiers::mark_pulse(&s.players()[0], WeaponId::Bow, 1000., true);
    assert!((boosted - base * 1.1).abs() < 1e-12);
    s.w.players[0].set_hunt_target(Some(crate::PlayerId(2)));
    let mut ev = Vec::new();
    let mut hx = crate::hooks::Hx {
        stats: Default::default(),
        fx: None,
        k: &s.k,
        w: &mut s.w,
        ev: &mut ev,
    };
    run_ended(&mut hx, &HookArgs::RunEnded);
    assert_eq!(s.players()[0].hunt_target(), None);
    assert_eq!(s.players()[0].hunt_stacks, 5);
}

#[test]
fn hunt_target_is_refused_outside_an_active_sentenced_run_and_for_self() {
    let mut s = scene();
    s.w.phase = Phase::Ended;
    hunt(&mut s, crate::PlayerId(2));
    assert_eq!(s.players()[0].hunt_target(), None);
    s.w.phase = Phase::Active;
    hunt(&mut s, crate::PlayerId(1));
    assert_eq!(s.players()[0].hunt_target(), None);
    s.w.players[0].vitals.faction = FactionId::Fire.into();
    hunt(&mut s, crate::PlayerId(2));
    assert_eq!(s.players()[0].hunt_target(), None);
}
