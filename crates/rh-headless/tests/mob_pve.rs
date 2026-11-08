//! Same authorized inputs and fixed-step state through headless, including visible mob FX.
use rh_headless::Env;
use rh_sim::{
    Arena, FactionId, Placement, PlayerId, PublicCommand, RawCommand, Secrets, SeenEvent, Sim,
    SimConfig, TileMap, Vec2, WeaponId,
};
fn actor(s: &str, seats: usize) -> PlayerId {
    if let Some(n) = s.strip_prefix('p') {
        PlayerId(n.parse::<u32>().unwrap() + 1)
    } else {
        PlayerId(seats as u32 + u32::from_str_radix(s.strip_prefix("mob").unwrap(), 36).unwrap())
    }
}
#[test]
fn actual_camp_clear_uses_headless_inputs_and_visible_mob_fx() {
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
    let f: serde_json::Value = serde_json::from_str(include_str!(
        "../../rh-sim/tests/fixtures/mob-pve-source.json"
    ))
    .unwrap();
    let c = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "joint-credit")
        .unwrap();
    let placements: Vec<_> = c["input"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("name{i}"),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: WeaponId::parse(p["weapon"].as_str().unwrap()),
            weapon1: None,
        })
        .collect();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = 12;
    secrets.reward_salt = [1, 2, 3, 4];
    let mut direct = Sim::reset_active(
        SimConfig {
            quests: false,
            mob_mode: rh_sim::mob_runtime::MobMode::Pve,
            ..Default::default()
        },
        arena,
        secrets,
        &placements,
    );
    let env_sim = direct.clone();
    let (mut env, mut initial) = Env::from_external_checkpoint(env_sim, 501).unwrap();
    assert!(initial[0]
        .visible
        .iter()
        .any(|a| a.id.0 > placements.len() as u32));
    let mut mob_hits = 0;
    for frame in c["frames"].as_array().unwrap() {
        let mut commands = vec![vec![]; placements.len()];
        for cmd in frame["commands"].as_array().unwrap() {
            let id = actor(cmd["actor"].as_str().unwrap(), placements.len());
            let (raw, public) = match cmd["kind"].as_str().unwrap() {
                "target" => {
                    let id = actor(cmd["id"].as_str().unwrap(), placements.len());
                    let mob = direct.mobs().iter().find(|m| m.core.id == id).unwrap();
                    let viewer =
                        actor(cmd["actor"].as_str().unwrap(), placements.len()).0 as usize - 1;
                    let public = initial[viewer]
                        .visible
                        .iter()
                        .find(|r| {
                            r.kind == 1
                                && r.mob_type == mob.mob_type
                                && r.x == mob.core.body.x
                                && r.y == mob.core.body.y
                        })
                        .unwrap()
                        .id;
                    (
                        RawCommand::Target { id },
                        PublicCommand::Target { actor: public },
                    )
                }
                "attack" => {
                    let a = cmd["a"].as_f64().unwrap();
                    (
                        RawCommand::Attack { a, t: None },
                        PublicCommand::Attack { a, t: None },
                    )
                }
                _ => panic!("unadmitted command"),
            };
            direct.submit(id, rh_sim::validate(raw).unwrap()).unwrap();
            commands[id.0 as usize - 1].push(public);
        }
        direct.step();
        let out = env.try_step(&commands).unwrap();
        assert_eq!(direct.state_hash(), env.sim.state_hash());
        mob_hits += out.observations[0]
            .events
            .iter()
            .filter(|e| matches!(e,SeenEvent::Hit{victim,..} if victim.0>placements.len() as u32))
            .count();
        assert!(
            !out.observations[2]
                .events
                .iter()
                .any(|e| matches!(e,SeenEvent::Hit{victim,..} if victim.0>placements.len() as u32)),
            "distant player learned mob hits"
        );
        initial = out.observations;
    }
    assert!(mob_hits > 0, "visible mob FX missing from headless");
    assert_eq!(env.sim.camp_rosters()[0].state, 2);
    assert_eq!(env.sim.players()[0].credit.mob_kills, 3);
    assert_eq!(
        env.sim.players()[0]
            .farm
            .count(rh_sim::mob_catalog::MobTypeId::FlameCaller),
        6
    );
    let restored = Sim::restore(serde_json::to_value(&env.sim).unwrap()).unwrap();
    assert_eq!(restored.state_hash(), env.sim.state_hash());
    let (mut restored, _) = Env::from_external_checkpoint(restored, 5).unwrap();
    for _ in 0..5 {
        env.step(&[vec![], vec![], vec![]]);
        restored.step(&[vec![], vec![], vec![]]);
        assert_eq!(env.sim.state_hash(), restored.sim.state_hash());
    }
}
