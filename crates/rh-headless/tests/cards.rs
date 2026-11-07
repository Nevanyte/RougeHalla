//! Same external observation/issued-handle path as the live adapter, with only trusted pre-offer setup.
use rh_headless::Env;
use rh_sim::cards::{CardId, Counts};
use rh_sim::{FactionId, Placement, PublicCommand, Secrets, Sim, SimConfig, Vec2};
#[test]
fn issued_reward_choices_update_the_build_through_real_headless_steps() {
    let ps = [
        Placement {
            profile: "a".into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(456., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let base = Sim::reset_active(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets::from_seed(55),
        &ps,
    );
    let mut cp = serde_json::to_value(base).unwrap();
    cp["world"]["reward_chests"] = serde_json::json!([{"id":1,"at":{"x":400.,"y":400.},"expires_at":15000.,"held_until_tick":0,"options":[{"Card":"slowBurn"},{"Card":"pocketSand"},{"Card":"siphon"}],"taken":[null,null,null],"pickers":[],"camp":null,"owner":null}]);
    cp["world"]["entity_counter"] = serde_json::json!(1);
    let sim = Sim::restore(&cp).unwrap();
    let (mut env, obs) = Env::from_external_checkpoint(sim, 100).unwrap();
    let handle = obs[0].reward_chests[0].handle;
    let slow_burn = {
        let mut c = Counts::default();
        c.0[CardId::SlowBurn.index()] = 1;
        c
    };
    assert_eq!(obs[0].build.unwrap().cards, Counts::default());
    let out = env
        .try_step(&[vec![PublicCommand::Choose { handle, pick: 0 }], vec![]])
        .unwrap();
    assert_eq!(out.observations[0].build.unwrap().cards, slow_burn);
    assert!(out.observations[0].reward_chests[0].picked);
    assert!(!out.observations[0].reward_chests[0].can_choose);
    assert_eq!(out.observations[1].build.unwrap().cards, Counts::default());
    let out = env
        .try_step(&[vec![PublicCommand::Choose { handle, pick: 2 }], vec![]])
        .unwrap();
    assert_eq!(out.observations[0].build.unwrap().cards, slow_burn);
}
