//! First test replays only ACTUAL captured Frame inputs into the private composer.
//! Remaining controls are explicitly declared native method contexts, NOT source parity.
use super::*;
use crate::bots::temporal_percept::input::Maps;
use crate::bots::view::{detect_features, FeatureProbe, Features};
use rh_sim::TileMap;
use serde_json::{json, Value};

fn data(value: &Value) -> MessageData {
    match value {
        Value::Null => MessageData::Null,
        Value::Bool(v) => MessageData::Bool(*v),
        Value::Number(v) => num(v.as_f64().expect("source binary64")),
        Value::String(v) => text(v),
        Value::Array(v) => MessageData::Arr(v.iter().map(data).collect()),
        Value::Object(v) => MessageData::Obj(v.iter().map(|(k, v)| (k.clone(), data(v))).collect()),
    }
}
fn json_data(value: MessageData) -> Value {
    match value {
        MessageData::Null => Value::Null,
        MessageData::Bool(v) => Value::Bool(v),
        MessageData::Num(v) => json!(v),
        MessageData::Str(v) => Value::String(v),
        MessageData::Arr(v) => Value::Array(v.into_iter().map(json_data).collect()),
        MessageData::Obj(v) => {
            Value::Object(v.into_iter().map(|(k, v)| (k, json_data(v))).collect())
        }
    }
}
fn frame(value: &Value) -> Frame {
    Frame::read(data(value)).expect("declared complete Frame")
}
fn maps(w: u32, h: u32) -> Maps {
    let open = TileMap::new(w, h, vec![0; (w * h) as usize]).unwrap();
    Maps {
        locked: open.clone(),
        open,
    }
}
fn config<'a>(maps: &'a Maps, features: &'a Features, delay: f64) -> Compose<'a> {
    Compose {
        self_delay_ms: 0.,
        world_delay_ms: delay,
        attention_central: 0.65,
        maps,
        features,
    }
}

fn compare(got: &Value, want: &Value, path: &str, max: &mut f64) {
    match (got, want) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "keys {path}"
            );
            for (key, got) in a {
                compare(got, &b[key], &format!("{path}.{key}"), max);
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "length {path}");
            for (index, (got, want)) in a.iter().zip(b).enumerate() {
                compare(got, want, &format!("{path}[{index}]"), max);
            }
        }
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            let delta = (a - b).abs();
            *max = (*max).max(delta);
            if [".x", ".y", ".vx", ".vy", ".dist", ".tint"]
                .iter()
                .any(|suffix| path.ends_with(suffix))
            {
                // Existing C-PARITY absolute2e-6, with NO rounding of either value.
                assert!(
                    delta <= 2e-6,
                    "C-PARITY {path}: {a:?} != {b:?}, delta{delta}"
                );
            } else {
                assert_eq!(a, b, "discrete/clock/pass-through {path}");
            }
        }
        _ => assert_eq!(got, want, "discrete {path}"),
    }
}

#[test]
fn earned_runner_actual_frames_replay_all_five_prefilter_schedules() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/npc-runner-callsite/source.json");
    let file = std::fs::File::open(path).expect("unchanged tracked source oracle");
    assert_eq!(file.metadata().unwrap().len(), 30_636_484);
    let source: Value = serde_json::from_reader(file).unwrap();
    assert_eq!(source["format"], "rh-npc-runner-callsite/1");
    let maps = maps(96, 48); // Exact world.mts: WIDTH96/HEIGHT48, all-floor map, empty gates.
                             // INPUT context from actual source detectFeatures/new schema declarations, not
                             // expected Percept.features. runner.mts uses default CLIENT_MESSAGE_TYPES.
    let features = detect_features(&FeatureProbe {
        state: data(&json!({"fields":{},"camps":[]})),
        player: Some(data(&json!({"wishReadyAt":0,"effects":0,"build":{}}))),
        map_terrain: Some(vec![0; 96 * 48]),
        map_hazards: false,
        message_types: None,
    });
    let mut frames = 0;
    let mut composed = 0;
    let mut startup = 0;
    let mut mob_rows = 0;
    let mut container_rows = 0;
    let mut max: f64 = 0.;
    let runs = source["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 5);
    for run in runs {
        let mut ring = Ring::default();
        let profile = &run["profile"];
        let cfg = Compose {
            self_delay_ms: profile["selfDelayMs"].as_f64().unwrap(),
            world_delay_ms: profile["worldDelayMs"].as_f64().unwrap(),
            attention_central: crate::bots::types::TIERS[1].attention.central,
            maps: &maps,
            features: &features,
        };
        for (index, row) in run["actual"]["publicTrace"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            // ONLY actual publicTrace.frame is input. Expected output is read below
            // after compose and never supplies any frame/config/source field.
            let input = frame(&row["frame"]);
            assert!(
                input.fighters.is_empty()
                    && input.projectiles.is_empty()
                    && input.events.is_empty()
                    && input.immediate.is_empty(),
                "this oracle's honest empty coverage"
            );
            mob_rows += input.mobs.len();
            container_rows += input.containers.len();
            assert_eq!(input.time, row["sourceTime"].as_f64().unwrap());
            ring.push(input);
            frames += 1;
            let got = ring.compose(&cfg).unwrap();
            match got {
                None => {
                    assert!(row["prefilterPercept"].is_null());
                    startup += 1;
                }
                Some(got) => {
                    composed += 1;
                    compare(
                        &json_data(got.data()),
                        &row["prefilterPercept"],
                        &format!("{}.frame{index}", profile["id"]),
                        &mut max,
                    );
                }
            }
        }
    }
    assert_eq!(
        (frames, composed, startup, mob_rows, container_rows),
        (1549, 1541, 8, 309, 66)
    );
    eprintln!("actual source temporal frames={frames},prefilter={composed},startupNull={startup},maxRawAbs={max:?}; flight/fighter/event families not reached");
}

