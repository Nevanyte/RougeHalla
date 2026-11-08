//! Closed-profile kernel parity, NOT public/headless admission or Full-profile restore proof.
//! The constructor skips exactly the PvE faction-content and player-faction admission predicates. All remaining
//! bootstrap, birth/roster, config, rules and RNG operations are the ordinary constructor/join bodies.
use super::*;
use crate::{FactionMode, RawCommand, Secrets, Sim, SimConfig, WeaponId};
use serde_json::{json, Value};

fn arena() -> crate::Arena {
    use crate::mapgen::{coliseum, map_hash, pipeline};
    let fixed = coliseum::fixed_layout();
    let map = pipeline::Pipeline::new(&fixed)
        .generate_styled(
            1,
            Some(0),
            pipeline::Options {
                decor: false,
                ..Default::default()
            },
        )
        .unwrap();
    crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: u32::from_str_radix(&map_hash::map_hash(&map), 16).unwrap(),
        map,
    }
    .validate()
    .unwrap()
    .into_arena()
    .unwrap()
}
fn config(training: bool) -> SimConfig {
    SimConfig {
        training,
        dummies: training,
        min_players: 2,
        lobby_seconds: if training { 0. } else { 30. },
        fill_seconds: 0.,
        pvp_rules: false,
        quests: false,
        initial_loot: true,
        consumables: true,
        regen: false,
        hazards: crate::terrain::Mode::Map,
        abilities: crate::abilities::Mode::Full,
        lifecycle: if training {
            crate::ArenaMode::Off
        } else {
            crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                patience_seconds: 3600.,
                patience_min_seconds: 3600.,
                sudden_death_seconds: 3600.,
                ..Default::default()
            })
        },
        mob_mode: crate::mob_runtime::MobMode::Pve,
        faction_mode: FactionMode::EngagementHolyPlagueFireFrostSentenced,
        ..Default::default()
    }
}
fn secrets() -> Secrets {
    Secrets {
        spawn_seed: 12,
        reward_salt: [1, 2, 3, 4],
        ..Secrets::from_seed(12)
    }
}
fn scene(input: &Value) -> Sim {
    let training = input["config"]["training"].as_bool().unwrap();
    let mut config = config(training);
    if !input["config"]["wishLockSeconds"].is_null() {
        assert_eq!(input["config"]["wishLockSeconds"], 0);
        config.wish_lock_ms = 0.;
    }
    assert_eq!(input["map"], json!({"seed":1,"attempt":0,"decor":false}));
    assert_eq!(
        input["modules"],
        json!({"signatures":true,"walkHints":false})
    );
    assert_eq!(input["seeds"], json!({"random":12,"rewardSalt":[1,2,3,4]}));
    let mut expected = json!({"minPlayers":2,"lobbySeconds":if training{0}else{30},"fillSeconds":0,"patienceSeconds":3600,"patienceMinSeconds":3600,"suddenDeathSeconds":3600,"mobs":true,"signatures":true,"quests":false,"training":training,"dummies":training,"planSeconds":0,"pvpRules":false});
    if config.wish_lock_ms == 0. {
        expected["wishLockSeconds"] = json!(0);
    }
    assert_eq!(
        input["config"], expected,
        "capture config must be consumed without flattening"
    );
    let mut s = if training {
        Sim::try_new(config, arena(), secrets())
    } else {
        Sim::try_new_unadmitted_kernel_fixture(config, arena(), secrets())
    }
    .unwrap();
    for (i, p) in input["players"].as_array().unwrap().iter().enumerate() {
        assert_eq!(p["name"], format!("p{i}"));
        let f = FactionId::parse(p["faction"].as_str().unwrap()).unwrap();
        s.add_player_unadmitted_kernel_fixture(&format!("p{i}"), f)
            .unwrap();
    }
    s.step();
    assert_eq!(s.phase(), crate::Phase::Active);
    for (p, want) in s.players().iter().zip(input["initial"].as_array().unwrap()) {
        check_numbers(
            &json!({"x":r6(p.body.x),"y":r6(p.body.y),"faction":p.vitals.faction.faction_id().expect("declared faction actor").as_str()}),
            want,
            "ordinary bootstrap/spawn identity",
        );
    }
    s
}
fn label(s: &Sim, id: PlayerId) -> String {
    use crate::mob_runtime::ActorOrigin;
    match s
        .w
        .actor_origin(id)
        .expect("every compared actor has retained provenance")
    {
        ActorOrigin::Player { .. } => format!("p{}", id.0 - 1),
        other => {
            let mut buf = [0; 7];
            format!(
                "mob{}",
                std::str::from_utf8(serial_bytes(other.birth_serial().unwrap(), &mut buf)).unwrap()
            )
        }
    }
}
fn actor(s: &Sim, name: &str) -> PlayerId {
    s.w.actor_history
        .iter()
        .find(|p| label(s, p.id) == name)
        .unwrap_or_else(|| panic!("unbound actor {name}"))
        .id
}
fn group(s: &Sim, g: Option<crate::fighter::MarkGroup>) -> Value {
    match g {
        None => Value::Null,
        Some(crate::fighter::MarkGroup::Fighter(id)) => json!(format!("fighter:{}", label(s, id))),
        Some(crate::fighter::MarkGroup::Camp(c)) => json!(format!(
            "camp:{}",
            if s.k.config.training { c } else { c + 1 }
        )),
    }
}
fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}
fn status(s: crate::Status) -> &'static str {
    match s {
        crate::Status::Alive => "alive",
        crate::Status::Dead => "dead",
        crate::Status::Mia => "mia",
        crate::Status::Lobby => "lobby",
    }
}
fn fighter(s: &Sim, name: &str) -> Value {
    let id = actor(s, name);
    let Some(c) = s.w.actor(id) else {
        return Value::Null;
    };
    let f = &c.signature;
    json!({"id":name,"target":f.target.map(|id|label(s,id)),"group":group(s,f.mark.group),"groupSize":f.mark.group_size,"tier":f.mark.tier,"hits":f.mark.hits,"progress":r6(f.mark.progress),"swaps":f.mark.swaps,"chill":r6(f.chill),"denied":f.mark.denied,"ampUntil":r6(f.mark.amp_until)})
}
fn check_numbers(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => assert!(
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() <= 1e-6,
            "{path}: {a} != {b}"
        ),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                check_numbers(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path} keys"
            );
            for (k, a) in a {
                check_numbers(a, &b[k], &format!("{path}/{k}"));
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}
fn apply(s: &mut Sim, a: &Value) {
    assert_eq!(s.tick(), a["tick"].as_u64().unwrap() as u32);
    let id = PlayerId(a["actor"].as_u64().unwrap() as u32 + 1);
    match a["kind"].as_str().unwrap() {
        "hp" => {
            let p = s.w.players.get_mut(id).unwrap();
            p.vitals.hp = a["hp"].as_f64().unwrap();
            p.vitals.max_hp = p.vitals.hp;
        }
        "weapon" => {
            let p = s.w.players.get_mut(id).unwrap();
            p.weapon.weapon0 = WeaponId::parse(a["weapon"].as_str().unwrap());
            p.weapon.slot = 0;
        }
        "place" => {
            let p = s.w.players.get_mut(id).unwrap();
            let x = a["x"].as_f64().unwrap();
            let y = a["y"].as_f64().unwrap();
            p.body.x = x;
            p.body.y = y;
            p.body.facing = 0.;
            p.body.history.reset(crate::state::Sample {
                t: s.w.server_time,
                x,
                y,
            });
        }
        "grantCard" => {
            let card = crate::cards::CardId::ALL
                .into_iter()
                .find(|c| c.as_str() == a["card"].as_str().unwrap())
                .unwrap();
            assert!(crate::cards::grant(&s.k, &mut s.w, id, card));
        }
        "input" => {
            let p = &a["payload"];
            let raw = match a["type"].as_str().unwrap() {
                "attack" => RawCommand::Attack {
                    a: p["a"].as_f64().unwrap(),
                    t: None,
                },
                "target" => RawCommand::Target {
                    id: actor(s, p["id"].as_str().unwrap()),
                },
                "move" => RawCommand::Move {
                    x: p["x"].as_f64().unwrap(),
                    y: p["y"].as_f64().unwrap(),
                    seq: None,
                },
                "cast" => {
                    assert_eq!(p["slot"], "wish");
                    RawCommand::Cast {
                        slot: crate::abilities::Slot::Wish,
                        x: p["x"].as_f64().unwrap(),
                        y: p["y"].as_f64().unwrap(),
                        id: p["id"].as_str().map(|id| actor(s, id)),
                        t: None,
                        seq: None,
                    }
                }
                other => panic!("undeclared source input {other}"),
            };
            s.submit(id, crate::validate(raw).unwrap()).unwrap();
        }
        other => panic!("undeclared source action {other}"),
    }
}
fn step(s: &mut Sim, pulses: &mut Vec<Value>, hits: &mut Vec<Value>) {
    for e in s.step() {
        match e {
        crate::Event::Hit{victim,by,amount,weapon,..}=>hits.push(json!({"id":label(s,victim),"by":by.map(|id|label(s,id)),"kind":"hit","amount":r6(amount),"weapon":weapon.map_or("",|w|w.as_str()),"sig":null})),
        crate::Event::SignatureHit{victim,by,amount,weapon,sig}=>hits.push(json!({"id":label(s,victim),"by":label(s,by),"kind":"hit","amount":r6(amount),"weapon":weapon.map_or("",|w|w.as_str()),"sig":sig.as_str()})),
        crate::Event::StatusApplied{id,kind,ms,by}=>hits.push(json!({"kind":"status","id":label(s,id),"status":serde_json::to_value(kind).unwrap(),"ms":r6(ms),"by":by.map(|id|label(s,id))})),
        crate::Event::CastLanded{id,ability,target,..}=>hits.push(json!({"kind":"castLand","by":label(s,id),"ability":ability.as_str(),"target":target.map(|id|label(s,id))})),
        _=>{}
    }
    }
    for e in s
        .damage_entries()
        .iter()
        .filter(|e| e.sig == Some(SignatureKind::Mark))
    {
        pulses.push(json!({"victim":label(s,e.victim),"by":e.by.map(|id|label(s,id)),"sig":e.sig.map(|sig|match sig {SignatureKind::Mark=>"mark",_=>panic!("unexpected arena signature")}),"raw":r6(e.raw),"weapon":e.weapon.map(|w|w.as_str()),"arena":e.arena,"group":null,"scale":e.scale}));
    }
}
fn compare(s: &Sim, f: &Value, pulses: &[Value], name: &str) {
    assert_eq!(s.server_time(), f["time"].as_f64().unwrap(), "{name} clock");
    assert_eq!(
        s.w.entity_counter,
        f["idCounter"].as_u64().unwrap() as u32,
        "{name} constructor/entity RNG identity"
    );
    // Source tap is after factions and before terrain appends its arena rows; this comparison is exactly the Mark tape.
    assert!(f["pulses"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["sig"] == "mark" && e["arena"] == false));
    check_numbers(&json!(pulses), &f["pulses"], &format!("{name} pulse tape"));
    for p in f["players"].as_array().unwrap() {
        let name = p["id"].as_str().unwrap();
        let c = s.w.players.get(actor(s, name)).unwrap();
        check_numbers(
            &json!({"id":name,"faction":c.vitals.faction.faction_id().expect("declared faction actor").as_str(),"x":r6(c.body.x),"y":r6(c.body.y),"hp":r6(c.vitals.hp),"maxHp":r6(c.vitals.max_hp),"status":status(c.status),"weapon0":c.weapon.weapon0.map_or("",|w|w.as_str()),"statuses":c.statuses.instances.iter().map(|st|serde_json::to_value(st.kind).unwrap()).collect::<Vec<_>>()}),
            p,
            &format!("{name} player"),
        );
    }
    // The source watch list is exactly the suffix of fighters. Null rows stay mandatory: no optional comparisons.
    let fighters = f["fighters"].as_array().unwrap();
    for want in fighters {
        if let Some(name) = want["id"].as_str() {
            check_numbers(&fighter(s, name), want, &format!("{name} signature"));
        }
    }
    for (i, m) in f["mobs"].as_array().unwrap().iter().enumerate() {
        if m.is_null() {
            continue;
        } // The test loop separately verifies source null rows using retained watched identities.
        let name = m["id"].as_str().unwrap();
        let c = s.w.mobs.get(actor(s, name)).unwrap();
        let dummy = c.kind == crate::mob_runtime::MobKind::Dummy;
        let kind = if dummy {
            "dummy"
        } else if c.elite {
            "elite"
        } else {
            "mob"
        };
        let mode = match c.regional_brain().mode {
            crate::mob_runtime::BrainMode::Idle => "idle",
            crate::mob_runtime::BrainMode::Fight => "fight",
            crate::mob_runtime::BrainMode::Return => "return",
        };
        let brain = if dummy {
            Value::Null
        } else {
            json!({"mode":mode,"region":c.core.vitals.faction.faction_id().expect("declared faction actor").as_str(),"elite":c.elite})
        };
        let mut got = json!({"id":name,"kind":kind,"faction":if dummy {""}else{c.core.vitals.faction.faction_id().expect("declared faction actor").as_str()},"camp":if s.k.config.training {c.camp}else{c.camp+1},"x":r6(c.core.body.x),"y":r6(c.core.body.y),"hp":r6(c.core.vitals.hp),"maxHp":r6(c.core.vitals.max_hp),"status":status(c.status),"weapon0":c.core.weapon.weapon0.map_or("",|w|w.as_str()),"type":c.mob_type.map_or("",|ty|ty.as_str()),"brain":brain});
        if m.get("statuses").is_some() {
            got["statuses"] = json!(c
                .core
                .statuses
                .instances
                .iter()
                .map(|st| serde_json::to_value(st.kind).unwrap())
                .collect::<Vec<_>>());
        }
        check_numbers(&got, m, &format!("{name} mob{i}"));
    }
}

