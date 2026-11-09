//! Native external-session control, separate from the captured quest-giver source cases.
use rh_headless::Env;
use rh_sim::{
    observe::ActorKind, FactionId, ItemObserver, Placement, PlayerId, PublicCommand, Secrets, Sim,
    SimConfig, Vec2, WeaponId,
};

fn scene(at: Option<Vec2>) -> Sim {
    use rh_sim::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let generator = pipeline::Pipeline::new(&fixed);
    let map = generator
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .unwrap();
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let placement = Placement {
        profile: "quest-seat".into(),
        faction: FactionId::Holy,
        bot: false,
        at: at.unwrap_or(arena.spawns[0]),
        hp: None,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    };
    Sim::reset_active(
        SimConfig {
            quests: true,
            pvp_rules: false,
            ..Default::default()
        },
        arena,
        Secrets {
            order_salt: 7,
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &[placement],
    )
}

#[test]
fn native_quest_giver_external_acceptance_and_neutral_target_survive_a_fresh_session() {
    let probe = scene(None);
    let mut observer = ItemObserver::new(PlayerId(1));
    let mut view = Default::default();
    observer.observe_into(&probe, &[], &mut view, None).unwrap();
    let at = view.quests.as_ref().unwrap().rows[0].giver;
    // Declared native scene setup: spawn at a publicly delivered navigation destination.
    // No fixture outcome, private quest ID or actor handle is installed into the runtime.
    let original = scene(Some(at));
    let (mut env, initial) = Env::from_external_checkpoint(original, 150).unwrap();
    let quest = initial[0]
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|q| q.giver == at && q.can_accept)
        .unwrap()
        .handle;
    let giver = initial[0]
        .visible
        .iter()
        .find(|a| a.kind == ActorKind::QuestGiver && a.x == at.x && a.y == at.y)
        .unwrap();
    assert_eq!(giver.faction.faction_id(), None);
    assert_eq!(giver.weapon, None);
    let giver_ref = giver.id;
    let step = env.step(&[vec![
        PublicCommand::QuestAccept { handle: quest },
        PublicCommand::Target { actor: giver_ref },
    ]]);
    let owner = step.observations[0]
        .quests
        .as_ref()
        .unwrap()
        .rows
        .iter()
        .find(|q| q.handle == quest)
        .unwrap();
    assert!(owner.owner_accepted);
    assert!(!owner.owner_completed);
    assert!(step.observations[0]
        .quests
        .as_ref()
        .unwrap()
        .owner_roster
        .is_some());
    assert!(env.sim.players()[0].weapon.targeting.target.is_none());
    let checkpoint = serde_json::to_value(&env.sim).unwrap();
    let restored = Sim::restore(&checkpoint).unwrap();
    assert_eq!(restored.state_hash(), env.sim.state_hash());
    let (mut a, _) = Env::from_external_checkpoint(env.sim.clone(), 100).unwrap();
    let (mut b, _) = Env::from_external_checkpoint(restored, 100).unwrap();
    for _ in 0..24 {
        let a_step = a.step(&[vec![]]);
        let b_step = b.step(&[vec![]]);
        assert_eq!(a_step.events, b_step.events);
        assert_eq!(a_step.observations, b_step.observations);
        assert_eq!(a.sim.state_hash(), b.sim.state_hash());
    }
}
