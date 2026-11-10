//! Frozen actual-source parity for the private strategy closure. The corpus is a declared method witness: raw source
//! inputs drive the real admitted Memory and the real native classes; captured Memory/candidates/callbacks are only
//! comparisons. This file is test-only and never installs expected outcomes into native inputs.

use serde_json::Value;

use super::build_route::BuildRoute;
use super::engine::{Strategy, StrategyOptions};
use super::hunt_adapter::HuntAdapter;
use super::mob_hunt::{HuntInput, HuntMobLike, HuntSelf, MobHunter, MobTracker};
use super::source_reader::{self, SVal, R};
use super::types::{
    CampDef, ColiseumDef, Goal, GoalDecision, GoalStatus, RouteCamp, StrategyConfig,
    StrategyContext, StrategyMap, StrategyPercept, StrategySelf, StrategyState,
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
    let id = text(values, "id")?;
    let mut tier = tier_by_name(&id);
    tier.softmax_t = num(values, "softmaxT")?;
    tier.lapse_p = num(values, "lapseP")?;
    tier.knowledge = num(values, "knowledge")?;
    tier.mob_share_noise = num(values, "mobShareNoise")?;
    tier.memory_span_ms = num(values, "memorySpanMs")?;
    tier.wary = num(values, "wary")?;
    let route = field(values, "route")?;
    tier.route.horizon = num(route, "horizon")? as u32;
    tier.route.walk_paths = boolv(route, "walkPaths")?;
    tier.route.reach = num(route, "reach")?;
    let attention = field(values, "attention")?;
    tier.attention.reconsider_ms = num(attention, "reconsiderMs")?;
    let appraisal = field(values, "appraisal")?;
    tier.appraisal.bias = num(appraisal, "bias")?;
    tier.appraisal.lead = num(appraisal, "lead")?;
    tier.appraisal.busy = num(appraisal, "busy")?;
    tier.appraisal.hue = num(appraisal, "hue")?;
    tier.appraisal.noise = num(appraisal, "noise")?;
    let caution = field(values, "caution")?;
    tier.caution.mob_share = num(caution, "mobShare")?;
    tier.caution.elite_share = num(caution, "eliteShare")?;
    tier.caution.start_hp = num(caution, "startHp")?;
    Ok(tier)
}

fn parse_persona(values: &SVal) -> R<PersonaParams> {
    let id = text(values, "id")?;
    let mut persona = persona_by_name(&id);
    persona.pve = num(values, "pve")?;
    persona.pvp = num(values, "pvp")?;
    persona.loot = num(values, "loot")?;
    persona.bounty = num(values, "bounty")?;
    persona.third_party = num(values, "thirdParty")?;
    persona.engage_edge = num(values, "engageEdge")?;
    persona.bounty_caution = num(values, "bountyCaution")?;
    persona.flee_hp = num(values, "fleeHp")?;
    persona.reengage_hp = num(values, "reengageHp")?;
    persona.kite = num(values, "kite")?;
    persona.chase_give_up_ms = num(values, "chaseGiveUpMs")?;
    persona.mob_kill_goal = num(values, "mobKillGoal")?;
    persona.player_threat = num(values, "playerThreat")?;
    persona.elite_appetite = num(values, "eliteAppetite")?;
    persona.coliseum = num(values, "coliseum")?;
    persona.risk = num(values, "risk")?;
    Ok(persona)
}