#[test]
fn closed_profile_kernel_source_six_cases_sparse_snapshots_and_complete_mark_pulse_tapes() {
    run_corpus(
        include_str!("../../../../../parity/sentenced-npc-group/source.json"),
        "rh-sentenced-npc-group-source/1",
        6,
    );
}
#[test]
fn closed_profile_kernel_source_supplement_death_shrink_handoff_and_trial() {
    run_corpus(
        include_str!("../../../../../parity/sentenced-npc-group/source-supplement.json"),
        "rh-sentenced-npc-group-supplement/1",
        2,
    );
}
fn run_corpus(text: &str, format: &str, count: usize) {
    let doc: Value = serde_json::from_str(text).unwrap();
    assert_eq!(doc["format"], format);
    assert_eq!(doc["cases"].as_array().unwrap().len(), count);
    for case in doc["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let mut s = scene(&case["input"]);
        let actions = case["actions"].as_array().unwrap();
        let mut n = 0;
        let mut pulses = Vec::new();
        let mut hits = Vec::new();
        let mut watched: Vec<String> = Vec::new();
        for f in case["frames"].as_array().unwrap() {
            let count = f["actionCount"].as_u64().unwrap() as usize;
            while n < count {
                while s.tick() < actions[n]["tick"].as_u64().unwrap() as u32 {
                    step(&mut s, &mut pulses, &mut hits);
                }
                apply(&mut s, &actions[n]);
                n += 1;
            }
            while s.tick() < f["tick"].as_u64().unwrap() as u32 {
                step(&mut s, &mut pulses, &mut hits);
            }
            for (i, m) in f["mobs"].as_array().unwrap().iter().enumerate() {
                if let Some(id) = m["id"].as_str() {
                    if i == watched.len() {
                        watched.push(id.into());
                    } else {
                        assert_eq!(watched[i], id);
                    }
                } else {
                    assert!(
                        s.w.actor(actor(&s, &watched[i])).is_none(),
                        "{name}: source removed actor must be removed"
                    );
                    assert!(f["fighters"][i + s.players().len()].is_null());
                }
            }
            let expected:Vec<Value>=f["events"].as_array().unwrap().iter().filter_map(|e| {
                let fx=&e["fx"]; match fx["kind"].as_str(){
                Some("hit")=>Some(json!({"kind":"hit","id":fx["id"],"by":fx["by"],"amount":r6(fx["amount"].as_f64().unwrap()),"weapon":fx["weapon"].as_str().unwrap_or(""),"sig":fx["sig"]})),
                Some("status")=>Some(json!({"kind":"status","id":fx["id"],"status":fx["status"],"ms":r6(fx["ms"].as_f64().unwrap()),"by":fx["by"]})),
                Some("castLand")=>Some(json!({"kind":"castLand","by":fx["by"],"ability":fx["ability"],"target":fx["target"]})),_=>None}
            }).collect();
            check_numbers(
                &json!(hits),
                &json!(expected),
                &format!("{name}/{} landed weapon/signature tape", f["label"]),
            );
            compare(&s, f, &pulses, name);
            pulses.clear();
            hits.clear();
        }
        assert_eq!(n, actions.len());
    }
}

