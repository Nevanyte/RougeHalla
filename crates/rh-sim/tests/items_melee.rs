//! Public inputs drive the same swaps, pickups, hits and drops as a recorded match.
use rh_sim::arenas::practice_arena;
use rh_sim::constants::{AXE_SHRED_CAP, RIPOSTE_SHARE, SHIELD_BLOCK_SHARE};
use rh_sim::events::Event;
use rh_sim::replay::{apply_input, run_replay, Recorder, ReplayInput, ReplayStart};
use rh_sim::{
    observe, validate, ContainerKind, FactionId, PickupRefusal, Placement, PlayerId, RawCommand,
    Secrets, SeenEvent, Sim, SimConfig, Vec2, WeaponId,
};
use WeaponId::*;

fn player(n: u32, x: f64, slots: [Option<WeaponId>; 2]) -> Placement {
    Placement {
        profile: format!("p{n}"),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 400.0),
        hp: None,
        weapon0: slots[0],
        weapon1: slots[1],
    }
}
fn world(ps: &[Placement], specials: bool) -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: true,
            weapon_specials: specials,
            ..Default::default()
        },
        practice_arena(),
        Secrets::from_seed(4),
        ps,
    )
}
fn order(s: &mut Sim, id: u32, raw: RawCommand) {
    s.submit(PlayerId(id), validate(raw).unwrap()).unwrap();
}
fn pickup(s: &mut Sim, id: u32) {
    order(s, 1, RawCommand::Pickup { container_id: id });
}
fn attack(s: &mut Sim, id: u32, a: f64) {
    order(s, id, RawCommand::Attack { a, t: None });
}
fn refusal(events: &[Event], why: PickupRefusal) -> bool {
    events.iter().any(
        |e| matches!(e, Event::PickupRefused { id: PlayerId(1), reason, .. } if *reason == why),
    )
}

#[test]
fn pickups_use_server_range_and_move_mask_and_refusals_are_owner_only() {
    let ps = [player(1, 756.0, [None; 2]), player(2, 710.0, [None; 2])];
    let mut s = world(&ps, true);
    let blocked = s
        .seed_weapon_container(ContainerKind::Ground, Vec2::new(812.0, 400.0), &[Bow])
        .unwrap();
    let far = s
        .seed_weapon_container(ContainerKind::Ground, Vec2::new(813.0, 400.0), &[Axe])
        .unwrap();
    assert!(s
        .seed_weapon_container(ContainerKind::Ground, ps[0].at, &[Fists])
        .is_err());
    pickup(&mut s, 99);
    pickup(&mut s, far);
    pickup(&mut s, blocked);
    let events = s.step();
    let reasons: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            Event::PickupRefused { reason, .. } => Some(*reason),
            _ => None,
        })
        .collect();
    assert_eq!(
        reasons,
        [
            PickupRefusal::NothingThere,
            PickupRefusal::TooFar,
            PickupRefusal::Unreachable
        ]
    );
    assert_eq!(
        observe(&s, PlayerId(1), &events)
            .events
            .iter()
            .filter(|e| matches!(e, SeenEvent::PickupRefused { .. }))
            .count(),
        3
    );
    assert!(observe(&s, PlayerId(2), &events).events.is_empty());
    assert!(s.player(PlayerId(1)).unwrap().weapon.weapon0.is_none());
}

#[test]
fn swapping_and_replacing_share_cooldown_and_a_new_drop_blocks_same_tick_guess() {
    let ps = [player(1, 400.0, [None; 2]), player(2, 480.0, [None; 2])];
    let mut s = world(&ps, true);
    for w in [Sword, Bow, Axe] {
        s.seed_weapon_container(ContainerKind::Ground, ps[0].at, &[w])
            .unwrap();
    }
    order(&mut s, 1, RawCommand::Swap { slot: None }); // neither slot has an item
    pickup(&mut s, 1);
    pickup(&mut s, 2);
    s.step();
    assert_eq!(s.players()[0].weapon.slot, 0);
    assert_eq!(s.players()[0].weapon.ready_at, 350.0); // only the hand pickup counts
    order(&mut s, 1, RawCommand::Swap { slot: Some(1) });
    pickup(&mut s, 3);
    pickup(&mut s, 4);
    let e = s.step();
    assert!(refusal(&e, PickupRefusal::NothingThere));
    let w = &s.players()[0].weapon;
    assert_eq!(
        (w.slot, w.weapon0, w.weapon1, w.ready_at),
        (1, Some(Sword), Some(Axe), 850.0)
    );
    assert_eq!(
        s.containers()[0].items[0].def,
        rh_sim::initial_world::ItemDef::Weapon(Bow)
    );
    assert_eq!(s.containers()[0].at, ps[0].at);
    pickup(&mut s, 4);
    s.step();
    assert_eq!(s.players()[0].weapon.weapon1, Some(Bow));
    assert_eq!(
        s.containers()[0].items[0].def,
        rh_sim::initial_world::ItemDef::Weapon(Axe)
    );
}

