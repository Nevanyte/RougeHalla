//! Loads `parity/fixtures/*.json` (format `rh-legacy-scenario/1`, written by `parity/legacy-capture/capture.ts`) and replays
//! each scenario through `rh_sim::Sim`, comparing every tick. Tolerances and their rationale: parity/README.md.

use rh_sim::content::FactionId;
use rh_sim::sim::{Event, GvBreakdown, Outcome, Status};
use rh_sim::{
    validate, Arena, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap, Vec2,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Absolute tolerance on continuous values: the fixture rounds to 1e-6; one rounding step plus libm-vs-V8 ulps.
pub const TOL: f64 = 2e-6;

#[derive(Deserialize)]
pub struct Fixture {
    pub format: String,
    pub scenario: String,
    pub parity: String,
    #[serde(rename = "legacyRevision")]
    pub legacy_revision: String,
    #[serde(rename = "legacyConfig")]
    pub legacy_config: LegacyConfig,
    pub map: FixMap,
    pub players: Vec<FixPlayer>,
    pub inputs: Vec<FixInput>,
    pub ticks: Vec<FixTick>,
    pub results: Vec<FixResult>,
}

#[derive(Deserialize)]
pub struct LegacyConfig {
    #[serde(rename = "orderSalt")]
    pub order_salt: u32,
    #[serde(rename = "randomSeed")]
    pub random_seed: u32,
}

#[derive(Deserialize)]
pub struct FixMap {
    pub rows: Vec<String>,
}

#[derive(Deserialize)]
pub struct FixPlayer {
    pub id: String,
    pub faction: String,
    pub x: f64,
    pub y: f64,
    pub hp: f64,
}

#[derive(Deserialize)]
pub struct FixInput {
    pub tick: u32,
    pub player: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub msg: Value,
}

#[derive(Deserialize)]
pub struct FixTick {
    pub tick: u32,
    #[serde(rename = "serverTime")]
    pub server_time: f64,
    pub players: Vec<FixState>,
    pub events: Vec<Value>,
}

#[derive(Deserialize)]
pub struct FixState {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub status: String,
    #[serde(rename = "readyAt")]
    pub ready_at: f64,
}

#[derive(Deserialize, Debug)]
pub struct FixResult {
    pub tick: u32,
    pub id: String,
    pub outcome: String,
    pub place: u32,
    pub players: u32,
    pub kills: u32,
    #[serde(rename = "killedBy")]
    pub killed_by: Option<String>,
    #[serde(rename = "gvTotal")]
    pub gv_total: u32,
    #[serde(rename = "gvWin")]
    pub gv_win: u32,
    #[serde(rename = "gvKills")]
    pub gv_kills: u32,
}

pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/fixtures")
}

pub fn load(path: &Path) -> Fixture {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Fixture ids are "p<join index>"; the Rust core assigns PlayerId(join index + 1).
pub fn pid(s: &str) -> PlayerId {
    PlayerId(
        s.trim_start_matches('p')
            .parse::<u32>()
            .expect("fixture id p<n>")
            + 1,
    )
}
fn fid(id: PlayerId) -> String {
    format!("p{}", id.0 - 1)
}

/// The fixture input as a raw command (None for a type outside the slice).
pub fn raw_command_pub(i: &FixInput) -> Option<RawCommand> {
    raw_command(i)
}

fn raw_command(i: &FixInput) -> Option<RawCommand> {
    let m = &i.msg;
    let f = |k: &str| m.get(k).and_then(Value::as_f64);
    let seq = m
        .get("seq")
        .and_then(Value::as_u64)
        .filter(|v| *v <= 255)
        .map(|v| v as u8);
    Some(match i.kind.as_str() {
        "move" => RawCommand::Move {
            x: f("x")?,
            y: f("y")?,
            seq,
        },
        "stop" => RawCommand::Stop { seq },
        "aim" => RawCommand::Aim { a: f("a")? },
        "attack" => RawCommand::Attack {
            a: f("a")?,
            t: f("t"),
        },
        "release" => RawCommand::Release {
            a: f("a")?,
            t: f("t"),
        },
        _ => return None,
    })
}

#[derive(Default, Debug)]
pub struct Report {
    pub ticks: usize,
    pub events: usize,
    pub results: usize,
    pub max_pos_err: f64,
    pub max_hp_err: f64,
    pub mismatches: Vec<String>,
}

impl Report {
    fn fail(&mut self, msg: String) {
        if self.mismatches.len() < 25 {
            self.mismatches.push(msg);
        }
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOL
}
fn angle_close(a: f64, b: f64) -> bool {
    rh_sim::math::angle_between(a, b) <= TOL
}

fn status_str(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

fn outcome_str(o: Outcome) -> &'static str {
    match o {
        Outcome::Won => "won",
        Outcome::Draw => "draw",
        Outcome::Died => "died",
        Outcome::Mia => "mia",
    }
}

/// Canonical form of a Rust event, matching the capture tool's `canonicalEvent` (GV feedback events are not compared:
/// GV is checked through the results).
fn canon(e: &Event) -> Option<Value> {
    use serde_json::json;
    Some(match e {
        Event::Windup { by, weapon, .. } => {
            json!({"kind": "windup", "by": fid(*by), "weapon": weapon.as_str()})
        }
        Event::Swing {
            by,
            weapon,
            x,
            y,
            a,
        } => {
            json!({"kind": "swing", "by": fid(*by), "weapon": weapon.as_str(), "x": x, "y": y, "a": a})
        }
        Event::Hit {
            victim,
            by,
            amount,
            weapon,
        } => {
            json!({"kind": "hit", "id": fid(*victim), "by": fid(*by), "amount": amount, "weapon": weapon.as_str()})
        }
        Event::Death { id, by, .. } => json!({"kind": "death", "id": fid(*id), "by": by.map(fid)}),
        Event::Victory { id, draw } => json!({"kind": "victory", "id": id.map(fid), "draw": draw}),
        Event::RaidEnded => json!({"kind": "raidEnded"}),
        Event::Bounty { .. } => json!({"kind": "bounty"}),
        Event::Stagger { id } => json!({"kind": "stagger", "id": fid(*id)}),
        Event::Gv { .. } | Event::Resolved { .. } | Event::RaidStarted => return None,
    })
}

fn same_value(key: &str, a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if key == "a" {
                angle_close(x, y)
            } else {
                close(x, y)
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_value(k, v, w)))
        }
        _ => a == b,
    }
}

