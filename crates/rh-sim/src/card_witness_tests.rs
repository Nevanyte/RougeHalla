//! The card-runtime **witness** consumer: replays a captured witness case against the Rust sim and compares the source's
//! landed amount (parity/card-runtime-witness/source.json).
use crate::{
    content::WeaponId, input::validate, input::RawCommand, map::TileMap, Arena, FactionId,
    Placement, PlayerId, Secrets, Sim, SimConfig, Vec2,
};

/// The capture rig's default `room`: a 40x24 walled room with the rig's five spawn points and nothing inside.
fn witness_room() -> Arena {
    let (w, h) = (40usize, 24usize);
    let mut rows = Vec::with_capacity(h);
    for y in 0..h {
        let mut r = String::with_capacity(w);
        for x in 0..w {
            r.push(if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                '#'
            } else {
                '.'
            });
        }
        rows.push(r);
    }
    let map = TileMap::from_rows(&rows).expect("witness room");
    let spawns = [
        (112., 112.),
        (400., 112.),
        (800., 112.),
        (112., 624.),
        (800., 624.),
    ]
    .iter()
    .map(|&(x, y)| Vec2::new(x, y))
    .collect();
    Arena { map, spawns }
}

fn load() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/card-runtime-witness/source.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("witness corpus")).expect("json")
}

#[test]
fn the_witness_matched_case_reproduces_the_source_landed_amount() {
    let doc = load();
    let case = &doc["cases"][0];
    assert_eq!(case["input"]["name"], "matched-without-witness");
    let input = &case["input"];
    let expected = case["actualLandedAmount"].as_f64().unwrap();
    let mut rng = crate::rng::Mulberry32::new(input["mainSeed"].as_u64().unwrap() as u32);
    let order_salt = rng.next_u32();
    let mut ps = Vec::new();
    for p in input["players"].as_array().unwrap() {
        let at = &p["at"];
        ps.push(Placement {
            profile: p["faction"].as_str().unwrap().into(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(at["x"].as_f64().unwrap(), at["y"].as_f64().unwrap()),
            hp: None,
            weapon0: p["weapon"].as_str().and_then(WeaponId::parse),
            weapon1: None,
        });
    }
    let secrets = Secrets {
        order_salt,
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let config = SimConfig {
        pvp_rules: false,
        ..Default::default()
    };
    let mut sim = Sim::reset_active(config, witness_room(), secrets, &ps);
    let target = validate(RawCommand::Target { id: PlayerId(3) }).expect("valid");
    let attack = validate(RawCommand::Attack { a: 0., t: None }).expect("valid");
    sim.submit(PlayerId(2), target).unwrap();
    sim.submit(PlayerId(1), attack).unwrap();
    sim.step();
    let mut landed = 0.;
    for _ in 0..16 {
        sim.step();
        for h in sim.s.landed.iter().filter(|h| h.by == Some(PlayerId(1))) {
            landed += h.amount;
        }
        if landed > 0. {
            break;
        }
    }
    assert!(
        (landed - expected).abs() < 1e-6,
        "landed {landed} != source {expected}"
    );
}