#[test]
fn body_from_leave_is_published_before_looting_and_remains_after_emptying() {
    let ps = [
        player(1, 400.0, [None; 2]),
        player(2, 410.0, [Some(Shield), Some(Wand)]),
        player(3, 480.0, [None; 2]),
    ];
    let mut s = world(&ps, true);
    s.remove_player(PlayerId(2));
    pickup(&mut s, 1);
    let first = s.step();
    assert!(refusal(&first, PickupRefusal::NothingThere));
    assert_eq!(s.containers()[0].kind, ContainerKind::Body(PlayerId(2)));
    pickup(&mut s, 1);
    pickup(&mut s, 1);
    pickup(&mut s, 1);
    let second = s.step();
    assert!(refusal(&second, PickupRefusal::NothingToTake));
    assert!(s.containers()[0].items.is_empty());
    assert_eq!(s.players()[0].weapon.weapon0, Some(Shield));
    assert_eq!(s.players()[0].weapon.weapon1, Some(Wand));
}

fn first_hits(w: WeaponId, facing: f64, specials: bool) -> Vec<Event> {
    let ps = [
        player(1, 400.0, [Some(w), None]),
        player(2, 456.0, [Some(Shield), None]),
    ];
    let mut s = world(&ps, specials);
    order(&mut s, 2, RawCommand::Aim { a: facing });
    attack(&mut s, 1, 0.0);
    s.step()
}
#[test]
fn frontal_shield_blocks_sword_or_bash_only_and_the_return_is_passive() {
    use std::f64::consts::PI;
    for w in [Sword, Shield, Axe, Fists] {
        let normal = first_hits(w, 0.0, false);
        let amount = normal
            .iter()
            .find_map(|e| match e {
                Event::Hit { amount, .. } => Some(*amount),
                _ => None,
            })
            .unwrap();
        for facing in [PI, PI - PI / 3.0] {
            let front = first_hits(w, facing, false);
            let blocks = matches!(w, Sword | Shield);
            assert_eq!(
                front.iter().any(|e| matches!(e, Event::Block { .. })),
                blocks
            );
            let got = front
                .iter()
                .filter_map(|e| match e {
                    Event::Hit {
                        victim,
                        amount,
                        passive,
                        ..
                    } => Some((*victim, *amount, *passive)),
                    _ => None,
                })
                .collect::<Vec<_>>();
            let (victim, landed, passive) = *got.last().unwrap();
            assert_eq!((victim, passive), (PlayerId(2), false));
            let factor = if blocks {
                1.0 - SHIELD_BLOCK_SHARE
            } else {
                1.0
            };
            assert!((landed - amount * factor).abs() < 1e-9);
            if w == Sword {
                assert_eq!((got[0].0, got[0].2), (PlayerId(1), true));
                assert!((got[0].1 - amount * SHIELD_BLOCK_SHARE * RIPOSTE_SHARE).abs() < 1e-9);
            } else {
                assert_eq!(got.len(), 1);
            }
        }
    }
}

#[test]
fn sword_cancels_wand_cast_and_spares_bow_draw() {
    for target in [Wand, Bow] {
        let ps = [
            player(1, 400.0, [Some(Sword), None]),
            player(2, 456.0, [Some(target), None]),
        ];
        let mut s = world(&ps, false);
        attack(&mut s, 2, std::f64::consts::PI);
        attack(&mut s, 1, 0.0);
        let e = s.step();
        assert_eq!(
            e.iter()
                .any(|e| matches!(e, Event::Stagger { id: PlayerId(2) })),
            target == Wand
        );
        assert_eq!(s.players()[1].weapon.action.is_some(), target == Bow);
        assert_eq!(
            s.players()[1].weapon.stagger_immune_until,
            s.server_time() + 1100.0
        );
        let copy = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(copy.state_hash(), s.state_hash());
    }
}

#[test]
fn axe_shred_has_per_source_refresh_and_a_global_cap() {
    let ps = [
        player(1, 380.0, [Some(Axe), None]),
        player(2, 400.0, [Some(Axe), None]),
        player(3, 450.0, [None; 2]),
    ];
    for specials in [false, true] {
        let mut s = world(&ps, specials);
        attack(&mut s, 1, 0.0);
        attack(&mut s, 2, 0.0);
        s.step();
        let shreds = &s.players()[2].statuses.instances;
        assert_eq!(shreds.len(), if specials { 2 } else { 0 });
        if specials {
            assert_eq!(shreds.iter().map(|x| x.value).sum::<f64>(), AXE_SHRED_CAP);
        }
        order(&mut s, 1, RawCommand::Release { a: 0.0, t: None });
        order(&mut s, 2, RawCommand::Release { a: 0.0, t: None });
        for _ in 0..60 {
            s.step();
        }
        assert!(s.players()[2].statuses.instances.is_empty());
    }
}

