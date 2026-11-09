use super::*;
use crate::bots::random::derive;
use crate::bots::types::{IntentBody, IntentTiming, TierId};
use serde_json::{json, Value};
fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../parity/policy/bot-brain-prefix/source.json"
    ))
    .unwrap()
}
fn stimulus(kind: &str, now: f64) -> Stimulus {
    Stimulus {
        kind: StimulusKind::parse(kind).unwrap(),
        at: now,
        subject: None,
        central: true,
        value: None,
    }
}
#[test]
fn actual_source_brain_coordinator_call_sequence_and_rng_trace() {
    let f = corpus();
    assert_eq!(f["format"], "rh-bot-brain-prefix/1");
    let mut compared = 0;
    for case in f["schedulerCases"].as_array().unwrap() {
        let tier = TierParams::by_id(TierId::parse(case["tier"].as_str().unwrap()).unwrap());
        let seed = case["seed"].as_u64().unwrap() as u32;
        let mut decide = Rng::new(derive(seed, 0));
        let mut lapse = Rng::new(derive(seed, 2));
        let mut brain = Brain::default();
        for row in case["frames"].as_array().unwrap() {
            let now = row["now"].as_f64().unwrap();
            let stimuli: Vec<_> = row["stimuli"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| stimulus(s.as_str().unwrap(), now))
                .collect();
            let did_strategy = row["events"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s == "strategy");
            assert_eq!(
                brain.strategy_due(now, &stimuli),
                did_strategy,
                "{} at {now}",
                case["tier"]
            );
            let draws = row["draws"].as_array().unwrap();
            let before: Vec<_> = draws.iter().filter(|v| v["phase"] != "act").collect();
            let mut changed = false;
            if did_strategy {
                // Candidate scoring is NOT ported by this packet. Consume its recorded opaque
                // draw count, checking each actual source return; the final decision draw is the
                // coordinator's cadence draw. This does not supply a deadline/expected schedule.
                let source_decide: Vec<_> =
                    before.iter().filter(|v| v["stream"] == "decide").collect();
                assert!(!source_decide.is_empty());
                for v in &source_decide[..source_decide.len() - 1] {
                    assert_eq!(decide.next_f64(), v["value"].as_f64().unwrap());
                }
                for v in before.iter().filter(|v| v["stream"] == "lapse") {
                    assert_eq!(lapse.next_f64(), v["value"].as_f64().unwrap());
                }
                let mut peek = decide.clone();
                assert_eq!(
                    peek.next_f64(),
                    source_decide.last().unwrap()["value"].as_f64().unwrap()
                );
                changed = brain.adopt(
                    Goal::Fight {
                        target: format!("declared-module-slot-{}", row["slot"]),
                    },
                    now,
                    tier,
                    &mut decide,
                );
            } else {
                assert!(before.is_empty());
            }
            let did_act = row["events"].as_array().unwrap().iter().any(|s| s == "act");
            assert_eq!(
                brain.tactics_due(now, changed, row["toast"].as_bool().unwrap(), &stimuli),
                did_act,
                "{} at {now}",
                case["tier"]
            );
            let after: Vec<_> = draws.iter().filter(|v| v["phase"] == "act").collect();
            if did_act {
                assert_eq!(after.len(), 1, "the declared module returns no intents");
                let mut peek = decide.clone();
                assert_eq!(peek.next_f64(), after[0]["value"].as_f64().unwrap());
                let status = match row["status"].as_str().unwrap() {
                    "running" => Status::Running,
                    "blocked" => Status::Blocked,
                    "done" => Status::Done,
                    "failed" => Status::Failed,
                    _ => panic!(),
                };
                brain.acted(
                    now,
                    &Output {
                        intents: vec![],
                        status,
                        why: "declared",
                        attacking: false,
                    },
                    tier,
                    &mut decide,
                );
            } else {
                assert!(after.is_empty());
            }
            compared += 1;
        }
    }
    assert_eq!(compared, 483);
}
#[test]
fn goal_keys_cadence_cap_and_salient_conditions_are_the_source_conditions() {
    let mut b = Brain::default();
    let mut tier = *TierParams::by_id(TierId::Normal);
    tier.think_ms.mean = 5000.;
    tier.think_ms.jitter = 0.;
    let mut rng = Rng::new(3);
    assert!(b.adopt(
        Goal::Roam {
            to: Vec2::new(100., 100.),
            why: "centre"
        },
        100.,
        &tier,
        &mut rng
    ));
    assert!(!b.adopt(
        Goal::Roam {
            to: Vec2::new(101., 101.),
            why: "centre"
        },
        150.,
        &tier,
        &mut rng
    ));
    assert!(b.adopt(
        Goal::Roam {
            to: Vec2::new(300., 300.),
            why: "centre"
        },
        200.,
        &tier,
        &mut rng
    ));
    b.acted(
        200.,
        &Output {
            intents: vec![],
            status: Status::Running,
            why: "test",
            attacking: true,
        },
        &tier,
        &mut rng,
    );
    assert!(!b.tactics_due(2199., false, false, &[]));
    assert!(b.tactics_due(2200., false, false, &[]));
    assert!(b.strategy_due(201., &[stimulus("lockLost", 201.)]));
    assert!(!b.strategy_due(201., &[stimulus("foeSwapped", 201.)]));
    assert!(b.tactics_due(201., false, false, &[stimulus("foeSwapped", 201.)]));
    assert!(b.adopt(
        Goal::Hold {
            at: Vec2::new(1., 1.),
            why: "wait"
        },
        202.,
        &tier,
        &mut rng
    ));
    assert!(!b.adopt(
        Goal::Hold {
            at: Vec2::new(99., 99.),
            why: "wait"
        },
        203.,
        &tier,
        &mut rng
    ));
    assert!(!b.attacking);
}
fn intent(body: IntentBody, priority: u8) -> Intent {
    Intent {
        body,
        priority,
        timing: IntentTiming::Step {},
        why: "declared".into(),
    }
}
#[test]
fn channel_arbitration_preserves_first_extra_and_source_priority_rules() {
    let move_base = intent(
        IntentBody::Move {
            to: Vec2::new(10., 20.),
        },
        1,
    );
    let stop = intent(IntentBody::Stop {}, 2);
    let better = intent(
        IntentBody::Move {
            to: Vec2::new(30., 40.),
        },
        0,
    );
    let result = merge_intents(
        vec![move_base.clone()],
        vec![stop, better.clone(), move_base],
    );
    assert_eq!(result, vec![better]);
    // This simple public shape is useful in mutation output; no hidden bindings enter arbitration.
    assert_eq!(json!(result.len()), 1);
}