#[test]
fn full_constructor_and_sentenced_pve_join_require_completed_capability() {
    let mut s = Sim::try_new(config(false), arena(), secrets()).unwrap();
    assert!(s
        .add_player("admitted", Some(FactionId::Sentenced), false)
        .is_some());
    let mut lower = config(false);
    lower.faction_mode = FactionMode::EngagementHolyPlagueFireFrost;
    assert!(
        Sim::try_new(lower, arena(), secrets()).is_err(),
        "Sentenced camp requires its actual capability"
    );
    let mut foundation = config(false);
    foundation.mob_mode = crate::mob_runtime::MobMode::SpawnFoundation;
    assert!(
        Sim::try_new(foundation, arena(), secrets()).is_err(),
        "spawn-only is not a combat capability"
    );
}

#[test]
fn admitted_training_initial_constructor_matches_source_births_and_replays_all_stat_crates() {
    let doc: Value = serde_json::from_str(include_str!(
        "../../../../../parity/sentenced-npc-group/source.json"
    ))
    .unwrap();
    let case = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["name"] == "dummy-singleton")
        .unwrap();
    let mut config = config(true);
    // Existing public Off-mob training route, independently of both closed-profile test admission seams.
    config.mob_mode = crate::mob_runtime::MobMode::Off;
    let mut s = Sim::try_new(config, arena(), secrets()).unwrap();
    s.add_player("p0", Some(FactionId::Sentenced), false)
        .unwrap();
    s.add_player("p1", Some(FactionId::Holy), false).unwrap();
    s.step();
    assert_eq!(
        s.w.entity_counter,
        case["frames"][0]["idCounter"].as_u64().unwrap() as u32
    );
    assert_eq!(
        label(&s, s.mobs()[0].core.id),
        case["script"]["dummy"].as_str().unwrap()
    );
    let crates: Vec<_> =
        s.w.containers
            .iter()
            .filter(|c| c.kind == crate::state::ContainerKind::Chest)
            .collect();
    assert!(!crates.is_empty());
    assert!(crates.iter().all(|c| c.stat_offer));
    assert!(s
        .w
        .containers
        .iter()
        .all(|c| c.kind != crate::state::ContainerKind::Cannon));
    let mut restored = Sim::restore(serde_json::to_value(&s).unwrap()).unwrap();
    assert_eq!(s.state_hash(), restored.state_hash());
    assert_eq!(s.step(), restored.step());
    assert_eq!(s.state_hash(), restored.state_hash());
}
