//! Same authorized inputs and fixed-step state through headless, including visible mob FX.
use rh_headless::Env;
use rh_sim::{
    Arena, FactionId, Placement, PlayerId, PublicCommand, RawCommand, Secrets, SeenEvent, Sim,
    SimConfig, TileMap, Vec2, WeaponId,
};
#[test]
fn selected_cards_basic_pve_use_same_headless_and_restore_path() {
    let data =
        serde_json::from_str(include_str!("../../rh-sim/tests/fixtures/mob-pve-map.json")).unwrap();
    let (w, h, tiles, layers) = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
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
    let placements = vec![
        Placement {
            profile: "a".into(),
            faction: FactionId::Plague,
            bot: false,
            at: Vec2::new(112., 112.),
            hp: Some(400.),
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(624., 624.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    let mut direct = Sim::reset_active(
        SimConfig {
            consumables: true,
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
            ..Default::default()
        },
        arena,
        secrets,
        &placements,
    );
    // Trusted pre-offer input only. Acquisition still resolves an issued observer handle and submits a validated command.
    let mut cp = serde_json::to_value(&direct).unwrap();
    cp["world"]["reward_chests"] = serde_json::json!([
        {"id":4,"at":{"x":112.,"y":112.},"expires_at":15000.,"held_until_tick":0,"options":[{"Card":"slowBurn"},null,null],"taken":[null,null,null],"pickers":[],"camp":null,"owner":null},
        {"id":5,"at":{"x":112.,"y":112.},"expires_at":15000.,"held_until_tick":0,"options":[{"Card":"siphon"},null,null],"taken":[null,null,null],"pickers":[],"camp":null,"owner":null}
    ]);
    cp["world"]["entity_counter"] = 5.into();
    direct = Sim::restore(cp).unwrap();
    let mut observer = rh_sim::reward_chests::RewardChestObserver::new(PlayerId(1));
    for card in [
        rh_sim::cards::CardId::SlowBurn,
        rh_sim::cards::CardId::Siphon,
    ] {
        let mut offers = vec![];
        let mut build = None;
        observer
            .prepare_into(&direct, &mut offers, &mut build)
            .unwrap()
            .commit();
        let handle = offers
            .iter()
            .find(|o| o.options[0].id == rh_sim::reward_chests::OptionId::Card(card))
            .unwrap()
            .handle;
        let cmd = observer.resolve(&direct, handle, 0).unwrap();
        direct.submit(PlayerId(1), cmd).unwrap();
        direct.step();
    }
    assert!(direct.players()[0]
        .build
        .owns(rh_sim::cards::CardId::SlowBurn));
    assert!(direct.players()[0]
        .build
        .owns(rh_sim::cards::CardId::Siphon));
    let (mut env, _) = Env::from_external_checkpoint(direct.clone(), 200).unwrap();
    let mut heals = 0;
    let mut visible_dot = 0;
    let mut restored = None::<Env>;
    for tick in 0..100 {
        let mut commands = vec![vec![], vec![]];
        if tick == 0 {
            let a = std::f64::consts::FRAC_PI_2;
            direct
                .submit(
                    PlayerId(1),
                    rh_sim::validate(RawCommand::Attack { a, t: None }).unwrap(),
                )
                .unwrap();
            commands[0].push(PublicCommand::Attack { a, t: None });
        }
        let ev = direct.step();
        heals += ev
            .iter()
            .filter(|e| matches!(e,rh_sim::Event::Heal{id,..} if *id==PlayerId(1)))
            .count();
        let out = env.try_step(&commands).unwrap();
        assert_eq!(direct.state_hash(), env.sim.state_hash());
        visible_dot += out.observations[0]
            .events
            .iter()
            .filter(|e| matches!(e,SeenEvent::SignatureHit{victim,..} if victim.0>2))
            .count();
        assert!(
            !out.observations[1]
                .events
                .iter()
                .any(|e| matches!(e,SeenEvent::SignatureHit{victim,..} if victim.0>2)),
            "hidden mob DoT leaked"
        );
        if let Some(r) = restored.as_mut() {
            r.try_step(&commands).unwrap();
            assert_eq!(r.sim.state_hash(), direct.state_hash());
        }
        if tick == 40 {
            let s = Sim::restore(serde_json::to_value(&direct).unwrap()).unwrap();
            restored = Some(Env::from_external_checkpoint(s, 200).unwrap().0);
        }
    }
    assert!(heals > 0);
    assert!(visible_dot > 0);
    assert!(restored.is_some());
}
