use super::*;
use crate::{
    validate as command, Arena, Event, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value as V};

fn corpus() -> V {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/evidence/slow-starter-assessment/source.json"
    )))
    .unwrap()
}
fn n(v: &V) -> f64 {
    v.as_f64().unwrap()
}
fn id(v: &V) -> PlayerId {
    PlayerId(
        v.as_str()
            .unwrap()
            .strip_prefix('p')
            .unwrap()
            .parse::<u32>()
            .unwrap()
            + 1,
    )
}
fn label(s: &Sim, id: PlayerId) -> String {
    if s.w.players.get(id).is_some() {
        format!("p{}", id.0 - 1)
    } else {
        match s.w.actor_origin(id).unwrap() {
            crate::mob_runtime::ActorOrigin::Dummy { birth_serial, .. } => {
                format!("mob{birth_serial}")
            }
            other => panic!("unadmitted fixture actor: {other:?}"),
        }
    }
}
fn arena(i: &V) -> Arena {
    let (w, h) = (40, 24);
    let mut tiles = vec![0; w * h];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x + 1 == w || y + 1 == h {
                tiles[y * w + x] = 1;
            }
        }
    }
    Arena {
        map: crate::TileMap::new(w as u32, h as u32, tiles).unwrap(),
        spawns: i["room"]["spawns"].as_array().map_or_else(
            || {
                [
                    (112., 112.),
                    (400., 112.),
                    (800., 112.),
                    (112., 624.),
                    (800., 624.),
                ]
                .into_iter()
                .map(|(x, y)| Vec2::new(x, y))
                .collect()
            },
            |a| {
                a.iter()
                    .map(|p| Vec2::new(n(&p["x"]), n(&p["y"])))
                    .collect()
            },
        ),
    }
}
fn construct(i: &V) -> Sim {
    construct_in(i, crate::abilities::Mode::Full, None)
}
fn construct_in(i: &V, mode: crate::abilities::Mode, epoch: Option<f64>) -> Sim {
    let training = i["profile"] == "training";
    let config = SimConfig {
        abilities: mode,
        wish_lock_ms: 0.,
        min_players: i["players"].as_array().unwrap().len(),
        fill_seconds: 0.,
        initial_loot: true,
        // The source card-runtime profile installs live traders; their real spawn/walk uses reward draws.
        quests: !training && epoch.is_none(),
        pvp_rules: false,
        training,
        dummies: i["config"]["dummies"] == true,
        faction_mode: if training {
            crate::FactionMode::EngagementHolyPlagueFireFrostSentenced
        } else {
            crate::FactionMode::Off
        },
        lifecycle: if training || epoch.is_some() {
            crate::ArenaMode::Off
        } else {
            crate::ArenaMode::Source(crate::ArenaRules {
                plan_seconds: 0.,
                first_patience_seconds: None,
                coliseum_schedule: None,
                patience_seconds: i["config"]["patienceSeconds"].as_f64().unwrap_or(3600.),
                patience_min_seconds: i["config"]["patienceMinSeconds"].as_f64().unwrap_or(3600.),
                sudden_death_seconds: 60.,
            })
        },
        ..Default::default()
    };
    let seed = i["mainSeed"].as_u64().unwrap() as u32;
    let mut random = crate::rng::Mulberry32::new(seed);
    let secrets = Secrets {
        order_salt: random.next_u32(),
        spawn_seed: seed,
        reward_salt: serde_json::from_value(i["rewardSalt"].clone()).unwrap(),
    };
    let mut s = Sim::try_new(config, arena(i), secrets).expect("actual declared constructor");
    if let Some(epoch) = epoch {
        // An explicitly declared native Baseline epoch, before joins/inputs/clock production.
        s.w.server_time = epoch;
        s = Sim::restore(serde_json::to_value(&s).unwrap())
            .expect("existing fractional epoch domain");
    }
    for (j, p) in i["players"].as_array().unwrap().iter().enumerate() {
        assert_eq!(
            s.add_player(
                &format!("name{j}"),
                Some(crate::FactionId::parse(p["faction"].as_str().unwrap()).unwrap()),
                false
            ),
            Some(PlayerId(j as u32 + 1))
        );
    }
    s.step();
    // Same declared player-only bootstrap as the source harness. No expected frame is installed.
    for (j, p) in i["players"].as_array().unwrap().iter().enumerate() {
        let player = &mut s.w.players[j];
        let at = Vec2::new(n(&p["at"]["x"]), n(&p["at"]["y"]));
        player.body.x = at.x;
        player.body.y = at.y;
        player.body.history.reset(crate::state::Sample {
            t: s.w.server_time,
            x: at.x,
            y: at.y,
        });
        player.motion.slip = None;
        if let Some(w) = p["weapon"].as_str() {
            player.weapon.weapon0 = crate::WeaponId::parse(w);
        }
        for c in p["cards"].as_array().into_iter().flatten() {
            assert!(crate::cards::grant(
                &s.k,
                &mut s.w,
                PlayerId(j as u32 + 1),
                serde_json::from_value(c.clone()).unwrap()
            ));
        }
    }
    s
}
fn enqueue(s: &mut Sim, i: &V) {
    let p = &i["payload"];
    let raw = match i["type"].as_str().unwrap() {
        "attack" => RawCommand::Attack {
            a: n(&p["a"]),
            t: None,
        },
        "release" => RawCommand::Release {
            a: n(&p["a"]),
            t: None,
        },
        "train" => RawCommand::Train(crate::input::TrainRaw {
            command: if p["cmd"] == "clear" {
                5
            } else {
                assert_eq!(p["cmd"], "card");
                1
            },
            id: p["id"].as_str().map_or(0, |c| {
                serde_json::from_value::<crate::cards::CardId>(json!(c))
                    .unwrap()
                    .index() as u32
            }),
            count: p["count"].as_u64().unwrap_or(0),
            options: [0; 3],
            option_count: 0,
        }),
        _ => panic!("closed source input"),
    };
    s.submit(id(&i["actor"]), command(raw).unwrap())
        .expect("ordinary validate + budgeted submit");
}
fn near(actual: f64, expected: f64, why: &str) {
    assert!(
        (actual - expected).abs() <= 2e-6,
        "{why}: {actual} != {expected}"
    );
}
fn compare_events(s: &Sim, actual: &[Event], expected: &V) {
    let actual: Vec<_> = actual
        .iter()
        .filter_map(|e| {
            Some(match e {
                Event::Windup { by, .. } => ("windup", Some(label(s, *by))),
                Event::Swing { by, .. } => ("swing", Some(label(s, *by))),
                Event::Hit { victim, .. } => ("hit", Some(label(s, *victim))),
                Event::Death { id, .. } => ("death", Some(label(s, *id))),
                Event::Gv { id, .. } => ("gv", Some(label(s, *id))),
                Event::Resolved { id, .. } => ("resolved", Some(label(s, *id))),
                Event::Teleported => ("teleport", None),
                Event::Toast { to, .. } => ("toast", to.map(|id| label(s, id))),
                _ => return None,
            })
        })
        .collect();
    let expected: Vec<_> = expected
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| {
            let k = if e["type"] == "fx" {
                e["fx"]["kind"].as_str().unwrap()
            } else {
                e["type"].as_str().unwrap()
            };
            let v = if e["type"] == "fx" { &e["fx"] } else { e };
            let actor = match k {
                "windup" | "swing" => v["by"].as_str(),
                "hit" | "death" | "gv" | "resolved" => v["id"].as_str(),
                "toast" => v["to"].as_str(),
                "teleport" => None,
                _ => return None,
            };
            Some((k, actor.map(str::to_owned)))
        })
        .collect();
    assert_eq!(
        actual,
        expected,
        "combat/lifecycle event order at {}",
        s.server_time()
    );
}
fn compare(s: &Sim, f: &V, tape: &V) {
    assert_eq!(s.w.server_time, n(&f["time"]), "{}", f["label"]);
    assert_eq!(s.w.tick as u64, f["tick"].as_u64().unwrap());
    assert_eq!(s.w.rt.in_coliseum, f["inColiseum"].as_bool().unwrap());
    let watch: Vec<_> =
        s.w.players
            .iter()
            .filter(|p| watches(p))
            .map(|p| label(s, p.id))
            .collect();
    let expected_watch = f["fightWatch"].as_array().map_or_else(Vec::new, |a| {
        a.iter().map(|v| v.as_str().unwrap().to_owned()).collect()
    });
    assert_eq!(watch, expected_watch, "watch {}", f["label"]);
    let expected_clocks: Vec<(String, FightClock)> =
        f["fightClocks"].as_array().map_or_else(Vec::new, |v| {
            serde_json::from_value(V::Array(v.clone())).unwrap()
        });
    let actual_clocks: Vec<_> =
        s.w.players
            .iter()
            .filter_map(|p| {
                p.card_runtime
                    .and_then(|r| r.fight)
                    .map(|c| (label(s, p.id), c))
            })
            .collect();
    assert_eq!(
        actual_clocks,
        expected_clocks,
        "clock {} at {}",
        f["label"],
        s.server_time()
    );
    for expected in f["cache"].as_array().unwrap() {
        let p = s.w.players.get(id(&expected["id"])).unwrap();
        let cache = serde_json::to_value(&p.modifiers).unwrap();
        if expected.get("holds").is_some() {
            assert_eq!(
                cache["holds"],
                expected["holds"],
                "holds at {}",
                s.server_time()
            );
            near(
                n(&cache["sums"][3]),
                n(&expected["damageSum"]),
                "cached damage",
            );
        }
    }
    for expected in f["players"].as_array().unwrap() {
        let p = s.w.players.get(id(&expected["id"])).unwrap();
        near(p.vitals.hp, n(&expected["hp"]), "player hp");
        near(p.vitals.max_hp, n(&expected["maxHp"]), "player maxhp");
        near(p.body.x, n(&expected["x"]), "player x");
        near(p.body.y, n(&expected["y"]), "player y");
        assert_eq!(
            match p.status {
                crate::Status::Lobby => "lobby",
                crate::Status::Alive => "alive",
                crate::Status::Dead => "dead",
                crate::Status::Mia => "mia",
            },
            expected["status"].as_str().unwrap()
        );
    }
    assert_eq!(s.w.mobs.len(), f["mobs"].as_array().unwrap().len());
    for expected in f["mobs"].as_array().unwrap() {
        let m =
            s.w.mobs
                .iter()
                .find(|m| label(s, m.core.id) == expected["id"].as_str().unwrap())
                .unwrap();
        assert_eq!(m.kind, crate::mob_runtime::MobKind::Dummy);
        near(m.core.vitals.hp, n(&expected["hp"]), "born NPC hp");
        near(
            m.core.vitals.max_hp,
            n(&expected["maxHp"]),
            "born NPC maxhp",
        );
        near(m.core.body.x, n(&expected["x"]), "born NPC x");
        near(m.core.body.y, n(&expected["y"]), "born NPC y");
    }
    assert_eq!(
        s.s.landed.len(),
        f["landed"].as_array().unwrap().len(),
        "landed count at {}",
        s.server_time()
    );
    for (actual, expected) in s.s.landed.iter().zip(f["landed"].as_array().unwrap()) {
        assert_eq!(
            label(s, actual.victim),
            expected["victim"].as_str().unwrap()
        );
        assert_eq!(
            actual.by.map(|p| label(s, p)),
            expected["by"].as_str().map(str::to_owned)
        );
        near(
            actual.amount,
            n(&expected["amount"]),
            "actual landed damage",
        );
    }
    // Exact current stream state after every source offset, rather than just matching final totals.
    let mut main = crate::rng::Mulberry32::new(s.k.secrets.spawn_seed);
    let mut reward = crate::private_rng::Sfc32::from_words(s.k.secrets.reward_salt);
    for draw in tape
        .as_array()
        .unwrap()
        .iter()
        .take(f["rng"]["total"].as_u64().unwrap() as usize)
    {
        let value = match draw["stream"].as_str().unwrap() {
            "main" => main.next_f64(),
            "reward" => reward.next_f64(),
            _ => panic!("no quest draws in closed source cases"),
        };
        assert_eq!(value, n(&draw["value"]), "source random value");
    }
    assert_eq!(
        main,
        s.w.spawn_rng,
        "intermediate main at {}",
        s.server_time()
    );
    assert_eq!(
        reward,
        s.w.reward_rng,
        "intermediate reward at {}",
        s.server_time()
    );
}
fn run_case(c: &V) -> Sim {
    let mut s = construct(&c["input"]);
    let frames = c["frames"].as_array().unwrap();
    let get = |label: &str| {
        frames
            .iter()
            .find(|f| f["label"] == label)
            .expect("source frame")
    };
    compare(&s, get("declared-player-bootstrap"), &c["randomTape"]);
    continuation(&s); // A watched row without a clock is a valid produced checkpoint too.
    for (ai, a) in c["input"]["actions"].as_array().unwrap().iter().enumerate() {
        match a["kind"].as_str().unwrap() {
            "step" => {
                for i in a["inputs"].as_array().unwrap() {
                    enqueue(&mut s, i);
                }
                let ev = s.step();
                let expected = get(&format!("action-{ai}"));
                compare(&s, expected, &c["randomTape"]);
                compare_events(&s, &ev, &expected["events"]);
                if [100., 3100., 3600., 4050., 7050., 7100., 12850., 15850.]
                    .contains(&s.server_time())
                {
                    continuation(&s);
                }
            }
            "span" => {
                for j in 1..=a["count"].as_u64().unwrap() {
                    let ev = s.step();
                    let expected = get(&format!("action-{ai}-step-{j}"));
                    compare(&s, expected, &c["randomTape"]);
                    compare_events(&s, &ev, &expected["events"]);
                    if [3100., 3600., 4050., 7050., 7100., 12850., 15850.]
                        .contains(&s.server_time())
                    {
                        continuation(&s);
                    }
                }
            }
            "grant" => {
                for card in a["cards"].as_array().unwrap() {
                    assert!(crate::cards::grant(
                        &s.k,
                        &mut s.w,
                        id(&a["actor"]),
                        serde_json::from_value(card.clone()).unwrap()
                    ));
                }
                compare(&s, get(&format!("action-{ai}")), &c["randomTape"]);
            }
            _ => panic!("closed source setup/actions only"),
        }
    }
    compare(&s, get("final"), &c["randomTape"]);
    s
}

