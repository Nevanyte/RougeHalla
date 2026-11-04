//! The allocation-free tick (P7a), as a permanent gate: after warm-up a steady-state `Sim::step_into` allocates nothing, on
//! the legacy-captured crowded fight and on the two chase duels (which exercise the path search).
//!
//! A step is steady when it is past the warm-up (every reused buffer has reached its working size) and ends no one's run: a
//! result is a `String`-carrying event by design (it is banked), so the steps that resolve a player are not counted. Every
//! other step must show zero allocations, so a new per-tick `Vec`, `collect()` or `String` in a system fails this test
//! instead of waiting for a profile.

use rh_sim::events::Event;
use rh_sim::sim::{Arena, Placement, PlayerId, Secrets, Sim, SimConfig};
use rh_sim::{validate, Command, FactionId, RawCommand, TileMap, Vec2};
use serde_json::Value;
use std::path::Path;

#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

/// Ticks run before anything is counted: the reused buffers (event log, ledger, path scratch, the path search arrays) have
/// all met their largest need by then on these fixtures.
const WARM_UP_TICKS: u32 = 100;

struct Scenario {
    sim: Sim,
    /// `by_tick[t]`: the commands fed before step `t + 1`, in fixture order.
    by_tick: Vec<Vec<(PlayerId, Command)>>,
    ticks: u32,
}

fn load(name: &str) -> Scenario {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../parity/fixtures/{name}.json"));
    let fx: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let rows: Vec<&str> = fx["map"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    let arena = Arena {
        map: TileMap::from_rows(&rows).unwrap(),
        spawns: Vec::new(),
    };
    let f = |v: &Value, k: &str| v[k].as_f64().unwrap();
    let placements: Vec<Placement> = fx["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Placement {
            profile: p["id"].as_str().unwrap().to_uppercase(),
            faction: FactionId::parse(p["faction"].as_str().unwrap()).unwrap(),
            bot: false,
            at: Vec2::new(f(p, "x"), f(p, "y")),
            hp: Some(f(p, "hp")),
        })
        .collect();
    let secrets = Secrets {
        order_salt: fx["legacyConfig"]["orderSalt"].as_u64().unwrap() as u32,
        spawn_seed: 0,
    };
    let sim = Sim::reset_active(SimConfig::default(), arena, secrets, &placements);
    let ticks = fx["ticks"].as_array().unwrap().len() as u32;
    let mut by_tick: Vec<Vec<(PlayerId, Command)>> = vec![Vec::new(); ticks as usize + 2];
    for i in fx["inputs"].as_array().unwrap() {
        let m = &i["msg"];
        let g = |k: &str| m.get(k).and_then(Value::as_f64);
        let seq = m.get("seq").and_then(Value::as_u64).map(|v| v as u8);
        let raw = match i["type"].as_str().unwrap() {
            "move" => RawCommand::Move {
                x: g("x").unwrap(),
                y: g("y").unwrap(),
                seq,
            },
            "stop" => RawCommand::Stop { seq },
            "aim" => RawCommand::Aim { a: g("a").unwrap() },
            "attack" => RawCommand::Attack {
                a: g("a").unwrap(),
                t: g("t"),
            },
            "release" => RawCommand::Release {
                a: g("a").unwrap(),
                t: g("t"),
            },
            other => panic!("input type {other}"),
        };
        let who = i["player"].as_str().unwrap();
        let id = PlayerId(who.trim_start_matches('p').parse::<u32>().unwrap() + 1);
        let tick = (i["tick"].as_u64().unwrap() as usize).min(by_tick.len() - 1);
        by_tick[tick].push((id, validate(raw).unwrap()));
    }
    Scenario {
        sim,
        by_tick,
        ticks,
    }
}

/// Runs the scenario, returning (steady steps counted, allocations in them, the first offending tick).
fn run(name: &str) -> (u32, u64, Option<u32>) {
    let mut sc = load(name);
    let mut out: Vec<Event> = Vec::with_capacity(64);
    let (mut steady, mut allocs, mut first_bad) = (0u32, 0u64, None);
    for n in 0..sc.ticks {
        let tick = sc.sim.tick() + 1;
        for (id, cmd) in &sc.by_tick[tick as usize] {
            let _ = sc.sim.submit_unbudgeted(*id, *cmd);
        }
        out.clear();
        let before = dhat::HeapStats::get().total_blocks;
        sc.sim.step_into(&mut out);
        let used = dhat::HeapStats::get().total_blocks - before;
        let ends_a_run = out
            .iter()
            .any(|e| matches!(e, Event::Resolved { .. } | Event::Victory { .. }));
        if n >= WARM_UP_TICKS && !ends_a_run {
            steady += 1;
            allocs += used;
            if used > 0 && first_bad.is_none() {
                first_bad = Some(tick);
            }
        }
    }
    (steady, allocs, first_bad)
}

#[test]
fn a_steady_state_step_allocates_nothing() {
    let _profiler = dhat::Profiler::builder().testing().build();
    for name in ["crowded_8", "duel_chase", "fists_duel"] {
        let (steady, allocs, first_bad) = run(name);
        assert!(
            steady >= 100,
            "{name}: only {steady} steady steps were counted"
        );
        assert_eq!(
            allocs, 0,
            "{name}: {allocs} allocations over {steady} steady steps (first at tick {first_bad:?})"
        );
    }
}
