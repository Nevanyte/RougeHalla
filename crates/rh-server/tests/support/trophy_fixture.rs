use rh_sim::{
    FactionId, ItemObserver, Observation, Placement, PlayerId, PublicCommand, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};

#[allow(dead_code)]
pub(crate) fn four_seat_validated_pvp_kill() -> (Sim, Vec<rh_sim::Event>) {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_slice(include_bytes!("../../../../maps/first-playable.json")).unwrap();
    let arena = export.validate().unwrap().into_arena().unwrap();
    let config = SimConfig {
        initial_loot: true,
        consumables: false,
        quests: false,
        regen: false,
        ..Default::default()
    };
    four_seat_validated_pvp_kill_with(config, [FactionId::Fire; 4], Some(arena), 0)
}

/// The same real stat-loot / validated Choose / credited human kill fixture, with pre-creation test setup overrides.
/// `config` is otherwise preserved, but fixture loot and deterministic no-regen/no-quest conditions stay enabled.
pub(crate) fn four_seat_validated_pvp_kill_with(
    config: SimConfig,
    factions: [FactionId; 4],
    arena_override: Option<rh_sim::Arena>,
    pre_kill_warmup_ticks: u32,
) -> (Sim, Vec<rh_sim::Event>) {
    let export: rh_sim::mapdata::MapExport =
        serde_json::from_slice(include_bytes!("../../../../maps/first-playable.json")).unwrap();
    let arena = arena_override.unwrap_or_else(|| export.validate().unwrap().into_arena().unwrap());
    let config = SimConfig {
        initial_loot: true,
        consumables: false,
        quests: false,
        regen: false,
        ..config
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
            faction: factions[i],
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
    for _ in 0..pre_kill_warmup_ticks {
        sim.step();
    }
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