// All following recipes are native-only controls, never installed source outcomes.
fn declared(time: f64, x: f64) -> Value {
    json!({"t":time,"self":{"id":"self","x":x,"y":320,"status":"alive","faction":"fire","weapons":["sword",null],"slot":0},
        "hud":{"phase":"active","gatesLocked":false},"fighters":[],"mobs":[],"containers":[],"projectiles":[],
        "minimap":{"t":time,"mobs":[],"gatesLocked":false},"events":[],"immediate":[],"extras":{}})
}
fn actor(id: &str, x: f64) -> Value {
    json!({"id":id,"x":x,"y":320,"status":"alive","kind":"mob","faction":"fire","inHand":"axe","name":"duplicate label"})
}
fn event(kind: &str, time: f64, at: Value) -> Value {
    json!({"kind":kind,"t":time,"at":at})
}
fn flight(id: &str, origin: f64, vx: f64, started: f64) -> Value {
    json!({"id":id,"kind":"ball","x":origin,"y":320,"vx":vx,"vy":0,"x0":origin,"y0":320,"t0":started,"range":640,"from":null})
}
fn value(ring: &mut Ring, cfg: &Compose<'_>) -> Value {
    json_data(ring.compose(cfg).unwrap().unwrap().data())
}

#[test]
fn declared_timestamp_replacement_late_ignore_and_velocity_use_exact_hundred_ms() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 50.);
    let mut ring = Ring::default();
    for t in [0., 50., 100., 150.] {
        let mut f = declared(t, 320.);
        f["fighters"] = json!([actor("p", 400. + t)]);
        ring.push(frame(&f));
    }
    let p = value(&mut ring, &cfg);
    assert_eq!(p["fighters"][0]["x"], 500.);
    assert_eq!(p["fighters"][0]["vx"], 1000.);
    let mut replacement = declared(150., 320.);
    replacement["fighters"] = json!([actor("p", 580.)]);
    assert!(ring.push(frame(&replacement)).replaced);
    let before = ring.clone();
    assert!(ring.push(frame(&declared(149., 999.))).late_ignored);
    assert_eq!(ring, before);
    assert_eq!(ring.size(), 4);
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["x"], 500.);
}

#[test]
fn declared_teleport_camera_scene_cut_and_strict_distance_guard() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 50.);
    let mut ring = Ring::default();
    let mut a = declared(0., 320.);
    a["fighters"] = json!([actor("p", 400.)]);
    ring.push(frame(&a));
    let mut b = declared(100., 1600.);
    b["fighters"] = json!([actor("p", 1700.)]);
    b["events"] = json!([event("teleport", 100., Value::Null)]);
    ring.push(frame(&b));
    let p = value(&mut ring, &cfg);
    assert_eq!(p["self"]["x"], 1600.);
    assert_eq!(p["fighters"][0]["x"], 400.);
    assert_eq!(p["fighters"][0]["vx"], 0.);
    ring.push(frame(&declared(150., 1600.)));
    assert_eq!(value(&mut ring, &cfg)["events"][0]["kind"], "teleport");
    let mut ring = Ring::default();
    let mut a = declared(0., 320.);
    a["fighters"] = json!([actor("p", 400.)]);
    ring.push(frame(&a));
    let mut b = declared(100., 320.);
    b["fighters"] = json!([actor("p", 600.)]);
    ring.push(frame(&b));
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["x"], 500.);
    b["fighters"][0]["x"] = json!(600.0001);
    ring.push(frame(&b));
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["x"], 400.);
}

