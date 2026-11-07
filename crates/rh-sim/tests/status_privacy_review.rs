#![cfg(feature = "trusted-status-probes")]
use rh_sim::{
    status_runtime::{probe::*, *},
    *,
};
use serde_json::{json, Value};
fn id(s: &str) -> PlayerId {
    PlayerId(match s {
        "alice" => 1,
        "bob" => 2,
        "carol" => 3,
        _ => panic!("unknown input actor"),
    })
}
fn name(id: PlayerId) -> &'static str {
    match id.0 {
        1 => "alice",
        2 => "bob",
        3 => "carol",
        _ => panic!("unknown observed actor"),
    }
}
fn harness() -> Harness {
    let rows: Vec<String> = (0..20)
        .map(|y| {
            (0..40)
                .map(|x| {
                    if x == 0 || x == 39 || y == 0 || y == 19 || x == 20 {
                        '#'
                    } else {
                        '.'
                    }
                })
                .collect()
        })
        .collect();
    let map = TileMap::from_rows(&rows.iter().map(String::as_str).collect::<Vec<_>>()).unwrap();
    let placements: Vec<_> = (0..3)
        .map(|i| Placement {
            profile: ["ALICE", "BOB", "CAROL"][i].into(),
            faction: FactionId::Fire,
            bot: false,
            at: Vec2::new(200. + i as f64 * 60., 320.),
            hp: None,
            weapon0: None,
            weapon1: None,
        })
        .collect();
    let sim = Sim::reset_active(
        SimConfig {
            consumables: true,
            faction_mode: FactionMode::Off,
            pvp_rules: false,
            ..Default::default()
        },
        sim::Arena {
            map,
            spawns: placements.iter().map(|p| p.at).collect(),
        },
        Secrets::from_seed(11),
        &placements,
    );
    let mut h = Harness::new(sim);
    h.set_observers(false);
    h.execute(Operation::Clock {
        at: 1000.,
        tick: 20,
    })
    .unwrap();
    for i in 1..=3 {
        h.execute(Operation::Actor {
            id: PlayerId(i),
            patch: ActorPatch {
                immune_until: Some(0.),
                weapon0: Some(None),
                ..Default::default()
            },
        })
        .unwrap();
    }
    h
}
fn apply(h: &mut Harness, op: &Value) {
    let n = |v: &Value| v.as_f64().unwrap();
    let operation = match op["kind"].as_str().unwrap() {
        "actorPatch" => Operation::Actor {
            id: id(op["id"].as_str().unwrap()),
            patch: ActorPatch {
                position: Some(Vec2::new(n(&op["patch"]["x"]), n(&op["patch"]["y"]))),
                ..Default::default()
            },
        },
        "apply" => Operation::Apply {
            id: id(op["id"].as_str().unwrap()),
            apply: StatusApply {
                kind: StatusKind::Hidden,
                source: StatusSource {
                    id: Some(PlayerId(2)),
                    name: "BOB".into(),
                    owner_id: None,
                },
                ms: n(&op["apply"]["ms"]),
                ability: Some(AbilityId::Swarm),
                tag: None,
                value: None,
                add: None,
                data: None,
            },
            quiet: false,
        },
        "fieldAdd" => {
            let f = &op["field"];
            Operation::AddField(Field {
                id: 0,
                kind: serde_json::from_value(f["kind"].clone()).unwrap(),
                ability: serde_json::from_value(f["ability"].clone()).unwrap(),
                owner: StatusSource {
                    id: Some(PlayerId(2)),
                    name: "BOB".into(),
                    owner_id: None,
                },
                subject: None,
                x: n(&f["x"]),
                y: n(&f["y"]),
                x2: n(&f["x2"]),
                y2: n(&f["y2"]),
                r: n(&f["r"]),
                vx: n(&f["vx"]),
                vy: n(&f["vy"]),
                started_at: n(&f["startedAt"]),
                ends_at: n(&f["endsAt"]),
                exit_stun_ms: None,
            })
        }
        "removePlayer" => Operation::RemovePlayer(id(op["id"].as_str().unwrap())),
        "reveal" => Operation::Reveal {
            id: id(op["id"].as_str().unwrap()),
            until: n(&op["until"]),
        },
        "clock" => Operation::Clock {
            at: n(&op["at"]),
            tick: 20,
        },
        "updateAbilities" => Operation::UpdateAbilities,
        _ => panic!("unknown operation"),
    };
    h.execute(operation).unwrap();
}
fn facts(obs: &observe::Observation) -> Value {
    let mut effects = serde_json::Map::new();
    effects.insert("alice".into(), json!(obs.me.as_ref().unwrap().effects));
    for p in &obs.visible {
        effects.insert(name(p.id).into(), json!(p.effects));
    }
    let mut fields:Vec<_>=obs.fields.iter().map(|f|json!({"kind":f.kind,"ability":f.ability,"x":f.x,"y":f.y,"x2":f.x2,"y2":f.y2,"r":f.r,"owner":f.owner.map(name),"endsAt":f.ends_at})).collect();
    fields.sort_by_key(Value::to_string);
    json!({"actors":obs.visible.iter().map(|p|name(p.id)).collect::<Vec<_>>(),"fields":fields,"effects":effects})
}
fn equiv(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equiv(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, a)| b.get(k).is_some_and(|b| equiv(a, b)))
        }
        _ => a == b,
    }
}
#[test]
fn actual_source_visible_unseen_field_and_hidden_effect_pairs() {
    // This immutable source answer is byte-bound before its test-only input adapter runs.
    // Unknown/duplicate keys and any changed source inventory cannot silently pass this gate.
    let raw = include_str!("../../../parity/status/independent-privacy.json");
    let fingerprint = raw.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    assert_eq!(fingerprint, 0xfa60a65657a814dd);
    let root: Value = serde_json::from_str(raw).unwrap();
    let cases = root["cases"].as_array().unwrap();
    assert_eq!(
        cases
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "visible-owner",
            "unseen-owner",
            "hidden-owner",
            "unseen-origin",
            "trail-unseen-end",
            "trail-unseen-start",
            "trail-visible",
            "departed-owner",
            "duplicate-public-facts",
            "hidden-allocation-before",
            "reveal-next-tick",
            "reveal-open-boundary",
            "expiry-before-refresh",
            "expiry-after-refresh"
        ]
    );
    for c in cases {
        let mut a = harness();
        let mut b = harness();
        for op in c["operations"].as_array().unwrap() {
            apply(&mut a, op);
            apply(&mut b, op);
        }
        let before = a.sim().state_hash();
        let obs = observe::observe(a.sim(), PlayerId(1), &[]);
        let public = facts(&obs);
        assert!(
            equiv(&public, &c["publicFacts"]),
            "{} native {public} source {}",
            c["name"],
            c["publicFacts"]
        );
        assert_eq!(obs, observe::observe(a.sim(), PlayerId(1), &[]));
        assert_eq!(before, a.sim().state_hash());
        for _ in 0..5 {
            let ar = a.execute(Operation::Step).unwrap();
            let br = b.execute(Operation::Step).unwrap();
            assert_eq!(ar, br);
            assert_eq!(a.sim().state_hash(), b.sim().state_hash());
        }
    }
}
#[test]
fn checkpoint_refuses_never_allocated_field_references_but_keeps_departed_fields() {
    let mut h = harness();
    let source = StatusSource {
        id: Some(PlayerId(2)),
        name: "BOB".into(),
        owner_id: None,
    };
    let Returned::Field(Some(field)) = h
        .execute(Operation::AddField(Field {
            id: 0,
            kind: FieldKind::Zone,
            ability: AbilityId::Trial,
            owner: source.clone(),
            subject: Some(PlayerId(1)),
            x: 200.,
            y: 320.,
            x2: 200.,
            y2: 320.,
            r: 50.,
            vx: 0.,
            vy: 0.,
            started_at: 1000.,
            ends_at: 5000.,
            exit_stun_ms: None,
        }))
        .unwrap()
    else {
        panic!("field")
    };
    h.execute(Operation::Apply {
        id: PlayerId(1),
        apply: StatusApply {
            kind: StatusKind::Zoned,
            source,
            ms: 1000.,
            ability: Some(AbilityId::Trial),
            tag: None,
            value: None,
            add: None,
            data: Some(Payload {
                field_id: Some(field.id),
                ..Default::default()
            }),
        },
        quiet: true,
    })
    .unwrap();
    h.execute(Operation::RemoveField(field.id)).unwrap();
    let original = serde_json::to_value(h.sim()).unwrap();
    assert!(
        Sim::restore(original.clone()).is_ok(),
        "legitimate removed field reference"
    );
    let mut bad = original;
    bad["world"]["players"][0]["core"]["statuses"]["instances"][0]["data"]["field_id"] = json!(999);
    assert!(
        Sim::restore(bad).is_err(),
        "never-allocated future field reference admitted"
    );
}
