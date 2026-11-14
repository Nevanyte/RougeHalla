//! Frozen actual-source parity for the private strategy closure. The corpus is a declared method witness: raw source
//! inputs drive the real admitted Memory and the real native classes; captured Memory/candidates/callbacks are only
//! comparisons. This file is test-only and never installs expected outcomes into native inputs.

use serde_json::Value;

use super::build_route::BuildRoute;
use super::engine::{Strategy, StrategyOptions};
use super::hunt_adapter::{HuntAdapter, HuntAdapterOptions};
use super::mob_hunt::{HuntInput, HuntMobLike, HuntSelf, MobHunter, MobTracker};
use super::source_reader::{self, SVal, R};
use super::source_trace::{
    compare_callbacks, compare_draw_counts, compare_goal_ordered, compare_ordered,
    encode_build_route, encode_goal, encode_goal_decision, encode_hunt_adapter,
    encode_hunt_mob_like, encode_hunt_stats, encode_mob_hunter, encode_mob_tracker, encode_own,
    encode_route_camp, encode_route_step, encode_source_camp, encode_strategy_getters,
    encode_strategy_own, encode_strategy_self, options_attacking, options_log, record_callback,
    strategy_getters, OwnState, RecordedKnowledge, RecordedLearned, RecordedMemory, RecordedModule,
    TraceHandle, TraceLog, TraceRng,
};
use super::types::{
    CampDef, ColiseumDef, Goal, GoalDecision, GoalStatus, RngStream, RouteCamp, StrategyConfig,
    StrategyContext, StrategyMap, StrategyPercept, StrategySelf,
};
use crate::bots::knowledge::Knowledge;
use crate::bots::mob_hunt::{HuntDecision, MobHuntConfig, MOB_HUNT};
use crate::bots::paths::WalkAnswer;
use crate::bots::random::Rng;
use crate::bots::types::{PersonaParams, TierParams, PERSONAS, TIERS};
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2, WeaponId};

fn field<'a>(v: &'a SVal, name: &str) -> R<&'a SVal> {
    v.field(name, name)
}
fn text(v: &SVal, name: &str) -> R<String> {
    Ok(field(v, name)?.string(name)?.to_string())
}
fn num(v: &SVal, name: &str) -> R<f64> {
    field(v, name)?.num(name)
}
fn boolv(v: &SVal, name: &str) -> R<bool> {
    field(v, name)?.bool(name)
}
fn arr<'a>(v: &'a SVal, name: &str) -> R<&'a [SVal]> {
    field(v, name)?.arr(name)
}
fn opt_text(v: &SVal, name: &str) -> R<Option<String>> {
    v.opt_string(name, name)
}

/// Typed intake helpers: every consumed number/range/enum is rejected instead of coerced or defaulted.
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
fn finite(v: &SVal, name: &str) -> R<f64> {
    finite_value(field(v, name)?, name)
}
fn finite_value(v: &SVal, name: &str) -> R<f64> {
    match v {
        SVal::Num(value) if value.is_finite() => Ok(*value),
        other => Err(format!("{name}: expected a finite number, got {other:?}")),
    }
}
fn finite_opt(v: &SVal, name: &str) -> R<Option<f64>> {
    match v.optional(name) {
        None | Some(SVal::Null) => Ok(None),
        Some(SVal::Num(value)) if value.is_finite() => Ok(Some(*value)),
        Some(other) => Err(format!(
            "{name}: expected a finite number|null, got {other:?}"
        )),
    }
}
fn uint(v: &SVal, name: &str, max: u64) -> R<u64> {
    uint_value(field(v, name)?, name, max)
}
fn uint_value(v: &SVal, name: &str, max: u64) -> R<u64> {
    let value = match v {
        SVal::Num(value) if value.is_finite() => *value,
        other => return Err(format!("{name}: expected a finite number, got {other:?}")),
    };
    if value >= 0. && value.fract() == 0. && value <= max as f64 {
        Ok(value as u64)
    } else {
        Err(format!(
            "{name}: expected an integer in 0..={max}, got {value}"
        ))
    }
}
fn strict_faction(v: &SVal, name: &str) -> R<FactionId> {
    match v {
        SVal::Str(text) => {
            FactionId::parse(text).ok_or_else(|| format!("{name}: unknown faction {text}"))
        }
        other => Err(format!("{name}: expected a faction string, got {other:?}")),
    }
}
fn strict_opt_faction(v: &SVal, name: &str) -> R<Option<FactionId>> {
    match v.optional(name) {
        None | Some(SVal::Null) => Ok(None),
        Some(value) => Ok(Some(strict_faction(value, name)?)),
    }
}
fn strict_opt_weapon(v: &SVal, name: &str) -> R<Option<WeaponId>> {
    match v.optional(name) {
        None | Some(SVal::Null) => Ok(None),
        Some(SVal::Str(text)) => WeaponId::parse(text)
            .map(Some)
            .ok_or_else(|| format!("{name}: unknown weapon {text}")),
        Some(other) => Err(format!(
            "{name}: expected a weapon string|null, got {other:?}"
        )),
    }
}
fn strict_weapon_list(v: &SVal, name: &str) -> R<[Option<WeaponId>; 2]> {
    let values = v.arr(name)?;
    if values.len() != 2 {
        return Err(format!(
            "{name}: the source weapon tuple has exactly two slots, got {}",
            values.len()
        ));
    }
    let mut weapons = [None, None];
    for (index, value) in values.iter().enumerate() {
        weapons[index] = match value {
            SVal::Null => None,
            SVal::Str(text) => Some(
                WeaponId::parse(text)
                    .ok_or_else(|| format!("{name}[{index}]: unknown weapon {text}"))?,
            ),
            other => {
                return Err(format!(
                    "{name}[{index}]: expected a weapon string|null, got {other:?}"
                ))
            }
        };
    }
    Ok(weapons)
}
fn strict_status_value(v: &SVal, name: &str) -> R<String> {
    let status = v.string(name)?.to_string();
    if matches!(status.as_str(), "alive" | "dead" | "mia") {
        Ok(status)
    } else {
        Err(format!("{name}: unknown source status {status}"))
    }
}
fn strict_weapon_string(v: &SVal, name: &str) -> R<WeaponId> {
    match v {
        SVal::Str(text) => {
            WeaponId::parse(text).ok_or_else(|| format!("{name}: unknown weapon {text}"))
        }
        other => Err(format!("{name}: expected a weapon string, got {other:?}")),
    }
}

fn tier_by_name(name: &str) -> TierParams {
    match name {
        "easy" => TIERS[0],
        "normal" => TIERS[1],
        "hard" => TIERS[2],
        other => panic!("unknown tier {other}"),
    }
}
fn persona_by_name(name: &str) -> PersonaParams {
    match name {
        "farmer" => PERSONAS[0],
        "hunter" => PERSONAS[1],
        "opportunist" => PERSONAS[2],
        "cautious" => PERSONAS[3],
        other => panic!("unknown persona {other}"),
    }
}

fn parse_tier(values: &SVal) -> R<TierParams> {
    strict_keys(
        values,
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
        "tierValues",
    )?;
    let id = text(values, "id")?;
    let mut tier = tier_by_name(&id);
    tier.softmax_t = finite(values, "softmaxT")?;
    tier.lapse_p = finite(values, "lapseP")?;
    tier.knowledge = finite(values, "knowledge")?;
    tier.mob_share_noise = finite(values, "mobShareNoise")?;
    tier.memory_span_ms = finite(values, "memorySpanMs")?;
    tier.wary = finite(values, "wary")?;
    let route = field(values, "route")?;
    strict_keys(
        route,
        &["horizon", "walkPaths", "reach"],
        "tierValues.route",
    )?;
    tier.route.horizon = uint(route, "horizon", u64::from(u32::MAX))? as u32;
    tier.route.walk_paths = boolv(route, "walkPaths")?;
    tier.route.reach = finite(route, "reach")?;
    let attention = field(values, "attention")?;
    strict_keys(
        attention,
        &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
        "tierValues.attention",
    )?;
    tier.attention.reconsider_ms = finite(attention, "reconsiderMs")?;
    let appraisal = field(values, "appraisal")?;
    strict_keys(
        appraisal,
        &["bias", "lead", "busy", "hue", "noise"],
        "tierValues.appraisal",
    )?;
    tier.appraisal.bias = finite(appraisal, "bias")?;
    tier.appraisal.lead = finite(appraisal, "lead")?;
    tier.appraisal.busy = finite(appraisal, "busy")?;
    tier.appraisal.hue = finite(appraisal, "hue")?;
    tier.appraisal.noise = finite(appraisal, "noise")?;
    let caution = field(values, "caution")?;
    strict_keys(
        caution,
        &["mobShare", "eliteShare", "startHp"],
        "tierValues.caution",
    )?;
    tier.caution.mob_share = finite(caution, "mobShare")?;
    tier.caution.elite_share = finite(caution, "eliteShare")?;
    tier.caution.start_hp = finite(caution, "startHp")?;
    Ok(tier)
}

fn parse_persona(values: &SVal) -> R<PersonaParams> {
    strict_keys(
        values,
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
        "personaValues",
    )?;
    let id = text(values, "id")?;
    let mut persona = persona_by_name(&id);
    persona.pve = finite(values, "pve")?;
    persona.pvp = finite(values, "pvp")?;
    persona.loot = finite(values, "loot")?;
    persona.bounty = finite(values, "bounty")?;
    persona.third_party = finite(values, "thirdParty")?;
    persona.engage_edge = finite(values, "engageEdge")?;
    persona.bounty_caution = finite(values, "bountyCaution")?;
    persona.flee_hp = finite(values, "fleeHp")?;
    persona.reengage_hp = finite(values, "reengageHp")?;
    persona.kite = finite(values, "kite")?;
    persona.chase_give_up_ms = finite(values, "chaseGiveUpMs")?;
    persona.mob_kill_goal = finite(values, "mobKillGoal")?;
    persona.player_threat = finite(values, "playerThreat")?;
    persona.elite_appetite = finite(values, "eliteAppetite")?;
    persona.coliseum = finite(values, "coliseum")?;
    persona.risk = finite(values, "risk")?;
    Ok(persona)
}

fn parse_features(v: &SVal) -> R<Features> {
    strict_keys(
        v,
        &[
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
        ],
        "features",
    )?;
    let message_types = arr(v, "messageTypes")?
        .iter()
        .map(|x| Ok(x.string("messageTypes[]")?.to_string()))
        .collect::<R<Vec<_>>>()?;
    Ok(Features {
        message_types,
        wishes: boolv(v, "wishes")?,
        status_effects: boolv(v, "statusEffects")?,
        fields: boolv(v, "fields")?,
        planning: boolv(v, "planning")?,
        chests: boolv(v, "chests")?,
        skills: boolv(v, "skills")?,
        relics: boolv(v, "relics")?,
        camps: boolv(v, "camps")?,
        hazards: boolv(v, "hazards")?,
    })
}

fn parse_zone(name: &str) -> FactionId {
    FactionId::parse(name).unwrap_or_else(|| panic!("unknown zone {name}"))
}
fn parse_weapon(name: &str) -> Option<WeaponId> {
    WeaponId::parse(name)
}

fn parse_map(maps: &Value, name: &str) -> R<StrategyMap> {
    let maps = maps
        .as_array()
        .ok_or_else(|| "maps not array".to_string())?;
    let raw = maps
        .iter()
        .find(|m| m.get("id").and_then(Value::as_str) == Some(name))
        .ok_or_else(|| format!("map {name} missing"))?;
    let value = raw
        .get("value")
        .ok_or_else(|| "map value missing".to_string())?;
    let map = source_reader::parse(value, "map")?;
    let width = num(&map, "w")?;
    let height = num(&map, "h")?;
    let mut camps = Vec::new();
    for c in arr(&map, "camps")? {
        let chest = field(c, "chest")?;
        camps.push(CampDef {
            id: text(c, "id")?,
            zone: parse_zone(&text(c, "zone")?),
            x: num(c, "x")?,
            y: num(c, "y")?,
            r: num(c, "r")?,
            spots: arr(c, "spots")?
                .iter()
                .map(|p| Ok(Vec2::new(num(p, "x")?, num(p, "y")?)))
                .collect::<R<Vec<_>>>()?,
            elite_spot: num(c, "eliteSpot")?,
            chest: Vec2::new(num(chest, "x")?, num(chest, "y")?),
            area: num(c, "area")?,
            radius: num(c, "radius")?,
        });
    }
    let coliseum = field(&map, "coliseum")?;
    let centre = field(coliseum, "centre")?;
    let inner_spawns = arr(coliseum, "innerSpawns")?
        .iter()
        .map(|p| Ok(Vec2::new(num(p, "x")?, num(p, "y")?)))
        .collect::<R<Vec<_>>>()?;
    Ok(StrategyMap {
        camps,
        coliseum: ColiseumDef {
            centre: Vec2::new(num(centre, "x")?, num(centre, "y")?),
            inner_spawns,
        },
        width,
        height,
    })
}

#[derive(Clone, Debug)]
enum PathSpec {
    Open { factor: f64, exact: bool },
    Null,
    CoordinateBlock { min_x: f64, max_x: f64 },
    Source,
}
fn vec2_sv(v: Vec2) -> SVal {
    obj(vec![("x", num_sv(v.x)), ("y", num_sv(v.y))])
}
fn num_sv(v: f64) -> SVal {
    source_reader::n(v)
}
fn bool_sv(v: bool) -> SVal {
    source_reader::b(v)
}
fn obj(fields: Vec<(&str, SVal)>) -> SVal {
    source_reader::obj(fields)
}

#[derive(Clone, Debug)]
struct LearnedMap {
    enabled: bool,
    entries: Vec<(String, f64)>,
}
#[derive(Clone, Debug)]
struct ModuleSpec {
    id: String,
    enabled: bool,
    feature: Option<String>,
    goals: Option<Vec<GoalDecision>>,
    after: Option<f64>,
    hp_below: Option<f64>,
}
#[derive(Clone, Debug)]
struct SourceConfig {
    tier: TierParams,
    persona: PersonaParams,
    seed: u32,
    id: String,
    map: StrategyMap,
    memory_camps: Vec<super::super::memory::CampGeom>,
    tile_map: Option<rh_sim::TileMap>,
    features: Features,
    path: PathSpec,
    learned: LearnedMap,
    modules: Vec<ModuleSpec>,
    hunt_config: MobHuntConfig,
    faction: FactionId,
    build_draw: f64,
    attacking: Option<bool>,
    random_decide: Vec<f64>,
    random_lapse: Vec<f64>,
}

fn parse_learned(v: &SVal) -> R<LearnedMap> {
    strict_keys(v, &["enabled", "entries"], "learned")?;
    let enabled = boolv(v, "enabled")?;
    let entries = arr(v, "entries")?
        .iter()
        .map(|e| {
            let pair = e.arr("learned entry")?;
            if pair.len() != 2 {
                return Err("learned entry must be [key, value]".to_string());
            }
            let key = pair[0].string("learned key")?.to_string();
            // Learned biases are declared source facts; non-finite values are the source's own sentinel and are
            // consumed through Number.isFinite, so they are legitimate here rather than malformed intake.
            let value = pair[1].num("learned value")?;
            Ok((key, value))
        })
        .collect::<R<Vec<_>>>()?;
    Ok(LearnedMap { enabled, entries })
}

fn parse_method_value(v: &SVal) -> R<super::super::data::MethodValue> {
    use super::super::data::MethodValue;
    Ok(match v {
        SVal::Undefined => MethodValue::Undefined,
        SVal::Null => MethodValue::Null,
        SVal::Bool(b) => MethodValue::Bool(*b),
        SVal::Num(n) => MethodValue::Num(*n),
        SVal::Str(s) => MethodValue::Str(s.clone()),
        SVal::Arr(values) => MethodValue::Arr(
            values
                .iter()
                .map(parse_method_value)
                .collect::<R<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => MethodValue::Obj(
            entries
                .iter()
                .map(|(k, v)| Ok((k.clone(), parse_method_value(v)?)))
                .collect::<R<Vec<_>>>()?,
        ),
        other => return Err(format!("unsupported module MethodValue {other:?}")),
    })
}

fn parse_goal(v: &SVal) -> R<Goal> {
    let kind = text(v, "kind")?;
    let fields: &[&str] = match kind.as_str() {
        "idle" => &[],
        "farm" => &["mob", "camp"],
        "hunt" | "fight" => &["target"],
        "loot" => &["container"],
        "flee" => &["from", "until"],
        "roam" => &["to", "why"],
        "hold" => &["at", "why"],
        "module" => &["module", "data"],
        other => return Err(format!("unknown goal kind {other}")),
    };
    let mut allowed = vec!["kind"];
    allowed.extend_from_slice(fields);
    strict_keys(v, &allowed, "Goal")?;
    for required in fields {
        if v.optional(required).is_none() {
            return Err(format!("Goal: missing required field {required}"));
        }
    }
    Ok(match kind.as_str() {
        "idle" => Goal::Idle,
        "farm" => Goal::Farm {
            mob: text(v, "mob")?,
            camp: opt_text(v, "camp")?,
        },
        "hunt" => Goal::Hunt {
            target: text(v, "target")?,
        },
        "fight" => Goal::Fight {
            target: text(v, "target")?,
        },
        "loot" => Goal::Loot {
            container: text(v, "container")?,
        },
        "flee" => {
            let from = arr(v, "from")?
                .iter()
                .map(|p| Ok(Vec2::new(finite(p, "x")?, finite(p, "y")?)))
                .collect::<R<Vec<_>>>()?;
            Goal::Flee {
                from,
                until: finite(v, "until")?,
            }
        }
        "roam" => {
            let to = field(v, "to")?;
            let why = match text(v, "why")?.as_str() {
                "explore" => super::types::RoamWhy::Explore,
                "camp" => super::types::RoamWhy::Camp,
                "lastSeen" => super::types::RoamWhy::LastSeen,
                "coliseum" => super::types::RoamWhy::Coliseum,
                "centre" => super::types::RoamWhy::Centre,
                other => return Err(format!("unknown roam why {other}")),
            };
            Goal::Roam {
                to: Vec2::new(finite(to, "x")?, finite(to, "y")?),
                why,
            }
        }
        "hold" => {
            let at = field(v, "at")?;
            let why = match text(v, "why")?.as_str() {
                "coliseum" => super::types::HoldWhy::Coliseum,
                "ambush" => super::types::HoldWhy::Ambush,
                "wait" => super::types::HoldWhy::Wait,
                other => return Err(format!("unknown hold why {other}")),
            };
            Goal::Hold {
                at: Vec2::new(finite(at, "x")?, finite(at, "y")?),
                why,
            }
        }
        "module" => Goal::Module {
            module: text(v, "module")?,
            data: parse_method_value(field(v, "data")?)?,
        },
        other => return Err(format!("unknown goal kind {other}")),
    })
}

fn parse_goal_decision(v: &SVal) -> R<GoalDecision> {
    strict_keys(v, &["goal", "utility", "why", "choice"], "GoalDecision")?;
    let choice = match v.optional("choice") {
        None | Some(SVal::Null) | Some(SVal::Undefined) => None,
        Some(SVal::Str(choice)) => Some(choice.clone()),
        Some(other) => {
            return Err(format!(
                "GoalDecision.choice: expected string|null, got {other:?}"
            ))
        }
    };
    Ok(GoalDecision {
        goal: parse_goal(field(v, "goal")?)?,
        utility: finite(v, "utility")?,
        why: text(v, "why")?,
        choice,
    })
}

fn parse_modules(v: &SVal) -> R<Vec<ModuleSpec>> {
    v.arr("modules")?
        .iter()
        .map(|m| {
            strict_keys(m, &["id", "enabled", "goals"], "module")?;
            let enabled_value = field(m, "enabled")?;
            let (enabled, feature) = match enabled_value {
                SVal::Bool(b) => (*b, None),
                SVal::Str(s) => (false, Some(s.clone())),
                other => return Err(format!("module enabled unsupported {other:?}")),
            };
            let mut after = None;
            let mut hp_below = None;
            let goals = match m.optional("goals") {
                Some(SVal::Arr(values)) => {
                    let mut out = Vec::new();
                    for g in values {
                        strict_keys(
                            g,
                            &["goal", "utility", "why", "choice", "when"],
                            "module goal offer",
                        )?;
                        match g.optional("when") {
                            None | Some(SVal::Undefined) => {}
                            Some(when) => {
                                strict_keys(when, &["after", "hpBelow"], "module goal when")?;
                                after = match when.optional("after") {
                                    None | Some(SVal::Undefined) => None,
                                    Some(value) => Some(finite_value(value, "when.after")?),
                                };
                                hp_below = match when.optional("hpBelow") {
                                    None | Some(SVal::Undefined) => None,
                                    Some(value) => Some(finite_value(value, "when.hpBelow")?),
                                };
                            }
                        }
                        let without_when = match g {
                            SVal::Obj(entries) => SVal::Obj(
                                entries
                                    .iter()
                                    .filter(|(key, _)| key != "when")
                                    .cloned()
                                    .collect(),
                            ),
                            other => {
                                return Err(format!(
                                    "module goal offer must be an object, got {other:?}"
                                ))
                            }
                        };
                        out.push(parse_goal_decision(&without_when)?);
                    }
                    Some(out)
                }
                Some(SVal::Undefined) | None => None,
                Some(other) => return Err(format!("module goals unsupported {other:?}")),
            };
            Ok(ModuleSpec {
                id: text(m, "id")?,
                enabled,
                feature,
                goals,
                after,
                hp_below,
            })
        })
        .collect()
}

fn parse_path_spec(path_value: &SVal) -> R<PathSpec> {
    let kind = text(path_value, "kind")?;
    match kind.as_str() {
        "open" => {
            strict_keys(path_value, &["kind", "factor", "exact"], "path")?;
            Ok(PathSpec::Open {
                factor: finite(path_value, "factor")?,
                exact: boolv(path_value, "exact")?,
            })
        }
        "null" => {
            strict_keys(path_value, &["kind"], "path")?;
            Ok(PathSpec::Null)
        }
        "coordinate-block" => {
            strict_keys(path_value, &["kind", "minX", "maxX"], "path")?;
            Ok(PathSpec::CoordinateBlock {
                min_x: finite(path_value, "minX")?,
                max_x: finite(path_value, "maxX")?,
            })
        }
        "source" => {
            strict_keys(path_value, &["kind"], "path")?;
            Ok(PathSpec::Source)
        }
        other => Err(format!("path.kind: unknown declared path service {other}")),
    }
}

/// The per-suite source BrainConfig contract. The corpus never hands a strategy/hunt case a field it does not declare.
fn config_keys_for(map_name: &str) -> &'static [&'static str] {
    let _ = map_name;
    &[
        "tier",
        "persona",
        "seed",
        "id",
        "map",
        "features",
        "path",
        "knowledge",
        "learned",
        "modules",
        "tierValues",
        "personaValues",
        "tierOverrides",
        "huntOverrides",
        "faction",
        "buildDraw",
        "attacking",
        "random",
    ]
}

