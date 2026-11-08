//! Bounded native foundation witness from the unmodified full source assembler.
use rh_sim::mob_runtime::MobMode;
use rh_sim::{validate, Arena, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap, Vec2};
use serde_json::Value;
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/mob-foundation-small.json")).unwrap()
}
fn arena() -> Arena {
    let f = fixture();
    let data: rh_sim::mapdata::GameMapData = serde_json::from_value(f["map"].clone()).unwrap();
    let export = rh_sim::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    };
    let (w, h, tiles, layers) = export.validate().unwrap().into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}
fn lobby() -> Sim {
    let f = fixture();
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = f["input"]["randomSeed"].as_u64().unwrap() as u32;
    secrets.reward_salt = serde_json::from_value(f["input"]["rewardSalt"].clone()).unwrap();
    Sim::try_new(
        SimConfig {
            quests: false,
            min_players: 2,
            lobby_seconds: 15.,
            fill_seconds: 0.,
            mob_mode: MobMode::SpawnFoundation,
            ..SimConfig::default()
        },
        arena(),
        secrets,
    )
    .unwrap()
}
fn active() -> Sim {
    let mut s = lobby();
    for p in fixture()["input"]["players"].as_array().unwrap() {
        s.add_player(p["name"].as_str().unwrap(), None, false);
    }
    s.step();
    s
}
#[test]
fn actual_source_roster_and_regional_birth_prefix() {
    let s = lobby();
    assert_eq!(s.players().len(), 0);
    assert_eq!(s.mobs().len(), 0);
    assert_eq!(s.camp_rosters()[0].mob_type.as_str(), "flameCaller");
    assert_eq!(s.camp_rosters()[0].elite.unwrap().as_str(), "wyrmling");
    let s = active();
    let f = fixture();
    let expected = f["expected"]["actors"].as_array().unwrap();
    assert_eq!(s.players().len(), 2);
    assert_eq!(s.mobs().len(), 3);
    for (i, (m, e)) in s.mobs().iter().zip(expected).enumerate() {
        assert_eq!(m.core.id, PlayerId(i as u32 + 3));
        for (got, key) in [
            (m.core.body.x, "x"),
            (m.core.body.y, "y"),
            (m.core.body.facing, "facing"),
            (m.core.vitals.hp, "hp"),
            (m.core.vitals.max_hp, "maxHp"),
        ] {
            assert_eq!(got, e["state"][key].as_f64().unwrap(), "{key}");
        }
        assert_eq!(m.mob_type.as_str(), e["state"]["type"].as_str().unwrap());
        assert_eq!(
            m.core.weapon.weapon0.unwrap().as_str(),
            e["state"]["weapon0"].as_str().unwrap()
        );
        assert_eq!(
            m.repath_phase,
            e["runtime"]["brain"]["phase"].as_u64().unwrap() as u32
        );
    }
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["world"]["entity_counter"], 3);
    let mut reward: rh_sim::private_rng::Sfc32 =
        serde_json::from_value(v["world"]["reward_rng"].clone()).unwrap();
    let mut main: rh_sim::rng::Mulberry32 =
        serde_json::from_value(v["world"]["spawn_rng"].clone()).unwrap();
    for (name, next) in [
        (
            "rewardRandom",
            (0..4).map(|_| reward.next_f64()).collect::<Vec<_>>(),
        ),
        (
            "random",
            (0..4).map(|_| main.next_f64()).collect::<Vec<_>>(),
        ),
    ] {
        assert_eq!(
            serde_json::to_value(next).unwrap(),
            f["expected"]["rng"][name]["next"]
        );
    }
    s.check_layout().unwrap();
}
#[test]
fn same_input_movement_restore_and_seat_compaction() {
    let mut a = active();
    let id = a.mobs()[1].core.id;
    a.submit(
        id,
        validate(RawCommand::Move {
            x: 112.,
            y: 112.,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    a.submit(id, validate(RawCommand::Aim { a: 0.25 }).unwrap())
        .unwrap();
    assert!(a
        .submit(id, validate(RawCommand::Attack { a: 0., t: None }).unwrap())
        .is_err());
    let mut b = Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    for _ in 0..4 {
        assert_eq!(a.step(), b.step());
        assert_eq!(a.state_hash(), b.state_hash());
    }
    assert!(a.mobs()[1].core.body.y < 144.);
    a.remove_player(PlayerId(1));
    a.submit(id, validate(RawCommand::Stop { seq: None }).unwrap())
        .unwrap();
    a.step();
    assert_eq!(a.players().len(), 1);
    assert_eq!(a.mobs().len(), 3);
    Sim::restore(serde_json::to_value(&a).unwrap()).unwrap();
    for bogus in [PlayerId(99), PlayerId(999)] {
        let hash = a.state_hash();
        a.submit(bogus, validate(RawCommand::Aim { a: 0. }).unwrap())
            .unwrap();
        assert_eq!(hash, a.state_hash());
    }
}
#[test]
fn retained_typed_provenance_and_private_birth_data_are_checked() {
    let s = active();
    let original = serde_json::to_value(&s).unwrap();
    for id in [99, 999] {
        let mut v = original.clone();
        v["world"]["mobs"][0]["core"]["id"] = id.into();
        assert!(Sim::restore(v).is_err());
    }
    let mut v = original.clone();
    v["world"]["mobs"][0]["repath_phase"] = 0.into();
    assert!(Sim::restore(v).is_err());
    let mut v = original.clone();
    v["world"]["actor_history"][2]["origin"]["Mob"]["birth_serial"] = 99.into();
    assert!(Sim::restore(v).is_err());
    let mut v = original.clone();
    v["world"]["mobs"][0]["core"]["inputs"]["actions"] =
        serde_json::json!([{"Attack":{"a":0.,"t":null}}]);
    assert!(Sim::restore(v).is_err());
    // A valid player deferred packet becomes unsupported when its victim is a mob: until
    // the shared ledger is widened, restore refuses it before a player-slot index is read.
    let mut deferred = original.clone();
    deferred["world"]["deferred"]["hits"] = serde_json::json!([{
        "terrain":false,"dot":false,"ability":null,"arena":false,"source":null,"critical":false,"critical_mult":null,
        "sig":null,"execute":false,"victim":1,"by":2,"packet":{"raw":1.,"phys":1.,"magic":0.,"true_":0.},
        "weapon":null,"stagger":false,"projectile":null,"scale":1.,"derived":false,"passive":false
    }]);
    Sim::restore(deferred.clone()).unwrap();
    deferred["world"]["deferred"]["hits"][0]["victim"] = 3.into();
    assert!(Sim::restore(deferred)
        .unwrap_err()
        .to_string()
        .contains("mob combat state"));
    let public = serde_json::to_string(&rh_sim::observe(&s, PlayerId(1), &[])).unwrap();
    for private in [
        "birth_serial",
        "reward_rng",
        "home_facing",
        "repath_phase",
        "actor_history",
    ] {
        assert!(!public.contains(private));
    }
    let obs = rh_sim::observe(&s, PlayerId(1), &[]);
    assert_eq!(obs.camps.len(), 1);
}