fn parse_features(v: &SVal) -> R<Features> {
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
    for (i, c) in arr(&map, "camps")?.iter().enumerate() {
        camps.push(CampDef {
            id: text(c, "id")?,
            zone: parse_zone(&text(c, "zone")?),
            x: num(c, "x")?,
            y: num(c, "y")?,
            r: num(c, "r")?,
            elite_spot: num(c, "eliteSpot")?,
            spots: arr(c, "spots")?.len() as u32,
        });
        let _ = i;
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
impl PathSpec {
    fn walk(
        &self,
        from: Vec2,
        to: Vec2,
        log: &mut Vec<(String, Vec<SVal>, SVal)>,
    ) -> Option<WalkAnswer> {
        let args = vec![vec2_sv(from), vec2_sv(to)];
        let result = match self {
            Self::Null => SVal::Null,
            Self::CoordinateBlock { min_x, max_x } if to.x >= *min_x && to.x <= *max_x => {
                SVal::Null
            }
            Self::Source => {
                // The source service needs the full GameMap; the two source-path cases use a declared empty path.
                SVal::Null
            }
            Self::CoordinateBlock { .. } => {
                let d = rh_sim::math::hypot(to.x - from.x, to.y - from.y);
                obj(vec![("dist", num_sv(d)), ("exact", bool_sv(true))])
            }
            Self::Open { factor, exact } => {
                let d = rh_sim::math::hypot(to.x - from.x, to.y - from.y) * factor;
                obj(vec![("dist", num_sv(d)), ("exact", bool_sv(*exact))])
            }
        };
        log.push(("paths.walk".into(), args, result.clone()));
        match result {
            SVal::Null => None,
            SVal::Obj(entries) => {
                let dist =
                    entries
                        .iter()
                        .find(|(k, _)| k == "dist")
                        .and_then(|(_, v)| match v {
                            SVal::Num(d) => Some(*d),
                            _ => None,
                        })?;
                let exact =
                    entries
                        .iter()
                        .find(|(k, _)| k == "exact")
                        .and_then(|(_, v)| match v {
                            SVal::Bool(b) => Some(*b),
                            _ => None,
                        })?;
                Some(WalkAnswer { dist, exact })
            }
            _ => None,
        }
    }
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
impl super::types::LearnedBias for LearnedMap {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn bias(&self, key: &str) -> f64 {
        self.entries
            .iter()
            .find(|(k, _)| k == key)
            .map_or(0., |(_, v)| *v)
    }
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
impl super::types::FeatureModule for ModuleSpec {
    fn id(&self) -> &str {
        &self.id
    }
    fn enabled(&self, features: &Features) -> bool {
        self.enabled
            || self.feature.as_ref().is_some_and(|f| match f.as_str() {
                "wishes" => features.wishes,
                "planning" => features.planning,
                "chests" => features.chests,
                "skills" => features.skills,
                "relics" => features.relics,
                "camps" => features.camps,
                "hazards" => features.hazards,
                "fields" => features.fields,
                _ => false,
            })
    }
    fn goals(&self, ctx: &StrategyContext<'_>) -> Vec<GoalDecision> {
        let Some(goals) = &self.goals else {
            return Vec::new();
        };
        goals
            .iter()
            .filter(|_| self.after.is_none_or(|a| ctx.p.now >= a))
            .filter(|_| self.hp_below.is_none_or(|hp| ctx.p.self_.hp < hp))
            .cloned()
            .collect()
    }
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
    let enabled = boolv(v, "enabled")?;
    let entries = arr(v, "entries")?
        .iter()
        .map(|e| {
            let pair = e.arr("learned entry")?;
            let key = pair[0].string("learned key")?.to_string();
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
                .map(|p| Ok(Vec2::new(num(p, "x")?, num(p, "y")?)))
                .collect::<R<Vec<_>>>()?;
            Goal::Flee {
                from,
                until: num(v, "until")?,
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
                to: Vec2::new(num(to, "x")?, num(to, "y")?),
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
                at: Vec2::new(num(at, "x")?, num(at, "y")?),
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
    Ok(GoalDecision {
        goal: parse_goal(field(v, "goal")?)?,
        utility: num(v, "utility")?,
        why: text(v, "why")?,
        choice: opt_text(v, "choice")?,
    })
}

fn parse_modules(v: &SVal) -> R<Vec<ModuleSpec>> {
    v.arr("modules")?
        .iter()
        .map(|m| {
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
                        out.push(parse_goal_decision(g)?);
                        if let Some(when) = g.optional("when") {
                            after = when.opt_num("after", "when")?;
                            hp_below = when.opt_num("hpBelow", "when")?;
                        }
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

fn parse_config(config: &SVal, maps: &Value) -> R<SourceConfig> {
    let tier = parse_tier(field(config, "tierValues")?)?;
    let persona = parse_persona(field(config, "personaValues")?)?;
    let seed = num(config, "seed")? as u32;
    let id = text(config, "id")?;
    let map_name = text(config, "map")?;
    let map = parse_map(maps, &map_name)?;
    let features = parse_features(field(config, "features")?)?;
    let path_value = field(config, "path")?;
    let path = match text(path_value, "kind")?.as_str() {
        "open" => PathSpec::Open {
            factor: num(path_value, "factor")?,
            exact: boolv(path_value, "exact")?,
        },
        "null" => PathSpec::Null,
        "coordinate-block" => PathSpec::CoordinateBlock {
            min_x: num(path_value, "minX")?,
            max_x: num(path_value, "maxX")?,
        },
        "source" => PathSpec::Source,
        other => return Err(format!("unknown path kind {other}")),
    };
    let learned = parse_learned(field(config, "learned")?)?;
    let modules = parse_modules(field(config, "modules")?)?;
    let hunt_config = match config.optional("huntOverrides") {
        Some(v) => {
            let mut cfg = MOB_HUNT;
            for (k, _) in v.obj("huntOverrides")? {
                if k == "focusBudgetMs" {
                    cfg.focus_budget_ms = num(v, k)?;
                }
            }
            cfg
        }
        None => MOB_HUNT,
    };
    let faction = match config.optional("faction") {
        Some(SVal::Str(s)) => parse_zone(s),
        _ => FactionId::Fire,
    };
    let build_draw = config.opt_num("buildDraw", "buildDraw")?.unwrap_or(0.);
    let attacking = config.optional("attacking").and_then(|v| match v {
        SVal::Bool(b) => Some(*b),
        _ => None,
    });
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
        Some(SVal::Obj(entries)) => {
            let read = |name: &str| -> Vec<f64> {
                entries
                    .iter()
                    .find(|(k, _)| k == name)
                    .and_then(|(_, v)| v.arr("random").ok())
                    .map_or_else(Vec::new, |values| {
                        values
                            .iter()
                            .map(|v| match v {
                                SVal::Num(n) => *n,
                                _ => panic!("random override must be a number"),
                            })
                            .collect()
                    })
            };
            (read("decide"), read("lapse"))
        }
        _ => (Vec::new(), Vec::new()),
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
    serde_json::from_str(&text).expect("source.json is valid JSON")
}

fn source_cases(source: &Value) -> &[Value] {
    source["cases"].as_array().expect("cases array")
}

/// Corpus envelope values are raw JSON wrappers whose payload leaves are tagged. Convert the wrapper recursively
/// without pretending every intermediate container is one complete tagged method value.
fn sv(value: &Value) -> SVal {
    match value {
        Value::Null => SVal::Null,
        Value::Bool(b) => SVal::Bool(*b),
        Value::Number(n) => SVal::Num(n.as_f64().expect("f64 number")),
        Value::String(s) => SVal::Str(s.clone()),
        Value::Array(a) => SVal::Arr(a.iter().map(sv).collect()),
        Value::Object(m) => match m.get("$").and_then(Value::as_str) {
            None => SVal::Obj(m.iter().map(|(k, v)| (k.clone(), sv(v))).collect()),
            Some("undefined") => SVal::Undefined,
            Some("number") => {
                let raw = m
                    .get("value")
                    .and_then(Value::as_str)
                    .expect("number tag value");
                SVal::Num(match raw {
                    "-0" => -0.0,
                    "NaN" => f64::NAN,
                    "+Infinity" => f64::INFINITY,
                    "-Infinity" => f64::NEG_INFINITY,
                    other => panic!("bad number tag {other}"),
                })
            }
            Some("array") => SVal::Arr(
                m.get("values")
                    .and_then(Value::as_array)
                    .expect("array values")
                    .iter()
                    .map(sv)
                    .collect(),
            ),
            Some("u8") => SVal::U8(
                m.get("values")
                    .and_then(Value::as_array)
                    .expect("u8 values")
                    .iter()
                    .map(|v| v.as_u64().expect("u8") as u8)
                    .collect(),
            ),
            Some("map") => SVal::Map(
                m.get("entries")
                    .and_then(Value::as_array)
                    .expect("map entries")
                    .iter()
                    .map(|e| {
                        let pair = e.as_array().expect("map pair");
                        (sv(&pair[0]), sv(&pair[1]))
                    })
                    .collect(),
            ),
            Some("set") => SVal::Set(
                m.get("values")
                    .and_then(Value::as_array)
                    .expect("set values")
                    .iter()
                    .map(sv)
                    .collect(),
            ),
            Some("object") => SVal::Obj(
                m.get("entries")
                    .and_then(Value::as_array)
                    .expect("object entries")
                    .iter()
                    .map(|e| {
                        let pair = e.as_array().expect("object pair");
                        (
                            pair[0].as_str().expect("object key").to_string(),
                            sv(&pair[1]),
                        )
                    })
                    .collect(),
            ),
            Some("instance") => SVal::Instance {
                name: m
                    .get("name")
                    .and_then(Value::as_str)
                    .expect("instance name")
                    .to_string(),
                entries: {
                    let raw = m.get("entries").expect("instance entries");
                    match raw {
                        Value::Array(pairs) => pairs
                            .iter()
                            .map(|e| {
                                let pair = e.as_array().expect("instance pair");
                                (
                                    pair[0].as_str().expect("instance key").to_string(),
                                    sv(&pair[1]),
                                )
                            })
                            .collect(),
                        _ => match sv(raw) {
                            SVal::Obj(entries) => entries,
                            other => panic!("instance entries {other:?}"),
                        },
                    }
                },
            },
            Some("callable") => SVal::Callable,
            Some(other) => panic!("unsupported tag {other}"),
        },
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
    let m = &pair[1];
    Ok((
        id,
        HuntMobLike {
            kind: text(m, "kind")?,
            status: text(m, "status")?,
            x: num(m, "x")?,
            y: num(m, "y")?,
            hp: num(m, "hp")?,
            max_hp: num(m, "maxHp")?,
            faction: opt_text(m, "faction")?
                .as_deref()
                .and_then(FactionId::parse),
            faction_text: opt_text(m, "faction")?,
            weapon0: opt_text(m, "weapon0")?.as_deref().and_then(parse_weapon),
            weapon0_text: opt_text(m, "weapon0")?,
            type_: opt_text(m, "type")?,
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
    let weapons_raw = arr(v, "weapons")?;
    let mut weapons = [None, None];
    for (i, w) in weapons_raw.iter().take(2).enumerate() {
        weapons[i] = match w {
            SVal::Null => None,
            SVal::Str(s) => parse_weapon(s),
            _ => return Err("weapons must be string|null".into()),
        };
    }
    Ok(HuntSelf {
        faction: opt_text(v, "faction")?
            .as_deref()
            .and_then(FactionId::parse),
        x: num(v, "x")?,
        y: num(v, "y")?,
        hp: num(v, "hp")?,
        max_hp: num(v, "maxHp")?,
        weapons,
        power: num(v, "power")?,
        mob_kills: num(v, "mobKills")?,
        mob_stats: Vec::new(),
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

fn encode_route_step(step: &super::types::RouteStep) -> SVal {
    obj(vec![
        ("camp", num_sv(f64::from(step.camp))),
        ("arriveAt", num_sv(step.arrive_at)),
        ("startAt", num_sv(step.start_at)),
    ])
}

fn parse_route_camp(v: &SVal) -> R<RouteCamp> {
    Ok(RouteCamp {
        index: num(v, "index")? as u32,
        id: text(v, "id")?,
        zone: parse_zone(&text(v, "zone")?),
        x: num(v, "x")?,
        y: num(v, "y")?,
        r: num(v, "r")?,
        elite: boolv(v, "elite")?,
        spots: num(v, "spots")? as u32,
        mob_type: opt_text(v, "type")?.unwrap_or_default(),
        alive: num(v, "alive")? as u32,
        state: num(v, "state")? as u8,
        respawn_at: num(v, "respawnAt")?,
    })
}

type CanFarm = Box<dyn Fn(&RouteCamp) -> bool>;
fn can_farm_descriptor(v: &SVal) -> R<CanFarm> {
    let kind = text(v, "kind")?;
    Ok(match kind.as_str() {
        "allow" => Box::new(|_| true),
        "indices" => {
            let allow = arr(v, "allow")?
                .iter()
                .map(|n| n.num("index"))
                .collect::<R<Vec<_>>>()?
                .into_iter()
                .map(|n| n as u32)
                .collect::<Vec<_>>();
            Box::new(move |c: &RouteCamp| allow.contains(&c.index))
        }
        "zones" => {
            let allow = arr(v, "allow")?
                .iter()
                .map(|z| Ok(parse_zone(z.string("zone")?)))
                .collect::<R<Vec<_>>>()?;
            Box::new(move |c: &RouteCamp| allow.contains(&c.zone))
        }
        other => return Err(format!("unknown canFarm descriptor {other}")),
    })
}

#[test]
fn private_strategy_source_tracker_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "mob-tracker" {
            continue;
        }
        let config = sv(&case["config"]);
        let _cfg = parse_config(&config, maps).unwrap();
        let mut tracker = MobTracker::default();
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "trackerObserve" => {
                    let now = num(&input, "now").unwrap();
                    let mobs = parse_mob_entries(field(&input, "mobs").unwrap()).unwrap();
                    tracker.observe(&mobs, now);
                    SVal::Undefined
                }
                "trackerQuery" => {
                    let id = text(&input, "id").unwrap();
                    let now = num(&input, "now").unwrap();
                    let from_sv = field(&input, "from").unwrap();
                    let from = Vec2::new(num(from_sv, "x").unwrap(), num(from_sv, "y").unwrap());
                    let radius = num(&input, "radius").unwrap();
                    let awake_moved = num(&input, "awakeMoved").unwrap();
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
                other => panic!("unsupported tracker method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL tracker parity : {}", operations);
    assert!(
        failures.is_empty(),
        "tracker parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn private_strategy_source_hunter_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "mob-hunter" {
            continue;
        }
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut hunter = MobHunter::new(cfg.hunt_config);
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "hunterDecide" => {
                    let now = num(&input, "now").unwrap();
                    let self_view = parse_hunt_self(field(&input, "self").unwrap()).unwrap();
                    let players = arr(&input, "players")
                        .unwrap()
                        .iter()
                        .map(|p| Ok(Vec2::new(num(p, "x").unwrap(), num(p, "y").unwrap())))
                        .collect::<R<Vec<_>>>()
                        .unwrap();
                    let mobs = parse_mob_entries(field(&input, "mobs").unwrap()).unwrap();
                    let descriptor = field(&input, "walk").unwrap();
                    let kind = text(descriptor, "kind").unwrap();
                    let factor = descriptor
                        .opt_num("factor", "factor")
                        .unwrap()
                        .unwrap_or(1.);
                    let min_x = descriptor.opt_num("minX", "minX").unwrap();
                    let max_x = descriptor.opt_num("maxX", "maxX").unwrap();
                    let mut walk = move |m: &HuntMobLike| -> Option<f64> {
                        match kind.as_str() {
                            "null" => None,
                            "coordinate-block"
                                if m.x >= min_x.unwrap_or(f64::NEG_INFINITY)
                                    && m.x <= max_x.unwrap_or(f64::INFINITY) =>
                            {
                                None
                            }
                            _ => Some(
                                rh_sim::math::hypot(m.x - self_view.x, m.y - self_view.y) * factor,
                            ),
                        }
                    };
                    let player_distance = match field(&input, "playerDistance").unwrap() {
                        SVal::Num(n) => *n,
                        other => panic!("playerDistance {other:?}"),
                    };
                    let shot = match field(&input, "shotByPlayerAt").unwrap() {
                        SVal::Num(n) => *n,
                        other => panic!("shot {other:?}"),
                    };
                    let type_weights = input.optional("typeWeights").cloned();
                    let tw = type_weights.as_ref().map(|weights| {
                        let pairs = weights
                            .arr("typeWeights")
                            .unwrap()
                            .iter()
                            .map(|p| {
                                let pair = p.arr("typeWeight pair").unwrap();
                                let key = pair[0].string("typeWeight key").unwrap().to_string();
                                (key, pair[1].num("typeWeight value").unwrap())
                            })
                            .collect::<Vec<_>>();
                        move |ty: Option<&str>| -> f64 {
                            ty.and_then(|t| pairs.iter().find(|(k, _)| k == t).map(|(_, v)| *v))
                                .unwrap_or(0.25)
                        }
                    });
                    let tw_ref = tw.as_ref().map(|f| f as &dyn Fn(Option<&str>) -> f64);
                    let mut input_h = HuntInput {
                        now,
                        self_: &self_view,
                        player_distance,
                        players: &players,
                        in_coliseum: boolv(&input, "inColiseum").unwrap(),
                        mobs: &mobs,
                        walk: &mut walk,
                        attacking: boolv(&input, "attacking").unwrap(),
                        shot_by_player_at: shot,
                        type_weight: tw_ref,
                        elites_ready: None,
                    };
                    encode_decision(&hunter.decide(&mut input_h))
                }
                "isBanned" => {
                    let id = text(&input, "id").unwrap();
                    let now = num(&input, "now").unwrap();
                    source_reader::b(hunter.is_banned(&id, now))
                }
                other => panic!("unsupported hunter method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL hunter parity : {}", operations);
    assert!(
        failures.is_empty(),
        "hunter parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn private_strategy_source_build_route_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "build-route" {
            continue;
        }
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut route = BuildRoute::new(cfg.faction, cfg.build_draw);
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "routeUpdate" | "routePlan" => {
                    let camps = arr(&input, "camps")
                        .unwrap()
                        .iter()
                        .map(|c| parse_route_camp(c).unwrap())
                        .collect::<Vec<_>>();
                    let self_sv = field(&input, "self").unwrap();
                    let self_pos =
                        Vec2::new(num(self_sv, "x").unwrap(), num(self_sv, "y").unwrap());
                    let players = arr(&input, "players")
                        .unwrap()
                        .iter()
                        .map(|p| Ok(Vec2::new(num(p, "x").unwrap(), num(p, "y").unwrap())))
                        .collect::<R<Vec<_>>>()
                        .unwrap();
                    let can_farm = can_farm_descriptor(field(&input, "canFarm").unwrap()).unwrap();
                    let route_input = super::build_route::RouteInput {
                        now: num(&input, "now").unwrap(),
                        run_ms: num(&input, "runMs").unwrap(),
                        self_pos,
                        speed: num(&input, "speed").unwrap(),
                        mob_kills: num(&input, "mobKills").unwrap(),
                        power: num(&input, "power").unwrap(),
                        camps: &camps,
                        players: &players,
                        can_farm: &*can_farm,
                    };
                    if method == "routeUpdate" {
                        route
                            .update(&route_input)
                            .map(|s| encode_route_step(&s))
                            .unwrap_or(SVal::Null)
                    } else {
                        route.plan(&route_input);
                        SVal::Undefined
                    }
                }
                "isContested" => {
                    let camp = num(&input, "camp").unwrap() as u32;
                    let now = num(&input, "now").unwrap();
                    source_reader::b(route.is_contested(camp, now))
                }
                "campValue" => {
                    let camp = parse_route_camp(field(&input, "camp").unwrap()).unwrap();
                    let elites = boolv(&input, "elites").unwrap();
                    num_sv(super::build_route::route_camp_value(
                        route.build,
                        &camp,
                        elites,
                    ))
                }
                other => panic!("unsupported route method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL route parity : {}", operations);
    assert!(
        failures.is_empty(),
        "route parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

// --------------------------------------------------------------------------------------------------------------------
// Admitted Memory API suite

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
            x: num(f, "x")?,
            y: num(f, "y")?,
            facing: num(f, "facing")?,
            status: text(f, "status")?,
            hp_frac: num(f, "hpFrac")?,
            faction: opt_text(f, "faction")?
                .as_deref()
                .and_then(FactionId::parse),
            in_hand: opt_text(f, "inHand")?.and_then(|w| parse_weapon(&w)),
            draw_started_at: num(f, "drawStartedAt")?,
            bounty: num(f, "bounty")?,
            vx: num(f, "vx")?,
            vy: num(f, "vy")?,
        });
    }
    let mut mobs = Vec::new();
    for m in arr(input, "mobs")? {
        mobs.push(PerceptMob {
            id: text(m, "id")?,
            kind: text(m, "kind")?,
            name: opt_text(m, "name")?.unwrap_or_default(),
            type_: opt_text(m, "type")?,
            faction: opt_text(m, "faction")?
                .as_deref()
                .and_then(FactionId::parse),
            x: num(m, "x")?,
            y: num(m, "y")?,
            status: text(m, "status")?,
            hp_frac: num(m, "hpFrac")?,
            in_hand: opt_text(m, "inHand")?.and_then(|w| parse_weapon(&w)),
        });
    }
    let mut containers = Vec::new();
    for c in arr(input, "containers")? {
        containers.push(PerceptContainer {
            id: text(c, "id")?,
            kind: text(c, "kind")?,
            x: num(c, "x")?,
            y: num(c, "y")?,
            closed: boolv(c, "closed")?,
            weapon: parse_percept_weapon(c.optional("weapon").unwrap_or(&SVal::Undefined))?,
        });
    }
    let mut projectiles = Vec::new();
    for p in arr(input, "projectiles")? {
        projectiles.push(PerceptProjectile {
            id: text(p, "id")?,
            kind: text(p, "kind")?,
            x: num(p, "x")?,
            y: num(p, "y")?,
            vx: num(p, "vx")?,
            vy: num(p, "vy")?,
            x0: num(p, "x0")?,
            y0: num(p, "y0")?,
            t0: num(p, "t0")?,
            range: num(p, "range")?,
            from: opt_text(p, "from")?,
        });
    }
    let minimap_v = field(input, "minimap")?;
    let minimap = PerceptMinimap {
        t: num(minimap_v, "t")?,
        mobs: arr(minimap_v, "mobs")?
            .iter()
            .map(|m| {
                Ok(PerceptMinimapMob {
                    id: text(m, "id")?,
                    x: num(m, "x")?,
                    y: num(m, "y")?,
                    faction: opt_text(m, "faction")?
                        .as_deref()
                        .and_then(FactionId::parse),
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
                state: num(c, "state")? as u8,
            });
        }
    }
    if let Some(chests) = extras_v.optional("chests") {
        for c in chests.arr("extras.chests")? {
            extras.chests.push(PerceptChest {
                id: text(c, "id")?,
                x: num(c, "x")?,
                y: num(c, "y")?,
                picked: boolv(c, "picked")?,
            });
        }
    }
    if let Some(plan) = extras_v.optional("plan") {
        if !matches!(plan, SVal::Null) {
            extras.plan = Some(PerceptPlan {
                ends_at: num(plan, "endsAt")?,
            });
        }
    }
    let features = match input.optional("features") {
        Some(v) => parse_features(v)?,
        None => fallback_features.clone(),
    };
    Ok(MemoryPercept {
        now: num(input, "now")?,
        view_t: num(input, "viewT")?,
        self_: PerceptSelf {
            id: text(self_v, "id")?,
            name: text(self_v, "name")?,
            x: num(self_v, "x")?,
            y: num(self_v, "y")?,
            facing: num(self_v, "facing")?,
            status: text(self_v, "status")?,
            hp: num(self_v, "hp")?,
            max_hp: num(self_v, "maxHp")?,
            attack_target: opt_text(self_v, "attackTarget")?,
            move_seq: num(self_v, "moveSeq")?,
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
    let t = num(v, "t")?;
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
            amount: num(v, "amount")?,
            weapon: opt_text(v, "weapon")?.and_then(|w| parse_weapon(&w)),
        },
        "block" => PerceptEvent::Block {
            id: text(v, "id")?,
            by: opt_text(v, "by")?,
            weapon: opt_text(v, "weapon")?.and_then(|w| parse_weapon(&w)),
        },
        "bounty" => PerceptEvent::Bounty {
            id: text(v, "id")?,
            name: text(v, "name")?,
            bounty: num(v, "bounty")?,
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
            weapon: parse_weapon(&text(v, "weapon")?)
                .ok_or_else(|| "unknown windup weapon".to_string())?,
            a: num(v, "a")?,
            ms: num(v, "ms")?,
        },
        "cancel" => PerceptEvent::Cancel { id: text(v, "id")? },
        "swing" => PerceptEvent::Swing {
            by: text(v, "by")?,
            weapon: parse_weapon(&text(v, "weapon")?)
                .ok_or_else(|| "unknown swing weapon".to_string())?,
            a: num(v, "a")?,
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
    let at = num(input, "at")?;
    let cmd_v = field(input, "cmd")?;
    let ty = text(cmd_v, "type")?;
    let msg = field(cmd_v, "msg")?;
    let cmd = match ty.as_str() {
        "move" => MemoryCommand::Move {
            x: num(msg, "x")?,
            y: num(msg, "y")?,
            seq: msg.opt_num("seq", "seq")?,
        },
        "stop" => MemoryCommand::Stop {
            seq: msg.opt_num("seq", "seq")?,
        },
        "target" => MemoryCommand::Target {
            id: text(msg, "id")?,
        },
        "pickup" => MemoryCommand::Pickup {
            container_id: text(msg, "containerId")?,
        },
        "cast" => MemoryCommand::Cast,
        _ => MemoryCommand::Other,
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

#[test]
fn private_strategy_source_memory_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "memory-api" {
            continue;
        }
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut mem = create_memory(&cfg);
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "nullPercept" => {
                    assert!(matches!(input, SVal::Null));
                    SVal::Null
                }
                "observe" => {
                    let percept = parse_memory_percept(&input, &cfg.features).unwrap();
                    let stimuli = mem.observe(&percept).unwrap();
                    source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
                }
                "noteSent" => {
                    let tc = parse_note_sent(&input).unwrap();
                    mem.note_sent(tc).unwrap();
                    SVal::Undefined
                }
                "recordChoice" => {
                    mem.record_choice(input.string("choice").unwrap());
                    SVal::Undefined
                }
                "whereabouts" => {
                    let id = text(&input, "id").unwrap();
                    let now = num(&input, "now").unwrap();
                    match mem.whereabouts(&id, now).unwrap() {
                        None => SVal::Null,
                        Some(w) => obj(vec![("at", vec2_sv(w.at)), ("radius", num_sv(w.radius))]),
                    }
                }
                other => panic!("unsupported memory method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            let expected_memory = op.optional("memory").cloned().unwrap_or(SVal::Undefined);
            let actual_memory = encode_memory(&mem);
            compare_memory(
                &format!("{} op{index} {method}", case["id"]),
                &expected_memory,
                &actual_memory,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL memory parity : {}", operations);
    assert!(
        failures.is_empty(),
        "memory parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

// --------------------------------------------------------------------------------------------------------------------
// Source percept/config -> private strategy context helpers

fn parse_strategy_self(v: &SVal) -> R<StrategySelf> {
    let weapons_raw = arr(v, "weapons")?;
    let mut weapons = [None, None];
    for (i, w) in weapons_raw.iter().take(2).enumerate() {
        weapons[i] = match w {
            SVal::Null => None,
            SVal::Str(s) => parse_weapon(s),
            _ => return Err("weapons must be string|null".into()),
        };
    }
    let mob_stats = match v.optional("mobStats") {
        Some(SVal::Obj(entries)) => entries
            .iter()
            .map(|(k, v)| Ok((k.clone(), v.num("mobStats")? as u32)))
            .collect::<R<Vec<_>>>()?,
        _ => Vec::new(),
    };
    Ok(StrategySelf {
        id: text(v, "id")?,
        faction: opt_text(v, "faction")?
            .as_deref()
            .and_then(FactionId::parse),
        x: num(v, "x")?,
        y: num(v, "y")?,
        facing: num(v, "facing")?,
        status: text(v, "status")?,
        hp: num(v, "hp")?,
        max_hp: num(v, "maxHp")?,
        weapons,
        slot: num(v, "slot")? as u8,
        attack_target: opt_text(v, "attackTarget")?,
        mob_kills: num(v, "mobKills")?,
        power: num(v, "power")?,
        kills: num(v, "kills")?,
        mob_stats,
        speed_mult: num(v, "speedMult")?,
        bounty: num(v, "bounty")?,
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
                x: num(f, "x")?,
                y: num(f, "y")?,
                dist: num(f, "dist")?,
                los: boolv(f, "los")?,
                status: text(f, "status")?,
                targetable: boolv(f, "targetable")?,
                immune: boolv(f, "immune")?,
                hp_frac: num(f, "hpFrac")?,
                faction: opt_text(f, "faction")?
                    .as_deref()
                    .and_then(FactionId::parse),
                in_hand: opt_text(f, "inHand")?.and_then(|w| parse_weapon(&w)),
                bounty: num(f, "bounty")?,
                tint: num(f, "tint")?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let mobs = arr(input, "mobs")?
        .iter()
        .map(|m| {
            Ok(super::types::StrategyMob {
                id: text(m, "id")?,
                x: num(m, "x")?,
                y: num(m, "y")?,
                status: text(m, "status")?,
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
                x: num(c, "x")?,
                y: num(c, "y")?,
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
                    index: num(c, "index")? as usize,
                    type_: opt_text(c, "type")?,
                    alive: num(c, "alive")? as u32,
                    state: num(c, "state")? as u8,
                    respawn_at: c.opt_num("respawnAt", "respawnAt")?,
                });
            }
            extras.camps = Some(views);
        }
    }
    Ok(StrategyPercept {
        now: num(input, "now")?,
        self_: parse_strategy_self(self_v)?,
        hud: super::types::StrategyHud {
            raid_started_at: num(hud, "raidStartedAt")?,
            patience_ends_at: num(hud, "patienceEndsAt")?,
            sudden_death_at: num(hud, "suddenDeathAt")?,
            in_coliseum: boolv(hud, "inColiseum")?,
            alive: num(hud, "alive")? as u32,
            gates_locked: boolv(hud, "gatesLocked")?,
        },
        fighters,
        mobs,
        containers,
        extras,
    })
}

struct PathHarness {
    spec: PathSpec,
    source_map: Option<rh_sim::TileMap>,
    finder: rh_sim::pathfind::Pathfinder,
    calls: Vec<(Vec2, Vec2)>,
}
impl super::types::PathApi for PathHarness {
    fn walk(&mut self, from: Vec2, to: Vec2) -> Option<WalkAnswer> {
        self.calls.push((from, to));
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
    fn los(&self, _a: Vec2, _b: Vec2) -> bool {
        !matches!(self.spec, PathSpec::Null)
    }
    fn clear(&self, _a: Vec2, _b: Vec2) -> bool {
        !matches!(self.spec, PathSpec::Null)
    }
}

fn encode_goal(goal: &Goal) -> SVal {
    match goal {
        Goal::Idle => obj(vec![("kind", source_reader::s("idle"))]),
        Goal::Farm { mob, camp } => obj(vec![
            ("kind", source_reader::s("farm")),
            ("mob", source_reader::s(mob)),
            (
                "camp",
                camp.as_deref().map(source_reader::s).unwrap_or(SVal::Null),
            ),
        ]),
        Goal::Hunt { target } => obj(vec![
            ("kind", source_reader::s("hunt")),
            ("target", source_reader::s(target)),
        ]),
        Goal::Fight { target } => obj(vec![
            ("kind", source_reader::s("fight")),
            ("target", source_reader::s(target)),
        ]),
        Goal::Loot { container } => obj(vec![
            ("kind", source_reader::s("loot")),
            ("container", source_reader::s(container)),
        ]),
        Goal::Flee { from, until } => obj(vec![
            ("kind", source_reader::s("flee")),
            (
                "from",
                source_reader::arr(from.iter().map(|p| vec2_sv(*p)).collect()),
            ),
            ("until", num_sv(*until)),
        ]),
        Goal::Roam { to, why } => obj(vec![
            ("kind", source_reader::s("roam")),
            ("to", vec2_sv(*to)),
            ("why", source_reader::s(why.as_str())),
        ]),
        Goal::Hold { at, why } => obj(vec![
            ("kind", source_reader::s("hold")),
            ("at", vec2_sv(*at)),
            ("why", source_reader::s(why.as_str())),
        ]),
        Goal::Module { module, data } => obj(vec![
            ("kind", source_reader::s("module")),
            ("module", source_reader::s(module)),
            ("data", method_value_sv(data)),
        ]),
    }
}

fn encode_goal_decision(d: &GoalDecision) -> SVal {
    let mut fields = vec![
        ("goal", encode_goal(&d.goal)),
        ("utility", num_sv(d.utility)),
        ("why", source_reader::s(&d.why)),
    ];
    if let Some(choice) = &d.choice {
        fields.push(("choice", source_reader::s(choice)));
    }
    obj(fields)
}

fn encode_strategy_state(state: &StrategyState) -> SVal {
    obj(vec![
        (
            "avoidId",
            state
                .avoid_id
                .as_deref()
                .map(source_reader::s)
                .unwrap_or(SVal::Null),
        ),
        ("avoidUntil", num_sv(state.avoid_until)),
        (
            "chase",
            match &state.chase {
                None => SVal::Null,
                Some(c) => obj(vec![
                    ("id", source_reader::s(&c.id)),
                    ("best", num_sv(c.best)),
                    ("since", num_sv(c.since)),
                    ("limit", num_sv(c.limit)),
                ]),
            },
        ),
        ("goalSince", num_sv(state.goal_since)),
        (
            "candidates",
            source_reader::arr(state.candidates.iter().map(encode_goal_decision).collect()),
        ),
    ])
}

fn encode_hunt_stats(stats: &super::mob_hunt::MobHuntStats) -> SVal {
    obj(vec![
        ("targets", num_sv(stats.targets as f64)),
        ("drops", num_sv(stats.drops as f64)),
        ("retreats", num_sv(stats.retreats as f64)),
        ("focusMs", num_sv(stats.focus_ms)),
    ])
}

fn encode_optional_step(step: Option<super::types::RouteStep>) -> SVal {
    step.map(|s| encode_route_step(&s)).unwrap_or(SVal::Null)
}

fn encode_plan(plan: &Option<(String, Vec<super::types::RouteStep>, u64)>) -> SVal {
    match plan {
        None => SVal::Null,
        Some((build, route, contests)) => obj(vec![
            ("build", source_reader::s(build)),
            (
                "route",
                source_reader::arr(route.iter().map(encode_route_step).collect()),
            ),
            ("contests", num_sv(*contests as f64)),
        ]),
    }
}

// --------------------------------------------------------------------------------------------------------------------
// Adapter and Strategy suites

struct OverrideRng {
    fallback: Rng,
    overrides: Vec<f64>,
    index: usize,
    draws: Vec<f64>,
}
impl OverrideRng {
    fn new(seed: u32, overrides: Vec<f64>) -> Self {
        Self {
            fallback: Rng::new(seed),
            overrides,
            index: 0,
            draws: Vec::new(),
        }
    }
}
impl super::types::RngStream for OverrideRng {
    fn draw(&mut self) -> f64 {
        let value = if self.index < self.overrides.len() {
            self.overrides[self.index]
        } else {
            self.fallback.next_f64()
        };
        self.index += 1;
        self.draws.push(value);
        value
    }
}

struct StrategyHarnessConfig {
    tier: TierParams,
    persona: PersonaParams,
    map: StrategyMap,
    features: Features,
    learned: LearnedMap,
    modules: Vec<Box<dyn super::types::FeatureModule>>,
}

fn harness_config(cfg: &SourceConfig) -> StrategyHarnessConfig {
    StrategyHarnessConfig {
        tier: cfg.tier,
        persona: cfg.persona,
        map: cfg.map.clone(),
        features: cfg.features.clone(),
        learned: cfg.learned.clone(),
        modules: cfg
            .modules
            .iter()
            .cloned()
            .map(|m| Box::new(m) as Box<dyn super::types::FeatureModule>)
            .collect(),
    }
}

fn modules_for(
    cfg: &SourceConfig,
    env: Option<&SVal>,
) -> Vec<Box<dyn super::types::FeatureModule>> {
    let overrides = env
        .and_then(|e| e.optional("moduleGoals"))
        .and_then(|g| match g {
            SVal::Obj(entries) => Some(
                entries
                    .iter()
                    .map(|(id, goals)| {
                        let parsed = goals
                            .arr("moduleGoals")
                            .unwrap()
                            .iter()
                            .map(|g| parse_goal_decision(g).unwrap())
                            .collect::<Vec<_>>();
                        (id.clone(), parsed)
                    })
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .unwrap_or_default();
    cfg.modules
        .iter()
        .cloned()
        .map(|mut m| {
            if let Some((_, goals)) = overrides.iter().find(|(id, _)| *id == m.id) {
                m.goals = Some(goals.clone());
            }
            Box::new(m) as Box<dyn super::types::FeatureModule>
        })
        .collect()
}

fn knowledge_for(cfg: &SourceConfig) -> Knowledge {
    let mut rng = Rng::new(cfg.seed + 3);
    Knowledge::create(&cfg.tier, &mut rng)
}

fn parse_status(v: &SVal) -> R<GoalStatus> {
    let state = match text(v, "state")?.as_str() {
        "running" => super::types::GoalState::Running,
        "done" => super::types::GoalState::Done,
        "failed" => super::types::GoalState::Failed,
        "blocked" => super::types::GoalState::Blocked,
        other => return Err(format!("unknown status {other}")),
    };
    Ok(GoalStatus {
        state,
        why: text(v, "why")?,
    })
}

fn goals_of(v: &SVal) -> R<Vec<GoalDecision>> {
    v.arr("goals")?.iter().map(parse_goal_decision).collect()
}

#[test]
fn private_strategy_source_hunt_adapter_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "hunt-adapter" {
            continue;
        }
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut mem = create_memory(&cfg);
        let mut percept: Option<StrategyPercept> = None;
        let know = knowledge_for(&cfg);
        let harness_cfg = harness_config(&cfg);
        let mut paths = PathHarness {
            spec: cfg.path.clone(),
            source_map: cfg.tile_map.clone(),
            finder: rh_sim::pathfind::Pathfinder::default(),
            calls: Vec::new(),
        };
        let attacking_value = cfg.attacking;
        let attacking =
            Some(std::rc::Rc::new(move || attacking_value.unwrap_or(false))
                as super::types::AttackFn);
        let opts = super::hunt_adapter::HuntAdapterOptions {
            attacking: if cfg.attacking.is_some() {
                attacking
            } else {
                None
            },
            log: None,
        };
        let mut adapter = HuntAdapter::new(&cfg.tier, &cfg.persona, opts);
        let mut decide_rng = OverrideRng::new(cfg.seed, cfg.random_decide.clone());
        let mut lapse_rng = OverrideRng::new(cfg.seed + 2, cfg.random_lapse.clone());
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "observe" => {
                    let mp = parse_memory_percept(&input, &cfg.features).unwrap();
                    let stimuli = mem.observe(&mp).unwrap();
                    percept = Some(parse_strategy_percept(&input, &cfg).unwrap());
                    source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
                }
                "adapterDecide" => {
                    let p = percept.as_ref().unwrap();
                    let cfg_ctx = StrategyConfig {
                        id: cfg.id.clone(),
                        seed: cfg.seed,
                        tier: &harness_cfg.tier,
                        persona: &harness_cfg.persona,
                        map: &harness_cfg.map,
                        features: &harness_cfg.features,
                        learned: &harness_cfg.learned,
                        modules: &harness_cfg.modules,
                    };
                    let weight = op.optional("typeWeights").cloned();
                    let tw = weight.as_ref().map(|weights| {
                        let pairs = weights
                            .arr("typeWeights")
                            .unwrap()
                            .iter()
                            .map(|p| {
                                let pair = p.arr("typeWeight pair").unwrap();
                                (
                                    pair[0].string("typeWeight key").unwrap().to_string(),
                                    pair[1].num("typeWeight value").unwrap(),
                                )
                            })
                            .collect::<Vec<_>>();
                        move |ty: Option<&str>| -> f64 {
                            ty.and_then(|t| pairs.iter().find(|(k, _)| k == t).map(|(_, v)| *v))
                                .unwrap_or(0.25)
                        }
                    });
                    let mut ctx = StrategyContext {
                        cfg: &cfg_ctx,
                        p,
                        mem: &mem,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide_rng,
                        lapse: &mut lapse_rng,
                        engaged: op
                            .optional("engaged")
                            .and_then(|v| v.bool("engaged").ok())
                            .unwrap_or(false),
                    };
                    let tw_ref = tw.as_ref().map(|f| f as &dyn Fn(Option<&str>) -> f64);
                    let d = adapter.decide(
                        &mut ctx,
                        tw_ref,
                        op.optional("elitesReady")
                            .and_then(|v| v.bool("elitesReady").ok()),
                    );
                    encode_decision(&d)
                }
                "release" => {
                    let p = percept.as_ref().unwrap();
                    let cfg_ctx = StrategyConfig {
                        id: cfg.id.clone(),
                        seed: cfg.seed,
                        tier: &harness_cfg.tier,
                        persona: &harness_cfg.persona,
                        map: &harness_cfg.map,
                        features: &harness_cfg.features,
                        learned: &harness_cfg.learned,
                        modules: &harness_cfg.modules,
                    };
                    let mut ctx = StrategyContext {
                        cfg: &cfg_ctx,
                        p,
                        mem: &mem,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide_rng,
                        lapse: &mut lapse_rng,
                        engaged: false,
                    };
                    adapter.release(&mut ctx);
                    SVal::Undefined
                }
                "awakeNear" => {
                    let from = parse_vec2(field(&input, "from").unwrap()).unwrap();
                    let radius = num(&input, "radius").unwrap();
                    let now = num(&input, "now").unwrap();
                    source_reader::arr(
                        adapter
                            .awake_near(from, radius, now)
                            .into_iter()
                            .map(vec2_sv)
                            .collect(),
                    )
                }
                other => panic!("unsupported adapter method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            for extra in ["stats", "target"] {
                if let Some(exp) = op.optional(extra).cloned() {
                    let act = match extra {
                        "stats" => encode_hunt_stats(adapter.stats()),
                        "target" => adapter.target().map(source_reader::s).unwrap_or(SVal::Null),
                        _ => unreachable!(),
                    };
                    compare(
                        &format!("{} op{index} {method} {extra}", case["id"]),
                        &exp,
                        &act,
                        &mut failures,
                    );
                }
            }
            let expected_memory = op.optional("memory").cloned().unwrap_or(SVal::Undefined);
            let actual_memory = encode_memory(&mem);
            compare_memory(
                &format!("{} op{index} {method}", case["id"]),
                &expected_memory,
                &actual_memory,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL adapter parity : {}", operations);
    assert!(
        failures.is_empty(),
        "adapter parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn private_strategy_source_strategy_parity() {
    let source = load_source();
    let maps = &source["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    for case in source_cases(&source) {
        if case["suite"] != "strategy" {
            continue;
        }
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut mem = create_memory(&cfg);
        let mut percept: Option<StrategyPercept> = None;
        let know = knowledge_for(&cfg);
        let harness_cfg = harness_config(&cfg);
        let mut paths = PathHarness {
            spec: cfg.path.clone(),
            source_map: cfg.tile_map.clone(),
            finder: rh_sim::pathfind::Pathfinder::default(),
            calls: Vec::new(),
        };
        let attacking_value = cfg.attacking;
        let mut strategy = Strategy::new(StrategyOptions {
            attacking: cfg.attacking.map(|_| {
                std::rc::Rc::new(move || attacking_value.unwrap_or(false)) as super::types::AttackFn
            }),
            log: None,
        });
        let mut decide_rng = OverrideRng::new(cfg.seed, cfg.random_decide.clone());
        let mut lapse_rng = OverrideRng::new(cfg.seed + 2, cfg.random_lapse.clone());
        let mut last_goal = Goal::Idle;
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "observe" => {
                    let mp = parse_memory_percept(&input, &cfg.features).unwrap();
                    let stimuli = mem.observe(&mp).unwrap();
                    percept = Some(parse_strategy_percept(&input, &cfg).unwrap());
                    source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
                }
                "recordChoice" => {
                    mem.record_choice(input.string("choice").unwrap());
                    SVal::Undefined
                }
                "decide" => {
                    let p = percept.as_ref().unwrap();
                    let declaration = field(&op, "declaration").unwrap();
                    let current = if matches!(declaration.optional("current"), Some(SVal::Str(s)) if s == "$previous")
                    {
                        last_goal.clone()
                    } else {
                        parse_goal(field(&input, "current").unwrap()).unwrap()
                    };
                    if matches!(declaration.optional("current"), Some(SVal::Str(s)) if s == "$previous")
                    {
                        let guard = parse_goal(field(&input, "current").unwrap()).unwrap();
                        if !source_reader::same(&encode_goal(&guard), &encode_goal(&last_goal)) {
                            failures.push(format!(
                                "{} op{index} decide: $previous guard differs from own prior goal",
                                case["id"]
                            ));
                        }
                    }
                    let status = parse_status(field(&input, "status").unwrap()).unwrap();
                    let engaged = boolv(&input, "engaged").unwrap();
                    let env = declaration.optional("env").cloned();
                    let modules = modules_for(&cfg, env.as_ref());
                    let cfg_ctx = StrategyConfig {
                        id: cfg.id.clone(),
                        seed: cfg.seed,
                        tier: &harness_cfg.tier,
                        persona: &harness_cfg.persona,
                        map: &harness_cfg.map,
                        features: &harness_cfg.features,
                        learned: &harness_cfg.learned,
                        modules: &modules,
                    };
                    let mut ctx = StrategyContext {
                        cfg: &cfg_ctx,
                        p,
                        mem: &mem,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide_rng,
                        lapse: &mut lapse_rng,
                        engaged,
                    };
                    let out = strategy.decide(&mut ctx, &current, &status);
                    let identity = strategy.last_returned_current();
                    last_goal = out.goal.clone();
                    let encoded = encode_goal_decision(&out);
                    if let Some(exp_identity) = op.optional("identity") {
                        let act_identity = obj(vec![("returnedCurrentGoal", bool_sv(identity))]);
                        compare(
                            &format!("{} op{index} decide identity", case["id"]),
                            exp_identity,
                            &act_identity,
                            &mut failures,
                        );
                    }
                    encoded
                }
                other => panic!("unsupported strategy method {other}"),
            };
            compare(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            for extra in ["state", "plan", "huntStats", "huntTarget"] {
                if let Some(exp) = op.optional(extra).cloned() {
                    let act = match extra {
                        "state" => encode_strategy_state(&strategy.state()),
                        "plan" => encode_plan(&strategy.plan()),
                        "huntStats" => encode_hunt_stats(&strategy.hunt_stats()),
                        "huntTarget" => strategy
                            .hunt_target()
                            .map(|s| source_reader::s(&s))
                            .unwrap_or(SVal::Null),
                        _ => unreachable!(),
                    };
                    compare(
                        &format!("{} op{index} {method} {extra}", case["id"]),
                        &exp,
                        &act,
                        &mut failures,
                    );
                }
            }
            let expected_memory = op.optional("memory").cloned().unwrap_or(SVal::Undefined);
            let actual_memory = encode_memory(&mem);
            compare_memory(
                &format!("{} op{index} {method}", case["id"]),
                &expected_memory,
                &actual_memory,
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL strategy parity : {}", operations);
    assert!(
        failures.is_empty(),
        "strategy parity {operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

// --------------------------------------------------------------------------------------------------------------------
// Additive module-goal-key supplement (4 histories / 48 calls)

fn same_raw(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Obj(x), SVal::Obj(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| ka == kb && same_raw(va, vb))
        }
        (SVal::Arr(x), SVal::Arr(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same_raw(a, b))
        }
        (SVal::Map(x), SVal::Map(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| same_raw(ka, kb) && same_raw(va, vb))
        }
        _ => source_reader::same(a, b),
    }
}

fn same_goal(a: &SVal, b: &SVal) -> bool {
    let (SVal::Obj(ax), SVal::Obj(bx)) = (a, b) else {
        return source_reader::same(a, b);
    };
    let field = |entries: &[(String, SVal)], name: &str| {
        entries
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    match (field(ax, "kind"), field(bx, "kind")) {
        (Some(SVal::Str(k1)), Some(SVal::Str(k2))) if k1 == "module" && k2 == "module" => {
            ax.len() == bx.len()
                && ax.iter().all(|(k, v)| {
                    bx.iter().find(|(bk, _)| bk == k).is_some_and(|(_, bv)| {
                        if k == "data" {
                            same_raw(v, bv)
                        } else {
                            source_reader::same(v, bv)
                        }
                    })
                })
        }
        _ => source_reader::same(a, b),
    }
}

fn same_goal_decision(a: &SVal, b: &SVal) -> bool {
    let (SVal::Obj(ax), SVal::Obj(bx)) = (a, b) else {
        return source_reader::same(a, b);
    };
    ax.len() == bx.len()
        && ax.iter().all(|(k, v)| {
            bx.iter().find(|(bk, _)| bk == k).is_some_and(|(_, bv)| {
                if k == "goal" {
                    same_goal(v, bv)
                } else {
                    source_reader::same(v, bv)
                }
            })
        })
}

fn compare_strategy_ordered(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    if !same_goal_decision(expected, actual) {
        failures.push(format!("{label}: expected={expected:?} actual={actual:?}"));
    }
}

fn compare_strategy_state_ordered(
    label: &str,
    expected: &SVal,
    actual: &SVal,
    failures: &mut Vec<String>,
) {
    let (SVal::Obj(exp), SVal::Obj(act)) = (expected, actual) else {
        failures.push(format!("{label}: non-object state"));
        return;
    };
    for (name, ev) in exp {
        let Some((_, av)) = act.iter().find(|(k, _)| k == name) else {
            failures.push(format!("{label}.{name}: missing"));
            continue;
        };
        match name.as_str() {
            "candidates" => {
                let (SVal::Arr(ea), SVal::Arr(aa)) = (ev, av) else {
                    failures.push(format!("{label}.candidates: not arrays"));
                    continue;
                };
                if ea.len() != aa.len() {
                    failures.push(format!(
                        "{label}.candidates: length {} != {}",
                        ea.len(),
                        aa.len()
                    ));
                    continue;
                }
                for (i, (e, a)) in ea.iter().zip(aa).enumerate() {
                    if !same_goal_decision(e, a) {
                        failures.push(format!("{label}.candidates[{i}]: mismatch"));
                    }
                }
            }
            _ => {
                if !source_reader::same(ev, av) {
                    failures.push(format!("{label}.{name}: expected={ev:?} actual={av:?}"));
                }
            }
        }
    }
}

#[test]
fn private_module_goal_key_source_parity() {
    let supplement: Value = {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../parity/policy/bot-module-goal-key/source.json");
        serde_json::from_str(&std::fs::read_to_string(path).expect("module goal-key source.json"))
            .expect("valid supplement JSON")
    };
    let primary = load_source();
    let maps = &primary["maps"];
    let mut failures = Vec::new();
    let mut operations = 0usize;
    let mut cases_seen = 0usize;
    for case in supplement["cases"].as_array().expect("supplement cases") {
        if case["suite"] != "strategy" {
            continue;
        }
        cases_seen += 1;
        let config = sv(&case["config"]);
        let cfg = parse_config(&config, maps).unwrap();
        let mut mem = create_memory(&cfg);
        let mut percept: Option<StrategyPercept> = None;
        let know = knowledge_for(&cfg);
        let harness_cfg = harness_config(&cfg);
        let mut paths = PathHarness {
            spec: cfg.path.clone(),
            source_map: cfg.tile_map.clone(),
            finder: rh_sim::pathfind::Pathfinder::default(),
            calls: Vec::new(),
        };
        let attacking_value = cfg.attacking;
        let mut strategy = Strategy::new(StrategyOptions {
            attacking: cfg.attacking.map(|_| {
                std::rc::Rc::new(move || attacking_value.unwrap_or(false)) as super::types::AttackFn
            }),
            log: None,
        });
        let mut decide_rng = OverrideRng::new(cfg.seed, cfg.random_decide.clone());
        let mut lapse_rng = OverrideRng::new(cfg.seed + 2, cfg.random_lapse.clone());
        let mut last_goal = Goal::Idle;
        for (index, op) in case["operations"].as_array().unwrap().iter().enumerate() {
            let op = sv(op);
            let method = text(&op, "method").unwrap();
            let input = op.optional("input").cloned().unwrap_or(SVal::Undefined);
            let expected = op.optional("result").cloned().unwrap_or(SVal::Undefined);
            let actual = match method.as_str() {
                "observe" => {
                    let mp = parse_memory_percept(&input, &cfg.features).unwrap();
                    let stimuli = mem.observe(&mp).unwrap();
                    percept = Some(parse_strategy_percept(&input, &cfg).unwrap());
                    source_reader::arr(stimuli.iter().map(encode_stimulus).collect())
                }
                "recordChoice" => {
                    mem.record_choice(input.string("choice").unwrap());
                    SVal::Undefined
                }
                "decide" => {
                    let p = percept.as_ref().unwrap();
                    let declaration = field(&op, "declaration").unwrap();
                    let previous = matches!(declaration.optional("current"), Some(SVal::Str(s)) if s == "$previous");
                    let current = if previous {
                        last_goal.clone()
                    } else {
                        parse_goal(field(&input, "current").unwrap()).unwrap()
                    };
                    let status = parse_status(field(&input, "status").unwrap()).unwrap();
                    let env = declaration.optional("env").cloned();
                    let modules = modules_for(&cfg, env.as_ref());
                    let cfg_ctx = StrategyConfig {
                        id: cfg.id.clone(),
                        seed: cfg.seed,
                        tier: &harness_cfg.tier,
                        persona: &harness_cfg.persona,
                        map: &harness_cfg.map,
                        features: &harness_cfg.features,
                        learned: &harness_cfg.learned,
                        modules: &modules,
                    };
                    let mut ctx = StrategyContext {
                        cfg: &cfg_ctx,
                        p,
                        mem: &mem,
                        know: &know,
                        paths: &mut paths,
                        decide: &mut decide_rng,
                        lapse: &mut lapse_rng,
                        engaged: boolv(&input, "engaged").unwrap(),
                    };
                    let out = strategy.decide(&mut ctx, &current, &status);
                    last_goal = out.goal.clone();
                    let encoded = encode_goal_decision(&out);
                    if let Some(exp_identity) = op.optional("identity") {
                        let act_identity = obj(vec![(
                            "returnedCurrentGoal",
                            bool_sv(strategy.last_returned_current()),
                        )]);
                        compare(
                            &format!("{} op{index} decide identity", case["id"]),
                            exp_identity,
                            &act_identity,
                            &mut failures,
                        );
                    }
                    encoded
                }
                other => panic!("unsupported supplement method {other}"),
            };
            compare_strategy_ordered(
                &format!("{} op{index} {method}", case["id"]),
                &expected,
                &actual,
                &mut failures,
            );
            if let Some(exp_state) = op.optional("state").cloned() {
                compare_strategy_state_ordered(
                    &format!("{} op{index} {method} state", case["id"]),
                    &exp_state,
                    &encode_strategy_state(&strategy.state()),
                    &mut failures,
                );
            }
            if let Some(exp_plan) = op.optional("plan").cloned() {
                compare(
                    &format!("{} op{index} {method} plan", case["id"]),
                    &exp_plan,
                    &encode_plan(&strategy.plan()),
                    &mut failures,
                );
            }
            if let Some(exp_stats) = op.optional("huntStats").cloned() {
                compare(
                    &format!("{} op{index} {method} stats", case["id"]),
                    &exp_stats,
                    &encode_hunt_stats(&strategy.hunt_stats()),
                    &mut failures,
                );
            }
            if let Some(exp_target) = op.optional("huntTarget").cloned() {
                let act = strategy
                    .hunt_target()
                    .map(|s| source_reader::s(&s))
                    .unwrap_or(SVal::Null);
                compare(
                    &format!("{} op{index} {method} target", case["id"]),
                    &exp_target,
                    &act,
                    &mut failures,
                );
            }
            let expected_memory = op.optional("memory").cloned().unwrap_or(SVal::Undefined);
            compare_memory(
                &format!("{} op{index} {method}", case["id"]),
                &expected_memory,
                &encode_memory(&mem),
                &mut failures,
            );
            operations += 1;
        }
    }
    eprintln!("PARITY_TOTAL module-goal-key parity : {}", operations);
    assert!(
        failures.is_empty(),
        "module-goal-key parity {cases_seen} cases/{operations} ops; first failures:\n{}",
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

// --------------------------------------------------------------------------------------------------------------------
// Frozen corpus envelope, setup transcript and cumulative RNG checks

fn expected_setup_knowledge_draws(case: &Value, seed: u32, failures: &mut Vec<String>) {
    let entries = case["setupTranscript"]["values"]
        .as_array()
        .expect("setupTranscript values");
    let mut rng = Rng::new(seed + 3);
    let mut ordinal = 0usize;
    for entry in entries {
        let entry = sv(entry);
        let kind = text(&entry, "kind").unwrap();
        let stream = text(&entry, "stream").unwrap();
        assert_eq!(
            kind, "rng",
            "setup transcript must be RNG-only at this phase"
        );
        assert_eq!(stream, "knowledge");
        let index = num(&entry, "index").unwrap() as usize;
        assert_eq!(index, ordinal, "knowledge draw index");
        let expected = field(&entry, "value").unwrap().num("rng value").unwrap();
        let actual = rng.next_f64();
        if expected.to_bits() != actual.to_bits() {
            failures.push(format!(
                "setupTranscript knowledge draw {ordinal}: expected={expected:?} actual={actual:?}"
            ));
        }
        ordinal += 1;
    }
    if ordinal != 70 {
        failures.push(format!(
            "setupTranscript knowledge draws expected 70, got {ordinal}"
        ));
    }
}

fn check_draw_counts(
    label: &str,
    expected: &SVal,
    decide: usize,
    motor: usize,
    lapse: usize,
    knowledge: usize,
    failures: &mut Vec<String>,
) {
    let actual = obj(vec![
        ("decide", num_sv(decide as f64)),
        ("motor", num_sv(motor as f64)),
        ("lapse", num_sv(lapse as f64)),
        ("knowledge", num_sv(knowledge as f64)),
    ]);
    compare(&format!("{label} drawCounts"), expected, &actual, failures);
}

fn check_rng_callback_order(
    label: &str,
    expected_callbacks: &SVal,
    decide: &[f64],
    lapse: &[f64],
    failures: &mut Vec<String>,
) {
    let Some(expected) = expected_callbacks.arr("callbacks").ok() else {
        return;
    };
    let mut expected_rng: Vec<(String, usize, f64)> = Vec::new();
    for cb in expected {
        if text(cb, "kind").unwrap_or_default() == "rng" {
            let stream = text(cb, "stream").unwrap_or_default();
            let index = num(cb, "index").unwrap_or(0.) as usize;
            let value = field(cb, "value").unwrap().num("value").unwrap_or(0.);
            expected_rng.push((stream, index, value));
        }
    }
    let mut actual: Vec<(String, usize, f64)> = Vec::new();
    for (i, value) in decide.iter().enumerate() {
        actual.push(("decide".into(), i, *value));
    }
    for (i, value) in lapse.iter().enumerate() {
        actual.push(("lapse".into(), i, *value));
    }
    actual.sort_by_key(|(stream, index, _)| (stream.clone(), *index));
    if expected_rng.len() != actual.len() {
        failures.push(format!(
            "{label} rng entries expected {} actual {}",
            expected_rng.len(),
            actual.len()
        ));
        return;
    }
    for (i, (e, a)) in expected_rng.iter().zip(actual.iter()).enumerate() {
        if e.0 != a.0 || e.1 != a.1 || e.2.to_bits() != a.2.to_bits() {
            failures.push(format!(
                "{label} rng entry {i}: expected={e:?} actual={a:?}"
            ));
        }
    }
}

#[test]
fn private_strategy_source_envelope_guard() {
    let source = load_source();
    let primary = source_cases(&source);
    assert_eq!(primary.len(), 98, "primary case set");
    let mut counts = std::collections::BTreeMap::new();
    let mut total = 0usize;
    for case in primary {
        let suite = case["suite"].as_str().expect("suite");
        let n = case["operations"].as_array().expect("operations").len();
        *counts.entry(suite.to_string()).or_insert(0usize) += n;
        total += n;
    }
    assert_eq!(counts.get("memory-api"), Some(&122));
    assert_eq!(counts.get("strategy"), Some(&292));
    assert_eq!(counts.get("mob-tracker"), Some(&14));
    assert_eq!(counts.get("mob-hunter"), Some(&127));
    assert_eq!(counts.get("hunt-adapter"), Some(&67));
    assert_eq!(counts.get("build-route"), Some(&36));
    assert_eq!(total, 658);
    let supplement: Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../parity/policy/bot-module-goal-key/source.json"),
        )
        .expect("supplement"),
    )
    .expect("valid");
    assert_eq!(supplement["cases"].as_array().unwrap().len(), 4);
    let supplement_ops: usize = supplement["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["operations"].as_array().unwrap().len())
        .sum();
    assert_eq!(supplement_ops, 48);
}
