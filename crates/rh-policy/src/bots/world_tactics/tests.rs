use super::*;
use serde_json::{json, Value};
fn numeric(v: Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.into_iter().map(numeric).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, numeric(v))).collect()),
        other => other,
    }
}
fn why(v: &str) -> &'static str {
    match v {
        "wait" => "wait",
        "ambush" => "ambush",
        "centre" => "centre",
        _ => panic!("unknown fixture reason"),
    }
}
fn goal(v: &Value) -> Goal {
    match v["kind"].as_str().unwrap() {
        "idle" => Goal::Idle,
        "roam" => Goal::Roam {
            to: at(&v["to"]),
            why: why(v["why"].as_str().unwrap()),
        },
        "hold" => Goal::Hold {
            at: at(&v["at"]),
            why: why(v["why"].as_str().unwrap()),
        },
        _ => panic!(),
    }
}
fn at(v: &Value) -> Vec2 {
    Vec2::new(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap())
}
fn output_json(o: &Output) -> Value {
    let intents: Vec<_> = o
        .intents
        .iter()
        .map(|i| {
            let mut v = json!({"priority":i.priority,"timing":{"kind":"step"},"why":i.why});
            match i.body {
                IntentBody::Move { to } => {
                    v["kind"] = json!("move");
                    v["to"] = json!({"x":to.x,"y":to.y});
                }
                IntentBody::Stop {} => {
                    v["kind"] = json!("stop");
                }
                _ => panic!(),
            };
            v
        })
        .collect();
    json!({"intents":intents,"status":{"state":match o.status { Status::Running=>"running",Status::Done=>"done",Status::Failed=>"failed",Status::Blocked=>"blocked" },"why":o.why},"attacking":o.attacking})
}
#[test]
fn actual_source_world_tactics_matches_every_declared_sequence_step() {
    let f: Value = serde_json::from_str(include_str!(
        "../../../../../parity/policy/bot-brain-prefix/source.json"
    ))
    .unwrap();
    let mut world = WorldTactics::default();
    let mut count = 0;
    for row in f["worldCases"].as_array().unwrap() {
        let input = &row["input"];
        let mut walks = 0;
        let output = world
            .act(
                &goal(&input["goal"]),
                Context {
                    now: input["now"].as_f64().unwrap(),
                    at: at(&input["at"]),
                    still_since: input["stillSince"].as_f64().unwrap(),
                },
                |_, _| {
                    walks += 1;
                    input["walkable"].as_bool().unwrap()
                },
            )
            .unwrap();
        assert_eq!(
            numeric(output_json(&output)),
            numeric(row["result"].clone()),
            "step {count}"
        );
        assert_eq!(walks, row["walks"].as_u64().unwrap());
        count += 1;
    }
    assert_eq!(count, 13);
}
#[test]
fn unsupported_coliseum_and_fight_goals_are_not_substituted_with_idle() {
    let mut world = WorldTactics::default();
    let ctx = Context {
        now: 100.,
        at: Vec2::new(1., 1.),
        still_since: 100.,
    };
    for goal in [
        Goal::Hold {
            at: ctx.at,
            why: "coliseum",
        },
        Goal::Fight {
            target: "p2".into(),
        },
    ] {
        assert!(world
            .act(&goal, ctx, |_, _| panic!(
                "unsupported must not query a path"
            ))
            .is_none());
    }
    world.reset();
    assert!(world.slots.is_empty());
}
