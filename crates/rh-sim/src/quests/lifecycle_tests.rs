//! The pinned-container lifecycle witness: replays `parity/quests/lifecycle.json` through the real C-INPUT door and the
//! ported hooks/systems, comparing the captured source surfaces at every captured tick (public quest rows, the private
//! offer table, givers, quest containers, players' GV/farm facts).
use super::catalog;
use super::live::Status;
use crate::input::{validate, RawCommand};
use crate::{Arena, FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

fn load() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/quests/lifecycle.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("quest lifecycle corpus"))
        .expect("json")
}

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

fn player(ordinal: u64) -> PlayerId {
    PlayerId(ordinal as u32 + 1)
}

fn ordinal(sim: &Sim, id: PlayerId) -> Option<u64> {
    (0..3u64).find(|i| sim.w.players[*i as usize].id == id)
}

fn status_str(status: Status) -> &'static str {
    match status {
        Status::Open => "open",
        Status::Done => "done",
        Status::Expired => "expired",
    }
}

fn status_name(status: crate::state::Status) -> &'static str {
    match status {
        crate::state::Status::Alive => "alive",
        crate::state::Status::Dead => "dead",
        crate::state::Status::Mia => "mia",
        crate::state::Status::Lobby => "lobby",
    }
}

fn def_of(offer: &serde_json::Value) -> &str {
    offer["def"].as_str().unwrap()
}

fn sorted_by_def(mut rows: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    rows.sort_by(|a, b| def_of(a).cmp(def_of(b)));
    rows
}

fn ms(value: f64) -> f64 {
    (value * 1000.).round() / 1000.
}

/// JSON integers and floats compare unequal in serde_json; the captured schema mixes both, so coerce to f64.
fn num(value: &serde_json::Value) -> serde_json::Value {
    serde_json::json!(value.as_f64().unwrap())
}

fn point(row: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"x": num(&row["x"]), "y": num(&row["y"])})
}

fn snapshot(sim: &Sim) -> serde_json::Value {
    let q = sim.w.quests.as_ref().expect("quest runtime");
    let offers = &q.offers;
    let public = sorted_by_def(
        offers
            .iter()
            .filter(|o| o.published)
            .map(|o| {
                let def = &catalog::DEFINITION[o.def as usize];
                let mut accepted: Vec<u64> = o
                    .accepted
                    .iter()
                    .filter_map(|id| ordinal(sim, *id))
                    .collect();
                accepted.sort_unstable();
                let mut progress: Vec<(u64, u32)> = o
                    .progress
                    .iter()
                    .filter_map(|(id, n)| ordinal(sim, *id).map(|ord| (ord, *n)))
                    .collect();
                progress.sort_unstable();
                let mut visited: Vec<(u64, String)> = o
                    .visits
                    .iter()
                    .filter_map(|(id, mask)| {
                        let ord = ordinal(sim, *id)?;
                        let zones: Vec<&'static str> = (0..5u8)
                            .filter(|bit| mask & (1 << bit) != 0)
                            .map(|bit| FactionId::ALL[bit as usize].as_str())
                            .collect();
                        Some((ord, zones.join(",")))
                    })
                    .collect();
                visited.sort_by_key(|(ord, _)| *ord);
                serde_json::json!({
                    "def": def.id,
                    "x": o.at.x,
                    "y": o.at.y,
                    "status": status_str(o.status),
                    "doneBy": o.done_by.and_then(|id| ordinal(sim, id)).map(|n| format!("name{n}")).unwrap_or_default(),
                    "expiresAt": ms(o.expires_at),
                    "carrier": o.carrier.and_then(|id| ordinal(sim, id)).map(|n| format!("p{n}")).unwrap_or_default(),
                    "progress": progress,
                    "accepted": accepted,
                    "visitedRegions": visited,
                })
            })
            .collect::<Vec<_>>(),
    );
    let unknown = offers.iter().filter(|o| !o.published).count();
    let givers = sorted_by_def(
        offers
            .iter()
            .filter(|o| o.npc_alive)
            .map(|o| {
                let def = &catalog::DEFINITION[o.def as usize];
                serde_json::json!({"def": def.id, "name": def.giver, "x": o.at.x, "y": o.at.y})
            })
            .collect(),
    );
    let mut containers: Vec<serde_json::Value> = sim
        .w
        .containers
        .iter()
        .filter(|c| c.kind == crate::ContainerKind::Quest)
        .filter_map(|c| {
            let crate::initial_world::ItemDef::Quest(quest) = c.items.first()?.def else {
                return None;
            };
            let offer = offers.iter().find(|o| o.id == quest)?;
            let def = &catalog::DEFINITION[offer.def as usize];
            Some(serde_json::json!({"def": def.id, "x": c.at.x, "y": c.at.y}))
        })
        .collect();
    containers.sort_by(|a, b| {
        def_of(a).cmp(def_of(b)).then(
            a["x"]
                .as_f64()
                .unwrap()
                .total_cmp(&b["x"].as_f64().unwrap()),
        )
    });
    let private = sorted_by_def(
        offers
            .iter()
            .map(|o| {
                let def = &catalog::DEFINITION[o.def as usize];
                serde_json::json!({
                    "def": def.id,
                    "published": o.published,
                    "npcId": if o.npc_alive { "m" } else { "" },
                    "finder": o.finder.and_then(|id| ordinal(sim, id)).map(|n| format!("p{n}")).unwrap_or_default(),
                    "publishAt": ms(o.publish_at),
                    "at": {"x": o.at.x, "y": o.at.y},
                    "tokens": o.tokens.iter().map(|p| serde_json::json!({"x": p.x, "y": p.y})).collect::<Vec<_>>(),
                    "parcel": o.parcel.map(|p| serde_json::json!({"x": p.x, "y": p.y})),
                    "lastCarrier": o.last_carrier.and_then(|id| ordinal(sim, id)).map(|n| format!("p{n}")).unwrap_or_default(),
                })
            })
            .collect(),
    );
    let players: Vec<serde_json::Value> = (0..3usize)
        .map(|i| {
            let p = &sim.w.players[i];
            let mut stats = serde_json::Map::new();
            for row in crate::modifiers::farm::DEFINITION.rows {
                let count = p.farm.count(row.mob);
                if count > 0 {
                    stats.insert(row.mob.as_str().to_string(), serde_json::json!(count));
                }
            }
            serde_json::json!({
                "id": i,
                "name": format!("name{i}"),
                "faction": p.vitals.faction.as_str(),
                "status": status_name(p.status),
                "resolved": p.resolved,
                "gv": {
                    "kills": p.credit.gv_parts.kills,
                    "mobs": p.credit.gv_parts.mobs,
                    "bounty": p.credit.gv_parts.bounty,
                    "quest": p.credit.gv_parts.quest,
                },
                "stats": serde_json::Value::Object(stats),
            })
        })
        .collect();
    serde_json::json!({
        "unknown": unknown,
        "quests": public,
        "givers": givers,
        "containers": containers,
        "players": players,
        "privateOffers": private,
        "time": ms(sim.w.server_time),
    })
}

