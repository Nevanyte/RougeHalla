//! Typed decode of the frozen private-tactics declared-method witness (P-BOT-TACTICS-1).
//!
//! Everything decoded here is a declared input: maps, resolved config, per-operation percept/goal/foe/threats and the
//! operation envelope. Results, Memory snapshots, stats, callbacks and draw counts are expected outputs and are never
//! decoded into native state. The decode is strict: every consumed object is closed over its source fields, every
//! declared number must be finite, every enum tag is checked, and sentinel tags stay separate (Undefined / Null /
//! signed zero / non-finite internal values).

use serde_json::Value;

use super::super::data::MethodValue;
use super::super::memory::source_input::{
    MemoryPercept, PerceptCampView, PerceptChest, PerceptContainer, PerceptEvent, PerceptEventRow,
    PerceptExtras, PerceptFighter, PerceptMinimap, PerceptMinimapMob, PerceptMob, PerceptPlan,
    PerceptProjectile, PerceptSelf, PerceptWeapon,
};
use super::super::memory::{CampGeom, ContainersWeapon, MemoryCommand, MemoryTimedCommand};
use super::source_reader::{self, SVal};
use super::types::{
    Goal, HoldWhy, PathDescriptor, Presence, ProjectileKind, RoamWhy, TacticContainer, TacticEvent,
    TacticEventKind, TacticFighter, TacticHud, TacticMinimap, TacticMinimapMob, TacticMob,
    TacticPercept, TacticProjectile, TacticSelf, TacticsConfig, TacticsMap,
};
use crate::bots::types::{
    Appraisal, Attention, Cadence, Caution, ExGaussian, Hesitation, MoveScatter, Orbwalk,
    PersonaId, PersonaParams, Route, TargetScatter, TierId, TierParams,
};
use crate::bots::view::Features;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

type R<T> = Result<T, String>;

/// The source suite that owns the constructed object and its exposed stats/results.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Suite {
    Tactics,
    Fight,
    World,
    Orb,
    Reflex,
    Retreat,
}

/// One declared source `GameMap` from the frozen corpus: native read surface plus the exact declared value (the
/// `collisionMap()` callback returns that same declared map object).
#[derive(Clone, Debug)]
pub(crate) struct DecodedMap {
    pub id: String,
    pub map: super::types::TacticsMap,
    pub value: SVal,
}

/// One declared percept: the full typed source Percept for the tactic context and the admitted-Memory input projection.
#[derive(Clone, Debug)]
pub(crate) struct ObserveInput {
    pub percept: TacticPercept,
    pub memory: MemoryPercept,
}

/// The per-operation declared path-service environment (`env`): applies to this operation only.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct OpEnv {
    /// `env.path` when present; otherwise the case-level `config.path`.
    pub path: Option<PathDescriptor>,
    pub empty_path: bool,
}

/// One declared method. Every variant holds exactly the consumed source arguments.
#[derive(Clone, Debug)]
pub(crate) enum Method {
    /// `Memory.observe` with the full declared Percept.
    Observe(Box<ObserveInput>),
    /// `createTactics().act(ctx, goal)` for the tactics suite; `Fight.act(ctx, {id,kind}, knowsSuddenDeath)` for the
    /// fight suite (its goal is a FightRef with `kind` farm/hunt/fight).
    Act(Goal),
    /// `Memory.noteSent(input)`.
    NoteSent(MemoryNoteSent),
    /// `Memory.recordChoice(input)`.
    RecordChoice(String),
    /// `orb.step(ctx, foe, weapon, locked)`.
    Step {
        foe: (String, Vec2),
        weapon: WeaponId,
        locked: bool,
    },
    /// `orb.reset(readyAt)` (orb suite) or `retreat.reset()` (retreat suite).
    Reset(Option<f64>),
    /// `retreat.point(ctx, threats)`.
    Point(Vec<Vec2>),
    /// `reflex.check(ctx)`.
    Check,
    /// `world.pickHoldSpot(ctx, centre, ringRadius)`.
    PickHoldSpot { centre: Vec2, radius: f64 },
    /// `fight.inReach(ctx, foe, weapon)` (only x/y/los are consumed).
    InReach {
        foe: (f64, f64, bool),
        weapon: WeaponId,
    },
}

/// `noteSent`'s raw command identity is needed by the real admitted Memory method; reuse its type.
pub(crate) type MemoryNoteSent = MemoryTimedCommand;

#[derive(Clone, Debug)]
pub(crate) struct DecodedOp {
    pub method: Method,
    pub engaged: bool,
    pub env: OpEnv,
    /// The fight suite's `Fight.act(ctx, ref, knowsSuddenDeath)` argument when the declaration carries it.
    pub knows_sudden_death: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct DecodedCase {
    pub id: String,
    pub suite: Suite,
    pub covers: Vec<String>,
    pub config: TacticsConfig,
    pub operations: Vec<DecodedOp>,
}

#[derive(Clone, Debug)]
pub(crate) struct DecodedCorpus {
    pub maps: Vec<DecodedMap>,
    pub cases: Vec<DecodedCase>,
}

// -------------------------------------------------------------------------------------------------------- constants

const FACTION_NAMES: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
const WEAPON_NAMES: [&str; 6] = ["sword", "axe", "shield", "bow", "wand", "fists"];
const STATUS_NAMES: [&str; 3] = ["alive", "dead", "mia"];
const MOB_KIND_NAMES: [&str; 4] = ["mob", "elite", "dummy", "npc"];
const PROJECTILE_KIND_NAMES: [&str; 2] = ["ball", "arrow"];
const ROAM_WHY_NAMES: [&str; 5] = ["explore", "camp", "lastSeen", "coliseum", "centre"];
const HOLD_WHY_NAMES: [&str; 3] = ["coliseum", "ambush", "wait"];
const TIER_NAMES: [&str; 3] = ["easy", "normal", "hard"];
const PERSONA_NAMES: [&str; 4] = ["farmer", "hunter", "opportunist", "cautious"];
const COMMAND_TYPE_NAMES: [&str; 11] = [
    "move",
    "stop",
    "target",
    "attack",
    "release",
    "swap",
    "pickup",
    "cast",
    "plan",
    "choose",
    "useConsumable",
];
const FEATURE_MESSAGE_NAMES: [&str; 11] = [
    "move",
    "stop",
    "target",
    "attack",
    "release",
    "swap",
    "pickup",
    "cast",
    "plan",
    "choose",
    "useConsumable",
];
const METHOD_NAMES: [&str; 11] = [
    "observe",
    "act",
    "noteSent",
    "recordChoice",
    "step",
    "reset",
    "point",
    "check",
    "leave",
    "pickHoldSpot",
    "inReach",
];
const EVENT_KIND_NAMES: [&str; 16] = [
    "windup", "swing", "hit", "block", "stagger", "cancel", "projEnd", "death", "heal", "teleport",
    "bounty", "victory", "toast", "result", "private", "ext",
];
const PERCEPT_KEYS: [&str; 12] = [
    "now",
    "viewT",
    "self",
    "hud",
    "fighters",
    "mobs",
    "containers",
    "projectiles",
    "minimap",
    "events",
    "extras",
    "features",
];
const SELF_REQUIRED_KEYS: [&str; 26] = [
    "id",
    "name",
    "x",
    "y",
    "facing",
    "status",
    "hp",
    "maxHp",
    "barrier",
    "faction",
    "weapons",
    "slot",
    "attackTarget",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "speedMult",
    "kills",
    "mobKills",
    "gv",
    "bounty",
    "moveSeq",
];
const SELF_OPTIONAL_KEYS: [&str; 1] = ["windupMult"];
const HUD_KEYS: [&str; 13] = [
    "phase",
    "training",
    "lobbyEndsAt",
    "raidStartedAt",
    "patienceEndsAt",
    "suddenDeathAt",
    "inColiseum",
    "gatesLocked",
    "startedWith",
    "alive",
    "playerCount",
    "minPlayers",
    "winner",
];
const FIGHTER_KEYS: [&str; 23] = [
    "id",
    "name",
    "bot",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "barrierFrac",
    "faction",
    "inHand",
    "drawStartedAt",
    "bounty",
    "immune",
    "sig",
    "brand",
    "targetable",
    "vx",
    "vy",
    "dist",
    "los",
    "tint",
    "central",
];
const MOB_KEYS: [&str; 19] = [
    "id",
    "kind",
    "name",
    "type",
    "faction",
    "x",
    "y",
    "facing",
    "status",
    "hpFrac",
    "inHand",
    "drawStartedAt",
    "sig",
    "brand",
    "vx",
    "vy",
    "dist",
    "los",
    "central",
];
const CONTAINER_KEYS: [&str; 9] = [
    "id",
    "kind",
    "x",
    "y",
    "label",
    "closed",
    "weapon",
    "interactable",
    "dist",
];
const PROJECTILE_KEYS: [&str; 11] = [
    "id", "kind", "x", "y", "vx", "vy", "x0", "y0", "t0", "range", "from",
];
const MINIMAP_KEYS: [&str; 3] = ["t", "mobs", "gatesLocked"];
const MINIMAP_MOB_KEYS: [&str; 5] = ["id", "x", "y", "faction", "elite"];
const FEATURE_KEYS: [&str; 10] = [
    "messageTypes",
    "wishes",
    "statusEffects",
    "fields",
    "planning",
    "chests",
    "skills",
    "relics",
    "camps",
    "hazards",
];
const CONFIG_KEYS: [&str; 16] = [
    "tier",
    "persona",
    "seed",
    "id",
    "name",
    "features",
    "path",
    "pathBudget",
    "modules",
    "learned",
    "tierOverrides",
    "tierValues",
    "personaValues",
    "personaOverrides",
    "map",
    "seeds",
];
const CONFIG_REQUIRED_KEYS: [&str; 13] = [
    "tier",
    "persona",
    "seed",
    "id",
    "name",
    "features",
    "pathBudget",
    "modules",
    "learned",
    "tierValues",
    "personaValues",
    "map",
    "seeds",
];
// The declared resolved tier value: exactly the TierParams field names (17 scalars + 13 nested groups).
const TIER_SCALAR_KEYS: [&str; 16] = [
    "refractoryMs",
    "apm",
    "burst",
    "minGapMs",
    "minimapSigma",
    "edgeClickP",
    "timingSigmaMs",
    "softmaxT",
    "lapseP",
    "dodgeP",
    "jukeP",
    "knowledge",
    "mobShareNoise",
    "memorySpanMs",
    "feintRead",
    "wary",
];
const PERSONA_SCALAR_KEYS: [&str; 16] = [
    "pve",
    "pvp",
    "loot",
    "bounty",
    "thirdParty",
    "engageEdge",
    "bountyCaution",
    "fleeHp",
    "reengageHp",
    "kite",
    "chaseGiveUpMs",
    "mobKillGoal",
    "playerThreat",
    "eliteAppetite",
    "coliseum",
    "risk",
];
const OPERATION_KEYS: [&str; 9] = [
    "method",
    "declaration",
    "result",
    "memory",
    "stats",
    "callbacks",
    "drawCounts",
    "pathStats",
    "thrown",
];
const OPERATION_REQUIRED_KEYS: [&str; 8] = [
    "method",
    "declaration",
    "result",
    "memory",
    "stats",
    "callbacks",
    "drawCounts",
    "pathStats",
];

// ----------------------------------------------------------------------------------------------------------- helpers

fn path_of(path: &str, key: &str) -> String {
    format!("{path}.{key}")
}

fn missing(path: &str, key: &str) -> String {
    format!("{path}: missing consumed fact {key}")
}

fn unsupported(path: &str, value: &str) -> String {
    format!("{path}: unsupported {value}")
}

fn field<'a>(v: &'a SVal, key: &str, path: &str) -> R<&'a SVal> {
    v.field(key, path)
}

