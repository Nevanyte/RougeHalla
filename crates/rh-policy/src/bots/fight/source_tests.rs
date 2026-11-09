//! Actual-source method expectations, never native-generated golden outcomes.
use super::*;
use crate::bots::orbwalk::Step;
use crate::bots::paths::PathBudget;
use crate::bots::random::derive;
use crate::bots::types::{IntentTiming, PersonaId};
use rh_sim::TileMap;
use serde_json::{json, Value};

const SOURCE: &str = include_str!("../../../../../parity/policy/bot-fight/source.json");
fn fixture() -> Value {
    assert_eq!(SOURCE.len(), 467672);
    let value: Value = serde_json::from_str(SOURCE).unwrap();
    assert_eq!(value["format"], "rh-bot-fight-source/1");
    assert_eq!(value["profile"]["node"], "v22.23.4");
    value
}
fn num(v: &Value) -> f64 {
    v.as_f64().expect("declared source number")
}
fn point(v: &Value) -> Vec2 {
    Vec2::new(num(&v["x"]), num(&v["y"]))
}
fn faction(v: &Value) -> Option<FactionId> {
    v.as_str().map(|s| {
        FactionId::ALL
            .into_iter()
            .find(|f| f.as_str() == s)
            .unwrap()
    })
}
fn status(v: &Value) -> Status {
    match v.as_str().unwrap() {
        "alive" => Status::Alive,
        "lobby" => Status::Lobby,
        "dead" => Status::Dead,
        "mia" => Status::Mia,
        _ => panic!("source status"),
    }
}
// Declared typed mapping source p0 -> public PlayerRef(1), source p1 -> PlayerRef(2).
// It never depends on participant labels or a private actor ID.
fn player(s: &str) -> PlayerRef {
    PlayerRef::new(if s == "never-seen" {
        99
    } else {
        s.strip_prefix('p').unwrap().parse::<u32>().unwrap() + 1
    })
    .unwrap()
}
fn source_key(s: &str) -> String {
    format!(
        "p{}",
        s.strip_prefix('p').unwrap().parse::<u32>().unwrap() - 1
    )
}
fn owner(p: &Value) -> Owner {
    let s = &p["self"];
    Owner {
        id: player(s["id"].as_str().unwrap()),
        at: point(s),
        status: status(&s["status"]),
        faction: faction(&s["faction"]),
        inventory: Some(std::array::from_fn(|i| {
            s["weapons"][i]
                .as_str()
                .map(|w| BotWeapon::parse(w).unwrap())
        })),
        slot: s["slot"].as_u64().unwrap() as u8,
        lock: Some(
            s["attackTarget"]
                .as_str()
                .map_or(Lock::Clear, |id| Lock::Held {
                    target: Some(player(id)),
                }),
        ),
        ready_at: num(&s["readyAt"]),
        draw_started_at: num(&s["drawStartedAt"]),
        as_mult: num(&s["asMult"]),
        windup_mult: s["windupMult"].as_f64(),
    }
}
fn seen(p: &Value) -> Vec<SeenPlayer> {
    p["fighters"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| SeenPlayer {
            id: player(f["id"].as_str().unwrap()),
            at: point(f),
            velocity: Vec2::new(num(&f["vx"]), num(&f["vy"])),
            status: status(&f["status"]),
            faction: faction(&f["faction"]).unwrap(),
            weapon: f["inHand"].as_str().map(|w| BotWeapon::parse(w).unwrap()),
            hp_frac: num(&f["hpFrac"]),
            targetable: f["targetable"].as_bool().unwrap(),
            bounty: f["bounty"].as_u64().unwrap() as u32,
        })
        .collect()
}
fn frame<'a>(p: &Value, me: &'a Owner, players: &'a [SeenPlayer]) -> Frame<'a> {
    Frame {
        epoch: Epoch(1),
        viewer: me.id,
        now: num(&p["now"]),
        view_time: num(&p["viewT"]),
        owner: Some(me),
        players,
        in_coliseum: p["hud"]["inColiseum"].as_bool().unwrap(),
        sudden_death_at: num(&p["hud"]["suddenDeathAt"]),
    }
}
fn paths(f: &Value, name: &str) -> RoomPathService {
    let m = &f["maps"][name];
    RoomPathService::new(
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
    )
}
fn begin(paths: &mut RoomPathService, p: &Value) {
    paths.budget_mut().start_tick();
    paths.set_frame(num(&p["now"]), p["hud"]["gatesLocked"].as_bool().unwrap());
}
fn tier(v: &Value) -> &'static TierParams {
    TierParams::by_id(TierId::parse(v.as_str().unwrap()).unwrap())
}
fn persona(v: &Value) -> &'static PersonaParams {
    PersonaParams::by_id(PersonaId::parse(v.as_str().unwrap()).unwrap())
}
fn stimulus(s: &Stimulus) -> Value {
    let mut v = json!({"kind":s.kind.as_str(),"at":s.at,"subject":s.subject.as_ref().map(|s|source_key(s)),"central":s.central});
    if let Some(value) = s.value {
        v["value"] = json!(value);
    }
    v
}
fn intent(i: &Intent) -> Value {
    let mut v = match &i.body {
        IntentBody::Move { to } => json!({"kind":"move","to":{"x":to.x,"y":to.y}}),
        IntentBody::Lock { target, at } => {
            json!({"kind":"lock","target":source_key(target),"at":{"x":at.x,"y":at.y}})
        }
        IntentBody::Swap { slot } => json!({"kind":"swap","slot":slot}),
        IntentBody::Stop {} => json!({"kind":"stop"}),
        _ => panic!("normal component produced an unrelated intent"),
    };
    v["priority"] = json!(i.priority);
    v["why"] = json!(i.why);
    v["timing"] = match &i.timing {
        IntentTiming::Step {} => json!({"kind":"step"}),
        IntentTiming::Timed { due } => json!({"kind":"timed","due":due}),
        IntentTiming::React { stimulus: s } => json!({"kind":"react","stimulus":stimulus(s)}),
    };
    v
}
fn output_value(o: &Output) -> Value {
    json!({"intents":o.intents.iter().map(intent).collect::<Vec<_>>(),"status":{"state":match o.status {GoalStatus::Running=>"running",GoalStatus::Failed=>"failed",GoalStatus::Done=>"done",GoalStatus::Blocked=>"blocked"},"why":o.why},"attacking":o.attacking})
}
fn compare(got: &Value, want: &Value, path: &str) {
    match (got, want) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (k, v) in a {
                compare(v, &b[k], &format!("{path}.{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}[{i}]"));
            }
        }
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if path.ends_with(".x") || path.ends_with(".y") {
                assert_eq!(
                    (a * 1e6).round(),
                    (b * 1e6).round(),
                    "coordinate {path}: {a} vs {b}"
                );
            } else {
                assert_eq!(a.to_bits(), b.to_bits(), "exact numeric {path}: {a} vs {b}");
            }
        }
        _ => assert_eq!(got, want, "{path}"),
    }
}
fn rng(row: &Value, name: &str, current: &Rng, seed: u32, tag: u32) {
    let v = &row["rngAfter"][name];
    let mut replay = Rng::new(derive(seed, tag));
    assert_eq!(
        v["count"].as_u64().unwrap() as usize,
        v["draws"].as_array().unwrap().len()
    );
    for d in v["draws"].as_array().unwrap() {
        assert_eq!(
            replay.next_f64().to_bits(),
            num(d).to_bits(),
            "{name} actual draw"
        );
    }
    assert_eq!(*current, replay, "{name} actual suffix consumption");
    assert_eq!(
        current.clone().next_f64().to_bits(),
        num(&v["nextFromIndependentReplay"]).to_bits(),
        "{name} next value"
    );
}
fn path_state(row: &Value, paths: &RoomPathService) {
    let s = paths.stats();
    assert_eq!(
        json!({"searches":s.searches,"hits":s.hits,"fallbacks":s.fallbacks}),
        row["pathStats"]
    );
    assert_eq!(
        u64::from(paths.budget().left()),
        row["budgetLeft"].as_u64().unwrap()
    );
}
#[test]
fn actual_source_tactics_all_sixteen_sequences_and_47_frames() {
    let f = fixture();
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    let mut count = 0;
    for case in cases {
        let r = &case["recipe"];
        let seed = r["seed"].as_u64().unwrap() as u32;
        let tier = tier(&r["tier"]);
        let persona = persona(&r["persona"]);
        let mut decide = Rng::new(derive(seed, 0));
        let motor = Rng::new(derive(seed, 1));
        let lapse = Rng::new(derive(seed, 2));
        let mut k = Rng::new(derive(seed, 3));
        let know = Knowledge::create(tier, &mut k);
        let mut paths = paths(&f, r["map"].as_str().unwrap());
        let mut tactics = NormalTactics::new(Epoch(1), player("p0"), tier.id);
        for row in case["rows"].as_array().unwrap() {
            count += 1;
            let p = &row["input"]["percept"];
            assert!(p["mobs"].as_array().unwrap().is_empty());
            assert_eq!(
                row["normalReflex"],
                json!({"result":null,"holdUntil":0,"decideDraws":0})
            );
            let me = owner(p);
            let players = seen(p);
            begin(&mut paths, p);
            let goal = &row["input"]["goal"];
            let goal = if goal["kind"] == "idle" {
                Goal::Idle
            } else {
                assert_eq!(goal["kind"], "fight");
                Goal::Fight(player(goal["target"].as_str().unwrap()))
            };
            let got = tactics
                .act(
                    frame(p, &me, &players),
                    goal,
                    Context {
                        tier,
                        persona,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide,
                    },
                )
                .unwrap();
            compare(
                &output_value(&got),
                &row["result"],
                case["name"].as_str().unwrap(),
            );
            assert_eq!(
                tactics.kite_cycles(),
                row["stats"]["kiteCycles"].as_u64().unwrap()
            );
            for name in ["dodges", "jukes", "retreats", "mobTargets"] {
                assert_eq!(row["stats"][name], 0, "source normal-branch boundary");
            }
            path_state(row, &paths);
            rng(row, "decide", &decide, seed, 0);
            rng(row, "motor", &motor, seed, 1);
            rng(row, "lapse", &lapse, seed, 2);
            rng(row, "knowledge", &k, seed, 3);
        }
    }
    assert_eq!(count, 47);
}
#[test]
fn actual_source_orb_all_six_sequences_and_20_frames() {
    let f = fixture();
    let mut count = 0;
    for case in f["orbs"].as_array().unwrap() {
        let r = &case["recipe"];
        let seed = r["seed"].as_u64().unwrap() as u32;
        let tier = tier(&r["tier"]);
        let mut decide = Rng::new(derive(seed, 0));
        let mut paths = paths(&f, r["map"].as_str().unwrap());
        let mut orb = OrbWalk::default();
        orb.reset(num(&r["reset"]));
        for row in case["rows"].as_array().unwrap() {
            count += 1;
            let input = &row["input"];
            let p = &input["percept"];
            let me = owner(p);
            begin(&mut paths, p);
            let got = orb.step(
                crate::bots::orbwalk::Context {
                    now: num(&p["now"]),
                    owner: &me,
                    tier,
                    paths: &paths,
                    decide: &mut decide,
                },
                player(input["foe"]["id"].as_str().unwrap()),
                point(&input["foe"]),
                BotWeapon::parse(input["weapon"].as_str().unwrap()).unwrap(),
                input["locked"].as_bool().unwrap(),
            );
            let v = match got {
                Step::Ordinary => Value::Null,
                Step::Wait => json!("wait"),
                Step::Order(i) => intent(&i),
            };
            compare(&v, &row["result"], case["name"].as_str().unwrap());
            assert_eq!(orb.cycles(), row["cycles"].as_u64().unwrap());
            rng(row, "decide", &decide, seed, 0);
        }
    }
    assert_eq!(count, 20);
}
#[test]
fn actual_source_direct_exported_fight_uses_no_tactics_knowledge_draw() {
    let f = fixture();
    let c = &f["directFight"];
    let p = &c["input"];
    let me = owner(p);
    let players = seen(p);
    let tier = TierParams::by_id(TierId::Normal);
    let persona = PersonaParams::by_id(PersonaId::Cautious);
    let mut memory = Memory::new(Epoch(1), me.id, tier.id, MAX_RECORDS).unwrap();
    let sights: Vec<_> = players
        .iter()
        .map(|f| PlayerSight {
            id: f.id,
            at: f.at,
            faction: f.faction,
            in_hand: f.weapon.map(weapon_id),
            hp_share: f.hp_frac,
            bounty: f.bounty,
            status: f.status,
            hidden: false,
        })
        .collect();
    memory
        .observe_scene(Scene {
            epoch: Epoch(1),
            viewer: me.id,
            now: num(&p["now"]),
            owner: Some(OwnerSight {
                at: me.at,
                status: me.status,
            }),
            players: &sights,
        })
        .unwrap();
    let mut paths = paths(&f, "open");
    begin(&mut paths, p);
    let know = Knowledge::create(tier, &mut Rng::new(derive(7, 3)));
    let mut decide = Rng::new(derive(7, 0));
    let got = Fight::default().act(
        FightInput {
            frame: &frame(p, &me, &players),
            me: &me,
            target: Some(player("p1")),
            id: player("p1"),
            memory: &memory,
            stimuli: memory.stimuli(),
            still_since: memory.own_motion().unwrap().still_since,
        },
        Context {
            tier,
            persona,
            know: &know,
            paths: &mut paths,
            decide: &mut decide,
        },
    );
    compare(&output_value(&got), &c["result"], "direct exported Fight");
    rng(c, "decide", &decide, 7, 0);
}
#[test]
fn unavailable_facts_and_epoch_refuse_before_memory_or_rng_then_reset_drops_identity() {
    let f = fixture();
    let p = &f["cases"][0]["rows"][0]["input"]["percept"];
    let mut me = owner(p);
    let players = seen(p);
    let tier = TierParams::by_id(TierId::Normal);
    let persona = PersonaParams::by_id(PersonaId::Cautious);
    let know = Knowledge::create(tier, &mut Rng::new(derive(7, 3)));
    let mut decide = Rng::new(derive(7, 0));
    let mut paths = paths(&f, "open");
    let mut tactics = NormalTactics::new(Epoch(1), me.id, tier.id);
    let initial = (
        tactics.memory.clone(),
        tactics.fight.clone(),
        tactics.knows_sudden_death,
        decide.clone(),
    );
    me.inventory = None;
    assert_eq!(
        tactics.act(
            frame(p, &me, &players),
            Goal::Fight(player("p1")),
            Context {
                tier,
                persona,
                know: &know,
                paths: &mut paths,
                decide: &mut decide
            }
        ),
        Err(Refusal::InventoryUnavailable)
    );
    assert_eq!(
        (
            tactics.memory.clone(),
            tactics.fight.clone(),
            tactics.knows_sudden_death,
            decide.clone()
        ),
        initial
    );
    me = owner(p);
    me.lock = Some(Lock::Held { target: None });
    assert_eq!(
        tactics.act(
            frame(p, &me, &players),
            Goal::Fight(player("p1")),
            Context {
                tier,
                persona,
                know: &know,
                paths: &mut paths,
                decide: &mut decide
            }
        ),
        Err(Refusal::LockUnavailable)
    );
    assert_eq!(
        (
            tactics.memory.clone(),
            tactics.fight.clone(),
            tactics.knows_sudden_death,
            decide.clone()
        ),
        initial
    );
    me = owner(p);
    let mut wrong = frame(p, &me, &players);
    wrong.epoch = Epoch(2);
    assert_eq!(
        tactics.act(
            wrong,
            Goal::Fight(player("p1")),
            Context {
                tier,
                persona,
                know: &know,
                paths: &mut paths,
                decide: &mut decide
            }
        ),
        Err(Refusal::Memory)
    );
    assert_eq!(
        (
            tactics.memory.clone(),
            tactics.fight.clone(),
            tactics.knows_sudden_death,
            decide.clone()
        ),
        initial
    );
    tactics
        .act(
            frame(p, &me, &players),
            Goal::Fight(player("p1")),
            Context {
                tier,
                persona,
                know: &know,
                paths: &mut paths,
                decide: &mut decide,
            },
        )
        .unwrap();
    assert!(!tactics.memory.records().is_empty());
    let occupied = (
        tactics.memory.clone(),
        tactics.fight.clone(),
        tactics.knows_sudden_death,
        decide.clone(),
    );
    assert_eq!(
        tactics.act(
            frame(p, &me, &players),
            Goal::Fight(player("p1")),
            Context {
                tier,
                persona,
                know: &know,
                paths: &mut paths,
                decide: &mut decide
            }
        ),
        Err(Refusal::Memory)
    );
    assert_eq!(
        (
            tactics.memory.clone(),
            tactics.fight.clone(),
            tactics.knows_sudden_death,
            decide.clone()
        ),
        occupied
    );
    tactics.reset(Epoch(2), player("p0"), tier.id);
    assert!(tactics.memory.records().is_empty());
    assert_eq!(tactics.fight, Fight::default());
    assert_eq!(tactics.knows_sudden_death, None);
}