fn normalize_expected(frame: &serde_json::Value) -> serde_json::Value {
    let quests: Vec<serde_json::Value> = {
        let mut rows: Vec<serde_json::Value> = frame["quests"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                let accepted: Vec<u64> = row["accepted"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap()[1..].parse::<u64>().unwrap())
                    .collect();
                let progress: Vec<(u64, u32)> = row["progress"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|pair| {
                        let pid = pair[0].as_str().unwrap();
                        (
                            pid[1..].parse::<u64>().unwrap(),
                            pair[1].as_u64().unwrap() as u32,
                        )
                    })
                    .collect();
                let visited: Vec<(u64, String)> = row["visitedRegions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|pair| {
                        let pid = pair[0].as_str().unwrap();
                        (
                            pid[1..].parse::<u64>().unwrap(),
                            pair[1].as_str().unwrap().to_string(),
                        )
                    })
                    .collect();
                serde_json::json!({
                    "def": row["def"],
                    "x": num(&row["x"]),
                    "y": num(&row["y"]),
                    "status": row["status"],
                    "doneBy": row["doneBy"],
                    "expiresAt": ms(row["expiresAt"].as_f64().unwrap()),
                    "carrier": row["carrier"],
                    "progress": progress,
                    "accepted": accepted,
                    "visitedRegions": visited,
                })
            })
            .collect();
        rows.sort_by(|a, b| def_of(a).cmp(def_of(b)));
        rows
    };
    let givers = sorted_by_def(
        frame["givers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                serde_json::json!({"def": row["def"], "name": row["name"], "x": num(&row["x"]), "y": num(&row["y"])})
            })
            .collect(),
    );
    let containers = {
        let mut rows: Vec<serde_json::Value> = frame["containers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| serde_json::json!({"def": row["def"], "x": num(&row["x"]), "y": num(&row["y"])}))
            .collect();
        rows.sort_by(|a, b| {
            def_of(a).cmp(def_of(b)).then(
                a["x"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b["x"].as_f64().unwrap()),
            )
        });
        rows
    };
    let private = {
        let mut rows: Vec<serde_json::Value> = frame["privateOffers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                let tokens: Vec<serde_json::Value> = row["tokens"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(point)
                    .collect();
                let parcel = row["parcel"].as_object().map(|_| point(&row["parcel"]));
                serde_json::json!({
                    "def": row["def"],
                    "published": row["published"],
                    "npcId": if row["npcId"].as_str().unwrap().is_empty() { "" } else { "m" },
                    "finder": row["finder"],
                    "publishAt": ms(row["publishAt"].as_f64().unwrap()),
                    "at": point(&row["at"]),
                    "tokens": tokens,
                    "parcel": parcel,
                    "lastCarrier": row["lastCarrier"],
                })
            })
            .collect();
        rows.sort_by(|a, b| def_of(a).cmp(def_of(b)));
        rows
    };
    serde_json::json!({
        "unknown": frame["unknown"],
        "quests": quests,
        "givers": givers,
        "containers": containers,
        "players": frame["players"],
        "privateOffers": private,
        "time": ms(frame["time"].as_f64().unwrap()),
    })
}