fn optional<'a>(v: &'a SVal, key: &str) -> Option<&'a SVal> {
    v.optional(key)
}

fn text(v: &SVal, key: &str, path: &str) -> R<String> {
    let target = path_of(path, key);
    v.field(key, path)?.string(&target).map(str::to_string)
}

fn non_null_text(v: &SVal, key: &str, path: &str) -> R<String> {
    let target = path_of(path, key);
    match v.field(key, path)? {
        SVal::Str(value) => Ok(value.clone()),
        other => Err(format!("{target}: expected a string, got {other:?}")),
    }
}

fn nullable_text(v: &SVal, key: &str, path: &str) -> R<Option<String>> {
    let target = path_of(path, key);
    match v.field(key, path)? {
        SVal::Null => Ok(None),
        SVal::Str(value) => Ok(Some(value.clone())),
        other => Err(format!("{target}: expected string|null, got {other:?}")),
    }
}

fn value_at(value: &SVal, path: &str) -> R<f64> {
    match value {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(format!("{path}: expected a finite number, got {other:?}")),
    }
}

fn number(v: &SVal, key: &str, path: &str) -> R<f64> {
    let target = path_of(path, key);
    value_at(v.field(key, path)?, &target)
}

fn int_at(value: &SVal, path: &str, max: u64) -> R<u64> {
    let number = value_at(value, path)?;
    if number >= 0. && number.fract() == 0. && number <= max as f64 {
        Ok(number as u64)
    } else {
        Err(format!(
            "{path}: expected an integer in 0..={max}, got {number}"
        ))
    }
}

fn uint(v: &SVal, key: &str, path: &str, max: u64) -> R<u64> {
    let target = path_of(path, key);
    int_at(v.field(key, path)?, &target, max)
}

fn boolv(v: &SVal, key: &str, path: &str) -> R<bool> {
    let target = path_of(path, key);
    v.field(key, path)?.bool(&target)
}

fn arr<'a>(v: &'a SVal, key: &str, path: &str) -> R<&'a [SVal]> {
    let target = path_of(path, key);
    v.field(key, path)?.arr(&target)
}

