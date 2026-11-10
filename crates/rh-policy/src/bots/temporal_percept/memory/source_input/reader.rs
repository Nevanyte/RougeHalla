//! Test-only checked readers for the declared source method Percept and Memory input maps.
use super::super::MemoryError;
use super::*;
use crate::bots::view::Features;
use rh_sim::{FactionId, Vec2, WeaponId};
use serde_json::Value;

fn missing(path: &str) -> MemoryError {
    MemoryError::Missing(path.to_string())
}
fn shape(path: &str) -> MemoryError {
    MemoryError::Shape(path.to_string())
}
fn field<'a>(v: &'a Value, key: &str, path: &str) -> Result<&'a Value, MemoryError> {
    v.get(key).ok_or_else(|| missing(&format!("{path}.{key}")))
}
fn num(v: &Value, key: &str, path: &str) -> Result<f64, MemoryError> {
    field(v, key, path)?
        .as_f64()
        .ok_or_else(|| shape(&format!("{path}.{key}")))
}
fn text(v: &Value, key: &str, path: &str) -> Result<String, MemoryError> {
    field(v, key, path)?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| shape(&format!("{path}.{key}")))
}
fn boolean(v: &Value, key: &str, path: &str) -> Result<bool, MemoryError> {
    field(v, key, path)?
        .as_bool()
        .ok_or_else(|| shape(&format!("{path}.{key}")))
}
fn optional_text(v: &Value, key: &str, path: &str) -> Result<Option<String>, MemoryError> {
    match field(v, key, path)? {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err(shape(&format!("{path}.{key}"))),
    }
}
fn faction_named(name: &str, path: &str) -> Result<FactionId, MemoryError> {
    FactionId::ALL
        .into_iter()
        .find(|f| f.as_str() == name)
        .ok_or_else(|| MemoryError::Unsupported(format!("{path}: faction {name}")))
}

fn faction_field(v: &Value, key: &str, path: &str) -> Result<FactionId, MemoryError> {
    faction_named(&text(v, key, path)?, &format!("{path}.{key}"))
}

fn optional_faction(v: &Value, path: &str) -> Result<Option<FactionId>, MemoryError> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => faction_named(s, path).map(Some),
        _ => Err(shape(path)),
    }
}
fn optional_weapon(v: &Value, path: &str) -> Result<Option<WeaponId>, MemoryError> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => WeaponId::ALL
            .into_iter()
            .find(|w| w.as_str() == s)
            .map(Some)
            .ok_or_else(|| MemoryError::Unsupported(format!("{path}: weapon {s}"))),
        _ => Err(shape(path)),
    }
}
fn at_point(v: &Value, path: &str) -> Result<Vec2, MemoryError> {
    Ok(Vec2::new(num(v, "x", path)?, num(v, "y", path)?))
}
fn optional_point(v: &Value) -> Result<Option<Vec2>, MemoryError> {
    match v {
        Value::Null => Ok(None),
        _ => Ok(Some(at_point(v, "at")?)),
    }
}

