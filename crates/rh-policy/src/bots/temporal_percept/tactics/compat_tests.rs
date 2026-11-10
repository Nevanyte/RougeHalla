//! Compatibility-overlap replay of the IMMUTABLE admitted legacy corpora through the NEW private tactics layer.
//!
//! `parity/policy/bot-fight/source.json` and `parity/policy/bot-reflex/source.json` were captured from the same legacy
//! source generation the private layer ports: the bot-fight profile pins
//! `tactics/fight.ts = 10a9aeb4…`, `tactics/kite.ts = b7ceff48…`, `tactics.ts = 64804de4…` and `types.ts = 12b3cae0…`,
//! exactly the hashes of the current source files, and the bot-reflex profile pins base
//! `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`. These corpora are therefore exact compatibility expectations for the new
//! private implementations: this module replays the declared legacy rows through the real private classes (never the old
//! component APIs) and compares the captured answers afterwards. It is overlap evidence, NOT new unified coverage, and
//! its row counts are reported as such.
//!
//! Property-order note: these legacy corpora are plain untagged JSON whose captured objects were serialized with a
//! canonical sorted-key order (every captured object is alphabetical, e.g. `{attacking,intents,status}` and
//! `{at,kind,priority,target,timing,why}`), so JSON property order is a serialization artifact here, not carried source
//! insertion order. Their comparisons therefore use `CompareCtx.ordered = false`: consumed key SETS, array/Map/Set order,
//! exact values and identities remain compared, but plain-JSON property order is the one documented exclusion for this
//! separate compatibility path. The frozen tagged MethodValue witness retains full ordered tagged comparison (its codec
//! preserves `Object.keys` order), and the only main-corpus key-set exclusion remains plain `drawCounts`.
//! Every old payload is plain untagged JSON; `source_decode::{decode_plain_json, decode_percept_plain}` is the admitted
//! plain-to-source bridge (already verified against these corpora), so the old Percepts feed the same native Percept
//! decoder as the frozen private witness. The old `memory` channel in bot-reflex is NOT installed as reflex input: it is
//! first re-derived with the real admitted private `Memory` and compared (see section E).
//!
//! Sections:
//! - A `private_tactics_compat_timings`: bot-fight `timings`/`unavailableTiming` through `kite::own_timings`.
//! - B `private_tactics_compat_orbs`: bot-fight `orbs` through the private `OrbWalk`, real tier/Memory/Knowledge/paths/RNG.
//! - C `private_tactics_compat_fight`: bot-fight `directFight` through the real private `Fight`.
//! - D `private_tactics_compat_cases`: bot-fight `cases` through the real private `Tactics` (result/stats/paths/pathStats/
//!   budget/streams, plus the old `normalReflex` overlap boundary).
//! - E `private_tactics_compat_reflex`: bot-reflex `cases` through the real private `Reflexes`, with the declared
//!   Memory.observe outputs re-derived through the real admitted private `Memory`.

use std::path::Path;

use serde_json::Value;

use rh_sim::map::tile_to_world_center;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

use super::fight::Fight;
use super::kite::{OrbFoe, OrbStep, OrbWalk, Reflexes, Retreat};
use super::source_decode::{decode_percept_plain, decode_plain_json, OpEnv, Suite};
use super::source_reader::{self, SVal};
use super::source_trace::{
    arr, compare_result, encode_intent, encode_stimuli, encode_tactics_stats, n, null, obj, s,
    CompareCtx, RecordedKnowledge, RecordedMemory, RecordedPaths, TraceDecide, TraceHandle,
    TraceLog, GEOMETRY_TOLERANCE,
};
use super::types::{
    ContainersWeapon, FightKind, FightRef, Goal, HoldWhy, Presence, RngStream, RoamWhy,
    TacticPercept, TacticSelf, TacticsConfig, TacticsContext, TacticsMap,
};
use super::Tactics;
use crate::bots::knowledge::Knowledge;
use crate::bots::paths::{PathBudget, RoomPathService};
use crate::bots::random::{derive, Rng};
use crate::bots::types::{PersonaId, PersonaParams, TierId, TierParams};
use crate::bots::view::Features;

// ------------------------------------------------------------------------------------------------------------ corpus IO

fn load_corpus(relative: &str) -> (Value, usize) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let bytes = text.len();
    let value: Value = serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{}: invalid JSON: {error}", path.display()));
    (value, bytes)
}

/// The admitted bot-fight compatibility corpus, byte- and source-pin asserted to be the same generation as the private
/// tactics sources (fight.ts/kite.ts/tactics.ts/types.ts hashes below are the current source hashes).
fn fight_corpus() -> Value {
    let (value, bytes) = load_corpus("parity/policy/bot-fight/source.json");
    assert_eq!(bytes, 467_672, "bot-fight admitted corpus byte length");
    assert_eq!(value["format"], "rh-bot-fight-source/1");
    assert_eq!(
        value["profile"]["sourceSha256"]["packages/server/src/bots/brain/tactics/fight.ts"],
        "10a9aeb45b69c9635072213fefbcfe7aa40fd113773f7cf2b254594ae8204a50"
    );
    assert_eq!(
        value["profile"]["sourceSha256"]["packages/server/src/bots/brain/tactics/kite.ts"],
        "b7ceff483d51fe1d58d79ef34562e28a079027623527f11264c21439c2b6e2be"
    );
    assert_eq!(
        value["profile"]["sourceSha256"]["packages/server/src/bots/brain/tactics.ts"],
        "64804de4b29e87fdc12bdf7e2df65d69573293c7db5fdae08c6c11dcc4ae08ef"
    );
    assert_eq!(
        value["profile"]["sourceSha256"]["packages/server/src/bots/brain/types.ts"],
        "12b3cae05bcde760cd642b9c5eb9919bfc47189882c81258994c9f1122d3d361"
    );
    value
}

/// The admitted bot-reflex compatibility corpus (base-pinned captured legacy source generation).
fn reflex_corpus() -> Value {
    let (value, bytes) = load_corpus("parity/policy/bot-reflex/source.json");
    assert_eq!(bytes, 401_512, "bot-reflex admitted corpus byte length");
    assert_eq!(value["format"], "rh-bot-reflex-source/1");
    assert_eq!(
        value["profile"]["base"],
        "a0c4818ce9df8ad0f4124db31e65ba1244bddc3b"
    );
    value
}

fn tier_of(value: &Value) -> TierParams {
    *TierParams::by_id(TierId::parse(value.as_str().expect("declared tier name")).expect("tier"))
}

fn persona_of(value: &Value) -> PersonaParams {
    *PersonaParams::by_id(
        PersonaId::parse(value.as_str().expect("declared persona name")).expect("persona"),
    )
}

fn leak_tier(tier: TierParams) -> &'static TierParams {
    Box::leak(Box::new(tier))
}

fn tile_map_from(map: &Value) -> TileMap {
    let w = map["w"].as_u64().expect("declared map w") as u32;
    let h = map["h"].as_u64().expect("declared map h") as u32;
    let tiles: Vec<u8> = map["tiles"]
        .as_array()
        .expect("declared map tiles")
        .iter()
        .map(|tile| tile.as_u64().expect("declared tile") as u8)
        .collect();
    TileMap::new(w, h, tiles).expect("declared compatible map")
}

fn tactics_map_from(map: &Value) -> TacticsMap {
    let width = map["w"].as_u64().expect("declared map w") as u32;
    let height = map["h"].as_u64().expect("declared map h") as u32;
    TacticsMap {
        tile_map: tile_map_from(map),
        width,
        height,
        region_grid: vec![0; (width * height) as usize],
        coliseum_centre: Vec2::new(
            tile_to_world_center(i64::from(width / 2)),
            tile_to_world_center(i64::from(height / 2)),
        ),
        camps: Vec::new(),
    }
}

fn config(
    tier: TierParams,
    persona: PersonaParams,
    seed: u32,
    map: &Value,
    features: Features,
) -> TacticsConfig {
    TacticsConfig {
        id: "p0".to_string(),
        name: "declared owner".to_string(),
        seed,
        tier,
        persona,
        map: tactics_map_from(map),
        features,
        path_budget: 3,
        path: None,
    }
}