#[test]
fn reset_after_source_orb_cycle_drops_engagement_beliefs_lock_and_timers_without_draws() {
    let f = fixture();
    let case = f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "fight-orb-engagement-chance-jitter-and-gap")
        .unwrap();
    let tier = TierParams::by_id(TierId::Hard);
    let persona = PersonaParams::by_id(PersonaId::Cautious);
    let mut decide = Rng::new(derive(0, 0));
    let know = Knowledge::create(tier, &mut Rng::new(derive(0, 3)));
    let mut paths = paths(&f, "open");
    let mut tactics = NormalTactics::new(Epoch(1), player("p0"), tier.id);
    for row in case["rows"].as_array().unwrap().iter().take(6) {
        let p = &row["input"]["percept"];
        let me = owner(p);
        let players = seen(p);
        begin(&mut paths, p);
        let got = tactics
            .act(
                frame(p, &me, &players),
                Goal::Fight(player("p1")),
                Context {
                    tier,
                    persona,
                    know: &know,
                    paths: &mut paths,
                    decide: &mut decide,
                },
            )
            .unwrap();
        compare(
            &output_value(&got),
            &row["result"],
            "earned component engagement before reset",
        );
    }
    assert_eq!(tactics.kite_cycles(), 1);
    assert_ne!(tactics.fight, Fight::default());
    assert!(!tactics.memory.records().is_empty());
    assert!(tactics.knows_sudden_death.is_some());
    assert_eq!(tactics.previous_target, Some(player("p1")));
    let unchanged = decide.clone();
    tactics.reset(Epoch(2), player("p0"), TierId::Normal);
    assert_eq!(decide, unchanged);
    assert_eq!(tactics.fight, Fight::default());
    assert!(tactics.memory.records().is_empty());
    assert_eq!(tactics.knows_sudden_death, None);
    assert_eq!(tactics.previous_target, None);
    assert_eq!(tactics.dropped, None);
    assert_eq!(tactics.previous_coliseum, None);
}