/// Builds the Rust sim for a fixture: same map, same placements, the recorded secret order salt.
pub fn build(fx: &Fixture) -> Sim {
    let map = TileMap::from_rows(&fx.map.rows).expect("fixture map");
    let arena = Arena {
        map,
        spawns: Vec::new(),
    };
    let placements: Vec<Placement> = fx
        .players
        .iter()
        .map(|p| Placement {
            profile: p.id.to_uppercase(),
            faction: FactionId::parse(&p.faction).expect("faction"),
            bot: false,
            at: Vec2::new(p.x, p.y),
            hp: Some(p.hp),
        })
        .collect();
    let secrets = Secrets {
        order_salt: fx.legacy_config.order_salt,
        spawn_seed: 0,
    };
    Sim::reset_active(SimConfig::default(), arena, secrets, &placements)
}

/// Replays the fixture and compares every tick and every result.
pub fn compare(fx: &Fixture) -> Report {
    let mut rep = Report::default();
    // The recorded order salt must be the first draw of mulberry32(randomSeed) (createWorld's one draw).
    let salt = rh_sim::rng::Mulberry32::new(fx.legacy_config.random_seed).next_u32();
    if salt != fx.legacy_config.order_salt {
        rep.fail(format!(
            "orderSalt {} is not the first mulberry32({}) draw {}",
            fx.legacy_config.order_salt, fx.legacy_config.random_seed, salt
        ));
    }
    let mut sim = build(fx);
    let leave_after: Option<(u32, PlayerId)> = if fx.scenario == "leave_mia" {
        Some((40, pid("p2")))
    } else {
        None
    };
    let mut inputs = fx.inputs.iter().peekable();
    let mut rust_results: Vec<(u32, PlayerId, rh_sim::RunResult)> = Vec::new();
    for t in &fx.ticks {
        while let Some(i) = inputs.peek() {
            if i.tick > t.tick {
                break;
            }
            let i = inputs.next().unwrap();
            let Some(raw) = raw_command(i) else {
                rep.fail(format!(
                    "tick {}: input type {} is not in the slice",
                    i.tick, i.kind
                ));
                continue;
            };
            match validate(raw) {
                Ok(cmd) => {
                    let _ = sim.submit_unbudgeted(pid(&i.player), cmd);
                }
                Err(e) => rep.fail(format!(
                    "tick {}: legacy accepted {} but Rust rejected it: {e:?}",
                    i.tick, i.kind
                )),
            }
        }
        let events = sim.step();
        if let Some((tick, who)) = leave_after {
            if tick == t.tick {
                sim.remove_player(who);
            }
        }
        // Events emitted between steps (a leave's MIA result) travel with the NEXT step's events, as in legacy.
        let all: Vec<Event> = events;
        rep.ticks += 1;
        if sim.tick != t.tick || !close(sim.server_time, t.server_time) {
            rep.fail(format!(
                "clock: rust tick {} t {} vs legacy tick {} t {}",
                sim.tick, sim.server_time, t.tick, t.server_time
            ));
        }
        // players
        let ours = sim.players();
        if ours.len() != t.players.len() {
            rep.fail(format!(
                "tick {}: {} players vs legacy {}",
                t.tick,
                ours.len(),
                t.players.len()
            ));
        }
        for lp in &t.players {
            let Some(rp) = ours.iter().find(|p| p.id == pid(&lp.id)) else {
                rep.fail(format!("tick {}: {} missing", t.tick, lp.id));
                continue;
            };
            let pe = (rp.x - lp.x).abs().max((rp.y - lp.y).abs());
            rep.max_pos_err = rep.max_pos_err.max(pe);
            rep.max_hp_err = rep.max_hp_err.max((rp.hp - lp.hp).abs());
            if !close(rp.x, lp.x) || !close(rp.y, lp.y) {
                rep.fail(format!(
                    "tick {} {}: pos ({}, {}) vs legacy ({}, {})",
                    t.tick, lp.id, rp.x, rp.y, lp.x, lp.y
                ));
            }
            if !angle_close(rp.facing, lp.facing) {
                rep.fail(format!(
                    "tick {} {}: facing {} vs {}",
                    t.tick, lp.id, rp.facing, lp.facing
                ));
            }
            if !close(rp.hp, lp.hp) {
                rep.fail(format!(
                    "tick {} {}: hp {} vs {}",
                    t.tick, lp.id, rp.hp, lp.hp
                ));
            }
            if !close(rp.ready_at, lp.ready_at) {
                rep.fail(format!(
                    "tick {} {}: readyAt {} vs {}",
                    t.tick, lp.id, rp.ready_at, lp.ready_at
                ));
            }
            if status_str(rp.status) != lp.status {
                rep.fail(format!(
                    "tick {} {}: status {:?} vs {}",
                    t.tick, lp.id, rp.status, lp.status
                ));
            }
        }
        // events
        let ours: Vec<Value> = all.iter().filter_map(canon).collect();
        rep.events += t.events.len();
        if ours.len() != t.events.len()
            || !ours
                .iter()
                .zip(&t.events)
                .all(|(a, b)| same_value("", a, b))
        {
            rep.fail(format!(
                "tick {}: events\n  rust   {}\n  legacy {}",
                t.tick,
                Value::Array(ours.clone()),
                Value::Array(t.events.clone())
            ));
        }
        for e in &all {
            if let Event::Resolved { id, result, .. } = e {
                rust_results.push((t.tick, *id, result.clone()));
            }
        }
    }
    // results
    rep.results = fx.results.len();
    if rust_results.len() != fx.results.len() {
        rep.fail(format!(
            "{} results vs legacy {}",
            rust_results.len(),
            fx.results.len()
        ));
    }
    for (lr, (tick, id, r)) in fx.results.iter().zip(&rust_results) {
        let g: GvBreakdown = r.gv;
        let ok = lr.tick == *tick
            && pid(&lr.id) == *id
            && lr.outcome == outcome_str(r.outcome)
            && lr.place == r.place
            && lr.players == r.players
            && lr.kills == r.kills
            && lr.killed_by == r.killed_by
            && lr.gv_total == g.total
            && lr.gv_win == g.win
            && lr.gv_kills == g.kills;
        if !ok {
            rep.fail(format!(
                "result mismatch: legacy {lr:?} vs rust tick {tick} {id:?} {r:?}"
            ));
        }
    }
    rep
}

