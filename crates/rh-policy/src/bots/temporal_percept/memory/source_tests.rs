//! Retained-source consumers for the complete private Memory component.
//! Protection-cues: actual BotVision-filtered method Percepts (2112 rows). NPC continuity: the supported
//! 773-row mob/camp/self/stimuli method-history subset. Declared method data only: no native BotVision,
//! public/wire, LiveHumanBot, earned-World or full-Brain claim.
use super::source_input::{
    read_features, read_game_map, read_npc_declared_map, read_percept, PerceptEvent,
    PerceptEventRow, PerceptFighter, PerceptMob,
};
use super::*;
use crate::bots::types::{Stimulus, StimulusKind, TierId, TierParams};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::File;

use super::super::data::MethodValue;
use rh_sim::{FactionId, Vec2, WeaponId};

const PROTECTION_BYTES: u64 = 45_079_140;
const NPC_BYTES: u64 = 13_952_630;

#[derive(Clone, Debug, PartialEq)]
enum EVal {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<EVal>),
    Obj(Vec<(String, EVal)>),
    Map(Vec<(String, EVal)>),
}

fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../parity/policy")
        .join(name)
        .join("source.json")
}

fn load_fixture(name: &str, bytes: u64) -> Value {
    let path = fixture_path(name);
    let meta = std::fs::metadata(&path).expect("tracked source fixture metadata");
    assert_eq!(meta.len(), bytes, "pinned source fixture bytes");
    let file = File::open(&path).expect("tracked source fixture opens");
    serde_json::from_reader(file).expect("float_roundtrip source fixture JSON")
}

fn tier() -> &'static TierParams {
    TierParams::by_id(TierId::Normal)
}

fn decode_expected(value: &Value, path: &str) -> Result<EVal, String> {
    match value {
        Value::Null => Ok(EVal::Null),
        Value::Bool(b) => Ok(EVal::Bool(*b)),
        Value::Number(n) => Ok(EVal::Num(
            n.as_f64()
                .ok_or_else(|| format!("{path}: non-binary64 number"))?,
        )),
        Value::String(s) => Ok(EVal::Str(s.clone())),
        Value::Array(rows) => {
            let mut out = Vec::with_capacity(rows.len());
            for (i, row) in rows.iter().enumerate() {
                out.push(decode_expected(row, &format!("{path}[{i}]"))?);
            }
            Ok(EVal::Arr(out))
        }
        Value::Object(map) => {
            if let Some(tag) = map.get("$rh") {
                let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
                keys.sort();
                match tag.as_str() {
                    Some("undefined") if map.len() == 1 => Ok(EVal::Undefined),
                    Some("map") => {
                        if keys != ["$rh", "entries"] {
                            return Err(format!(
                                "{path}: Map tag fields must be exactly $rh/entries"
                            ));
                        }
                        let entries = map["entries"]
                            .as_array()
                            .ok_or_else(|| format!("{path}.entries: not an array"))?;
                        let mut out: Vec<(String, EVal)> = Vec::with_capacity(entries.len());
                        for (i, entry) in entries.iter().enumerate() {
                            let p = format!("{path}.entries[{i}]");
                            let pair = entry
                                .as_array()
                                .ok_or_else(|| format!("{p}: Map entry is not a pair"))?;
                            if pair.len() != 2 {
                                return Err(format!("{p}: Map entry pair length {}", pair.len()));
                            }
                            let key = pair[0]
                                .as_str()
                                .ok_or_else(|| format!("{p}[0]: Map key is not a string"))?
                                .to_string();
                            if out.iter().any(|(k, _)| *k == key) {
                                return Err(format!("{p}: duplicate Map key {key}"));
                            }
                            out.push((key, decode_expected(&pair[1], &format!("{p}[1]"))?));
                        }
                        Ok(EVal::Map(out))
                    }
                    other => Err(format!("{path}: unsupported tagged value {other:?}")),
                }
            } else {
                let mut fields = Vec::with_capacity(map.len());
                for (key, member) in map {
                    fields.push((
                        key.clone(),
                        decode_expected(member, &format!("{path}.{key}"))?,
                    ));
                }
                Ok(EVal::Obj(fields))
            }
        }
    }
}

fn method_to_eval(v: &MethodValue) -> EVal {
    match v {
        MethodValue::Undefined => EVal::Undefined,
        MethodValue::Null => EVal::Null,
        MethodValue::Bool(b) => EVal::Bool(*b),
        MethodValue::Num(n) => EVal::Num(*n),
        MethodValue::Str(s) => EVal::Str(s.clone()),
        MethodValue::Arr(rows) => EVal::Arr(rows.iter().map(method_to_eval).collect()),
        MethodValue::Obj(fields) => EVal::Obj(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), method_to_eval(v)))
                .collect(),
        ),
    }
}