fn parse_config(config: &SVal, maps: &Value) -> R<SourceConfig> {
    strict_keys(config, config_keys_for(""), "config")?;
    let tier = parse_tier(field(config, "tierValues")?)?;
    let persona = parse_persona(field(config, "personaValues")?)?;
    let seed = uint(config, "seed", u64::from(u32::MAX))? as u32;
    let id = text(config, "id")?;
    if id.is_empty() {
        return Err("config.id: source bot id must be non-empty".into());
    }
    let map_name = text(config, "map")?;
    let map = parse_map(maps, &map_name)?;
    let features = parse_features(field(config, "features")?)?;
    let path = parse_path_spec(field(config, "path")?)?;
    match config.optional("knowledge") {
        Some(SVal::Obj(entries))
            if entries.len() == 1 && entries[0].0 == "kind" && matches!(&entries[0].1, SVal::Str(kind) if kind == "source") => {}
        other => {
            return Err(format!(
                "config.knowledge: the frozen witness declares the actual source Knowledge service, got {other:?}"
            ))
        }
    }
    if let Some(tier_overrides) = config.optional("tierOverrides") {
        let entries = match tier_overrides {
            SVal::Obj(entries) => entries,
            other => {
                return Err(format!(
                    "config.tierOverrides: expected an object, got {other:?}"
                ))
            }
        };
        for (key, value) in entries {
            match key.as_str() {
                "softmaxT" => {
                    finite_value(value, "tierOverrides.softmaxT")?;
                }
                "lapseP" => {
                    finite_value(value, "tierOverrides.lapseP")?;
                }
                other => {
                    return Err(format!(
                        "config.tierOverrides: unsupported override {other}"
                    ))
                }
            }
        }
    }
    let learned = parse_learned(field(config, "learned")?)?;
    let modules = parse_modules(field(config, "modules")?)?;
    let hunt_config = match config.optional("huntOverrides") {
        Some(v) => {
            strict_keys(v, &["focusBudgetMs"], "huntOverrides")?;
            let mut cfg = MOB_HUNT;
            cfg.focus_budget_ms = finite(v, "focusBudgetMs")?;
            if cfg.focus_budget_ms < 0. {
                return Err("huntOverrides.focusBudgetMs: negative budget".into());
            }
            cfg
        }
        None => MOB_HUNT,
    };
    let faction = match config.optional("faction") {
        None | Some(SVal::Undefined) => FactionId::Fire,
        Some(value) => strict_faction(value, "config.faction")?,
    };
    let build_draw = match config.optional("buildDraw") {
        None | Some(SVal::Undefined) => 0.,
        Some(value) => match value {
            SVal::Num(draw) if draw.is_finite() && (0. ..=1.).contains(draw) => *draw,
            other => {
                return Err(format!(
                    "config.buildDraw: expected a finite unit draw, got {other:?}"
                ))
            }
        },
    };
    let attacking = match config.optional("attacking") {
        None | Some(SVal::Undefined) => None,
        Some(SVal::Bool(flag)) => Some(*flag),
        Some(other) => {
            return Err(format!(
                "config.attacking: expected a boolean, got {other:?}"
            ))
        }
    };
    // The generated map camps are also the admitted Memory map.
    let raw = maps
        .as_array()
        .and_then(|ms| {
            ms.iter()
                .find(|m| m.get("id").and_then(Value::as_str) == Some(map_name.as_str()))
        })
        .and_then(|m| m.get("value"))
        .ok_or_else(|| "map value missing".to_string())?;
    let map_value = source_reader::parse(raw, "map")?;
    let tile_map = match map_value.optional("tiles") {
        Some(SVal::U8(tiles)) => Some(
            rh_sim::TileMap::new(map.width as u32, map.height as u32, tiles.clone())
                .map_err(|e| format!("map tiles: {e:?}"))?,
        ),
        _ => None,
    };
    let mut memory_camps = Vec::new();
    for c in arr(&map_value, "camps")? {
        let geom = super::super::memory::CampGeom {
            id: text(c, "id")?,
            zone: parse_zone(&text(c, "zone")?),
            elite: num(c, "eliteSpot")? >= 0.,
            x: num(c, "x")?,
            y: num(c, "y")?,
            radius: num(c, "radius")?,
            spots: arr(c, "spots")?
                .iter()
                .map(|p| Ok(Vec2::new(num(p, "x")?, num(p, "y")?)))
                .collect::<R<Vec<_>>>()?,
        };
        memory_camps.push(geom);
    }
    let (random_decide, random_lapse) = match config.optional("random") {
        None | Some(SVal::Undefined) => (Vec::new(), Vec::new()),
        Some(SVal::Obj(entries)) => {
            for (key, _) in entries {
                if !matches!(key.as_str(), "decide" | "lapse") {
                    return Err(format!("config.random: unsupported stream override {key}"));
                }
            }
            let read = |name: &str| -> R<Vec<f64>> {
                match entries.iter().find(|(k, _)| k == name) {
                    None => Ok(Vec::new()),
                    Some((_, SVal::Arr(values))) => values
                        .iter()
                        .map(|value| match value {
                            SVal::Num(number) if number.is_finite() => Ok(*number),
                            other => Err(format!(
                                "config.random.{name}: declared override must be finite, got {other:?}"
                            )),
                        })
                        .collect(),
                    Some((_, other)) => Err(format!(
                        "config.random.{name}: expected an array, got {other:?}"
                    )),
                }
            };
            (read("decide")?, read("lapse")?)
        }
        Some(other) => return Err(format!("config.random: expected an object, got {other:?}")),
    };
    Ok(SourceConfig {
        tier,
        persona,
        seed,
        id,
        map,
        memory_camps,
        tile_map,
        features,
        path,
        learned,
        modules,
        hunt_config,
        faction,
        build_draw,
        attacking,
        random_decide,
        random_lapse,
    })
}

// --------------------------------------------------------------------------------------------------------------------
// Frozen corpus loading and suite replay

fn load_source() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-private-strategy/source.json");
    let text = std::fs::read_to_string(&path).expect("frozen source.json");
    let source: Value = serde_json::from_str(&text).expect("source.json is valid JSON");
    super::source_strict::validate_primary(&source)
        .unwrap_or_else(|error| panic!("strict source reader: {error}"));
    source
}

fn load_supplement() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy/bot-module-goal-key/source.json");
    let text = std::fs::read_to_string(&path).expect("frozen module goal-key source.json");
    let supplement: Value = serde_json::from_str(&text).expect("valid module goal-key JSON");
    super::source_strict::validate_supplement(&supplement)
        .unwrap_or_else(|error| panic!("strict supplement reader: {error}"));
    supplement
}

fn source_cases(source: &Value) -> &[Value] {
    source["cases"].as_array().expect("cases array")
}

/// Corpus envelope wrappers are raw JSON structures; every tagged payload leaf is decoded with the strict tagged-value
/// reader (unknown/extra tags, duplicate keys, malformed pairs and invalid u8 bytes were already rejected by the finite
/// envelope validation, so this conversion cannot silently accept a malformed method value).
fn sv(value: &Value) -> SVal {
    match value {
        Value::Object(map) if map.contains_key("$") => super::source_strict::decode(
            value,
            "corpus payload",
            super::source_strict::Mode::Diagnostic,
        )
        .unwrap_or_else(|error| panic!("strict corpus decode: {error}")),
        Value::Null => SVal::Null,
        Value::Bool(flag) => SVal::Bool(*flag),
        Value::Number(_) => SVal::Num(
            value
                .as_f64()
                .filter(|number| number.is_finite())
                .expect("finite JSON number"),
        ),
        Value::String(text) => SVal::Str(text.clone()),
        Value::Array(entries) => SVal::Arr(entries.iter().map(sv).collect()),
        Value::Object(map) => SVal::Obj(
            map.iter()
                .map(|(key, value)| (key.clone(), sv(value)))
                .collect(),
        ),
    }
}

fn compare(label: &str, expected: &SVal, actual: &SVal, failures: &mut Vec<String>) {
    if !source_reader::same(expected, actual) {
        failures.push(format!("{label}: expected={expected:?} actual={actual:?}"));
    }
}

fn parse_hunt_mob(v: &SVal) -> R<(String, HuntMobLike)> {
    let pair = v.arr("mob entry")?;
    if pair.len() != 2 {
        return Err("mob entry must be [id, value]".into());
    }
    let id = pair[0].string("mob id")?.to_string();
    if id.is_empty() {
        return Err("mob entry id must be non-empty".into());
    }
    let m = &pair[1];
    strict_keys(
        m,
        &[
            "kind", "type", "status", "x", "y", "hp", "maxHp", "faction", "weapon0",
        ],
        "MobLike",
    )?;
    let kind = text(m, "kind")?;
    // MobLike.kind/status are open source strings; the tracker/hunter regional filters decide what is used.
    let status = text(m, "status")?;
    let type_ = match m.optional("type") {
        None | Some(SVal::Undefined) => None,
        Some(SVal::Str(text)) => Some(text.clone()),
        Some(other) => {
            return Err(format!(
                "MobLike.type: expected a mob type id string|undefined, got {other:?}"
            ))
        }
    };
    let faction_text = m
        .optional("faction")
        .map(|value| Ok::<_, String>(value.string("MobLike.faction")?.to_string()))
        .transpose()?;
    let weapon0_text = m
        .optional("weapon0")
        .map(|value| Ok::<_, String>(value.string("MobLike.weapon0")?.to_string()))
        .transpose()?;
    Ok((
        id,
        HuntMobLike {
            kind,
            status,
            x: finite(m, "x")?,
            y: finite(m, "y")?,
            hp: finite(m, "hp")?,
            max_hp: finite(m, "maxHp")?,
            faction: faction_text.as_deref().and_then(FactionId::parse),
            faction_text,
            weapon0: weapon0_text.as_deref().and_then(WeaponId::parse),
            weapon0_text,
            type_,
            reward: None,
        },
    ))
}

fn parse_mob_entries(v: &SVal) -> R<Vec<(String, HuntMobLike)>> {
    match v {
        SVal::Arr(_) => Ok(v
            .arr("mobs")?
            .iter()
            .map(parse_hunt_mob)
            .collect::<R<Vec<_>>>()?),
        SVal::Map(entries) => entries
            .iter()
            .map(|(key, value)| {
                let id = key.string("mob map id")?.to_string();
                let pair = SVal::Arr(vec![SVal::Str(id.clone()), value.clone()]);
                Ok(parse_hunt_mob(&pair)?.1).map(|mob| (id, mob))
            })
            .collect(),
        other => Err(format!("mobs must be array or map, got {other:?}")),
    }
}

fn parse_hunt_self(v: &SVal) -> R<HuntSelf> {
    strict_keys(
        v,
        &[
            "faction", "x", "y", "hp", "maxHp", "weapons", "power", "mobKills", "mobStats",
        ],
        "HuntSelf",
    )?;
    let weapons = strict_weapon_list(field(v, "weapons")?, "HuntSelf.weapons")?;
    let mob_stats = match v.optional("mobStats") {
        None | Some(SVal::Undefined) => Vec::new(),
        Some(SVal::Obj(entries)) => entries
            .iter()
            .map(|(kind, count)| {
                Ok((
                    kind.clone(),
                    uint_value(count, "mobStats count", u64::from(u32::MAX))? as u32,
                ))
            })
            .collect::<R<Vec<_>>>()?,
        Some(other) => {
            return Err(format!(
                "HuntSelf.mobStats: expected an object, got {other:?}"
            ))
        }
    };
    Ok(HuntSelf {
        faction: strict_opt_faction(v, "faction")?,
        x: finite(v, "x")?,
        y: finite(v, "y")?,
        hp: finite(v, "hp")?,
        max_hp: finite(v, "maxHp")?,
        weapons,
        power: finite(v, "power")?,
        mob_kills: finite(v, "mobKills")?,
        mob_stats,
    })
}

fn encode_decision(d: &HuntDecision) -> SVal {
    match d {
        HuntDecision::Player { why } => obj(vec![
            ("kind", source_reader::s("player")),
            ("why", source_reader::s(why)),
        ]),
        HuntDecision::Mob { id, why } => obj(vec![
            ("kind", source_reader::s("mob")),
            ("id", source_reader::s(id)),
            ("why", source_reader::s(why)),
        ]),
        HuntDecision::Retreat { from, why } => obj(vec![
            ("kind", source_reader::s("retreat")),
            (
                "from",
                source_reader::arr(from.iter().map(|p| vec2_sv(*p)).collect()),
            ),
            ("why", source_reader::s(why)),
        ]),
    }
}

fn parse_route_camp(v: &SVal) -> R<RouteCamp> {
    strict_keys(
        v,
        &[
            "index",
            "id",
            "zone",
            "x",
            "y",
            "r",
            "elite",
            "spots",
            "type",
            "alive",
            "state",
            "respawnAt",
        ],
        "RouteCamp",
    )?;
    let zone = strict_faction(field(v, "zone")?, "RouteCamp.zone")?;
    let mob_type = match v.optional("type") {
        None | Some(SVal::Undefined) => String::new(),
        Some(SVal::Str(text)) => {
            if !text.is_empty() && rh_sim::mob_catalog::mob_type_by_id(text).is_none() {
                return Err(format!("RouteCamp.type: unknown mob type id {text}"));
            }
            text.clone()
        }
        Some(other) => {
            return Err(format!(
                "RouteCamp.type: expected a mob type id string, got {other:?}"
            ))
        }
    };
    Ok(RouteCamp {
        index: uint(v, "index", u64::from(u32::MAX))? as u32,
        id: text(v, "id")?,
        zone,
        x: finite(v, "x")?,
        y: finite(v, "y")?,
        r: finite(v, "r")?,
        elite: boolv(v, "elite")?,
        spots: uint(v, "spots", u64::from(u32::MAX))? as u32,
        mob_type,
        // Frozen corpus: legacy's RouteCamp (before a7b5c4ce) has no buff; the reward is unknown.
        reward: String::new(),
        alive: uint(v, "alive", u64::from(u32::MAX))? as u32,
        state: {
            let state = uint(v, "state", 2)?;
            state as u8
        },
        respawn_at: finite(v, "respawnAt")?,
    })
}

type CanFarm = Box<dyn Fn(&RouteCamp) -> bool>;
fn can_farm_descriptor(v: &SVal) -> R<CanFarm> {
    let kind = text(v, "kind")?;
    Ok(match kind.as_str() {
        "allow" => {
            strict_keys(v, &["kind"], "canFarm")?;
            Box::new(|_| true)
        }
        "indices" => {
            strict_keys(v, &["kind", "allow"], "canFarm")?;
            let allow = arr(v, "allow")?
                .iter()
                .map(|entry| {
                    Ok(uint_value(entry, "canFarm allow index", u64::from(u32::MAX))? as u32)
                })
                .collect::<R<Vec<_>>>()?;
            Box::new(move |c: &RouteCamp| allow.contains(&c.index))
        }
        "zones" => {
            strict_keys(v, &["kind", "allow"], "canFarm")?;
            let allow = arr(v, "allow")?
                .iter()
                .map(|entry| strict_faction(entry, "canFarm allow zone"))
                .collect::<R<Vec<_>>>()?;
            Box::new(move |c: &RouteCamp| allow.contains(&c.zone))
        }
        other => return Err(format!("canFarm.kind: unknown descriptor {other}")),
    })
}

fn parse_opt_weapon(v: &SVal, path: &str) -> R<Option<WeaponId>> {
    match v {
        SVal::Null | SVal::Undefined => Ok(None),
        SVal::Str(s) => Ok(parse_weapon(s)),
        _ => Err(format!("{path}: expected string|null")),
    }
}
fn parse_percept_weapon(v: &SVal) -> R<super::super::memory::source_input::PerceptWeapon> {
    use super::super::memory::source_input::PerceptWeapon;
    match v {
        SVal::Undefined => Ok(PerceptWeapon::Undefined),
        SVal::Null => Ok(PerceptWeapon::Null),
        SVal::Str(s) => parse_weapon(s)
            .map(PerceptWeapon::Weapon)
            .ok_or_else(|| format!("unknown weapon {s}")),
        _ => Err("container weapon must be string|null|undefined".into()),
    }
}
fn parse_vec2(v: &SVal) -> R<Vec2> {
    Ok(Vec2::new(num(v, "x")?, num(v, "y")?))
}
fn parse_opt_vec2(v: &SVal, name: &str) -> R<Option<Vec2>> {
    match v.optional(name) {
        None | Some(SVal::Null) => Ok(None),
        Some(v) => Ok(Some(parse_vec2(v)?)),
    }
}

