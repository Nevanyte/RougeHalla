use rh_headless::Env;
use rh_sim::{
    Arena, FactionId, ItemObserver, Observation, Placement, PlayerId, PublicCommand, RawCommand,
    Secrets, Sim, SimConfig, TileMap, Vec2, WeaponId,
};
#[test]
fn headless_delivers_same_readonly_flight_scene_as_core() {
    let rows = vec![
        "####################".to_owned(),
        "#..................#".to_owned(),
        "#..................#".to_owned(),
        "#..................#".to_owned(),
        "####################".to_owned(),
    ];
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: vec![Vec2::new(80., 80.), Vec2::new(480., 80.)],
    };
    let placements = [
        Placement {
            profile: "a".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(80., 80.),
            hp: None,
            weapon0: Some(WeaponId::Bow),
            weapon1: None,
        },
        Placement {
            profile: "b".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(480., 80.),
            hp: None,
            weapon0: None,
            weapon1: None,
        },
    ];
    let mut direct = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(1),
        &placements,
    );
    let (mut env, _) = Env::from_external_checkpoint(direct.clone(), 30).unwrap();
    let mut observer = ItemObserver::new(PlayerId(2));
    let mut visible = 0;
    for i in 0..30 {
        let commands = if i == 0 {
            direct
                .submit(
                    PlayerId(1),
                    rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
                )
                .unwrap();
            vec![vec![PublicCommand::Attack { a: 0., t: None }], vec![]]
        } else {
            vec![vec![], vec![]]
        };
        direct.step();
        let out = env.try_step(&commands).unwrap();
        assert_eq!(direct.state_hash(), env.sim.state_hash());
        let mut expected = Observation::default();
        observer
            .observe_into(&direct, &[], &mut expected, None)
            .unwrap();
        assert_eq!(out.observations[1].projectiles, expected.projectiles);
        visible += expected.projectiles.len();
    }
    assert!(visible > 0);
}
