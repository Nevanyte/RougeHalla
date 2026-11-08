//! Actual-source travel-cannon proofs (P-CONS-1c): `parity/cannons/source.json` from
//! `tools/cannon-fixtures/capture.mts` in the pinned Linux/x64 Node 22.23.4 container.
//!
//! The corpus records the actual source world constructor (the consumables installer's travel producer after the loot
//! prefix) and ten driven cases: the blast, the rounded-up reload refusals and their boundaries, the coliseum seal, the
//! root cannot-move branch, a blocked landing, the reference/queue/trigger clears and an ordinary chest pickup control.
//! Every attempt replays the recorded raw container id through {`validate`} + `submit_unbudgeted` (the parity harness
//! path: the legacy capture fed the same intake directly) and compares every frame exactly.
use crate::mapgen::{coliseum, pipeline};
use crate::status_runtime::StatusApply;
use crate::status_runtime::{StatusKind, StatusSource};
use crate::{
    validate, ContainerKind, Event, FactionId, ItemObserver, Observation, PlayerId, PublicCommand,
    RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value};

fn source() -> Value {
    serde_json::from_str(include_str!("../../../../parity/cannons/source.json")).unwrap()
}

fn arena() -> (crate::Arena, u32) {
    let fixed = coliseum::fixed_layout();
    let pipeline = pipeline::Pipeline::new(&fixed);
    let native = pipeline
        .generate_styled(1, None, pipeline::Options::default())
        .unwrap();
    let hash = u32::from_str_radix(&crate::mapgen::map_hash::map_hash(&native), 16).unwrap();
    let v = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: hash,
        map: native,
    }
    .validate()
    .unwrap();
    let (w, h, t, l) = v.into_parts();
    let spawns = l
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    (
        crate::Arena {
            map: crate::TileMap::new(w, h, t)
                .unwrap()
                .with_layers(std::sync::Arc::new(l))
                .unwrap(),
            spawns,
        },
        hash,
    )
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
    u32::from_str_radix(key.strip_prefix('c').expect("container key"), 36).unwrap()
}

fn name(sim: &Sim, id: PlayerId) -> String {
    sim.player_name(id).unwrap().to_string()
}

fn player_ix(s: &Sim, id: &str) -> usize {
    s.players()
        .iter()
        .position(|p| name(s, p.id) == id)
        .unwrap_or_else(|| panic!("no player {id}"))
}

fn player_frame(s: &Sim, i: usize) -> Value {
    let p = &s.w.players[i];
    let path: Vec<Value> = p
        .motion
        .path
        .as_slice()
        .iter()
        .map(|q| json!({"x": q.x, "y": q.y}))
        .collect();
    let attack_move = p
        .weapon
        .targeting
        .attack_move
        .map(|g| json!({"x": g.x, "y": g.y}))
        .unwrap_or(Value::Null);
    json!({
        "id": name(s, p.id),
        "x": p.body.x,
        "y": p.body.y,
        "facing": p.body.facing,
        "hp": p.vitals.hp,
        "status": if p.status == crate::Status::Alive { "alive" } else { "other" },
        "weapon0": p.weapon.weapon0.map_or("", |w| w.as_str()),
        "weapon1": p.weapon.weapon1.map_or("", |w| w.as_str()),
        "displaceSeq": p.motion.displace_seq,
        "readyAt": p.weapon.ready_at,
        "attackTarget": p.weapon.targeting.target.map(|id| name(s, id)).unwrap_or_default(),
        "path": path,
        "held": p.weapon.held,
        "attackMove": attack_move,
    })
}

