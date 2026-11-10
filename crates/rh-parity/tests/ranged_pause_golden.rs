//! The attack movement pause, as the owner's client could know it (protocol/fixtures/ranged_pause_v1.json).
//!
//! The server stops a fighter's walk while its attack winds up: for the whole wind-up of a swing and for the last
//! `RANGED_RELEASE_PAUSE_MS` before a bow or wand shot lands (`systems/weapons.rs`, `move_multiplier`). The Unity client
//! mirrors that pause so a player who attacks while walking is not drawn walking through it and then pulled back. This
//! test is the Rust side of that proof (C-PARITY, ADR 0008): it drives the real sim, one walking fighter attacking in
//! several ways, and for every 50 ms tick records
//!
//! * the SERVER TRUTH: the fighter's position and whether the tick moved it (the move multiplier is `0` or `1`, read from
//!   the tick's displacement because `move_multiplier` is crate private to rh-sim; this test never edits rh-sim), and
//! * what the CLIENT KNOWS at that tick: only what the observation delivers to the owner (`observe` for the owner, the same
//!   projection the wire carries): the owner's `Windup`, `Cancel` and `Stagger` fx with the wire's whole-millisecond wait,
//!   and the self block's weapon, effects and ready time. Nothing else; in particular no private clock.
//!
//! `ranged_pause_v1_is_the_current_server` rebuilds the file from the current core and requires it byte for byte equal
//! (`RH_WRITE_FIXTURES=1 cargo test -p rh-parity --test ranged_pause_golden` rewrites it). The C# replay is
//! `client-unity/RoguehallaNet.Tests/RangedPausePredictionTests.cs`.
//!
//! The bow case records a real server pause for which the owner is told nothing: a bow's draw has no `Windup` fx (the sim
//! announces windups only for non-bow weapons), so the client has no delivered fact to place its release. The C# test
//! pins that gap instead of hiding it.