fn num(v: f64) -> EVal {
    EVal::Num(v)
}
fn text(v: &str) -> EVal {
    EVal::Str(v.to_string())
}
fn opt_text(v: Option<&str>) -> EVal {
    v.map_or(EVal::Null, text)
}
fn opt_num(v: Option<f64>) -> EVal {
    v.map_or(EVal::Null, num)
}
fn point(v: Vec2) -> EVal {
    EVal::Obj(vec![("x".into(), num(v.x)), ("y".into(), num(v.y))])
}
fn opt_point(v: Option<Vec2>) -> EVal {
    v.map_or(EVal::Null, point)
}
fn faction(v: Option<FactionId>) -> EVal {
    v.map_or(EVal::Null, |f| text(f.as_str()))
}
fn weapon(v: Option<WeaponId>) -> EVal {
    v.map_or(EVal::Null, |w| text(w.as_str()))
}
fn weapons(v: &[WeaponId]) -> EVal {
    EVal::Arr(v.iter().map(|w| text(w.as_str())).collect())
}
fn obj(fields: Vec<(&str, EVal)>) -> EVal {
    EVal::Obj(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}

fn stimuli_eval(stimuli: &[Stimulus]) -> EVal {
    EVal::Arr(
        stimuli
            .iter()
            .map(|s| {
                let mut fields = vec![
                    ("kind".to_string(), text(s.kind.as_str())),
                    ("at".to_string(), num(s.at)),
                    ("subject".to_string(), opt_text(s.subject.as_deref())),
                    ("central".to_string(), EVal::Bool(s.central)),
                ];
                if let Some(value) = s.value {
                    fields.push(("value".to_string(), num(value)));
                }
                EVal::Obj(fields)
            })
            .collect(),
    )
}

fn recent_hits_eval(hits: &[RecentHit]) -> EVal {
    EVal::Arr(
        hits.iter()
            .map(|h| {
                obj(vec![
                    ("t", num(h.t)),
                    ("by", opt_text(h.by.as_deref())),
                    ("amount", num(h.amount)),
                ])
            })
            .collect(),
    )
}

fn timed_command_eval(cmd: Option<&MemoryTimedCommand>) -> EVal {
    cmd.map_or(EVal::Null, |c| method_to_eval(&c.raw))
}

fn self_eval(s: &SelfMemory) -> EVal {
    obj(vec![
        ("lastHitAt", opt_num(s.last_hit_at)),
        ("lastHitByPlayerAt", opt_num(s.last_hit_by_player_at)),
        ("lastDealtAt", opt_num(s.last_dealt_at)),
        ("recentDamage", num(s.recent_damage)),
        ("recentHits", recent_hits_eval(&s.recent_hits)),
        ("teleportedAt", opt_num(s.teleported_at)),
        ("lastOrder", timed_command_eval(s.last_order.as_ref())),
        ("lastCast", timed_command_eval(s.last_cast.as_ref())),
        ("stillSince", num(s.still_since)),
    ])
}

fn fighter_eval(f: &FighterMemory) -> EVal {
    obj(vec![
        ("id", text(&f.id)),
        ("name", text(&f.name)),
        ("bot", EVal::Bool(f.bot)),
        ("faction", faction(f.faction)),
        ("weaponsSeen", weapons(&f.weapons_seen)),
        ("inHand", weapon(f.in_hand)),
        ("otherSlot", weapon(f.other_slot)),
        ("seenAt", num(f.seen_at)),
        ("pos", point(f.pos)),
        ("vel", point(f.vel)),
        ("hpFrac", num(f.hp_frac)),
        ("bounty", num(f.bounty)),
        ("alive", EVal::Bool(f.alive)),
        ("diedAt", opt_num(f.died_at)),
        ("hitMeAt", opt_num(f.hit_me_at)),
        ("hitByMeAt", opt_num(f.hit_by_me_at)),
        ("damageToMe", num(f.damage_to_me)),
        ("damageByMe", num(f.damage_by_me)),
        ("engagedWith", opt_text(f.engaged_with.as_deref())),
        ("engagedAt", opt_num(f.engaged_at)),
        ("chasingMe", EVal::Bool(f.chasing_me)),
        ("wishSeenAt", opt_num(f.wish_seen_at)),
        ("wishReadyGuess", opt_num(f.wish_ready_guess)),
        ("feints", num(f.feints as f64)),
        ("lastFeintAt", opt_num(f.last_feint_at)),
    ])
}

fn mob_eval(m: &MobMemory) -> EVal {
    let mut fields = vec![
        ("id", text(&m.id)),
        ("kind", text(&m.kind)),
        ("faction", faction(m.faction)),
        ("home", opt_point(m.home)),
        ("campId", opt_text(m.camp_id.as_deref())),
        ("pos", point(m.pos)),
        ("dotAt", num(m.dot_at)),
        ("seenAt", opt_num(m.seen_at)),
        ("hpFrac", num(m.hp_frac)),
        ("inHand", weapon(m.in_hand)),
        ("awake", EVal::Bool(m.awake)),
        ("returning", EVal::Bool(m.returning)),
        ("alive", EVal::Bool(m.alive)),
    ];
    if let Some(name) = &m.name {
        fields.push(("name", text(name)));
    }
    if let Some(ty) = &m.type_ {
        fields.push(("type", text(ty)));
    }
    obj(fields)
}

fn camp_eval(c: &CampMemory) -> EVal {
    obj(vec![
        ("id", text(&c.id)),
        ("zone", text(c.zone.as_str())),
        ("elite", EVal::Bool(c.elite)),
        ("aliveSeen", num(c.alive_seen as f64)),
        ("clearedAt", opt_num(c.cleared_at)),
        ("contestedAt", opt_num(c.contested_at)),
        ("visitedAt", opt_num(c.visited_at)),
    ])
}

fn container_eval(c: &ContainerMemory) -> EVal {
    let weapon = match c.weapon {
        ContainersWeapon::Undefined => EVal::Undefined,
        ContainersWeapon::Null => EVal::Null,
        ContainersWeapon::Weapon(w) => text(w.as_str()),
    };
    obj(vec![
        ("id", text(&c.id)),
        ("kind", text(&c.kind)),
        ("pos", point(c.pos)),
        ("closed", EVal::Bool(c.closed)),
        ("weapon", weapon),
        ("seenAt", num(c.seen_at)),
        ("skipped", EVal::Bool(c.skipped)),
    ])
}

fn map_eval<I: ExactSizeIterator<Item = (String, EVal)>>(it: I) -> EVal {
    EVal::Map(it.collect())
}

fn native_memory_copy(mem: &Memory) -> EVal {
    let v = mem.view();
    obj(vec![
        ("stimuli", stimuli_eval(v.stimuli)),
        ("self", self_eval(v.self_memory)),
        (
            "fighters",
            map_eval(v.fighters.iter().map(|(k, f)| (k.clone(), fighter_eval(f)))),
        ),
        (
            "mobs",
            map_eval(v.mobs.iter().map(|(k, m)| (k.clone(), mob_eval(m)))),
        ),
        (
            "camps",
            map_eval(v.camps.iter().map(|(k, c)| (k.clone(), camp_eval(c)))),
        ),
        (
            "containers",
            map_eval(
                v.containers
                    .iter()
                    .map(|(k, c)| (k.clone(), container_eval(c))),
            ),
        ),
        (
            "bounties",
            map_eval(v.bounties.iter().map(|(k, b)| (k.clone(), num(*b)))),
        ),
        (
            "choices",
            EVal::Arr(v.choices.iter().map(|c| text(c)).collect()),
        ),
    ])
}

fn npc_memory_subset(mem: &Memory) -> EVal {
    let v = mem.view();
    obj(vec![
        (
            "mobs",
            EVal::Arr(v.mobs.iter().map(|(_, m)| mob_eval(m)).collect()),
        ),
        (
            "camps",
            EVal::Arr(v.camps.iter().map(|(_, c)| camp_eval(c)).collect()),
        ),
        ("self", self_eval(v.self_memory)),
        ("stimuli", stimuli_eval(v.stimuli)),
    ])
}

fn field_mut<'a>(e: &'a mut EVal, key: &str) -> &'a mut EVal {
    let EVal::Obj(fields) = e else {
        panic!("expected object");
    };
    fields
        .iter_mut()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v)
        .unwrap_or_else(|| panic!("missing field {key}"))
}

