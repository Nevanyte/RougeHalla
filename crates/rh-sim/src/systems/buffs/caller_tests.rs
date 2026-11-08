//! Pinned real-caller consumer for P-G6-CALLER-REPAIR (`parity/heal-barrier-callers/runtime.json`): a genuine
//! player-only/no-mobs full-player faction world (modules signatures:true, config.mobs:false) bound explicitly, with real
//! cards, normal validated attacks and the installed potion command. It compares damage/hit amounts, heal amounts,
//! barrier values and the private deadline, including the same-tick vs next-tick decay sides of the buffs slot.
use crate::input::{validate, RawCommand};
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

fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
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

fn weapon_str(w: Option<crate::WeaponId>) -> &'static str {
    w.map_or("", |w| w.as_str())
}

fn observe(sim: &Sim) -> Value {
    let players: Vec<Value> = sim
        .w
        .players
        .iter()
        .map(|p| {
            let boost = if !(p.barrier_until > 0.) {
                Value::Null
            } else {
                json!({"shieldUntil": r6(p.barrier_until), "decays": p.barrier_decays})
            };
            json!({
                "id": p.core.id.0 as usize - 1,
                "faction": p.vitals.faction.faction_id().expect("declared faction actor").as_str(),
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
            })
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

fn profile_sim(input: &Value) -> Sim {
    // Bind the recorded profile explicitly: player-only/no-mobs, full-player faction domain, signatures on.
    assert_eq!(
        input["profile"],
        "player-only-no-mobs/full-player-faction/signatures-true"
    );
    assert_eq!(input["config"]["mobs"], false);
    assert_eq!(input["modules"]["signatures"], true);
    let initial = input["initial"].as_array().unwrap();
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
    let sim = Sim::reset_active(
        SimConfig {
            mob_mode: crate::mob_runtime::MobMode::Off,
            faction_mode: crate::FactionMode::EngagementHoly,
            pvp_rules: false,
            quests: false,
            initial_loot: true,
            min_players: 2,
            lobby_seconds: 30.,
            fill_seconds: 0.,
            ..Default::default()
        },
        arena(),
        Secrets {
            order_salt: crate::rng::Mulberry32::new(12).next_u32(),
            spawn_seed: 0,
            reward_salt: [1, 2, 3, 4],
        },
        &placements,
    );
    assert!(sim.w.mobs.is_empty(), "the bound profile has no mobs");
    assert!(!sim.k.config.quests);
    let gates = crate::schedule::Gates::of(&sim.k);
    assert!(gates.signatures, "the faction caller systems are installed");
    assert!(!gates.mobs && !gates.quests && !gates.training);
    sim
}

fn apply(sim: &mut Sim, action: &Value, hits: &mut Vec<Value>, heals: &mut Vec<Value>) {
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
        "damage" => {
            let amount = action["amount"].as_f64().unwrap();
            crate::systems::ledger::apply_declared_hit(&sim.k, &mut sim.w, &mut ev, actor, amount);
        }
        "setPotion" => sim.w.players[actor].potion_small = action["count"].as_u64().unwrap() as u8,
        "addStatus" => {
            let kind = match action["statusKind"].as_str().unwrap() {
                "antiHeal" => crate::status_runtime::StatusKind::AntiHeal,
                other => panic!("status {other}"),
            };
            let apply = crate::status_runtime::StatusApply {
                kind,
                source: crate::status_runtime::StatusSource {
                    id: Some(PlayerId(2)),
                    name: std::sync::Arc::from("p1"),
                    owner_id: None,
                },
                ms: action["ms"].as_f64().unwrap(),
                ability: None,
                tag: None,
                value: Some(action["value"].as_f64().unwrap()),
                add: None,
                data: None,
            };
            let applied = crate::systems::status::operations::apply(
                &sim.k,
                &mut sim.w,
                &mut ev,
                PlayerId(actor as u32 + 1),
                apply,
                false,
            );
            assert!(
                applied.is_some(),
                "the real generic status API applied the labelled status"
            );
        }
        "input" => {
            let payload = &action["payload"];
            let raw = match action["type"].as_str().unwrap() {
                "attack" => RawCommand::Attack {
                    a: payload["a"].as_f64().unwrap(),
                    t: None,
                },
                "useConsumable" => RawCommand::UseConsumable,
                other => panic!("input {other}"),
            };
            sim.submit(PlayerId(actor as u32 + 1), validate(raw).unwrap())
                .unwrap();
        }
        other => panic!("unexpected captured action {other}"),
    }
    let _ = (hits, heals);
}

fn collect(events: &[crate::Event], hits: &mut Vec<Value>, heals: &mut Vec<Value>) {
    for e in events {
        match e {
            crate::Event::Hit {
                victim, by, amount, ..
            } => hits.push(json!({
                "victim": victim.0 as usize - 1,
                "by": by.map(|b| b.0 as usize - 1),
                "amount": r6(*amount),
            })),
            crate::Event::Heal { id, amount } => heals.push(json!({
                "id": id.0 as usize - 1,
                "amount": r6(*amount),
            })),
            _ => {}
        }
    }
}

#[test]
fn the_real_heal_callers_replay_against_the_actual_source_corpus() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/heal-barrier-callers/runtime.json"
    );
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("caller corpus")).expect("json");
    assert_eq!(doc["format"], "rh-heal-barrier-callers-source/1");
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let mut sim = profile_sim(&case["input"]);
        let actions = case["actions"].as_array().unwrap();
        let mut ai = 0usize;
        let (mut hits, mut heals) = (Vec::new(), Vec::new());
        for frame in case["frames"].as_array().unwrap() {
            let target = frame["tick"].as_u64().unwrap() as u32;
            let want_actions = frame["actionCount"].as_u64().unwrap() as usize;
            while ai < want_actions {
                let action = &actions[ai];
                let tick = action["tick"].as_u64().unwrap() as u32;
                while sim.w.tick < tick {
                    let events = sim.step();
                    collect(&events, &mut hits, &mut heals);
                }
                apply(&mut sim, action, &mut hits, &mut heals);
                ai += 1;
            }
            while sim.w.tick < target {
                let events = sim.step();
                collect(&events, &mut hits, &mut heals);
            }
            let got = json!({
                "phase": observe(&sim)["phase"],
                "players": observe(&sim)["players"],
                "hits": std::mem::take(&mut hits),
                "heals": std::mem::take(&mut heals),
            });
            let want = json!({
                "phase": frame["phase"],
                "players": frame["players"],
                "hits": frame["hits"],
                "heals": frame["heals"],
            });
            if let Some(d) = diff(&got, &want, "") {
                panic!("{name}: frame {} at tick {target}: {d}", frame["label"]);
            }
        }
    }
}