#[test]
fn declared_flight_course_retains_hidden_map_order_once_credit_end_and_done() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    let mut f = declared(0., 320.);
    f["projectiles"] = json!([flight("z", 320., 100., 0.), flight("a", 320., 100., 0.)]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert_eq!(p["projectiles"][0]["id"], "z");
    assert_eq!(p["projectiles"][1]["id"], "a");
    assert_eq!(p["projectiles"][0]["from"], "self");
    let f = declared(100., 2500.);
    ring.push(frame(&f));
    assert!(value(&mut ring, &cfg)["projectiles"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(ring.flights.len(), 2);
    let mut f = declared(200., 320.);
    let mut end = event("projEnd", 200., json!({"x":340,"y":320}));
    end["id"] = json!("z");
    end["reason"] = json!("hit");
    f["events"] = json!([end]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert_eq!(p["projectiles"].as_array().unwrap().len(), 1);
    assert_eq!(p["projectiles"][0]["id"], "a");
    let mut f = declared(250., 320.);
    f["projectiles"] = json!([flight("z", 320., 100., 0.)]);
    ring.push(frame(&f));
    assert_eq!(
        value(&mut ring, &cfg)["projectiles"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    ring.reset();
    assert!(
        ring.done.is_empty()
            && ring.flights.is_empty()
            && ring.frames.is_empty()
            && ring.world.is_empty()
    );
}

#[test]
fn declared_attribution_is_strict_nearest_public_drawn_actor_and_persists_null() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    let mut f = declared(0., 320.);
    f["fighters"] = json!([actor("p", 400.)]);
    f["projectiles"] = json!([
        flight("one", 400., 100., 0.),
        flight("none", 1000., 100., 0.)
    ]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert_eq!(p["projectiles"][0]["from"], "p");
    assert!(p["projectiles"][1]["from"].is_null());
    let mut f = declared(50., 1000.);
    f["fighters"] = json!([actor("p", 1000.)]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert!(p["projectiles"][1]["from"].is_null());
}

#[test]
fn declared_world_then_immediate_order_redaction_and_announcement_subject_lifetime() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    let mut f = declared(0., 320.);
    f["fighters"] = json!([actor("hidden", 2000.)]);
    let mut hit = event("hit", 0., json!({"x":400,"y":320}));
    hit["by"] = json!("hidden");
    let mut ext = event("ext", 0., json!({"x":400,"y":320}));
    ext["data"] = json!({"by":"hidden","unrelated":"label"});
    f["events"] = json!([hit, ext]);
    f["immediate"] = json!([event("toast", 0., Value::Null)]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    let events = p["events"].as_array().unwrap();
    assert_eq!(events.len(), 3);
    assert!(events[0]["by"].is_null());
    assert!(events[1]["data"]["by"].is_null());
    assert_eq!(events[1]["data"]["unrelated"], "label");
    assert_eq!(events[2]["kind"], "toast");
    assert!(value(&mut ring, &cfg)["events"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn declared_death_pending_body_fade_and_extras_are_windowed_without_dropping_chests() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 100.);
    let mut ring = Ring::default();
    let mut f = declared(0., 320.);
    f["mobs"] = json!([actor("m", 400.)]);
    ring.push(frame(&f));
    let mut f = declared(100., 320.);
    let mut dead = actor("m", 400.);
    dead["status"] = json!("dead");
    f["mobs"] = json!([dead]);
    f["containers"] = json!([{"id":"body","kind":"body","x":400,"y":320}]);
    let mut death = event("death", 100., json!({"x":400,"y":320}));
    death["id"] = json!("m");
    death["by"] = Value::Null;
    death["mob"] = json!(true);
    f["events"] = json!([death]);
    f["extras"] = json!({"effects":{"self":1,"m":2,"hidden":4},"fields":[{"id":"field","kind":"disc","x":400,"y":320,"x2":400,"y2":320,"r":10,"owner":"hidden"}],"chests":[{"x":99999,"y":99999}]});
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert!(p["containers"].as_array().unwrap().is_empty());
    assert_eq!(p["mobs"].as_array().unwrap().len(), 1);
    assert_eq!(p["extras"]["effects"], json!({"self":1.0,"m":2.0}));
    assert!(p["extras"]["fields"][0]["owner"].is_null());
    assert_eq!(p["extras"]["chests"].as_array().unwrap().len(), 1);
    f["t"] = json!(650.);
    f["events"] = json!([]);
    ring.push(frame(&f));
    assert!(value(&mut ring, &cfg)["mobs"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn declared_source_overflow_is_reported_not_claimed_as_safe_public_admission() {
    let mut f = declared(0., 320.);
    f["events"] = Value::Array(
        (0..MAX_QUEUED + 2)
            .map(|_| event("teleport", 10000., Value::Null))
            .collect(),
    );
    f["immediate"] = f["events"].clone();
    let mut ring = Ring::default();
    let report = ring.push(frame(&f));
    assert_eq!((report.world_evicted, report.immediate_evicted), (2, 2));
    for n in 1..140 {
        ring.push(frame(&declared(f64::from(n), 320.)));
    }
    assert_eq!(ring.size(), 128);
    assert_eq!(ring.world.len(), 4096);
}

#[test]
fn unavailable_nonfinite_and_failed_composition_leave_reached_state_unchanged() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    ring.push(frame(&declared(0., 320.)));
    let before = ring.clone();
    let mut missing = declared(100., 320.);
    missing.as_object_mut().unwrap().remove("projectiles");
    assert_eq!(
        Frame::read(data(&missing)),
        Err(Error::Missing("projectiles"))
    );
    assert_eq!(ring, before);
    let mut bad = data(&declared(100., 320.));
    if let MessageData::Obj(rows) = &mut bad {
        rows.iter_mut().find(|(k, _)| k == "t").unwrap().1 = num(f64::NAN);
    }
    assert_eq!(Frame::read(bad), Err(Error::Nonfinite));
    assert_eq!(ring, before);
    let invalid = Compose {
        world_delay_ms: f64::INFINITY,
        ..cfg
    };
    assert_eq!(ring.compose(&invalid), Err(Error::Nonfinite));
    assert_eq!(ring, before);
    let _ = value(&mut ring, &config(&maps, &features, 0.));
    ring.reset();
    assert_eq!(ring, Ring::default());
}

#[test]
fn declared_tint_nearest_foe_strict_mob_tie_and_unknown_faction_are_distinct() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    let mut f = declared(0., 320.);
    f["fighters"] = json!([actor("p", 400.)]);
    ring.push(frame(&f));
    // Source Sword>Axe score1, full-range tint1/2, not an outcome/DPS claim.
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["tint"], 0.5);
    f["t"] = json!(50.);
    f["mobs"] = json!([actor("m", 400.)]);
    ring.push(frame(&f));
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["tint"], 0.5);
    f["t"] = json!(100.);
    f["mobs"][0]["x"] = json!(360.);
    ring.push(frame(&f));
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["tint"], 0.);
    f["t"] = json!(150.);
    f["mobs"] = json!([]);
    f["self"]["faction"] = Value::Null;
    ring.push(frame(&f));
    assert_eq!(value(&mut ring, &cfg)["fighters"][0]["tint"], 0.);
}

#[test]
fn declared_flight_tombstones_have_source_insertion_lifetime_and_reflected_vanish() {
    let maps = maps(96, 48);
    let features = Features::default();
    let cfg = config(&maps, &features, 0.);
    let mut ring = Ring::default();
    let mut f = declared(1000., 320.);
    let mut rows = Vec::new();
    for index in 0..=DONE_MAX {
        let mut p = flight(&format!("flight{index}"), 320., 1000., 0.);
        p["range"] = json!(0.);
        rows.push(p);
    }
    f["projectiles"] = Value::Array(rows);
    ring.push(frame(&f));
    assert!(value(&mut ring, &cfg)["projectiles"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(ring.done.len(), DONE_MAX);
    assert_eq!(ring.done.front().unwrap().0, "flight1");
    f["t"] = json!(1500.);
    f["projectiles"] = json!([
        flight("flight0", 320., 100., 1500.),
        flight("flight1", 320., 100., 1500.)
    ]);
    ring.push(frame(&f));
    let p = value(&mut ring, &cfg);
    assert_eq!(p["projectiles"].as_array().unwrap().len(), 1);
    assert_eq!(p["projectiles"][0]["id"], "flight0");
    // Declared method stop: its endpoint caps the drawn course. This is not a
    // claim that this end timing was earned in a physical World.
    let mut f = declared(1600., 320.);
    let mut end = event("projEnd", 1700., json!({"x":325,"y":320}));
    end["id"] = json!("flight0");
    end["reason"] = json!("reflected");
    f["events"] = json!([end]);
    ring.push(frame(&f));
    assert!(value(&mut ring, &cfg)["projectiles"]
        .as_array()
        .unwrap()
        .is_empty());
}