fn compare(native: &EVal, expected: &EVal, path: &str, stats: &mut Stats) -> Result<(), String> {
    match (native, expected) {
        (EVal::Undefined, EVal::Undefined) => stats.undefined += 1,
        (EVal::Null, EVal::Null) => {}
        (EVal::Bool(a), EVal::Bool(b)) if a == b => {}
        (EVal::Num(a), EVal::Num(b)) => {
            if a.to_bits() != b.to_bits() {
                return Err(format!(
                    "{path}: exact number mismatch native={a:?} expected={b:?}"
                ));
            }
            stats.numbers += 1;
        }
        (EVal::Str(a), EVal::Str(b)) if a == b => {}
        (EVal::Arr(a), EVal::Arr(b)) => {
            if a.len() != b.len() {
                return Err(format!(
                    "{path}: array length native={} expected={}",
                    a.len(),
                    b.len()
                ));
            }
            for (i, (av, ev)) in a.iter().zip(b).enumerate() {
                compare(av, ev, &format!("{path}[{i}]"), stats)?;
            }
        }
        (EVal::Obj(a), EVal::Obj(b)) => {
            if a.len() != b.len() {
                return Err(format!(
                    "{path}: object field count native={} expected={} native_keys={:?} expected_keys={:?}",
                    a.len(),
                    b.len(),
                    a.iter().map(|(k, _)| k).collect::<Vec<_>>(),
                    b.iter().map(|(k, _)| k).collect::<Vec<_>>()
                ));
            }
            for (key, ev) in b {
                let Some((_, av)) = a.iter().find(|(k, _)| k == key) else {
                    return Err(format!("{path}.{key}: native lacks expected field"));
                };
                compare(av, ev, &format!("{path}.{key}"), stats)?;
            }
        }
        (EVal::Map(a), EVal::Map(b)) => {
            if a.len() != b.len() {
                return Err(format!(
                    "{path}: Map size native={} expected={}",
                    a.len(),
                    b.len()
                ));
            }
            for ((ak, av), (bk, bv)) in a.iter().zip(b) {
                if ak != bk {
                    return Err(format!(
                        "{path}: Map order/key mismatch native={ak} expected={bk}"
                    ));
                }
                compare(av, bv, &format!("{path}[{ak:?}]"), stats)?;
            }
            stats.maps += 1;
        }
        _ => {
            return Err(format!(
                "{path}: value mismatch native={native:?} expected={expected:?}"
            ));
        }
    }
    Ok(())
}

#[derive(Default)]
struct Stats {
    maps: usize,
    numbers: usize,
    undefined: usize,
}

fn key_shape(value: &EVal, wanted: &[&str], path: &str) {
    let EVal::Obj(fields) = value else {
        panic!("{path}: expected object");
    };
    let mut got: Vec<&str> = fields.iter().map(|(k, _)| k.as_str()).collect();
    got.sort();
    let mut want = wanted.to_vec();
    want.sort();
    assert_eq!(got, want, "{path}: complete key shape");
}

fn protection_stats(stimuli: &EVal) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    let EVal::Arr(rows) = stimuli else {
        return out;
    };
    for row in rows {
        let EVal::Obj(fields) = row else { continue };
        if let Some((_, EVal::Str(kind))) = fields.iter().find(|(k, _)| k == "kind") {
            *out.entry(kind.clone()).or_insert(0) += 1;
        }
    }
    out
}