/// Every fixture file of the given parity class, sorted by name.
pub fn fixture_paths(class: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(fixtures_dir())
        .expect("parity/fixtures")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().is_some_and(|x| x == "json")
                && !p
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("pathfinding")
        })
        .filter(|p| load(p).parity == class)
        .collect();
    out.sort();
    out
}

#[derive(Deserialize)]
pub struct PathFixture {
    pub seed: u32,
    #[serde(rename = "mapHashU32")]
    pub map_hash: u32,
    pub map: FixMap,
    pub radius: f64,
    pub queries: Vec<PathQuery>,
}

#[derive(Deserialize)]
pub struct PathQuery {
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub path: Vec<[f64; 2]>,
}

/// Replays the legacy findPath queries; returns (queries, mismatches).
pub fn compare_paths(path: &Path) -> (usize, Vec<String>) {
    let text = std::fs::read_to_string(path).expect("pathfinding fixture");
    let fx: PathFixture = serde_json::from_str(&text).expect("pathfinding json");
    let map = TileMap::from_rows(&fx.map.rows).expect("map");
    let mut pf = rh_sim::pathfind::Pathfinder::default();
    let mut bad = Vec::new();
    for (k, q) in fx.queries.iter().enumerate() {
        let got = pf.find_path(
            &map,
            Vec2::new(q.from[0], q.from[1]),
            Vec2::new(q.to[0], q.to[1]),
            fx.radius,
        );
        let same = got.len() == q.path.len()
            && got
                .iter()
                .zip(&q.path)
                .all(|(g, w)| close(g.x, w[0]) && close(g.y, w[1]));
        if !same && bad.len() < 10 {
            bad.push(format!(
                "query {k}: rust {:?} vs legacy {:?}",
                got.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>(),
                q.path
            ));
        }
    }
    (fx.queries.len(), bad)
}
