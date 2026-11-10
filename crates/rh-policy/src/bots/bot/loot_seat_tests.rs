//! fix-bot-loot: the live seat's Pickup/Choose path end to end. A command names only a handle the latest accepted
//! observation delivered for that public row, and a real Sim pickup goes through Seat resolve + validate + submit.
use super::*;
use crate::bots::perception::{ChestRef, Contents, PropRef};
use crate::{drive_seats_with, scripted::Idle, Seat};
use rh_sim::{ContainerKind, FactionId, Placement, Secrets, SightCache, Sim, SimConfig, Vec2};

fn scene(weapon_at: Option<Vec2>) -> Sim {
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(1),
        &[Placement {
            profile: "owner".into(),
            faction: FactionId::Fire,
            bot: true,
            at: Vec2::new(400., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    if let Some(at) = weapon_at {
        sim.seed_weapon_container(ContainerKind::Ground, at, &[rh_sim::WeaponId::Axe])
            .unwrap();
    }
    sim
}

fn bot(start: &MatchStart) -> HumanBot {
    let mut b = HumanBot::new(TierId::Normal, PersonaId::Opportunist);
    b.reset(start);
    b
}

#[test]
fn emit_resolves_keys_only_to_the_handles_the_latest_observation_delivered() {
    let sim = scene(None);
    let mut b = bot(&MatchStart::of(&sim, PlayerId(1), 3));
    b.facts.props = vec![PropRef {
        key: "c3360_2560_g4".into(),
        handle: rh_protocol::PickupHandle::new(77).unwrap(),
        kind: "ground",
        at: Vec2::new(420., 320.),
        closed: true,
        contents: Contents::Weapon(crate::bots::types::BotWeapon::Axe),
        interactable: true,
    }];
    b.facts.chests = vec![ChestRef {
        key: "r1".into(),
        handle: rh_protocol::RewardChestHandle::new(12).unwrap(),
        at: Vec2::new(440., 320.),
        expires_at: 1e9,
        life_ms: 15_000.,
        options: Some(vec!["ad1".into()]),
        taken_by: vec![String::new()],
        picked: false,
    }];
    use crate::bots::types::Command as C;
    let mut out = Vec::new();
    b.emit(
        C::Pickup {
            container_id: "c3360_2560_g4".into(),
        },
        &mut out,
    );
    b.emit(
        C::Choose {
            chest: "r1".into(),
            pick: 0,
            replace: None,
        },
        &mut out,
    );
    assert_eq!(
        out,
        vec![
            PublicCommand::Pickup {
                handle: rh_sim::PickupHandle::new(77).unwrap()
            },
            PublicCommand::Choose {
                handle: rh_sim::reward_chests::RewardChestHandle::from_wire(12).unwrap(),
                pick: 0
            },
        ]
    );
    // A key the observation does not carry (a row index, a stale row) is dropped, never guessed.
    out.clear();
    for key in ["c0", "c1", "r0", "c3360_2560_g0"] {
        b.emit(
            C::Pickup {
                container_id: key.into(),
            },
            &mut out,
        );
        b.emit(
            C::Choose {
                chest: key.into(),
                pick: 0,
                replace: None,
            },
            &mut out,
        );
    }
    assert!(out.is_empty());
}

#[test]
fn weaponless_seat_walks_to_a_ground_weapon_and_picks_it_up_through_validated_intake() {
    fn run() -> (Vec<rh_sim::Command>, [Option<rh_sim::WeaponId>; 2], u64) {
        let mut sim = scene(Some(Vec2::new(520., 320.)));
        let start = MatchStart::of(&sim, PlayerId(1), 11);
        let mut seats = [Seat::new(
            &start,
            Box::new(HumanBot::new(TierId::Normal, PersonaId::Opportunist)),
            Box::new(Idle),
        )];
        seats[0].bind_fx(&sim).unwrap();
        let mut sight = SightCache::new();
        let mut sent = vec![];
        let mut events = vec![];
        for _ in 0..200 {
            drive_seats_with(&mut sim, &mut seats, &events, &mut sight, |_, c| {
                sent.push(c)
            });
            events = sim.step();
        }
        assert!(seats[0].fault.is_none());
        assert_eq!(seats[0].stats.fallback_decisions, 0);
        let slots = rh_sim::observe(&sim, PlayerId(1), &[])
            .inventory
            .unwrap()
            .slots;
        (sent, slots, sim.state_hash())
    }
    let (sent, slots, hash) = run();
    assert!(
        slots.contains(&Some(rh_sim::WeaponId::Axe)),
        "the bot holds the axe it walked to: {slots:?}"
    );
    let pickups: Vec<_> = sent
        .iter()
        .filter(|c| format!("{c:?}").contains("Pickup"))
        .collect();
    assert!(!pickups.is_empty(), "a resolved pickup was submitted");
    assert!(
        pickups
            .iter()
            .all(|c| !format!("{c:?}").contains("MissingPickup")),
        "every pickup named a delivered handle: {pickups:?}"
    );
    assert_eq!(run(), (sent, slots, hash), "deterministic");
}

#[test]
fn offered_reward_chest_is_answered_with_its_delivered_handle_and_the_chosen_card() {
    let mut sim = scene(None);
    let start = MatchStart::of(&sim, PlayerId(1), 5);
    let mut b = bot(&start);
    let handle = rh_sim::reward_chests::RewardChestHandle::from_wire(31).unwrap();
    // A chest's expiry is fixed at its drop: its public identity does not change while it stands.
    let expires_at = sim.server_time() + 10_000.;
    let offer = |obs: &mut rh_sim::Observation, can_choose: bool| {
        obs.reward_chests = vec![rh_sim::reward_chests::RewardChestView {
            handle,
            at: Vec2::new(440., 320.),
            expires_at,
            options: [
                rh_sim::cards::CardId::ALL[0],
                rh_sim::cards::CardId::ALL[1],
                rh_sim::cards::CardId::ALL[2],
            ]
            .map(|c| rh_sim::reward_chests::RewardOptionView {
                id: rh_sim::reward_chests::OptionId::Card(c),
                taken: false,
                taken_by: None,
            })
            .to_vec(),
            picked: false,
            can_choose,
        }];
    };
    let mut chooses = vec![];
    for i in 0..120 {
        let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        // The panel is shut for the first ticks (the server's own admission flag), then open.
        offer(&mut obs, i >= 20);
        for c in b.component_commands(&obs) {
            if let PublicCommand::Choose { handle: h, pick } = c {
                assert!(i >= 20, "no choose before the cards were readable");
                chooses.push((h, pick));
            }
        }
        sim.step();
    }
    assert!(!chooses.is_empty(), "the bot answered the offer");
    assert!(chooses.iter().all(|(h, _)| *h == handle));
    assert!(chooses.iter().all(|(_, p)| (-1..=2).contains(p)));
    // The bot never asks about a chest whose row is gone from its observation.
    let mut b = bot(&start);
    for _ in 0..60 {
        let obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        assert!(b.component_commands(&obs).iter().all(|c| !matches!(
            c,
            PublicCommand::Choose { .. } | PublicCommand::Pickup { .. }
        )));
        sim.step();
    }
}

#[test]
fn bot_attacked_at_a_readable_chest_fights_back_and_still_picks() {
    let mut sim = Sim::reset_active(
        SimConfig {
            quests: false,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(1),
        &[
            Placement {
                profile: "owner".into(),
                faction: FactionId::Fire,
                bot: true,
                at: Vec2::new(400., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "attacker".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(430., 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ],
    );
    let start = MatchStart::of(&sim, PlayerId(1), 5);
    let mut b = bot(&start);
    let handle = rh_sim::reward_chests::RewardChestHandle::from_wire(31).unwrap();
    let expires_at = sim.server_time() + 10_000.;
    let (mut chooses, mut combat, mut chest_goal) = (0, 0, 0);
    for _ in 0..80 {
        let mut obs = rh_sim::observe(&sim, PlayerId(1), &[]);
        obs.reward_chests = vec![rh_sim::reward_chests::RewardChestView {
            handle,
            at: Vec2::new(410., 330.),
            expires_at,
            options: vec![rh_sim::reward_chests::RewardOptionView {
                id: rh_sim::reward_chests::OptionId::Card(rh_sim::cards::CardId::ALL[0]),
                taken: false,
                taken_by: None,
            }],
            picked: false,
            can_choose: true,
        }];
        for c in b.component_commands(&obs) {
            match c {
                PublicCommand::Choose { handle: h, .. } => {
                    assert_eq!(h, handle);
                    chooses += 1;
                }
                PublicCommand::Target { .. }
                | PublicCommand::Attack { .. }
                | PublicCommand::Cast { .. } => combat += 1,
                _ => {}
            }
        }
        if matches!(b.brain.goal, Goal::Chest { .. }) {
            chest_goal += 1;
        }
        // The attacker punches the bot every tick.
        if let Ok(cmd) = rh_sim::validate(rh_sim::RawCommand::Attack {
            a: std::f64::consts::PI,
            t: None,
        }) {
            let _ = sim.submit(PlayerId(2), cmd);
        }
        sim.step();
    }
    assert_eq!(chest_goal, 0, "no chest goal is held in a fight");
    assert!(
        matches!(b.brain.goal, Goal::Fight { .. }),
        "{:?}",
        b.brain.goal
    );
    assert!(combat > 0, "the bot fights back");
    assert!(chooses > 0, "the pick still went out");
}