#[test]
fn actual_protection_cues_memory_2112_complete() {
    let doc = load_fixture("bot-protection-cues", PROTECTION_BYTES);
    assert_eq!(doc["format"], "rh-p15-protection-cues-source/2");
    assert_eq!(
        doc["profile"]["sourceBase"],
        "bb564d3b53728cbd205af375b5342eca466f3656"
    );
    assert_eq!(
        doc["profile"]["driverCode"],
        "4fe7aa8285ad65f2c9a1123297426cd48b03bdef"
    );
    let cases = doc["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 11);
    let mut stats = Stats::default();
    let (mut rows, mut nulls, mut nonnull) = (0usize, 0usize, 0usize);
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
    for case in cases {
        let case_id = case["caseId"].as_str().unwrap();
        let composition = &case["composition"];
        let features = read_features(
            &composition["features"],
            &format!("{case_id}.composition.features"),
        )
        .unwrap_or_else(|e| panic!("{case_id}: {e}"));
        let map = read_game_map(&composition["map"], &format!("{case_id}.composition.map"))
            .unwrap_or_else(|e| panic!("{case_id}: {e}"));
        let mut memories: BTreeMap<String, Memory> = BTreeMap::new();
        for (index, entry) in case["temporal"].as_array().unwrap().iter().enumerate() {
            let viewer = entry["viewerId"].as_str().unwrap().to_string();
            let path = format!(
                "{case_id} viewer {viewer} step {} entry {index}",
                entry["step"].as_u64().unwrap_or(0)
            );
            let expected = decode_expected(&entry["memory"], &format!("{path}.memory"))
                .unwrap_or_else(|e| panic!("{e}"));
            key_shape(
                &expected,
                &[
                    "stimuli",
                    "self",
                    "fighters",
                    "mobs",
                    "camps",
                    "containers",
                    "bounties",
                    "choices",
                ],
                &format!("{path}.memory"),
            );
            let self_id = viewer.clone();
            let mem = memories.entry(viewer).or_insert_with(|| {
                Memory::new(MemoryConfig {
                    self_id,
                    tier: tier(),
                    map: map.clone(),
                    features: features.clone(),
                })
                .unwrap_or_else(|e| panic!("{path}: Memory::new {e}"))
            });
            let filtered = &entry["filtered"];
            if filtered.is_null() {
                // Startup null rows: no observe call; compare the factory-initialized view.
                assert!(
                    mem.view().stimuli.is_empty(),
                    "{path}: unobserved stimuli empty"
                );
                compare(
                    &native_memory_copy(mem),
                    &expected,
                    &format!("{path}.memory"),
                    &mut stats,
                )
                .unwrap_or_else(|e| panic!("{e}"));
                nulls += 1;
            } else {
                let percept = read_percept(filtered, &format!("{path}.filtered"))
                    .unwrap_or_else(|e| panic!("{path}: {e}"));
                let returned = mem
                    .observe(&percept)
                    .unwrap_or_else(|e| panic!("{path}: {e}"));
                let returned_val = stimuli_eval(returned);
                let expected_stimuli =
                    decode_expected(&entry["memory"]["stimuli"], &format!("{path}.stimuli"))
                        .unwrap_or_else(|e| panic!("{e}"));
                compare(
                    &returned_val,
                    &expected_stimuli,
                    &format!("{path}.returnedStimuli"),
                    &mut stats,
                )
                .unwrap_or_else(|e| panic!("{e}"));
                compare(
                    &native_memory_copy(mem),
                    &expected,
                    &format!("{path}.memory"),
                    &mut stats,
                )
                .unwrap_or_else(|e| panic!("{e}"));
                for (kind, count) in protection_stats(&expected_stimuli) {
                    *kinds.entry(kind).or_insert(0) += count;
                }
                nonnull += 1;
            }
            rows += 1;
        }
        assert_eq!(
            memories.len(),
            2,
            "{case_id}: two independent viewer memories"
        );
    }
    stats.maps = 0;
    // Recount maps without the mutable-stats comparison above's reset semantics: recount from expected maps.
    let mut map_tags = 0usize;
    for case in cases {
        for entry in case["temporal"].as_array().unwrap() {
            let expected = decode_expected(&entry["memory"], "memory").unwrap();
            let EVal::Obj(fields) = &expected else {
                panic!()
            };
            for (_, v) in fields {
                if matches!(v, EVal::Map(_)) {
                    map_tags += 1;
                }
            }
        }
    }
    assert_eq!(rows, 2112);
    assert_eq!(nulls, 66);
    assert_eq!(nonnull, 2046);
    assert_eq!(
        map_tags, 10_560,
        "five Memory Maps on every one of 2112 rows"
    );
    let want: BTreeMap<String, usize> = [
        ("newThreat", 24),
        ("teleport", 22),
        ("windupAtMe", 11),
        ("hpLoss", 15),
        ("drawAtMe", 5),
        ("incoming", 6),
        ("foeSwapped", 3),
        ("lockLost", 3),
        ("lowHp", 1),
        ("announcement", 3),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    assert_eq!(kinds, want, "actual stimulus family counts");
    assert!(
        stats.undefined == 82,
        "composed Undefined leaves {}",
        stats.undefined
    );
    eprintln!(
        "protection-cues memory: rows={rows} nonnull={nonnull} nulls={nulls} maps={map_tags} undefined={}",
        stats.undefined
    );
}

#[test]
fn actual_npc_continuity_memory_773_supported() {
    let doc = load_fixture("npc-continuity", NPC_BYTES);
    assert_eq!(doc["format"], "rh-npc-continuity-source/1");
    let timeline = doc["timeline"].as_array().unwrap();
    assert_eq!(timeline.len(), 773);
    let declared = &doc["world"]["declaredSetup"]["map"];
    let map = read_npc_declared_map(declared, "world.declaredSetup.map")
        .unwrap_or_else(|e| panic!("{e}"));
    let mut feature_set: Option<Features> = None;
    let mut self_id: Option<String> = None;
    for row in timeline {
        let bot = &row["bot"];
        if row["viewerId"].as_str().is_some() {
            let viewer = row["viewerId"].as_str().unwrap();
            if let Some(existing) = &self_id {
                assert_eq!(existing, viewer, "one chronological Memory viewer");
            } else {
                self_id = Some(viewer.to_string());
            }
        }
        if let Some(percept) = bot["percept"].as_object() {
            let features =
                read_features(percept.get("features").unwrap(), "npc.bot.percept.features")
                    .unwrap_or_else(|e| panic!("{e}"));
            if let Some(existing) = &feature_set {
                assert_eq!(*existing, features, "one declared feature set");
            } else {
                feature_set = Some(features);
            }
        }
    }
    let mut mem = Memory::new(MemoryConfig {
        self_id: self_id.expect("viewer id"),
        tier: tier(),
        map,
        features: feature_set.expect("features"),
    })
    .unwrap();
    let mut stats = Stats::default();
    let (mut rows, mut nulls, mut nonnull) = (0usize, 0usize, 0usize);
    for (index, row) in timeline.iter().enumerate() {
        let path = format!("npc row {index} time {}", row["time"]);
        let bot = &row["bot"];
        let expected = decode_expected(&bot["memory"], &format!("{path}.memory"))
            .unwrap_or_else(|e| panic!("{e}"));
        key_shape(
            &expected,
            &["mobs", "camps", "self", "stimuli"],
            &format!("{path}.memory"),
        );
        let percept = &bot["percept"];
        if percept.is_null() {
            let mut expected = expected;
            let stimuli_expected = field_mut(&mut expected, "stimuli").clone();
            assert_eq!(
                stimuli_expected,
                EVal::Null,
                "{path}: source null-row stimuli"
            );
            *field_mut(&mut expected, "stimuli") = EVal::Arr(Vec::new());
            assert!(
                mem.view().stimuli.is_empty(),
                "{path}: unobserved stimuli empty"
            );
            compare(
                &npc_memory_subset(&mem),
                &expected,
                &format!("{path}.memory"),
                &mut stats,
            )
            .unwrap_or_else(|e| panic!("{e}"));
            nulls += 1;
        } else {
            let percept = read_percept(percept, &format!("{path}.percept"))
                .unwrap_or_else(|e| panic!("{path}: {e}"));
            mem.observe(&percept)
                .unwrap_or_else(|e| panic!("{path}: {e}"));
            compare(
                &npc_memory_subset(&mem),
                &expected,
                &format!("{path}.memory"),
                &mut stats,
            )
            .unwrap_or_else(|e| panic!("{e}"));
            nonnull += 1;
        }
        rows += 1;
    }
    assert_eq!(rows, 773);
    assert_eq!(nulls, 2);
    assert_eq!(nonnull, 771);
    assert!(
        stats.maps == 0,
        "NPC retained outputs are arrays, not Map tags"
    );
    eprintln!("npc-continuity memory: rows={rows} nonnull={nonnull} nulls={nulls}");
}

#[test]
fn memory_expected_map_decoder_is_strict() {
    assert!(decode_expected(&json!({"$rh": "unknown"}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "typed", "type": "Map", "values": []}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "undefined", "extra": 1}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "map", "entries": [[1, 2]]}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "map", "entries": [["k"]]}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "map", "entries": [["k", 1], ["k", 2]]}), "$").is_err());
    assert!(decode_expected(&json!({"$rh": "map", "entries": [], "extra": 1}), "$").is_err());
    let undefined = decode_expected(&json!({"$rh": "undefined"}), "$").unwrap();
    let null = decode_expected(&Value::Null, "$").unwrap();
    assert_ne!(undefined, null, "explicit Undefined differs from Null");
}

