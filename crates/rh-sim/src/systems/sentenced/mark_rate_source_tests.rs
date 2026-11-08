//! Pinned actual-source Gathering Storm / MarkRate consumer: replays `parity/mark-rate/runtime.json` against the real
//! Sentenced/Frost production path (validated target/attack/swap inputs, real card grants and Training Clear).
use crate::input::{validate as validate_command, RawCommand, TrainRaw};
use crate::state::Sample;
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

fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}
fn ord(id: Option<PlayerId>) -> Option<u64> {
    id.map(|p| p.0 as u64 - 1)
}
fn phase_name(p: crate::Phase) -> &'static str {
    match p {
        crate::Phase::Lobby => "lobby",
        crate::Phase::Planning => "planning",
        crate::Phase::Active => "active",
        crate::Phase::Ended => "ended",
    }
}
fn status_name(s: crate::state::Status) -> &'static str {
    match s {
        crate::state::Status::Lobby => "lobby",
        crate::state::Status::Alive => "alive",
        crate::state::Status::Dead => "dead",
        crate::state::Status::Mia => "mia",
    }
}

fn profile(input: &Value) -> Sim {
    let training = input["training"].as_bool().unwrap_or(false);
    let config = SimConfig {
        training,
        dummies: training,
        quests: false,
        consumables: false,
        pvp_rules: false,
        min_players: 2,
        lobby_seconds: 30.,
        fill_seconds: 0.,
        faction_mode: crate::FactionMode::EngagementHolyPlagueFireFrostSentenced,
        ..Default::default()
    };
    let secrets = Secrets {
        order_salt: crate::rng::Mulberry32::new(12).next_u32(),
        spawn_seed: 0,
        reward_salt: [1, 2, 3, 4],
    };
    let initial = input["initial"].as_array().unwrap();
    if training {
        let mut sim = Sim::new(config, arena(), secrets);
        sim.add_player("p0", Some(FactionId::Sentenced), false)
            .unwrap();
        sim.add_player("p1", Some(FactionId::Frost), false).unwrap();
        sim.step();
        return sim;
    }
    let placements: Vec<Placement> = initial
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
    Sim::reset_active(config, arena(), secrets, &placements)
}

fn view(sim: &Sim) -> Value {
    let players: Vec<Value> = sim.w.players.iter().map(|p| {
        let tier = super::public_mark_tier(&sim.w, p.id);
        json!({
            "id": p.core.id.0 as u64 - 1,
            "faction": p.vitals.faction.as_str(),
            "hp": r6(p.vitals.hp), "maxHp": r6(p.vitals.max_hp), "status": status_name(p.status),
            "weapon0": p.weapon.weapon0.map_or("", |w| w.as_str()),
            "weapon1": p.weapon.weapon1.map_or("", |w| w.as_str()),
            "slot": p.weapon.slot,
            "public": {
                "sig": p.signature.bits,
                "markTier": tier,
                "brand": tier * 25,
                "markBy": ord(super::public_mark_by(&sim.w, p.id, tier, |_| true)),
                "markTax": 0,
            },
            "mark": {
                "target": ord(p.signature.target),
                "tier": p.signature.mark.tier,
                "hits": p.signature.mark.hits,
                "progress": r6(p.signature.mark.progress),
                "swaps": p.signature.mark.swaps,
                "denied": p.signature.mark.denied,
                "farSince": p.signature.mark.far_since.map(r6),
                "ampUntil": r6(p.signature.mark.amp_until),
                "chill": r6(p.signature.chill),
            },
        })
    }).collect();
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
            for (k, x) in a {
                let Some(y) = b.get(k) else {
                    return Some(format!("{path}.{k}: missing"));
                };
                if let Some(d) = diff(x, y, &format!("{path}.{k}")) {
                    return Some(d);
                }
            }
            for k in b.keys() {
                if !a.contains_key(k) {
                    return Some(format!("{path}.{k}: unexpected"));
                }
            }
            None
        }
        (a, b) if a == b => None,
        (a, b) => Some(format!("{path}: got {a} want {b}")),
    }
}

fn apply(sim: &mut Sim, action: &Value) {
    let actor = action["actor"].as_u64().unwrap_or(0) as usize;
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
            let w0 = crate::content::WeaponId::parse(action["weapon0"].as_str().unwrap()).unwrap();
            let w1 = action["weapon1"].as_str().unwrap();
            let p = &mut sim.w.players[actor];
            p.weapon.weapon0 = Some(w0);
            p.weapon.weapon1 = crate::content::WeaponId::parse(w1);
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
        "train" => {
            let raw = RawCommand::Train(TrainRaw {
                command: 5,
                id: 0,
                count: 0,
                options: [0; 3],
                option_count: 0,
            });
            sim.submit(PlayerId(actor as u32 + 1), validate_command(raw).unwrap())
                .unwrap();
        }
        "input" => {
            let payload = &action["payload"];
            let raw = match action["type"].as_str().unwrap() {
                "target" => RawCommand::Target {
                    id: PlayerId(
                        payload["id"]
                            .as_str()
                            .unwrap()
                            .trim_start_matches('p')
                            .parse::<u32>()
                            .unwrap()
                            + 1,
                    ),
                },
                "attack" => RawCommand::Attack {
                    a: payload["a"].as_f64().unwrap(),
                    t: None,
                },
                "swap" => RawCommand::Swap { slot: None },
                other => panic!("input {other}"),
            };
            sim.submit(PlayerId(actor as u32 + 1), validate_command(raw).unwrap())
                .unwrap();
        }
        other => panic!("unexpected action {other}"),
    }
}

#[test]
fn the_real_gathering_storm_timelines_replay_against_actual_source() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/mark-rate/runtime.json"
    );
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("mark-rate corpus"))
            .expect("json");
    assert_eq!(doc["format"], "rh-mark-rate-source/1");
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let mut sim = profile(&case["input"]);
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
            let mut got = view(&sim);
            let mut want = json!({"phase": frame["phase"], "players": frame["players"]});
            for v in [&mut got, &mut want] {
                for p in v["players"].as_array_mut().unwrap() {
                    let Some(o) = p.as_object_mut() else { continue };
                    o.remove("x");
                    o.remove("y");
                }
            }
            // The source start frames predate the factions runtime: there is no Mark state to compare there.
            let source_players = want["players"].as_array().unwrap().clone();
            for (i, src) in source_players.iter().enumerate() {
                if src.get("mark").is_none_or(|m| m.is_null()) {
                    if let Some(o) = got["players"][i].as_object_mut() {
                        o.remove("mark");
                    }
                    if let Some(o) = want["players"][i].as_object_mut() {
                        o.remove("mark");
                    }
                }
            }
            // Source start frames have no factions runtime yet; compare the public/player facts there and the full
            // Mark state on every later frame.
            if let Some(d) = diff(&got, &want, "") {
                panic!("{name}: frame {} at tick {target}: {d}", frame["label"]);
            }
        }
    }
}