use rh_parity::load_paths;
use rh_sim::constants::{RANGED_RELEASE_PAUSE_MS, TICK_MS, TIE_EPS_MS};
use rh_sim::events::Event;
use rh_sim::observe::{observe, SeenEvent};
use rh_sim::{
    validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
    WeaponId,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const FORMAT: &str = "rh-ranged-pause/1";
const ME: PlayerId = PlayerId(1);
const FOE: PlayerId = PlayerId(2);
const PLAYER_SPEED: f64 = 170.0;

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

/// One scripted command, submitted after row `row` is recorded (so the next step applies it).
#[derive(Clone, Copy)]
enum Cmd {
    Attack,
    Release,
    Swap,
}

struct Case {
    name: &'static str,
    description: &'static str,
    /// Which `server_walk_v1` corner walk the fighter walks.
    walk: &'static str,
    weapon: WeaponId,
    /// The second weapon slot (for the swap case).
    other: Option<WeaponId>,
    /// `(row, command)`.
    script: &'static [(usize, Cmd)],
    /// A sword fighter standing where it can hit the walker (row at which it presses, offset from the walker at that row).
    foe: Option<(usize, f64, f64)>,
    rows: usize,
}

const CASES: &[Case] = &[
    Case {
        name: "wand-single-shot",
        description: "a walking wand fighter presses once and releases: one cast, one pause before the shot lands",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: None,
        script: &[(12, Cmd::Attack), (13, Cmd::Release)],
        foe: None,
        rows: 60,
    },
    Case {
        name: "wand-held",
        description: "the trigger held for three cycles: the pause repeats with each cast",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: None,
        script: &[(10, Cmd::Attack), (58, Cmd::Release)],
        foe: None,
        rows: 80,
    },
    Case {
        name: "wand-rejected-cooldown",
        description: "a second press while the wand is still cooling down is released before it can start: the server never pauses for it and delivers no windup",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: None,
        script: &[
            (6, Cmd::Attack),
            (7, Cmd::Release),
            (19, Cmd::Attack),
            (20, Cmd::Release),
        ],
        foe: None,
        rows: 70,
    },
    Case {
        name: "wand-staggered",
        description: "a sword hit staggers the wand fighter during the cast: the cast and its pause are cancelled and a stagger fx says so",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: None,
        script: &[(12, Cmd::Attack), (13, Cmd::Release)],
        foe: Some((15, 0.0, 30.0)),
        rows: 60,
    },
    Case {
        name: "wand-staggered-in-pause",
        description: "the stagger lands while the release pause is already running: the pause must end at the stagger, not at the shot",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: None,
        script: &[(12, Cmd::Attack), (13, Cmd::Release)],
        foe: Some((19, 0.0, 30.0)),
        rows: 60,
    },
    Case {
        name: "wand-weapon-swap",
        description: "a weapon swap during the cast cancels it without any cancel fx: only the self block's weapon changes",
        walk: "corner-a",
        weapon: WeaponId::Wand,
        other: Some(WeaponId::Sword),
        script: &[(12, Cmd::Attack), (13, Cmd::Release), (16, Cmd::Swap)],
        foe: None,
        rows: 60,
    },
    Case {
        name: "bow-single-shot",
        description: "a walking bow fighter presses once and releases: the server pauses for the release, but a bow draw delivers no windup fx",
        walk: "corner-a",
        weapon: WeaponId::Bow,
        other: None,
        script: &[(12, Cmd::Attack), (13, Cmd::Release)],
        foe: None,
        rows: 60,
    },
    Case {
        name: "sword-swing",
        description: "a walking sword fighter swings: a player's swing has no wind-up, so the windup fx says 0 ms and the server never pauses",
        walk: "corner-a",
        weapon: WeaponId::Sword,
        other: None,
        script: &[(12, Cmd::Attack), (13, Cmd::Release)],
        foe: None,
        rows: 40,
    },
];

fn fx_json(ev: &SeenEvent) -> Option<Value> {
    // Only the owner's own telegraph facts: the ones a client acts on for ITS pause. The wait is the wire's whole
    // milliseconds (rh-policy `project`: round, clamp to u16).
    match *ev {
        SeenEvent::Windup {
            by,
            weapon,
            a,
            ms,
        } if by == ME => Some(json!({
            "kind": "windup",
            "by": by.0,
            "weapon": weapon.code(),
            "a": a,
            "msExact": ms,
            "ms": ms.clamp(0.0, f64::from(u16::MAX)).round() as u64,
        })),
        SeenEvent::AttackCancelled { id } if id == ME => Some(json!({ "kind": "cancel", "id": id.0 })),
        SeenEvent::Stagger { id } if id == ME => Some(json!({ "kind": "stagger", "id": id.0 })),
        _ => None,
    }
}

fn run_case(case: &Case, walks: &Value, paths_map: &rh_sim::TileMap, spawns: &[Vec2]) -> Value {
    let walk = walks["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == case.walk)
        .expect("server_walk case");
    let start = [
        walk["start"][0].as_f64().unwrap(),
        walk["start"][1].as_f64().unwrap(),
    ];
    let goal = [
        walk["goal"][0].as_f64().unwrap(),
        walk["goal"][1].as_f64().unwrap(),
    ];
    let arena = Arena {
        map: paths_map.clone(),
        spawns: spawns.to_vec(),
    };
    // The foe stands where the walker WILL be at the row it presses (read from the golden walk), so the case does not
    // depend on a second pathfinder run.
    let mut placements = vec![Placement {
        profile: "walker".into(),
        faction: FactionId::Fire,
        bot: false,
        at: Vec2::new(start[0], start[1]),
        hp: None,
        weapon0: Some(case.weapon),
        weapon1: case.other,
    }];
    if let Some((row, dx, dy)) = case.foe {
        let at = &walk["ticks"][row];
        placements.push(Placement {
            profile: "foe".into(),
            faction: FactionId::Frost,
            bot: false,
            at: Vec2::new(at["x"].as_f64().unwrap() + dx, at["y"].as_f64().unwrap() + dy),
            hp: None,
            weapon0: Some(WeaponId::Sword),
            weapon1: None,
        });
    }
    let mut sim = Sim::reset_active(
        SimConfig::default(),
        arena,
        Secrets::from_seed(11),
        &placements,
    );
    sim.submit(
        ME,
        validate(RawCommand::Move {
            x: goal[0],
            y: goal[1],
            seq: Some(1),
        })
        .unwrap(),
    )
    .expect("the walk order");

    let mut rows: Vec<Value> = Vec::with_capacity(case.rows + 1);
    let mut prev = {
        let p = sim.player(ME).unwrap().pos();
        (p.x, p.y)
    };
    let mut commands: Vec<Value> = Vec::new();
    for row in 0..=case.rows {
        let mut fx: Vec<Value> = Vec::new();
        let mut events: Vec<Event> = Vec::new();
        if row > 0 {
            events = sim.step();
        }
        let obs = observe(&sim, ME, &events);
        for e in &obs.events {
            if let Some(v) = fx_json(e) {
                fx.push(v);
            }
        }
        let me = obs.me.as_ref().expect("the owner is seated");
        let p = sim.player(ME).unwrap();
        let (x, y) = (p.pos().x, p.pos().y);
        let step = ((x - prev.0).powi(2) + (y - prev.1).powi(2)).sqrt();
        prev = (x, y);
        // The multiplier of the step that produced this row: the walk moves 170 * mult * 0.05 along its path (a leg that
        // ends inside the step moves less, so the multiplier is read as "moved at all").
        // Idle (nothing left to walk) is null: no multiplier can be read from a fighter that has nowhere to go.
        let mult: Value = if row == 0 {
            Value::Null
        } else if step > 1e-9 {
            json!(1)
        } else if p.motion.path.is_empty() {
            Value::Null
        } else {
            json!(0)
        };
        let truth_lands_at = p.weapon.action.map(|a| a.lands_at);
        let truth_kind = p.weapon.action.map(|a| format!("{:?}", a.kind));
        rows.push(json!({
            "row": row,
            "tick": obs.tick,
            "t": obs.server_time,
            "x": x,
            "y": y,
            "moveMult": mult,
            "step": step,
            "moveSeq": me.move_seq,
            "weapon": me.weapon.code(),
            "effects": me.effects,
            "readyInMs": me.ready_in_ms,
            "fx": fx,
            // Diagnostics only (private server state, never read by the client test): the pending action after this row.
            "truthLandsAt": truth_lands_at,
            "truthAction": truth_kind,
        }));
        // Commands scripted after this row.
        for &(at, cmd) in case.script.iter().filter(|(at, _)| *at == row) {
            let (raw, name) = match cmd {
                Cmd::Attack => (RawCommand::Attack { a: 0.0, t: None }, "attack"),
                Cmd::Release => (RawCommand::Release { a: 0.0, t: None }, "release"),
                Cmd::Swap => (RawCommand::Swap { slot: None }, "swap"),
            };
            sim.submit(ME, validate(raw).unwrap()).expect("scripted command accepted");
            commands.push(json!({ "afterRow": at, "kind": name }));
        }
        if let Some((frow, _, _)) = case.foe {
            if frow == row {
                // Aim at the walker from where the foe stands.
                let foe = sim.player(FOE).unwrap().pos();
                let me_pos = sim.player(ME).unwrap().pos();
                let a = (me_pos.y - foe.y).atan2(me_pos.x - foe.x);
                sim.submit(FOE, validate(RawCommand::Attack { a, t: None }).unwrap())
                    .expect("foe attack");
                sim.submit(FOE, validate(RawCommand::Release { a, t: None }).unwrap())
                    .expect("foe release");
                commands.push(json!({ "afterRow": row, "kind": "foe-sword" }));
            }
        }
    }
    json!({
        "name": case.name,
        "description": case.description,
        "walk": case.walk,
        "start": start,
        "goal": goal,
        "weapon": case.weapon.code(),
        "otherWeapon": case.other.map(WeaponId::code),
        "commands": commands,
        "rows": rows,
    })
}

fn build() -> Value {
    let walks: Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path("protocol/fixtures/server_walk_v1.json")).unwrap(),
    )
    .unwrap();
    let (_paths, map) = load_paths(&repo_path("parity/fixtures/pathfinding_seed1.json"));
    let seed_map: Value = serde_json::from_str(
        &std::fs::read_to_string(repo_path(walks["map"].as_str().unwrap())).unwrap(),
    )
    .unwrap();
    let spawns: Vec<Vec2> = seed_map["spawns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| Vec2::new(p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
        .collect();
    let cases: Vec<Value> = CASES
        .iter()
        .map(|c| run_case(c, &walks, &map, &spawns))
        .collect();
    json!({
        "format": FORMAT,
        "source": "crates/rh-sim Sim::reset_active, seed-1 map, one Move order then scripted attacks, 20 Hz; rows are what the owner's observation delivers",
        "map": walks["map"],
        "walkFixture": "server_walk_v1.json",
        "constants": {
            "playerSpeed": PLAYER_SPEED,
            "tickMs": TICK_MS,
            "rangedReleasePauseMs": RANGED_RELEASE_PAUSE_MS,
            "tieEpsMs": TIE_EPS_MS,
        },
        "cases": cases,
    })
}

#[test]
fn ranged_pause_v1_is_the_current_server() {
    let got = build();
    let path = repo_path("protocol/fixtures/ranged_pause_v1.json");
    if std::env::var_os("RH_WRITE_FIXTURES").is_some() {
        let mut text = serde_json::to_string_pretty(&got).unwrap();
        text.push('\n');
        std::fs::write(&path, text).unwrap();
        println!("wrote {}", path.display());
        return;
    }
    let want: Value = serde_json::from_str(
        &std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e} (RH_WRITE_FIXTURES=1 writes it)", path.display())),
    )
    .unwrap();
    assert_eq!(
        got, want,
        "ranged_pause_v1.json is not what the current core produces (RH_WRITE_FIXTURES=1 rewrites it)"
    );
}

