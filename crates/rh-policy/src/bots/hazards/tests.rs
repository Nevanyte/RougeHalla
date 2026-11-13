//! Replays actual original source helper/FSM outputs on declared public contexts, not full-brain outcome parity.
use super::*;
use rh_sim::{PlayerId, Secrets, Sim, SimConfig};
use serde_json::{json, Value};
const FIXTURE: &str = include_str!("../../../../../parity/policy/bot-hazards.json");
fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("actual source corpus")
}
fn maps(f: &Value) -> Vec<(String, TileMap)> {
    f["maps"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(name, v)| {
            let export: rh_sim::mapdata::MapExport = serde_json::from_value(v.clone()).unwrap();
            let (w, h, tiles, layers) = export
                .validate()
                .expect("public static map admission")
                .into_parts();
            (
                name.clone(),
                TileMap::new(w, h, tiles)
                    .unwrap()
                    .with_layers(layers)
                    .unwrap(),
            )
        })
        .collect()
}
fn map<'a>(maps: &'a [(String, TileMap)], name: &Value) -> &'a TileMap {
    &maps
        .iter()
        .find(|(n, _)| n == name.as_str().unwrap())
        .unwrap()
        .1
}
fn faction(s: &str) -> FactionId {
    FactionId::ALL
        .into_iter()
        .find(|f| f.as_str() == s)
        .unwrap()
}
fn point(v: &Value) -> Vec2 {
    Vec2::new(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap())
}
fn number(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn observation(f: &Value, spec: &Value) -> Observation {
    let mut sim = Sim::new(
        SimConfig::default(),
        rh_sim::arenas::practice_arena(),
        Secrets {
            order_salt: 1,
            spawn_seed: 2,
            reward_salt: [3; 4],
        },
    );
    let id = sim
        .add_player("declared-context", Some(FactionId::Sentenced), false)
        .unwrap();
    let mut obs = rh_sim::observe(&sim, id, &[]);
    let me = obs.me.as_mut().unwrap();
    me.x = number(
        &spec["me"],
        "x",
        (f["anchor"]["x"].as_f64().unwrap() + 0.5) * 32.,
    );
    me.y = number(
        &spec["me"],
        "y",
        (f["anchor"]["y"].as_f64().unwrap() + 0.5) * 32.,
    );
    me.hp = number(&spec["me"], "hp", 100.);
    me.max_hp = number(&spec["me"], "maxHp", 100.);
    me.faction = faction(spec["me"]["faction"].as_str().unwrap_or("sentenced"));
    me.status = if spec["me"]["status"] == "dead" {
        Status::Dead
    } else {
        Status::Alive
    };
    me.attack_target = spec["me"]["attackTarget"].as_str().map(|_| PlayerId(123));
    obs.server_time = number(spec, "now", 100000.);
    obs.phase = if spec["hud"]["phase"] == "planning" {
        Phase::Planning
    } else {
        Phase::Active
    };
    obs.arena = Some(rh_sim::ArenaView {
        lobby_ends_at: 0.,
        plan_ends_at: 0.,
        raid_started_at: 0.,
        patience_ends_at: None,
        in_coliseum: spec["hud"]["inColiseum"].as_bool().unwrap_or(false),
        gates_locked: false,
        sudden_death_at: 0.,
        started_with: 1,
        min_players: 0,
    });
    obs
}
fn goal(spec: &Value) -> Goal {
    match spec["goal"].as_str() {
        Some("loot") => Goal::Loot,
        Some("holdWait") => Goal::HoldWait,
        Some("holdAmbush") => Goal::HoldAmbush,
        _ => Goal::Other,
    }
}
fn intent(i: &Value) -> Intent {
    let body = if i["kind"] == "move" {
        IntentBody::Move {
            to: point(&i["to"]),
        }
    } else {
        IntentBody::Stop {}
    };
    let timing = if i["timing"]["kind"] == "timed" {
        IntentTiming::Timed {
            due: i["timing"]["due"].as_f64().unwrap(),
        }
    } else {
        IntentTiming::Step {}
    };
    Intent {
        body,
        priority: i["priority"].as_u64().unwrap() as u8,
        timing,
        why: i["why"].as_str().unwrap().into(),
    }
}
fn intent_json(i: &Intent) -> Value {
    let mut result = json!({"kind":i.kind().as_str(),"priority":i.priority,"why":i.why});
    if let IntentBody::Move { to } = i.body {
        result["to"] = json!({"x":to.x,"y":to.y});
    }
    result["timing"] = match &i.timing {
        IntentTiming::Step {} => json!({"kind":"step"}),
        IntentTiming::Timed { due } => json!({"kind":"timed","due":due}),
        _ => panic!("unexpected reaction"),
    };
    result
}
fn equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, a)| y.get(k).is_some_and(|b| equivalent(a, b)))
        }
        _ => a == b,
    }
}
#[test]
fn actual_source_hazard_fsm_and_adjustments_reproduce() {
    let f = fixture();
    assert_eq!(
        f["reengageHp"].as_f64().unwrap(),
        crate::bots::types::PersonaParams::by_id(crate::bots::types::PersonaId::Hunter).reengage_hp
    );
    let maps = maps(&f);
    let mut state = Hazards::default();
    let mut previous = "";
    assert_eq!(f["steps"].as_array().unwrap().len(), 28);
    for row in f["steps"].as_array().unwrap() {
        let scenario = row["scenario"].as_str().unwrap();
        if previous != scenario {
            state.reset();
            previous = scenario;
        }
        let spec = &row["spec"];
        let obs = observation(&f, spec);
        let ctx = Context {
            still_since: obs.server_time - number(spec, "still", 1000.),
            observation: &obs,
            engaged: spec["engaged"].as_bool().unwrap_or(false),
            reengage_hp: crate::bots::types::PersonaParams::by_id(
                crate::bots::types::PersonaId::Hunter,
            )
            .reengage_hp,
            goal: goal(spec),
        };
        let result = state
            .intents(&ctx, map(&maps, &row["map"]))
            .map(|i| intent_json(&i));
        let got = Value::Array(result.into_iter().collect());
        assert!(
            equivalent(&got, &row["result"]),
            "{scenario}: native {got} vs source {}",
            row["result"]
        );
    }
    assert_eq!(f["adjusts"].as_array().unwrap().len(), 20);
    for row in f["adjusts"].as_array().unwrap() {
        let obs = observation(&f, &row["spec"]);
        let inputs: Vec<_> = row["intents"]
            .as_array()
            .unwrap()
            .iter()
            .map(intent)
            .collect();
        let adjusted = Hazards::default().adjust(&obs, map(&maps, &row["map"]), &inputs);
        if row["map"] == "plain" {
            assert!(matches!(adjusted, std::borrow::Cow::Borrowed(_)));
        }
        let got = Value::Array(adjusted.iter().map(intent_json).collect());
        assert!(
            equivalent(&got, &row["result"]),
            "adjust {} {}: {got} vs {}",
            row["map"],
            row["spec"],
            row["result"]
        );
    }
}
#[test]
fn actual_source_public_ground_classification_reproduces() {
    let f = fixture();
    let maps = maps(&f);
    assert_eq!(f["classifications"].as_array().unwrap().len(), 75);
    for row in f["classifications"].as_array().unwrap() {
        let m = map(&maps, &row["map"]);
        let fac = faction(row["faction"].as_str().unwrap());
        let at = point(&row["at"]);
        assert_eq!(burns(m, fac, at), row["burns"].as_bool().unwrap(), "{row}");
        assert_eq!(bad(m, fac, at), row["bad"].as_bool().unwrap(), "{row}");
    }
    for (key, value) in [
        ("stepEveryMs", STEP_EVERY_MS),
        ("stillMs", STILL_MS),
        ("stepTiles", STEP_TILES as f64),
        ("holdMs", HOLD_MS),
        ("arriveU", ARRIVE_U),
        ("redirectTiles", REDIRECT_TILES as f64),
        ("redirectMinU", REDIRECT_MIN_U),
        ("lightTiles", LIGHT_TILES as f64),
    ] {
        assert_eq!(f["rules"][key].as_f64().unwrap(), value, "{key}");
    }
}
#[test]
fn absent_owner_or_arena_never_invents_a_hazard_frame_and_reset_drops_steps() {
    let f = fixture();
    let maps = maps(&f);
    let mut obs = observation(&f, &json!({}));
    let map = &maps.iter().find(|(n, _)| n == "ember").unwrap().1;
    let mut state = Hazards::default();
    let run = |s: &mut Hazards, o: &Observation| {
        s.intents(
            &Context {
                observation: o,
                still_since: 0.,
                engaged: false,
                reengage_hp: crate::bots::types::PersonaParams::by_id(
                    crate::bots::types::PersonaId::Hunter,
                )
                .reengage_hp,
                goal: Goal::Other,
            },
            map,
        )
    };
    assert!(run(&mut state, &obs).is_some());
    state.reset();
    assert!(state.step.is_none() && state.last_step_at.is_none());
    obs.arena = None;
    assert!(run(&mut state, &obs).is_none());
    obs.me = None;
    assert!(run(&mut state, &obs).is_none());
}
#[test]
fn unrelated_tick_index_and_training_fact_do_not_change_hazard_decisions() {
    let f = fixture();
    let maps = maps(&f);
    let a = observation(&f, &json!({}));
    let mut b = a.clone();
    b.tick = 999999;
    b.training = !a.training;
    let m = &maps.iter().find(|(n, _)| n == "ember").unwrap().1;
    let run = |obs: &Observation| {
        Hazards::default().intents(
            &Context {
                observation: obs,
                still_since: 0.,
                engaged: false,
                reengage_hp: crate::bots::types::PersonaParams::by_id(
                    crate::bots::types::PersonaId::Hunter,
                )
                .reengage_hp,
                goal: Goal::Other,
            },
            m,
        )
    };
    assert_eq!(run(&a), run(&b));
    // These are direct API dependency checks, not a paired-world publication/noninterference proof.
}
