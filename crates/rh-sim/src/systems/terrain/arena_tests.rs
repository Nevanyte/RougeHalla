#![cfg(test)]
//! The actual source arena-lock/teleport continuation through the real native lifecycle producers.
//!
//! "parity/terrain/arena-source.json" is a declared trusted setup plus ordered actual source calls: the ordinary source
//! constructor, the real lobby close, the real scheduled coliseum teleport, real scheduled-step locked ticks, a real
//! between-tick departure that reopens the gates, the 1500ms teleport immunity window, and ordinary ticks after it.
//! This consumer executes only the ported lifecycle and compares every declared frame; it is not full-world parity.
use super::source_tests::{close, compare, n, point};
use crate::{
    state::World, Arena, Event, FactionId, PlayerId, Secrets, Sim, SimConfig, TileMap, Vec2,
};
use serde_json::{json, Value};
fn label(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}
fn player_id(name: &str) -> PlayerId {
    PlayerId(name[1..].parse::<u32>().unwrap() + 1)
}
fn corpus() -> Value {
    let bytes = include_bytes!("../../../../../parity/terrain/arena-source.json");
    let v: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(v["format"], "rh-terrain-arena-source/1");
    v
}
fn faction(v: &Value) -> FactionId {
    match v.as_str().unwrap() {
        "fire" => FactionId::Fire,
        "plague" => FactionId::Plague,
        "frost" => FactionId::Frost,
        "holy" => FactionId::Holy,
        "sentenced" => FactionId::Sentenced,
        other => panic!("{other}"),
    }
}
fn arena(c: &Value) -> Arena {
    let mut map = c["constructorInputMap"].clone();
    let w = map["w"].as_u64().unwrap();
    for e in c["profile"]["overlay"].as_array().unwrap() {
        let i = (e["ty"].as_u64().unwrap() * w + e["tx"].as_u64().unwrap()) as usize;
        assert_eq!(map["tiles"][i], 0, "declared overlay tile is floor");
        assert_eq!(map["terrain"][i], 0, "declared overlay replaces nothing");
        map["terrain"][i] = e["kind"].clone();
    }
    let data = serde_json::from_value(map).unwrap();
    let (w, h, tiles, layers) = crate::mapdata::MapExport {
        format: "rh-map/2".into(),
        legacy_map_hash_u32: 0,
        map: data,
    }
    .validate()
    .unwrap()
    .into_parts();
    let spawns = layers
        .data()
        .spawns
        .iter()
        .map(|p| Vec2::new(p.x, p.y))
        .collect();
    Arena {
        map: TileMap::new(w, h, tiles)
            .unwrap()
            .with_layers(layers)
            .unwrap(),
        spawns,
    }
}
fn config(c: &Value) -> SimConfig {
    let p = &c["profile"]["config"];
    let s = &p["coliseumSchedule"];
    let schedule = crate::ColiseumSchedule {
        first_seconds: n(s, "firstSeconds"),
        second_seconds: n(s, "secondSeconds"),
        repeat_seconds: n(s, "repeatSeconds"),
        min_gap_seconds: n(s, "minGapSeconds"),
    };
    SimConfig {
        min_players: p["minPlayers"].as_u64().unwrap() as usize,
        lobby_seconds: n(p, "lobbySeconds"),
        fill_seconds: n(p, "fillSeconds"),
        hazards: crate::terrain::Mode::Map,
        lifecycle: crate::ArenaMode::Source(crate::ArenaRules {
            plan_seconds: n(p, "planSeconds"),
            first_patience_seconds: None,
            coliseum_schedule: Some(schedule),
            patience_seconds: n(p, "patienceSeconds"),
            patience_min_seconds: n(p, "patienceMinSeconds"),
            sudden_death_seconds: n(p, "suddenDeathSeconds"),
        }),
        initial_loot: false,
        mob_mode: crate::mob_runtime::MobMode::Off,
        ..Default::default()
    }
}
/// The real constructor: declared map plus overlay, the real order-salt draw and the declared secrets.
fn construct(c: &Value) -> Sim {
    let mut secrets = Secrets::from_seed(1);
    secrets.spawn_seed = c["profile"]["mainSeed"].as_u64().unwrap() as u32;
    secrets.reward_salt =
        std::array::from_fn(|i| c["profile"]["rewardSalt"][i].as_u64().unwrap() as u32);
    let sim = Sim::new(config(c), arena(c), secrets);
    assert_eq!(
        sim.k.secrets.order_salt as u64,
        c["orderSalt"].as_u64().unwrap(),
        "the real constructor order-salt draw"
    );
    sim
}
fn join(c: &Value, sim: &mut Sim) {
    for p in c["input"]["players"].as_array().unwrap() {
        sim.add_player(
            p["profile"].as_str().unwrap(),
            Some(faction(&p["faction"])),
            false,
        )
        .unwrap();
    }
}
fn rows(v: &[(PlayerId, f64)]) -> Value {
    json!(v
        .iter()
        .map(|(id, x)| json!([label(*id), x]))
        .collect::<Vec<_>>())
}
fn terrain_json(w: &World) -> Value {
    json!({
        "lightAcc": rows(&w.terrain.light_acc),
        "lightSince": w.terrain.light_since,
        "combatAt": rows(&w.terrain.combat_at),
    })
}
fn stats_json(w: &World) -> Value {
    json!({
        "damage": w.terrain.damage.iter().map(|(id, x)| json!([label(*id), {"ember": x}])).collect::<Vec<_>>(),
        "seconds": {
            "ember": w.terrain.seconds[0],
            "bog": w.terrain.seconds[1],
            "ice": w.terrain.seconds[2],
            "light": w.terrain.seconds[3],
        },
        "heal": rows(&w.terrain.heal),
    })
}
fn events(ev: &[Event]) -> Value {
    json!(ev
        .iter()
        .map(|e| match e {
            Event::RaidStarted => json!({"type":"raidStarted"}),
            Event::Teleported => json!({"type":"fx","fx":{"kind":"teleport"}}),
            Event::Heal { id, amount } => {
                json!({"type":"fx","fx":{"kind":"heal","id":label(*id),"amount":amount}})
            }
            Event::Resolved { id, result, .. } =>
                json!({"type":"resolved","id":label(*id),"result":{
                    "outcome": match result.outcome {
                        crate::results::Outcome::Won => "won",
                        crate::results::Outcome::Draw => "draw",
                        crate::results::Outcome::Died => "died",
                        crate::results::Outcome::Mia => "mia",
                    },
                    "profile": result.profile,
                    "durationSec": result.duration_sec,
                    "kills": result.kills,
                    "killedBy": result.killed_by,
                    "place": result.place,
                    "players": result.players,
                    "gv": {
                        "kills": result.gv.kills,
                        "mobs": result.gv.mobs,
                        "bounty": result.gv.bounty,
                        "quest": result.gv.quest,
                        "win": result.gv.win,
                        "total": result.gv.total,
                    },
                    "winBonusWithheld": result.win_bonus_withheld,
                }}),
            other => panic!("unconsumed arena-terrain event {other:?}"),
        })
        .collect::<Vec<_>>())
}
fn compare_frame(sim: &Sim, f: &Value, ctx: &str, ev: &[Event]) {
    let p = &f["public"];
    assert_eq!(
        format!("{:?}", sim.w.phase).to_lowercase(),
        p["phase"].as_str().unwrap(),
        "{ctx}/phase"
    );
    assert_eq!(sim.w.tick as u64, p["tick"].as_u64().unwrap(), "{ctx}/tick");
    close(
        sim.w.server_time,
        n(p, "serverTime"),
        &format!("{ctx}/serverTime"),
    );
    close(
        sim.w.raid_started_at,
        n(p, "raidStartedAt"),
        &format!("{ctx}/raidStartedAt"),
    );
    close(
        sim.w.rt.patience_ends_at.unwrap_or(0.),
        n(p, "patienceEndsAt"),
        &format!("{ctx}/patienceEndsAt"),
    );
    close(
        sim.w.rt.sudden_death_at,
        n(p, "suddenDeathAt"),
        &format!("{ctx}/suddenDeathAt"),
    );
    assert_eq!(
        sim.w.rt.in_coliseum,
        p["inColiseum"].as_bool().unwrap(),
        "{ctx}/inColiseum"
    );
    assert_eq!(
        sim.w.rt.gates_locked,
        p["gatesLocked"].as_bool().unwrap(),
        "{ctx}/gatesLocked"
    );
    assert_eq!(
        sim.w.rt.started_with as u64,
        p["startedWith"].as_u64().unwrap(),
        "{ctx}/startedWith"
    );
    let want = p["players"].as_array().unwrap();
    assert_eq!(sim.w.players.len(), want.len(), "{ctx}/players");
    for (i, w) in want.iter().enumerate() {
        let pl = &sim.w.players[i];
        let id = w["id"].as_str().unwrap();
        let st = &w["state"];
        assert_eq!(label(pl.id), id, "{ctx}/{id}");
        for (key, got) in [
            ("x", pl.body.x),
            ("y", pl.body.y),
            ("facing", pl.body.facing),
            ("hp", pl.vitals.hp),
            ("maxHp", pl.vitals.max_hp),
            ("barrier", pl.vitals.barrier),
            ("immuneUntil", pl.vitals.immune_until),
            ("kills", f64::from(pl.credit.kills)),
            ("bounty", f64::from(pl.credit.bounty)),
        ] {
            close(
                got,
                st[key].as_f64().unwrap_or(0.),
                &format!("{ctx}/{id}/{key}"),
            );
        }
        assert_eq!(
            format!("{:?}", pl.status).to_lowercase(),
            st["status"].as_str().unwrap(),
            "{ctx}/{id}/status"
        );
        assert_eq!(
            pl.vitals.faction.as_str(),
            st["faction"].as_str().unwrap(),
            "{ctx}/{id}/faction"
        );
        let rt = &w["private"];
        compare(
            &json!(pl.motion.path.as_slice()),
            &rt["path"],
            &format!("{ctx}/{id}/path"),
        );
        compare(
            &json!(pl.body.history.as_slice()),
            &rt["history"],
            &format!("{ctx}/{id}/history"),
        );
        assert_eq!(
            pl.motion.slip.is_some(),
            !rt["slip"].is_null(),
            "{ctx}/{id}/slip"
        );
        if let Some(s) = &pl.motion.slip {
            let expected = &rt["slip"];
            for (key, got) in [("vx", s.vx), ("vy", s.vy), ("ax", s.ax), ("ay", s.ay)] {
                close(got, n(expected, key), &format!("{ctx}/{id}/slip/{key}"));
            }
            let replan = s.replan_at.map_or(json!("-Infinity"), |x| json!(x));
            compare(
                &replan,
                &expected["replanAt"],
                &format!("{ctx}/{id}/slip/replanAt"),
            );
            for (key, got) in [
                ("stuckX", s.stuck_x),
                ("stuckY", s.stuck_y),
                ("stuckN", s.stuck_n),
                ("stuckBest", s.stuck_best),
                ("stuckAt", s.stuck_at),
                ("gripUntil", s.grip_until),
            ] {
                match got {
                    Some(x) => {
                        compare(&json!(x), &expected[key], &format!("{ctx}/{id}/slip/{key}"))
                    }
                    None => assert!(
                        expected.get(key).is_none(),
                        "{ctx}/{id}/slip/{key} is source-only"
                    ),
                }
            }
            assert_eq!(
                s.path == Some(pl.motion.path.generation),
                rt["slipPathIdentity"] == true,
                "{ctx}/{id}/slipPathIdentity"
            );
        }
        compare(
            &json!(pl.down.map(|d| format!("{d:?}").to_lowercase())),
            &rt["down"],
            &format!("{ctx}/{id}/down"),
        );
        assert_eq!(pl.resolved, rt["resolved"] == true, "{ctx}/{id}/resolved");
    }
    compare(
        &terrain_json(&sim.w),
        &f["private"]["terrain"],
        &format!("{ctx}/terrain"),
    );
    compare(
        &stats_json(&sim.w),
        &f["private"]["stats"],
        &format!("{ctx}/stats"),
    );
    assert!(
        f["private"]["ledger"].as_array().unwrap().is_empty(),
        "{ctx}/source ledger"
    );
    assert!(sim.s.ledger.is_empty(), "{ctx}/native ledger");
    assert!(
        f["private"]["landed"].as_array().unwrap().is_empty(),
        "{ctx}/source landed"
    );
    assert!(sim.s.landed.is_empty(), "{ctx}/native landed");
    compare(&events(ev), &f["events"], &format!("{ctx}/events"));
}
fn setup_player(sim: &mut Sim, a: &Value) {
    let id = player_id(a["actor"].as_str().unwrap());
    let i = sim.w.idx(id).expect("setupPlayer actor exists");
    let now = sim.w.server_time;
    let at = point(&a["at"]);
    let slide = if a["slide"].is_object() {
        Some(super::walk::new_slip(
            Vec2::new(at.x, at.y),
            Vec2::new(n(&a["slide"], "vx"), n(&a["slide"], "vy")),
        ))
    } else {
        None
    };
    let p = &mut sim.w.players[i];
    p.body.x = at.x;
    p.body.y = at.y;
    p.body.facing = 0.;
    p.body.history.reset(crate::state::Sample {
        t: now,
        x: at.x,
        y: at.y,
    });
    if let Some(hp) = a["hp"].as_f64() {
        p.vitals.hp = hp;
    }
    p.motion.slip = slide;
}
fn setup_terrain(sim: &mut Sim, a: &Value) {
    for row in a["lightAcc"].as_array().unwrap_or(&Vec::new()) {
        crate::terrain::stamp(
            &mut sim.w.terrain.light_acc,
            player_id(row[0].as_str().unwrap()),
            row[1].as_f64().unwrap(),
        );
    }
    for row in a["combatAt"].as_array().unwrap_or(&Vec::new()) {
        crate::terrain::stamp(
            &mut sim.w.terrain.combat_at,
            player_id(row[0].as_str().unwrap()),
            row[1].as_f64().unwrap(),
        );
    }
    if let Some(at) = a["lightSince"].as_f64() {
        sim.w.terrain.light_since = at;
    }
}
fn run_action(sim: &mut Sim, a: &Value) -> Vec<Event> {
    match a["kind"].as_str().unwrap() {
        "step" => sim.step(),
        "setupPlayer" => {
            setup_player(sim, a);
            sim.take_events()
        }
        "setupTerrain" => {
            setup_terrain(sim, a);
            sim.take_events()
        }
        "remove" => {
            sim.remove_player(player_id(a["actor"].as_str().unwrap()));
            sim.take_events()
        }
        other => panic!("unconsumed arena-terrain action {other}"),
    }
}
struct Run {
    constructed: Sim,
    joined: Sim,
    born: Sim,
    born_events: Vec<Event>,
    /// One snapshot per declared action, keeping each native frame for the mutation guards.
    action_states: Vec<Sim>,
    action_events: Vec<Vec<Event>>,
    sim: Sim,
}
fn replay(c: &Value) -> Run {
    let mut sim = construct(c);
    let constructed = sim.clone();
    join(c, &mut sim);
    let joined = sim.clone();
    let born_events = sim.step();
    let born = sim.clone();
    let mut action_states = Vec::new();
    let mut action_events = Vec::new();
    for a in c["input"]["actions"].as_array().unwrap() {
        let ev = run_action(&mut sim, a);
        action_states.push(sim.clone());
        action_events.push(ev);
    }
    Run {
        constructed,
        joined,
        born,
        born_events,
        action_states,
        action_events,
        sim,
    }
}
#[test]
fn terrain_follows_the_actual_arena_lock_teleport_and_unlock() {
    let c = corpus();
    let run = replay(&c);
    compare_frame(&run.constructed, &c["constructed"], "constructed", &[]);
    compare_frame(&run.joined, &c["joined"], "joined", &[]);
    compare_frame(&run.born, &c["born"], "born", &run.born_events);
    for (i, _) in c["input"]["actions"].as_array().unwrap().iter().enumerate() {
        compare_frame(
            &run.action_states[i],
            &c["frames"][i],
            &format!("action-{i}"),
            &run.action_events[i],
        );
    }
    // Frame 7 is the real scheduled teleport, frame 12 the real between-tick death unlock, frame 39 the first tick at or
    // after the 1500ms teleport-immunity boundary.
    assert_eq!(c["frames"][7]["public"]["gatesLocked"], json!(true));
    assert_eq!(c["frames"][12]["public"]["gatesLocked"], json!(false));
    // The teleport grants 1500ms of immunity: the burn pass runs (hazard seconds grow) but the ledger takes no hp until
    // the tick at/after the boundary. The source witness pins both halves of that.
    let hp_locked = run.action_states[7].w.players[0].vitals.hp;
    for i in 13..=38 {
        close(
            run.action_states[i].w.players[0].vitals.hp,
            hp_locked,
            &format!("immunity/action-{i}/hp"),
        );
        assert!(
            !run.action_states[i].w.rt.gates_locked,
            "immunity/action-{i}/gates"
        );
    }
    assert!(
        run.action_states[38].w.terrain.seconds[0] > run.action_states[12].w.terrain.seconds[0],
        "the burn pass ran while teleport immunity absorbed its damage"
    );
    assert!(run.action_states[39].w.players[0].vitals.hp < hp_locked);
    assert!(
        run.action_states[44].w.players[0].vitals.hp < run.action_states[39].w.players[0].vitals.hp
    );
    let mut sim = run.sim;
    // The complete declared main-stream tape, then its live final state: the teleport shuffle is the source one.
    let mut main = crate::rng::Mulberry32::new(c["profile"]["mainSeed"].as_u64().unwrap() as u32);
    for d in c["randomTape"].as_array().unwrap() {
        close(main.next_f64(), n(d, "value"), "random tape");
    }
    assert_eq!(
        serde_json::to_value(&main).unwrap(),
        serde_json::to_value(&sim.w.spawn_rng).unwrap()
    );
    // Restore/continue across the produced locked state and after the unlock.
    let restored = Sim::restore(serde_json::to_value(&sim).unwrap()).unwrap();
    let mut continued = sim.clone();
    let mut resumed = restored;
    assert_eq!(continued.state_hash(), resumed.state_hash());
    assert_eq!(continued.step(), resumed.step());
    assert_eq!(continued.state_hash(), resumed.state_hash());
    let _ = &mut sim;
}
#[test]
fn terrain_lock_teleport_comparator_rejects_mutated_native_state() {
    // Mutation guards: the comparator must fail when a recreated slide survives the real teleport and when a locked tick
    // counts the ember pass. Each mutation starts from the replay's own native snapshot.
    let c = corpus();
    let run = replay(&c);
    let teleport = &c["frames"][7];
    let mut slide = run.action_states[7].clone();
    let at = slide.w.core(crate::fighter::FighterIx::of_slot(1)).pos();
    slide
        .w
        .core_mut(crate::fighter::FighterIx::of_slot(1))
        .motion
        .slip = Some(super::walk::new_slip(at, Vec2::new(1., 2.)));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| compare_frame(
            &slide,
            teleport,
            "mutated/teleport-slide",
            &run.action_events[7]
        )))
        .is_err(),
        "a slide after the produced teleport must fail the comparison"
    );
    let locked = 9;
    let mut burn = run.action_states[locked].clone();
    burn.w.terrain.seconds[0] += crate::constants::TICK_MS / 1000.;
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| compare_frame(
            &burn,
            &c["frames"][locked],
            "mutated/locked-burn",
            &run.action_events[locked]
        )))
        .is_err(),
        "a locked tick that counted ember seconds must fail the comparison"
    );
}
