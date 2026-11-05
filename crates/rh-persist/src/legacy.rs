//! The legacy profile file (`ProfileStore.ts`, file version 2; version 1 "stash" files are migrated as the legacy
//! store does). Validation mirrors `parseProfileV2`/`parseProfileV1`: an unreadable file is an error, a broken
//! entry is dropped and reported.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::model::*;
use crate::{hash_token, Error, Result};

pub struct ParsedFile {
    pub version: i64,
    pub profiles: Vec<LegacyProfile>,
    /// (key, reason) of every entry that was left out.
    pub dropped: Vec<(String, String)>,
}

/// A profile as the legacy file holds it: the plain token, which the importer hashes and drops.
#[derive(Debug, Clone)]
pub struct LegacyProfile {
    pub profile: Profile,
}

#[derive(Deserialize)]
struct EntryV2 {
    name: String,
    token: String,
    gv: i64,
    #[serde(rename = "gvLifetime")]
    gv_lifetime: i64,
    #[serde(rename = "gvByMonth")]
    gv_by_month: BTreeMap<String, i64>,
    stats: Stats,
    cosmetics: Cosmetics,
    #[serde(default)]
    achievements: BTreeMap<String, i64>,
    #[serde(default)]
    progress: Option<Progress>,
}

#[derive(Deserialize)]
struct StatsV1 {
    raids: i64,
    #[allow(dead_code)]
    extracts: i64,
    deaths: i64,
    kills: i64,
}

#[derive(Deserialize)]
struct StashItem {
    uid: String,
    #[allow(dead_code)]
    def: String,
}

#[derive(Deserialize)]
struct EntryV1 {
    name: String,
    token: String,
    stats: StatsV1,
    stash: Vec<StashItem>,
}

fn count(n: i64) -> bool {
    (0..=MAX_SAFE).contains(&n)
}

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.to_owned())
}

pub fn parse_file(text: &str) -> Result<ParsedFile> {
    let raw: Value = serde_json::from_str(text)?;
    let obj = raw.as_object().ok_or_else(|| bad("not a JSON object"))?;
    let version = obj.get("version").and_then(Value::as_i64);
    let version = match version {
        Some(v @ (1 | 2)) => v,
        other => {
            return Err(Error::Invalid(format!(
                "unsupported version {other:?}, expected 2 (or 1)"
            )))
        }
    };
    let entries = obj
        .get("profiles")
        .and_then(Value::as_object)
        .ok_or_else(|| bad("missing \"profiles\" object"))?;
    let mut profiles = Vec::new();
    let mut dropped = Vec::new();
    for (key, entry) in entries {
        let parsed = if version == 1 {
            parse_v1(key, entry)
        } else {
            parse_v2(key, entry)
        };
        match parsed {
            Ok(p) => profiles.push(LegacyProfile { profile: p }),
            Err(e) => dropped.push((key.chars().take(40).collect(), e.to_string())),
        }
    }
    Ok(ParsedFile {
        version,
        profiles,
        dropped,
    })
}

fn check_entry(key: &str, name: &str, token: &str) -> Result<()> {
    if name != key || !valid_callsign(key) || token.is_empty() {
        return Err(bad("bad profile entry"));
    }
    Ok(())
}

fn parse_v2(key: &str, v: &Value) -> Result<Profile> {
    let e: EntryV2 =
        serde_json::from_value(v.clone()).map_err(|e| Error::Invalid(e.to_string()))?;
    check_entry(key, &e.name, &e.token)?;
    if !count(e.gv) || !count(e.gv_lifetime) {
        return Err(bad("bad gv"));
    }
    if e.gv_by_month
        .iter()
        .any(|(m, g)| !valid_month(m) || !count(*g))
    {
        return Err(bad("bad gvByMonth"));
    }
    let s = &e.stats;
    if ![s.runs, s.wins, s.draws, s.deaths, s.kills]
        .into_iter()
        .all(count)
    {
        return Err(bad("bad stats"));
    }
    let mut seen = BTreeSet::new();
    for id in &e.cosmetics.owned {
        if !seen.insert(id) {
            return Err(bad("duplicate cosmetic"));
        }
    }
    if e.achievements.values().any(|n| !count(*n)) {
        return Err(bad("bad achievements"));
    }
    let progress = e.progress.unwrap_or_default();
    let counts = [
        progress.qualified_wins,
        progress.bounty_runs,
        progress.best_run_kills,
    ];
    if !counts.into_iter().all(count)
        || progress
            .wins_by_faction
            .values()
            .chain(progress.wins_by_weapon.values())
            .any(|n| !count(*n))
    {
        return Err(bad("bad progress"));
    }
    Ok(Profile {
        callsign: e.name,
        token_sha256: hash_token(&e.token),
        gv: e.gv,
        gv_lifetime: e.gv_lifetime,
        gv_by_month: e.gv_by_month,
        stats: e.stats,
        cosmetics: e.cosmetics,
        achievements: e.achievements,
        progress,
    })
}

/// A v1 profile migrates to a blank profile with the old raid/death/kill counts (the stash does not survive).
fn parse_v1(key: &str, v: &Value) -> Result<Profile> {
    let e: EntryV1 =
        serde_json::from_value(v.clone()).map_err(|e| Error::Invalid(e.to_string()))?;
    check_entry(key, &e.name, &e.token)?;
    let st = &e.stats;
    if ![st.raids, st.deaths, st.kills].into_iter().all(count) {
        return Err(bad("bad stats"));
    }
    let mut seen = BTreeSet::new();
    if e.stash.iter().any(|i| !seen.insert(i.uid.clone())) {
        return Err(bad("duplicate stash uid"));
    }
    Ok(Profile {
        callsign: e.name,
        token_sha256: hash_token(&e.token),
        gv: 0,
        gv_lifetime: 0,
        gv_by_month: BTreeMap::new(),
        stats: Stats {
            runs: st.raids,
            wins: 0,
            draws: 0,
            deaths: st.deaths,
            kills: st.kills,
            ..Stats::default()
        },
        cosmetics: Cosmetics::default(),
        achievements: BTreeMap::new(),
        progress: Progress::default(),
    })
}

/// The legacy v2 shape. Tokens cannot be recovered from their hashes: the token field holds an `unrecoverable-sha256:`
/// marker that no client token can equal, so a server started on an export alone locks every player out. Rolling
/// back to the legacy server needs the ORIGINAL file.
pub fn export_value(profiles: &[Profile]) -> Value {
    let mut map = Map::new();
    for p in profiles {
        map.insert(
            p.callsign.clone(),
            json!({
                "name": p.callsign,
                "token": format!("unrecoverable-sha256:{}", hex::encode(p.token_sha256)),
                "gv": p.gv,
                "gvLifetime": p.gv_lifetime,
                "gvByMonth": p.gv_by_month,
                "stats": p.stats,
                "cosmetics": p.cosmetics,
                "achievements": p.achievements,
                "progress": p.progress,
            }),
        );
    }
    json!({ "version": 2, "profiles": Value::Object(map) })
}
