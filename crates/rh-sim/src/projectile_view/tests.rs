use super::*;
use crate::{
    Arena, FactionId, ItemObserver, Placement, RawCommand, Secrets, SimConfig, TileMap, Vec2,
    WeaponId,
};
fn shot() -> Sim {
    let rows: Vec<_> = (0..24)
        .map(|y| {
            if y == 0 || y == 23 {
                "#".repeat(60)
            } else {
                format!("#{}#", ".".repeat(58))
            }
        })
        .collect();
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        // Bootstrap at the eventual viewer position, so its legitimate sight trail
        // never included the distant launch origin.
        spawns: vec![Vec2::new(1300., 320.)],
    };
    let mut s = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(1),
        &[
            Placement {
                profile: "archer".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(320., 320.),
                hp: None,
                weapon0: Some(WeaponId::Bow),
                weapon1: None,
            },
            Placement {
                profile: "viewer".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(1300., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    );
    s.submit(
        PlayerId(1),
        crate::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    for _ in 0..20 {
        s.step();
        if !s.w.projectiles.is_empty() {
            return s;
        }
    }
    panic!("ordinary Attack did not launch")
}
/// The shot until the viewer first sees it, observed (and committed) every tick by `o`.
fn first_seen(s: &mut Sim, o: &mut ItemObserver, out: &mut Observation) {
    o.observe_into(s, &[], out, None).unwrap();
    assert!(out.projectiles.is_empty(), "unseen flight point leaked");
    for _ in 0..8 {
        s.step();
        o.observe_into(s, &[], out, None).unwrap();
        if !out.projectiles.is_empty() {
            return;
        }
    }
    panic!("the flight never entered sight");
}
#[test]
fn flight_point_visibility_owner_redaction_multiplicity_and_bounds() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    first_seen(&mut s, &mut o, &mut out);
    assert_eq!(out.projectiles.len(), 1);
    assert_eq!(out.projectiles[0].owner, None);
    assert!(
        !out.visible.iter().any(|a| a.id == PlayerId(1)),
        "owner unexpectedly visible"
    );
    let canonical = out.projectiles[0];
    // The first track this viewer ever sees is 1, whatever the match launched before; it is anchored where it entered sight.
    assert_eq!(canonical.track, 1);
    assert_eq!(
        canonical.anchor,
        ProjectileAnchor {
            tick: s.tick(),
            x: canonical.x,
            y: canonical.y,
            facing: canonical.facing,
            speed: canonical.speed,
        }
    );
    let mut flight = s.w.projectiles[0];
    flight.launch.id += 1000;
    s.w.projectiles.push(flight);
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(
        out.projectiles,
        vec![
            canonical,
            ProjectileView {
                track: 2,
                ..canonical
            }
        ],
        "identical visible records were deduplicated or renumbered"
    );
    s.w.projectiles.resize(MAX_VISIBLE_PROJECTILES + 1, flight);
    assert!(matches!(
        o.prepare_into(&s, &[], &mut out, None),
        Err(OfferError::TooManyProjectiles)
    ));
    s.w.projectiles.truncate(1);
    s.w.projectiles[0].velocity.x = f64::INFINITY;
    assert!(matches!(
        o.prepare_into(&s, &[], &mut out, None),
        Err(OfferError::ProjectileGeometryOutOfRange)
    ));
}
#[test]
fn a_straight_flight_keeps_its_track_and_anchor_and_the_anchor_predicts_it() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    first_seen(&mut s, &mut o, &mut out);
    let first = out.projectiles[0];
    let mut flown = 0;
    for _ in 0..6 {
        s.step();
        o.observe_into(&s, &[], &mut out, None).unwrap();
        let Some(&row) = out.projectiles.first() else {
            break;
        };
        flown += 1;
        assert_eq!((row.track, row.anchor), (first.track, first.anchor));
        assert_ne!((row.x, row.y), (first.x, first.y), "the flight moved");
        let (x, y) = row.anchor.at(f64::from(s.tick()));
        let actual = s.w.projectiles[0].pos;
        assert!(
            crate::math::hypot(x - actual.x, y - actual.y) <= TRACK_TOLERANCE,
            "the client's straight line drifted from the flight"
        );
    }
    assert!(flown >= 3);
}
#[test]
fn a_turn_reanchors_the_same_track_and_reentry_issues_a_new_one() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    first_seen(&mut s, &mut o, &mut out);
    let first = out.projectiles[0];
    // A homing turn: the flight leaves its anchored line.
    s.w.projectiles[0].pos.y += 4.;
    o.observe_into(&s, &[], &mut out, None).unwrap();
    let turned = out.projectiles[0];
    assert_eq!(turned.track, first.track);
    assert_ne!(turned.anchor, first.anchor);
    assert_eq!((turned.anchor.x, turned.anchor.y), (turned.x, turned.y));
    // Out of sight for one scene: the next sighting is a new track, anchored at that sighting only.
    let flight = s.w.projectiles.pop().unwrap();
    s.step();
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert!(out.projectiles.is_empty());
    s.w.projectiles.push(flight);
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(out.projectiles[0].track, first.track + 1);
    assert_eq!(out.projectiles[0].anchor.tick, s.tick());
}
#[test]
fn an_undelivered_scene_consumes_no_alias_and_epochs_keep_the_counter() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    o.observe_into(&s, &[], &mut out, None).unwrap();
    while out.projectiles.is_empty() {
        s.step();
        // Prepared but never delivered: dropping the offer must not bind or number anything.
        drop(o.prepare_into(&s, &[], &mut out, None).unwrap());
    }
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(out.projectiles[0].track, 1);
    let renewed = o.renewed();
    let mut fresh = Observation::default();
    let mut replacement = renewed;
    replacement.observe_into(&s, &[], &mut fresh, None).unwrap();
    assert_eq!(
        fresh.projectiles[0].track, 2,
        "a renewed epoch never reuses an alias"
    );
    o.reconnect();
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(
        out.projectiles[0].track, 2,
        "a reconnect never reuses an alias"
    );
}
#[test]
fn new_tracks_are_numbered_by_public_rows_not_private_launch_order() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    first_seen(&mut s, &mut o, &mut out);
    let mut near = s.w.projectiles[0];
    near.pos.x += 10.;
    let mut far = s.w.projectiles[0];
    far.pos.x += 50.;
    let mut rows = Vec::new();
    for (ids, flip) in [((7, 9), false), ((9, 7), true)] {
        let mut copy = s.clone();
        let (mut a, mut b) = (near, far);
        a.launch.id = ids.0;
        b.launch.id = ids.1;
        copy.w.projectiles = if flip { vec![b, a] } else { vec![a, b] };
        let mut fresh = ItemObserver::new(PlayerId(2));
        let mut seen = Observation::default();
        fresh.observe_into(&copy, &[], &mut seen, None).unwrap();
        rows.push(seen.projectiles);
    }
    assert_eq!(
        rows[0], rows[1],
        "private serial/order changed presentation"
    );
    assert_eq!(rows[0].iter().map(|r| r.track).collect::<Vec<_>>(), [1, 2]);
    assert!(rows[0][0].x < rows[0][1].x);
}
#[test]
fn owner_uses_shared_reference_projection_and_reflection_omits_it() {
    let mut s = shot();
    let mut raw = Observation::default();
    crate::observe::observe_with(&s, PlayerId(1), &[], &mut raw, None).unwrap();
    let mut tracks = ProjectileTracks::default();
    project(&s, PlayerId(1), &mut raw, &mut tracks).unwrap();
    assert_eq!(raw.projectiles[0].owner, Some(PlayerId(1)));
    // Exercise the shared final reference mapper, independent of launch identity/physics.
    let before = raw.projectiles[0];
    crate::actor_refs::project(&mut raw, |id| Some(PlayerId(id.0 + (1 << 31))));
    assert_eq!(raw.projectiles[0].owner, Some(PlayerId((1 << 31) + 1)));
    assert_eq!(
        (before.kind, before.x, before.y, before.facing),
        (
            raw.projectiles[0].kind,
            raw.projectiles[0].x,
            raw.projectiles[0].y,
            raw.projectiles[0].facing
        )
    );
    s.w.projectiles[0].launch.reflected = true;
    project(&s, PlayerId(1), &mut raw, &mut tracks).unwrap();
    assert_eq!(raw.projectiles[0].owner, None);
}