pub(crate) fn read_features(v: &Value, path: &str) -> Result<Features, MemoryError> {
    let obj = v.as_object().ok_or_else(|| shape(path))?;
    let want = [
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
    for key in want {
        if !obj.contains_key(key) {
            return Err(missing(&format!("{path}.{key}")));
        }
    }
    let types = v["messageTypes"]
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.messageTypes")))?;
    let mut message_types = Vec::with_capacity(types.len());
    for (i, t) in types.iter().enumerate() {
        message_types.push(
            t.as_str()
                .ok_or_else(|| shape(&format!("{path}.messageTypes[{i}]")))?
                .to_string(),
        );
    }
    Ok(Features {
        message_types,
        wishes: boolean(v, "wishes", path)?,
        status_effects: boolean(v, "statusEffects", path)?,
        fields: boolean(v, "fields", path)?,
        planning: boolean(v, "planning", path)?,
        chests: boolean(v, "chests", path)?,
        skills: boolean(v, "skills", path)?,
        relics: boolean(v, "relics", path)?,
        camps: boolean(v, "camps", path)?,
        hazards: boolean(v, "hazards", path)?,
    })
}

fn method_from_json(v: &Value, path: &str) -> Result<MethodValue, MemoryError> {
    match v {
        Value::Null => Ok(MethodValue::Null),
        Value::Bool(b) => Ok(MethodValue::Bool(*b)),
        Value::Number(n) => Ok(MethodValue::Num(n.as_f64().ok_or_else(|| shape(path))?)),
        Value::String(s) => Ok(MethodValue::Str(s.clone())),
        Value::Array(rows) => {
            let mut out = Vec::with_capacity(rows.len());
            for (i, row) in rows.iter().enumerate() {
                out.push(method_from_json(row, &format!("{path}[{i}]"))?);
            }
            Ok(MethodValue::Arr(out))
        }
        Value::Object(map) => {
            if map.contains_key("$rh") {
                if map.len() == 1 && map.get("$rh").and_then(Value::as_str) == Some("undefined") {
                    return Ok(MethodValue::Undefined);
                }
                return Err(MemoryError::Unsupported(format!(
                    "{path}: unsupported tagged value in method data"
                )));
            }
            let mut fields = Vec::with_capacity(map.len());
            for (key, member) in map {
                fields.push((
                    key.clone(),
                    method_from_json(member, &format!("{path}.{key}"))?,
                ));
            }
            Ok(MethodValue::Obj(fields))
        }
    }
}

fn read_event(v: &Value, path: &str) -> Result<PerceptEventRow, MemoryError> {
    Ok(PerceptEventRow {
        t: num(v, "t", path)?,
        at: match field(v, "at", path)? {
            Value::Null => None,
            at => Some(at_point(at, &format!("{path}.at"))?),
        },
        kind: match text(v, "kind", path)?.as_str() {
            "windup" => PerceptEvent::Windup {
                by: text(v, "by", path)?,
                weapon: optional_weapon(field(v, "weapon", path)?, &format!("{path}.weapon"))?
                    .ok_or_else(|| shape(&format!("{path}.weapon")))?,
                a: num(v, "a", path)?,
                ms: num(v, "ms", path)?,
            },
            "swing" => PerceptEvent::Swing {
                by: text(v, "by", path)?,
                weapon: optional_weapon(field(v, "weapon", path)?, &format!("{path}.weapon"))?
                    .ok_or_else(|| shape(&format!("{path}.weapon")))?,
                a: num(v, "a", path)?,
            },
            "hit" => PerceptEvent::Hit {
                id: text(v, "id", path)?,
                by: optional_text(v, "by", path)?,
                amount: num(v, "amount", path)?,
                weapon: optional_weapon(field(v, "weapon", path)?, &format!("{path}.weapon"))?,
            },
            "block" => PerceptEvent::Block {
                id: text(v, "id", path)?,
                by: optional_text(v, "by", path)?,
                weapon: optional_weapon(field(v, "weapon", path)?, &format!("{path}.weapon"))?,
            },
            "stagger" => PerceptEvent::Stagger {
                id: text(v, "id", path)?,
            },
            "cancel" => PerceptEvent::Cancel {
                id: text(v, "id", path)?,
            },
            "projEnd" => PerceptEvent::ProjEnd {
                id: text(v, "id", path)?,
            },
            "death" => PerceptEvent::Death {
                id: text(v, "id", path)?,
                name: text(v, "name", path)?,
                by: optional_text(v, "by", path)?,
                mob: boolean(v, "mob", path)?,
            },
            "heal" => PerceptEvent::Heal {
                id: text(v, "id", path)?,
            },
            "teleport" => PerceptEvent::Teleport,
            "bounty" => PerceptEvent::Bounty {
                id: text(v, "id", path)?,
                name: text(v, "name", path)?,
                bounty: num(v, "bounty", path)?,
            },
            "victory" => PerceptEvent::Victory {
                id: optional_text(v, "id", path)?,
                name: optional_text(v, "name", path)?,
                draw: boolean(v, "draw", path)?,
            },
            "toast" => PerceptEvent::Toast {
                text: text(v, "text", path)?,
            },
            "result" => PerceptEvent::Result,
            "private" => PerceptEvent::Private {
                type_: text(v, "type", path)?,
            },
            "ext" => {
                let data = field(v, "data", path)?;
                let _ = data
                    .as_object()
                    .ok_or_else(|| shape(&format!("{path}.data")))?;
                PerceptEvent::Ext {
                    fx: text(v, "fx", path)?,
                    data: method_from_json(data, &format!("{path}.data"))?,
                }
            }
            other => {
                return Err(MemoryError::Unsupported(format!(
                    "{path}.kind: unsupported observed event {other}"
                )))
            }
        },
    })
}

pub(crate) fn read_percept(v: &Value, path: &str) -> Result<MemoryPercept, MemoryError> {
    let self_v = field(v, "self", path)?;
    let p = format!("{path}.self");
    let fighters = field(v, "fighters", path)?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.fighters")))?
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let p = format!("{path}.fighters[{i}]");
            Ok(PerceptFighter {
                id: text(f, "id", &p)?,
                name: text(f, "name", &p)?,
                bot: boolean(f, "bot", &p)?,
                x: num(f, "x", &p)?,
                y: num(f, "y", &p)?,
                facing: num(f, "facing", &p)?,
                status: text(f, "status", &p)?,
                hp_frac: num(f, "hpFrac", &p)?,
                faction: optional_faction(field(f, "faction", &p)?, &format!("{p}.faction"))?,
                in_hand: optional_weapon(field(f, "inHand", &p)?, &format!("{p}.inHand"))?,
                draw_started_at: num(f, "drawStartedAt", &p)?,
                bounty: num(f, "bounty", &p)?,
                vx: num(f, "vx", &p)?,
                vy: num(f, "vy", &p)?,
            })
        })
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let mobs = field(v, "mobs", path)?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.mobs")))?
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let p = format!("{path}.mobs[{i}]");
            Ok(PerceptMob {
                id: text(m, "id", &p)?,
                kind: text(m, "kind", &p)?,
                name: text(m, "name", &p)?,
                type_: optional_text(m, "type", &p)?,
                faction: optional_faction(field(m, "faction", &p)?, &format!("{p}.faction"))?,
                x: num(m, "x", &p)?,
                y: num(m, "y", &p)?,
                status: text(m, "status", &p)?,
                hp_frac: num(m, "hpFrac", &p)?,
                in_hand: optional_weapon(field(m, "inHand", &p)?, &format!("{p}.inHand"))?,
            })
        })
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let containers = field(v, "containers", path)?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.containers")))?
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let p = format!("{path}.containers[{i}]");
            let weapon = field(c, "weapon", &p)?;
            let weapon = match weapon {
                Value::Null => PerceptWeapon::Null,
                Value::Object(map)
                    if map.len() == 1
                        && map.get("$rh").and_then(Value::as_str) == Some("undefined") =>
                {
                    PerceptWeapon::Undefined
                }
                _ => PerceptWeapon::Weapon(
                    optional_weapon(weapon, &format!("{p}.weapon"))?
                        .ok_or_else(|| shape(&format!("{p}.weapon")))?,
                ),
            };
            Ok(PerceptContainer {
                id: text(c, "id", &p)?,
                kind: text(c, "kind", &p)?,
                x: num(c, "x", &p)?,
                y: num(c, "y", &p)?,
                closed: boolean(c, "closed", &p)?,
                weapon,
            })
        })
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let projectiles = field(v, "projectiles", path)?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.projectiles")))?
        .iter()
        .enumerate()
        .map(|(i, pr)| {
            let p = format!("{path}.projectiles[{i}]");
            Ok(PerceptProjectile {
                id: text(pr, "id", &p)?,
                kind: text(pr, "kind", &p)?,
                x: num(pr, "x", &p)?,
                y: num(pr, "y", &p)?,
                vx: num(pr, "vx", &p)?,
                vy: num(pr, "vy", &p)?,
                x0: num(pr, "x0", &p)?,
                y0: num(pr, "y0", &p)?,
                t0: num(pr, "t0", &p)?,
                range: num(pr, "range", &p)?,
                from: optional_text(pr, "from", &p)?,
            })
        })
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let minimap = field(v, "minimap", path)?;
    let minimap_mobs = field(minimap, "mobs", &format!("{path}.minimap"))?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.minimap.mobs")))?
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let p = format!("{path}.minimap.mobs[{i}]");
            Ok(PerceptMinimapMob {
                id: text(d, "id", &p)?,
                x: num(d, "x", &p)?,
                y: num(d, "y", &p)?,
                faction: optional_faction(field(d, "faction", &p)?, &format!("{p}.faction"))?,
                elite: boolean(d, "elite", &p)?,
            })
        })
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let events = field(v, "events", path)?
        .as_array()
        .ok_or_else(|| shape(&format!("{path}.events")))?
        .iter()
        .enumerate()
        .map(|(i, e)| read_event(e, &format!("{path}.events[{i}]")))
        .collect::<Result<Vec<_>, MemoryError>>()?;
    let extras_v = field(v, "extras", path)?;
    let extras_path = format!("{path}.extras");
    let mut extras = PerceptExtras::default();
    if let Some(camps) = extras_v.get("camps") {
        for (i, c) in camps
            .as_array()
            .ok_or_else(|| shape(&format!("{extras_path}.camps")))?
            .iter()
            .enumerate()
        {
            let p = format!("{extras_path}.camps[{i}]");
            let state = num(c, "state", &p)?;
            if !state.is_finite() || state.fract() != 0. || !(0.0..=2.0).contains(&state) {
                return Err(MemoryError::Unsupported(format!(
                    "{p}.state: {state} is not a source camp enum value"
                )));
            }
            extras.camps.push(PerceptCampView {
                id: text(c, "id", &p)?,
                state: state as u8,
            });
        }
    }
    if let Some(chests) = extras_v.get("chests") {
        for (i, c) in chests
            .as_array()
            .ok_or_else(|| shape(&format!("{extras_path}.chests")))?
            .iter()
            .enumerate()
        {
            let p = format!("{extras_path}.chests[{i}]");
            extras.chests.push(PerceptChest {
                id: text(c, "id", &p)?,
                x: num(c, "x", &p)?,
                y: num(c, "y", &p)?,
                picked: boolean(c, "picked", &p)?,
            });
        }
    }
    if let Some(plan) = extras_v.get("plan") {
        if !plan.is_null() {
            extras.plan = Some(PerceptPlan {
                ends_at: num(plan, "endsAt", &format!("{extras_path}.plan"))?,
            });
        }
    }
    let hud = field(v, "hud", path)?;
    Ok(MemoryPercept {
        now: num(v, "now", path)?,
        view_t: num(v, "viewT", path)?,
        self_: PerceptSelf {
            id: text(self_v, "id", &p)?,
            name: text(self_v, "name", &p)?,
            x: num(self_v, "x", &p)?,
            y: num(self_v, "y", &p)?,
            facing: num(self_v, "facing", &p)?,
            status: text(self_v, "status", &p)?,
            hp: num(self_v, "hp", &p)?,
            max_hp: num(self_v, "maxHp", &p)?,
            attack_target: optional_text(self_v, "attackTarget", &p)?,
            move_seq: num(self_v, "moveSeq", &p)?,
        },
        hud_in_coliseum: boolean(hud, "inColiseum", &format!("{path}.hud"))?,
        fighters,
        mobs,
        containers,
        projectiles,
        minimap: PerceptMinimap {
            t: num(minimap, "t", &format!("{path}.minimap"))?,
            mobs: minimap_mobs,
        },
        events,
        extras,
        features: read_features(field(v, "features", path)?, &format!("{path}.features"))?,
    })
}

