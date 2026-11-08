use rh_server::{wire::Publisher, wire_state::CollectionPublisher};
use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, PublicCommand, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};

fn four_seat_validated_pvp_kill() -> (Sim, Vec<rh_sim::Event>) {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_slice(include_bytes!("../../../maps/first-playable.json")).unwrap();
    let arena = export.validate().unwrap().into_arena().unwrap();
    let config = SimConfig {
        initial_loot: true,
        consumables: false,
        quests: false,
        regen: false,
        ..Default::default()
    };
    let specimen = Sim::new(config.clone(), arena.clone(), Secrets::from_seed(7));
    let state = serde_json::to_value(&specimen).unwrap();
    let chest = state["world"]["containers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["stat_offer"] == true)
        .expect("a source-generated stat chest");
    let at: Vec2 = serde_json::from_value(chest["at"].clone()).unwrap();
    let positions = [
        Vec2::new(at.x - 32., at.y),
        at,
        Vec2::new(at.x + 120., at.y),
        Vec2::new(at.x + 160., at.y),
    ];
    let placements: Vec<_> = positions
        .iter()
        .enumerate()
        .map(|(i, at)| Placement {
            profile: format!("p{i}"),
            faction: FactionId::Fire,
            bot: false,
            at: *at,
            hp: if i == 1 { Some(1.) } else { None },
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        })
        .collect();
    let mut sim = Sim::reset_active(config, arena, Secrets::from_seed(7), &placements);
    let mut victim = ItemObserver::new(PlayerId(2));
    let mut observation = Observation::default();
    victim
        .observe_into(&sim, &[], &mut observation, None)
        .unwrap();
    let handle = observation
        .props
        .iter()
        .find(|p| {
            p.cue.x == rh_protocol::quant::quantize_pos(at.x as f32)
                && p.cue.y == rh_protocol::quant::quantize_pos(at.y as f32)
        })
        .expect("observed source chest")
        .handle;
    sim.submit(
        PlayerId(2),
        victim
            .resolve(&sim, PublicCommand::Pickup { handle })
            .unwrap(),
    )
    .unwrap();
    sim.step();
    for _ in 0..3 {
        sim.step();
    }
    victim
        .observe_into(&sim, &[], &mut observation, None)
        .unwrap();
    let reward = observation
        .reward_chests
        .iter()
        .find(|r| r.can_choose)
        .expect("opened stat offer");
    let pick=reward.options.iter().position(|o|matches!(o.id,rh_sim::reward_chests::OptionId::Boost(id) if id != rh_sim::reward_chests::BoostId::Lifesteal)).unwrap();
    sim.submit(
        PlayerId(2),
        victim
            .resolve(
                &sim,
                PublicCommand::Choose {
                    handle: reward.handle,
                    pick: pick as i8,
                },
            )
            .unwrap(),
    )
    .unwrap();
    sim.step();
    assert!(
        !rh_sim::kill_augments::roll(sim.player(PlayerId(2)).unwrap()).is_empty(),
        "a validated real chest choice creates invested stats"
    );
    let mut killer = ItemObserver::new(PlayerId(1));
    killer
        .observe_into(&sim, &[], &mut observation, None)
        .unwrap();
    sim.submit(
        PlayerId(1),
        killer
            .resolve(&sim, PublicCommand::Attack { a: 0., t: None })
            .unwrap(),
    )
    .unwrap();
    let mut events = Vec::new();
    for _ in 0..30 {
        events = sim.step();
        if sim.player(PlayerId(2)).unwrap().vitals.hp <= 0. {
            break;
        }
    }
    assert_eq!(
        sim.phase(),
        rh_sim::Phase::Active,
        "four seats keep the match active after the kill"
    );
    assert_eq!(
        sim.player(PlayerId(2)).unwrap().status,
        rh_sim::Status::Dead
    );
    (sim, events)
}

#[test]
fn four_seat_validated_kill_keeps_supported_publication_and_default_native_rewards() {
    let (mut sim, mut events) = four_seat_validated_pvp_kill();
    for viewer in [PlayerId(1), PlayerId(3), PlayerId(4)] {
        let mut native = ItemObserver::new(viewer);
        let mut native_obs = Observation::default();
        native
            .observe_into(&sim, &events, &mut native_obs, None)
            .unwrap();
        assert!(
            native_obs.reward_chests.iter().any(|r| r
                .options
                .iter()
                .any(|o| matches!(o.id, rh_sim::reward_chests::OptionId::Kill(_)))),
            "default native observer retains complete rows for {viewer:?}"
        );
        let supported: Vec<_> = native_obs
            .reward_chests
            .iter()
            .filter(|r| {
                r.options
                    .iter()
                    .all(|o| !matches!(o.id, rh_sim::reward_chests::OptionId::Kill(_)))
            })
            .map(|r| (r.at, r.options.clone()))
            .collect();
        let mut observer = ItemObserver::new(viewer);
        let mut publisher = Publisher::default();
        let mut collections = CollectionPublisher::default();
        for attempt in 0..2 {
            let mut carry = Vec::new();
            let (frames, offer) = publisher
                .frames_prepared(&mut observer, None, &sim, 0, &events, &mut carry, &events)
                .unwrap();
            assert!(frames.snapshot.is_ok() && frames.refused.is_none());
            let obs = publisher.observation();
            assert!(obs.reward_chests.iter().all(|r| r
                .options
                .iter()
                .all(|o| !matches!(o.id, rh_sim::reward_chests::OptionId::Kill(_)))));
            assert_eq!(
                obs.reward_chests
                    .iter()
                    .map(|r| (r.at, r.options.clone()))
                    .collect::<Vec<_>>(),
                supported,
                "all supported options and their order remain intact"
            );
            let first_unissued = obs
                .reward_chests
                .iter()
                .map(|r| r.handle.wire())
                .max()
                .unwrap_or(0)
                + 1;
            let state = collections
                .prepare(obs, offer.props_changed(), offer.rewards_changed(), false)
                .unwrap();
            if attempt == 0 {
                drop(offer);
                drop(state);
                continue;
            }
            state.commit(&mut collections);
            offer.commit();
            assert_eq!(
                observer
                    .resolve(
                        &sim,
                        PublicCommand::Choose {
                            handle: rh_sim::reward_chests::RewardChestHandle::from_wire(
                                first_unissued
                            )
                            .unwrap(),
                            pick: 0
                        }
                    )
                    .unwrap(),
                rh_sim::validate(rh_sim::RawCommand::Choose {
                    chest_id: None,
                    pick: 0
                })
                .unwrap(),
                "omitted Trophy never creates an unpublished candidate binding"
            );
        }
    }
    // Every publication remains supported on later ticks while the native Trophy is still alive.
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut publisher = Publisher::default();
    let mut collections = CollectionPublisher::default();
    for _ in 0..4 {
        let (frames, offer) = publisher
            .frames_prepared(
                &mut observer,
                None,
                &sim,
                0,
                &events,
                &mut Vec::new(),
                &events,
            )
            .unwrap();
        assert!(frames.snapshot.is_ok());
        let state = collections
            .prepare(
                publisher.observation(),
                offer.props_changed(),
                offer.rewards_changed(),
                false,
            )
            .unwrap();
        state.commit(&mut collections);
        offer.commit();
        events = sim.step();
    }
    let mut native = ItemObserver::new(PlayerId(1));
    let mut obs = Observation::default();
    native.observe_into(&sim, &events, &mut obs, None).unwrap();
    let trophy = obs
        .reward_chests
        .iter()
        .find(|r| {
            r.can_choose && matches!(r.options[0].id, rh_sim::reward_chests::OptionId::Kill(_))
        })
        .expect("native Trophy remains selectable");
    sim.submit(
        PlayerId(1),
        native
            .resolve(
                &sim,
                PublicCommand::Choose {
                    handle: trophy.handle,
                    pick: 0,
                },
            )
            .unwrap(),
    )
    .unwrap();
    sim.step();
    assert!(
        rh_sim::kill_augments::KillStatKey::ALL.iter().any(|key| sim
            .player(PlayerId(1))
            .unwrap()
            .kill_stats
            .get(*key)
            > 0.),
        "default headless/native flow still grants the genuine Trophy pick"
    );
}

#[test]
fn a_missing_card_prerequisite_is_an_owner_toast_and_never_blocks_later_frames() {
    let (sim, _) = four_seat_validated_pvp_kill();
    let event = rh_sim::Event::ChestRefused {
        id: PlayerId(1),
        reason: rh_sim::reward_chests::Refusal::Needs(rh_sim::cards::BaseStatId::Ad),
    };
    for viewer in [PlayerId(1), PlayerId(3)] {
        let mut observer = ItemObserver::new(viewer);
        let mut publisher = Publisher::default();
        let mut carry = Vec::new();
        let (frames, offer) = publisher
            .frames_prepared(
                &mut observer,
                None,
                &sim,
                0,
                std::slice::from_ref(&event),
                &mut carry,
                &[],
            )
            .unwrap();
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        if viewer == PlayerId(1) {
            let rh_protocol::ServerMsg::Events { events, .. } =
                rh_protocol::ServerMsg::decode(&frames.important.unwrap()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                events,
                vec![rh_protocol::WireEvent::Toast {
                    text: "Needs Offense".into()
                }]
            );
        } else {
            assert!(
                frames.important.is_none(),
                "private refusal is never sent to another seat"
            );
        }
        offer.commit();
        assert!(carry.is_empty());
        let (frames, offer) = publisher
            .frames_prepared(&mut observer, None, &sim, 0, &[], &mut carry, &[])
            .unwrap();
        assert!(frames.snapshot.is_ok() && frames.refused.is_none());
        assert!(
            frames.important.is_none(),
            "a processed private refusal cannot poison the next publication"
        );
        offer.commit();
    }
}