fn new_memory(
    self_id: &str,
    tier: &'static TierParams,
    features: Features,
) -> super::super::memory::Memory {
    super::super::memory::Memory::new(super::super::memory::MemoryConfig {
        self_id: self_id.to_string(),
        tier,
        map: super::super::memory::MemoryMap { camps: Vec::new() },
        features,
    })
    .expect("admitted private Memory config")
}

fn new_knowledge(tier: &TierParams, seed: u32) -> Knowledge {
    Knowledge::create(tier, &mut Rng::new(derive(seed, 3)))
}

fn new_paths(map: &TileMap, map_value: &Value, trace: &TraceHandle) -> RecordedPaths {
    RecordedPaths {
        inner: RoomPathService::new(map, PathBudget::new(3)),
        env: OpEnv::default(),
        map_value: decode_plain_json(map_value),
        trace: trace.clone(),
    }
}

/// The old harness's per-frame path-service begin: a fresh budget tick and the frame clock/gate.
fn begin_paths(paths: &mut RecordedPaths, percept: &TacticPercept) {
    paths.inner.budget_mut().start_tick();
    paths.inner.set_frame(percept.now, percept.hud.gates_locked);
}

/// The admitted decide stream, recording the exact forwarded values in addition to the shared trace.
struct RecordingDecide {
    inner: TraceDecide,
    values: Vec<f64>,
}
impl RecordingDecide {
    fn new(seed: u32, trace: &TraceHandle) -> Self {
        Self {
            inner: TraceDecide::new(seed, trace.clone()),
            values: Vec::new(),
        }
    }
    fn draws(&self) -> usize {
        self.values.len()
    }
}
impl RngStream for RecordingDecide {
    fn draw(&mut self) -> f64 {
        let value = self.inner.draw();
        self.values.push(value);
        value
    }
}

// ------------------------------------------------------------------------------------- plain percept -> Memory percept

fn memory_percept(percept: &TacticPercept) -> super::super::memory::source_input::MemoryPercept {
    use super::super::memory::source_input::{
        MemoryPercept, PerceptContainer, PerceptEventRow, PerceptFighter, PerceptMinimap,
        PerceptMinimapMob, PerceptMob, PerceptProjectile, PerceptSelf, PerceptWeapon,
    };
    MemoryPercept {
        now: percept.now,
        view_t: percept.view_t,
        self_: PerceptSelf {
            id: percept.self_.id.clone(),
            name: percept.self_.name.clone(),
            x: percept.self_.x,
            y: percept.self_.y,
            facing: percept.self_.facing,
            status: percept.self_.status.clone(),
            hp: percept.self_.hp,
            max_hp: percept.self_.max_hp,
            attack_target: percept.self_.attack_target.clone(),
            move_seq: percept.self_.move_seq,
        },
        hud_in_coliseum: percept.hud.in_coliseum,
        fighters: percept
            .fighters
            .iter()
            .map(|fighter| PerceptFighter {
                id: fighter.id.clone(),
                name: fighter.name.clone(),
                bot: fighter.bot,
                x: fighter.x,
                y: fighter.y,
                facing: fighter.facing,
                status: fighter.status.clone(),
                hp_frac: fighter.hp_frac,
                faction: fighter.faction,
                in_hand: fighter.in_hand,
                draw_started_at: fighter.draw_started_at,
                bounty: fighter.bounty,
                vx: fighter.vx,
                vy: fighter.vy,
            })
            .collect(),
        mobs: percept
            .mobs
            .iter()
            .map(|mob| PerceptMob {
                id: mob.id.clone(),
                kind: mob.kind.clone(),
                name: mob.name.clone(),
                type_: mob.type_.clone(),
                faction: mob.faction,
                x: mob.x,
                y: mob.y,
                status: mob.status.clone(),
                hp_frac: mob.hp_frac,
                in_hand: mob.in_hand,
            })
            .collect(),
        containers: percept
            .containers
            .iter()
            .map(|container| PerceptContainer {
                id: container.id.clone(),
                kind: container.kind.clone(),
                x: container.x,
                y: container.y,
                closed: container.closed,
                weapon: match container.weapon {
                    ContainersWeapon::Undefined => PerceptWeapon::Undefined,
                    ContainersWeapon::Null => PerceptWeapon::Null,
                    ContainersWeapon::Weapon(weapon) => PerceptWeapon::Weapon(weapon),
                },
            })
            .collect(),
        projectiles: percept
            .projectiles
            .iter()
            .map(|projectile| PerceptProjectile {
                id: projectile.id.clone(),
                kind: projectile.kind.as_str().to_string(),
                x: projectile.x,
                y: projectile.y,
                vx: projectile.vx,
                vy: projectile.vy,
                x0: projectile.x0,
                y0: projectile.y0,
                t0: projectile.t0,
                range: projectile.range,
                from: projectile.from.clone(),
            })
            .collect(),
        minimap: PerceptMinimap {
            t: percept.minimap.t,
            mobs: percept
                .minimap
                .mobs
                .iter()
                .map(|dot| PerceptMinimapMob {
                    id: dot.id.clone(),
                    x: dot.x,
                    y: dot.y,
                    faction: dot.faction,
                    elite: dot.elite,
                })
                .collect(),
        },
        events: percept
            .events
            .iter()
            .map(|event| PerceptEventRow {
                t: event.t,
                at: event.at,
                kind: memory_event(&event.kind),
            })
            .collect(),
        extras: percept.extras.clone(),
        features: percept.features.clone(),
    }
}

fn memory_event(
    kind: &super::types::TacticEventKind,
) -> super::super::memory::source_input::PerceptEvent {
    use super::super::memory::source_input::PerceptEvent;
    use super::types::TacticEventKind;
    match kind {
        TacticEventKind::Windup { by, weapon, a, ms } => PerceptEvent::Windup {
            by: by.clone(),
            weapon: *weapon,
            a: *a,
            ms: *ms,
        },
        TacticEventKind::Swing { by, weapon, a } => PerceptEvent::Swing {
            by: by.clone(),
            weapon: *weapon,
            a: *a,
        },
        TacticEventKind::Hit {
            id,
            by,
            amount,
            weapon,
            sig: _,
        } => PerceptEvent::Hit {
            id: id.clone(),
            by: by.clone(),
            amount: *amount,
            weapon: *weapon,
        },
        TacticEventKind::Block { id, by, weapon } => PerceptEvent::Block {
            id: id.clone(),
            by: by.clone(),
            weapon: *weapon,
        },
        TacticEventKind::Stagger { id } => PerceptEvent::Stagger { id: id.clone() },
        TacticEventKind::Cancel { id } => PerceptEvent::Cancel { id: id.clone() },
        TacticEventKind::ProjEnd { id, .. } => PerceptEvent::ProjEnd { id: id.clone() },
        TacticEventKind::Death { id, name, by, mob } => PerceptEvent::Death {
            id: id.clone(),
            name: name.clone(),
            by: by.clone(),
            mob: *mob,
        },
        TacticEventKind::Heal { id, .. } => PerceptEvent::Heal { id: id.clone() },
        TacticEventKind::Teleport => PerceptEvent::Teleport,
        TacticEventKind::Bounty { id, name, bounty } => PerceptEvent::Bounty {
            id: id.clone(),
            name: name.clone(),
            bounty: *bounty,
        },
        TacticEventKind::Victory { id, name, draw } => PerceptEvent::Victory {
            id: id.clone(),
            name: name.clone(),
            draw: *draw,
        },
        TacticEventKind::Toast { text } => PerceptEvent::Toast { text: text.clone() },
        TacticEventKind::Result => PerceptEvent::Result,
        TacticEventKind::Private { type_, .. } => PerceptEvent::Private {
            type_: type_.clone(),
        },
        TacticEventKind::Ext { fx, data } => PerceptEvent::Ext {
            fx: fx.clone(),
            data: data.clone(),
        },
    }
}

// ------------------------------------------------------------------------------------------------- plain goal / values

fn method_value_from_plain(value: &Value) -> super::super::data::MethodValue {
    use super::super::data::MethodValue;
    match value {
        Value::Null => MethodValue::Null,
        Value::Bool(flag) => MethodValue::Bool(*flag),
        Value::Number(number) => MethodValue::Num(number.as_f64().expect("finite plain number")),
        Value::String(text) => MethodValue::Str(text.clone()),
        Value::Array(items) => {
            MethodValue::Arr(items.iter().map(method_value_from_plain).collect())
        }
        Value::Object(fields) => MethodValue::Obj(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), method_value_from_plain(value)))
                .collect(),
        ),
    }
}