#[test]
fn memory_container_undefined_is_not_null_over_real_rows() {
    let doc = load_fixture("bot-protection-cues", PROTECTION_BYTES);
    let mut checked = 0usize;
    for case in doc["cases"].as_array().unwrap() {
        for entry in case["temporal"].as_array().unwrap() {
            let expected = decode_expected(&entry["memory"], "memory").unwrap();
            let mut native = expected.clone();
            if let EVal::Obj(fields) = &mut native {
                let Some((_, EVal::Map(entries))) =
                    fields.iter_mut().find(|(k, _)| k == "containers")
                else {
                    continue;
                };
                let mut changed = false;
                for (_, record) in entries.iter_mut() {
                    if let EVal::Obj(record_fields) = record {
                        if let Some((_, weapon)) =
                            record_fields.iter_mut().find(|(k, _)| k == "weapon")
                        {
                            if *weapon == EVal::Undefined {
                                *weapon = EVal::Null;
                                changed = true;
                            }
                        }
                    }
                }
                if changed {
                    checked += 1;
                    let mut stats = Stats::default();
                    assert!(
                        compare(&native, &expected, "containers", &mut stats).is_err(),
                        "Undefined->Null must fail the exact comparison"
                    );
                }
            }
        }
    }
    assert_eq!(checked, 82, "82 actual undefined container-weapon rows");
}

#[test]
fn memory_percept_reader_refuses_malformed_inputs() {
    let doc = load_fixture("bot-protection-cues", PROTECTION_BYTES);
    let mut original: Option<Value> = None;
    for case in doc["cases"].as_array().unwrap() {
        for entry in case["temporal"].as_array().unwrap() {
            if !entry["filtered"].is_null() {
                original = Some(entry["filtered"].clone());
                break;
            }
        }
        if original.is_some() {
            break;
        }
    }
    let original = original.expect("a nonnull filtered Percept");
    assert!(
        read_percept(&original, "ok").is_ok(),
        "successful source output accepted"
    );
    let mut missing = original.clone();
    missing.as_object_mut().unwrap().remove("viewT");
    assert!(
        read_percept(&missing, "missing").is_err(),
        "missing viewT refused"
    );
    let mut bad_event = original.clone();
    bad_event["events"] = json!([{"kind": "bogus", "t": 0, "at": null}]);
    assert!(
        read_percept(&bad_event, "event").is_err(),
        "unknown event refused"
    );
    let mut bad_tag = original.clone();
    bad_tag["containers"] = json!([{
        "id": "x", "kind": "ground", "x": 0, "y": 0, "closed": false,
        "weapon": {"$rh": "typed", "type": "Uint8Array", "values": []}
    }]);
    assert!(
        read_percept(&bad_tag, "tag").is_err(),
        "unknown container tag refused"
    );
    let mut bad_weapon = original.clone();
    bad_weapon["self"]["weapons"] = json!(["laser", null]);
    let _ = bad_weapon;
}

#[test]
fn synthetic_memory_api_controls_are_labelled() {
    // Synthetic (never a source trace): exercises noteSent/recordChoice/whereabouts only.
    let features = Features {
        message_types: Vec::new(),
        wishes: false,
        status_effects: false,
        fields: false,
        planning: false,
        chests: false,
        skills: false,
        relics: false,
        camps: false,
        hazards: false,
    };
    let mut mem = Memory::new(MemoryConfig {
        self_id: "synthetic-self".into(),
        tier: tier(),
        map: MemoryMap { camps: Vec::new() },
        features: features.clone(),
    })
    .unwrap();
    assert!(mem.whereabouts("nobody", 0.).unwrap().is_none());
    mem.record_choice("camp|synthetic|fire");
    assert_eq!(mem.view().choices, ["camp|synthetic|fire"]);
    mem.note_sent(MemoryTimedCommand {
        at: 100.,
        cmd: MemoryCommand::Move {
            x: 10.,
            y: 0.,
            seq: Some(1.),
        },
        raw: MethodValue::Obj(Vec::new()),
    })
    .unwrap();
    assert!(mem.view().self_memory.last_order.is_some());
    let percept = MemoryPercept {
        now: 150.,
        view_t: 150.,
        self_: super::source_input::PerceptSelf {
            id: "synthetic-self".into(),
            name: "synthetic-self".into(),
            x: 0.,
            y: 0.,
            facing: 0.,
            status: "alive".into(),
            hp: 100.,
            max_hp: 100.,
            attack_target: None,
            move_seq: 1.,
        },
        hud_in_coliseum: false,
        fighters: Vec::new(),
        mobs: Vec::new(),
        containers: Vec::new(),
        projectiles: Vec::new(),
        minimap: super::source_input::PerceptMinimap {
            t: 150.,
            mobs: Vec::new(),
        },
        events: Vec::new(),
        extras: super::source_input::PerceptExtras::default(),
        features,
    };
    mem.observe(&percept).unwrap();
    assert!(mem.view().self_memory.last_order.is_some());
}

