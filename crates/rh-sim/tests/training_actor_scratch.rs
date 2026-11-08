//! Current basic-Fire/Frost training domain: real actor growth must prepare same-step generic scratch.
use rh_sim::{
    mob_catalog::{mob_type_by_id, MobTypeId},
    FactionId, FactionMode, RawCommand, Secrets, Sim, SimConfig,
};
#[test]
fn real_training_camp_growth_past_eight_steps_without_incidental_input_warming() {
    let mut sim = Sim::new(
        SimConfig {
            training: true,
            quests: false,
            consumables: false,
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
            ..Default::default()
        },
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(12),
    );
    let id = sim
        .add_player("training-growth", Some(FactionId::Holy), false)
        .unwrap();
    sim.step();
    let ty = MobTypeId::ALL
        .into_iter()
        .find(|ty| {
            mob_type_by_id(ty.as_str()).is_some_and(|t| t.zone == FactionId::Fire && !t.elite)
        })
        .unwrap();
    let code = MobTypeId::ALL.iter().position(|t| *t == ty).unwrap() as u32;
    for _ in 0..2 {
        sim.submit(
            id,
            rh_sim::validate(RawCommand::Train(rh_sim::input::TrainRaw {
                command: 3,
                id: code,
                count: 0,
                options: [0; 3],
                option_count: 0,
            }))
            .unwrap(),
        )
        .unwrap();
        sim.step();
        // All following steps are input-free; they cannot incidentally resize actor scratch.
        for _ in 0..6 {
            sim.step();
        }
    }
    assert_eq!(
        sim.mobs()
            .iter()
            .filter(|m| m.kind == rh_sim::mob_runtime::MobKind::Practice)
            .count(),
        6
    );
    assert!(sim.players().len() + sim.mobs().len() > 8);
    let mut restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    let mut cloned = sim.clone();
    let events = sim.step();
    assert_eq!(events, restored.step());
    assert_eq!(events, cloned.step());
    assert_eq!(sim.state_hash(), restored.state_hash());
    assert_eq!(sim.state_hash(), cloned.state_hash());
}