fn place(sim: &mut Sim, actor: u64, at: Vec2) {
    let i = actor as usize;
    let now = sim.w.server_time;
    let p = &mut sim.w.players[i];
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
}

/// The capture's declared bootstrap writes the source state's weapon slot; no swap action or lock is involved.
fn set_weapon(sim: &mut Sim, actor: u64, weapon: &str) {
    let parsed = crate::content::WeaponId::parse(weapon).expect("captured weapon");
    let i = actor as usize;
    let p = &mut sim.w.players[i];
    p.weapon.weapon0 = Some(parsed);
    p.weapon.weapon1 = None;
    p.weapon.slot = 0;
}

fn quest_def_for_id(case: &serde_json::Value, id: &str) -> String {
    for frame in case["frames"].as_array().unwrap() {
        for offer in frame["privateOffers"].as_array().unwrap() {
            if offer["id"].as_str().unwrap() == id {
                return offer["def"].as_str().unwrap().to_string();
            }
        }
    }
    panic!("no offer id {id} in the case");
}

/// The captured quest container id -> (offer def, its placed spot): the spot survives the runtime's list shrinking.
fn container_lookup(
    case: &serde_json::Value,
) -> std::collections::BTreeMap<String, (String, f64, f64)> {
    let mut out = std::collections::BTreeMap::new();
    for frame in case["frames"].as_array().unwrap() {
        for row in frame["containers"].as_array().unwrap() {
            out.entry(row["id"].as_str().unwrap().to_string())
                .or_insert_with(|| {
                    (
                        row["def"].as_str().unwrap().to_string(),
                        row["x"].as_f64().unwrap(),
                        row["y"].as_f64().unwrap(),
                    )
                });
        }
    }
    out
}

fn rust_offer(sim: &Sim, def: &str) -> usize {
    let index = catalog::DEFINITION
        .iter()
        .position(|d| d.id == def)
        .unwrap_or_else(|| panic!("catalog def {def}")) as u16;
    sim.w
        .quests
        .as_ref()
        .expect("quest runtime")
        .offers
        .iter()
        .position(|o| o.def == index)
        .unwrap_or_else(|| panic!("rust offer for {def}"))
}