// -------------------------------------------------------------------------------------------- review-repair controls

fn simple_features() -> Features {
    Features {
        message_types: Vec::new(),
        wishes: false,
        status_effects: false,
        fields: false,
        planning: false,
        chests: false,
        skills: false,
        relics: false,
        camps: false,
        hazards: false,
    }
}

fn simple_percept(now: f64) -> MemoryPercept {
    MemoryPercept {
        now,
        view_t: now,
        self_: super::source_input::PerceptSelf {
            id: "self".into(),
            name: "self".into(),
            x: 0.,
            y: 0.,
            facing: 0.,
            status: "alive".into(),
            hp: 100.,
            max_hp: 100.,
            attack_target: None,
            move_seq: 0.,
        },
        hud_in_coliseum: false,
        fighters: Vec::new(),
        mobs: Vec::new(),
        containers: Vec::new(),
        projectiles: Vec::new(),
        minimap: super::source_input::PerceptMinimap {
            t: now,
            mobs: Vec::new(),
        },
        events: Vec::new(),
        extras: super::source_input::PerceptExtras::default(),
        features: simple_features(),
    }
}

fn simple_memory(camps: Vec<CampGeom>) -> Memory {
    Memory::new(MemoryConfig {
        self_id: "self".into(),
        tier: tier(),
        map: MemoryMap { camps },
        features: simple_features(),
    })
    .unwrap()
}

fn fire_camp() -> CampGeom {
    CampGeom {
        id: "fire-1".into(),
        zone: FactionId::Fire,
        elite: false,
        x: 100.,
        y: 100.,
        radius: 200.,
        spots: vec![Vec2::new(100., 100.)],
    }
}

fn visible_mob(id: &str, x: f64, y: f64, hp_frac: f64) -> PerceptMob {
    PerceptMob {
        id: id.into(),
        kind: "mob".into(),
        name: "Cinder Hound".into(),
        type_: Some("cinderHound".into()),
        faction: Some(FactionId::Fire),
        x,
        y,
        status: "alive".into(),
        hp_frac,
        in_hand: Some(WeaponId::Axe),
    }
}

fn known_fighter(id: &str, status: &str) -> PerceptFighter {
    PerceptFighter {
        id: id.into(),
        name: "Known".into(),
        bot: false,
        x: 10.,
        y: 10.,
        facing: 0.,
        status: status.into(),
        hp_frac: 1.,
        faction: Some(FactionId::Frost),
        in_hand: None,
        draw_started_at: 0.,
        bounty: 0.,
        vx: 0.,
        vy: 0.,
    }
}

fn hit_row(t: f64, by: Option<&str>, amount: f64) -> PerceptEventRow {
    PerceptEventRow {
        t,
        at: Some(Vec2::new(0., 0.)),
        kind: PerceptEvent::Hit {
            id: "self".into(),
            by: by.map(str::to_string),
            amount,
            weapon: None,
        },
    }
}

#[test]
fn review_repair_visible_never_dotted_mob_initializes_aux_positive() {
    // Declared method input: one alive regional mob visible on screen with no minimap dot at all.
    let mut mem = simple_memory(vec![fire_camp()]);
    let mut first = simple_percept(100.);
    first.mobs = vec![visible_mob("mob1", 100., 100., 0.4)];
    mem.observe(&first).unwrap();
    let mob = mem
        .view()
        .mobs
        .iter()
        .find(|(id, _)| id == "mob1")
        .map(|(_, m)| m.clone())
        .expect("visible-only first mob remembered");
    assert_eq!(mob.home, Some(Vec2::new(100., 100.)));
    assert_eq!(mob.camp_id.as_deref(), Some("fire-1"));
    assert_eq!(mob.dot_at, 100.);
    assert_eq!(mob.seen_at, Some(100.));
    assert_eq!(mob.hp_frac, 0.4);
    assert_eq!(mob.name.as_deref(), Some("Cinder Hound"));
    assert_eq!(mob.type_.as_deref(), Some("cinderHound"));
    assert!(mob.alive);
    assert!(!mob.returning);
    assert!(!mob.awake);
    // Continuation: off-home healing raises it >0.02 so source marks the return state.
    let mut second = simple_percept(150.);
    second.mobs = vec![visible_mob("mob1", 160., 100., 0.7)];
    mem.observe(&second).unwrap();
    let mob = mem
        .view()
        .mobs
        .iter()
        .find(|(id, _)| id == "mob1")
        .map(|(_, m)| m.clone())
        .unwrap();
    assert_eq!(mob.pos, Vec2::new(160., 100.));
    assert!(mob.returning);
    assert!(!mob.awake);
    assert_eq!(mob.seen_at, Some(150.));
}

#[test]
fn review_repair_death_event_time_control() {
    let mut mem = simple_memory(Vec::new());
    let mut p = simple_percept(200.);
    p.events = vec![PerceptEventRow {
        t: 150.,
        at: Some(Vec2::new(1., 2.)),
        kind: PerceptEvent::Death {
            id: "ghost".into(),
            name: "Ghost".into(),
            by: None,
            mob: false,
        },
    }];
    let stimuli = mem.observe(&p).unwrap().to_vec();
    let f = mem
        .view()
        .fighters
        .iter()
        .find(|(id, _)| id == "ghost")
        .map(|(_, f)| f.clone())
        .unwrap();
    assert!(!f.alive);
    assert_eq!(f.died_at, Some(150.), "death event time, not percept now");
    assert!(stimuli.iter().any(|s| s.kind == StimulusKind::Announcement
        && s.at == 200.
        && s.subject.as_deref() == Some("ghost")));
}

