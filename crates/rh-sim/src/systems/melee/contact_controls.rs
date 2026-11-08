//! Native contact diagnostics: actual catalog births, with explicit body/weapon arrangements for the collision leaf.
use super::*;
use crate::{FactionId, Placement, Secrets, Sim, SimConfig};
fn sim() -> Sim {
    let data =
        serde_json::from_str(include_str!("../../../tests/fixtures/mob-pve-map.json")).unwrap();
    let arena = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let mut s = Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(1),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Plague,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        }],
    );
    for m in s.w.mobs.iter_mut() {
        m.core.body.x = 800.;
        m.core.body.y = 800.;
        m.core.body.history.reset(crate::state::Sample {
            t: s.w.server_time,
            x: 800.,
            y: 800.,
        });
    }
    s
}
fn place(s: &mut Sim, id: PlayerId, at: Vec2, weapon: WeaponId, facing: f64) {
    let now = s.w.server_time;
    let ix = s.w.fighter_idx(id).unwrap();
    let p = s.w.core_mut(ix);
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = facing;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
    p.weapon.weapon0 = Some(weapon);
    p.weapon.slot = 0;
}
fn swing(s: &mut Sim, by: PlayerId, weapon: WeaponId) -> Vec<Event> {
    s.s.melee.push(MeleeReq {
        attacker: by,
        weapon,
        a: 0.,
        rewind_t: s.w.server_time,
        packet: Packet {
            raw: 20.,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
    });
    let mut events = vec![];
    resolve(&mut Cx {
        stats: Default::default(),
        #[cfg(feature = "trusted-status-probes")]
        probe: None,
        k: &s.k,
        w: &mut s.w,
        s: &mut s.s,
        ev: &mut events,
        pf: &mut s.pf,
    });
    events
}
#[test]
fn ordinary_camp_mates_meet_and_riposte_with_zero_scaled_entries() {
    for weapon in [WeaponId::Sword, WeaponId::Shield] {
        let mut s = sim();
        let a = s.w.mobs.as_slice()[0].core.id;
        let b = s.w.mobs.as_slice()[1].core.id;
        assert_eq!(s.w.mobs.get(a).unwrap().camp, s.w.mobs.get(b).unwrap().camp);
        place(
            &mut s,
            PlayerId(1),
            Vec2::new(900., 900.),
            WeaponId::Sword,
            0.,
        );
        place(&mut s, a, Vec2::new(112., 112.), weapon, 0.);
        place(
            &mut s,
            b,
            Vec2::new(144., 112.),
            WeaponId::Shield,
            std::f64::consts::PI,
        );
        let events = swing(&mut s, a, weapon);
        assert!(events
            .iter()
            .any(|e| matches!(e,Event::Block{id,by,..}if *id==b&&*by==a)));
        assert_eq!(
            s.s.ledger.len(),
            if weapon == WeaponId::Sword { 2 } else { 1 }
        );
        assert!(s.s.ledger.iter().all(|e| e.scale == 0.));
        if weapon == WeaponId::Sword {
            assert!(s.s.ledger[0].passive);
            assert_eq!(s.s.ledger[0].victim, a);
        }
    }
}
#[test]
fn allied_zombie_is_transparent_before_per_target_card_mutation() {
    let mut s = sim();
    crate::systems::plague_zombies::raise_or_grow(&s.k, &mut s.w, PlayerId(1));
    let z = crate::systems::plague_zombies::zombie_of(&s.w, PlayerId(1)).unwrap();
    place(
        &mut s,
        PlayerId(1),
        Vec2::new(112., 112.),
        WeaponId::Sword,
        0.,
    );
    place(
        &mut s,
        z,
        Vec2::new(144., 112.),
        WeaponId::Shield,
        std::f64::consts::PI,
    );
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        crate::cards::CardId::PlantYourFeet
    ));
    s.w.server_time += crate::constants::PLANT_FEET_MS;
    assert!(crate::cards::plant_armed(&s.w.players[0], s.w.server_time));
    let before = s.w.players[0].card_runtime;
    let events = swing(&mut s, PlayerId(1), WeaponId::Sword);
    assert!(s.s.ledger.is_empty());
    assert!(!events.iter().any(|e| matches!(e, Event::Block { .. })));
    assert_eq!(s.w.players[0].card_runtime, before);
    assert!(crate::cards::plant_armed(&s.w.players[0], s.w.server_time));
}