fn container_frame(s: &Sim, c: &crate::state::Container) -> Value {
    let (kind, label) = match c.kind {
        ContainerKind::Ground => {
            let crate::initial_world::ItemDef::Weapon(w) = c.items[0].def else {
                unreachable!("ground loot is a weapon")
            };
            let text = w.as_str();
            (
                "ground",
                format!("{}{}", text[..1].to_ascii_uppercase(), &text[1..]),
            )
        }
        ContainerKind::Chest => ("chest", "Chest".to_string()),
        ContainerKind::Body(id) => ("body", s.player_name(id).unwrap().to_string()),
        ContainerKind::Quest => ("quest", String::new()),
        ContainerKind::WindEmblem => ("consumable", "Wind emblem · walk over it".to_string()),
        ContainerKind::Cannon => ("cannon", "Travel cannon · F to blast".to_string()),
    };
    let items: Vec<Value> = c
        .items
        .iter()
        .map(|i| json!({"uid": format!("U{}", i.uid), "def": i.def.as_str()}))
        .collect();
    let (target_x, target_y) = c.target.map_or((0., 0.), |t| (t.x, t.y));
    json!({
        "id": key(c.id),
        "kind": kind,
        "x": c.at.x,
        "y": c.at.y,
        "opened": c.opened,
        "label": label,
        "items": items,
        "targetX": target_x,
        "targetY": target_y,
        "readyAt": c.ready_at,
        "statOffer": c.stat_offer,
    })
}

fn frame(s: &Sim, events: &[Event]) -> Value {
    let mut main = s.w.spawn_rng.clone();
    let mut reward = s.w.reward_rng.clone();
    let notices: Vec<Value> = events
        .iter()
        .filter_map(|e| match e {
            Event::PotionNotice { id, notice } => {
                Some(json!({"to": name(s, *id), "text": notice.message()}))
            }
            Event::CannonNotice { id, notice } => {
                Some(json!({"to": name(s, *id), "text": notice.message()}))
            }
            _ => None,
        })
        .collect();
    json!({
        "tick": s.tick(),
        "time": s.server_time(),
        "serial": s.w.entity_counter,
        "uid": s.w.item_counter,
        "players": (0..s.players().len()).map(|i| player_frame(s, i)).collect::<Vec<_>>(),
        "containers": s.containers().iter().map(|c| container_frame(s, c)).collect::<Vec<_>>(),
        "gatesLocked": s.w.rt.gates_locked,
        "notices": notices,
        "rng": {
            "random": {"next": std::array::from_fn::<_, 4, _>(|_| main.next_f64())},
            "rewardRandom": {"next": std::array::from_fn::<_, 4, _>(|_| reward.next_f64())},
        },
    })
}

fn exact(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            assert_eq!(
                a.as_f64().unwrap().to_bits(),
                b.as_f64().unwrap().to_bits(),
                "{path}"
            )
        }
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
                "{path}"
            );
            for (k, a) in a {
                exact(a, &b[k], &format!("{path}.{k}"))
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}

fn sim() -> Sim {
    let (arena, _) = arena();
    let mut s = Sim::new(
        SimConfig {
            initial_loot: true,
            consumables: true,
            min_players: 2,
            fill_seconds: 0.,
            ..Default::default()
        },
        arena,
        Secrets {
            spawn_seed: 12,
            reward_salt: [1, 2, 3, 4],
            ..Secrets::from_seed(1)
        },
    );
    s.add_player("p0", Some(FactionId::Fire), false);
    s.add_player("p1", Some(FactionId::Sentenced), false);
    s.step();
    s.take_events();
    s
}