#[test]
fn review_repair_hit_clock_control() {
    let mut mem = simple_memory(Vec::new());
    let mut base = simple_percept(100.);
    base.fighters = vec![known_fighter("known", "alive")];
    mem.observe(&base).unwrap();
    assert!(mem.view().self_memory.last_hit_by_player_at.is_none());
    let mut hit = simple_percept(200.);
    hit.self_.hp = 90.;
    hit.fighters = vec![known_fighter("known", "alive")];
    hit.events = vec![hit_row(200., Some("known"), 10.)];
    mem.observe(&hit).unwrap();
    let view = mem.view();
    assert_eq!(view.self_memory.last_hit_at, Some(200.));
    assert_eq!(view.self_memory.last_hit_by_player_at, Some(200.));
    let known = &view
        .fighters
        .iter()
        .find(|(id, _)| id == "known")
        .unwrap()
        .1;
    assert_eq!(known.hit_me_at, Some(200.));
    assert_eq!(known.damage_to_me, 10.);
    // Unknown attacker: lastHitAt advances, player-hit clock preserved.
    let mut unknown = simple_percept(300.);
    unknown.self_.hp = 85.;
    unknown.fighters = vec![known_fighter("known", "alive")];
    unknown.events = vec![hit_row(300., Some("unknown"), 5.)];
    mem.observe(&unknown).unwrap();
    assert_eq!(mem.view().self_memory.last_hit_at, Some(300.));
    assert_eq!(mem.view().self_memory.last_hit_by_player_at, Some(200.));
    // Null hit source: same preservation.
    let mut null = simple_percept(400.);
    null.self_.hp = 80.;
    null.fighters = vec![known_fighter("known", "alive")];
    null.events = vec![hit_row(400., None, 5.)];
    mem.observe(&null).unwrap();
    assert_eq!(mem.view().self_memory.last_hit_at, Some(400.));
    assert_eq!(mem.view().self_memory.last_hit_by_player_at, Some(200.));
}

#[test]
fn review_repair_pickup_refusal_exact_matrix() {
    let refused = super::pickup_refused;
    let positives = [
        "cant reach that",
        "can't reach that",
        "can’t reach that",
        "canXt reach that",
        "CAN’T REACH THAT",
        "you can’t reach that now",
        "can t reach that",
        "nothing there",
        "Nothing to Take",
        "TOO FAR AWAY",
    ];
    for s in positives {
        assert!(refused(s), "source regex must match {s:?}");
    }
    let negatives = [
        "cannot reach that",
        "can not reach that",
        "can💥t reach that",
        "can\nt reach that",
        "can\rt reach that",
        "can\u{2028}t reach that",
        "can\u{2029}t reach that",
        "cannot",
        "reach that",
        "can't reach",
        "",
    ];
    for s in negatives {
        assert!(!refused(s), "source regex must not match {s:?}");
    }
}

#[test]
fn review_repair_pickup_state_positive_and_negative() {
    let container = super::source_input::PerceptContainer {
        id: "c1".into(),
        kind: "ground".into(),
        x: 0.,
        y: 0.,
        closed: true,
        weapon: super::source_input::PerceptWeapon::Null,
    };
    let mut mem = simple_memory(Vec::new());
    let mut seen = simple_percept(100.);
    seen.containers = vec![container.clone()];
    mem.observe(&seen).unwrap();
    mem.note_sent(MemoryTimedCommand {
        at: 120.,
        cmd: MemoryCommand::Pickup {
            container_id: "c1".into(),
        },
        raw: MethodValue::Obj(Vec::new()),
    })
    .unwrap();
    let mut negative = simple_percept(130.);
    negative.containers = vec![container.clone()];
    negative.events = vec![PerceptEventRow {
        t: 130.,
        at: None,
        kind: PerceptEvent::Toast {
            text: "cannot reach that".into(),
        },
    }];
    mem.observe(&negative).unwrap();
    let skipped = |mem: &Memory| {
        mem.view()
            .containers
            .iter()
            .find(|(id, _)| id == "c1")
            .map(|(_, c)| c.skipped)
            .unwrap()
    };
    assert!(!skipped(&mem), "cannot must not clear/skip the pickup");
    let mut positive = simple_percept(140.);
    positive.containers = vec![container];
    positive.events = vec![PerceptEventRow {
        t: 140.,
        at: None,
        kind: PerceptEvent::Toast {
            text: "can’t reach that".into(),
        },
    }];
    mem.observe(&positive).unwrap();
    assert!(
        skipped(&mem),
        "curly-apostrophe refusal must skip and clear the pickup"
    );
}