fn plain_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("declared goal field {key}: {value}"))
        .to_string()
}

fn plain_vec(value: &Value) -> Vec2 {
    Vec2::new(
        value["x"].as_f64().expect("point x"),
        value["y"].as_f64().expect("point y"),
    )
}

fn goal_from_plain(value: &Value) -> Goal {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("declared goal kind: {value}"));
    match kind {
        "idle" => Goal::Idle,
        "farm" => Goal::Farm {
            mob: plain_text(value, "mob"),
            camp: value.get("camp").and_then(Value::as_str).map(str::to_owned),
        },
        "hunt" => Goal::Hunt {
            target: plain_text(value, "target"),
        },
        "fight" => Goal::Fight {
            target: plain_text(value, "target"),
        },
        "loot" => Goal::Loot {
            container: plain_text(value, "container"),
        },
        "flee" => Goal::Flee {
            from: value["from"]
                .as_array()
                .expect("declared flee from")
                .iter()
                .map(plain_vec)
                .collect(),
            until: value["until"].as_f64().expect("declared flee until"),
        },
        "roam" => Goal::Roam {
            to: plain_vec(&value["to"]),
            why: match plain_text(value, "why").as_str() {
                "explore" => RoamWhy::Explore,
                "camp" => RoamWhy::Camp,
                "lastSeen" => RoamWhy::LastSeen,
                "coliseum" => RoamWhy::Coliseum,
                "centre" => RoamWhy::Centre,
                other => panic!("declared roam why {other}"),
            },
        },
        "hold" => Goal::Hold {
            at: plain_vec(&value["at"]),
            why: match plain_text(value, "why").as_str() {
                "coliseum" => HoldWhy::Coliseum,
                "ambush" => HoldWhy::Ambush,
                "wait" => HoldWhy::Wait,
                other => panic!("declared hold why {other}"),
            },
        },
        "module" => Goal::Module {
            module: plain_text(value, "module"),
            data: method_value_from_plain(&value["data"]),
        },
        other => panic!("declared goal kind {other}"),
    }
}

/// The declared hold/roam destination of a goal (its move point compares exact, not as derived geometry).
fn goal_declared_point(goal: &Goal) -> Option<Vec2> {
    match goal {
        Goal::Roam { to, .. } => Some(*to),
        Goal::Hold { at, .. } => Some(*at),
        _ => None,
    }
}

fn fight_kind(name: &str) -> FightKind {
    match name {
        "farm" => FightKind::Farm,
        "hunt" => FightKind::Hunt,
        "fight" => FightKind::Fight,
        other => panic!("declared FightRef kind {other}"),
    }
}

// ------------------------------------------------------------------------------------------------- comparison helpers

fn field<'a>(fields: &'a [(String, SVal)], name: &str) -> Option<&'a SVal> {
    fields.iter().find(|(key, _)| key == name).map(|(_, v)| v)
}

fn sval_point(value: &SVal) -> Option<(f64, f64)> {
    let SVal::Obj(fields) = value else {
        return None;
    };
    if fields.len() != 2 {
        return None;
    }
    match (field(fields, "x")?, field(fields, "y")?) {
        (SVal::Num(x), SVal::Num(y)) => Some((*x, *y)),
        _ => None,
    }
}

fn plain_point(value: &Value) -> Option<(f64, f64)> {
    let object = value.as_object()?;
    Some((object.get("x")?.as_f64()?, object.get("y")?.as_f64()?))
}

fn expect_same(label: &str, expected: &Value, actual: &SVal, failures: &mut Vec<String>) {
    let expected = decode_plain_json(expected);
    if !source_reader::same(&expected, actual) {
        failures.push(format!("{label}: expected {expected:?} actual {actual:?}"));
    }
}

/// Compare a plain `{x,y}` against the recorded point: exact bits, with the reviewed 2e-6 derivation allowance when the
/// expected value is a derived geometry leaf.
fn expect_point(
    label: &str,
    expected: &Value,
    actual: &SVal,
    tolerance: bool,
    max: &mut f64,
    failures: &mut Vec<String>,
) {
    let (Some((expected_x, expected_y)), Some((actual_x, actual_y))) =
        (plain_point(expected), sval_point(actual))
    else {
        failures.push(format!(
            "{label}: expected a plain point, actual {actual:?}"
        ));
        return;
    };
    for (axis, expected, actual) in [("x", expected_x, actual_x), ("y", expected_y, actual_y)] {
        let difference = (expected - actual).abs();
        *max = max.max(difference);
        if expected.to_bits() != actual.to_bits()
            && !(tolerance && difference <= GEOMETRY_TOLERANCE)
        {
            failures.push(format!(
                "{label}.{axis}: expected {expected} bits {:016x} actual {actual} bits {:016x}",
                expected.to_bits(),
                actual.to_bits()
            ));
        }
    }
}

fn plain_geometry(value: &Value) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            (key == "why"
                && value
                    .as_str()
                    .is_some_and(super::source_trace::geometry_why))
                || plain_geometry(value)
        }),
        Value::Array(values) => values.iter().any(plain_geometry),
        _ => false,
    }
}

/// Compare one declared decide stream row channel (`{seed,count,draws,nextFromIndependentReplay}`) with the recorded
/// cumulative draws and a fresh independent replay.
fn check_decide_stream(
    label: &str,
    seed: u32,
    actual: &[f64],
    expected: &Value,
    failures: &mut Vec<String>,
) {
    assert_eq!(
        expected["seed"].as_u64().expect("series seed") as u32,
        seed,
        "{label}: declared decide seed"
    );
    let draws = expected["draws"].as_array().expect("series draws");
    let count = expected["count"].as_u64().expect("series count") as usize;
    if draws.len() != count {
        failures.push(format!(
            "{label}: declared count {count} != draws {}",
            draws.len()
        ));
    }
    if actual.len() != count {
        failures.push(format!(
            "{label}: actual decide draws {} != expected {count}",
            actual.len()
        ));
    }
    let mut replay = Rng::new(seed);
    for (index, declared) in draws.iter().enumerate() {
        let declared = declared.as_f64().expect("declared draw");
        let replayed = replay.next_f64();
        if replayed.to_bits() != declared.to_bits() {
            failures.push(format!(
                "{label}: independent replay draw {index} expected bits {:016x} actual {:016x}",
                declared.to_bits(),
                replayed.to_bits()
            ));
        }
        if let Some(value) = actual.get(index) {
            if value.to_bits() != declared.to_bits() {
                failures.push(format!(
                    "{label}: actual decide draw {index} expected {declared} bits {:016x} actual {value} bits {:016x}",
                    declared.to_bits(),
                    value.to_bits()
                ));
            }
        }
    }
    let next = replay.next_f64();
    let expected_next = expected["nextFromIndependentReplay"]
        .as_f64()
        .expect("series next value");
    if next.to_bits() != expected_next.to_bits() {
        failures.push(format!(
            "{label}: next decide value expected bits {:016x} actual bits {:016x}",
            expected_next.to_bits(),
            next.to_bits()
        ));
    }
}

fn finish(test: &str, summary: String, failures: Vec<String>) {
    eprintln!("{test}: {summary} / {} failures", failures.len());
    if !failures.is_empty() {
        for failure in failures.iter().take(20) {
            eprintln!("MISMATCH {failure}");
        }
        panic!(
            "{test}: {} mismatched channels (first: {})",
            failures.len(),
            failures.first().cloned().unwrap_or_default()
        );
    }
}

// ---------------------------------------------------------------------------------------------- A) own attack timings

fn minimal_self(
    faction: Option<FactionId>,
    as_mult: f64,
    windup_mult: Presence<f64>,
) -> TacticSelf {
    TacticSelf {
        id: "p0".to_string(),
        name: "declared owner".to_string(),
        x: 0.,
        y: 0.,
        facing: 0.,
        status: "alive".to_string(),
        hp: 1.,
        max_hp: 1.,
        barrier: 0.,
        faction,
        weapons: [None, None],
        slot: 0,
        attack_target: None,
        draw_started_at: 0.,
        ready_at: 0.,
        immune_until: 0.,
        sig: 0.,
        brand: 0.,
        power: 0.,
        as_mult,
        windup_mult,
        speed_mult: 1.,
        kills: 0.,
        mob_kills: 0.,
        gv: 0.,
        bounty: 0.,
        move_seq: 0.,
    }
}

