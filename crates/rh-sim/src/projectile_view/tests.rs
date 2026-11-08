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
#[test]
fn flight_point_visibility_owner_redaction_multiplicity_and_bounds() {
    let mut s = shot();
    let mut o = ItemObserver::new(PlayerId(2));
    let mut out = Observation::default();
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert!(out.projectiles.is_empty(), "unseen flight point leaked");
    for _ in 0..8 {
        s.step();
        o.observe_into(&s, &[], &mut out, None).unwrap();
        if !out.projectiles.is_empty() {
            break;
        }
    }
    assert_eq!(out.projectiles.len(), 1);
    assert_eq!(out.projectiles[0].owner, None);
    assert!(
        !out.visible.iter().any(|a| a.id == PlayerId(1)),
        "owner unexpectedly visible"
    );
    let canonical = out.projectiles[0];
    let flight = s.w.projectiles[0];
    s.w.projectiles.push(flight);
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(
        out.projectiles,
        vec![canonical, canonical],
        "identical visible records were deduplicated"
    );
    s.w.projectiles[0].launch.id = 999;
    s.w.projectiles[1].launch.id = 99;
    s.w.projectiles.swap(0, 1);
    o.observe_into(&s, &[], &mut out, None).unwrap();
    assert_eq!(
        out.projectiles,
        vec![canonical, canonical],
        "private serial/order changed presentation"
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
fn owner_uses_shared_reference_projection_and_reflection_omits_it() {
    let mut s = shot();
    let mut raw = Observation::default();
    crate::observe::observe_with(&s, PlayerId(1), &[], &mut raw, None).unwrap();
    project(&s, PlayerId(1), &mut raw).unwrap();
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
    project(&s, PlayerId(1), &mut raw).unwrap();
    assert_eq!(raw.projectiles[0].owner, None);
}