#[test]
fn recorded_swaps_body_pickups_and_checkpoint_continue_at_the_same_hashes() {
    let ps = [
        player(1, 400.0, [Some(Shield), None]),
        player(2, 410.0, [Some(Axe), Some(Wand)]),
        player(3, 456.0, [Some(Sword), None]),
    ];
    let config = SimConfig::default();
    let mut sim = world(&ps, true);
    sim.seed_weapon_container(ContainerKind::Ground, ps[0].at, &[Bow])
        .unwrap();
    let mut rec = Recorder::new(
        &sim,
        config,
        ReplayStart::Active {
            placements: ps.to_vec(),
        },
    );
    let mut copy = None;
    for step in 0..215 {
        let raw = match step {
            0 => Some(RawCommand::Swap { slot: None }),
            1 => Some(RawCommand::Pickup { container_id: 2 }),
            2 => Some(RawCommand::Swap { slot: Some(0) }),
            3 => Some(RawCommand::Attack { a: 0.0, t: None }),
            _ => None,
        };
        let inputs: Vec<_> = raw
            .into_iter()
            .map(|r| ReplayInput::Command {
                player: PlayerId(1),
                cmd: validate(r).unwrap(),
            })
            .chain((step == 0).then_some(ReplayInput::Leave {
                player: PlayerId(2),
            }))
            .collect();
        for input in inputs {
            apply_input(&mut sim, &input);
            if let Some(c) = &mut copy {
                apply_input(c, &input);
            }
            rec.record(input);
        }
        let events = sim.step();
        if let Some(c) = &mut copy {
            assert_eq!(c.step(), events);
            assert_eq!(c.state_hash(), sim.state_hash());
        }
        rec.stepped(&sim);
        if step == 0 {
            copy = Some(Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap());
        }
    }
    let replay = serde_json::from_str(&serde_json::to_string(&rec.replay).unwrap()).unwrap();
    assert_eq!(
        run_replay(&replay).unwrap().0.state_hash(),
        sim.state_hash()
    );
}

#[test]
fn corrupt_container_ids_slots_and_axe_statuses_cannot_restore() {
    let ps = [
        player(1, 400.0, [Some(Axe), None]),
        player(2, 456.0, [None; 2]),
    ];
    let mut sim = world(&ps, true);
    for w in [Sword, Shield] {
        sim.seed_weapon_container(ContainerKind::Ground, ps[0].at, &[w])
            .unwrap();
    }
    attack(&mut sim, 1, 0.0);
    sim.step();
    let good = serde_json::to_value(&sim).unwrap();
    for (path, value) in [
        ("/world/players/0/core/weapon/slot", serde_json::json!(8)),
        (
            "/world/players/0/core/weapon/weapon0",
            serde_json::json!("Fists"),
        ),
        (
            "/world/players/1/core/statuses/instances/0/source/id",
            serde_json::json!(99),
        ),
        (
            "/world/players/1/core/statuses/instances/0/until",
            serde_json::json!(0),
        ),
        (
            "/world/players/1/core/modifiers/wire/3",
            serde_json::json!(7),
        ),
        ("/world/containers/1/id", serde_json::json!(1)),
        (
            "/world/containers/0/items/0/def/Weapon",
            serde_json::json!("Fists"),
        ),
        ("/world/containers/0/items/0/uid", serde_json::json!(2)),
        ("/world/containers/1/born_tick", serde_json::json!(5)),
        ("/world/containers/0/opened", serde_json::json!(true)),
    ] {
        let mut bad = good.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(Sim::restore(&bad).is_err(), "accepted malformed {path}");
    }
}

#[test]
fn a_visible_block_keeps_a_hidden_attackers_identity_private() {
    let ps = [
        player(1, 400.0, [Some(Shield), None]),
        player(2, 420.0, [None; 2]),
        player(3, 1500.0, [Some(Sword), None]),
    ];
    let mut arena = practice_arena();
    arena.spawns = vec![ps[1].at]; // no prior discoverable tile near the distant attacker
    let sim = Sim::reset_active(SimConfig::default(), arena, Secrets::from_seed(4), &ps);
    let events = [
        Event::Block {
            id: PlayerId(1),
            by: PlayerId(3),
            weapon: Sword,
            passive: false,
        },
        Event::Stagger { id: PlayerId(3) },
    ];
    let seen = observe(&sim, PlayerId(2), &events);
    assert_eq!(
        seen.events,
        vec![SeenEvent::Block {
            id: PlayerId(1),
            by: None,
            weapon: Sword
        }]
    );
}