fn apply_action(
    sim: &mut Sim,
    case: &serde_json::Value,
    containers: &std::collections::BTreeMap<String, (String, f64, f64)>,
    action: &serde_json::Value,
) {
    match action["kind"].as_str().unwrap() {
        "place" => place(
            sim,
            action["actor"].as_u64().unwrap(),
            Vec2::new(action["x"].as_f64().unwrap(), action["y"].as_f64().unwrap()),
        ),
        "hp" => {
            let i = action["actor"].as_u64().unwrap() as usize;
            sim.w.players[i].vitals.hp = action["hp"].as_f64().unwrap();
        }
        "weapon" => set_weapon(
            sim,
            action["actor"].as_u64().unwrap(),
            action["weapon"].as_str().unwrap(),
        ),
        "expireSoon" => {
            let def = quest_def_for_id(case, action["quest"].as_str().unwrap());
            let oi = rust_offer(sim, &def);
            sim.w.quests.as_mut().unwrap().offers[oi].expires_at =
                sim.w.server_time + action["ms"].as_f64().unwrap();
        }
        "teleport" => {
            crate::hooks::fire(
                &mut crate::hooks::Hx {
                    stats: Default::default(),
                    k: &sim.k,
                    w: &mut sim.w,
                    ev: &mut Vec::new(),
                    fx: None,
                },
                crate::hooks::HookArgs::Teleported,
            );
            sim.w.rt.gates_locked = true;
        }
        "input" => {
            let actor = action["actor"].as_u64().unwrap();
            let id = player(actor);
            let payload = &action["payload"];
            let raw = match action["type"].as_str().unwrap() {
                "questAccept" => {
                    let def = quest_def_for_id(case, payload["quest"].as_str().unwrap());
                    let oi = rust_offer(sim, &def);
                    let qid = sim.w.quests.as_ref().unwrap().offers[oi].id;
                    RawCommand::QuestAccept {
                        quest_id: Some(qid),
                    }
                }
                "pickup" => {
                    let key = payload["containerId"].as_str().unwrap();
                    let (def, x, y) = containers.get(key).expect("captured container");
                    let oi = rust_offer(sim, def);
                    let quest_id = sim.w.quests.as_ref().unwrap().offers[oi].id;
                    let cid = sim
                        .w
                        .containers
                        .iter()
                        .find(|c| {
                            c.kind == crate::ContainerKind::Quest
                                && c.items.first().map(|i| i.def)
                                    == Some(crate::initial_world::ItemDef::Quest(quest_id))
                                && (c.at.x - x).abs() < 1e-6
                                && (c.at.y - y).abs() < 1e-6
                        })
                        .map(|c| c.id)
                        .unwrap_or_else(|| panic!("rust container for {key}"));
                    RawCommand::Pickup { container_id: cid }
                }
                "attack" => RawCommand::Attack {
                    a: payload["a"].as_f64().unwrap(),
                    t: None,
                },
                "release" => RawCommand::Release {
                    a: payload["a"].as_f64().unwrap(),
                    t: None,
                },
                other => panic!("unexpected captured input {other}"),
            };
            sim.submit(id, validate(raw).expect("valid captured command"))
                .expect("accepted");
        }
        other => panic!("unexpected captured action {other}"),
    }
}

#[test]
fn the_captured_lifecycle_replays_through_the_input_door() {
    let doc = load();
    assert_eq!(doc["format"], "rh-quest-lifecycle-source/1");
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let initial = case["input"]["initial"].as_array().unwrap();
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
        let config = SimConfig {
            quests: true,
            mob_mode: crate::mob_runtime::MobMode::Pve,
            initial_loot: true,
            pvp_rules: false,
            ..Default::default()
        };
        let mut sim = Sim::reset_active(
            config,
            arena(),
            Secrets {
                order_salt: crate::rng::Mulberry32::new(12).next_u32(),
                spawn_seed: 0,
                reward_salt: [1, 2, 3, 4],
            },
            &placements,
        );
        let containers = container_lookup(case);
        let actions = case["actions"].as_array().unwrap();
        let frames = case["frames"].as_array().unwrap();

        let mut ai = 0usize;
        for frame in frames {
            let target = frame["tick"].as_u64().unwrap() as u32;
            let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
            while ai < want_actions {
                let action = &actions[ai];
                let tick = action["tick"].as_u64().unwrap() as u32;
                while sim.w.tick < tick {
                    sim.step();
                }
                apply_action(&mut sim, case, &containers, action);
                ai += 1;
            }
            while sim.w.tick < target {
                sim.step();
            }
            let want = normalize_expected(frame);
            let got = snapshot(&sim);
            if let Some(diff) = first_diff(&got, &want, "") {
                panic!("{name}: frame {} at tick {target}: {diff}", frame["label"]);
            }
        }
    }
}

/// The first path where two JSON values differ (objects by key, arrays by index), for readable capture mismatches.
fn first_diff(got: &serde_json::Value, want: &serde_json::Value, path: &str) -> Option<String> {
    match (got, want) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let sub = format!("{path}.{key}");
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => {
                        if let Some(d) = first_diff(x, y, &sub) {
                            return Some(d);
                        }
                    }
                    (x, y) => {
                        return Some(format!("{sub}: got {x:?} want {y:?}"));
                    }
                }
            }
            None
        }
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            if a.len() != b.len() {
                let tally = |rows: &[serde_json::Value]| {
                    let mut map = std::collections::BTreeMap::new();
                    for row in rows {
                        let key = row
                            .get("def")
                            .and_then(|d| d.as_str())
                            .unwrap_or("?")
                            .to_string();
                        *map.entry(key).or_insert(0usize) += 1;
                    }
                    map
                };
                return Some(format!(
                    "{path}: array length {} != {} (got {:?} want {:?})",
                    a.len(),
                    b.len(),
                    tally(a),
                    tally(b)
                ));
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                if let Some(d) = first_diff(x, y, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        (x, y) => {
            if x == y {
                None
            } else {
                Some(format!("{path}: got {x} want {y}"))
            }
        }
    }
}