#[test]
fn private_tactics_compat_timings() {
    let corpus = fight_corpus();
    let timings = corpus["timings"].as_array().expect("declared timings");
    assert_eq!(timings.len(), 90, "declared timing rows");
    let mut failures = Vec::new();
    let mut rows = 0usize;
    for (index, row) in timings.iter().enumerate() {
        let input = &row["input"];
        let faction = FactionId::parse(input["faction"].as_str().expect("timing faction"));
        let weapon = WeaponId::parse(input["weapon"].as_str().expect("timing weapon"))
            .expect("declared weapon");
        let as_mult = input["asMult"].as_f64().expect("timing asMult");
        let windup = match input.get("windupMult") {
            Some(value) => Presence::Value(value.as_f64().expect("timing windupMult")),
            None => Presence::Absent,
        };
        let actual = super::kite::own_timings(&minimal_self(faction, as_mult, windup), weapon);
        let expected = &row["result"];
        assert!(
            !expected.is_null(),
            "timings[{index}]: the declared available row must carry a result"
        );
        let Some(actual) = actual else {
            failures.push(format!(
                "timings[{index}]: expected Some(OwnTimings), actual None"
            ));
            continue;
        };
        let interval = expected["intervalMs"].as_f64().expect("intervalMs");
        let windup_ms = expected["windupMs"].as_f64().expect("windupMs");
        if actual.interval_ms.to_bits() != interval.to_bits() {
            failures.push(format!(
                "timings[{index}].intervalMs: expected {interval} bits {:016x} actual {} bits {:016x}",
                interval.to_bits(),
                actual.interval_ms,
                actual.interval_ms.to_bits()
            ));
        }
        if actual.windup_ms.to_bits() != windup_ms.to_bits() {
            failures.push(format!(
                "timings[{index}].windupMs: expected {windup_ms} bits {:016x} actual {} bits {:016x}",
                windup_ms.to_bits(),
                actual.windup_ms,
                actual.windup_ms.to_bits()
            ));
        }
        rows += 1;
    }
    let unavailable = corpus["unavailableTiming"]
        .as_array()
        .expect("declared unavailableTiming");
    assert_eq!(unavailable.len(), 6, "declared unavailable timing rows");
    let mut unavailable_rows = 0usize;
    for (index, row) in unavailable.iter().enumerate() {
        let weapon = WeaponId::parse(row["weapon"].as_str().expect("unavailable weapon"))
            .expect("declared weapon");
        assert!(
            row["result"].is_null(),
            "unavailableTiming[{index}]: declared null"
        );
        let actual = super::kite::own_timings(&minimal_self(None, 1., Presence::Absent), weapon);
        if actual.is_some() {
            failures.push(format!(
                "unavailableTiming[{index}]: expected None, actual {actual:?}"
            ));
        }
        unavailable_rows += 1;
    }
    assert_eq!(rows, 90, "replayed available timing rows");
    assert_eq!(unavailable_rows, 6, "replayed unavailable timing rows");
    finish(
        "compat A bot-fight timings (overlap evidence)",
        "90/90 available + 6/6 unavailable rows replayed through private kite::own_timings"
            .to_string(),
        failures,
    );
}

// --------------------------------------------------------------------------------------------------- B) orb walks

#[test]
fn private_tactics_compat_orbs() {
    let corpus = fight_corpus();
    let maps = &corpus["maps"];
    let orbs = corpus["orbs"].as_array().expect("declared orb cases");
    assert_eq!(orbs.len(), 6, "declared orb cases");
    let mut failures = Vec::new();
    let mut rows_total = 0usize;
    for case in orbs {
        let recipe = &case["recipe"];
        let name = recipe["name"].as_str().expect("orb case name");
        let seed = recipe["seed"].as_u64().expect("orb seed") as u32;
        let map_id = recipe["map"].as_str().expect("orb map");
        let map_value = &maps[map_id];
        let declared_rows = case["rows"].as_array().expect("orb rows");
        let first =
            decode_percept_plain(&declared_rows[0]["input"]["percept"]).expect("plain orb percept");
        let cfg = config(
            tier_of(&recipe["tier"]),
            persona_of(&recipe["persona"]),
            seed,
            map_value,
            first.features.clone(),
        );
        let leaked = leak_tier(cfg.tier);
        let mut memory = new_memory("p0", leaked, cfg.features.clone());
        let knowledge = new_knowledge(leaked, seed);
        let trace = TraceLog::new_handle();
        let mut paths = new_paths(&cfg.map.tile_map, map_value, &trace);
        let decide_seed = declared_rows[0]["rngAfter"]["decide"]["seed"]
            .as_u64()
            .expect("orb decide seed") as u32;
        assert_eq!(
            decide_seed,
            derive(seed, 0),
            "{name}: declared decide seed is the source derive(seed, 0)"
        );
        let mut decide = RecordingDecide::new(decide_seed, &trace);
        let mut orb = OrbWalk::new();
        orb.reset(recipe["reset"].as_f64().expect("orb reset"));

        for (index, row) in declared_rows.iter().enumerate() {
            rows_total += 1;
            let label = format!("orb.{name}[{index}]");
            let input = &row["input"];
            let percept = decode_percept_plain(&input["percept"]).expect("plain orb percept");
            assert_eq!(
                percept.features, cfg.features,
                "{label}: declared features are case-constant"
            );
            memory
                .observe(&memory_percept(&percept))
                .expect("admitted private Memory observe");
            trace.borrow_mut().reset();
            begin_paths(&mut paths, &percept);
            let weapon = WeaponId::parse(input["weapon"].as_str().expect("step weapon"))
                .expect("declared weapon");
            let foe = &input["foe"];
            let before = decide.draws();
            let step = {
                let mut recorded_memory = RecordedMemory {
                    inner: &memory,
                    trace: trace.clone(),
                };
                let mut recorded_knowledge = RecordedKnowledge {
                    inner: &knowledge,
                    trace: trace.clone(),
                };
                let mut ctx = TacticsContext {
                    cfg: &cfg,
                    p: &percept,
                    mem: &mut recorded_memory,
                    know: &mut recorded_knowledge,
                    paths: &mut paths,
                    decide: &mut decide,
                    engaged: false,
                };
                orb.step(
                    &mut ctx,
                    OrbFoe {
                        id: foe["id"].as_str().expect("declared foe id"),
                        x: foe["x"].as_f64().expect("declared foe x"),
                        y: foe["y"].as_f64().expect("declared foe y"),
                    },
                    weapon,
                    input["locked"].as_bool().expect("declared locked"),
                )
            };
            let actual = match step {
                OrbStep::None => null(),
                OrbStep::Wait => s("wait"),
                OrbStep::Order(intent) => encode_intent(&intent),
            };
            let expected = decode_plain_json(&row["result"]);
            let ctx = CompareCtx {
                suite: Suite::Orb,
                method: "step",
                ordered: false,
                geometry: plain_geometry(&row["result"]),
                coliseum_spot: false,
                declared_union: None,
            };
            compare_result(&label, &expected, &actual, &ctx, &mut failures);
            let cycles = row["cycles"].as_u64().expect("declared cycles");
            if orb.cycles() != cycles {
                failures.push(format!(
                    "{label}: cycles expected {cycles} actual {}",
                    orb.cycles()
                ));
            }
            let delta = (decide.draws() - before) as u64;
            let declared_delta = row["decideDrawDelta"]
                .as_u64()
                .expect("declared decideDrawDelta");
            if delta != declared_delta {
                failures.push(format!(
                    "{label}: decide draw delta expected {declared_delta} actual {delta}"
                ));
            }
            check_decide_stream(
                &format!("{label} decide"),
                decide_seed,
                &decide.values,
                &row["rngAfter"]["decide"],
                &mut failures,
            );
        }
        // After the case a fresh independent source replay advanced by the declared cumulative draw count must still be
        // at the captured next value (the per-row check already replayed every intermediate row).
        let last = &declared_rows[declared_rows.len() - 1]["rngAfter"]["decide"];
        let mut replay = Rng::new(decide_seed);
        for _ in 0..last["count"].as_u64().expect("declared count") {
            replay.next_f64();
        }
        let expected_next = last["nextFromIndependentReplay"]
            .as_f64()
            .expect("declared next value");
        let next = replay.next_f64();
        if next.to_bits() != expected_next.to_bits() {
            failures.push(format!(
                "orb.{name}: independent after-case replay next expected {expected_next} bits {:016x} actual bits {:016x}",
                expected_next.to_bits(),
                next.to_bits()
            ));
        }
        eprintln!(
            "compat B case {name}: {} rows, {} decide draws",
            declared_rows.len(),
            decide.draws()
        );
    }
    assert_eq!(rows_total, 20, "replayed orb rows");
    finish(
        "compat B bot-fight orbs (overlap evidence)",
        format!("6/6 cases / {rows_total}/20 rows replayed through the private OrbWalk"),
        failures,
    );
}