#[test]
fn seven_actual_source_clock_witnesses() {
    let data = corpus();
    for case in data["cases"].as_array().unwrap() {
        println!("source {}", case["name"]);
        run_case(case);
    }
}

fn continuation(s: &Sim) {
    let mut cloned = s.clone();
    let mut restored =
        Sim::restore(serde_json::to_value(s).unwrap()).expect("produced clock checkpoint");
    assert_eq!(s.state_hash(), restored.state_hash());
    for j in 0..65 {
        if j == 0 || j == 58 {
            let cmd = if j == 0 {
                RawCommand::Release { a: 0., t: None }
            } else {
                RawCommand::Attack { a: 0., t: None }
            };
            let input = crate::replay::ReplayInput::Command {
                player: PlayerId(1),
                cmd: command(cmd).unwrap(),
            };
            let input: crate::replay::ReplayInput =
                serde_json::from_value(serde_json::to_value(input).unwrap()).unwrap();
            crate::replay::apply_input(&mut cloned, &input);
            crate::replay::apply_input(&mut restored, &input);
        }
        assert_eq!(
            cloned.step(),
            restored.step(),
            "checkpoint replay-fragment events"
        );
        assert_eq!(
            cloned.state_hash(),
            restored.state_hash(),
            "checkpoint replay-fragment hash"
        );
        if j % 13 == 0 {
            restored = Sim::restore(serde_json::to_value(&restored).unwrap())
                .expect("continued produced history and clock");
        }
    }
}

