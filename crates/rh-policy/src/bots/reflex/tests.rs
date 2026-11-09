//! Actual captured source component expectations, not installed native outcomes or a live Memory adapter.
use super::*;
use crate::bots::paths::PathBudget;
use crate::bots::random::derive;
use rh_sim::TileMap;
use serde_json::{json, Value};

const SOURCE: &str = include_str!("../../../../../parity/policy/bot-reflex/source.json");
const SCOPE: Scope = Scope {
    session: 7,
    epoch: 1,
};
fn fixture() -> Value {
    assert_eq!(SOURCE.len(), 401512);
    let f: Value = serde_json::from_str(SOURCE).unwrap();
    assert_eq!(f["format"], "rh-bot-reflex-source/1");
    assert_eq!(
        f["profile"]["base"],
        "a0c4818ce9df8ad0f4124db31e65ba1244bddc3b"
    );
    assert_eq!(
        f["profile"]["tags"],
        json!({"decide":0,"motor":1,"lapse":2})
    );
    f
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("finite actual source number")
}
fn point(v: &Value) -> Vec2 {
    Vec2::new(num(&v["x"]), num(&v["y"]))
}
fn key(v: &Value) -> MethodKey {
    MethodKey(v.as_str().unwrap().into())
}
fn actor(v: &Value) -> Actor {
    Actor {
        key: key(&v["id"]),
        at: point(v),
        alive: v["status"] == "alive",
        facing: num(&v["facing"]),
        hand: Fact::Known(v["inHand"].as_str().map(|s| BotWeapon::parse(s).unwrap())),
        draw_started_at: Fact::Known(num(&v["drawStartedAt"])),
        faction: Fact::Known(v["faction"].as_str().map(|s| {
            FactionId::ALL
                .into_iter()
                .find(|f| f.as_str() == s)
                .unwrap()
        })),
    }
}
#[derive(Clone)]
struct Input {
    clocks: Clocks,
    owner: Owner,
    projectiles: Vec<Projectile>,
    players: Vec<Actor>,
    mobs: Vec<Actor>,
    windups: Vec<WandWindup>,
    stimuli: Vec<Stimulus>,
    feints: Vec<PlayerFeints>,
}
impl Input {
    fn source(row: &Value) -> Self {
        let p = &row["input"]["percept"];
        let owner = &p["self"];
        Self {
            clocks: Clocks {
                now: num(&p["now"]),
                view_time: num(&p["viewT"]),
            },
            owner: Owner {
                key: key(&owner["id"]),
                at: point(owner),
                speed_mult: num(&owner["speedMult"]),
            },
            projectiles: p["projectiles"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| Projectile {
                    key: key(&v["id"]),
                    kind: match v["kind"].as_str().unwrap() {
                        "ball" => ProjectileKind::Ball,
                        "arrow" => ProjectileKind::Arrow,
                        _ => panic!("actual projectile kind"),
                    },
                    course: Fact::Known(CourseFacts {
                        from_self: v["from"] == owner["id"],
                        origin: Vec2::new(num(&v["x0"]), num(&v["y0"])),
                        at: point(v),
                        velocity: Vec2::new(num(&v["vx"]), num(&v["vy"])),
                        range: num(&v["range"]),
                    }),
                })
                .collect(),
            players: p["fighters"]
                .as_array()
                .unwrap()
                .iter()
                .map(actor)
                .collect(),
            mobs: p["mobs"].as_array().unwrap().iter().map(actor).collect(),
            windups: p["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["kind"] == "windup" && e["weapon"] == "wand")
                .map(|e| WandWindup {
                    by: key(&e["by"]),
                    at: num(&e["t"]),
                    duration_ms: num(&e["ms"]),
                    aim: num(&e["a"]),
                })
                .collect(),
            // These are genuine actual Memory.observe outputs from the source witness, supplied as
            // component INPUT facts. This does not install a Reflex result or port native Memory.
            stimuli: row["memory"]["stimuli"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| Stimulus {
                    kind: StimulusKind::parse(s["kind"].as_str().unwrap()).unwrap(),
                    at: num(&s["at"]),
                    subject: s["subject"].as_str().map(str::to_owned),
                    central: s["central"].as_bool().unwrap(),
                    value: s["value"].as_f64(),
                })
                .collect(),
            feints: row["memory"]["fighterFeints"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| PlayerFeints {
                    key: key(&v["id"]),
                    count: v["feints"].as_u64().unwrap(),
                })
                .collect(),
        }
    }
    fn frame(&self) -> Frame<'_> {
        Frame {
            scope: SCOPE,
            clocks: Fact::Known(self.clocks),
            owner: Fact::Known(&self.owner),
            projectiles: Fact::Known(&self.projectiles),
            players: Fact::Known(&self.players),
            mobs: Fact::Known(&self.mobs),
            wand_windups: Fact::Known(&self.windups),
            stimuli: Fact::Known(&self.stimuli),
            player_feints: Fact::Known(&self.feints),
        }
    }
}
struct RecordedPaths {
    actual: RoomPathService,
    calls: Vec<Value>,
}
impl RecordedPaths {
    fn new(f: &Value, name: &str) -> Self {
        let m = &f["maps"][name];
        Self {
            actual: RoomPathService::new(
                &TileMap::new(
                    m["w"].as_u64().unwrap() as u32,
                    m["h"].as_u64().unwrap() as u32,
                    m["tiles"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_u64().unwrap() as u8)
                        .collect(),
                )
                .unwrap(),
                PathBudget::new(3),
            ),
            calls: Vec::new(),
        }
    }
    fn begin(&mut self, p: &Value) {
        self.actual.budget_mut().start_tick();
        self.actual
            .set_frame(num(&p["now"]), p["hud"]["gatesLocked"].as_bool().unwrap());
        self.calls.clear();
    }
}
impl Paths for RecordedPaths {
    fn clear(&mut self, from: Vec2, to: Vec2) -> bool {
        let result = self.actual.clear(from, to);
        self.calls.push(json!({"method":"clear","args":[{"x":from.x,"y":from.y},{"x":to.x,"y":to.y}],"result":result}));
        result
    }
}
fn stimulus(s: &Stimulus) -> Value {
    let mut v = json!({"kind":s.kind.as_str(),"at":s.at,"subject":s.subject,"central":s.central});
    if let Some(value) = s.value {
        v["value"] = json!(value);
    }
    v
}
fn result(reflex: &Option<Reflex>) -> Value {
    let Some(r) = reflex else {
        return Value::Null;
    };
    let IntentBody::Move { to } = r.intent.body else {
        panic!("source reflex is a move");
    };
    let timing = match &r.intent.timing {
        IntentTiming::React { stimulus: s } => json!({"kind":"react","stimulus":stimulus(s)}),
        IntentTiming::Step {} => json!({"kind":"step"}),
        IntentTiming::Timed { due } => json!({"kind":"timed","due":due}),
    };
    json!({"kind":match r.kind{Kind::Dodge=>"dodge",Kind::Juke=>"juke"},"holdUntil":r.hold_until,"intent":{"kind":"move","to":{"x":to.x,"y":to.y},"priority":r.intent.priority,"timing":timing,"why":r.intent.why}})
}
fn compare(got: &Value, want: &Value, path: &str, max: &mut f64) {
    match (got, want) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (k, v) in a {
                compare(v, &b[k], &format!("{path}.{k}"), max);
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}[{i}]"), max);
            }
        }
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            let d = (a - b).abs();
            *max = (*max).max(d);
            if path.ends_with(".priority") || path.ends_with(".dodges") || path.ends_with(".jukes")
            {
                assert_eq!(a, b, "discrete {path}");
            } else {
                assert!(d <= 2e-6, "C-PARITY {path}: {a:?} != {b:?}, abs {d}");
            }
        }
        _ => assert_eq!(got, want, "discrete {path}"),
    }
}
fn source_rng(row: &Value, rng: &Rng, seed: u32) {
    let v = &row["rngAfter"]["decide"];
    let mut replay = Rng::new(derive(seed, 0));
    let draws = v["draws"].as_array().unwrap();
    assert_eq!(v["count"].as_u64().unwrap() as usize, draws.len());
    for d in draws {
        assert_eq!(
            replay.next_f64().to_bits(),
            num(d).to_bits(),
            "actual source stream draw"
        );
    }
    assert_eq!(*rng, replay, "exact actual stream consumption");
    assert_eq!(
        rng.clone().next_f64().to_bits(),
        num(&v["nextFromIndependentReplay"]).to_bits(),
        "exact source suffix"
    );
    for (name, tag) in [("motor", 1), ("lapse", 2)] {
        assert_eq!(row["rngAfter"][name]["count"], 0);
        assert_eq!(
            Rng::new(derive(seed, tag)).next_f64().to_bits(),
            num(&row["rngAfter"][name]["nextFromIndependentReplay"]).to_bits()
        );
    }
}
fn source_path_calls(row: &Value) -> Value {
    // Source services.ts138 clear(a:Vec2,b:Vec2) forwards to segmentClear, which reads
    // coordinates only. JS passes the original full SelfView as `a`; Rust accepts Vec2.
    // Verify that raw captured argument is precisely the actual input SelfView, then
    // compare the complete used geometry/method/order/result without fabricating HP/kit.
    json!(row["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|call| {
            assert_eq!(call["method"], "clear");
            let args = call["args"].as_array().unwrap();
            assert_eq!(args.len(), 2);
            assert_eq!(args[0], row["input"]["percept"]["self"]);
            json!({"method":call["method"],"args":args.iter().map(|p|json!({"x":p["x"],"y":p["y"]})).collect::<Vec<_>>(),"result":call["result"]})
        })
        .collect::<Vec<_>>())
}
fn case<'a>(f: &'a Value, name: &str) -> &'a Value {
    f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap()
}

