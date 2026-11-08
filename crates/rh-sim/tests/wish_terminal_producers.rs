//! P-WISH-TERMINAL-PRODUCERS native consumer.
//!
//! Replays the declared source actions with real public validate/submit casts and real target removal or a real Freeze
//! landing disrupter. Compares the actual native cast/status event vector, producer times, pending-cast/stock frames and
//! restored continuation against parity/wish-terminal/source.json (unchanged legacy TS through ability-fixtures/engine).
//! No raw event insertion, expected pending-cast/status installation, private-helper-as-producer or refused-cast bypass.
use rh_sim::abilities::{Mode, Slot};
use rh_sim::status_runtime::StatusKind;
use rh_sim::{
    validate, Arena, Command, Event, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim,
    SimConfig, TileMap, Vec2,
};
use serde_json::{json, Value};

const CORPUS: &str = include_str!("../../../parity/wish-terminal/source.json");

fn source_id(label: &str) -> PlayerId {
    PlayerId(label.strip_prefix('p').unwrap().parse::<u32>().unwrap() + 1)
}

fn label(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}

fn faction(name: &str) -> FactionId {
    FactionId::parse(name).unwrap()
}

fn scene(case: &Value) -> Sim {
    let mut tiles = vec![0; 40 * 24];
    for y in 0..24 {
        for x in 0..40 {
            if x == 0 || y == 0 || x == 39 || y == 23 {
                tiles[y * 40 + x] = 1;
            }
        }
    }
    let map = TileMap::new(40, 24, tiles).unwrap();
    let placements: Vec<Placement> = case["players"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            profile: format!("p{i}"),
            faction: faction(p["faction"].as_str().unwrap()),
            bot: false,
            at: Vec2::new(
                p["at"]["x"].as_f64().unwrap(),
                p["at"]["y"].as_f64().unwrap(),
            ),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    Sim::reset_active(
        SimConfig {
            abilities: Mode::Full,
            wish_lock_ms: 0.,
            lifecycle: rh_sim::ArenaMode::Off,
            quests: false,
            consumables: false,
            ..Default::default()
        },
        Arena {
            map,
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(12),
        &placements,
    )
}

/// JS JSON.stringify writes integral numbers without a decimal; keep the same canonical shape for Value equality.
fn jsnum(v: f64) -> Value {
    if v.is_finite() && v.fract() == 0. && v.abs() <= i64::MAX as f64 {
        Value::from(v as i64)
    } else {
        Value::from(v)
    }
}

fn status_name(kind: StatusKind) -> String {
    serde_json::to_value(kind)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

fn canonical_events(events: &[Event], now: f64) -> Vec<Value> {
    let mut out = Vec::new();
    for event in events {
        match event {
            Event::CastStarted {
                event_time,
                id,
                ability,
                ms,
                target,
                x,
                y,
            } => out.push(json!({
                "kind": "cast", "time": jsnum(*event_time), "by": label(*id), "ability": ability.as_str(),
                "target": target.map(label), "x": jsnum(*x), "y": jsnum(*y), "ms": jsnum(*ms),
            })),
            Event::CastLanded {
                event_time,
                id,
                ability,
                target,
                x,
                y,
                to: _,
            } => out.push(json!({
                "kind": "castLand", "time": jsnum(*event_time), "by": label(*id), "ability": ability.as_str(),
                "target": target.map(label), "x": jsnum(*x), "y": jsnum(*y),
            })),
            Event::CastEnded {
                event_time,
                id,
                ability,
                reason,
            } => out.push(json!({
                "kind": "castEnd", "time": jsnum(*event_time), "by": label(*id), "ability": ability.as_str(),
                "reason": serde_json::to_value(reason).unwrap(),
            })),
            Event::StatusApplied { id, kind, ms, by } => out.push(json!({
                "kind": "status", "time": jsnum(now), "id": label(*id), "status": status_name(*kind),
                "ms": jsnum(*ms), "by": by.map(label),
            })),
            _ => {}
        }
    }
    out
}

fn player_view(sim: &Sim) -> Vec<Value> {
    sim.players()
        .iter()
        .map(|p| {
            let cast = match p.statuses.cast {
                None => Value::Null,
                Some(cast) => json!({
                    "ability": cast.ability.as_str(),
                    "startedAt": jsnum(cast.started_at),
                    "landsAt": jsnum(cast.lands_at),
                    "target": cast.producer.and_then(|d| d.target).map(label),
                }),
            };
            json!({
                "id": label(p.id),
                "wishReadyAt": jsnum(p.stocks.wish_ready_at),
                "wishFullAt": p.stocks.wish_full_at.map(jsnum),
                "status": format!("{:?}", p.status).to_lowercase(),
                "cast": cast,
            })
        })
        .collect()
}

fn submit_input(sim: &mut Sim, input: &Value) {
    let actor = source_id(input["actor"].as_str().unwrap());
    let payload = &input["payload"];
    let target = payload["id"].as_str().map(source_id);
    let command: Command = validate(RawCommand::Cast {
        slot: Slot::Wish,
        x: payload["point"]["x"].as_f64().unwrap(),
        y: payload["point"]["y"].as_f64().unwrap(),
        id: target,
        t: None,
        seq: None,
    })
    .unwrap();
    sim.submit(actor, command)
        .expect("the admitted cast is accepted");
}

#[test]
fn source_fizzle_interrupted_terminal_matrix_matches_native_and_continues() {
    let corpus: Value = serde_json::from_str(CORPUS).unwrap();
    assert_eq!(corpus["format"], "rh-wish-terminal/1");
    assert_eq!(corpus["profile"]["node"], "v22.23.4");
    assert_eq!(corpus["profile"]["platform"], "linux");
    assert_eq!(corpus["profile"]["arch"], "x64");
    assert_eq!(corpus["profile"]["fixedStepMs"], 50);
    assert_eq!(
        corpus["profile"]["sourceSha256"].as_str().unwrap().len(),
        64
    );
    assert_eq!(
        corpus["profile"]["harnessSha256"].as_str().unwrap().len(),
        64
    );
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 5);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut sim = scene(case);
        assert_eq!(
            sim.server_time(),
            case["initial"]["time"].as_f64().unwrap(),
            "{name}: initial source clock"
        );
        assert_eq!(
            sim.tick() as u64,
            case["initial"]["tick"].as_u64().unwrap(),
            "{name}: initial tick"
        );
        let actions = case["actions"].as_array().unwrap();
        let timeline = case["timeline"].as_array().unwrap();
        assert_eq!(actions.len(), timeline.len());
        let mut all_events: Vec<(usize, Value)> = Vec::new();
        let mut restored: Option<Sim> = None;
        let mut continuation_actions = 0usize;
        for (i, (action, frame)) in actions.iter().zip(timeline).enumerate() {
            let native_events = match action["kind"].as_str().unwrap() {
                "step" => {
                    for input in action["inputs"].as_array().unwrap() {
                        submit_input(&mut sim, input);
                    }
                    let events = sim.step();
                    let native = canonical_events(&events, sim.server_time());
                    if let Some(other) = restored.as_mut() {
                        let expected = other.step();
                        assert_eq!(
                            canonical_events(&expected, other.server_time()),
                            native,
                            "{name}: restored action {i} event vector"
                        );
                        assert_eq!(
                            other.state_hash(),
                            sim.state_hash(),
                            "{name}: restored action {i} hash"
                        );
                        continuation_actions += 1;
                    }
                    native
                }
                "remove" => {
                    let target = source_id(action["actor"].as_str().unwrap());
                    sim.remove_player(target);
                    if let Some(other) = restored.as_mut() {
                        other.remove_player(target);
                        assert_eq!(
                            other.state_hash(),
                            sim.state_hash(),
                            "{name}: restored removal {i} hash"
                        );
                        continuation_actions += 1;
                    }
                    Vec::new()
                }
                other => panic!("{name}: unadmitted source action {other}"),
            };
            assert_eq!(
                sim.server_time(),
                frame["time"].as_f64().unwrap(),
                "{name}: action {i} producer clock"
            );
            assert_eq!(
                sim.tick() as u64,
                frame["tick"].as_u64().unwrap(),
                "{name}: action {i} tick"
            );
            let expected_events = frame["events"].as_array().unwrap();
            assert_eq!(
                &native_events, expected_events,
                "{name}: action {i} event vector"
            );
            assert_eq!(
                player_view(&sim),
                frame["players"].as_array().unwrap().clone(),
                "{name}: action {i} stock/pending-cast frame"
            );
            all_events.extend(native_events.iter().cloned().map(|event| (i, event)));
            if restored.is_none() && expected_events.iter().any(|e| e["kind"] == "castEnd") {
                restored = Some(
                    Sim::restore(serde_json::to_value(&sim).unwrap())
                        .expect("terminal boundary restores"),
                );
                assert_eq!(
                    restored.as_ref().unwrap().state_hash(),
                    sim.state_hash(),
                    "{name}: terminal boundary hash"
                );
                let end_event = expected_events
                    .iter()
                    .find(|e| e["kind"] == "castEnd")
                    .unwrap();
                let end_by = end_event["by"].as_str().unwrap();
                let end_ability = end_event["ability"].as_str().unwrap();
                let pending =
                    serde_json::to_value(&sim).unwrap()["world"]["pending_events"].clone();
                let own_pending = |kind: &str| {
                    pending.as_array().is_some_and(|events| {
                        events.iter().any(|e| {
                            e[kind]["by"].as_str() == Some(end_by)
                                && e[kind]["ability"].as_str() == Some(end_ability)
                        })
                    })
                };
                assert!(
                    !own_pending("CastEnded") && !own_pending("CastStarted"),
                    "{name}: immediate Fizzle/Interrupted terminal leaves no own retained pending event"
                );
            }
        }
        assert!(
            continuation_actions > 0,
            "{name}: restored continuation compared at the terminal boundary"
        );
        // Exactly one own terminal, with a real earlier start and no later same-actor/ability cast event.
        let ends: Vec<(usize, usize, &Value)> = all_events
            .iter()
            .enumerate()
            .filter(|(_, (_, e))| e["kind"] == "castEnd")
            .map(|(flat, (action, event))| (flat, *action, event))
            .collect();
        assert_eq!(ends.len(), 1, "{name}: exactly one own terminal");
        let (end_index, end_action, end) = ends[0];
        let actor = end["by"].as_str().unwrap().to_owned();
        let ability = end["ability"].as_str().unwrap().to_owned();
        let reason = end["reason"].as_str().unwrap();
        let expected_reason = if name.starts_with("fizzle") {
            "fizzle"
        } else {
            "interrupted"
        };
        assert_eq!(reason, expected_reason, "{name}: actual terminal reason");
        let starts: Vec<(usize, &Value)> = all_events[..end_index]
            .iter()
            .filter(|(_, e)| {
                e["kind"] == "cast" && e["by"] == actor.as_str() && e["ability"] == ability.as_str()
            })
            .map(|(action, event)| (*action, event))
            .collect();
        assert_eq!(
            starts.len(),
            1,
            "{name}: one real start before the terminal"
        );
        let start_action = starts[0].0;
        assert!(
            all_events[end_index + 1..].iter().all(|(_, e)| {
                (e["kind"] != "castLand" && e["kind"] != "castEnd" && e["kind"] != "cast")
                    || e["by"] != actor.as_str()
                    || e["ability"] != ability.as_str()
            }),
            "{name}: no later landing/regrant/double terminal"
        );
        assert_eq!(
            end["time"], case["timeline"][end_action]["time"],
            "{name}: terminal producer time"
        );
        // Source terminal hook records the same real reason and spent (unrefunded) stock as the public frame.
        let end_frame = &case["timeline"][end_action];
        let terminal_hooks: Vec<&Value> = end_frame["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|h| {
                h["hook"] == "castEnded"
                    && h["actor"] == actor.as_str()
                    && h["ability"] == ability.as_str()
            })
            .collect();
        assert_eq!(
            terminal_hooks.len(),
            1,
            "{name}: one real terminal producer hook"
        );
        let hook = terminal_hooks[0];
        assert_eq!(hook["reason"].as_str().unwrap(), expected_reason);
        assert_eq!(hook["time"], end["time"]);
        let terminal_player = end_frame["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == actor.as_str())
            .expect("the terminal actor frame");
        assert_eq!(hook["wishReadyAt"], terminal_player["wishReadyAt"]);
        assert_eq!(hook["wishFullAt"], terminal_player["wishFullAt"]);
        // Canonical stock: the start frame and terminal frame both carry the spent cooldown (no refund).
        let start_actor = case["timeline"][start_action]["players"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == actor.as_str())
            .expect("start actor frame");
        assert_eq!(
            start_actor["wishReadyAt"], terminal_player["wishReadyAt"],
            "{name}: spent cooldown, no refund"
        );
        assert_eq!(
            start_actor["wishFullAt"], terminal_player["wishFullAt"],
            "{name}: spent full clock, no refund"
        );
        // Instant Wishes have no pending domain in this scenario set; record that exclusion instead of inventing cancellation.
        assert!(
            matches!(ability.as_str(), "freeze" | "swarm" | "trial"),
            "{name}: terminal ability is a real pending Wish ({ability})"
        );
        for id in sim.players().iter().map(|p| label(p.id)) {
            assert!(
                matches!(id.as_str(), "p0" | "p1" | "p2"),
                "{name}: only declared player actors"
            );
        }
    }
}