fn parse_memory_percept(
    input: &SVal,
    fallback_features: &Features,
) -> R<super::super::memory::source_input::MemoryPercept> {
    use super::super::memory::source_input::*;
    let self_v = field(input, "self")?;
    let hud = field(input, "hud")?;
    let mut fighters = Vec::new();
    for f in arr(input, "fighters")? {
        fighters.push(PerceptFighter {
            id: text(f, "id")?,
            name: text(f, "name")?,
            bot: boolv(f, "bot")?,
            x: finite(f, "x")?,
            y: finite(f, "y")?,
            facing: finite(f, "facing")?,
            status: strict_status_value(field(f, "status")?, "status")?,
            hp_frac: finite(f, "hpFrac")?,
            faction: strict_opt_faction(f, "faction")?,
            in_hand: strict_opt_weapon(f, "inHand")?,
            draw_started_at: finite(f, "drawStartedAt")?,
            bounty: finite(f, "bounty")?,
            vx: finite(f, "vx")?,
            vy: finite(f, "vy")?,
        });
    }
    let mut mobs = Vec::new();
    for m in arr(input, "mobs")? {
        mobs.push(PerceptMob {
            id: text(m, "id")?,
            kind: text(m, "kind")?,
            name: opt_text(m, "name")?.unwrap_or_default(),
            type_: opt_text(m, "type")?,
            faction: strict_opt_faction(m, "faction")?,
            x: finite(m, "x")?,
            y: finite(m, "y")?,
            status: strict_status_value(field(m, "status")?, "status")?,
            hp_frac: finite(m, "hpFrac")?,
            in_hand: strict_opt_weapon(m, "inHand")?,
        });
    }
    let mut containers = Vec::new();
    for c in arr(input, "containers")? {
        containers.push(PerceptContainer {
            id: text(c, "id")?,
            kind: text(c, "kind")?,
            x: finite(c, "x")?,
            y: finite(c, "y")?,
            closed: boolv(c, "closed")?,
            weapon: parse_percept_weapon(c.optional("weapon").unwrap_or(&SVal::Undefined))?,
        });
    }
    let mut projectiles = Vec::new();
    for p in arr(input, "projectiles")? {
        projectiles.push(PerceptProjectile {
            id: text(p, "id")?,
            kind: text(p, "kind")?,
            x: finite(p, "x")?,
            y: finite(p, "y")?,
            vx: finite(p, "vx")?,
            vy: finite(p, "vy")?,
            x0: finite(p, "x0")?,
            y0: finite(p, "y0")?,
            t0: finite(p, "t0")?,
            range: finite(p, "range")?,
            from: opt_text(p, "from")?,
        });
    }
    let minimap_v = field(input, "minimap")?;
    let minimap = PerceptMinimap {
        t: finite(minimap_v, "t")?,
        mobs: arr(minimap_v, "mobs")?
            .iter()
            .map(|m| {
                Ok(PerceptMinimapMob {
                    id: text(m, "id")?,
                    x: finite(m, "x")?,
                    y: finite(m, "y")?,
                    faction: strict_opt_faction(m, "faction")?,
                    elite: boolv(m, "elite")?,
                })
            })
            .collect::<R<Vec<_>>>()?,
    };
    let mut events = Vec::new();
    for e in arr(input, "events")? {
        events.push(parse_event(e)?);
    }
    let extras_v = field(input, "extras")?;
    let mut extras = PerceptExtras::default();
    if let Some(camps) = extras_v.optional("camps") {
        for c in camps.arr("extras.camps")? {
            extras.camps.push(PerceptCampView {
                id: text(c, "id")?,
                state: uint(c, "state", 2)? as u8,
            });
        }
    }
    if let Some(chests) = extras_v.optional("chests") {
        for c in chests.arr("extras.chests")? {
            extras.chests.push(PerceptChest {
                id: text(c, "id")?,
                x: finite(c, "x")?,
                y: finite(c, "y")?,
                picked: boolv(c, "picked")?,
            });
        }
    }
    if let Some(plan) = extras_v.optional("plan") {
        if !matches!(plan, SVal::Null) {
            extras.plan = Some(PerceptPlan {
                ends_at: finite(plan, "endsAt")?,
            });
        }
    }
    let features = match input.optional("features") {
        Some(v) => parse_features(v)?,
        None => fallback_features.clone(),
    };
    Ok(MemoryPercept {
        now: finite(input, "now")?,
        view_t: finite(input, "viewT")?,
        self_: PerceptSelf {
            id: text(self_v, "id")?,
            name: text(self_v, "name")?,
            x: finite(self_v, "x")?,
            y: finite(self_v, "y")?,
            facing: finite(self_v, "facing")?,
            status: strict_status_value(field(self_v, "status")?, "status")?,
            hp: finite(self_v, "hp")?,
            max_hp: finite(self_v, "maxHp")?,
            attack_target: opt_text(self_v, "attackTarget")?,
            move_seq: finite(self_v, "moveSeq")?,
        },
        hud_in_coliseum: boolv(hud, "inColiseum")?,
        fighters,
        mobs,
        containers,
        projectiles,
        minimap,
        events,
        extras,
        features,
    })
}

fn parse_event(v: &SVal) -> R<super::super::memory::source_input::PerceptEventRow> {
    use super::super::memory::source_input::{PerceptEvent, PerceptEventRow};
    let t = finite(v, "t")?;
    let at = match v.optional("at") {
        Some(SVal::Null) | None => None,
        Some(a) => Some(parse_vec2(a)?),
    };
    let k = text(v, "kind")?;
    let kind = match k.as_str() {
        "toast" => PerceptEvent::Toast {
            text: text(v, "text")?,
        },
        "hit" => PerceptEvent::Hit {
            id: text(v, "id")?,
            by: opt_text(v, "by")?,
            amount: finite(v, "amount")?,
            weapon: strict_opt_weapon(v, "weapon")?,
        },
        "block" => PerceptEvent::Block {
            id: text(v, "id")?,
            by: opt_text(v, "by")?,
            weapon: strict_opt_weapon(v, "weapon")?,
        },
        "bounty" => PerceptEvent::Bounty {
            id: text(v, "id")?,
            name: text(v, "name")?,
            bounty: finite(v, "bounty")?,
        },
        "death" => PerceptEvent::Death {
            id: text(v, "id")?,
            name: text(v, "name")?,
            by: opt_text(v, "by")?,
            mob: boolv(v, "mob")?,
        },
        "victory" => PerceptEvent::Victory {
            id: opt_text(v, "id")?,
            name: opt_text(v, "name")?,
            draw: boolv(v, "draw")?,
        },
        "teleport" => PerceptEvent::Teleport,
        "windup" => PerceptEvent::Windup {
            by: text(v, "by")?,
            weapon: strict_weapon_string(field(v, "weapon")?, "weapon")?,
            a: finite(v, "a")?,
            ms: finite(v, "ms")?,
        },
        "cancel" => PerceptEvent::Cancel { id: text(v, "id")? },
        "swing" => PerceptEvent::Swing {
            by: text(v, "by")?,
            weapon: strict_weapon_string(field(v, "weapon")?, "weapon")?,
            a: finite(v, "a")?,
        },
        "ext" => PerceptEvent::Ext {
            fx: text(v, "fx")?,
            data: parse_method_value(field(v, "data")?)?,
        },
        "private" => PerceptEvent::Private {
            type_: text(v, "type")?,
        },
        other => return Err(format!("unknown event kind {other}")),
    };
    Ok(PerceptEventRow { t, at, kind })
}

fn method_value_sv(v: &super::super::data::MethodValue) -> SVal {
    use super::super::data::MethodValue;
    match v {
        MethodValue::Undefined => SVal::Undefined,
        MethodValue::Null => SVal::Null,
        MethodValue::Bool(b) => SVal::Bool(*b),
        MethodValue::Num(n) => SVal::Num(*n),
        MethodValue::Str(s) => SVal::Str(s.clone()),
        MethodValue::Arr(a) => SVal::Arr(a.iter().map(method_value_sv).collect()),
        MethodValue::Obj(o) => SVal::Obj(
            o.iter()
                .map(|(k, v)| (k.clone(), method_value_sv(v)))
                .collect(),
        ),
    }
}

fn memory_timed_sv(cmd: &super::super::memory::MemoryTimedCommand) -> SVal {
    method_value_sv(&cmd.raw)
}

fn encode_stimulus(st: &crate::bots::types::Stimulus) -> SVal {
    let mut fields = vec![
        ("kind", SVal::Str(st.kind.as_str().to_string())),
        ("at", num_sv(st.at)),
        (
            "subject",
            st.subject
                .as_deref()
                .map(source_reader::s)
                .unwrap_or(SVal::Null),
        ),
        ("central", bool_sv(st.central)),
    ];
    if let Some(value) = st.value {
        fields.push(("value", num_sv(value)));
    }
    obj(fields)
}