// --------------------------------------------------------------------------------------------------- C) direct fight

#[test]
fn private_tactics_compat_fight() {
    let corpus = fight_corpus();
    let direct = &corpus["directFight"];
    let percept = decode_percept_plain(&direct["input"]).expect("plain directFight percept");
    assert_eq!(percept.self_.id, "p0", "directFight owner");
    let declared = &direct["rngAfter"];
    let decide_seed = declared["decide"]["seed"]
        .as_u64()
        .expect("direct decide seed") as u32;
    assert_eq!(
        decide_seed,
        derive(7, 0),
        "directFight decide seed is the source derive(7, 0)"
    );
    assert_eq!(
        declared["knowledge"]["seed"]
            .as_u64()
            .expect("knowledge seed") as u32,
        derive(7, 3),
        "directFight knowledge seed is the source derive(7, 3)"
    );
    let map_value = &corpus["maps"]["open"];
    let cfg = config(
        tier_of(&Value::String("normal".to_string())),
        persona_of(&Value::String("cautious".to_string())),
        7,
        map_value,
        percept.features.clone(),
    );
    let leaked = leak_tier(cfg.tier);
    let mut memory = new_memory("p0", leaked, cfg.features.clone());
    memory
        .observe(&memory_percept(&percept))
        .expect("admitted private Memory observe");
    let knowledge = new_knowledge(leaked, 7);
    let trace = TraceLog::new_handle();
    let mut paths = new_paths(&cfg.map.tile_map, map_value, &trace);
    begin_paths(&mut paths, &percept);
    trace.borrow_mut().reset();
    let mut decide = RecordingDecide::new(decide_seed, &trace);
    let mut fight = Fight::new(OrbWalk::new(), Reflexes::new(), Retreat::new());
    let reference = FightRef {
        id: direct["ref"]["id"]
            .as_str()
            .expect("direct ref id")
            .to_string(),
        kind: fight_kind(direct["ref"]["kind"].as_str().expect("direct ref kind")),
    };
    let output = {
        let mut recorded_memory = RecordedMemory {
            inner: &memory,
            trace: trace.clone(),
        };
        let mut recorded_knowledge = RecordedKnowledge {
            inner: &knowledge,
            trace: trace.clone(),
        };
        let mut ctx = TacticsContext {
            cfg: &cfg,
            p: &percept,
            mem: &mut recorded_memory,
            know: &mut recorded_knowledge,
            paths: &mut paths,
            decide: &mut decide,
            engaged: false,
        };
        fight.act(
            &mut ctx,
            &reference,
            direct["knowsSuddenDeath"]
                .as_bool()
                .expect("direct knowsSuddenDeath"),
        )
    };
    let mut failures = Vec::new();
    let expected = decode_plain_json(&direct["result"]);
    let ctx = CompareCtx {
        suite: Suite::Fight,
        method: "act",
        ordered: false,
        geometry: plain_geometry(&direct["result"]),
        coliseum_spot: false,
        declared_union: None,
    };
    compare_result(
        "directFight result",
        &expected,
        &super::source_trace::encode_output(&output),
        &ctx,
        &mut failures,
    );
    check_decide_stream(
        "directFight decide",
        decide_seed,
        &decide.values,
        &declared["decide"],
        &mut failures,
    );
    finish(
        "compat C bot-fight directFight (overlap evidence)",
        format!(
            "1/1 frame replayed through the private Fight; {} decide draws; {} recorded path callbacks",
            decide.draws(),
            match trace.borrow().encoded() {
                SVal::Arr(events) => events.len(),
                _ => 0,
            }
        ),
        failures,
    );
}

// ------------------------------------------------------------------------------------------ D) full tactics sequences