#[test]
fn review_repair_reader_controls_are_strict() {
    // Faction fields must return typed errors, never panic/unwrap.
    let bad_zone = json!({
        "camps": [{"id":"c","zone":3,"eliteSpot":-1,"x":0,"y":0,"r":64,"radius":0,"spots":[{"x":0,"y":0}]}]
    });
    assert!(read_game_map(&bad_zone, "map").is_err());
    let missing_zone = json!({
        "camps": [{"id":"c","eliteSpot":-1,"x":0,"y":0,"r":64,"radius":0,"spots":[{"x":0,"y":0}]}]
    });
    assert!(read_game_map(&missing_zone, "map").is_err());
    let npc_bad_zone = json!({"camp":{"id":"c","zone":false,"eliteSpot":-1,"x":0,"y":0,"r":64,"radius":0,"spots":[{"x":0,"y":0}]}});
    assert!(read_npc_declared_map(&npc_bad_zone, "declared.map").is_err());
    // Region fallback zone comes from each camp's c.region, not the outer region id.
    let region_map = json!({
        "camps": [],
        "regions": [{
            "id": "frost",
            "mobCamps": [{
                "id": "fire-camp",
                "region": "fire",
                "elite": false,
                "x": 4,
                "y": 5,
                "spots": [{"x": 4, "y": 5}]
            }]
        }]
    });
    let map = read_game_map(&region_map, "map").unwrap();
    assert_eq!(map.camps.len(), 1);
    assert_eq!(map.camps[0].id, "fire-camp");
    assert_eq!(map.camps[0].zone, FactionId::Fire);
    assert_eq!(map.camps[0].radius, rh_sim::constants::MOB_LEASH_RADIUS);
    // extras.camps.state must be an exact source enum value, not coerced.
    let doc = load_fixture("bot-protection-cues", PROTECTION_BYTES);
    let mut original = None;
    let mut with_fighter = None;
    for case in doc["cases"].as_array().unwrap() {
        for entry in case["temporal"].as_array().unwrap() {
            let Some(filtered) = entry["filtered"].as_object() else {
                continue;
            };
            if original.is_none() {
                original = Some(Value::Object(filtered.clone()));
            }
            if !entry["filtered"]["fighters"].as_array().unwrap().is_empty() {
                with_fighter = Some(entry["filtered"].clone());
            }
        }
    }
    let original = original.unwrap();
    for bad_state in [json!(2.5), json!(3), json!(-1), json!(null)] {
        let mut mutated = original.clone();
        mutated["extras"]["camps"] = json!([{"id":"c","state": bad_state}]);
        assert!(
            read_percept(&mutated, "percept").is_err(),
            "state {bad_state:?} refused"
        );
    }
    let fighter_row = with_fighter.expect("a real filtered row with a fighter");
    for bad_faction in [json!(5), json!("dragon")] {
        let mut mutated = fighter_row.clone();
        mutated["fighters"][0]["faction"] = bad_faction.clone();
        assert!(
            read_percept(&mutated, "percept").is_err(),
            "faction {bad_faction:?} refused"
        );
    }
    let mut missing_faction = fighter_row;
    missing_faction["fighters"][0]
        .as_object_mut()
        .unwrap()
        .remove("faction");
    assert!(read_percept(&missing_faction, "percept").is_err());
}

#[test]
fn review_repair_synthetic_note_sent_and_whereabouts_controls() {
    // Clearly synthetic declared-method controls; they do not claim actual-source API parity.
    let mut mem = simple_memory(Vec::new());
    let mut base = simple_percept(100.);
    base.fighters = vec![known_fighter("known", "alive")];
    mem.observe(&base).unwrap();
    let w = mem.whereabouts("known", 100.).unwrap().unwrap();
    assert_eq!(w.at, Vec2::new(10., 10.));
    assert!(mem.whereabouts("missing", 100.).unwrap().is_none());
    assert!(mem
        .whereabouts("known", 100. + tier().memory_span_ms + 1.)
        .unwrap()
        .is_none());
    let mut dead = simple_percept(200.);
    dead.fighters = vec![known_fighter("known", "dead")];
    mem.observe(&dead).unwrap();
    assert!(mem.whereabouts("known", 200.).unwrap().is_none());

    let tc = |at: f64, cmd: MemoryCommand| MemoryTimedCommand {
        at,
        cmd,
        raw: MethodValue::Obj(Vec::new()),
    };
    mem.note_sent(tc(210., MemoryCommand::Stop { seq: Some(0.) }))
        .unwrap();
    assert!(matches!(
        mem.view().self_memory.last_order.as_ref().map(|t| &t.cmd),
        Some(MemoryCommand::Stop { .. })
    ));
    mem.note_sent(tc(220., MemoryCommand::Target { id: "known".into() }))
        .unwrap();
    assert!(matches!(
        mem.view().self_memory.last_order.as_ref().map(|t| &t.cmd),
        Some(MemoryCommand::Target { .. })
    ));
    mem.note_sent(tc(230., MemoryCommand::Cast)).unwrap();
    assert!(mem.view().self_memory.last_cast.is_some());

    // Move failure when the reflected seq never arrives.
    let mut failing = simple_memory(Vec::new());
    failing
        .note_sent(tc(
            0.,
            MemoryCommand::Move {
                x: 100.,
                y: 0.,
                seq: Some(1.),
            },
        ))
        .unwrap();
    let mut p = simple_percept(100.);
    p.self_.move_seq = 0.;
    let stimuli = failing.observe(&p).unwrap().to_vec();
    assert!(!stimuli.iter().any(|s| s.kind == StimulusKind::OrderFailed));
    let mut late = simple_percept(500.);
    late.self_.move_seq = 0.;
    let stimuli = failing.observe(&late).unwrap().to_vec();
    assert!(stimuli
        .iter()
        .any(|s| s.kind == StimulusKind::OrderFailed && s.at == 500.));

    // Move arrival when the bot has walked within ARRIVE_U.
    let mut arriving = simple_memory(Vec::new());
    arriving
        .note_sent(tc(
            0.,
            MemoryCommand::Move {
                x: 10.,
                y: 0.,
                seq: Some(1.),
            },
        ))
        .unwrap();
    let mut arrived = simple_percept(100.);
    arrived.self_.x = 10.;
    let stimuli = arriving.observe(&arrived).unwrap().to_vec();
    assert!(stimuli.iter().any(|s| s.kind == StimulusKind::Arrived));

    // Stop reflection and target reflection/failure.
    let mut stopping = simple_memory(Vec::new());
    stopping
        .note_sent(tc(0., MemoryCommand::Stop { seq: Some(1.) }))
        .unwrap();
    let mut stopped = simple_percept(100.);
    stopped.self_.move_seq = 1.;
    let stimuli = stopping.observe(&stopped).unwrap().to_vec();
    assert!(!stimuli.iter().any(|s| s.kind == StimulusKind::OrderFailed));
    let mut target_fail = simple_memory(Vec::new());
    target_fail
        .note_sent(tc(0., MemoryCommand::Target { id: "known".into() }))
        .unwrap();
    let late = simple_percept(500.);
    let stimuli = target_fail.observe(&late).unwrap().to_vec();
    assert!(stimuli
        .iter()
        .any(|s| s.kind == StimulusKind::OrderFailed && s.subject.as_deref() == Some("known")));
}