#[test]
fn all_actual_source_49_sequences_68_frames_complete_outputs_paths_and_streams() {
    let f = fixture();
    for name in [
        "aim-lateral60-nominal-binary64-outside",
        "aim-lateral60-exact-3-4-5",
        "aim-lateral-below60",
        "aim-lateral-over60",
    ] {
        let input = Input::source(&case(&f, name)["rows"][0]);
        let from = input.players[0].at;
        let d = source_hypot(from.x - input.owner.at.x, from.y - input.owner.at.y);
        let bearing = math::atan2(input.owner.at.y - from.y, input.owner.at.x - from.x);
        let diff = angle_gap(input.windups[0].aim, bearing).unwrap();
        let sin = math::sin(diff);
        let lateral = d * sin;
        eprintln!("native aim diagnostic {name}: d={d:?}/{:016x} bearing={bearing:?}/{:016x} diff={diff:?}/{:016x} sin={sin:?}/{:016x} lateral={lateral:?}/{:016x}",d.to_bits(),bearing.to_bits(),diff.to_bits(),sin.to_bits(),lateral.to_bits());
    }
    let mut frames = 0;
    let mut checks = 0;
    let mut max = 0f64;
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 49);
    for c in cases {
        let seed = c["recipe"]["seed"].as_u64().unwrap() as u32;
        let tier = TierId::parse(c["recipe"]["tier"].as_str().unwrap()).unwrap();
        let mut reflex = Reflexes::new(SCOPE, MethodKey("p0".into()));
        let mut rng = Rng::new(derive(seed, 0));
        let mut paths = RecordedPaths::new(&f, c["recipe"]["map"].as_str().unwrap());
        for (i, row) in c["rows"].as_array().unwrap().iter().enumerate() {
            paths.begin(&row["input"]["percept"]);
            let input = Input::source(row);
            let at = format!("{}[{i}]", c["name"].as_str().unwrap());
            if row["called"].as_bool().unwrap() {
                checks += 1;
                let actual = reflex
                    .check(input.frame(), tier, &mut paths, &mut rng)
                    .unwrap();
                compare(&result(&actual), &row["result"], &at, &mut max);
            } else {
                assert!(
                    row.get("result").is_none(),
                    "observe-only is not a fabricated null result"
                );
            }
            compare(
                &json!({"holdUntil":reflex.hold_until(),"dodges":reflex.dodges(),"jukes":reflex.jukes()}),
                &row["state"],
                &format!("{at}.state"),
                &mut max,
            );
            compare(
                &json!(paths.calls),
                &source_path_calls(row),
                &format!("{at}.paths"),
                &mut max,
            );
            source_rng(row, &rng, seed);
            frames += 1;
        }
    }
    assert_eq!((frames, checks), (68, 67));
    eprintln!("actual source Reflexes: 49 sequences /68 frames /67 checks; exact discrete results, paths and RNG; maximum continuous abs difference {max:?}");
}

mod controls;
