use rh_sim::{mob_runtime::MobMode, FactionId, FactionMode, Phase, Secrets, Sim, SimConfig};

fn active_frost_pve() -> Sim {
    let map = serde_json::from_str(include_str!("fixtures/mob-pve-map.json")).unwrap();
    let arena = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap();
    let mut original = Sim::new(
        SimConfig {
            mob_mode: MobMode::Pve,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            min_players: 8,
            fill_seconds: 0.,
            lobby_seconds: 0.,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        arena,
        Secrets::from_seed(1),
    );
    for seat in 0..8 {
        original
            .add_player(
                &format!("restore-seat-{seat}"),
                Some(if seat == 0 {
                    FactionId::Frost
                } else {
                    FactionId::Holy
                }),
                false,
            )
            .unwrap();
    }
    original.step();
    assert_eq!(original.phase(), Phase::Active);
    assert_eq!(original.players().len(), 8);
    assert_eq!(original.mobs().len(), 3);
    assert!(original
        .mobs()
        .iter()
        .all(|mob| mob.core.vitals.faction == FactionId::Fire));
    original.step();
    original
}

#[test]
fn restored_frost_pve_steps_without_submit_with_more_actors_than_seats() {
    let mut original = active_frost_pve();
    let checkpoint = serde_json::to_value(&original).unwrap();
    assert_eq!(checkpoint["format"], rh_sim::CHECKPOINT_FORMAT);
    let mut restored = Sim::restore(checkpoint).unwrap();
    assert_eq!(original.state_hash(), restored.state_hash());
    // No post-restore submit/join/growth call may warm scratch incidentally: restore must prepare every retained actor.
    let expected = original.step();
    assert_eq!(expected, restored.step());
    assert_eq!(original.state_hash(), restored.state_hash());
}

#[test]
fn cloned_frost_pve_steps_without_submit_with_more_actors_than_seats() {
    let mut original = active_frost_pve();
    let mut cloned = original.clone();
    assert_eq!(original.state_hash(), cloned.state_hash());
    // Clone must prepare retained actors itself; no command submission may warm its fresh scratch.
    let expected = original.step();
    assert_eq!(expected, cloned.step());
    assert_eq!(original.state_hash(), cloned.state_hash());
}