fn finite_sval(v: &SVal, path: &str) -> R<()> {
    match v {
        SVal::Num(number) if !number.is_finite() => {
            Err(format!("{path}: nonfinite declared input"))
        }
        SVal::Arr(values) | SVal::Set(values) => {
            for (index, value) in values.iter().enumerate() {
                finite_sval(value, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        SVal::Map(entries) => {
            for (index, (key, value)) in entries.iter().enumerate() {
                finite_sval(key, &format!("{path}.key[{index}]"))?;
                finite_sval(value, &format!("{path}.value[{index}]"))?;
            }
            Ok(())
        }
        SVal::Obj(entries) => {
            for (key, value) in entries {
                finite_sval(value, &path_of(path, key))?;
            }
            Ok(())
        }
        SVal::Instance { entries, .. } => {
            for (key, value) in entries {
                finite_sval(value, &path_of(path, key))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn strict_keys(v: &SVal, allowed: &[&str], path: &str) -> R<()> {
    match v {
        SVal::Obj(entries) => {
            for (key, _) in entries {
                if !allowed.contains(&key.as_str()) {
                    return Err(format!("{path}: unsupported field {key}"));
                }
            }
            Ok(())
        }
        other => Err(format!("{path}: expected an object, got {other:?}")),
    }
}

fn require(v: &SVal, keys: &[&str], path: &str) -> R<()> {
    for key in keys {
        if v.optional(key).is_none() {
            return Err(missing(path, key));
        }
    }
    Ok(())
}

fn closed(v: &SVal, keys: &[&str], path: &str) -> R<()> {
    strict_keys(v, keys, path)?;
    require(v, keys, path)
}

fn closed_with_optional(v: &SVal, required: &[&str], optional: &[&str], path: &str) -> R<()> {
    let mut allowed: Vec<&str> = Vec::with_capacity(required.len() + optional.len());
    allowed.extend_from_slice(required);
    allowed.extend_from_slice(optional);
    strict_keys(v, &allowed, path)?;
    require(v, required, path)
}

fn one<'a>(value: &'a str, allowed: &[&str], path: &str) -> R<&'a str> {
    if allowed.contains(&value) {
        Ok(value)
    } else {
        Err(unsupported(path, value))
    }
}

fn faction_named(name: &str, path: &str) -> R<FactionId> {
    FactionId::parse(name).ok_or_else(|| format!("{path}: unknown faction {name}"))
}

fn nullable_faction(v: &SVal, key: &str, path: &str) -> R<Option<FactionId>> {
    let target = path_of(path, key);
    match v.field(key, path)? {
        SVal::Null => Ok(None),
        SVal::Str(name) => faction_named(name, &target).map(Some),
        other => Err(format!(
            "{target}: expected a faction string|null, got {other:?}"
        )),
    }
}

fn weapon_named(name: &str, path: &str) -> R<WeaponId> {
    WeaponId::parse(name).ok_or_else(|| format!("{path}: unknown weapon {name}"))
}

fn nullable_weapon(v: &SVal, key: &str, path: &str) -> R<Option<WeaponId>> {
    let target = path_of(path, key);
    match v.field(key, path)? {
        SVal::Null => Ok(None),
        SVal::Str(name) => weapon_named(name, &target).map(Some),
        other => Err(format!(
            "{target}: expected a weapon string|null, got {other:?}"
        )),
    }
}

fn required_weapon(v: &SVal, key: &str, path: &str) -> R<WeaponId> {
    let target = path_of(path, key);
    match v.field(key, path)? {
        SVal::Str(name) => weapon_named(name, &target),
        SVal::Null => Err(format!(
            "{target}: declared null has no native WeaponId representation"
        )),
        other => Err(format!("{target}: expected a weapon string, got {other:?}")),
    }
}

fn weapon_list(v: &SVal, path: &str) -> R<[Option<WeaponId>; 2]> {
    let values = v.arr(path)?;
    if values.len() != 2 {
        return Err(format!(
            "{path}: the source weapon tuple has exactly two slots, got {}",
            values.len()
        ));
    }
    let mut weapons = [None, None];
    for (index, value) in values.iter().enumerate() {
        let target = format!("{path}[{index}]");
        weapons[index] = match value {
            SVal::Null => None,
            SVal::Str(name) => Some(weapon_named(name, &target)?),
            other => {
                return Err(format!(
                    "{target}: expected a weapon string|null, got {other:?}"
                ))
            }
        };
    }
    Ok(weapons)
}

fn vector(v: &SVal, path: &str) -> R<Vec2> {
    if !matches!(v, SVal::Obj(_)) {
        return Err(format!("{path}: expected a point object"));
    }
    Ok(Vec2::new(number(v, "x", path)?, number(v, "y", path)?))
}

fn closed_point(v: &SVal, path: &str) -> R<Vec2> {
    closed(v, &["x", "y"], path)?;
    vector(v, path)
}

fn presence_number(v: &SVal, key: &str, path: &str) -> R<Presence<f64>> {
    let target = path_of(path, key);
    match v.optional(key) {
        None => Ok(Presence::Absent),
        Some(SVal::Undefined) => Ok(Presence::Undefined),
        Some(value) => Ok(Presence::Value(value_at(value, &target)?)),
    }
}

/// Convert a parsed source value to the owned declared `MethodValue` record (ordered Object/Array, no collections or
/// executable tags; non-finite numbers are declarations violations, never internal sentinels).
fn method_value(v: &SVal, path: &str) -> R<MethodValue> {
    Ok(match v {
        SVal::Undefined => MethodValue::Undefined,
        SVal::Null => MethodValue::Null,
        SVal::Bool(flag) => MethodValue::Bool(*flag),
        SVal::Num(number) => {
            if !number.is_finite() {
                return Err(format!("{path}: nonfinite declared input"));
            }
            MethodValue::Num(*number)
        }
        SVal::Str(text) => MethodValue::Str(text.clone()),
        SVal::Arr(values) => MethodValue::Arr(
            values
                .iter()
                .enumerate()
                .map(|(index, value)| method_value(value, &format!("{path}[{index}]")))
                .collect::<R<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => MethodValue::Obj(
            entries
                .iter()
                .map(|(key, value)| Ok((key.clone(), method_value(value, &path_of(path, key))?)))
                .collect::<R<Vec<_>>>()?,
        ),
        other => {
            return Err(format!(
                "{path}: unsupported declared value {other:?} (only undefined/null/bool/number/string/array/object)"
            ))
        }
    })
}

fn suite_named(name: &str) -> Option<Suite> {
    Some(match name {
        "tactics" => Suite::Tactics,
        "fight" => Suite::Fight,
        "world" => Suite::World,
        "orb" => Suite::Orb,
        "reflex" => Suite::Reflex,
        "retreat" => Suite::Retreat,
        _ => return None,
    })
}

/// `object` tags keep an ordered entry list, so a duplicate member name is not a JSON-key collision the JSON parser can
/// report. The generic tagged reader rejects it but only names the entry index; this pre-scan names the declared field so
/// the typed error identifies the consumed fact.
fn check_duplicate_tagged_keys(value: &Value, path: &str) -> R<()> {
    match value {
        Value::Object(map) => {
            if map.get("$").and_then(Value::as_str) == Some("object") {
                if let Some(entries) = map.get("entries").and_then(Value::as_array) {
                    let mut seen: Vec<&str> = Vec::with_capacity(entries.len());
                    for pair in entries {
                        let Some(pair) = pair.as_array().filter(|pair| pair.len() == 2) else {
                            continue;
                        };
                        let Some(key) = pair[0].as_str() else {
                            continue;
                        };
                        if seen.contains(&key) {
                            return Err(format!("{path}: duplicate object key {key}"));
                        }
                        seen.push(key);
                        check_duplicate_tagged_keys(&pair[1], &path_of(path, key))?;
                    }
                    return Ok(());
                }
            }
            for nested in map.values() {
                check_duplicate_tagged_keys(nested, path)?;
            }
            Ok(())
        }
        Value::Array(rows) => {
            for row in rows {
                check_duplicate_tagged_keys(row, path)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

// ------------------------------------------------------------------------------------------------------------- corpus

/// Decode the whole frozen corpus (strict inputs only). The envelope/profile validation lives in `source_strict`.
pub(crate) fn decode_corpus(source: &Value) -> Result<DecodedCorpus, String> {
    let object = source
        .as_object()
        .ok_or_else(|| "source: expected the frozen corpus object".to_string())?;
    let maps = decode_maps(
        object
            .get("maps")
            .ok_or_else(|| "maps: missing declared map table".to_string())?,
    )?;
    let raw_cases = object
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| "cases: expected the plain declared case array".to_string())?;
    let mut cases = Vec::with_capacity(raw_cases.len());
    let mut ids: Vec<String> = Vec::with_capacity(raw_cases.len());
    for (index, raw_case) in raw_cases.iter().enumerate() {
        let case = decode_case(raw_case, &maps, &format!("cases[{index}]"))?;
        if ids.iter().any(|id| id == &case.id) {
            return Err(format!(
                "cases[{index}].id: duplicate source case id {}",
                case.id
            ));
        }
        ids.push(case.id.clone());
        cases.push(case);
    }
    Ok(DecodedCorpus { maps, cases })
}

fn decode_maps(raw_maps: &Value) -> R<Vec<DecodedMap>> {
    let rows = raw_maps
        .as_array()
        .ok_or_else(|| "maps: expected the plain declared array".to_string())?;
    let mut maps: Vec<DecodedMap> = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let path = format!("maps[{index}]");
        let object = row
            .as_object()
            .ok_or_else(|| format!("{path}: expected a map record object"))?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{path}.id: expected a map id string"))?
            .to_string();
        let value = object
            .get("value")
            .ok_or_else(|| format!("{path}.value: missing declared GameMap"))?;
        check_duplicate_tagged_keys(value, &format!("{path}.value"))?;
        let value = source_reader::parse(value, &format!("{path}.value"))?;
        let map = decode_map(&value, &format!("{path}.value"))?;
        if maps.iter().any(|map| map.id == id) {
            return Err(format!("{path}.id: duplicate declared map id {id}"));
        }
        maps.push(DecodedMap { id, map, value });
    }
    Ok(maps)
}

fn decode_map(value: &SVal, path: &str) -> R<TacticsMap> {
    if !matches!(value, SVal::Obj(_)) {
        return Err(format!("{path}: expected the declared GameMap object"));
    }
    let width = uint(value, "w", path, u64::from(u32::MAX))? as u32;
    let height = uint(value, "h", path, u64::from(u32::MAX))? as u32;
    let cells = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 {
        return Err(format!("{path}: declared map dimensions must be positive"));
    }
    let tiles = match field(value, "tiles", path)? {
        SVal::U8(tiles) => tiles.clone(),
        other => {
            return Err(format!(
                "{path}.tiles: expected the declared collision Uint8Array, got {other:?}"
            ))
        }
    };
    if tiles.len() as u64 != cells {
        return Err(format!(
            "{path}.tiles: declared collision length {} does not match {width}x{height}={cells}",
            tiles.len()
        ));
    }
    let region_grid = match field(value, "regionGrid", path)? {
        SVal::U8(regions) => regions.clone(),
        other => {
            return Err(format!(
                "{path}.regionGrid: expected the declared region Uint8Array, got {other:?}"
            ))
        }
    };
    if region_grid.len() as u64 != cells {
        return Err(format!(
            "{path}.regionGrid: declared region length {} does not match {width}x{height}={cells}",
            region_grid.len()
        ));
    }
    let coliseum_path = path_of(path, "coliseum");
    let coliseum = field(value, "coliseum", path)?;
    let coliseum_centre = vector(
        field(coliseum, "centre", &coliseum_path)?,
        &path_of(&coliseum_path, "centre"),
    )?;
    let camps_path = path_of(path, "camps");
    let mut camps = Vec::new();
    for (index, camp) in field(value, "camps", path)?
        .arr(&camps_path)?
        .iter()
        .enumerate()
    {
        let camp_path = format!("{camps_path}[{index}]");
        if !matches!(camp, SVal::Obj(_)) {
            return Err(format!("{camp_path}: expected a declared camp object"));
        }
        let zone = faction_named(
            &text(camp, "zone", &camp_path)?,
            &path_of(&camp_path, "zone"),
        )?;
        let elite_spot = number(camp, "eliteSpot", &camp_path)?;
        let r = number(camp, "r", &camp_path)?;
        let radius = number(camp, "radius", &camp_path)?;
        let spots_path = path_of(&camp_path, "spots");
        let spots = camp
            .field("spots", &camp_path)?
            .arr(&spots_path)?
            .iter()
            .enumerate()
            .map(|(spot, point)| vector(point, &format!("{spots_path}[{spot}]")))
            .collect::<R<Vec<_>>>()?;
        camps.push(CampGeom {
            id: text(camp, "id", &camp_path)?,
            zone,
            elite: elite_spot >= 0.,
            x: number(camp, "x", &camp_path)?,
            y: number(camp, "y", &camp_path)?,
            radius: if radius > 0. { radius } else { r },
            spots,
        });
    }
    let tile_map =
        TileMap::new(width, height, tiles).map_err(|error| format!("{path}.tiles: {error}"))?;
    Ok(TacticsMap {
        tile_map,
        width,
        height,
        region_grid,
        coliseum_centre,
        camps,
    })
}

// ------------------------------------------------------------------------------------------------------------- config

fn decode_case(raw_case: &Value, maps: &[DecodedMap], path: &str) -> R<DecodedCase> {
    let object = raw_case
        .as_object()
        .ok_or_else(|| format!("{path}: expected a declared case object"))?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{path}.id: expected a case id string"))?
        .to_string();
    let suite_name = object
        .get("suite")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{path}.suite: expected a suite string"))?;
    let suite = suite_named(suite_name)
        .ok_or_else(|| format!("{path}.suite: unsupported source suite {suite_name}"))?;
    let covers = object
        .get("covers")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{path}.covers: expected the declared coverage labels"))?
        .iter()
        .enumerate()
        .map(|(index, cover)| {
            cover
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{path}.covers[{index}]: expected a coverage label string"))
        })
        .collect::<R<Vec<_>>>()?;
    let config_value = object
        .get("config")
        .ok_or_else(|| format!("{path}.config: missing the declared resolved config"))?;
    check_duplicate_tagged_keys(config_value, &path_of(path, "config"))?;
    let config = source_reader::parse(config_value, &path_of(path, "config"))?;
    finite_sval(&config, &path_of(path, "config"))?;
    let config = decode_config(&config, maps, &path_of(path, "config"))?;
    let operations = object
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{path}.operations: expected the declared operation array"))?;
    let mut decoded = Vec::with_capacity(operations.len());
    for (index, operation) in operations.iter().enumerate() {
        decoded.push(decode_operation(
            operation,
            suite,
            &config,
            &format!("{path}.operations[{index}]"),
        )?);
    }
    Ok(DecodedCase {
        id,
        suite,
        covers,
        config,
        operations: decoded,
    })
}

fn decode_config(config: &SVal, maps: &[DecodedMap], path: &str) -> R<TacticsConfig> {
    strict_keys(config, &CONFIG_KEYS, path)?;
    for key in CONFIG_REQUIRED_KEYS {
        if config.optional(key).is_none() {
            return Err(missing(path, key));
        }
    }
    let tier_name = text(config, "tier", path)?;
    one(&tier_name, &TIER_NAMES, &path_of(path, "tier"))?;
    let persona_name = text(config, "persona", path)?;
    one(&persona_name, &PERSONA_NAMES, &path_of(path, "persona"))?;
    let seed = uint(config, "seed", path, u64::from(u32::MAX))? as u32;
    let path_budget = uint(config, "pathBudget", path, u64::from(u32::MAX))? as u32;
    let id = text(config, "id", path)?;
    let name = text(config, "name", path)?;
    let map_id = text(config, "map", path)?;
    let map = maps
        .iter()
        .find(|map| map.id == map_id)
        .ok_or_else(|| format!("{path}.map: unknown declared map {map_id}"))?
        .map
        .clone();
    let features = decode_features(field(config, "features", path)?, &path_of(path, "features"))?;
    let declared_path = match config.optional("path") {
        None | Some(SVal::Null) => None,
        Some(value) => Some(decode_path_descriptor(value, &path_of(path, "path"))?),
    };
    let tier = decode_tier(
        field(config, "tierValues", path)?,
        &path_of(path, "tierValues"),
    )?;
    let persona = decode_persona(
        field(config, "personaValues", path)?,
        &path_of(path, "personaValues"),
    )?;
    if let Some(overrides) = config.optional("tierOverrides") {
        decode_tier_overrides(overrides, &path_of(path, "tierOverrides"))?;
    }
    if let Some(overrides) = config.optional("personaOverrides") {
        decode_persona_overrides(overrides, &path_of(path, "personaOverrides"))?;
    }
    decode_modules(field(config, "modules", path)?, &path_of(path, "modules"))?;
    decode_learned(field(config, "learned", path)?, &path_of(path, "learned"))?;
    decode_seeds(field(config, "seeds", path)?, &path_of(path, "seeds"))?;
    Ok(TacticsConfig {
        id,
        name,
        seed,
        tier,
        persona,
        map,
        features,
        path_budget,
        path: declared_path,
    })
}

fn decode_path_descriptor(v: &SVal, path: &str) -> R<PathDescriptor> {
    if !matches!(v, SVal::Obj(_)) {
        return Err(format!(
            "{path}: expected a declared path descriptor object"
        ));
    }
    match text(v, "kind", path)?.as_str() {
        "radius-denial" => {
            closed(v, &["kind", "radius"], path)?;
            Ok(PathDescriptor::RadiusDenial {
                radius: number(v, "radius", path)?,
            })
        }
        "half-plane" => {
            closed(v, &["kind", "x"], path)?;
            Ok(PathDescriptor::HalfPlane {
                x: number(v, "x", path)?,
            })
        }
        other => Err(format!("{path}.kind: unsupported path descriptor {other}")),
    }
}

fn decode_features(v: &SVal, path: &str) -> R<Features> {
    closed(v, &FEATURE_KEYS, path)?;
    let message_types_path = path_of(path, "messageTypes");
    let message_types = arr(v, "messageTypes", path)?
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let label = format!("{message_types_path}[{index}]");
            let message = message.string(&label)?.to_string();
            one(&message, &FEATURE_MESSAGE_NAMES, &label)?;
            Ok(message)
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Features {
        message_types,
        wishes: boolv(v, "wishes", path)?,
        status_effects: boolv(v, "statusEffects", path)?,
        fields: boolv(v, "fields", path)?,
        planning: boolv(v, "planning", path)?,
        chests: boolv(v, "chests", path)?,
        skills: boolv(v, "skills", path)?,
        relics: boolv(v, "relics", path)?,
        camps: boolv(v, "camps", path)?,
        hazards: boolv(v, "hazards", path)?,
    })
}

fn decode_tier(v: &SVal, path: &str) -> R<TierParams> {
    closed(
        v,
        &[
            "id",
            "reaction",
            "step",
            "daze",
            "refractoryMs",
            "thinkMs",
            "strategyMs",
            "apm",
            "burst",
            "minGapMs",
            "moveScatter",
            "targetScatter",
            "minimapSigma",
            "edgeClickP",
            "timingSigmaMs",
            "hesitation",
            "softmaxT",
            "lapseP",
            "dodgeP",
            "jukeP",
            "orbwalk",
            "knowledge",
            "mobShareNoise",
            "route",
            "attention",
            "memorySpanMs",
            "feintRead",
            "appraisal",
            "wary",
            "caution",
        ],
        path,
    )?;
    let id_name = text(v, "id", path)?;
    let id =
        TierId::parse(&id_name).ok_or_else(|| format!("{}.id: unknown tier {id_name}", path))?;
    Ok(TierParams {
        id,
        reaction: decode_ex_gaussian(field(v, "reaction", path)?, &path_of(path, "reaction"))?,
        step: decode_ex_gaussian(field(v, "step", path)?, &path_of(path, "step"))?,
        daze: decode_ex_gaussian(field(v, "daze", path)?, &path_of(path, "daze"))?,
        refractory_ms: number(v, "refractoryMs", path)?,
        think_ms: decode_cadence(field(v, "thinkMs", path)?, &path_of(path, "thinkMs"))?,
        strategy_ms: decode_cadence(field(v, "strategyMs", path)?, &path_of(path, "strategyMs"))?,
        apm: number(v, "apm", path)?,
        burst: number(v, "burst", path)?,
        min_gap_ms: number(v, "minGapMs", path)?,
        move_scatter: decode_move_scatter(
            field(v, "moveScatter", path)?,
            &path_of(path, "moveScatter"),
        )?,
        target_scatter: decode_target_scatter(
            field(v, "targetScatter", path)?,
            &path_of(path, "targetScatter"),
        )?,
        minimap_sigma: number(v, "minimapSigma", path)?,
        edge_click_p: number(v, "edgeClickP", path)?,
        timing_sigma_ms: number(v, "timingSigmaMs", path)?,
        hesitation: decode_hesitation(field(v, "hesitation", path)?, &path_of(path, "hesitation"))?,
        softmax_t: number(v, "softmaxT", path)?,
        lapse_p: number(v, "lapseP", path)?,
        dodge_p: number(v, "dodgeP", path)?,
        juke_p: number(v, "jukeP", path)?,
        orbwalk: decode_orbwalk(field(v, "orbwalk", path)?, &path_of(path, "orbwalk"))?,
        knowledge: number(v, "knowledge", path)?,
        mob_share_noise: number(v, "mobShareNoise", path)?,
        route: decode_route(field(v, "route", path)?, &path_of(path, "route"))?,
        attention: decode_attention(field(v, "attention", path)?, &path_of(path, "attention"))?,
        memory_span_ms: number(v, "memorySpanMs", path)?,
        feint_read: number(v, "feintRead", path)?,
        appraisal: decode_appraisal(field(v, "appraisal", path)?, &path_of(path, "appraisal"))?,
        wary: number(v, "wary", path)?,
        caution: decode_caution(field(v, "caution", path)?, &path_of(path, "caution"))?,
    })
}

fn decode_ex_gaussian(v: &SVal, path: &str) -> R<ExGaussian> {
    closed(v, &["mu", "sigma", "tau", "floor", "cap"], path)?;
    Ok(ExGaussian {
        mu: number(v, "mu", path)?,
        sigma: number(v, "sigma", path)?,
        tau: number(v, "tau", path)?,
        floor: number(v, "floor", path)?,
        cap: number(v, "cap", path)?,
    })
}

fn decode_cadence(v: &SVal, path: &str) -> R<Cadence> {
    closed(v, &["mean", "jitter"], path)?;
    Ok(Cadence {
        mean: number(v, "mean", path)?,
        jitter: number(v, "jitter", path)?,
    })
}

fn decode_move_scatter(v: &SVal, path: &str) -> R<MoveScatter> {
    closed(v, &["base", "perUnit"], path)?;
    Ok(MoveScatter {
        base: number(v, "base", path)?,
        per_unit: number(v, "perUnit", path)?,
    })
}

fn decode_target_scatter(v: &SVal, path: &str) -> R<TargetScatter> {
    closed(v, &["sigma", "lagS", "slipP", "slipMult"], path)?;
    Ok(TargetScatter {
        sigma: number(v, "sigma", path)?,
        lag_s: number(v, "lagS", path)?,
        slip_p: number(v, "slipP", path)?,
        slip_mult: number(v, "slipMult", path)?,
    })
}

fn decode_hesitation(v: &SVal, path: &str) -> R<Hesitation> {
    closed(v, &["p", "minMs", "maxMs"], path)?;
    Ok(Hesitation {
        p: number(v, "p", path)?,
        min_ms: number(v, "minMs", path)?,
        max_ms: number(v, "maxMs", path)?,
    })
}

fn decode_orbwalk(v: &SVal, path: &str) -> R<Orbwalk> {
    closed(v, &["p", "stepU", "angleJitter"], path)?;
    Ok(Orbwalk {
        p: number(v, "p", path)?,
        step_u: number(v, "stepU", path)?,
        angle_jitter: number(v, "angleJitter", path)?,
    })
}

fn decode_route(v: &SVal, path: &str) -> R<Route> {
    closed(v, &["horizon", "walkPaths", "reach"], path)?;
    Ok(Route {
        horizon: uint(v, "horizon", path, u64::from(u32::MAX))? as u32,
        walk_paths: boolv(v, "walkPaths", path)?,
        reach: number(v, "reach", path)?,
    })
}

fn decode_attention(v: &SVal, path: &str) -> R<Attention> {
    closed(
        v,
        &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
        path,
    )?;
    Ok(Attention {
        central: number(v, "central", path)?,
        periphery_mult: number(v, "peripheryMult", path)?,
        engaged_mult: number(v, "engagedMult", path)?,
        reconsider_ms: number(v, "reconsiderMs", path)?,
    })
}

fn decode_appraisal(v: &SVal, path: &str) -> R<Appraisal> {
    closed(v, &["bias", "lead", "busy", "hue", "noise"], path)?;
    Ok(Appraisal {
        bias: number(v, "bias", path)?,
        lead: number(v, "lead", path)?,
        busy: number(v, "busy", path)?,
        hue: number(v, "hue", path)?,
        noise: number(v, "noise", path)?,
    })
}

fn decode_caution(v: &SVal, path: &str) -> R<Caution> {
    closed(v, &["mobShare", "eliteShare", "startHp"], path)?;
    Ok(Caution {
        mob_share: number(v, "mobShare", path)?,
        elite_share: number(v, "eliteShare", path)?,
        start_hp: number(v, "startHp", path)?,
    })
}

fn decode_persona(v: &SVal, path: &str) -> R<PersonaParams> {
    closed(
        v,
        &[
            "id",
            "pve",
            "pvp",
            "loot",
            "bounty",
            "thirdParty",
            "engageEdge",
            "bountyCaution",
            "fleeHp",
            "reengageHp",
            "kite",
            "chaseGiveUpMs",
            "mobKillGoal",
            "playerThreat",
            "eliteAppetite",
            "coliseum",
            "risk",
        ],
        path,
    )?;
    let id_name = text(v, "id", path)?;
    let id = PersonaId::parse(&id_name)
        .ok_or_else(|| format!("{}.id: unknown persona {id_name}", path))?;
    Ok(PersonaParams {
        id,
        pve: number(v, "pve", path)?,
        pvp: number(v, "pvp", path)?,
        loot: number(v, "loot", path)?,
        bounty: number(v, "bounty", path)?,
        third_party: number(v, "thirdParty", path)?,
        engage_edge: number(v, "engageEdge", path)?,
        bounty_caution: number(v, "bountyCaution", path)?,
        flee_hp: number(v, "fleeHp", path)?,
        reengage_hp: number(v, "reengageHp", path)?,
        kite: number(v, "kite", path)?,
        chase_give_up_ms: number(v, "chaseGiveUpMs", path)?,
        mob_kill_goal: number(v, "mobKillGoal", path)?,
        player_threat: number(v, "playerThreat", path)?,
        elite_appetite: number(v, "eliteAppetite", path)?,
        coliseum: number(v, "coliseum", path)?,
        risk: number(v, "risk", path)?,
    })
}

/// The declared overrides are closed subsets of the resolved values. `tierValues`/`personaValues` are already resolved,
/// so the overrides are validated for shape only and never re-applied over the resolved table.
fn decode_tier_overrides(v: &SVal, path: &str) -> R<()> {
    let entries = v
        .obj(path)
        .map_err(|_| format!("{path}: expected an override object"))?;
    for (key, value) in entries {
        let target = path_of(path, key);
        match key.as_str() {
            "id" => {
                let name = value.string(&target)?;
                one(name, &TIER_NAMES, &target)?;
            }
            "reaction" | "step" | "daze" => {
                partial_numbers(value, &["mu", "sigma", "tau", "floor", "cap"], &target)?;
            }
            "thinkMs" | "strategyMs" => {
                partial_numbers(value, &["mean", "jitter"], &target)?;
            }
            "moveScatter" => {
                partial_numbers(value, &["base", "perUnit"], &target)?;
            }
            "targetScatter" => {
                partial_numbers(value, &["sigma", "lagS", "slipP", "slipMult"], &target)?;
            }
            "hesitation" => {
                partial_numbers(value, &["p", "minMs", "maxMs"], &target)?;
            }
            "orbwalk" => {
                partial_numbers(value, &["p", "stepU", "angleJitter"], &target)?;
            }
            "route" => {
                partial_object(
                    value,
                    &["horizon", "walkPaths", "reach"],
                    &target,
                    |key, value, target| match key {
                        "horizon" => int_at(value, target, u64::from(u32::MAX)).map(|_| ()),
                        "walkPaths" => match value {
                            SVal::Bool(_) => Ok(()),
                            other => Err(format!("{target}: expected a boolean, got {other:?}")),
                        },
                        _ => value_at(value, target).map(|_| ()),
                    },
                )?;
            }
            "attention" => {
                partial_numbers(
                    value,
                    &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
                    &target,
                )?;
            }
            "appraisal" => {
                partial_numbers(value, &["bias", "lead", "busy", "hue", "noise"], &target)?;
            }
            "caution" => {
                partial_numbers(value, &["mobShare", "eliteShare", "startHp"], &target)?;
            }
            scalar if TIER_SCALAR_KEYS.contains(&scalar) => {
                value_at(value, &target)?;
            }
            other => return Err(format!("{path}: unsupported tier override {other}")),
        }
    }
    Ok(())
}

/// A declared override is a closed partial object: supplied members are typed strictly, missing members fall back to the
/// already-resolved `tierValues`/`personaValues`.
fn partial_object(
    v: &SVal,
    allowed: &[&str],
    path: &str,
    check: impl Fn(&str, &SVal, &str) -> R<()>,
) -> R<()> {
    match v {
        SVal::Obj(entries) => {
            for (key, value) in entries {
                if !allowed.contains(&key.as_str()) {
                    return Err(format!("{path}: unsupported field {key}"));
                }
                check(key, value, &path_of(path, key))?;
            }
            Ok(())
        }
        other => Err(format!(
            "{path}: expected an override object, got {other:?}"
        )),
    }
}

fn partial_numbers(v: &SVal, allowed: &[&str], path: &str) -> R<()> {
    partial_object(v, allowed, path, |_, value, target| {
        value_at(value, target).map(|_| ())
    })
}

fn decode_persona_overrides(v: &SVal, path: &str) -> R<()> {
    let entries = v
        .obj(path)
        .map_err(|_| format!("{path}: expected an override object"))?;
    for (key, value) in entries {
        let target = path_of(path, key);
        if key == "id" {
            let name = value.string(&target)?;
            one(name, &PERSONA_NAMES, &target)?;
        } else if PERSONA_SCALAR_KEYS.contains(&key.as_str()) {
            value_at(value, &target)?;
        } else {
            return Err(format!("{path}: unsupported persona override {key}"));
        }
    }
    Ok(())
}

fn decode_modules(v: &SVal, path: &str) -> R<()> {
    let rows = v
        .arr(path)
        .map_err(|_| format!("{path}: expected the declared module array"))?;
    for (index, row) in rows.iter().enumerate() {
        let target = format!("{path}[{index}]");
        strict_keys(row, &["id", "enabled", "goals"], &target)?;
        text(row, "id", &target)?;
        match row.field("enabled", &target)? {
            SVal::Bool(_) => {}
            SVal::Str(_) => {}
            other => {
                return Err(format!(
                    "{target}.enabled: expected a boolean or feature string, got {other:?}"
                ))
            }
        }
        if let Some(goals) = row.optional("goals") {
            goals.arr(&path_of(&target, "goals"))?;
        }
    }
    Ok(())
}

fn decode_learned(v: &SVal, path: &str) -> R<()> {
    closed(v, &["enabled", "biasDescriptor"], path)?;
    boolv(v, "enabled", path)?;
    text(v, "biasDescriptor", path)?;
    Ok(())
}

fn decode_seeds(v: &SVal, path: &str) -> R<()> {
    closed(v, &["decide", "motor", "lapse", "knowledge"], path)?;
    for key in ["decide", "motor", "lapse", "knowledge"] {
        number(v, key, path)?;
    }
    Ok(())
}

// -------------------------------------------------------------------------------------------------------- operations

fn decode_operation(
    raw_op: &Value,
    suite: Suite,
    config: &TacticsConfig,
    path: &str,
) -> R<DecodedOp> {
    let object = raw_op
        .as_object()
        .ok_or_else(|| format!("{path}: expected a declared operation object"))?;
    for key in object.keys() {
        if !OPERATION_KEYS.contains(&key.as_str()) {
            return Err(format!("{path}: unsupported operation field {key}"));
        }
    }
    for key in OPERATION_REQUIRED_KEYS {
        if !object.contains_key(key) {
            return Err(missing(path, key));
        }
    }
    if let Some(thrown) = object.get("thrown") {
        if !thrown.is_object() {
            return Err(format!("{path}.thrown: expected a declared thrown object"));
        }
    }
    let method_name = object
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{path}.method: expected a method name string"))?;
    one(method_name, &METHOD_NAMES, &path_of(path, "method"))?;
    let declaration = object
        .get("declaration")
        .ok_or_else(|| format!("{path}.declaration: missing the declared method record"))?;
    check_duplicate_tagged_keys(declaration, &path_of(path, "declaration"))?;
    let declaration = source_reader::parse(declaration, &path_of(path, "declaration"))?;
    finite_sval(&declaration, &path_of(path, "declaration"))?;
    decode_declaration(
        &declaration,
        method_name,
        suite,
        config,
        &path_of(path, "declaration"),
    )
}

fn decode_declaration(
    declaration: &SVal,
    method_name: &str,
    suite: Suite,
    config: &TacticsConfig,
    path: &str,
) -> R<DecodedOp> {
    if !matches!(declaration, SVal::Obj(_)) {
        return Err(format!("{path}: expected the declared method object"));
    }
    let fields: &[&str] = match method_name {
        "observe" => &["input"],
        "act" => &["goal"],
        "noteSent" => &["input"],
        "recordChoice" => &["input"],
        "step" => &["foe", "weapon", "locked"],
        "reset" => {
            if suite == Suite::Orb {
                &["readyAt"]
            } else {
                &[]
            }
        }
        "point" => &["threats"],
        "check" => &[],
        "leave" => {
            return Err(format!(
                "{path}: the frozen private-tactics witness declares no leave operation"
            ))
        }
        "pickHoldSpot" => &["centre", "radius"],
        "inReach" => &["foe", "weapon"],
        other => return Err(format!("{path}.method: unsupported method {other}")),
    };
    let declared_method = text(declaration, "method", path)?;
    if declared_method != method_name {
        return Err(format!(
            "{path}.method: declared method {declared_method} does not match operation method {method_name}"
        ));
    }
    let mut allowed: Vec<&str> = Vec::with_capacity(fields.len() + 4);
    allowed.push("method");
    allowed.extend_from_slice(fields);
    allowed.extend_from_slice(&["env", "engaged", "knowsSuddenDeath"]);
    strict_keys(declaration, &allowed, path)?;
    for key in fields {
        if declaration.optional(key).is_none() {
            return Err(missing(path, key));
        }
    }
    let engaged = match declaration.optional("engaged") {
        None => false,
        Some(SVal::Bool(value)) => *value,
        Some(other) => return Err(format!("{path}.engaged: expected a boolean, got {other:?}")),
    };
    let knows_sudden_death = match declaration.optional("knowsSuddenDeath") {
        None => false,
        Some(SVal::Bool(value)) => *value,
        Some(other) => {
            return Err(format!(
                "{path}.knowsSuddenDeath: expected a boolean, got {other:?}"
            ))
        }
    };
    let env = match declaration.optional("env") {
        None => OpEnv {
            path: config.path,
            empty_path: false,
        },
        Some(env) => decode_op_env(env, config, &path_of(path, "env"))?,
    };
    let method = match method_name {
        "observe" => Method::Observe(Box::new(decode_observe_input(
            field(declaration, "input", path)?,
            &path_of(path, "input"),
        )?)),
        "act" => Method::Act(decode_goal(
            field(declaration, "goal", path)?,
            suite,
            &path_of(path, "goal"),
        )?),
        "noteSent" => Method::NoteSent(decode_note_sent(
            field(declaration, "input", path)?,
            &path_of(path, "input"),
        )?),
        "recordChoice" => Method::RecordChoice(text(declaration, "input", path)?),
        "step" => {
            let foe_path = path_of(path, "foe");
            let foe = field(declaration, "foe", path)?;
            closed(foe, &["id", "x", "y"], &foe_path)?;
            let id = text(foe, "id", &foe_path)?;
            let x = number(foe, "x", &foe_path)?;
            let y = number(foe, "y", &foe_path)?;
            Method::Step {
                foe: (id, Vec2::new(x, y)),
                weapon: required_weapon(declaration, "weapon", path)?,
                locked: boolv(declaration, "locked", path)?,
            }
        }
        "reset" => {
            if suite == Suite::Orb {
                Method::Reset(Some(number(declaration, "readyAt", path)?))
            } else {
                Method::Reset(None)
            }
        }
        "point" => {
            let threats_path = path_of(path, "threats");
            let threats = field(declaration, "threats", path)?
                .arr(&threats_path)?
                .iter()
                .enumerate()
                .map(|(index, threat)| vector(threat, &format!("{threats_path}[{index}]")))
                .collect::<R<Vec<_>>>()?;
            Method::Point(threats)
        }
        "check" => Method::Check,
        "pickHoldSpot" => Method::PickHoldSpot {
            centre: vector(
                field(declaration, "centre", path)?,
                &path_of(path, "centre"),
            )?,
            radius: number(declaration, "radius", path)?,
        },
        "inReach" => {
            let foe_path = path_of(path, "foe");
            let foe = field(declaration, "foe", path)?;
            if !matches!(foe, SVal::Obj(_)) {
                return Err(format!("{foe_path}: expected the declared foe object"));
            }
            Method::InReach {
                foe: (
                    number(foe, "x", &foe_path)?,
                    number(foe, "y", &foe_path)?,
                    boolv(foe, "los", &foe_path)?,
                ),
                weapon: required_weapon(declaration, "weapon", path)?,
            }
        }
        other => return Err(format!("{path}.method: unsupported method {other}")),
    };
    Ok(DecodedOp {
        method,
        engaged,
        env,
        knows_sudden_death,
    })
}

fn decode_op_env(v: &SVal, config: &TacticsConfig, path: &str) -> R<OpEnv> {
    strict_keys(v, &["path", "emptyPath"], path)?;
    let descriptor = match v.optional("path") {
        None | Some(SVal::Null) => config.path,
        Some(value) => Some(decode_path_descriptor(value, &path_of(path, "path"))?),
    };
    let empty_path = match v.optional("emptyPath") {
        None | Some(SVal::Null) => false,
        Some(SVal::Bool(value)) => *value,
        Some(other) => {
            return Err(format!(
                "{path}.emptyPath: expected a boolean, got {other:?}"
            ))
        }
    };
    Ok(OpEnv {
        path: descriptor,
        empty_path,
    })
}

fn decode_goal(v: &SVal, suite: Suite, path: &str) -> R<Goal> {
    if !matches!(v, SVal::Obj(_)) {
        return Err(format!("{path}: expected the declared goal object"));
    }
    match suite {
        Suite::Fight => decode_fight_ref_goal(v, path),
        _ => decode_tactics_goal(v, path),
    }
}

/// `Fight.act(ctx, {id,kind}, knowsSuddenDeath)`: only the farm/hunt/fight FightRef kinds exist for the fight suite.
fn decode_fight_ref_goal(v: &SVal, path: &str) -> R<Goal> {
    closed(v, &["id", "kind"], path)?;
    let id = text(v, "id", path)?;
    let kind = text(v, "kind", path)?;
    match kind.as_str() {
        "farm" => Ok(Goal::Farm {
            mob: id,
            camp: None,
        }),
        "hunt" => Ok(Goal::Hunt { target: id }),
        "fight" => Ok(Goal::Fight { target: id }),
        other => Err(format!("{path}.kind: unsupported FightRef kind {other}")),
    }
}

fn decode_tactics_goal(v: &SVal, path: &str) -> R<Goal> {
    let kind = text(v, "kind", path)?;
    match kind.as_str() {
        "idle" => {
            closed(v, &["kind"], path)?;
            Ok(Goal::Idle)
        }
        "farm" => {
            closed(v, &["kind", "mob", "camp"], path)?;
            Ok(Goal::Farm {
                mob: text(v, "mob", path)?,
                camp: nullable_text(v, "camp", path)?,
            })
        }
        "hunt" => {
            closed(v, &["kind", "target"], path)?;
            Ok(Goal::Hunt {
                target: text(v, "target", path)?,
            })
        }
        "fight" => {
            closed(v, &["kind", "target"], path)?;
            Ok(Goal::Fight {
                target: text(v, "target", path)?,
            })
        }
        "loot" => {
            closed(v, &["kind", "container"], path)?;
            Ok(Goal::Loot {
                container: text(v, "container", path)?,
            })
        }
        "flee" => {
            closed(v, &["kind", "from", "until"], path)?;
            let threats_path = path_of(path, "from");
            let from = field(v, "from", path)?
                .arr(&threats_path)?
                .iter()
                .enumerate()
                .map(|(index, point)| vector(point, &format!("{threats_path}[{index}]")))
                .collect::<R<Vec<_>>>()?;
            Ok(Goal::Flee {
                from,
                until: number(v, "until", path)?,
            })
        }
        "roam" => {
            closed(v, &["kind", "to", "why"], path)?;
            let why = match text(v, "why", path)?.as_str() {
                "explore" => RoamWhy::Explore,
                "camp" => RoamWhy::Camp,
                "lastSeen" => RoamWhy::LastSeen,
                "coliseum" => RoamWhy::Coliseum,
                "centre" => RoamWhy::Centre,
                other => return Err(unsupported(&path_of(path, "why"), other)),
            };
            Ok(Goal::Roam {
                to: vector(field(v, "to", path)?, &path_of(path, "to"))?,
                why,
            })
        }
        "hold" => {
            closed(v, &["kind", "at", "why"], path)?;
            let why = match text(v, "why", path)?.as_str() {
                "coliseum" => HoldWhy::Coliseum,
                "ambush" => HoldWhy::Ambush,
                "wait" => HoldWhy::Wait,
                other => return Err(unsupported(&path_of(path, "why"), other)),
            };
            Ok(Goal::Hold {
                at: vector(field(v, "at", path)?, &path_of(path, "at"))?,
                why,
            })
        }
        "module" => {
            closed(v, &["kind", "module", "data"], path)?;
            let data_path = path_of(path, "data");
            let data = field(v, "data", path)?;
            if !matches!(data, SVal::Obj(_)) {
                return Err(format!(
                    "{data_path}: expected the declared module data object"
                ));
            }
            Ok(Goal::Module {
                module: text(v, "module", path)?,
                data: method_value(data, &data_path)?,
            })
        }
        other => Err(format!("{path}.kind: unknown goal kind {other}")),
    }
}

fn decode_note_sent(input: &SVal, path: &str) -> R<MemoryTimedCommand> {
    strict_keys(
        input,
        &["at", "cmd", "intent", "priority", "stimulus"],
        path,
    )?;
    let at = number(input, "at", path)?;
    if let Some(intent) = input.optional("intent") {
        if !matches!(intent, SVal::Str(_)) {
            return Err(format!("{}.intent: expected a string", path));
        }
    }
    if let Some(priority) = input.optional("priority") {
        int_at(priority, &path_of(path, "priority"), u64::from(u32::MAX))?;
    }
    let command_path = path_of(path, "cmd");
    let command = field(input, "cmd", path)?;
    strict_keys(command, &["type", "msg"], &command_path)?;
    let command_type = text(command, "type", &command_path)?;
    let message_path = path_of(&command_path, "msg");
    let message = field(command, "msg", &command_path)?;
    if !COMMAND_TYPE_NAMES.contains(&command_type.as_str()) {
        return Err(unsupported(&path_of(&command_path, "type"), &command_type));
    }
    let cmd = match command_type.as_str() {
        "move" => {
            strict_keys(message, &["x", "y", "seq"], &message_path)?;
            MemoryCommand::Move {
                x: number(message, "x", &message_path)?,
                y: number(message, "y", &message_path)?,
                seq: optional_finite(message, "seq", &message_path)?,
            }
        }
        "stop" => {
            strict_keys(message, &["seq"], &message_path)?;
            MemoryCommand::Stop {
                seq: optional_finite(message, "seq", &message_path)?,
            }
        }
        "target" => {
            strict_keys(message, &["id"], &message_path)?;
            MemoryCommand::Target {
                id: text(message, "id", &message_path)?,
            }
        }
        "pickup" => {
            strict_keys(message, &["containerId"], &message_path)?;
            MemoryCommand::Pickup {
                container_id: text(message, "containerId", &message_path)?,
            }
        }
        "cast" => MemoryCommand::Cast,
        "attack" | "release" | "swap" | "plan" | "choose" | "useConsumable" => MemoryCommand::Other,
        other => return Err(unsupported(&path_of(&command_path, "type"), other)),
    };
    Ok(MemoryTimedCommand {
        at,
        cmd,
        raw: method_value(input, path)?,
    })
}

fn optional_finite(v: &SVal, key: &str, path: &str) -> R<Option<f64>> {
    let target = path_of(path, key);
    match v.optional(key) {
        None | Some(SVal::Null) => Ok(None),
        Some(value) => Ok(Some(value_at(value, &target)?)),
    }
}

// ------------------------------------------------------------------------------------------------------------ percept

fn decode_observe_input(input: &SVal, path: &str) -> R<ObserveInput> {
    if !matches!(input, SVal::Obj(_)) {
        return Err(format!("{path}: expected the declared Percept object"));
    }
    closed(input, &PERCEPT_KEYS, path)?;
    let percept = decode_percept(input, path)?;
    let memory = memory_percept(&percept);
    Ok(ObserveInput { percept, memory })
}

/// Build the typed `TacticPercept` from one already-shaped `SVal` percept object. This is the shared native decoder for
/// tagged witness observe declarations and the plain-JSON legacy corpus bridge.
fn decode_percept(input: &SVal, path: &str) -> R<TacticPercept> {
    Ok(TacticPercept {
        now: number(input, "now", path)?,
        view_t: number(input, "viewT", path)?,
        self_: decode_self(field(input, "self", path)?, &path_of(path, "self"))?,
        hud: decode_hud(field(input, "hud", path)?, &path_of(path, "hud"))?,
        fighters: decode_fighters(field(input, "fighters", path)?, &path_of(path, "fighters"))?,
        mobs: decode_mobs(field(input, "mobs", path)?, &path_of(path, "mobs"))?,
        containers: decode_containers(
            field(input, "containers", path)?,
            &path_of(path, "containers"),
        )?,
        projectiles: decode_projectiles(
            field(input, "projectiles", path)?,
            &path_of(path, "projectiles"),
        )?,
        minimap: decode_minimap(field(input, "minimap", path)?, &path_of(path, "minimap"))?,
        events: decode_events(field(input, "events", path)?, &path_of(path, "events"))?,
        extras: decode_extras(field(input, "extras", path)?, &path_of(path, "extras"))?,
        features: decode_features(field(input, "features", path)?, &path_of(path, "features"))?,
    })
}

fn decode_self(v: &SVal, path: &str) -> R<TacticSelf> {
    closed_with_optional(v, &SELF_REQUIRED_KEYS, &SELF_OPTIONAL_KEYS, path)?;
    let id = text(v, "id", path)?;
    let name = text(v, "name", path)?;
    let x = number(v, "x", path)?;
    let y = number(v, "y", path)?;
    let status = one(
        &text(v, "status", path)?,
        &STATUS_NAMES,
        &path_of(path, "status"),
    )?
    .to_string();
    let weapons = weapon_list(field(v, "weapons", path)?, &path_of(path, "weapons"))?;
    Ok(TacticSelf {
        id,
        name,
        x,
        y,
        facing: number(v, "facing", path)?,
        status,
        hp: number(v, "hp", path)?,
        max_hp: number(v, "maxHp", path)?,
        barrier: number(v, "barrier", path)?,
        faction: nullable_faction(v, "faction", path)?,
        weapons,
        slot: uint(v, "slot", path, 1)? as u8,
        attack_target: nullable_text(v, "attackTarget", path)?,
        draw_started_at: number(v, "drawStartedAt", path)?,
        ready_at: number(v, "readyAt", path)?,
        immune_until: number(v, "immuneUntil", path)?,
        sig: number(v, "sig", path)?,
        brand: number(v, "brand", path)?,
        power: number(v, "power", path)?,
        as_mult: number(v, "asMult", path)?,
        windup_mult: presence_number(v, "windupMult", path)?,
        speed_mult: number(v, "speedMult", path)?,
        kills: number(v, "kills", path)?,
        mob_kills: number(v, "mobKills", path)?,
        gv: number(v, "gv", path)?,
        bounty: number(v, "bounty", path)?,
        move_seq: number(v, "moveSeq", path)?,
    })
}

fn decode_hud(v: &SVal, path: &str) -> R<TacticHud> {
    closed(v, &HUD_KEYS, path)?;
    Ok(TacticHud {
        phase: text(v, "phase", path)?,
        training: boolv(v, "training", path)?,
        lobby_ends_at: number(v, "lobbyEndsAt", path)?,
        raid_started_at: number(v, "raidStartedAt", path)?,
        patience_ends_at: number(v, "patienceEndsAt", path)?,
        sudden_death_at: number(v, "suddenDeathAt", path)?,
        in_coliseum: boolv(v, "inColiseum", path)?,
        gates_locked: boolv(v, "gatesLocked", path)?,
        started_with: number(v, "startedWith", path)?,
        alive: number(v, "alive", path)?,
        player_count: number(v, "playerCount", path)?,
        min_players: number(v, "minPlayers", path)?,
        winner: text(v, "winner", path)?,
    })
}

fn decode_fighters(v: &SVal, path: &str) -> R<Vec<TacticFighter>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared fighter array"))?
        .iter()
        .enumerate()
        .map(|(index, fighter)| {
            let target = format!("{path}[{index}]");
            closed(fighter, &FIGHTER_KEYS, &target)?;
            Ok(TacticFighter {
                id: text(fighter, "id", &target)?,
                name: text(fighter, "name", &target)?,
                bot: boolv(fighter, "bot", &target)?,
                x: number(fighter, "x", &target)?,
                y: number(fighter, "y", &target)?,
                facing: number(fighter, "facing", &target)?,
                status: one(
                    &text(fighter, "status", &target)?,
                    &STATUS_NAMES,
                    &path_of(&target, "status"),
                )?
                .to_string(),
                hp_frac: number(fighter, "hpFrac", &target)?,
                barrier_frac: number(fighter, "barrierFrac", &target)?,
                faction: nullable_faction(fighter, "faction", &target)?,
                in_hand: nullable_weapon(fighter, "inHand", &target)?,
                draw_started_at: number(fighter, "drawStartedAt", &target)?,
                bounty: number(fighter, "bounty", &target)?,
                immune: boolv(fighter, "immune", &target)?,
                sig: number(fighter, "sig", &target)?,
                brand: number(fighter, "brand", &target)?,
                targetable: boolv(fighter, "targetable", &target)?,
                vx: number(fighter, "vx", &target)?,
                vy: number(fighter, "vy", &target)?,
                dist: number(fighter, "dist", &target)?,
                los: boolv(fighter, "los", &target)?,
                tint: number(fighter, "tint", &target)?,
                central: boolv(fighter, "central", &target)?,
            })
        })
        .collect()
}

fn decode_mobs(v: &SVal, path: &str) -> R<Vec<TacticMob>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared mob array"))?
        .iter()
        .enumerate()
        .map(|(index, mob)| {
            let target = format!("{path}[{index}]");
            closed(mob, &MOB_KEYS, &target)?;
            Ok(TacticMob {
                id: text(mob, "id", &target)?,
                type_: nullable_text(mob, "type", &target)?,
                kind: one(
                    &text(mob, "kind", &target)?,
                    &MOB_KIND_NAMES,
                    &path_of(&target, "kind"),
                )?
                .to_string(),
                name: text(mob, "name", &target)?,
                faction: nullable_faction(mob, "faction", &target)?,
                x: number(mob, "x", &target)?,
                y: number(mob, "y", &target)?,
                facing: number(mob, "facing", &target)?,
                status: one(
                    &text(mob, "status", &target)?,
                    &STATUS_NAMES,
                    &path_of(&target, "status"),
                )?
                .to_string(),
                hp_frac: number(mob, "hpFrac", &target)?,
                in_hand: nullable_weapon(mob, "inHand", &target)?,
                draw_started_at: number(mob, "drawStartedAt", &target)?,
                sig: number(mob, "sig", &target)?,
                brand: number(mob, "brand", &target)?,
                vx: number(mob, "vx", &target)?,
                vy: number(mob, "vy", &target)?,
                dist: number(mob, "dist", &target)?,
                los: boolv(mob, "los", &target)?,
                central: boolv(mob, "central", &target)?,
            })
        })
        .collect()
}

fn decode_containers(v: &SVal, path: &str) -> R<Vec<TacticContainer>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared container array"))?
        .iter()
        .enumerate()
        .map(|(index, container)| {
            let target = format!("{path}[{index}]");
            closed(container, &CONTAINER_KEYS, &target)?;
            let weapon_path = path_of(&target, "weapon");
            let weapon = match field(container, "weapon", &target)? {
                SVal::Undefined => ContainersWeapon::Undefined,
                SVal::Null => ContainersWeapon::Null,
                SVal::Str(name) => ContainersWeapon::Weapon(weapon_named(name, &weapon_path)?),
                other => {
                    return Err(format!(
                        "{weapon_path}: expected undefined|weapon|null, got {other:?}"
                    ))
                }
            };
            Ok(TacticContainer {
                id: text(container, "id", &target)?,
                kind: text(container, "kind", &target)?,
                x: number(container, "x", &target)?,
                y: number(container, "y", &target)?,
                label: text(container, "label", &target)?,
                closed: boolv(container, "closed", &target)?,
                weapon,
                interactable: boolv(container, "interactable", &target)?,
                dist: number(container, "dist", &target)?,
            })
        })
        .collect()
}

fn projectile_kind(name: &str, path: &str) -> R<ProjectileKind> {
    match name {
        "arrow" => Ok(ProjectileKind::Arrow),
        "ball" => Ok(ProjectileKind::Ball),
        other => Err(unsupported(path, other)),
    }
}

fn decode_projectiles(v: &SVal, path: &str) -> R<Vec<TacticProjectile>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared projectile array"))?
        .iter()
        .enumerate()
        .map(|(index, projectile)| {
            let target = format!("{path}[{index}]");
            closed(projectile, &PROJECTILE_KEYS, &target)?;
            let kind_path = path_of(&target, "kind");
            Ok(TacticProjectile {
                id: text(projectile, "id", &target)?,
                kind: projectile_kind(&text(projectile, "kind", &target)?, &kind_path)?,
                x: number(projectile, "x", &target)?,
                y: number(projectile, "y", &target)?,
                vx: number(projectile, "vx", &target)?,
                vy: number(projectile, "vy", &target)?,
                x0: number(projectile, "x0", &target)?,
                y0: number(projectile, "y0", &target)?,
                t0: number(projectile, "t0", &target)?,
                range: number(projectile, "range", &target)?,
                from: nullable_text(projectile, "from", &target)?,
            })
        })
        .collect()
}

fn decode_minimap_mobs(v: &SVal, path: &str) -> R<Vec<TacticMinimapMob>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared minimap mob array"))?
        .iter()
        .enumerate()
        .map(|(index, dot)| {
            let target = format!("{path}[{index}]");
            closed(dot, &MINIMAP_MOB_KEYS, &target)?;
            Ok(TacticMinimapMob {
                id: text(dot, "id", &target)?,
                x: number(dot, "x", &target)?,
                y: number(dot, "y", &target)?,
                faction: nullable_faction(dot, "faction", &target)?,
                elite: boolv(dot, "elite", &target)?,
            })
        })
        .collect()
}

fn decode_minimap(v: &SVal, path: &str) -> R<TacticMinimap> {
    closed(v, &MINIMAP_KEYS, path)?;
    Ok(TacticMinimap {
        t: number(v, "t", path)?,
        mobs: decode_minimap_mobs(field(v, "mobs", path)?, &path_of(path, "mobs"))?,
        gates_locked: boolv(v, "gatesLocked", path)?,
    })
}

/// The required per-kind event fields (beyond `kind`/`t`/`at`), exactly the frozen reader's `req` sets.
fn event_fields(kind: &str, path: &str) -> R<&'static [&'static str]> {
    Ok(match kind {
        "windup" => &["by", "weapon", "a", "ms"],
        "swing" => &["by", "weapon", "a"],
        "hit" => &["id", "by", "amount", "weapon", "sig"],
        "block" => &["id", "by", "weapon"],
        "stagger" => &["id"],
        "cancel" => &["id"],
        "projEnd" => &["id", "proj", "reason"],
        "death" => &["id", "name", "by", "mob"],
        "heal" => &["id", "amount"],
        "teleport" => &[],
        "bounty" => &["id", "name", "bounty"],
        "victory" => &["id", "name", "draw"],
        "toast" => &["text"],
        "result" => &[],
        "private" => &["type", "msg"],
        "ext" => &["fx", "data"],
        other => return Err(unsupported(path, other)),
    })
}

fn decode_events(v: &SVal, path: &str) -> R<Vec<TacticEvent>> {
    v.arr(path)
        .map_err(|_| format!("{path}: expected the declared event array"))?
        .iter()
        .enumerate()
        .map(|(index, event)| {
            let target = format!("{path}[{index}]");
            if !matches!(event, SVal::Obj(_)) {
                return Err(format!("{target}: expected a declared event object"));
            }
            let kind = text(event, "kind", &target)?;
            one(&kind, &EVENT_KIND_NAMES, &path_of(&target, "kind"))?;
            let fields = event_fields(&kind, &path_of(&target, "kind"))?;
            let mut allowed: Vec<&str> = Vec::with_capacity(fields.len() + 5);
            allowed.extend_from_slice(&["kind", "t", "at", "id", "by"]);
            allowed.extend_from_slice(fields);
            strict_keys(event, &allowed, &target)?;
            require(event, &["kind", "t", "at"], &target)?;
            require(event, fields, &target)?;
            for key in ["id", "by"] {
                if let Some(value) = event.optional(key) {
                    if !matches!(value, SVal::Null | SVal::Str(_)) {
                        return Err(format!("{}.{key}: expected string|null", target));
                    }
                }
            }
            let t = number(event, "t", &target)?;
            let at = match field(event, "at", &target)? {
                SVal::Null => None,
                value => Some(vector(value, &path_of(&target, "at"))?),
            };
            let kind = decode_event_kind(event, &kind, &target)?;
            Ok(TacticEvent { t, at, kind })
        })
        .collect()
}

fn decode_event_kind(event: &SVal, kind: &str, path: &str) -> R<TacticEventKind> {
    Ok(match kind {
        "windup" => TacticEventKind::Windup {
            by: non_null_text(event, "by", path)?,
            weapon: required_weapon(event, "weapon", path)?,
            a: number(event, "a", path)?,
            ms: number(event, "ms", path)?,
        },
        "swing" => TacticEventKind::Swing {
            by: non_null_text(event, "by", path)?,
            weapon: required_weapon(event, "weapon", path)?,
            a: number(event, "a", path)?,
        },
        "hit" => TacticEventKind::Hit {
            id: non_null_text(event, "id", path)?,
            by: nullable_text(event, "by", path)?,
            amount: number(event, "amount", path)?,
            weapon: nullable_weapon(event, "weapon", path)?,
            sig: nullable_text(event, "sig", path)?,
        },
        "block" => TacticEventKind::Block {
            id: non_null_text(event, "id", path)?,
            by: nullable_text(event, "by", path)?,
            weapon: nullable_weapon(event, "weapon", path)?,
        },
        "stagger" => TacticEventKind::Stagger {
            id: non_null_text(event, "id", path)?,
        },
        "cancel" => TacticEventKind::Cancel {
            id: non_null_text(event, "id", path)?,
        },
        "projEnd" => TacticEventKind::ProjEnd {
            id: non_null_text(event, "id", path)?,
            proj: projectile_kind(&text(event, "proj", path)?, &path_of(path, "proj"))?,
            reason: text(event, "reason", path)?,
        },
        "death" => TacticEventKind::Death {
            id: non_null_text(event, "id", path)?,
            name: text(event, "name", path)?,
            by: nullable_text(event, "by", path)?,
            mob: boolv(event, "mob", path)?,
        },
        "heal" => TacticEventKind::Heal {
            id: non_null_text(event, "id", path)?,
            amount: number(event, "amount", path)?,
        },
        "teleport" => TacticEventKind::Teleport,
        "bounty" => TacticEventKind::Bounty {
            id: non_null_text(event, "id", path)?,
            name: text(event, "name", path)?,
            bounty: number(event, "bounty", path)?,
        },
        "victory" => TacticEventKind::Victory {
            id: nullable_text(event, "id", path)?,
            name: nullable_text(event, "name", path)?,
            draw: boolv(event, "draw", path)?,
        },
        "toast" => TacticEventKind::Toast {
            text: text(event, "text", path)?,
        },
        "result" => TacticEventKind::Result,
        "private" => {
            let message_path = path_of(path, "msg");
            let message = field(event, "msg", path)?;
            if !matches!(message, SVal::Obj(_)) {
                return Err(format!("{message_path}: expected the declared msg object"));
            }
            TacticEventKind::Private {
                type_: text(event, "type", path)?,
                msg: method_value(message, &message_path)?,
            }
        }
        "ext" => {
            let data_path = path_of(path, "data");
            let data = field(event, "data", path)?;
            if !matches!(data, SVal::Obj(_)) {
                return Err(format!(
                    "{data_path}: expected the declared ext data object"
                ));
            }
            TacticEventKind::Ext {
                fx: text(event, "fx", path)?,
                data: method_value(data, &data_path)?,
            }
        }
        other => return Err(unsupported(path, other)),
    })
}

fn decode_extras(v: &SVal, path: &str) -> R<PerceptExtras> {
    match v {
        SVal::Null => Ok(PerceptExtras::default()),
        SVal::Undefined => Err(format!(
            "{path}: declared Undefined extras (only an object subset or null is declared)"
        )),
        SVal::Obj(_) => {
            strict_keys(v, &["camps", "chests", "plan"], path)?;
            let mut extras = PerceptExtras::default();
            if let Some(camps) = v.optional("camps") {
                let camps_path = path_of(path, "camps");
                for (index, camp) in camps.arr(&camps_path)?.iter().enumerate() {
                    let target = format!("{camps_path}[{index}]");
                    closed(camp, &["id", "state"], &target)?;
                    let state = uint(camp, "state", &target, 2)? as u8;
                    extras.camps.push(PerceptCampView {
                        id: text(camp, "id", &target)?,
                        state,
                    });
                }
            }
            if let Some(chests) = v.optional("chests") {
                let chests_path = path_of(path, "chests");
                for (index, chest) in chests.arr(&chests_path)?.iter().enumerate() {
                    let target = format!("{chests_path}[{index}]");
                    closed(chest, &["id", "x", "y", "picked"], &target)?;
                    extras.chests.push(PerceptChest {
                        id: text(chest, "id", &target)?,
                        x: number(chest, "x", &target)?,
                        y: number(chest, "y", &target)?,
                        picked: boolv(chest, "picked", &target)?,
                    });
                }
            }
            if let Some(plan) = v.optional("plan") {
                let plan_path = path_of(path, "plan");
                match plan {
                    SVal::Null => {}
                    SVal::Undefined => {
                        return Err(format!(
                        "{plan_path}: declared Undefined plan (only an object or null is declared)"
                    ))
                    }
                    plan => {
                        closed(plan, &["endsAt"], &plan_path)?;
                        extras.plan = Some(PerceptPlan {
                            ends_at: number(plan, "endsAt", &plan_path)?,
                        });
                    }
                }
            }
            Ok(extras)
        }
        _ => Err(format!(
            "{path}: extras must be a declared object subset or null"
        )),
    }
}

/// The admitted `Memory.observe` input projection of the exact same declared Percept.
fn memory_percept(percept: &TacticPercept) -> MemoryPercept {
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

fn memory_event(kind: &TacticEventKind) -> PerceptEvent {
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

// ---------------------------------------------------------------------------------------- plain/legacy JSON bridge

/// Convert a plain (untagged) `serde_json` value into the ordered source `SVal` shape. This is only for the immutable
/// legacy corpora (`parity/policy/bot-fight|bot-reflex|bot-sd/source.json`), whose declared payloads are plain JSON with
/// the same field names as the tagged private-witness payloads; the MethodValue corpus reader never uses this bridge.
///
/// Objects become ordered `SVal::Obj` entries (`serde_json` map order), arrays become `SVal::Arr`, numbers become
/// `SVal::Num` (plain JSON numbers are finite by construction), and null/bool/string keep their exact tags.
pub(crate) fn decode_plain_json(value: &serde_json::Value) -> SVal {
    match value {
        Value::Null => SVal::Null,
        Value::Bool(flag) => SVal::Bool(*flag),
        Value::Number(number) => SVal::Num(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => SVal::Str(text.clone()),
        Value::Array(values) => SVal::Arr(values.iter().map(decode_plain_json).collect()),
        Value::Object(object) => SVal::Obj(
            object
                .iter()
                .map(|(key, value)| (key.clone(), decode_plain_json(value)))
                .collect(),
        ),
    }
}

/// Decode one legacy plain-JSON declared Percept through the same native Percept decoder the tagged witness observe
/// declarations use.
///
/// The old corpora keep the same declared field names but predate the `rh-method-value/1` tagging: an old `mobs` row is
/// the legacy actor view (the fighter fields plus `kind`, without `type`), and old objects may carry members the frozen
/// private witness later narrowed away. Only this compat bridge drops non-consumed members and completes the legacy mob
/// shape; `decode_corpus` itself stays strictly closed over the tagged witness schema.
pub(crate) fn decode_percept_plain(value: &serde_json::Value) -> Result<TacticPercept, String> {
    let normalized = normalize_plain_percept(value);
    let parsed = decode_plain_json(&normalized);
    finite_sval(&parsed, "plain percept")?;
    if !matches!(parsed, SVal::Obj(_)) {
        return Err("plain percept: expected the declared plain Percept object".to_string());
    }
    decode_percept(&parsed, "plain percept")
}

fn plain_retain(value: &Value, keys: &[&str]) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            keys.iter()
                .filter_map(|key| {
                    object
                        .get(*key)
                        .map(|value| ((*key).to_string(), value.clone()))
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

fn plain_retain_rows(value: &Value, keys: &[&str]) -> Value {
    match value {
        Value::Array(rows) => {
            Value::Array(rows.iter().map(|row| plain_retain(row, keys)).collect())
        }
        other => other.clone(),
    }
}

fn normalize_plain_mobs(value: &Value) -> Value {
    let Value::Array(rows) = value else {
        return value.clone();
    };
    Value::Array(
        rows.iter()
            .map(|row| {
                let mut mob = plain_retain(row, &MOB_KEYS);
                if let Value::Object(object) = &mut mob {
                    // The legacy actor view has no `type` member; the MobView projection keeps it as `None`.
                    if !object.contains_key("type") {
                        object.insert("type".to_string(), Value::Null);
                    }
                }
                mob
            })
            .collect(),
    )
}

fn normalize_plain_minimap(value: &Value) -> Value {
    let Value::Object(object) = value else {
        return value.clone();
    };
    let mut minimap = serde_json::Map::new();
    for key in MINIMAP_KEYS {
        let Some(field) = object.get(key) else {
            continue;
        };
        let field = if key == "mobs" {
            plain_retain_rows(field, &MINIMAP_MOB_KEYS)
        } else {
            field.clone()
        };
        minimap.insert(key.to_string(), field);
    }
    Value::Object(minimap)
}

fn normalize_plain_events(value: &Value) -> Value {
    let Value::Array(rows) = value else {
        return value.clone();
    };
    Value::Array(
        rows.iter()
            .map(|row| {
                let Value::Object(object) = row else {
                    return row.clone();
                };
                let Some(kind) = object.get("kind").and_then(Value::as_str) else {
                    return row.clone();
                };
                let mut keys: Vec<&str> = vec!["kind", "t", "at", "id", "by"];
                if let Ok(fields) = event_fields(kind, "plain event") {
                    keys.extend_from_slice(fields);
                }
                plain_retain(row, &keys)
            })
            .collect(),
    )
}

fn normalize_plain_extras(value: &Value) -> Value {
    let Value::Object(object) = value else {
        return value.clone();
    };
    let mut extras = serde_json::Map::new();
    for key in ["camps", "chests", "plan"] {
        let Some(field) = object.get(key) else {
            continue;
        };
        let field = match key {
            "camps" => plain_retain_rows(field, &["id", "state"]),
            "chests" => plain_retain_rows(field, &["id", "x", "y", "picked"]),
            "plan" => plain_retain(field, &["endsAt"]),
            _ => field.clone(),
        };
        extras.insert(key.to_string(), field);
    }
    Value::Object(extras)
}

/// Drop non-consumed legacy members (strictness exception scoped to the plain compat bridge) and complete the legacy
/// actor-view mob shape before handing the plain JSON to the same strict native Percept decoder.
fn normalize_plain_percept(value: &Value) -> Value {
    let Value::Object(object) = value else {
        return value.clone();
    };
    let mut normalized = serde_json::Map::new();
    for key in PERCEPT_KEYS {
        let Some(field) = object.get(key) else {
            continue;
        };
        let field = match key {
            "self" => {
                let mut keys: Vec<&str> = SELF_REQUIRED_KEYS.to_vec();
                keys.extend_from_slice(&SELF_OPTIONAL_KEYS);
                plain_retain(field, &keys)
            }
            "hud" => plain_retain(field, &HUD_KEYS),
            "fighters" => plain_retain_rows(field, &FIGHTER_KEYS),
            "mobs" => normalize_plain_mobs(field),
            "containers" => plain_retain_rows(field, &CONTAINER_KEYS),
            "projectiles" => plain_retain_rows(field, &PROJECTILE_KEYS),
            "minimap" => normalize_plain_minimap(field),
            "events" => normalize_plain_events(field),
            "extras" => normalize_plain_extras(field),
            "features" => plain_retain(field, &FEATURE_KEYS),
            _ => field.clone(),
        };
        normalized.insert(key.to_string(), field);
    }
    Value::Object(normalized)
}

// --------------------------------------------------------------------------------------------------------------- smoke

pub(crate) fn decode_declaration_checked(
    declaration: &Value,
    suite: Suite,
    config: &TacticsConfig,
) -> Result<DecodedOp, String> {
    let path = "declaration";
    check_duplicate_tagged_keys(declaration, path)?;
    let parsed = source_reader::parse(declaration, path)?;
    finite_sval(&parsed, path)?;
    let method_name = parsed
        .field("method", path)?
        .string(&path_of(path, "method"))?
        .to_string();
    one(&method_name, &METHOD_NAMES, &path_of(path, "method"))?;
    decode_declaration(&parsed, &method_name, suite, config, path)
}

#[cfg(test)]
mod decode_smoke {
    use super::*;

    /// Temporary/internal smoke: the frozen corpus decodes to its pinned map/case/operation counts.
    #[test]
    fn private_tactics_decode_smoke() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../parity/policy/bot-private-tactics/source.json");
        let text = std::fs::read_to_string(&path).expect("frozen private-tactics source.json");
        let source: serde_json::Value =
            serde_json::from_str(&text).expect("valid private-tactics JSON");
        let corpus =
            decode_corpus(&source).unwrap_or_else(|error| panic!("typed corpus decode: {error}"));
        assert_eq!(corpus.maps.len(), 5, "decoded declared map count");
        assert_eq!(corpus.cases.len(), 154, "decoded case count");
        let operations: usize = corpus.cases.iter().map(|case| case.operations.len()).sum();
        assert_eq!(operations, 720, "decoded operation count");
        let mut suites: std::collections::BTreeMap<String, usize> =
            std::collections::BTreeMap::new();
        for case in &corpus.cases {
            *suites.entry(format!("{:?}", case.suite)).or_insert(0) += 1;
        }
        eprintln!(
            "private-tactics decoded {} maps / {} cases / {} operations: {suites:?}",
            corpus.maps.len(),
            corpus.cases.len(),
            operations
        );
    }

    fn plain_percepts(source: &serde_json::Value) -> Vec<&serde_json::Value> {
        let mut percepts = Vec::new();
        for key in ["cases", "orbs"] {
            let Some(groups) = source.get(key).and_then(serde_json::Value::as_array) else {
                continue;
            };
            for group in groups {
                let Some(rows) = group.get("rows").and_then(serde_json::Value::as_array) else {
                    continue;
                };
                for row in rows {
                    let Some(percept) = row
                        .get("input")
                        .and_then(|input| input.get("percept"))
                        .filter(|percept| percept.is_object())
                    else {
                        continue;
                    };
                    percepts.push(percept);
                }
            }
        }
        percepts
    }

    fn plain_corpus(name: &str) -> serde_json::Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../parity/policy")
            .join(name)
            .join("source.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("legacy {} source.json: {error}", path.display()));
        serde_json::from_str(&text).expect("valid legacy plain-JSON corpus")
    }

    fn check_plain_percept(corpus: &str, percept: &serde_json::Value) -> TacticPercept {
        let decoded = decode_percept_plain(percept)
            .unwrap_or_else(|error| panic!("{corpus} plain percept: {error}"));
        assert_eq!(
            decoded.now,
            percept["now"].as_f64().expect("plain percept now"),
            "{corpus}: now"
        );
        assert_eq!(
            decoded.view_t,
            percept["viewT"].as_f64().expect("plain percept viewT"),
            "{corpus}: viewT"
        );
        assert_eq!(
            decoded.self_.id,
            percept["self"]["id"].as_str().expect("plain self id"),
            "{corpus}: self id"
        );
        assert_eq!(
            decoded.fighters.len(),
            percept["fighters"]
                .as_array()
                .expect("plain fighters")
                .len(),
            "{corpus}: fighters"
        );
        assert_eq!(
            decoded.mobs.len(),
            percept["mobs"].as_array().expect("plain mobs").len(),
            "{corpus}: mobs"
        );
        assert_eq!(
            decoded.events.len(),
            percept["events"].as_array().expect("plain events").len(),
            "{corpus}: events"
        );
        assert_eq!(
            decoded.extras.camps.len() + decoded.extras.chests.len(),
            0,
            "{corpus}: legacy extras are empty"
        );
        decoded
    }

    /// The immutable legacy corpora are plain untagged JSON: their Percepts must feed the same native Percept decoder.
    #[test]
    fn private_tactics_plain_percept_bridge() {
        let fight = plain_corpus("bot-fight");
        let first = &fight["cases"][0]["rows"][0]["input"]["percept"];
        let first = check_plain_percept("bot-fight", first);
        assert_eq!(first.now, 100.0);
        assert_eq!(first.view_t, 100.0);
        assert_eq!(first.self_.id, "p0");
        assert_eq!(first.self_.name, "declared owner");
        assert_eq!(first.fighters.len(), 1);
        assert_eq!(first.fighters[0].id, "p1");
        assert!(first.mobs.is_empty());
        assert!(first.events.is_empty());
        assert!(first.extras.camps.is_empty());
        let fight_percepts = plain_percepts(&fight);
        for percept in &fight_percepts {
            check_plain_percept("bot-fight", percept);
        }
        assert_eq!(fight_percepts.len(), 67, "bot-fight plain percept rows");

        let reflex = plain_corpus("bot-reflex");
        let reflex_percepts = plain_percepts(&reflex);
        let mut legacy_mobs = 0usize;
        for percept in &reflex_percepts {
            let decoded = check_plain_percept("bot-reflex", percept);
            if let Some(mob) = decoded.mobs.first() {
                assert_eq!(mob.id, "mob-a");
                assert_eq!(mob.kind, "mob");
                assert_eq!(mob.type_, None, "legacy actor-view mob has no type");
                assert_eq!(mob.name, "declared mob");
                assert_eq!(mob.status, "alive");
            }
            legacy_mobs += decoded.mobs.len();
        }
        assert_eq!(reflex_percepts.len(), 68, "bot-reflex plain percept rows");
        assert_eq!(legacy_mobs, 2, "legacy actor-view mob rows decoded");

        let sudden_death = plain_corpus("bot-sd");
        let sudden_death_percepts = plain_percepts(&sudden_death);
        for percept in &sudden_death_percepts {
            check_plain_percept("bot-sd", percept);
        }
        assert_eq!(sudden_death_percepts.len(), 46, "bot-sd plain percept rows");
        let sample = decode_plain_json(&serde_json::json!({"a": [1, null, "x", true]}));
        match &sample {
            SVal::Obj(entries) => {
                assert_eq!(entries.len(), 1);
                assert_eq!(entries[0].0, "a");
                match &entries[0].1 {
                    SVal::Arr(values) => assert_eq!(values.len(), 4),
                    other => panic!("plain JSON array expected, got {other:?}"),
                }
            }
            other => panic!("plain JSON object expected, got {other:?}"),
        }
        eprintln!(
            "plain percept bridge decoded {} bot-fight + {} bot-reflex + {} bot-sd percepts ({legacy_mobs} legacy mobs)",
            fight_percepts.len(),
            reflex_percepts.len(),
            sudden_death_percepts.len()
        );
    }
}
