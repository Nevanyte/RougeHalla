//! Native closed-fixture differential verifier; no Node runtime required for Rust tests.
use rh_sim::mob_catalog::{self as m, rosters as r};
use rh_sim::FactionId;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::fs;

const FIXTURE: &str = include_str!("../../../parity/mobs/catalog-rosters.json");
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    format: String,
    provenance: Provenance,
    coverage: Value,
    cases: Vec<Case>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Provenance {
    base: String,
    command: String,
    runtime: Value,
    sources: Vec<Source>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    path: String,
    sha256: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    id: String,
    input: Input,
    expected: Value,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Camp {
    zone: String,
    spot_count: usize,
    elite_spot: i32,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Input {
    Catalog,
    Kinds,
    Zone {
        zone: String,
        count: usize,
        tape: Vec<f64>,
    },
    Camps {
        zones: Vec<String>,
        tape: Vec<f64>,
    },
    Elites {
        camps: Vec<Camp>,
        tape: Vec<f64>,
    },
    Spots {
        camp: Camp,
        #[serde(rename = "campType")]
        camp_type: String,
        #[serde(rename = "eliteType")]
        elite_type: Option<String>,
        tape: Vec<f64>,
    },
}
fn zone(s: &str) -> Result<FactionId, String> {
    FactionId::parse(s).ok_or_else(|| format!("unknown zone {s}"))
}
fn camp(c: &Camp) -> Result<r::CampSpec, String> {
    Ok(r::CampSpec {
        zone: zone(&c.zone)?,
        spot_count: c.spot_count,
        elite_spot: c.elite_spot,
    })
}
fn ty(s: &str) -> Result<m::MobTypeId, String> {
    m::MobTypeId::parse(s).ok_or_else(|| format!("unknown typed mob {s}"))
}
fn role_value(role: &m::MobRoleDef) -> Value {
    json!({"id":role.id.as_str(),"label":role.label,"hpMult":role.hp_mult,"dmgMult":role.dmg_mult,"moveMult":role.move_mult,"tags":role.tags.iter().map(|tag|tag.as_str()).collect::<Vec<_>>(),"blurb":role.blurb})
}
fn type_value(t: &m::MobTypeDef) -> Value {
    let r = t.role_def();
    json!({"id":t.id,"zone":t.zone.as_str(),"elite":t.elite,"name":t.name,"role":t.role.as_str(),"weapon":t.weapon.as_str(),"hpMult":r.hp_mult,"dmgMult":r.dmg_mult,"moveMult":r.move_mult,"tags":r.tags.iter().map(|tag|tag.as_str()).collect::<Vec<_>>() })
}
fn ids(it: impl Iterator<Item = &'static m::MobTypeDef>) -> Vec<m::MobTypeId> {
    it.map(|t| t.id).collect()
}
fn evaluate(input: &Input) -> Result<Value, String> {
    if matches!(input, Input::Catalog) {
        let types: Vec<_> = m::DEFINITION.types.iter().map(type_value).collect();
        let roles: Vec<_> = m::DEFINITION.roles.iter().map(role_value).collect();
        let regions:Vec<_>=FactionId::ALL.into_iter().map(|zone|json!({"zone":zone.as_str(),"names":[m::mob_name(zone,false),m::mob_name(zone,true)],"weapon":m::mob_weapon(zone).as_str(),"all":ids(m::mob_types_of(zone)),"normal":ids(m::normal_types_of(zone)),"elite":ids(m::elites_of(zone))})).collect();
        let lookup_ids: Vec<_> = [None, Some(""), Some("not-a-mob"), Some("EMBERIMP")]
            .into_iter()
            .chain(m::DEFINITION.types.iter().map(|t| Some(t.id.as_str())))
            .collect();
        let lookups:Vec<_>=FactionId::ALL.into_iter().flat_map(|zone|lookup_ids.iter().map(move |&id|json!({"zone":zone.as_str(),"id":id,"byId":id.and_then(m::mob_type_by_id).map(|t|t.id),"inZone":m::mob_type_in(zone,id).map(|t|t.id),"weapon":m::mob_type_weapon(zone,id).as_str()}))).collect();
        let reach: Vec<_> = m::DEFINITION
            .types
            .iter()
            .map(|t| json!({"id":t.id,"damage":m::mob_reach_damage(t)}))
            .collect();
        return Ok(
            json!({"roles":roles,"types":types,"regions":regions,"lookups":lookups,"reach":reach,"bagCopies":m::DEFINITION.rules.bag_copies}),
        );
    }
    if matches!(input, Input::Kinds) {
        return Ok(json!([
            "mob", "elite", "dummy", "zombie", "", "Mob", "player"
        ]
        .map(
            |kind| json!({"kind":kind,"regional":m::is_regional_kind(kind)})
        )));
    }
    let tape = match input {
        Input::Zone { tape, .. }
        | Input::Camps { tape, .. }
        | Input::Elites { tape, .. }
        | Input::Spots { tape, .. } => tape,
        _ => unreachable!(),
    };
    if tape.len() != 49
        || tape
            .iter()
            .any(|v| !v.is_finite() || !(0.0..1.0).contains(v))
    {
        return Err("invalid/exhausted tape".into());
    }
    let mut used = 0;
    let mut next = || {
        let v = tape[used];
        used += 1;
        v
    };
    let output = match input {
        Input::Zone { zone: z, count, .. } => {
            if *count > 100 {
                return Err("unbounded case".into());
            }
            json!(r::roll_zone_types(zone(z)?, *count, &mut next))
        }
        Input::Camps { zones, .. } => {
            if zones.len() > 100 {
                return Err("unbounded case".into());
            }
            let zs: Result<Vec<_>, _> = zones.iter().map(|s| zone(s)).collect();
            json!(r::roll_camp_types(&zs?, &mut next))
        }
        Input::Elites { camps, .. } => {
            let cs: Result<Vec<_>, _> = camps.iter().map(camp).collect();
            json!(r::roll_camp_elites(&cs?)
                .into_iter()
                .map(|t| t.map_or("", |t| t.as_str()))
                .collect::<Vec<_>>())
        }
        Input::Spots {
            camp: c,
            camp_type,
            elite_type,
            ..
        } => {
            if c.spot_count > 100 {
                return Err("unbounded spots".into());
            }
            json!(r::camp_mobs(
                &camp(c)?,
                ty(camp_type)?,
                elite_type.as_deref().map(ty).transpose()?
            ))
        }
        _ => unreachable!(),
    };
    let draws = used;
    if used + 4 > tape.len() {
        return Err("truncated continuation".into());
    }
    let continuation = &tape[used..used + 4];
    Ok(json!({"output":output,"draws":draws,"continuation":continuation}))
}
fn tape(stream: u32) -> Vec<f64> {
    let mut word = stream;
    (0..49)
        .map(|_| {
            word = word.wrapping_mul(1664525).wrapping_add(1013904223);
            f64::from(word) / 4294967296.0
        })
        .collect()
}
fn inventory() -> Vec<(String, Value)> {
    let zs = ["fire", "sentenced", "plague", "frost", "holy"];
    let mut out = vec![
        ("catalog".into(), json!({"kind":"catalog"})),
        ("kinds".into(), json!({"kind":"kinds"})),
    ];
    for i in 0..200usize {
        let zones: Vec<_> = (0..13 + i % 54)
            .map(|k| zs[(k * (i % 4 + 1) + i) % 5])
            .collect();
        out.push((
            format!("stream-{i}"),
            json!({"kind":"camps","zones":zones,"tape":tape(i as u32)}),
        ));
    }
    for (z, zone) in zs.iter().enumerate() {
        for count in [0, 1, 4, 10, 12, 13, 25] {
            out.push((format!("zone-{z}-{count}"),json!({"kind":"zone","zone":zone,"count":count,"tape":tape((1000+z*100+count)as u32)})));
        }
    }
    let layouts = vec![
        vec![],
        vec!["holy"],
        vec!["holy", "fire", "holy", "plague", "fire"],
        vec!["frost"; 13],
    ];
    for (i, zones) in layouts.into_iter().enumerate() {
        out.push((
            format!("layout-{i}"),
            json!({"kind":"camps","zones":zones,"tape":tape(2000+i as u32)}),
        ));
    }
    for (i, draw) in [0.0, 0.25, 0.5, 0.75, 1.0 - 1.0 / 4294967296.0]
        .into_iter()
        .enumerate()
    {
        out.push((
            format!("draw-boundary-{i}"),
            json!({"kind":"zone","zone":"fire","count":13,"tape":vec![draw;49]}),
        ));
    }
    for z in 0..5 {
        let camps: Vec<_> = (0..13)
            .map(|k| json!({"zone":zs[(z+k%2)%5],"spotCount":4,"eliteSpot":if k%4==0{-1}else{(k%4)as i32}}))
            .collect();
        out.push((
            format!("elites-{z}"),
            json!({"kind":"elites","camps":camps,"tape":tape(3000+z as u32)}),
        ));
        for (j, (count, elite)) in [(0, -1), (0, 0), (4, -1), (4, 0), (4, 3), (4, 4), (4, -2)]
            .into_iter()
            .enumerate()
        {
            for explicit in 0..2 {
                let elite_type = if explicit == 1 {
                    Some(m::DEFINITION.types[((z + 1) * 6 + 5) % 30].id)
                } else {
                    None
                };
                out.push((format!("spots-{z}-{j}-{explicit}"),json!({"kind":"spots","camp":{"zone":zs[z],"spotCount":count,"eliteSpot":elite},"campType":m::DEFINITION.types[(z*6+1)%30].id,"eliteType":elite_type,"tape":tape((4000+z*100+j*2+explicit)as u32)})));
            }
        }
    }
    out.push((
        "elites-empty".into(),
        json!({"kind":"elites","camps":[],"tape":tape(5000)}),
    ));
    assert_eq!(out.len(), 322);
    out
}

struct UniqueJson(Value);
impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueJson;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON with unique object keys at every depth")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Bool(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Number(v.into())))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Number(v.into())))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| UniqueJson(Value::Number(n)))
                    .ok_or_else(|| E::custom("nonfinite JSON number"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v.into())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::String(v)))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                self.visit_unit()
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueJson(value)) = a.next_element()? {
                    values.push(value);
                }
                Ok(UniqueJson(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Map::new();
                while let Some(key) = a.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom(format!(
                            "duplicate JSON key {key}"
                        )));
                    }
                    let UniqueJson(value) = a.next_value()?;
                    values.insert(key, value);
                }
                Ok(UniqueJson(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

// Test-side SHA-256: checks the current source bytes without Node, a shell, or a new dependency.
fn sha256(bytes: &[u8]) -> String {
    let k: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut data = bytes.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&((bytes.len() as u64) * 8).to_be_bytes());
    for block in data.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes(word.try_into().unwrap());
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut z] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = z
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(k[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            z = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (i, v) in [a, b, c, d, e, f, g, z].into_iter().enumerate() {
            h[i] = h[i].wrapping_add(v);
        }
    }
    h.iter().map(|v| format!("{v:08x}")).collect()
}
const SOURCES: [&str; 15] = [
    "package-lock.json",
    "packages/shared/src/abilities.ts",
    "packages/shared/src/constants.ts",
    "packages/shared/src/factions.ts",
    "packages/shared/src/map.ts",
    "packages/shared/src/mark.ts",
    "packages/shared/src/messages.ts",
    "packages/shared/src/mobs.ts",
    "packages/shared/src/rng.ts",
    "packages/shared/src/rosters.ts",
    "packages/shared/src/signatureShares.ts",
    "packages/shared/src/signatures.ts",
    "packages/shared/src/status.ts",
    "packages/shared/src/weapons.ts",
    "tools/mob-fixtures/catalog-rosters.ts",
];
fn equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| equivalent(a, b)))
        }
        _ => a == b,
    }
}
fn verify(raw: &str) -> Result<usize, String> {
    let UniqueJson(value) = serde_json::from_str(raw).map_err(|e| format!("unique JSON: {e}"))?;
    let f: Fixture = serde_json::from_value(value.clone()).map_err(|e| format!("schema: {e}"))?;
    if f.format != "rh-mob-catalog/1"
        || f.provenance.base != "49726d60fdd92e669c6605b13bac40c14ba56421"
        || f.provenance.command
            != "node --import tsx tools/mob-fixtures/catalog-rosters.ts --capture"
        || f.provenance.runtime != json!({"node":"v22.23.4","platform":"linux","arch":"x64"})
    {
        return Err("provenance header".into());
    }
    if f.coverage
        != json!({"cases":322,"types":30,"normal":20,"elite":10,"roles":5,"streams":200,"lookups":170,"continuation":4})
    {
        return Err("coverage".into());
    }
    if f.provenance
        .sources
        .iter()
        .map(|s| s.path.as_str())
        .collect::<Vec<_>>()
        != SOURCES
    {
        return Err("exact source inventory".into());
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for source in &f.provenance.sources {
        let content = fs::read(root.join(&source.path)).map_err(|e| e.to_string())?;
        if sha256(&content) != source.sha256 {
            return Err(format!("stale source {}", source.path));
        }
    }
    let expected_inventory = inventory();
    if f.cases.len() != expected_inventory.len() {
        return Err("missing/extra/zero cases".into());
    }
    let mut seen = BTreeSet::new();
    let mut streams = BTreeSet::new();
    for (i, (c, (id, input))) in f.cases.iter().zip(expected_inventory).enumerate() {
        if !seen.insert(&c.id) || c.id != id || !equivalent(&value["cases"][i]["input"], &input) {
            return Err(format!("inventory/input case {}", c.id));
        }
        if (2..202).contains(&i) {
            streams.insert(value["cases"][i]["input"]["tape"].to_string());
        }
        let got = evaluate(&c.input)?;
        if !equivalent(&got, &c.expected) {
            return Err(format!("output/draw/continuation mismatch {}", c.id));
        }
    }
    if streams.len() != 200 {
        return Err("not 200 distinct streams".into());
    }
    Ok(f.cases.len())
}
#[test]
fn source_catalog_rosters_and_draws_match() {
    assert_eq!(verify(FIXTURE).unwrap(), 322);
}
#[test]
fn sha256_known_vectors() {
    assert_eq!(
        sha256(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        sha256(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
#[test]
fn actual_definition_visitor_has_every_leaf_owner() {
    let (mut roles, mut types, mut regions, mut rules) = (0, 0, 0, 0);
    m::visit_definition(&m::DEFINITION, |entry| match entry {
        m::Metadata::Role(r) => {
            assert!(std::ptr::eq(r, m::role_def(r.id)));
            roles += 1;
        }
        m::Metadata::Type(t) => {
            assert!(std::ptr::eq(t, m::mob_type_by_id(t.id.as_str()).unwrap()));
            types += 1;
        }
        m::Metadata::Region(r) => {
            assert_eq!(r.weapon, m::mob_weapon(r.zone));
            regions += 1;
        }
        m::Metadata::Rules(r) => {
            assert!(std::ptr::eq(r, &m::DEFINITION.rules));
            rules += 1;
        }
    });
    assert_eq!((roles, types, regions, rules), (5, 30, 5, 1));
}
#[test]
fn strict_fixture_negative_controls() {
    let base: Value = serde_json::from_str(FIXTURE).unwrap();
    type Mutation = (&'static str, fn(&mut Value));
    let mutations: Vec<Mutation> = vec![
        ("zero cases", |v| v["cases"] = json!([])),
        ("missing case", |v| {
            v["cases"].as_array_mut().unwrap().pop();
        }),
        ("duplicate case", |v| v["cases"][3] = v["cases"][2].clone()),
        ("unknown root", |v| v["unexpected"] = json!(true)),
        ("unknown input field", |v| {
            v["cases"][2]["input"]["unexpected"] = json!(true)
        }),
        ("unknown expected field", |v| {
            v["cases"][2]["expected"]["unexpected"] = json!(true)
        }),
        ("unknown provenance field", |v| {
            v["provenance"]["unexpected"] = json!(true)
        }),
        ("source hash", |v| {
            v["provenance"]["sources"][0]["sha256"] = json!("0".repeat(64))
        }),
        ("source missing", |v| {
            v["provenance"]["sources"].as_array_mut().unwrap().pop();
        }),
        ("source duplicate", |v| {
            v["provenance"]["sources"][1] = v["provenance"]["sources"][0].clone()
        }),
        ("runtime", |v| {
            v["provenance"]["runtime"]["arch"] = json!("arm64")
        }),
        ("bad typed key", |v| {
            v["cases"][2]["input"]["zones"][0] = json!("unknown")
        }),
        ("tape invalid", |v| {
            v["cases"][2]["input"]["tape"][0] = json!(1)
        }),
        ("tape exhausted", |v| {
            v["cases"][2]["input"]["tape"] = json!([])
        }),
        ("truncated continuation", |v| {
            v["cases"][2]["expected"]["continuation"]
                .as_array_mut()
                .unwrap()
                .pop();
        }),
        ("draw count", |v| {
            v["cases"][2]["expected"]["draws"] = json!(44)
        }),
        ("role drift", |v| {
            v["cases"][0]["expected"]["roles"][1]["hpMult"] = json!(0.8)
        }),
        ("type name", |v| {
            v["cases"][0]["expected"]["types"][0]["name"] = json!("wrong")
        }),
        ("weapon drift", |v| {
            v["cases"][0]["expected"]["types"][0]["weapon"] = json!("sword")
        }),
        ("fallback drift", |v| {
            v["cases"][0]["expected"]["lookups"][0]["weapon"] = json!("fists")
        }),
        ("cross-zone acceptance", |v| {
            v["cases"][0]["expected"]["lookups"][10]["inZone"] = json!("bailiff")
        }),
        ("camp ordering", |v| {
            v["cases"][2]["expected"]["output"]
                .as_array_mut()
                .unwrap()
                .swap(0, 1);
        }),
        ("elite wrapping", |v| {
            v["cases"][246]["expected"]["output"][1] = json!("ashDrake")
        }),
    ];
    for (name, mutate) in mutations {
        let mut value = base.clone();
        mutate(&mut value);
        assert_ne!(value, base, "ineffective mutation {name}");
        assert!(verify(&value.to_string()).is_err(), "accepted {name}");
    }
    let dup = FIXTURE.replacen("\"format\":", "\"format\":\"duplicate\",\"format\":", 1);
    assert!(verify(&dup).unwrap_err().contains("duplicate JSON key"));
    let nested = FIXTURE.replacen("\"count\":0", "\"count\":0,\"count\":0", 1);
    assert_ne!(nested, FIXTURE);
    assert!(verify(&nested).unwrap_err().contains("duplicate JSON key"));
    assert!(verify(&FIXTURE.replacen("0.23606797284446657", "NaN", 1)).is_err());
}
#[test]
fn malformed_tapes_rejected_before_core_call() {
    for v in [f64::NAN, f64::INFINITY, -0.1, 1.0] {
        let input = Input::Zone {
            zone: "fire".into(),
            count: 1,
            tape: vec![v; 49],
        };
        assert!(evaluate(&input).is_err());
    }
}
