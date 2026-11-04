//! Loads `parity/fixtures/*.json` (format `rh-legacy-scenario/1`, written by `parity/legacy-capture/capture.ts`) and replays
//! each scenario through `rh_sim::Sim`, comparing every tick. Tolerances and their rationale: parity/README.md.
//!
//! False-MATCH protection: every fixture struct denies unknown keys, so a key newly emitted by the capture tool fails
//! loudly instead of being ignored. Per-entity state is compared through a projection table ([`PLAYERS`]): a legacy key
//! with no projection fails as "unported key" unless the fixture names it in `notCompared`, and a projected key the
//! legacy entity lacks fails too. The keys that describe the legacy configuration are asserted as preconditions
//! ([`preconditions`]). A later mechanic adds its capture fields and one projection line (or, for a new entity kind such
//! as mobs, one `FixTick` list and one [`EntityKind`] table).

use rh_sim::content::{FactionId, WeaponId};
use rh_sim::sim::{Event, GvBreakdown, Outcome, Player, Status};
use rh_sim::{
    validate, Arena, Placement, PlayerId, RawCommand, Secrets, Sim, SimConfig, TileMap, Vec2,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Absolute tolerance on continuous values: the fixture rounds to 1e-6; one rounding step plus libm-vs-V8 ulps.
pub const TOL: f64 = 2e-6;

/// The scenario fixture format this harness reads.
pub const SCENARIO_FORMAT: &str = "rh-legacy-scenario/1";
/// The pathfinding fixture format.
pub const PATHFINDING_FORMAT: &str = "rh-legacy-pathfinding/1";
/// The legacy configuration every scenario is captured under (capture.ts `legacyConfig.world`). It is the configuration
/// the Rust slice implements, so a fixture captured under another one is refused, not compared.
pub const CAPTURE_WORLD: &str = "createGameWorld(signatures:false, walkHints:false), hand-built map, mobs/quests/hazards/regen off, pvpRules on (default), no cards";
/// The parity classes a fixture may declare.
pub const PARITY_CLASSES: [&str; 2] = ["slice", "capture-only"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Fixture {
    pub format: String,
    pub scenario: String,
    pub description: String,
    pub parity: String,
    pub legacy_revision: String,
    pub legacy_config: LegacyConfig,
    pub map: FixMap,
    pub players: Vec<FixPlayer>,
    pub inputs: Vec<FixInput>,
    /// Out-of-band actions after a step (leave, drop, reconnect).
    #[serde(default)]
    pub actions: Vec<FixAction>,
    pub ticks: Vec<FixTick>,
    pub results: Vec<FixResult>,
    /// Legacy per-entity keys deliberately not compared, as "<entity kind>.<key>" (e.g. "players.ammo"). Optional; a key
    /// listed here must not be one the harness compares.
    #[serde(default)]
    pub not_compared: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LegacyConfig {
    pub world: String,
    pub tick_ms: f64,
    pub start_tick: u32,
    pub start_server_time: f64,
    pub order_salt: u32,
    pub random_seed: u32,
    pub mobs_present: u32,
    pub start_events: Vec<String>,
    pub unexpected_event_types: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixMap {
    pub w: usize,
    pub h: usize,
    pub tile: f64,
    pub rows: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FixPlayer {
    pub id: String,
    pub faction: String,
    pub x: f64,
    pub y: f64,
    pub hp: f64,
    pub max_hp: f64,
    /// The starting weapon in slot 0 ("" = fists).
    pub weapon0: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixInput {
    pub tick: u32,
    pub player: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub msg: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixAction {
    pub tick: u32,
    pub kind: String,
    pub player: String,
}

/// One legacy entity's state on one tick: key -> value, compared through its kind's projection table.
pub type Entity = Map<String, Value>;

/// One step. Each entity kind is its own list; a new kind (mobs, projectiles) is a new field here plus its
/// [`EntityKind`] table, and until then a fixture carrying it is refused (unknown key).
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FixTick {
    pub tick: u32,
    pub server_time: f64,
    pub players: Vec<Entity>,
    pub events: Vec<Value>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FixResult {
    pub tick: u32,
    pub id: String,
    pub outcome: String,
    pub place: u32,
    pub players: u32,
    pub kills: u32,
    pub killed_by: Option<String>,
    pub gv_total: u32,
    pub gv_win: u32,
    pub gv_kills: u32,
}

pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/fixtures")
}

/// Parses a scenario fixture (unknown keys are an error).
pub fn parse(text: &str) -> Result<Fixture, String> {
    serde_json::from_str(text).map_err(|e| e.to_string())
}

pub fn load(path: &Path) -> Fixture {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    parse(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The `format` of a fixture file, read from its first bytes: capture.ts writes `format` as the first key, so this never
/// parses the whole file. `None` when the file does not start with a `format` key. Only the valid UTF-8 prefix of the
/// first 256 bytes is read, so a multibyte character cut at byte 256 (an em dash in a long description) cannot hide the
/// format.
pub fn peek_format(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut head = [0u8; 256];
    let mut f = std::fs::File::open(path).ok()?;
    let mut n = 0;
    while n < head.len() {
        match f.read(&mut head[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(_) => return None,
        }
    }
    let s = match std::str::from_utf8(&head[..n]) {
        Ok(s) => s,
        // The valid prefix is UTF-8 by construction.
        Err(e) => std::str::from_utf8(&head[..e.valid_up_to()]).ok()?,
    };
    let rest = s.trim_start().strip_prefix('{')?.trim_start();
    let rest = rest.strip_prefix("\"format\"")?.trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    Some(rest[..rest.find('"')?].to_string())
}

/// The JSON files of a fixture directory, classified by their peeked `format`. Discovery is loud: a `*.json` file that
/// is neither a scenario nor the pathfinding fixture lands in `unrecognised`, and every gate entry point fails on it,
/// so a fixture can never leave the gate (or a stray file join it) without a word.
#[derive(Debug, Default)]
pub struct FixtureFiles {
    /// Format [`SCENARIO_FORMAT`], sorted by name.
    pub scenarios: Vec<PathBuf>,
    /// Format [`PATHFINDING_FORMAT`], sorted by name.
    pub pathfinding: Vec<PathBuf>,
    /// Every other `*.json` file, with the format it declares (`None`: no leading `format` key).
    pub unrecognised: Vec<(PathBuf, Option<String>)>,
}

impl FixtureFiles {
    /// One line per unrecognised file (empty when discovery is clean).
    pub fn problems(&self) -> Vec<String> {
        self.unrecognised
            .iter()
            .map(|(p, f)| match f {
                None => format!(
                    "{}: no leading \"format\" key: not a fixture this harness knows",
                    p.display()
                ),
                Some(f) => format!(
                    "{}: format {f:?} is neither {SCENARIO_FORMAT} nor {PATHFINDING_FORMAT}",
                    p.display()
                ),
            })
            .collect()
    }
}

/// Classifies every `*.json` file of `dir` by its peeked format (see [`FixtureFiles`]).
pub fn discover(dir: &Path) -> FixtureFiles {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    let mut out = FixtureFiles::default();
    for p in paths {
        match peek_format(&p) {
            Some(f) if f == SCENARIO_FORMAT => out.scenarios.push(p),
            Some(f) if f == PATHFINDING_FORMAT => out.pathfinding.push(p),
            f => out.unrecognised.push((p, f)),
        }
    }
    out
}

/// Every scenario fixture (`format` = [`SCENARIO_FORMAT`]) in parity/fixtures, sorted by name. Panics when the directory
/// holds any other JSON file than scenarios and the pathfinding fixture ([`discover`]), so nothing drops out silently.
pub fn scenario_paths() -> Vec<PathBuf> {
    let files = discover(&fixtures_dir());
    let bad = files.problems();
    assert!(
        bad.is_empty(),
        "unrecognised files in parity/fixtures:\n  {}",
        bad.join("\n  ")
    );
    files.scenarios
}

/// Every scenario fixture of the given parity class, sorted by name (each file parsed once).
pub fn scenarios(class: &str) -> Vec<Fixture> {
    scenario_paths()
        .iter()
        .map(|p| load(p))
        .filter(|f| f.parity == class)
        .collect()
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

/// The `msg` keys each slice input type may carry: [`raw_command`] reads exactly these, so any other key (a future
/// `charge` on an attack) is reported by [`unread_msg_keys`] instead of being dropped without a word.
pub const INPUT_MSG_KEYS: [(&str, &[&str]); 5] = [
    ("move", &["x", "y", "seq"]),
    ("stop", &["seq"]),
    ("aim", &["a"]),
    ("attack", &["a", "t"]),
    ("release", &["a", "t"]),
];

/// The keys of a slice input's `msg` that [`raw_command`] does not read (a non-object `msg` reports `<not an object>`).
/// Empty for an input type outside the slice (that input fails on its own).
pub fn unread_msg_keys(i: &FixInput) -> Vec<String> {
    let Some((_, keys)) = INPUT_MSG_KEYS.iter().find(|(k, _)| *k == i.kind) else {
        return Vec::new();
    };
    match i.msg.as_object() {
        None => vec!["<not an object>".into()],
        Some(m) => m
            .keys()
            .filter(|k| !keys.contains(&k.as_str()))
            .cloned()
            .collect(),
    }
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

// ---------------------------------------------------------------------------------------------------------------------
// Per-entity projection tables

/// How a projected value is compared with the legacy one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tol {
    /// Exactly equal (strings, flags, counts).
    Exact,
    /// Within [`TOL`] absolute.
    Abs,
    /// Within [`TOL`] on the circle (angles).
    Angle,
}

/// Which error statistic of the [`Report`] a key feeds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrStat {
    None,
    Pos,
    Hp,
}

/// A projected Rust value.
pub enum Got {
    Num(f64),
    Str(&'static str),
}

/// One compared key of an entity kind: the legacy key, how to read the Rust value, and how to compare.
pub struct Field<E> {
    pub key: &'static str,
    pub tol: Tol,
    pub stat: ErrStat,
    pub get: fn(&E) -> Got,
}

/// An entity kind of the per-tick state: its `FixTick` list name, its identity key and its projection table.
pub struct EntityKind<E: 'static> {
    pub name: &'static str,
    pub id_key: &'static str,
    /// Every Rust entity of this kind, in any order.
    pub all: fn(&Sim) -> &[E],
    /// Whether a Rust entity has the legacy id.
    pub is: fn(&E, &str) -> bool,
    pub fields: &'static [Field<E>],
}

/// The players table: every key capture.ts records per player per tick.
pub const PLAYERS: EntityKind<Player> = EntityKind {
    name: "players",
    id_key: "id",
    all: |s| s.players(),
    is: |p, id| p.id == pid(id),
    fields: &[
        Field {
            key: "x",
            tol: Tol::Abs,
            stat: ErrStat::Pos,
            get: |p| Got::Num(p.body.x),
        },
        Field {
            key: "y",
            tol: Tol::Abs,
            stat: ErrStat::Pos,
            get: |p| Got::Num(p.body.y),
        },
        Field {
            key: "facing",
            tol: Tol::Angle,
            stat: ErrStat::None,
            get: |p| Got::Num(p.body.facing),
        },
        Field {
            key: "hp",
            tol: Tol::Abs,
            stat: ErrStat::Hp,
            get: |p| Got::Num(p.vitals.hp),
        },
        Field {
            key: "status",
            tol: Tol::Exact,
            stat: ErrStat::None,
            get: |p| Got::Str(status_str(p.status)),
        },
        Field {
            key: "readyAt",
            tol: Tol::Abs,
            stat: ErrStat::None,
            get: |p| Got::Num(p.weapon.ready_at),
        },
    ],
};

/// Every key an entity kind compares (for `notCompared` validation).
fn ported<E>(kind: &EntityKind<E>) -> impl Iterator<Item = String> + '_ {
    std::iter::once(kind.id_key)
        .chain(kind.fields.iter().map(|f| f.key))
        .map(|k| format!("{}.{k}", kind.name))
}

/// Compares one tick's legacy entity list of one kind with the Rust entities.
fn compare_entities<E>(
    rep: &mut Report,
    unported: &mut BTreeSet<String>,
    not_compared: &BTreeSet<&str>,
    sim: &Sim,
    tick: u32,
    kind: &EntityKind<E>,
    legacy: &[Entity],
) {
    let ours = (kind.all)(sim);
    if ours.len() != legacy.len() {
        rep.fail(format!(
            "tick {tick}: {} {} vs legacy {}",
            ours.len(),
            kind.name,
            legacy.len()
        ));
    }
    for le in legacy {
        let Some(id) = le.get(kind.id_key).and_then(Value::as_str) else {
            rep.fail(format!(
                "tick {tick}: legacy {} entry without a string `{}`",
                kind.name, kind.id_key
            ));
            continue;
        };
        // Legacy keys the harness does not read: refused unless deliberately listed.
        for k in le.keys() {
            if k != kind.id_key && !kind.fields.iter().any(|f| f.key == k) {
                let q = format!("{}.{k}", kind.name);
                if !not_compared.contains(q.as_str()) && unported.insert(q.clone()) {
                    rep.fail(format!(
                        "unported key {q}: the legacy fixture records it and no projection compares it (port it, or list it in notCompared)"
                    ));
                }
            }
        }
        let Some(re) = ours.iter().find(|e| (kind.is)(e, id)) else {
            rep.fail(format!("tick {tick}: {} {id} missing", kind.name));
            continue;
        };
        for f in kind.fields {
            let Some(lv) = le.get(f.key) else {
                rep.fail(format!(
                    "tick {tick} {id}: legacy {} entry lacks the compared key {}",
                    kind.name, f.key
                ));
                continue;
            };
            let ok = match ((f.get)(re), lv) {
                (Got::Num(r), Value::Number(n)) => {
                    let l = n.as_f64().unwrap_or(f64::NAN);
                    match f.stat {
                        ErrStat::Pos => rep.max_pos_err = rep.max_pos_err.max((r - l).abs()),
                        ErrStat::Hp => rep.max_hp_err = rep.max_hp_err.max((r - l).abs()),
                        ErrStat::None => {}
                    }
                    match f.tol {
                        Tol::Abs => close(r, l),
                        Tol::Angle => angle_close(r, l),
                        Tol::Exact => r == l,
                    }
                }
                (Got::Str(r), Value::String(l)) => r == l,
                _ => false,
            };
            if !ok {
                let r = match (f.get)(re) {
                    Got::Num(v) => v.to_string(),
                    Got::Str(s) => s.to_string(),
                };
                rep.fail(format!("tick {tick} {id}: {} {r} vs legacy {lv}", f.key));
            }
        }
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

/// The legacy configuration a fixture was captured under, checked against what the Rust harness reproduces. Every key
/// the harness does not replay is asserted here, so a fixture captured under another configuration fails instead of
/// comparing something else. `sim` is the freshly built sim ([`build`]).
pub fn preconditions(fx: &Fixture, sim: &Sim) -> Vec<String> {
    let mut bad = Vec::new();
    let c = &fx.legacy_config;
    let mut need = |ok: bool, what: String| {
        if !ok {
            bad.push(format!("precondition: {what}"));
        }
    };
    need(
        fx.format == SCENARIO_FORMAT,
        format!("format {} is not {SCENARIO_FORMAT}", fx.format),
    );
    need(
        PARITY_CLASSES.contains(&fx.parity.as_str()),
        format!(
            "parity class {} is not one of {PARITY_CLASSES:?}",
            fx.parity
        ),
    );
    need(
        c.world == CAPTURE_WORLD,
        format!(
            "legacyConfig.world {:?} is not the slice configuration",
            c.world
        ),
    );
    need(
        c.tick_ms == rh_sim::constants::TICK_MS,
        format!("tickMs {} != {}", c.tick_ms, rh_sim::constants::TICK_MS),
    );
    need(
        c.start_tick == 1,
        format!("startTick {} != 1", c.start_tick),
    );
    need(
        c.start_server_time == c.start_tick as f64 * c.tick_ms,
        format!(
            "startServerTime {} != startTick x tickMs",
            c.start_server_time
        ),
    );
    need(
        c.mobs_present == 0,
        format!(
            "mobsPresent {} != 0 (mobs are not in the slice)",
            c.mobs_present
        ),
    );
    need(
        c.start_events == ["raidStarted"],
        format!("startEvents {:?} != [raidStarted]", c.start_events),
    );
    need(
        c.unexpected_event_types.is_empty(),
        format!(
            "unexpectedEventTypes {:?} is not empty",
            c.unexpected_event_types
        ),
    );
    let m = &fx.map;
    need(
        m.tile == rh_sim::constants::TILE,
        format!("map.tile {} != {}", m.tile, rh_sim::constants::TILE),
    );
    need(
        m.h == m.rows.len() && m.rows.iter().all(|r| r.len() == m.w),
        format!("map is not {}x{} rows", m.w, m.h),
    );
    need(
        fx.ticks.first().map(|t| t.tick) == Some(c.start_tick + 1)
            && fx.ticks.windows(2).all(|w| w[1].tick == w[0].tick + 1),
        "ticks are not consecutive from startTick + 1".into(),
    );
    for p in &fx.players {
        let Some(rp) = sim.players().iter().find(|r| r.id == pid(&p.id)) else {
            need(false, format!("player {} not placed", p.id));
            continue;
        };
        need(
            rp.vitals.max_hp == p.max_hp,
            format!(
                "{} maxHp {} != the faction's {} ({})",
                p.id, p.max_hp, rp.vitals.max_hp, p.faction
            ),
        );
        let w0 = (!p.weapon0.is_empty()).then(|| WeaponId::parse(&p.weapon0));
        need(
            match w0 {
                None => rp.weapon.weapon0.is_none(),
                Some(w) => w.is_some() && rp.weapon.weapon0 == w,
            },
            format!(
                "{} weapon0 {:?} is not applied (the Rust player carries {:?})",
                p.id, p.weapon0, rp.weapon.weapon0
            ),
        );
    }
    for k in &fx.not_compared {
        let ported_key = ported(&PLAYERS).any(|q| &q == k);
        need(
            !ported_key && k.split_once('.').is_some(),
            format!("notCompared {k:?} must be <kind>.<key> and not a compared key"),
        );
    }
    bad
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
    for m in preconditions(fx, &sim) {
        rep.fail(m);
    }
    let not_compared: BTreeSet<&str> = fx.not_compared.iter().map(String::as_str).collect();
    let mut unported = BTreeSet::new();
    let mut inputs = fx.inputs.iter().peekable();
    let mut rust_results: Vec<(u32, PlayerId, rh_sim::RunResult)> = Vec::new();
    for t in &fx.ticks {
        while let Some(i) = inputs.peek() {
            if i.tick > t.tick {
                break;
            }
            let i = inputs.next().unwrap();
            for k in unread_msg_keys(i) {
                rep.fail(format!(
                    "tick {}: input {} msg key {k} is not read by the harness",
                    i.tick, i.kind
                ));
            }
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
        apply_actions(&mut sim, fx, t.tick);
        // Events emitted between steps (a leave's MIA result) travel with the NEXT step's events, as in legacy.
        let all: Vec<Event> = events;
        rep.ticks += 1;
        if sim.tick() != t.tick || !close(sim.server_time(), t.server_time) {
            rep.fail(format!(
                "clock: rust tick {} t {} vs legacy tick {} t {}",
                sim.tick(),
                sim.server_time(),
                t.tick,
                t.server_time
            ));
        }
        compare_entities(
            &mut rep,
            &mut unported,
            &not_compared,
            &sim,
            t.tick,
            &PLAYERS,
            &t.players,
        );
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

/// Applies the fixture's out-of-band actions recorded after the step of `tick` (as the legacy Room applies them between
/// steps).
pub fn apply_actions(sim: &mut Sim, fx: &Fixture, tick: u32) {
    for a in fx.actions.iter().filter(|a| a.tick == tick) {
        let p = pid(&a.player);
        match a.kind.as_str() {
            "remove" => sim.remove_player(p),
            "drop" => sim.mark_dropped(p, true),
            "reconnect" => sim.mark_dropped(p, false),
            other => panic!("unknown fixture action {other}"),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PathFixture {
    pub format: String,
    pub legacy_revision: String,
    pub seed: u32,
    pub attempt: u32,
    #[serde(rename = "mapHashU32")]
    pub map_hash: u32,
    pub map: FixMap,
    pub radius: f64,
    pub queries: Vec<PathQuery>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathQuery {
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub path: Vec<[f64; 2]>,
}

/// Loads the pathfinding fixture and its map.
pub fn load_paths(path: &Path) -> (PathFixture, TileMap) {
    let text = std::fs::read_to_string(path).expect("pathfinding fixture");
    let fx: PathFixture = serde_json::from_str(&text).expect("pathfinding json");
    assert_eq!(fx.format, PATHFINDING_FORMAT, "{}", path.display());
    let map = TileMap::from_rows(&fx.map.rows).expect("map");
    (fx, map)
}

/// Whether a Rust path equals the legacy waypoints (within [`TOL`]).
pub fn same_path(got: &[Vec2], want: &[[f64; 2]]) -> bool {
    got.len() == want.len()
        && got
            .iter()
            .zip(want)
            .all(|(g, w)| close(g.x, w[0]) && close(g.y, w[1]))
}

/// Replays the legacy findPath queries; returns (queries, mismatches).
pub fn compare_paths(path: &Path) -> (usize, Vec<String>) {
    let (fx, map) = load_paths(path);
    let mut pf = rh_sim::pathfind::Pathfinder::default();
    let mut bad = Vec::new();
    for (k, q) in fx.queries.iter().enumerate() {
        let got = pf.find_path(
            &map,
            Vec2::new(q.from[0], q.from[1]),
            Vec2::new(q.to[0], q.to[1]),
            fx.radius,
        );
        if !same_path(&got, &q.path) && bad.len() < 10 {
            bad.push(format!(
                "query {k}: rust {:?} vs legacy {:?}",
                got.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>(),
                q.path
            ));
        }
    }
    (fx.queries.len(), bad)
}