fn started(mode: crate::abilities::Mode, epoch: Option<f64>) -> Sim {
    let data = corpus();
    let mut s = construct_in(&data["cases"][0]["input"], mode, epoch);
    s.submit(
        PlayerId(1),
        command(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s.w.players[0].card_runtime.unwrap().fight.is_some());
    s
}

#[test]
fn fight_only_off_and_full_restore() {
    for mode in [crate::abilities::Mode::Off, crate::abilities::Mode::Full] {
        let s = started(mode, None);
        assert!(s.w.players[0].card_runtime.unwrap().wish_cast.is_none());
        continuation(&s);
    }
}

#[test]
fn produced_fractional_clocks_and_histories_restore_without_poststate_repair() {
    for epoch in [0.1, 1. / 3., 100_000.1, 100_000. + 1. / 3.] {
        let s = started(crate::abilities::Mode::Off, Some(epoch));
        let clock = s.w.players[0].card_runtime.unwrap().fight.unwrap();
        assert_eq!(clock.start, s.server_time());
        assert_ne!(clock.start % 50., 0.);
        super::validate(&s.k, &s.w, &s.w.players[0]).unwrap();
        let owner = s.w.players[0].card_runtime.unwrap();
        let back: crate::cards::runtime::Runtime =
            serde_json::from_value(serde_json::to_value(owner).unwrap()).unwrap();
        assert_eq!(owner, back);
        continuation(&s);
    }
}

#[test]
fn fractional_history_next_add_accepts_producer_and_refuses_nearer_reversed_dense_future() {
    let s = started(crate::abilities::Mode::Off, Some(0.1));
    let samples = s.w.players[0].body.history.as_slice();
    let a = samples[0].t;
    let b = samples[1].t;
    assert_eq!(a.to_bits(), 0x40490ccccccccccd);
    assert_eq!(b.to_bits(), 0x4059066666666666);
    assert!(
        b - a < crate::constants::TICK_MS,
        "original subtract predicate falsely refused this producer"
    );
    assert_eq!(a + crate::constants::TICK_MS, b);
    let good = serde_json::to_value(&s).unwrap();
    Sim::restore(good.clone()).unwrap();
    for (name, first, second, reason) in [
        (
            "one-ULP-nearer",
            a,
            f64::from_bits(b.to_bits() - 1),
            "not in time order, a tick apart",
        ),
        ("reversed", b, a, "not in time order, a tick apart"),
        ("dense", a, a + 25., "not in time order, a tick apart"),
        ("future", a, b + 50., "after server_time"),
    ] {
        let mut bad = good.clone();
        bad["world"]["players"][0]["core"]["body"]["history"][0]["t"] = json!(first);
        bad["world"]["players"][0]["core"]["body"]["history"][1]["t"] = json!(second);
        let error = Sim::restore(bad).expect_err(name);
        assert!(format!("{error:?}").contains(reason), "{name}: {error:?}");
    }
}

#[test]
fn restore_refuses_invalid_clocks_empty_owners_and_missing_fields() {
    let s = started(crate::abilities::Mode::Off, None);
    let good = serde_json::to_value(&s).unwrap();
    for (path, value) in [
        ("/world/players/0/card_runtime/fight/start", json!(-1.)),
        ("/world/players/0/card_runtime/fight/start", json!(101.)),
        ("/world/players/0/card_runtime/fight/last", json!(99.)),
        ("/world/players/0/card_runtime/fight/last", json!(150.)),
        ("/world/players/0/card_runtime/fight/last", json!(99.5)),
        ("/world/players/0/card_runtime/fight", V::Null),
    ] {
        let mut bad = good.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(Sim::restore(bad).is_err(), "invalid clock {path}");
    }
    for field in ["fight", "wish_cast"] {
        let mut bad = good.clone();
        bad["world"]["players"][0]["card_runtime"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(Sim::restore(bad).is_err(), "required runtime field {field}");
    }
    let mut bad = s.clone();
    bad.w.players[0].build = Default::default();
    assert_eq!(
        super::validate(&bad.k, &bad.w, &bad.w.players[0]).unwrap_err(),
        "invalid watched card fight clock"
    );
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        bad = s.clone();
        bad.w.players[0]
            .card_runtime
            .as_mut()
            .unwrap()
            .fight
            .as_mut()
            .unwrap()
            .last = number;
        assert!(super::validate(&bad.k, &bad.w, &bad.w.players[0]).is_err());
    }
    let mut later = s.clone();
    for _ in 0..10 {
        later.step();
    }
    for (key, value) in [("start", 50.), ("last", 550.)] {
        let mut changed = serde_json::to_value(&later).unwrap();
        changed["world"]["players"][0]["card_runtime"]["fight"][key] = json!(value);
        let changed = Sim::restore(changed).expect("different necessary-valid clock");
        assert_ne!(
            later.state_hash(),
            changed.state_hash(),
            "canonical fight leaf {key}"
        );
    }
}

#[test]
fn generic_card_reset_preserves_fight_and_row_loss_preserves_wish() {
    let mut s = started(crate::abilities::Mode::Full, None);
    let fight = s.w.players[0].card_runtime.unwrap().fight;
    // A real Wish through validate+submit, while the genuine fight is ongoing.
    s.submit(
        PlayerId(1),
        command(RawCommand::Cast {
            slot: crate::abilities::Slot::Wish,
            x: 332.,
            y: 320.,
            id: Some(PlayerId(2)),
            t: None,
            seq: None,
        })
        .unwrap(),
    )
    .unwrap();
    s.step();
    assert!(s.w.players[0].card_runtime.unwrap().wish_cast.is_some());
    continuation(&s);
    let good = serde_json::to_value(&s).unwrap();
    for (path, value) in [
        (
            "/world/players/0/card_runtime/wish_cast/cooldown_ms",
            json!(0.),
        ),
        ("/world/players/0/card_runtime/wish_cast/at", json!(99.)),
        ("/world/players/0/card_runtime/wish_cast", V::Null),
    ] {
        let mut bad = good.clone();
        *bad.pointer_mut(path).unwrap() = value;
        assert!(
            Sim::restore(bad).is_err(),
            "fight cannot excuse invalid Wish {path}"
        );
    }
    let mut off = started(crate::abilities::Mode::Off, None);
    off.w.players[0].card_runtime.as_mut().unwrap().wish_cast =
        s.w.players[0].card_runtime.unwrap().wish_cast;
    assert_eq!(
        crate::abilities::checkpoint::validate(&off.k, &off.w).unwrap_err(),
        "card Wish memory in Off mode"
    );
    off.w.players[0].card_runtime.as_mut().unwrap().wish_cast = None;
    off.w.players[0].stocks.q_ready_at = 1.;
    assert_eq!(
        crate::abilities::checkpoint::validate(&off.k, &off.w).unwrap_err(),
        "Wish stocks in Off mode"
    );
    // Explicit lifecycle-helper diagnostic, not an ordinary run restart claim.
    let mut reset = s.clone();
    crate::cards::runtime::reset_player(&mut reset.w.players[0]);
    assert_eq!(reset.w.players[0].card_runtime.unwrap().fight, fight);
    assert!(reset.w.players[0].card_runtime.unwrap().wish_cast.is_none());
    let wish = s.w.players[0].card_runtime.unwrap().wish_cast;
    s.w.players[0]
        .build
        .set(crate::cards::CardId::SlowStarter, 0);
    crate::modifiers::recompute(&s.k, &mut s.w, crate::fighter::FighterIx::of_slot(0));
    assert_eq!(s.w.players[0].card_runtime.unwrap().wish_cast, wish);
    assert!(s.w.players[0].card_runtime.unwrap().fight.is_none());
    continuation(&s);
    let mut fight_only = started(crate::abilities::Mode::Off, None);
    fight_only.w.players[0]
        .build
        .set(crate::cards::CardId::SlowStarter, 0);
    crate::modifiers::recompute(
        &fight_only.k,
        &mut fight_only.w,
        crate::fighter::FighterIx::of_slot(0),
    );
    assert!(fight_only.w.players[0].card_runtime.is_none());
}

#[test]
#[ignore = "dhat must run alone: cargo test -p rh-sim --lib slow_starter_warm_alloc -- --ignored --test-threads=1"]
fn slow_starter_warm_alloc() {
    let data = corpus();
    let input = &data["cases"][4]["input"];
    let mut s = construct(input);
    assert!(crate::cards::grant(
        &s.k,
        &mut s.w,
        PlayerId(1),
        crate::cards::CardId::SlowStarter
    ));
    s.submit(
        PlayerId(1),
        command(RawCommand::Attack { a: 0., t: None }).unwrap(),
    )
    .unwrap();
    let mut ev = Vec::new();
    for _ in 0..90 {
        ev.clear();
        s.step_into(&mut ev);
    }
    for phase in ["original", "clone", "restore"] {
        s = match phase {
            "clone" => s.clone(),
            "restore" => Sim::restore(serde_json::to_value(&s).unwrap()).unwrap(),
            _ => s,
        };
        // Restore has new scratch; warm that actual path before measuring.
        for _ in 0..30 {
            ev.clear();
            s.step_into(&mut ev);
        }
        assert!(super::holds(
            s.w.players[0].card_runtime.unwrap().fight,
            s.server_time(),
            3.
        ));
        let _profiler = dhat::Profiler::builder()
            .testing()
            .file_name(std::env::temp_dir().join(format!("rh-slow-starter-{phase}.json")))
            .build();
        for _ in 0..60 {
            ev.clear();
            #[cfg(feature = "schedule-trace")]
            s.clear_schedule_trace();
            let before = dhat::HeapStats::get().total_blocks;
            s.step_into(&mut ev);
            let after = dhat::HeapStats::get().total_blocks;
            dhat::assert_eq!(after, before);
        }
    }
}
