//! Owner constraints are separate from the roster reference retained for a vanished target.
use rh_sim::{
    arenas::practice_arena, observe, validate, FactionId, Phase, Placement, PlayerId, RawCommand,
    Secrets, Sim, SimConfig, Vec2, WeaponId,
};

fn locked_match() -> Sim {
    let placements = [300.0, 420.0].map(|x| Placement {
        profile: format!("owner{x}"),
        faction: FactionId::Holy,
        bot: false,
        at: Vec2::new(x, 272.0),
        hp: None,
        weapon0: Some(WeaponId::Wand),
        weapon1: None,
    });
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        practice_arena(),
        Secrets::from_seed(7),
        &placements,
    );
    sim.submit(
        PlayerId(1),
        validate(RawCommand::Target { id: PlayerId(2) }).unwrap(),
    )
    .unwrap();
    sim.step();
    assert_eq!(
        observe(&sim, PlayerId(1), &[]).me.unwrap().attack_target,
        Some(PlayerId(2))
    );
    sim
}

#[test]
fn a_lock_cannot_be_restored_for_a_nonwand_owner_or_after_the_match_ends() {
    let mut sim = locked_match();
    let valid = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(valid.clone()).is_ok());
    let mut no_plan = valid.clone();
    no_plan["world"]["players"][0]["core"]["weapon"]["targeting"]["goal"] =
        serde_json::json!({"x":420.0,"y":272.0});
    no_plan["world"]["players"][0]["core"]["weapon"]["targeting"]["plan_at"] =
        serde_json::Value::Null;
    assert_bad_lock(no_plan);
    let mut fists = valid;
    fists["world"]["players"][0]["core"]["weapon"]["weapon0"] = serde_json::Value::Null;
    assert_bad_lock(fists);

    sim.remove_player(PlayerId(2));
    sim.step();
    assert_eq!(sim.phase(), Phase::Ended);
    let mut ended = serde_json::to_value(&sim).unwrap();
    assert!(Sim::restore(ended.clone()).is_ok());
    ended["world"]["players"][0]["core"]["weapon"]["targeting"]["target"] = 2.into();
    assert_bad_lock(ended);
}

fn assert_bad_lock(value: serde_json::Value) {
    match Sim::restore(value) {
        Err(error) => assert!(error.to_string().contains("target lock state")),
        Ok(_) => panic!("malformed target lock was admitted"),
    }
}