#[test]
fn private_tactics_compat_cases() {
    use crate::bots::types::Stimulus;

    let corpus = fight_corpus();
    let maps = &corpus["maps"];
    let cases = corpus["cases"].as_array().expect("declared tactics cases");
    assert_eq!(cases.len(), 16, "declared tactics cases");
    let mut failures = Vec::new();
    let mut rows_total = 0usize;
    let mut cases_reached = 0usize;
    let mut normal_reflex_rows = 0usize;
    let mut normal_reflex_gaps = 0usize;
    for case in cases {
        let recipe = &case["recipe"];
        let name = recipe["name"].as_str().expect("case name");
        assert_eq!(
            recipe["kind"].as_str().expect("case kind"),
            "tactics",
            "{name}: every admitted case is a createTactics case"
        );
        let seed = recipe["seed"].as_u64().expect("case seed") as u32;
        let map_id = recipe["map"].as_str().expect("case map");
        let map_value = &maps[map_id];
        let declared_rows = case["rows"].as_array().expect("case rows");
        let first = decode_percept_plain(&declared_rows[0]["input"]["percept"])
            .expect("plain case percept");
        assert_eq!(first.self_.id, "p0", "{name}: case owner");
        let cfg = config(
            tier_of(&recipe["tier"]),
            persona_of(&recipe["persona"]),
            seed,
            map_value,
            first.features.clone(),
        );
        let leaked = leak_tier(cfg.tier);
        let mut memory = new_memory("p0", leaked, cfg.features.clone());
        let knowledge = new_knowledge(leaked, seed);
        let trace = TraceLog::new_handle();
        let mut paths = new_paths(&cfg.map.tile_map, map_value, &trace);
        let decide_seed = declared_rows[0]["rngAfter"]["decide"]["seed"]
            .as_u64()
            .expect("case decide seed") as u32;
        assert_eq!(
            decide_seed,
            derive(seed, 0),
            "{name}: declared decide seed is the source derive(seed, 0)"
        );
        let mut decide = RecordingDecide::new(decide_seed, &trace);
        let mut tactics = Tactics::new();
        cases_reached += 1;

        for (index, row) in declared_rows.iter().enumerate() {
            rows_total += 1;
            let label = format!("{name}[{index}]");
            let percept =
                decode_percept_plain(&row["input"]["percept"]).expect("plain case percept");
            assert_eq!(
                percept.features, cfg.features,
                "{label}: declared features are case-constant"
            );
            let observed: Vec<Stimulus> = memory
                .observe(&memory_percept(&percept))
                .expect("admitted private Memory observe")
                .to_vec();
            // The same admitted Memory is driven for every row; the derived stimuli are the source frame facts the
            // private Fight reads.
            let _ = observed;
            trace.borrow_mut().reset();
            begin_paths(&mut paths, &percept);
            let before = decide.draws();
            let goal = goal_from_plain(&row["input"]["goal"]);
            let declared_union = goal_declared_point(&goal);
            let result = {
                let mut recorded_memory = RecordedMemory {
                    inner: &memory,
                    trace: trace.clone(),
                };
                let mut recorded_knowledge = RecordedKnowledge {
                    inner: &knowledge,
                    trace: trace.clone(),
                };
                let mut ctx = TacticsContext {
                    cfg: &cfg,
                    p: &percept,
                    mem: &mut recorded_memory,
                    know: &mut recorded_knowledge,
                    paths: &mut paths,
                    decide: &mut decide,
                    engaged: false,
                };
                tactics.act(&mut ctx, &goal)
            };
            let compare_ctx = CompareCtx {
                suite: Suite::Tactics,
                method: "act",
                ordered: false,
                geometry: plain_geometry(&row["result"]),
                coliseum_spot: false,
                declared_union,
            };
            match &result {
                Ok(output) => compare_result(
                    &format!("{label} result"),
                    &decode_plain_json(&row["result"]),
                    &super::source_trace::encode_output(output),
                    &compare_ctx,
                    &mut failures,
                ),
                Err(error) => match row.get("thrown") {
                    Some(thrown) => {
                        if error.thrown_name() != thrown["name"].as_str().unwrap_or_default()
                            || error.thrown_message()
                                != thrown["message"].as_str().unwrap_or_default()
                        {
                            failures.push(format!(
                                "{label}: thrown expected {thrown}, actual {}: {}",
                                error.thrown_name(),
                                error.thrown_message()
                            ));
                        }
                    }
                    None => failures.push(format!(
                        "{label}: unexpected native error {}: {}",
                        error.thrown_name(),
                        error.thrown_message()
                    )),
                },
            }
            // Lifetime stats: the source Tactics.stats() counters.
            let stats = encode_tactics_stats(tactics.stats());
            expect_same(
                &format!("{label} stats"),
                &row["stats"],
                &stats,
                &mut failures,
            );
            // Path-service transcript: the real recorded callbacks vs the captured source call sequence.
            compare_paths(
                &format!("{label} paths"),
                &row["paths"],
                &trace,
                map_id,
                map_value,
                compare_ctx.geometry,
                &mut failures,
            );
            let stats = paths.inner.stats();
            let actual_path_stats = obj(vec![
                ("searches", n(stats.searches as f64)),
                ("hits", n(stats.hits as f64)),
                ("fallbacks", n(stats.fallbacks as f64)),
            ]);
            expect_same(
                &format!("{label} pathStats"),
                &row["pathStats"],
                &actual_path_stats,
                &mut failures,
            );
            let left = u64::from(paths.inner.budget().left());
            let declared_left = row["budgetLeft"].as_u64().expect("declared budgetLeft");
            if left != declared_left {
                failures.push(format!(
                    "{label}: budgetLeft expected {declared_left} actual {left}"
                ));
            }
            let delta = (decide.draws() - before) as u64;
            let declared_delta = row["drawDelta"]["decide"]
                .as_u64()
                .expect("declared drawDelta.decide");
            if delta != declared_delta {
                failures.push(format!(
                    "{label}: decide draw delta expected {declared_delta} actual {delta}"
                ));
            }
            for stream in ["motor", "lapse", "knowledge"] {
                let declared = row["drawDelta"][stream]
                    .as_u64()
                    .expect("declared drawDelta stream");
                if declared != 0 {
                    failures.push(format!(
                        "{label}: the private layer replays no {stream} stream, declared delta {declared}"
                    ));
                }
            }
            check_decide_stream(
                &format!("{label} decide"),
                decide_seed,
                &decide.values,
                &row["rngAfter"]["decide"],
                &mut failures,
            );
            // The old admitted component's interop answer (`normalReflex`) is an overlap boundary, not a new-private
            // answer. It is compared only through a fresh real private Reflexes instance driven by the same real
            // admitted Memory/Knowledge/paths/decide deps; expected inputs are never installed.
            let normal = compare_normal_reflex(
                &label,
                row,
                &cfg,
                &percept,
                &memory,
                &knowledge,
                map_value,
                decide_seed,
                &mut failures,
            );
            if normal {
                normal_reflex_rows += 1;
            } else {
                normal_reflex_gaps += 1;
            }
        }
    }
    assert_eq!(rows_total, 47, "replayed tactics rows");
    assert_eq!(cases_reached, 16, "replayed tactics cases");
    eprintln!(
        "compat D overlap boundary: normalReflex compared on {normal_reflex_rows} rows, documented gaps {normal_reflex_gaps}"
    );
    finish(
        "compat D bot-fight cases (overlap evidence)",
        format!("16/16 cases / {rows_total}/47 rows replayed through the private Tactics"),
        failures,
    );
}

/// Compare the old corpus's `normalReflex` overlap channel through a fresh real private `Reflexes` instance. The rows are
/// `{result, holdUntil, decideDraws}`; the captured result is `null` everywhere in the admitted bot-fight corpus, so the
/// overlap boundary is the reference answer's absence. Returns false only for rows whose captured answer is outside the
/// shape the private component can honestly reproduce (counted as an explicit reported gap, never skipped silently).
#[allow(clippy::too_many_arguments)]
fn compare_normal_reflex(
    label: &str,
    row: &Value,
    cfg: &TacticsConfig,
    percept: &TacticPercept,
    memory: &super::super::memory::Memory,
    knowledge: &Knowledge,
    map_value: &Value,
    decide_seed: u32,
    failures: &mut Vec<String>,
) -> bool {
    let expected = &row["normalReflex"];
    let probe_trace = TraceLog::new_handle();
    let mut probe_paths = new_paths(&cfg.map.tile_map, map_value, &probe_trace);
    begin_paths(&mut probe_paths, percept);
    let mut probe_decide = RecordingDecide::new(decide_seed, &probe_trace);
    let mut probe_reflexes = Reflexes::new();
    let found = {
        let mut recorded_memory = RecordedMemory {
            inner: memory,
            trace: probe_trace.clone(),
        };
        let mut recorded_knowledge = RecordedKnowledge {
            inner: knowledge,
            trace: probe_trace.clone(),
        };
        let mut ctx = TacticsContext {
            cfg,
            p: percept,
            mem: &mut recorded_memory,
            know: &mut recorded_knowledge,
            paths: &mut probe_paths,
            decide: &mut probe_decide,
            engaged: false,
        };
        probe_reflexes.check(&mut ctx)
    };
    let actual = match &found {
        None => null(),
        Some(reflex) => obj(vec![
            ("kind", s(reflex.kind.as_str())),
            ("holdUntil", n(probe_reflexes.hold_until())),
            ("intent", encode_intent(&reflex.intent)),
        ]),
    };
    let actual_result = match &actual {
        SVal::Obj(fields) => {
            if let (Some(kind), Some(intent)) = (field(fields, "kind"), field(fields, "intent")) {
                obj(vec![("kind", kind.clone()), ("intent", intent.clone())])
            } else {
                actual.clone()
            }
        }
        _ => actual.clone(),
    };
    let expected_result = &expected["result"];
    let comparable = expected_result.is_null() || expected_result.get("kind").is_some();
    if !comparable {
        eprintln!("compat D {label}: normalReflex gap: captured answer shape {expected_result:?}");
        return false;
    }
    let compare_ctx = CompareCtx {
        suite: Suite::Reflex,
        method: "check",
        ordered: false,
        geometry: plain_geometry(expected_result),
        coliseum_spot: false,
        declared_union: None,
    };
    compare_result(
        &format!("{label} normalReflex result"),
        &decode_plain_json(expected_result),
        &actual_result,
        &compare_ctx,
        failures,
    );
    let expected_hold = expected["holdUntil"]
        .as_f64()
        .expect("normalReflex holdUntil");
    if probe_reflexes.hold_until().to_bits() != expected_hold.to_bits() {
        failures.push(format!(
            "{label} normalReflex holdUntil: expected {expected_hold} actual {}",
            probe_reflexes.hold_until()
        ));
    }
    let expected_draws = expected["decideDraws"]
        .as_u64()
        .expect("normalReflex decideDraws") as usize;
    if probe_decide.draws() != expected_draws {
        failures.push(format!(
            "{label} normalReflex decideDraws: expected {expected_draws} actual {}",
            probe_decide.draws()
        ));
    }
    true
}