#[test]
fn actual_source_arbitration_is_observed_before_humanizer_submission() {
    fn numeric(v: Value) -> Value {
        match v {
            Value::Number(n) => json!(n.as_f64().unwrap()),
            Value::Array(a) => Value::Array(a.into_iter().map(numeric).collect()),
            Value::Object(o) => {
                Value::Object(o.into_iter().map(|(k, v)| (k, numeric(v))).collect())
            }
            other => other,
        }
    }
    fn read(v: &Value) -> Intent {
        let body = match v["kind"].as_str().unwrap() {
            "stop" => IntentBody::Stop {},
            "move" => IntentBody::Move {
                to: Vec2::new(
                    v["to"]["x"].as_f64().unwrap(),
                    v["to"]["y"].as_f64().unwrap(),
                ),
            },
            "cast" => IntentBody::Cast {
                slot: v["slot"].as_str().unwrap().into(),
                x: v["x"].as_f64().unwrap(),
                y: v["y"].as_f64().unwrap(),
                target: None,
                at: None,
                snap_radius: None,
            },
            _ => panic!(),
        };
        Intent {
            body,
            priority: v["priority"].as_u64().unwrap() as u8,
            timing: IntentTiming::Step {},
            why: v["why"].as_str().unwrap().into(),
        }
    }
    fn value(i: &Intent) -> Value {
        let mut v = json!({"kind":i.kind().as_str(),"priority":i.priority,"timing":{"kind":"step"},"why":i.why});
        match &i.body {
            IntentBody::Move { to } => {
                v["to"] = json!({"x":to.x,"y":to.y});
            }
            IntentBody::Cast { slot, x, y, .. } => {
                v["slot"] = json!(slot);
                v["x"] = json!(x);
                v["y"] = json!(y);
            }
            IntentBody::Stop {} => {}
            _ => panic!(),
        }
        v
    }
    let f = corpus();
    let cases = f["arbitrationCases"].as_array().unwrap();
    assert_eq!(cases.len(), 4);
    for case in cases {
        let result = merge_intents(
            case["base"].as_array().unwrap().iter().map(read).collect(),
            case["extra"].as_array().unwrap().iter().map(read).collect(),
        );
        assert_eq!(
            numeric(json!(result.iter().map(value).collect::<Vec<_>>())),
            numeric(case["result"].clone())
        );
    }
}