fn apply_setup(s: &mut Sim, op: &Value) {
    let now = s.server_time();
    match op["op"].as_str().unwrap() {
        "place" => {
            let ix = player_ix(s, op["id"].as_str().unwrap());
            let at = Vec2::new(op["x"].as_f64().unwrap(), op["y"].as_f64().unwrap());
            let p = &mut s.w.players[ix];
            p.body.x = at.x;
            p.body.y = at.y;
            p.body.facing = 0.;
            p.motion.path.clear();
            p.body.history.reset(crate::state::Sample {
                t: now,
                x: at.x,
                y: at.y,
            });
        }
        "container" => {
            let id = id_of(op["id"].as_str().unwrap());
            let c = s.w.containers.iter_mut().find(|c| c.id == id).unwrap();
            if let Some(v) = op["readyAt"].as_f64() {
                c.ready_at = v;
            }
            let has_target = op["targetX"].is_number() || op["targetY"].is_number();
            if has_target {
                c.target = Some(Vec2::new(
                    op["targetX"].as_f64().unwrap(),
                    op["targetY"].as_f64().unwrap(),
                ));
            }
        }
        "gates" => s.w.rt.gates_locked = op["locked"].as_bool().unwrap(),
        "status" => {
            let ix = player_ix(s, op["id"].as_str().unwrap());
            let source_ix = player_ix(s, op["source"].as_str().unwrap());
            let source = s.players()[source_ix].id;
            let kind = match op["kind"].as_str().unwrap() {
                "root" => StatusKind::Root,
                other => panic!("unknown status {other}"),
            };
            let ms = op["ms"].as_f64().unwrap();
            let source_name: std::sync::Arc<str> = name(s, source).into();
            let p = &mut s.w.players[ix];
            // The actual status mutation, exactly as a producer would apply it (bits refreshed, source retained).
            crate::status_runtime::apply(
                &mut p.statuses,
                now,
                StatusApply {
                    kind,
                    source: StatusSource {
                        id: Some(source),
                        owner_id: None,
                        name: source_name,
                    },
                    ms,
                    ability: None,
                    tag: None,
                    value: None,
                    add: None,
                    data: None,
                },
            );
        }
        "weapon" => {
            let ix = player_ix(s, op["id"].as_str().unwrap());
            let p = &mut s.w.players[ix];
            p.weapon.weapon0 = crate::WeaponId::parse(op["weapon0"].as_str().unwrap());
            p.weapon.weapon1 = op["weapon1"].as_str().and_then(crate::WeaponId::parse);
        }
        "private" => {
            let ix = player_ix(s, op["id"].as_str().unwrap());
            let path: Vec<Vec2> = op["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|q| Vec2::new(q["x"].as_f64().unwrap(), q["y"].as_f64().unwrap()))
                .collect();
            let target = s.players()[player_ix(s, op["attackTarget"].as_str().unwrap())].id;
            let attack_move = op["attackMove"]
                .as_object()
                .map(|g| Vec2::new(g["x"].as_f64().unwrap(), g["y"].as_f64().unwrap()));
            let held = op["held"].as_bool().unwrap();
            let p = &mut s.w.players[ix];
            p.motion.path.set_from(&path);
            p.weapon.targeting.attack_move = attack_move;
            p.weapon.held = held;
            p.weapon.targeting.target = Some(target);
        }
        other => panic!("unknown setup op {other}"),
    }
}

fn send(s: &mut Sim, cmd: &Value) {
    let player = s.players()[player_ix(s, cmd["player"].as_str().unwrap())].id;
    let raw = match cmd["type"].as_str().unwrap() {
        "pickup" => RawCommand::Pickup {
            container_id: id_of(cmd["msg"]["containerId"].as_str().unwrap()),
        },
        other => panic!("unknown command {other}"),
    };
    let command = validate(raw).expect("a valid source order");
    s.submit_unbudgeted(player, command)
        .expect("the order is queued");
}

#[test]
fn travel_cannons_match_the_actual_source_constructor_and_frames() {
    let src = source();
    assert_eq!(src["format"], "rh-cannon-source/1");
    let (arena, hash) = arena();
    assert_eq!(
        u64::from(hash),
        src["provenance"]["map"]["legacyHashU32"].as_u64().unwrap(),
        "the generated seed-1 map must be the captured one"
    );
    assert_eq!(src["provenance"]["node"], "v22.23.4");
    assert_eq!(src["provenance"]["platform"], "linux");
    assert_eq!(src["provenance"]["arch"], "x64");
    assert_eq!(
        src["configuration"]["modules"].as_array().unwrap().len(),
        16
    );
    drop(arena);

    // The actual source constructor: every container id, position, kind, target and empty cannon clock.
    let baseline = sim();
    let expected_initial = src["initialContainers"].as_array().unwrap();
    assert_eq!(baseline.containers().len(), expected_initial.len());
    for (got, want) in baseline.containers().iter().zip(expected_initial) {
        exact(&container_frame(&baseline, got), want, "initial container");
    }

    let mut compared = 0usize;
    for case in src["cases"].as_array().unwrap() {
        let name = case["input"]["name"].as_str().unwrap();
        let mut s = sim();
        let mut restored: Option<Sim> = None;
        let frames = case["frames"].as_array().unwrap();
        assert_eq!(
            frames.len() as u64,
            case["input"]["steps"].as_u64().unwrap() + 1
        );
        // Frame 0 is the trusted pre-state after the bootstrap step.
        for op in case["input"]["setup"].as_array().unwrap() {
            if op["tick"].as_u64().unwrap() == 0 {
                apply_setup(&mut s, op);
            }
        }
        exact(&frame(&s, &[]), &frames[0], name);
        for tick in 1..=case["input"]["steps"].as_u64().unwrap() {
            for op in case["input"]["setup"].as_array().unwrap() {
                if op["tick"].as_u64().unwrap() == tick {
                    apply_setup(&mut s, op);
                }
            }
            for cmd in case["input"]["commands"].as_array().unwrap() {
                if cmd["tick"].as_u64().unwrap() == tick {
                    send(&mut s, cmd);
                }
            }
            let events = s.step();
            let actual = frame(&s, &events);
            exact(&actual, &frames[tick as usize], name);
            compared += 1;
            // A cannon's private destination is immutable once spawned; the blocked-landing case deliberately
            // rewrites it, so that case is not checkpoint-restored.
            if name == "blast" && tick == 1 {
                let bytes = serde_json::to_vec(&s).unwrap();
                restored =
                    Some(Sim::restore(&mut serde_json::Deserializer::from_slice(&bytes)).unwrap());
            }
            if let Some(r) = &mut restored {
                if name == "blast" && tick > 1 {
                    let events = r.step();
                    exact(&frame(r, &events), &actual, "restored continuation");
                    assert_eq!(r.state_hash(), s.state_hash());
                }
            }
        }
        // Some probe pre-states are deliberately not reachable source worlds (a sealed gate without the source arena
        // lifecycle, a rewritten cannon destination), so only the reachable ones are checkpoint-restored.
        if matches!(
            name,
            "spawn"
                | "blast"
                | "reload-two-seconds"
                | "reload-one-second"
                | "reload-ready-boundary"
                | "cannot-enter"
                | "chest-control"
        ) {
            let bytes = serde_json::to_vec(&s).unwrap();
            let r = Sim::restore(&mut serde_json::Deserializer::from_slice(&bytes)).unwrap();
            assert_eq!(
                r.state_hash(),
                s.state_hash(),
                "{name}: checkpoint identity"
            );
        }
        assert!(s.check_layout().is_ok(), "{name}: layout");
    }
    assert_eq!(compared, 23);
}

#[test]
fn cannon_is_focusable_without_items_and_never_a_weapon_offer() {
    let mut s = sim();
    let cannon_id = s
        .containers()
        .iter()
        .find(|c| c.kind == ContainerKind::Cannon)
        .unwrap()
        .id;
    let cannon_at = s
        .containers()
        .iter()
        .find(|c| c.id == cannon_id)
        .unwrap()
        .at;
    let ix = player_ix(&s, "p0");
    let p0 = s.players()[ix].id;
    let now = s.server_time();
    {
        let p = &mut s.w.players[ix];
        p.body.x = cannon_at.x;
        p.body.y = cannon_at.y;
        p.body.facing = 0.;
        p.motion.path.clear();
        p.body.history.reset(crate::state::Sample {
            t: now,
            x: cannon_at.x,
            y: cannon_at.y,
        });
    }
    s.take_events();
    let mut observer = ItemObserver::new(p0);
    let mut observation = Observation::default();
    observer
        .observe_into(&s, &[], &mut observation, None)
        .unwrap();
    let focused = observation.props.iter().find(|p| p.cue.focused).unwrap();
    assert_eq!(focused.cue.kind, crate::PropKind::Cannon { ready_at: 0 });
    let command = observer
        .resolve(
            &s,
            PublicCommand::Pickup {
                handle: focused.handle,
            },
        )
        .unwrap();
    s.submit(p0, command).unwrap();
    s.step();
    assert_eq!(
        s.player(p0).unwrap().motion.displace_seq,
        1,
        "the observer-resolved F command blasts the cannon"
    );
}
