//! Pinned-container replay of the G6 heal-barrier corpus (`parity/heal-barrier/runtime.json`): the declared setup and
//! real producers are applied through the port's own heal funnel, grant, damage and down producers, then every captured
//! public player fact and the private boost timer are compared.
use crate::input::{validate, RawCommand, TrainRaw};
use crate::state::{Sample, Status};
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};
use serde_json::{json, Value};

fn arena() -> Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
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
        .expect("seed 1 attempt 0");
    let hash = u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap();
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map,
    }
    .validate()
    .expect("admitted")
    .into_arena()
    .expect("arena")
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

fn phase_name(phase: crate::Phase) -> &'static str {
    match phase {
        crate::Phase::Lobby => "lobby",
        crate::Phase::Planning => "planning",
        crate::Phase::Active => "active",
        crate::Phase::Ended => "ended",
    }
}

fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

fn weapon_str(w: Option<crate::WeaponId>) -> &'static str {
    w.map_or("", |w| w.as_str())
}

fn observed(sim: &Sim, training: bool, slots: usize) -> Value {
    let players: Vec<Value> = (0..slots)
        .map(|i| {
            let Some(p) = sim.w.players.as_slice().get(i) else {
                return Value::Null;
            };
            let boost = if !(p.barrier_until > 0.) {
                Value::Null
            } else {
                json!({"shieldUntil": r6(p.barrier_until), "decays": p.barrier_decays})
            };
            let mut row = json!({
                "id": p.core.id.0 as usize - 1,
                "faction": p.vitals.faction.as_str(),
                "x": r6(p.body.x),
                "y": r6(p.body.y),
                "hp": r6(p.vitals.hp),
                "maxHp": r6(p.vitals.max_hp),
                "barrier": r6(p.vitals.barrier),
                "status": status_name(p.status),
                "slot": p.weapon.slot,
                "weapon0": weapon_str(p.weapon.weapon0),
                "weapon1": weapon_str(p.weapon.weapon1),
                "potionSmall": p.potion_small,
                "boost": boost,
            });
            if training {
                let obj = row.as_object_mut().unwrap();
                for key in [
                    "x",
                    "y",
                    "faction",
                    "slot",
                    "weapon0",
                    "weapon1",
                    "potionSmall",
                ] {
                    obj.remove(key);
                }
            }
            row
        })
        .collect();
    json!({"phase": phase_name(sim.w.phase), "players": players})
}

fn diff(got: &Value, want: &Value, path: &str) -> Option<String> {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if (a - b).abs() > 1e-6 {
                return Some(format!("{path}: got {a} want {b}"));
            }
            None
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path}: length {} != {}", a.len(), b.len()));
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (x, y))| diff(x, y, &format!("{path}[{i}]")))
        }
        (Value::Object(a), Value::Object(b)) => {
            for (key, x) in a {
                let Some(y) = b.get(key) else {
                    return Some(format!("{path}.{key}: missing"));
                };
                if let Some(d) = diff(x, y, &format!("{path}.{key}")) {
                    return Some(d);
                }
            }
            for key in b.keys() {
                if !a.contains_key(key) {
                    return Some(format!("{path}.{key}: unexpected"));
                }
            }
            None
        }
        (a, b) if a == b => None,
        (a, b) => Some(format!("{path}: got {a} want {b}")),
    }
}

