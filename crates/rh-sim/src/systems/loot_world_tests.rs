#![cfg(test)]
//! The actual source loot world through the ported container/weapon systems: spawnLoot crates and ground spots, pickup,
//! second-slot and replace rules, Committed's second-slot lock, between-tick and held container births, and body drops.
//!
//! "parity/loot-world/source.json" is a declared trusted setup plus ordered actual source calls (genuine
//! enqueueClientMessage pickup/swap, ordinary 50ms steps, one actual Committed grant, one real between-tick departure and
//! two declared container creations). This consumer replays them through the ported lifecycle and compares every frame.
use crate::input::{validate, RawCommand};
use crate::state::{ContainerKind, PlayerId, Sample, Status};
use crate::{Arena, Event, FactionId, Secrets, Sim, SimConfig, Vec2};
use serde_json::{json, Value};
fn corpus() -> Value {
    let bytes = include_bytes!("../../../../parity/loot-world/source.json");
    let v: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(v["format"], "rh-loot-world-source/1");
    assert_eq!(v["provenance"]["node"], "v22.23.4");
    assert_eq!(v["provenance"]["platform"], "linux");
    assert_eq!(v["provenance"]["arch"], "x64");
    assert_eq!(v["configuration"]["randomSeed"], 12);
    v
}
fn key(id: u32) -> String {
    let mut n = id;
    let mut digits = Vec::new();
    loop {
        digits.push(char::from_digit(n % 36, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    format!("c{}", digits.into_iter().rev().collect::<String>())
}
fn id_of(key: &str) -> u32 {
    u32::from_str_radix(key.strip_prefix('c').unwrap(), 36).unwrap()
}
fn player_id(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().unwrap() + 1)
}
fn label(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}
fn weapon(def: &str) -> crate::WeaponId {
    crate::WeaponId::parse(def).unwrap_or_else(|| panic!("unknown weapon {def}"))
}
fn faction(name: &str) -> FactionId {
    match name {
        "fire" => FactionId::Fire,
        "plague" => FactionId::Plague,
        "frost" => FactionId::Frost,
        "holy" => FactionId::Holy,
        "sentenced" => FactionId::Sentenced,
        other => panic!("{other}"),
    }
}
fn arena(c: &Value) -> Arena {
    let raw = include_str!("../../../../parity/initial-loot/input-map.json");
    let mut data: crate::mapdata::GameMapData = serde_json::from_str(raw).unwrap();
    data.ground_spots = c["configuration"]["groundSpots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| crate::mapdata::WorldPt {
            x: p["x"].as_f64().unwrap(),
            y: p["y"].as_f64().unwrap(),
        })
        .collect();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&data), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: data,
    }
    .validate()
    .unwrap();
    let (w, h, tiles, layers) = v.into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: crate::TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(std::sync::Arc::new(layers))
            .unwrap(),
        spawns,
    }
}
fn world_from(c: &Value) -> Sim {
    let p = &c["configuration"];
    let mut sim = Sim::new(
        SimConfig {
            initial_loot: true,
            min_players: p["config"]["minPlayers"].as_u64().unwrap() as usize,
            lobby_seconds: p["config"]["lobbySeconds"].as_f64().unwrap(),
            fill_seconds: p["config"]["fillSeconds"].as_f64().unwrap(),
            ..Default::default()
        },
        arena(c),
        Secrets {
            spawn_seed: p["randomSeed"].as_u64().unwrap() as u32,
            reward_salt: std::array::from_fn(|i| p["rewardSalt"][i].as_u64().unwrap() as u32),
            ..Secrets::from_seed(1)
        },
    );
    for p in c["configuration"]["players"].as_array().unwrap() {
        sim.add_player(
            p["id"].as_str().unwrap(),
            Some(faction(p["faction"].as_str().unwrap())),
            false,
        )
        .unwrap();
    }
    sim
}
fn status(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}
fn frame(sim: &Sim, ev: &[Event]) -> Value {
    let mut main = sim.w.spawn_rng.clone();
    let mut reward = sim.w.reward_rng.clone();
    let rng = json!({
        "random": std::array::from_fn::<f64, 4, _>(|_| main.next_f64()),
        "rewardRandom": std::array::from_fn::<f64, 4, _>(|_| reward.next_f64()),
    });
    json!({
        "tick": sim.w.tick,
        "time": sim.w.server_time,
        "serial": sim.w.entity_counter,
        "uid": sim.w.item_counter,
        "players": sim.w.players.iter().map(|p| json!({
            "id": label(p.id),
            "x": p.body.x,
            "y": p.body.y,
            "hp": p.vitals.hp,
            "maxHp": p.vitals.max_hp,
            "potionSmall": p.potion_small,
            "potionLarge": 0,
            "weapon0": p.weapon.weapon0.map_or("", |w| w.as_str()),
            "weapon1": p.weapon.weapon1.map_or("", |w| w.as_str()),
            "slot": p.weapon.slot,
            "readyAt": p.weapon.ready_at,
            "status": status(p.status),
        })).collect::<Vec<_>>(),
        "containers": sim.w.containers.iter().map(|c| json!({
            "id": key(c.id),
            "kind": match c.kind { ContainerKind::Ground => "ground", ContainerKind::Chest => "chest", ContainerKind::Body(_) => "body" },
            "x": c.at.x,
            "y": c.at.y,
            "opened": c.opened,
            "items": c.items.iter().map(|it| json!({"uid": format!("U{}", it.uid), "def": it.def.as_str()})).collect::<Vec<_>>(),
            "statOffer": c.stat_offer,
        })).collect::<Vec<_>>(),
        "notices": ev.iter().filter_map(|e| match e {
            Event::PickupRefused { id, reason, .. } => Some(json!({"to": sim.player_name(*id).unwrap(), "text": reason.message()})),
            Event::PotionNotice { id, notice } => Some(json!({"to": sim.player_name(*id).unwrap(), "text": notice.message()})),
            _ => None,
        }).collect::<Vec<_>>(),
        "rng": rng,
    })
}
fn expected(f: &Value) -> Value {
    let mut f = f.clone();
    f.as_object_mut().unwrap().remove("label");
    f.get_mut("rng")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .remove("questRandom");
    f
}
fn exact(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(
            a.as_f64().unwrap().to_bits(),
            b.as_f64().unwrap().to_bits(),
            "{path}: {a} != {b}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                exact(a, b, &format!("{path}[{i}]"))
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path} keys"
            );
            for (k, a) in a {
                exact(a, &b[k], &format!("{path}.{k}"))
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}
fn setup_player(sim: &mut Sim, a: &Value) {
    let id = player_id(a["actor"].as_str().unwrap());
    let i = sim.w.idx(id).expect("setup player");
    let now = sim.w.server_time;
    let p = &mut sim.w.players[i];
    if a["at"].is_object() {
        let at = Vec2::new(
            a["at"]["x"].as_f64().unwrap(),
            a["at"]["y"].as_f64().unwrap(),
        );
        p.body.x = at.x;
        p.body.y = at.y;
        p.body.history.reset(Sample {
            t: now,
            x: at.x,
            y: at.y,
        });
        p.motion.path.clear();
    }
    if let Some(hp) = a["hp"].as_f64() {
        p.vitals.hp = hp;
    }
    if let Some(w) = a["weapon0"].as_str() {
        p.weapon.weapon0 = Some(weapon(w));
    }
    if let Some(w) = a["weapon1"].as_str() {
        p.weapon.weapon1 = Some(weapon(w));
    }
    if let Some(slot) = a["slot"].as_u64() {
        p.weapon.slot = slot as u8;
    }
    if let Some(n) = a["potionSmall"].as_u64() {
        p.potion_small = n as u8;
    }
}
fn setup_container(sim: &mut Sim, a: &Value) {
    let kind = match a["kindOf"].as_str().unwrap() {
        "chest" => ContainerKind::Chest,
        "ground" => ContainerKind::Ground,
        other => panic!("{other}"),
    };
    let at = Vec2::new(
        a["at"]["x"].as_f64().unwrap(),
        a["at"]["y"].as_f64().unwrap(),
    );
    let items: Vec<crate::WeaponId> = a["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| weapon(v.as_str().unwrap()))
        .collect();
    assert_eq!(items.len(), 1, "declared container weapon");
    let stepping = a["stepping"].as_bool().unwrap_or(false);
    let _held = a["hold"].as_bool().unwrap_or(false);
    // Native container births: an inside-tick chest is held one extra tick (legacy holdBirth's chest producer) and a
    // between-tick container waits through the next tick; both map to blocked_through's tick+1.
    let tick = sim.w.tick;
    crate::systems::items::add_container(
        &mut sim.w,
        kind,
        at,
        [Some(items[0]), None],
        tick,
        !stepping,
    );
}
fn act(sim: &mut Sim, a: &Value) -> Vec<Event> {
    match a["kind"].as_str().unwrap() {
        "step" => {
            for c in a["commands"].as_array().unwrap_or(&Vec::new()) {
                let raw = match c["type"].as_str().unwrap() {
                    "pickup" => RawCommand::Pickup {
                        container_id: id_of(c["payload"]["containerId"].as_str().unwrap()),
                    },
                    "swap" => RawCommand::Swap {
                        slot: c["payload"]["slot"].as_u64().map(|v| v as u8),
                    },
                    other => panic!("unconsumed loot command {other}"),
                };
                sim.submit(
                    player_id(c["actor"].as_str().unwrap()),
                    validate(raw).unwrap(),
                )
                .unwrap();
            }
            sim.step()
        }
        "kick" => {
            sim.remove_player(player_id(a["actor"].as_str().unwrap()));
            sim.take_events()
        }
        "setupPlayer" => {
            setup_player(sim, a);
            sim.take_events()
        }
        "grant" => {
            assert_eq!(a["card"].as_str().unwrap(), "committed");
            assert!(crate::cards::grant(
                &sim.k,
                &mut sim.w,
                player_id(a["actor"].as_str().unwrap()),
                crate::cards::CardId::Committed
            ));
            sim.take_events()
        }
        "addContainer" => {
            setup_container(sim, a);
            sim.take_events()
        }
        other => panic!("unconsumed loot action {other}"),
    }
}
/// Replay one declared case from its constructor, comparing every frame with the actual source output.
fn replay(c: &Value, case: &Value) -> Sim {
    let frames = case["frames"].as_array().unwrap();
    let name = case["name"].as_str().unwrap();
    let mut sim = world_from(c);
    exact(
        &frame(&sim, &[]),
        &expected(&frames[0]),
        &format!("{name}/lobby"),
    );
    let ev = sim.step();
    exact(
        &frame(&sim, &ev),
        &expected(&frames[1]),
        &format!("{name}/birth"),
    );
    let mut i = 2;
    for (n, a) in case["input"]["setup"]
        .as_array()
        .unwrap()
        .iter()
        .chain(case["input"]["actions"].as_array().unwrap())
        .enumerate()
    {
        let ev = act(&mut sim, a);
        exact(
            &frame(&sim, &ev),
            &expected(&frames[i]),
            &format!("{name}/frame-{n}"),
        );
        i += 1;
    }
    assert_eq!(i, frames.len(), "{name}: every declared frame consumed");
    sim
}
#[test]
fn loot_world_runtime_matches_the_actual_source() {
    let c = corpus();
    for case in c["cases"].as_array().unwrap() {
        replay(&c, case);
    }
}
#[test]
fn committed_second_slot_lock_and_container_births_are_load_bearing() {
    let c = corpus();
    // Mutation guard 1: without the actual Committed grant the ported pickup fills the unlocked second slot, so the
    // first post-setup frame diverges from the source. The flag consumer is what the witness pins.
    let case = c["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c2| c2["name"] == "committed-lock-second-slot")
        .unwrap();
    let frames = case["frames"].as_array().unwrap();
    let mut sim = world_from(&c);
    sim.step();
    setup_player(&mut sim, &case["input"]["setup"][0]);
    sim.take_events();
    // The grant is deliberately skipped.
    let ev = act(&mut sim, &case["input"]["actions"][0]);
    let got = frame(&sim, &ev);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| exact(
            &got,
            &expected(&frames[2 + case["input"]["setup"].as_array().unwrap().len()]),
            "mutated/committed-absent"
        )))
        .is_err(),
        "an omitted Committed grant must not reproduce the locked-slot frame"
    );
    // Mutation guard 2: forcing the between-tick body to a takeable birth makes the waiting tick loot it, diverging
    // from the source frame. The born-tick gate is what the witness pins.
    let case = c["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c2| c2["name"] == "body-drop-and-pickup")
        .unwrap();
    let frames = case["frames"].as_array().unwrap();
    let mut sim = world_from(&c);
    sim.step();
    for a in case["input"]["setup"].as_array().unwrap() {
        setup_player(&mut sim, a);
        sim.take_events();
    }
    act(&mut sim, &case["input"]["actions"][0]); // the real between-tick departure
    for c2 in sim.w.containers.iter_mut() {
        if matches!(c2.kind, ContainerKind::Body(_)) {
            c2.born_tick = 0; // as if the container had been takeable at once
        }
    }
    let ev = act(&mut sim, &case["input"]["actions"][1]);
    let got = frame(&sim, &ev);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| exact(
            &got,
            &expected(&frames[3 + case["input"]["setup"].as_array().unwrap().len()]),
            "mutated/early-birth"
        )))
        .is_err(),
        "a body without its one-tick birth wait must not reproduce the refused frame"
    );
}
