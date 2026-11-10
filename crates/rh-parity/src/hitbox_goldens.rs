//! ADR0024 Rust-native goldens for clients (not legacy parity): the hitbox archetype table and the protocol-16 prediction
//! vectors for the foot box. `cargo run -p rh-parity --bin hitbox-fixtures` writes them; `--check` (and
//! `tests/pnet2_goldens.rs`) fails when a committed file differs from what the current core produces.
//!
//! * `protocol/fixtures/archetypes_v1.json`: `rh_sim::archetype::ARCHETYPES` and the identity mapping under
//!   `HitboxMode::Archetypes`, for the C#/JS tests and offline Unity tools (the live client reads the Welcome's table).
//! * `protocol/fixtures/pathfinding_v2.json` (`rh-pathfinding-golden/2`): the v1 seed-1 MapBlob and the same 300 queries,
//!   with the waypoints `Pathfinder::find_path` gives for the foot box `Footprint::Box { hx: 10, hy: 6 }`.
//! * `protocol/fixtures/server_walk_v2.json` (`rh-server-walk/2`): the v1 corner walks replayed with
//!   `SimConfig::hitboxes = Archetypes` and a Fire (hero) walker, 241 per-tick rows each.
//!
//! The v1 files stay byte-identical as the `Disc(12)` oracle.

use crate::load_paths;
use rh_sim::archetype::{assign, HitboxMode, Hull, Identity, ARCHETYPES};
use rh_sim::geometry::Footprint;
use rh_sim::pathfind::Pathfinder;
use rh_sim::{
    validate, Arena, FactionId, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, Vec2,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const ARCHETYPES_FILE: &str = "protocol/fixtures/archetypes_v1.json";
pub const PATHFINDING_V2_FILE: &str = "protocol/fixtures/pathfinding_v2.json";
pub const SERVER_WALK_V2_FILE: &str = "protocol/fixtures/server_walk_v2.json";
/// The foot box every boxed archetype shares.
pub const FOOT: Footprint = Footprint::Box { hx: 10.0, hy: 6.0 };

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_json(relative: &str) -> Value {
    let path = repo(relative);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).expect("json");
    s.push('\n');
    s
}

fn point(p: Vec2) -> Value {
    json!([p.x, p.y])
}

/// `protocol/fixtures/archetypes_v1.json`.
pub fn archetypes_json() -> String {
    let rows: Vec<Value> = ARCHETYPES
        .iter()
        .map(|a| {
            let hull = match a.hull {
                Hull::Circle { r } => json!({"kind": "circle", "r": r}),
                Hull::Boxes {
                    foot,
                    body,
                    body_offset,
                } => json!({
                    "kind": "boxes",
                    "foot": [foot.x, foot.y],
                    "body": [body.x, body.y],
                    "bodyOffset": [body_offset.0, body_offset.1],
                }),
            };
            json!({"id": a.id.0, "key": a.key, "hull": hull, "chest": a.chest})
        })
        .collect();
    let id = |i: Identity| assign(HitboxMode::Archetypes, i).0;
    let players: Value = FactionId::ALL
        .iter()
        .map(|&f| (format!("{f:?}"), json!(id(Identity::Player(f.into())))))
        .collect::<serde_json::Map<_, _>>()
        .into();
    let mobs: Value = rh_sim::mob_catalog::MobTypeId::ALL
        .iter()
        .map(|&t| (t.as_str().to_string(), json!(id(Identity::Mob(t)))))
        .collect::<serde_json::Map<_, _>>()
        .into();
    pretty(&json!({
        "format": "rh-hitbox-archetypes/1",
        "source": "crates/rh-sim/src/archetype.rs (ADR0024); the live client reads the same table from the protocol-16 Welcome",
        "axes": "sim units; +x east, +y south (north is -y); the body box is centred at feet + bodyOffset; chest = -bodyOffset.y",
        "contentHash": format!("{:016x}", rh_sim::content::content_hash()),
        "archetypes": rows,
        "assign": {
            "mode": "Archetypes (LegacyCircle assigns id 0 to everyone)",
            "player": players,
            "playerNeutral": id(Identity::Player(rh_sim::fighter::FighterAffiliation::Neutral)),
            "dummy": id(Identity::Dummy),
            "zombie": id(Identity::Zombie),
            "questGiver": id(Identity::QuestGiver),
            "mob": mobs,
        },
    }))
}