#[test]
fn missing_owner_lock_bad_slot_clock_duplicate_rows_and_sd_are_atomic_refusals() {
    let f = fixture();
    let p = &f["cases"][1]["rows"][0]["input"]["percept"];
    let tier = TierParams::by_id(TierId::Normal);
    let persona = PersonaParams::by_id(PersonaId::Cautious);
    let know = Knowledge::create(tier, &mut Rng::new(derive(7, 3)));
    for bad in 0..7 {
        let mut me = owner(p);
        let mut players = seen(p);
        let mut tactics = NormalTactics::new(Epoch(1), me.id, tier.id);
        let mut decide = Rng::new(derive(7, 0));
        let mut paths = paths(&f, "open");
        if bad == 1 {
            me.lock = None;
        }
        if bad == 2 {
            me.slot = 2;
        }
        if bad == 3 {
            me.ready_at = f64::NAN;
        }
        if bad == 4 {
            players.push(players[0].clone());
        }
        let mut input = frame(p, &me, &players);
        if bad == 0 {
            input.owner = None;
        }
        if bad == 5 {
            input.sudden_death_at = 100.;
        }
        let selected_tier = if bad == 6 {
            TierParams::by_id(TierId::Hard)
        } else {
            tier
        };
        let original = (
            tactics.memory.clone(),
            tactics.fight.clone(),
            decide.clone(),
        );
        let expected = match bad {
            0 => Refusal::OwnerUnavailable,
            1 => Refusal::LockUnavailable,
            4 => Refusal::Memory,
            5 => Refusal::UnsupportedSuddenDeath,
            _ => Refusal::InvalidFacts,
        };
        assert_eq!(
            tactics.act(
                input,
                Goal::Fight(player("p1")),
                Context {
                    tier: selected_tier,
                    persona,
                    know: &know,
                    paths: &mut paths,
                    decide: &mut decide
                }
            ),
            Err(expected)
        );
        assert_eq!(
            (
                tactics.memory.clone(),
                tactics.fight.clone(),
                decide.clone()
            ),
            original
        );
        assert_eq!(tactics.knows_sudden_death, None);
        assert_eq!(tactics.previous_target, None);
        assert_eq!(tactics.dropped, None);
        assert_eq!(tactics.previous_coliseum, None);
    }
}
