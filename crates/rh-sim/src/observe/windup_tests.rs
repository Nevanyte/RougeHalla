//! Protocol-15 windup projection: a visible actor's ranged draw or cast, nothing for a melee swing or an unseen actor.
use super::*;
use crate::{Placement, RawCommand, Secrets, SimConfig, Vec2};

fn duel(weapon: WeaponId, other_x: f64) -> Sim {
    let mut arena = crate::arenas::practice_arena();
    arena.spawns = vec![Vec2::new(100., 176.)];
    let placements = [(100., "viewer", None), (other_x, "attacker", Some(weapon))]
        .into_iter()
        .map(|(x, profile, weapon0)| Placement {
            profile: profile.into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(x, 176.),
            hp: None,
            weapon0,
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

/// The attacker's windup as viewer 1 sees it over the ticks after one Attack aimed at `a`.
fn windups(weapon: WeaponId, other_x: f64, a: f64) -> Vec<Option<WindupView>> {
    let mut s = duel(weapon, other_x);
    s.submit(
        PlayerId(2),
        crate::validate(RawCommand::Attack { a, t: None }).unwrap(),
    )
    .unwrap();
    (0..14)
        .map(|_| {
            s.step();
            let out = observe(&s, PlayerId(1), &[]);
            let seen = out.visible.iter().find(|v| v.id == PlayerId(2));
            assert_eq!(seen.is_some(), other_x < 200., "attacker visibility");
            let shown = seen.and_then(|v| v.windup);
            // The viewer's own record never gains a second, private copy.
            assert!(out.visible.iter().all(|v| v.id != PlayerId(1)));
            shown
        })
        .collect()
}

#[test]
fn a_visible_wand_cast_shows_its_aim_and_release_time_then_clears() {
    let seen = windups(WeaponId::Wand, 150., 0.5);
    let first = seen.iter().flatten().next().copied().expect("cast shown");
    assert_eq!(first.kind, WindupKind::Cast);
    assert_eq!(first.a, Some(0.5));
    assert!(first.lands_at > first.started_at);
    // One cast reads the same every tick until it releases (a held attack may start the next one later).
    let run: Vec<_> = seen
        .iter()
        .skip_while(|w| w.is_none())
        .take_while(|w| w.is_some())
        .collect();
    assert!(run.len() < seen.len(), "the cast released and cleared");
    assert!(run.iter().all(|w| **w == Some(first)));
}

#[test]
fn a_visible_bow_draw_shows_no_aim() {
    let seen = windups(WeaponId::Bow, 150., 0.5);
    let first = seen.iter().flatten().next().copied().expect("draw shown");
    assert_eq!(first.kind, WindupKind::Draw);
    assert_eq!(first.a, None);
    assert!(first.lands_at > first.started_at);
}

#[test]
fn melee_and_unseen_windups_are_not_shown() {
    assert!(windups(WeaponId::Sword, 150., 0.5)
        .iter()
        .all(Option::is_none));
    assert!(windups(WeaponId::Wand, 300., 0.5)
        .iter()
        .all(Option::is_none));
}

/// Pins CURRENT behaviour, not a decision: an actor that enters sight mid-draw publishes the draw's true `started_at`,
/// a time from before the viewer could see it (legacy did the same). Inherited-legacy exposure recorded for the records
/// owner; change it only together with that record.
#[test]
fn an_actor_entering_sight_mid_draw_shows_the_true_start_time() {
    let mut s = duel(WeaponId::Bow, 300.);
    s.submit(
        PlayerId(2),
        crate::validate(RawCommand::Attack { a: 0.5, t: None }).unwrap(),
    )
    .unwrap();
    let mut unseen_ticks = 0;
    for _ in 0..3 {
        s.step();
        let out = observe(&s, PlayerId(1), &[]);
        assert!(out.visible.iter().all(|v| v.id != PlayerId(2)), "unseen");
        if s.player(PlayerId(2)).unwrap().weapon.action.is_some() {
            unseen_ticks += 1;
        }
    }
    assert!(unseen_ticks >= 2, "the draw ran while unseen");
    let action = s
        .player(PlayerId(2))
        .unwrap()
        .weapon
        .action
        .expect("still drawing");
    let entered = s.server_time();
    assert!(action.started_at < entered - crate::constants::TICK_MS);
    // Into sight mid-draw (a placement, not a walk: the draw keeps running).
    let now = s.w.server_time;
    let p = s.w.players.get_mut(PlayerId(2)).unwrap();
    p.body.x = 150.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: 150.,
        y: 176.,
    });
    let out = observe(&s, PlayerId(1), &[]);
    let shown = out
        .visible
        .iter()
        .find(|v| v.id == PlayerId(2))
        .expect("entered sight")
        .windup
        .expect("mid-draw windup shown");
    assert_eq!(shown.kind, WindupKind::Draw);
    assert_eq!(shown.started_at, action.started_at, "true start published");
    assert_eq!(shown.lands_at, action.lands_at);
}