/// Compare the captured source path-service transcript with the real recorded callbacks. The declared `collisionMap`
/// result is the compressed `{declaredMap:"open"}` marker while the native callback returns the full decoded declared
/// map: the marker is checked against the case's declared map id and the native result against the full declared map
/// value, and the documented compression is counted, never fabricated.
fn compare_paths(
    label: &str,
    expected: &Value,
    trace: &TraceHandle,
    map_id: &str,
    map_value: &Value,
    geometry: bool,
    failures: &mut Vec<String>,
) {
    let declared = expected.as_array().expect("declared paths array");
    let encoded = trace.borrow().encoded();
    let mut actual: Vec<SVal> = Vec::new();
    if let SVal::Arr(events) = &encoded {
        for event in events {
            let SVal::Obj(fields) = event else {
                continue;
            };
            let Some(SVal::Str(kind)) = field(fields, "kind") else {
                continue;
            };
            if kind != "callback" {
                continue;
            }
            let Some(SVal::Str(name)) = field(fields, "name") else {
                continue;
            };
            if !name.starts_with("paths.") {
                continue;
            }
            actual.push(event.clone());
        }
    }
    if actual.len() != declared.len() {
        failures.push(format!(
            "{label}: callback count expected {} actual {} (expected methods {:?})",
            declared.len(),
            actual.len(),
            declared
                .iter()
                .map(|event| event["method"].as_str().unwrap_or("?"))
                .collect::<Vec<_>>()
        ));
        return;
    }
    let map_sval = decode_plain_json(map_value);
    for (index, (expected_event, actual_event)) in declared.iter().zip(actual).enumerate() {
        let SVal::Obj(fields) = &actual_event else {
            failures.push(format!("{label}[{index}]: malformed callback event"));
            continue;
        };
        let actual_name = match field(fields, "name") {
            Some(SVal::Str(name)) => name.as_str(),
            _ => "",
        };
        let actual_method = actual_name.strip_prefix("paths.").unwrap_or(actual_name);
        let expected_method = expected_event["method"].as_str().expect("declared method");
        if actual_method != expected_method {
            failures.push(format!(
                "{label}[{index}]: method expected {expected_method} actual {actual_method}"
            ));
            continue;
        }
        let actual_args = field(fields, "args").cloned().unwrap_or_else(null);
        let actual_result = field(fields, "result").cloned().unwrap_or_else(null);
        let expected_args = expected_event["args"].as_array().expect("declared args");
        let expected_result = &expected_event["result"];
        match expected_method {
            "collisionMap" => {
                let declared_marker = expected_result
                    .get("declaredMap")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| {
                        failures.push(format!(
                            "{label}[{index}]: collisionMap result is not the compressed declaredMap marker"
                        ));
                        ""
                    });
                if declared_marker != map_id {
                    failures.push(format!(
                        "{label}[{index}]: collisionMap declaredMap expected {map_id} actual {declared_marker}"
                    ));
                }
                // The native callback returns the full decoded declared map; the corpus stores the compressed marker.
                if !source_reader::same(&map_sval, &actual_result) {
                    failures.push(format!(
                        "{label}[{index}]: native collisionMap is not the declared map value"
                    ));
                }
            }
            _ => {
                if let SVal::Arr(actual_args_values) = &actual_args {
                    if actual_args_values.len() != expected_args.len() {
                        failures.push(format!(
                            "{label}[{index}] {expected_method}: arg count expected {} actual {}",
                            expected_args.len(),
                            actual_args_values.len()
                        ));
                    } else {
                        for (arg_index, (expected_arg, actual_arg)) in
                            expected_args.iter().zip(actual_args_values).enumerate()
                        {
                            let arg_label = format!("{label}[{index}].args[{arg_index}]");
                            if arg_index == 1
                                && plain_point(expected_arg).is_some()
                                && sval_point(actual_arg).is_some()
                            {
                                let mut ignored = 0f64;
                                expect_point(
                                    &arg_label,
                                    expected_arg,
                                    actual_arg,
                                    geometry,
                                    &mut ignored,
                                    failures,
                                );
                            } else {
                                expect_same(&arg_label, expected_arg, actual_arg, failures);
                            }
                        }
                    }
                } else {
                    failures.push(format!(
                        "{label}[{index}] {expected_method}: malformed args"
                    ));
                }
                if expected_method == "path" {
                    // Route waypoints are real pathfinder coordinates and compare exact; the final element is the
                    // caller's own target object the source route kept.
                    match (expected_result, &actual_result) {
                        (Value::Array(declared_route), SVal::Arr(actual_route)) => {
                            if declared_route.len() != actual_route.len() {
                                failures.push(format!(
                                    "{label}[{index}] path: route length expected {} actual {}",
                                    declared_route.len(),
                                    actual_route.len()
                                ));
                            } else {
                                for (element, (declared, actual)) in
                                    declared_route.iter().zip(actual_route).enumerate()
                                {
                                    expect_same(
                                        &format!("{label}[{index}].result[{element}]"),
                                        declared,
                                        actual,
                                        failures,
                                    );
                                }
                            }
                        }
                        _ => expect_same(
                            &format!("{label}[{index}].result"),
                            expected_result,
                            &actual_result,
                            failures,
                        ),
                    }
                } else {
                    expect_same(
                        &format!("{label}[{index}].result"),
                        expected_result,
                        &actual_result,
                        failures,
                    );
                }
            }
        }
    }
}

// --------------------------------------------------------------------------------------------------- E) reflex