fn encode_memory(mem: &super::super::memory::Memory) -> SVal {
    use super::super::memory::{ContainersWeapon, MemoryView};
    let MemoryView {
        fighters,
        mobs,
        camps,
        containers,
        self_memory,
        stimuli,
        bounties,
        choices,
    } = mem.view();
    let fighters = source_reader::map(
        fighters
            .iter()
            .map(|(id, f)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&f.id)),
                        ("name", source_reader::s(&f.name)),
                        ("bot", bool_sv(f.bot)),
                        (
                            "faction",
                            f.faction
                                .map(|v| source_reader::s(v.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        (
                            "weaponsSeen",
                            source_reader::arr(
                                f.weapons_seen
                                    .iter()
                                    .map(|w| source_reader::s(w.as_str()))
                                    .collect(),
                            ),
                        ),
                        (
                            "inHand",
                            f.in_hand
                                .map(|w| source_reader::s(w.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        (
                            "otherSlot",
                            f.other_slot
                                .map(|w| source_reader::s(w.as_str()))
                                .unwrap_or(SVal::Null),
                        ),
                        ("seenAt", num_sv(f.seen_at)),
                        ("pos", vec2_sv(f.pos)),
                        ("vel", vec2_sv(f.vel)),
                        ("hpFrac", num_sv(f.hp_frac)),
                        ("bounty", num_sv(f.bounty)),
                        ("alive", bool_sv(f.alive)),
                        ("diedAt", f.died_at.map(num_sv).unwrap_or(SVal::Null)),
                        ("hitMeAt", f.hit_me_at.map(num_sv).unwrap_or(SVal::Null)),
                        (
                            "hitByMeAt",
                            f.hit_by_me_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("damageToMe", num_sv(f.damage_to_me)),
                        ("damageByMe", num_sv(f.damage_by_me)),
                        (
                            "engagedWith",
                            f.engaged_with
                                .as_deref()
                                .map(source_reader::s)
                                .unwrap_or(SVal::Null),
                        ),
                        ("engagedAt", f.engaged_at.map(num_sv).unwrap_or(SVal::Null)),
                        ("chasingMe", bool_sv(f.chasing_me)),
                        (
                            "wishSeenAt",
                            f.wish_seen_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        (
                            "wishReadyGuess",
                            f.wish_ready_guess.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("feints", num_sv(f.feints as f64)),
                        (
                            "lastFeintAt",
                            f.last_feint_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                    ]),
                )
            })
            .collect(),
    );
    let mobs = source_reader::map(
        mobs.iter()
            .map(|(id, m)| {
                let mut fields = vec![
                    ("id", source_reader::s(&m.id)),
                    ("kind", source_reader::s(&m.kind)),
                    (
                        "faction",
                        m.faction
                            .map(|v| source_reader::s(v.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                ];
                if let Some(name) = &m.name {
                    fields.push(("name", source_reader::s(name)));
                }
                fields.extend([
                    ("home", m.home.map(vec2_sv).unwrap_or(SVal::Null)),
                    (
                        "campId",
                        m.camp_id
                            .as_deref()
                            .map(source_reader::s)
                            .unwrap_or(SVal::Null),
                    ),
                    ("pos", vec2_sv(m.pos)),
                    ("dotAt", num_sv(m.dot_at)),
                    ("seenAt", m.seen_at.map(num_sv).unwrap_or(SVal::Null)),
                    ("hpFrac", num_sv(m.hp_frac)),
                    (
                        "inHand",
                        m.in_hand
                            .map(|w| source_reader::s(w.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                    ("awake", bool_sv(m.awake)),
                    ("returning", bool_sv(m.returning)),
                    ("alive", bool_sv(m.alive)),
                ]);
                if let Some(ty) = &m.type_ {
                    fields.push(("type", source_reader::s(ty)));
                }
                (SVal::Str(id.clone()), obj(fields))
            })
            .collect(),
    );
    let camps = source_reader::map(
        camps
            .iter()
            .map(|(id, c)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&c.id)),
                        ("zone", source_reader::s(c.zone.as_str())),
                        ("elite", bool_sv(c.elite)),
                        ("aliveSeen", num_sv(f64::from(c.alive_seen))),
                        ("clearedAt", c.cleared_at.map(num_sv).unwrap_or(SVal::Null)),
                        (
                            "contestedAt",
                            c.contested_at.map(num_sv).unwrap_or(SVal::Null),
                        ),
                        ("visitedAt", c.visited_at.map(num_sv).unwrap_or(SVal::Null)),
                    ]),
                )
            })
            .collect(),
    );
    let containers = source_reader::map(
        containers
            .iter()
            .map(|(id, c)| {
                (
                    SVal::Str(id.clone()),
                    obj(vec![
                        ("id", source_reader::s(&c.id)),
                        ("kind", source_reader::s(&c.kind)),
                        ("pos", vec2_sv(c.pos)),
                        ("closed", bool_sv(c.closed)),
                        (
                            "weapon",
                            match c.weapon {
                                ContainersWeapon::Undefined => SVal::Undefined,
                                ContainersWeapon::Null => SVal::Null,
                                ContainersWeapon::Weapon(w) => source_reader::s(w.as_str()),
                            },
                        ),
                        ("seenAt", num_sv(c.seen_at)),
                        ("skipped", bool_sv(c.skipped)),
                    ]),
                )
            })
            .collect(),
    );
    let recent_hits = source_reader::arr(
        self_memory
            .recent_hits
            .iter()
            .map(|h| {
                obj(vec![
                    ("t", num_sv(h.t)),
                    (
                        "by",
                        h.by.as_deref().map(source_reader::s).unwrap_or(SVal::Null),
                    ),
                    ("amount", num_sv(h.amount)),
                ])
            })
            .collect(),
    );
    let self_sv = obj(vec![
        (
            "lastHitAt",
            self_memory.last_hit_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        (
            "lastHitByPlayerAt",
            self_memory
                .last_hit_by_player_at
                .map(num_sv)
                .unwrap_or(SVal::Null),
        ),
        (
            "lastDealtAt",
            self_memory.last_dealt_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        ("recentDamage", num_sv(self_memory.recent_damage)),
        ("recentHits", recent_hits),
        (
            "teleportedAt",
            self_memory.teleported_at.map(num_sv).unwrap_or(SVal::Null),
        ),
        (
            "lastOrder",
            self_memory
                .last_order
                .as_ref()
                .map(memory_timed_sv)
                .unwrap_or(SVal::Null),
        ),
        (
            "lastCast",
            self_memory
                .last_cast
                .as_ref()
                .map(memory_timed_sv)
                .unwrap_or(SVal::Null),
        ),
        ("stillSince", num_sv(self_memory.still_since)),
    ]);
    obj(vec![
        ("fighters", fighters),
        ("mobs", mobs),
        ("camps", camps),
        ("containers", containers),
        ("self", self_sv),
        (
            "stimuli",
            source_reader::arr(stimuli.iter().map(encode_stimulus).collect()),
        ),
        (
            "bounties",
            source_reader::map(
                bounties
                    .iter()
                    .map(|(id, v)| (SVal::Str(id.clone()), num_sv(*v)))
                    .collect(),
            ),
        ),
        (
            "choices",
            source_reader::arr(choices.iter().map(|c| source_reader::s(c)).collect()),
        ),
    ])
}

fn parse_note_sent(input: &SVal) -> R<super::super::memory::MemoryTimedCommand> {
    use super::super::memory::{MemoryCommand, MemoryTimedCommand};
    strict_keys(
        input,
        &["at", "cmd", "intent", "priority", "stimulus"],
        "noteSent",
    )?;
    let at = finite(input, "at")?;
    if let Some(intent) = input.optional("intent") {
        if !matches!(intent, SVal::Str(_)) {
            return Err("noteSent.intent: expected a string".into());
        }
    }
    if let Some(priority) = input.optional("priority") {
        uint_value(priority, "noteSent.priority", u64::from(u32::MAX))?;
    }
    let cmd_v = field(input, "cmd")?;
    strict_keys(cmd_v, &["type", "msg"], "noteSent.cmd")?;
    let ty = text(cmd_v, "type")?;
    let msg = field(cmd_v, "msg")?;
    let source_commands = [
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
    if !source_commands.contains(&ty.as_str()) {
        return Err(format!(
            "noteSent.cmd.type: unsupported source command {ty}"
        ));
    }
    let cmd = match ty.as_str() {
        "move" => {
            strict_keys(msg, &["x", "y", "seq"], "noteSent.cmd.msg")?;
            MemoryCommand::Move {
                x: finite(msg, "x")?,
                y: finite(msg, "y")?,
                seq: finite_opt(msg, "seq")?,
            }
        }
        "stop" => {
            strict_keys(msg, &["seq"], "noteSent.cmd.msg")?;
            MemoryCommand::Stop {
                seq: finite_opt(msg, "seq")?,
            }
        }
        "target" => {
            strict_keys(msg, &["id"], "noteSent.cmd.msg")?;
            MemoryCommand::Target {
                id: text(msg, "id")?,
            }
        }
        "pickup" => {
            strict_keys(msg, &["containerId"], "noteSent.cmd.msg")?;
            MemoryCommand::Pickup {
                container_id: text(msg, "containerId")?,
            }
        }
        "cast" => MemoryCommand::Cast,
        "attack" | "release" | "swap" | "plan" | "choose" | "useConsumable" => MemoryCommand::Other,
        _ => unreachable!("checked command union"),
    };
    let raw = parse_method_value(input)?;
    Ok(MemoryTimedCommand { at, cmd, raw })
}

fn create_memory(cfg: &SourceConfig) -> super::super::memory::Memory {
    use super::super::memory::{Memory, MemoryConfig, MemoryMap};
    let tier: &'static TierParams = Box::leak(Box::new(cfg.tier));
    Memory::new(MemoryConfig {
        self_id: cfg.id.clone(),
        tier,
        map: MemoryMap {
            camps: cfg.memory_camps.clone(),
        },
        features: cfg.features.clone(),
    })
    .expect("valid memory config")
}

fn compare_memory(label: &str, expected: &SVal, actual: &SVal, failures: &mut Vec<String>) {
    let (SVal::Obj(exp), SVal::Obj(act)) = (expected, actual) else {
        failures.push(format!("{label}: non-object memory"));
        return;
    };
    for (name, ev) in exp {
        let Some((_, av)) = act.iter().find(|(k, _)| k == name) else {
            failures.push(format!("{label}.{name}: missing native section"));
            continue;
        };
        if !source_reader::same(ev, av) {
            // Report a compact per-surface difference rather than the whole map.
            let summary = match (ev, av) {
                (SVal::Map(em), SVal::Map(am)) => {
                    let detail = em
                        .iter()
                        .find_map(|(k, v)| {
                            let av = am
                                .iter()
                                .find(|(ak, _)| source_reader::same(ak, k))
                                .map(|(_, av)| av);
                            match av {
                                Some(av) if !source_reader::same(v, av) => {
                                    Some(format!("first key {k:?} expected={v:?} actual={av:?}"))
                                }
                                None => Some(format!("missing key {k:?}")),
                                _ => None,
                            }
                        })
                        .unwrap_or_else(|| "same keys but map length/order differs".into());
                    format!("map expected={} actual={}; {detail}", em.len(), am.len())
                }
                (SVal::Arr(ea), SVal::Arr(aa)) => {
                    format!("array expected={} actual={}", ea.len(), aa.len())
                }
                _ => format!("expected={ev:?} actual={av:?}"),
            };
            failures.push(format!("{label}.{name}: {summary}"));
        }
    }
}

fn parse_strategy_self(v: &SVal) -> R<StrategySelf> {
    let weapons = strict_weapon_list(field(v, "weapons")?, "self.weapons")?;
    let mob_stats = match v.optional("mobStats") {
        None | Some(SVal::Undefined) => Vec::new(),
        Some(SVal::Obj(entries)) => entries
            .iter()
            .map(|(kind, count)| {
                Ok((
                    kind.clone(),
                    uint_value(count, "mobStats count", u64::from(u32::MAX))? as u32,
                ))
            })
            .collect::<R<Vec<_>>>()?,
        Some(other) => return Err(format!("self.mobStats: expected an object, got {other:?}")),
    };
    let slot = uint(v, "slot", 1)? as u8;
    Ok(StrategySelf {
        id: text(v, "id")?,
        name: text(v, "name")?,
        faction: strict_opt_faction(v, "faction")?,
        x: finite(v, "x")?,
        y: finite(v, "y")?,
        facing: finite(v, "facing")?,
        status: strict_status_value(field(v, "status")?, "self.status")?,
        hp: finite(v, "hp")?,
        max_hp: finite(v, "maxHp")?,
        barrier: finite(v, "barrier")?,
        draw_started_at: finite(v, "drawStartedAt")?,
        ready_at: finite(v, "readyAt")?,
        immune_until: finite(v, "immuneUntil")?,
        sig: finite(v, "sig")?,
        brand: finite(v, "brand")?,
        as_mult: finite(v, "asMult")?,
        windup_mult: finite(v, "windupMult")?,
        gv: finite(v, "gv")?,
        move_seq: finite(v, "moveSeq")?,
        weapons,
        slot,
        attack_target: opt_text(v, "attackTarget")?,
        mob_kills: finite(v, "mobKills")?,
        power: finite(v, "power")?,
        kills: finite(v, "kills")?,
        mob_stats,
        speed_mult: finite(v, "speedMult")?,
        bounty: finite(v, "bounty")?,
    })
}

fn parse_strategy_percept(input: &SVal, _cfg: &SourceConfig) -> R<StrategyPercept> {
    let self_v = field(input, "self")?;
    let hud = field(input, "hud")?;
    let fighters = arr(input, "fighters")?
        .iter()
        .map(|f| {
            Ok(super::types::StrategyFighter {
                id: text(f, "id")?,
                x: finite(f, "x")?,
                y: finite(f, "y")?,
                dist: finite(f, "dist")?,
                los: boolv(f, "los")?,
                status: strict_status_value(field(f, "status")?, "status")?,
                targetable: boolv(f, "targetable")?,
                immune: boolv(f, "immune")?,
                hp_frac: finite(f, "hpFrac")?,
                faction: strict_opt_faction(f, "faction")?,
                in_hand: strict_opt_weapon(f, "inHand")?,
                bounty: finite(f, "bounty")?,
                tint: finite(f, "tint")?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let mobs = arr(input, "mobs")?
        .iter()
        .map(|m| {
            Ok(super::types::StrategyMob {
                id: text(m, "id")?,
                x: finite(m, "x")?,
                y: finite(m, "y")?,
                status: strict_status_value(field(m, "status")?, "status")?,
                kind: text(m, "kind")?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let containers = arr(input, "containers")?
        .iter()
        .map(|c| {
            Ok(super::types::StrategyContainer {
                id: text(c, "id")?,
                kind: text(c, "kind")?,
                x: finite(c, "x")?,
                y: finite(c, "y")?,
                closed: boolv(c, "closed")?,
                weapon: match c.optional("weapon") {
                    Some(SVal::Str(s)) => super::super::memory::ContainersWeapon::Weapon(
                        parse_weapon(s).ok_or_else(|| format!("weapon {s}"))?,
                    ),
                    Some(SVal::Null) => super::super::memory::ContainersWeapon::Null,
                    _ => super::super::memory::ContainersWeapon::Undefined,
                },
            })
        })
        .collect::<R<Vec<_>>>()?;
    let mut extras = super::types::StrategyExtras::default();
    if let Ok(extras_v) = field(input, "extras") {
        if let Some(camps) = extras_v.optional("camps") {
            let mut views = Vec::new();
            for c in camps.arr("extras.camps")? {
                views.push(super::types::CampView {
                    index: uint(c, "index", u64::from(u32::MAX))? as usize,
                    type_: opt_text(c, "type")?,
                    // Frozen corpus: legacy's CampState.reward is the clear-reward kind (always "" here), not a stat.
                    reward: String::new(),
                    alive: uint(c, "alive", u64::from(u32::MAX))? as u32,
                    state: uint(c, "state", 2)? as u8,
                    respawn_at: c.opt_num("respawnAt", "respawnAt")?,
                });
            }
            extras.camps = Some(views);
        }
    }
    Ok(StrategyPercept {
        now: finite(input, "now")?,
        self_: parse_strategy_self(self_v)?,
        hud: super::types::StrategyHud {
            raid_started_at: finite(hud, "raidStartedAt")?,
            patience_ends_at: finite(hud, "patienceEndsAt")?,
            sudden_death_at: finite(hud, "suddenDeathAt")?,
            in_coliseum: boolv(hud, "inColiseum")?,
            alive: uint(hud, "alive", u64::from(u32::MAX))? as u32,
            gates_locked: boolv(hud, "gatesLocked")?,
        },
        fighters,
        mobs,
        containers,
        extras,
    })
}

// --------------------------------------------------------------------------------------------------------------------
// Recording path harness and shared setup helpers

/// The declared source path service: the open/coordinate-block/null rules and the real rh_sim Pathfinder over the frozen
/// generated map for `kind: source`. Every call is appended to the case transcript with the exact source arguments.
struct PathHarness {
    spec: PathSpec,
    source_map: Option<rh_sim::TileMap>,
    finder: rh_sim::pathfind::Pathfinder,
    trace: TraceHandle,
}

impl PathHarness {
    fn new(cfg: &SourceConfig, trace: &TraceHandle) -> Self {
        Self {
            spec: cfg.path.clone(),
            source_map: cfg.tile_map.clone(),
            finder: rh_sim::pathfind::Pathfinder::default(),
            trace: trace.clone(),
        }
    }

    fn answer(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        match &self.spec {
            PathSpec::Null => None,
            PathSpec::CoordinateBlock { min_x, max_x } if to.x >= *min_x && to.x <= *max_x => None,
            PathSpec::CoordinateBlock { .. } => Some(WalkAnswer {
                dist: rh_sim::math::hypot(to.x - from.x, to.y - from.y),
                exact: true,
            }),
            PathSpec::Source => {
                let map = self.source_map.as_ref()?;
                let path = self
                    .finder
                    .find_path(map, from, to, rh_sim::constants::PLAYER_RADIUS);
                if path.is_empty() {
                    None
                } else {
                    Some(WalkAnswer {
                        dist: crate::bots::paths::path_length(from, &path),
                        exact: true,
                    })
                }
            }
            PathSpec::Open { factor, exact } => Some(WalkAnswer {
                dist: rh_sim::math::hypot(to.x - from.x, to.y - from.y) * factor,
                exact: *exact,
            }),
        }
    }
}

fn encode_walk_result(result: &Option<WalkAnswer>) -> SVal {
    match result {
        None => source_reader::null(),
        Some(answer) => obj(vec![
            ("dist", num_sv(answer.dist)),
            ("exact", bool_sv(answer.exact)),
        ]),
    }
}

impl super::types::PathApi for PathHarness {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        self.answer(from, to)
    }
    fn walk_camp(&mut self, from: &StrategySelf, to: &CampDef) -> Option<WalkAnswer> {
        let result = self.answer(from.pos(), Vec2::new(to.x, to.y));
        record_callback(
            &self.trace,
            "paths.walk",
            vec![encode_strategy_self(from), encode_source_camp(to)],
            encode_walk_result(&result),
        );
        result
    }
    fn walk_mob(&mut self, from: Vec2, to: &HuntMobLike) -> Option<WalkAnswer> {
        let result = self.answer(from, Vec2::new(to.x, to.y));
        record_callback(
            &self.trace,
            "paths.walk",
            vec![vec2_sv(from), encode_hunt_mob_like(to)],
            encode_walk_result(&result),
        );
        result
    }
    fn los(&self, _a: Vec2, _b: Vec2) -> bool {
        !matches!(self.spec, PathSpec::Null)
    }
    fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
        !matches!(self.spec, PathSpec::Null)
    }
}

fn must<T>(result: R<T>, label: &str) -> T {
    result.unwrap_or_else(|error| panic!("{label}: {error}"))
}

fn case_id(case_json: &Value) -> String {
    case_json["id"]
        .as_str()
        .expect("frozen case id is a string")
        .to_string()
}

fn case_cfg(case_json: &Value, maps: &Value) -> SourceConfig {
    let config = sv(&case_json["config"]);
    must(parse_config(&config, maps), "case config")
}

fn operations(case_json: &Value) -> &[Value] {
    case_json["operations"]
        .as_array()
        .expect("frozen case operations")
}

fn assert_no_setup(case_json: &Value, label: &str) {
    match sv(&case_json["setupTranscript"]) {
        SVal::Arr(values) => assert!(
            values.is_empty(),
            "{label}: expected no setup transcript, got {} entries",
            values.len()
        ),
        other => panic!("{label}: setupTranscript must be an array, got {other:?}"),
    }
}

/// Create the real admitted Knowledge from the source's separate seed+3 constructor stream and check the frozen setup
/// transcript: exactly 70 ordered draws (10 faction masks, 10 weapon masks, 50 share errors), then prove the admitted
/// constructor consumed exactly that many draws by comparing the next draw of a same-seed stream.
fn knowledge_setup(
    cfg: &SourceConfig,
    case_json: &Value,
    label: &str,
    failures: &mut Vec<String>,
) -> (Knowledge, usize, TraceHandle) {
    let expected = sv(&case_json["setupTranscript"]);
    let entries = match &expected {
        SVal::Arr(values) => values.len(),
        other => panic!("{label}: setupTranscript must be an array, got {other:?}"),
    };
    assert_eq!(
        entries, 70,
        "{label}: source Knowledge construction draw count"
    );
    let mut actual = Rng::new(cfg.seed + 3);
    let knowledge = Knowledge::create(&cfg.tier, &mut actual);
    let next_actual = actual.next_f64();
    let mut probe = Rng::new(cfg.seed + 3);
    for _ in 0..entries {
        probe.next_f64();
    }
    let next_probe = probe.next_f64();
    assert!(
        next_actual.to_bits() == next_probe.to_bits(),
        "{label}: admitted Knowledge constructor did not consume exactly {entries} seed+3 draws"
    );
    let setup_trace = TraceLog::new_handle();
    {
        let mut recorder = TraceRng::new(cfg.seed + 3, Vec::new(), "knowledge", &setup_trace);
        for _ in 0..entries {
            recorder.draw();
        }
    }
    compare_callbacks(
        &format!("{label} setupTranscript"),
        &expected,
        &setup_trace,
        failures,
    );
    (knowledge, entries, setup_trace)
}

fn compare_initial_memory(
    label: &str,
    case_json: &Value,
    mem: &super::super::memory::Memory,
    failures: &mut Vec<String>,
) {
    let expected = sv(&case_json["initial"]["memory"]);
    compare_memory(
        &format!("{label} initial"),
        &expected,
        &encode_memory(mem),
        failures,
    );
}

fn compare_initial_own(label: &str, case_json: &Value, own: SVal, failures: &mut Vec<String>) {
    let expected = sv(&case_json["initial"]["own"]);
    if !super::source_trace::own_same(&expected, &own) {
        let detail = super::source_trace::first_difference(&expected, &own, "own")
            .unwrap_or_else(|| "own shape differs".into());
        failures.push(format!("{label} initial.own: {detail}"));
    }
}

fn compare_op_own(label: &str, op_json: &Value, own: SVal, failures: &mut Vec<String>) {
    let expected = sv(&op_json["own"]);
    if !super::source_trace::own_same(&expected, &own) {
        let detail = super::source_trace::first_difference(&expected, &own, "own")
            .unwrap_or_else(|| "own shape differs".into());
        failures.push(format!("{label} own: {detail}"));
    }
}

fn compare_op_memory(
    label: &str,
    op_json: &Value,
    mem: &super::super::memory::Memory,
    failures: &mut Vec<String>,
) {
    let expected = sv(&op_json["memory"]);
    compare_memory(label, &expected, &encode_memory(mem), failures);
}

/// The uniform per-operation channels: the frozen ordered callback/RNG transcript, the cumulative four-stream draw
/// counts, and (when requested) any suite getters already compared by the caller.
fn check_channels(
    label: &str,
    op_json: &Value,
    trace: &TraceHandle,
    draw_counts: Option<[usize; 4]>,
    failures: &mut Vec<String>,
) {
    compare_callbacks(label, &sv(&op_json["callbacks"]), trace, failures);
    let [decide, motor, lapse, knowledge] = draw_counts.unwrap_or([0, 0, 0, 0]);
    compare_draw_counts(
        label,
        &sv(&op_json["drawCounts"]),
        decide,
        motor,
        lapse,
        knowledge,
        failures,
    );
}

#[derive(Default)]
struct ReplayOutcome {
    cases: usize,
    operations: usize,
    non_advance: usize,
    failures: Vec<String>,
}

impl ReplayOutcome {
    fn into_green(self, label: &str, expected_cases: usize, expected_operations: usize) {
        eprintln!(
            "PARITY_TOTAL {label} : {} cases / {} ops / {} non-advance / {} failures",
            self.cases,
            self.operations,
            self.non_advance,
            self.failures.len()
        );
        assert_eq!(self.cases, expected_cases, "{label}: case count");
        assert_eq!(
            self.operations, expected_operations,
            "{label}: operation count"
        );
        assert!(
            self.failures.is_empty(),
            "{label} parity {}/{}; first failures:\n{}",
            self.cases,
            self.operations,
            self.failures
                .iter()
                .take(60)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Complete typed operation preflight, run on the actual replay path before any Memory/state/RNG/callback mutation.

fn strict_vec2_value(v: &SVal, name: &str) -> R<Vec2> {
    strict_keys(v, &["x", "y"], name)?;
    Ok(Vec2::new(finite(v, "x")?, finite(v, "y")?))
}

/// The declared path/walk descriptor of a mob hunt (`open` factor, `coordinate-block` range or `null`).
fn preflight_hunt_walk(descriptor: &SVal) -> R<()> {
    match text(descriptor, "kind")?.as_str() {
        "null" => strict_keys(descriptor, &["kind"], "walk"),
        "open" => {
            strict_keys(descriptor, &["kind", "factor"], "walk")?;
            finite(descriptor, "factor")?;
            Ok(())
        }
        "coordinate-block" => {
            strict_keys(descriptor, &["kind", "minX", "maxX"], "walk")?;
            finite(descriptor, "minX")?;
            finite(descriptor, "maxX")?;
            Ok(())
        }
        other => Err(format!(
            "walk.kind: unknown declared walk descriptor {other}"
        )),
    }
}

fn preflight_hunter_decide(input: &SVal) -> R<()> {
    strict_keys(
        input,
        &[
            "now",
            "self",
            "playerDistance",
            "players",
            "inColiseum",
            "mobs",
            "walk",
            "attacking",
            "shotByPlayerAt",
            "typeWeights",
            "elitesReady",
        ],
        "hunterDecide",
    )?;
    finite(input, "now")?;
    parse_hunt_self(field(input, "self")?)?;
    match field(input, "playerDistance")? {
        SVal::Num(value) if value.is_nan() || *value == f64::NEG_INFINITY => {
            return Err("playerDistance: invalid sentinel".into())
        }
        SVal::Num(_) => {}
        other => return Err(format!("playerDistance: expected a number, got {other:?}")),
    }
    arr(input, "players")?
        .iter()
        .map(|p| strict_vec2_value(p, "players[]"))
        .collect::<R<Vec<_>>>()?;
    boolv(input, "inColiseum")?;
    parse_mob_entries(field(input, "mobs")?).map(|_| ())?;
    preflight_hunt_walk(field(input, "walk")?)?;
    boolv(input, "attacking")?;
    match field(input, "shotByPlayerAt")? {
        SVal::Num(value) if value.is_nan() || *value == f64::INFINITY => {
            return Err("shotByPlayerAt: invalid sentinel".into())
        }
        SVal::Num(_) => {}
        other => return Err(format!("shotByPlayerAt: expected a number, got {other:?}")),
    }
    if let Some(weights) = input.optional("typeWeights") {
        for (index, entry) in weights.arr("typeWeights")?.iter().enumerate() {
            let pair = entry
                .arr("typeWeight pair")
                .map_err(|_| format!("typeWeights[{index}]: expected [type, weight]"))?;
            if pair.len() != 2 {
                return Err(format!("typeWeights[{index}]: expected [type, weight]"));
            }
            pair[0].string("typeWeight key")?;
            finite_value(&pair[1], "typeWeight value")?;
        }
    }
    if let Some(ready) = input.optional("elitesReady") {
        if !matches!(ready, SVal::Bool(_)) {
            return Err(format!("elitesReady: expected a boolean, got {ready:?}"));
        }
    }
    Ok(())
}

fn preflight_route_input(input: &SVal) -> R<()> {
    strict_keys(
        input,
        &[
            "now", "runMs", "self", "speed", "mobKills", "power", "camps", "players", "canFarm",
        ],
        "route input",
    )?;
    finite(input, "now")?;
    finite(input, "runMs")?;
    strict_vec2_value(field(input, "self")?, "route input self")?;
    finite(input, "speed")?;
    finite(input, "mobKills")?;
    finite(input, "power")?;
    arr(input, "camps")?
        .iter()
        .map(parse_route_camp)
        .collect::<R<Vec<_>>>()?;
    arr(input, "players")?
        .iter()
        .map(|p| strict_vec2_value(p, "players[]"))
        .collect::<R<Vec<_>>>()?;
    can_farm_descriptor(field(input, "canFarm")?).map(|_| ())?;
    Ok(())
}

fn preflight_decide(op: &SVal, cfg: &SourceConfig) -> R<()> {
    let declaration = field(op, "declaration")?;
    let input = field(op, "input")?;
    let current_source = text(input, "currentSource")?;
    if !matches!(current_source.as_str(), "previous-decision" | "declared") {
        return Err(format!(
            "decide.currentSource: unknown caller declaration source {current_source}"
        ));
    }
    match declaration.optional("current") {
        Some(SVal::Str(previous)) if previous == "$previous" => {
            if current_source != "previous-decision" {
                return Err(
                    "decide: $previous declaration must carry currentSource previous-decision"
                        .into(),
                );
            }
        }
        Some(goal) => {
            parse_goal(goal)?;
            if current_source != "declared" {
                return Err("decide: declared current must carry currentSource declared".into());
            }
        }
        None => return Err("decide declaration missing current".into()),
    }
    parse_goal(field(input, "current")?)?;
    parse_status(field(input, "status")?)?;
    boolv(input, "engaged")?;
    if let Some(declared_engaged) = declaration.optional("engaged") {
        let declared_engaged = declared_engaged.bool("declaration.engaged")?;
        if declared_engaged != boolv(input, "engaged")? {
            return Err(
                "decide: declaration engaged differs from the consumed input engaged".into(),
            );
        }
    }
    if let Some(env) = declaration.optional("env") {
        if let Some(goals) = env.optional("moduleGoals") {
            for (module, offers) in goals.obj("moduleGoals")? {
                if !cfg.modules.iter().any(|declared| declared.id == *module) {
                    return Err(format!(
                        "decide.env.moduleGoals: module {module} is not declared in the config modules"
                    ));
                }
                match offers {
                    SVal::Arr(values) => {
                        for offer in values {
                            parse_goal_decision(offer)?;
                        }
                    }
                    other => {
                        return Err(format!(
                            "moduleGoals.{module}: expected an array, got {other:?}"
                        ))
                    }
                }
            }
        }
    }
    // The declared module/learned/tier contracts are already preflighted by parse_config; the env override references
    // above are checked against this actual replay config.
    Ok(())
}

/// Typed preflight for the complete operation input, before the dispatch may touch Memory, retained state, RNG or the
/// callback transcript. Structural/tagged checks run first, then every consumed field is converted.
fn preflight_operation(
    case_json: &Value,
    op_json: &Value,
    suite: &str,
    supplement: bool,
    cfg: &SourceConfig,
    maps: &Value,
) -> R<()> {
    let case_label = case_id(case_json);
    super::source_strict::validate_operation_on_path(
        op_json,
        suite,
        supplement,
        &format!("{case_label} intake"),
    )?;
    let op = sv(op_json);
    let method = text(&op, "method")?;
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    match method.as_str() {
        "observe" => {
            parse_memory_percept(&input, &cfg.features)?;
            if suite != "memory-api" {
                parse_strategy_percept(&input, cfg)?;
            }
        }
        "nullPercept" => {}
        "recordChoice" => {
            input.string("recordChoice")?;
        }
        "noteSent" => {
            parse_note_sent(&input)?;
        }
        "whereabouts" => {
            strict_keys(&input, &["id", "now"], "whereabouts")?;
            text(&input, "id")?;
            finite(&input, "now")?;
        }
        "trackerObserve" => {
            strict_keys(&input, &["mobs", "now"], "trackerObserve")?;
            parse_mob_entries(field(&input, "mobs")?).map(|_| ())?;
            finite(&input, "now")?;
        }
        "trackerQuery" => {
            strict_keys(
                &input,
                &["id", "now", "from", "radius", "awakeMoved"],
                "trackerQuery",
            )?;
            text(&input, "id")?;
            finite(&input, "now")?;
            strict_vec2_value(field(&input, "from")?, "trackerQuery from")?;
            finite(&input, "radius")?;
            finite(&input, "awakeMoved")?;
        }
        "adapterDecide" | "release" => {}
        "awakeNear" => {
            strict_keys(&input, &["from", "now", "radius"], "awakeNear")?;
            strict_vec2_value(field(&input, "from")?, "awakeNear from")?;
            finite(&input, "now")?;
            finite(&input, "radius")?;
        }
        "hunterDecide" => preflight_hunter_decide(&input)?,
        "isBanned" => {
            strict_keys(&input, &["id", "now"], "isBanned")?;
            text(&input, "id")?;
            finite(&input, "now")?;
        }
        "routeUpdate" | "routePlan" => preflight_route_input(&input)?,
        "isContested" => {
            strict_keys(&input, &["camp", "now"], "isContested")?;
            uint(&input, "camp", u64::from(u32::MAX))?;
            finite(&input, "now")?;
        }
        "campValue" => {
            strict_keys(&input, &["camp", "elites"], "campValue")?;
            parse_route_camp(field(&input, "camp")?)?;
            boolv(&input, "elites")?;
        }
        "decide" => preflight_decide(&op, cfg)?,
        other => return Err(format!("{case_label}: no preflight for method {other}")),
    }
    let _ = maps;
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// In-memory intake injection controls: a malformed later field reaches the actual replay entrypoint; the preflight must
// reject it without advancing the reached Memory, nested retained state, RNG draws or the callback transcript.

#[derive(Clone, Copy, PartialEq, Eq)]
enum InjectionKind {
    StrategyDecideStatus,
    StrategyObserveWeapon,
    HunterWalk,
    HunterMobs,
    RouteCanFarm,
    MemoryNoteSentCommand,
    TrackerMobs,
}

impl InjectionKind {
    /// The exact semantic intake branch the malformed later field must reach (not the declaration/envelope mismatch
    /// guard, and not a panic).
    fn expected_error(self) -> &'static str {
        match self {
            Self::StrategyDecideStatus => "GoalStatus.state: unknown source status future",
            Self::StrategyObserveWeapon => "self.weapons[0]: unknown weapon laser",
            Self::HunterWalk => "walk.kind: unknown declared walk descriptor future",
            Self::HunterMobs => "hp: expected a finite number",
            Self::RouteCanFarm => "canFarm.kind: unknown descriptor future",
            Self::MemoryNoteSentCommand => "noteSent.cmd.type: unsupported source command future",
            Self::TrackerMobs => "kind: missing field kind",
        }
    }
    /// A short stable label for the red/green intake evidence.
    fn label(self) -> &'static str {
        match self {
            Self::StrategyDecideStatus => "strategy-decide-status",
            Self::StrategyObserveWeapon => "strategy-observe-weapon",
            Self::HunterWalk => "hunter-walk-kind",
            Self::HunterMobs => "hunter-malformed-mobs",
            Self::RouteCanFarm => "route-canfarm-kind",
            Self::MemoryNoteSentCommand => "memory-command-type",
            Self::TrackerMobs => "tracker-malformed-mobs",
        }
    }
}

struct Injection {
    case: String,
    op_index: usize,
    kind: InjectionKind,
}

impl Injection {
    fn matches(&self, case: &str, op_index: usize) -> bool {
        self.case == case && self.op_index == op_index
    }
}

fn tagged_object(pairs: Vec<(&str, Value)>) -> Value {
    serde_json::json!({
        "$": "object",
        "entries": pairs
            .into_iter()
            .map(|(key, value)| serde_json::json!([key, value]))
            .collect::<Vec<Value>>(),
    })
}

fn tagged_entry_mut<'a>(value: &'a mut Value, key: &str) -> Option<&'a mut Value> {
    value
        .get_mut("entries")?
        .as_array_mut()?
        .iter_mut()
        .find(|pair| pair.get(0).and_then(Value::as_str) == Some(key))
        .and_then(|pair| pair.get_mut(1))
}

fn tagged_values_mut(value: &mut Value) -> Option<&mut Vec<Value>> {
    value.get_mut("values")?.as_array_mut()
}

/// The first declared `[id, MobLike]` entry of a MobEntries method input (the encoded container is a tagged array; each
/// entry is itself a tagged two-element array).
fn first_mob_like_mut(input: &mut Value) -> &mut Value {
    let mobs = tagged_entry_mut(input, "mobs").expect("mobs");
    let entries = tagged_values_mut(mobs).expect("mobs array container");
    let entry = entries
        .first_mut()
        .expect("at least one declared mob entry");
    let pair = tagged_values_mut(entry).expect("mob entry pair container");
    assert_eq!(pair.len(), 2, "mob entry is [id, MobLike]");
    &mut pair[1]
}

/// Copy the (already mutated) consumed input into the caller declaration so the envelope declaration-consistency guard
/// passes and the malformed later field reaches the semantic typed validator.
fn sync_declaration_input(op: &mut Value) {
    let input = op
        .get("input")
        .cloned()
        .expect("injection target carries a declared input");
    let declaration = op
        .get_mut("declaration")
        .and_then(Value::as_object_mut)
        .expect("injection target carries a declaration");
    let entries = declaration
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .expect("tagged declaration entries");
    let declared = entries
        .iter_mut()
        .find(|pair| pair.get(0).and_then(Value::as_str) == Some("input"))
        .and_then(|pair| pair.get_mut(1))
        .expect("declaration input");
    *declared = input;
}

/// The decide declaration carries the same status object the caller passed; keep them consistent.
fn sync_declaration_status(op: &mut Value) {
    let status = tagged_entry_mut(&mut op["input"], "status")
        .cloned()
        .expect("decide input status");
    let declaration = op
        .get_mut("declaration")
        .and_then(Value::as_object_mut)
        .expect("decide declaration");
    let entries = declaration
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .expect("tagged declaration entries");
    let declared = entries
        .iter_mut()
        .find(|pair| pair.get(0).and_then(Value::as_str) == Some("status"))
        .and_then(|pair| pair.get_mut(1))
        .expect("declaration status");
    *declared = status;
}

impl Injection {
    fn apply(&self, op_json: &Value) -> Value {
        let mut op = op_json.clone();
        let input = op
            .get_mut("input")
            .expect("injection target carries a declared input");
        match self.kind {
            InjectionKind::StrategyDecideStatus => {
                let input = input.as_object_mut().expect("decide input is tagged");
                let entry = input
                    .get_mut("entries")
                    .and_then(Value::as_array_mut)
                    .expect("tagged entries");
                let status = entry
                    .iter_mut()
                    .find(|pair| pair.get(0).and_then(Value::as_str) == Some("status"))
                    .and_then(|pair| pair.get_mut(1))
                    .expect("decide input status");
                *status = tagged_object(vec![
                    ("state", Value::String("future".into())),
                    ("why", Value::String("injected malformed status".into())),
                ]);
            }
            InjectionKind::StrategyObserveWeapon => {
                let self_value = tagged_entry_mut(input, "self").expect("percept self");
                let weapons = tagged_entry_mut(self_value, "weapons").expect("self weapons");
                let values = tagged_values_mut(weapons).expect("weapon tuple array");
                assert_eq!(values.len(), 2, "source weapon tuple");
                values[0] = Value::String("laser".into());
            }
            InjectionKind::HunterWalk => {
                let walk = tagged_entry_mut(input, "walk").expect("walk descriptor");
                let kind = tagged_entry_mut(walk, "kind").expect("walk kind");
                *kind = Value::String("future".into());
            }
            InjectionKind::HunterMobs => {
                let mob = first_mob_like_mut(input);
                let hp = tagged_entry_mut(mob, "hp").expect("mob hp");
                *hp = Value::String("not-a-number".into());
            }
            InjectionKind::RouteCanFarm => {
                let can_farm = tagged_entry_mut(input, "canFarm").expect("canFarm descriptor");
                let kind = tagged_entry_mut(can_farm, "kind").expect("canFarm kind");
                *kind = Value::String("future".into());
            }
            InjectionKind::MemoryNoteSentCommand => {
                let cmd = tagged_entry_mut(input, "cmd").expect("noteSent cmd");
                let kind = tagged_entry_mut(cmd, "type").expect("command type");
                *kind = Value::String("future".into());
            }
            InjectionKind::TrackerMobs => {
                let mob = first_mob_like_mut(input);
                mob.get_mut("entries")
                    .and_then(Value::as_array_mut)
                    .expect("mob entries")
                    .retain(|pair| pair.get(0).and_then(Value::as_str) != Some("kind"));
            }
        }
        // Keep the frozen caller declaration consistent with the consumed copy for every injection; a separate control
        // below deliberately breaks only one copy to exercise the declaration-mismatch guard.
        if self.kind == InjectionKind::StrategyDecideStatus {
            sync_declaration_status(&mut op);
        } else {
            sync_declaration_input(&mut op);
        }
        op
    }
}

fn draw_counts_value(draws: [usize; 4]) -> SVal {
    let [decide, motor, lapse, knowledge] = draws;
    obj(vec![
        ("decide", num_sv(decide as f64)),
        ("motor", num_sv(motor as f64)),
        ("lapse", num_sv(lapse as f64)),
        ("knowledge", num_sv(knowledge as f64)),
    ])
}

fn non_advance_snapshot(
    memory: &super::super::memory::Memory,
    own: SVal,
    draws: [usize; 4],
    trace: &TraceHandle,
) -> SVal {
    let callbacks = trace.lock().expect("trace lock poisoned").encoded();
    obj(vec![
        ("memory", encode_memory(memory)),
        ("own", own),
        ("drawCounts", draw_counts_value(draws)),
        ("callbacks", callbacks),
    ])
}

/// A malformed later field reached the SAME checked apply/dispatch entrypoint as every normal operation; the typed
/// preflight must reject it on the intended semantic branch and no native Memory/nested state/RNG/callback channel may
/// have advanced. (The entrypoint resets the transcript only after its preflight accepts the operation.)
fn record_intake_result(
    injection: &Injection,
    suite: &str,
    result: R<SVal>,
    before: &SVal,
    after: &SVal,
    failures: &mut Vec<String>,
) {
    match result {
        Ok(_) => failures.push(format!(
            "INTENT {}: injected malformed field was accepted at the {suite} entrypoint",
            injection.kind.label()
        )),
        Err(error) if !super::source_trace::ordered_same(before, after) => failures.push(format!(
            "INTENT {}: rejected malformed operation still advanced Memory/own-RNG/callback state (error {error:?})",
            injection.kind.label()
        )),
        Err(error) if !error.contains(injection.kind.expected_error()) => failures.push(format!(
            "INTENT {}: malformed field was rejected on the wrong path; expected {:?} in error, got {error:?}",
            injection.kind.label(),
            injection.kind.expected_error()
        )),
        Err(error) => {
            eprintln!(
                "INTAKE_NON_ADVANCE {}: semantic rejection at shared checked entrypoint -> {}",
                injection.kind.label(),
                error
            );
        }
    }
}

fn first_injectable(cases: &[Value], suite: &str, method: &str) -> Option<(String, usize)> {
    for case_json in cases {
        if case_json["suite"] != suite {
            continue;
        }
        for (index, op_json) in operations(case_json).iter().enumerate() {
            if index == 0 {
                continue;
            }
            if op_json["method"].as_str() == Some(method) {
                return Some((case_id(case_json), index));
            }
        }
    }
    None
}

// --------------------------------------------------------------------------------------------------------------------
// Checked apply/dispatch entrypoints shared by normal replay and malformed-field injections

#[allow(clippy::too_many_arguments)]
fn execute_tracker_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    trace: &TraceHandle,
    tracker: &mut MobTracker,
) -> R<SVal> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "mob-tracker", false, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let op = sv(op_json);
    let method = text(&op, "method").expect("tracker method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "trackerObserve" => {
            let now = num(&input, "now").expect("trackerObserve now");
            let mobs = must(
                parse_mob_entries(field(&input, "mobs").expect("mobs")),
                "trackerObserve mobs",
            );
            tracker.observe(&mobs, now);
            SVal::Undefined
        }
        "trackerQuery" => {
            let id = text(&input, "id").expect("trackerQuery id");
            let now = num(&input, "now").expect("trackerQuery now");
            let from_sv = field(&input, "from").expect("trackerQuery from");
            let from = Vec2::new(
                num(from_sv, "x").expect("from.x"),
                num(from_sv, "y").expect("from.y"),
            );
            let radius = num(&input, "radius").expect("trackerQuery radius");
            let awake_moved = num(&input, "awakeMoved").expect("awakeMoved");
            let mob = match tracker.mob(&id) {
                Some(m) => obj(vec![
                    ("kind", source_reader::s(&m.kind)),
                    (
                        "type",
                        m.type_
                            .as_deref()
                            .map(source_reader::s)
                            .unwrap_or(SVal::Null),
                    ),
                    ("status", source_reader::s(&m.status)),
                    ("x", num_sv(m.x)),
                    ("y", num_sv(m.y)),
                    ("hp", num_sv(m.hp)),
                    ("maxHp", num_sv(m.max_hp)),
                    (
                        "faction",
                        m.faction
                            .map(|f| source_reader::s(f.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                    (
                        "weapon0",
                        m.weapon0
                            .map(|w| source_reader::s(w.as_str()))
                            .unwrap_or(SVal::Null),
                    ),
                ]),
                None => SVal::Null,
            };
            let home = tracker.home(&id).map(vec2_sv).unwrap_or(SVal::Null);
            let awake_near = tracker
                .awake_near(from, radius, now, awake_moved)
                .into_iter()
                .map(vec2_sv)
                .collect();
            obj(vec![
                ("mob", mob),
                ("home", home),
                ("returning", source_reader::b(tracker.returning(&id, now))),
                (
                    "awake",
                    source_reader::b(tracker.awake(&id, now, awake_moved)),
                ),
                ("awakeNear", source_reader::arr(awake_near)),
            ])
        }
        other => panic!("{case_label}: unsupported tracker method {other}"),
    };
    Ok(actual)
}

#[allow(clippy::too_many_arguments)]
fn execute_hunter_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    trace: &TraceHandle,
    hunter: &mut MobHunter,
) -> R<SVal> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "mob-hunter", false, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let op = sv(op_json);
    let method = text(&op, "method").expect("hunter method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "hunterDecide" => {
            let now = num(&input, "now").expect("hunterDecide now");
            let self_view = must(
                parse_hunt_self(field(&input, "self").expect("self")),
                "hunterDecide self",
            );
            let players = arr(&input, "players")
                .expect("players")
                .iter()
                .map(|p| {
                    Ok(Vec2::new(
                        num(p, "x").expect("player x"),
                        num(p, "y").expect("player y"),
                    ))
                })
                .collect::<R<Vec<_>>>()
                .expect("players");
            let mobs = must(
                parse_mob_entries(field(&input, "mobs").expect("mobs")),
                "hunterDecide mobs",
            );
            let descriptor = field(&input, "walk").expect("walk");
            let kind = text(descriptor, "kind").expect("walk kind");
            let factor = descriptor
                .opt_num("factor", "factor")
                .expect("walk factor")
                .unwrap_or(1.);
            let min_x = descriptor.opt_num("minX", "minX").expect("walk minX");
            let max_x = descriptor.opt_num("maxX", "maxX").expect("walk maxX");
            let self_x = self_view.x;
            let self_y = self_view.y;
            let walk_trace = trace.clone();
            let mut walk = move |mob: &HuntMobLike| -> Option<f64> {
                let result = match kind.as_str() {
                    "null" => None,
                    "coordinate-block"
                        if mob.x >= min_x.unwrap_or(f64::NEG_INFINITY)
                            && mob.x <= max_x.unwrap_or(f64::INFINITY) =>
                    {
                        None
                    }
                    _ => Some(rh_sim::math::hypot(mob.x - self_x, mob.y - self_y) * factor),
                };
                let encoded = match &result {
                    None => SVal::Null,
                    Some(value) => num_sv(*value),
                };
                record_callback(
                    &walk_trace,
                    "hunter.walk",
                    vec![encode_hunt_mob_like(mob)],
                    encoded,
                );
                result
            };
            let weight = input.optional("typeWeights").cloned();
            let type_weight = weight.as_ref().map(|weights| {
                let pairs = weights
                    .arr("typeWeights")
                    .expect("typeWeights")
                    .iter()
                    .map(|p| {
                        let pair = p.arr("typeWeight pair").expect("pair");
                        (
                            pair[0].string("typeWeight key").expect("key").to_string(),
                            pair[1].num("typeWeight value").expect("value"),
                        )
                    })
                    .collect::<Vec<_>>();
                let weight_trace = trace.clone();
                move |ty: Option<&str>| -> f64 {
                    let value = ty
                        .and_then(|t| pairs.iter().find(|(k, _)| k == t).map(|(_, v)| *v))
                        .unwrap_or(0.25);
                    let argument = ty.map(source_reader::s).unwrap_or(SVal::Undefined);
                    record_callback(
                        &weight_trace,
                        "hunter.typeWeight",
                        vec![argument],
                        num_sv(value),
                    );
                    value
                }
            });
            let type_weight_ref = type_weight
                .as_ref()
                .map(|f| f as &dyn Fn(Option<&str>) -> f64);
            let player_distance = match field(&input, "playerDistance").expect("pd") {
                SVal::Num(value) => *value,
                other => panic!("playerDistance {other:?}"),
            };
            let shot_by_player_at = match field(&input, "shotByPlayerAt").expect("shot") {
                SVal::Num(value) => *value,
                other => panic!("shotByPlayerAt {other:?}"),
            };
            let mut hunt_input = HuntInput {
                now,
                self_: &self_view,
                player_distance,
                players: &players,
                in_coliseum: boolv(&input, "inColiseum").expect("inColiseum"),
                mobs: &mobs,
                walk: &mut walk,
                attacking: boolv(&input, "attacking").expect("attacking"),
                shot_by_player_at,
                type_weight: type_weight_ref,
                elites_ready: input
                    .optional("elitesReady")
                    .and_then(|value| value.bool("elitesReady").ok()),
            };
            encode_decision(&hunter.decide(&mut hunt_input))
        }
        "isBanned" => {
            let id = text(&input, "id").expect("isBanned id");
            let now = num(&input, "now").expect("isBanned now");
            source_reader::b(hunter.is_banned(&id, now))
        }
        other => panic!("{case_label}: unsupported hunter method {other}"),
    };
    Ok(actual)
}

#[allow(clippy::too_many_arguments)]
fn execute_route_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    trace: &TraceHandle,
    route: &mut BuildRoute,
) -> R<SVal> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "build-route", false, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let op = sv(op_json);
    let method = text(&op, "method").expect("route method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "routeUpdate" | "routePlan" => {
            let camps = arr(&input, "camps")
                .expect("camps")
                .iter()
                .map(|c| must(parse_route_camp(c), "route camp"))
                .collect::<Vec<_>>();
            let self_sv = field(&input, "self").expect("self");
            let self_pos = Vec2::new(
                num(self_sv, "x").expect("self.x"),
                num(self_sv, "y").expect("self.y"),
            );
            let players = arr(&input, "players")
                .expect("players")
                .iter()
                .map(|p| {
                    Ok(Vec2::new(
                        num(p, "x").expect("player x"),
                        num(p, "y").expect("player y"),
                    ))
                })
                .collect::<R<Vec<_>>>()
                .expect("players");
            let descriptor = field(&input, "canFarm").expect("canFarm");
            let inner = must(can_farm_descriptor(descriptor), "canFarm descriptor");
            let farm_trace = trace.clone();
            let can_farm = move |camp: &RouteCamp| -> bool {
                let result = inner(camp);
                record_callback(
                    &farm_trace,
                    "route.canFarm",
                    vec![encode_route_camp(camp)],
                    bool_sv(result),
                );
                result
            };
            let route_input = super::build_route::RouteInput {
                now: num(&input, "now").expect("now"),
                run_ms: num(&input, "runMs").expect("runMs"),
                self_pos,
                speed: num(&input, "speed").expect("speed"),
                mob_kills: num(&input, "mobKills").expect("mobKills"),
                power: num(&input, "power").expect("power"),
                camps: &camps,
                players: &players,
                can_farm: &can_farm,
            };
            if method == "routeUpdate" {
                route
                    .update(&route_input)
                    .map(|step| encode_route_step(&step))
                    .unwrap_or(SVal::Null)
            } else {
                route.plan(&route_input);
                SVal::Undefined
            }
        }
        "isContested" => {
            let camp = num(&input, "camp").expect("camp") as u32;
            let now = num(&input, "now").expect("now");
            source_reader::b(route.is_contested(camp, now))
        }
        "campValue" => {
            let camp = must(
                parse_route_camp(field(&input, "camp").expect("camp")),
                "campValue camp",
            );
            let elites = boolv(&input, "elites").expect("elites");
            num_sv(super::build_route::route_camp_value(
                route.build,
                &camp,
                elites,
            ))
        }
        other => panic!("{case_label}: unsupported route method {other}"),
    };
    Ok(actual)
}

#[allow(clippy::too_many_arguments)]
fn execute_memory_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    trace: &TraceHandle,
    mem: &mut super::super::memory::Memory,
) -> R<SVal> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "memory-api", false, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let op = sv(op_json);
    let method = text(&op, "method").expect("memory method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "nullPercept" => {
            assert!(
                matches!(input, SVal::Null),
                "{case_label}: nullPercept input"
            );
            SVal::Null
        }
        "observe" => {
            let percept = must(
                parse_memory_percept(&input, &cfg.features),
                "memory observe percept",
            );
            let stimuli = mem.observe(&percept).expect("memory observe");
            source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
        }
        "noteSent" => {
            let timed = must(parse_note_sent(&input), "noteSent");
            mem.note_sent(timed).expect("memory noteSent");
            SVal::Undefined
        }
        "recordChoice" => {
            mem.record_choice(input.string("choice").expect("choice"));
            SVal::Undefined
        }
        "whereabouts" => {
            let id = text(&input, "id").expect("whereabouts id");
            let now = num(&input, "now").expect("whereabouts now");
            match mem.whereabouts(&id, now).expect("memory whereabouts") {
                None => SVal::Null,
                Some(w) => obj(vec![("at", vec2_sv(w.at)), ("radius", num_sv(w.radius))]),
            }
        }
        other => panic!("{case_label}: unsupported memory method {other}"),
    };
    Ok(actual)
}

#[allow(clippy::too_many_arguments)]
fn execute_adapter_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    trace: &TraceHandle,
    mem: &mut super::super::memory::Memory,
    percept: &mut Option<StrategyPercept>,
    paths: &mut PathHarness,
    know: &RecordedKnowledge<'_>,
    learned: &RecordedLearned<'_>,
    adapter: &mut HuntAdapter,
    decide_rng: &mut TraceRng,
    lapse_rng: &mut TraceRng,
) -> R<SVal> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "hunt-adapter", false, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let empty_modules: Vec<Box<dyn super::types::FeatureModule>> = Vec::new();
    let op = sv(op_json);
    let method = text(&op, "method").expect("adapter method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "observe" => {
            let percept_input = must(
                parse_memory_percept(&input, &cfg.features),
                "adapter observe percept",
            );
            let strategy_percept = must(
                parse_strategy_percept(&input, cfg),
                "adapter observe strategy percept",
            );
            let stimuli = mem.observe(&percept_input).expect("adapter observe");
            *percept = Some(strategy_percept);
            source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
        }
        "adapterDecide" => {
            let p = percept.as_ref().expect("adapter decide needs an observe");
            let cfg_ctx = StrategyConfig {
                id: cfg.id.clone(),
                seed: cfg.seed,
                tier: &cfg.tier,
                persona: &cfg.persona,
                map: &cfg.map,
                features: &cfg.features,
                learned,
                modules: &empty_modules,
            };
            let weight = op.optional("typeWeights").cloned();
            let type_weight = weight.as_ref().map(|weights| {
                let pairs = weights
                    .arr("typeWeights")
                    .expect("typeWeights")
                    .iter()
                    .map(|p| {
                        let pair = p.arr("typeWeight pair").expect("pair");
                        (
                            pair[0].string("typeWeight key").expect("key").to_string(),
                            pair[1].num("typeWeight value").expect("value"),
                        )
                    })
                    .collect::<Vec<_>>();
                let weight_trace = trace.clone();
                move |ty: Option<&str>| -> f64 {
                    let value = ty
                        .and_then(|t| pairs.iter().find(|(k, _)| k == t).map(|(_, v)| *v))
                        .unwrap_or(0.25);
                    let argument = ty.map(source_reader::s).unwrap_or(SVal::Undefined);
                    record_callback(
                        &weight_trace,
                        "adapter.typeWeight",
                        vec![argument],
                        num_sv(value),
                    );
                    value
                }
            });
            let type_weight_ref = type_weight
                .as_ref()
                .map(|f| f as &dyn Fn(Option<&str>) -> f64);
            let mem_view = RecordedMemory {
                inner: &*mem,
                trace: trace.clone(),
            };
            let mut ctx = StrategyContext {
                cfg: &cfg_ctx,
                p,
                mem: &mem_view,
                know,
                paths,
                decide: decide_rng,
                lapse: lapse_rng,
                engaged: op
                    .optional("engaged")
                    .and_then(|value| value.bool("engaged").ok())
                    .unwrap_or(false),
            };
            let decision = adapter.decide(
                &mut ctx,
                type_weight_ref,
                op.optional("elitesReady")
                    .and_then(|value| value.bool("elitesReady").ok()),
            );
            encode_decision(&decision)
        }
        "release" => {
            let p = percept.as_ref().expect("release needs an observe");
            let cfg_ctx = StrategyConfig {
                id: cfg.id.clone(),
                seed: cfg.seed,
                tier: &cfg.tier,
                persona: &cfg.persona,
                map: &cfg.map,
                features: &cfg.features,
                learned,
                modules: &empty_modules,
            };
            let mem_view = RecordedMemory {
                inner: &*mem,
                trace: trace.clone(),
            };
            let mut ctx = StrategyContext {
                cfg: &cfg_ctx,
                p,
                mem: &mem_view,
                know,
                paths,
                decide: decide_rng,
                lapse: lapse_rng,
                engaged: false,
            };
            adapter.release(&mut ctx);
            SVal::Undefined
        }
        "awakeNear" => {
            let from = must(
                parse_vec2(field(&input, "from").expect("from")),
                "awakeNear from",
            );
            let radius = num(&input, "radius").expect("radius");
            let now = num(&input, "now").expect("now");
            source_reader::arr(
                adapter
                    .awake_near(from, radius, now)
                    .into_iter()
                    .map(vec2_sv)
                    .collect(),
            )
        }
        other => panic!("{case_label}: unsupported adapter method {other}"),
    };
    Ok(actual)
}

struct StrategyStep {
    actual: SVal,
    previous_guard_mismatch: bool,
}

#[allow(clippy::too_many_arguments)]
fn execute_strategy_op(
    cfg: &SourceConfig,
    case_json: &Value,
    op_json: &Value,
    maps: &Value,
    supplement: bool,
    trace: &TraceHandle,
    mem: &mut super::super::memory::Memory,
    percept: &mut Option<StrategyPercept>,
    paths: &mut PathHarness,
    know: &RecordedKnowledge<'_>,
    learned: &RecordedLearned<'_>,
    strategy: &mut Strategy,
    decide_rng: &mut TraceRng,
    lapse_rng: &mut TraceRng,
    last_goal: &mut Goal,
    op_index: usize,
) -> R<StrategyStep> {
    let case_label = case_id(case_json);
    preflight_operation(case_json, op_json, "strategy", supplement, cfg, maps)?;
    trace.lock().expect("trace lock poisoned").reset();
    let mut previous_guard_mismatch = false;
    let op = sv(op_json);
    let method = text(&op, "method").expect("strategy method");
    let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
    let actual = match method.as_str() {
        "observe" => {
            let percept_input = must(
                parse_memory_percept(&input, &cfg.features),
                "strategy observe percept",
            );
            let strategy_percept = must(
                parse_strategy_percept(&input, cfg),
                "strategy observe strategy percept",
            );
            let stimuli = mem.observe(&percept_input).expect("strategy observe");
            *percept = Some(strategy_percept);
            source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
        }
        "recordChoice" => {
            mem.record_choice(input.string("choice").expect("recordChoice"));
            SVal::Undefined
        }
        "decide" => {
            let p = percept.as_ref().expect("decide needs an observe");
            let declaration = field(&op, "declaration").expect("declaration");
            let previous = matches!(
                declaration.optional("current"),
                Some(SVal::Str(value)) if value == "$previous"
            );
            let current_input = field(&input, "current").expect("input.current");
            let current = if previous {
                let guard = must(parse_goal(current_input), "captured current guard");
                if !super::source_trace::ordered_same(&encode_goal(&guard), &encode_goal(last_goal))
                {
                    previous_guard_mismatch = true;
                }
                last_goal.clone()
            } else {
                must(parse_goal(current_input), "declared current")
            };
            let status = must(
                parse_status(field(&input, "status").expect("input.status")),
                "status",
            );
            let engaged = boolv(&input, "engaged").expect("engaged");
            let env = declaration.optional("env").cloned();
            let modules = modules_for(cfg, env.as_ref(), trace, op_index);
            let cfg_ctx = StrategyConfig {
                id: cfg.id.clone(),
                seed: cfg.seed,
                tier: &cfg.tier,
                persona: &cfg.persona,
                map: &cfg.map,
                features: &cfg.features,
                learned,
                modules: &modules,
            };
            let mem_view = RecordedMemory {
                inner: &*mem,
                trace: trace.clone(),
            };
            let mut ctx = StrategyContext {
                cfg: &cfg_ctx,
                p,
                mem: &mem_view,
                know,
                paths,
                decide: decide_rng,
                lapse: lapse_rng,
                engaged,
            };
            let out = strategy.decide(&mut ctx, &current, &status);
            *last_goal = out.goal.clone();
            encode_goal_decision(&out)
        }
        other => panic!("{case_label}: unsupported strategy method {other}"),
    };
    Ok(StrategyStep {
        actual,
        previous_guard_mismatch,
    })
}

// --------------------------------------------------------------------------------------------------------------------
// MobTracker suite replay

fn replay_tracker(source: &Value, injection: Option<&Injection>) -> ReplayOutcome {
    let maps = &source["maps"];
    let mut outcome = ReplayOutcome::default();
    for case_json in source_cases(source) {
        if case_json["suite"] != "mob-tracker" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let label = case_id(case_json);
        assert_no_setup(case_json, &label);
        let trace = TraceLog::new_handle();
        let mem = create_memory(&cfg);
        let mut tracker = MobTracker::default();
        compare_initial_memory(&label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &label,
            case_json,
            encode_mob_tracker(&tracker),
            &mut outcome.failures,
        );
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [0, 0, 0, 0];
                    let before =
                        non_advance_snapshot(&mem, encode_mob_tracker(&tracker), draws, &trace);
                    let result =
                        execute_tracker_op(&cfg, case_json, &mutated, maps, &trace, &mut tracker);
                    let after =
                        non_advance_snapshot(&mem, encode_mob_tracker(&tracker), draws, &trace);
                    record_intake_result(
                        injection,
                        "mob-tracker",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual =
                match execute_tracker_op(&cfg, case_json, op_json, maps, &trace, &mut tracker) {
                    Ok(actual) => actual,
                    Err(error) => {
                        outcome.failures.push(format!(
                            "{op_label} checked intake/dispatch failed: {error}"
                        ));
                        break;
                    }
                };

            compare(&op_label, &expected, &actual, &mut outcome.failures);
            check_channels(&op_label, op_json, &trace, None, &mut outcome.failures);
            compare_op_own(
                &op_label,
                op_json,
                encode_mob_tracker(&tracker),
                &mut outcome.failures,
            );
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// MobHunter suite replay

fn replay_hunter(source: &Value, injection: Option<&Injection>) -> ReplayOutcome {
    let maps = &source["maps"];
    let mut outcome = ReplayOutcome::default();
    for case_json in source_cases(source) {
        if case_json["suite"] != "mob-hunter" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let label = case_id(case_json);
        assert_no_setup(case_json, &label);
        let trace = TraceLog::new_handle();
        let mem = create_memory(&cfg);
        let mut hunter = MobHunter::new_with_log(cfg.hunt_config, Some(options_log(&trace)));
        compare_initial_memory(&label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &label,
            case_json,
            encode_mob_hunter(&hunter),
            &mut outcome.failures,
        );
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [0, 0, 0, 0];
                    let before =
                        non_advance_snapshot(&mem, encode_mob_hunter(&hunter), draws, &trace);
                    let result =
                        execute_hunter_op(&cfg, case_json, &mutated, maps, &trace, &mut hunter);
                    let after =
                        non_advance_snapshot(&mem, encode_mob_hunter(&hunter), draws, &trace);
                    record_intake_result(
                        injection,
                        "mob-hunter",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual =
                match execute_hunter_op(&cfg, case_json, op_json, maps, &trace, &mut hunter) {
                    Ok(actual) => actual,
                    Err(error) => {
                        outcome.failures.push(format!(
                            "{op_label} checked intake/dispatch failed: {error}"
                        ));
                        break;
                    }
                };

            compare(&op_label, &expected, &actual, &mut outcome.failures);
            check_channels(&op_label, op_json, &trace, None, &mut outcome.failures);
            compare_op_own(
                &op_label,
                op_json,
                encode_mob_hunter(&hunter),
                &mut outcome.failures,
            );
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// BuildRoute suite replay

fn replay_build_route(source: &Value, injection: Option<&Injection>) -> ReplayOutcome {
    let maps = &source["maps"];
    let mut outcome = ReplayOutcome::default();
    for case_json in source_cases(source) {
        if case_json["suite"] != "build-route" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let label = case_id(case_json);
        assert_no_setup(case_json, &label);
        let trace = TraceLog::new_handle();
        let mem = create_memory(&cfg);
        let mut route = BuildRoute::new(cfg.faction, cfg.build_draw);
        compare_initial_memory(&label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &label,
            case_json,
            encode_build_route(&route),
            &mut outcome.failures,
        );
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [0, 0, 0, 0];
                    let before =
                        non_advance_snapshot(&mem, encode_build_route(&route), draws, &trace);
                    let result =
                        execute_route_op(&cfg, case_json, &mutated, maps, &trace, &mut route);
                    let after =
                        non_advance_snapshot(&mem, encode_build_route(&route), draws, &trace);
                    record_intake_result(
                        injection,
                        "build-route",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match execute_route_op(&cfg, case_json, op_json, maps, &trace, &mut route)
            {
                Ok(actual) => actual,
                Err(error) => {
                    outcome.failures.push(format!(
                        "{op_label} checked intake/dispatch failed: {error}"
                    ));
                    break;
                }
            };

            compare(&op_label, &expected, &actual, &mut outcome.failures);
            check_channels(&op_label, op_json, &trace, None, &mut outcome.failures);
            compare_op_own(
                &op_label,
                op_json,
                encode_build_route(&route),
                &mut outcome.failures,
            );
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// Admitted Memory API suite replay

fn replay_memory(source: &Value, injection: Option<&Injection>) -> ReplayOutcome {
    let maps = &source["maps"];
    let mut outcome = ReplayOutcome::default();
    for case_json in source_cases(source) {
        if case_json["suite"] != "memory-api" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let label = case_id(case_json);
        assert_no_setup(case_json, &label);
        let trace = TraceLog::new_handle();
        let mut mem = create_memory(&cfg);
        compare_initial_memory(&label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &label,
            case_json,
            encode_own(OwnState::None),
            &mut outcome.failures,
        );
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [0, 0, 0, 0];
                    let before =
                        non_advance_snapshot(&mem, encode_own(OwnState::None), draws, &trace);
                    let result =
                        execute_memory_op(&cfg, case_json, &mutated, maps, &trace, &mut mem);
                    let after =
                        non_advance_snapshot(&mem, encode_own(OwnState::None), draws, &trace);
                    record_intake_result(
                        injection,
                        "memory-api",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match execute_memory_op(&cfg, case_json, op_json, maps, &trace, &mut mem) {
                Ok(actual) => actual,
                Err(error) => {
                    outcome.failures.push(format!(
                        "{op_label} checked intake/dispatch failed: {error}"
                    ));
                    break;
                }
            };

            compare(&op_label, &expected, &actual, &mut outcome.failures);
            check_channels(&op_label, op_json, &trace, None, &mut outcome.failures);
            compare_op_own(
                &op_label,
                op_json,
                encode_own(OwnState::None),
                &mut outcome.failures,
            );
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// HuntAdapter suite replay

fn replay_hunt_adapter(source: &Value, injection: Option<&Injection>) -> ReplayOutcome {
    let maps = &source["maps"];
    let mut outcome = ReplayOutcome::default();
    for case_json in source_cases(source) {
        if case_json["suite"] != "hunt-adapter" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let label = case_id(case_json);
        let trace = TraceLog::new_handle();
        let (knowledge, knowledge_draws, _setup) =
            knowledge_setup(&cfg, case_json, &label, &mut outcome.failures);
        let mut mem = create_memory(&cfg);
        let mut percept: Option<StrategyPercept> = None;
        let mut paths = PathHarness::new(&cfg, &trace);
        let attacking = options_attacking(cfg.attacking, &trace);
        let adapter_opts = HuntAdapterOptions {
            attacking,
            log: Some(options_log(&trace)),
        };
        let mut adapter = HuntAdapter::new(&cfg.tier, &cfg.persona, adapter_opts);
        let know = RecordedKnowledge {
            inner: &knowledge,
            trace: trace.clone(),
        };
        let learned = RecordedLearned {
            enabled: cfg.learned.enabled,
            entries: &cfg.learned.entries,
            trace: trace.clone(),
        };
        let mut decide_rng = TraceRng::new(cfg.seed, cfg.random_decide.clone(), "decide", &trace);
        let mut lapse_rng = TraceRng::new(cfg.seed + 2, cfg.random_lapse.clone(), "lapse", &trace);
        compare_initial_memory(&label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &label,
            case_json,
            encode_hunt_adapter(&adapter),
            &mut outcome.failures,
        );
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [decide_rng.draws(), 0, lapse_rng.draws(), knowledge_draws];
                    let before =
                        non_advance_snapshot(&mem, encode_hunt_adapter(&adapter), draws, &trace);
                    let result = execute_adapter_op(
                        &cfg,
                        case_json,
                        &mutated,
                        maps,
                        &trace,
                        &mut mem,
                        &mut percept,
                        &mut paths,
                        &know,
                        &learned,
                        &mut adapter,
                        &mut decide_rng,
                        &mut lapse_rng,
                    );
                    let after =
                        non_advance_snapshot(&mem, encode_hunt_adapter(&adapter), draws, &trace);
                    record_intake_result(
                        injection,
                        "hunt-adapter",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match execute_adapter_op(
                &cfg,
                case_json,
                op_json,
                maps,
                &trace,
                &mut mem,
                &mut percept,
                &mut paths,
                &know,
                &learned,
                &mut adapter,
                &mut decide_rng,
                &mut lapse_rng,
            ) {
                Ok(actual) => actual,
                Err(error) => {
                    outcome.failures.push(format!(
                        "{op_label} checked intake/dispatch failed: {error}"
                    ));
                    break;
                }
            };

            compare(&op_label, &expected, &actual, &mut outcome.failures);
            check_channels(
                &op_label,
                op_json,
                &trace,
                Some([decide_rng.draws(), 0, lapse_rng.draws(), knowledge_draws]),
                &mut outcome.failures,
            );
            compare_ordered(
                &format!("{op_label} stats"),
                &sv(&op_json["stats"]),
                &encode_hunt_stats(adapter.stats()),
                &mut outcome.failures,
            );
            let target = adapter.target().map(source_reader::s).unwrap_or(SVal::Null);
            compare_ordered(
                &format!("{op_label} target"),
                &sv(&op_json["target"]),
                &target,
                &mut outcome.failures,
            );
            compare_op_own(
                &op_label,
                op_json,
                encode_hunt_adapter(&adapter),
                &mut outcome.failures,
            );
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// Strategy suite replay (primary and the additive module-goal-key supplement)

struct TraceEvidence {
    case: String,
    operation: usize,
    expected_callbacks: SVal,
    actual_callbacks: SVal,
    expected_own: SVal,
    actual_own: SVal,
    expected_draw_counts: SVal,
    actual_draw_counts: SVal,
    expected_result: SVal,
    actual_result: SVal,
}

impl Default for TraceEvidence {
    fn default() -> Self {
        Self {
            case: String::new(),
            operation: 0,
            expected_callbacks: SVal::Undefined,
            actual_callbacks: SVal::Undefined,
            expected_own: SVal::Undefined,
            actual_own: SVal::Undefined,
            expected_draw_counts: SVal::Undefined,
            actual_draw_counts: SVal::Undefined,
            expected_result: SVal::Undefined,
            actual_result: SVal::Undefined,
        }
    }
}

fn fill_evidence(
    evidence: Option<&mut TraceEvidence>,
    label: &str,
    op_json: &Value,
    trace: &TraceHandle,
    own: &SVal,
    draw_counts: [usize; 4],
    actual_result: &SVal,
) {
    let Some(evidence) = evidence else {
        return;
    };
    if !evidence.case.is_empty() || !label.contains(" op") {
        return;
    }
    let actual_callbacks = trace.lock().expect("trace lock poisoned").encoded();
    if matches!(&actual_callbacks, SVal::Arr(values) if values.is_empty()) {
        return;
    }
    let [decide, motor, lapse, knowledge] = draw_counts;
    evidence.case = label.to_string();
    evidence.operation = 0;
    evidence.expected_callbacks = sv(&op_json["callbacks"]);
    evidence.actual_callbacks = actual_callbacks;
    evidence.expected_own = sv(&op_json["own"]);
    evidence.actual_own = own.clone();
    evidence.expected_draw_counts = sv(&op_json["drawCounts"]);
    evidence.actual_draw_counts = obj(vec![
        ("decide", num_sv(decide as f64)),
        ("motor", num_sv(motor as f64)),
        ("lapse", num_sv(lapse as f64)),
        ("knowledge", num_sv(knowledge as f64)),
    ]);
    evidence.expected_result = sv(&op_json["result"]);
    evidence.actual_result = actual_result.clone();
}

fn modules_for(
    cfg: &SourceConfig,
    env: Option<&SVal>,
    trace: &TraceHandle,
    op_index: usize,
) -> Vec<Box<dyn super::types::FeatureModule>> {
    let overrides: Vec<(String, Vec<GoalDecision>)> = env
        .and_then(|env| env.optional("moduleGoals"))
        .and_then(|goals| match goals {
            SVal::Obj(entries) => Some(
                entries
                    .iter()
                    .map(|(id, goals)| {
                        let parsed = match goals {
                            SVal::Arr(values) => values
                                .iter()
                                .map(|g| must(parse_goal_decision(g), "moduleGoals entry"))
                                .collect::<Vec<_>>(),
                            other => panic!("moduleGoals.{id}: expected array, got {other:?}"),
                        };
                        (id.clone(), parsed)
                    })
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .unwrap_or_default();
    cfg.modules
        .iter()
        .map(|module| {
            let goals = overrides
                .iter()
                .find(|(id, _)| id == &module.id)
                .map(|(_, goals)| goals.clone())
                .or_else(|| module.goals.clone());
            Box::new(RecordedModule {
                id: module.id.clone(),
                enabled: module.enabled,
                feature: module.feature.clone(),
                goals,
                after: module.after,
                hp_below: module.hp_below,
                op_index,
                trace: trace.clone(),
            }) as Box<dyn super::types::FeatureModule>
        })
        .collect()
}

fn parse_status(v: &SVal) -> R<GoalStatus> {
    strict_keys(v, &["state", "why"], "GoalStatus")?;
    let state = match text(v, "state")?.as_str() {
        "running" => super::types::GoalState::Running,
        "done" => super::types::GoalState::Done,
        "failed" => super::types::GoalState::Failed,
        "blocked" => super::types::GoalState::Blocked,
        other => return Err(format!("GoalStatus.state: unknown source status {other}")),
    };
    Ok(GoalStatus {
        state,
        why: text(v, "why")?,
    })
}

fn replay_strategy_cases(
    cases: &[Value],
    maps: &Value,
    _label: &str,
    supplement: bool,
    injection: Option<&Injection>,
    mut evidence: Option<&mut TraceEvidence>,
) -> ReplayOutcome {
    let mut outcome = ReplayOutcome::default();
    for case_json in cases {
        if case_json["suite"] != "strategy" {
            continue;
        }
        outcome.cases += 1;
        let cfg = case_cfg(case_json, maps);
        let case_label = case_id(case_json);
        let trace = TraceLog::new_handle();
        let (knowledge, knowledge_draws, _setup) =
            knowledge_setup(&cfg, case_json, &case_label, &mut outcome.failures);
        let mut mem = create_memory(&cfg);
        let mut percept: Option<StrategyPercept> = None;
        let mut paths = PathHarness::new(&cfg, &trace);
        let attacking = options_attacking(cfg.attacking, &trace);
        let mut strategy = Strategy::new(StrategyOptions {
            attacking,
            log: Some(options_log(&trace)),
        });
        let know = RecordedKnowledge {
            inner: &knowledge,
            trace: trace.clone(),
        };
        let learned = RecordedLearned {
            enabled: cfg.learned.enabled,
            entries: &cfg.learned.entries,
            trace: trace.clone(),
        };
        let mut decide_rng = TraceRng::new(cfg.seed, cfg.random_decide.clone(), "decide", &trace);
        let mut lapse_rng = TraceRng::new(cfg.seed + 2, cfg.random_lapse.clone(), "lapse", &trace);
        let mut last_goal = Goal::Idle;
        compare_initial_memory(&case_label, case_json, &mem, &mut outcome.failures);
        compare_initial_own(
            &case_label,
            case_json,
            encode_strategy_own(&strategy),
            &mut outcome.failures,
        );
        let initial_getters = strategy_getters(&strategy);
        for (name, actual) in encode_strategy_getters(&initial_getters) {
            compare_ordered(
                &format!("{case_label} initial.{name}"),
                &sv(&case_json["initial"][name]),
                &actual,
                &mut outcome.failures,
            );
        }
        for (index, op_json) in operations(case_json).iter().enumerate() {
            let op_label = format!("{case_label} op{index}");
            if let Some(injection) = injection {
                if injection.matches(&case_label, index) {
                    let mutated = injection.apply(op_json);
                    let draws = [decide_rng.draws(), 0, lapse_rng.draws(), knowledge_draws];
                    let before =
                        non_advance_snapshot(&mem, encode_strategy_own(&strategy), draws, &trace);
                    let result = execute_strategy_op(
                        &cfg,
                        case_json,
                        &mutated,
                        maps,
                        supplement,
                        &trace,
                        &mut mem,
                        &mut percept,
                        &mut paths,
                        &know,
                        &learned,
                        &mut strategy,
                        &mut decide_rng,
                        &mut lapse_rng,
                        &mut last_goal,
                        index,
                    )
                    .map(|step| step.actual);
                    let after =
                        non_advance_snapshot(&mem, encode_strategy_own(&strategy), draws, &trace);
                    record_intake_result(
                        injection,
                        "strategy",
                        result,
                        &before,
                        &after,
                        &mut outcome.failures,
                    );
                    outcome.non_advance += 1;
                    break;
                }
            }
            let op = sv(op_json);
            let method = text(&op, "method").expect("strategy method");
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let (actual, previous_guard_mismatch) = match execute_strategy_op(
                &cfg,
                case_json,
                op_json,
                maps,
                supplement,
                &trace,
                &mut mem,
                &mut percept,
                &mut paths,
                &know,
                &learned,
                &mut strategy,
                &mut decide_rng,
                &mut lapse_rng,
                &mut last_goal,
                index,
            ) {
                Ok(step) => (step.actual, step.previous_guard_mismatch),
                Err(error) => {
                    outcome.failures.push(format!(
                        "{op_label} checked intake/dispatch failed: {error}"
                    ));
                    break;
                }
            };
            if previous_guard_mismatch {
                outcome.failures.push(format!(
                    "{op_label}: $previous guard differs from the native prior goal"
                ));
            }
            if method == "decide" {
                if let Some(expected_identity) = op.optional("identity") {
                    let actual_identity = obj(vec![(
                        "returnedCurrentGoal",
                        bool_sv(strategy.last_returned_current()),
                    )]);
                    compare(
                        &format!("{op_label} identity"),
                        expected_identity,
                        &actual_identity,
                        &mut outcome.failures,
                    );
                }
            }

            let draw_counts = [decide_rng.draws(), 0, lapse_rng.draws(), knowledge_draws];
            if method == "decide" {
                compare_goal_ordered(&op_label, &expected, &actual, &mut outcome.failures);
            } else {
                compare(&op_label, &expected, &actual, &mut outcome.failures);
            }
            let own = encode_strategy_own(&strategy);
            fill_evidence(
                evidence.as_deref_mut(),
                &op_label,
                op_json,
                &trace,
                &own,
                draw_counts,
                &actual,
            );
            check_channels(
                &op_label,
                op_json,
                &trace,
                Some(draw_counts),
                &mut outcome.failures,
            );
            let getters = strategy_getters(&strategy);
            for (name, getter_actual) in encode_strategy_getters(&getters) {
                compare_ordered(
                    &format!("{op_label} {name}"),
                    &sv(&op_json[name]),
                    &getter_actual,
                    &mut outcome.failures,
                );
            }
            compare_op_own(&op_label, op_json, own, &mut outcome.failures);
            compare_op_memory(&op_label, op_json, &mem, &mut outcome.failures);
            outcome.operations += 1;
        }
    }
    outcome
}

// --------------------------------------------------------------------------------------------------------------------
// Declared test entry points

#[test]
fn private_strategy_source_tracker_parity() {
    let source = load_source();
    replay_tracker(&source, None).into_green("tracker", 1, 14);
}

#[test]
fn private_strategy_source_hunter_parity() {
    let source = load_source();
    replay_hunter(&source, None).into_green("hunter", 24, 127);
}

#[test]
fn private_strategy_source_build_route_parity() {
    let source = load_source();
    replay_build_route(&source, None).into_green("route", 17, 36);
}

#[test]
fn private_strategy_source_memory_parity() {
    let source = load_source();
    replay_memory(&source, None).into_green("memory", 12, 122);
}

#[test]
fn private_strategy_source_hunt_adapter_parity() {
    let source = load_source();
    replay_hunt_adapter(&source, None).into_green("adapter", 9, 67);
}

#[test]
fn private_strategy_source_strategy_parity() {
    let source = load_source();
    replay_strategy_cases(
        source_cases(&source),
        &source["maps"],
        "strategy",
        false,
        None,
        None,
    )
    .into_green("strategy", 35, 292);
}

#[test]
fn private_module_goal_key_source_parity() {
    let supplement = load_supplement();
    let primary = load_source();
    assert_eq!(
        supplement["mapReference"]["id"], primary["maps"][0]["id"],
        "supplement map reference binds the frozen primary generated7 map"
    );
    replay_strategy_cases(
        supplement["cases"].as_array().expect("supplement cases"),
        &primary["maps"],
        "supplement",
        true,
        None,
        None,
    )
    .into_green("module-goal-key", 4, 48);
}

// --------------------------------------------------------------------------------------------------------------------
// Frozen corpus envelope: the actual expected suites/cases/operations, not a total that tolerates a skipped suite.

#[test]
fn private_strategy_source_envelope_guard() {
    let source = load_source();
    assert_eq!(
        source["format"], "rh-bot-private-strategy-source/1",
        "source format"
    );
    assert_eq!(
        source["methodValue"], "rh-method-value/1",
        "method value format"
    );
    let primary = source_cases(&source);
    assert_eq!(primary.len(), 98, "primary case set");
    let mut counts = std::collections::BTreeMap::new();
    let mut total = 0usize;
    for case_json in primary {
        let suite = case_json["suite"].as_str().expect("suite");
        let count = operations(case_json).len();
        *counts.entry(suite.to_string()).or_insert(0usize) += count;
        total += count;
    }
    assert_eq!(counts.get("memory-api"), Some(&122));
    assert_eq!(counts.get("strategy"), Some(&292));
    assert_eq!(counts.get("mob-tracker"), Some(&14));
    assert_eq!(counts.get("mob-hunter"), Some(&127));
    assert_eq!(counts.get("hunt-adapter"), Some(&67));
    assert_eq!(counts.get("build-route"), Some(&36));
    assert_eq!(total, 658);
    for case_json in primary {
        match case_json["suite"].as_str().expect("suite") {
            "strategy" | "hunt-adapter" => {
                let setup = sv(&case_json["setupTranscript"]);
                match setup {
                    SVal::Arr(values) => assert_eq!(values.len(), 70, "knowledge setup draws"),
                    other => panic!("setupTranscript must be an array, got {other:?}"),
                }
            }
            "memory-api" | "mob-tracker" | "mob-hunter" | "build-route" => {
                assert_no_setup(case_json, case_json["id"].as_str().expect("case id"));
            }
            other => panic!("unknown suite {other}"),
        }
    }
    let supplement: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../parity/policy/bot-module-goal-key/source.json"),
        )
        .expect("supplement"),
    )
    .expect("valid supplement JSON");
    assert_eq!(supplement["cases"].as_array().unwrap().len(), 4);
    let supplement_ops: usize = supplement["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case_json| operations(case_json).len())
        .sum();
    assert_eq!(supplement_ops, 48);
}

// --------------------------------------------------------------------------------------------------------------------
// Synthetic in-memory negative controls. These perturb one actual recorded channel of a real replay (never the corpus),
// keep the decision unchanged and must fail for the intended channel only.

fn callback_channel_values(expected: &SVal, actual: &SVal) -> (usize, usize) {
    let expected_len = match expected {
        SVal::Arr(values) => values.len(),
        _ => usize::MAX,
    };
    let actual_len = match actual {
        SVal::Arr(values) => values.len(),
        _ => usize::MAX,
    };
    (expected_len, actual_len)
}

fn negative_callback_remove(evidence: &TraceEvidence) -> Vec<String> {
    let mut mutated = evidence.actual_callbacks.clone();
    if let SVal::Arr(values) = &mut mutated {
        assert!(!values.is_empty(), "negative needs a recorded callback");
        values.remove(0);
    }
    let mut failures = Vec::new();
    super::source_trace::compare_callback_values(
        "negative remove callback",
        &evidence.expected_callbacks,
        &mutated,
        &mut failures,
    );
    failures
}

fn negative_callback_reorder(evidence: &TraceEvidence) -> Vec<String> {
    let mut mutated = evidence.actual_callbacks.clone();
    if let SVal::Arr(values) = &mut mutated {
        assert!(values.len() >= 2, "negative needs two recorded callbacks");
        values.swap(0, 1);
    }
    let mut failures = Vec::new();
    super::source_trace::compare_callback_values(
        "negative reorder callback",
        &evidence.expected_callbacks,
        &mutated,
        &mut failures,
    );
    failures
}

fn negative_draw_count(evidence: &TraceEvidence) -> Vec<String> {
    let mut mutated = evidence.actual_draw_counts.clone();
    if let SVal::Obj(entries) = &mut mutated {
        let (_, decide) = entries
            .iter_mut()
            .find(|(key, _)| key == "decide")
            .expect("decide draw count");
        if let SVal::Num(value) = decide {
            assert!(*value >= 1., "negative needs a decide draw");
            *value -= 1.;
        }
    }
    let mut failures = Vec::new();
    super::source_trace::compare_draw_count_values(
        "negative draw count",
        &evidence.expected_draw_counts,
        &mutated,
        &mut failures,
    );
    failures
}

fn corrupt_retained_field(value: &SVal) -> Option<SVal> {
    match value {
        SVal::Instance { name, entries } => {
            for (key, field) in entries {
                if matches!(
                    key.as_str(),
                    "judged" | "excluded" | "lootSkip" | "banned" | "contested" | "zoneAvoid"
                ) {
                    if let SVal::Map(map_entries) = field {
                        if let Some((entry_key, entry_value)) = map_entries.first() {
                            let mut map = map_entries.clone();
                            let corrupted = match entry_value {
                                SVal::Obj(fields) => {
                                    let mut fields = fields.clone();
                                    let mut found = false;
                                    for (field_key, field_value) in fields.iter_mut() {
                                        if matches!(field_key.as_str(), "until" | "z") {
                                            if let SVal::Num(number) = field_value {
                                                *number += 1.;
                                                found = true;
                                            }
                                        }
                                    }
                                    assert!(found, "negative needs an expiry field");
                                    SVal::Obj(fields)
                                }
                                SVal::Num(number) => SVal::Num(*number + 1.),
                                other => other.clone(),
                            };
                            map[0] = (entry_key.clone(), corrupted);
                            return Some(SVal::Instance {
                                name: name.clone(),
                                entries: entries
                                    .iter()
                                    .map(|(k, v)| {
                                        if k == key {
                                            (k.clone(), SVal::Map(map.clone()))
                                        } else {
                                            (k.clone(), v.clone())
                                        }
                                    })
                                    .collect(),
                            });
                        }
                    }
                }
                if let Some(corrupted) = corrupt_retained_field(field) {
                    return Some(SVal::Instance {
                        name: name.clone(),
                        entries: entries
                            .iter()
                            .map(|(k, v)| {
                                if k == key {
                                    (k.clone(), corrupted.clone())
                                } else {
                                    (k.clone(), v.clone())
                                }
                            })
                            .collect(),
                    });
                }
            }
            None
        }
        SVal::Obj(entries) => {
            for (key, field) in entries {
                if let Some(corrupted) = corrupt_retained_field(field) {
                    return Some(SVal::Obj(
                        entries
                            .iter()
                            .map(|(k, v)| {
                                if k == key {
                                    (k.clone(), corrupted.clone())
                                } else {
                                    (k.clone(), v.clone())
                                }
                            })
                            .collect(),
                    ));
                }
            }
            None
        }
        _ => None,
    }
}

fn negative_own_corruption(evidence: &TraceEvidence) -> Vec<String> {
    let mutated = corrupt_retained_field(&evidence.actual_own)
        .expect("a reached retained map/diagnostic must be corruptible");
    let mut failures = Vec::new();
    if !super::source_trace::own_same(&evidence.expected_own, &mutated) {
        failures.push("negative own corruption: retained own diagnostic differs".into());
    }
    assert_eq!(
        failures.len(),
        1,
        "own corruption negative must disagree with the frozen own diagnostics once: {failures:?}"
    );
    failures
}

#[test]
fn private_strategy_source_trace_negatives() {
    let source = load_source();
    let mut evidence = TraceEvidence::default();
    let baseline = replay_strategy_cases(
        source_cases(&source),
        &source["maps"],
        "strategy",
        false,
        None,
        Some(&mut evidence),
    );
    assert!(
        baseline.failures.is_empty(),
        "the negative controls need a clean baseline replay: {:?}",
        baseline.failures.first()
    );
    assert!(
        !evidence.case.is_empty(),
        "the negative controls need a recorded non-empty transcript"
    );
    let (expected_len, actual_len) =
        callback_channel_values(&evidence.expected_callbacks, &evidence.actual_callbacks);
    assert_eq!(expected_len, actual_len);
    assert!(actual_len >= 2, "need at least two ordered callback events");

    let removed = negative_callback_remove(&evidence);
    assert_eq!(removed.len(), 1, "remove-callback negative must fail once");
    assert!(
        removed[0].contains("callbacks"),
        "remove-callback negative failed on the intended channel: {removed:?}"
    );
    let reordered = negative_callback_reorder(&evidence);
    assert_eq!(
        reordered.len(),
        1,
        "reorder-callback negative must fail once"
    );
    assert!(
        reordered[0].contains("callbacks"),
        "reorder-callback negative failed on the intended channel: {reordered:?}"
    );
    let draws = negative_draw_count(&evidence);
    assert_eq!(draws.len(), 1, "draw-count negative must fail once");
    assert!(
        draws[0].contains("drawCounts"),
        "draw-count negative failed on the intended channel: {draws:?}"
    );
    let own = negative_own_corruption(&evidence);
    assert_eq!(own.len(), 1, "own-corruption negative must fail once");
    assert!(
        own[0].contains("initial.own") || own[0].contains(" own"),
        "own-corruption negative failed on the intended channel: {own:?}"
    );
    // The perturbed own-state/callback channels do not change the decision itself: the exact decision comparison stays
    // green against the same recorded actual result.
    let mut decision_failures = Vec::new();
    super::source_trace::compare_goal_ordered(
        "negative decision unchanged",
        &evidence.expected_result,
        &evidence.actual_result,
        &mut decision_failures,
    );
    assert!(
        decision_failures.is_empty(),
        "the synthetic negatives changed the decision channel"
    );
    // Raw Module.data ordering/value controls: the goal-aware ordered comparator must distinguish a reversed property
    // order and a changed nested raw value even though generic schema-record equality would normalize them away.
    let ordered_module = sv(&serde_json::json!({
        "goal": {"kind": "module", "module": "m", "data": {"$": "object", "entries": [["a", 1], ["b", {"$": "array", "values": [1, 2]}]]}},
        "utility": 1.0,
        "why": "module row"
    }));
    let reversed_module = sv(&serde_json::json!({
        "goal": {"kind": "module", "module": "m", "data": {"$": "object", "entries": [["b", {"$": "array", "values": [1, 2]}], ["a", 1]]}},
        "utility": 1.0,
        "why": "module row"
    }));
    let changed_module = sv(&serde_json::json!({
        "goal": {"kind": "module", "module": "m", "data": {"$": "object", "entries": [["a", 3], ["b", {"$": "array", "values": [1, 2]}]]}},
        "utility": 1.0,
        "why": "module row"
    }));
    for (label, mutated) in [
        ("reversed raw Module.data order", &reversed_module),
        ("changed nested raw Module.data value", &changed_module),
    ] {
        let mut failures = Vec::new();
        super::source_trace::compare_goal_ordered(
            &format!("negative {label}"),
            &ordered_module,
            mutated,
            &mut failures,
        );
        assert_eq!(
            failures.len(),
            1,
            "{label} must fail the ordered goal comparison"
        );
        eprintln!("TRACE_NEGATIVE {label}: detected");
    }
    // Judged-z tolerance ancestry controls: the approved Gaussian leaf passes only through the real
    // StrategyImpl.judged retention path; a same-shaped raw Module.data Map {until,z} with the SAME tiny delta must stay
    // exact, and a delta outside the reviewed bound must fail even in judged.
    let synthetic_own = |judged_z: f64, module_z: f64| -> SVal {
        SVal::Instance {
            name: "StrategyImpl".into(),
            entries: vec![
                (
                    "judged".into(),
                    source_reader::map(vec![(
                        source_reader::s("foe"),
                        obj(vec![("until", num_sv(1.0)), ("z", num_sv(judged_z))]),
                    )]),
                ),
                (
                    "last".into(),
                    source_reader::arr(vec![obj(vec![
                        (
                            "goal",
                            obj(vec![
                                ("kind", source_reader::s("module")),
                                ("module", source_reader::s("m")),
                                (
                                    "data",
                                    source_reader::map(vec![
                                        (source_reader::s("until"), num_sv(1.0)),
                                        (source_reader::s("z"), num_sv(module_z)),
                                    ]),
                                ),
                            ]),
                        ),
                        ("utility", num_sv(1.0)),
                        ("why", source_reader::s("module row")),
                    ])]),
                ),
            ],
        }
    };
    let judged_base = synthetic_own(0.5, 0.5);
    let judged_tiny = synthetic_own(0.5 + 5e-10, 0.5);
    let judged_far = synthetic_own(0.5 + 1e-6, 0.5);
    let module_tiny = synthetic_own(0.5, 0.5 + 5e-10);
    assert!(
        super::source_trace::own_same(&judged_base, &judged_tiny),
        "approved genuine judged-z delta must pass through StrategyImpl.judged"
    );
    assert!(
        !super::source_trace::own_same(&judged_base, &judged_far),
        "a judged-z delta outside the reviewed bound must fail"
    );
    assert!(
        !super::source_trace::own_same(&judged_base, &module_tiny),
        "raw Module.data map lookalike must NOT receive the judged-z Gaussian tolerance"
    );
    eprintln!(
        "TRACE_NEGATIVE judged-z tolerance: genuine judged delta passes; raw Module.data lookalike stays exact; out-of-bound judged delta fails"
    );
    eprintln!(
        "TRACE_NEGATIVE evidence {} op{}: {} callback events, own corruption channel {}",
        evidence.case,
        evidence.operation,
        actual_len,
        own[0].split(':').next().unwrap_or("own")
    );
}

// --------------------------------------------------------------------------------------------------------------------
// Labelled native reader/intake controls. Reader controls are synthetic tagged values; envelope controls mutate the loaded
// frozen envelope in memory and restore it; typed controls run the actual replay preflight on mutated operation inputs.
// None of these are source parity rows, and no corpus file is modified.

#[test]
fn private_strategy_source_reader_controls() {
    use super::source_strict::{decode, validate_primary, Mode};
    let mut labels: Vec<&str> = Vec::new();
    let mut rejected = |label: &'static str, value: Value, mode: Mode| {
        assert!(
            decode(&value, label, mode).is_err(),
            "reader control {label} must be rejected"
        );
        labels.push(label);
    };
    rejected(
        "unsupported tag",
        serde_json::json!({"$": "future"}),
        Mode::Diagnostic,
    );
    rejected(
        "extra tag field",
        serde_json::json!({"$": "undefined", "extra": 1}),
        Mode::Diagnostic,
    );
    rejected(
        "missing number tag value",
        serde_json::json!({"$": "number"}),
        Mode::Diagnostic,
    );
    rejected(
        "unknown number tag",
        serde_json::json!({"$": "number", "value": "Infinity"}),
        Mode::Diagnostic,
    );
    rejected(
        "duplicate object key",
        serde_json::json!({"$": "object", "entries": [["x", 1], ["x", 2]]}),
        Mode::Diagnostic,
    );
    rejected(
        "duplicate Map key",
        serde_json::json!({"$": "map", "entries": [["same", 1], ["same", 2]]}),
        Mode::Diagnostic,
    );
    rejected(
        "duplicate signed-zero Map key",
        serde_json::json!({"$": "map", "entries": [[0, 1], [{"$": "number", "value": "-0"}, 2]]}),
        Mode::Diagnostic,
    );
    rejected(
        "duplicate Set value",
        serde_json::json!({"$": "set", "values": ["x", "x"]}),
        Mode::Diagnostic,
    );
    rejected(
        "malformed Map pair",
        serde_json::json!({"$": "map", "entries": [[1]]}),
        Mode::Diagnostic,
    );
    rejected(
        "malformed u8 pair",
        serde_json::json!({"$": "u8", "values": [[1, 2]]}),
        Mode::Diagnostic,
    );
    rejected(
        "u8 range",
        serde_json::json!({"$": "u8", "values": [256]}),
        Mode::Diagnostic,
    );
    rejected(
        "negative u8",
        serde_json::json!({"$": "u8", "values": [-1]}),
        Mode::Diagnostic,
    );
    rejected(
        "untagged array",
        serde_json::json!([1, 2]),
        Mode::Diagnostic,
    );
    rejected(
        "callable input",
        serde_json::json!({"$": "callable"}),
        Mode::Input,
    );
    rejected(
        "instance input",
        serde_json::json!({"$": "instance", "name": "Fake", "entries": []}),
        Mode::Input,
    );
    rejected(
        "array hole",
        serde_json::json!({"$": "hole"}),
        Mode::Diagnostic,
    );
    // The legitimate tagged sentinels remain accepted with their exact bits.
    match decode(
        &serde_json::json!({"$": "number", "value": "-0"}),
        "signed zero",
        Mode::Input,
    ) {
        Ok(SVal::Num(value)) if value.to_bits() == (-0f64).to_bits() => {}
        other => panic!("signed zero control failed: {other:?}"),
    }
    assert!(matches!(
        decode(
            &serde_json::json!({"$": "number", "value": "NaN"}),
            "NaN",
            Mode::Input
        ),
        Ok(SVal::Num(value)) if value.is_nan()
    ));
    assert!(matches!(
        decode(
            &serde_json::json!({"$": "undefined"}),
            "undefined",
            Mode::Input
        ),
        Ok(SVal::Undefined)
    ));
    assert!(matches!(
        decode(&Value::Null, "null", Mode::Input),
        Ok(SVal::Null)
    ));

    // Envelope controls on the actual frozen corpus: each control mutates one in-memory copy.
    let source = load_source();
    let mutate_and_reject =
        |mutate: &dyn Fn(&mut Value), label: &'static str, labels: &mut Vec<&'static str>| {
            let mut mutated = source.clone();
            mutate(&mut mutated);
            assert!(
                validate_primary(&mutated).is_err(),
                "envelope control {label} must be rejected"
            );
            labels.push(label);
        };
    mutate_and_reject(
        &|source| source["format"] = Value::String("future".into()),
        "wrong format",
        &mut labels,
    );
    mutate_and_reject(
        &|source| source["methodValue"] = Value::String("future".into()),
        "wrong method value format",
        &mut labels,
    );
    mutate_and_reject(
        &|source| {
            let cases = source["cases"].as_array_mut().expect("cases");
            cases[1]["id"] = cases[0]["id"].clone();
        },
        "duplicate case id",
        &mut labels,
    );
    mutate_and_reject(
        &|source| source["cases"][0]["suite"] = Value::String("future".into()),
        "unsupported suite",
        &mut labels,
    );
    mutate_and_reject(
        &|source| {
            let cases = source["cases"].as_array_mut().expect("cases");
            let strategy = cases
                .iter_mut()
                .find(|case| case["suite"] == "strategy")
                .expect("strategy case");
            let decide = strategy["operations"]
                .as_array_mut()
                .expect("ops")
                .iter_mut()
                .find(|op| op["method"] == "decide")
                .expect("decide op");
            decide["method"] = Value::String("trackerObserve".into());
        },
        "wrong suite/method",
        &mut labels,
    );
    mutate_and_reject(
        &|source| {
            let cases = source["cases"].as_array_mut().expect("cases");
            cases
                .iter_mut()
                .filter(|case| case["suite"] == "mob-hunter")
                .for_each(|case| case["suite"] = Value::String("hunt-adapter".into()));
        },
        "empty/skipped suite",
        &mut labels,
    );
    mutate_and_reject(
        &|source| source["cases"].as_array_mut().expect("cases").clear(),
        "empty case set",
        &mut labels,
    );
    mutate_and_reject(
        &|source| {
            let cases = source["cases"].as_array_mut().expect("cases");
            let strategy = cases
                .iter_mut()
                .find(|case| case["suite"] == "strategy")
                .expect("strategy case");
            let decide = strategy["operations"]
                .as_array_mut()
                .expect("ops")
                .iter_mut()
                .find(|op| op["method"] == "decide")
                .expect("decide op");
            decide["identity"] = serde_json::json!({"returnedCurrentGoal": "yes"});
        },
        "malformed identity row",
        &mut labels,
    );
    mutate_and_reject(
        &|source| {
            let cases = source["cases"].as_array_mut().expect("cases");
            let strategy = cases
                .iter_mut()
                .find(|case| case["suite"] == "strategy")
                .expect("strategy case");
            let decide = strategy["operations"]
                .as_array_mut()
                .expect("ops")
                .iter_mut()
                .find(|op| op["method"] == "decide")
                .expect("decide op");
            decide["drawCounts"] =
                serde_json::json!({"decide": -1, "motor": 0, "lapse": 0, "knowledge": 70});
        },
        "malformed draw counts",
        &mut labels,
    );
    validate_primary(&source).expect("frozen source must validate after controls");

    // Typed/preflight controls on actual operation inputs (mutated copies only).
    let source = load_source();
    let cases = source_cases(&source);
    let maps = &source["maps"];
    let typed = |mut op: Value, mutation: &dyn Fn(&mut Value), label: &'static str| {
        mutation(&mut op);
        let cfg_case = cases
            .iter()
            .find(|case| case["id"].as_str() == Some("strategy-matrix-easy-farmer"))
            .expect("matrix case");
        let cfg = case_cfg(cfg_case, maps);
        let error = preflight_operation(cfg_case, &op, "strategy", false, &cfg, maps);
        assert!(error.is_err(), "typed intake control {label} must reject");
        error.expect_err("checked").to_string()
    };
    let strategy_case = cases
        .iter()
        .find(|case| case["id"].as_str() == Some("strategy-matrix-easy-farmer"))
        .expect("matrix case");
    let ops = operations(strategy_case);
    let observe_index = ops
        .iter()
        .position(|op| op["method"] == "observe")
        .expect("observe op");
    let decide_index = ops
        .iter()
        .position(|op| op["method"] == "decide")
        .expect("decide op");
    let mutate_self_entry = |op: &mut Value, key: &str, value: Value| {
        let self_value = tagged_entry_mut(&mut op["input"], "self").expect("self");
        let entry = tagged_entry_mut(self_value, key).expect("self entry");
        *entry = value;
    };
    let _ = typed(
        ops[observe_index].clone(),
        &|op| {
            mutate_self_entry(
                op,
                "weapons",
                serde_json::json!({"$": "array", "values": ["laser", null]}),
            )
        },
        "unknown weapon",
    );
    labels.push("wrong/unknown weapon");
    let _ = typed(
        ops[observe_index].clone(),
        &|op| mutate_self_entry(op, "slot", serde_json::json!(2)),
        "slot range",
    );
    labels.push("wrong slot");
    let _ = typed(
        ops[observe_index].clone(),
        &|op| {
            mutate_self_entry(
                op,
                "weapons",
                serde_json::json!({"$": "array", "values": ["sword", null, "bow"]}),
            )
        },
        "weapon array count",
    );
    labels.push("wrong weapon array count");
    let _ = typed(
        ops[observe_index].clone(),
        &|op| mutate_self_entry(op, "faction", Value::String("chaos".into())),
        "unknown faction enum",
    );
    labels.push("unknown enum");
    // A forbidden non-finite declared fact: tracker query `now` as +Infinity (later field of the call).
    let tracker_case = cases
        .iter()
        .find(|case| case["suite"] == "mob-tracker")
        .expect("tracker case");
    let tracker_ops = operations(tracker_case);
    let query_index = tracker_ops
        .iter()
        .position(|op| op["method"] == "trackerQuery")
        .expect("tracker query");
    let tracker_cfg = case_cfg(tracker_case, maps);
    let mut query = tracker_ops[query_index].clone();
    *tagged_entry_mut(&mut query["input"], "now").expect("now") =
        serde_json::json!({"$": "number", "value": "+Infinity"});
    assert!(
        preflight_operation(
            tracker_case,
            &query,
            "mob-tracker",
            false,
            &tracker_cfg,
            maps
        )
        .is_err(),
        "non-finite declared fact must be rejected"
    );
    labels.push("nonfinite forbidden declared fact");
    let mut query = tracker_ops[query_index].clone();
    query["input"]
        .get_mut("entries")
        .and_then(Value::as_array_mut)
        .expect("entries")
        .retain(|pair| pair.get(0).and_then(Value::as_str) != Some("awakeMoved"));
    assert!(
        preflight_operation(
            tracker_case,
            &query,
            "mob-tracker",
            false,
            &tracker_cfg,
            maps
        )
        .is_err(),
        "missing consumed field must be rejected"
    );
    labels.push("missing consumed field");
    // Declaration-consistency controls: a consumed-input mutation with a stale declaration is rejected by the envelope
    // guard; the same malformed field with a consistently updated declaration reaches the intended semantic validator.
    let mut stale = ops[observe_index].clone();
    {
        let self_value = tagged_entry_mut(&mut stale["input"], "self").expect("self");
        let weapons = tagged_entry_mut(self_value, "weapons").expect("weapons");
        let values = tagged_values_mut(weapons).expect("weapon tuple");
        values[0] = Value::String("laser".into());
    }
    let cfg = case_cfg(strategy_case, maps);
    let mismatch_error = preflight_operation(strategy_case, &stale, "strategy", false, &cfg, maps)
        .expect_err("stale declaration must be rejected");
    assert!(
        mismatch_error.contains("declaration.input differs from the operation input"),
        "declaration-mismatch control failed on the wrong branch: {mismatch_error}"
    );
    labels.push("declaration/input mismatch");
    let mut consistent = stale.clone();
    sync_declaration_input(&mut consistent);
    let semantic_error =
        preflight_operation(strategy_case, &consistent, "strategy", false, &cfg, maps)
            .expect_err("consistent malformed weapon must be rejected");
    assert!(
        semantic_error.contains("self.weapons[0]: unknown weapon laser"),
        "consistent declaration control did not reach the semantic weapon validator: {semantic_error}"
    );
    assert!(
        !semantic_error.contains("declaration.input differs"),
        "consistent declaration control was still caught by the envelope guard"
    );
    labels.push("consistent declaration reaches semantic weapon validator");
    // The real decide row still preflights cleanly (positive control).
    assert!(
        preflight_operation(
            strategy_case,
            &ops[decide_index],
            "strategy",
            false,
            &cfg,
            maps
        )
        .is_ok(),
        "the frozen decide row must preflight cleanly"
    );
    eprintln!(
        "READER_CONTROL rejected={} labels={:?}",
        labels.len(),
        labels
    );
}

#[test]
fn private_strategy_source_intake_non_advance() {
    let source = load_source();
    let cases = source_cases(&source);

    // (suite label, replay invocation, target method, injection kind used on the reached history)
    let strategy_decide = first_injectable(cases, "strategy", "decide").expect("strategy decide");
    let outcome = replay_strategy_cases(
        source_cases(&source),
        &source["maps"],
        "strategy",
        false,
        Some(&Injection {
            case: strategy_decide.0.clone(),
            op_index: strategy_decide.1,
            kind: InjectionKind::StrategyDecideStatus,
        }),
        None,
    );
    assert!(
        outcome.failures.is_empty(),
        "strategy decide injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "strategy decide non-advance");

    let strategy_observe =
        first_injectable(cases, "strategy", "observe").expect("strategy observe");
    let outcome = replay_strategy_cases(
        source_cases(&source),
        &source["maps"],
        "strategy",
        false,
        Some(&Injection {
            case: strategy_observe.0.clone(),
            op_index: strategy_observe.1,
            kind: InjectionKind::StrategyObserveWeapon,
        }),
        None,
    );
    assert!(
        outcome.failures.is_empty(),
        "strategy observe injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "strategy observe non-advance");

    let hunter = first_injectable(cases, "mob-hunter", "hunterDecide").expect("hunter decide");
    let outcome = replay_hunter(
        &source,
        Some(&Injection {
            case: hunter.0,
            op_index: hunter.1,
            kind: InjectionKind::HunterWalk,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "hunter injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "hunter non-advance");

    let hunter_mobs = first_injectable(cases, "mob-hunter", "hunterDecide").expect("hunter mobs");
    let outcome = replay_hunter(
        &source,
        Some(&Injection {
            case: hunter_mobs.0,
            op_index: hunter_mobs.1,
            kind: InjectionKind::HunterMobs,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "hunter mob-entry injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "hunter mob-entry non-advance");

    let route = first_injectable(cases, "build-route", "routeUpdate").expect("route update");
    let outcome = replay_build_route(
        &source,
        Some(&Injection {
            case: route.0,
            op_index: route.1,
            kind: InjectionKind::RouteCanFarm,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "route injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "route non-advance");

    let memory = first_injectable(cases, "memory-api", "noteSent").expect("memory noteSent");
    let outcome = replay_memory(
        &source,
        Some(&Injection {
            case: memory.0,
            op_index: memory.1,
            kind: InjectionKind::MemoryNoteSentCommand,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "memory injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "memory non-advance");

    let tracker_mobs =
        first_injectable(cases, "mob-tracker", "trackerObserve").expect("tracker observe");
    let outcome = replay_tracker(
        &source,
        Some(&Injection {
            case: tracker_mobs.0,
            op_index: tracker_mobs.1,
            kind: InjectionKind::TrackerMobs,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "tracker mob-entry injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "tracker mob-entry non-advance");

    let adapter = first_injectable(cases, "hunt-adapter", "observe").expect("adapter observe");
    let outcome = replay_hunt_adapter(
        &source,
        Some(&Injection {
            case: adapter.0,
            op_index: adapter.1,
            kind: InjectionKind::StrategyObserveWeapon,
        }),
    );
    assert!(
        outcome.failures.is_empty(),
        "adapter injection failures: {:?}",
        &outcome.failures[..outcome.failures.len().min(2)]
    );
    assert_eq!(outcome.non_advance, 1, "adapter non-advance");
    eprintln!(
        "INTAKE_NON_ADVANCE memory/strategy+adapter+tracker+hunter+route: 8 semantic-intent rejections at the actual entrypoint advanced nothing"
    );
}