/// The shape every claim of the C# test and the docs rests on, asserted here against the Rust truth so a fixture that
/// silently stopped exercising the rule cannot pass.
#[test]
fn ranged_pause_v1_exercises_the_rule() {
    let v = build();
    let cases = v["cases"].as_array().unwrap();
    let find = |n: &str| cases.iter().find(|c| c["name"] == n).unwrap();
    let rows = |c: &Value| c["rows"].as_array().unwrap().clone();
    let paused = |c: &Value| rows(c).iter().filter(|r| r["moveMult"] == json!(0)).count();
    let windups = |c: &Value| {
        rows(c)
            .iter()
            .flat_map(|r| r["fx"].as_array().unwrap().clone())
            .filter(|f| f["kind"] == "windup")
            .count()
    };
    // A wand cast: announced, then paused for exactly the ticks before it lands.
    let wand = find("wand-single-shot");
    assert_eq!(windups(wand), 1, "one cast, one windup fx");
    assert!(paused(wand) >= 3, "the cast pauses the walk for whole ticks");
    // The owner is told the wait at the cast's own tick, and landsAt = t + ms.
    let r = rows(wand);
    let w = r.iter().find(|r| !r["fx"].as_array().unwrap().is_empty()).unwrap();
    let lands = w["truthLandsAt"].as_f64().unwrap();
    let said = w["t"].as_f64().unwrap() + w["fx"][0]["ms"].as_f64().unwrap();
    assert!((lands - said).abs() <= 0.5, "windup ms places the landing within the wire's rounding: {lands} vs {said}");
    assert!(windups(find("wand-held")) >= 3, "three cycles announce three windups");
    // A rejected press is silent and never pauses.
    assert_eq!(windups(find("wand-rejected-cooldown")), 1, "only the first cast is announced");
    // A stagger is delivered and cancels the cast.
    let st = find("wand-staggered");
    assert!(
        rows(st).iter().any(|r| r["fx"].as_array().unwrap().iter().any(|f| f["kind"] == "stagger")),
        "the sword hit staggers the wand fighter"
    );
    // The bow pauses with no windup fx at all.
    let bow = find("bow-single-shot");
    assert_eq!(windups(bow), 0, "a bow draw delivers no windup");
    assert!(paused(bow) >= 2, "the bow release still pauses the server walk");
    // A player's swing has no wind-up.
    let sword = find("sword-swing");
    assert_eq!(paused(sword), 0, "a player swing never pauses the walk");
    let ms0 = rows(sword)
        .iter()
        .flat_map(|r| r["fx"].as_array().unwrap().clone())
        .find(|f| f["kind"] == "windup")
        .map(|f| f["ms"].as_u64().unwrap());
    assert_eq!(ms0, Some(0));
}