pub(crate) fn read_game_map(v: &Value, path: &str) -> Result<super::super::MemoryMap, MemoryError> {
    let mut camps: Vec<super::super::CampGeom> = Vec::new();
    if let Some(list) = v.get("camps").and_then(Value::as_array) {
        if !list.is_empty() {
            for (i, c) in list.iter().enumerate() {
                let p = format!("{path}.camps[{i}]");
                let r = num(c, "r", &p)?;
                let radius = num(c, "radius", &p)?;
                camps.push(super::super::CampGeom {
                    id: text(c, "id", &p)?,
                    zone: faction_field(c, "zone", &p)?,
                    elite: num(c, "eliteSpot", &p)? >= 0.,
                    x: num(c, "x", &p)?,
                    y: num(c, "y", &p)?,
                    radius: if radius > 0. { radius } else { r },
                    spots: c["spots"]
                        .as_array()
                        .ok_or_else(|| shape(&format!("{p}.spots")))?
                        .iter()
                        .enumerate()
                        .map(|(j, s)| at_point(s, &format!("{p}.spots[{j}]")))
                        .collect::<Result<Vec<_>, MemoryError>>()?,
                });
            }
            return Ok(super::super::MemoryMap { camps });
        }
    }
    if let Some(regions) = v.get("regions").and_then(Value::as_array) {
        for (i, r) in regions.iter().enumerate() {
            let mob_camps = r
                .get("mobCamps")
                .and_then(Value::as_array)
                .ok_or_else(|| shape(&format!("{path}.regions[{i}].mobCamps")))?;
            for (j, c) in mob_camps.iter().enumerate() {
                let p = format!("{path}.regions[{i}].mobCamps[{j}]");
                camps.push(super::super::CampGeom {
                    id: text(c, "id", &p)?,
                    zone: faction_field(c, "region", &p)?,
                    elite: boolean(c, "elite", &p)?,
                    x: num(c, "x", &p)?,
                    y: num(c, "y", &p)?,
                    radius: rh_sim::constants::MOB_LEASH_RADIUS,
                    spots: c["spots"]
                        .as_array()
                        .ok_or_else(|| shape(&format!("{p}.spots")))?
                        .iter()
                        .enumerate()
                        .map(|(k, s)| at_point(s, &format!("{p}.spots[{k}]")))
                        .collect::<Result<Vec<_>, MemoryError>>()?,
                });
            }
        }
        return Ok(super::super::MemoryMap { camps });
    }
    Err(MemoryError::Unsupported(format!(
        "{path}: no camps/regions"
    )))
}

pub(crate) fn read_npc_declared_map(
    v: &Value,
    path: &str,
) -> Result<super::super::MemoryMap, MemoryError> {
    let c = v
        .get("camp")
        .ok_or_else(|| missing(&format!("{path}.camp")))?;
    let p = format!("{path}.camp");
    let r = num(c, "r", &p)?;
    let radius = num(c, "radius", &p)?;
    Ok(super::super::MemoryMap {
        camps: vec![super::super::CampGeom {
            id: text(c, "id", &p)?,
            zone: faction_field(c, "zone", &p)?,
            elite: num(c, "eliteSpot", &p)? >= 0.,
            x: num(c, "x", &p)?,
            y: num(c, "y", &p)?,
            radius: if radius > 0. { radius } else { r },
            spots: c["spots"]
                .as_array()
                .ok_or_else(|| shape(&format!("{p}.spots")))?
                .iter()
                .enumerate()
                .map(|(j, s)| at_point(s, &format!("{p}.spots[{j}]")))
                .collect::<Result<Vec<_>, MemoryError>>()?,
        }],
    })
}
