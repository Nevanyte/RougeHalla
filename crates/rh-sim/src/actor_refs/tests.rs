use super::*;
use crate::{
    Arena, FactionId, ItemObserver, Placement, PublicCommand, RawCommand, Secrets, Sim, SimConfig,
    TileMap, Vec2, WeaponId,
};
fn world() -> Sim {
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
    let arena = Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    };
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-source.json")).unwrap();
    let c = &f["cases"][2];
    let placements: Vec<_> = c["input"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("name{i}"),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    Sim::reset_active(
        SimConfig {
            quests: false,
            consumables: true,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        secrets,
        &placements,
    )
}
fn place(s: &mut Sim, id: PlayerId, at: Vec2) {
    let now = s.w.server_time;
    let p = s.w.players.get_mut(id).unwrap();
    p.body.x = at.x;
    p.body.y = at.y;
    p.motion.path.clear();
    p.inputs.clear();
    p.weapon.held = false;
    p.weapon.targeting = Default::default();
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}
fn observe(s: &Sim, o: &mut ItemObserver) -> Observation {
    let mut out = Observation::default();
    o.observe_into(s, &[], &mut out, None).unwrap();
    out
}
fn cycle_pair() -> (Sim, Sim) {
    let mut a = world();
    let mut b = world();
    b.seed_weapon_container(
        crate::ContainerKind::Ground,
        Vec2::new(144., 112.),
        &[WeaponId::Axe],
    )
    .unwrap();
    for id in [1, 2] {
        place(&mut b, PlayerId(id), Vec2::new(624., 624.));
    }
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/mob-pve-source.json")).unwrap();
    for frame in f["cases"][2]["frames"].as_array().unwrap() {
        for cmd in frame["commands"].as_array().unwrap() {
            let id = PlayerId(cmd["actor"].as_str().unwrap()[1..].parse::<u32>().unwrap() + 1);
            let target =
                PlayerId(3 + u32::from_str_radix(&cmd["id"].as_str().unwrap()[3..], 36).unwrap());
            a.submit(
                id,
                crate::validate(RawCommand::Target { id: target }).unwrap(),
            )
            .unwrap();
        }
        a.step();
        b.step();
    }
    assert_eq!(a.camp_rosters()[0].state, 2);
    for id in [1, 2] {
        place(&mut a, PlayerId(id), Vec2::new(624., 624.));
    }
    while a.camp_rosters()[0].state == 2 {
        assert!(a.tick() < 5000, "camp never respawned");
        a.step();
        b.step();
    }
    assert_ne!(a.mobs()[0].core.id, b.mobs()[0].core.id);
    assert_eq!(a.tick(), b.tick());
    // Complete the comparison's declared public scene using existing fixture APIs;
    // keep the genuinely different historical birth records and private allocation counts.
    for i in 0..2 {
        b.w.players[i].vitals.hp = a.w.players[i].vitals.hp;
        b.w.players[i].body.facing = a.w.players[i].body.facing;
    }
    place(&mut a, PlayerId(3), Vec2::new(80., 112.));
    place(&mut b, PlayerId(3), Vec2::new(80., 112.));
    Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    Sim::restore(serde_json::to_value(&b).unwrap()).unwrap();
    (a, b)
}
#[test]
fn actual_hidden_respawn_history_does_not_change_scene_references_or_fx() {
    let (a, b) = cycle_pair();
    let mut oa = ItemObserver::new(PlayerId(3));
    let mut ob = ItemObserver::new(PlayerId(3));
    let mut initial = world();
    place(&mut initial, PlayerId(3), Vec2::new(80., 112.));
    let old = observe(&initial, &mut oa);
    assert_eq!(old, observe(&initial, &mut ob));
    let old_reference = old
        .visible
        .iter()
        .find(|r| r.kind == crate::observe::ActorKind::Regional)
        .unwrap()
        .id;
    let aa = observe(&a, &mut oa);
    let bb = observe(&b, &mut ob);
    assert_eq!(aa, bb);
    assert_eq!(
        oa.resolve(
            &a,
            PublicCommand::Target {
                actor: old_reference
            }
        )
        .unwrap(),
        crate::validate(RawCommand::MissingTarget).unwrap()
    );
    assert_ne!(
        ob.resolve(
            &b,
            PublicCommand::Target {
                actor: old_reference
            }
        )
        .unwrap(),
        crate::validate(RawCommand::MissingTarget).unwrap()
    );
    let mut aa = Observation::default();
    let mut bb = Observation::default();
    let ea = [SeenEvent::Hit {
        victim: a.mobs()[0].core.id,
        by: Some(PlayerId(3)),
        amount: 2.,
        passive: false,
    }];
    let eb = [SeenEvent::Hit {
        victim: b.mobs()[0].core.id,
        by: Some(PlayerId(3)),
        amount: 2.,
        passive: false,
    }];
    oa.prepare_with_seen(&a, &[], &ea, &mut aa, None)
        .unwrap()
        .commit();
    ob.prepare_with_seen(&b, &[], &eb, &mut bb, None)
        .unwrap()
        .commit();
    assert_eq!(aa, bb);
    let reference = aa
        .visible
        .iter()
        .find(|r| r.kind == crate::observe::ActorKind::Regional)
        .unwrap()
        .id;
    assert!(u64::from(reference.0) >= NPC_REFERENCE_BASE);
    assert_ne!(
        oa.resolve(&a, PublicCommand::Target { actor: reference })
            .unwrap(),
        ob.resolve(&b, PublicCommand::Target { actor: reference })
            .unwrap()
    );
}
#[test]
fn fixed_blocks_commit_grace_and_reconnect_preserve_exact_clicks() {
    let mut s = world();
    let mut o = ItemObserver::new(PlayerId(1));
    let mut dropped = Observation::default();
    drop(o.prepare_into(&s, &[], &mut dropped, None).unwrap());
    let first = observe(&s, &mut o);
    assert_eq!(dropped, first);
    let reference = first
        .visible
        .iter()
        .find(|a| a.kind == crate::observe::ActorKind::Regional)
        .unwrap()
        .id;
    let command = o
        .resolve(&s, PublicCommand::Target { actor: reference })
        .unwrap();
    assert_eq!(first, observe(&s, &mut o));
    s.step();
    let second = observe(&s, &mut o);
    assert_eq!(
        u64::from(
            second
                .visible
                .iter()
                .find(|a| a.kind == crate::observe::ActorKind::Regional)
                .unwrap()
                .id
                .0
                - reference.0
        ),
        NPC_REFERENCE_BLOCK
    );
    assert_eq!(
        o.resolve(&s, PublicCommand::Target { actor: reference })
            .unwrap(),
        command
    );
    for _ in 0..20 {
        s.step();
    }
    assert_eq!(
        o.resolve(&s, PublicCommand::Target { actor: reference })
            .unwrap(),
        crate::validate(RawCommand::MissingTarget).unwrap()
    );
    o.reconnect();
    assert_eq!(
        o.resolve(&s, PublicCommand::Target { actor: reference })
            .unwrap(),
        crate::validate(RawCommand::MissingTarget).unwrap()
    );
    let renewed = observe(&s, &mut o);
    assert!(renewed
        .visible
        .iter()
        .filter(|a| a.kind == crate::observe::ActorKind::Regional)
        .all(|a| a.id > reference));
    let mut a = ItemObserver::new(PlayerId(3));
    let mut b = ItemObserver::new(PlayerId(3));
    observe(&s, &mut a);
    place(&mut s, PlayerId(3), Vec2::new(80., 112.));
    observe(&s, &mut b);
    s.step();
    let av = observe(&s, &mut a);
    let bv = observe(&s, &mut b);
    assert_eq!(
        av.visible, bv.visible,
        "intermediate scene size encoded in reference block"
    );
}
#[test]
fn all_actor_fields_use_one_projection_and_reference_bounds_fail_closed() {
    let mut s = world();
    let mut raw = Observation::default();
    crate::observe::observe_with(&s, PlayerId(1), &[], &mut raw, None).unwrap();
    let mob = s.mobs()[0].core.id;
    raw.me.as_mut().unwrap().attack_target = Some(mob);
    raw.visible[0].mark_by = Some(mob);
    raw.fields.push(crate::status_runtime::FieldView {
        kind: crate::status_runtime::FieldKind::Zone,
        ability: crate::status_runtime::AbilityId::Freeze,
        owner: Some(mob),
        subject: Some(PlayerId(999)),
        x: 0.,
        y: 0.,
        x2: 0.,
        y2: 0.,
        r: 1.,
        vx: 0.,
        vy: 0.,
        started_at: 0.,
        ends_at: 100.,
    });
    raw.events.push(SeenEvent::Hit {
        victim: mob,
        by: Some(PlayerId(99)),
        amount: 1.,
        passive: false,
    });
    let mut refs = ActorRefs::default();
    let stage = refs.stage(&s, &raw).unwrap();
    let reference = refs.map(&s, &stage, mob).unwrap();
    project(&mut raw, |id| refs.map(&s, &stage, id));
    assert_eq!(raw.me.unwrap().attack_target, Some(reference));
    assert_eq!(raw.fields[0].owner, Some(reference));
    assert_eq!(raw.fields[0].subject, None);
    assert!(raw.visible.iter().any(|r| r.mark_by == Some(reference)));
    assert_eq!(
        raw.events,
        vec![SeenEvent::Hit {
            victim: reference,
            by: None,
            amount: 1.,
            passive: false
        }]
    );
    refs.next = u64::from(u32::MAX) + 1 - 2 * NPC_REFERENCE_BLOCK;
    let stage = refs.stage(&s, &Observation::default()).unwrap();
    refs.commit(stage);
    s.step();
    assert!(matches!(
        refs.stage(&s, &Observation::default()),
        Err(crate::OfferError::ActorReferencesExhausted)
    ));
    let mut raw = Observation::default();
    crate::observe::observe_with(&s, PlayerId(1), &[], &mut raw, None).unwrap();
    let mob = raw
        .visible
        .iter()
        .find(|a| a.kind == crate::observe::ActorKind::Regional)
        .unwrap()
        .clone();
    raw.visible = vec![mob; NPC_REFERENCE_BLOCK as usize + 1];
    assert!(matches!(
        ActorRefs::default().stage(&s, &raw),
        Err(crate::OfferError::TooManyActors)
    ));
    s.w.actor_history.get_mut(PlayerId(1)).unwrap().id = PlayerId(NPC_REFERENCE_BASE as u32);
    assert!(matches!(
        ActorRefs::default().stage(&s, &Observation::default()),
        Err(crate::OfferError::ActorReferenceCollision)
    ));
}