/// `protocol/fixtures/pathfinding_v2.json`.
pub fn pathfinding_v2_json() -> String {
    let v1 = read_json("protocol/fixtures/pathfinding_v1.json");
    let (paths, map) = load_paths(&repo(v1["source"].as_str().expect("v1 source")));
    let mut pf = Pathfinder::default();
    let queries: Vec<Value> = paths
        .queries
        .iter()
        .map(|q| {
            let from = Vec2::new(q.from[0], q.from[1]);
            let to = Vec2::new(q.to[0], q.to[1]);
            let path: Vec<Value> = pf
                .find_path(&map, from, to, FOOT)
                .into_iter()
                .map(point)
                .collect();
            json!({"from": q.from, "to": q.to, "path": path})
        })
        .collect();
    pretty(&json!({
        "format": "rh-pathfinding-golden/2",
        "description": "C# pathfinder golden for the ADR0024 foot box: the v1 seed-1 MapBlob and the same 300 queries, with the waypoints rh_sim::pathfind::Pathfinder::find_path gives for footprint Box(10, 6). pathfinding_v1.json stays the Disc(12) oracle.",
        "generator": "cargo run -p rh-parity --bin hitbox-fixtures (crates/rh-parity/src/hitbox_goldens.rs); checked by crates/rh-parity/tests/pnet2_goldens.rs",
        "footprint": {"kind": "box", "hx": 10.0, "hy": 6.0},
        "mapBlob": v1["mapBlob"],
        "source": v1["source"],
        "tile": v1["tile"],
        "queries": queries,
    }))
}

/// One corner walk of `server_walk_v2.json`: 241 rows (the reset state, then 240 steps) of a Fire (hero) walker under
/// `Archetypes`, and the waypoints of the foot-box path.
fn walk_case(map: &rh_sim::TileMap, spawns: &[Vec2], case: &Value) -> Value {
    let start = Vec2::new(
        case["start"][0].as_f64().unwrap(),
        case["start"][1].as_f64().unwrap(),
    );
    let goal = Vec2::new(
        case["goal"][0].as_f64().unwrap(),
        case["goal"][1].as_f64().unwrap(),
    );
    let mut sim = Sim::reset_active(
        SimConfig {
            hitboxes: HitboxMode::Archetypes,
            ..SimConfig::default()
        },
        Arena {
            map: map.clone(),
            spawns: spawns.to_vec(),
        },
        Secrets::from_seed(11),
        &[Placement {
            profile: "walker".into(),
            faction: FactionId::Fire,
            bot: false,
            at: start,
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    );
    let walker = sim.player(PlayerId(1)).expect("walker");
    assert_eq!(walker.archetype, rh_sim::archetype::ArchetypeId::HERO);
    let command = validate(RawCommand::Move {
        x: goal.x,
        y: goal.y,
        seq: Some(1),
    })
    .expect("a finite move");
    sim.submit(PlayerId(1), command).expect("one move order");
    let row = |sim: &Sim| {
        let p = sim.player(PlayerId(1)).expect("walker");
        json!({"t": sim.server_time(), "tick": sim.tick(), "x": p.body.x, "y": p.body.y, "moveSeq": p.motion.move_seq})
    };
    let mut ticks = vec![row(&sim)];
    for _ in 0..240 {
        sim.step();
        ticks.push(row(&sim));
    }
    let waypoints: Vec<Value> = Pathfinder::default()
        .find_path(map, start, goal, FOOT)
        .into_iter()
        .map(point)
        .collect();
    json!({
        "name": case["name"],
        "queryIndex": case["queryIndex"],
        "start": case["start"],
        "goal": case["goal"],
        "waypoints": waypoints,
        "ticks": ticks,
    })
}

/// `protocol/fixtures/server_walk_v2.json`.
pub fn server_walk_v2_json() -> String {
    let v1 = read_json("protocol/fixtures/server_walk_v1.json");
    let (_, map) = load_paths(&repo("parity/fixtures/pathfinding_seed1.json"));
    let seed = read_json(v1["map"].as_str().expect("v1 map"));
    let spawns: Vec<Vec2> = seed["spawns"]
        .as_array()
        .expect("spawns")
        .iter()
        .map(|p| Vec2::new(p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
        .collect();
    let cases: Vec<Value> = v1["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .map(|c| walk_case(&map, &spawns, c))
        .collect();
    pretty(&json!({
        "format": "rh-server-walk/2",
        "source": "crates/rh-sim Sim::reset_active with SimConfig::hitboxes = Archetypes, a Fire (hero, foot box 10 x 6) walker, seed-1 map, one Move order, 20 Hz",
        "map": v1["map"],
        "playerSpeed": v1["playerSpeed"],
        "tickMs": v1["tickMs"],
        "archetype": rh_sim::archetype::ArchetypeId::HERO.0,
        "footprint": {"kind": "box", "hx": 10.0, "hy": 6.0},
        "cases": cases,
    }))
}

/// Every golden as (repository path, expected contents).
pub fn all() -> Vec<(&'static str, String)> {
    vec![
        (ARCHETYPES_FILE, archetypes_json()),
        (PATHFINDING_V2_FILE, pathfinding_v2_json()),
        (SERVER_WALK_V2_FILE, server_walk_v2_json()),
    ]
}

/// Writes every golden (`check == false`) or lists the ones that differ from the committed files.
pub fn write_or_check(check: bool) -> Vec<&'static str> {
    let mut stale = Vec::new();
    for (path, text) in all() {
        let full = repo(path);
        if check {
            if std::fs::read_to_string(&full).ok().as_deref() != Some(text.as_str()) {
                stale.push(path);
            }
        } else {
            std::fs::write(&full, text).unwrap_or_else(|e| panic!("{}: {e}", full.display()));
        }
    }
    stale
}