#[test]
fn private_tactics_compat_reflex() {
    let corpus = reflex_corpus();
    let maps = &corpus["maps"];
    let cases = corpus["cases"].as_array().expect("declared reflex cases");
    assert_eq!(cases.len(), 49, "declared reflex cases");
    let mut failures = Vec::new();
    let mut rows_total = 0usize;
    let mut checks = 0usize;
    let mut skipped = 0usize;
    let mut memory_derivations = 0usize;
    let mut memory_gaps = 0usize;
    let mut max_geometry = 0f64;
    let mut per_case: Vec<(String, usize, usize)> = Vec::new();
    for case in cases {
        let recipe = &case["recipe"];
        let name = recipe["name"]
            .as_str()
            .expect("reflex case name")
            .to_string();
        let seed = recipe["seed"].as_u64().expect("reflex seed") as u32;
        let map_id = recipe["map"].as_str().expect("reflex map");
        let map_value = &maps[map_id];
        let declared_rows = case["rows"].as_array().expect("reflex rows");
        let first = decode_percept_plain(&declared_rows[0]["input"]["percept"])
            .expect("plain reflex percept");
        let tier = tier_of(&recipe["tier"]);
        let leaked = leak_tier(tier);
        let mut memory = new_memory(&first.self_.id, leaked, first.features.clone());
        let knowledge = new_knowledge(leaked, seed);
        let trace = TraceLog::new_handle();
        let mut paths = new_paths(&tile_map_from(map_value), map_value, &trace);
        let decide_seed = declared_rows[0]["rngAfter"]["decide"]["seed"]
            .as_u64()
            .expect("reflex decide seed") as u32;
        assert_eq!(
            decide_seed,
            derive(seed, 0),
            "{name}: declared decide seed is the source derive(seed, 0)"
        );
        let mut decide = RecordingDecide::new(decide_seed, &trace);
        let mut reflexes = Reflexes::new();
        let mut case_checks = 0usize;
        let mut case_skipped = 0usize;

        for (index, row) in declared_rows.iter().enumerate() {
            rows_total += 1;
            let label = format!("reflex.{name}[{index}]");
            let input = &row["input"];
            let percept = decode_percept_plain(&input["percept"]).expect("plain reflex percept");
            let observed: Vec<crate::bots::types::Stimulus> = memory
                .observe(&memory_percept(&percept))
                .expect("admitted private Memory observe")
                .to_vec();
            // Real admitted-Memory derivation check: the declared `memory` channel is re-derived, never installed.
            let derived_stimuli = encode_stimuli(&observed);
            let expected_memory = &row["memory"];
            let mut memory_failures = Vec::new();
            expect_same(
                &format!("{label} memory.stimuli"),
                &expected_memory["stimuli"],
                &derived_stimuli,
                &mut memory_failures,
            );
            let derived_feints = arr(memory
                .view()
                .fighters
                .iter()
                .map(|(_, fighter)| {
                    obj(vec![
                        ("id", s(&fighter.id)),
                        ("feints", n(fighter.feints as f64)),
                    ])
                })
                .collect());
            expect_same(
                &format!("{label} memory.fighterFeints"),
                &expected_memory["fighterFeints"],
                &derived_feints,
                &mut memory_failures,
            );
            if memory_failures.is_empty() {
                memory_derivations += 1;
            } else {
                memory_gaps += 1;
                for failure in memory_failures.iter().take(2) {
                    eprintln!("COMPAT E MEMORY-DERIVATION MISMATCH {failure}");
                }
                failures.extend(memory_failures);
            }
            trace.borrow_mut().reset();
            begin_paths(&mut paths, &percept);
            let called = row["called"].as_bool().expect("declared called");
            if called {
                checks += 1;
                case_checks += 1;
                let before = decide.draws();
                let found = {
                    let mut recorded_memory = RecordedMemory {
                        inner: &memory,
                        trace: trace.clone(),
                    };
                    let mut recorded_knowledge = RecordedKnowledge {
                        inner: &knowledge,
                        trace: trace.clone(),
                    };
                    let mut ctx = TacticsContext {
                        cfg: &direct_reflex_config(leaked, &percept),
                        p: &percept,
                        mem: &mut recorded_memory,
                        know: &mut recorded_knowledge,
                        paths: &mut paths,
                        decide: &mut decide,
                        engaged: false,
                    };
                    reflexes.check(&mut ctx)
                };
                let actual = match &found {
                    None => null(),
                    Some(reflex) => obj(vec![
                        ("kind", s(reflex.kind.as_str())),
                        ("holdUntil", n(reflexes.hold_until())),
                        ("intent", encode_intent(&reflex.intent)),
                    ]),
                };
                let expected_result = &row["result"];
                let compare_ctx = CompareCtx {
                    suite: Suite::Reflex,
                    method: "check",
                    ordered: false,
                    geometry: plain_geometry(expected_result),
                    coliseum_spot: false,
                    declared_union: None,
                };
                compare_result(
                    &format!("{label} result"),
                    &decode_plain_json(expected_result),
                    &actual,
                    &compare_ctx,
                    &mut failures,
                );
                track_intent_to(expected_result, &actual, &mut max_geometry);
                let delta = (decide.draws() - before) as u64;
                let declared_delta = row["drawDelta"]["decide"]
                    .as_u64()
                    .expect("reflex drawDelta.decide");
                if delta != declared_delta {
                    failures.push(format!(
                        "{label}: decide draw delta expected {declared_delta} actual {delta}"
                    ));
                }
            } else {
                skipped += 1;
                case_skipped += 1;
                if row.get("result").is_some() {
                    failures.push(format!(
                        "{label}: observe-only row must not carry a fabricated result"
                    ));
                }
                let observe_only = input["recipe"]["observeOnly"].as_bool().unwrap_or(false);
                if !observe_only {
                    failures.push(format!(
                        "{label}: called=false without the declared observeOnly drive rule"
                    ));
                }
            }
            // Component state is retained across rows (one real Reflexes per case).
            let state = obj(vec![
                ("holdUntil", n(reflexes.hold_until())),
                ("dodges", n(reflexes.dodges() as f64)),
                ("jukes", n(reflexes.jukes() as f64)),
            ]);
            expect_same(
                &format!("{label} state"),
                &row["state"],
                &state,
                &mut failures,
            );
            compare_reflex_paths(
                &format!("{label} paths"),
                &row["paths"],
                &trace,
                &mut max_geometry,
                &mut failures,
            );
            check_decide_stream(
                &format!("{label} decide"),
                decide_seed,
                &decide.values,
                &row["rngAfter"]["decide"],
                &mut failures,
            );
            for stream in ["motor", "lapse"] {
                let count = row["rngAfter"][stream]["count"]
                    .as_u64()
                    .expect("declared stream count");
                if count != 0 {
                    failures.push(format!(
                        "{label}: the private layer replays no {stream} stream, declared count {count}"
                    ));
                }
            }
        }
        per_case.push((name, case_checks, case_skipped));
    }
    assert_eq!(rows_total, 68, "replayed reflex rows");
    assert_eq!(checks, 67, "replayed reflex checks");
    for (name, checks, skipped) in &per_case {
        eprintln!("compat E case {name}: {checks} checks, {skipped} observe-only rows");
    }
    eprintln!(
        "compat E Memory.observe re-derivation: {memory_derivations} rows matched, {memory_gaps} hard mismatches; \
         max continuous geometry abs difference {max_geometry:?}"
    );
    finish(
        "compat E bot-reflex (overlap evidence)",
        format!(
            "49/49 cases / {rows_total}/68 rows / {checks}/67 checks replayed through the private Reflexes \
             ({skipped} observe-only rows)"
        ),
        failures,
    );
}

/// The private Reflexes only reads the declared tier; this is the same resolved config the private tactics layer runs
/// with (empty camp map, declared features).
fn direct_reflex_config(tier: &'static TierParams, percept: &TacticPercept) -> TacticsConfig {
    TacticsConfig {
        id: percept.self_.id.clone(),
        name: percept.self_.name.clone(),
        seed: 0,
        tier: *tier,
        persona: *PersonaParams::by_id(PersonaId::Cautious),
        map: tactics_map_from(&serde_json::json!({"w": 1, "h": 1, "tiles": [1]})),
        features: percept.features.clone(),
        path_budget: 3,
        path: None,
    }
}

fn track_intent_to(expected: &Value, actual: &SVal, max: &mut f64) {
    let Some((expected_x, expected_y)) = plain_point(&expected["intent"]["to"]) else {
        return;
    };
    let Some(actual_intent) = (match actual {
        SVal::Obj(fields) => field(fields, "intent").cloned(),
        _ => None,
    }) else {
        return;
    };
    let Some((actual_x, actual_y)) = sval_point(&actual_intent) else {
        return;
    };
    *max = max
        .max((expected_x - actual_x).abs())
        .max((expected_y - actual_y).abs());
}

/// Compare the captured `clear` call transcript (the only path-service method the private Reflexes calls) with the real
/// recorded callbacks: the self argument and result compare exact, the consumed target point is the derived geometry
/// leaf with the reviewed 2e-6 allowance and its maximum absolute difference reported.
fn compare_reflex_paths(
    label: &str,
    expected: &Value,
    trace: &TraceHandle,
    max: &mut f64,
    failures: &mut Vec<String>,
) {
    let declared = expected.as_array().expect("declared reflex paths");
    let encoded = trace.borrow().encoded();
    let mut actual: Vec<SVal> = Vec::new();
    if let SVal::Arr(events) = &encoded {
        for event in events {
            let SVal::Obj(fields) = event else {
                continue;
            };
            if let Some(SVal::Str(kind)) = field(fields, "kind") {
                if kind == "callback" {
                    actual.push(event.clone());
                }
            }
        }
    }
    if actual.len() != declared.len() {
        failures.push(format!(
            "{label}: path callback count expected {} actual {}",
            declared.len(),
            actual.len()
        ));
        return;
    }
    for (index, (expected_event, actual_event)) in declared.iter().zip(actual).enumerate() {
        let SVal::Obj(fields) = &actual_event else {
            failures.push(format!("{label}[{index}]: malformed callback event"));
            continue;
        };
        let actual_method = match field(fields, "name") {
            Some(SVal::Str(name)) => name.strip_prefix("paths.").unwrap_or(name),
            _ => "",
        };
        let expected_method = expected_event["method"].as_str().expect("declared method");
        if actual_method != expected_method {
            failures.push(format!(
                "{label}[{index}]: method expected {expected_method} actual {actual_method}"
            ));
            continue;
        }
        let expected_args = expected_event["args"].as_array().expect("declared args");
        let actual_args = field(fields, "args").cloned().unwrap_or_else(null);
        let SVal::Arr(actual_args) = &actual_args else {
            failures.push(format!("{label}[{index}]: malformed args"));
            continue;
        };
        if actual_args.len() != expected_args.len() {
            failures.push(format!(
                "{label}[{index}]: arg count expected {} actual {}",
                expected_args.len(),
                actual_args.len()
            ));
            continue;
        }
        expect_same(
            &format!("{label}[{index}].args[0]"),
            &expected_args[0],
            &actual_args[0],
            failures,
        );
        expect_point(
            &format!("{label}[{index}].args[1]"),
            &expected_args[1],
            &actual_args[1],
            true,
            max,
            failures,
        );
        expect_same(
            &format!("{label}[{index}].result"),
            &expected_event["result"],
            &field(fields, "result").cloned().unwrap_or_else(null),
            failures,
        );
    }
}