fn sim_for(case: &Value) -> Sim {
    let input = &case["input"];
    let training = input["training"].as_bool().unwrap_or(false);
    if training {
        let config = SimConfig {
            min_players: 1,
            lobby_seconds: 0.,
            fill_seconds: 0.,
            training: true,
            dummies: true,
            pvp_rules: false,
            ..Default::default()
        };
        let mut sim = Sim::new(
            config,
            crate::arenas::practice_arena(),
            Secrets {
                order_salt: crate::rng::Mulberry32::new(12).next_u32(),
                spawn_seed: 0,
                reward_salt: [1, 2, 3, 4],
            },
        );
        sim.add_player("p0", Some(FactionId::Holy), false).unwrap();
        sim.step();
        return sim;
    }
    let cfg = &input["config"];
    let patience = cfg["patienceSeconds"].as_f64().unwrap();
    let lifecycle = if (patience - 3600.).abs() > 1e-9 {
        crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: cfg["planSeconds"].as_f64().unwrap_or(0.),
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: patience,
            patience_min_seconds: cfg["patienceMinSeconds"].as_f64().unwrap(),
            sudden_death_seconds: cfg["suddenDeathSeconds"].as_f64().unwrap(),
        })
    } else {
        crate::ArenaMode::Off
    };
    let placements: Vec<Placement> = input["initial"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Placement {
            profile: p["faction"].as_str().unwrap().into(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            quests: cfg["quests"].as_bool().unwrap_or(false),
            mob_mode: if cfg["mobs"].as_bool().unwrap_or(false) {
                crate::mob_runtime::MobMode::Pve
            } else {
                crate::mob_runtime::MobMode::Off
            },
            initial_loot: true,
            pvp_rules: false,
            min_players: cfg["minPlayers"].as_u64().unwrap_or(2) as usize,
            lobby_seconds: cfg["lobbySeconds"].as_f64().unwrap_or(30.),
            fill_seconds: cfg["fillSeconds"].as_f64().unwrap_or(0.),
            lifecycle,
            faction_mode: if cfg["signatures"].as_bool().unwrap_or(false) {
                crate::FactionMode::EngagementHolyPlagueFireFrostSentenced
            } else {
                crate::FactionMode::Off
            },
            ..Default::default()
        },
        arena(),
        Secrets {
            order_salt: crate::rng::Mulberry32::new(12).next_u32(),
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &placements,
    )
}

fn apply(sim: &mut Sim, action: &Value) {
    let actor = action["actor"].as_u64().unwrap_or(0) as usize;
    let mut ev = Vec::new();
    match action["kind"].as_str().unwrap() {
        "place" => {
            let x = action["x"].as_f64().unwrap();
            let y = action["y"].as_f64().unwrap();
            let now = sim.w.server_time;
            let p = &mut sim.w.players[actor];
            p.body.x = x;
            p.body.y = y;
            p.body.facing = 0.;
            p.body.history.reset(Sample { t: now, x, y });
        }
        "weapon" => {
            let weapon =
                crate::content::WeaponId::parse(action["weapon"].as_str().unwrap()).unwrap();
            let p = &mut sim.w.players[actor];
            p.weapon.weapon0 = Some(weapon);
            p.weapon.weapon1 = None;
            p.weapon.slot = 0;
        }
        "grantCard" => {
            let name = action["card"].as_str().unwrap();
            let card = crate::cards::CardId::ALL
                .iter()
                .copied()
                .find(|c| c.as_str() == name)
                .expect("catalog card");
            assert!(crate::cards::grant(
                &sim.k,
                &mut sim.w,
                PlayerId(actor as u32 + 1),
                card
            ));
        }
        "heal" => {
            let amount = action["amount"].as_f64().unwrap();
            let kind = match action["healKind"].as_str().unwrap() {
                "ordinary" => crate::systems::heal::Kind::Ordinary,
                "lifesteal" => crate::systems::heal::Kind::Lifesteal,
                "ignoreLockout" => crate::systems::heal::Kind::IgnoreLockout,
                "quietRegen" => crate::systems::heal::Kind::QuietRegen,
                "quietOrdinary" => crate::systems::heal::Kind::QuietOrdinary,
                other => panic!("heal kind {other}"),
            };
            crate::systems::heal::apply(&mut sim.w, &mut ev, actor, amount, kind);
        }
        "setHp" => sim.w.players[actor].vitals.hp = action["hp"].as_f64().unwrap(),
        "setMaxHp" => sim.w.players[actor].vitals.max_hp = action["maxHp"].as_f64().unwrap(),
        "setBarrier" => {
            let p = &mut sim.w.players[actor];
            p.vitals.barrier = action["barrier"].as_f64().unwrap();
            p.barrier_until = action["until"].as_f64().unwrap_or(0.);
            p.barrier_decays = action["decays"].as_bool().unwrap_or(false);
        }
        "setImmunity" => {
            sim.w.players[actor].vitals.immune_until = action["until"].as_f64().unwrap()
        }
        "damage" => {
            let amount = action["amount"].as_f64().unwrap();
            crate::systems::ledger::apply_declared_hit(&sim.k, &mut sim.w, &mut ev, actor, amount);
        }
        "down" => {
            crate::systems::settle::down_player(
                &sim.k,
                &mut sim.w,
                &mut ev,
                None,
                actor,
                crate::results::Outcome::Died,
            );
        }
        "train" => {
            let raw = TrainRaw {
                command: 5,
                id: 0,
                count: 0,
                options: [0; 3],
                option_count: 0,
            };
            sim.submit(
                PlayerId(actor as u32 + 1),
                validate(RawCommand::Train(raw)).expect("valid train"),
            )
            .expect("training world accepts the console");
        }
        "input" => {
            let payload = &action["payload"];
            let raw = RawCommand::Attack {
                a: payload["a"].as_f64().unwrap(),
                t: None,
            };
            sim.submit(PlayerId(actor as u32 + 1), validate(raw).unwrap())
                .unwrap();
        }
        other => panic!("unexpected captured action {other}"),
    }
}

#[test]
fn the_captured_heal_barrier_lifecycle_replays_through_the_real_producers() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/heal-barrier/runtime.json"
    );
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("heal-barrier corpus"))
            .expect("json");
    assert_eq!(doc["format"], "rh-heal-barrier-source/1");
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let training = case["input"]["training"].as_bool().unwrap_or(false);
        let mut sim = sim_for(case);
        let actions = case["actions"].as_array().unwrap();
        let mut ai = 0usize;
        for frame in case["frames"].as_array().unwrap() {
            let target = frame["tick"].as_u64().unwrap() as u32;
            let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
            while ai < want_actions {
                let action = &actions[ai];
                let tick = action["tick"].as_u64().unwrap() as u32;
                while sim.w.tick < tick {
                    sim.step();
                }
                apply(&mut sim, action);
                ai += 1;
            }
            while sim.w.tick < target {
                sim.step();
            }
            let slots = frame["players"].as_array().unwrap().len();
            let mut got = observed(&sim, training, slots);
            let mut want = json!({"phase": frame["phase"], "players": frame["players"]});
            // The coliseum teleport's target positions belong to the arena producer's own (already separate) parity
            // surface; this case pins that the barrier and its private timer survive the real teleport, not the spot math.
            if name == "teleport-survival" {
                for value in [&mut got, &mut want] {
                    for p in value["players"].as_array_mut().unwrap() {
                        if let Some(obj) = p.as_object_mut() {
                            obj.remove("x");
                            obj.remove("y");
                        }
                    }
                }
            }
            if training {
                for p in want["players"].as_array_mut().unwrap() {
                    let Some(obj) = p.as_object_mut() else {
                        continue;
                    };
                    for key in [
                        "x",
                        "y",
                        "faction",
                        "slot",
                        "weapon0",
                        "weapon1",
                        "potionSmall",
                    ] {
                        obj.remove(key);
                    }
                }
            }
            if let Some(d) = diff(&got, &want, "") {
                panic!("{name}: frame {} at tick {target}: {d}", frame["label"]);
            }
        }
    }
}
